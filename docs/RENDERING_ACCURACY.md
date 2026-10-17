# Rendering accuracy

"Accuracy before beauty" (plan §3). This document says exactly what each part of a LightMap preview
can claim, what it cannot, and where the numbers come from, so the UI's labels are backed by
engineering rather than intent.

## The three source labels

Every preview carries exactly one (`SceneState.sourceMode`, derived in
`packages/scene/src/confidence.ts`):

| Label                  | When                                                                                                       | Can claim                                                                                                                                                           | Cannot claim                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Real Reference**     | A licensed photograph/panorama near the coordinate is shown as evidence (Phase 5; disabled in v0.1)        | This is what the place looks like; capture date/time and heading as the provider states them                                                                        | That the photo matches the requested date/time or weather unless it literally does                       |
| **Simulated Lighting** | Terrain confidence HIGH and scene detail ≥ MEDIUM (real terrain + imagery of at least regional resolution) | Sun direction, elevation, shadow direction and length, twilight phase, colour temperature trend, terrain silhouette and relief, how cloud changes contrast/softness | Exact appearance of buildings, vegetation, water, people, signage; exact sky colours; exact cloud shapes |
| **Estimated Preview**  | Anything less (flat ellipsoid, or coarse basemap only)                                                     | Sun geometry and phases (still exact); approximate light direction over a generic ground                                                                            | Anything about what is physically there                                                                  |

The label is never a percentage. The confidence panel shows the independent dimensions behind it.

## What is deterministic (HIGH confidence, years ahead)

Computed by `@lightmap/astronomy` from published algorithms (Meeus; Astronomical Almanac) and
validated against the US Naval Observatory (`packages/astronomy/tests/fixtures/usno-golden.json`):

| Quantity                                           | Accuracy vs USNO                                                                    | Notes                                                                                                                 |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Sun azimuth/elevation                              | direction within 0.02° (elevation within 0.01°)                                     | Geocentric apparent; refraction available separately for horizon display                                              |
| Sunrise, sunset, civil twilight, solar noon        | ±1 minute (±2 at 70° latitude where the Sun grazes the threshold)                   | USNO rounds to the minute                                                                                             |
| Nautical/astronomical twilight, golden/blue hour   | Same method, thresholds −12°/−18°, −4°…+6°/−6°…−4°                                  | Window definitions are photographic conventions, documented in `events.ts`                                            |
| Polar day/night                                    | Exact detection; USNO wording reproduced                                            | Solar noon still reported in polar night (twilight peak)                                                              |
| Moon azimuth/elevation                             | ±0.02°                                                                              | Meeus ch. 47 (abbreviated ELP-2000/82), nutation, topocentric parallax                                                |
| Moon illumination and phase name                   | ±1 %; USNO naming convention                                                        | Principal phase named from its instant for ~1 day                                                                     |
| Moonrise/set                                       | ±1 min                                                                              |                                                                                                                       |
| Principal phase instants (New/Quarter/Full)        | ±2 min against the almanac                                                          | Elongation bisected on the same series (`nextMoonPhases`)                                                             |
| Galactic Centre (Milky Way core) azimuth/elevation | ≈0.1° (precession to date; no nutation or aberration)                               | Sgr A* J2000 via Meeus 21.3–21.4; visibility verdict is geometry only (Sun depth, Moon, altitude), not sky brightness |
| Time zone conversion                               | Exact for IANA zones via `Intl`; DST gap → shift forward, overlap → earlier instant | Zone lookup from coordinates is geo-tz (ODbL boundaries)                                                              |

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
are switched off when direct light is below 12 % or the Sun is below −0.833° — and only then:
Cesium's default low-Sun fade (`shadowMap.fadingEnabled`) is **off**, because golden-hour shadows
are the product. Reach (`maximumDistance`) is 20 km at eye level and 3× the orbit range (8–60 km)
in map view, so a ridge's shadow crosses a valley. **Claim:** direction and length of shadows;
visible softening under cloud. **Verified:** the smoke harness renders a 20 m tower at Sun
elevation ≈ 11° and measures the frame — the ground along the shadow line is < 70 % as bright as
the Sun side and the point just beyond `h / tan(el)` is fully lit (`shadow-tower` scene).
**Caveat:** buildings are OpenStreetMap's (by default from OpenFreeMap's vector tiles, loaded
within about 2 km of where you stand or look, or Cesium OSM Buildings with an ion token): heights
are often estimated or missing (a building without one is drawn 6 m tall), roofs are flat and
facade colours are a pattern unless mapped; they cast and receive the terrain's shadows and are
lit by the same light. Trees are a pattern: OpenStreetMap's woods filled and its parks scattered
with generic trees, not the trees that stand there, so their shadows show the light's direction
and length but not a real tree's; street trees and single mapped trees are not drawn. The
terrain horizon and the ridge markers take the mapped buildings in within 2.5 km of the pin and
never the trees (see "Terrain horizon"); shadow map resolution is
finite (1024–4096) and softens with reach; terrain self-shadowing at grazing angles shows some
shadow-map artefacts.

