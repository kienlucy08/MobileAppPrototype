// Surveys on the phone: the library by scope of work, choosing a site (or continuing unallocated), the Ingress-style survey
// screen, finishing (send now, put in the queue, save as draft, delete), and copying answers between compatible surveys.

import { renderForm } from './form.js';
import * as S from './schema.js';
import { tileOf } from './library.js';
import { SITES } from './mdata.js';
import { NetError } from './errors.js';
import { stripHtml } from './util.js';
import { addImages } from './images.js';
import { scenePhoto } from './capture.js';

const COPYABLE = new Set(['text', 'integer', 'decimal', 'select_one', 'select_multiple']);

export function install(M) {
  const { h, icon, db, engine, server, library, LS } = M;
  const device = M.device;
  const ctx = { db, engine, server, lookups: M.lookups, siteData: M.siteData, orgs: { get: () => M.orgs().map((o) => ({ value: o.id, label: o.name })), loaded: () => true, state: 'ok', onChange: () => () => {}, refresh() {} },
    device, toast: (...a) => M.toast(...a), modal: (...a) => M.dialog(...a), sheet: (...a) => M.sheet(...a), has: (f) => f === 'camera' || f === 'quality', allow: (f) => (f === 'gallery' ? LS.get('role', 'full') !== 'training' : true), can: () => true, role: () => 'lead', settings: { original: false }, survey: null };

  /** Where a repeated answer can come from for a site: the visit or site list (site name), then any other survey for the site. */
  ctx.pullFor = (siteId, name, subId) => {
    const key = String(siteId ?? '').trim(); if (!key) return null; const n = key.toLowerCase();
    if (name === 'siteName') {
      const v = (M.visitList?.() || []).find((x) => String(x.siteId).toLowerCase() === n); if (v) return { value: v.siteName, from: `the ${v.name} visit` };
      const st = SITES.find((x) => x.id.toLowerCase() === n && x.name !== 'Site name'); if (st) return { value: st.name, from: 'the site list' };
    }
    const r = M.siteData.pull(key, name, subId); return r ? { value: r.value, from: `${r.title}${r.from === 'the server' ? ' (from the server)' : ''}` } : null;
  };
  const subs = () => [...engine.subs.values()].filter((s) => !s.shared);
  const site = () => LS.get('site', null);
  const orgOf = (visit) => visit?.orgId || (M.org() === 'all' ? M.orgs()[0]?.id : M.org());
  const siteLabel = (s) => (s ? `${s.name && s.name !== 'Site name' ? `${s.name} · ` : ''}${s.id}` : 'No site yet');
  const status = (survey, siteId) => {
    const mine = subs().filter((s) => s.surveyId === survey.id && (!siteId || String(s.answers?.siteId ?? '').toLowerCase() === siteId.toLowerCase()));
    return mine.some((s) => s.status !== 'draft') ? 'Submitted' : mine.some((s) => s.status === 'draft') ? 'Draft' : 'Not started';
  };
  const statusTone = { Submitted: 'complete', Draft: 'progress', 'Not started': 'muted', Ready: 'progress' };

  /** A new draft: from a visit (site and visit carried over), for a chosen site, or unallocated. */
  function newDraft(survey, { visit, site: st } = {}) {
    const sub = { id: M.uid(), surveyId: survey.id, surveyTitle: survey.title, schemaVersion: survey.version, survey, status: 'draft', answers: S.newAnswers(survey, device), page: 0, createdAt: Date.now(), updatedAt: Date.now(), submittedAt: 0, orgId: orgOf(visit), visitId: visit?.id, siteLabel: visit ? visit.name : st ? siteLabel(st) : '' };
    const sid = visit?.siteId || st?.id; if (sid) sub.answers.siteId = sid;
    if (!visit && sid) { const m = M.matchVisit(sid, survey.id, sub.orgId); if (m) { sub.visitId = m.id; sub.siteLabel = m.name; } }       // a site that is a visit's site: it is part of that visit
    S.recalc(survey, sub.answers);
    engine.registerSub(sub); db.put('submissions', sub); return sub;
  }
  const drafts = () => subs().filter((s) => s.status === 'draft').sort((a, b) => b.updatedAt - a.updatedAt);
  function startSurvey(survey, opts = {}) {
    const sid = opts.visit?.siteId || opts.site?.id;
    const have = drafts().find((d) => d.surveyId === survey.id && (opts.visit ? d.visitId === opts.visit.id : sid ? String(d.answers.siteId ?? '').toLowerCase() === sid.toLowerCase() : !d.visitId));
    const sub = have || newDraft(survey, opts); M.setChoices(survey);
    M.go('form', { subId: sub.id });
  }
  M.openSurveyForVisit = async (visit, surveyId) => { const sv = library.get(surveyId); if (!sv) return M.toast('That survey is not on this phone yet. It downloads when you have signal.'); await M.startVisit?.(visit); startSurvey(sv, { visit }); };

  // ---- My surveys (m04) -------------------------------------------------------------------------
  /** The survey library as rows: by scope of work or every survey, with a filter for the surveys already on this phone. Used by My surveys and by All surveys on the home screen. */
  M.browse = (v, redraw) => {
    v.tab ||= 'scope'; v.chip ||= 'all';
    const scopes = library.scopes(), single = scopes.filter((s) => s.count === 1), multi = scopes.filter((s) => s.count > 1);
    const seg = h('div', { class: 'seg' }, [['scope', 'By scope'], ['all', 'All surveys']].map(([k, l]) => h('button', { type: 'button', class: v.tab === k ? 'on' : '', onclick: () => { v.tab = k; redraw(); } }, l)));
    const chips = h('div', { class: 'chipbar' }, [['all', 'All'], ['allocated', 'Allocated'], ['unallocated', 'Unallocated']].map(([k, l]) => h('button', { type: 'button', class: 'chip-btn' + (v.chip === k ? ' on' : ''), onclick: () => { v.chip = k; redraw(); } }, l)));
    const rowFor = (sv) => h('button', { type: 'button', class: 'vrow', onclick: () => startSurvey(sv, { site: site() }) }, h('div', { class: 'vtop' }, h('b', {}, sv.title), M.pill(drafts().some((d) => d.surveyId === sv.id) ? 'Draft' : 'Ready', drafts().some((d) => d.surveyId === sv.id) ? 'blocked' : 'progress')), h('div', { class: 'vmeta' }, M.pill(sv.scope, 'muted')), h('span', { class: 'chev' }, icon('chevron', 16)));
    const kids = [seg, chips];
    if (v.tab === 'scope') {
      kids.push(...multi.map((sc) => { const n = drafts().filter((d) => library.get(d.surveyId)?.scope === sc.name).length;
        return h('button', { type: 'button', class: 'vrow', onclick: () => M.go('scope', { scope: sc.name }) }, h('div', { class: 'vtop' }, M.pill(sc.name, 'progress'), h('span', { class: 'chev' }, icon('chevron', 16))), h('small', { class: 'muted' }, `${sc.count} surveys${n ? ` · ${n} draft${n === 1 ? '' : 's'}` : ''}`)); }));
      kids.push(h('small', { class: 'muted' }, 'Single-survey scopes open the survey directly'));
      kids.push(...single.flatMap((sc) => library.filter({ scope: sc.name }).map(rowFor)));
    } else kids.push(...library.all.map(rowFor));
    const mine = subs().filter((s) => v.chip === 'all' || (v.chip === 'allocated' ? !!s.visitId : !s.visitId)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
    if (mine.length) kids.push(h('h3', {}, 'On this phone'), ...mine.map((s) => h('div', { class: 'vrow plain' }, h('div', {}, h('b', {}, s.surveyTitle), h('small', { class: 'muted block' }, `${s.siteLabel || s.answers.siteId || 'Unallocated'} · ${s.status === 'draft' ? 'Draft' : s.status === 'complete' ? 'Sent' : s.status === 'ready' ? 'In the queue' : 'Sending'}`)),
      s.status === 'draft' ? h('button', { type: 'button', class: 'btn small', onclick: () => M.go('form', { subId: s.id }) }, 'Resume') : !s.visitId && !String(s.answers.siteId ?? '').trim() && s.status !== 'draft' ? h('button', { type: 'button', class: 'btn small', onclick: () => M.go('attach', { subId: s.id }) }, 'Attach') : M.pill(s.visitId ? 'Part of a visit' : s.answers.siteId || '', s.visitId ? 'complete' : 'muted'))));
    return kids;
  };
  M.views.mysurveys = (v) => {
    const body = h('div', { class: 'scroll pad' });
    const draw = () => body.replaceChildren(...M.browse(v, draw));
    v.live = draw; draw();
    return h('div', { class: 'mcol' }, M.appbar('My surveys', 'Everything you can access', { back: true }), body);
  };

  // ---- a scope with several surveys (m05) ----------------------------------------------------------
  M.views.scope = (v) => {
    const body = h('div', { class: 'scroll pad' });
    const draw = () => {
      const st = site();
      body.replaceChildren(
        h('div', { class: 'sitecard blue' }, h('b', {}, st ? `Site: ${st.id} ${st.name}` : 'Choose the site'), h('button', { type: 'button', class: 'link', onclick: () => M.go('sitepick', { scope: v.scope }) }, st ? 'Change' : 'Choose')),
        ...library.filter({ scope: v.scope }).map((sv) => { const s2 = status(sv, st?.id), t = tileOf(sv);
          return h('div', { class: 'card srow' }, h('div', {}, M.pill(sv.title.replace(/ Inspection$/, ''), 'progress'), h('div', { class: 'vmeta' }, M.pill(s2, statusTone[s2]))), h('button', { type: 'button', class: 'btn small', onclick: () => (st ? startSurvey(sv, { site: st }) : M.go('sitepick', { scope: v.scope, surveyId: sv.id })) }, 'Open')); }),
        h('small', { class: 'muted' }, 'The surveys share the site, so you pick it once.'));
    };
    v.live = draw; draw();
    return h('div', { class: 'mcol' }, M.appbar(v.scope, `${library.filter({ scope: v.scope }).length} surveys`), body);
  };

  // ---- choose the site (m06) / unallocated (m07) -------------------------------------------------
  M.views.sitepick = (v) => {
    let pick = site()?.id || SITES[0].id, q = '';
    const list = h('div', { class: 'org-list' }), use = h('button', { type: 'button', class: 'btn primary big' });
    const draw = () => {
      list.replaceChildren(...SITES.filter((s) => !q || `${s.id} ${s.name}`.toLowerCase().includes(q)).map((s) => h('button', { type: 'button', class: 'org-card' + (pick === s.id ? ' on' : ''), onclick: () => { pick = s.id; draw(); } },
        h('div', { class: 'grow' }, h('b', {}, `${s.id} ${s.name === 'Site name' ? '[Site name]' : s.name}`), M.pill(s.note, s.note === 'Nearby' ? 'progress' : 'muted')), pick === s.id ? h('span', { class: 'org-check' }, icon('check', 16)) : null)));
      use.textContent = `Use ${pick}`;
    };
    const search = h('input', { class: 'minput', placeholder: 'Search by site ID or name', 'aria-label': 'Search sites' }); search.addEventListener('input', () => { q = search.value.toLowerCase(); draw(); });
    use.onclick = () => { const st = SITES.find((s) => s.id === pick); LS.set('site', st); const sv = v.surveyId && library.get(v.surveyId); if (sv) { M.back(); startSurvey(sv, { site: st }); } else M.back(); };
    draw();
    return h('div', { class: 'mcol' }, M.appbar('Choose the site', v.scope || ''), h('div', { class: 'scroll pad' }, search, list,
      h('button', { type: 'button', class: 'btn big outline', onclick: () => M.go('unalloc', { surveyId: v.surveyId || library.filter({ scope: v.scope })[0]?.id }) }, 'Site not listed? Continue unallocated'), h('small', { class: 'muted center' }, 'The app never creates sites.')), h('div', { class: 'footbar' }, use));
  };
  M.views.unalloc = (v) => {
    const sv = library.get(v.surveyId) || library.all[0];
    return h('div', { class: 'mcol' }, M.appbar('Unallocated survey', 'Not attached to a site yet'),
      h('div', { class: 'scroll pad' }, h('div', { class: 'warn-card' }, h('b', {}, 'No site yet'), h('p', {}, 'This survey is saved as unallocated. It is matched to a site in the web app later.'), h('p', {}, h('b', {}, 'The app never creates sites.'))),
        h('div', { class: 'card' }, h('div', { class: 'vmeta' }, M.pill(sv.title.replace(/ Inspection$/, ''), 'progress'), M.pill('Unallocated', 'blocked')), h('small', { class: 'muted block' }, 'Draft')),
        h('h3', {}, 'What happens next'), ...['You complete the survey as usual', 'It is saved and sent like any other record', 'The web app matches it to a site'].map((t, i) => h('div', { class: 'step' }, h('i', {}, i + 1), t))),
      h('div', { class: 'footbar' }, h('button', { type: 'button', class: 'btn primary big', onclick: () => { LS.del('site'); const sub = newDraft(sv, {}); sub.answers.siteId = undefined; M.setChoices(sv); M.go('form', { subId: sub.id }); } }, 'Start survey')));
  };

  // ---- the survey (m08 to m12) ------------------------------------------------------------------
  M.views.form = (v) => {
    const sub = engine.subs.get(v.subId);
    if (!sub) return h('div', { class: 'pad' }, 'That survey is no longer on this phone.');
    const survey = sub.survey; M.setChoices(survey);
    LS.set('resume', { subId: sub.id });
    const org = M.orgName(sub.orgId).split(' ')[0];
    const el = renderForm(ctx, sub, { ingress: true, startPage: v.page ?? sub.page ?? 0, focusPath: v.focusPath, banner: v.banner, subtitle: `${M.orgName(sub.orgId)} · ${sub.siteLabel || sub.answers.siteId || 'Unallocated'}`,
      onExit: () => { LS.del('resume'); M.back(); }, onFinish: () => finishSheet(sub), onCopy: () => M.go('copysource', { subId: sub.id }), onReview: () => finishSheet(sub), visitNav: sub.visitId ? () => M.visitNav(sub) : null });
    const wrap = h('div', { class: 'mcol form-col' }, el); wrap.cleanup = el.cleanup;
    v.api = el.api; M.formApi = el.api;
    return wrap;
  };

  const photoCount = (sub) => engine.mediaFor(sub.id).length;
  function finishSheet(sub) {
    const n = photoCount(sub), org = M.orgName(sub.orgId);
    const opt = (title, desc, primary, fn, cls = '') => h('button', { type: 'button', class: `finish-opt ${primary ? 'primary' : ''} ${cls}`, onclick: () => { close(); fn(); } }, h('b', {}, title), h('small', {}, desc));
    const close = M.sheet('Finish this survey', h('div', { class: 'ready-card' }, h('b', {}, 'Ready to finish'), h('small', { class: 'block' }, `${n} photo${n === 1 ? '' : 's'} taken`), h('small', { class: 'link block' }, 'All required questions answered'), h('small', { class: 'muted block' }, 'Choose what happens next.')),
      h('small', { class: 'muted' }, `Sending to ${org}`),
      opt('Send now', 'Sends if you have signal. If not, it waits in the queue.', true, () => confirmOrg(sub, false)),
      opt('Put in the queue', 'Send later from the Queue tab with Upload all.', false, () => confirmOrg(sub, true)),
      opt('Save as draft', 'Keep working on it later. Not queued, not sent.', false, () => { LS.del('resume'); M.toast('Saved as a draft.'); if (sub.visitId) { M.go('visit', { id: sub.visitId }, { replace: true }); afterSurvey(sub, 'Saved as a draft'); } else M.go('home', {}, { replace: true }); }),
      !sub.visitId && !String(sub.answers.siteId ?? '').trim() ? opt('Attach to a visit', 'Match it to one of your assigned visits.', false, () => M.go('attach', { subId: sub.id })) : null,
      opt('Delete survey', 'Remove it from this phone.', false, () => deleteDialog(sub), 'danger'));
  }
  /** Before anything is sent, people who work in several organizations confirm the one it goes to, and can change it. Changing moves nothing and loses nothing: the answers and photos stay on this phone. Someone in one organization is not asked. */
  function confirmOrg(sub, hold, changing = false, alsoSwitch = true) {
    if (M.orgs().length < 2) return send(sub, hold);
    const org = M.orgName(sub.orgId), active = M.org(), visit = (sub.visitId || sub.heldVisit) && (M.visitList?.() || []).find((x) => x.id === (sub.visitId || sub.heldVisit));
    const differs = active && active !== 'all' && active !== sub.orgId;
    const orgCard = h('div', { class: 'org-card on static' }, h('span', { class: 'org-badge' }, org[0]), h('div', { class: 'grow' }, h('b', {}, org), h('small', { class: 'muted block' }, differs ? 'Where this survey was started' : 'The organization you are working in')));
    let sw = alsoSwitch;
    const close = M.sheet(changing ? 'Change organization' : `${hold ? 'Put in the queue for' : 'Send to'} ${org}?`,
      changing ? h('p', { class: 'muted' }, 'Pick the organization this survey should go to. Your answers and photos stay as they are.')
        : h('p', { class: 'muted' }, `Check this is the right organization before it ${hold ? 'is queued' : 'goes'}.`),
      ...(changing ? [...M.orgs().map((o) => h('button', { type: 'button', class: 'org-card' + (sub.orgId === o.id ? ' on' : ''), onclick: async () => {
            if (o.id !== sub.orgId) {
              sub.orgId = o.id; const all = M.visitList?.() || [];
              if (visit && visit.orgId !== o.id) { sub.heldVisit = sub.visitId || sub.heldVisit; sub.visitId = undefined; M.toast(`It is no longer attached to ${visit.name}, which belongs to another organization. It will be unallocated in ${o.name}. Change back and it re-attaches.`, 5500); }
              else if (sub.heldVisit && all.find((x) => x.id === sub.heldVisit)?.orgId === o.id) { sub.visitId = sub.heldVisit; sub.heldVisit = undefined; }     // back to the visit's organization: re-attach
              await db.put('submissions', sub);
              if (sw && active !== o.id) { LS.set('org', o.id); server.setOrg(o.id); M.afterOrgChange?.(); }          // keep working there: the next survey will not need changing
            }
            close(); confirmOrg(sub, hold, false, sw); } }, h('span', { class: 'org-badge' }, o.name[0]), h('b', { class: 'grow' }, o.name), sub.orgId === o.id ? h('span', { class: 'org-check' }, icon('check', 16)) : h('span', { class: 'radio' }))),
          h('label', { class: 'check-line' }, h('input', { type: 'checkbox', checked: sw, onchange: (e) => { sw = e.target.checked; } }), 'Also switch the app to that organization')]
        : [orgCard,
          differs ? h('div', { class: 'warn-card' }, h('b', {}, `The app is in ${M.orgName(active)}`), h('small', {}, `This survey was started in ${org}. Sending now puts it in ${org}.`)) : null,
          h('button', { type: 'button', class: 'btn primary big', onclick: () => { close(); send(sub, hold); } }, `Yes, ${hold ? 'put in the queue for' : 'send to'} ${org}`),
          h('button', { type: 'button', class: 'btn big', onclick: () => { close(); confirmOrg(sub, hold, true, sw); } }, 'No, change organization'),
          h('button', { type: 'button', class: 'link', onclick: () => close() }, 'Cancel')]));
  }
  async function send(sub, hold) {
    const survey = sub.survey; S.recalc(survey, sub.answers); S.stampEnd(survey, sub.answers);
    const pruned = S.prune(survey, sub.answers); sub.answers = pruned.answers;
    if (!sub.visitId) { const m = M.matchVisit(sub.answers.siteId, sub.surveyId, sub.orgId); if (m) sub.visitId = m.id; }        // typed a site that has a visit: it belongs to it, no attaching sub.label = S.instanceLabel(survey, pruned.answers) || pruned.answers.siteId || sub.siteLabel || 'Survey';
    try { await engine.submit(sub, pruned.mediaIds, { hold }); } catch (e) { return M.toast(`${e.code || 'ERR-GEN-000'}: ${e.message}`, 5000); }
    LS.del('resume'); const msg = hold ? 'Put in the queue. Upload all sends it.' : M.online() ? 'Sending in the background.' : 'No signal. It is saved and waits in the queue.';
    if (sub.visitId) { M.go('visit', { id: sub.visitId }, { replace: true }); afterSurvey(sub, msg); } else { M.toast(msg); M.go('queue', {}, { replace: true }); }
  }
  /** Right after a survey of a visit is sent (or saved): offer the next one for the same visit, so the crew does not have to hunt for it. */
  function afterSurvey(sub, msg) {
    if (!sub.visitId) return;
    const nx = M.nextSurvey(sub.visitId, sub.surveyId), v = (M.visitList?.() || []).find((x) => x.id === sub.visitId);
    const close = M.sheet(msg.replace(/\.$/, ''), h('p', { class: 'muted' }, nx ? `Up next in ${v?.name || 'this visit'}:` : `That is everything left to do in ${v?.name || 'this visit'}.`),
      nx ? h('button', { type: 'button', class: 'btn primary big', onclick: () => { close(); M.takeAndOpen(nx.visit, nx.sv); } }, `${nx.sv.mine ? 'Next' : 'Take and start'}: ${nx.sv.title}`) : null,
      h('button', { type: 'button', class: 'btn big', onclick: () => close() }, 'Back to the visit'), h('button', { type: 'button', class: 'link', onclick: () => { close(); M.go('queue', {}, { replace: true }); } }, 'See the queue'));
  }
  function deleteDialog(sub) {
    const close = M.dialog(h('div', { class: 'del-ico' }, icon('trash', 22)), h('h2', {}, 'Delete this survey?'), h('b', {}, `${sub.surveyTitle} · ${sub.siteLabel || sub.answers.siteId || 'Unallocated'}`),
      h('p', { class: 'muted' }, `The answers and ${photoCount(sub)} photo${photoCount(sub) === 1 ? '' : 's'} will be removed from this phone. It has not been sent.`),
      h('button', { type: 'button', class: 'btn big dangerbtn', onclick: async () => { close(); await engine.deleteSub(sub.id); LS.del('resume'); M.toast('Survey deleted.'); M.go('home', {}, { replace: true }); } }, 'Delete'),
      h('button', { type: 'button', class: 'link', onclick: close }, 'Keep it'));
  }

  M.views.drafts = () => {
    const rows = drafts();
    return h('div', { class: 'mcol' }, M.appbar('Drafts', `${rows.length} survey${rows.length === 1 ? '' : 's'} saved`),
      h('div', { class: 'scroll pad' }, ...(rows.length ? rows.map((d) => h('div', { class: 'card srow' }, h('div', {}, h('b', {}, d.surveyTitle), h('small', { class: 'muted block' }, `${d.siteLabel || d.answers.siteId || 'Unallocated'} · ${M.orgName(d.orgId)}`)),
        h('div', { class: 'row2s' }, h('button', { type: 'button', class: 'btn small', onclick: () => M.go('form', { subId: d.id }) }, 'Resume'), h('button', { type: 'button', class: 'btn small danger', onclick: () => deleteDialog(d) }, 'Delete')))) : [h('p', { class: 'muted' }, 'No drafts.')])));
  };

  // ---- copy data between compatible surveys (m15, m16) -------------------------------------------
  const targetFields = (survey) => survey.pages.map((pg) => ({ title: stripHtml(pg.label || pg.name), fields: pg.fields.filter((f) => COPYABLE.has(f.type) && !f.calculation && f.appearance !== 'hidden') })).filter((g) => g.fields.length);
  const shared = (target, src) => targetFields(target.survey).flatMap((g) => g.fields).filter((f) => f.name !== 'siteId' && !S.isEmpty(src.answers?.[f.name]));
  M.views.copysource = (v) => {
    const sub = engine.subs.get(v.subId); let pick = '';
    const others = subs().filter((s) => s.id !== sub.id && s.surveyId !== sub.surveyId);
    const ok = others.filter((s) => library.get(s.surveyId)?.scope === sub.survey.scope && shared(sub, s).length), no = others.filter((s) => !ok.includes(s)).slice(0, 2);
    const list = h('div', { class: 'org-list' }), next = h('button', { type: 'button', class: 'btn primary big', disabled: true }, 'Next');
    const draw = () => { list.replaceChildren(...ok.map((s) => h('button', { type: 'button', class: 'org-card' + (pick === s.id ? ' on' : ''), onclick: () => { pick = s.id; next.disabled = false; draw(); } }, h('span', { class: 'radio' + (pick === s.id ? ' on' : '') }), h('div', { class: 'grow' }, h('b', {}, s.surveyTitle), h('small', { class: 'muted block' }, `${s.answers.siteId || s.siteLabel} · ${s.status === 'draft' ? 'Draft' : `Submitted ${new Date(s.submittedAt || s.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}`}`)))));
      if (!ok.length) list.append(h('p', { class: 'muted' }, 'No compatible surveys on this phone yet. Fill in a Structure Flight Inspection first, or use the demo controls to add one.')); };
    next.onclick = () => M.go('copypreview', { subId: sub.id, sourceId: pick }); draw();
    return h('div', { class: 'mcol' }, M.appbar('Copy data from', `Into ${sub.surveyTitle} · ${sub.siteLabel || sub.answers.siteId || ''}`),
      h('div', { class: 'scroll pad' }, h('p', { class: 'muted' }, 'Pick a survey to copy answers from. Only compatible survey types can be copied.'), h('h3', {}, 'Compatible'), list,
        h('h3', {}, 'Not compatible'), ...(no.length ? no.map((s) => s.surveyTitle) : library.all.filter((sv) => sv.scope !== sub.survey.scope).slice(0, 2).map((sv) => sv.title)).map((t) => h('div', { class: 'card dim' }, h('b', {}, t), h('small', { class: 'muted block' }, 'Different survey type')))), h('div', { class: 'footbar' }, next));
  };
  M.views.copypreview = (v) => {
    const sub = engine.subs.get(v.subId), src = engine.subs.get(v.sourceId);
    const groups = targetFields(sub.survey).map((g) => ({ ...g, fields: g.fields.filter((f) => f.name !== 'siteId' && !S.isEmpty(src.answers?.[f.name])) })).filter((g) => g.fields.length).map((g) => ({ ...g, on: true }));
    const btn = h('button', { type: 'button', class: 'btn primary big' }), list = h('div', {});
    const total = () => groups.filter((g) => g.on).reduce((n, g) => n + g.fields.length, 0);
    const draw = () => { list.replaceChildren(...groups.map((g) => h('button', { type: 'button', class: 'check-card' + (g.on ? ' on' : ''), onclick: () => { g.on = !g.on; draw(); } }, h('span', { class: 'cbox' }, g.on ? icon('check', 14) : null), h('div', {}, h('b', {}, g.title), h('small', { class: 'muted block' }, `${g.fields.length} field${g.fields.length === 1 ? '' : 's'}`))))); btn.textContent = `Copy ${total()} field${total() === 1 ? '' : 's'}`; btn.disabled = !total(); };
    btn.onclick = async () => { for (const g of groups.filter((x) => x.on)) for (const f of g.fields) sub.answers[f.name] = structuredClone(src.answers[f.name]); S.recalc(sub.survey, sub.answers); sub.updatedAt = Date.now(); await db.put('submissions', sub); const n = total(); M.back(); M.back(); M.toast(`Copied ${n} field${n === 1 ? '' : 's'} from ${src.surveyTitle}.`); M.go('form', { subId: sub.id }, { replace: true }); };
    draw();
    return h('div', { class: 'mcol' }, M.appbar('Copy these answers', `From ${src.surveyTitle} · ${src.siteLabel || src.answers.siteId}`),
      h('div', { class: 'scroll pad' }, h('p', { class: 'muted' }, 'Untick anything you do not want copied.'), list, groups.length ? null : h('p', { class: 'muted' }, 'Nothing to copy: these surveys share no answered fields.'),
        h('div', { class: 'info-card' }, h('b', {}, 'Not copied'), h('small', { class: 'block' }, 'Photos, signatures, date and time, GPS.'), h('small', { class: 'block' }, 'Calculated fields update on their own.'), h('small', { class: 'block' }, 'Copying is one time. The surveys stay separate.'))),
      h('div', { class: 'footbar' }, btn, h('button', { type: 'button', class: 'btn big', onclick: M.back }, 'Cancel')));
  };

  // ---- demo helpers ------------------------------------------------------------------------------
  M.demo = M.demo || {};
  const openDemo = (surveyId, { page = 0, site = 'TX-4412' } = {}) => {
    const sv = library.get(surveyId), st = SITES.find((s) => s.id === site);
    const sub = drafts().find((d) => d.surveyId === sv.id && String(d.answers.siteId).toLowerCase() === site.toLowerCase()) || newDraft(sv, { site: st });
    M.setChoices(sv); M.go('form', { subId: sub.id, page }, { replace: true }); return sub;
  };
  Object.assign(M.demo, {
    setRole: (r) => { LS.set('role', r); M.render(); },
    /** Three guy wires on the open Compound, with the details entered once and carried down (the last one has no preform color). */
    addWires: async () => {
      const sub = engine.subs.get(M.current().subId); if (!sub) return;
      sub.answers.radiusa ??= 137; sub.answers.wiresa = [1, 2, 3].map((n) => ({ _id: M.uid(), level: n, pos: 'PO', size: '7/16 · 7', strength: 'EHS', preform: n === 3 ? 'None' : 'Green', breakingStrength: 6650 }));
      S.recalc(sub.survey, sub.answers); await db.put('submissions', sub); M.go('form', { subId: sub.id, page: 1 }, { replace: true });
    },
    openFlight: (page = 0) => openDemo('demo-structure-flight', { page }),
    openGuy: (page = 0) => openDemo('demo-guy-facilities', { page }),
    openCompound: (page = 0) => openDemo('demo-compound', { page }),
    openJSA: () => openDemo('demo-jsa'),
    openCopy: async () => { await M.demo.seedSource(); const sub = openDemo('demo-guy-facilities'); M.go('copysource', { subId: sub.id }); },
    finishNow: () => { const sub = engine.subs.get(M.current().subId); if (sub) finishSheet(sub); },
    /** A finished Structure Flight record for TX-4412: the source for Copy data. */
    seedSource: async () => {
      const sv = library.get('demo-structure-flight'); if (subs().some((s) => s.surveyId === sv.id && s.answers.siteId === 'TX-4412' && s.status !== 'draft')) return;
      const sub = newDraft(sv, { site: SITES[0] }); sub.visitId = undefined; Object.assign(sub.answers, { towerType: 'guyed', height: 199, notes: 'Gate code on the left post.', guyLevels: [{ _id: M.uid(), level: 1, elevation: 29 }, { _id: M.uid(), level: 2, elevation: 49 }, { _id: M.uid(), level: 3, elevation: 78 }] });
      sub.status = 'complete'; sub.submittedAt = Date.now() - 86400000 * 3; sub.updatedAt = sub.submittedAt; await db.put('submissions', sub);
      const cp = newDraft(library.get('demo-compound'), { site: SITES[0] }); cp.visitId = undefined; Object.assign(cp.answers, { gateCode: '4471', lockType: 'Master padlock', combination: '0925' }); cp.status = 'complete'; cp.submittedAt = Date.now() - 86400000 * 5; cp.updatedAt = cp.submittedAt; await db.put('submissions', cp);
      engine._emit?.();
    },
    /** Fill every required answer on the open survey so a demo can move on quickly. */
    fillRequired: async () => {
      const sub = engine.subs.get(M.current().subId); if (!sub) return;
      const fill = async (fields, item, prefix) => { for (const f of fields) {
        if (f.type === 'repeat') { if (!(item[f.name] || []).length) { const it = { _id: M.uid() }; S.applyDefaults(f.fields, it, device); (item[f.name] ||= []).push(it); } for (const [i, it] of item[f.name].entries()) await fill(f.fields, it, `${prefix}${f.name}[${i}].`); continue; }
        if (f.type === 'image') { const min = f.minFiles ?? (f.required ? 1 : 0), have = (item[f.name] ||= []).length; if (min > have) { const files = []; for (let i = have; i < min; i++) files.push(await scenePhoto(f.defaultZoom ?? 1, `IMG_${f.name}_${i + 1}.jpg`)); const r = await addImages(engine, sub, prefix + f.name, files); item[f.name].push(...r.ids); } continue; }
        if (f.type === 'calculate' || f.type === 'note' || !S.isEmpty(item[f.name])) continue;
        if (f.type === 'select_one') item[f.name] = f.choices[0].value; else if (f.type === 'integer' || f.type === 'decimal') item[f.name] = f.name === 'level' ? 1 : f.name.startsWith('radius') ? 137 : f.name === 'tension' ? 1800 : f.name === 'elevation' ? 29 : 12; else if (f.type === 'text') item[f.name] = f.name === 'siteId' ? (sub.answers.siteId || 'TX-4412') : 'Entered'; } };
      for (const p of sub.survey.pages) await fill(p.fields, sub.answers, ''); S.recalc(sub.survey, sub.answers); await db.put('submissions', sub); M.go('form', { subId: sub.id, page: 0 }, { replace: true });
    },
  });
}
