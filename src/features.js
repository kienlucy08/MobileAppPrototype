// Every feature anyone has asked for, in one list, and where each one lands. features.html renders it; the ClickUp tasks
// for the MVP are written from the `mvp` rows. Nothing outside the `mvp` placement is a commitment.
//
// place:  mvp    = committed, ships in the MVP (Phase 1)
//         p2     = Phase 2, team-ready (sharing, assignment, roles) — agreed order, not yet scheduled to a sprint
//         p3     = Phase 3, review layer — additive, being pitched, not decided
//         later  = wanted, no phase yet
//         cand   = surfaced in a session, explicitly undecided
// proto:  built | sim (logic real, platform piece needs the native build) | blocked | no   — status in this web prototype

export const PLACES = {
  mvp: { label: 'MVP · Phase 1', tone: 'mvp', blurb: 'Committed. Stands alone: the app ships with only these.' },
  p2: { label: 'Phase 2 · Team-ready', tone: 'p2', blurb: 'Second wave: sharing, assigning, roles. Agreed order of work.' },
  p3: { label: 'Phase 3 · Review layer', tone: 'p3', blurb: 'Additive layer on top of sharing. Optional by default. Being pitched, not decided.' },
  later: { label: 'Later', tone: 'later', blurb: 'Valid, no phase yet.' },
  cand: { label: 'Candidate', tone: 'cand', blurb: 'Raised in a session. Not decided.' },
};

const S1 = 'Survey123 pain points', F1 = 'Feedback session #1 · Oct 23', F2 = 'Feedback session #2 · Oct 30', SP = 'MVP plan', CK = 'ClickUp roadmap notes';

