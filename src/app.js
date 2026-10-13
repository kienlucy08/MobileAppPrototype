import { openDB } from './db.js';
import { Engine } from './queue.js';
import { RemoteServer, PROFILES } from './api.js';
import { Collab } from './collab.js';
import { Reporter, APP_VERSION } from './reporter.js';
import { SAMPLE_SURVEY } from './sample.js';
import * as S from './schema.js';
import { renderForm, renderReview } from './form.js';
import { addImages, makeTestPhoto } from './images.js';
import { convertWorkbook, loadSheetJS } from './xlsform.js';
import { Lookups, Orgs } from './lookups.js';
import { Auth } from './auth.js';
import { Nearby } from './nearby.js';
import { Library, tileOf } from './library.js';
import { demoPlaceholders, PREWORK_TILE } from './demoLibrary.js';
import { setChoices } from './expr.js';
import { describe } from './errors.js';
import { h, fmtBytes, fmtTime, uid, download } from './util.js';
import { icon } from './icons.js';

// ---- who is this phone? ------------------------------------------------------------------------------
const qs = new URLSearchParams(location.search);
const stored = (() => { try { return JSON.parse(localStorage.getItem('fc.device')); } catch { return null; } })();
const device = { id: qs.get('device') || stored?.id || uid().slice(0, 8), name: qs.get('name') || stored?.name || '', email: qs.get('email') || stored?.email || '' };
if (!qs.get('device')) { try { localStorage.setItem('fc.device', JSON.stringify(device)); } catch { /* private mode */ } }
const K = (k) => `fc.${device.id}.${k}`;
const LS = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(K(k))) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(K(k), JSON.stringify(v)); } catch { /* private mode */ } } };

const db = await openDB(`fieldcollect-${device.id}`);
const scale = LS.get('scale', 4);
const server = new RemoteServer({ scale, profile: LS.get('profile', 'good') });
const engine = new Engine({ db, server, scale });
const collab = new Collab({ db, server, engine, device });
const reporter = new Reporter({ db, server, engine, collab, device });
const auth = new Auth({ server, storageKey: K('session'), appVersion: APP_VERSION });
auth.restore();
const lookups = new Lookups({ server, storageKey: K('lookups') });
const library = new Library({ storageKey: K('library') });
const nearby = new Nearby({ collab, engine, db, device });
const orgs = new Orgs({ server, storageKey: K('orgs'), getEmail: () => device.email });
const ctx = { db, server, engine, collab, reporter, lookups, orgs, auth, nearby, library, device, survey: LS.get('survey', SAMPLE_SURVEY), toast };
if (S.checkSurvey(ctx.survey).length) ctx.survey = SAMPLE_SURVEY;
setChoices(ctx.survey);
library.merge([ctx.survey]);

let view = { name: 'home' };
let live = null;
const $screen = h('div', { class: 'screens' });
const $tabs = h('nav', { class: 'tabs' });
const $chip = h('button', { class: 'netchip', onclick: () => go('dev') });
const $toast = h('div', { class: 'toast', role: 'status', hidden: true });
const $clock = h('span', {});
const $modal = h('div', { class: 'modal-wrap', hidden: true });

// =================================================================================================
// chrome
// =================================================================================================
function applyTheme() {
  const t = (view.name === 'form' || view.name === 'review' ? currentSurvey()?.theme : ctx.survey.theme) || {};
  const st = document.documentElement.style;
  const map = { '--primary': t.primary, '--onprimary': t.onPrimary, '--bg': t.background, '--fill': t.fieldFill, '--text': t.bodyText, '--inputtext': t.inputText, '--inputbg': t.inputBackground, '--hbg': t.headerBg, '--hfont': t.headerFont, '--fbg': t.footerBg, '--font': t.bodyFont };
  for (const [k, v] of Object.entries(map)) v ? st.setProperty(k, v) : st.removeProperty(k);
}
const currentSurvey = () => { const s = engine.subs.get(view.subId); return s?.shared ? collab.docs.get(s.id)?.survey : s?.survey; };

let toastT;
function toast(msg, ms = 3500) {
  $toast.textContent = msg; $toast.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { $toast.hidden = true; }, ms);
}

function modal(title, ...kids) {
  const close = () => { $modal.hidden = true; $modal.replaceChildren(); };
  $modal.replaceChildren(h('div', { class: 'modal', role: 'dialog', 'aria-label': title }, h('h3', { class: 'modal-title' }, title), ...kids));
  $modal.hidden = false;
  $modal.onclick = (e) => { if (e.target === $modal) close(); };
  return close;
}

function go(name, params = {}) {
  $screen.firstChild?.cleanup?.();
  view = { name, ...params };
  live = null;
  render();
}

const TABS = [['home', 'Surveys', 'home'], ['outbox', 'Outbox', 'upload'], ['health', 'Health', 'pulse'], ['dev', 'Dev', 'code']];
function renderTabs() {
  const sum = engine.summary();
  const active = [...engine.subs.values()].filter((s) => s.status === 'queued' || s.status === 'uploading' || s.status === 'failed' || (s.shared && s.status === 'shared' && engine.countsFor(s.id).total - engine.countsFor(s.id).done > 0)).length;
  $tabs.replaceChildren(...TABS.map(([id, label, ic]) => h('button', { class: 'tab' + (view.name === id ? ' on' : ''), onclick: () => go(id) },
    h('span', { class: 'tabico' }, icon(ic, 22), id === 'outbox' && active ? h('i', { class: 'badge' + (sum.failed ? ' bad' : '') }, active) : null), label)));
  $tabs.hidden = view.name === 'form' || view.name === 'review';
}

function renderChip() {
  const p = server.profile, sum = engine.summary();
  const down = sum.svc === 'down' || collab.svc === 'down' || p.offline;
  const cls = down ? 'off' : p.fail > 0.1 ? 'warn' : p.fail > 0 ? 'mid' : 'ok';
  $chip.className = `netchip ${cls}`;
  $chip.replaceChildren(icon('wifi', 14), p.label + (down && !p.offline ? ' · paused' : ''));
}

function render() {
  applyTheme();
  const screens = { home, outbox, health, dev, form: formView, review: reviewView };
  $screen.replaceChildren(screens[view.name]());
  renderTabs(); renderChip();
}

