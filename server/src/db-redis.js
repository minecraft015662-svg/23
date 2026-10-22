// Upstash Redis backend (REST API). Used when UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set.
const crypto = require('crypto');

const BASE = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

async function cmd(...args) {
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || 'Redis HTTP ' + r.status);
  return j.result;
}
const ready = cmd('PING').then(() => {});

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomChunk(n) {
  const bytes = crypto.randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const normDomain = (d) => String(d || '').trim().toLowerCase();
const validKey = (k) => /^GKN-[A-Z0-9-]{4,40}$/.test(k);

async function getLicense(key) {
  key = String(key || '');
  if (!validKey(key)) return null;
  const raw = await cmd('GET', 'lic:' + key);
  if (!raw) return null;
  const l = JSON.parse(raw);
  l.domain = (await cmd('GET', 'dom:' + key)) || null;
  return l;
}
async function saveLicense(l) {
  const { domain, ...rest } = l; // domain lives in its own key
  await cmd('SET', 'lic:' + l.key, JSON.stringify(rest));
}
async function createLicense({ email, type, days }) {
  const key = ['GKN', randomChunk(4), randomChunk(4), randomChunk(4), randomChunk(4)].join('-');
  const now = Date.now();
  const lic = { key, email, type, status: 'active', created_at: now, expires_at: days > 0 ? now + days * 86400000 : null };
  await cmd('SET', 'lic:' + key, JSON.stringify(lic), 'NX');
  await cmd('ZADD', 'lic:index', now, key);
  return getLicense(key);
}
async function listLicenses() {
  const keys = await cmd('ZREVRANGE', 'lic:index', 0, 499);
  if (!keys.length) return [];
  const raws = await cmd('MGET', ...keys.map((k) => 'lic:' + k));
  const doms = await cmd('MGET', ...keys.map((k) => 'dom:' + k));
  const out = [];
  raws.forEach((raw, i) => { if (raw) out.push({ ...JSON.parse(raw), domain: doms[i] || null }); });
  return out;
}
async function revokeLicense(key) {
  const l = await getLicense(key);
  if (!l) return 0;
  l.status = 'revoked';
  await saveLicense(l);
  return 1;
}
async function deleteLicense(key) {
  const l = await getLicense(key);
  if (!l) return 0;
  await cmd('DEL', 'lic:' + key);
  await cmd('DEL', 'dom:' + key);
  await cmd('ZREM', 'lic:index', key);
  return 1;
}
async function resetDomain(key) {
  const l = await getLicense(key);
  if (!l) return 0;
  await cmd('DEL', 'dom:' + key);
  return 1;
}

async function verify(key, domain, product) {
  const l = await getLicense(key);
  const d = normDomain(domain);
  if (!l) return { ok: false, error: 'Invalid license key' };
  if (l.status !== 'active') return { ok: false, error: 'This license was revoked' };
  if (l.expires_at && l.expires_at < Date.now()) return { ok: false, error: 'This license expired' };
  if (product === 'addon' && l.type !== 'both') return { ok: false, error: 'This license does not include addons' };
  if (!d) return { ok: false, error: 'Domain is required' };
  if (!l.domain) {
    await cmd('SET', 'dom:' + l.key, d, 'NX'); // atomic first-use bind
    const cur = await cmd('GET', 'dom:' + l.key);
    if (cur !== d) return { ok: false, error: 'This license is locked to ' + cur };
  } else if (l.domain !== d) {
    return { ok: false, error: 'This license is locked to ' + l.domain };
  }
  return { ok: true, type: l.type };
}

async function createApiKey(name) {
  const id = await cmd('INCR', 'apikey:seq');
  const key = 'gk_live_' + crypto.randomBytes(24).toString('hex');
  const hash = sha256(key);
  const now = Date.now();
  await cmd('SET', 'apikey:' + hash, JSON.stringify({ id, name, created_at: now, revoked: 0 }));
  await cmd('SET', 'apikey:id:' + id, hash);
  await cmd('ZADD', 'apikey:index', id, hash);
  return key;
}
async function listApiKeys() {
  const hashes = await cmd('ZREVRANGE', 'apikey:index', 0, 99);
  if (!hashes.length) return [];
  const raws = await cmd('MGET', ...hashes.map((h) => 'apikey:' + h));
  return raws.filter(Boolean).map((r) => JSON.parse(r));
}
async function revokeApiKey(id) {
  const hash = await cmd('GET', 'apikey:id:' + Number(id));
  if (!hash) return 0;
  const raw = await cmd('GET', 'apikey:' + hash);
  if (!raw) return 0;
  const o = JSON.parse(raw);
  o.revoked = 1;
  await cmd('SET', 'apikey:' + hash, JSON.stringify(o));
  return 1;
}
async function apiKeyValid(key) {
  const raw = await cmd('GET', 'apikey:' + sha256(String(key || '')));
  return !!raw && JSON.parse(raw).revoked === 0;
}

module.exports = {
  ready, createLicense, getLicense, listLicenses, revokeLicense, deleteLicense, resetDomain, verify,
  createApiKey, listApiKeys, revokeApiKey, apiKeyValid, normDomain,
};
