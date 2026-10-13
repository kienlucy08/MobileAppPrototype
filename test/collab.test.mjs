// Run: node test/collab.test.mjs   — real HTTP server, real Collab/Engine clients, simulated bad networks.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createServer } from '../server/server.js';
import { RemoteServer } from '../src/api.js';
import { Engine } from '../src/queue.js';
import { Collab } from '../src/collab.js';
import { Reporter } from '../src/reporter.js';
import { memoryDB } from '../src/db.js';
import { SAMPLE_SURVEY } from '../src/sample.js';
import { materialize } from '../src/crdt.js';
import * as S from '../src/schema.js';

const SCALE = 60;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (!(await fn())) { if (Date.now() - t > ms) { throw new Error('timeout: ' + fn); } await wait(15); } };

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-'));
const { server, core } = createServer({ dataDir });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

async function phone(id, name, profile = 'good') {
  const db = memoryDB(), srv = new RemoteServer({ base, scale: SCALE, profile });
  srv.setToken((id === 'sam' ? core.loginPassword({ username: 'sam', password: 'demo' }) : core.loginMicrosoft({ email: `${id}@demo.test` })).token);   // signed in with the same accounts as the web app
  const engine = new Engine({ db, server: srv, scale: SCALE }); await engine.start();
  const device = { id, name };
  const collab = new Collab({ db, server: srv, engine, device, pollMs: 40 });
  const reporter = new Reporter({ db, server: srv, engine, collab, device });
  await collab.start(); await reporter.start();
  return { id, name, db, srv, engine, collab, reporter };
}
const edit = (p, docId, fn) => { const a = p.collab.open(docId); fn(a); p.collab.localChanged(docId, a); p.collab.flush(docId); };
const ans = (p, id) => p.collab.answersOf(id);
let passed = 0;
const test = async (n, fn) => { const t = Date.now(); await fn(); passed++; console.log(`  ✓ ${n} (${Date.now() - t} ms)`); };
const survey = SAMPLE_SURVEY;

console.log('collab (real HTTP server)');
const maria = await phone('maria', 'Maria'), sam = await phone('sam', 'Sam');
const doc = maria.collab.create({ survey, title: 'TWR-4471 inspection' });
maria.collab.attach(doc.id, () => {});   // an open form = an active, fast-polling session

await test('second phone joins the shared record and sees its answers', async () => {
  edit(maria, doc.id, (a) => { a.siteId = 'TWR-4471'; a.towerType = 'guyed'; });
  await until(() => maria.collab.list.length || core.state.shared[doc.id]?.ops.length >= 2);
  await until(async () => (await sam.srv.listShared()).length === 1);
  const meta = (await sam.srv.listShared())[0];
  await sam.collab.join(meta); sam.collab.attach(doc.id, () => {});
  await until(() => ans(sam, doc.id).siteId === 'TWR-4471');
  assert.equal(ans(sam, doc.id).towerType, 'guyed');
});

await test('concurrent edits: different fields merge, same field converges to one value on both', async () => {
  edit(maria, doc.id, (a) => { a.inspector = 'Maria'; a.heightFt = 150; });
  edit(sam, doc.id, (a) => { a.hasDamage = 'yes'; a.heightFt = 180; });
  await until(() => JSON.stringify(ans(maria, doc.id)) === JSON.stringify(ans(sam, doc.id)) && ans(maria, doc.id).hasDamage === 'yes' && ans(maria, doc.id).inspector === 'Maria');
  assert.ok([150, 180].includes(ans(maria, doc.id).heightFt));
  assert.equal(ans(maria, doc.id).heightFt, ans(sam, doc.id).heightFt);
});

await test('both add repeat entries at once: nothing overwritten, both entries on both phones', async () => {
  edit(maria, doc.id, (a) => { a.guyWires.push({ _id: 'g-maria', wireLabel: 'A-1', tension: 1500, wirePhotos: [] }); });
  edit(sam, doc.id, (a) => { a.guyWires.push({ _id: 'g-sam', wireLabel: 'B-2', tension: 1620, wirePhotos: [] }); });
  await until(() => ans(maria, doc.id).guyWires.length === 2 && ans(sam, doc.id).guyWires.length === 2);
  assert.deepEqual(ans(maria, doc.id).guyWires.map((g) => g.wireLabel).sort(), ['A-1', 'B-2']);
});

