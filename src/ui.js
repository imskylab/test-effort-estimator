/* ===== UI ===== */
const E = ENGINE;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
const H = h => nf0.format(Math.round(h || 0));
const PD = h => nf1.format((h || 0) / (S.P ? S.P.a.hoursPerDay : 8));
const pct = v => nf0.format(Math.round((v || 0) * 100)) + '%';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fd = s => { if (!s) return '—'; const [y, m, d] = s.split('-'); return `${+d} ${MON[+m - 1]} ${y}`; };
const fdShort = s => { const [, m, d] = s.split('-'); return `${+d} ${MON[+m - 1]}`; };
const DOWN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const S = { db: null, dl: null, list: [], id: null, P: null, actuals: [], tab: 'summary', saving: '', rev: null,
  local: false, unsubP: null, unsubA: null, openLeaves: {}, confirmDel: false, A: null };

/* ---------- persistence ---------- */
let saveTimer = null;
function touch() {
  S.A = null;
  S.saving = 'Unsaved';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 700);
  renderSoon();
}
async function saveNow() {
  if (!S.P || !S.id) return;
  if (S.local || !S.db) { S.saving = S.local ? 'Not saved (offline view)' : ''; const l = S.list.find(x => x.id === S.id); if (l) { l.name = S.P.name; l.client = S.P.client; } renderHeader(); return; }
  S.rev = E.uid();
  S.saving = 'Saving…'; renderHeader();
  try {
    await S.db.doc('projects/' + S.id).set({ name: S.P.name, client: S.P.client || '', updatedAt: Date.now(), rev: S.rev, data: JSON.parse(JSON.stringify(S.P)) });
    S.saving = 'Saved';
  } catch (e) {
    S.saving = e.code === 'invalid_argument' ? 'Read-only: you can view but not save' : e.code === 'quota_exceeded' ? 'Storage full: delete old projects' : 'Save failed, will retry on next edit';
  }
  renderHeader();
}
function openProject(id) {
  if (S.unsubA) { S.unsubA(); S.unsubA = null; }
  S.id = id; S.A = null; S.confirmDel = false; S.actuals = [];
  const l = S.list.find(x => x.id === id);
  S.P = l && l.data ? migrate(JSON.parse(JSON.stringify(l.data))) : null;
  S.rev = l ? l.rev : null;
  try { localStorage.setItem('tee.last', id); } catch (e) { }
  if (S.db && !S.local) {
    S.unsubA = S.db.collection('projects/' + id + '/actuals').onSnapshot(snap => {
      S.actuals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (S.tab === 'tracking') renderSoon();
    }, () => { });
  } else {
    S.actuals = (S.localActuals && S.localActuals[id]) || [];
  }
  renderAll();
}
function migrate(P) { return E.migrate(P); }
async function createProject(fromExample) {
  const P = fromExample ? exampleProject() : E.newProject('New project');
  const id = 'p' + Date.now().toString(36) + E.uid().slice(0, 4);
  const doc = { name: P.name, client: P.client, updatedAt: Date.now(), rev: E.uid(), data: P };
  if (S.db && !S.local) {
    try { await S.db.doc('projects/' + id).set(doc); }
    catch (e) { S.saving = e.code === 'invalid_argument' ? 'You have view access only, so new projects can’t be saved' : 'Couldn’t create the project'; renderHeader(); return; }
  }
  if (!S.list.find(x => x.id === id)) S.list.unshift({ id, ...doc });
  S.tab = 'summary';
  openProject(id);
}
async function duplicateProject() {
  if (!S.P) return;
  const P = JSON.parse(JSON.stringify(S.P)); P.name = P.name + ' (copy)';
  const id = 'p' + Date.now().toString(36) + E.uid().slice(0, 4);
  const doc = { name: P.name, client: P.client || '', updatedAt: Date.now(), rev: E.uid(), data: P };
  if (S.db && !S.local) { try { await S.db.doc('projects/' + id).set(doc); } catch (e) { return; } }
  if (!S.list.find(x => x.id === id)) S.list.unshift({ id, ...doc });
  openProject(id);
}
async function deleteProject() {
  const id = S.id;
  if (S.db && !S.local) {
    try {
      for (const a of S.actuals) await S.db.doc('projects/' + id + '/actuals/' + a.id).delete();
      await S.db.doc('projects/' + id).delete();
    } catch (e) { S.saving = 'Couldn’t delete'; renderHeader(); return; }
  }
  S.list = S.list.filter(x => x.id !== id);
  S.id = null; S.P = null;
  if (S.list.length) openProject(S.list[0].id); else renderAll();
}
async function saveActual(row) {
  const i = S.actuals.findIndex(x => x.id === row.id);
  if (i >= 0) S.actuals[i] = row; else S.actuals.push(row);
  if (S.db && !S.local) {
    const { id, ...body } = row;
    try { await S.db.doc('projects/' + S.id + '/actuals/' + id).set(body); } catch (e) { S.saving = 'Couldn’t save actuals'; renderHeader(); }
  } else { S.localActuals = S.localActuals || {}; S.localActuals[S.id] = S.actuals; }
  renderSoon();
}
async function deleteActual(id) {
  S.actuals = S.actuals.filter(x => x.id !== id);
  if (S.db && !S.local) { try { await S.db.doc('projects/' + S.id + '/actuals/' + id).delete(); } catch (e) { } }
  renderSoon();
}

function exampleProject() {
  const P = E.newProject('Example: Retail banking regression');
  P.client = 'Example client';
  const m = (name, o) => Object.assign(E.newModule(name), o);
  P.end = E.addDays(P.start, 7 * 28 - 3);
  P.modules = [
    m('Customer web portal', { tcs: 300, mix: { S: 30, M: 40, C: 20, V: 10 }, autoPct: 80, priority: 1 }),
    m('Payments API', { appType: 'API', tcs: 160, mix: { S: 40, M: 40, C: 15, V: 5 }, autoPct: 95, design: true, manualExec: false, priority: 2 }),
    m('Mobile app (Android/iOS)', { appType: 'Mobile', tcs: 100, mix: { S: 25, M: 45, C: 20, V: 10 }, autoPct: 70, testData: 'High', priority: 3, availableFrom: E.addDays(P.start, 63) })
  ];
  const r = (name, o) => Object.assign(E.newResource(), { name }, o);
  P.team = [
    r('Test lead', { role: 'Lead', activity: 'Both', level: 'Expert' }),
    r('Automation engineer A', { activity: 'Automation', level: 'Senior' }),
    r('Automation engineer B', { activity: 'Automation', level: 'Senior', leaves: [{ from: E.addDays(P.start, 38), to: E.addDays(P.start, 46), note: 'Planned leave' }] }),
    r('Automation engineer C', { activity: 'Automation', level: 'Mid' }),
    r('Automation engineer D', { activity: 'Automation', level: 'Mid' }),
    r('Automation engineer E', { activity: 'Automation', level: 'Junior', skill: 'Working knowledge' }),
    r('Manual tester A', { activity: 'Manual', level: 'Mid' }),
    r('Manual tester B', { activity: 'Manual', level: 'Junior' }),
    r('Onsite coordinator', { role: 'Lead', activity: 'Both', level: 'Senior', location: 'USA', alloc: 50 })
  ];
  P.downtimes = [{ id: E.uid(), from: E.addDays(P.start, 21), to: E.addDays(P.start, 25), impact: 50, reason: 'Planned environment upgrade' }];
  return P;
}

