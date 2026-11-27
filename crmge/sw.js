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

var VER = 'r14';
var PREFIX = 'msc-reader:' + MSCR.SCOPE + ':';
var SHELL = PREFIX + VER;
var FILES = ['./', 'reader-core.js', 'bridge.js', 'reader.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
var SCOPE = new URL(self.registration.scope);

self.addEventListener('install', function (e) {
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
var EVERY = 30 * 60 * 1000, MIN_GAP = 60 * 1000;
function check(force) {
  if (checking) return checking;
  if (Date.now() - lastCheck < (force ? MIN_GAP : EVERY)) return Promise.resolve(null);
  lastCheck = Date.now();
  checking = MSCR.get('cfg').then(function (cfg) {
    return cfg && cfg.src ? MSCR.checkAndRecord(SCOPE.href) : null;      // manual mode: nothing to look for
  }).then(function (r) { checking = null; return r; }, function () { checking = null; return null; });
  return checking;
}

function appendTail(text) {
  var tail = new TextEncoder().encode(text);
  return new TransformStream({ flush: function (ctl) { ctl.enqueue(tail); } });
}
function toIndex(why) {
  return Response.redirect(SCOPE.href + (why ? '?err=' + encodeURIComponent(why) : ''), 302);
}

function serveApp() {
  return Promise.all([MSCR.get('cfg'), MSCR.get('cur')]).then(function (a) {
    var cfg = a[0], cur = a[1];
    if (!cfg || !cfg.k || !cur || !cur.dat) return toIndex('');
    return MSCR.unpackGz(cur.dat, cfg.k).then(function (gz) {
      var body = MSCR.gunzip(gz).pipeThrough(appendTail('\n<script src="bridge.js"></script>\n'));
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

function serveState(force) {
  return (force ? check(true) : Promise.resolve(null)).then(function () { return MSCR.stateOf(VER); }).then(function (s) {
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
  if (u.origin !== SCOPE.origin || u.pathname.indexOf(SCOPE.pathname) !== 0 || e.request.method !== 'GET') return;
  var rel = u.pathname.slice(SCOPE.pathname.length);
  if (rel === 'app' || rel === 'app.html') { e.respondWith(serveApp()); e.waitUntil(ensureShell()); return; }
  if (rel === 'app.stamp.js') { e.respondWith(serveStamp()); return; }
  if (rel === 'state.json') { e.respondWith(serveState(u.searchParams.get('check') === '1')); return; }
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
