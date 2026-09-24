# Rendering accuracy

"Accuracy before beauty" (plan §3). This document says exactly what each part of a LightMap preview
can claim, what it cannot, and where the numbers come from, so the UI's labels are backed by
engineering rather than intent.

## The three source labels

Every preview carries exactly one (`SceneState.sourceMode`, derived in
`packages/scene/src/confidence.ts`):

| Label | When | Can claim | Cannot claim |
|---|---|---|---|
| **Real Reference** | A licensed photograph/panorama near the coordinate is shown as evidence (Phase 5; disabled in v0.1) | This is what the place looks like; capture date/time and heading as the provider states them | That the photo matches the requested date/time or weather unless it literally does |
| **Simulated Lighting** | Terrain confidence HIGH and scene detail ≥ MEDIUM (real terrain + imagery of at least regional resolution) | Sun direction, elevation, shadow direction and length, twilight phase, colour temperature trend, terrain silhouette and relief, how cloud changes contrast/softness | Exact appearance of buildings, vegetation, water, people, signage; exact sky colours; exact cloud shapes |
| **Estimated Preview** | Anything less (flat ellipsoid, or coarse basemap only) | Sun geometry and phases (still exact); approximate light direction over a generic ground | Anything about what is physically there |

The label is never a percentage. The confidence panel shows the independent dimensions behind it.

## What is deterministic (HIGH confidence, years ahead)

Computed by `@lightmap/astronomy` from published algorithms (Meeus; Astronomical Almanac) and
validated against the US Naval Observatory (`packages/astronomy/tests/fixtures/usno-golden.json`):

| Quantity | Accuracy vs USNO | Notes |
|---|---|---|
| Sun azimuth/elevation | direction within 0.02° (elevation within 0.01°) | Geocentric apparent; refraction available separately for horizon display |
| Sunrise, sunset, civil twilight, solar noon | ±1 minute (±2 at 70° latitude where the Sun grazes the threshold) | USNO rounds to the minute |
| Nautical/astronomical twilight, golden/blue hour | Same method, thresholds −12°/−18°, −4°…+6°/−6°…−4° | Window definitions are photographic conventions, documented in `events.ts` |
| Polar day/night | Exact detection; USNO wording reproduced | Solar noon still reported in polar night (twilight peak) |
| Moon azimuth/elevation | ±0.3° | Low-precision Almanac series; topocentric parallax applied |
| Moon illumination and phase name | ±2–3 %; USNO naming convention | Principal phase named from its instant for ~1 day |
| Moonrise/set | ±3 min | |
| Time zone conversion | Exact for IANA zones via `Intl`; DST gap → shift forward, overlap → earlier instant | Zone lookup from coordinates is geo-tz (ODbL boundaries) |

## What is simulated

### Light direction and terrain shading
`scene.light` is a `DirectionalLight` whose ECEF direction is derived from the Sun's azimuth and
elevation at the pin (`renderer/src/sun-vector.ts`, unit tested). Terrain is lit by Cesium's globe
lighting with that vector; the Quality-0 overlay draws the same vector as an arrow. These agree by
construction. **Claim:** the light comes from the right direction. **Caveat:** at the pin, not at
every point of a large scene (parallax across a few kilometres is far below a degree).

### Shadows
Cesium's shadow map from the same light, cast and received by terrain (`globe.shadows = ENABLED`).
`shadowMap.darkness` rises with the scenario's diffuse fraction, so overcast shadows fade; shadows
are switched off when direct light is below 12 % or the Sun is below −0.833°. **Claim:** direction
and approximate length of terrain shadows; visible softening under cloud. **Caveat:** no
buildings/trees in v0.1 (no BuildingProvider configured); shadow map resolution is finite (1024–4096)
and fades beyond 8 km.

### Colour temperature
A configurable curve of elevation → Kelvin (`weather/src/scenarios.ts`,
`DEFAULT_COLOR_TEMPERATURE_CURVE`): 2900 K on the horizon, ~3800 K at 5°, neutral 5400–5600 K above
20°, 7800–9000 K in blue hour/twilight. Applied as the light's colour and as a frame tint, weakened
under cloud (diffuse light is whiter). **Claim:** the trend — golden low, neutral high, blue after
sunset. **Caveat:** real values vary with aerosol, altitude and humidity by hundreds of Kelvin.

### Sky and atmosphere
Cesium's sky atmosphere with `dynamicLighting = SCENE_LIGHT` follows our light, giving a horizon
glow on the Sun's side and darkness opposite. Hue/saturation/brightness shifts encode cloud and
haze; fog density encodes visibility. **Claim:** sky is bright/blue when clear and grey/flat when
overcast; twilight colours sit on the correct side of the sky. **Caveat:** not a spectral
scattering model (Phase 4); no real cloud shapes.

### Weather scenarios
Deterministic parameter sets (`SCENARIOS`) or continuous parameters derived from a forecast frame.
The post-process grade stage paints procedural clouds over sky pixels with coverage/density from
the parameters and adjusts contrast/saturation/haze globally. **Claim:** Clear vs Partly Cloudy vs
Overcast are visibly and consistently different in the ways that matter to a photographer (direct
light 100 % / 70 % / 20 %, contrast 1.0 / 0.9 / 0.75, sky luminance). **Caveat:** cloud placement is
noise, not a forecast of where clouds will be.

### Geometry
Terrain mesh from the configured `TerrainProvider` (Re:Earth/Mapterhorn or Cesium World Terrain)
and imagery from the `MapTileProvider`. With the default bundled Natural Earth II the ground texture
is coarse and the label drops to Estimated Preview. **Claim:** ridgelines and horizon shape relative
to the Sun. **Caveat:** DEM resolution (≈30 m globally, better in some regions); no buildings.

## What is never done

- No text-to-image generation as the scene source (plan §6).
- No AI step may relocate terrain, change the horizon, invent buildings, move the Sun, alter shadow
  direction or remove labels (plan Phase 8 rules). There is no AI step in v0.1.
- Climatology is never displayed as a forecast; forecasts beyond the provider horizon are never
  displayed at all — scenarios are.

## Quality ladder (plan §6)

| Quality | What renders | When |
|---|---|---|
| 0 | Sun/shadow overlay on a sky gradient; all numbers | No WebGL2, or renderer failure — always available |
| 1 | 3D terrain with directional light, shadows, atmosphere, scenario grade | Default with terrain |
| 2 | 1 + licensed high-resolution imagery | `IMAGERY_PROVIDER` configured |
| 3 | Buildings/3D tiles, physically based scattering | Future |

## How to verify

- `pnpm test --filter @lightmap/astronomy` — USNO golden set.
- `pnpm test --filter @lightmap/renderer` — sun vector mapping, lighting parameters, controller.
- Dev perf panel (press `` ` `` in development): shows Δ between LightMap's sun vector and Cesium's
  own ephemeris; expect < 0.5°.
- Manual: set Kailua, 31 May 2026 12:30 → sun 89° (near zenith, shadows nearly vertical); 18:45 →
  golden, shadows long toward the ENE; 19:30 → blue hour, no direct light.
