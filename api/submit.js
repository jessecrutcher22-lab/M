// POST /api/submit — record a score (best run per company kept)
const store = globalThis.__mfgScores || (globalThis.__mfgScores = new Map());
const hits  = globalThis.__mfgHits   || (globalThis.__mfgHits   = new Map());

const MAX_NET_WORTH = 1e13;   // reject obvious tampering
const RATE_LIMIT    = 10;     // submissions per minute per IP

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limit by IP
  const ip = (req.headers['x-forwarded-for'] || 'anon').split(',')[0].trim();
  const now = Date.now();
  const rec = hits.get(ip) || { n: 0, t: now };
  if (now - rec.t > 60000) { rec.n = 0; rec.t = now; }
  rec.n++; hits.set(ip, rec);
  if (rec.n > RATE_LIMIT) return res.status(429).json({ error: 'Slow down' });

  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    const name = String(b.name || 'Anonymous')
      .replace(/[<>&"'`]/g, '')
      .trim()
      .slice(0, 28) || 'Anonymous';

    const num = (v, cap) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return 0;
      return Math.min(Math.floor(n), cap);
    };

    const net_worth = num(b.net_worth, MAX_NET_WORTH);
    if (net_worth <= 0) return res.status(400).json({ error: 'Invalid score' });

    const entry = {
      name,
      net_worth,
      revenue:      num(b.revenue, MAX_NET_WORTH),
      months:       num(b.months, 100000),
      machines:     num(b.machines, 100000),
      acquisitions: num(b.acquisitions, 100),
      created_at:   new Date().toISOString(),
    };

    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      const auth = { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` };
      const key  = `mfg:best:${name.toLowerCase()}`;

      // Only keep a player's best run
      const prevRes = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, { headers: auth });
      const prevJson = await prevRes.json();
      if (prevJson.result) {
        try {
          const prev = JSON.parse(prevJson.result);
          if (prev.net_worth >= net_worth) {
            return res.status(200).json({ ok: true, kept: 'previous' });
          }
          await fetch(`${process.env.KV_REST_API_URL}/zrem/mfg:scores/${encodeURIComponent(prevJson.result)}`, { headers: auth });
        } catch (e) {}
      }

      const member = JSON.stringify(entry);
      await fetch(`${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(member)}`, { headers: auth });
      await fetch(`${process.env.KV_REST_API_URL}/zadd/mfg:scores/${net_worth}/${encodeURIComponent(member)}`, { headers: auth });
      // Trim to top 200
      await fetch(`${process.env.KV_REST_API_URL}/zremrangebyrank/mfg:scores/0/-201`, { headers: auth });
    } else {
      const key  = name.toLowerCase();
      const prev = store.get(key);
      if (!prev || prev.net_worth < net_worth) store.set(key, entry);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(400).json({ error: 'Bad request' });
  }
}
