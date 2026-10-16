// FocusRead sync API — a tiny, dumb, end-to-end-encrypted store.
// The server never sees the sync code or any readable text: clients send
//   sid  = SHA-256 of the code (an opaque space id)
//   data = AES-GCM ciphertext produced in the browser.
// Storage: Neon Postgres (DATABASE_URL / POSTGRES_URL, added by the Vercel ↔ Neon integration).
import { neon } from '@neondatabase/serverless';

const SID = /^[a-f0-9]{64}$/;
const FIELD = /^[ds]:[A-Za-z0-9_-]{4,64}$/;
const DOC = /^[A-Za-z0-9_-]{4,64}$/;
const MAX_ITEM = 200_000;       // encrypted metadata / stats item
const MAX_PART = 3_000_000;     // one part of an encrypted text
const MAX_PARTS = 40;

let sqlFn = null, ready = null;
function db() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL_UNPOOLED;
  if (!url) return null;
  if (!sqlFn) sqlFn = neon(url);
  if (!ready) ready = (async () => {
    await sqlFn`CREATE TABLE IF NOT EXISTS fr_items (sid text NOT NULL, field text NOT NULL, u bigint NOT NULL, st bigint NOT NULL, data text NOT NULL, PRIMARY KEY (sid, field))`;
    await sqlFn`CREATE INDEX IF NOT EXISTS fr_items_st ON fr_items (sid, st)`;
    await sqlFn`CREATE TABLE IF NOT EXISTS fr_texts (sid text NOT NULL, id text NOT NULL, part int NOT NULL, data text NOT NULL, PRIMARY KEY (sid, id, part))`;
  })().catch(e => { ready = null; throw e; });
  return sqlFn;
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

export default async function handler(req, res) {
  // Cloudflare: no database work here; a status check must not start queries it doesn't wait for.
  if (req.method === 'GET') return send(res, 200, { ok: true, configured: !!(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL_UNPOOLED) });
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  const sql = db();
  if (!sql) return send(res, 503, { error: 'not_configured' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body !== 'object') return send(res, 400, { error: 'body' });
  const { op, sid } = body;
  if (!SID.test(sid || '')) return send(res, 400, { error: 'sid' });
  try {
    await ready;
    const now = Date.now();
    if (op === 'pull') {
      const since = Number.isFinite(body.since) ? body.since : 0;
      const rows = await sql`SELECT field, u, data FROM fr_items WHERE sid = ${sid} AND st > ${since}`;
      return send(res, 200, { now, items: rows.map(r => ({ f: r.field, u: Number(r.u), d: r.data })) });
    }
    if (op === 'push') {
      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length > 500) return send(res, 413, { error: 'too_many' });
      const f = [], u = [], d = [];
      for (const it of items) {
        if (!it || !FIELD.test(it.f || '') || !Number.isFinite(it.u) || typeof it.d !== 'string' || it.d.length > MAX_ITEM) return send(res, 400, { error: 'item' });
        f.push(it.f); u.push(Math.floor(it.u)); d.push(it.d);
      }
      if (f.length) {
        await sql`
          INSERT INTO fr_items (sid, field, u, st, data)
          SELECT ${sid}, t.f, t.u, ${now}, t.d FROM unnest(${f}::text[], ${u}::bigint[], ${d}::text[]) AS t(f, u, d)
          ON CONFLICT (sid, field) DO UPDATE SET u = EXCLUDED.u, st = EXCLUDED.st, data = EXCLUDED.data
          WHERE fr_items.u <= EXCLUDED.u`;
      }
      return send(res, 200, { now, ok: true });
    }
    if (op === 'putText') {
      const { id, part, data } = body;
      if (!DOC.test(id || '') || !Number.isInteger(part) || part < 0 || part >= MAX_PARTS || typeof data !== 'string' || data.length > MAX_PART) return send(res, 400, { error: 'text' });
      await sql`INSERT INTO fr_texts (sid, id, part, data) VALUES (${sid}, ${id}, ${part}, ${data}) ON CONFLICT (sid, id, part) DO UPDATE SET data = EXCLUDED.data`;
      return send(res, 200, { ok: true });
    }
    if (op === 'getText') {
      const { id, part } = body;
      if (!DOC.test(id || '') || !Number.isInteger(part)) return send(res, 400, { error: 'text' });
      const rows = await sql`SELECT data FROM fr_texts WHERE sid = ${sid} AND id = ${id} AND part = ${part}`;
      if (!rows.length) return send(res, 404, { error: 'missing' });
      return send(res, 200, { data: rows[0].data });
    }
    if (op === 'delText') {
      const { id } = body;
      if (!DOC.test(id || '')) return send(res, 400, { error: 'text' });
      await sql`DELETE FROM fr_texts WHERE sid = ${sid} AND id = ${id}`;
      return send(res, 200, { ok: true });
    }
    return send(res, 400, { error: 'op' });
  } catch (e) {
    console.error('sync error', e);
    return send(res, 500, { error: 'server' });
  }
}

