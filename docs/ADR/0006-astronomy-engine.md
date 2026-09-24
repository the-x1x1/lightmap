# ADR-0006: Own Meeus/Almanac astronomy engine behind `AstronomyService`

**Status:** Accepted · **Date:** 2026-09 · **Plan:** §8, §27, §45

## Context

Sun position is the product's deterministic core: light direction, shadow direction, colour
temperature, twilight bands and the E2E acceptance values all derive from it. It must run on every
timeline tick in the browser (< 16 ms budget, in practice microseconds), be validated against a
trusted ephemeris, carry no licensing risk, and be replaceable if a use case (eclipses, precise
moonrise) ever needs more precision. The plan allows a permissively licensed dependency or a
documented algorithm, and forbids pasting source from websites.

## Decision

1. **Implement the algorithms ourselves from published references**, in `packages/astronomy`:
   - Sun: Jean Meeus, _Astronomical Algorithms_ (2nd ed.), ch. 25 low-accuracy solar coordinates with
     nutation/aberration for apparent longitude, ch. 22 mean obliquity, ch. 12 sidereal time,
     ch. 13 equatorial → horizontal; equation of time from ch. 28. Same family of formulae as NOAA's
     Solar Calculator. Refraction is reported separately as `apparentElevationDegrees`.
   - Moon: _The Astronomical Almanac_ section D low-precision geocentric lunar formulae, with the
     topocentric parallax correction (matters for moonrise), illuminated fraction per Meeus ch. 48.
   - Events: rise/set/twilight crossings by iterative root finding on the same position functions;
     golden and blue hour windows defined on elevation bands; polar day/night handled explicitly.
   - Time: IANA zone conversion via `Intl.DateTimeFormat` (no tz database shipped), DST and
     date-line safe.
     Every constant is a published one; nothing was copied from a website or a library.
2. **Validated against the US Naval Observatory** (`tests/fixtures/usno-golden.json`): event times
   within ±1 min (±2 min above 66° latitude), sun direction within 0.02° (angular separation),
   moon illumination within 3 %. Stated accuracy: **sun ≈ 0.01°, moon ≈ 0.3°** (rise/set ±3 min,
   illumination ±2 %), for 1950–2050. The moon's accuracy note is surfaced in the UI.
3. **Zero runtime dependencies.** The package has no `dependencies`; it runs in the browser, in
   Node tests and in scripts identically.
4. **Behind an interface.** `AstronomyService` (`getSolarState`, `getLunarState`, `getDayEvents`)
   is the only thing the scene, renderer and UI import. `SolarState` carries azimuth, elevation
   (true and apparent), zenith, `isAboveHorizon`, solar time, declination, equation of time,
   distance, light phase, twilight band and compass label.
5. **Swap-in path.** If higher lunar precision is ever required (eclipse work, sub-0.1° moon
   framing), the MIT-licensed **astronomy-engine** is the intended replacement or supplement,
   implemented as a second `AstronomyService` and selected in one place, with the same golden tests
   run against it. No caller changes.

## Consequences

- The sun in the UI, the renderer's `DirectionalLight` and the E2E assertions are the same numbers
  from the same code (see ADR-0002).
- No licence to audit for the most important calculation in the product; no bundle weight from an
  ephemeris library.
- The golden test set doubles as living documentation of accuracy; adding a location is a JSON row.
- Lunar accuracy (0.3°) is adequate for "where will the moon be in frame" and honest about its
  limits; it is not an eclipse ephemeris. The UI says so.
- Validity range is 1950–2050 for the stated accuracy; beyond it results degrade gracefully but are
  not guaranteed. Reverse planning (Phase 6) stays well inside it.
- Refraction and horizon dip are approximations (standard atmosphere, sea-level horizon); the
  confidence note does not overstate sunrise precision at high altitude or over mountains.

## Alternatives considered

- **SunCalc (BSD-2).** Ubiquitous, but lower accuracy (≈ 0.1–0.5° sun, coarse moon), no twilight
  bands beyond a fixed table, and unmaintained; not enough for a product whose trust rests on the
  sun being right.
- **astronomy-engine (MIT).** Excellent accuracy (arcminute moon, planets), ~100 KB; a good choice.
  Not adopted for v0.1 because the sun's requirements are met by ~400 lines we fully understand, and
  the interface keeps it available as the upgrade path.
- **Cesium's built-in `Simon1994PlanetaryPositions`.** Would tie the ephemeris to the renderer and
  make the Quality-0 path and server code depend on Cesium; kept only as a debug cross-check.
- **Server-side computation.** Rejected: the timeline must not touch the network per tick
  (plan §3, §27).
- **VSOP87 / full ELP2000 implementations.** Far more precision than the product can display;
  large tables; not justified.
