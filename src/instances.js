const stats = require('./stats');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TTL = 3600e3, BAD_MS = 300e3;
const list = (k) => (process.env[k] || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);

let cache = { at: 0, piped: [], inv: [] };
const bad = new Map();

const getJson = async (url, ms = 6000) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'User-Agent': UA } });
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  return r.json();
};

// Instances : variables PIPED_INSTANCES / INVIDIOUS_INSTANCES (séparées par des virgules), sinon découverte auto.
async function discover() {
  if (Date.now() - cache.at < TTL && (cache.piped.length || cache.inv.length)) return cache;
  const piped = list('PIPED_INSTANCES'), inv = list('INVIDIOUS_INSTANCES');
  if (!piped.length) {
    try { piped.push(...(await getJson('https://piped-instances.kavin.rocks/')).map((i) => i.api_url).filter(Boolean).map((u) => u.replace(/\/$/, ''))); }
    catch (e) { stats.error('Découverte Piped : ' + e.message); }
  }
  if (!inv.length) {
    try { inv.push(...(await getJson('https://api.invidious.io/instances.json?sort_by=health')).filter(([, m]) => m.api && m.type === 'https').map(([, m]) => m.uri.replace(/\/$/, ''))); }
    catch (e) { stats.error('Découverte Invidious : ' + e.message); }
  }
  cache = { at: Date.now(), piped: shuffle(piped).slice(0, 15), inv: shuffle(inv).slice(0, 15) };
  return cache;
}

// Lance fn(instance) en parallèle sur 3 instances saines, renvoie le premier succès.
async function first(kind, fn) {
  const c = await discover();
  const pool = (kind === 'piped' ? c.piped : c.inv).filter((b) => !(bad.get(b) > Date.now())).slice(0, 3);
  if (!pool.length) throw new Error(`Aucune instance ${kind} disponible`);
  try {
    return await Promise.any(pool.map(async (b) => {
      try { return await fn(b); }
      catch (e) { if (!e.status || e.status >= 500 || [403, 429].includes(e.status)) bad.set(b, Date.now() + BAD_MS); throw e; }
    }));
  } catch (e) { throw e.errors?.[0] || e; }
}

async function status() {
  const c = await discover();
  const f = (a) => a.map((url) => ({ url, ok: !(bad.get(url) > Date.now()) }));
  return { piped: f(c.piped), invidious: f(c.inv) };
}

module.exports = { getJson, first, status };
