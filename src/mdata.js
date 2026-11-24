// Demo content for the FieldSync Mobile prototype: surveys in the Ingress layout (sections → pages → fields), the site list
// and scope names. Placeholder data throughout. The calculation helpers are the same ones the guy-wire work uses.

import { demoCloseout, plumbTwist } from './demoLibrary.js';
import { beta } from './mode.js';

export const STRUCTURE_ID = 'demo-structure-flight';      // its Guy Attachments section holds each guy level's attachment height: the source other surveys pull from
const sec = (section, name, label, fields) => ({ section, name, label, fields });
const yesno = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
const photo = (name, label, o = {}) => ({ name, type: 'image', label, minFiles: 1, maxFiles: 10, ...o });

/** Structure Flight Inspection: the survey on the wireframes (Structure Overview with four tabs, then the other sections). */
export function structureFlight() {
  const small = (section, label, fields) => sec(section, section.toLowerCase().replace(/\W+/g, '_'), label || section, fields);
  return {
    id: 'demo-structure-flight', version: 3, title: 'Structure Flight Inspection', scope: 'Inspection', tile: { text: 'STRUCTURE FLIGHT', color: '#424CCC' }, demo: true,
    pages: [
      sec('Structure Overview', 'site_details', 'Site Details', [
        { name: 'siteId', type: 'text', label: 'Site ID', required: true, check: true },
        { name: 'siteName', type: 'text', label: 'Site name', pull: true },
        { name: 'towerType', type: 'select_one', label: 'Tower type', required: true, check: true, pull: true, appearance: 'horizontal', choices: [{ value: 'guyed', label: 'Guyed' }, { value: 'monopole', label: 'Monopole' }, { value: 'selfsupport', label: 'Self-support' }] },
        { name: 'height', type: 'decimal', label: 'Structure height (ft)', required: true, check: true, pull: true, appearance: 'stepper', constraint: '${.} > 0', constraintMessage: 'Enter a height above zero.' },
        { name: 'gateCode', type: 'text', label: 'Gate code', pull: true },
        { name: 'notes', type: 'text', label: 'Notes', appearance: 'multiline' },
      ]),
      sec('Structure Overview', 'site_photos', 'Site Photos', [
        photo('layoutPhotos', 'Site Layout Photos', { defaultZoom: 0.5, check: true }),
        photo('laserPhotos', 'Laser Distance Photos', { check: true }),
        { name: 'horizonNote', type: 'note', label: '<b>Horizon Photos</b><br>Four cardinal-direction shots from the top' },
        photo('horizonPhotos', 'Horizon Photos', { minFiles: 4, maxFiles: 8, check: true }),
      ]),
      sec('Structure Overview', 'top_beacon', 'Top Beacon', [
        { name: 'beacon', type: 'select_one', label: 'Top beacon working?', required: true, check: true, appearance: 'horizontal', choices: yesno },
        photo('beaconPhotos', 'Top beacon photos', { minFiles: 0, maxFiles: 4 }),
      ]),
      sec('Structure Overview', 'lightning', 'Lightning Protection', [
        { name: 'lightning', type: 'select_one', label: 'Lightning rod present?', required: true, check: true, appearance: 'horizontal', choices: yesno },
        photo('lightningPhotos', 'Lightning protection photos', { minFiles: 0, maxFiles: 4 }),
      ]),
      small('Safety Climb', '', [{ name: 'climb', type: 'select_one', label: 'Safety climb installed?', required: true, check: true, appearance: 'horizontal', choices: yesno }, photo('climbPhotos', 'Safety climb photos', { minFiles: 0, maxFiles: 4 })]),
      small('Taper Changes', '', [{ name: 'tapers', type: 'integer', label: 'Number of taper changes', default: 0, appearance: 'stepper' }]),
      small('Deficiencies', '', [{ name: 'deficiencies', type: 'select_multiple', label: 'Deficiencies seen', appearance: 'dropdown', choices: [{ value: 'corrosion', label: 'Corrosion' }, { value: 'loose', label: 'Loose hardware' }, { value: 'paint', label: 'Paint / marking' }, { value: 'light', label: 'Lighting outage' }] }]),
      small('Structure Base & Foundation', '', [{ name: 'base', type: 'select_one', label: 'Base condition', required: true, check: true, appearance: 'horizontal', choices: [{ value: 'good', label: 'Good' }, { value: 'fair', label: 'Fair' }, { value: 'poor', label: 'Poor' }] }]),
      small('Ground Leads', '', [{ name: 'ground', type: 'select_one', label: 'Ground leads intact?', appearance: 'horizontal', choices: yesno }]),
      small('Guy Attachments', '', [
        { name: 'guyLevels', type: 'repeat', label: 'Guy level', addLabel: 'Add guy level', appearance: 'cards-grid', fields: [
          { name: 'level', type: 'integer', label: 'Level', required: true, constraint: '${.} > 0', constraintMessage: 'Levels start at 1.' },
          { name: 'elevation', type: 'decimal', label: 'Attachment height (ft)', required: true, hint: 'Measured by the climber. Guy Facilities and Plumb & Twist pull it.', constraint: '${.} > 0', constraintMessage: 'Enter a height above zero.' },
        ] },
        { name: 'anchors', type: 'repeat', label: 'Anchor', addLabel: 'Add anchor', fields: [
          { name: 'anchor', type: 'text', label: 'Anchor', required: true, hint: 'e.g. Anchor B' },
          photo('anchorPhoto', 'Anchor photo', { minFiles: 1, maxFiles: 3 }),
        ] },
      ]),
      small('Mount Centerlines', '', [
        { name: 'mounts', type: 'repeat', label: 'Mount call-out', addLabel: 'Add call-out', fields: [
          { name: 'mount', type: 'text', label: 'Mount', required: true, hint: 'e.g. Mount 153' },
          photo('mountPhoto', 'Call-out photo', { minFiles: 1, maxFiles: 3 }),
        ] },
      ]),
    ],
  };
}

