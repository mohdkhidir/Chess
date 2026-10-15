# BioMed AMS — biomedical equipment asset management

A maintenance management system (CMMS) for biomedical equipment in Malaysian hospitals.
It runs as an **Android app**, in a **web browser**, and on a **hospital server** that every phone
and PC connects to. The same code and the same database format are used everywhere.

| Requirement | Where it is |
|---|---|
| Asset registration with generated tag number | Register asset → tag from a configurable format (e.g. `HDS/INF/2026/00012`, or government style `KKM/HDS/H/26/00012`), QR label PDF (24 per A4 sheet) |
| Asset masterlist with location / service department | Asset masterlist: search, filter, CSV import, QR scan to open |
| PPM monitoring plan and PPM masterlist | PPM plans (frequency, checklist, vendor/technician) and the annual PPM masterlist (asset × month planner) |
| Corrective maintenance | Work orders: assign → attend → hold / cost approval → complete (parts, labour, vendor) → verify & close |
| Helpdesk tickets | Wards report faults (scan the tag), engineers convert them to work orders, the reporter confirms the fix and rates the service |
| KPI for work order closure and PPM completion | KPI page and dashboard, plus uptime, response time and on-time closure, by month and department |
| History record | Every asset has a full timeline (registration, transfers, PPM, repairs, approvals); system-wide audit log |
| Reporting | 12 reports, preview on screen, export PDF or CSV (Excel), share from the phone |
| Predictive maintenance | Risk ranking from breakdown history, age, cost and PPM findings; one tap generates predictive inspection jobs |
| Asset lifespan and expenses | Age vs expected life, book value, 5-year replacement plan; spend by department / category / asset / month |
| System settings | Hospital details, tag format, KPI targets, approval matrix, predictive thresholds, backup/restore |
| User registration and level of approval | Self-registration with admin approval, roles, approval levels 1–3, multi-level approvals with skip-level and no self-approval |

## Read this first

- **One phone on its own cannot run a hospital helpdesk.** In *standalone* mode the data lives on that
  phone only — fine for trying the system, a single engineer, or a small unit. Tickets raised on a ward
  phone only reach the biomedical team when everyone connects to the **hospital server**.
- **The debug APK is re-signed on every CI build.** Android refuses to install a build with a different
  signature over an older one, so you must uninstall first — which deletes standalone data. Back up
  (Settings → Data & backup) before every reinstall, or set up release signing (below) once.
- **"Predictive" means statistical prediction from your maintenance records**, not sensor monitoring.
  It is only as good as the breakdowns you record.
- **Not a validated or certified system.** Before using it for real equipment, have your biomedical
  engineering head check the PPM checklists, intervals, KPI definitions and approval rules against
  your hospital policy, the manufacturer's instructions, the Medical Device Act 2012 (Act 737) duties of
  the establishment, and — for government hospitals — the current Treasury asset procedures (KEW.PA).
  Every default here is editable for that reason.
- The repository is **public**. Never commit real hospital data, backups or signing keys.

## Try it on an Android phone

1. Get the APK: open the latest **Actions → BioMed AMS** run for this repository (log in to GitHub),
   download the `BioMedAMS-android-apk` artifact and unzip it — or, after the pull request is merged,
   download the `.apk` from **Releases**.
2. On the phone, open the `.apk`. Android asks you to allow installs from that source the first time.
3. Choose **On this device only → Demo hospital**. Log in with one of the demo accounts shown on the
   login screen (password `demo1234`), e.g. `engineer`, `tech1`, `nurse`, `manager`, `admin`.

Minimum Android version: 7.0 (API 24), with an up-to-date *Android System WebView* from Play Store.

## Run the hospital server

Needs **Node.js 22.13 or newer** (LTS). No database server or other software is required.

```bash
cd biomed-ams
npm ci
npm run build          # builds the web app the server hands out
npm start              # http://<this-pc>:8080
```

or unzip `biomed-ams-server-*.zip` from a release and run `node --disable-warning=ExperimentalWarning server/index.js`.

On first start the console prints a **one-time setup code**. Open the app, enter the hospital name and
code, create the administrator, and type the code. A starter library of 15 departments and 21 equipment
categories with PPM checklists is created.

```
node server/index.js --port 8080 --db D:\biomed\biomed-ams.sqlite    # choose port and database file
node server/index.js --demo                                          # empty database → demo hospital
node server/index.js --reset-password admin                          # forgotten admin password
```

Phones on the same Wi-Fi open `http://<server-ip>:8080` in Chrome, or in the Android app choose
**Connect to hospital server** and enter that address.

Production checklist:

- Put the server behind **HTTPS** (hospital reverse proxy, or e.g. Caddy). Over plain HTTP, browsers block
  the camera, so QR scanning only works inside the Android app; passwords also travel unencrypted.
- **Back up daily**: Settings → Data & backup → *Create backup* (administrators), or copy the result of
  `sqlite3 biomed-ams.sqlite ".backup backup.sqlite"` from a scheduled task. Keep copies off the server.
- Run it as a service (Windows: NSSM or Task Scheduler at start-up; Linux: systemd).
- A phone backup (`.sqlite`) opens directly as the server database: copy it into place while the
  server is stopped to move a standalone pilot onto the server.

