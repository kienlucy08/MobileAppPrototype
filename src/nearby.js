// Nearby sync: phone-to-phone, no internet, no server.
// This is a SIMULATED radio (BroadcastChannel between tabs) standing in for Bluetooth / Wi-Fi Direct
// (Android Nearby Connections, iOS MultipeerConnectivity). The protocol is what a native build would carry:
//   hello    – "I'm here; these are the team records I hold"                       (every few seconds = range check)
//   state    – a record's full CRDT state; the receiver applies what is newer and passes on only real changes
//   getdoc / doc – "let me join that record" → survey + state
//   photo    – a photo handed over for relay upload (any member's phone may upload; the server de-duplicates by photo id)
// Only members of a record exchange it; a phone never learns about records it has not joined, beyond their title.

export class Nearby extends EventTarget {
  constructor({ collab, engine, db, device, channel = 'fc-nearby', Channel = globalThis.BroadcastChannel, helloMs = 2500, ttlMs = 8000 }) {
    super();
    Object.assign(this, { collab, engine, db, device, channel, Channel, helloMs, ttlMs });
    this.enabled = false; this.peers = new Map(); this.sent = 0; this.received = 0;
    this._timers = new Map();
    collab.onDocChanged = (id) => this._debounceState(id);
  }

  enable() {
    if (this.enabled) return;
    this.ch = new this.Channel(this.channel); this.ch.onmessage = (e) => this._onMsg(e.data);
    this.enabled = true; this._hello();
    this._iv = setInterval(() => { this._hello(); this._expire(); }, this.helloMs);
    this._emit();
  }
  disable() {
    if (!this.enabled) return;
    clearInterval(this._iv); this.ch.close(); this.enabled = false; this.peers.clear(); this._emit();
  }

  // ---- what the UI reads ------------------------------------------------------------------------
  peerList() { return [...this.peers.values()]; }
  /** Records a nearby phone has that this phone has not joined yet. */
  available() {
    const out = [];
    for (const p of this.peers.values()) for (const d of p.docs) if (!this.collab.docs.has(d.id)) out.push({ peer: p, doc: d });
    return out;
  }
  peersWith(docId) { return this.peerList().filter((p) => p.docs.some((d) => d.id === docId)); }

  // ---- actions ----------------------------------------------------------------------------------
  join(peerId, docId) { this._send({ t: 'getdoc', to: peerId, docId }); }

  /** Hand every photo of this record that has not reached the server to nearby members, so any of them can upload it. */
  async sharePhotos(docId) {
    const todo = this.engine.mediaFor(docId).filter((m) => m.state !== 'done' && !m.relayed);
    let n = 0;
    for (const rec of todo) {
      const b = await this.db.get('blobs', rec.id); if (!b) continue;
      const { thumb, ...slim } = rec;
      this._send({ t: 'photo', docId, rec: { ...slim, thumb }, blob: b.blob }); n++;
      this.sent++; this._emit(); await new Promise((r) => setTimeout(r, 0));
    }
    return n;
  }

  // ---- protocol ---------------------------------------------------------------------------------
  _send(msg) { if (this.enabled) this.ch.postMessage({ ...msg, from: { id: this.device.id, name: this.device.name } }); }
  _hello() { this._send({ t: 'hello', docs: [...this.collab.docs.values()].map((d) => ({ id: d.id, title: d.title, by: d.createdByName, status: d.status })) }); }
  _expire() { const now = Date.now(); let changed = false; for (const [id, p] of this.peers) if (now - p.seen > this.ttlMs) { this.peers.delete(id); changed = true; } if (changed) this._emit(); }
  _debounceState(id) {
    if (!this.enabled) return;
    clearTimeout(this._timers.get(id));
    this._timers.set(id, setTimeout(() => this._pushState(id), 250));
  }
  _pushState(id) {
    const pkg = this.collab.exportDoc(id); if (!pkg) return;
    this._send({ t: 'state', docId: id, meta: pkg.meta, state: pkg.state }); this.sent++; this._emit();
  }

  async _onMsg(m) {
    if (!m || m.from?.id === this.device.id || (m.to && m.to !== this.device.id)) return;
    switch (m.t) {
      case 'hello': {
        const isNew = !this.peers.has(m.from.id);
        this.peers.set(m.from.id, { id: m.from.id, name: m.from.name, docs: m.docs, seen: Date.now() });
        if (isNew) {                                                                  // someone came into range: bring each other up to date
          this._hello();
          for (const d of m.docs) if (this.collab.docs.has(d.id)) this._pushState(d.id);
        }
        this._emit(); break;
      }
      case 'state': {
        if (!this.collab.docs.has(m.docId)) break;                                    // not a member: ignore
        this.received++;
        const changed = this.collab.mergeState(m.docId, m.state, m.meta);
        if (changed) this.engine._log('info', null, `Nearby: merged ${changed} change(s) from ${m.from.name} — no server involved.`, m.docId);
        this._emit(); break;
      }
      case 'getdoc': {
        const pkg = this.collab.exportDoc(m.docId); if (pkg) this._send({ t: 'doc', to: m.from.id, ...pkg }); break;
      }
      case 'doc': this.collab.joinFromPeer(m); this._emit(); break;
      case 'photo': {
        if (!this.collab.docs.has(m.docId) || this.engine.media.has(m.rec.id)) break;
        await this.db.put('blobs', { id: m.rec.id, blob: m.blob });
        const rec = { ...m.rec, subId: m.docId, relayed: true, relayedFrom: m.from.name, state: 'queued', attempts: 0, nextAttemptAt: 0, errorCode: null };
        await this.db.put('media', rec); this.engine.registerMedia(rec); this.engine.kick();
        this.received++; this._emit(); break;
      }
    }
  }
  _emit() { this.dispatchEvent(new Event('change')); }
}
