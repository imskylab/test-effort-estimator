/* ===== UI ===== */
const E = ENGINE;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const H = h => nf0.format(Math.round(h || 0));
const PD = h => nf1.format((h || 0) / (S.P ? S.P.a.hoursPerDay : 8));
const pct = v => nf0.format(Math.round((v || 0) * 100)) + '%';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fd = s => { if (!s) return '—'; const [y, m, d] = s.split('-'); return `${+d} ${MON[+m - 1]} ${y}`; };
const fdShort = s => { const [, m, d] = s.split('-'); return `${+d} ${MON[+m - 1]}`; };
const DOWN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Name shown in the page; set per organisation (see lib/brand.js).
const BRAND = Object.assign({ name: 'QuEST' }, typeof window !== 'undefined' && window.BRAND || {});
const S = { db: null, dl: null, list: [], all: [], id: null, P: null, actuals: [], tab: 'summary', saving: '', rev: null,
  local: false, unsubP: null, unsubA: null, openLeaves: {}, confirmDel: false, A: null };

/* ---------- persistence ---------- */
let saveTimer = null;
function touch() {
  S.editSeq = (S.editSeq || 0) + 1;
  S.Aprev = S.A || S.Aprev; S.A = null; S.calculating = false;
  S.saving = 'Unsaved';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 700);
  renderSoon();
}
/* Plans are merged in "units": scalar fields, each factor group, each module / person / holiday /
 * window by id, the baseline and its history. Units changed by only one side are taken from that
 * side; units changed by both, differently, are conflicts the user decides. */
