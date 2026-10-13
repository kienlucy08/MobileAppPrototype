// Upload engine — the reliability core.
//
// Guarantees (each is covered by test/engine.test.mjs):
//  * State lives in the local DB, so a crash/kill/reload resumes exactly where it stopped.
//  * Retries are per item with exponential backoff + jitter — one bad photo never restarts the batch.
//  * Idempotent protocol: begin(recordId) → putMedia(recordId, mediaId)* → commit(recordId).
//    Replaying any step (lost ack, restart) can't create duplicates; the server returns what it already has.
//  * When several requests in a row fail, the engine declares "service down", stops hammering, and
//    probes cheaply until the network is back — then continues in place. Nothing is re-sent that already landed.
//  * commit() is verified: if the server reports missing photos they're re-queued instead of dropped.
//  * Only permanent errors (bad photo, schema mismatch) stop a record, and they carry a catalog code.

import { AppError, NetError } from './errors.js';

const CONCURRENCY = 3;
const DOWN_AFTER = 3;          // consecutive transport failures before we declare "service down"
class Stop extends Error {}

export class Engine extends EventTarget {
  constructor({ db, server, scale = 1 }) {
    super();
    this.db = db; this.server = server; this.scale = scale;
    this.subs = new Map(); this.media = new Map(); this.bySub = new Map();
    this.svc = 'up'; this.userPaused = false;
    this.retries = 0; this.freedBytes = 0; this.logs = [];
    this._fails = 0; this._running = false; this._probeP = null; this._wake = []; this._nudges = []; this._emitT = null;
  }

  // ---- registry ---------------------------------------------------------------------------------
  registerSub(sub) { this.subs.set(sub.id, sub); }
  registerMedia(rec) {
    this.media.set(rec.id, rec);
    if (!this.bySub.has(rec.subId)) this.bySub.set(rec.subId, []);
    const arr = this.bySub.get(rec.subId);
    if (!arr.includes(rec)) arr.push(rec);
  }
  mediaFor(subId) { return this.bySub.get(subId) || []; }
  async removeMedia(id) {
    const rec = this.media.get(id); if (!rec) return;
    this.media.delete(id);
    const arr = this.bySub.get(rec.subId); if (arr) arr.splice(arr.indexOf(rec), 1);
    await this.db.del('media', id); await this.db.del('blobs', id);
  }
  async deleteSub(id) {
    for (const m of [...this.mediaFor(id)]) await this.removeMedia(m.id);
    this.subs.delete(id); this.bySub.delete(id);
    await this.db.del('submissions', id);
    this._emit();
  }

  async start() {
    const [subs, media] = await Promise.all([this.db.getAll('submissions'), this.db.getAll('media')]);
    let recovered = 0;
    for (const s of subs) {
      if (s.status === 'uploading') { s.status = 'queued'; recovered++; await this.db.put('submissions', s); }
      this.registerSub(s);
    }
    for (const m of media) {
      if (m.state === 'uploading') { m.state = 'queued'; await this.db.put('media', m); }
      this.registerMedia(m);
    }
    if (recovered) this._log('info', null, `Recovered ${recovered} in-flight record(s) after restart — resuming, not restarting.`);
    this._emit();
    this._loop();
  }

  // ---- public controls --------------------------------------------------------------------------
  async submit(sub, keepIds) {
    for (const m of [...this.mediaFor(sub.id)]) if (!keepIds.has(m.id)) await this.removeMedia(m.id);
    for (const m of this.mediaFor(sub.id)) if (m.state === 'local') { m.state = 'queued'; await this._saveMedia(m); }
    sub.status = 'queued'; sub.submittedAt = Date.now(); sub.error = null;
    await this._saveSub(sub);
    this._log('info', null, `Saved to outbox with ${this.mediaFor(sub.id).length} photo(s). Uploading in background.`, sub.id);
    this._loop();
  }
  async retry(subId) {
    const sub = this.subs.get(subId); if (!sub) return;
    for (const m of this.mediaFor(subId)) if (m.state === 'failed') { m.state = 'queued'; m.attempts = 0; m.nextAttemptAt = 0; m.errorCode = null; await this._saveMedia(m); }
    sub.status = 'queued'; sub.error = null; await this._saveSub(sub);
    this._log('info', null, 'Manual retry requested.', subId);
    this.nudge(); this._loop();
  }
  pause() { this.userPaused = true; this._log('info', null, 'Uploads paused by user.'); this._emit(); }
  resume() { this.userPaused = false; this._log('info', null, 'Uploads resumed.'); this._wake.splice(0).forEach((f) => f()); this._emit(); this._loop(); }
  nudge() { this._nudges.splice(0).forEach((f) => f()); }

