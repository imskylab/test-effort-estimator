/* ===== Estimation engine (pure functions, no DOM) ===== */
const ENGINE = (() => {
  const DAY = 86400000;
  const toD = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const toS = t => new Date(t).toISOString().slice(0, 10);
  const addDays = (s, n) => toS(toD(s) + n * DAY);
  const dow = s => new Date(toD(s)).getUTCDay(); // 0 Sun..6 Sat
  const daysBetween = (a, b) => Math.round((toD(b) - toD(a)) / DAY);
  const mondayOf = s => addDays(s, -((dow(s) + 6) % 7));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const realDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toS(toD(s)) === s;
  // Ids reach HTML attributes (data-id, element ids) and are matched between plans and actuals.
  const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
  const freshId = used => { let id; do { id = uid(); } while (used.has(id)); return id; };

  function defaults() {
    return {
      complexity: [
        { key: 'S', name: 'Simple', desc: 'Up to 10 steps, one screen or endpoint, static data', design: 0.5, exec: 0.25, auto: 3 },
        { key: 'M', name: 'Medium', desc: '11–20 steps, 2–3 screens, some data handling', design: 1, exec: 0.5, auto: 6 },
        { key: 'C', name: 'Complex', desc: '21–35 steps, integrations, dynamic data, waits', design: 2, exec: 1, auto: 12 },
        { key: 'V', name: 'Very complex', desc: 'Over 35 steps, end-to-end across systems, files or sync', design: 3, exec: 1.5, auto: 20 }
      ],
      appTypes: [
        { key: 'Web', factor: 1 }, { key: 'API', factor: 0.5 }, { key: 'Mobile', factor: 1.3 },
        { key: 'Desktop', factor: 1.25 }, { key: 'Packaged ERP/CRM', factor: 1.4 }, { key: 'Mainframe', factor: 1.3 }
      ],
      testData: [{ key: 'Low', factor: 1 }, { key: 'Medium', factor: 1.1 }, { key: 'High', factor: 1.25 }],
      levels: [
        { key: 'Junior', label: 'Junior (0–2 yrs)', productivity: 0.65, rampDays: 15 },
        { key: 'Mid', label: 'Mid (2–5 yrs)', productivity: 1, rampDays: 10 },
        { key: 'Senior', label: 'Senior (5–8 yrs)', productivity: 1.2, rampDays: 7 },
        { key: 'Expert', label: 'Expert (8+ yrs)', productivity: 1.35, rampDays: 5 }
      ],
      skills: [
        { key: 'Proficient', factor: 1, extraRamp: 0 },
        { key: 'Working knowledge', factor: 0.9, extraRamp: 5 },
        { key: 'New to tool', factor: 0.75, extraRamp: 15 }
      ],
      roles: [
        { key: 'Engineer', nonDevPct: 12.5 },
        { key: 'Lead', nonDevPct: 40 },
        { key: 'Manager', nonDevPct: 100 }
      ],
      rampStartPct: 40,
      hoursPerDay: 8,
      workDays: [1, 2, 3, 4, 5],
      unplannedLeavePct: 3,
      downtimePct: 5,
      reviewPct: 15,
      maintenancePct: 10,
      reusePct: 10,
      manualCycles: 2,
      retestPct: 20,
      autoCycles: 4,
      analysisPer100: 6,
      contingencyPct: 10,
      pertBest: 0.85,
      pertWorst: 1.35,
      teamMix: { Junior: 20, Mid: 50, Senior: 30, Expert: 0 },
      hireSkill: 'Working knowledge',
      hireLocation: 'India',
      hireLeadDays: 10,
      leadSpan: 8,
      managerAbove: 20,
      managerAlloc: 50,
      frameworkStatus: 'new',
      fwStatusPct: { extend: { framework: 40, common: 60 }, reuse: { framework: 10, common: 30 } },
      commonPerModule: 16,
      commonMaxPeople: 3,
      cicdMode: 'new',
      cicdExistingPct: 25,
      accessDays: 3,
      frameworkGatePct: 60,
      frameworkMaxPeople: 2,
      reviewDays: 3,
      cycleGapDays: 10,
      oneTime: [
        { id: 'ot1', name: 'Test strategy and planning', hours: 40, phase: 'start', on: true },
        { id: 'ot2', name: 'Application walkthrough and KT', hours: 24, phase: 'start', on: true },
        { id: 'ot3', name: 'Framework design and core development', hours: 160, phase: 'framework', on: true },
        { id: 'ot9', name: 'Common methods and reusable components', hours: 80, phase: 'common', on: true },
        { id: 'ot4', name: 'CI/CD pipeline integration', hours: 40, phase: 'cicd', on: true },
        { id: 'ot5', name: 'Reporting and dashboard setup', hours: 24, phase: 'cicd', on: true },
        { id: 'ot6', name: 'Environment and tool setup', hours: 24, phase: 'start', on: true },
        { id: 'ot7', name: 'Test data strategy', hours: 24, phase: 'start', on: true },
        { id: 'ot8', name: 'Closure report and handover', hours: 16, phase: 'end', on: true }
      ],
      v13: true
    };
  }

  /* Public holidays that can be calculated exactly. Festival holidays that follow the lunar
   * calendar (Holi, Eid, Dussehra, Diwali and others) are not generated: paste them from the
   * company holiday list on the Calendar tab. */
  function nthDow(y, m, dowWanted, n) { // n >= 1, or -1 for last
    if (n > 0) { let d = Date.UTC(y, m, 1); while (new Date(d).getUTCDay() !== dowWanted) d += DAY; return toS(d + (n - 1) * 7 * DAY); }
    let d = Date.UTC(y, m + 1, 0); while (new Date(d).getUTCDay() !== dowWanted) d -= DAY; return toS(d);
  }
  function observed(s) { const w = dow(s); return w === 6 ? addDays(s, -1) : w === 0 ? addDays(s, 1) : s; }
  function easter(y) { // anonymous Gregorian algorithm
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return toS(Date.UTC(y, month - 1, day));
  }
  const pad = n => String(n).padStart(2, '0');
  function generateHolidays(fromYear, toYear, locations = ['India', 'USA']) {
    const out = [], h = (date, name, location) => out.push({ id: uid(), date, name, location });
    for (let y = fromYear; y <= toYear; y++) {
      if (locations.includes('India')) {
        h(`${y}-01-01`, "New Year's Day", 'India'); h(`${y}-01-26`, 'Republic Day', 'India');
        h(addDays(easter(y), -2), 'Good Friday', 'India'); h(`${y}-08-15`, 'Independence Day', 'India');
        h(`${y}-10-02`, 'Gandhi Jayanti', 'India'); h(`${y}-12-25`, 'Christmas', 'India');
      }
      if (locations.includes('USA')) {
        h(observed(`${y}-01-01`), "New Year's Day", 'USA'); h(nthDow(y, 0, 1, 3), 'Martin Luther King Jr. Day', 'USA');
        h(nthDow(y, 1, 1, 3), "Presidents' Day", 'USA'); h(nthDow(y, 4, 1, -1), 'Memorial Day', 'USA');
        h(observed(`${y}-06-19`), 'Juneteenth', 'USA'); h(observed(`${y}-07-04`), 'Independence Day', 'USA');
        h(nthDow(y, 8, 1, 1), 'Labor Day', 'USA'); h(nthDow(y, 9, 1, 2), 'Columbus Day', 'USA');
        h(observed(`${y}-11-11`), 'Veterans Day', 'USA'); h(nthDow(y, 10, 4, 4), 'Thanksgiving', 'USA');
        h(observed(`${y}-12-25`), 'Christmas', 'USA');
      }
    }
    return out.sort((x, y) => x.date < y.date ? -1 : 1);
  }
  function defaultHolidays(year) { const y = year || new Date().getUTCFullYear(); return generateHolidays(y, y + 2); }

  function newModule(name, priority) {
    return { id: uid(), name: name || 'New module', appType: 'Web', tcs: 100, mix: { S: 30, M: 40, C: 20, V: 10 },
      autoPct: 80, testData: 'Medium', design: true, manualExec: true, automation: true, priority: priority || 1, availableFrom: '' };
  }
  function newResource(i) {
    return { id: uid(), name: 'Engineer ' + (i || 1), role: 'Engineer', activity: 'Both', level: 'Mid',
      skill: 'Proficient', alloc: 100, location: 'India', start: '', end: '', leaves: [] };
  }
  function newProject(name) {
    const today = toS(Date.now());
    const start = addDays(mondayOf(today), 7);
    return {
      name: name || 'Untitled project', client: '', start, end: '',
      locations: ['India', 'USA'],
      modules: [newModule('Module 1', 1)],
      team: [newResource(1)],
      holidays: defaultHolidays(+start.slice(0, 4)),
      downtimes: [],
      notes: { drivers: '', excluded: '', confirm: '', sender: '' },
      a: defaults()
    };
  }

  const find = (arr, key) => arr.find(x => x.key === key);
  // input guards: no negative counts, percentages within 0-100, whole cycles
  const nn = v => Math.max(0, +v || 0);
  const pct100 = v => Math.min(100, nn(v));
  const cycles = a => Math.max(0, Math.round(+a.manualCycles || 0));
  const PHASE_BY_ID = { ot1: 'start', ot2: 'start', ot3: 'framework', ot4: 'cicd', ot5: 'cicd', ot6: 'start', ot7: 'start', ot8: 'end', ot9: 'common' };
  const PHASES = ['start', 'framework', 'common', 'cicd', 'end'];

  // A frozen plan (baseline) must keep the shape compactPlan gives it, or tracking can't read it.
  const planOk = b => isObj(b) && isObj(b.weeks) && Object.values(b.weeks).every(isObj) &&
    isObj(b.W) && Array.isArray(b.W.mods) && b.W.mods.every(m => isObj(m) && typeof m.id === 'string') &&
    typeof b.W.V === 'number' && isFinite(b.W.V);

  // Bring a saved project up to the current data shape.
  function migrate(P) {
    const needsV13 = !(P.a && P.a.v13);
    // Repair anything that isn't the right type, so one bad setting can't break the page.
    const repaired = [];
    const d = defaults();
    if (!P.a || typeof P.a !== 'object' || Array.isArray(P.a)) { P.a = {}; repaired.push('all factors'); }
    const rowOk = (def, rows) => Array.isArray(rows) && rows.length > 0 && rows.every(r => r && typeof r === 'object' &&
      Object.entries(def[0]).every(([f, v]) => typeof v !== 'number' || (typeof r[f] === 'number' && isFinite(r[f]) && r[f] >= 0)));
    Object.entries(d).forEach(([k, def]) => {
      const v = P.a[k];
      if (v === undefined) return;
      const bad = Array.isArray(def) ? (def.length && typeof def[0] === 'object' ? !rowOk(def, v) : !Array.isArray(v) || !v.length || v.some(x => typeof x !== typeof def[0]))
        : typeof def === 'number' ? !(typeof v === 'number' && isFinite(v) && v >= 0)
        : typeof def === 'string' ? typeof v !== 'string'
        : typeof def === 'boolean' ? typeof v !== 'boolean'
        : def && typeof def === 'object' ? !(v && typeof v === 'object' && !Array.isArray(v)) : false;
      if (bad) { P.a[k] = def; repaired.push(k); }
    });
    if (!(P.a.hoursPerDay >= 1)) { P.a.hoursPerDay = d.hoursPerDay; repaired.push('hoursPerDay'); }
    if (!Array.isArray(P.modules)) { P.modules = []; repaired.push('modules'); }
    if (!Array.isArray(P.team)) { P.team = []; repaired.push('team'); }
    if (!Array.isArray(P.holidays)) { P.holidays = []; repaired.push('holidays'); }
    P.modules = P.modules.filter(m => m && typeof m === 'object');
    const moduleIds = new Set();
    P.modules.forEach(m => {
      if (typeof m.id !== 'string' || !SAFE_ID.test(m.id) || moduleIds.has(m.id)) { m.id = freshId(moduleIds); repaired.push(`id of ${m.name || 'a module'}`); }
      moduleIds.add(m.id);
      if (!(typeof m.tcs === 'number' && m.tcs >= 0)) { m.tcs = 0; repaired.push(`test cases of ${m.name || 'a module'}`); }
      if (!m.mix || typeof m.mix !== 'object') { m.mix = { S: 30, M: 40, C: 20, V: 10 }; repaired.push(`mix of ${m.name || 'a module'}`); }
    });
    P.team = P.team.filter(r => r && typeof r === 'object');
    const teamIds = new Set();
    P.team.forEach(r => {
      if (typeof r.id !== 'string' || !SAFE_ID.test(r.id) || teamIds.has(r.id)) { r.id = freshId(teamIds); repaired.push(`id of ${r.name || 'a team member'}`); }
      teamIds.add(r.id);
      if (!(typeof r.alloc === 'number' && r.alloc >= 0)) r.alloc = 100;
    });
    if (typeof P.start !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(P.start) || isNaN(toD(P.start))) { P.start = addDays(mondayOf(toS(Date.now())), 7); repaired.push('start date'); }
    if (P.end && (typeof P.end !== 'string' || isNaN(toD(P.end)))) { P.end = ''; repaired.push('target date'); }
    P.a = Object.assign(defaults(), P.a || {});
    P.a.oneTime.forEach(o => { if (!o.phase) o.phase = PHASE_BY_ID[o.id] || (o.pool === 'auto' ? 'framework' : 'start'); delete o.pool; });
    // v1.3: CI/CD and reporting no longer block scripting; common methods are their own step
    if (needsV13) {
      P.a.oneTime.forEach(o => { if ((o.id === 'ot4' || o.id === 'ot5') && o.phase === 'framework') o.phase = 'cicd'; });
      if (!P.a.oneTime.some(o => o.phase === 'common')) {
        const i = P.a.oneTime.findIndex(o => o.phase === 'framework');
        P.a.oneTime.splice(i + 1, 0, { id: 'ot9', name: 'Common methods and reusable components', hours: 80, phase: 'common', on: true });
      }
      P.a.v13 = true;
    }
    if (!Array.isArray(P.locations) || P.locations.some(x => typeof x !== 'string')) { P.locations = ['India', 'USA']; repaired.push('locations'); }
    P.locations = P.locations.slice(0, 50);
    if (!Array.isArray(P.downtimes)) { P.downtimes = []; repaired.push('downtimes'); }
    P.downtimes = P.downtimes.filter(x => isObj(x) && (!x.from || realDate(x.from)) && (!x.to || realDate(x.to)) &&
      (x.impact == null || (typeof x.impact === 'number' && isFinite(x.impact)))).slice(0, 1000);
    if (!Array.isArray(P.holidays)) P.holidays = [];
    // A damaged baseline would break every tracking screen: measure against the current plan instead.
    if (P.baseline != null && !planOk(P.baseline)) { P.baseline = null; repaired.push('baseline'); }
    if (P.baselineHistory != null && !Array.isArray(P.baselineHistory)) { P.baselineHistory = []; repaired.push('baseline history'); }
    if (Array.isArray(P.baselineHistory)) P.baselineHistory = P.baselineHistory
      .filter(h => isObj(h) && realDate(h.at) && (h.reason == null || typeof h.reason === 'string')).slice(0, 1000);
    P.modules.forEach((m, i) => { if (m.priority == null) m.priority = i + 1; if (m.availableFrom == null) m.availableFrom = ''; });
    P.team.forEach(r => r.leaves = r.leaves || []);
    // v1.5: CI/CD is new, existing or not needed
    if (P.a.cicdExists != null) { if (P.a.cicdMode === 'new' && P.a.cicdExists) P.a.cicdMode = 'existing'; delete P.a.cicdExists; }
    P.notes = Object.assign({ drivers: '', excluded: '', confirm: '', sender: '' }, P.notes || {});
    if (repaired.length) Object.defineProperty(P, '_repaired', { value: repaired, enumerable: false, configurable: true });
    return P;
  }

  /* ---------- Effort ---------- */
  // One-time work by phase, after the framework-status and CI/CD adjustments (hours, no contingency).
  function oneTimeBuckets(p) {
    const a = p.a;
    const autoMods = p.modules.filter(m => m.automation && (+m.autoPct || 0) > 0 && (+m.tcs || 0) > 0);
    const anyAuto = autoMods.length > 0;
    const st = a.frameworkStatus || 'new';
    const sp = st === 'new' ? { framework: 100, common: 100 } : Object.assign({ framework: 100, common: 100 }, (a.fwStatusPct || {})[st]);
    const cicdF = a.cicdMode === 'none' ? 0 : a.cicdMode === 'existing' ? (+a.cicdExistingPct || 0) / 100 : 1;
    const b = { start: 0, framework: 0, common: 0, cicd: 0, end: 0 }, items = [];
    a.oneTime.forEach(o => {
      if (!o.on) return;
      const ph = PHASES.includes(o.phase) ? o.phase : 'start';
      let h = +o.hours || 0;
      if (ph === 'framework' || ph === 'common') h = anyAuto ? h * (+sp[ph] || 0) / 100 : 0;
      else if (ph === 'cicd') h = anyAuto ? h * cicdF : 0;
      b[ph] += h; items.push({ id: o.id, name: o.name, phase: ph, hours: h });
    });
    if (anyAuto && +a.commonPerModule > 0) {
      const h = autoMods.length * (+a.commonPerModule) * (+sp.common || 0) / 100;
      b.common += h; items.push({ id: 'per-module', name: `Module-specific common methods (${autoMods.length} × ${a.commonPerModule} h)`, phase: 'common', hours: h });
    }
    return { b, items };
  }

  function effort(p, scale = 1) {
    const a = p.a;
    const mods = p.modules.map(m => {
      const app = (find(a.appTypes, m.appType) || { factor: 1 }).factor;
      const td = (find(a.testData, m.testData) || { factor: 1 }).factor;
      const mixSum = a.complexity.reduce((s, c) => s + nn(m.mix[c.key]), 0) || 1;
      let design = 0, exec = 0, script = 0, autoTCs = 0;
      const counts = {};
      const cyc = cycles(a);
      a.complexity.forEach(c => {
        const n = nn(m.tcs) * (nn(m.mix[c.key]) / mixSum) * scale;
        counts[c.key] = n;
        if (m.design) design += n * c.design;
        if (m.manualExec) exec += n * c.exec * cyc * (1 + a.retestPct / 100);
        if (m.automation) {
          const an = n * pct100(m.autoPct) / 100;
          autoTCs += an;
          script += an * c.auto * app * td * (1 - a.reusePct / 100);
        }
      });
      const review = script * a.reviewPct / 100;
      const maint = script * a.maintenancePct / 100;
      const autoExec = m.automation ? autoTCs / 100 * a.analysisPer100 * a.autoCycles : 0;
      return { id: m.id, name: m.name, tcs: nn(m.tcs) * scale, autoTCs, counts, design, exec, script, review, maint, autoExec,
        manual: design + exec, auto: script + review + maint + autoExec };
    });
    const sum = k => mods.reduce((s, m) => s + m[k], 0);
    const anyAuto = p.modules.some(m => m.automation), anyManual = p.modules.some(m => m.design || m.manualExec);
    const { b: OT } = oneTimeBuckets(p);
    const ot = { auto: OT.framework + OT.common + OT.cicd, manual: 0, common: OT.start + OT.end };
    const lines = {
      design: sum('design'), exec: sum('exec'), script: sum('script'), review: sum('review'),
      maint: sum('maint'), autoExec: sum('autoExec'), oneTime: ot.auto + ot.manual + ot.common,
      otFramework: OT.framework, otCommon: OT.common, otCicd: OT.cicd, otOther: OT.start + OT.end
    };
    const variable = lines.design + lines.exec + lines.script + lines.review + lines.maint + lines.autoExec;
    const base = variable + lines.oneTime;
    const cf = 1 + a.contingencyPct / 100;
    lines.contingency = base * (cf - 1);
    const pools = {
      auto: (sum('auto') + ot.auto) * cf,
      manual: (sum('manual') + ot.manual) * cf,
      common: ot.common * cf
    };
    // The risk range is applied to the base estimate; contingency is not stacked on the worst case.
    const best = base * a.pertBest, worst = base * a.pertWorst;
    return { mods, lines, variable, base, total: base * cf, best, worst, expected: (best + 4 * base * cf + worst) / 6, oneTimeTotal: lines.oneTime * cf, pools,
      tcs: sum('tcs'), autoTCs: sum('autoTCs') };
  }

  function scalePools(pools, f) { return { auto: pools.auto * f, manual: pools.manual * f, common: pools.common * f }; }

  /* ---------- Capacity ---------- */
  function holidaySet(p) {
    const m = {};
    p.holidays.forEach(h => { (m[h.location] = m[h.location] || new Set()).add(h.date); });
    return m;
  }
  function onLeave(r, d) { return (r.leaves || []).some(l => l.from && d >= l.from && d <= (l.to || l.from)); }
  function downtimeFactor(p, d) {
    let f = 1;
    (p.downtimes || []).forEach(x => { if (x.from && d >= x.from && d <= (x.to || x.from)) f *= 1 - (+x.impact || 0) / 100; });
    return f;
  }

  // Build per-resource day model. Returns function(day) -> {hours, deductions}
  function resourceModel(p, r, projStart) {
    const a = p.a;
    const lvl = find(a.levels, r.level) || a.levels[1];
    const sk = find(a.skills, r.skill) || a.skills[0];
    const role = find(a.roles, r.role) || a.roles[0];
    const ramp = lvl.rampDays + sk.extraRamp;
    const rs = r.start || projStart;
    return { lvl, sk, role, ramp, start: rs, end: r.end || '9999-12-31', worked: 0 };
  }

  // Walk calendar from start; calls cb(day, perResourceHours[]) for each calendar day.
  function walk(p, team, start, endOrNull, maxDays, cb, opts = {}) {
    const a = p.a, hs = holidaySet(p);
    const models = team.map(r => resourceModel(p, r, start));
    const hpd = +a.hoursPerDay || 8;
    const ded = opts.ded;
    let d = start;
    for (let i = 0; i < maxDays; i++) {
      if (endOrNull && d > endOrNull) break;
      const wd = a.workDays.includes(dow(d));
      const dtf = downtimeFactor(p, d);
      const hrs = team.map((r, k) => {
        const m = models[k];
        // Accumulate on the team total and on this person, so a role breakdown can be shown.
        const add = (key, v) => { if (!ded) return; ded[key] += v; if (ded.people) ded.people[k][key] += v; };
        if (!wd || d < m.start || d > m.end) return 0;
        const alloc = pct100(r.alloc) / 100;
        const gross = hpd * alloc;
        add('gross', gross);
        if ((hs[r.location] || new Set()).has(d)) { add('holidays', gross); return 0; }
        if (onLeave(r, d)) { add('leave', gross); return 0; }
        let h = gross;
        const nd = h * m.role.nonDevPct / 100; h -= nd; add('nonDev', nd);
        const ul = h * a.unplannedLeavePct / 100; h -= ul; add('unplanned', ul);
        const dt = h * (1 - (1 - a.downtimePct / 100) * dtf); h -= dt; add('downtime', dt);
        const rampF = m.worked < m.ramp ? (a.rampStartPct / 100) + (1 - a.rampStartPct / 100) * (m.worked / m.ramp) : 1;
        m.worked++;
        const rp = h * (1 - rampF); h -= rp; add('ramp', rp);
        const prod = m.lvl.productivity * m.sk.factor;
        const pd = h * (prod - 1); h += pd; add('productivity', pd);
        return h;
      });
      if (cb(d, hrs) === false) return d;
      d = addDays(d, 1);
    }
    return d;
  }

  function capacityIn(p, team, start, end) {
    const zero = () => ({ gross: 0, holidays: 0, leave: 0, nonDev: 0, unplanned: 0, downtime: 0, ramp: 0, productivity: 0 });
    const ded = zero();
    ded.people = team.map(zero);
    let A = 0, M = 0, B = 0;
    const per = team.map(() => 0);
    const curve = []; let cum = 0;
    walk(p, team, start, end, 4000, (d, hrs) => {
      hrs.forEach((h, i) => { per[i] += h; const k = poolOf(team[i]); if (k === 'A') A += h; else if (k === 'M') M += h; else B += h; cum += h; });
      curve.push([d, cum]);
    }, { ded });
    return { A, M, B, total: A + B + M, per, ded, perDed: ded.people, curve };
  }

  function hireProfiles(p) {
    const a = p.a, mix = a.teamMix;
    const total = Object.values(mix).reduce((s, v) => s + (+v || 0), 0) || 1;
    return a.levels.map(l => ({ level: l.key, share: (+mix[l.key] || 0) / total })).filter(x => x.share > 0);
  }
  function splitHeads(n, profiles) {
    const raw = profiles.map(x => ({ level: x.level, v: n * x.share }));
    const out = raw.map(x => ({ level: x.level, n: Math.floor(x.v), r: x.v - Math.floor(x.v) }));
    let left = n - out.reduce((s, x) => s + x.n, 0);
    out.slice().sort((a, b) => b.r - a.r).forEach(x => { if (left > 0) { x.n++; left--; } });
    return out.filter(x => x.n > 0);
  }
  // Extra people join after a hiring / onboarding lead time (working days from the start).
  function hireStart(p) {
    let d = p.start, n = Math.max(0, Math.round(+p.a.hireLeadDays || 0));
    while (n > 0) { d = addDays(d, 1); if (p.a.workDays.includes(dow(d))) n--; }
    return n === 0 && (+p.a.hireLeadDays || 0) > 0 ? d : '';
  }
  function hireTeam(p, n, prefix = 'New hire') {
    const from = hireStart(p);
    const heads = splitHeads(n, hireProfiles(p));
    const t = []; let i = 1;
    heads.forEach(h => { for (let k = 0; k < h.n; k++) t.push({ id: 'h' + i, name: prefix + ' ' + (i++), role: 'Engineer', activity: 'Both', level: h.level, skill: p.a.hireSkill, alloc: 100, location: p.a.hireLocation, start: from, end: '', leaves: [] }); });
    return t;
  }

  function leadsNeeded(p, extraEngineers) {
    const eng = p.team.filter(r => r.role === 'Engineer').length + extraEngineers;
    const haveLeads = p.team.filter(r => r.role === 'Lead').length;
    const haveMgr = p.team.filter(r => r.role === 'Manager').length;
    const needLeads = Math.max(0, Math.ceil(eng / (p.a.leadSpan || 8)) - haveLeads);
    const needMgr = (eng + haveLeads + needLeads) > p.a.managerAbove && haveMgr === 0 ? 1 : 0;
    return { needLeads, needMgr };
  }

  function poolOf(r) { return r.activity === 'Automation' ? 'A' : r.activity === 'Manual' ? 'M' : 'B'; }

  /* ---------- Scheduler ----------
   * Day-by-day simulation. Each person's productive hours (after holidays, leave, meetings,
   * downtime, ramp-up and skill) are given to the work they're able to do, in this order:
   *   1. project-start activities (strategy, KT, environment, test data)          anyone
   *   2. framework core, at most N people at once                                 automation
   *   2b. common methods and reusable components, after the framework core        automation
   *   2c. CI/CD and reporting, one person, alongside; regression runs wait for it  automation
   *   3. manual test design, by module priority, once the module is available     manual
   *   4. scripting: only test cases already designed and past client review,
   *      after access lead time and once common methods are ready                 automation
   *   5. manual execution cycles: cycle 1 on reviewed test cases, later cycles
   *      after the previous cycle finishes plus the gap for a new build           manual
   *   6. automated regression runs and failure analysis on scripts that exist      automation
 *      (picked up ahead of new scripting, so runs happen throughout, not at the end)
   *   7. closure and handover, once everything else is done                       anyone
   * "Both" people work in the order design, scripting, execution, runs. Time that finds no
   * available work is recorded as idle (waiting on dependencies).
   */
  const CATS = ['setup', 'framework', 'common', 'cicd', 'design', 'script', 'exec', 'runs', 'close'];
  const EPS = 1e-7;

  function moduleUnits(p, scale, cf) {
    const a = p.a, cyc = Math.max(0, Math.round(+a.manualCycles || 0));
    return p.modules.map((m, idx) => {
      const app = (find(a.appTypes, m.appType) || { factor: 1 }).factor;
      const td = (find(a.testData, m.testData) || { factor: 1 }).factor;
      const mixSum = a.complexity.reduce((s, c) => s + nn(m.mix[c.key]), 0) || 1;
      let N = 0, dH = 0, xH = 0, sH = 0;
      const ap = pct100(m.autoPct) / 100;
      a.complexity.forEach(c => {
        const n = nn(m.tcs) * (nn(m.mix[c.key]) / mixSum) * scale;
        N += n; dH += n * c.design; xH += n * c.exec * (1 + a.retestPct / 100);
        sH += n * ap * c.auto * app * td * (1 - a.reusePct / 100);
      });
      sH *= 1 + (a.reviewPct + a.maintenancePct) / 100;
      const autoN = m.automation ? N * ap : 0;
      const runs = autoN / 100 * a.analysisPer100 * a.autoCycles;
      return {
        id: m.id, name: m.name, idx, prio: +m.priority || idx + 1, from: m.availableFrom || '',
        N, autoN, af: N > 0 ? autoN / N : 0, cyc,
        design: !!m.design && N > EPS, exec: !!m.manualExec && cyc > 0 && N > EPS, auto: !!m.automation && autoN > EPS,
        dH: N ? dH / N * cf : 0, xH: N ? xH / N * cf : 0, sH: autoN ? sH / autoN * cf : 0, rH: autoN ? runs / autoN * cf : 0
      };
    }).filter(m => m.N > EPS).sort((x, y) => x.prio - y.prio || x.idx - y.idx);
  }

  function schedule(p, opts = {}) {
    const a = p.a, f = opts.f || 1, scale = opts.scale == null ? 1 : opts.scale;
    const team = opts.team || p.team, start = p.start, rec = opts.record !== false;
    const cf = (1 + a.contingencyPct / 100) * f;
    const M = moduleUnits(p, scale, cf);
    const anyAuto = M.some(m => m.auto);
    const { b: OT } = oneTimeBuckets(p);
    let stRem = OT.start * cf, fwRem = OT.framework * cf, comRem = OT.common * cf, cicdRem = OT.cicd * cf, endRem = OT.end * cf;
    const fwTotal = fwRem, comTotal = comRem, cicdTotal = cicdRem, gateH = fwTotal * (+a.frameworkGatePct || 0) / 100;
    const comMax = Math.max(1, +a.commonMaxPeople || 1);
    const accessDays = Math.max(0, +a.accessDays || 0), reviewDays = Math.max(0, +a.reviewDays || 0);
    const gap = Math.max(0, +a.cycleGapDays || 0), fwMax = Math.max(1, +a.frameworkMaxPeople || 1);
    M.forEach(m => {
      m.avail = false; m.designed = 0; m.rq = []; m.reviewed = 0; m.scripted = 0; m.runDone = 0;
      m.ex = Array(m.cyc).fill(0); m.ready = Array(m.cyc).fill(Infinity); m.ready[0] = 0;
    });
    // allocation order: most productive first, so seniors pick up the framework
    const prodOf = r => { const l = find(a.levels, r.level) || a.levels[1], s = find(a.skills, r.skill) || a.skills[0]; return l.productivity * s.factor; };
    const order = team.map((r, k) => k).sort((x, y) => prodOf(team[y]) - prodOf(team[x]));

    const R = rec ? {
      rows: {}, people: team.map(() => ({ weeks: {} })), weeks: {}, curve: [], ms: {},
      cum: { design: 0, script: 0, exec: 0 }, idle: 0, work: 0
    } : null;
    const wk0 = mondayOf(start);
    const weekOf = d => Math.floor(daysBetween(wk0, d) / 7);
    const getW = w => R.weeks[w] || (R.weeks[w] = { start: addDays(wk0, w * 7), design: 0, script: 0, exec: 0, runsH: 0, cats: {}, idle: 0, cap: 0, mods: {} });
    const wm = (w, m, k, u) => { const x = getW(w).mods; (x[m.id] || (x[m.id] = { design: 0, script: 0, exec: 0 }))[k] += u; };
    const row = (key, label, cat, mod, d, h, w) => {
      let r = R.rows[key];
      if (!r) r = R.rows[key] = { key, label, cat, mod, first: d, last: d, hours: 0, weeks: {} };
      r.last = d; r.hours += h; r.weeks[w] = (r.weeks[w] || 0) + h;
    };
    const mark = (k, d, label) => { if (R && !R.ms[k]) R.ms[k] = { date: d, label }; };

    const modDone = m => (!m.design || m.designed >= m.N - EPS) && (!m.auto || m.scripted >= m.autoN - EPS) &&
      (!m.exec || m.ex[m.cyc - 1] >= m.N - EPS) && (!m.auto || m.runDone >= m.autoN * m.rH - EPS);
    const othersDone = () => stRem <= EPS && fwRem <= EPS && comRem <= EPS && cicdRem <= EPS && M.every(modDone);

    let wi = -1, finish = null, finishWi = null;
    walk(p, team, start, null, opts.maxDays || 1100, (d, hrs) => {
      const isWD = a.workDays.includes(dow(d));
      if (isWD) wi++;
      M.forEach(m => {
        if (!m.avail && (!m.from || d >= m.from)) { m.avail = true; if (!m.design) m.reviewed = m.N; }
        while (m.rq.length && m.rq[0][0] <= wi) m.reviewed += m.rq.shift()[1];
        if (m.exec) for (let c = 1; c < m.cyc; c++)
          if (m.ready[c] === Infinity && m.ex[c - 1] >= m.N - EPS) m.ready[c] = wi + gap;
      });
      if (!isWD) return;
      const w = rec ? weekOf(d) : 0;
      const accessOK = wi >= accessDays;
      // framework core -> common methods -> scripting; CI/CD runs alongside and gates regression runs
      const coreOK = fwTotal <= EPS || fwTotal - fwRem >= gateH - EPS;
      if (coreOK && fwTotal > EPS) mark('fwCore', d, comTotal > EPS ? 'Framework core ready, common methods start' : 'Framework core ready, scripting can start');
      const gateOK = coreOK && comRem <= EPS;
      const runsOK = cicdRem <= EPS;
      let fwPeople = 0, comPeople = 0, cicdPeople = 0;
      const day = rec ? { design: 0, script: 0, exec: 0 } : null;
      for (const k of order) {
        let h = hrs[k];
        if (rec) {
          const pw = R.people[k].weeks[w] || (R.people[k].weeks[w] = { cap: 0, idle: 0, off: 0, cats: {} });
          if (h <= EPS) { const r = team[k]; if ((!r.start || d >= r.start) && (!r.end || d <= r.end) && (+r.alloc || 0) > 0) pw.off++; continue; }
          pw.cap += h;
        } else if (h <= EPS) continue;
        const r = team[k], act = r.activity, canA = act !== 'Manual', canM = act !== 'Automation';
        const take = (cat, availH, apply, m) => {
          if (h <= EPS || availH <= EPS) return 0;
          const t = Math.min(h, availH); h -= t; apply(t);
          if (rec) {
            const pw = R.people[k].weeks[w]; pw.cats[cat] = (pw.cats[cat] || 0) + t; R.work += t;
            const W = getW(w);
            W.cats[cat] = (W.cats[cat] || 0) + t;
            if (m) row(m.id + ':' + cat, null, cat, m.id, d, t, w);
            else row(cat, null, cat, null, d, t, w);
          }
          return t;
        };
        take('setup', stRem, t => { stRem -= t; });
        if (canA && fwRem > EPS && fwPeople < fwMax) {
          if (take('framework', fwRem, t => { fwRem -= t; }) > 0) fwPeople++;
          if (fwRem <= EPS) mark('fwDone', d, 'Framework complete');
        }
        if (canA && coreOK && accessOK && comRem > EPS && comPeople < comMax) {
          if (take('common', comRem, t => { comRem -= t; }) > 0) comPeople++;
          if (comRem <= EPS) mark('commonDone', d, 'Common methods ready, scripting starts');
        }
        if (canA && accessOK && cicdRem > EPS && cicdPeople < 1) {
          if (take('cicd', cicdRem, t => { cicdRem -= t; }) > 0) cicdPeople++;
          if (cicdRem <= EPS) mark('cicdDone', d, 'CI/CD pipeline ready, regression runs start');
        }
        const doDesign = () => { for (const m of M) if (m.avail && m.design && h > EPS) take('design', (m.N - m.designed) * m.dH, t => {
          const u = t / m.dH; m.designed += u; if (rec) { day.design += u; wm(w, m, 'design', u); }
          const last = m.rq[m.rq.length - 1], at = wi + reviewDays;
          if (last && last[0] === at) last[1] += u; else m.rq.push([at, u]);
        }, m); };
        const doScript = () => { if (!accessOK || !gateOK) return; for (const m of M) if (m.avail && m.auto && h > EPS) take('script', (m.reviewed * m.af - m.scripted) * m.sH, t => { const u = t / m.sH; m.scripted += u; if (rec) { day.script += u; wm(w, m, 'script', u); } }, m); };
        const doExec = () => { if (!accessOK) return; for (const m of M) if (m.avail && m.exec) for (let c = 0; c < m.cyc && h > EPS; c++) {
          const av = c === 0 ? m.reviewed - m.ex[0] : (wi >= m.ready[c] ? m.N - m.ex[c] : 0);
          take('exec', av * m.xH, t => { const u = t / m.xH; m.ex[c] += u; if (rec) { day.exec += u; wm(w, m, 'exec', u); } }, m);
        } };
        const doRuns = () => { if (!accessOK || !runsOK) return; for (const m of M) if (m.avail && m.auto && h > EPS) take('runs', m.scripted * m.rH - m.runDone, t => { m.runDone += t; }, m); };
        if (canM && canA) { doDesign(); doRuns(); doScript(); doExec(); }
        else if (canA) { doRuns(); doScript(); }
        else { doDesign(); doExec(); }
        if (h > EPS && endRem > EPS && othersDone()) take('close', endRem, t => { endRem -= t; });
        if (rec && h > EPS) { R.people[k].weeks[w].idle += h; R.idle += h; R.weeks[w] && (R.weeks[w].idle += h); }
      }
      if (rec) {
        const W = getW(w);
        W.design += day.design; W.script += day.script; W.exec += day.exec; W.days = (W.days || 0) + 1;
        R.cum.design += day.design; R.cum.script += day.script; R.cum.exec += day.exec;
        R.curve.push([d, R.cum.design, R.cum.script, R.cum.exec]);
        M.forEach(m => {
          if (m.design && m.designed >= m.N - EPS) mark(m.id + ':designDone', d, m.name + ': design complete');
          if (m.auto && m.scripted >= m.autoN - EPS) mark(m.id + ':scriptDone', d, m.name + ': automation complete');
          if (modDone(m)) mark(m.id + ':done', d, m.name + ': all work complete');
        });
        if (M.every(m => !m.design || m.designed >= m.N - EPS) && M.some(m => m.design)) mark('allDesign', d, 'All test cases designed');
        if (M.every(m => !m.auto || m.scripted >= m.autoN - EPS) && M.some(m => m.auto)) mark('allScript', d, 'All automation scripted');
      }
      if (endRem <= EPS && othersDone()) { finish = d; finishWi = wi; return false; }
    });
    const out = { finish, workdays: finish ? finishWi + 1 : null };
    if (rec) {
      if (finish) mark('finish', finish, 'Estimated finish');
      Object.assign(out, R, { mods: M.map(m => ({ id: m.id, name: m.name, N: m.N, autoN: m.autoN, cyc: m.cyc, design: m.design, exec: m.exec, auto: m.auto })), weekStart: wk0 });
      // weekly team capacity
      R.people.forEach(pp => Object.entries(pp.weeks).forEach(([w, v]) => { if (R.weeks[w]) R.weeks[w].cap += v.cap; }));
      if (!finish) out.left = { setup: stRem, framework: fwRem, close: endRem };
    }
    return out;
  }

  function teamNeeded(p, f, end) {
    const ok = n => { const s = schedule(p, { f, team: n ? p.team.concat(hireTeam(p, n)) : p.team, record: false }); return s.finish && s.finish <= end; };
    if (ok(0)) return { extra: 0, heads: [] };
    let lo = 0, hi = 1;
    while (!ok(hi)) { lo = hi; hi *= 2; if (hi > 256) {
      const s = schedule(p, { f, team: p.team.concat(hireTeam(p, 256)), record: false });
      return { extra: null, floor: s.finish };
    } }
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ok(mid)) hi = mid; else lo = mid; }
    return { extra: hi, heads: splitHeads(hi, hireProfiles(p)) };
  }

  function scopeFit(p, end) {
    const ok = sc => { const s = schedule(p, { scale: sc, record: false }); return s.finish && s.finish <= end; };
    if (!ok(0)) return { f: 0, oneTimeBlocks: true };
    let lo = 0, hi = 1;
    if (ok(1)) { lo = 1; hi = 2; while (ok(hi) && hi < 64) { lo = hi; hi *= 2; } if (hi >= 64 && lo >= 32) return { f: 64 }; }
    for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
    return { f: lo };
  }

  function analyse(p) {
    const e = effort(p);
    const hasTeam = p.team.length > 0 && p.team.some(r => (+r.alloc || 0) > 0);
    const out = { e, hasTeam };
    const can = k => p.team.some(r => (+r.alloc || 0) > 0 && r.role !== 'Manager' && (r.activity === 'Both' || r.activity === k));
    out.missing = [];
    if (hasTeam && e.pools.auto > 0 && !can('Automation')) out.missing.push('automation');
    if (hasTeam && e.pools.manual > 0 && !can('Manual')) out.missing.push('manual');
    if (hasTeam && e.pools.common > 0 && !p.team.some(r => (+r.alloc || 0) > 0 && r.role !== 'Manager')) out.missing.push('one-time');
    out.expectedTotal = e.expected;
    const cf0 = 1 + p.a.contingencyPct / 100;
    const scen = { best: p.a.pertBest / cf0, likely: 1, worst: p.a.pertWorst / cf0 };
    if (hasTeam && p.start && !out.missing.length) {
      out.sched = schedule(p, {});
      out.finish = {
        likely: { date: out.sched.finish, workdays: out.sched.workdays },
        best: (() => { const s = schedule(p, { f: scen.best, record: false }); return { date: s.finish, workdays: s.workdays }; })(),
        worst: (() => { const s = schedule(p, { f: scen.worst, record: false }); return { date: s.finish, workdays: s.workdays }; })()
      };
    } else if (hasTeam && p.start) {
      out.finish = { likely: { date: null }, best: { date: null }, worst: { date: null } };
    }
    if (p.start && p.end && p.end >= p.start) {
      out.window = capacityIn(p, p.team, p.start, p.end);
      if (!out.missing.length) {
        out.need = teamNeeded(p, 1, p.end);
        if (out.need.extra != null) Object.assign(out.need, leadsNeeded(p, out.need.extra));
        if (out.need.extra > 0) out.need.finish = schedule(p, { team: p.team.concat(hireTeam(p, out.need.extra)), record: false }).finish;
        out.needWorst = teamNeeded(p, scen.worst, p.end);
        if (hasTeam) out.scope = scopeFit(p, p.end);
      }
      if (hasTeam && out.finish) {
        const F = out.finish, le = d => d && d <= p.end;
        out.status = le(F.worst.date) ? 'ok' : le(F.likely.date) ? 'risk' : 'no';
      } else out.status = 'noteam';
    } else if (hasTeam && out.finish && out.finish.likely.date) {
      out.window = capacityIn(p, p.team, p.start, out.finish.likely.date);
    }
    // Team time: the hours people are booked on the project (working days x allocation, less public
    // holidays and leave), including leads, managers and waiting time. This is what gets priced.
    const tt = (team, until) => { if (!until) return null; const c = capacityIn(p, team, p.start, until); const fte = team.reduce((t, r) => t + pct100(r.alloc) / 100, 0);
      let wd = 0; for (let d = p.start; d <= until; d = addDays(d, 1)) if (p.a.workDays.includes(dow(d))) wd++;
      return { hours: c.ded.gross - c.ded.holidays - c.ded.leave, fte, workdays: wd, until }; };
    if (hasTeam && out.finish && out.finish.likely.date) out.teamTime = tt(p.team, out.finish.likely.date);
    if (out.need && out.need.extra > 0 && out.need.finish) {
      // price the recommended team including the leads (and manager) it recommends
      const extra = hireTeam(p, out.need.extra), from = hireStart(p);
      for (let i = 0; i < (out.need.needLeads || 0); i++) extra.push({ id: 'lead' + i, name: 'New lead', role: 'Lead', activity: 'Both', level: 'Senior', skill: p.a.hireSkill, alloc: 100, location: p.a.hireLocation, start: from, end: '', leaves: [] });
      if (out.need.needMgr) extra.push({ id: 'mgr', name: 'Manager', role: 'Manager', activity: 'Both', level: 'Senior', skill: 'Proficient', alloc: p.a.managerAlloc, location: p.a.hireLocation, start: from, end: '', leaves: [] });
      out.need.teamTime = tt(p.team.concat(extra), out.need.finish);
      out.need.totalFte = out.need.teamTime.fte;
    }
    return out;
  }

  /* ---------- Tracking ----------
   * Weekly actuals: { week, hours, notes, blockers,
   *   mods: { <moduleId>: { designed, automated, executed } },      counts done that week
   *   ot:   { setup, framework, common, cicd, close } }               % complete to date
   * Older weeks may only carry project totals (designed, automated, executed); those count at
   * project-average weights. Earned hours use the estimate without contingency, so earned
   * divided by the base estimate is % complete.
   *
   * Progress is measured against a plan: the frozen baseline when there is one, otherwise the
   * current schedule. Both have the same compact shape (see compactPlan).
   */
  const OT_PHASES = ['setup', 'framework', 'common', 'cicd', 'close'];
  function trackWeights(p) {
    const e = effort(p), a = p.a, cyc = cycles(a);
    let dN = 0, xN = 0;
    const mods = p.modules.map((pm, i) => {
      const m = e.mods[i];
      const designN = pm.design ? m.tcs : 0, runs = pm.manualExec ? m.tcs * cyc : 0;
      dN += designN; xN += runs;
      return {
        id: pm.id, name: pm.name, tcs: m.tcs, designN, autoN: m.autoTCs, runs,
        wD: designN ? m.design / designN : 0, wX: runs ? m.exec / runs : 0,
        wA: m.autoTCs ? (m.script + m.review + m.maint + m.autoExec) / m.autoTCs : 0
      };
    });
    const { b } = oneTimeBuckets(p);
    return {
      V: e.base || 1, mods,
      ot: { setup: b.start, framework: b.framework, common: b.common, cicd: b.cicd, close: b.end },
      wD: dN ? e.lines.design / dN : 0,
      wX: xN ? e.lines.exec / xN : 0,
      wA: e.autoTCs ? (e.lines.script + e.lines.review + e.lines.maint + e.lines.autoExec) / e.autoTCs : 0
    };
  }
  // The plan in a compact, freezable form: weights plus planned counts and one-time hours per week.
  function compactPlan(p, sched) {
    const e = effort(p), cf0 = 1 + p.a.contingencyPct / 100;
    const weeks = {};
    if (sched && sched.weeks) Object.entries(sched.weeks).forEach(([w, v]) => {
      const ot = {};
      [['setup', 'setup'], ['framework', 'framework'], ['common', 'common'], ['cicd', 'cicd'], ['close', 'close']].forEach(([c, k]) => { if (v.cats[c]) ot[k] = v.cats[c] / cf0; });
      const mods = {};
      Object.entries(v.mods || {}).forEach(([id, x]) => { mods[id] = { design: +x.design.toFixed(3), script: +x.script.toFixed(3), exec: +x.exec.toFixed(3) }; });
      weeks[w] = { mods, ot };
    });
    return { W: trackWeights(p), weeks, weekStart: sched ? sched.weekStart : mondayOf(p.start), finish: sched ? sched.finish : null,
      start: p.start, end: p.end || '', total: e.total, base: e.base, tcs: e.tcs, autoTCs: e.autoTCs };
  }
  function makeBaseline(p, sched, reason) {
    return Object.assign(compactPlan(p, sched), { at: toS(Date.now()), reason: reason || '' });
  }
  function baselineVariance(p, sched) {
    const b = p.baseline; if (!b) return null;
    const live = compactPlan(p, sched);
    return { finishDays: b.finish && live.finish ? daysBetween(b.finish, live.finish) : null, effort: live.total - b.total,
      tcs: live.tcs - b.tcs, autoTCs: live.autoTCs - b.autoTCs, endChanged: (b.end || '') !== (p.end || ''), liveFinish: live.finish };
  }
  // cumulative planned progress by week index
  // Modules removed from the project since the plan was made are taken out of it, so they
  // don't show as permanently behind; V is the plan's total earned hours without them.
  function activeV(src, active) {
    const W = src.W;
    if (!active) return W.V;
    return W.V - W.mods.filter(m => !active.has(m.id)).reduce((t, m) => t + m.designN * m.wD + m.runs * m.wX + m.autoN * m.wA, 0);
  }
  function planCurve(src, active) {
    const W = src.W, out = {}, V = activeV(src, active) || 1;
    let cum = 0;
    const otCum = {}, modCum = {};
    Object.keys(src.weeks).map(Number).sort((x, y) => x - y).forEach(w => {
      const v = src.weeks[w];
      Object.entries(v.mods || {}).forEach(([id, x]) => {
        if (active && !active.has(id)) return;
        const mw = W.mods.find(m => m.id === id) || W;
        cum += x.design * mw.wD + x.exec * mw.wX + x.script * mw.wA;
        const o = modCum[id] || (modCum[id] = { design: 0, script: 0, exec: 0 });
        o.design += x.design; o.script += x.script; o.exec += x.exec;
      });
      Object.entries(v.ot || {}).forEach(([k, h]) => { cum += h; otCum[k] = (otCum[k] || 0) + h; });
      out[w] = { frac: Math.min(1, cum / V), ot: { ...otCum }, mods: JSON.parse(JSON.stringify(modCum)) };
    });
    return out;
  }
  // Hours logged in a week: per person when split, else the older single total.
  function hoursOf(r) {
    if (r.hoursBy && Object.keys(r.hoursBy).length) return Object.values(r.hoursBy).reduce((t, v) => t + nn(v), 0);
    return nn(r.hours);
  }
  function rowMods(r) {
    if (r.mods && Object.keys(r.mods).length) return r.mods;
    if ((+r.designed || 0) + (+r.executed || 0) + (+r.automated || 0) > 0) return { _all: { designed: +r.designed || 0, executed: +r.executed || 0, automated: +r.automated || 0 } };
    return {};
  }
  function tracking(p, actuals, sched) {
    const s = (p.team.length && p.start) ? (sched || schedule(p, {})) : null;
    const src = p.baseline || compactPlan(p, s);
    const active = new Set(p.modules.map(m => m.id));
    const W = src.W, curve = planCurve(src, active), V = activeV(src, active) || 1;
    const wIdx = d => Math.floor(daysBetween(src.weekStart, d) / 7);
    const planAt = d => { const w = wIdx(d); let v = 0; for (const k in curve) if (+k <= w) v = Math.max(v, curve[k].frac); return v; };
    const sorted = actuals.slice().sort((x, y) => x.week < y.week ? -1 : 1);
    const cum = {}; // per module counts to date
    let cumD = 0, cumX = 0, cumA = 0, cumH = 0;
    const otNow = {};
    const rows = sorted.map(r => {
      const M = rowMods(r);
      const t = { d: 0, x: 0, a: 0 };
      Object.entries(M).forEach(([id, v]) => {
        const o = cum[id] || (cum[id] = { designed: 0, automated: 0, executed: 0 });
        o.designed += nn(v.designed); o.automated += nn(v.automated); o.executed += nn(v.executed);
        t.d += nn(v.designed); t.x += nn(v.executed); t.a += nn(v.automated);
      });
      cumD += t.d; cumX += t.x; cumA += t.a; cumH += hoursOf(r);
      Object.entries(r.ot || {}).forEach(([k, v]) => { if (v !== '' && v != null) otNow[k] = Math.min(100, nn(v)); });
      // earned to date, never more than the scope of each module
      let earned = 0;
      Object.entries(cum).forEach(([id, o]) => {
        const mw = W.mods.find(m => m.id === id);
        if (mw && active.has(id)) earned += Math.min(o.designed, mw.designN) * mw.wD + Math.min(o.executed, mw.runs) * mw.wX + Math.min(o.automated, mw.autoN) * mw.wA;
        else if (id === '_all') earned += o.designed * W.wD + o.executed * W.wX + o.automated * W.wA; // logged before modules existed
        // modules that aren't in the plan being measured against (added after the baseline) earn nothing here;
        // they are reported separately as work outside the baseline
      });
      OT_PHASES.forEach(k => { if (otNow[k] != null) earned += (W.ot[k] || 0) * otNow[k] / 100; });
      return { ...r, designed: t.d, executed: t.x, automated: t.a, cumD, cumX, cumA, cumH, earned, otToDate: { ...otNow }, cumMods: JSON.parse(JSON.stringify(cum)), pct: Math.min(1, earned / V) };
    });
    rows.forEach(r => { r.plannedPct = src.weekStart ? planAt(addDays(r.week, 6)) : null; });
    const keys = Object.keys(curve).map(Number).sort((x, y) => x - y);
    // weekly plan points; the last one sits on the planned finish day, not the Sunday after it
    const plan = src.weekStart ? [[src.start || p.start, 0], ...keys.map(w => {
      let d = addDays(src.weekStart, w * 7 + 6);
      if (src.finish && d > src.finish && addDays(src.weekStart, w * 7) <= src.finish) d = src.finish;
      return [d, curve[w].frac];
    })] : null;
    const end = src.finish;
    const last = rows[rows.length - 1];
    let spi = null, eff = null, forecast = null, forecastRaw = null;
    const workday = d => { let x = d; for (let i = 0; i < 7 && !p.a.workDays.includes(dow(x)); i++) x = addDays(x, 1); return x; };
    const project = (spiX, from, startPct) => {
      let cur = startPct, prevY = planAt(from), prevD = from;
      for (const [d, y] of plan) {
        if (d <= from) continue;
        const step = Math.max(0, y - prevY) * spiX;
        if (cur + step >= 0.9999 && step > 0) {
          // finish part-way through this step, to the day
          const t = (0.9999 - cur) / step;
          return workday(addDays(prevD, Math.max(0, Math.round(t * daysBetween(prevD, d)))));
        }
        cur += step; prevY = Math.max(prevY, y); prevD = d;
      }
      const pe = plan[plan.length - 1][0], span = Math.max(1, daysBetween(src.start || p.start, pe));
      return addDays(pe > from ? pe : from, Math.ceil((1 - cur) * span / spiX));
    };
    if (last) eff = last.cumH > 0 ? last.earned / last.cumH : null;
    // What earned-per-logged-hour the plan itself implies: planned earned hours divided by the
    // hours the team is booked for (timesheets include meetings, holidays aside, ramp-up and waiting).
    let effPlan = null;
    if (last && p.team.length && p.start) {
      const c = capacityIn(p, p.team, p.start, addDays(last.week, 6));
      const booked = c.ded.gross - c.ded.holidays - c.ded.leave;
      if (booked > 0 && last.plannedPct > 0) effPlan = last.plannedPct * V / booked;
    }
    const lastWorkday = w => { let x = addDays(w, 6); for (let i = 0; i < 7 && !p.a.workDays.includes(dow(x)); i++) x = addDays(x, -1); return x; };
    if (last && last.pct >= 0.9999) {
      // all planned work done: it finished in that week
      spi = last.plannedPct > 0 ? last.pct / last.plannedPct : 1;
      forecast = forecastRaw = lastWorkday(last.week);
    } else if (last && last.plannedPct > 0) {
      spi = last.pct / last.plannedPct;
      if (spi > 0 && plan && plan.length > 1) {
        const from = addDays(last.week, 6);
        // Current pace, taken at face value (bounded only to keep dates finite).
        forecastRaw = project(Math.min(3, Math.max(0.1, spi)), from, last.pct);
        // Smoothed: leans towards the plan until about a quarter of the work is done.
        const conf = Math.min(1, last.pct / 0.25);
        forecast = project(Math.min(1.25, Math.max(0.3, 1 + (spi - 1) * conf)), from, last.pct);
      }
    }
    return { rows, plan, end, spi, eff, effPlan, effIndex: eff != null && effPlan ? eff / effPlan : null, forecast, forecastRaw, last, sched: s, src, W, curve, baseline: !!p.baseline,
      designPerTC: W.wD, execPerRun: W.wX, autoPerTC: W.wA };
  }

  // Everything a weekly status needs, as of the given logged week.
  function weekReport(p, actuals, sched, week) {
    const upto = actuals.filter(r => r.week <= week);
    const T = tracking(p, upto, sched);
    const row = T.rows.find(r => r.week === week);
    if (!row) return null;
    const src = T.src, W = T.W, curve = T.curve;
    const wIdx = Math.floor(daysBetween(src.weekStart, week) / 7);
    const weekPlan = wi => { const v = src.weeks[wi] || { mods: {}, ot: {} }; const tot = { design: 0, script: 0, exec: 0 };
      Object.values(v.mods || {}).forEach(x => { tot.design += x.design; tot.script += x.script; tot.exec += x.exec; }); return { total: tot, mods: v.mods || {}, ot: v.ot || {} }; };
    const cumAt = wi => { let c = null; for (const k of Object.keys(curve).map(Number).sort((x, y) => x - y)) { if (k <= wi) c = curve[k]; } return c || { frac: 0, ot: {}, mods: {} }; };
    const thisPlan = weekPlan(wIdx), nextPlan = weekPlan(wIdx + 1), cAt = cumAt(wIdx);
    const toPlan = { total: { design: 0, script: 0, exec: 0 }, mods: cAt.mods };
    Object.values(cAt.mods).forEach(x => { toPlan.total.design += x.design; toPlan.total.script += x.script; toPlan.total.exec += x.exec; });
    const weekCounts = rowMods(row);
    const warnings = [];
    const live = new Map(p.modules.map(m => [m.id, m]));
    const mods = W.mods.filter(m => live.has(m.id)).map(m => {
      const a = row.cumMods[m.id] || { designed: 0, automated: 0, executed: 0 };
      const pl = cAt.mods[m.id] || { design: 0, script: 0, exec: 0 };
      if (m.designN > 0 && a.designed > m.designN + 1e-6) warnings.push(`${m.name}: ${Math.round(a.designed)} designed logged against a scope of ${Math.round(m.designN)}. Only the scope counts towards progress.`);
      if (m.autoN > 0 && a.automated > m.autoN + 1e-6) warnings.push(`${m.name}: ${Math.round(a.automated)} automated logged against ${Math.round(m.autoN)} planned for automation. Only the scope counts.`);
      if (m.runs > 0 && a.executed > m.runs + 1e-6) warnings.push(`${m.name}: ${Math.round(a.executed)} manual executions logged against ${Math.round(m.runs)} planned. Only the scope counts.`);
      if (m.designN > 0 && a.automated > a.designed + 1e-6) warnings.push(`${m.name}: more test cases automated (${Math.round(a.automated)}) than designed (${Math.round(a.designed)}). Check the numbers.`);
      const earnedA = Math.min(a.designed, m.designN) * m.wD + Math.min(a.executed, m.runs) * m.wX + Math.min(a.automated, m.autoN) * m.wA;
      const earnedP = pl.design * m.wD + pl.exec * m.wX + pl.script * m.wA;
      const total = m.designN * m.wD + m.runs * m.wX + m.autoN * m.wA;
      const spi = earnedP > 0.5 ? earnedA / earnedP : null;
      let status = earnedP <= 0.5 ? (earnedA > 0.5 ? 'ahead' : 'notstarted') : spi >= 0.97 ? 'ok' : spi >= 0.85 ? 'risk' : 'no';
      if (status === 'no' && row.pct < 0.10 && T.rows.length < 4) status = 'risk'; // early weeks: at risk, not behind
      const wk = weekCounts[m.id] || {};
      return { ...m, name: live.get(m.id).name, baselineName: m.name, act: a, week: { designed: nn(wk.designed), automated: nn(wk.automated), executed: nn(wk.executed) }, plan: pl, weekPlan: thisPlan.mods[m.id] || { design: 0, script: 0, exec: 0 },
        next: nextPlan.mods[m.id] || { design: 0, script: 0, exec: 0 }, earnedA, earnedP, total, pctDone: total ? Math.min(1, earnedA / total) : 0, spi, status };
    });
    // one-time work: % done to date vs % planned to date
    const ot = OT_PHASES.filter(k => (W.ot[k] || 0) > 0.01).map(k => ({ key: k, hours: W.ot[k], done: row.otToDate[k] != null ? row.otToDate[k] : null, planned: Math.min(100, 100 * (cAt.ot[k] || 0) / W.ot[k]), nextPlanned: Math.min(100, 100 * ((cAt.ot[k] || 0) + (nextPlan.ot[k] || 0)) / W.ot[k]) }));
    const totals = {
      scope: { design: W.mods.reduce((t, m) => t + m.designN, 0), automate: W.mods.reduce((t, m) => t + m.autoN, 0), exec: W.mods.reduce((t, m) => t + m.runs, 0) },
      week: { designed: row.designed, automated: row.automated, executed: row.executed },
      toDate: { designed: row.cumD, automated: row.cumA, executed: row.cumX }
    };
    const weekEnd = addDays(week, 6);
    const ms = T.sched && T.sched.ms ? Object.entries(T.sched.ms).filter(([k, v]) => !k.endsWith(':done') && v.date > weekEnd && v.date <= addDays(weekEnd, 14)).map(([, v]) => v).sort((x, y) => x.date < y.date ? -1 : 1) : [];
    // Work on modules that aren't in the baseline: shown separately, not counted as progress.
    const outside = p.modules.filter(m => !W.mods.some(x => x.id === m.id)).map(m => ({ id: m.id, name: m.name,
      act: row.cumMods[m.id] || { designed: 0, automated: 0, executed: 0 }, week: { designed: nn((weekCounts[m.id] || {}).designed), automated: nn((weekCounts[m.id] || {}).automated), executed: nn((weekCounts[m.id] || {}).executed) } }));
    // Lateness is measured against the baselined target; a moved target is reported, not absorbed.
    const target = (p.baseline && p.baseline.end) || p.end || '';
    const targetChanged = p.baseline && p.baseline.end && (p.end || '') !== p.baseline.end ? { from: p.baseline.end, to: p.end || '' } : null;
    // Status uses the current pace at face value, with two allowances: on-plan pace (0.97+) isn't
    // flagged for a couple of days of rounding, and the first weeks (under 10% done, fewer than 4
    // weeks logged) can be "At risk" but not "Behind".
    let st = 'ok';
    if (T.spi != null) st = T.spi >= 0.97 ? 'ok' : T.spi >= 0.85 ? 'risk' : 'no';
    let late = target && T.forecastRaw && T.forecastRaw > target ? daysBetween(target, T.forecastRaw) : 0;
    if (late > 0 && T.spi != null && T.spi >= 0.97 && late <= 3) late = 0;
    if (late > 0) { const span = Math.max(1, daysBetween(p.start, target)); st = late / span > 0.1 ? 'no' : (st === 'ok' ? 'risk' : st); }
    const early = row.pct < 0.10 && T.rows.length < 4;
    if (early && st === 'no') st = 'risk';
    // What has changed in the plan since the baseline (scope, removals, renames, finish date)
    const changes = [];
    let drift = null;
    if (p.baseline) {
      const e = effort(p);
      W.mods.forEach(m => {
        const cur = live.get(m.id);
        if (!cur) { changes.push(`“${m.name}” was removed from scope; its planned work is no longer counted.`); return; }
        if (cur.name !== m.name) changes.push(`“${m.name}” has been renamed “${cur.name}”.`);
        const ci = p.modules.indexOf(cur), now = e.mods[ci];
        if (now && Math.abs(now.tcs - (m.tcs != null ? m.tcs : m.designN)) >= 0.5) changes.push(`${cur.name}: ${Math.round(m.tcs != null ? m.tcs : m.designN)} → ${Math.round(now.tcs)} test cases.`);
        if (now && Math.abs(now.autoTCs - m.autoN) >= 0.5) changes.push(`${cur.name}: ${Math.round(m.autoN)} → ${Math.round(now.autoTCs)} test cases to automate.`);
      });
      outside.forEach(o => changes.push(`“${o.name}” was added after the baseline.`));
      if (T.sched && T.sched.finish && src.finish) {
        const d = daysBetween(src.finish, T.sched.finish);
        if (Math.abs(d) > 5) drift = { days: d, liveFinish: T.sched.finish };
      }
      // the plan itself no longer meets the target: never report that as on track
      if (drift && drift.days > 0 && target && T.sched.finish > target && st === 'ok') st = 'risk';
    }
    return { week, weekEnd, weekNo: wIdx + 1, row, T, mods, ot, outside, changes, drift, removed: W.mods.filter(m => !live.has(m.id)).map(m => m.name), totals, thisPlan, toPlan, nextPlan, ms, status: st, late, warnings, target, targetChanged, early,
      hoursWeek: hoursOf(row), hoursToDate: row.cumH, spi: T.spi, eff: T.eff, effPlan: T.effPlan, effIndex: T.effIndex, forecast: T.forecastRaw, forecastSmoothed: T.forecast,
      plannedFinish: T.end, baseline: p.baseline ? { at: p.baseline.at, reason: p.baseline.reason } : null, history: p.baselineHistory || [] };
  }

  return { defaults, defaultHolidays, newModule, newResource, newProject, migrate, effort, oneTimeBuckets, analyse, capacityIn, schedule, tracking, weekReport, compactPlan, makeBaseline, baselineVariance, generateHolidays, OT_PHASES, hoursOf,
    toS, toD, addDays, dow, mondayOf, daysBetween, uid, hireTeam, CATS };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ENGINE;
