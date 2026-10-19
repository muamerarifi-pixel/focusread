// Text processing: normalisation, tokenisation, chunking, ORP, timing.
import { analyze } from './structure.js';
import { prepare, withSections } from './aitext.js';

export const F_SENT = 1;   // ends a sentence
export const F_CLAUSE = 2; // ends a clause (, ; : —)
export const F_PARA = 4;
export const F_HEAD = 8;   // part of a heading (title, chapter, subheading)   // ends a paragraph

const LETTER = /[\p{L}\p{N}]/u;
const SENT_END = /[.!?…‽]["'”’»)\]]*$/u;
const CLAUSE_END = /[,;:—–]["'”’»)\]]*$/u;
const ABBREV = /^(p\.sh|etj|dr|mr|mrs|ms|prof|st|nr|fig|vol|e\.g|i\.e|vs|etc|z|znj|zj|sh\.a|p\.k)\.$/i;

/**
 * Basic clean-up. By default the text is also "prepared" (see aitext.js): markdown marks from AI chats are
 * turned into headings and paragraphs, hyphenated line ends are joined, walls of text are split.
 * { plain: true } skips that (used for EPUB / PDF / DOCX, whose importers already structure the text).
 */
export function normalize(text, opts) {
  const t = String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00ad/g, '')          // soft hyphens
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  return opts && opts.plain ? t : prepare(t);
}

export function countWords(text) {
  // "# " heading markers added by the importers are not words
  const m = String(text || '').replace(/^[ \t]*#{1,6}[ \t]+/gm, '').match(/\S+/g);
  return m ? m.length : 0;
}

/** Split into original words (whitespace-delimited) + paragraph ends. */
function splitWords(text) {
  const an = analyze(normalize(text));
  const paras = an.paras;
  const heads = withSections(paras, an.heads);   // + automatic parts in long stretches without headings
  const words = [], paraEnd = [], wl = [], pStart = [];
  for (const p of paras) {
    pStart.push(words.length);
    const ws = p.words;
    for (let i = 0; i < ws.length; i++) { words.push(ws[i]); paraEnd.push(i === ws.length - 1); wl.push(p.level); }
  }
  pStart.push(words.length);
  return {
    words, paraEnd, wl,
    heads: heads.map(h => ({ o: pStart[h.p], oEnd: pStart[h.pEnd + 1], level: h.level, title: h.title, syn: !!h.syn })),
  };
}

function letterCount(w) { let n = 0; for (const ch of w) if (LETTER.test(ch)) n++; return n; }

/** Split an overly long word into readable parts ("ndërkombëta-", "rizimi"). */
function splitLongWord(w, maxLen = 13) {
  const chars = Array.from(w);
  if (letterCount(w) <= maxLen || w.includes('/') || /^https?:/i.test(w)) return [w];
  // prefer existing hyphens
  if (w.includes('-') && w.split('-').every(p => letterCount(p) <= maxLen + 2)) {
    const parts = w.split('-');
    return parts.map((p, i) => (i < parts.length - 1 ? p + '-' : p)).filter(p => p !== '-');
  }
  const n = Math.ceil(chars.length / 9);
  const size = Math.ceil(chars.length / n);
  const out = [];
  for (let i = 0; i < chars.length; i += size) {
    let part = chars.slice(i, i + size).join('');
    if (i + size < chars.length) part += '-';
    out.push(part);
  }
  // avoid tiny tail
  if (out.length > 1 && letterCount(out[out.length - 1]) < 3) {
    const tail = out.pop();
    out[out.length - 1] = out[out.length - 1].replace(/-$/, '') + tail;
  }
  return out;
}

/**
 * Build tokens for reading.
 * returns { tok: string[], flags: Uint8Array, orig: Int32Array (orig word index), origCount, paraStartsOrig }
 */
// ---- Clean mode (academic texts): citations, footnote numbers and links are skipped ----
const RE_BRACKET_REF = /\[\s*\d{1,3}(?:\s*[-–,;]\s*\d{1,3})*\s*\]/g;
const RE_PAREN = /\(([^()]{1,240})\)/g;
const RE_LINK = /(?:https?:\/\/|www\.)\S+|\bdoi:\s?\S+|\b10\.\d{4,9}\/\S+|[\w.+-]+@[\w-]+\.[\w.]+/gi;
const RE_YEAR = /\b(?:1[5-9]|20)\d{2}[a-z]?\b|\bn\.d\.|\bin press\b/i;
const SUPERSCRIPTS = /[¹²³⁰⁴-⁹]+/g;
function isCitation(inner) {
  if (!RE_YEAR.test(inner)) return false;
  const t = inner.trim();
  if (/^(?:1[5-9]|20)\d{2}[a-z]?(?:\s*[,;:]\s*(?:p{1,2}\.\s*)?[\d\-–]+)?$/.test(t)) return true;        // (2019), (2019, p. 4)
  return /\p{Lu}[\p{L}'’\-]+/u.test(t) && (/\bet al\b|[,;&]|\band\b|\bdhe\b/.test(t) || /\p{Lu}[\p{L}'’\-]+\s+(?:1[5-9]|20)\d{2}/u.test(t));
}
/** For one paragraph of words: cleaned text per word ('' = skip). */
function cleanWords(ws) {
  const starts = [];
  let str = '';
  for (let i = 0; i < ws.length; i++) { if (i) str += ' '; starts.push(str.length); str += ws[i]; }
  const drop = new Uint8Array(str.length);
  const mark = (a, b) => { for (let k = a; k < b; k++) drop[k] = 1; };
  for (const m of str.matchAll(RE_BRACKET_REF)) mark(m.index, m.index + m[0].length);
  for (const m of str.matchAll(RE_LINK)) { let e = m.index + m[0].length; while (e > m.index && /[.,;:)\]]/.test(str[e - 1])) e--; mark(m.index, e); }
  for (const m of str.matchAll(RE_PAREN)) if (isCitation(m[1])) {
    let a = m.index; if (a > 0 && str[a - 1] === ' ') a--; // take the space before it too
    mark(a, m.index + m[0].length);
  }
  return ws.map((w, i) => {
    let out = '';
    for (let k = 0; k < w.length; k++) if (!drop[starts[i] + k]) out += w[k];
    out = out.replace(SUPERSCRIPTS, '').replace(/([\p{L}\p{Ll}][.,;:!?"”’)])\d{1,3}$/u, '$1');
    return /[\p{L}\p{N}]/u.test(out) ? out : (out.trim() ? '\u0000' + out.trim() : '');
  });
}

export function tokenize(text, { split = true, clean = false } = {}) {
  const { words: origWords, paraEnd, wl, heads } = splitWords(text);
  let words = origWords;
  if (clean) {
    words = origWords.slice();
    for (let a = 0; a < words.length;) {
      let b = a; while (b < words.length - 1 && !paraEnd[b]) b++;
      if (!wl[a]) { const cw = cleanWords(origWords.slice(a, b + 1)); for (let k = a; k <= b; k++) words[k] = cw[k - a]; }
      a = b + 1;
    }
  }
  const tok = [], flags = [], orig = [], hlv = [];
  const first = new Int32Array(words.length + 1);
  for (let i = 0; i < words.length; i++) {
    let w = words[i];
    const lv = wl[i];
    first[i] = tok.length;
    let f = 0;
    const punctOnly = w.startsWith('\u0000');
    if (punctOnly) w = w.slice(1);
    if (paraEnd[i]) f |= F_PARA | F_SENT;
    else if (w && SENT_END.test(w) && !ABBREV.test(w) && !/^\d+\.$/.test(w)) f |= F_SENT;
    else if (w && CLAUSE_END.test(w)) f |= F_CLAUSE;
    if (!w || punctOnly) { // skipped in clean mode: keep its sentence/paragraph end on the previous word
      if (tok.length && f) flags[flags.length - 1] |= f;
      const pc = punctOnly ? w.replace(/[^.,;:!?…]/g, '') : '';
      if (pc && tok.length) tok[tok.length - 1] = tok[tok.length - 1].replace(/[.,;:]$/, '') + pc.slice(-1);
      continue;
    }
    const parts = split && !lv ? splitLongWord(w) : [w];
    for (let j = 0; j < parts.length; j++) {
      tok.push(parts[j]);
      flags.push((j === parts.length - 1 ? f : 0) | (lv ? F_HEAD : 0));
      orig.push(i);
      hlv.push(lv);
    }
  }
  first[words.length] = tok.length;
  if (!tok.length) { tok.push('…'); flags.push(F_PARA | F_SENT); orig.push(0); hlv.push(0); }
  const H = heads.map(h => ({ ...h, t: first[h.o], e: first[h.oEnd] })).filter(h => h.t < tok.length);
  const shown = clean ? words.map(w => (w.startsWith('\u0000') ? w.slice(1) : w)) : origWords;
  return {
    tok, flags: Uint8Array.from(flags), orig: Int32Array.from(orig), origCount: origWords.length, words: shown,
    hlv: Uint8Array.from(hlv), heads: H, topLevel: H.length ? Math.min(...H.map(h => h.level)) : 1,
  };
}

/** Chunk boundaries: returns Int32Array of chunk start token indexes (plus sentinel = tok.length). */
export function buildChunks(T, mode) {
  const starts = [];
  const n = T.tok.length;
  let i = 0;
  while (i < n) {
    starts.push(i);
    if (T.flags[i] & F_HEAD) {
      let j = i;
      while (j < n && (T.flags[j] & F_HEAD)) { j++; if ((T.flags[j - 1] & F_PARA) || j - i >= 7) break; }
      i = j;
      continue;
    }
    if (mode === 1) { i++; continue; }
    const max = mode === 2 ? 2 : 3;
    let j = i, chars = 0;
    while (j < n) {
      chars += T.tok[j].length + 1;
      const f = T.flags[j];
      j++;
      const count = j - i;
      if (f & (F_SENT | F_PARA)) break;
      if (count >= max) break;
      if (mode === 3 && (f & F_CLAUSE) && count >= 1) break;
      if (mode === 3 && chars > 20) break;
      if (T.tok[j - 1].endsWith('-') && letterCount(T.tok[j - 1]) > 8) break; // split part
      if (j < n && mode === 3 && chars + T.tok[j].length > 24) break;
    }
    i = j;
  }
  starts.push(n);
  return Int32Array.from(starts);
}

/** Binary search: chunk index that contains token index ti. */
export function chunkOfToken(starts, ti) {
  let lo = 0, hi = starts.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= ti) lo = mid; else hi = mid - 1;
  }
  return Math.max(0, lo);
}

