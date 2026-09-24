# Weather and Forecast Model

How LightMap turns "what will the sky do?" into something honest and renderable. Source of truth:
`packages/weather/src/{model,horizon,scenarios}.ts` and the Open-Meteo adapter in
`packages/weather/src/providers/open-meteo.ts`.

## 1. Three different things

|                 | What it is                                                     | Where it comes from                                           | How it is labelled                                          |
| --------------- | -------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| **Forecast**    | A numerical weather model's prediction for a specific hour     | The configured `WeatherProvider`, inside its declared horizon | "Forecast" / "Extended forecast — low confidence"           |
| **Scenario**    | A user-chosen, deterministic set of atmosphere parameters      | `SCENARIOS` constants                                         | "Scenario: Overcast", "Forecast unavailable this far ahead" |
| **Climatology** | Historical frequency of conditions for a place, month and hour | Phase 7, not implemented                                      | "Typical for this month" — never "Forecast"                 |

Rules (plan §1, §9): do not pretend weather is known beyond the forecast horizon; do not silently
use historical weather as a future forecast; label scenarios as scenarios.

## 2. Horizon decision

`decideWeatherMode(selected, now, capabilities)` is the single place the UX mode is chosen. The
provider declares `reliableHorizonHours`, `maxHorizonHours` and `historicalDays`; Open-Meteo
declares 7 days, 16 days and 92 days.

| Lead time (selected − now) | Mode                | Weather confidence | Fetch? | User-facing reason                                                     |
| -------------------------- | ------------------- | ------------------ | ------ | ---------------------------------------------------------------------- |
| ≤ 48 h ahead               | `FORECAST`          | HIGH               | yes    | "Forecast"                                                             |
| 48 h – 7 days ahead        | `FORECAST`          | MEDIUM             | yes    | "Forecast, N days ahead"                                               |
| 8 – 16 days ahead          | `EXTENDED_FORECAST` | LOW                | yes    | "Extended forecast, N days ahead — low confidence"                     |
| > 16 days ahead            | `SCENARIO`          | SCENARIO           | no     | "Forecast unavailable this far ahead (N days) — compare scenarios"     |
| 0 – 92 days ago            | `RECENT_PAST`       | HIGH               | yes    | "Recent conditions from the provider archive"                          |
| > 92 days ago              | `PAST`              | SCENARIO           | no     | "Historical weather for N days ago is not loaded — showing a scenario" |
| No provider configured     | `SCENARIO`          | SCENARIO           | no     | "No weather provider configured — choose a scenario"                   |
| Provider call fails        | (mode unchanged)    | SCENARIO           | –      | "Live forecast unavailable — showing your selected scenario"           |

`PAST` is deliberately treated as a scenario: the archive could be fetched, but until a product
reason exists LightMap does not spend requests on it and does not imply it knows.

The API refuses to fetch when `fetchWorthwhile` is false (HTTP 422 `outside_horizon`); the client
already knows it is in scenario mode and should not have asked.

## 3. Normalised `WeatherFrame`

Every vendor response is converted into frames; nothing downstream knows the vendor.

| Field                                                              | Unit                  | Notes                                 |
| ------------------------------------------------------------------ | --------------------- | ------------------------------------- |
| `timestamp`                                                        | UTC ISO               | hourly frames start on the hour       |
| `cloudCoverTotal`                                                  | 0–100 %               | required                              |
| `cloudCoverLow` / `Mid` / `High`                                   | 0–100 % or null       |                                       |
| `precipitationProbability`                                         | 0–100 % or null       |                                       |
| `precipitationAmount`                                              | mm/hour or null       |                                       |
| `humidity`                                                         | 0–100 % or null       |                                       |
| `visibility`                                                       | metres or null        |                                       |
| `windSpeed`                                                        | m/s or null           |                                       |
| `windDirection`                                                    | degrees from, or null | interpolated as an angle              |
| `weatherCode`                                                      | WMO 4677 or null      | nearest frame wins when interpolating |
| `directNormalIrradiance`, `diffuseRadiation`, `shortwaveRadiation` | W/m², optional        |                                       |

