// Server-side logic, free of any transport. Used by:
//   - server/server.js        (real HTTP server, persists to disk)
//   - src/mockServer.js       (in-process, for the engine tests)
// Everything is idempotent: replaying a request never creates a second record, photo, op or issue.

import { AppError } from './errors.js';
import { SCOPES, ADDONS } from './scopes.js';
import { newState, applyOp, materialize, livePhotos, attribution } from './crdt.js';

export const MAX_PHOTO_BYTES = 30 * 1024 * 1024;

// Who can do what on a team survey (deck: Permissions). The server enforces it; the app only mirrors it.
export const ROLES = { tech: 'Technician', member: 'Crew member', lead: 'Crew lead', pm: 'PM / admin' };
export const CAN = {
  submit: ['lead', 'pm'],
  share: ['lead', 'pm'],
  seeAll: ['pm'],
};
export const can = (role, action) => (CAN[action] || []).includes(role);

// Demo directory standing in for the identity service: users see only the organizations they belong to.
const DEMO_ORGS = () => [
  { id: '1001', name: 'Acme Field Services', members: ['maria@demo.test', 'sam@demo.test', 'dana@demo.test', 'jordan@demo.test'] },
  { id: '1002', name: 'Summit Inspections', members: ['priya@demo.test', 'dana@demo.test', 'jordan@demo.test'] },
];
// Stand-in for the FieldSync identity service (the real app authenticates against the web app's accounts:
// Microsoft login for some users, username + password for others). Demo credentials only — never ships.
const DEMO_USERS = () => [
  { id: 'u1', username: 'maria', email: 'maria@demo.test', firstName: 'Maria', lastName: 'Lopez', provider: 'microsoft', role: 'lead' },
  { id: 'u2', username: 'sam', email: 'sam@demo.test', firstName: 'Sam', lastName: 'Okafor', provider: 'password', password: 'demo', role: 'member', foreman: 'maria@demo.test' },
  { id: 'u3', username: 'dana', email: 'dana@demo.test', firstName: 'Dana', lastName: 'Reyes', provider: 'password', password: 'demo', role: 'lead' },
  { id: 'u5', username: 'jordan', email: 'jordan@demo.test', firstName: 'Jordan', lastName: 'Lee', provider: 'password', password: 'demo', role: 'tech' },
  { id: 'u4', username: 'priya', email: 'priya@demo.test', firstName: 'Priya', lastName: 'Nair', provider: 'microsoft', role: 'pm' },
];