### Terrain horizon

The land horizon around the viewpoint is sampled from the same DEM the preview renders
(`SceneHost.sampleGroundHeights`, three tile levels by distance) and turned into a 3°-step profile
with Earth curvature and standard refraction (`@lightmap/scene` `horizon.ts`). The Sun counts as
visible when its refracted upper limb clears the profile at its bearing. **Claim:** whether the
Sun is behind the ridge now, and the day's first/last light over the terrain to within a few
minutes for ridges the DEM resolves. With buildings on (the default) the mapped buildings
within 2.5 km of the pin join the profile (`SceneHost.sampleSurfaceHeights`: a roof where a
mapped building stands, from the loaded tiles at their finest detail, taken where it stands
higher than the terrain; sampled alongside the terrain, not after it), so "when does the sun
clear that block" is answered for a city viewpoint; the caveat then says the buildings are as
OpenStreetMap has them (heights often estimated or missing) and names both reaches. A pin that
falls on a footprint (geocoders land on building centroids) stands the viewer on that roof —
its own building would otherwise wall every bearing — and the caveat says to move the pin to
the street for the view from the ground. **Caveat:** trees (the drawn ones are a pattern, left out of the profile) and cloud on the
ridge are not in any model, and buildings only where mapped; a ridgeline can fall between the 3° bearings or the ring distances; DEM resolution
(≈30 m) rounds sharp crests; the eye-height dip uses the sampled ground height at the pin.
Terrain beyond the sampled reach (40 km) is unknown, not flat — the caveat says so. Verified:
synthetic-ridge and edge-of-day unit tests (`packages/scene/tests/horizon.test.ts`); on the
ellipsoid fallback (configured, or the real provider failing to load) the host answers "unknown"
for every sample, so no profile is produced and nothing is claimed.

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
overcast; twilight colours sit on the correct side of the sky. **Caveat:** Cesium's dome is its own
single-scattering model (not spectral); no real cloud shapes.

**Sky gradient (overlay mode, preview chrome, planning card).** The three colours of the clear
sky come from LightMap's own single-scattering model (`packages/renderer/src/sky-model.ts`,
Phase 4 "atmospheric scattering"): Rayleigh (λ⁻⁴, sea-level 5.8/13.5/33.1 × 10⁻⁶ m⁻¹ at
680/550/440 nm, 8 km scale height) plus Mie (21 × 10⁻⁶ m⁻¹, 1.2 km, Cornette–Shanks g = 0.76)
integrated along the view ray through a spherical 80 km atmosphere (32 view samples with the
optical depth taken at each sample's midpoint, 8 samples on each Sun ray; within ≈ 1 % of a
2048 × 64 reference), the aerosol density scaled by the scenario's haze. Four samples keep clear
of the Sun's aureole: overhead (≥ 40° from the Sun), mid-sky (30° up, 90° round), the horizon
away from the Sun (2° up, 90° round) and the glow (2° up, 25° round). They are tone-mapped on
luminance only so chromaticity is the physics', with one fixed exposure (a mid-afternoon zenith
lands on a mid-blue luminance). **Claim:** the paling of the blue overhead and of the horizon
with haze and with a lower Sun, and the hue of the sunrise/sunset glow and how haze deepens it,
follow the geometry and the scenario rather than a palette. **Caveat:** single scattering — no
ozone, no multiple scattering — under-blues the zenith at low Sun and goes dark in twilight, so
the model is blended into the long-standing hand-set colours rather than replacing them: 60 % of
the overhead, mid and horizon stops once the Sun is 20° up, fading to none by 6°; the glow's hue
from the model's sample at its own brightness while the Sun is above −9°; hand-set twilight and
night below (`skyGradientFor`). Checked in `sky-model.test.ts`: Rayleigh ordering and ratio,
horizon brighter/paler than zenith, sunset reddening on the Sun's side, haze paling, Earth-shadow
darkness, azimuth symmetry, exposure anchor. The Cesium dome does not use this model yet: behind
the feature flag `physicalSkyDome` the dome's and the ground atmosphere's Mie coefficient follow
the scenario's haze through the same `mieScaleForHaze` (Cesium's own value is restored when the
flag is off), and `tools/renderer-smoke` renders the storm scene both ways (`storm-viewpoint`
vs `storm-physical-dome`) so the flag can be judged on a contact sheet before it is enabled.

