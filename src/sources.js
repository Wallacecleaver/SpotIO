// Import de playlists/albums par simple lien, sans compte ni API Spotify : Spotify (page embed publique) et Deezer (API publique).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAX = 300;
const cache = new Map();

function parse(u) {
  u = String(u || '').trim();
  let m = u.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(playlist|album)\/([A-Za-z0-9]{10,30})/) || u.match(/^spotify:(playlist|album):([A-Za-z0-9]{10,30})$/);
  if (m) return { k: 's', t: m[1], id: m[2] };
  m = u.match(/deezer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(playlist|album)\/(\d+)/);
  if (m) return { k: 'd', t: m[1], id: m[2] };
  m = u.match(/^([sd]):(playlist|album):(\w+)$/);
  return m ? { k: m[1], t: m[2], id: m[3] } : null;
}

const json = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
};

async function spotify(s) {
  const r = await fetch(`https://open.spotify.com/embed/${s.t}/${s.id}`, {
    signal: AbortSignal.timeout(10000), headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
  });
  if (!r.ok) throw new Error('Spotify HTTP ' + r.status + (r.status === 404 ? ' (liste privée ou introuvable)' : ''));
  const m = (await r.text()).match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (!m) throw new Error('page Spotify illisible (le format a peut-être changé)');
  const e = JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity;
  if (!e?.trackList?.length) throw new Error('aucun titre trouvé (liste privée ou vide ?)');
  const cover = [...(e.coverArt?.sources || [])].sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url;
  return {
    name: e.name || e.title || 'Liste Spotify', cover,
    tracks: e.trackList.slice(0, MAX).filter((t) => t.title).map((t) => ({
      n: t.title, a: String(t.subtitle || '').replace(/\u00a0/g, ' '), d: t.duration > 3600 ? Math.round(t.duration / 1000) : t.duration || 0,
    })),
  };
}

async function deezer(s) {
  const j = await json(`https://api.deezer.com/${s.t}/${s.id}`);
  if (j.error) throw new Error('Deezer : ' + (j.error.message || j.error.type));
  let data = j.tracks?.data || [];
  if (s.t === 'playlist' && j.nb_tracks > data.length) {
    const more = await json(`https://api.deezer.com/playlist/${s.id}/tracks?index=${data.length}&limit=${MAX}`).catch(() => ({ data: [] }));
    data = data.concat(more.data || []);
  }
  if (!data.length) throw new Error('aucun titre trouvé');
  return {
    name: j.title, cover: j.picture_big || j.cover_big,
    tracks: data.slice(0, MAX).map((t) => ({ n: t.title, a: t.artist?.name || j.artist?.name || '', d: t.duration || 0, c: t.album?.cover_big })),
  };
}

async function load(s) {
  const key = `${s.k}:${s.t}:${s.id}`, hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.v;
  const v = await (s.k === 's' ? spotify(s) : deezer(s));
  if (cache.size > 300) cache.clear();
  cache.set(key, { v, exp: Date.now() + 3600e3 });
  return v;
}

module.exports = { parse, load };
