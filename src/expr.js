// XLSForm-flavoured expressions:  ${field} > 5 and ${kind} = 'a'   count(${photos}) >= 3   string-length(.) < 40
// Survey definitions are authored by developers / imported from XLSForm (trusted), so we compile with new Function.
// Do NOT feed end-user text into this. String literals are protected: words inside quotes are never rewritten.

import * as G from './guycalc.js';

const cache = new Map();

/** Runtime context the app plugs in: who is signed in, how to resolve async lookups, choice labels. */
export const CTX = {
  props: {},                       // pulldata("@property", name): username, email, portalurl, token
  lookup: () => undefined,         // pulldata("@javascript", file, fn, ...args) -> string | undefined while pending
  choices: {},                     // field name -> [{value,label}]   (for jr:choicename)
  site: { level: () => undefined }, // site data pulled from other surveys of the same site (src/sitedata.js): level(siteId, guyLevel) -> elevation | undefined
};
export const setChoices = (survey) => {
  const out = {};
  const walk = (fields) => fields.forEach((f) => { if (f.choices) out[f.name] = f.choices; if (f.fields) walk(f.fields); });
  survey.pages.forEach((p) => walk(p.fields));
  CTX.choices = out;
};
const jsonPath = (obj, path) => String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean).reduce((o, k) => (o == null ? o : o[k]), obj);
const pad = (n) => String(n).padStart(2, '0');

export const HELPERS = {
  count: (x) => (Array.isArray(x) ? x.length : x == null || x === '' ? 0 : 1),
  selected: (x, v) => (Array.isArray(x) ? x.includes(v) : x === v),
  len: (x) => (x == null ? 0 : String(x).length),
  concat: (...a) => a.map((x) => (x == null ? '' : x)).join(''),
  round: (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d,
  today: () => new Date().toISOString().slice(0, 10),
  now: () => new Date().toISOString(),
  iff: (c, a, b) => (c ? a : b),
  int: (x) => Math.trunc(Number(x)),
  number: (x) => Number(x),
  string: (x) => (x == null ? '' : String(x)),
  regex: (x, re) => new RegExp(re).test(x == null ? '' : String(x)),
  contains: (a, b) => String(a ?? '').includes(String(b ?? '')),
  startsWith: (a, b) => String(a ?? '').startsWith(String(b ?? '')),
  endsWith: (a, b) => String(a ?? '').endsWith(String(b ?? '')),
  sum: (x) => (Array.isArray(x) ? x : [x]).reduce((a, b) => a + (Number(b) || 0), 0),
  max: Math.max, min: Math.min, sqrt: Math.sqrt, abs: Math.abs, pow: Math.pow, atan: Math.atan, atan2: Math.atan2, sin: Math.sin, cos: Math.cos, pi: () => Math.PI,
  countselected: (x) => (Array.isArray(x) ? x.length : x == null || x === '' ? 0 : String(x).trim().split(/\s+/).length),
  choicename: (val, name) => { const c = (CTX.choices[name] || []).find((x) => String(x.value) === String(val)); return c ? c.label : val == null ? '' : val; },
  formatdate: (d, fmt = '%Y-%m-%d') => {
    const t = d instanceof Date ? d : new Date(d || Date.now());
    if (Number.isNaN(+t)) return '';
    const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], D = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return String(fmt).replace(/%([YmdHMSyeaAbB])/g, (_, c) => ({ Y: t.getFullYear(), y: pad(t.getFullYear() % 100), m: pad(t.getMonth() + 1), d: pad(t.getDate()), e: t.getDate(), H: pad(t.getHours()), M: pad(t.getMinutes()), S: pad(t.getSeconds()), b: M[t.getMonth()], B: M[t.getMonth()], a: D[t.getDay()], A: D[t.getDay()] }[c]));
  },
  // Guy-wire calculations (src/guycalc.js). Empty inputs give '' so a half-filled form never shows NaN.
  sitelevel: (site, level) => { if (!site || level === '' || level == null) return ''; return CTX.site.level(String(site), level) ?? ''; },
  guychord: (radius, elev, drop) => (radius === '' || radius == null || elev === '' || elev == null ? '' : G.round1(G.chord(radius, elev, drop))),
  guymin: (strength) => (strength === '' || strength == null ? '' : G.allowable({ breakingStrength: strength }).min),
  guymax: (strength) => (strength === '' || strength == null ? '' : G.allowable({ breakingStrength: strength }).max),
  guystatus: (tension, min, max) => (tension === '' || tension == null || min === '' ? '' : Number(tension) < Number(min) ? 'LOW' : Number(tension) > Number(max) ? 'HIGH' : 'OK'),
  pntdeg: (shift, d, m, s) => (shift === '' || shift == null ? '' : G.round1(G.readingDeg({ shift, degrees: d, minutes: m, seconds: s }) * 1000) / 1000),
  // Survey123 data lookups. "@javascript" calls resolve asynchronously (and survive being offline) via CTX.lookup.
  pulldata: (src, ...a) => {
    switch (src) {
      case '@property': return CTX.props[a[0]] ?? '';
      case '@geopoint': { const p = a[0]; return p && typeof p === 'object' ? (a[1] === 'y' ? p.lat : a[1] === 'x' ? p.lon : p[a[1]]) ?? '' : ''; }
      case '@json': { if (!a[0]) return ''; try { const v = jsonPath(typeof a[0] === 'string' ? JSON.parse(a[0]) : a[0], a[1]); return v ?? ''; } catch { return ''; } }
      case '@javascript': return CTX.lookup(a[0], a[1], a.slice(2)) ?? '';
      default: return '';
    }
  },
};