/** First token index for an original word index. */
export function tokenOfOrig(T, oi) {
  let lo = 0, hi = T.orig.length - 1;
  if (hi < 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (T.orig[mid] < oi) lo = mid + 1; else hi = mid;
  }
  return lo;
}

export function sentenceStart(T, ti) {
  let i = ti;
  while (i > 0 && !(T.flags[i - 1] & F_SENT)) i--;
  return i;
}
export function prevSentenceStart(T, ti) {
  const s = sentenceStart(T, ti);
  if (ti - s > 1 || s === 0) return s; // go to start of current sentence first
  return sentenceStart(T, s - 1);
}
export function nextSentenceStart(T, ti) {
  let i = ti;
  while (i < T.tok.length - 1 && !(T.flags[i] & F_SENT)) i++;
  return Math.min(T.tok.length - 1, i + 1);
}

/** Optimal recognition point index within the letter-core of a word. */
export function orpIndex(len) {
  if (len <= 1) return 0;
  if (len <= 5) return 1;
  if (len <= 9) return 2;
  if (len <= 13) return 3;
  return 4;
}

const esc = s => s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
export { esc };

/** Split a word into left / pivot / right HTML, with optional bionic bolding. */
export function wordParts(word, { orp = true, bionic = false } = {}) {
  const chars = Array.from(word);
  let a = chars.findIndex(c => LETTER.test(c));
  let b = -1;
  for (let i = chars.length - 1; i >= 0; i--) if (LETTER.test(chars[i])) { b = i; break; }
  if (a < 0) { a = 0; b = chars.length - 1; }
  const core = b - a + 1;
  const pivot = orp ? a + orpIndex(core) : -1;
  const boldEnd = bionic && core > 1 ? a + Math.max(1, Math.round(core * (core <= 3 ? 0.5 : 0.45))) : (bionic ? b + 1 : -1);
  const seg = (from, to) => {
    let out = '', inB = false;
    for (let i = from; i < to; i++) {
      const bold = i < boldEnd && i >= a;
      if (bold && !inB) { out += '<b>'; inB = true; }
      if (!bold && inB) { out += '</b>'; inB = false; }
      out += esc(chars[i]);
    }
    if (inB) out += '</b>';
    return out;
  };
  if (pivot < 0) return { left: '', pivot: seg(0, chars.length), right: '' };
  return { left: seg(0, pivot), pivot: seg(pivot, pivot + 1), right: seg(pivot + 1, chars.length) };
}

