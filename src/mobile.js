// FieldSync Mobile prototype: the app shell. Follows the v3 wireframes (sign-in with an organization, My work, visit detail,
// Ingress-style surveys, queue, health, profile) on top of the same engine the earlier prototype proved: offline-first store,
// resumable upload, coded errors. Screens live in mwork.js (assigned work), msurveys.js (library, forms, finish, copy) and
// mqueue.js (queue, health, storage). Everything here is a concept with placeholder data.

import { openDB } from './db.js';
import { Engine } from './queue.js';
import { RemoteServer } from './api.js';
import { Auth } from './auth.js';
import { Library } from './library.js';
import { Lookups } from './lookups.js';
import { SiteData } from './sitedata.js';
import { APP_VERSION } from './reporter.js';
import { BUILD } from './build.js';
import { MODE, beta, setMode } from './mode.js';
import { mobileLibrary, STRUCTURE_ID } from './mdata.js';
import { setChoices } from './expr.js';
import { describe } from './errors.js';
import { h, uid } from './util.js';
import { icon } from './icons.js';
import { install as installWork } from './mwork.js';
import { install as installSurveys } from './msurveys.js';
import { install as installQueue } from './mqueue.js';

const qs = new URLSearchParams(location.search);
const deviceId = qs.get('device') || 'jordan-phone';
const device = { id: deviceId, name: '', email: '' };
const K = (k) => `fc.${deviceId}.${k}`;
const LS = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(K(k))) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(K(k), JSON.stringify(v)); } catch { /* private mode */ } }, del: (k) => { try { localStorage.removeItem(K(k)); } catch { /* ignore */ } } };

const db = await openDB(`fieldmobile-${deviceId}`);
const scale = LS.get('scale', 4);
const server = new RemoteServer({ scale, profile: LS.get('profile', 'good') });
const engine = new Engine({ db, server, scale });
const auth = new Auth({ server, storageKey: K('session'), appVersion: APP_VERSION });
auth.restore();
const library = new Library({ storageKey: K('library') });
library.merge(mobileLibrary());
const lookups = new Lookups({ server, storageKey: K('lookups') });
const siteData = new SiteData({ server, engine, storageKey: K('sitedata'), structureId: STRUCTURE_ID });
siteData.titleOf = (id) => library.get(id)?.title;
await engine.start();
// a sent survey stays listed for 30 days as proof, then clears on its own
if (beta()) for (const s of [...engine.subs.values()]) if (!s.shared && s.status === 'complete' && s.submittedAt && Date.now() - s.submittedAt > 30 * 86400000) await engine.deleteSub(s.id);

// ---- shared context for the screen modules ---------------------------------------------------------
const M = { h, icon, db, server, engine, auth, library, lookups, siteData, device, LS, K, qs, describe, uid, setChoices, views: {} };
const $screen = h('div', { class: 'mscreen' });
const $tabs = h('nav', { class: 'mtabs' });
const $sheets = h('div', { class: 'sheet-layer', hidden: true });
const $toast = h('div', { class: 'mtoast', role: 'status', hidden: true });
const $status = h('div', { class: 'mstatus' });
const $net = h('div', { class: 'netbar', hidden: true });
const $ver = h('div', { class: 'verbar', hidden: true });
const $root = h('div', { class: 'mdevice device' }, $status, $ver, $net, $screen, $tabs, $sheets, $toast);
document.getElementById('app').append($root);

let view = { name: 'login' }; const stack = [];
const NO_TABS = new Set(['login', 'orgpick', 'form', 'sitepick', 'unalloc', 'attach', 'claim', 'errordetail', 'copysource', 'copypreview', 'ended', 'drafts']);
const TAB_OF = { home: 'home', visit: 'home', mysurveys: 'home', scope: 'home', accesschanged: 'home', queue: 'queue', health: 'health', storage: 'health', errordetail: beta() ? 'health' : 'queue', profile: 'profile', access: 'profile' };
const TABS = [['home', 'My work', 'home'], ['queue', 'Queue', 'queue'], ...(beta() ? [['health', 'Health', 'pulse']] : []), ['profile', 'Profile', 'user']];

M.go = (name, params = {}, { replace = false } = {}) => {
  $screen.firstChild?.cleanup?.();
  if (!replace && view.name && view.name !== name) stack.push(view);
  view = { name, ...params }; M.view = view; render();
};
M.back = () => { const prev = stack.pop(); $screen.firstChild?.cleanup?.(); view = prev || { name: 'home' }; M.view = view; render(); };
M.current = () => view;
M.redraw = () => { if (view.live) view.live(); };

