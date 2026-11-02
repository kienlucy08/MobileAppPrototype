// Guided walkthroughs for screen shares. A virtual finger taps the real app, one step per "Next" press, so the
// audience watches exactly what a crew member does: open the app, pick a survey, fill it in, use the camera
// (zoom 0.5x–10x, shutter, photo added), review, submit — then a send that fails, and one that is good to go.
// Everything goes through the real UI (clicks and typing), so what is shown is what ships.

import { h } from './util.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();

export class Driver {
  constructor() {
    this.cur = h('div', { class: 'drv-cursor', hidden: true });
    this.hint = h('div', { class: 'drv-hint', hidden: true });
    document.body.append(this.cur, this.hint);
    this.cur.style.left = '195px'; this.cur.style.top = '500px';
  }
  say(text) { this.hint.hidden = !text; this.hint.textContent = text || ''; }
  async find(sel, { text, exact = false, timeout = 10000 } = {}) {
    const t0 = Date.now();
    for (;;) {
      const el = [...document.querySelectorAll(sel)].find((e) => {
        if (e.closest('[hidden]') || !e.getClientRects().length) return false;
        if (text == null) return true;
        const t = norm(e.textContent).toLowerCase(), q = String(text).toLowerCase();
        return exact ? t === q : t.includes(q);
      });
      if (el) return el;
      if (Date.now() - t0 > timeout) throw new Error(`Could not find “${text || sel}” on the screen`);
      await sleep(120);
    }
  }
  async point(el) {
    let r = el.getBoundingClientRect();                       // only scroll when the target is off-screen, and then as little as possible
    if (r.top < 70 || r.bottom > innerHeight - 90) { el.scrollIntoView({ block: 'nearest', behavior: 'instant' }); await sleep(120); r = el.getBoundingClientRect(); }
    this.cur.hidden = false; this.cur.style.left = `${r.left + Math.min(r.width / 2, 60)}px`; this.cur.style.top = `${r.top + r.height / 2}px`;
    await sleep(650);
  }
  async tap(sel, opts) {
    const el = await this.find(sel, opts); await this.point(el);
    this.cur.classList.add('tap'); await sleep(160); el.click(); this.cur.classList.remove('tap'); await sleep(420);
    return el;
  }
  async type(sel, value, opts) {
    const el = await this.find(sel, opts); await this.point(el);
    this.cur.classList.add('tap'); await sleep(120); this.cur.classList.remove('tap');
    el.focus(); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true }));
    for (const ch of String(value)) { el.value += ch; el.dispatchEvent(new Event('input', { bubbles: true })); await sleep(55); }
    el.dispatchEvent(new Event('change', { bubbles: true })); await sleep(250);
  }
  wait(ms) { return sleep(ms); }
  async until(fn, timeout = 30000) { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > timeout) throw new Error('Timed out waiting for the app'); await sleep(150); } }
  hide() { this.cur.hidden = true; this.hint.hidden = true; }
}