/** Guy Facilities: compounds A, B and C, each with measurements and wires as cards. Tension limits and cable length use the
 *  guy calculations (cable length is the real formula; the limits are placeholders). Heights come from the structure survey. */
export function guyFacilities() { return mvpTrim(guyFacilitiesFull()); }
/** MVP: calculations in the field and the guided camera are not in the baseline app, so those fields are not part of the survey. */
const BETA_FIELDS = new Set(['expectedPreform', 'preformFlag', 'elevManual', 'attachElev', 'elevSource', 'wireLength', 'minT', 'maxT', 'check', 'calcNote', 'flag', 'breakingStrength', 'pullNote']);
function mvpTrim(sv) {
  if (beta()) return sv;
  const keep = (f) => !BETA_FIELDS.has(f.name) && !f.guidedFor;
  const walk = (fields) => fields.filter(keep).map((f) => (f.fields ? { ...f, fields: walk(f.fields) } : f));
  return { ...sv, pages: sv.pages.map((p) => ({ ...p, fields: walk(p.fields) })) };
}
function guyFacilitiesFull() {
  const SRC = 'sitelevel(${siteId}, ${level})';
  const wires = (c) => ({ name: `wires${c}`, type: 'repeat', label: 'Level', addLabel: 'Add wire', appearance: 'cards-grid', numbered: true, fields: [
    { name: 'level', type: 'integer', label: 'Level', required: true, increment: true, constraint: '${.} > 0', constraintMessage: 'Levels start at 1.' },
    { name: 'pos', type: 'select_one', label: 'Pos.', appearance: 'dropdown', choices: [{ value: 'PO', label: 'PO' }, { value: 'PI', label: 'PI' }] },
    // caliper and preform together: one tool in hand at a time, tension is separate
    { name: 'hdrA', type: 'note', label: '<b>Dead end group &amp; color</b>' },
    { name: 'size', type: 'select_one', label: 'Size (# strands)', appearance: 'dropdown', carry: true, choices: [{ value: '7/16 · 7', label: '7/16 · 7' }, { value: '3/8 · 7', label: '3/8 · 7' }] },
    { name: 'strength', type: 'select_one', label: 'Strength', appearance: 'dropdown', carry: true, choices: [{ value: 'EHS', label: 'EHS' }, { value: 'BS', label: 'BS' }] },
    { name: 'preform', type: 'select_one', label: 'Preform color', appearance: 'dropdown', carry: true, choices: [{ value: 'Green', label: 'Green' }, { value: 'Red', label: 'Red' }, { value: 'Blue', label: 'Blue' }, { value: 'None', label: 'No preform' }] },
    { name: 'expectedPreform', type: 'calculate', calculation: "iff(${strength} = 'EHS', 'Green', iff(${strength} = 'BS', 'Red', ''))" },
    { name: 'preformFlag', type: 'note', label: '<b>Check the preform:</b> ${strength} wire is expected to have ${expectedPreform} (placeholder rule until the crew’s list arrives). This one is ${preform}. Call it out?', relevant: "${expectedPreform} != '' and ${preform} != '' and ${preform} != 'None' and ${preform} != ${expectedPreform}" },
    photo('caliperPhoto', 'Dead end group photos', { minFiles: 1, maxFiles: 6, slot: 'dead end group', hint: 'Take or choose several if needed' }),
    photo('preformPhoto', 'Color photos', { minFiles: 1, maxFiles: 6, slot: 'color', relevant: "${preform} != 'None'" }),
    { name: 'hdrB', type: 'note', label: '<b>Tension</b>' },
    { name: 'tension', type: 'decimal', label: 'Tension (lbf)' },
    photo('tensionPhoto', 'Tension photos', { minFiles: 1, maxFiles: 6, slot: 'tension' }),
    { name: 'breakingStrength', type: 'decimal', label: 'Breaking strength (lbf)', default: 6650, hint: '3/8" EHS = 6650' },
    { name: 'elevManual', type: 'decimal', label: 'Attachment height (ft): type it', hint: 'The structure survey for this site is not available yet', relevant: `${SRC} = ''` },
    { name: 'attachElev', type: 'calculate', calculation: `iff(${SRC} != '', ${SRC}, \${elevManual})` },
    { name: 'elevSource', type: 'calculate', calculation: `iff(${SRC} != '', 'Structure survey', iff(string(\${elevManual}) != '', 'Typed in', 'Waiting: the web app will process'))` },
    { name: 'wireLength', type: 'calculate', calculation: `guychord(\${radius${c}}, \${attachElev}, \${drop${c}})` },
    { name: 'minT', type: 'calculate', calculation: 'guymin(${breakingStrength})' },
    { name: 'maxT', type: 'calculate', calculation: 'guymax(${breakingStrength})' },
    { name: 'check', type: 'calculate', calculation: "iff(${wireLength} = '', '', guystatus(${tension}, ${minT}, ${maxT}))" },
    { name: 'calcNote', type: 'note', label: 'Cable length ${wireLength} ft · allowed ${minT}–${maxT} lbf · height from ${elevSource}', relevant: "${wireLength} != ''" },
    { name: 'flag', type: 'note', label: '<b>Tension is out of range</b>: re-measure before leaving site.', relevant: "${check} = 'LOW' or ${check} = 'HIGH'" },
  ] });
  const compound = (c) => sec('Guy Compounds', `compound_${c}`, `Compound ${c.toUpperCase()}`, [
    { name: `radius${c}`, type: 'decimal', label: 'Anchor Radius (ft)', appearance: 'stepper', check: true, required: true, hint: 'Measured from the base', constraint: '${.} > 0', constraintMessage: 'Enter a distance above zero.' },
    { name: `drop${c}`, type: 'decimal', label: 'Relative Elevation (ft)', appearance: 'stepper', check: true, default: 0, hint: 'Negative if the anchor is below the base' },
    wires(c),
    { name: `guided${c}`, type: 'note', label: 'Guided photos', guidedFor: c },
    photo(`anchorPhotos${c}`, `Anchor ${c.toUpperCase()} photos`, { minFiles: 0, maxFiles: 16, hint: 'Left, right, back, heads, rod and torque arms. The guided camera files each one.' }),
  ]);
  return {
    id: 'demo-guy-facilities', version: 3, title: 'Guy Facilities Inspection', scope: 'Inspection', tile: { text: 'GUY FACILITIES', color: '#1F6FB5' }, demo: true,
    pages: [
      sec('Site', 'site', 'Site', [
        { name: 'siteId', type: 'text', label: 'Site ID', required: true, check: true },
        { name: 'siteName', type: 'text', label: 'Site name', pull: true },
        { name: 'towerType', type: 'select_one', label: 'Tower type', pull: true, appearance: 'horizontal', choices: [{ value: 'guyed', label: 'Guyed' }, { value: 'monopole', label: 'Monopole' }, { value: 'selfsupport', label: 'Self-support' }] },
        { name: 'height', type: 'decimal', label: 'Structure height (ft)', pull: true },
        { name: 'notes', type: 'text', label: 'Notes', appearance: 'multiline' },
        { name: 'temperature', type: 'decimal', label: 'Air temperature (°F)', hint: 'Used for the tension limits' },
        { name: 'pullNote', type: 'note', label: '<b>Attachment heights</b> come from the structure survey for this site when it is on this phone or the server. If not, type them in each wire. Anything still missing is processed in the web app.' },
      ]),
      compound('a'), compound('b'), compound('c'),
      sec('Deficiencies', 'deficiencies', 'Deficiencies', [{ name: 'defs', type: 'text', label: 'Notes', appearance: 'multiline' }]),
    ],
  };
}

