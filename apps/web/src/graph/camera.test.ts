import { describe, expect, it } from 'vitest';

import { Camera, clampK, K_MAX, K_MIN } from './camera.js';
import { toGraph, type ViewTransform } from './view.js';

/** Advances until the camera rests, at 60 fps; returns the milliseconds it took. */
function runOut(camera: Camera, frameMs = 16, limitMs = 10_000): number {
  let elapsed = 0;
  while (camera.advance(frameMs)) {
    elapsed += frameMs;
    if (elapsed > limitMs) {
      throw new Error('the camera never came to rest');
    }
  }
  return elapsed + frameMs;
}

function snapshot(camera: Camera): ViewTransform {
  return { ...camera.transform };
}

/** Scales to k1 while the graph point under the screen point (px, py) stays put. */
function zoomAround(t: ViewTransform, k1: number, px: number, py: number): ViewTransform {
  return { k: k1, x: px - (px - t.x) * (k1 / t.k), y: py - (py - t.y) * (k1 / t.k) };
}

/** Two cameras from one start, put through the same commands: one to run out, one to finish. */
function twins(start: ViewTransform, commands: (camera: Camera) => void): [Camera, Camera] {
  const run = new Camera(start);
  const finished = new Camera(start);
  commands(run);
  commands(finished);
  runOut(run);
  finished.finish();
  return [run, finished];
}

/** The graph point at the centre of a width × height screen. */
function centre(t: ViewTransform, width: number, height: number): [number, number] {
  return toGraph(t, width / 2, height / 2);
}

describe('clampK', () => {
  it('keeps the zoom inside its range and reads nonsense as 1', () => {
    expect(clampK(0.001)).toBe(K_MIN);
    expect(clampK(1000)).toBe(K_MAX);
    expect(clampK(2)).toBe(2);
    expect(clampK(Number.NaN)).toBe(1);
  });
});

