import { describe, expect, it } from 'vitest';
import { StepGlide, lerpVec3, nlerpDir } from '../src/step-glide.ts';

const num = () => new StepGlide<number>((a, b, t) => a + (b - a) * t);

describe('StepGlide', () => {
  it('lands at once outside a clock step', () => {
    const g = num();
    expect(g.shown).toBe(null);
    g.set(5, null);
    expect(g.shown).toBe(5);
    g.set(9, null);
    expect(g.shown).toBe(9);
    expect(g.gliding).toBe(false);
  });

  it('lands the first value even during a step (nothing shown to glide from)', () => {
    const g = num();
    g.set(3, 1);
    expect(g.shown).toBe(3);
    expect(g.gliding).toBe(false);
  });

  it('glides a step from what is shown at the clock fraction', () => {
    const g = num();
    g.set(0, null);
    g.set(10, 1);
    expect(g.shown).toBe(0);
    g.step(0.25);
    expect(g.shown).toBeCloseTo(2.5);
    g.step(1);
    expect(g.shown).toBe(10);
    expect(g.gliding).toBe(false);
  });

  it('a new step starts from mid-glide, not from the old start', () => {
    const g = num();
    g.set(0, null);
    g.set(10, 1);
    g.step(0.5);
    g.set(20, 2);
    g.step(0);
    expect(g.shown).toBeCloseTo(5);
    g.step(0.5);
    expect(g.shown).toBeCloseTo(12.5);
  });

  it('the same step re-applied moves only its end', () => {
    const g = num();
    g.set(0, null);
    g.set(10, 1);
    g.step(0.5);
    g.set(12, 1);
    g.step(0.5);
    expect(g.shown).toBeCloseTo(6);
  });

  it('a jump mid-glide lands and ends the step', () => {
    const g = num();
    g.set(0, null);
    g.set(10, 1);
    g.step(0.3);
    g.set(100, null);
    expect(g.shown).toBe(100);
    g.step(0.9);
    expect(g.shown).toBe(100);
  });

  it('a step after one has landed glides again from the landed value', () => {
    const g = num();
    g.set(0, null);
    g.set(10, 1);
    g.step(1);
    g.set(20, 1);
    g.step(0.5);
    expect(g.shown).toBeCloseTo(15);
  });
});

describe('vector blends', () => {
  it('lerps points and renormalises directions', () => {
    expect(lerpVec3({ x: 0, y: 0, z: 0 }, { x: 2, y: 4, z: 6 }, 0.5)).toEqual({ x: 1, y: 2, z: 3 });
    const d = nlerpDir({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 0.5);
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1);
    expect(d.x).toBeCloseTo(Math.SQRT1_2);
  });
});
