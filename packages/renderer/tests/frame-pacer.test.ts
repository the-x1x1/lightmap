import { describe, expect, it } from 'vitest';
import { FramePacer, type FenceGl } from '../src/cesium/frame-pacer.ts';

/** A stand-in context whose fences signal when the test says the GPU has done them. */
function fakeGl() {
  const signalled = new Set<number>();
  const live = new Set<number>();
  let next = 1;
  let flushes = 0;
  const gl: FenceGl = {
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
    SYNC_STATUS: 0x9114,
    SIGNALED: 0x9119,
    fenceSync: () => {
      const id = next++;
      live.add(id);
      return id as unknown as WebGLSync;
    },
    getSyncParameter: (sync) => (signalled.has(sync as unknown as number) ? 0x9119 : 0x9118),
    deleteSync: (sync) => {
      live.delete(sync as unknown as number);
    },
    flush: () => {
      flushes++;
    },
  };
  return {
    gl,
    gpuDone: (id: number) => signalled.add(id),
    live: () => live.size,
    flushes: () => flushes,
  };
}

describe('FramePacer', () => {
  it('lets ticks through while fewer than two drawn frames are on the GPU', () => {
    const f = fakeGl();
    const p = new FramePacer(f.gl);
    expect(p.behind(0)).toBe(false);
    p.drawn(0);
    expect(p.behind(15)).toBe(false);
    p.drawn(15);
    expect(f.flushes()).toBe(2);
    // Two frames queued, neither done: the next tick draws nothing.
    expect(p.behind(30)).toBe(true);
    expect(p.behind(45)).toBe(true);
    // The first is done: one in flight again.
    f.gpuDone(1);
    expect(p.behind(60)).toBe(false);
    expect(f.live()).toBe(1);
  });

  it('a GPU that keeps up never holds a tick back', () => {
    const f = fakeGl();
    const p = new FramePacer(f.gl);
    for (let i = 1; i <= 50; i++) {
      expect(p.behind(i * 16)).toBe(false);
      p.drawn(i * 16);
      f.gpuDone(i);
    }
    expect(f.live()).toBeLessThanOrEqual(1);
  });

  it('a fence that never signals (a lost context) stops holding the loop after a while', () => {
    const f = fakeGl();
    const p = new FramePacer(f.gl, 2, 2000);
    p.drawn(0);
    p.drawn(10);
    expect(p.behind(1000)).toBe(true);
    expect(p.behind(2011)).toBe(false);
  });

  it('without fences (WebGL1, no context) it never holds back', () => {
    const p = FramePacer.forContext({});
    p.drawn(0);
    p.drawn(1);
    p.drawn(2);
    expect(p.behind(3)).toBe(false);
    expect(FramePacer.forContext(undefined).behind(0)).toBe(false);
  });

  it('dispose deletes the fences still waiting', () => {
    const f = fakeGl();
    const p = new FramePacer(f.gl);
    p.drawn(0);
    p.drawn(1);
    p.dispose();
    expect(f.live()).toBe(0);
    expect(p.behind(2)).toBe(false);
  });
});
