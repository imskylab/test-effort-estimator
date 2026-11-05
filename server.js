#!/usr/bin/env node
/*
 * Test Effort Estimator - self-hosted server
 * No dependencies: needs Node.js 18 or later.
 *
 * Environment variables (all optional):
 *   PORT        Port to listen on (default 3000)
 *   HOST        Interface to bind (default 127.0.0.1, this machine only).
 *               Set HOST=0.0.0.0 to share on your network; a login is then required.
 *   BASIC_AUTH  Logins as "user:password" or "alice:pw1,bob:pw2"
 *   USERS_FILE  Path to a JSON file of logins: { "alice": "pw1", "bob": "pw2" }
 *   DATA_DIR    Folder for saved data (default ./data)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.log');
const PUBLIC = path.join(__dirname, 'public');
const MAX_BODY = 5 * 1024 * 1024;

/* ---------- logins ---------- */
const USERS = {};
if (process.env.BASIC_AUTH) process.env.BASIC_AUTH.split(',').forEach(pair => {
  const i = pair.indexOf(':'); if (i > 0) USERS[pair.slice(0, i).trim()] = pair.slice(i + 1);
});
if (process.env.USERS_FILE) {
  try { Object.assign(USERS, JSON.parse(fs.readFileSync(process.env.USERS_FILE, 'utf8'))); }
  catch (e) { console.error('Could not read USERS_FILE: ' + e.message); process.exit(1); }
}
const AUTH_ON = Object.keys(USERS).length > 0;
const LOOPBACK = ['127.0.0.1', '::1', 'localhost'].includes(HOST);
if (!LOOPBACK && !AUTH_ON) {
  console.error(`Refusing to listen on ${HOST} without a login. Set BASIC_AUTH=user:password (or USERS_FILE), or use HOST=127.0.0.1 for this machine only.`);
  process.exit(1);
}
function whoIs(req) {
  if (!AUTH_ON) return 'local';
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return null;
  const raw = Buffer.from(h.slice(6), 'base64').toString(), i = raw.indexOf(':');
  if (i < 0) return null;
  const user = raw.slice(0, i), pw = Buffer.from(raw.slice(i + 1));
  if (!Object.prototype.hasOwnProperty.call(USERS, user)) return null;
  const want = Buffer.from(String(USERS[user]));
  return pw.length === want.length && crypto.timingSafeEqual(pw, want) ? user : null;
}

/* ---------- storage: one JSON file, map of document path -> body ---------- */
fs.mkdirSync(DATA_DIR, { recursive: true });
let db = {};
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) {
  if (e.code !== 'ENOENT') { console.error('Could not read ' + DB_FILE + ': ' + e.message); process.exit(1); }
}
let version = 1; // bumps on every write; drives ETags for polling
let writing = false, pending = false;
function persist() { version++; writeSoon(); }
function writeSoon() {
  if (writing) { pending = true; return; }
  writing = true;
  const tmp = DB_FILE + '.tmp';
  fs.writeFile(tmp, JSON.stringify(db), err => {
    if (err) { console.error('Save failed:', err.message); writing = false; return; }
    fs.rename(tmp, DB_FILE, err2 => {
      if (err2) console.error('Save failed:', err2.message);
      writing = false;
      if (pending) { pending = false; writeSoon(); }
    });
  });
}
function audit(user, method, key, body) {
  const entry = { t: new Date().toISOString(), user, method, path: key };
  if (body && typeof body.name === 'string') entry.name = body.name.slice(0, 120);
  fs.appendFile(AUDIT_FILE, JSON.stringify(entry) + '\n', () => { });
}
function backup() {
  if (!fs.existsSync(DB_FILE)) return;
  const dir = path.join(DATA_DIR, 'backups'); fs.mkdirSync(dir, { recursive: true });
  const name = 'db-' + new Date().toISOString().slice(0, 10) + '.json';
  fs.copyFile(DB_FILE, path.join(dir, name), () => {
    const files = fs.readdirSync(dir).filter(f => f.startsWith('db-')).sort();
    files.slice(0, Math.max(0, files.length - 14)).forEach(f => fs.unlink(path.join(dir, f), () => { }));
  });
}
backup(); setInterval(backup, 6 * 3600 * 1000).unref();

const SEG = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
function parsePath(p, wantDoc) {
  const segs = p.split('/').filter(Boolean);
  if (!segs.length || segs.length > 16 || !segs.every(s => SEG.test(s) && s !== '.' && s !== '..')) return null;
  if (wantDoc ? segs.length % 2 !== 0 : segs.length % 2 !== 1) return null;
  return segs.join('/');
}

