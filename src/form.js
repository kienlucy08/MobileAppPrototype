import { h, fmtBytes, debounce, htmlFragment, stripHtml } from './util.js';
import { setChoices, CTX } from './expr.js';
import * as S from './schema.js';
import { addImages } from './images.js';
import { openCamera } from './capture.js';
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
export function renderForm(ctx, sub, { startPage = 0, focusPath = null, onExit, onReview }) {
  const shared = sub.shared ? ctx.collab : null;
  const survey = surveyOf(ctx, sub);
  setChoices(survey);
  const pages = survey.pages.filter(hasVisible);
  let page = Math.max(0, pages.indexOf(survey.pages[Math.min(startPage, survey.pages.length - 1)]));
  let wrappers = [], pendingRemote = null;
  const cleanups = [];

  if (shared) { sub.answers = shared.open(sub.id); S.recalc(survey, sub.answers); }

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

  const saveNow = () => {
    sub.page = survey.pages.indexOf(pages[page]); sub.updatedAt = Date.now();
    if (shared) { shared.flush(sub.id); return Promise.resolve(); }
    return ctx.db.put('submissions', sub);
  };
  const save = debounce(saveNow, 400);
  const changed = () => {
    S.recalc(survey, sub.answers); refresh();
    if (shared) shared.localChanged(sub.id, sub.answers); else save();
  };
  const refresh = () => {
    wrappers = wrappers.filter((w) => body.contains(w.el));
    for (const w of wrappers) { w.el.hidden = !w.visible(); w.relabel?.(); w.sync?.(); }
  };
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
    title.replaceChildren(h('b', {}, survey.title), h('small', {}, `${stripHtml(pg.label || pg.name)} · ${page + 1} of ${pages.length}`));
    bar.firstChild.style.width = `${((page + 1) / pages.length) * 100}%`;
    body.replaceChildren(...pg.fields.map((f) => fieldEl(f, sub.answers, '')).filter(Boolean));
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
    const entry = { el: wrap, visible: () => S.isRelevant(f, S.scopeOf(sub.answers, item, f.name)) };
    wrappers.push(entry);
    const dynamic = (t) => /\$\{/.test(t || '');

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
    ].filter(Boolean));
    return wrap;
  }

  const controls = {
    text(f, item, set) {
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
    const openCam = () => (ctx.has('camera') ? openCamera({ container: document.querySelector('.device') || document.body, defaultZoom: f.defaultZoom ?? 1, title: f.label || 'Camera', onShot: (file) => ingest([file]), fallbackInput: cam }) : cam.click());
    const mode = f.appearance || 'both';
    const buttons = h('div', { class: 'row' },
      mode !== 'gallery' ? h('button', { type: 'button', class: 'btn small primary', onclick: openCam }, icon('camera'), 'Camera') : null,
      mode !== 'camera' ? h('button', { type: 'button', class: 'btn small', onclick: () => gal.click() }, icon('image'), 'Gallery / files') : null);
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
    const list = h('div', { class: 'repeat' });
    const draw = () => {
      list.replaceChildren(...arr.map((it, i) => {
        const p = `${path}[${i}].`;
        const kids = f.fields.map((nf) => fieldEl(nf.type === 'image' ? { ...nf } : nf, it, p)).filter(Boolean);
        return h('div', { class: 'rcard', 'data-path': `${path}/${it._id}` },
          h('div', { class: 'rhead' }, h('b', {}, `${stripHtml(f.label || f.name)} ${i + 1}`), h('span', { class: 'grow' }),
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
      fixed ? null : h('button', { type: 'button', class: 'btn add', onclick: () => { const it = { _id: newId() }; S.applyDefaults(f.fields, it, ctx.device); arr.push(it); changed(); draw(); } }, `+ ${stripHtml(f.addLabel || 'Add')}`));
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

  draw();
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
