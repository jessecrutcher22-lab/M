// GET /api/scores — top 100 leaderboard entries
import Redis from 'ioredis';

const store = globalThis.__mfgScores || (globalThis.__mfgScores = new Map());

// Reuse one Redis connection across warm invocations.
function getRedis() {
  const url = process.env.REDIS_URL || process.env.KV_URL || process.env.UPSTASH_REDIS_URL;
  if (!url) return null;
  if (!globalThis.__redis) {
    globalThis.__redis = new Redis(url, { maxRetriesPerRequest: 3, enableReadyCheck: false });
    globalThis.__redis.on('error', () => {}); // don't crash the function on transient errors
  }
  return globalThis.__redis;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=60');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const redis = getRedis();
    let rows = [];
    if (redis) {
      const members = await redis.zrevrange('mfg:scores', 0, 99);
      rows = members.map(m => { try { return JSON.parse(m); } catch (e) { return null; } }).filter(Boolean);
    } else {
      rows = [...store.values()].sort((a, b) => b.net_worth - a.net_worth).slice(0, 100);
    }
    return res.status(200).json(rows);
  } catch (err) {
    return res.status(200).json([]);
  }
}
