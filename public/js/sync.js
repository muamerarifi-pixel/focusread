// Cross-device sync with a secret code. End-to-end encrypted:
//  - the code never leaves the device; the server only gets sid = SHA-256("focusread-sid-v1|" + code)
//  - every document, position and stat is encrypted with AES-GCM using a key derived (PBKDF2) from the code.
// Model: each doc's metadata is one item "d:<id>" (last-writer-wins, reading position merged by posAt),
// full texts are immutable blobs uploaded once, reading stats are one item per device "s:<deviceId>".
import * as DB from './db.js';
import * as ST from './stats.js';

const LS = 'focusread_sync_v1';
const TOMBS = 'focusread_tombs_v1';
const API = '/api/sync';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const CODE_LEN = 16;
const PART = 2_500_000;

let st = { code: '', since: 0, device: '', lastSync: 0, known: {}, statsSig: '' };
try { st = { ...st, ...(JSON.parse(localStorage.getItem(LS)) || {}) }; } catch {}
if (!st.device) st.device = rand(10);
let tombs = {};
try { tombs = JSON.parse(localStorage.getItem(TOMBS)) || {}; } catch {}
const save = () => { try { localStorage.setItem(LS, JSON.stringify(st)); } catch {} };
const saveTombs = () => { try { localStorage.setItem(TOMBS, JSON.stringify(tombs)); } catch {} };
save();

let keys = null; // { sid, key }
let running = null, again = false, timer = null, retries = 0;
const listeners = new Set();
let status = { state: st.code ? 'idle' : 'off', error: '', lastSync: st.lastSync };
function setStatus(s) { status = { ...status, ...s }; listeners.forEach(fn => { try { fn(status); } catch {} }); }
export const onStatus = fn => { listeners.add(fn); fn(status); return () => listeners.delete(fn); };
let changeHandler = () => {};
export const onRemoteChange = fn => { changeHandler = fn; };
export const getStatus = () => status;
export const isOn = () => !!st.code;
export const getCode = () => st.code;

/* ---------- codes ---------- */
function rand(n) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(b, x => ALPHABET[x % ALPHABET.length]).join('');
}
export function generateCode() {
  // rejection sampling for a uniform alphabet
  let out = '';
  while (out.length < CODE_LEN) {
    for (const x of crypto.getRandomValues(new Uint8Array(32))) {
      if (x < 248 && out.length < CODE_LEN) out += ALPHABET[x % 31];
    }
  }
  return out;
}
export function normalizeCode(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
export function isValidCode(c) { return c.length === CODE_LEN && [...c].every(ch => ALPHABET.includes(ch)); }
export const formatCode = c => (c || '').match(/.{1,4}/g)?.join('-') || '';
export const shareLink = () => `${location.origin}/#sync=${formatCode(st.code)}`;

/* ---------- crypto ---------- */
const te = new TextEncoder(), td = new TextDecoder();
const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function deriveKeys(code) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode('focusread-sid-v1|' + code)));
  const sid = Array.from(h, x => x.toString(16).padStart(2, '0')).join('');
  const base = await crypto.subtle.importKey('raw', te.encode(code), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: te.encode('focusread-e2e-v1'), iterations: 210000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { sid, key };
}
async function gzip(bytes, dir) {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([bytes]).stream().pipeThrough(dir === 'c' ? new CompressionStream('gzip') : new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function encBytes(bytes) {
  let flag = 0, body = bytes;
  if (bytes.length > 512) { const z = await gzip(bytes, 'c'); if (z && z.length < bytes.length) { flag = 1; body = z; } }
  const plain = new Uint8Array(body.length + 1); plain[0] = flag; plain.set(body, 1);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, keys.key, plain));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return b64(out);
}
async function decBytes(s) {
  const raw = unb64(s);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, keys.key, raw.subarray(12)));
  const body = plain.subarray(1);
  if (plain[0] === 1) { const z = await gzip(body, 'd'); if (!z) throw new Error('gzip unsupported'); return z; }
  return body;
}
const encJSON = async o => encBytes(te.encode(JSON.stringify(o)));
const decJSON = async s => JSON.parse(td.decode(await decBytes(s)));

/* ---------- API ---------- */
async function api(op, payload = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, sid: keys.sid, ...payload }), signal: ctrl.signal, cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'http ' + r.status), { code: j.error || 'http', status: r.status });
    return j;
  } finally { clearTimeout(to); }
}
export async function serverAvailable() {
  try { const r = await fetch(API, { cache: 'no-store' }); if (!r.ok) return false; const j = await r.json(); return !!j.configured; } catch { return false; }
}