// Assigned site visits (the PM feature). A site visit is one scope of work at one site. Demo data; the real list comes from the
// web app's assignment API (list endpoint with site coordinates, an updatedSince filter, idempotent status changes).
const DAY = '2026-11-';
/** A site visit is one scope of work at one site, and a scope is a set of surveys. Required ones finish the visit when they are submitted. */
const ALL_DONE = (scope) => Object.fromEntries(SCOPES[scope].filter((x) => x.need === 'required').map((x) => [x.id, 1]));
const DEMO_VISITS = () => [
  // Organization A (Acme Field Services)
  { id: 'v1', orgId: '1001', name: 'Polk City · IA-1', siteId: 'IA-1', siteName: 'Polk City', scope: 'Inspection', status: 'in_progress', started: true, submitted: { 'demo-compound': 1 }, sAssign: { 'demo-plumb-twist': 'sam@demo.test', 'demo-guy-facilities': 'jordan@demo.test' }, assignee: 'jordan@demo.test', accountable: 'Jordan Lee', due: `${DAY}18`, lat: 41.77, lon: -93.71 },
  { id: 'v2', orgId: '1001', name: 'Winnfield · LA-21', siteId: 'LA-21', siteName: 'Winnfield', scope: 'Inspection', status: 'assigned', sAssign: { 'demo-guy-facilities': 'jordan@demo.test', 'demo-plumb-twist': 'jordan@demo.test' }, assignee: 'jordan@demo.test', accountable: 'Jordan Lee', due: `${DAY}10`, lat: 31.92, lon: -92.64 },
  { id: 'v3', orgId: '1001', name: 'Hiawatha · T081105', siteId: 'T081105', siteName: 'Hiawatha', scope: 'CONS-MOD', status: 'blocked', blockedReason: 'waiting on landowner access', blocks: { 'demo-consmod-ground': 'waiting on landowner access' }, started: true, submitted: { 'demo-consmod-prework': 1 }, sAssign: { 'demo-consmod-sector': 'sam@demo.test' }, assignee: 'jordan@demo.test', accountable: 'Jordan Lee', due: `${DAY}17`, lat: 42.03, lon: -91.68 },
  { id: 'v4', orgId: '1001', name: 'Dillon · SD-0442', siteId: 'SD-0442', siteName: 'Dillon', scope: 'Inspection', status: 'complete', submitted: ALL_DONE('Inspection'), assignee: 'jordan@demo.test', accountable: 'Jordan Lee', due: `${DAY}09`, lat: 45.2, lon: -112.64 },
  { id: 'v5', orgId: '1001', name: 'Richmond · 10383', siteId: '10383', siteName: 'Richmond', scope: 'CONS-MOD', status: 'complete', submitted: ALL_DONE('CONS-MOD'), assignee: 'jordan@demo.test', accountable: 'Jordan Lee', due: `${DAY}06`, lat: 37.54, lon: -77.43 },
  { id: 'v12', orgId: '1001', name: 'Cedar Hill · TX-4412', siteId: 'TX-4412', siteName: 'Cedar Hill', scope: 'Inspection', status: 'assigned', sAssign: { 'demo-guy-facilities': 'jordan@demo.test' }, assignee: 'jordan@demo.test', accountable: 'Jordan Lee', due: `${DAY}19`, lat: 32.59, lon: -96.96 },
  { id: 'v13', orgId: '1001', name: 'Pierre · SD-2210', siteId: 'SD-2210', siteName: 'Pierre', scope: 'CONS-MOD', status: 'assigned', assignee: 'jordan@demo.test', accountable: 'Jordan Lee', due: `${DAY}21`, lat: 44.37, lon: -100.35 },
  { id: 'v6', orgId: '1001', name: 'Mound City · SD-1526', siteId: 'SD-1526', siteName: 'Mound City', scope: 'CONS-MOD', status: 'unassigned', assignee: null, due: `${DAY}24`, lat: 45.73, lon: -100.06 },
  { id: 'v7', orgId: '1001', name: 'Stonewall · TX-171', siteId: 'TX-171', siteName: 'Stonewall', scope: 'Inspection', status: 'unassigned', assignee: null, due: `${DAY}25`, lat: 30.21, lon: -98.65 },
  { id: 'v8', orgId: '1001', name: 'Delta · US654263', siteId: 'US654263', siteName: 'Delta', scope: 'Inspection', status: 'unassigned', assignee: null, due: `${DAY}27`, lat: 39.35, lon: -108.07 },
  // Organization B (Summit Inspections)
  { id: 'v9', orgId: '1002', name: 'Fairview · OK-3310', siteId: 'OK-3310', siteName: 'Fairview', scope: 'Inspection', status: 'assigned', assignee: 'jordan@demo.test', accountable: 'Jordan Lee', due: `${DAY}19`, lat: 36.27, lon: -98.48 },
  { id: 'v10', orgId: '1002', name: 'Marlow · OK-0912', siteId: 'OK-0912', siteName: 'Marlow', scope: 'CONS-MOD', status: 'assigned', assignee: 'jordan@demo.test', accountable: 'Jordan Lee', due: `${DAY}23`, lat: 34.65, lon: -97.96 },
  { id: 'v11', orgId: '1002', name: 'Perry · OK-5521', siteId: 'OK-5521', siteName: 'Perry', scope: 'Inspection', status: 'unassigned', assignee: null, due: `${DAY}26`, lat: 36.29, lon: -97.29 },
].map((v) => ({ rev: 1, blockedReason: '', blocks: {}, submitted: {}, sAssign: {}, started: false, history: [{ at: '2026-11-10', text: 'Created' }, ...(v.assignee ? [{ at: '2026-11-10', text: 'Assigned by Priya Nair' }] : [])], updatedAt: 1, wasAssigned: [], ...v }));
export { SCOPES };
export const VISITS_V = 4;      // bump when the demo visits change shape: saved older data is reseeded
const TRANSITIONS = { start: { from: ['assigned'], to: 'in_progress', text: 'Started' }, block: { from: ['assigned', 'in_progress'], to: 'blocked', text: 'Blocked' }, unblock: { from: ['blocked'], to: 'in_progress', text: 'Unblocked' }, complete: { from: ['in_progress'], to: 'complete', text: 'Completed' } };
const VISIT_FIELDS = ['id', 'orgId', 'name', 'siteId', 'siteName', 'scope', 'status', 'blockedReason', 'accountable', 'assignee', 'due', 'lat', 'lon', 'rev', 'updatedAt', 'history'];

export const freshState = () => ({ users: DEMO_USERS(), sessions: {}, subs: {}, minSchema: 1, nextRecord: 1001, dupes: 0, forms: {}, shared: {}, issues: [], orgs: DEMO_ORGS(), notifications: [], visits: DEMO_VISITS(), visitsV: VISITS_V, idem: {}, attached: {} });

export class ServerCore {
  constructor(state) {
    this.state = state || freshState();
    const older = state && state.visits === undefined;            // saved before the PM feature existed: add the demo account, memberships and visits once
    for (const k of Object.keys(freshState())) if (this.state[k] === undefined) this.state[k] = freshState()[k];
    for (const u of this.state.users) { const d = DEMO_USERS().find((x) => x.id === u.id && x.email === u.email); if (u.role === 'reviewer') u.role = 'lead';   // the reviewer role was removed
      if (d) for (const k of ['role', 'foreman']) if (u[k] === undefined && d[k] !== undefined) u[k] = d[k]; }   // states saved before roles existed
    if (this.state.visitsV !== VISITS_V) { this.state.visits = DEMO_VISITS(); this.state.visitsV = VISITS_V; this.state.idem = {}; this.state.attached = {}; }   // old saved visits (one survey each) become visits with all their surveys
    if (older) {
      for (const d of DEMO_USERS()) if (!this.state.users.some((u) => u.id === d.id)) this.state.users.push(d);
      for (const o of DEMO_ORGS()) { const cur = this.state.orgs.find((x) => x.id === o.id); if (cur) for (const m of o.members) if (!cur.members.includes(m)) cur.members.push(m); }
    }
    this.presenceTtl = 9000;     // a teammate not heard from for this long counts as disconnected
    this.onChange = () => {};
  }
  _dirty() { this.onChange(); }

