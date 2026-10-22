// Book structure: finds titles, chapters and subheadings in plain text.
//
// Text arrives as paragraphs separated by blank lines. Importers that know the
// real structure (EPUB, HTML, DOCX, Markdown, big-font lines in PDFs) mark
// headings Markdown-style: "# Chapter", "## Section", "### Subsection".
// Everything else — pasted text, TXT files, older imports — is analysed here:
//   • by pattern: "Chapter 3", "KAPITULLI III", "Pjesa e dytë", "Prologue",
//     "Hyrje", "1.2 Methods", a lone "IV" …
//   • by shape: a short, unpunctuated line that stands alone in front of body
//     text (ALL CAPS → chapter, Title Case → section, sentence case → subheading).
// The result is used by the reader to show headings distinctly, pause on them,
// and build a table of contents.

const PART_KW = [
  'part', 'book', 'volume', 'vol\\.', 'pjesa', 'pjes[eë]', 'libri', 'v[eë]llimi',
  'teil', 'buch', 'partie', 'livre', 'parte', 'libro', 'deo', 'dio', 'knjiga', 'kısım', 'cilt', 'część', 'tom',
].join('|');
const CHAP_KW = [
  'chapter', 'chap\\.', 'section', 'lesson', 'unit', 'lecture', 'letter', 'act', 'scene', 'canto',
  'kapitulli', 'kapitull', 'kreu', 'seksioni', 'm[eë]simi', 'leksioni', 'nj[eë]sia', 'akti', 'skena', 'tema',
  'kapitel', 'abschnitt', 'chapitre', 'capitolo', 'cap[ií]tulo', 'poglavlje', 'poglavje', 'glava', 'bölüm', 'ünite', 'rozdział',
].join('|');
const NUM = [
  '[ie]\\s+(?:par[eë]|dyt[eë]|tret[eë]|kat[eë]rt|pest[eë]|gjasht[eë]|shtat[eë]|tet[eë]|n[eë]nt[eë]|dhjet[eë]|fundit|\\d{1,3}(?:-?t[eë])?)',
  '\\d{1,4}[a-z]?', '[ivxlcdm]{1,8}',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
  '(?:twenty|thirty|forty|fifty|sixty)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?',
  'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'last', 'final',
  'nj[eë]', 'dy', 'tre', 'kat[eë]r', 'pes[eë]', 'gjasht[eë]', 'shtat[eë]', 'tet[eë]', 'n[eë]nt[eë]', 'dhjet[eë]',
  '[a-z]',
].join('|');
const STAND = [
  'prologue', 'prolog', 'prologu', 'epilogue', 'epilog', 'epilogu', 'preface', 'foreword', 'introduction',
  'afterword', 'conclusions?', 'acknowledge?ments', 'dedication', 'appendix', 'appendices', 'glossary',
  'bibliography', 'references', 'notes', 'endnotes', 'contents', 'table of contents', 'abstract', 'summary',
  'interlude', 'parath[eë]ni[ea]', 'hyrj[ea]', 'pasth[eë]ni[ea]', 'p[eë]rfundim[ei]?', 'p[eë]rmbajtj[ea]',
  'fal[eë]nderime(?:t)?', 'mir[eë]njohje', 'shtojc[aë]', 'shtojcat', 'bibliografi[a]?', 'literatura',
  'referencat', 'abstrakti?', 'p[eë]rmbledhj[ea]', 'kushtim', 'sh[eë]nime(?:t)?', 'fjalori',
  'vorwort', 'einleitung', 'nachwort', 'inhalt', 'uvod', 'predgovor', 'zaklju[cč]ak', 'sadr[zž]aj', 'pogovor',
  'önsöz', 'giriş', 'sonuç', 'préface', 'avant-propos', 'introduzione', 'prefazione', 'conclusione', 'indice',
].join('|');