Two corrections compensate for the single-scattering model, both driven by the true Sun elevation
and never by taste: (1) **twilight** — the dome collapses within a degree of the light setting, so
the atmosphere light is clamped to a grazing −0.6° while the Sun is between −0.6° and −18°, and the
grade shader restores the real darkening (`nightFactor`) and the deep blue of civil twilight
(`blueHour` term, −6°…0°, warm glow preserved where the Sun set); (2) **aerial perspective** — far
ground is lifted toward the sky colour by depth, more strongly at low Sun (`horizonHaze`), tinted
by the light's colour. The light direction and terrain shading are untouched by either. Verified in
`tools/renderer-smoke` (contact sheet `docs/media/renderer-smoke-2026-09-24c.png`).

**Night sky.** In viewpoint mode, below a Sun elevation of −8°, the dome shows Cesium's star
field (its J2000 star cube), which Cesium turns by Greenwich sidereal time for the scene's
instant (`czm_temeToPseudoFixed`; the host sets the clock to the planned UTC) — so the Milky
Way's band in the 3D preview stands where the planner's own Galactic Centre says, within the
precession and nutation Cesium leaves out (≈ 0.4° in 2026; the planner's `milkyWayCore` applies
Meeus precession, ≈ 0.1°). The "Milky Way core" line, the rose star, the dark windows and the
map view's violet track are the authority where the two disagree. The star field is a texture:
no sky-brightness or airglow model, and it is faint under software GL (`README.md` "Known
limitations").

**City glow (estimate).** Under the Milky Way line the Moon section names the glow the towns
around the pin cast (`sky-glow.ts`): Walker's law over the bundled Natural Earth urban areas,
each adding its built-up area times the distance to its edge to the power −2.5 (2 km at least),
summed within 250 km and graded city (inside a built-up area), suburban, a glow on the horizon,
a faint dome low, or none, with the side the strongest glow is on. **Verified** against places of
known sky (Bortle class from published dark-sky surveys): Times Square and Versailles city; Red
Rock Canyon by Las Vegas suburban; Montauk Point a horizon glow; Big Bend, Mauna Kea, the Grand
Canyon's South Rim and Bryce Canyon none (`sky-glow.test.ts`). **Caveat:** larger towns only
(Natural Earth, 2002–2003), so a village, a resort or a lit stadium nearby is missed and small
towns are under-weighted; haze, snow cover and a town's own lighting shift the real sky. It
does not change the Milky Way verdict, which stays geometry.

### Water

Where the terrain tiles carry a water mask (Cesium World Terrain does; a provider without one
renders water as ground), the globe shades sea and lakes with Cesium's water effect: a specular
glint from the scene light, so a low Sun over the sea glitters from the right direction.
**Claim:** where the glint falls, and that it goes with the Sun. **Caveat:** a ripple normal map
only — no swell or wave geometry, no wet-surface effect, no reflection of the sky's colour; the
water mask is the provider's, not a tide model.

**The coastline** is that mask read through a small blur and sharpened again (`water-mask.ts`):
finer tiles reuse a coarse ancestor's mask magnified, and read directly its texels drew every
coast as a staircase 50–500 m to a step. Smoothed, a straight coast stays where the mask had it
and corners round off — a plausible line, not a surveyed one. With sea level known (the bundled
EGM96 geoid, calibrated to the sea as the terrain has it near the pin), ground more than 4–6 m
above the sea is land whatever the mask says, and the near-shore sea floor below sea level is
water however it slopes. **Caveat:** near sea level the mask still decides — a beach park and
the sea a metre apart, or a canal narrower than the terrain's spacing, are beyond the terrain.

### Ground texture

The terrain is painted with a procedural surface (`shaders/ground.frag.ts`, a Cesium globe
material) so the mesh reads as ground rather than a grey plane under a 40 km-per-pixel basemap:
turf and scrub in patches on the lower slopes (drier on the equatorward face of a slope, which
takes the noon Sun, greener on the poleward one — a rule that fades to nothing inside 10° of
the equator and is full from 35°, as the snow's own facing rule now does too; flat ground does
not move; the facing is read from the fragment's normal, not the interpolated aspect angle,
which wraps at east), bare rock where the slope passes about 30–45°,
scree and alpine ground above a treeline (900 m under the climatic snowline, fixed through
the year), snow above a snowline that follows the latitude
(≈ 5 200 m at the equator, ≈ 3 000 m at 45°, ≈ 1 700 m at 60°) and the season (lower through
winter by a share that grows with latitude: the Alps snowy from ≈ 1 500 m in February, bare to
≈ 3 000 m in August; the tropics barely move) and lies lower on poleward faces; where a
lowland snowpack lasts the winter (a rule of thumb by region, `snow-season.ts`: Montreal, Moscow,
Helsinki, Tromsø and Hokkaido white through the heart of their winter, the far imagery whitened
with them; places whose snow comes and goes — Boston, Berlin, London — and the maritime west
coasts left bare) the line is drawn down under the ground by the share covered — and, inside the
forecast horizon, the forecast's own word:
when the frame has snow lying at the model's grid point (≥ 1 cm) the snowline drops to just
under the pin's height, and when it has the ground bare it rises to just over it — and a strip of
shore where flat ground meets sea level (`ground-texture.ts`, tested). The inputs are the
terrain's own height, slope and aspect and a noise field anchored to the fragment's world
position, so patches stay put as the camera moves. One regional cue comes from the bundled
Natural Earth II basemap's own colour around the place (a 3 × 3-pixel read of its deepest
bundled level, ≈ 20 km per pixel, once per place): green leans the open ground to turf and
scrub, tan to steppe and desert, white to an ice sheet — a tint, never a classification
(`landHintFromColor`, tested). The colour is blended over the basemap with an
opacity that rises on rock and snow and falls on open ground, so a licensed imagery layer still
shows through where it carries the information — vegetation hue, desert, farmland — and the
procedural surface supplies the detail it lacks. Water (where the terrain carries a mask, on
ground flat to about a degree) is painted a deep sea colour over a fifth of the globe's own
water shading; the shore and snow rules read heights above sea level (the geoid at
the pin from the terrain's ellipsoidal height against the known elevation; a click picks the
ground under the cursor, never a roof, so buildings do not skew it) — the shore, a band within
6 m of it, only once that sea level has actually been measured — and the night
chart's dimming applies to the surface as to the basemap. The quality rung sets its detail: Ultra and High carry everything, Balanced drops the
per-fragment relief and the near grain, Battery keeps the base surface alone, Minimal turns it
off with the shadows; the `groundTexture` flag turns it off everywhere. On bare ground within a few kilometres a **micro-relief** shading
reads the grain as small bumps lit by the scene's own Sun direction, so rock and scree show a
texture that turns with the light through the day — a shading of the albedo only, within
±30 %, gone on snow. Under **broken cloud** the ground is dappled with
cumulus-sized patches of shade (a kilometre or two across) drifting north-east with the
planner's clock at about 200 m a minute (a pattern's wind, not the forecast's), fading toward
the horizon —
nothing under a clear sky or an overcast one (the light is already diffuse and dimmed as a
whole), most at half cover, nothing under a complete sheet at any level (an altostratus
overcast has no gaps however thin) and nothing without direct sun (`cloudShadowStrength`:
4t(1−t) over the total sun-blocking cover, the shade's depth leaning on the low deck); the patches are a pattern, not the forecast's own clouds, and
they do not match the clouds drawn in the sky. Under rain the ground is darker and duller
(the scenario's precipitation; snow apart). **Claim:** the surface lit by the true Sun, with
shadows and horizon geometry untouched (the material runs before the globe's lighting and
changes albedo only; the micro-relief uses the light direction but never the shadow map or
the mesh). With a **land-cover source** configured (`LANDCOVER_PROVIDER=xyz`, texture pack
stage 2; `land-cover.ts`), nine tiles of ESA WorldCover or the Copernicus Global Land Cover
around the pin (zoom 12 near the equator, ≈ 38 m per pixel, reaching ≥ 12 km each way) are
classified by their legend colours into a cover map the material samples by the fragment's
own longitude and mercator latitude: closed and open forest darken and green the ground with
a crown-sized grain, cropland becomes a patchwork of field tones in cells ≈ 260 m across,
built-up ground a warm grey with a block-sized grain, bare ground sand and rock by the
region's aridity, permanent snow and ice snow at any height; grass and wetland leave the
procedural open ground. Steep rock and the seasonal snow still win, water stays with the
water mask, and a texel the palette did not know (no tile, a wrong palette, beyond the
map's reach) changes nothing. The read is re-done when the pin moves more than 0.05°; the
cover's attribution joins the footer. Within a few kilometres of the camera (texture pack
stage 3, Ultra and High) the ground takes its grain from **detail tiles** — grass, rock, sand
and snow, generated seamless by `scripts/gen-ground-detail.ts` (`pnpm textures:ground`) and
bundled as one atlas at `public/textures/ground-detail.png`, which the host cuts into four
wrapping, mipmapped textures at load (an atlas sampled as one texture bled its quadrants into
each other at every mip level, which read as the near field going grey and popping while
zooming) — chosen by what the rules above made the ground, projected along the camera's own
east, north and up axes and blended by the surface normal (a sharp triplanar, so a face takes
one projection), anchored to the ground through the camera's position in double precision,
at two scales (2.5 m and 6.7 m periods, a ratio that never lines up) that fade in only once a
period spans 40 px or more (a tile shrunk further repeats into a grid of dots), with
world-anchored, never-repeating value noise at 48 m, 12 m and 3 m cells carrying the zooms in
between, each fading in by its own size on screen, so there is texture at every zoom and no
scale pops in; a multiplier about 1 on the
colour the macro rules chose, never a change of what the ground is. A photographic CC0 set
can replace the file as long as its quadrant order and wrap are kept. Over the bundled coarse
basemap (Natural Earth, ~500 m per pixel) the paint covers land almost fully: that map's sea
and lakes reach well onto the land at every coast and showed through as blue blocks on the
ground; the shoreline is the terrain's own water mask.
Verified so far: both branches compiled and rendered in a bare WebGL2 harness on a synthetic
range (a synthetic cover map in place, the atlas close up), and, in the renderer smoke
probe (`tools/renderer-smoke`), the cover map through Cesium's own upload and the atlas close up
from two headings; the atlas on real terrain at a viewpoint — the "fixed to the ground" claim
while walking the pin — is the `QA_PLAN.md` device check, still to run.
The material reads slope and aspect from the terrain's vertex normals (Cesium applies a globe
material only with them): the terrain providers request them, and a tile set that serves none
is named in the renderer's status, so a bare basemap under the light is read as a terrain
choice, not a texture fault.
**Caveat:** still a texture, not a classification of
the pixel under the camera — the map is ≈ 40 m per pixel against 10 m data, tells nothing
about a forest's species or a field's crop, and without a source it does not know a forest
from a field, a glacier from a snowfield, farmland, roads or a city; the snowline is a rule
of thumb, not a snow model; the preview source label does not rise because of it.

### The leaf season

Trees and grass follow the date (`packages/renderer/src/leaf-season.ts`): how far broad-leaf
trees are in leaf, how far their leaves have turned, and how green open grass is, from the
latitude, the day of the year, the height and a regional rule for maritime climates.

- **Timing.** In continental climates leaf-out falls about early April at 35° and early May at
  45°, and peak colour about late October at 40°, early October at 45° and late September at
  60° (the classic phenology records); spring comes later and autumn earlier with height (about a
  month per 1 200–1 500 m). The west coasts in the westerlies (Europe west of about 15° E, the
  Pacific coast of North America, New Zealand, southern Chile, and in part southern Australia
  and Tasmania) are about three weeks earlier in
  spring and later in autumn, and their grass stays greener through winter; southern Japan's
  maples turn about three weeks late. The leaves come down over about three weeks after the
  peak where frost strips them, and over five or six where autumn has none (the maritime west,
  southern Japan): London's planes hold into late November, Kyoto's maples into December. The
  seasons flip across the equator, and inside about 25° the trees keep their leaves.
- **The 3D trees.** Broad-leaf crowns turn yellow, orange or red, each a little before or after
  its neighbours, and as the leaves fall they fade to grey-brown twigs and thin to see-through
  (their shadows thin with them). Conifers stay green.
- **The painted ground.** Woods turn the same way, with about a third of their crowns evergreen;
  winter-dormant grass is olive-tan (straw where the region is dry); a town's trees and parks
  follow.
- **The far imagery** is a summer composite, recoloured pixel by pixel
  (`imagery-season.ts`): what reads as broad-leaf woods turns the autumn mosaic and then
  grey-brown, open grass goes tan when dormant, lying snow whitens open ground fully and woods
  partly; the darkest woods (conifers), water and towns keep their colour. It is a rule applied
  to a 2016–2017 picture, not seasonal imagery: a field that reads green is treated as grass
  whatever grows there.

A model of a typical year, not this year's: an early spring or a late frost moves a real place by
a week or two, and a single valley can differ from its region. Peak-colour reports for the place
are the check before a foliage shoot.

### Weather scenarios

Deterministic parameter sets (`SCENARIOS`) or continuous parameters derived from a forecast frame.
The post-process grade stage paints procedural clouds over sky pixels with coverage/density from
the parameters and adjusts contrast/saturation/haze globally. **Claim:** Clear vs Partly Cloudy vs
Overcast are visibly and consistently different in the ways that matter to a photographer (direct
light 100 % / 70 % / 20 %, contrast 1.0 / 0.9 / 0.75, sky luminance). **Caveat:** cloud placement is
noise, not a forecast of where clouds will be.

**Cloud decks.** The sky is three decks, composited far to near over the corrected dome: high
(cirrus — fibrous, thin, brightens more than it hides), mid (alto- — a grey-white sheet) and low
(stratus/cumulus — dark bases, thickness from the scenario density). Each deck's cover is the
forecast's own layer (`cloud_cover_low/mid/high`, `AtmosphereParameters.cloudLayers`,
`layersObserved: true`) or, for a scenario or a provider without layers, the scenario's
representative split. Each deck is lit from the true Sun elevation: a cloud at height _h_ stays
sunlit until the Sun is `acos(R/(R+h))` below the horizon — 1.0° for a 1 km base, 2.0° at 4 km,
3.2–3.5° at 10–12 km — plus ≈0.5° of refraction (≈1.5° / 2.5° / 3.7–4.0°), so at the same minute
after sunset a low deck is in shadow
(dark blue-grey) while cirrus is still lit, and pink; direct light on any deck is warm from the
golden hour down. A sky that is mostly thin high cloud keeps 55–85 % of the direct beam
(`parametersForForecast`), so shadows survive under cirrus and vanish under stratus. **Claim:** the
_kind_ of cloud the forecast reports changes the light and the sky the way it does outdoors.
**Caveat:** deck heights are the band's typical heights, not the forecast's cloud base; the sunlit
/ shadowed transition is applied uniformly across the sky (a real deck stays lit longer toward the
Sun); cirrus optical depth is not forecast, so its brightness is a fixed typical value. Verified
in `tools/renderer-smoke` (`cirrus-sunset` vs `stratus-sunset` at 19:18, Sun −2.7°).

