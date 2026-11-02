// Shared-record model: lets several phones edit one survey, offline or online, and converge without conflicts.
//
//  * Scalar answers are last-writer-wins registers keyed by path ("siteId", "guyWires/<itemId>/tension").
//    "Last" = hybrid logical clock (t) with the device id as a tie-break, so every phone picks the same winner.
//  * Repeat entries and photos are add/remove sets keyed by id, so two people adding a guy wire or 100 photos
//    each never overwrite one another; each entry is its own record.
//  * Ops are idempotent and commutative: replaying, reordering or duplicating them (lost acks, offline queues) is safe.

export const newState = () => ({ fields: {}, items: {}, photos: {} });

const rid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : 'i' + Math.random().toString(36).slice(2) + Date.now().toString(36));
export const newId = rid;
const newer = (a, b) => (a.t !== b.t ? a.t > b.t : String(a.by) > String(b.by));
const eq = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const byOrder = ([ia, a], [ib, b]) => a.c - b.c || (ia < ib ? -1 : 1);

export function applyOp(s, op) {
  switch (op.k) {
    case 'set': {
      const cur = s.fields[op.p];
      if (!cur || newer(op, cur)) s.fields[op.p] = { v: op.v, t: op.t, by: op.by, n: op.n };
      break;
    }
    case 'item+': case 'item-': {
      const m = (s.items[op.p] ||= {}), cur = m[op.id];
      if (!cur || newer(op, cur)) m[op.id] = { t: op.t, by: op.by, n: op.n || cur?.n, del: op.k === 'item-', c: Math.min(cur?.c ?? op.c ?? op.t, op.c ?? op.t) };
      else if ((op.c ?? op.t) < cur.c) cur.c = op.c ?? op.t;
      break;
    }
    case 'photo+': case 'photo-': {
      const m = (s.photos[op.p] ||= {}), cur = m[op.id];
      if (!cur || newer(op, cur)) m[op.id] = { m: op.m || cur?.m, n: op.n || cur?.n, t: op.t, by: op.by, del: op.k === 'photo-', c: Math.min(cur?.c ?? op.c ?? op.t, op.c ?? op.t) };
      else if ((op.c ?? op.t) < cur.c) cur.c = op.c ?? op.t;
      break;
    }
  }
}

/** The state entry an op would write (for "did this change anything?"). */
export const entryOf = (s, op) => (op.k === 'set' ? s.fields[op.p] : op.k.startsWith('item') ? s.items[op.p]?.[op.id] : s.photos[op.p]?.[op.id]);

/** A whole state as ops with deterministic ids. Two phones merging states derive the same ids, so the server dedupes
 *  whichever of them relays the change first. */
export function stateToOps(s) {
  const ops = [];
  for (const [p, e] of Object.entries(s.fields)) ops.push({ k: 'set', p, v: e.v, t: e.t, by: e.by, n: e.n, opId: `st:set:${p}:${e.t}:${e.by}` });
  for (const [p, m] of Object.entries(s.items)) for (const [id, e] of Object.entries(m)) ops.push({ k: e.del ? 'item-' : 'item+', p, id, t: e.t, by: e.by, n: e.n, c: e.c, opId: `st:item:${p}:${id}:${e.t}:${e.by}:${e.del ? 1 : 0}` });
  for (const [p, m] of Object.entries(s.photos)) for (const [id, e] of Object.entries(m)) ops.push({ k: e.del ? 'photo-' : 'photo+', p, id, m: e.m, n: e.n, t: e.t, by: e.by, c: e.c, opId: `st:photo:${p}:${id}:${e.t}:${e.by}:${e.del ? 1 : 0}` });
  return ops;
}

