# Manufacturing Tycoon

A free idle/tycoon business simulation. Start with $5,000 in a garage workshop and build a
manufacturing empire worth $1 billion.

## Project structure

```
index.html        The whole game (self-contained: HTML + CSS + JS, no build step)
flight/index.html Free Flight — a second, standalone game (see below)
api/scores.js     GET  /api/scores  → returns the top 100 leaderboard entries
api/submit.js     POST /api/submit  → records a score (best run per player kept)
package.json      "type": "module" so the api/*.js ES-module functions run on Vercel
robots.txt        SEO
```

## Global leaderboard

The game talks to two serverless endpoints:

- `GET  /api/scores`  — read the board  (configured as `LB_API` in index.html)
- `POST /api/submit`  — write a score   (configured as `LB_SUBMIT` in index.html)

Both endpoints work the moment you deploy to Vercel. **Without a data store they use
in-memory storage**, which is per-instance and resets — fine for a demo, not a real global
board. For persistence, connect a Redis (Vercel KV / Upstash) store:

1. Vercel dashboard → your project → **Storage** → **Create Database** → **Redis (Upstash)**
2. **Connect** it to this project
3. **Redeploy**

That injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically, and both functions
switch to persistent, shared storage — no code change needed. If those env vars are absent,
the game still works and falls back to a local (this-device) board.

## Deploy

1. Push this folder to a GitHub repo.
2. In Vercel: **Add New… → Project → Import** the repo. No framework, no build command,
   output directory is the repo root. Deploy.
3. (Optional but recommended) add the Redis store above for a persistent global board.

## Free Flight (`/flight`)

A second, completely separate game living at `/flight` — nothing it does touches
Manufacturing Tycoon. Open `flight/index.html` directly or deploy and visit
`https://<your-domain>/flight/`.

An arcade flight sim over an island ocean: chase-cam biplane, HUD (time, speed,
altitude, compass/radar), throttle slider, glowing rings to fly through, and a
soft-fail loop — touch the water and you're popped back into the air.

**Two control schemes, chosen on the start screen and switchable while paused:**

- **Tilt** — lean the phone. Uses `deviceorientation`, remapped through
  `screen.orientation.angle` so it works in portrait or landscape. iOS 13+ asks
  for motion permission on the first tap; if it's declined the game falls back to
  arrows on its own. **CENTRE TILT** re-zeroes to however you're holding it, and
  the pause menu has sensitivity plus invert switches for both axes.
- **Arrows** — on-screen D-pad: left/right bank, up/down move the nose.

Desktop: arrow keys steer, `W`/`S` throttle, `C` camera, `P` pause.

Flight assist (on by default) auto-levels the wings, holds a minimum speed and
lifts the nose near the water, so it flies itself unless you fight it. Turn it
off in the pause menu for a twitchier aeroplane.

No libraries, no assets, no build step — the 3D is a small software renderer
drawing projected polygons onto a 2D canvas, so it's one file and loads instantly.
