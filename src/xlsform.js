// XLSForm (Survey123 Connect / ODK) → our survey JSON.
//   survey sheet:   type | name | label | hint | required | relevant | constraint | constraint_message | calculation | default | appearance
//   choices sheet:  list_name | name | label
//   settings sheet: form_title | form_id | version
// Anything we can't honour is reported as a warning with its spreadsheet row, never silently dropped.

import { probe } from './expr.js';

/** Minimal CSV reader for select_one_from_file lists (columns: name,label — header row required). */
export function parseCsv(text) {
  const rows = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim()).map((l) => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((c) => c.trim()); });
  const head = (rows.shift() || []).map((h) => h.toLowerCase());
  const ni = Math.max(0, head.indexOf('name')), li = head.indexOf('label') >= 0 ? head.indexOf('label') : head.indexOf('name') >= 0 ? head.indexOf('name') : 1;
  return rows.map((r) => ({ value: r[ni], label: r[li] || r[ni] })).filter((c) => c.value !== undefined && c.value !== '');
}

const truthy = (v) => /^(yes|true|true\(\)|1)$/i.test(String(v).trim());
const str = (v) => (v == null ? '' : String(v).trim());

/** Lower-case column names; `label::English (en)` → `label` (first language wins). */
function normaliseRows(rows) {
  return rows.map((r) => {
    const o = {};
    for (const [k, v] of Object.entries(r)) {
      const key = k.trim().toLowerCase().replace(/::.*$/, (m) => (m.startsWith('::esri') ? m : ''));
      if (!(key in o) || o[key] === '') o[key] = v;
    }
    return o;
  });
}