/** Compound Inspection: "Gate and lock": required on site, so N/A and Could not record exist instead of blanks. */
export function compound() {
  return {
    id: 'demo-compound', version: 3, title: 'Compound Inspection', scope: 'Inspection', tile: { text: 'COMPOUND', color: '#6B75E8' }, demo: true,
    pages: [
      sec('Gate and lock', 'site_details', 'Site Details', [
        { name: 'siteId', type: 'text', label: 'Site ID', required: true, check: true },
        { name: 'siteName', type: 'text', label: 'Site name', pull: true },
        { name: 'gateCode', type: 'text', label: 'Gate code', required: true, check: true, pull: true },
        { name: 'lockType', type: 'text', label: 'Lock type', required: true, check: true, pull: true },
        { name: 'combination', type: 'text', label: 'Combination', required: true, check: true, pull: true },
      ]),
      sec('Gate and lock', 'site_photos', 'Site Photos', [photo('compoundPhotos', 'Compound photos', { minFiles: 2, maxFiles: 20, check: true })]),
      sec('Gate and lock', 'access_road', 'Access Road', [{ name: 'road', type: 'select_one', label: 'Access road condition', appearance: 'horizontal', choices: [{ value: 'good', label: 'Good' }, { value: 'fair', label: 'Fair' }, { value: 'poor', label: 'Poor' }] }]),
    ],
  };
}

