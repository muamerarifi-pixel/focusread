// Offline file importers: TXT, MD, HTML, PDF (pdf.js), EPUB & DOCX (JSZip).
// Vendor libraries are loaded lazily from /vendor and precached by the service worker.
import { stripMarkdown, normalize } from './text.js';

const loaded = {};
function loadScript(src) {
  if (loaded[src]) return loaded[src];
  loaded[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = resolve;
    s.onerror = () => { delete loaded[src]; reject(new Error('Could not load ' + src)); };
    document.head.appendChild(s);
  });
  return loaded[src];
}
async function getJSZip() { await loadScript('/vendor/jszip.min.js'); return window.JSZip; }
async function getPdfjs() {
  await loadScript('/vendor/pdf.min.js');
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js';
  return lib;
}

const baseName = name => name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
const ext = name => (name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();

export const ACCEPT = '.txt,.md,.markdown,.text,.html,.htm,.xhtml,.pdf,.epub,.docx,.json,.csv,.srt,text/plain,text/markdown,text/html,application/pdf,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function detectKind(file) {
  const e = ext(file.name);
  const type = file.type || '';
  if (e === 'pdf' || type === 'application/pdf') return 'pdf';
  if (e === 'epub' || type === 'application/epub+zip') return 'epub';
  if (e === 'docx' || type.includes('wordprocessingml')) return 'docx';
  if (['html', 'htm', 'xhtml'].includes(e) || type === 'text/html') return 'html';
  if (['md', 'markdown'].includes(e) || type === 'text/markdown') return 'md';
  if (e === 'srt') return 'srt';
  if (e === 'json') return 'json';
  if (['txt', 'text', 'csv', ''].includes(e) || type.startsWith('text/')) return 'txt';
  return null;
}

/** Decode text trying UTF-8 first, then Windows-1250 (common for Albanian/central-European files). */
async function readText(file) {
  const buf = await file.arrayBuffer();
  let s = new TextDecoder('utf-8').decode(buf);
  if (s.includes('�')) {
    try { const alt = new TextDecoder('windows-1250').decode(buf); if (!alt.includes('�')) s = alt; } catch {}
  }
  return s.replace(/^﻿/, '');
}

const BLOCKS = 'p,div,h1,h2,h3,h4,h5,h6,li,blockquote,pre,section,article,header,footer,tr,dt,dd,figcaption,aside,table,ul,ol,hr';
/** Extract readable text from an HTML string, keeping paragraph breaks. */
export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.body || doc.documentElement;
  body.querySelectorAll('script,style,noscript,svg,math,template,iframe,object').forEach(n => n.remove());
  const title = (doc.querySelector('title')?.textContent || doc.querySelector('h1')?.textContent || '').trim();
  markHeadings(body);
  body.querySelectorAll('br').forEach(n => n.replaceWith('\n'));
  body.querySelectorAll(BLOCKS).forEach(n => { n.before('\n\n'); n.append('\n\n'); });
  body.querySelectorAll('td,th').forEach(n => n.append(' '));
  const text = (body.textContent || '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  return { title, text: text.trim() };
}

