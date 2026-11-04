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

export const demoPlaceholders = () => [demoCloseout(), demoErrors(), guyFacilities(), structureClimb(), plumbTwist(), ...SPEC.filter(([t]) => !['FS Guy Facilities Inspection', 'FS Structure Climb Inspection', 'FS Plumb & Twist'].includes(t))].map((x) => (Array.isArray(x) ? placeholder(x) : x));
const placeholder = ([title, scope, text, color]) => {
  const s = structuredClone(SAMPLE_SURVEY);
  s.id = `demo-${slug(title)}`; s.title = title; s.scope = scope; s.tile = { text, color }; s.version = 1; s.demo = true;
  s.pages[0].fields.unshift({ name: 'demo_note', type: 'note', label: '<b>Demo placeholder</b> — stands in for the real form; replace it by importing the XLSForm.' });
  return s;
};

export const PREWORK_TILE = { text: 'PREWORK', color: '#a21caf' };

/** Field calculations (Phase 2): values the crew needs are computed inside the survey, so a bad one surfaces on site.
 *  Guy attachment elevations are collected by the climber in the structure survey and PULLED here for the same site. If they are not
 *  available yet (not submitted, no signal) the crew can type them, and if neither happens the web app processes the record later.
 *  The chord length is the real formula; the allowable tension limits are PLACEHOLDERS (src/guycalc.js) for the devs to replace. */
const SRC = "sitelevel(${siteId}, ${level})";
export function structureClimb() {
  return {
    id: 'demo-fs-structure-climb-inspection', version: 2, title: 'FS Structure Climb Inspection', scope: 'Inspections', tile: { text: 'STRUCTURE CLIMB', color: '#0e7490' }, demo: true,
    pages: [
      { name: 'site', label: 'Site', fields: [
        { name: 'siteId', type: 'text', label: 'Site ID', required: true },
        { name: 'demo_note', type: 'note', label: '<b>Demo placeholder.</b> Only the part other surveys use is real: the climber records each guy level’s attachment elevation. The guy facilities and plumb &amp; twist surveys pull it for this site.' },
      ] },
      { name: 'guy', label: 'Guy levels', fields: [
        { name: 'guyLevels', type: 'repeat', label: 'Guy level', addLabel: 'Add guy level', fields: [
          { name: 'level', type: 'integer', label: 'Level', required: true, constraint: '${.} > 0', constraintMessage: 'Levels start at 1.' },
          { name: 'elevation', type: 'decimal', label: 'Attachment elevation (ft)', required: true, hint: 'Measured by the climber', constraint: '${.} > 0', constraintMessage: 'Enter a height above zero.' },
        ] },
      ] },
    ],
  };
}

