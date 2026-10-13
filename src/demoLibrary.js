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

export const demoPlaceholders = () => SPEC.map(([title, scope, text, color]) => {
  const s = structuredClone(SAMPLE_SURVEY);
  s.id = `demo-${slug(title)}`; s.title = title; s.scope = scope; s.tile = { text, color }; s.version = 1; s.demo = true;
  s.pages[0].fields.unshift({ name: 'demo_note', type: 'note', label: '<b>Demo placeholder</b> — stands in for the real form; replace it by importing the XLSForm.' });
  return s;
});

export const PREWORK_TILE = { text: 'PREWORK', color: '#a21caf' };
