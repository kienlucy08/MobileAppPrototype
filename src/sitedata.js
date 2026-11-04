// Pull values from other surveys collected for the same site (e.g. the climber's guy attachment elevations from the structure
// survey, for the guy facilities survey). Never blocks the form and never fails it: the answer is read from, in order,
//   1. this phone's own records for the site (the climber and the guy-facilities person may share a phone, or a team record),
//   2. what the server already has for the site (fetched when there is signal, cached for offline),
// and if neither has it yet the form returns "" and the crew types the value, or the web app processes it later.

import { CTX } from './expr.js';
import { withFaults } from './mockServer.js';
import { levelElevation } from './guycalc.js';

export const STRUCTURE_SURVEY = 'demo-fs-structure-climb-inspection';
const norm = (s) => String(s ?? '').trim().toLowerCase();

export class SiteData {
  constructor({ server, engine, storageKey, retryMs = 5000 }) {
    this.staleMs = 30000; this.server = server; this.engine = engine; this.storageKey = storageKey; this.retryMs = retryMs;
    this.listeners = new Set(); this.pending = new Map();
    try { this.cache = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch { this.cache = {}; }
  }
  install() { CTX.site = { level: (site, level) => this.level(site, level) }; }
  onResolve(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  /** Structure-survey answers for a site, and where they came from. */
  structure(site) {
    const key = norm(site); if (!key) return undefined;
    const local = [...this.engine.subs.values()].filter((s) => s.surveyId === STRUCTURE_SURVEY && norm(s.answers?.siteId) === key && (s.answers?.guyLevels || []).length)
      .sort((a, b) => (b.status === 'draft') - (a.status === 'draft') || b.updatedAt - a.updatedAt);   // a submitted record beats a draft
    const sub = local.find((s) => s.status !== 'draft') || local[0];
    if (sub) return { answers: sub.answers, from: sub.status === 'draft' ? 'this phone (not finished)' : 'this phone' };
    const c = this.cache[key], hit = c?.data?.[STRUCTURE_SURVEY];
    if (!c || Date.now() - c.at > this.staleMs) this._fetch(key);          // never fetched, or old: ask again in the background
    return hit ? { answers: hit, from: 'server' } : undefined;
  }
  level(site, level) { const s = this.structure(site); return s ? levelElevation(s.answers, level) : undefined; }

  async _fetch(key) {
    if (this.pending.has(key)) return;
    const p = { timer: null }; this.pending.set(key, p);
    try {
      const data = await withFaults(this.server, 1500, () => this.server.siteData(key));
      this.cache[key] = { at: Date.now(), data }; this.pending.delete(key);
      try { localStorage.setItem(this.storageKey, JSON.stringify(this.cache)); } catch { /* ignore */ }
      if (data?.[STRUCTURE_SURVEY]) this.listeners.forEach((cb) => cb());
    } catch {
      p.timer = setTimeout(() => { this.pending.delete(key); this._fetch(key); }, this.retryMs / (this.server.scale || 1));   // offline: keep trying quietly
    }
  }
  /** Re-ask the server for a site now (used after a structure survey is submitted, or when signal returns). */
  refresh(site) { const key = norm(site); delete this.cache[key]; for (const [k, p] of this.pending) { clearTimeout(p.timer); this.pending.delete(k); } if (key) this._fetch(key); }
}
