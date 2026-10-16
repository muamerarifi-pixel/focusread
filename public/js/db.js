// Tiny IndexedDB wrapper. Stores: meta (doc metadata), texts (full text by id).
// Falls back to in-memory maps if IndexedDB is unavailable (e.g. some private modes).
const DB_NAME = 'focusread';
const DB_VER = 1;
let dbp = null;
const mem = { meta: new Map(), texts: new Map() };

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VER); } catch { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('texts')) db.createObjectStore('texts');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbp;
}

async function run(store, mode, fn) {
  const db = await open();
  if (!db) return { mem: true };
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve({ value: r ? r.result : undefined });
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export async function listDocs() {
  const r = await run('meta', 'readonly', s => s.getAll());
  const list = r.mem ? [...mem.meta.values()] : (r.value || []);
  return list.sort((a, b) => (b.openedAt || b.createdAt) - (a.openedAt || a.createdAt));
}
export async function getMeta(id) {
  const r = await run('meta', 'readonly', s => s.get(id));
  return r.mem ? mem.meta.get(id) : r.value;
}
export async function putMeta(meta) {
  const r = await run('meta', 'readwrite', s => s.put(meta));
  if (r.mem) mem.meta.set(meta.id, meta);
}
export async function getText(id) {
  const r = await run('texts', 'readonly', s => s.get(id));
  return (r.mem ? mem.texts.get(id) : r.value) || '';
}
export async function putText(id, text) {
  const r = await run('texts', 'readwrite', s => s.put(text, id));
  if (r.mem) mem.texts.set(id, text);
}
export async function deleteDoc(id) {
  const r = await run('meta', 'readwrite', s => s.delete(id));
  if (r.mem) { mem.meta.delete(id); mem.texts.delete(id); return; }
  await run('texts', 'readwrite', s => s.delete(id));
}
export async function ensurePersistence() {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch {}
}
