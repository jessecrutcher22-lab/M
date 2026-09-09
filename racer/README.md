# APEX RUSH

A browser arcade racer. No build step, no downloads, no dependencies — open
`racer/index.html` in any modern browser and drive.

## Running it

Double-click `index.html`. That's it. (It also works served over HTTP if you
prefer: `npx serve racer` from the repo root.)

Requires WebGL2, which every current desktop browser has.

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
| Debug readout | `F1` |

Gamepad: left stick steers, `RT`/`LT` are throttle and brake, `A`/`X` is the
handbrake, `B` resets.

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
js/ui.js            HUD and menu screens
js/game.js          boot, game loop, game state
```

## Tuning the driving

Everything that decides how the car feels is in **`js/tune.js`**, commented.
The knobs worth reaching for first:

| Constant | Does what |
|---|---|
| `TOP_SPEED` / `ENGINE_FORCE` | top end and acceleration, independently — aero drag is solved from the two |
| `GRIP_FRONT` / `GRIP_REAR` | how planted it is. The gap between them decides understeer vs oversteer |
| `STEER_MAX_LOW` | steering lock at low speed |
| `COUNTER_ASSIST` | how much the car helps you catch a slide. 0 is raw, 4 nearly drives itself |
| `DRIFT_THROTTLE_BOOST` | power oversteer |
| `CAM.FOV_SPEED` | the single biggest "it feels fast" lever |

Reload the page after editing; there is no build step.

## Where it's up to

Built in the order the brief asked for. Step 1 (scaffold + car on a flat
plane) is in: the physics playground has a tarmac strip with 100 m boards for
braking tests, a slalom, and a 55 m cone circle. Press `1`–`4` to swap
between the four cars and feel the difference.

Measured behaviour of the four cars:

| | top speed | 0–100 km/h | 60 m/s → 0 | peak lateral | 70 m corner |
|---|---|---|---|---|---|
| Bolt GT | 245 km/h | 3.7 s | 109 m | 1.53 g | 148 km/h |
| Vypr X | 289 km/h | 4.1 s | 127 m | 1.45 g | 140 km/h |
| Kite R | 209 km/h | 2.9 s | 86 m | 1.83 g | 166 km/h |
| Onyx RS | 256 km/h | 2.9 s | 113 m | 1.46 g | 130 km/h |
