import { compile, probe } from './expr.js';

export const TYPES = ['text', 'integer', 'decimal', 'select_one', 'select_multiple', 'image', 'dateTime', 'geopoint', 'calculate', 'note', 'repeat'];

/** Label for error messages: no HTML, no ${refs}, no trailing colon. */
export const cleanLabel = (t) => String(t ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/\$\{[\w.]+\}/g, '…').replace(/&amp;/g, '&').replace(/\s+/g, ' ').replace(/\s*:\s*$/, '').trim();

export const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

// ---- expression scope --------------------------------------------------------------------------
// root = top-level answers; item = current repeat instance (or root); self = value of the field being evaluated
export const scopeOf = (root, item, name, self) => ({ root, item, self: self !== undefined ? self : (item || root)[name] });

function lookup(scope, name) {
  if (name === '.') return scope.self;
  if (scope.item && Object.prototype.hasOwnProperty.call(scope.item, name)) return scope.item[name];
  return scope.root[name];
}

export function ev(expr, scope, fallback) {
  if (expr == null || expr === '') return fallback;
  try { return compile(expr)((n) => lookup(scope, n)); } catch { return fallback; }
}

export const isRelevant = (f, scope) => (f.relevant ? !!ev(f.relevant, scope, true) : true);

// ---- developer-facing JSON check ----------------------------------------------------------------
export function checkSurvey(s) {
  const problems = [];
  const add = (path, message) => problems.push({ path, message });
  if (!s || typeof s !== 'object' || Array.isArray(s)) return [{ path: '$', message: 'Survey must be a JSON object' }];
  if (!s.id) add('id', 'id is required');
  if (!s.title) add('title', 'title is required');
  if (!Number.isInteger(s.version)) add('version', 'version must be an integer (submissions are locked to it)');
  if (!Array.isArray(s.pages) || !s.pages.length) { add('pages', 'pages must be a non-empty array'); return problems; }

  const rootNames = new Set();
  const checkFields = (fields, path, seen) => {
    if (!Array.isArray(fields)) return add(path, 'fields must be an array');
    fields.forEach((f, i) => {
      const p = `${path}[${i}]`;
      if (!f || typeof f !== 'object') return add(p, 'field must be an object');
      if (!f.name || !/^[A-Za-z_]\w*$/.test(f.name)) add(`${p}.name`, 'name must be an identifier (letters, digits, _)');
      else if (seen.has(f.name)) add(`${p}.name`, `duplicate name "${f.name}"`);
      seen.add(f.name);
      if (!TYPES.includes(f.type)) return add(`${p}.type`, `unknown type "${f.type}" (use: ${TYPES.join(', ')})`);
      if (!['calculate', 'repeat'].includes(f.type) && !f.label) add(`${p}.label`, 'label is required');
      if (['select_one', 'select_multiple'].includes(f.type) && !f.choicesFrom && !(Array.isArray(f.choices) && f.choices.length)) add(`${p}.choices`, 'choices must be a non-empty array of {value,label}');
      if (f.type === 'calculate' && !f.calculation) add(`${p}.calculation`, 'calculation expression is required');
      if (f.minFiles != null && f.maxFiles != null && f.minFiles > f.maxFiles) add(`${p}.minFiles`, 'minFiles is greater than maxFiles');
      if (f.type === 'repeat') checkFields(f.fields, `${p}.fields`, new Set());
      for (const k of ['relevant', 'constraint', 'calculation']) {
        if (f[k]) { const bad = probe(f[k]); if (bad) add(`${p}.${k}`, bad); }
      }
    });
  };
  s.pages.forEach((pg, i) => {
    if (!pg.name) add(`pages[${i}].name`, 'page name is required');
    checkFields(pg.fields, `pages[${i}].fields`, rootNames);
  });
  return problems;
}