  stats() {
    const subs = Object.values(this.state.subs);
    return {
      dupesPrevented: this.state.dupes,
      receivedItems: subs.reduce((n, s) => n + Object.keys(s.received).length, 0),
      records: subs.filter((s) => s.committed).length,
      minSchema: this.state.minSchema,
      sharedOpen: Object.values(this.state.shared).filter((s) => s.status === 'open').length,
      issuesOpen: this.state.issues.filter((i) => i.status === 'open').length,
    };
  }

  // ---- individual records ------------------------------------------------------------------------
  begin({ id, surveyId, visitId, orgId, schemaVersion, answers, media, user }) {
    if (schemaVersion < this.state.minSchema) {
      throw new AppError('ERR-SYNC-001', `Record was collected on form v${schemaVersion}; server now requires v${this.state.minSchema}+.`);
    }
    let s = this.state.subs[id];
    const dupe = !!s;
    if (!s) s = this.state.subs[id] = { surveyId: surveyId || null, visitId: visitId || null, orgId: orgId || null, schemaVersion, answers, manifest: Object.fromEntries(media.map((m) => [m.id, m.size])), submittedBy: user || null, received: {}, committed: false, recordId: null, meta: Object.fromEntries(media.map((m) => [m.id, { name: m.name, fieldPath: m.fieldPath, w: m.w, h: m.h, meta: m.meta }])) };
    else {
      this.state.dupes++;
      if (!s.committed && !s.shared) {         // an unfinished record that was edited and re-sent (e.g. a bad photo replaced): take the new manifest, keep what already arrived
        s.schemaVersion = schemaVersion; s.answers = answers; s.manifest = Object.fromEntries(media.map((m) => [m.id, m.size]));
        s.meta = Object.fromEntries(media.map((m) => [m.id, { name: m.name, fieldPath: m.fieldPath, w: m.w, h: m.h, meta: m.meta }]));
        for (const id of Object.keys(s.received)) if (!(id in s.manifest)) delete s.received[id];
      }
    }
    if (visitId && this.state.attached[id] !== visitId) this.state.attached[id] = visitId;
    { const v = visitId && this.state.visits.find((x) => x.id === visitId); if (v && surveyId && !(SCOPES[v.scope] || []).some((x) => x.id === surveyId) && !(v.extras || {})[surveyId]) (v.extras ||= {})[surveyId] = { title: ADDONS[surveyId] || surveyId, by: user }; }
    this._dirty();
    return { have: Object.keys(s.received), dupe };
  }

  /** Answers other surveys collected for the same site, for pulling values across surveys (structure → guy facilities). Latest committed
   *  record per survey wins. Returns { [surveyId]: answers }. */
  siteData(site) {
    const out = {}, at = {};
    for (const s of Object.values(this.state.subs)) {
      if (!s.committed || !s.surveyId || String(s.answers?.siteId ?? '').trim().toLowerCase() !== String(site).trim().toLowerCase()) continue;
      if ((at[s.surveyId] ?? -1) < s.recordId) { at[s.surveyId] = s.recordId; out[s.surveyId] = s.answers; }
    }
    return out;
  }

  putMedia({ id, mediaId, size }) {
    const s = this.state.subs[id];
    if (!s) throw new AppError('ERR-SYNC-002', 'No handshake for this record');
    if (size > MAX_PHOTO_BYTES) throw new AppError('ERR-IMG-001', `Photo is ${(size / 1048576).toFixed(1)} MB; limit is 30 MB.`);
    if (s.received[mediaId] != null) { this.state.dupes++; this._dirty(); return { ok: true, already: true }; }
    s.received[mediaId] = size; this._dirty();
    return { ok: true, already: false };
  }

  commit({ id }) {
    const s = this.state.subs[id];
    if (!s) throw new AppError('ERR-SYNC-002', 'No handshake for this record');
    if (s.committed) { this.state.dupes++; this._dirty(); return { recordId: s.recordId, missing: [] }; }
    const missing = Object.keys(s.manifest).filter((m) => s.received[m] == null);
    if (missing.length) return { missing };
    s.committed = true; s.recordId = this.state.nextRecord++; this._dirty();
    this._submitted(s.visitId || this.state.attached[id] || this._matchVisit(s.orgId, s.answers?.siteId, s.surveyId)?.id, s.surveyId);
    return { recordId: s.recordId, missing: [] };
  }


