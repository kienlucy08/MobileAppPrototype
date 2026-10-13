// Run: node test/orgs.test.mjs — organizations come from the user's memberships; cached for offline.
import assert from 'node:assert/strict';
import { ServerCore } from '../src/serverCore.js';
import { MockServer } from '../src/mockServer.js';
import { Orgs } from '../src/lookups.js';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
let passed = 0; const test = async (n, fn) => { await fn(); passed++; console.log(`  ✓ ${n}`); };
console.log('organizations');

await test('a user sees only the organizations they belong to (case-insensitive email)', () => {
  const c = new ServerCore();
  assert.deepEqual(c.orgsFor('Maria@Demo.test').map((o) => o.name), ['Acme Field Services']);
  assert.deepEqual(c.orgsFor('dana@demo.test').map((o) => o.name).sort(), ['Acme Field Services', 'Summit Inspections']);
  assert.deepEqual(c.orgsFor('stranger@example.com'), [], 'not in any org → empty list, never someone else\'s orgs');
  assert.deepEqual(c.orgsFor(''), []);
  c.setOrgs([{ id: 7, name: 'New Org', members: ['stranger@example.com'] }]);
  assert.deepEqual(c.orgsFor('stranger@example.com'), [{ id: '7', name: 'New Org' }]);
});

await test('phone caches the list: works offline after the first load, empty until then', async () => {
  const srv = new MockServer({ scale: 60, storage: mem(), profile: 'offline' });
  const store = mem(); globalThis.localStorage = store;
  const o = new Orgs({ server: srv, storageKey: 'orgs', getEmail: () => 'sam@demo.test', retryMs: 100 });
  await o.refresh();
  assert.equal(o.loaded(), false); assert.equal(o.state, 'offline'); assert.deepEqual(o.get(), []);
  srv.setProfile('good'); o.nudge(); await wait(120);
  assert.equal(o.state, 'ok'); assert.deepEqual(o.get(), [{ value: '1001', label: 'Acme Field Services' }]);
  srv.setProfile('offline');
  const again = new Orgs({ server: srv, storageKey: 'orgs', getEmail: () => 'sam@demo.test' });   // "app restarted with no signal"
  assert.deepEqual(again.get(), [{ value: '1001', label: 'Acme Field Services' }]);
  const other = new Orgs({ server: srv, storageKey: 'orgs', getEmail: () => 'someone.else@demo.test' });
  assert.deepEqual(other.get(), [], 'a different user never sees the cached list');
});

await test('a user in no organization gets a loaded-but-empty list', async () => {
  const srv = new MockServer({ scale: 60, storage: mem(), profile: 'good' });
  globalThis.localStorage = mem();
  const o = new Orgs({ server: srv, storageKey: 'x', getEmail: () => 'nobody@example.com' });
  await o.refresh(); assert.equal(o.loaded(), true); assert.deepEqual(o.get(), []);
});
console.log(`\n${passed} passed`); process.exit(0);
