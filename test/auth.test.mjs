// Run: node test/auth.test.mjs — one FieldSync identity for the mobile app: login, profile, session lifetime, removal.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createServer } from '../server/server.js';
import { RemoteServer } from '../src/api.js';
import { Auth } from '../src/auth.js';
import { ServerCore } from '../src/serverCore.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
globalThis.localStorage = mem();
let passed = 0; const test = async (n, fn) => { await fn(); passed++; console.log(`  ✓ ${n}`); };
console.log('auth');

await test('password users and Microsoft users each sign in their own way; wrong credentials get a specific code', () => {
  const c = new ServerCore();
  assert.equal(c.loginPassword({ username: 'sam', password: 'demo' }).profile.email, 'sam@demo.test');
  assert.equal(c.loginPassword({ username: 'SAM@demo.test', password: 'demo' }).profile.username, 'sam', 'username or email, any case');
  assert.throws(() => c.loginPassword({ username: 'sam', password: 'nope' }), (e) => e.code === 'ERR-AUTH-002');
  assert.throws(() => c.loginPassword({ username: 'maria', password: 'demo' }), (e) => e.code === 'ERR-AUTH-002', 'a Microsoft user cannot use a password');
  assert.equal(c.loginMicrosoft({ email: 'maria@demo.test' }).profile.name, 'Maria Lopez');
  assert.throws(() => c.loginMicrosoft({ email: 'sam@demo.test' }), (e) => e.code === 'ERR-AUTH-003', 'a password user is not a Microsoft account');
});

await test('one profile carries username, email, name and the organizations they belong to', () => {
  const c = new ServerCore();
  const { profile } = c.loginPassword({ username: 'dana', password: 'demo' });
  assert.equal(profile.name, 'Dana Reyes'); assert.deepEqual(profile.organizations.map((o) => o.name).sort(), ['Acme Field Services', 'Summit Inspections']);
  assert.deepEqual(c.loginMicrosoft({ email: 'maria@demo.test' }).profile.organizations.map((o) => o.name), ['Acme Field Services']);
});

await test('session never expires on its own; an app update asks for credentials again', async () => {
  const c = new ServerCore(); const { token } = c.loginPassword({ username: 'sam', password: 'demo', appVersion: 'v1' });
  c.state.sessions[token].at = Date.now() - 400 * 24 * 3600 * 1000;               // a year later
  assert.equal(c.me(token).username, 'sam');
  const srv = new RemoteServer({ base: 'http://x' });
  const a1 = new Auth({ server: srv, storageKey: 's', appVersion: 'v1' });
  a1._set({ token, profile: c.me(token) });
  assert.equal(new Auth({ server: srv, storageKey: 's', appVersion: 'v1' }).signedIn, true, 'app restarted: still signed in');
  assert.equal(new Auth({ server: srv, storageKey: 's', appVersion: 'v2' }).signedIn, false, 'app updated: sign in again');
});

// ---- over real HTTP ------------------------------------------------------------------------------------
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-auth-'));
const { server, core } = createServer({ dataDir });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const mk = () => new RemoteServer({ base, scale: 60 });

await test('phone routes refuse requests with no sign-in', async () => {
  await assert.rejects(() => mk().listForms(), (e) => e.code === 'ERR-AUTH-001');
  await assert.rejects(() => mk().organizations(), (e) => e.code === 'ERR-AUTH-001');
});

await test('sign in over HTTP; organization list is the signed-in user\'s, not whatever email a client claims', async () => {
  const srv = mk(); const auth = new Auth({ server: srv, storageKey: 'h', appVersion: 'v1' });
  const p = await auth.passwordLogin('priya'.replace('priya', 'dana'), 'demo');
  assert.equal(p.email, 'dana@demo.test');
  assert.deepEqual((await srv.organizations()).map((o) => o.name).sort(), ['Acme Field Services', 'Summit Inspections']);
  const ms = mk(); const a2 = new Auth({ server: ms, storageKey: 'h2', appVersion: 'v1' }); await a2.microsoftLogin('priya@demo.test');
  assert.deepEqual((await ms.organizations()).map((o) => o.name), ['Summit Inspections']);
});

await test('removed user: session ends (ERR-AUTH-001, app is told), their submitted records stay, attributed to them', async () => {
  const srv = mk(); const auth = new Auth({ server: srv, storageKey: 'r', appVersion: 'v1' }); await auth.passwordLogin('sam', 'demo');
  let told = 0; auth.addEventListener('revoked', () => told++);
  await srv.begin({ id: 'rec1', schemaVersion: 1, answers: { siteId: 'S1' }, media: [] });
  assert.equal((await srv.commit({ id: 'rec1' })).recordId >= 1001, true);
  core.setUsers(core.state.users.filter((u) => u.username !== 'sam'));               // an admin removes Sam in the web app
  await assert.rejects(() => srv.listForms(), (e) => e.code === 'ERR-AUTH-001');
  assert.equal(told, 1, 'the app is told once so it can show "your account was removed"');
  assert.equal(core.state.subs.rec1.committed, true, 'record still on the server');
  assert.equal(core.state.subs.rec1.submittedBy.name, 'Sam Okafor', 'and still says who submitted it');
  await assert.rejects(() => mk().loginPassword({ username: 'sam', password: 'demo' }), (e) => e.code === 'ERR-AUTH-002');
});

console.log(`\n${passed} passed`);
server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); process.exit(0);
