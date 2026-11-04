// Guy-wire and plumb & twist calculations, pure functions (no DOM, no network) so the phone, the server and the tests all run
// the same code.
//
//   VERIFIED against the real export (1193 Brundidge St): chord length = sqrt(radius² + (attachment elevation − anchor drop)²),
//   all 9 wires match exactly.
//   PLACEHOLDER: allowable tension limits and the plumb & twist tolerance. The real equations live elsewhere and the devs will
//   install them: replace `LIMITS` / `allowable` / `twistFrom` below (or swap the whole object via `setEngine`). Nothing else changes.

const r = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
export const round1 = (x) => r(x, 1);

/** Straight-line cable length from the anchor to the attachment point. VERIFIED. */
export const chord = (radius, elevation, drop = 0) => Math.sqrt(Number(radius) ** 2 + (Number(elevation) - Number(drop || 0)) ** 2);

/** Placeholder allowable tension: minimum ≈ 7% of the cable breaking strength, maximum = 1.5 × minimum (the ratio seen in the export). */
export const LIMITS = { minPctOfBreaking: 0.07, maxOverMin: 1.5 };
export function allowable({ breakingStrength }) {
  const min = Number(breakingStrength) * LIMITS.minPctOfBreaking;
  return { min: r(min, 1), max: r(min * LIMITS.maxOverMin, 1) };
}

/** Text in the same wording the web app writes for the deficiency list. `null` when the tension is in range. */
export function tensionFinding({ level, compound, position, tension, min, max }) {
  const t = Number(tension);
  if (!Number.isFinite(t) || !Number.isFinite(min) || !Number.isFinite(max)) return null;
  const where = `Level: ${level}, Compound: ${compound}, Position: ${position}`;
  if (t < min) return `${where} Tension: ${t}, is out of range by ${r(t - min, 1)}`;
  if (t > max) return `${where} Tension: ${t}, is out of range by +${r(t - max, 1)}`;
  return null;
}

/** One wire. `elevation` comes from the structure survey (pulled) or the crew (typed); `source` records which. */
export function wire(w, { elevation, source } = {}) {
  const elev = elevation ?? w.elevation;
  const out = { elevation: elev ?? null, source: elev == null ? 'missing' : (source || 'entered') };
  if (elev == null || w.radius == null || w.radius === '') return { ...out, status: 'needs-elevation' };
  out.chord = r(chord(w.radius, elev, w.dropDistance), 1);
  const lim = allowable(w);
  if (Number.isFinite(lim.min)) { out.min = lim.min; out.max = lim.max; }
  if (w.tension !== undefined && w.tension !== '' && w.tension != null && out.min != null) {
    out.finding = tensionFinding({ ...w, min: out.min, max: out.max });
    out.status = out.finding ? 'out-of-range' : 'ok';
  } else out.status = 'no-tension';
  return out;
}

/** Elevation of a guy level from structure-survey answers: { guyLevels: [{ level, elevation }] }. */
export const levelElevation = (structure, level) => {
  const row = (structure?.guyLevels || []).find((x) => String(x.level) === String(level));
  const e = row?.elevation; return e === '' || e == null ? undefined : Number(e);
};

/** Whole guy-facilities record. `structure` may be undefined (not collected / not synced yet): wires fall back to typed values,
 *  and anything still missing is left for the web app to process. Returns per-wire results plus a summary. */
export function guyRecord(guy, structure) {
  const wires = (guy?.wires || []).map((w) => {
    const pulled = levelElevation(structure, w.level);
    return { id: w._id, name: w.wire, ...wire(w, pulled != null ? { elevation: pulled, source: 'structure survey' } : { elevation: w.elevManual === '' ? undefined : w.elevManual, source: 'entered' }) };
  });
  const bad = wires.filter((x) => x.status === 'out-of-range'), todo = wires.filter((x) => x.status === 'needs-elevation');
  return { wires, outOfRange: bad.length, waitingOnElevation: todo.length, findings: bad.map((x) => x.finding), complete: wires.length > 0 && !todo.length };
}

/** Plumb & twist, placeholder. One reading = degrees/minutes/seconds, shifted left or right. Tolerance is a placeholder. */
export const PNT = { toleranceDeg: 0.5 };
export const readingDeg = ({ shift, degrees = 0, minutes = 0, seconds = 0 }) => (shift === 'left' ? -1 : 1) * (Number(degrees) + Number(minutes) / 60 + Number(seconds) / 3600);
export function twistFrom(readings) {
  const deg = (readings || []).map(readingDeg);
  if (!deg.length) return undefined;
  const v = deg.reduce((a, b) => a + b, 0) / deg.length;
  return { twist: r(v, 3), pass: Math.abs(v) <= PNT.toleranceDeg };
}
/** Plumb & twist levels. Heights are pulled from the structure survey's guy levels when the crew has not typed them. */
export function pntRecord(pnt, structure) {
  return (pnt?.levels || []).map((l) => {
    const pulled = levelElevation(structure, l.level);
    const elevation = pulled ?? (l.elevManual === '' ? undefined : l.elevManual);
    return { level: l.level, elevation: elevation ?? null, source: pulled != null ? 'structure survey' : elevation != null ? 'entered' : 'missing', ...twistFrom(l.readings) };
  });
}

/** The inspection site visit as the user described it: the scope gives you 4 surveys, 2 of them optional. When the guy facilities and
 *  plumb & twist surveys are filled in, the structure survey's guy levels are pulled in and the values are calculated on site. */
export const BUNDLE = [
  { id: 'demo-fs-compound-inspection', title: 'FS Compound Inspection', need: 'required' },
  { id: 'demo-fs-structure-climb-inspection', title: 'FS Structure Climb Inspection', need: 'required', provides: 'guy attachment elevations' },
  { id: 'demo-fs-guy-facilities-inspection', title: 'FS Guy Facilities Inspection', need: 'optional', uses: 'structure' },
  { id: 'demo-fs-plumb-twist', title: 'FS Plumb & Twist', need: 'optional', uses: 'structure' },
];