`interpolateFrame(frames, at)` gives a linear blend between the two bracketing hourly frames so
scrubbing is continuous; null fields interpolate as null. A `WeatherSeries` wraps the frames with
the grid-cell coordinate, model elevation, `issuedAt`, `fetchedAt` and the provider capabilities
(including attribution and commercial review state).

## 4. From a frame to atmosphere parameters

`parametersForForecast(frame)` is pure and unit tested:

1. **Cloud cover → base parameters.** Piecewise-linear interpolation of every parameter between the
   four non-storm scenario anchors (cloud cover 0.05, 0.25, 0.55, 0.95). A 40 % forecast renders
   as 40 % cloud, not snapped to "Partly Cloudy".
2. **Low cloud cuts direct light further.** `sunTransmittance *= (1 − 0.5·low)` and
   `cloudDensity += 0.3·low`, because the same amount of low cloud blocks the sun more than high
   cloud.
3. **Visibility → haze.** ≥ 40 km → 0.05; ≥ 20 km → 0.15; ≥ 10 km → 0.30; ≥ 5 km → 0.50;
   ≥ 1 km → 0.75; < 1 km → 0.95 (fog: transmittance ≤ 0.15, diffuse ≥ 0.9, contrast ≤ 0.7).
   Haze is the maximum of the cloud-derived and visibility-derived values.
4. **Rain blends toward storm.** A frame counts as rainy when precipitation ≥ 0.5 mm, probability
   ≥ 60 %, or WMO code ≥ 61. Parameters are blended toward the Storm anchor with weight
   `w = clamp((mm/2 + probability/100)/2 + 0.3)`, and `precipitation = w`.

For labelling, `scenarioForConditions()` maps a frame to the nearest named scenario: rain → Storm;
< 12 % → Clear; < 40 % → Mostly Clear; < 80 % → Partly Cloudy; else Overcast.

Colour temperature of direct light comes from solar elevation, not weather
(`DEFAULT_COLOR_TEMPERATURE_CURVE`: 2900 K at the horizon, 3800 K at 5°, 5400 K at 20°, 5600 K
overhead, cooling through 7800–9000 K in twilight). The curve is configurable.

## 5. Scenario parameter table

From `SCENARIOS` in `scenarios.ts`. Deterministic; the same scenario always yields the same numbers.

| Scenario      | cloudCover | cloudOpacity | cloudDensity | sunTransmittance | diffuseFraction | skyLuminance | haze | saturation | contrast | precipitation |
| ------------- | ---------- | ------------ | ------------ | ---------------- | --------------- | ------------ | ---- | ---------- | -------- | ------------- |
| Clear         | 0.05       | 0.05         | 0.20         | 1.00             | 0.15            | 1.00         | 0.10 | 1.00       | 1.00     | 0             |
| Mostly Clear  | 0.25       | 0.30         | 0.35         | 0.92             | 0.25            | 1.00         | 0.15 | 0.98       | 0.97     | 0             |
| Partly Cloudy | 0.55       | 0.60         | 0.50         | 0.70             | 0.45            | 1.05         | 0.25 | 0.95       | 0.90     | 0             |
| Overcast      | 0.95       | 0.95         | 0.85         | 0.20             | 0.90            | 0.85         | 0.45 | 0.85       | 0.75     | 0             |
| Rain / Storm  | 1.00       | 1.00         | 1.00         | 0.08             | 0.97            | 0.55         | 0.70 | 0.70       | 0.65     | 1             |

Meaning: `sunTransmittance` drives shadow contrast and direct-light intensity; `diffuseFraction`
is the share of soft, directionless sky light; `skyLuminance` is relative sky brightness;
`cloudOpacity`/`cloudDensity` control how much cloud is drawn and how thick it reads; `haze` is
aerial perspective; `saturation`/`contrast` are grade multipliers around 1.0. These numbers are
physically motivated but deliberately simple; they are tuned for an _obvious_ visual difference
between Clear, Partly Cloudy and Overcast (plan §10), not for radiometric accuracy.