  // ---- main loop --------------------------------------------------------------------------------
  async _loop() {
    if (this._running) return;
    this._running = true;
    try {
      for (;;) {
        const next = [...this.subs.values()]
          .filter((s) => s.status === 'queued' || s.status === 'uploading' || this._sharedHasWork(s))
          .sort((a, b) => a.submittedAt - b.submittedAt)[0];
        if (!next) break;
        try { await this._runSubmission(next); }
        catch (e) {
          if (e instanceof Stop) continue;
          next.status = 'failed'; next.error = { code: 'ERR-GEN-000', detail: e.stack || e.message };
          await this._saveSub(next); this._log('error', 'ERR-GEN-000', e.message, next.id);
        }
      }
    } finally { this._running = false; this._emit(); }
  }

  // Team records: photos upload as they are taken (the record itself is handled by Collab on the server).
  _sharedHasWork(s) { return s.shared && s.status === 'shared' && !this.userPaused && this.mediaFor(s.id).some((m) => m.state === 'queued' || m.state === 'uploading'); }
  kick() { this._loop(); }

  async _runSubmission(sub) {
    const items = this.mediaFor(sub.id);
    if (sub.shared) {
      await Promise.all(Array.from({ length: CONCURRENCY }, () => this._worker(sub, items)));
      for (const m of items) if (m.state === 'done' && !m.blobFreed) { await this.db.del('blobs', m.id); m.blobFreed = true; this.freedBytes += m.size; await this._saveMedia(m); }
      return;
    }
    sub.status = 'uploading'; await this._saveSub(sub);

    if (!sub.began) {
      await this._retry(sub, async () => {
        const r = await this.server.begin({
          id: sub.id, schemaVersion: sub.schemaVersion, answers: sub.answers,
          media: items.map((m) => ({ id: m.id, fieldPath: m.fieldPath, size: m.size, name: m.name, w: m.w, h: m.h, meta: m.meta })),
        });
        for (const id of r.have) { const m = this.media.get(id); if (m && m.state !== 'done') { m.state = 'done'; await this._saveMedia(m); } }
        sub.began = true; await this._saveSub(sub);
      });
    }

    for (;;) {
      await Promise.all(Array.from({ length: CONCURRENCY }, () => this._worker(sub, items)));
      const failed = items.filter((m) => m.state === 'failed');
      if (failed.length) {
        sub.status = 'failed'; sub.error = { code: failed[0].errorCode, detail: `${failed.length} photo(s) failed permanently. First: ${failed[0].name}` };
        await this._saveSub(sub);
        this._log('error', sub.error.code, sub.error.detail, sub.id);
        return;
      }
      const r = await this._retry(sub, () => this.server.commit({ id: sub.id }));
      if (r.missing.length) {
        for (const id of r.missing) { const m = this.media.get(id); if (m) { m.state = 'queued'; m.attempts = 0; m.nextAttemptAt = 0; await this._saveMedia(m); } }
        this._log('warn', 'ERR-SYNC-004', `Server was missing ${r.missing.length} photo(s) at commit — re-queued.`, sub.id);
        continue;
      }
      sub.recordId = r.recordId; sub.status = 'complete'; sub.completedAt = Date.now(); sub.error = null;
      for (const m of items) { await this.db.del('blobs', m.id); if (!m.blobFreed) { m.blobFreed = true; this.freedBytes += m.size; await this._saveMedia(m); } }
      await this._saveSub(sub);
      this._log('info', null, `Record #${sub.recordId} committed — ${items.length} photo(s) verified on server.`, sub.id);
      return;
    }
  }

  async _worker(sub, items) {
    for (;;) {
      await this._gate();
      const pending = items.filter((m) => m.state === 'queued' || m.state === 'uploading');
      if (!pending.length) return;
      const now = Date.now();
      const m = pending.find((x) => x.state === 'queued' && x.nextAttemptAt <= now);
      if (!m) {
        const soonest = Math.min(now + 200, ...pending.filter((x) => x.state === 'queued').map((x) => x.nextAttemptAt));
        await this._sleepOrNudge(Math.max(20, soonest - now));
        continue;
      }
      m.state = 'uploading';                       // claim synchronously so no other worker takes it
      this._emit();
      try {
        const blob = await this.db.get('blobs', m.id);
        if (!blob) throw new AppError('ERR-IMG-002', `Local copy of ${m.name} is missing.`);
        await this.server.putMedia({ id: sub.id, mediaId: m.id, size: m.size, blob: blob.blob });
        m.state = 'done'; m.errorCode = null; this._fails = 0;
        const done = items.filter((x) => x.state === 'done').length;
        if (done % 50 === 0) this._log('info', null, `${done} of ${items.length} photos safe on server.`, sub.id);
      } catch (e) {
        if (e instanceof NetError) {
          m.attempts++; m.state = 'queued'; m.errorCode = e.code; m.nextAttemptAt = Date.now() + this._backoff(m.attempts);
          this._netFail(e, sub, `photo ${m.name} (attempt ${m.attempts})`);
        } else if (sub.shared && e.code === 'ERR-SYNC-002') {            // a team record the server has not been told about yet (it is created when someone with signal syncs): wait, don't fail
          m.attempts++; m.state = 'queued'; m.nextAttemptAt = Date.now() + this._backoff(Math.min(m.attempts, 4));
          this.dispatchEvent(new Event('waiting-for-record'));
        } else {
          m.state = 'failed'; m.errorCode = e.code || 'ERR-GEN-000';
          this._log('error', m.errorCode, `${m.name}: ${e.message}`, sub.id);
        }
      }
      await this._saveMedia(m); this._emit();
    }
  }

