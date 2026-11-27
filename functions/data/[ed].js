/* /data/<edition> (Cloudflare Pages Function, r17, 27.11.2026): the encrypted data file of a guest edition (deckmap,
   crmge) for automatic updates of the reader. The file stays encrypted here (MSCD1, AES-256 + HMAC); the key is never
   on Cloudflare. Storage: Workers KV namespace "mscnb-data" (jurisdiction EU), bound to this project as DATA:

     <ed>:meta     JSON {etag, size, batch, lm, at, th}      written last by upload_data.py (Parallels)
     <ed>:<etag>   the .dat bytes                            the old one is deleted after the new meta is written

   Only a reader that has the access link gets anything: it sends X-Reader-Token = base64url(HMAC-SHA256(key,
   "mscnb-data-v1")); here only its SHA-256 is kept (th). Without it the answer is 404, as if nothing were here.
   HEAD: size and stamp of the newest file (the reader on a mobile network asks first and downloads only on a tap).
   If-None-Match with the current ETag: 304, a few hundred bytes. */
const HDR = {
  'Cache-Control': 'no-store, private',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

function headers(extra) {
  const h = new Headers(HDR);
  for (const k in extra || {}) if (extra[k] !== undefined && extra[k] !== '') h.set(k, extra[k]);
  return h;
}

function nothing() {
  return new Response('Not found', { status: 404, headers: headers({ 'Content-Type': 'text/plain' }) });
}

async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* compares two hex strings of the same length without stopping at the first difference */
function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

export async function onRequest({ request, env, params }) {
  const ed = String(params.ed || '');
  if (!/^[a-z0-9_-]{1,32}$/.test(ed)) return nothing();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: headers({ Allow: 'GET, HEAD' }) });
  }
  if (!env.DATA) return nothing();
  const tok = request.headers.get('X-Reader-Token') || '';
  if (tok.length < 20 || tok.length > 100) return nothing();
  const meta = await env.DATA.get(ed + ':meta', { type: 'json' });
  if (!meta || !meta.etag || !sameHex(meta.th, await sha256hex(tok))) return nothing();

  const etag = '"' + meta.etag + '"';
  const h = headers({
    ETag: etag,
    'X-Batch': meta.batch || '',
    'X-LM': meta.lm || '',
    'X-Size': String(meta.size || 0),
    'Last-Modified': meta.at ? new Date(meta.at).toUTCString() : '',
  });
  const inm = (request.headers.get('If-None-Match') || '').replace(/^W\//, '');
  if (inm && inm === etag) return new Response(null, { status: 304, headers: h });
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers: h });

  const body = await env.DATA.get(ed + ':' + meta.etag, { type: 'stream' });
  if (!body) return nothing();
  h.set('Content-Type', 'application/octet-stream');
  if (meta.size) h.set('Content-Length', String(meta.size));
  return new Response(body, { status: 200, headers: h });
}
