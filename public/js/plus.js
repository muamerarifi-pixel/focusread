// FocusRead v6.8 — add-on layer (loaded by boot.js after extras.js):
//  • Settings: sliders that only move on a sideways drag (never while scrolling), with haptic ticks
//  • Background dimming (separately for day and night), full screen mode, day/night by the sun in Kosovo
//  • Reader: a floating page bar (page X / Y in every mode, %, time left, today, streak) with a "+1" on each page,
//    a "you stopped here" ribbon when you come back, a classic book look
//  • No accidental taps while scrolling the home page or the settings; one-handed layout on phones
import * as ST from './stats.js';
import * as I18N from './i18n.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const en = () => { try { return I18N.getLang() === 'en'; } catch { return document.documentElement.lang === 'en'; } };
const L = (sq, e) => (en() ? e : sq);
const get = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
const put = (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} };
const haptic = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const NIGHT = ['dark', 'oled', 'night'];
const isNight = () => NIGHT.includes(document.documentElement.dataset.theme);
const WPP = 250; // the same "page" as extras.js: 250 words in every reading mode

/* ---------- sliders (v7.0) ----------
   A sideways drag changes the value. A finger that scrolls the settings up or down never does:
   the browser keeps vertical pans (touch-action: pan-y) and a tap on the track does nothing. */
const KNOBS = [];
const refreshKnobs = () => KNOBS.forEach(f => f());
const PAD = 15; // thumb radius: the thumb's centre runs from PAD to width - PAD
function knob(input, fmt = v => String(v)) {   // (name kept: every range in the settings goes through here)
  if (!input || input.dataset.knob) return;
  input.dataset.knob = '1';
  const min = +input.min, max = +input.max, step = +input.step || 1, span = (max - min) || 1;
  const nSteps = Math.round(span / step), dots = nSteps <= 10 ? nSteps + 1 : 5;
  const el = document.createElement('div');
  el.className = 'fr-sl'; el.tabIndex = 0; el.setAttribute('role', 'slider');
  el.setAttribute('aria-valuemin', min); el.setAttribute('aria-valuemax', max);
  const al = input.getAttribute('aria-label'); if (al) el.setAttribute('aria-label', al);
  let dh = '';
  for (let i = 0; i < dots; i++) dh += `<i style="--p:${(i / (dots - 1)).toFixed(4)}"></i>`;
  el.innerHTML = `<span class="sl-track"><span class="sl-fill"></span>${dh}</span><span class="sl-thumb"><b class="sl-tip"></b></span>`;
  input.classList.add('fr-src'); input.tabIndex = -1;
  input.after(el);
  const row = input.closest('label, .shadow-row, .range-row, .fr-row');
  if (row) row.classList.add('has-sl');
  let val = null; // a value next to the label, for rows that don't show one of their own
  if (row && !row.querySelector('output, .range-out, .sr-o') && !(row.closest('label') || row).querySelector('output')) { val = document.createElement('b'); val.className = 'sl-val'; el.before(val); }
  const tip = el.querySelector('.sl-tip'), track = el.firstChild;
  const show = () => {
    const v = +input.value, t = fmt(v);
    el.style.setProperty('--f', clamp((v - min) / span, 0, 1));
    tip.textContent = t; if (val) val.textContent = t;
    el.setAttribute('aria-valuenow', v); el.setAttribute('aria-valuetext', t);
  };
  const set = v => {
    v = +clamp(min + Math.round((v - min) / step) * step, min, max).toFixed(4);
    if (v === +input.value) return;
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    haptic(5); show();
  };
  const valueAt = x => { const r = track.getBoundingClientRect(); return min + clamp((x - r.left - PAD) / Math.max(1, r.width - 2 * PAD), 0, 1) * span; };
  let st = null; // { x, y, id, mouse, grab: started on the thumb, v0 }
  const begin = e => {
    st.on = true;
    try { el.setPointerCapture(e.pointerId); } catch {}
    el.classList.add('dragging'); haptic(4);
    if (!st.grab) set(valueAt(e.clientX));
  };
  const move = e => {
    if (st.grab) { const r = track.getBoundingClientRect(); set(st.v0 + (e.clientX - st.x) / Math.max(1, r.width - 2 * PAD) * span); }
    else set(valueAt(e.clientX));
  };
  el.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    const th = el.lastChild.getBoundingClientRect();
    const grab = Math.abs(e.clientX - (th.left + th.width / 2)) <= th.width * 0.9;
    st = { x: e.clientX, y: e.clientY, id: e.pointerId, mouse: e.pointerType === 'mouse', grab, v0: +input.value, on: false };
    if (st.mouse) { e.preventDefault(); el.focus({ preventScroll: true }); begin(e); }  // a mouse can't be scrolling: act at once
  });
  el.addEventListener('pointermove', e => {
    if (!st || e.pointerId !== st.id) return;
    if (!st.on) {
      const dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) { st = null; return; }   // scrolling the page: hands off
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
      begin(e);
    }
    e.preventDefault(); move(e);
  });
  const end = () => { if (st && st.on) haptic(3); st = null; el.classList.remove('dragging'); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', e => { if (e.target === el) end(); });   // (the thumb handing capture to the slider isn't an end)
  el.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });
  el.addEventListener('keydown', e => { const k = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 }[e.key]; if (k) { e.preventDefault(); set(+input.value + k * step); } else if (e.key === 'Home') set(min); else if (e.key === 'End') set(max); });
  input.addEventListener('input', show);
  KNOBS.push(show); show();
}
function initKnobs(tries = 0) {
  const pct = v => v + '%';
  knob($('#wpmRange')); knob($('#sizeRange')); knob($('#pageSizeRange')); knob($('#inkAlphaRange'), pct);
  const sr = $('.sr-r');
  if (sr) knob(sr, pct); else if (tries < 40) return setTimeout(() => initKnobs(tries + 1), 150);
  knob($('#dimRange'), pct);
}

