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
