# Field Collect — MVP feature list

Priority order is the reliability promise: **never lose data, never duplicate it, never freeze, and always be able to say exactly what went wrong.**

Status key: **Built** = working in this prototype and tested · **Simulated** = logic is real, the platform piece needs a native build · **Not built**

## 1. Must have (the MVP is not shippable without these)

### A. Never lose data (offline + fault tolerance)
| # | Feature | Acceptance test | Status |
|---|---|---|---|
| A1 | Everything saved on the phone first (answers, photos, queue, log) before any upload | Kill the app mid-upload, reopen: nothing lost, upload resumes | Built (IndexedDB; native build moves photos to files + SQLite) |
| A2 | Full survey completion with no signal | Airplane mode from start to Submit; record sits in outbox, sends later | Built |
| A3 | Idempotent upload protocol: `begin` → `put photo` (×N) → `commit` | Replay any step 1000× — server holds one record, one copy of each photo | Built, 18 automated tests |
| A4 | Per-photo retry with exponential backoff + jitter | Photo 211 fails 5 times: only photo 211 retries, batch continues | Built |
| A5 | "Service down" detection: stop hammering, probe, resume in place | Signal drops at 83/400: pauses at 83, resumes at 84 when back | Built |
| A6 | Server verifies at commit; missing photos re-queued | Delete a photo server-side before commit: it is re-sent, not lost | Built |
| A7 | Schema version lock per record + clear rejection when stale | Publish form v2, send a v1 record → `ERR-SYNC-001`, record preserved/exportable | Built |
| A8 | Send one record at a time (not "send all" like Survey123) | Send Now on record A never touches record B | Built |
| A9 | Upload continues in background when the app is not in front | Switch apps / lock screen for 10 min mid-upload | **Simulated** — needs iOS `URLSession` background + Android WorkManager (native) |

### B. Performance with 400–500 photos
| # | Feature | Target | Measured in prototype* |
|---|---|---|---|
| B1 | On-device resize (≤2048 px) + recompress (≤1.2 MB), EXIF read before it is stripped | No photo >10 MB ever leaves the phone | 400 photos, 305 MB → 93 MB (−69%) |
| B2 | Never block the UI while processing | No main-thread task >50 ms | 0 long tasks across the 400-photo run |
| B3 | Bounded memory (process 2 photos at a time, thumbnails 96 px) | Flat memory regardless of photo count | JS heap ~6 MB |
| B4 | Photos upload while still collecting (team records) | Last photo taken ≈ last photo uploaded | Built |
| B5 | Free the photo files once the server confirms | Storage returns to baseline after delivery | Built |
| B6 | Gallery / camera / file / screenshot treated identically; missing GPS or time is flagged, never fatal | 100% of image types accepted | Built (HEIC depends on browser; native handles it) |
| B7 | Live counters instead of submit-time surprises ("3 of 5 photos") | Shown while collecting | Built |

\* Desktop Chromium, synthetic 3200×2400 photos, simulated network. **Must be re-measured on real mid-range phones** (see §5).

### C. Errors you can act on, and a way to trace them
| # | Feature | Acceptance test | Status |
|---|---|---|---|
| C1 | Fixed catalog of error codes (`ERR-NET-001`, `ERR-IMG-003`, `ERR-SYNC-001`…) with plain explanation, likely cause, and a fix button | No screen ever says "unknown error" | Built (16 codes) |
| C2 | Pre-submit validation on the phone (required, constraints, lengths, photo min/max, relevance) | Catches the field that would have failed on the server, before the network is touched | Built |
| C3 | Per-record sync log and a Health screen (pending, failed, retries, duplicates prevented, queue size, storage, network) | A support person can see the state in 5 seconds | Built |
| C4 | **Send to dev team** in one tap: last 300 log lines, network + queue state, app version, device, record answers and photo states | Report filed with no signal reaches the dev team when signal returns | Built (queued, retried) |
| C5 | Auto-send diagnostics when a record fails (toggle) | A failed record appears in the dev inbox without the user doing anything | Built |
| C6 | Dev-team console: reports (with log), records with photo thumbnails, team surveys, server stats, form-version control | Triage a report without asking the user for anything | Built (`/admin.html`) |
| C7 | Export log / record as a file (works with no signal) | Hand a file to support | Built |
| C8 | Crash reporting (native crashes, ANRs) | Crash arrives with stack trace | **Not built** — add Sentry or Crashlytics in the native build |

