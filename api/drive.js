// FocusRead: import a file from a Google Drive / Google Docs share link.
// The browser can't download from Google directly (no CORS), so this fetches the public file and passes it on.
// Only Google's own download hosts are ever contacted, and only for a Drive file id: this is not an open proxy.
const ID = /^[A-Za-z0-9_-]{20,120}$/;
const MAX = 80 * 1024 * 1024; // 80 MB
const json = (status, error) => new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

function source(id, kind) {
  if (kind === 'doc') return { url: `https://docs.google.com/document/d/${id}/export?format=docx`, ext: '.docx' };
  if (kind === 'slides') return { url: `https://docs.google.com/presentation/d/${id}/export/pdf`, ext: '.pdf' };
  return { url: `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`, ext: '' };
}
function fileName(cd, fallback) {
  if (!cd) return fallback;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(cd);
  if (star) { try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')); } catch {} }
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(cd);
  return plain ? plain[1].trim() : fallback;
}

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  const id = q.get('id') || '', kind = q.get('t') || 'file';
  if (!ID.test(id) || !['file', 'doc', 'slides'].includes(kind)) return json(400, 'bad_link');
  const src = source(id, kind);
  let up;
  try {
    up = await fetch(src.url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (FocusRead importer)', accept: '*/*' } });
  } catch { return json(502, 'unreachable'); }
  if (up.status === 404) return json(404, 'not_found');
  const type = (up.headers.get('content-type') || '').toLowerCase();
  // Google answers a private file (or a sign-in wall) with an HTML page instead of the file
  if (!up.ok || type.startsWith('text/html')) return json(403, 'private');
  const len = +up.headers.get('content-length') || 0;
  if (len > MAX) return json(413, 'too_big');
  const name = fileName(up.headers.get('content-disposition'), 'Google Drive' + src.ext);
  return new Response(up.body, {
    headers: {
      'content-type': type || 'application/octet-stream',
      'x-file-name': encodeURIComponent(name),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
