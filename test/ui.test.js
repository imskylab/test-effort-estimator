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

async function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tee-ui-'));
  const p = ++port;
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(p), DATA_DIR: dir, HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((res, rej) => { child.stdout.on('data', d => { if (String(d).includes('running at')) res(); }); child.on('exit', c => rej(new Error('exit ' + c))); });
  return { base: `http://localhost:${p}`, stop: () => child.kill() };
}
async function page(browser, base, errs) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(base + '/');
  await pg.waitForTimeout(800);
  return pg;
}
const settle = pg => pg.waitForTimeout(1500);
const api = async (base, p) => (await fetch(base + p)).json();

test('every tab renders the example without errors or broken values', opts, async () => {
  const srv = await startServer(), browser = await chromium.launch(), errs = [];
  try {
    const A = await page(browser, srv.base, errs);
    await A.click('text=Open an example project'); await settle(A);
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
    await A.click('text=Open an example project'); await settle(A);
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
    await A.click('text=Open an example project'); await settle(A);
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
    await A.click('text=Open an example project'); await settle(A);
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
