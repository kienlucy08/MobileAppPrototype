// Multi-phone collaboration on one survey record.
//
//  * Every edit becomes a small op (see crdt.js), applied to the local copy immediately (so the app never waits
//    on the network) and queued in IndexedDB until the server acknowledges it. Offline for an hour? Nothing lost.
//  * Ops carry unique ids, so a retry after a lost reply is ignored by the server instead of applied twice.
//  * Teammates' edits arrive by polling; the form re-renders unless you are typing, in which case it waits.
//  * Photos stay on the phone that took them and upload in the background as they are taken (via the Engine);
//    the record can be submitted once every teammate's photos have reached the server.

import { applyOp, materialize, diff, newState, newId, entryOf, stateToOps } from './crdt.js';
import { NetError } from './errors.js';

const POLL_MS = 1200;

export class Collab extends EventTarget {
  constructor({ db, server, engine, device, pollMs = POLL_MS }) {
    super();
    Object.assign(this, { db, server, engine, device, pollMs });
    this.docs = new Map(); this.list = []; this.forms = [];
    this.svc = 'up'; this.clock = 0; this.focus = {};
    this.onDocChanged = null;                     // (docId) => void : lets the nearby radio pass changes on
    this._listeners = new Map(); this._timers = new Map(); this._nudges = []; this._fails = 0; this._emitT = null; this._listAt = 0; this._formsAt = 0;
  }

  async start() {
    for (const d of await this.db.getAll('shared')) {
      d.presence = []; d.received = {}; d.lastPull = 0;
      this.docs.set(d.id, d); this._ensureSub(d);
    }
    this._emit();
    this._loop();
  }

  // ---- documents --------------------------------------------------------------------------------
  _ensureSub(doc) {
    let sub = this.engine.subs.get(doc.id);
    if (!sub) {
      sub = { id: doc.id, surveyId: doc.survey.id, surveyTitle: doc.survey.title, schemaVersion: doc.survey.version, status: 'shared', shared: true, answers: {}, label: doc.title, createdAt: doc.createdAt || Date.now(), submittedAt: doc.createdAt || Date.now(), page: 0 };
      this.engine.registerSub(sub); this.engine._saveSub(sub);
    }
    if (doc.status === 'submitted' && sub.status !== 'complete') { sub.status = 'complete'; sub.recordId = doc.recordId; this.engine._saveSub(sub); }
    return sub;
  }
  _persist(doc) {
    const { base, presence, received, lastPull, live, dirty, ...rest } = doc;
    clearTimeout(this._timers.get('p' + doc.id));
    this._timers.set('p' + doc.id, setTimeout(() => this.db.put('shared', rest), 150));
  }

  create({ survey, title }) {
    const doc = { id: newId(), title, survey, createdBy: this.device.id, createdByName: this.device.name, createdAt: Date.now(), state: newState(), seq: 0, pending: [], created: false, status: 'open', recordId: null, presence: [], received: {}, lastPull: 0 };
    this.docs.set(doc.id, doc); this._ensureSub(doc); this._persist(doc); this.nudge(); this._emit();
    return doc;
  }

  async join(meta) {
    if (this.docs.has(meta.id)) return this.docs.get(meta.id);
    const full = await this.server.getShared(meta.id);
    const doc = { id: meta.id, title: full.title, survey: full.survey, createdBy: full.createdBy, createdByName: full.createdByName, createdAt: full.createdAt, state: newState(), seq: 0, pending: [], created: true, status: full.status, recordId: full.recordId, presence: [], received: {}, lastPull: 0 };
    this.docs.set(doc.id, doc); this._ensureSub(doc); this._persist(doc);
    this.engine._log('info', null, `Joined team record “${doc.title}”.`, doc.id);
    this.nudge(); this._emit();
    return doc;
  }

  answersOf(id) { const d = this.docs.get(id); return d ? materialize(d.survey, d.state) : {}; }

  /** The form adopts a set of answers (on open, and after a teammate's edit): from now on only changes the user
   *  makes on top of *these* answers become ops, so a teammate's edit can never be reverted by a stale copy. */
  adopt(id, answers) {
    const d = this.docs.get(id); if (!d) return answers;
    d.live = answers; d.base = JSON.parse(JSON.stringify(answers));
    return answers;
  }
  open(id) { return this.adopt(id, this.answersOf(id)); }

