'use strict';
/* Browser tests (Playwright). Run with: npm run test:ui
 * Needs Playwright with Chromium installed: npm i -D playwright && npx playwright install chromium */
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { }
const opts = { skip: chromium ? false : 'Playwright is not installed' };
const SERVER = path.join(__dirname, '..', 'server.js');
let port = 39600 + Math.floor(Math.random() * 300);

async function startServer(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tee-ui-'));
  const p = ++port;
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(p), DATA_DIR: dir, HOST: '127.0.0.1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((res, rej) => { child.stdout.on('data', d => { if (String(d).includes('running at')) res(); }); child.on('exit', c => rej(new Error('exit ' + c))); });
  return { base: `http://localhost:${p}`, stop: () => child.kill() };
}
async function page(browser, base, errs, headers) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, extraHTTPHeaders: headers });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(base + '/');
  await pg.waitForTimeout(800);
  return pg;
}
const settle = pg => pg.waitForTimeout(1500);
// Projects in these tests started four weeks ago, so weeks can be logged.
async function openExample(pg) {
  await pg.click('text=Open an example project'); await settle(pg);
  await pg.evaluate(() => { S.P.start = E.addDays(E.mondayOf(E.toS(Date.now())), -28); S.P.end = E.addDays(S.P.start, 7 * 29 - 3); touch(); });
  await settle(pg); await pg.waitForTimeout(1000);
}
const api = async (base, p) => (await fetch(base + p)).json();

test('every tab renders the example without errors or broken values', opts, async () => {
  const srv = await startServer(), browser = await chromium.launch(), errs = [];
  try {
    const A = await page(browser, srv.base, errs);
    await openExample(A);
    for (const tab of ['summary', 'schedule', 'scope', 'team', 'calendar', 'factors', 'tracking']) {
      await A.click(`[data-tab=${tab}]`); await A.waitForTimeout(400);
      const text = await A.innerText('#main');
      assert.ok(!/\bundefined\b|\bNaN\b|Invalid Date/.test(text), `${tab} shows a broken value`);
    }
    assert.deepStrictEqual(errs, []);
  } finally { await browser.close(); srv.stop(); }
});

test('two people editing different fields are merged; the same field asks', opts, async () => {
  const srv = await startServer(), browser = await chromium.launch(), errs = [];
  try {
    const A = await page(browser, srv.base, errs);
    await openExample(A);
    const B = await page(browser, srv.base, errs); await settle(B);
    await A.click('[data-tab=scope]'); await B.click('[data-tab=scope]');
    await A.fill('#f-modules-0-tcs', '310'); await B.fill('#f-modules-1-tcs', '170');
    await A.press('#f-modules-0-tcs', 'Tab'); await B.press('#f-modules-1-tcs', 'Tab');
    await settle(A); await settle(B); await A.waitForTimeout(4500); await settle(A);
    let doc = (await api(srv.base, '/api/col/projects')).docs[0].data.data;
    assert.strictEqual(doc.modules[0].tcs, 310, 'A’s change kept');
    assert.strictEqual(doc.modules[1].tcs, 170, 'B’s change kept');
    assert.ok(!(await A.$('.banner.conflict')) && !(await B.$('.banner.conflict')), 'no prompt for different fields');
    // same field
    await A.reload(); await B.reload(); await settle(A); await settle(B);
    await A.click('[data-tab=scope]'); await B.click('[data-tab=scope]');
    await A.fill('#f-modules-0-tcs', '400'); await B.fill('#f-modules-0-tcs', '450');
    await A.press('#f-modules-0-tcs', 'Tab'); await B.press('#f-modules-0-tcs', 'Tab');
    await settle(A); await settle(B); await A.waitForTimeout(4500);
    const loser = (await A.$('.banner.conflict')) ? A : B;
    assert.ok(await loser.$('.banner.conflict'), 'the second saver is asked');
    await loser.click('[data-act=conflict-use-mine]'); await settle(loser);
    doc = (await api(srv.base, '/api/col/projects')).docs[0].data.data;
    assert.strictEqual(doc.modules[0].tcs, loser === A ? 400 : 450);
    assert.strictEqual(doc.modules[1].tcs, 170, 'unrelated field untouched');
    assert.deepStrictEqual(errs, []);
  } finally { await browser.close(); srv.stop(); }
});

