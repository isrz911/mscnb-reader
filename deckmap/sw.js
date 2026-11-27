/* sw.js - service worker of the MSC data reader (27.11.2026). One per folder of the site (deckmap/, crmge/).
   Addresses without .html (Cloudflare Pages redirects x.html to x): the reader page is the folder itself (./), the data
   page is ./app.
   - ./ and the reader files: from its own cache, so the reader opens without network;
   - ./app: the stored data file, decrypted on the fly (still encrypted at rest), plus bridge.js at the end;
     no data yet -> ./;
   - app.stamp.js: the page in file mode asks for <page>.stamp.js every 5 minutes and when it comes back on screen
     (crm_ge/web/app.js, watchFile). In automatic mode that request first looks for a newer data file (at most every
     90 s) and stores it once it decrypts completely; the answer is the stamp of the stored file, so a different batch
     makes the page show its own "New data ... Tap to reload". In manual mode it only answers with the stored stamp;
   - state.json: what is stored, for bridge.js. */
importScripts('reader-core.js');

var VER = 'r23';
var PREFIX = 'msc-reader:' + MSCR.SCOPE + ':';
var SHELL = PREFIX + VER;
var FILES = ['./', 'reader-core.js', 'bridge.js', 'reader.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
var SCOPE = new URL(self.registration.scope);

self.addEventListener('install', function (e) {
  /* r17: a NEW version of the reader waits for a network where automatic downloads are allowed (on an Android phone on
     a mobile network: until Wi-Fi). The browser asks again at the next opening; the first installation is never held. */
  if (self.registration.active && (!MSCR.autoAllowed() || pageNet === false)) {
    e.waitUntil(Promise.reject(new Error('reader update waits for Wi-Fi')));
    return;
  }
  e.waitUntil(caches.open(SHELL).then(function (c) {
    return c.addAll(FILES.map(function (f) { return new Request(f, { cache: 'reload' }); }));   // past the HTTP cache
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf(PREFIX) === 0 && k !== SHELL; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

/* automatic mode: the data comes every 2 hours on working days, and there is no schedule to miss: the newest .dat always
   sits at its address, so any check gets it. bridge.js asks for a check ("forced") when the page opens, comes back on
   screen or the network comes back (not more than once a minute); the page's own stamp request every 5 minutes leads to a
   check at most every 30 minutes. A check is one small request; the file is downloaded only when it is new. */
var checking = null, lastCheck = 0;
/* r17: what the open page says about the network (state.json?net=0|1); a worker may not see the network type itself */
var pageNet = null;
var EVERY = 30 * 60 * 1000, MIN_GAP = 60 * 1000;
/* manual (r17): the person tapped "download": on any network, without waiting for the gaps */
function check(force, manual) {
  if (checking && !manual) return checking;
  if (!manual && Date.now() - lastCheck < (force ? MIN_GAP : EVERY)) return Promise.resolve(null);
  lastCheck = Date.now();
  var run = MSCR.get('cfg').then(function (cfg) {
    return cfg && cfg.src ? MSCR.checkAndRecord(SCOPE.href, { manual: !!manual, allowed: pageNet === false ? false : undefined }) : null;
  }).then(function (r) { if (checking === run) checking = null; return r; }, function () { if (checking === run) checking = null; return null; });
  checking = run;
  return run;
}

/* r23 (27.11.2026: on a Samsung phone with Samsung Internet the data page stayed plain navy): until the page has fully
   loaded, a screen "Opening the data… 12 s" instead of nothing, with the first error of the page if one comes, so that a
   photo of the screen tells slow from broken. It goes at the page's "load" (also if bridge.js never runs), at the latest 5 s
   after the page is parsed (a picture or frame still loading cannot keep it). Before the
   page's own <html>: the class on <html> is ours (the page's <html> has none), the style and script land in <head>. */
var OPENING = '<style>html.mscr-wait body::before{content:var(--mscr-msg,"");position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483646;' +
  'display:flex;align-items:center;justify-content:center;text-align:center;white-space:pre-line;padding:24px;' +
  'background:#000A3C;color:#fff;font:600 17px/1.5 system-ui,-apple-system,sans-serif}</style>' +
  '<script>(function(){var d=document.documentElement,t0=Date.now(),err="",IT=/^it/i.test(navigator.language||"");' +
  'd.className="mscr-wait";' +
  'function q(s){return \'"\'+String(s).replace(/[\\\\"]/g,"\\\\$&").replace(/\\n/g,"\\\\A ")+\'"\';}' +
  'function show(){var s=Math.round((Date.now()-t0)/1000),m=(IT?"Apertura dei dati\\u2026 ":"Opening the data\\u2026 ")+s+" s";' +
  'if(s>=20)m+=IT?"\\nPagina grande: su alcuni telefoni la prima apertura richiede qualche minuto.":"\\nA large page: on some phones the first opening takes a few minutes.";' +
  'if(err)m+=(IT?"\\n\\nErrore: ":"\\n\\nError: ")+err;d.style.setProperty("--mscr-msg",q(m));}' +
  'show();var iv=setInterval(show,1000);' +
  'addEventListener("error",function(e){if(!err&&e&&e.message){err=String(e.message).slice(0,160)+(e.lineno?" ("+e.lineno+")":"");show();}});' +
  'function done(){clearInterval(iv);d.classList.remove("mscr-wait");}' +
  'addEventListener("load",done);addEventListener("DOMContentLoaded",function(){setTimeout(done,5000);});})();</script>';
function appendTail(text) {
  var tail = new TextEncoder().encode(text);
  return new TransformStream({ flush: function (ctl) { ctl.enqueue(tail); } });
}
function prependHead(text) {
  var head = new TextEncoder().encode(text), sent = false;
  return new TransformStream({ transform: function (chunk, ctl) { if (!sent) { ctl.enqueue(head); sent = true; } ctl.enqueue(chunk); },
                               flush: function (ctl) { if (!sent) ctl.enqueue(head); } });
}
/* r19: a photo of Defects LOG, /ph/<hull>/<nnnn>_<ii>.jpg (the address the page uses in the Live program). From the
   reader's own photo store, decrypted now; a photo that is not here yet: its pack is fetched first, if this network
   allows downloads by itself or the person is looking at the photo (a tap) - on an Android phone on mobile data only
   when the person asked for photos. */
function servePhoto(name) {
  return MSCR.get('cfg').then(function (cfg) {
    if (!cfg || !cfg.k) return new Response('', { status: 404 });
    return MSCR.phPhoto(name, cfg.k).then(function (r) {
      if (r) return r;
      var pack = MSCR.phPackOf(name);
      if (!pack || !MSCR.autoAllowed() || pageNet === false) return new Response('', { status: 404 });
      return MSCR.phSync(SCOPE.href, { only: pack }).then(function () { return MSCR.phPhoto(name, cfg.k); }).then(function (r2) {
        return r2 || new Response('', { status: 404 });
      });
    });
  }).catch(function () { return new Response('', { status: 404 }); });
}
/* r19: all photos in the background, after a look for data (on an allowed network), or on a tap (manual) */
function photos(manual) {
  return MSCR.get('cfg').then(function (cfg) {
    if (!cfg || !cfg.src) return null;
    return MSCR.phSync(SCOPE.href, { manual: !!manual, allowed: pageNet === false ? false : undefined });
  }).catch(function () { return null; });
}

function toIndex(why) {
  return Response.redirect(SCOPE.href + (why ? '?err=' + encodeURIComponent(why) : ''), 302);
}

function serveApp() {
  return Promise.all([MSCR.get('cfg'), MSCR.get('cur')]).then(function (a) {
    var cfg = a[0], cur = a[1];
    if (!cfg || !cfg.k || !cur || !cur.dat) return toIndex('');
    return Promise.all([MSCR.unpackGz(cur.dat, cfg.k), MSCR.get('phlist')]).then(function (r) {
      var gz = r[0], hasPh = !!(r[1] && r[1].packs);
      /* r19: with photos, the page learns before its own scripts run that /ph/... answers (as in the Live program,
         window.__MSC_PH); an own doctype first keeps standards mode, the page's doctype later is ignored */
      var body = MSCR.gunzip(gz).pipeThrough(appendTail('\n<script src="bridge.js"></script>\n'));
      body = body.pipeThrough(prependHead('<!DOCTYPE html>' + OPENING + (hasPh ? '<script>window.__MSC_PH=1;</script>' : '') + '\n'));
      return new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }, function (e) { return toIndex(String(e && e.message || e)); });
  });
}

function serveStamp() {
  return check(false).then(function () { return MSCR.get('cur'); }).then(function (cur) {
    var js = cur && cur.batch ? 'window.__CRM_STAMP&&window.__CRM_STAMP(' + JSON.stringify(cur.batch) + ',' + JSON.stringify(cur.lm || '') + ');\n' : '';
    return new Response(js, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' } });
  });
}

/* r17: the access link as stored (local only, never from the network): the data page puts it into its own address on
   an iPhone, so that "Add to Home Screen" from the data page carries the key (a Home Screen web app has storage of its
   own and would otherwise ask for the link) */
function serveLink() {
  return MSCR.get('cfg').then(function (cfg) {
    var o = {};
    if (cfg) ['k', 'src', 'f', 'n'].forEach(function (x) { if (cfg[x]) o[x] = cfg[x]; });
    return new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  });
}

var stateRun = Promise.resolve();
function serveStateDone() { return stateRun.catch(function () {}); }
function serveState(force, manual) {
  var p = serveState0(force, manual); stateRun = p; return p;
}
function serveState0(force, manual) {
  return (force || manual ? check(true, manual) : Promise.resolve(null)).then(function () { return MSCR.stateOf(VER); }).then(function (s) {
    return new Response(JSON.stringify(s), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  });
}

/* the reader's own files must stay cached for use without network; the system may clear Cache Storage while the worker
   stays registered. So every time the data page opens, missing files are fetched again (7 cache look-ups; the network
   only for a missing file, and nothing happens without network). */
function ensureShell() {
  return caches.open(SHELL).then(function (c) {
    return Promise.all(FILES.map(function (f) {
      return c.match(f).then(function (hit) {
        return hit || fetch(new Request(f, { cache: 'reload' })).then(function (r) { if (r.ok && !r.redirected) return c.put(f, r); });
      });
    }));
  }).catch(function () {});                                          // offline: next time
}

self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  var ph = /^\/ph\/(\d{4}\/\d{4}_\d+)\.jpg$/.exec(u.pathname);
  if (ph && u.origin === SCOPE.origin && e.request.method === 'GET') { e.respondWith(servePhoto(ph[1])); return; }
  if (u.origin !== SCOPE.origin || u.pathname.indexOf(SCOPE.pathname) !== 0 || e.request.method !== 'GET') return;
  var rel = u.pathname.slice(SCOPE.pathname.length);
  if (rel === 'app' || rel === 'app.html') { e.respondWith(serveApp()); e.waitUntil(ensureShell()); return; }
  if (rel === 'app.stamp.js') { e.respondWith(serveStamp()); return; }
  if (rel === 'link.json') { e.respondWith(serveLink()); return; }
  if (rel === 'state.json') {
    if (u.searchParams.has('net')) pageNet = u.searchParams.get('net') === '1';
    var look = u.searchParams.get('check') === '1', now = u.searchParams.get('now') === '1';
    e.respondWith(serveState(look, now));
    /* r19: photos after the look for data (in the background), or now on a tap ("ph=1&now=1") */
    if (u.searchParams.get('ph') === '1') e.waitUntil(photos(now));
    else if (look) e.waitUntil(serveStateDone().then(function () { return photos(false); }));
    return;
  }
  if (rel === '' || rel === 'index.html' || FILES.indexOf(rel) >= 0) {
    var key = rel === '' || rel === 'index.html' ? './' : rel;
    e.respondWith(caches.open(SHELL).then(function (c) {
      return c.match(key).then(function (hit) {
        /* a redirected answer (old link with index.html on Cloudflare) is passed on, never cached */
        return hit || fetch(e.request).then(function (r) { if (r.ok && !r.redirected && r.type !== 'opaqueredirect') c.put(key, r.clone()); return r; });
      });
    }));
  }
});
