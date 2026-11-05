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
  p.a.frameworkStatus = 'reuse'; p.a.cicdMode = 'existing';
  const re = E.effort(p);
  assert.ok(re.total < ext.total);
  assert.ok(Math.abs(re.lines.otCicd - base.lines.otCicd * 0.25) < 1e-6);
});

test('CI/CD not needed removes its work and does not hold up regression runs', () => {
  const p = project();
  p.a.cicdMode = 'none';
  assert.strictEqual(E.effort(p).lines.otCicd, 0);
  const s = E.schedule(p);
  assert.ok(!Object.values(s.rows).some(r => r.cat === 'cicd'));
  assert.ok(!s.ms.cicdDone);
  assert.ok(s.finish);
});

test('old CI/CD checkbox is migrated', () => {
  const p = project();
  delete p.a.cicdMode; p.a.cicdExists = true;
  E.migrate(p);
  assert.strictEqual(p.a.cicdMode, 'existing');
  assert.strictEqual(p.a.cicdExists, undefined);
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

/* ---------- tracking and weekly report ---------- */
function trackedProject() {
  const p = exampleTeam(project({ end: '2027-06-30' }));
  p.modules = [Object.assign(E.newModule('Web', 1), { tcs: 200 }), Object.assign(E.newModule('API', 2), { tcs: 100, appType: 'API', manualExec: false })];
  return p;
}

test('module actuals earn at module weights; legacy totals still count', () => {
  const p = trackedProject(); const [w, a] = p.modules.map(m => m.id);
  const T1 = E.tracking(p, [{ week: '2026-11-16', hours: 100, mods: { [w]: { automated: 10 } } }]);
  const T2 = E.tracking(p, [{ week: '2026-11-16', hours: 100, mods: { [a]: { automated: 10 } } }]);
  assert.ok(T1.rows[0].earned > T2.rows[0].earned, 'a web script is worth more than an API script');
  const T3 = E.tracking(p, [{ week: '2026-11-16', hours: 100, designed: 10, automated: 5, executed: 0 }]);
  assert.ok(T3.rows[0].earned > 0);
  assert.strictEqual(T3.rows[0].designed, 10);
});

test('weekly report gives this week, to date, plan and module status', () => {
  const p = trackedProject(); const [w, a] = p.modules.map(m => m.id);
  const acts = [
    { week: '2026-11-16', hours: 120, mods: { [w]: { designed: 20 } } },
    { week: '2026-11-23', hours: 120, mods: { [w]: { designed: 25 }, [a]: { designed: 5 } }, blockers: 'Env down' },
    { week: '2026-11-30', hours: 120, mods: { [w]: { designed: 25, automated: 3 } } }
  ];
  const R = E.weekReport(p, acts, null, '2026-11-23');
  assert.strictEqual(R.weekNo, 2);
  assert.deepStrictEqual(R.totals.week, { designed: 30, automated: 0, executed: 0 });
  assert.strictEqual(R.totals.toDate.designed, 50, 'report ignores later weeks');
  assert.strictEqual(R.mods.find(m => m.id === w).act.designed, 45);
  assert.ok(R.thisPlan && R.nextPlan && R.toPlan);
  assert.ok(['ok', 'risk', 'no'].includes(R.status));
  assert.strictEqual(E.weekReport(p, acts, null, '2027-01-04'), null);
});

test('falling far behind shows as behind with a later forecast', () => {
  const p = trackedProject(); const [w] = p.modules.map(m => m.id);
  const weeks = ['2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21'];
  const acts = weeks.map(week => ({ week, hours: 100, mods: { [w]: { designed: 2 } } }));
  const R = E.weekReport(p, acts, null, weeks[5]);
  assert.strictEqual(R.status, 'no');
  assert.ok(R.forecast > R.plannedFinish);
});

/* ---------- review fixes ---------- */
test('worst case is not stacked on contingency', () => {
  const p = project();
  const e = E.effort(p);
  assert.ok(Math.abs(e.worst - e.base * p.a.pertWorst) < 1e-6);
  assert.ok(Math.abs(e.best - e.base * p.a.pertBest) < 1e-6);
  assert.ok(e.worst < e.total * p.a.pertWorst);
});

test('bad inputs are guarded: negative counts, over 100% allocation, fractional cycles', () => {
  const p = project();
  p.a.manualCycles = 2.4;
  const e = E.effort(p), s = E.schedule(p);
  assert.ok(Math.abs(s.work - e.total) < 0.01, 'scheduled work matches costed work with fractional cycles');
  p.modules[0].tcs = -50;
  assert.strictEqual(E.effort(p).tcs, 0);
  p.modules[0].tcs = 100; p.team[0].alloc = 500;
  const c = E.capacityIn(p, p.team, p.start, '2026-11-20');
  assert.ok(c.ded.gross <= 5 * 8 + 1e-6, 'allocation is capped at 100%');
});

test('setup and framework progress earns credit; actuals above scope do not', () => {
  const p = trackedProject(); const [w] = p.modules.map(m => m.id);
  const none = E.tracking(p, [{ week: '2026-11-16', hours: 100, mods: {} }]);
  const fw = E.tracking(p, [{ week: '2026-11-16', hours: 100, mods: {}, ot: { framework: 50, setup: 100 } }]);
  assert.strictEqual(none.rows[0].earned, 0);
  assert.ok(fw.rows[0].earned > 0 && fw.eff > 0, 'framework weeks show productivity');
  const ok = E.tracking(p, [{ week: '2026-11-16', hours: 100, mods: { [w]: { designed: 200 } } }]);
  const over = E.tracking(p, [{ week: '2026-11-16', hours: 100, mods: { [w]: { designed: 900 } } }]);
  assert.strictEqual(over.rows[0].earned, ok.rows[0].earned, 'only the scope counts');
  const R = E.weekReport(p, [{ week: '2026-11-16', hours: 100, mods: { [w]: { designed: 900 } } }], null, '2026-11-16');
  assert.ok(R.warnings.some(x => /scope/.test(x)));
});

test('a frozen baseline keeps status honest when the plan is edited', () => {
  const p = trackedProject(); const [w] = p.modules.map(m => m.id);
  const weeks = ['2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21', '2026-12-28', '2027-01-04'];
  const acts = weeks.map(week => ({ week, hours: 100, mods: { [w]: { designed: 4 } }, ot: { setup: 100, framework: 40 } }));
  p.baseline = E.makeBaseline(p, E.schedule(p), 'agreed');
  const before = E.tracking(p, acts).spi;
  p.team = p.team.slice(0, 2); p.a.contingencyPct = 40; // re-plan: fewer people, more buffer
  const after = E.tracking(p, acts).spi;
  assert.ok(Math.abs(before - after) < 1e-9, 'status is measured against the baseline, not the edited plan');
  const v = E.baselineVariance(p, E.schedule(p));
  assert.ok(v.finishDays > 0 && v.effort > 0, 'the re-plan shows up as variance');
});

test('raw-pace forecast is reported alongside the smoothed one', () => {
  const p = trackedProject(); const [w] = p.modules.map(m => m.id);
  const weeks = ['2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21'];
  const acts = weeks.map(week => ({ week, hours: 100, mods: { [w]: { designed: 3 } } }));
  const T = E.tracking(p, acts);
  assert.ok(T.forecastRaw >= T.forecast, 'current pace is not softened');
  const R = E.weekReport(p, acts, null, weeks[5]);
  assert.strictEqual(R.forecast, T.forecastRaw);
});

test('calculated holidays: US observed dates and Good Friday', () => {
  const h = E.generateHolidays(2027, 2027);
  const has = (d, n, l) => h.some(x => x.date === d && x.name === n && x.location === l);
  assert.ok(has('2027-07-05', 'Independence Day', 'USA'), 'July 4 on a Sunday is observed on Monday');
  assert.ok(has('2027-11-25', 'Thanksgiving', 'USA'));
  assert.ok(has('2027-03-26', 'Good Friday', 'India'));
  assert.ok(has('2027-12-24', 'Christmas', 'USA'), 'Christmas on a Saturday is observed on Friday');
});

test('team time for pricing includes everyone booked, not just effort', () => {
  const p = exampleTeam(project());
  const A = E.analyse(p);
  assert.ok(A.teamTime && A.teamTime.hours > A.e.total, `team time ${A.teamTime && A.teamTime.hours} vs effort ${A.e.total}`);
});

/* ---------- second review fixes ---------- */
function onPlanActuals(p, s, weeks) {
  const T0 = E.tracking(p, [], s), ids = p.modules.map(m => m.id), acts = [], cum = {};
  Object.keys(T0.src.weeks).map(Number).sort((a, b) => a - b).slice(0, weeks).forEach(w => {
    const v = T0.src.weeks[w], mods = {};
    ids.forEach(id => { const m = v.mods[id] || { design: 0, script: 0, exec: 0 }; mods[id] = { designed: m.design, automated: m.script, executed: m.exec }; });
    Object.entries(v.ot).forEach(([k, h]) => { cum[k] = (cum[k] || 0) + h; });
    const ot = {}; Object.keys(cum).forEach(k => { ot[k] = Math.min(100, 100 * cum[k] / T0.W.ot[k]); });
    acts.push({ week: E.addDays(T0.src.weekStart, w * 7), hours: 100, mods, ot });
  });
  return acts;
}

test('a project exactly on plan forecasts its planned finish and is on track', () => {
  const p = exampleTeam(project());
  const s = E.schedule(p);
  p.end = s.finish; p.baseline = E.makeBaseline(p, s, 'agreed');
  const acts = onPlanActuals(p, s, 10);
  const R = E.weekReport(p, acts, s, acts[9].week);
  assert.ok(Math.abs(R.spi - 1) < 0.01);
  assert.strictEqual(R.forecast, R.plannedFinish);
  assert.strictEqual(R.status, 'ok');
  assert.strictEqual(R.late, 0);
});

test('moving the target date does not hide lateness against the baseline', () => {
  const p = trackedProject(); const [w] = p.modules.map(m => m.id);
  const s = E.schedule(p);
  p.end = s.finish; p.baseline = E.makeBaseline(p, s, 'agreed');
  const weeks = ['2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21', '2026-12-28', '2027-01-04'];
  const acts = weeks.map(week => ({ week, hours: 100, mods: { [w]: { designed: 5 } }, ot: { setup: 100, framework: 30 } }));
  const before = E.weekReport(p, acts, null, weeks[7]);
  p.end = E.addDays(p.end, 120);
  const after = E.weekReport(p, acts, null, weeks[7]);
  assert.ok(before.late > 0);
  assert.strictEqual(after.late, before.late, 'still late against the baselined target');
  assert.deepStrictEqual(after.targetChanged, { from: p.baseline.end, to: p.end });
});

test('work on modules added after the baseline is reported, not counted as progress', () => {
  const p = trackedProject(); const [w] = p.modules.map(m => m.id);
  p.baseline = E.makeBaseline(p, E.schedule(p), 'agreed');
  const extra = Object.assign(E.newModule('Added later', 3), { tcs: 400 });
  p.modules.push(extra);
  const acts = [{ week: '2026-11-16', hours: 100, mods: { [w]: { designed: 10 }, [extra.id]: { designed: 300, automated: 200 } } }];
  const withExtra = E.tracking(p, acts).rows[0].pct;
  const withoutExtra = E.tracking(p, [{ week: '2026-11-16', hours: 100, mods: { [w]: { designed: 10 } } }]).rows[0].pct;
  assert.strictEqual(withExtra, withoutExtra);
  const R = E.weekReport(p, acts, null, '2026-11-16');
  assert.strictEqual(R.outside.length, 1);
  assert.strictEqual(R.outside[0].act.designed, 300);
});

test('first weeks can be at risk but not behind', () => {
  const p = trackedProject(); const [w] = p.modules.map(m => m.id);
  const R = E.weekReport(p, [{ week: '2026-11-16', hours: 100, mods: { [w]: { designed: 1 } } }], null, '2026-11-16');
  assert.ok(R.early);
  assert.notStrictEqual(R.status, 'no');
});

test('productivity is compared with what the plan implies, not with 1.0', () => {
  const p = exampleTeam(project());
  const s = E.schedule(p);
  p.baseline = E.makeBaseline(p, s, 'agreed');
  const acts = onPlanActuals(p, s, 6);
  // log the hours the team is actually booked for
  const T = E.tracking(p, acts, s);
  assert.ok(T.effPlan > 0 && T.effPlan < 1, 'booked hours exceed earned effort in the plan');
  acts.forEach(a => { a.hours = 0; });
  const c = E.capacityIn(p, p.team, p.start, E.addDays(acts[5].week, 6));
  acts[5].hours = c.ded.gross - c.ded.holidays - c.ded.leave;
  const T2 = E.tracking(p, acts, s);
  assert.ok(Math.abs(T2.effIndex - 1) < 0.05, `on-plan team logging booked hours scores about 1.0, got ${T2.effIndex}`);
});