`cloudLayers` (low / mid / high cover, 0–1) is the representative split per scenario — Clear
0 / 0 / 0.05, Mostly Clear 0.15 / 0.05 / 0.15, Partly Cloudy 0.4 / 0.2 / 0.25, Overcast
0.75 / 0.8 / 0.4, Storm 1 / 1 / 0.6 — and `layersObserved` is false. For a forecast frame whose
provider reports `cloud_cover_low/mid/high` the layers are the frame's own and `layersObserved` is
true; the renderer draws each band as its own deck and lights it by height
(`RENDERING_ACCURACY.md` §Weather scenarios). A frame that is mostly thin high cloud keeps 55–85 %
of the direct beam regardless of its total cover.

## 6. Provider: Open-Meteo

- Adapter: `OpenMeteoProvider` (`api.open-meteo.com`, or `customer-api.open-meteo.com` with an API
  key). Hourly fields: cloud cover (total/low/mid/high), precipitation probability and amount,
  humidity, visibility, wind, weather code, DNI, diffuse and shortwave radiation.
- Horizon: 16 days hourly; LightMap treats ≤ 7 days as reliable. Archive: `past_days` up to 92.
- **Licensing.** The free tier is for **non-commercial** use (data CC BY 4.0, attribution
  required). A paid application requires an **Open-Meteo API subscription**. The adapter reports
  `commercialReview: 'conditional'` without `OPEN_METEO_API_KEY` and `'approved'` with it;
  environment validation warns in production when the key is missing.
- **Attribution** shown wherever weather data is on screen: "Weather data by Open-Meteo.com".
- Fixture provider (`WEATHER_PROVIDER=fixture`): deterministic frames for development and tests,
  labelled with the development banner, refused in production.

## 7. Caching and request budget (plan §19)

- Coordinates are quantised to a **0.05° grid cell** (≈ 5.5 km at the equator) before any request.
- One fetch per **(provider, version, grid cell, civil day at the location)**; key
  `weather:<provider>:v1:<cell>:<YYYY-MM-DD>`. Server cache lives in `provider_cache` (Postgres)
  with TTL = provider update interval (60 min) for forecasts, 6 h for recent past.
- The response carries the whole day of hourly frames; the client caches it in TanStack Query and
  **interpolates locally while scrubbing**. Moving the timeline never triggers a network request.
- Per-client burst limit (30/min) and daily budgets (40 anonymous / 150 free / 600 pro weather
  calls per day, in `usage_counters`) protect cost. Cache hits are not charged.

## 8. Climatology: "Typical for this month" (Phase 7, delivered)

Climatology ("May daylight hours here were Clear 44 %, Mostly clear 20 %, Partly cloudy 18 %,
Overcast 12 %, Rain 6 %") is the third thing of §1 — a distribution over past years, neither a
forecast nor a scenario.

- **Source**: ERA5 reanalysis via Open-Meteo's archive API (`open-meteo-era5`,
  `DATA_SOURCES_AND_LICENSING.md`), the last ten complete calendar years.
- **Method** (`summarizeClimatology`, `packages/weather/src/climatology.ts`): every hour of the
  month in every year is classified with the same `scenarioForConditions()` thresholds the live
  forecast uses (cloud cover < 12 % clear, < 40 % mostly clear, < 80 % partly cloudy, else overcast;
  ≥ 0.5 mm/h → storm), restricted to local daylight hours 06:00–20:00 in the location's zone;
  shares, mean cloud cover, wet-hour and wet-day fractions are reported with the year span and
  sample size.
- **Presentation**: a small "Typical for {month}" block under the scenario buttons with the badge
  **Climatology · not a forecast**; each class is a button that _compares_ that scenario (explicit
  user action — nothing is selected silently); the most common class is marked "most common".
  The summary line names the hours, the years and "history, not a prediction for your date".
- **Never**: rendered with a Forecast badge, given a confidence above SCENARIO, or turned into a
  deterministic prediction (plan §4, §25 Phase 7). `ClimatologySummary.kind` is `'CLIMATOLOGY'` and
  its `label` is fixed to "Typical for this month" so the wording cannot drift.
- **Cost**: one summary is up to ten upstream requests; cached 30 days per 0.5° cell × month
  (`provider_cache`, namespace `climatology`), budgeted per plan (`DAILY_BUDGET_LIMITS.climatology`),
  Pro entitlement `climatology` enforced server-side.
