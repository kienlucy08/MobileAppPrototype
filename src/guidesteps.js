// Guided photos for guy facilities. Enter the levels, wires and preform colors first; the camera then tells the crew what to shoot
// ("Take a photo of guy level 1 wire 1 dead end group") and files the photo against that wire, so photos link properly.
// Each wire has three photo slots (dead end group, color, tension) and each slot takes several photos. The order is a choice:
//   'wire' = wire by wire (level 1 wire 1: dead end group, color, tension; then the next wire)
//   'tool' = one tool at a time (every dead end group, then every color, then every tension), as Spencer prefers.
// Anchor photos (with torque arm left and right) come first. File names follow the crew's naming (guy_wire_A1_po_caliper,
// guy_wire_A1_po_color, guy_A1_tension, guy_anchorA_left) so the office can sort them.

export const ANCHOR_SLOTS = [['left', 'Left'], ['right', 'Right'], ['back', 'Back'], ['head1', 'Head 1'], ['head2', 'Head 2'], ['rod', 'Rod'], ['torque-arm-left', 'Torque arm left'], ['torque-arm-right', 'Torque arm right']];
export const GROUPS = ['Anchor', 'Dead end group', 'Preform color', 'Tension'];
const slug = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const SLOT = { 'Dead end group': { field: 'caliperPhoto', tip: 'dead end group' }, 'Preform color': { field: 'preformPhoto', tip: 'color' }, Tension: { field: 'tensionPhoto', tip: 'tension' } };

/** Which wire at its level this is (the second wire at level 2 is wire 2). */
const levelOf = (wires, w) => w.level ?? wires.indexOf(w) + 1;
export const wireNumber = (wires, w) => wires.slice(0, Math.max(0, wires.indexOf(w)) + 1).filter((x) => levelOf(wires, x) === levelOf(wires, w)).length || 1;

export function buildSteps({ c, answers, mode = 'wire' }) {
  const C = c.toUpperCase(), site = String(answers.siteId || 'site').trim(), wires = answers[`wires${c}`] || [];
  const anchor = ANCHOR_SLOTS.map(([slot, label]) => ({ group: 'Anchor', label: `Anchor ${C} · ${label}`, tip: `Take a photo of anchor ${C} ${label.toLowerCase()}`, name: `${site}_guy_anchor${C}_${slot}`, target: { kind: 'anchor', field: `anchorPhotos${c}`, slot } }));
  const file = (g, w) => (g === 'Tension' ? `guy_${C}${levelOf(wires, w)}_tension` : `guy_wire_${C}${levelOf(wires, w)}_${slug(w.pos) || 'po'}_${g === 'Preform color' ? 'color' : 'caliper'}`);
  const wireStep = (w, g) => { const n = wireNumber(wires, w); return { group: g, label: `Level ${levelOf(wires, w)} · wire ${n} · ${SLOT[g].tip}`, tip: `Take a photo of guy level ${levelOf(wires, w)} wire ${n} ${SLOT[g].tip}`, name: `${site}_${file(g, w)}`, target: { kind: 'wire', field: SLOT[g].field, itemId: w._id } }; };
  const wanted = (w, g) => !(g === 'Preform color' && w.preform === 'None');
  const rows = wires;
  const list = mode === 'tool' ? ['Dead end group', 'Preform color', 'Tension'].flatMap((g) => rows.filter((w) => wanted(w, g)).map((w) => wireStep(w, g)))
    : rows.flatMap((w) => ['Dead end group', 'Preform color', 'Tension'].filter((g) => wanted(w, g)).map((g) => wireStep(w, g)));
  return [...anchor, ...list].map((s, i) => ({ ...s, key: `${s.group}:${s.target.kind === 'anchor' ? s.target.slot : `${s.target.itemId}:${s.target.field}`}`, index: i }));
}
