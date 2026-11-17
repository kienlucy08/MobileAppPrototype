// Run: node test/pull.test.mjs — repeated information is pulled from other surveys for the same site (newest first, this phone before the server).
import assert from 'node:assert/strict';
import { SiteData } from '../src/sitedata.js';

let passed = 0; const test = (n, fn) => { fn(); passed++; console.log(`  ✓ ${n}`); };
const sub = (id, surveyId, title, answers, updatedAt) => [id, { id, surveyId, surveyTitle: title, answers, updatedAt, status: 'complete' }];
const engine = { subs: new Map([
  sub('a', 'demo-structure-flight', 'Structure Flight Inspection', { siteId: 'TX-4412', towerType: 'guyed', height: 199, gateCode: '', notes: 'old' }, 100),
  sub('b', 'demo-compound', 'Compound Inspection', { siteId: ' tx-4412 ', gateCode: '4471', height: 150 }, 200),
  sub('c', 'demo-compound', 'Compound Inspection', { siteId: 'OTHER', gateCode: '9999' }, 300),
]) };
const sd = new SiteData({ server: { siteData: async () => ({}) }, engine, storageKey: 'pull-test' });
sd._fetch = async () => {};                      // no network in this test
sd.titleOf = (id) => `title of ${id}`; sd.cache['tx-4412'] = { at: Date.now(), data: { 'demo-guy-facilities': { siteId: 'TX-4412', temperature: 54, towerType: 'monopole' } } };

console.log('pull from other surveys');
test('takes the newest answer for the same site (site id is trimmed and case-insensitive)', () => {
  assert.deepEqual(sd.pull('TX-4412', 'height'), { value: 150, title: 'Compound Inspection', from: 'this phone' });
  assert.equal(sd.pull('TX-4412', 'gateCode').value, '4471');
});
test('ignores empty answers, other sites, objects and unknown fields', () => {
  assert.equal(sd.pull('TX-4412', 'notes').value, 'old'); assert.equal(sd.pull('TX-4412', 'nope'), null); assert.equal(sd.pull('', 'height'), null); assert.equal(sd.pull('NONE', 'height'), null);
});
test('this phone wins over the server; the server fills what the phone does not have', () => {
  assert.equal(sd.pull('TX-4412', 'towerType').value, 'guyed');                 // the phone's Structure Flight, not the server's monopole
  assert.deepEqual(sd.pull('TX-4412', 'temperature'), { value: 54, title: 'title of demo-guy-facilities', from: 'the server' });
});
test('the survey being filled is never its own source', () => {
  assert.equal(sd.pull('TX-4412', 'gateCode', 'b'), null);
  assert.equal(sd.pull('TX-4412', 'height', 'b').value, 199);
});
console.log(`\n${passed} passed`);