export const FEATURES = [
  // ───────────────────────────── MVP (Phase 1) ─────────────────────────────
  { id: 'M1', place: 'mvp', group: 'Never lose data', title: 'Save everything on the phone first', detail: 'Answers, photos, queue and log are written locally before any upload. Kill the app mid-upload, reopen: nothing lost.', src: S1, proto: 'built' },
  { id: 'M2', place: 'mvp', group: 'Never lose data', title: 'Complete a whole survey with no signal', detail: 'Airplane mode from start to Submit. The record waits in the outbox and sends when signal returns.', src: S1, proto: 'built' },
  { id: 'M3', place: 'mvp', group: 'Never lose data', title: 'Resumable upload that never duplicates', detail: 'Begin → put photo ×N → commit. Replay any step and the server still holds one record and one copy of each photo. Per-photo retry with backoff; if service drops at photo 83 of 400 it resumes at 84.', src: S1, proto: 'built' },
  { id: 'M4', place: 'mvp', group: 'Never lose data', title: 'Server check at the end; send one record at a time', detail: 'The server re-requests any missing photo at commit. “Send now” on one record never touches another (Survey123’s “send all” cannot do this).', src: S1, proto: 'built' },
  { id: 'M5', place: 'mvp', group: 'Never lose data', title: 'Visible offline queue: count, Upload All, queued items shown distinctly', detail: 'The pattern crews already know from TrackFacts: photos captured offline are greyed out (not green or red) with a count, then one “Upload All” when service is good.', src: F2, proto: 'no', note: 'Outbox with per-photo states exists; the queue count and Upload All button are not in the prototype yet.' },
  { id: 'M6', place: 'mvp', group: 'Never lose data', title: 'Background upload when the app is not in front', detail: 'Upload continues while the phone is locked or another app is open. Needs the native build (iOS background URLSession, Android WorkManager).', src: SP, proto: 'sim' },
  { id: 'M7', place: 'mvp', group: '400–500 photos', title: 'Photo pipeline that never freezes', detail: 'Resize on the device, process two at a time, 96 px thumbnails, flat memory. 400 photos: 305 MB → 93 MB with no long tasks (desktop measurement; to be re-run on real phones).', src: S1, proto: 'built' },
  { id: 'M8', place: 'mvp', group: '400–500 photos', title: 'Accept every kind of image', detail: 'Camera, gallery, file and screenshot are treated identically. Missing GPS or time is flagged, never fatal. Photo-library import stays supported.', src: `${S1}; ${F2}`, proto: 'built' },
  { id: 'M9', place: 'mvp', group: 'Camera', title: 'Camera with zoom 0.5× to about 10×, no photo degradation', detail: 'Native camera API: every lens including 0.5× ultra-wide, native quality, no in-app re-encoding. Original-quality mode skips the resize.', src: `${F1}; ${F2} (reconfirmed)`, proto: 'sim', note: 'The prototype camera popup is simulated; the real 0.5× lens needs the native build.' },
  { id: 'M10', place: 'mvp', group: 'Camera', title: '0.5× is the opening zoom for wide-shot prompts', detail: 'A photo question can set its default zoom (“Photo of full tower, front” opens at 0.5×) so the crew does not have to step back.', src: F1, proto: 'built' },
  { id: 'M11', place: 'mvp', group: 'Camera', title: 'Take several photos in one go (burst)', detail: 'Burst mode takes a run of photos with one tap instead of one tap per photo.', src: 'Lucy (prototype review)', proto: 'sim' },
  { id: 'M12', place: 'mvp', group: 'Errors you can act on', title: 'Coded errors with a plain explanation and a fix', detail: 'A fixed catalog (ERR-NET-001, ERR-IMG-001…): what happened, likely cause, fix button. No screen ever says “unknown error”.', src: S1, proto: 'built' },
  { id: 'M13', place: 'mvp', group: 'Errors you can act on', title: 'Check everything before submit', detail: 'Required answers, constraints, photo min/max and relevance are validated on the phone, before the network is touched.', src: S1, proto: 'built' },
  { id: 'M14', place: 'mvp', group: 'Errors you can act on', title: 'Go to the problem: quick edit from a failed send', detail: 'A failed record has a button that opens it at the exact question, with the failing photo flagged and a Replace button. Photos already delivered stay delivered.', src: 'Lucy (prototype review)', proto: 'built' },
  { id: 'M15', place: 'mvp', group: 'Errors you can act on', title: 'Sync log, Health screen and one-tap “Send to dev team”', detail: 'A support person sees pending, failed, retries, queue and storage in five seconds. One tap sends the log, queue state, device and record; works offline and sends when signal returns.', src: S1, proto: 'built' },
  { id: 'M16', place: 'mvp', group: 'Surveys', title: 'Surveys from JSON and imported Survey123 XLSForm files', detail: 'Pages, skip logic, repeats, signatures, calculations, photo rules. The real CONS-MOD Prework form (65 questions) imports with no warnings. No form editor, by design.', src: SP, proto: 'built' },
  { id: 'M17', place: 'mvp', group: 'Surveys', title: 'Form version lock', detail: 'A record keeps the form version it was started on. Sending a stale one gives ERR-SYNC-001 and the record is preserved.', src: SP, proto: 'built' },
  { id: 'M18', place: 'mvp', group: 'Surveys', title: 'Status-first home and survey library by scope of work', detail: 'Opens on what is saved and what needs sending. Tiles grouped by scope (CONS-MOD, Inspections, COP…); the app asks which scope today.', src: 'Lucy (many surveys per account)', proto: 'built' },
  { id: 'M19', place: 'mvp', group: 'Prove it', title: 'Real-phone test: 400 photos on three phones', detail: 'Recent iPhone, mid-range Android, old Android, weak cellular. Record compression time, battery, memory, heat and upload completion. This is the MVP exit gate.', src: SP, proto: 'no' },

  // Backend halves of MVP items (server and API). The matching app-side item is named in each row.
  { id: 'B1', place: 'mvp', group: 'Backend', title: 'Idempotent upload API: begin, put photo, commit', detail: 'Replaying any step leaves one record and one copy of each photo; commit is idempotent. Pairs with M3.', src: S1, proto: 'built' },
  { id: 'B2', place: 'mvp', group: 'Backend', title: 'Accept native-quality photos and verify declared size', detail: '30 MB per-photo limit; the phone declares each size and the server checks the larger of declared and received (ERR-IMG-001). Pairs with M9.', src: `${F1}; ${F2}`, proto: 'built' },
  { id: 'B3', place: 'mvp', group: 'Backend', title: 'Coded error responses (ERR-*) for every failure', detail: 'Every rejection carries a catalog code and a precise detail. Pairs with M12.', src: S1, proto: 'built' },
  { id: 'B4', place: 'mvp', group: 'Backend', title: 'Accept a resend of an unfinished record', detail: 'After a failed photo is replaced, the same record is refreshed and completed without a duplicate. Pairs with M14.', src: 'Lucy (prototype review)', proto: 'built' },
  { id: 'B5', place: 'mvp', group: 'Backend', title: 'Reports API and dev-team console', detail: 'Receives the one-tap report (including ones queued offline) and shows reports, records, photos and form versions. Pairs with M15.', src: S1, proto: 'built' },
  { id: 'B6', place: 'mvp', group: 'Backend', title: 'Publish surveys to phones with scope of work', detail: 'Versioned surveys with a scope, cached on phones. Per-user access needs the web app permissions. Pairs with M16 and M18.', src: 'Lucy (many surveys per account)', proto: 'built' },

  // ───────────────────────────── Phase 2: team-ready ─────────────────────────────
  { id: 'T1', place: 'p2', group: 'Sharing', title: 'Share an in-progress survey with a lead or PM', detail: 'Read-only look at photos and values while the crew is still on site. Gives reviewers visibility without any feedback feature.', src: F2, proto: 'built' },
  { id: 'T2', place: 'p2', group: 'Sharing', title: 'Team surveys: several people on one record', detail: 'Everyone edits from their own phone; different fields merge, same field converges; works offline. Data is no longer tied to one account.', src: S1, proto: 'built' },
  { id: 'T3', place: 'p2', group: 'Sharing', title: 'Draft, share and partial submit', detail: 'A draft shared before final submission, e.g. a sub sends 50 of 200 photos for a spot check and carries on.', src: F1, proto: 'built' },
  { id: 'T4', place: 'p2', group: 'Assignment and roles', title: 'Assign surveys to people; roles that mirror the web app', detail: 'A PM or foreman assigns a survey or scope to a crew member; the assignee sees a queue (assigned / in progress / submitted). Permissions follow the FieldSync web app.', src: `${F1}; ${F2}`, proto: 'built', note: 'Prototype has crew member / lead / PM. Per-user survey access still needs the web app permissions.' },
  { id: 'T5', place: 'p2', group: 'Assignment and roles', title: 'Real sign-in on FieldSync accounts', detail: 'Same Microsoft or username-and-password login as the web app, organization chosen at the end of the form.', src: SP, proto: 'sim', note: 'Open: how long to stay signed in (never until app update vs 30 or 60 days with remote revoke).' },
  { id: 'T6', place: 'p2', group: 'Assignment and roles', title: 'Crew lead is the one who submits', detail: 'Optional setting: one person owns Submit; everyone else adds photos and data.', src: F1, proto: 'built' },
  { id: 'T7', place: 'p2', group: 'Accountability', title: 'Per-contributor attribution', detail: 'Every answer, entry and photo is credited to the person who captured it, so coaching can be targeted.', src: `${F1}; ${F2}`, proto: 'built' },
  { id: 'T8', place: 'p2', group: 'Accountability', title: 'Error reports that also notify the foreman or PM', detail: 'A structured report (what failed, which record, which device, which step) reaches the foreman, not just the dev team.', src: F1, proto: 'built' },
  { id: 'T9', place: 'p2', group: 'Accountability', title: 'Crash reporting', detail: 'Native crashes and ANRs arrive with a stack trace.', src: SP, proto: 'built' },
  { id: 'T10', place: 'p2', group: 'Site data', title: 'Field calculations (guy facilities, guy wires)', detail: 'Equations run inside the survey using weather and structure data, so problems are caught on site.', src: SP, proto: 'blocked', note: 'The real equations and test cases still have to be written. Weather can arrive late offline: show “pending”.' },
  { id: 'T11', place: 'p2', group: 'Site data', title: 'Web app view of Collect records', detail: 'Records, who contributed what, photos and status visible in the FieldSync web app.', src: SP, proto: 'sim' },

  // ───────────────────────────── Phase 3: review layer ─────────────────────────────
  { id: 'R1', place: 'p3', group: 'Review', title: 'Reviewer role: thumbs up / down on each photo, with an optional comment', detail: 'A higher role (PM level) tied to the role system. A rejected photo turns red on the crew’s phone; they open it and read the comment.', src: F2, proto: 'no' },
  { id: 'R2', place: 'p3', group: 'Review', title: 'Quick reason codes for the common rejections', detail: 'Wrong subject · move closer · move farther · wrong angle · glare or too dark · blurry · label missing. Most flags are “take it again from here”, not “bad photo”, so one tap covers it and a comment is only for the unusual case.', src: `${F2}; Lucy`, proto: 'no' },
  { id: 'R3', place: 'p3', group: 'Review', title: 'Review while the crew is still on the tower', detail: 'Crews tell the office when closeout starts; the first batch is reviewed while the rest is finished. One round, a second is optional. Goal: no return trip.', src: F2, proto: 'no' },
  { id: 'R4', place: 'p3', group: 'Review', title: 'Asynchronous review that syncs when signal returns', detail: 'Not live chat. Reviewer marks reach the crew’s phone when it has reception, like the offline queue crews already accept.', src: F2, proto: 'no', note: 'To assess alongside the offline sync design (Michael Kabatek).' },
  { id: 'R5', place: 'p3', group: 'Review', title: 'Fix from the flag: tap a red photo, retake or replace', detail: 'Reuses “Go to the problem”: the flagged photo opens with Replace and the camera at the suggested zoom.', src: 'Lucy', proto: 'no' },
  { id: 'R6', place: 'p3', group: 'Review', title: 'Optional by default; mandatory for sub users', detail: 'Internal crews that know the standard are not reviewed; the lead can spot-check. For subs and new users review is required (T-Mobile: MTS reviews sub work before it goes to the client).', src: F2, proto: 'no', note: 'Open: who counts as a sub user (MTS org, separate org, invited guest).' },
  { id: 'R7', place: 'p3', group: 'Review', title: 'Review states: Draft → In review → Changes requested → Approved → Submitted', detail: 'A visible status on each record and on each photo.', src: `${SP}`, proto: 'no', note: 'Open: is review a gate that blocks submit, or a status that does not?' },
  { id: 'R8', place: 'p3', group: 'Review', title: 'Reviewer notifications', detail: 'Reviewer is told when a batch is ready; crew is told when something is flagged.', src: CK, proto: 'no' },
  { id: 'R9', place: 'p3', group: 'Review', title: 'Reviewer edits with a log', detail: 'A reviewer can fix a value, and the change is recorded.', src: CK, proto: 'no' },

  // ───────────────────────────── Candidates (raised, undecided) ─────────────────────────────
  { id: 'C1', place: 'cand', group: 'Review', title: 'Flag values (typos) as well as photos', detail: 'Someone can fat-finger a number, not just take a bad photo. Mark’s examples were photos, labeling and colour coding.', src: F2, proto: 'no', note: 'Define the review unit first: photo, field or section.' },
  { id: 'C2', place: 'cand', group: 'Review', title: 'Required-photo checklist with per-item status', detail: 'Each required photo checked off, with distinct states: queued (grey), uploaded, approved, rejected.', src: F2, proto: 'no', note: 'Not decided whether the survey view shows it.' },
  { id: 'C3', place: 'cand', group: 'Capture', title: 'Photo-first capture: shoot first, sort into questions after', detail: 'Built to compare with form-first capture.', src: 'Lucy (UX question)', proto: 'sim' },
  { id: 'C4', place: 'cand', group: 'Capture', title: 'DSLR / SD-card photo import', detail: 'Mark’s crews use phones; cameras were the older process and may linger in some divisions.', src: F2, proto: 'no', note: 'Lucy to check which divisions still use them.' },

  // ───────────────────────────── Later ─────────────────────────────
  { id: 'L1', place: 'later', group: 'Capture', title: 'Thermal management: pace upload when the phone runs hot', detail: 'Show “Upload paused — cooling down” instead of leaving the crew guessing. Survey123 overheats under heavy photo load.', src: F1, proto: 'no' },
  { id: 'L2', place: 'later', group: 'Offline', title: 'Offline phone-to-phone sync', detail: 'Phones with no signal sync directly (Nearby Connections on Android, Multipeer on iOS). Simulated in the prototype.', src: 'Deck (“later”)', proto: 'sim' },
  { id: 'L3', place: 'later', group: 'Offline', title: 'Push notifications instead of polling', detail: 'Instant updates and better battery.', src: SP, proto: 'no' },
  { id: 'L4', place: 'later', group: 'After the pilot', title: 'Edit a submitted record from the field', detail: 'Survey123 cannot edit attachments after submission.', src: SP, proto: 'no' },
  { id: 'L5', place: 'later', group: 'After the pilot', title: 'Exports (CSV, GeoJSON, ArcGIS) and admin dashboard for form designers', detail: '', src: SP, proto: 'no' },
  { id: 'L6', place: 'later', group: 'After the pilot', title: 'PIN or biometric lock; remote wipe of a lost phone', detail: '', src: SP, proto: 'no' },
  { id: 'L7', place: 'later', group: 'After the pilot', title: 'Map for location questions; GPS accuracy gating; weather on submit', detail: '', src: SP, proto: 'no' },
  { id: 'L8', place: 'later', group: 'After the pilot', title: 'Visual form editor; same-field conflict screen; audit trail per answer; failure analytics', detail: '', src: SP, proto: 'no' },
];

