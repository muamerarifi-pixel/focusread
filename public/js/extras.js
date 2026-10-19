// FocusRead v6.7 — add-on layer (loaded by boot.js, like spotlight.js).
//  • Home page: real book covers (from EPUB files) and nicer generated covers
//  • Settings: "shadow behind text" slider (0-100 %)
//  • Reader: a bookmark ribbon on the page
//  • Table of contents: reading time per section, collapsible groups in long books
// It only observes and decorates the page; the reading engine in app.js is unchanged.
import * as DB from './db.js';
import * as I18N from './i18n.js';

const $ = s => document.querySelector(s);
const en = () => { try { return I18N.getLang() === 'en'; } catch { return false; } };
const L = (sq, e) => (en() ? e : sq);
const settings = () => { try { return JSON.parse(localStorage.getItem('focusread_settings_v6') || '{}') || {}; } catch { return {}; } };

/* ---------- Home page: covers ---------- */
const KIND = { pdf: 'PDF', epub: 'EPUB', docx: 'DOC', html: 'WEB', md: 'MD', srt: 'SRT', json: 'JSON', txt: 'TXT', text: '✎', share: '↗', demo: '★' };
const hash = s => { let h = 0; for (const ch of s) h = (h * 31 + ch.codePointAt(0)) >>> 0; return h; };
function coverText(cov, title, author) {
  const t = document.createElement('b'); t.className = 'cv-t'; t.textContent = title; cov.appendChild(t);
  if (author) { const a = document.createElement('em'); a.className = 'cv-a'; a.textContent = author; cov.appendChild(a); }
}
const findList = () => $('#libList') || (document.querySelector('.doc') || {}).parentElement || null;
function decorateCards() {
  const list = findList();
  if (!list) return;
  list.querySelectorAll('.doc:not([data-cv])').forEach(card => {
    card.dataset.cv = '1';
    const cov = card.querySelector('.doc-cover');
    if (!cov) return;
    let inf = {};
    try { inf = (DB.infoOf && DB.infoOf(card.dataset.id)) || {}; } catch {}
    const title = ((card.querySelector('.doc-title') || {}).textContent || inf.title || '').trim();
    cov.classList.add('cv');
    cov.dataset.p = String(hash(title) % 5);
    if (inf.bm) { const r = document.createElement('s'); r.className = 'cv-bm'; r.title = L('Faqe e ruajtur', 'Saved page'); cov.appendChild(r); }
    if (inf.cover) {
      const img = document.createElement('img');
      img.alt = ''; img.decoding = 'async'; img.draggable = false;
      img.onerror = () => { img.remove(); cov.classList.remove('has-img'); coverText(cov, title, inf.author); };
      img.src = inf.cover;
      cov.classList.add('has-img');
      cov.insertBefore(img, cov.firstChild);
    } else {
      coverText(cov, title, inf.author);
      const k = KIND[String(inf.kind || '').toLowerCase()];
      if (k) { const u = document.createElement('u'); u.className = 'cv-k'; u.textContent = k; cov.appendChild(u); }
    }
  });
}
function initCovers(tries = 0) {
  const list = findList();
  if (!list) { if (tries < 12) setTimeout(() => { try { initCovers(tries + 1); } catch {} }, 400); return; }
  new MutationObserver(() => { try { decorateCards(); } catch (e) { console.warn('covers', e); } }).observe(list, { childList: true });
  decorateCards();
}

/* ---------- Settings: shadow behind the reading text, 0-100 % ---------- */
function initShadow() {
  const anchor = $('input[data-set="guide"]') || $('input[data-set="bionic"]');
  const row = (anchor && anchor.closest('label')) || [...document.querySelectorAll('label.switch')].pop();
  if (!row || $('#shadowRow')) return;
  const wrap = document.createElement('div');
  wrap.className = 'shadow-row'; wrap.id = 'shadowRow';
  const title = document.createElement('span'); title.className = 'sr-t';
  const out = document.createElement('output'); out.className = 'sr-o';
  const rng = document.createElement('input');
  rng.type = 'range'; rng.className = 'sr-r'; rng.min = '0'; rng.max = '100'; rng.step = '5';
  wrap.append(title, out, rng);
  const label = () => { title.textContent = L('Hije prapa tekstit', 'Shadow behind text'); };
  label();
  const apply = v => {
    v = Math.max(0, Math.min(100, Math.round(v)));
    const h = document.documentElement;
    h.dataset.shadow = v ? 'on' : 'off';
    h.style.setProperty('--tsa', String(v / 100));
    out.textContent = v + '%'; rng.value = String(v);
  };
  let cur = 50;
  try { const sv = localStorage.getItem('focusread_shadow'); if (sv !== null && sv !== '') cur = Number(sv); } catch {}
  apply(isFinite(cur) ? cur : 50);
  rng.addEventListener('input', () => { apply(Number(rng.value)); try { localStorage.setItem('focusread_shadow', rng.value); } catch {} });
  row.insertAdjacentElement('afterend', wrap);
  const later = () => setTimeout(label, 80);
  const lb = $('#langBtn'); if (lb) lb.addEventListener('click', later);
  const ls = $('select[data-set="lang"]'); if (ls) ls.addEventListener('change', later);
}

