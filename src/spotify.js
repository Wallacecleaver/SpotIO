const crypto = require('crypto');

const API = 'https://api.spotify.com/v1';
const ACC = 'https://accounts.spotify.com';
const SCOPES = [
  'user-library-read', 'playlist-read-private', 'playlist-read-collaborative',
  'user-top-read', 'user-read-recently-played',
].join(' ');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const basic = () => 'Basic ' + Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');

exports.authUrl = (state, redirect) =>
  `${ACC}/authorize?` + new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID, response_type: 'code', redirect_uri: redirect, scope: SCOPES, state,
  });

async function tokenReq(body) {
  const r = await fetch(`${ACC}/api/token`, {
    method: 'POST',
    headers: { Authorization: basic(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.error || 'Erreur OAuth Spotify');
  return j;
}
exports.exchange = (code, redirect) => tokenReq({ grant_type: 'authorization_code', code, redirect_uri: redirect });

const tokens = new Map();
async function accessToken(refresh) {
  const c = tokens.get(refresh);
  if (c && c.exp > Date.now() + 30000) return c.t;
  const j = await tokenReq({ grant_type: 'refresh_token', refresh_token: refresh });
  tokens.set(refresh, { t: j.access_token, exp: Date.now() + j.expires_in * 1000 });
  return j.access_token;
}
exports.accessToken = accessToken;

const cache = new Map();
exports.api = async (refresh, path, params = {}, ttl = 60) => {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const ck = crypto.createHash('md5').update(refresh + url).digest('hex');
  const hit = cache.get(ck);
  if (hit && hit.exp > Date.now()) return hit.v;

  const go = async () => fetch(url, { headers: { Authorization: 'Bearer ' + (await accessToken(refresh)) } });
  let r = await go();
  if (r.status === 429) { await sleep(Math.min(+r.headers.get('retry-after') || 1, 5) * 1000); r = await go(); }
  if (!r.ok) { const e = new Error(`Spotify ${r.status} ${path}`); e.status = r.status; throw e; }
  const v = await r.json();
  if (cache.size > 2000) cache.clear();
  cache.set(ck, { v, exp: Date.now() + ttl * 1000 });
  return v;
};

const cover = (imgs) => imgs?.[0]?.url;
exports.cover = cover;
exports.simple = (t) => ({
  id: t.id, name: t.name,
  artists: (t.artists || []).map((a) => a.name),
  dur: Math.round((t.duration_ms || 0) / 1000),
  cover: cover(t.album?.images),
  album: t.album?.name || '',
  year: (t.album?.release_date || '').slice(0, 4),
});

const MAX_TRACKS = 300;
exports.playlistTracks = async (R, id) => {
  const out = [];
  for (let offset = 0; offset < MAX_TRACKS; offset += 100) {
    const p = { limit: 100, offset };
    let j;
    try { j = await exports.api(R, `/playlists/${id}/tracks`, p); }
    catch (e) { if (![403, 404].includes(e.status)) throw e; j = await exports.api(R, `/playlists/${id}/items`, p); }
    for (const i of j.items) { const t = i.track || i.item; if (t?.id && t.type !== 'episode' && !t.is_local) out.push(t); }
    if (!j.next) break;
  }
  return out;
};
exports.albumTracks = async (R, album) => {
  const items = [...album.tracks.items];
  for (let offset = items.length; offset < Math.min(album.tracks.total, MAX_TRACKS); offset += 50) {
    items.push(...(await exports.api(R, `/albums/${album.id}/tracks`, { limit: 50, offset })).items);
  }
  return items;
};