// ---- answers ------------------------------------------------------------------------------------
const localNow = () => {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export function applyDefaults(fields, item, device) {
  for (const f of fields) {
    if (f.autoMeta && item[f.name] === undefined) item[f.name] = f.autoMeta === 'username' ? device?.name || '' : f.autoMeta === 'deviceid' ? device?.id || '' : '';
    if (f.default !== undefined && item[f.name] === undefined) item[f.name] = f.default === 'now' && f.type === 'dateTime' ? localNow() : f.default;
    if (f.type === 'image' && !item[f.name]) item[f.name] = [];
    if (f.type === 'repeat' && f.repeatCount && !item[f.name]) {                // XLSForm repeat_count: a fixed number of entries
      item[f.name] = Array.from({ length: f.repeatCount }, () => { const it = { _id: globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) }; applyDefaults(f.fields, it, device); return it; });
    }
  }
}

export function newAnswers(survey, device) {
  const a = {};
  survey.pages.forEach((p) => applyDefaults(p.fields, a, device));
  recalc(survey, a);
  return a;
}

/** Stamp end-of-survey fields (XLSForm `end`) at submit time. */
export function stampEnd(survey, answers) {
  const walk = (fields) => { for (const f of fields) { if (f.autoEnd) answers[f.name] = localNow(); } };
  survey.pages.forEach((p) => walk(p.fields));
}

export function recalc(survey, answers) {
  const walk = (fields, item) => {
    for (const f of fields) {
      if (f.type === 'repeat') { (item[f.name] || []).forEach((it) => walk(f.fields, it)); continue; }
      if (!f.calculation) continue;
      let v = ev(f.calculation, scopeOf(answers, item, f.name), undefined);
      if (typeof v === 'number' && !Number.isFinite(v)) v = undefined;
      if (f.type === 'calculate') {
        // a lookup that has not resolved yet (offline) must not erase a value we already have
        if (f.sticky && (v === undefined || v === '') && !isEmpty(item[f.name])) continue;
        item[f.name] = v;
      } else {
        // an ordinary question with a calculation: set when its inputs change, then the user may edit it
        const last = (item._calc ||= {});
        const sig = JSON.stringify(v ?? null);
        if (last[f.name] !== sig) { last[f.name] = sig; if (!(f.sticky && isEmpty(v))) item[f.name] = v; }
      }
    }
  };
  survey.pages.forEach((p) => walk(p.fields, answers));
}

/** Record title from the XLSForm instance_name expression, e.g. concat(${customer},"_",${customer_site_id}). */
export const instanceLabel = (survey, answers) => {
  if (!survey.instanceName) return '';
  const v = ev(survey.instanceName, scopeOf(answers, answers, ''), '');
  return v == null ? '' : String(v).replace(/^_+|_+$/g, '');
};

