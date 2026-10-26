// FocusRead: client-side article extractor.
// Transforms raw web pages / HTML into distraction-free structured reading text.
// Uses DOMParser for robust parsing and readability heuristics for main content detection.
import { prepare } from './aitext.js';

const NOISE_TAGS = [
  'script', 'style', 'noscript', 'svg', 'canvas', 'iframe', 'object',
  'embed', 'audio', 'video', 'track', 'map', 'applet', 'form', 'dialog',
  'template', 'button', 'select', 'textarea'
];

const CLUTTER_PATTERN = /(?:^|[\s_-])(?:ad|ads|advert|banner|cookie|popup|modal|share|social|newsletter|subscribe|comment|comments|sidebar|widget|promo|outbrain|taboola|related|recommendation)(?:[\s_-]|$)/i;
const ARTICLE_CONTAINER_HINT = /(?:article|content|post|entry|main|body|story)/i;

/** Strip trailing publication suffixes like " - Site Name", " | The Blog", " — Substack" */
function cleanTitle(raw, siteName) {
  let t = String(raw || '').trim();
  if (!t) return '';
  t = t.replace(/\s+/g, ' ');
  const m = t.match(/^(.*?)\s+(?:[-–—|•·»]|&bull;)\s+([^–—|•·»]+)$/);
  if (m && m[1].length >= 8) {
    if (!siteName || m[2].toLowerCase().includes(siteName.toLowerCase()) || siteName.toLowerCase().includes(m[2].toLowerCase())) {
      t = m[1].trim();
    }
  }
  return t;
}

