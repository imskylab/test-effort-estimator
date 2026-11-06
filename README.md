# QuEST: Quality Estimation & Scheduling Tool

*Estimate it. Plan it. Track it.*


Estimates effort, finish date, team size and achievable scope for manual and automation
test projects, and tracks weekly actuals against the plan. Everyone who opens the page
works on the same saved projects.

## How the schedule works

The finish date comes from a day-by-day schedule, not from pooled hours. Each person's
productive hours (after holidays, leave, meetings, downtime, ramp-up and skill) go to the
work they can do, in this order:

1. Project-start activities: strategy, KT, environment and test data setup (anyone).
2. Framework core development (automation people, a few at once).
3. Common methods and reusable components, once the framework core is done.
4. CI/CD and reporting setup, by one person alongside the framework work.
5. Manual test design, by module priority, once the module is available.
6. Automation scripting, only on test cases already designed and past client review,
   after the access lead time and once common methods are ready.
7. Manual execution cycles, with a gap for a new build between cycles.
8. Regression runs and failure analysis on scripts that exist, once CI/CD is ready.
9. Closure and handover, once everything else is done.

Framework and common methods effort depends on whether the framework is new, extended or
reused as is; CI/CD can be a new pipeline, a hook into an existing one, or not needed. Both are set on the
Summary and Factors tabs.

Time with no available work counts as waiting. The rules (access lead time, framework core %,
people on framework, review turnaround, gap between cycles) are on the Factors tab;
module priority and "available from" dates are on the Scope tab. The Schedule tab shows
the phase timeline, who does what each week, a month calendar and the weekly plan.

## Summary tab

The Summary tab answers the three planning questions in FTE and calendar days (how long
with the current team, how much fits by the target, how many people are needed), gives a
staffing recommendation, and breaks down effort, productive capacity (per FTE and for the
team), key factors and what's driving the estimate. Add customer-facing notes (extra
drivers, exclusions, open questions) at the bottom. "Copy summary" puts the whole summary
on the clipboard as Markdown, ready for an email, Teams or Slack. The client version leaves
out team time, the per-FTE capacity breakdown, hiring details and waiting time; the internal
version adds "team time to price": the hours people are booked on the project, including
leads, managers and waiting time, which is what gets priced (it is higher than the effort).

The best and worst cases are applied to the base estimate; contingency is not stacked on top.

## Baseline

Once the estimate is agreed, freeze it as the baseline on the Tracking tab. Lateness is
measured against the baselined target even if the target date is later edited (the change
is reported). Modules added after the baseline are tracked separately and listed in status
emails as work pending a change request; they don't count as progress until you re-baseline.

 Tracking, the
forecast and status emails then measure against the baseline, and later changes to the plan
show as variances (finish date, effort, scope). Re-baselining needs a reason and is kept in a
history that the status email mentions.

## Tracking and status email

Each week, log per module how many test cases were designed, automated and executed, plus
team hours, highlights and blockers. Progress is earned at each module's own estimated hours
and compared with the baseline (or the current plan if none is frozen), giving a schedule
index, a per-module status and a forecast finish at the current pace (a smoothed forecast is
shown next to it in early weeks). Setup, framework, common methods and CI/CD progress are
logged as % complete, so those weeks count too. Hours are logged per person and compared
with the earned-per-logged-hour ratio the plan itself implies. In the first weeks (under 10%
done) a slow start is reported as "At risk" with the pace explained, not "Behind". Counts above a module's scope are capped
and flagged.

The status email builds a draft for any logged week: overall status, this week vs plan,
progress by module, highlights, risks and blockers, next week's plan, milestones, holidays and
leave, and what's needed from the customer. Choose the client or internal version (internal
adds hours, productivity and names on leave), edit the draft in place, then copy it formatted
for Outlook or Teams, or as plain text. If the numbers change after you edit the draft,
copying is paused until you refresh it or confirm your edits.

## Run it

Needs Node.js 22.13 or later (Node 24 LTS recommended). There are no packages to install: it uses Node's built-in SQLite.

```
npm start
```

Then open http://localhost:3000. Others on your network can use http://<this-machine's-IP>:3000.

## Settings

Set these as environment variables before starting:

| Variable     | Default     | What it does                                                        |
|--------------|-------------|---------------------------------------------------------------------|
| `PORT`       | `3000`      | Port to listen on                                                   |
| `HOST`       | `127.0.0.1` | This machine only. Use `0.0.0.0` to share on your network (needs a login) |
| `BASIC_AUTH` | none        | Logins: `user:password`, or several as `alice:pw1,bob:pw2`          |
| `USERS_FILE` | none        | Path to a JSON file of users and roles (below)                      |
| `AUTH_HEADER` | none       | Windows / Entra sign-in through a front end such as IIS: the header carrying the signed-in user, e.g. `X-Remote-User` |
| `TRUSTED_PROXY` | `127.0.0.1,::1` | Addresses allowed to send `AUTH_HEADER`                       |
| `DATA_DIR`   | `./data`    | Where the database (`estimator.db`) and audit log are kept          |
| `BACKUP_DIR` | `DATA_DIR/backups` | Where backups go. Put it on a different disk or a network share |
| `TLS_CERT`, `TLS_KEY` | none | PEM certificate and key: serves HTTPS                         |
| `TLS_PFX`, `TLS_PASSPHRASE` | none | Or a .pfx / .p12 certificate (common on Windows) and its password |

