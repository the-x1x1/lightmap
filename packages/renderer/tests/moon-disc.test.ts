import { describe, expect, it } from 'vitest';
import {
  drawMoonPhase,
  moonBrightnessVsFull,
  moonDiscOpacity,
  moonDiscTint,
  directLightTint,
  discTint,
  moonGlowStrength,
  terminatorHalfWidth,
  type PhaseContext,
} from '../src/moon-disc.ts';

function recorder() {
  const calls: { op: string; args: unknown[] }[] = [];
  const ctx = new Proxy(
    { fillStyle: '' },
    {
      get: (t, k) =>
        k === 'fillStyle'
          ? t.fillStyle
          : (...args: unknown[]) => calls.push({ op: String(k), args }),
      set: (t, k, v) => {
        if (k === 'fillStyle') t.fillStyle = v as string;
        return true;
      },
    },
  ) as unknown as PhaseContext;
  return { ctx, calls };
}

describe('the Moon disc', () => {
  it('narrows the terminator to a straight line at the quarters', () => {
    expect(terminatorHalfWidth(0)).toBe(1);
    expect(terminatorHalfWidth(0.5)).toBe(0);
    expect(terminatorHalfWidth(1)).toBe(1);
    expect(terminatorHalfWidth(0.25)).toBeCloseTo(0.5, 9);
  });

  it('bulges the terminator right for a crescent and left for a gibbous Moon', () => {
    const crescent = recorder();
    drawMoonPhase(crescent.ctx, 64, 0.2);
    const e1 = crescent.calls.find((c) => c.op === 'ellipse')!;
    expect(e1.args[7]).toBe(true); // counter-clockwise from the bottom: through the right half
    const gibbous = recorder();
    drawMoonPhase(gibbous.ctx, 64, 0.8);
    expect(gibbous.calls.find((c) => c.op === 'ellipse')!.args[7]).toBe(false);
  });

  it('draws only earthshine at new Moon', () => {
    const r = recorder();
    drawMoonPhase(r.ctx, 64, 0);
    expect(r.calls.filter((c) => c.op === 'fill')).toHaveLength(1);
  });

  it('is pale by day and full at night', () => {
    expect(moonDiscOpacity(30)).toBe(0.55);
    expect(moonDiscOpacity(-6)).toBeCloseTo(0.775, 9);
    expect(moonDiscOpacity(-20)).toBe(1);
  });
});

describe('the Moon glow', () => {
  it('a quarter Moon is about a tenth of a full one, a thin crescent far less', () => {
    expect(moonBrightnessVsFull(1)).toBeCloseTo(1, 6);
    const quarter = moonBrightnessVsFull(0.5);
    expect(quarter).toBeGreaterThan(0.07);
    expect(quarter).toBeLessThan(0.13);
    expect(moonBrightnessVsFull(0.1)).toBeLessThan(0.02);
  });

  it('glows only in a dark enough sky', () => {
    expect(moonGlowStrength(1, 5)).toBe(0);
    expect(moonGlowStrength(1, -2)).toBe(0);
    expect(moonGlowStrength(1, -6)).toBeGreaterThan(0.3);
    expect(moonGlowStrength(1, -6)).toBeLessThan(0.7);
    expect(moonGlowStrength(1, -20)).toBeCloseTo(1, 6);
  });

  it('a low Moon lights little of the sky (the air dims it), fading to nothing at the horizon', () => {
    expect(moonGlowStrength(1, -20, 60)).toBeGreaterThan(0.95);
    expect(moonGlowStrength(1, -20, 5)).toBeLessThan(0.5);
    expect(moonGlowStrength(1, -20, 0)).toBeLessThan(0.001);
  });
});

describe('moonDiscTint', () => {
  it('is white and full high up, orange and dimmer low down, never black', () => {
    const high = moonDiscTint(60);
    expect(high[0]).toBeGreaterThan(0.95);
    expect(high[2] / high[0]).toBeGreaterThan(0.98);
    const low = moonDiscTint(2);
    expect(low[0]).toBeGreaterThan(low[1]);
    expect(low[1]).toBeGreaterThan(low[2]);
    expect(Math.max(...low)).toBeCloseTo(0.55, 2);
    const mid = moonDiscTint(25);
    expect(mid[2] / mid[0]).toBeGreaterThan(low[2] / low[0]);
    expect(Math.max(...mid)).toBeGreaterThan(0.55);
  });
});

describe('directLightTint', () => {
  it('is white high up and orange on the horizon, brightest channel 1', () => {
    const noon = directLightTint(50);
    expect(Math.min(...noon)).toBeGreaterThan(0.97);
    const set = directLightTint(0);
    expect(Math.max(...set)).toBeCloseTo(1, 6);
    expect(set[2]).toBeLessThan(0.6);
    expect(set[1]).toBeLessThan(0.85);
  });
});

describe('discTint', () => {
  it('is deeper than the light it gives near the horizon, the same from 6 deg up', () => {
    const d = discTint(0);
    expect(d[0]).toBeCloseTo(1, 6);
    expect(d[1]).toBeGreaterThan(0.4);
    expect(d[1]).toBeLessThan(0.6);
    expect(d[2]).toBeLessThan(0.25);
    expect(discTint(10)).toEqual(directLightTint(10));
  });
});
