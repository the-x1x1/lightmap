'use client';
/**
 * Planner interaction state (plan §13: Zustand for client state). Everything here is what the user
 * chose; derived values (solar, atmosphere, confidence) live in SceneState, built by useScene().
 * Anonymous exploration stays local (plan §30): nothing in this store is persisted to a server
 * until the user explicitly saves a viewpoint.
 */
import { create } from 'zustand';
import { localSelectionToUtc, parseCivilDate, utcToLocalSelection } from '@lightmap/astronomy';
import {
  defaultCamera,
  equivalentFocalLengthMm,
  focalLengthForFov,
  horizontalFovDeg,
  normalizeHeading,
  clampPitch,
  type CameraState,
  type LocationState,
} from '@lightmap/scene';
import type { WeatherScenarioId } from '@lightmap/weather';
import type { GeoPoint } from '@lightmap/geospatial';

export interface PlannerState {
  location: LocationState | null;
  /** Civil date at the location, YYYY-MM-DD. */
  date: string;
  /** Minutes since local midnight, 0–1439 (may be 1440+ across a DST day; clamped by UI). */
  minutes: number;
  scenario: WeatherScenarioId;
  /** User pinned a scenario while a forecast exists. */
  forceScenario: boolean;
  camera: CameraState;
  panel: 'plan' | 'projects' | 'account' | null;
  /** Mobile bottom sheet expanded (desktop ignores it). In the store so any control can open it. */
  sheetOpen: boolean;
  previewExpanded: boolean;
  qualityCeiling: 0 | 1 | 2 | 3;
  showPerfPanel: boolean;
  /** Set once from device capabilities. */
  reducedMotion: boolean;
  /** Sensor width the photographer's own lens numbers refer to (full frame = 36). Not persisted per viewpoint: saved viewpoints store FOV and the full-frame equivalent. */
  sensorWidthMm: number;
  /** Light finder: a direction picked in the viewpoint frame (plan §26 "I want the sun here"). */
  finderTarget: { azimuthDeg: number; elevationDeg: number } | null;
  /** The next click in the viewpoint view sets `finderTarget`. */
  finderPicking: boolean;
}

export interface PlannerActions {
  setLocation: (loc: LocationState, opts?: { keepCamera?: boolean }) => void;
  clearLocation: () => void;
  setDate: (date: string) => void;
  setMinutes: (minutes: number) => void;
  setNow: (timeZone?: string) => void;
  setScenario: (id: WeatherScenarioId, force?: boolean) => void;
  setForceScenario: (force: boolean) => void;
  setCameraMode: (mode: CameraState['mode']) => void;
  rotateCamera: (deltaHeadingDeg: number, deltaPitchDeg: number) => void;
  setHeading: (headingDeg: number) => void;
  setPitch: (pitchDeg: number) => void;
  setFocalLength: (mm: number) => void;
  setFov: (fovDeg: number) => void;
  setSensorWidth: (mm: number) => void;
  /** A lens on the chosen sensor ("my 16 mm"), converted to FOV and full-frame equivalent. */
  setActualFocalLength: (mm: number) => void;
  setPanel: (panel: PlannerState['panel']) => void;
  setSheetOpen: (v: boolean) => void;
  setPreviewExpanded: (v: boolean) => void;
  setQualityCeiling: (q: 0 | 1 | 2 | 3) => void;
  togglePerfPanel: () => void;
  setReducedMotion: (v: boolean) => void;
  setFinderTarget: (t: { azimuthDeg: number; elevationDeg: number } | null) => void;
  setFinderPicking: (v: boolean) => void;
  /** Restore a saved viewpoint. */
  restore: (v: {
    location: LocationState;
    utc: Date;
    camera: CameraState;
    scenario: WeatherScenarioId | null;
  }) => void;
}

export type PlannerStore = PlannerState & PlannerActions;

function todayIn(timeZone: string): { date: string; minutes: number } {
  return utcToLocalSelection(new Date(), timeZone);
}

const initialToday = todayIn(
  typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC',
);