/* ---------- local change tracking (called by the app) ---------- */
export function noteDelete(id) { tombs[id] = Date.now(); saveTombs(); schedule(); }
export function undoDelete(id) { delete tombs[id]; saveTombs(); schedule(); }
export function schedule(delay = 4000) {
  if (!st.code) return;
  clearTimeout(timer);
  timer = setTimeout(() => syncNow(), delay);
}

/* ---------- connect / disconnect ---------- */
export async function connect(code, { fresh = false } = {}) {
  code = normalizeCode(code);
  if (!isValidCode(code)) throw Object.assign(new Error('invalid code'), { code: 'invalid' });
  keys = await deriveKeys(code);
  // probe server + see whether the space already has data
  const probe = await api('pull', { since: 0 });
  st = { ...st, code, since: 0, known: {}, statsSig: '', lastSync: 0 };
  save();
  setStatus({ state: 'idle', error: '' });
  await syncNow();
  return { existing: !fresh && probe.items.length > 0, count: probe.items.filter(i => i.f.startsWith('d:')).length };
}
export function disconnect() {
  clearTimeout(timer);
  st = { ...st, code: '', since: 0, known: {}, statsSig: '', lastSync: 0 };
  keys = null; save();
  setStatus({ state: 'off', error: '', lastSync: 0 });
}

