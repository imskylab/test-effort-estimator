# Intranet pilot kit

Everything needed to run a 3–4 week pilot of the Test Effort Estimator with two or three
delivery teams: server setup, Windows sign-in, a 15-minute quick start for pilot users, what
to try, and the feedback to collect.

## 1. Server checklist

- [ ] A Windows server (or VM) that stays on, reachable on the intranet.
- [ ] Node.js 22.13 or later: `node -v`. Node 24 LTS recommended.
- [ ] The repo copied or cloned to it, e.g. `D:\Apps\test-effort-estimator`.
- [ ] `npm test` passes on the server.
- [ ] `DATA_DIR` on a disk that's backed up; `BACKUP_DIR` on a different disk or share.
- [ ] Runs as a service so it survives reboots (see "Keep it running" in README.md).
- [ ] An intranet name for it, e.g. `estimator.example.local`, and an HTTPS certificate for that name.
- [ ] Users file created (see section 3) and stored outside the repo, e.g. `D:\secure\estimator-users.json`.

## 2. Choose how people sign in

| Option | Use when | People see |
|--------|----------|------------|
| **A. Windows sign-in through IIS** (recommended) | your organisation machines are joined to Active Directory, or to Entra ID with on-premises sync | No password prompt; they're signed in as their Windows user |
| **B. Entra ID through a front end** | Machines are Entra-only, or the tool is published through Entra application proxy / Azure App Service | Microsoft sign-in page once, then straight in |
| **C. Tool passwords** | Quick start, or no IT help yet | Browser password prompt |

All three use the same users file and roles. You can mix them, e.g. Windows sign-in for staff
plus one password login for a guest.

### A. Set up Windows sign-in with IIS

1. In Server Manager, add the IIS roles **Web Server** and **Windows Authentication**.
2. Install **URL Rewrite** and **Application Request Routing (ARR)** from Microsoft.
3. IIS Manager → server node → **Application Request Routing Cache** → **Server Proxy Settings** →
   tick **Enable proxy** → Apply.
4. Allow the sign-in header to be set (run once, as administrator):
   ```
   %windir%\system32\inetsrv\appcmd.exe set config -section:system.webServer/rewrite/allowedServerVariables /+"[name='HTTP_X_REMOTE_USER']" /commit:apphost
   ```
5. Create a site (e.g. `estimator.example.local`, HTTPS binding with your certificate) pointing at
   an empty folder, and copy `deploy\web.config` into that folder.
6. Site → **Authentication**: enable **Windows Authentication**, disable **Anonymous Authentication**.
7. Start the estimator on this machine only, trusting the header from IIS:
   ```
   $env:HOST="127.0.0.1"; $env:AUTH_HEADER="X-Remote-User"; $env:USERS_FILE="D:\secure\estimator-users.json"; npm start
   ```
   Keep `HOST=127.0.0.1`: then nobody can reach Node directly and bypass IIS. The header is only
   trusted from this machine (`TRUSTED_PROXY`, default `127.0.0.1,::1`).
8. Check: browse to `https://estimator.example.local/api/me`. You should see your Windows name,
   e.g. `{"user":"MYDOMAIN\\jay","role":"admin",...}`. If you're asked for a password instead, the
   site isn't in the browser's Local intranet zone; ask IT to add it via group policy.

### B. Entra ID

If the tool is published through Entra application proxy with header-based single sign-on, or
hosted behind Azure App Service authentication, the front end passes the signed-in user in a
header. Set `AUTH_HEADER` to that header's name (for App Service it's
`X-MS-CLIENT-PRINCIPAL-NAME`, which carries the user's email), set `TRUSTED_PROXY` to the address
the front end connects from, and list users by email in the users file:
`"alice@example.com": { "role": "admin" }`. IT will need to register the app in Entra.

### C. Tool passwords

Use `password` entries in the users file (section 3) and HTTPS (`TLS_PFX`), as in README.md.

## 3. Users file and roles

`deploy\users.example.json` shows the format:

