// Run: node test/engine.test.mjs
import assert from 'node:assert/strict';
import { memoryDB } from '../src/db.js';
import { Engine } from '../src/queue.js';
import { MockServer } from '../src/mockServer.js';
import { checkSurvey, newAnswers, validate, prune, recalc } from '../src/schema.js';
import { SAMPLE_SURVEY } from '../src/sample.js';

const SCALE = 60; // run simulated time 60x faster
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout waiting for condition'); await wait(10); } };

async function setup(n, profile) {
  const db = memoryDB();
  const server = new MockServer({ scale: SCALE, storage: mem(), profile });
  const engine = new Engine({ db, server, scale: SCALE });
  await engine.start();
  const sub = { id: 'sub-' + Math.random(), status: 'draft', schemaVersion: 1, answers: { siteId: 'T1' }, createdAt: 1 };
  engine.registerSub(sub); await db.put('submissions', sub);
  for (let i = 0; i < n; i++) {
    const rec = { id: `m${i}`, subId: sub.id, fieldPath: 'sitePhotos', name: `p${i}.jpg`, state: 'local', size: 900_000, origSize: 6_000_000, attempts: 0, nextAttemptAt: 0, meta: {} };
    await db.put('blobs', { id: rec.id, blob: new Blob([new Uint8Array(10)]) });
    await db.put('media', rec); engine.registerMedia(rec);
  }
  return { db, server, engine, sub };
}
const done = (e, s) => e.countsFor(s.id).done;
let passed = 0;
const test = async (name, fn) => { const t = Date.now(); await fn(); passed++; console.log(`  ✓ ${name} (${Date.now() - t} ms)`); };

console.log('engine');

await test('good network: 400 photos delivered once, one record', async () => {
  const { server, engine, sub } = await setup(400, 'good');
  await engine.submit(sub, new Set(engine.mediaFor(sub.id).map((m) => m.id)));
  await until(() => sub.status === 'complete');
  assert.equal(server.stats().receivedItems, 400);
  assert.equal(server.stats().records, 1);
  assert.equal(server.stats().dupesPrevented, 0);
});

await test('flaky network (28% drop, 12% lost acks): still exactly 200 items, 1 record, no failure', async () => {
  const { server, engine, sub } = await setup(200, 'flaky');
  await engine.submit(sub, new Set(engine.mediaFor(sub.id).map((m) => m.id)));
  await until(() => sub.status === 'complete', 60000);
  const st = server.stats();
  assert.equal(st.receivedItems, 200);
  assert.equal(st.records, 1);
  assert.ok(engine.retries > 20, `expected retries, got ${engine.retries}`);
  assert.ok(st.acksLost > 0 && st.dupesPrevented > 0, 'lost acks should have been de-duplicated');
  console.log(`      retries=${engine.retries} acksLost=${st.acksLost} dupesPrevented=${st.dupesPrevented}`);
});

await test('service drops mid-batch: pauses in place, resumes, no re-upload of finished items', async () => {
  const { server, engine, sub } = await setup(150, 'poor');
  await engine.submit(sub, new Set(engine.mediaFor(sub.id).map((m) => m.id)));
  await until(() => done(engine, sub) >= 40);
  server.setProfile('offline');
  await until(() => engine.svc === 'down');
  const atDrop = done(engine, sub);
  await wait(300);
  assert.ok(done(engine, sub) - atDrop <= 3, 'in-flight items may land, nothing new may start');
  assert.equal(sub.status, 'uploading');
  const receivedAtDrop = server.stats().receivedItems;
  server.setProfile('good'); engine.nudge();
  await until(() => sub.status === 'complete');
  assert.equal(server.stats().receivedItems, 150);
  assert.ok(receivedAtDrop >= atDrop && receivedAtDrop < 150);
  assert.equal(server.stats().records, 1);
});

await test('app killed mid-upload: new engine on same DB resumes and finishes without duplicates', async () => {
  const a = await setup(120, 'poor');
  await a.engine.submit(a.sub, new Set(a.engine.mediaFor(a.sub.id).map((m) => m.id)));
  await until(() => done(a.engine, a.sub) >= 30);
  a.engine.userPaused = true;                                  // the old process "dies"
  await wait(150);
  const before = a.server.stats().receivedItems;
  const engine2 = new Engine({ db: a.db, server: a.server, scale: SCALE });
  await engine2.start();
  const sub2 = engine2.subs.get(a.sub.id);
  await until(() => sub2.status === 'complete');
  assert.equal(a.server.stats().receivedItems, 120);
  assert.equal(a.server.stats().records, 1);
  assert.ok(before < 120);
});