M.toast = (msg, ms = 3500) => { $toast.textContent = msg; $toast.hidden = false; clearTimeout(M._t); M._t = setTimeout(() => { $toast.hidden = true; }, ms); };

/** Bottom sheet over the screen. Tap the dimmed area (or the returned close) to dismiss. */
M.sheet = (title, ...kids) => {
  const close = () => { box.remove(); if (!$sheets.children.length) $sheets.hidden = true; };
  const box = h('div', { class: 'sheet-wrap' }, h('button', { type: 'button', class: 'sheet-dim', 'aria-label': 'Close', onclick: close }), h('div', { class: 'sheet', role: 'dialog', 'aria-label': title }, h('div', { class: 'grab' }), title ? h('h2', {}, title) : null, ...kids));
  $sheets.append(box); $sheets.hidden = false; return close;
};
M.dialog = (...kids) => {
  const close = () => { box.remove(); if (!$sheets.children.length) $sheets.hidden = true; };
  const box = h('div', { class: 'sheet-wrap center' }, h('button', { type: 'button', class: 'sheet-dim', 'aria-label': 'Close', onclick: close }), h('div', { class: 'dialog', role: 'dialog' }, ...kids));
  $sheets.append(box); $sheets.hidden = false; return close;
};

const initials = (n = '?') => String(n).trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
M.initials = initials;
M.fmtDue = (d) => { const t = new Date(`${d}T12:00:00`); return Number.isNaN(+t) ? d : t.toLocaleDateString([], { month: 'short', day: 'numeric' }); };
M.orgs = () => auth.profile?.organizations || [];
M.org = () => LS.get('org', '');
M.orgName = (id = M.org()) => (id === 'all' ? 'All organizations' : M.orgs().find((o) => o.id === id)?.name || (id ? `Organization ${id}` : ''));
M.appbar = (title, sub, { back = true, right } = {}) => h('header', { class: 'mbar' }, back ? h('button', { type: 'button', class: 'iconbtn ink', 'aria-label': 'Back', onclick: M.back }, icon('back', 20)) : null, h('div', { class: 'mbar-title' }, h('b', {}, title), sub ? h('small', {}, sub) : null), right || null);
M.pill = (text, tone = '') => h('span', { class: `pill ${tone}` }, text);
M.statusPill = (s, overdue) => overdue && s !== 'complete' && s !== 'unassigned' ? M.pill('Overdue', 'blocked') : M.pill({ assigned: 'Assigned', in_progress: 'In progress', blocked: 'Blocked', complete: 'Complete', unassigned: 'Unassigned' }[s] || s, { assigned: 'assigned', in_progress: 'progress', blocked: 'blocked', complete: 'complete', unassigned: 'muted' }[s] || '');
M.logo = () => h('img', { class: 'mlogo', src: 'assets/fieldsync-mobile-icon.png', alt: 'FieldSync Mobile' });

M.online = () => !server.profile.offline && engine.svc !== 'down';

// ---- chrome: status bar, offline strip, tab bar ---------------------------------------------------
function renderStatus() {
  const off = !M.online(), p = server.profile;
  $status.replaceChildren(h('b', {}, new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/, '')), h('span', { class: 'notch' }),
    h('span', { class: 'sig' }, off ? 'No service' : p.fail > 0.1 ? 'Weak' : '', icon('wifi', 14)));
  $net.hidden = !off || view.name === 'login'; if (off) $net.textContent = 'No signal. Everything is saved on this phone and sends when service returns.';
}
function renderTabs() {
  const sum = engine.summary(), waiting = [...engine.subs.values()].filter((s) => ['queued', 'uploading', 'ready', 'failed'].includes(s.status)).length + (M.pendingOps?.() || 0);
  $tabs.hidden = NO_TABS.has(view.name);
  const on = TAB_OF[view.name] || view.name;
  $tabs.replaceChildren(...TABS.map(([id, label, ic]) => h('button', { type: 'button', class: 'mtab' + (on === id ? ' on' : ''), onclick: () => M.go(id, {}, { replace: true }) },
    h('span', { class: 'tabico' }, icon(ic, 22), id === 'queue' && waiting ? h('i', { class: 'badge' + (sum.failed ? ' bad' : '') }, waiting) : null), label)));
}
function render() {
  const screens = M.views;
  const make = screens[view.name]; if (!make) { $screen.replaceChildren(h('div', { class: 'pad' }, `Unknown screen ${view.name}`)); return; }
  $screen.replaceChildren(make(view)); renderTabs(); renderStatus();
  $root.dataset.view = view.name;
}
M.render = render;
engine.addEventListener('change', () => { renderTabs(); renderStatus(); M.redraw(); });
setInterval(() => { renderStatus(); }, 5000);
/** Is the server running this build? A server that was not restarted after an update, or a browser tab that was not reloaded, shows an old screen: say so. */
async function checkBuild() {
  try {
    const d = await (await fetch('/api/ping', { cache: 'no-store' })).json();
    const msg = !d.build ? 'The server is running old code. Stop it (Ctrl+C) and run “npm start” again, then reload this page.' : d.build !== BUILD ? 'This page is out of date. Reload it with Cmd+Shift+R (Ctrl+Shift+R on Windows).' : '';
    $ver.textContent = msg; $ver.hidden = !msg;
  } catch { /* offline: nothing to compare */ }
}
M.build = BUILD; checkBuild(); setInterval(checkBuild, 10000);