const ARRAYS = ['modules', 'team', 'holidays', 'downtimes'];
const A_ROWS = { complexity: 'key', appTypes: 'key', testData: 'key', levels: 'key', skills: 'key', roles: 'key', oneTime: 'id' };
const TOP = ['name', 'client', 'start', 'end', 'locations', 'baseline', 'baselineHistory'];
const ROW = '__row__';
// Flatten a plan into small "units": each field of each module, person, holiday and factor row is its own unit.
function planUnits(P) {
  const u = {};
  const rows = (prefix, arr, idk) => (arr || []).forEach((x, i) => {
    const id = String(x && x[idk] != null ? x[idk] : 'i' + i);
    u[`${prefix}#${id}`] = ROW;
    Object.entries(x || {}).forEach(([f, v]) => { u[`${prefix}#${id}.${f}`] = v; });
  });
  TOP.forEach(k => { if (P[k] !== undefined) u[k] = P[k]; });
  Object.entries(P.notes || {}).forEach(([k, v]) => { u['notes.' + k] = v; });
  Object.entries(P.a || {}).forEach(([k, v]) => {
    if (A_ROWS[k] && Array.isArray(v)) rows('a.' + k, v, A_ROWS[k]);
    else if (v && typeof v === 'object' && !Array.isArray(v)) Object.entries(v).forEach(([kk, vv]) => { u[`a.${k}.${kk}`] = vv; });
    else u['a.' + k] = v;
  });
  ARRAYS.forEach(k => rows(k, P[k], 'id'));
  return u;
}
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const rowOf = k => { const m = k.match(/^(.*#[^.]*)\./); return m ? m[1] : null; };
// Three-way merge: units changed by one side come from that side; units both changed differently are conflicts.
function merge3(base, mine, theirs) {
  const B = planUnits(base), M = planUnits(mine), T = planUnits(theirs);
  const keys = new Set([...Object.keys(B), ...Object.keys(M), ...Object.keys(T)]);
  const out = {}, conflicts = [], rowConflicts = new Set();
  keys.forEach(k => {
    const b = B[k], m = M[k], t = T[k];
    if (same(m, t)) { if (m !== undefined) out[k] = m; }
    else if (same(m, b)) { if (t !== undefined) out[k] = t; }
    else if (same(t, b)) { if (m !== undefined) out[k] = m; }
    else {
      // one side removed the whole row while the other edited it: ask about the row, not the field
      const r = rowOf(k);
      if (r && (M[r] === undefined || T[r] === undefined)) { rowConflicts.add(r); if (m !== undefined) out[k] = m; return; }
      conflicts.push({ key: k, mine: m, theirs: t }); if (m !== undefined) out[k] = m;
    }
  });
  rowConflicts.forEach(r => {
    conflicts.push({ key: r, mine: M[r], theirs: T[r], row: true });
    // keep the row for now; the user's choice decides
    out[r] = ROW;
    const pre = r + '.';
    Object.keys(M).forEach(k => { if (k.startsWith(pre) && !(k in out)) out[k] = M[k]; });
    Object.keys(T).forEach(k => { if (k.startsWith(pre) && !(k in out)) out[k] = T[k]; });
  });
  return { units: out, conflicts, order: { mine, theirs }, M, T };
}
function buildPlan(units, mine, theirs) {
  const P = JSON.parse(JSON.stringify(mine));
  TOP.forEach(k => { if (k in units) P[k] = units[k]; else delete P[k]; });
  P.notes = {};
  const a = {};
  const idsOf = prefix => {
    const ids = [], re = new RegExp('^' + prefix.replace(/[.#]/g, '\\$&') + '#([^.]*)$');
    [theirs, mine].forEach(src => Object.keys(planUnits(src)).forEach(k => { const m = k.match(re); if (m && !ids.includes(m[1])) ids.push(m[1]); }));
    Object.keys(units).forEach(k => { const m = k.match(re); if (m && !ids.includes(m[1])) ids.push(m[1]); });
    return ids;
  };
  const rowsOf = prefix => idsOf(prefix).filter(id => units[`${prefix}#${id}`] === ROW).map(id => {
    const o = {}, pre = `${prefix}#${id}.`;
    Object.entries(units).forEach(([k, v]) => { if (k.startsWith(pre)) o[k.slice(pre.length)] = v; });
    return o;
  });
  Object.entries(units).forEach(([k, v]) => {
    if (k.startsWith('notes.')) P.notes[k.slice(6)] = v;
    else if (k.startsWith('a.') && !k.includes('#')) {
      const parts = k.slice(2).split('.');
      if (parts.length === 1) a[parts[0]] = v; else { a[parts[0]] = a[parts[0]] || {}; a[parts[0]][parts.slice(1).join('.')] = v; }
    }
  });
  Object.keys(A_ROWS).forEach(k => { const r = rowsOf('a.' + k); if (r.length) a[k] = r; });
  P.a = a;
  ARRAYS.forEach(k => { P[k] = rowsOf(k); });
  return P;
}
const FIELD_NAMES = { tcs: 'test cases', autoPct: '% to automate', mix: 'complexity mix', appType: 'app type', priority: 'priority', availableFrom: 'available from', testData: 'test data', design: 'manual design', manualExec: 'manual execution', automation: 'automation', name: 'name',
  role: 'role', activity: 'works on', level: 'experience', skill: 'tool skill', alloc: 'allocation', location: 'location', start: 'start', end: 'end', leaves: 'leave',
  date: 'date', design_: 'design hours', auto: 'automation hours', exec: 'manual run hours', factor: 'factor', productivity: 'productivity', rampDays: 'ramp-up days', hours: 'hours', phase: 'when', on: 'included', nonDevPct: 'non-development %', extraRamp: 'extra ramp days', impact: 'impact', reason: 'reason', from: 'from', to: 'to' };
function unitLabel(key, M) {
  const m = key.match(/^(a\.)?([A-Za-z]+)#([^.]*)(?:\.(.+))?$/);
  if (m) {
    const [, isA, coll, id, field] = m;
    const pick = src => ((isA ? (src.a || {})[coll] : src[coll]) || []).find(x => String(x.id != null ? x.id : x.key) === id);
    const row = pick(M.mine || {}) || pick(M.theirs || {}) || {};
    const what = { modules: 'Module', team: 'Team member', holidays: 'Holiday', downtimes: 'Blocked window', complexity: 'Complexity level', appTypes: 'App type', testData: 'Test data level', levels: 'Experience level', skills: 'Tool skill', roles: 'Role', oneTime: 'One-time activity' }[coll] || coll;
    const nm = row.name || row.label || row.key || row.date || '';
    const fieldName = isA && coll === 'complexity' && field === 'design' ? 'design hours' : (FIELD_NAMES[field] || field);
    return `${what}${nm ? ` “${nm}”` : ''}${field ? ': ' + fieldName : ' (removed by one person, edited by the other)'}`;
  }
  if (key.startsWith('a.')) return `Factor “${key.slice(2)}”`;
  if (key.startsWith('notes.')) return `Notes: ${key.slice(6)}`;
  return { name: 'Project name', client: 'Client', start: 'Start date', end: 'Target end date', locations: 'Locations', baseline: 'Baseline', baselineHistory: 'Baseline history' }[key] || key;
}
const brief = v => {
  if (v === undefined) return 'removed';
  if (v === ROW) return 'kept';
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
  if (v && typeof v === 'object') return typeof v.at === 'string' ? `frozen ${fd(v.at)}` : JSON.stringify(v).slice(0, 40);
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  return String(v) === '' ? 'empty' : String(v).slice(0, 40);
};

// Viewers can try what-ifs on screen, but nothing they change is written.
const canWrite = () => S.db && !S.local && !S.viewOnly;
async function saveNow() {
  if (!S.P || !S.id) return;
  if (S.viewOnly) { S.saving = 'View only: changes aren’t saved'; renderHeader(); return; }
  if (S.local || !S.db) { S.saving = S.local ? 'Not saved (offline view)' : ''; const l = S.list.find(x => x.id === S.id); if (l) { l.name = S.P.name; l.client = S.P.client; } renderHeader(); return; }
  if (S.conflict) { S.saving = 'Not saved: choose a version first'; renderHeader(); return; }
  const ref = S.db.doc('projects/' + S.id);
  S.saving = 'Saving…'; renderHeader();
  try {
    // Has anyone saved since we loaded? (The self-hosted server also checks this atomically.)
    const cur = await ref.get();
    if (cur.exists && cur.data().deletedAt) { S.deletedNotice = { by: cur.data().deletedBy, at: cur.data().deletedAt }; S.saving = 'Not saved'; renderAll(); return; }
    if (cur.exists && cur.data().rev && S.rev && cur.data().rev !== S.rev) return mergeWith(cur.data());
    await writePlan(ref);
  } catch (e) {
    if (e.code === 'conflict') { S.pendingRev = null; return mergeWith(e.current); }
    if (e.code === 'deleted') { S.pendingRev = null; S.deletedNotice = { by: e.deletedBy, at: e.deletedAt }; S.saving = 'Not saved'; renderAll(); return; }
    S.saving = e.code === 'invalid_argument' ? (e.message && !/^invalid/.test(e.message) ? 'Not saved: ' + e.message : 'Read-only: you can view but not save') : e.code === 'quota_exceeded' ? 'Storage full: delete old projects' : 'Save failed, will retry on next edit';
  }
  S.pendingRev = null;
  renderHeader();
}
async function writePlan(ref, note, restore) {
  const rev = E.uid();
  S.pendingRev = rev;
  const data = JSON.parse(JSON.stringify(S.P));
  const body = { name: S.P.name, client: S.P.client || '', updatedAt: Date.now(), rev, data };
  if (S.rev && !restore) body.prevRev = S.rev;
  if (restore) body.restore = true;
  await ref.set(body);
  S.rev = rev; S.baseP = data; S.saving = note || 'Saved';
}
// Someone else saved first: merge their changes with ours; ask only about fields both changed.
async function mergeWith(theirsDoc) {
  let theirs;
  try { theirs = migrate(JSON.parse(JSON.stringify(theirsDoc.data))); } catch (e) { return setConflict(theirsDoc, []); }
  const base = S.baseP || theirs;
  const M = merge3(base, S.P, theirs);
  if (!M.conflicts.length) {
    S.P = buildPlan(M.units, S.P, theirs); S.A = null; S.Aprev = null;
    S.rev = theirsDoc.rev;
    try { await writePlan(S.db.doc('projects/' + S.id), `Saved, merged with ${theirsDoc.updatedBy || 'a colleague'}’s changes`); }
    catch (e) { if (e.code === 'conflict') return mergeWith(e.current); S.saving = 'Save failed, will retry on next edit'; }
    S.pendingRev = null; renderAll(); return;
  }
  setConflict(theirsDoc, M.conflicts, M, theirs);
}
function setConflict(theirsDoc, conflicts, M, theirs) {
  S.conflict = { theirs: theirsDoc, theirsP: theirs, by: theirsDoc && theirsDoc.updatedBy, at: theirsDoc && theirsDoc.updatedAt, conflicts: conflicts || [], M };
  S.saving = 'Not saved';
  renderAll();
}
function deletedBanner() {
  const d = S.deletedNotice; if (!d) return '';
  const when = d.at ? new Date(d.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
  return `<div class="banner conflict" role="alert"><b>${esc(d.by || 'A colleague')} deleted this project${when ? ' on ' + when : ''}.</b> Your recent changes aren’t saved.
    <div class="row" style="margin-top:8px"><button class="btn" data-act="restore-mine">Restore the project with my changes</button><button class="btn" data-act="leave-deleted">Leave it deleted</button></div></div>`;
}
function conflictBanner() {
  const c = S.conflict; if (!c) return '';
  const when = c.at ? new Date(c.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const who = esc(c.by || 'Someone else');
  if (!c.conflicts.length) return `<div class="banner conflict" role="alert"><b>${who} saved this project${when ? ' at ' + when : ''}, and it couldn’t be merged with your changes.</b>
    <div class="row" style="margin-top:8px"><button class="btn" data-act="conflict-theirs">Load their version (discard mine)</button><button class="btn danger" data-act="conflict-mine">Keep mine (overwrite theirs)</button></div></div>`;
  return `<div class="banner conflict" role="alert"><b>${who} saved this project${when ? ' at ' + when : ''} while you were editing.</b> Their other changes have been merged with yours. You both changed:
    <ul class="bul" style="margin:6px 0">${c.conflicts.map(x => `<li>${esc(unitLabel(x.key, c.M.order))}: yours <b>${esc(brief(x.mine))}</b>, theirs <b>${esc(brief(x.theirs))}</b></li>`).join('')}</ul>
    <div class="row"><button class="btn" data-act="conflict-use-theirs">Use theirs for these</button><button class="btn" data-act="conflict-use-mine">Use mine for these</button></div></div>`;
}
async function resolveConflict(useMine) {
  const c = S.conflict; if (!c) return;
  const units = Object.assign({}, c.M.units);
  c.conflicts.forEach(x => { const v = useMine ? x.mine : x.theirs; if (v === undefined) delete units[x.key]; else units[x.key] = v; });
  S.P = buildPlan(units, S.P, c.theirsP); S.A = null; S.Aprev = null;
  S.rev = c.theirs.rev; S.conflict = null;
  try { await writePlan(S.db.doc('projects/' + S.id), 'Saved'); } catch (e) { if (e.code === 'conflict') return mergeWith(e.current); S.saving = 'Save failed'; }
  S.pendingRev = null; renderAll();
}
function openProject(id) {
  if (S.unsubA) { S.unsubA(); S.unsubA = null; }
  S.id = id; S.A = null; S.Aprev = null; S.calculating = false; S.editSeq = (S.editSeq || 0) + 1; S.confirmDel = false; S.actuals = [];
  const l = S.list.find(x => x.id === id);
  S.loadError = ''; S.conflict = null;
  S.repaired = null; S.deletedNotice = null; S.calcError = null; S.showDeleted = false;
  try { S.P = l && l.data ? migrate(JSON.parse(JSON.stringify(l.data))) : null; S.baseP = S.P ? JSON.parse(JSON.stringify(S.P)) : null; if (S.P && S.P._repaired) S.repaired = S.P._repaired; }
  catch (e) { S.P = null; S.loadError = `“${(l && l.name) || 'This project'}” couldn’t be opened because its saved data is damaged. Pick another project, or restore it from the backups folder on the server.`; }
  S.rev = l ? l.rev : null;
  try { localStorage.setItem('tee.last', id); } catch (e) { }
  if (S.db && !S.local) {
    S.unsubA = S.db.collection('projects/' + id + '/actuals').onSnapshot(snap => {
      S.actuals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      S.actSeen = {}; S.actuals.forEach(r => seen(r.id, r));
      if (S.tab === 'tracking') renderSoon();
    }, err => { S.saving = 'Weekly actuals couldn’t be loaded' + (err && err.message ? ': ' + err.message : ''); renderHeader(); });
  } else {
    S.actuals = (S.localActuals && S.localActuals[id]) || [];
  }
  renderAll();
}
function migrate(P) { return E.migrate(P); }
async function createProject(fromExample) {
  if (S.viewOnly) { toast('You have view-only access, so you can’t create projects.'); return; }
  const P = fromExample ? exampleProject() : E.newProject('New project');
  const id = 'p' + Date.now().toString(36) + E.uid().slice(0, 4);
  const doc = { name: P.name, client: P.client, updatedAt: Date.now(), rev: E.uid(), data: P };
  if (S.db && !S.local) {
    try { await S.db.doc('projects/' + id).set(doc); }
    catch (e) { S.saving = e.code === 'invalid_argument' ? 'You have view access only, so new projects can’t be saved' : 'Couldn’t create the project'; renderHeader(); return; }
  }
  if (!S.list.find(x => x.id === id)) { S.list.unshift({ id, ...doc }); S.all.unshift(S.list[0]); }
  S.tab = 'summary';
  openProject(id);
}
async function duplicateProject() {
  if (!S.P) return;
  if (S.viewOnly) { toast('You have view-only access, so you can’t create projects.'); return; }
  const P = JSON.parse(JSON.stringify(S.P)); P.name = P.name + ' (copy)';
  const id = 'p' + Date.now().toString(36) + E.uid().slice(0, 4);
  const doc = { name: P.name, client: P.client || '', updatedAt: Date.now(), rev: E.uid(), data: P };
  if (S.db && !S.local) { try { await S.db.doc('projects/' + id).set(doc); } catch (e) { return; } }
  if (!S.list.find(x => x.id === id)) { S.list.unshift({ id, ...doc }); S.all.unshift(S.list[0]); }
  openProject(id);
}
// Deletes are marks (deletedAt), so they can be undone; the server refuses saves to deleted projects.
async function deleteProject() {
  if (S.viewOnly) return;
  const id = S.id, name = S.P ? S.P.name : '';
  if (S.db && !S.local) {
    try { await S.db.doc('projects/' + id).update({ deletedAt: Date.now(), deletedBy: S.me || '' }); }
    catch (e) { S.saving = 'Couldn’t delete' + (e.message ? ': ' + e.message : ''); renderHeader(); return; }
  }
  const l = S.all.find(x => x.id === id); if (l) { l.deletedAt = Date.now(); l.deletedBy = S.me || ''; }
  S.list = S.all.filter(x => !x.deletedAt);
  S.id = null; S.P = null;
  toast(`Deleted “${name}”.`, { act: 'restore-project', id });
  if (S.list.length) openProject(S.list[0].id); else renderAll();
}
async function restoreProject(id) {
  if (S.viewOnly) return;
  if (S.db && !S.local) { try { await S.db.doc('projects/' + id).update({ deletedAt: null, deletedBy: null }); } catch (e) { toast('Couldn’t restore: ' + (e.message || e.code)); return; } }
  const l = S.all.find(x => x.id === id); if (l) l.deletedAt = null;
  S.list = S.all.filter(x => !x.deletedAt);
  S.showDeleted = false; toast('Restored.');
  openProject(id);
}
function toast(text, undo) { S.toast = { text, undo }; clearTimeout(S.toastTimer); S.toastTimer = setTimeout(() => { S.toast = null; renderToast(); }, 15000); renderToast(); }
function renderToast() {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  const t = S.toast;
  el.hidden = !t;
  el.innerHTML = t ? `<span>${esc(t.text)}</span>${t.undo ? `<button class="btn" data-act="${t.undo.act}" data-id="${esc(t.undo.id || '')}">Undo</button>` : ''}<button class="btn ghost" data-act="toast-close" aria-label="Dismiss">✕</button>` : '';
}
function liveActuals() { return S.actuals.filter(a => !a.deletedAt); }
function deepMerge(t, p) { for (const [k, v] of Object.entries(p)) { if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object') deepMerge(t[k], v); else t[k] = v; } return t; }
async function createActual(row) {
  if (canWrite()) {
    const { id, ...body } = row;
    const ref = S.db.doc('projects/' + S.id + '/actuals/' + id);
    try {
      const cur = await ref.get();
      if (cur.exists) { adoptActual(id, cur.data()); S.saving = 'That week was already logged by a colleague; opened it instead'; renderAll(); return; }
      await ref.set({ ...body, createOnly: true });
      if (!S.actuals.find(x => x.id === id)) S.actuals.push(row);
      seen(id, row);
    } catch (e) {
      if (e.code === 'exists' && e.current) { adoptActual(id, e.current); S.saving = 'That week was already logged by a colleague; opened it instead'; }
      else { S.saving = 'Couldn’t save the week' + (e.message ? ': ' + e.message : ''); }
      renderHeader();
    }
  } else { if (!S.actuals.find(x => x.id === row.id)) S.actuals.push(row); S.localActuals = S.localActuals || {}; S.localActuals[S.id] = S.actuals; }
  renderSoon();
}
function adoptActual(id, data) {
  const i = S.actuals.findIndex(x => x.id === id), row = { id, ...data };
  if (i >= 0) S.actuals[i] = row; else S.actuals.push(row);
  seen(id, row);
}
// What we last saw from the server for each week, to spot a colleague's change to the same field.
function seen(id, row) { S.actSeen = S.actSeen || {}; S.actSeen[id] = JSON.parse(JSON.stringify(row)); }
function leaves(o, pre = []) { return Object.entries(o).flatMap(([k, v]) => v && typeof v === 'object' && !Array.isArray(v) ? leaves(v, pre.concat(k)) : [[pre.concat(k), v]]); }
const at = (o, path) => path.reduce((x, k) => x == null ? undefined : x[k], o);
const FIELD_LABEL = { notes: 'Highlights', blockers: 'Blockers and risks', hours: 'Hours', designed: 'designed', automated: 'automated', executed: 'manual executions' };
function fieldLabel(path) {
  if (path[0] === 'mods') { const m = S.P.modules.find(x => x.id === path[1]); return `${m ? m.name : 'Not split by module'}: ${FIELD_LABEL[path[2]] || path[2]}`; }
  if (path[0] === 'hoursBy') { const r = S.P.team.find(x => x.id === path[1]); return `Hours for ${r ? r.name : 'a team member'}`; }
  if (path[0] === 'ot') return `${OT_LABEL[path[1]] || path[1]} % done`;
  return FIELD_LABEL[path[0]] || path.join('.');
}
// Save only the fields that changed, so people logging different things don't overwrite each other.
// If a colleague changed the same field since we last saw it, ask before overwriting.
async function patchActual(id, patch, force) {
  const r = S.actuals.find(x => x.id === id); if (!r) return;
  if (canWrite() && !force) {
    try {
      const cur = await S.db.doc('projects/' + S.id + '/actuals/' + id).get();
      if (cur.exists) {
        const server = cur.data(), was = (S.actSeen || {})[id] || {};
        for (const [path, mine] of leaves(patch)) {
          const theirs = at(server, path), before = at(was, path);
          if (!same(theirs, before) && !same(theirs, mine)) {
            S.fieldConflict = { id, path, patch, mine, theirs, by: server.updatedBy, label: fieldLabel(path) };
            renderAll(); return;
          }
        }
      }
    } catch (e) { /* fall through and try the save */ }
  }
  deepMerge(r, JSON.parse(JSON.stringify(patch)));
  if (canWrite()) {
    try { await S.db.doc('projects/' + S.id + '/actuals/' + id).update(patch); S.actSeen = S.actSeen || {}; S.actSeen[id] = deepMerge(S.actSeen[id] || {}, JSON.parse(JSON.stringify(patch))); }
    catch (e) { if (e.code === 'deleted') { S.deletedNotice = { by: e.deletedBy, at: e.deletedAt }; renderAll(); return; } S.saving = 'Couldn’t save actuals' + (e.message ? ': ' + e.message : ''); renderHeader(); }
  } else { S.localActuals = S.localActuals || {}; S.localActuals[S.id] = S.actuals; }
  renderSoon();
}
function fieldConflictBanner() {
  const c = S.fieldConflict; if (!c) return '';
  const show = v => v == null || v === '' ? 'empty' : String(v).length > 120 ? String(v).slice(0, 120) + '…' : String(v);
  const text = typeof c.mine === 'string';
  return `<div class="banner conflict" role="alert"><b>${esc(c.by || 'A colleague')} changed ${esc(c.label)} while you were editing.</b>
    <div class="small" style="margin-top:4px">Theirs: <b>${esc(show(c.theirs))}</b><br>Yours: <b>${esc(show(c.mine))}</b></div>
    <div class="row" style="margin-top:8px"><button class="btn" data-act="fc-theirs">Keep theirs</button><button class="btn" data-act="fc-mine">Use mine</button>${text ? '<button class="btn" data-act="fc-both">Keep both</button>' : ''}</div></div>`;
}
function setLeaf(o, path, v) { let x = o; path.slice(0, -1).forEach(k => { x = x[k] = x[k] && typeof x[k] === 'object' ? x[k] : {}; }); x[path[path.length - 1]] = v; return o; }
async function deleteActual(id) {
  const r = S.actuals.find(x => x.id === id); if (!r) return;
  await patchActual(id, { deletedAt: Date.now() }, true);
  toast(`Removed the week of ${fd(r.week)}.`, { act: 'restore-week', id });
}
async function deleteActualHard(id) {
  S.actuals = S.actuals.filter(x => x.id !== id);
  if (canWrite()) { try { await S.db.doc('projects/' + S.id + '/actuals/' + id).delete(); } catch (e) { } }
  renderSoon();
}

function exampleProject() {
  const P = E.newProject('Example: Retail banking regression');
  P.client = 'Example client';
  const m = (name, o) => Object.assign(E.newModule(name), o);
  P.end = E.addDays(P.start, 7 * 29 - 3);
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
  if (type === 'num') {
    const whole = /(\.tcs|manualCycles|autoCycles|priority|Days|MaxPeople|rampDays|leadSpan|managerAbove)$/.test(path);
    const min = /min=/.test(attrs) ? '' : 'min="0"';
    return `<input type="number" id="${fid(path)}" data-p="${path}" data-t="num" class="${cls}" value="${v ?? ''}" step="${whole ? 1 : 'any'}" ${min} ${attrs}>`;
  }
  return `<input type="${type}" id="${fid(path)}" data-p="${path}" class="${cls}" value="${esc(v)}" ${attrs}>`;
}
function sel(path, options, cls = '') {
  const v = getPath(S.P, path);
  return `<select id="${fid(path)}" data-p="${path}" class="${cls}">${options.map(o => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${val == v ? 'selected' : ''}>${esc(lab)}</option>`; }).join('')}</select>`;
}
document.addEventListener('change', ev => {
  const el = ev.target; const path = el.dataset && el.dataset.p; if (!path || !S.P) return;
  let v = el.value;
  if (el.dataset.t === 'num') {
    v = el.value === '' ? 0 : Number(el.value); if (!isFinite(v)) v = 0;
    const lo = el.min === '' ? -Infinity : +el.min, hi = el.max === '' ? Infinity : +el.max;
    const before = v;
    v = Math.min(hi, Math.max(lo, v));
    if (el.step === '1') v = Math.round(v);
    if (v !== before) { el.value = v; S.saving = `Adjusted to ${v} (allowed ${isFinite(lo) ? lo : ''}–${isFinite(hi) ? hi : 'any'})`; }
  }
  if (el.dataset.t === 'check') v = el.checked;
  setPath(S.P, path, v);
  touch();
});

/* ---------- render scheduling ---------- */
let rq = false;
function renderSoon() { if (rq) return; rq = true; requestAnimationFrame(() => { rq = false; renderAll(); }); }
/* ---------- calculation: in a background worker, so typing never freezes the page ----------
 * After an edit the page keeps showing the previous results (marked "updating") until the worker
 * returns. Anything that sends numbers out (copy, export, baseline) uses fresh() instead. */
let worker = null, calcTimer = null, calcBusy = false, calcAgain = false;
function startWorker() {
  try {
    const src = document.getElementById('engine-src').textContent + '\nonmessage = e => { try { postMessage({ seq: e.data.seq, A: ENGINE.analyse(e.data.P) }); } catch (err) { postMessage({ seq: e.data.seq, error: String(err) }); } };';
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = ev => {
      calcBusy = false;
      const { seq, A, error } = ev.data;
      if (calcAgain) { calcAgain = false; runCalc(); return; }
      if (error) { worker = null; S.A = null; S.Aprev = null; S.calculating = false; flushWaiters(); renderAll(); return; }
      if (seq === S.editSeq && S.P) { S.A = A; S.Aprev = null; S.calculating = false; flushWaiters(); renderAll(); }
      else if (S.P) runCalc(); // the plan changed while this ran: go again
    };
    worker.onerror = () => { worker = null; calcBusy = false; S.Aprev = null; S.calculating = false; flushWaiters(); renderSoon(); };
  } catch (e) { worker = null; }
}
function runCalc() {
  if (!worker || !S.P) return;
  if (calcBusy) { calcAgain = true; return; }
  calcBusy = true;
  worker.postMessage({ seq: S.editSeq, P: JSON.parse(JSON.stringify(S.P)) });
}
// Returns the latest results, or the previous ones (or null on first open) while the worker
// recalculates. Without a worker it calculates on the spot.
function analysis() {
  if (S.A) return S.A;
  if (!S.P) return null;
  if (worker) { if (!S.calculating) { S.calculating = true; clearTimeout(calcTimer); calcTimer = setTimeout(runCalc, S.Aprev ? 200 : 0); } return S.Aprev || null; }
  S.A = E.analyse(S.P); return S.A;
}
// For anything that sends numbers out: wait for results that match the current plan.
let calcWaiters = [];
function flushWaiters() { const w = calcWaiters; calcWaiters = []; w.forEach(f => f()); }
function freshAsync() {
  if (S.A && !S.calculating) return Promise.resolve(S.A);
  if (!worker) return Promise.resolve(fresh());
  return new Promise(resolve => {
    calcWaiters.push(() => resolve(S.A || fresh()));
    S.calculating = true; clearTimeout(calcTimer); runCalc();
  });
}
function fresh() { if (!S.A || S.calculating) { S.A = E.analyse(S.P); S.Aprev = null; S.calculating = false; S.editSeq = (S.editSeq || 0) + 1; } return S.A; }

function renderAll() {
  const act = document.activeElement; const aid = act && act.id; let selS = null, selE = null;
  try { selS = act.selectionStart; selE = act.selectionEnd; } catch (e) { }
  renderHeader(); renderMain();
  if (aid) { const el = document.getElementById(aid); if (el && el !== document.activeElement) { el.focus({ preventScroll: true }); try { if (selS != null) el.setSelectionRange(selS, selE); } catch (e) { } } }
}
function renderHeader() {
  const opts = S.list.map(x => `<option value="${x.id}" ${x.id === S.id ? 'selected' : ''}>${esc(x.id === S.id && S.P ? S.P.name : x.name)}</option>`).join('');
  $('#hdr-proj').innerHTML = S.list.length ? `<select id="proj-pick" class="sel-proj" aria-label="Project">${opts}</select>` : '';
  $('#save').textContent = S.saving + (S.calculating ? (S.saving ? ' · ' : '') + 'Updating results…' : '');
  const has = !!S.P;
  $('#hdr-actions').innerHTML = `
    ${S.me && S.authOn ? `<span class="small muted" title="Signed in">${esc(S.me)}${S.viewOnly ? ' · view only' : ''}</span>` : ''}
    ${S.viewOnly ? '' : S.all.some(x => x.deletedAt) ? `<button class="btn ghost" data-act="show-deleted">Deleted (${S.all.filter(x => x.deletedAt).length})</button>` : ''}
    ${S.viewOnly ? '' : `<button class="btn" data-act="new">New project</button>`}
    ${has ? `${S.viewOnly ? '' : `<button class="btn" data-act="dup">Duplicate</button>
    ${S.confirmDel ? `<span class="confirm">Delete this project? You can undo or restore it later. <button class="btn danger" data-act="del-yes">Delete</button><button class="btn" data-act="del-no">Cancel</button></span>` : `<button class="btn" data-act="del">Delete</button>`}`}
    <button class="btn primary" data-act="xlsx" ${S.dl === false ? 'disabled title="Downloads aren’t available in this view"' : ''}>Export Excel</button>` : ''}`;
  document.querySelectorAll('nav.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === S.tab));
  $('nav.tabs').hidden = !has;
}
document.addEventListener('change', ev => { if (ev.target.id === 'proj-pick') openProject(ev.target.value); });

function renderMain() {
  const m = $('#main');
  if (!S.P && S.loadError) { m.innerHTML = `<div class="empty panel"><h1>Project can’t be opened</h1><p class="muted" style="max-width:60ch">${esc(S.loadError)}</p><div class="row" style="justify-content:center"><button class="btn primary" data-act="new">New project</button></div></div>`; return; }
  if (!S.P) {
    m.innerHTML = S.loading ? `<div class="empty"><p class="muted">Loading projects…</p></div>` : `
      <div class="empty panel">
        <h1>Estimate a test project</h1>
        <p class="muted" style="max-width:56ch">Add modules and test cases, your team and your calendar. ${esc(BRAND.name)} works out effort, finish date, team needed and achievable scope, then tracks actuals week by week.</p>
        <div class="row" style="justify-content:center"><button class="btn primary" data-act="new">New project</button><button class="btn" data-act="example">Open an example project</button></div>
        ${S.timeoutNote ? `<p class="small muted">${S.timeoutNote}</p>` : ''}
      </div>`;
    return;
  }
  if (S.showDeleted) {
    const del = S.all.filter(x => x.deletedAt).sort((x, y) => y.deletedAt - x.deletedAt);
    m.innerHTML = `<section class="panel"><div class="panel-head"><h2>Deleted projects</h2><button class="btn" data-act="hide-deleted">Back</button></div>
      ${del.length ? `<div class="tbl-wrap"><table><thead><tr><th>Project</th><th>Deleted by</th><th>When</th><th></th></tr></thead><tbody>${del.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.deletedBy || '—')}</td><td>${new Date(x.deletedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</td><td class="r"><button class="btn" data-act="restore-project" data-id="${esc(x.id)}">Restore</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nothing deleted.</p>'}
      <p class="small muted">Restoring brings back the project with all its weekly actuals.</p></section>`;
    return;
  }
  let first = null;
  try { first = analysis(); S.calcError = null; } catch (e) { S.calcError = (e && e.message) || String(e); }
  if (!first && !S.calcError) { m.innerHTML = conflictBanner() + deletedBanner() + `<div class="empty"><p class="muted">Working out the estimate…</p></div>`; return; }
  if (S.calcError) {
    m.innerHTML = conflictBanner() + deletedBanner() + `<section class="panel"><h2>This project can’t be calculated</h2>
      <p>Something in its settings is invalid: <span class="muted">${esc(S.calcError)}</span></p>
      <div class="row"><button class="btn primary" data-act="reset-factors-now">Reset factors to defaults</button><span class="small muted">or pick another project from the list above.</span></div></section>`;
    return;
  }
  const tabs = { summary: viewSummary, schedule: viewSchedule, scope: viewScope, team: viewTeam, calendar: viewCalendar, factors: viewFactors, tracking: viewTracking };
  m.innerHTML = conflictBanner() + deletedBanner() + (S.repaired ? `<div class="banner" role="status">Some settings in this project were invalid and have been reset to defaults: ${esc(S.repaired.join(', '))}. Check them on the Factors and Scope tabs. <button class="btn ghost" data-act="repaired-ok">OK</button></div>` : '') + (S.local ? `<div class="banner">Saving isn’t available in this view, so changes last only until you close the page.</div>` : '') + (S.viewOnly ? `<div class="banner" role="status">You have view-only access. You can try changes here to see their effect, but they aren’t saved and are replaced when someone else saves. Ask the tool’s owner for editor access to make changes.</div>` : '') + (S.tab !== 'summary' && S.tab !== 'tracking' && S.tab !== 'schedule' ? strip() : '') + tabs[S.tab]();
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
/* ---------- Summary model: one source for the Summary tab and the copied text ---------- */
const FTE = n => nf1.format(Math.round(n * 10) / 10);
const nf2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const r10 = h => nf0.format(Math.round((h || 0) / 10) * 10);
const plural = (n, one, many) => `${nf0.format(n)} ${n === 1 ? one : many}`;
const calDays = (s, d) => E.daysBetween(s, d) + 1;
function workDaysBetween(P, s, d) { let n = 0; for (let x = s; x <= d; x = E.addDays(x, 1)) if (P.a.workDays.includes(E.dow(x))) n++; return n; }
const lines = t => String(t || '').split('\n').map(x => x.replace(/^\s*[-*•\d.)]+\s*/, '').trim()).filter(Boolean);

function summaryModel(A) {
  const P = S.P, a = P.a, e = A.e, L = e.lines;
  const fte = P.team.reduce((t, r) => t + (+r.alloc || 0) / 100, 0);
  const tc = Math.round(e.tcs), auto = Math.round(e.autoTCs);
  const fl = A.finish && A.finish.likely && A.finish.likely.date;
  const M = { fte, tc, auto, q: [] };

  // overview
  const fwText = { new: 'a new automation framework is built for this project', extend: 'our existing automation framework is extended', reuse: 'our ready-made automation framework is reused, so only application-specific code needs to be built' }[a.frameworkStatus || 'new'];
  let ov = `${tc} test cases (${auto} automated) across ${plural(P.modules.length, 'module', 'modules')}, starting ${fd(P.start)}`;
  if (P.end) ov += `, to be delivered in ${calDays(P.start, P.end)} calendar days (${workDaysBetween(P, P.start, P.end)} working days), by ${fd(P.end)}`;
  ov += `. It assumes ${fwText}${e.autoTCs > 0 ? ({ existing: ', hooked into the existing CI/CD pipeline', none: ', with no CI/CD pipeline work', new: ', with a new CI/CD pipeline' }[a.cicdMode] || '') : ''}.`;
  M.title = P.client && P.name && !P.name.toLowerCase().includes(P.client.toLowerCase()) ? `${P.name} for ${P.client}` : (P.name || P.client || '');
  M.overview = ov;

  // questions
  const teamTxt = `${FTE(fte)} FTE`;
  if (A.hasTeam && fl) {
    const d = calDays(P.start, fl), diff = P.end ? E.daysBetween(P.end, fl) : null;
    M.q.push({ key: 'duration', q: `With the current team of ${teamTxt}, how long will all ${tc} test cases take?`,
      big: `${nf0.format(d)} calendar days`,
      sub: `Finishes ${fd(fl)} (${nf0.format(A.finish.likely.workdays)} working days)${diff == null ? '' : diff > 0 ? `, ${plural(diff, 'day', 'days')} more than planned` : diff < 0 ? `, ${plural(-diff, 'day', 'days')} less than planned` : ', on the target date'}.`,
      chips: [`Best ${A.finish.best.date ? fd(A.finish.best.date) : '—'}`, `Worst ${A.finish.worst.date ? fd(A.finish.worst.date) : 'over 3 years'}`],
      text: `About **${nf0.format(d)} calendar days**${diff == null ? `, finishing ${fd(fl)}` : diff > 0 ? `, roughly ${plural(diff, 'day', 'days')} more than planned` : diff < 0 ? `, roughly ${plural(-diff, 'day', 'days')} less than planned` : ', on the target date'}` });
  } else if (A.hasTeam) {
    M.q.push({ key: 'duration', q: `With the current team of ${teamTxt}, how long will all ${tc} test cases take?`, big: 'Not reachable',
      sub: A.missing.length ? missingMsg(A.missing) : 'Not within 3 years. Add people or reduce scope.', text: 'Not reachable with the current team' });
  } else {
    M.q.push({ key: 'duration', q: 'How long will the current team take?', big: 'Add a team', sub: 'Needs at least one person on the Team tab.', muted: true });
  }
  if (P.end && A.hasTeam && A.scope) {
    const f = A.scope.f;
    const item = { key: 'scope', q: `With ${teamTxt}, how much is done by the target?` };
    if (A.scope.oneTimeBlocks) Object.assign(item, { big: '0 test cases', sub: 'Setup and framework work alone take longer than the window.', text: 'Nothing: setup and framework work alone take longer than the window' });
    else if (f >= 1) Object.assign(item, { big: `All ${tc} test cases`, sub: `Room for about ${f >= 64 ? 'much' : pct(f - 1)} more scope in the same window.`, text: `All **${tc}** test cases, with room for about ${f >= 64 ? 'much' : pct(f - 1)} more` });
    else { const k = Math.floor(tc * f), ka = Math.floor(e.autoTCs * f);
      Object.assign(item, { big: `About ${k} of ${tc} test cases`, sub: `About ${ka} automated (${pct(f)} of planned scope, same mix per module).`, text: `About **${k} of ${tc}** test cases (about ${ka} automated)` }); }
    M.scopeK = f < 1 ? Math.floor(tc * f) : tc;
    M.q.push(item);
  } else if (!P.end) {
    M.q.push({ key: 'scope', q: 'How much is done by the target?', big: 'Set a target date', sub: 'Needed to work out achievable scope.', muted: true });
  }
  if (A.need) {
    const n = A.need, item = { key: 'need', q: `How many people are needed to finish all ${tc} test cases by the target?` };
    if (n.extra == null) Object.assign(item, { big: 'Not possible by the target', sub: `More people don’t help enough: framework, reviews, build gaps and module availability set a minimum duration.${n.floor ? ` Even with 256 more people the earliest finish is ${fd(n.floor)}.` : ''}`, text: 'Not possible by adding people' });
    else if (n.extra === 0) Object.assign(item, { big: `${teamTxt} is enough`, sub: A.needWorst && A.needWorst.extra ? `Add ${plural(A.needWorst.extra, 'engineer', 'engineers')} to cover the worst case.` : 'Covers the worst case too.', text: `**${teamTxt}**, the current team is enough` });
    else {
      const loc = a.hireLocation, tot = n.totalFte || fte + n.extra;
      const joining = (+a.hireLeadDays || 0) > 0 ? `joining after about ${plural(+a.hireLeadDays, 'working day', 'working days')}` : 'from day 1';
      const extras = [n.needLeads ? `+${plural(n.needLeads, 'lead', 'leads')}` : '', n.needMgr ? `+1 manager at ${a.managerAlloc}%` : ''].filter(Boolean);
      Object.assign(item, { big: `${FTE(tot)} FTE`, sub: `${A.hasTeam ? `+${plural(n.extra, 'engineer', 'engineers')} on top of the current team` : plural(n.extra, 'engineer', 'engineers')}, based in ${esc(loc)}, ${esc(a.hireSkill.toLowerCase())}, full-time, ${joining}.${A.needWorst && A.needWorst.extra != null && A.needWorst.extra > n.extra ? ` Worst case: +${A.needWorst.extra}.` : ''}`,
        chips: [...n.heads.map(h => `${h.n} × ${h.level}`), ...extras],
        text: `**${FTE(tot)} FTE** (+${plural(n.extra, 'engineer', 'engineers')}, ${loc})${extras.length ? ', plus ' + extras.join(', ').replace(/\+/g, '') : ''}`,
        textClient: `**${FTE(tot)} FTE** (+${plural(n.extra, 'engineer', 'engineers')})` });
    }
    M.q.push(item);
  } else if (!P.end) {
    M.q.push({ key: 'need', q: 'How many people to finish by the target?', big: 'Set a target date', sub: 'Needed to size the team.', muted: true });
  }

  // recommendation
  const span = P.end ? Math.max(1, E.daysBetween(P.start, P.end)) : 1;
  const buf = d => d && P.end ? Math.max(0, E.daysBetween(d, P.end)) / span : 0;
  const bufTxt = b => b < 0.02 ? 'little or no buffer' : `about ${pct(b)} buffer`;
  const fallback = [M.scopeK != null && M.scopeK < tc ? `a reduced scope (about ${M.scopeK} test cases)` : '', fl && P.end && fl > P.end ? `about ${calDays(P.start, fl)} calendar days` : ''].filter(Boolean);
  const orElse = fallback.length ? ` Otherwise, agree with the customer on ${fallback.length > 1 ? 'either ' + fallback.join(' or ') : fallback[0]}.` : '';
  if (A.missing && A.missing.length) M.rec = missingMsg(A.missing);
  else if (!P.end) M.rec = fl ? `With ${teamTxt}, plan for about ${calDays(P.start, fl)} calendar days (finish ${fd(fl)}). Set a target end date to get a staffing recommendation.` : '';
  else if (A.status === 'ok') M.rec = `The current ${teamTxt} delivers by ${fd(P.end)} with ${bufTxt(buf(fl))}, and even the worst case is on time.`;
  else if (A.status === 'risk') M.rec = `The current ${teamTxt} delivers by ${fd(P.end)} with ${bufTxt(buf(fl))}, but not in the worst case.${A.needWorst && A.needWorst.extra ? ` To cover the worst case, add ${plural(A.needWorst.extra, 'engineer', 'engineers')}` : ' To cover the worst case'}${A.finish.worst.date ? `, or agree a fallback date of ${fd(A.finish.worst.date)}` : ''}.`;
  else if (A.need && A.need.extra > 0) {
    const lead = (+a.hireLeadDays || 0) > 0 ? `, with the new people starting within ${plural(+a.hireLeadDays, 'working day', 'working days')}` : ' from day 1';
    const parts = [`+${plural(A.need.extra, 'engineer', 'engineers')}`, A.need.needLeads ? `+${plural(A.need.needLeads, 'lead', 'leads')}` : '', A.need.needMgr ? `a manager at ${a.managerAlloc}%` : ''].filter(Boolean).join(', ');
    M.rec = `Staff ${FTE(A.need.totalFte || fte + A.need.extra)} FTE (${parts})${lead}, to deliver by ${fd(P.end)} with ${bufTxt(buf(A.need.finish))}.${orElse}`;
  }
  else if (A.need && A.need.extra == null) M.rec = `Adding people won’t bring this in by ${fd(P.end)}.${orElse || ' Move the target date or cut scope.'}`;
  else M.rec = '';

  // effort
  const items = E.oneTimeBuckets(P).items.filter(x => x.hours > 0.01);
  const ph = k => items.filter(x => x.phase === k).map(x => [x.name, x.hours]);
  const cyc = Math.max(0, Math.round(+a.manualCycles || 0));
  M.effort = [
    ...ph('start'), ...ph('framework'), ...ph('common'), ...ph('cicd'),
    ['Manual test design', L.design], [`Manual execution (${plural(cyc, 'cycle', 'cycles')}, including retest)`, L.exec],
    ['Automation scripting, including review and maintenance', L.script + L.review + L.maint], ['Regression runs and failure analysis', L.autoExec],
    ...ph('end'), [`Contingency (${a.contingencyPct}%)`, L.contingency]
  ].filter(x => x[1] > 0.01);
  M.total = e.total; M.best = e.best; M.worst = e.worst;
  M.teamTime = A.teamTime || null; M.needTeamTime = A.need && A.need.teamTime || null;

  // capacity
  const w = A.window;
  if (w && A.hasTeam && fte > 0) {
    const until = P.end || fl, d = w.ded;
    const wd = workDaysBetween(P, P.start, until);
    M.capUntil = until;
    M.cap = [
      [`Working hours (${wd} days × ${a.hoursPerDay} h)`, d.gross], ['Public holidays', -d.holidays], ['Planned leave', -d.leave],
      ['Meetings, reporting and other non-development time', -d.nonDev], [`Unplanned leave (${a.unplannedLeavePct}%)`, -d.unplanned],
      [`Downtime: environment, builds or access (${a.downtimePct}%)`, -d.downtime], ['Ramp-up and learning curve', -d.ramp],
      ['Experience and skill adjustment', d.productivity]
    ].filter(x => Math.abs(x[1]) > 0.5);
    M.capTotal = w.total; M.capPct = d.gross ? w.total / d.gross : 0;
  }

  // key factors
  const mixT = {}; let mixN = 0;
  P.modules.forEach(m => { const ms = a.complexity.reduce((t, c) => t + (+m.mix[c.key] || 0), 0) || 1; a.complexity.forEach(c => { const n = (+m.tcs || 0) * (+m.mix[c.key] || 0) / ms; mixT[c.key] = (mixT[c.key] || 0) + n; mixN += n; }); });
  const levels = a.complexity.map(c => c.name).join(' / ');
  const uniq = arr => [...new Set(arr)];
  M.factors = [
    ['Scope', `${tc} test cases, ${auto} automated, ${plural(P.modules.length, 'module', 'modules')}`],
    [`Complexity mix (${levels})`, a.complexity.map(c => pct(mixN ? mixT[c.key] / mixN : 0)).join(' / ')],
    [`Automation hours per script (${levels})`, a.complexity.map(c => nf1.format(c.auto)).join(' / ')],
    ['Application type factor', uniq(P.modules.filter(m => m.automation).map(m => m.appType)).map(k => `${k} ×${nf2.format((a.appTypes.find(x => x.key === k) || { factor: 1 }).factor)}`).join(', ') || '—'],
    ['Test data factor', uniq(P.modules.filter(m => m.automation).map(m => m.testData)).map(k => `×${nf2.format((a.testData.find(x => x.key === k) || { factor: 1 }).factor)} (${k})`).join(', ') || '—'],
    ['Automation framework', (FW_STATUS.find(x => x[0] === a.frameworkStatus) || FW_STATUS[0])[1]],
    ['CI/CD pipeline', (CICD_MODES.find(x => x[0] === a.cicdMode) || CICD_MODES[0])[1]],
    ...(P.modules.some(m => m.manualExec) ? [['Manual execution', `${plural(cyc, 'cycle', 'cycles')}, ${a.retestPct}% retest`]] : []),
    ['Best / worst case', `${pct(a.pertBest - 1).replace('-', '−')} / +${pct(a.pertWorst - 1)} of the base estimate (contingency not added on top)`]
  ];

  // drivers
  const dr = [];
  if (e.autoTCs > 0) {
    const share = {}, cnt = {};
    P.modules.forEach(m => {
      if (!m.automation) return;
      const app = (a.appTypes.find(x => x.key === m.appType) || { factor: 1 }).factor, td = (a.testData.find(x => x.key === m.testData) || { factor: 1 }).factor;
      const ms = a.complexity.reduce((t, c) => t + (+m.mix[c.key] || 0), 0) || 1;
      a.complexity.forEach(c => { const n = (+m.tcs || 0) * (+m.mix[c.key] || 0) / ms * (+m.autoPct || 0) / 100; cnt[c.key] = (cnt[c.key] || 0) + n; share[c.key] = (share[c.key] || 0) + n * c.auto * app * td; });
    });
    const hard = a.complexity.slice(-2), tn = Object.values(cnt).reduce((t, v) => t + v, 0), th = Object.values(share).reduce((t, v) => t + v, 0);
    const hn = hard.reduce((t, c) => t + (cnt[c.key] || 0), 0), hh = hard.reduce((t, c) => t + (share[c.key] || 0), 0);
    if (tn > 0 && hn > 0) dr.push(`**Complexity:** ${hard.map(c => c.name.toLowerCase()).join(' and ')} test cases are ${pct(hn / tn)} of the automated cases but ${pct(hh / th)} of the automation effort.`);
  }
  const big = M.effort.slice().sort((x, y) => y[1] - x[1])[0];
  if (big) dr.push(`**Largest activity:** ${pct(big[1] / e.total)} of the effort is ${big[0].charAt(0).toLowerCase() + big[0].slice(1)}.`);
  if (e.autoTCs > 0 && A.sched && A.sched.ms) {
    const ready = A.sched.ms.commonDone || A.sched.ms.fwCore;
    const fwH = L.otFramework + L.otCommon;
    const lead = { new: 'New framework', extend: 'Extending the existing framework', reuse: 'Ready-made framework' }[a.frameworkStatus || 'new'];
    if (ready) dr.push(`**${lead}:** framework and common methods take about ${H(fwH)} h, so scripting starts ${fd(ready.date)}, about ${plural(Math.max(1, Math.round(calDays(P.start, ready.date) / 7)), 'week', 'weeks')} in.`);
  }
  P.modules.filter(m => m.availableFrom && m.availableFrom > P.start).forEach(m => dr.push(`**${m.name}** isn’t available until ${fd(m.availableFrom)}.`));
  if (A.sched && A.sched.work > 0) { const idle = A.sched.idle / (A.sched.work + A.sched.idle); if (idle >= 0.1) dr.push(`**internal**Waiting time:** ${pct(idle)} of productive time is spent waiting for work (framework, reviews, module availability or skills).`); }
  M.drivers = [...dr, ...lines(P.notes.drivers).map(x => /[.!?]$/.test(x) ? x : x + '.')];
  M.excluded = lines(P.notes.excluded);
  M.confirm = lines(P.notes.confirm);
  return M;
}

const md2html = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

function summaryMarkdown(A, aud) {
  const M = summaryModel(A), P = S.P, client = aud !== 'internal';
  const drivers = M.drivers.filter(x => !client || !x.startsWith('**internal**')).map(x => x.replace('**internal**', '**'));
  const out = [];
  out.push(`Here's the summary of the ${M.title || 'test automation'} estimate. It's for ${M.overview}`);
  if (M.q.filter(q => q.text).length) {
    out.push('', '**Estimates**', '', '| Question | Answer |', '|---|---|');
    M.q.filter(q => q.text).forEach(q => out.push(`| ${q.q} | ${client && q.textClient ? q.textClient : q.text} |`));
  }
  out.push('', `**Where the effort goes: about ${r10(M.total)} hours** (range ${r10(M.best)} to ${r10(M.worst)})`, '', '| Activity | Hours |', '|---|---|');
  M.effort.forEach(([n, h]) => out.push(`| ${n} | ${H(h)} |`));
  out.push(`| **Total** | **${H(M.total)}** |`);
  if (!client && M.teamTime) {
    out.push('', `**Team time to price:** about ${r10(M.teamTime.hours)} hours (${FTE(M.teamTime.fte)} FTE for ${M.teamTime.workdays} working days, to ${fd(M.teamTime.until)}). This is the time people are booked on the project, including leads, managers and time waiting on dependencies, so it's higher than the effort above.`);
    if (M.needTeamTime) out.push(`With the recommended team: about ${r10(M.needTeamTime.hours)} hours (${FTE(M.needTeamTime.fte)} FTE for ${M.needTeamTime.workdays} working days).`);
  }
  if (M.cap && !client) {
    out.push('', `**Productive capacity, ${fd(P.start)} to ${fd(M.capUntil)}**`, '', `| | Per FTE | Team of ${FTE(M.fte)} FTE |`, '|---|---|---|');
    M.cap.forEach(([n, h], i) => out.push(`| ${n} | ${i ? (h > 0 ? '+' : '−') : ''}${H(Math.abs(h / M.fte))} | ${i ? (h > 0 ? '+' : '−') : ''}${H(Math.abs(h))} |`));
    out.push(`| **Productive hours** | **${H(M.capTotal / M.fte)} (${pct(M.capPct)})** | **${H(M.capTotal)}** |`);
  } else if (M.cap) {
    out.push('', `**Capacity:** about ${pct(M.capPct)} of the team's working hours go into project work, after public holidays, leave, meetings, downtime and ramp-up.`);
  }
  out.push('', '**Key factors**', '', '| Factor | Value |', '|---|---|');
  M.factors.forEach(([n, v]) => out.push(`| ${n} | ${v} |`));
  if (drivers.length) out.push('', '**What\'s driving it**', '', ...drivers.map(x => `- ${x}`));
  if (M.excluded.length) out.push('', '**Not included**', '', ...M.excluded.map(x => `- ${x}`));
  if (M.confirm.length) out.push('', '**To confirm with the customer**', '', ...M.confirm.map((x, i) => `${i + 1}. ${x}`));
  if (M.rec) out.push('', `**Recommendation:** ${client ? M.rec.replace(/ \(\+\d+ engineers?, [^)]*\)/, '') : M.rec}`);
  return out.join('\n');
}

async function copySummary() {
  const text = summaryMarkdown(await freshAsync(), S.sumAud || 'client');
  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('no clipboard');
    await navigator.clipboard.writeText(text);
    S.copyNote = 'Copied. Paste it into an email, Teams or Slack.'; S.copyFallback = null;
  } catch (err) {
    S.copyFallback = text; S.copyNote = '';
  }
  renderAll();
  if (S.copyFallback) { const t = document.getElementById('copy-fallback'); if (t) { t.focus(); t.select(); } }
  clearTimeout(S.copyTimer); S.copyTimer = setTimeout(() => { S.copyNote = ''; if (S.tab === 'summary') renderAll(); }, 4000);
}

function ta(path, rows, ph) { return `<textarea id="${fid(path)}" data-p="${path}" rows="${rows}" placeholder="${esc(ph)}">${esc(getPath(S.P, path))}</textarea>`; }

/* ---------- Summary tab ---------- */
function viewSummary() {
  const P = S.P, A = analysis(), e = A.e, a = P.a;
  const st = A.status || 'nodate';
  const fl = A.finish && A.finish.likely;
  const M = summaryModel(A);
  const missMsg = A.missing && A.missing.length ? missingMsg(A.missing) : '';
  let msg;
  if (!P.start) msg = 'Set a start date to work out the estimated end date.';
  else if (!A.hasTeam && st === 'nodate') msg = 'Add at least one person on the Team tab to work out the estimated end date.';
  else if (missMsg) msg = (st === 'no' ? 'The plan doesn’t fit. ' : '') + missMsg;
  else if (st === 'nodate') msg = fl && fl.date ? `With the current team, the work is estimated to finish on <b>${fd(fl.date)}</b>. Set a target end date to check feasibility, size the team and see how much scope fits.` : 'With the current team, the work doesn’t finish within 3 years. Add people or reduce scope.';
  else if (st === 'noteam') msg = 'No one is on the team yet. The estimates below show the team this scope needs by the target date.';
  else if (st === 'ok') msg = `The plan fits. The likely finish is <b>${fd(fl.date)}</b>, and even the worst case (${fd(A.finish.worst.date)}) is on time.`;
  else if (st === 'risk') msg = `The likely finish, <b>${fd(fl.date)}</b>, is before the target, but the worst case (${A.finish.worst.date ? fd(A.finish.worst.date) : 'over 3 years'}) isn’t.`;
  else msg = fl && fl.date ? `The plan doesn’t fit. The likely finish is <b>${fd(fl.date)}</b>, ${E.daysBetween(P.end, fl.date)} days after the target.` : 'The plan doesn’t fit: with the current team the work doesn’t finish within 3 years.';

  const card = q => `<div class="answer"><div class="q">${esc(q.q)}</div><div class="big${q.muted ? ' muted' : ''}">${esc(q.big)}</div><div class="sub">${q.sub}</div>${q.chips ? `<div class="chips">${q.chips.map(c => `<span class="chip">${esc(c)}</span>`).join('')}</div>` : ''}</div>`;

  const effortTbl = `<div class="tbl-wrap"><table>
    <thead><tr><th>Activity</th><th class="r">Hours</th><th class="r">Person-days</th><th class="r">Share</th></tr></thead><tbody>
    ${M.effort.map(([n, h]) => `<tr><td>${esc(n)}</td><td class="r num">${H(h)}</td><td class="r num">${PD(h)}</td><td class="r num">${pct(h / e.total)}</td></tr>`).join('')}
    <tr class="total"><td>Total (likely)</td><td class="r num">${H(e.total)}</td><td class="r num">${PD(e.total)}</td><td class="r num">100%</td></tr>
    <tr class="sub"><td>Best case (base estimate ×${a.pertBest})</td><td class="r num">${H(M.best)}</td><td class="r num">${PD(M.best)}</td><td></td></tr>
    <tr class="sub"><td>Worst case (base estimate ×${a.pertWorst}, no contingency on top)</td><td class="r num">${H(M.worst)}</td><td class="r num">${PD(M.worst)}</td><td></td></tr>
    ${M.teamTime ? `<tr class="total"><td>Team time to price <span class="small muted">(${FTE(M.teamTime.fte)} FTE × ${M.teamTime.workdays} working days, incl. leads and waiting)</span></td><td class="r num">${H(M.teamTime.hours)}</td><td class="r num">${PD(M.teamTime.hours)}</td><td class="r num">${pct(M.teamTime.hours / e.total)}</td></tr>` : ''}
    ${M.needTeamTime ? `<tr class="sub"><td>Team time with the recommended ${FTE(M.needTeamTime.fte)} FTE</td><td class="r num">${H(M.needTeamTime.hours)}</td><td class="r num">${PD(M.needTeamTime.hours)}</td><td></td></tr>` : ''}
    <tr class="sub"><td>PERT expected (B + 4L + W) ÷ 6</td><td class="r num">${H(A.expectedTotal)}</td><td class="r num">${PD(A.expectedTotal)}</td><td></td></tr>
    </tbody></table></div>`;

  let capBlock = '';
  if (M.cap) {
    const sign = (h, i) => i === 0 ? '' : h > 0 ? '+' : '−';
    capBlock = `<section class="panel"><div class="panel-head"><h2>Productive capacity</h2><span class="small muted">${fd(P.start)} to ${fd(M.capUntil)}</span></div>
      <div class="tbl-wrap"><table><thead><tr><th>Item</th><th class="r">Per FTE</th><th class="r">Team of ${FTE(M.fte)} FTE</th></tr></thead><tbody>
      ${M.cap.map(([n, h], i) => `<tr><td>${esc(n)}</td><td class="r num">${sign(h, i)}${H(Math.abs(h / M.fte))}</td><td class="r num">${sign(h, i)}${H(Math.abs(h))}</td></tr>`).join('')}
      <tr class="total"><td>Productive hours</td><td class="r num">${H(M.capTotal / M.fte)} (${pct(M.capPct)})</td><td class="r num">${H(M.capTotal)}</td></tr>
      </tbody></table></div>
      ${A.sched && A.sched.finish ? `<p class="small muted">Up to the estimated finish, ${H(A.sched.idle)} h (${pct(A.sched.idle / (A.sched.work + A.sched.idle || 1))}) of productive time is spent waiting for work: framework not ready, test cases in review, modules not available yet, or no work left in a person’s skill area.</p>` : ''}
      <details class="howto"><summary>By person</summary>
      <div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th>Name</th><th>Role</th><th>Works on</th><th>Level</th><th class="r">Allocation</th><th class="r">Productive h</th></tr></thead><tbody>
      ${P.team.map((r, i) => `<tr><td>${esc(r.name)}</td><td>${esc(r.role)}</td><td>${r.role === 'Manager' ? 'Management' : esc(r.activity)}</td><td>${esc(r.level)}</td><td class="r num">${r.alloc}%</td><td class="r num">${H(A.window.per[i])}</td></tr>`).join('')}
      </tbody></table></div></details></section>`;
  }

  const modTbl = `<div class="tbl-wrap"><table>
    <thead><tr><th>Module</th><th class="r">Test cases</th><th class="r">To automate</th><th class="r">Manual h</th><th class="r">Automation h</th></tr></thead><tbody>
    ${e.mods.map(m => `<tr><td>${esc(m.name)}</td><td class="r num">${nf0.format(m.tcs)}</td><td class="r num">${nf0.format(m.autoTCs)}</td><td class="r num">${H(m.manual)}</td><td class="r num">${H(m.auto)}</td></tr>`).join('')}
    <tr class="total"><td>Total</td><td class="r num">${nf0.format(e.tcs)}</td><td class="r num">${nf0.format(e.autoTCs)}</td><td class="r num">${H(e.lines.design + e.lines.exec)}</td><td class="r num">${H(e.lines.script + e.lines.review + e.lines.maint + e.lines.autoExec)}</td></tr>
    </tbody></table></div><p class="small muted">Excludes one-time activities and contingency.</p>`;

  return `
  <section class="panel">
    <div class="fields">
      <label class="field"><span class="lbl">Project name</span>${inp('name')}</label>
      <label class="field"><span class="lbl">Client</span>${inp('client')}</label>
      <label class="field"><span class="lbl">Start date</span>${inp('start', 'date')}</label>
      <label class="field"><span class="lbl">Target end date</span>${inp('end', 'date')}<span class="hint">Leave empty to only work out the finish date</span></label>
      <label class="field"><span class="lbl">Automation framework</span>${sel('a.frameworkStatus', FW_STATUS)}<span class="hint">Adjusts framework and common methods effort</span></label>
      <label class="field"><span class="lbl">CI/CD pipeline</span>${sel('a.cicdMode', CICD_MODES)}<span class="hint">Not needed removes CI/CD work; regression runs start once scripts exist</span></label>
    </div>
  </section>
  <section class="panel overview">
    <div class="panel-head"><h2>${esc(M.title || 'Estimate')}</h2><div class="row">${S.copyNote ? `<span class="small" style="color:var(--good)">${S.copyNote}</span>` : ''}<div class="seg" role="group" aria-label="Summary audience">${[['client', 'Client'], ['internal', 'Internal']].map(([k, l]) => `<button class="${(S.sumAud || 'client') === k ? 'on' : ''}" data-act="sum-aud" data-k="${k}" aria-pressed="${(S.sumAud || 'client') === k}">${l}</button>`).join('')}</div><button class="btn primary" data-act="copy-summary">Copy summary</button></div></div>
    <p class="small muted">${(S.sumAud || 'client') === 'client' ? 'Client version: leaves out team time, the capacity breakdown, hiring details and waiting time.' : 'Internal version: adds team time for pricing, the capacity breakdown per FTE and hiring details.'}</p>
    <p class="lead">${esc(M.overview)}</p>
    ${S.copyFallback ? `<div class="note">Copying isn’t available here. The text is selected below: press Ctrl+C (or ⌘C) to copy it.<textarea id="copy-fallback" rows="10" readonly style="margin-top:8px">${esc(S.copyFallback)}</textarea><div style="margin-top:6px"><button class="btn" data-act="copy-close">Close</button></div></div>` : ''}
  </section>
  <div class="verdict">${pill(...STATUS[st === 'nodate' && fl && fl.date ? 'estimate' : st])}<p>${msg}</p></div>
  <div class="grid3">${M.q.map(card).join('')}</div>
  ${M.rec ? `<div class="rec"><span class="lbl">Recommendation</span><p>${esc(M.rec)}</p></div>` : ''}
  ${milestonesPanel(A)}
  <div class="grid2">
    <section class="panel"><div class="panel-head"><h2>Where the effort goes</h2><span class="small muted">about ${r10(M.total)} h, range ${r10(M.best)} to ${r10(M.worst)}</span></div>${effortTbl}</section>
    <div style="display:grid;gap:18px;align-content:start;min-width:0">
      <section class="panel"><h2>Key factors</h2><div class="tbl-wrap"><table><tbody>${M.factors.map(([n, v]) => `<tr><td class="muted">${esc(n)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div></section>
      <section class="panel"><h2>What’s driving it</h2>${M.drivers.length ? `<ul class="bul">${M.drivers.map(x => `<li>${md2html(x.replace('**internal**', '**'))}</li>`).join('')}</ul>` : '<p class="muted small">Nothing stands out yet.</p>'}</section>
    </div>
  </div>
  ${capBlock}
  <section class="panel"><h2>Notes for the customer</h2>
    <p class="small muted">One item per line. These go into the copied summary.</p>
    <div class="grid3">
      <label class="field"><span class="lbl">More on what’s driving it</span>${ta('notes.drivers', 5, 'e.g. Test cases depend on configuration settings and run for two login types')}</label>
      <label class="field"><span class="lbl">Not included</span>${ta('notes.excluded', 5, 'e.g. Lead effort\nCross-browser testing\nAccessibility testing')}</label>
      <label class="field"><span class="lbl">To confirm with the customer</span>${ta('notes.confirm', 5, 'e.g. Which test cases are in scope\nAccess to reset test data\nCaptcha bypass on test environments')}</label>
    </div>
  </section>
  <section class="panel"><div class="panel-head"><h2>Capacity against effort</h2><div class="legend"><span><i style="background:var(--s1)"></i>Cumulative productive capacity</span><span><i style="background:var(--ink);height:0;border-top:2px dashed var(--ink)"></i>Effort needed (likely)</span></div></div>
    <div class="chart" id="cap-chart"></div></section>
  <section class="panel"><h2>Effort by module</h2>${modTbl}</section>`;
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
      <td>${S.confirmRm === 'mod:' + i ? `<span class="confirm">Remove? <button class="btn danger" data-act="rm-mod" data-i="${i}">Yes</button><button class="btn" data-act="rm-no">No</button></span>` : `<button class="btn ghost" data-act="rm-mod-ask" data-i="${i}" aria-label="Remove module">Remove</button>`}</td></tr>`;
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
      <td>${S.confirmRm === 'res:' + i ? `<span class="confirm">Remove? <button class="btn danger" data-act="rm-res" data-i="${i}">Yes</button><button class="btn" data-act="rm-no">No</button></span>` : `<button class="btn ghost" data-act="rm-res-ask" data-i="${i}" aria-label="Remove person">Remove</button>`}</td></tr>${leaveRow}`;
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
    <p class="note">New projects start with the holidays that can be calculated: US federal holidays, India’s national days and Good Friday. Festival holidays that move every year (Holi, Eid, Dussehra, Diwali and others) aren’t included, so paste your company’s holiday list below. Holidays on non-working days have no effect.</p>
    <details class="howto" ${S.holOpen ? 'open' : ''}><summary>Add holidays in bulk</summary>
      <div class="grid2" style="margin-top:10px">
        <div class="field"><span class="lbl">Paste from your company list</span>
          <textarea id="hol-paste" rows="6" placeholder="One per line: date, name, location&#10;2027-03-22, Holi, India&#10;29/10/2027, Diwali, India"></textarea>
          <span class="hint">Dates as YYYY-MM-DD or DD/MM/YYYY. Location is optional and defaults to the one selected.</span>
          <div class="row"><label class="row small">Dates like 07/04/2027 are <select id="hol-order"><option value="dmy">day first (7 Apr)</option><option value="mdy">month first (4 Jul)</option></select></label><label class="row small">Default location ${`<select id="hol-loc">${P.locations.map(l => `<option>${esc(l)}</option>`).join('')}</select>`}</label><button class="btn" data-act="hol-import">Add pasted holidays</button></div>
          ${S.holNote ? `<span class="small">${esc(S.holNote)}</span>` : ''}
        </div>
        <div class="field"><span class="lbl">Add calculated holidays</span>
          <div class="row"><select id="hol-gen-loc">${['India', 'USA'].filter(l => P.locations.includes(l)).map(l => `<option>${l}</option>`).join('')}</select>
          <select id="hol-gen-year">${[0, 1, 2, 3].map(k => +P.start.slice(0, 4) + k).map(y => `<option>${y}</option>`).join('')}</select>
          <button class="btn" data-act="hol-gen">Add</button></div>
          <span class="hint">US federal holidays (observed dates), or India’s Republic Day, Independence Day, Gandhi Jayanti, Good Friday, Christmas and New Year. Skips dates already listed.</span>
        </div>
      </div>
    </details>
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
  const f = (path, label, hint) => `<label class="field"><span class="lbl">${label}</span>${inp(path, 'num', '', /%/.test(label) ? 'max="100"' : '')}${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
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
  <section class="panel"><h2>Framework and CI/CD</h2>
    <p class="small muted">Automation follows this order: framework core, then common methods (login, navigation, waits, data and API helpers), then regular scripting. CI/CD and reporting are set up by one person alongside, and automated regression runs start once the pipeline is ready (or as soon as scripts exist when CI/CD isn’t needed).</p>
    <div class="fields">
      <label class="field"><span class="lbl">Automation framework</span>${sel('a.frameworkStatus', FW_STATUS)}</label>
      ${f('a.fwStatusPct.extend.framework', 'Extending existing: framework effort %')}
      ${f('a.fwStatusPct.extend.common', 'Extending existing: common methods effort %')}
      ${f('a.fwStatusPct.reuse.framework', 'Reusing as is: framework effort %', 'Onboarding and configuration only')}
      ${f('a.fwStatusPct.reuse.common', 'Reusing as is: common methods effort %', 'Application-specific helpers still needed')}
      ${f('a.commonPerModule', 'Common methods per automated module (h)', 'Added to the common methods listed below')}
      <label class="field"><span class="lbl">CI/CD pipeline</span>${sel('a.cicdMode', CICD_MODES)}</label>
      ${f('a.cicdExistingPct', 'Existing pipeline: CI/CD effort %', 'Hooking the suite into the existing pipeline')}
    </div></section>
  <section class="panel"><h2>Scheduling rules</h2>
    <div class="fields">
      ${f('a.accessDays', 'Access and environment lead time (working days)', 'No scripting or execution before this; KT, design and framework can start')}
      ${f('a.frameworkGatePct', 'Framework core before common methods start %', 'Share of framework development done before common methods can start')}
      ${f('a.commonMaxPeople', 'People on common methods at once')}
      ${f('a.frameworkMaxPeople', 'People on framework at once', 'Framework work doesn’t split well across many people')}
      ${f('a.reviewDays', 'Client review of test cases (working days)', 'Designed test cases can be scripted or executed after this')}
      ${f('a.cycleGapDays', 'Gap between manual cycles (working days)', 'Waiting for the next build before the next cycle')}
    </div></section>
  <section class="panel"><div class="panel-head"><h2>One-time activities</h2><button class="btn" data-act="add-ot">Add activity</button></div>
    <p class="small muted">“When” places the activity in the schedule. Project start work is done by anyone in the first days. Framework, common methods and CI/CD work is done by automation people in that order (CI/CD alongside). Project end work happens once everything else is finished. “Counted h” is after the framework and CI/CD settings above, before contingency.</p>
    <div class="tbl-wrap"><table><thead><tr><th>Include</th><th>Activity</th><th>Hours</th><th>When</th><th class="r">Counted h</th><th></th></tr></thead><tbody>
    ${a.oneTime.map((o, i) => `<tr><td>${inp(`a.oneTime.${i}.on`, 'check', '', 'aria-label="Include"')}</td><td>${inp(`a.oneTime.${i}.name`, 'text', 'w-l')}</td><td>${inp(`a.oneTime.${i}.hours`, 'num')}</td><td>${sel(`a.oneTime.${i}.phase`, PHASE_OPTS)}</td><td class="r num">${otCounted(o)}</td><td><button class="btn ghost" data-act="rm-ot" data-i="${i}">Remove</button></td></tr>`).join('')}
    ${(() => { const pm = E.oneTimeBuckets(P).items.find(x => x.id === 'per-module'); return pm ? `<tr class="sub"><td></td><td class="muted">${esc(pm.name)}</td><td></td><td class="muted">Common methods</td><td class="r num">${H(pm.hours)}</td><td></td></tr>` : ''; })()}
    </tbody></table></div></section>
  <section class="panel"><h2>Risk range</h2>
    <div class="fields">${f('a.contingencyPct', 'Contingency buffer %', 'Added to the likely estimate')}${f('a.pertBest', 'Best case multiplier', 'Applied to the base estimate, without contingency')}${f('a.pertWorst', 'Worst case multiplier', 'Applied to the base estimate; contingency isn’t added on top')}</div>
    <p class="small muted">The status turns “At risk” when the likely finish is before the target but the worst-case finish isn’t.</p></section>
  <section class="panel"><h2>Team sizing</h2><p class="small muted">Used when ${esc(BRAND.name)} works out how many people to add.</p>
    <div class="fields">
      ${a.levels.map(l => f(`a.teamMix.${l.key}`, `Mix: ${l.key} %`)).join('')}
      <label class="field"><span class="lbl">New hires’ tool skill</span>${sel('a.hireSkill', a.skills.map(x => x.key))}</label>
      <label class="field"><span class="lbl">New hires’ location</span>${sel('a.hireLocation', P.locations)}</label>
      ${f('a.hireLeadDays', 'New hires join after (working days)', 'Time to hire or move people onto the project')}
      ${f('a.leadSpan', 'Engineers per lead')}
      ${f('a.managerAbove', 'Add a manager above team size')}
      ${f('a.managerAlloc', 'Manager allocation %')}
    </div></section>
  <div class="row"><button class="btn" data-act="reset-factors">Reset all factors to defaults</button>${S.confirmReset ? `<span class="confirm">Reset every factor on this tab? <button class="btn danger" data-act="reset-yes">Reset</button><button class="btn" data-act="reset-no">Cancel</button></span>` : ''}</div>`;
}

/* ---------- Tracking ---------- */
/* ---------- Tracking tab ---------- */
const ST_LABEL = { ok: 'On track', risk: 'At risk', no: 'Behind', ahead: 'Ahead', notstarted: 'Not started' };
const ST_PILL = { ok: 'ok', risk: 'risk', no: 'no', ahead: 'ok', notstarted: 'na' };
const KINDS = [['designed', 'Test cases designed', 'design', 'designN'], ['automated', 'Test cases automated', 'script', 'autoN'], ['executed', 'Manual executions', 'exec', 'runs']];
const OT_LABEL = { setup: 'Onboarding and setup', framework: 'Framework development', common: 'Common methods', cicd: 'CI/CD and reporting', close: 'Closure and handover' };
const OT_LC = { setup: 'onboarding and setup', framework: 'framework development', common: 'common methods', cicd: 'CI/CD and reporting', close: 'closure and handover' };
const n0 = v => nf0.format(Math.round(v || 0));

function baselinePanel(A) {
  const P = S.P, b = P.baseline, hist = P.baselineHistory || [];
  const canFreeze = A.sched && A.sched.finish;
  const freezeForm = (label, cancel) => `<div class="row" style="align-items:flex-end">
      <label class="field" style="flex:1;min-width:240px"><span class="lbl">${b ? 'Reason for re-baselining' : 'Note (optional)'}</span><input type="text" id="baseline-reason" placeholder="${b ? 'Required, e.g. Customer added the Mobile module (CR-12)' : 'e.g. Estimate approved by customer on 12 Nov'}"></label>
      <button class="btn primary" data-act="baseline-freeze" ${canFreeze ? '' : 'disabled'}>${label}</button>${cancel ? '<button class="btn" data-act="baseline-cancel">Cancel</button>' : ''}</div>
      ${S.baselineNote ? `<span class="small" style="color:var(--bad)">${esc(S.baselineNote)}</span>` : ''}`;
  if (!b) return `<section class="panel"><div class="panel-head"><h2>Baseline</h2>${pill('na', 'Not frozen')}</div>
    <p class="small muted">Freeze the plan once the estimate is agreed with the customer. Tracking and status emails then measure against it, and later changes to the plan show up as variances instead of quietly moving the goalposts. Until then, progress is compared with the current plan.</p>
    ${canFreeze ? freezeForm('Freeze baseline', false) : '<p class="small muted">The plan needs a finish date first: add a team and a start date.</p>'}</section>`;
  const v = E.baselineVariance(P, A.sched);
  const chips = [];
  if (v.finishDays) chips.push(`<span class="chip ${v.finishDays > 0 ? 'chip-bad' : 'chip-good'}">Current plan finishes ${Math.abs(v.finishDays)} days ${v.finishDays > 0 ? 'later' : 'earlier'}</span>`);
  if (Math.abs(v.effort) >= 1) chips.push(`<span class="chip">${v.effort > 0 ? '+' : '−'}${H(Math.abs(v.effort))} h effort</span>`);
  if (Math.abs(v.tcs) >= 0.5) chips.push(`<span class="chip">${v.tcs > 0 ? '+' : '−'}${n0(Math.abs(v.tcs))} test cases</span>`);
  if (v.endChanged) chips.push(`<span class="chip">Target date changed (was ${fd(b.end)})</span>`);
  return `<section class="panel"><div class="panel-head"><h2>Baseline</h2>${pill('ok', 'Frozen ' + fd(b.at))}</div>
    <p>Progress is measured against the baseline frozen on <b>${fd(b.at)}</b>${b.reason ? ` (${esc(b.reason)})` : ''}: finish ${fd(b.finish)}, ${H(b.total)} h, ${n0(b.tcs)} test cases (${n0(b.autoTCs)} automated).</p>
    ${chips.length ? `<div class="chips"><span class="small muted">Since then:</span>${chips.join('')}</div>` : '<p class="small muted">The current plan matches the baseline.</p>'}
    ${v.endChanged ? `<p class="small muted">Status and emails still measure lateness against the baselined target (${fd(b.end)}). Re-baseline to adopt the new date.</p>` : ''}
    ${P.modules.some(m => !b.W.mods.some(x => x.id === m.id)) ? `<p class="small muted">Modules added since the baseline (${P.modules.filter(m => !b.W.mods.some(x => x.id === m.id)).map(m => esc(m.name)).join(', ')}) are tracked separately and don’t count as progress until you re-baseline.</p>` : ''}
    ${S.rebaseline ? freezeForm('Freeze new baseline', true) : `<div><button class="btn" data-act="baseline-start">Re-baseline…</button></div>`}
    ${hist.length > 1 ? `<details class="howto"><summary>Baseline history (${hist.length})</summary><div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th>Frozen</th><th>Reason</th><th class="r">Finish</th><th class="r">Effort h</th><th class="r">Test cases</th></tr></thead><tbody>
      ${hist.slice().reverse().map(h => `<tr><td>${fd(h.at)}</td><td>${esc(h.reason || '—')}</td><td class="r num">${fd(h.finish)}</td><td class="r num">${H(h.total)}</td><td class="r num">${n0(h.tcs)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
  </section>`;
}

function viewTracking() {
  const P = S.P, A = analysis(), T = E.tracking(P, liveActuals(), A.sched);
  S.T = T;
  const weeks = T.rows.map(r => r.week);
  if (!weeks.includes(S.trWeek)) S.trWeek = weeks[weeks.length - 1] || null;
  const L = T.last;
  const spiState = T.spi == null ? null : T.spi >= 0.97 ? 'ok' : T.spi >= 0.85 ? 'risk' : 'no';
  const planLbl = T.baseline ? 'baseline' : 'current plan';
  const kpis = `<div class="kpis">
    <div class="kpi"><span class="lbl">Completed</span><span class="v">${L ? pct(L.pct) : '—'}</span><span class="small muted">weighted by effort, incl. setup and framework</span></div>
    <div class="kpi"><span class="lbl">Planned by now</span><span class="v">${L && L.plannedPct != null ? pct(L.plannedPct) : '—'}</span><span class="small muted">${L ? `${planLbl}, end of week of ${fd(L.week)}` : 'log a week to compare'}</span></div>
    <div class="kpi"><span class="lbl">Schedule index</span><span class="v">${T.spi == null ? '—' : T.spi.toFixed(2)}</span>${spiState ? pill(spiState, ST_LABEL[spiState]) : '<span class="small muted">once planned work starts</span>'}</div>
    <div class="kpi"><span class="lbl">Earned h per logged h</span><span class="v">${T.eff == null ? '—' : T.eff.toFixed(2)}</span><span class="small muted">${T.effPlan ? `plan implies ${T.effPlan.toFixed(2)}` : 'log hours to compare with the plan'}</span>${T.effIndex != null ? (T.effIndex >= 0.95 ? pill('ok', 'As planned') : T.effIndex >= 0.85 ? pill('risk', 'Slightly low') : pill('no', 'Low')) : ''}</div>
    <div class="kpi"><span class="lbl">Forecast at current pace</span><span class="v" style="font-size:17px">${T.forecastRaw ? fd(T.forecastRaw) : '—'}</span><span class="small muted">${planLbl} finish ${T.end ? fd(T.end) : '—'}${T.forecast && T.forecastRaw && Math.abs(E.daysBetween(T.forecast, T.forecastRaw)) > 7 ? ` · smoothed for early weeks ${fd(T.forecast)}` : ''}</span></div>
  </div>`;
  const rows = T.rows.map(r => {
    const sp = r.plannedPct > 0 ? r.pct / r.plannedPct : null, st = sp == null ? null : sp >= 0.97 ? 'ok' : sp >= 0.85 ? 'risk' : 'no';
    return `<tr class="${r.week === S.trWeek ? 'sel' : ''}"><td>${fd(r.week)}</td><td class="r num">${n0(r.designed)}</td><td class="r num">${n0(r.automated)}</td><td class="r num">${n0(r.executed)}</td><td class="r num">${n0(E.hoursOf(r))}</td>
      <td class="r num">${pct(r.pct)}</td><td class="r num">${r.plannedPct == null ? '—' : pct(r.plannedPct)}</td><td>${st ? pill(st, ST_LABEL[st]) : ''}</td>
      <td class="r"><button class="btn" data-act="tr-edit" data-id="${r.id}">${r.week === S.trWeek ? 'Editing' : 'Edit'}</button> ${S.confirmRm === 'ac:' + r.id ? `<span class="confirm">Remove this week? <button class="btn danger" data-act="rm-ac" data-id="${r.id}">Yes</button><button class="btn" data-act="rm-no">No</button></span>` : `<button class="btn ghost" data-act="rm-ac-ask" data-id="${r.id}">Remove</button>`}</td></tr>`;
  }).join('');
  const R = S.trWeek ? E.weekReport(P, liveActuals(), A.sched, S.trWeek) : null;
  return `${baselinePanel(A)}
  <section class="panel">
    <div class="panel-head"><h2>Weekly actuals</h2><button class="btn primary" data-act="add-week">Log next week</button></div>
    <p class="small muted">Log what each module finished every week, and how far setup and framework work has got. Completion is weighted by estimated hours and compared with the ${T.baseline ? 'frozen baseline' : 'current plan (no baseline frozen yet)'}.</p>
    ${kpis}
    <div class="tbl-wrap"><table><thead><tr><th>Week starting</th><th class="r">Designed</th><th class="r">Automated</th><th class="r">Manual executions</th><th class="r">Hours</th><th class="r">Done</th><th class="r">Plan</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="9" class="muted">No weeks logged yet. Select “Log next week” to add the first one.</td></tr>`}</tbody></table></div>
  </section>
  ${R ? weekEditor(R) + moduleProgress(R) + mailPanel(R) : ''}
  <section class="panel"><div class="panel-head"><h2>Planned against actual completion</h2><div class="legend"><span><i style="background:var(--s1)"></i>Planned (${planLbl})</span><span><i style="background:var(--s2)"></i>Actual</span></div></div>
    <div class="chart" id="burn-chart"></div></section>`;
}

function weekEditor(R) {
  const r = liveActuals().find(x => x.week === R.week); if (!r) return '';
  const mods = r.mods || {};
  const cell = (m, k) => {
    const [key, , pk, scopeK] = k;
    if (!(m[scopeK] > 0)) return '<td class="muted">—</td>';
    const v = (mods[m.id] || {})[key] || 0;
    const room = Math.max(0, Math.round(m[scopeK] - (m.act[key] - m.week[key])));
    return `<td><input type="number" class="w-s" min="0" max="${room}" step="1" id="ac-${r.id}-${m.id}-${key}" data-ac="${r.id}" data-mod="${m.id}" data-k="${key}" value="${v}"><span class="plan-hint">plan ${n0(m.weekPlan[pk])} · max ${room}</span></td>`;
  };
  const hasMods = r.mods && Object.keys(r.mods).length;
  const legacy = hasMods ? (r.mods._all || null) : ((+r.designed || 0) + (+r.automated || 0) + (+r.executed || 0) > 0 ? { designed: r.designed, automated: r.automated, executed: r.executed } : null);
  const otRows = R.ot.map(o => {
    const val = r.ot && r.ot[o.key] != null && r.ot[o.key] !== '' ? r.ot[o.key] : '';
    return `<label class="field"><span class="lbl">${OT_LABEL[o.key]} % done</span><input type="number" min="0" max="100" step="1" id="ac-${r.id}-ot-${o.key}" data-ac="${r.id}" data-ot="${o.key}" value="${val}" placeholder="${o.done != null ? Math.round(o.done) : 0}"><span class="hint">Planned by this week: ${Math.round(o.planned)}%</span></label>`;
  }).join('');
  return `<section class="panel">
    <div class="panel-head"><h2>Week of ${fd(R.week)} <span class="muted small">week ${R.weekNo}</span></h2>
      <label class="row small">Week ${selWeek('tr-week-a')}</label></div>
    ${fieldConflictBanner()}
    ${R.warnings.length ? `<div class="banner" role="status">${R.warnings.map(esc).join('<br>')}</div>` : ''}
    <div class="tbl-wrap"><table><thead><tr><th>Module</th>${KINDS.map(k => `<th>${k[1]}</th>`).join('')}</tr></thead><tbody>
      ${R.mods.map(m => `<tr><td>${esc(m.name)}</td>${KINDS.map(k => cell(m, k)).join('')}</tr>`).join('')}
      ${R.outside.map(o => `<tr class="sub"><td>${esc(o.name)} <span class="small muted">(not in baseline)</span></td>${KINDS.map(([key]) => `<td><input type="number" class="w-s" min="0" step="1" id="ac-${r.id}-${o.id}-${key}" data-ac="${r.id}" data-mod="${o.id}" data-k="${key}" value="${(mods[o.id] || {})[key] || 0}"></td>`).join('')}</tr>`).join('')}
      ${legacy ? `<tr class="sub"><td>Not split by module <span class="small muted">(logged before modules)</span></td>${KINDS.map(([key]) => `<td><input type="number" class="w-s" min="0" step="1" id="ac-${r.id}-_all-${key}" data-ac="${r.id}" data-mod="_all" data-k="${key}" value="${legacy[key] || 0}"></td>`).join('')}</tr>` : ''}
      <tr class="total"><td>This week</td>${KINDS.map(([key, , pk]) => `<td class="num">${n0(R.totals.week[key])} <span class="plan-hint">plan ${n0(R.thisPlan.total[pk])}</span></td>`).join('')}</tr>
    </tbody></table></div>
    ${otRows ? `<div><h3>Setup and framework progress</h3><p class="small muted">Percent complete to date. Leave blank to carry over last week’s figure.</p><div class="fields" style="margin-top:8px">${otRows}</div></div>` : ''}
    <div><h3>Hours logged</h3><p class="small muted">Each person’s timesheet hours for the week. Used for productivity (earned hours per logged hour). Total: <b class="num">${n0(E.hoursOf(r))} h</b>.</p>
      <div class="fields" style="margin-top:8px">${S.P.team.map(p => `<label class="field"><span class="lbl">${esc(p.name)}</span><input type="number" min="0" max="200" step="any" id="ac-${r.id}-h-${p.id}" data-ac="${r.id}" data-hp="${p.id}" value="${r.hoursBy && r.hoursBy[p.id] != null ? r.hoursBy[p.id] : ''}" placeholder="0"></label>`).join('')}
      ${Object.keys(r.hoursBy || {}).filter(pid => !S.P.team.some(p => p.id === pid)).map(pid => `<label class="field"><span class="lbl">Former team member</span><input type="number" min="0" max="200" step="any" id="ac-${r.id}-h-${pid}" data-ac="${r.id}" data-hp="${pid}" value="${r.hoursBy[pid]}"><span class="hint">No longer on the team; hours still count</span></label>`).join('')}
      ${!(r.hoursBy && Object.keys(r.hoursBy).length) && +r.hours > 0 ? `<label class="field"><span class="lbl">Earlier total (not split)</span><input type="number" min="0" step="any" id="ac-${r.id}-hours" data-ac="${r.id}" data-k="hours" value="${+r.hours || 0}"><span class="hint">Replaced once you enter hours per person</span></label>` : ''}</div></div>
    <div class="grid2">
      <label class="field"><span class="lbl">Highlights this week</span><textarea rows="4" id="ac-${r.id}-notes" data-ac="${r.id}" data-k="notes" placeholder="One per line, e.g. Login and payments flows automated">${esc(r.notes || '')}</textarea></label>
      <label class="field"><span class="lbl">Blockers and risks</span><textarea rows="4" id="ac-${r.id}-blockers" data-ac="${r.id}" data-k="blockers" placeholder="One per line, e.g. Test environment down Tuesday to Thursday">${esc(r.blockers || '')}</textarea></label>
    </div>
  </section>`;
}

function selWeek(id) {
  return `<select id="${id}" data-act-change="tr-week">${S.T.rows.map(r => `<option value="${r.week}" ${r.week === S.trWeek ? 'selected' : ''}>${fd(r.week)}</option>`).join('')}</select>`;
}

function moduleProgress(R) {
  const c = (m, key, pk, scopeK) => m[scopeK] > 0 ? `<td class="r num">${n0(m.act[key])} <span class="muted">/ ${n0(m.plan[pk])} / ${n0(m[scopeK])}</span></td>` : '<td class="r muted">—</td>';
  return `<section class="panel"><div class="panel-head"><h2>Progress by module</h2><span class="small muted">to the end of week of ${fd(R.week)} · done / planned / total</span></div>
    <div class="tbl-wrap"><table><thead><tr><th>Module</th>${KINDS.map(k => `<th class="r">${k[1]}</th>`).join('')}<th class="r">Done</th><th>Status</th></tr></thead><tbody>
    ${R.mods.map(m => `<tr><td>${esc(m.name)}</td>${KINDS.map(([key, , pk, sk]) => c(m, key, pk, sk)).join('')}<td class="r num">${pct(m.pctDone)}</td><td>${pill(ST_PILL[m.status], ST_LABEL[m.status])}</td></tr>`).join('')}
    ${R.outside.map(o => `<tr class="sub"><td>${esc(o.name)}</td>${KINDS.map(([key]) => `<td class="r num">${n0(o.act[key])}</td>`).join('')}<td></td><td>${pill('na', 'Not in baseline')}</td></tr>`).join('')}
    ${R.ot.map(o => `<tr class="sub"><td>${OT_LABEL[o.key]}</td><td colspan="3" class="muted small">${o.done == null ? 'not logged yet' : Math.round(o.done) + '% done'} · ${Math.round(o.planned)}% planned by now</td><td class="r num">${o.done == null ? '—' : Math.round(o.done) + '%'}</td><td>${o.done == null ? '' : o.done + 3 >= o.planned ? pill('ok', 'On track') : o.done + 15 >= o.planned ? pill('risk', 'At risk') : pill('no', 'Behind')}</td></tr>`).join('')}
    </tbody></table></div></section>`;
}

/* ---------- Status email ---------- */
const MAIL_COL = { ok: '#0a7d0a', risk: '#a36a00', no: '#b42f2f' };
const MAIL_TD = 'border:1px solid #c9d1ce;padding:4px 8px;';
const MAIL_TH = MAIL_TD + 'background:#eef2f0;text-align:left;font-weight:bold;';
const mt = (head, rows, alignR = []) => `<table style="border-collapse:collapse;margin:4px 0 12px 0;font-size:10.5pt"><tr>${head.map((h, i) => `<th style="${MAIL_TH}${alignR.includes(i) ? 'text-align:right;' : ''}">${h}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map((c, i) => `<td style="${MAIL_TD}${alignR.includes(i) ? 'text-align:right;' : ''}">${c}</td>`).join('')}</tr>`).join('')}</table>`;
const mh = t => `<p style="margin:14px 0 4px 0"><b>${t}</b></p>`;
const mul = items => `<ul style="margin:2px 0 10px 0;padding-left:20px">${items.map(x => `<li>${x}</li>`).join('')}</ul>`;

function mailModel(R, aud) {
  const P = S.P, A = analysis(), M = summaryModel(A), internal = aud === 'internal';
  const title = M.title || P.name || 'the project';
  const label = ST_LABEL[R.status];
  const subject = `${title}: weekly status, week of ${fd(R.week)} (${label})`;
  const pl = R.row.plannedPct, target = R.target;
  let reason = `${pct(R.row.pct)} complete against ${pl == null ? '—' : pct(pl)} planned`;
  if (R.early && R.forecast) {
    reason = `Early days: ${pct(R.row.pct)} complete against ${pl == null ? '—' : pct(pl)} planned${R.spi != null ? ` (${pct(R.spi)} of the planned pace)` : ''}. If this pace held, the work would finish ${fd(R.forecast)}${target ? (R.late > 0 ? `, after the ${fd(target)} target` : `, within the ${fd(target)} target`) : ''}; the picture will firm up over the next few weeks`;
  } else if (R.forecast) {
    reason += `; at the current pace the work finishes ${fd(R.forecast)}` + (target ? (R.late > 0 ? `, ${plural(R.late, 'day', 'days')} after the ${fd(target)} target` : `, within the ${fd(target)} target`) : '');
    if (R.forecastSmoothed && Math.abs(E.daysBetween(R.forecastSmoothed, R.forecast)) > 7) reason += ` (allowing for early-week variation, about ${fd(R.forecastSmoothed)})`;
  }
  reason += '.';
  let base = '';
  if (R.targetChanged) base += `The target date has moved from ${fd(R.targetChanged.from)} to ${R.targetChanged.to ? fd(R.targetChanged.to) : 'none'} since the baseline; we still report against ${fd(R.targetChanged.from)} until the baseline is updated. `;
  if (R.baseline) {
    base += `Measured against the baseline agreed on ${fd(R.baseline.at)}.`;
    const h = R.history; if (h.length > 1) base += ` Re-baselined on ${fd(h[h.length - 1].at)}${h[h.length - 1].reason ? ': ' + h[h.length - 1].reason : ''}.`;
  }
  const inScope = KINDS.filter(([, , , sk]) => R.mods.some(m => m[sk] > 0));
  const scopeTot = { designed: R.totals.scope.design, automated: R.totals.scope.automate, executed: R.totals.scope.exec };
  const risks = [];
  R.mods.forEach(m => {
    if (m.status === 'no') risks.push(`<b>${esc(m.name)}</b> is behind plan: ${pct(m.earnedP ? m.earnedA / m.earnedP : 0)} of the work planned by now is done.`);
    else if (m.status === 'risk') risks.push(`<b>${esc(m.name)}</b> is slightly behind plan.`);
  });
  R.ot.forEach(o => { if (o.done != null && o.done + 15 < o.planned) risks.push(`<b>${OT_LABEL[o.key]}</b> is behind: ${Math.round(o.done)}% done against ${Math.round(o.planned)}% planned.`); });
  if (R.late > 0) risks.push(`At the current pace the finish moves to ${fd(R.forecast)}, ${plural(R.late, 'day', 'days')} after the target.`);
  if (internal && R.effIndex != null && R.effIndex < 0.85) risks.push(`Productivity is ${R.eff.toFixed(2)} earned hours per logged hour, against about ${R.effPlan.toFixed(2)} in the plan.`);
  if (R.drift && R.drift.days > 0) risks.push(`Since the baseline the plan has changed and now finishes ${fd(R.drift.liveFinish)}, ${plural(R.drift.days, 'day', 'days')} later${target && R.drift.liveFinish > target ? `, after the ${fd(target)} target` : ''}. This needs a change request or a re-baseline.`);
  if (R.outside.some(o => o.act.designed + o.act.automated + o.act.executed > 0)) risks.push(`Work is being done on modules outside the agreed baseline (listed below). It isn’t counted as progress until a change request is agreed.`);
  if (internal) R.warnings.forEach(w => risks.push(esc(w)));
  lines(R.row.blockers).forEach(x => risks.push(esc(x)));
  const nx = [];
  const np = R.nextPlan.total;
  const parts = [['design', 'design'], ['script', 'automate'], ['exec', 'run']].filter(([k]) => np[k] >= 0.5).map(([k, v]) => `${v} about ${n0(np[k])}`);
  if (parts.length) nx.push(`Planned: ${parts.join(', ')} test cases.`);
  const otNext = R.ot.filter(o => o.nextPlanned > o.planned + 0.5 && o.planned < 100).map(o => `${OT_LC[o.key]} to about ${Math.round(o.nextPlanned)}%`);
  if (otNext.length) nx.push(`Setup and framework: ${otNext.join(', ')}.`);
  const top = R.mods.filter(m => m.next.design + m.next.script + m.next.exec >= 0.5).map(m => esc(m.name));
  if (top.length) nx.push(`Focus: ${top.join(', ')}.`);
  R.ms.forEach(m => nx.push(`${esc(m.label)}: ${fd(m.date)}.`));
  const ns = E.addDays(R.week, 7), ne = E.addDays(R.week, 13);
  const locs = [...new Set(P.team.map(r => r.location))];
  const hol = P.holidays.filter(h => h.date >= ns && h.date <= ne && locs.includes(h.location) && P.a.workDays.includes(E.dow(h.date)));
  if (hol.length) nx.push(`Public holiday${hol.length > 1 ? 's' : ''}: ${hol.map(h => `${esc(h.name)} (${esc(h.location)}, ${fd(h.date)})`).join('; ')}.`);
  const leave = [];
  P.team.forEach(r => {
    let n = 0; for (let d = ns; d <= ne; d = E.addDays(d, 1)) if (P.a.workDays.includes(E.dow(d)) && (r.leaves || []).some(l => l.from && d >= l.from && d <= (l.to || l.from))) n++;
    if (n) leave.push([r.name, n]);
  });
  if (leave.length) nx.push(internal ? `On leave: ${leave.map(([n, d]) => `${esc(n)} (${plural(d, 'day', 'days')})`).join(', ')}.` : `Planned leave: ${plural(leave.reduce((t, x) => t + x[1], 0), 'person-day', 'person-days')}.`);
  const outside = R.outside.filter(o => o.act.designed + o.act.automated + o.act.executed > 0).map(o => `<b>${esc(o.name)}</b>: ${[['designed', 'designed'], ['automated', 'automated'], ['executed', 'manual executions']].filter(([k]) => o.act[k] > 0).map(([k, l]) => `${n0(o.act[k])} ${l}`).join(', ')} so far.`);
  const changes = R.changes.map(esc).concat(R.drift ? [`The current plan finishes ${fd(R.drift.liveFinish)}, ${plural(Math.abs(R.drift.days), 'day', 'days')} ${R.drift.days > 0 ? 'later' : 'earlier'} than the baseline.`] : []);
  return { title, subject, label, reason, base, outside, changes, inScope, scopeTot, risks, next: nx, highlights: lines(R.row.notes).map(esc), confirm: M.confirm.map(esc), internal, fte: M.fte };
}

function mailHTML(R, aud) {
  const P = S.P, X = mailModel(R, aud);
  const b = [];
  b.push(`<p>Hi all,</p>`);
  b.push(`<p>Here’s the weekly status for <b>${esc(X.title)}</b>, week ${R.weekNo} (${fd(R.week)} to ${fd(R.weekEnd)}).</p>`);
  b.push(`<p><b>Overall: <span style="color:${MAIL_COL[R.status]}">■ ${X.label}</span>.</b> ${X.reason}${X.base ? ' ' + esc(X.base) : ''}</p>`);
  b.push(mh('Progress'));
  b.push(mt(['', 'This week', 'Planned this week', 'To date', 'Planned to date', 'Total'],
    X.inScope.map(([key, lab, pk]) => [lab, n0(R.totals.week[key]), n0(R.thisPlan.total[pk]), `<b>${n0(R.totals.toDate[key])}</b>`, n0(R.toPlan.total[pk]), n0(X.scopeTot[key])]), [1, 2, 3, 4, 5]));
  const otShown = R.ot.filter(o => o.planned > 0 || o.done != null);
  if (otShown.length) b.push(mt(['Setup and framework', 'Done', 'Planned by now'], otShown.map(o => [OT_LABEL[o.key], o.done == null ? '—' : Math.round(o.done) + '%', Math.round(o.planned) + '%']), [1, 2]));
  if (R.mods.length > 1 || X.internal) {
    b.push(mh('By module'));
    b.push(mt(['Module', ...X.inScope.map(k => k[1].replace('Test cases ', '').replace(/^./, c => c.toUpperCase())), 'Done', 'Status'],
      R.mods.map(m => [esc(m.name), ...X.inScope.map(([key, , , sk]) => m[sk] > 0 ? `${n0(Math.min(m.act[key], m[sk]))} of ${n0(m[sk])}` : '—'), pct(m.pctDone), m.status === 'notstarted' ? 'Not started' : `<span style="color:${MAIL_COL[ST_PILL[m.status] === 'ok' ? 'ok' : m.status] || '#444'}">■</span> ${ST_LABEL[m.status]}`]), [X.inScope.length + 1]));
  }
  if (X.changes.length) { b.push(mh('Changes since the baseline')); b.push(mul(X.changes)); }
  if (X.outside.length) { b.push(mh('Work outside the agreed baseline (pending a change request)')); b.push(mul(X.outside)); }
  if (X.highlights.length) { b.push(mh('Highlights')); b.push(mul(X.highlights)); }
  b.push(mh('Risks and blockers'));
  b.push(X.risks.length ? mul(X.risks) : '<p style="margin:2px 0 10px 0">No new risks or blockers this week.</p>');
  if (X.next.length) { b.push(mh('Next week')); b.push(mul(X.next)); }
  if (X.confirm.length) { b.push(mh(X.internal ? 'Open with the customer' : 'What we need from you')); b.push(mul(X.confirm)); }
  if (X.internal) {
    b.push(mh('Effort'));
    b.push(mul([`Hours logged this week: ${n0(R.hoursWeek)} (to date ${n0(R.hoursToDate)}).`,
      `Earned hours per logged hour: ${R.eff == null ? '—' : R.eff.toFixed(2)}${R.effPlan ? ` (the plan implies about ${R.effPlan.toFixed(2)})` : ''}.`,
      `Schedule index: ${R.spi == null ? '—' : R.spi.toFixed(2)}. ${R.baseline ? 'Baseline' : 'Planned'} finish ${R.plannedFinish ? fd(R.plannedFinish) : '—'}.`,
      `Team: ${FTE(X.fte)} FTE.`]));
  }
  b.push(`<p>Regards,<br>${esc(P.notes.sender || 'Your name')}</p>`);
  return `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1f2a26">${b.join('')}</div>`;
}

function mailPanel(R) {
  const aud = S.mailAud || 'client', key = R.week + '|' + aud;
  const X = mailModel(R, aud);
  const gen = mailHTML(R, aud);
  S.mailGen = S.mailGen || {}; S.mailGen[key] = gen;
  const edited = S.mailEdits && S.mailEdits[key];
  const stale = edited && edited.base !== gen;
  const html = edited ? edited.html : gen;
  return `<section class="panel" id="mail-panel">
    <div class="panel-head"><h2>Status email</h2>
      <div class="row">
        <label class="row small">Week ${selWeek('tr-week-b')}</label>
        <div class="seg" role="group" aria-label="Audience">${[['client', 'Client'], ['internal', 'Internal']].map(([k, l]) => `<button class="${aud === k ? 'on' : ''}" data-act="mail-aud" data-k="${k}" aria-pressed="${aud === k}">${l}</button>`).join('')}</div>
      </div></div>
    <p class="small muted">${aud === 'client' ? 'Client version: progress, risks, next week and what you need from them. Hours, productivity and names on leave are left out.' : 'Internal version: adds hours, productivity, schedule index, data warnings and who is on leave.'} You can edit the draft below before copying.</p>
    <div class="fields">
      <label class="field"><span class="lbl">Sign off as</span>${inp('notes.sender', 'text', '', 'placeholder="Your name"')}</label>
    </div>
    <div class="subject-row"><span class="lbl">Subject</span><input type="text" id="mail-subject" readonly value="${esc(X.subject)}"><button class="btn" data-act="mail-subject">Copy subject</button></div>
    ${stale ? `<div class="banner" role="alert"><b>The numbers have changed since you edited this draft.</b> Copying is paused so out-of-date figures don’t go out.
      <div class="row" style="margin-top:8px"><button class="btn primary" data-act="mail-reset">Refresh the draft (discard my edits)</button><button class="btn" data-act="mail-keep">I’ve checked it, keep my edits</button></div></div>` : ''}
    <div id="mail-preview" class="mail" contenteditable="true" spellcheck="true" data-key="${esc(key)}">${html}</div>
    <div class="row">
      <button class="btn primary" data-act="mail-copy" ${stale ? 'disabled' : ''}>Copy email</button>
      <button class="btn" data-act="mail-plain" ${stale ? 'disabled' : ''}>Copy as plain text</button>
      ${edited && !stale ? `<button class="btn" data-act="mail-reset">Undo my edits</button><span class="small muted">Edited</span>` : ''}
      ${S.mailNote ? `<span class="small" style="color:var(--good)">${esc(S.mailNote)}</span>` : ''}
    </div>
  </section>`;
}

document.addEventListener('input', ev => {
  const el = ev.target;
  if (el && el.id === 'mail-preview') {
    S.mailEdits = S.mailEdits || {};
    const k = el.dataset.key, prev = S.mailEdits[k];
    S.mailEdits[k] = { html: el.innerHTML, base: prev ? prev.base : (S.mailGen && S.mailGen[k]) };
  }
});

function flashMail(t) { S.mailNote = t; renderAll(); clearTimeout(S.mailTimer); S.mailTimer = setTimeout(() => { S.mailNote = ''; if (S.tab === 'tracking') renderAll(); }, 3500); }
function selectNode(el) { const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
async function copyMail(plain) {
  if (S.calculating || !S.A) { await freshAsync(); renderAll(); }
  const el = $('#mail-preview'); if (!el) return;
  if (el.closest('#mail-panel').querySelector('[data-act=mail-copy][disabled]')) return;
  const html = el.innerHTML, text = el.innerText;
  try {
    if (plain) { await navigator.clipboard.writeText(text); }
    else {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard.write) throw new Error('no rich clipboard');
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
    }
    flashMail(plain ? 'Copied as plain text.' : 'Copied. Paste into Outlook or Teams.');
  } catch (e) {
    selectNode(el);
    let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { }
    if (ok) flashMail('Copied. Paste into Outlook or Teams.');
    else { S.mailNote = 'Copying isn’t available here. The draft is selected: press Ctrl+C (or ⌘C).'; renderAll(); selectNode($('#mail-preview')); }
  }
}
async function copySubject() {
  const el = $('#mail-subject'); if (!el) return;
  try { await navigator.clipboard.writeText(el.value); flashMail('Subject copied.'); }
  catch (e) { el.focus(); el.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { } flashMail(ok ? 'Subject copied.' : 'Subject selected: press Ctrl+C.'); }
}

document.addEventListener('change', ev => {
  const el = ev.target;
  if (el.dataset && el.dataset.actChange === 'tr-week') { S.trWeek = el.value; renderAll(); return; }
  if (!el.dataset || !el.dataset.ac) return;
  const r = S.actuals.find(x => x.id === el.dataset.ac); if (!r) return;
  const k = el.dataset.k;
  if (k === 'notes' || k === 'blockers') return patchActual(r.id, { [k]: el.value });
  if (el.dataset.hp) {
    const v = el.value === '' ? 0 : Math.min(200, Math.max(0, Number(el.value) || 0));
    return patchActual(r.id, { hoursBy: { [el.dataset.hp]: v } });
  }
  if (el.dataset.ot) {
    const v = el.value === '' ? null : Math.min(100, Math.max(0, Math.round(Number(el.value) || 0)));
    return patchActual(r.id, { ot: { [el.dataset.ot]: v } });
  }
  let v = Math.max(0, Number(el.value) || 0);
  if (el.max !== '' && v > +el.max) { v = +el.max; el.value = v; S.saving = `Capped at the ${v} left in scope`; renderHeader(); }
  if (el.step === '1') v = Math.round(v);
  if (!el.dataset.mod) return patchActual(r.id, { [k]: v });
  const patch = { mods: { [el.dataset.mod]: { [k]: v } } };
  // first module entry on a week logged before modules: keep the old totals as "not split"
  if (!(r.mods && Object.keys(r.mods).length) && ((+r.designed || 0) + (+r.automated || 0) + (+r.executed || 0) > 0) && el.dataset.mod !== '_all')
    patch.mods._all = { designed: +r.designed || 0, automated: +r.automated || 0, executed: +r.executed || 0 };
  patchActual(r.id, patch);
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
  if (!analysis()) return;
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
  let plan = T.plan.map(p => [p[0], p[1] * 100]);
  if (T.end) plan = plan.filter(x => x[0] <= E.addDays(T.end, 6));
  const act = T.rows.map(r => [E.addDays(r.week, 6), r.pct * 100]);
  const refX = []; if (S.P.end) refX.push({ date: S.P.end, label: 'Target', anchor: 'end' });
  if (T.forecastRaw) refX.push({ date: T.forecastRaw, label: 'Forecast (current pace)', dy: 14 });
  lineChart(el, { series: [{ name: 'Planned', color: 'var(--s1)', pts: plan }, { name: 'Actual', color: 'var(--s2)', pts: act, markers: true }], refX, yMax: 100, yFmt: v => Math.round(v) + '%' });
}
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (S.tab === 'summary') drawCapChart(); if (S.tab === 'tracking') drawBurnChart(); if (S.tab === 'schedule') { drawGantt(); drawHeat(); } }, 150); });

/* ---------- Schedule tab ---------- */
const FW_STATUS = [['new', 'New framework to build'], ['extend', 'Extend an existing framework'], ['reuse', 'Reuse an existing framework as is']];
const CICD_MODES = [['new', 'New pipeline to set up'], ['existing', 'Hook into an existing pipeline'], ['none', 'Not needed']];
const PHASE_OPTS = [['start', 'Project start'], ['framework', 'Framework'], ['common', 'Common methods'], ['cicd', 'CI/CD and reporting'], ['end', 'Project end']];
function otCounted(o) { const it = E.oneTimeBuckets(S.P).items.find(x => x.id === o.id && x.name === o.name); return it ? H(it.hours) : '0'; }
function fwNote() { const st = S.P.a.frameworkStatus; return st === 'extend' ? ' (extending existing)' : st === 'reuse' ? ' (reusing existing)' : ''; }
const CAT = {
  setup: 'Onboarding and setup', framework: 'Framework development', common: 'Common methods', cicd: 'CI/CD and reporting', design: 'Manual test design',
  script: 'Automation scripting', exec: 'Manual execution', runs: 'Regression runs', close: 'Closure and handover', idle: 'Waiting for work'
};
const CAT_ORDER = ['setup', 'framework', 'common', 'cicd', 'design', 'script', 'exec', 'runs', 'close'];
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
  list.sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : (x.k === 'finish' || x.k === 'target') - (y.k === 'finish' || y.k === 'target'));
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
    <p class="small muted">Planned output per week from the current plan.${S.P.baseline ? ' Tracking compares actuals with the frozen baseline, which may differ (see the Tracking tab).' : ' Until a baseline is frozen, Tracking compares actuals with this plan.'}</p>
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
  if (!analysis()) return;
  const el = $('#gantt'); if (!el) return;
  const P = S.P, A = analysis(), sc = A.sched, { w0, nW } = weekDomain(A);
  const labelW = 210, rowH = 22, headH = 40;
  const avail = Math.max(320, el.clientWidth - labelW - 8);
  const colW = Math.max(12, Math.min(36, Math.floor(avail / nW)));
  const W = labelW + nW * colW + 8;
  const rows = [];
  const add = key => { const r = sc.rows[key]; if (r) rows.push({ type: 'row', r, label: CAT[r.cat] }); };
  add('setup'); add('framework'); add('common'); add('cicd');
  const modOrder = sc.mods;
  modOrder.forEach(m => {
    const pm = P.modules.find(x => x.id === m.id);
    rows.push({ type: 'group', label: m.name, from: pm && pm.availableFrom });
    ['design', 'script', 'exec', 'runs'].forEach(c => { const r = sc.rows[m.id + ':' + c]; if (r) rows.push({ type: 'row', r, label: CAT[c], indent: true }); });
  });
  add('close');
  const Hh = headH + rows.length * rowH + 34;
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
  [['framework', 'fwCore'], ['common', 'commonDone'], ['cicd', 'cicdDone']].forEach(([rk, mk]) => {
    const idx = rows.findIndex(x => x.r && x.r.key === rk), m = sc.ms[mk];
    if (idx < 0 || !m) return;
    const x = X(m.date) + colW / 7, y = headH + idx * rowH;
    s += `<path d="M${x} ${y + 4}l6 7l-6 7l-6 -7z" fill="var(--ink)" stroke="var(--surface)" stroke-width="1.5" data-tip="${esc(m.label)}: ${fd(m.date)}"/>`;
  });
  // target / finish / today lines
  const vline = (d, color, dash, label, anchorEnd, ly = Hh - 4) => { const x = X(d) + colW / 7; s += `<line x1="${x}" x2="${x}" y1="20" y2="${ly - 10}" stroke="${color}" stroke-width="1.5" ${dash ? 'stroke-dasharray="4 3"' : ''}/><text x="${x + (anchorEnd ? -4 : 4)}" y="${ly}" text-anchor="${anchorEnd ? 'end' : 'start'}" class="g-week" style="fill:${color}">${label}</text>`; };
  const nearEnd = d => X(d) > W - 120;
  if (P.end && P.end === sc.finish) vline(sc.finish, 'var(--accent)', false, 'Finish = target ' + fdShort(sc.finish), nearEnd(sc.finish));
  else {
    if (P.end) vline(P.end, 'var(--ink)', true, 'Target ' + fdShort(P.end), sc.finish > P.end || nearEnd(P.end));
    vline(sc.finish, 'var(--accent)', false, 'Finish ' + fdShort(sc.finish), (P.end && sc.finish < P.end) || nearEnd(sc.finish), Hh - 17);
  }
  const today = E.toS(Date.now()); if (today > w0 && today < E.addDays(w0, nW * 7)) vline(today, 'var(--faint)', true, 'Today', false, Hh - 17);
  s += '</svg>';
  el.innerHTML = s;
}

function drawHeat() {
  if (!analysis()) return;
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
  return `<div class="tbl-wrap" style="max-height:520px;overflow:auto"><table><thead><tr><th>Week of</th><th class="r">Working days</th><th>Main work</th><th class="r">Test cases designed</th><th class="r">Test cases automated</th><th class="r">Manual executions</th><th class="r">Team productive h</th><th class="r">Waiting h</th><th class="r">Planned done (current plan)</th></tr></thead><tbody>
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
    case 'show-deleted': S.showDeleted = true; renderAll(); break;
    case 'hide-deleted': S.showDeleted = false; renderAll(); break;
    case 'restore-project': S.toast = null; renderToast(); restoreProject(b.dataset.id); break;
    case 'restore-week': S.toast = null; renderToast(); patchActual(b.dataset.id, { deletedAt: null }, true); break;
    case 'toast-close': S.toast = null; renderToast(); break;
    case 'repaired-ok': S.repaired = null; renderAll(); break;
    case 'reset-factors-now': S.calcError = null; mut(() => { P.a = E.defaults(); }); break;
    case 'restore-mine': {
      S.deletedNotice = null; S.saving = 'Saving…'; renderHeader();
      const ref = S.db.doc('projects/' + S.id);
      (async () => {
        try {
          if (!S.db.selfHosted) await ref.update({ deletedAt: null, deletedBy: null });
          await writePlan(ref, 'Restored and saved', true);
          const l = S.all.find(x => x.id === S.id); if (l) l.deletedAt = null;
          S.list = S.all.filter(x => !x.deletedAt);
        } catch (e) { S.saving = 'Couldn’t restore: ' + (e.message || e.code); }
        S.pendingRev = null; renderAll();
      })();
      break;
    }
    case 'leave-deleted': { const gone = S.id; S.deletedNotice = null; S.P = null; S.id = null; S.list = S.all.filter(x => !x.deletedAt && x.id !== gone); if (S.list.length) openProject(S.list[0].id); else renderAll(); break; }
    case 'rm-mod-ask': S.confirmRm = 'mod:' + i; renderAll(); break;
    case 'rm-res-ask': S.confirmRm = 'res:' + i; renderAll(); break;
    case 'rm-ac-ask': S.confirmRm = 'ac:' + b.dataset.id; renderAll(); break;
    case 'rm-no': S.confirmRm = null; renderAll(); break;
    case 'restore-row': { const u = S.undoRow; if (!u) break; S.undoRow = null; S.toast = null; renderToast(); mut(() => { P[u.coll].splice(Math.min(u.index, P[u.coll].length), 0, u.item); }); break; }
    case 'xlsx': exportXlsx(); break;
    case 'conflict-use-theirs': resolveConflict(false); break;
    case 'fc-theirs': case 'fc-mine': case 'fc-both': {
      const c = S.fieldConflict; S.fieldConflict = null; if (!c) break;
      const r = S.actuals.find(x => x.id === c.id);
      if (act === 'fc-theirs') { if (r) setLeaf(r, c.path, c.theirs); S.actSeen[c.id] = setLeaf(S.actSeen[c.id] || {}, c.path, c.theirs); renderAll(); break; }
      const v = act === 'fc-both' ? [c.theirs, c.mine].filter(Boolean).join('\n') : c.mine;
      S.actSeen[c.id] = setLeaf(S.actSeen[c.id] || {}, c.path, c.theirs);
      patchActual(c.id, setLeaf({}, c.path, v), true); break;
    }
    case 'conflict-use-mine': resolveConflict(true); break;
    case 'conflict-theirs': { const t = S.conflict.theirs; S.conflict = null; try { S.P = migrate(JSON.parse(JSON.stringify(t.data))); S.baseP = JSON.parse(JSON.stringify(S.P)); S.rev = t.rev; S.A = null; S.Aprev = null; S.saving = 'Loaded the latest version'; } catch (e) { S.loadError = 'Their version is damaged and couldn’t be opened.'; S.P = null; } renderAll(); break; }
    case 'conflict-mine': { S.rev = S.conflict.theirs && S.conflict.theirs.rev; S.conflict = null; saveNow(); break; }
    case 'copy-summary': copySummary(); break;
    case 'sum-aud': S.sumAud = b.dataset.k; renderAll(); break;
    case 'copy-close': S.copyFallback = null; renderAll(); break;
    case 'add-mod': mut(() => P.modules.push(E.newModule('Module ' + (P.modules.length + 1), P.modules.length + 1))); break;
    case 'rm-mod': { S.confirmRm = null; const item = P.modules[i]; mut(() => P.modules.splice(i, 1)); S.undoRow = { coll: 'modules', index: i, item }; toast(`Removed module “${item.name}”.`, { act: 'restore-row' }); break; }
    case 'add-res': mut(() => { const r = E.newResource(P.team.length + 1); r.location = P.locations[0]; P.team.push(r); }); break;
    case 'rm-res': { S.confirmRm = null; const item = P.team[i]; mut(() => P.team.splice(i, 1)); S.undoRow = { coll: 'team', index: i, item }; toast(`Removed “${item.name}” from the team.`, { act: 'restore-row' }); break; }
    case 'tog-leave': S.openLeaves[b.dataset.id] = !S.openLeaves[b.dataset.id]; renderAll(); break;
    case 'add-leave': mut(() => P.team[i].leaves.push({ from: P.start, to: P.start, note: '' })); break;
    case 'rm-leave': mut(() => P.team[i].leaves.splice(+b.dataset.j, 1)); break;
    case 'add-loc': mut(() => P.locations.push('Location ' + (P.locations.length + 1))); break;
    case 'rm-loc': mut(() => P.locations.splice(i, 1)); break;
    case 'hol-import': {
      const loc = $('#hol-loc').value, lines = ($('#hol-paste').value || '').split('\n').map(x => x.trim()).filter(Boolean);
      let added = 0, bad = 0, dup = 0;
      lines.forEach(line => {
        let parts = line.split(/\t|,|;/).map(x => x.trim());
        // the name may itself contain commas: date first, location last (if it's a known location), name in between
        if (parts.length > 3 || (parts.length === 3 && !P.locations.includes(parts[2]))) {
          const lastIsLoc = P.locations.includes(parts[parts.length - 1]);
          parts = [parts[0], parts.slice(1, lastIsLoc ? -1 : undefined).join(', '), lastIsLoc ? parts[parts.length - 1] : ''];
        }
        let d = parts[0] || '';
        const m1 = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/), m2 = d.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
        const mdy = ($('#hol-order') || {}).value === 'mdy';
        if (m1) d = `${m1[1]}-${m1[2].padStart(2, '0')}-${m1[3].padStart(2, '0')}`;
        else if (m2) { const [dd, mm] = mdy ? [m2[2], m2[1]] : [m2[1], m2[2]]; d = `${m2[3]}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`; }
        else { bad++; return; }
        if (isNaN(E.toD(d)) || E.toS(E.toD(d)) !== d) { bad++; return; }
        const l = parts[2] && P.locations.includes(parts[2]) ? parts[2] : loc;
        if (P.holidays.some(h => h.date === d && h.location === l)) { dup++; return; }
        P.holidays.push({ id: E.uid(), date: d, name: parts[1] || 'Holiday', location: l }); added++;
      });
      S.holOpen = true; S.holNote = `Added ${added}.` + (dup ? ` Skipped ${dup} already listed.` : '') + (bad ? ` Couldn’t read ${bad} line${bad > 1 ? 's' : ''}: check the date format.` : '');
      touch(); break;
    }
    case 'hol-gen': {
      const loc = $('#hol-gen-loc').value, y = +$('#hol-gen-year').value;
      let added = 0;
      E.generateHolidays(y, y, [loc]).forEach(h => { if (!P.holidays.some(x => x.date === h.date && x.location === h.location)) { P.holidays.push(h); added++; } });
      S.holOpen = true; S.holNote = `Added ${added} ${loc} holidays for ${y}.`;
      touch(); break;
    }
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
      const weeks = liveActuals().map(x => x.week).sort();
      const wk = weeks.length ? E.addDays(weeks[weeks.length - 1], 7) : E.mondayOf(P.start);
      if (wk > E.mondayOf(E.toS(Date.now()))) { toast(`The week of ${fd(wk)} hasn’t started yet.`); break; }
      S.trWeek = wk;
      createActual({ id: wk, week: wk, notes: '', blockers: '', mods: {}, ot: {}, hoursBy: {} });
      break;
    }
    case 'rm-ac': S.confirmRm = null; deleteActual(b.dataset.id); break;
    case 'tr-edit': S.trWeek = (S.actuals.find(x => x.id === b.dataset.id) || {}).week; renderAll(); break;
    case 'mail-aud': S.mailAud = b.dataset.k; renderAll(); break;
    case 'mail-copy': copyMail(false); break;
    case 'mail-plain': copyMail(true); break;
    case 'mail-subject': copySubject(); break;
    case 'mail-reset': { const el = $('#mail-preview'); if (el && S.mailEdits) delete S.mailEdits[el.dataset.key]; renderAll(); break; }
    case 'mail-keep': { const el = $('#mail-preview'); const k = el && el.dataset.key; if (k && S.mailEdits && S.mailEdits[k]) S.mailEdits[k].base = S.mailGen[k]; renderAll(); break; }
    case 'baseline-start': S.rebaseline = true; S.baselineNote = ''; renderAll(); break;
    case 'baseline-cancel': S.rebaseline = false; S.baselineNote = ''; renderAll(); break;
    case 'baseline-freeze': {
      const reason = ($('#baseline-reason') || {}).value || '';
      if (P.baseline && !reason.trim()) { S.baselineNote = 'Give a reason for re-baselining. It goes into the status emails.'; renderAll(); break; }
      freshAsync().then(A => {
        if (!A.sched || !A.sched.finish) return;
        const b = E.makeBaseline(P, A.sched, reason.trim());
        P.baselineHistory = (P.baselineHistory || []).concat([{ at: b.at, reason: b.reason, finish: b.finish, total: b.total, tcs: b.tcs, autoTCs: b.autoTCs }]);
        P.baseline = b; S.rebaseline = false; S.baselineNote = '';
        touch();
      });
      break;
    }
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
  const P = S.P, A = await freshAsync(), e = A.e, a = P.a;
  if (typeof XLSX === 'undefined') { S.saving = 'Excel library didn’t load'; renderHeader(); return; }
  if (!S.dl) { S.saving = 'Downloads aren’t available in this view'; renderHeader(); return; }
  const wb = XLSX.utils.book_new();
  const add = (name, rows, widths) => { const ws = XLSX.utils.aoa_to_sheet(rows); if (widths) ws['!cols'] = widths.map(w => ({ wch: w })); XLSX.utils.book_append_sheet(wb, ws, name); };
  const r1 = v => Math.round(v * 10) / 10;
  const st = STATUS[A.status || 'nodate'][1];
  const SM = summaryModel(A);
  const sum = [
    ['Overview', SM.overview], ['Recommendation', SM.rec || ''], [],
    ['Project', P.name], ['Client', P.client], ['Start date', P.start], ['Target end date', P.end || ''], ['Status', st], [],
    ['Total effort (likely), hours', r1(e.total)], ['Total effort (likely), person-days', r1(e.total / a.hoursPerDay)],
    ['Best case, hours', r1(e.best)], ['Worst case, hours', r1(e.worst)], ['PERT expected, hours', r1(A.expectedTotal)], ...(A.teamTime ? [['Team time to price, hours', r1(A.teamTime.hours)], ['Team time FTE x working days', `${r1(A.teamTime.fte)} x ${A.teamTime.workdays}`]] : []), ...(A.need && A.need.teamTime ? [['Team time with recommended team, hours', r1(A.need.teamTime.hours)]] : []), [],
    ['Test cases', Math.round(e.tcs)], ['Test cases to automate', Math.round(e.autoTCs)], []
  ];
  if (A.finish) sum.push(['Finish with current team (likely)', A.finish.likely.date || 'Not reachable'], ['Finish (best)', A.finish.best.date || ''], ['Finish (worst)', A.finish.worst.date || '']);
  if (A.need) sum.push(['Extra engineers needed by target', A.need.extra ?? 'Over 300'], ['Extra engineers for worst case', A.needWorst.extra ?? 'Over 300'], ['Mix of extra engineers', (A.need.heads || []).map(h => h.n + ' x ' + h.level).join(', ')], ['Extra leads', A.need.needLeads || 0], ['Extra manager', A.need.needMgr || 0]);
  sum.push([], ['What\'s driving it'], ...SM.drivers.map(x => ['', x.replace('**internal**', '').replace(/\*\*/g, '')]));
  if (SM.excluded.length) sum.push([], ['Not included'], ...SM.excluded.map(x => ['', x]));
  if (SM.confirm.length) sum.push([], ['To confirm with the customer'], ...SM.confirm.map(x => ['', x]));
  if (A.scope) sum.push(['Share of scope achievable by target', r1(A.scope.f * 100) + '%'], ['Test cases achievable by target', Math.floor(e.tcs * Math.min(A.scope.f, 1))]);
  if (A.window) sum.push([], ['Productive capacity in window, hours', r1(A.window.total)]);
  add('Summary', sum, [40, 30]);
  const L = e.lines;
  add('Effort', [['Activity', 'Hours', 'Person-days'], ...[['Manual test design', L.design], ['Manual execution', L.exec], ['Automation scripting', L.script], ['Review and rework', L.review], ['Script maintenance', L.maint], ['Automation runs and failure analysis', L.autoExec], ['Framework development', L.otFramework], ['Common methods', L.otCommon], ['CI/CD and reporting setup', L.otCicd], ['Other one-time activities', L.otOther], ['Contingency', L.contingency], ['Total', e.total]].map(([n, h]) => [n, r1(h), r1(h / a.hoursPerDay)])], [38, 12, 12]);
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
    ['Manual execution cycles', a.manualCycles], ['Retest %', a.retestPct], ['Contingency %', a.contingencyPct], ['Automation framework', (FW_STATUS.find(x => x[0] === a.frameworkStatus) || [, 'New'])[1]], ['Extend: framework %', a.fwStatusPct.extend.framework], ['Extend: common methods %', a.fwStatusPct.extend.common], ['Reuse: framework %', a.fwStatusPct.reuse.framework], ['Reuse: common methods %', a.fwStatusPct.reuse.common], ['Common methods per automated module h', a.commonPerModule], ['CI/CD pipeline', (CICD_MODES.find(x => x[0] === a.cicdMode) || CICD_MODES[0])[1]], ['Existing pipeline CI/CD %', a.cicdExistingPct], ['Access lead time (working days)', a.accessDays], ['Framework core before common methods %', a.frameworkGatePct], ['People on common methods at once', a.commonMaxPeople], ['People on framework at once', a.frameworkMaxPeople], ['Client review (working days)', a.reviewDays], ['Gap between manual cycles (working days)', a.cycleGapDays], ['Best case multiplier', a.pertBest], ['Worst case multiplier', a.pertWorst],
    [], ['One-time activity', 'Hours'], ...E.oneTimeBuckets(P).items.map(o => [o.name + ' (' + o.phase + ')', r1(o.hours)])];
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
  if (liveActuals().length) { const T = E.tracking(P, liveActuals(), A.sched); add('Actuals', [['Week starting', 'Designed', 'Manual executions', 'Automated', 'Hours logged', 'Highlights', 'Blockers', 'Done %', 'Planned %'], ...T.rows.map(r => [r.week, r.designed, r.executed, r.automated, r.hours, r.notes || '', r.blockers || '', r1(r.pct * 100), r.plannedPct == null ? '' : r1(r.plannedPct * 100)])], [14, 10, 16, 10, 12, 30, 30, 10, 10]);
    const mn = id => id === '_all' ? 'Not split by module' : ((P.modules.find(m => m.id === id) || {}).name || id);
    add('Actuals by module', [['Week starting', 'Module', 'Designed', 'Automated', 'Manual executions'], ...T.rows.flatMap(r => Object.entries(r.mods || {}).map(([id, v]) => [r.week, mn(id), +v.designed || 0, +v.automated || 0, +v.executed || 0]))], [14, 28, 10, 10, 16]); }
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const fname = (P.name || 'estimate').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) + ' - estimate.xlsx';
  try { await S.dl.save({ filename: fname, data: new Blob([buf]) }); }
  catch (err) { if (err.code !== 'declined') { S.saving = 'Export didn’t complete'; renderHeader(); } }
}

/* ---------- boot ---------- */
(async function boot() {
  startWorker();
  try { const t = localStorage.getItem('tee.tab'); if (t) S.tab = t; } catch (e) { }
  S.loading = true; renderAll();
  const claude = window.claude;
  const [db, dl] = await Promise.all([
    claude ? claude.use('db').catch(() => null) : null,
    claude ? claude.use('downloads').catch(() => null) : null
  ]);
  S.dl = dl || false; S.db = db;
  if (db && db.selfHosted) { try { const r = await fetch('/api/me'); if (r.ok) { const me = await r.json(); S.me = me.user; S.role = me.role; S.authOn = me.auth; S.viewOnly = me.role === 'viewer'; } } catch (e) { } }
  if (!db) {
    S.local = true; S.loading = false;
    const P = exampleProject(); const id = 'local';
    S.list = [{ id, name: P.name, client: P.client, data: P }]; S.all = S.list.slice();
    openProject(id); return;
  }
  let first = true;
  const timer = setTimeout(() => { if (first) { S.loading = false; S.timeoutNote = 'Saved projects can’t be reached yet. They’ll appear here when the connection returns.'; renderAll(); } }, 10000);
  db.collection('projects').orderBy('updatedAt', 'desc').onSnapshot(snap => {
    S.all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    S.list = S.all.filter(x => !x.deletedAt);
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
      if (!cur) {
        const gone = S.all.find(x => x.id === S.id);
        if (gone && gone.deletedAt && (S.deletedNotice || S.saving === 'Unsaved' || S.saving === 'Saving…' || S.saving === 'Not saved')) { S.deletedNotice = S.deletedNotice || { by: gone.deletedBy, at: gone.deletedAt }; clearTimeout(saveTimer); renderAll(); return; }
        if (gone && gone.deletedAt) toast(`${gone.deletedBy || 'A colleague'} deleted “${gone.name}”.`, { act: 'restore-project', id: gone.id });
        S.P = null; S.id = null; if (S.list.length) openProject(S.list[0].id); else renderAll(); return;
      }
      if (cur.rev && cur.rev !== S.rev && cur.rev !== S.pendingRev && !S.conflict) {
        if (S.saving === 'Unsaved' || S.saving === 'Saving…') { clearTimeout(saveTimer); mergeWith(cur); return; } // both edited: merge now
        // someone else saved and we have no unsaved edits: take theirs
        try { S.P = migrate(JSON.parse(JSON.stringify(cur.data))); S.baseP = JSON.parse(JSON.stringify(S.P)); S.rev = cur.rev; S.Aprev = S.A || S.Aprev; S.A = null; S.calculating = false; S.editSeq = (S.editSeq || 0) + 1; } catch (e) { S.loadError = 'The latest version of this project is damaged and couldn’t be opened.'; S.P = null; }
        renderAll(); return;
      }
    }
    renderHeader();
  }, err => { S.loading = false; S.timeoutNote = 'Saved projects couldn’t be loaded' + (err && err.message ? ` (${err.message})` : '') + '. Check that the server is running, then reload the page.'; renderAll(); });
})();
