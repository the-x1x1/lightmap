/**
 * Eclipses ahead (night planning, "deterministic facts" in plan §1): which of the coming year's
 * new and full Moons eclipse the Sun from *this place* or put the Moon in the Earth's shadow, and
 * what an observer here gets to see of each.
 *
 * Geometry, not tables. A lunar eclipse is found by scanning the hours around each full Moon for
 * the least separation between the Moon's geocentric centre and the anti-solar point, against the
 * penumbral and umbral shadow radii at the Moon's distance (Danjon's rule as Meeus gives it in
 * ch. 54, radii enlarged by 2 % for the atmosphere); the contacts are where the Moon's limb
 * enters and leaves each shadow. A solar eclipse is found the same way from the observer's own
 * topocentric Moon against the Sun (Meeus ch. 40 for the parallax, ch. 55 for the semidiameters),
 * so it answers "from here", not "somewhere on Earth": the magnitude, how much of the disc is
 * covered, and whether the Sun is up for it. The series behind the positions are the ones every
 * other number in the app rests on (≈ 10″ for the Moon), which puts the contact times within a
 * minute or two of the almanac and the edge of a totality path within a few tens of km; the UI says so
 * (`ECLIPSE_ACCURACY_NOTE`). Pure, unit-tested against the 2023–2027 almanac eclipses.
 */
import { lunarEquatorial, topocentricEquatorial } from './lunar.ts';
import { nextMoonPhases } from './phases.ts';
import { solarEquatorial, toHorizontal } from './solar.ts';
import { julianCenturiesTT } from './time.ts';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const MINUTE = 60_000;

/** Sun's semidiameter at one astronomical unit, degrees (959.63″). */
const SUN_SEMIDIAMETER_1AU_DEG = 959.63 / 3600;
/** Sun's equatorial horizontal parallax at one astronomical unit, degrees (8.794″). */
const SUN_PARALLAX_1AU_DEG = 8.794 / 3600;
/** Moon's semidiameter as a fraction of its horizontal parallax (Meeus 55). */
const MOON_SEMIDIAMETER_RATIO = 0.2725;
/** Shadow enlargement for the Earth's atmosphere (Danjon, as in Meeus ch. 54). */
const SHADOW_ENLARGEMENT = 1.02;
/** Earth's polar flattening applied to the shadow radii (Meeus 54: 0.99834). */
const SHADOW_FLATTENING = 0.998_34;
/** A full or new Moon farther than this from the ecliptic cannot be eclipsed at all. */
const ECLIPSE_LATITUDE_LIMIT_DEG = 1.7;
/** The Sun's upper limb on the horizon (refraction + semidiameter), degrees. */
const SUN_HORIZON_DEG = -0.833;
/** Below this geometric elevation the Moon (upper limb, refracted) is set; its rise threshold at mean distance. */
const MOON_HORIZON_DEG = -0.83;

export const ECLIPSE_ACCURACY_NOTE =
  'Eclipse times here come from the same lunar series as the rest of the planner (±10″), which puts contacts within a minute or two of the almanac and the edge of a totality path within a few tens of kilometres; confirm against an almanac before travelling for one.';

export interface LunarEclipse {
  kind: 'lunar';
  type: 'total' | 'partial' | 'penumbral';
  /** The full Moon this belongs to. */
  fullMoon: Date;
  /** Instant of greatest eclipse (least separation from the shadow's axis), UTC. */
  greatest: Date;
  /** Umbral magnitude: the fraction of the Moon's diameter inside the umbra at greatest eclipse (< 0 when penumbral only). */
  umbralMagnitude: number;
  /** Penumbral magnitude: the same for the penumbra. */
  penumbralMagnitude: number;
  contacts: {
    penumbralStart: Date;
    umbralStart: Date | null;
    totalStart: Date | null;
    totalEnd: Date | null;
    umbralEnd: Date | null;
    penumbralEnd: Date;
  };
}

export interface LunarEclipseHere extends LunarEclipse {
  /** Whether the Moon is above the horizon at the eclipse's first contact, greatest and last contact. */
  moonUp: { start: boolean; greatest: boolean; end: boolean };
  /** The Moon's topocentric elevation and bearing at greatest eclipse. */
  moonAtGreatest: { elevationDeg: number; azimuthDeg: number };
}

