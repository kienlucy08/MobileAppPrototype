// A realistic set of surveys for the demo: the real CONS-MOD Prework Inspection (imported from the xlsx) plus
// clearly-labelled placeholders for the others, named after the surveys in a typical Survey123 account.
import { SAMPLE_SURVEY } from './sample.js';

const SPEC = [
  ['FS Compound Inspection', 'Inspections', 'COMPOUND INSPECTION', '#0e7490'],
  ['FS Guy Facilities Inspection', 'Inspections', 'GUY FACILITIES', '#0e7490'],
  ['FS Plumb & Twist', 'Inspections', 'PLUMB & TWIST', '#0e7490'],
  ['FS Structure Climb Inspection', 'Inspections', 'STRUCTURE CLIMB', '#0e7490'],
  ['FS Structure Flight Inspection', 'Inspections', 'STRUCTURE FLIGHT', '#0e7490'],
  ['Compound Inspection', 'Inspections', 'COMPOUND INSPECTION', '#1e5a8a'],
  ['Compound Inspection [CDP]', 'Inspections', 'CDP', '#64748b'],
  ['48 Hour Turnaround Tests', 'CONS-MOD', '48 HOUR v2', '#dc2626'],
  ['CONS-MOD 48 Hour Turnaround', 'CONS-MOD', '48 HOUR', '#dc2626'],
  ['CONS-MOD Ground COP', 'CONS-MOD', 'NETWORK', '#16a34a'],
  ['CONS-MOD Sector COP', 'CONS-MOD', 'SECTOR COP', '#ea580c'],
  ['CONS-MOD Sector COP v2', 'CONS-MOD', 'SECTOR COP v2', '#0e7490'],
  ['COP Survey', 'COP', 'CLOSE-OUT PACKAGE', '#0e7490'],
  ['Lighting COP', 'COP', 'LIGHTING', '#ca8a04'],
  ['Safety COP', 'COP', 'SAFETY', '#b91c1c'],
  ['Service COP', 'COP', 'SERVICE', '#4d7c0f'],
];
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const demoPlaceholders = () => [demoCloseout(), demoErrors(), guyFacilities(), ...SPEC.filter(([t]) => t !== 'FS Guy Facilities Inspection')].map((x) => (Array.isArray(x) ? placeholder(x) : x));
const placeholder = ([title, scope, text, color]) => {
  const s = structuredClone(SAMPLE_SURVEY);
  s.id = `demo-${slug(title)}`; s.title = title; s.scope = scope; s.tile = { text, color }; s.version = 1; s.demo = true;
  s.pages[0].fields.unshift({ name: 'demo_note', type: 'note', label: '<b>Demo placeholder</b> — stands in for the real form; replace it by importing the XLSForm.' });
  return s;
};

export const PREWORK_TILE = { text: 'PREWORK', color: '#a21caf' };

/** Field calculations (Phase 2): values the crew needs are computed inside the survey, so a bad one surfaces on site.
 *  The geometry below is a PLACEHOLDER — the real guy-facilities equations and test cases are still to be written. */
export function guyFacilities() {
  return {
    id: 'demo-fs-guy-facilities-inspection', version: 1, title: 'FS Guy Facilities Inspection', scope: 'Inspections', tile: { text: 'GUY FACILITIES', color: '#0e7490' }, demo: true,
    pages: [
      { name: 'site', label: 'Site', fields: [
        { name: 'siteId', type: 'text', label: 'Site ID', required: true },
        { name: 'demo_note', type: 'note', label: '<b>Placeholder equations.</b> Wire length and angle use simple geometry to show on-site calculation. Real equations and test cases are still to be written.' },
      ] },
      { name: 'wires', label: 'Guy wires', fields: [
        { name: 'wires', type: 'repeat', label: 'Guy wire', addLabel: 'Add guy wire', fields: [
          { name: 'wire', type: 'text', label: 'Wire', required: true, hint: 'e.g. A-1' },
          { name: 'attachHeight', type: 'decimal', label: 'Attachment height (ft)', required: true, constraint: '${.} > 0', constraintMessage: 'Enter a height above zero.' },
          { name: 'anchorOffset', type: 'decimal', label: 'Anchor distance from base (ft)', required: true, constraint: '${.} > 0', constraintMessage: 'Enter a distance above zero.' },
          { name: 'tension', type: 'decimal', label: 'Measured tension (lbf)' },
          { name: 'wireLength', type: 'decimal', label: 'Wire length (ft)', calculation: 'round(sqrt(pow(${attachHeight}, 2) + pow(${anchorOffset}, 2)), 1)' },
          { name: 'wireAngle', type: 'decimal', label: 'Angle from ground (°)', calculation: 'round(atan(${attachHeight} div ${anchorOffset}) * 180 div pi(), 1)' },
          { name: 'wireCheck', type: 'text', label: 'Check', calculation: "iff(${wireAngle} < 30 or ${wireAngle} > 60, 'CHECK: angle out of range', 'OK')" },
          { name: 'wireFlag', type: 'note', label: '<b>Check this wire now</b> — the angle is outside 30°–60°. Re-measure before leaving site.', relevant: "${wireCheck} != 'OK' and ${wireCheck} != ''" },
          { name: 'wirePhotos', type: 'image', label: 'Photos', minFiles: 1, maxFiles: 5, appearance: 'both' },
        ] },
      ] },
    ],
  };
}

/** Screen-share surveys: "Demo · Closeout photos" (wide 0.5x + 10x close-up shots) and "Demo · Error messages" (every error a crew can hit). */
export function demoCloseout() {
  return {
    id: 'demo-closeout-photos', version: 1, title: 'Demo · Closeout photos', scope: 'Demo', tile: { text: 'DEMO CLOSEOUT', color: '#1f7a3d' }, demo: true,
    pages: [
      { name: 'site', label: 'Site', fields: [
        { name: 'siteId', type: 'text', label: 'Site ID', required: true },
        { name: 'inspector', type: 'text', label: 'Inspector' },
      ] },
      { name: 'photos', label: 'Photos', fields: [
        { name: 'wideShots', type: 'image', label: 'Wide shots (0.5×)', hint: 'Full structure. Camera opens at 0.5×.', defaultZoom: 0.5, minFiles: 1, maxFiles: 50, required: true },
        { name: 'closeUps', type: 'image', label: 'Close-ups (zoom up to 10×)', minFiles: 1, maxFiles: 50, required: true },
      ] },
    ],
  };
}

export function demoErrors() {
  return {
    id: 'demo-error-messages', version: 1, title: 'Demo · Error messages', scope: 'Demo', tile: { text: 'DEMO ERRORS', color: '#b91c1c' }, demo: true,
    pages: [
      { name: 'rules', label: 'Rules', fields: [
        { name: 'note', type: 'note', label: '<b>Leave Site ID empty, type a height of 5, and add no photos</b>, then tap Review — each mistake gets its own code and a fix button.' },
        { name: 'siteId', type: 'text', label: 'Site ID', required: true },
        { name: 'heightFt', type: 'integer', label: 'Structure height (ft)', constraint: '${.} >= 10 and ${.} <= 2000', constraintMessage: 'Height must be between 10 and 2000 ft.' },
        { name: 'photos', type: 'image', label: 'Photos (at least 2)', minFiles: 2, maxFiles: 10, required: true },
      ] },
    ],
  };
}