## Build the Android app yourself

GitHub Actions builds the APK on every push (`.github/workflows/biomed-ams.yml`). Locally you need
Android Studio (or the Android SDK) and JDK 21:

```bash
npm ci
npm run android:sync           # build web app + copy into android/
cd android && ./gradlew assembleDebug    # or open android/ in Android Studio and press Run
```

**Stable signing (recommended):** create a keystore once and add it as repository secrets; CI then
also produces a signed `BioMedAMS-<version>.apk` that installs over previous versions without losing data.

```bash
keytool -genkeypair -v -keystore biomed-release.jks -alias biomedams -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 biomed-release.jks   # → secret ANDROID_KEYSTORE_BASE64
```

Secrets (GitHub → Settings → Secrets and variables → Actions): `ANDROID_KEYSTORE_BASE64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Keep the `.jks` file safe —
losing it means users must reinstall.

Change the app id (`io.github.mohdkhidir.biomedams`) in `capacitor.config.json` and
`android/app/build.gradle` before publishing under your organisation's name. Icons and splash
screens come from `python3 scripts/make-icons.py`.

## How things are calculated

**Tag numbers** — tokens `{HOSP}` `{CAT}` `{DEPT}` `{YYYY}` `{YY}` `{MM}` `{CLS}` `{SEQ3}`…`{SEQ8}`.
The running number restarts for every distinct prefix, so `{HOSP}/{CAT}/{YYYY}/{SEQ5}` numbers each
category per year. `{CLS}` is `H` (capital asset) at or above the capital threshold in Settings and `I`
below it. Avoid `{DEPT}`: equipment moves, tags should not. Existing tags can be kept when registering
or importing.

**PPM completion %** = PPMs completed ÷ PPMs whose due window has closed or that are done, for PPMs
scheduled in the period. A PPM is due in its scheduled month (+ optional grace days); later is
*completed late*; not done by then is *overdue*. Approved deferrals and cancellations are excluded.

**Work order closure %** = corrective work orders completed or closed ÷ raised in the period.
**On-time closure %** uses the repair targets per priority; **response time** = report → technician
attends, against the response targets per priority (Settings → KPI targets).

**Uptime %** = 1 − breakdown hours ÷ in-service hours, from work orders marked *equipment down*
(overlapping breakdowns are merged).

**Predictive risk** — breakdown rate per asset from its own corrective work orders, blended with its
category (so a new device starts at the category's average), counted only over the period the system
has records for; raised for rising trend, age beyond 70 % of expected life and recent failed PPMs.
P(breakdown within the horizon) uses a Poisson model. The 0–100 score adds clinical criticality / device
class, age, maintenance cost ratio and PPM findings. *Generate inspections* schedules a predictive
(PDM) job for each in-service asset at or above the threshold.

**Lifespan** — age from commissioning (else purchase) date against the asset's or category's expected
life; straight-line book value; replacement cost = purchase cost grown by the inflation rate to the
end-of-life year. *Cost of service ratio* = annualised maintenance spend ÷ fleet purchase value.

**Approvals** — each request needs levels 1…N (Settings → Approval levels; repair cost picks its level
from the RM limits). Users act on the current level if their approval level is at least that high; a
higher approver covers all levels up to their own. Requesters cannot approve their own requests
unless that is switched on. Rejections need a reason.

## Roles

| Role | Typical user | Can |
|---|---|---|
| Administrator | System admin | Everything, incl. users and settings |
| Manager | Head of department, director | Assets, PPM plans, work orders, analytics, master data, audit |
| Biomedical engineer | Engineer / supervisor | Same as manager without audit; verifies and closes work orders |
| Technician | Technician / assistant engineer | Register assets, perform PPM and repairs, reports |
| Clinical user | Nurse, MO | Report faults, follow own department's equipment and tickets |
| Viewer | Auditor, quality officer | Read everything, reports, audit log |

Approval level (0–3) is separate from role and set per user.

## Asset import (CSV)

Columns: `tag_no, name, category_code, department_code, location_code, manufacturer, model,
serial_no, purchase_date, commissioning_date, warranty_end, purchase_cost, po_no, funding, supplier,
mda_reg_no, remarks`. Dates may be `DD/MM/YYYY` or `YYYY-MM-DD`; `RM 7,500.00` is accepted. Download
a template from Asset masterlist → Import CSV.

## Development

```bash
npm ci
npm test             # 15 unit tests: tagging, approvals, PPM, KPI, uptime, predictive, import, roles
npm run start:demo   # API + demo data on :8080
npm run dev          # web app with hot reload on :5173 (talks to :8080, or choose standalone)
```

```
core/     business rules, SQLite schema, KPI/predictive/report engines (plain JS; runs in Node and in the app)
server/   HTTP server: POST /api/rpc/<method>, GET /api/backup, serves web/dist (node:sqlite, no dependencies)
web/      React app (Vite). Standalone mode runs core/ against SQLite compiled to WebAssembly (sql.js)
android/  Capacitor 8 Android project
test/     node:test unit tests
```

Every action is an RPC method in `core/*.js` with its permission check, so the server and the
standalone app enforce identical rules. Each write runs in one SQLite transaction and lands in the
audit log.