### Geometry

Terrain mesh from the configured `TerrainProvider` (Re:Earth/Mapterhorn or Cesium World Terrain)
and imagery from the `MapTileProvider`: by default Sentinel-2 cloudless 2016 (10 m, a cloud-free
mosaic of 2016–2017, so newer construction is missing and seasons are mixed); with the bundled
Natural Earth II the ground texture is coarse and the label drops to Estimated Preview. Near the
viewer the ground is painted from OpenStreetMap: its land use and land cover (built-up, parks,
woods, fields, sand, water) and, within 1.5 km, its streets to their usual width by class.
**Claim:** ridgelines and horizon shape relative to the Sun; where streets, parks and buildings
are. **Caveat:** DEM resolution (≈30 m globally, better in some regions); buildings, streets and
land cover as OpenStreetMap has them (see Shadows); street widths are by class, not measured.

### The map view at night

The overhead map is a chart, not a photograph. Once the Sun is under the horizon and nothing
else lights the ground, real lighting would leave the chart black, so the map view shows the
basemap flat and dimmed — 90 % brightness just after sunset down to 45 % in astronomical night
(`globeShadingFor()`, tested) — while the sun overlay, the sky backdrop and the night-sky
markers carry the hour. Nothing about the light is claimed by this: the viewpoint view keeps
true lighting at every hour, and the planning card and the preview facts come from the scene,
not from the chart's brightness.

