// GET /api/scores — top 100 leaderboard entries
const store = globalThis.__mfgScores || (globalThis.__mfgScores = new Map());

// Accept either the Vercel KV or the Upstash-for-Redis env var names.
const KV_URL   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=60');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let rows = [];
    if (KV_URL && KV_TOKEN) {
      const r = await fetch(
        `${KV_URL}/zrange/mfg:scores/0/99/REV/WITHSCORES`,
        { headers: { Authorization: `Bearer ${KV_TOKEN}` } }
      );
      const j = await r.json();
      const arr = j.result || [];
      for (let i = 0; i < arr.length; i += 2) {
        try { rows.push(JSON.parse(arr[i])); } catch (e) {}
      }
    } else {
      rows = [...store.values()].sort((a, b) => b.net_worth - a.net_worth).slice(0, 100);
    }
    return res.status(200).json(rows);
  } catch (err) {
    return res.status(200).json([]);
  }
}