/* ---------- binding ---------- */
function getPath(o, path) { return path.split('.').reduce((x, k) => x == null ? x : x[k], o); }
function setPath(o, path, v) { const ks = path.split('.'); const last = ks.pop(); const t = ks.reduce((x, k) => x[k], o); t[last] = v; }
const fid = path => 'f-' + path.replace(/[^a-z0-9]/gi, '-');
function inp(path, type = 'text', cls = '', attrs = '') {
  const v = getPath(S.P, path);
  if (type === 'check') return `<input type="checkbox" id="${fid(path)}" data-p="${path}" data-t="check" ${v ? 'checked' : ''} ${attrs}>`;
  if (type === 'num') return `<input type="number" id="${fid(path)}" data-p="${path}" data-t="num" class="${cls}" value="${v ?? ''}" step="any" ${attrs}>`;
  return `<input type="${type}" id="${fid(path)}" data-p="${path}" class="${cls}" value="${esc(v)}" ${attrs}>`;
}
function sel(path, options, cls = '') {
  const v = getPath(S.P, path);
  return `<select id="${fid(path)}" data-p="${path}" class="${cls}">${options.map(o => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${val == v ? 'selected' : ''}>${esc(lab)}</option>`; }).join('')}</select>`;
}
document.addEventListener('change', ev => {
  const el = ev.target; const path = el.dataset && el.dataset.p; if (!path || !S.P) return;
  let v = el.value;
  if (el.dataset.t === 'num') { v = el.value === '' ? 0 : Number(el.value); if (!isFinite(v)) v = 0; }
  if (el.dataset.t === 'check') v = el.checked;
  setPath(S.P, path, v);
  touch();
});

/* ---------- render scheduling ---------- */
let rq = false;
function renderSoon() { if (rq) return; rq = true; requestAnimationFrame(() => { rq = false; renderAll(); }); }
function analysis() { if (!S.A && S.P) S.A = E.analyse(S.P); return S.A; }

function renderAll() {
  const act = document.activeElement; const aid = act && act.id; let selS = null, selE = null;
  try { selS = act.selectionStart; selE = act.selectionEnd; } catch (e) { }
  renderHeader(); renderMain();
  if (aid) { const el = document.getElementById(aid); if (el && el !== document.activeElement) { el.focus({ preventScroll: true }); try { if (selS != null) el.setSelectionRange(selS, selE); } catch (e) { } } }
}
function renderHeader() {
  const opts = S.list.map(x => `<option value="${x.id}" ${x.id === S.id ? 'selected' : ''}>${esc(x.id === S.id && S.P ? S.P.name : x.name)}</option>`).join('');
  $('#hdr-proj').innerHTML = S.list.length ? `<select id="proj-pick" class="sel-proj" aria-label="Project">${opts}</select>` : '';
  $('#save').textContent = S.saving;
  const has = !!S.P;
  $('#hdr-actions').innerHTML = `
    <button class="btn" data-act="new">New project</button>
    ${has ? `<button class="btn" data-act="dup">Duplicate</button>
    ${S.confirmDel ? `<span class="confirm">Delete this project and its tracking data? <button class="btn danger" data-act="del-yes">Delete</button><button class="btn" data-act="del-no">Cancel</button></span>` : `<button class="btn" data-act="del">Delete</button>`}
    <button class="btn primary" data-act="xlsx" ${S.dl === false ? 'disabled title="Downloads aren’t available in this view"' : ''}>Export Excel</button>` : ''}`;
  document.querySelectorAll('nav.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === S.tab));
  $('nav.tabs').hidden = !has;
}
document.addEventListener('change', ev => { if (ev.target.id === 'proj-pick') openProject(ev.target.value); });

function renderMain() {
  const m = $('#main');
  if (!S.P) {
    m.innerHTML = S.loading ? `<div class="empty"><p class="muted">Loading projects…</p></div>` : `
      <div class="empty panel">
        <h1>Estimate a test project</h1>
        <p class="muted" style="max-width:56ch">Add modules and test cases, your team and your calendar. The estimator works out effort, finish date, team needed and achievable scope, then tracks actuals week by week.</p>
        <div class="row" style="justify-content:center"><button class="btn primary" data-act="new">New project</button><button class="btn" data-act="example">Open an example project</button></div>
        ${S.timeoutNote ? `<p class="small muted">${S.timeoutNote}</p>` : ''}
      </div>`;
    return;
  }
  const tabs = { summary: viewSummary, schedule: viewSchedule, scope: viewScope, team: viewTeam, calendar: viewCalendar, factors: viewFactors, tracking: viewTracking };
  m.innerHTML = (S.local ? `<div class="banner">Saving isn’t available in this view, so changes last only until you close the page.</div>` : '') + (S.tab !== 'summary' && S.tab !== 'tracking' && S.tab !== 'schedule' ? strip() : '') + tabs[S.tab]();
  if (S.tab === 'summary') drawCapChart();
  if (S.tab === 'schedule') { drawGantt(); drawHeat(); }
  if (S.tab === 'tracking') drawBurnChart();
}

/* ---------- icons & pills ---------- */
const ICON = {
  ok: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2"><path d="M2.5 6.5l2.2 2.2L9.5 3.5"/></svg>',
  risk: '<svg viewBox="0 0 12 12" fill="currentColor"><path d="M6 1l5 9.5H1z" opacity=".25"/><path d="M5.3 4h1.4v3.4H5.3zM5.3 8.2h1.4v1.3H5.3z"/></svg>',
  no: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l6 6M9 3l-6 6"/></svg>',
  na: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="6" cy="6" r="4.2"/></svg>'
};
const pill = (k, t) => `<span class="pill ${k}">${ICON[k]}${esc(t)}</span>`;
const STATUS = { ok: ['ok', 'Feasible'], risk: ['risk', 'At risk'], no: ['no', 'Not feasible'], noteam: ['na', 'No team yet'], nodate: ['na', 'No target date'], estimate: ['na', 'Estimate only'] };

function strip() {
  const A = analysis(), st = A.status || 'nodate';
  return `<div class="strip">${pill(...STATUS[st])}<span>Effort <b>${H(A.e.total)} h</b></span><span>Person-days <b>${PD(A.e.total)}</b></span>
    <span>Finish with team <b>${A.finish && A.finish.likely.date ? fd(A.finish.likely.date) : '—'}</b></span>
    <span>Target <b>${fd(S.P.end)}</b></span></div>`;
}

/* ---------- Summary ---------- */
function missingMsg(m) {
  const parts = { manual: 'manual work (test design or execution)', automation: 'automation work', 'one-time': 'the one-time activities' };
  const fix = { manual: 'set someone’s “Works on” to Manual or Both, or turn off manual design and execution on the Scope tab', automation: 'set someone’s “Works on” to Automation or Both, or turn off automation on the Scope tab', 'one-time': 'add an engineer or lead' };
  return m.map(k => `The scope includes ${parts[k]}, but nobody on the team does it: ${fix[k]}.`).join(' ');
}
function viewSummary() {
  const P = S.P, A = analysis(), e = A.e, a = P.a;
  const st = A.status || 'nodate';
  const w = A.window;
  let msg;
  const missMsg = A.missing && A.missing.length ? missingMsg(A.missing) : '';
  const fl = A.finish && A.finish.likely;
  if (st === 'nodate' && !P.start) msg = 'Set a start date to work out the estimated end date.';
  else if (st === 'nodate' && !A.hasTeam) msg = 'Add at least one person on the Team tab to work out the estimated end date.';
  else if (st === 'nodate' && missMsg) msg = missMsg;
  else if (st === 'nodate' && fl && fl.date) msg = `With the current team, the work is estimated to finish on <b>${fd(fl.date)}</b> (best ${fd(A.finish.best.date)}, worst ${A.finish.worst.date ? fd(A.finish.worst.date) : 'over 3 years'}). Set a target end date to check feasibility, size the team and see how much scope fits.`;
  else if (st === 'nodate') msg = 'With the current team, the work doesn’t finish within 3 years. Add people or reduce scope.';
  else if (st === 'noteam') msg = 'No one is on the team yet. The middle card shows the team this scope needs by the target date.';
  else if (st === 'ok') msg = `The plan fits. The likely finish is <b>${fd(fl.date)}</b>, ${E.daysBetween(fl.date, P.end)} days before the target, and even the worst case (${fd(A.finish.worst.date)}) is on time.`;
  else if (st === 'risk') msg = `The likely finish, <b>${fd(fl.date)}</b>, is before the target, but the worst case (${A.finish.worst.date ? fd(A.finish.worst.date) : 'over 3 years'}) isn’t, so the buffer is thin.`;
  else if (missMsg) msg = 'The plan doesn’t fit. ' + missMsg;
  else if (fl && fl.date) msg = `The plan doesn’t fit. The likely finish is <b>${fd(fl.date)}</b>, ${E.daysBetween(P.end, fl.date)} days after the target.`;
  else msg = 'The plan doesn’t fit: with the current team the work doesn’t finish within 3 years.';
  if (A.sched && A.sched.work > 0) {
    const idle = A.sched.idle / (A.sched.work + A.sched.idle);
    if (idle >= 0.1) msg += ` ${pct(idle)} of the team’s productive time before the finish is spent waiting for work (framework, reviews, module availability or skills). The Schedule tab shows where.`;
  }

  // Card 1: finish date
  let c1;
  if (!A.hasTeam) c1 = `<div class="big muted">Add a team</div><div class="sub">Needs at least one person on the Team tab.</div>`;
  else if (!A.finish.likely.date) c1 = `<div class="big">Not reachable</div><div class="sub">${A.missing.length ? missingMsg(A.missing) : 'Not within 3 years. Add people or reduce scope.'}</div>`;
  else {
    const f = A.finish, late = P.end && f.likely.date > P.end;
    c1 = `<div class="big">${fd(f.likely.date)}</div>
      <div class="sub">${nf0.format(f.likely.workdays)} working days from ${fd(P.start)}${P.end ? (late ? `, <b style="color:var(--bad)">${E.daysBetween(P.end, f.likely.date)} days after target</b>` : `, ${E.daysBetween(f.likely.date, P.end)} days before target`) : ''}</div>
      <div class="chips"><span class="chip">Best ${f.best.date ? fd(f.best.date) : '—'}</span><span class="chip">Worst ${f.worst.date ? fd(f.worst.date) : 'over 3 years'}</span></div>`;
  }
  // Card 2: team needed
  let c2;
  if (!A.need) c2 = `<div class="big muted">Set a target date</div><div class="sub">Needed to size the team.</div>`;
  else if (A.need.extra == null) c2 = `<div class="big">Not possible by the target</div><div class="sub">More people don’t help enough: framework setup, reviews, build gaps and module availability set a minimum duration.${A.need.floor ? ` Even with 256 extra people the earliest finish is ${fd(A.need.floor)}.` : ''} Move the target date or cut scope.</div>`;
  else if (A.need.extra === 0) c2 = `<div class="big">Current team is enough</div><div class="sub">${A.needWorst && A.needWorst.extra ? `Add ${A.needWorst.extra} to cover the worst case.` : 'Covers the worst case too.'}</div>`;
  else {
    const n = A.need, head = A.hasTeam ? `+${n.extra} engineers` : `${n.extra} engineers`;
    c2 = `<div class="big">${head}</div>
      <div class="sub">${A.hasTeam ? 'On top of the current team, ' : ''}${esc(a.hireSkill.toLowerCase())}, full-time, based in ${esc(a.hireLocation)}, from the start date.${A.needWorst && A.needWorst.extra != null ? ` Worst case: ${A.hasTeam ? '+' : ''}${A.needWorst.extra}.` : ''}</div>
      <div class="chips">${n.heads.map(h => `<span class="chip">${h.n} × ${esc(h.level)}</span>`).join('')}${n.needLeads ? `<span class="chip">+${n.needLeads} lead${n.needLeads > 1 ? 's' : ''}</span>` : ''}${n.needMgr ? `<span class="chip">+1 manager (${a.managerAlloc}%)</span>` : ''}</div>`;
  }
  // Card 3: scope
  let c3;
  if (!A.need) c3 = `<div class="big muted">Set a target date</div><div class="sub">Needed to work out achievable scope.</div>`;
  else if (!A.hasTeam) c3 = `<div class="big muted">Add a team</div><div class="sub">Shows how many test cases the team can finish by the target date.</div>`;
  else {
    const f = A.scope.f;
    if (A.scope.oneTimeBlocks) c3 = `<div class="big">0 test cases</div><div class="sub">One-time activities alone take longer than the window.</div>`;
    else if (f >= 1) c3 = `<div class="big">All ${nf0.format(e.tcs)} test cases</div><div class="sub">Room for about ${f >= 64 ? 'much' : pct(f - 1)} more scope in the same window.</div>`;
    else c3 = `<div class="big">${nf0.format(Math.floor(e.tcs * f))} of ${nf0.format(e.tcs)}</div>
      <div class="sub">${pct(f)} of planned scope, including ${nf0.format(Math.floor(e.autoTCs * f))} automated scripts, keeping the same mix per module.</div>`;
  }

  const L = e.lines;
  const lines = [
    ['Manual test design', L.design], ['Manual execution (cycles + retest)', L.exec], ['Automation scripting', L.script],
    ['Script review and rework', L.review], ['Script maintenance', L.maint], ['Automation runs and failure analysis', L.autoExec],
    ['One-time activities', L.oneTime], [`Contingency (${a.contingencyPct}%)`, L.contingency]
  ].filter(x => x[1] > 0.01);
  const ex = A.expectedTotal;
  const effortTbl = `<div class="tbl-wrap"><table>
    <thead><tr><th>Activity</th><th class="r">Hours</th><th class="r">Person-days</th><th class="r">Share</th></tr></thead><tbody>
    ${lines.map(([n, h]) => `<tr><td>${n}</td><td class="r num">${H(h)}</td><td class="r num">${PD(h)}</td><td class="r num">${pct(h / e.total)}</td></tr>`).join('')}
    <tr class="total"><td>Total (likely)</td><td class="r num">${H(e.total)}</td><td class="r num">${PD(e.total)}</td><td class="r num">100%</td></tr>
    <tr class="sub"><td>Best case (×${a.pertBest})</td><td class="r num">${H(e.total * a.pertBest)}</td><td class="r num">${PD(e.total * a.pertBest)}</td><td></td></tr>
    <tr class="sub"><td>Worst case (×${a.pertWorst})</td><td class="r num">${H(e.total * a.pertWorst)}</td><td class="r num">${PD(e.total * a.pertWorst)}</td><td></td></tr>
    <tr class="sub"><td>PERT expected (B + 4L + W) ÷ 6</td><td class="r num">${H(ex)}</td><td class="r num">${PD(ex)}</td><td></td></tr>
    </tbody></table></div>`;

  const modTbl = `<div class="tbl-wrap"><table>
    <thead><tr><th>Module</th><th class="r">Test cases</th><th class="r">To automate</th><th class="r">Manual h</th><th class="r">Automation h</th></tr></thead><tbody>
    ${e.mods.map(m => `<tr><td>${esc(m.name)}</td><td class="r num">${nf0.format(m.tcs)}</td><td class="r num">${nf0.format(m.autoTCs)}</td><td class="r num">${H(m.manual)}</td><td class="r num">${H(m.auto)}</td></tr>`).join('')}
    <tr class="total"><td>Total</td><td class="r num">${nf0.format(e.tcs)}</td><td class="r num">${nf0.format(e.autoTCs)}</td><td class="r num">${H(L.design + L.exec)}</td><td class="r num">${H(L.script + L.review + L.maint + L.autoExec)}</td></tr>
    </tbody></table></div><p class="small muted">Module figures exclude one-time activities and contingency.</p>`;

  let capBlock = '';
  if (w && A.hasTeam) {
    const d = w.ded, rows = [
      ['Gross hours (working days × hours × allocation)', d.gross, 1], ['Public holidays', -d.holidays], ['Planned leave', -d.leave],
      ['Meetings, reporting, calls (non-development)', -d.nonDev], [`Unplanned leave (${a.unplannedLeavePct}%)`, -d.unplanned],
      ['Downtime (environment, builds, blocked windows)', -d.downtime], ['Ramp-up and learning curve', -d.ramp],
      ['Experience and skill adjustment', d.productivity]
    ];
    const mx = d.gross || 1;
    const until = P.end || (A.finish && A.finish.likely.date);
    capBlock = `<section class="panel"><div class="panel-head"><h2>Where the team’s time goes</h2><span class="small muted">${fd(P.start)} to ${fd(until)}</span></div>
      <div class="tbl-wrap"><table><thead><tr><th>Item</th><th class="r">Hours</th><th class="r">Person-days</th><th></th></tr></thead><tbody>
      ${rows.map(([n, h, g]) => `<tr><td>${n}</td><td class="r num">${h > 0 && !g ? '+' : ''}${H(h)}</td><td class="r num">${PD(h)}</td><td><div class="mini-track"><div class="mini-bar ${g ? '' : 'neg'}" style="width:${Math.min(100, Math.abs(h) / mx * 100)}%"></div></div></td></tr>`).join('')}
      <tr class="total"><td>Productive capacity</td><td class="r num">${H(w.total)}</td><td class="r num">${PD(w.total)}</td><td><div class="mini-track"><div class="mini-bar" style="width:${Math.min(100, w.total / mx * 100)}%"></div></div></td></tr>
      </tbody></table></div>
      ${A.sched && A.sched.finish ? `<p class="small muted">Up to the estimated finish, ${H(A.sched.idle)} h (${pct(A.sched.idle / (A.sched.work + A.sched.idle || 1))}) of productive time is spent waiting for work: framework not ready, test cases in review, modules not available yet, or no work left in a person’s skill area.</p>` : ''}
      <h3>By person</h3>
      <div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Works on</th><th>Level</th><th class="r">Productive h</th><th class="r">Person-days</th></tr></thead><tbody>
      ${P.team.map((r, i) => `<tr><td>${esc(r.name)}</td><td>${esc(r.role)}</td><td>${r.role === 'Manager' ? 'Management' : esc(r.activity)}</td><td>${esc(r.level)}</td><td class="r num">${H(w.per[i])}</td><td class="r num">${PD(w.per[i])}</td></tr>`).join('')}
      </tbody></table></div></section>`;
  }

  return `
  <section class="panel">
    <div class="fields">
      <label class="field"><span class="lbl">Project name</span>${inp('name')}</label>
      <label class="field"><span class="lbl">Client</span>${inp('client')}</label>
      <label class="field"><span class="lbl">Start date</span>${inp('start', 'date')}</label>
      <label class="field"><span class="lbl">Target end date</span>${inp('end', 'date')}<span class="hint">Leave empty to only work out the finish date</span></label>
    </div>
  </section>
  <div class="verdict">${pill(...STATUS[st === 'nodate' && fl && fl.date ? 'estimate' : st])}<p>${msg}</p></div>
  <div class="grid3">
    <div class="answer"><div class="q">When will the current team finish?</div>${c1}</div>
    <div class="answer"><div class="q">What team is needed by the target date?</div>${c2}</div>
    <div class="answer"><div class="q">How much scope fits by the target date?</div>${c3}</div>
  </div>
  ${milestonesPanel(A)}
  <section class="panel"><div class="panel-head"><h2>Capacity against effort</h2><div class="legend"><span><i style="background:var(--s1)"></i>Cumulative productive capacity</span><span><i style="background:var(--ink);height:0;border-top:2px dashed var(--ink)"></i>Effort needed (likely)</span></div></div>
    <div class="chart" id="cap-chart"></div></section>
  <div class="grid2">
    <section class="panel"><h2>Effort by activity</h2>${effortTbl}</section>
    <section class="panel"><h2>Effort by module</h2>${modTbl}</section>
  </div>
  ${capBlock}`;
}

/* ---------- Scope ---------- */
function viewScope() {
  const P = S.P, a = P.a, e = analysis().e;
  const rows = P.modules.map((m, i) => {
    const mixSum = a.complexity.reduce((s, c) => s + (+m.mix[c.key] || 0), 0);
    const em = e.mods[i];
    return `<tr>
      <td>${inp(`modules.${i}.name`, 'text', 'w-l')}</td>
      <td>${inp(`modules.${i}.priority`, 'num', 'w-xs', 'min="1"')}</td>
      <td>${inp(`modules.${i}.availableFrom`, 'date')}</td>
      <td>${sel(`modules.${i}.appType`, a.appTypes.map(x => x.key))}</td>
      <td>${inp(`modules.${i}.tcs`, 'num', 'w-s', 'min="0"')}</td>
      ${a.complexity.map(c => `<td>${inp(`modules.${i}.mix.${c.key}`, 'num', 'w-s', 'min="0" max="100"')}</td>`).join('')}
      <td class="num" style="color:${Math.round(mixSum) === 100 ? 'var(--muted)' : 'var(--bad)'}">${nf0.format(mixSum)}%</td>
      <td>${inp(`modules.${i}.design`, 'check', '', 'aria-label="Manual test design"')}</td>
      <td>${inp(`modules.${i}.manualExec`, 'check', '', 'aria-label="Manual execution"')}</td>
      <td>${inp(`modules.${i}.automation`, 'check', '', 'aria-label="Automation"')}</td>
      <td>${inp(`modules.${i}.autoPct`, 'num', 'w-s', 'min="0" max="100"')}</td>
      <td>${sel(`modules.${i}.testData`, a.testData.map(x => x.key))}</td>
      <td class="r num">${H(em.manual + em.auto)}</td>
      <td><button class="btn ghost" data-act="rm-mod" data-i="${i}" aria-label="Remove module">Remove</button></td></tr>`;
  }).join('');
  return `<section class="panel">
    <div class="panel-head"><h2>Modules and test cases</h2><button class="btn" data-act="add-mod">Add module</button></div>
    <p class="small muted">Split the scope by module or application. The complexity mix is the % of test cases at each level and normally adds to 100 (if not, it’s scaled to 100). “To automate %” is the share of test cases that are automation candidates. Priority 1 is worked on first; modules overlap when people are free. “Available from” is when the module’s build or environment is ready (empty means from the start).</p>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Module</th><th title="1 is worked on first">Priority</th><th title="When the build or environment for this module is ready">Available from</th><th>App type</th><th>Test cases</th>${a.complexity.map(c => `<th title="${esc(c.desc)}">${esc(c.name)} %</th>`).join('')}<th>Mix</th><th>Design</th><th>Manual run</th><th>Automate</th><th>To automate %</th><th>Test data</th><th class="r">Hours</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="18" class="muted">No modules yet. Add one to start.</td></tr>`}</tbody>
    </table></div>
  </section>
  <section class="panel"><h2>Complexity levels</h2>
    <div class="tbl-wrap"><table><thead><tr><th>Level</th><th>Typical test case</th><th class="r">Design h</th><th class="r">Manual run h</th><th class="r">Automation h</th></tr></thead><tbody>
    ${a.complexity.map(c => `<tr><td>${esc(c.name)}</td><td class="muted">${esc(c.desc)}</td><td class="r num">${c.design}</td><td class="r num">${c.exec}</td><td class="r num">${c.auto}</td></tr>`).join('')}
    </tbody></table></div><p class="small muted">Hours per test case for a mid-level engineer. Change them on the Factors tab.</p></section>`;
}

