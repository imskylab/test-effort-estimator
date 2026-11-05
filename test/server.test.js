'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'server.js');
let port = 39000 + Math.floor(Math.random() * 500);

function start(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tee-test-'));
  const p = ++port;
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(p), DATA_DIR: dir, HOST: '127.0.0.1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let errText = '';
  child.stderr.on('data', d => { errText += d; });
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', d => { if (String(d).includes('running at')) resolve(); });
    child.on('exit', code => reject(new Error('exited ' + code + ': ' + errText)));
  });
  return { child, dir, base: `http://127.0.0.1:${p}`, ready, stop: () => child.kill() };
}
const project = (name, rev) => ({ name, rev, data: { name, start: '2026-11-16', end: '', modules: [{ id: 'm1' }], team: [], holidays: [], a: {} } });
const req = (base, method, url, body, headers = {}) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });

test('saves, reads, rejects a stale save, merges partial updates', async () => {
  const s = start({}); await s.ready;
  try {
    let r = await req(s.base, 'PUT', '/api/doc/projects/p1', project('A', 'r1'));
    assert.strictEqual(r.status, 200);
    r = await req(s.base, 'PUT', '/api/doc/projects/p1', { ...project('B', 'r2'), prevRev: 'r1' });
    assert.strictEqual(r.status, 200, 'save based on the latest revision is accepted');
    r = await req(s.base, 'PUT', '/api/doc/projects/p1', { ...project('C', 'r3'), prevRev: 'r1' });
    assert.strictEqual(r.status, 409, 'save based on an older revision is rejected');
    const j = await r.json();
    assert.strictEqual(j.current.name, 'B');
    // actuals: two people edit different modules of the same week
    await req(s.base, 'PUT', '/api/doc/projects/p1/actuals/2026-11-16', { week: '2026-11-16', mods: {} });
    await req(s.base, 'PATCH', '/api/doc/projects/p1/actuals/2026-11-16', { mods: { m1: { designed: 11 } } });
    await req(s.base, 'PATCH', '/api/doc/projects/p1/actuals/2026-11-16', { mods: { m2: { designed: 22 } } });
    const a = await (await req(s.base, 'GET', '/api/doc/projects/p1/actuals/2026-11-16')).json();
    assert.deepStrictEqual(a.data.mods, { m1: { designed: 11 }, m2: { designed: 22 } });
  } finally { s.stop(); }
});

test('rejects malformed projects and actuals', async () => {
  const s = start({}); await s.ready;
  try {
    let r = await req(s.base, 'PUT', '/api/doc/projects/bad', { name: 'x', data: { modules: 'nope' } });
    assert.strictEqual(r.status, 400);
    r = await req(s.base, 'PUT', '/api/doc/projects/p/actuals/w', { week: 'yesterday' });
    assert.strictEqual(r.status, 400);
    r = await req(s.base, 'PUT', '/api/doc/projects/p/actuals/w', { week: '2026-11-16', mods: { m1: { designed: -5 } } });
    assert.strictEqual(r.status, 400);
  } finally { s.stop(); }
});

test('collection polling returns 304 when nothing changed', async () => {
  const s = start({}); await s.ready;
  try {
    await req(s.base, 'PUT', '/api/doc/projects/p1', project('A', 'r1'));
    const r1 = await req(s.base, 'GET', '/api/col/projects');
    const etag = r1.headers.get('etag');
    const r2 = await req(s.base, 'GET', '/api/col/projects', null, { 'If-None-Match': etag });
    assert.strictEqual(r2.status, 304);
    await req(s.base, 'PUT', '/api/doc/projects/p2', project('B', 'r1'));
    const r3 = await req(s.base, 'GET', '/api/col/projects', null, { 'If-None-Match': etag });
    assert.strictEqual(r3.status, 200);
  } finally { s.stop(); }
});

test('refuses to share on the network without a login', async () => {
  const s = start({ HOST: '0.0.0.0', BASIC_AUTH: '' });
  await assert.rejects(s.ready, /exited 1/);
});

test('logins are required and every change is attributed', async () => {
  const s = start({ BASIC_AUTH: 'alice:pw1,bob:pw2' }); await s.ready;
  try {
    let r = await req(s.base, 'GET', '/api/col/projects');
    assert.strictEqual(r.status, 401);
    const auth = u => ({ Authorization: 'Basic ' + Buffer.from(u).toString('base64') });
    r = await req(s.base, 'GET', '/api/col/projects', null, auth('alice:wrong'));
    assert.strictEqual(r.status, 401);
    r = await req(s.base, 'PUT', '/api/doc/projects/p1', project('A', 'r1'), auth('bob:pw2'));
    assert.strictEqual(r.status, 200);
    const d = await (await req(s.base, 'GET', '/api/doc/projects/p1', null, auth('alice:pw1'))).json();
    assert.strictEqual(d.data.updatedBy, 'bob');
    await new Promise(res => setTimeout(res, 100));
    const log = fs.readFileSync(path.join(s.dir, 'audit.log'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(log.some(e => e.user === 'bob' && e.method === 'PUT' && e.path === 'projects/p1'));
  } finally { s.stop(); }
});
