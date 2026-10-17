const sp = require('./spotify');
const yt = require('./youtube');

const DEFAULT_CATS = ['playlists', 'liked', 'albums', 'top', 'recent', 'new', 'search'];
const CATS = {
  playlists: { type: 'channel', name: 'Playlists' },
  albums: { type: 'channel', name: 'Albums' },
  liked: { type: 'movie', name: 'Titres likés' },
  top: { type: 'movie', name: 'Top titres' },
  recent: { type: 'movie', name: 'Récemment écoutés' },
  new: { type: 'channel', name: 'Nouveautés' },
};

function manifest(cfg, base, bare = false) {
  const catalogs = [];
  for (const k of cfg.cats) {
    if (k === 'search') {
      catalogs.push(
        { type: 'movie', id: 'spotio.search_tracks', name: 'SpotIO · Recherche titres', extra: [{ name: 'search', isRequired: true }] },
        { type: 'channel', id: 'spotio.search_albums', name: 'SpotIO · Recherche albums', extra: [{ name: 'search', isRequired: true }] },
      );
    } else if (CATS[k]) {
      catalogs.push({ type: CATS[k].type, id: 'spotio.' + k, name: 'SpotIO · ' + CATS[k].name, extra: [{ name: 'skip' }] });
    }
  }
  return {
    id: 'community.spotio', version: '1.0.0', name: 'SpotIO',
    description: 'Ton Spotify dans Stremio : playlists, albums, titres likés… lus via YouTube.',
    logo: `${base}/logo.svg`,
    resources: ['catalog', 'meta', 'stream'], types: ['movie', 'channel'], idPrefixes: ['spotio:'],
    catalogs, behaviorHints: { configurable: true, configurationRequired: bare },
  };
}

const artistsOf = (t) => (t.artists || []).map((a) => a.name).join(', ');
const trackMeta = (raw) => {
  const t = sp.simple(raw);
  return {
    id: `spotio:track:${t.id}`, type: 'movie', name: `${t.artists[0] || ''} – ${t.name}`,
    poster: t.cover, posterShape: 'square', background: t.cover,
    description: `${t.artists.join(', ')} · ${t.album}`, releaseInfo: t.year,
    runtime: t.dur ? `${Math.floor(t.dur / 60)}:${String(t.dur % 60).padStart(2, '0')}` : undefined,
  };
};
const channel = (kind, id, name, images, desc = '') => ({
  id: `spotio:${kind}:${id}`, type: 'channel', name, poster: sp.cover(images), posterShape: 'square', description: desc,
});
const albumItem = (a) => channel('album', a.id, `${a.name} – ${artistsOf(a)}`, a.images, `${a.release_date || ''} · ${a.total_tracks || ''} titres`);

async function catalog(cfg, id, extra) {
  const R = cfg.refresh, key = id.replace('spotio.', ''), offset = +extra.skip || 0;
  const page = { limit: 50, offset };
  switch (key) {
    case 'playlists':
      return (await sp.api(R, '/me/playlists', page)).items.filter(Boolean)
        .map((p) => channel('playlist', p.id, p.name, p.images, p.description || `par ${p.owner?.display_name || ''}`));
    case 'albums':
      return (await sp.api(R, '/me/albums', page)).items.map((i) => albumItem(i.album));
    case 'liked':
      return (await sp.api(R, '/me/tracks', page)).items.filter((i) => i.track?.id).map((i) => trackMeta(i.track));
    case 'top':
      return (await sp.api(R, '/me/top/tracks', { ...page, time_range: 'medium_term' })).items.map(trackMeta);
    case 'recent': {
      if (offset) return [];
      const seen = new Set();
      return (await sp.api(R, '/me/player/recently-played', { limit: 50 }, 30)).items
        .filter((i) => !seen.has(i.track.id) && seen.add(i.track.id)).map((i) => trackMeta(i.track));
    }
    case 'new':
      return (await sp.api(R, '/browse/new-releases', { ...page, country: cfg.country })).albums.items.map(albumItem);
    case 'search_tracks':
      return extra.search ? (await sp.api(R, '/search', { q: extra.search, type: 'track', limit: 20, offset })).tracks.items.map(trackMeta) : [];
    case 'search_albums':
      return extra.search ? (await sp.api(R, '/search', { q: extra.search, type: 'album', limit: 20, offset })).albums.items.map(albumItem) : [];
    default: return [];
  }
}

function collection(id, name, images, desc, tracks, withArtist) {
  return {
    id, type: 'channel', name, poster: sp.cover(images), posterShape: 'square', background: sp.cover(images), description: desc || '',
    videos: tracks.map((t, i) => ({
      id: `spotio:track:${t.id}`,
      title: `${i + 1}. ${t.name}${withArtist ? ' – ' + artistsOf(t) : ''}`,
      released: new Date(Date.UTC(2000, 0, 1, 0, 0, i)).toISOString(),
      thumbnail: sp.cover(t.album?.images || images),
    })),
  };
}

async function meta(cfg, id) {
  const [, kind, rid] = id.split(':'), R = cfg.refresh;
  if (kind === 'track') return trackMeta(await sp.api(R, '/tracks/' + rid, {}, 600));
  if (kind === 'playlist') {
    const p = await sp.api(R, '/playlists/' + rid, { fields: 'id,name,description,images' });
    return collection(id, p.name, p.images, p.description, await sp.playlistTracks(R, rid), true);
  }
  if (kind === 'album') {
    const a = await sp.api(R, '/albums/' + rid);
    const tracks = (await sp.albumTracks(R, a)).map((t) => ({ ...t, album: { images: a.images } }));
    return collection(id, `${a.name} – ${artistsOf(a)}`, a.images, `${a.release_date} · ${a.label || ''}`, tracks, false);
  }
  return null;
}

async function stream(cfg, id) {
  const [, kind, rid] = id.split(':');
  if (kind !== 'track') return [];
  const t = sp.simple(await sp.api(cfg.refresh, '/tracks/' + rid, {}, 600));
  const c = await yt.resolve(t, cfg.pref);
  return c.map((x, i) => ({ ytId: x.id, name: 'SpotIO', title: `${i ? '' : '★ '}${x.title}\n${x.channel}` }));
}

module.exports = { manifest, catalog, meta, stream, DEFAULT_CATS };
