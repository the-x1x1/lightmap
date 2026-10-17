/**
 * A value that follows the clock's glide (`setTime` in the Cesium host): set during a clock step
 * it moves from what is shown to the new value at the step's own fraction, so it keeps pace with
 * the Sun disc and the sky; set outside a step (a jump, a new place) it lands at once. Pure, so
 * the host can drive several of these (the glare's direction, the map's sun marker) the same way.
 */
export class StepGlide<T> {
  private from: T | null = null;
  private to: T | null = null;
  private stepId: number | null = null;
  private value: T | null = null;

  private readonly lerp: (a: T, b: T, t: number) => T;

  constructor(lerp: (a: T, b: T, t: number) => T) {
    this.lerp = lerp;
  }

  /** What is on screen now; null before the first `set`. */
  get shown(): T | null {
    return this.value;
  }

  /**
   * A new value. `glideId` is the clock step under way (null when none): a step not seen
   * before glides from what is shown; the same step re-applied (a drag while the day plays)
   * moves only its end.
   */
  set(next: T, glideId: number | null): void {
    if (glideId === null || this.value === null) {
      this.land(next);
      return;
    }
    if (glideId !== this.stepId || this.to === null) {
      this.stepId = glideId;
      this.from = this.value;
    }
    this.to = next;
  }

  /** Lands on a value at once (a jump, a new pin). */
  land(next: T): void {
    this.value = next;
    this.from = null;
    this.to = null;
    this.stepId = null;
  }

  /** One frame of the step at fraction `t` (0-1); at 1 the value has landed. */
  step(t: number): void {
    const from = this.from;
    const to = this.to;
    if (from === null || to === null) return;
    if (t >= 1) {
      this.value = to;
      this.from = null;
      this.to = null;
      return;
    }
    this.value = this.lerp(from, to, Math.max(0, t));
  }

  /** True while a step is under way. */
  get gliding(): boolean {
    return this.to !== null;
  }
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Straight-line blend of two points. */
export function lerpVec3(a: Vec3Like, b: Vec3Like, t: number): Vec3Like {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/** Blend of two unit directions, renormalised (the steps glided are a degree or two). */
export function nlerpDir(a: Vec3Like, b: Vec3Like, t: number): Vec3Like {
  const v = lerpVec3(a, b, t);
  const n = Math.hypot(v.x, v.y, v.z);
  return n > 0 ? { x: v.x / n, y: v.y / n, z: v.z / n } : b;
}
