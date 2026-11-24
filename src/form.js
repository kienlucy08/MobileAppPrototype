import { h, fmtBytes, debounce, htmlFragment, stripHtml } from './util.js';
import { setChoices, CTX } from './expr.js';
import { beta } from './mode.js';
import * as S from './schema.js';
import { addImages } from './images.js';
import { openCamera } from './capture.js';
import { buildSteps, wireNumber } from './guidesteps.js';
import { attribution } from './crdt.js';
import { describe } from './errors.js';
import { icon } from './icons.js';
import { newId } from './crdt.js';
import { ROLES } from './serverCore.js';

const surveyOf = (ctx, sub) => (sub.shared ? ctx.collab.docs.get(sub.id)?.survey : sub.survey) || ctx.survey;
const hasVisible = (pg) => pg.fields.some((f) => f.type !== 'calculate' && f.appearance !== 'hidden');
/** Replace ${field} in a label with the current answer (choice labels for selects). */
const interp = (text, item, root) => String(text ?? '').replace(/\$\{([\w.]+)\}/g, (_, n) => {
  const raw = item && Object.prototype.hasOwnProperty.call(item, n) ? item[n] : root?.[n];
  if (raw == null || raw === '') return '…';
  if (Array.isArray(raw)) return raw.map((x) => CTX.choices[n]?.find((c) => String(c.value) === String(x))?.label ?? x).join(', ');
  return CTX.choices[n]?.find((c) => String(c.value) === String(raw))?.label ?? raw;
});
const initials = (n = '?') => String(n).trim().slice(0, 1).toUpperCase();

const ROLE_SHORT = { member: 'crew', lead: 'lead', pm: 'PM' };
export const contributorsTable = (rows) => h('table', { class: 'contrib' }, h('tr', {}, ['Person', 'Answers', 'Entries', 'Photos'].map((t) => h('th', {}, t))),
  ...rows.map((r) => h('tr', {}, h('td', {}, r.who), h('td', {}, r.answers), h('td', {}, r.entries), h('td', {}, r.photos))));