// ---- screens in this file ------------------------------------------------------------------------
const L = { org: LS.get('pickedOrg', ''), user: '', pw: '', error: '', show: false, orgs: null };
const loadOrgs = async () => { if (L.orgs) return L.orgs; try { L.orgs = await server.authOrgs(); } catch { L.orgs = M.orgs(); } return L.orgs; };

M.views.login = () => {
  const user = h('input', { class: 'minput', type: 'text', placeholder: 'name@company.com', autocomplete: 'username', value: L.user, 'aria-label': 'Email' });
  const pw = h('input', { class: 'minput', type: L.show ? 'text' : 'password', value: L.pw, autocomplete: 'current-password', 'aria-label': 'Password' });
  const err = h('div', { class: 'inline-err', hidden: !L.error }, L.error);
  user.addEventListener('input', () => { L.user = user.value; }); pw.addEventListener('input', () => { L.pw = pw.value; });
  const orgBtn = h('button', { type: 'button', class: 'minput pick', onclick: () => M.go('orgpick') }, h('span', { class: L.org ? '' : 'muted' }, L.org ? (L.orgs?.find((o) => o.id === L.org)?.name || M.orgName(L.org)) : 'Choose your organization'), icon('chevron', 16));
  const fail = (m) => { L.error = m; err.textContent = m; err.hidden = false; };
  const done = async (prof) => {
    device.name = prof.name; device.email = prof.email;
    const mine = prof.organizations || [];
    if (L.org && !mine.some((o) => o.id === L.org)) { auth.signOut(); return fail('You are not a member of this organization. Ask your admin to add you.'); }
    const org = L.org || (mine.length === 1 ? mine[0].id : mine[0]?.id || '');
    LS.set('org', org); LS.del('pickedOrg'); server.setOrg(org); L.pw = ''; L.error = '';
    M.afterSignIn?.(); M.go('home', {}, { replace: true });
  };
  const signIn = async (e) => {
    e.target.disabled = true; L.error = ''; err.hidden = true;
    if (!L.org) { e.target.disabled = false; return fail('Choose your organization first.'); }
    try { await done(await auth.passwordLogin(L.user.trim(), L.pw)); } catch (x) { fail(`${x.code || 'ERR-GEN-000'}: ${describe(x.code).title}. ${describe(x.code).cause}`); }
    e.target.disabled = false;
  };
  const sso = async () => {
    if (!L.org) return fail('Choose your organization first.');
    if (!L.user.trim()) return fail('Enter your work email, then continue with SSO.');
    try { await done(await auth.microsoftLogin(L.user.trim())); } catch (x) { fail(`${x.code || 'ERR-GEN-000'}: ${describe(x.code).title}. ${describe(x.code).cause}`); }
  };
  loadOrgs().then(() => { if (L.org && view.name === 'login') { const t = orgBtn.querySelector('span'); t.textContent = L.orgs.find((o) => o.id === L.org)?.name || t.textContent; } });
  return h('div', { class: 'login' },
    h('div', { class: 'login-top' }, h('img', { class: 'logo-big', src: 'assets/fieldsync-mobile-icon.png', alt: 'FieldSync Mobile' }), h('b', {}, 'FieldSync ', h('span', { class: 'mob' }, 'Mobile')), h('small', {}, 'Field data, never lost')),
    h('div', { class: 'login-card' }, h('h1', {}, 'Sign in'), h('p', { class: 'muted' }, 'Use your FieldSync account.'),
      h('label', { class: 'lbl' }, 'Organization'), orgBtn, h('label', { class: 'lbl' }, 'Email'), user,
      h('label', { class: 'lbl' }, 'Password'), h('div', { class: 'pwrow' }, pw, h('button', { type: 'button', class: 'link', onclick: () => { L.show = !L.show; pw.type = L.show ? 'text' : 'password'; } }, 'Show')),
      h('div', { class: 'row end' }, h('button', { type: 'button', class: 'link', onclick: () => M.toast('Password reset is not designed yet.') }, 'Forgot password?')),
      err, h('button', { type: 'button', class: 'btn primary big', onclick: signIn }, 'Sign in'), h('button', { type: 'button', class: 'btn big', onclick: sso }, 'Continue with organization SSO'),
      h('small', { class: 'muted center' }, 'Stays signed in 30 to 60 days. Surveys on this phone work offline.')));
};

