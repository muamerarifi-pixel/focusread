// FocusRead: import an article, webpage, or file from any public web link (URL).
// Safely fetches remote resources, prevents SSRF, and passes documents or clean HTML to the client.

const MAX_HTML = 10 * 1024 * 1024; // 10 MB
const MAX_BIN = 80 * 1024 * 1024;  // 80 MB (same as drive.js)

const json = (status, error, extra = {}) =>
  new Response(JSON.stringify({ error, ...extra }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

function isPrivateHost(hostname) {
  const h = hostname.toLowerCase().trim();
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h.endsWith('.lan') ||
    h.endsWith('.corp') ||
    h === 'metadata.google.internal'
  ) {
    return true;
  }

  // IPv4 check
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (ipv4) {
    const [_, a, b] = ipv4.map(Number);
    if (a === 0 || a === 127) return true; // 0.0.0.0/8, 127.0.0.0/8 (loopback)
    if (a === 10) return true;             // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true;          // 192.168.0.0/16
    if (a === 169 && b === 254) return true;          // 169.254.0.0/16 (link-local, cloud metadata)
    return false;
  }

  // IPv6 check
  if (h === '::1' || h.startsWith('[::1]') || h.startsWith('fc') || h.startsWith('fe80')) {
    return true;
  }

  return false;
}

function fileNameFromHeader(cd, fallback) {
  if (!cd) return fallback;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/i.exec(cd);
  if (star) {
    try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')); } catch {}
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(cd);
  return plain ? plain[1].trim() : fallback;
}

function decodeEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

async function handleExtract(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return json(400, 'bad_link');
  let target;
  try {
    let s = rawUrl.trim();
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    target = new URL(s);
  } catch {
    return json(400, 'bad_link');
  }

  if (!['http:', 'https:'].includes(target.protocol)) return json(400, 'bad_link');
  if (isPrivateHost(target.hostname)) return json(400, 'forbidden_host');

  let up;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 16000);
    try {
      up = await fetch(target.href, {
        redirect: 'follow',
        signal: ac.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 (FocusRead/7.18)',
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,application/pdf,application/epub+zip,*/*;q=0.7',
          'accept-language': 'en-US,en;q=0.9,sq;q=0.8',
        },
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      return json(504, 'timeout');
    }
    return json(502, 'unreachable');
  }

  if (!up.ok) {
    const s = up.status;
    return json(s, s === 404 ? 'not_found' : s === 403 || s === 401 ? 'access_denied' : 'unreachable');
  }

  const ct = (up.headers.get('content-type') || '').toLowerCase();
  const cl = +(up.headers.get('content-length') || 0);

  // Binary file detection (PDF, EPUB, DOCX)
  const isBinary =
    ct.includes('application/pdf') ||
    ct.includes('application/epub+zip') ||
    ct.includes('wordprocessingml') ||
    /\.(pdf|epub|docx)(\?.*)?$/i.test(target.pathname);

  if (isBinary) {
    if (cl > MAX_BIN) return json(413, 'too_big');
    const pathBase = target.pathname.split('/').filter(Boolean).pop() || 'document';
    const fallbackName = decodeURIComponent(pathBase);
    const name = fileNameFromHeader(up.headers.get('content-disposition'), fallbackName);
    return new Response(up.body, {
      headers: {
        'content-type': ct || 'application/octet-stream',
        'x-file-name': encodeURIComponent(name),
        'x-is-binary': 'true',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  if (cl > MAX_HTML) return json(413, 'too_big');

  // Text or HTML handling
  const buf = await up.arrayBuffer();
  if (buf.byteLength > MAX_HTML) return json(413, 'too_big');

  let charset = 'utf-8';
  const cm = /charset\s*=\s*['"]?([a-zA-Z0-9_-]+)/i.exec(ct);
  if (cm) charset = cm[1].toLowerCase();

  let bodyText = '';
  try {
    bodyText = new TextDecoder(charset).decode(buf);
  } catch {
    bodyText = new TextDecoder('utf-8').decode(buf);
  }

  // Handle plain text or markdown
  if (
    ct.includes('text/plain') ||
    ct.includes('text/markdown') ||
    /\.(txt|md|markdown)(\?.*)?$/i.test(target.pathname)
  ) {
    const rawName = target.pathname.split('/').filter(Boolean).pop()?.replace(/\.[^.]+$/, '') || 'Document';
    const title = decodeURIComponent(rawName.replace(/[_-]+/g, ' ').trim());
    return new Response(
      JSON.stringify({
        type: 'text',
        url: up.url || target.href,
        title,
        text: bodyText,
      }),
      {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        },
      }
    );
  }

  // Extract meta tags for fallback/preview
  const ogTitle = /<meta\s+[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(bodyText) ||
                  /<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i.exec(bodyText);
  const twTitle = /<meta\s+[^>]*name=["']twitter:title["'][^>]*content=["']([^"']+)["']/i.exec(bodyText) ||
                  /<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:title["']/i.exec(bodyText);
  const htmlTitle = /<title[^>]*>([^<]+)<\/title>/i.exec(bodyText);

  const ogSite = /<meta\s+[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i.exec(bodyText) ||
                 /<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:site_name["']/i.exec(bodyText);
  const authorMatch = /<meta\s+[^>]*name=["']author["'][^>]*content=["']([^"']+)["']/i.exec(bodyText) ||
                      /<meta\s+[^>]*property=["']article:author["'][^>]*content=["']([^"']+)["']/i.exec(bodyText);

  const title = decodeEntities((ogTitle?.[1] || twTitle?.[1] || htmlTitle?.[1] || '').trim());
  const author = decodeEntities((authorMatch?.[1] || '').trim());
  const siteName = decodeEntities((ogSite?.[1] || target.hostname.replace(/^www\./i, '')).trim());

  return new Response(
    JSON.stringify({
      type: 'html',
      url: up.url || target.href,
      title,
      author,
      siteName,
      html: bodyText,
    }),
    {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    }
  );
}

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  return handleExtract(q.get('url'));
}

export async function POST(request) {
  let url = '';
  try {
    const data = await request.json();
    url = data.url || '';
  } catch {}
  return handleExtract(url);
}