/** Share / reassign a team record: leads and PMs add or remove people. Removed people keep their entries, credited to them. */
async function shareSheet(ctx, sub) {
  const doc = ctx.collab.docs.get(sub.id);
  const box = h('div', { class: 'people-list' }, h('p', { class: 'muted' }, 'Loading…'));
  const close = ctx.modal('People on this survey', box, h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn primary', onclick: () => close() }, 'Done')));
  let team = [];
  const draw = () => {
    const mine = new Map((doc.assignees || []).map((a) => [a.email, a]));
    const rows = [...mine.values(), ...team.filter((t) => !mine.has(t.email))];
    box.replaceChildren(h('p', { class: 'muted' }, 'Reassigning moves the survey to someone else. It leaves the previous person’s list once their phone syncs; what they entered stays on the record, credited to them.'),
      ...rows.map((p) => h('div', { class: 'row-card inner' }, h('div', { class: 'grow' }, h('b', {}, p.email === ctx.device.email ? `${p.name} (you)` : p.name), h('small', { class: 'muted block' }, ROLES[p.role] || p.role)),
        h('button', { type: 'button', class: 'btn small' + (mine.has(p.email) ? '' : ' primary'), onclick: async (e) => {
          e.target.disabled = true;
          try { await ctx.collab.assign(sub.id, mine.has(p.email) ? { remove: [p.email] } : { add: [p.email] }); } catch (err) { ctx.toast(`${err.code || 'ERR-GEN-000'}: ${err.message}`, 5000); }
          draw();
        } }, mine.has(p.email) ? 'Remove' : 'Add'))));
  };
  try { team = await ctx.server.team(); draw(); } catch (e) { box.replaceChildren(h('p', { class: 'muted' }, e.code === 'ERR-NET-002' || e.code === 'ERR-NET-001' ? 'You need a signal to change who is on a survey.' : `${e.code}: ${e.message}`)); }
}

/** Who is on the record, what they have uploaded, and whether this phone has changes still waiting to sync. */
export function teamPanel(ctx, sub) {
  const box = h('div', { class: 'team' });
  const update = () => {
    const doc = ctx.collab.docs.get(sub.id); if (!doc) return;
    const prog = ctx.collab.photoProgress(sub.id), unsynced = doc.pending.length + (doc.dirty ? 1 : 0);
    const people = [{ name: ctx.device.name, me: true }, ...doc.presence.map((p) => ({ name: p.name }))];
    box.replaceChildren(...[
      h('div', { class: 'team-row' }, h('div', { class: 'avatars' }, people.map((p) => h('span', { class: 'avatar' + (p.me ? ' me' : ''), title: p.me ? 'You' : `${p.name} is here` }, initials(p.name)))),
        h('span', { class: 'muted' }, people.length > 1 ? `${people.map((p) => (p.me ? 'You' : p.name)).join(', ')} on this record` : 'Only you right now')),
      h('div', { class: 'syncline ' + (ctx.collab.svc === 'down' ? 'off' : unsynced ? 'wait' : 'ok') },
        icon(ctx.collab.svc === 'down' ? 'wifi' : unsynced ? 'refresh' : 'check', 15),
        ctx.collab.svc === 'down' ? `Offline — ${unsynced} change${unsynced === 1 ? '' : 's'} saved on this phone, will sync` : unsynced ? `${unsynced} change${unsynced === 1 ? '' : 's'} syncing…` : 'All changes synced'),
      ctx.nearby?.enabled ? (() => {
        const near = ctx.nearby.peersWith(sub.id), mine = ctx.engine.mediaFor(sub.id).filter((m) => m.state !== 'done' && !m.relayed).length;
        return h('div', { class: 'nearbyline' }, icon('wifi', 15), near.length ? `Nearby: ${near.map((p) => p.name).join(', ')} — edits sync directly` : 'Nearby sync on — nobody in range',
          near.length && mine ? h('button', { class: 'btn small', onclick: async (e) => { e.target.disabled = true; const n = await ctx.nearby.sharePhotos(sub.id); ctx.toast(`Handed ${n} photo${n === 1 ? '' : 's'} to nearby phones — whoever gets signal first uploads them.`, 5000); e.target.disabled = false; } }, `Share ${mine} photo${mine === 1 ? '' : 's'}`) : null);
      })() : null,
      ctx.has('assign') ? (() => {
        const people = doc.assignees || [];
        return h('div', { class: 'peopleline' }, icon('user', 15), h('span', { class: 'grow' }, people.length ? people.map((a) => `${a.email === ctx.device.email ? 'You' : a.name}${ctx.has('roles') ? ` (${ROLE_SHORT[a.role] || a.role})` : ''}`).join(', ') : 'Just you so far'),
          ctx.can('share') ? h('button', { type: 'button', class: 'btn small', onclick: () => shareSheet(ctx, sub) }, 'People') : null);
      })() : null,
      ctx.has('attribution') ? (() => {
        const rows = ctx.collab.contributors(sub.id);
        return rows.length ? h('details', { class: 'whoby' }, h('summary', {}, 'Who captured what'), contributorsTable(rows)) : null;
      })() : null,
      prog.length ? h('div', { class: 'photoprog' }, prog.map((r) => h('div', { class: 'pp' },
        h('span', {}, r.mine ? 'Your photos' : `${r.who}'s photos`), h('div', { class: 'bar' }, h('i', { style: `width:${r.total ? (r.received / r.total) * 100 : 0}%` })), h('small', {}, `${r.received}/${r.total}`)))) : null].filter(Boolean));
  };
  update();
  ctx.collab.addEventListener('change', update); ctx.nearby?.addEventListener('change', update);
  box.cleanup = () => { ctx.collab.removeEventListener('change', update); ctx.nearby?.removeEventListener('change', update); };
  return { el: box, update };
}

// =================================================================================================
// Form renderer: JSON in → paged, live-validated form out. Works on a private draft or a shared record.
// =================================================================================================
export function renderForm(ctx, sub, { startPage = 0, focusPath = null, onExit, onReview, ingress = false, onFinish, onCopy, visitNav, subtitle = '', status = '', banner = '' }) {
  const ing = !!ingress;
  const shared = sub.shared ? ctx.collab : null;
  const survey = surveyOf(ctx, sub);
  setChoices(survey);
  const pages = survey.pages.filter(hasVisible);
  let page = Math.max(0, pages.indexOf(survey.pages[Math.min(startPage, survey.pages.length - 1)]));
  let wrappers = [], pendingRemote = null, building = false;       // `building`: a repeat refreshes itself while its page is still being built; that must not drop the fields built so far
  const cleanups = [];

  if (shared) { sub.answers = shared.open(sub.id); S.recalc(survey, sub.answers); }

  if (ing) sub.checked ||= {};
  const body = h('div', { class: 'scroll form-body' });
  const title = h('div', { class: 'ab-title' });
  const bar = h('div', { class: 'progress' }, h('i'));
  const dots = h('div', { class: 'pagedots' });
  const back = h('button', { class: 'btn ghost', onclick: () => go(page - 1) }, 'Back');
  const next = h('button', { class: 'btn primary', onclick: () => (page === pages.length - 1 ? onReview(survey.pages.indexOf(pages[page])) : go(page + 1)) });
  const team = shared ? teamPanel(ctx, sub) : null;
  if (team) cleanups.push(team.el.cleanup);
  const root = h('div', { class: 'screen form' },
    h('header', { class: 'appbar' }, h('button', { class: 'iconbtn', 'aria-label': 'Save and exit', onclick: () => { saveNow(); onExit(); } }, icon('back')), title,
      shared ? h('span', { class: 'saved teamtag' }, icon('upload', 13), 'Team') : h('span', { class: 'saved' }, 'Draft saved')),
    bar, ctx.has('photofirst') && ctx.openPhotoFirst ? h('div', { class: 'form-tools' }, h('button', { type: 'button', class: 'btn small ghost', onclick: () => { saveNow(); ctx.openPhotoFirst(sub); } }, icon('image', 15), 'Photo-first: shoot now, sort later')) : null, team ? team.el : null, body,
    h('footer', { class: 'formnav' }, back, dots, next));
  root.cleanup = () => { cleanups.forEach((f) => f()); };
  const ingRoot = ing ? buildIngress() : null;
  if (ing) { ingRoot.cleanup = root.cleanup; }

  const saveNow = () => {
    sub.page = survey.pages.indexOf(pages[page]); sub.updatedAt = Date.now();
    if (shared) { shared.flush(sub.id); return Promise.resolve(); }
    return ctx.db.put('submissions', sub);
  };
  const save = debounce(saveNow, 400);
  const changed = () => {
    const moved = pullAll();
    S.recalc(survey, sub.answers); refresh();
    if (moved) { if (typingNow()) pendingRedraw = true; else redrawKeep(); }
    if (shared) shared.localChanged(sub.id, sub.answers); else save();
  };
  // ---- fill repeated information from other surveys of the same site, and say so ---------------------
  const pulled = (sub.pulled ||= {});
  const typingNow = () => body.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  let pendingRedraw = false;
  /** Fields marked `pull` fill themselves from another survey for the same site. Only fields that are empty, or still hold what was filled in, are touched: what the crew typed is never overwritten. */
  const pullAll = () => {
    if (!ctx.pullFor || !beta()) return false; let any = false;
    for (const pg of survey.pages) for (const f of pg.fields) {
      if (!f.pull) continue;
      const cur = sub.answers[f.name], p = pulled[f.name];
      if (!(S.isEmpty(cur) || (p && String(p.value) === String(cur)))) continue;
      const src = ctx.pullFor(sub.answers.siteId, f.name, sub.id);
      if (src && String(src.value) !== String(cur ?? '')) { sub.answers[f.name] = f.type === 'integer' || f.type === 'decimal' ? Number(src.value) : src.value; pulled[f.name] = { value: sub.answers[f.name], from: src.from }; any = true; }
      else if (!src && p) { delete sub.answers[f.name]; delete pulled[f.name]; any = true; }
    }
    return any;
  };
  const redrawKeep = () => { const keep = body.scrollTop; draw(); body.scrollTop = keep; };
  const refresh = () => {
    if (!building) wrappers = wrappers.filter((w) => body.contains(w.el));
    for (const w of wrappers) { w.el.hidden = !w.visible(); w.relabel?.(); w.sync?.(); w.status?.(); w.pull?.(); }
    if (ing) updateIngress();
  };
  if (ctx.siteData) cleanups.push(ctx.siteData.onResolve(() => changed()));       // structure-survey values arrived for this site
  if (ctx.lookups) cleanups.push(ctx.lookups.onResolve(() => changed()));       // weather / member lookup finished (possibly after being offline)

  // ---- teammates' edits ---------------------------------------------------------------------------
  const typing = () => body.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  const adoptRemote = (answers) => {
    const keep = body.scrollTop;
    sub.answers = shared.adopt(sub.id, answers); S.recalc(survey, sub.answers);
    draw(); body.scrollTop = keep; pendingRemote = null;
  };
  if (shared) {
    cleanups.push(shared.attach(sub.id, (answers, submitted) => {
      if (submitted) ctx.toast('A teammate submitted this record.');
      if (typing()) pendingRemote = answers; else adoptRemote(answers);
    }));
    body.addEventListener('focusin', (e) => { const sec = e.target.closest('[data-path]'); shared.setFocus(sub.id, sec ? sec.dataset.path : null); });
    body.addEventListener('focusout', () => setTimeout(() => {
      if (!typing()) { shared.setFocus(sub.id, null); if (pendingRemote) adoptRemote(shared.answersOf(sub.id)); }
    }, 60));
    const peers = () => {
      const doc = ctx.collab.docs.get(sub.id); if (!doc) return;
      const at = {}; for (const p of doc.presence) if (p.focus) (at[p.focus] ||= []).push(p.name);
      body.querySelectorAll('[data-path]').forEach((sec) => {
        let tag = sec.querySelector(':scope > .peer-tag'); const names = at[sec.dataset.path];
        if (!names) { tag?.remove(); sec.classList.remove('peer'); return; }
        sec.classList.add('peer');
        if (!tag) { tag = h('span', { class: 'peer-tag' }); sec.prepend(tag); }
        tag.textContent = `${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} editing`;
      });
    };
    ctx.collab.addEventListener('change', peers); cleanups.push(() => ctx.collab.removeEventListener('change', peers));
  }

  function go(i) { saveNow(); page = Math.max(0, Math.min(pages.length - 1, i)); draw(); body.scrollTop = 0; }

  function draw() {
    const pg = pages[page];
    wrappers = [];
    if (ing) {
      building = true; body.replaceChildren(...pg.fields.map((f) => fieldEl(f, sub.answers, '')).filter(Boolean)); building = false;
      refresh();
      if (focusPath) {
        const el = body.querySelector(`[data-path="${CSS.escape(focusPath)}"]`);
        focusPath = null;
        if (el) requestAnimationFrame(() => { el.scrollIntoView({ block: 'center' }); el.classList.add('pulse'); });
      }
      return;
    }
    title.replaceChildren(h('b', {}, survey.title), h('small', {}, `${stripHtml(pg.label || pg.name)} · ${page + 1} of ${pages.length}`));
    bar.firstChild.style.width = `${((page + 1) / pages.length) * 100}%`;
    building = true; body.replaceChildren(...pg.fields.map((f) => fieldEl(f, sub.answers, '')).filter(Boolean)); building = false;
    back.disabled = page === 0;
    next.textContent = page === pages.length - 1 ? 'Review' : 'Next';
    dots.replaceChildren(...pages.map((_, i) => h('i', { class: i === page ? 'on' : '' })));
    refresh();
    if (focusPath) {
      const el = body.querySelector(`[data-path="${CSS.escape(focusPath)}"]`);
      focusPath = null;
      if (el) requestAnimationFrame(() => { el.scrollIntoView({ block: 'center' }); el.classList.add('pulse'); });
    }
  }

  // ---- field factory ----------------------------------------------------------------------------
  function fieldEl(f, item, prefix) {
    if (f.type === 'calculate' || f.appearance === 'hidden') return null;    // never rendered
    const path = prefix + f.name;
    const wrap = h('section', { class: 'field', 'data-path': path });
    const entry = { el: wrap, f, visible: () => S.isRelevant(f, S.scopeOf(sub.answers, item, f.name)) };
    wrappers.push(entry);
    const dynamic = (t) => /\$\{/.test(t || '');

    if (f.type === 'note' && f.guidedFor) { wrap.append(guidedCard(f)); return wrap; }
    if (f.type === 'note') {
      const box = h('div', { class: 'note-html' + (/reminder|warning/i.test(f.name) ? ' warn' : '') });
      const draw = () => box.replaceChildren(htmlFragment(interp(f.label, item, sub.answers)));
      draw(); if (dynamic(f.label)) entry.relabel = draw;
      wrap.append(box); return wrap;
    }
    if (f.type === 'repeat') { wrap.append(repeatEl(f, item, path)); return wrap; }

    const err = h('div', { class: 'inline-err', role: 'alert' });
    const set = (v) => {
      item[f.name] = v;
      if (ing && item[f.name + '__state'] && !S.isEmpty(v)) { delete item[f.name + '__state']; wrap.classList.remove('na'); }
      const scope = S.scopeOf(sub.answers, item, f.name);
      const issue = S.isEmpty(v) ? null : S.fieldIssues(f, v, scope)[0];   // live: required errors wait for review
      err.textContent = issue ? issue.message : '';
      wrap.classList.toggle('bad', !!issue);
      changed();
    };
    const lbl = h('label', { class: 'lbl' }), hint = f.hint ? h('div', { class: 'hint' }) : null;
    const drawLabel = () => {
      lbl.replaceChildren(htmlFragment(interp(f.label, item, sub.answers)), f.required || f.minFiles > 0 ? h('span', { class: 'req' }, ' *') : '');
      hint?.replaceChildren(htmlFragment(interp(f.hint, item, sub.answers)));
    };
    drawLabel(); if (dynamic(f.label) || dynamic(f.hint)) entry.relabel = drawLabel;
    if (f.calculation && f.type !== 'calculate') {                          // a question whose value is calculated: show the new value as its inputs change
      entry.sync = () => { const inp = wrap.querySelector('input:not([type=file]), textarea'); if (inp && document.activeElement !== inp && String(inp.value) !== String(item[f.name] ?? '')) inp.value = item[f.name] ?? ''; };
    }
    wrap.append(...[
      lbl,
      hint,
      controls[f.type](f, item, set, path),
      err,
      f.pull && !prefix && beta() ? pullNoteEl(f, entry) : null,
      ing && !prefix ? ingFooter(f, item, path, wrap, entry, set) : null,
    ].filter(Boolean));
    return wrap;
  }

  // ---- guided photos (guy facilities) ------------------------------------------------------------
  /** What the camera tells the crew to shoot for this slot, so the photo links to the right wire. */
  function photoTip(f, item, path) {
    if (f.tip) return f.tip;
    if (!f.slot || !beta()) return '';
    const m = /^(wires\w)\[\d+\]\./.exec(path), arr = m ? sub.answers[m[1]] : null;
    if (!arr) return `Take a photo of the ${f.slot}`;
    const level = item.level ?? arr.indexOf(item) + 1;
    return `Take a photo of guy level ${level} wire ${wireNumber(arr, item)} ${f.slot}`;
  }
  function guidedCard(f) {
    const c = f.guidedFor; let mode = sub.guideMode || 'wire';
    const card = h('div', { class: 'guided-card' });
    const start = () => {
      sub.guideMode = mode;
      const steps = buildSteps({ c, answers: sub.answers, mode });
      if (!(sub.answers[`wires${c}`] || []).length) ctx.toast('Add the levels and wires first: the camera prompts a photo for each one. Anchor photos can start now.', 5000);
      const C = c.toUpperCase();
      const info = (st) => st.target.kind === 'anchor' ? { item: sub.answers, field: st.target.field, path: st.target.field, match: `_anchor${C}_${st.target.slot}` }
        : (() => { const arr = sub.answers[`wires${c}`] || [], i = arr.findIndex((w) => w._id === st.target.itemId); return { item: arr[i] || {}, field: st.target.field, path: `wires${c}[${i}].${st.target.field}`, match: null }; })();
      // a wire's slot holds that wire's photos; an anchor slot is found by its file name
      const idsFor = (t) => (t.item[t.field] || []).filter((id) => !t.match || (ctx.engine.media.get(id)?.name || '').includes(t.match));
      const guide = { steps, startAt: 0,
        isDone: (i) => idsFor(info(steps[i])).length > 0,
        thumb: (i) => ctx.engine.media.get(idsFor(info(steps[i]))[0])?.thumb,
        clear: async (i) => { const t = info(steps[i]); for (const id of idsFor(t)) { await ctx.engine.removeMedia(id); t.item[t.field] = (t.item[t.field] || []).filter((x) => x !== id); } changed(); },
        assign: async (i, file) => {
          const t = info(steps[i]), n = idsFor(t).length;          // more photos for the same slot are added, never replaced
          const named = n ? new File([file], file.name.replace(/\.jpg$/, `_${n + 1}.jpg`), { type: 'image/jpeg', lastModified: Date.now() }) : file;
          const r = await addImages(ctx.engine, sub, t.path, [named], { original: ctx.settings?.original });
          for (const e of r.errors) ctx.toast(`${e.code}: ${e.detail}`, 6000);
          (t.item[t.field] ||= []).push(...r.ids); changed();
        } };
      openCamera({ container: document.querySelector('.device') || document.body, title: 'Guided photos', onShot: () => {}, guide, onClose: () => redrawKeep() });
    };
    const draw = () => card.replaceChildren(h('b', {}, icon('camera', 16), ` Guided photos · Compound ${c.toUpperCase()}`),
      h('small', {}, 'Enter the levels and wires first. The camera then tells you what to shoot, for example “Take a photo of guy level 1 wire 1 dead end group”, and files each photo against that wire. Every slot takes several photos.'),
      h('div', { class: 'seg mini' }, [['wire', 'Wire by wire'], ['tool', 'One tool at a time']].map(([k, l]) => h('button', { type: 'button', class: mode === k ? 'on' : '', onclick: () => { mode = k; draw(); } }, l))),
      h('small', { class: 'muted' }, mode === 'wire' ? 'Level 1 wire 1: dead end group, color, tension. Then the next wire.' : 'Every dead end group, then every color, then every tension.'),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: start }, 'Start guided photos')));
    draw(); return card;
  }
  function pullNoteEl(f, entry) {
    const el = h('div', { class: 'pull-note' });
    entry.pull = () => { const p = pulled[f.name], on = !!p && String(p.value) === String(sub.answers[f.name]); el.hidden = !on; if (on) el.replaceChildren(icon('link', 12), `Filled in from ${p.from}`); };
    entry.pull(); return el;
  }
  body.addEventListener('focusout', () => setTimeout(() => { if (pendingRedraw && !typingNow()) { pendingRedraw = false; redrawKeep(); } }, 60));
  const lookupShows = [], entryOf = (n) => wrappers.find((w) => w.f?.name === n);
  if (ing) cleanups.push(ctx.server && ctx.lookups ? ctx.lookups.onResolve(() => lookupShows.forEach((f) => f())) : () => {});
  const controls = {
    text(f, item, set) {
      if (f.appearance === 'lookup') {                                                // a looked-up value: Pending until service returns, never blocks
        const out = h('div', { class: 'lookup' });
        const show = () => { const v = item[f.name]; out.className = 'lookup ' + (v ? 'done' : 'pending'); out.replaceChildren(h('span', { class: 'pill ' + (v ? 'complete' : 'blocked') }, v ? 'Done' : 'Pending'), h('span', {}, v || (ctx.server.profile?.offline ? 'Waiting for signal' : 'Looking up…'))); };
        show(); (entryOf(f.name) || {}).sync = show; lookupShows.push(show);
        return out;
      }
      const max = f.maxLength ?? 255, val = item[f.name] ?? '';
      const input = h(f.appearance === 'multiline' ? 'textarea' : 'input', { class: 'input', maxlength: max, rows: 3, type: 'text' });
      input.value = val;
      const cnt = h('div', { class: 'counter-r' });
      const upd = () => { cnt.textContent = `${input.value.length} / ${max}`; cnt.classList.toggle('warn', input.value.length > max * 0.9); };
      input.addEventListener('input', () => { set(input.value); upd(); });
      upd();
      return h('div', {}, input, cnt);
    },
    integer: (f, item, set) => numeric(f, item, set, 1),
    decimal: (f, item, set) => numeric(f, item, set, 0.01),
    select_one(f, item, set) {
      if (f.choicesFrom === 'organizations') {                               // the signed-in user's own organizations (identity service)
        const id = `org-${Math.random().toString(36).slice(2, 8)}`;
        const input = h('input', { class: 'input', list: id, placeholder: 'Start typing…', autocomplete: 'off' });
        const dl = h('datalist', { id }), status = h('div', { class: 'hint org-status' });
        const labelOf = (v) => ctx.orgs.get().find((c) => c.value === v)?.label ?? '';
        const sync = () => {
          const list = ctx.orgs.get(), st = ctx.orgs.state, have = ctx.orgs.loaded();
          CTX.choices[f.name] = list;
          dl.replaceChildren(...list.map((c) => h('option', { value: c.label })));
          if (document.activeElement !== input) input.value = labelOf(item[f.name]);
          if (have && list.length === 1 && item[f.name] === undefined && !input.dataset.auto) { input.dataset.auto = '1'; set(list[0].value); if (document.activeElement !== input) input.value = labelOf(list[0].value); }   // only one organization: select it
          status.textContent = !ctx.device.email ? 'No sign-in email on this phone, so organizations cannot be looked up.'
            : have && list.length === 1 && item[f.name] === list[0].value ? 'Your only organization — selected automatically.'
            : have && !list.length ? 'You are not a member of any organization yet — ask an admin to add you.'
            : !have && st === 'offline' ? 'Your organizations load once you have signal (needed once, then saved on this phone).'
            : !have ? 'Loading your organizations…'
            : st === 'offline' ? 'Using the organization list saved on this phone.' : '';
          refresh();
        };
        const commit = () => { const t = input.value.trim().toLowerCase(); const hit = ctx.orgs.get().find((c) => c.label.toLowerCase() === t); set(hit ? hit.value : undefined); };
        input.addEventListener('input', commit);
        input.addEventListener('change', () => { commit(); if (item[f.name] !== undefined) input.value = labelOf(item[f.name]); });
        cleanups.push(ctx.orgs.onChange(sync)); sync();
        if (!ctx.orgs.loaded()) ctx.orgs.refresh();
        return h('div', {}, input, dl, status);
      }
      if (f.appearance === 'autocomplete') {                                  // type to search a long list (e.g. customers)
        const id = `dl-${Math.random().toString(36).slice(2, 8)}`;
        const input = h('input', { class: 'input', list: id, placeholder: 'Start typing…', autocomplete: 'off' });
        const labelOf = (v) => f.choices.find((c) => c.value === v)?.label ?? '';
        input.value = labelOf(item[f.name]);
        const commit = () => {
          const t = input.value.trim().toLowerCase();
          const hit = f.choices.find((c) => c.label.toLowerCase() === t) || f.choices.find((c) => String(c.value).toLowerCase() === t);
          set(hit ? hit.value : undefined);
        };
        input.addEventListener('input', commit); input.addEventListener('change', () => { commit(); if (item[f.name] !== undefined) input.value = labelOf(item[f.name]); });
        return h('div', {}, input, h('datalist', { id }, f.choices.map((c) => h('option', { value: c.label }))));
      }
      if (f.appearance === 'dropdown') {
        const sel = h('select', { class: 'input' }, h('option', { value: '' }, 'Select…'), f.choices.map((c) => h('option', { value: c.value }, c.label)));
        sel.value = item[f.name] ?? '';
        sel.addEventListener('change', () => set(sel.value || undefined));
        return sel;
      }
      const box = h('div', { class: 'choices' + (f.appearance === 'horizontal' ? ' horiz' : '') });
      const draw = () => box.replaceChildren(...f.choices.map((c) => h('button', {
        type: 'button', class: 'choice' + (item[f.name] === c.value ? ' on' : ''), role: 'radio', 'aria-checked': item[f.name] === c.value,
        onclick: () => { set(c.value); draw(); },
      }, h('i', { class: 'dot' }), c.label)));
      draw(); return box;
    },
    select_multiple(f, item, set) {
      if (f.appearance === 'dropdown') {                                    // "minimal": compact multi-pick
        const box = h('details', { class: 'minimal' }, h('summary', {}, ''), h('div', { class: 'choices' }));
        const draw = () => {
          const cur = new Set(item[f.name] || []);
          box.querySelector('summary').textContent = cur.size ? f.choices.filter((c) => cur.has(c.value)).map((c) => c.label).join(', ') : 'Select…';
          box.querySelector('.choices').replaceChildren(...f.choices.map((c) => h('button', { type: 'button', class: 'choice check' + (cur.has(c.value) ? ' on' : ''), role: 'checkbox', 'aria-checked': cur.has(c.value),
            onclick: () => { cur.has(c.value) ? cur.delete(c.value) : cur.add(c.value); set([...cur]); draw(); } }, h('i', { class: 'dot' }), c.label)));
        };
        draw(); return box;
      }
      const box = h('div', { class: 'choices' + (f.appearance === 'horizontal' ? ' horiz' : '') });
      const draw = () => box.replaceChildren(...f.choices.map((c) => {
        const on = (item[f.name] || []).includes(c.value);
        return h('button', {
          type: 'button', class: 'choice check' + (on ? ' on' : ''), role: 'checkbox', 'aria-checked': on,
          onclick: () => { const cur = new Set(item[f.name] || []); on ? cur.delete(c.value) : cur.add(c.value); set([...cur]); draw(); },
        }, h('i', { class: 'dot' }), c.label);
      }));
      draw(); return box;
    },
    dateTime(f, item, set) {
      const input = h('input', { class: 'input', type: f.dateOnly ? 'date' : 'datetime-local' });
      input.value = (item[f.name] ?? '').slice(0, f.dateOnly ? 10 : 16);
      input.addEventListener('change', () => set(input.value || undefined));
      return input;
    },
    geopoint(f, item, set) {
      const out = h('div', { class: 'geo-out' });
      const show = () => {
        const v = item[f.name];
        out.replaceChildren(v ? h('span', {}, icon('pin'), `${v.lat.toFixed(5)}, ${v.lon.toFixed(5)}`, v.acc ? ` (±${Math.round(v.acc)} m)` : ' (manual)') : h('span', { class: 'muted' }, 'No location captured'));
      };
      const lat = h('input', { class: 'input', inputmode: 'decimal', placeholder: 'Latitude' });
      const lon = h('input', { class: 'input', inputmode: 'decimal', placeholder: 'Longitude' });
      const manual = h('div', { class: 'geo-manual', hidden: true }, lat, lon, h('button', { type: 'button', class: 'btn small', onclick: () => {
        const a = parseFloat(lat.value), b = parseFloat(lon.value);
        if (Number.isFinite(a) && Number.isFinite(b)) { set({ lat: a, lon: b, ts: Date.now() }); show(); }
      } }, 'Use'));
      const btn = h('button', { type: 'button', class: 'btn small', onclick: () => {
        btn.textContent = 'Locating…';
        if (!navigator.geolocation) { manual.hidden = false; btn.textContent = 'Capture location'; return; }
        navigator.geolocation.getCurrentPosition(
          (p) => { set({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, ts: Date.now() }); show(); btn.textContent = 'Recapture'; },
          () => { manual.hidden = false; btn.textContent = 'Retry GPS'; ctx.toast('No GPS fix — you can enter coordinates manually. Nothing is blocked.'); },
          { enableHighAccuracy: true, timeout: 8000 });
      } }, item[f.name] ? 'Recapture' : 'Capture location');
      show();
      return h('div', {}, out, h('div', { class: 'row' }, btn, h('button', { type: 'button', class: 'btn small ghost', onclick: () => { manual.hidden = !manual.hidden; } }, 'Enter manually')), manual);
    },
    image: (f, item, set, path) => (f.appearance === 'signature' ? signatureField(f, item, set, path) : imageField(f, item, set, path)),
  };

  function numeric(f, item, set, step) {
    const input = h('input', { class: 'input num', type: 'number', inputmode: step === 1 ? 'numeric' : 'decimal', step });
    input.value = item[f.name] ?? '';
    const push = () => set(input.value === '' ? undefined : Number(input.value));
    input.addEventListener('input', push);
    if (f.appearance !== 'stepper') return input;
    const bump = (d) => { input.value = (Number(input.value || 0) + d * step).toFixed(step < 1 ? 2 : 0); push(); };
    return h('div', { class: 'stepper' }, h('button', { type: 'button', class: 'btn', onclick: () => bump(-1), 'aria-label': 'Decrease' }, '−'), input, h('button', { type: 'button', class: 'btn', onclick: () => bump(1), 'aria-label': 'Increase' }, '+'));
  }

  // ---- image field: live counter, uniform camera/gallery/file, visible compression progress -------
  function imageField(f, item, set, path) {
    const ids = item[f.name] || (item[f.name] = []);
    const counter = h('div', { class: 'photo-counter' });
    const prog = h('div', { class: 'imgprog', hidden: true });
    const notes = h('div', { class: 'img-notes' });
    const grid = h('div', { class: 'thumbs' });
    let showAll = false;

    const info = (id) => {
      const r = ctx.engine.media.get(id), remote = shared?.remotePhoto(sub.id, id);
      if (r) return { thumb: r.thumb, name: r.name, size: r.size, state: r.state, mine: !r.relayed, by: r.relayedFrom, noMeta: r.meta?.noLocation || r.meta?.noTimestamp, err: r.state !== 'done' ? r.lastError : null };
      if (remote) return { thumb: remote.thumb, name: remote.name, size: remote.size, state: remote.received ? 'done' : 'queued', mine: false, by: remote.byName, noMeta: remote.meta?.noLocation };
      return null;
    };
    const min = f.minFiles ?? (f.required ? 1 : 0);
    const draw = () => {
      const n = ids.length;
      const okMin = n >= min, okMax = f.maxFiles == null || n <= f.maxFiles;
      counter.className = 'photo-counter ' + (okMin && okMax ? 'ok' : 'need');
      counter.replaceChildren(icon('image'), h('b', {}, `${n}`), ` photo${n === 1 ? '' : 's'}`,
        min ? ` · ${Math.min(n, min)} of ${min} required` : '', f.maxFiles != null ? ` · max ${f.maxFiles}` : '');
      const recs = ids.map((id) => ({ id, ...info(id) })).filter((r) => r.thumb || r.name);
      const cap = showAll ? recs.length : 48;
      grid.replaceChildren(...[
        ...recs.slice(0, cap).map((r) => h('div', { class: `thumb st-${r.state}${r.noMeta ? ' nometa' : ''}${r.mine ? '' : ' theirs'}${r.err ? ' flagged' : ''}`, title: `${r.name} · ${fmtBytes(r.size || 0)}${r.by ? ` · by ${r.by}` : ''}${r.err ? ` · failed to send: ${r.err}` : ''}` },
          r.err ? h('button', { type: 'button', class: 'replace', onclick: async () => { ids.splice(ids.indexOf(r.id), 1); await ctx.engine.removeMedia(r.id); set(ids); draw(); openCam(); } }, `${r.err} · Replace`) : null,
          h('img', { src: r.thumb, alt: r.name, loading: 'lazy' }),
          r.mine ? null : h('span', { class: 'by' }, initials(r.by)),
          h('button', { type: 'button', class: 'rm', 'aria-label': `Remove ${r.name}`, onclick: async () => { ids.splice(ids.indexOf(r.id), 1); if (r.mine) await ctx.engine.removeMedia(r.id); set(ids); draw(); } }, '×'))),
        recs.length > cap ? h('button', { type: 'button', class: 'thumb more', onclick: () => { showAll = true; draw(); } }, `+${recs.length - cap}`) : null].filter(Boolean));
      const noMeta = recs.filter((r) => r.noMeta).length;
      notes.replaceChildren(...(noMeta ? [h('div', { class: 'flag' }, icon('info'), `${noMeta} photo${noMeta === 1 ? '' : 's'} without GPS/time metadata (kept; flagged in the record)`)] : []));
    };
    if (shared) { ctx.collab.addEventListener('change', draw); cleanups.push(() => ctx.collab.removeEventListener('change', draw)); }
    ctx.engine.addEventListener('change', draw); cleanups.push(() => ctx.engine.removeEventListener('change', draw));

    let chain = Promise.resolve();
    const ingest = (files) => (chain = chain.then(() => ingestNow(files)));          // rapid-fire shots are processed one batch at a time
    const ingestNow = async (files) => {
      files = [...files]; if (!files.length) return;
      if (f.maxFiles === 1 && ids.length) { for (const id of ids.splice(0)) await ctx.engine.removeMedia(id); files = files.slice(0, 1); }
      const room = f.maxFiles == null ? files.length : Math.max(0, f.maxFiles - ids.length);
      if (files.length > room) { ctx.toast(`Limit is ${f.maxFiles}: adding ${room}, skipped ${files.length - room}.`); files = files.slice(0, room); }
      prog.hidden = false;
      try {
        const r = await addImages(ctx.engine, sub, path, files, {
          original: ctx.settings?.original,
          onProgress: (p) => prog.replaceChildren(h('div', { class: 'bar' }, h('i', { style: `width:${(p.done / p.total) * 100}%` })),
            h('small', {}, `Optimising ${p.done}/${p.total} · ${fmtBytes(p.origBytes)} → ${fmtBytes(p.bytes)}`)),
        });
        if (f.fileName) {                                                       // XLSForm "fileName=" parameter: name each photo from an expression
          const keep = [...ids];
          for (let i = 0; i < r.ids.length; i++) {
            item[f.name] = [...keep, ...r.ids.slice(0, i)];                     // so countselected(...)+1 numbers them 1, 2, 3…
            S.recalc(survey, sub.answers);
            const nm = S.ev(f.fileName, S.scopeOf(sub.answers, item, f.name), '');
            const rec = ctx.engine.media.get(r.ids[i]);
            if (rec && nm) { rec.name = `${String(nm).replace(/[^\w.-]+/g, '_')}.jpg`; await ctx.db.put('media', rec); }
          }
          item[f.name] = ids;
        }
        ids.push(...r.ids); set(ids);
        for (const e of r.errors) ctx.toast(`${e.code}: ${e.detail}`, 6000);
      } catch (e) { ctx.toast(`${e.code || 'ERR-GEN-000'}: ${e.message}`, 6000); }
      prog.hidden = true; draw();
    };

    const cam = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: (e) => { ingest(e.target.files); e.target.value = ''; } });
    const gal = h('input', { type: 'file', accept: 'image/*', multiple: f.maxFiles !== 1, hidden: true, onchange: (e) => { ingest(e.target.files); e.target.value = ''; } });
    const openCam = () => (ctx.has('camera') ? openCamera({ container: document.querySelector('.device') || document.body, defaultZoom: f.defaultZoom ?? 1, title: f.label || 'Camera', onShot: (file) => ingest([file]), fallbackInput: cam, multi: ing, tip: photoTip(f, item, path) }) : cam.click());
    const mode = f.appearance || 'both';
    const buttons = h('div', { class: 'row' },
      mode !== 'gallery' ? h('button', { type: 'button', class: 'btn small primary', onclick: openCam }, icon('camera'), 'Camera') : null,
      mode !== 'camera' && ctx.allow?.('gallery') !== false ? h('button', { type: 'button', class: 'btn small', onclick: () => gal.click() }, icon('image'), 'Gallery / files') : null);
    draw();
    return h('div', { class: 'imagefield' }, counter, buttons, cam, gal, prog, notes, grid);
  }

  // ---- signature pad: drawn on a canvas, stored like any other photo -------------------------------
  function signatureField(f, item, set, path) {
    const ids = item[f.name] || (item[f.name] = []);
    const cv = h('canvas', { class: 'sig', width: 640, height: 240, 'aria-label': 'Signature area' });
    const g = cv.getContext('2d'); g.lineWidth = 4; g.lineCap = 'round'; g.strokeStyle = '#0f172a';
    const done = h('div', { class: 'sig-done', hidden: true });
    let drawing = false, dirty = false;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * (cv.width / r.width), (e.clientY - r.top) * (cv.height / r.height)]; };
    cv.addEventListener('pointerdown', (e) => { drawing = true; cv.setPointerCapture(e.pointerId); g.beginPath(); g.moveTo(...pos(e)); dirty = true; });
    cv.addEventListener('pointermove', (e) => { if (drawing) { g.lineTo(...pos(e)); g.stroke(); } });
    cv.addEventListener('pointerup', () => { drawing = false; });
    const show = () => {
      const r = ids[0] && ctx.engine.media.get(ids[0]), remote = ids[0] && shared?.remotePhoto(sub.id, ids[0]);
      const t = r?.thumb || remote?.thumb;
      done.hidden = !ids.length; cv.hidden = !!ids.length;
      done.replaceChildren(...(ids.length ? [t ? h('img', { src: t, alt: 'Saved signature' }) : null, h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Signature saved'), h('button', { type: 'button', class: 'btn small ghost', onclick: async () => { for (const id of ids.splice(0)) await ctx.engine.removeMedia(id); set(ids); show(); } }, 'Redo'))].filter(Boolean) : []));
      clearBtn.hidden = saveBtn.hidden = !!ids.length;
    };
    const clearBtn = h('button', { type: 'button', class: 'btn small ghost', onclick: () => { g.clearRect(0, 0, cv.width, cv.height); dirty = false; } }, 'Clear');
    const saveBtn = h('button', { type: 'button', class: 'btn small primary', onclick: async () => {
      if (!dirty) return ctx.toast('Sign in the box first.');
      const out = document.createElement('canvas'); out.width = cv.width; out.height = cv.height;
      const o = out.getContext('2d'); o.fillStyle = '#fff'; o.fillRect(0, 0, out.width, out.height); o.drawImage(cv, 0, 0);
      const blob = await new Promise((r) => out.toBlob(r, 'image/png'));
      const r = await addImages(ctx.engine, sub, path, [new File([blob], 'signature.png', { type: 'image/png' })]);
      if (f.fileName && r.ids[0]) {
        S.recalc(survey, sub.answers);
        const nm = S.ev(f.fileName, S.scopeOf(sub.answers, item, f.name), ''), rec = ctx.engine.media.get(r.ids[0]);
        if (rec && nm) { rec.name = `${String(nm).replace(/[^\w.-]+/g, '_')}.jpg`; await ctx.db.put('media', rec); }
      }
      ids.push(...r.ids); set(ids); show();
    } }, 'Save signature');
    show();
    return h('div', { class: 'sigfield' }, cv, done, h('div', { class: 'row' }, saveBtn, clearBtn));
  }

  // ---- repeat -------------------------------------------------------------------------------------
  function repeatEl(f, item, path) {
    const arr = item[f.name] || (item[f.name] = []);
    while (f.repeatCount && arr.length < f.repeatCount) { const it = { _id: newId() }; S.applyDefaults(f.fields, it, ctx.device); arr.push(it); }
    arr.forEach((it) => { it._id ||= newId(); });
    const fixed = !!f.repeatCount;
    const carries = f.fields.filter((x) => x.carry);
    /** A new entry starts from the last one: wire size, strands and preform color carry over, and the level counts up, so the crew does not retype about twelve levels. */
    const newEntry = () => { const it = { _id: newId() }; S.applyDefaults(f.fields, it, ctx.device); const last = arr[arr.length - 1];
      if (last) for (const sf of f.fields) { if (sf.carry && last[sf.name] !== undefined) it[sf.name] = structuredClone(last[sf.name]); if (sf.increment && Number.isFinite(Number(last[sf.name]))) it[sf.name] = Number(last[sf.name]) + 1; }
      return it; };
    const fillOthers = (from) => { let n = 0; for (const o of arr) if (o !== from) for (const sf of carries) if (S.isEmpty(o[sf.name]) && !S.isEmpty(from[sf.name])) { o[sf.name] = structuredClone(from[sf.name]); n++; } ctx.toast(n ? `Filled ${n} blank value${n === 1 ? '' : 's'} on the other levels.` : 'The other levels already have values.'); changed(); draw(); };
    const list = h('div', { class: 'repeat' });
    const draw = () => {
      list.replaceChildren(...arr.map((it, i) => {
        const p = `${path}[${i}].`;
        const kids = f.fields.map((nf) => fieldEl(nf.type === 'image' ? { ...nf } : nf, it, p)).filter(Boolean);
        return h('div', { class: 'rcard' + (f.appearance === 'cards-grid' ? ' grid' : ''), 'data-path': `${path}/${it._id}` },
          h('div', { class: 'rhead' }, h('b', {}, `${stripHtml(f.label || f.name)} ${it.level ?? i + 1}${f.numbered ? ` · wire ${wireNumber(arr, it)}` : ''}`), h('span', { class: 'grow' }), carries.length && arr.length > 1 ? h('button', { type: 'button', class: 'btn small ghost', onclick: () => fillOthers(it) }, 'Fill other levels') : null,
            fixed ? null : h('button', { type: 'button', class: 'btn small ghost', onclick: () => { arr.splice(i + 1, 0, cloneItem(f.fields, it)); changed(); draw(); } }, 'Duplicate'),
            fixed ? null : h('button', { type: 'button', class: 'btn small ghost danger', onclick: async () => {
              for (const id of S.mediaIn(f.fields, it)) await ctx.engine.removeMedia(id);
              arr.splice(i, 1); changed(); draw();
            } }, 'Remove')),
          kids);
      }));
      refresh();
    };
    draw();
    return h('div', {}, h('div', { class: 'lbl' }, htmlFragment(f.label || f.name)), list,
      fixed ? null : h('button', { type: 'button', class: 'btn add', onclick: () => { arr.push(newEntry()); changed(); draw(); } }, `+ ${stripHtml(f.addLabel || 'Add')}`));
  }
  function cloneItem(fields, it) {
    const c = { _id: newId() };
    for (const f of fields) {
      if (f.type === 'image') c[f.name] = [];                                  // photos are unique per entry
      else if (f.type === 'repeat') c[f.name] = (it[f.name] || []).map((x) => cloneItem(f.fields, x));
      else if (!['calculate'].includes(f.type) && it[f.name] !== undefined) c[f.name] = structuredClone(it[f.name]);
    }
    return c;
  }


  // =================================================================================================
  // Ingress layout: section tabs, a sections drawer, a Previous / Mark all checked / Next section bar, required fields with
  // N/A or Could not record, per-field checks and a Check survey list. Same fields underneath.
  // =================================================================================================
  function sectionName(pg) { return stripHtml(pg.section || pg.label || pg.name); }
  function sectionList() {
    const out = [];
    pages.forEach((pg, i) => { const n = sectionName(pg); let sc = out.find((x) => x.name === n); if (!sc) out.push(sc = { name: n, idx: [] }); sc.idx.push(i); });
    return out;
  }
  /** What can be checked on a page: every visible field, and each repeat entry as one card. */
  function checkables(pg) {
    const list = [];
    const walk = (fields, item, prefix) => {
      for (const f of fields) {
        if (f.type === 'calculate' || f.type === 'note' || f.appearance === 'hidden') continue;
        if (!S.isRelevant(f, S.scopeOf(sub.answers, item, f.name))) continue;
        const path = prefix + f.name;
        if (f.type === 'repeat') { (item[f.name] || []).forEach((it, i) => list.push({ path: `${path}[${i}]`, f, item: it, entry: true })); continue; }
        list.push({ path, f, item });
      }
    };
    walk(pg.fields, sub.answers, '');
    return list;
  }
  const entryAnswered = (c) => c.f.fields.every((f) => f.type === 'calculate' || f.type === 'note' || f.appearance === 'hidden' || !(f.required || f.minFiles > 0) || (f.type === 'image' ? (c.item[f.name] || []).length >= (f.minFiles ?? 1) : (c.item[f.name + '__state'] || !S.isEmpty(c.item[f.name]))));
  const answeredNow = (c) => c.entry ? entryAnswered(c) : (c.item[c.f.name + '__state'] || (c.f.type === 'image' ? (c.item[c.f.name] || []).length > 0 : !S.isEmpty(c.item[c.f.name])));
  const pageStats = (i) => { const l = checkables(pages[i]); return { total: l.length, done: l.filter(answeredNow).length }; };
  const allStats = () => pages.reduce((a, _, i) => { const s2 = pageStats(i); a.total += s2.total; a.done += s2.done; return a; }, { total: 0, done: 0 });

  function checkBtn(path) {
    const b = h('button', { type: 'button', class: 'chk', 'aria-label': 'Checked', onclick: () => { sub.checked[path] = !sub.checked[path]; b.classList.toggle('on', !!sub.checked[path]); saveNow(); updateIngress(); } }, icon('check', 16));
    b.classList.toggle('on', !!sub.checked[path]); return b;
  }
  function ingFooter(f, item, path, wrap, entry, set) {
    if (f.type === 'image' && f.appearance === 'signature') return null;
    const stateKey = f.name + '__state';
    const pill = h('span', { class: 'ans-pill' }, 'Answered');
    const chips = f.required && f.type !== 'image' ? [['na', 'N/A'], ['unrecorded', 'Could not record']].map(([k, l]) => {
      const b = h('button', { type: 'button', class: 'na-chip' + (item[stateKey] === k ? ' on' : ''), onclick: () => {
        if (item[stateKey] === k) delete item[stateKey]; else { item[stateKey] = k; sub.checked[path] = true; }
        wrap.classList.toggle('na', !!item[stateKey]); changed(); chips.forEach((x) => x.classList.toggle('on', item[stateKey] === x.dataset.k));
      } }, l);
      b.dataset.k = k; return b;
    }) : [];
    entry.status = () => {
      const ok = !!item[stateKey] || (f.type === 'image' ? (item[f.name] || []).length > 0 : !S.isEmpty(item[f.name]));
      pill.hidden = !ok;
      wrap.classList.toggle('na', !!item[stateKey]);
    };
    return h('div', { class: 'ing-foot' }, ...chips, h('span', { class: 'grow' }), pill);
  }

  function issuesNow() {
    const fieldAt = (path) => {
      const nm = path.replace(/\[\d+\]\./g, '.').split('.').pop();
      let hit = null;
      const walk = (fields) => fields.forEach((f) => { if (f.name === nm) hit = f; if (f.fields) walk(f.fields); });
      survey.pages.forEach((p) => walk(p.fields)); return hit;
    };
    return S.validate(survey, sub.answers).map((is) => {
      const f = fieldAt(is.path), label = stripHtml(f?.label || is.path);
      const kind = is.code === 'ERR-IMG-003' ? 'photo' : 'field';
      const title = kind === 'photo' ? (/^\S.*: 0 of/.test(is.message) ? `${label} has no photo` : `${label}: ${is.message.replace(/^.*?: /, '')}`) : is.code === 'ERR-FIELD-001' ? `${label} is blank` : is.message;
      const pg = survey.pages[is.pageIdx];
      return { ...is, kind, title, where: `${sectionName(pg)} · ${stripHtml(pg.label || pg.name)}`, pageIdx: pages.indexOf(pg) };
    });
  }
  function openCheck() {
    const list = issuesNow(), nField = list.filter((x) => x.kind === 'field').length, nPhoto = list.filter((x) => x.kind === 'photo').length;
    const goto = (is) => { close(); page = Math.max(0, is.pageIdx); focusPath = is.path; saveNow(); draw(); };
    const close = ctx.sheet('Check survey',
      h('p', { class: 'muted' }, list.length ? `${list.length} thing${list.length === 1 ? '' : 's'} to fix before you submit` : 'Everything required is answered.'),
      h('div', { class: 'chips' }, nField ? h('span', { class: 'pill blocked' }, `${nField} missing field${nField === 1 ? '' : 's'}`) : null, nPhoto ? h('span', { class: 'pill err' }, `${nPhoto} missing photo${nPhoto === 1 ? '' : 's'}`) : null),
      ...list.slice(0, 4).map((is) => h('button', { type: 'button', class: 'check-row', onclick: () => goto(is) }, h('div', {}, h('b', {}, is.title), h('small', { class: 'muted block' }, is.where)), h('span', { class: 'link' }, 'Go to'))),
      list.length > 4 ? h('small', { class: 'muted' }, `+ ${list.length - 4} more`) : null,
      list.length ? h('button', { type: 'button', class: 'btn primary big', onclick: () => goto(list[0]) }, 'Fix next issue') : h('button', { type: 'button', class: 'btn primary big', onclick: () => { close(); onFinish?.(); } }, 'Finish'),
      h('small', { class: 'muted center' }, 'Submit stays off until the check passes (to decide)'));
  }
  function openDrawer() {
    const secs = sectionList(), here = sectionName(pages[page]);
    const filter = h('input', { class: 'input', placeholder: 'Filter sections…', 'aria-label': 'Filter sections' });
    const list = h('div', { class: 'drawer-list' });
    const close = () => { dr.remove(); };
    const draw2 = () => {
      const q = filter.value.trim().toLowerCase();
      list.replaceChildren(...secs.filter((sc) => !q || sc.name.toLowerCase().includes(q)).map((sc) => {
        const st = sc.idx.reduce((a, i) => { const x = pageStats(i); a.total += x.total; a.done += x.done; return a; }, { total: 0, done: 0 });
        return h('div', { class: 'drawer-sec' + (sc.name === here ? ' on' : '') },
          h('button', { type: 'button', class: 'drawer-row', onclick: () => { page = sc.idx[0]; close(); saveNow(); draw(); } }, h('b', {}, sc.name), h('span', { class: 'count' }, st.total),
            st.total ? h('small', { class: 'muted block' }, `${st.done}/${st.total} answered`) : null, st.total ? h('div', { class: 'bar' }, h('i', { style: `width:${(st.done / st.total) * 100}%` })) : null),
          sc.name === here && sc.idx.length > 1 ? h('div', { class: 'drawer-sub' }, sc.idx.map((i) => h('button', { type: 'button', class: i === page ? 'on' : '', onclick: () => { page = i; close(); saveNow(); draw(); } }, stripHtml(pages[i].label || pages[i].name)))) : null);
      }));
    };
    filter.addEventListener('input', draw2); draw2();
    const vn = visitNav?.();
    const dr = h('div', { class: 'drawer-wrap' }, h('div', { class: 'drawer' }, vn ? h('div', { class: 'vnav' }, h('h3', { class: 'drawer-title' }, 'Surveys in this visit'), h('small', { class: 'muted' }, vn.title), ...vn.rows.map((r) => h('button', { type: 'button', class: 'vnav-row' + (r.current ? ' on' : ''), disabled: r.current || r.disabled, onclick: () => { close(); saveNow(); r.go(); } }, h('span', { class: 'vn-t' }, r.title, r.need === 'optional' ? h('i', {}, ' optional') : null), h('span', { class: 'vn-s' }, r.current ? 'You are here' : r.label)))) : null,
        h('h3', { class: 'drawer-title' }, 'Sections'), h('small', { class: 'muted' }, subtitle || survey.title), filter, list, onCopy ? h('button', { type: 'button', class: 'btn drawer-copy', onclick: () => { close(); onCopy(); } }, icon('copy', 16), 'Copy from another survey') : null, h('button', { type: 'button', class: 'btn drawer-copy', onclick: () => { close(); saveNow(); onExit(); } }, icon('back', 16), 'Save and exit')), h('button', { type: 'button', class: 'drawer-dim', 'aria-label': 'Close sections', onclick: close }));
    ingRoot.append(dr);
  }
  function markAll() {
    const l = checkables(pages[page]); let missing = 0;
    for (const c of l) { if (c.f.required && !answeredNow(c)) { missing++; continue; } sub.checked[c.path] = true; }
    saveNow(); refresh();
    if (missing) ctx.toast(`${missing} required answer${missing === 1 ? ' is' : 's are'} still missing, not marked.`);
  }
  /** Previous / Next walk every page in order (tab by tab, across sections), so nothing is skipped. The menu is for jumping. */
  function sectionJump(dir) {
    const to = page + dir;
    if (to < 0) return;
    if (to >= pages.length) { const is = issuesNow(); is.length ? openCheck() : onFinish?.(); return; }
    page = to; saveNow(); draw(); body.scrollTop = 0;
  }
  function updateIngress() {
    if (!ingRoot) return;
    const secs = sectionList(), here = secs.findIndex((x) => x.idx.includes(page)), st = allStats(), pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
    const q = (s2) => ingRoot.querySelector(s2);
    q('.ing-title b').textContent = survey.title; q('.ing-title small').textContent = subtitle;
    const done = st.total > 0 && st.done === st.total;
    const pill = q('.ing-pill'); pill.textContent = done ? 'All answered' : (status || 'In progress'); pill.className = 'ing-pill' + (done ? ' done' : '');
    q('.ing-prog i').style.width = `${pct}%`; q('.ing-pct').textContent = `${pct}%`; q('.ing-fields').textContent = `${st.done}/${st.total} fields`;
    const sc = secs[here];
    q('.ing-tabs').replaceChildren(...sc.idx.map((i) => { const t = pageStats(i), ok = t.total > 0 && t.done === t.total;
      return h('button', { type: 'button', class: 'ing-tab' + (i === page ? ' on' : ''), onclick: () => { page = i; saveNow(); draw(); body.scrollTop = 0; } }, stripHtml(pages[i].label || pages[i].name), t.total ? h('i', { class: 'tabmark ' + (ok ? 'ok' : 'todo'), title: ok ? 'All answered' : `${t.total - t.done} to answer` }, ok ? icon('check', 11) : null) : null); }));
    q('.ing-tabs').hidden = sc.idx.length < 2;
    const ss = sc.idx.reduce((a, i) => { const x = pageStats(i); a.total += x.total; a.done += x.done; return a; }, { total: 0, done: 0 }), spct = ss.total ? Math.round((ss.done / ss.total) * 100) : 0;
    q('.ing-sechead .sh-l b').textContent = sc.name;
    q('.ing-sechead small').textContent = checkables(pages[page]).some((c) => c.f.required && c.f.type !== 'image') ? 'Required on site. N/A and Could not record count as answers.' : `${ss.done} of ${ss.total} fields answered`;
    q('.sh-r .ing-prog i').style.width = `${spct}%`; q('.sh-pct').textContent = `${spct}%`; q('.sh-r').hidden = !ss.total;
    q('.ing-prev').disabled = page === 0;
    const nx = pages[page + 1]; q('.ing-next').textContent = !nx ? 'Finish' : stripHtml(nx.label || nx.name);
  }
  function buildIngress() {
    const r = h('div', { class: 'screen ing' },
      h('header', { class: 'ing-head' },
        h('div', { class: 'ing-top' }, h('button', { type: 'button', class: 'iconbtn ink', 'aria-label': 'Sections', onclick: () => { saveNow(); openDrawer(); } }, icon('menu', 20)),
          h('div', { class: 'ing-title' }, h('b', {}), h('small', {})), h('button', { type: 'button', class: 'ing-pill', onclick: () => { if (beta()) openCheck(); } }, '')),
        h('div', { class: 'ing-progrow' }, h('div', { class: 'ing-prog' }, h('i')), h('b', { class: 'ing-pct' }), h('small', { class: 'ing-fields muted' })),
        h('div', { class: 'ing-tabs' })),
      banner ? h('div', { class: 'welcome-back' }, icon('check', 18), h('div', {}, ...String(banner).split('|').map((t, i) => (i ? h('small', {}, t) : h('b', {}, t))))) : null,
      h('div', { class: 'ing-sechead' }, h('div', { class: 'sh-l' }, h('b'), h('small', { class: 'muted' })), h('div', { class: 'sh-r' }, h('div', { class: 'ing-prog sm' }, h('i')), h('b', { class: 'sh-pct' }))),
      body,
      h('footer', { class: 'ing-bar' }, h('button', { type: 'button', class: 'btn ing-prev', onclick: () => sectionJump(-1) }, 'Previous'), beta() ? h('button', { type: 'button', class: 'btn primary', onclick: openCheck }, 'Check survey') : null, h('button', { type: 'button', class: 'btn ing-next', onclick: () => sectionJump(1) }, 'Next')));
    body.classList.add('ing-body');
    return r;
  }
  if (ing) { body.prepend = body.prepend.bind(body); }

  if (pullAll()) { S.recalc(survey, sub.answers); saveNow(); }
  draw();
  if (ing) { updateIngress(); ingRoot.api = { openCheck, openDrawer, markAll, go: (i) => { page = i; draw(); }, issues: issuesNow, page: () => page }; return ingRoot; }
  return root;
}

// =================================================================================================
// Review: pre-submit validation with coded errors, before anything touches the network.
// =================================================================================================
export function renderReview(ctx, sub, { onEdit, onBack, onSent }) {
  const shared = sub.shared ? ctx.collab : null;
  const survey = surveyOf(ctx, sub);
  setChoices(survey);
  if (shared) { shared.flush(sub.id); sub.answers = shared.open(sub.id); }
  S.recalc(survey, sub.answers);
  const issues = S.validate(survey, sub.answers);
  const { answers, mediaIds } = S.prune(survey, sub.answers);
  const media = [...mediaIds].map((id) => {
    const r = ctx.engine.media.get(id), rem = shared?.remotePhoto(sub.id, id);
    return r ? { size: r.size, orig: r.origSize || r.size, noLoc: r.meta?.noLocation } : rem ? { size: rem.size || 0, orig: rem.size || 0, noLoc: rem.meta?.noLocation } : null;
  }).filter(Boolean);
  const bytes = media.reduce((n, m) => n + m.size, 0), orig = media.reduce((n, m) => n + m.orig, 0);
  const noMeta = media.filter((m) => m.noLoc).length;

  const stat = (v, l) => h('div', { class: 'stat' }, h('b', {}, v), h('small', {}, l));
  const issueCard = (is) => {
    const d = describe(is.code);
    return h('div', { class: 'issue' },
      h('div', { class: 'issue-top' }, h('code', { class: 'chip err' }, is.code), h('b', {}, d.title)),
      h('p', {}, is.message),
      h('small', { class: 'muted' }, `${survey.pages[is.pageIdx].label || survey.pages[is.pageIdx].name} · ${d.cause}`),
      h('button', { class: 'btn small primary', onclick: () => onEdit(is.pageIdx, is.path) }, d.fix));
  };

  const result = h('div', {});
  const team = shared ? teamPanel(ctx, sub) : null;

  async function submit(force) {
    send.disabled = true; send.textContent = shared ? 'Submitting…' : 'Saving to device…';
    result.replaceChildren();
    try {
      if (shared) {
        S.stampEnd(survey, sub.answers); shared.localChanged(sub.id, sub.answers); shared.flush(sub.id);
        await ctx.collab.submit(sub.id, { force });
        onSent();
      } else {
        S.stampEnd(survey, sub.answers);
        const pruned = S.prune(survey, sub.answers);
        sub.answers = pruned.answers; sub.label = S.instanceLabel(survey, pruned.answers) || pruned.answers.siteId || pruned.answers.site_id || sub.label || 'Untitled';
        await ctx.engine.submit(sub, pruned.mediaIds);
        onSent();
      }
    } catch (e) {
      send.disabled = issues.length > 0 || unsorted > 0 || !allowed; send.textContent = sendLabel();
      const code = e.code || 'ERR-GEN-000', d = describe(code);
      result.replaceChildren(h('div', { class: 'issue' },
        h('div', { class: 'issue-top' }, h('code', { class: 'chip err' }, code), h('b', {}, d.title)),
        h('p', {}, e.message), h('small', { class: 'muted' }, d.cause),
        code === 'ERR-COLLAB-003' ? h('div', { class: 'row' }, h('button', { class: 'btn small primary', onclick: () => submit(true) }, 'Submit anyway'), h('button', { class: 'btn small', onclick: () => submit(false) }, 'Check again')) : null,
        code === 'ERR-COLLAB-001' ? h('button', { class: 'btn small primary', onclick: () => submit(false) }, 'Check again') : null,
        e.code?.startsWith('ERR-NET') ? h('p', { class: 'muted' }, 'Your changes are safe on this phone and will sync when service returns. Submit once you are back in signal.') : null));
    }
  }
  const unsorted = (sub.inbox || []).length;
  const sendLabel = () => (issues.length ? `Fix ${issues.length} issue${issues.length === 1 ? '' : 's'} to send` : unsorted ? `Sort ${unsorted} photo${unsorted === 1 ? '' : 's'} to send` : !allowed ? 'Only a crew lead can submit' : shared ? 'Submit team record' : 'Save & send');
  const allowed = !shared || ctx.can('submit');
  const send = h('button', { class: 'btn primary big', disabled: issues.length > 0 || unsorted > 0 || !allowed, onclick: () => submit(false) },
    sendLabel());
  const contrib = shared && ctx.has('attribution') ? ctx.collab.contributors(sub.id) : [];

  const root = h('div', { class: 'screen' },
    h('header', { class: 'appbar' }, h('button', { class: 'iconbtn', onclick: onBack, 'aria-label': 'Back to form' }, icon('back')), h('div', { class: 'ab-title' }, h('b', {}, 'Review & send'), h('small', {}, S.instanceLabel(survey, answers) || answers.siteId || answers.site_id || sub.label || 'Untitled'))),
    h('div', { class: 'scroll pad' },
      team ? team.el : null,
      h('div', { class: 'stats' }, stat(media.length, 'photos'), stat(fmtBytes(bytes), shared ? 'on team record' : 'to upload'), stat(orig > 0 && !shared ? `${Math.round((1 - bytes / orig) * 100)}%` : '—', shared ? '' : `saved (was ${fmtBytes(orig)})`)),
      noMeta ? h('div', { class: 'flag' }, icon('info'), `${noMeta} photo(s) have no GPS metadata. They will be sent and flagged.`) : null,
      unsorted ? h('div', { class: 'flag' }, icon('alert'), `${unsorted} photo${unsorted === 1 ? ' is' : 's are'} still unsorted (photo-first) and would not be sent.`, h('button', { type: 'button', class: 'btn small primary', onclick: () => ctx.openPhotoFirst(sub) }, 'Sort now')) : null,
      !allowed ? h('div', { class: 'flag' }, icon('info'), `You are signed in as ${ROLES[ctx.role()]}. Crew members add photos and data; the crew lead submits.`, h('button', { type: 'button', class: 'btn small ghost', onclick: () => submit(false) }, 'Demo: try anyway')) : null,
      contrib.length ? h('section', {}, h('h3', {}, 'Who captured what'), contributorsTable(contrib)) : null,
      issues.length
        ? h('section', {}, h('h3', {}, `${issues.length} thing${issues.length === 1 ? '' : 's'} to fix before sending`), issues.map(issueCard))
        : h('div', { class: 'ok-card' }, icon('check'), h('div', {}, h('b', {}, 'Ready to send'), h('p', {}, shared
          ? 'Everyone’s answers are merged. Photos upload from each phone; the record is accepted once all of them have arrived.'
          : 'Answers and photos are written to this device first, then uploaded in the background. It’s safe to lose signal, switch apps or close this one.'))),
      allowed ? send : h('div', {}, send), result));
  root.cleanup = () => team?.el.cleanup?.();
  return root;
}