  // ---- assigned site visits (My work) ------------------------------------------------------------
  isMember(email, orgId) { return this.orgsFor(email).some((o) => o.id === String(orgId)); }
  _canSee(u, v) { return this.isMember(u.email, v.orgId) && (u.role === 'pm' || v.assignee === u.email); }
  /** Who a survey is assigned to: an explicit choice wins; otherwise required surveys follow the visit's accountable person and optional ones are open. */
  _sAssignee(v, sv) { const x = v.sAssign?.[sv.id]; return x !== undefined ? x : sv.need === 'required' ? v.assignee : null; }
  _name(email) { const u = email && this.state.users.find((x) => x.email === email); return u ? `${u.firstName} ${u.lastName}`.trim() : ''; }
  _mine(u, v) { return this.isMember(u.email, v.orgId) && (u.role === 'pm' || v.assignee === u.email || (SCOPES[v.scope] || []).some((x) => this._sAssignee(v, x) === u.email)); }
  _pub(v, u) {
    const out = Object.fromEntries(VISIT_FIELDS.map((k) => [k, v[k]]));
    out.surveys = (SCOPES[v.scope] || []).map((x) => { const a = this._sAssignee(v, x); return { ...x, blocked: !!v.blocks?.[x.id], reason: v.blocks?.[x.id] || '', submitted: !!v.submitted?.[x.id], assignee: a, assigneeName: this._name(a), mine: !!u && a === u.email }; });
    for (const [id, e] of Object.entries(v.extras || {})) out.surveys.push({ id, title: e.title, need: 'added', blocked: false, reason: '', submitted: !!v.submitted?.[id], assignee: e.by, assigneeName: this._name(e.by), mine: !!u && e.by === u.email });
    if (u) out.mine = this._mine(u, v);
    return out;
  }
  /** The visit follows its surveys: it finishes when every required survey is submitted, is blocked while a required one is blocked, and starts with the first survey. */
  _recompute(v) {
    if (v.status === 'unassigned') return;
    const req = (SCOPES[v.scope] || []).filter((x) => x.need === 'required'), blocked = req.filter((x) => v.blocks?.[x.id]);
    const was = v.status;
    if (req.length && req.every((x) => v.submitted?.[x.id])) { v.status = 'complete'; v.blockedReason = ''; }
    else if (blocked.length) { v.status = 'blocked'; v.blockedReason = blocked.length === 1 ? v.blocks[blocked[0].id] : blocked.map((x) => `${x.title}: ${v.blocks[x.id]}`).join('; '); }
    else { v.status = v.started || Object.keys(v.submitted || {}).length ? 'in_progress' : 'assigned'; v.blockedReason = ''; }
    return was !== v.status;
  }
  /** Block or unblock one survey of a visit (reason required). The phone shows no way to complete a survey: it is done once it is submitted. */
  surveyStatus(u, id, { surveyId, action, reason, key } = {}) {
    if (key && this.state.idem[key]) return this.state.idem[key];
    const v = this.state.visits.find((x) => x.id === id);
    const sv = v && (SCOPES[v.scope] || []).find((x) => x.id === surveyId);
    if (!v || !sv || !this.isMember(u.email, v.orgId) || (u.role !== 'pm' && this._sAssignee(v, sv) !== u.email)) throw new AppError('ERR-VISIT-403');       // only the person it is assigned to blocks or unblocks it
    if (v.submitted[surveyId]) throw new AppError('ERR-VISIT-409', undefined, { visit: this._pub(v, u) });          // a submitted survey is done; optional ones stay workable after the visit completes
    const isBlocked = !!v.blocks[surveyId];
    if ((action === 'block' && (isBlocked || v.submitted[surveyId])) || (action === 'unblock' && !isBlocked)) throw new AppError('ERR-VISIT-409', undefined, { visit: this._pub(v, u) });
    if (action === 'block') { if (!String(reason || '').trim()) throw new AppError('ERR-VISIT-422'); v.blocks[surveyId] = String(reason).trim(); } else if (action === 'unblock') delete v.blocks[surveyId]; else throw new AppError('ERR-GEN-000', `Unknown action ${action}`);
    this._recompute(v); this._bump(v, `${sv.title} ${action === 'block' ? `blocked: ${v.blocks[surveyId]}` : 'unblocked'}`, `${u.firstName} ${u.lastName}`);
    const out = { visit: this._pub(v, u) }; if (key) this.state.idem[key] = out; return out;
  }
  /** A record with a site belongs to that site's visit when the visit's scope contains the survey: no manual attaching. */
  _matchVisit(orgId, siteId, surveyId) {
    const n = (x) => String(x ?? '').trim().toLowerCase(); if (!n(siteId) || !surveyId) return null;
    const hits = this.state.visits.filter((v) => (!orgId || v.orgId === orgId) && n(v.siteId) === n(siteId) && (SCOPES[v.scope] || []).some((x) => x.id === surveyId));
    return hits.find((v) => v.status !== 'complete') || hits[0] || null;
  }
  /** Take a survey of a visit for yourself. Anyone who can see the visit can: an unassigned survey, or one taken over from someone else. */
  assignSurvey(u, id, { surveyId, key } = {}) {
    if (key && this.state.idem[key]) return this.state.idem[key];
    const v = this.state.visits.find((x) => x.id === id), sv = v && (SCOPES[v.scope] || []).find((x) => x.id === surveyId);
    if (!v || !sv || !this.isMember(u.email, v.orgId)) throw new AppError('ERR-VISIT-403');
    if (v.submitted[surveyId]) throw new AppError('ERR-VISIT-409', undefined, { visit: this._pub(v, u) });
    const from = this._sAssignee(v, sv), me = `${u.firstName} ${u.lastName}`;
    if (from === u.email) return { visit: this._pub(v, u) };
    v.sAssign[surveyId] = u.email;
    if (v.status === 'unassigned' || !v.assignee) { v.assignee = u.email; v.accountable = me; if (v.status === 'unassigned') v.status = 'assigned'; }
    this._bump(v, `${sv.title} ${from ? `taken over from ${this._name(from)}` : 'assigned'}`, me);
    const out = { visit: this._pub(v, u) }; if (key) this.state.idem[key] = out; return out;
  }
  /** A survey record for a visit was delivered (committed with every photo): mark it, and finish the visit if that was the last required one. */
  _submitted(visitId, surveyId) {
    const v = this.state.visits.find((x) => x.id === visitId); if (!v || !surveyId) return;
    const sv = (SCOPES[v.scope] || []).find((x) => x.id === surveyId) || (v.extras || {})[surveyId]; if (!sv || v.submitted[surveyId]) return;
    v.submitted[surveyId] = 1; delete v.blocks[surveyId]; v.started = true;
    const changed = this._recompute(v); this._bump(v, `${sv.title} submitted`);
    if (changed && v.status === 'complete') this._bump(v, 'Completed: every required survey is submitted');
  }
  _bump(v, text, who) { v.rev++; v.updatedAt = Date.now(); if (text) v.history.push({ at: new Date().toISOString().slice(0, 10), text: `${text}${who ? ` by ${who}` : ''}` }); this._dirty(); }
  /** My work: only visits assigned to me (a PM sees all). `removed` lists visits that left my list since `updatedSince`, so the phone drops its copy. */
  visitsFor(u, { orgId, updatedSince = 0 } = {}) {
    const inOrg = (v) => !orgId || orgId === 'all' || v.orgId === String(orgId);
    const mine = this.state.visits.filter((v) => inOrg(v) && v.status !== 'unassigned' && this._mine(u, v));
    const removed = this.state.visits.filter((v) => inOrg(v) && v.updatedAt > updatedSince && !this._mine(u, v) && v.wasAssigned.includes(u.email)).map((v) => v.id);
    return { visits: mine.filter((v) => v.updatedAt >= updatedSince || !updatedSince).map((v) => this._pub(v, u)), removed, at: Date.now() };
  }
  /** Every visit on the sites I can access, assigned to me, to someone else or to nobody, each with ALL its surveys. If I can see the visit I can see and take its surveys. */
  visitsAll(u, { orgId } = {}) {
    const inOrg = (v) => !orgId || orgId === 'all' || v.orgId === String(orgId);
    return { visits: this.state.visits.filter((v) => inOrg(v) && this.isMember(u.email, v.orgId)).map((v) => this._pub(v, u)), at: Date.now(), visitsV: VISITS_V };
  }
  unassignedFor(u, { orgId } = {}) {
    return this.state.visits.filter((v) => v.status === 'unassigned' && this.isMember(u.email, v.orgId) && (!orgId || orgId === 'all' || v.orgId === String(orgId))).map((v) => this._pub(v, u));
  }
  /** Start, block, unblock or complete. Idempotent by key, so a queued change that is replayed cannot apply twice.
   *  403: not yours. 409: the visit changed (reassigned, already in that state). 422: a block needs a reason. */
  visitStatus(u, id, { action, reason, key, rev } = {}) {
    if (key && this.state.idem[key]) return this.state.idem[key];
    const v = this.state.visits.find((x) => x.id === id);
    if (!v || !this._canSee(u, v)) throw new AppError('ERR-VISIT-403');
    const t = TRANSITIONS[action];
    if (!t) throw new AppError('ERR-GEN-000', `Unknown action ${action}`);
    if ((rev != null && rev !== v.rev) || !t.from.includes(v.status)) throw new AppError('ERR-VISIT-409', undefined, { visit: this._pub(v, u) });
    if (action === 'block' && !String(reason || '').trim()) throw new AppError('ERR-VISIT-422');
    v.status = t.to; v.blockedReason = action === 'block' ? String(reason).trim() : ''; if (action === 'start') v.started = true;
    this._bump(v, `${t.text}${action === 'block' ? `: ${v.blockedReason}` : ''}`, `${u.firstName} ${u.lastName}`);
    const out = { visit: this._pub(v, u) };
    if (key) this.state.idem[key] = out;
    return out;
  }
  /** Claim an open visit on a site I can access. First claim wins. */
  claim(u, id, { key } = {}) {
    if (key && this.state.idem[key]) return this.state.idem[key];
    const v = this.state.visits.find((x) => x.id === id);
    if (!v || !this.isMember(u.email, v.orgId)) throw new AppError('ERR-VISIT-403');
    if (v.status !== 'unassigned') throw new AppError('ERR-VISIT-409', 'Someone else claimed this visit. First claim wins. Pick another.', { visit: this._pub(v, u) });
    v.status = 'assigned'; v.assignee = u.email; v.accountable = `${u.firstName} ${u.lastName}`;
    this._bump(v, 'Claimed', v.accountable);
    const out = { visit: this._pub(v, u) }; if (key) this.state.idem[key] = out; return out;
  }
  /** Link a survey record (sent as unallocated) to one of my visits. */
  attach(u, { visitId, recordId, surveyId, title }) {
    const v = this.state.visits.find((x) => x.id === visitId);
    if (!v || !this._canSee(u, v)) throw new AppError('ERR-VISIT-403');
    this.state.attached[recordId] = visitId;
    const rec = this.state.subs[recordId], sid = surveyId || rec?.surveyId;
    if (sid && !(SCOPES[v.scope] || []).some((x) => x.id === sid)) { (v.extras ||= {})[sid] ||= { title: title || ADDONS[sid] || sid, by: u.email }; this._bump(v, `${v.extras[sid].title} added to the visit`, `${u.firstName} ${u.lastName}`); }   // not part of the scope of work: appended
    else this._bump(v, 'Survey attached', `${u.firstName} ${u.lastName}`);
    if (rec?.committed) this._submitted(visitId, rec.surveyId);
    return { ok: true, visit: this._pub(v, u) };
  }
  /** Demo controls for the PM / web app side. */
  adminVisit({ id, op, email }) {
    const v = this.state.visits.find((x) => x.id === id); if (!v) return { ok: false };
    const was = v.assignee;
    if (op === 'assign') { v.assignee = email; v.status = 'assigned'; v.accountable = this.state.users.find((x) => x.email === email)?.firstName || email; this._bump(v, 'Assigned by Priya Nair'); }
    if (op === 'unassign') { if (was) v.wasAssigned.push(was); v.assignee = null; v.status = 'unassigned'; v.accountable = ''; this._bump(v, 'Unassigned by Priya Nair'); }
    if (op === 'reassign') { if (was) v.wasAssigned.push(was); v.assignee = email; v.status = 'assigned'; this._bump(v, 'Reassigned by Priya Nair'); }
    if (op === 'claimedBy') { v.status = 'assigned'; v.assignee = email; v.accountable = 'Sam Okafor'; this._bump(v, 'Claimed', 'Sam Okafor'); }
    this._dirty(); return { ok: true, visit: this._pub(v) };
  }
  /** Membership ends: the next request for that organization returns ERR-AUTH-005 and the phone signs out of it. */
  setMembership({ email, orgId, active }) {
    const o = this.state.orgs.find((x) => x.id === String(orgId)); if (!o) return { ok: false };
    o.members = o.members.filter((m) => m !== email); if (active) o.members.push(email);
    if (!active) for (const v of this.state.visits) if (v.orgId === o.id && v.assignee === email) v.wasAssigned.push(email);
    this._dirty(); return { ok: true };
  }
  resetVisits() { this.state.visits = DEMO_VISITS(); this.state.idem = {}; this.state.attached = {}; this.state.orgs = DEMO_ORGS(); this._dirty(); return { ok: true }; }

