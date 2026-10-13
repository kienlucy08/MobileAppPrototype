// Signed-in user = the same FieldSync account as the web app (Microsoft login or username + password).
// The session never expires on its own; it is dropped only when the app is updated (APP_VERSION changes).
// One profile supplies username, email, name and organizations — no separate member / organization lookups.

import { AppError, NetError } from './errors.js';

export class Auth extends EventTarget {
  constructor({ server, storageKey, appVersion }) {
    super(); Object.assign(this, { server, storageKey, appVersion });
    try { this.session = JSON.parse(localStorage.getItem(storageKey)); } catch { this.session = null; }
    this.revoked = false;
    server.onAuthError = () => { if (!this.revoked) { this.revoked = true; this.dispatchEvent(new Event('revoked')); } };
  }
  /** Signed in on this app version? (An app update asks for credentials again.) */
  get signedIn() { return !!this.session?.token && this.session.appVersion === this.appVersion; }
  get profile() { return this.signedIn ? this.session.profile : null; }
  restore() { if (this.signedIn) this.server.setToken(this.session.token); }
  _set(r) {
    this.session = { token: r.token, profile: r.profile, appVersion: this.appVersion };
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.session)); } catch { /* ignore */ }
    this.server.setToken(r.token); this.revoked = false;
    return r.profile;
  }
  async passwordLogin(username, password) { return this._set(await this.server.loginPassword({ username, password, appVersion: this.appVersion })); }
  async microsoftLogin(email) { return this._set(await this.server.loginMicrosoft({ email, appVersion: this.appVersion })); }
  /** Pick up membership changes (new/removed organizations) whenever we are online. A removed account surfaces as 'revoked'. */
  async refreshProfile() {
    if (!this.signedIn) return;
    try { this.session.profile = await this.server.me(); try { localStorage.setItem(this.storageKey, JSON.stringify(this.session)); } catch { /* ignore */ } this.dispatchEvent(new Event('profile')); }
    catch (e) { if (!(e instanceof NetError) && !(e instanceof AppError && e.code === 'ERR-AUTH-001')) throw e; }
  }
  signOut() { this.session = null; this.server.setToken(null); try { localStorage.removeItem(this.storageKey); } catch { /* ignore */ } }
}
