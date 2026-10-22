// FocusRead v6.7 — add-on layer (loaded by boot.js, like spotlight.js).
//  • Home page: real book covers (from EPUB files) and nicer generated covers
//  • Settings: "shadow behind text" slider (0-100 %)
//  • Reader: a bookmark ribbon on the page; "page X / Y" in every reading mode; milestone cheers
//  • Table of contents: reading time per section, collapsible groups in long books
// It only observes and decorates the page; the reading engine in app.js is unchanged.
import * as DB from './db.js';
import * as I18N from './i18n.js';
import * as ST from './stats.js';

const $ = s => document.querySelector(s);
const en = () => { try { return I18N.getLang() === 'en'; } catch { return false; } };
const L = (sq, e) => (en() ? e : sq);
const settings = () => { try { return JSON.parse(localStorage.getItem('focusread_settings_v6') || '{}') || {}; } catch { return {}; } };

/* ---------- Home page: covers ---------- */
const KIND = { pdf: 'PDF', epub: 'EPUB', docx: 'DOC', html: 'WEB', md: 'MD', srt: 'SRT', json: 'JSON', txt: 'TXT', text: '✎', share: '↗', demo: '★' };
const WPP = 250; // words per page: the same "page" in every reading mode
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
    if (inf.words) {
      const total = Math.max(1, Math.ceil(inf.words / WPP));
      const g = document.createElement('small'); g.className = 'cv-pg';
      g.textContent = inf.fin ? '\u2713 ' + total : inf.pos > 0 ? (Math.min(total, Math.floor(inf.pos / WPP) + 1) + '/' + total) : total + ' p.';
      cov.appendChild(g);
    }
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