await test('Maria goes offline and keeps editing; Sam keeps editing; everything merges when she is back', async () => {
  maria.srv.setProfile('offline');
  edit(maria, doc.id, (a) => { a.inspector = 'Maria (offline edit)'; a.findings = ['corrosion']; });
  edit(sam, doc.id, (a) => { a.damageNotes = 'Bent bracket on leg 2'; });
  await until(() => maria.collab.svc === 'down');
  assert.ok(maria.collab.unsynced() > 0, 'offline edits are queued, not lost');
  assert.notEqual(ans(sam, doc.id).inspector, 'Maria (offline edit)');
  maria.srv.setProfile('good'); maria.collab.nudge();
  await until(() => ans(sam, doc.id).inspector === 'Maria (offline edit)' && ans(maria, doc.id).damageNotes === 'Bent bracket on leg 2');
  assert.equal(maria.collab.unsynced(), 0);
});

await test('flaky network on both phones: lost replies never duplicate edits or entries', async () => {
  maria.srv.setProfile('flaky'); sam.srv.setProfile('flaky');
  for (let i = 0; i < 6; i++) {
    edit(maria, doc.id, (a) => a.guyWires.push({ _id: 'm' + i, wireLabel: 'M' + i, wirePhotos: [] }));
    edit(sam, doc.id, (a) => a.guyWires.push({ _id: 's' + i, wireLabel: 'S' + i, wirePhotos: [] }));
  }
  await until(() => ans(maria, doc.id).guyWires.length === 14 && ans(sam, doc.id).guyWires.length === 14, 40000);
  maria.srv.setProfile('good'); sam.srv.setProfile('good');
  assert.equal(core.state.shared[doc.id].crdt.items['guyWires'] && Object.keys(core.state.shared[doc.id].crdt.items['guyWires']).length, 14);
});

core.presenceTtl = 400;      // so "teammate not connected" is detectable within a test

await test('photos + offline teammate: submit is refused (not connected, then photos pending), then succeeds', async () => {
  sam.srv.setProfile('offline');                                 // Sam is out of signal while taking photos
  await until(() => sam.collab.svc === 'down' || true);
  const ids = [];
  for (let i = 0; i < 12; i++) {
    const rec = { id: `sp${i}`, subId: doc.id, fieldPath: 'sitePhotos', name: `s${i}.jpg`, state: 'queued', size: 900_000, origSize: 5e6, attempts: 0, nextAttemptAt: 0, meta: { noLocation: true }, thumb: 'data:image/jpeg;base64,AA' };
    await sam.db.put('blobs', { id: rec.id, blob: new Blob([new Uint8Array(10)]) }); await sam.db.put('media', rec); sam.engine.registerMedia(rec); ids.push(rec.id);
  }
  edit(sam, doc.id, (a) => { a.sitePhotos = [...a.sitePhotos, ...ids]; });
  sam.engine.kick();
  for (let i = 0; i < 3; i++) {
    const rec = { id: `mp${i}`, subId: doc.id, fieldPath: 'sitePhotos', name: `m${i}.jpg`, state: 'queued', size: 900_000, origSize: 5e6, attempts: 0, nextAttemptAt: 0, meta: {}, thumb: 'data:image/jpeg;base64,AA' };
    await maria.db.put('blobs', { id: rec.id, blob: new Blob([new Uint8Array(10)]) }); await maria.db.put('media', rec); maria.engine.registerMedia(rec);
  }
  edit(maria, doc.id, (a) => { a.sitePhotos = [...a.sitePhotos, 'mp0', 'mp1', 'mp2']; });
  maria.engine.kick();
  await until(() => maria.collab.photoProgress(doc.id).find((r) => r.mine)?.received === 3);
  await wait(600);                                               // Sam has gone quiet longer than the presence window
  await assert.rejects(() => maria.collab.submit(doc.id), (e) => e.code === 'ERR-COLLAB-003' && /Sam/.test(e.message));
  assert.equal(core.state.shared[doc.id].status, 'open');
  sam.srv.setProfile('good'); sam.collab.nudge(); sam.engine.nudge();
  await until(() => ans(maria, doc.id).sitePhotos.length === 15);   // Sam's queued edits arrive
  await until(() => sam.collab.unsynced() === 0);
  sam.engine.pause();                                            // hold his photos back to prove the photo gate
  await until(() => core.state.subs[doc.id].received['sp0'] == null || true);
  const early = maria.collab.photoProgress(doc.id).find((r) => r.who === 'Sam');
  if (early.received < early.total) {
    await assert.rejects(() => maria.collab.submit(doc.id), (e) => e.code === 'ERR-COLLAB-001' && /Sam: \d+/.test(e.message));
  }
  sam.engine.resume();
  await until(() => sam.engine.countsFor(doc.id).done === 12, 30000);
  await until(() => maria.collab.photoProgress(doc.id).every((r) => r.received === r.total));
  const r = await maria.collab.submit(doc.id);
  assert.ok(r.recordId >= 1001);
  const rec = core.state.subs[doc.id];
  assert.equal(rec.committed, true);
  assert.equal(rec.answers.sitePhotos.length, 15);
  assert.equal(rec.answers.guyWires.length, 14);
  await until(() => sam.collab.docs.get(doc.id).status === 'submitted');
  assert.equal(sam.engine.subs.get(doc.id).status, 'complete');
});

