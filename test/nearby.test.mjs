// Run: node test/nearby.test.mjs — two phones, NO network at all, collaborate through the (simulated) nearby radio.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createServer } from '../server/server.js';
import { RemoteServer } from '../src/api.js';
import { Engine } from '../src/queue.js';
import { Collab } from '../src/collab.js';
import { Nearby } from '../src/nearby.js';
import { memoryDB } from '../src/db.js';
import { SAMPLE_SURVEY } from '../src/sample.js';

// an in-process stand-in for BroadcastChannel: every channel with the same name hears every other one
const bus = new Map();
class FakeChannel { constructor(n) { this.n = n; (bus.get(n) || bus.set(n, new Set()).get(n)).add(this); } postMessage(d) { for (const c of bus.get(this.n)) if (c !== this) queueMicrotask(() => c.onmessage?.({ data: structuredClone(d) })); } close() { bus.get(this.n).delete(this); } }

const SCALE = 60, wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => { const t = Date.now(); while (!(await fn())) { if (Date.now() - t > ms) throw new Error('timeout ' + fn); await wait(10); } };
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-nb-'));
const { server, core } = createServer({ dataDir });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

async function phone(id, name, login) {
  const db = memoryDB(), srv = new RemoteServer({ base, scale: SCALE, profile: 'offline' });   // NO connectivity to the server
  srv.setToken(login.token);
  const engine = new Engine({ db, server: srv, scale: SCALE }); await engine.start();
  const device = { id, name };
  const collab = new Collab({ db, server: srv, engine, device, pollMs: 40 }); await collab.start();
  const nearby = new Nearby({ collab, engine, db, device, Channel: FakeChannel, helloMs: 60 });
  return { id, db, srv, engine, collab, nearby };
}
const maria = await phone('maria', 'Maria', core.loginMicrosoft({ email: 'maria@demo.test' }));
const sam = await phone('sam', 'Sam', core.loginPassword({ username: 'sam', password: 'demo' }));
const edit = (p, id, fn) => { const a = p.collab.open(id); fn(a); p.collab.localChanged(id, a); p.collab.flush(id); };
const ans = (p, id) => p.collab.answersOf(id);
let passed = 0; const test = async (n, fn) => { const t = Date.now(); await fn(); passed++; console.log(`  ✓ ${n} (${Date.now() - t} ms)`); };
console.log('nearby (server unreachable throughout the first 4 tests)');

const doc = maria.collab.create({ survey: SAMPLE_SURVEY, title: 'Cell site, no coverage' });
edit(maria, doc.id, (a) => { a.siteId = 'REMOTE-9'; a.towerType = 'guyed'; });
maria.nearby.enable(); sam.nearby.enable();

await test('Sam sees Maria\'s record nearby (title only) and joins it — no server involved', async () => {
  await until(() => sam.nearby.available().length === 1);
  assert.equal(sam.nearby.available()[0].doc.title, 'Cell site, no coverage');
  assert.equal(core.state.shared[doc.id], undefined, 'the server has never heard of this record');
  sam.nearby.join('maria', doc.id);
  await until(() => sam.collab.docs.has(doc.id) && ans(sam, doc.id).siteId === 'REMOTE-9');
  assert.equal(ans(sam, doc.id).towerType, 'guyed');
});

await test('both edit; changes flow both ways and converge, with no server', async () => {
  maria.collab.attach(doc.id, () => {}); sam.collab.attach(doc.id, () => {});
  edit(maria, doc.id, (a) => { a.inspector = 'Maria'; a.guyWires.push({ _id: 'gm', wireLabel: 'A-1', wirePhotos: [] }); });
  edit(sam, doc.id, (a) => { a.hasDamage = 'yes'; a.damageNotes = 'Bent bracket'; a.guyWires.push({ _id: 'gs', wireLabel: 'B-2', wirePhotos: [] }); });
  await until(() => JSON.stringify(ans(maria, doc.id)) === JSON.stringify(ans(sam, doc.id)) && ans(maria, doc.id).damageNotes === 'Bent bracket' && ans(sam, doc.id).guyWires.length === 2);
  assert.deepEqual(ans(maria, doc.id).guyWires.map((g) => g.wireLabel).sort(), ['A-1', 'B-2']);
});

