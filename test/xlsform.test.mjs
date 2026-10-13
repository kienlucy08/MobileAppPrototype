// Run: node test/xlsform.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import XLSX from 'xlsx';
import { convertWorkbook } from '../src/xlsform.js';
import { checkSurvey, newAnswers, validate, recalc } from '../src/schema.js';

const { survey, warnings } = convertWorkbook(XLSX, fs.readFileSync(new URL('../samples/tower-inspection.xlsx', import.meta.url)));
let passed = 0;
const test = (n, fn) => { fn(); passed++; console.log(`  ✓ ${n}`); };
console.log('xlsform');

test('sample XLSForm converts to a valid survey (no JSON problems)', () => {
  assert.deepEqual(checkSurvey(survey), []);
  assert.equal(survey.title, 'Tower Site Inspection (XLSForm)');
  assert.equal(survey.version, 2026100801);
  assert.deepEqual(survey.pages.map((p) => p.name), ['site_details', 'condition', 'photos', 'guys', 'signoff']);
});
test('types and appearances map faithfully', () => {
  const f = (n) => survey.pages.flatMap((p) => p.fields).flatMap((x) => (x.fields ? [x, ...x.fields] : [x])).find((x) => x.name === n);
  assert.equal(f('site_photos').type, 'image'); assert.equal(f('site_photos').maxFiles, undefined, 'multiline image = many photos');
  assert.equal(f('compound_photo').maxFiles, 1); assert.equal(f('compound_photo').appearance, 'camera');
  assert.equal(f('inspector_signature').appearance, 'signature');
  assert.equal(f('findings_list').appearance, 'dropdown'); assert.equal(f('has_damage').appearance, 'horizontal');
  assert.equal(f('damage_notes').appearance, 'multiline'); assert.equal(f('damage_notes').relevant, "${has_damage} = 'yes'");
  assert.equal(f('guy_wire').type, 'repeat'); assert.equal(f('guy_wire').fields.length, 3);
  assert.equal(f('start').appearance, 'hidden'); assert.equal(f('end').autoEnd, true);
  assert.equal(f('tower_type').choices.length, 3);
  assert.equal(f('height_ft').default, 150);
});
test('Survey123 expressions work: ".", string-length, count, concat, relevance', () => {
  const a = newAnswers(survey);
  assert.equal(validate(survey, a).some((i) => i.path === 'site_id'), true);
  a.site_id = 'X'.repeat(41); a.tower_type = 'guyed'; a.has_damage = 'no'; a.site_photos = ['1', 'p2', 'p3']; a.height_ft = 5000;
  recalc(survey, a);
  const codes = Object.fromEntries(validate(survey, a).map((i) => [i.path, i.code]));
  assert.equal(codes.site_id, 'ERR-FIELD-002');   // within the 255 default, but string-length(.) <= 40 fails
  assert.equal(codes.height_ft, 'ERR-FIELD-002');  // . >= 10 and . <= 2000
});
test('warnings are specific, with spreadsheet rows', () => {
  for (const w of warnings) assert.ok(w.row >= 0 && w.message.length > 10);
  assert.ok(warnings.some((w) => /username/.test(w.message)), 'ArcGIS member lookup is called out');
});
test('problem forms are reported, not silently dropped', () => {
  const { warnings: w } = convertWorkbook(XLSX, (() => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['type', 'name', 'label', 'relevant'], ['geotrace', 'track', 'Walk the line'], ['select_one nolist', 'x', 'X'], ['text', 'y', 'Y', 'frobnicate(${x})'], ['hologram', 'z', 'Z'], ['begin_repeat', 'r', 'R']]), 'survey');
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  })());
  const text = w.map((x) => x.message).join('\n');
  for (const m of [/geotrace/, /nolist/, /frobnicate/, /hologram/, /never closed/]) assert.match(text, m);
});
console.log(`\n${passed} passed`);
