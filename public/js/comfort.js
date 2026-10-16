// Reading-comfort additions: blink pauses, warm night colours, speed note,
// resume-on-open. Adds its own settings switches, styles and texts so the
// core files stay untouched. Imported by app.js before it binds settings.

const TXT = {
  sq: {
    resumeHint: 'Vazhdon aty ku e le · prek për të nisur',
    speedNote: 'Mbi ~450 fjalë/min kuptimi zakonisht bie. Për tekste që duhet t’i mbash mend, 250–350 është më mirë.',
    blink: 'Pauza për pulsim (çdo ~25 s, në fund të fjalisë)',
    resumeAsk: 'Vazhdo leximin e fundit?',
    resume: 'Pyet për të vazhduar leximin e fundit kur hap aplikacionin',
    nightWarm: 'Ngjyra të ngrohta natën (21:00–06:00, me temë automatike)',
    bionic: 'Bionic — fillimi i trashë (eksperimental, pa përfitim të provuar)',
  },
  en: {
    resumeHint: 'Picking up where you left off · tap to start',
    speedNote: 'Above ~450 wpm comprehension usually drops. For text you need to remember, 250–350 works best.',
    blink: 'Blink pauses (every ~25 s, at a sentence end)',
    resumeAsk: 'Continue your last read?',
    resume: 'Ask to continue my last read when the app opens',
    nightWarm: 'Warm colours at night (21:00–06:00, auto theme)',
    bionic: 'Bionic — bold word beginnings (experimental, no proven benefit)',
  },
};
export function ct(key) {
  const l = document.documentElement.lang === 'en' ? 'en' : 'sq';
  return TXT[l][key] || TXT.sq[key] || key;
}

const CSS = `
.word-row{transition:opacity .18s ease}
.word-row.blinkrest{opacity:.18;transition:opacity .25s ease}
.pacer-page{max-width:62ch}
.set-note{margin:8px 0 0;font-size:12.5px;line-height:1.45;color:var(--fg2);background:var(--hl);border-radius:10px;padding:8px 10px}
`;

function sw(key) {
  const l = document.createElement('label');
  l.className = 'switch';
  l.innerHTML = `<input type="checkbox" data-set="${key}"><span data-ct="${key}"></span>`;
  return l;
}

function inject() {
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);

  const chunkH = document.querySelector('h4[data-i18n="set.chunk"]');
  if (chunkH) {
    const note = document.createElement('p');
    note.id = 'speedNote'; note.className = 'set-note'; note.hidden = true;
    note.dataset.ct = 'speedNote';
    chunkH.before(note);
  }
  const split = document.querySelector('[data-set="splitLong"]');
  if (split) split.closest('label').after(sw('blink'));
  const guide = document.querySelector('[data-set="guide"]');
  if (guide) guide.closest('label').after(sw('nightWarm'));
  const bionic = document.querySelector('[data-set="bionic"] + span');
  if (bionic) bionic.dataset.ct = 'bionic';

  const translate = () => document.querySelectorAll('[data-ct]').forEach(el => { el.textContent = ct(el.dataset.ct); });
  translate();
  // app.js re-translates the page whenever the language is (re)applied; follow it.
  new MutationObserver(translate).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
}

inject();
