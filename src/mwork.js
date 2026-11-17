// Assigned work (the PM feature on the phone): My work as a list or a map, visit detail with the status actions the user is
// allowed, Block with a required reason, claim an open visit, attach an unallocated survey to a visit. Visits are cached on the
// phone; Start / Block / Unblock / Complete queue offline and sync later with an idempotency key (so a replay cannot apply twice).

import { AppError, NetError, describe } from './errors.js';

const TONE = { assigned: '#1F6FB5', in_progress: '#424CCC', blocked: '#D98C1A', complete: '#2E8B57', unassigned: '#5A6378' };
const COL = { done: '#2E8B57', prog: '#424CCC', warn: '#D98C1A', none: '#8F9AAE', open: '#C3CAD8' };      // green complete, indigo in progress, amber blocked or overdue
const ACTION_TEXT = { start: 'Started', block: 'Blocked', unblock: 'Unblocked', complete: 'Completed' };
const NEXT = { start: 'in_progress', block: 'blocked', unblock: 'in_progress', complete: 'complete' };
const SCOPE_TONE = { Inspection: 'progress', 'CONS-MOD': 'violet' };

export function install(M) {
  const { h, icon, server, engine, LS } = M;
  let visits = LS.get('visits', []);
  let ops = LS.get('vops', []);
  let open = [];                                         // unassigned visits (claim list)
  let flushing = false, claimMsg = '';

  if (LS.get('vschema', 0) !== 2) { visits = []; ops = []; LS.set('vschema', 2); }      // older cached visits (one survey each) are dropped and fetched again
  const save = () => { LS.set('visits', visits); LS.set('vops', ops); };
  M.visitList = () => visits;
  M.pendingOps = () => ops.length;
  const visible = () => visits.filter((v) => M.org() === 'all' || v.orgId === M.org());
  const byId = (id) => visits.find((v) => v.id === id);
  const today = () => new Date().toISOString().slice(0, 10);
  /** Past its due date and not complete. */
  const overdue = (v) => v.status !== 'complete' && v.status !== 'unassigned' && !!v.due && v.due < today();
  M.overdue = overdue;

  // ---- sync ------------------------------------------------------------------------------------
  async function refresh() {
    if (!M.auth.signedIn || !M.online()) return;
    try {
      await flush(); const r = await server.visitsAll({ org: 'all' });
      visits = r.visits.map((sv) => (ops.some((o) => o.id === sv.id) ? byId(sv.id) || sv : sv));     // a visit with a change still waiting to sync keeps its local copy
      save(); M.redraw();
    } catch { /* offline or signed out: keep the cached list */ }
  }
  M.refreshVisits = refresh;
  async function flush() {
    if (flushing) return; flushing = true;
    try {
      while (ops.length) {
        const op = ops[0];
        try { const r = await (op.surveyId ? (op.action === 'assign' ? server.surveyAssign(op.id, op) : server.surveyStatus(op.id, op)) : server.visitStatus(op.id, op)); const i = visits.findIndex((v) => v.id === op.id); if (i >= 0) visits[i] = r.visit; ops.shift(); }
        catch (e) {
          if (e instanceof NetError) break;
          ops.shift(); const code = e.code || 'ERR-GEN-000';
          if (e.data?.visit) { const i = visits.findIndex((v) => v.id === op.id); if (i >= 0) visits[i] = e.data.visit; }
          M.plain(code);
        }
      }
    } finally { flushing = false; save(); M.redraw(); }
  }
  M.plain = (code, extra) => { const d = describe(code); M.dialog(h('h2', {}, d.title), h('p', {}, extra || d.cause), h('button', { type: 'button', class: 'btn primary big', onclick: (e) => e.target.closest('.sheet-wrap').querySelector('.sheet-dim').click() }, 'OK')); };
  setInterval(() => { if (M.auth.signedIn) refresh(); }, 4000);
  let lastDelivered = 0;                                   // a delivered survey can finish its visit on the server: look again right away
  engine.addEventListener('change', () => { const n = [...engine.subs.values()].filter((x) => x.status === 'complete').length; if (n !== lastDelivered) { lastDelivered = n; refresh(); } });
  M.afterOrgChange = () => { visits = []; save(); refresh(); };
  M.accessEnded = (org) => { visits = visits.filter((v) => v.orgId !== org); ops = ops.filter((o) => byId(o.id)); save(); };

  /** Start, Block, Unblock or Complete: shown at once, queued, sent when there is signal. */
  async function act(v, action, reason) {
    const op = { key: M.uid(), id: v.id, action, reason: reason || undefined, rev: v.rev + ops.filter((o) => o.id === v.id).length };
    v.status = NEXT[action]; v.blockedReason = action === 'block' ? reason : ''; v.pending = true;
    (v.history ||= []).push({ at: today(), text: `${ACTION_TEXT[action]}${action === 'block' ? `: ${reason}` : ''} (syncs when you have signal)` });
    ops.push(op); save(); M.redraw();
    if (M.online()) await flush(); else M.toast('Saved on this phone. It syncs when you have signal.');
  }

  /** Mirror of the server rule so a change made offline shows the right visit status at once. */
  const localRecompute = (v) => {
    if (v.status === 'complete' || v.status === 'unassigned') return;
    const req = (v.surveys || []).filter((x) => x.need === 'required'), blocked = req.filter((x) => x.blocked);
    if (req.length && req.every((x) => x.submitted)) v.status = 'complete';
    else if (blocked.length) { v.status = 'blocked'; v.blockedReason = blocked.length === 1 ? blocked[0].reason : blocked.map((x) => `${x.title}: ${x.reason}`).join('; '); } else { v.status = v.status === 'blocked' ? 'in_progress' : v.status; v.blockedReason = ''; }
  };
  /** Block, unblock, or take (assign to me) one survey of a visit: queued offline like any status change. There is no "complete": a survey is done when it is submitted. */
  async function actSurvey(v, sv, action, reason) {
    const op = { key: M.uid(), id: v.id, surveyId: sv.id, action, reason: reason || undefined };
    if (action === 'assign') {
      const from = sv.assigneeName; sv.assignee = M.device.email; sv.assigneeName = M.device.name; sv.mine = true; v.mine = true;
      if (v.status === 'unassigned') { v.status = 'assigned'; v.accountable = M.device.name; }
      (v.history ||= []).push({ at: today(), text: `${sv.title} ${from ? `taken over from ${from}` : 'assigned'} (syncs when you have signal)` });
    } else {
      sv.blocked = action === 'block'; sv.reason = action === 'block' ? reason : ''; localRecompute(v);
      (v.history ||= []).push({ at: today(), text: `${sv.title} ${action === 'block' ? `blocked: ${reason}` : 'unblocked'} (syncs when you have signal)` });
    }
    v.pending = true; ops.push(op); save(); M.redraw();
    if (M.online()) await flush(); else M.toast('Saved on this phone. It syncs when you have signal.');
  }
  /** Opening the first survey of a visit starts it. */
  M.startVisit = async (v) => { if (v.status === 'assigned') await act(v, 'start'); };
  const reqCount = (v) => { const r = (v.surveys || []).filter((x) => x.need === 'required'); return { done: r.filter((x) => x.submitted).length, total: r.length }; };
  /** What a survey of a visit shows: server truth first (submitted, blocked), then what is on this phone (draft, sending). */
  const surveyState = (v, sv) => {
    const recs = [...engine.subs.values()].filter((x) => !x.shared && x.visitId === v.id && x.surveyId === sv.id);
    if (sv.submitted || recs.some((x) => x.status === 'complete')) return { label: 'Submitted', tone: 'complete', rec: recs.find((x) => x.status === 'complete') };
    const sending = recs.find((x) => ['queued', 'uploading'].includes(x.status)), ready = recs.find((x) => x.status === 'ready'), failed = recs.find((x) => x.status === 'failed'), draft = recs.find((x) => x.status === 'draft');
    if (failed) return { label: 'Needs attention', tone: 'err', rec: failed };
    if (sending) return { label: 'Sending', tone: 'progress', rec: sending };
    if (ready) return { label: 'In the queue', tone: 'progress', rec: ready };
    if (sv.blocked) return { label: 'Blocked', tone: 'blocked', rec: draft };
    if (!sv.mine) return sv.assignee ? { label: 'Assigned', tone: 'assigned' } : { label: 'Not assigned', tone: 'muted' };
    if (draft) return { label: 'Draft', tone: 'progress', rec: draft };
    return { label: 'Not started', tone: 'muted' };
  };
  M.surveyState = surveyState;
  /** Colour group of a survey: done (green), prog (indigo), warn (amber: blocked, overdue, needs attention), none. */
  const svBucket = (v, sv) => { const l = surveyState(v, sv).label; return l === 'Submitted' ? 'done' : l === 'Blocked' || l === 'Needs attention' || overdue(v) ? 'warn' : ['Draft', 'Sending', 'In the queue'].includes(l) ? 'prog' : 'none'; };
  const visitBucket = (v) => (v.status === 'complete' ? 'done' : v.status === 'blocked' || overdue(v) ? 'warn' : v.status === 'in_progress' ? 'prog' : 'none');
  /** The next survey worth opening in a visit: not submitted, not blocked, nothing waiting on it; required first, then mine, then open ones. Surveys that belong to someone else are not suggested. */
  M.nextSurvey = (visitId, afterId) => {
    const v = byId(visitId); if (!v) return null;
    const ok = (sv) => sv.id !== afterId && !sv.submitted && !sv.blocked && (sv.mine || !sv.assignee) && ['Not started', 'Draft', 'Not assigned'].includes(surveyState(v, sv).label);
    const pick = (v.surveys || []).filter(ok).sort((a, b) => (a.need === b.need ? 0 : a.need === 'required' ? -1 : 1) || (b.mine - a.mine))[0];
    return pick ? { visit: v, sv: pick } : null;
  };
  /** The visit a survey belongs to by its site: no attaching needed when the site is a visit's site and the visit's scope contains that survey. */
  M.matchVisit = (siteId, surveyId, orgId) => {
    const n = (x) => String(x ?? '').trim().toLowerCase(); if (!n(siteId)) return null;
    const hits = visits.filter((v) => n(v.siteId) === n(siteId) && (!orgId || v.orgId === orgId) && (v.surveys || []).some((x) => x.id === surveyId));
    return hits.find((v) => v.status !== 'complete') || hits[0] || null;
  };
  /** Take it if it is not yours yet, then open it. One tap from anywhere. */
  M.takeAndOpen = async (v, sv) => { if (!sv.mine) await actSurvey(v, sv, 'assign'); await M.openSurveyForVisit(v, sv.id); };
  /** The visit's surveys as a switcher list for inside a survey. */
  M.visitNav = (sub) => {
    const v = byId(sub.visitId); if (!v) return null;
    return { title: `${v.name} · ${v.scope}`, rows: (v.surveys || []).map((sv) => { const st = surveyState(v, sv); return { title: sv.title, need: sv.need, label: sv.submitted ? 'Submitted' : sv.blocked ? 'Blocked' : st.label === 'Assigned' || st.label === 'Not assigned' ? who(sv) : st.label, current: sv.id === sub.surveyId, disabled: sv.submitted || sv.blocked || (!sv.mine && !!sv.assignee), go: () => M.takeAndOpen(v, sv) }; }) };
  };
  const who = (sv) => (sv.mine ? 'You' : sv.assigneeName || 'Not assigned');
  const mineCount = (v) => (v.surveys || []).filter((x) => x.mine).length;
  const visitLine = (v) => `${v.scope} · ${(v.surveys || []).length} surveys${mineCount(v) ? ` · ${mineCount(v)} yours` : ''}`;

  // ---- My work ---------------------------------------------------------------------------------
  const dueLine = (v) => (overdue(v) ? h('small', { class: 'overdue' }, `Overdue · was due ${M.fmtDue(v.due)}`) : h('small', { class: 'muted' }, `Due ${M.fmtDue(v.due)}`));
  const visitRow = (v, showOrg) => h('button', { type: 'button', class: 'vrow', onclick: () => { if (showOrg && M.org() === 'all') { LS.set('org', v.orgId); server.setOrg(v.orgId); } M.go('visit', { id: v.id }); } },
    h('div', { class: 'vtop' }, h('b', {}, v.name), M.statusPill(v.status)),
    h('div', { class: 'vmeta' }, M.pill(v.scope, SCOPE_TONE[v.scope] || 'muted'), h('small', { class: 'muted' }, `${(v.surveys || []).length} surveys · ${mineCount(v)} yours`), dueLine(v), showOrg ? M.pill(M.orgName(v.orgId), 'org') : null, v.pending ? h('small', { class: 'sync' }, icon('refresh', 12), 'Syncs when you have signal') : null),
    v.status !== 'complete' && reqCount(v).total ? h('small', { class: 'muted' }, `${reqCount(v).done} of ${reqCount(v).total} required surveys submitted`) : null,
    v.status === 'blocked' && v.blockedReason ? h('div', { class: 'vblock' }, `Blocked: ${v.blockedReason}`) : null,
    h('span', { class: 'chev' }, icon('chevron', 16)));
  /** A survey of a visit as a row: the survey type in large letters, the site (or site id) small underneath. */
  const stTone = (sv, st, x) => (st.label === 'Submitted' ? 'complete' : st.label === 'Blocked' || (x && overdue(x)) ? 'blocked' : sv.mine ? st.tone : sv.assignee ? 'assigned' : 'muted');
  /** The buttons a survey card carries, wherever the card is shown: start (with an arrow) and block, resume, unblock, or take it first if it is not yours. */
  const arrow = (label) => h('span', { class: 'btn-arrow' }, label, icon('chevron', 15));
  const svActions = (x, sv, st = surveyState(x, sv)) => {
    const btn = (cls, content, fn) => h('button', { type: 'button', class: `btn small ${cls}`, onclick: (e) => { e.stopPropagation(); fn(); } }, content);
    if (st.label === 'Submitted') return [];
    if (st.label === 'Needs attention') return [btn('primary', arrow('See what to do'), () => M.go('errordetail', { subId: st.rec.id }))];
    if (st.label === 'Sending' || st.label === 'In the queue') return [btn('', arrow('See in the queue'), () => M.go('queue', {}, { replace: true }))];
    if (!sv.mine) return [btn(sv.assignee ? '' : 'primary', sv.assignee ? 'Take over' : 'Assign to me', () => actSurvey(x, sv, 'assign'))];
    if (sv.blocked) return [btn('primary', 'Unblock', () => actSurvey(x, sv, 'unblock'))];
    return [btn('primary', arrow(st.label === 'Draft' ? 'Resume survey' : 'Start survey'), () => M.openSurveyForVisit(x, sv.id)), btn('', 'Block', () => blockSheet(x, sv))];
  };
  M.svActions = svActions;
  /** A survey of a visit as a card: the survey type in large letters, the site small underneath, and its own start / block buttons. Tapping the card opens the visit. */
  const surveyRow = (x, sv, o = {}) => {
    const st = surveyState(x, sv), label = !sv.mine && st.label !== 'Submitted' && st.label !== 'Blocked' ? (sv.assignee ? sv.assigneeName : 'Not assigned') : st.label, acts = svActions(x, sv, st);
    return h('div', { class: `vrow srow2 b-${svBucket(x, sv)}` + (o.nested ? ' nested' : '') },
      h('button', { type: 'button', class: 'srow-main', onclick: () => { if (o.showOrg) { LS.set('org', x.orgId); server.setOrg(x.orgId); } M.go('visit', { id: x.id }); } },
        h('div', { class: 'vtop' }, h('b', { class: 'bigt' }, sv.title), M.pill(label, stTone(sv, st, x))),
        o.nested ? null : h('div', { class: 'sub' }, x.name),
        h('div', { class: 'vmeta' }, o.nested ? null : M.pill(x.scope, SCOPE_TONE[x.scope] || 'muted'), sv.need === 'optional' ? h('small', { class: 'muted' }, 'optional') : null, o.nested ? null : dueLine(x), o.who && sv.mine ? h('small', { class: 'me' }, 'Yours') : null, o.showOrg ? M.pill(M.orgName(x.orgId), 'org') : null, x.pending ? h('small', { class: 'sync' }, icon('refresh', 12), 'Syncs when you have signal') : null),
        sv.blocked ? h('div', { class: 'vblock' }, `Blocked: ${sv.reason}`) : null),
      acts.length ? h('div', { class: 'row2s' }, ...acts) : null);
  };
  const visitHeader = (x, showOrg) => h('button', { type: 'button', class: 'vhead', onclick: () => { if (showOrg) { LS.set('org', x.orgId); server.setOrg(x.orgId); } M.go('visit', { id: x.id }); } },
    h('div', {}, h('b', {}, x.name), h('div', { class: 'vmeta' }, M.pill(x.scope, SCOPE_TONE[x.scope] || 'muted'), dueLine(x), showOrg ? M.pill(M.orgName(x.orgId), 'org') : null)), M.statusPill(x.status, overdue(x)), icon('chevron', 16));

  function saveState() {
    const sum = engine.summary(), off = !M.online(), pendOps = ops.length;
    const waiting = sum.pending;
    return h('div', { class: 'statecard' }, h('span', { class: 'state-ico ' + (sum.failed ? 'bad' : '') }, icon(sum.failed ? 'alert' : 'check', 16)),
      h('div', { class: 'grow' }, h('b', {}, sum.failed ? `${sum.failed} photo${sum.failed === 1 ? '' : 's'} need attention` : 'All saved on this phone'),
        h('small', { class: 'muted block' }, [waiting ? `${waiting} photo${waiting === 1 ? '' : 's'} waiting for signal` : 'Nothing waiting to send', pendOps ? `${pendOps} status change${pendOps === 1 ? '' : 's'} waiting` : ''].filter(Boolean).join(' · '))),
      waiting || pendOps ? h('button', { type: 'button', class: 'btn small primary', onclick: async () => { await engine.uploadAll(); engine.nudge(); await flush(); if (off) M.toast('No signal yet. It sends the moment service returns.'); } }, 'Send now') : null);
  }

  function homeHeader() {
    const org = M.org();
    return h('header', { class: 'mbar brandbar' }, M.logo(), h('b', { class: 'brandname' }, 'FieldSync Mobile'), h('span', { class: 'grow' }),
      M.orgs().length > 1 ? h('button', { type: 'button', class: 'orgchip', onclick: () => M.switcher(), 'aria-label': 'Switch organization' }, M.orgName(org), icon('chevron', 12)) : null,
      h('span', { class: 'avatar', title: M.device.name }, M.initials(M.device.name)));
  }

  M.views.home = (v) => {
    const body = h('div', { class: 'scroll pad' });
    v.mode ||= 'list'; v.who ||= 'mine'; v.group ||= false; v.pick ||= null;
    const draw = () => {
      const all = M.org() === 'all', every = visible();
      const items = every.flatMap((x) => (x.surveys || []).filter((sv) => v.who === 'all' || sv.mine).map((sv) => ({ x, sv })));
      const seg = h('div', { class: 'seg' }, [['list', 'List'], ['map', 'Map']].map(([m, l]) => h('button', { type: 'button', class: v.mode === m ? 'on' : '', onclick: () => { v.mode = m; draw(); } }, l)));
      const chip = (label, on, fn) => h('button', { type: 'button', class: 'chip-btn' + (on ? ' on' : ''), onclick: fn }, label);
      const filters = h('div', { class: 'chipbar' }, chip('Mine', v.who === 'mine', () => { v.who = 'mine'; draw(); }), chip('Everyone’s', v.who === 'all', () => { v.who = 'all'; draw(); }), chip('Group by visit', v.group, () => { v.group = !v.group; v.pick = null; draw(); }));
      const kids = [saveState(), seg, filters];
      if (!items.length) kids.push(h('div', { class: 'empty-state' }, h('div', { class: 'empty-ico' }, icon('list', 28)), h('b', {}, v.who === 'mine' ? 'Nothing is assigned to you yet' : 'No surveys on your sites yet'), h('p', { class: 'muted' }, v.who === 'mine' ? 'You can see every survey on your sites and take one for yourself.' : 'Nothing to show.'),
        v.who === 'mine' ? h('button', { type: 'button', class: 'btn primary big', onclick: () => { v.who = 'all'; draw(); } }, 'See everyone’s surveys') : null, h('button', { type: 'button', class: 'btn big', onclick: () => M.go('claim') }, 'Find unassigned visits')));
      else if (v.mode === 'map') kids.push(mapView(items, v, draw));
      else {
        const o = { showOrg: all, who: v.who === 'all' };
        const state = (it) => surveyState(it.x, it.sv).label;
        if (v.group) {                                               // one block per visit, its surveys underneath
          const visitsIn = [...new Map(items.map((it) => [it.x.id, it.x])).values()].sort((a, b) => (a.status === 'complete') - (b.status === 'complete') || a.due.localeCompare(b.due));
          for (const x of visitsIn) kids.push(h('div', { class: `vgroup b-${visitBucket(x)}` }, visitHeader(x, all), ...items.filter((it) => it.x.id === x.id).map((it) => surveyRow(it.x, it.sv, { ...o, nested: true }))));
        } else {
          const todo = items.filter((it) => !['Submitted', 'Blocked'].includes(state(it))), blocked = items.filter((it) => state(it) === 'Blocked'), done = items.filter((it) => state(it) === 'Submitted');
          const grp = (label, rows, cls = '') => rows.length ? [h('h3', { class: cls }, `${label} (${rows.length})`), ...rows.map((it) => surveyRow(it.x, it.sv, o))] : [];
          kids.push(...grp('To do', todo.sort((a, b) => b.sv.mine - a.sv.mine || a.x.due.localeCompare(b.x.due))), ...grp('Blocked', blocked, 'amber'));
          kids.push(h('h3', { class: 'green' }, `Submitted (${done.length})`), done.length ? (v.showDone ? done.map((it) => surveyRow(it.x, it.sv, o)) : h('button', { type: 'button', class: 'vrow plain', onclick: () => { v.showDone = true; draw(); } }, h('span', {}, 'Show submitted surveys'), icon('chevron', 16))) : h('small', { class: 'muted' }, 'None yet'));
        }
      }
      if (all && items.length) kids.push(h('small', { class: 'muted center' }, 'Tap a survey to work in its organization. The header switches.'));
      kids.push(h('button', { type: 'button', class: 'btn big', onclick: () => M.go('mysurveys') }, 'Start a survey without a visit'), h('small', { class: 'muted center' }, 'Unallocated surveys still work. Attach them to a visit later.'));
      body.replaceChildren(...kids);
    };
    v.live = draw; draw(); refresh();
    return h('div', { class: 'mcol' }, homeHeader(), body);
  };

  // ---- map: pins for visits (grouped) or for each survey; same filters as the list ------------------
  function mapView(items, v, draw) {
    const vis = [...new Map(items.map((it) => [it.x.id, it.x])).values()];
    const lats = vis.map((x) => x.lat), lons = vis.map((x) => x.lon);
    const [la0, la1] = [Math.min(...lats), Math.max(...lats)], [lo0, lo1] = [Math.min(...lons), Math.max(...lons)];
    const at = (x, i = 0, n = 1) => { const ang = (i / n) * 2 * Math.PI; return { left: `${12 + (lo1 === lo0 ? 38 : ((x.lon - lo0) / (lo1 - lo0)) * 76) + (n > 1 ? Math.cos(ang) * 2.6 : 0)}%`, top: `${14 + (la1 === la0 ? 36 : (1 - (x.lat - la0) / (la1 - la0)) * 72) + (n > 1 ? Math.sin(ang) * 3.2 : 0)}%` }; };
    const visitColor = (x) => { const b = visitBucket(x); return b === 'none' ? (x.status === 'unassigned' ? COL.open : x.mine ? TONE.assigned : COL.none) : COL[b]; };
    const svColor = (x, sv) => { const b = svBucket(x, sv); return b !== 'none' ? COL[b] : sv.mine ? TONE.assigned : sv.assignee ? COL.none : COL.open; };
    const pins = v.group ? vis.map((x) => ({ key: x.id, x, pos: at(x), color: visitColor(x) }))
      : vis.flatMap((x) => { const mine = items.filter((it) => it.x.id === x.id); return mine.map((it, i) => ({ key: `${x.id}:${it.sv.id}`, x, sv: it.sv, pos: at(x, i, mine.length), color: svColor(x, it.sv) })); });
    const sel = pins.find((q) => q.key === v.pick) || pins[0];
    const map = h('div', { class: 'map', role: 'img', 'aria-label': 'Map' },
      h('svg', { class: 'map-bg', viewBox: '0 0 100 100', preserveAspectRatio: 'none', html: '<rect width="100" height="100" fill="#dfe6f2"/><path d="M0 30 L100 22" stroke="#fff" stroke-width="3"/><path d="M0 72 L100 66" stroke="#fff" stroke-width="3"/><path d="M34 0 L40 100" stroke="#fff" stroke-width="3"/><path d="M70 0 L64 100" stroke="#c7d2e8" stroke-width="5"/><path d="M0 50 L100 55" stroke="#fff" stroke-width="1.5"/><path d="M52 0 L58 100" stroke="#fff" stroke-width="1.5"/>' }),
      ...pins.map((q) => h('button', { type: 'button', class: 'pin' + (q.key === sel.key ? ' sel' : ''), style: `left:${q.pos.left};top:${q.pos.top};--c:${q.color}`, 'aria-label': q.sv ? `${q.sv.title}, ${q.x.name}` : q.x.name, onclick: () => { v.pick = q.key; draw(); } }, h('i'))));
    const legend = h('div', { class: 'maplegend' }, ...[['Complete', COL.done], ['In progress', COL.prog], ['Blocked or overdue', COL.warn], ['Yours, not started', TONE.assigned], ['Someone else’s', COL.none], ['Open', COL.open]].map(([l, c]) => h('small', {}, h('i', { style: `background:${c}` }), l)));
    const dir = (x) => h('button', { type: 'button', class: 'btn', onclick: () => window.open(`https://maps.google.com/?q=${x.lat},${x.lon}`, '_blank') }, 'Directions');
    let card;
    if (sel.sv) {                                                              // one survey
      const x = sel.x, sv = sel.sv, st = surveyState(x, sv), startable = sv.mine && ['Not started', 'Draft'].includes(st.label);
      card = h('div', { class: 'mapcard' }, h('div', { class: 'vtop' }, h('b', { class: 'bigt' }, sv.title), M.pill(!sv.mine && st.label !== 'Submitted' && st.label !== 'Blocked' ? (sv.assignee ? sv.assigneeName : 'Not assigned') : st.label, stTone(sv, st, x))), h('div', { class: 'sub' }, x.name), h('div', { class: 'vmeta' }, M.pill(x.scope, SCOPE_TONE[x.scope] || 'muted'), dueLine(x)),
        svActions(x, sv, st).length ? h('div', { class: 'row2s' }, ...svActions(x, sv, st)) : null,
        h('div', { class: 'row2' }, dir(x), h('button', { type: 'button', class: 'btn', onclick: () => M.go('visit', { id: x.id }) }, 'Open visit')));
    } else {                                                                  // a visit with its surveys
      const x = sel.x, its = items.filter((it) => it.x.id === x.id);
      card = h('div', { class: 'mapcard' }, h('div', { class: 'vtop' }, h('b', { class: 'bigt' }, x.name), M.statusPill(x.status, overdue(x))), h('div', { class: 'vmeta' }, M.pill(x.scope, SCOPE_TONE[x.scope] || 'muted'), dueLine(x)),
        h('div', { class: 'minis' }, ...its.map((it) => { const st = surveyState(x, it.sv); return h('div', { class: 'mini-sv' }, h('span', { class: 'mini-t' }, it.sv.title), h('span', { class: 'mini-who' + (st.label === 'Submitted' ? ' done' : st.label === 'Blocked' ? ' warn' : it.sv.mine ? ' me' : '') }, st.label === 'Submitted' || st.label === 'Blocked' ? st.label : it.sv.mine ? 'You' : it.sv.assigneeName || 'Not assigned')); })),
        h('div', { class: 'row2' }, dir(x), h('button', { type: 'button', class: 'btn primary', onclick: () => M.go('visit', { id: x.id }) }, 'Open visit')));
    }
    return h('div', {}, map, legend, card);
  }

  // ---- visit detail: a site visit is a set of surveys ----------------------------------------------
  M.views.visit = (v) => {
    const box = h('div', { class: 'scroll pad' });
    const card = (x, sv) => {
      const st = surveyState(x, sv), btns = svActions(x, sv, st), submitted = st.label === 'Submitted';
      return h('div', { class: `card svcard b-${svBucket(x, sv)}` + (sv.mine ? ' mine' : '') }, h('div', { class: 'vtop' }, h('b', {}, sv.title), M.pill(st.label === 'Assigned' || st.label === 'Not assigned' ? (sv.assignee ? 'Assigned' : 'Not assigned') : st.label, st.label === 'Submitted' ? 'complete' : st.label === 'Blocked' || overdue(x) ? 'blocked' : st.tone)),
        (() => { const ev = (x.history || []).filter((hi) => hi.text.includes(sv.title)).pop(); return ev ? h('small', { class: 'sv-hist' }, `${ev.at.slice(5).replace('-', '/')} · ${ev.text.replace(sv.title, '').replace(/ \(syncs when you have signal\)$/, '').trim()}`) : null; })(),
        h('small', { class: 'who' }, submitted ? `Submitted${sv.assigneeName || sv.mine ? ` · ${who(sv)}` : ''}` : sv.assignee ? `Assigned to ${who(sv)}` : 'Not assigned to anyone yet'),
        sv.blocked ? h('div', { class: 'vblock' }, `Blocked: ${sv.reason}`) : null, btns.length ? h('div', { class: 'row2s' }, ...btns) : null);
    };
    const draw = () => {
      const x = byId(v.id); if (!x) { box.replaceChildren(h('p', { class: 'muted' }, 'This visit is no longer on your list.')); return; }
      const req = (x.surveys || []).filter((s2) => s2.need === 'required'), opt = (x.surveys || []).filter((s2) => s2.need === 'optional'), rc = reqCount(x);
      box.replaceChildren(...[
        h('div', {}, M.statusPill(x.status, overdue(x)), x.pending ? h('small', { class: 'sync' }, icon('refresh', 12), 'Syncs when you have signal') : null),
        h('div', { class: 'two' }, h('div', { class: 'card mini' }, h('small', { class: 'cap' }, 'ACCOUNTABLE'), h('b', {}, x.accountable || 'Nobody yet')), h('div', { class: 'card mini' }, h('small', { class: 'cap' }, 'DUE'), h('b', {}, M.fmtDue(x.due)))),
        x.status === 'blocked' && x.blockedReason ? h('div', { class: 'warn-card' }, h('b', {}, 'Blocked'), h('p', {}, x.blockedReason)) : null,
        h('div', { class: 'card sitecard' }, h('div', {}, h('b', {}, x.name), h('small', { class: 'muted block' }, `${visitLine(x)} · ${M.orgName(x.orgId)}`)), h('button', { type: 'button', class: 'btn small', onclick: () => window.open(`https://maps.google.com/?q=${x.lat},${x.lon}`, '_blank') }, 'Directions')),
        h('div', { class: 'card progcard' }, h('div', { class: 'vtop' }, h('b', {}, x.status === 'complete' ? 'Complete' : `${rc.done} of ${rc.total} required surveys submitted`), M.pill(x.status === 'complete' ? 'Done' : `${rc.total - rc.done} to go`, x.status === 'complete' ? 'complete' : overdue(x) ? 'blocked' : 'progress')),
          (() => { const nx = M.nextSurvey(x.id); return nx ? h('button', { type: 'button', class: 'btn primary big', onclick: () => M.takeAndOpen(nx.visit, nx.sv) }, `${nx.sv.mine ? (surveyState(nx.visit, nx.sv).label === 'Draft' ? 'Resume' : 'Start') : 'Take and start'}${nx.sv.need === 'optional' ? ' optional' : ''}: ${nx.sv.title}`) : null; })(),
          h('div', { class: 'bar' }, h('i', { class: x.status === 'complete' ? 'done' : '', style: `width:${rc.total ? (rc.done / rc.total) * 100 : 0}%` })), h('small', { class: 'muted block' }, 'The visit completes by itself once every required survey is submitted.')),
        !x.mine ? h('div', { class: 'info-card' }, h('b', {}, 'You can see this visit'), h('small', { class: 'block' }, 'Every survey on it is listed below. Assign one to yourself to start it.')) : null,
        h('h3', {}, 'Required surveys'), ...req.map((sv) => card(x, sv)),
        opt.length ? h('h3', {}, 'Optional surveys') : null, ...opt.map((sv) => card(x, sv)),
        h('h3', {}, 'History'), h('div', { class: 'card history' }, ...(x.history || []).slice().reverse().map((hi) => h('div', { class: 'hrow' }, h('small', { class: 'muted' }, hi.at.slice(5).replace('-', '/')), h('span', {}, hi.text)))),
        h('small', { class: 'muted center' }, 'Changes sync when you have signal.')].filter(Boolean));
    };
    v.live = draw; draw();
    const x = byId(v.id);
    return h('div', { class: 'mcol' }, M.appbar(x?.name || 'Visit', x ? `${x.scope} site visit` : ''), box);
  };

  function blockSheet(x, sv) {
    const ta = h('textarea', { class: 'minput', rows: 3, placeholder: 'Why is it blocked?', 'aria-label': 'Reason' });
    const err = h('div', { class: 'inline-err', hidden: true }, 'Reason required');
    const close = M.sheet(`Block ${sv.title}`, h('p', { class: 'muted' }, 'A reason is required. The rest of the visit is not affected.'), ta, err,
      h('div', { class: 'row2' }, h('button', { type: 'button', class: 'btn big', onclick: () => close() }, 'Cancel'), h('button', { type: 'button', class: 'btn big warnbtn', onclick: () => { const r = ta.value.trim(); if (!r) { err.hidden = false; ta.classList.add('bad'); return; } close(); actSurvey(x, sv, 'block', r); } }, 'Block survey')),
      h('small', { class: 'muted center' }, 'Syncs when you have signal. Same rule as the web app.'));
    setTimeout(() => ta.focus(), 60);
  }

  // ---- claim an open visit -----------------------------------------------------------------------
  M.views.claim = (v) => {
    const box = h('div', { class: 'scroll pad' });
    const draw = () => box.replaceChildren(...[
      claimMsg ? h('div', { class: 'warn-card' }, h('b', {}, 'Someone else claimed this visit.'), h('p', {}, 'First claim wins. Pick another.')) : null,
      ...(open.length ? open.map((x) => h('div', { class: 'card claimrow' }, h('div', {}, h('b', {}, x.name), h('div', { class: 'vmeta' }, M.pill(x.scope, SCOPE_TONE[x.scope] || 'muted'), dueLine(x))), h('button', { type: 'button', class: 'btn primary small', onclick: () => claim(x, draw) }, 'Claim'))) : [h('p', { class: 'muted' }, 'No unassigned visits on the sites you can access.')]),
      h('small', { class: 'muted' }, 'Claiming makes you accountable and sets the visit to Assigned.')].flat().filter(Boolean));
    const load = async () => { try { open = await server.unassigned({ org: M.org() === 'all' ? 'all' : M.org() }); draw(); } catch { box.prepend(h('p', { class: 'muted' }, 'You need signal to see open visits.')); } };
    v.live = null; claimMsg = ''; draw(); load();
    v.reload = load;
    return h('div', { class: 'mcol' }, M.appbar('Unassigned visits', 'On sites you can access'), box);
  };
  async function claim(x, draw) {
    try {
      const r = await server.claimVisit(x.id, { key: M.uid() });
      visits = [...visits.filter((y) => y.id !== x.id), r.visit]; save(); claimMsg = '';
      M.toast(`${x.name} is yours. It is now Assigned.`); M.go('home', {}, { replace: true });
    } catch (e) {
      if (e instanceof NetError) return M.toast('You need signal to claim a visit.');
      if (e.code === 'ERR-VISIT-409') { claimMsg = 'x'; try { open = await server.unassigned({ org: M.org() }); } catch { open = open.filter((y) => y.id !== x.id); } draw(); return; }
      M.plain(e.code || 'ERR-GEN-000');
    }
  }

  // ---- attach an unallocated survey to a visit ----------------------------------------------------
  M.views.attach = (v) => {
    const sub = engine.subs.get(v.subId); let pick = byId(sub?.visitId)?.id || '';
    const list = h('div', { class: 'org-list' });
    const draw = () => list.replaceChildren(...visible().filter((x) => x.mine && x.status !== 'complete' && x.status !== 'unassigned').map((x) => h('button', { type: 'button', class: 'org-card' + (pick === x.id ? ' on' : ''), onclick: () => { pick = x.id; draw(); } },
      h('span', { class: 'radio' + (pick === x.id ? ' on' : '') }), h('div', { class: 'grow' }, h('b', {}, x.name), h('div', { class: 'vmeta' }, M.pill(x.scope, SCOPE_TONE[x.scope] || 'muted'), dueLine(x))))));
    draw();
    return h('div', { class: 'mcol' }, M.appbar('Attach to a visit', `${sub?.surveyTitle || 'Survey'} (unallocated)`),
      h('div', { class: 'scroll pad' }, h('p', { class: 'muted' }, 'Pick one of your assigned visits.'), list, h('small', { class: 'muted' }, 'Or leave it unallocated. The web app can match it later.')),
      h('div', { class: 'footbar' }, h('button', { type: 'button', class: 'btn primary big', onclick: async () => {
        if (!pick) return M.toast('Pick a visit first.');
        sub.visitId = pick; sub.siteId = byId(pick)?.siteId; await M.db.put('submissions', sub);
        try { await server.attachVisit({ visitId: pick, recordId: sub.id }); M.toast('Attached to the visit.'); } catch (e) { M.toast(e instanceof NetError ? 'Attached on this phone. The link syncs when you have signal.' : describe(e.code).cause); }
        M.back();
      } }, 'Attach to this visit')));
  };

  // ---- demo controls (the PM / web app side) ----------------------------------------------------
  M.demo = M.demo || {};
  Object.assign(M.demo, {
    refresh,
    assignNew: async () => { await server.admin('visit', { id: 'v7', op: 'assign', email: 'jordan@demo.test' }); await refresh(); },
    reassignAway: async () => { await server.admin('visit', { id: 'v2', op: 'reassign', email: 'sam@demo.test' }); },
    claimedFirst: async () => { await server.admin('visit', { id: 'v6', op: 'claimedBy', email: 'sam@demo.test' }); },
    endAccess: async () => { await server.admin('membership', { email: 'jordan@demo.test', orgId: '1002', active: false }); },
    restoreAccess: async () => { await server.admin('membership', { email: 'jordan@demo.test', orgId: '1002', active: true }); await M.auth.refreshProfile(); },
    resetVisits: async () => { await server.admin('visits-reset'); visits = []; ops = []; save(); await refresh(); },
    unassignAll: async () => { for (const id of ['v1', 'v2', 'v3']) await server.admin('visit', { id, op: 'unassign' }); await refresh(); },
    ops: () => ops.slice(), visits: () => visits.slice(),
  });
}
