// Run: node test/guycalc.test.mjs — guy tension calculation and pulling values from the structure survey.
// Fixtures are the 9 wires of the real export (1193 Brundidge St): chord length is the real formula; min/max are only checked for shape,
// because the allowable-limit equation is a placeholder until the devs install the real one.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { chord, allowable, tensionFinding, guyRecord, levelElevation, pntRecord, twistFrom } from '../src/guycalc.js';
import { newAnswers, recalc } from '../src/schema.js';
import { guyFacilities, structureClimb, plumbTwist } from '../src/demoLibrary.js';
import { ServerCore } from '../src/serverCore.js';
import { CTX } from '../src/expr.js';

const COMPOUND = { a: { radius: 27.5, drop: -4 }, b: { radius: 28, drop: 0 }, c: { radius: 32.2, drop: -3 } };
const ELEV = { 1: 29, 2: 49, 3: 78 };
const REAL = [   // level, compound, tension, real cableCordLength, real min
  [1, 'a', 580, 42.96, 477.71], [2, 'a', 380, 59.71, 503.9], [3, 'a', 620, 86.49, 518.61],
  [1, 'b', 100, 40.31, 468.09], [2, 'b', 100, 56.44, 499.39], [3, 'b', 100, 82.87, 516.88],
  [1, 'c', 360, 45.4, 465.35], [2, 'c', 720, 61.16, 495.28], [3, 'c', 540, 87.17, 513.92],
];
let passed = 0; const test = (n, fn) => { fn(); passed++; console.log(`  ✓ ${n}`); };
const structure = { siteId: 'TX-1193', guyLevels: [{ level: 1, elevation: 29 }, { level: 2, elevation: 49 }, { level: 3, elevation: 78 }] };
const wires = REAL.map(([level, c, tension]) => ({ _id: `${level}${c}`, wire: `${level}-${c}`, level, compound: c, radius: COMPOUND[c].radius, dropDistance: COMPOUND[c].drop, breakingStrength: 6650, tension }));

console.log('guy tensions');
test('chord length matches all 9 wires of the real export', () => {
  for (const [level, c, , real] of REAL) assert.equal(Math.round(chord(COMPOUND[c].radius, ELEV[level], COMPOUND[c].drop) * 100) / 100, real, `level ${level} ${c}`);
});
test('placeholder limits: max is 1.5× min and the min is close to the real one (but not equal: it is a placeholder)', () => {
  const lim = allowable({ breakingStrength: 6650 });
  assert.equal(Math.round(lim.max / lim.min * 100) / 100, 1.5);
  for (const [, , , , realMin] of REAL) assert.ok(Math.abs(lim.min - realMin) / realMin < 0.12);
});
test('out-of-range wording matches the web app deficiency text', () => {
  assert.equal(tensionFinding({ level: 2, compound: 'a', position: 'po', tension: 380, min: 503.9, max: 755.85 }), 'Level: 2, Compound: a, Position: po Tension: 380, is out of range by -123.9');
  assert.equal(tensionFinding({ level: 2, compound: 'a', position: 'po', tension: 600, min: 503.9, max: 755.85 }), null);
});
test('whole record with structure data: every wire gets a chord, the source is the structure survey, low tensions are flagged', () => {
  const r = guyRecord({ wires }, structure);
  assert.equal(r.wires.length, 9); assert.ok(r.complete);
  assert.ok(r.wires.every((w) => w.source === 'structure survey' && w.chord > 0));
  assert.deepEqual(r.wires.map((w) => w.chord), REAL.map((x) => x[3]).map((x) => Math.round(x * 10) / 10));
  assert.ok(r.outOfRange >= 4 && r.wires.find((w) => w.id === '2a').status === 'out-of-range');
});
test('no structure survey yet: typed elevations still work; wires with neither wait for the web app', () => {
  const typed = wires.map((w) => ({ ...w, elevManual: ELEV[w.level] }));
  assert.ok(guyRecord({ wires: typed }, undefined).complete);
  const r = guyRecord({ wires }, undefined);
  assert.equal(r.waitingOnElevation, 9); assert.ok(!r.complete); assert.equal(r.wires[0].status, 'needs-elevation');
  assert.equal(guyRecord({ wires: [{ ...wires[0], level: 9 }] }, structure).waitingOnElevation, 1);   // a level the climber did not record
});
test('levelElevation tolerates blanks and missing levels', () => {
  assert.equal(levelElevation(structure, 2), 49); assert.equal(levelElevation(structure, 7), undefined); assert.equal(levelElevation(undefined, 1), undefined);
  assert.equal(levelElevation({ guyLevels: [{ level: 1, elevation: '' }] }, 1), undefined);
});
test('plumb & twist: signed readings, heights pulled from the structure survey', () => {
  assert.deepEqual(twistFrom([{ shift: 'right', degrees: 0, minutes: 0, seconds: 20 }]), { twist: 0.006, pass: true });
  assert.equal(twistFrom([{ shift: 'left', degrees: 1, minutes: 0, seconds: 0 }]).pass, false);
  const r = pntRecord({ levels: [{ level: 1, readings: [{ shift: 'left', degrees: 0, minutes: 3, seconds: 12 }] }, { level: 4 }] }, structure);
  assert.equal(r[0].elevation, 29); assert.equal(r[0].source, 'structure survey'); assert.equal(r[1].source, 'missing');
});

