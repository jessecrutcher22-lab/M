# APEX RUSH

A browser arcade racer. No build step, no downloads, no dependencies — open
`racer/index.html` in any modern browser and drive.

## Running it

**On a computer:** double-click `index.html`.

**On a phone or tablet:** serve the folder over HTTP (`npx serve racer` from
the repo root, or host it anywhere) and open it on the device. Then use
*Add to Home Screen* — it installs as a full-screen app, runs offline after
the first load, and locks to landscape.

**As a single file:** `node racer/build.cjs` bundles everything into
`racer/dist/apex-rush.html`, which is one self-contained page you can email,
drop on a USB stick, or open from anywhere.

Requires WebGL2, which every current browser has.

## The stack, and why

Everything is hand-written vanilla JavaScript against **WebGL2**, loaded as
plain `<script>` tags.

- **No library.** Three.js and friends only ship as ES modules now, which
  cannot be loaded from a `file://` page — you would need a local server or a
  CDN. A ~700-line renderer covers everything a flat-shaded low-poly racer
  needs (instanced meshes, a gradient sky, fog, two blended dynamic buffers)
  and keeps the whole thing genuinely dependency-free and offline.
- **Classic scripts, not ES modules,** for the same reason: modules are
  blocked by CORS on `file://`.
- **All geometry is procedural.** Cars, track, scenery and sky are generated
  at load time from numbers, so there is nothing to download and new tracks
  cost only a spline definition.

## Controls

| | |
|---|---|
| Steer | `←` `→` or `A` `D` |
| Throttle / brake | `↑` `↓` or `W` `S` |
| Handbrake | `Space` |
| Reset to track | `R` |
| Camera | `C` |
| Pause | `Esc` |
| Debug readout | `F1` |

**Gamepad:** left stick steers, `RT`/`LT` are throttle and brake, `A`/`X` is
the handbrake, `B` resets.

**Touch:** put a thumb down anywhere on the left half of the screen and slide
— steering is relative to where you started, so there is no wheel to find.
The pedals are bottom-right. **Auto-gas is on by default**, because holding a
throttle button and steering at the same time is miserable on a phone; turn
it off (or switch on tilt steering) from the pause screen.

## Layout

```
index.html          markup, HUD, script tags
css/style.css       HUD and menus
js/mathx.js         vector / matrix maths
js/gl.js            the WebGL2 renderer
js/geom.js          procedural geometry builders
js/tune.js          >>> every physics and feel constant lives here <<<
js/scene.js         lighting / sky / fog presets
js/input.js         keyboard + gamepad
js/car.js           the driving model
js/carmodel.js      car body geometry
js/camera.js        chase camera
js/effects.js       skid marks, tyre smoke, shadows
js/track.js         spline, resampling, checkpoints, racing line, queries
js/tracks.js        >>> the circuits — add one here and nothing else <<<
js/trackmesh.js     tarmac, kerbs, barriers, terrain from the spline
js/scenery.js       roadside props, instanced
js/race.js          laps, checkpoints, timing, standings, collisions
js/ai.js            the opponents
js/touch.js         phone and tablet controls
js/ui.js            HUD and menu screens
js/game.js          boot, game loop, game state
build.cjs           bundles it all into one file
sw.js               offline cache, so it works installed with no connection
manifest.webmanifest
```

## Tuning the driving

Everything that decides how the car feels is in **`js/tune.js`**, commented.
The knobs worth reaching for first:

| Constant | Does what |
|---|---|
| `TOP_SPEED` / `ENGINE_FORCE` | top end and acceleration, independently — aero drag is solved from the two |
| `GRIP_FRONT` / `GRIP_REAR` | how planted it is. The gap between them decides understeer vs oversteer |
| `STEER_MAX_LOW` | steering lock at low speed |
| `SPIN_DAMP` | **how settled the steering feels.** Too low and the car hunts under a steady input — bites, washes out, bites again. 2.0 loose, 3.0 planted |
| `COUNTER_ASSIST` | how much the car helps you catch a slide. 0 is raw, 4 nearly drives itself |
| `DRIFT_THROTTLE_BOOST` | power oversteer |
| `CAM.FOV_SPEED` | the single biggest "it feels fast" lever |

Reload the page after editing; there is no build step.

## Adding a track

Open `js/tracks.js` and add an entry. A layout is a list of
`[bearing°, radius, height]` samples around a loop — because every point is
placed by its angle from the centre, the closed curve is star-shaped and so
*cannot* cross itself. Gentle radius swings give fast sweepers; sharp ones
give hairpins. Everything else — tarmac, kerbs on the corners, barriers,
terrain, checkpoints, the racing line the AI uses, the map on the menu card —
is generated from those numbers.

## The cars

| | top speed | 0–100 km/h | 0–200 km/h | 60 m/s → 0 | peak lateral | 70 m corner |
|---|---|---|---|---|---|---|
| Bolt GT | 245 km/h | 3.7 s | 10.3 s | 109 m | 1.55 g | 140 km/h |
| Vypr X | 289 km/h | 4.1 s | 10.1 s | 127 m | 1.46 g | 130 km/h |
| Kite R | 209 km/h | 2.9 s | 11.6 s | 86 m | 1.64 g | 151 km/h |
| Onyx RS | 256 km/h | 2.9 s | 7.9 s | 113 m | 1.66 g | 155 km/h |

Kite R corners 21 km/h faster than Vypr X but gives away 80 km/h on the
straights — the choice is a real trade-off, not a cosmetic one. Onyx RS has
the grip on paper but the loosest rear, so it spends it sliding.

## The circuits

| | length | tightest corner | character |
|---|---|---|---|
| Azure Coast | 3.14 km | 140 m radius | fast sweepers, sea haze, sand runoff |
| Neon Mile | 2.41 km | 51 m radius | tight, angular, lit towers at midnight |
| Ridge Pass | 3.46 km | 132 m radius | 9% grades, a climb and a plunge |

## Old notes

| | top speed | 0–100 km/h | 60 m/s → 0 | peak lateral | 70 m corner |
|---|---|---|---|---|---|
| Bolt GT | 245 km/h | 3.7 s | 109 m | 1.53 g | 148 km/h |
| Vypr X | 289 km/h | 4.1 s | 127 m | 1.45 g | 140 km/h |
| Kite R | 209 km/h | 2.9 s | 86 m | 1.83 g | 166 km/h |
| Onyx RS | 256 km/h | 2.9 s | 113 m | 1.46 g | 130 km/h |