function autoReportFailures() {
  if (!LS.get('autoReport', true)) return;
  for (const s of engine.subs.values()) {
    if (s.status === 'failed' && !s.reported) {
      s.reported = true; engine._saveSub(s);
      reporter.send({ subId: s.id, code: s.error?.code, message: `Auto-report: record failed with ${s.error?.code}` });
      toast('A failed record was reported to the dev team automatically.');
    }
  }
}
let lastForms = null;
const onChange = () => { if (collab.forms !== lastForms) { lastForms = collab.forms; library.merge(collab.forms); } renderTabs(); renderChip(); live?.(); autoReportFailures(); };
engine.addEventListener('change', onChange);
collab.addEventListener('change', onChange);
nearby.addEventListener('change', onChange);
reporter.addEventListener('change', () => live?.());
setInterval(() => { $clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }, 1000);
setInterval(() => { if (!server.profile.offline) server.refreshStats().then(() => { if (view.name === 'home' || view.name === 'health') live?.(); }); }, 4000);

// =================================================================================================
// screens
// =================================================================================================
const appbar = (title, sub, right) => h('header', { class: 'appbar' }, h('div', { class: 'ab-title' }, h('b', {}, title), sub ? h('small', {}, sub) : null), right);

function newDraft() {
  const sub = { id: uid(), surveyId: ctx.survey.id, surveyTitle: ctx.survey.title, schemaVersion: ctx.survey.version, survey: ctx.survey, status: 'draft', answers: S.newAnswers(ctx.survey, device), page: 0, createdAt: Date.now(), updatedAt: Date.now(), submittedAt: 0 };
  engine.registerSub(sub); db.put('submissions', sub);
  return sub;
}

function askText(title, label, value, okLabel, onOk) {
  const input = h('input', { class: 'input', value });
  input.value = value;
  const close = modal(title, h('label', { class: 'lbl' }, label), input,
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => { const v = input.value.trim(); if (v) { close(); onOk(v); } } }, okLabel)));
  setTimeout(() => input.focus(), 50);
}

/** Team records start from the same defaults as private drafts (start time, default numbers, hidden meta fields). */
function seedTeamDefaults(doc) {
  const a = collab.open(doc.id);
  Object.assign(a, S.newAnswers(doc.survey, device));
  collab.localChanged(doc.id, a); collab.flush(doc.id);
}

function startTeam(form) {
  askText('Start a team survey', 'Name this record so teammates can find it', `${form.title} · ${device.name}`, 'Start', (title) => {
    useForm(form);
    const doc = collab.create({ survey: form, title });
    seedTeamDefaults(doc);
    go('form', { subId: doc.id });
  });
}

/** Make a library survey the current one (new drafts and team records are created from it). */
function useForm(form) { ctx.survey = form; LS.set('survey', form); setChoices(form); }

function openTeam(meta) {
  const local = collab.docs.get(meta.id);
  if (local) { go('form', { subId: meta.id }); return; }
  collab.join(meta).then(() => go('form', { subId: meta.id })).catch((e) => toast(e.code === 'ERR-NET-002' || e.code === 'ERR-NET-001' ? 'You need a signal once to join a team record. After that it works offline.' : `${e.code}: ${e.message}`, 5000));
}

function teamRows() {
  const rows = new Map();
  for (const m of collab.list) rows.set(m.id, { meta: m, local: collab.docs.get(m.id) });
  for (const d of collab.docs.values()) if (!rows.has(d.id)) rows.set(d.id, { meta: { id: d.id, title: d.title, formId: d.survey.id, scope: d.survey.scope, createdByName: d.createdByName, photos: 0, photosReceived: 0, status: d.status, recordId: d.recordId, unsynced: true }, local: d });
  return [...rows.values()].sort((a, b) => (b.meta.createdAt || 0) - (a.meta.createdAt || 0));
}
const rowCard = ({ meta, local }) => {
  const submitted = (local?.status || meta.status) === 'submitted';
  return h('div', { class: 'card row-card' },
    h('div', { class: 'grow' }, h('b', {}, meta.title), h('small', { class: 'muted block' },
      `${meta.createdByName || 'someone'} · ${meta.photos ?? 0} photos${meta.unsynced || (local && !local.created) ? ' · not on server yet' : ''}${meta.amended ? ' · amended' : ''}`)),
    submitted ? h('span', { class: 'pill complete' }, `#${local?.recordId || meta.recordId}`) : h('button', { class: 'btn small primary', onclick: () => openTeam(meta) }, local ? 'Open' : 'Join'));
};

const today = () => new Date().toISOString().slice(0, 10);
const draftsOf = (formId) => [...engine.subs.values()].filter((s) => s.status === 'draft' && (!formId || s.surveyId === formId)).sort((a, b) => b.updatedAt - a.updatedAt);

/** "What are you working on today?" — pick a scope of work to focus the survey list. */
function scopeSheet() {
  const scopes = library.scopes();
  const pick = (name) => { LS.set('scope', name); LS.set('scopeAsked', today()); close(); render(); };
  const close = modal('What are you working on today?',
    h('p', { class: 'muted' }, 'Pick a scope of work to see just those surveys. You can change it any time.'),
    h('div', { class: 'scope-pick' }, scopes.map((sc) => h('button', { class: 'btn big', onclick: () => pick(sc.name) }, h('b', {}, sc.name), h('small', {}, `${sc.count} survey${sc.count === 1 ? '' : 's'}`))),
      h('button', { class: 'btn big ghost', onclick: () => pick('') }, 'Show all surveys')));
}

/** A survey tile was tapped: start it, start it as a team survey, or pick up work already under way. */
function surveySheet(form) {
  const drafts = draftsOf(form.id), team = teamRows().filter((r) => (r.meta.formId || r.local?.survey?.id) === form.id);
  const t = tileOf(form);
  const close = modal(form.title,
    h('div', { class: 'sheet-head' }, h('div', { class: 'tile-art small', style: `background:${t.color}` }, h('span', {}, t.text)), h('div', {}, h('small', { class: 'muted block' }, `${form.scope || 'Other'} · v${form.version} · ${form.pages.reduce((n, p) => n + p.fields.length, 0)} questions`), form.demo ? h('small', { class: 'muted block' }, 'Demo placeholder') : null)),
    h('button', { class: 'btn primary big', onclick: () => { close(); useForm(form); const sub = newDraft(); go('form', { subId: sub.id }); } }, 'Start survey'),
    h('button', { class: 'btn big team-btn', onclick: () => { close(); startTeam(form); } }, icon('upload', 16), 'Start as team survey'),
    drafts.length ? h('div', {}, h('h3', {}, 'My drafts'), drafts.map((d) => h('div', { class: 'row-card inner' }, h('div', { class: 'grow' }, h('b', {}, d.label || d.answers.siteId || d.answers.site_id || 'Untitled'), h('small', { class: 'muted block' }, `edited ${fmtTime(d.updatedAt)}`)),
      h('button', { class: 'btn small', onclick: () => { close(); go('form', { subId: d.id, page: d.page || 0 }); } }, 'Resume')))) : null,
    team.length ? h('div', {}, h('h3', {}, 'Team records'), team.map(({ meta, local }) => h('div', { class: 'row-card inner' }, h('div', { class: 'grow' }, h('b', {}, meta.title), h('small', { class: 'muted block' }, `${meta.createdByName || 'someone'}`)),
      (local?.status || meta.status) === 'submitted' ? h('span', { class: 'pill complete' }, 'Submitted') : h('button', { class: 'btn small primary', onclick: () => { close(); openTeam(meta); } }, local ? 'Open' : 'Join')))) : null,
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => close() }, 'Close')));
}