M.views.orgpick = () => {
  const list = h('div', { class: 'org-list' }); let q = '';
  const draw = () => list.replaceChildren(...(L.orgs || []).filter((o) => !q || o.name.toLowerCase().includes(q)).map((o) => h('button', { type: 'button', class: 'org-card' + (L.org === o.id ? ' on' : ''), onclick: () => { L.org = o.id; draw(); } },
    h('span', { class: 'org-badge' }, o.name[0]), h('b', {}, o.name), L.org === o.id ? h('span', { class: 'org-check' }, icon('check', 16)) : null)));
  const search = h('input', { class: 'minput', placeholder: 'Search organizations', 'aria-label': 'Search organizations' }); search.addEventListener('input', () => { q = search.value.toLowerCase(); draw(); });
  loadOrgs().then(draw); draw();
  return h('div', { class: 'mcol' }, M.appbar('Choose your organization', 'Step 1 of 2'),
    h('div', { class: 'scroll pad' }, search, list, h('small', { class: 'muted' }, 'Not listed? Ask your admin to add you.')),
    h('div', { class: 'footbar' }, h('button', { type: 'button', class: 'btn primary big', onclick: () => { if (!L.org) return M.toast('Choose an organization.'); LS.set('pickedOrg', L.org); M.back(); } }, 'Continue')));
};

// ---- profile, access, switcher, access ended ------------------------------------------------------
M.views.profile = () => {
  const p = auth.profile || {};
  const row = (label, value, onclick) => h('button', { type: 'button', class: 'prow', onclick }, h('span', {}, label), h('span', { class: 'muted' }, value ?? '', onclick ? icon('chevron', 14) : null));
  return h('div', { class: 'mcol' }, h('header', { class: 'mbar big' }, h('div', { class: 'mbar-title' }, h('b', {}, 'Profile'), h('small', {}, 'Account and settings'))),
    h('div', { class: 'scroll pad' },
      h('div', { class: 'card pcard' }, h('span', { class: 'avatar big' }, initials(p.name)), h('div', {}, h('b', {}, p.name || device.name), h('small', { class: 'muted block' }, M.orgName()), M.pill('Crew lead', 'assigned'))),
      h('div', { class: 'card plist' }, row('Organizations', M.orgs().length > 1 ? `${M.orgs()[0].name}, ${M.orgs().length - 1} more` : M.orgs()[0]?.name, () => M.switcher()), row('Your access', '', () => M.go('access')), row('Stay signed in', '30 to 60 days'), row('Upload over', 'Wi-Fi and cellular'), row('Wide-shot opening zoom', '0.5x'), row('Photo quality', 'Native'),
        row('About and support', `Build ${BUILD}`, () => M.toast('Sending a report to the dev team comes in a later release.'))),
      h('button', { type: 'button', class: 'btn big', onclick: () => { auth.signOut(); LS.del('org'); M.go('login', {}, { replace: true }); stack.length = 0; } }, 'Sign out')));
};

