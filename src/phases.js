// Which build phase each feature belongs to, taken from the FieldSync Collect plan (all-hands deck).
// The demo page opens the app as `app.html?phase=N`; the app then shows only what exists in that phase, so a developer
// looking at Phase 1 never sees a Phase 2 feature and wonders whether it is in scope. No `phase` parameter = everything.

export const FEATURE_PHASE = {
  // Phase 1 — MVP reliability core (always on): offline store, resumable upload, image pipeline, form renderer, coded errors, health + report
  library: 1,        // survey library, scope of work, status-first home
  // Phase 2 — Team-ready
  team: 2,           // team surveys: share, everyone completes
  roles: 2,          // crew member / lead / PM, enforced by the server
  assign: 2,         // share + reassign
  attribution: 2,    // who captured what
  notify: 2,         // error reports that also notify the foreman or PM
  crash: 2,          // crash reporting
  camera: 1,         // in-app camera popup: zoom steps, rapid-fire (simulated here; native camera API in the real build)
  quality: 1,        // original photo quality (no re-encode): the Oct 30 session reconfirmed "no photo degradation" as baseline
  photofirst: 2,     // photo-first capture exploration
  calcs: 2,          // field calculations (guy facilities)
  // Later
  nearby: 4,         // offline phone-to-phone sync
};

const raw = new URLSearchParams(globalThis.location?.search || '').get('phase');
export const PHASE = raw ? Number(raw) : 99;
export const has = (feature, phase = PHASE) => (FEATURE_PHASE[feature] ?? 1) <= phase;

export const STATUS = {
  built: 'Built',
  sim: 'Simulated in the web prototype',
  blocked: 'Blocked — needs input',
  no: 'Not in the prototype',
};