function home() {
  let q = '';
  const banner = h('div', {}), chips = h('div', { class: 'scopes' }), grid = h('div', { class: 'tiles-grid' }), teamBox = h('div', {}), draftsBox = h('div', {}), nearbyBox = h('div', {});
  const scope = () => LS.get('scope', '');
  const inScope = (sc) => !scope() || (sc || 'Other') === scope();
  const inQuery = (t) => !q.trim() || String(t).toLowerCase().includes(q.trim().toLowerCase());

  const drawChips = () => {
    const all = library.all.length;
    chips.replaceChildren(h('button', { class: 'chip-btn' + (!scope() ? ' on' : ''), onclick: () => { LS.set('scope', ''); render(); } }, `All (${all})`),
      ...library.scopes().map((sc) => h('button', { class: 'chip-btn' + (scope() === sc.name ? ' on' : ''), onclick: () => { LS.set('scope', sc.name); render(); } }, `${sc.name} (${sc.count})`)));
  };
  const drawGrid = () => {
    const list = library.filter({ scope: scope(), q });
    grid.replaceChildren(...(list.length ? list.map((f) => {
      const t = tileOf(f), n = draftsOf(f.id).length;
      return h('button', { class: 'svtile', onclick: () => surveySheet(f), 'aria-label': f.title }, h('div', { class: 'tile-art', style: `background:${t.color}` }, h('span', {}, t.text)), n ? h('i', { class: 'badge' }, n) : null, h('div', { class: 'tile-title' }, f.title));
    }) : [h('div', { class: 'empty wide' }, h('p', {}, library.all.length ? 'No surveys match.' : 'No surveys on this phone yet.'), library.all.length ? h('button', { class: 'btn small', onclick: () => { LS.set('scope', ''); q = ''; render(); } }, 'Show all surveys') : h('small', {}, 'They download here whenever you have signal, then work offline.'))]));
  };
  const drawLive = () => {
    const min = server.stats().minSchema, old = library.all.filter((f) => f.version < min);
    banner.replaceChildren(...(old.length ? [h('div', { class: 'banner warn' }, icon('alert'), h('div', {}, h('b', {}, `Form v${min} is required`), h('p', {}, `${old.length} survey${old.length === 1 ? '' : 's'} on this phone are older than the server accepts; records collected on them would be rejected with ERR-SYNC-001.`), h('button', { class: 'btn small primary', onclick: () => { library.merge(old.map((f) => ({ ...f, version: min }))); toast(`Surveys updated to v${min}`); render(); } }, `Update to v${min}`)))] : []));
    drawChips(); drawGrid();
    nearbyBox.replaceChildren(h('div', { class: 'card nearby' },
      h('div', { class: 'row between' }, h('div', {}, h('b', {}, icon('wifi', 15), ' Nearby sync'), h('small', { class: 'muted block' }, nearby.enabled ? (nearby.peerList().length ? `${nearby.peerList().map((p) => p.name).join(', ')} within range — works with no signal` : 'On — looking for teammates nearby…') : 'Work together with no signal at all: phones sync directly')),
        h('button', { class: 'btn small' + (nearby.enabled ? ' primary' : ''), onclick: () => { nearby.enabled ? nearby.disable() : nearby.enable(); drawLive(); } }, nearby.enabled ? 'On' : 'Turn on')),
      ...nearby.available().map(({ peer, doc }) => h('div', { class: 'row-card inner' }, h('div', { class: 'grow' }, h('b', {}, doc.title), h('small', { class: 'muted block' }, `${peer.name}'s phone · ${doc.status === 'submitted' ? 'submitted' : 'open'}`)),
        doc.status === 'submitted' ? null : h('button', { class: 'btn small primary', onclick: () => { nearby.join(peer.id, doc.id); toast(`Joining “${doc.title}” from ${peer.name}…`); } }, 'Join nearby')))));
    const rows = teamRows().filter(({ meta, local }) => inScope(meta.scope ?? local?.survey?.scope) && inQuery(meta.title));
    teamBox.replaceChildren(h('h3', {}, `Team surveys${scope() ? ` · ${scope()}` : ''}`), ...(rows.length ? rows.map(rowCard) : [h('p', { class: 'muted pad0' }, 'None yet. Open a survey and choose “Start as team survey” — a teammate on another phone can join it.')]));
    const drafts = draftsOf().filter((d) => inScope(d.survey?.scope) && inQuery(d.surveyTitle + ' ' + (d.label || '')));
    draftsBox.replaceChildren(...(drafts.length ? [h('h3', {}, 'My drafts'), ...drafts.map((d) => h('div', { class: 'card row-card' },
      h('div', {}, h('b', {}, d.answers.siteId || d.answers.site_id || 'Untitled'), h('small', { class: 'muted block' }, `${d.surveyTitle} · ${engine.mediaFor(d.id).length} photos · edited ${fmtTime(d.updatedAt)}`)),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn small', onclick: () => go('form', { subId: d.id, page: d.page || 0 }) }, 'Resume'),
      h('button', { class: 'btn small ghost danger', onclick: async () => { if (confirm('Delete this draft and its photos?')) { await engine.deleteSub(d.id); render(); } } }, 'Delete')))] : []));
  };
  live = drawLive;
  const search = h('input', { class: 'input search', type: 'search', placeholder: 'Search surveys', 'aria-label': 'Search surveys' });
  search.addEventListener('input', () => { q = search.value; drawGrid(); drawLive(); });
  const body = h('div', { class: 'scroll pad' }, banner, search, chips, grid, nearbyBox, teamBox, draftsBox);
  drawLive();
  if (library.scopes().length > 1 && LS.get('scopeAsked', '') !== today() && !$modal.hidden === false) setTimeout(() => { if (view.name === 'home' && $modal.hidden && LS.get('scopeAsked', '') !== today()) scopeSheet(); }, 350);
  return h('div', { class: 'screen' }, appbar('My Surveys', `${device.name} · ${device.email}`, $chip), body);
}

