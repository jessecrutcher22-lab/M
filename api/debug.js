// TEMPORARY diagnostic — returns only the NAMES of storage-related env vars
// (never their secret values). Delete after verifying the leaderboard store.
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const keys = Object.keys(process.env)
    .filter(k => /KV|REDIS|UPSTASH|STORAGE|POSTGRES|DATABASE/i.test(k))
    .sort();
  res.status(200).json({ matchedEnvKeys: keys, count: keys.length });
}
