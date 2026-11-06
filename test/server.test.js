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
const project = (name, rev) => ({ name, rev, data: { name, start: '2026-11-16', end: '', modules: [{ id: 'm1', name: 'M', tcs: 10, mix: { S: 100 } }], team: [], holidays: [], a: {} } });
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
    await req(s.base, 'PUT', '/api/doc/projects/p', project('P', 'r1'));
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

test('prototype keys cannot crash or poison the server', async () => {
  const s = start({ BASIC_AUTH: 'alice:pw1' }); await s.ready;
  const auth = { Authorization: 'Basic ' + Buffer.from('alice:pw1').toString('base64') };
  try {
    await req(s.base, 'PUT', '/api/doc/projects/p', project('P', 'r1'), auth);
    await req(s.base, 'PUT', '/api/doc/projects/p/actuals/2026-11-16', { week: '2026-11-16', mods: {} }, auth);
    const raw = (method, body) => fetch(s.base + '/api/doc/projects/p/actuals/2026-11-16', { method, headers: { 'Content-Type': 'application/json', ...auth }, body });
    await raw('PATCH', '{"__proto__":{"hasOwnProperty":1,"rev":"x"}}');
    await raw('PATCH', '{"mods":{"__proto__":{"polluted":1}},"constructor":{"prototype":{"bad":1}}}');
    await raw('PUT', '{"week":"2026-11-16","__proto__":{"isAdmin":true}}');
    const r = await req(s.base, 'GET', '/api/health', null, auth);
    assert.strictEqual(r.status, 200, 'server still up');
    const r2 = await req(s.base, 'PUT', '/api/doc/projects/p2', project('A', 'r1'), auth);
    assert.strictEqual(r2.status, 200, 'unrelated saves are unaffected');
  } finally { s.stop(); }
});

test('strict validation: impossible dates, negative counts, bad mixes, other collections', async () => {
  const s = start({}); await s.ready;
  try {
    const bad = async (url, body) => (await req(s.base, 'PUT', url, body)).status;
    const P = project('A', 'r1');
    await req(s.base, 'PUT', '/api/doc/projects/x', P);
    assert.strictEqual(await bad('/api/doc/projects/x', { ...P, data: { ...P.data, start: '2026-13-45' } }), 400);
    assert.strictEqual(await bad('/api/doc/projects/x', { ...P, data: { ...P.data, modules: [{ id: 'm', tcs: -500, mix: {} }] } }), 400);
    assert.strictEqual(await bad('/api/doc/projects/x', { ...P, data: { ...P.data, modules: [{ id: 'm', tcs: 5, mix: { S: 'bad' } }] } }), 400);
    assert.strictEqual(await bad('/api/doc/projects/x', { ...P, data: { ...P.data, team: [{ alloc: 500 }] } }), 400);
    assert.strictEqual(await bad('/api/doc/projects/x/actuals/w', { week: '2026-11-16', hours: -3 }), 400);
    assert.strictEqual(await bad('/api/doc/junk/j1', { a: 1 }), 403);
    assert.strictEqual(await bad('/api/doc/projects/x', P), 200);
  } finally { s.stop(); }
});

test('create-only never replaces an existing week', async () => {
  const s = start({}); await s.ready;
  try {
    await req(s.base, 'PUT', '/api/doc/projects/p', project('P', 'r1'));
    let r = await req(s.base, 'PUT', '/api/doc/projects/p/actuals/2026-11-16', { week: '2026-11-16', mods: { m: { designed: 30 } }, createOnly: true });
    assert.strictEqual(r.status, 200);
    r = await req(s.base, 'PUT', '/api/doc/projects/p/actuals/2026-11-16', { week: '2026-11-16', mods: {}, createOnly: true });
    assert.strictEqual(r.status, 409);
    const d = await (await req(s.base, 'GET', '/api/doc/projects/p/actuals/2026-11-16')).json();
    assert.strictEqual(d.data.mods.m.designed, 30);
  } finally { s.stop(); }
});

test('without logins, requests for other host names are refused', async () => {
  const s = start({}); await s.ready;
  try {
    const http = require('node:http');
    const status = await new Promise(res => http.get(s.base + '/api/health', { headers: { Host: 'evil.example.com' } }, r => res(r.statusCode)));
    assert.strictEqual(status, 403);
  } finally { s.stop(); }
});