function formView() {
  const sub = engine.subs.get(view.subId);
  return renderForm(ctx, sub, {
    startPage: view.page || 0, focusPath: view.focusPath,
    onExit: () => go('home'),
    onReview: (page) => { sub.page = page; go('review', { subId: sub.id }); },
  });
}
function reviewView() {
  const sub = engine.subs.get(view.subId);
  return renderReview(ctx, sub, {
    onBack: () => go('form', { subId: sub.id, page: sub.page || 0 }),
    onEdit: (page, path) => go('form', { subId: sub.id, page, focusPath: path }),
    onSent: () => { toast(sub.shared ? 'Team record submitted' : 'Saved on device — uploading in background'); go('outbox'); },
  });
}

// ---- outbox ---------------------------------------------------------------------------------------
const COLORS = { done: '#16a34a', uploading: '#2563eb', retrying: '#f59e0b', queued: '#cbd5e1', failed: '#dc2626', local: '#e2e8f0' };
const d0 = (sub) => describe(sub.error?.code);
const exportSub = (sub) => download(`record-${sub.id.slice(0, 8)}.json`, { submission: sub, media: engine.mediaFor(sub.id).map(({ thumb, ...m }) => m) });
const reportSub = (sub) => reportSheet(sub.id, sub.error?.code ? `Record failed: ${sub.error.code}` : '');

function subCard(sub) {
  const title = h('b', {}), pill = h('span', { class: 'pill' }), meta = h('small', { class: 'muted block' });
  const headline = h('div', { class: 'headline' });
  const seg = h('div', { class: 'seg' }, ['done', 'uploading', 'retrying', 'failed'].map((k) => h('i', { class: k })));
  const legend = h('div', { class: 'legend' });
  const canvas = h('canvas', { class: 'dots', 'aria-label': 'Per-photo upload state' });
  const errbox = h('div', {});
  const actions = h('div', { class: 'row' });
  const el = h('div', { class: 'card sub' }, h('div', { class: 'sub-top' }, h('div', {}, title, meta), pill), headline, seg, legend, canvas, errbox, actions);

  const drawDots = (items) => {
    const n = items.length; canvas.hidden = n < 2; if (n < 2) return;
    const pw = canvas.parentElement.clientWidth, W = pw > 48 ? pw - 32 : 300, sz = n > 600 ? 6 : 9, gap = 2, cols = Math.max(1, Math.floor(W / (sz + gap)));
    const H = Math.ceil(n / cols) * (sz + gap), r = 2;
    canvas.width = W * r; canvas.height = H * r; canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    const g = canvas.getContext('2d'); g.scale(r, r);
    items.forEach((m, i) => { g.fillStyle = COLORS[m.state === 'queued' && m.attempts > 0 ? 'retrying' : m.state]; g.fillRect((i % cols) * (sz + gap), Math.floor(i / cols) * (sz + gap), sz, sz); });
  };

  const update = () => {
    const c = engine.countsFor(sub.id), sum = engine.summary(), items = engine.mediaFor(sub.id);
    const doc = sub.shared ? collab.docs.get(sub.id) : null;
    title.textContent = (sub.shared ? '👥 ' : '') + (sub.label || sub.answers?.siteId || 'Untitled');
    meta.textContent = sub.shared ? `Team record · ${c.total} of your photos · ${fmtBytes(c.bytes)}` : `${fmtTime(sub.submittedAt)} · ${c.total} photos · ${fmtBytes(c.origBytes)} → ${fmtBytes(c.bytes)}`;
    const down = sum.svc === 'down';
    pill.className = `pill ${sub.status === 'uploading' && (down || sum.paused) ? 'paused' : sub.status}`;
    pill.textContent = sub.status === 'complete' ? (doc?.amended ? 'Delivered · amended' : 'Delivered') : sub.status === 'failed' ? 'Needs attention' : sub.status === 'shared' ? (c.total - c.done - c.failed > 0 ? 'Sending photos' : 'Collaborating') : sum.paused ? 'Paused' : down ? 'Waiting for service' : sub.status === 'queued' ? 'Queued' : 'Uploading';

    const safe = c.done, tot = c.total;
    let text;
    if (sub.status === 'complete') text = [icon('check'), `Record #${sub.recordId} committed. ${sub.shared ? 'Team record' : `All ${tot} photo${tot === 1 ? '' : 's'}`} verified on server.${tot ? ' Local copies freed.' : ''}`];
    else if (sub.status === 'failed') text = [icon('alert'), `Stopped: ${sub.error?.detail || 'see error below'}`];
    else if (sub.status === 'shared') text = [icon('upload'), `${doc?.pending.length ? `${doc.pending.length} edit(s) waiting to sync · ` : 'All edits synced · '}your photos ${safe}/${tot} on server${down ? ' (paused — no signal)' : ''}`];
    else if (sum.paused) text = [icon('pause'), `Paused by you. ${safe}/${tot} photos safe on server. Nothing is lost.`];
    else if (down) text = [icon('wifi'), `No usable signal. Upload stopped in place at ${safe}/${tot}. It resumes automatically — already-sent photos won’t be re-sent.`];
    else text = [icon('upload'), sub.began ? `Sending ${c.uploading} at a time · ${safe}/${tot} photos safe on server${c.retrying ? ` · ${c.retrying} waiting to retry` : ''}` : 'Handshaking with server…'];
    headline.replaceChildren(...text);
    headline.className = `headline ${sub.status === 'failed' ? 'bad' : sub.status === 'complete' ? 'good' : down ? 'warn' : ''}`;

    const pct = (n) => `${tot ? (n / tot) * 100 : 0}%`;
    [...seg.children].forEach((i, k) => { i.style.width = pct([c.done, c.uploading, c.retrying, c.failed][k]); });
    seg.hidden = legend.hidden = tot === 0;
    legend.replaceChildren(...[['done', c.done, 'sent'], ['uploading', c.uploading, 'sending'], ['retrying', c.retrying, 'retrying'], ['queued', c.queued, 'queued'], ['failed', c.failed, 'failed']]
      .filter(([, n]) => n).map(([k, n, l]) => h('span', {}, h('i', { style: `background:${COLORS[k]}` }), `${n} ${l}`)));
    drawDots(items);

    errbox.replaceChildren();
    if (sub.status === 'failed') {
      const d = describe(sub.error?.code);
      errbox.append(h('div', { class: 'issue' }, h('div', { class: 'issue-top' }, h('code', { class: 'chip err' }, sub.error?.code), h('b', {}, d.title)), h('p', {}, d.cause), h('small', { class: 'muted' }, sub.error?.detail || '')));
    }
    const buttons = [];
    if (sub.status === 'failed') {
      if (d0(sub).action === 'retry') buttons.push(h('button', { class: 'btn small primary', onclick: () => engine.retry(sub.id) }, icon('refresh', 15), d0(sub).fix));
      buttons.push(h('button', { class: 'btn small', onclick: () => reportSub(sub) }, icon('upload', 15), sub.reported ? 'Reported · add details' : 'Send to dev team'));
      buttons.push(h('button', { class: 'btn small ghost', onclick: () => exportSub(sub) }, icon('download', 15), 'Export record'));
    } else if (sub.status === 'complete') {
      buttons.push(h('button', { class: 'btn small ghost', onclick: () => exportSub(sub) }, icon('download', 15), 'Export record'), h('button', { class: 'btn small ghost danger', onclick: async () => { await engine.deleteSub(sub.id); collab.docs.delete(sub.id); render(); } }, 'Clear'));
    } else {
      buttons.push(sum.paused ? h('button', { class: 'btn small primary', onclick: () => engine.resume() }, icon('play', 15), 'Resume') : h('button', { class: 'btn small', onclick: () => engine.pause() }, icon('pause', 15), 'Pause'));
      buttons.push(h('button', { class: 'btn small ghost', onclick: () => { engine.nudge(); collab.nudge(); } }, icon('refresh', 15), 'Retry now'));
      if (sub.shared) buttons.push(h('button', { class: 'btn small ghost', onclick: () => go('form', { subId: sub.id }) }, 'Open'));
    }
    actions.replaceChildren(...buttons);
  };
  return { el, update };
}