  // ---- local edits ------------------------------------------------------------------------------
  attach(id, onRemote) {
    const set = this._listeners.get(id) || new Set(); set.add(onRemote); this._listeners.set(id, set);
    return () => { set.delete(onRemote); this.focus[id] = null; };
  }
  localChanged(id, answers) {
    const d = this.docs.get(id); if (!d) return;
    d.live = answers; d.dirty = true; this._emit();
    clearTimeout(this._timers.get('f' + id));
    this._timers.set('f' + id, setTimeout(() => this.flush(id), 300));
  }
  flush(id) {
    const d = this.docs.get(id); if (!d || !d.live || d.status === 'submitted') return;
    const photoMeta = (pid) => {
      const r = this.engine.media.get(pid);
      return r ? { name: r.name, size: r.size, w: r.w, h: r.h, thumb: r.thumb, meta: { noLocation: r.meta?.noLocation, capturedAt: r.meta?.capturedAt } } : {};
    };
    d.dirty = false;
    const ops = diff(d.survey, d.base || this.answersOf(id), d.live, photoMeta);
    if (!ops.length) return;
    for (const o of ops) {
      this.clock = Math.max(Date.now(), this.clock + 1);
      const op = { ...o, opId: newId(), t: this.clock, by: this.device.id, n: this.device.name };
      applyOp(d.state, op); d.pending.push(op);
    }
    d.base = JSON.parse(JSON.stringify(d.live));
    this._persist(d); this.nudge(); this._emit(); this.onDocChanged?.(id);
  }
  setFocus(id, path) { if (this.focus[id] !== path) { this.focus[id] = path; this.nudge(); } }

  // ---- sync loop --------------------------------------------------------------------------------
  nudge() { if (this._nudges.length) this._nudges.splice(0).forEach((f) => f()); else this._nudged = true; }   // remembered if the loop is mid-request
  _sleep(ms) { if (this._nudged) { this._nudged = false; return Promise.resolve(); } return new Promise((res) => { const done = () => { clearTimeout(t); res(); }; const t = setTimeout(done, ms); this._nudges.push(done); }); }

  async _loop() {
    for (;;) {
      await this._sleep(this.pollMs);
      if (this.svc === 'down') {
        try { await this.server.ping(); this.svc = 'up'; this._fails = 0; this.engine._log('info', null, 'Team sync restored — pushing queued edits.'); this._emit(); } catch { await this._sleep(2500); continue; }
      }
      try {
        for (const doc of [...this.docs.values()]) {
          const active = (this._listeners.get(doc.id)?.size || 0) > 0;
          if (doc.status === 'submitted' && !doc.pending.length) continue;
          if (!active && !doc.pending.length && doc.created && Date.now() - doc.lastPull < 4000) continue;
          await this._sync(doc);
        }
        this._fails = 0;
        if (Date.now() - this._listAt > 4000) { this.list = await this.server.listShared(); this._listAt = Date.now(); this._emit(); }
        if (Date.now() - this._formsAt > 8000) { this.forms = await this.server.listForms(); this._formsAt = Date.now(); this._emit(); }
      } catch (e) {
        if (e instanceof NetError) {
          this._fails++;
          if (this._fails >= 3 && this.svc === 'up') {
            this.svc = 'down';
            const n = [...this.docs.values()].reduce((a, d) => a + d.pending.length, 0);
            this.engine._log('warn', 'ERR-NET-002', `Team sync paused — ${n} edit(s) saved on this phone and queued. Keep working.`);
          }
          this._emit();
        } else { this.engine._log('error', e.code || 'ERR-GEN-000', `Team sync: ${e.message}`); }
      }
    }
  }

  async _sync(doc) {
    const { server, device } = this;
    if (!doc.created) { await server.createShared({ id: doc.id, title: doc.title, survey: doc.survey, by: device.id, name: device.name }); doc.created = true; this._persist(doc); }
    while (doc.pending.length) {
      const batch = doc.pending.slice(0, 150);
      try { await server.pushOps(doc.id, { deviceId: device.id, name: device.name, ops: batch, focus: this.focus[doc.id], pending: doc.pending.length }); }
      catch (e) { throw e; }
      doc.pending.splice(0, batch.length); this._persist(doc);
    }
    const r = await server.pullOps(doc.id, { since: doc.seq, deviceId: device.id, name: device.name, focus: this.focus[doc.id], pending: doc.pending.length });
    doc.lastPull = Date.now();
    if (r.ops.length) {
      this.flush(doc.id);
      let foreign = false;
      for (const op of r.ops) { this.clock = Math.max(this.clock, op.t); applyOp(doc.state, op); if (op.by !== device.id) foreign = true; }
      doc.seq = r.rev; this._persist(doc);
      if (foreign) { (this._listeners.get(doc.id) || []).forEach((cb) => cb(this.answersOf(doc.id))); this.onDocChanged?.(doc.id); }
    }
    doc.amended = r.amended;
    doc.presence = r.presence.filter((p) => p.deviceId !== device.id);
    doc.received = Object.fromEntries(r.received.map((i) => [i, 1]));
    if (r.status === 'submitted' && doc.status !== 'submitted') this._markSubmitted(doc, r.recordId);
    this._emit();
  }

