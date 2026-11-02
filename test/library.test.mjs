import assert from 'node:assert/strict';
import { Library, tileOf } from '../src/library.js';
import { inferScope } from '../src/xlsform.js';
import { demoPlaceholders } from '../src/demoLibrary.js';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
let n = 0; const t = (name, fn) => { try { fn(); n++; console.log('ok  ', name); } catch (e) { console.error('FAIL', name, e.message); process.exit(1); } };

const lib = new Library({ storageKey: 'lib' });
lib.merge(demoPlaceholders());
t('groups surveys by scope', () => assert.deepEqual(lib.scopes().map((s) => s.name), ['COP', 'CONS-MOD', 'Demo', 'Inspections'].sort()));
t('scope counts', () => assert.equal(lib.scopes().find((s) => s.name === 'CONS-MOD').count, 5));
t('filter by scope + search', () => { assert.equal(lib.filter({ scope: 'COP' }).length, 4); assert.deepEqual(lib.filter({ q: 'lighting' }).map((s) => s.title), ['Lighting COP']); });
t('newer version replaces, older does not', () => {
  const a = lib.get('demo-lighting-cop'); lib.merge([{ ...a, version: 2 }]); assert.equal(lib.get(a.id).version, 2);
  lib.merge([{ ...a, version: 1 }]); assert.equal(lib.get(a.id).version, 2);
});
t('scope change at same version is picked up', () => { const a = lib.get('demo-safety-cop'); assert.ok(lib.merge([{ ...a, scope: 'Safety' }])); assert.equal(lib.get(a.id).scope, 'Safety'); });
t('persists offline', () => assert.equal(new Library({ storageKey: 'lib' }).all.length, 18));
t('tiles have colour and label', () => { const x = tileOf({ id: 'z', title: 'FS Plumb' }); assert.match(x.color, /^#/); assert.equal(x.text, 'PLUMB'); });
t('scope inferred from title', () => { assert.equal(inferScope('CONS-MOD Prework Inspection'), 'CONS-MOD'); assert.equal(inferScope('Lighting COP'), 'COP'); assert.equal(inferScope('Compound Inspection'), 'Inspections'); assert.equal(inferScope('Whatever'), 'Other'); });
console.log(`${n} passed`);