/* ---------- Team ---------- */
function viewTeam() {
  const P = S.P, a = P.a, A = analysis(), w = A.window;
  const locs = P.locations;
  const rows = P.team.map((r, i) => {
    const open = S.openLeaves[r.id];
    const lv = r.leaves.length;
    const leaveRow = open ? `<tr class="sub"><td colspan="13"><div class="leaves">
        ${r.leaves.map((l, j) => `<div class="row"><span class="small muted">From</span>${inp(`team.${i}.leaves.${j}.from`, 'date')}<span class="small muted">to</span>${inp(`team.${i}.leaves.${j}.to`, 'date')}${inp(`team.${i}.leaves.${j}.note`, 'text', 'w-m', 'placeholder="Note"')}<button class="btn ghost" data-act="rm-leave" data-i="${i}" data-j="${j}">Remove</button></div>`).join('')}
        <div><button class="btn" data-act="add-leave" data-i="${i}">Add leave</button></div></div></td></tr>` : '';
    return `<tr>
      <td>${inp(`team.${i}.name`, 'text', 'w-name')}</td>
      <td>${sel(`team.${i}.role`, a.roles.map(x => x.key))}</td>
      <td>${sel(`team.${i}.activity`, ['Automation', 'Manual', 'Both'])}</td>
      <td>${sel(`team.${i}.level`, a.levels.map(x => [x.key, x.label]))}</td>
      <td>${sel(`team.${i}.skill`, a.skills.map(x => x.key))}</td>
      <td>${inp(`team.${i}.alloc`, 'num', 'w-s', 'min="0" max="100"')}</td>
      <td>${sel(`team.${i}.location`, locs)}</td>
      <td>${inp(`team.${i}.start`, 'date')}</td>
      <td>${inp(`team.${i}.end`, 'date')}</td>
      <td><button class="btn" data-act="tog-leave" data-id="${r.id}" aria-expanded="${!!open}">${lv ? lv + ' leave' + (lv > 1 ? 's' : '') : 'Add leave'}</button></td>
      <td class="r num">${w ? H(w.per[i]) : '—'}</td>
      <td><button class="btn ghost" data-act="rm-res" data-i="${i}" aria-label="Remove person">Remove</button></td></tr>${leaveRow}`;
  }).join('');
  return `<section class="panel">
    <div class="panel-head"><h2>Team</h2><button class="btn" data-act="add-res">Add person</button></div>
    <p class="small muted">Role sets the share of time spent on non-development work (Engineer ${a.roles[0].nonDevPct}%, Lead ${a.roles[1].nonDevPct}%, Manager ${a.roles[2].nonDevPct}%). “Works on” limits which work a person can pick up. Leave start and end empty to use the project dates.</p>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Name</th><th>Role</th><th>Works on</th><th>Experience</th><th>Tool skill</th><th>Allocation %</th><th>Location</th><th>From</th><th>To</th><th>Leave</th><th class="r">Productive h</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="13" class="muted">No one on the team yet. The Summary still shows the team you’d need.</td></tr>`}</tbody>
    </table></div>
    <p class="small muted">Productive hours cover ${P.end ? 'the start to the target end date' : 'the start to the estimated finish date'}, after every deduction.</p>
  </section>`;
}

/* ---------- Calendar ---------- */
function viewCalendar() {
  const P = S.P, a = P.a;
  const hol = P.holidays.map((h, i) => ({ h, i })).sort((x, y) => x.h.date < y.h.date ? -1 : 1);
  return `<section class="panel"><h2>Working time</h2>
    <div class="fields">
      <label class="field"><span class="lbl">Hours per working day</span>${inp('a.hoursPerDay', 'num')}</label>
      <div class="field"><span class="lbl">Working days</span><div class="row">${[1, 2, 3, 4, 5, 6, 0].map(d => `<label class="row small" style="gap:4px"><input type="checkbox" id="wd-${d}" data-act="wd" data-d="${d}" ${a.workDays.includes(d) ? 'checked' : ''}>${DOWN[d]}</label>`).join('')}</div></div>
    </div></section>
  <section class="panel"><div class="panel-head"><h2>Locations</h2><button class="btn" data-act="add-loc">Add location</button></div>
    <div class="row">${P.locations.map((l, i) => `<span class="row" style="gap:4px">${inp(`locations.${i}`, 'text', 'w-m')}<button class="btn ghost" data-act="rm-loc" data-i="${i}" ${P.locations.length < 2 ? 'disabled' : ''}>Remove</button></span>`).join('')}</div>
    <p class="small muted">Each location has its own holiday list below. People follow the holidays of their location.</p></section>
  <section class="panel"><div class="panel-head"><h2>Public holidays</h2><button class="btn" data-act="add-hol">Add holiday</button></div>
    <p class="note">The list starts with sample national holidays for India and US federal holidays. Replace them with your company’s holiday calendar for each location. Holidays on non-working days have no effect.</p>
    <div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Holiday</th><th>Location</th><th></th></tr></thead><tbody>
    ${hol.map(({ h, i }) => `<tr><td>${inp(`holidays.${i}.date`, 'date')}</td><td>${inp(`holidays.${i}.name`, 'text', 'w-l')}</td><td>${sel(`holidays.${i}.location`, P.locations)}</td><td><button class="btn ghost" data-act="rm-hol" data-i="${i}">Remove</button></td></tr>`).join('') || `<tr><td colspan="4" class="muted">No holidays listed.</td></tr>`}
    </tbody></table></div></section>
  <section class="panel"><div class="panel-head"><h2>Blocked windows</h2><button class="btn" data-act="add-dt">Add window</button></div>
    <p class="small muted">Known periods when the environment or application is unavailable, such as upgrades, code freezes or release weeks. Impact is how much of the team’s productive time is lost on those days. Everyday downtime is covered by the downtime % on the Factors tab.</p>
    <div class="tbl-wrap"><table><thead><tr><th>From</th><th>To</th><th>Impact %</th><th>Reason</th><th></th></tr></thead><tbody>
    ${P.downtimes.map((d, i) => `<tr><td>${inp(`downtimes.${i}.from`, 'date')}</td><td>${inp(`downtimes.${i}.to`, 'date')}</td><td>${inp(`downtimes.${i}.impact`, 'num', 'w-s', 'min="0" max="100"')}</td><td>${inp(`downtimes.${i}.reason`, 'text', 'w-l')}</td><td><button class="btn ghost" data-act="rm-dt" data-i="${i}">Remove</button></td></tr>`).join('') || `<tr><td colspan="5" class="muted">No blocked windows.</td></tr>`}
    </tbody></table></div></section>`;
}

/* ---------- Factors ---------- */
function viewFactors() {
  const P = S.P, a = P.a;
  const f = (path, label, hint) => `<label class="field"><span class="lbl">${label}</span>${inp(path, 'num')}${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
  return `<p class="note">Defaults follow common industry ranges for functional test automation. Replace them with your own historical numbers as you collect them. Every change applies to this project only.</p>
  <section class="panel"><h2>Hours per test case</h2>
    <div class="tbl-wrap"><table><thead><tr><th>Level</th><th>Typical test case</th><th>Design h</th><th>Manual run h</th><th>Automation h</th></tr></thead><tbody>
    ${a.complexity.map((c, i) => `<tr><td>${inp(`a.complexity.${i}.name`, 'text', 'w-m')}</td><td>${inp(`a.complexity.${i}.desc`, 'text', 'w-full')}</td><td>${inp(`a.complexity.${i}.design`, 'num')}</td><td>${inp(`a.complexity.${i}.exec`, 'num')}</td><td>${inp(`a.complexity.${i}.auto`, 'num')}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="small muted">Automation hours cover analysis, scripting, test data hooks, debugging and stabilising the script. Manual run hours are per execution.</p></section>
  <div class="grid2">
  <section class="panel"><h2>Application type</h2><p class="small muted">Multiplies automation hours.</p>
    <div class="tbl-wrap"><table><tbody>${a.appTypes.map((x, i) => `<tr><td>${esc(x.key)}</td><td class="r">${inp(`a.appTypes.${i}.factor`, 'num')}</td></tr>`).join('')}</tbody></table></div></section>
  <section class="panel"><h2>Test data complexity</h2><p class="small muted">Multiplies automation hours.</p>
    <div class="tbl-wrap"><table><tbody>${a.testData.map((x, i) => `<tr><td>${esc(x.key)}</td><td class="r">${inp(`a.testData.${i}.factor`, 'num')}</td></tr>`).join('')}</tbody></table></div></section>
  </div>
  <div class="grid2">
  <section class="panel"><h2>Experience</h2><p class="small muted">Productivity is relative to a mid-level engineer (1.0). Ramp-up days start at ${a.rampStartPct}% productivity and rise to full.</p>
    <div class="tbl-wrap"><table><thead><tr><th>Level</th><th>Productivity</th><th>Ramp-up days</th></tr></thead><tbody>
    ${a.levels.map((x, i) => `<tr><td>${esc(x.label)}</td><td>${inp(`a.levels.${i}.productivity`, 'num')}</td><td>${inp(`a.levels.${i}.rampDays`, 'num')}</td></tr>`).join('')}</tbody></table></div>
    ${f('a.rampStartPct', 'Productivity on day one %')}</section>
  <section class="panel"><h2>Tool skill</h2><p class="small muted">Skill with the project’s automation tool. Multiplies productivity and adds ramp-up days.</p>
    <div class="tbl-wrap"><table><thead><tr><th>Skill</th><th>Factor</th><th>Extra ramp days</th></tr></thead><tbody>
    ${a.skills.map((x, i) => `<tr><td>${esc(x.key)}</td><td>${inp(`a.skills.${i}.factor`, 'num')}</td><td>${inp(`a.skills.${i}.extraRamp`, 'num')}</td></tr>`).join('')}</tbody></table></div></section>
  </div>
  <section class="panel"><h2>Capacity deductions</h2>
    <div class="fields">
      ${a.roles.map((r, i) => f(`a.roles.${i}.nonDevPct`, `Non-development time, ${r.key} %`, i === 0 ? 'Stand-ups, status reports, client and defect calls' : i === 1 ? 'Planning, reviews, reporting, client calls' : 'Full-time management by default')).join('')}
      ${f('a.unplannedLeavePct', 'Unplanned leave %', 'Sick days and emergencies')}
      ${f('a.downtimePct', 'Everyday downtime %', 'Environment outages, broken builds, access issues')}
    </div></section>
  <section class="panel"><h2>Automation and execution</h2>
    <div class="fields">
      ${f('a.reviewPct', 'Review and rework % of scripting')}
      ${f('a.maintenancePct', 'Script maintenance % of scripting', 'Fixing scripts broken by application changes during the project')}
      ${f('a.reusePct', 'Reusability saving %', 'Time saved by reusable components and keywords')}
      ${f('a.autoCycles', 'Automated regression runs', 'During the project')}
      ${f('a.analysisPer100', 'Failure analysis h per 100 scripts per run')}
      ${f('a.manualCycles', 'Manual execution cycles')}
      ${f('a.retestPct', 'Retest and defect verification % per cycle')}
    </div></section>
  <section class="panel"><h2>Scheduling rules</h2>
    <div class="fields">
      ${f('a.accessDays', 'Access and environment lead time (working days)', 'No scripting or execution before this; KT, design and framework can start')}
      ${f('a.frameworkGatePct', 'Framework core needed before scripting %', 'Share of framework hours done before scripting can start')}
      ${f('a.frameworkMaxPeople', 'People on framework at once', 'Framework work doesn’t split well across many people')}
      ${f('a.reviewDays', 'Client review of test cases (working days)', 'Designed test cases can be scripted or executed after this')}
      ${f('a.cycleGapDays', 'Gap between manual cycles (working days)', 'Waiting for the next build before the next cycle')}
    </div></section>
  <section class="panel"><div class="panel-head"><h2>One-time activities</h2><button class="btn" data-act="add-ot">Add activity</button></div>
    <p class="small muted">“When” places the activity in the schedule. Project start work is done by anyone in the first days. Framework work is done by automation people, and scripting waits for its usable core. Project end work happens once everything else is finished. Reduce framework hours if you’re extending an existing framework.</p>
    <div class="tbl-wrap"><table><thead><tr><th>Include</th><th>Activity</th><th>Hours</th><th>When</th><th></th></tr></thead><tbody>
    ${a.oneTime.map((o, i) => `<tr><td>${inp(`a.oneTime.${i}.on`, 'check', '', 'aria-label="Include"')}</td><td>${inp(`a.oneTime.${i}.name`, 'text', 'w-l')}</td><td>${inp(`a.oneTime.${i}.hours`, 'num')}</td><td>${sel(`a.oneTime.${i}.phase`, [['start', 'Project start'], ['framework', 'Framework'], ['end', 'Project end']])}</td><td><button class="btn ghost" data-act="rm-ot" data-i="${i}">Remove</button></td></tr>`).join('')}
    </tbody></table></div></section>
  <section class="panel"><h2>Risk range</h2>
    <div class="fields">${f('a.contingencyPct', 'Contingency buffer %', 'Added to the likely estimate')}${f('a.pertBest', 'Best case multiplier')}${f('a.pertWorst', 'Worst case multiplier')}</div>
    <p class="small muted">The status turns “At risk” when the likely finish is before the target but the worst-case finish isn’t.</p></section>
  <section class="panel"><h2>Team sizing</h2><p class="small muted">Used when the estimator works out how many people to add.</p>
    <div class="fields">
      ${a.levels.map(l => f(`a.teamMix.${l.key}`, `Mix: ${l.key} %`)).join('')}
      <label class="field"><span class="lbl">New hires’ tool skill</span>${sel('a.hireSkill', a.skills.map(x => x.key))}</label>
      <label class="field"><span class="lbl">New hires’ location</span>${sel('a.hireLocation', P.locations)}</label>
      ${f('a.leadSpan', 'Engineers per lead')}
      ${f('a.managerAbove', 'Add a manager above team size')}
      ${f('a.managerAlloc', 'Manager allocation %')}
    </div></section>
  <div class="row"><button class="btn" data-act="reset-factors">Reset all factors to defaults</button>${S.confirmReset ? `<span class="confirm">Reset every factor on this tab? <button class="btn danger" data-act="reset-yes">Reset</button><button class="btn" data-act="reset-no">Cancel</button></span>` : ''}</div>`;
}

/* ---------- Tracking ---------- */
function viewTracking() {
  const P = S.P, A = analysis(), T = E.tracking(P, S.actuals, A.sched);
  S.T = T;
  const rows = T.rows.map(r => `<tr>
    <td>${fd(r.week)}</td>
    ${['designed', 'executed', 'automated', 'hours'].map(k => `<td><input type="number" class="w-s" id="ac-${r.id}-${k}" data-ac="${r.id}" data-k="${k}" value="${r[k] ?? 0}" min="0" step="any"></td>`).join('')}
    <td><input type="text" class="w-l" id="ac-${r.id}-notes" data-ac="${r.id}" data-k="notes" value="${esc(r.notes || '')}" placeholder="Blockers, changes"></td>
    <td class="r num">${pct(r.pct)}</td><td class="r num">${r.plannedPct == null ? '—' : pct(r.plannedPct)}</td>
    <td><button class="btn ghost" data-act="rm-ac" data-id="${r.id}">Remove</button></td></tr>`).join('');
  const L = T.last;
  const spiState = T.spi == null ? null : T.spi >= 0.97 ? 'ok' : T.spi >= 0.85 ? 'risk' : 'no';
  const kpis = `<div class="kpis">
    <div class="kpi"><span class="lbl">Completed</span><span class="v">${L ? pct(L.pct) : '—'}</span><span class="small muted">weighted by effort</span></div>
    <div class="kpi"><span class="lbl">Planned by now</span><span class="v">${L && L.plannedPct != null ? pct(L.plannedPct) : '—'}</span><span class="small muted">${L ? 'end of week of ' + fd(L.week) : 'log a week to compare'}</span></div>
    <div class="kpi"><span class="lbl">Schedule index</span><span class="v">${T.spi == null ? '—' : T.spi.toFixed(2)}</span>${spiState ? pill(spiState, spiState === 'ok' ? 'On track' : spiState === 'risk' ? 'Slipping' : 'Behind') : '<span class="small muted">once planned work starts</span>'}</div>
    <div class="kpi"><span class="lbl">Earned h per logged h</span><span class="v">${T.eff == null ? '—' : T.eff.toFixed(2)}</span><span class="small muted">above 1 means faster than estimated</span></div>
    <div class="kpi"><span class="lbl">Forecast finish</span><span class="v" style="font-size:17px">${T.forecast ? fd(T.forecast) : '—'}</span><span class="small muted">plan: ${T.end ? fd(T.end) : '—'}</span></div>
  </div>`;
  return `<section class="panel">
    <div class="panel-head"><h2>Weekly actuals</h2><button class="btn primary" data-act="add-week">Log next week</button></div>
    <p class="small muted">Enter what was finished each week. Completion is weighted by the estimated hours of each item: a designed test case is worth ${nf1.format(T.designPerTC)} h, a manual execution ${nf1.format(T.execPerRun)} h and an automated test case ${nf1.format(T.autoPerTC)} h. The plan line follows the Schedule tab: setup and framework first, then design, scripting and execution.</p>
    ${kpis}
    <div class="tbl-wrap"><table><thead><tr><th>Week starting</th><th>Test cases designed</th><th>Manual executions</th><th>Test cases automated</th><th>Hours logged</th><th>Notes</th><th class="r">Done</th><th class="r">Plan</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="9" class="muted">No weeks logged yet. Select “Log next week” to add the first one.</td></tr>`}</tbody></table></div>
  </section>
  <section class="panel"><div class="panel-head"><h2>Planned against actual completion</h2><div class="legend"><span><i style="background:var(--s1)"></i>Planned</span><span><i style="background:var(--s2)"></i>Actual</span></div></div>
    <div class="chart" id="burn-chart"></div></section>`;
}
document.addEventListener('change', ev => {
  const el = ev.target; if (!el.dataset || !el.dataset.ac) return;
  const r = S.actuals.find(x => x.id === el.dataset.ac); if (!r) return;
  const k = el.dataset.k; const v = k === 'notes' ? el.value : Math.max(0, Number(el.value) || 0);
  saveActual({ ...r, [k]: v });
});