export interface SolarEclipseHere {
  kind: 'solar';
  /** What this place sees at its greatest eclipse. */
  type: 'total' | 'annular' | 'partial';
  /** The new Moon this belongs to. */
  newMoon: Date;
  /** Instant of greatest eclipse at this place with the Sun above the horizon, UTC. */
  greatest: Date;
  /** Fraction of the Sun's diameter covered at greatest eclipse (≥ 1 when total). */
  magnitude: number;
  /** Fraction of the Sun's disc area covered at greatest eclipse, 0–1. */
  obscuration: number;
  /** First and last contact at this place (clipped to the Sun being up). */
  start: Date;
  end: Date;
  /** Second and third contact when the eclipse is total or annular here. */
  centralStart: Date | null;
  centralEnd: Date | null;
  /** The Sun at greatest eclipse. */
  sunAtGreatest: { elevationDeg: number; azimuthDeg: number };
  /** Whether sunrise opens the eclipse here (start) and whether sunset closes it (end). */
  clipped: { start: boolean; end: boolean };
}

export type EclipseHere = LunarEclipseHere | SolarEclipseHere;

interface Place {
  latitude: number;
  longitude: number;
}

function unit(raDeg: number, decDeg: number): [number, number, number] {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
}

/** Angular separation in degrees between two directions on the sky. */
function separationDeg(a: [number, number, number], b: [number, number, number]): number {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return Math.acos(dot) * RAD;
}

/** Fraction of a disc of radius `a` covered by a disc of radius `b` whose centre is `d` away. */
export function discObscuration(a: number, b: number, d: number): number {
  if (d >= a + b) return 0;
  if (d <= Math.abs(a - b)) return b >= a ? 1 : (b * b) / (a * a);
  const x = (d * d + a * a - b * b) / (2 * d * a);
  const y = (d * d + b * b - a * a) / (2 * d * b);
  const area =
    a * a * Math.acos(Math.max(-1, Math.min(1, x))) +
    b * b * Math.acos(Math.max(-1, Math.min(1, y))) -
    0.5 * Math.sqrt(Math.max(0, (-d + a + b) * (d + a - b) * (d - a + b) * (d + a + b)));
  return Math.max(0, Math.min(1, area / (Math.PI * a * a)));
}

/** Geocentric lunar-eclipse geometry at an instant: separation from the shadow axis and the radii. */
function lunarGeometry(at: Date): {
  separationDeg: number;
  moonSemidiameterDeg: number;
  penumbraDeg: number;
  umbraDeg: number;
} {
  const T = julianCenturiesTT(at);
  const moon = lunarEquatorial(T);
  const sun = solarEquatorial(T);
  const antiSun = unit(sun.rightAscensionDeg + 180, -sun.declinationDeg);
  const sunSemidiameter = SUN_SEMIDIAMETER_1AU_DEG / sun.distanceAu;
  const sunParallax = SUN_PARALLAX_1AU_DEG / sun.distanceAu;
  const moonParallax = moon.parallaxDeg;
  return {
    separationDeg: separationDeg(unit(moon.rightAscensionDeg, moon.declinationDeg), antiSun),
    moonSemidiameterDeg: MOON_SEMIDIAMETER_RATIO * moonParallax,
    penumbraDeg:
      SHADOW_ENLARGEMENT * (SHADOW_FLATTENING * moonParallax + sunSemidiameter + sunParallax),
    umbraDeg:
      SHADOW_ENLARGEMENT * (SHADOW_FLATTENING * moonParallax - sunSemidiameter + sunParallax),
  };
}

/** Bisects between an instant outside a condition and one inside it (either order in time); the inside side of the edge, to ±1 s. */
function refineEdge(before: number, after: number, inside: (t: number) => boolean): Date {
  let lo = before;
  let hi = after;
  while (Math.abs(hi - lo) > 1000) {
    const mid = (lo + hi) / 2;
    if (inside(mid)) hi = mid;
    else lo = mid;
  }
  return new Date(Math.round(hi / 1000) * 1000);
}

/** Entry and exit of a condition over a minute-stepped scan; null when it never holds. */
function spell(
  times: readonly number[],
  holds: readonly boolean[],
  inside: (t: number) => boolean,
): { start: Date; end: Date } | null {
  const first = holds.indexOf(true);
  if (first < 0) return null;
  const last = holds.lastIndexOf(true);
  const t0 = times[first]!;
  const t1 = times[last]!;
  const start = first > 0 ? refineEdge(times[first - 1]!, t0, inside) : new Date(t0);
  const end =
    last < times.length - 1
      ? refineEdge(times[last + 1]!, t1, inside) // bisection from outside (after) toward inside
      : new Date(t1);
  return { start, end };
}

