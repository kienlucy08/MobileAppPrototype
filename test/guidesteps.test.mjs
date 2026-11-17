// Run: node test/guidesteps.test.mjs — the guided camera's plan for a guy compound, and the prompt it shows for each photo.
import assert from 'node:assert/strict';
import { buildSteps, wireNumber, ANCHOR_SLOTS } from '../src/guidesteps.js';

let passed = 0; const test = (n, fn) => { fn(); passed++; console.log(`  ✓ ${n}`); };
const answers = { siteId: 'AK-1', wiresa: [{ _id: 'w1', level: 1, pos: 'PO', preform: 'Green' }, { _id: 'w2', level: 1, pos: 'PI', preform: 'Green' }, { _id: 'w3', level: 2, pos: 'PO', preform: 'None' }] };

console.log('guided camera steps');
test('wire by wire: anchor first (with torque arms), then each wire’s dead end group, color and tension together', () => {
  const s = buildSteps({ c: 'a', answers });
  assert.equal(s.filter((x) => x.group === 'Anchor').length, ANCHOR_SLOTS.length); assert.ok(s.some((x) => /Torque arm left/.test(x.label)) && s.some((x) => /Torque arm right/.test(x.label)));
  const w = s.filter((x) => x.group !== 'Anchor').map((x) => x.tip);
  assert.deepEqual(w.slice(0, 4), ['Take a photo of guy level 1 wire 1 dead end group', 'Take a photo of guy level 1 wire 1 color', 'Take a photo of guy level 1 wire 1 tension', 'Take a photo of guy level 1 wire 2 dead end group']);
});
test('one tool at a time: every dead end group, then every color, then every tension', () => {
  const g = buildSteps({ c: 'a', answers, mode: 'tool' }).filter((x) => x.group !== 'Anchor').map((x) => x.group);
  assert.deepEqual([...new Set(g)], ['Dead end group', 'Preform color', 'Tension']); assert.deepEqual(g, ['Dead end group', 'Dead end group', 'Dead end group', 'Preform color', 'Preform color', 'Tension', 'Tension', 'Tension']);
});
test('a wire with no preform color gets no color prompt; the other two slots are still asked', () => {
  const s = buildSteps({ c: 'a', answers });
  assert.ok(!s.some((x) => x.target.itemId === 'w3' && x.group === 'Preform color')); assert.equal(s.filter((x) => x.target.itemId === 'w3').length, 2);
});
test('wire numbers count within the level (the second wire at level 1 is wire 2; level 2 starts again at wire 1)', () => {
  assert.deepEqual(answers.wiresa.map((w) => wireNumber(answers.wiresa, w)), [1, 2, 1]);
});
test('photos link to the wire: each step targets its own wire and slot; names follow the crew’s file naming; keys are unique', () => {
  const s = buildSteps({ c: 'a', answers });
  assert.ok(s.some((x) => x.name === 'AK-1_guy_wire_A1_po_caliper' && x.target.itemId === 'w1' && x.target.field === 'caliperPhoto'));
  assert.ok(s.some((x) => x.name === 'AK-1_guy_wire_A1_pi_color' && x.target.itemId === 'w2' && x.target.field === 'preformPhoto'));
  assert.ok(s.some((x) => x.name === 'AK-1_guy_A2_tension' && x.target.itemId === 'w3' && x.target.field === 'tensionPhoto'));
  assert.equal(new Set(s.map((x) => x.key)).size, s.length);
});
test('no wires still gives the anchor prompts', () => { assert.equal(buildSteps({ c: 'b', answers: { siteId: 'X' } }).length, ANCHOR_SLOTS.length); });
console.log(`\n${passed} passed`);
