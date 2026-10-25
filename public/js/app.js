import { t, setLang, getLang, translateDOM, SAMPLE } from './i18n.js';
import * as TX from './text.js';
import * as DB from './db.js';
import { importFile, ACCEPT } from './importers.js';
import * as ST from './stats.js';
import * as Sync from './sync.js';
import { ct } from './comfort.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* ================= Settings ================= */
const SKEY = 'focusread_settings_v6';
const DRAFT_KEY = 'focusread_draft_v6';
const V5_KEY = 'focusread_v5_better';
const DEFAULTS = {
  wpm: 300, fontSize: 64, pageSize: 20, chunk: 1, mode: 'rsvp',
  theme: 'auto', font: 'hyper', spacing: 'normal', focusColor: 'red',
  smart: true, ramp: true, rewind: true, splitLong: true,
  orp: true, bionic: false, ghost: true, trail: true, guide: true,
  breakMin: 20, goalMin: 15, lang: 'sq',
  resume: true, blink: true, nightWarm: true,
  tts: false, ttsVoice: '', chapStop: false, clean: false,
  ink: 'auto', inkAlpha: 100, spread: 'auto',
};
let S = { ...DEFAULTS };
let firstRun = false;
let v5Text = '';
(function loadSettings() {
  try {
    const raw = localStorage.getItem(SKEY);
    if (raw) { S = { ...DEFAULTS, ...JSON.parse(raw) }; return; }
    firstRun = true;
    const v5 = JSON.parse(localStorage.getItem(V5_KEY) || 'null');
    if (v5) {
      const map = { sans: 'sans', serif: 'serif', dys: 'dys' };
      Object.assign(S, {
        wpm: v5.wpm || 300, fontSize: v5.fontSize || 64, chunk: v5.chunk || 1,
        theme: v5.theme || 'auto', font: map[v5.font] || 'hyper', spacing: v5.spacing || 'normal',
        smart: v5.smart !== false, ghost: v5.ghost !== false, bionic: !!v5.bionic, trail: v5.trail !== false, ramp: v5.ramp !== false,
      });
      v5Text = v5.text || '';
    }
  } catch {}
})();
function saveSettings() { try { localStorage.setItem(SKEY, JSON.stringify(S)); } catch {} }

// Reading-text colours (the theme's own ink is 'auto'). Alpha comes from S.inkAlpha.
const INKS = { auto: null, cream: '#efe4cc', amber: '#e9b872', rose: '#eaa7b2', sage: '#a9c99b', sky: '#9cc3f0', lilac: '#c4b3f2', gray: '#a3a3aa', sepia: '#5b4636', navy: '#24365c' };
const THEME_COLORS = { light: '#fbfaf8', paper: '#fdfdfb', sepia: '#f5eedf', dark: '#0e0e10', oled: '#000000', night: '#150f0a' };
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
// Evening screens: warm, dim colours after 21:00 when the theme is automatic
// (bright, blue-rich screens before bed delay melatonin — Chang et al., PNAS 2015).
const isNightHour = () => { const h = new Date().getHours(); return h >= 21 || h < 6; };
const resolvedTheme = () => (S.theme === 'auto' ? (S.nightWarm && isNightHour() ? 'night' : darkMQ.matches ? 'dark' : 'light') : S.theme);
setInterval(() => { if (S.theme === 'auto' && document.documentElement.dataset.theme !== resolvedTheme()) applySettings(); }, 60000);

function applySettings() {
  const h = document.documentElement;
  const th = resolvedTheme();
  h.dataset.theme = th;
  h.dataset.font = S.font;
  h.dataset.spacing = S.spacing;
  h.dataset.focus = S.focusColor;
  h.dataset.ghost = S.ghost ? 'on' : 'off';
  h.dataset.trail = S.trail ? 'on' : 'off';
  h.dataset.guide = S.guide ? 'on' : 'off';
  h.style.setProperty('--word-size', S.fontSize + 'px');
  h.style.setProperty('--page-size', S.pageSize + 'px');
  const ink = INKS[S.ink] || 'var(--fg)', ia = Math.max(30, Math.min(100, Number(S.inkAlpha) || 100));
  h.style.setProperty('--read-ink', ia >= 100 ? ink : `color-mix(in srgb, ${ink} ${ia}%, transparent)`);
  h.dataset.ink = S.ink in INKS ? S.ink : 'auto';
  $('meta[name="theme-color"]').setAttribute('content', THEME_COLORS[th] || '#fbfaf8');
  $('meta[name="apple-mobile-web-app-status-bar-style"]').setAttribute('content', ['dark', 'oled', 'night'].includes(th) ? 'black' : 'default');
  if (getLang() !== S.lang) { setLang(S.lang); translateDOM(); renderLibrary(); renderStats(); updateComposerMeta(); if (typeof syncDialog !== 'undefined' && syncDialog.open) renderSyncDialog(); if (typeof updateSyncBadge === 'function') updateSyncBadge(Sync.getStatus()); }
  $('#langBtn').textContent = S.lang === 'sq' ? 'EN' : 'SQ';
  syncSettingsUI();
  $('#quickWpm').textContent = S.wpm;
  $('#wpmBadge').textContent = S.wpm;
  const sn = $('#speedNote'); if (sn) sn.hidden = S.wpm <= 450;
}

function syncSettingsUI() {
  $$('[data-set]').forEach(el => {
    const k = el.dataset.set;
    if (el.type === 'checkbox') el.checked = !!S[k];
    else el.value = String(S[k]);
  });
  $('#wpmRange').value = S.wpm; $('#wpmOut').textContent = S.wpm;
  $('#sizeRange').value = S.fontSize; $('#sizeOut').textContent = S.fontSize;
  $('#pageSizeRange').value = S.pageSize; $('#pageSizeOut').textContent = S.pageSize;
  $$('#wpmPresets button').forEach(b => b.classList.toggle('on', Number(b.dataset.wpm) === S.wpm));
  $$('#chunkSeg button').forEach(b => b.classList.toggle('on', Number(b.dataset.chunk) === S.chunk));
  $$('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === S.mode));
  $$('#focusSwatches button').forEach(b => b.classList.toggle('on', b.dataset.color === S.focusColor));
  $$('#inkSwatches button').forEach(b => b.classList.toggle('on', b.dataset.ink === (S.ink in INKS ? S.ink : 'auto')));
  $('#inkAlphaRange').value = S.inkAlpha; $('#inkAlphaOut').textContent = S.inkAlpha + '%';
  $$('#themeGrid button').forEach(b => b.classList.toggle('on', b.dataset.themeOpt === S.theme));
  $$('select[data-set="breakMin"] option').forEach(o => { if (o.value !== '0') o.textContent = t('set.everyMin', { n: o.value }); });
  $('#modeBtn use').setAttribute('href', S.mode === 'rsvp' ? '#i-page' : S.mode === 'pacer' ? '#i-book' : '#i-words');
}

function setSetting(key, value) {
  if (S[key] === value) return;
  S[key] = value;
  saveSettings();
  applySettings();
  if (key === 'tts') updateTtsUI();
  if (key === 'wpm') { updateComposerMeta(); if (R.T) renderProgress(); }
  if (!R.T) return;
  if (key === 'tts' || key === 'ttsVoice') { if (R.playing) { clearTimeout(R.timer); ttsStop(); schedule(); } return; }
  if (key === 'ink' || key === 'inkAlpha') return;
  if (['chunk', 'splitLong', 'mode', 'clean'].includes(key)) rebuild(key === 'mode' && R.doc && R.doc.spot != null ? R.doc.spot : undefined); // a new mode opens at the ribbon
  else render();
}

/* ================= Helpers ================= */
const nf = () => new Intl.NumberFormat(getLang() === 'sq' ? 'sq-AL' : 'en-US');
const fmtNum = n => nf().format(Math.round(n));
function fmtTime(min) {
  if (!isFinite(min) || min <= 0) return t('time.s', { n: 0 });
  if (min < 1) return t('time.s', { n: Math.max(1, Math.round(min * 60)) });
  if (min < 60) return t('time.m', { n: Math.round(min) });
  return t('time.h', { h: Math.floor(min / 60), m: Math.round(min % 60) });
}
function fmtClock(ms) {
  const s = Math.round(ms / 1000); const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
}
function relDay(ts) {
  if (!ts) return '';
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const diff = Math.floor((d0 - new Date(ts).setHours(0, 0, 0, 0)) / 864e5);
  if (diff <= 0) return t('date.today');
  if (diff === 1) return t('date.yesterday');
  return t('date.daysAgo', { n: diff });
}
function hash(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36) + ':' + str.length; }
/** Persist doc metadata with sync timestamps. pos=true marks a reading-position change. */
async function saveMeta(meta, { pos = false } = {}) {
  const now = Date.now();
  if (pos) meta.posAt = now; else meta.updatedAt = now;
  await DB.putMeta(meta);
  Sync.schedule();
}
const debounce = (fn, ms) => { let id; return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); }; };

/* ================= Toasts & HUD ================= */
function toast(msg, { action, onAction, actions, duration = 4200, sticky = false } = {}) {
  const el = document.createElement('div');
  el.className = 'toast'; el.setAttribute('role', 'status');
  const span = document.createElement('span'); span.textContent = msg; el.appendChild(span);
  let timer;
  const close = () => { clearTimeout(timer); el.classList.add('out'); setTimeout(() => el.remove(), 220); };
  const btns = actions || (action ? [{ label: action, fn: onAction }] : []);
  for (const a of btns) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = a.label;
    b.onclick = () => { close(); a.fn && a.fn(); };
    el.appendChild(b);
  }
  $('#toasts').appendChild(el);
  if (!sticky) timer = setTimeout(close, duration);
  while ($('#toasts').children.length > 3) $('#toasts').firstElementChild.remove();
  return { update: m => { span.textContent = m; }, close };
}
let hudTimer;
function hud(msg) {
  const el = $('#hud'); el.textContent = msg; el.classList.add('show');
  clearTimeout(hudTimer); hudTimer = setTimeout(() => el.classList.remove('show'), 900);
}

/* ================= Home: composer, stats, library ================= */
const textInput = $('#textInput');
function updateComposerMeta() {
  const n = TX.countWords(textInput.value);
  $('#wordCount').textContent = t('composer.meta', { n: fmtNum(n), t: fmtTime(TX.estimateMinutes(n, S)) });
}
const saveDraft = debounce(() => { try { localStorage.setItem(DRAFT_KEY, textInput.value); } catch {} }, 400);
textInput.addEventListener('input', debounce(updateComposerMeta, 120));
textInput.addEventListener('input', saveDraft);
textInput.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); readComposer(); } });

$('#clearBtn').addEventListener('click', () => { textInput.value = ''; updateComposerMeta(); saveDraft(); textInput.focus(); });
$('#pasteBtn').addEventListener('click', async () => {
  try {
    const txt = await navigator.clipboard.readText();
    if (txt) { textInput.value = txt; updateComposerMeta(); saveDraft(); }
  } catch { toast(t('toast.pasteFail')); textInput.focus(); }
});
const fileInput = $('#fileInput');
// On phones a list of types makes the system picker grey out EPUBs and PDFs that were saved with a
// generic type (very common on Android and in the iOS Files app). There we show every file and check
// the type after you pick; on computers the filter stays, so the dialog only lists readable files.
const phone = /android|iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (!phone) fileInput.accept = ACCEPT;
$('#fileBtn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { handleFiles([...fileInput.files]); fileInput.value = ''; });
$('#startBtn').addEventListener('click', readComposer);
$$('.quick-speed [data-speed]').forEach(b => b.addEventListener('click', () => setSetting('wpm', clampWpm(S.wpm + Number(b.dataset.speed)))));

// Drag & drop anywhere on the home screen
const dropZone = $('#dropZone');
let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', e => { if (!hasFiles(e) || R.T) return; dragDepth++; dropZone.classList.add('drag'); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dropZone.classList.remove('drag'); } });
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', e => {
  dragDepth = 0; dropZone.classList.remove('drag');
  if (!e.dataTransfer) return;
  if (e.dataTransfer.files?.length) { e.preventDefault(); handleFiles([...e.dataTransfer.files]); }
  else if (e.target !== textInput) {
    const txt = e.dataTransfer.getData('text/plain');
    if (txt) { e.preventDefault(); textInput.value = txt; updateComposerMeta(); saveDraft(); }
  }
});

async function handleFiles(files) {
  for (const f of files) {
    const tt = toast(t('toast.importing') + ' ' + f.name, { sticky: true });
    try {
      const r = await importFile(f, (a, b) => tt.update(t('toast.pdfPage', { a, b })));
      tt.close();
      const meta = await addDoc({ title: r.title, text: r.text, kind: r.kind, author: r.author });
      toast(t('toast.imported', { t: meta.title }), { action: t('lib.read'), onAction: () => openReader(meta.id), duration: 6000 });
      renderLibrary();
    } catch (e) {
      tt.close();
      if (e.code === 'backup') await restoreBackup(e.data);
      else if (e.code === 'unsupported') toast(t('toast.unsupported') + ' (' + f.name + ')');
      else if (e.code === 'notext') toast(t('toast.noText'));
      else { console.error(e); toast(t('toast.importFail', { e: e.message || e })); }
    }
  }
  renderLibrary();
}

async function addDoc({ title, text, kind = 'text', author = '' }) {
  const h = hash(text);
  const existing = (await DB.listDocs()).find(d => d.hash === h);
  if (existing) { if (existing.archived) { existing.archived = false; await saveMeta(existing); } return existing; }
  const meta = {
    id: DB.uid(), title: (title || TX.guessTitle(text, t('untitled'))).trim(), author, kind,
    words: TX.countWords(text), pos: 0, finished: false, createdAt: Date.now(), updatedAt: Date.now(), posAt: 0, openedAt: 0, hash: h,
  };
  await DB.putText(meta.id, text);
  await DB.putMeta(meta);
  Sync.schedule(1500);
  return meta;
}

async function readComposer() {
  const text = TX.normalize(textInput.value);
  if (!text) { toast(t('toast.empty')); textInput.focus(); return; }
  const meta = await addDoc({ text, kind: 'text' });
  openReader(meta.id);
}

function renderStats() {
  const td = ST.today();
  const goalMs = S.goalMin * 60000;
  const pct = Math.min(1, td.ms / goalMs);
  const C = 2 * Math.PI * 20, min = Math.floor(td.ms / 60000);
  const el = $('#goalRing'); if (!el) return;
  const lbl = `${t('stats.goal')}: ${min} / ${S.goalMin} ${t('stats.min')}`;
  el.title = lbl; el.setAttribute('aria-label', lbl);
  el.classList.toggle('done', pct >= 1);
  el.innerHTML = `<svg viewBox="0 0 46 46"><circle cx="23" cy="23" r="20" class="track"/><circle cx="23" cy="23" r="20" class="arc" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg><b>${pct >= 1 ? '✓' : min}</b>`;
  if (!el._on) { el._on = 1; el.addEventListener('click', () => toast(el.title)); }
}

