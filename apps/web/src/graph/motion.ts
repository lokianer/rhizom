// Time in the bubble field: easing curves, a tween, and the frame loop that drives them.
// Everything moves on interaction and then rests, and at rest the loop asks the browser for no
// frame at all. Pure: the clock and the frame scheduler are handed in, so the tests turn time by
// hand and nothing here needs a DOM.

/** Maps progress 0 … 1 to eased progress 0 … 1. */
export type Easing = (t: number) => number;

/** Also maps NaN to 0, so a division by a zero duration cannot poison a position. */
export function clamp01(t: number): number {
  return t > 0 ? (t < 1 ? t : 1) : 0;
}

/** Fast out, soft landing: the default for anything that answers the pointer. */
export function easeOutCubic(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

/** Soft at both ends: for a journey with a start and an end, such as a camera flight. */
export function easeInOutCubic(t: number): number {
  const p = clamp01(t);
  if (p < 0.5) {
    return 4 * p * p * p;
  }
  const u = -2 * p + 2;
  return 1 - (u * u * u) / 2;
}

/** Hermite smoothstep of x between two edges; the edges may be given in either order. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1;
  }
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Something the frame loop moves on until it arrives. */
export interface Animation {
  /** Moves on by `dtMs`; false once it has arrived and needs no further frame. */
  advance(dtMs: number): boolean;
  /** Jumps to where it was heading: reduced motion, or a caller that cannot wait. */
  finish(): void;
}

/**
 * A number easing from where it is towards a target. Retargeting mid-way starts the new journey
 * from the current value, so reversing a fade never jumps.
 */
export class Tween implements Animation {
  #value: number;
  #from: number;
  #to: number;
  #elapsed = 0;
  #duration = 0;
  readonly #ease: Easing;

  constructor(value = 0, ease: Easing = easeOutCubic) {
    this.#value = value;
    this.#from = value;
    this.#to = value;
    this.#ease = ease;
  }

  get value(): number {
    return this.#value;
  }

  get target(): number {
    return this.#to;
  }

  get moving(): boolean {
    return this.#value !== this.#to;
  }

  /**
   * Heads for `target`, arriving after `durationMs`. Returns false when it was already there or
   * already on its way, in which case the journey carries on undisturbed rather than restarting
   * its curve.
   */
  to(target: number, durationMs: number): boolean {
    if (target === this.#to) {
      return false;
    }
    this.#from = this.#value;
    this.#to = target;
    this.#elapsed = 0;
    this.#duration = durationMs > 0 ? durationMs : 0;
    if (this.#duration === 0) {
      this.#value = target;
    }
    return true;
  }

  /** Jumps to a value and stays there. */
  set(value: number): void {
    this.#value = value;
    this.#from = value;
    this.#to = value;
    this.#elapsed = 0;
    this.#duration = 0;
  }

  advance(dtMs: number): boolean {
    if (this.#value === this.#to) {
      return false;
    }
    this.#elapsed += dtMs > 0 ? dtMs : 0;
    if (this.#elapsed >= this.#duration) {
      this.#value = this.#to;
      return false;
    }
    this.#value = this.#from + (this.#to - this.#from) * this.#ease(this.#elapsed / this.#duration);
    return true;
  }

  finish(): void {
    this.#value = this.#to;
    this.#elapsed = this.#duration;
  }
}

/**
 * The longest step one frame may take. A tab that was hidden resumes with a frame seconds after
 * the last one; without the clamp every animation would jump to its end in that single frame.
 */
export const MAX_FRAME_MS = 64;

export interface MotionLoopOptions {
  /** `requestAnimationFrame` in the browser; the tests queue callbacks by hand. */
  readonly requestFrame: (callback: () => void) => number;
  readonly cancelFrame: (handle: number) => void;
  /** Milliseconds on any monotonic clock: `performance.now` in the browser. */
  readonly now: () => number;
  /** Draws one frame, after every live animation has moved on. */
  readonly onFrame: (dtMs: number) => void;
}

export interface MotionLoop {
  /** Keeps an animation moving, one advance per frame, until it reports that it has arrived. */
  add: (animation: Animation) => void;
  /** Asks for one frame; any number of requests before it arrives make one frame. */
  request: () => void;
  /** While paused (a hidden tab, a hidden graph) no frame is drawn; resuming picks up the rest. */
  setPaused: (paused: boolean) => void;
  /** Under reduced motion every animation is finished instead of advanced. */
  setReducedMotion: (reduced: boolean) => void;
  /** For good: cancels the pending frame, drops every animation and ignores later requests. */
  stop: () => void;
}

/**
 * The frame loop of the field. Requests are coalesced into one frame; a frame advances every live
 * animation, drops the ones that have arrived and then draws. It keeps asking for frames only
 * while something moves, so once everything has arrived the browser is asked for nothing until
 * the next interaction.
 */
export function createMotionLoop(options: MotionLoopOptions): MotionLoop {
  const { requestFrame, cancelFrame, now, onFrame } = options;
  const live: Animation[] = [];
  let handle = 0;
  let pending = false;
  let paused = false;
  let stopped = false;
  let reduced = false;
  /** A frame was asked for while paused. */
  let wanted = false;
  /** Time of the previous frame; NaN at rest, so the first frame measures from its request. */
  let last = Number.NaN;
  /** While a frame advances the animations: the slot being advanced, else -1. */
  let advancing = -1;
  /** While a frame advances the animations: how many of them are carried into the next one. */
  let kept = 0;

  /**
   * Whether an animation is live. Mid-frame, the slots from `kept` up to the one being advanced
   * still hold animations that have arrived and are about to drop out; one of those being added
   * again (by another animation's advance) must count as new, or it would be lost.
   */
  const isLive = (animation: Animation): boolean => {
    if (advancing < 0) {
      return live.includes(animation);
    }
    const first = live.indexOf(animation);
    return first !== -1 && (first < kept || live.includes(animation, advancing));
  };

  const schedule = (): void => {
    if (pending || stopped) {
      return;
    }
    if (paused) {
      wanted = true;
      return;
    }
    if (Number.isNaN(last)) {
      last = now();
    }
    pending = true;
    handle = requestFrame(frame);
  };

  const frame = (): void => {
    pending = false;
    if (stopped || paused) {
      return;
    }
    const time = now();
    const dt = Math.min(MAX_FRAME_MS, Math.max(0, time - last));
    last = time;
    if (reduced) {
      for (const animation of live) {
        animation.finish();
      }
      live.length = 0;
    } else {
      // Compacted in place: arrived animations drop out without a new array per frame. Writes
      // land only on slots already passed, and the length is read on every step, so an animation
      // added by another's advance still moves in this frame.
      kept = 0;
      for (advancing = 0; advancing < live.length; advancing += 1) {
        const animation = live[advancing];
        if (animation?.advance(dt) === true) {
          live[kept] = animation;
          kept += 1;
        }
      }
      advancing = -1;
      live.length = kept;
    }
    onFrame(dt);
    if (live.length > 0) {
      schedule();
    } else if (!pending) {
      last = Number.NaN; // at rest, unless onFrame asked for another frame itself
    }
  };

  return {
    add: (animation) => {
      if (stopped) {
        return;
      }
      if (!isLive(animation)) {
        live.push(animation);
      }
      schedule();
    },
    request: schedule,
    setPaused: (next) => {
      if (next === paused || stopped) {
        return;
      }
      paused = next;
      if (paused) {
        if (pending) {
          cancelFrame(handle);
          pending = false;
          wanted = true;
        }
        last = Number.NaN; // the time spent paused is not animation time
        return;
      }
      if (wanted || live.length > 0) {
        wanted = false;
        schedule();
      }
    },
    setReducedMotion: (next) => {
      reduced = next;
      if (reduced && live.length > 0) {
        schedule(); // the frame finishes them and draws the end state
      }
    },
    stop: () => {
      stopped = true;
      if (pending) {
        cancelFrame(handle);
        pending = false;
      }
      live.length = 0;
    },
  };
}