export function wordHTML(word, bionic) {
  const p = wordParts(word, { orp: false, bionic });
  return p.pivot;
}

/** Delay (ms) for showing chunk [s, e). */
export function chunkDelay(T, s, e, S, rampStep) {
  const base = 60000 / S.wpm;
  const n = e - s;
  let ms = base * n;
  if (S.smart) {
    const f = T.flags[e - 1];
    if (f & F_PARA) ms += base * 1.8;
    else if (f & F_SENT) ms += base * 1.2;
    else if (f & F_CLAUSE) ms += base * 0.5;
    let longest = 0, digits = false;
    for (let i = s; i < e; i++) {
      const w = T.tok[i];
      const L = letterCount(w);
      if (L > longest) longest = L;
      if (/\d/.test(w)) digits = true;
      if (/[)\]]$/.test(w)) ms += base * 0.15;
    }
    if (longest > 7) ms += Math.min(8, longest - 7) * base * 0.1;
    if (longest <= 3 && n === 1 && !(T.flags[e - 1] & (F_SENT | F_CLAUSE))) ms -= base * 0.15; // short function words
    if (digits) ms += base * 0.3;
  }
  if (T.flags[s] & F_HEAD) ms = base * n * 1.15 + (T.hlv && T.hlv[s] === 1 ? 1000 : 650);
  if (S.ramp && rampStep != null && rampStep < 10) ms *= 1 + 0.7 * (1 - rampStep / 10);
  return Math.max(55, Math.round(ms));
}

