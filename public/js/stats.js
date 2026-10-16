// Reading statistics stored in localStorage: { days: { 'YYYY-MM-DD': { w: words, ms: activeMs } } }
const KEY = 'focusread_stats_v1';
let data = { days: {} };
try { data = JSON.parse(localStorage.getItem(KEY)) || data; if (!data.days) data.days = {}; } catch {}

// Stats synced from other devices: { deviceId: { days } } — combined (summed) for display.
const RKEY = 'focusread_stats_remote_v1';
let remote = {};
try { remote = JSON.parse(localStorage.getItem(RKEY)) || {}; } catch {}
export function setRemote(dev, days) {
  if (!days || typeof days !== 'object') return;
  remote[dev] = days;
  try { localStorage.setItem(RKEY, JSON.stringify(remote)); } catch {}
}
function day(k) {
  const own = data.days[k] || { w: 0, ms: 0 };
  let w = own.w, ms = own.ms;
  for (const r of Object.values(remote)) { const x = r[k]; if (x) { w += x.w || 0; ms += x.ms || 0; } }
  return { w, ms };
}
function allKeys() {
  const ks = new Set(Object.keys(data.days));
  for (const r of Object.values(remote)) Object.keys(r).forEach(k => ks.add(k));
  return ks;
}

export const dayKey = (d = new Date()) => {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
};
function persist() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {} }

let pending = 0;
export function addReading(words, ms) {
  if (words <= 0 && ms <= 0) return;
  const k = dayKey();
  const d = data.days[k] || (data.days[k] = { w: 0, ms: 0 });
  d.w += words; d.ms += ms;
  if (++pending >= 25) flush();
}
export function flush() { pending = 0; persist(); }

export function today() { return day(dayKey()); }
export function streak() {
  let n = 0; const d = new Date();
  if (!(day(dayKey(d)).w > 0)) d.setDate(d.getDate() - 1); // today not yet counted is fine
  while (day(dayKey(d)).w > 0) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
export function lastDays(n = 7) {
  const out = []; const d = new Date();
  d.setDate(d.getDate() - (n - 1));
  for (let i = 0; i < n; i++) { const k = dayKey(d); out.push({ key: k, date: new Date(d), ...day(k) }); d.setDate(d.getDate() + 1); }
  return out;
}
export function totals() {
  let w = 0, ms = 0;
  for (const k of allKeys()) { const v = day(k); w += v.w; ms += v.ms; }
  return { w, ms, wpm: ms > 60000 ? Math.round(w / (ms / 60000)) : 0 };
}
export function exportData() { return data; }
/** Own (this device's) days only — what gets synced. */
export function ownDays() { return data.days; }
export function importData(d) {
  if (!d || !d.days) return;
  for (const [k, v] of Object.entries(d.days)) {
    const cur = data.days[k];
    if (!cur || (v.w || 0) > cur.w) data.days[k] = { w: v.w || 0, ms: v.ms || 0 };
  }
  persist();
}