## Exports carry the same labels

The planning-card export (`apps/web/features/export/planning-card.ts`) is built from the same
`SceneState` as the screen. It always includes the source label, the weather mode (a scenario is
printed as "Scenario (not a forecast)"), the confidence dimensions, provider attribution and the
generation timestamp. A card can therefore never claim more than the screen did, and a card made
from fixture data says so.

## What is never done

- No text-to-image generation as the scene source (plan §6).
- No AI step may relocate terrain, change the horizon, invent buildings, move the Sun, alter shadow
  direction or remove labels (plan Phase 8 rules). There is no AI step in v0.1.
- Climatology is never displayed as a forecast; forecasts beyond the provider horizon are never
  displayed at all — scenarios are.

## Quality ladder (plan §6)

| Quality | What renders                                                           | When                                                                                               |
| ------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 0       | Sun/shadow overlay on a sky gradient; all numbers                      | No WebGL2, or renderer failure — always available                                                  |
| 1       | 3D terrain with directional light, shadows, atmosphere, scenario grade | Default with terrain                                                                               |
| 2       | 1 + licensed high-resolution imagery                                   | `IMAGERY_PROVIDER` configured                                                                      |
| 3       | Buildings/3D tiles, physically based scattering in the 3D dome         | Buildings where `BUILDINGS_PROVIDER` is configured; the dome's scattering behind `physicalSkyDome` |

The governor's ceiling is the stricter of the device probe (`qualityCeiling`: low-power GPU or a
small maximum texture) and live conditions (`conditionsCeiling`: battery level while discharging,
Save-Data). Conditions can take the view down to the Battery rung; only measured frame rate can
take it to Minimal, where terrain shadows are off.

## How to verify

- `pnpm test --filter @lightmap/astronomy` — USNO golden set.
- `pnpm test --filter @lightmap/renderer` — sun vector mapping, lighting parameters, controller.
- Dev perf panel (press `` ` `` in development; plan §27): renderer mode, quality rung, FPS, draw
  commands (Cesium's pre-cull command list for the last frame — a pick pass between renders shows
  up here too), terrain tiles shown/loading, WebGL2 / WebGPU API / GPU string, weather cache hit,
  and Δ between LightMap's sun vector and Cesium's own ephemeris (expect < 0.5°).
- Manual: set Kailua, 31 May 2026 12:30 → sun 89° (near zenith, shadows nearly vertical); 18:45 →
  golden, shadows long toward the ENE; 19:30 → blue hour, no direct light.
