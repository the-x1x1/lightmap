import { describe, expect, it } from 'vitest';
import {
  WALK_MPS,
  WALK_TICK_MS,
  walkStep,
  wheelZoomFactor,
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
