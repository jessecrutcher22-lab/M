# Manufacturing Tycoon

A free idle/tycoon business simulation. Start with $5,000 in a garage workshop and build a
manufacturing empire worth $1 billion.

## Project structure

```
index.html        The whole game (self-contained: HTML + CSS + JS, no build step)
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

## OSG Sideline (side project)

`sideline/index.html` is a standalone sideline scoring app for a OneSchool Global
Inter-Campus Cup: 31 Australian campuses in 6 conferences, round-robin fixtures across
Rugby, Soccer and Basketball, live scorer pad, auto ladders and a campus directory.
Served at `/sideline/` on the same Vercel deploy. Scores save to the device's localStorage there
(the published claude.ai version syncs scores live for everyone).

`sideline/simulator.html` is the OSG Cup Simulator, a multi-season league sim for Rugby, Soccer and
Basketball. Sections in the script: `sports.js` (one settings object per sport), `rng.js` (seeded
Mulberry32, same seed = same league), fixtures (circle-method round robin, NRL-style top-four finals,
knockout brackets with byes, seeded group draw), `engine.js` (`simulateMatch`: attack v defence
expected scoring, Poisson or normal roll, weighted scorers, injuries and suspensions), tables
(points or win %, configurable tiebreakers incl. head to head, rugby bonus points), milestones/news,
season rollover (archive, rating evolution, Year 12 graduation, Year 7 intake, golden generations)
and save export/import. Saves to localStorage. Served at `/sideline/simulator.html`.
