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
      leadSpan: 8,
      managerAbove: 20,
      managerAlloc: 50,
      accessDays: 3,
      frameworkGatePct: 60,
      frameworkMaxPeople: 2,
      reviewDays: 3,
      cycleGapDays: 10,
      oneTime: [
        { id: 'ot1', name: 'Test strategy and planning', hours: 40, phase: 'start', on: true },
        { id: 'ot2', name: 'Application walkthrough and KT', hours: 24, phase: 'start', on: true },
        { id: 'ot3', name: 'Framework design and setup (POC)', hours: 160, phase: 'framework', on: true },
        { id: 'ot4', name: 'CI/CD pipeline integration', hours: 40, phase: 'framework', on: true },
        { id: 'ot5', name: 'Reporting and dashboard setup', hours: 24, phase: 'framework', on: true },
        { id: 'ot6', name: 'Environment and tool setup', hours: 24, phase: 'start', on: true },
        { id: 'ot7', name: 'Test data strategy', hours: 24, phase: 'start', on: true },
        { id: 'ot8', name: 'Closure report and handover', hours: 16, phase: 'end', on: true }
      ]
    };
  }

  function defaultHolidays() {
    const h = (date, name, location) => ({ id: uid(), date, name, location });
    return [
      h('2026-01-26', 'Republic Day', 'India'), h('2026-08-15', 'Independence Day', 'India'),
      h('2026-10-02', 'Gandhi Jayanti', 'India'), h('2026-12-25', 'Christmas', 'India'),
      h('2027-01-01', 'New Year', 'India'), h('2027-01-26', 'Republic Day', 'India'),
      h('2027-08-15', 'Independence Day', 'India'), h('2027-10-02', 'Gandhi Jayanti', 'India'),
      h('2027-12-25', 'Christmas', 'India'),
      h('2026-11-26', 'Thanksgiving', 'USA'), h('2026-12-25', 'Christmas', 'USA'),
      h('2027-01-01', "New Year's Day", 'USA'), h('2027-01-18', 'Martin Luther King Jr. Day', 'USA'),
      h('2027-02-15', "Presidents' Day", 'USA'), h('2027-05-31', 'Memorial Day', 'USA'),
      h('2027-06-18', 'Juneteenth (observed)', 'USA'), h('2027-07-05', 'Independence Day (observed)', 'USA'),
      h('2027-09-06', 'Labor Day', 'USA'), h('2027-10-11', 'Columbus Day', 'USA'),
      h('2027-11-11', 'Veterans Day', 'USA'), h('2027-11-25', 'Thanksgiving', 'USA'),
      h('2027-12-24', 'Christmas (observed)', 'USA')
    ];
  }

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
      holidays: defaultHolidays(),
      downtimes: [],
      a: defaults()
    };
  }

  const find = (arr, key) => arr.find(x => x.key === key);
  const PHASE_BY_ID = { ot1: 'start', ot2: 'start', ot3: 'framework', ot4: 'framework', ot5: 'framework', ot6: 'start', ot7: 'start', ot8: 'end' };

  // Bring a saved project up to the current data shape.
  function migrate(P) {
    P.a = Object.assign(defaults(), P.a || {});
    P.a.oneTime.forEach(o => { if (!o.phase) o.phase = PHASE_BY_ID[o.id] || (o.pool === 'auto' ? 'framework' : 'start'); delete o.pool; });
    P.locations = P.locations || ['India', 'USA'];
    P.downtimes = P.downtimes || []; P.holidays = P.holidays || [];
    P.modules.forEach((m, i) => { if (m.priority == null) m.priority = i + 1; if (m.availableFrom == null) m.availableFrom = ''; });
    P.team.forEach(r => r.leaves = r.leaves || []);
    return P;
  }

  /* ---------- Effort ---------- */
  function effort(p, scale = 1) {
    const a = p.a;
    const mods = p.modules.map(m => {
      const app = (find(a.appTypes, m.appType) || { factor: 1 }).factor;
      const td = (find(a.testData, m.testData) || { factor: 1 }).factor;
      const mixSum = a.complexity.reduce((s, c) => s + (+m.mix[c.key] || 0), 0) || 1;
      let design = 0, exec = 0, script = 0, autoTCs = 0;
      const counts = {};
      a.complexity.forEach(c => {
        const n = (+m.tcs || 0) * ((+m.mix[c.key] || 0) / mixSum) * scale;
        counts[c.key] = n;
        if (m.design) design += n * c.design;
        if (m.manualExec) exec += n * c.exec * a.manualCycles * (1 + a.retestPct / 100);
        if (m.automation) {
          const an = n * (+m.autoPct || 0) / 100;
          autoTCs += an;
          script += an * c.auto * app * td * (1 - a.reusePct / 100);
        }
      });
      const review = script * a.reviewPct / 100;
      const maint = script * a.maintenancePct / 100;
      const autoExec = m.automation ? autoTCs / 100 * a.analysisPer100 * a.autoCycles : 0;
      return { id: m.id, name: m.name, tcs: (+m.tcs || 0) * scale, autoTCs, counts, design, exec, script, review, maint, autoExec,
        manual: design + exec, auto: script + review + maint + autoExec };
    });
    const sum = k => mods.reduce((s, m) => s + m[k], 0);
    const anyAuto = p.modules.some(m => m.automation), anyManual = p.modules.some(m => m.design || m.manualExec);
    const ot = { auto: 0, manual: 0, common: 0 };
    a.oneTime.forEach(o => {
      if (!o.on) return;
      if (o.phase === 'framework') { if (anyAuto) ot.auto += +o.hours || 0; }
      else ot.common += +o.hours || 0;
    });
    const lines = {
      design: sum('design'), exec: sum('exec'), script: sum('script'), review: sum('review'),
      maint: sum('maint'), autoExec: sum('autoExec'), oneTime: ot.auto + ot.manual + ot.common
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
    return { mods, lines, variable, base, total: base * cf, oneTimeTotal: lines.oneTime * cf, pools,
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
        if (!wd || d < m.start || d > m.end) return 0;
        const alloc = (+r.alloc || 0) / 100;
        const gross = hpd * alloc;
        if (ded) ded.gross += gross;
        if ((hs[r.location] || new Set()).has(d)) { if (ded) ded.holidays += gross; return 0; }
        if (onLeave(r, d)) { if (ded) ded.leave += gross; return 0; }
        let h = gross;
        const nd = h * m.role.nonDevPct / 100; h -= nd; if (ded) ded.nonDev += nd;
        const ul = h * a.unplannedLeavePct / 100; h -= ul; if (ded) ded.unplanned += ul;
        const dt = h * (1 - (1 - a.downtimePct / 100) * dtf); h -= dt; if (ded) ded.downtime += dt;
        const rampF = m.worked < m.ramp ? (a.rampStartPct / 100) + (1 - a.rampStartPct / 100) * (m.worked / m.ramp) : 1;
        m.worked++;
        const rp = h * (1 - rampF); h -= rp; if (ded) ded.ramp += rp;
        const prod = m.lvl.productivity * m.sk.factor;
        const pd = h * (prod - 1); h += pd; if (ded) ded.productivity += pd;
        return h;
      });
      if (cb(d, hrs) === false) return d;
      d = addDays(d, 1);
    }
    return d;
  }

  function capacityIn(p, team, start, end) {
    const ded = { gross: 0, holidays: 0, leave: 0, nonDev: 0, unplanned: 0, downtime: 0, ramp: 0, productivity: 0 };
    let A = 0, M = 0, B = 0;
    const per = team.map(() => 0);
    const curve = []; let cum = 0;
    walk(p, team, start, end, 4000, (d, hrs) => {
      hrs.forEach((h, i) => { per[i] += h; const k = poolOf(team[i]); if (k === 'A') A += h; else if (k === 'M') M += h; else B += h; cum += h; });
      curve.push([d, cum]);
    }, { ded });
    return { A, M, B, total: A + M + B, per, ded, curve };
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
  function hireTeam(p, n, prefix = 'New hire') {
    const heads = splitHeads(n, hireProfiles(p));
    const t = []; let i = 1;
    heads.forEach(h => { for (let k = 0; k < h.n; k++) t.push({ id: 'h' + i, name: prefix + ' ' + (i++), role: 'Engineer', activity: 'Both', level: h.level, skill: p.a.hireSkill, alloc: 100, location: p.a.hireLocation, start: '', end: '', leaves: [] }); });
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
   *   2. framework and common code, at most N people at once                      automation
   *   3. manual test design, by module priority, once the module is available     manual
   *   4. scripting: only test cases already designed and past client review,
   *      after access lead time and once the framework core is ready              automation
   *   5. manual execution cycles: cycle 1 on reviewed test cases, later cycles
   *      after the previous cycle finishes plus the gap for a new build           manual
   *   6. automated regression runs and failure analysis on scripts that exist      automation
 *      (picked up ahead of new scripting, so runs happen throughout, not at the end)
   *   7. closure and handover, once everything else is done                       anyone
   * "Both" people work in the order design, scripting, execution, runs. Time that finds no
   * available work is recorded as idle (waiting on dependencies).
   */
  const CATS = ['setup', 'framework', 'design', 'script', 'exec', 'runs', 'close'];
  const EPS = 1e-7;

  function moduleUnits(p, scale, cf) {
    const a = p.a, cyc = Math.max(0, Math.round(+a.manualCycles || 0));
    return p.modules.map((m, idx) => {
      const app = (find(a.appTypes, m.appType) || { factor: 1 }).factor;
      const td = (find(a.testData, m.testData) || { factor: 1 }).factor;
      const mixSum = a.complexity.reduce((s, c) => s + (+m.mix[c.key] || 0), 0) || 1;
      let N = 0, dH = 0, xH = 0, sH = 0;
      const ap = (+m.autoPct || 0) / 100;
      a.complexity.forEach(c => {
        const n = (+m.tcs || 0) * ((+m.mix[c.key] || 0) / mixSum) * scale;
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
    let stRem = 0, fwRem = 0, endRem = 0;
    a.oneTime.forEach(o => {
      if (!o.on) return; const h = (+o.hours || 0) * cf;
      if (o.phase === 'framework') { if (anyAuto) fwRem += h; } else if (o.phase === 'end') endRem += h; else stRem += h;
    });
    const fwTotal = fwRem, gateH = fwTotal * (+a.frameworkGatePct || 0) / 100;
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
    const row = (key, label, cat, mod, d, h, w) => {
      let r = R.rows[key];
      if (!r) r = R.rows[key] = { key, label, cat, mod, first: d, last: d, hours: 0, weeks: {} };
      r.last = d; r.hours += h; r.weeks[w] = (r.weeks[w] || 0) + h;
    };
    const mark = (k, d, label) => { if (R && !R.ms[k]) R.ms[k] = { date: d, label }; };

    const modDone = m => (!m.design || m.designed >= m.N - EPS) && (!m.auto || m.scripted >= m.autoN - EPS) &&
      (!m.exec || m.ex[m.cyc - 1] >= m.N - EPS) && (!m.auto || m.runDone >= m.autoN * m.rH - EPS);
    const othersDone = () => stRem <= EPS && fwRem <= EPS && M.every(modDone);

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
      const gateOK = fwTotal <= EPS || fwTotal - fwRem >= gateH - EPS;
      if (gateOK && fwTotal > EPS) mark('fwCore', d, 'Framework core ready');
      let fwPeople = 0;
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
            const W = R.weeks[w] || (R.weeks[w] = { start: addDays(wk0, w * 7), design: 0, script: 0, exec: 0, runsH: 0, cats: {}, idle: 0, cap: 0 });
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
        const doDesign = () => { for (const m of M) if (m.avail && m.design && h > EPS) take('design', (m.N - m.designed) * m.dH, t => {
          const u = t / m.dH; m.designed += u; if (rec) day.design += u;
          const last = m.rq[m.rq.length - 1], at = wi + reviewDays;
          if (last && last[0] === at) last[1] += u; else m.rq.push([at, u]);
        }, m); };
        const doScript = () => { if (!accessOK || !gateOK) return; for (const m of M) if (m.avail && m.auto && h > EPS) take('script', (m.reviewed * m.af - m.scripted) * m.sH, t => { const u = t / m.sH; m.scripted += u; if (rec) day.script += u; }, m); };
        const doExec = () => { if (!accessOK) return; for (const m of M) if (m.avail && m.exec) for (let c = 0; c < m.cyc && h > EPS; c++) {
          const av = c === 0 ? m.reviewed - m.ex[0] : (wi >= m.ready[c] ? m.N - m.ex[c] : 0);
          take('exec', av * m.xH, t => { const u = t / m.xH; m.ex[c] += u; if (rec) day.exec += u; }, m);
        } };
        const doRuns = () => { if (!accessOK) return; for (const m of M) if (m.avail && m.auto && h > EPS) take('runs', m.scripted * m.rH - m.runDone, t => { m.runDone += t; }, m); };
        if (canM && canA) { doDesign(); doRuns(); doScript(); doExec(); }
        else if (canA) { doRuns(); doScript(); }
        else { doDesign(); doExec(); }
        if (h > EPS && endRem > EPS && othersDone()) take('close', endRem, t => { endRem -= t; });
        if (rec && h > EPS) { R.people[k].weeks[w].idle += h; R.idle += h; R.weeks[w] && (R.weeks[w].idle += h); }
      }
      if (rec) {
        const W = R.weeks[w] || (R.weeks[w] = { start: addDays(wk0, w * 7), design: 0, script: 0, exec: 0, runsH: 0, cats: {}, idle: 0, cap: 0 });
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
    out.expectedTotal = e.total * (p.a.pertBest + 4 + p.a.pertWorst) / 6;
    const scen = { best: p.a.pertBest, likely: 1, worst: p.a.pertWorst };
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
    return out;
  }

  /* ---------- Tracking ---------- */
  function trackWeights(p) {
    const e = effort(p), a = p.a, cyc = Math.max(0, Math.round(+a.manualCycles || 0));
    let dN = 0, xN = 0;
    e.mods.forEach((m, i) => { const pm = p.modules[i]; if (pm.design) dN += m.tcs; if (pm.manualExec) xN += m.tcs * cyc; });
    return {
      e, V: e.variable || 1,
      wD: dN ? e.lines.design / dN : 0,
      wX: xN ? e.lines.exec / xN : 0,
      wA: e.autoTCs ? (e.lines.script + e.lines.review + e.lines.maint + e.lines.autoExec) / e.autoTCs : 0
    };
  }
  function tracking(p, actuals, sched) {
    const W = trackWeights(p);
    const sorted = actuals.slice().sort((x, y) => x.week < y.week ? -1 : 1);
    let cumD = 0, cumX = 0, cumA = 0, cumH = 0;
    const rows = sorted.map(r => {
      cumD += +r.designed || 0; cumX += +r.executed || 0; cumA += +r.automated || 0; cumH += +r.hours || 0;
      const earned = cumD * W.wD + cumX * W.wX + cumA * W.wA;
      return { ...r, cumD, cumX, cumA, cumH, earned, pct: Math.min(1, earned / W.V) };
    });
    let plan = null, end = null;
    if (p.team.length && p.start) {
      const s = sched || schedule(p, {});
      end = s.finish;
      if (s.curve) {
        plan = s.curve.map(([d, D, A, X]) => [d, Math.min(1, (D * W.wD + X * W.wX + A * W.wA) / W.V)]);
        if (end) plan = plan.filter(x => x[0] <= end);
      }
    }
    const planAt = d => { if (!plan || !plan.length) return null; let v = 0; for (const [x, y] of plan) { if (x > d) break; v = y; } return v; };
    rows.forEach(r => { r.plannedPct = planAt(addDays(r.week, 6)); });
    const last = rows[rows.length - 1];
    let spi = null, eff = null, forecast = null;
    if (last && last.plannedPct > 0) {
      spi = last.pct / last.plannedPct;
      eff = last.cumH > 0 ? last.earned / last.cumH : null;
      if (spi > 0 && plan && plan.length) {
        const from = addDays(last.week, 6);
        let cur = last.pct, prevY = last.plannedPct;
        for (const [d, y] of plan) {
          if (d <= from) continue;
          cur += (y - prevY) * spi; prevY = y;
          if (cur >= 0.9999) { forecast = d; break; }
        }
        if (!forecast) {
          const pe = plan[plan.length - 1][0], span = Math.max(1, daysBetween(p.start, pe));
          forecast = addDays(pe > from ? pe : from, Math.ceil((1 - cur) * span / spi));
        }
      }
    }
    return { rows, plan, end, spi, eff, forecast, last, designPerTC: W.wD, execPerRun: W.wX, autoPerTC: W.wA };
  }

  return { defaults, defaultHolidays, newModule, newResource, newProject, migrate, effort, analyse, capacityIn, schedule, tracking,
    toS, toD, addDays, dow, mondayOf, daysBetween, uid, hireTeam, CATS };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ENGINE;
