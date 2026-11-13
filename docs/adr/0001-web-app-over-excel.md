# ADR 0001: Web application instead of an Excel workbook

- **Status:** Accepted (recorded retrospectively)
- **Date:** 2026-11-13
- **Scope:** Overall product architecture
- **Related:** `README.md`, `src/engine.js`, `src/ui.js`, `server.js`, `lib/store.js`

## Context

QuEST estimates effort, finish date, team size and achievable scope for manual and
automation test projects, and tracks weekly actuals against a frozen baseline. It is used
by several people on the same projects, over the life of a project, not for a one-off
calculation.

The decision to build a web application rather than an Excel workbook predates the first
commit in this repository. This ADR records the justification in retrospect, based on the
requirements the system now implements.

The main quality attributes are:

- a day-by-day schedule simulation rather than a pooled-hours formula;
- several people editing the same project without losing each other's work;
- data that stays valid and consistent over months of edits;
- weekly actuals, baselines and forecasts that remain comparable over time;
- the same results in a copied summary, an exported workbook and the screen;
- operators can host the tool inside the organisation without installing clients.

## Decision

Build QuEST as a self-hosted web application with:

- a pure calculation engine shared by the browser and the server test suite;
- a server that validates and stores projects in SQLite;
- a browser client with tabs, forms, charts and live what-if controls;
- Excel as an **export and reporting format**, not as a source of truth.

The workbook export and the copied summary are one-way outputs. They must not be edited
and re-imported; the saved project remains the only source of truth.

## Rationale

### 1. The estimate is a simulation, not a formula

The finish date comes from a day-by-day schedule. Each person's productive hours are
allocated to the work they can do, in dependency order, taking holidays, leave, meetings,
downtime, ramp-up, skill, module availability, review gates and waiting into account.
Team sizing and scope fit are iterative searches that run that schedule many times per
estimate.

That belongs in code with unit tests, not in a formula lattice. In Excel it would need
VBA, iterative Solver or a very large and fragile sheet, and it would still be difficult
to audit or change safely.

### 2. Shared projects need concurrency control, not shared files

Several people can work on the same project. Plan edits are merged field by field; only
changes to the same field become a conflict, and the second person is asked which value to
keep. Projects carry a revision, deletes are soft and restoreable, and every change is
recorded.

Shared workbooks and SharePoint co-authoring do not understand those domain-level merge
rules or the validation that goes with them. They also tend to produce copies, locked
files and "final_v3.xlsx" sprawl.

### 3. Validation and migrations protect long-lived data

The server rejects impossible dates, negative counts, invalid percentages and malformed
factor tables. Damaged saved settings are repaired on load instead of breaking the page.
Factor ranges are defined once and shared by the server and the sliders, so the UI cannot
produce a value the server will reject. Old projects are migrated forward automatically.

Spreadsheet validation rules and formulas are easy to break, duplicate and drift between
copies, and there is no central schema or migration path.

### 4. Tracking over time needs real state

Weekly actuals, frozen baselines, baseline history, forecasts and generated status emails
are long-lived records. In a workbook, a baseline becomes a copied sheet or workbook and
a forecast becomes another formula that is easy to overwrite. Here they are first-class
records that can be compared, restored and audited.

### 5. Interaction and accessibility matter

Sliders for live tuning, Gantt and heat-map views, a calendar, burn charts, responsive
layouts, dark mode and keyboard-accessible controls are practical in a browser and awkward
or desktop-bound in Excel.

### 6. Spreadsheet logic is hard to review and test

The calculation engine is a pure module with automated tests; the server has tests for
validation, auth, storage and migrations. The browser interaction has a Playwright suite.
This would not be practical with formulas and macros.

### 7. Deployment fits the organisation

The tool is a single self-hosted Node.js process with built-in SQLite, no client install,
optional Windows/Entra sign-in, roles for viewers, editors and admins, central backups and
HTTPS behind the usual reverse proxy. That avoids Excel version, add-in, macro-policy and
licensing friction while keeping the data inside the organisation.

## Alternatives considered

### Excel workbook with formulas, VBA and Solver

**Rejected.** Cheapest for a single user and a one-off estimate, but poor for concurrent
use, long-lived tracking, testability and maintainability. Building the scheduler in VBA
would effectively be writing an application inside a spreadsheet, with worse tooling.

### Excel plus SharePoint or Office Scripts

**Rejected.** Improves co-authoring, but still lacks field-level merge semantics, strict
domain validation, migrations, automated tests and a clean separation between the engine
and the UI.

### Desktop application

**Rejected.** Requires installation and updates on every user's machine, complicates
central backup and access control, and does not improve on a browser client for this use
case.

### Web application

**Chosen.** Fits the simulation, concurrency, validation, tracking and interaction
requirements, keeps deployment simple and lets Excel remain the familiar reporting format.

## Consequences

### Positive

- One authoritative dataset with revision checks, history, backups and restore.
- A tested calculation engine that can evolve without re-validating a workbook by hand.
- Shared access with roles and no client installation.
- Live what-if tuning and multiple views of the same model.
- Excel export and copied summaries still meet users in the format they already use.

### Negative

- A server must be hosted, secured, patched and backed up.
- Authentication and authorization add operational complexity.
- The tool needs a browser and has no true offline editing mode.
- Development is more expensive than producing a workbook.
- Users cannot pivot or extend the data as freely as they can in Excel.

### Mitigations

- Self-hosted single process, SQLite, automatic backups and a simple upgrade path.
- Optional sign-in and roles; without logins the server only serves localhost.
- View-only local experimentation for what-ifs.
- Excel export via SheetJS and a "Copy summary" action for reporting.
- Explicit documentation that exported files are reports, not editable sources.

## When to revisit

Revisit this decision if the dominant use case becomes single-user, offline, one-off
estimating with no tracking and no sharing. In that case an Excel workbook would be
cheaper to build, distribute and maintain. The current requirements make the opposite
trade-off worthwhile.

## References

- `README.md` — product behaviour, schedule model, storage, access and backups.
- `src/engine.js` — pure estimation and simulation engine.
- `src/ui.js` — browser client, live tuning and field-level merge.
- `server.js` — validation, authentication, roles and HTTP API.
- `lib/store.js` — SQLite storage, history, backups and migrations.
- `test/` — engine, server and browser tests.
- `PILOT.md` — roles, pilot scenarios and operating guidance.