/* ---------- charts ---------- */
function lineChart(el, { series, refY, refX = [], yMax, yFmt, xDomain }) {
  if (!el) return;
  const W = Math.max(320, el.clientWidth || 800), Hh = 260, m = { l: 56, r: 16, t: 14, b: 28 };
  const all = series.flatMap(s => s.pts);
  if (!all.length) { el.innerHTML = '<p class="small muted">Nothing to chart yet.</p>'; return; }
  const xs = xDomain || [all.reduce((a, p) => p[0] < a ? p[0] : a, all[0][0]), all.reduce((a, p) => p[0] > a ? p[0] : a, all[0][0])];
  refX.forEach(r => { if (r.date > xs[1]) xs[1] = r.date; if (r.date < xs[0]) xs[0] = r.date; });
  const x0 = E.toD(xs[0]), x1 = Math.max(E.toD(xs[1]), x0 + 86400000);
  const ymax = yMax || Math.max(...all.map(p => p[1]), refY ? refY.value : 0) * 1.08 || 1;
  const X = d => m.l + (E.toD(d) - x0) / (x1 - x0) * (W - m.l - m.r);
  const Y = v => m.t + (1 - v / ymax) * (Hh - m.t - m.b);
  const ticks = 4, yt = [];
  for (let i = 0; i <= ticks; i++) yt.push(ymax * i / ticks);
  const nx = Math.max(2, Math.min(6, Math.floor((W - m.l - m.r) / 110)));
  const xt = []; for (let i = 0; i <= nx; i++) xt.push(E.toS(x0 + (x1 - x0) * i / nx));
  let s = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Line chart">`;
  yt.forEach(v => { s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)" stroke-width="1"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end">${yFmt(v)}</text>`; });
  xt.forEach((d, i) => { s += `<text x="${X(d)}" y="${Hh - 8}" text-anchor="${i === 0 ? 'start' : i === nx ? 'end' : 'middle'}">${fdShort(d)} ${d.slice(2, 4)}</text>`; });
  if (refY) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(refY.value)}" y2="${Y(refY.value)}" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${W - m.r}" y="${Y(refY.value) - 6}" text-anchor="end" style="fill:var(--ink)">${esc(refY.label)}</text>`;
  refX.forEach(r => { const xx = X(r.date); if (xx > W - 90) r.anchor = 'end'; if (xx < m.l + 90) r.anchor = 'start'; s += `<line x1="${xx}" x2="${xx}" y1="${m.t}" y2="${Hh - m.b}" stroke="var(--faint)" stroke-width="1" stroke-dasharray="2 3"/><text x="${xx + (r.anchor === 'end' ? -4 : 4)}" y="${m.t + 10 + (r.dy || 0)}" text-anchor="${r.anchor || 'start'}">${esc(r.label)}</text>`; });
  series.forEach(se => {
    if (!se.pts.length) return;
    const d = se.pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join('');
    if (se.area) s += `<path d="${d}L${X(se.pts[se.pts.length - 1][0])} ${Y(0)}L${X(se.pts[0][0])} ${Y(0)}Z" fill="${se.color}" opacity=".08"/>`;
    s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (se.markers) se.pts.forEach(p => { s += `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="4" fill="${se.color}" stroke="var(--surface)" stroke-width="2"/>`; });
  });
  s += `<line id="xh" x1="0" x2="0" y1="${m.t}" y2="${Hh - m.b}" stroke="var(--muted)" stroke-width="1" visibility="hidden"/>`;
  s += `<rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${Hh - m.t - m.b}" fill="transparent" id="hit"/></svg><div class="tip" hidden></div>`;
  el.innerHTML = s;
  const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), xh = el.querySelector('#xh');
  const move = ev => {
    const rc = svg.getBoundingClientRect(); const px = (ev.clientX - rc.left) * (W / rc.width);
    const t = x0 + (px - m.l) / (W - m.l - m.r) * (x1 - x0); const dStr = E.toS(Math.max(x0, Math.min(x1, t)));
    const vals = series.map(se => { let v = null, dd = null; for (const p of se.pts) { if (p[0] > dStr) break; v = p[1]; dd = p[0]; } return { se, v, dd }; }).filter(x => x.v != null);
    if (!vals.length) { tip.hidden = true; xh.setAttribute('visibility', 'hidden'); return; }
    xh.setAttribute('x1', X(dStr)); xh.setAttribute('x2', X(dStr)); xh.setAttribute('visibility', 'visible');
    tip.innerHTML = `<div class="muted">${fd(dStr)}</div>` + vals.map(x => `<div><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${x.se.color};margin-right:6px"></i>${esc(x.se.name)}: <b class="num">${yFmt(x.v)}</b>${x.se.markers && x.dd !== dStr ? ` <span class="muted">(${fdShort(x.dd)})</span>` : ''}</div>`).join('') + (refY ? `<div class="muted">${esc(refY.label)}: ${yFmt(refY.value)}</div>` : '');
    tip.hidden = false;
    const cx = (X(dStr) / W) * rc.width; tip.style.top = '8px';
    tip.style.left = (cx > rc.width / 2 ? cx - tip.offsetWidth - 12 : cx + 12) + 'px';
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerleave', () => { tip.hidden = true; xh.setAttribute('visibility', 'hidden'); });
}
function drawCapChart() {
  const P = S.P, A = analysis(), el = $('#cap-chart');
  if (!A.hasTeam || !P.start) { el.innerHTML = '<p class="small muted">Add team members to see capacity build up over time.</p>'; return; }
  const fin = A.finish && A.finish.likely.date;
  let until = [P.end, fin].filter(Boolean).sort().pop() || E.addDays(P.start, 180);
  if (!fin && P.end) until = E.addDays(P.end, Math.max(30, Math.round(E.daysBetween(P.start, P.end) * 0.5)));
  const cap = E.capacityIn(P, P.team, P.start, until);
  const step = Math.max(1, Math.floor(cap.curve.length / 160));
  const pts = cap.curve.filter((p, i) => i % step === 0 || i === cap.curve.length - 1);
  const refX = [];
  if (P.end) refX.push({ date: P.end, label: 'Target ' + fdShort(P.end), anchor: fin && fin > P.end ? 'end' : 'start' });
  if (fin && fin !== P.end) refX.push({ date: fin, label: 'Finish ' + fdShort(fin), anchor: P.end && fin < P.end ? 'end' : 'start', dy: 14 });
  lineChart(el, { series: [{ name: 'Productive capacity', color: 'var(--s1)', pts, area: true }], refY: { value: A.e.total, label: 'Effort needed ' + H(A.e.total) + ' h' }, refX, yFmt: v => nf0.format(v) + ' h', yMax: Math.max(A.e.total, cap.total) * 1.1 });
}
function drawBurnChart() {
  const T = S.T, el = $('#burn-chart'); if (!el || !T) return;
  if (!T.plan) { el.innerHTML = '<p class="small muted">Add team members and a start date to see the plan.</p>'; return; }
  const step = Math.max(1, Math.floor(T.plan.length / 160));
  const plan = T.plan.filter((p, i) => i % step === 0 || i === T.plan.length - 1).map(p => [p[0], p[1] * 100]);
  const act = T.rows.map(r => [E.addDays(r.week, 6), r.pct * 100]);
  const refX = []; if (S.P.end) refX.push({ date: S.P.end, label: 'Target', anchor: 'end' });
  if (T.forecast) refX.push({ date: T.forecast, label: 'Forecast', dy: 14 });
  lineChart(el, { series: [{ name: 'Planned', color: 'var(--s1)', pts: plan }, { name: 'Actual', color: 'var(--s2)', pts: act, markers: true }], refX, yMax: 100, yFmt: v => Math.round(v) + '%' });
}
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (S.tab === 'summary') drawCapChart(); if (S.tab === 'tracking') drawBurnChart(); if (S.tab === 'schedule') { drawGantt(); drawHeat(); } }, 150); });