function outbox() {
  const list = h('div', {});
  let ids = '', cards = [];
  const subsNow = () => [...engine.subs.values()].filter((s) => s.status !== 'draft').sort((a, b) => b.submittedAt - a.submittedAt);
  const build = () => {
    const subs = subsNow();
    ids = subs.map((s) => s.id + s.status).join();
    cards = subs.map((s) => subCard(s));
    list.replaceChildren(...(cards.length ? cards.map((c) => c.el) : [h('div', { class: 'empty' }, icon('upload', 32), h('p', {}, 'Nothing waiting to send.'), h('small', {}, 'Submitted surveys appear here, and stay safe on the device until the server confirms every photo.'))]));
    cards.forEach((c) => c.update());
    requestAnimationFrame(() => cards.forEach((c) => c.update()));      // once attached, so the dot grid measures its real width
  };
  live = () => { if (subsNow().map((s) => s.id + s.status).join() !== ids) build(); else cards.forEach((c) => c.update()); };
  build();
  return h('div', { class: 'screen' }, appbar('Outbox', 'Background upload queue', $chip), h('div', { class: 'scroll pad' }, list));
}

// ---- problem reports -------------------------------------------------------------------------------
function reportSheet(subId, prefill = '') {
  const msg = h('textarea', { class: 'input', rows: 4, placeholder: 'What happened? (optional — the log is attached automatically)' });
  msg.value = prefill;
  const inc = h('input', { type: 'checkbox', checked: true });
  const close = modal('Send to dev team',
    h('p', { class: 'muted' }, 'Sends the last 300 log lines, this phone’s network and queue state, app version' + (subId ? ' and the record’s answers and photo states (not the photos)' : '') + '. If you have no signal it is queued and sent automatically.'),
    msg, subId ? h('label', { class: 'check-line' }, inc, ' Include this record') : null,
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => close() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async () => { close(); await reporter.send({ message: msg.value, subId, includeRecord: inc.checked }); toast(server.profile.offline ? 'Report saved — will send when you have signal.' : 'Report sent to the dev team.'); } }, 'Send report')));
}

// ---- health -----------------------------------------------------------------------------------------
function health() {
  const tiles = h('div', { class: 'tiles' });
  const logBox = h('div', { class: 'log' });
  let filter = 'all';
  const filters = h('div', { class: 'seg-ctl' }, ['all', 'warn', 'error'].map((f) => h('button', { class: f === filter ? 'on' : '', onclick: (e) => { filter = f; [...e.target.parentElement.children].forEach((b) => b.classList.toggle('on', b === e.target)); live(); } }, f === 'all' ? 'All' : f === 'warn' ? 'Warnings' : 'Errors')));
  let quota = '…';
  navigator.storage?.estimate?.().then((e) => { quota = `${fmtBytes(e.usage)} of ${fmtBytes(e.quota)}`; live?.(); });
  const auto = h('input', { type: 'checkbox', checked: LS.get('autoReport', true), onchange: (e) => LS.set('autoReport', e.target.checked) });
  live = () => {
    const s = engine.summary(), st = server.stats(), p = server.profile;
    const tile = (label, value, cls = '') => h('div', { class: `tile ${cls}` }, h('b', {}, value), h('small', {}, label));
    const down = s.svc === 'down' || p.offline;
    tiles.replaceChildren(
      tile('Pending uploads', s.pending, s.pending ? 'mid' : ''), tile('Failed', s.failed, s.failed ? 'bad' : 'good'),
      tile('Retries so far', s.retries), tile('Duplicates prevented', st.dupesPrevented, 'good'),
      tile('Queue on device', fmtBytes(s.queueBytes)), tile('Unsynced team edits', collab.unsynced(), collab.unsynced() ? 'mid' : 'good'),
      tile('Network', down ? 'Down' : 'Up', down ? 'bad' : 'good'), tile('Reports waiting', reporter.pending, reporter.pending ? 'mid' : 'good'),
      tile('Phones nearby', nearby.enabled ? nearby.peerList().length : 'off'), tile('Freed after confirm', fmtBytes(s.freedBytes)), tile('Device storage', quota));
    const rows = engine.logs.filter((e) => filter === 'all' || (filter === 'warn' ? e.level !== 'info' : e.level === 'error')).slice(-80).reverse();
    logBox.replaceChildren(...(rows.length ? rows.map((e) => h('div', { class: `logrow ${e.level}` }, h('time', {}, fmtTime(e.ts)), e.code ? h('code', { class: 'chip ' + (e.level === 'error' ? 'err' : '') }, e.code) : null, h('span', {}, e.msg))) : [h('div', { class: 'empty' }, h('small', {}, 'No entries.'))]));
  };
  live();
  return h('div', { class: 'screen' }, appbar('Health', 'Queue, network and sync log', $chip),
    h('div', { class: 'scroll pad' }, tiles,
      h('div', { class: 'card' }, h('b', {}, 'Something wrong?'), h('p', { class: 'muted' }, 'Send the dev team everything they need to trace it — no screenshots or log hunting.'),
        h('button', { class: 'btn primary big', onclick: () => reportSheet(null) }, icon('upload', 16), 'Report a problem'),
        h('label', { class: 'check-line' }, auto, ' Auto-send diagnostics when a record fails'),
        h('small', { class: 'muted block' }, `App ${APP_VERSION} · device ${device.id}`)),
      h('div', { class: 'card' }, h('b', {}, device.name), h('small', { class: 'muted block' }, `${device.email} · ${(auth.profile?.organizations || []).length} organization${(auth.profile?.organizations || []).length === 1 ? '' : 's'}`),
        h('p', { class: 'muted' }, 'Signed in with your FieldSync account. You stay signed in until the app is updated.'),
        h('button', { class: 'btn small', onclick: () => { if (confirm('Sign out? Records on this phone stay until you sign in again.')) { auth.signOut(); location.reload(); } } }, 'Sign out')),
      h('div', { class: 'row between' }, h('h3', {}, 'Sync log'), h('button', { class: 'btn small', onclick: async () => download('sync-log.json', { exportedAt: new Date().toISOString(), device, appVersion: APP_VERSION, summary: engine.summary(), server: server.stats(), entries: await db.getAll('log') }) }, icon('download', 15), 'Export')),
      filters, logBox));
}