/* ---------- a small switch / knob row in the settings ---------- */
function makeSwitch(id, sq, e, checked, onChange) {
  const lab = document.createElement('label'); lab.className = 'switch'; lab.id = id;
  const inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = checked;
  const sp = document.createElement('span'); sp.dataset.sq = sq; sp.dataset.en = e; sp.textContent = L(sq, e);
  lab.append(inp, sp);
  inp.addEventListener('change', () => onChange(inp.checked));
  return lab;
}
const relabel = () => { $$('[data-sq]').forEach(s => { s.textContent = L(s.dataset.sq, s.dataset.en); }); $$('[data-tsq]').forEach(b => { const v = L(b.dataset.tsq, b.dataset.ten); b.title = v; b.setAttribute('aria-label', v); }); };

/* ---------- background dimming, day and night apart ---------- */
const DIMV = ['--bg', '--bg2', '--card', '--soft']; // never touch --paper-tone: paper.js owns it, and --bg follows it
const dimKey = () => (isNight() ? 'focusread_dim_n' : 'focusread_dim_d');
function applyDim() {
  const h = document.documentElement;
  DIMV.forEach(v => h.style.removeProperty(v));
  const d = clamp(+get(dimKey(), 0) || 0, 0, 70);
  const r = $('#dimRange'); if (r) { r.value = String(d); refreshKnobs(); }
  const s = $('#dimFor'); if (s) s.textContent = isNight() ? L('për natën', 'for night') : L('për ditën', 'for day');
  if (!d) return;
  const cs = getComputedStyle(h);
  DIMV.forEach(v => { const c = cs.getPropertyValue(v).trim(); if (c) h.style.setProperty(v, `color-mix(in srgb, ${c} ${100 - d}%, #000)`); });
}