/* ---------- Schedule tab ---------- */
const CAT = {
  setup: 'Onboarding and setup', framework: 'Framework and common code', design: 'Manual test design',
  script: 'Automation scripting', exec: 'Manual execution', runs: 'Regression runs', close: 'Closure and handover', idle: 'Waiting for work'
};
const CAT_ORDER = ['setup', 'framework', 'design', 'script', 'exec', 'runs', 'close'];
const catColor = c => `var(--c-${c})`;
const legendHTML = (cats, extra = '') => `<div class="legend">${cats.map(c => c === 'idle'
  ? `<span><i class="sw sw-idle"></i>${CAT.idle}</span>` : `<span><i class="sw" style="background:${catColor(c)}"></i>${CAT[c]}</span>`).join('')}${extra}</div>`;
const svgHatch = `<defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="var(--surface-2)"/><line x1="0" y1="0" x2="0" y2="5" stroke="var(--faint)" stroke-width="1.6"/></pattern></defs>`;
const fdMon = s => { const [y, m] = s.split('-'); return `${MON[+m - 1]} ${y}`; };

function milestonesPanel(A) {
  const P = S.P, sc = A.sched;
  if (!sc || !sc.ms) return '';
  const list = Object.entries(sc.ms).filter(([k]) => !k.endsWith(':done')).map(([k, v]) => ({ k, ...v }));
  if (P.end) list.push({ k: 'target', date: P.end, label: 'Target end date' });
  list.sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : (x.k === 'finish' ? 1 : -1));
  return `<section class="panel"><div class="panel-head"><h2>Key milestones</h2><button class="btn" data-tab="schedule">Open schedule</button></div>
    <div class="ms-list">${list.map(m => `<div class="ms ${m.k === 'finish' ? 'ms-finish' : m.k === 'target' ? 'ms-target' : ''}"><span class="num">${fd(m.date)}</span><span>${esc(m.label)}</span></div>`).join('')}</div></section>`;
}