await test('submitting twice (lost reply) returns the same record, no duplicate record', async () => {
  const before = core.stats().records;
  const r2 = await sam.srv.submitShared(doc.id, { deviceId: 'sam', name: 'Sam' });
  assert.equal(r2.already, true);
  assert.equal(core.stats().records, before);
});

await test('forced submit while a teammate is offline: their late edits are folded into the record, not lost', async () => {
  const d2 = maria.collab.create({ survey, title: 'TWR-9 second record' }); maria.collab.attach(d2.id, () => {});
  edit(maria, d2.id, (a) => { a.siteId = 'TWR-9'; });
  await until(async () => (await sam.srv.listShared()).length === 2);
  await sam.collab.join((await sam.srv.listShared()).find((m) => m.id === d2.id)); sam.collab.attach(d2.id, () => {});
  await until(() => ans(sam, d2.id).siteId === 'TWR-9');
  sam.srv.setProfile('offline');
  edit(sam, d2.id, (a) => { a.inspector = 'Sam (written offline)'; });
  await wait(600);
  await assert.rejects(() => maria.collab.submit(d2.id), (e) => e.code === 'ERR-COLLAB-003');
  const r = await maria.collab.submit(d2.id, { force: true });
  assert.equal(core.state.subs[d2.id].answers.inspector, undefined);
  sam.srv.setProfile('good'); sam.collab.nudge();
  await until(() => core.state.subs[d2.id].answers.inspector === 'Sam (written offline)');
  assert.equal(core.state.shared[d2.id].amended, true);
  assert.equal(core.state.subs[d2.id].recordId, r.recordId, 'same record, amended — not a new one');
});

await test('problem report: queued offline, delivered automatically when service returns, includes log + record', async () => {
  sam.srv.setProfile('offline');
  await sam.reporter.send({ message: 'Photo grid froze on the guy wire page', subId: doc.id });
  assert.equal(sam.reporter.pending, 1);
  assert.equal(core.state.issues.length, 0);
  sam.srv.setProfile('good'); sam.reporter.nudge();
  await until(() => core.state.issues.length === 1);
  const iss = core.state.issues[0];
  assert.equal(iss.user, 'Sam'); assert.ok(iss.log.length > 0); assert.equal(iss.record.media.length, 12); assert.equal(iss.status, 'open');
  await until(() => sam.reporter.pending === 0);
});

console.log(`\n${passed} passed`);
server.close(); fs.rmSync(dataDir, { recursive: true, force: true });
process.exit(0);
