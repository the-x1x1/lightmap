import { describe, expect, it } from 'vitest';
import {
  FOV_MAX_DEG,
  FOV_MIN_DEG,
  WALK_MPS,
  WALK_TICK_MS,
  easeFovToward,
  walkStep,
  wheelZoomFactor,
  wheelZoomGoal,
} from '../../features/map/view-input.ts';

describe('the viewpoint walk', () => {
  const step = WALK_MPS * (WALK_TICK_MS / 1000);
  it('walks forward, back and sideways by the held keys, five times as far running', () => {
    expect(walkStep(new Set(['KeyW']), false)).toEqual({ forwardM: step, rightM: 0 });
    expect(walkStep(new Set(['KeyS']), true)!.forwardM).toBeCloseTo(-5 * step, 9);
    expect(walkStep(new Set(['KeyA']), false)).toEqual({ forwardM: 0, rightM: -step });
  });

  it('goes diagonally at the same speed, and not at all when keys cancel', () => {
    const d = walkStep(new Set(['KeyW', 'KeyD']), false)!;
    expect(Math.hypot(d.forwardM, d.rightM)).toBeCloseTo(step, 9);
    expect(walkStep(new Set(['KeyW', 'KeyS']), false)).toBeNull();
    expect(walkStep(new Set(), false)).toBeNull();
  });
});

describe('the wheel zoom', () => {
  it('zooms by how far it scrolled: a mouse notch ~8 %, a trackpad nudge a little', () => {
    expect(wheelZoomFactor({ deltaY: 100, deltaMode: 0 })).toBeCloseTo(1.083, 3);
    expect(wheelZoomFactor({ deltaY: -100, deltaMode: 0 })).toBeCloseTo(1 / 1.083, 3);
    expect(wheelZoomFactor({ deltaY: 3, deltaMode: 0 })).toBeCloseTo(1.0024, 4);
    expect(wheelZoomFactor({ deltaY: 0, deltaMode: 0 })).toBe(1);
  });

  it('counts a macOS wheel notch (4.000244140625 px) as a full notch, lines and pages too', () => {
    expect(wheelZoomFactor({ deltaY: 4.000244140625, deltaMode: 0 })).toBeCloseTo(1.083, 3);
    expect(wheelZoomFactor({ deltaY: 3, deltaMode: 1 })).toBeCloseTo(Math.exp(99 * 0.0008), 9);
    // Never more than 30 % an event.
    expect(wheelZoomFactor({ deltaY: 2, deltaMode: 2 })).toBeCloseTo(Math.exp(0.3), 9);
  });
});

describe('easeFovToward', () => {
  it('moves part of the way each frame, in ratio, and lands on the goal', () => {
    const a = easeFovToward(60, 40, 16);
    expect(a.done).toBe(false);
    expect(a.fovDeg).toBeLessThan(60);
    expect(a.fovDeg).toBeGreaterThan(40);
    // The same ratio takes the same time at any focal length.
    const b = easeFovToward(30, 20, 16);
    expect(a.fovDeg / 40).toBeCloseTo(b.fovDeg / 20, 10);
    let f = 60;
    let frames = 0;
    for (let done = false; !done && frames < 100; frames++) {
      const s = easeFovToward(f, 40, 16);
      f = s.fovDeg;
      done = s.done;
    }
    expect(f).toBe(40);
    expect(frames).toBeLessThan(30);
  });

  it('clamps the goal to the lens limits and lands on bad input', () => {
    expect(easeFovToward(10, 1, 1000).fovDeg).toBe(FOV_MIN_DEG);
    expect(easeFovToward(Number.NaN, 50, 16)).toEqual({ fovDeg: 50, done: true });
  });

  it('a wheel event zooms from the goal under way, not the eased value', () => {
    const notch = { deltaY: -100, deltaMode: 0 };
    const g1 = wheelZoomGoal(60, null, notch);
    const g2 = wheelZoomGoal(58, g1, notch);
    expect(g2).toBeCloseTo(60 * wheelZoomFactor(notch) ** 2, 10);
    expect(wheelZoomGoal(119, null, { deltaY: 1000, deltaMode: 0 })).toBe(FOV_MAX_DEG);
  });
});
