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
| Planets (Mercury to Saturn) azimuth/elevation      | ≈0.05° (Mercury–Mars), ≈0.2° (Jupiter, Saturn)                                      | JPL approximate elements 1800–2050; magnitudes ±0.2 (Saturn with ring tilt)                                           |
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
are switched off when direct light is below 12 % or the Sun is below −0.833° — and only then,
unless a bright Moon has the light: from a Moon at least half lit and 2° up (in full by 6°), the
night's shadows are cast from the Moon as by day, as dark against the moonlit ground as a clear
day's against sunlit ground (moonlight is sunlight; a long exposure and the dark-adapted eye both
show them). Under the full Moon at 30° the harness's tower shade is a third of the moonlit ground
beside it (`shadow-moon`), as the Sun's is (0.34). Cesium's default low-Sun fade
(`shadowMap.fadingEnabled`) is **off**, because golden-hour shadows
Cesium's default low-Sun fade (`shadowMap.fadingEnabled`) is **off**, because golden-hour shadows
are the product. Reach (`maximumDistance`) is 20 km at eye level and 3× the orbit range (8–60 km)
in map view, so a ridge's shadow crosses a valley. Cesium's terrain shadows also fade the ground
by its own angle to the light (n·l over a width, floored at the darkness) to hide acne on faces
turned away; at its default width, 0.3, all level ground within the map's reach sank to the
shadow darkness with the Sun below ~17° — every golden hour's near ground nearly black, with a
hard edge where the reach ended (seen on the smoke harness's synthetic terrain). The host narrows
it to 0.02 (`TERRAIN_NORMAL_SHADING_SMOOTH`): level ground is fully lit from about 1° up, faces
turned from the light still dark. **Claim:** direction and length of shadows;
visible softening under cloud. **Verified:** the smoke harness renders a 20 m tower at Sun
elevation ≈ 11° and measures the frame — the ground along the shadow line is < 70 % as bright as
the Sun side and the point just beyond `h / tan(el)` is fully lit (`shadow-tower` scene).
The ground casts shadows only where it is lit and has relief to cast with
(`groundShadowMode`). On the ellipsoid - the fallback when no terrain can be had - it only
receives them: Cesium keeps a receiver out of its own shadow by offsetting it along its normal,
ground without normals has only a depth bias, and under a low Sun level ground then shadowed
itself in a moire of stripes (`buildings-glint` measures the ground's evenness). And while the
map is shown as a flat chart (the map view at night) it only receives them too: a globe that
casts is lit by Cesium's shadow shader whatever its own lighting says, so on the nights the Moon
was bright enough to cast shadows the chart was multiplied by the moonlight and went all but
black - the brighter the Moon, the darker the map (`synth-map-moon` measures the chart's
brightness; `shadow-moon` shows a building's Moon shadow on it).
**Caveat:** buildings are OpenStreetMap's (by default from OpenFreeMap's vector tiles, loaded
within about 2 km of where you stand or look, or Cesium OSM Buildings with an ion token): heights
are often estimated or missing (a building without one is drawn 6 m tall), roofs are flat but
for the houses' (a hip roof on every low, plain rectangle: a guess, see Buildings) and facade
colours are a pattern unless mapped; they cast and receive the terrain's shadows and are lit by
the same light. Trees are a pattern: OpenStreetMap's woods filled and its parks scattered
with generic trees, not the trees that stand there, so their shadows show the light's direction
and length but not a real tree's; street trees and single mapped trees are not drawn. The
terrain horizon and the ridge markers take the mapped buildings in within 2.5 km of the pin and
never the trees (see "Terrain horizon"); shadow map resolution is
finite (1024–4096) and softens with reach; terrain self-shadowing at grazing angles shows some
shadow-map artefacts.

**Shadow colour.** Cesium darkens shade by a grey; shade on a clear day is lit by the sky alone,
so its colour is the sky's light, not the Sun's. Cesium's shadow receive shader is wrapped
(`shadow-tint.ts`, `ShadowMapShader.createShadowReceiveFragmentShader`) so the shaded fraction —
how far the visibility has gone toward the darkness — is tinted by a clear sky's blue
(0.80, 0.90, 1.05) over the scene's light colour, at unit luminance, by up to 60 %: a gentle blue
under a white noon Sun, a strong one under an orange golden-hour Sun, nothing where the darkness
is near 1 (overcast) or outside the shadow. **Caveat:** the sky's colour is a clear day's, not
the scenario's; under haze the shade is as blue as under a clear sky.

**Valley mist.** On a calm, near-saturated morning the air cooled on the ground overnight lies in
the low ground as a shallow white layer. Its strength (`grade.mist`, `mistFor` in `lighting.ts`)
comes only from a forecast frame: humidity 88–97 % (or a fog code, or visibility under 1 km),
wind under 1.5–4.5 m/s, gone as the Sun climbs past 5–15°, cut to 40 % under a low overcast and
to nothing in rain. In the grade (`u_mist`) it is an exponential layer with a 70 m scale height
above the low ground about the place (`u_mistFloorM`: the second lowest of the terrain samples on
rings 1.5 and 5 km round, never under the sea nor over the place), full below it, 1.5 km
visibility at full; the density is averaged along each ground pixel's ray as for the haze, so from
a summit the plain drowns in white while the ridges stand out. **Caveat:** one flat floor for the
whole view; a second valley lower or higher than the sampled rings fills to the same height.

**Sky view on slopes.** Cesium gives every face the same share of sky light whatever its tilt,
but a plane tilted by _t_ sees only (1 + cos _t_) / 2 of the sky: all of it when level, 85 % at
45°, half on a cliff. The ground material (`ground.frag.ts`) scales the sky's share of each
fragment's light by that factor, leaving the Sun's share alone, laid in through the paint's
opacity with the cloud shadow so imagery and paint darken together. Level ground is unchanged and
a sunny day's relief barely so; under an overcast or in twilight, when nearly all the light is
sky light, steep slopes come out darker than the ground about them (the synthetic 37° ridge flank
about 4 % darker overcast). **Caveat:** an open-sky estimate from the local slope alone; a gully's
walls hide more sky than its floor's tilt says, and that is not modelled.

**Alpenglow, and first and last light.** The scene has one light, the place's: its beam is gone
when the Sun is 0.83° under the place's horizon. But ground above the place sees past that
horizon, by its dip, sqrt(2 h / R): 0.9° from 800 m up, 1.6° from 2.5 km. So the Sun is still up
for a peak when it has set in the valley, and rises on it first. The ground material
(`ground.frag.ts`, `u_alpenglow`) gives each fragment standing higher than the place's ground the
beam the place would have with the Sun that much higher, less the place's own, on the faces
turned to the Sun (the true Sun, not the light held at the horizon), in the scene's own exposure
(`grade.alpenglow`: the twilight is shown some three times brighter than it is, and this beam
with it) and cut by cloud as the beam is. Its colour is that of light come the long way through
the air: red at the edge of the Earth's shadow, which climbs the slope as the Sun sinks, turning
to the low Sun's orange above it. On the harness's 800 m ridge with the Sun 0.6° down at the pin
(`synth-alpenglow`) the crest's western face is about half as bright again as the shaded plain's
light would leave it; a 2.5 km wall would be twice as bright. Faded out as the Sun climbs from 2°
to 6°, by when a peak's share is the place's to a few per cent. **Caveats:** the horizon is taken
level with the place's ground all round (a sea horizon from a coast; inland the real one is
whatever stands to the west); no shadow is cast on it - a lower peak behind a higher one glows as
if it stood alone, where the terrain shadows have already gone with the place's beam; buildings
and trees do not take it; and the purple afterglow that can follow, sunlight scattered back down
from high haze, is not modelled.

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
haze; fog density encodes visibility. The grade holds the sky's green to a hair over the larger
of red and blue as its last step: the single-scattering dome runs a low Sun's pale horizon and the
rim of its glow to a mint green that a clear sky does not show. **Claim:** sky is bright/blue when clear and grey/flat when
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
ground is lifted toward the sky at the horizon behind it by depth, more strongly at low Sun
(`horizonHaze`): the sky gradient's own horizon colour (`horizonSkyFor` — cloud greys it, night
darkens it, haze pales it), the glow's colour on the Sun's side of the view at a low Sun and the
plain horizon on the other, by each ray's bearing from the Sun's (a fixed pale blue half-tinted by
the light's colour before, which greyed a sunset's far ridges where the sky behind them was warm).
The haze's density falls with height above the place's ground (where a forecast's visibility is
measured) with a 1.2 km scale height, and each ray takes the density averaged between the eye's
height and the point's: from a summit a far peak stands clear in the summit's thinner air while
the valley below sinks into its haze; from below, a ridge stands a little crisper than distance
alone would make it; looking down from the map, the haze is thin until near the ground (held to
2.5 times the place's own density, for gorges far below it). **Caveat:** the layer follows the
place's ground, not the terrain under each ray — a high plateau seen from a low coast hazes as
air at the plateau's height, and a pin dropped on a summit takes the forecast's haze at the summit
(the valley below up to 2.5 times it). The fade goes by colour: the air's molecules scatter
by Rayleigh's coefficients (5.8 / 13.5 / 33.1 × 10⁻⁶ m⁻¹ for red, green, blue, in an 8 km
layer), the visibility (taken as green's) minus green's molecular share is grey haze, so red
fades into the air more slowly than the visibility says and blue faster: on a clear day hills
10–40 km off go blue before they go pale, and on a hazy one the haze's grey dominates as before.
Over dry country the haze is dust: the haze's share of the extinction (not the molecules') takes
a tan cast (1.12, 0.98, 0.78 at the haze colour's own luminance) by up to 60 % with the region's
aridity (the ground texture's land hint, `u_dust`), so a desert's or a dry plain's distance reads
beige while the molecules' blue stays blue.
The light direction and terrain shading are untouched by either. Verified in
`tools/renderer-smoke` (contact sheet `docs/media/renderer-smoke-2026-09-24c.png`).

**Terrain shading under a diffuse sky.** Cesium shades terrain as the light times
`lambert · cos θ + ambient`, 0.9 and 0.3 by default whatever the sky: under an overcast the slopes
kept a sunny day's relief, and in twilight (the light held at the horizon) a slope facing it stood
out three times brighter than level ground lit by the same sky. The split now follows the scene
(`globeLightSplit`): the directional share falls with the sky's diffuse fraction (a quarter of it
left under a full overcast) and as the Sun's beam goes, to a sixth of a clear day's in twilight;
while the beam is there the ambient share takes up exactly what level ground loses, so level
ground is as bright as before (the exposure was set against it) and only the relief changes —
from 25° of Sun up. Below that the sky's share lifts level ground by up to 35 % as the Sun nears
the horizon: Cesium's level ground falls 1.4 stops from noon to a Sun 4° up while the sky it draws
falls less, and on the harness's synthetic plain a golden-hour field sat 2.9 stops under the sky
where the noon one sits 2.1 (in a photograph, exposed for the scene, the two keep their ratio);
lifted, it sits at about the noon ratio again. Through `skyLift`, so buildings and trees come up
with the ground; the relief is left as it was.
Once the beam has gone every bit of the light is sky light, and level ground takes the whole of it
rather than a day's 0.3 share: on the smoke harness's synthetic plain at Sun −4° the ground sat
5.0 stops under the sky, where sky-lit ground of albedo 0.2 sits about 2.3 under it (the overcast
noon shot measures 2.4); with the lift it sits 3.1 under it, short of the full physical ratio
because the twilight exposure was set by eye against the old split. Buildings and trees lift their
sky terms with it (`skyLift`), and the map's night chart starts from the globe's own share at the
switch. The lift fades out between −6° and −12°: a moonless night is back at a day's share, and a
moonlit one takes the Moon's split from −12° with no jump. In the last 1.2° before the Sun goes the
shadow map's darkness fades to none, since level ground then faces the light edge-on and Cesium's
terrain shadows would sink it all to the darkness. A
moonlit night is split as a clear day by its own light. **Caveat:** one ambient share for every
face — no sky-view factor, so a gully is as sky-lit as a plain. Buildings and trees take the same
directional share in their own shader (`litInstanceShader`, in tenths), the light it takes from
the Sun's term coming back from the sky by how much a face looks up, so a flat roof keeps exactly
the level it had.

**Tile edges.** Terrain tiles do not meet to the last bit: neighbours at different detail levels
do not share their edge vertices, and each tile quantises its own heights. Cesium closes the cracks
with skirts, walls hung under every tile's edges; but a skirt is drawn into the shadow map with
its tile, and where it stands a little proud of its neighbour a low Sun drew its shadow as a long
black line along the tile edge, so the host had turned skirts off - and single pixels of sky then
showed between the tiles, pale dotted lines across the ground (found in the harness's synthetic
terrain; they would show on any real terrain between detail levels). Skirts are drawn again, and
kept out of the shadow map instead (`cesium/skirt-shadows.ts`): every vertex of a skirt lies on
its tile's edge, so across a skirt one of the tile's texture coordinates is exactly 0 or 1, and
the globe's shadow-cast shader discards such fragments (a strip 1e-5 of a tile wide goes with
them, centimetres, far under a shadow texel). Checked both ways over the harness's low hills with
the Sun 5° up (`synth-tile-edges`): with skirts casting, three dark lines ran across the view
along tile edges; with the discard, none, and no sky between the tiles. Where the wrap cannot be
proven on Cesium's cast shader (a later Cesium that writes it differently) skirts stay off, the
host says so, and the grade fills the no-depth pixels it finds below the horizon from the ground
beside them (`grade.frag.ts`), which hides the fully open ones.

