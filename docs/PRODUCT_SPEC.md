# Product Specification

Canonical behaviour of LightMap v0.1. Where the implementation and this document disagree, one of
them is a bug; fix whichever is wrong and update the other. Plan section references are to the
master implementation plan.

## 1. Main screen (plan §4, §20)

Full-screen map with the planning controls in a bottom sheet (mobile) or a compact side panel
(desktop). The map and preview are the hero; the screen must not read as a GIS workstation.

| Region        | Contents                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Top           | Brand mark (from the central brand config, never a hard-coded string), location search, account button                                                                               |
| Centre        | Interactive globe (Cesium) or, when WebGL is unavailable, the Quality-0 map lighting overlay; a dropped pin; sun-direction and shadow-direction overlays once a location is selected |
| Sheet / panel | Selected location label, date control, time readout, timeline scrubber, weather mode/scenario controls, preview panel, "Save to project"                                             |

The sheet can be dragged up for details; the preview can expand full-screen; scenario controls
scroll horizontally on narrow screens. Projects are accessible without leaving the current
location.

Dark-first: near-black chrome, neutral grey panels, high-contrast text, a warm golden accent for the
sun, a cool blue accent for twilight.

## 2. Location selection (plan §4)

A user may:

- **search** a place or address (server-side geocoder, one debounced request per query);
- **tap/click** the map (client-side pick: terrain surface → ellipsoid fallback);
- **paste coordinates** in decimal degrees (`21.397, -157.725`), degrees/minutes/seconds, or a
  `lat,lng` pair with optional hemisphere letters; parsing is local and needs no network;
- **use device location** when the browser grants permission (opt-in, never requested on load).

Selecting a location stores in client state: latitude, longitude, elevation when known, IANA time
zone, human-readable label, and the `source` of the selection (`search | map-click | coordinates |
device | saved | fixture`). Nothing is sent to the server until the user explicitly saves.

The chosen wall-clock time is preserved across location changes: "12:30" stays "12:30" at the new
place, in the new zone.

## 3. Time control (plan §4)

The most important interaction. The timeline is a range input over the civil day at the location
(0–1439 minutes since local midnight).

Markers drawn along the track: dawn (civil), sunrise, morning golden hour, solar noon, evening
golden hour, sunset, blue hour, civil/nautical/astronomical dusk, night. Markers move when the date
or location changes.

Scrubbing updates the astronomical state synchronously on every tick (target < 16 ms); expensive
visual refresh (terrain re-light, shadow map) is debounced.

Keyboard, when the thumb has focus:

| Key               | Effect          |
| ----------------- | --------------- |
| ← / →             | ±1 minute       |
| PageUp / PageDown | ±1 hour         |
| Home              | jump to sunrise |
| End               | jump to sunset  |

The thumb has `aria-valuetext` carrying the time and the current light phase (for example
"18:42, golden hour"). A "Now" action resets date and time to the present at the location.

Date is chosen with a date control; DST-transition days and date-line locations are handled by the
astronomy package's time-zone helpers (see QA_PLAN for the covered cases).

## 4. Weather and atmosphere control (plan §4, §9)

The weather **mode** is decided by one pure function (`decideWeatherMode`) from the selected
instant, "now", and the provider's declared horizon. Details are in
`WEATHER_AND_FORECAST_MODEL.md`. Behaviour by mode:

| Mode                | When                                                        | What the user sees                                                                       |
| ------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `FORECAST`          | ≤ 7 days ahead                                              | "Forecast" badge (HIGH ≤ 48 h, MEDIUM after). Forecast-driven atmosphere is shown first. |
| `EXTENDED_FORECAST` | 8–16 days ahead                                             | "Extended forecast — low confidence" badge. Still forecast-driven.                       |
| `SCENARIO`          | Beyond the provider horizon, no provider, or provider error | "Forecast unavailable this far ahead — compare scenarios." Scenario buttons take over.   |
| `RECENT_PAST`       | ≤ 92 days ago                                               | "Recent conditions from the provider archive."                                           |
| `PAST`              | Older than the archive                                      | "Historical weather … is not loaded — showing a scenario." Behaves like SCENARIO.        |

