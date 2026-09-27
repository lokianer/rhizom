import { describe, expect, it } from 'vitest';

import {
  clamp01,
  createMotionLoop,
  easeInOutCubic,
  easeOutCubic,
  MAX_FRAME_MS,
  smoothstep,
  Tween,
  type Animation,
  type Easing,
} from './motion.js';

/** No easing at all: progress as it is, clamped. */
const linear: Easing = clamp01;

describe('clamp01', () => {
  it('clamps to the unit interval and reads NaN as 0', () => {
    expect(clamp01(-2)).toBe(0);
    expect(clamp01(0.25)).toBe(0.25);
    expect(clamp01(7)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe('easings', () => {
  const curves = { easeOutCubic, easeInOutCubic };

  it.each(Object.entries(curves))('%s runs from 0 to 1 and never backwards', (_, ease) => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    let previous = 0;
    for (let step = 1; step <= 100; step += 1) {
      const value = ease(step / 100);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it.each(Object.entries(curves))('%s clamps progress outside 0 … 1', (_, ease) => {
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
  });

  it('eases out fast and lands softly', () => {
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 12);
  });

  it('eases in and out symmetrically around the middle', () => {
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 12);
    for (const t of [0.1, 0.2, 0.35, 0.45]) {
      expect(easeInOutCubic(t) + easeInOutCubic(1 - t)).toBeCloseTo(1, 12);
    }
  });
});

describe('smoothstep', () => {
  it('is 0 before the first edge, 1 after the second and one half between', () => {
    expect(smoothstep(2, 4, 1)).toBe(0);
    expect(smoothstep(2, 4, 5)).toBe(1);
    expect(smoothstep(2, 4, 3)).toBeCloseTo(0.5, 12);
  });

  it('takes the edges in either order', () => {
    expect(smoothstep(4, 2, 5)).toBe(0);
    expect(smoothstep(4, 2, 1)).toBe(1);
  });

  it('turns into a step when both edges are equal', () => {
    expect(smoothstep(3, 3, 2.9)).toBe(0);
    expect(smoothstep(3, 3, 3)).toBe(1);
  });
});

describe('Tween', () => {
  it('eases to its target over the duration and then reports arrival', () => {
    const tween = new Tween(0, linear);
    expect(tween.to(10, 100)).toBe(true);
    expect(tween.moving).toBe(true);
    expect(tween.advance(25)).toBe(true);
    expect(tween.value).toBeCloseTo(2.5, 12);
    expect(tween.advance(75)).toBe(false);
    expect(tween.value).toBe(10);
    expect(tween.moving).toBe(false);
    expect(tween.advance(16)).toBe(false);
  });

  it('applies its easing', () => {
    const tween = new Tween(0);
    tween.to(1, 100);
    tween.advance(50);
    expect(tween.value).toBeCloseTo(easeOutCubic(0.5), 12);
  });

  it('turns round from where it is, without a jump', () => {
    const tween = new Tween(0, linear);
    tween.to(1, 100);
    tween.advance(40);
    tween.to(0, 100);
    expect(tween.value).toBeCloseTo(0.4, 12);
    tween.advance(50);
    expect(tween.value).toBeCloseTo(0.2, 12);
  });

  it('does not restart a journey to the target it already has', () => {
    const tween = new Tween(0, linear);
    tween.to(1, 100);
    tween.advance(50);
    expect(tween.to(1, 100)).toBe(false);
    tween.advance(50);
    expect(tween.value).toBe(1);
  });

  it('jumps when given no time, and on set', () => {
    const tween = new Tween(0);
    tween.to(3, 0);
    expect(tween.value).toBe(3);
    expect(tween.moving).toBe(false);
    tween.to(8, 100);
    tween.set(-1);
    expect(tween.value).toBe(-1);
    expect(tween.target).toBe(-1);
    expect(tween.advance(16)).toBe(false);
  });

  it('finishes on its target', () => {
    const tween = new Tween(2);
    tween.to(6, 500);
    tween.advance(10);
    tween.finish();
    expect(tween.value).toBe(6);
    expect(tween.advance(16)).toBe(false);
  });
});

/** requestAnimationFrame by hand: frames run only when the test says so. */
function fakeFrames() {
  let time = 1000;
  let nextHandle = 1;
  const queue = new Map<number, () => void>();
  return {
    now: () => time,
    requestFrame: (callback: () => void) => {
      const handle = nextHandle;
      nextHandle += 1;
      queue.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle: number) => {
      queue.delete(handle);
    },
    /** Moves the clock on and runs the frames queued so far; returns how many ran. */
    tick(ms = 16): number {
      time += ms;
      const callbacks = [...queue.values()];
      queue.clear();
      for (const callback of callbacks) {
        callback();
      }
      return callbacks.length;
    },
    wait(ms: number): void {
      time += ms;
    },
    get queued(): number {
      return queue.size;
    },
  };
}

/** An animation that needs a fixed amount of time, recording what the loop did to it. */
function timed(ms: number) {
  const record = { remaining: ms, advanced: [] as number[], finished: 0 };
  const animation: Animation = {
    advance: (dt) => {
      record.advanced.push(dt);
      record.remaining -= dt;
      return record.remaining > 0;
    },
    finish: () => {
      record.finished += 1;
      record.remaining = 0;
    },
  };
  return { animation, record };
}

function setup() {
  const frames = fakeFrames();
  const drawn: number[] = [];
  const loop = createMotionLoop({
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame,
    now: frames.now,
    onFrame: (dt) => {
      drawn.push(dt);
    },
  });
  return { frames, drawn, loop };
}

describe('createMotionLoop', () => {
  it('makes one frame of any number of requests', () => {
    const { frames, drawn, loop } = setup();
    loop.request();
    loop.request();
    loop.request();
    expect(frames.queued).toBe(1);
    expect(frames.tick()).toBe(1);
    expect(drawn).toHaveLength(1);
  });

  it('asks for nothing once at rest', () => {
    const { frames, drawn, loop } = setup();
    loop.request();
    frames.tick();
    expect(frames.queued).toBe(0);
    expect(frames.tick()).toBe(0);
    expect(drawn).toHaveLength(1);
  });

  it('keeps drawing while an animation moves, then drops it and stops', () => {
    const { frames, drawn, loop } = setup();
    const { animation, record } = timed(40);
    loop.add(animation);
    frames.tick(16);
    frames.tick(16);
    frames.tick(16);
    expect(record.advanced).toEqual([16, 16, 16]);
    expect(drawn).toHaveLength(3);
    expect(frames.queued).toBe(0);
    loop.request();
    frames.tick(16);
    expect(record.advanced).toHaveLength(3); // dropped: not advanced again
  });

  it('advances an animation added twice only once per frame', () => {
    const { frames, loop } = setup();
    const { animation, record } = timed(100);
    loop.add(animation);
    loop.add(animation);
    frames.tick(16);
    expect(record.advanced).toEqual([16]);
  });

  it('keeps going for an animation that arrives while others are dropped', () => {
    const { frames, loop } = setup();
    const short = timed(10);
    const long = timed(50);
    loop.add(short.animation);
    loop.add(long.animation);
    frames.tick(16);
    frames.tick(16);
    expect(short.record.advanced).toEqual([16]);
    expect(long.record.advanced).toEqual([16, 16]);
  });

  it('measures the first frame from the request, not from the last frame drawn', () => {
    const { frames, drawn, loop } = setup();
    loop.request();
    frames.tick(16);
    frames.wait(5000);
    loop.request();
    frames.tick(12);
    expect(drawn).toEqual([16, 12]);
  });

  it(`clamps a frame to ${String(MAX_FRAME_MS)} ms so a resumed tab does not jump`, () => {
    const { frames, loop } = setup();
    const { animation, record } = timed(1000);
    loop.add(animation);
    frames.tick(16);
    frames.tick(3000);
    expect(record.advanced).toEqual([16, MAX_FRAME_MS]);
  });

  it('gives another frame when onFrame asks for one, and only one', () => {
    const frames = fakeFrames();
    let drawn = 0;
    const loop = createMotionLoop({
      ...frames,
      onFrame: () => {
        drawn += 1;
        if (drawn === 1) {
          loop.request();
          loop.request();
        }
      },
    });
    loop.request();
    frames.tick();
    expect(frames.queued).toBe(1);
    frames.tick();
    expect(frames.queued).toBe(0);
    expect(drawn).toBe(2);
  });

  it('moves an animation that another one adds during its advance', () => {
    const { frames, loop } = setup();
    const late = timed(100);
    loop.add({
      advance: () => {
        loop.add(late.animation);
        return false;
      },
      finish: () => undefined,
    });
    frames.tick(16);
    expect(late.record.advanced).toEqual([16]);
    expect(frames.queued).toBe(1);
  });

  it('keeps an animation that arrived earlier in the frame and is added again by a later one', () => {
    const { frames, loop } = setup();
    const early = timed(10);
    let retarget = true;
    loop.add(early.animation);
    loop.add({
      advance: () => {
        if (retarget) {
          // A new journey for the one that has just arrived, e.g. a hover while a fade ended.
          retarget = false;
          early.record.remaining = 40;
          loop.add(early.animation);
        }
        return true;
      },
      finish: () => undefined,
    });
    frames.tick(16);
    frames.tick(16);
    frames.tick(16);
    frames.tick(16);
    // Arrived, then carried on in the same frame and the next two until its 40 ms were used up.
    expect(early.record.advanced).toEqual([16, 16, 16, 16]);
  });

  it('finishes animations instead of advancing them under reduced motion', () => {
    const { frames, drawn, loop } = setup();
    loop.setReducedMotion(true);
    const { animation, record } = timed(500);
    loop.add(animation);
    frames.tick(16);
    expect(record.advanced).toEqual([]);
    expect(record.finished).toBe(1);
    expect(drawn).toHaveLength(1);
    expect(frames.queued).toBe(0);
  });

  it('finishes what is under way when reduced motion is switched on', () => {
    const { frames, loop } = setup();
    const { animation, record } = timed(500);
    loop.add(animation);
    frames.tick(16);
    loop.setReducedMotion(true);
    frames.tick(16);
    expect(record.advanced).toEqual([16]);
    expect(record.finished).toBe(1);
    expect(frames.queued).toBe(0);
  });

  it('draws nothing while paused and picks up where it left off', () => {
    const { frames, drawn, loop } = setup();
    const { animation, record } = timed(100);
    loop.add(animation);
    loop.setPaused(true);
    expect(frames.queued).toBe(0);
    loop.request();
    expect(frames.tick()).toBe(0);
    frames.wait(10_000);
    loop.setPaused(false);
    frames.tick(16);
    expect(record.advanced).toEqual([16]); // the time spent paused does not count
    expect(drawn).toHaveLength(1);
  });

  it('remembers a request made while paused', () => {
    const { frames, drawn, loop } = setup();
    loop.setPaused(true);
    loop.request();
    loop.setPaused(false);
    frames.tick();
    expect(drawn).toHaveLength(1);
  });

  it('asks for nothing on resume when nothing was wanted', () => {
    const { frames, loop } = setup();
    loop.setPaused(true);
    loop.setPaused(false);
    expect(frames.queued).toBe(0);
  });

  it('stops for good', () => {
    const { frames, drawn, loop } = setup();
    const { animation, record } = timed(100);
    loop.add(animation);
    loop.stop();
    expect(frames.queued).toBe(0);
    loop.request();
    loop.add(animation);
    loop.setPaused(true);
    loop.setPaused(false);
    expect(frames.tick()).toBe(0);
    expect(record.advanced).toEqual([]);
    expect(drawn).toEqual([]);
  });
});