/* ---------- the sync cycle ---------- */
function sig(m) { return m.deleted ? 'x' + m.updatedAt : `${m.updatedAt || 0}|${m.posAt || 0}`; }
// Saved sentences (notes) from both sides are kept: one list per id, the newer copy of each note wins,
// and a note deleted on one device (tombstone in marksDel) stays deleted unless it was put back or edited later.
const DEL_KEEP = 180 * 864e5;
function mergeMarks(l, r, rNewer) {
  const del = {};
  for (const src of [l.marksDel, r.marksDel]) for (const [k, t] of Object.entries(src || {})) if (t > (del[k] || 0)) del[k] = t;
  const stamp = x => x.u || x.at || 0;
  const by = new Map();
  for (const x of (rNewer ? l : r).marks || []) if (x && x.id) by.set(x.id, x);
  for (const x of (rNewer ? r : l).marks || []) { if (!x || !x.id) continue; const o = by.get(x.id); if (!o || stamp(x) >= stamp(o)) by.set(x.id, x); }
  const marks = [...by.values()].filter(x => !(del[x.id] > stamp(x))).sort((a, b) => (a.o - b.o) || (stamp(a) - stamp(b)));
  const old = Date.now() - DEL_KEEP;
  for (const k of Object.keys(del)) if (del[k] < old) delete del[k];
  return { marks, del };
}
const marksKey = m => JSON.stringify((m.marks || []).map(x => [x.id, x.u || x.at || 0, x.note || '']));
function merge(l, r) {
  const newer = (r.updatedAt || 0) > (l.updatedAt || 0);
  const m = newer ? { ...l, ...r } : { ...r, ...l };
  // the reading place: ribbon (spot), position and "finished" all come from whichever side moved last
  const posSrc = (r.posAt || 0) > (l.posAt || 0) ? r : l;
  m.pos = posSrc.pos || 0; m.finished = !!posSrc.finished; m.posAt = posSrc.posAt || 0;
  if (posSrc.spot != null) m.spot = posSrc.spot; else delete m.spot;
  m.updatedAt = Math.max(l.updatedAt || 0, r.updatedAt || 0);
  m.parts = r.parts || l.parts;
  if ((l.marks && l.marks.length) || (r.marks && r.marks.length) || l.marksDel || r.marksDel) {
    const { marks, del } = mergeMarks(l, r, newer);
    m.marks = marks;
    if (Object.keys(del).length) m.marksDel = del; else delete m.marksDel;
    // notes the other side doesn't have yet: make this copy newer, so it is sent back and both sides end up equal
    if (marksKey(m) !== marksKey(r)) m.updatedAt = Math.max(m.updatedAt, Date.now());
  }
  return m;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function uploadText(meta) {
  const text = await DB.getText(meta.id);
  const enc = await encBytes(te.encode(text));
  const n = Math.max(1, Math.ceil(enc.length / PART));
  for (let i = 0; i < n; i++) await api('putText', { id: meta.id, part: i, data: enc.slice(i * PART, (i + 1) * PART) });
  return n;
}
async function downloadText(meta) {
  let s = '';
  for (let i = 0; i < (meta.parts || 1); i++) s += (await api('getText', { id: meta.id, part: i })).data;
  return td.decode(await decBytes(s));
}

export async function syncNow() {
  if (!st.code) return;
  if (running) { again = true; return running; }
  running = (async () => {
    if (!navigator.onLine) { setStatus({ state: 'offline' }); return; }
    setStatus({ state: 'syncing', error: '' });
    try {
      if (!keys) keys = await deriveKeys(st.code);
      let changed = false;
      // 1) PULL
      const pulled = await api('pull', { since: st.since });
      const local = new Map((await DB.listDocs()).map(d => [d.id, d]));
      for (const it of pulled.items) {
        let obj;
        try { obj = await decJSON(it.d); } catch { continue; } // not ours / corrupt
        if (it.f.startsWith('s:')) { const dev = it.f.slice(2); if (dev !== st.device) { ST.setRemote(dev, obj.days); changed = true; } continue; }
        const r = obj; const id = it.f.slice(2);
        if (!r || r.id !== id) continue;
        const l = local.get(id);
        if (r.deleted) {
          st.known[id] = sig(r);
          if (l && (l.updatedAt || 0) <= r.updatedAt) { await DB.deleteDoc(id); local.delete(id); changed = true; }
          tombs[id] = Math.max(tombs[id] || 0, r.updatedAt);
          continue;
        }
        if (!l) {
          if ((tombs[id] || 0) >= (r.updatedAt || 0)) continue; // our delete is newer — pushed below
          const dup = [...local.values()].find(x => x.hash && x.hash === r.hash);
          let text;
          if (dup) {
            text = await DB.getText(dup.id);
            Object.assign(r, merge(dup, r), { id, title: r.title });
            await DB.deleteDoc(dup.id); local.delete(dup.id);
            tombs[dup.id] = Date.now();
          } else text = await downloadText(r);
          await DB.putText(id, text);
          await DB.putMeta(r);
          local.set(id, r);
          st.known[id] = sig(r);
          changed = true;
          try { changeHandler(); } catch {} // show each arriving book right away
        } else {
          const m = merge(l, r);
          if (!same(m, l)) { await DB.putMeta(m); local.set(id, m); changed = true; }
          st.known[id] = sig(r);
        }
      }
      saveTombs();
      if (changed) changeHandler();

      // 2) PUSH local changes
      const items = [];
      for (const m of local.values()) {
        if (!m.updatedAt) m.updatedAt = m.createdAt || Date.now();
        if (st.known[m.id] === sig(m)) continue;
        if (!st.known[m.id]) { m.parts = await uploadText(m); await DB.putMeta(m); }
        items.push({ f: 'd:' + m.id, u: Math.max(m.updatedAt || 0, m.posAt || 0), d: await encJSON(m), _sig: sig(m), _id: m.id });
      }
      for (const [id, t] of Object.entries(tombs)) {
        if (local.has(id)) { if ((local.get(id).updatedAt || 0) > t) delete tombs[id]; continue; }
        const tomb = { id, deleted: true, updatedAt: t };
        if (st.known[id] === sig(tomb)) continue;
        items.push({ f: 'd:' + id, u: t, d: await encJSON(tomb), _sig: sig(tomb), _id: id, _del: true });
      }
      const own = ST.ownDays();
      const statsSig = JSON.stringify(own);
      if (statsSig !== st.statsSig) items.push({ f: 's:' + st.device, u: Date.now(), d: await encJSON({ days: own }), _stats: statsSig });
      for (let i = 0; i < items.length; i += 50) {
        const batch = items.slice(i, i + 50);
        await api('push', { items: batch.map(({ f, u, d }) => ({ f, u, d })) });
        for (const it of batch) {
          if (it._stats) st.statsSig = it._stats;
          else st.known[it._id] = it._sig;
          if (it._del) api('delText', { id: it._id }).catch(() => {});
        }
      }
      saveTombs();
      st.since = Math.max(0, pulled.now - 5000);
      st.lastSync = Date.now();
      save();
      retries = 0; setStatus({ state: 'ok', error: '', lastSync: st.lastSync });
    } catch (e) {
      console.warn('sync failed', e);
      setStatus({ state: 'error', error: e.code || e.message || String(e) });
      // a slow or dropped request: try again soon (5 s, 15 s, 45 s) instead of waiting for the next minute
      if (retries < 3 && e.code !== 'invalid' && e.code !== 'not_configured') { const d = 5000 * 3 ** retries++; setTimeout(() => { if (st.code) syncNow(); }, d); }
    }
  })();
  try { await running; } finally {
    running = null;
    if (again) { again = false; schedule(1500); }
  }
}

/* ---------- automatic triggers ---------- */
let lastAuto = 0;
function auto() {
  if (!st.code || document.hidden) return;
  if (Date.now() - lastAuto < 8000) return;
  lastAuto = Date.now();
  syncNow();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) auto(); else if (st.code) syncNow(); });
window.addEventListener('online', auto);
window.addEventListener('focus', auto);
setInterval(auto, 60000);
export function start() { if (st.code) { setStatus({ state: 'idle' }); syncNow(); } }