Five scenarios, always available: **Clear · Mostly Clear · Partly Cloudy · Overcast · Rain / Storm**.
Their render parameters are deterministic constants (see the scenario table in
`WEATHER_AND_FORECAST_MODEL.md`).

**Compare scenario.** Inside the forecast window the user may still pin a scenario to compare it
with the forecast (`forceScenario` in the planner store). While pinned, the badge reads "Comparing
scenario: Overcast (forecast: Partly Cloudy)" so the forecast is never hidden. Unpinning returns to
the forecast. Outside the forecast window there is nothing to compare against; the scenario is
simply the atmosphere and is labelled as such.

**Hour by hour** (Pro, entitlement `forecast_detail`). Under the timeline whenever frames exist for
the day (forecast, extended forecast or recent past — never on a scenario day): one bar per local
hour, height = direct-light share from cloud (`parametersForForecast`), colour = scenario class,
a drop for likely rain (≥ 40 % probability or ≥ 0.5 mm); the selected hour is outlined; clicking a
bar moves the timeline to that hour. "Best light: 07:00–11:00 (92 % direct)" lists contiguous runs
≥ 60 % direct. The same numbers are available as a table. Hours the provider did not cover are
absent; DST gaps produce no duplicate rows (`hourlyOutlook`, tested). Free plans see the locked
block with the paywall reason.

**Typical for this month** (Pro, entitlement `climatology`). Under the scenario buttons: the share
of daylight hours in this calendar month over the last ten years that fell in each scenario class,
from ERA5 reanalysis via Open-Meteo's archive, plus mean cloud cover and the fraction of wet days.
Badge: **Climatology · not a forecast**. Each class is a button that compares that scenario; the
most common one is marked, nothing is selected silently. Free plans see the locked block with the
paywall reason. Rules and method in `WEATHER_AND_FORECAST_MODEL.md` §8.

## 5. Preview panel (plan §4)

Always visible when a location is selected:

- the visual scene (Cesium terrain preview at Quality 1, or the Quality-0 overlay);
- **source label** (section 6) and **confidence** summary (section 7);
- local date and time with zone abbreviation;
- solar elevation and azimuth (degrees, plus compass sector);
- weather mode and scenario/forecast summary line;
- local sunrise and sunset;
- provider attribution for terrain, imagery and weather currently on screen.

Expandable "Why does it look like this?" section: light geometry relative to the camera (front-lit,
side-lit, back-lit, top-lit, below horizon), colour temperature (K), twilight band, golden/blue
hour windows, moon altitude/azimuth/phase, active atmosphere parameters, and a one-line reason per
confidence dimension.

**Export card** (Pro, entitlement `export_preview`): one PNG (1200 px wide) built in the browser
from the current frame (captured at 1280 px from the renderer, or the sky-gradient band when the
3D preview is unavailable) plus the facts above — place, coordinates, zone, date/time, sun
elevation/azimuth, light phase and colour temperature, sunrise/sunset, golden and blue hour, solar
noon, moon, camera heading/pitch/lens. The card always shows the source label as a text badge, the
weather line prefixed **Forecast (provider)** / **Observed** / **Scenario (not a forecast)**, the
five confidence dimensions, the honesty note for the source mode, provider attribution, and
"Made with LightMap · URL · timestamp". Nothing on the card is generated; the file name is
`lightmap-<place>-<date>-<time>.png`. Free plans see the paywall reason instead.

## 6. Source labels (plan §2, §11)

Every preview carries exactly one of three labels. They describe what the picture _is_, not how
good it looks.

| Label                  | Shown when                                                                                          | Can claim                                                                                                                                                  | Cannot claim                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Real Reference**     | A licensed photograph or panorama near the point is displayed (imagery confidence `REAL_REFERENCE`) | The place looks like this; attribution, capture date/time and heading when known                                                                           | That the image was taken at the requested date, time or weather unless it actually was                |
| **Simulated Lighting** | Terrain confidence HIGH and scene detail not LOW                                                    | Geometry is real terrain and map data; light direction, shadow direction, sky state and colour temperature follow astronomy and the selected weather state | Exact surface appearance, vegetation, small structures, or anything beyond what the geometry contains |
| **Estimated Preview**  | Everything else (no terrain, flat ellipsoid, coarse basemap)                                        | Light direction and sky state are exact; the scene is an approximation                                                                                     | Terrain relief, real horizons, or any detail of the place                                             |

