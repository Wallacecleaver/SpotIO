const fs = require('fs');
const path = require('path');

const DIR = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp/spotio' : path.join(process.cwd(), 'data'));
const FILE = path.join(DIR, 'db.json');
let db = { cache: {}, overrides: {}, counters: {}, errors: [], since: Date.now() };
try { db = { ...db, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}

let timer;
const save = () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(db)); } catch {}
  }, 2000);
  timer.unref?.();
};

exports.count = (k) => { db.counters[k] = (db.counters[k] || 0) + 1; save(); };
exports.error = (msg) => { db.errors.unshift({ at: Date.now(), msg: String(msg).slice(0, 300) }); db.errors.length = Math.min(db.errors.length, 50); save(); };

exports.cacheGet = (k) => db.cache[k];
exports.cacheSet = (k, v) => {
  db.cache[k] = v;
  const keys = Object.keys(db.cache);
  if (keys.length > 5000) keys.sort((a, b) => db.cache[a].at - db.cache[b].at).slice(0, 500).forEach((x) => delete db.cache[x]);
  save();
};
exports.clearCache = (trackId) => {
  for (const k of Object.keys(db.cache)) if (!trackId || k.startsWith(trackId + ':')) delete db.cache[k];
  save();
};

exports.getOverride = (id) => db.overrides[id];
exports.setOverride = (id, video) => { if (video) db.overrides[id] = video; else delete db.overrides[id]; exports.clearCache(id); save(); };

exports.snapshot = () => ({
  since: db.since,
  uptime: Math.round(process.uptime()),
  counters: db.counters,
  cacheSize: Object.keys(db.cache).length,
  overrides: db.overrides,
  matches: Object.entries(db.cache).map(([key, v]) => ({ key, ...v })).sort((a, b) => b.at - a.at).slice(0, 100),
  errors: db.errors.slice(0, 30),
});