test('a deleted project cannot be brought back by an old save, only restored on purpose', async () => {
  const s = start({}); await s.ready;
  try {
    await req(s.base, 'PUT', '/api/doc/projects/p', project('P', 'r1'));
    await req(s.base, 'PUT', '/api/doc/projects/p/actuals/2026-11-16', { week: '2026-11-16', mods: { m1: { designed: 5 } } });
    let r = await req(s.base, 'PATCH', '/api/doc/projects/p', { deletedAt: Date.now() });
    assert.strictEqual(r.status, 200);
    r = await req(s.base, 'PUT', '/api/doc/projects/p', { ...project('P edited', 'r2'), prevRev: 'r1' });
    assert.strictEqual(r.status, 410, 'stale save of a deleted project is refused');
    r = await req(s.base, 'PATCH', '/api/doc/projects/p/actuals/2026-11-16', { notes: 'x' });
    assert.strictEqual(r.status, 410, 'its actuals are frozen too');
    r = await req(s.base, 'PATCH', '/api/doc/projects/p', { deletedAt: null });
    assert.strictEqual(r.status, 200, 'restored on purpose');
    const a = await (await req(s.base, 'GET', '/api/doc/projects/p/actuals/2026-11-16')).json();
    assert.strictEqual(a.data.mods.m1.designed, 5, 'weekly actuals come back with it');
    const h = await (await req(s.base, 'GET', '/api/history/projects/p')).json();
    assert.ok(h.history.some(x => x.op === 'DELETE') && h.history.some(x => x.op === 'RESTORE'));
  } finally { s.stop(); }
});

test('bad factor settings are refused', async () => {
  const s = start({}); await s.ready;
  try {
    const P = project('A', 'r1');
    const bad = async a => (await req(s.base, 'PUT', '/api/doc/projects/x', { ...P, data: { ...P.data, a } })).status;
    assert.strictEqual(await bad({ complexity: 'oops' }), 400);
    assert.strictEqual(await bad({ hoursPerDay: -8 }), 400);
    assert.strictEqual(await bad({ complexity: [{ key: 'S', name: 'S', design: 1, exec: 1, auto: 'x' }] }), 400);
    assert.strictEqual(await bad({ workDays: [9] }), 400);
    assert.strictEqual(await bad({ hoursPerDay: 8, workDays: [1, 2, 3, 4, 5] }), 200);
  } finally { s.stop(); }
});

test('repeated wrong passwords are throttled', async () => {
  const s = start({ BASIC_AUTH: 'alice:pw1' }); await s.ready;
  try {
    const wrong = { Authorization: 'Basic ' + Buffer.from('alice:nope').toString('base64') };
    for (let i = 0; i < 10; i++) await req(s.base, 'GET', '/api/health', null, wrong);
    const r = await req(s.base, 'GET', '/api/health', null, { Authorization: 'Basic ' + Buffer.from('alice:pw1').toString('base64') });
    assert.strictEqual(r.status, 429);
  } finally { s.stop(); }
});

test('without logins, a proxy in front is refused', async () => {
  const s = start({}); await s.ready;
  try {
    const r = await req(s.base, 'GET', '/api/health', null, { 'X-Forwarded-For': '10.0.0.5' });
    assert.strictEqual(r.status, 403);
  } finally { s.stop(); }
});

test('an old db.json is moved into the database on first start', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tee-mig-'));
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ 'projects/old': project('Old project', 'r1') }));
  const p = ++port;
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(p), DATA_DIR: dir, HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise(res => child.stdout.on('data', d => { if (String(d).includes('running at')) res(); }));
  try {
    const d = await (await fetch(`http://127.0.0.1:${p}/api/doc/projects/old`)).json();
    assert.strictEqual(d.data.name, 'Old project');
    assert.ok(fs.existsSync(path.join(dir, 'db.json.migrated')));
  } finally { child.kill(); }
});

