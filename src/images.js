// On-device image pipeline. Nothing full-resolution is ever queued or uploaded:
//   decode → read EXIF (before it's stripped) → downscale to <=2048px → re-encode until <=1.2 MB → thumbnail.
// Screenshots, gallery picks and camera shots all go through the same path. Missing GPS/time is flagged, never fatal.

import { AppError } from './errors.js';
import { uid } from './util.js';

export const LIMITS = { maxDim: 2048, targetBytes: 1_200_000, minQuality: 0.5, thumb: 96 };

const makeCanvas = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));
const toBlob = (cv, q, type = 'image/jpeg') => (cv.convertToBlob ? cv.convertToBlob({ type, quality: q }) : new Promise((r) => cv.toBlob(r, type, q)));
const toDataURL = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });

// ---- minimal EXIF reader (GPS + capture time) ---------------------------------------------------
export async function readExif(file) {
  try {
    if (!/jpe?g/i.test(file.type)) return {};
    const dv = new DataView(await file.slice(0, 131072).arrayBuffer());
    if (dv.getUint16(0) !== 0xffd8) return {};
    for (let off = 2; off < dv.byteLength - 4;) {
      const marker = dv.getUint16(off), len = dv.getUint16(off + 2);
      if (marker === 0xffe1 && dv.getUint32(off + 4) === 0x45786966) return parseTiff(dv, off + 10);
      if ((marker & 0xff00) !== 0xff00) break;
      off += 2 + len;
    }
  } catch { /* treat as no metadata */ }
  return {};
}

function parseTiff(dv, base) {
  const le = dv.getUint16(base) === 0x4949;
  const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
  const ifd = (off) => { const t = {}; for (let i = 0, n = u16(off); i < n; i++) { const e = off + 2 + i * 12; t[u16(e)] = { count: u32(e + 4), at: e + 8 }; } return t; };
  const ascii = (t) => { const o = t.count > 4 ? base + u32(t.at) : t.at; let s = ''; for (let i = 0; i < t.count - 1; i++) s += String.fromCharCode(dv.getUint8(o + i)); return s; };
  const rats = (t) => { const o = base + u32(t.at); return Array.from({ length: t.count }, (_, i) => u32(o + i * 8) / u32(o + i * 8 + 4)); };
  const dms = ([d, m, s]) => d + m / 60 + s / 3600;
  const out = {};
  const t0 = ifd(base + u32(base + 4));
  if (t0[0x8769]) { const ex = ifd(base + u32(t0[0x8769].at)); if (ex[0x9003]) out.capturedAt = ascii(ex[0x9003]).replace(/^(\d{4}):(\d\d):(\d\d) /, '$1-$2-$3T'); }
  if (t0[0x8825]) {
    const g = ifd(base + u32(t0[0x8825].at));
    if (g[2] && g[4]) {
      out.lat = dms(rats(g[2])) * (g[1] && ascii(g[1]) === 'S' ? -1 : 1);
      out.lon = dms(rats(g[4])) * (g[3] && ascii(g[3]) === 'W' ? -1 : 1);
    }
  }
  return out;
}

// ---- compression ---------------------------------------------------------------------------------
async function encode(bmp, W, H) {
  let scale = Math.min(1, LIMITS.maxDim / Math.max(W, H)), best;
  for (let pass = 0; pass < 4; pass++) {
    const w = Math.round(W * scale), h = Math.round(H * scale);
    const cv = makeCanvas(w, h), g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(bmp, 0, 0, w, h);
    for (let q = 0.82; q >= LIMITS.minQuality - 1e-6; q -= 0.1) {
      best = { blob: await toBlob(cv, q), w, h };
      if (best.blob.size <= LIMITS.targetBytes) return best;
    }
    scale *= 0.8;
  }
  return best;
}

async function thumbOf(bmp) {
  const s = LIMITS.thumb, r = Math.max(s / bmp.width, s / bmp.height);
  const cv = makeCanvas(s, s), g = cv.getContext('2d');
  g.drawImage(bmp, (s - bmp.width * r) / 2, (s - bmp.height * r) / 2, bmp.width * r, bmp.height * r);
  return toDataURL(await toBlob(cv, 0.6));
}

