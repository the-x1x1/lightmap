/**
 * Web Worker for the reverse-planning solver: a three-year moon search is a few hundred thousand
 * ephemeris evaluations, which would freeze the timeline if run on the main thread. Pure input in,
 * plain result out (Dates travel as ISO strings).
 */
import { findDirectionMatches } from '@lightmap/astronomy';
import type { SolverRequest, SolverResponse } from './solver-types.ts';

self.onmessage = (e: MessageEvent<SolverRequest>) => {
  const { id, input } = e.data;
  try {
    const r = findDirectionMatches(input);
    const res: SolverResponse = {
      id,
      ok: true,
      result: {
        scannedDays: r.scannedDays,
        truncated: r.truncated,
        matches: r.matches.map((m) => ({ ...m, timestampUtc: m.timestampUtc.toISOString() })),
        alignmentCount: r.alignments.length,
      },
    };
    self.postMessage(res);
  } catch (err) {
    const res: SolverResponse = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : 'Search failed.',
    };
    self.postMessage(res);
  }
};