console.log('inside the survey (expressions)');
test('the guy facilities survey pulls the elevation from the structure survey and calculates on site', () => {
  CTX.site = { level: (site, level) => (site === 'TX-1193' ? levelElevation(structure, level) : undefined) };
  const survey = guyFacilities(), a = newAnswers(survey, { name: 'Maria' });
  a.siteId = 'TX-1193'; a.wires = [{ _id: 'w1', wire: '2-a-1', level: 2, compound: 'a', radius: 27.5, dropDistance: -4, breakingStrength: 6650, tension: 380 }];
  recalc(survey, a);
  const w = a.wires[0];
  assert.equal(w.attachElev, 49); assert.equal(w.elevSource, 'Structure survey'); assert.equal(w.wireLength, 59.7); assert.equal(w.wireCheck, 'LOW');
});
test('not available: it falls back to the typed elevation, then to "waiting for the web app"', () => {
  CTX.site = { level: () => undefined };
  const survey = guyFacilities(), a = newAnswers(survey, { name: 'Maria' });
  a.siteId = 'TX-9'; a.wires = [{ _id: 'w1', wire: 'x', level: 2, radius: 27.5, dropDistance: -4, breakingStrength: 6650, tension: 600 }];
  recalc(survey, a);
  assert.equal(a.wires[0].elevSource, 'Waiting: the web app will process'); assert.ok(a.wires[0].wireLength === '' || a.wires[0].wireLength === undefined);
  a.wires[0].elevManual = 49; recalc(survey, a);
  assert.equal(a.wires[0].elevSource, 'Typed in'); assert.equal(a.wires[0].wireLength, 59.7); assert.equal(a.wires[0].wireCheck, 'OK');
});
test('plumb & twist survey: height pulled, angle signed, check against the placeholder tolerance', () => {
  CTX.site = { level: (s, l) => levelElevation(structure, l) };
  const survey = plumbTwist(), a = newAnswers(survey, { name: 'Maria' });
  a.siteId = 'TX-1193'; a.readings = [{ _id: 'r1', level: 2, shift: 'left', degrees: 0, minutes: 3, seconds: 12 }, { _id: 'r2', level: 3, shift: 'right', degrees: 1, minutes: 0, seconds: 0 }];
  recalc(survey, a);
  assert.equal(a.readings[0].height, 49); assert.equal(a.readings[0].angle, -0.0533); assert.equal(a.readings[0].check, 'OK'); assert.equal(a.readings[1].check, 'CHECK');
});

console.log('server pull');
test('the server hands back the latest committed structure record for a site, matched by site id', () => {
  const core = new ServerCore();
  const send = (id, surveyId, answers) => { core.begin({ id, surveyId, schemaVersion: 1, answers, media: [], user: 'x' }); core.commit({ id }); };
  send('s1', structureClimb().id, { siteId: 'TX-1193', guyLevels: [{ level: 1, elevation: 28 }] });
  send('s2', structureClimb().id, { siteId: ' tx-1193 ', guyLevels: [{ level: 1, elevation: 29 }] });
  send('g1', guyFacilities().id, { siteId: 'TX-1193', wires: [] });
  send('s3', structureClimb().id, { siteId: 'OTHER', guyLevels: [{ level: 1, elevation: 99 }] });
  const d = core.siteData('TX-1193');
  assert.equal(levelElevation(d[structureClimb().id], 1), 29); assert.ok(d[guyFacilities().id]); assert.deepEqual(core.siteData('NOPE'), {});
  core.begin({ id: 'u', surveyId: structureClimb().id, schemaVersion: 1, answers: { siteId: 'TX-5', guyLevels: [] }, media: [{ id: 'm', size: 1 }], user: 'x' });   // not committed: not shared
  assert.deepEqual(core.siteData('TX-5'), {});
});
console.log(`\n${passed} passed`);
