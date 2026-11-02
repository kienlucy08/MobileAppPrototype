# Field Collect — reliability-first survey prototype

A working prototype of a Survey123-style collection app built around **offline reliability, 400–500-photo workflows,
fault-tolerant submission, error tracing, and several phones working on one survey.**
The full feature list (what is built, what is simulated, what is missing) is in [MVP_FEATURES.md](MVP_FEATURES.md).

## Run it

```bash
npm install            # only needed for the spreadsheet sample + tests
npm start              # starts the server and prints the URLs below
```

| URL | What |
|---|---|
| `http://localhost:8123/` | **Prototype by phase**: one tab per build phase (Phase 1 reliability, Phase 2 team-ready, Later), each with its own phones, a feature checklist and a "try this" script. Per-phone network switch and "kill app". |
| `http://localhost:8123/app.html` | The app itself — open this on a real phone (same Wi-Fi) using the LAN address `npm start` prints. |
| `http://localhost:8123/admin.html` | Dev-team console: problem reports with logs, records and photos, team surveys, stats. |

Real phones on the same Wi-Fi can join the same team survey today (the server is real). Note: GPS needs HTTPS, so on plain `http://` the location question uses manual entry.

## Use your own survey

Home is a library of surveys grouped by scope of work (tiles, search, daily "What are you working on today?"). Dev tab → **Load demo library** fills it with the real Prework form plus placeholders.

Dev tab → **Choose .xlsx** (a Survey123 Connect / XLSForm file with `survey`, `choices`, `settings` sheets; select any CSV lists such as `customers.csv` at the same time). **Load CONS-MOD Prework** loads `CONS-MOD Prework Inspection.xlsx` from the repo root and `customers.csv` from the repo root. Sign in with the FieldSync account (demo: `sam` / `demo`, or Microsoft `maria@demo.test`). The organization question lists only the organizations the account belongs to; users and memberships are edited in the dev-team console at `/admin.html`. Everything it can't honour is listed
with its spreadsheet row. **Use + share with team** pushes the form to every phone. Or paste JSON (see `src/sample.js`).
`npm run sample` regenerates `samples/tower-inspection.xlsx`, a Survey123-style example using the question types and appearances from the spec.

## The demo (no-signal teamwork)

On `/`, set two phones to **No service**, tick **Nearby** on both, start a team survey on one and **Join nearby** on the other. Edits merge directly; *Share photos* lets either phone upload them once it gets signal.

## The demo

1. **Team**: on Maria's phone, *Start as team survey*; on Sam's, *Join*. Edit at the same time — answers merge, "Sam is editing" shows, photos from both phones appear tagged by person.
2. Set Sam to **No service**, keep editing, restore: everything merges. Submit is held until Sam's photos have arrived.
3. **400 photos**: Dev tab → *Build demo record* (400 phone-sized JPEGs through the real compression) → *Save & send*. Switch to **Flaky**, then **No service** mid-upload, then restore. It stops in place and resumes; the server ends with exactly 400 photos and one record. Health shows duplicates prevented.
4. **Kill app now** mid-upload: it resumes from the local database.
5. Health → **Report a problem** (or let a failure auto-report): it lands in the dev-team console with the log attached, even if filed with no signal.
6. **Server: require form v+1**, then send an old record → a specific `ERR-SYNC-001`, never "unknown error".

## How it works (files)

| Area | Files |
|---|---|
| Form from JSON / XLSForm | `src/schema.js`, `src/expr.js`, `src/xlsform.js`, `src/form.js` |
| On-device image pipeline | `src/images.js` |
| Local store + upload engine (retry, backoff, resume, no duplicates) | `src/db.js`, `src/queue.js` |
| Multi-phone sync (conflict-free merge, offline queue, presence) | `src/crdt.js`, `src/collab.js` |
| Error catalog, problem reports | `src/errors.js`, `src/reporter.js` |
| Server (transport-free core + HTTP wrapper) + client | `src/serverCore.js`, `server/server.js`, `src/api.js` |
| Survey library (tiles, scopes) | `src/library.js`, `src/demoLibrary.js` |
| UI shell | `src/app.js`, `app.html`, `index.html`, `admin.html`, `styles.css` |

## Tests

```bash
npm test      # 60 tests: upload engine, collaboration against the real HTTP server, XLSForm import, the CONS-MOD form, the survey library
```

They cover 400 photos delivered exactly once; flaky networks (28% dropped requests, 12% lost replies); service lost and restored mid-batch;
app killed mid-upload; two phones editing concurrently, offline, and on flaky links; submit gating on teammates' photos; late edits after submit;
problem reports queued offline; and XLSForm conversion.

## Prototype limits

Web app: it cannot prove iOS/Android background upload. No authentication. Collaboration merges by device clock. Server state is a JSON file.
Details and next steps: [MVP_FEATURES.md](MVP_FEATURES.md).
