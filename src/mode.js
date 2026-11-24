// MVP or Beta. The MVP is exactly what ClickUp "MVP · Phase 1 (baseline app)" lists: Survey123 parity with UI updates
// (offline, queue, camera, coded errors, N/A and Could not record, Ingress layout, finish options, copy, sign-in and
// organizations, roles, and the PM feature M1 to M8: My work, map, visit detail, status actions, attach, access ending).
// Beta is everything the prototype shows: Phase 2 (claim and group visits, sharing and assigning surveys, Health,
// Check survey, free phone storage) and Phase 3 and 4 ideas (fill what is already known, calculations, guided camera,
// next-survey prompts, confirm organization before sending).
// The choice is kept in this browser (shared by the demo page and the phone) and can be forced with ?mode=mvp or ?mode=beta.

const KEY = 'fc.mode';
const read = () => {
  const q = new URLSearchParams(globalThis.location?.search || '').get('mode');
  if (q === 'mvp' || q === 'beta') { try { localStorage.setItem(KEY, q); } catch { /* private mode */ } return q; }
  try { const s = localStorage.getItem(KEY); if (s === 'mvp' || s === 'beta') return s; } catch { /* ignore */ }
  return 'mvp';
};
export const MODE = read();
export const beta = () => MODE === 'beta';
export const setMode = (m) => { try { localStorage.setItem(KEY, m); } catch { /* ignore */ } };

/** What each Beta-only feature is, for the demo page and the docs. Each is hidden in MVP. */
export const BETA_ONLY = {
  health: 'Health tab (issues and sync log)',
  everyone: 'Everyone’s surveys filter, assigning and taking over surveys',
  group: 'Group by visit toggle (MVP always shows visits with their surveys)',
  claim: 'Claim an unassigned visit',
  check: 'Check survey (the button and the pill)',
  nextsurvey: 'Surveys in this visit switcher and the next-survey prompt',
  pull: 'Fill what is already known, with “Filled in from” notes',
  calcs: 'Calculations in the field (guy cable length, limits)',
  guided: 'Guided camera with photo prompts and three photo slots',
  confirmorg: 'Confirm the organization before sending',
  storage: 'Free phone storage and the 30-day clean-up of sent surveys',
};