function usersFile(obj) { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tee-users-')), 'users.json'); fs.writeFileSync(f, JSON.stringify(obj)); return f; }
const basic = (u, p) => ({ Authorization: 'Basic ' + Buffer.from(u + ':' + p).toString('base64') });

test('Windows sign-in through a trusted front end, with roles', async () => {
  const f = usersFile({ 'CORP\\jay': { role: 'admin' }, 'CORP\\ed': {}, 'CORP\\vic': { role: 'viewer' }, alice: 'pw' });
  const s = start({ USERS_FILE: f, AUTH_HEADER: 'X-Remote-User' }); await s.ready;
  const as = u => ({ 'X-Remote-User': u });
  try {
    let me = await (await req(s.base, 'GET', '/api/me', null, as('corp\\JAY'))).json();
    assert.deepStrictEqual([me.user, me.role], ['CORP\\jay', 'admin'], 'names match case-insensitively');
    assert.strictEqual((await req(s.base, 'PUT', '/api/doc/projects/p1', project('A', 'r1'), as('CORP\\ed'))).status, 200, 'editor saves');
    const r = await req(s.base, 'PATCH', '/api/doc/projects/p1', { name: 'X' }, as('CORP\\vic'));
    assert.strictEqual(r.status, 403); assert.strictEqual((await r.json()).code, 'view_only');
    assert.strictEqual((await req(s.base, 'GET', '/api/col/projects', null, as('CORP\\vic'))).status, 200, 'viewer reads');
    assert.strictEqual((await req(s.base, 'DELETE', '/api/doc/projects/p1', null, as('CORP\\ed'))).status, 403, 'editor cannot purge');
    assert.strictEqual((await req(s.base, 'GET', '/', null, as('CORP\\stranger'))).status, 403, 'unlisted Windows user refused');
    assert.strictEqual((await req(s.base, 'GET', '/api/me', null, as('alice'))).status, 403, 'a password user cannot be claimed through the header');
    assert.strictEqual((await req(s.base, 'GET', '/api/me', null, basic('alice', 'pw'))).status, 200, 'password login still works');
    assert.strictEqual((await req(s.base, 'GET', '/api/me', null, basic('CORP\\jay', ''))).status, 401, 'Windows users have no password login');
    assert.strictEqual((await req(s.base, 'DELETE', '/api/doc/projects/p1', null, as('CORP\\jay'))).status, 200, 'admin can purge');
    assert.ok(fs.readFileSync(path.join(s.dir, 'audit.log'), 'utf8').includes('"DENIED"'));
  } finally { s.stop(); }
});

test('the sign-in header is ignored from addresses that are not the trusted front end; * lets anyone signed in view', async () => {
  const f = usersFile({ 'CORP\\jay': { role: 'admin' }, '*': { role: 'viewer' } });
  let s = start({ USERS_FILE: f, AUTH_HEADER: 'X-Remote-User', TRUSTED_PROXY: '10.9.9.9' }); await s.ready;
  try { assert.strictEqual((await req(s.base, 'GET', '/api/me', null, { 'X-Remote-User': 'CORP\\jay' })).status, 401); }
  finally { s.stop(); }
  s = start({ USERS_FILE: f, AUTH_HEADER: 'X-Remote-User' }); await s.ready;
  try {
    const me = await (await req(s.base, 'GET', '/api/me', null, { 'X-Remote-User': 'CORP\\newjoiner' })).json();
    assert.deepStrictEqual([me.user, me.role], ['CORP\\newjoiner', 'viewer']);
  } finally { s.stop(); }
});

test('a bad role in the users file stops the server with a clear message', async () => {
  const s = start({ USERS_FILE: usersFile({ bob: { password: 'x', role: 'boss' } }) });
  await assert.rejects(s.ready, /role must be viewer, editor or admin/);
});

test('the tool name is set per organisation and escaped; the default is neutral', async () => {
  let s = start({ BRAND_FILE: '' }); await s.ready;
  try {
    const html = await (await fetch(s.base + '/')).text();
    assert.ok(html.includes('<title>QuEST · Quality Estimation &amp; Scheduling Tool</title>'));
    assert.ok(!html.includes('%%APP_'), 'no placeholders left');
  } finally { s.stop(); }
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tee-brand-')), 'brand.json');
  fs.writeFileSync(f, JSON.stringify({ fullName: 'Acme <Estimation> Tool', tagline: '' }));
  s = start({ BRAND_FILE: f, APP_NAME: 'AcmeQ' }); await s.ready;
  try {
    const html = await (await fetch(s.base + '/')).text();
    assert.ok(html.includes('<title>AcmeQ · Acme &lt;Estimation&gt; Tool</title>'), 'file and variables combine, HTML escaped');
    assert.ok(html.includes('window.BRAND = {"name":"AcmeQ"'));
    assert.ok(html.includes('<span class="mark">A</span>AcmeQ'));
  } finally { s.stop(); }
  fs.writeFileSync(f, JSON.stringify({ name: 'x', colour: 'red' }));
  s = start({ BRAND_FILE: f });
  await assert.rejects(s.ready, /unknown setting "colour"/);
});
