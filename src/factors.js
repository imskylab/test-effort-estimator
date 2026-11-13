/* ===== Factor metadata =====
 * One list of the numeric factors that can be fine-tuned with sliders, plus the
 * ranges the server accepts. The browser bundle and server.js both use this file,
 * so a slider can never send a value the server will reject.
 *
 * Each entry: path (inside P.a), label, group, min, max, step, unit, hint, key,
 * rangeMax. `max` is the exact-entry limit (matches server validation); rangeMax
 * keeps a slider usable when the validation limit is very large.
 */
const FACTOR_RANGES = {
  hoursPerDay: [1, 24], unplannedLeavePct: [0, 100], downtimePct: [0, 100], reviewPct: [0, 100], maintenancePct: [0, 100],
  reusePct: [0, 90], retestPct: [0, 100], contingencyPct: [0, 200], rampStartPct: [0, 100], frameworkGatePct: [0, 100],
  cicdExistingPct: [0, 100], managerAlloc: [0, 100], manualCycles: [0, 20], autoCycles: [0, 500], analysisPer100: [0, 1000],
  accessDays: [0, 365], reviewDays: [0, 365], cycleGapDays: [0, 365], frameworkMaxPeople: [1, 100], commonMaxPeople: [1, 100],
  leadSpan: [1, 100], managerAbove: [0, 10000], hireLeadDays: [0, 365], commonPerModule: [0, 10000], pertBest: [0.1, 2], pertWorst: [0.5, 10]
};