M.views.access = () => {
  const p = auth.profile || {}, tick = (on, text, later) => h('div', { class: 'perm' + (on ? '' : ' off') }, h('span', { class: 'permico' }, on ? icon('check', 14) : icon('shield', 14)), h('span', { class: 'grow' }, text), later ? h('small', { class: 'later' }, 'Later') : null);
  return h('div', { class: 'mcol' }, M.appbar('Your access', 'FieldSync account'),
    h('div', { class: 'scroll pad' }, h('div', { class: 'card pcard' }, h('span', { class: 'avatar big' }, initials(p.name)), h('div', {}, h('b', {}, p.name), h('small', { class: 'muted block' }, M.orgName()), M.pill('Crew lead', 'assigned'))),
      h('h3', {}, 'What you can do'), tick(true, 'See surveys assigned to you'), tick(true, 'Collect and submit surveys'), tick(false, 'Send a report to the dev team', true), tick(false, 'Share and assign surveys', true), tick(false, 'Edit other people’s entries', true),
      h('h3', {}, 'Set by your role'), h('div', { class: 'card plist' },
        h('div', { class: 'prow static' }, h('div', {}, h('b', {}, 'Add photos from the gallery'), h('small', { class: 'muted block' }, 'Off for training roles, so every photo is taken on site')), M.pill(LS.get('role', 'full') === 'training' ? 'Off' : 'On', LS.get('role', 'full') === 'training' ? 'blocked' : 'complete')),
        h('div', { class: 'prow static' }, h('div', {}, h('b', {}, 'Required review before sending'), h('small', { class: 'muted block' }, 'On for training roles: a lead checks it first (second wave)')), M.pill(LS.get('role', 'full') === 'training' ? 'On' : 'Off', LS.get('role', 'full') === 'training' ? 'progress' : 'muted'))),
      h('h3', {}, 'Scopes and sites you can access'), h('button', { type: 'button', class: 'scopecard', onclick: () => M.go('accesschanged') }, h('div', { class: 'chips' }, M.pill('Inspection', 'assigned'), M.pill('TMO CONS MOD Closeout', 'progress'), M.pill('Verizon CONS MOD Closeout', 'progress'))),
      h('small', { class: 'muted' }, 'Comes from your FieldSync account and updates when the phone syncs.')));
};
M.views.accesschanged = () => h('div', { class: 'mcol' }, M.appbar('Inspection', 'Access changed'),
  h('div', { class: 'scroll pad' }, h('div', { class: 'warn-card' }, h('b', {}, 'Your access to this scope changed'), h('p', {}, 'What you captured is kept on this phone. Your crew lead or PM can review it and decide what to send. Nothing is deleted.')),
    ...[['Structure Flight', 'Held on this phone'], ['Guy Facilities', 'Held on this phone'], ['Plumb & Twist', 'Held on this phone']].map(([a, b]) => h('div', { class: 'card held' }, M.pill(a, 'progress'), h('small', { class: 'muted block' }, b)))),
  h('div', { class: 'footbar' }, h('button', { type: 'button', class: 'btn primary big', onclick: () => { M.back(); M.back(); } }, 'OK'), h('small', { class: 'muted center' }, 'Ask your crew lead or PM if you need access.')));

M.switcher = () => {
  const counts = (id) => { const v = (M.visitList?.() || []).filter((x) => x.orgId === id && (x.status === 'assigned' || x.status === 'in_progress')).length; const ph = [...engine.subs.values()].filter((s) => s.orgId === id && ['queued', 'uploading', 'ready'].includes(s.status)).reduce((n, s) => n + engine.countsFor(s.id).total - engine.countsFor(s.id).done, 0); return !v && !ph ? 'No visits assigned' : `${v} visit${v === 1 ? '' : 's'} to do · ${ph ? `${ph} photo${ph === 1 ? '' : 's'} waiting` : 'nothing waiting'}`; };
  const pick = (id) => { LS.set('org', id); server.setOrg(id); close(); M.afterOrgChange?.(); M.go('home', {}, { replace: true }); if (id === 'all') M.toast('Showing visits from every organization.'); };
  const cur = M.org();
  const close = M.sheet('Switch organization', h('small', { class: 'muted' }, 'Work, queue and surveys follow the one you pick.'),
    ...M.orgs().map((o) => h('button', { type: 'button', class: 'org-card' + (cur === o.id ? ' on' : ''), onclick: () => pick(o.id) }, h('span', { class: 'org-badge' }, o.name[0]), h('div', { class: 'grow' }, h('b', {}, o.name), h('small', { class: 'muted block' }, counts(o.id))), cur === o.id ? h('span', { class: 'org-check' }, icon('check', 16)) : h('span', { class: 'radio' }))),
    h('button', { type: 'button', class: 'org-card' + (cur === 'all' ? ' on' : ''), onclick: () => pick('all') }, h('span', { class: 'org-badge all' }, 'All'), h('div', { class: 'grow' }, h('b', {}, 'All organizations'), h('small', { class: 'muted block' }, 'Work and queue from every organization')), cur === 'all' ? h('span', { class: 'org-check' }, icon('check', 16)) : h('span', { class: 'radio' })),
    h('small', { class: 'muted' }, 'A survey stays with the organization it was started in.'), h('small', { class: 'muted' }, 'Switching never moves or loses a draft or a queued record.'),
    h('button', { type: 'button', class: 'btn primary big', onclick: () => close() }, 'Done'));
};