In v0.1 **Real Reference never appears**: no imagery provider is contracted
(`REFERENCE_IMAGERY_PROVIDER=none`). The UI works without it.

## 7. Confidence panel (plan §11)

Independent dimensions, never a single percentage:

| Dimension      | Values                         | Rule                                                                                                  |
| -------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Astronomy      | HIGH · LOW                     | HIGH whenever the location and time zone are valid                                                    |
| Terrain        | HIGH · LOW                     | HIGH with a real terrain provider; LOW on the flat ellipsoid or when terrain fails                    |
| Scene detail   | HIGH · MEDIUM · LOW            | HIGH = street-level basemap with buildings; MEDIUM = street or regional basemap; LOW = coarse basemap |
| Weather        | HIGH · MEDIUM · LOW · SCENARIO | From the horizon decision (§4); SCENARIO also when the provider fails                                 |
| Real reference | Available · Unavailable        | Whether a licensed image is on screen                                                                 |

Environment (used internally) combines terrain and scene detail. Each dimension carries a
one-line, user-facing reason. Example:

```
Preview basis
Astronomy       High      Sun and moon positions computed from ephemeris (±0.01° sun, ±0.3° moon)
Terrain         High      Real terrain; imagery without 3D buildings
Scene detail    Medium
Weather         Scenario  Forecast unavailable this far ahead (250 days) — compare scenarios
Real reference  Unavailable   No licensed real photograph available — simulation only
Overall: SIMULATED LIGHTING
```

## 8. Camera and viewpoint model (plan §5)

`CameraState` = eye position, eye height (default 1.7 m), heading, pitch, horizontal FOV, optional
focal-length preset, and mode.

- **Map mode**: orbit the pin from above; the sun and shadow arrows are drawn on the ground.
- **Viewpoint mode**: eye-level first person at the pin. The sun's position in frame is shown
  when it is within the FOV; otherwise an edge indicator shows which way to turn.
- **Heading**: degrees clockwise from north, normalised to [0, 360). Rotate by drag, ← / → keys
  on the map, or a numeric field.
- **Pitch**: 0 level, positive up, clamped to ±89°.
- **Lens presets** (full-frame equivalent): 16, 24, 35, 50, 85, 135 mm. Default 24 mm.
- **FOV**: horizontal FOV from a 36 mm-wide sensor, `2·atan(36 / (2·f))`: 16 mm → 96.7°,
  24 mm → 73.7°, 35 mm → 54.4°, 50 mm → 39.6°, 85 mm → 23.9°, 135 mm → 15.2°. A free FOV
  (5°–120°) clears the preset.

No lens optical simulation (distortion, depth of field) in v1.

### 8a. Light finder — reverse planning (plan §26)

"I want the sun _there_ — when does that happen?" A collapsible section in the plan panel.

- **Target**: centre of the viewpoint camera's frame (heading → azimuth, pitch → elevation), the
  body's current position, or typed azimuth/elevation. Elevation matching can be switched off
  ("any elevation above the horizon").
- **Body**: sun, or moon with a minimum illuminated fraction (default 80 %).
- **Range**: civil dates at the location, default today → +365 days, capped at 1100 days.
  Free plans search inside their date window; the range is clipped and explained, never refused.
- **Tolerances**: azimuth ±2°, elevation ±1° by default; adjustable. Two detectors feed the
  result: the body crossing the target bearing (its elevation must be within the elevation
  tolerance) and, when an elevation is set, the body crossing that elevation (its bearing must be
  within the azimuth tolerance) — so "anywhere within ±5° of west at −0.8°" widens the answer as
  expected; duplicates within two minutes are merged.
- **Method**: `findDirectionMatches()` in `@lightmap/astronomy` samples the body's azimuth every
  10 minutes per civil day, detects crossings of the target bearing (ignoring the ±180° wrap) and
  refines each by bisection to ~1 s; elevation, phase and rising/setting trend are evaluated at the
  refined instant. Correct in the tropics (several crossings a day) and in polar summer (the sun
  circles). Runs in the browser; a year of sun alignments takes a few milliseconds.