**Night sky.** The grade's twilight treatment (darkening and cooling the dome while Cesium still
lights its atmosphere from a Sun held at the horizon) is for the atmosphere only: the stars' light
is separated out first (a pixel standing clear above a ring two star-widths out, its sky from a ring
one star-width out) and put back neutral after, the Moon's disc keeps the colour it was drawn in,
and below −18° — when the held light is let go and the atmosphere is dark of itself — the darkening
lets go of the Milky Way over 2°, unless a bright Moon lights the sky again. (Before this the stars
turned blue in the blue hour, the fainter ones and the Milky Way's band were cut to a sixteenth at
night, and the Moon was pale blue; seen in `tools/grade-preview`.) In viewpoint mode, below a Sun
elevation of −8°, the dome shows Cesium's star field (its J2000 star cube), coming out through the
twilight: the grade holds back part of each star-sized point's light until −16°
(`starFieldVisibility`: none at −8°, half at −12°, all of it from −16°), following the clock's
glide (it had switched on whole at −8°). Not earlier: the cube's faint texels are too dense to tell
from the sky, and in a brighter blue hour they grained the whole dome (`tools/renderer-smoke`).
The star field has no planets: the grade draws Mercury, Venus, Mars, Jupiter and Saturn as points on
the clear dome (`planetPositions`, `planetPoint`), as bright as each one's magnitude against what
the twilight shows (`skyLimitingMagnitude`: Venus faintly by day and plainly at sunset, Jupiter from
about −1.5°, Saturn from about −5°), dimmed low in the air (0.25 mag an air mass, `extinctionMag`)
and lost within 10° of the Sun, under the cloud decks and behind the ridges, gliding with the clock
like the Sun. A bright Moon lights the haze round it (the grade's aureole, `moonGlowStrength`: by
phase and only in a dark sky; a tight glow and a wide one, stronger in haze and far stronger through
cirrus or thin altostratus, muffled under thick cloud, dimmed by the air when the Moon is low) - a
look, not a photometric model. The disc takes the low Sun's colour low down (`moonDiscTint`: the
direct-light curve, 2,900 K on the horizon, neutral from 20°) and is dimmed by the air, to no less
than about half. The Sun's own disc and glow (Cesium's, one white-yellow at any height) are tinted
by the grade within a few degrees of it by `discTint` for its elevation: the same curve, deepened
under 6° (the disc is the beam alone, redder than the light the scene gets), to about 2,000 K on the
horizon; the Moon's disc likewise. Cesium turns the field by Greenwich sidereal time for the scene's
instant (`czm_temeToPseudoFixed`; the host sets the clock to the planned UTC) — so the Milky Way's
band in the 3D preview stands where the planner's own Galactic Centre says, within the precession
and nutation Cesium leaves out (≈ 0.4° in 2026; the planner's `milkyWayCore` applies Meeus
precession, ≈ 0.1°). The "Milky Way core" line, the rose star, the dark windows and the map view's
violet track are the authority where the two disagree. The star field is a texture: no
sky-brightness or airglow model, and it is faint under software GL (`README.md` "Known
limitations").

**The Moon.** In viewpoint mode the Moon is drawn where the planner's own Moon stands (its
topocentric position), at its apparent size for the day's distance, with its phase and the lit
limb turned toward the Sun on the screen; a faint earthshine fills the dark side. It is pale in a
daylit sky and full at night, and the cloud decks are drawn over it where there is cloud. It
stands 5,000 km out along its direction, beyond any terrain, so every ridge in front of it hides
it as the real one would. No craters or maria: a lit disc, not a photograph.

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
only — no swell or wave geometry; the water mask is the provider's, not a tide model.