/** Rough reading-time estimate in minutes for n words at settings S. */
export function estimateMinutes(words, S) {
  return (words / S.wpm) * (S.smart ? 1.18 : 1);
}

export function guessTitle(text, fallback) {
  const first = normalize(text).split('\n').map(s => s.trim()).find(Boolean) || '';
  if (first && first.length <= 80) return first.replace(/^#+\s*/, '');
  const w = first.split(/\s+/).slice(0, 7).join(' ');
  return w ? w + '…' : fallback;
}

export function stripMarkdown(md) {
  return md
    .replace(/```[\s\S]*?```/g, m => m.replace(/```\w*/g, ''))
    .replace(/^([^\n#>|].*\S)[ \t]*\n={2,}[ \t]*$/gm, '# $1')       // Setext H1
    .replace(/^([^\n#>|\-*+].*\S)[ \t]*\n-{3,}[ \t]*$/gm, '## $1')  // Setext H2
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // keep headings as "# Title" so the reader can find chapters
    .replace(/^\s{0,3}(#{1,6})\s+(.*)$/gm, (_, m, h) => '\n' + m + ' ' + h.replace(/\s*#+\s*$/, '').replace(/(\*\*|__|\*|_)(.*?)\1/g, '$2') + '\n')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '\n')
    .replace(/^\s*\d+\.\s+/gm, '\n')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/^\s*([-*_]\s*){3,}$/gm, '')
    .replace(/<[^>]+>/g, '');
}
