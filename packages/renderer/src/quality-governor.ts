/**
 * Adaptive quality governor: turns measured frame rate into a rung on a fixed quality ladder,
 * stepping down fast and up slowly, with a climb penalty per failed rung so a machine sitting on
 * a boundary does not oscillate.
 *
 * Provenance: ported from the owner's WorldView repository (`render-core/src/performance.ts`,
 * `PerformanceGovernor`, owner-authored, MIT). Generalised over a `QualityRung` — shadow map
 * size, terrain screen-space error, resolution scale, soft shadows — instead of WorldView's
 * feature caps and detail levels. See docs/WORLDVIEW_REUSE_AUDIT.md row 4.
 */

export interface QualityRung {
  label: string;
  shadowMapSize: 1024 | 2048 | 4096;
  softShadows: boolean;
  terrainScreenSpaceError: number;
  resolutionScale: number;
  /** Whether the rung casts terrain shadows at all. */
  shadows: boolean;
}

/** Best first. Every step down must be cheaper in at least one dimension and dearer in none. */
export const QUALITY_LADDER: readonly QualityRung[] = Object.freeze([
  { label: 'Ultra', shadowMapSize: 4096, softShadows: true, terrainScreenSpaceError: 1.5, resolutionScale: 1, shadows: true },
  { label: 'High', shadowMapSize: 2048, softShadows: true, terrainScreenSpaceError: 2, resolutionScale: 1, shadows: true },
  { label: 'Balanced', shadowMapSize: 2048, softShadows: false, terrainScreenSpaceError: 3, resolutionScale: 1, shadows: true },
  { label: 'Battery', shadowMapSize: 1024, softShadows: false, terrainScreenSpaceError: 4, resolutionScale: 0.85, shadows: true },
  { label: 'Minimal', shadowMapSize: 1024, softShadows: false, terrainScreenSpaceError: 6, resolutionScale: 0.7, shadows: false },
]);

function cost(r: QualityRung): number[] {
  return [r.shadowMapSize, r.softShadows ? 1 : 0, -r.terrainScreenSpaceError, r.resolutionScale, r.shadows ? 1 : 0];
}

/** True when no rung is more expensive than the rung above it in any dimension. */
export function ladderIsMonotone(ladder: readonly QualityRung[] = QUALITY_LADDER): boolean {
  for (let i = 1; i < ladder.length; i++) {
    const above = cost(ladder[i - 1]!);
    const here = cost(ladder[i]!);
    let cheaperSomewhere = false;
    for (let k = 0; k < above.length; k++) {
      if (here[k]! > above[k]!) return false;
      if (here[k]! < above[k]!) cheaperSomewhere = true;
    }
    if (!cheaperSomewhere) return false;
  }
  return true;
}

export interface FrameSample {
  fps: number;
}

export interface QualityGovernorOptions {
  /** At or below this frame rate the view is judged unusable and the governor steps down. */
  floorFps?: number;
  /** At or above this frame rate there is headroom and the governor may step up. */
  targetFps?: number;
  /** Consecutive slow samples before stepping down. */
  slowSamples?: number;
  /** Consecutive fast samples before stepping up (before penalties). */
  fastSamples?: number;
  /** Extra fast samples demanded per previous failure at a rung, and its cap. */
  climbPenalty?: number;
  maxClimbPenalty?: number;
  initialRung?: number;
  ladder?: readonly QualityRung[];
  /** Never climb above this rung (e.g. 1 on a low-power device). */
  ceilingRung?: number;
}

export class QualityGovernor {
  private readonly ladder: readonly QualityRung[];
  private readonly floorFps: number;
  private readonly targetFps: number;
  private readonly slowSamples: number;
  private readonly fastSamples: number;
  private readonly climbPenalty: number;
  private readonly maxClimbPenalty: number;
  private readonly failures: number[];
  private ceiling: number;
  private rung: number;
  private slowRun = 0;
  private fastRun = 0;
  private lastFps: number | null = null;

  constructor(options: QualityGovernorOptions = {}) {
    this.ladder = options.ladder ?? QUALITY_LADDER;
    if (this.ladder.length === 0) throw new TypeError('QualityGovernor needs at least one rung');
    this.floorFps = options.floorFps ?? 24;
    this.targetFps = options.targetFps ?? 50;
    if (this.targetFps <= this.floorFps) throw new TypeError('targetFps must leave a dead band above floorFps');
    this.slowSamples = Math.max(1, options.slowSamples ?? 2);
    this.fastSamples = Math.max(1, options.fastSamples ?? 6);
    this.climbPenalty = Math.max(0, options.climbPenalty ?? 4);
    this.maxClimbPenalty = Math.max(0, options.maxClimbPenalty ?? 24);
    this.failures = new Array<number>(this.ladder.length).fill(0);
    this.ceiling = clampRung(options.ceilingRung ?? 0, this.ladder.length);
    // Start one below the best: a capable machine gets near-full quality at once and earns the
    // top rung; a weak one has a shorter fall.
    this.rung = clampRung(options.initialRung ?? Math.max(this.ceiling, Math.min(1, this.ladder.length - 1)), this.ladder.length);
  }

  get rungIndex(): number {
    return this.rung;
  }

  get quality(): QualityRung {
    return this.ladder[this.rung]!;
  }

  get lastMeasuredFps(): number | null {
    return this.lastFps;
  }

  setCeiling(rung: number): void {
    this.ceiling = clampRung(rung, this.ladder.length);
    if (this.rung < this.ceiling) this.rung = this.ceiling;
  }

  private climbThreshold(): number {
    if (this.rung <= this.ceiling) return Number.POSITIVE_INFINITY;
    const penalty = Math.min(this.maxClimbPenalty, this.failures[this.rung - 1]! * this.climbPenalty);
    return this.fastSamples + penalty;
  }

  /** Feed one measured second. Returns true when the rung changed. */
  sample(sample: FrameSample): boolean {
    if (!Number.isFinite(sample.fps) || sample.fps < 0) return false;
    this.lastFps = sample.fps;
    const before = this.rung;
    if (sample.fps <= this.floorFps) {
      this.fastRun = 0;
      if (this.rung >= this.ladder.length - 1) {
        this.slowRun = 0;
        return false;
      }
      this.slowRun++;
      if (this.slowRun >= this.slowSamples) {
        this.slowRun = 0;
        this.failures[this.rung] = Math.min(this.failures[this.rung]! + 1, 1_000);
        this.rung = clampRung(this.rung + 1, this.ladder.length);
      }
    } else if (sample.fps >= this.targetFps) {
      this.slowRun = 0;
      this.fastRun++;
      if (this.fastRun >= this.climbThreshold()) {
        this.fastRun = 0;
        this.rung = clampRung(this.rung - 1, this.ladder.length);
      }
    } else {
      // Dead band: the steady state. Decaying both runs stops one slow second in a healthy
      // minute from adding up to a step down.
      this.slowRun = 0;
      this.fastRun = 0;
    }
    return this.rung !== before;
  }

  /** Forget the measurement history without moving the rung (renderer swap, tab resume). */
  resetRuns(): void {
    this.slowRun = 0;
    this.fastRun = 0;
    this.lastFps = null;
  }
}

function clampRung(value: number, length: number): number {
  if (!Number.isInteger(value)) value = Math.round(value);
  return Math.max(0, Math.min(length - 1, value));
}
