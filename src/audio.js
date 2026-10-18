// Flux audio direct via Piped / Invidious (audio seul, URL proxifiée par l'instance).
const inst = require('./instances');
const stats = require('./stats');

const score = (mime, bitrate) => (/mp4|m4a/i.test(mime || '') ? 1000 : 0) + (+bitrate || 0) / 1000;

async function piped(id) {
  return inst.first('piped', async (b) => {
    const j = await inst.getJson(`${b}/streams/${id}`);
    const s = (j.audioStreams || []).filter((x) => x.url && !x.videoOnly)
      .sort((a, c) => score(c.mimeType || c.format, c.bitrate) - score(a.mimeType || a.format, a.bitrate))[0];
    if (!s) throw new Error('pas de flux audio');
    let url = s.url;
    if (j.proxyUrl) {
      const u = new URL(s.url), p = new URL(j.proxyUrl);
      if (u.host !== p.host) { u.searchParams.set('host', u.host); u.protocol = p.protocol; u.host = p.host; url = u.toString(); }
    }
    return { url, label: `${Math.round((s.bitrate || 0) / 1000)} kbps ${s.codec || s.format || ''}`.trim(), via: 'Piped' };
  });
}

async function invidious(id) {
  return inst.first('inv', async (b) => {
    const j = await inst.getJson(`${b}/api/v1/videos/${id}?local=true&fields=adaptiveFormats`);
    const s = (j.adaptiveFormats || []).filter((x) => String(x.type).startsWith('audio/') && x.url)
      .sort((a, c) => score(c.type, c.bitrate) - score(a.type, a.bitrate))[0];
    if (!s) throw new Error('pas de flux audio');
    return { url: s.url.startsWith('http') ? s.url : b + s.url, label: `${Math.round((s.bitrate || 0) / 1000)} kbps`, via: 'Invidious' };
  });
}

exports.direct = async (id) => {
  const errs = [];
  for (const fn of [piped, invidious]) {
    try { const r = await fn(id); stats.count('direct_ok'); return r; }
    catch (e) { errs.push(e.message); }
  }
  stats.count('direct_fail');
  stats.error(`Audio direct ${id} : ${errs.join(' | ')}`);
  throw new Error(errs.join(' | '));
};
