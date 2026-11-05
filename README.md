# Test Effort Estimator

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
reused as is; CI/CD effort drops when a pipeline already exists. Both are set on the
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
on the clipboard as Markdown, ready for an email, Teams or Slack.

## Run it

Needs Node.js 18 or later. There are no packages to install.

```
npm start
```

Then open http://localhost:3000. Others on your network can use http://<this-machine's-IP>:3000.

## Settings

Set these as environment variables before starting:

| Variable     | Default   | What it does                                  |
|--------------|-----------|-----------------------------------------------|
| `PORT`       | `3000`    | Port to listen on                             |
| `HOST`       | `0.0.0.0` | Use `127.0.0.1` to allow only this machine    |
| `DATA_DIR`   | `./data`  | Where projects and actuals are saved          |
| `BASIC_AUTH` | none      | `user:password` to require a login            |

Windows (PowerShell): `$env:PORT=8080; $env:BASIC_AUTH="team:secret"; npm start`
macOS/Linux: `PORT=8080 BASIC_AUTH=team:secret npm start`

## Development

```
npm run build   # rebuild public/index.html and dist/claude-artifact.html from src/
npm test        # run the estimation engine tests
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
| `scripts/build.js` | Assembles the two builds. |
| `test/` | Engine tests (`node --test`). |

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

- Everything is saved in `data/db.json`. The `data/` folder is git-ignored.
- A dated copy goes to `data/backups/` every 6 hours (last 14 kept).
- To move the tool to another machine, copy the whole folder including `data/`.

## Keep it running

Use any process manager, for example `npx pm2 start server.js --name estimator`,
or a Windows service / systemd unit pointing at `node server.js`.
For HTTPS, put it behind your usual reverse proxy (IIS, nginx).

## Notes

- Several people can edit at once. Changes from others appear within about 4 seconds.
  If two people edit the same project at the same moment, the last save wins.
- Basic auth sends the password with every request, so use HTTPS if the server is
  reachable outside a trusted network.
- The page loads its fonts from Google Fonts; without internet it falls back to system fonts.
