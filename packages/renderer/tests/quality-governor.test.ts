import { describe, expect, it } from 'vitest';
import { QUALITY_LADDER, QualityGovernor, ladderIsMonotone } from '../src/quality-governor.ts';

describe('QualityGovernor (ported from WorldView PerformanceGovernor)', () => {
  it('ladder is monotone', () => {
    expect(ladderIsMonotone()).toBe(true);
    expect(ladderIsMonotone([QUALITY_LADDER[1]!, QUALITY_LADDER[0]!])).toBe(false);
  });
  it('starts one below the top and steps down after two slow seconds', () => {
    const g = new QualityGovernor();
    expect(g.rungIndex).toBe(1);
    expect(g.sample({ fps: 15 })).toBe(false);
    expect(g.sample({ fps: 15 })).toBe(true);
    expect(g.rungIndex).toBe(2);
    expect(g.quality.label).toBe('Balanced');
  });
  it('climbs slowly, with a growing penalty after failing a rung', () => {
    const g = new QualityGovernor({ fastSamples: 3, climbPenalty: 2 });
    // fall to rung 2
    g.sample({ fps: 10 });
    g.sample({ fps: 10 });
    expect(g.rungIndex).toBe(2);
    // climb back needs 3 + 2×1 failures at rung 1 = 5 fast samples
    for (let i = 0; i < 4; i++) expect(g.sample({ fps: 60 })).toBe(false);
    expect(g.sample({ fps: 60 })).toBe(true);
    expect(g.rungIndex).toBe(1);
    // rung 0 has never failed: 3 fast samples
    g.sample({ fps: 60 });
    g.sample({ fps: 60 });
    expect(g.sample({ fps: 60 })).toBe(true);
    expect(g.rungIndex).toBe(0);
    expect(g.sample({ fps: 60 })).toBe(false); // can't go above the top
  });
  it('the dead band resets both runs', () => {
    const g = new QualityGovernor();
    g.sample({ fps: 10 });
    g.sample({ fps: 35 });
    expect(g.sample({ fps: 10 })).toBe(false);
  });
  it('ignores garbage, respects the ceiling and the bottom', () => {
    const g = new QualityGovernor({ ceilingRung: 2 });
    expect(g.rungIndex).toBe(2);
    expect(g.sample({ fps: Number.NaN })).toBe(false);
    for (let i = 0; i < 20; i++) g.sample({ fps: 60 });
    expect(g.rungIndex).toBe(2);
    for (let i = 0; i < 20; i++) g.sample({ fps: 5 });
    expect(g.rungIndex).toBe(QUALITY_LADDER.length - 1);
    expect(g.quality.shadows).toBe(false);
    g.resetRuns();
    expect(g.lastMeasuredFps).toBeNull();
  });
  it('rejects a bad configuration', () => {
    expect(() => new QualityGovernor({ floorFps: 50, targetFps: 40 })).toThrow();
    expect(() => new QualityGovernor({ ladder: [] })).toThrow();
  });
});
