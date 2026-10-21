/**
 * Holds the render loop back while the GPU is behind: at most `maxInFlight` drawn frames may be
 * waiting on the GPU, each marked by a WebGL2 fence; while that many are, the loop's tick draws
 * nothing and the frame is drawn at the next tick that finds the GPU caught up.
 *
 * The scene draws on demand, but a glide (the clock between minute steps, the light, the eye)
 * asks for a frame each tick for as long as it runs. Where the browser does not hold
 * requestAnimationFrame back for the GPU - headless Chromium on SwiftShader, CI's browsers, a
 * frame there taking a second and more of GPU time at a phone's resolution - a quarter-second
 * glide queued a dozen frames 15 ms apart: a dozen seconds of GPU work for one minute's step,
 * with the page blocked behind it. On a GPU that keeps up, a fence from the frame before last
 * has always signalled by the next tick and nothing changes.
 */
export interface FenceGl {
  readonly SYNC_GPU_COMMANDS_COMPLETE: number;
  readonly SYNC_STATUS: number;
  readonly SIGNALED: number;
  fenceSync(condition: number, flags: number): WebGLSync | null;
  getSyncParameter(sync: WebGLSync, pname: number): unknown;
  deleteSync(sync: WebGLSync | null): void;
  flush(): void;
}

export class FramePacer {
  private readonly fences: Array<{ sync: WebGLSync; at: number }> = [];

  private readonly gl: FenceGl | null;
  private readonly maxInFlight: number;
  /** A fence older than this no longer holds the loop (a lost context never signals one). */
  private readonly staleMs: number;

  constructor(gl: FenceGl | null, maxInFlight = 2, staleMs = 2000) {
    this.gl = gl;
    this.maxInFlight = maxInFlight;
    this.staleMs = staleMs;
  }

  /** A WebGL2 context's fences, or null where there are none (WebGL1): never held back. */
  static forContext(gl: unknown): FramePacer {
    const g = gl as Partial<FenceGl> | null | undefined;
    return new FramePacer(
      g && typeof g.fenceSync === 'function' && typeof g.getSyncParameter === 'function'
        ? (g as FenceGl)
        : null,
    );
  }

  /** Whether this tick should draw nothing: `maxInFlight` frames still on the GPU. */
  behind(now: number): boolean {
    const gl = this.gl;
    if (!gl) return false;
    while (this.fences.length > 0) {
      const f = this.fences[0]!;
      const done =
        now - f.at > this.staleMs || gl.getSyncParameter(f.sync, gl.SYNC_STATUS) === gl.SIGNALED;
      if (!done) break;
      gl.deleteSync(f.sync);
      this.fences.shift();
    }
    return this.fences.length >= this.maxInFlight;
  }

  /** A frame was drawn: mark where its GPU work ends. */
  drawn(now: number): void {
    const gl = this.gl;
    if (!gl) return;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!sync) return;
    // Sent now, so the fence can signal without waiting for the browser's own flush.
    gl.flush();
    this.fences.push({ sync, at: now });
  }

  dispose(): void {
    for (const f of this.fences) this.gl?.deleteSync(f.sync);
    this.fences.length = 0;
  }
}