M.views.ended = (v) => h('div', { class: 'ended' },
  h('div', { class: 'ended-top' }, h('img', { class: 'logo-big', src: 'assets/fieldsync-mobile-icon.png', alt: '' }), h('b', {}, 'Your access ended'), h('small', {}, v.org ? M.orgName(v.org) : '')),
  h('div', { class: 'login-card' }, h('h3', {}, 'What happened'), h('p', {}, 'Your membership was deactivated. Assigned visits were removed from this phone and you were signed out of this organization.'),
    (v.unsent ? h('div', { class: 'warn-card' }, h('b', {}, 'Surveys not yet sent: decide'), h('p', {}, 'Keep them for your crew lead or PM?')) : h('div', { class: 'warn-card' }, h('b', {}, 'Surveys not yet sent: decide'), h('p', {}, 'Keep them for your crew lead or PM?'))),
    h('button', { type: 'button', class: 'btn primary big', onclick: () => { const left = M.orgs().filter((o) => o.id !== v.org); if (left.length) { LS.set('org', left[0].id); server.setOrg(left[0].id); M.go('orgpick', {}, { replace: true }); L.orgs = null; stack.length = 0; M.afterOrgChange?.(); auth.refreshProfile().then(() => M.go('home', {}, { replace: true })); } else { auth.signOut(); M.go('login', {}, { replace: true }); } } }, 'Choose another organization'),
    h('button', { type: 'button', class: 'btn big', onclick: () => { auth.signOut(); LS.del('org'); stack.length = 0; M.go('login', {}, { replace: true }); } }, 'Sign out')));

server.onAccessEnded = (err, org) => { if (view.name === 'ended') return; M.accessEnded?.(org); M.go('ended', { org: org || M.org(), unsent: [...engine.subs.values()].some((s) => s.orgId === org && s.status !== 'complete') }, { replace: true }); };
auth.addEventListener('revoked', () => { M.toast('Your account was removed from FieldSync.'); auth.signOut(); M.go('login', {}, { replace: true }); });

installWork(M); installSurveys(M); installQueue(M);

// ---- boot ------------------------------------------------------------------------------------------
async function boot() {
  const auto = qs.get('signin');
  if (!auth.signedIn && auto) {
    const [kind, who, pw] = auto.split(':');
    try { const prof = kind === 'microsoft' ? await auth.microsoftLogin(who) : await auth.passwordLogin(who, pw); device.name = prof.name; device.email = prof.email; LS.set('org', qs.get('org') || prof.organizations?.[0]?.id || ''); } catch { /* sign-in screen */ }
  }
  if (auth.signedIn) {
    device.name = auth.profile.name; device.email = auth.profile.email;
    if (!LS.get('org', '')) LS.set('org', auth.profile.organizations?.[0]?.id || '');
    server.setOrg(M.org()); lookups.install({ username: auth.profile.username, email: auth.profile.email }, auth.profile); siteData.install(); M.afterSignIn?.();
    const resume = LS.get('resume', null);
    if (resume && qs.get('restored') && engine.subs.get(resume.subId)) M.go('form', { subId: resume.subId, banner: 'Welcome back|We restored your survey where you left off. Nothing was lost.' }, { replace: true });
    else M.go('home', {}, { replace: true });
  } else M.go('login', {}, { replace: true });
}
M.afterSignIn = ((prev) => () => { prev?.(); lookups.install({ username: auth.profile.username, email: auth.profile.email }, auth.profile); siteData.install(); })(M.afterSignIn);
await boot();
window.__fc = { M, server, engine, auth, library, LS, demo: M.demo || {}, mode: MODE };
// A small MVP / Beta switch in the corner when the phone is opened on its own (inside the demo page, the demo page has it).
if (window.self === window.top) {
  const sw = h('div', { class: 'modesw', role: 'group', 'aria-label': 'Version' }, ...[['mvp', 'MVP'], ['beta', 'Beta']].map(([m, l]) => h('button', { type: 'button', class: MODE === m ? 'on' : '', onclick: () => { setMode(m); const u = new URL(location.href); u.searchParams.set('mode', m); location.href = u.href; } }, l)));
  document.body.append(sw);
}