const stripTags = (s) => String(s ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// Typical field-form palette (Survey123 style panel): light-cyan header/footer with dark text, dark body with light text, light inputs.
/** Scope of work: an explicit `scope` (or `tags`) setting wins; otherwise a best guess from the title. Editable later by an admin. */
export function inferScope(title) {
  const t = String(title || '');
  if (/^CONS-?MOD\b/i.test(t)) return 'CONS-MOD';
  if (/\bCOP\b|close-?out/i.test(t)) return 'COP';
  if (/inspection|^FS\b/i.test(t)) return 'Inspections';
  return 'Other';
}

export const DEFAULT_THEME = {
  primary: '#7dd3e8', onPrimary: '#002832',
  headerBg: '#b4f2fe', headerFont: '#002832', footerBg: '#b4f2fe',
  background: '#002832', bodyText: '#b4f2fe', fieldFill: '#002832',
  inputText: '#002832', inputBackground: '#ebfefb',
  bodyFont: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
};

const META = {
  start: { type: 'dateTime', default: 'now' },
  end: { type: 'dateTime', autoEnd: true },
  today: { type: 'dateTime', default: 'now' },
  username: { type: 'text', autoMeta: 'username' },
  deviceid: { type: 'text', autoMeta: 'deviceid' },
  email: { type: 'text', autoMeta: 'email' },
};

export function convertXlsForm({ survey: surveyRows, choices: choiceRows = [], settings: settingsRows = [] }, { files = {} } = {}) {
  const warnings = [];
  const warn = (row, msg) => warnings.push({ row, message: msg });

  const lists = {};
  normaliseRows(choiceRows).forEach((c, i) => {
    const l = str(c.list_name), n = str(c.name);
    if (!l || n === '') return;
    (lists[l] ||= []).push({ value: n, label: str(c.label) || n });
    if (c.filter || c['choice_filter']) warn(i + 2, `Choice filter on list "${l}" is not supported (all choices are shown).`);
  });

  const st = normaliseRows(settingsRows)[0] || {};
  const root = { id: str(st.form_id) || 'imported-survey', version: Number(String(st.version || '').replace(/\D/g, '')) || 1, title: str(st.form_title) || str(st.title) || 'Imported survey', instanceName: str(st.instance_name) || undefined, theme: { ...DEFAULT_THEME }, pages: [] };

  // container stack: page | group | repeat
  const stack = [];
  let loose = null;
  const sink = () => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].kind === 'repeat' || stack[i].kind === 'page') return stack[i].fields;
    if (!loose) { loose = { name: `page${root.pages.length + 1}`, label: root.pages.length ? 'More questions' : 'Survey', fields: [] }; root.pages.push(loose); }
    return loose.fields;
  };

  const rows = normaliseRows(surveyRows);
  rows.forEach((r, idx) => {
    const row = idx + 2;
    const rawType = str(r.type);
    if (!rawType || rawType.startsWith('#')) return;
    const typeKey = rawType.replace(/\s+/g, ' ').trim();
    const [t0, listName] = typeKey.split(' ');
    const t = t0.toLowerCase().replace(/^begin$/, 'begin_' + (typeKey.split(' ')[1] || '')).replace(/^end$/, 'end_' + (typeKey.split(' ')[1] || ''));
    const type = typeKey.toLowerCase().replace(/^(begin|end) (group|repeat)$/, '$1_$2');
    let name = str(r.name);
    const label = str(r.label) || name;
    if (!name && /^note$/i.test(typeKey)) name = `note_${row}`;
    const appearance = str(r.appearance).toLowerCase();
    const apps = appearance.split(/\s+/).filter(Boolean);
    const has = (a) => apps.includes(a);

    // ---- containers -------------------------------------------------------------------------
    if (type === 'begin_group') {
      if (!stack.length) { loose = null; const page = { name: name || `page${root.pages.length + 1}`, label, fields: [] }; root.pages.push(page); stack.push({ kind: 'page', fields: page.fields }); }
      else { sink().push({ name: `${name || 'group'}_heading`, type: 'note', label }); stack.push({ kind: 'group' }); }
      if (has('hidden')) warn(row, `Group "${name}" has appearance "hidden"; its questions will still be shown.`);
      return;
    }
    if (type === 'end_group') { if (!stack.length) warn(row, 'end_group without a matching begin_group.'); else stack.pop(); return; }
    if (type === 'begin_repeat') {
      const field = { name, type: 'repeat', label, addLabel: `Add ${stripTags(label).toLowerCase()}`, fields: [] };
      if (str(r.relevant)) field.relevant = str(r.relevant);
      if (str(r.repeat_count)) {
        const n = Number(str(r.repeat_count));
        if (Number.isInteger(n) && n > 0) { field.repeatCount = n; field.minRepeat = n; }
        else warn(row, `repeat_count on "${name}" is an expression ("${str(r.repeat_count)}"); users add entries with a button instead.`);
      }
      sink().push(field); stack.push({ kind: 'repeat', fields: field.fields });
      return;
    }
    if (type === 'end_repeat') { if (!stack.length) warn(row, 'end_repeat without a matching begin_repeat.'); else stack.pop(); return; }

    // ---- fields ---------------------------------------------------------------------------------
    const f = { name, type: 'text', label };
    if (!name) return warn(row, `Row has type "${rawType}" but no name; skipped.`);
    if (str(r.hint)) f.hint = str(r.hint);
    if (truthy(r.required)) f.required = true;
    if (str(r.relevant)) f.relevant = str(r.relevant);
    if (str(r.constraint)) f.constraint = str(r.constraint);
    if (str(r.constraint_message)) f.constraintMessage = str(r.constraint_message);
    if (str(r.required_message)) f.requiredMessage = str(r.required_message);
    if (str(r.default) !== '') f.default = /^-?\d+(\.\d+)?$/.test(str(r.default)) ? Number(r.default) : str(r.default);
    if (truthy(r.read_only) || truthy(r.readonly)) f.readOnly = true;
    if (str(r.calculation) && !/^calculate$/i.test(typeKey)) f.calculation = str(r.calculation);
    const par = str(r.parameters) || str(r['bind::esri:parameters']);
    const fnm = par.match(/fileName=(.+)$/s);
    if (fnm) f.fileName = fnm[1].trim();
    if (/pulldata\(/.test(f.calculation || r.calculation || '')) f.sticky = true;
    if (str(r.choice_filter)) warn(row, `choice_filter on "${name}" is not supported.`);

    const base = type.split(' ')[0];
    if (META[base]) {
      Object.assign(f, META[base], { appearance: 'hidden', label: name });
      if (['username', 'email'].includes(base)) warn(row, `"${base}" is an ArcGIS member lookup in Survey123; here it is filled from the device user's name (email stays blank).`);
    } else switch (base) {
      case 'text': f.type = 'text'; if (has('multiline')) f.appearance = 'multiline'; break;
      case 'integer': f.type = 'integer'; break;
      case 'decimal': f.type = 'decimal'; break;
      case 'range': f.type = 'integer'; break;
      case 'date': f.type = 'dateTime'; f.dateOnly = true; break;
      case 'datetime': f.type = 'dateTime'; break;
      case 'time': f.type = 'text'; warn(row, `"time" questions are shown as text.`); break;
      case 'geopoint': f.type = 'geopoint'; break;
      case 'geotrace': case 'geoshape': return warn(row, `${base} ("${name}") is not supported in the MVP; skipped.`);
      case 'select_one': case 'select_multiple':
        f.type = base; f.choices = lists[listName] || [];
        if (!lists[listName]) warn(row, `"${name}" uses choice list "${listName}" which is missing from the choices sheet.`);
        if (has('minimal')) f.appearance = 'dropdown'; else if (apps.some((a) => /^(compact|horizontal)/.test(a))) f.appearance = 'horizontal';
        if (apps.includes('autocomplete')) f.appearance = 'autocomplete';
        const srch = appearance.match(/search\(\s*\$\{(\w+)\}\s*\)/);
        if (srch) {
          const src = rows.find((rr) => str(rr.name) === srch[1]);
          if (/identity\/organization/i.test(str(src?.calculation))) { f.choicesFrom = 'organizations'; f.choices = []; f.appearance = 'autocomplete'; }   // the user's own organizations, from the identity service
          else { f.type = 'text'; delete f.choices; delete f.appearance; warn(row, `"${name}" fills its choices from a live service (${appearance.match(/search\([^)]*\)/)?.[0]}) that this app does not know; it is a text box.`); }
        }
        break;
      case 'select_one_from_file': case 'select_multiple_from_file': {
        f.type = base.replace('_from_file', '');
        const csv = files[listName] ?? files[String(listName).toLowerCase()];
        if (csv == null) { f.choices = [{ value: 'other', label: 'Other' }]; warn(row, `"${name}" reads its choices from "${listName}", which was not provided — add the CSV when importing (using a single "Other" choice for now).`); }
        else f.choices = parseCsv(csv);
        if (apps.some((a) => /^autocomplete$|^search\(/.test(a))) f.appearance = 'autocomplete';
        break;
      }
      case 'image': case 'file':
        f.type = 'image';
        if (base === 'file') warn(row, `"file" question "${name}" is treated as an image/photo question.`);
        if (has('signature')) { f.appearance = 'signature'; f.maxFiles = 1; }
        else { f.appearance = has('new-rear') || has('new') || has('camera') ? 'camera' : 'both'; if (!has('multiline')) f.maxFiles = 1; }
        if (f.required) f.minFiles = 1;
        break;
      case 'audio': case 'video': return warn(row, `${base} ("${name}") is not supported in the MVP; skipped.`);
      case 'barcode': f.type = 'text'; warn(row, `barcode ("${name}") is shown as a text box; scanning is not in the MVP.`); break;
      case 'note': f.type = 'note'; delete f.required; break;
      case 'calculate': f.type = 'calculate'; f.calculation = str(r.calculation); delete f.label; if (!f.calculation) warn(row, `calculate "${name}" has no calculation.`); break;
      case 'acknowledge': f.type = 'select_one'; f.choices = [{ value: 'OK', label: 'OK' }]; break;
      default: warn(row, `Unknown question type "${rawType}" for "${name}"; skipped.`); return;
    }
    if (has('hidden') && f.appearance !== 'hidden') f.appearance = 'hidden';
    if (f.type === 'integer' || f.type === 'decimal') { if (has('calculator')) warn(row, `calculator appearance on "${name}" is not supported; a number keypad is used.`); if (has('numbers')) f.appearance = f.appearance || 'numbers'; }
    if (f.type === 'select_multiple' && typeof f.default === 'string') f.default = f.default.split(',').map((x) => x.trim()).filter(Boolean);
    if (f.type === 'dateTime' && /^(today|now)\(\)$/i.test(String(f.default || ''))) f.default = 'now';
    if (f.type === 'note' && f.calculation) { f.type = 'calculate'; f.appearance = 'hidden'; }
    const known = ['autocomplete', 'minimal', 'compact', 'horizontal', 'horizontal-compact', 'multiline', 'signature', 'new-rear', 'new', 'camera', 'hidden', 'field-list', 'numbers', 'calculator', 'predictivetext', 'press-to-locate', 'quick'];
    const odd = apps.filter((a) => !known.includes(a) && !/^compact-\d+$/.test(a) && !/^search\(/.test(a));
    if (odd.length) warn(row, `Appearance "${odd.join(' ')}" on "${name}" is ignored.`);

    for (const k of ['relevant', 'constraint', 'calculation']) {
      if (f[k]) { const bad = probe(f[k]); if (bad) warn(row, `${k} of "${name}": ${bad}. This rule will not be enforced.`); }
    }
    sink().push(f);
  });

  if (stack.length) warn(rows.length + 1, `${stack.length} group/repeat was never closed (missing end_group / end_repeat).`);
  // pages that hold only hidden fields (start/end/username at the top of the sheet) fold into the next page
  for (const p of root.pages) p.label = stripTags(p.label);
  const hiddenOnly = (p) => p.fields.length && p.fields.every((f) => f.appearance === 'hidden' || f.type === 'calculate');
  for (let i = 0; i < root.pages.length; i++) {
    if (hiddenOnly(root.pages[i]) && root.pages.length > 1) {
      const target = root.pages[i + 1] || root.pages[i - 1];
      target.fields = i + 1 < root.pages.length ? [...root.pages[i].fields, ...target.fields] : [...target.fields, ...root.pages[i].fields];
      root.pages.splice(i--, 1);
    }
  }
  root.pages = root.pages.filter((p) => p.fields.length);
  root.scope = str(st.scope) || str(st.tags) || inferScope(root.title);
  if (!root.pages.length) warn(0, 'No questions were found. Is the sheet named "survey"?');
  return { survey: root, warnings };
}

/** Read a workbook (ArrayBuffer / Uint8Array) with SheetJS and convert it. `XLSX` is injected so Node and browser share this code. */
export function convertWorkbook(XLSX, data, opts) {
  const wb = XLSX.read(data, { type: 'array' });
  const sheet = (name) => {
    const key = wb.SheetNames.find((n) => n.trim().toLowerCase() === name);
    return key ? XLSX.utils.sheet_to_json(wb.Sheets[key], { defval: '' }) : [];
  };
  const out = convertXlsForm({ survey: sheet('survey'), choices: sheet('choices'), settings: sheet('settings') }, opts);
  if (!wb.SheetNames.some((n) => n.trim().toLowerCase() === 'survey')) out.warnings.unshift({ row: 0, message: `No sheet named "survey" (found: ${wb.SheetNames.join(', ')}).` });
  return out;
}

let xlsxPromise;
/** Browser: load the vendored SheetJS build on first use (works offline once cached). */
export function loadSheetJS() {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  xlsxPromise ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/xlsx.mini.min.js', import.meta.url).href;
    s.onload = () => res(globalThis.XLSX); s.onerror = () => rej(new Error('Could not load the spreadsheet reader.'));
    document.head.append(s);
  });
  return xlsxPromise;
}