export const usePlannerStore = create<PlannerStore>((set, get) => ({
  location: null,
  date: initialToday.date,
  minutes: initialToday.minutes,
  scenario: 'clear',
  forceScenario: false,
  camera: defaultCamera({ latitude: 0, longitude: 0 }),
  panel: 'plan',
  sheetOpen: true,
  sensorWidthMm: 36,
  finderTarget: null,
  finderPicking: false,
  previewExpanded: false,
  qualityCeiling: 1,
  showPerfPanel: false,
  reducedMotion: false,

  setLocation(loc, opts) {
    const prev = get();
    const camera: CameraState = opts?.keepCamera
      ? { ...prev.camera, eye: loc.point }
      : { ...defaultCamera(loc.point, prev.camera.headingDeg), mode: prev.camera.mode };
    // Keep the chosen wall-clock time when the zone changes: "12:30" stays "12:30" at the new place.
    // A picked finder target belongs to the old viewpoint.
    set({ location: loc, camera, finderTarget: null, finderPicking: false });
  },
  clearLocation() {
    set({ location: null });
  },
  setDate(date) {
    if (parseCivilDate(date)) set({ date });
  },
  setMinutes(minutes) {
    set({ minutes: Math.max(0, Math.min(1439, Math.round(minutes))) });
  },
  setNow(timeZone) {
    const tz = timeZone ?? get().location?.timeZone ?? 'UTC';
    set(todayIn(tz));
  },
  setScenario(id, force) {
    set({ scenario: id, forceScenario: force ?? get().forceScenario });
  },
  setForceScenario(force) {
    set({ forceScenario: force });
  },
  setCameraMode(mode) {
    set({ camera: { ...get().camera, mode } });
  },
  rotateCamera(dh, dp) {
    const c = get().camera;
    set({
      camera: {
        ...c,
        headingDeg: normalizeHeading(c.headingDeg + dh),
        pitchDeg: clampPitch(c.pitchDeg + dp),
      },
    });
  },
  setHeading(h) {
    set({ camera: { ...get().camera, headingDeg: normalizeHeading(h) } });
  },
  setPitch(p) {
    set({ camera: { ...get().camera, pitchDeg: clampPitch(p) } });
  },
  setFocalLength(mm) {
    set({ camera: { ...get().camera, focalLengthMm: mm, fovDeg: horizontalFovDeg(mm) } });
  },
  setFov(fov) {
    set({
      camera: { ...get().camera, fovDeg: Math.max(5, Math.min(120, fov)), focalLengthMm: null },
    });
  },
  setSensorWidth(mm) {
    set({ sensorWidthMm: Math.max(4, Math.min(60, mm)) });
  },
  setActualFocalLength(mm) {
    // Clamp the FOV first and derive the equivalent from the clamped value, so a saved viewpoint
    // restored from `focalLengthMm` reproduces the same (capped) frustum.
    const eq = equivalentFocalLengthMm(mm, get().sensorWidthMm);
    const fov = Math.max(5, Math.min(120, horizontalFovDeg(eq)));
    set({
      camera: {
        ...get().camera,
        fovDeg: fov,
        focalLengthMm: Math.round(focalLengthForFov(fov) * 10) / 10,
      },
    });
  },
  setPanel(panel) {
    set({ panel, sheetOpen: true });
  },
  setSheetOpen(v) {
    set({ sheetOpen: v });
  },
  setPreviewExpanded(v) {
    set({ previewExpanded: v });
  },
  setQualityCeiling(q) {
    set({ qualityCeiling: q });
  },
  togglePerfPanel() {
    set({ showPerfPanel: !get().showPerfPanel });
  },
  setReducedMotion(v) {
    set({ reducedMotion: v });
  },
  setFinderTarget(t) {
    set({ finderTarget: t, finderPicking: false });
  },
  setFinderPicking(v) {
    // Picking only makes sense in the eye-level view.
    set(
      v
        ? { finderPicking: true, camera: { ...get().camera, mode: 'viewpoint' } }
        : { finderPicking: false },
    );
  },
  restore(v) {
    const sel = utcToLocalSelection(v.utc, v.location.timeZone);
    set({
      location: v.location,
      date: sel.date,
      minutes: sel.minutes,
      camera: v.camera,
      scenario: v.scenario ?? get().scenario,
      forceScenario: v.scenario !== null,
      finderTarget: null,
      finderPicking: false,
    });
  },
}));

/** The selected UTC instant, or null without a location (its zone decides what "12:30" means). */
export function selectedUtc(s: Pick<PlannerState, 'location' | 'date' | 'minutes'>): Date | null {
  if (!s.location) return null;
  const civil = parseCivilDate(s.date);
  if (!civil) return null;
  return localSelectionToUtc(civil, s.minutes, s.location.timeZone);
}

export function locationFromPoint(
  point: GeoPoint,
  timeZone: string,
  label: string,
  source: LocationState['source'],
): LocationState {
  return { point, timeZone, label, source };
}
