// Local, inspectable storage. Everything the outbox needs to survive a crash/restart lives here.
//   submissions  – drafts + queued records (status, answers, schemaVersion, error)
//   media        – one row per photo (state machine + retry bookkeeping + thumbnail)
//   blobs        – the compressed photo bytes (deleted once the server has confirmed them)
//   log          – sync log (also exportable)

const STORES = {
  submissions: { keyPath: 'id' },
  media: { keyPath: 'id', indexes: [['bySub', 'subId']] },
  blobs: { keyPath: 'id' },
  log: { keyPath: 'seq', autoIncrement: true },
  shared: { keyPath: 'id' },      // team records: CRDT state + queued local ops
  issues: { keyPath: 'id' },      // problem reports waiting to reach the dev team
};

const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export function openDB(name = 'fieldcollect') {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [n, o] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(n)) continue;
        const s = db.createObjectStore(n, { keyPath: o.keyPath, autoIncrement: !!o.autoIncrement });
        (o.indexes || []).forEach(([i, k]) => s.createIndex(i, k));
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const store = (n, mode = 'readonly') => db.transaction(n, mode).objectStore(n);
      resolve({
        put: (n, v) => wrap(store(n, 'readwrite').put(v)),
        get: (n, k) => wrap(store(n).get(k)),
        getAll: (n) => wrap(store(n).getAll()),
        del: (n, k) => wrap(store(n, 'readwrite').delete(k)),
        byIndex: (n, i, k) => wrap(store(n).index(i).getAll(k)),
        clear: (n) => wrap(store(n, 'readwrite').clear()),
      });
    };
  });
}

/** Same interface, in memory — used by the engine tests. */
export function memoryDB() {
  const data = Object.fromEntries(Object.keys(STORES).map((n) => [n, new Map()]));
  let seq = 0;
  const clone = (v) => (v && typeof v === 'object' && !(v instanceof Blob) ? structuredClone(v) : v);
  return {
    put: async (n, v) => { if (STORES[n].autoIncrement && v.seq == null) v = { ...v, seq: ++seq }; data[n].set(v[STORES[n].keyPath], clone(v)); },
    get: async (n, k) => clone(data[n].get(k)),
    getAll: async (n) => [...data[n].values()].map(clone),
    del: async (n, k) => { data[n].delete(k); },
    byIndex: async (n, i, k) => [...data[n].values()].filter((v) => v.subId === k).map(clone),
    clear: async (n) => data[n].clear(),
  };
}