/* ---------- validation of known document shapes ---------- */
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
function validate(key, body) {
  const segs = key.split('/');
  if (segs[0] === 'projects' && segs.length === 2) {
    if (typeof body.name !== 'string') return 'Project needs a name';
    const d = body.data;
    if (!isObj(d)) return 'Project needs a data object';
    for (const k of ['modules', 'team', 'holidays']) if (!Array.isArray(d[k])) return `Project data needs a ${k} list`;
    if (typeof d.start !== 'string' || !DATE.test(d.start)) return 'Project start must be a date (YYYY-MM-DD)';
    if (d.end && !DATE.test(d.end)) return 'Project end must be a date (YYYY-MM-DD) or empty';
    if (!isObj(d.a)) return 'Project data needs its factors';
    if (d.modules.some(m => !isObj(m) || typeof m.id !== 'string')) return 'Every module needs an id';
    if (d.team.some(r => !isObj(r))) return 'Team entries must be objects';
  }
  if (segs[0] === 'projects' && segs[2] === 'actuals' && segs.length === 4) {
    if (body.week != null && !DATE.test(body.week)) return 'Week must be a date (YYYY-MM-DD)';
    if (body.mods != null && !isObj(body.mods)) return 'mods must be an object';
    if (isObj(body.mods)) for (const v of Object.values(body.mods)) {
      if (!isObj(v)) return 'Each module entry must be an object';
      for (const k of ['designed', 'automated', 'executed']) if (v[k] != null && (typeof v[k] !== 'number' || v[k] < 0 || !isFinite(v[k]))) return `${k} must be a number of 0 or more`;
    }
  }
  return null;
}
function deepMerge(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (isObj(v) && isObj(target[k])) deepMerge(target[k], v);
    else target[k] = v;
  }
  return target;
}

/* ---------- http ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'same-origin' };
function send(res, code, body, type = 'application/json', extra = {}) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...SEC, ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function jsonBody(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch (e) { send(res, e.message === 'too_large' ? 413 : 400, { code: 'invalid_argument', message: 'Body must be a JSON object under 5 MB' }); return null; }
  if (!isObj(body)) { send(res, 400, { code: 'invalid_argument', message: 'Body must be a JSON object' }); return null; }
  return body;
}

const server = http.createServer(async (req, res) => {
  const user = whoIs(req);
  if (!user) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Test Effort Estimator"', ...SEC }); return res.end('Login required'); }
  const url = new URL(req.url, 'http://x');
  let p;
  try { p = decodeURIComponent(url.pathname); } catch (e) { return send(res, 400, { code: 'invalid_argument', message: 'Bad path' }); }
  try {
    if (p === '/api/me') return send(res, 200, { user, auth: AUTH_ON });
    if (p === '/api/health') return send(res, 200, { ok: true });
    if (p.startsWith('/api/doc/')) {
      const key = parsePath(p.slice(9), true);
      if (!key) return send(res, 400, { code: 'invalid_argument', message: 'Bad document path' });
      if (req.method === 'GET') return db[key] ? send(res, 200, { id: key.split('/').pop(), data: db[key] }) : send(res, 404, { code: 'not_found' });
      if (req.method === 'PUT') {
        const body = await jsonBody(req, res); if (!body) return;
        // optimistic concurrency: the client says which revision it edited
        const prevRev = body.prevRev; delete body.prevRev;
        if (prevRev !== undefined && db[key] && db[key].rev !== undefined && db[key].rev !== prevRev) {
          return send(res, 409, { code: 'conflict', message: 'Someone else saved this first', current: db[key] });
        }
        const err = validate(key, body); if (err) return send(res, 400, { code: 'invalid_argument', message: err });
        body.updatedBy = user;
        db[key] = body; persist(); audit(user, 'PUT', key, body);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'PATCH') {
        const patch = await jsonBody(req, res); if (!patch) return;
        if (!db[key]) return send(res, 404, { code: 'invalid_argument', message: 'Document does not exist' });
        const next = deepMerge(JSON.parse(JSON.stringify(db[key])), patch);
        const err = validate(key, next); if (err) return send(res, 400, { code: 'invalid_argument', message: err });
        next.updatedBy = user;
        db[key] = next; persist(); audit(user, 'PATCH', key, patch);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'DELETE') {
        Object.keys(db).forEach(k => { if (k === key || k.startsWith(key + '/')) delete db[k]; });
        persist(); audit(user, 'DELETE', key);
        return send(res, 200, { ok: true });
      }
      return send(res, 405, { code: 'invalid_argument' });
    }
    if (p.startsWith('/api/col/')) {
      const col = parsePath(p.slice(9), false);
      if (!col || req.method !== 'GET') return send(res, 400, { code: 'invalid_argument', message: 'Bad collection path' });
      const etag = `"v${version}"`;
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, ...SEC }); return res.end(); }
      const depth = col.split('/').length + 1;
      const docs = Object.keys(db).filter(k => k.startsWith(col + '/') && k.split('/').length === depth).map(k => ({ id: k.split('/').pop(), data: db[k] }));
      return send(res, 200, { docs }, 'application/json', { ETag: etag });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
    const file = path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : p));
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 404, 'Not found', 'text/plain');
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'Not found', 'text/plain');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SEC });
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
  } catch (e) {
    console.error(e); send(res, 500, { code: 'unavailable', message: 'Server error' });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    const where = LOOPBACK ? `http://localhost:${PORT} (this machine only)` : `http://${HOST}:${PORT}`;
    console.log(`Test Effort Estimator running at ${where}`);
    console.log(`Data is saved in ${DB_FILE}; changes are logged to ${AUDIT_FILE}`);
    console.log(AUTH_ON ? `Logins: ${Object.keys(USERS).join(', ')}` : 'No login set (fine for this machine only).');
  });
  const shutdown = () => { server.close(); setTimeout(() => process.exit(0), writing || pending ? 500 : 0); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
module.exports = { server, validate, deepMerge };
