// Run: node test/consmod.test.mjs  — the real CONS-MOD Prework Inspection XLSForm (repo root) end to end, minus the DOM.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import XLSX from 'xlsx';
import { convertWorkbook } from '../src/xlsform.js';
import { checkSurvey, newAnswers, recalc, validate, ev, scopeOf, instanceLabel } from '../src/schema.js';
import { CTX, setChoices } from '../src/expr.js';
import { Lookups } from '../src/lookups.js';
import { MockServer } from '../src/mockServer.js';

const csv = fs.readFileSync(new URL('../customers.csv', import.meta.url), 'utf8');
const { survey, warnings } = convertWorkbook(XLSX, fs.readFileSync(new URL('../CONS-MOD Prework Inspection.xlsx', import.meta.url)), { files: { 'customers.csv': csv } });
const all = (fields = survey.pages.flatMap((p) => p.fields), acc = []) => { for (const f of fields) { acc.push(f); if (f.fields) all(f.fields, acc); } return acc; };
const field = (n) => all().find((f) => f.name === n);
setChoices(survey);
CTX.props = { username: 'Maria Lopez', email: '' };
let passed = 0; const test = (n, fn) => { fn(); passed++; console.log(`  ✓ ${n}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
console.log('cons-mod prework');

test('imports cleanly: valid JSON, no warnings, organizations come from the identity service', () => {
  assert.deepEqual(checkSurvey(survey), []);
  assert.deepEqual(warnings, []);
  assert.equal(field('organization_id').choicesFrom, 'organizations');
  assert.equal(field('asset_serials_s').repeatCount, 2);
  assert.deepEqual(survey.pages.map((p) => p.label), ['Arrival & Site Administration', 'Serial # & Asset Tag Log', 'Ground Photos', 'Tower Photos', 'Additionals', 'Survey Completion']);
  assert.ok(field('customer').choices.length >= 10 && field('customer').choices.some((c) => c.value === 'other')); assert.equal(field('customer').appearance, 'autocomplete');
  assert.equal(field('sectors_needed').appearance, 'horizontal');
  assert.equal(field('tech_signature').appearance, 'signature');
  assert.equal(field('asset_serial_photo').maxFiles, undefined, 'multiline image = many photos');
  assert.equal(field('glamour_photo').maxFiles, 1);
  assert.match(field('glamour_photo').fileName, /_glamour_shot_/);
});

test('defaults, hidden calculations, "if/jr:choicename", editable calculated question', () => {
  const a = newAnswers(survey, { id: 'd1', name: 'Maria Lopez' });
  assert.equal(a.survey_type, 'cons_mod_prework');
  assert.deepEqual(a.sectors_needed, ['alpha', 'beta', 'gamma']);
  assert.ok(a.site_visit_datetime);
  assert.equal(a.username, 'Maria Lopez');
  a.customer = 'crownCastle'; a.job_number = 'J-77'; a.project_number = 'P-9'; recalc(survey, a);
  assert.equal(a.customer_label, 'Crown Castle'); assert.equal(a.customer_site_id, 'J-77'); assert.equal(a.customer_site_name, 'P-9');
  a.customer = 'other'; a.customer_other = 'Zed Corp'; recalc(survey, a);
  assert.equal(a.customer_label, 'Zed Corp');
  a.customer = 'crownCastle'; a.structure_owner_bin = 'yes'; recalc(survey, a);
  assert.equal(a.structure_owner, 'Crown Castle');
  a.structure_owner = 'Edited by user'; recalc(survey, a);
  assert.equal(a.structure_owner, 'Edited by user', 'user edit survives recalculation until its inputs change');
  a.structure_owner_bin = 'no'; recalc(survey, a);
  assert.equal(a.structure_owner, '', 'inputs changed: recomputed');
  assert.equal(instanceLabel(survey, a), 'crownCastle_J-77');
});

test('sector photos are required only for the sectors selected', () => {
  const a = newAnswers(survey, { id: 'd1', name: 'M' }); recalc(survey, a);
  let paths = validate(survey, a).map((i) => i.path);
  assert.ok(paths.includes('alpha_from_grade_photo') && paths.includes('gamma_from_tower_photo'));
  assert.ok(!paths.includes('delta_from_grade_photo'), 'delta not selected');
  a.sectors_needed.push('delta'); paths = validate(survey, a).map((i) => i.path);
  assert.ok(paths.includes('delta_from_grade_photo'));
});

test('pulldata: geopoint, JSON weather, countselected, jr:choicename inside a repeat', () => {
  const a = newAnswers(survey, { id: 'd1', name: 'M' });
  a.site_coords = { lat: 35.2271, lon: -80.8431 };
  CTX.lookup = () => JSON.stringify({ name: 'Charlotte', weather: [{ main: 'Clouds' }], main: { temp: 71.4 }, wind: { speed: 6.2, deg: 240 } });
  recalc(survey, a);
  assert.equal(a.weather_lat, 35.2271); assert.equal(a.weather_lon, -80.8431);
  assert.equal(a.weather_city, 'Charlotte'); assert.equal(a.weather_auto, 'Clouds');
  assert.equal(a.temperature_auto, 71.4); assert.equal(a.wind_speed_auto, 6.2); assert.equal(a.wind_direction_auto, 240);
  assert.equal(String(a.inspection_technician).trim(), '', 'member lookup unresolved in this test → blank, not an error');
  a.asset_serials_s = [{ _id: 'r1', asset_type: 'antenna', asset_serial_photo: ['p1', 'p2'] }]; recalc(survey, a);
  assert.equal(a.asset_serials_s[0].asset_label, 'Antenna'); assert.equal(a.asset_serials_s[0].asset_serial_photo_count, 3);
});

test('photo file names come from the fileName expression, numbered per photo', () => {
  const a = newAnswers(survey, { id: 'd1', name: 'M' });
  a.customer = 'crownCastle'; a.job_number = 'J-77'; a.project_number = 'P-9'; recalc(survey, a);
  const g = ev(field('glamour_photo').fileName, scopeOf(a, a, 'glamour_photo'), '');
  assert.match(g, /^Crown Castle_J-77_glamour_shot_\d{8}-\d{6}$/);
  a.safety_climb_base_photo = ['x']; recalc(survey, a);
  assert.match(ev(field('safety_climb_base_photo').fileName, scopeOf(a, a, 'safety_climb_base_photo'), ''), /_safety_climb_bottom_assembly_2\d{8}-\d{6}$/);
});

test('org confirmation notes use jr:choicename (typed organization today)', () => {
  const a = newAnswers(survey, { id: 'd1', name: 'M' });
  a.organization_id = 'Acme Org'; a.confirm_org = 'Acme Org';
  const ok = all().find((f) => f.type === 'note' && /has been confirmed/.test(f.label)), bad = all().find((f) => f.type === 'note' && /cannot be confirmed/.test(f.label));
  assert.equal(ev(ok.relevant, scopeOf(a, a, ok.name), false), true);
  assert.equal(ev(bad.relevant, scopeOf(a, a, bad.name), true), false);
  a.confirm_org = 'Wrong'; assert.equal(ev(bad.relevant, scopeOf(a, a, bad.name), false), true);
});

// ---- offline-safe lookups -------------------------------------------------------------------------------
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const server = new MockServer({ scale: 60, storage: mem(), profile: 'offline' });
const lk = new Lookups({ server, storageKey: 'k', retryMs: 100 });
lk.install({ username: 'Maria Lopez' });
const realFetch = globalThis.fetch; let calls = 0;
globalThis.fetch = async () => { calls++; return { ok: true, json: async () => ({ current: { temperature_2m: 64.5, wind_speed_10m: 8.1, wind_direction_10m: 200, weather_code: 61 } }) }; };

{
  const a = newAnswers(survey, { id: 'd1', name: 'M' }); a.weather_api_key = ''; a.site_coords = { lat: 35.2, lon: -80.8 };
  recalc(survey, a);
  assert.ok(!a.weather_json, 'offline: blank immediately, form keeps working');
  await wait(20);                                     // the (non-network) member lookup settles; only the weather call is waiting
  assert.equal(lk.pendingCount(), 1); assert.equal(calls, 0, 'no request made while offline');
  const resolved = new Promise((r) => lk.onResolve(r));
  server.setProfile('good'); lk.nudge(); await resolved;
  recalc(survey, a);
  assert.equal(a.weather_auto, 'Rain'); assert.equal(a.temperature_auto, 64.5); assert.equal(a.wind_direction_auto, 200);
  server.setProfile('offline'); a.site_coords = { lat: 36.0, lon: -81.0 }; recalc(survey, a);     // new place, lookup pending offline
  assert.equal(a.temperature_auto, 64.5, 'a pending lookup never erases a value we already have');
  assert.equal(lk.pendingCount(), 1, 'the new location is queued and will resolve when service returns'); passed++; console.log('  ✓ weather lookup: offline → "" → fills when back; value is sticky');
}
globalThis.fetch = realFetch;

console.log(`\n${passed} passed`);
process.exit(0);
