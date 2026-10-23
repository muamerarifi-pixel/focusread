// Text preparation for the reader (FocusRead v6.7).
//
//  prepare(text)  - makes text copied from an AI chat (ChatGPT, Gemini, Claude...), from a PDF or from a
//                   long web page easier to read: markdown marks (** # - | ---) become what they meant
//                   ("# Heading" lines, one paragraph per item), hyphenated line ends are joined and
//                   walls of text get paragraph breaks.
//  withSections() - long stretches without headings get automatic parts, so the table of contents
//                   is never empty or useless.
//
// Conservative by design: text that does not look like markdown or a wall of text comes back unchanged,
// and the importers' own "# Heading" lines (EPUB, PDF, DOCX) are left alone.

const MAX_LEN = 600000;        // bigger texts are books: the importers already gave them structure
const LINE_SPLIT_MAX = 60000;  // "one paragraph per line" only for chat-sized texts
const WALL = 160;              // words: a longer paragraph is split
const GAP_MAX = 3200;          // words without a heading before automatic parts are added
const TARGET = 1500;           // words per automatic part

const wc = s => { const m = String(s).match(/\S+/g); return m ? m.length : 0; };

const RE_HEAD = /^[ \t]{0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const RE_HEAD_G = /^([ \t]{0,3}#{1,6}[ \t]+)(.*)$/gm;
const RE_HR = /^[ \t]*([-*_=])(?:[ \t]*\1){2,}[ \t]*$/;
const RE_BULLET = /^([ \t]*)([-*+•·▪▫◦‣●○■□➤➢►▸])[ \t]+(\S.*)$/;
const RE_GLYPH = /^[ \t]*[•·▪▫◦‣●○■□➤➢►▸][ \t]+\S/;
const RE_ORDERED = /^([ \t]*)(\d{1,3})[.)][ \t]+(\S.*)$/;
const RE_TABLE_ROW = /^[ \t]*\|.*\|[ \t]*$/;
const RE_BOLD_LINE = /^[ \t]*(?:\*\*|__)(?=\S)((?:(?!\*\*|__).){1,120}?)(?:\*\*|__)[ \t]*:?[ \t]*$/;
const RE_ART = /^(?:Copy code|Copy|Regenerate(?: response)?|Show thinking|Hide thinking|(?:ChatGPT|Gemini|Claude|You) (?:said|responded)[ \t]*:?|Thought for \d+ ?\w+)$/i;
const RE_LEAD_EMOJI = /^(?:[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]|[0-9#*]\uFE0F?\u20E3)+[ \t]*/u;

const isSep = l => l.indexOf('|') >= 0 && l.indexOf('--') >= 0 && /^[\s|:-]+$/.test(l);

function classify(l) {
  if (!l.trim()) return '';
  if (RE_HEAD.test(l)) return 'h';
  if (RE_HR.test(l)) return 'r';
  if (isSep(l) || RE_TABLE_ROW.test(l)) return 't';
  if (RE_BULLET.test(l)) return 'b';
  if (RE_ORDERED.test(l)) return 'o';
  return 'p';
}

/** Inline markdown: **bold**, *italic*, `code`, [links](url), footnote marks from chat apps. */
function inline(s) {
  if (!/[*_`~\[<\\\u3010\ue000-\uf8ff]/.test(s)) return s;
  s = s.replace(/\ue200[^\ue201]*\ue201/g, '').replace(/[\ue000-\uf8ff]/g, '')
    .replace(/\u3010[^\u3011]{0,80}\u3011/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\((?:[^()\s]|\([^()]*\))*(?:[ \t]+"[^"]*")?\)/g, '$1')
    .replace(/<(https?:\/\/[^>\s]+)>/g, '$1')
    .replace(/<br[ \t]*\/?>/gi, ' ')
    .replace(/`+([^`\n]+)`+/g, '$1')
    .replace(/(\*\*|__)(?=\S)([^\n]*?\S)\1/g, '$2')
    .replace(/~~(?=\S)([^\n]*?\S)~~/g, '$1');
  s = s.replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*[^\s*])\*(?![\w*])/g, '$1$2');
  s = s.replace(/(^|[^\w_])_(?=[^\s_])([^_\n]*[^\s_])_(?![\w_])/g, '$1$2');
  return s.replace(/\\([*_`#\[\]()>~|!.+-])/g, '$1').replace(/\*\*+/g, '');
}
const clean = s => inline(s).replace(RE_LEAD_EMOJI, '').replace(/[ \t]+/g, ' ').trim();

/** Consecutive list lines (no blank line between) form a "tight" list. */
function tightLines(lines, kinds) {
  const n = lines.length, tight = new Uint8Array(n);
  let runs = 0;
  for (let i = 0; i < n;) {
    const k = kinds[i];
    if (k !== 'b' && k !== 'o') { i++; continue; }
    let j = i, cnt = 1;
    while (j + 1 < n && (kinds[j + 1] === k || (kinds[j + 1] === 'p' && /^[ \t]{2,}\S/.test(lines[j + 1])))) { j++; if (kinds[j] === k) cnt++; }
    if (cnt >= (k === 'b' ? 2 : 3)) { runs++; for (let x = i; x <= j; x++) tight[x] = 1; }
    i = j + 1;
  }
  return { tight, runs };
}

function scan(text, lines, kinds) {
  let nHead = 0, nHr = 0, nGlyph = 0, nSep = 0;
  for (let i = 0; i < lines.length; i++) {
    const k = kinds[i];
    if (k === 'h') nHead++;
    else if (k === 'r') nHr++;
    else if (k === 'b' && RE_GLYPH.test(lines[i])) nGlyph++;
    else if (k === 't' && isSep(lines[i])) nSep++;
  }
  const { tight, runs } = tightLines(lines, kinds);
  const bold = (text.match(/\*\*(?!\s)[^*\n]{1,150}\*\*/g) || []).length;
  const fences = (text.match(/^[ \t]*(?:```|~~~)/gm) || []).length;
  const links = (text.match(/\[[^\]\n]{1,150}\]\((?:https?:\/\/|\/|#|mailto:)[^)\n]*\)/g) || []).length;
  // chat markdown has bold, tables, code blocks or links; headings + bullet lists alone count when they come together
  const strong = bold >= 2 || fences >= 2 || nSep > 0 || links >= 2 || (nHead >= 2 && runs >= 1);
  return { strong, need: strong || nHr > 0 || nGlyph > 0 || runs > 0, nHead, tight };
}

function table(lines, i, out, gap) {
  const rows = [];
  let j = i;
  while (j < lines.length && classify(lines[j]) === 't') rows.push(lines[j++]);
  const cells = r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(clean);
  let hd = null, data = rows;
  if (rows.length > 1 && isSep(rows[1])) { hd = cells(rows[0]); data = rows.slice(2); }
  for (const r of data) {
    if (isSep(r)) continue;
    const c = cells(r);
    if (!c.some(Boolean)) continue;
    let t;
    if (hd && c.length === hd.length && c.length > 2 && c[0]) t = c[0] + ' — ' + c.slice(1).map((v, x) => (v ? hd[x + 1] + ': ' + v : '')).filter(Boolean).join('; ');
    else if (c.length === 2 && c[0] && c[1]) t = c[0] + ': ' + c[1];
    else t = c.filter(Boolean).join('; ');
    gap(); out.push(t);
  }
  return j;
}

function convert(lines, kinds, info) {
  const { strong, tight } = info;
  const n = lines.length;
  let maxHead = 0;
  for (let i = 0; i < n; i++) if (kinds[i] === 'h') { const d = RE_HEAD.exec(lines[i])[1].length; if (d > maxHead) maxHead = d; }
  const sub = maxHead ? Math.min(6, maxHead + 1) : 2;   // bold lines become headings one level below the deepest real one
  const out = [];
  const gap = () => { if (out.length && out[out.length - 1] !== '') out.push(''); };
  const mark = () => { if (brk && out.length && out[out.length - 1] && out[out.length - 1][0] !== '#') { out[out.length - 1] = '\u2042\u2060' + out[out.length - 1]; } brk = false; };
  const head = (lv, t) => {
    t = clean(t).replace(/[:：]+$/, '');
    if (!t || !/[\p{L}\p{N}]/u.test(t)) return;
    gap(); out.push('#'.repeat(lv) + ' ' + t); out.push(''); brk = false;
  };
  let fence = false, cont = false, item = false, brk = false;
  // a line under a list item that carries on from it (indented, lower case, or the item isn't finished) is part of it
  const goesOn = l => item && out.length && (/^[ \t]{2,}\S/.test(l) || /^\p{Ll}/u.test(l.trim()) || !/[.!?…:;"”»)\]]$/.test(out[out.length - 1]));
  for (let i = 0; i < n; i++) {
    const l = lines[i], k = kinds[i];
    if (strong && /^[ \t]*(?:```|~~~)/.test(l)) { fence = !fence; gap(); cont = false; continue; }
    if (fence) { if (l.trim()) { gap(); out.push(l.trim()); } continue; }
    if (k === '' || k === 'r') { if (k === 'r' && out.length) brk = true; gap(); cont = false; item = false; continue; }
    if (k === 'h') { const m = RE_HEAD.exec(l); head(m[1].length, m[2]); cont = false; item = false; continue; }
    if (k === 't' && strong) { i = table(lines, i, out, gap) - 1; gap(); cont = false; continue; }
    if ((k === 'b' || k === 'o') && (strong || tight[i] || (k === 'b' && RE_GLYPH.test(l)))) {
      const m = (k === 'b' ? RE_BULLET : RE_ORDERED).exec(l);
      const num = k === 'o' ? m[2] : '';
      let body = m[3].replace(/^\[[ xX]\][ \t]+/, '');
      const bb = strong ? RE_BOLD_LINE.exec(body) : null;
      if (bb && !/[.!]$/.test(bb[1].trim())) { head(sub, (num ? num + '. ' : '') + bb[1]); cont = false; item = false; continue; }
      body = clean(body);
      if (!body) continue;
      // "\u2022\u2060" tells structure.js "bullet item" without adding a word
      gap(); out.push(num ? num + '. ' + body : '\u2022\u2060' + body); mark(); cont = false; item = true;
      continue;
    }
    if (goesOn(l)) { const t2 = strong ? clean(l.trim().replace(/^(?:>[ \t]*)+/, '')) : l.trim(); if (t2) out[out.length - 1] += ' ' + t2; continue; }
    item = false;
    if (!strong) { if (!cont) gap(); out.push(l); if (!cont) mark(); cont = true; continue; }
    let t = l.trim().replace(/^(?:>[ \t]*)+/, '');
    if (RE_ART.test(t)) continue;
    const bb = RE_BOLD_LINE.exec(t);
    if (bb && !/[.!]$/.test(bb[1].trim())) { head(sub, bb[1]); cont = false; continue; }
    t = clean(t);
    if (!t) continue;
    const prev = out[out.length - 1];
    // a line that carries on from a long, unfinished line above is a wrapped line, not a new paragraph
    if (cont && prev && prev.length >= 60 && !/[.!?…:;"”»)\]]$/.test(prev) && /^\p{Ll}/u.test(t)) out[out.length - 1] = prev + ' ' + t;
    else { gap(); out.push(t); mark(); }
    cont = true;
  }
  return out.join('\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');
}

/** Plain-text copies of chat answers: list items and short lines arrive one per line, without any marks. */
function splitLines(text) {
  if (text.indexOf('\n') < 0) return text;
  const parts = text.split(/(\n[ \t]*\n\s*)/);
  let changed = false;
  for (let i = 0; i < parts.length; i += 2) {
    const p = parts[i];
    if (p.length < 40 || p.indexOf('\n') < 0) continue;
    let ls = p.split('\n').map(x => x.trim()).filter(Boolean);
    if (ls.length < 3 || ls.length > 60 || ls.some(x => x.length > 180 || x.charCodeAt(0) === 35)) continue;
    let max = Math.max(...ls.map(x => x.length));
    let first = '';
    if (ls[0].length < max * 0.5 && ls[0].length <= 60 && !/[.!?…:;,"”»)]$/.test(ls[0])) { first = ls.shift(); max = Math.max(...ls.map(x => x.length)); }
    if (ls.length < 2) continue;
    if (max >= 45) {
      const body = ls.slice(0, -1);
      if (body.filter(x => x.length >= max * 0.75).length >= body.length * 0.6) continue;   // hard-wrapped prose stays together
    }
    if (wc(p) < 12) continue;
    parts[i] = (first ? first + '\n\n' : '') + ls.join('\n\n');
    changed = true;
  }
  return changed ? parts.join('') : text;
}

const ABBR = /^(?:p\.sh|etj|dr|mr|mrs|ms|prof|st|nr|fig|vol|e\.g|i\.e|vs|etc|z|znj|zj|sh\.a|p\.k)\.$/i;
function sentences(s) {
  const out = [], re = /([.!?…]+["'”’»)\]]*)(\s+)(?=["'“«„‘(\[]?[\p{Lu}\d])/gu;
  let start = 0, m;
  while ((m = re.exec(s))) {
    const end = m.index + m[1].length;
    const word = s.slice(s.lastIndexOf(' ', m.index) + 1, end);
    if (ABBR.test(word) || /^\p{Lu}\.$/u.test(word) || /^\d+\.$/.test(word)) continue;
    out.push(s.slice(start, end));
    start = m.index + m[0].length;
  }
  if (start < s.length) out.push(s.slice(start));
  return out;
}
function regroup(sents) {
  const out = [];
  let cur = [], w = 0;
  for (const s of sents) {
    const sw = wc(s);
    if (cur.length && w >= 45 && w + sw > 95) { out.push(cur.join(' ')); cur = []; w = 0; }
    cur.push(s); w += sw;
  }
  if (cur.length) { if (out.length && w < 22) out[out.length - 1] += ' ' + cur.join(' '); else out.push(cur.join(' ')); }
  return out;
}
/** A paragraph of more than WALL words is cut into paragraphs of roughly 45-95 words at sentence ends. */
function splitWalls(text) {
  if (text.length < 1000) return text;
  const parts = text.split(/(\n[ \t]*\n\s*)/);
  let changed = false;
  for (let i = 0; i < parts.length; i += 2) {
    const p = parts[i];
    if (p.length < 1000 || p.charCodeAt(0) === 35) continue;
    const ls = p.split('\n');
    let first = '';
    if (ls.length > 1 && wc(ls[0]) <= 8 && ls[0].trim().length <= 60 && !/[.!?…:;,"”»)]$/.test(ls[0].trim()) && /^\p{Lu}/u.test(ls[0].trim())) first = ls.shift().trim();
    const flat = ls.join(' ').replace(/\s+/g, ' ').trim();
    if (wc(flat) <= WALL) continue;
    const gs = regroup(sentences(flat));
    if (gs.length < 2) continue;
    parts[i] = (first ? first + '\n\n' : '') + gs.join('\n\n');
    changed = true;
  }
  return changed ? parts.join('') : text;
}

let memo = { a: '', b: '' };
export function prepare(text) {
  if (!text || text.length < 60 || text.length > MAX_LEN) return text;
  if (text === memo.a) return memo.b;
  let out = text;
  try {
    out = out.replace(/(\p{Ll})-\n[ \t]*(\p{Ll})/gu, '$1$2');   // "inter-\nnational" -> "international"
    const lines = out.split('\n');
    const kinds = lines.map(classify);
    const info = scan(out, lines, kinds);
    if (info.need) out = convert(lines, kinds, info);
    else if (info.nHead) out = out.replace(RE_HEAD_G, (m, a, b) => { const c = /[*_`\[\\<]/.test(b) ? clean(b) : ''; return c ? a + c : m; });
    if (!info.strong && out.length <= LINE_SPLIT_MAX) out = splitLines(out);
    out = splitWalls(out).trim();
  } catch (e) { out = text; }
  memo = { a: text, b: out };
  return out;
}

function sectionTitle(ws, n, top, sq) {
  // the whole opening sentence (at least 4 words), not a clipped snippet
  const END = /[.!?…]["'”’»)\]]*$/;
  let k = 0;
  while (k < ws.length - 1 && k < 60 && !(k >= 3 && END.test(ws[k]))) k++;
  const take = ws.slice(0, k + 1).join(' ').replace(/\u0000/g, '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/[\s,;:–—-]+$/, '');
  let snip = take.charAt(0).toUpperCase() + take.slice(1);
  if (END.test(ws[k])) snip = snip.replace(/\.(["'”’»)\]]*)$/, '$1'); else if (k < ws.length - 1) snip += '…';
  return top ? (sq ? 'Pjesa ' : 'Part ') + n + ' · ' + snip : n + ' · ' + snip;
}

/**
 * paras: [{ words, level }], heads: [{ p, pEnd, level, title }] as returned by structure.js analyze().
 * Returns heads plus automatic parts ({ ..., syn: true }) wherever 3200+ words pass without a heading.
 */
export function withSections(paras, heads) {
  const n = paras.length;
  if (n < 4) return heads;
  const nw = paras.map(p => p.words.length);
  let total = 0;
  for (const x of nw) total += x;
  if (total < 2600) return heads;
  const topLevel = heads.length ? Math.min(...heads.map(h => h.level)) : 1;
  let sample = '';
  for (let i = 0; i < n && sample.length < 4000; i++) sample += paras[i].words.join(' ') + ' ';
  const sq = (sample.match(/[ëçËÇ]/g) || []).length / Math.max(1, sample.length) > 0.004;
  const gaps = [];
  let from = 0, parent = 0;
  for (const h of heads) { if (h.p > from) gaps.push([from, h.p, parent]); from = h.pEnd + 1; parent = h.level; }
  if (from < n) gaps.push([from, n, parent]);
  const add = [];
  for (const [a, b, par] of gaps) {
    let w = 0;
    for (let i = a; i < b; i++) w += nw[i];
    if (w < GAP_MAX) continue;
    const k = Math.max(2, Math.round(w / TARGET)), size = w / k;
    const starts = [a];
    let acc = 0, next = size;
    for (let i = a; i < b; i++) {
      if (i > a && acc >= next && starts.length < k && w - acc >= size * 0.4) { starts.push(i); next += size; }
      acc += nw[i];
    }
    const level = par ? Math.min(3, par + 1) : topLevel;
    starts.forEach((p, idx) => add.push({ p, pEnd: p, level, title: sectionTitle(paras[p].words, idx + 1, !par, sq), syn: true }));
  }
  if (!add.length) return heads;
  return heads.concat(add).sort((x, y) => x.p - y.p || x.level - y.level);
}
