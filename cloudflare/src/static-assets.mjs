// These three public JSON files exceed the per-asset limit uncompressed. The
// build emits a compressed canonical file and a raw .gz counterpart. Browser
// gzip is automatic; identity clients get a streamed decompressed response.
export const LARGE_JSON_PATHS = new Set([
  '/static/data/history/archive-books/qingshigao.json',
  '/static/data/history/archive-books/songshi.json',
  '/static/data/history/source-archive.v1.json',
]);
export function acceptsGzip(header = '') {
  const values = new Map();
  for (const part of header.toLowerCase().split(',')) {
    const fields = part.split(';').map(value => value.trim());
    if (!fields[0]) continue;
    let quality = 1;
    for (const field of fields.slice(1)) if (field.startsWith('q=')) {
      const raw = field.slice(2); quality = raw && Number.isFinite(Number(raw)) && Number(raw) >= 0 && Number(raw) <= 1 ? Number(raw) : 0;
    }
    values.set(fields[0], quality);
  }
  return (values.has('gzip') ? values.get('gzip') : values.get('*') || 0) > 0;
}
export function clientAcceptEncoding(request) {
  // Cloudflare can normalize the header before invoking a Worker. The cf
  // property retains the client preference, including explicit identity/q=0.
  return typeof request.cf?.clientAcceptEncoding === 'string' ? request.cf.clientAcceptEncoding : request.headers.get('accept-encoding') || '';
}
export async function serveLargeJson(request, env, { forceIdentity = false } = {}) {
  const url = new URL(request.url);
  if (!LARGE_JSON_PATHS.has(url.pathname) || !env.ASSETS || !['GET', 'HEAD'].includes(request.method)) return null;
  const gzip = !forceIdentity && acceptsGzip(clientAcceptEncoding(request));
  url.pathname += '.gz';
  // A byte range or validator for the compressed representation does not
  // describe the decompressed JSON. Ignore these optional request controls and
  // return the full identity representation rather than decode a partial gzip.
  const incoming = new Headers(request.headers);
  for (const key of ['Range', 'If-Range', ...(!gzip ? ['If-None-Match', 'If-Modified-Since'] : [])]) incoming.delete(key);
  const archive = await env.ASSETS.fetch(new Request(url, { method: request.method, headers: incoming, signal: request.signal }));
  if (!archive.ok && archive.status !== 304) return archive;
  const headers = new Headers(archive.headers);
  headers.delete('Content-Encoding'); headers.delete('Content-Length');
  if (!gzip) headers.delete('ETag');
  headers.set('Content-Type', 'application/json; charset=utf-8'); headers.set('Cache-Control', 'no-cache'); headers.set('X-Content-Type-Options', 'nosniff'); headers.set('Vary', 'Accept-Encoding');
  if (gzip) {
    headers.set('Content-Encoding', 'gzip');
    // The raw .gz file is already encoded. Workers otherwise automatically
    // compress a Response carrying Content-Encoding and can double-gzip it.
    return new Response(request.method === 'HEAD' ? null : archive.body, { status: archive.status, headers, encodeBody: 'manual' });
  }
  return new Response(request.method === 'HEAD' ? null : archive.body?.pipeThrough(new DecompressionStream('gzip')), { status: archive.status, headers });
}