/* ---------- Reader: page X / Y in every mode, progress cheers ---------- */
// A "page" is 250 words, so the number means the same in RSVP, guided and book mode.
const cheerOn = () => { try { return localStorage.getItem('focusread_cheer') !== '0'; } catch { return true; } };
const pick = a => a[Math.floor(Math.random() * a.length)];
let cheerEl = null, cheerTimer = 0;
function confetti(host) {
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#c77dff', '#ff9f1c'];
  for (let k = 0; k < 28; k++) {
    const q = document.createElement('i'), a = Math.random() * Math.PI * 2, d = 90 + Math.random() * 170;
    q.style.setProperty('--x', Math.round(Math.cos(a) * d) + 'px');
    q.style.setProperty('--y', Math.round(Math.sin(a) * d - 60) + 'px');
    q.style.setProperty('--r', Math.round(Math.random() * 540 - 270) + 'deg');
    q.style.background = colors[k % colors.length];
    q.style.animationDelay = Math.round(Math.random() * 120) + 'ms';
    box.appendChild(q);
  }
  host.appendChild(box);
  setTimeout(() => box.remove(), 1700);
}
function cheer(icon, title, sub, big) {
  if (!cheerOn()) return;
  const bar = document.querySelector('.fr-bar'), rv = document.querySelector('#readerView');
  if (!bar || (rv && rv.hidden)) return;
  const p = document.createElement('span');
  p.className = 'fb-pop'; p.textContent = icon + ' ' + title;
  bar.appendChild(p); setTimeout(() => p.remove(), 2300);
  try { if (navigator.vibrate) navigator.vibrate(big ? [10, 40, 10] : 8); } catch {}
}
const DECILE = [
  ['\u{1F331}', 'Fillimi \u00ebsht\u00eb pjesa m\u00eb e v\u00ebshtir\u00eb \u2014 e kryen!', 'The hardest part is starting \u2014 done!'],
  ['\u{1F525}', 'Po futesh n\u00eb ritm!', 'You\u2019re finding your rhythm!'],
  ['\u26a1', 'Momenti po rritet!', 'Momentum is building!'],
  ['\u{1F680}', 'Gati gjysma!', 'Almost halfway!'],
  ['\u{1F389}', 'GJYSMA! Gjysma e librit \u00ebsht\u00eb e jotja', 'HALFWAY! Half the book is yours'],
  ['\u{1F4AA}', 'Pjesa e v\u00ebshtir\u00eb mbaroi!', 'The hard part is behind you!'],
  ['\u{1F31F}', 'Fundi po duket!', 'The end is in sight!'],
  ['\u{1F3C3}', 'Sprinti final!', 'Final stretch!'],
  ['\u{1F525}', 'Edhe pak \u2014 po t\u00eb mbetet vet\u00ebm 10%!', 'So close \u2014 only 10% left!'],
  ['\u{1F3C6}', 'E p\u00ebrfundove! Bravo!', 'Finished! Amazing work!'],
];
const mem = { id: '', idx: 0, hi: 0, chap: -1, page: 0, today: null };
const loadHi = id => { try { return +localStorage.getItem('focusread_hi_' + id) || 0; } catch { return 0; } };
const saveHi = (id, v) => { try { localStorage.setItem('focusread_hi_' + id, String(v)); } catch {} };
function readerState() {
  const FR = window.FocusRead, R = FR && FR.R, T = R && R.T;
  if (!T || !R.doc || !R.starts || !T.orig || !T.origCount) return null;
  const c = Math.max(0, Math.min(R.ci | 0, R.starts.length - 2));
  const book = FR.S && FR.S.mode === 'book'; // book mode: progress follows the ribbon, not the page on screen
  return { T, id: R.doc.id, idx: book ? Math.max(0, Math.min(R.doc.spot ?? R.doc.pos ?? 0, T.origCount)) : (T.orig[R.starts[c]] || 0), total: T.origCount };
}
function onProgress(label) {
  const st = readerState();
  if (!st) return null;
  const { T, id, idx, total } = st;
  const S = settings();
  const left = ((total - idx) / (S.wpm || 300)) * (S.smart === false ? 1 : 1.18);
  const pages = Math.max(1, Math.ceil(total / WPP)), page = Math.min(pages, Math.floor(idx / WPP) + 1);
  const pct = idx >= total - 12 ? 100 : Math.min(99, Math.floor((idx / total) * 100));
  const step = Math.floor(pct / 10) * 10;
  const nxt = Math.min(100, step + 10);
  const toGo = Math.max(1, Math.ceil(Math.max(0, Math.ceil((nxt / 100) * total) - idx) / WPP));
  const text = L('Faqja ', 'Page ') + page + ' / ' + pages + ' \u00b7 ' + (nxt >= 100 ? L(toGo + ' deri n\u00eb fund', toGo + ' to the end') : L(toGo + ' deri n\u00eb ' + nxt + '%', toGo + ' to ' + nxt + '%'));
  const sub = L('Faqja ', 'Page ') + page + ' / ' + pages + ' \u00b7 ' + (left < 1 ? '' : '~') + fmtMin(Math.max(0, left)) + ' ' + L('t\u00eb mbetura', 'left');
  const topLv = T.topLevel;
  const chapAt = x => { let r = -1; (T.heads || []).forEach((h, k) => { if (h.level === topLv && !h.syn && h.o <= x) r = k; }); return r; };
  const chap = chapAt(idx);
  const todayPages = Math.floor((ST.today().w || 0) / WPP);
  if (mem.id !== id) {                       // a book was opened: start quietly
    mem.id = id; mem.idx = idx; mem.chap = chap; mem.page = page;
    mem.hi = Math.max(loadHi(id), idx / total < 0.05 ? 0 : step);
    if (mem.today === null) mem.today = todayPages;
    saveHi(id, mem.hi);
    try {
      const sk = ST.streak(), key = 'fr_streak_' + ST.dayKey();
      if (sk >= 2 && sessionStorage.getItem(key) !== '1') {
        sessionStorage.setItem(key, '1');
        cheer('\u{1F525}', L('Dita e ' + sk + ' radhazi', sk + '-day streak'), L('Lexo sot p\u00ebr ta mbajtur gjall\u00eb', 'Read today to keep it alive'));
      }
    } catch {}
  } else {
    const d = idx - mem.idx;
    const normal = d > 0 && d <= 700;         // reading forward, not seeking
    let win = null;
    if (step > mem.hi) {
      if (normal) { const m = DECILE[Math.min(9, step / 10 - 1)]; win = { p: pct >= 100 ? 5 : 3, i: m[0], t: L(m[1], m[2]), s: sub, big: step % 50 === 0 || pct >= 100 }; }
      mem.hi = step; saveHi(id, step);
    } else if (idx / total < 0.05 && mem.hi > 0) { mem.hi = 0; saveHi(id, 0); }   // started over
    if (normal && chap > mem.chap && mem.chap >= 0 && (!win || win.p < 4)) {
      const done = T.heads[mem.chap];
      win = { p: 4, i: '\u2705', t: L('Kapitulli p\u00ebrfundoi: ', 'Chapter done: ') + (done && done.title ? done.title : ''), s: pick([L('Vazhdo \u2014 po ec shk\u00eblqyeshm\u00ebr!', 'Keep going \u2014 you\u2019re flying!'), L('Edhe nj\u00eb kapitull n\u00eb xhep!', 'Another chapter in the bag!')]), big: false };
    }
    if (normal && [50, 100, 250, 500, 1000].some(m => page >= m && mem.page < m) && !win) {
      win = { p: 2, i: '\u{1F4D6}', t: L('Faqja ' + page + '!', 'Page ' + page + '!'), s: sub, big: true };
    }
    const tp = [5, 10, 20, 30, 50, 75, 100].filter(x => todayPages >= x && mem.today < x).pop();
    if (tp && !win) win = { p: 1, i: '\u{1F4DA}', t: L(tp + ' faqe sot!', tp + ' pages today!'), s: pick([L('P\u00ebrpjekja jote po rritet \u2014 vazhdo!', 'Your effort is adding up \u2014 keep going!'), L('Kjo \u00ebsht\u00eb ajo q\u00eb ia vlen.', 'This is what makes the difference.')]), big: tp >= 30 };
    mem.today = Math.max(mem.today, todayPages);
    if (win) cheer(win.i, win.t, win.s, win.big);
    if (page !== mem.page && label) { label.classList.remove('pp-pop'); void label.offsetWidth; label.classList.add('pp-pop'); }
    mem.idx = idx; mem.chap = chap; mem.page = page;
  }
  if (label) { label.textContent = text; label.title = '\u2248' + WPP + ' ' + L('fjal\u00eb p\u00ebr faqe', 'words per page') + ' \u00b7 ' + L('fjala ', 'word ') + (idx + 1) + ' / ' + total; }
  return text;
}
function initPages() {
  const label = $('#progressText');
  if (!label) { setInterval(() => { try { onProgress(null); } catch {} }, 900); return; }
  let mine = '';
  const run = () => {
    if (label.textContent === mine) return;
    try { mine = onProgress(label) || label.textContent; } catch (e) { console.warn('pages', e); mine = label.textContent; }
  };
  new MutationObserver(run).observe(label, { childList: true, characterData: true, subtree: true });
}
function initCheer() {
  const anchor = $('#shadowRow');
  if (!anchor || $('#cheerSwitch')) return;
  const lab = document.createElement('label');
  lab.className = 'switch'; lab.id = 'cheerSwitch';
  const inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = cheerOn();
  const span = document.createElement('span');
  lab.append(inp, span);
  const label = () => { span.textContent = L('Feston arritjet gjat\u00eb leximit', 'Celebrate milestones while reading'); };
  label();
  inp.addEventListener('change', () => { try { localStorage.setItem('focusread_cheer', inp.checked ? '1' : '0'); } catch {} });
  anchor.insertAdjacentElement('afterend', lab);
  const lb = $('#langBtn'); if (lb) lb.addEventListener('click', () => setTimeout(label, 80));
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

function init() { for (const f of [initCovers, initShadow, initCheer, initRibbon, initPages, initToc]) { try { f(); } catch (e) { console.warn('extras', e); } } }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