// ---- dev ----------------------------------------------------------------------------------------------
function conditions() {
  const box = h('div', { class: 'conditions' });
  const draw = () => {
    box.replaceChildren(
      h('h3', {}, `Field conditions · ${device.name}`),
      h('div', { class: 'radios' }, Object.entries(PROFILES).map(([k, p]) => h('button', { class: 'radio' + (server.profileName === k ? ' on' : ''), onclick: () => { server.setProfile(k); LS.set('profile', k); engine.nudge(); collab.nudge(); reporter.nudge(); lookups.nudge(); orgs.nudge(); engine._log('info', null, `Network set to “${p.label}”.`); draw(); renderChip(); } },
        h('i', { class: 'dot' }), h('span', {}, h('b', {}, p.label), h('small', {}, p.offline ? 'every request fails' : `${p.mbps} Mbps · ${Math.round(p.fail * 100)}% dropped · ${Math.round(p.ackLoss * 100)}% replies lost`))))),
      h('label', { class: 'lbl' }, 'Demo speed'),
      h('select', { class: 'input', onchange: (e) => { const n = Number(e.target.value); server.scale = engine.scale = n; LS.set('scale', n); } },
        [[1, '1× (realistic)'], [4, '4× (default)'], [12, '12× (fast)']].map(([v, l]) => h('option', { value: v, selected: v === scale }, l))),
      h('div', { class: 'stack' },
        h('button', { class: 'btn small', onclick: () => location.reload() }, icon('refresh', 15), 'Kill app now (reload)'),
        h('button', { class: 'btn small', onclick: async () => { await server.setMinSchema(server.stats().minSchema + 1); toast(`Server now requires form v${server.stats().minSchema}+`); engine._log('info', null, `Server now requires form v${server.stats().minSchema}+.`); render(); } }, 'Server: require form v+1'),
        h('button', { class: 'btn small danger', onclick: async () => { if (!confirm('Erase this phone’s data AND the server’s records, shared surveys and reports?')) return; for (const s of ['submissions', 'media', 'blobs', 'log', 'shared', 'issues']) await db.clear(s); await server.reset().catch(() => {}); Object.keys(localStorage).filter((k) => k.startsWith(`fc.${device.id}.`)).forEach((k) => localStorage.removeItem(k)); location.reload(); } }, 'Reset this phone + server')));
  };
  draw();
  return box;
}

