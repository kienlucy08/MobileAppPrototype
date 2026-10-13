// The surveys on this phone. A person's Survey123 often holds a dozen-plus surveys, so the library keeps every
// survey the user has access to (downloaded from the server whenever there is signal), groups them by scope of
// work, and works with no signal at all.

const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const PALETTE = ['#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0e7490', '#2563eb', '#be185d', '#4d7c0f', '#7c3aed', '#b45309'];

export class Library extends EventTarget {
  constructor({ storageKey }) {
    super(); this.storageKey = storageKey;
    try { this.map = new Map(Object.entries(JSON.parse(localStorage.getItem(storageKey)) || {})); } catch { this.map = new Map(); }
  }
  get all() { return [...this.map.values()].sort((a, b) => (a.scope || '~').localeCompare(b.scope || '~') || a.title.localeCompare(b.title)); }
  get(id) { return this.map.get(id); }
  /** Add / update surveys (newer version, or same version with different content such as a changed scope). */
  merge(list) {
    let changed = false;
    for (const s of list || []) {
      const cur = this.map.get(s.id);
      if (!cur || s.version > cur.version || (s.version === cur.version && JSON.stringify(s) !== JSON.stringify(cur))) { if (!cur || s.version >= cur.version) { this.map.set(s.id, s); changed = true; } }
    }
    if (changed) { try { localStorage.setItem(this.storageKey, JSON.stringify(Object.fromEntries(this.map))); } catch { /* quota */ } this.dispatchEvent(new Event('change')); }
    return changed;
  }
  scopes() {
    const m = new Map();
    for (const s of this.map.values()) { const k = s.scope || 'Other'; m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  }
  filter({ scope = '', q = '' } = {}) {
    const needle = q.trim().toLowerCase();
    return this.all.filter((s) => (!scope || (s.scope || 'Other') === scope) && (!needle || s.title.toLowerCase().includes(needle) || (s.scope || '').toLowerCase().includes(needle)));
  }
}

/** Tile look: colour block + short label (like the Survey123 gallery). */
export const tileOf = (s) => ({
  color: s.tile?.color || PALETTE[hash(s.id) % PALETTE.length],
  text: s.tile?.text || String(s.title).replace(/^(CONS-MOD|FS)\s+/i, '').toUpperCase().slice(0, 22),
});
