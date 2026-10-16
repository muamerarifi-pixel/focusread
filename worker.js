// Cloudflare Worker for FocusRead.
//
// Static files are served straight from ./public by Workers Static Assets (free and
// unlimited). Only requests to /api/* run this script: it loads the app's original
// Vercel function files from ./api and runs them through a small compatibility layer,
// so the sync code itself is unchanged from what ran on Vercel.
import { Buffer } from 'node:buffer';
import process from 'node:process';

const ROUTES = {
  '/api/sync': () => import('./api/sync.js'),
};

let envCopied = false;
function copyEnv(env) {
  // process.env is filled from the Worker's variables and secrets automatically
  // (nodejs_compat); this is a fallback so the original code always sees them.
  if (envCopied) return;
  for (const [k, v] of Object.entries(env || {})) {
    if (typeof v === 'string' && process.env[k] === undefined) process.env[k] = v;
  }
  envCopied = true;
}

// Reading fonts added in v6.5 are served from the app's own files when present. If a deploy
// leaves one out, it is fetched once from the Fontsource package on jsDelivr and cached at the edge,
// so the page still loads it from its own address (the CSP allows fonts from 'self' only).
const FONT_PKGS = { 'lora': 'lora@5.3.0', 'eb-garamond': 'eb-garamond@5.3.0', 'merriweather': 'merriweather@5.3.0', 'source-serif-4': 'source-serif-4@5.3.1', 'inter': 'inter@5.3.0', 'nunito': 'nunito@5.3.0' };
async function serveAsset(request, env, url) {
  const res = await env.ASSETS.fetch(request);
  if (res.status !== 404 || request.method !== 'GET') return res;
  const m = url.pathname.match(/^\/fonts\/([a-z0-9-]+?)-latin-(400|700)-normal\.woff2$/);
  const pkg = m && FONT_PKGS[m[1]];
  if (!pkg) return res;
  const up = await fetch(`https://cdn.jsdelivr.net/npm/@fontsource/${pkg}/files/${m[1]}-latin-${m[2]}-normal.woff2`, { cf: { cacheEverything: true, cacheTtl: 2592000 } });
  if (!up.ok) return res;
  return new Response(up.body, { headers: { 'content-type': 'font/woff2', 'cache-control': 'public, max-age=604800, stale-while-revalidate=86400', 'x-content-type-options': 'nosniff' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Serve /index.html directly (200). By default Workers Static Assets redirects it to "/",
    // and a service worker that caches '/index.html' would then store a redirected response,
    // which browsers refuse to use for page loads (ERR_FAILED). Vercel never redirected it.
    // wrangler.jsonc sends only this path to the Worker (assets.run_worker_first).
    if (url.pathname.endsWith('/index.html')) {
      const dir = new URL(url.pathname.slice(0, -'index.html'.length) + url.search, url);
      const res = await env.ASSETS.fetch(new Request(dir, request));
      return new Response(res.body, res);
    }
    let key = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
    if (!ROUTES[key] && key.endsWith('.js')) key = key.slice(0, -3);
    const load = ROUTES[key];
    if (!load) return serveAsset(request, env, url);
    copyEnv(env);
    try {
      const mod = await load();
      return await callApi(mod, request);
    } catch (err) {
      console.error('api error', key, err && err.stack ? err.stack : err);
      return new Response(JSON.stringify({ error: 'server_error' }), {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
  },
};

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

async function callApi(mod, request) {
  // Web-standard functions: export async function GET(request) { ... }
  if (METHODS.some((m) => typeof mod[m] === 'function')) {
    const m = request.method.toUpperCase();
    const fn = mod[m] || (m === 'HEAD' ? mod.GET : null);
    if (!fn) {
      return new Response('Method Not Allowed', { status: 405, headers: { allow: METHODS.filter((x) => mod[x]).join(', ') } });
    }
    return fn(request);
  }
  // Node.js-style functions: export default function handler(req, res) { ... }
  let handler = mod.default;
  if (handler && typeof handler !== 'function' && typeof handler.default === 'function') handler = handler.default;
  if (typeof handler !== 'function') throw new Error('api module has no handler');
  return runNodeHandler(handler, request);
}

function parseCookies(str) {
  const out = {};
  for (const part of String(str || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      const k = part.slice(0, i).trim();
      try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); }
    }
  }
  return out;
}

function toBuf(c) {
  if (Buffer.isBuffer(c)) return c;
  if (typeof c === 'string') return Buffer.from(c);
  if (c instanceof ArrayBuffer) return Buffer.from(c);
  if (ArrayBuffer.isView(c)) return Buffer.from(c.buffer, c.byteOffset, c.byteLength);
  return Buffer.from(String(c));
}

// Recreates the request/response objects Vercel gives Node.js functions
// (req.query, req.body, req.cookies, res.status().json(), res.send(), ...).
async function runNodeHandler(handler, request) {
  const url = new URL(request.url);
  const headers = {};
  request.headers.forEach((v, k) => { headers[k] = v; });
  if (!headers['x-forwarded-host']) headers['x-forwarded-host'] = url.host;
  if (!headers['x-forwarded-proto']) headers['x-forwarded-proto'] = url.protocol.replace(':', '');
  const query = {};
  for (const [k, v] of url.searchParams) query[k] = k in query ? [].concat(query[k], v) : v;

  const method = request.method.toUpperCase();
  const raw = method === 'GET' || method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await request.arrayBuffer());
  let body;
  if (raw.length) {
    const type = (headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type === 'application/json' || type.endsWith('+json')) {
      try { body = JSON.parse(raw.toString('utf8')); } catch {
        return new Response('Invalid JSON', { status: 400, headers: { 'cache-control': 'no-store' } });
      }
    } else if (type === 'application/x-www-form-urlencoded') {
      body = Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
    } else if (type.startsWith('text/')) {
      body = raw.toString('utf8');
    } else {
      body = raw;
    }
  }

  const req = {
    method,
    url: url.pathname + url.search,
    headers,
    query,
    body,
    cookies: parseCookies(headers.cookie),
    socket: { remoteAddress: headers['cf-connecting-ip'] || '' },
    connection: { remoteAddress: headers['cf-connecting-ip'] || '' },
    on() { return req; },
    once() { return req; },
    async *[Symbol.asyncIterator]() { if (raw.length) yield raw; },
  };

  return new Promise((resolve, reject) => {
    let status = 200;
    let finished = false;
    const out = new Headers();
    const chunks = [];
    const finish = () => {
      if (finished) return;
      finished = true;
      res.headersSent = true;
      res.writableEnded = true;
      const noBody = method === 'HEAD' || status === 204 || status === 304;
      resolve(new Response(noBody ? null : Buffer.concat(chunks), { status, headers: out }));
    };
    const res = {
      headersSent: false,
      writableEnded: false,
      statusMessage: '',
      get statusCode() { return status; },
      set statusCode(v) { status = Number(v) || 200; },
      setHeader(k, v) { out.delete(k); for (const x of [].concat(v)) out.append(k, String(x)); return res; },
      appendHeader(k, v) { for (const x of [].concat(v)) out.append(k, String(x)); return res; },
      getHeader(k) { const v = out.get(k); return v === null ? undefined : v; },
      getHeaders() { return Object.fromEntries(out); },
      hasHeader(k) { return out.has(k); },
      removeHeader(k) { out.delete(k); },
      writeHead(code, msg, hdrs) {
        status = Number(code) || 200;
        const h = msg && typeof msg === 'object' ? msg : hdrs;
        if (h) for (const k of Object.keys(h)) res.setHeader(k, h[k]);
        return res;
      },
      write(c, enc, cb) {
        if (c != null) chunks.push(toBuf(c));
        if (typeof enc === 'function') enc(); else if (typeof cb === 'function') cb();
        return true;
      },
      end(c, enc, cb) {
        if (typeof c === 'function') { cb = c; c = null; }
        if (c != null) chunks.push(toBuf(c));
        finish();
        if (typeof enc === 'function') enc(); else if (typeof cb === 'function') cb();
        return res;
      },
      status(code) { status = Number(code) || 200; return res; },
      json(o) {
        if (!out.has('content-type')) out.set('content-type', 'application/json; charset=utf-8');
        return res.end(JSON.stringify(o));
      },
      send(b) {
        if (b != null && typeof b === 'object' && !Buffer.isBuffer(b) && !ArrayBuffer.isView(b) && !(b instanceof ArrayBuffer)) return res.json(b);
        if (typeof b === 'string' && !out.has('content-type')) out.set('content-type', 'text/html; charset=utf-8');
        return res.end(b);
      },
      redirect(a, b) {
        const code = typeof a === 'number' ? a : 307;
        out.set('location', String(typeof a === 'number' ? b : a));
        status = code;
        return res.end();
      },
      on() { return res; },
      once() { return res; },
      emit() { return false; },
      flushHeaders() {},
    };
    Promise.resolve()
      .then(() => handler(req, res))
      .then(
        () => { if (!finished) setTimeout(finish, 50); },
        (e) => { if (finished) console.error(e); else reject(e); },
      );
  });
}
