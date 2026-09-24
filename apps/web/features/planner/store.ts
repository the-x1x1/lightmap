'use client';
/**
 * Planner interaction state (plan §13: Zustand for client state). Everything here is what the user
 * chose; derived values (solar, atmosphere, confidence) live in SceneState, built by useScene().
 * Anonymous exploration stays local (plan §30): nothing in this store is persisted to a server
 * until the user explicitly saves a viewpoint.
 */
import { create } from 'zustand';
import { localSelectionToUtc, parseCivilDate, utcToWallClock } from '@lightmap/astronomy';
import {
  defaultCamera,
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
  previewExpanded: boolean;
  qualityCeiling: 0 | 1 | 2 | 3;
  showPerfPanel: boolean;
  /** Set once from device capabilities. */
  reducedMotion: boolean;
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
  setPanel: (panel: PlannerState['panel']) => void;
  setPreviewExpanded: (v: boolean) => void;
  setQualityCeiling: (q: 0 | 1 | 2 | 3) => void;
  togglePerfPanel: () => void;
  setReducedMotion: (v: boolean) => void;
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
  const w = utcToWallClock(new Date(), timeZone);
  const date = `${w.year.toString().padStart(4, '0')}-${w.month.toString().padStart(2, '0')}-${w.day.toString().padStart(2, '0')}`;
  return { date, minutes: w.hour * 60 + w.minute };
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
    set({ location: loc, camera });
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
  setPanel(panel) {
    set({ panel });
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
  restore(v) {
    const w = utcToWallClock(v.utc, v.location.timeZone);
    set({
      location: v.location,
      date: `${w.year.toString().padStart(4, '0')}-${w.month.toString().padStart(2, '0')}-${w.day.toString().padStart(2, '0')}`,
      minutes: w.hour * 60 + w.minute,
      camera: v.camera,
      scenario: v.scenario ?? get().scenario,
      forceScenario: v.scenario !== null,
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