await test('server missing items at commit: they are re-queued, not dropped', async () => {
  const { server, engine, sub } = await setup(20, 'good');
  const real = server.commit.bind(server); let lied = false;
  server.commit = async (a) => { if (!lied) { lied = true; delete server.state.subs[a.id].received['m3']; } return real(a); };
  await engine.submit(sub, new Set(engine.mediaFor(sub.id).map((m) => m.id)));
  await until(() => sub.status === 'complete');
  assert.equal(server.stats().receivedItems, 20);
});

await test('schema drift: record rejected with ERR-SYNC-001 (specific, coded), not "unknown error"', async () => {
  const { server, engine, sub } = await setup(5, 'good');
  server.setMinSchema(2);
  await engine.submit(sub, new Set(engine.mediaFor(sub.id).map((m) => m.id)));
  await until(() => sub.status === 'failed');
  assert.equal(sub.error.code, 'ERR-SYNC-001');
});

await test('oversized photo: permanent ERR-IMG-001 on that item; sibling photos still delivered', async () => {
  const { server, engine, sub } = await setup(10, 'good');
  engine.media.get('m2').size = 31 * 1024 * 1024;
  await engine.submit(sub, new Set(engine.mediaFor(sub.id).map((m) => m.id)));
  await until(() => sub.status === 'failed');
  assert.equal(sub.error.code, 'ERR-IMG-001');
  assert.equal(server.stats().receivedItems, 9);
  engine.media.get('m2').size = 900_000;                        // "compress & resend"
  await engine.retry(sub.id);
  await until(() => sub.status === 'complete');
  assert.equal(server.stats().receivedItems, 10);
});

await test('failed photo: "go to the problem" reopens the record, the bad photo is removed, resending completes with the rest', async () => {
  const { server, engine, sub } = await setup(10, 'good');
  engine.media.get('m2').size = 31 * 1024 * 1024;
  await engine.submit(sub, new Set(engine.mediaFor(sub.id).map((m) => m.id)));
  await until(() => sub.status === 'failed');
  await engine.reopen(sub.id);
  assert.equal(sub.status, 'draft'); assert.equal(engine.media.get('m2').lastError, 'ERR-IMG-001');
  await engine.removeMedia('m2');
  await engine.submit(sub, new Set(engine.mediaFor(sub.id).map((m) => m.id)));
  await until(() => sub.status === 'complete');
  assert.equal(server.stats().receivedItems, 9); assert.equal(server.stats().records, 1);
});

console.log('schema');

await test('sample survey JSON is valid; bad JSON produces located problems', async () => {
  assert.deepEqual(checkSurvey(SAMPLE_SURVEY), []);
  const bad = structuredClone(SAMPLE_SURVEY);
  bad.pages[0].fields[0].type = 'texty';
  bad.pages[0].fields[5].constraint = '${.} >= (';
  const p = checkSurvey(bad);
  assert.equal(p.length, 2);
  assert.match(p[0].path, /pages\[0\]\.fields\[0\]\.type/);
});

await test('validation: required, live photo-count, relevance, constraint, 255-char calculate', async () => {
  const a = newAnswers(SAMPLE_SURVEY);
  let codes = validate(SAMPLE_SURVEY, a).map((i) => i.code);
  assert.ok(codes.includes('ERR-FIELD-001') && codes.includes('ERR-IMG-003'));
  a.siteId = 'X'; a.towerType = 'guyed'; a.hasDamage = 'no'; a.sitePhotos = ['a', 'b', 'c'];
  recalc(SAMPLE_SURVEY, a);
  assert.deepEqual(validate(SAMPLE_SURVEY, a), []);
  a.hasDamage = 'yes';                                          // damageNotes becomes relevant + required
  assert.equal(validate(SAMPLE_SURVEY, a)[0].code, 'ERR-FIELD-001');
  a.hasDamage = 'no'; a.damageNotes = 'stale'; a.heightFt = 5000;
  assert.equal(validate(SAMPLE_SURVEY, a)[0].code, 'ERR-FIELD-002');
  a.heightFt = 100;
  assert.equal(prune(SAMPLE_SURVEY, a).answers.damageNotes, undefined, 'irrelevant answers are dropped');
  const long = structuredClone(SAMPLE_SURVEY);
  long.pages[3].fields[1].calculation = "concat(${siteId}, '" + 'x'.repeat(300) + "')";
  recalc(long, a);
  assert.equal(validate(long, a).find((i) => i.code === 'ERR-FIELD-003')?.code, 'ERR-FIELD-003');
});

console.log(`\n${passed} passed`);
process.exit(0);
