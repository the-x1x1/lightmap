# Changelog

All notable changes. Versions follow semver; `pnpm release <version>` prepends entries from commits.

## v0.3.2 — 2026-10-15

- **The far imagery takes the season**: beyond the painted ground, broad-leaf woods turn a mosaic
  of yellow, orange and red in autumn and grey-brown when bare, grass goes tan, and lying snow
  whitens open ground; conifers, water and towns keep their colours (b3b1aa5)
- **After sunset the landscape stays readable**, as to an eye or camera that adapts: just after
  the Sun goes down the ground is about twice as bright as before, and it darkens through civil
  twilight to night (fb99574)
- **Smoother dense cities**: each building tile becomes one primitive once drawn, instead of
  dozens (Midtown and Kyoto drew 220-370), built in the background (59e0fef)
- **LightMap for Intel Macs**: a second disk image for x64, built and tested like Apple Silicon
  (2d32274)
- Desktop sign-in: a link approved from another network than the app asked from needs the code
  typed from the app, so a sign-in link sent to someone cannot hand over their account (c9f4512)
- Windows and Mac builds are signed (and the Mac app notarised) once the signing certificates are
  added to the repository's secrets; until then they build unsigned as before (4f42f81)

- **Winter snow in the lowlands**: where a snowpack lasts the winter (Montreal, Moscow, Helsinki,
  Tromsø, Hokkaido) the ground and the far imagery go white through its heart; places whose snow
  comes and goes stay bare, and the forecast's snow depth still decides inside its horizon (3efd2c2)
- Shallow water near the shore shows its bottom: turquoise in the tropics, a muted green further
  from the equator (d36476c)
- Buildings on a slope stand clear of the hillside instead of being cut by it (9479f98)
- Roofs take a roofing grey instead of their walls' colour (001f302)
- **The Earth's shadow and the Belt of Venus** in a clear sky opposite a low Sun (6c59b70)
- Bare winter crowns read as twigs, densest across the crown and feathered at the edge, not as
  netting (d86d2ee); autumn on the northeastern US seaboard comes two weeks later, so Central Park
  is in full colour in early November (7824d25)
- Far ridges standing above the horizon are drawn as ground in the haze, not as a black band of
  'sky'; the glow over a Sun just under the horizon is warm, not clipped white (dd37462, d7e0708)
- Trees' undersides and walls in shade keep their sky light instead of going black under the
  shadow map (9699126)
- A shower passing through a sunny sky is no longer drawn as a storm (6b7d057)
- The viewpoint never sits under the terrain after a move, and is no longer stood on the coarse
  globe as if on a roof in steep country, nor is the horizon raised by it (344d49a, 40022f7)
- A viewpoint on a bridge stands on its deck, level with where it meets the banks (8ab4bab)
- Places keep their own time zone's name: Oslo, Stockholm and Copenhagen read Europe/Oslo,
  Europe/Stockholm and Europe/Copenhagen, not Europe/Berlin, and Reykjavik Atlantic/Reykjavik, not
  Africa/Abidjan (5853ae5, 2be2f3e)
- Enter in the place search takes pasted coordinates at once and a name's first result when it
  arrives (7c42ea6)

## v0.3.1 — 2026-10-15

- **LightMap for Mac** (Apple Silicon, macOS 12+): a disk image, its own window with the Mac menus,
  and the same self-installing updates as Windows; built, installed, updated and crash-tested in
  CI (6dbb837, 485606e)
- **The seasons on the ground**: broad-leaf trees turn yellow, orange and red in autumn and stand
  bare in winter, grass goes dormant, by latitude, height and a maritime rule for the west coasts;
  the tropics stay green (94258dd, 485606e)
- **Free saves three projects**; the fourth is Pro, and archived projects count (1a76a4c)
- **Desktop accounts**: the apps sign in to the hosted LightMap through the browser and see the same
  account, plan and projects, once the hosted service is deployed (b6d3713, 485606e)
- Smoother walking into a city: buildings and trees load one slice per frame, and the street map is
  drawn in a few strokes (858470c, b622b48)
- The weather scenario and lens chips wrap instead of being cut off (227d79e); E2E tests the
  controls without the 3D scene (5d7d74b)
- **Times you can trust at every latitude** (V&V): tonight's dusk is tonight's even after midnight,
  and evening golden hours run forwards in a northern summer; daylight is counted in full near the
  midnight sun; times round to the nearest minute as almanacs print them; DST gaps shift forward
  west of UTC too (3e0a73a). Stepping the date across a DST change keeps the clock, and a 25-hour
  day is all reachable (9ec8dfb). A far place never borrows the last place's zone, and a late
  lookup cannot move the pin back (552b814). The light finder removes refraction from a direction
  picked in the view (b40ab34); the week ahead lists polar golden light (this release)
- "Point with phone" keeps following a phone held still (edf7e77); "11:60", "-1° up" fixed;
  offline, a failed edit keeps the projects, a viewpoint link waits for the connection, and the
  chunks in use stay cached (a62d693, 68d4e2b); the 3-project limit holds under concurrent
  requests (a84ee7f)

## v0.3.0 — 2026-10-15

- **LightMap for Windows**: an installer (per user, no administrator prompt), its own window, and
  updates that download in the background, are checked against their SHA-256 and install
  silently when LightMap closes ("Restart now" does it at once); `apps/desktop`, built, smoke-tested
  installed and published by `desktop.yml` (d53fd3a, 713b1ed)
- **Viewpoint first**: a place opens standing there; click the ground to walk, W A S D to step
  (f8182b0); on a building the eye stands on its roof (6b31391)
- **Buildings everywhere, no key**: OpenStreetMap buildings from OpenFreeMap vector tiles, extruded
  on the terrain, lit by the Sun, casting shadows, in the horizon; facade colours; the skyline's
  tall buildings out to 6 km; leaner on the cheapest quality rungs (69f4f90, cd8cc7c, 5a7f0b7,
  d184a58, 4d09f9c)
- **Trees** in OpenStreetMap's woods and parks, casting shadows; none where you stand (ad5bcca,
  ea8467d)
- **The ground knows the map**: land use and land cover painted from OpenStreetMap (162c92d), the
  streets near you drawn to their width and following you (aaec568, cf0d9f4), and the shoreline
  near you from the map rather than the terrain's coarse water mask (403d125)
- **Imagery**: Sentinel-2 cloudless 2016 (10 m, CC BY 4.0) replaces Natural Earth II as the default
- Saving a preference with a database attached no longer fails (ce1ebb6); the project drawer keeps
  the open project across tabs (e15f223); E2E expectations corrected

## v0.2.3 — 2026-10-13

