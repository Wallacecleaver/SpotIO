const stats = require('./stats');
const inst = require('./instances');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const clock = (s) => (s ? s.split(':').reduce((a, n) => a * 60 + +n, 0) : 0);
const iso = (d) => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d) || []; return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0); };

async function viaApi(q) {
  const key = process.env.YT_API_KEY;
  const s = await (await fetch('https://www.googleapis.com/youtube/v3/search?' + new URLSearchParams({ part: 'snippet', type: 'video', maxResults: '8', q, key }))).json();
  if (!s.items) throw new Error('YouTube API : ' + (s.error?.message || 'aucun résultat'));
  const ids = s.items.map((i) => i.id.videoId).join(',');
  const v = await (await fetch('https://www.googleapis.com/youtube/v3/videos?' + new URLSearchParams({ part: 'contentDetails', id: ids, key }))).json();
  const dur = Object.fromEntries((v.items || []).map((i) => [i.id, iso(i.contentDetails.duration)]));
  return s.items.map((i) => ({ id: i.id.videoId, title: i.snippet.title, channel: i.snippet.channelTitle, dur: dur[i.id] || 0 }));
}

async function viaScrape(q) {
  const r = await fetch('https://www.youtube.com/results?hl=en&search_query=' + encodeURIComponent(q), {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' },
  });
  const html = await r.text();
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) throw new Error(`YouTube : page de résultats illisible (HTTP ${r.status})`);
  const found = [];
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (o.videoRenderer) found.push(o.videoRenderer);
    for (const k in o) walk(o[k]);
  })(JSON.parse(m[1]));
  return found.filter((v) => v.videoId).slice(0, 10).map((v) => ({
    id: v.videoId,
    title: v.title?.runs?.[0]?.text || '',
    channel: v.ownerText?.runs?.[0]?.text || '',
    dur: clock(v.lengthText?.simpleText),
  }));
}

async function viaPipedSearch(q) {
  return inst.first('piped', async (b) => {
    const j = await inst.getJson(`${b}/search?q=${encodeURIComponent(q)}&filter=videos`);
    return (j.items || []).filter((i) => /watch\?v=/.test(i.url || '')).slice(0, 10).map((i) => ({
      id: new URL(i.url, 'http://x').searchParams.get('v'), title: i.title || '', channel: i.uploaderName || '', dur: i.duration > 0 ? i.duration : 0,
    }));
  });
}
async function viaInvidiousSearch(q) {
  return inst.first('inv', async (b) => (await inst.getJson(`${b}/api/v1/search?q=${encodeURIComponent(q)}&type=video`))
    .filter((i) => i.type === 'video').slice(0, 10).map((i) => ({ id: i.videoId, title: i.title, channel: i.author, dur: i.lengthSeconds || 0 })));
}

// Chaîne de secours : API YouTube (si clé) → scraping → Piped → Invidious
async function search(q) {
  const chain = [...(process.env.YT_API_KEY ? [viaApi] : []), viaScrape, viaPipedSearch, viaInvidiousSearch];
  let last;
  for (const fn of chain) {
    try { const r = await fn(q); if (r.length) return r; } catch (e) { last = e; }
  }
  throw last || new Error('Aucun résultat YouTube');
}

const BAD = ['live', 'cover', 'remix', 'karaoke', 'instrumental', 'sped up', 'slowed', 'reverb', '8d', 'nightcore', 'reaction', 'tutorial'];
function score(c, t, pref) {
  const title = norm(c.title), ch = norm(c.channel), name = norm(t.name);
  let s = 0;
  if (title.includes(name)) s += 40;
  if (t.artists.some((a) => title.includes(norm(a)) || ch.includes(norm(a)))) s += 25;
  if (ch.endsWith(' topic')) s += pref === 'audio' ? 30 : 10;
  if (/vevo|official/.test(ch)) s += pref === 'video' ? 15 : 5;
  if (pref === 'video' && /official (music )?video|clip officiel/.test(title)) s += 15;
  if (pref === 'audio' && /\baudio\b|lyric/.test(title)) s += 8;
  if (c.dur && t.dur) {
    const d = Math.abs(c.dur - t.dur);
    s += d <= 3 ? 30 : d <= 8 ? 20 : d <= 20 ? 5 : -25;
  }
  for (const b of BAD) if (title.includes(b) && !name.includes(b)) s -= 30;
  return s;
}

exports.resolve = async (track, pref) => {
  const ov = stats.getOverride(track.id);
  if (ov) return [{ id: ov, title: 'Choix manuel', channel: '', score: 999 }];

  const key = `${track.id}:${pref}`;
  const hit = stats.cacheGet(key);
  if (hit) { stats.count('hit'); return hit.c; }
  stats.count('miss');

  const q = `${track.artists[0]} ${track.name} ${pref === 'video' ? 'official video' : 'audio'}`;
  let list;
  try { list = await search(q); }
  catch (e) { stats.count('fail'); stats.error(`${e.message} (${q})`); return []; }

  const c = list.map((x) => ({ ...x, score: score(x, track, pref) })).filter((x) => x.score >= 20).sort((a, b) => b.score - a.score).slice(0, 3);
  if (!c.length) { stats.count('fail'); stats.error(`Aucun match : ${q}`); return []; }
  stats.cacheSet(key, { t: { id: track.id, name: track.name, artists: track.artists, dur: track.dur }, c, pref, at: Date.now() });
  return c;
};
