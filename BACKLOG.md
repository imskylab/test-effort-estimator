# Backlog

Last updated: 11 November 2026

Status values: `next` (agreed, not started), `later` (candidate), `done` (shipped).
Estimates: S (under half a day), M (1–2 days), L (3+ days).

## Next

### FT-01 — Fine tune view under Factors

**Status:** done · **Estimate:** M · **Area:** Factors, Summary

**Goal**
Add a "Fine tune" view inside the Factors tab that splits the page into a live
"Current estimate" panel and a set of factor sliders. Moving a slider updates the
estimate in real time, and the new value is written back to the project factors so
the normal Factors table and Summary tab show it too.

**Why**
The Factors table is precise but slow to explore: you have to find a field, type a
value, and switch to Summary to see the effect. A slider view makes the trade-offs
visible (for example, more contingency vs. a later finish) without changing the
underlying model or adding a second source of truth.

**Scope**
- Add a `Factor tables | Fine tune` switch at the top of the Factors tab.
- Left pane: a compact, sticky "Current estimate" panel with the status pill,
  likely effort (hours and person-days), likely/best/worst finish dates, team
  needed (or extra people), and achievable scope. Values update while tuning.
- Right pane: grouped sliders for the factors that move the estimate, with a
  numeric input beside each slider for precise entry.
- Groups: Effort, Automation and framework, Capacity, Schedule, Team sizing, Risk.
  Show the key drivers first; put the rest under a collapsed "More factors".
- Each slider shows its label, hint, current value and unit, a changed marker,
  and a per-slider reset.
- Footer actions: reset changes since opening, reset all factors to defaults
  (reuse the existing confirmation), and a note that saving is automatic.
- Ranges and steps must match the server's `NUM_RANGES` so a slider can never
  produce a value the server rejects.
- Responsive: two columns on desktop, stacked with the summary first on mobile.
- Keep the existing Factors table unchanged; it remains the place for text,
  tables and structural edits.

**Behaviour**
- Dragging a slider updates the estimate within roughly 150 ms; the page must not
  jump, lose the slider, or rebuild the whole Factors view on every pixel.
- Changes write to `P.a` immediately (the same data the table reads), but saving
  stays debounced. A full render and an immediate save happen when the slider is
  released or after a short idle period.
- A numeric input stays in sync with its slider and is clamped to the same range.
- Switching to Factor tables or Summary shows the tuned values.
- The left pane compares against a snapshot taken when Fine tune was opened:
  effort delta, finish-date delta, status change, and team/scope change.
- Viewers can experiment locally (as elsewhere), with the existing view-only
  banner; nothing is saved.

**Technical notes**
- `src/ui.js`: add `S.factorsMode` and `S.tune` (entry snapshot and current
  analysis), a `viewFineTune()` renderer, a `tuneSummary(A)` helper, and
  `input`/`change` handlers for `[data-tune]`.
- Suppress full `renderAll()` while a slider is active; update only the summary
  pane from the worker result. Do a full render on release/idle so the table and
  header sync.
- Reuse the existing Web Worker and its `seq`/`calcAgain` coalescing; throttle
  slider input to avoid flooding it.
- Factor metadata (path, label, group, min, max, step, unit, hint, key/advanced)
  should live in one shared place used by both the UI and server validation, so
  ranges cannot drift. Suggested: a small `src/factors.js` included by the build
  and required by `server.js`.
- CSS in `src/head.html`; no changes to the estimation model itself.
- Rebuild `public/index.html` after the source changes.

**Acceptance criteria**
- [x] Factors has a working Fine tune view; Factor tables still works as before.
- [x] All sliders and numeric inputs stay in sync and stay within valid ranges.
- [x] Moving a slider changes the estimate live without losing slider focus or
      rebuilding the whole page.
- [x] After tuning, the Factors table and Summary tab show the same values.
- [x] Values save automatically and survive a reload.
- [x] Per-slider reset, reset-since-opening, and reset-all work.
- [x] Changed factors are visually marked and show the value they had on entry.
- [x] Keyboard and screen-reader friendly: labelled range inputs, current value
      exposed as text, focus visible.