/** Clean author strings (e.g. "By Jane Doe" -> "Jane Doe") */
function cleanAuthor(raw) {
  let a = String(raw || '').trim();
  if (!a) return '';
  a = a.replace(/^(?:by|written by|nga)\s+/i, '').replace(/\s+/g, ' ').trim();
  if (a.length > 80 || /https?:\/\//i.test(a)) return '';
  return a;
}

/** Extract metadata from the document */
function extractMeta(doc, url, fallbackMeta = {}) {
  const q = s => doc.querySelector(s)?.getAttribute('content')?.trim() || '';

  const site =
    fallbackMeta.siteName ||
    q('meta[property="og:site_name"]') ||
    q('meta[name="application-name"]') ||
    (url ? new URL(url, location.href).hostname.replace(/^www\./i, '') : '');

  const rawTitle =
    fallbackMeta.title ||
    q('meta[property="og:title"]') ||
    q('meta[name="twitter:title"]') ||
    doc.querySelector('title')?.textContent?.trim() ||
    doc.querySelector('h1')?.textContent?.trim() ||
    '';

  const title = cleanTitle(rawTitle, site) || 'Web Article';

  const author = cleanAuthor(
    fallbackMeta.author ||
    q('meta[name="author"]') ||
    q('meta[property="article:author"]') ||
    q('meta[name="twitter:creator"]') ||
    doc.querySelector('[rel="author"], .author, .byline, .author-name')?.textContent ||
    ''
  );

  return { title, author, siteName: site };
}

/** Remove noisy elements before scoring */
function pruneNoise(root) {
  for (const tag of NOISE_TAGS) {
    root.querySelectorAll(tag).forEach(el => el.remove());
  }

  // Remove structural navigation and footer
  root.querySelectorAll('nav, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], [role="alert"], [aria-hidden="true"]').forEach(el => el.remove());

  // Remove elements with clutter class/id unless they look like the main article container
  for (const el of [...root.querySelectorAll('[class], [id]')]) {
    if (!el.isConnected) continue;
    const desc = `${el.className || ''} ${el.id || ''}`;
    if (CLUTTER_PATTERN.test(desc) && !ARTICLE_CONTAINER_HINT.test(desc)) {
      el.remove();
    }
  }
}

/** Score a candidate container element based on text and paragraph density */
function scoreElement(el) {
  if (!el) return -1;
  const text = el.textContent || '';
  const len = text.length;
  if (len < 100) return 0;

  let score = 0;
  const paragraphs = el.querySelectorAll('p');
  score += paragraphs.length * 25;

  // Comma count reflects natural language flow
  const commas = (text.match(/,/g) || []).length;
  score += Math.min(commas * 2, 100);

  // Character count
  score += Math.min(Math.floor(len / 10), 300);

  // Link density penalty: navigation/menus have very high link-to-text ratio
  let linkLength = 0;
  el.querySelectorAll('a').forEach(a => { linkLength += (a.textContent || '').length; });
  const linkDensity = len > 0 ? linkLength / len : 0;
  if (linkDensity > 0.4) score -= 300;
  else if (linkDensity > 0.25) score -= 100;

  // Tag bonus
  const tag = el.localName;
  if (tag === 'article') score += 120;
  else if (tag === 'main') score += 80;
  else if (tag === 'section') score += 30;

  return score;
}

/** Identify the main article container */
function findArticleContainer(body) {
  // Check standard article tags first
  const articles = [...body.querySelectorAll('article')];
  if (articles.length === 1 && (articles[0].textContent || '').length > 300) {
    return articles[0];
  }

  // Priority selectors
  const candidates = [
    body.querySelector('[itemprop="articleBody"]'),
    body.querySelector('[role="main"]'),
    body.querySelector('main'),
    body.querySelector('.article-body, .article-content, .post-content, .entry-content, .story-body, .story-content, #article-body, #content'),
  ].filter(Boolean);

  for (const c of candidates) {
    if ((c.textContent || '').length > 400) return c;
  }

  // Heuristic scan over divs and sections
  let best = null;
  let maxScore = 0;
  const pool = body.querySelectorAll('article, main, section, div');
  for (const el of pool) {
    const s = scoreElement(el);
    if (s > maxScore) {
      maxScore = s;
      best = el;
    }
  }

  return (best && maxScore > 60) ? best : body;
}

/** Convert an HTML container into clean markdown/text */
function renderContainer(container, docTitle) {
  const BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,section,header,footer,tr,dt,dd,figcaption,table,ul,ol,hr';

  // Mark headings as `# Heading` lines so FocusRead's Table of Contents / Outline parser picks them up
  container.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]').forEach(h => {
    const raw = (h.textContent || '').replace(/\s+/g, ' ').trim();
    if (!raw || raw.length > 250) return;
    // Don't repeat the main document title as an extra heading if at top
    if (docTitle && raw.toLowerCase() === docTitle.toLowerCase()) {
      h.remove();
      return;
    }
    const lvl = /^h(\d)$/i.test(h.tagName) ? Math.min(6, Math.max(1, +h.tagName[1])) : 2;
    h.textContent = '#'.repeat(lvl) + ' ' + raw;
    h.before('\n\n'); h.after('\n\n');
  });

  // Blockquotes
  container.querySelectorAll('blockquote').forEach(bq => {
    const txt = (bq.textContent || '').trim();
    if (txt) {
      bq.textContent = txt.split('\n').map(l => '> ' + l.trim()).join('\n');
      bq.before('\n\n'); bq.after('\n\n');
    }
  });

  // Pre / Code blocks
  container.querySelectorAll('pre').forEach(pre => {
    const code = (pre.textContent || '').trim();
    if (code) {
      pre.textContent = '```\n' + code + '\n```';
      pre.before('\n\n'); pre.after('\n\n');
    }
  });

  // Lists
  container.querySelectorAll('li').forEach(li => {
    if (!li.textContent.trim()) return;
    const ol = li.parentElement && li.parentElement.localName === 'ol';
    let k = 1;
    if (ol) {
      k = parseInt(li.parentElement.getAttribute('start'), 10) || 1;
      for (let prev = li.previousElementSibling; prev; prev = prev.previousElementSibling) {
        if (prev.localName === 'li') k++;
      }
    }
    li.prepend(ol ? `${k}. ` : '• ');
  });

  // Line breaks & blocks
  container.querySelectorAll('br').forEach(n => n.replaceWith('\n'));
  container.querySelectorAll(BLOCKS).forEach(n => { n.before('\n\n'); n.append('\n\n'); });
  container.querySelectorAll('td, th').forEach(n => n.append(' '));

  let rawText = (container.textContent || '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return rawText;
}

/**
 * Main article extraction function.
 * @param {string} html - Raw HTML string of the webpage
 * @param {string} url - Source URL of the webpage
 * @param {object} meta - Optional pre-extracted metadata (title, author, siteName)
 * @returns {{ title: string, author: string, siteName: string, text: string, words: number }}
 */
export function extractArticle(html, url = '', meta = {}) {
  if (!html || typeof html !== 'string') {
    return { title: meta.title || 'Untitled', author: '', siteName: '', text: '', words: 0 };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const body = doc.body || doc.documentElement;

  const { title, author, siteName } = extractMeta(doc, url, meta);

  pruneNoise(body);

  const container = findArticleContainer(body);

  // Remove duplicate author bylines from article body since it is stored in metadata
  if (author) {
    container.querySelectorAll('[rel="author"], .byline, .author, .author-name, .article-author, .post-author').forEach(el => el.remove());
  }

  const rawText = renderContainer(container, title);

  // Format through FocusRead's prepare() to normalize markdown, join line wraps, and break walls of text
  const clean = prepare(rawText);

  // Count words
  const m = clean.match(/\S+/g);
  const words = m ? m.length : 0;

  return {
    title,
    author,
    siteName,
    text: clean,
    words,
  };
}
