/**
 * Main-thread work spread over frames: jobs run in order, as many per frame as fit in a budget
 * (at least one), the rest the frame after. Imagery tiles arrive in bursts of dozens while the
 * camera moves, and recolouring each for the season costs a few milliseconds; run as they
 * arrive, a burst took a frame of a hundred milliseconds or more.
 *
 * Pure apart from the clock and the frame callback, both injectable for tests.
 */
export interface FrameBudgetOptions {
  /** Milliseconds of jobs per frame. */
  budgetMs?: number;
  now?: () => number;
  /** Calls `cb` on the next frame (requestAnimationFrame, with a timer fallback). */
  onFrame?: (cb: () => void) => void;
}

function defaultOnFrame(cb: () => void): void {
  let done = false;
  const go = () => {
    if (!done) {
      done = true;
      cb();
    }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
  // A hidden page draws no frames: the work still finishes.
  setTimeout(go, 50);
}

export class FrameBudgetQueue {
  private readonly budgetMs: number;
  private readonly now: () => number;
  private readonly onFrame: (cb: () => void) => void;
  private readonly jobs: (() => void)[] = [];
  private scheduled = false;

  constructor(options: FrameBudgetOptions = {}) {
    this.budgetMs = options.budgetMs ?? 6;
    this.now = options.now ?? (() => performance.now());
    this.onFrame = options.onFrame ?? defaultOnFrame;
  }

  /** How many jobs are waiting. */
  get pending(): number {
    return this.jobs.length;
  }

  /** Runs `job` in a later frame's budget; its result (or error) settles the promise. */
  run<T>(job: () => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.jobs.push(() => {
        try {
          resolve(job());
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
      this.schedule();
    });
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    this.onFrame(() => this.drain());
  }

  private drain(): void {
    this.scheduled = false;
    const started = this.now();
    let ran = 0;
    while (this.jobs.length > 0 && (ran === 0 || this.now() - started < this.budgetMs)) {
      const job = this.jobs.shift();
      job?.();
      ran++;
    }
    if (this.jobs.length > 0) this.schedule();
  }
}