- **Results**: count of moments and dates, each row `date · local time · elevation · rising/setting
(· % lit)`; selecting a row moves the planner to that instant so the preview shows it.
- **Honesty**: results are geometry only — terrain occlusion, clouds and near-horizon refraction
  are not part of the search; the note under the list says so and points to the preview.

Tests: equinox sunrise due east, solstice-noon elevation `90 − φ + δ`, Tromsø midnight sun at
`φ + δ − 90`, sunset-azimuth round trip against `computeDayEvents`, "sun on a ridge" windows,
tropical multi-crossing ordering, moon illumination filter (`packages/astronomy/tests/solver.test.ts`).

## 9. Projects and saved viewpoints (plan §4, §17)

Account required. Limits come from the entitlement snapshot, never from UI constants.

**Project**: `name`, optional `description`/notes, optional `shootDate`, `archivedAt`.

**Viewpoint**: `label`, `latitude`, `longitude`, `elevationM` (nullable), `timezone`,
`headingDeg`, `pitchDeg`, `fieldOfViewDeg`, `focalLengthEquivalentMm` (nullable),
`selectedDatetimeUtc`, `weatherMode`, `weatherScenario` (nullable), `previewSourceType`, plus an
app-generated thumbnail when the renderer can capture one. Reopening a viewpoint restores
location, UTC instant (rendered in the location's zone), camera and scenario exactly.

No collaboration or sharing in v0.1.

## 10. Accounts (plan §16)

- **Magic-link email** sign-in (Auth.js, database sessions).
- **Google** sign-in, optional, enabled only when `AUTH_GOOGLE_ID/SECRET` are configured.
- **Dev sign-in** (`AUTH_DEV_LOGIN=true`): a one-click local account for development and E2E.
  Refused by environment validation in production; the server will not start.
- Anonymous users can explore the map, scrub time and compare scenarios without an account.
- Account required for saving, subscribing and cross-device sync.
- Logout, session expiry, and an account-deletion request flow (14-day window, see `PRIVACY.md`).

## 11. Plans and entitlements (plan §15)

|                                             | Free                       | Photographer Pro             |
| ------------------------------------------- | -------------------------- | ---------------------------- |
| Map access, sun/twilight data               | Yes                        | Yes                          |
| Date window                                 | 14 days ahead, 7 days back | Unrestricted                 |
| Projects                                    | 1                          | Unlimited                    |
| Saved viewpoints                            | 3 (total and per project)  | 200 per project, 5,000 total |
| Preview quality ceiling                     | 1 (terrain preview)        | 3                            |
| Hourly forecast detail & comparison         | –                          | Yes                          |
| Moon planning                               | Basic                      | Yes                          |
| Planning-card export                        | –                          | Yes                          |
| Camera tools (lens presets, heading, pitch) | –                          | Yes                          |
| Light finder (reverse planning)             | Inside the date window     | Any range (≤ 1100 days)      |
| Typical conditions (climatology)            | –                          | Yes                          |

A Studio plan exists as a definition only (no Stripe price). The paywall shows the denial reason
from the entitlement decision; a subscription unlocks the current plan immediately after the
webhook lands. Details in `BILLING_AND_ENTITLEMENTS.md`.

## 12. Error handling (plan §34)

Every provider failure resolves to a usable state with a specific message.

| Failure                           | Behaviour                                                                                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Weather provider error or timeout | Badge: "Live forecast unavailable right now — showing your selected scenario." Weather confidence becomes SCENARIO. Scrubbing continues.        |
| Weather requested beyond horizon  | The client never asks; the API returns 422 `outside_horizon` if it does.                                                                        |
| Terrain provider unavailable      | Render on the flat WGS84 ellipsoid; terrain confidence LOW; source label degrades to Estimated Preview.                                         |
| Imagery tiles fail                | Fall back to the bundled Natural Earth II basemap; environment confidence drops.                                                                |
| Geocoder unavailable              | Search shows "Place search unavailable — paste coordinates instead"; coordinate entry and map clicks keep working.                              |
| Billing provider unavailable      | Checkout/portal show an error; **no entitlement is ever granted** because the server snapshot is derived only from stored subscription records. |
| Real imagery unavailable          | Always true in v0.1; simulation is unaffected.                                                                                                  |
| No WebGL                          | Quality-0 map lighting overlay with sun arrow, shadow arrow, twilight band and sky gradient.                                                    |
| Database unavailable              | Anonymous planning still works (no persistence); saving and sign-in report the outage.                                                          |

Generic "Something went wrong" is not acceptable when a recovery message exists.

## 13. Accessibility (plan §28)

- **Keyboard**: a skip link ("Skip to planning controls") is the first focusable element; the
  header (search, account) precedes the map in the DOM. The timeline is fully keyboard operable
  (arrows, Page Up/Down, Home/End, `[`/`]` to the previous/next day event) with `aria-valuetext`.
  Every single-choice group (view mode, lens, weather scenario, light-finder body and target) is a
  WAI-ARIA radio group with one Tab stop and arrow-key selection (`useRovingRadio` /
  `RadioGroup` in `@lightmap/ui`); locked options stay focusable and announce why ("Pro").
  The map has a visible focus ring; `role="application"` is used only in viewpoint mode where the
  arrow keys look around.
- **Names**: every control has a label; visible text is always part of the accessible name; icon-
  only buttons have `aria-label`s; result rows and cards name their subject ("Open Kailua Beach").
- **Announcements**: permanent `role="status"` regions (mounted once, text changes) announce search
  progress and result counts, pin placement, renderer loading, project/viewpoint saves and deletes,
  export progress, forecast loading and finder results; failures use `role="alert"`; standing
  notices ("Live forecast unavailable") use `status` so they are not re-announced on every mount.
- **Focus management**: switching panel sections moves focus to the panel body; deleting a
  project or viewpoint moves focus to the list heading; collapsing the expanded preview returns
  focus to the expand button; the account menu (Radix) restores focus itself unless it opened a
  panel. The collapsed mobile sheet is `inert`, so hidden controls cannot take focus. There are no
  modal dialogs in v0.1 (the paywall and sign-in render inline).
- **Not colour-only**: badges, confidence levels, selected cards and radio options carry text or a
  glyph in addition to colour; timeline markers show glyphs on phones.
- **Reduced motion**: CSS transitions are disabled globally under `prefers-reduced-motion`; the
  renderer receives `render.reducedMotion` and jumps the camera instead of flying (tested); the
  preference is tracked live, not read once.
- **Contrast**: body and helper text use `--lm-text-muted` (≥ 4.5:1 on the panel); the faint tone
  is reserved for decorative or duplicated text (coordinates under a search result, attribution).
- Touch targets ≥ 44 px on the timeline thumb and scenario buttons.

## 14. Acceptance case (plan §25 Phase 1, §42)

**Kailua Beach, Hawaii · 31 May 2026 · 12:30 HST** (UTC−10, no DST → 22:30 UTC).

Expected on screen (USNO reference values):

- Sun elevation ≈ **89.3°** (nearly overhead, slightly north); azimuth is ill-conditioned this
  close to the zenith, so tests compare direction vectors, not azimuth alone.
- Sunrise **05:48**, sunset **19:09**, transit 12:29.
- Source label **Simulated Lighting** with a real terrain provider, **Estimated Preview** on the
  ellipsoid fixture.
- Weather mode **scenario-labelled**: the date is outside Open-Meteo's 16-day forecast window
  at build time (and the 92-day archive), so the UI shows "Forecast unavailable … compare
  scenarios" and never the word "Forecast" as a claim.
- Switching Clear → Overcast visibly changes the scene: shadows disappear, sky luminance drops,
  contrast and saturation fall.
- Dragging the timeline changes light continuously; the camera can be rotated and the heading
  readout follows.

## 15. What LightMap is not (plan §37)

Not in the product, not on the roadmap: social feed, followers, likes, comments, user photo uploads,
public photo submissions, crowdsourced image ingestion, generic AI chat, photographer or equipment
marketplaces, location recommendation or discovery feeds, complex team administration, desktop
native wrapper, separate iOS/Android codebases, server GPU render farm, custom weather model,
custom global tile infrastructure, ads.