function viewSchedule() {
  const P = S.P, A = analysis();
  if (!A.hasTeam) return `<section class="panel empty"><h2>No schedule yet</h2><p class="muted">Add people on the Team tab to see the schedule.</p></section>`;
  if (A.missing && A.missing.length) return `<section class="panel"><h2>No schedule yet</h2><p>${missingMsg(A.missing)}</p></section>`;
  const sc = A.sched;
  if (!sc || !sc.finish) return `<section class="panel"><h2>No schedule yet</h2><p class="muted">With the current team the work doesn’t finish within 3 years. Add people or reduce scope.</p></section>`;
  const used = CAT_ORDER.filter(c => Object.values(sc.rows).some(r => r.cat === c));
  const util = sc.work / (sc.work + sc.idle || 1);
  return `
  <div class="strip">${pill(...STATUS[A.status || 'estimate'])}<span>Start <b>${fd(P.start)}</b></span><span>Estimated finish <b>${fd(sc.finish)}</b></span><span>Working days <b>${nf0.format(sc.workdays)}</b></span><span>Target <b>${fd(P.end)}</b></span><span>Team busy <b>${pct(util)}</b></span></div>
  <section class="panel">
    <div class="panel-head"><h2>Phase timeline</h2>${legendHTML(used, `<span><i class="sw-line" style="border-color:var(--ink)"></i>Target</span><span><i class="sw-line" style="border-color:var(--accent);border-style:solid"></i>Finish</span><span><i class="sw-dia"></i>Milestone</span>`)}</div>
    <p class="small muted">Each cell is one week. Darker means more hours that week. Hover for details.</p>
    <div class="scroll-x" id="gantt"></div>
  </section>
  <section class="panel">
    <div class="panel-head"><h2>Who does what, week by week</h2>${legendHTML([...used, 'idle'])}</div>
    <p class="small muted">Bar height is the person’s productive hours that week (shorter for holidays, leave and ramp-up). Hatched means available but waiting for work.</p>
    <div class="scroll-x" id="heat"></div>
    ${peopleTable(sc)}
  </section>
  <section class="panel">
    <div class="panel-head"><h2>Calendar</h2><div class="legend"><span><i class="cal-key cal-hol"></i>Holiday</span><span><i class="cal-key cal-leave"></i>Leave</span><span><i class="cal-key cal-block"></i>Blocked window</span><span><i class="cal-key cal-ms"></i>Milestone</span><span><i class="cal-key cal-off"></i>Non-working day</span></div></div>
    <div class="months">${monthCalendars(A)}</div>
  </section>
  <section class="panel">
    <h2>Weekly plan</h2>
    <p class="small muted">Planned output per week. The “Planned done” column is the baseline the Tracking tab compares actuals against.</p>
    ${weeklyTable(A)}
  </section>`;
}

function weekDomain(A) {
  const P = S.P, sc = A.sched;
  let last = sc.finish;
  if (P.end && P.end > last) last = P.end;
  const nW = Math.floor(E.daysBetween(sc.weekStart, last) / 7) + 1;
  return { w0: sc.weekStart, nW, last };
}

function drawGantt() {
  const el = $('#gantt'); if (!el) return;
  const P = S.P, A = analysis(), sc = A.sched, { w0, nW } = weekDomain(A);
  const labelW = 210, rowH = 22, headH = 40;
  const avail = Math.max(320, el.clientWidth - labelW - 8);
  const colW = Math.max(12, Math.min(36, Math.floor(avail / nW)));
  const W = labelW + nW * colW + 8;
  const rows = [];
  const add = key => { const r = sc.rows[key]; if (r) rows.push({ type: 'row', r, label: CAT[r.cat] }); };
  add('setup'); add('framework');
  const modOrder = sc.mods;
  modOrder.forEach(m => {
    const pm = P.modules.find(x => x.id === m.id);
    rows.push({ type: 'group', label: m.name, from: pm && pm.availableFrom });
    ['design', 'script', 'exec', 'runs'].forEach(c => { const r = sc.rows[m.id + ':' + c]; if (r) rows.push({ type: 'row', r, label: CAT[c], indent: true }); });
  });
  add('close');
  const Hh = headH + rows.length * rowH + 8;
  const X = d => labelW + E.daysBetween(w0, d) / 7 * colW;
  let s = `<svg width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Phase timeline">${svgHatch}`;
  // header: months and week ticks
  let prevM = '';
  const every = colW >= 24 ? 1 : colW >= 16 ? 2 : 4;
  for (let w = 0; w < nW; w++) {
    const d = E.addDays(w0, w * 7), x = labelW + w * colW, mo = d.slice(0, 7);
    if (mo !== prevM) { s += `<text x="${x + 2}" y="14" class="g-month">${fdMon(d)}</text><line x1="${x}" x2="${x}" y1="20" y2="${Hh}" stroke="var(--line)"/>`; prevM = mo; }
    if (w % every === 0) s += `<text x="${x + colW / 2}" y="32" text-anchor="middle" class="g-week">${+d.slice(8)}</text>`;
  }
  rows.forEach((row, i) => {
    const y = headH + i * rowH;
    if (row.type === 'group') {
      s += `<rect x="0" y="${y}" width="${W}" height="${rowH}" fill="var(--surface-2)"/><text x="8" y="${y + 15}" class="g-group">${esc(row.label)}</text>`;
      if (row.from) { const x = X(row.from); s += `<path d="M${x} ${y + 5}l5 6l-5 6l-5 -6z" fill="var(--ink)" data-tip="${esc(row.label)} available from ${fd(row.from)}"/>`; }
      return;
    }
    const r = row.r, mx = Math.max(...Object.values(r.weeks));
    s += `<text x="${row.indent ? 22 : 8}" y="${y + 15}" class="g-label" data-tip="${esc(row.label)}: ${fd(r.first)} to ${fd(r.last)}, ${H(r.hours)} h">${esc(row.label)}</text>`;
    Object.entries(r.weeks).forEach(([w, h]) => {
      const x = labelW + (+w) * colW + 1, op = 0.35 + 0.65 * (h / mx);
      s += `<rect x="${x}" y="${y + 4}" width="${colW - 2}" height="${rowH - 8}" rx="2" fill="${catColor(r.cat)}" fill-opacity="${op.toFixed(2)}" data-tip="${esc(row.label)} · week of ${fd(E.addDays(w0, w * 7))}: ${H(h)} h"/>`;
    });
  });
  // milestones on framework row
  const fwIdx = rows.findIndex(x => x.r && x.r.key === 'framework');
  if (fwIdx >= 0 && sc.ms.fwCore) { const x = X(sc.ms.fwCore.date), y = headH + fwIdx * rowH; s += `<path d="M${x} ${y + 4}l6 7l-6 7l-6 -7z" fill="var(--ink)" stroke="var(--surface)" stroke-width="1.5" data-tip="Framework core ready: ${fd(sc.ms.fwCore.date)}. Scripting can start."/>`; }
  // target / finish / today lines
  const vline = (d, color, dash, label, anchorEnd) => { const x = X(d) + colW / 7; s += `<line x1="${x}" x2="${x}" y1="20" y2="${Hh}" stroke="${color}" stroke-width="1.5" ${dash ? 'stroke-dasharray="4 3"' : ''}/><text x="${x + (anchorEnd ? -4 : 4)}" y="${Hh - 4}" text-anchor="${anchorEnd ? 'end' : 'start'}" class="g-week" style="fill:${color}">${label}</text>`; };
  const nearEnd = d => X(d) > W - 120;
  if (P.end && P.end === sc.finish) vline(sc.finish, 'var(--accent)', false, 'Finish = target ' + fdShort(sc.finish), nearEnd(sc.finish));
  else {
    if (P.end) vline(P.end, 'var(--ink)', true, 'Target ' + fdShort(P.end), sc.finish > P.end || nearEnd(P.end));
    vline(sc.finish, 'var(--accent)', false, 'Finish ' + fdShort(sc.finish), (P.end && sc.finish < P.end) || nearEnd(sc.finish));
  }
  const today = E.toS(Date.now()); if (today > w0 && today < E.addDays(w0, nW * 7)) vline(today, 'var(--faint)', true, 'Today', false);
  s += '</svg>';
  el.innerHTML = s;
}

function drawHeat() {
  const el = $('#heat'); if (!el) return;
  const P = S.P, A = analysis(), sc = A.sched, { w0, nW } = weekDomain(A);
  const labelW = 210, rowH = 34, headH = 24, rightW = 60;
  const avail = Math.max(320, el.clientWidth - labelW - rightW - 8);
  const colW = Math.max(10, Math.min(30, Math.floor(avail / nW)));
  const W = labelW + nW * colW + rightW, Hh = headH + P.team.length * rowH + 4;
  let s = `<svg width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Weekly allocation by person">${svgHatch}`;
  let prevM = '';
  for (let w = 0; w < nW; w++) { const d = E.addDays(w0, w * 7), mo = d.slice(0, 7); if (mo !== prevM) { s += `<text x="${labelW + w * colW + 2}" y="14" class="g-month">${fdMon(d)}</text>`; prevM = mo; } }
  s += `<text x="${W - 4}" y="14" text-anchor="end" class="g-week">Busy</text>`;
  P.team.forEach((r, k) => {
    const y = headH + k * rowH, pw = sc.people[k].weeks, vals = Object.values(pw);
    const mx = Math.max(1, ...vals.map(v => v.cap));
    const work = vals.reduce((t, v) => t + v.cap - v.idle, 0), cap = vals.reduce((t, v) => t + v.cap, 0);
    s += `<text x="8" y="${y + 15}" class="g-label">${esc(r.name)}</text><text x="8" y="${y + 28}" class="g-week">${esc(r.role === 'Manager' ? 'Management' : r.activity)} · ${esc(r.level)}</text>`;
    s += `<line x1="${labelW}" x2="${labelW + nW * colW}" y1="${y + rowH - 2}" y2="${y + rowH - 2}" stroke="var(--line-2)"/>`;
    for (let w = 0; w < nW; w++) {
      const v = pw[w]; if (!v || v.cap <= 0) { if (v && v.off) s += `<rect x="${labelW + w * colW + 1}" y="${y + rowH - 5}" width="${colW - 2}" height="2" fill="var(--faint)" data-tip="${esc(r.name)} · week of ${fd(E.addDays(w0, w * 7))}: ${v.off} day${v.off > 1 ? 's' : ''} off"/>`; continue; }
      const full = rowH - 6, x = labelW + w * colW + 1, cw = colW - 2;
      let yy = y + rowH - 2;
      const tip = [`${esc(r.name)} · week of ${fd(E.addDays(w0, w * 7))}`];
      CAT_ORDER.forEach(c => { const h = v.cats[c]; if (!h) return; const hh = h / mx * full; yy -= hh; s += `<rect x="${x}" y="${yy}" width="${cw}" height="${hh}" fill="${catColor(c)}"/>`; tip.push(`${CAT[c]}: ${H(h)} h`); });
      if (v.idle > 0.05) { const hh = v.idle / mx * full; yy -= hh; s += `<rect x="${x}" y="${yy}" width="${cw}" height="${hh}" fill="url(#hatch)"/>`; tip.push(`Waiting for work: ${H(v.idle)} h`); }
      if (v.off) tip.push(`${v.off} day${v.off > 1 ? 's' : ''} off (holiday or leave)`);
      s += `<rect x="${x}" y="${y + 4}" width="${cw}" height="${full}" fill="transparent" data-tip="${tip.join('\n')}"/>`;
    }
    s += `<text x="${W - 4}" y="${y + 20}" text-anchor="end" class="g-label num">${cap > 0 ? pct(work / cap) : '—'}</text>`;
  });
  s += '</svg>';
  el.innerHTML = s;
}