/* ---------- day and night by the sun in Kosovo (Prishtinë); the reader stays in control ---------- */
function sunTimes(d = new Date(), lat = 42.66, lon = 21.17) {
  const rad = Math.PI / 180;
  const n = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5);
  const g = 2 * Math.PI / 365 * (n - 1);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = Math.acos(Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(dec)) - Math.tan(lat * rad) * Math.tan(dec)) / rad;
  const noon = 720 - 4 * lon - eqt, base = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return [base + (noon - 4 * ha) * 6e4, base + (noon + 4 * ha) * 6e4];
}
let autoClick = false;
function sunTheme(force = false) {
  if (get('focusread_autosun', '1') !== '1') return;
  const now = Date.now(), [rise, set] = sunTimes(new Date()), day = now >= rise && now < set;
  const d = new Date(), mark = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}:${day ? 'd' : now < rise ? 'a' : 'b'}`;
  if (!force && get('focusread_sunmark', '') === mark) return; // only when the sun rises or sets: a choice made by hand holds until then
  put('focusread_sunmark', mark);
  const want = day ? get('focusread_daytheme', 'light') : get('focusread_nighttheme', 'dark');
  if (document.documentElement.dataset.theme === want) return;
  const b = $(`[data-theme-opt="${want}"]`);
  if (b) { autoClick = true; try { b.click(); } finally { autoClick = false; } }
}

/* ---------- full screen ---------- */
const fsOn = () => get('focusread_fs', '0') === '1';
const enterFS = () => {}; // (v7.5: full screen removed)
try { localStorage.setItem('focusread_fs', '0'); } catch {}
if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});

/* ---------- settings additions ---------- */
function initSettings() {
  const grid = $('#themeGrid');
  if (grid && !$('#sunSwitch')) {
    const dimRow = document.createElement('label');
    dimRow.className = 'field fr-row';
    dimRow.innerHTML = `<span><span data-sq="Errësimi i sfondit" data-en="Background dimming"></span><small id="dimFor" class="muted"></small></span><input id="dimRange" type="range" min="0" max="70" step="5" value="0">`;
    const sun = makeSwitch('sunSwitch', 'Ditë e natë sipas diellit në Kosovë', 'Day and night by the sun in Kosovo', get('focusread_autosun', '1') === '1', on => { put('focusread_autosun', on ? '1' : '0'); if (on) sunTheme(true); });
    grid.after(sun); sun.after(dimRow);
    dimRow.querySelector('input').addEventListener('input', e => { put(dimKey(), e.target.value); applyDim(); });
    grid.addEventListener('click', e => {
      const b = e.target.closest('[data-theme-opt]');
      if (!b || autoClick) return;
      const t = b.dataset.themeOpt;
      if (NIGHT.includes(t)) put('focusread_nighttheme', t); else if (t !== 'auto') put('focusread_daytheme', t);
    });
  }
  const modeSeg = $('#modeSeg');
  if (modeSeg && !$('#classicSwitch')) {
    const cl = makeSwitch('classicSwitch', 'Libër tradicional — faqe, paragrafë e shkronja si në libër të shtypur', 'Traditional book — pages, paragraphs and type like a printed book', get('focusread_classic', '1') === '1', on => {
      put('focusread_classic', on ? '1' : '0'); document.documentElement.toggleAttribute('data-classic', on);
      if (on) { const b = $('#modeSeg [data-mode="book"]'); if (b) b.click(); }
    });
    const fs = makeSwitch('fsSwitch', 'Ekran i plotë — fsheh shiritin e statusit dhe atë të navigimit', 'Full screen — hides the status bar and the navigation bar', fsOn(), on => {
      put('focusread_fs', on ? '1' : '0'); if (on) enterFS(); else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    });
    fs.hidden = true; // (v7.5: full screen removed — it stuttered)
    modeSeg.after(cl, fs);
  }
  document.documentElement.toggleAttribute('data-classic', get('focusread_classic', '1') === '1');
  const sheet = $('#settingsSheet');
  if (sheet) {
    // every small change can be felt
    sheet.addEventListener('click', e => { if (e.target.closest('button, input, select, .switch')) haptic(10); });
    sheet.addEventListener('change', e => { if (e.target.matches('select')) haptic(10); });
    new MutationObserver(() => { if (!sheet.hidden) { refreshKnobs(); applyDim(); } }).observe(sheet, { attributes: true, attributeFilter: ['hidden'] });
    sheet.addEventListener('click', () => setTimeout(refreshKnobs, 0));
  }
  const lb = $('#langBtn'); if (lb) lb.addEventListener('click', () => setTimeout(() => { relabel(); applyDim(); }, 80));
  const ls = $('select[data-set="lang"]'); if (ls) ls.addEventListener('change', () => setTimeout(() => { relabel(); applyDim(); }, 80));
}

/* ---------- import from Google Drive (a share link; the server fetches the public file) ---------- */
function driveLinks(text) {
  const out = [];
  for (const raw of String(text || '').split(/[\s,]+/)) {
    const u = raw.trim(); if (!u) continue;
    let m;
    if (/\/drive\/(?:u\/\d+\/)?folders\//.test(u)) { out.push({ err: 'folder', u }); continue; }
    if (/docs\.google\.com\/spreadsheets\//.test(u)) { out.push({ err: 'sheet', u }); continue; }
    if ((m = /docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([\w-]{20,})/.exec(u))) out.push({ id: m[1], t: 'doc' });
    else if ((m = /docs\.google\.com\/presentation\/(?:u\/\d+\/)?d\/([\w-]{20,})/.exec(u))) out.push({ id: m[1], t: 'slides' });
    else if ((m = /\/file\/(?:u\/\d+\/)?d\/([\w-]{20,})/.exec(u)) || (m = /[?&]id=([\w-]{20,})/.exec(u))) out.push({ id: m[1], t: 'file' });
    else if (/google\.com/.test(u)) out.push({ err: 'bad', u });
  }
  return out;
}
const DRIVE_ERR = {
  private: () => L('Skedari nuk është i ndarë. Në Drive: Ndaj → Qasja e përgjithshme → "Kushdo me lidhjen".', 'The file isn\'t shared. In Drive: Share → General access → "Anyone with the link".'),
  not_found: () => L('Skedari nuk u gjet. Kontrollo lidhjen.', 'File not found. Check the link.'),
  too_big: () => L('Skedari është mbi 80 MB.', 'The file is over 80 MB.'),
  folder: () => L('Kjo është lidhje dosjeje. Hap dosjen dhe kopjo lidhjen e skedarit.', 'That\'s a folder link. Open the folder and copy the file\'s link.'),
  sheet: () => L('Fletët e Google nuk mund të lexohen këtu.', 'Google Sheets can\'t be read here.'),
  bad: () => L('Kjo nuk duket si lidhje skedari nga Google Drive.', 'That doesn\'t look like a Google Drive file link.'),
  net: () => L('S\'ka lidhje me internetin. Provo sërish.', 'No connection. Try again.'),
};
async function importDrive(links, say) {
  const FR = window.FocusRead;
  let ok = 0;
  for (const l of links) {
    if (l.err) { say(DRIVE_ERR[l.err]()); continue; }
    say(L('Po shkarkohet nga Google Drive…', 'Downloading from Google Drive…'), true);
    let res;
    try { res = await fetch(`/api/drive?id=${encodeURIComponent(l.id)}&t=${l.t}`, { cache: 'no-store' }); }
    catch { say(DRIVE_ERR.net()); continue; }
    if (!res.ok) { let e = 'bad'; try { e = (await res.json()).error || e; } catch {} say((DRIVE_ERR[e] || DRIVE_ERR.net)()); continue; }
    let name = 'Google Drive'; try { name = decodeURIComponent(res.headers.get('x-file-name') || name); } catch {}
    const blob = await res.blob();
    await FR.handleFiles([new File([blob], name, { type: blob.type || res.headers.get('content-type') || '' })]);
    ok++;
  }
  return ok;
}
function initDrive() {
  const fileBtn = $('#fileBtn');
  if (!fileBtn || $('#driveBtn')) return;
  const b = document.createElement('button');
  b.id = 'driveBtn'; b.type = 'button'; b.className = 'btn ghost small';
  b.innerHTML = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 7.97M12 12v7m-3-3 3 3 3-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span data-sq="Drive" data-en="Drive">Drive</span>';
  b.title = L('Importo nga Google Drive', 'Import from Google Drive');
  fileBtn.after(b);
  b.addEventListener('click', () => {
    const d = document.createElement('div');
    d.className = 'fr-dlg'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
    d.innerHTML = `<div class="fr-dlg-card">
      <h3>${L('Importo nga Google Drive', 'Import from Google Drive')}</h3>
      <p class="muted small">${L('Në Drive: Ndaj → "Kushdo me lidhjen" → Kopjo lidhjen. Pastaj ngjite këtu (mund edhe disa, një për rresht). PDF, EPUB, Word, TXT ose Google Docs.', 'In Drive: Share → "Anyone with the link" → Copy link. Paste it here (several work too, one per line). PDF, EPUB, Word, TXT or Google Docs.')}</p>
      <textarea rows="3" spellcheck="false" autocomplete="off" placeholder="https://drive.google.com/file/d/…"></textarea>
      <p class="fr-dlg-msg small" aria-live="polite"></p>
      <div class="fr-dlg-act"><button type="button" class="btn ghost small" data-x>${L('Anulo', 'Cancel')}</button><button type="button" class="btn small" data-go>${L('Importo', 'Import')}</button></div>
    </div>`;
    document.body.appendChild(d);
    const ta = d.querySelector('textarea'), msg = d.querySelector('.fr-dlg-msg'), go = d.querySelector('[data-go]');
    const close = () => d.remove();
    const say = (t, busy) => { msg.textContent = t; msg.classList.toggle('busy', !!busy); };
    d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-x]')) close(); });
    d.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    setTimeout(() => ta.focus(), 30);
    go.addEventListener('click', async () => {
      const links = driveLinks(ta.value);
      if (!links.length) { say(DRIVE_ERR.bad()); return; }
      go.disabled = true;
      const ok = await importDrive(links, say);
      go.disabled = false;
      if (ok && ok === links.length) close();
    });
  });
}

/* ---------- v7.8: home — with books, a small "add text" row on top instead of the big welcome; backups in settings ---------- */
function initHome() {
  const lib = $('#libList'), dz = $('#dropZone'), hero = $('.hero'), ta = $('#textInput');
  if (!lib || !dz) return;
  // v7.9: with books, the add-text box is a small field + icons in the library header (it grows when you use it)
  const head = $('.lib-head'), search = head && head.querySelector('.search'), startRow = $('.start-row');
  const anchor = document.createComment('composer'), anchor2 = document.createComment('start');
  dz.after(anchor); if (startRow) startRow.after(anchor2);
  const ph0 = ta ? ta.placeholder : '';
  const arrange = () => {
    const has = !!lib.querySelector('.doc');
    document.body.classList.toggle('has-books', has);
    if (has && head && dz.parentNode !== head) { (search || null) ? search.before(dz) : head.appendChild(dz); if (startRow) dz.appendChild(startRow); }
    else if (!has && dz.parentNode === head) { anchor.before(dz); if (startRow) anchor2.before(startRow); }
    if (ta) ta.placeholder = has ? L('Ngjit tekst ose importo…', 'Paste text or import…') : (ta.placeholder === L('Ngjit tekst ose importo…', 'Paste text or import…') ? ph0 : ta.placeholder);
  };
  new MutationObserver(arrange).observe(lib, { childList: true });
  arrange();
  if (ta) { const f = () => dz.classList.toggle('filled', !!ta.value.trim()); ta.addEventListener('input', f); f(); }
  const foot = $('.lib-foot'), body = $('#settingsSheet .sheet-body');
  if (foot && body && !$('#backupGroup')) {
    const g = document.createElement('section'); g.className = 'set-group'; g.id = 'backupGroup';
    g.innerHTML = `<h3 data-sq="Kopje rezervë" data-en="Backup">${L('Kopje rezervë', 'Backup')}</h3>`;
    g.appendChild(foot); body.appendChild(g);
  }
}

/* ---------- no accidental taps while scrolling (home page, settings, lists) ---------- */
function initTapGuard() {
  let lastScroll = 0, moved = false, sx = 0, sy = 0;
  const guarded = t => t && t.closest && !t.closest('#readerView') ;
  document.addEventListener('scroll', e => { if (guarded(e.target === document ? document.body : e.target)) lastScroll = Date.now(); }, { capture: true, passive: true });
  document.addEventListener('touchstart', e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; moved = e.touches.length > 1 || Date.now() - lastScroll < 120; }, { capture: true, passive: true });
  document.addEventListener('touchmove', e => { const t = e.touches[0]; if (Math.hypot(t.clientX - sx, t.clientY - sy) > 10) moved = true; }, { capture: true, passive: true });
  document.addEventListener('click', e => {
    if (e.detail === 0 || !guarded(e.target) || e.target.closest('.fr-sl')) return;
    if (moved || Date.now() - lastScroll < 220) { e.preventDefault(); e.stopPropagation(); moved = false; }
  }, true);
}

/* ---------- reader: floating page bar, +1 per page, "you stopped here" ---------- */
function state() {
  const FR = window.FocusRead, R = FR && FR.R, T = R && R.T;
  if (!T || !R.doc || !R.starts || !T.orig || !T.origCount) return null;
  const c = clamp(R.ci | 0, 0, R.starts.length - 2);
  const S = FR.S || {};
  // book mode: progress is where the ribbon is (a tapped sentence), not the page you are looking at
  const idx = S.mode === 'book' ? clamp(R.doc.spot ?? R.doc.pos ?? 0, 0, T.origCount) : (T.orig[R.starts[c]] || 0), total = T.origCount;
  const pages = Math.max(1, Math.ceil(total / WPP)), page = Math.min(pages, Math.floor(idx / WPP) + 1);
  return { R, idx, total, pages, page, pct: idx >= total - 12 ? 100 : Math.min(99, Math.floor(idx / total * 100)), id: R.doc.id, pos: R.doc.pos, posAt: R.doc.posAt };
}
const fmtMin = m => (m < 1 ? '<1 min' : m < 60 ? Math.round(m) + ' min' : Math.floor(m / 60) + ' h ' + Math.round(m % 60) + ' min');
function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (!t || m < 1) return L('tani', 'just now');
  if (m < 60) return L(`${m} min më parë`, `${m} min ago`);
  const h = Math.round(m / 60); if (h < 24) return L(`${h} orë më parë`, `${h} h ago`);
  const d = Math.round(h / 24); return L(`${d} ditë më parë`, `${d} days ago`);
}
function initPageBar() {
  const stage = $('#stageWrap'), reader = $('#readerView');
  if (!stage || !reader) return;
  const bar = document.createElement('div');
  bar.className = 'fr-bar'; bar.setAttribute('aria-live', 'polite');
  bar.innerHTML = '<span class="fb-pg"></span><span class="fb-track"><i></i></span>' +
    '<span class="fb-modes" role="group">' + [['rsvp', 'i-words', 'Fjalë', 'Words'], ['pacer', 'i-page', 'Faqe', 'Page'], ['book', 'i-book', 'Libër', 'Book']]
      .map(([m, ic, sq, e]) => `<button type="button" data-m="${m}" data-tsq="${sq}" data-ten="${e}" title="${L(sq, e)}" aria-label="${L(sq, e)}"><svg class="ic"><use href="#${ic}"/></svg></button>`).join('') + '</span>';
  // v7.8: in book mode this is the only bar — the useful buttons of the bottom bar move here
  const proxy = (cls, id, ic, sq, en, inner) => `<button type="button" class="fb-x ${cls}" data-proxy="${id}" title="${L(sq, en)}" aria-label="${L(sq, en)}">${inner || `<svg class="ic"><use href="#${ic}"/></svg>`}</button>`;
  bar.insertAdjacentHTML('afterbegin', proxy('fb-nav', 'prevBtn', 'i-left', 'Faqja e mëparshme', 'Previous page') + proxy('', 'markBtn', 'i-star', 'Ruaj fjali', 'Save sentences'));
  bar.insertAdjacentHTML('beforeend', '<span class="fb-size">' + proxy('', 'sizeDownBtn', '', 'Më e vogël', 'Smaller', 'A<b>−</b>') + proxy('', 'sizeUpBtn', '', 'Më e madhe', 'Larger', 'A<b>+</b>') + '</span>' + proxy('fb-nav', 'nextBtn', 'i-right', 'Faqja tjetër', 'Next page'));
  bar.addEventListener('click', e => { const b = e.target.closest('[data-proxy]'); if (!b) return; e.stopPropagation(); const t = document.getElementById(b.dataset.proxy); if (t) t.click(); });
  ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown'].forEach(ev => bar.querySelectorAll('.fb-x').forEach(x => x.addEventListener(ev, e => e.stopPropagation(), { passive: true })));
  stage.appendChild(bar);
  // switch the reading mode with one tap, right by the thumb
  const modes = bar.querySelector('.fb-modes');
  ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown'].forEach(ev => modes.addEventListener(ev, e => e.stopPropagation(), { passive: true }));
  modes.addEventListener('click', e => {
    e.stopPropagation();
    const b = e.target.closest('[data-m]'), cur = (window.FocusRead && window.FocusRead.S || {}).mode;
    if (!b || b.dataset.m === cur) return;
    const seg = $(`#modeSeg [data-mode="${b.dataset.m}"]`);
    if (seg) { seg.click(); haptic(10); tick(); }
  });
  const here = document.createElement('div');
  here.className = 'fr-here'; here.hidden = true;
  let last = { id: '', page: 0 }, hereFor = 0, session = 0;
  const tick = () => {
    if (reader.hidden) { last.id = ''; return; }
    const st = state(); if (!st) return;
    const S = (window.FocusRead && window.FocusRead.S) || {};
    const left = (st.total - st.idx) / (S.wpm || 300) * (S.smart === false ? 1 : 1.18);
    let today = 0, streak = 0;
    try { today = Math.floor((ST.today().w || 0) / WPP); streak = ST.streak(); } catch {}
    const next = Math.min(100, Math.floor(st.pct / 10) * 10 + 10);
    const toNext = Math.max(1, Math.ceil((Math.ceil(next / 100 * st.total) - st.idx) / WPP));
    modes.querySelectorAll('[data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === S.mode));
    bar.querySelector('.fb-pg').innerHTML = `<span class="fb-lbl">${L('Faqja', 'Page')} </span><b>${st.page}</b> / ${st.pages}`;
    bar.querySelector('.fb-track i').style.width = st.pct + '%';  // (v7.1: only page, progress and modes here — the rest is already in the top bar)
    if (st.id !== last.id) {              // a book was just opened: show where you stopped
      last = { id: st.id, page: st.page }; session = 0;
      if (false) {
        const host = $('#book') && !$('#book').hidden ? $('#bookSheet') : $('#pacer') && !$('#pacer').hidden ? $('#pacer') : stage;
        host.appendChild(here);
        here.innerHTML = `<b>🔖 ${L('Këtu ndalove', 'You stopped here')}</b><small>${L('Faqja', 'Page')} ${st.page} · ${ago(st.posAt)}</small>`;
        here.hidden = false; here.classList.remove('out'); hereFor = st.page;
        setTimeout(() => here.classList.add('out'), 6000);
      }
      return;
    }
    if (st.page !== last.page) {
      if (hereFor && st.page !== hereFor) { here.classList.add('out'); hereFor = 0; }
      if (st.page > last.page && st.page - last.page <= 60) {    // pages read: a small reward
        const n = st.page - last.page, was = session;
        session += n;
        const pop = document.createElement('span');
        pop.className = 'fb-pop';
        const big = [5, 10, 20, 30, 50, 75, 100].some(m => was < m && session >= m);
        pop.textContent = big ? L(`🎉 ${session} faqe në këtë seancë!`, `🎉 ${session} pages this session!`) : `+${n} ${['📖', '✨', '💪', '🔥'][session % 4]}`;
        haptic(big ? [10, 40, 10] : 6);
        bar.appendChild(pop); setTimeout(() => pop.remove(), big ? 2600 : 1300);
        bar.classList.remove('bump'); void bar.offsetWidth; bar.classList.add('bump');
      }
      last.page = st.page;
    }
  };
  setInterval(tick, 500);
  new MutationObserver(() => { if (!reader.hidden && fsOn()) enterFS(); tick(); }).observe(reader, { attributes: true, attributeFilter: ['hidden'] });
}

