// In-process stand-in used by the engine tests: ServerCore + fault injection (see PROFILES).
// The real app talks to server/server.js through src/api.js, which applies the same faults over real HTTP.
//  - requests can drop before the server sees them (ERR-NET-001)
//  - the server can apply a request and then lose the reply (ERR-NET-003)  <- the classic duplicate maker
//  - service can vanish mid-transfer (ERR-NET-002)

import { NetError } from './errors.js';
import { ServerCore, freshState } from './serverCore.js';
import { sleep } from './util.js';

export const PROFILES = {
  good:    { label: 'Good (LTE)',               latency: [60, 140],  mbps: 25, fail: 0,    ackLoss: 0,    offline: false },
  poor:    { label: 'Poor (3G)',                latency: [300, 900], mbps: 2,  fail: 0.08, ackLoss: 0.03, offline: false },
  flaky:   { label: 'Flaky (edge of coverage)', latency: [150, 600], mbps: 6,  fail: 0.28, ackLoss: 0.12, offline: false },
  offline: { label: 'No service',               latency: [0, 0],     mbps: 1,  fail: 1,    ackLoss: 0,    offline: true },
};

const KEY = 'fc.mockserver.v2';
const rand = ([a, b]) => a + Math.random() * (b - a);

/** Wraps any async "do the real thing" function with the network profile's faults. */
export async function withFaults(srv, bytes, run) {
  const p = srv.profile;
  const wait = (ms) => sleep(ms / srv.scale);
  const gone = () => { if (srv.profile.offline) throw new NetError('ERR-NET-002', 'No service'); };
  gone();
  const total = rand(p.latency) + (bytes * 8) / (p.mbps * 1e6) * 1000;
  if (Math.random() < p.fail) {           // dropped before the server did anything
    await wait(total * Math.random());
    throw new NetError('ERR-NET-001', 'Connection dropped mid-request');
  }
  await wait(total * 0.9);
  gone();                                  // service vanished mid-transfer
  const res = await run();                 // ---- server has now durably applied the request ----
  if (Math.random() < p.ackLoss) {         // ...but the reply never makes it back
    await wait(total * 0.1);
    srv.acksLost++;
    throw new NetError('ERR-NET-003', 'Response lost after the server received the upload');
  }
  await wait(total * 0.1);
  gone();
  return res;
}

export class MockServer {
  constructor({ scale = 1, storage = globalThis.localStorage, profile = 'good' } = {}) {
    this.scale = scale; this.storage = storage; this.profileName = profile; this.acksLost = 0;
    let state; try { state = JSON.parse(storage?.getItem(KEY)); } catch { /* fresh */ }
    this.core = new ServerCore(state || freshState());
    this.core.onChange = () => { try { storage?.setItem(KEY, JSON.stringify(this.core.state)); } catch { /* mock only */ } };
  }
  get state() { return this.core.state; }
  get profile() { return PROFILES[this.profileName]; }
  setProfile(name) { this.profileName = name; }
  setMinSchema(n) { this.core.setMinSchema(n); }
  reset() { this.core.state = freshState(); this.core.onChange(); }
  stats() { return { ...this.core.stats(), acksLost: this.acksLost }; }

  ping() { return withFaults(this, 0, () => true); }
  begin(a) { return withFaults(this, 2000 + JSON.stringify(a.answers).length, () => this.core.begin(a)); }
  putMedia(a) { return withFaults(this, a.size, () => this.core.putMedia(a)); }
  commit(a) { return withFaults(this, 500, () => this.core.commit(a)); }
  siteData(site) { return withFaults(this, 1500, () => this.core.siteData(site)); }
  organizations(email) { return withFaults(this, 800, () => this.core.orgsFor(email)); }
}