  // ---- forms shared with the team ----------------------------------------------------------------
  publishForm(survey) {
    this.state.forms[survey.id] = { survey, publishedAt: Date.now() }; this._dirty();
    return { ok: true };
  }
  // ---- identity: one profile per signed-in user (username, email, name, organizations) ------------
  _profile(u) { return { username: u.username, email: u.email, firstName: u.firstName, lastName: u.lastName, name: `${u.firstName} ${u.lastName}`.trim(), role: u.role || 'member', organizations: this.orgsFor(u.email) }; }
  _open(u, appVersion) {
    const token = globalThis.crypto.randomUUID() + globalThis.crypto.randomUUID();
    this.state.sessions[token] = { userId: u.id, appVersion: appVersion || null, at: Date.now() };   // no expiry: stays signed in until the app updates
    this._dirty();
    return { token, profile: this._profile(u) };
  }
  loginPassword({ username, password, appVersion }) {
    const q = String(username || '').trim().toLowerCase();
    const u = this.state.users.find((x) => x.provider === 'password' && (x.username.toLowerCase() === q || x.email.toLowerCase() === q));
    if (!u || u.password !== password) throw new AppError('ERR-AUTH-002');
    return this._open(u, appVersion);
  }
  loginMicrosoft({ email, appVersion }) {   // real build: validate the Microsoft (OIDC) token, then match the account
    const q = String(email || '').trim().toLowerCase();
    const u = this.state.users.find((x) => x.provider === 'microsoft' && x.email.toLowerCase() === q);
    if (!u) throw new AppError('ERR-AUTH-003');
    return this._open(u, appVersion);
  }
  userFor(token) {
    const sess = this.state.sessions[token];
    const u = sess && this.state.users.find((x) => x.id === sess.userId);
    if (!u) throw new AppError('ERR-AUTH-001');
    return u;
  }
  me(token) { return this._profile(this.userFor(token)); }
  who(u) { return u ? { username: u.username, email: u.email, name: `${u.firstName} ${u.lastName}`.trim(), role: u.role || 'member' } : null; }
  /** Replace the user list. Removed users lose their sessions; records they submitted stay, attributed to them. */
  setUsers(users) {
    this.state.users = users.map((u, i) => ({ id: String(u.id ?? `u${i + 1}`), provider: 'password', ...u }));
    const ids = new Set(this.state.users.map((u) => u.id));
    for (const [t, s] of Object.entries(this.state.sessions)) if (!ids.has(s.userId)) delete this.state.sessions[t];
    this._dirty(); return { ok: true };
  }

