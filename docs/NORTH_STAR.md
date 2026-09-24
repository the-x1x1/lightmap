# North Star

## The thesis

Existing planning tools tell a photographer *where the sun will be*. LightMap answers the more
useful question:

> **"What will this place actually look like under this light?"**

A photographer opens a map of the world, navigates to any location, sets a date and a time,
chooses or inspects the weather, and sees a grounded visual representation of how the light should
behave there. They scrub the clock forward and backward and watch the scene change. They compare
clear, partly cloudy, overcast and storm conditions, golden hour, blue hour and night. They save
the viewpoint to a shoot, and come back as the shoot approaches to watch a scenario turn into a
forecast (plan §1).

LightMap is a *visual time machine for natural light*. The product's trust model matters more than
visual flash: a less pretty image with the correct sun direction beats a beautiful hallucination
(plan §3).

## What LightMap is

- A worldwide **planning instrument** for photographers and filmmakers (plan §2).
- One primary workflow: **Location → Date → Time → Conditions → Preview → Save**.
- Interactive: the timeline responds at interactive speed because astronomy runs client-side and
  weather is fetched once per place-day, then interpolated locally.
- Honest: every preview carries a source label (Real Reference / Simulated Lighting / Estimated
  Preview) and a confidence panel that says what is known and what is estimated (plan §11).
- Commercial from day one: authentication, entitlements, billing states, rate limits, data-source
  licensing, privacy and cost control are part of the foundation, not bolt-ons.

## What LightMap is not

- **Not a photo-sharing or upload product.** There is no user-upload or community-submission system,
  no user-contributed image library, and none will be added (plan §0, §37).
- **Not a social network.** No feed, followers, likes or comments.
- **Not a discovery engine.** Search exists only to find a known place or coordinate so the user can
  plan *that* place. There is no "best sunset beaches" or "waterfalls with morning light"
  recommendation feed (plan §0, §37).
- **Not an AI image generator.** Text-to-image generation is never the scene source. The render
  pipeline is grounded in coordinates → terrain → map geometry → camera → astronomy → atmosphere →
  weather → render (plan §6). AI may later denoise, upscale or add micro-detail, but it must never
  move mountains, change horizon geometry, invent buildings, move the sun, change shadow direction
  or erase uncertainty labels (plan §25 Phase 8).
- Not a weather app, not a GIS workstation, not a map company. LightMap does not run a custom
  weather model or its own global tile infrastructure.

## Accuracy principles

LightMap separates five kinds of knowledge and never lets one masquerade as another (plan §1).

| Kind | Examples | How LightMap treats it |
|---|---|---|
| **A. Deterministic facts** | Solar azimuth and elevation, sunrise, sunset, twilight bands, moon position and phase, seasonal path, light and shadow direction | Computed locally from ephemeris algorithms validated against USNO (sun ±0.01°, moon ±0.3°). Available years ahead. Confidence: HIGH unless the input is invalid. |
| **B. Forecast conditions** | Cloud cover by layer, precipitation, visibility, humidity, fog, haze, storms | Only inside the provider's forecast horizon (7 days reliable, 8–16 days low confidence). Labelled "Forecast" or "Extended forecast — low confidence". |
| **C. Long-range scenarios** | Clear, Mostly Clear, Partly Cloudy, Overcast, Rain/Storm | Beyond the horizon the app says "Forecast unavailable this far ahead" and offers user-selectable scenarios. Climatology (Phase 7) may indicate which scenarios are typical; it is never shown as a forecast. |
| **D. Real-world visual evidence** | Licensed photographs or panoramas near the coordinate | Surfaced as **Real Reference** with attribution, capture date/time and approximate heading when known. Never implies it was captured at the requested date and time unless it was. Disabled in v0.1: no provider contract exists. |
| **E. Simulation** | Terrain + map geometry + physically grounded lighting | Used whenever real imagery is unavailable, labelled **Simulated Lighting** or **Estimated Preview** depending on how much geometry is real. |

Operating rules that follow from this:

1. **Accuracy before beauty.**
2. **Never hide uncertainty.** Weather six months out is not a forecast; the UI says so.
3. **Fast interaction.** No server render per minute of scrubbing.
4. **Low cognitive load.** Scientific detail is one tap away ("Why does it look like this?"), not on
   the main screen.
5. **No data-source lock-in.** Every external provider sits behind an interface.
6. **Do not invent precision.** When shadows cannot be rendered, show a shadow-direction arrow; do
   not fabricate a shadow map.

Decision priority when trade-offs are unavoidable: **Correct → Honest → Simple → Fast → Beautiful**,
never reversed (plan §45).

## Five-year direction

The long-term interaction (plan §44):

> A photographer opens any point on Earth, places themselves in the scene, points the camera,
> chooses a lens, and scrubs through days, months and seasons. The terrain stays fixed; the sun
> moves exactly as astronomy dictates; weather changes by forecast or explicitly labelled scenario.
> Licensed real imagery appears beside the simulation as evidence. Then they drag the desired sun
> position into the frame and ask: *"When does this happen?"*

Four directions get us there, in roughly this order:

1. **Reverse planning** (plan §26). Position the camera, drag the sun marker onto the composition,
   and get back the date and time ranges where solar azimuth/elevation match. "Show me every date
   in 2027 where the sun sets behind that ridge." The current `CameraState`, `frameCoordinates()`
   and `SolarState` model are designed so this can be built without a rewrite; it is expected to
   be a primary reason to subscribe.
2. **Real references** (Phase 5). A licensed imagery provider behind `ImageryProvider`, near-
   coordinate lookup, capture metadata, attribution, and side-by-side real vs simulated views.
   Blocked until commercial rights are documented.
3. **High-fidelity reconstruction** (Phase 8). Commercial 3D tiles, photogrammetry, Gaussian
   splats, physically based atmosphere, and *controlled* generative enhancement that cannot alter
   geometry or light direction.
4. **Native mobile** (Phase 9). Only after the PWA proves demand: native install, offline project
   cache, compass, device orientation, AR sun alignment, field mode.

At every release the question is: *does this make it faster or more trustworthy for a photographer
to know what the light will look like before arriving?* If not, it is probably not a priority.