```json
{
  "MYDOMAIN\\jay":   { "role": "admin" },
  "MYDOMAIN\\priya": { "role": "editor" },
  "MYDOMAIN\\ravi":  {},
  "*":                { "role": "viewer" },
  "pilot-guest":      { "password": "change-me", "role": "viewer" }
}
```

| Role | Can |
|------|-----|
| `viewer` | Open every project, try what-ifs on screen (not saved), copy the summary and status email, export Excel |
| `editor` (default) | Everything a viewer can, plus save changes, log actuals, create, duplicate and delete projects (deletes can be undone) |
| `admin` | Everything an editor can, plus permanent deletes through the API |

- Write Windows names as `DOMAIN\\user` (the backslash is doubled in JSON). Case doesn't matter.
- An entry without a password is a Windows / Entra user; it can't be used with a password.
- `"*"` gives any other signed-in Windows user that role. Leave it out to allow only listed people;
  anyone else is told to ask the tool's owner, and the attempt is logged in `audit.log`.
- Restart the server after editing the file.

## 4. Quick start for pilot users (15 minutes)

Send this to pilot users with the link.

1. **Open** the link. You're signed in automatically (or with the login you were given).
2. **New project**: give it a name, client and start date. Leave the target end date empty to get the
   estimated finish date.
3. **Scope tab**: add a module per functional area: number of test cases, complexity mix, % to
   automate, priority and the date it's available for testing.
4. **Team tab**: add people with role, skill, experience, allocation and planned leave.
5. **Factors tab**: check the framework (new / extend / reuse), CI/CD (new / existing / not needed),
   holidays and the defaults. Change only what you know differs for this project.
6. **Summary tab**: finish date, effort, scope that fits and team needed. **Copy summary** for an
   email or Teams. **Schedule tab**: phases, who does what each week, month calendar.
7. Once the estimate is agreed: **Tracking tab → Freeze baseline**.
8. Every week: **Log next week**, enter per-module counts and hours, then copy the **status email**.

Tips: several people can edit at once; if two of you change the same field, the second is asked
which value to keep. Deleted projects and weeks can be restored from **Deleted** in the header.

## 5. What to try in the pilot

Ask each pilot team to do at least these:

| # | Scenario | What it checks |
|---|----------|----------------|
| 1 | Re-estimate a project that's already finished, using what was known at its start | Accuracy against real actuals |
| 2 | Estimate a live bid or new project, and compare with the estimate made the usual way | Usefulness for real decisions |
| 3 | Set a target date that's too tight and use the "how many people" and "what fits" answers | Staffing and scope advice |
| 4 | Track a live project for 3+ weeks and send the status email to the internal team | Tracking and email quality |
| 5 | Two people edit the same project at the same time | Collaboration and merges |
| 6 | Export to Excel and share with a lead who doesn't use the tool | Export usefulness |

## 6. Feedback to collect

Collect after weeks 1 and 3 (a short form or a 20-minute call).

**Accuracy**
- [ ] For scenario 1: estimated vs actual effort, and estimated vs actual finish date (record both).
- [ ] Which default factors did you change, from what to what, and why?
- [ ] Does the schedule (framework first, then common methods, then scripting) match how projects really run?

**Usefulness**
- [ ] Time taken to produce an estimate with the tool vs the usual way.
- [ ] Would you send the summary or status email to a client as is? If not, what did you change?
- [ ] What's missing that stopped you using it for a real decision?

**Ease of use**
- [ ] Anything confusing or hard to find? (Screenshot and tab name.)
- [ ] Any wrong-looking numbers? (Project name, tab, what you expected.)

**Rating** (1–5): accuracy, speed, clarity, would recommend to another team.

## 7. Calibrating the defaults

Scenario 1 results are the most valuable output of the pilot. For each finished project
re-estimated, record per complexity level: test cases, actual design / execution / scripting
hours. With three or more projects, the per-test-case hours on the Factors tab can be set to
your organisation's own figures instead of industry defaults.

## 8. Exit criteria (suggested)

- Re-estimates of finished projects within ±20% of actual effort for most projects.
- Pilot users rate accuracy and clarity 4 or higher on average.
- No data loss, and no blocking bugs open.
- Decision: roll out to all delivery teams, extend the pilot, or change course.
