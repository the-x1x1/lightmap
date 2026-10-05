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
import type { ProjectDto, ViewpointDto } from '@/lib/api-types';

export interface ShotListOptions {
  /** Shown in the footer. */
  appUrl: string;
  generatedAt: Date;
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

/** One viewpoint's block, in the place's own zone. */
export function shotBlock(v: ViewpointDto): string[] {
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
    `  Where:   ${v.latitude.toFixed(5)}, ${v.longitude.toFixed(5)}${v.elevationM !== null ? ` · ${Math.round(v.elevationM)} m` : ''}`,
    `  Camera:  ${Math.round(v.headingDeg)}° ${compassLabel(v.headingDeg)}, pitch ${v.pitchDeg.toFixed(0)}°${v.focalLengthEquivalentMm ? `, ${v.focalLengthEquivalentMm} mm` : `, ${v.fieldOfViewDeg.toFixed(0)}° field`}`,
    `  Sun:     ${sun.elevationDeg > -0.833 ? `${sun.elevationDeg.toFixed(0)}° up, ${Math.round(sun.azimuthDeg)}° ${compassLabel(sun.azimuthDeg)}` : `${Math.abs(sun.elevationDeg).toFixed(0)}° below the horizon`}`,
    `  Day:     sunrise ${ev.sunrise ? formatWallTime(ev.sunrise, tz) : '—'} · sunset ${ev.sunset ? formatWallTime(ev.sunset, tz) : '—'}`,
  ];
  if (sun.elevationDeg <= -6) {
    const moon = moonPosition(at, v.latitude, v.longitude);
    const core = milkyWayCore(at, v.latitude, v.longitude);
    lines.push(
      `  Moon:    ${moon.elevationDeg > 0 ? `${moon.elevationDeg.toFixed(0)}° up, ${Math.round(moon.azimuthDeg)}° ${compassLabel(moon.azimuthDeg)}` : 'down'}, ${Math.round(moon.illuminatedFraction * 100)} % lit`,
      `  Core:    ${core.elevationDeg > 0 ? `${core.elevationDeg.toFixed(0)}° up, ${Math.round(core.azimuthDeg)}° ${compassLabel(core.azimuthDeg)}` : 'below the horizon'} — ${core.reason}`,
    );
  }
  lines.push(`  Weather: ${weatherLine(v)}`);
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
    project.shootDate ? `Shoot date: ${project.shootDate}` : '',
    `${viewpoints.length} viewpoint${viewpoints.length === 1 ? '' : 's'}`,
    '',
  ];
  if (project.description)
    out.push('Notes:', ...project.description.split('\n').map((l) => `  ${l}`), '');
  for (const p of parents) {
    out.push(...shotBlock(p), '');
    const variants = viewpoints.filter((v) => v.parentViewpointId === p.id).sort(byTime);
    for (const v of variants) out.push(...shotBlock(v).map((l) => `    ${l}`), '');
  }
  out.push(
    `Sun and Moon from ephemeris; the Milky Way core from geometry (no sky-brightness model). Weather lines say what the viewpoint was saved with — a scenario is not a forecast.`,
    `Made with ${brand.name} · ${opts.appUrl} · ${opts.generatedAt.toISOString()}`,
  );
  return out.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}
