// The camera over the field: what the wheel, a drag, a flick and "fit" do to the view transform,
// and how each of them moves over time. Pure — the controller feeds it pointer input and frame
// times, the motion loop advances it, and the tests drive both by hand.
import { easeInOutCubic, type Animation } from './motion.js';
import type { Mutable } from './types.js';
import type { ViewTransform } from './view.js';

/** The zoom range: from a whole large vault as a speck to a single bubble filling the screen. */
export const K_MIN = 0.05;
export const K_MAX = 12;

/**
 * Time constant of the wheel zoom's approach in log scale. Long enough that the notches of a
 * mouse wheel run together into one glide, short enough that the view still feels attached to the
 * wheel rather than trailing behind it.
 */
const ZOOM_TAU_MS = 100;
/** Distance in ln(k) at which the eased zoom lands on its target. */
const ZOOM_EPSILON = 1e-3;

/** Friction of a released pan: the velocity decays by e every this many milliseconds. */
const GLIDE_TAU_MS = 320;
/** px/ms a release needs to carry on at all; slower, it was a placement rather than a flick. */
const GLIDE_MIN_SPEED = 0.1;
/** px/ms under which a glide ends: about a pixel a frame, where the motion stops reading. */
const GLIDE_STOP_SPEED = 0.015;
/** px/ms: one noisy sample in the pointer history must not throw the field off the screen. */
const GLIDE_MAX_SPEED = 3;

/**
 * Curvature of the flight path (van Wijk & Nuij's ρ): how far the camera pulls back while it
 * travels. √2 is their perceptual optimum; a little less keeps short hops from zooming out more
 * than the distance needs.
 */
const FLY_RHO = 1.4;
/**
 * Milliseconds per unit of path length S. d3 spends about 1,000 ms; a camera beside an editor
 * should get the reader there sooner than a demonstration would.
 */
const FLY_MS_PER_S = 800;
const FLY_MIN_MS = 400;
const FLY_MAX_MS = 1100;
/**
 * CSS px: a flight that would move nothing on screen by more than this is made at once. It would
 * otherwise spend the shortest flight's 400 ms of frames — a second of rasterising on a machine
 * without a GPU — on a change nobody can see.
 */
const FLY_INVISIBLE_PX = 0.5;

export function clampK(k: number): number {
  return Number.isFinite(k) ? Math.min(K_MAX, Math.max(K_MIN, k)) : 1;
}

export interface ZoomOptions {
  /**
   * Lands at once instead of easing. For a trackpad pinch, which is continuous already: easing
   * it on top would only make it lag behind the fingers.
   */
  readonly immediate?: boolean;
}

/**
 * Holds the view transform and moves it. Every command lands immediately under reduced motion.
 * The transform is one object updated in place — reading it allocates nothing per frame — so a
 * caller that wants to keep a snapshot copies it.
 */
export class Camera implements Animation {
  readonly #view: Mutable<ViewTransform>;
  #reducedMotion = false;

  #zooming = false;
  #zoomK = 1;
  #zoomX = 0;
  #zoomY = 0;

  #gliding = false;
  #vx = 0;
  #vy = 0;

  #flying = false;
  #flyElapsed = 0;
  #flyDuration = 0;
  readonly #flyEnd: Mutable<ViewTransform> = { k: 1, x: 0, y: 0 };
  /** The path in graph space: start centre, start width, travel, and van Wijk's parameters. */
  #ux0 = 0;
  #uy0 = 0;
  #w0 = 1;
  #dx = 0;
  #dy = 0;
  /** Length of the travel; 0 for a flight that only zooms. */
  #d1 = 0;
  #r0 = 0;
  #pathS = 0;
  /** max(width, height) of the screen the flight was planned for, and its centre. */
  #size = 1;
  #halfW = 0;
  #halfH = 0;

  constructor(initial: ViewTransform = { k: 1, x: 0, y: 0 }) {
    this.#view = { k: clampK(initial.k), x: initial.x, y: initial.y };
  }

  /** The current view. The same object every time, updated in place. */
  get transform(): ViewTransform {
    return this.#view;
  }

  get isMoving(): boolean {
    return this.#zooming || this.#gliding || this.#flying;
  }

  /**
   * Turning reduced motion on lands a zoom or a flight under way, and stops a glide where it is —
   * the same reason `release` gives for not gliding at all.
   */
  setReducedMotion(reduced: boolean): void {
    this.#reducedMotion = reduced;
    if (reduced) {
      this.#gliding = false;
      this.finish();
    }
  }