/** XPath-ish → JavaScript, touching only the parts outside quotes. */
function translate(expr) {
  const pre = String(expr)
    .replace(/jr:choice-?name\(\s*\$\{([\w.]+)\}\s*,\s*(?:'[^']*'|"[^"]*")\s*\)/g, (_, n) => `choicename(\${${n}}, "${n}")`)
    .replace(/\b[Tt]oday\(/g, 'today(').replace(/\bformat-date\(/g, 'formatdate(').replace(/\bcount-selected\(/g, 'countselected(');
  return pre.split(/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/).map((part, i) => {
    if (i % 2) return part;                                               // string literal: untouched
    return part
      .replace(/(?<![\w$}{\)\]])\.(?![\w.])/g, '${.}')                       // standalone "." = the current value
      .replace(/\$\{([\w.]+)\}/g, (_, n) => `v(${JSON.stringify(n)})`)
      .replace(/\bstring-length\(/g, 'len(')
      .replace(/\bstarts-with\(/g, 'startsWith(')
      .replace(/\bends-with\(/g, 'endsWith(')
      .replace(/\bif\(/g, 'iff(')
      .replace(/\btrue\(\)/g, 'true').replace(/\bfalse\(\)/g, 'false')
      .replace(/\bdiv\b/g, '/').replace(/\bmod\b/g, '%')
      .replace(/\band\b/g, '&&').replace(/\bor\b/g, '||')
      .replace(/\bnot\s*\(/g, '!(')
      .replace(/!=/g, '!==')
      .replace(/(?<![=!<>])=(?!=)/g, '==');
  }).join('');
}

export function compile(expr) {
  if (cache.has(expr)) return cache.get(expr);
  // the standalone-"." rewrite emits ${.}, which the next replace turns into v(".")
  const src = translate(expr).replace(/\$\{\.\}/g, 'v(".")');
  let fn;
  try {
    fn = new Function('v', 'f', `"use strict"; const {${Object.keys(HELPERS)}} = f; return (${src});`);
  } catch (e) {
    throw new Error(`Bad expression "${expr}": ${e.message}`);
  }
  const run = (v) => fn(v, HELPERS);
  cache.set(expr, run);
  return run;
}

/** Dry-run with every answer empty: surfaces unsupported functions (ReferenceError) at import/validation time. */
export function probe(expr) {
  try { compile(expr)(() => undefined); return null; }
  catch (e) {
    if (e instanceof ReferenceError) return `Unsupported function or name: ${e.message.replace(/ is not defined/, '')}`;
    if (/^Bad expression/.test(e.message)) return e.message;
    return null;                                                           // runtime type errors on empty data are fine
  }
}