function dev() {
  const ta = h('textarea', { class: 'json', spellcheck: false, rows: 12 });
  ta.value = JSON.stringify(ctx.survey, null, 2);
  const problems = h('div', {});
  const scopeIn = h('input', { class: 'input', placeholder: 'Scope of work (e.g. CONS-MOD, Inspections, COP)', 'aria-label': 'Scope of work' });
  const adopt = (parsed, publish) => {
    parsed.scope = scopeIn.value.trim() || parsed.scope || 'Other'; library.merge([parsed]);
    ctx.survey = parsed; LS.set('survey', parsed); ta.value = JSON.stringify(parsed, null, 2); applyTheme();
    if (publish) server.publishForm(parsed).then(() => toast('Form shared with the team')).catch((e) => toast(`Could not publish yet (${e.code}). It stays on this phone.`));
  };
  const showProblems = (list) => problems.replaceChildren(...list.map((x) => h('div', { class: 'issue' }, h('code', { class: 'chip err' }, x.path), h('p', {}, x.message))));
  const load = (publish) => {
    let parsed;
    try { parsed = JSON.parse(ta.value); } catch (e) { return showProblems([{ path: 'JSON', message: e.message }]); }
    const p = S.checkSurvey(parsed);
    if (p.length) return showProblems(p);
    adopt(parsed, publish);
    problems.replaceChildren(h('div', { class: 'ok-card' }, icon('check'), h('b', {}, `Loaded “${parsed.title}” v${parsed.version}${publish ? ' and shared with the team' : ''}`)));
  };

  // XLSForm import ----------------------------------------------------------------------------------
  const xlsOut = h('div', {});
  const handleXls = async (buf, name, files = {}) => {
    xlsOut.replaceChildren(h('p', { class: 'muted' }, `Reading ${name}…`));
    try {
      const XLSX = await loadSheetJS();
      const { survey, warnings } = convertWorkbook(XLSX, new Uint8Array(buf), { files });
      const probs = S.checkSurvey(survey);
      scopeIn.value = survey.scope || '';
      const fields = survey.pages.reduce((n, p) => n + p.fields.length, 0);
      xlsOut.replaceChildren(
        h('div', { class: probs.length ? 'issue' : 'ok-card' }, probs.length ? icon('alert') : icon('check'), h('div', {}, h('b', {}, `${survey.title}: ${survey.pages.length} pages, ${fields} questions`), h('p', {}, `${warnings.length} note${warnings.length === 1 ? '' : 's'} from the converter${probs.length ? `, ${probs.length} problem(s)` : ''}.`))),
        probs.map((x) => h('div', { class: 'issue' }, h('code', { class: 'chip err' }, x.path), h('p', {}, x.message))),
        warnings.length ? h('details', { class: 'warns' }, h('summary', {}, `Conversion notes (${warnings.length})`), warnings.map((w) => h('div', { class: 'logrow warn' }, h('code', { class: 'chip' }, w.row ? `row ${w.row}` : 'file'), h('span', {}, w.message)))) : null,
        probs.length ? null : h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => { adopt(survey, false); toast(`Loaded “${survey.title}”`); } }, 'Use on this phone'), h('button', { class: 'btn', onclick: () => { adopt(survey, true); } }, 'Use + share with team')));
    } catch (e) { xlsOut.replaceChildren(h('div', { class: 'issue' }, h('code', { class: 'chip err' }, 'ERR-GEN-000'), h('p', {}, e.message))); }
  };
  const loadDemoLibrary = async () => {
    try {
      const XLSX = await loadSheetJS();
      const { survey } = convertWorkbook(XLSX, new Uint8Array(await (await fetch('CONS-MOD%20Prework%20Inspection.xlsx')).arrayBuffer()), { files: { 'customers.csv': await (await fetch('customers.csv')).text() } });
      survey.scope = 'CONS-MOD'; survey.tile = PREWORK_TILE;
      const all = [survey, ...demoPlaceholders()];
      library.merge(all);
      let shared = 0; for (const f of all) { try { await server.publishForm(f); shared++; } catch { /* offline: stays on this phone */ } }
      toast(`${all.length} surveys loaded${shared === all.length ? ' and shared with the team' : ' (not shared yet: no signal)'}`); render();
    } catch (e) { toast(`${e.code || 'ERR-GEN-000'}: ${e.message}`, 5000); }
  };
  const fileIn = h('input', { type: 'file', accept: '.xlsx,.xls,.xlsm,.csv', multiple: true, hidden: true, onchange: async (e) => {
    const all = [...e.target.files], book = all.find((f) => /\.xls[xm]?$/i.test(f.name));
    if (!book) { toast('Choose the .xlsx form (and any CSV lists it uses) together.'); return; }
    const files = {}; for (const f of all.filter((x) => /\.csv$/i.test(x.name))) files[f.name] = await f.text();
    handleXls(await book.arrayBuffer(), book.name, files); e.target.value = '';
  } });

  // stress test --------------------------------------------------------------------------------------
  const stress = h('div', { class: 'stress' });
  const count = h('input', { class: 'input', type: 'number', value: 400, min: 1, max: 500 });
  const asTeam = h('input', { type: 'checkbox' });
  const run = h('button', { class: 'btn primary', onclick: async () => {
    const n = Math.max(1, Math.min(500, Number(count.value) || 400));
    const field = ctx.survey.pages.flatMap((p) => p.fields).find((f) => f.type === 'image' && (f.maxFiles ?? Infinity) >= n);
    if (!field) { toast(`No top-level photo question allows ${n} photos in this survey.`, 5000); return; }
    run.disabled = true;
    let sub;
    if (asTeam.checked) { const doc = collab.create({ survey: ctx.survey, title: `${ctx.survey.title} · ${n} photos · ${device.name}` }); seedTeamDefaults(doc); sub = engine.subs.get(doc.id); sub.answers = collab.open(doc.id); }
    else sub = newDraft();
    Object.assign(sub.answers, { siteId: `TWR-${Math.floor(1000 + Math.random() * 9000)}`, site_id: `TWR-${Math.floor(1000 + Math.random() * 9000)}`, inspector: device.name, towerType: 'guyed', hasDamage: 'no' });
    const prog = h('div', {}); stress.append(prog);
    const t0 = performance.now();
    const items = Array.from({ length: n }, (_, i) => () => makeTestPhoto(i));
    const r = await addImages(engine, sub, field.name, items, { onProgress: (p) => prog.replaceChildren(h('div', { class: 'bar' }, h('i', { style: `width:${(p.done / p.total) * 100}%` })), h('small', {}, `Generating & compressing ${p.done}/${p.total} · ${fmtBytes(p.origBytes)} → ${fmtBytes(p.bytes)}`)) });
    sub.answers[field.name] = r.ids; S.recalc(ctx.survey, sub.answers);
    if (sub.shared) collab.localChanged(sub.id, sub.answers); else await db.put('submissions', sub);
    toast(`${r.ids.length} photos ready in ${((performance.now() - t0) / 1000).toFixed(0)}s (${fmtBytes(r.origBytes)} → ${fmtBytes(r.bytes)})${r.errors.length ? ` · ${r.errors.length} failed` : ''}`, 5000);
    run.disabled = false; go('review', { subId: sub.id });
  } }, 'Build demo record');
  stress.append(h('h3', {}, 'Bulk photo stress test'), h('p', { class: 'muted' }, 'Generates phone-sized JPEGs (a few 20 MP+), runs them through the real compression pipeline, and opens the record for review.'),
    h('div', { class: 'row' }, count, run), h('label', { class: 'check-line' }, asTeam, ' As a team record (photos upload while collecting)'));

  return h('div', { class: 'screen' }, appbar('Dev', 'JSON or XLSForm in → survey out', $chip),
    h('div', { class: 'scroll pad' }, h('div', { class: 'only-narrow' }, conditions()),
      h('div', { class: 'card' }, h('b', {}, 'Import a Survey123 / XLSForm spreadsheet'), h('p', { class: 'muted' }, 'Reads the survey, choices and settings sheets in the browser — works offline. Select the .xlsx together with any CSV lists it uses (e.g. customers.csv).'),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => fileIn.click() }, icon('upload', 15), 'Choose .xlsx'),
          h('button', { class: 'btn', onclick: async () => handleXls(await (await fetch('CONS-MOD%20Prework%20Inspection.xlsx')).arrayBuffer(), 'CONS-MOD Prework Inspection.xlsx', { 'customers.csv': await (await fetch('customers.csv')).text() }) }, 'Load CONS-MOD Prework'),
          h('button', { class: 'btn', onclick: loadDemoLibrary }, 'Load demo library'),
          h('button', { class: 'btn', onclick: async () => handleXls(await (await fetch('samples/tower-inspection.xlsx')).arrayBuffer(), 'tower-inspection.xlsx') }, 'Load tower sample'),
          h('a', { class: 'btn ghost', href: 'samples/tower-inspection.xlsx', download: true }, 'Download sample')), fileIn, xlsOut),
      stress,
      h('h3', {}, 'Scope of work'), scopeIn, h('h3', {}, 'Survey JSON'), ta,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => load(false) }, 'Validate & load'), h('button', { class: 'btn', onclick: () => load(true) }, 'Load + share with team'), h('button', { class: 'btn ghost', onclick: () => { ta.value = JSON.stringify(SAMPLE_SURVEY, null, 2); load(false); } }, 'Reset to sample')), problems));
}

