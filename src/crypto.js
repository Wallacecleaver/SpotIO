const crypto = require('crypto');
const key = () => crypto.createHash('sha256').update(process.env.SECRET || 'dev-secret-change-me').digest();

// AES-256-GCM : iv(12) | tag(16) | données, en base64url
exports.enc = (txt) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(txt, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
};
exports.dec = (s) => {
  const buf = Buffer.from(s, 'base64url');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
};