/** Which build track an MVP item belongs to (matches the ClickUp groups under Survey Mobile App → MVP). */
export const SIDES = { frontend: 'Frontend · mobile app', backend: 'Backend · server and API', native: 'Native build · platform pieces', validation: 'Validation · exit gate' };
const SIDE = { M4: 'backend', M17: 'backend', M6: 'native', M9: 'native', M19: 'validation' };
for (const f of FEATURES) if (f.place === 'mvp') f.side = SIDE[f.id] || (f.id[0] === 'B' ? 'backend' : 'frontend');

/** Questions from the Oct 30 session that decide where review lands. */
export const OPEN_QUESTIONS = [
  ['What exactly does Mike object to: live feedback, or any reviewer feedback?', 'Lucy to ask at the planning meeting, week of Nov 2. If it is live chat only, asynchronous review may be acceptable.'],
  ['Is review a gate that blocks final submission, or a status that does not?', 'The ClickUp text says it blocks; Mark described TrackFacts marking photos red and letting the crew fix them. Needs a decision, especially for offline.'],
  ['Can asynchronous marks sync after the fact when reception returns?', 'Michael Kabatek to assess with the offline sync design.'],
  ['Who counts as a sub user, and how are they set up?', 'MTS org member, separate org, or invited guest. Affects roles, permissions and licensing.'],
  ['Until the app has review, does T-Mobile sub review stay in TrackFacts?', 'Not discussed. Confirm with Mark for rollout planning.'],
  ['Should values be reviewable, or only photos?', 'Define the review unit (photo, field, section) before design.'],
  ['Which divisions still use cameras and SD cards?', 'Lucy to check so photo-import requirements are right.'],
];