function peopleTable(sc) {
  const P = S.P;
  const rows = P.team.map((r, k) => {
    const v = Object.values(sc.people[k].weeks), cats = {};
    let cap = 0, idle = 0;
    v.forEach(x => { cap += x.cap; idle += x.idle; Object.entries(x.cats).forEach(([c, h]) => cats[c] = (cats[c] || 0) + h); });
    const flag = cap > 0 && idle / cap >= 0.2;
    return `<tr><td>${esc(r.name)}</td>${CAT_ORDER.map(c => `<td class="r num">${cats[c] ? H(cats[c]) : ''}</td>`).join('')}<td class="r num">${H(idle)}</td><td class="r">${cap > 0 ? (flag ? pill('risk', pct(idle / cap) + ' waiting') : `<span class="num">${pct(idle / cap)}</span>`) : '—'}</td></tr>`;
  }).join('');
  return `<details class="howto"><summary>Hours by person and activity</summary><div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th>Name</th>${CAT_ORDER.map(c => `<th class="r">${CAT[c]}</th>`).join('')}<th class="r">Waiting h</th><th class="r">Waiting</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

function monthCalendars(A) {
  const P = S.P, a = P.a, sc = A.sched;
  let last = sc.finish; if (P.end && P.end > last) last = P.end;
  const ms = {};
  Object.entries(sc.ms).forEach(([k, v]) => { if (!k.endsWith(':done')) (ms[v.date] = ms[v.date] || []).push(v.label); });
  if (P.end) (ms[P.end] = ms[P.end] || []).push('Target end date');
  const hol = {};
  const locs = new Set(P.team.map(r => r.location));
  P.holidays.forEach(h => { if (locs.has(h.location)) (hol[h.date] = hol[h.date] || []).push(`${h.name} (${h.location})`); });
  const leaveOn = d => P.team.filter(r => (r.leaves || []).some(l => l.from && d >= l.from && d <= (l.to || l.from))).map(r => r.name);
  const blockOn = d => P.downtimes.filter(x => x.from && d >= x.from && d <= (x.to || x.from)).map(x => `${x.reason || 'Blocked window'} (${x.impact}% impact)`);
  const out = [];
  let [y, m] = P.start.split('-').map(Number);
  const [ly, lm] = last.split('-').map(Number);
  let count = 0;
  while ((y < ly || (y === ly && m <= lm)) && count < 24) {
    const first = `${y}-${String(m).padStart(2, '0')}-01`;
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lead = (E.dow(first) + 6) % 7;
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<div class="cd cd-pad"></div>';
    for (let dd = 1; dd <= dim; dd++) {
      const d = `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      const inProj = d >= P.start && d <= last;
      const work = a.workDays.includes(E.dow(d));
      const H_ = hol[d], L = inProj ? leaveOn(d) : [], B = inProj ? blockOn(d) : [], Mi = ms[d];
      const tip = [fd(d)];
      if (H_) tip.push('Holiday: ' + H_.join(', '));
      if (L.length) tip.push('On leave: ' + L.join(', '));
      if (B.length) tip.push('Blocked: ' + B.join(', '));
      if (Mi) tip.push(...Mi);
      const cls = ['cd', !work ? 'cd-off' : '', !inProj ? 'cd-out' : '', B.length ? 'cd-block' : '', Mi ? 'cd-ms' : ''].join(' ');
      cells += `<div class="${cls}" ${tip.length > 1 ? `data-tip="${esc(tip.join('\n'))}"` : ''}><span class="cd-n">${dd}</span><span class="cd-marks">${H_ ? '<i class="cal-key cal-hol"></i>' : ''}${L.length ? `<i class="cal-key cal-leave"></i>${L.length > 1 ? `<span class="cd-c">${L.length}</span>` : ''}` : ''}${Mi ? '<i class="cal-key cal-ms"></i>' : ''}</span></div>`;
    }
    out.push(`<div class="month"><div class="month-h">${MON[m - 1]} ${y}</div><div class="cal">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => `<div class="cd-h">${x}</div>`).join('')}${cells}</div></div>`);
    m++; if (m > 12) { m = 1; y++; } count++;
  }
  return out.join('') + (count >= 24 ? '<p class="small muted">Showing the first 24 months.</p>' : '');
}