/**
 * The lunar eclipse at a full Moon, if any: a scan of the eight hours around it, one minute
 * apart (no eclipse lasts longer), for the Moon's limb against the penumbra and the umbra.
 */
export function lunarEclipseAt(fullMoon: Date): LunarEclipse | null {
  const T = julianCenturiesTT(fullMoon);
  if (Math.abs(lunarEquatorial(T).eclipticLatitudeDeg) > ECLIPSE_LATITUDE_LIMIT_DEG) return null;
  const centre = fullMoon.getTime();
  const times: number[] = [];
  for (let t = centre - 4 * 60 * MINUTE; t <= centre + 4 * 60 * MINUTE; t += MINUTE) times.push(t);
  const geo = times.map((t) => lunarGeometry(new Date(t)));
  // Greatest eclipse: least separation from the axis, refined between the neighbouring minutes.
  let gi = 0;
  geo.forEach((g, i) => {
    if (g.separationDeg < geo[gi]!.separationDeg) gi = i;
  });
  let lo = times[Math.max(0, gi - 1)]!;
  let hi = times[Math.min(times.length - 1, gi + 1)]!;
  for (let i = 0; i < 20; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (lunarGeometry(new Date(m1)).separationDeg < lunarGeometry(new Date(m2)).separationDeg)
      hi = m2;
    else lo = m1;
  }
  const greatestMs = Math.round((lo + hi) / 2000) * 1000;
  const g = lunarGeometry(new Date(greatestMs));
  const penumbralMagnitude =
    (g.penumbraDeg + g.moonSemidiameterDeg - g.separationDeg) / (2 * g.moonSemidiameterDeg);
  if (penumbralMagnitude <= 0) return null;
  const umbralMagnitude =
    (g.umbraDeg + g.moonSemidiameterDeg - g.separationDeg) / (2 * g.moonSemidiameterDeg);
  const inPenumbra = (t: number) => {
    const x = lunarGeometry(new Date(t));
    return x.separationDeg < x.penumbraDeg + x.moonSemidiameterDeg;
  };
  const inUmbra = (t: number) => {
    const x = lunarGeometry(new Date(t));
    return x.separationDeg < x.umbraDeg + x.moonSemidiameterDeg;
  };
  const total = (t: number) => {
    const x = lunarGeometry(new Date(t));
    return x.separationDeg + x.moonSemidiameterDeg < x.umbraDeg;
  };
  const pen = spell(
    times,
    geo.map((x) => x.separationDeg < x.penumbraDeg + x.moonSemidiameterDeg),
    inPenumbra,
  );
  if (!pen) return null;
  const umb = spell(
    times,
    geo.map((x) => x.separationDeg < x.umbraDeg + x.moonSemidiameterDeg),
    inUmbra,
  );
  const tot = spell(
    times,
    geo.map((x) => x.separationDeg + x.moonSemidiameterDeg < x.umbraDeg),
    total,
  );
  return {
    kind: 'lunar',
    type: tot ? 'total' : umb ? 'partial' : 'penumbral',
    fullMoon,
    greatest: new Date(greatestMs),
    umbralMagnitude,
    penumbralMagnitude,
    contacts: {
      penumbralStart: pen.start,
      umbralStart: umb?.start ?? null,
      totalStart: tot?.start ?? null,
      totalEnd: tot?.end ?? null,
      umbralEnd: umb?.end ?? null,
      penumbralEnd: pen.end,
    },
  };
}

/** A lunar eclipse with what an observer at `place` sees of it. */
export function lunarEclipseHere(eclipse: LunarEclipse, place: Place): LunarEclipseHere {
  const moonAt = (at: Date) => {
    const T = julianCenturiesTT(at);
    const moon = lunarEquatorial(T);
    const hz = toHorizontal(
      topocentricEquatorial(moon, at, place.latitude, place.longitude),
      at,
      place.latitude,
      place.longitude,
    );
    return { elevationDeg: hz.elevationDeg, azimuthDeg: hz.azimuthDeg };
  };
  const up = (at: Date) => moonAt(at).elevationDeg > MOON_HORIZON_DEG;
  const g = moonAt(eclipse.greatest);
  return {
    ...eclipse,
    moonUp: {
      start: up(eclipse.contacts.penumbralStart),
      greatest: g.elevationDeg > MOON_HORIZON_DEG,
      end: up(eclipse.contacts.penumbralEnd),
    },
    moonAtGreatest: g,
  };
}

