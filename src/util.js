export const uid = () =>
  (globalThis.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function fmtBytes(n = 0) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 1024 ** 2 * 10 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export const fmtTime = (ts) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Tiny hyperscript helper: h('div', {class:'x', onclick}, child, [children], 'text') */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) return c.forEach(add);
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}

export function download(name, data, type = 'application/json') {
  const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---- labels may contain HTML (<h1>, <b>, <font color>, <br>) and ${field} references ---------------------
const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'P', 'SPAN', 'FONT', 'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'SUB', 'SUP', 'DIV']);
const COLOR = /^#[0-9a-f]{3,8}$|^[a-z]{3,20}$/i;

export const stripHtml = (s) => String(s ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** Renders label HTML as DOM using an allow-list (no scripts, no handlers, only colour styling survives). */
export function htmlFragment(s) {
  const frag = document.createDocumentFragment();
  if (!/[<&]/.test(s)) { frag.append(String(s ?? '')); return frag; }
  const doc = new DOMParser().parseFromString(`<body>${s}</body>`, 'text/html');
  const walk = (src, dst) => {
    for (const n of src.childNodes) {
      if (n.nodeType === 3) dst.append(n.textContent);
      else if (n.nodeType === 1) {
        if (!ALLOWED.has(n.tagName)) { walk(n, dst); continue; }
        const el = document.createElement(n.tagName.toLowerCase());
        const col = n.tagName === 'FONT' ? n.getAttribute('color') : (n.getAttribute('style') || '').match(/(?:^|;)\s*color\s*:\s*([^;]+)/i)?.[1]?.trim();
        if (col && COLOR.test(col)) el.style.color = col;
        walk(n, el); dst.append(el);
      }
    }
  };
  walk(doc.body, frag);
  return frag;
}