await test('walking out of range and back: edits made apart merge when they meet again', async () => {
  sam.nearby.disable();
  edit(sam, doc.id, (a) => { a.heightFt = 180; });
  edit(maria, doc.id, (a) => { a.inspector = 'Maria (apart)'; });
  assert.equal(ans(maria, doc.id).heightFt, undefined);
  sam.nearby.enable();
  await until(() => ans(maria, doc.id).heightFt === 180 && ans(sam, doc.id).inspector === 'Maria (apart)');
});

await test('photo relay: Maria hands her photos to Sam, who uploads them when HE gets signal (server never asked twice)', async () => {
  const recs = [];
  for (let i = 0; i < 5; i++) {
    const rec = { id: `mp${i}`, subId: doc.id, fieldPath: 'sitePhotos', name: `m${i}.jpg`, state: 'queued', size: 900_000, origSize: 4e6, attempts: 0, nextAttemptAt: 0, meta: {}, thumb: 'data:image/jpeg;base64,AA' };
    await maria.db.put('blobs', { id: rec.id, blob: new Blob([new Uint8Array(10)]) }); await maria.db.put('media', rec); maria.engine.registerMedia(rec); recs.push(rec.id);
  }
  edit(maria, doc.id, (a) => { a.sitePhotos = [...a.sitePhotos, ...recs]; });
  await until(() => ans(sam, doc.id).sitePhotos.length === 5);
  assert.equal(sam.engine.mediaFor(doc.id).length, 0, 'Sam sees the photo thumbnails but does not hold the photos yet');
  const n = await maria.nearby.sharePhotos(doc.id); assert.equal(n, 5);
  await until(() => sam.engine.mediaFor(doc.id).length === 5);
  assert.ok(sam.engine.mediaFor(doc.id).every((m) => m.relayed && m.state === 'queued'));
  // Sam walks into signal; Maria never does
  sam.srv.setProfile('good'); sam.collab.nudge(); sam.engine.nudge(); sam.engine.kick();
  await until(() => core.state.shared[doc.id] && Object.keys(core.state.subs[doc.id].received).length === 5, 20000);
  assert.deepEqual(Object.keys(core.state.subs[doc.id].received).sort(), ['mp0', 'mp1', 'mp2', 'mp3', 'mp4']);
});

await test('Sam also relays everything Maria did offline: the server ends up with the full record, from Sam alone', async () => {
  await until(() => { const sh = core.state.shared[doc.id]; return sh && sh.crdt.fields.inspector?.v === 'Maria (apart)' && Object.keys(sh.crdt.items.guyWires || {}).length === 2 && Object.keys(sh.crdt.photos.sitePhotos || {}).length === 5; }, 20000);
  assert.equal(core.state.shared[doc.id].crdt.fields.damageNotes.v, 'Bent bracket');
  assert.equal(maria.srv.profileName, 'offline', 'Maria still has no connection');
});

await test('Maria\'s own phone catches up when she later gets signal: duplicates are ignored, one record', async () => {
  maria.srv.setProfile('good'); maria.collab.nudge(); maria.engine.nudge(); maria.engine.kick();
  await until(() => maria.collab.unsynced() === 0, 20000);
  const r = await maria.collab.submit(doc.id, { force: true });          // only a crew lead can submit
  assert.ok(r.recordId >= 1001);
  assert.equal(core.state.subs[doc.id].answers.guyWires.length, 2);
  assert.equal(Object.keys(core.state.subs[doc.id].received).length, 5, 'each photo stored once');
});

console.log(`\n${passed} passed`);
maria.nearby.disable(); sam.nearby.disable(); server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); process.exit(0);
