import { describe, expect, it } from 'vitest';
import { markerLabels } from '@/features/planner/marker-labels';

// Kailua in October: dawn 06:01, sunrise 06:23, golden ends 06:53, noon 12:18, golden 17:45,
// sunset 18:14, dusk 18:36, night 19:29, moonrise 01:43, moonset 15:12.
const kailua = [
  { key: 'moonrise', minutes: 103, short: 'Moon ↑', priority: 2 },
  { key: 'nightEnd', minutes: 300, short: 'Night', priority: 2 },
  { key: 'dawn', minutes: 361, short: 'Dawn' },
  { key: 'sunrise', minutes: 383, short: 'Rise', priority: 3 },
  { key: 'goldenEnd', minutes: 413, short: 'Golden' },
  { key: 'noon', minutes: 738, short: 'Noon', priority: 2 },
  { key: 'moonset', minutes: 912, short: 'Moon ↓', priority: 2 },
  { key: 'goldenStart', minutes: 1065, short: 'Golden' },
  { key: 'sunset', minutes: 1094, short: 'Set', priority: 3 },
  { key: 'dusk', minutes: 1116, short: 'Dusk' },
  { key: 'nightStart', minutes: 1169, short: 'Night', priority: 2 },
];

describe('timeline marker labels', () => {
  it('shows glyphs only until the track has been measured', () => {
    expect(markerLabels(kailua, 1440, 0).every((l) => l.mode === 'glyph' && l.row === 0)).toBe(
      true,
    );
  });

  it('in a 340 px panel sunrise and sunset keep their words; their neighbours yield', () => {
    const byKey = Object.fromEntries(markerLabels(kailua, 1440, 340).map((l) => [l.key, l]));
    expect(byKey['sunrise']?.mode).toBe('word');
    expect(byKey['sunset']?.mode).toBe('word');
    expect(byKey['moonrise']?.mode).toBe('word');
    expect(byKey['noon']?.mode).toBe('word');
    expect(byKey['moonset']?.mode).toBe('word');
    // "Night" ends 4 px before "Rise" begins: a glyph one row down; dawn, 5 px left of sunrise,
    // has no room on either row and keeps only its tick.
    expect(byKey['nightEnd']).toMatchObject({ mode: 'glyph', row: 1 });
    expect(byKey['dawn']?.mode).toBe('tick');
    expect(byKey['goldenEnd']).toMatchObject({ mode: 'glyph', row: 1 });
    expect(byKey['goldenStart']).toMatchObject({ mode: 'glyph', row: 1 });
    expect(byKey['dusk']?.mode).toBe('tick');
    expect(byKey['nightStart']).toMatchObject({ mode: 'glyph', row: 1 });
  });

  it('a wide track gives every marker its word', () => {
    expect(markerLabels(kailua, 1440, 4000).every((l) => l.mode === 'word')).toBe(true);
  });

  it('never lets two labels on one row overlap, and falls back to a bare tick', () => {
    const dense = Array.from({ length: 8 }, (_, i) => ({
      key: `m${i}`,
      minutes: 600 + i * 4,
      short: 'Label',
    }));
    const labels = markerLabels(dense, 1440, 340);
    // Centres are 0.94 px apart: one word, one glyph on the second row, ticks for the rest.
    expect(labels.filter((l) => l.mode === 'word')).toHaveLength(1);
    expect(labels.filter((l) => l.mode === 'glyph')).toEqual([
      { key: 'm1', mode: 'glyph', row: 1 },
    ]);
    expect(labels.filter((l) => l.mode === 'tick')).toHaveLength(6);
  });

  it('importance decides who keeps the word when two markers want the same pixels', () => {
    const pair = [
      { key: 'dawn', minutes: 360, short: 'Dawn' },
      { key: 'sunrise', minutes: 370, short: 'Rise', priority: 3 },
    ];
    const byKey = Object.fromEntries(markerLabels(pair, 1440, 340).map((l) => [l.key, l.mode]));
    expect(byKey).toEqual({ dawn: 'glyph', sunrise: 'word' });
  });

  it('keeps the input order out of it: labels come back sorted by minute', () => {
    const keys = markerLabels(kailua, 1440, 340).map((l) => l.key);
    expect(keys[0]).toBe('moonrise');
    expect(keys.at(-1)).toBe('nightStart');
  });
});