function weeklyRows(A) {
  const P = S.P, sc = A.sched, T = E.tracking(P, [], sc);
  const planAt = d => { let v = 0; for (const [x, y] of T.plan || []) { if (x > d) break; v = y; } return v; };
  const ws = Object.entries(sc.weeks).map(([w, v]) => ({ w: +w, ...v })).sort((x, y) => x.w - y.w);
  return ws.map(v => {
    const main = CAT_ORDER.map(c => [c, v.cats[c] || 0]).sort((x, y) => y[1] - x[1]).filter(x => x[1] > 0).slice(0, 2).map(x => CAT[x[0]]);
    return { week: v.start, days: v.days || 0, design: v.design, script: v.script, exec: v.exec, cap: v.cap, idle: v.idle, done: planAt(E.addDays(v.start, 6)), main };
  });
}
function weeklyTable(A) {
  const rows = weeklyRows(A);
  return `<div class="tbl-wrap" style="max-height:520px;overflow:auto"><table><thead><tr><th>Week of</th><th class="r">Working days</th><th>Main work</th><th class="r">Test cases designed</th><th class="r">Test cases automated</th><th class="r">Manual executions</th><th class="r">Team productive h</th><th class="r">Waiting h</th><th class="r">Planned done</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${fd(r.week)}</td><td class="r num">${r.days}</td><td class="small main-work">${r.main.join(', ') || '<span class="muted">Holidays</span>'}</td><td class="r num">${r.design >= 0.5 ? nf0.format(r.design) : ''}</td><td class="r num">${r.script >= 0.5 ? nf0.format(r.script) : ''}</td><td class="r num">${r.exec >= 0.5 ? nf0.format(r.exec) : ''}</td><td class="r num">${H(r.cap)}</td><td class="r num">${r.idle >= 0.5 ? H(r.idle) : ''}</td><td class="r num">${pct(r.done)}</td></tr>`).join('')}
  </tbody></table></div>`;
}

/* floating tooltip for anything with data-tip */
(function () {
  const tip = document.createElement('div'); tip.className = 'tip ftip'; tip.hidden = true; document.body.appendChild(tip);
  let cur = null;
  document.addEventListener('pointerover', ev => {
    const t = ev.target.closest && ev.target.closest('[data-tip]');
    if (!t) { tip.hidden = true; cur = null; return; }
    if (t !== cur) { cur = t; tip.textContent = t.getAttribute('data-tip'); tip.hidden = false; }
  });
  document.addEventListener('pointermove', ev => {
    if (tip.hidden) return;
    const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = ev.clientY - h - pad;
    tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
  });
  document.addEventListener('pointerleave', () => { tip.hidden = true; });
  window.addEventListener('scroll', () => { tip.hidden = true; cur = null; }, true);
})();

/* ---------- actions ---------- */
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-act],[data-tab]'); if (!b) return;
  if (b.dataset.tab) { S.tab = b.dataset.tab; try { localStorage.setItem('tee.tab', S.tab); } catch (e) { } renderAll(); window.scrollTo({ top: 0 }); return; }
  const act = b.dataset.act, P = S.P, i = +b.dataset.i;
  const mut = fn => { fn(); touch(); };
  switch (act) {
    case 'new': createProject(false); break;
    case 'example': createProject(true); break;
    case 'dup': duplicateProject(); break;
    case 'del': S.confirmDel = true; renderHeader(); break;
    case 'del-no': S.confirmDel = false; renderHeader(); break;
    case 'del-yes': S.confirmDel = false; deleteProject(); break;
    case 'xlsx': exportXlsx(); break;
    case 'add-mod': mut(() => P.modules.push(E.newModule('Module ' + (P.modules.length + 1), P.modules.length + 1))); break;
    case 'rm-mod': mut(() => P.modules.splice(i, 1)); break;
    case 'add-res': mut(() => { const r = E.newResource(P.team.length + 1); r.location = P.locations[0]; P.team.push(r); }); break;
    case 'rm-res': mut(() => P.team.splice(i, 1)); break;
    case 'tog-leave': S.openLeaves[b.dataset.id] = !S.openLeaves[b.dataset.id]; renderAll(); break;
    case 'add-leave': mut(() => P.team[i].leaves.push({ from: P.start, to: P.start, note: '' })); break;
    case 'rm-leave': mut(() => P.team[i].leaves.splice(+b.dataset.j, 1)); break;
    case 'add-loc': mut(() => P.locations.push('Location ' + (P.locations.length + 1))); break;
    case 'rm-loc': mut(() => P.locations.splice(i, 1)); break;
    case 'add-hol': mut(() => P.holidays.push({ id: E.uid(), date: P.start, name: 'Holiday', location: P.locations[0] })); break;
    case 'rm-hol': mut(() => P.holidays.splice(i, 1)); break;
    case 'add-dt': mut(() => P.downtimes.push({ id: E.uid(), from: P.start, to: P.start, impact: 100, reason: '' })); break;
    case 'rm-dt': mut(() => P.downtimes.splice(i, 1)); break;
    case 'add-ot': mut(() => P.a.oneTime.push({ id: E.uid(), name: 'New activity', hours: 8, phase: 'start', on: true })); break;
    case 'rm-ot': mut(() => P.a.oneTime.splice(i, 1)); break;
    case 'reset-factors': S.confirmReset = true; renderAll(); break;
    case 'reset-no': S.confirmReset = false; renderAll(); break;
    case 'reset-yes': S.confirmReset = false; mut(() => { P.a = E.defaults(); }); break;
    case 'add-week': {
      const weeks = S.actuals.map(x => x.week).sort();
      const wk = weeks.length ? E.addDays(weeks[weeks.length - 1], 7) : E.mondayOf(P.start);
      saveActual({ id: wk, week: wk, designed: 0, executed: 0, automated: 0, hours: 0, notes: '' });
      break;
    }
    case 'rm-ac': deleteActual(b.dataset.id); break;
  }
});
document.addEventListener('change', ev => {
  const el = ev.target; if (el.dataset.act !== 'wd') return;
  const d = +el.dataset.d, wd = S.P.a.workDays;
  if (el.checked && !wd.includes(d)) wd.push(d); if (!el.checked) S.P.a.workDays = wd.filter(x => x !== d);
  touch();
});

/* ---------- Excel export ---------- */
async function exportXlsx() {
  const P = S.P, A = analysis(), e = A.e, a = P.a;
  if (typeof XLSX === 'undefined') { S.saving = 'Excel library didn’t load'; renderHeader(); return; }
  if (!S.dl) { S.saving = 'Downloads aren’t available in this view'; renderHeader(); return; }
  const wb = XLSX.utils.book_new();
  const add = (name, rows, widths) => { const ws = XLSX.utils.aoa_to_sheet(rows); if (widths) ws['!cols'] = widths.map(w => ({ wch: w })); XLSX.utils.book_append_sheet(wb, ws, name); };
  const r1 = v => Math.round(v * 10) / 10;
  const st = STATUS[A.status || 'nodate'][1];
  const sum = [
    ['Project', P.name], ['Client', P.client], ['Start date', P.start], ['Target end date', P.end || ''], ['Status', st], [],
    ['Total effort (likely), hours', r1(e.total)], ['Total effort (likely), person-days', r1(e.total / a.hoursPerDay)],
    ['Best case, hours', r1(e.total * a.pertBest)], ['Worst case, hours', r1(e.total * a.pertWorst)], ['PERT expected, hours', r1(A.expectedTotal)], [],
    ['Test cases', Math.round(e.tcs)], ['Test cases to automate', Math.round(e.autoTCs)], []
  ];
  if (A.finish) sum.push(['Finish with current team (likely)', A.finish.likely.date || 'Not reachable'], ['Finish (best)', A.finish.best.date || ''], ['Finish (worst)', A.finish.worst.date || '']);
  if (A.need) sum.push(['Extra engineers needed by target', A.need.extra ?? 'Over 300'], ['Extra engineers for worst case', A.needWorst.extra ?? 'Over 300'], ['Mix of extra engineers', (A.need.heads || []).map(h => h.n + ' x ' + h.level).join(', ')], ['Extra leads', A.need.needLeads || 0], ['Extra manager', A.need.needMgr || 0]);
  if (A.scope) sum.push(['Share of scope achievable by target', r1(A.scope.f * 100) + '%'], ['Test cases achievable by target', Math.floor(e.tcs * Math.min(A.scope.f, 1))]);
  if (A.window) sum.push([], ['Productive capacity in window, hours', r1(A.window.total)]);
  add('Summary', sum, [40, 30]);
  const L = e.lines;
  add('Effort', [['Activity', 'Hours', 'Person-days'], ...[['Manual test design', L.design], ['Manual execution', L.exec], ['Automation scripting', L.script], ['Review and rework', L.review], ['Script maintenance', L.maint], ['Automation runs and failure analysis', L.autoExec], ['One-time activities', L.oneTime], ['Contingency', L.contingency], ['Total', e.total]].map(([n, h]) => [n, r1(h), r1(h / a.hoursPerDay)])], [38, 12, 12]);
  add('Modules', [['Module', 'App type', 'Test cases', ...a.complexity.map(c => c.name + ' %'), 'Design', 'Manual run', 'Automate', 'To automate %', 'Test data', 'Manual h', 'Automation h'],
    ...P.modules.map((m, i) => [m.name, m.appType, m.tcs, ...a.complexity.map(c => m.mix[c.key]), m.design ? 'Yes' : 'No', m.manualExec ? 'Yes' : 'No', m.automation ? 'Yes' : 'No', m.autoPct, m.testData, r1(e.mods[i].manual), r1(e.mods[i].auto)])], [28, 12, 10]);
  add('Team', [['Name', 'Role', 'Works on', 'Experience', 'Tool skill', 'Allocation %', 'Location', 'From', 'To', 'Leave', 'Productive h in window'],
    ...P.team.map((r, i) => [r.name, r.role, r.activity, r.level, r.skill, r.alloc, r.location, r.start || P.start, r.end || '', r.leaves.map(l => l.from + ' to ' + (l.to || l.from)).join('; '), A.window ? r1(A.window.per[i]) : ''])], [24, 10, 12, 12, 18, 12, 10, 12, 12, 30, 20]);
  if (A.window) { const d = A.window.ded; add('Capacity', [['Item', 'Hours'], ['Gross hours', r1(d.gross)], ['Public holidays', -r1(d.holidays)], ['Planned leave', -r1(d.leave)], ['Non-development time', -r1(d.nonDev)], ['Unplanned leave', -r1(d.unplanned)], ['Downtime', -r1(d.downtime)], ['Ramp-up', -r1(d.ramp)], ['Experience and skill adjustment', r1(d.productivity)], ['Productive capacity', r1(A.window.total)]], [36, 12]); }
  const fac = [['Factor', 'Value'], ['Hours per day', a.hoursPerDay], ['Working days', a.workDays.map(d => DOWN[d]).join(', ')],
    ...a.complexity.flatMap(c => [[c.name + ': design h', c.design], [c.name + ': manual run h', c.exec], [c.name + ': automation h', c.auto]]),
    ...a.appTypes.map(x => ['App type factor: ' + x.key, x.factor]), ...a.testData.map(x => ['Test data factor: ' + x.key, x.factor]),
    ...a.levels.map(x => ['Productivity: ' + x.label, x.productivity]), ...a.levels.map(x => ['Ramp-up days: ' + x.key, x.rampDays]),
    ...a.skills.map(x => ['Tool skill factor: ' + x.key, x.factor]), ...a.roles.map(x => ['Non-development %: ' + x.key, x.nonDevPct]),
    ['Unplanned leave %', a.unplannedLeavePct], ['Everyday downtime %', a.downtimePct], ['Review and rework %', a.reviewPct], ['Script maintenance %', a.maintenancePct],
    ['Reusability saving %', a.reusePct], ['Automated regression runs', a.autoCycles], ['Failure analysis h per 100 scripts per run', a.analysisPer100],
    ['Manual execution cycles', a.manualCycles], ['Retest %', a.retestPct], ['Contingency %', a.contingencyPct], ['Access lead time (working days)', a.accessDays], ['Framework core before scripting %', a.frameworkGatePct], ['People on framework at once', a.frameworkMaxPeople], ['Client review (working days)', a.reviewDays], ['Gap between manual cycles (working days)', a.cycleGapDays], ['Best case multiplier', a.pertBest], ['Worst case multiplier', a.pertWorst],
    [], ['One-time activity', 'Hours'], ...a.oneTime.filter(o => o.on).map(o => [o.name + ' (' + o.phase + ')', o.hours])];
  add('Factors', fac, [44, 14]);
  if (A.sched && A.sched.finish) {
    const sc = A.sched;
    add('Weekly plan', [['Week of', 'Working days', 'Main work', 'Test cases designed', 'Test cases automated', 'Manual executions', 'Team productive h', 'Waiting h', 'Planned done %'],
      ...weeklyRows(A).map(r => [r.week, r.days, r.main.join(', '), r1(r.design), r1(r.script), r1(r.exec), r1(r.cap), r1(r.idle), r1(r.done * 100)])], [12, 12, 40, 12, 12, 12, 14, 10, 12]);
    const modName = id => (sc.mods.find(m => m.id === id) || {}).name || '';
    add('Timeline', [['Activity', 'Module', 'Start', 'End', 'Hours'], ...Object.values(sc.rows).sort((x, y) => x.first < y.first ? -1 : 1).map(r => [CAT[r.cat], r.mod ? modName(r.mod) : '', r.first, r.last, r1(r.hours)])], [28, 28, 12, 12, 10]);
    add('Milestones', [['Date', 'Milestone'], ...Object.values(sc.ms).sort((x, y) => x.date < y.date ? -1 : 1).map(m => [m.date, m.label]), ...(P.end ? [[P.end, 'Target end date']] : [])], [12, 40]);
    add('People by week', [['Person', 'Week of', ...CAT_ORDER.map(c => CAT[c] + ' h'), 'Waiting h', 'Days off'],
      ...P.team.flatMap((r, k) => Object.entries(sc.people[k].weeks).sort((x, y) => +x[0] - +y[0]).map(([w, v]) => [r.name, E.addDays(sc.weekStart, +w * 7), ...CAT_ORDER.map(c => r1(v.cats[c] || 0)), r1(v.idle), v.off]))], [24, 12]);
  }
  add('Calendar', [['Date', 'Holiday', 'Location'], ...P.holidays.slice().sort((x, y) => x.date < y.date ? -1 : 1).map(h => [h.date, h.name, h.location]), [], ['Blocked from', 'To', 'Impact %', 'Reason'], ...P.downtimes.map(d => [d.from, d.to, d.impact, d.reason])], [14, 30, 12, 30]);
  if (S.actuals.length) { const T = E.tracking(P, S.actuals, A.sched); add('Actuals', [['Week starting', 'Designed', 'Manual executions', 'Automated', 'Hours logged', 'Notes', 'Done %', 'Planned %'], ...T.rows.map(r => [r.week, r.designed, r.executed, r.automated, r.hours, r.notes || '', r1(r.pct * 100), r.plannedPct == null ? '' : r1(r.plannedPct * 100)])], [14, 10, 16, 10, 12, 30, 10, 10]); }
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const fname = (P.name || 'estimate').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) + ' - estimate.xlsx';
  try { await S.dl.save({ filename: fname, data: new Blob([buf]) }); }
  catch (err) { if (err.code !== 'declined') { S.saving = 'Export didn’t complete'; renderHeader(); } }
}

/* ---------- boot ---------- */
(async function boot() {
  try { const t = localStorage.getItem('tee.tab'); if (t) S.tab = t; } catch (e) { }
  S.loading = true; renderAll();
  const claude = window.claude;
  const [db, dl] = await Promise.all([
    claude ? claude.use('db').catch(() => null) : null,
    claude ? claude.use('downloads').catch(() => null) : null
  ]);
  S.dl = dl || false; S.db = db;
  if (!db) {
    S.local = true; S.loading = false;
    const P = exampleProject(); const id = 'local';
    S.list = [{ id, name: P.name, client: P.client, data: P }];
    openProject(id); return;
  }
  let first = true;
  const timer = setTimeout(() => { if (first) { S.loading = false; S.timeoutNote = 'Saved projects can’t be reached yet. They’ll appear here when the connection returns.'; renderAll(); } }, 10000);
  db.collection('projects').orderBy('updatedAt', 'desc').onSnapshot(snap => {
    S.list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!snap.metadata.fromCache) { clearTimeout(timer); S.timeoutNote = ''; }
    S.loading = false;
    if (first) {
      first = false;
      let last = null; try { last = localStorage.getItem('tee.last'); } catch (e) { }
      const pick = S.list.find(x => x.id === last) || S.list[0];
      if (pick) openProject(pick.id); else renderAll();
      return;
    }
    if (S.id) {
      const cur = S.list.find(x => x.id === S.id);
      if (!cur) { S.P = null; S.id = null; if (S.list.length) openProject(S.list[0].id); else renderAll(); return; }
      // someone else changed the open project, and we have no unsaved edits: take theirs
      if (cur.rev && cur.rev !== S.rev && S.saving !== 'Unsaved' && S.saving !== 'Saving…') {
        S.P = migrate(JSON.parse(JSON.stringify(cur.data))); S.rev = cur.rev; S.A = null; renderAll(); return;
      }
    }
    renderHeader();
  }, err => { S.loading = false; S.timeoutNote = 'Saved projects couldn’t be loaded.'; renderAll(); });
})();