/** Plain answers object (the shape the form renderer uses) from CRDT state. Calculates are recomputed by the caller. */
export function materialize(survey, st) {
  const out = {};
  const walk = (fields, prefix, item) => {
    for (const f of fields) {
      if (f.type === 'note') continue;
      const key = prefix + f.name;
      if (f.type === 'repeat') {
        item[f.name] = Object.entries(st.items[key] || {}).filter(([, e]) => !e.del).sort(byOrder).map(([id]) => {
          const it = { _id: id }; walk(f.fields, `${key}/${id}/`, it); return it;
        });
      } else if (f.type === 'image') {
        item[f.name] = Object.entries(st.photos[key] || {}).filter(([, e]) => !e.del).sort(byOrder).map(([id]) => id);
      } else {
        const e = st.fields[key];
        if (e && e.v !== null && e.v !== undefined) item[f.name] = e.v;
      }
    }
  };
  survey.pages.forEach((p) => walk(p.fields, '', out));
  return out;
}

/** Ops that turn `prev` answers into `next` answers (unstamped: caller adds opId/t/by). */
export function diff(survey, prev, next, photoMeta = () => ({})) {
  const ops = [];
  const walk = (fields, prefix, p, n) => {
    for (const f of fields) {
      if (f.type === 'note') continue;
      const key = prefix + f.name;
      if (f.type === 'repeat') {
        const pa = (p && p[f.name]) || [], na = (n && n[f.name]) || [];
        for (const it of na) it._id ||= rid();
        const pm = new Map(pa.map((i) => [i._id, i])), nm = new Map(na.map((i) => [i._id, i]));
        for (const [id, it] of nm) {
          if (!pm.has(id)) ops.push({ k: 'item+', p: key, id });
          walk(f.fields, `${key}/${id}/`, pm.get(id) || {}, it);
        }
        for (const id of pm.keys()) if (!nm.has(id)) ops.push({ k: 'item-', p: key, id });
      } else if (f.type === 'image') {
        const pa = new Set((p && p[f.name]) || []), na = new Set((n && n[f.name]) || []);
        for (const id of na) if (!pa.has(id)) ops.push({ k: 'photo+', p: key, id, m: photoMeta(id) });
        for (const id of pa) if (!na.has(id)) ops.push({ k: 'photo-', p: key, id });
      } else {
        const a = p?.[f.name], b = n?.[f.name];
        if (!eq(a, b)) ops.push({ k: 'set', p: key, v: b === undefined ? null : b });
      }
    }
  };
  survey.pages.forEach((pg) => walk(pg.fields, '', prev || {}, next || {}));
  return ops;
}

/** Live photo entries of a state: [{key, id, by, n, m}] */
export function livePhotos(st) {
  const out = [];
  for (const [key, m] of Object.entries(st.photos)) for (const [id, e] of Object.entries(m)) if (!e.del) out.push({ key, id, by: e.by, n: e.n, m: e.m });
  return out;
}

/** Who captured what: [{who, answers, entries, photos}] — every answer, repeat entry and photo is credited to the person
 *  (by name) whose phone made it. Calculated values are the app's, not a person's, so they are not counted. */
export function attribution(survey, st) {
  const calc = new Set();
  const walk = (fs) => { for (const f of fs) { if (f.type === 'calculate') calc.add(f.name); if (f.fields) walk(f.fields); } };
  survey.pages.forEach((p) => walk(p.fields));
  const rows = new Map(), row = (e) => { const k = e.n || e.by; if (!rows.has(k)) rows.set(k, { who: k, answers: 0, entries: 0, photos: 0 }); return rows.get(k); };
  for (const [p, e] of Object.entries(st.fields)) if (e.v !== null && e.v !== '' && !calc.has(p.split('/').pop())) row(e).answers++;
  for (const m of Object.values(st.items)) for (const e of Object.values(m)) if (!e.del) row(e).entries++;
  for (const m of Object.values(st.photos)) for (const e of Object.values(m)) if (!e.del) row(e).photos++;
  return [...rows.values()].sort((a, b) => b.photos + b.answers - (a.photos + a.answers));
}