test('weekly actuals: modules merge, a stale "Log next week" never wipes a week, same field asks', opts, async () => {
  const srv = await startServer(), browser = await chromium.launch(), errs = [];
  try {
    const A = await page(browser, srv.base, errs);
    await openExample(A);
    const B = await page(browser, srv.base, errs); await settle(B);
    await A.click('[data-tab=tracking]'); await B.click('[data-tab=tracking]');
    await A.click('[data-act=add-week]'); await settle(A);
    const wk = await A.evaluate(() => S.trWeek), ids = await A.evaluate(() => S.P.modules.map(m => m.id));
    await A.fill(`#ac-${wk}-${ids[0]}-designed`, '30'); await A.press(`#ac-${wk}-${ids[0]}-designed`, 'Tab'); await settle(A);
    // B hasn't seen the new week yet and clicks "Log next week"
    await B.evaluate(() => { S.actuals = []; });
    await B.click('[data-act=add-week]'); await settle(B);
    const pid = (await api(srv.base, '/api/col/projects')).docs[0].id;
    let wkDoc = (await api(srv.base, `/api/doc/projects/${pid}/actuals/${wk}`)).data;
    assert.strictEqual(wkDoc.mods[ids[0]].designed, 30, 'the logged week survives');
    await B.waitForTimeout(4500);
    await B.fill(`#ac-${wk}-${ids[1]}-designed`, '12'); await B.press(`#ac-${wk}-${ids[1]}-designed`, 'Tab'); await settle(B);
    wkDoc = (await api(srv.base, `/api/doc/projects/${pid}/actuals/${wk}`)).data;
    assert.strictEqual(wkDoc.mods[ids[0]].designed, 30); assert.strictEqual(wkDoc.mods[ids[1]].designed, 12);
    // same text field
    await A.fill(`#ac-${wk}-notes`, 'From A'); await A.press(`#ac-${wk}-notes`, 'Tab'); await settle(A);
    await B.fill(`#ac-${wk}-notes`, 'From B'); await B.press(`#ac-${wk}-notes`, 'Tab'); await settle(B);
    assert.ok(await B.$('[data-act=fc-both]'), 'B is asked before overwriting A’s note');
    await B.click('[data-act=fc-both]'); await settle(B);
    wkDoc = (await api(srv.base, `/api/doc/projects/${pid}/actuals/${wk}`)).data;
    assert.strictEqual(wkDoc.notes, 'From A\nFrom B');
    assert.deepStrictEqual(errs, []);
  } finally { await browser.close(); srv.stop(); }
});

test('an edited email cannot be copied once its numbers change', opts, async () => {
  const srv = await startServer(), browser = await chromium.launch(), errs = [];
  try {
    const A = await page(browser, srv.base, errs);
    await openExample(A);
    await A.click('[data-tab=tracking]'); await A.click('[data-act=add-week]'); await settle(A);
    const wk = await A.evaluate(() => S.trWeek), ids = await A.evaluate(() => S.P.modules.map(m => m.id));
    await A.click('#mail-preview'); await A.keyboard.press('End'); await A.keyboard.type(' edited');
    await A.fill(`#ac-${wk}-${ids[0]}-designed`, '20'); await A.press(`#ac-${wk}-${ids[0]}-designed`, 'Tab'); await settle(A);
    assert.ok(await A.$eval('[data-act=mail-copy]', b => b.disabled));
    const text = await A.innerText('#mail-preview');
    assert.ok(!/undefined|NaN/.test(text));
    assert.deepStrictEqual(errs, []);
  } finally { await browser.close(); srv.stop(); }
});

test('two people editing different rows of a factor table: no crash, both kept', opts, async () => {
  const srv = await startServer(), browser = await chromium.launch(), errs = [];
  try {
    const A = await page(browser, srv.base, errs);
    await openExample(A);
    const B = await page(browser, srv.base, errs); await settle(B);
    await A.click('[data-tab=factors]'); await B.click('[data-tab=factors]');
    await A.fill('#f-a-complexity-0-auto', '4'); await B.fill('#f-a-complexity-2-auto', '15');
    await A.press('#f-a-complexity-0-auto', 'Tab'); await B.press('#f-a-complexity-2-auto', 'Tab');
    await settle(A); await settle(B); await A.waitForTimeout(4500); await settle(A); await settle(B);
    const d = (await api(srv.base, '/api/col/projects')).docs[0].data.data;
    assert.strictEqual(d.a.complexity[0].auto, 4); assert.strictEqual(d.a.complexity[2].auto, 15);
    assert.ok(await B.$('[data-tab=summary]'), 'page still works');
    await B.click('[data-tab=summary]'); await B.waitForTimeout(800);
    assert.ok((await B.innerText('#main')).length > 100);
    assert.deepStrictEqual(errs, []);
  } finally { await browser.close(); srv.stop(); }
});

test('a project deleted while someone edits it is not brought back silently; undo restores it', opts, async () => {
  const srv = await startServer(), browser = await chromium.launch(), errs = [];
  try {
    const A = await page(browser, srv.base, errs);
    await openExample(A);
    const B = await page(browser, srv.base, errs); await settle(B);
    // A is mid-edit when B deletes the project
    await A.click('[data-tab=scope]'); await A.fill('#f-modules-0-tcs', '333');
    await B.click('[data-act=del]'); await B.click('[data-act=del-yes]');
    await A.press('#f-modules-0-tcs', 'Tab'); await settle(A); await A.waitForTimeout(4500);
    assert.ok(await A.$('[data-act=restore-mine]'), 'A is told the project was deleted');
    let docs = (await api(srv.base, '/api/col/projects')).docs;
    assert.ok(docs[0].data.deletedAt, 'still deleted');
    await B.click('#toast [data-act=restore-project]'); await settle(B);
    docs = (await api(srv.base, '/api/col/projects')).docs;
    assert.ok(!docs[0].data.deletedAt, 'undo restored it');
    assert.deepStrictEqual(errs, []);
  } finally { await browser.close(); srv.stop(); }
});

