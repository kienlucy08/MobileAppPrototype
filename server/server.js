// Zero-dependency server: serves the app AND the API, so any phone on the same Wi-Fi can use it.
//   node server/server.js            → http://<your-LAN-ip>:8123/
// State (records, shared docs, issue reports) is persisted to server/data/state.json; photos to server/data/media/.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ServerCore, freshState, MAX_PHOTO_BYTES } from '../src/serverCore.js';
import { AppError } from '../src/errors.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.md': 'text/markdown; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.svg': 'image/svg+xml' };

export function createServer({ dataDir = path.join(here, 'data'), root = path.join(here, '..') } = {}) {
  fs.mkdirSync(path.join(dataDir, 'media'), { recursive: true });
  const stateFile = path.join(dataDir, 'state.json');
  let state; try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { state = freshState(); }
  const core = new ServerCore(state);

  let saveT = null;
  const save = () => {
    clearTimeout(saveT);
    saveT = setTimeout(() => { fs.writeFileSync(stateFile + '.tmp', JSON.stringify(core.state)); fs.renameSync(stateFile + '.tmp', stateFile); }, 250);
  };
  core.onChange = save;

  const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const readBody = (req, limit) => new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new AppError('ERR-IMG-001', `Payload larger than ${(limit / 1048576).toFixed(0)} MB`)); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
  const json = async (req) => { const b = await readBody(req, 8 * 1024 * 1024); return b.length ? JSON.parse(b.toString('utf8')) : {}; };
  const safe = (s) => String(s).replace(/[^\w.-]/g, '_');

  async function api(req, res, url) {
    const m = req.method, p = url.pathname;
    let g;
    // Every phone-facing route needs a signed-in user (the same account as the web app). Admin, auth, health and report routes are open in this prototype.
    const open = p.startsWith('/api/auth/') || p === '/api/ping' || p === '/api/stats' || p.startsWith('/api/admin/') || p.startsWith('/api/issues') || (m === 'GET' && p.startsWith('/api/media/'));
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = open ? null : core.userFor(token);
    const who = core.who(user);
    if (m === 'POST' && p === '/api/auth/login') return send(res, 200, core.loginPassword(await json(req)));
    if (m === 'POST' && p === '/api/auth/microsoft') return send(res, 200, core.loginMicrosoft(await json(req)));
    if (m === 'GET' && p === '/api/identity/me') return send(res, 200, core.me(token));
    if (m === 'GET' && p === '/api/ping') return send(res, 200, { ok: true, t: Date.now() });
    if (m === 'GET' && p === '/api/stats') return send(res, 200, core.stats());
    if (m === 'POST' && p === '/api/begin') return send(res, 200, core.begin({ ...(await json(req)), user: who }));
    if (m === 'POST' && p === '/api/commit') return send(res, 200, core.commit(await json(req)));
    if ((g = p.match(/^\/api\/media\/([^/]+)\/([^/]+)$/))) {
      const [, rec, id] = g, file = path.join(dataDir, 'media', safe(rec), safe(id));
      if (m === 'PUT') {
        const buf = await readBody(req, MAX_PHOTO_BYTES + 1024);
        if (!core.state.subs[rec]) throw new AppError('ERR-SYNC-002', 'No handshake for this record');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file + '.tmp', buf); fs.renameSync(file + '.tmp', file);
        return send(res, 200, core.putMedia({ id: rec, mediaId: id, size: Math.max(buf.length, Number(req.headers['x-photo-size']) || 0) }));   // the phone declares its size; the larger of the two is checked
      }
      if (m === 'GET') return fs.existsSync(file) ? send(res, 200, fs.readFileSync(file), 'image/jpeg') : send(res, 404, { error: { code: 'ERR-GEN-000', detail: 'No such photo' } });
    }
    if (m === 'GET' && p === '/api/identity/organizations') return send(res, 200, core.orgsFor(user.email));
    if (m === 'POST' && p === '/api/admin/form-scope') { const b = await json(req); return send(res, 200, core.setFormScope(b.id, b.scope)); }
    if (m === 'POST' && p === '/api/admin/users') return send(res, 200, core.setUsers((await json(req)).users || []));
    if (m === 'POST' && p === '/api/admin/orgs') return send(res, 200, core.setOrgs((await json(req)).orgs || []));
    if (m === 'GET' && p === '/api/forms') return send(res, 200, core.listForms());
    if (m === 'POST' && p === '/api/forms') return send(res, 200, core.publishForm((await json(req)).survey));
    if (m === 'POST' && p === '/api/admin/min-schema') return send(res, 200, core.setMinSchema((await json(req)).n));
    if (m === 'POST' && p === '/api/admin/reset') { core.state = freshState(); fs.rmSync(path.join(dataDir, 'media'), { recursive: true, force: true }); fs.mkdirSync(path.join(dataDir, 'media'), { recursive: true }); save(); return send(res, 200, { ok: true }); }
    if (m === 'GET' && p === '/api/admin/overview') return send(res, 200, core.overview());

    if (m === 'GET' && p === '/api/sitedata') return send(res, 200, core.siteData(url.searchParams.get('site') || ''));
    if (m === 'GET' && p === '/api/team') return send(res, 200, core.teammates(user));
    if (m === 'GET' && p === '/api/notifications') return send(res, 200, core.notificationsFor(user));
    if (m === 'POST' && p === '/api/notifications/read') return send(res, 200, core.readNotifications(user));
    if (m === 'GET' && p === '/api/shared') return send(res, 200, core.listShared(user));
    if (m === 'POST' && p === '/api/shared') return send(res, 200, core.createShared({ ...(await json(req)), user: who }));
    if ((g = p.match(/^\/api\/shared\/([^/]+)(\/(ops|submit|assign))?$/))) {
      const id = g[1], what = g[3];
      if (what === 'assign' && m === 'POST') return send(res, 200, core.assign(id, await json(req), user));
      if (!what && m === 'GET') return send(res, 200, core.getShared(id));
      if (what === 'ops' && m === 'GET') return send(res, 200, core.pullOps(id, { since: Number(url.searchParams.get('since') || 0), deviceId: url.searchParams.get('d'), name: url.searchParams.get('n'), focus: url.searchParams.get('f') || null, pending: Number(url.searchParams.get('p') || 0) }));
      if (what === 'ops' && m === 'POST') return send(res, 200, core.pushOps(id, await json(req)));
      if (what === 'submit' && m === 'POST') return send(res, 200, core.submitShared(id, { ...(await json(req)), user: who }));
    }
    if (m === 'POST' && p === '/api/issues') return send(res, 200, core.addIssue(await json(req)));
    if ((g = p.match(/^\/api\/issues\/([^/]+)$/))) {
      if (m === 'GET') return send(res, 200, core.getIssue(g[1]));
      if (m === 'POST') return send(res, 200, core.setIssueStatus(g[1], (await json(req)).status));
    }
    return send(res, 404, { error: { code: 'ERR-GEN-000', detail: `No route ${m} ${p}` } });
  }

  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname); if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(root, rel));
    const ok = file.startsWith(root + path.sep) && !/\/(server\/data|node_modules|\.git)\//.test(file.replace(root, '') + '/') && MIME[path.extname(file)];
    if (!ok || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, fs.readFileSync(file), MIME[path.extname(file)]);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else serveStatic(req, res, url);
    } catch (e) {
      if (e instanceof AppError) send(res, /^ERR-AUTH-00[123]/.test(e.code) ? 401 : e.code === 'ERR-AUTH-004' ? 403 : 422, { error: { code: e.code, detail: e.message, data: e.data } });
      else { console.error(e); send(res, 500, { error: { code: 'ERR-GEN-000', detail: e.message } }); }
    }
  });
  return { server, core, flush: () => { clearTimeout(saveT); fs.writeFileSync(stateFile, JSON.stringify(core.state)); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8123);
  const { server } = createServer();
  server.listen(port, '0.0.0.0', () => {
    console.log(`\nField Collect server running\n  this computer:  http://localhost:${port}/`);
    for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`  phones on Wi-Fi: http://${a.address}:${port}/app.html`);
    console.log(`  dev-team view:  http://localhost:${port}/admin.html\n`);
  });
}