describe('Camera', () => {
  it('starts where it is told, with the zoom clamped', () => {
    expect(snapshot(new Camera({ k: 2, x: 10, y: -4 }))).toEqual({ k: 2, x: 10, y: -4 });
    expect(new Camera({ k: 99, x: 0, y: 0 }).transform.k).toBe(K_MAX);
    expect(new Camera().isMoving).toBe(false);
  });

  it('updates one transform object in place instead of allocating per frame', () => {
    const camera = new Camera();
    const transform = camera.transform;
    camera.zoomBy(2, 50, 50);
    camera.advance(16);
    camera.panBy(3, 4);
    expect(camera.transform).toBe(transform);
  });

  describe('pan', () => {
    it('moves the view at once', () => {
      const camera = new Camera({ k: 1.5, x: 10, y: 20 });
      camera.panBy(5, -7);
      expect(snapshot(camera)).toEqual({ k: 1.5, x: 15, y: 13 });
      expect(camera.isMoving).toBe(false);
    });
  });

  describe('zoomBy', () => {
    it('eases towards the target zoom and lands on it exactly', () => {
      const camera = new Camera();
      camera.zoomBy(4, 0, 0);
      expect(camera.transform.k).toBe(1);
      expect(camera.isMoving).toBe(true);
      camera.advance(16);
      expect(camera.transform.k).toBeGreaterThan(1);
      expect(camera.transform.k).toBeLessThan(4);
      const took = runOut(camera);
      expect(camera.transform.k).toBe(4);
      expect(camera.isMoving).toBe(false);
      // A time constant of about a tenth of a second: done well within a second, not at once.
      expect(took).toBeGreaterThan(300);
      expect(took).toBeLessThan(1000);
    });

    it('eases in log scale, the same share of the remaining way per time constant', () => {
      const camera = new Camera();
      camera.zoomBy(Math.E, 0, 0);
      camera.advance(100);
      expect(Math.log(camera.transform.k)).toBeCloseTo(1 - Math.exp(-1), 9);
    });

    it('does not depend on how the time was cut into frames', () => {
      const whole = new Camera();
      const sliced = new Camera();
      whole.zoomBy(3, 200, 100);
      sliced.zoomBy(3, 200, 100);
      whole.advance(80);
      for (let frame = 0; frame < 8; frame += 1) {
        sliced.advance(10);
      }
      expect(sliced.transform.k).toBeCloseTo(whole.transform.k, 9);
      expect(sliced.transform.x).toBeCloseTo(whole.transform.x, 9);
    });

    it('keeps the graph point under the pointer in place on every frame', () => {
      const camera = new Camera({ k: 0.8, x: 40, y: -30 });
      const [gx, gy] = toGraph(camera.transform, 300, 200);
      camera.zoomBy(5, 300, 200);
      while (camera.advance(16)) {
        const [x, y] = toGraph(camera.transform, 300, 200);
        expect(x).toBeCloseTo(gx, 9);
        expect(y).toBeCloseTo(gy, 9);
      }
      const [x, y] = toGraph(camera.transform, 300, 200);
      expect(x).toBeCloseTo(gx, 9);
      expect(y).toBeCloseTo(gy, 9);
    });

    it('adds up wheel notches that arrive while it is still zooming', () => {
      const camera = new Camera();
      camera.zoomBy(2, 0, 0);
      camera.advance(16);
      camera.zoomBy(2, 0, 0);
      runOut(camera);
      expect(camera.transform.k).toBe(4);
    });

    it('finishes a zoom where it would have landed', () => {
      const [run, finished] = twins({ k: 1, x: 12, y: 8 }, (camera) => {
        camera.zoomBy(3, 120, 90);
        camera.advance(32);
      });
      expect(finished.transform.k).toBeCloseTo(run.transform.k, 9);
      expect(finished.transform.x).toBeCloseTo(run.transform.x, 9);
      expect(finished.transform.y).toBeCloseTo(run.transform.y, 9);
    });

    it('stays inside the zoom range', () => {
      const camera = new Camera();
      camera.zoomBy(1e6, 0, 0);
      camera.finish();
      expect(camera.transform.k).toBe(K_MAX);
      camera.zoomBy(1e-9, 0, 0);
      camera.finish();
      expect(camera.transform.k).toBe(K_MIN);
    });

    it('does nothing at the end of the range', () => {
      const camera = new Camera({ k: K_MAX, x: 5, y: 5 });
      camera.zoomBy(2, 100, 100);
      expect(camera.isMoving).toBe(false);
      expect(snapshot(camera)).toEqual({ k: K_MAX, x: 5, y: 5 });
    });

    it('ignores a factor that is not a positive number', () => {
      const camera = new Camera();
      for (const factor of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
        camera.zoomBy(factor, 10, 10);
      }
      expect(camera.isMoving).toBe(false);
      expect(snapshot(camera)).toEqual({ k: 1, x: 0, y: 0 });
    });

    it('lands at once when asked to, as a pinch wants', () => {
      const camera = new Camera({ k: 1, x: 30, y: 40 });
      camera.zoomBy(2, 100, 50, { immediate: true });
      expect(camera.isMoving).toBe(false);
      expect(snapshot(camera)).toEqual(zoomAround({ k: 1, x: 30, y: 40 }, 2, 100, 50));
    });

    it('carries on while the view is panned, landing exactly one pan away', () => {
      const camera = new Camera();
      camera.zoomBy(2, 100, 100);
      camera.advance(16);
      camera.panBy(10, 0);
      expect(camera.isMoving).toBe(true);
      runOut(camera);
      // The pan and the zoom commute: the rest of the zoom does not stretch the pan.
      const zoomed = zoomAround({ k: 1, x: 0, y: 0 }, 2, 100, 100);
      expect(camera.transform.k).toBe(2);
      expect(camera.transform.x).toBeCloseTo(zoomed.x + 10, 9);
      expect(camera.transform.y).toBeCloseTo(zoomed.y, 9);
    });

    it('finishes a glide let go during a zoom where it would have landed', () => {
      const [run, finished] = twins({ k: 1, x: 0, y: 0 }, (camera) => {
        camera.zoomBy(3, 500, 300);
        camera.advance(16);
        camera.release(1.5, -0.5);
      });
      expect(run.transform.k).toBe(3);
      expect(finished.transform.k).toBe(3);
      expect(finished.transform.x).toBeCloseTo(run.transform.x, 0);
      expect(finished.transform.y).toBeCloseTo(run.transform.y, 0);
    });
  });

  describe('release', () => {
    it('lets a slow release stop where it is', () => {
      const camera = new Camera();
      camera.release(0.05, 0.02);
      expect(camera.isMoving).toBe(false);
    });

    it('glides on after a flick, slows down and stops', () => {
      const camera = new Camera();
      camera.release(1, 0);
      expect(camera.isMoving).toBe(true);
      camera.advance(16);
      const first = camera.transform.x;
      camera.advance(16);
      const second = camera.transform.x - first;
      expect(first).toBeGreaterThan(0);
      expect(second).toBeLessThan(first); // friction
      runOut(camera);
      expect(camera.transform.y).toBe(0);
      // Exponential decay with a time constant of 320 ms: v·τ, less the tail cut off at rest.
      expect(camera.transform.x).toBeGreaterThan(290);
      expect(camera.transform.x).toBeLessThan(320);
    });

    it('finishes its glide where it would have come to rest', () => {
      const [run, finished] = twins({ k: 1, x: 0, y: 0 }, (camera) => {
        camera.release(-0.6, 0.8);
        camera.advance(16);
      });
      expect(finished.transform.x).toBeCloseTo(run.transform.x, 0);
      expect(finished.transform.y).toBeCloseTo(run.transform.y, 0);
    });

    it('caps a spike in the pointer velocity', () => {
      const camera = new Camera();
      camera.release(500, 0);
      runOut(camera);
      expect(camera.transform.x).toBeLessThanOrEqual(3 * 320);
    });

    it('stops gliding when the reader takes hold again', () => {
      const camera = new Camera();
      camera.release(2, 2);
      camera.advance(16);
      camera.panBy(0, 0);
      expect(camera.isMoving).toBe(false);
      camera.release(2, 2);
      camera.zoomBy(1.5, 0, 0);
      const before = snapshot(camera);
      runOut(camera);
      // Only the zoom is left: nothing carries the view on beyond it.
      const zoomed = zoomAround(before, 1.5, 0, 0);
      expect(camera.transform.x).toBeCloseTo(zoomed.x, 9);
      expect(camera.transform.y).toBeCloseTo(zoomed.y, 9);
    });

    it('ignores a velocity that is not a number', () => {
      const camera = new Camera();
      camera.release(Number.NaN, 1);
      expect(camera.isMoving).toBe(false);
    });
  });

  describe('flyTo', () => {
    const width = 1000;
    const height = 600;

    it('lands exactly on its target', () => {
      const camera = new Camera({ k: 1, x: 0, y: 0 });
      const target = { k: 2.5, x: -800, y: 300 };
      camera.flyTo(target, width, height);
      expect(camera.isMoving).toBe(true);
      runOut(camera);
      expect(snapshot(camera)).toEqual(target);
    });

    it('starts from where the camera is', () => {
      const camera = new Camera({ k: 1.2, x: 50, y: -20 });
      camera.flyTo({ k: 0.5, x: 400, y: 400 }, width, height);
      camera.advance(1);
      expect(camera.transform.k).toBeCloseTo(1.2, 3);
      expect(camera.transform.x).toBeCloseTo(50, 0);
      expect(camera.transform.y).toBeCloseTo(-20, 0);
    });

    it('takes between 400 and 1100 ms, longer for a longer journey', () => {
      const short = new Camera();
      short.flyTo({ k: 1.1, x: 10, y: 0 }, width, height);
      const shortMs = runOut(short, 1);
      const long = new Camera();
      long.flyTo({ k: 1, x: -40_000, y: 0 }, width, height);
      const longMs = runOut(long, 1);
      expect(shortMs).toBeGreaterThanOrEqual(400);
      expect(longMs).toBeLessThanOrEqual(1101);
      expect(longMs).toBeGreaterThan(shortMs);
    });

    it('pulls back while it travels far at one zoom', () => {
      const camera = new Camera({ k: 2, x: 0, y: 0 });
      camera.flyTo({ k: 2, x: -6000, y: 0 }, width, height);
      let lowest = camera.transform.k;
      while (camera.advance(16)) {
        lowest = Math.min(lowest, camera.transform.k);
      }
      expect(lowest).toBeLessThan(1);
      expect(camera.transform.k).toBe(2);
    });

    it('keeps the centre of the screen on one graph point when it only zooms', () => {
      const start = { k: 1, x: 200, y: 100 };
      const camera = new Camera(start);
      const [cx, cy] = centre(start, width, height);
      camera.flyTo(zoomAround(start, 6, width / 2, height / 2), width, height);
      let previousK = camera.transform.k;
      while (camera.advance(16)) {
        const [x, y] = centre(camera.transform, width, height);
        expect(x).toBeCloseTo(cx, 6);
        expect(y).toBeCloseTo(cy, 6);
        expect(camera.transform.k).toBeGreaterThanOrEqual(previousK);
        previousK = camera.transform.k;
      }
      expect(camera.transform.k).toBe(6);
    });

    it('moves the centre along the straight line between the two centres', () => {
      const camera = new Camera({ k: 1, x: 0, y: 0 });
      const target = { k: 1.5, x: -900, y: -600 };
      const [x0, y0] = centre(camera.transform, width, height);
      const [x1, y1] = centre(target, width, height);
      camera.flyTo(target, width, height);
      for (let frame = 0; frame < 20; frame += 1) {
        camera.advance(16);
        const [x, y] = centre(camera.transform, width, height);
        const cross = (x - x0) * (y1 - y0) - (y - y0) * (x1 - x0);
        expect(Math.abs(cross)).toBeLessThan(1e-6 * Math.hypot(x1 - x0, y1 - y0) ** 2);
      }
    });

    it('does not move for a target it is already at', () => {
      const camera = new Camera({ k: 1, x: 3, y: 4 });
      camera.flyTo({ k: 1, x: 3, y: 4 }, width, height);
      expect(camera.isMoving).toBe(false);
    });

    it('makes a journey too short to see at once instead of spending frames on it', () => {
      const camera = new Camera({ k: 2, x: 100, y: 50 });
      camera.flyTo({ k: 2.0005, x: 100.2, y: 49.9 }, width, height);
      expect(camera.isMoving).toBe(false);
      expect(snapshot(camera)).toEqual({ k: 2.0005, x: 100.2, y: 49.9 });
      // A screen pixel of travel is a flight.
      camera.flyTo({ k: 2.0005, x: 101, y: 49.9 }, width, height);
      expect(camera.isMoving).toBe(true);
    });

    it('jumps when it does not know the screen yet', () => {
      const camera = new Camera();
      camera.flyTo({ k: 3, x: 1, y: 2 }, 0, 0);
      expect(camera.isMoving).toBe(false);
      expect(snapshot(camera)).toEqual({ k: 3, x: 1, y: 2 });
    });

    it('clamps the zoom of its target', () => {
      const camera = new Camera();
      camera.flyTo({ k: 500, x: 0, y: 0 }, width, height);
      runOut(camera);
      expect(camera.transform.k).toBe(K_MAX);
    });

    it('can be stopped where it is, finished, or interrupted', () => {
      const stopped = new Camera();
      stopped.flyTo({ k: 2, x: -500, y: 0 }, width, height);
      stopped.advance(200);
      const midway = snapshot(stopped);
      stopped.stop();
      expect(stopped.isMoving).toBe(false);
      expect(snapshot(stopped)).toEqual(midway);

      const finished = new Camera();
      finished.flyTo({ k: 2, x: -500, y: 0 }, width, height);
      finished.advance(200);
      finished.finish();
      expect(snapshot(finished)).toEqual({ k: 2, x: -500, y: 0 });

      const grabbed = new Camera();
      grabbed.flyTo({ k: 2, x: -500, y: 0 }, width, height);
      grabbed.advance(200);
      grabbed.panBy(1, 1);
      expect(grabbed.isMoving).toBe(false);

      const wheeled = new Camera();
      wheeled.flyTo({ k: 2, x: -500, y: 0 }, width, height);
      wheeled.advance(200);
      const midwayK = wheeled.transform.k;
      wheeled.zoomBy(1.2, 0, 0);
      wheeled.finish();
      expect(wheeled.transform.k).toBeCloseTo(midwayK * 1.2, 9);
    });

    it('stops a running zoom', () => {
      const camera = new Camera();
      camera.zoomBy(8, 0, 0);
      camera.flyTo({ k: 0.5, x: 10, y: 10 }, width, height);
      runOut(camera);
      expect(snapshot(camera)).toEqual({ k: 0.5, x: 10, y: 10 });
    });
  });

  describe('jumpTo, stop and finish', () => {
    it('jumps and stops whatever was under way', () => {
      const camera = new Camera();
      camera.zoomBy(3, 0, 0);
      camera.jumpTo({ k: 0.2, x: 7, y: 9 });
      expect(camera.isMoving).toBe(false);
      expect(snapshot(camera)).toEqual({ k: 0.2, x: 7, y: 9 });
    });

    it('copies the transform it is given rather than keeping it', () => {
      const camera = new Camera();
      const given = { k: 2, x: 1, y: 1 };
      camera.jumpTo(given);
      camera.panBy(10, 10);
      expect(given).toEqual({ k: 2, x: 1, y: 1 });
    });

    it('ignores a frame of no time', () => {
      const camera = new Camera();
      camera.zoomBy(2, 0, 0);
      expect(camera.advance(0)).toBe(true);
      expect(camera.advance(-16)).toBe(true);
      expect(camera.transform.k).toBe(1);
    });
  });

  describe('reduced motion', () => {
    it('lands every command at once', () => {
      const camera = new Camera();
      camera.setReducedMotion(true);
      camera.zoomBy(2, 100, 100);
      expect(camera.isMoving).toBe(false);
      expect(camera.transform.k).toBe(2);
      camera.flyTo({ k: 1, x: -300, y: 0 }, 800, 600);
      expect(camera.isMoving).toBe(false);
      expect(snapshot(camera)).toEqual({ k: 1, x: -300, y: 0 });
    });

    it('does not glide at all rather than jump to where a glide would end', () => {
      const camera = new Camera();
      camera.setReducedMotion(true);
      camera.release(2, 0);
      expect(camera.isMoving).toBe(false);
      expect(camera.transform.x).toBe(0);
    });

    it('stops a glide under way where it is when it is switched on', () => {
      const camera = new Camera();
      camera.release(2, 0);
      camera.advance(16);
      const x = camera.transform.x;
      camera.setReducedMotion(true);
      expect(camera.isMoving).toBe(false);
      expect(camera.transform.x).toBe(x);
    });

    it('lands a flight under way when it is switched on', () => {
      const camera = new Camera();
      camera.flyTo({ k: 2, x: -100, y: -100 }, 800, 600);
      camera.advance(50);
      camera.setReducedMotion(true);
      expect(camera.isMoving).toBe(false);
      expect(snapshot(camera)).toEqual({ k: 2, x: -100, y: -100 });
    });
  });
});
