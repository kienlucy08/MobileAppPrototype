// Run: node test/team.test.mjs — Phase 2: roles, assignment/reassignment, attribution, "notify my foreman". Real HTTP server.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createServer } from '../server/server.js';
import { RemoteServer } from '../src/api.js';
import { Engine } from '../src/queue.js';
import { Collab } from '../src/collab.js';
import { Reporter } from '../src/reporter.js';
import { memoryDB } from '../src/db.js';
import { SAMPLE_SURVEY } from '../src/sample.js';
import { has, FEATURE_PHASE } from '../src/phases.js';
import { attribution, newState, applyOp } from '../src/crdt.js';

const SCALE = 60, wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => { const t = Date.now(); while (!(await fn())) { if (Date.now() - t > ms) throw new Error('timeout: ' + fn); await wait(15); } };
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-team-'));
const { server, core } = createServer({ dataDir });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const login = { maria: () => core.loginMicrosoft({ email: 'maria@demo.test' }), sam: () => core.loginPassword({ username: 'sam', password: 'demo' }), priya: () => core.loginMicrosoft({ email: 'priya@demo.test' }) };

async function phone(id, name) {
  const db = memoryDB(), srv = new RemoteServer({ base, scale: SCALE, profile: 'good' }); srv.setToken(login[id]().token);
  const engine = new Engine({ db, server: srv, scale: SCALE }); await engine.start();
  const device = { id, name, email: `${id}@demo.test` };
  const collab = new Collab({ db, server: srv, engine, device, pollMs: 40 });
  const reporter = new Reporter({ db, server: srv, engine, collab, device }); await collab.start(); await reporter.start();
  return { id, name, srv, engine, collab, reporter };
}
const edit = (p, docId, fn) => { const a = p.collab.open(docId); fn(a); p.collab.localChanged(docId, a); p.collab.flush(docId); };
let passed = 0;
const test = async (n, fn) => { const t = Date.now(); await fn(); passed++; console.log(`  ✓ ${n} (${Date.now() - t} ms)`); };

console.log('team (Phase 2)');
const maria = await phone('maria', 'Maria Lopez'), sam = await phone('sam', 'Sam Okafor'), priya = await phone('priya', 'Priya Nair');
const doc = maria.collab.create({ survey: SAMPLE_SURVEY, title: 'TWR-1 closeout' }); maria.collab.attach(doc.id, () => {});
edit(maria, doc.id, (a) => { a.siteId = 'TWR-1'; });
await until(() => doc.created);

await test('a record is only on the lists of the people it is shared with; a PM sees every site', async () => {
  assert.equal((await sam.srv.listShared()).length, 0, 'Sam is not on it yet');
  assert.equal((await priya.srv.listShared()).length, 1, 'PM sees all sites');
  assert.deepEqual((await sam.srv.team()).map((t) => t.email).sort(), ['dana@demo.test', 'maria@demo.test']);
});

await test('crew lead shares it; Sam joins; a crew member cannot share or reassign (ERR-AUTH-004)', async () => {
  await maria.collab.assign(doc.id, { add: ['sam@demo.test'] });
  await until(async () => (await sam.srv.listShared()).length === 1);
  await sam.collab.join((await sam.srv.listShared())[0]); sam.collab.attach(doc.id, () => {});
  await assert.rejects(() => sam.srv.assign(doc.id, { add: ['dana@demo.test'] }), (e) => e.code === 'ERR-AUTH-004');
});

await test('attribution: every answer and photo is credited to the person who made it', async () => {
  edit(maria, doc.id, (a) => { a.towerType = 'guyed'; a.hasDamage = 'no'; });
  edit(sam, doc.id, (a) => { a.inspector = 'Sam'; a.heightFt = 120; a.guyWires.push({ _id: 'g1', wireLabel: 'A-1', wirePhotos: [] }); });
  await until(() => core.state.shared[doc.id].crdt.fields.heightFt?.v === 120 && core.state.shared[doc.id].crdt.fields.hasDamage?.v === 'no');
  const rows = attribution(SAMPLE_SURVEY, core.state.shared[doc.id].crdt), by = Object.fromEntries(rows.map((r) => [r.who, r]));
  assert.ok(by['Sam Okafor'].answers >= 3 && by['Maria Lopez'].answers >= 2, JSON.stringify(rows));
  assert.equal(by['Sam Okafor'].entries, 1);
  assert.ok(core.overview().records.find((r) => r.id === doc.id).contributors.length >= 2, 'dev-team view shows contributors');
});

await test('a crew member cannot submit the final record; the lead can', async () => {
  await assert.rejects(() => sam.collab.submit(doc.id, { force: true }), (e) => e.code === 'ERR-AUTH-004');
  const r = await maria.collab.submit(doc.id, { force: true });
  assert.ok(r.recordId >= 1001);
});

await test('reassign: the previous person drops the survey once their phone syncs; their entries stay credited to them', async () => {
  const d2 = maria.collab.create({ survey: SAMPLE_SURVEY, title: 'TWR-2' }); maria.collab.attach(d2.id, () => {});
  edit(maria, d2.id, (a) => { a.siteId = 'TWR-2'; }); await until(() => d2.created);
  await maria.collab.assign(d2.id, { add: ['sam@demo.test'] });
  await until(async () => (await sam.srv.listShared()).some((m) => m.id === d2.id));
  await sam.collab.join((await sam.srv.listShared()).find((m) => m.id === d2.id)); sam.collab.attach(d2.id, () => {});
  edit(sam, d2.id, (a) => { a.inspector = 'Sam was here'; });
  await until(() => core.state.shared[d2.id].crdt.fields.inspector?.v === 'Sam was here');
  await maria.collab.assign(d2.id, { remove: ['sam@demo.test'] });
  await until(() => sam.collab.docs.get(d2.id).assigned === false);
  assert.ok(!(await sam.srv.listShared()).some((m) => m.id === d2.id));
  assert.equal(core.state.shared[d2.id].crdt.fields.inspector.n, 'Sam Okafor', 'still credited to Sam');
});

await test('"notify my foreman": the report also lands in the foreman’s inbox, not only the dev team’s', async () => {
  await sam.reporter.send({ message: 'Photos will not upload on the tower', code: 'ERR-NET-001', notify: true });
  await until(async () => (await maria.srv.notifications()).length === 1);
  const [n] = await maria.srv.notifications();
  assert.equal(n.from, 'Sam Okafor'); assert.match(n.message, /Photos will not upload/);
  assert.equal((await sam.srv.notifications()).length, 0, 'only the foreman is notified');
  assert.equal(core.state.issues.length >= 1, true, 'the dev team still gets it');
  await sam.reporter.send({ message: 'dev team only' });
  await until(() => core.state.issues.length === 2); await wait(100);
  assert.equal((await maria.srv.notifications()).length, 1, 'no notification unless asked');
});

await test('phase gating: Phase 1 hides every Phase 2 feature; Phase 2 hides the later ones', () => {
  for (const f of ['team', 'roles', 'assign', 'attribution', 'notify', 'photofirst']) { assert.equal(has(f, 1), false, f); assert.equal(has(f, 2), true, f); }
  assert.equal(has('nearby', 2), false); assert.equal(has('nearby', 4), true); assert.equal(has('library', 1), true);
  assert.ok(Object.values(FEATURE_PHASE).every((n) => [1, 2, 4].includes(n)));
});

console.log(`\n${passed} passed`);
server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); process.exit(0);
