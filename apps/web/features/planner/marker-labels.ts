/**
 * Which timeline markers get a word and which a glyph, from the track's real width (plan §4: the
 * markers must read at a glance, on a phone and in a narrow panel). Dawn, sunrise and the end
 * of golden hour sit within an hour of each other — a few per cent of the day — so their words
 * collide at any realistic width. Markers are placed in order of importance (sunrise and sunset
 * first): each takes its word when the word clears everything already on the row, else its
 * glyph on the first row with room, else the tick mark alone (the title still names it). Pure.
 */

export interface LabelledMarker {
  key: string;
  minutes: number;
  short: string;
  /** Higher wins the space: 3 sunrise/sunset, 2 noon, night, Moon, 1 dawn, dusk, golden, ridge. */
  priority?: number;
}

export interface MarkerLabel {
  key: string;
  /** The word, the glyph, or — when even a glyph would touch both rows — the tick mark alone. */
  mode: 'word' | 'glyph' | 'tick';
  /** 0 on the track's own row; 1 one row down, for a glyph that would touch its neighbour. */
  row: 0 | 1;
}

/** Roughly what a 10 px label costs per character; the gap two labels need between them. */
const PX_PER_CHAR = 6;
const GAP_PX = 6;
/** Half the width a single glyph occupies. */
const GLYPH_HALF_PX = 7;

type Span = [left: number, right: number];

function clear(spans: readonly Span[], left: number, right: number): boolean {
  return spans.every(([l, r]) => right + GAP_PX <= l || left >= r + GAP_PX);
}

export function markerLabels(
  markers: readonly LabelledMarker[],
  totalMinutes: number,
  trackWidthPx: number,
): MarkerLabel[] {
  const byTime = [...markers].sort((a, b) => a.minutes - b.minutes);
  if (!(trackWidthPx > 0) || !(totalMinutes > 0)) {
    // Nothing measured yet: glyphs on one row, so the first paint never shows colliding words.
    return byTime.map((m) => ({ key: m.key, mode: 'glyph', row: 0 }));
  }
  const rows: [Span[], Span[]] = [[], []];
  const placed = new Map<string, MarkerLabel>();
  const byPriority = [...byTime].sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1));
  for (const m of byPriority) {
    const centre = (m.minutes / totalMinutes) * trackWidthPx;
    const wordHalf = (m.short.length * PX_PER_CHAR) / 2;
    if (clear(rows[0], centre - wordHalf, centre + wordHalf)) {
      rows[0].push([centre - wordHalf, centre + wordHalf]);
      placed.set(m.key, { key: m.key, mode: 'word', row: 0 });
      continue;
    }
    const row = ([0, 1] as const).find((r) =>
      clear(rows[r], centre - GLYPH_HALF_PX, centre + GLYPH_HALF_PX),
    );
    if (row === undefined) {
      placed.set(m.key, { key: m.key, mode: 'tick', row: 0 });
      continue;
    }
    rows[row].push([centre - GLYPH_HALF_PX, centre + GLYPH_HALF_PX]);
    placed.set(m.key, { key: m.key, mode: 'glyph', row });
  }
  return byTime.map((m) => placed.get(m.key)!);
}
