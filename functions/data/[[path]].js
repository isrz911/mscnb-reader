/* /data/<edition>[/ph[/<pack>]] (Cloudflare Pages Function, r17, photos r19, 27.11.2026): the encrypted data file of a
   guest edition (deckmap,
   crmge) for automatic updates of the reader. The file stays encrypted here (MSCD1, AES-256 + HMAC); the key is never
   on Cloudflare. Storage: Workers KV namespace "mscnb-data" (jurisdiction EU), bound to this project as DATA:

     <ed>:meta     JSON {etag, size, batch, lm, at, th}      written last by upload_data.py (Parallels)
     <ed>:<etag>   the .dat bytes                            the old one is deleted after the new meta is written

   Only a reader that has the access link gets anything: it sends X-Reader-Token = base64url(HMAC-SHA256(key,
   "mscnb-data-v1")); here only its SHA-256 is kept (th). Without it the answer is 404, as if nothing were here.
   HEAD: size and stamp of the newest file (the reader on a mobile network asks first and downloads only on a tap).
   If-None-Match with the current ETag: 304, a few hundred bytes.
   r19, photos (CRM only, user 27.11.2026): /data/<ed>/ph = the list of photo packs {<pack>: {etag, size}} (KV
   <ed>:phidx), /data/<ed>/ph/<pack> = the pack, the same bytes as the Live program gets (each photo encrypted on its
   own), joined from its parts <ed>:ph:<pack>:<etag>:<i> (a KV value holds at most 25 MB). Same token rule. */
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

export async function onRequest(context) {
  const { request, env, params } = context;
  const path = [].concat(params.path || []);
  const ed = String(path[0] || '');
  if (!/^[a-z0-9_-]{1,32}$/.test(ed)) return nothing();
  if (path.length > 1) return photos(context, ed, path.slice(1));
  if (path.length !== 1) return nothing();
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

/* r19: the photo list and the packs */
async function photos(context, ed, rest) {
  const { request, env } = context;
  if (rest[0] !== 'ph' || rest.length > 2) return nothing();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: headers({ Allow: 'GET, HEAD' }) });
  }
  if (!env.DATA) return nothing();
  const tok = request.headers.get('X-Reader-Token') || '';
  if (tok.length < 20 || tok.length > 100) return nothing();
  const idx = await env.DATA.get(ed + ':phidx', { type: 'json' });
  if (!idx || !idx.packs || !sameHex(idx.th, await sha256hex(tok))) return nothing();
  if (rest.length === 1) {                                           // the list
    const list = {};
    for (const n in idx.packs) list[n] = { etag: idx.packs[n].etag, size: idx.packs[n].size };
    const body = JSON.stringify({ packs: list, at: idx.at || 0 });
    const etag = '"' + (await sha256hex(body)).slice(0, 20) + '"';
    const h = headers({ 'Content-Type': 'application/json', ETag: etag });
    const inm = (request.headers.get('If-None-Match') || '').replace(/^W\//, '');
    if (inm && inm === etag) return new Response(null, { status: 304, headers: h });
    return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers: h });
  }
  const name = rest[1];
  const p = /^[0-9]{4}_[0-9]{2,3}\.pak$/.test(name) ? idx.packs[name] : null;
  if (!p) return nothing();
  const etag = '"' + p.etag + '"';
  const h = headers({ ETag: etag, 'Content-Type': 'application/octet-stream', 'X-Size': String(p.size) });
  const inm = (request.headers.get('If-None-Match') || '').replace(/^W\//, '');
  if (inm && inm === etag) return new Response(null, { status: 304, headers: h });
  h.set('Content-Length', String(p.size));
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers: h });
  const keys = [];
  for (let i = 0; i < (p.parts || 1); i++) keys.push(ed + ':ph:' + name + ':' + p.etag + ':' + i);
  const first = await env.DATA.get(keys[0], { type: 'stream' });
  if (!first) return nothing();
  if (keys.length === 1) return new Response(first, { status: 200, headers: h });
  const { readable, writable } = new TransformStream();
  context.waitUntil((async () => {
    try {
      await first.pipeTo(writable, { preventClose: true });
      for (let i = 1; i < keys.length; i++) {
        const s = await env.DATA.get(keys[i], { type: 'stream' });
        if (!s) throw new Error('part missing');
        await s.pipeTo(writable, { preventClose: true });
      }
      await writable.close();
    } catch (e) {
      await writable.abort(e);
    }
  })());
  return new Response(readable, { status: 200, headers: h });
}