**Wet ground.** In rain the paint darkens and greys the ground, and level ground (under about
3°) mirrors the same sky the water does as a film: up to a third at a grazing view on a mapped
street, about a tenth on turf, none on slopes. The ground stays wet after the rain: with a
forecast, each hour's rain over the day before (`groundWetnessAt` in `packages/weather`) dries off
with a 4 h e-folding time, a millimetre's worth wetting the ground to 63 %, and the wetness is the
larger of that and the rain falling. So that the morning knows the night's rain, `/api/weather`
asks the provider from a day before the day wanted and returns those hours apart, as `history`
(the day's own `frames` are unchanged); the scene uses them for the wetness only, never the light. On level ground the water stands in puddles a few metres
across (two readings of the baked noise at 320 m and 224 m repeats), covering about 5 % of the
ground just damp to about 45 % soaked, on streets and bare ground more than on turf: still
mirrors at water's full Fresnel reflectance (2 % looking down to all of it at grazing) with a
sharp Sun glint (mean square slope 0.004), their floors a third darker than the wet ground round
them, imagery and paint alike; where a pixel spans more than a few metres they give way to their
mean share. **Caveat:** puddles fall by noise, not in the terrain's real hollows; no ripples from
the rain; drying ignores sun and wind; and the mirrored sky is the horizon's colour, not the
clouds' shapes.

**Hoar frost.** After a clear, calm, cold night the dew freezes on the ground as rime. Its
strength (`frostFor` in `ground-texture.ts`, `u_frost`) comes only from a forecast frame: the air
under 3 °C at 2 m (full by −1 °C, the ground radiating below it), humidity 60–85 %, the low deck
(plus half the mid) under 40–85 %, wind under 3–7 m/s; it melts as the Sun climbs from 8° to 25°
unless the day stays below 0 to −4 °C, and none falls with rain or snow. The ground paint goes
toward a pale, faintly blue grey-white (0.80, 0.83, 0.88) by up to 80 %, thinner on rock and
sand, none on cliffs, patchy with the grain; it counts toward the paint's cover over imagery, and
sparkles in a low Sun with the snow's glint at 70 % (`synth-frost`). **Caveat:** frost falls by
the forecast's 2 m air, not the ground's own temperature; frost hollows and shaded slopes keeping
it longer are not modelled.

**Dew.** On a calm, clear, humid morning above freezing the grass is beaded with dew (`dewFor`,
`u_dew`): humidity 85–97 %, the low deck (plus half the mid) under 40–85 %, wind under 2–5 m/s,
above 1–3 °C (below that it is frost), drying as the Sun climbs from 10° to 30°, none in rain.
On vegetation only it adds the snow's glint at 35 % - points of light near the eye - and a
broad sheen toward the Sun (Cox–Munk, mean square slope 0.12), both lit by the direct beam
(`synth-dew`, looking along the grass toward a 16° Sun). **Caveat:** the heiligenschein (the
bright glow round the shadow of one's head on dewy grass) is drawn below, and the paint's colour
is unchanged.

**The hot spot.** Looking straight away from the Sun every leaf and blade hides its own shadow,
so vegetation brightens round the antisolar point - the opposition effect, the bright patch in
every aerial photograph of fields and forest taken with the Sun behind the camera. The ground
material adds 22 % of the ground's own colour in the direct beam, falling off with 1 − cos of
the angle from the antisolar point over 0.02 (about 11°); on dewy grass a narrower glow (0.004,
about 5°) of 60 % more, the heiligenschein, focused by the drops (`synth-hotspot`). Vegetated
ground only, the same weight as the backlit glow's. **Caveat:** one lobe for every canopy; real
hot spots are sharper over fine grass than over forest.

**The sky in the water.** The painted water mirrors the sky (`shaders/ground.frag.ts`, the water
branch): the share reflected follows Fresnel's rule for water — 2 % looking straight down, rising
toward a grazing view to seven tenths (ripples scatter a grazing reflection, so never a mirror's
whole) — and the rest is the water's own colour — a deep blue between the
tropics (clear, low-chlorophyll water), turning grey-green from about 25° to 38° of latitude (the
richer, more turbid mid- and high-latitude seas; by latitude alone, no ocean-colour data, so a
clear Mediterranean reads as green as the North Sea). The paint is blended over the imagery by its
opacity, so the reflection is put in at full strength over it. What it mirrors is the low sky as
the lighting has it (`seaSkyFor`: two thirds the gradient's horizon stop, a third the mid-sky, as
the frame's 0–1 colours), on the side away from the Sun the plain horizon and on the Sun's side the
sunrise or sunset glow when there is one — after sunset the afterglow, orange to about −2°, rose,
mostly warm still at −4° (as the drawn dome keeps its band over the set Sun), then the
twilight's blue by about −8° — blended by the view's bearing from the light's (by the eighth
power of its half-cosine, as narrow as the glow the dome draws: three quarters of it 40° either
side of the light, none a quarter of the way round). Two corrections
toward the dome as drawn: through the dusk (from sunset to −5°, gone by −10°) the mirrored sky is
lifted by up to half, since the dome stays bright low down where the gradient's twilight stops
darken (measured in the harness: the sea at −4° had been half the sky's brightness over it, 0.79
after, against 0.78–0.88 by day); and from −12° to −18° it darkens to a sixth, as the grade cuts
the night dome's faint glow, so the night sea is no lit band under a black sky. Under it the
Sun's glitter path, by Cox and Munk's sea surface (1954): the ripple facets' slopes are spread
normally with a mean square slope set by the wind, 0.003 + 0.00512 · U (U the wind at 10 m, m/s:
the forecast's, or a stated typical wind for a scenario — 4 m/s clear, 5 partly cloudy, 6
overcast, 13 in a storm; `SCENARIO_TYPICAL_WIND_MPS`), and the eye sees the light in a facet whose
normal is the half-way vector between the two, at Fresnel's reflectance for that facet — a narrow
bright point in a calm, a long, broad band in a breeze, narrow across the light's bearing and long
toward the viewer; eased toward 1.5 times the light so a sunset's path keeps its colour. The path is
made of sparkles: facet cells a pixel and a half across at any distance (a hash per cell, two
cell sizes chosen by log₂ of the ground a pixel covers, each thresholded before the blend), 7 % of
them flashing, scaled by 1/0.07 so the path's average brightness is the smooth model's; where a pixel
covers metres of water the sparkles merge into the smooth band, as they do to the eye. The Sun's
aureole is mirrored as a wide soft lobe round it. Only while the light has a disc to mirror
(`LightingParameters.glitter`: the Sun's direct beam through the cloud, the Moon by night — not
the light held at the horizon through twilight). On a moonlit night the same path is the moon
path, its colour lifted to a floor so a full Moon's disc on the ripples stands out from the night
sea as it does. **Claim:** the sea goes blue under a blue sky, grey under an overcast, dark at
night, warm toward a setting Sun with the glitter under it and rose under the afterglow, and the
glitter sits on the light's bearing. **Caveat:** the globe lights every fragment as ground (the
light's colour times its Lambert split, and within the shadow map's reach the map's own fade of
terrain by its angle to the light), which is wrong for a reflection, so the material divides those
terms out of the reflected part (`lmUnlit`) — floored, so under a faint light the reflection comes
out dimmer than the sky, never brighter; a real shadow on the water (a ridge's) still darkens it;
the sparkles are a statistical texture, not the real waves, and the wind is the forecast's at
10 m or a scenario's typical one (no swell, no fetch: a sheltered lake is roughened as the open
sea); the sky mirrored is the gradient's
colour at the horizon, not the dome pixel by pixel, so cloud shapes and the Sun's disc are not in
the water. The smoke harness draws the sea on a probe with the globe's own defines and lighting
(`water-*` shots).

**Shallows by depth.** Where the terrain carries the sea floor (bathymetry near coasts) and the
sea level has been measured, water over a floor within a few metres shows its bottom: the
body colour goes up to 75 % toward pale turquoise over the tropics (0.14, 0.52, 0.55) or green
over the temperate seas (0.10, 0.26, 0.24), fading out between 1 m and 12 m of depth - the reef
and sand-bar light of a tropical coast, the band of paler water along any beach
(`synth-shallows`). It sits beside OpenStreetMap's near-viewer shallows, which go by the land
around. **Caveat:** a floor's colour is not known (sand, reef, weed and mud all read the same),
and the water's clarity is not modelled.

**Surf.** Where the same floor shelves to within about 2 m of the surface (fading 1.2–2.2 m), the
swell breaks: lines of white water one per 0.55 m of depth, running in toward the beach as the
scene's clock moves, broken along their length by noise, and a churned band of foam in the last
half metre; stronger in a wind (0.45 + U/16, a swell assumed even in a calm), laid in as the
whitecaps' foam is, its mean share where a pixel spans more than a few metres
(`synth-shallows`). **Caveat:** no real swell height or direction (the forecast carries none),
and the lines follow the floor's depth contours, not the waves' refraction.

**Lake ice.** Through the season the snow lies on the land (the ground texture's `snowCover`,
`u_lakeIce`), the painted lakes are frozen and snow-covered: white with grey-blue patches where
the wind has swept the ice clear, nearly opaque over the imagery. Fresh water only - well above
the sea, 2–5 m where its level is known and 15–25 m where it is not (the ellipsoid standing in);
the sea stays open (`synth-lake-ice`, the synthetic sea taken as a lake 100 m up).
**Caveat:** freezing follows the snow season, not the water's own temperature, so a large deep
lake that stays open into the winter is drawn frozen, and spring ice lingering after the snow is
not.

**Whitecaps.** In a wind the waves break: foam covers a share of the water that climbs steeply
with the wind at 10 m (Monahan and O'Muircheartaigh 1980, 3.84 × 10⁻⁶ U^3.41: under 0.1 % in a
5 m/s breeze, 1 % at 10 m/s, 2.4 % in the storm scenario's 13 m/s, held to 8 %). The painted
water draws it as flecks a few metres across, stretched about twice as long downwind (the baked
noise at 400 m / 280 m repeats on the wind's frame, thresholded to that share), up to 85 %
opaque, lit as a diffuse white (0.80–0.83) in place of the mirror, its reflection and glint taken
out under the foam; where a pixel spans more than a few metres the flecks give way to their mean
share (`synth-whitecaps`, 14 m/s). **Caveat:** no surf in the shallows, and the foam does not
move.

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
coasts left bare; height lengthens only a real winter, so the high cities of the tropics —
Mexico City, Bogotá, Nairobi — and Denver are never painted white) the line is drawn down under the ground by the share covered — and, inside the
forecast horizon, the forecast's own word:
when the frame has snow lying at the model's grid point (≥ 1 cm) the snowline drops to just
under the pin's height, and when it has the ground bare it rises to just over it. Sunlit snow
near the eye sparkles: its grains are small mirrors, so in direct light (the Sun's beam or the
Moon's) it is strewn with sparse pixel-sized points of varied brightness, cells a pixel across the
pixel's shorter side with 0.6 % of them lit, re-dealt as the view turns by a few degrees; they go
once a pixel covers more than a few tens of centimetres of snow, where the eye sees the mean the
snow's albedo already carries, and looking toward a low Sun the snow takes a broad, soft forward
glare (a rough Cox–Munk lobe, mean square slope 0.3). **Caveat:** a statistical texture, not the
grains; the harness shows it with the snowline brought down (`synth-snow-*`). Open and wooded ground
seen toward a low Sun glows with the light its blades and leaves let through: a forward lobe
(the sixth power of the cosine between the view and the light), yellow-green — gold for dormant
grass, a little stronger under leafed canopy — lit only by the direct beam, so the terrain's and
the clouds' shadows take it; rock, scree, snow, shore, built and bare ground do not glow
(`synth-backlit`). And a strip of
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
6 m of it, only once that sea level has actually been measured; its lowest metre or so, the
swash the waves run up, lies wet, a third darker and glazed like the wet film (a mirror of the
sky at a grazing view, a low Sun's glare; the dark strip at the water's edge in `synth-shallows`) —
and the night
chart's dimming applies to the surface as to the basemap. The quality rung sets its detail: Ultra and High carry everything, Balanced drops the
per-fragment relief and the near grain, Battery keeps the base surface alone, Minimal turns it
off with the shadows; the `groundTexture` flag turns it off everywhere. On bare ground within a few kilometres a **micro-relief** shading
reads the grain as small bumps lit by the scene's own Sun direction, so rock and scree show a
texture that turns with the light through the day — a shading of the albedo only, within
±30 %, gone on snow. Under **broken cloud** the ground lies in the shadows of the clouds
the sky draws: from each point up the Sun's ray to the low deck (1.5 km) and the mid one (4 km),
read with the grade's own noise in the wind's frame and drifting with the same clock, so a cloud
toward the Sun is the one whose shadow falls there and the shadows move with the clouds. The
shade dims imagery and paint together (laid in with the paint's opacity: on the paint alone it
had all but vanished past a kilometre, where the imagery shows through), fading toward the
horizon —
nothing under a clear sky or an overcast one (the light is already diffuse and dimmed as a
whole), most at half cover, nothing under a complete sheet at any level (an altostratus
overcast has no gaps however thin) and nothing without direct sun (`cloudShadowStrength`:
4t(1−t) over the total sun-blocking cover, the shade's depth leaning on the low deck); the clouds and their shadows are a pattern at the
forecast's cover, not the forecast's own clouds, but the shadows are the sky's clouds'. Under rain the ground is darker and duller
(the scenario's precipitation; snow apart). **Claim:** the surface lit by the true Sun, with
shadows and horizon geometry untouched (the material runs before the globe's lighting and
changes albedo only; the micro-relief uses the light direction but never the shadow map or
the mesh). With a **land-cover source** configured (`LANDCOVER_PROVIDER=xyz`, texture pack
stage 2; `land-cover.ts`), nine tiles of ESA WorldCover or the Copernicus Global Land Cover
around the pin (zoom 12 near the equator, ≈ 38 m per pixel, reaching ≥ 12 km each way) are
classified by their legend colours into a cover map the material samples by the fragment's
own longitude and mercator latitude: closed and open forest darken and green the ground with
a crown-sized grain, cropland becomes a patchwork of fields that keeps the season - rectangular
parcels 256 m by 512 m along the ground frame, each row set off by half a field like bricks,
over a third of them worked as two strips, with a darker line a few metres wide along every edge
(a track, a ditch, a hedge) while the view is near enough to tell it; cells of the Earth-fixed
axes, as it was, cut the tilted ground into triangles and lozenges
(while things grow, green fields and ripe gold ones about 60:40; dormant, mostly bare ploughed soil
with a quarter in winter-crop green; by the grass's greening, field by field),
built-up ground a warm grey with a block-sized grain, bare ground sand and rock by the
region's aridity, permanent snow and ice snow at any height; grass and wetland leave the
procedural open ground. Under seasonal snow a wood is not white: the trees stand dark and
grey-green through it, whitest in the gaps between crowns (20–55 % snow over the forest
colour at 80 %), with its sparkle and wetness cut by two thirds (`ground-texture-snow`). A
town under snow keeps its grid: roofs and parks go white, the trees in the lots stay dark, and
the streets (the town pattern's and OpenStreetMap's mapped roads) stay a ploughed, slushy grey
(0.36–0.38 with a quarter snow); mapped paths are mostly buried.
Steep rock and the seasonal snow otherwise win, water stays with the
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
  seasons flip across the equator, and inside about 25° the trees keep their leaves. South of the
  equator most woods are evergreen (eucalypts, southern beech, the Cape's and Chile's scrub), so
  only about a third of the canopy turns and drops — the planted trees of towns and farms —
  except in the Patagonian Andes' deciduous beech. Around the Mediterranean and in California,
  whose holm and live oaks, pines and scrub keep their leaves, half does.
- **The 3D trees.** Broad-leaf crowns turn yellow, orange or red, each a little before or after
  its neighbours, and as the leaves fall they fade to grey-brown twigs and thin to see-through
  (their shadows thin with them). Conifers stay green, and where most broad-leaf woods are
  evergreen only the deciduous share of crowns (and of stands in the far imagery) takes the
  season, each one fully.
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
representative split. The low deck's base is the forecast's cloud base where it gives the
temperature and dew point - about 125 m for each degree between them (Espy's rule for where rising
air saturates), held to 0.3–2.5 km (`cloudBaseKmFor`, `u_lowDeckKm`; the ground's cloud shadows
read the same height) - and 1.5 km otherwise; a humid trade-wind day's cumulus sit at 500–700 m,
larger and nearer than at the default (`partly-low-base`). The mid and high decks stay at 4 km
and 9 km. Each deck is lit from the true Sun elevation: a cloud at height _h_ stays
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

**A closed deck is brightest overhead.** As the low deck closes (cover 60–95 %) its luminance takes
the CIE standard overcast sky's profile, 1 + 2 sin(elevation) — overhead three times the horizon —
normalised to a view 15° up and held within 0.65–1.45 of it, so a storm or overcast sky darkens
toward the horizon instead of reading as one flat grey (`storm-viewpoint`: 133 overhead to 94 at
the horizon, was 114 throughout). **Caveat:** the CIE profile is the uniform overcast's; a
brighter band under the deck's edge is not modelled.

**Rain shafts.** While it rains (the scenario's or forecast's precipitation over 0.02, with a low
deck), the rain hangs below the deck toward the horizon as grey curtains: distinct shafts round
the horizon under broken shower cloud, a near-continuous veil as the low deck closes (60–95 %),
darkest at the horizon and gone by about 8° up, streaked down their length and drifting round
with the wind; in the low deck's grey (0.42–0.48), dimmed at night (`rainbow`, `storm-viewpoint`).
**Caveat:** the shafts are placed by noise round the horizon, not under the deck's own clouds,
and stop at the sky (they do not veil distant ground).

**Cumulus.** Broken low cloud (the low cover under about 45 %, giving way to a deck's soft edge
by 70 %) is drawn as cumulus rather than a smear: its edge is firmer (a threshold band two thirds
as wide) and ragged, three finer octaves of noise (mean zero, so the cover stays the forecast's)
eating into it; its base greys toward the middle, by up to 30 % and more in the lumps than between
them, as from below; and it is lit from the Sun's side - one more reading of the field 0.4 km
toward the Sun brightens the face where the cloud thins that way (up to 12 %) and shades it where
it thickens (up to 24 %). With the Sun overhead the step shrinks to nothing and only the grey
base is left; the silver lining keeps to the deck's soft margin (`partly-viewpoint`,
`partly-sunward`).
**Caveat:** a sheet's relief, not a volume: no towers, no anvils, no shadows from one cloud on
the next.

**Cirrus in strands.** High cloud short of a sheet (the high cover under about 45 %; cirrostratus,
smooth, by 75 % - the sheet a halo needs) is drawn out into filaments: strands some 150-400 m
across (1-2.5° from under them) and kilometres long, lying along the wind on a slow sideways
wander - two fine noises stretched forty and ninety times along the wind - in some parts of the
veil and not in others, the veil a little brighter in the strands and thinner between them at the
same mean. Below 15° of elevation, where the strands could not be told apart, the veil is as it
was (`cirrus-strands`, against the sheet of `cirrus-sunset` and `halo`).

**A low Sun's glare.** Cesium's single-scattering dome comes in white where the Sun's
forward-scattered light is strongest but less reddened than at the horizon: a white rim round a
low Sun's cream glow, and a hard edge to the blue beyond it. Scattered sunlight is the Sun's own
colour, so as far as the dome runs white within 35° of the Sun it takes the Sun's tint at half
strength (none from a high Sun, whose tint is white), and a wide, soft aureole in the same colour
is laid round a Sun under 15° (two exponentials, 9° and 22°, over what the dome leaves dark): the
glow falls away into the blue instead of stopping at a line (`golden-viewpoint`,
`water-golden-toward`). **Caveat:** a correction to the picture, not a second scattering order;
the mound of the glow is still Cesium's.

**Altocumulus.** Broken mid cloud (the mid cover under about 45 %, a sheet again by 75 %) is a
field of cloudlets, not a torn sheet: a cell pattern in the wind's frame, some 300 m to a
cloudlet (1-5° from under it), their places, sizes and outlines irregular - small and apart
where the sheet's own noise is thin, run together where it is thick, so the sky is covered by
about the forecast's share still - each a little greyer in its middle and, under a Sun below 40°,
brighter on the flank turned to it and shaded on the other. Below 17° of elevation, where the
cloudlets could not be told apart, the field fades to the plain sheet (`altocumulus`,
`altocumulus-sunset`).
**Caveat:** one kind of mid cloud by its cover alone; the forecast does not say altocumulus or
altostratus, and the ground's cloud shadows still read the plain sheet.

**Ground in cloud.** The low deck has a base - the forecast's (`cloudBaseKmFor`), or 1.5 km over
the place's ground - and ground that stands above it is in the cloud: under a low overcast the
valley sides run up into the grey and the peaks are gone; under broken cloud a summit shows
through the gaps. For a ground pixel above the base, seen from under the deck, the grade lays the
deck's own grey over it by the length of the ray inside the cloud (from the base up to the point,
or to the deck's top: 300 m over the base for thin cloud, 1.2 km for a dense deck; a 120 m
visibility inside), where the sky's cloud field - read where the ray crosses the base, as for the
sky beside it - has cloud; where the cloud is dense its base hangs up to 120 m lower, and it
rises and falls by some 70 m along the slope (two noises over the ground point's own place), so
the cloud meets the mountain in wisps and not along a ruled line. Heights are over the place's
ground with the Earth's curve counted in (`synth-ridge-in-cloud`, `synth-ridge-in-gaps`: a 380 m
base on the 800 m ridge).
**Caveat:** only from under the deck: a camera above the base (an orbit, or a summit over the
cloud) sees no cloud below it - there is no sea of cloud yet; the mid and high decks hide
nothing; and the ground in the cloud is lit as the rest is (no dimming of what shows through a
thin edge).

**Snowfall.** What falls is snow where the forecast's weather code says so (71–77, 85–86), rain
where it says drizzle, rain, showers or thunder, and otherwise by the 2 m temperature (snow at
0 °C and below, rain from 2 °C; `snowShareFor`). Snow is drawn as flakes, not streaks: soft pale
specks at three depths over the frame, as pale as the sky that lights them (so they show against
anything darker and are lost against the sky), dim by night; rain's streaks take only the liquid
share, and a rainbow needs rain (`snowfall`). A scenario has no thermometer: its precipitation
falls as snow through the lying snow's own season at the place (`lowlandSnowCover`'s reliable
core: a January storm in Fairbanks is a snowstorm) and as rain otherwise.
**Caveat:** the flakes are an overlay on the picture, not a volume: they do not thin with
distance or hide the far shore (the forecast's visibility does that through the haze).

**Silver linings.** Broken low cloud seen against the Sun is lit from behind: within about 15° of
the Sun (an e-folding of 0.26 rad from it) a cloud's core is up to 45 % darker - the light has to
get through it - while its thin margins (where the cover's edge runs, 4c(1−c) of the cloud's
coverage c) scatter it forward and glow within about 8° (0.14 rad), white by day and gold at a
low Sun. Only for broken
cloud (gone as the low cover closes from 60 % to 95 %) and in daylight (`partly-sunward`).
**Caveat:** a 2-D sheet's notion of a margin; real cumulus are lit through their tops and sides
too, and a cloud's own shadow on its neighbours is not modelled.

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

From the dusk the town's lights come on: none with the Sun 2° up, all by −4° (`cityLights`). The
buildings' walls carry a grid of windows — bays 3.6 m wide, storeys 3.2 m tall, each window 40 %
of its bay and half its storey — of which up to 38 % are lit, each its own warm-to-cool white and
brightness and staying lit or dark, the light added after the shading rather than scaled by the
scene's. Where a pixel spans more than about half a window, the grid gives way to its mean glow.
The grid is anchored to the world (across a wall by its direction and the camera's position as
Cesium splits it, up it by height above the ellipsoid), so it holds still as the eye moves.
**Caveat:** a pattern, not the building's windows — storeys count from sea level, not each
building's base; corners can cut a window; which windows are lit is a hash, not a time of
night (offices and homes go dark on no schedule here). The harness shows it at 19:45 on its
test block (`buildings-dusk`).

By day the same grid is glass: a window is darker than its wall - a third to a half of it, pane
by pane (most of the light goes in and does not come back) - with a little of the sky's light
glancing off it, more the more obliquely the wall is seen (glass mirrors at a grazing angle), so
a wall has a scale and a building is not a painted box. The grid is glazed in one of three ways,
which a building carries in its colour's alpha (`FACADE_ALPHA`, `facadeKind`): windows punched in
a wall (a fifth of it glass); ribbons of glass from mullion to mullion between bands of wall (two
fifths); or a curtain wall, glass from slab to slab (three quarters). A tower over 35 m takes its
material's - curtain walls for the glass towers, ribbons for steel and glass, punched windows for
concrete; a quarter of the blocks between 12 m and 35 m have ribbons; everything lower has
punched windows. At night the same panes are the ones lit, so a curtain-walled tower shows whole
lit bays. Where a pixel spans more than about half a window the wall takes the mean of its glass
and wall, every pane alike, so it neither shimmers nor changes brightness with distance
(`buildings-clear`: a punched block, a ribbon block and a curtain-walled tower). **Caveat:** a
building's glazing is a guess from its height, not its own - a church tower over 35 m is glazed
like an office - and there is no reflection of what stands opposite.

Glass mirrors the Sun. Where the eye stands in a pane's mirrored beam - the view ray reflected
in the pane within 0.34° of the Sun's direction, fading out by 0.9° - the pane blazes in the
Sun's own colour (the direct beam's share of it: none under an overcast, none from a Sun under
the horizon). No pane hangs quite true: each is off by up to a degree, its own way and always
the same, so a wall turned to a low Sun does not flash as one mirror but shows a patch of
blazing panes some five degrees across about the mirror's place, which moves over the wall as
the eye or the Sun does; past telling the panes apart the patch is its mean, a sheen. The
harness measures it (`buildings-glint`): the eye is put where a tower's west wall mirrors the Sun
at 18:30 from 40 m up, and the panes there must blaze where the wall 28 m lower does not.
**Caveat:** which panes blaze is a pattern, and a pane in another building's shadow blazes
(dimmed, not put out); walls and roofs do not glint, nor does water here (the sea has its own
glitter).

A house has a roof (`house-roofs.ts`). Where a footprint is plainly a house - no courtyard, not
a part set on another, 3.5-13 m tall, four corners within 15° of square, 3.5-14 m wide and at
most 30 m long - its walls stop at the eaves and a hip roof rises from all four of them at 30°
to a ridge along the middle (a pyramid on a square). The eaves stand 0.35 m out from the walls,
the slope carried on down past them, with an underside, so a wall's top lies in the eaves'
shadow under a high Sun. The ridge is at the mapped height, so
nothing stands taller than the map said; where that would leave less than 2.4 m of wall the
pitch is lower, and on a slope whose ground would stand within 1.8 m of the eaves the house
stays flat. Each house takes one of six roofings - slates, shingles, one muted clay - by where
it stands, drawn as it is (a flat roof is its walls' colour turned to tar). The roofs are meshed
a tile at a time into primitives of their own beside the walls' (1,500 roofs to each, so a city
tile does not stall a frame), with the same shader, shadows and picking: one slope takes the Sun and the other does not, snow lies on them, and the horizon
reads a ridge as it reads a parapet (`town-above`, `town-street`). **Caveat:** a guess - the map
seldom says a roof's shape. A gabled, mansard or flat-roofed house is drawn hipped all the same,
its ridge along its length; anything larger, taller or not a plain rectangle (a terrace mapped as
one long outline, an L-shaped house) keeps a flat top; the roofings are not the region's.

A crown is foliage, not a smooth green ball (`treeFragmentShader`, `FOLIAGE_GLSL`): two noises
fixed to the ground - leaf clumps 1.6 m across and leaves 0.4 m across - give it relief, an
outline and tone. The clumps stand about 0.6 m proud of the gaps between them and the light takes
each by the way it faces (the noise's slope turns the normal the Sun's and the sky's terms read),
so a crown's sunny side has lit clumps and shaded hollows and lying snow settles on the clumps'
tops. Toward the crown's limb the thinner clumps are cut away, so its edge runs in lobes a clump
wide with the sky between them: never within 0.6 of its radius, always beyond 0.97. The clumps
are a little lighter and yellower than the gaps (±30 %). Each noise fades to its mean as a pixel
grows past its cells, so a far wood does not shimmer. Crowns only; a crown's shadow is still the
whole shape's. A conifer's cone carries its boughs in tiers 1.3 m apart, their heights swayed by
the clumps: each a skirt, wide at its foot where it turns up to the light, drawn in toward its
top in the shade of the skirt above, so the cone has a fir's saw-edged outline and banded flank;
the tiers fade as a pixel nears half of one, the mean brightness kept (`buildings-clear` has one
of each). **Caveat:** the crown under the texture is still an ellipsoid or a cone - no boughs of
its own, no gaps through its middle in leaf - and its lobes belong to the view: as the eye moves
round a crown they change with it. Every conifer is a fir; a pine's open head and a cypress's
column are not told apart.

Through the lying snow's season (the ground texture's `snowCover`, `setSnow`) the buildings and
trees carry it on whatever looks up: a roof goes white by the snow's extent wherever its face is
within about 45–70° of level (steeper faces and walls shed it), a crown's top in patches at a
little over half that, as conifers hold snow (`buildings-snow`). While the ground is wet (rain
falling or the forecast's recent rain, the ground texture's `wet`) walls, roofs and leaves are
darkened with it, by up to a quarter (`buildings-wet`). **Caveat:** no drifts, no
melt from heated roofs, and the snow is all or nothing across the town.

With the windows, the street lamps: along OpenStreetMap's roads within 1.5 km of the place (5 m
wide and up; no paths, tracks or yards), one every 35 m, staggered either side and set back half
the road's width plus a metre, 7 m over the ground (`street-lamps.ts`). Each is a soft point of
its own light, white LED or orange sodium (two in five), smaller with distance, hidden behind
terrain and buildings, and on as far as the town's lights are. Their light is not the scene's,
so a moonless night, when the globe itself goes black, still shows a town's streets as strings
of lights. **Caveat:** where lamps stand is a rule, not a survey (OpenStreetMap rarely maps
them); they light nothing round them — no pools on the street. The harness draws them along a
made-up street grid (`buildings-dusk`, `buildings-night`).

Over them, the towns' glow: the night advice's sky-glow estimate (Walker's law over Natural
Earth's built-up areas, `sky-glow.ts`) drawn in the night sky as a warm dome (sodium and LED
together, a dull orange) falling off with height over about 9°, a lobe toward the strongest town,
all round as the index grows past a horizon glow's and inside a city, with a fifth of it up to
the zenith there; its strength is the night sky's brightness over a natural one on a log scale (a
city sky, 60 times, is full strength). A cloud deck carries 2.5 times as much, lit from below.
**Caveat:** the estimate's own (Natural Earth's larger towns only, 2002–03 data); the dome's
shape and colour are a pattern, not a radiative model.

### Cloud decks in the sky

The grade's cloud decks (low, mid and cirrus) are layers at 1.5, 4 and 9 km above the place's
ground, each read where the view's ray meets it, in kilometres east and north of the eye (the
local east and north at the camera): they keep their place in the sky as the camera turns, take
the perspective of a real layer — large overhead, crowding to the horizon — and within about 8°
of the horizon (fully by 2°) fade to the deck's mean, as foreshortened cloud does. A deck at or
below the camera is not drawn overhead. **Caveat:** flat layers of procedural noise, not volumes;
heights are typical for each band, not the forecast's. They drift downwind with the scene's
clock — the forecast's wind (direction and speed, the wind aloft taken as 2.5 times the
surface's), a trade wind from 67.5° without a forecast — and the cirrus streaks lie along it;
the clock is wrapped every four days, so the pattern jumps once in four days of scrubbing.

