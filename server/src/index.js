require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { sendLicenseMail } = require('./mailer');

const SECRET = process.env.SESSION_SECRET;
if (!SECRET || !process.env.ADMIN_PASS) {
  console.error('Set SESSION_SECRET and ADMIN_PASS in server/.env first.');
  process.exit(1);
}
const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const ROOT = path.join(__dirname, '..', '..');
const RELEASES = path.join(__dirname, '..', 'releases');
const REGISTRY = path.join(__dirname, '..', 'registry.json');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- helpers ----------
const hits = new Map();
const limit = (max, windowMs) => (req, res, next) => {
  const k = req.ip + req.path;
  const now = Date.now();
  const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) return res.status(429).json({ error: 'Too many requests, try again later' });
  arr.push(now);
  hits.set(k, arr);
  next();
};
const hmac = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('hex');
const safeEq = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
const signAdminToken = () => {
  const exp = String(Date.now() + 12 * 3600 * 1000);
  return exp + '.' + hmac(exp);
};
const checkAdminToken = (t) => {
  const [exp, sig] = String(t || '').split('.');
  return !!exp && !!sig && Number(exp) > Date.now() && safeEq(sig, hmac(exp));
};
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
const requireAdmin = (req, res, next) =>
  checkAdminToken(bearer(req)) ? next() : res.status(401).json({ error: 'Unauthorized' });
const requireApiKey = wrap(async (req, res, next) =>
  (await db.apiKeyValid(bearer(req))) ? next() : res.status(401).json({ error: 'Invalid API key' }));

function validateCreate(body) {
  const email = String(body.email || '').trim();
  const type = body.type;
  const days = Number(body.days || 0);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email' };
  if (!['theme', 'both'].includes(type)) return { error: 'type must be "theme" or "both"' };
  if (!Number.isInteger(days) || days < 0 || days > 3650) return { error: 'days must be 0 (lifetime) to 3650' };
  return { email, type, days };
}
const publicLicense = (l) => ({
  key: l.key, email: l.email, type: l.type, status: l.status,
  domain: l.domain, created_at: l.created_at, expires_at: l.expires_at,
});

async function createAndMail(body, res) {
  const v = validateCreate(body);
  if (v.error) return res.status(400).json({ error: v.error });
  const lic = await db.createLicense(v);
  let emailed = false;
  try { emailed = await sendLicenseMail(v.email, lic); } catch (e) { console.error('Mail error:', e.message); }
  res.status(201).json({ ...publicLicense(lic), emailed });
}

// ---------- public: installer + CLI ----------
const serveScript = (file) => (req, res) => {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) return res.status(404).send('Not found');
  res.type('text/plain').send(fs.readFileSync(p, 'utf8').split('__BASE_URL__').join(BASE_URL));
};
app.get('/install.sh', serveScript('installer/install.sh'));
app.get('/geeken', serveScript('installer/geeken'));

// ---------- public: license verify + downloads ----------
app.post('/api/v1/verify', limit(30, 60000), wrap(async (req, res) => {
  const { key, domain, product } = req.body || {};
  const r = await db.verify(key, domain, product === 'addon' ? 'addon' : 'theme');
  res.json(r.ok ? { valid: true, type: r.type } : { valid: false, error: r.error });
}));

function sendRelease(file, product) {
  return wrap(async (req, res) => {
    const r = await db.verify(req.get('X-License-Key'), req.get('X-Domain'), product);
    if (!r.ok) return res.status(403).json({ error: r.error });
    const p = path.join(RELEASES, file(req));
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Release not built. Run: npm run release' });
    res.download(p);
  });
}
app.get('/api/v1/download/theme', limit(20, 60000), sendRelease(() => 'theme.tar.gz', 'theme'));
app.get('/api/v1/download/addon/:name', limit(60, 60000), (req, res, next) => {
  if (!/^[a-z0-9-]{1,40}$/.test(req.params.name)) return res.status(400).json({ error: 'Bad addon name' });
  next();
}, sendRelease((req) => `addon-${req.params.name}.tar.gz`, 'addon'));

app.get('/api/v1/addons', (req, res) => {
  try { res.json(JSON.parse(fs.readFileSync(REGISTRY, 'utf8'))); } catch { res.json([]); }
});

// ---------- bot API (Bearer API key) ----------
app.post('/api/v1/licenses', limit(60, 60000), requireApiKey, wrap((req, res) => createAndMail(req.body || {}, res)));
app.get('/api/v1/licenses/:key', requireApiKey, wrap(async (req, res) => {
  const l = await db.getLicense(req.params.key);
  l ? res.json(publicLicense(l)) : res.status(404).json({ error: 'Not found' });
}));
app.post('/api/v1/licenses/:key/revoke', requireApiKey, wrap(async (req, res) =>
  res.json({ revoked: (await db.revokeLicense(req.params.key)) > 0 })));
app.post('/api/v1/licenses/:key/reset-domain', requireApiKey, wrap(async (req, res) =>
  res.json({ reset: (await db.resetDomain(req.params.key)) > 0 })));

// ---------- admin ----------
app.post('/admin/login', limit(10, 60000), (req, res) => {
  const { username, password } = req.body || {};
  const ok = safeEq(username || '', process.env.ADMIN_USER || 'admin') && safeEq(password || '', process.env.ADMIN_PASS);
  ok ? res.json({ token: signAdminToken() }) : res.status(401).json({ error: 'Wrong username or password' });
});
app.get('/admin/licenses', requireAdmin, wrap(async (req, res) => res.json((await db.listLicenses()).map(publicLicense))));
app.post('/admin/licenses', requireAdmin, wrap((req, res) => createAndMail(req.body || {}, res)));
app.post('/admin/licenses/:key/revoke', requireAdmin, wrap(async (req, res) => res.json({ revoked: (await db.revokeLicense(req.params.key)) > 0 })));
app.post('/admin/licenses/:key/reset-domain', requireAdmin, wrap(async (req, res) => res.json({ reset: (await db.resetDomain(req.params.key)) > 0 })));
app.delete('/admin/licenses/:key', requireAdmin, wrap(async (req, res) => res.json({ deleted: (await db.deleteLicense(req.params.key)) > 0 })));
app.get('/admin/apikeys', requireAdmin, wrap(async (req, res) => res.json(await db.listApiKeys())));
app.post('/admin/apikeys', requireAdmin, wrap(async (req, res) => {
  const name = String((req.body || {}).name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'Enter a name for the key' });
  res.status(201).json({ key: await db.createApiKey(name) });
}));
app.delete('/admin/apikeys/:id', requireAdmin, wrap(async (req, res) => res.json({ revoked: (await db.revokeApiKey(Number(req.params.id))) > 0 })));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

db.ready
  .then(() => app.listen(Number(process.env.PORT || 3000), () => console.log(`Geeken license server on ${BASE_URL}`)))
  .catch((e) => { console.error('Database error:', e.message); process.exit(1); });