- [x] Desktop and mobile layouts are usable; dark theme still works.
- [x] Tests cover factor metadata and ranges (DOM-free tests in
      `test/engine.test.js`) plus the slider-to-summary-to-table flow
      (`test/ui.test.js`). The Playwright test is skipped where Playwright is not
      installed; run `npm run test:ui` to exercise it.

**Shipped**
- `src/factors.js`: shared slider metadata and ranges, also required by
  `server.js` so validation cannot drift.
- `src/ui.js`: `Factor tables | Fine tune` switch, live summary pane, grouped
  sliders with numeric entry, per-slider and reset-since-opening actions.
- `src/head.html`: responsive two-column layout, changed-factor markers.
- `scripts/build.js`: includes the shared factor file in both builds.
- `test/ui.test.js`: Playwright flow for live update, table sync and reset.

**Out of scope**
- New estimation math or new factors.
- Per-project factor presets or organisation-wide defaults.
- Cost/rate modelling.
- A second copy of the Summary tab; the left pane is a compact view.

---

## Fixes and hardening (from the November review)

| ID | Item | Area | Estimate |
|---|---|---|---|
| BUG-01 | Capacity table: late joiners/early leavers distort the per-FTE role columns (e.g. a lead joining mid-window shows 168 h under a "65 days × 8 h" label). Show the role's available window or add an explicit note. | Engine/UI | S |
| BUG-02 | Capacity table: independently rounded rows can miss the displayed total by 1 h. Add a rounding note or derive the total from rounded rows; same in Excel. | UI | S |
| BUG-03 | A project can be cleared to "no start date" in the UI, but the server rejects saving it. Allow an empty start (the engine copes) or block/undo clearing with a clear message. | Server/UI | S |
| BUG-04 | Purge deletes `docs` but leaves every full revision in the `history` table, so "permanent" deletes don't remove the content. History is also never pruned as edits accumulate. Delete matching history on purge and add retention. | Store | M |
| BUG-05 | Team `name`, `role`, `level`, `skill`, `activity`, `location`, leave notes, and actuals `mods`/`hoursBy` keys are not bounded. Add type/length/count caps. | Server | S |
| OPS-01 | The failed-login IP map never removes expired entries; `audit.log` never rotates. Add a periodic sweep and log rotation. | Server | S |

## Enhancements

| ID | Item | Area | Estimate |
|---|---|---|---|
| ENH-01 | Capacity footer: compare estimated effort with productive capacity ("2,400 h effort vs 2,153 h capacity, 247 h short") and show the per-role gap against the recommended team. | Summary/UI | S–M |
| ENH-02 | Project history/restore UI: revisions are stored, but only metadata is exposed. Add an admin history panel with diff/restore. | Server/UI | M |
| ENH-03 | Paste/CSV import for modules and the team (holidays already support paste). | UI | M |
| ENH-04 | Print / Save as PDF styles for the summary and status email. | UI | S |
| ENH-05 | Bundle the Google Fonts (or use system fonts) and add a Content-Security-Policy, so the tool works fully offline and leaks less. | UI/Server | S–M |
| ENH-06 | Accessibility polish: tabpanel wiring and arrow-key tab navigation; `scope="col"` on table headers. | UI | S |

## Engineering

| ID | Item | Area | Estimate |
|---|---|---|---|
| ENG-01 | UI tests never run: all 8 `test/ui.test.js` cases are skipped without Playwright, and `npm test` excludes them. Add Playwright as a dev dependency + CI, or extract the summary/capacity model for DOM-free tests. | Tests | M |
| ENG-02 | Build drift: `public/index.html` is generated. Add a `build.js --check` or a test that a fresh build matches the committed file. | Build | S |
| ENG-03 | Split the 172 KB `src/ui.js` into modules (summary/capacity, email, export, inputs) with no behaviour change. | UI | M |

## Done recently

- Role-based Productive capacity table on the Summary tab, with the same table in
  the copied summary and Excel export, plus per-person deduction reconciliation.
- Purge isolation, id validation/escaping, baseline/location/downtime validation,
  Monday/week binding, and their regression tests.