/** Topocentric solar-eclipse geometry at a place and instant. */
function solarGeometry(
  at: Date,
  place: Place,
): {
  separationDeg: number;
  sunSemidiameterDeg: number;
  moonSemidiameterDeg: number;
  sunElevationDeg: number;
  sunAzimuthDeg: number;
} {
  const T = julianCenturiesTT(at);
  const moon = lunarEquatorial(T);
  const sun = solarEquatorial(T);
  const topo = topocentricEquatorial(moon, at, place.latitude, place.longitude);
  const sunHz = toHorizontal(sun, at, place.latitude, place.longitude);
  // The Moon's topocentric semidiameter grows with its altitude (Meeus 55.1); the Sun's parallax
  // of 8.8″ is below the series' own accuracy and left out.
  const moonHz = toHorizontal(topo, at, place.latitude, place.longitude);
  const sinPi = Math.sin(moon.parallaxDeg * DEG);
  const moonSemidiameter =
    MOON_SEMIDIAMETER_RATIO * moon.parallaxDeg * (1 + Math.sin(moonHz.elevationDeg * DEG) * sinPi);
  return {
    separationDeg: separationDeg(
      unit(topo.rightAscensionDeg, topo.declinationDeg),
      unit(sun.rightAscensionDeg, sun.declinationDeg),
    ),
    sunSemidiameterDeg: SUN_SEMIDIAMETER_1AU_DEG / sun.distanceAu,
    moonSemidiameterDeg: moonSemidiameter,
    sunElevationDeg: sunHz.elevationDeg,
    sunAzimuthDeg: sunHz.azimuthDeg,
  };
}

/**
 * The solar eclipse a place sees at a new Moon, if any: the hours around it scanned a minute
 * apart for the Moon's topocentric disc against the Sun's while the Sun is up. Null when the
 * discs never overlap from here or the Sun is down throughout.
 */
