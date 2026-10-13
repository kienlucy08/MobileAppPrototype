// "Send to dev team": bundles everything a developer needs to trace a problem — without asking the field user
// to dig out logs — and delivers it with the same retry rules as a survey. Reports are queued in IndexedDB, so
// one filed with no signal is sent automatically when service returns.

import { newId } from './crdt.js';
import { NetError } from './errors.js';

export const APP_VERSION = 'prototype-0.4';

export class Reporter extends EventTarget {
  constructor({ db, server, engine, collab, device }) {
    super(); Object.assign(this, { db, server, engine, collab, device });
    this.pending = 0; this._nudges = []; this.lastSent = null;
  }
  async start() { this.pending = (await this.db.getAll('issues')).filter((i) => !i.sent).length; this._loop(); }

  async build({ message, subId, code, includeRecord = true }) {
    const e = this.engine, sub = subId && e.subs.get(subId);
    const log = (await this.db.getAll('log')).slice(-300).map(({ ts, level, code, msg, subId }) => ({ ts, level, code, msg, subId }));
    const est = await navigator.storage?.estimate?.().catch(() => null);
    const rec = sub && includeRecord ? {
      id: sub.id, label: sub.label, status: sub.status, shared: !!sub.shared, schemaVersion: sub.schemaVersion, error: sub.error || null,
      answers: sub.answers,
      media: e.mediaFor(sub.id).map(({ thumb, ...m }) => m),
    } : null;
    return {
      id: newId(), ts: Date.now(), message: message || '', code: code || sub?.error?.code || null,
      user: this.device.name, device: this.device.id, appVersion: APP_VERSION, ua: navigator.userAgent,
      network: { profile: this.server.profileName, engine: e.svc, team: this.collab.svc, online: navigator.onLine },
      summary: { ...e.summary(), unsyncedEdits: this.collab.unsynced() },
      storage: est ? { usage: est.usage, quota: est.quota } : null,
      record: rec, log,
    };
  }

  async send(opts) {
    const issue = await this.build(opts);
    await this.db.put('issues', { ...issue, sent: false });
    this.pending++; this._emit(); this.nudge();
    return issue;
  }
  nudge() { if (this._nudges.length) this._nudges.splice(0).forEach((f) => f()); else this._nudged = true; }   // remembered if the loop is mid-request
  _sleep(ms) { if (this._nudged) { this._nudged = false; return Promise.resolve(); } return new Promise((res) => { const done = () => { clearTimeout(t); res(); }; const t = setTimeout(done, ms); this._nudges.push(done); }); }

  async _loop() {
    for (;;) {
      await this._sleep(3000);
      const queued = (await this.db.getAll('issues')).filter((i) => !i.sent);
      for (const issue of queued) {
        try {
          const { sent, ...payload } = issue;
          await this.server.addIssue(payload);
          await this.db.put('issues', { id: issue.id, ts: issue.ts, message: issue.message, sent: true });   // drop the heavy payload once delivered
          this.lastSent = issue.ts;
          this.engine._log('info', null, 'Problem report delivered to the dev team.');
        } catch (e) { if (!(e instanceof NetError)) this.engine._log('error', e.code || 'ERR-GEN-000', `Report failed: ${e.message}`); break; }
      }
      this.pending = (await this.db.getAll('issues')).filter((i) => !i.sent).length;
      this._emit();
    }
  }
  _emit() { this.dispatchEvent(new Event('change')); }
}