export function guyFacilities() {
  return {
    id: 'demo-fs-guy-facilities-inspection', version: 2, title: 'FS Guy Facilities Inspection', scope: 'Inspections', tile: { text: 'GUY FACILITIES', color: '#0e7490' }, demo: true,
    pages: [
      { name: 'site', label: 'Site', fields: [
        { name: 'siteId', type: 'text', label: 'Site ID', required: true },
        { name: 'temperature', type: 'decimal', label: 'Air temperature (°F)', hint: 'Used for the tension limits' },
        { name: 'structureSrc', type: 'note', label: '<b>Attachment elevations</b> come from the structure survey for this site when it is on this phone or on the server. If it is not, you can type them in each wire and the web app processes the rest.' },
      ] },
      { name: 'wires', label: 'Guy wires', fields: [
        { name: 'wires', type: 'repeat', label: 'Guy wire', addLabel: 'Add guy wire', fields: [
          { name: 'wire', type: 'text', label: 'Wire', required: true, hint: 'e.g. 2-a-1' },
          { name: 'level', type: 'integer', label: 'Guy level', required: true, constraint: '${.} > 0', constraintMessage: 'Levels start at 1.' },
          { name: 'compound', type: 'select_one', label: 'Anchor compound', choices: [{ value: 'a', label: 'a' }, { value: 'b', label: 'b' }, { value: 'c', label: 'c' }] },
          { name: 'radius', type: 'decimal', label: 'Anchor radius (ft)', required: true, constraint: '${.} > 0', constraintMessage: 'Enter a distance above zero.' },
          { name: 'dropDistance', type: 'decimal', label: 'Anchor drop (ft)', default: 0, hint: 'Negative if the anchor is below the base' },
          { name: 'breakingStrength', type: 'decimal', label: 'Cable breaking strength (lbf)', default: 6650, hint: '3/8" EHS = 6650' },
          { name: 'tension', type: 'decimal', label: 'Measured tension (lbf)' },
          { name: 'elevManual', type: 'decimal', label: 'Attachment elevation (ft): type it', hint: 'The structure survey for this site is not available yet', relevant: `${SRC} = ''` },
          { name: 'elevSource', type: 'text', label: 'Elevation from', calculation: `iff(${SRC} != '', 'Structure survey', iff(string(\${elevManual}) != '', 'Typed in', 'Waiting: the web app will process'))` },
          { name: 'attachElev', type: 'decimal', label: 'Attachment elevation (ft)', calculation: `iff(${SRC} != '', ${SRC}, \${elevManual})` },
          { name: 'wireLength', type: 'decimal', label: 'Cable length (ft)', calculation: 'guychord(${radius}, ${attachElev}, ${dropDistance})' },
          { name: 'minTension', type: 'decimal', label: 'Allowable min (lbf)', calculation: 'guymin(${breakingStrength})' },
          { name: 'maxTension', type: 'decimal', label: 'Allowable max (lbf)', calculation: 'guymax(${breakingStrength})' },
          { name: 'wireCheck', type: 'text', label: 'Check', calculation: "iff(${wireLength} = '', '', guystatus(${tension}, ${minTension}, ${maxTension}))" },
          { name: 'wireFlag', type: 'note', label: '<b>Tension is out of range</b>: re-measure before leaving site.', relevant: "${wireCheck} = 'LOW' or ${wireCheck} = 'HIGH'" },
          { name: 'wirePhotos', type: 'image', label: 'Photos', minFiles: 1, maxFiles: 5, appearance: 'both' },
        ] },
      ] },
    ],
  };
}

/** Plumb & twist: each reading is degrees / minutes / seconds shifted left or right at a guy level. Heights are pulled the same way.
 *  The twist maths and tolerance are PLACEHOLDERS (src/guycalc.js). */
export function plumbTwist() {
  return {
    id: 'demo-fs-plumb-twist', version: 2, title: 'FS Plumb & Twist', scope: 'Inspections', tile: { text: 'PLUMB & TWIST', color: '#0e7490' }, demo: true,
    pages: [
      { name: 'site', label: 'Site', fields: [
        { name: 'siteId', type: 'text', label: 'Site ID', required: true },
        { name: 'demo_note', type: 'note', label: '<b>Placeholder maths.</b> Heights are pulled from the structure survey for this site; the twist and pass limit are placeholders until the real equations are installed.' },
      ] },
      { name: 'readings', label: 'Readings', fields: [
        { name: 'readings', type: 'repeat', label: 'Reading', addLabel: 'Add reading', fields: [
          { name: 'level', type: 'integer', label: 'Guy level', required: true, constraint: '${.} > 0', constraintMessage: 'Levels start at 1.' },
          { name: 'leg', type: 'select_one', label: 'Leg', choices: [{ value: 'a', label: 'a' }, { value: 'b', label: 'b' }, { value: 'c', label: 'c' }] },
          { name: 'elevManual', type: 'decimal', label: 'Height (ft): type it', hint: 'The structure survey for this site is not available yet', relevant: `${SRC} = ''` },
          { name: 'height', type: 'decimal', label: 'Height (ft)', calculation: `iff(${SRC} != '', ${SRC}, \${elevManual})` },
          { name: 'shift', type: 'select_one', label: 'Shift', required: true, choices: [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }] },
          { name: 'degrees', type: 'integer', label: 'Degrees', default: 0 },
          { name: 'minutes', type: 'integer', label: 'Minutes', default: 0 },
          { name: 'seconds', type: 'integer', label: 'Seconds', default: 0 },
          { name: 'angle', type: 'decimal', label: 'Angle (°)', calculation: 'pntdeg(${shift}, ${degrees}, ${minutes}, ${seconds})' },
          { name: 'check', type: 'text', label: 'Check', calculation: "iff(${angle} = '', '', iff(abs(${angle}) > 0.5, 'CHECK', 'OK'))" },
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
