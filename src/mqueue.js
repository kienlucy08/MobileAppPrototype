// Queue (one record at a time, Upload all), Health (issues and the sync log), a coded error with a plain fix, and phone storage.
// Sending a report to the dev team is second wave, so Health only shows issues and the log.

import { describe } from './errors.js';
import { addImages } from './images.js';
import { scenePhoto } from './capture.js';
import { fmtBytes, fmtTime } from './util.js';
import * as S from './schema.js';
import { beta } from './mode.js';

const FIX = {
  'ERR-IMG-001': ['This photo is too large to send.', 'Replace the photo, then send again. Nothing else needs to be redone.'],
  'ERR-IMG-002': ['This photo file is damaged, so it could not be uploaded.', 'Replace the photo, then send again. Nothing else needs to be redone.'],
  'ERR-IMG-003': ['The number of photos is out of range for this question.', 'Add or remove photos, then send again.'],
  'ERR-SYNC-001': ['The survey was updated after you started it.', 'Open the survey and review it on the new version.'],
};

export function install(M) {
  const { h, icon, engine, server, db, LS } = M;
  const subs = () => [...engine.subs.values()].filter((s) => !s.shared && s.status !== 'draft');
  const nm = (s) => `${s.surveyTitle} · ${s.siteLabel || s.answers?.siteId || 'Unallocated'}`;
  const hhmm = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const stPill = (s) => ({ queued: ['Waiting', 'blocked'], uploading: ['Uploading', 'progress'], ready: ['Ready', 'assigned'], failed: ['Failed', 'err'], complete: ['Sent', 'complete'] }[s.status] || [s.status, 'muted']);
  const pageOf = (survey, path) => { const n = String(path).split(/[[./]/)[0]; return Math.max(0, survey.pages.findIndex((p) => p.fields.some((f) => f.name === n))); };

  // ---- Queue (m19) -------------------------------------------------------------------------------
  M.views.queue = (v) => {
    const body = h('div', { class: 'scroll pad' });
    const draw = () => {
      const sum = engine.summary(), rows = subs().sort((a, b) => b.submittedAt - a.submittedAt), waiting = rows.filter((s) => s.status !== 'complete'), sent = rows.filter((s) => s.status === 'complete');
      const ops = M.demo.ops?.() || [], multi = M.orgs().length > 1, vname = (id) => (M.demo.visits().find((x) => x.id === id) || {}).name || id;
      const left = waiting.reduce((n, s) => { const c = engine.countsFor(s.id); return n + c.total - c.done; }, 0), total = waiting.reduce((n, s) => n + engine.countsFor(s.id).total, 0);
      const count = waiting.length + ops.length, zero = count === 0;
      const recCard = (s, done) => { const c = engine.countsFor(s.id), [label, tone] = stPill(s);
        return h('div', { class: 'card rec' + (s.status === 'failed' ? ' bad' : '') }, h('div', { class: 'vtop' }, h('b', {}, nm(s)), M.pill(label, tone)),
          multi ? h('small', { class: 'org-tag' }, M.orgName(s.orgId)) : null,
          h('small', { class: 'muted block' }, done ? `Delivered ${new Date(s.committedAt || s.submittedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${hhmm(s.committedAt || s.submittedAt)}${beta() ? ` · kept ${Math.max(0, 30 - Math.floor((Date.now() - (s.submittedAt || Date.now())) / 86400000))} more days` : ''}` : s.status === 'ready' ? 'Waiting for Upload all' : c.total ? `${c.done} of ${c.total} photos delivered` : 'No photos'),
          !done && s.status !== 'ready' && c.total ? h('div', { class: 'bar' }, h('i', { style: `width:${(c.done / c.total) * 100}%` })) : null,
          s.status === 'failed' ? h('button', { type: 'button', class: 'btn small', onclick: () => M.go('errordetail', { subId: s.id }) }, 'See what to do') : null,
          done && !s.visitId && !String(s.answers?.siteId ?? '').trim() ? h('button', { type: 'button', class: 'link', onclick: () => M.go('attach', { subId: s.id }) }, 'Attach to a visit') : null); };
      body.replaceChildren(...[
        // the big card: what still has to be uploaded, or zero
        h('div', { class: 'card upcard' + (zero ? ' zero' : sum.failed ? ' bad' : '') },
          h('div', { class: 'up-n' }, h('b', {}, String(count)), h('span', {}, `record${count === 1 ? '' : 's'} waiting to be sent`)),
          zero ? h('small', { class: 'okline' }, 'Everything is sent. Nothing lost.') : h('small', { class: sum.failed ? 'err block' : 'muted block' }, [left ? `${left} photo${left === 1 ? '' : 's'} left of ${total}` : 'No photos left', ops.length ? `${ops.length} status change${ops.length === 1 ? '' : 's'}` : '', sum.failed ? `${sum.failed} need attention` : ''].filter(Boolean).join(' · ')),
          !zero && total ? h('div', { class: 'bar' }, h('i', { style: `width:${((total - left) / total) * 100}%` })) : null,
          h('small', { class: 'link block' }, 'Storage OK · Nothing lost')),
        waiting.length || ops.length ? h('h3', {}, 'Waiting to be sent') : null,
        ...ops.map((o) => h('div', { class: 'card rec' }, h('div', { class: 'vtop' }, h('b', {}, `Visit: ${vname(o.id)}`), M.pill('Waiting', 'blocked')), h('small', { class: 'muted block' }, `${{ start: 'Start', block: 'Block', unblock: 'Unblock', complete: 'Complete', assign: 'Assign to me' }[o.action]}${o.surveyId ? ` ${((M.demo.visits().find((x) => x.id === o.id) || {}).surveys || []).find((x) => x.id === o.surveyId)?.title || 'survey'}` : ''} · sends when you have signal`))),
        ...waiting.map((s) => recCard(s, false)),
        // sent surveys, collapsed
        h('button', { type: 'button', class: 'vrow plain sentrow', onclick: () => { v.showSent = !v.showSent; draw(); } }, h('b', {}, `Sent surveys (${sent.length})`), icon('chevron', 16)),
        v.showSent ? (sent.length ? [h('small', { class: 'muted' }, beta() ? 'Sent surveys stay listed here for 30 days as proof of what you sent, then clear on their own.' : 'Sent surveys stay listed here as proof of what you sent.'), ...sent.map((s) => recCard(s, true))] : h('small', { class: 'muted' }, 'Nothing sent from this phone yet.')) : null,
        h('button', { type: 'button', class: 'vrow plain', onclick: () => M.go('drafts') }, h('b', {}, `Drafts · ${[...engine.subs.values()].filter((s) => s.status === 'draft').length} surveys saved`), icon('chevron', 16)),
      ].flat().filter(Boolean));
    };
    v.live = draw; draw();
    return h('div', { class: 'mcol' }, h('header', { class: 'mbar big' }, h('div', { class: 'mbar-title' }, h('b', {}, 'Queue'), h('small', {}, 'Sent one record at a time')), h('button', { type: 'button', class: 'btn small primary', onclick: async () => { const n = await engine.uploadAll(); engine.nudge(); await M.refreshVisits?.(); M.toast(n ? `Sending ${n} record${n === 1 ? '' : 's'}.` : 'Nothing was waiting for Upload all.'); } }, 'Upload All')), body);
  };

  // ---- Health (m20), error detail (m21), storage (m33) -------------------------------------------
  M.views.health = (v) => {
    const body = h('div', { class: 'scroll pad' });
    const draw = () => {
      const sum = engine.summary(), failed = subs().filter((s) => s.status === 'failed');
      const last = [...engine.logs].reverse().find((l) => l.level !== 'error') || null, logs = [...engine.logs].reverse().slice(0, 7);
      const forms = Math.max(...M.library.all.map((f) => f.version), 1);
      body.replaceChildren(
        h('div', { class: 'card summ' }, h('b', {}, `Last sync ${last ? hhmm(last.ts) : 'none yet'} · ${sum.pending} photo${sum.pending === 1 ? '' : 's'} waiting`), h('small', { class: 'link block' }, `Storage OK · Form v${forms} · Nothing lost`)),
        h('h3', {}, `Issues (${failed.length})`),
        ...(failed.length ? failed.map((s) => { const m = engine.mediaFor(s.id).find((x) => x.state === 'failed'), code = m?.errorCode || s.error?.code || 'ERR-GEN-000';
          return h('button', { type: 'button', class: 'card issue', onclick: () => M.go('errordetail', { subId: s.id }) }, h('div', { class: 'vtop' }, h('b', {}, m ? `${m.name} could not be sent` : describe(code).title), h('span', { class: 'link' }, 'See what to do')), h('code', { class: 'chip err' }, code)); }) : [h('small', { class: 'muted' }, 'No issues.')]),
        h('h3', {}, 'Sync log'),
        h('div', { class: 'card logs' }, ...(logs.length ? logs.map((l) => h('div', { class: 'logrow' }, h('small', { class: 'muted' }, hhmm(l.ts)), h('span', { class: 'grow' }, l.msg), l.code ? h('code', { class: 'chip ' + (l.level === 'error' ? 'err' : 'warn') }, l.code) : null)) : [h('small', { class: 'muted' }, 'Nothing yet.')])),
        h('button', { type: 'button', class: 'vrow plain', onclick: () => M.go('storage') }, h('b', {}, 'Phone storage'), icon('chevron', 16)),
        h('small', { class: 'muted center' }, 'Sending a report to the dev team comes in a later release.'));
    };
    v.live = draw; draw();
    return h('div', { class: 'mcol' }, h('header', { class: 'mbar big' }, h('div', { class: 'mbar-title' }, h('b', {}, 'Health'), h('small', {}, 'What is happening on this phone'))), body);
  };

  M.views.errordetail = (v) => {
    const sub = engine.subs.get(v.subId); const m = engine.mediaFor(v.subId).find((x) => x.state === 'failed') || engine.mediaFor(v.subId).find((x) => x.lastError);
    const code = m?.errorCode || m?.lastError || sub?.error?.code || 'ERR-GEN-000', [what, todo] = FIX[code] || [describe(code).cause, describe(code).fix];
    return h('div', { class: 'mcol' }, M.appbar(m ? `${m.name} could not be sent` : describe(code).title, sub ? nm(sub) : ''),
      h('div', { class: 'scroll pad' }, h('code', { class: 'chip err' }, code), h('div', { class: 'card' }, h('small', { class: 'cap' }, 'What happened'), h('p', {}, what), h('p', { class: 'muted' }, 'Your other photos are safe on this phone.')),
        h('div', { class: 'card info' }, h('small', { class: 'cap' }, 'What to do'), h('p', {}, todo))),
      h('div', { class: 'footbar' }, m ? h('button', { type: 'button', class: 'btn primary big', onclick: async () => { await engine.reopen(sub.id); M.back(); M.go('form', { subId: sub.id, page: pageOf(sub.survey, m.fieldPath), focusPath: m.fieldPath }); } }, 'Go to the photo') : null,
        h('button', { type: 'button', class: 'btn big', onclick: async () => { await engine.retry(v.subId); M.toast('Trying again.'); M.back(); } }, 'Retry')));
  };

  M.views.storage = (v) => {
    const box = h('div', { class: 'scroll pad' });
    const draw = () => {
      const all = [...engine.subs.values()].filter((s) => !s.shared), size = (list) => list.reduce((n, s) => n + engine.mediaFor(s.id).reduce((a, m) => a + (m.state === 'done' && m.blobFreed ? 0 : m.size || 0), 0), 0);
      const wait = all.filter((s) => ['queued', 'uploading', 'ready', 'failed'].includes(s.status)), dr = all.filter((s) => s.status === 'draft'), done = all.filter((s) => s.status === 'complete');
      const a = size(wait), b = size(dr), c = size(done), t = Math.max(a + b + c, 1), pct = (x) => `${(x / t) * 100}%`;
      const ph = (list) => list.reduce((n, s) => n + engine.mediaFor(s.id).length, 0);
      box.replaceChildren(h('div', { class: 'card' }, h('b', { class: 'big' }, fmtBytes(a + b + c) + ' used'), h('small', { class: 'muted block' }, 'Delivered records clear on their own'),
        h('div', { class: 'stack' }, h('i', { class: 'a', style: `width:${pct(a)}` }), h('i', { class: 'b', style: `width:${pct(b)}` }), h('i', { class: 'c', style: `width:${pct(c)}` })),
        h('div', { class: 'legend' }, h('small', {}, h('i', { class: 'a' }), 'Waiting to send'), h('small', {}, h('i', { class: 'b' }), 'Drafts'), h('small', {}, h('i', { class: 'c' }), 'Delivered'))),
        ...[['Waiting to send', `${ph(wait)} photos · ${wait.length} records`, a], ['Drafts', `${dr.length} survey${dr.length === 1 ? '' : 's'}`, b], ['Delivered, clearing', 'Removed once the server confirms', c]].map(([l, d, n]) => h('div', { class: 'prow static' }, h('div', {}, h('b', {}, l), h('small', { class: 'muted block' }, d)), h('b', {}, fmtBytes(n)))),
        h('div', { class: 'info-card' }, h('b', {}, 'Deleting a survey frees its space.'), h('small', { class: 'block' }, 'Answers and photos are removed from this phone.')),
        h('button', { type: 'button', class: 'btn big', onclick: async () => { for (const s of done) await engine.deleteSub(s.id); M.toast('Delivered records cleared.'); draw(); } }, 'Clear delivered records now'));
    };
    v.live = draw; draw();
    return h('div', { class: 'mcol' }, M.appbar('Phone storage', 'What FieldSync Mobile keeps on this phone'), box);
  };

  // ---- demo helpers -------------------------------------------------------------------------------
  M.demo = M.demo || {};
  Object.assign(M.demo, {
    /** A closeout record with many photos, queued, so the Queue screen has something to show. */
    bulk: async (n = 24, { hold = false } = {}) => {
      const sv = M.library.get('demo-verizon-closeout'); const org = M.org() === 'all' ? M.orgs()[0].id : M.org();
      const sub = { id: M.uid(), surveyId: sv.id, surveyTitle: sv.title, schemaVersion: sv.version, survey: sv, status: 'draft', answers: S.newAnswers(sv, M.device), page: 0, createdAt: Date.now(), updatedAt: Date.now(), submittedAt: 0, orgId: org, siteLabel: 'TX-4412' };
      sub.answers.siteId = 'TX-4412'; engine.registerSub(sub); await db.put('submissions', sub);
      const files = []; for (let i = 0; i < n; i++) files.push(await scenePhoto(i % 3 ? 1 : 0.5, `IMG_${String(i + 1).padStart(4, '0')}.jpg`));
      const wide = await addImages(engine, sub, 'wideShots', files.slice(0, Math.ceil(n / 2))); const close = await addImages(engine, sub, 'closeUps', files.slice(Math.ceil(n / 2)));
      sub.answers.wideShots = wide.ids; sub.answers.closeUps = close.ids; await db.put('submissions', sub);
      const pr = S.prune(sv, sub.answers); sub.answers = pr.answers; sub.label = 'Verizon closeout · TX-4412'; await engine.submit(sub, pr.mediaIds, { hold });
      return sub;
    },
    /** Make one queued photo too big for the server (ERR-IMG-001), so Health and the error detail have something real. */
    failPhoto: async () => {
      const sub = subs().find((s) => ['ready', 'queued', 'uploading'].includes(s.status)) || await M.demo.bulk(8, { hold: true });
      const rec = engine.mediaFor(sub.id).find((m) => m.state !== 'done'); if (rec) { rec.size = 31 * 1024 * 1024; await db.put('media', rec); }
      await engine.uploadAll(); return sub;
    },
    accessChanged: () => M.go('accesschanged'),
    crash: () => { const u = new URL(location.href); u.searchParams.set('restored', '1'); location.href = u.toString(); },
    network: (name) => { server.setProfile(name); LS.set('profile', name); engine.nudge(); M.demo.refresh?.(); M.render(); },
    go: (name, params) => M.go(name, params || {}),
    switcher: () => M.switcher(),
    state: () => ({ view: M.current().name, org: M.org(), signedIn: M.auth.signedIn }),
  });
}