  /**
   * Zooms by `factor` around the screen point (px, py), which keeps the graph point under it in
   * place. The zoom eases in log scale towards its target, and a zoom that arrives while one is
   * under way multiplies onto that target rather than onto the current scale, so fast wheel
   * notches add up instead of being lost.
   */
  zoomBy(factor: number, px: number, py: number, options: ZoomOptions = {}): void {
    if (!(factor > 0) || !Number.isFinite(factor)) {
      return;
    }
    this.#flying = false;
    this.#gliding = false;
    const k1 = clampK((this.#zooming ? this.#zoomK : this.#view.k) * factor);
    if (this.#reducedMotion || options.immediate === true) {
      this.#zooming = false;
      this.#zoomAround(k1, px, py);
      return;
    }
    this.#zoomK = k1;
    this.#zoomX = px;
    this.#zoomY = py;
    this.#zooming = Math.abs(Math.log(k1 / this.#view.k)) > ZOOM_EPSILON;
    if (!this.#zooming) {
      this.#zoomAround(k1, px, py);
    }
  }

  /**
   * Moves the view with the pointer, at once. A glide or a flight stops — the reader has taken
   * hold of the field — while a wheel zoom carries on around the graph point it was aimed at.
   */
  panBy(dx: number, dy: number): void {
    this.#flying = false;
    this.#gliding = false;
    this.#translate(dx, dy);
  }

  /**
   * Lets go of a pan with the pointer's velocity in px/ms, taken from its recent history. A fast
   * enough release glides on and slows down under friction; a slow one stops where it is. Under
   * reduced motion nothing glides: jumping to where the glide would have ended is worse than
   * stopping.
   */
  release(vx: number, vy: number): void {
    this.#flying = false;
    this.#gliding = false;
    const speed = Math.hypot(vx, vy);
    if (this.#reducedMotion || !Number.isFinite(speed) || speed < GLIDE_MIN_SPEED) {
      return;
    }
    const scale = speed > GLIDE_MAX_SPEED ? GLIDE_MAX_SPEED / speed : 1;
    this.#vx = vx * scale;
    this.#vy = vy * scale;
    this.#gliding = true;
  }

  /**
   * Flies to `target` along van Wijk & Nuij's smooth zoom-pan path: out, across and in, so a
   * long journey never races over a field too close to follow. The duration follows the length
   * of the path. `width` and `height` are the screen in CSS px.
   */
  flyTo(target: ViewTransform, width: number, height: number): void {
    this.#zooming = false;
    this.#gliding = false;
    this.#flying = false;
    const end = this.#flyEnd;
    end.k = clampK(target.k);
    end.x = target.x;
    end.y = target.y;
    if (this.#reducedMotion || !(width > 0) || !(height > 0)) {
      this.#land(end);
      return;
    }

    // The path is planned in graph space: the centre of the screen and the width it spans.
    const view = this.#view;
    const size = Math.max(width, height);
    const halfW = width / 2;
    const halfH = height / 2;
    const ux0 = (halfW - view.x) / view.k;
    const uy0 = (halfH - view.y) / view.k;
    const w0 = size / view.k;
    const w1 = size / end.k;
    const dx = (halfW - end.x) / end.k - ux0;
    const dy = (halfH - end.y) / end.k - uy0;
    const travel = Math.hypot(dx, dy);
    // How far the centre moves at the closer zoom, and how far the screen's edge moves by zooming.
    const shift = travel * Math.max(view.k, end.k);
    const stretch = (Math.abs(end.k / view.k - 1) * size) / 2;
    if (shift < FLY_INVISIBLE_PX && stretch < FLY_INVISIBLE_PX) {
      this.#land(end);
      return;
    }
    const d1 = travel < 1e-6 * Math.min(w0, w1) ? 0 : travel;
    const rho2 = FLY_RHO * FLY_RHO;

    let pathS: number;
    let r0 = 0;
    if (d1 === 0) {
      // Nowhere to travel: a pure zoom, exponential in the width.
      pathS = Math.log(w1 / w0) / FLY_RHO;
    } else {
      // ln(√(b² + 1) − b) is −asinh(b), which stays accurate where the textbook form cancels.
      const b0 = (w1 * w1 - w0 * w0 + rho2 * rho2 * d1 * d1) / (2 * w0 * rho2 * d1);
      const b1 = (w1 * w1 - w0 * w0 - rho2 * rho2 * d1 * d1) / (2 * w1 * rho2 * d1);
      r0 = -Math.asinh(b0);
      pathS = (-Math.asinh(b1) - r0) / FLY_RHO;
    }
    if (!Number.isFinite(pathS) || Math.abs(pathS) < 1e-6) {
      this.#land(end);
      return;
    }

    this.#ux0 = ux0;
    this.#uy0 = uy0;
    this.#w0 = w0;
    this.#dx = dx;
    this.#dy = dy;
    this.#d1 = d1;
    this.#r0 = r0;
    this.#pathS = pathS;
    this.#size = size;
    this.#halfW = halfW;
    this.#halfH = halfH;
    this.#flyElapsed = 0;
    this.#flyDuration = Math.min(FLY_MAX_MS, Math.max(FLY_MIN_MS, Math.abs(pathS) * FLY_MS_PER_S));
    this.#flying = true;
  }

  /** Puts the view somewhere at once and stops every motion. */
  jumpTo(t: ViewTransform): void {
    this.stop();
    this.#land(t);
  }

  /** Stops every motion where it is. */
  stop(): void {
    this.#zooming = false;
    this.#gliding = false;
    this.#flying = false;
  }

  advance(dtMs: number): boolean {
    if (!(dtMs > 0)) {
      return this.isMoving;
    }
    if (this.#flying) {
      this.#advanceFlight(dtMs);
    }
    if (this.#zooming) {
      this.#advanceZoom(dtMs);
    }
    if (this.#gliding) {
      this.#advanceGlide(dtMs);
    }
    return this.isMoving;
  }

  /** Lands every motion where it was heading. */
  finish(): void {
    if (this.#flying) {
      this.#flying = false;
      this.#land(this.#flyEnd);
    }
    if (this.#zooming) {
      this.#zooming = false;
      this.#zoomAround(this.#zoomK, this.#zoomX, this.#zoomY);
    }
    if (this.#gliding) {
      const carry = this.#glideCarry();
      this.#gliding = false;
      this.#translate(this.#vx * carry, this.#vy * carry);
    }
  }

  /**
   * Shifts the view, and a running wheel zoom's screen point with it. Zooming around a fixed
   * screen point would stretch every pan made meanwhile by the zoom still to come; carried along,
   * the pan and the zoom commute, and the view comes to rest one pan away from the zoom alone.
   */
  #translate(dx: number, dy: number): void {
    this.#view.x += dx;
    this.#view.y += dy;
    if (this.#zooming) {
      this.#zoomX += dx;
      this.#zoomY += dy;
    }
  }

  #land(t: ViewTransform): void {
    this.#view.k = clampK(t.k);
    this.#view.x = t.x;
    this.#view.y = t.y;
  }

