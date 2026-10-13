// Generates samples/tower-inspection.xlsx — a Survey123-style XLSForm using the question types and appearances
// from the spec. Replace it with your own XLSForm; the importer reads the same sheets (survey / choices / settings).
import XLSX from 'xlsx';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const survey = [
  ['type', 'name', 'label', 'hint', 'required', 'relevant', 'constraint', 'constraint_message', 'calculation', 'default', 'appearance'],
  ['start', 'start'],
  ['end', 'end'],
  ['username', 'inspector_username'],
  ['begin_group', 'site_details', 'Site details'],
  ['text', 'site_id', 'Site ID', 'e.g. TWR-4471', 'yes', '', 'string-length(.) <= 40', 'Site ID must be 40 characters or fewer.'],
  ['dateTime', 'inspection_date', 'Inspection date and time'],
  ['geopoint', 'site_location', 'Site location', '', '', '', '', '', '', '', 'press-to-locate'],
  ['select_one tower_types', 'tower_type', 'Tower type', '', 'yes'],
  ['integer', 'height_ft', 'Structure height (ft)', '', '', '', '. >= 10 and . <= 2000', 'Height must be between 10 and 2000 ft.', '', 150, 'numbers'],
  ['decimal', 'ground_resistance', 'Ground resistance (ohms)', '', '', '', '. >= 0', 'Cannot be negative.'],
  ['end_group'],
  ['begin_group', 'condition', 'Condition'],
  ['select_one yes_no', 'has_damage', 'Any visible damage?', '', 'yes', '', '', '', '', '', 'horizontal'],
  ['text', 'damage_notes', 'Describe the damage', '', 'yes', "${has_damage} = 'yes'", '', '', '', '', 'multiline'],
  ['select_multiple findings', 'findings_list', 'Findings', '', '', '', '', '', '', '', 'minimal'],
  ['note', 'finding_note', 'Photograph every finding below.'],
  ['end_group'],
  ['begin_group', 'photos', 'Photos'],
  ['image', 'site_photos', 'Site photos (camera, gallery or screenshots)', 'Up to 500. Compressed on this phone.', 'yes', '', '', '', '', '', 'multiline'],
  ['image', 'compound_photo', 'Compound overview (rear camera only)', '', '', '', '', '', '', '', 'new-rear'],
  ['calculate', 'photo_count', '', '', '', '', '', '', 'count(${site_photos})'],
  ['end_group'],
  ['begin_group', 'guys', 'Guy wires'],
  ['begin_repeat', 'guy_wire', 'Guy wire'],
  ['text', 'wire_label', 'Label', 'e.g. A-1', 'yes'],
  ['decimal', 'tension_lbf', 'Tension (lbf)', '', '', '', '. > 0', 'Tension must be positive.'],
  ['image', 'wire_photos', 'Wire photos', '', 'yes', '', '', '', '', '', 'multiline'],
  ['end_repeat'],
  ['calculate', 'summary', '', '', '', '', '', '', "concat(${site_id}, ' - ', ${photo_count}, ' photos')"],
  ['end_group'],
  ['begin_group', 'signoff', 'Sign-off'],
  ['image', 'inspector_signature', 'Inspector signature', '', 'yes', '', '', '', '', '', 'signature'],
  ['end_group'],
];
const choices = [
  ['list_name', 'name', 'label'],
  ['tower_types', 'guyed', 'Guyed'], ['tower_types', 'monopole', 'Monopole'], ['tower_types', 'selfsupport', 'Self-support'],
  ['yes_no', 'yes', 'Yes'], ['yes_no', 'no', 'No'],
  ['findings', 'corrosion', 'Corrosion'], ['findings', 'loose', 'Loose hardware'], ['findings', 'paint', 'Paint / marking'], ['findings', 'lighting', 'Lighting outage'],
];
const settings = [['form_title', 'form_id', 'version'], ['Tower Site Inspection (XLSForm)', 'tower_inspection_xls', 2026100801]];

const wb = XLSX.utils.book_new();
for (const [name, rows] of [['survey', survey], ['choices', choices], ['settings', settings]]) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tower-inspection.xlsx');
XLSX.writeFile(wb, out);
console.log('wrote', out);