  _markSubmitted(doc, recordId) {
    doc.status = 'submitted'; doc.recordId = recordId; this._persist(doc);
    this._ensureSub(doc); this.engine._log('info', null, `Team record “${doc.title}” submitted as #${recordId}.`, doc.id);
    (this._listeners.get(doc.id) || []).forEach((cb) => cb(this.answersOf(doc.id), true));
  }

  async submit(id, { force = false } = {}) {
    const doc = this.docs.get(id);
    this.flush(id);
    for (let i = 0; i < 4 && (doc.pending.length || !doc.created); i++) await this._sync(doc);
    if (doc.pending.length) throw new NetError('ERR-NET-002', 'Edits are still queued on this phone');
    const r = await this.server.submitShared(id, { deviceId: this.device.id, name: this.device.name, force });
    this._markSubmitted(doc, r.recordId);
    return r;
  }

  // ---- phone-to-phone (nearby) sync: exchange whole state, apply what is newer, queue it for the server ----------
  exportDoc(id) {
    const d = this.docs.get(id); if (!d) return null; this.flush(id);
    return { meta: { id: d.id, title: d.title, createdBy: d.createdBy, createdByName: d.createdByName, createdAt: d.createdAt, status: d.status, recordId: d.recordId }, survey: d.survey, state: JSON.parse(JSON.stringify(d.state)) };
  }
  /** Merge a peer's state. Everything that was new to us is also queued, so whichever phone reaches signal first relays it. */
  mergeState(id, state, meta) {
    const d = this.docs.get(id); if (!d) return 0;
    this.flush(id);
    const queued = new Set(d.pending.map((o) => o.opId));
    let changed = 0;
    for (const op of stateToOps(state)) {
      this.clock = Math.max(this.clock, op.t);
      const before = entryOf(d.state, op);
      applyOp(d.state, op);
      if (entryOf(d.state, op) !== before) { changed++; if (!queued.has(op.opId)) d.pending.push(op); }
    }
    if (meta?.status === 'submitted' && d.status !== 'submitted') this._markSubmitted(d, meta.recordId);
    if (changed) {
      this._persist(d); this._emit();
      (this._listeners.get(id) || []).forEach((cb) => cb(this.answersOf(id)));
      this.onDocChanged?.(id);
    }
    return changed;
  }
  /** Join a record that a nearby phone has, with no server involved. The server learns about it when someone has signal. */
  joinFromPeer({ meta, survey, state }) {
    if (this.docs.has(meta.id)) return this.docs.get(meta.id);
    const doc = { id: meta.id, title: meta.title, survey, createdBy: meta.createdBy, createdByName: meta.createdByName, createdAt: meta.createdAt, state: newState(), seq: 0, pending: [], created: false, status: 'open', recordId: null, presence: [], received: {}, lastPull: 0 };
    this.docs.set(doc.id, doc); this._ensureSub(doc);
    this.mergeState(doc.id, state, meta);
    this.engine._log('info', null, `Joined “${doc.title}” from a nearby phone (no server needed).`, doc.id);
    this._persist(doc); this.nudge(); this._emit();
    return doc;
  }

  // ---- read model -------------------------------------------------------------------------------
  remotePhoto(id, mediaId) {
    const d = this.docs.get(id); if (!d) return null;
    for (const m of Object.values(d.state.photos)) if (m[mediaId]) return { ...m[mediaId].m, by: m[mediaId].by, byName: m[mediaId].n, received: !!d.received[mediaId] };
    return null;
  }
  /** Photos per person for the status panel: [{who, mine, total, received}] */
  photoProgress(id) {
    const d = this.docs.get(id); if (!d) return [];
    const by = {};
    for (const m of Object.values(d.state.photos)) for (const [pid, e] of Object.entries(m)) {
      if (e.del) continue;
      const k = e.by; const row = (by[k] ||= { who: e.n || k, mine: k === this.device.id, total: 0, received: 0 });
      row.total++; if (d.received[pid]) row.received++;
    }
    return Object.values(by);
  }
  unsynced() { return [...this.docs.values()].reduce((a, d) => a + d.pending.length + (d.dirty ? 1 : 0), 0); }
  _emit() {
    if (this._emitT) return;
    this._emitT = setTimeout(() => { this._emitT = null; this.dispatchEvent(new Event('change')); }, 100);
  }
}