### D. Forms from JSON / XLSForm (no form editor)
| # | Feature | Status |
|---|---|---|
| D1 | Survey defined by a JSON document; located validation errors ("pages[2].fields[1].constraint: …") | Built |
| D2 | **Import a Survey123/XLSForm .xlsx** (survey, choices, settings sheets) in the app, offline; every unsupported item reported with its spreadsheet row | Built |
| D3 | Question types: text, integer, decimal, select_one, select_multiple, image, dateTime/date, geopoint, calculate, note, begin/end group (pages), begin/end repeat, start/end/today/username/deviceid | Built |
| D4 | Required, default, relevant (skip logic), constraint + message, calculate (XLSForm expressions: `${x}`, `.`, `count()`, `selected()`, `if()`, `string-length()`, `concat()`, `regex()`…) | Built |
| D5 | Appearances: multiline, minimal (dropdown), compact/horizontal, numbers, hidden, signature pad, new-rear (camera only), single vs multiple photos | Built |
| D6 | Theme from JSON: body font, background, field fill, header/footer colours and font | Built |
| D7 | Unsupported on purpose (reported on import): geotrace/geoshape, audio/video, barcode scan, choice_filter, pulldata, select_one_from_file, calculator widget | Not built |

### E. Share a survey across phones (get people using it immediately)
| # | Feature | Acceptance test | Status |
|---|---|---|---|
| E1 | Start a **team survey**; teammates **Join** it from their own phone | Second phone sees first phone's answers within ~2 s | Built |
| E2 | Everyone edits at once; different fields merge, same field converges to one value on every phone | No overwritten work, no "who saved last" | Built (per-field last-writer-wins) |
| E3 | Repeat entries and photos are add/remove sets | Two people each add guy wires and 100 photos: all present, none overwritten | Built |
| E4 | Works offline: edits queue on the phone and merge on reconnect | Teammate edits for an hour with no signal, then everything merges | Built |
| E5 | Live presence: who is on the record, who is editing which field | "Sam is editing" tag | Built |
| E6 | Per-person photo progress ("Sam's photos 3/12") and submit gated on all photos arrived | Submit blocked until teammates' photos have uploaded | Built |
| E7 | Warn when submitting while a teammate is offline; late edits are folded into the record afterward, never dropped | Forced submit, teammate reconnects: record is **amended**, not lost | Built |
| E8 | Share the form itself: publish a form to the team; phones pick it up | One person imports the XLSForm, everyone gets it | Built |
| E9 | Sign-in, roles, "who may open this record", invite links | Only invited people can join | **Not built** (prototype has names, no auth) |
| E10 | Push notifications / live push instead of 1.2 s polling | Instant updates, lower battery | **Not built** |