function tuneFactors(a) {
  a = a || {};
  const out = [];
  const add = (path, label, group, min, max, step, unit, hint, key, rangeMax) => out.push({
    path, label, group, min, max, step, unit: unit || '', hint: hint || '', key: !!key,
    rangeMax: rangeMax == null ? max : rangeMax
  });

  // Effort
  add('a.reviewPct', 'Review and rework', 'Effort', 0, 100, 1, '%', 'Share of scripting time spent on review and rework', true);
  add('a.maintenancePct', 'Script maintenance', 'Effort', 0, 100, 1, '%', 'Fixing scripts broken by application changes during the project', true);
  add('a.reusePct', 'Reusability saving', 'Effort', 0, 90, 1, '%', 'Time saved by reusable components and keywords', true);
  add('a.manualCycles', 'Manual execution cycles', 'Effort', 0, 20, 1, 'runs', 'How many times the manual suite is executed', true);
  add('a.retestPct', 'Retest and defect verification', 'Effort', 0, 100, 1, '%', 'Share of each manual cycle spent re-running fixed defects', true);
  add('a.autoCycles', 'Automated regression runs', 'Effort', 0, 500, 1, 'runs', 'During the project', false, 50);
  add('a.analysisPer100', 'Failure analysis', 'Effort', 0, 1000, 1, 'h per 100 scripts per run', 'Time spent investigating automated failures', false, 200);

  // Automation and framework
  add('a.frameworkGatePct', 'Framework core before common methods', 'Automation', 0, 100, 1, '%', 'Share of framework development done before common methods can start', true);
  add('a.commonPerModule', 'Common methods per automated module', 'Automation', 0, 10000, 1, 'h', 'Added to the common methods list', true, 100);
  add('a.cicdExistingPct', 'Existing CI/CD effort', 'Automation', 0, 100, 1, '%', 'Hooking the suite into an existing pipeline', false);
  add('a.fwStatusPct.extend.framework', 'Extending: framework effort', 'Automation', 0, 100, 1, '%', '', false);
  add('a.fwStatusPct.extend.common', 'Extending: common methods effort', 'Automation', 0, 100, 1, '%', '', false);
  add('a.fwStatusPct.reuse.framework', 'Reusing: framework effort', 'Automation', 0, 100, 1, '%', 'Onboarding and configuration only', false);
  add('a.fwStatusPct.reuse.common', 'Reusing: common methods effort', 'Automation', 0, 100, 1, '%', 'Application-specific helpers still needed', false);

  // Capacity
  add('a.hoursPerDay', 'Hours per working day', 'Capacity', 1, 24, 0.5, 'h', 'Used for daily capacity and person-days', true);
  add('a.unplannedLeavePct', 'Unplanned leave', 'Capacity', 0, 100, 1, '%', 'Sick days and emergencies', true);
  add('a.downtimePct', 'Everyday downtime', 'Capacity', 0, 100, 1, '%', 'Environment outages, broken builds, access issues', true);
  add('a.rampStartPct', 'Productivity on day one', 'Capacity', 0, 100, 1, '%', 'Starting point of the ramp-up curve', false);
  (a.roles || []).forEach((r, i) => add(`a.roles.${i}.nonDevPct`, `${r.key}: non-development time`, 'Capacity', 0, 100, 0.5, '%',
    r.key === 'Engineer' ? 'Stand-ups, status reports, client and defect calls' : r.key === 'Lead' ? 'Planning, reviews, reporting, client calls' : 'Full-time management by default',
    r.key !== 'Manager'));

  // Schedule
  add('a.accessDays', 'Access and environment lead time', 'Schedule', 0, 365, 1, 'working days', 'No scripting or execution before this', true, 60);
  add('a.reviewDays', 'Client review of test cases', 'Schedule', 0, 365, 1, 'working days', 'Designed test cases can be scripted or executed after this', true, 60);
  add('a.cycleGapDays', 'Gap between manual cycles', 'Schedule', 0, 365, 1, 'working days', 'Waiting for the next build', false, 60);
  add('a.frameworkMaxPeople', 'People on framework at once', 'Schedule', 1, 100, 1, 'people', 'Framework work does not split well across many people', false, 20);
  add('a.commonMaxPeople', 'People on common methods at once', 'Schedule', 1, 100, 1, 'people', '', false, 20);

  // Team sizing
  add('a.leadSpan', 'Engineers per lead', 'Team', 1, 100, 1, 'engineers', 'Used when working out how many leads to add', true, 20);
  add('a.managerAbove', 'Add a manager above team size', 'Team', 0, 10000, 1, 'people', '', false, 100);
  add('a.hireLeadDays', 'New hires join after', 'Team', 0, 365, 1, 'working days', 'Time to hire or move people onto the project', false, 60);
  add('a.managerAlloc', 'Manager allocation', 'Team', 0, 100, 1, '%', '', false);
  Object.keys(a.teamMix || {}).forEach(k => add(`a.teamMix.${k}`, `New hires: ${k}`, 'Team', 0, 100, 1, '%', 'Share of new hires at this experience level', false));

  // Risk
  add('a.contingencyPct', 'Contingency buffer', 'Risk', 0, 200, 1, '%', 'Added to the likely estimate', true);
  add('a.pertBest', 'Best case multiplier', 'Risk', 0.1, 2, 0.05, '×', 'Applied to the base estimate, without contingency', true);
  add('a.pertWorst', 'Worst case multiplier', 'Risk', 0.5, 10, 0.05, '×', 'Applied to the base estimate; contingency is not added on top', true);

  // Advanced tables
  (a.appTypes || []).forEach((x, i) => add(`a.appTypes.${i}.factor`, `App type: ${x.key}`, 'Advanced', 0, 10, 0.05, '×', 'Multiplies automation hours', false));
  (a.testData || []).forEach((x, i) => add(`a.testData.${i}.factor`, `Test data: ${x.key}`, 'Advanced', 0, 10, 0.05, '×', 'Multiplies automation hours', false));
  (a.levels || []).forEach((x, i) => {
    add(`a.levels.${i}.productivity`, `Experience: ${x.label || x.key}`, 'Advanced', 0.05, 5, 0.05, '×', 'Relative to a mid-level engineer', false);
    add(`a.levels.${i}.rampDays`, `Ramp-up: ${x.label || x.key}`, 'Advanced', 0, 365, 1, 'days', '', false, 60);
  });
  (a.skills || []).forEach((x, i) => {
    add(`a.skills.${i}.factor`, `Tool skill: ${x.key}`, 'Advanced', 0.05, 5, 0.05, '×', 'Multiplies productivity', false);
    add(`a.skills.${i}.extraRamp`, `Extra ramp: ${x.key}`, 'Advanced', 0, 365, 1, 'days', '', false, 60);
  });
  (a.complexity || []).forEach((x, i) => {
    add(`a.complexity.${i}.design`, `Complexity: ${x.name || x.key} design`, 'Advanced', 0, 1000, 0.5, 'h', '', false, 50);
    add(`a.complexity.${i}.exec`, `Complexity: ${x.name || x.key} manual run`, 'Advanced', 0, 1000, 0.25, 'h', '', false, 20);
    add(`a.complexity.${i}.auto`, `Complexity: ${x.name || x.key} automation`, 'Advanced', 0, 1000, 0.5, 'h', '', false, 100);
  });

  return out;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { ranges: FACTOR_RANGES, tuneFactors };
