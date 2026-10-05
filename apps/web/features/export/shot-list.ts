/**
 * A project's shot list as plain text (the call sheet a photographer prints or pastes into a
 * message): one block per saved viewpoint in time order — when (place zone), where, which way,
 * the lens, the sun at that instant, the Moon and the Milky Way core when it is a night shot, and
 * the weather basis it was saved with — plus the project's notes. Deterministic facts only:
 * nothing here is a forecast unless the viewpoint was saved with one, and it says so. Pure.
 */
import {
  computeDayEvents,
  formatWallTime,
  milkyWayCore,
  moonPosition,
  sunPosition,
  utcToWallClock,
} from '@lightmap/astronomy';
import { brand } from '@lightmap/config';
import { compassLabel } from '@lightmap/geospatial';
import { formatHeight, type DistanceUnits } from '@lightmap/scene';
import type { ProjectDto, ViewpointDto } from '@/lib/api-types';
import { viewpointUrl } from '@/features/projects/open-viewpoint';

export interface ShotListOptions {
  /** Shown in the footer and used for the per-viewpoint links. */
  appUrl: string;
  generatedAt: Date;
  /** Heights in metres (default) or feet. */
  units?: DistanceUnits;
}

function civil(d: Date, tz: string): string {
  const w = utcToWallClock(d, tz);
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}

function weatherLine(v: ViewpointDto): string {
  switch (v.weatherMode) {
    case 'FORECAST':
      return 'Forecast at save time (check again before the day)';
    case 'EXTENDED_FORECAST':
      return 'Extended-range forecast at save time (low confidence)';
    case 'RECENT_PAST':
    case 'PAST':
      return 'Observed conditions';
    case 'SCENARIO':
      return `Scenario (not a forecast): ${v.weatherScenario ?? 'none chosen'}`;
  }
}

/** One viewpoint's block, in the place's own zone; with `appUrl`, a link that reopens it. */
export function shotBlock(
  v: ViewpointDto,
  appUrl?: string,
  units: DistanceUnits = 'metric',
): string[] {
  const at = new Date(v.selectedDatetimeUtc);
  const tz = v.timezone;
  const w = utcToWallClock(at, tz);
  const sun = sunPosition(at, v.latitude, v.longitude);
  const ev = computeDayEvents({
    latitude: v.latitude,
    longitude: v.longitude,
    timeZone: tz,
    date: { year: w.year, month: w.month, day: w.day },
  });
  const lines = [
    `${v.label}`,
    `  When:    ${civil(at, tz)} ${formatWallTime(at, tz)} (${tz})`,
    `  Where:   ${v.latitude.toFixed(5)}, ${v.longitude.toFixed(5)}${v.elevationM !== null ? ` · ${formatHeight(v.elevationM, units)}` : ''}`,
    `  Camera:  ${Math.round(v.headingDeg)}° ${compassLabel(v.headingDeg)}, pitch ${Math.round(v.pitchDeg)}°${v.focalLengthEquivalentMm ? `, ${v.focalLengthEquivalentMm} mm` : `, ${Math.round(v.fieldOfViewDeg)}° field`}`,
    `  Sun:     ${sun.elevationDeg > -0.833 ? `${Math.round(sun.elevationDeg)}° up, ${Math.round(sun.azimuthDeg)}° ${compassLabel(sun.azimuthDeg)}` : `${Math.round(Math.abs(sun.elevationDeg))}° below the horizon`}`,
    `  Day:     sunrise ${ev.sunrise ? formatWallTime(ev.sunrise, tz) : '—'} · sunset ${ev.sunset ? formatWallTime(ev.sunset, tz) : '—'}`,
  ];
  if (sun.elevationDeg <= -6) {
    const moon = moonPosition(at, v.latitude, v.longitude);
    const core = milkyWayCore(at, v.latitude, v.longitude);
    // "Up" by the same rise/set threshold the planner and the core verdict use, so the two lines
    // never contradict each other at the horizon.
    lines.push(
      `  Moon:    ${core.moonUp ? `${Math.round(moon.elevationDeg)}° up, ${Math.round(moon.azimuthDeg)}° ${compassLabel(moon.azimuthDeg)}` : 'down'}, ${Math.round(moon.illuminatedFraction * 100)} % lit`,
      `  Core:    ${core.elevationDeg > 0 ? `${Math.round(core.elevationDeg)}° up, ${Math.round(core.azimuthDeg)}° ${compassLabel(core.azimuthDeg)}` : 'below the horizon'} — ${core.reason}`,
    );
  }
  lines.push(`  Weather: ${weatherLine(v)}`);
  if (appUrl) lines.push(`  Open:    ${viewpointUrl(appUrl, v.id)}`);
  return lines;
}

/** The whole project as text. Variants follow their parent, indented. */
export function buildShotList(
  project: ProjectDto,
  viewpoints: readonly ViewpointDto[],
  opts: ShotListOptions,
): string {
  const byTime = (a: ViewpointDto, b: ViewpointDto) =>
    Date.parse(a.selectedDatetimeUtc) - Date.parse(b.selectedDatetimeUtc);
  const ids = new Set(viewpoints.map((v) => v.id));
  const parents = viewpoints
    .filter((v) => !v.parentViewpointId || !ids.has(v.parentViewpointId))
    .sort(byTime);
  const out: string[] = [
    `${project.name} — shot list`,
    ...(project.shootDate ? [`Shoot date: ${project.shootDate}`] : []),
    `${viewpoints.length} viewpoint${viewpoints.length === 1 ? '' : 's'}`,
    '',
  ];
  if (project.description)
    out.push('Notes:', ...project.description.split('\n').map((l) => `  ${l}`), '');
  for (const p of parents) {
    out.push(...shotBlock(p, opts.appUrl, opts.units), '');
    const variants = viewpoints.filter((v) => v.parentViewpointId === p.id).sort(byTime);
    for (const v of variants)
      out.push(...shotBlock(v, opts.appUrl, opts.units).map((l) => `    ${l}`), '');
  }
  out.push(
    `Sun and Moon from ephemeris; the Milky Way core from geometry (no sky-brightness model). Weather lines say what the viewpoint was saved with — a scenario is not a forecast.`,
    `Made with ${brand.name} · ${opts.appUrl} · ${opts.generatedAt.toISOString()}`,
  );
  return out.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}
