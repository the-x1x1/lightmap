import { describe, expect, it } from 'vitest';
import { FrameBudgetQueue } from '../src/frame-budget.ts';

describe('work spread over frames', () => {
  it('runs as many jobs per frame as fit the budget, at least one, in order', async () => {
    let t = 0;
    const frames: (() => void)[] = [];
    const q = new FrameBudgetQueue({ budgetMs: 6, now: () => t, onFrame: (cb) => frames.push(cb) });
    const order: number[] = [];
    const done = [1, 2, 3, 4, 5].map((i) =>
      q.run(() => {
        order.push(i);
        t += 4; // each job takes 4 ms
        return i * 10;
      }),
    );
    expect(frames).toHaveLength(1); // one frame asked for, however many jobs
    expect(order).toEqual([]);
    frames.shift()!(); // 0, 4 ms: two jobs (the second starts inside the budget)
    expect(order).toEqual([1, 2]);
    expect(q.pending).toBe(3);
    frames.shift()!();
    expect(order).toEqual([1, 2, 3, 4]);
    frames.shift()!();
    expect(order).toEqual([1, 2, 3, 4, 5]);
    expect(frames).toHaveLength(0);
    expect(await Promise.all(done)).toEqual([10, 20, 30, 40, 50]);
  });

  it('a slow job still runs alone, and a failing one rejects without stopping the rest', async () => {
    let t = 0;
    const frames: (() => void)[] = [];
    const q = new FrameBudgetQueue({ budgetMs: 6, now: () => t, onFrame: (cb) => frames.push(cb) });
    const bad = q.run(() => {
      t += 50;
      throw new Error('tile unreadable');
    });
    const good = q.run(() => 'ok');
    frames.shift()!();
    const error = await bad.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error instanceof Error).toBe(true);
    expect((error as Error).message).toBe('tile unreadable');
    frames.shift()!();
    expect(await good).toBe('ok');
  });
});