/** Step implementations. `env` = { go, LS, view, engine, db, collab }. */
export function guideSteps(env) {
  const d = new Driver();
  const T = (sel, text, opts = {}) => d.tap(sel, { text, ...opts });
  const next = () => T('.formnav .btn.primary', 'Next');
  const review = () => T('.formnav .btn.primary', 'Review');
  const closeCam = () => T('.cam-top .btn', 'Done');
  const zoom = (z) => T('.zbtn', `${z}×`, { exact: true });
  const openCamera = (field) => T(`[data-path="${field}"] .btn`, 'Camera');
  const gotoHome = async () => { if (!document.querySelector('.svtile')) await T('.tab', 'Surveys'); };
  const openDemoSurvey = async (title) => {
    env.LS.set('scopeAsked', ''); env.LS.set('scope', ''); env.go('home'); await d.wait(900);
    if (document.querySelector('.scope-pick')) { d.say('The app asks which scope of work you are on today.'); await T('.scope-pick .btn', 'Demo'); }
    d.say('Pick the survey from the library.'); await T('.svtile', title);
  };
  const fillSite = async (site) => { d.say('Fill in the site details (typed for you).'); await d.type('[data-path="siteId"] input', site); await d.type('[data-path="inspector"] input', env.device.name); };
  const shootOne = async (field, z, say) => { d.say(say); await openCamera(field); await d.find('.cam-zoom'); await d.wait(500); await zoom(z); await d.wait(400); await T('.shutter', null); await d.wait(900); await closeCam(); await d.wait(500); };
  const tooBig = async () => { const rec = env.engine.mediaFor(env.view().subId)[0]; rec.size = 31 * 1024 * 1024; await env.db.put('media', rec); };

  return {
    // ================= Phase 1: a good send, then a failed one, then the fix =================
    open: async () => { d.say('The app opens on the status-first home.'); env.LS.set('scopeAsked', ''); env.LS.set('scope', ''); env.go('home'); await d.wait(1500); d.say('It asks what you are working on today.'); await d.find('.scope-pick'); },
    scope: async () => { d.say('Choose a scope of work.'); await T('.scope-pick .btn', 'Demo'); },
    pick: async () => { d.say('Tap a survey tile.'); await T('.svtile', 'Demo · Closeout photos'); },
    start: async () => { d.say('Start the survey.'); await T('.modal .btn', 'Start survey'); },
    fill: async () => { await fillSite('TX-4412'); d.say('Next page.'); await next(); },
    camera: async () => { d.say('A photo question: tap Camera. The camera opens at 0.5× because this question asks for a wide shot.'); await openCamera('wideShots'); await d.find('.cam-zoom'); },
    zoomdemo: async () => { d.say('Zoom steps: 0.5× wide, 1×, 2×, up to 10×.'); for (const z of ['1', '2', '10', '0.5']) { await zoom(z); await d.wait(900); } },
    shoot: async () => { d.say('Shutter — the photo is taken and added.'); await T('.shutter', null); await d.wait(900); await closeCam(); await d.wait(600); d.say('The wide shot is on the question.'); },
    closeup: async () => { await shootOne('closeUps', '10', 'Close-up question: camera at 10×, then shutter.'); d.say('Need several? Burst takes 5 photos with one tap.'); await openCamera('closeUps'); await d.find('.cam-zoom'); await d.wait(500); await zoom('2'); await T('.burst', null); await d.until(() => /8 taken|5 taken/.test(document.querySelector('.cam-count')?.textContent || ''), 8000); await d.wait(800); await closeCam(); await d.wait(500); },
    review: async () => { d.say('Review: everything is checked before it can be sent.'); await review(); await d.wait(1500); },
    send: async () => { d.say('Save & send. It is written to the phone first, then uploaded in the background.'); await T('.btn.big', 'Save'); await d.find('.card.sub'); },
    delivered: async () => { d.say('Outbox: each photo turns green as the server confirms it.'); await d.until(() => /committed/.test(document.querySelector('.card.sub')?.textContent || ''), 40000); d.say('Delivered — good to go.'); await d.wait(1200); },
    second: async () => { await gotoHome(); await openDemoSurvey('Demo · Closeout photos'); await T('.modal .btn', 'Start survey'); await fillSite('TX-5520'); await next(); },
    shots2: async () => { await shootOne('wideShots', '0.5', 'Wide shot at 0.5×.'); await shootOne('closeUps', '10', 'Close-up at 10×.'); },
    bigphoto: async () => { d.say('(Simulated) one photo is too big for the server.'); await tooBig(); await review(); await d.wait(1200); },
    send2: async () => { d.say('Save & send — this one will fail.'); await T('.btn.big', 'Save'); await d.until(() => /ERR-IMG-001/.test(document.body.textContent), 40000); d.say('Failed — but plainly: a code, the cause, and the other photos still arrived. Both records are in the Outbox.'); await d.wait(1500); },
    goto: async () => { d.say('“Go to the problem” takes you to the question with the flagged photo.'); await T('.card.sub .btn', 'Go to the problem'); await d.find('.thumb.flagged'); },
    replace: async () => { d.say('Replace the flagged photo.'); await T('.thumb .replace', null); await d.find('.cam-zoom'); await d.wait(600); await zoom('1'); await T('.shutter', null); await d.wait(900); await closeCam(); await d.wait(600); },
    resend: async () => { await review(); await d.wait(1200); d.say('Save & send again.'); await T('.btn.big', 'Save'); await d.until(() => [...document.querySelectorAll('.card.sub')].every((c) => /committed/.test(c.textContent)), 40000); d.say('Both records delivered.'); await d.wait(1200); },

    // ================= Phase 2: a team record, a blocked submit, then the lead submits =================
    t_open: async () => { await openDemoSurvey('Demo · Closeout photos'); },
    t_team: async () => { d.say('Maria (crew lead) starts it as a team survey.'); await T('.modal .team-btn', null); await d.type('.modal input', 'TX-4412 closeout'); await T('.modal .btn.primary', 'Start'); await d.find('.form-body'); },
    t_fill: async () => { await fillSite('TX-4412'); },
    t_share: async () => { d.say('Share it with Sam.'); await T('.peopleline .btn', 'People'); await T('.people-list .row-card .btn', 'Add'); await d.wait(900); await T('.modal .btn.primary', 'Done'); },
    t_join: async () => { env.go('home'); await d.wait(900); d.say('Sam (crew member) sees the record shared with him.'); await T('.card.row-card .btn', 'Join', { timeout: 30000 }); await d.find('.form-body'); d.say('Maria’s answers are already there.'); await d.wait(1500); },
    t_sam_photo: async () => { await next(); await shootOne('closeUps', '10', 'Sam takes a 10× close-up from his phone.'); },
    t_maria_photo: async () => { await next(); await shootOne('wideShots', '0.5', 'Maria takes the 0.5× wide shot from hers.'); },
    t_sam_blocked: async () => { await d.wait(2000); await review(); await d.wait(1500); d.say('Who captured what — and Submit is locked for a crew member.'); await T('.btn', 'Demo: try anyway'); await d.find('.issue'); d.say('The server refuses too: ERR-AUTH-004.'); await d.wait(1500); },
    t_submit: async () => {
      await review(); await d.wait(1800); d.say('Who captured what: each person’s answers and photos.');
      for (let i = 0; i < 6; i++) {
        await T('.btn.big', 'Submit team record', { timeout: 20000 }); await d.wait(1800);
        const again = [...document.querySelectorAll('.issue .btn')].find((b) => /check again/i.test(b.textContent));
        if (!again) break; d.say('Sam’s photo is still uploading — checking again.'); await d.wait(2500); await T('.issue .btn', 'Check again');
      }
      await d.find('.card.sub'); d.say('Submitted by the crew lead.'); await d.wait(1200);
    },
  };
}
