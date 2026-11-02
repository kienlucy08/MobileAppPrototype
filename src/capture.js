// Phase 2 capture tools: an in-app camera with zoom steps (0.5x / 1x / 2x) and rapid-fire shooting, and a photo-first
// flow (shoot freely, then sort photos into survey questions) for comparing against the form-first model.
//
// Honest limits of a web prototype: a browser only exposes camera zoom (and ultra-wide at 0.5x) on some phones. Where it
// does not, the button is disabled and says so. A native build calls the phone's camera API directly, so every lens and
// full native quality are available. Where there is no camera at all (a desktop), a simulated tower scene stands in so the
// flow can still be judged.

import { h, uid } from './util.js';
import { icon } from './icons.js';
import { addImages } from './images.js';

const ZOOMS = [0.5, 1, 2, 10];
const DEMO = new URLSearchParams(globalThis.location?.search || '').has('demo');   // demo pages always use the simulated camera so 0.5x and 10x work on any laptop

function drawScene(cv, zoom) {                    // the simulated "camera": a guyed tower; 0.5x shows more of the site, 2x less
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, s = zoom;
  g.fillStyle = '#9ec9e8'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#5b8c3e'; g.fillRect(0, H * 0.78, W, H * 0.22);
  g.save(); g.translate(W / 2, H * 0.78); g.scale(s, s);
  const tw = 18, th = H * 0.62;
  g.strokeStyle = '#3b4252'; g.lineWidth = 4 / s;
  g.beginPath(); g.moveTo(-tw, 0); g.lineTo(0, -th); g.lineTo(tw, 0); g.stroke();
  for (let y = 0; y < th; y += th / 12) { const w = tw * (1 - y / th); g.beginPath(); g.moveTo(-w, -y); g.lineTo(w, -y - th / 24); g.stroke(); }
  g.strokeStyle = '#475569'; g.lineWidth = 2 / s;
  for (const dx of [-W * 0.42, W * 0.42, -W * 0.25, W * 0.25]) { g.beginPath(); g.moveTo(0, -th * 0.8); g.lineTo(dx, 0); g.stroke(); }
  g.restore();
  g.fillStyle = 'rgba(0,0,0,.55)'; g.font = `${Math.round(H / 22)}px sans-serif`; g.fillText(`SIMULATED CAMERA · ${zoom}x`, 16, H / 14);
}