  /** Identity-style lookup: organizations the signed-in user (by email) is a member of. */
  orgsFor(email) {
    const e = String(email || '').trim().toLowerCase();
    return e ? this.state.orgs.filter((o) => o.members.some((m) => String(m).trim().toLowerCase() === e)).map((o) => ({ id: o.id, name: o.name })) : [];
  }
  setOrgs(orgs) { this.state.orgs = orgs.map((o) => ({ id: String(o.id), name: String(o.name), members: (o.members || []).map(String) })); this._dirty(); return { ok: true }; }

  setFormScope(id, scope) { const f = this.state.forms[id]; if (f) { f.survey = { ...f.survey, scope: String(scope || '').trim() || undefined }; this._dirty(); } return { ok: !!f }; }
  listForms() { return Object.values(this.state.forms).map((f) => f.survey); }
  setMinSchema(n) { this.state.minSchema = n; this._dirty(); return { minSchema: n }; }

  // ---- shared (multi-phone) records --------------------------------------------------------------
  createShared({ id, title, survey, by, name, user }) {
    if (!this.state.shared[id]) {
      this.state.shared[id] = { id, title, survey, createdBy: by, createdByName: name, createdBy_user: user || null, assignees: user?.email ? [user.email] : [], createdAt: Date.now(), crdt: newState(), ops: [], opIds: {}, participants: {}, status: 'open', recordId: null, amended: false };
      this.state.subs[id] = { schemaVersion: survey.version, answers: {}, manifest: {}, received: {}, committed: false, recordId: null, shared: true };
      this._dirty();
    }
    return this._sharedMeta(this.state.shared[id]);
  }
  _sharedMeta(sh) {
    const photos = livePhotos(sh.crdt), recv = this.state.subs[sh.id]?.received || {};
    return { id: sh.id, title: sh.title, scope: sh.survey.scope || null, formId: sh.survey.id, formVersion: sh.survey.version, createdBy: sh.createdBy, createdByName: sh.createdByName, createdAt: sh.createdAt, status: sh.status, recordId: sh.recordId, amended: !!sh.amended, rev: sh.ops.length, assignees: this._assignees(sh), photos: photos.length, photosReceived: photos.filter((p) => recv[p.id] != null).length };
  }
  _assignees(sh) { return (sh.assignees || []).map((e) => { const u = this.state.users.find((x) => x.email === e); return { email: e, name: u ? `${u.firstName} ${u.lastName}`.trim() : e, role: u?.role || 'member' }; }); }
  /** Team surveys this user can see: the ones they are assigned to (the creator included); a PM sees every site. */
  listShared(user) {
    const all = Object.values(this.state.shared);
    const mine = !user || can(user.role, 'seeAll') ? all : all.filter((s) => (s.assignees || []).includes(user.email) || (!s.assignees?.length));
    return mine.map((s) => this._sharedMeta(s));
  }
  /** People this user can hand work to: everyone who shares an organization with them. */
  teammates(user) {
    const mine = this.state.orgs.filter((o) => o.members.some((m) => m.toLowerCase() === String(user?.email).toLowerCase()));
    const emails = new Set(mine.flatMap((o) => o.members.map((m) => m.toLowerCase())));
    return this.state.users.filter((u) => emails.has(u.email.toLowerCase()) && u.email !== user?.email).map((u) => ({ email: u.email, name: `${u.firstName} ${u.lastName}`.trim(), role: u.role || 'member' }));
  }
  /** Share / reassign. Leads and PMs only. Whoever is removed keeps their entries on the record, credited to them. */
  assign(id, { add = [], remove = [] }, user) {
    if (!can(user?.role, 'share')) throw new AppError('ERR-AUTH-004', `${ROLES[user?.role] || 'Crew members'} cannot share or reassign a survey.`);
    const sh = this._sh(id), set = new Set(sh.assignees || []);
    for (const e of add) set.add(e);
    for (const e of remove) set.delete(e);
    sh.assignees = [...set]; this._dirty();
    return { assignees: this._assignees(sh) };
  }
  getShared(id) {
    const sh = this._sh(id);
    return { ...this._sharedMeta(sh), survey: sh.survey };
  }
  _sh(id) { const sh = this.state.shared[id]; if (!sh) throw new AppError('ERR-SYNC-002', 'Unknown shared record'); return sh; }

