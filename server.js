#!/usr/bin/env node
/*
 * Test Effort Estimator - self-hosted server
 * No dependencies: needs Node.js 18 or later.
 *
 * Environment variables (all optional):
 *   PORT        Port to listen on (default 3000)
 *   HOST        Interface to bind (default 0.0.0.0, i.e. reachable on your network)
 *   DATA_DIR    Folder for saved data (default ./data)
 *   BASIC_AUTH  "user:password" to require a login for the page and the API
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC = path.join(__dirname, 'public');
const AUTH = process.env.BASIC_AUTH || '';
const MAX_BODY = 5 * 1024 * 1024;

/* ---------- storage: one JSON file, map of document path -> body ---------- */
fs.mkdirSync(DATA_DIR, { recursive: true });
let db = {};
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) {
  if (e.code !== 'ENOENT') { console.error('Could not read ' + DB_FILE + ': ' + e.message); process.exit(1); }
}
let writing = false, pending = false;
function persist() {
  if (writing) { pending = true; return; }
  writing = true;
  const tmp = DB_FILE + '.tmp';
  fs.writeFile(tmp, JSON.stringify(db), err => {
    if (err) { console.error('Save failed:', err.message); writing = false; return; }
    fs.rename(tmp, DB_FILE, err2 => {
      if (err2) console.error('Save failed:', err2.message);
      writing = false;
      if (pending) { pending = false; persist(); }
    });
  });
}
// daily backup, keeps the last 14
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

/* ---------- http ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function authorised(req) {
  if (!AUTH) return true;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const given = Buffer.from(Buffer.from(h.slice(6), 'base64').toString()), want = Buffer.from(AUTH);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (!authorised(req)) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Test Effort Estimator"' }); return res.end('Login required'); }
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  try {
    if (p.startsWith('/api/doc/')) {
      const key = parsePath(p.slice(9), true);
      if (!key) return send(res, 400, { code: 'invalid_argument', message: 'Bad document path' });
      if (req.method === 'GET') return db[key] ? send(res, 200, { id: key.split('/').pop(), data: db[key] }) : send(res, 404, { code: 'not_found' });
      if (req.method === 'PUT') {
        let body; try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, e.message === 'too_large' ? 413 : 400, { code: 'invalid_argument', message: 'Body must be a JSON object under 5 MB' }); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { code: 'invalid_argument', message: 'Body must be a JSON object' });
        db[key] = body; persist(); return send(res, 200, { ok: true });
      }
      if (req.method === 'DELETE') {
        // deleting a document also removes documents nested under it
        Object.keys(db).forEach(k => { if (k === key || k.startsWith(key + '/')) delete db[k]; });
        persist(); return send(res, 200, { ok: true });
      }
      return send(res, 405, { code: 'invalid_argument' });
    }
    if (p.startsWith('/api/col/')) {
      const col = parsePath(p.slice(9), false);
      if (!col || req.method !== 'GET') return send(res, 400, { code: 'invalid_argument', message: 'Bad collection path' });
      const depth = col.split('/').length + 1;
      const docs = Object.keys(db).filter(k => k.startsWith(col + '/') && k.split('/').length === depth).map(k => ({ id: k.split('/').pop(), data: db[k] }));
      return send(res, 200, { docs });
    }
    if (p === '/api/health') return send(res, 200, { ok: true });
    // static files
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
    const file = path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : p));
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 404, 'Not found', 'text/plain');
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'Not found', 'text/plain');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
  } catch (e) {
    console.error(e); send(res, 500, { code: 'unavailable', message: 'Server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Test Effort Estimator running at http://localhost:${PORT}`);
  console.log(`Data is saved in ${DB_FILE}`);
  if (!AUTH) console.log('No login set. Set BASIC_AUTH=user:password to require one.');
});
function shutdown() { server.close(); if (writing || pending) setTimeout(() => process.exit(0), 500); else process.exit(0); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
