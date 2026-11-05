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
  const t = new Date(), slot = String(Math.floor(t.getUTCHours() / 6) * 6).padStart(2, '0');
  const name = 'db-' + t.toISOString().slice(0, 10) + 'T' + slot + '.json';
  fs.copyFile(DB_FILE, path.join(dir, name), () => {
    const files = fs.readdirSync(dir).filter(f => f.startsWith('db-')).sort();
    files.slice(0, Math.max(0, files.length - 28)).forEach(f => fs.unlink(path.join(dir, f), () => { }));
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
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// Remove keys that could reach Object.prototype, at every level.
function clean(v) {
  if (Array.isArray(v)) return v.map(clean);
  if (!isObj(v)) return v;
  const out = {};
  for (const k of Object.keys(v)) if (!BAD_KEYS.has(k)) out[k] = clean(v[k]);
  return out;
}
const realDate = s => { if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const t = Date.parse(s + 'T00:00:00Z'); return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === s; };
const num = (v, lo, hi) => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;
const optNum = (v, lo, hi) => v == null || v === '' || num(v, lo, hi);
const str = (v, max) => v == null || (typeof v === 'string' && v.length <= max);
// Only these document paths can be written: projects/<id> and projects/<id>/actuals/<week>
function writable(key) {
  const s = key.split('/');
  return (s.length === 2 && s[0] === 'projects') || (s.length === 4 && s[0] === 'projects' && s[2] === 'actuals');
}
function validate(key, body) {
  const segs = key.split('/');
  if (segs.length === 2) {
    if (typeof body.name !== 'string' || body.name.length > 300) return 'Project needs a name (up to 300 characters)';
    const d = body.data;
    if (!isObj(d)) return 'Project needs a data object';
    for (const k of ['modules', 'team', 'holidays']) if (!Array.isArray(d[k])) return `Project data needs a ${k} list`;
    if (!realDate(d.start)) return 'Project start must be a real date (YYYY-MM-DD)';
    if (d.end && !realDate(d.end)) return 'Project end must be a real date (YYYY-MM-DD) or empty';
    if (d.end && d.end < d.start) return 'Project end must be after the start';
    if (!isObj(d.a)) return 'Project data needs its factors';
    if (d.modules.length > 500 || d.team.length > 500 || d.holidays.length > 5000) return 'Too many modules, people or holidays';
    for (const m of d.modules) {
      if (!isObj(m) || typeof m.id !== 'string') return 'Every module needs an id';
      if (!str(m.name, 300)) return 'Module names must be text';
      if (!num(m.tcs, 0, 1e6)) return `Module “${m.name}”: test cases must be a number from 0 to 1,000,000`;
      if (!isObj(m.mix) || Object.values(m.mix).some(v => !optNum(v, 0, 100))) return `Module “${m.name}”: complexity mix must be percentages from 0 to 100`;
      if (!optNum(m.autoPct, 0, 100)) return `Module “${m.name}”: % to automate must be 0 to 100`;
      if (m.availableFrom && !realDate(m.availableFrom)) return `Module “${m.name}”: available-from must be a real date`;
    }
    for (const r of d.team) {
      if (!isObj(r)) return 'Team entries must be objects';
      if (!optNum(r.alloc, 0, 100)) return `${r.name || 'A team member'}: allocation must be 0 to 100%`;
      if ((r.start && !realDate(r.start)) || (r.end && !realDate(r.end))) return `${r.name || 'A team member'}: dates must be real dates`;
      if (r.leaves && (!Array.isArray(r.leaves) || r.leaves.some(l => !isObj(l) || (l.from && !realDate(l.from)) || (l.to && !realDate(l.to))))) return `${r.name || 'A team member'}: leave dates must be real dates`;
    }
    if (d.holidays.some(h => !isObj(h) || !realDate(h.date) || !str(h.name, 200))) return 'Every holiday needs a real date and a name';
  }
  if (segs.length === 4) {
    if (body.week != null && !realDate(body.week)) return 'Week must be a real date (YYYY-MM-DD)';
    if (!optNum(body.hours, 0, 1e6)) return 'Hours must be 0 or more';
    if (body.hoursBy != null && (!isObj(body.hoursBy) || Object.values(body.hoursBy).some(v => !optNum(v, 0, 200)))) return 'Hours per person must be 0 to 200 a week';
    if (!str(body.notes, 20000) || !str(body.blockers, 20000)) return 'Notes are too long';
    if (body.mods != null && !isObj(body.mods)) return 'mods must be an object';
    if (isObj(body.mods)) for (const v of Object.values(body.mods)) {
      if (!isObj(v)) return 'Each module entry must be an object';
      for (const k of ['designed', 'automated', 'executed']) if (!optNum(v[k], 0, 1e6)) return `${k} must be a number of 0 or more`;
    }
    if (body.ot != null && (!isObj(body.ot) || Object.values(body.ot).some(v => !optNum(v, 0, 100)))) return 'Setup and framework progress must be 0 to 100%';
  }
  return null;
}
function deepMerge(target, patch) {
  for (const k of Object.keys(patch)) {
    if (BAD_KEYS.has(k)) continue;
    const v = patch[k];
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
  try { body = clean(JSON.parse(await readBody(req))); }
  catch (e) { send(res, e.message === 'too_large' ? 413 : 400, { code: 'invalid_argument', message: 'Body must be a JSON object under 5 MB' }); return null; }
  if (!isObj(body)) { send(res, 400, { code: 'invalid_argument', message: 'Body must be a JSON object' }); return null; }
  return body;
}

const server = http.createServer(async (req, res) => {
  // Without logins the server only serves this machine; also refuse other Host names (DNS rebinding).
  if (!AUTH_ON) {
    const host = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) { res.writeHead(403, SEC); return res.end('Forbidden host'); }
  }
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
      if (req.method !== 'GET' && !writable(key)) return send(res, 403, { code: 'invalid_argument', message: 'Only projects and their weekly actuals can be saved' });
      if (req.method === 'PUT') {
        const body = await jsonBody(req, res); if (!body) return;
        // create-only: never replace a document someone else already created
        const createOnly = body.createOnly === true; delete body.createOnly;
        if (createOnly && db[key]) return send(res, 409, { code: 'exists', message: 'Already exists', current: db[key] });
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
module.exports = { server, validate, deepMerge, clean };