  _touch(id, who) {
    if (!who?.deviceId) return;
    const sh = this._sh(id);
    const prev = sh.participants[who.deviceId];
    sh.participants[who.deviceId] = { name: who.name, focus: who.focus || null, lastSeen: Date.now(), pending: who.pending ?? prev?.pending ?? 0 };
  }

  pushOps(id, { deviceId, name, ops, focus, pending }) {
    const sh = this._sh(id);
    let applied = 0;
    for (const op of ops) {
      if (sh.opIds[op.opId]) { this.state.dupes++; continue; }
      sh.opIds[op.opId] = 1;
      applyOp(sh.crdt, op);
      sh.ops.push({ ...op, seq: sh.ops.length + 1 });
      applied++;
    }
    this._touch(id, { deviceId, name, focus, pending });
    if (applied && sh.status === 'submitted') this._amend(sh);      // late edits from a phone that was offline: folded in, never dropped
    if (applied || ops.length) this._dirty();
    return { rev: sh.ops.length, applied };
  }

  _amend(sh) {
    const sub = this.state.subs[sh.id];
    sub.answers = materialize(sh.survey, sh.crdt);
    sub.manifest = Object.fromEntries(livePhotos(sh.crdt).map((p) => [p.id, sub.received[p.id] ?? 0]));
    sh.amended = true;
  }

  pullOps(id, { since = 0, deviceId, name, focus, pending }) {
    const sh = this._sh(id);
    this._touch(id, { deviceId, name, focus, pending });
    const now = Date.now();
    const presence = Object.entries(sh.participants).filter(([, p]) => now - p.lastSeen < this.presenceTtl).map(([d, p]) => ({ deviceId: d, name: p.name, focus: p.focus, pending: p.pending }));
    const sub = this.state.subs[id];
    return { rev: sh.ops.length, ops: sh.ops.slice(since), presence, status: sh.status, recordId: sh.recordId, amended: !!sh.amended, received: Object.keys(sub.received) };
  }