let libDocs = [];
async function renderLibrary() {
  libDocs = await DB.listDocs();
  renderNotesHome();
  const q = ($('#libSearch').value || '').trim().toLowerCase();
  const hit = d => (d.title + ' ' + (d.author || '')).toLowerCase().includes(q);
  // archived books stay on the phone (and in sync) with everything; they wait in the Archive below the library
  const active = libDocs.filter(d => !d.archived), archived = libDocs.filter(d => d.archived);
  const list = q ? active.filter(hit) : active, arch = q ? archived.filter(hit) : archived;
  const box = $('#libList');
  if (!libDocs.length) { box.innerHTML = `<div class="lib-empty">${t('lib.empty')}</div>`; return; }
  const openArch = libArchOpen || (q && arch.length > 0);
  const archHtml = archived.length
    ? `<button type="button" class="lib-arch-toggle${openArch ? ' open' : ''}" data-arch-toggle aria-expanded="${openArch}"><svg class="ic"><use href="#i-archive"/></svg><span>${t('lib.archiveTitle')}</span><b>${q ? arch.length + ' / ' : ''}${archived.length}</b><svg class="ic chev"><use href="#i-right"/></svg></button>` +
      (openArch ? `<p class="lib-arch-note">${t('lib.archiveNote')}</p>` + arch.map(d => docCard(d, true)).join('') : '')
    : '';
  box.innerHTML = (list.length ? list.map(d => docCard(d, false)).join('') : (active.length || !archived.length ? `<div class="lib-empty">${t(active.length ? 'lib.noMatch' : 'lib.empty')}</div>` : '')) + archHtml;
}
let libArchOpen = false;
function docCard(d, inArch) {
  {
    const pct = d.finished ? 100 : d.words ? Math.min(100, Math.round((d.pos / d.words) * 100)) : 0;
    const left = TX.estimateMinutes(Math.max(0, d.words - d.pos), S);
    const started = d.pos > 0 && !d.finished;
    const kind = (d.kind || 'text').toUpperCase();
    const ttl = String(d.title || '').trim();
    let hue = 0; for (const ch of ttl) hue = (hue * 31 + ch.codePointAt(0)) % 360;
    const ini = ([...ttl.replace(/^[^\p{L}\p{N}]+/u, '')][0] || '·').toUpperCase();
    return `<article class="doc${inArch ? ' is-arch' : ''}" data-id="${d.id}" style="--h:${hue}">
      <div class="doc-cover" data-act="open" aria-hidden="true"><span>${TX.esc(ini)}</span><i style="height:${pct}%"></i></div>
      <div class="doc-title" data-act="open" title="${TX.esc(d.title)}">${TX.esc(d.title)}</div>
      <div class="doc-meta">
        ${d.finished || !d.openedAt ? `<span class="tag ${d.finished ? 'done' : ''}">${d.finished ? t('lib.finished') : t('lib.new')}</span>` : ''}
        ${d.author ? `<span>${TX.esc(d.author)}</span>` : ''}
        ${!d.finished ? `<span>${t('lib.left', { t: fmtTime(left) })}</span>` : ''}
      </div>
      <div class="doc-bar"><i style="width:${pct}%"></i></div>
      <div class="doc-actions">
        <button class="btn small ${started ? 'primary ' + (() => { const a = Date.now() - (d.openedAt || 0); return a < 864e5 ? 'rc-today' : a < 3 * 864e5 ? 'rc-recent' : a < 14 * 864e5 ? 'rc-week' : 'rc-old'; })() : ''}" data-act="open" type="button"><svg class="ic"><use href="#i-play"/></svg>${started ? t('lib.continue') + ' · ' + pct + '%' : t('lib.read')}</button>
        ${d.pos > 0 || d.finished ? `<button class="btn ghost small icon-only" data-act="restart" type="button" title="${t('lib.again')}" aria-label="${t('lib.again')}"><svg class="ic"><use href="#i-restart"/></svg></button>` : ''}
        <span class="grow"></span>
        <button class="btn ghost small icon-only" data-act="rename" type="button" title="${t('lib.rename')}" aria-label="${t('lib.rename')}"><svg class="ic"><use href="#i-edit"/></svg></button>
        ${inArch
          ? `<button class="btn ghost small icon-only" data-act="unarchive" type="button" title="${t('lib.unarchive')}" aria-label="${t('lib.unarchive')}"><svg class="ic"><use href="#i-unarchive"/></svg></button>
        <button class="btn ghost small icon-only danger" data-act="delete" type="button" title="${t('lib.deleteForever')}" aria-label="${t('lib.deleteForever')}"><svg class="ic"><use href="#i-trash"/></svg></button>`
          : `<button class="btn ghost small icon-only" data-act="archive" type="button" title="${t('lib.archive')}" aria-label="${t('lib.archive')}"><svg class="ic"><use href="#i-archive"/></svg></button>`}
      </div>
    </article>`;
  }
}
$('#libSearch').addEventListener('input', debounce(renderLibrary, 120));
$('#libList').addEventListener('click', async e => {
  if (e.target.closest('[data-arch-toggle]')) { libArchOpen = !libArchOpen; renderLibrary(); return; }
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  const id = btn.closest('.doc').dataset.id;
  const meta = libDocs.find(d => d.id === id); if (!meta) return;
  const act = btn.dataset.act;
  if (meta.archived && (act === 'open' || act === 'restart')) { meta.archived = false; await saveMeta(meta); }
  if (act === 'open') openReader(id);
  else if (act === 'archive' || act === 'unarchive') {
    const on = act === 'archive';
    meta.archived = on; // kept as false (not removed) so the newer copy wins in sync
    await saveMeta(meta);
    renderLibrary();
    toast(t(on ? 'toast.archived' : 'toast.unarchived', { t: meta.title }), { action: t('toast.undo'), duration: 6000, onAction: async () => { meta.archived = !on; await saveMeta(meta); renderLibrary(); } });
  }
  else if (act === 'restart') { meta.pos = 0; meta.finished = false; await saveMeta(meta, { pos: true }); openReader(id); }
  else if (act === 'rename') {
    const name = prompt(t('lib.renamePrompt'), meta.title);
    if (name && name.trim()) { meta.title = name.trim().slice(0, 140); await saveMeta(meta); renderLibrary(); }
  } else if (act === 'delete') {
    if (!confirm(t('lib.confirmDelete', { t: meta.title }))) return;
    const text = await DB.getText(id);
    await DB.deleteDoc(id);
    Sync.noteDelete(id);
    renderLibrary();
    toast(t('toast.deleted', { t: meta.title }), { action: t('toast.undo'), duration: 7000, onAction: async () => { Sync.undoDelete(id); await DB.putText(id, text); await saveMeta(meta); renderLibrary(); } });
  }
});

