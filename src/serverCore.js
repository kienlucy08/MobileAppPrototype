// Server-side logic, free of any transport. Used by:
//   - server/server.js        (real HTTP server, persists to disk)
//   - src/mockServer.js       (in-process, for the engine tests)
// Everything is idempotent: replaying a request never creates a second record, photo, op or issue.

import { AppError } from './errors.js';
import { newState, applyOp, materialize, livePhotos, attribution } from './crdt.js';

export const MAX_PHOTO_BYTES = 30 * 1024 * 1024;

// Who can do what on a team survey (deck: Permissions). The server enforces it; the app only mirrors it.
export const ROLES = { member: 'Crew member', lead: 'Crew lead', pm: 'PM / admin' };
export const CAN = {
  submit: ['lead', 'pm'],
  share: ['lead', 'pm'],
  seeAll: ['pm'],
};
export const can = (role, action) => (CAN[action] || []).includes(role);

// Demo directory standing in for the identity service: users see only the organizations they belong to.
const DEMO_ORGS = () => [
  { id: '1001', name: 'Acme Field Services', members: ['maria@demo.test', 'sam@demo.test', 'dana@demo.test'] },
  { id: '1002', name: 'Summit Inspections', members: ['priya@demo.test', 'dana@demo.test'] },
];
// Stand-in for the FieldSync identity service (the real app authenticates against the web app's accounts:
// Microsoft login for some users, username + password for others). Demo credentials only — never ships.
const DEMO_USERS = () => [
  { id: 'u1', username: 'maria', email: 'maria@demo.test', firstName: 'Maria', lastName: 'Lopez', provider: 'microsoft', role: 'lead' },
  { id: 'u2', username: 'sam', email: 'sam@demo.test', firstName: 'Sam', lastName: 'Okafor', provider: 'password', password: 'demo', role: 'member', foreman: 'maria@demo.test' },
  { id: 'u3', username: 'dana', email: 'dana@demo.test', firstName: 'Dana', lastName: 'Reyes', provider: 'password', password: 'demo', role: 'lead' },
  { id: 'u4', username: 'priya', email: 'priya@demo.test', firstName: 'Priya', lastName: 'Nair', provider: 'microsoft', role: 'pm' },
];
export const freshState = () => ({ users: DEMO_USERS(), sessions: {}, subs: {}, minSchema: 1, nextRecord: 1001, dupes: 0, forms: {}, shared: {}, issues: [], orgs: DEMO_ORGS(), notifications: [] });

export class ServerCore {
  constructor(state) {
    this.state = state || freshState();
    for (const k of Object.keys(freshState())) if (this.state[k] === undefined) this.state[k] = freshState()[k];
    for (const u of this.state.users) { const d = DEMO_USERS().find((x) => x.id === u.id && x.email === u.email); if (u.role === 'reviewer') u.role = 'lead';   // the reviewer role was removed
      if (d) for (const k of ['role', 'foreman']) if (u[k] === undefined && d[k] !== undefined) u[k] = d[k]; }   // states saved before roles existed
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
  begin({ id, schemaVersion, answers, media, user }) {
    if (schemaVersion < this.state.minSchema) {
      throw new AppError('ERR-SYNC-001', `Record was collected on form v${schemaVersion}; server now requires v${this.state.minSchema}+.`);
    }
    let s = this.state.subs[id];
    const dupe = !!s;
    if (!s) s = this.state.subs[id] = { schemaVersion, answers, manifest: Object.fromEntries(media.map((m) => [m.id, m.size])), submittedBy: user || null, received: {}, committed: false, recordId: null, meta: Object.fromEntries(media.map((m) => [m.id, { name: m.name, fieldPath: m.fieldPath, w: m.w, h: m.h, meta: m.meta }])) };
    else {
      this.state.dupes++;
      if (!s.committed && !s.shared) {         // an unfinished record that was edited and re-sent (e.g. a bad photo replaced): take the new manifest, keep what already arrived
        s.schemaVersion = schemaVersion; s.answers = answers; s.manifest = Object.fromEntries(media.map((m) => [m.id, m.size]));
        s.meta = Object.fromEntries(media.map((m) => [m.id, { name: m.name, fieldPath: m.fieldPath, w: m.w, h: m.h, meta: m.meta }]));
        for (const id of Object.keys(s.received)) if (!(id in s.manifest)) delete s.received[id];
      }
    }
    this._dirty();
    return { have: Object.keys(s.received), dupe };
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
    return { recordId: s.recordId, missing: [] };
  }

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