/** A simulated site photo at a given zoom (0.5 = wide, 10 = close-up), as a File — used by the demo flows. */
export async function scenePhoto(zoom, name) {
  const cv = Object.assign(document.createElement('canvas'), { width: 2400, height: 1800 }); drawScene(cv, zoom);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.92));
  return new File([blob], name || `IMG_${zoom}x.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
}

/** Opens the camera sheet. `onShots(files)` is called with each photo as it is taken. Returns { close }. */
export async function openCamera({ container, defaultZoom = 1, onShot, onClose, title = 'Camera', fallbackInput }) {
  let zoom = defaultZoom, taken = 0, stream = null, track = null, caps = null, sim = false;
  const video = h('video', { class: 'cam-view', playsinline: true, muted: true, autoplay: true });
  const scene = h('canvas', { class: 'cam-view', width: 960, height: 720 });
  const note = h('div', { class: 'cam-note' });
  const count = h('span', { class: 'cam-count' }, '0 taken');
  const zbtns = h('div', { class: 'cam-zoom' });
  const flash = h('div', { class: 'cam-flash' }), last = h('div', { class: 'cam-last' });

  try {
    if (DEMO) throw new Error('demo');
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 4032 }, height: { ideal: 3024 } }, audio: false });
    track = stream.getVideoTracks()[0]; caps = track.getCapabilities?.() || {};
    video.srcObject = stream;
  } catch { sim = true; }

  const supported = (z) => sim || (z === 1) || (caps?.zoom && z >= caps.zoom.min && z <= caps.zoom.max);
  const apply = async (z) => {
    zoom = z;
    if (sim) drawScene(scene, z);
    else if (caps?.zoom) { try { await track.applyConstraints({ advanced: [{ zoom: z }] }); } catch { /* keep current */ } }
    zbtns.replaceChildren(...ZOOMS.map((v) => h('button', { type: 'button', class: 'zbtn' + (v === zoom ? ' on' : ''), disabled: !supported(v), title: supported(v) ? `${v}x` : `${v}x needs the native camera build`, onclick: () => apply(v) }, `${v}×`)));
    note.textContent = sim ? 'No camera on this device — simulated scene. The native app uses the phone camera directly (all lenses, 0.5x, full quality).'
      : !supported(0.5) ? '0.5× ultra-wide is not exposed by this browser. The native app calls the camera API directly and offers it.' : '';
  };

  const BURST = 5;
  let busy = false;
  const burst = async () => {                      // several photos in one tap, ~0.3s apart
    if (busy) return; busy = true; burstBtn.disabled = true;
    try { for (let i = 0; i < BURST; i++) { await shoot(); await new Promise((r) => setTimeout(r, 300)); } }
    finally { busy = false; burstBtn.disabled = false; }
  };
  const shoot = async () => {
    let blob;
    if (sim) {
      const cv = Object.assign(document.createElement('canvas'), { width: 2400, height: 1800 }); drawScene(cv, zoom);
      blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.92));
    } else {
      try { blob = await new ImageCapture(track).takePhoto(); } catch { /* fall back to a frame grab */ }
      if (!blob) {
        const cv = Object.assign(document.createElement('canvas'), { width: video.videoWidth || 1280, height: video.videoHeight || 720 });
        cv.getContext('2d').drawImage(video, 0, 0); blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.95));
      }
    }
    taken++; count.textContent = `${taken} taken`;
    flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');          // shutter flash
    const th = URL.createObjectURL(blob); last.replaceChildren(h('img', { src: th, alt: 'Last photo' }), h('small', {}, `${zoom}×`));
    onShot(new File([blob], `IMG_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}_${taken}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }));
  };

  const burstBtn = h('button', { type: 'button', class: 'btn small burst', title: `Take ${BURST} photos in a row`, onclick: burst }, `Burst ×${BURST}`);
  const close = () => { stream?.getTracks().forEach((t) => t.stop()); el.remove(); onClose?.(taken); };
  const el = h('div', { class: 'cam' },
    h('header', { class: 'cam-top' }, h('b', {}, title), count, h('button', { type: 'button', class: 'btn small', onclick: close }, 'Done')),
    h('div', { class: 'cam-stage' }, sim ? scene : video, flash, last), note, zbtns,
    h('div', { class: 'cam-bar' }, fallbackInput ? h('button', { type: 'button', class: 'btn small ghost', onclick: () => { close(); fallbackInput.click(); } }, 'Use phone camera app') : h('span'),
      h('button', { type: 'button', class: 'shutter', 'aria-label': 'Take photo', onclick: shoot }), burstBtn));
  container.append(el);
  await apply(supported(defaultZoom) ? defaultZoom : 1);
  return { close };
}

// =================================================================================================
// Photo-first: shoot first, sort into questions afterwards.
// =================================================================================================

/** Every image question that can receive photos: top-level ones, and those inside each repeat entry. */
export function photoTargets(survey, answers) {
  const out = [];
  const walk = (fields, scope, prefix, path) => {
    for (const f of fields) {
      if (f.type === 'image' && f.appearance !== 'signature') out.push({ label: `${prefix}${f.label || f.name}`, path: path + f.name, arr: () => (scope[f.name] ||= []), max: f.maxFiles });
      else if (f.type === 'repeat') (scope[f.name] || []).forEach((it, i) => walk(f.fields, it, `${f.label || f.name} #${i + 1} › `, `${path}${f.name}/${it._id}/`));
    }
  };
  survey.pages.forEach((p) => walk(p.fields, answers, '', ''));
  return out;
}