/** Content of each phase tab on the demo page. `phones` = who is signed in on each phone. */
export const PHASES = [
  {
    id: 1, tab: 'Phase 1 · MVP reliability', dates: 'Jan 4 – Feb 12', exit: '400 photos delivered on 3 real phones.',
    blurb: 'Prove the one promise Survey123 breaks: nothing is ever lost, 400+ photos stay fast, every failure explains itself. One person, one phone — no teams yet.',
    phones: [['maria', 'Maria', 'microsoft:maria@demo.test']],
    features: [
      ['Offline-first local store', 'built', 'Everything is written to the phone first; airplane mode works.'],
      ['Resumable per-item upload with backoff', 'built', 'Per-photo retry, resumes where it dropped, never sends a photo twice.'],
      ['On-device image pipeline', 'built', 'Resize + EXIF kept, screenshots and gallery files accepted like camera shots.'],
      ['JSON / XLSForm form renderer', 'built', 'Real CONS-MOD Prework imports with 0 warnings. No form editor, by design.'],
      ['Coded, fixable validation errors', 'built', 'Checked before anything touches the network.'],
      ['Sync log, health screen, one-tap send to dev team', 'built', 'Reports queue offline; the log is attached automatically.'],
      ['Form version lock + backend with dedupe', 'built', 'Old forms are rejected with ERR-SYNC-001; duplicates are counted, not stored.'],
      ['Camera popup with zoom steps and quick-fix for failed photos', 'sim', 'Simulated camera (0.5× · 1× · 2× · 10×), shutter, photo added. A failed send has “Go to the problem” → the flagged photo → Replace.'],
      ['Original photo quality (no re-encode) and burst shooting', 'built', 'Health → Photo quality: Optimized (small) or Original (as the camera wrote it). Burst takes 5 photos in one tap.'],
      ['Status-first opening screen + survey library', 'built', 'Saved state, resume card, tiles grouped by scope of work.'],
      ['Real-phone test on three devices', 'no', 'Web prototype only: proves the logic, not iOS/Android background upload or real-phone performance.'],
    ],
    guide: [
      ['maria', 'open', 'Open the app'], ['maria', 'scope', 'Choose a scope of work'], ['maria', 'pick', 'Pick the survey'], ['maria', 'start', 'Start the survey'],
      ['maria', 'fill', 'Fill in the site details'], ['maria', 'camera', 'Open the camera (opens at 0.5×)'], ['maria', 'zoomdemo', 'Show the zoom: 1× · 2× · 10× · 0.5×'], ['maria', 'shoot', 'Take the wide photo'],
      ['maria', 'closeup', 'Close-ups at 10× and 2×'], ['maria', 'review', 'Review'], ['maria', 'send', 'Save & send'], ['maria', 'delivered', 'Delivered — good to go'],
      ['maria', 'second', 'Start a second survey'], ['maria', 'shots2', 'Take its photos'], ['maria', 'bigphoto', '…one photo is too big'], ['maria', 'send2', 'Save & send → it fails'],
      ['maria', 'goto', 'Go to the problem'], ['maria', 'replace', 'Replace the photo'], ['maria', 'resend', 'Review and send again'],
    ],
    flow: [
      { say: 'Open the survey library. Tiles are grouped by scope of work; the status card shows everything is saved on the phone.' },
      { say: 'Set up a closeout with a <b>fake 0.5× wide shot</b> and a <b>fake 10× close-up</b> — the review screen shows the photos and what resizing saved.', phone: 'maria', do: 'closeout', label: 'Build closeout with 0.5× + 10× photos' },
      { say: 'Tap <b>Save &amp; send</b>, then <b>Outbox</b>: each photo is a square in the grid and turns green as the server confirms it.' },
      { say: 'Cut the signal mid-upload and watch it stop in place. Restore it and it resumes — no photo is sent twice.', phone: 'maria', net: 'offline', label: 'No service' },
      { say: '', phone: 'maria', net: 'good', label: 'Restore signal' },
      { say: '<b>Error workflow 1 — the crew mistakes.</b> A blank required answer, a bad height and too few photos each get a code and a fix button before anything is sent.', phone: 'maria', do: 'errors', label: 'Open the error survey' },
      { say: '<b>Error workflow 2 — a failed upload.</b> One photo is too big. Tap <b>Save &amp; send</b>; the Outbox shows <b>ERR-IMG-001</b> in plain language, the other photos still arrive, and <b>Send to dev team</b> files the report with the log.', phone: 'maria', do: 'oversized', label: 'Build closeout with a too-big photo' },
      { say: 'Open the dev-team view on the right: the report is there with the log attached.' },
    ],
  },
  {
    id: 2, tab: 'Phase 2 · Team-ready', dates: 'Feb 1 – Mar 12', exit: 'A real crew runs a pilot job.',
    blurb: 'A crew works one survey from their own phones. Everyone is on their own FieldSync account, entries are credited to the person who made them, and problems reach the foreman — not just the dev team.',
    phones: [['maria', 'Maria · crew lead', 'microsoft:maria@demo.test'], ['sam', 'Sam · crew member', 'password:sam:demo'], ['priya', 'Priya · PM', 'microsoft:priya@demo.test']],
    features: [
      ['Real sign-in on FieldSync accounts', 'sim', 'Same Microsoft / username-password accounts as the web app; the identity service is a stand-in.'],
      ['Shared surveys: share, everyone completes', 'built', 'Edits merge conflict-free; offline edits merge when the phone reconnects.'],
      ['Roles and permissions', 'built', 'Crew member / lead / PM. Server enforces who can submit and share (ERR-AUTH-004).'],
      ['Assign, share and reassign', 'built', 'A lead hands the survey to a teammate; it leaves the previous person’s list once their phone syncs, their entries stay credited to them.'],
      ['Per-contributor attribution', 'built', 'Every answer, repeat entry and photo is credited to the person who captured it.'],
      ['Error reports that also notify the foreman or PM', 'built', 'Health → “Notify my foreman”. It shows up in the foreman’s app.'],
      ['Crash reporting', 'built', 'Uncaught errors file themselves (with the log) to the dev team.'],
            ['Photo-first capture (open UX question)', 'sim', 'Shoot freely, sort into survey sections after. Built to compare with form-first.'],
      ['Field calculations (guy facilities, plumb & twist)', 'sim', 'Cable length uses the real formula. Tension limits and twist are placeholders for the devs to replace.'],
      ['Pull guy heights from the structure survey', 'sim', 'Same site, this phone first then the server; type them or let the web app process if unavailable. Inspections show a Site visit card.'],
      ['Site data package', 'no', 'Needs the web app’s site data.'],
      ['Web app view of Collect records', 'sim', 'The dev-team page shows every record, who contributed what, photos and status.'],
    ],
    guide: [
      ['maria', 't_open', 'Maria opens the app and picks the survey'], ['maria', 't_team', 'Start it as a team survey'], ['maria', 't_fill', 'Fill in the site details'], ['maria', 't_share', 'Share it with Sam'],
      ['sam', 't_join', 'Sam joins from his phone'], ['sam', 't_sam_photo', 'Sam takes a 10× close-up'], ['maria', 't_maria_photo', 'Maria takes the 0.5× wide shot'],
      ['sam', 't_sam_blocked', 'Sam tries to submit → blocked (ERR-AUTH-004)'], ['maria', 't_submit', 'Maria reviews and submits → delivered'],
    ],
    flow: [
      { say: '<b>Maria (crew lead)</b> starts a team record for the site, answers filled in.', phone: 'maria', do: 'team', label: 'Start team record' },
      { say: 'She shares it with Sam. (Tap <b>People</b> to do this by hand.)', phone: 'maria', do: 'share', label: 'Share with Sam' },
      { say: '<b>Sam (crew member)</b>: Surveys → team record → <b>Join</b>. Maria’s answers appear on his phone.' },
      { say: 'Maria adds a <b>fake 0.5× wide shot</b>…', phone: 'maria', do: 'teamPhoto', args: [0.5], label: 'Maria: add 0.5× photo' },
      { say: '…and Sam adds a <b>fake 10× close-up</b> from his own phone.', phone: 'sam', do: 'teamPhoto', args: [10], label: 'Sam: add 10× photo' },
      { say: 'On Sam’s review screen see <b>Who captured what</b> — and the Submit button is locked: only a crew lead submits (<code>ERR-AUTH-004</code> from the server if he tries anyway).' },
      { say: 'Sam hits a problem and taps <b>Notify my foreman</b>.', phone: 'sam', do: 'notify', label: 'Sam: notify foreman' },
      { say: 'Maria’s <b>Health</b> tab → <b>Reports from your crew</b>. The dev-team view has it too.' },
      { say: 'Maria opens the record → Review → <b>Submit team record</b> → Outbox. Dev-team view shows who captured what.' },
      { say: 'Priya (PM) sees every site in her list; Sam only sees what is shared with him. Try <b>People → Remove</b> on Sam.' },
    ],
  },
  {
    id: 4, tab: 'Later · Offline team sync', dates: 'After the pilot', exit: 'Decided after the pilot.',
    blurb: 'Not in the MVP plan (“offline phone-to-phone later”), but prototyped so the idea can be judged: two phones with no signal at all sync directly. The web prototype simulates the radio; native would use Nearby Connections (Android) and Multipeer (iOS).',
    phones: [['maria', 'Maria · crew lead', 'microsoft:maria@demo.test'], ['sam', 'Sam · crew member', 'password:sam:demo']],
    features: [
      ['Nearby sync with no signal', 'sim', 'Simulated radio between the two phones on this page.'],
      ['Photo relay: whoever gets signal first uploads', 'sim', ''],
      ['Remote wipe of lost phones', 'no', 'Phase 4 in the plan.'],
      ['Thermal-aware uploads', 'no', 'Backlog idea.'],
      ['Crew lead accountability mode', 'no', 'Backlog idea (the permissions model already limits submit to leads).'],
    ],
    flow: [
      { say: 'Cut both phones off: <b>No service</b>, then tick <b>Nearby</b> on both.', phone: 'maria', net: 'offline', label: 'Maria: No service' },
      { say: '', phone: 'sam', net: 'offline', label: 'Sam: No service' },
      { say: 'Maria starts a team record. Sam’s phone offers it under <b>Nearby sync → Join nearby</b>.', phone: 'maria', do: 'team', label: 'Start team record' },
      { say: 'Edits and photos move directly between the phones. <b>Share photos</b> lets whichever phone gets signal first upload them.' },
    ],
  },
];