/* ---------- calm reading: the bars fade while you read; the first tap on a faded bar only wakes it ---------- */
function initCalm() {
  const reader = $('#readerView');
  if (!reader) return;
  const bars = () => [$('.reader-top'), $('.reader-controls'), $('.fr-bar .fb-modes')].filter(Boolean);
  let timer = 0;
  const calm = () => { if (!reader.hidden && !$('#settingsSheet:not([hidden])') && !document.querySelector('dialog[open]')) reader.classList.add('fr-calm'); };
  const later = (ms = 2800) => { clearTimeout(timer); timer = setTimeout(calm, ms); };
  const wake = (ms) => { reader.classList.remove('fr-calm'); later(ms); };
  bars().forEach(el => {
    const guard = e => { if (reader.classList.contains('fr-calm')) { e.preventDefault(); e.stopPropagation(); if (e.type === 'pointerdown' || e.type === 'touchstart') wake(5000); } };
    ['pointerdown', 'touchstart', 'click'].forEach(ev => el.addEventListener(ev, guard, { capture: true, passive: false }));
    el.addEventListener('pointerdown', () => later(5000));
  });
  reader.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && (e.clientY < 110 || e.clientY > innerHeight - 140)) wake(4000); });
  reader.addEventListener('pointerdown', () => { if (!reader.classList.contains('fr-calm')) later(); }, true);
  new MutationObserver(() => { if (reader.hidden) { reader.classList.remove('fr-calm'); clearTimeout(timer); } else later(4000); }).observe(reader, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('keydown', () => { if (!reader.hidden) later(); });
}

function init() {
  for (const f of [initSettings, initKnobs, initTapGuard, initPageBar, initCalm, initDrive, initHome]) { try { f(); } catch (e) { console.warn('plus', e); } }
  relabel();
  applyDim();
  new MutationObserver(applyDim).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-paper'] });
  sunTheme();
  setInterval(sunTheme, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sunTheme(); });
  let t = 0;
  document.addEventListener('pointerup', () => { if (fsOn() && !document.fullscreenElement && Date.now() - t > 4000) { t = Date.now(); enterFS(); } }, true);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else setTimeout(init, 0);