const HEAD_CLASS = /(?:^|[\s_-])(?:chapter|chap|part|book|heading|head|title|subtitle|subhead|section)(?:[\s_-]|title|head|heading|num|number|name|$)/i;
/** Turn real headings into "# Title" lines (level = h1…h6) so the reader can find chapters. */
function markHeadings(body) {
  const clean = el => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const mark = (el, level) => {
    const txt = clean(el);
    if (!txt || txt.length > 200 || !/[\p{L}\p{N}]/u.test(txt)) return;
    el.textContent = '#'.repeat(level) + ' ' + txt;
    el.before('\n\n'); el.after('\n\n');
  };
  for (const h of [...body.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')]) {
    if (!h.isConnected || h.closest('nav')) continue;
    const level = /^h\d$/i.test(h.tagName) ? +h.tagName[1] : (+h.getAttribute('aria-level') || 2);
    mark(h, Math.min(6, Math.max(1, level)));
  }
  // EPUBs often style chapter titles as <p class="chapter-title"> instead of <h1>
  for (const el of [...body.querySelectorAll('p[class],div[class]')]) {
    if (!el.isConnected || el.closest('nav') || !HEAD_CLASS.test(el.className) || el.querySelector('p,div,h1,h2,h3,h4,h5,h6,li,table')) continue;
    const txt = clean(el);
    if (!txt || /^#{1,6} /.test(txt) || txt.length > 120 || /[.,;]$/.test(txt)) continue;
    mark(el, /chap|part|book|^title|[\s_-]title/i.test(el.className) && !/sub/i.test(el.className) ? 1 : 2);
  }
}

/** Chapter names from the EPUB table of contents (nav.xhtml or toc.ncx), by file path. */
async function epubTocTitles(zip, opf, base, manifest, xml) {
  const map = {};
  const dirOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const add = (dir, src, label) => {
    const path = resolvePath(dir, src);
    label = (label || '').replace(/\s+/g, ' ').trim();
    if (path && label && !map[path]) map[path] = label;
  };
  try {
    const navItem = [...opf.querySelectorAll('manifest > item')].find(it => /(^|\s)nav(\s|$)/.test(it.getAttribute('properties') || ''));
    if (navItem) {
      const path = resolvePath(base, navItem.getAttribute('href'));
      const str = await zip.file(path)?.async('string');
      if (str) {
        const d = new DOMParser().parseFromString(str, 'application/xhtml+xml');
        const navs = [...d.getElementsByTagNameNS('*', 'nav')];
        const nav = navs.find(n => /toc/.test(n.getAttribute('epub:type') || n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '')) || navs[0];
        if (nav) for (const a of nav.getElementsByTagNameNS('*', 'a')) { const h = a.getAttribute('href'); if (h) add(dirOf(path), h, a.textContent); }
      }
    }
    if (!Object.keys(map).length) {
      const ncxId = opf.querySelector('spine')?.getAttribute('toc');
      const ncxHref = (ncxId && manifest[ncxId]) || Object.values(manifest).find(h => /\.ncx$/i.test(h || ''));
      if (ncxHref) {
        const path = resolvePath(base, ncxHref);
        const str = await zip.file(path)?.async('string');
        if (str) {
          for (const np of xml(str).getElementsByTagNameNS('*', 'navPoint')) {
            const kids = [...np.children];
            const src = kids.find(c => c.localName === 'content')?.getAttribute('src');
            const label = kids.find(c => c.localName === 'navLabel')?.textContent;
            if (src) add(dirOf(path), src, label);
          }
        }
      }
    }
  } catch { /* a broken TOC never blocks the import */ }
  return map;
}

/** Make sure a chapter file starts with its TOC title as a heading. */
function withChapterTitle(text, label) {
  text = text.trim();
  if (!label || !text || /^#{1,6} /m.test(text.slice(0, 800))) return text;
  const simp = x => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const nl = text.indexOf('\n\n');
  const firstPara = nl < 0 ? text : text.slice(0, nl);
  if (simp(firstPara) === simp(label)) return '# ' + firstPara.replace(/\s+/g, ' ') + text.slice(firstPara.length);
  return '# ' + label + '\n\n' + text;
}

function resolvePath(base, href) {
  const parts = (base ? base.split('/') : []);
  for (const seg of decodeURIComponent(href.split('#')[0]).split('/')) {
    if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

async function importEpub(file) {
  const JSZip = await getJSZip();
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = s => new DOMParser().parseFromString(s, 'application/xml');
  const container = await zip.file('META-INF/container.xml')?.async('string');
  if (!container) throw new Error('EPUB container missing');
  const opfPath = xml(container).querySelector('rootfile')?.getAttribute('full-path');
  const opfStr = await zip.file(opfPath)?.async('string');
  if (!opfStr) throw new Error('EPUB package missing');
  const opf = xml(opfStr);
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
  const manifest = {};
  opf.querySelectorAll('manifest > item').forEach(it => { manifest[it.getAttribute('id')] = it.getAttribute('href'); });
  const title = (opf.getElementsByTagNameNS('*', 'title')[0]?.textContent || '').trim();
  const author = (opf.getElementsByTagNameNS('*', 'creator')[0]?.textContent || '').trim();
  const tocTitles = await epubTocTitles(zip, opf, base, manifest, xml);
  const parts = [];
  for (const ref of opf.querySelectorAll('spine > itemref')) {
    const href = manifest[ref.getAttribute('idref')];
    if (!href) continue;
    const f = zip.file(resolvePath(base, href));
    if (!f) continue;
        const text = withChapterTitle(htmlToText(await f.async('string')).text, tocTitles[resolvePath(base, href)]);
    if (text) parts.push(text);
  }
  return { title, author, text: parts.join('\n\n') };
}

async function importDocx(file) {
  const JSZip = await getJSZip();
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!docXml) throw new Error('DOCX document missing');
  const parse = str => new DOMParser().parseFromString(str, 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const attr = (el, name) => (el ? (el.getAttributeNS(W, name) ?? el.getAttribute('w:' + name) ?? '') : '');
  const child = (el, name) => (el ? [...el.children].find(c => c.localName === name) : undefined);
  const val = el => attr(el, 'val');

  // style id -> heading rank: 0 = Title, n = Heading n; 'toc' = table-of-contents lines
  const styles = {}, basedOn = {};
  const stylesXml = await zip.file('word/styles.xml')?.async('string');
  if (stylesXml) {
    for (const st of parse(stylesXml).getElementsByTagNameNS('*', 'style')) {
      const id = attr(st, 'styleId');
      if (!id) continue;
      const name = val(child(st, 'name')).toLowerCase();
      const ol = val(child(child(st, 'pPr'), 'outlineLvl'));
      let rank = null, m;
      if (name === 'title') rank = 0;
      else if ((m = name.match(/^heading\s*(\d)/))) rank = +m[1];
      else if (/^toc\s*\d|^toc heading|^table of figures/.test(name)) rank = 'toc';
      else if (ol !== '' && +ol < 9) rank = +ol + 1;
      styles[id] = rank;
      const b = val(child(st, 'basedOn'));
      if (b) basedOn[id] = b;
    }
    for (const id of Object.keys(styles)) {
      let cur = id, hops = 0;
      while (styles[id] == null && basedOn[cur] && hops++ < 6) { cur = basedOn[cur]; if (styles[cur] != null && styles[cur] !== 'toc') styles[id] = styles[cur]; }
    }
  }

  const doc = parse(docXml);
  const items = [];
  for (const p of doc.getElementsByTagNameNS('*', 'p')) {
    let s = '';
    const walk = n => {
      for (const c of n.childNodes) {
        if (c.nodeType !== 1) continue;
        const ln = c.localName;
        if (ln === 't') s += c.textContent;
        else if (ln === 'tab') s += ' ';
        else if (ln === 'br' || ln === 'cr') s += '\n';
        else if (ln === 'p') continue; // nested paragraphs handled separately
        else walk(c);
      }
    };
    walk(p);
    s = s.trim();
    if (!s) continue;
    const pPr = child(p, 'pPr');
    const sid = val(child(pPr, 'pStyle'));
    let rank = sid && sid in styles ? styles[sid] : null;
    const ol = val(child(pPr, 'outlineLvl'));
    if (ol !== '' && +ol < 9) rank = +ol + 1;
    if (rank === 'toc') continue; // Word's own TOC lines ("Chapter 1 ...... 12") are noise here
    if (rank !== null && s.length > 200) rank = null;
    items.push({ s, rank });
  }
  const ranks = [...new Set(items.filter(i => i.rank !== null).map(i => i.rank))].sort((a, b) => a - b);
  const text = items.map(i => (i.rank === null ? i.s : '#'.repeat(Math.min(3, ranks.indexOf(i.rank) + 1)) + ' ' + i.s.replace(/\s+/g, ' '))).join('\n\n');
  let title = '';
  const core = await zip.file('docProps/core.xml')?.async('string');
  if (core) title = (parse(core).getElementsByTagNameNS('*', 'title')[0]?.textContent || '').trim();
  return { title, text };
}

async function importPdf(file, onProgress) {
  const pdfjs = await getPdfjs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, disableFontFace: true }).promise;
  let title = '';
  try { title = ((await pdf.getMetadata())?.info?.Title || '').trim(); } catch {}
  const numPages = pdf.numPages;
  const L = []; // { s, size, page } — size = the font size most of the line is set in
  for (let p = 1; p <= numPages; p++) {
    onProgress && onProgress(p, numPages);
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    let line = '', lastY = null, sizes = {};
    const push = () => {
      let size = 0, best = 0;
      for (const k in sizes) if (sizes[k] > best) { best = sizes[k]; size = +k; }
      L.push({ s: line, size, page: p }); line = ''; sizes = {};
    };
    for (const it of content.items) {
      if (!('str' in it)) continue;
      const y = it.transform ? Math.round(it.transform[5]) : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && line && !it.hasEOL) push();
      line += it.str;
      const chars = it.str.replace(/\s/g, '').length;
      if (chars) {
        const h = it.transform ? Math.hypot(it.transform[2], it.transform[3]) : (it.height || 0);
        const k = Math.round(h * 2) / 2;
        if (k > 0) sizes[k] = (sizes[k] || 0) + chars;
      }
      lastY = y;
      if (it.hasEOL) push();
    }
    if (line) push();
    L.push({ s: '\f', size: 0, page: p }); // page marker
    page.cleanup && page.cleanup();
  }
  try { pdf.destroy(); } catch {}
  const clean = L.map(o => (o.s === '\f' ? o : { ...o, s: o.s.replace(/\s+/g, ' ').trim() }));
  const isLine = o => o.s && o.s !== '\f';

  // Body font size = the size most characters are set in.
  const bySize = {};
  for (const o of clean) if (isLine(o) && o.size) bySize[o.size] = (bySize[o.size] || 0) + o.s.length;
  let body = 0, most = 0;
  for (const k in bySize) if (bySize[k] > most) { most = bySize[k]; body = +k; }

  // Headings: lines set clearly bigger than the body text.
  const headSizes = new Set();
  for (const o of clean) {
    if (!isLine(o) || !body || o.size < body * 1.2 || o.s.length > 120) continue;
    if ((o.s.match(/\p{L}/gu) || []).length < 2 || /^\d{1,4}$/.test(o.s)) continue;
    o.head = true; headSizes.add(o.size);
  }
  const nLines = clean.filter(isLine).length;
  if (clean.filter(o => o.head).length > nLines * 0.3) clean.forEach(o => { o.head = false; }); // slides/posters: not a book layout
  const rank = [...headSizes].sort((a, b) => b - a);
  for (const o of clean) if (o.head) o.lv = Math.min(3, rank.indexOf(o.size) + 1);

  // Running headers/footers (book title, author, chapter name repeated on every page)
  if (numPages >= 6) {
    const key = x => x.toLowerCase().replace(/\d+/g, '#');
    const pagesOf = [];
    let cur = [];
    for (const o of clean) { if (o.s === '\f') { pagesOf.push(cur); cur = []; } else if (o.s) cur.push(o); }
    const edges = pagesOf.map(pl => [...new Set([...pl.slice(0, 2), ...pl.slice(-2)])]);
    const count = new Map();
    for (const e of edges) new Set(e.filter(o => o.s.length <= 90).map(o => key(o.s))).forEach(k => count.set(k, (count.get(k) || 0) + 1));
    const min = Math.max(3, Math.ceil(numPages * 0.25));
    for (const e of edges) for (const o of e) if (!o.head && (count.get(key(o.s)) || 0) >= min && /\p{L}/u.test(o.s)) o.drop = true;
  }

  // Rebuild paragraphs from lines.
  const lens = clean.filter(o => isLine(o) && !o.head && !o.drop).map(o => o.s.length).sort((a, b) => a - b);
  const median = lens.length ? lens[Math.floor(lens.length / 2)] : 60;
  const nextText = new Array(clean.length).fill('');
  for (let i = clean.length - 1, nx = ''; i >= 0; i--) { nextText[i] = nx; if (isLine(clean[i]) && !clean[i].drop) nx = clean[i].s; }
  let text = '', buf = '', head = null;
  const flush = () => { if (buf.trim()) text += buf.trim() + '\n\n'; buf = ''; };
  const flushHead = () => { if (head) text += '#'.repeat(head.lv) + ' ' + head.s + '\n\n'; head = null; };
  for (let i = 0; i < clean.length; i++) {
    const o = clean[i], l = o.s;
    if (l === '\f') { flushHead(); continue; }
    if (o.drop) continue;
    if (o.head) {
      flush();
      if (head && head.lv === o.lv && head.s.length + l.length < 160) head.s += (/^\S+\s+[\dIVXLC]+\.?$/i.test(head.s) ? ': ' : ' ') + l;
      else { flushHead(); head = { lv: o.lv, s: l }; }
      continue;
    }
    if (!l) { flushHead(); flush(); continue; }
    flushHead();
    if (/^\d{1,4}$/.test(l)) continue; // page numbers
    // A short, unpunctuated line between sentences is a same-size (e.g. bold) heading: keep it on its own.
    const nx = nextText[i];
    if (l.length <= Math.min(70, median * 0.6) && l.split(' ').length <= 10 && !/[.,;:!?…"”»\-]$/.test(l)
        && /^[\p{Lu}\d]/u.test(l) && (!buf || /[.!?:…"”»]$/.test(buf)) && nx && /^[\p{Lu}"“«„'‘\d—–-]/u.test(nx)) {
      flush(); text += l + '\n\n'; continue;
    }
    if (buf.endsWith('-') && /^[\p{Ll}]/u.test(l)) buf = buf.slice(0, -1) + l;
    else buf += (buf ? ' ' : '') + l;
    const endsSentence = /[.!?:…"”»]$/.test(l);
    if (endsSentence && l.length < median * 0.72) flush();
  }
  flushHead();
  flush();
  return { title, text: text.trim() };
}

function srtToText(s) {
  return s.replace(/\r/g, '').split(/\n\n+/).map(block => block.split('\n').filter(l => !/^\d+$/.test(l.trim()) && !/-->/.test(l)).join(' ')).join('\n\n');
}

/** Import a File. Returns { title, text, kind } */
export async function importFile(file, onProgress) {
  const kind = detectKind(file);
  if (!kind) throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
  let r;
  if (kind === 'pdf') r = await importPdf(file, onProgress);
  else if (kind === 'epub') r = await importEpub(file);
  else if (kind === 'docx') r = await importDocx(file);
  else {
    const raw = await readText(file);
    if (kind === 'html') r = htmlToText(raw);
    else if (kind === 'md') r = { title: '', text: stripMarkdown(raw) };
    else if (kind === 'srt') r = { title: '', text: srtToText(raw) };
    else if (kind === 'json') {
      try { const j = JSON.parse(raw); if (j && j.app === 'focusread') throw Object.assign(new Error('backup'), { code: 'backup', data: j }); r = { title: '', text: raw }; }
      catch (e) { if (e.code === 'backup') throw e; r = { title: '', text: raw }; }
    }
    else r = { title: '', text: raw };
  }
  const text = normalize(r.text);
  if (!text || text.replace(/\s/g, '').length < 2) throw Object.assign(new Error('no text'), { code: 'notext' });
  return { title: (r.title || baseName(file.name)).slice(0, 140), author: r.author || '', text, kind };
}
