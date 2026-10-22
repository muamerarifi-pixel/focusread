// FocusRead v6.8 — add-on layer (loaded by boot.js after extras.js):
//  • Settings: rotary knobs instead of sliders, with haptic ticks; a tick on every small change
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

/* ---------- knobs ---------- */
const KNOBS = [];
const refreshKnobs = () => KNOBS.forEach(f => f());
function knob(input, fmt = v => String(v)) {
  if (!input || input.dataset.knob) return;
  input.dataset.knob = '1';
  const min = +input.min, max = +input.max, step = +input.step || 1;
  const el = document.createElement('div');
  el.className = 'fr-knob'; el.tabIndex = 0; el.setAttribute('role', 'slider');
  el.setAttribute('aria-valuemin', min); el.setAttribute('aria-valuemax', max);
  el.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="k-track" cx="50" cy="50" r="44" pathLength="360"/><circle class="k-fill" cx="50" cy="50" r="44" pathLength="360"/></svg><span class="k-dial"><i></i></span><b class="k-val"></b>';
  input.classList.add('fr-src'); input.tabIndex = -1;
  input.after(el);
  const row = input.closest('label, .shadow-row, .range-row, .fr-row');
  if (row) row.classList.add('has-knob');
  const show = () => {
    const v = +input.value;
    el.style.setProperty('--f', (v - min) / (max - min || 1));
    el.lastChild.textContent = fmt(v);
    el.setAttribute('aria-valuenow', v); el.setAttribute('aria-valuetext', fmt(v));
  };
  const set = v => {
    v = clamp(Math.round(v / step) * step, min, max);
    if (v === +input.value) return;
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    haptic(5); show();
  };
  let last = null, acc = 0, on = false;
  const angle = e => { const r = el.getBoundingClientRect(), x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2; return Math.hypot(x, y) < 8 ? null : Math.atan2(y, x) * 180 / Math.PI; };
  el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId); on = true; last = angle(e); acc = +input.value; el.classList.add('turning'); haptic(4); });
  el.addEventListener('pointermove', e => {
    if (!on) return;
    const a = angle(e); if (a === null) return;
    if (last === null) { last = a; return; }
    let d = a - last; if (d > 180) d -= 360; if (d < -180) d += 360;
    last = a; acc = clamp(acc + d / 270 * (max - min), min, max); set(acc);
  });
  const end = () => { on = false; last = null; el.classList.remove('turning'); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });
  el.addEventListener('wheel', e => { e.preventDefault(); set(+input.value + (e.deltaY < 0 ? step : -step)); }, { passive: false });
  el.addEventListener('keydown', e => { const k = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 }[e.key]; if (k) { e.preventDefault(); set(+input.value + k * step); } });
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
const relabel = () => $$('[data-sq]').forEach(s => { s.textContent = L(s.dataset.sq, s.dataset.en); });

/* ---------- background dimming, day and night apart ---------- */
const DIMV = ['--bg', '--bg2', '--card', '--soft', '--paper-tone'];
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
const enterFS = () => { if (!document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {}); };

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
    if (!document.documentElement.requestFullscreen) fs.hidden = true;
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

/* ---------- no accidental taps while scrolling (home page, settings, lists) ---------- */
function initTapGuard() {
  let lastScroll = 0, moved = false, sx = 0, sy = 0;
  const guarded = t => t && t.closest && !t.closest('#readerView') ;
  document.addEventListener('scroll', e => { if (guarded(e.target === document ? document.body : e.target)) lastScroll = Date.now(); }, { capture: true, passive: true });
  document.addEventListener('touchstart', e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; moved = e.touches.length > 1 || Date.now() - lastScroll < 120; }, { capture: true, passive: true });
  document.addEventListener('touchmove', e => { const t = e.touches[0]; if (Math.hypot(t.clientX - sx, t.clientY - sy) > 10) moved = true; }, { capture: true, passive: true });
  document.addEventListener('click', e => {
    if (e.detail === 0 || !guarded(e.target) || e.target.closest('.fr-knob')) return;
    if (moved || Date.now() - lastScroll < 220) { e.preventDefault(); e.stopPropagation(); moved = false; }
  }, true);
}

/* ---------- reader: floating page bar, +1 per page, "you stopped here" ---------- */
function state() {
  const FR = window.FocusRead, R = FR && FR.R, T = R && R.T;
  if (!T || !R.doc || !R.starts || !T.orig || !T.origCount) return null;
  const c = clamp(R.ci | 0, 0, R.starts.length - 2);
  const idx = T.orig[R.starts[c]] || 0, total = T.origCount;
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
  bar.innerHTML = '<span class="fb-pg"></span><span class="fb-track"><i></i></span><span class="fb-info"></span>';
  stage.appendChild(bar);
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
    bar.querySelector('.fb-pg').innerHTML = `${L('Faqja', 'Page')} <b>${st.page}</b> / ${st.pages}`;
    bar.querySelector('.fb-track i').style.width = st.pct + '%';
    bar.querySelector('.fb-info').textContent = `${st.pct}% · ~${fmtMin(left)} · ${L(`edhe ${toNext} deri në ${next}%`, `${toNext} to ${next}%`)}${today ? ` · ${L('sot', 'today')} ${today}` : ''}${streak >= 2 ? ` · 🔥${streak}` : ''}`;
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
      if (st.page === last.page + 1) {    // a page read: a small reward
        session++;
        const pop = document.createElement('span');
        pop.className = 'fb-pop';
        const big = [5, 10, 20, 30, 50, 75, 100].includes(session);
        pop.textContent = big ? L(`🎉 ${session} faqe në këtë seancë!`, `🎉 ${session} pages this session!`) : (session % 3 === 0 ? ['+1 📖', '+1 ✨', '+1 💪', '+1 🔥'][session % 4] : '+1 📖');
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

function init() {
  for (const f of [initSettings, initKnobs, initTapGuard, initPageBar]) { try { f(); } catch (e) { console.warn('plus', e); } }
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