### Sunbeams

A low Sun — from just below the horizon to about 25° up, its beam getting through, more so in
hazier air — hidden behind a ridge, buildings or trees lights the air between in lanes. The grade
marches 16 steps from each pixel toward the Sun's place on the screen (at most 0.6 of the
screen's height) through the depth buffer; the share of the way that is open sky lights the
pixel in the Sun's colour, falling off over about a third of the screen's height from the Sun,
and only as far as the Sun's own disc is hidden (five depth reads round it): an open Sun is its
glare's, not rays'. A variant of the grade of its own (`LM_RAYS`), drawn only while such a Sun is
ahead of the camera. **Caveat:** screen-space — an occluder off the screen casts no beams, and
the cloud decks (painted in the grade, not in the depth) none either; the beams' strength is a
look, not a scattering model. The harness shows them at the tower (`sunbeams`).

### Halos

A cirrostratus sheet (high cloud from 35 % cover, in full by 80 %) carries the 22° halo round the
Sun: a ring peaking at 22.7°, cut sharp inside 21.6–22.3° and reddish there, fading white
outward, the sky 6 % darker inside it; with the Sun under about 40° (fading from 30°) the two sun
dogs at the Sun's elevation, at the azimuth offset where the angular distance from the Sun is 22°
(cos Δaz = (cos 22° − sin²h) / cos²h, so they stand wider of the Sun as it climbs), red on the
Sun's side. All of it weighted by the veil at the pixel, so it is as patchy as the cirrus. A bright
Moon gets the ring by night, white. **Caveat:** whether the crystals are there to make a halo is
not in any forecast — the halo shows wherever the sheet is, as a possibility; no other arcs.