// ---- validation ---------------------------------------------------------------------------------
/** Returns [{code, message}] for one field value. Used live (inline) and at review time. */
export function fieldIssues(f, val, scope) {
  const out = [];
  const label = cleanLabel(f.label || f.name);
  const push = (code, message) => out.push({ code, message });
  const empty = isEmpty(val);

  if (f.type === 'image') {
    const n = (val || []).length;
    const min = f.minFiles ?? (f.required ? 1 : 0);
    if (n < min) push('ERR-IMG-003', `${label}: ${n} of ${min} required photo${min === 1 ? '' : 's'} added.`);
    if (f.maxFiles != null && n > f.maxFiles) push('ERR-IMG-003', `${label}: ${n} photos added, maximum is ${f.maxFiles}.`);
    return out;
  }
  if (f.type === 'calculate') {
    if (typeof val === 'string' && val.length > (f.maxLength ?? 255)) push('ERR-FIELD-003', `Calculated value "${f.name}" is ${val.length} characters; limit is ${f.maxLength ?? 255}.`);
    return out;
  }
  if (f.required && empty) { push('ERR-FIELD-001', f.requiredMessage || `"${label}" is required.`); return out; }
  if (empty) return out;

  switch (f.type) {
    case 'integer': if (!Number.isInteger(Number(val))) push('ERR-FIELD-004', `"${label}" must be a whole number.`); break;
    case 'decimal': if (!Number.isFinite(Number(val))) push('ERR-FIELD-004', `"${label}" must be a number.`); break;
    case 'text': if (String(val).length > (f.maxLength ?? 255)) push('ERR-FIELD-003', `"${label}" is ${String(val).length} characters; limit is ${f.maxLength ?? 255}.`); break;
    case 'select_one': if (!f.choicesFrom && !f.choices.some((c) => c.value === val)) push('ERR-FIELD-005', `"${label}" holds "${val}", which is not a choice in this form version.`); break;
    case 'select_multiple': if (!val.every((x) => f.choices.some((c) => c.value === x))) push('ERR-FIELD-005', `"${label}" contains a value that is not a choice in this form version.`); break;
    case 'geopoint': if (!(Math.abs(val.lat) <= 90 && Math.abs(val.lon) <= 180)) push('ERR-FIELD-002', `"${label}" is not a valid coordinate.`); break;
    case 'dateTime': if (Number.isNaN(Date.parse(val))) push('ERR-FIELD-002', `"${label}" is not a valid date/time.`); break;
  }
  if (!out.length && f.constraint && !ev(f.constraint, { ...scope, self: val }, true)) push('ERR-FIELD-002', f.constraintMessage || `"${label}" is not valid.`);
  return out;
}

export function validate(survey, answers) {
  const issues = [];
  const walk = (fields, item, prefix, pageIdx, labelPrefix) => {
    for (const f of fields) {
      const scope = scopeOf(answers, item, f.name);
      if (f.type === 'note' || !isRelevant(f, scope)) continue;
      const path = prefix + f.name;
      if (f.type === 'repeat') {
        const arr = item[f.name] || [];
        if (f.minRepeat && arr.length < f.minRepeat) issues.push({ code: 'ERR-FIELD-001', message: `"${cleanLabel(f.label || f.name)}" needs at least ${f.minRepeat} entr${f.minRepeat === 1 ? 'y' : 'ies'}.`, path, pageIdx });
        arr.forEach((it, i) => walk(f.fields, it, `${path}[${i}].`, pageIdx, `${cleanLabel(f.label || f.name)} ${i + 1} → `));
        continue;
      }
      for (const is of fieldIssues(f, scope.self, scope)) issues.push({ ...is, message: labelPrefix + is.message, path, pageIdx });
    }
  };
  survey.pages.forEach((p, i) => walk(p.fields, answers, '', i, ''));
  return issues;
}

/** Drops answers whose field is not relevant; collects media ids still referenced. */
export function prune(survey, answers) {
  const mediaIds = new Set();
  const walk = (fields, item) => {
    const out = {};
    for (const f of fields) {
      if (f.type === 'note' || !isRelevant(f, scopeOf(answers, item, f.name))) continue;
      if (f.type === 'repeat') out[f.name] = (item[f.name] || []).map((it) => walk(f.fields, it));
      else if (f.type === 'image') { out[f.name] = [...(item[f.name] || [])]; out[f.name].forEach((id) => mediaIds.add(id)); }
      else if (item[f.name] !== undefined) out[f.name] = item[f.name];
    }
    return out;
  };
  const merged = {};
  survey.pages.forEach((p) => Object.assign(merged, walk(p.fields, answers)));
  return { answers: merged, mediaIds };
}

/** Collect media ids under a repeat item (used when the item is deleted). */
export function mediaIn(fields, item, acc = []) {
  for (const f of fields) {
    if (f.type === 'image') acc.push(...(item[f.name] || []));
    else if (f.type === 'repeat') (item[f.name] || []).forEach((it) => mediaIn(f.fields, it, acc));
  }
  return acc;
}
