const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sp = require('./spotify');
const st = require('./stats');
const sm = require('./stremio');
const inst = require('./instances');
const { enc, dec } = require('./crypto');

const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use((req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const base = (req) => process.env.BASE_URL?.replace(/\/$/, '') || `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`;
const page = (f) => (req, res) => res.type('html').send(fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8'));
const cookie = (req, n) => (req.headers.cookie || '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === n)?.[1];

// --- Pages ---
app.get('/', (req, res) => res.redirect('/configure'));
app.get(['/configure', '/:config/configure'], page('configure.html'));
app.get('/dashboard', page('dashboard.html'));
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/logo.svg', (req, res) => res.type('image/svg+xml').send(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#0b0d10"/>' +
  '<g fill="none" stroke="#3ddc97" stroke-width="7" stroke-linecap="round"><path d="M24 42q26-9 52 3"/><path d="M29 56q21-7 42 2"/><path d="M34 69q16-5 32 1"/></g></svg>'));

// --- OAuth Spotify ---
app.get('/auth/login', (req, res) => {
  if (!process.env.SPOTIFY_CLIENT_ID) return res.redirect('/configure?error=' + encodeURIComponent('SPOTIFY_CLIENT_ID manquant côté serveur.'));
  const state = crypto.randomBytes(16).toString('hex');
  res.append('Set-Cookie', `spotio_state=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax`);
  res.redirect(sp.authUrl(state, base(req) + '/auth/callback'));
});
app.get('/auth/callback', async (req, res) => {
  try {
    if (req.query.error) throw new Error('Connexion refusée : ' + req.query.error);
    if (!req.query.state || req.query.state !== cookie(req, 'spotio_state')) throw new Error('État OAuth invalide, réessaie.');
    const j = await sp.exchange(req.query.code, base(req) + '/auth/callback');
    const me = await (await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: 'Bearer ' + j.access_token } })).json().catch(() => ({}));
    res.redirect(`/configure?token=${enc(j.refresh_token)}&user=${encodeURIComponent(me.display_name || me.id || '')}`);
  } catch (e) {
    st.error('OAuth : ' + e.message);
    res.redirect('/configure?error=' + encodeURIComponent(e.message));
  }
});

// --- Dashboard (API admin) ---
function admin(req, res, next) {
  const k = process.env.ADMIN_KEY;
  if (!k) return res.status(403).json({ error: 'ADMIN_KEY non défini sur le serveur.' });
  const a = Buffer.from(String(req.get('x-admin-key') || '')), b = Buffer.from(k);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Clé invalide.' });
  next();
}
app.get('/api/admin/stats', admin, async (req, res) => res.json({ ...st.snapshot(), instances: await inst.status().catch(() => ({ piped: [], invidious: [] })) }));
app.post('/api/admin/override', admin, (req, res) => {
  const { trackId, video } = req.body || {};
  if (!/^[\w]{10,30}$/.test(trackId || '')) return res.status(400).json({ error: 'trackId invalide.' });
  const id = video ? (String(video).match(/([\w-]{11})(?:[&?#].*)?$/) || [])[1] : null;
  if (video && !id) return res.status(400).json({ error: 'Lien YouTube invalide.' });
  st.setOverride(trackId, id);
  res.json({ ok: true });
});
app.delete('/api/admin/cache', admin, (req, res) => { st.clearCache(req.query.track); res.json({ ok: true }); });

// --- Addon Stremio ---
function cfg(req, res, next) {
  try {
    const j = JSON.parse(Buffer.from(req.params.config, 'base64url').toString());
    req.cfg = {
      refresh: dec(j.t),
      cats: Array.isArray(j.o?.cats) ? j.o.cats : sm.DEFAULT_CATS,
      pref: j.o?.pref === 'video' ? 'video' : 'audio',
      direct: j.o?.direct !== false,
      country: /^[A-Z]{2}$/.test(j.o?.country) ? j.o.country : 'FR',
    };
    next();
  } catch { res.status(400).json({ error: 'Configuration invalide : reconfigure l’addon.' }); }
}
const safe = (kind, empty, fn) => async (req, res) => {
  st.count(kind);
  try { res.set('Cache-Control', 'max-age=120'); res.json(await fn(req)); }
  catch (e) { st.error(`${kind} : ${e.message}`); res.json(empty); }
};

app.get('/manifest.json', (req, res) => { st.count('manifest'); res.json(sm.manifest({ cats: [] }, base(req), true)); });
app.get('/:config/manifest.json', cfg, (req, res) => { st.count('manifest'); res.json(sm.manifest(req.cfg, base(req))); });
app.get('/:config/catalog/:type/:id/:extra?.json', cfg,
  safe('catalog', { metas: [] }, async (req) => ({ metas: await sm.catalog(req.cfg, req.params.id, Object.fromEntries(new URLSearchParams(req.params.extra || ''))) })));
app.get('/:config/meta/:type/:id.json', cfg,
  safe('meta', { meta: null }, async (req) => ({ meta: await sm.meta(req.cfg, req.params.id) })));
app.get('/:config/stream/:type/:id.json', cfg,
  safe('stream', { streams: [] }, async (req) => ({ streams: await sm.stream(req.cfg, req.params.id) })));

module.exports = app;