/* ---------- Reader: a visible bookmark ribbon on the page ---------- */
// Tap the ribbon to save the page you are on (the same bookmark as the bookmark button, key K);
// it turns solid red while this page is saved. It sits on the book page and on the guided page.
function makeRibbon() {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'page-ribbon'; b.tabIndex = -1;
  b.addEventListener('mousedown', e => e.preventDefault());
  ['pointerdown', 'pointerup', 'click'].forEach(ev => b.addEventListener(ev, e => e.stopPropagation()));
  b.addEventListener('click', () => { const t = $('#bmBtn'); if (t) t.click(); });
  return b;
}
function initRibbon() {
  const bm = $('#bmBtn'), sheet = $('#bookSheet'), pacer = $('#pacer');
  if (!bm || (!sheet && !pacer)) return;
  const ribs = [];
  if (sheet) { const r = makeRibbon(); sheet.appendChild(r); ribs.push(r); }
  if (pacer) {
    const w = document.createElement('div'); w.className = 'rib-wrap';
    const r = makeRibbon(); w.appendChild(r); ribs.push(r);
    pacer.insertBefore(w, pacer.firstChild);
  }
  const sync = () => {
    const on = bm.classList.contains('on');
    const tip = on ? L('Hiq faqeshënuesin', 'Remove bookmark') : L('Ruaj këtë faqe', 'Save this page');
    ribs.forEach(r => { r.classList.toggle('on', on); r.title = tip; r.setAttribute('aria-label', tip); r.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  };
  new MutationObserver(sync).observe(bm, { attributes: true, attributeFilter: ['class'] });
  sync();
}

/* ---------- Table of contents: time per section, collapsible groups ---------- */
const fmtMin = m => (m < 1 ? '<1 min' : m < 60 ? Math.round(m) + ' min' : Math.floor(m / 60) + ' h' + (Math.round(m % 60) ? ' ' + Math.round(m % 60) + ' min' : ''));
function decorateToc() {
  const list = $('#tocList');
  const FR = window.FocusRead, T = FR && FR.R && FR.R.T;
  if (!list || !T || !T.heads || !T.heads.length) return;
  const items = [...list.children].filter(li => li.querySelector && li.querySelector('button[data-k]'));
  if (!items.length || items[0].dataset.dec) return;
  const S = settings(), factor = S.smart === false ? 1 : 1.18;
  const mins = w => (w / (S.wpm || 300)) * factor;
  const total = T.origCount || 1, H = T.heads;
  const levelOf = li => +((li.className.match(/\bl([123])\b/) || [0, 1])[1]);
  const groups = [];
  let group = null;
  items.forEach(li => {
    li.dataset.dec = '1';
    const btn = li.querySelector('button[data-k]');
    const k = +btn.dataset.k, h = H[k];
    if (!h) return;
    if (h.syn) li.classList.add('syn');
    let end = total;
    for (let j = k + 1; j < H.length; j++) if (H[j].level <= h.level) { end = H[j].o; break; }
    const tm = document.createElement('span');
    tm.className = 'tm'; tm.textContent = fmtMin(mins(Math.max(0, end - h.o)));
    btn.insertBefore(tm, btn.querySelector('.p'));
    if (levelOf(li) === 1) { group = { head: li, kids: [] }; groups.push(group); }
    else if (group) group.kids.push(li);
  });
  if (items.length > 24) groups.forEach(g => {   // long books: sub-sections fold away under their chapter
    if (!g.kids.length) return;
    const tg = document.createElement('button');
    tg.type = 'button'; tg.className = 'tg'; tg.setAttribute('aria-label', L('Hap / mbyll', 'Expand / collapse'));
    g.head.classList.add('has-kids');
    g.head.appendChild(tg);
    const set = o => { g.head.classList.toggle('closed', !o); tg.setAttribute('aria-expanded', o ? 'true' : 'false'); g.kids.forEach(k => { k.hidden = !o; }); };
    set(g.head.classList.contains('cur') || g.kids.some(k => k.classList.contains('cur')));
    tg.addEventListener('click', e => { e.stopPropagation(); set(g.head.classList.contains('closed')); });
  });
  const sum = document.createElement('li');
  sum.className = 'toc-sum';
  sum.textContent = H.length + ' ' + L('pjesë', 'sections') + ' · ' + fmtMin(mins(total));
  list.insertBefore(sum, list.firstChild);
  const cur = list.querySelector('li.cur');
  if (cur && !cur.hidden) cur.scrollIntoView({ block: 'center' });
}
function initToc() {
  const list = $('#tocList');
  if (!list) return;
  new MutationObserver(() => { try { decorateToc(); } catch (e) { console.warn('toc', e); } }).observe(list, { childList: true });
}

function init() { for (const f of [initCovers, initShadow, initRibbon, initToc]) { try { f(); } catch (e) { console.warn('extras', e); } } }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