/** Closeout surveys: hundreds of photos. */
export function closeout(title, id, scope, color) {
  const d = demoCloseout();
  return { ...d, id, title, scope, tile: { text: scope.includes('Verizon') ? 'VERIZON' : 'TMO', color }, demo: true, version: 3,
    pages: [sec('Closeout', 'site', 'Site', [{ name: 'siteId', type: 'text', label: 'Site ID', required: true, check: true }]),
      sec('Closeout', 'photos', 'Photos', [photo('wideShots', 'Wide shots', { defaultZoom: 0.5, minFiles: 1, maxFiles: 500, check: true }), photo('closeUps', 'Close-ups', { minFiles: 1, maxFiles: 500, check: true })])] };
}

/** Job Safety Analysis: a start page where nearby services and weather are looked up and never block the form (m35). */
export function jsa() {
  return {
    id: 'demo-jsa', version: 3, title: 'Job Safety Analysis', scope: 'Safety', tile: { text: 'JSA', color: '#9A5200' }, demo: true,
    pages: [sec('Job Safety Analysis', 'start', 'Start', [
      { name: 'startNow', type: 'note', label: '<b>You can start now.</b><br>These fill in when the lookups finish.' },
      { name: 'siteId', type: 'text', label: 'Site', required: true, check: true },
      { name: 'location', type: 'geopoint', label: 'Location', default: { lat: 41.77, lon: -93.71 } },
      { name: 'hospital', type: 'text', label: 'Nearest hospital', appearance: 'lookup', sticky: true, calculation: "pulldata('@javascript', 'places.js', 'nearestHospital', pulldata('@geopoint', ${location}, 'y'), pulldata('@geopoint', ${location}, 'x'))" },
      { name: 'fire', type: 'text', label: 'Nearest fire station', appearance: 'lookup', sticky: true, calculation: "pulldata('@javascript', 'places.js', 'nearestFire', pulldata('@geopoint', ${location}, 'y'), pulldata('@geopoint', ${location}, 'x'))" },
      { name: 'weatherNow', type: 'text', label: 'Weather', appearance: 'lookup', sticky: true, calculation: "pulldata('@javascript', 'places.js', 'weatherNow', pulldata('@geopoint', ${location}, 'y'), pulldata('@geopoint', ${location}, 'x'))" },
      { name: 'hazards', type: 'text', label: 'Hazards on site', appearance: 'multiline' },
    ])],
  };
}