The Sun shows through the sheet: the veil thins to a fifth over the Sun's disc, the disc (0.53°)
is drawn white-hot in proportion to the veil, and the ice's forward scatter adds a tight glow
(falling off over about 1.2°) and a wide one (8°).

### Rainbows

In showers with the Sun's beam getting through (a forecast's showers through a broken sky) and
the Sun up but under 42°, the grade draws the rainbow round the antisolar point: the primary
bow from 40.6° (violet, inside) to 42.3° (red, outside), the secondary from 50.4° (red, inside)
to 53.4° (violet, outside) at about two fifths of its strength, the sky 7 % brighter inside the
primary and 6 % darker in Alexander's band between them, the colours mixed a third with white for
the Sun's half-degree disc. The radii are the textbook's for raindrops (refractive index 1.333);
the position is exact for the Sun's direction. **Caveat:** drawn over the whole sky opposite the
Sun, not only where a shower's curtain stands, and as bright over a sunlit cloud as over a dark
one; no supernumerary bands; the weather decides only that showers are about, not where.

### The map view at night

The overhead map is a chart, not a photograph. Once the Sun is under the horizon and nothing
else lights the ground, real lighting would leave the chart black, so the map view shows the
basemap flat and dimmed — 90 % brightness just after sunset down to 45 % in astronomical night
(`globeShadingFor()`, tested), opening to it over the first 2.5° from about what the lit globe
showed at sunset, so a played sunset does not flash the chart three times brighter — while the sun overlay, the sky backdrop and the night-sky
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
take it to Minimal, where terrain shadows are off. Anti-aliasing steps with the rungs: 4x MSAA on
Ultra and High, 2x on Balanced, and FXAA alone on Battery and Minimal. The governor starts on
High, or on Balanced where the WebGL renderer names an integrated GPU (Intel HD/UHD/Iris, AMD's
APU graphics, Adreno), and climbs if the machine has headroom. A step down applies at once; a
climb (which rebuilds the shadow map and the multisample buffers) waits until the camera has
rested 1.5 s, so it never stutters a drag that is going well. The drawn resolution is at most
two pixels per CSS pixel, and one where the WebGL renderer names a software renderer
(SwiftShader, llvmpipe, Microsoft's Basic Render Driver: `software-gl.ts`), where every pixel is
shaded on the CPU.

### Smoothness

The scene renders on demand, and the work that is not drawing is kept out of the frames that
are: building tiles are decoded and described, and seasonal imagery tiles recoloured, a few
milliseconds a frame (`buildingsFromTileSteps`, `FrameBudgetQueue`); a camera-only scene rebuild
(a drag of the look direction) is about a tenth of a millisecond, the Moon's rise and set kept
per place and day. Motion that the inputs deliver in steps is drawn continuously: the viewpoint
eye glides between walk steps at the walk's speed, and the Sun's light glides between the
clock's minute steps while the day plays or is scrubbed (steps arriving up to 550 ms apart
glide over the time between them, so the slowest pace — a minute every half second — drifts
without pausing; a step on its own glides a quarter of a second). The sky, the clouds, the
Moon, the planets and the map's sun marker, ray and shadow line glide with the same clock, and the
day's, the year's and the night's paths are laid out as geometry only when they change (a new
day, year or pin); a jump to a new place or a new date lands at once, as does everything under "reduce motion". A walk does not resample the terrain
horizon or rerun the night and season scans at every step: they wait until the pin stays put.

## How to verify

- `pnpm test --filter @lightmap/astronomy` — USNO golden set.
- `pnpm test --filter @lightmap/renderer` — sun vector mapping, lighting parameters, controller.
- Dev perf panel (press `` ` `` in development; plan §27): renderer mode, quality rung, FPS, draw
  commands (Cesium's pre-cull command list for the last frame — a pick pass between renders shows
  up here too), terrain tiles shown/loading, WebGL2 / WebGPU API / GPU string, weather cache hit,
  and Δ between LightMap's sun vector and Cesium's own ephemeris (expect < 0.5°).
- Manual: set Kailua, 31 May 2026 12:30 → sun 89° (near zenith, shadows nearly vertical); 18:45 →
  golden, shadows long toward the ENE; 19:30 → blue hour, no direct light.