const STOP = '(?=$|[\\s.:,;)\\]\\-–—])';
const RE_KW = new RegExp(`^(${PART_KW}|${CHAP_KW})\\s+(${NUM})${STOP}\\.?\\)?\\s*(?:[:.\\-–—]\\s*)?(.*)$`, 'iu');
const RE_PART = new RegExp(`^(?:${PART_KW})$`, 'iu');
const RE_STAND = new RegExp(`^(?:${STAND})(?:\\s+[A-Z0-9IVX]{1,4})?\\s*(?:[:.\\-–—]\\s*(.{0,90}))?$`, 'iu');
const RE_ROMAN = /^(?=[IVXLCDM])M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})\.?$/;
const RE_DIGITS = /^\d{1,3}\.?$/;
const RE_NUMBERED = /^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+(\S.*)$/u;
const RE_MARK = /^(#{1,6})\s+(\S.*)$/;
const END_P = /[.,;:…]$|["”»’)\]]$/;
const OPENERS = /^[-–—•*·"“”«»'‘’„(\[<]/;

const wordsOf = s => s.split(/\s+/).filter(Boolean);

// Lists (v6.9.8): bullet glyphs from Word, PDFs, web pages and chat apps.
const GLYPHS = '•●○◦▪▫■□‣⁃∙►▸▹➤➢➔→✓✔☐❖◆◇\uf0b7\uf0a7\uf076\uf0d8\uf0fc';
const RE_GLYPH_W = new RegExp('^[' + GLYPHS + ']$', 'u');
const RE_GLYPH_LINE = new RegExp('^[' + GLYPHS + ']\\s+\\S', 'u');
const RE_ITEM_LINE = new RegExp('^(?:[' + GLYPHS + ']|[-*+])\\s+\\S|^(?:\\d{1,3}|[a-zA-Z])[.)]\\s+\\S|^\\((?:\\d{1,3}|[a-zA-Z])\\)\\s+\\S', 'u');
const INLINE = '•●▪◦■►▸➤➢✓✔❖◆\uf0b7\uf0a7';
const RE_INLINE = new RegExp('\\s+(?=[' + INLINE + ']\\s+\\S)', 'gu');
const RE_INLINE_N = new RegExp('(?:^|\\s)[' + INLINE + '](?=\\s+\\S)', 'gu');
const RE_DIALOG = /^[–—]\s*\S/u;
const RE_NUM_W = /^(?:\d{1,3}|[a-zA-Z])[.)]$|^\((?:\d{1,3}|[a-zA-Z])\)$/;
const letters = s => (s.match(/\p{L}/gu) || []).length;

function isCaps(s) {
  const up = (s.match(/\p{Lu}/gu) || []).length, low = (s.match(/\p{Ll}/gu) || []).length;
  return up >= 3 && up / (up + low) >= 0.85;
}
function isTitled(ws) {
  const sig = ws.filter(w => letters(w) >= 4);
  if (!sig.length) return false;
  return sig.filter(w => /^[^\p{L}]*\p{Lu}/u.test(w)).length / sig.length >= 0.7;
}

/** Pattern-based heading: returns { level, bare } or null. level 0 = part, 1 = chapter… */
function patternHeading(s, explicitMode) {
  if (s.length > 140) return null;
  let m = s.match(RE_KW);
  if (m) {
    const kw = m[1], num = m[2], rest = (m[3] || '').trim();
    if (/^[a-z]$/.test(num)) return null; // "Book a table" — single letters must be capitals
    if (rest && (wordsOf(rest).length > 14 || /[.,;:]$/.test(rest))) return null;
    if (rest && !/^[\p{Lu}\d"“«„'‘(]/u.test(rest)) return null;
    return { level: RE_PART.test(kw) ? 0 : 1, bare: !rest, kw: true };
  }
  m = s.match(RE_STAND);
  if (m) return { level: 1, bare: false };
  if (RE_ROMAN.test(s)) return { level: 1, bare: true, kw: true };
  if (RE_DIGITS.test(s)) return { level: 1, bare: true, digits: true, kw: true };
  if (!explicitMode) {
    m = s.match(RE_NUMBERED);
    if (m && /^[\p{Lu}"“«„]/u.test(m[2]) && wordsOf(m[2]).length <= 12 && !END_P.test(s) && !/[?!]$/.test(s) && s.length <= 100) {
      const depth = m[1].split('.').filter(Boolean).length;
      return { level: depth >= 3 ? 3 : depth + 1, bare: false, numbered: depth };
    }
  }
  return null;
}

/** Shape-based heading level: 1 (ALL CAPS), 2 (Title Case), 3 (sentence case) or 0. */
function shapeLevel(s) {
  const ws = wordsOf(s);
  if (ws.length > 12 || s.length > 90 || s.length < 2) return 0;
  if (OPENERS.test(s) || !/^[\p{Lu}\d]/u.test(s) || letters(s) < 2) return 0;
  if (END_P.test(s)) return 0;
  const caps = isCaps(s);
  const q = /[?!]$/.test(s);
  if (caps) return 1;
  if (isTitled(ws)) return q && ws.length < 2 ? 0 : 2;
  if (q || ws.length < 2 || ws.length > 8) return 0;
  return 3;
}

/** A line that clearly is a heading even when glued to the paragraph below it. */
function strongFirstLine(line) {
  if (RE_MARK.test(line)) return true;
  const p = patternHeading(line, true);
  if (p && !p.digits) return true;
  const ws = wordsOf(line);
  return ws.length <= 8 && letters(line) >= 4 && isCaps(line) && !END_P.test(line.replace(/\.$/, ''));
}

/** Split text into paragraphs, peeling headings off the paragraph they are glued to. */
function rawParagraphs(text) {
  const out = [];
  const parts = text.split(/(\n[ \t]*\n\s*)/);
  let blank = 9; // the start of the text counts as plenty of space
  for (let k = 0; k < parts.length; k += 2) {
    const p = parts[k] || '';
    const sep = parts[k + 1] || '';
    if (p.trim()) {
      // "Intro: • one • two • three" (bullets glued into one line by a PDF) -> one line per item
      let pb = (p.match(RE_INLINE_N) || []).length >= 2 ? p.replace(RE_INLINE, '\n') : p;
      if (pb !== p) {
        // the last glued item often carries the next paragraph with it: give that text back its own paragraph
        const k2 = pb.lastIndexOf('\n'), last = pb.slice(k2 + 1);
        const m = /[.!?…]["”»’)]*\s+(?=["“«„]?\p{Lu})/u.exec(last);
        if (m && wordsOf(last.slice(m.index + m[0].length)).length >= 12) pb = pb.slice(0, k2 + 1) + last.slice(0, m.index + m[0].length).trimEnd() + '\n\u0001' + last.slice(m.index + m[0].length);
      }
      const lines = pb.split('\n');
      const nItem = lines.filter(l => RE_ITEM_LINE.test(l.trim())).length;
      const nDlg = lines.filter(l => RE_DIALOG.test(l.trim())).length;
      let cur = [], b = blank, peel = true, afterBare = false;
      const emit = (s, bl) => { s = s.trim(); if (s) out.push({ s, blank: bl }); };
      for (let li = 0; li < lines.length; li++) {
        const line = lines[li].trim();
        const last = li === lines.length - 1;
        let split = false;
        if (line.charCodeAt(0) === 1) { if (cur.length) { emit(cur.join('\n'), b); b = 0; } cur = [line.slice(1)]; peel = false; continue; }
        if (!RE_MARK.test(line) && (RE_GLYPH_LINE.test(line) || (nItem >= 2 && RE_ITEM_LINE.test(line)) || (nDlg >= 2 && RE_DIALOG.test(line)))) {
          // a list item starts its own paragraph; the lines after it (wrapped text) stay with it
          if (cur.length) { emit(cur.join('\n'), b); b = 0; cur = []; }
          cur.push(line); peel = false; afterBare = false;
          continue;
        }
        if (RE_MARK.test(line)) split = true;
        else if (peel && !last) {
          if (li === 0 && strongFirstLine(line)) split = true;
          else if (afterBare && shapeLevel(line) && wordsOf(line).length <= 12) split = true;
        }
        if (split) {
          if (cur.length) { emit(cur.join('\n'), b); b = 0; cur = []; }
          const ph = patternHeading(line, true);
          afterBare = li === 0 && !!(ph && ph.bare);
          emit(line, b); b = 1;
        } else {
          cur.push(line);
          peel = false;
        }
      }
      if (cur.length) emit(cur.join('\n'), b);
    }
    const nl = (sep.match(/\n/g) || []).length - 1;
    blank = p.trim() ? nl : Math.max(blank, nl);
  }
  return out;
}

const clip = s => (s.length > 120 ? s.slice(0, 117).trimEnd() + '…' : s);

/**
 * Analyse text (already normalised).
 * returns {
 *   paras: [{ words: string[], level: 0|1|2|3 }],
 *   heads: [{ p, pEnd, level, title }]   // p..pEnd = paragraph range of the heading
 * }
 */
export function analyze(text) {
  const raw = rawParagraphs(String(text || ''));
  const P = raw.map(r => {
    const mk = r.s.match(RE_MARK);
    const s = mk ? mk[2].trim() : r.s;
    const ws = wordsOf(r.s);
    if (mk) ws.shift(); // drop the "#" marker word
    // list items: 1 = bullet, 2 = numbered, 3 = separator ("* * *"), 4 = "-" bullet (needs a neighbour)
    let li = 0, t = s, brk = 0;
    if ((ws[0] || '').startsWith('\u2042\u2060')) { ws[0] = ws[0].slice(2); t = t.replace(/^\u2042\u2060/, ''); brk = 1; }
    const w0 = ws[0] || '';
    if (!mk) {
      if (w0.startsWith('\u2022\u2060')) { ws[0] = w0.slice(2); t = t.replace(/^\u2022\u2060/, ''); li = 1; }   // item from aitext.js
      else if (ws.length > 1 && RE_GLYPH_W.test(w0)) { ws[0] = '\u0000' + w0; li = 1; }                      // kept as a hidden word
      else if (ws.length > 1 && /^[-*+]$/.test(w0)) li = 4;
      else if (ws.length > 1 && RE_NUM_W.test(w0)) li = 2;
      else if (ws.length <= 5 && !/[\p{L}\p{N}]/u.test(r.s)) li = 3;
    }
    return { s: t.replace(/\s+/g, ' '), words: ws, nw: ws.length, blank: r.blank, mark: mk ? mk[1].length : 0, level: 0, kind: '', bare: false, li, brk };
  }).filter(p => p.words.length);
  const n = P.length;
  const explicit = P.some(p => p.mark);
  // "-" bullets and numbered items count as a list only when there are at least two in a row
  for (let i = 0; i < n; i++) {
    const p = P[i];
    if (p.li !== 4 && p.li !== 2) continue;
    const near = (P[i - 1] && P[i - 1].li === p.li) || (P[i + 1] && P[i + 1].li === p.li);
    if (!near) p.li = 0;
    else if (p.li === 4) { p.li = 1; p.words[0] = '\u0000' + p.words[0]; }
  }
  const noHead = p => p.li === 1 || p.li === 3;

  // 1) explicit markers (ranked so the biggest heading used becomes level 1)
  if (explicit) {
    const ranks = [...new Set(P.filter(p => p.mark).map(p => p.mark))].sort((a, b) => a - b);
    for (const p of P) if (p.mark) { p.level = Math.min(3, ranks.indexOf(p.mark) + 1); p.kind = 'x'; }
  }

  // 2) patterns
  let digitsAlone = 0;
  for (const p of P) if (!p.kind && RE_DIGITS.test(p.s)) digitsAlone++;
  for (let i = 0; i < n; i++) {
    const p = P[i];
    if (p.kind) {
      const ph = patternHeading(p.s, true);
      if (ph && ph.bare) p.bare = true;
      continue;
    }
    if (p.nw > 16 || noHead(p)) continue;
    const ph = patternHeading(p.s, explicit);
    if (!ph) continue;
    if (ph.digits && digitsAlone < 2) continue;
    const next = P[i + 1];
    if (ph.numbered === 1) {
      // "3. Something" — only a heading when body text follows (otherwise it's a list)
      if (!next || next.nw < 12 || RE_NUMBERED.test(next.s)) continue;
    }
    if (ph.numbered && !next) continue;
    p.level = ph.level; p.kind = 'p'; p.bare = ph.bare; p.kw = !!ph.kw;
  }

  // 3) shape (only when the source didn't mark headings itself)
  if (!explicit && n >= 3) {
    const cand = P.map(p => (p.kind || noHead(p) ? 0 : shapeLevel(p.s)));
    const bodyish = q => q && !q.kind && q.nw >= 12;
    const endsSentence = q => !q || q.kind || /[.!?…:"”»’)\]]$/.test(q.s);
    const shaped = [];
    for (let i = 0; i < n; i++) {
      const lv = cand[i];
      if (!lv) continue;
      const p = P[i], prev = P[i - 1], next = P[i + 1];
      if (!next) continue;
      if (i > 0 && !endsSentence(prev) && !cand[i - 1]) continue;
      const need = p.blank >= 2 ? 6 : lv === 3 ? 18 : 12;
      let ok = (next.nw >= need && !cand[i + 1] && !next.kind) || next.kind === 'p';
      // a heading followed by a sub-heading that itself introduces body text
      if (!ok && cand[i + 1] && cand[i + 1] >= lv && bodyish(P[i + 2])) ok = true;
      // the very first line in capitals or Title Case is the document's title (often followed by a byline)
      if (!ok && i === 0 && lv <= 2 && n >= 4) ok = true;
      if (!ok) continue;
      if (lv === 3 && !(p.blank >= 2 || next.nw >= 25)) continue;
      shaped.push(i);
    }
    // Too many "headings" means the shape test doesn't fit this text (poems,
    // lists, chat logs…): keep only the confident ones, or none.
    const share = arr => arr.length / n;
    // (The document title and the name line under "CHAPTER IV" don't count.)
    const sure = i => i === 0 || (P[i - 1] && P[i - 1].kind === 'p' && P[i - 1].bare);
    let keep = shaped.filter(i => !sure(i));
    if (keep.length > 3 && share(keep) > 0.2) keep = keep.filter(i => cand[i] < 3);
    if (keep.length > 3 && share(keep) > 0.25) keep = [];
    keep = keep.concat(shaped.filter(sure));
    for (const i of keep) { P[i].level = cand[i]; P[i].kind = 's'; }
  }

  // 4) "CHAPTER IV" / "The Return" → one heading
  for (let i = 0; i < n - 1; i++) {
    const p = P[i], q = P[i + 1];
    if (!p.kind || !p.bare || q.cont || p.cont) continue;
    if (q.kind === 'p' && q.kw) continue; // the next chapter marker, not a title
    const shortTitle = q.nw <= 14 && q.s.length <= 110 && !/[.,;:]$/.test(q.s) && /^[\p{Lu}\d"“«„'‘(]/u.test(q.s);
    if (!shortTitle) continue;
    if (!q.kind && !(P[i + 2] && P[i + 2].nw >= 6) && i + 2 < n) continue;
    q.kind = p.kind; q.level = p.level; q.cont = true;
  }

  // 5) normalise levels to 1..3 (by rank of what this text actually uses)
  const used = [...new Set(P.filter(p => p.kind).map(p => p.level))].sort((a, b) => a - b);
  for (const p of P) if (p.kind) p.level = Math.min(3, used.indexOf(p.level) + 1);

  const heads = [];
  for (let i = 0; i < n; i++) {
    const p = P[i];
    if (!p.kind || p.cont) continue;
    let j = i, title = p.s.replace(/[.:]$/, '');
    while (j + 1 < n && P[j + 1].cont) { j++; title += ': ' + P[j].s.replace(/[.:]$/, ''); }
    heads.push({ p: i, pEnd: j, level: p.level, title: clip(title) });
  }
  return { paras: P.map(p => ({ words: p.words, level: p.kind ? p.level : 0, li: p.kind ? 0 : p.li, brk: p.brk })), heads };
}
