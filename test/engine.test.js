'use strict';
const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/engine.js');

function project(over = {}) {
  const p = E.newProject('Test');
  p.start = '2026-11-16';
  Object.assign(p, over);
  return p;
}

test('a default project with no target date gets an estimated end date', () => {
  const p = project();
  assert.strictEqual(p.end, '');
  const A = E.analyse(p);
  assert.ok(A.finish.likely.date, 'likely finish date');
  assert.ok(A.finish.best.date <= A.finish.likely.date);
  assert.ok(A.finish.likely.date <= A.finish.worst.date);
  assert.deepStrictEqual(A.missing, []);
});

test('reports work in scope that nobody on the team does', () => {
  const p = project();
  p.team[0].activity = 'Automation';
  const A = E.analyse(p);
  assert.deepStrictEqual(A.missing, ['manual']);
  assert.strictEqual(A.finish.likely.date, null);
});

test('effort scales with test-case count', () => {
  const p = project();
  const a = E.effort(p).variable;
  p.modules[0].tcs *= 2;
  const b = E.effort(p).variable;
  assert.ok(Math.abs(b - 2 * a) < 1e-6);
});

test('contingency is applied to the total', () => {
  const p = project();
  const e = E.effort(p);
  assert.ok(Math.abs(e.total - e.base * (1 + p.a.contingencyPct / 100)) < 1e-6);
});

test('holidays and leave reduce capacity', () => {
  const p = project({ end: '2026-12-31' });
  const base = E.capacityIn(p, p.team, p.start, p.end).total;
  p.team[0].leaves.push({ from: '2026-12-01', to: '2026-12-05' });
  const withLeave = E.capacityIn(p, p.team, p.start, p.end).total;
  assert.ok(withLeave < base);
});

test('a short window needs extra people and is not feasible', () => {
  const p = project({ end: '2027-01-15' });
  const A = E.analyse(p);
  assert.strictEqual(A.status, 'no');
  assert.ok(A.need.extra > 0);
  assert.ok(A.scope.f < 1);
});

test('a long window is feasible with the current team', () => {
  const p = project({ end: '2028-12-31' });
  const A = E.analyse(p);
  assert.strictEqual(A.status, 'ok');
  assert.strictEqual(A.need.extra, 0);
});

/* ---------- scheduler ---------- */
function exampleTeam(p) {
  const r = (name, o) => Object.assign(E.newResource(), { name }, o);
  p.team = [
    r('Lead', { role: 'Lead', activity: 'Both', level: 'Expert' }),
    r('Auto A', { activity: 'Automation', level: 'Senior' }),
    r('Auto B', { activity: 'Automation', level: 'Mid' }),
    r('Manual A', { activity: 'Manual', level: 'Mid' })
  ];
  return p;
}

test('the schedule does all the estimated work', () => {
  const p = exampleTeam(project());
  const s = E.schedule(p);
  assert.ok(s.finish);
  assert.ok(Math.abs(s.work - E.effort(p).total) < 0.01, `${s.work} vs ${E.effort(p).total}`);
});

test('framework core, then common methods, then scripting', () => {
  const p = exampleTeam(project());
  const s = E.schedule(p);
  const first = cat => Object.values(s.rows).find(r => r.cat === cat).first;
  assert.ok(first('common') >= s.ms.fwCore.date, 'common methods start after framework core');
  assert.ok(first('script') >= s.ms.commonDone.date, 'scripting starts after common methods');
  assert.ok(first('script') > p.start);
});

test('CI/CD runs alongside and regression runs wait for it', () => {
  const p = exampleTeam(project());
  p.a.oneTime.find(o => o.id === 'ot4').hours = 400; // a long pipeline job
  const s = E.schedule(p);
  const first = cat => Object.values(s.rows).find(r => r.cat === cat).first;
  assert.ok(first('script') < s.ms.cicdDone.date, 'scripting does not wait for CI/CD');
  assert.ok(first('runs') >= s.ms.cicdDone.date, 'regression runs wait for CI/CD');
});

test('an existing framework or pipeline reduces effort', () => {
  const p = project();
  const base = E.effort(p);
  p.a.frameworkStatus = 'extend';
  const ext = E.effort(p);
  assert.ok(Math.abs(ext.lines.otFramework - base.lines.otFramework * 0.4) < 1e-6);
  assert.ok(Math.abs(ext.lines.otCommon - base.lines.otCommon * 0.6) < 1e-6);
  p.a.frameworkStatus = 'reuse'; p.a.cicdExists = true;
  const re = E.effort(p);
  assert.ok(re.total < ext.total);
  assert.ok(Math.abs(re.lines.otCicd - base.lines.otCicd * 0.25) < 1e-6);
});

test('common methods grow with automated modules', () => {
  const p = project();
  const one = E.effort(p).lines.otCommon;
  p.modules.push(E.newModule('Second', 2));
  assert.strictEqual(E.effort(p).lines.otCommon, one + p.a.commonPerModule);
});

test('no automation means no framework, common methods or CI/CD', () => {
  const p = project();
  p.modules[0].automation = false;
  const L = E.effort(p).lines;
  assert.strictEqual(L.otFramework + L.otCommon + L.otCicd, 0);
});

test('a module is not worked on before it is available', () => {
  const p = exampleTeam(project());
  p.modules.push(Object.assign(E.newModule('Later', 2), { availableFrom: '2027-02-01' }));
  const s = E.schedule(p);
  const id = p.modules[1].id;
  Object.values(s.rows).filter(r => r.mod === id).forEach(r => assert.ok(r.first >= '2027-02-01', r.key + ' ' + r.first));
});

test('a longer client review delays the finish', () => {
  const p = exampleTeam(project());
  const a = E.schedule(p, { record: false }).finish;
  p.a.reviewDays = 20;
  const b = E.schedule(p, { record: false }).finish;
  assert.ok(b > a);
});

test('a higher framework gate starts scripting later', () => {
  const p = exampleTeam(project());
  const first = () => Object.values(E.schedule(p).rows).find(r => r.cat === 'script').first;
  p.a.frameworkGatePct = 20; const early = first();
  p.a.frameworkGatePct = 100; const late = first();
  assert.ok(late > early);
});

test('old saved projects are migrated', () => {
  const p = project();
  p.a.oneTime.forEach(o => { o.pool = o.phase === 'framework' ? 'auto' : 'common'; delete o.phase; });
  delete p.a.reviewDays; p.modules.forEach(m => { delete m.priority; delete m.availableFrom; });
  E.migrate(p);
  delete p.a.v13; p.a.oneTime = p.a.oneTime.filter(o => o.id !== 'ot9');
  p.a.oneTime.filter(o => o.id === 'ot4' || o.id === 'ot5').forEach(o => { o.pool = 'auto'; });
  E.migrate(p);
  assert.strictEqual(p.a.oneTime.find(o => o.id === 'ot3').phase, 'framework');
  assert.strictEqual(p.a.oneTime.find(o => o.id === 'ot4').phase, 'cicd');
  assert.ok(p.a.oneTime.some(o => o.phase === 'common'), 'common methods added');
  assert.strictEqual(p.a.oneTime.find(o => o.id === 'ot8').phase, 'end');
  assert.strictEqual(p.a.reviewDays, 3);
  assert.strictEqual(p.modules[0].priority, 1);
});
