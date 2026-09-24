'use client';
/**
 * Runs the reverse-planning solver off the main thread when Web Workers are available (they are
 * in every supported browser; the fallback keeps tests and odd embeds working). One worker per
 * hook instance; a new request supersedes an in-flight one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { findDirectionMatches, type SolverInput } from '@lightmap/astronomy';
import type { SolverRequest, SolverResponse, SolverResultDto } from './solver-types.ts';

export interface SolverRun {
  result: SolverResultDto;
  ms: number;
}

export function useSolver() {
  const worker = useRef<Worker | null>(null);
  const pending = useRef<{ id: number; resolve: (r: SolverResponse) => void } | null>(null);
  const nextId = useRef(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof Worker === 'undefined') return;
    try {
      // `new URL(..., import.meta.url)` is what Next.js bundles into a same-origin worker chunk.
      const w = new Worker(new URL('./solver.worker.ts', import.meta.url));
      w.onmessage = (e: MessageEvent<SolverResponse>) => {
        if (pending.current && pending.current.id === e.data.id) {
          pending.current.resolve(e.data);
          pending.current = null;
          setBusy(false);
        }
      };
      w.onerror = () => {
        // Worker failed to load (e.g. a strict embed): fall back to the main thread from now on.
        w.terminate();
        worker.current = null;
        if (pending.current) {
          pending.current.resolve({ id: pending.current.id, ok: false, error: 'worker-failed' });
          pending.current = null;
          setBusy(false);
        }
      };
      worker.current = w;
    } catch {
      worker.current = null;
    }
    return () => {
      worker.current?.terminate();
      worker.current = null;
    };
  }, []);

  const runSync = (input: SolverInput): SolverRun => {
    const t0 = performance.now();
    const r = findDirectionMatches(input);
    return {
      ms: performance.now() - t0,
      result: {
        scannedDays: r.scannedDays,
        truncated: r.truncated,
        matches: r.matches.map((m) => ({ ...m, timestampUtc: m.timestampUtc.toISOString() })),
        alignmentCount: r.alignments.length,
      },
    };
  };

  const run = useCallback(async (input: SolverInput): Promise<SolverRun> => {
    const w = worker.current;
    if (!w) return runSync(input);
    const id = nextId.current++;
    setBusy(true);
    const t0 = performance.now();
    const res = await new Promise<SolverResponse>((resolve) => {
      // A newer request supersedes an in-flight one: settle the old promise so its caller returns.
      pending.current?.resolve({ id: pending.current.id, ok: false, error: 'superseded' });
      pending.current = { id, resolve };
      const req: SolverRequest = { id, input };
      w.postMessage(req);
    });
    if (!res.ok) {
      if (res.error === 'worker-failed') return runSync(input);
      throw new Error(res.error);
    }
    return { result: res.result, ms: performance.now() - t0 };
  }, []);

  return { run, busy };
}