export function solarEclipseAt(newMoon: Date, place: Place): SolarEclipseHere | null {
  const T = julianCenturiesTT(newMoon);
  if (Math.abs(lunarEquatorial(T).eclipticLatitudeDeg) > ECLIPSE_LATITUDE_LIMIT_DEG) return null;
  const centre = newMoon.getTime();
  const times: number[] = [];
  for (let t = centre - 4 * 60 * MINUTE; t <= centre + 4 * 60 * MINUTE; t += MINUTE) times.push(t);
  const geo = times.map((t) => solarGeometry(new Date(t), place));
  const overlapping = (g: ReturnType<typeof solarGeometry>) =>
    g.separationDeg < g.sunSemidiameterDeg + g.moonSemidiameterDeg;
  const sunUp = (g: ReturnType<typeof solarGeometry>) => g.sunElevationDeg > SUN_HORIZON_DEG;
  const visible = geo.map((g) => overlapping(g) && sunUp(g));
  if (!visible.includes(true)) return null;
  // Greatest eclipse here: the deepest coverage while the Sun is up.
  let gi = -1;
  geo.forEach((g, i) => {
    if (!visible[i]) return;
    if (gi < 0) gi = i;
    else {
      const a = g.sunSemidiameterDeg + g.moonSemidiameterDeg - g.separationDeg;
      const b = geo[gi]!.sunSemidiameterDeg + geo[gi]!.moonSemidiameterDeg - geo[gi]!.separationDeg;
      if (a > b) gi = i;
    }
  });
  const depth = (t: number) => {
    const x = solarGeometry(new Date(t), place);
    return x.sunSemidiameterDeg + x.moonSemidiameterDeg - x.separationDeg;
  };
  // Refine the greatest instant between its neighbours (ternary search on the coverage), but
  // never past the horizon the scan already respected.
  let lo = times[Math.max(0, gi - 1)]!;
  let hi = times[Math.min(times.length - 1, gi + 1)]!;
  for (let i = 0; i < 20; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (depth(m1) > depth(m2)) hi = m2;
    else lo = m1;
  }
  let greatestMs = Math.round((lo + hi) / 2000) * 1000;
  // When the deepest coverage falls at sunrise or sunset, greatest eclipse here is the horizon
  // second itself (bisected between the visible sample and its sun-down neighbour).
  if (!sunUp(solarGeometry(new Date(greatestMs), place))) {
    const sample = times[gi]!;
    const neighbour = greatestMs < sample ? times[gi - 1] : times[gi + 1];
    greatestMs =
      neighbour === undefined
        ? sample
        : refineEdge(neighbour, sample, (t) => sunUp(solarGeometry(new Date(t), place))).getTime();
  }
  const g = solarGeometry(new Date(greatestMs), place);
  const magnitude =
    (g.sunSemidiameterDeg + g.moonSemidiameterDeg - g.separationDeg) / (2 * g.sunSemidiameterDeg);
  const obscuration = discObscuration(g.sunSemidiameterDeg, g.moonSemidiameterDeg, g.separationDeg);
  const totalAt = (x: ReturnType<typeof solarGeometry>) =>
    x.separationDeg + x.sunSemidiameterDeg <= x.moonSemidiameterDeg;
  const annularAt = (x: ReturnType<typeof solarGeometry>) =>
    x.separationDeg + x.moonSemidiameterDeg <= x.sunSemidiameterDeg;
  const type: SolarEclipseHere['type'] = totalAt(g)
    ? 'total'
    : annularAt(g)
      ? 'annular'
      : 'partial';
  const insideVisible = (t: number) => {
    const x = solarGeometry(new Date(t), place);
    return overlapping(x) && sunUp(x);
  };
  const span = spell(times, visible, insideVisible)!;
  const centralAt = type === 'total' ? totalAt : annularAt;
  const insideCentral = (t: number) => {
    const x = solarGeometry(new Date(t), place);
    return sunUp(x) && centralAt(x);
  };
  let central =
    type === 'partial'
      ? null
      : spell(
          times,
          geo.map((x, i) => visible[i]! && centralAt(x)),
          insideCentral,
        );
  // A totality shorter than the minute between samples (the edge of the path) falls between
  // them: greatest eclipse is known to be inside it, so bisect out from there.
  if (type !== 'partial' && !central) {
    const i = times.findIndex((t) => t > greatestMs);
    const before = times[i - 1];
    const after = times[i];
    central =
      before === undefined || after === undefined
        ? null
        : {
            start: refineEdge(before, greatestMs, insideCentral),
            end: refineEdge(after, greatestMs, insideCentral),
          };
  }
  // Part of the overlap falls with the Sun below the horizon on either side: sunrise, not the
  // Moon, opens the eclipse here, or sunset closes it.
  const first = visible.indexOf(true);
  const last = visible.lastIndexOf(true);
  const clipped = {
    start: first > 0 && overlapping(geo[first - 1]!) && !sunUp(geo[first - 1]!),
    end: last < geo.length - 1 && overlapping(geo[last + 1]!) && !sunUp(geo[last + 1]!),
  };
  return {
    kind: 'solar',
    type,
    newMoon,
    greatest: new Date(greatestMs),
    magnitude,
    obscuration,
    start: span.start,
    end: span.end,
    centralStart: central?.start ?? null,
    centralEnd: central?.end ?? null,
    sunAtGreatest: { elevationDeg: g.sunElevationDeg, azimuthDeg: g.sunAzimuthDeg },
    clipped,
  };
}

/**
 * The eclipses of the coming `months` from `from`, as seen from `place`: every solar eclipse the
 * place sees at all (the Sun up for some of it) and every lunar eclipse anywhere, each with
 * whether the Moon is up here. In time order.
 */
export function eclipsesAhead(place: Place, from: Date, months = 12): EclipseHere[] {
  const until = from.getTime() + months * 30.44 * 86_400_000;
  // Four principal phases a lunation, 12.37 lunations a year.
  const phases = nextMoonPhases(from, Math.ceil(months * 4.13) + 2);
  const out: EclipseHere[] = [];
  for (const p of phases) {
    if (p.at.getTime() > until) break;
    if (p.phase === 'full') {
      const e = lunarEclipseAt(p.at);
      if (e) out.push(lunarEclipseHere(e, place));
    } else if (p.phase === 'new') {
      const e = solarEclipseAt(p.at, place);
      if (e) out.push(e);
    }
  }
  return out;
}