// =================================================================================================
// mount
// =================================================================================================
const side = h('aside', { class: 'side' },
  h('div', { class: 'brand' }, h('b', {}, 'Field Collect'), h('small', {}, 'prototype · reliability-first survey collection')),
  conditions(),
  h('div', { class: 'guide' }, h('h3', {}, 'Things to try'), h('ol', {},
    h('li', {}, 'Dev tab → ', h('b', {}, 'Build demo record'), ' (400 photos) → Save & send.'),
    h('li', {}, 'Switch to ', h('b', {}, 'Flaky'), ' or ', h('b', {}, 'No service'), ' mid-upload, then restore it.'),
    h('li', {}, 'Open ', h('b', {}, '/'), ' (the multi-phone page) to work on one survey from two phones at once.'))));

document.getElementById('app').append(h('div', { class: 'stage' },
  h('div', { class: 'device' }, h('div', { class: 'statusbar' }, $clock, h('span', { class: 'notch' })), $screen, $toast, $modal, $tabs), side));
$clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const applyProfile = (p) => { device.name = p.name; device.email = p.email; device.username = p.username; try { localStorage.setItem('fc.device', JSON.stringify(device)); } catch { /* ignore */ } };

// ---- sign-in: the same FieldSync account as the web app (Microsoft login, or username + password) ----------
function signInScreen(done) {
  const msg = h('div', { class: 'inline-err', role: 'alert' });
  const user = h('input', { class: 'input', autocomplete: 'username', placeholder: 'Username or email', autocapitalize: 'none' });
  const pass = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'Password' });
  const fail = (e) => { msg.textContent = `${e.code || 'ERR-GEN-000'}: ${describe(e.code || 'ERR-GEN-000').title}${e.code === 'ERR-NET-002' || e.code === 'ERR-NET-001' ? ' — you need a signal to sign in the first time.' : ''}`; };
  const ok = (p) => { applyProfile(p); done(); };
  const doPassword = () => { msg.textContent = ''; auth.passwordLogin(user.value.trim(), pass.value).then(ok, fail); };
  const msBtn = h('button', { class: 'btn big ms', onclick: () => {
    const email = h('input', { class: 'input', type: 'email', placeholder: 'name@company.com', autocapitalize: 'none' });
    const close = modal('Sign in with Microsoft', h('p', { class: 'muted' }, 'Simulated in this prototype. The real app opens the Microsoft sign-in page and matches the account to your FieldSync user.'), email,
      h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => { msg.textContent = ''; auth.microsoftLogin(email.value.trim()).then((p) => { close(); ok(p); }, (e) => { close(); fail(e); }); } }, 'Continue')));
    setTimeout(() => email.focus(), 50);
  } }, h('span', { class: 'mslogo' }, h('i'), h('i'), h('i'), h('i')), 'Sign in with Microsoft');
  pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') doPassword(); });
  return h('div', { class: 'screen signin' }, h('header', { class: 'appbar' }, h('div', { class: 'ab-title' }, h('b', {}, 'Field Collect'), h('small', {}, 'Sign in with your FieldSync account'))),
    h('div', { class: 'scroll pad' }, h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Use the same sign-in as the FieldSync web app. You only need to do this once — not again until the app is updated.'),
      msBtn, h('div', { class: 'or' }, 'or'), h('label', { class: 'lbl' }, 'Username'), user, h('label', { class: 'lbl' }, 'Password'), pass, msg,
      h('button', { class: 'btn primary big', onclick: doPassword }, 'Sign in'))));
}

async function ensureSignedIn() {
  if (auth.signedIn) { applyProfile(auth.profile); return; }
  const pre = qs.get('signin');                                                // demo shortcut for the multi-phone page: password:user:pass | microsoft:email
  if (pre) { const [kind, a, b] = pre.split(':'); try { applyProfile(kind === 'microsoft' ? await auth.microsoftLogin(a) : await auth.passwordLogin(a, b)); return; } catch { /* fall through to the sign-in screen */ } }
  $tabs.hidden = true;
  await new Promise((resolve) => { $screen.replaceChildren(signInScreen(resolve)); });
}

// ---- an account removed in the web app: records already sent stay on the server; this phone keeps what it has ----
function showRevoked() {
  $tabs.hidden = true;
  $screen.replaceChildren(h('div', { class: 'screen' }, h('header', { class: 'appbar' }, h('div', { class: 'ab-title' }, h('b', {}, 'Account removed'))),
    h('div', { class: 'scroll pad' }, h('div', { class: 'issue' }, h('div', { class: 'issue-top' }, h('code', { class: 'chip err' }, 'ERR-AUTH-001'), h('b', {}, describe('ERR-AUTH-001').title)), h('p', {}, describe('ERR-AUTH-001').cause),
      h('p', { class: 'muted' }, 'Anything already submitted is safe on the server. Unsent records stay on this phone until you export them.'),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: async () => download('records-on-this-phone.json', { exportedAt: new Date().toISOString(), user: device.username, records: [...engine.subs.values()].map((s) => ({ ...s, media: engine.mediaFor(s.id).map(({ thumb, ...m }) => m) })) }) }, icon('download', 15), 'Export records on this phone'),
        h('button', { class: 'btn', onclick: () => { auth.signOut(); location.reload(); } }, 'Sign in with another account'))))));
}
auth.addEventListener('revoked', showRevoked);
auth.addEventListener('profile', () => { const p = auth.profile; if (p) { applyProfile(p); orgs.nudge(); } });

await ensureSignedIn();
lookups.install({ username: device.username, email: device.email }, auth.profile);
orgs.refresh();
await engine.start(); await collab.start(); await reporter.start();
server.refreshStats();
auth.refreshProfile();
setInterval(() => { if (!server.profile.offline && auth.signedIn) auth.refreshProfile(); }, 60000);
render();
window.__fc = { engine, server, db, ctx, collab, reporter, device, nearby };   // handy in devtools and the multi-phone page