  /** Runs a whole-record request (begin/commit) with the same retry semantics as photos. */
  async _retry(sub, fn) {
    let attempts = 0;
    for (;;) {
      await this._gate();
      try { const r = await fn(); this._fails = 0; return r; }
      catch (e) {
        if (e instanceof NetError) { attempts++; this._netFail(e, sub, 'record request'); await this._sleepOrNudge(this._backoff(attempts)); continue; }
        sub.status = 'failed'; sub.error = { code: e.code || 'ERR-GEN-000', detail: e.message };
        await this._saveSub(sub); this._log('error', sub.error.code, e.message, sub.id);
        throw new Stop();
      }
    }
  }

  // ---- connectivity -----------------------------------------------------------------------------
  _netFail(e, sub, what) {
    this._fails++; this.retries++;
    this._log('warn', e.code, `${what}: ${e.message} — retry queued`, sub.id);
    if (this._fails >= DOWN_AFTER && this.svc === 'up') {
      this.svc = 'down';
      const items = this.mediaFor(sub.id);
      this._log('error', 'ERR-NET-002', `Lost service — uploads paused in place at ${items.filter((m) => m.state === 'done').length}/${items.length}. Will resume automatically.`, sub.id);
    }
    this._emit();
  }
  async _gate() {
    for (;;) {
      if (this.userPaused) { await new Promise((r) => this._wake.push(r)); continue; }
      if (this.svc === 'down') { await this._probe(); continue; }
      return;
    }
  }
  _probe() {
    if (!this._probeP) {
      this._probeP = (async () => {
        while (!this.userPaused) {
          await this._sleepOrNudge(2500 / this.scale);
          try { await this.server.ping(); this.svc = 'up'; this._fails = 0; this._log('info', null, 'Service restored — resuming where we left off.'); break; } catch { /* still down */ }
        }
        this._probeP = null; this._emit();
      })();
    }
    return this._probeP;
  }
  _backoff(attempts) { return (Math.min(30000, 800 * 2 ** (attempts - 1)) * (0.75 + Math.random() * 0.5)) / this.scale; }
  _sleepOrNudge(ms) {
    return new Promise((res) => { const done = () => { clearTimeout(t); res(); }; const t = setTimeout(done, ms); this._nudges.push(done); });
  }

  // ---- persistence / log / events ---------------------------------------------------------------
  _saveSub(s) { return this.db.put('submissions', s); }
  _saveMedia(m) { return this.db.put('media', m); }
  _log(level, code, msg, subId) {
    const e = { ts: Date.now(), level, code, msg, subId: subId || null };
    this.logs.push(e); if (this.logs.length > 400) this.logs.shift();
    this.db.put('log', e);
    this._emit();
  }
  _emit() {
    if (this._emitT) return;
    this._emitT = setTimeout(() => { this._emitT = null; this.dispatchEvent(new Event('change')); }, 120);
  }

  // ---- read model for the UI --------------------------------------------------------------------
  countsFor(subId) {
    const c = { local: 0, queued: 0, retrying: 0, uploading: 0, done: 0, failed: 0, total: 0, bytes: 0, bytesDone: 0, origBytes: 0 };
    for (const m of this.mediaFor(subId)) {
      c.total++; c.bytes += m.size; c.origBytes += m.origSize || m.size;
      if (m.state === 'done') c.bytesDone += m.size;
      if (m.state === 'queued' && m.attempts > 0) c.retrying++; else c[m.state]++;
    }
    return c;
  }
  summary() {
    let pending = 0, failed = 0, queueBytes = 0;
    for (const s of this.subs.values()) {
      if (s.status === 'draft' || s.status === 'complete') continue;
      const c = this.countsFor(s.id);
      pending += c.total - c.done - c.failed; failed += c.failed; queueBytes += c.bytes - c.bytesDone;
    }
    return { pending, failed, queueBytes, retries: this.retries, svc: this.svc, paused: this.userPaused, freedBytes: this.freedBytes };
  }
}