## 2. Should have (first release after the pilot)
- Weather / external lookups on submit (§4.5 of the original spec)
- Map appearance for geopoint; GPS accuracy gating
- Admin dashboard for form designers: submissions, exports (CSV, GeoJSON), ArcGIS feature-service export if migration is needed
- Edit a submitted record from the field (Survey123 can't edit attachments in the field app)
- Biometric / PIN lock; remote wipe of a lost phone
- Per-form theme presets and logo

## 3. Later
- Form editor (visual), conflict UI for same-field collisions, SSO / ArcGIS identity, audit trail per answer, analytics on failure rates

## 4. Honest limits of the prototype
- It is a web app. It proves the logic and the experience, **not** background upload or native camera/photo-library behaviour.
- Collaboration merges by **device clock** (hybrid logical clock). A phone with a badly wrong clock can win ties; production should add server-assigned ordering.
- Teammates are identified by name only. No authentication. Do not put real customer data on it.
- Phones on plain `http://` (LAN demo) cannot use GPS — browsers require HTTPS for location. The app falls back to manual coordinates; a hosted build over HTTPS fixes it.
- Server state is a JSON file + photo files on disk. Fine for a pilot, not for scale.

## 5. Next steps to de-risk before building the native app
1. Run the 400-photo test on 3 real phones (a recent iPhone, a mid-range Android, an old Android) over real weak cellular. Record: time to compress, battery, peak memory, dropped frames, upload completion.
2. Decide cross-platform framework (React Native recommended — the engine, validation, expression and sync code here is plain JavaScript and ports).
3. Spec the real API (the five endpoints here are the contract) and pick the backend; evaluate the tus protocol for resumable uploads.
4. Add authentication and per-record membership before any real team uses it.
5. Put your real XLSForm through the importer and review the conversion notes — they list exactly what is not yet supported.

## 6. Your real form: CONS-MOD Prework Inspection (`CONS-MOD Prework Inspection.xlsx`)

The real file imports (89 rows, 6 pages, 65 questions) with **no warnings**, runs in the app, and is covered by `test/consmod.test.mjs`. A full browser run filled every required question, added 14 photos and a signature, and delivered record #1001 with every photo named by your `fileName=` rules.

| What the form uses | How the prototype handles it | Status |
|---|---|---|
| 6 pages (`field-list` groups), nested group heading, repeats (serials, catch-all, flags) | Pages and repeat cards; repeat photos belong to their entry | Built |
| `repeat_count = 2` on the serial log | Exactly two entries, created up front, no add/remove buttons | Built |
| HTML labels (`<h1>`, `<b>`, `<font color>`, `<br>`), orange "LANDSCAPE PHOTOS REQUIRED" callouts | Allow-listed rendering; notes named *reminder* get the orange callout | Built |
| `${customer_label}` inside labels | Labels update live; select answers show their choice label | Built |
| `select_one_from_file customers.csv` + `autocomplete` | Your real `customers.csv` (repo root, 12 customers) is read together with the .xlsx; type-to-search picker | Built |
| `jr:choice-name`, `count-selected`, `format-date`, `Today()`, `if`, `selected`, `concat` | Expression engine | Built |
| Calculated questions (e.g. `structure_owner` pre-fills, editable until inputs change) | Recalculated only when inputs change | Built |
| Per-sector photo questions, required only for selected sectors | `relevant` + required | Built |
| `multiline` images (many) vs single photos; `signature`; `compact-3`; `horizontal-compact` | maxFiles rules; signature pad; compact layouts | Built |
| **Photo file names** from `fileName=` (customer, site id, sector, `_PREWORK_`, count, timestamp) | Renamed on capture; numbered via `count-selected(...)+1` | Built |
| `instance_name` (`customer_siteid`) | Record title in review/outbox | Built |
| `start`, `end`, `username`, `email` | Hidden fields; `end` stamped on submit; `username` and `email` come from the signed-in FieldSync profile | Built |
| `pulldata("@geopoint" / "@json" / "@property")` | Built in | Built |
| **Weather** (`weather.js`) | Never blocks: blank offline, retries, fills in and syncs when service returns. Uses OpenWeather when the form supplies a key (it does), else Open-Meteo | Built |
| **Member lookup** (`validateusers.js`) | Not a separate call any more: the signed-in profile already has first and last name, so `inspection_technician` is filled from it | Built |
| **Organization list** `search(${organization_url})` | From the signed-in user's profile: only organizations they belong to. One org → selected automatically; several → they choose on the last page. Cached on the phone for offline use | Built (against a stand-in identity service) |
| Colour scheme (light-cyan header/footer `#b4f2fe` on `#002832` text, dark body, light inputs `#ebfefb`) | Default theme for imported XLSForms; JSON surveys can set `bodyText`, `inputText`, `inputBackground`, `onPrimary` | Built |

**Security:** the real file contains a live OpenWeather API key (`weather_api_key` default). Because it is a form default, it ends up on every phone, in the local database and in server records, and the app calls OpenWeather with it from the phone. Rotate it, and have the real build proxy weather through your backend. The file is untracked in git — decide deliberately before committing it.

**Quirks worth knowing**
1. Your file-name expression has no separator between the count and the timestamp, so names look like `…assembly_120261008-102709.jpg` (count `1`, then `2026…`). It is reproduced exactly; add a `_` in the sheet if it should be readable.
2. Weather is whatever the lookup returns when it resolves — possibly minutes after the photos, and for the coordinates at that time. Consider re-fetching at submit time on the server.
3. Two phones on one team record photographing the same sector in the same second would get identical names. A short device suffix would prevent it.
4. `customers.csv` must reach phones with no signal — bundle it with the form version or sync it separately. (The organization list is cached after the first online load; a user with no signal *and* no cached list cannot answer that required question.)
5. The identity service here is a stand-in with demo accounts; pointing it at the real FieldSync accounts (Microsoft OIDC + username/password) is the remaining integration.

## 7. Sign-in and identity (decided)

One FieldSync account for everything: the same login as the web app (Microsoft for some users, username + password for others).

| Rule | How it works | Status |
|---|---|---|
| Same credentials as the web app | Sign-in screen with **Sign in with Microsoft** and **username + password**; wrong or unknown accounts get `ERR-AUTH-002` / `ERR-AUTH-003` | Built (Microsoft login simulated; accounts are demo data) |
| Sign in once; never again until the app updates | Session has no expiry; stored `appVersion` differs after an update → sign-in screen again | Built |
| One profile instead of three lookups | username, email, first/last name and organizations come from one call; no separate member lookup or organization query | Built |
| Choose the organization on the last screen | One organization is selected automatically; several → the user picks. Never shows organizations the user is not in | Built |
| Removed user | Their phone's session ends (`ERR-AUTH-001`): the app shows "account removed", lets them export what is still on the phone, and can't submit more. Records already on the server stay, still attributed to the person (name/email stored with the record) | Built |
| Works offline | Profile and organization list are cached after sign-in; the first sign-in needs signal | Built |

**To finish for real:** connect to FieldSync's actual login (Microsoft OIDC token validation; password check against your user store), use real session tokens with revocation, and decide what a phone should do with unsent records when the account is removed *while the phone is offline* (today: they stay on the phone and can be exported).

## 8. Working together with no signal at all (nearby sync)

| Capability | How it works | Status |
|---|---|---|
| Find teammates in range | Phones announce themselves and the team records they hold; each phone sees only titles of records it hasn't joined | Built (simulated radio) |
| Join a record from a nearby phone | Survey + current state transfer directly; the server learns about the record when any member has signal | Built (simulated radio) |
| Edit together, no server | Phones exchange whole record state and apply whatever is newer; only real changes are passed on, so it settles after a few messages and works with 3+ phones | Built (simulated radio) |
| Out of range and back | Edits made apart merge when phones meet again | Built |
| Relay uploads | "Share photos" hands photos to nearby members; whichever phone gets signal first uploads them (and everything it learned from teammates). The server ignores repeats, so a photo is stored once | Built |
| Server catches up from one phone | One phone with signal delivers the whole record, edits and photos, for the whole group | Built (tested) |
| Real Bluetooth / Wi-Fi Direct | Android Nearby Connections + iOS MultipeerConnectivity; the messages above are the protocol to carry | **Not built** — native build |
| Authenticate peers | Only members may exchange a record; edits should be signed with a team key so a stranger's phone cannot inject changes | **Not built** |
| Large photo transfer | Over a hotspot / Wi-Fi Direct is fine; over Bluetooth hundreds of photos is slow, so relay is opt-in per record | Design note |

The radio here is a browser `BroadcastChannel` between tabs: it proves the merge and relay logic with the network off, not radio behaviour (range, battery, pairing prompts).

## 9. A library of many surveys, grouped by scope of work

A Survey123 account holds many surveys, so Home is a **survey library**, not a single survey:

- **Tile gallery** (2 columns, coloured tile + title, search bar). A red badge on a tile counts that survey's drafts.
- **Scope of work**: each survey has a `scope` (CONS-MOD, Inspections, COP, …). Once a day the app asks *"What are you working on today?"* with the scopes and their survey counts, or *Show all surveys*. Chips under the search bar change it any time; team surveys and drafts follow the same filter.
- **Tap a tile** → sheet with *Start survey*, *Start as team survey*, that survey's drafts (resume) and its team records (open / join). Team surveys work exactly as before, per survey.
- **Source of the library**: surveys published to the server arrive whenever there is signal and are cached on the phone, so the library works fully offline. Scope comes from the XLSForm `settings` sheet (`scope` or `tags`), else is inferred from the title (CONS-MOD / COP / inspection), and the dev team can change it in `/admin.html` → *Surveys & scope of work* (phones pick it up on next signal).
- **Demo**: Dev tab → *Load demo library* imports the real CONS-MOD Prework form plus 16 clearly labelled placeholders (7 Inspections, 5 CONS-MOD, 4 COP). Your account has 4 inspection surveys; the placeholder counts are only illustrative and are changed with the scope editor.
- **Still open**: per-user access (which surveys each person may see) is not modelled; every signed-in user currently sees every published survey. Needs the web app's permissions.

## 10. The prototype by build phase (matches the all-hands deck)

`/` is now one tab per phase. Each tab opens the app as `app.html?phase=N`, which shows only the features of that phase, so a developer looking at Phase 1 never meets a Phase 2 feature. `src/phases.js` is the single list of which feature belongs to which phase; the tab text (what is built, simulated, blocked, not built, and what to try) lives in the same file.

| Tab | In the app | Notes |
|---|---|---|
| **Phase 1 · MVP reliability** | Offline store, resumable upload with backoff, 400+ photos, image pipeline, form renderer (JSON/XLSForm), coded errors, health + one-tap report, form version lock, status-first home, survey library by scope | One phone, no teams |
| **Phase 2 · Team-ready** | Everything above plus: team surveys, roles + server-enforced permissions, share/reassign, who-captured-what, "Notify my foreman", crash reports, camera (0.5×/1×/2×, rapid-fire), original photo quality, photo-first, field calculations (guy facilities), web-app records view | Three phones: Maria (crew lead), Sam (crew member), Priya (PM) |
| **Later · Offline team sync** | Nearby sync (simulated radio) | Deck says "offline phone-to-phone later" |

### What the new Phase 2 pieces do
- **Roles** (`member`, `lead`, `pm`) live on the account. The server refuses final submit from a crew member and refuses share/reassign from anyone below a lead (`ERR-AUTH-004`). The app mirrors the rule (disabled button + explanation); the review screen has a demo-only "try anyway" so the server check is visible.
- **Share / reassign**: a team record is visible only to the people it is shared with; a PM sees every site. Removing someone drops the record from their list once their phone syncs; whatever they entered stays on the record, credited to them.
- **Attribution**: answers, repeat entries and photos carry the author's name; shown per record in the app (review screen, team panel) and in the dev-team page.
- **Notify my foreman**: a report can also go to the reporter's foreman (else the crew leads in their organization); it appears under Health → *Reports from your crew*, as well as going to the dev team.
- **Crash reports**: uncaught errors file themselves with the log (capped at 5 per session). Dev tab → *Simulate a crash*.
- **Camera**: real zoom where the browser exposes it; where it does not (and on desktop, where a simulated scene is used) the 0.5× button says it needs the native build. Rapid-fire shooting, one batch at a time.
- **Photo quality**: *Optimized* (2048 px, ≤1.2 MB) or *Original* (the camera's JPEG untouched). Server limit raised to 30 MB per photo.
- **Photo-first** (open UX question #4): shoot or add photos first, then select and move them into questions. Unsorted photos block submit, so none can be silently left behind.
- **Field calculations**: *FS Guy Facilities Inspection* computes wire length, angle and a CHECK flag inside the survey. **The equations are placeholders**; the real ones and their test cases are still blocked.

### Conflicts in the source material (decide before building native)
1. **Photo quality vs upload size.** The deck's headline is "69% smaller uploads" (resize on device); the field feedback says quality loss is a high-severity complaint and asks for native quality with no re-encoding. The prototype offers both; the default is Optimized.
2. **Staying signed in.** Deck decision 12 proposes 30 or 60 days with remote revoke/wipe; the earlier direction was "never re-authenticate unless the app updates", which is what the prototype does.
3. **Personal (non-team) surveys.** Permissions are enforced on team records only. A crew member can still submit their own solo record.

## 11. Click-through demo flows (for screen shares)

Each phase tab has a **Demo flow** card. Numbered steps are narration; a green **▶** button sets up that step for you on the right phone, so the presenter only taps the real app.
- **Phase 1**: build a closeout with a fake 0.5× wide shot and fake 10× close-ups → Save & send → Outbox goes green → cut/restore signal → *error survey* (ERR-FIELD-001/002, ERR-IMG-003 with fix buttons) → *too-big photo* (ERR-IMG-001 in the Outbox, other photos still delivered, Send to dev team).
- **Phase 2**: Maria starts a team record → shares with Sam → Sam joins → Maria adds a 0.5× shot and Sam a 10× shot → who-captured-what, Sam's locked Submit (ERR-AUTH-004) → Sam notifies his foreman → it appears in Maria's Health tab.
- **Later**: both phones offline, nearby join.

The demo pages use a simulated camera (so 0.5× and 10× work on a laptop). Demo surveys *Demo · Closeout photos* and *Demo · Error messages* live under the **Demo** scope. The photo-size error works because a phone declares each photo's size and the server checks the larger of declared and received.

## 12. Guided walkthroughs and "Go to the problem"

- **Guided walkthrough** (top card on the Phase 1 and Phase 2 tabs): *Next step ▶* (or *Play all*) moves a virtual finger through the real app — open the app → choose a scope → pick the survey → fill in the fields (typed for you) → camera popup (0.5× · 1× · 2× · 10× zoom, shutter flash, photo added) → review → Save & send → Outbox shows it delivered. Then a second record whose photo is too big: it fails with `ERR-IMG-001`, *Go to the problem*, replace the photo, send again — the Outbox ends with the failed and the delivered records side by side before the fix. Phase 2 does the same as a team: Maria starts and shares, Sam joins, each takes a photo, Sam's submit is blocked (`ERR-AUTH-004`), Maria submits.
- **Go to the problem**: a failed record in the Outbox has a button that reopens it at the question whose photo failed. That photo is flagged red with its code and a *Replace* button (opens the camera). Photos already delivered stay delivered; resending refreshes the server's list for the unfinished record and completes it without a duplicate.
- The camera popup is simulated in the demo pages. It is part of Phase 1 as an in-app camera; Phase 2 adds the native camera API (real 0.5× lens) and Original quality.

## 13. Every requested feature, and where it lands (Nov 4)

`/features.html` (also linked from the prototype page header) lists everything anyone has asked for, with who asked and the prototype status. Tabs: **All suggested features** · **MVP (standalone)** · **Post-MVP (standalone)** · **By phase**. The data is `src/features.js`.

- **Only the MVP is a commitment.** Order of work from the Oct 30 session: baseline app → sharing and assignment → review layer with roles. Each layer is additive.
- **MVP additions from Oct 30:** visible offline queue with count and Upload All (not built in the prototype yet); native-quality camera and Original photo quality are baseline (moved into the Phase 1 tab).
- **Review is back as a candidate, not a build.** Phase 3 lists the reviewer role, thumbs up/down with optional comment, quick reason codes (wrong subject, closer, farther, angle, glare, blurry), review while the crew is on the tower, asynchronous sync, optional by default and mandatory for subs. The seven open questions are on the Post-MVP tab. The reviewer role and review screens are **not** in the prototype.
- **ClickUp:** 19 MVP subtasks under *Mobile App Planning* (one per MVP row, tag `mvp`), and the parent description reconciled (review is optional and post-MVP, not a retention condition).