  /** Scales to k1 while the graph point under the screen point (px, py) stays put. */
  #zoomAround(k1: number, px: number, py: number): void {
    const view = this.#view;
    const ratio = k1 / view.k;
    view.x = px - (px - view.x) * ratio;
    view.y = py - (py - view.y) * ratio;
    view.k = k1;
  }

  #advanceZoom(dtMs: number): void {
    const from = Math.log(this.#view.k);
    const to = Math.log(this.#zoomK);
    // Exponential approach, exact for any frame length: the same share of the remaining way is
    // covered in the same time however the frames fall.
    const next = from + (to - from) * (1 - Math.exp(-dtMs / ZOOM_TAU_MS));
    if (Math.abs(to - next) < ZOOM_EPSILON) {
      this.#zooming = false;
      this.#zoomAround(this.#zoomK, this.#zoomX, this.#zoomY);
      return;
    }
    this.#zoomAround(Math.exp(next), this.#zoomX, this.#zoomY);
  }

  /** Multiplier on the current velocity that gives the distance still to glide. */
  #glideCarry(): number {
    const speed = Math.hypot(this.#vx, this.#vy);
    return speed > GLIDE_STOP_SPEED ? GLIDE_TAU_MS * (1 - GLIDE_STOP_SPEED / speed) : 0;
  }

  #advanceGlide(dtMs: number): void {
    // Velocity decays as e^(−t/τ); the distance of this step is its exact integral.
    const decay = Math.exp(-dtMs / GLIDE_TAU_MS);
    const travel = GLIDE_TAU_MS * (1 - decay);
    this.#translate(this.#vx * travel, this.#vy * travel);
    this.#vx *= decay;
    this.#vy *= decay;
    if (Math.hypot(this.#vx, this.#vy) < GLIDE_STOP_SPEED) {
      this.#gliding = false;
    }
  }

  #advanceFlight(dtMs: number): void {
    this.#flyElapsed += dtMs;
    const progress = this.#flyElapsed / this.#flyDuration;
    if (progress >= 1) {
      this.#flying = false;
      this.#land(this.#flyEnd);
      return;
    }
    // Eased along the path: van Wijk's parameter is already perceptually even, and the easing
    // adds a gentle start and stop on top.
    const s = easeInOutCubic(progress) * this.#pathS;
    let u: number;
    let w: number;
    if (this.#d1 === 0) {
      u = s / this.#pathS;
      w = this.#w0 * Math.exp(FLY_RHO * s);
    } else {
      const r = FLY_RHO * s + this.#r0;
      const coshR0 = Math.cosh(this.#r0);
      // van Wijk & Nuij's u(s), as a share of the travel so it can scale dx and dy.
      u =
        (this.#w0 / (FLY_RHO * FLY_RHO * this.#d1)) * (coshR0 * Math.tanh(r) - Math.sinh(this.#r0));
      w = (this.#w0 * coshR0) / Math.cosh(r);
    }
    const k = clampK(this.#size / w);
    const view = this.#view;
    view.k = k;
    view.x = this.#halfW - (this.#ux0 + u * this.#dx) * k;
    view.y = this.#halfH - (this.#uy0 + u * this.#dy) * k;
  }
}