- Dry ground toward tan and ochre; RENDERING_ACCURACY documents the coastline (5a60265)
- Cleaner coasts and cliffs worldwide (268afde)
- Smooth the terrain's water mask on every coast (ab08b0b)
- Coast: seabed below sea level is water; only ground well above the sea overrides the mask (ee20b5c)
- Sea level calibrated to the terrain's own sea near the pin (f59536b)
- Coast thresholds from measured Waikiki heights; lakes above sea level keep the mask (e56fed6)
- Sea level from a bundled EGM96 geoid; the terrain decides the coast (e54d669)
- Place names: keep only the visible few in the label collection (05726d2)
- Ground shader on baked textures: faster compile, no shimmer; governor samples real motion (a3a34df)
- Cover map sampled without mipmaps: towns finally draw (5458b15)
- Shaders: ASCII only (the real cause of the missing towns on Windows) (bc7e25a)
- Coast jitter without a branch: towns now render on Windows (cc7cd42)
- Towns render on Windows: shared coast/mottle noise, street grid with lots (1f8cf5f)
- urban cells decode through unknown (lint: no unsafe any) (01f09a9)
- towns without a land-cover source: Natural Earth 1:10m urban areas (public domain) bundled in 10° cells (data/urban, pnpm urban:areas, 2.4 MB, ≤ 130 KB a cell) are filled into the ground's cover map around the pin as built-up ground, and close up built-up ground reads as city blocks on a ground-fixed 48 m grid with streets and the odd park; the preview basis says so; tested; DATA_SOURCES, PRODUCT_SPEC (76e29f8)
- format:check skips the generated place-label data (one minified JSON line, as pnpm labels:places writes it) (0d9ab81)
- viewpoint: switching to it cancels a flight still under way to the orbit view (the flight carried on and left the 'viewpoint' 900 m up, looking down at the beach) (009872a)
- water at a grazing angle is a mirror: the sea paint gives way (Fresnel) to the globe's own water shading toward the horizon — the sky's light and the Sun's glint path at a sunrise over the sea — and holds only looking down into it (d4c7d73)
- a renderer fault no longer takes the page down: applying a scene is guarded and logged (an exception in that effect unmounted the whole planner to Next's 'Application error') (3a64f24)
- coast from further out: a broader, world-anchored jitter (≈350 m) takes over the shore threshold with distance, where the mask's coarser tiles step in hundreds of metres (748ab8c)
- camera: a correction arriving while the flight to a place is still under way (its ground height now known) becomes a short flight to the corrected view — the old flight carried on and parked the camera at its first, sea-level target, 3 km inside Mount Rainier (af42cb2)
- renderer diagnostics: with localStorage['lightmap:debug'] = '1' the scene host is reachable from the console (nothing is exposed otherwise) (ff9a51a)
- shore only where sea level was measured: until the terrain's height at the pin is known against its height above sea level no ground is painted as shore, and the band is 6 m, not 14 (D.C., on a geoid 33 m under the ellipsoid, read sea level 0 and turned to sand); tested; RENDERING_ACCURACY (a4fae97)
- place search ranks for photographers: by Nominatim's prominence with natural features a little ahead, so 'Mount Rainier' is the volcano, not the Maryland town Nominatim's text match put first; tested (a3e2648)
- coast: the shore threshold is jittered at 48 m as well as 12 m, so the mask's 50–100 m steps break up at mid zoom too (12f1c9f)
- phone header: the brand shows as its mark alone below the sm breakpoint so the search box has room for its 'Where will you shoot?' prompt; shorter prompt (b19b897)
- ground paint fades out between 150 and 600 km from the camera, so the globe from orbit is the bundled basemap again (the procedural ground and the water mask's level-0 tiles painted blocky continents over it) (e0feec6)
- ground: the detail tiles lend mostly light and shade, little hue (full tile hue over the macro colour turned grass lime at a viewpoint); turf a touch less saturated (4f78aec)
- grade haze lives near the ground: a path that climbs out of it (an orbit camera looking down) takes the optical depth of a 1 km-scale-height layer, not the whole distance at ground density, and the low-sun term no longer double-counts the scenario's haze — a foggy forecast hid Yosemite Valley entirely from 1.5 km above it (7b6c605)
- grade: the per-frame function uniforms are not written through again (the stage makes them read-only; reassigning one threw and took the page down) (0e356bb)
- grade: sky versus ground by the view ray's elevation against the camera's own horizontal (local up in eye space and the camera height, passed per frame as function uniforms) — the depth buffer read 'no depth' over loading ground and the overcast deck covered an entire valley (27cf51e)
- grade haze: eye-space distance from the depth as stored (czm_windowToEyeCoordinates reverses the logarithmic depth itself; handing it czm_readDepth's value put all ground at an enormous distance and hazed an overcast valley to a flat grey) (30c8beb)
- grade: sky is what the view ray reaches past the Earth, not merely 'no depth' — terrain still loading read as sky and the overcast decks painted a whole valley grey; the decks are a sky seen from under them, so an orbit above ~10 km shows dark space around the globe, not cloud; ground with no depth yet is not hazed (992a4dd)
- overcast no longer greys the ground out: fog and aerial perspective follow a visibility (≈60 km clear, 20 km overcast, 10 km rain, 4 km thick haze) — the fog's density is 2 / visibility (the linear 0.0009 × haze put ground 1.5 km away at 84 % fog) and the grade's haze uses the real distance through the air from the depth buffer (a curve on raw logarithmic depth hazed a valley to 85 %); tested (d295dc1)
- orbit camera clears the terrain: the pitch steepens (7.5° at a time) until the camera and its sight line stand 40 m clear of the ground, sampled before the move — a shallow orbit in Yosemite Valley parked the camera inside the valley wall and drew nothing at all; tested (b5c105f)
- pnpm test works per package: each package's test script runs its own tests through vitest.package.ts (from a package directory Vitest found the root config and resolved its projects against the package, failing in all twelve) (e18278d)
- coast: the mask's soft, stepped edge is thresholded against ground-fixed noise, so the shore reads as an irregular line instead of a staircase of blurred squares (d69f317)
- coast: water follows the mask wherever the ground is flat to about a degree, with no height cut (sea level here is an estimate good to several metres; the cut dropped Honolulu's harbour and shore) (200cdf0)
- coast: the mask's coastal water needs near-perfectly flat ground within 6 m of the estimated sea level (the 2 m cut, against a sea level estimated to a few metres, dropped Honolulu harbour); softer mottling hue; place names wait for a frame that drew the globe (57df90e)
- ground between orbit and foreground: never-repeating, world-anchored value noise at 48, 12 and 3 m cells (an integer hash on whole cells from the CPU, so it is precise and fixed to the ground) carries the middle zooms, each scale fading in by its size on screen; the detail tiles appear only once a period spans 40 px (shrunk further, a tile's repeat read as a grid of dots) at 2.5 m and 6.7 m; place names wait for the globe's first tiles; tested; RENDERING_ACCURACY (b30b976)
- coastlines from the terrain: within 30 m of sea level the coarse water mask counts only below 2 m and flat ground at sea level is water again, so the mask's 50–100 m stair steps no longer cut across harbours and shores (mountain lakes keep the mask); labels rasterised at twice the size and drawn at half, crisp on any display (6a823df)
- water and labels close up: the painted ground takes water over (a deep sea colour over most of Cesium's water, whose HDR wave highlight made every bay a flat bright cyan) and only where the ground is flat (the coarse mask's 50–100 m steps no longer climb the hills); place labels stay in view near the ground (the horizon margin hid every label once the camera was low; tested) (540cbbd)
- LocationSearch: the placeholder prop accepts undefined (exactOptionalPropertyTypes; MapShell passes none once a pin is set) (80dee96)
- smoother zoom: the ground detail level eases between quality rungs over half a second (a rung change mid-flight faded nothing in, it switched); flights are sized to their distance (a fixed 1.2 s from orbit to a street outran the terrain); a 1000-tile cache with ancestors preloaded so zooming back out redraws from tiles in hand (a5e72f6)
- place names on the globe: countries from orbit, then capitals and cities, then towns as the camera closes in (Natural Earth 1:10m places and 1:110m countries, public domain, bundled as data/place-labels.json by pnpm labels:places), each fading in by Natural Earth's own zoom, culled exactly at the horizon, hidden at a viewpoint; ground tiles: each tier takes its own camera offset (a scaled fine coordinate jumped every 2.5 m of camera travel) and the ground frame is anchored at the pin, not the camera (a re-anchor every 3 km shifted the whole pattern while zooming); tested; DATA_SOURCES (c9d24fb)
- ground texture, smooth from orbit to the foreground: the detail atlas is cut into four wrapping, mipmapped textures at load (one texture's quadrants bled into each other at every mip level — the near field went grey then popped while zooming) and laid in three tiers (46, 10.75, 2.5 m) that each fade in by their size on screen, out to 12 km; over the bundled 500 m basemap the paint covers land (its sea and lakes showed as blue blocks on the ground near coasts), the terrain's water mask keeps the shore; the 'Where will you shoot?' card no longer sits over the globe — the search box carries it; atlas regenerated without borders; smoke probe and GLSL preview use the four textures; RENDERING_ACCURACY; tested (e584f12)
- a production build on one machine showed the UI but no globe and every API answered 500: @spz-loader/core (Cesium's Gaussian-splat decoder, inlined wasm as a string) is aliased to a stub because Next's minifier turned its string into a template literal with an octal escape and the browser refused the whole Cesium chunk; LIGHTMAP_STANDALONE=true lets a production server run with no database and no accounts (map only; warns; never for a public host); next.config.ts loads the root .env the README tells people to create; RELEASE_PROCESS §5a, README, .env.example; tested (8178747)
- production build never got past "Loading LightMap…" (second cause): the home page was statically prerendered, so Next could not put the per-request CSP nonce on its script tags and 'strict-dynamic' refused every chunk; the root layout now renders every page per request (force-dynamic); SECURITY_MODEL (2888eff)
- a production build on http://localhost never got past "Loading LightMap…": the CSP's upgrade-insecure-requests turned every chunk request into https://localhost, which nothing answers — it is now sent only on a page that itself arrived over HTTPS (directly or via x-forwarded-proto); tested; SECURITY_MODEL (bfb4475)

## v0.2.2 — 2026-10-12

- PC gate: createOsmBuildingsAsync takes colour and style only — shadows and the screen-space error are set on the tileset after creation (typecheck and build); two assertions the lint called unnecessary dropped from the basemap pixel read; the weather error reads the Error's message, never an object stringified (lint); the ground-texture test's environment fixture uses the real EnvironmentState fields (f875338)
- land cover could not load under the CSP: the operator's LANDCOVER_XYZ_URL host now joins img-src and connect-src like IMAGERY_XYZ_URL (dataHosts, tested); the timeline's ridge markers, the planning card and the finder's ridge note say "terrain and mapped buildings" when buildings are in the profile (horizonShortCaveat); docs caught up — PRIVACY lists the land-cover tile host and ion as third parties, COST_MODEL the atlas and tile traffic, SECURITY_MODEL the CSP sources, README (buildings, eclipses, the LANDCOVER env), PRODUCT_SPEC, RENDERING_ACCURACY (snow ≥ 1 cm, the quality ladder's buildings row), RELEASE_PROCESS, a tile-host runbook (8321896)
- renderer: the no-normals status reads as a condition to check, not a verdict (5a8d60d)
- renderer: a terrain set without vertex normals is named in the status (the painted ground needs them; the basemap shows bare otherwise) instead of passing for a texture fault; RENDERING_ACCURACY, QA_PLAN (27018b9)
- renderer smoke: the probe takes the app's detail atlas (served beside the page) with its own ENU frame kept up each frame, and two close-up shots from 40 m at two headings show the grass grain with no grid, fixed to the ground as the orbit turns; QA_PLAN and RENDERING_ACCURACY say what the harness now shows (09cea5c)
- profiles: "customised" means the user changed something, not that a row exists — sign-up creates the row (Auth.js createUser), so a device's signed-out choices were never adopted on first sign-in; migration 0005 adds profiles.customized_at (backfilled for rows updated after creation or away from the defaults), set on the first change and kept; integration and runner tests; PRODUCT_SPEC (7124b47)
- after review (painted ground, preview basis, façade pick): a recreated ground material re-anchors the detail atlas's frame (toggling the preference off and on no longer projects the grain along identity axes); the preview basis says the ground is painted only when it is (terrain, the flag, the preference, the rung); a façade click without terrain loaded there falls through to the ray pick instead of pinning a wall's height; the checkbox has a short accessible name with its explanation as the description; the E2E waits for the PATCH before reading the profile (19dc5c9)
- after review (snow, buildings, PDF): the shot-list PDF keeps a block's text and picture on one page whatever the picture's shape, wraps on the WinAnsi text it draws (substitutes no longer run into the margin), drops control characters (a tab is two spaces), reads a JPEG's component count and sends greyscale/CMYK through the canvas (the PDF declares RGB), and refuses an empty frame or a scan before any frame; a click on a building's façade pins that footprint at ground level instead of the terrain behind the tower, and the globe's ray pick no longer waits on depth-texture support; "1 m" of snow rounds from the centimetres; the shadows caveat no longer says the horizon never sees buildings; tests for each (054e0da)
- README: the painted-ground preference (3bc09f3)
- use-scene test: the land-cover descriptor in the capabilities fixture and the environment's land-cover source (0a803b4)
- store tests: the painted-ground preference (69a8698)
- ROADMAP: the Phase 4 table row names the land cover and the detail atlas (01e0175)
- database: migration 0004 in the runner's list test (f38b7be)
- preferences: "Painted ground" — the procedural ground texture (with the land cover and the detail atlas) over the basemap, on by default; off shows the bare basemap under the same light, the plain map some photographers prefer and the quickest way to tell the texture from the imagery; migration 0004 (profiles.painted_ground), DTO, patch validator, store, device/profile sync, the planner's render settings; unit, integration and E2E tests; PRODUCT_SPEC, QA_PLAN (b2fffbb)
- preview basis: the scene-detail reason names what paints the ground — by rule (no land-cover data) or the configured land-cover source — without grading it (a tint, not detail); `EnvironmentState.landCover`; tested; PRODUCT_SPEC (60bad78)
- ground texture, after review: a slope's facing read from the fragment's normal (the interpolated aspect angle wraps at east and streaked east-facing slopes), scaled by latitude so the tropics barely move (polewardWeight, the snow's facing rule too); the cloud dapple drifts along the place's own east and north at a visible 200 m/min instead of along ECEF axes, and fades toward the horizon; a complete mid-level sheet dapples nothing (gaps from the total cover); the dapple's clock set when the material is created; the forest crowns computed only under canopy; tests for the real quality ladder, the storm's wet ground, re-apply on scenario and rung changes; RENDERING_ACCURACY (8ab1597)
- ground texture: a slope's facing — the equatorward face that takes the noon Sun dries to scrub, the poleward face stays greener (a mid-latitude rule, flat ground unmoved), the same facing the snow already used; RENDERING_ACCURACY (9db888b)
- land cover: a concrete example source in .env.example and the licensing doc — the XYZ form of ESA's WorldCover WMTS on Terrascope, with the terms-and-CORS check it needs first (df7d07f)
- terrain horizon: the building merge is a pure, tested function (mergeSurface — nothing sampled leaves the terrain alone, a roof wins where higher, a pin on a footprint moves the datum to the roof); QA_PLAN row (5c4b7c0)
- buildings in the horizon, after review: a pin on a building footprint (where geocoders land) stands the viewer on that roof instead of walling every bearing with its own building, and the caveat says to move the pin to the street; the building pass runs alongside the terrain levels, its chunks in flight together, so the profile is not held back by tile loading; the badge reads "Sun behind terrain or buildings" when buildings are in the profile; the host's wording says what sampleHeightMostDetailed samples (roofs everywhere, the globe only in view); QA check moved to open ground ringed by towers plus the footprint case (95fb654)
- E2E: the ground detail atlas is served as a real 512 × 512 PNG at its public path (the host would otherwise fall back to the procedural grain without a word) (2fb6975)
- texture pack, after review: the cover map read the right way up (Cesium uploads images bottom-up, so the north edge is t = 1 — the forest 5 km north painted 5 km south) and across the antimeridian; the detail atlas's frame is anchored to the ground (re-anchored only 3 km away) instead of following the camera, which had the pattern slide 1:1 with every move; atlas quadrants for the same flip; the atlas is fetched up front and the material takes the decoded image, with the on-flags for both textures set one render after the upload (no white flash, no blown-out near field on a failed fetch); mipmaps on the material; derivatives taken outside the branch and textureGrad guarded for GLSL 1.00; tile choice folds in the land cover (streets rock, forest floor grass), ranks rock above aridity on steep faces and blends the two strongest tiles; a one-pixel wrapped border per tile so the wrap never bleeds into the next quadrant; the grass tile wraps vertically; known cover texels opaque with crop/bare/ice as B levels (premultiplied alpha costs nothing); LANDCOVER_XYZ_MAX_ZOOM validated; a failed cover read is retried on the next trigger; {z}/{x}/{y} replaced everywhere in a template; the smoke probe now renders a synthetic cover map through Cesium's own upload; docs say what was verified where (a8d99dc)
- texture pack stage 3 — detail atlas: a generated seamless atlas of grass, rock, sand and snow tiles (`pnpm textures:ground`, `scripts/gen-ground-detail.ts`, our own work, 428 KB at public/textures/ground-detail.png) laid over the ground within 500 m of the camera on Ultra/High — chosen by what the macro rules made the ground, projected along the camera's east/north/up and blended by the surface normal (a sharp triplanar), anchored to the ground through the camera's position in double precision, at two scales so the 2.5 m repeat does not read as a grid, a multiplier about 1 on the chosen colour; the noise grain stays on Balanced and when no atlas is given; shader compiled and rendered close up on the synthetic range; smoke probe, RENDERING_ACCURACY, DATA_SOURCES_AND_LICENSING (CC0 replacement path), ROADMAP (stage 3 delivered), QA_PLAN, README (f941189)
- texture pack stage 2 — land cover: an operator-configured land-cover tile source (`LANDCOVER_PROVIDER=xyz`, ESA WorldCover or Copernicus Global Land Cover in their legend colours, both CC BY 4.0, attribution mandatory and shown) is read around the pin — nine tiles, classified by nearest legend colour, packed into a cover map the ground material samples by the fragment's own longitude and mercator latitude — so forest, fields, built-up ground, bare ground and ice paint as what they are, the procedural surface keeping the grain, relief and seasonal snow; unknown texels and places without a source change nothing; re-read when the pin moves 0.05°; shader compiled and rendered on the synthetic range with a cover map; pure classification and tile maths tested; registry, env, smoke probe, RENDERING_ACCURACY, DATA_SOURCES_AND_LICENSING, ROADMAP (stage 2 delivered), QA_PLAN, README (ca4f3d2)
- buildings in the terrain horizon: with `BUILDINGS_PROVIDER=cesium-osm` the mapped buildings within 2.5 km of the pin join the horizon profile (`SceneHost.sampleSurfaceHeights`, the topmost surface from the loaded tiles where it stands higher than the terrain), so the ridge markers, first/last light and the level guide's skyline answer "when does the sun clear that block" in a city; the caveat names the buildings reach and that OSM heights are often estimated; tested, docs and QA checklist updated (c58b81c)
- ground texture: wet ground under rain — darker and duller with the scenario's precipitation, snow apart (bff1b17)
- ground texture: detail follows the quality rung (Ultra/High everything, Balanced without the per-fragment relief and near grain, Battery the base surface) and the relief takes two extra noise samples instead of four, so phones are not asked for hundreds of hash evaluations per fragment (6e94ed6)
- ground texture: broken cloud dapples the ground — cumulus-sized patches of shade drifting with the planner's clock, strongest at half cover of the sun-blocking decks and absent under clear or overcast skies or without direct sun (`cloudShadowStrength`, tested); an albedo pattern, not the forecast's own clouds, and the docs say so (c03f42c)
- README: the ground texture, buildings, snow on the ground and the PDF shot list in the feature list (26273cb)
- ground texture: micro-relief on bare ground — the grain read as small bumps lit by the scene's own Sun direction (albedo shading within ±30 %, no change to the mesh, its normals or the shadows), so rock and scree carry a texture that turns with the light; rendered and checked on the synthetic range; RENDERING_ACCURACY (a58d24f)
- renderer tests: the fake host gains setIonToken (d0b0bbc)
- after review: the ion token reaches the host when capabilities arrive (`setIonToken`, before the providers — buildings and ion terrain/imagery alike), a click picks the ground under the cursor rather than a roof, the sampled ground height re-applies the scene (snow and camera) instead of waiting for the next tick, one snow threshold shared by the Snow line and the texture, imperial snow never "0 in", PDF headings wrapped at their own size, over-long tokens cut, pictures never taller than the page, JPEG fill bytes skipped, JPEG thumbnails embedded without re-encoding, the PDF button guarded and its failure reported, the confidence note says "OSM buildings where mapped", buildings jobs chained; docs (3b07579)
- shot list as a PDF (Pro): A4 pages in Courier with each viewpoint's saved preview under its block, variants indented, notes and the honesty footer — a small dependency-free PDF writer (WinAnsi text with substitutes for the planner's symbols, UTF-16 metadata, DCT images, exact xref offsets; tested, output checked with qpdf and pypdf), thumbnails re-encoded to JPEG in the browser; `export_made` kind `shot-list-pdf`; spec, privacy, QA plan (407a480)
- buildings (Phase 4 "detailed buildings where licensed"): `BUILDINGS_PROVIDER=cesium-osm` puts Cesium OSM Buildings (ion asset 96188) over the terrain — lit by the scene light, casting and receiving the terrain's shadows, refined with the quality rung, OpenStreetMap ODbL attribution shown — behind a `BuildingsProvider` with `none` as the default and the token rule in env validation; `buildingsAvailable` follows it; the terrain horizon still ignores buildings and the docs say so; tests, licensing table, README, .env.example (717be2e)
- snow on the ground: `snowDepth` on every weather frame (Open-Meteo `snow_depth`, forecast and archive; fixture snows where its air freezes; cache key v4), a Snow field line ("12 cm on the ground", inches on imperial, tripod/spikes notes, grid-point caveat), and inside the forecast horizon the ground texture's snowline follows the forecast — under the pin when snow lies, over it when the ground is bare; tests, spec, weather model, rendering accuracy, QA plan (6061ee8)
- renderer smoke: the ground-texture probe also compiles and links the real globe program (Cesium's GlobeVS/GlobeFS with APPLY_MATERIAL, water mask, lighting, fog, ground atmosphere) on the scene's GL context, so the path the app takes on normal-bearing terrain is covered (59c134a)
- ground texture, after review: Cesium's tile bitmaps arrive flipped (the row read was mirrored — the Alps read as the Arctic), so the read undoes the flip; water pixels are left out of the land hint rather than averaged in; the hint is retried when the basemap was not up yet and re-read after the providers settle; pin work survives a debounce reschedule; the night chart's dimming now applies to the surface; shore and snow read heights above sea level (the geoid from the terrain's ellipsoidal height against the known elevation); the near grain is anchored to the ground through the camera's cell offset instead of sliding with the camera; flat vertices no longer feed an undefined aspect into the snow; a material that fails to compile is dropped and the render loop resumed instead of stopping the renderer (584ce8d)
- ground texture: a metre-scale grain in a viewpoint's foreground, anchored to the camera's position for float precision and faded out by 500 m so it never shimmers at a distance (06c7aa2)
- ground texture: the region's land hint from the bundled basemap's own colour — the host reads a 3 × 3 pixel patch of Natural Earth II around the place once per pin (`sampleBasemapColor`), `landHintFromColor` turns green/tan/white into aridity and ice (sea stays neutral), and the material leans the open ground from turf to steppe and desert or to an ice sheet; tested through the controller; docs (fb0aef2)
- ground texture: compiled in a real WebGL2 context and rendered on a synthetic range — `patch` is a GLSL reserved word (renamed), a lattice-free hash for the noise, a greener open-ground palette with the basemap at 25 %, rock from 30°, and a treeline fixed to the climatic snowline (900 m under it) so winter lowers the snow but not the alpine zone (f3ebeb1)
- ground texture (Phase 4 "improved terrain texture"): a procedural surface over the terrain — turf and scrub, bare rock by slope, scree above the treeline, snow above a latitude- and season-following snowline that lies lower on poleward faces, shore at sea level — as a Cesium globe material from the mesh's own height, slope and aspect, blended over the basemap so licensed imagery still carries the hue; `groundTextureFor` (tested), host `setGroundTexture`, `groundTexture` flag, Minimal rung off; smoke-harness probe shot compiles the shader; RENDERING_ACCURACY, roadmap (texture-pack stages), QA plan (95e21a1)
- night planning: eclipses in the year ahead as seen from here — solar (total/annular/partial at this place, totality to the second, disc coverage, the Sun's height, sunrise/sunset clipping) and lunar (contacts, umbral and penumbral magnitudes, whether the Moon is up here), each a jump to greatest eclipse; `eclipsesAhead`/`lunarEclipseAt`/`solarEclipseAt` checked against the 2023–2027 almanac eclipses (contacts within a minute or two); sub-minute path-edge totalities bisected; spec, roadmap, QA plan, README (527375f)
- analytics: two product events — export_made (which kind of export, never its content) and week_ahead_opened — on the same sanitised, same-origin path (tested); PRIVACY and roadmap updated (8171f12)
- refactor: the shot list's exposure comes from viewpointExposure, the same model as the cards (ad5149d)
- projects: saved viewpoint cards carry the exposure estimate for their instant under the saved scenario or cloud (viewpointExposure, tested); docs (578216e)
- ui: the 'copied' notes in the finder and the week ahead fade after three seconds (cc2bef5)
- planner: the week ahead copies as text, one line per day (weekAheadText, tested); docs (3296f3a)
- docs(qa): manual check for the three calendar files (d28916e)
- planner: the week ahead's dark nights carry the forecast's cloud over the Milky Way window when the day's frames reach into it (tested); docs (136c0dd)
- fix: the week ahead's frames guard uses its empty-map fallback (an unused constant would have failed lint) (69a65f8)
- perf: the Moon-ridge marker key no longer recomputes on every scrub tick (2d425d7)
- fix(review): comma-free place cells in calendar UIDs (a UID is a text value); the week ahead's frames guard reads clearly (482097d)
- finder: Calendar downloads the results as .ics events — every date the sun sets behind that ridge straight into the calendar (buildFinderCalendar, tested); docs (ad0ca90)
- night: the dark windows ahead download as calendar events (.ics, Pro export) — one per night with the core's peak and an hour's reminder, stable UIDs (buildDarkWindowsCalendar, tested); docs (5deff8d)
- outlook: the blue hours get the same forecast verdict line as the golden hours; docs (4094ddd)
- perf: the week ahead's rows are memoised on the week, place, zone, dark nights and fetched days — the shell re-renders the block on every scrub tick (4499846)
- timeline: grey 'Moon ridge' ▲/▽ markers at the Moon's terrain crossings that are the ridge's doing (unit test runs on the PC: TSX); docs (4383f97)
- fix(review): useQueryClient in the project drawer runs before its early returns (rules of hooks) (ed653dd)
- projects: the shot list adds a 'Now:' line with the forecast around each shot when the planner already holds that day's frames (read at export time; tested); docs (32ca74a)
- finder: Copy puts the results on the clipboard as text, one line per moment (finderResultsText, tested); docs (d593063)
- planner: Free plans and visitors see the week ahead named with its paywall reason instead of nothing (E2E); docs (30cd8d0)
- planner: the week ahead marks the nights with a dark window for the Milky Way core (darkNights, one scan per week; tested); docs (2b4a503)
- docs(roadmap): phase table brought up to date (a79f10d)
- smoke: an optional --weather probe — today's frames for Kailua from the live provider (fails on the fixture or a short day, warns when the air fields are missing); tested; docs (31d22c9)
- card: at night the planning card says how long the stars stay points with the photographer's lens and sensor (tested); docs (bcd7351)
- projects: tidier viewpoint ordering (164edd1)
- fix(review): the terrain horizon's 'differs' matches crossings in any order, so a Moon that sets before it rises over flat ground is not reported as the ridge's doing (tested); the Moon scan uses the Moon's semidiameter and the Sun's scan is reused when the lunar state arrives; the explanation's 'until' never names the Moon's next rise; one shared weatherQueryOptions for the planner, the week ahead, the finder and the viewpoint cards — cache-only readers carry the real fetch (no rejecting queryFn on a shared query) and the finder's forecast fragments are now reactive (e98f5cc)
- explain: the Moon line says until when it stays behind the terrain (tested); docs (19374fc)
- terrain: the Moon's own crossings of the terrain horizon — 'when does the Moon clear the ridge?' — as spells in the Moon details (moonEvents beside the Sun's, memoised per profile and day; tested); docs (75176fd)
- planner: the week ahead's cell wording lives in a tested helper (weekAheadCellLabel) (6589d87)
- projects: order the drawer's viewpoints as saved or by shoot time; docs (269fd64)
- finder: a result whose day is already in the query cache adds the forecast around that instant ('forecast 20 % cloud, clear'), read from the cache and never fetched by the finder; docs (937c9d8)
- docs(readme): the exposure estimate among the known limitations (b60f366)
- outlook: the hour bars' tooltips carry the air and the wind (4cae53b)
- planner: the week ahead carries the Moon that night (lit fraction, ↓ when down at midnight) for the night shooter choosing an evening (tested); docs (34b6439)
- docs(readme): what it does, brought up to date (d4f967c)
- details: at night at a viewpoint the exposure row adds how long the stars stay points with this lens, since a night setting runs to minutes; docs (25ac547)
- projects: a saved viewpoint card reads the forecast around its own hour from the planner's query cache ('Forecast around the shot: 20 % cloud, clear — direct light'), never fetching on its own; docs (0f391ea)
- timeline: Shift+arrow moves ten minutes on the thumb (E2E); docs (2c157b4)
- fix(review): the week ahead still fetches today after local noon (it read 'beyond the forecast' once the day's noon had passed); the finder's 'behind terrain' count follows the Big Moon filter; the sun-in-frame note allows for the preview's own aspect (da2bc77)
- details: the exposure row says when the viewpoint camera holds the Sun ('sun in frame: flare, expose for it'); docs (8f101a9)
- weather: 'feels like' on the Air line when wind or humidity move the apparent temperature a whole degree (Open-Meteo apparent_temperature on every frame, fixture included; weather cache key v3; tested); docs (5cb8016)
- projects: saved viewpoint cards say the cloud the shot was saved under (ee6e928)
- projects: a viewpoint carries the cloud it was saved under (cloudCoverAtSave from the snapshot's frame, on the DTO); the shot list's Weather line shows it and its Light estimate follows that cloud instead of assuming a clear sky (tested); docs (e208ee5)
- docs(qa): manual checks for the exposure estimate, the week ahead, the climatology air and wind lines and the field view clock (40ca2ee)
- docs(cost): the week-ahead block's weather calls in the cost model (ef208e6)
- finder: 'Big Moon only' keeps the Moon results whose disc is 0.54° or wider (within a few days of perigee); docs (1a6d100)
- planner: the week ahead (Pro) — the next seven days' morning and evening golden hours with the forecast's verdict on each, fetched only while open and only inside the horizon, each time a jump to that window (WeekAhead, weekAheadRows; tested); docs (d4d0761)
- outlook: the hour table carries the air temperature and the wind in the chosen units; docs (8ff56e4)
- fix(review): the exposure estimate no longer steps three stops at the horizon under cloud — twilight is dimmed by the square root of the day's cloud factor, blended over the Sun's first five degrees (continuity tested); a sub-second sky-drift shutter prints as '0.8 s', never '1/1 s'; the shot list computes the Moon once per block; comment and doc figures agree with the code (51156ae)
- outlook: the golden hours under this forecast — each window sampled from the frames with a verdict in the photographer's words (clear, high cloud over a clear horizon → colour likely, thin, broken, clouded out) on the hourly outlook (windowOutlook, tested); docs (8dae92c)
- field view: the exposure estimate for the planned instant on the clock line — a starting setting with the phone held up; docs (bd8a640)
- climatology: typical wind by hour of day from ERA5 10 m wind — the mean and the fresh-breeze share at the selected hour, the calmest and windiest hours, in the chosen units (windByHour, per-hour meanWindSpeed/windyShare, archive requests wind_speed_10m in m/s, fixture breeze, cache key v5 server and client; tested); docs (0c82d49)
- card: the planning card's Moon fact carries the disc width while the Moon is up (tested); docs (472b425)
- camera: sky drift in the depth-of-field box — the longest shutter before the sky's turn smears a star across one circle of confusion with this lens and sensor (the 500 rule done properly), the Milky Way core's own figure; skyDriftShutterS (tested); docs (dc1a518)
- scene: exposure estimate — the incident light at the planned instant as EV at ISO 100 with one starting setting ('EV 14.8 · 1/500 s f/8 ISO 100'), from a clear-sky daylight curve over Kasten–Young air mass, a twilight decay, the scenario's or forecast's direct-light share, moonlight by phase and a starlight floor; in the Sun details, on the planning card and in the shot list, labelled an estimate everywhere (estimateExposure, tested against the classic marks); E2E; docs (ccc8904)
- outlook: the freezing hours of the day on the hourly outlook's field line ('Freezing (≤ 0 °C) 00:00–06:00 — batteries, iced glass'), rows carry the frame's temperature (freezingHours, tested); docs (7129b7e)
- fix(review): the calendar alarm fires an hour before the shot, not the event's start (TRIGGER:-PT30M; wording and docs agree); the climatology query carries the client version (v4) so the day-long HTTP cache is not served a summary without the humidity and air rows; the Moon disc row uses the observer offset only while the Moon is up; the fixture climatology's seasons were inverted and its day ran on UTC hours — both fixed and pinned by tests; an empty calendar is described as such (d6f728a)
- climatology: typical air by hour of day from ERA5 temperature — the mean at the selected hour and the day's coldest and warmest hours, in the chosen units (temperatureByHour, per-hour meanTemperature, archive requests temperature_2m, fixture seasons, cache key v4; tested); docs (f2a5e54)
- field view: the sun as it is now — a hollow ring beside the planned sun while the planner is off the present, and a clock line ('Now 17:30 · planned in 1 h 12 min', 'Live' within 90 s), re-read every 30 s; describePlannedOffset (tested); docs (ed53e82)
- weather: the air on the shoot — 2 m temperature and dew point on every frame (Open-Meteo temperature_2m/dew_point_2m, forecast and archive; the fixture's diurnal air), an Air line first among the field conditions with a freezing note (batteries, condensation) and a heat note (shimmer), on the weather details and the planning card; weather cache key v2 so cached days are refetched with the fields (tested); E2E; docs (1f8cd68)
- finder: each Moon result says how wide the disc is at that instant (0.49–0.56°), so among every date the Moon rises over that ridge the big-Moon one stands out; apparentDiameterDegrees on DirectionMatch for Sun and Moon, null for the core (tested); docs (ef29613)
- astronomy: apparent sizes — how wide the Sun and the Moon look from here and how much of the frame that is through the current lens (Sun disc / Moon disc rows, 0.52° · 10 % of frame at 400 mm); the Moon's distance against its mean and the widest/narrowest of the twelve full Moons ahead, each a click away (moonApparentDiameterDeg with the observer offset, sunApparentDiameterDeg, fullMoonsAhead checked against 2025's published closest full Moon, discFrameShare; tested); shot list Moon line carries the width; E2E; docs (32b1e33)
- climatology: near-saturated air by hour of day from ERA5 humidity — share at the selected hour and when it is most common (dew on the glass, morning mist); humidityByHour, per-hour humidShare, archive requests relative_humidity_2m, cache key v3 (tested); docs (a1837c1)
- projects: add the shots to a calendar — an .ics beside the shot list, one event per viewpoint from 30 min before the planned instant with a reminder, place and reopen link; stable UIDs so re-importing updates (buildCalendar, tested); docs (a68696c)
- test(e2e): the two mobile orientation tests report the compass state, page facts and console errors when they fail (d1e8179)
- fix(renderer): a stopped Cesium render loop no longer tears the 3D view down (it destroyed the widget from inside its own render callback and broke both mobile E2E tests on CI); Cesium's modal panel stays off and the app's renderer notice shows instead; docs (bdc95a3)
- fix(field): the compass keeps listening after the 2.5 s 'no heading yet' note, so a slow first reading still starts the follow (it detached for good, which failed both mobile E2E tests on CI); E2E fires a reading before asserting (406e95a)
- chore: lockfile for nodemailer 10; formatting per the repo's Prettier (a0e7320)
- security(deps): sharp >= 0.35.5 (GHSA-wq5f-xc86-pv6w) and source-map-js >= 1.2.2 (GHSA-68fv-2mgg-jv7q) via pnpm overrides; lockfile regenerated on the next install (c8e7634)
- fix(ci/e2e): Cesium's modal render-error panel is off and a stopped render loop falls back to the overlay map (it sat over the page and swallowed clicks on CI's mobile run); E2E details locators name the direct summary (nested panels made them ambiguous); the two long stories are marked slow; docs (ab68929)

## v0.2.1 — 2026-10-06

- renderer: the map view stays a readable chart at night — flat, dimmed basemap once the Sun is down (90 % at dusk → 45 % in astronomical night) instead of a black globe; the viewpoint view keeps true lighting (globeShadingFor, setGlobeShading; tested); docs (c11348f)
- fix(shell): overflow-clip on the map shell and the map — a focus() or scrollIntoView() below the sheet's fold scrolled the hidden-overflow box, shifting map and sheet up behind a black band (fb58487)
- timeline: marker labels fit the measured track — words where they clear each other, glyphs on a second row where they do not, a bare tick where even that would touch; sunrise and sunset win the space (markerLabels, tested); changelog for the browser-pass fixes (419b123)
- fix(search): choosing a place no longer searches for its own label and reopens the list over the map; the box names a place picked on the globe or reopened from a project (285da28)
- fix(database): the project list's forecast-window count passes its bounds through the column mapping — a bare Date in a sql template reached postgres-js unserialised and failed every GET /api/projects (CI integration failure since 93cd3e2) (7ae29a0)
- fix(auth): without a database the session endpoint answers null/200 the way Auth.js does for a visitor, so SessionProvider settles on signed-out instead of logging ClientFetchError on every load; other auth routes still say accounts are off (503) (21be578)
- fix(renderer): a scene applied after the host was torn down is dropped (StrictMode replays effects: the destroyed Cesium scene has no globe, and setAtmosphere crashed the whole page on the first location pick); setAtmosphere tolerates a scene without a globe; isDestroyed on SceneHost (tested) (60d82a5)

## v0.2.0 — 2026-10-05

- **Milky Way core** (night planning): the Moon details and the planning card say where the
  Galactic Centre stands for the selected instant and whether the sky can show it — "36° up SSW —
  Astronomical night, core 36° up, Moon down" — with one verdict (daylight, twilight, below the
  horizon, moonlit, low, visible) in the order a photographer rules things out; the compass rose
  and the field view mark the core as a four-point star on a dark sky (the field view adds an
  edge arrow when it is out of frame, the core's dotted track over the night's dark hours and
  the Moon's path while it is up — `sampleTrack()`/`projectTrack()`: positions sampled once per
  place and day, projected per frame as the phone turns; tested). The 3D map view draws the
  same two night paths on the overlay sphere beside the day's sun arc (`nightPathsForDay()`,
  tested; dashed grey and violet). `milkyWayCore()`
  / `milkyWayCoreFrom()` in `@lightmap/astronomy`: Sgr A\* precessed from J2000 (Meeus ch. 21),
  the observer's sidereal time, the scene's own Sun and Moon. Not a sky-brightness model (light
  pollution and airglow are not modelled), and the docs say so. **Dark windows ahead**: the Moon
  details list the next nights the core can be shot (≥ 30 min of astronomical night with the
  core 10° up and no Moon over 30 % above the horizon, 45 nights from the selected day's evening,
  edges to the minute and inside the stretch), each a click that jumps the planner to the core's
  peak — or why there are none (no astronomical night, core never up this season, the Moon, or
  only minutes at a time). `milkyWayWindows()`, tested at Kailua, London, the full-Moon nights
  and the grazing cases. The timeline track carries a faint violet **dark-sky band** over the
  night's shootable spells (`darkSkySpells()`/`darkSkyBand()`, tested); the planning card
  lists the next two dark windows; a saved viewpoint planned after dusk carries a night line
  ("✦ Milky Way core 36° up SSW · dark sky", `nightTag()`, tested). The **Light finder** takes the core as a third body: "when does the
  core stand over that peak?" — bearing/elevation matches like the Sun's, kept only in a dark
  sky by default (`darkSkyOnly`; each match says `dark`, `daylight`, `twilight` or `moonlit`).
- **Archive projects**: a project can be archived and restored (`archivedAt`, `PATCH
/api/projects/:id {archived}`, `GET /api/projects?archived=1`); archived projects are kept
  with their viewpoints, hidden from the active list and — with their viewpoints — not counted
  toward the plan's limits, so a Free account can shelve a finished shoot and start the next; an
  archived project takes no new viewpoints (409) until restored. Integration-tested; E2E.
- **Shot list**: a project exported as plain text to copy or download — the call sheet for the
  day, one block per viewpoint in time order (variants under their parent) with the camera, the
  Sun, the day's sunrise/sunset, the Moon and the Milky Way core for night shots, the weather
  basis it was saved with and the project notes (`buildShotList()`, tested; Pro export). Each
  block carries a `/?viewpoint=<id>` link that reopens the viewpoint for its owner
  (`useViewpointLink`; the drawer's "Open" and the link share `restoreInputFor()`, tested).
- **Project notes and shoot date** are editable in place from the selected project (plan §4
  "Projects: name, optional shoot date, notes" — the API had them, the UI did not): notes save on
  blur or Ctrl/⌘+Enter, the date once it has settled, chained so the last edit wins, with an
  honest saved/unsaved status.
- **Dark-hours climatology**: "Typical for this month" adds the night shooter's line — how
  often the dark hours of the selected night (astronomical dusk to dawn) were clear over ten
  years, mean cloud and the overcast/storm share (`hoursShare()`, `hoursBetween()`, tested).
- **Day-of-year slider** under the date control: scrub the seasons the way the timeline scrubs
  the day — the date moves, the time of day stays (plan §44 "scrub through days, months, and
  seasons"); `lib/civil-year.ts`, tested across the leap day. The weather fetch and the
  night-sky scans wait for the date to settle (300 ms), so a drag costs no requests.
- **Checkout return**: `/account?checkout=success` now watches for Stripe's confirmation (the
  entitlement snapshot is re-read every two seconds for up to a minute) and switches from "being
  activated" to "You're on Pro — everything is unlocked" with a link back to the map, or says
  plainly that confirmation has not arrived (plan §38: the existing plan unlocks at once).
- **Moon phase calendar**: the Moon details list the next four principal phases from the selected
  day (New, First quarter, Full, Last quarter, as dates in the planning zone). `nextMoonPhases()`
  in `@lightmap/astronomy` bisects the elongation from the same Meeus series as the positions —
  the published 2026 instants (3 Jan full 10:03, 18 Jan new 19:52, 31 May full 08:45, 15 Jun new
  02:54 UTC) come out within two minutes.
- **"Tonight"** beside "Now": today at the start of astronomical night at the place (`setTonight`,
  tested).
- **Dew and mist in "Typical for this month"**: how often the air is near saturation (≥ 95 %
  relative humidity) at the selected hour and when it is most common, from ERA5's humidity
  (`humidityByHour()`, per-hour `humidShare`; tested; climatology cache key `v3`). Phase 7's
  "haze/rain probabilities" item: humidity now, visibility still needs a licensed source.
- **Add a project's shots to your calendar**: an `.ics` file beside the shot list (Pro) — one
  event per viewpoint from 30 min before the planned instant, a reminder an hour ahead, the place
  and the reopen link; importing again updates the events (`buildCalendar()`, tested).
- **"Point with phone" no longer gives up for good** when the first compass reading is slow: after
  2.5 s it says no heading has arrived yet but keeps listening, and a later reading starts the
  follow (a slow sensor, or a phone picked up late, used to need the button tapped again — and on
  CI's emulated phone it failed both mobile E2E tests).
- **Security**: `sharp` ≥ 0.35.5 (librsvg, GHSA-wq5f-xc86-pv6w) and `source-map-js` ≥ 1.2.2
  (GHSA-68fv-2mgg-jv7q) via pnpm overrides; both arrive transitively (Next.js, Vitest coverage).
- **No more modal Cesium error panel**: a failed 3D render loop shows the app's own renderer
  notice instead of Cesium's "An error occurred while rendering" panel, which sat over the app
  and swallowed every click (seen on CI's mobile run).
  E2E: the details-panel locators name the direct `summary` (nested panels made them ambiguous);
  the two long stories are marked slow for cold runners.
- **The map stays readable at night**: the overhead map is a chart, so once the Sun is down it is
  shown flat and dimmed (90 % at dusk → 45 % in astronomical night) instead of lit by a light
  that is below the horizon, which left it black; the viewpoint view keeps true lighting
  (`globeShadingFor()`, tested; `RENDERING_ACCURACY.md`).
- **Timeline marker labels no longer pile up**: dawn, sunrise and golden hour (or golden hour,
  sunset and dusk) sit minutes apart and their words overlapped in the panel; labels now fit the
  measured track — words where they clear each other, glyphs on a second row where they do not,
  a bare tick where even that would touch; sunrise and sunset keep their words first
  (`markerLabels()`, tested).
- **Fixes from the first browser pass**: picking a location crashed the page in development
  (React's StrictMode replays effects into a torn-down Cesium scene — the stale apply is now
  dropped and `setAtmosphere` tolerates a scene without a globe); without a database the
  session endpoint logged an Auth.js `ClientFetchError` on every load (it now answers signed-out
  like Auth.js does); `GET /api/projects` failed on Postgres (a bare `Date` in a SQL template —
  the window bounds now go through the column mapping; this was the CI integration failure);
  choosing a place searched for its own label and reopened the result list over the map; a
  `focus()` or scroll-into-view on a control below the bottom sheet's fold scrolled the
  `overflow: hidden` shell, shifting the map and sheet up behind a black band (the shell now
  uses `overflow: clip`, which nothing can scroll).
- **Play the day**: a play/pause button beside the timeline clock runs the day by itself at 2, 10
  or 60 day-minutes per second (the pace button cycles them, mid-play too) and starts over at
  midnight — a sunset watched, not scrubbed; the clock waits while the thumb is held and
  continues from the drop point; a hidden tab does not make it leap (`usePlayDay`, `advance()`,
  tested; play, pause and pace in the E2E).
- **Forecast horizon stated as lead, not as the provider's day count**: Open-Meteo's 16 forecast
  days include today, so the last day it serves is today + 15 — the declared horizon is now
  15 × 24 h (the extended band is days 8–15) and a forecast request's `end_date` is clamped to
  that last day, so a civil day running past it in UTC (any zone west of Greenwich) is cut
  rather than refused (tested).
- **Shoot countdown on project cards**: "Shoot 24 Oct · in 19 days · forecast from 9 Oct" —
  civil days to the shoot date and where the provider's forecast stands for it ("extended
  forecast available" once the whole day is within reach, green "forecast available" once it is
  inside the reliable horizon — the planner's own rule, so the card agrees with the viewpoint
  nudges; `shootCountdown()`, tested; E2E).
- **Field conditions in the weather details**: the wind with the quarter it blows from ("4 m/s
  from the ENE", "calm"), the humidity, and visibility in sensible units ("600 m", "4.5 km",
  "24 km"); notes when there is something to act on — a fresh breeze and up ("weigh the tripod
  down; clouds streak in a long exposure" → "tripod shake likely" → "a weighted tripod in a lee at
  best" → "hand-held only"), fog ("lenses mist within minutes"; rain or snow cutting the view is
  not called fog), dew likely at ≥ 95 % humidity after sunset (mist in the air by day), dew
  possible on a calm, mostly clear night from 85 % (`fieldConditions()`, Beaufort's bands and the
  WMO fog threshold, tested). Scenario days say nothing: there is no frame. The planning card
  carries the same line ("In the field") and its notes on forecast and observed days, and the
  hourly outlook names the hours at ≥ 95 % humidity and ≥ 8 m/s wind as runs ("Humidity ≥ 95 %
  02:00–06:00 (dew or mist on the glass) · wind ≥ 8 m/s 13:00–17:00 (weigh the tripod)";
  `humidHours`, `windyHours`, tested).
- **Dark-sky cloud in the hourly outlook**: a line with the forecast cloud over the night's
  dark-sky spells and the clearest hour — "is the core window going to be clear?"
  (`cloudOverSpells`, tested).
- **"Why does it look like this?" at night** names the Moon as the only direct light (or its
  absence) and the Milky Way core with its verdict (`explainScene`, tested).
- **Light windows with their lengths** in the Sun & moon details: "Golden hour 05:33–06:20 (47
  min) · 18:37–19:24 (47 min); blue hour 05:23–05:33 (10 min) · …" in the package's bands
  (golden −4°…+6°, blue −6°…−4°), sampled over the day so midnight-sun and polar-twilight
  windows are listed too (`describeLightWindows()`, tested at Kailua, Tromsø, Oslo and in polar
  night). The planning card's blue hour now uses the same band.
- **Night on the timeline**: ☆ / ★ markers where astronomical night ends and begins (plan §4's
  "night" marker), beside dawn and dusk.
- **Moonrise and moonset on the timeline** (moon planning): grey ☾ / ☽ markers beside the sun's,
  clickable like them; only instants inside the civil day are placed.
- **Forecast nudges on saved viewpoints**: a project card counts the viewpoints now inside the
  reliable forecast window ("◉ 2 inside the forecast window", `upcomingViewpointCount` from the
  list query); a viewpoint card whose date has come inside the forecast horizon
  since it was saved says "◉ Forecast available now — open to see it" (or the extended-range
  wording), and a passed date says observed conditions are there — the North Star's "return later
  and see the forecast become more specific", from the planner's own horizon rule
  (`forecastNudge()`, tested).
- **Moon on the compass rose**: when the Moon is up, the sun-direction overlay marks it as a grey
  disc (brighter the fuller it is) on the same dome, and the overlay's description names its
  bearing, elevation and illumination.
- **Seasonal envelope** (plan §1 "seasonal path"): the compass rose shows where sunrise and
  sunset swing to across the year as rim arcs (June to December solstice), the 3D map draws the
  two solstice sun paths faintly beside the day's arc, the planning card carries the line, and
  "Sun & moon details" reads the bearings and the noon range out ("Sunrise 64°–115° (ENE–ESE)
  …"); polar places name the solstice condition instead. `seasonalEnvelope()` in `@lightmap/scene`, tested
  at London, Kailua, Sydney and Tromsø.
- **Observed weather for any past date**: dates beyond the forecast model's 92-day window now
  load real conditions from the provider's reanalysis archive (Open-Meteo ERA5 back to 1940;
  `archiveDays` capability, computed from that date) — labelled "Observed · reanalysis" at MEDIUM confidence (coarse grid,
  no visibility), never a forecast, cached 30 days. Dates older than any archive stay a labelled
  scenario, as before. `WEATHER_AND_FORECAST_MODEL.md` §2/§6/§7.
- **Water (Phase 4)**: the terrain water mask is requested and Cesium's water effect is on, so
  sea and lakes carry a specular glint from the scene light and a ripple normal map where the
  tile set has a mask (Cesium World Terrain); providers without one are unchanged.
- **Production smoke test** (plan §43): `pnpm smoke:prod <url>` checks a deployed build — health
  and the tagged version, no fixture mode, the security headers and a CSP without `unsafe-eval`,
  capabilities without a dev banner or dev sign-in, manifest and an uncacheable service worker,
  the privacy page's placeholders, and that the profile route answers 401 and an unsigned Stripe
  event 400 — as pure, unit-tested checks (`evaluateSmoke` in `@lightmap/observability`);
  `release.yml` runs it after the deploy in place of the bare health curl.
- **Sky from physics (Phase 4)**: the clear-sky colours of the overlay gradient, the preview chrome
  and the planning card now come from a single-scattering Rayleigh + Mie model
  (`skyRadiance()`, `clearSkyStops()` in `@lightmap/renderer`): a blue overhead and a pale
  horizon that pale further with the scenario's haze and a lower Sun, and a sunrise/sunset glow
  whose hue follows the Sun's elevation and the haze. Blended into the hand-set colours (60 % by
  day, none near the horizon; twilight and night unchanged) since single scattering has no
  multiple scattering or ozone. Cesium's own dome is unchanged by default; behind the new
  `physicalSkyDome` feature flag its aerosol density follows the scenario's haze through the
  model's Mie coefficient, with a `storm-physical-dome` shot in the renderer smoke harness to
  judge it. Eight tests pin the physics (Rayleigh ordering, horizon paling, sunset reddening,
  haze, Earth shadow, symmetry, exposure anchor).
- **Dev perf panel** completes plan §27: draw commands (Cesium's per-frame command list) and the
  WebGPU API flag beside FPS, terrain tiles, WebGL2/GPU and the weather-cache state.
- **Preferences (plan §17)**: an "Account & plan" section — signed in or not — for distances
  (metric or imperial: the depth-of-field figures and focus box, the planning card, weather
  visibility and wind), which zone times are shown in (the place's own or the device's; switching
  keeps the selected instant and re-reads it, and saved viewpoints always carry the place's zone)
  and the lens a new place starts with (8–600 mm full-frame equivalent, saved when the box is
  left). The scene now carries `timeZone` (the zone its clock and day events are read in) apart
  from `location.timeZone` (the place's own, still used for climatology, the finder's place
  data, the card subtitle and saved viewpoints); the weather query is keyed by zone. Kept on the device,
  saved to the profile when signed in (`GET/PATCH /api/account/profile`, `profilesRepo`), the
  profile winning when it loads unless it has never been changed, in which case the device's
  choices are adopted into the account; a failed save rolls back and says so. `formatDistance()`,
  `formatHeight()`, `defaultCamera(eye, heading, lensMm)` in `@lightmap/scene`.
- **Product analytics (plan §31)**: the eight named events are now actually recorded —
  `location_selected` (how the place was chosen, whole-degree buckets), `timeline_scrubbed`
  (steps per rest), `weather_scenario_changed`, `preview_expanded`, `project_created`,
  `viewpoint_saved` (variant or not), `upgrade_started` (interval) from the client as same-origin
  beacons to `POST /api/analytics`, and `subscription_started` (plan key) from the Stripe webhook.
  The route keeps only each event's own, typed properties (anything else is dropped, buckets
  re-rounded), refuses unknown events and bodies over 4 KB, is burst-limited and carries no
  identity; Do-Not-Track and Global Privacy Control stop events on both sides. `ANALYTICS_SINK` (`none` in production by default, `log` in development) picks the
  sink and `capabilities.analytics` tells the client whether to send at all. PRIVACY.md §4 and the
  public privacy page say what each event carries.
- **Depth of field (Phase 6)**: "Your camera" gains an aperture and focus-distance pair that
  reports the near and far limits of sharpness for the real lens on the chosen sensor, whether
  the sun, moon and horizon fall inside the zone, and a "Focus at hyperfocal" button.
  `depthOfField()`, `hyperfocalDistanceM()`, `circleOfConfusionMm()` (diagonal ÷ 1500) in
  `@lightmap/scene`, checked against the textbook 50 mm f/8 case; sensor presets now carry their
  height. The preview is never blurred.
- **Horizon levelling (Phase 6)**: "Level & thirds guide" in the viewpoint view — a
  rule-of-thirds grid, the true-level line and the modelled terrain skyline (dotted, "terrain
  only"), with buttons that pitch the camera so level sits on the low third, the centre or the
  high third. `levelLineY()`, `pitchForHorizonAt()`, `skylinePath()` in `@lightmap/scene`.
- **Security**: Vitest 4.1.11+ (GHSA-82fw-gwwq-j7x9, moderate: path traversal via
  `@vitest/mocker` redirect mocks — dev-only, closed anyway); nodemailer 10.0.9+ across the workspace (GHSA-v53p-9fqp-m79j and
  GHSA-prgh-xp8r-p3m5, high: address-parser denial of service; plus three moderate advisories).
  Only `createTransport`/`sendMail` are used, unchanged across the major.
- **Moon accuracy 0.3° → 0.02°**: the lunar position now follows Meeus ch. 47 (abbreviated
  ELP-2000/82: 60 terms in longitude/distance, 60 in latitude, planetary and flattening terms,
  nutation, true obliquity), reproducing Meeus's worked example 47.a to the unit of the published
  sums. Rise/set ±1 min, illumination ±1 %; the accuracy note in the UI says so. Moonrise and
  moonset were ~4 minutes late: the rise threshold applied Meeus's _geocentric_ h0 to an altitude
  that already had parallax removed; it is now −(semidiameter + 34′ refraction) on the
  topocentric altitude, checked by a self-consistency test, and `isAboveHorizon` uses the same
  rule. Parallax is now applied exactly (Meeus ch. 40 topocentric equatorial correction) instead
  of the first-order h − π·cos h, which left up to 0.01° in altitude; hour angles use apparent
  sidereal time (equation of the equinoxes, ≤ 0.005°) for the Sun and Moon alike.
- **Planning card**: with the camera tools, the card carries a "Depth of field" row — the real
  lens on the chosen sensor, aperture, focus distance and the sharp range (hyperfocal when the
  far limit is finite).
- **Install app** in the account menu (Phase 9 "native install"): Chromium's deferred install
  prompt, the Add-to-Home-Screen hint on iOS Safari, hidden when already installed.
- **Roll-aware field view**: the phone's roll about its line of sight (from the orientation
  reading, smoothed) tilts the sun marker, the sun path, the level line and the ridge the other
  way, so a hand-held phone that is not quite level still marks the picture correctly.
  `frameCoordinates()`/`directionFromFrame()` gained an optional roll (round-trip tested),
  `levelLineSegment()`, `cameraPointingFromOrientation().rollDeg`.
- **Light finder: "On the ridge"** — a new target mode with a sampled terrain horizon: type a
  bearing (defaults to the camera heading) and the finder searches for the moments the sun's (or
  moon's) upper limb touches the modelled skyline there — the plan's "every date the sun sets
  behind that ridge". `ridgeContactElevationDeg()` in `@lightmap/scene`, the inverse of
  `aboveTerrain`, tested to ±0.01°.
- **Field view (Phase 9 AR sun alignment)**: on a phone in viewpoint mode, "Field view (camera)"
  shows the live back camera with the planned sun and moon marked, the sun's path for the day,
  true level, the modelled ridge and an edge arrow with the turn needed when the sun is out of
  frame; heading/pitch follow the phone, "Now" jumps to the present, the feed's field of view is
  adjustable. Camera frames never leave the device (`Permissions-Policy: camera=(self)`,
  PRIVACY.md §11). `sunPathInFrame()`, `edgeIndicator()`, `defaultCameraFeedFovDeg()` tested.
- **Point with phone (Phase 9 field mode)**: in viewpoint mode on a phone, the camera follows
  the device's back camera — compass heading and tilt from DeviceOrientation, screen-rotation
  independent, smoothed and throttled; iOS permission prompt handled; manual input takes over;
  devices without a compass are told so. `cameraPointingFromOrientation()` and `blendHeading()`
  in `@lightmap/scene` (tested against hand-computed poses); `normalizeHeading()` can no longer
  return 360 for a tiny negative input.
- **Legal drafts**: `/legal/privacy` and `/legal/terms` are now full drafts derived from
  `docs/PRIVACY.md` and the product spec (what stays on the device, what we store, recipients,
  retention, deletion, offline cache; accuracy statements, plans and cancellation, past-due grace,
  acceptable use, attribution), still flagged for counsel review with bracketed items to fill.
- **Device conditions (Phase 4)**: the quality governor's ceiling now follows the battery and
  Save-Data while the app runs — draining below 50 % caps at Balanced, below 20 % at Battery;
  Save-Data / `prefers-reduced-data` caps at Balanced; charging lifts the cap. Conditions never
  switch shadows off. `conditionsCeiling()`, `effectiveCeiling()`, `watchDeviceConditions()`.
- **Offline project cache (Phase 9)**: in production a service worker (`public/sw.js`) keeps the
  planner page, its chunks and the signed-in user's own projects, viewpoints, session and
  entitlements, so saved plans open in the field with no signal — astronomy, the light finder,
  DOF and the level guide work offline; weather falls back to scenarios. Third-party
  map/terrain/weather data is never cached; live responses are handed over before they are
  stored; user data is dropped on sign-out, account deletion, a signed-out session or a change of
  user, and project/viewpoint writes drop the cached project list. The network banner shows the
  age of cached data and clears on the next live response. Unit-tested in a VM sandbox
  (`sw.test.ts`).

## v0.1.0 — 2026-09-25

- **Terrain horizon** ("when does the sun clear the ridge?"): the land horizon around the pin is
  sampled through the renderer from the DEM (curvature + refraction; `horizon.ts`, tested on a
  synthetic ridge); the scene knows whether the sun/moon is behind terrain and the day's first and
  last light over it. "Sun behind terrain" badge, `▲/▽ Ridge` timeline markers when they differ
  from sunrise/sunset, rows in Sun & moon details, finder results tagged/hideable, caveat
  everywhere (trees/buildings not modelled). `SceneHost.sampleGroundHeights`, store
  `horizonProfile`, `useTerrainHorizon`.
- **Shadow quality (Phase 4)**: low-Sun shadows are no longer faded away by the renderer
  (Cesium's `fadingEnabled` off — whether shadows exist is decided by the Sun and the cloud, not
  by taste); shadow reach follows the camera (20 km at eye level, 3× the orbit range in map view).
  The smoke harness now renders a tower and **measures** its shadow's direction, length and
  darkness from the frame.
- **Climatology by hour of day**: "Typical for this month" now includes 24 hour-of-day bars
  (mean cloud, clear share, wet share; night dimmed; selected hour ringed; table for assistive
  tech) and a pattern line naming the clearest and cloudiest three-hour stretch when the month
  has one (`byHour`, `daylightPattern()`, tested). Cache key bumped to `v2`.
- **Mobile pass**: fields are 16 px on touch devices (no iOS focus zoom); the sheet and top bar
  clear the safe-area insets; the sheet handle takes a swipe; a collapsed sheet shows a glance
  line (time · phase · sun bearing · weather basis) that opens it; taps in the viewpoint view
  tolerate 10 px of finger wobble; larger touch targets for tabs, markers and the chip.
- **Layered clouds (Phase 4)**: the sky is three decks — low, mid, high — with cover from the
  forecast's own `cloud_cover_low/mid/high` (`AtmosphereParameters.cloudLayers`,
  `layersObserved`) or the scenario's split, each lit by the true Sun elevation (a 1 km base is
  in shadow at sunset; cirrus at 10 km stays lit, and pink, until ≈ −3.5°). A thin high veil keeps
  55–85 % of the direct beam. Smoke harness gained `cirrus-sunset` / `stratus-sunset`; new
  contact sheet.
- **"This light" chip** under the timeline: how long the sun keeps returning to its current
  position and when it comes back after that ("Like this until … · Back … 17:47"); one click
  jumps there. `summarizeRecurrence()` in `@lightmap/astronomy` (tested at equinox/solstice);
  Free plans see the answer inside their window and an honest "Beyond your date window · Pro".
- **Error monitoring**: `SENTRY_DSN` enables a dependency-free Sentry-envelope reporter (release,
  environment, redacted context; tests); API 500s and webhook failures are reported; health
  reports the real package version. `docs/RUNBOOKS.md` covers provider outage, Stripe webhook
  failures, database loss/restore, bad release, abuse, data-subject requests, licence issues.
- Light finder: the target ring can be dragged or nudged with the arrow keys.
- `pnpm usage:report`: daily per-resource totals from `usage_counters` (aggregates only).
- **Sensor formats** (Pro camera tools): pick your sensor and type your lens's focal length.
- Light finder searches run in a Web Worker (main-thread fallback).
- **Shot variants**: save the same viewpoint at other times/scenarios under one card
  (migration `0003_viewpoint_variants`, `parentViewpointId`, cascade, one level, counted toward
  limits); integration test.
- **Light finder: point in the view** — click where the sun/moon should be in the viewpoint
  preview; the finder searches for that direction (`directionFromFrame`, tested); a ring marks it.
- **Light finder (reverse planning, plan §26)**: `findDirectionMatches()` finds every instant in a
  date range when the sun or moon sits at a target azimuth (and optionally elevation) from a
  viewpoint; panel in the planner with frame-centre / current / manual targets, moon illumination
  floor, tolerances, and jump-to-instant results. New `reverse_planning` entitlement (Free: inside
  the date window; Pro: any range).
- **Planning-card export** (Phase 4 "preview export"): a PNG of the current frame with the solar
  facts, weather mode, source label, confidence and attribution, rendered in the browser; Pro via
  `export_preview`, paywall reason for Free.
- **Hour by hour (Pro `forecast_detail`)**: per-hour direct-light bars and bright windows for
  the fetched day, table alternative, nothing shown on scenario days (`hourlyOutlook`, tested).
- **PWA baseline**: installable manifest (id/scope/categories, 192/512 + maskable PNG icons,
  `display_override`), apple-touch-icon, `?source=pwa` start URL.
- **Renderer (Phase 4)**: blue hour is blue — twilight dome clamp at −0.6° with a civil-twilight
  restoration term that keeps the sunset glow warm; low-Sun zenith lift; aerial perspective toward
  the horizon by depth and Sun elevation (`horizonHaze` uniform); textured overcast decks. Verified
  in the headless smoke harness (new contact sheet in `docs/media`).
- **Climatology (Phase 7)**: "Typical for this month" — ten-year ERA5 shares of the five scenario
  classes in daylight hours (Open-Meteo archive adapter + fixture, pure summariser with tests, API
  route with 30-day cache and per-plan budget, `climatology` entitlement), tap-to-compare, never a
  forecast.
- **Accessibility pass (plan §28)**: skip link and DOM order, roving-tabindex radio groups
  (`RadioGroup`/`useRovingRadio` in `@lightmap/ui`), combobox `aria-activedescendant`, permanent
  status regions, focus management on panel swaps/deletes/preview collapse, `inert` collapsed sheet,
  confidence notes as visible text, reduced-motion camera jumps, contrast fixes, timeline event
  keys. Sign-in failures are now reported instead of shown as success.
- Daily retention workflow (`retention.yml`).
- Build verified against the installed dependency set: typecheck, type-aware lint (zero findings),
  licence gate (482 packages, two recorded exceptions), notices regenerated; db scripts read `.env`;
  Docker Compose for local PostGIS; release workflow tolerates a missing production host.
- Initial build of LightMap v0.1: monorepo, WorldView reuse audit, astronomy (USNO-validated),
  weather (Open-Meteo + scenarios + horizon), SceneState + confidence, Cesium renderer with
  grade shader and quality governor, web app (map shell, timeline, scenarios, preview, camera,
  projects, account), API, database + migrations, Stripe webhooks, entitlements, Auth.js,
  observability, CI/security/release workflows, documentation set and ADRs.
