// Two backends, same API:
//  - UPSTASH_REDIS_REST_URL + _TOKEN set -> Upstash Redis (see db-redis.js)
//  - DATABASE_URL set  -> PostgreSQL (use this on Render free: Neon, Supabase, Render Postgres...)
//  - otherwise         -> local SQLite file (DB_PATH or server/geeken.db)
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  module.exports = require('./db-redis'); // Upstash Redis
  return;
}

const crypto = require('crypto');
const path = require('path');

const USE_PG = !!process.env.DATABASE_URL;
let run;
let ready;

const LICENSES_SQLITE = `CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE NOT NULL, email TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('theme','both')), status TEXT NOT NULL DEFAULT 'active',
  domain TEXT, created_at INTEGER NOT NULL, expires_at INTEGER)`;
const KEYS_SQLITE = `CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, key_hash TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)`;
const LICENSES_PG = `CREATE TABLE IF NOT EXISTS licenses (
  id SERIAL PRIMARY KEY, key TEXT UNIQUE NOT NULL, email TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('theme','both')), status TEXT NOT NULL DEFAULT 'active',
  domain TEXT, created_at BIGINT NOT NULL, expires_at BIGINT)`;
const KEYS_PG = `CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT UNIQUE NOT NULL,
  created_at BIGINT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)`;

if (USE_PG) {
  const { Pool, types } = require('pg');
  types.setTypeParser(20, (v) => Number(v)); // BIGINT -> number
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
    max: 5,
  });
  const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => '$' + ++i); };
  run = async (sql, params = []) => {
    const r = await pool.query(toPg(sql), params);
    return { rows: r.rows, changes: r.rowCount };
  };
  ready = run(LICENSES_PG).then(() => run(KEYS_PG));
} else {
  const Database = require('better-sqlite3');
  const db = new Database(process.env.DB_PATH || path.join(__dirname, '..', 'geeken.db'));
  db.pragma('journal_mode = WAL');
  db.exec(LICENSES_SQLITE);
  db.exec(KEYS_SQLITE);
  run = async (sql, params = []) => {
    const st = db.prepare(sql);
    if (/^\s*select/i.test(sql)) return { rows: st.all(...params), changes: 0 };
    return { rows: [], changes: st.run(...params).changes };
  };
  ready = Promise.resolve();
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomChunk(n) {
  const bytes = crypto.randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const normDomain = (d) => String(d || '').trim().toLowerCase();

async function getLicense(key) {
  const r = await run('SELECT * FROM licenses WHERE key = ?', [String(key || '')]);
  return r.rows[0] || null;
}
async function createLicense({ email, type, days }) {
  const key = ['GKN', randomChunk(4), randomChunk(4), randomChunk(4), randomChunk(4)].join('-');
  const now = Date.now();
  const expires = days > 0 ? now + days * 86400000 : null;
  await run('INSERT INTO licenses (key,email,type,created_at,expires_at) VALUES (?,?,?,?,?)', [key, email, type, now, expires]);
  return getLicense(key);
}
const listLicenses = async () => (await run('SELECT * FROM licenses ORDER BY id DESC LIMIT 500')).rows;
const revokeLicense = async (key) => (await run("UPDATE licenses SET status='revoked' WHERE key=?", [key])).changes;
const deleteLicense = async (key) => (await run('DELETE FROM licenses WHERE key=?', [key])).changes;
const resetDomain = async (key) => (await run('UPDATE licenses SET domain=NULL WHERE key=?', [key])).changes;

async function verify(key, domain, product) {
  const l = await getLicense(key);
  const d = normDomain(domain);
  if (!l) return { ok: false, error: 'Invalid license key' };
  if (l.status !== 'active') return { ok: false, error: 'This license was revoked' };
  if (l.expires_at && l.expires_at < Date.now()) return { ok: false, error: 'This license expired' };
  if (product === 'addon' && l.type !== 'both') return { ok: false, error: 'This license does not include addons' };
  if (!d) return { ok: false, error: 'Domain is required' };
  if (!l.domain) {
    await run('UPDATE licenses SET domain=? WHERE id=? AND domain IS NULL', [d, l.id]);
    const again = await getLicense(key);
    if (again.domain !== d) return { ok: false, error: 'This license is locked to ' + again.domain };
  } else if (l.domain !== d) {
    return { ok: false, error: 'This license is locked to ' + l.domain };
  }
  return { ok: true, type: l.type };
}

async function createApiKey(name) {
  const key = 'gk_live_' + crypto.randomBytes(24).toString('hex');
  await run('INSERT INTO api_keys (name,key_hash,created_at) VALUES (?,?,?)', [name, sha256(key), Date.now()]);
  return key;
}
const listApiKeys = async () => (await run('SELECT id,name,created_at,revoked FROM api_keys ORDER BY id DESC')).rows;
const revokeApiKey = async (id) => (await run('UPDATE api_keys SET revoked=1 WHERE id=?', [id])).changes;
const apiKeyValid = async (key) =>
  (await run('SELECT 1 AS ok FROM api_keys WHERE key_hash=? AND revoked=0', [sha256(String(key || ''))])).rows.length > 0;

module.exports = {
  ready, createLicense, getLicense, listLicenses, revokeLicense, deleteLicense, resetDomain, verify,
  createApiKey, listApiKeys, revokeApiKey, apiKeyValid, normDomain,
};