Users file: each entry is a password, or `{ "password", "role" }`. An entry without a password is
a Windows or Entra user, signed in by the front end. `"*"` sets the role for any other signed-in
Windows user; without it, only listed people get in.

```json
{ "MYDOMAIN\\jay": { "role": "admin" }, "MYDOMAIN\\priya": {}, "*": { "role": "viewer" },
  "pilot-guest": { "password": "change-me", "role": "viewer" } }
```

Roles: `viewer` can open everything and try what-ifs on screen, but nothing is saved; `editor`
(the default) can save, log actuals, create and delete; `admin` can also delete permanently
through the API. Setting up Windows sign-in with IIS is in [PILOT.md](PILOT.md).

- The server refuses to share on the network without a login, and warns if it does so
  without HTTPS (passwords would travel unencrypted). Use HTTPS on the intranet.
- Ten wrong passwords from one address lock it out for 15 minutes.
- Without logins it only answers requests addressed to localhost, and refuses requests that
  come through a proxy.
- Every change records who made it: `updatedBy` on the record, a line in `data/audit.log`,
  and a row in the database's history table (`GET /api/history/<path>` lists it).

Windows (PowerShell):
```
$env:HOST="0.0.0.0"; $env:USERS_FILE="D:\secure\quest-users.json"; $env:TLS_PFX="D:\secure\estimator.pfx"; $env:TLS_PASSPHRASE="…"; npm start
```

## Development

```
npm run build   # rebuild public/index.html and dist/claude-artifact.html from src/
npm test        # run the engine and server tests
npm run test:ui # browser tests (needs Playwright: npm i -D playwright && npx playwright install chromium)
```

Edit files in `src/`, never `public/index.html` directly: the build overwrites it.

| Path | What it is |
|------|------------|
| `src/engine.js` | Estimation model: effort, capacity calendar, day-by-day scheduler, team sizing, scope fit, tracking. Pure functions, no DOM. |
| `src/ui.js` | The page: tabs, forms, charts, schedule views, Excel export, saving. |
| `src/head.html` | Title and styles (colour tokens for light and dark themes). |
| `src/body.html` | Page shell: header and tabs. |
| `public/store.js` | Storage adapter for the self-hosted version (REST API with polling). |
| `public/vendor/` | SheetJS 0.18.5 for Excel export. |
| `server.js` | Zero-dependency Node server: static files plus a JSON document API. |
| `lib/store.js` | SQLite storage: documents, change history, backups, migration from `db.json`. |
| `scripts/build.js` | Assembles the two builds. |
| `deploy/` | IIS `web.config` for Windows sign-in and an example users file. |
| `PILOT.md` | Intranet pilot kit: setup, sign-in, quick start, scenarios, feedback. |
| `test/` | Engine, server and browser tests (`node --test`). |

The same `src/` code also runs as a claude.ai artifact, where storage and downloads come
from the artifact platform instead of `public/store.js`. `dist/claude-artifact.html` is
that build.

### Server API

| Method | Path | Body / result |
|--------|------|---------------|
| `GET` | `/api/col/<collection>` | `{ docs: [{ id, data }] }` |
| `GET` | `/api/doc/<collection>/<id>` | `{ id, data }` or 404 |
| `PUT` | `/api/doc/<collection>/<id>` | JSON object; replaces the document |
| `DELETE` | `/api/doc/<collection>/<id>` | Deletes it and anything nested under it |

Projects live at `projects/<id>`; weekly actuals at `projects/<id>/actuals/<week-start>`.

## Data and backups

- Everything is stored in a SQLite database, `data/estimator.db` (git-ignored). Each project
  and each week of actuals is a record; every change is also kept in a history table.
- Upgrading from an older version: on first start, `data/db.json` is moved into the database
  automatically and renamed `db.json.migrated`.
- A consistent copy of the database goes to the backup folder every 6 hours (last 28 kept,
  about a week). Point `BACKUP_DIR` at another disk or share, or include it in IT backups.
- Deleting a project or a week only marks it as deleted: it can be undone straight away or
  restored later from "Deleted" in the header. A deleted project can't be brought back by an
  old open copy saving over it; the person editing is told and can choose to restore it.
- To move the tool to another machine, copy the whole folder including `data/`.

## Keep it running

Use any process manager, for example `npx pm2 start server.js --name quest`,
or a Windows service / systemd unit pointing at `node server.js`.
For HTTPS, put it behind your usual reverse proxy (IIS, nginx).

## Notes

- Several people can work at once. Changes from others appear within about 4 seconds.
  Plan edits are merged field by field: if two people change different things (two modules,
  two fields of the same module, two rows of a factor table), both changes are kept
  automatically. Only when both change the same thing is the second person
  shown both values and asked which to keep. Weekly actuals are saved field by field; a
  week that already exists is never replaced, and changing a field a colleague just changed
  asks first (with "keep both" for notes).
- The server checks saved projects and actuals strictly (real dates, counts, percentages),
  only accepts projects and their weekly actuals, and ignores keys that could tamper with
  the server itself. Without logins it only answers requests addressed to localhost.
- Results are calculated in a background worker, so editing, opening a project or receiving
  a colleague's changes doesn't freeze the page; copies, exports and baselines wait for
  freshly calculated numbers.
- If a saved project has invalid settings, they're reset to defaults when it's opened and
  you're told which ones, instead of the page failing.
- Basic auth sends the password with every request, so use HTTPS if the server is
  reachable outside a trusted network.
- The page loads its fonts from Google Fonts; without internet it falls back to system fonts.