export async function processImage(file) {
  const exif = await readExif(file);
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    try { bmp = await createImageBitmap(file); }
    catch { throw new AppError('ERR-IMG-002', `${file.name || 'image'} could not be decoded (${file.type || 'unknown type'}).`); }
  }
  const thumb = await thumbOf(bmp);
  const isSmallJpeg = /jpe?g/i.test(file.type) && file.size <= LIMITS.targetBytes && Math.max(bmp.width, bmp.height) <= LIMITS.maxDim;
  const out = isSmallJpeg ? { blob: file, w: bmp.width, h: bmp.height } : await encode(bmp, bmp.width, bmp.height);
  bmp.close?.();
  return {
    ...out, thumb,
    meta: {
      capturedAt: exif.capturedAt || null, lat: exif.lat ?? null, lon: exif.lon ?? null,
      noLocation: exif.lat == null, noTimestamp: !exif.capturedAt,
      fileDate: new Date(file.lastModified || Date.now()).toISOString(),
    },
  };
}

/**
 * Compress + persist images for one image field. `items` are Files or lazy () => File factories
 * (so 400 generated originals never sit in memory at once). Failures are returned, never swallowed.
 */
export async function addImages(engine, sub, fieldPath, items, { onProgress, concurrency = 2 } = {}) {
  const est = await navigator.storage?.estimate?.().catch(() => null);
  if (est && est.quota - est.usage < 50 * 1024 * 1024) throw new AppError('ERR-STO-001', 'Less than 50 MB of storage remaining.');

  const ids = new Array(items.length), errors = [];
  let next = 0, done = 0, origBytes = 0, bytes = 0;
  const one = async () => {
    for (let i = next++; i < items.length; i = next++) {
      const file = typeof items[i] === 'function' ? await items[i]() : items[i];
      try {
        const p = await processImage(file);
        const rec = {
          id: uid(), subId: sub.id, fieldPath, name: file.name || `photo-${i + 1}.jpg`, state: sub.shared ? 'queued' : 'local',
          size: p.blob.size, origSize: file.size, w: p.w, h: p.h, thumb: p.thumb, meta: p.meta,
          attempts: 0, nextAttemptAt: 0, createdAt: Date.now(),
        };
        await engine.db.put('blobs', { id: rec.id, blob: p.blob });
        await engine.db.put('media', rec);
        engine.registerMedia(rec);
        ids[i] = rec.id; origBytes += file.size; bytes += p.blob.size;
      } catch (e) {
        errors.push({ name: file.name || `image ${i + 1}`, code: e.code || 'ERR-IMG-002', detail: e.message });
      }
      onProgress?.({ done: ++done, total: items.length, origBytes, bytes, errors: errors.length });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, one));
  if (sub.shared) engine.kick();                      // team records upload photos immediately, while people keep collecting
  return { ids: ids.filter(Boolean), errors, origBytes, bytes };
}

// ---- synthetic "phone photos" for the stress test ------------------------------------------------
export async function makeTestPhoto(i) {
  const big = i % 40 === 7;                                   // a few "108MP-class" originals
  const w = big ? 5200 : 3200, h = big ? 3900 : 2400;
  const cv = makeCanvas(w, h), g = cv.getContext('2d');
  const hue = (i * 47) % 360;
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, `hsl(${hue} 55% 35%)`); grad.addColorStop(1, `hsl(${(hue + 70) % 360} 60% 70%)`);
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  for (let k = 0; k < 1800; k++) {                              // texture so the JPEG is realistically heavy
    g.fillStyle = `hsla(${Math.random() * 360} 60% 50% / .5)`;
    g.fillRect(Math.random() * w, Math.random() * h, 8 + Math.random() * 90, 8 + Math.random() * 90);
  }
  g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, h - 260, w, 260);
  g.fillStyle = '#fff'; g.font = `bold ${Math.round(h / 12)}px sans-serif`; g.fillText(`Site photo #${i + 1}`, 80, h - 90);
  const blob = await toBlob(cv, 0.95);
  return new File([blob], `IMG_${String(i + 1).padStart(4, '0')}.jpg`, { type: 'image/jpeg', lastModified: Date.now() - i * 45_000 });
}
