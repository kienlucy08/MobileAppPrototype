// Survey123 pulldata("@javascript", ...) lookups: weather, member lookup.
// They must never block the form or fail the survey when there is no signal: a lookup that can't run yet
// returns "" immediately, is retried in the background, and fills in (and syncs) when service is back.

import { CTX } from './expr.js';
import { withFaults } from './mockServer.js';
import { NetError } from './errors.js';

const WMO = (c) => (c === 0 ? 'Clear' : c <= 3 ? 'Clouds' : c <= 48 ? 'Fog' : c <= 57 ? 'Drizzle' : c <= 67 ? 'Rain' : c <= 77 ? 'Snow' : c <= 82 ? 'Rain' : c <= 86 ? 'Snow' : 'Thunderstorm');

/** Returns an OpenWeather-shaped JSON string: { name, weather:[{main}], main:{temp}, wind:{speed,deg} }. */
async function weather([lat, lon, key]) {
  if (key) {   // OpenWeather, if the form supplies a key (units: imperial, to match the "Temperature (°F)" question)
    const r = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=imperial&appid=${encodeURIComponent(key)}`);
    if (!r.ok) throw new NetError('ERR-NET-001', `Weather service ${r.status}`);
    return JSON.stringify(await r.json());
  }
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph`);
  if (!r.ok) throw new NetError('ERR-NET-001', `Weather service ${r.status}`);
  const c = (await r.json()).current;
  return JSON.stringify({ name: '', weather: [{ main: WMO(c.weather_code) }], main: { temp: c.temperature_2m }, wind: { speed: c.wind_speed_10m, deg: c.wind_direction_10m } });
}

// Member lookup: the signed-in FieldSync profile already holds first/last name, so no extra service call is needed.
const member = async ([, username], lk) => {
  const p = lk.profile || {};
  return JSON.stringify({ firstName: p.firstName ?? '', lastName: p.lastName ?? '', username: p.username ?? username, email: p.email ?? '' });
};

const HANDLERS = {
  'weather.js:runWeatherCalcs': { ready: ([lat, lon]) => Number.isFinite(Number(lat)) && lat !== '' && Number.isFinite(Number(lon)) && lon !== '', run: weather, network: true },
  'validateusers.js:validateUsername': { ready: ([, u]) => !!u, run: member, network: false },
};

export class Lookups {
  constructor({ server, storageKey, retryMs = 4000 }) {
    this.server = server; this.storageKey = storageKey; this.retryMs = retryMs;
    this.listeners = new Set(); this.pending = new Map(); this.attempts = 0;
    try { this.cache = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch { this.cache = {}; }
  }
  install(props, profile) {
    this.profile = profile || null;
    CTX.props = { portalurl: '', token: '', email: '', ...props };
    CTX.lookup = (file, fn, args) => this.get(file, fn, args);
  }
  onResolve(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  pendingCount() { return this.pending.size; }
  nudge() { for (const p of this.pending.values()) { clearTimeout(p.timer); this._run(p.key, p.h, p.args); } }

  get(file, fn, args) {
    const key = `${file}:${fn}:${JSON.stringify(args)}`;
    if (key in this.cache) return this.cache[key];
    const h = HANDLERS[`${file}:${fn}`];
    if (!h || !h.ready(args) || this.pending.has(key)) return undefined;
    this.pending.set(key, { key, h, args, timer: null });
    this._run(key, h, args);
    return undefined;
  }

  async _run(key, h, args) {
    const p = this.pending.get(key); if (!p) return;
    try {
      const value = await (h.network ? withFaults(this.server, 1500, () => h.run(args, this)) : h.run(args, this));
      this.cache[key] = value; this.pending.delete(key);
      try { localStorage.setItem(this.storageKey, JSON.stringify(this.cache)); } catch { /* ignore */ }
      this.listeners.forEach((cb) => cb());
    } catch {
      this.attempts++;
      p.timer = setTimeout(() => this._run(key, h, args), this.retryMs / (this.server.scale || 1));   // offline: keep trying quietly
    }
  }
}

/** Organizations the signed-in user belongs to (from the identity service). Cached on the phone, so the list
 *  is still there with no signal; refreshed whenever service is available. A user in no org sees an empty list. */
export class Orgs {
  constructor({ server, storageKey, getEmail, retryMs = 5000 }) {
    this.server = server; this.storageKey = storageKey; this.getEmail = getEmail; this.retryMs = retryMs;
    this.listeners = new Set(); this.state = 'idle'; this.timer = null;     // idle | loading | ok | offline | error
    try { this.cache = JSON.parse(localStorage.getItem(storageKey)) || null; } catch { this.cache = null; }
  }
  get() { return this.cache?.email === this.getEmail() ? this.cache.list : []; }
  loaded() { return this.cache?.email === this.getEmail(); }
  onChange(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  nudge() { clearTimeout(this.timer); this.refresh(); }
  async refresh() {
    const email = this.getEmail();
    if (!email) { this.state = 'error'; this._emit(); return; }
    this.state = 'loading'; this._emit();
    try {
      const list = (await this.server.organizations(email)).map((o) => ({ value: String(o.id), label: o.name }));
      this.cache = { email, list };
      try { localStorage.setItem(this.storageKey, JSON.stringify(this.cache)); } catch { /* ignore */ }
      this.state = 'ok';
    } catch (e) {
      this.state = e instanceof NetError ? 'offline' : 'error';
      if (e instanceof NetError) this.timer = setTimeout(() => this.refresh(), this.retryMs / (this.server.scale || 1));
    }
    this._emit();
  }
  _emit() { this.listeners.forEach((cb) => cb()); }
}