export function photoFirst(ctx, sub, survey, { container, onDone }) {
  sub.inbox ||= [];
  const sel = new Set();
  const grid = h('div', { class: 'thumbs pf-grid' }), head = h('div', { class: 'pf-head' }), moveBtn = h('button', { type: 'button', class: 'btn primary', disabled: true }, 'Put in…');
  const save = () => (sub.shared ? ctx.engine._saveSub(sub) : ctx.db.put('submissions', sub));

  const ingest = async (files) => {
    const r = await addImages(ctx.engine, sub, '_inbox', [...files]);
    sub.inbox.push(...r.ids); await save(); draw();
    for (const e of r.errors) ctx.toast(`${e.code}: ${e.detail}`, 6000);
  };
  const gal = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: (e) => { ingest(e.target.files); e.target.value = ''; } });
  const cam = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: (e) => { ingest(e.target.files); e.target.value = ''; } });

  const draw = () => {
    head.textContent = sub.inbox.length ? `${sub.inbox.length} photo${sub.inbox.length === 1 ? '' : 's'} to sort — tap to select, then “Put in…”` : 'Shoot or add photos first. You sort them into the survey afterwards.';
    moveBtn.disabled = !sel.size; moveBtn.textContent = sel.size ? `Put ${sel.size} in…` : 'Put in…';
    grid.replaceChildren(...sub.inbox.map((id) => {
      const r = ctx.engine.media.get(id);
      return h('button', { type: 'button', class: 'thumb' + (sel.has(id) ? ' sel' : ''), onclick: () => { sel.has(id) ? sel.delete(id) : sel.add(id); draw(); } }, r?.thumb ? h('img', { src: r.thumb, alt: r.name }) : r?.name || id.slice(0, 6), sel.has(id) ? h('span', { class: 'by' }, '✓') : null);
    }));
  };

  const pick = () => {
    const targets = photoTargets(survey, sub.answers);
    const sheet = h('div', { class: 'pf-pick' },
      h('h3', {}, `Put ${sel.size} photo${sel.size === 1 ? '' : 's'} in`),
      ...(targets.length ? targets.map((t) => h('button', { type: 'button', class: 'btn big', onclick: async () => {
        const arr = t.arr(), room = t.max == null ? sel.size : Math.max(0, t.max - arr.length), ids = [...sel].slice(0, room);
        if (ids.length < sel.size) ctx.toast(`“${t.label}” takes up to ${t.max}: moved ${ids.length}, kept ${sel.size - ids.length} here.`, 5000);
        for (const id of ids) { const r = ctx.engine.media.get(id); if (r) { r.fieldPath = t.path; await ctx.db.put('media', r); } arr.push(id); sub.inbox.splice(sub.inbox.indexOf(id), 1); sel.delete(id); }
        if (sub.shared) { ctx.collab.localChanged(sub.id, sub.answers); ctx.collab.flush(sub.id); }
        await save(); sheet.remove(); draw();
      } }, h('b', {}, t.label), h('small', {}, `${t.arr().length}${t.max != null ? ` / ${t.max}` : ''} photos`))) : [h('p', { class: 'muted' }, 'This survey has no photo questions.')]),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => sheet.remove() }, 'Cancel'));
    el.append(sheet);
  };
  moveBtn.onclick = pick;

  const el = h('div', { class: 'cam pf' },
    h('header', { class: 'cam-top' }, h('b', {}, 'Photo-first'), h('span', { class: 'muted' }, 'exploration'), h('button', { type: 'button', class: 'btn small', onclick: () => { el.remove(); onDone(); } }, 'Done')),
    h('div', { class: 'pf-body' }, head,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => { if (ctx.has('camera')) openCamera({ container: el, title: 'Photo-first', onShot: (f) => ingest([f]), fallbackInput: cam }); else cam.click(); } }, icon('camera'), 'Camera'),
        h('button', { type: 'button', class: 'btn', onclick: () => gal.click() }, icon('image'), 'Gallery / files'), moveBtn),
      gal, cam, grid));
  draw(); container.append(el);
  return el;
}