  submitShared(id, { deviceId, name, force, user }) {
    const sh = this._sh(id), sub = this.state.subs[id];
    if (sh.status === 'submitted') return { recordId: sh.recordId, already: true };
    if (user && !can(user.role, 'submit')) throw new AppError('ERR-AUTH-004', `${ROLES[user.role] || 'Crew members'} cannot submit the final record. Ask the crew lead.`, { role: user.role });
    const pending = livePhotos(sh.crdt).filter((p) => sub.received[p.id] == null);
    if (pending.length) {
      const byWho = {};
      for (const p of pending) { const k = p.n || p.by; byWho[k] = (byWho[k] || 0) + 1; }
      throw new AppError('ERR-COLLAB-001', Object.entries(byWho).map(([w, n]) => `${w}: ${n}`).join(', ') + ' photo(s) still uploading', { pending: byWho, total: pending.length });
    }
    if (!force) {
      const now = Date.now();
      const risky = Object.entries(sh.participants).filter(([d, p]) => d !== deviceId && (now - p.lastSeen > this.presenceTtl || p.pending > 0))
        .map(([, p]) => ({ name: p.name, secondsAgo: Math.round((now - p.lastSeen) / 1000), pending: p.pending }));
      if (risky.length) throw new AppError('ERR-COLLAB-003', risky.map((r) => `${r.name} is ${r.pending ? `holding ${r.pending} unsynced change(s)` : `not connected (last seen ${r.secondsAgo}s ago)`}`).join('; ') + ' — their latest changes may be missing', { teammates: risky });
    }
    sub.answers = materialize(sh.survey, sh.crdt);
    sub.manifest = Object.fromEntries(livePhotos(sh.crdt).map((p) => [p.id, sub.received[p.id]]));
    sub.committed = true; sub.recordId = this.state.nextRecord++;
    sh.status = 'submitted'; sh.recordId = sub.recordId; sh.submittedBy = name || deviceId; sub.submittedBy = user || sub.submittedBy || null; sh.submittedAt = Date.now();
    this._dirty();
    return { recordId: sh.recordId };
  }

  // ---- issue reports (device -> dev team) --------------------------------------------------------
  addIssue(issue) {
    if (!this.state.issues.some((i) => i.id === issue.id)) {
      this.state.issues.unshift({ ...issue, status: 'open', receivedAt: Date.now() });
      this.state.issues = this.state.issues.slice(0, 200);
      if (issue.notify) this._notifyForeman(issue);
      this._dirty();
    }
    return { ok: true, id: issue.id };
  }
  /** "Notify my foreman": the reporter's foreman (else the crew leads who share an organization with them) gets it in their app. */
  _notifyForeman(issue) {
    const u = this.state.users.find((x) => x.email === issue.userEmail);
    let to = u?.foreman ? [u.foreman] : [];
    if (!to.length && u) to = this.teammates(u).filter((t) => t.role === 'lead').map((t) => t.email);
    for (const email of to) this.state.notifications.unshift({ id: `${issue.id}:${email}`, to: email, from: issue.user, fromEmail: issue.userEmail, ts: Date.now(), issueId: issue.id, code: issue.code, message: issue.message, read: false });
    this.state.notifications = this.state.notifications.slice(0, 300);
  }
  notificationsFor(user) { return this.state.notifications.filter((n) => n.to === user.email).slice(0, 50); }
  readNotifications(user) { for (const n of this.state.notifications) if (n.to === user.email) n.read = true; this._dirty(); return { ok: true }; }
  setIssueStatus(id, status) {
    const i = this.state.issues.find((x) => x.id === id); if (i) { i.status = status; this._dirty(); }
    return { ok: true };
  }

  // ---- admin / dev-team view -------------------------------------------------------------------
  overview() {
    const records = Object.entries(this.state.subs).map(([id, s]) => ({
      id, shared: !!s.shared, committed: s.committed, recordId: s.recordId, schemaVersion: s.schemaVersion,
      label: s.answers?.siteId || this.state.shared[id]?.title || id.slice(0, 8), by: s.submittedBy?.name || null, contributors: this.state.shared[id] ? attribution(this.state.shared[id].survey, this.state.shared[id].crdt) : [], assignees: this.state.shared[id] ? this._assignees(this.state.shared[id]) : [],
      photos: Object.keys(s.received).length, expected: Object.keys(s.manifest).length, sample: Object.keys(s.received).slice(0, 18),
      bytes: Object.values(s.received).reduce((a, b) => a + b, 0),
    })).sort((a, b) => (b.recordId || 0) - (a.recordId || 0));
    return { stats: this.stats(), orgs: this.state.orgs, users: this.state.users, notifications: this.state.notifications.length, sessions: Object.keys(this.state.sessions).length, records, shared: this.listShared(), forms: this.listForms().map((f) => ({ id: f.id, title: f.title, version: f.version, scope: f.scope || '' })), issues: this.state.issues.map(({ log, ...i }) => ({ ...i, logLines: log?.length || 0 })) };
  }
  getIssue(id) { return this.state.issues.find((i) => i.id === id) || null; }
}