export const mobileLibrary = () => [
  structureFlight(), guyFacilities(), compound(),
  { ...plumbTwist(), id: 'demo-plumb-twist', title: 'Plumb & Twist', version: 3, scope: 'Inspection', tile: { text: 'PLUMB & TWIST', color: '#7C3AED' } },
  closeout('TMO closeout', 'demo-tmo-closeout', 'TMO CONS MOD Closeout', '#E20074'),
  closeout('Verizon closeout', 'demo-verizon-closeout', 'Verizon CONS MOD Closeout', '#CD040B'),
  consmod('demo-consmod-prework', 'CONS-MOD Prework Inspection', '#A21CAF', 'PREWORK'), consmod('demo-consmod-sector', 'CONS-MOD Sector COP', '#EA580C', 'SECTOR COP'), consmod('demo-consmod-ground', 'CONS-MOD Ground COP', '#16A34A', 'GROUND COP'),
  jsa(), addon('demo-daily-update', 'Daily Update', 'Reporting', 'DAILY UPDATE', '#0E7C86'), addon('demo-rigging', 'Rigging Inspection', 'Rigging', 'RIGGING', '#B45309'),
];

/** Work done alongside an inspection or closeout: it is added to the site visit rather than being part of a scope of work. Placeholder content. */
function addon(id, title, scope, text, color) {
  return { id, version: 3, title, scope, tile: { text, color }, demo: true, pages: [sec(title, 'main', 'Details', [
    { name: 'siteId', type: 'text', label: 'Site', required: true, check: true }, { name: 'notes', type: 'text', label: 'Notes', appearance: 'multiline' }, photo('photos', 'Photos', { minFiles: 0, maxFiles: 20 })])] };
}

/** CONS-MOD workflow: Prework, Sector COP and Ground COP are all required for the visit. Placeholder content. */
function consmod(id, title, color, text) {
  return { id, version: 3, title, scope: 'CONS-MOD', tile: { text, color }, demo: true, pages: [
    sec('Site', 'site', 'Site Details', [{ name: 'siteId', type: 'text', label: 'Site ID', required: true, check: true }, { name: 'siteName', type: 'text', label: 'Site name', pull: true }, { name: 'gateCode', type: 'text', label: 'Gate code', pull: true }, { name: 'demo_note', type: 'note', label: '<b>Placeholder.</b> Stands in for the real form until it is imported.' }, { name: 'notes', type: 'text', label: 'Notes', appearance: 'multiline' }]),
    sec('Site', 'photos', 'Photos', [photo('photos', 'Photos', { minFiles: 2, maxFiles: 50, check: true })]),
  ] };
}
export const SITES = [
  { id: 'TX-4412', name: 'Cedar Hill', note: 'Nearby', lat: 32.59, lon: -96.96 },
  { id: 'TX-3081', name: 'Site name', note: 'Recent', lat: 32.8, lon: -96.8 },
  { id: 'TX-2210', name: 'Site name', note: 'Recent', lat: 31.9, lon: -97.1 },
  { id: 'IA-1', name: 'Polk City', note: 'Assigned', lat: 41.77, lon: -93.71 },
  { id: 'LA-21', name: 'Winnfield', note: 'Assigned', lat: 31.92, lon: -92.64 },
  { id: 'T081105', name: 'Hiawatha', note: 'Assigned', lat: 42.03, lon: -91.68 }, { id: 'SD-1526', name: 'Mound City', note: 'Open visit', lat: 45.73, lon: -100.06 }, { id: 'TX-171', name: 'Stonewall', note: 'Open visit', lat: 30.21, lon: -98.65 }, { id: 'US654263', name: 'Delta', note: 'Open visit', lat: 39.35, lon: -108.07 }, { id: 'OK-3310', name: 'Fairview', note: 'Assigned', lat: 36.27, lon: -98.48 }, { id: 'OK-0912', name: 'Marlow', note: 'Assigned', lat: 34.65, lon: -97.96 },
];