test('removing a week asks first and can be undone', opts, async () => {
  const srv = await startServer(), browser = await chromium.launch(), errs = [];
  try {
    const A = await page(browser, srv.base, errs);
    await openExample(A);
    await A.click('[data-tab=tracking]'); await A.click('[data-act=add-week]'); await settle(A);
    await A.click('[data-act=rm-ac-ask]'); await A.waitForTimeout(300);
    assert.ok(await A.$('[data-act=rm-ac]'), 'asks before removing');
    await A.click('[data-act=rm-ac]'); await settle(A);
    assert.strictEqual(await A.evaluate(() => liveActuals().length), 0);
    await A.click('#toast [data-act=restore-week]'); await settle(A);
    assert.strictEqual(await A.evaluate(() => liveActuals().length), 1);
    assert.deepStrictEqual(errs, []);
  } finally { await browser.close(); srv.stop(); }
});

test('a viewer can look and try what-ifs, but nothing is saved', opts, async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tee-users-')), 'users.json');
  fs.writeFileSync(f, JSON.stringify({ 'CORP\\ed': {}, 'CORP\\vic': { role: 'viewer' } }));
  const srv = await startServer({ USERS_FILE: f, AUTH_HEADER: 'X-Remote-User' }), browser = await chromium.launch(), errs = [];
  try {
    const A = await page(browser, srv.base, errs, { 'X-Remote-User': 'CORP\\ed' });
    await openExample(A);
    const before = (await (await fetch(srv.base + '/api/col/projects', { headers: { 'X-Remote-User': 'CORP\\ed' } })).json()).docs[0].data.data.modules[0].tcs;
    const V = await page(browser, srv.base, errs, { 'X-Remote-User': 'CORP\\vic' }); await settle(V);
    assert.ok((await V.innerText('body')).includes('view-only access'));
    assert.ok(!(await V.$('[data-act=del]')) && !(await V.$('header [data-act=new]')), 'no delete or new buttons');
    await V.click('[data-tab=scope]'); await V.fill('#f-modules-0-tcs', '999'); await V.press('#f-modules-0-tcs', 'Tab'); await settle(V);
    assert.ok((await V.innerText('#save')).includes('View only'));
    const after = (await (await fetch(srv.base + '/api/col/projects', { headers: { 'X-Remote-User': 'CORP\\ed' } })).json()).docs[0].data.data.modules[0].tcs;
    assert.strictEqual(after, before, 'viewer change not saved');
    assert.deepStrictEqual(errs, []);
  } finally { await browser.close(); srv.stop(); }
});

test('Fine tune moves the estimate live, syncs the factor table, and resets', opts, async () => {
  const srv = await startServer(), browser = await chromium.launch(), errs = [];
  try {
    const A = await page(browser, srv.base, errs);
    await openExample(A);
    await A.click('[data-tab=factors]'); await A.waitForTimeout(400);
    const tables = await A.$eval('#f-a-reviewPct', el => +el.value);
    await A.click('[data-act=factors-mode][data-k=tune]'); await A.waitForTimeout(600);
    const before = await A.innerText('#ft-summary');
    const target = tables < 60 ? 60 : Math.max(0, tables - 10);
    await A.$eval('#ft-a-reviewPct', (el, v) => {
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, target);
    await A.waitForTimeout(1400);
    const after = await A.innerText('#ft-summary');
    assert.notStrictEqual(after, before, 'summary follows the slider');
    assert.ok(await A.$('#ft-a-reviewPct'), 'slider is not rebuilt mid-drag');
    assert.strictEqual(await A.$eval('#ft-a-reviewPct', el => +el.value), target);
    await A.click('[data-act=factors-mode][data-k=tables]'); await A.waitForTimeout(400);
    assert.strictEqual(await A.$eval('#f-a-reviewPct', el => +el.value), target, 'factor table has the tuned value');
    await A.click('[data-act=factors-mode][data-k=tune]'); await A.waitForTimeout(500);
    await A.$eval('#ft-a-reviewPct', el => {
      el.value = String(Math.max(+el.min, +el.value - 5));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await A.waitForTimeout(900);
    await A.click('[data-act=tune-reset-start]'); await A.waitForTimeout(600);
    assert.strictEqual(await A.$eval('#ft-a-reviewPct', el => +el.value), target, 'reset returns to the value when Fine tune opened');
    assert.deepStrictEqual(errs, []);
  } finally { await browser.close(); srv.stop(); }
});
