// Client for server/server.js. Same interface the upload engine already uses (ping/begin/putMedia/commit),
// plus shared records, forms and issue reports. Every call passes through withFaults(), so the "field
// conditions" (flaky / poor / no service) apply to real HTTP traffic exactly as they did to the mock.

import { AppError, NetError } from './errors.js';
import { PROFILES, withFaults } from './mockServer.js';

export { PROFILES };

export class RemoteServer {
  constructor({ scale = 1, profile = 'good', base = '' } = {}) {
    this.scale = scale; this.profileName = profile; this.base = base; this.acksLost = 0; this.token = null; this.onAuthError = null;
    this._stats = { dupesPrevented: 0, receivedItems: 0, records: 0, minSchema: 1, sharedOpen: 0, issuesOpen: 0 };
  }
  get profile() { return PROFILES[this.profileName]; }
  setProfile(n) { this.profileName = n; }
  setToken(t) { this.token = t; }
  stats() { return { ...this._stats, acksLost: this.acksLost }; }

  async _fetch(method, url, body, raw, extra = {}) {
    let res;
    try {
      res = await fetch(this.base + url, { method, body: raw ? body : body === undefined ? undefined : JSON.stringify(body), headers: { ...(raw ? { 'content-type': 'application/octet-stream' } : body === undefined ? {} : { 'content-type': 'application/json' }), ...(this.token ? { authorization: `Bearer ${this.token}` } : {}), ...extra } });
    } catch { throw new NetError('ERR-NET-002', 'Cannot reach the server'); }
    if (res.status >= 500) throw new NetError('ERR-NET-001', `Server error ${res.status}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new AppError(data.error?.code || 'ERR-GEN-000', data.error?.detail || `HTTP ${res.status}`, data.error?.data);
      if (err.code === 'ERR-AUTH-001') this.onAuthError?.(err);              // account removed / session ended
      throw err;
    }
    return data;
  }
  _call(bytes, method, url, body, raw, extra) { return withFaults(this, bytes, () => this._fetch(method, url, body, raw, extra)); }

  // ---- record upload (used by the Engine) ---------------------------------------------------------
  ping() { return this._call(0, 'GET', '/api/ping'); }
  begin(a) { return this._call(2000 + JSON.stringify(a.answers).length, 'POST', '/api/begin', a); }
  putMedia({ id, mediaId, size, blob }) { return this._call(size, 'PUT', `/api/media/${id}/${mediaId}`, blob, true, { 'x-photo-size': String(size) }); }
  commit(a) { return this._call(500, 'POST', '/api/commit', a); }

  // ---- shared records ---------------------------------------------------------------------------
  listShared() { return this._call(800, 'GET', '/api/shared'); }
  getShared(id) { return this._call(20000, 'GET', `/api/shared/${id}`); }
  createShared(a) { return this._call(20000, 'POST', '/api/shared', a); }
  pushOps(id, a) { return this._call(500 + JSON.stringify(a.ops).length, 'POST', `/api/shared/${id}/ops`, a); }
  pullOps(id, { since, deviceId, name, focus, pending = 0 }) {
    const q = new URLSearchParams({ since, d: deviceId, n: name || '', f: focus || '', p: pending });
    return this._call(1500, 'GET', `/api/shared/${id}/ops?${q}`);
  }
  assign(id, a) { return this._call(500, 'POST', `/api/shared/${id}/assign`, a); }
  team() { return this._call(800, 'GET', '/api/team'); }
  notifications() { return this._call(800, 'GET', '/api/notifications'); }
  readNotifications() { return this._call(300, 'POST', '/api/notifications/read', {}); }
  submitShared(id, a) { return this._call(500, 'POST', `/api/shared/${id}/submit`, a); }

  organizations() { return this._call(800, 'GET', '/api/identity/organizations'); }
  loginPassword(a) { return this._call(600, 'POST', '/api/auth/login', a); }
  loginMicrosoft(a) { return this._call(600, 'POST', '/api/auth/microsoft', a); }
  me() { return this._call(600, 'GET', '/api/identity/me'); }

  // ---- forms, issues, admin ---------------------------------------------------------------------
  listForms() { return this._call(1000, 'GET', '/api/forms'); }
  publishForm(survey) { return this._call(survey ? JSON.stringify(survey).length : 0, 'POST', '/api/forms', { survey }); }
  addIssue(issue) { return this._call(JSON.stringify(issue).length, 'POST', '/api/issues', issue); }

  async refreshStats() { try { this._stats = await this._fetch('GET', '/api/stats'); } catch { /* offline */ } return this.stats(); }
  async setMinSchema(n) { await this._fetch('POST', '/api/admin/min-schema', { n }); await this.refreshStats(); }
  async reset() { await this._fetch('POST', '/api/admin/reset', {}); }
}