/* Backup */
$('#backupBtn').addEventListener('click', async () => {
  const docs = await DB.listDocs();
  const full = [];
  for (const d of docs) full.push({ ...d, text: await DB.getText(d.id) });
  const data = { app: 'focusread', version: 6, exportedAt: new Date().toISOString(), settings: S, stats: ST.exportData(), docs: full };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `focusread-backup-${ST.dayKey()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(t('toast.backup'));
});
$('#restoreBtn').addEventListener('click', () => $('#restoreInput').click());
$('#restoreInput').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try { await restoreBackup(JSON.parse(await f.text())); } catch (err) { toast(t('toast.importFail', { e: err.message })); }
});
async function restoreBackup(data) {
  if (!data || data.app !== 'focusread' || !Array.isArray(data.docs)) throw new Error('not a FocusRead backup');
  let n = 0;
  for (const d of data.docs) {
    if (!d.id || typeof d.text !== 'string') continue;
    const { text, ...meta } = d;
    const cur = await DB.getMeta(meta.id);
    if (!cur || (meta.openedAt || 0) >= (cur.openedAt || 0)) { await DB.putText(meta.id, text); await DB.putMeta(meta); n++; }
  }
  if (data.stats) ST.importData(data.stats);
  Sync.schedule(1500);
  toast(t('toast.restored', { n }));
  renderLibrary(); renderStats();
}

/* ================= Reader ================= */
const R = {
  doc: null, text: '', T: null, starts: null, ci: 0, pages: null, pageIdx: -1, pageEls: null, lastLineTop: -1,
  playing: false, timer: null, rampStep: 0, lastTick: 0, pausedAt: 0, started: false,
  sessionWords: 0, sessionMs: 0, sinceBreakMs: 0, lastSave: 0, wake: null,
};
const els = {
  reader: $('#readerView'), rsvp: $('#rsvp'), pacer: $('#pacer'), book: $('#book'), bookSheet: $('#bookSheet'), bookView: $('#bookView'), bookCols: $('#bookCols'), page: $('#pacerPage'), row: $('#wordRow'),
  left: $('#wLeft'), pivot: $('#wPivot'), right: $('#wRight'), gPrev: $('#ghostPrev'), gNext: $('#ghostNext'),
  trail: $('#sentenceTrail'), fill: $('#progressFill'), thumb: $('#progressThumb'), track: $('#progressTrack'),
  pText: $('#progressText'), pPct: $('#progressPercent'), pLeft: $('#timeRemain'), play: $('#playBtn'),
};

function curTok() { return R.starts[R.ci]; }
function curOrig() { return R.T.orig[curTok()] ?? 0; }

function rebuild(origPos) {
  const keep = origPos ?? (R.T ? curOrig() : 0);
  R.T = TX.tokenize(R.text, { split: S.splitLong && S.mode === 'rsvp', clean: S.clean });
  buildOutline();
  buildMarks();
  R.starts = TX.buildChunks(R.T, S.chunk);
  R.ci = TX.chunkOfToken(R.starts, TX.tokenOfOrig(R.T, keep));
  R.pages = S.mode === 'pacer' ? buildPages(R.T) : null;
  R.pageIdx = -1; R.lastLineTop = -1;
  R.book = S.mode === 'book' ? { secs: buildBookSections(R.T), sec: -1, page: 0, starts: [0], key: '', turnAt: performance.now() } : null;
  els.rsvp.hidden = S.mode !== 'rsvp';
  els.pacer.hidden = S.mode !== 'pacer';
  els.book.hidden = S.mode !== 'book';
  els.reader.classList.toggle('book-mode', S.mode === 'book');
  if (picking) endPick();
  if (S.mode !== 'book') { els.bookCols.innerHTML = ''; els.reader.classList.remove('spread'); if (rot.on || rot.locked) unlockRotation(); }
  render();
}

async function openReader(id, { resume = false } = {}) {
  const meta = await DB.getMeta(id);
  if (!meta) return;
  const text = await DB.getText(id);
  if (!text.trim()) return;
  if (R.T) closeReader({ silent: true });
  R.doc = meta; R.text = text; R.T = null;
  R.started = false; R.sessionWords = 0; R.sessionMs = 0; R.sinceBreakMs = 0; R.pausedAt = 0;
  meta.openedAt = Date.now();
  R.spotAt = performance.now();
  if (meta.finished) { meta.pos = 0; meta.finished = false; meta.posAt = Date.now(); }
  saveMeta(meta);
  { const full = String(meta.title || ''), cut = full.split(/\s*[:|—–]\s+/)[0]; const short = full.length > 42 && cut.length >= 8 ? cut : full; $('#readerTitle').textContent = short; $('#readerTitle').title = full; } // v7.8: short title, full one on hover
  els.reader.hidden = false;
  document.body.classList.add('reading');
  els.reader.classList.remove('playing');
  $('#tapHint').hidden = false;
  closeSheet();
  if (!history.state || !history.state.reader) history.pushState({ reader: id }, '', '#read');
  R.docLang = '';
  rebuild(meta.spot ?? meta.pos ?? 0);
  offerStart(meta);
  // Coming back to a text: start from the beginning of the sentence you were in,
  // so you re-enter with context instead of mid-thought.
  // Only in words mode: on a page (book, guided) you come back to the very page you left.
  if (meta.pos > 0 && R.T && S.mode === 'rsvp') {
    const tk = curTok();
    R.ci = TX.chunkOfToken(R.starts, Math.max(TX.sentenceStart(R.T, tk), tk - 25));
    render();
  }
  // Back where you left: the ribbon on that page and a short glow over the sentence.
  if (S.mode !== 'rsvp' && R.T) {
    if (meta.spot == null && meta.pos > 0) meta.spot = meta.pos;
    decorateSpot();
    setTimeout(() => { const tk = spotTok(); if (tk != null && R.T) flashPick(sentenceRange(tk)[0]); }, 450);
  }
  if (resume) { $('#tapHint').textContent = ct('resumeHint'); return; }
  $('#tapHint').textContent = t('reader.tapHint');
  if (S.mode === 'book') { bookHint(); return; }
  setTimeout(() => { if (R.T && !R.playing && !R.started) play(); }, 700);
}

function closeReader({ silent = false, fromPop = false } = {}) {
  if (picking) endPick();
  if (rot.on || rot.locked) unlockRotation();
  if ($('#tocDialog').open) $('#tocDialog').close();
  if ($('#noteDialog').open) $('#noteDialog').close();
  ttsStop();
  if (!R.T) return;
  pause();
  savePos(true);
  ST.flush();
  els.reader.hidden = true;
  document.body.classList.remove('reading');
  $('#breakOverlay').hidden = true; $('#finishOverlay').hidden = true;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  R.T = null; R.doc = null; R.text = '';
  els.page.innerHTML = ''; els.bookCols.innerHTML = ''; R.book = null; endFlip();
  if (!fromPop && history.state && history.state.reader) history.back();
  if (!silent) { renderLibrary(); renderStats(); }
}
window.addEventListener('popstate', () => { if (R.T && !(history.state && history.state.reader)) closeReader({ fromPop: true }); });

function savePos(force) {
  if (!R.doc || !R.T) return;
  const now = Date.now();
  if (!force && now - R.lastSave < 4000) return;
  R.lastSave = now;
  // Book mode: your place is the ribbon, set by a tap on a sentence — flipping pages does not move it.
  // Words and guided page: the ribbon follows you while you read (playing, or just paused) — not when you only look around.
  if (S.mode !== 'book' && (R.playing || (R.pausedAt && performance.now() - R.pausedAt < 2000))) R.doc.spot = R.T.orig[sentenceRange(curTok())[0]] ?? 0;
  const p = S.mode === 'book' ? (R.doc.spot ?? R.doc.pos ?? 0) : (R.doc.spot ?? curOrig());
  if (p === R.doc.pos && !force) return;
  if (p !== R.doc.pos) { R.doc.pos = p; R.doc.posAt = now; }
  DB.putMeta(R.doc);
  Sync.schedule(force ? 1500 : 20000);
}

/* ---------- Rendering ---------- */
function render() {
  if (!R.T || !R.T.tok.length) return;
  if (S.mode === 'book') renderBook(); else if (S.mode === 'pacer') renderPacer(); else renderRSVP();
  updateChapter();
  updateChapterLeft();
  updateBmUI();
  decorateSpot();
  renderProgress();
  sizeLimits();
}

function renderRSVP() {
  const T = R.T, s = R.starts[R.ci], e = R.starts[R.ci + 1];
  const single = e - s === 1;
  const hl = (T.flags[s] & TX.F_HEAD) ? (T.hlv[s] || 1) : 0;
  els.row.classList.toggle('heading', hl > 0);
  els.row.classList.toggle('hd1', hl === 1);
  els.row.classList.toggle('marked', !!(R.markSet && R.markSet[T.orig[s]]));
  els.row.classList.toggle('orp', S.orp && single && !hl);
  els.row.classList.toggle('bionic', S.bionic);
  if (single && !hl) {
    const p = TX.wordParts(T.tok[s], { orp: S.orp, bionic: S.bionic });
    els.left.innerHTML = p.left; els.pivot.innerHTML = p.pivot; els.right.innerHTML = p.right;
  } else {
    els.left.innerHTML = ''; els.right.innerHTML = '';
    let html = '';
    for (let i = s; i < e; i++) html += (i > s ? ' ' : '') + TX.wordHTML(T.tok[i], S.bionic);
    els.pivot.innerHTML = html;
  }
  if (S.ghost) {
    els.gPrev.textContent = joinTokens(T, Math.max(0, s - 4), s);
    els.gNext.textContent = joinTokens(T, e, Math.min(T.tok.length, e + 4));
  } else { els.gPrev.textContent = ''; els.gNext.textContent = ''; }
  fitWord();
  if (S.trail) renderTrail(s, e); else els.trail.innerHTML = '';
}

function joinTokens(T, a, b) {
  let out = '';
  for (let i = a; i < b; i++) {
    const w = T.tok[i];
    if (i > a && T.orig[i] === T.orig[i - 1]) out = out.replace(/-$/, '') + w; // re-join split parts
    else out += (i > a ? ' ' : '') + w;
  }
  return out;
}

function fitWord() {
  const row = els.row;
  row.style.fontSize = '';
  const avail = row.clientWidth - 24;
  if (avail <= 0) return;
  const pw = els.pivot.offsetWidth;
  let need;
  if (els.left.textContent || els.right.textContent) need = 2 * Math.max(els.left.offsetWidth, els.right.offsetWidth) + pw;
  else need = pw;
  if (need > avail) row.style.fontSize = Math.max(18, Math.floor(S.fontSize * (avail / need))) + 'px';
}

function renderTrail(s, e) {
  const T = R.T, n = T.tok.length;
  let a = TX.sentenceStart(T, s);
  let b = s;
  while (b < n - 1 && !(T.flags[b] & TX.F_SENT)) b++;
  let pre = '', post = '';
  if (s - a > 16) { a = s - 12; pre = '… '; }
  if (b - e > 22) { b = e + 18; post = ' …'; }
  const oa = T.orig[a], ob = T.orig[b], cs = T.orig[s], ce = T.orig[e - 1];
  let html = pre;
  for (let o = oa; o <= ob; o++) {
    const w = TX.esc(T.words[o]);
    if (o >= cs && o <= ce) html += (o === cs ? '<mark>' : '') + w + (o === ce ? '</mark> ' : ' ');
    else html += (o < cs ? `<span class="read">${w}</span>` : w) + ' ';
  }
  els.trail.innerHTML = html + post;
}

/** <p> for a paragraph starting at token i: list item, separator, section break, or plain. */
function paraOpen(T, i) {
  const f = T.flags[i];
  let c = f & TX.F_LI ? 'li' : f & TX.F_LIN ? 'li ol' : f & TX.F_SEP ? 'sep' : '';
  if (c && i > 0 && !(T.flags[i - 1] & TX.F_PARA)) c += ' cont'; // the rest of an item that began on the page before
  if (f & TX.F_BRK) c += (c ? ' ' : '') + 'brk';
  return c ? `<p class="${c}">` : '<p>';
}
function buildPages(T) {
  const pages = [0];
  let count = 0;
  for (let i = 0; i < T.tok.length; i++) {
    count++;
    const f = T.flags[i];
    if ((f & TX.F_PARA && count >= 260) || (f & TX.F_SENT && count >= 700) || (f & TX.F_PARA && count >= 40 && T.hlv[i + 1] === 1 && !(f & TX.F_HEAD))) { pages.push(i + 1); count = 0; }
  }
  if (pages[pages.length - 1] !== T.tok.length) pages.push(T.tok.length);
  return pages;
}

function renderPacer() {
  const T = R.T, s = R.starts[R.ci], e = R.starts[R.ci + 1];
  let pi = 0;
  while (pi < R.pages.length - 2 && R.pages[pi + 1] <= s) pi++;
  if (pi !== R.pageIdx) {
    R.pageIdx = pi;
    const ps = R.pages[pi], pe = R.pages[pi + 1];
    let html = '', tag = 'p';
    const open = i => {
      const lv = (T.flags[i] & TX.F_HEAD) ? (T.hlv[i] || 1) : 0;
      tag = lv ? 'h' + (lv + 1) : 'p';
      return lv ? `<${tag} class="ph ph${lv}">` : paraOpen(T, i);
    };
    html += open(ps);
    for (let i = ps; i < pe; i++) {
      html += `<w data-i="${i}"${R.markSet && R.markSet[T.orig[i]] ? ' data-m' : ''}>${TX.wordHTML(T.tok[i], S.bionic)}</w>`;
      if (T.flags[i] & TX.F_PARA) { html += `</${tag}>`; if (i < pe - 1) html += open(i + 1); }
      else html += ' ';
    }
    if (!(T.flags[pe - 1] & TX.F_PARA)) html += `</${tag}>`;
    els.page.innerHTML = html;
    els.page.classList.toggle('bionic', S.bionic);
    R.pageEls = [...els.page.querySelectorAll('w')];
    R.lastLineTop = -1;
    els.pacer.scrollTop = 0;
  }
  const ps = R.pages[pi];
  let cur = null;
  R.pageEls.forEach((el, k) => {
    const i = ps + k;
    const cls = i < s ? 'r' : i < e ? 'c' : '';
    if (el.className !== cls) el.className = cls;
    if (i === s) cur = el;
  });
  if (cur) {
    const top = cur.offsetTop;
    if (top !== R.lastLineTop) {
      R.lastLineTop = top;
      const target = top - els.pacer.clientHeight * 0.33;
      els.pacer.scrollTo({ top: Math.max(0, target), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  }
}

/* ---------- Book mode: real pages, no highlight, turned by hand ---------- */
// The text is split into sections (chapters, or ~1500 words), each laid out with
// CSS columns exactly one page wide, so a "page" is one column. Turning a page
// slides the column strip and flips a snapshot of the old page like a paper leaf.
function buildBookSections(T) {
  const secs = [0];
  let count = 0;
  for (let i = 0; i < T.tok.length; i++) {
    count++;
    const f = T.flags[i];
    if ((f & TX.F_PARA && count >= 1500) || (f & TX.F_PARA && count >= 40 && T.hlv[i + 1] === 1 && !(f & TX.F_HEAD))) { secs.push(i + 1); count = 0; }
  }
  if (secs[secs.length - 1] !== T.tok.length) secs.push(T.tok.length);
  return secs;
}
const bookSecOf = tok => { const S2 = R.book.secs; let k = 0; while (k < S2.length - 2 && S2[k + 1] <= tok) k++; return k; };
function bookLayout(sec) {
  const T = R.T, B = R.book, ps = B.secs[sec], pe = B.secs[sec + 1];
  let html = '', tag = 'p';
  const open = i => {
    const lv = (T.flags[i] & TX.F_HEAD) ? (T.hlv[i] || 1) : 0;
    tag = lv ? 'h' + (lv + 1) : 'p';
    return lv ? `<${tag} class="ph ph${lv}">` : paraOpen(T, i);
  };
  html += open(ps);
  for (let i = ps; i < pe; i++) {
    html += `<w data-i="${i}"${R.markSet && R.markSet[T.orig[i]] ? ' data-m' : ''}>${TX.wordHTML(T.tok[i], S.bionic)}</w>`;
    if (T.flags[i] & TX.F_PARA) { html += `</${tag}>`; if (i < pe - 1) html += open(i + 1); }
    else html += ' ';
  }
  if (!(T.flags[pe - 1] & TX.F_PARA)) html += `</${tag}>`;
  const cols = els.bookCols, view = els.bookView;
  // The running title wraps to show in full; reserve the height of the tallest title in this
  // chapter before measuring, so the page height never changes between turns.
  const runEl = $('#bookRun'), runs = [];
  const h0 = headAt(ps); runs.push(h0 >= 0 ? T.heads[h0].title : (R.doc?.title || ''));
  for (const h of T.heads || []) if (h.t > ps && h.t < pe) runs.push(h.title);
  runEl.style.minHeight = ''; let runH = 0;
  for (const r of runs) { runEl.textContent = r; runH = Math.max(runH, runEl.offsetHeight); }
  runEl.style.minHeight = runH + 'px';
  // Two pages side by side (a spread) when the screen is wide: each page is one column,
  // and one "turn" moves the strip by two columns.
  const spread = !!B.spread;
  const W = view.clientWidth, H = view.clientHeight, G = spread ? 76 : 48;
  const colW = spread ? Math.floor((W - G) / 2) : W;
  cols.style.transition = 'none';
  cols.style.transform = 'translateX(0)';
  cols.style.height = H + 'px';
  cols.style.columnWidth = colW + 'px';
  cols.style.columnGap = G + 'px';
  cols.classList.toggle('bionic', S.bionic);
  cols.innerHTML = html;
  const colStride = colW + G, per = spread ? 2 : 1, starts = [];
  let lastCol = 0;
  cols.querySelectorAll('w').forEach(el => {
    const c = Math.floor((el.offsetLeft + 4) / colStride);
    if (c > lastCol) lastCol = c;
    const p = Math.floor(c / per);
    if (starts[p] === undefined) starts[p] = Number(el.dataset.i);
  });
  // a page that holds only the tail of a hyphenated word has no start of its own
  for (let p = 1; p < starts.length; p++) if (starts[p] === undefined) starts[p] = starts[p - 1];
  B.sec = sec; B.starts = starts.length ? starts : [ps]; B.stride = colStride * per; B.cols = lastCol + 1;
}
/** Show two pages side by side? Automatic on wide screens; the rotate button can force it. */
function isSpread() {
  if (S.mode !== 'book') return false;
  const w = els.book.clientWidth, h = els.book.clientHeight;
  if (S.spread === 'one') return false;
  if (S.spread === 'two') return w >= 520;
  return w >= 740 && w > h * 1.12;
}

/* ---- Rotate: real screen lock where the device allows it, otherwise the reader is turned on screen ---- */
const rot = { on: false, locked: '' };
const coarse = matchMedia('(pointer: coarse)');
function setViewportVars() {
  const h = document.documentElement; h.style.setProperty('--vw', innerWidth + 'px'); h.style.setProperty('--vh', innerHeight + 'px');
  // little height to spare (a phone on its side, or the reader turned on screen): slimmer bars, more page
  const ownH = rot.on ? innerWidth : innerHeight, ownW = rot.on ? innerHeight : innerWidth;
  els.reader.classList.toggle('short', ownH < 560 && ownW > ownH);
}
setViewportVars();
window.addEventListener('resize', setViewportVars);
function setRot(on) {
  if (rot.on === on) return;
  rot.on = on;
  els.reader.classList.toggle('rot90', on);
  setViewportVars();
  $('#rotBtn').classList.toggle('on', on || !!rot.locked);
  if (R.T && S.mode === 'book' && R.book) { endFlip(); R.book.key = ''; requestAnimationFrame(render); }
}
async function unlockRotation() {
  setRot(false);
  if (rot.locked) {
    rot.locked = '';
    try { screen.orientation && screen.orientation.unlock && screen.orientation.unlock(); } catch {}
    if (rot.enteredFs && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    rot.enteredFs = false;
  }
  $('#rotBtn').classList.remove('on');
}
async function tryLock(kind) {
  const so = screen.orientation;
  if (!so || !so.lock) return false;
  try {
    await so.lock(kind);
    rot.locked = kind;
    $('#rotBtn').classList.add('on');
    return true;
  } catch { if (rot.enteredFs && document.fullscreenElement) { document.exitFullscreen?.().catch(() => {}); rot.enteredFs = false; } return false; }
}
async function rotateView() {
  if (!R.T) return;
  if (!coarse.matches) {
    // mouse & keyboard screens can't be turned: switch between one and two pages instead
    const two = !isSpread();
    setSetting('spread', two ? 'two' : 'one');
    hud(t(two ? 'view.two' : 'view.one'));
    return;
  }
  if (rot.on || rot.locked) { await unlockRotation(); hud(t(innerWidth > innerHeight ? 'rot.land' : 'rot.port')); return; }
  const portrait = innerHeight >= innerWidth;
  const want = portrait ? 'landscape' : 'portrait';
  if (await tryLock(want)) { hud(t(portrait ? 'rot.land' : 'rot.port')); return; }
  setRot(true);
  hud(t(portrait ? 'rot.land' : 'rot.port'));
}
$('#rotBtn').addEventListener('click', e => { e.currentTarget.blur(); rotateView(); });
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && rot.locked) { rot.locked = ''; rot.enteredFs = false; $('#rotBtn').classList.toggle('on', rot.on); } });

function renderBook() {
  const B = R.book;
  if (!B) return;
  const view = els.bookView;
  const spread = isSpread();
  if (spread !== !!B.spread || els.reader.classList.contains('spread') !== spread) { B.spread = spread; els.reader.classList.toggle('spread', spread); }
  const key = [S.pageSize, S.font, S.spacing, S.bionic, spread, view.clientWidth, view.clientHeight].join('|');
  // a page turn names its exact target word: a "chunk" of words (a heading, or 2–3 words) can start on the page before
  const go = B.go; B.go = null;
  const s = go ? go.tok : R.starts[R.ci];
  const sec = bookSecOf(s);
  if (sec !== B.sec || key !== B.key) {
    bookLayout(sec);
    // laying out can change the page's own height (the running title): remember the size it was laid out at
    B.key = [S.pageSize, S.font, S.spacing, S.bionic, spread, view.clientWidth, view.clientHeight].join('|');
  }
  let p = 0;
  if (B.wantLast) { p = B.starts.length - 1; B.wantLast = false; }
  else while (p < B.starts.length - 1 && B.starts[p + 1] <= s) p++;
  // never stuck: a turn within the same chapter always moves at least one page
  if (go && !go.last && go.sec === B.sec) {
    if (go.dir > 0 && p <= go.from && go.from < B.starts.length - 1) p = go.from + 1;
    else if (go.dir < 0 && p >= go.from && go.from > 0) p = go.from - 1;
  }
  B.page = p;
  els.bookCols.style.transform = `translateX(${-p * B.stride}px)`;
  // the position you are "at" is the top of the page you are looking at
  R.ci = TX.chunkOfToken(R.starts, B.starts[p]);
  const hi = R.T.heads?.length ? headAt(B.starts[p]) : -1;
  const run = hi >= 0 ? R.T.heads[hi].title : (R.doc?.title || '');
  const runEl = $('#bookRun'); if (runEl.textContent !== run) runEl.textContent = run;
  const pno = $('#bookPno'), foot = $('#bookFoot');
  if (B.spread) {
    // page numbers count single pages; the last spread may have only a left page
    const a = 2 * p + 1, total = Math.max(a, B.cols || 0), b = Math.min(a + 1, total);
    const f = `<span>${a}</span><span>${b > a ? b : ''}</span>`;
    if (foot.innerHTML !== f) foot.innerHTML = f;
    pno.textContent = b > a ? `${a}–${b} / ${total}` : `${a} / ${total}`;
    pno.title = t('book.pages', { a, b: total });
  } else {
    foot.textContent = p + 1;
    pno.textContent = `${p + 1} / ${B.starts.length}`;
    pno.title = t('book.pages', { a: p + 1, b: B.starts.length });
  }
}

let flip = null;
/** Settle any page that is still turning (instantly), keeping the result. */
function endFlip() {
  if (!flip) return;
  const f = flip; flip = null;
  f.anims.forEach(a => { try { a.cancel(); } catch {} });
  f.nodes.forEach(n => n.remove());
  if (!f.done) (f.target === false ? f.onCancel : f.onCommit)();
}
function leafOf(sheet) {
  const leaf = sheet.cloneNode(true);
  leaf.removeAttribute('id');
  leaf.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
  leaf.classList.add('leaf');
  Object.assign(leaf.style, { left: sheet.offsetLeft + 'px', top: sheet.offsetTop + 'px', width: sheet.offsetWidth + 'px', height: sheet.offsetHeight + 'px' });
  const shade = document.createElement('i'); shade.className = 'leaf-shade'; leaf.appendChild(shade);
  const gloss = document.createElement('i'); gloss.className = 'leaf-gloss'; leaf.appendChild(gloss);
  return leaf;
}
/** Where a turn in `dir` would land, or null if there is no page there. */
function turnTarget(dir) {
  const B = R.book;
  const atLast = B.page >= B.starts.length - 1, lastSec = B.sec >= B.secs.length - 2;
  if (dir > 0) return atLast ? (lastSec ? null : { tok: B.secs[B.sec + 1] }) : { tok: B.starts[B.page + 1] };
  if (B.page > 0) return { tok: B.starts[B.page - 1] };
  return B.sec > 0 ? { tok: B.secs[B.sec - 1], last: true } : null;
}
// Visual state of a turn at progress f (0 = old page flat, 1 = new page flat).
// Only transform and opacity change, so the browser animates it on the GPU.
const easeTurn = 'cubic-bezier(.32,.08,.24,1)';
function turnFrame(dir, f, w = 600) {
  const k = dir > 0 ? f : 1 - f;                  // how far the moving leaf has lifted
  const ang = -92 * k, lift = Math.sin(Math.PI * k);
  const edge = w * Math.cos(ang * Math.PI / 180);  // where the leaf's free edge is over the page below
  return {
    leaf: { transform: `rotateY(${ang.toFixed(2)}deg) translateZ(${(lift * 18).toFixed(2)}px)` },
    shade: { opacity: (0.55 * k).toFixed(3) },
    gloss: { opacity: (0.9 * lift).toFixed(3) },
    // the shadow the lifted leaf casts, right beside its edge, strongest mid-turn
    cast: { opacity: (0.85 * lift).toFixed(3), transform: `translateX(${edge.toFixed(1)}px)` },
  };
}
// Two-page spread: the turning page swings around the spine. Its front (old page) lifts
// for the first half; the back (the new page landing on the other side) comes down in the second.
function spreadFrame(dir, f) {
  const s = dir > 0 ? -1 : 1, lift = Math.sin(Math.PI * f);
  const z = (lift * 22).toFixed(2);
  return {
    front: { transform: `rotateY(${(s * 180 * f).toFixed(2)}deg) translateZ(${z}px)` },
    fshade: { opacity: (0.6 * Math.min(1, f * 2)).toFixed(3) },
    fgloss: { opacity: (0.8 * lift).toFixed(3) },
    back: { transform: `rotateY(${(-s * 180 * (1 - f)).toFixed(2)}deg) translateZ(${z}px)` },
    bshade: { opacity: (0.6 * Math.min(1, (1 - f) * 2)).toFixed(3) },
    cast: { opacity: (0.45 * Math.min(1, f * 2.2) * (f < 0.5 ? 1 : 2 * (1 - f))).toFixed(3) },
  };
}
const frameOf = (st, f) => (st.spread ? spreadFrame(st.dir, f) : turnFrame(st.dir, f, st.w));
/** Prepare a turn: snapshot the page(s), move the reader to the target, build the leaf. */
function beginTurn(dir) {
  const B = R.book;
  endFlip();
  const tg = turnTarget(dir);
  if (!tg) return null;
  const sheet = els.bookSheet, stage = els.book;
  const old = { ci: R.ci, fromTok: B.starts[B.page] };
  const before = leafOf(sheet);
  const spread = !!B.spread;
  const still = spread ? leafOf(sheet) : null;
  if (tg.last) B.wantLast = true;
  B.go = { tok: tg.tok, dir, from: B.page, sec: B.sec, last: !!tg.last };
  R.ci = TX.chunkOfToken(R.starts, tg.tok);
  R.pausedAt = 0;
  render();
  const st = { dir, f: 0, anims: [], nodes: [], done: false, spread: spread && !!B.spread, w: sheet.offsetWidth || 600 };
  const cast = document.createElement('i'); cast.className = 'cast-shade';
  if (st.spread) {
    // front = the old page that turns; still = the old page on the other side, which stays
    // until the back of the leaf (the new page) lands on it.
    const turnSide = dir > 0 ? 'r' : 'l', landSide = dir > 0 ? 'l' : 'r';
    const back = leafOf(sheet);
    before.classList.add('half', 'half-' + turnSide);
    still.classList.add('half', 'half-' + landSide, 'still');
    back.classList.add('half', 'half-' + landSide);
    still.appendChild(cast);
    stage.appendChild(still); stage.appendChild(before); stage.appendChild(back);
    st.nodes.push(still, before, back);
    st.parts = {
      front: before, fshade: before.querySelector('.leaf-shade'), fgloss: before.querySelector('.leaf-gloss'),
      back, bshade: back.querySelector('.leaf-shade'), cast,
    };
    [before, back].forEach(n => n.classList.add('turning'));
  } else {
    if (dir > 0) {
      stage.appendChild(before); sheet.appendChild(cast);
      st.leaf = before; st.nodes.push(before, cast);
    } else {
      const after = leafOf(sheet);
      before.classList.add('under'); before.appendChild(cast);
      stage.appendChild(before); stage.appendChild(after);
      st.leaf = after; st.nodes.push(before, after);
    }
    st.parts = { leaf: st.leaf, shade: st.leaf.querySelector('.leaf-shade'), gloss: st.leaf.querySelector('.leaf-gloss'), cast };
    st.leaf.classList.add('turning');
  }
  st.onCommit = () => { const t = performance.now(); B.flips = t - (B.turnAt || 0) < 4000 ? (B.flips || 1) + 1 : 1; B.turnAt = t; requestAnimationFrame(() => { decorateSpot(); setTimeout(savePos, 80); }); }; // browsing pages: only a tap on a sentence counts as read
  st.onCancel = () => { B.wantLast = false; R.ci = old.ci; render(); };
  setTurn(st, 0);
  flip = st;
  return st;
}
function setTurn(st, f) {
  st.f = f;
  const v = frameOf(st, f);
  for (const k in st.parts) Object.assign(st.parts[k].style, v[k]);
}
/** Animate a prepared turn from where it is to fully turned (commit) or back (cancel). */
function settleTurn(st, commit, ms) {
  const to = commit ? 1 : 0, from = st.f;
  st.target = commit;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const steps = 28, frames = {};
  for (const k in st.parts) frames[k] = [];
  for (let i = 0; i <= steps; i++) {
    const v = frameOf(st, from + (to - from) * (i / steps));
    for (const k in frames) frames[k].push(v[k]);
  }
  const dur = reduce ? 1 : Math.max(160, (st.spread ? ms * 1.15 : ms) * Math.abs(to - from));
  const opt = { duration: dur, easing: commit && from === 0 ? easeTurn : 'cubic-bezier(.2,.7,.25,1)', fill: 'forwards' };
  st.anims = Object.keys(frames).map(k => st.parts[k].animate(frames[k], opt));
  st.anims[0].finished.then(() => {
    if (flip !== st) return;
    flip = null;
    st.done = true;
    st.nodes.forEach(n => n.remove());
    commit ? st.onCommit() : st.onCancel();
  }, () => {});
}
/** Turn one page forward (dir 1) or back (dir -1) with a paper-leaf animation. */
function turnPage(dir) {
  const B = R.book;
  if (!R.T || !B || B.sec < 0) return;
  endFlip();
  if (!turnTarget(dir)) {
    if (dir > 0) { spotCount(R.doc.spot ?? R.doc.pos ?? 0, R.T.origCount); finish(); }
    return;
  }
  const st = beginTurn(dir);
  if (st) settleTurn(st, true, 760);
}
/** Reading stats for a page you just finished (time is capped so an idle page isn't counted as reading). */
function bookCount(fromTok, nextTok) {
  const B = R.book, T = R.T, now = performance.now();
  const from = T.orig[fromTok] ?? 0, to = nextTok < T.tok.length ? T.orig[nextTok] : T.origCount;
  const words = Math.max(0, to - from);
  const dt = Math.min(now - B.turnAt, Math.max(4000, words * 600));
  B.turnAt = now;
  if (!words || dt < 800 || words / (dt / 60000) > 1200) return; // flicking through, not reading
  R.started = true;
  R.sessionWords += words; R.sessionMs += dt; R.sinceBreakMs += dt;
  ST.addReading(words, dt);
}
let bookHinted = false;
function bookHint() {
  if (bookHinted) return; bookHinted = true; setTimeout(() => hud(t('book.hint')), 400);
  let seen = ''; try { seen = localStorage.getItem('focusread_pick_tip') || ''; } catch {}
  if (!seen) { try { localStorage.setItem('focusread_pick_tip', '1'); } catch {} setTimeout(() => toast('★ ' + t('pick.long'), { duration: 7000 }), 1600); }
}
// (v7.6: taps no longer turn pages — swipe does; a tap saves the ribbon)
// swipe left/right; scroll wheel or trackpad also turn pages.
let bookGest = null;
const LONG_MS = 480;
/** Pointer position in the reader's own frame (differs from the screen when the reader is turned sideways). */
function ptr(e) { return rot.on ? { x: e.clientY, y: innerWidth - e.clientX } : { x: e.clientX, y: e.clientY }; }
function sheetBox() { const r = els.bookSheet.getBoundingClientRect(); return rot.on ? { left: r.top, width: r.height } : { left: r.left, width: r.width }; }
els.book.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const q = ptr(e);
  const g = bookGest = { x: q.x, y: q.y, id: e.pointerId, st: null, lastX: q.x, lastT: performance.now(), v: 0, lp: 0, lpDone: false };
  const tok = wordTok(e.target);
  if (picking) { if (tok != null) showPick(tok); return; }
  // Press and hold a sentence: saved at once, without the star.
  if (tok != null) g.lp = setTimeout(() => { if (bookGest !== g || g.st) return; g.lpDone = true; flashPick(tok); markSentenceAt(tok); try { navigator.vibrate && navigator.vibrate(12); } catch {} }, LONG_MS);
});
els.book.addEventListener('pointermove', e => {
  const g = bookGest;
  if (picking && e.pointerType === 'mouse' && (!g || g.id !== e.pointerId)) { const tk = wordTok(e.target); showPick(tk); return; }
  if (!g || g.id !== e.pointerId || !R.book) return;
  const q = ptr(e);
  const dx = q.x - g.x, dy = q.y - g.y;
  if (g.lp && (Math.abs(dx) > 9 || Math.abs(dy) > 9)) { clearTimeout(g.lp); g.lp = 0; }
  if (g.lpDone) return;
  if (!g.st) {
    if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    const dir = dx < 0 ? 1 : -1;
    if (!turnTarget(dir)) { g.blocked = dir; return; }
    if (picking) showPick(null);
    g.st = beginTurn(dir);
    if (!g.st) return;
    g.x = q.x - (dx > 0 ? 10 : -10);
    try { els.book.setPointerCapture(e.pointerId); } catch {}
  }
  const now = performance.now();
  g.v = (q.x - g.lastX) / Math.max(1, now - g.lastT); g.lastX = q.x; g.lastT = now;
  const w = els.bookSheet.offsetWidth * (R.book.spread ? 0.45 : 0.85);
  const f = Math.max(0, Math.min(1, (g.st.dir > 0 ? g.x - q.x : q.x - g.x) / w));
  setTurn(g.st, f);
});
function releaseBook(e, cancelled) {
  const g = bookGest;
  if (!g || g.id !== e.pointerId) return;
  bookGest = null;
  clearTimeout(g.lp);
  if (g.lpDone) return;
  if (g.st) {
    if (flip !== g.st) return;
    const flick = g.st.dir > 0 ? g.v < -0.35 : g.v > 0.35, back = g.st.dir > 0 ? g.v > 0.35 : g.v < -0.35;
    settleTurn(g.st, !cancelled && !back && (g.st.f > 0.33 || flick), 560);
    return;
  }
  if (cancelled) { if (picking) showPick(null); return; }
  if (g.blocked) { if (g.blocked > 0 && !picking) turnPage(1); return; }
  const q = ptr(e);
  const dx = q.x - g.x, dy = q.y - g.y;
  if (getSelection && String(getSelection()).length) return;
  if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
    if (picking) { pickAt(e.target); return; }
    // v7.6: a tap only ever saves the ribbon (pages turn by swiping); a tap beside the text takes the nearest sentence
    let tok = wordTok(e.target);
    if (tok == null) {
      const r = sheetBox();
      let best = null, bd = 1e9;
      for (const w of els.bookCols.querySelectorAll('w')) {
        const b = w.getBoundingClientRect();
        if (b.right < r.left || b.left > r.right || !b.width) continue;
        const d = Math.hypot(Math.max(b.left - q.x, 0, q.x - b.right), Math.max(b.top - q.y, 0, q.y - b.bottom) * 1.5);
        if (d < bd) { bd = d; best = w; }
      }
      if (best) tok = +best.dataset.i;
    }
    if (tok != null) setSpot(tok);
  }
}
els.book.addEventListener('pointerup', e => releaseBook(e, false));
els.book.addEventListener('pointercancel', e => releaseBook(e, true));
els.book.addEventListener('pointerleave', e => { if (picking && e.pointerType === 'mouse' && !bookGest) showPick(null); });
// a long press must not open the browser's menu over the page
els.book.addEventListener('contextmenu', e => e.preventDefault());
let wheelLock = 0;
els.book.addEventListener('wheel', e => {
  e.preventDefault();
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  const now = performance.now();
  if (Math.abs(d) < 18 || now < wheelLock) return;
  wheelLock = now + 450;
  turnPage(d > 0 ? 1 : -1);
}, { passive: false });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (R.T && S.mode === 'book' && R.book) { R.book.key = ''; render(); } });

function renderProgress() {
  const T = R.T; const total = T.origCount;
  const cur = Math.min(total, curOrig() + 1);
  const pct = total ? (cur / total) * 100 : 0;
  els.fill.style.width = pct + '%';
  els.thumb.style.left = pct + '%';
  els.track.setAttribute('aria-valuenow', Math.round(pct));
  els.pText.textContent = t('reader.pos', { a: fmtNum(cur), b: fmtNum(total) });
  els.pPct.textContent = Math.floor(pct) + '%';
  const left = total - cur;
  els.pLeft.textContent = left > 0 ? t('reader.left', { t: fmtTime(TX.estimateMinutes(left, S)) }) : t('reader.done');
}

/* ---------- Playback engine ---------- */
function play() {
  if (!R.T || !R.T.tok.length || S.mode === 'book') return;
  if (R.ci >= R.starts.length - 2 && R.started && !R.playing && isAtEnd()) R.ci = 0;
  if (R.started && S.rewind && R.pausedAt && performance.now() - R.pausedAt > 1200) {
    const s = curTok();
    const target = Math.max(TX.sentenceStart(R.T, s), s - 5);
    R.ci = TX.chunkOfToken(R.starts, target);
  }
  R.started = true;
  R.playing = true;
  R.rampStep = 0;
  R.lastTick = performance.now();
  els.reader.classList.add('playing');
  $('#tapHint').hidden = true;
  updatePlayUI();
  lockWake();
  render();
  schedule();
}
function isAtEnd() { return R.ci >= R.starts.length - 2; }
function schedule() {
  clearTimeout(R.timer);
  if (!R.playing) return;
  if (S.tts) { ttsSpeak(); return; }
  const s = R.starts[R.ci], e = R.starts[R.ci + 1];
  const d = TX.chunkDelay(R.T, s, e, S, S.ramp ? R.rampStep : null);
  R.rampStep++;
  // Blink pause: fixed-point (RSVP) reading suppresses blinking and raises eye
  // fatigue (Benedetto et al., 2015). About every 25 s, at a sentence end, the
  // word gently fades for a moment so your eyes can blink and rest.
  let extra = 0;
  if (S.blink && S.mode === 'rsvp' && R.sinceBlinkMs >= 25000 && (R.T.flags[e - 1] & (TX.F_SENT | TX.F_PARA))) {
    extra = 650; R.sinceBlinkMs = 0;
    const row = els.row;
    setTimeout(() => { if (R.playing) row.classList.add('blinkrest'); }, Math.max(0, d - 80));
    setTimeout(() => row.classList.remove('blinkrest'), d + extra - 120);
  }
  R.timer = setTimeout(tick, d + extra);
}
let goalShownFor = localStorage.getItem('focusread_goal_day') || '';
function tick() {
  if (!R.playing || !R.T) return;
  const now = performance.now();
  const dt = Math.min(10000, now - R.lastTick);
  R.lastTick = now;
  const T = R.T, s = R.starts[R.ci], e = R.starts[R.ci + 1];
  const words = (e < T.tok.length ? T.orig[e] : T.origCount) - T.orig[s];
  R.sessionWords += words; R.sessionMs += dt; R.sinceBreakMs += dt; R.sinceBlinkMs = (R.sinceBlinkMs || 0) + dt;
  ST.addReading(words, dt);
  if (isAtEnd()) { finish(); return; }
  if (stopAtChapter(R.starts[R.ci + 1])) return;
  R.ci++;
  render();
  savePos();
  const td = ST.today();
  if (td.ms >= S.goalMin * 60000 && goalShownFor !== ST.dayKey()) {
    goalShownFor = ST.dayKey();
    try { localStorage.setItem('focusread_goal_day', goalShownFor); } catch {}
    toast(t('toast.goal'));
  }
  if (S.breakMin > 0 && R.sinceBreakMs >= S.breakMin * 60000) { showBreak(); return; }
  schedule();
}
function pause() {
  ttsStop();
  if (!R.playing) { updatePlayUI(); return; }
  R.playing = false;
  clearTimeout(R.timer);
  R.pausedAt = performance.now();
  els.reader.classList.remove('playing');
  updatePlayUI();
  releaseWake();
  savePos(true);
  ST.flush();
}
function togglePlay() { if (picking) endPick(); if (S.mode === 'book') { turnPage(1); return; } R.playing ? pause() : play(); }
function updatePlayUI() {
  els.play.querySelector('use').setAttribute('href', R.playing ? '#i-pause' : '#i-play');
}
function jumpToToken(tok, { keepPlaying = true } = {}) {
  const was = R.playing;
  R.ci = TX.chunkOfToken(R.starts, Math.max(0, Math.min(R.T.tok.length - 1, tok)));
  R.pausedAt = 0; // explicit navigation: no auto-rewind
  render();
  savePos();
  if (was && keepPlaying) { R.rampStep = 3; schedule(); }
}
function stepChunk(dir) { jumpToToken(R.starts[Math.max(0, Math.min(R.starts.length - 2, R.ci + dir))]); }
function stepSentence(dir) {
  const s = curTok();
  jumpToToken(dir < 0 ? TX.prevSentenceStart(R.T, s) : TX.nextSentenceStart(R.T, s));
  hud(dir < 0 ? t('hud.sentBack') : t('hud.sentFwd'));
}
const clampWpm = v => Math.max(100, Math.min(1000, Math.round(v / 5) * 5));
function changeSpeed(d) { setSetting('wpm', clampWpm(S.wpm + d)); hud(S.wpm + ' ' + t('set.wpm')); }
function restart() { jumpToToken(0); if (!R.playing) play(); }

function finish() {
  pause();
  R.doc.finished = true; R.doc.pos = R.T.origCount;
  saveMeta(R.doc, { pos: true });
  ST.flush();
  $('#finWords').textContent = fmtNum(R.sessionWords);
  $('#finTime').textContent = fmtClock(R.sessionMs);
  $('#finWpm').textContent = R.sessionMs > 5000 ? Math.round(R.sessionWords / (R.sessionMs / 60000)) : '—';
  $('#finishOverlay').hidden = false;
}
$('#finAgain').addEventListener('click', () => { $('#finishOverlay').hidden = true; R.doc.finished = false; R.sessionWords = 0; R.sessionMs = 0; restart(); });
$('#finLibrary').addEventListener('click', () => closeReader());

let breakTimer;
function showBreak() {
  pause();
  R.sinceBreakMs = 0;
  const ov = $('#breakOverlay'); ov.hidden = false;
  const arc = $('#breakArc'); const C = 276.46;
  let left = 20;
  arc.style.strokeDashoffset = '0';
  $('#breakCount').textContent = left;
  clearInterval(breakTimer);
  breakTimer = setInterval(() => {
    left--;
    $('#breakCount').textContent = Math.max(0, left);
    arc.style.strokeDashoffset = String(C * (1 - left / 20));
    if (left <= 0) { clearInterval(breakTimer); $('#breakCount').textContent = '✓'; }
  }, 1000);
}
$('#breakResume').addEventListener('click', () => { clearInterval(breakTimer); $('#breakOverlay').hidden = true; play(); });

/* ---------- Wake lock & visibility ---------- */
async function lockWake() {
  try { if ('wakeLock' in navigator && !R.wake) { R.wake = await navigator.wakeLock.request('screen'); R.wake.addEventListener('release', () => { R.wake = null; }); } } catch {}
}
function releaseWake() { try { R.wake && R.wake.release(); } catch {} R.wake = null; }
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (R.playing) pause(); savePos(true); ST.flush(); }
});
window.addEventListener('pagehide', () => { savePos(true); ST.flush(); });

/* ---------- Reader controls ---------- */
els.play.addEventListener('click', togglePlay);
$('#closeReaderBtn').addEventListener('click', () => closeReader());
$('#restartBtn').addEventListener('click', restart);
$('#sentBtn').addEventListener('click', () => stepSentence(-1));
$('#sentNextBtn').addEventListener('click', e => { e.currentTarget.blur(); stepSentence(1); });
/** Text size while reading: word size in word mode, page text size in page and book modes. */
function sizeLimits() { const v = S.mode === 'rsvp' ? S.fontSize : S.pageSize, lo = S.mode === 'rsvp' ? 28 : 15, hi = S.mode === 'rsvp' ? 120 : 32; $('#sizeUpBtn').disabled = v >= hi; $('#sizeDownBtn').disabled = v <= lo; return v; }
function changeSize(dir) {
  if (S.mode === 'rsvp') setSetting('fontSize', Math.max(28, Math.min(120, S.fontSize + dir * 4)));
  else setSetting('pageSize', Math.max(15, Math.min(32, S.pageSize + dir)));
  hud('Aa ' + sizeLimits());
}
$('#sizeUpBtn').addEventListener('click', e => { e.stopPropagation(); changeSize(1); });
$('#sizeDownBtn').addEventListener('click', e => { e.stopPropagation(); changeSize(-1); });
$('#prevBtn').addEventListener('click', () => S.mode === 'book' ? turnPage(-1) : stepChunk(-1));
$('#nextBtn').addEventListener('click', () => S.mode === 'book' ? turnPage(1) : stepChunk(1));
$('#slowerBtn').addEventListener('click', () => changeSpeed(-20));
$('#fasterBtn').addEventListener('click', () => changeSpeed(20));
$('#modeBtn').addEventListener('click', () => { setSetting('mode', S.mode === 'rsvp' ? 'pacer' : S.mode === 'pacer' ? 'book' : 'rsvp'); hud(t('mode.' + S.mode)); if (S.mode === 'book') bookHint(); });
$('#readerSettingsBtn').addEventListener('click', openSheet);

// Gestures on the RSVP stage: tap = play/pause, swipe ↔ = sentence, swipe ↕ = speed
let gest = null;
els.rsvp.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  gest = { x: e.clientX, y: e.clientY, id: e.pointerId };
});
els.rsvp.addEventListener('pointerup', e => {
  if (!gest || gest.id !== e.pointerId) return;
  const dx = e.clientX - gest.x, dy = e.clientY - gest.y; gest = null;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax < 14 && ay < 14) togglePlay();
  else if (ax > ay && ax > 40) stepSentence(dx < 0 ? 1 : -1);
  else if (ay > 40) changeSpeed(dy < 0 ? 25 : -25);
});
els.rsvp.addEventListener('pointercancel', () => { gest = null; });

// Pacer: tap a word to jump, tap elsewhere to play/pause
let pacerLP = null, pacerLPFired = false;
els.pacer.addEventListener('pointerdown', e => {
  if (picking || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const tok = wordTok(e.target);
  pacerLPFired = false;
  if (tok == null) return;
  const x = e.clientX, y = e.clientY;
  clearTimeout(pacerLP?.t);
  pacerLP = { x, y, t: setTimeout(() => { pacerLPFired = true; if (R.playing) pause(); flashPick(tok); markSentenceAt(tok); try { navigator.vibrate && navigator.vibrate(12); } catch {} }, LONG_MS) };
});
els.pacer.addEventListener('pointermove', e => {
  if (picking && e.pointerType === 'mouse') { showPick(wordTok(e.target)); return; }
  if (pacerLP && (Math.abs(e.clientX - pacerLP.x) > 9 || Math.abs(e.clientY - pacerLP.y) > 9)) { clearTimeout(pacerLP.t); pacerLP = null; }
});
['pointerup', 'pointercancel', 'scroll'].forEach(ev => els.pacer.addEventListener(ev, () => { if (pacerLP) { clearTimeout(pacerLP.t); pacerLP = null; } }, { passive: true }));
els.pacer.addEventListener('contextmenu', e => { if (wordTok(e.target) != null) e.preventDefault(); });
els.pacer.addEventListener('click', e => {
  if (pacerLPFired) { pacerLPFired = false; return; }
  if (picking) { pickAt(e.target); return; }
  if ((getSelection()?.toString() || '').length) return;
  const w = e.target.closest('w');
  if (w) { jumpToToken(Number(w.dataset.i)); setSpot(Number(w.dataset.i)); if (!R.playing) { R.started = true; R.pausedAt = 0; } }
  else togglePlay();
});

// Seekable progress bar
function seekFromEvent(e) {
  const r = els.track.getBoundingClientRect();
  const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  const origTarget = Math.floor(f * (R.T.origCount - 1));
  let tok = TX.tokenOfOrig(R.T, origTarget);
  const ss = TX.sentenceStart(R.T, tok);
  if (tok - ss < 25) tok = ss;
  jumpToToken(tok);
}
els.track.addEventListener('pointerdown', e => {
  if (!R.T) return;
  els.track.setPointerCapture(e.pointerId); els.track.classList.add('drag');
  seekFromEvent(e);
  const move = ev => seekFromEvent(ev);
  const up = () => { els.track.classList.remove('drag'); els.track.removeEventListener('pointermove', move); els.track.removeEventListener('pointerup', up); els.track.removeEventListener('pointercancel', up); };
  els.track.addEventListener('pointermove', move);
  els.track.addEventListener('pointerup', up);
  els.track.addEventListener('pointercancel', up);
});

// Fullscreen
const fsSupported = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
if (!fsSupported) $('#fsBtn').hidden = true;
function toggleFullscreen() {
  if (!fsSupported) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
}
$('#fsBtn').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => $('#fsBtn use').setAttribute('href', document.fullscreenElement ? '#i-shrink' : '#i-expand'));

window.addEventListener('resize', debounce(() => { if (R.T && S.mode === 'rsvp') fitWord(); R.lastLineTop = -1; if (R.T && S.mode === 'book') render(); }, 120));

/* ================= Keyboard ================= */
window.addEventListener('keydown', e => {
  const tag = document.activeElement?.tagName;
  const typing = tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || document.activeElement?.isContentEditable;
  if (e.key === 'Escape') {
    if (!$('#settingsSheet').hidden) { closeSheet(); e.preventDefault(); return; }
    if ($('#helpDialog').open || $('#tocDialog').open || $('#noteDialog').open) return;
    if (picking) { e.preventDefault(); endPick(); return; }
    if (R.T) { e.preventDefault(); closeReader(); }
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '?') { e.preventDefault(); openHelp(); return; }
  if (!R.T) {
    if (e.code === 'Space' && TX.countWords(textInput.value)) { e.preventDefault(); readComposer(); }
    return;
  }
  if (!$('#settingsSheet').hidden && e.code !== 'Space') return;
    if ($('#tocDialog').open || $('#noteDialog').open) return;
  if (S.mode === 'book') {
    const dir = { Space: e.shiftKey ? -1 : 1, ArrowRight: 1, ArrowDown: 1, PageDown: 1, Enter: 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1, Backspace: -1 }[e.code];
    if (dir) { e.preventDefault(); if (e.target.closest && e.target.closest('button')) e.target.blur(); turnPage(dir); return; }
    if (e.code === 'Home' || e.code === 'End') { e.preventDefault(); jumpToToken(e.code === 'Home' ? 0 : R.T.tok.length - 1); return; }
  }
  switch (e.code) {
    case 'Space': e.preventDefault(); if (e.target.closest && e.target.closest('button')) e.target.blur(); togglePlay(); break;
    case 'ArrowLeft': e.preventDefault(); e.shiftKey ? stepSentence(-1) : stepChunk(-1); break;
    case 'ArrowRight': e.preventDefault(); e.shiftKey ? stepSentence(1) : stepChunk(1); break;
    case 'ArrowUp': e.preventDefault(); changeSpeed(20); break;
    case 'ArrowDown': e.preventDefault(); changeSpeed(-20); break;
    case 'BracketLeft': case 'Minus': changeSize(-1); break;
    case 'BracketRight': case 'Equal': changeSize(1); break;
    case 'KeyM': $('#modeBtn').click(); break;
    case 'KeyB': case 'KeyJ': setSetting('bionic', !S.bionic); hud('Bionic ' + (S.bionic ? 'on' : 'off')); break;
    case 'KeyG': setSetting('ghost', !S.ghost); break;
    case 'KeyF': toggleFullscreen(); break;
    case 'KeyR': restart(); break;
      case 'KeyC': openToc(); break;
      case 'KeyN': stepChapter(1); break;
      case 'KeyP': stepChapter(-1); break;
      case 'KeyH': addMark(); break;
      case 'KeyK': break;
      case 'KeyV': toggleTts(); break;
  }
});

/* ================= Settings sheet ================= */
const sheet = $('#settingsSheet'), scrim = $('#sheetScrim');
function openSheet() { sheet.hidden = false; scrim.hidden = false; sheet.style.transform = ''; }
function closeSheet() { sheet.hidden = true; scrim.hidden = true; }
$('#settingsBtn').addEventListener('click', openSheet);
$('#closeSheetBtn').addEventListener('click', closeSheet);
scrim.addEventListener('click', closeSheet);
// swipe down to close (mobile bottom sheet)
(() => {
  let y0 = null;
  const head = sheet.querySelector('.sheet-head'), grip = sheet.querySelector('.sheet-grip');
  [head, grip].forEach(h => {
    h.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; y0 = e.clientY; h.setPointerCapture(e.pointerId); });
    h.addEventListener('pointermove', e => { if (y0 == null) return; const dy = Math.max(0, e.clientY - y0); sheet.style.transform = `translateY(${dy}px)`; });
    h.addEventListener('pointerup', e => { if (y0 == null) return; const dy = e.clientY - y0; y0 = null; sheet.style.transform = ''; if (dy > 80) closeSheet(); });
    h.addEventListener('pointercancel', () => { y0 = null; sheet.style.transform = ''; });
  });
})();

$$('[data-set]').forEach(el => el.addEventListener('change', () => {
  const k = el.dataset.set;
  const v = el.type === 'checkbox' ? el.checked : el.hasAttribute('data-num') ? Number(el.value) : el.value;
  setSetting(k, v);
  if (k === 'goalMin') renderStats();
}));
$('#wpmRange').addEventListener('input', e => setSetting('wpm', Number(e.target.value)));
$('#sizeRange').addEventListener('input', e => setSetting('fontSize', Number(e.target.value)));
$('#pageSizeRange').addEventListener('input', e => setSetting('pageSize', Number(e.target.value)));
$$('#wpmPresets button').forEach(b => b.addEventListener('click', () => setSetting('wpm', Number(b.dataset.wpm))));
$$('#chunkSeg button').forEach(b => b.addEventListener('click', () => setSetting('chunk', Number(b.dataset.chunk))));
$$('#modeSeg button').forEach(b => b.addEventListener('click', () => setSetting('mode', b.dataset.mode)));
$$('#focusSwatches button').forEach(b => b.addEventListener('click', () => setSetting('focusColor', b.dataset.color)));
$$('#inkSwatches button').forEach(b => b.addEventListener('click', () => setSetting('ink', b.dataset.ink)));
$('#inkAlphaRange').addEventListener('input', e => setSetting('inkAlpha', Number(e.target.value)));
$$('#themeGrid button').forEach(b => b.addEventListener('click', () => setSetting('theme', b.dataset.themeOpt)));
$('#langBtn').addEventListener('click', () => setSetting('lang', S.lang === 'sq' ? 'en' : 'sq'));
$('#resetBtn').addEventListener('click', () => {
  const lang = S.lang; S = { ...DEFAULTS, lang }; saveSettings(); applySettings(); renderStats(); if (R.T) rebuild();
});
darkMQ.addEventListener?.('change', () => { if (S.theme === 'auto') applySettings(); });

/* Help */
function openHelp() { const d = $('#helpDialog'); if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
$('#helpBtnHome').addEventListener('click', openHelp);
$('#helpDialog').addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === e.currentTarget) e.currentTarget.close(); });


/* ================= Sync UI ================= */
const syncDialog = $('#syncDialog');
let syncPrefill = '';
function syncAgo(ts) {
  if (!ts) return '';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return t('sync.ago.now');
  if (m < 60) return t('sync.ago.min', { n: m });
  return t('sync.ago.h', { n: Math.floor(m / 60) });
}
function syncErrText(e) {
  const c = typeof e === 'string' ? e : (e && (e.code || e.message)) || '';
  if (c === 'not_configured') return t('sync.err.not_configured');
  if (c === 'invalid') return t('sync.err.invalid');
  if (/abort|fetch|network|http/i.test(c) || e instanceof TypeError) return t('sync.err.net');
  return c;
}
function syncStatusText(s) {
  if (s.state === 'syncing') return t('sync.st.syncing');
  if (s.state === 'ok') return t('sync.st.ok', { t: syncAgo(s.lastSync) });
  if (s.state === 'offline') return t('sync.st.offline');
  if (s.state === 'error') return t('sync.st.error', { e: syncErrText(s.error) });
  if (s.state === 'idle') return t('sync.st.idle');
  return t('sync.st.off');
}
function updateSyncBadge(s) {
  const b = $('#syncBtn');
  b.dataset.state = s.state;
  b.title = t('sync.btn') + ' · ' + syncStatusText(s);
  const el = $('#syncStatus');
  if (el) { el.dataset.state = s.state; el.querySelector('span').textContent = syncStatusText(s); }
}
async function renderSyncDialog() {
  const box = $('#syncBody');
  if (!Sync.isOn()) {
    box.innerHTML = `
      <p>${t('sync.intro')}</p>
      ${syncPrefill ? `<p><strong>${t('sync.fromLink')}</strong></p>` : ''}
      <div class="sync-card">
        <h3>${t('sync.have')}</h3>
        <div class="sync-row"><input id="syncCodeInput" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="24" placeholder="${t('sync.codePh')}" value="${TX.esc(syncPrefill)}"><button id="syncJoinBtn" class="btn primary" type="button">${t('sync.join')}</button></div>
      </div>
      <div class="sync-card">
        <h3>${t('sync.first')}</h3>
        <button id="syncCreateBtn" class="btn" type="button"><svg class="ic"><use href="#i-plus"/></svg>${t('sync.create')}</button>
      </div>
      <p id="syncErr" class="sync-err" role="alert"></p>
      <div class="sync-note"><svg class="ic"><use href="#i-lock"/></svg><span>${t('sync.e2e')}</span></div>`;
    const input = $('#syncCodeInput');
    input.addEventListener('input', () => { const c = Sync.normalizeCode(input.value).slice(0, 16); const f = Sync.formatCode(c); if (f !== input.value) input.value = f; });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') $('#syncJoinBtn').click(); });
    const busy = (btn, on) => { btn.disabled = on; };
    $('#syncJoinBtn').addEventListener('click', async e => {
      const btn = e.currentTarget; $('#syncErr').textContent = '';
      const code = Sync.normalizeCode(input.value);
      if (!Sync.isValidCode(code)) { $('#syncErr').textContent = t('sync.err.invalid'); return; }
      busy(btn, true);
      try {
        const r = await Sync.connect(code);
        syncPrefill = '';
        toast(r.existing ? t('sync.joined', { n: r.count }) : t('sync.joinedEmpty'), { duration: 6000 });
        await renderLibrary(); renderStats(); renderSyncDialog();
      } catch (err) { $('#syncErr').textContent = syncErrText(err); }
      busy(btn, false);
    });
    $('#syncCreateBtn').addEventListener('click', async e => {
      const btn = e.currentTarget; $('#syncErr').textContent = '';
      busy(btn, true);
      try { await Sync.connect(Sync.generateCode(), { fresh: true }); toast(t('sync.created')); renderSyncDialog(); }
      catch (err) { $('#syncErr').textContent = syncErrText(err); }
      busy(btn, false);
    });
    if (syncPrefill) setTimeout(() => $('#syncJoinBtn').focus(), 50);
    return;
  }
  const code = Sync.formatCode(Sync.getCode());
  const link = Sync.shareLink();
  box.innerHTML = `
    <div id="syncStatus" class="sync-status"><i></i><span></span></div>
    <div class="sync-card">
      <h3>${t('sync.yourCode')}</h3>
      <div class="sync-code">${code}</div>
      <div class="sync-qr"><img id="syncQr" alt="QR"></div>
      <div class="sync-actions">
        <button id="syncCopyCode" class="btn small" type="button"><svg class="ic"><use href="#i-copy"/></svg>${t('sync.copy')}</button>
        <button id="syncCopyLink" class="btn small" type="button"><svg class="ic"><use href="#i-link"/></svg>${t('sync.copyLink')}</button>
      </div>
      <p class="small muted" style="margin:0">${t('sync.how')}</p>
    </div>
    <div class="sync-actions">
      <button id="syncNowBtn" class="btn primary" type="button"><svg class="ic"><use href="#i-cloud"/></svg>${t('sync.now')}</button>
      <button id="syncLeaveBtn" class="btn ghost" type="button">${t('sync.leave')}</button>
    </div>
    <div class="sync-note"><svg class="ic"><use href="#i-lock"/></svg><span>${t('sync.e2e')} ${t('sync.keep')}</span></div>`;
  updateSyncBadge(Sync.getStatus());
  import('/vendor/qrcode.js').then(({ default: qrcode }) => {
    const qr = qrcode(0, 'M'); qr.addData(link); qr.make();
    const img = $('#syncQr'); if (img) img.src = qr.createDataURL(6, 2);
  }).catch(() => { const q = $('.sync-qr'); if (q) q.remove(); });
  const copy = async (txt, btn) => {
    try { await navigator.clipboard.writeText(txt); } catch {
      const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch {} ta.remove();
    }
    const old = btn.lastChild.textContent; btn.lastChild.textContent = t('sync.copied'); setTimeout(() => { btn.lastChild.textContent = old; }, 1400);
  };
  $('#syncCopyCode').addEventListener('click', e => copy(code, e.currentTarget));
  $('#syncCopyLink').addEventListener('click', e => copy(link, e.currentTarget));
  $('#syncNowBtn').addEventListener('click', () => Sync.syncNow());
  $('#syncLeaveBtn').addEventListener('click', () => { if (confirm(t('sync.leaveConfirm'))) { Sync.disconnect(); renderSyncDialog(); } });
}
function openSync(prefill) {
  if (prefill && !Sync.isOn()) syncPrefill = Sync.formatCode(Sync.normalizeCode(prefill).slice(0, 16));
  renderSyncDialog();
  if (!syncDialog.open) { if (syncDialog.showModal) syncDialog.showModal(); else syncDialog.setAttribute('open', ''); }
}
$('#syncBtn').addEventListener('click', () => openSync());
window.addEventListener('hashchange', () => {
  const m = location.hash.match(/sync=([A-Za-z0-9-]+)/);
  if (m) { history.replaceState(null, '', '/'); openSync(m[1]); }
});
syncDialog.addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === syncDialog) syncDialog.close(); });
setInterval(() => { if (Sync.isOn()) updateSyncBadge(Sync.getStatus()); }, 30000);

/* ================= Install, offline, service worker ================= */
let deferredPrompt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; $('#installBtn').classList.remove('hidden'); });
window.addEventListener('appinstalled', () => { $('#installBtn').classList.add('hidden'); deferredPrompt = null; });
if (isIOS && !isStandalone()) $('#installBtn').classList.remove('hidden');
$('#installBtn').addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') $('#installBtn').classList.add('hidden');
    deferredPrompt = null;
  } else if (isIOS) {
    toast(getLang() === 'sq' ? 'Në Safari: shtyp “Shpërndaj” ⎋ pastaj “Shto në ekranin bazë”.' : 'In Safari: tap “Share” ⎋ then “Add to Home Screen”.', { duration: 8000 });
  }
});
function updateOnline() { $('#offlineBadge').classList.toggle('hidden', navigator.onLine); }
window.addEventListener('online', updateOnline); window.addEventListener('offline', updateOnline);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', async () => {
    try {
      const hadController = !!navigator.serviceWorker.controller;
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      const onWaiting = w => toast(t('toast.update'), { action: t('toast.reload'), sticky: true, onAction: () => { savePos(true); w.postMessage({ type: 'SKIP_WAITING' }); } });
      if (reg.waiting && hadController) onWaiting(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw && nw.addEventListener('statechange', () => {
          if (nw.state === 'installed') { if (navigator.serviceWorker.controller && hadController) onWaiting(nw); else toast(t('toast.offlineReady')); }
        });
      });
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (!hadController || reloading) return; reloading = true; location.reload(); });
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    } catch (e) { console.warn('SW registration failed', e); }
  });
}

/* ================= Incoming content: share target, file handler ================= */
async function handleIncoming() {
  const m = location.hash.match(/sync=([A-Za-z0-9-]+)/);
  if (m) setTimeout(() => openSync(m[1]), 300);
  const params = new URLSearchParams(location.search);
  const title = params.get('title') || '', text = params.get('text') || '', url = params.get('url') || '';
  if (text || url) {
    const body = [text, url && !text.includes(url) ? url : ''].filter(Boolean).join('\n\n');
    textInput.value = body; updateComposerMeta(); saveDraft();
    const meta = await addDoc({ title: title || undefined, text: TX.normalize(body), kind: 'share' });
    await renderLibrary();
    toast(t('toast.shared'), { action: t('lib.read'), onAction: () => openReader(meta.id), duration: 8000 });
  }
  if (params.get('share') === '1') await takeSharedFiles();
  if (location.search || location.hash) history.replaceState(null, '', '/');
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async lp => {
      if (!lp.files || !lp.files.length) return;
      const files = [];
      for (const h of lp.files) { try { files.push(await h.getFile()); } catch {} }
      if (files.length) handleFiles(files);
    });
  }
}

/** Files (and text) shared to FocusRead from another app, parked by the service worker. */
async function takeSharedFiles() {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open('fr-share');
    const reqs = (await cache.keys()).filter(r => new URL(r.url).pathname.startsWith('/__share/'));
    const files = [];
    for (const r of reqs) {
      const res = await cache.match(r);
      if (!res) continue;
      if (r.url.endsWith('/text')) {
        const j = await res.json().catch(() => null);
        const body = j ? [j.text, j.url && !String(j.text || '').includes(j.url) ? j.url : ''].filter(Boolean).join('\n\n') : '';
        if (body.trim()) { const meta = await addDoc({ title: j.title || undefined, text: TX.normalize(body), kind: 'share' }); toast(t('toast.shared'), { action: t('lib.read'), onAction: () => openReader(meta.id), duration: 8000 }); }
      } else {
        const name = decodeURIComponent(res.headers.get('X-Name') || 'file');
        const blob = await res.blob();
        files.push(new File([blob], name, { type: blob.type && blob.type !== 'application/octet-stream' ? blob.type : '' }));
      }
      await cache.delete(r);
    }
    if (files.length) await handleFiles(files);
  } catch (e) { console.warn('share import failed', e); }
}

/* ================= Init ================= */
/* ================= Chapters & contents ================= */
// Headings (title, chapters, subheadings) are detected when the text is
// tokenised (see structure.js). Here they become a table of contents, a
// "current chapter" label in the top bar and ticks on the progress bar.
function buildOutline() {
  const heads = R.T?.heads || [];
  R.headIdx = -2;
  $('#tocBtn').hidden = false;
  $('#chapterChip').hidden = true;
  els.track.querySelectorAll('.ptick').forEach(n => n.remove());
  const total = R.T?.origCount || 0;
  if (!total || !heads.length) return;
  const top = R.T.topLevel;
  let marks = heads.filter(h => h.level === top);
  if (marks.length < 2) marks = heads.filter(h => h.level <= top + 1);
  if (marks.length > 80) return;
  for (const h of marks) {
    if (h.o === 0) continue;
    const tick = document.createElement('i');
    tick.className = 'ptick';
    tick.style.left = (h.o / total) * 100 + '%';
    els.track.insertBefore(tick, els.track.firstChild);
  }
}
function headAt(tok) {
  const H = R.T?.heads || [];
  let lo = 0, hi = H.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (H[m].t <= tok) { r = m; lo = m + 1; } else hi = m - 1; }
  return r;
}
function updateChapter() {
  if (!R.T || !R.T.heads?.length) return;
  const i = headAt(curTok());
  if (i === R.headIdx) return;
  R.headIdx = i;
  const chip = $('#chapterChip');
  const h = R.T.heads[i];
  const same = h && R.doc && h.title.trim().toLowerCase() === String(R.doc.title || '').trim().toLowerCase();
  if (!h || same) { chip.hidden = true; return; }
  chip.querySelector('.ct').textContent = h.title;
  chip.title = h.title;
  chip.hidden = false;
}
function openToc(tab) {
  if (!R.T) return;
  const H = R.T.heads || [];
  const list = $('#tocList');
  list.innerHTML = '';
  if (!H.length) list.innerHTML = `<li class="toc-empty">${TX.esc(t('toc.none'))}</li>`;
  const cur = headAt(curTok());
  const total = R.T.origCount || 1;
  const top = R.T.topLevel;
  H.forEach((h, k) => {
    const li = document.createElement('li');
    li.className = 'l' + Math.min(3, h.level - top + 1) + (k === cur ? ' cur' : k < cur ? ' done' : '');
    li.innerHTML = `<button type="button" data-k="${k}"><span class="t">${TX.esc(h.title)}</span><span class="p">${Math.round((h.o / total) * 100)}%</span></button>`;
    list.appendChild(li);
  });
  renderMarks();
  setTab(typeof tab === 'string' ? tab : (H.length ? 'toc' : 'marks'));
  const d = $('#tocDialog');
  if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  const c = list.querySelector('.cur');
  if (c) c.scrollIntoView({ block: 'center' });
}
function goToHead(h) {
  jumpToToken(h.t);
  hud(h.title);
}
function stepChapter(dir) {
  const H = R.T?.heads;
  if (!H?.length) return;
  const lim = R.T.topLevel + 1, tok = curTok();
  let target = null;
  if (dir > 0) target = H.find(h => h.level <= lim && h.t > tok);
  else for (let k = H.length - 1; k >= 0; k--) { const h = H[k]; if (h.level <= lim && h.t < tok - 1) { target = h; break; } }
  if (target) goToHead(target);
}
$('#tocList').addEventListener('click', e => {
  const b = e.target.closest('button[data-k]');
  if (!b) return;
  const h = R.T?.heads?.[+b.dataset.k];
  $('#tocDialog').close();
  if (h) goToHead(h);
});
$('#tocDialog').addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === e.currentTarget) e.currentTarget.close(); });
$('#tocBtn').addEventListener('click', openToc);
$('#chapterChip').addEventListener('click', openToc);

/* ================= Read aloud ================= */
// The device's own voice reads one sentence at a time; its word-boundary events
// move the highlighted word, so eyes and ears stay together. Speed follows WPM.
const TTS = { gen: 0, timer: 0, utt: null, warned: false };
const ttsOK = () => typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined';
function voices() { try { return speechSynthesis.getVoices() || []; } catch { return []; } }
function docLang() {
  if (!R.docLang) {
    const s = (R.text || '').slice(0, 30000);
    R.docLang = (s.match(/[ëçËÇ]/g) || []).length / Math.max(1, s.length) > 0.004 ? 'sq' : 'en';
  }
  return R.docLang;
}
function pickVoice() {
  const all = voices();
  if (S.ttsVoice) { const v = all.find(x => x.voiceURI === S.ttsVoice); if (v) return v; }
  const lang = docLang();
  const m = all.filter(v => (v.lang || '').toLowerCase().replace('_', '-').startsWith(lang));
  return m.find(v => v.default) || m.find(v => v.localService) || m[0] || null;
}
const ttsRate = () => Math.min(2.4, Math.max(0.6, S.wpm / 180));
function ttsStop() {
  TTS.gen++;
  clearInterval(TTS.timer);
  try { if (ttsOK() && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel(); } catch {}
}
function ttsSpeak() {
  const T = R.T;
  if (!T || !R.playing) return;
  if (!ttsOK()) { setSetting('tts', false); toast(t('tts.unsupported')); schedule(); return; }
  const busy = speechSynthesis.speaking || speechSynthesis.pending;
  ttsStop();
  const gen = TTS.gen;
  const n = T.tok.length, s0 = curTok();
  let b = s0;
  while (b < n - 1 && !(T.flags[b] & (TX.F_SENT | TX.F_PARA)) && !(b - s0 > 45 && (T.flags[b] & TX.F_CLAUSE))) b++;
  const ents = [];
  let text = '';
  for (let i = s0; i <= b; i++) {
    const w = T.tok[i];
    if (i > s0 && T.orig[i] === T.orig[i - 1]) { text = text.replace(/-$/, '') + w; continue; }
    if (text) text += ' ';
    ents.push({ pos: text.length, t: i });
    text += w;
  }
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) { u.voice = v; u.lang = v.lang; }
  else {
    u.lang = docLang() === 'sq' ? 'sq-AL' : 'en-US';
    if (!TTS.warned) { TTS.warned = true; toast(t('tts.noVoice')); }
  }
  u.rate = ttsRate();
  const t0 = performance.now();
  let seen = false;
  const show = pos => {
    let k = 0;
    while (k + 1 < ents.length && ents[k + 1].pos <= pos) k++;
    const ci = TX.chunkOfToken(R.starts, ents[k].t);
    if (ci > R.ci) { R.ci = ci; render(); }
  };
  u.onboundary = e => { if (gen !== TTS.gen || (e.name && e.name !== 'word')) return; seen = true; show(e.charIndex); };
  // Some voices never report word positions: then follow an estimate of the voice's pace.
  TTS.timer = setInterval(() => {
    if (gen !== TTS.gen || seen) return;
    const el = (performance.now() - t0) / 1000;
    if (el > 0.5) show(Math.floor((el - 0.25) * 15 * u.rate));
  }, 110);
  u.onend = () => {
    if (gen !== TTS.gen) return;
    clearInterval(TTS.timer);
    const dt = Math.min(120000, performance.now() - t0);
    const words = T.orig[b] - T.orig[s0] + 1;
    R.sessionWords += words; R.sessionMs += dt; R.sinceBreakMs += dt;
    ST.addReading(words, dt);
    if (b >= n - 1) { R.ci = R.starts.length - 2; render(); finish(); return; }
    if (stopAtChapter(b + 1)) return;
    R.ci = TX.chunkOfToken(R.starts, b + 1);
    render();
    savePos();
    if (S.breakMin > 0 && R.sinceBreakMs >= S.breakMin * 60000) { showBreak(); return; }
    if (R.playing && S.tts) ttsSpeak();
  };
  u.onerror = e => {
    if (gen !== TTS.gen) return;
    clearInterval(TTS.timer);
    if (e.error === 'interrupted' || e.error === 'canceled') return;
    pause();
    toast(t('tts.error') + (e.error ? ' (' + e.error + ')' : ''));
  };
  TTS.utt = u; // keep a reference (some browsers drop events of collected utterances)
  if (busy) setTimeout(() => { if (gen === TTS.gen) speechSynthesis.speak(u); }, 80);
  else speechSynthesis.speak(u);
}
function updateTtsUI() {
  const b = $('#ttsBtn');
  if (b) { b.classList.toggle('on', !!S.tts); b.setAttribute('aria-pressed', S.tts ? 'true' : 'false'); }
}
function toggleTts() {
  if (!ttsOK()) { toast(t('tts.unsupported')); return; }
  setSetting('tts', !S.tts);
  hud(t(S.tts ? 'tts.on' : 'tts.off'));
}
function fillVoiceSelect() {
  const sel = $('#voiceSel');
  if (!sel) return;
  const all = voices().slice().sort((a, b) => (a.lang || '').localeCompare(b.lang || '') || a.name.localeCompare(b.name));
  sel.innerHTML = `<option value="">${TX.esc(t('set.voiceAuto'))}</option>` +
    all.map(v => `<option value="${TX.esc(v.voiceURI)}">${TX.esc(v.name)} — ${TX.esc(v.lang)}</option>`).join('');
  sel.value = all.some(v => v.voiceURI === S.ttsVoice) ? S.ttsVoice : '';
}
if (ttsOK()) {
  fillVoiceSelect();
  try { speechSynthesis.addEventListener('voiceschanged', fillVoiceSelect); } catch { speechSynthesis.onvoiceschanged = fillVoiceSelect; }
} else {
  $('#ttsBtn').hidden = true;
}
$('#ttsBtn').addEventListener('click', toggleTts);
updateTtsUI();

/* ================= Chapter time & stop ================= */
function chapLevel() {
  const T = R.T;
  if (!T?.heads?.length) return 0;
  const top = T.topLevel;
  return T.heads.filter(h => h.level === top).length >= 2 ? top : top + 1;
}
function isChapterStart(tok) {
  const L = chapLevel();
  return !!L && R.T.heads.some(h => h.level <= L && h.t === tok && h.t > 0);
}
function stopAtChapter(nextTok) {
  if (!S.chapStop || !R.T || !isChapterStart(nextTok)) return false;
  R.ci = TX.chunkOfToken(R.starts, nextTok);
  render();
  savePos(true);
  pause();
  R.pausedAt = 0; // resume exactly at the new chapter
  toast(t('chap.end'), { action: t('chap.next'), onAction: () => play(), duration: 15000 });
  return true;
}
function updateChapterLeft() {
  const chip = $('#chapterChip');
  if (!R.T || chip.hidden) return;
  const L = chapLevel(), tok = curTok();
  let next = null;
  for (const h of R.T.heads) if (h.level <= L && h.t > tok) { next = h; break; }
  const left = Math.max(0, (next ? next.o : R.T.origCount) - curOrig());
  const txt = fmtTime(TX.estimateMinutes(left, S));
  const el = chip.querySelector('.cl');
  if (el.textContent !== txt) {
    el.textContent = txt;
    chip.title = chip.querySelector('.ct').textContent + ' · ' + t('chap.left', { t: txt });
  }
}
const START_RE = /^(?:introduction|hyrje|hyrja|prologue|prolog|prologu|preface|foreword|parath[eë]ni[ea]|chapter\s+(?:1|one|i)\b|kapitulli\s+(?:1|i)\b|kreu\s+(?:1|i)\b|part\s+(?:1|one|i)\b|pjesa\s+(?:1|e\s+par))/iu;
function offerStart(meta) {
  if (!R.T || meta.pos > 0) return;
  const total = R.T.origCount;
  const h = (R.T.heads || []).find(x => x.o >= 120 && x.o <= total * 0.25 && START_RE.test(x.title));
  if (!h) return;
  const name = h.title.length > 40 ? h.title.slice(0, 38) + '…' : h.title;
  toast(t('start.offer', { t: name }), { action: t('start.go'), onAction: () => jumpToToken(h.t, { keepPlaying: false }), duration: 9000 });
}

/* ================= Highlights & notes ================= */
// Saved per book in its metadata (so they sync with it): { id, o, oe, text, note, at }
// o..oe = original word range of the highlighted sentence.
function marksOf() {
  const d = R.doc;
  if (!d) return [];
  if (!Array.isArray(d.marks)) d.marks = [];
  return d.marks;
}
function buildMarks() {
  if (!R.T) return;
  const set = new Uint8Array(R.T.origCount + 1);
  for (const m of marksOf()) if (m.kind !== 'b') for (let o = m.o; o <= m.oe && o < set.length; o++) set[o] = 1;
  R.markSet = set;
  R.pageIdx = -1;
  if (R.book) R.book.key = '';
}
function sentenceRange(tok) {
  const T = R.T, n = T.tok.length;
  const a = TX.sentenceStart(T, tok);
  let b = Math.max(a, tok);
  while (b < n - 1 && !(T.flags[b] & (TX.F_SENT | TX.F_PARA))) b++;
  return [a, b];
}
/** Original-word range [oa, ob] of a text selection inside the page, or null. */
function selectionOrigRange() {
  const sel = window.getSelection && getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount || !R.T) return null;
  const box = S.mode === 'book' ? els.bookCols : S.mode === 'pacer' ? els.page : null;
  if (!box) return null;
  const rg = sel.getRangeAt(0);
  if (!box.contains(rg.commonAncestorContainer)) return null;
  const ws = [...box.querySelectorAll('w[data-i]')].filter(w => rg.intersectsNode(w));
  if (!ws.length) return null;
  const a = Number(ws[0].dataset.i), b = Number(ws[ws.length - 1].dataset.i);
  return [R.T.orig[a], R.T.orig[b]];
}
/** Save the sentence that contains token `tok` (or a given original-word range). */
function saveMarkRange(oa, ob, { tok } = {}) {
  const list = marksOf();
  const ex = list.find(m => m.kind !== 'b' && m.o <= ob && m.oe >= oa);
  // The same gesture on a saved sentence takes it off again (with a way back).
  if (ex) { unsaveMark(ex); return null; }
  const text = R.T.words.slice(oa, ob + 1).filter(Boolean).join(' ').slice(0, 2000);
  const m = { id: DB.uid(), o: oa, oe: ob, text, note: '', ch: curChapterTitle(tok ?? TX.tokenOfOrig(R.T, oa)), at: Date.now() };
  list.push(m);
  list.sort((x, y) => x.o - y.o);
  saveMeta(R.doc);
  buildMarks();
  render();
  toast('★ ' + t('mark.saved'), { actions: [{ label: t('mark.undoSave'), fn: () => dropMark(m) }, { label: t('mark.addNote'), fn: () => editNote(m.id) }], duration: 6000 });
  return m;
}
// Sync (v7.2): a deleted note leaves a tombstone, so a copy on another device doesn't bring it back;
// a note put back or edited gets a fresh stamp (u), which beats an older tombstone or an older copy.
function markGone(m, d = R.doc) { if (d && m) (d.marksDel || (d.marksDel = {}))[m.id] = Date.now(); }
function markBack(m) { if (m) m.u = Date.now(); }
/** Remove a saved sentence from the open book without asking (used by "Undo"). */
function dropMark(m) {
  const ms = marksOf(), i = ms.indexOf(m);
  if (i < 0) return -1;
  markGone(m);
  ms.splice(i, 1);
  saveMeta(R.doc); buildMarks(); render();
  if ($('#tocDialog').open) renderMarks();
  return i;
}
/** Take a saved sentence off while reading; "Rikthe" puts it back with its note. */
function unsaveMark(m) {
  const i = dropMark(m);
  if (i < 0) return;
  hud(t('mark.removed'));
  toast(t('mark.removed'), { action: t('mark.undo'), duration: 7000, onAction: () => {
    const ms = marksOf();
    if (ms.includes(m)) return;
    markBack(m);
    ms.splice(Math.min(i, ms.length), 0, m);
    ms.sort((x, y) => x.o - y.o);
    saveMeta(R.doc); buildMarks(); render();
    if ($('#tocDialog').open) renderMarks();
  } });
}
function markSentenceAt(tok) {
  if (!R.T || !R.doc) return;
  const [a, b] = sentenceRange(tok);
  saveMarkRange(R.T.orig[a], R.T.orig[b], { tok: a });
}
/**
 * The star button. Words mode (and a running guided page) saves the sentence being read.
 * On a page you are looking at (book, or a paused guided page) it first asks which sentence:
 * the next tap on the text saves exactly that sentence. A text selection is saved as is.
 */
function addMark() {
  if (!R.T || !R.doc) return;
  if (picking) { endPick(); return; }
  const sel = selectionOrigRange();
  if (sel) { saveMarkRange(sel[0], sel[1]); try { getSelection().removeAllRanges(); } catch {} return; }
  if (S.mode === 'book' || (S.mode === 'pacer' && !R.playing)) { startPick(); return; }
  markSentenceAt(curTok());
}

/* ---- Pick a sentence by tapping it ---- */
let picking = false;
const pickBox = () => (S.mode === 'book' ? els.bookCols : els.page);
function startPick() {
  if (R.playing) pause();
  picking = true;
  pickCount = 0;
  const sp0 = $('#pickBar span'); if (sp0) sp0.textContent = t('pick.hint');
  els.reader.classList.add('picking');
  $('#markBtn').classList.add('on');
  $('#pickBar').hidden = false;
}
function endPick() {
  picking = false;
  els.reader.classList.remove('picking');
  $('#markBtn').classList.remove('on');
  $('#pickBar').hidden = true;
  showPick(null);
}
let pickShown = '';
/** Outline the sentence under the pointer while choosing. */
function showPick(tok, cls = 'pk') {
  const box = pickBox();
  const key = tok == null ? '' : cls + ':' + sentenceRange(tok).join('-');
  if (key === pickShown && cls === 'pk') return;
  pickShown = key;
  box.querySelectorAll('w.pk,w.pkf').forEach(w => w.classList.remove('pk', 'pkf'));
  if (tok == null) return;
  const [a, b] = sentenceRange(tok);
  for (let i = a; i <= b; i++) { const w = box.querySelector(`w[data-i="${i}"]`); if (w) w.classList.add(cls); }
}
/** Brief glow over a sentence that was just saved by a long press. */
function flashPick(tok) { showPick(tok, 'pkf'); setTimeout(() => { if (pickShown.startsWith('pkf')) showPick(null); }, 650); }
const wordTok = target => { const w = target && target.closest && target.closest('w[data-i]'); return w ? Number(w.dataset.i) : null; };
// The star stays on: tap as many sentences as you like, then ✕ (or the star again) when done.
let pickCount = 0;
function pickAt(target) {
  const tok = wordTok(target);
  if (tok == null) return;
  markSentenceAt(tok);
  flashPick(tok);
  pickCount++;
  const sp = $('#pickBar span');
  if (sp) sp.textContent = t('pick.hint') + ' · ✓ ' + pickCount;
  try { navigator.vibrate && navigator.vibrate(10); } catch {}
}
$('#pickCancel').addEventListener('click', e => { e.stopPropagation(); endPick(); });
['pointerdown', 'pointerup', 'click'].forEach(ev => $('#pickBar').addEventListener(ev, e => e.stopPropagation()));

let noteFor = null, noteDoc = null;
function editNote(id, doc) {
  noteDoc = doc || R.doc;
  const m = ((doc ? doc.marks : marksOf()) || []).find(x => x.id === id);
  if (!m) return;
  if (R.playing) pause();
  noteFor = id;
  $('#noteQuote').textContent = m.text;
  const ta = $('#noteText');
  ta.value = m.note || '';
  ta.placeholder = t('note.ph');
  const d = $('#noteDialog');
  if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  setTimeout(() => ta.focus(), 50);
}
$('#noteSave').addEventListener('click', () => {
  const d = noteDoc || R.doc;
  const m = ((d && d.marks) || []).find(x => x.id === noteFor);
  if (m) { m.note = $('#noteText').value.trim().slice(0, 4000); markBack(m); saveMeta(d); if ($('#tocDialog').open) renderMarks(); if (!R.doc) renderNotesHome(); }
  $('#noteDialog').close();
});
$('#noteDialog').addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === e.currentTarget) e.currentTarget.close(); });
function renderMarks() {
  const list = $('#marksList'), ms = marksOf().filter(m => m.kind !== 'b'), total = R.T?.origCount || 1;
  $('#marksCount').textContent = ms.length ? ' ' + ms.length : '';
  $('#marksTools').hidden = !ms.length;
  if (!ms.length) { list.innerHTML = `<li class="toc-empty">${TX.esc(t('marks.none'))}</li>`; return; }
  list.innerHTML = ms.map(m => `<li data-id="${TX.esc(m.id)}" class="${m.kind === 'b' ? 'bm' : ''}"><button type="button" class="mk-go"><span class="q">${m.kind === 'b' ? '<svg class="ic"><use href="#i-bookmark"/></svg> ' + (m.page ? TX.esc(t('bm.page', { n: m.page })) + ' · ' : '') : ''}${TX.esc(m.text)}</span>` +
    (m.note ? `<span class="n">${TX.esc(m.note)}</span>` : '') +
    `<span class="p">${Math.round((m.o / total) * 100)}%</span></button><span class="mk-act">` +
    `<button type="button" class="btn ghost small icon-only mk-edit" title="${TX.esc(t('mark.addNote'))}"><svg class="ic"><use href="#i-edit"/></svg></button>` +
    `<button type="button" class="btn ghost small icon-only mk-del" title="${TX.esc(t('mark.delete'))}"><svg class="ic"><use href="#i-trash"/></svg></button></span></li>`).join('');
}
$('#marksList').addEventListener('click', e => {
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  const ms = marksOf(), m = ms.find(x => x.id === li.dataset.id);
  if (!m) return;
  if (e.target.closest('.mk-edit')) { $('#tocDialog').close(); editNote(m.id); return; }
  if (e.target.closest('.mk-del')) {
    const i = ms.indexOf(m);
    markGone(m);
    ms.splice(i, 1);
    saveMeta(R.doc); buildMarks(); render(); renderMarks();
    toast(t('mark.deleted'), { action: t('mark.undo'), onAction: () => { markBack(m); ms.splice(i, 0, m); saveMeta(R.doc); buildMarks(); render(); if ($('#tocDialog').open) renderMarks(); } });
    return;
  }
  $('#tocDialog').close();
  jumpToToken(TX.tokenOfOrig(R.T, m.o));
});
function setTab(tab) {
  tab = tab === 'marks' ? 'marks' : 'toc';
  $$('#tocDialog .tab').forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
  $('#tocList').hidden = tab !== 'toc';
  $('#marksPane').hidden = tab !== 'marks';
}
$$('#tocDialog .tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
function marksMarkdown() {
  const d = R.doc, T = R.T, ms = marksOf();
  const lines = [`# ${d.title}`];
  if (d.author) lines.push(`*${d.author}*`);
  lines.push('', `_${t('marks.from')} · ${new Date().toLocaleDateString(getLang() === 'sq' ? 'sq-AL' : 'en-GB')}_`, '');
  let last = -2;
  for (const m of ms) {
    const hi = T ? headAt(TX.tokenOfOrig(T, m.o)) : -1;
    if (hi !== last && hi >= 0) { lines.push(`## ${T.heads[hi].title}`, ''); last = hi; }
    lines.push(m.kind === 'b' ? '- 🔖 ' + (m.page ? t('bm.page', { n: m.page }) + ': ' : '') + m.text : '> ' + m.text.replace(/\s+/g, ' '));
    if (m.note) lines.push('', m.note);
    lines.push('');
  }
  return lines.join('\n');
}
$('#marksExport').addEventListener('click', () => {
  const blob = new Blob([marksMarkdown()], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (R.doc.title || 'FocusRead').replace(/[\\/:*?"<>|]+/g, '').slice(0, 60).trim() + ' — ' + t('marks.title') + '.md';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});
$('#marksCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(marksMarkdown()); toast(t('marks.copied')); }
  catch { toast(t('marks.copyFail')); }
});
$('#markBtn').addEventListener('click', e => { e.currentTarget.blur(); addMark(); });

/* ================= One-click bookmarks & notes on the home page ================= */
function curChapterTitle(tok) { const i = R.T ? headAt(tok ?? curTok()) : -1; return i >= 0 ? R.T.heads[i].title : ''; }
function pacerPage() { return S.mode === 'pacer' && R.pages && R.pageIdx >= 0; }
/** [firstTok, lastTok] of what is on screen as a page (guided page or book page), else null. */
function pageRange() {
  if (pacerPage()) return [R.pages[R.pageIdx], Math.max(0, R.pages[R.pageIdx + 1] - 1)];
  if (S.mode === 'book' && R.book && R.book.sec >= 0) { const b = R.book; return [b.starts[b.page], Math.max(b.starts[b.page], (b.starts[b.page + 1] ?? b.secs[b.sec + 1]) - 1)]; }
  return null;
}
/** The bookmark on the current page (page mode) or sentence (word mode), if any. */
function bmHere() {
  if (!R.T) return null;
  let a, b;
  const pr = pageRange();
  if (pr) { a = R.T.orig[pr[0]] ?? 0; b = R.T.orig[pr[1]] ?? a; }
  else { const [x, y] = sentenceRange(curTok()); a = R.T.orig[x]; b = R.T.orig[y]; }
  return marksOf().find(m => m.kind === 'b' && m.o >= a && m.o <= b) || null;
}
function updateBmUI() {
  const b = $('#bmBtn');
  if (!b || !R.T) return;
  const on = !!bmHere();
  if (b.classList.contains('on') !== on) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
}
// ---- Where I am: one tap on a sentence puts the ribbon there (book and guided page); coming back opens that sentence.
function spotTok() { const o = R.doc && R.doc.spot; return o == null || !R.T ? null : TX.tokenOfOrig(R.T, o); }
function setSpot(tok) {
  if (!R.T || !R.doc || tok == null) return;
  const [a] = sentenceRange(tok);
  const before = R.doc.spot ?? R.doc.pos ?? 0;
  R.doc.spot = R.T.orig[a] ?? 0; R.doc.pos = R.doc.spot; R.doc.posAt = Date.now();
  if (S.mode === 'book') spotCount(before, R.doc.spot);
  DB.putMeta(R.doc); Sync.schedule(1500);
  decorateSpot(); flashPick(a);
  try { navigator.vibrate && navigator.vibrate(8); } catch {}
}
/** The words between the old ribbon and the new one count as read (unless it was a jump, not reading). */
function spotCount(from, to) {
  const now = performance.now(), words = Math.max(0, to - from);
  const dt = Math.min(now - (R.spotAt || now), Math.max(4000, words * 600));
  R.spotAt = now;
  if (!words || dt < 800 || words / (dt / 60000) > 1200) return;
  R.started = true;
  R.sessionWords += words; R.sessionMs += dt; R.sinceBreakMs += dt;
  ST.addReading(words, dt);
}
/** Looked around? One tap brings you back to the ribbon. */
function spotBack(show) {
  let b = document.getElementById('spotBack');
  if (!b) {
    b = document.createElement('button');
    b.id = 'spotBack'; b.type = 'button'; b.className = 'spot-back';
    ['pointerdown', 'pointerup', 'touchstart', 'touchend'].forEach(ev => b.addEventListener(ev, e => e.stopPropagation(), { passive: true }));
    b.addEventListener('click', e => {
      e.stopPropagation();
      const tk = spotTok(); if (tk == null) return;
      const a = sentenceRange(tk)[0];
      jumpToToken(a, { keepPlaying: false });
      if (S.mode !== 'rsvp') setTimeout(() => flashPick(a), 80);
      try { navigator.vibrate && navigator.vibrate(8); } catch {}
    });
    $('#stageWrap').appendChild(b);
  }
  const en = (S.lang || document.documentElement.lang) === 'en';
  if (show) { const tk = spotTok(); b.innerHTML = `<svg class="ic"><use href="#i-bookmark"/></svg><span>${en ? 'Back to the ribbon' : 'Kthehu te shiriti'}</span>`; b.title = b.textContent; }
  b.hidden = !show;
}
const clearSpotMarks = () => {
  document.querySelectorAll('w.spot').forEach(w => w.classList.remove('spot'));
  document.querySelectorAll('mark.spot-run').forEach(m => m.replaceWith(...m.childNodes));
};
function decorateSpot() {
  let rib = document.getElementById('spotRibbon');
  if (!rib) { rib = document.createElement('div'); rib.id = 'spotRibbon'; rib.className = 'spot-ribbon'; rib.setAttribute('aria-hidden', 'true'); }
  const host = S.mode === 'book' ? els.bookSheet : S.mode === 'pacer' ? els.pacer : els.rsvp;
  const box = S.mode === 'book' ? els.bookCols : S.mode === 'pacer' ? els.page : null;
  const tk = spotTok(), pr = pageRange();
  if (S.mode === 'rsvp') { // words: the ribbon and an underlined sentence when the sentence on screen is your saved one
    const on = tk != null && sentenceRange(tk)[0] === sentenceRange(curTok())[0];
    if (rib.parentNode !== host) host.appendChild(rib);
    rib.hidden = !on; els.trail.classList.toggle('spot', on);
    spotBack(tk != null && !on && !R.playing);
    if (document.querySelector('mark.spot-run')) clearSpotMarks();
    return;
  }
  els.trail.classList.remove('spot');
  // the saved sentence counts as "on this page" when any part of it is here (it may start on the page before)
  const sr = tk != null ? sentenceRange(tk) : null;
  const on = !!(host && box && sr && pr && sr[0] <= pr[1] && sr[1] >= pr[0]);
  // "Back to the ribbon" only when you are checking pages, never while you read:
  // shown when you went back before the ribbon, or while flipping quickly ahead; staying on a page hides it.
  let away = tk != null && !on && !R.playing;
  if (away && S.mode === 'book' && pr && sr && sr[1] < pr[0]) {
    const B = R.book, since = performance.now() - (B && B.turnAt || 0);
    away = !!B && B.flips >= 2 && since < 4000;
    clearTimeout(R.sbT);
    if (away) R.sbT = setTimeout(() => { if (R.doc && S.mode === 'book') decorateSpot(); }, 4100 - since);
  }
  spotBack(away);
  if (host && rib.parentNode !== host) host.appendChild(rib);
  rib.hidden = !on;
  // v7.10: re-wrapping the sentence relays out the whole chapter — only do it when the sentence changed
  const want = on ? S.mode + ':' + sr[0] + '-' + sr[1] : '';
  if (want && box._spotKey === want && box.querySelector('mark.spot-run')) return;
  clearSpotMarks(); box && (box._spotKey = want);
  if (!on) return;
  const [a, b] = sr;
  const ws = [];
  for (let i = a; i <= b; i++) { const w = box.querySelector(`w[data-i="${i}"]`); if (w) { w.classList.add('spot'); ws.push(w); } }
  // one band over the whole sentence (spaces too), not a mark under each word
  const runs = [];
  for (const w of ws) { const last = runs[runs.length - 1]; if (last && last[0].parentNode === w.parentNode) last.push(w); else runs.push([w]); }
  for (const run of runs) {
    // a drop cap (first paragraph after a heading) keeps its first word out of the band
    const p0 = run[0].parentNode;
    if (run.length > 1 && p0.firstElementChild === run[0] && p0.previousElementSibling && p0.previousElementSibling.classList.contains('ph')) run.shift();
    try { const r = document.createRange(); r.setStartBefore(run[0]); r.setEndAfter(run[run.length - 1]); const m = document.createElement('mark'); m.className = 'spot-run'; r.surroundContents(m); } catch {}
  }
}
function toggleBookmark() {
  if (!R.T || !R.doc) return;
  const list = marksOf();
  const ex = bmHere();
  if (ex) {
    const i = list.indexOf(ex);
    markGone(ex); list.splice(i, 1); saveMeta(R.doc); render();
    toast(t('bm.removed'), { action: t('mark.undo'), onAction: () => { markBack(ex); list.splice(i, 0, ex); saveMeta(R.doc); render(); } });
    return;
  }
  const page = pacerPage(), pr = pageRange();
  const o = pr ? (R.T.orig[pr[0]] ?? 0) : R.T.orig[TX.sentenceStart(R.T, curTok())];
  const ws = R.T.words.slice(o, o + 40).filter(Boolean);
  const text = ws.slice(0, 16).join(' ') + (ws.length > 16 ? '…' : '');
  list.push({ id: DB.uid(), kind: 'b', o, oe: o, text, note: '', ch: curChapterTitle(), page: page ? R.pageIdx + 1 : 0, at: Date.now() });
  list.sort((x, y) => x.o - y.o);
  saveMeta(R.doc); render();
  hud(t('bm.saved'));
}
$('#bmBtn').addEventListener('click', e => { e.currentTarget.blur(); toggleBookmark(); });

let nhFilter = 'all', nhLimit = 6, nhFolder = null;
const docHue = ttl => { let hue = 0; for (const ch of String(ttl || '')) hue = (hue * 31 + ch.codePointAt(0)) % 360; return hue; };
/**
 * Saved sentences and bookmarks on the home page, kept in one folder per book.
 * The folder grid shows every book that has something saved; opening one lists only that book's items.
 */
function renderNotesHome() {
  const sec = $('#notesHome');
  if (!sec) return;
  const all = [];
  for (const d of libDocs || []) for (const m of d.marks || []) if (m.kind !== 'b') all.push({ d, m });
  sec.hidden = !all.length;
  const head = $('#nhFolderHead');
  if (!all.length) { nhFolder = null; head.hidden = true; return; }
  if (nhFolder && !all.some(x => x.d.id === nhFolder)) nhFolder = null;
  const scope = nhFolder ? all.filter(x => x.d.id === nhFolder) : all;
  const nB = scope.filter(x => x.m.kind === 'b').length, nM = scope.length - nB;
  if ((nhFilter === 'b' && !nB) || (nhFilter === 'h' && !nM)) nhFilter = 'all';
  $$('#nhFilter button').forEach(b => {
    const f = b.dataset.f, n = f === 'all' ? scope.length : f === 'b' ? nB : nM;
    b.classList.toggle('on', f === nhFilter);
    b.querySelector('.c').textContent = n;
    b.hidden = f !== 'all' && (!n || !nB || !nM);
  });
  const keep = x => nhFilter === 'all' || (nhFilter === 'b') === (x.m.kind === 'b');
  const box = $('#nhList');
  if (!nhFolder) {
    // folder grid
    head.hidden = true;
    box.classList.add('folders');
    const byDoc = new Map();
    for (const x of all) { if (!keep(x)) continue; if (!byDoc.has(x.d.id)) byDoc.set(x.d.id, { d: x.d, items: [] }); byDoc.get(x.d.id).items.push(x.m); }
    const folders = [...byDoc.values()].map(f => ({ ...f, last: Math.max(...f.items.map(m => m.at || 0)) })).sort((a, b) => b.last - a.last);
    box.innerHTML = folders.map(({ d, items, last }) => {
      const nb = items.filter(m => m.kind === 'b').length, nm = items.length - nb;
      const latest = items.slice().sort((a, b) => (b.at || 0) - (a.at || 0))[0];
      return `<button type="button" class="nh-folder" data-doc="${TX.esc(d.id)}" style="--h:${docHue(d.title)}">` +
        `<span class="nf-tab" aria-hidden="true"></span>` +
        `<span class="nf-top"><svg class="ic"><use href="#i-folder"/></svg><b class="nf-n">${items.length}</b></span>` +
        `<span class="nf-t">${TX.esc(d.title)}</span>` +
        `<span class="nf-q">${TX.esc(latest ? latest.text : '')}</span>` +
        `<span class="nf-m">${TX.esc(t('notes.inFolder', { a: nm, b: nb }))} · ${TX.esc(relDay(last || Date.now()))}</span></button>`;
    }).join('');
    return;
  }
  // inside one book's folder
  box.classList.remove('folders');
  const d = (libDocs || []).find(x => x.id === nhFolder);
  head.hidden = false;
  head.innerHTML = `<button type="button" class="btn ghost small nf-back" id="nhBack"><svg class="ic"><use href="#i-left"/></svg>${TX.esc(t('notes.back'))}</button>` +
    `<span class="nf-cur" style="--h:${docHue(d.title)}"><svg class="ic"><use href="#i-folder"/></svg><span>${TX.esc(d.title)}</span></span>` +
    `<button type="button" class="btn small" id="nhOpenBook"><svg class="ic"><use href="#i-play"/></svg>${TX.esc(t('notes.openBook'))}</button>`;
  const items = scope.filter(keep).sort((a, b) => (a.m.o || 0) - (b.m.o || 0));
  box.innerHTML = items.slice(0, nhLimit).map(({ d, m }) => {
    const bm = m.kind === 'b';
    const pct = d.words ? Math.min(100, Math.round((m.o / d.words) * 100)) : 0;
    const where = [m.page ? t('bm.page', { n: m.page }) : '', m.ch || '', pct + '%', relDay(m.at || Date.now())].filter(Boolean).join(' · ');
    return `<article class="nh-item${bm ? ' bm' : ''}" data-doc="${TX.esc(d.id)}" data-id="${TX.esc(m.id)}"><button type="button" class="nh-open">` +
      `<span class="nh-book"><svg class="ic"><use href="#${bm ? 'i-bookmark' : 'i-star'}"/></svg><span>${TX.esc(where)}</span></span>` +
      `<span class="nh-q">${TX.esc(m.text)}</span>` + (m.note ? `<span class="nh-n">${TX.esc(m.note)}</span>` : '') +
      `</button>` +
      `<span class="nh-act"><button type="button" class="btn ghost small icon-only nh-edit" title="${TX.esc(t(m.note ? 'note.title' : 'mark.addNote'))}" aria-label="${TX.esc(t(m.note ? 'note.title' : 'mark.addNote'))}"><svg class="ic"><use href="#i-edit"/></svg></button>` +
      `<button type="button" class="btn ghost small icon-only nh-del" title="${TX.esc(t('mark.delete'))}" aria-label="${TX.esc(t('mark.delete'))}"><svg class="ic"><use href="#i-trash"/></svg></button></span></article>`;
  }).join('') + (items.length > nhLimit ? `<button type="button" class="btn ghost small nh-more" id="nhMore">${TX.esc(t('notes.more', { n: items.length - nhLimit }))}</button>` : '');
}
$('#nhFolderHead').addEventListener('click', e => {
  if (e.target.closest('#nhBack')) { nhFolder = null; nhLimit = 6; renderNotesHome(); $('#notesHome').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
  if (e.target.closest('#nhOpenBook') && nhFolder) openReader(nhFolder);
});
async function openMark(docId, markId) {
  await openReader(docId);
  if (!R.T || !R.doc || R.doc.id !== docId) return;
  const m = marksOf().find(x => x.id === markId);
  if (m) jumpToToken(TX.tokenOfOrig(R.T, m.o), { keepPlaying: false });
}
$('#nhList').addEventListener('click', e => {
  if (e.target.closest('#nhMore')) { nhLimit += 12; renderNotesHome(); return; }
  const fo = e.target.closest('.nh-folder');
  if (fo) { nhFolder = fo.dataset.doc; nhLimit = 12; renderNotesHome(); $('#notesHome').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
  const it = e.target.closest('.nh-item');
  if (!it) return;
  const d = (libDocs || []).find(x => x.id === it.dataset.doc);
  const ms = (d && d.marks) || [];
  const m = ms.find(x => x.id === it.dataset.id);
  if (e.target.closest('.nh-edit')) { if (m) editNote(m.id, d); return; }
  if (e.target.closest('.nh-del')) {
    if (!m) return;
    const i = ms.indexOf(m);
    ms.splice(i, 1);
    saveMeta(d);
    it.classList.add('gone');
    setTimeout(renderNotesHome, 180);
    toast(t(m.kind === 'b' ? 'bm.removed' : 'mark.deleted'), { action: t('mark.undo'), onAction: () => { ms.splice(Math.min(i, ms.length), 0, m); saveMeta(d); renderNotesHome(); } });
    return;
  }
  if (e.target.closest('.nh-open')) openMark(it.dataset.doc, it.dataset.id);
});
$$('#nhFilter button').forEach(b => b.addEventListener('click', () => { nhFilter = b.dataset.f; nhLimit = 6; renderNotesHome(); }));

/* The "continue reading" card at the top of the home page was removed (v6.6). */

async function init() {
  setLang(S.lang);
  translateDOM();
  applySettings();
  try { textInput.value = localStorage.getItem(DRAFT_KEY) || v5Text || ''; } catch {}
  updateComposerMeta();
  updateOnline();
  if (firstRun) {
    saveSettings();
    const docs = await DB.listDocs();
    if (!docs.length && !localStorage.getItem('focusread_seeded')) {
      if (v5Text.trim()) await addDoc({ text: v5Text, kind: 'text' });
      await addDoc({ title: t('sample.title'), text: SAMPLE[S.lang] || SAMPLE.sq, kind: 'demo' });
      try { localStorage.setItem('focusread_seeded', '1'); } catch {}
    }
  }
  await renderLibrary();
  renderStats();
  // The "continue your last read?" pop-up at the bottom was removed (v6.5):
  // the Continue card at the top of the home page does the same with one tap.
  await handleIncoming();
  DB.ensurePersistence();
  Sync.onRemoteChange(() => { renderStats(); if (!R.T) renderLibrary(); });
  Sync.onStatus(updateSyncBadge);
  Sync.start();
}
init();

// expose for debugging
// one tap between your light and your dark theme (the last ones you used)
function toggleDark() {
  const cur = resolvedTheme(), dark = cur === 'dark' || cur === 'oled' || cur === 'night';
  if (S.theme !== 'auto') S[dark ? 'lastDark' : 'lastLight'] = S.theme;
  setSetting('theme', dark ? (S.lastLight || 'light') : (S.lastDark || 'dark'));
}
window.FocusRead = { S, R, openReader, handleFiles, toggleDark, turnPage };
