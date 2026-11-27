/* reader-core.js - MSC data reader (prototype, 27.11.2026): shared by the reader page (index.html) and the service
   worker (sw.js). It opens the same encrypted data file as the Live programs, in the browser, with no installation:

     MSCD1 | iv(16) | AES-256-CBC(gzip(page html)) | HMAC-SHA256(everything before)       (OfflineApp.cs, class Crypto)
     m = 32-byte edition key; key of AES = SHA256(m + "enc"), key of HMAC = SHA256(m + "mac")

   The file holds the whole guest page (app + snapshot, file mode of crm_ge/web/app.js). The reader keeps the file as it
   came (still encrypted) in IndexedDB, with the key it was given in the access link; the service worker decrypts it
   for every opening of app.html, so the page runs at the top level, as in the programs, also without network.
   Where the file comes from is configuration ("src"): a URL the reader may fetch by itself (automatic updates), or
   nothing (the reader loads a file the person downloaded, for instance from the MSC OneDrive folder).
   WebCrypto and DecompressionStream: Chrome / Edge 80+, Safari and iOS 16.4+, Firefox 113+. */
(function (G) {
  'use strict';
  var MAGIC = [0x4d, 0x53, 0x43, 0x44, 0x31];      // "MSCD1"
  var HEAD = MAGIC.length + 16;
  var TE = new TextEncoder();

  function b64uDecode(s) {
    s = String(s || '').trim().replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function concat(a, b) { var u = new Uint8Array(a.length + b.length); u.set(a, 0); u.set(b, a.length); return u; }
  function derive(m, label) {
    return crypto.subtle.digest('SHA-256', concat(m, TE.encode(label))).then(function (d) { return new Uint8Array(d); });
  }
  function keyBytes(k) {
    var m = b64uDecode(k);
    if (m.length !== 32) throw new Error('the access key must be 32 bytes, this one has ' + m.length);
    return m;
  }

  /* verify and decrypt: returns the gzip bytes of the page. Throws on a wrong key, a damaged or half-downloaded file. */
  function unpackGz(buf, k) {
    var u = new Uint8Array(buf), m;
    try { m = keyBytes(k); } catch (e) { return Promise.reject(e); }
    if (u.length < HEAD + 16 + 32) return Promise.reject(new Error('data file too short'));
    for (var i = 0; i < MAGIC.length; i++) if (u[i] !== MAGIC[i]) return Promise.reject(new Error('not a data file of this app'));
    var bodyLen = u.length - 32;
    return Promise.all([derive(m, 'enc'), derive(m, 'mac')]).then(function (ks) {
      return crypto.subtle.importKey('raw', ks[1], { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']).then(function (hk) {
        return crypto.subtle.verify('HMAC', hk, u.subarray(bodyLen), u.subarray(0, bodyLen));
      }).then(function (ok) {
        if (!ok) throw new Error('data file damaged, incomplete, or made for another key');
        return crypto.subtle.importKey('raw', ks[0], { name: 'AES-CBC' }, false, ['decrypt']);
      }).then(function (ak) {
        return crypto.subtle.decrypt({ name: 'AES-CBC', iv: u.slice(MAGIC.length, HEAD) }, ak, u.subarray(HEAD, bodyLen));
      });
    });
  }
  function gunzip(gz) { return new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip')); }

  /* the snapshot stamp {batch, lm} sits near the top of the page (#crm-snap), as OfflineApp.cs reads it */
  var STAMP_RE = /"batch":"([^"]*)","lm":"([^"]*)"/;
  function stampOf(text) { var m = STAMP_RE.exec(text); return m ? { batch: m[1], lm: m[2] } : { batch: '', lm: '' }; }
  /* decrypt, read only the first 400 000 characters for the stamp */
  function inspect(buf, k) {
    return unpackGz(buf, k).then(function (gz) {
      var rd = gunzip(gz).pipeThrough(new TextDecoderStream()).getReader(), text = '';
      function more() {
        return rd.read().then(function (r) {
          if (!r.done) text += r.value;
          if (r.done || text.length >= 400000) { if (!r.done) rd.cancel().catch(function () {}); return stampOf(text.slice(0, 400000)); }
          return more();
        });
      }
      return more();
    });
  }
  /* <name>.stamp.js as the guest builder writes it: window.__CRM_STAMP&&window.__CRM_STAMP("batch","lm"); */
  function parseStampJs(t) {
    var m = /__CRM_STAMP\(\s*("(?:[^"\\]|\\.)*")\s*,\s*("(?:[^"\\]|\\.)*")\s*\)/.exec(t || '');
    if (!m) return null;
    try { return { batch: JSON.parse(m[1]), lm: JSON.parse(m[2]) }; } catch (e) { return null; }
  }

  /* ---------------------------------------------------------------- IndexedDB: kv store "cfg", "cur", "last"
     One reader per folder of the site (deckmap/, crmge/): storage and caches are per origin, so their names carry the
     folder. In the page and in the service worker './' is the same folder. */
  var SCOPE = new URL('./', self.location.href).pathname;
  /* r18: download progress for the open pages (the worker downloads, the page shows "6.1 / 15.2 MB") */
  var BC = null;
  try { BC = new BroadcastChannel('msc-reader:' + SCOPE); } catch (e) { BC = null; }
  function readBody(r, total) {
    if (!r.body || !r.body.getReader) return r.arrayBuffer();
    var rd = r.body.getReader(), parts = [], got = 0, last = 0;
    function more() {
      return rd.read().then(function (x) {
        if (x.done) {
          var u = new Uint8Array(got), o = 0;
          parts.forEach(function (p) { u.set(p, o); o += p.length; });
          if (BC) BC.postMessage({ t: 'prog', got: got, total: total || got, done: true });
          return u.buffer;
        }
        parts.push(x.value); got += x.value.length;
        var now = Date.now();
        if (BC && now - last > 200) { last = now; BC.postMessage({ t: 'prog', got: got, total: total }); }
        return more();
      });
    }
    if (BC) BC.postMessage({ t: 'prog', got: 0, total: total });
    return more();
  }
  var dbp = null;
  function db() {
    if (!dbp) dbp = new Promise(function (res, rej) {
      var r = indexedDB.open('msc-reader:' + SCOPE, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { dbp = null; rej(r.error); };
    });
    return dbp;
  }
  function kv(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var tx = d.transaction('kv', mode), st = tx.objectStore('kv'), out;
        var q = fn(st); if (q) q.onsuccess = function () { out = q.result; };
        tx.oncomplete = function () { res(out); };
        tx.onerror = tx.onabort = function () { rej(tx.error || new Error('storage error')); };
      });
    });
  }
  function get(k) { return kv('readonly', function (st) { return st.get(k); }); }
  function put(k, v) { return kv('readwrite', function (st) { st.put(v, k); }); }
  function del(k) { return kv('readwrite', function (st) { st.delete(k); }); }

  /* ---------------------------------------------------------------- the access link
     #k=<key, base64url>&f=<link that downloads the .dat from MSC OneDrive>&dir=<link to its folder>&n=<name>
     (manual mode: the person downloads the file with their own sign-in and loads it here), or
     #k=...&src=/data/<edition>&f=... (automatic mode, r17: the encrypted file on the reader's own host, Cloudflare; the
     OneDrive link stays as the other way), or #k=...&src=<any URL>&st=<stamp URL> (older test form).
     Everything after # stays in the browser: it is never sent to any server. */
  function parseLink(s) {
    s = String(s || '').trim();
    var i = s.indexOf('#'); if (i >= 0) s = s.slice(i + 1);
    var p = new URLSearchParams(s), c = {};
    ['k', 'src', 'st', 'f', 'dir', 'n'].forEach(function (x) { if (p.get(x)) c[x] = p.get(x); });
    if (!c.k) return null;
    keyBytes(c.k);                                    // throws on a bad key
    return c;
  }

  /* data from a file the person picked (manual mode, or an extra file in automatic mode) */
  function importFile(buf, cfg, meta) {
    return inspect(buf, cfg.k).then(function (s) {
      var rec = { dat: buf, batch: s.batch, lm: s.lm, size: buf.byteLength, at: Date.now(), from: 'file',
                  etag: '', lastmod: '' };
      if (meta) for (var x in meta) rec[x] = meta[x];
      return put('cur', rec).then(function () { return rec; });
    });
  }

  /* r17: the data file on the reader's own host (/data/<edition>, Cloudflare) is given only to a reader that has the key:
     X-Reader-Token = base64url(HMAC-SHA256(key, "mscnb-data-v1")). The key itself never leaves the device. */
  var tokens = {};
  function tokenOf(k) {
    if (tokens[k]) return Promise.resolve(tokens[k]);
    var m;
    try { m = keyBytes(k); } catch (e) { return Promise.reject(e); }
    return crypto.subtle.importKey('raw', m, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']).then(function (hk) {
      return crypto.subtle.sign('HMAC', hk, TE.encode('mscnb-data-v1'));
    }).then(function (sig) {
      var u = new Uint8Array(sig), s = '';
      for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
      return (tokens[k] = btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
    });
  }

  /* r17, the user's rule (27.11.2026): service phones (Android) have little mobile data, so on a mobile network nothing
     is downloaded by itself, only on a tap; on Wi-Fi all by itself. iPhones are private phones without such limits:
     automatic always. Browsers that do not tell the network (iPhone, most computers) count as "allowed", except Android. */
  function netType() {
    var c = self.navigator && self.navigator.connection;
    return c ? { type: c.type || '', save: !!c.saveData } : { type: '', save: false };
  }
  function autoAllowed() {
    var n = netType(), t = n.type, android = /Android/i.test((self.navigator && self.navigator.userAgent) || '');
    if (n.save) return false;                                       // the person asked the phone to save data
    if (t === 'wifi' || t === 'ethernet') return true;
    if (t === 'cellular' || t === 'bluetooth' || t === 'wimax') return false;
    return !android;
  }

  /* automatic mode: look for a newer data file. Result {status: 'manual'|'same'|'new'|'pending', batch, lm, size};
     throws on network errors and on files that do not decrypt (then the stored copy stays). base = URL the links are
     relative to. opt.manual: the person asked (download on any network); otherwise on a network where automatic
     downloads are not allowed only a HEAD request (a few hundred bytes) says whether there is something new: 'pending'. */
  function checkSource(base, cfg, cur, opt) {
    if (!cfg || !cfg.src) return Promise.resolve({ status: 'manual' });
    var src = new URL(cfg.src, base), same = src.origin === new URL(base).origin;
    /* opt.allowed: the page's own view of the network (a worker may not see it); either "no" means only a look */
    var probe = !(opt && opt.manual) && (!autoAllowed() || (opt && opt.allowed === false));
    if (same && !cfg.st) return tokenOf(cfg.k).then(function (tok) {
      var h = { 'X-Reader-Token': tok }, cond = cur && cur.src === src.href;
      if (cond && cur.etag) h['If-None-Match'] = cur.etag;
      return fetch(src, { method: probe ? 'HEAD' : 'GET', cache: 'no-store', headers: h, credentials: 'same-origin' }).then(function (r) {
        if (r.status === 304) return { status: 'same', batch: cur.batch, lm: cur.lm };
        if (!r.ok) throw new Error('data HTTP ' + r.status);
        var etag = r.headers.get('ETag') || '', lastmod = r.headers.get('Last-Modified') || '';
        var hb = r.headers.get('X-Batch') || '', hl = r.headers.get('X-LM') || '', hs = +(r.headers.get('X-Size') || 0);
        if (cur && hb && hb === cur.batch) {                 // same snapshot under a new address: nothing to download
          if (!probe) r.body && r.body.cancel && r.body.cancel().catch(function () {});
          cur.etag = etag; cur.lastmod = lastmod; cur.src = src.href;
          return put('cur', cur).then(function () { return { status: 'same', batch: cur.batch, lm: cur.lm }; });
        }
        if (probe) return { status: 'pending', batch: hb, lm: hl, size: hs };
        return readBody(r, +(r.headers.get('Content-Length') || 0) || hs).then(function (buf) {
          return inspect(buf, cfg.k).then(function (st) {
            var rec = { dat: buf, batch: st.batch, lm: st.lm, size: buf.byteLength, at: Date.now(), from: 'net',
                        etag: etag, lastmod: lastmod, src: src.href };
            return put('cur', rec).then(function () { return { status: 'new', batch: st.batch, lm: st.lm }; });
          });
        });
      });
    });
    /* older form (any host, with a separate stamp file): kept for tests */
    var step = Promise.resolve(null);
    if (cfg.st) step = fetch(new URL(cfg.st, base), { cache: 'no-store', credentials: same ? 'same-origin' : 'omit' })
      .then(function (r) { if (!r.ok) throw new Error('stamp HTTP ' + r.status); return r.text(); })
      .then(parseStampJs);
    return step.then(function (s) {
      if (s && cur && s.batch && s.batch === cur.batch) return { status: 'same', batch: cur.batch, lm: cur.lm };
      var h = {}, cond = same && cur && cur.src === src.href;
      /* conditional request only to the own host (on another host these headers would need a CORS preflight) and only
         for the file the stored copy came from */
      if (cond && cur.etag) h['If-None-Match'] = cur.etag;
      if (cond && cur.lastmod) h['If-Modified-Since'] = cur.lastmod;
      return fetch(src, { cache: 'no-store', headers: h, credentials: same ? 'same-origin' : 'omit' }).then(function (r) {
        if (r.status === 304) return { status: 'same', batch: cur.batch, lm: cur.lm };
        if (!r.ok) throw new Error('data HTTP ' + r.status);
        var etag = r.headers.get('ETag') || '', lastmod = r.headers.get('Last-Modified') || '';
        return r.arrayBuffer().then(function (buf) {
          return inspect(buf, cfg.k).then(function (st) {
            if (cur && st.batch && st.batch === cur.batch) {
              cur.etag = etag; cur.lastmod = lastmod; cur.src = src.href;
              return put('cur', cur).then(function () { return { status: 'same', batch: cur.batch, lm: cur.lm }; });
            }
            var rec = { dat: buf, batch: st.batch, lm: st.lm, size: buf.byteLength, at: Date.now(), from: 'net',
                        etag: etag, lastmod: lastmod, src: src.href };
            return put('cur', rec).then(function () { return { status: 'new', batch: st.batch, lm: st.lm }; });
          });
        });
      });
    });
  }

  /* one check with its result kept in "last" (shown on the reader page); never throws. "pending" (new data waits for a
     tap on a mobile network) keeps its size and stamp, so that the pages can offer it. */
  function checkAndRecord(base, opt) {
    return Promise.all([get('cfg'), get('cur')]).then(function (a) { return checkSource(base, a[0], a[1], opt); }).then(function (r) {
      var l = { at: Date.now(), status: r.status, err: '' };
      if (r.status === 'pending') l.pend = { batch: r.batch || '', lm: r.lm || '', size: r.size || 0 };
      return put('last', l).then(function () { return r.status === 'manual' ? null : put('seen', l.at); }).then(function () { return r; });
    }, function (e) {
      return put('last', { at: Date.now(), status: 'err', err: String(e && e.message || e) }).then(function () { return null; });
    });
  }
  /* what is stored, without the data itself */
  function stateOf(ver) {
    return Promise.all([get('cfg'), get('cur'), get('last'), get('seen')]).then(function (a) {
      var cfg = a[0] || {}, cur = a[1] || {}, last = a[2] || {}, seen = a[3] || 0;
      var pend = last.status === 'pending' && last.pend && last.pend.batch !== cur.batch ? last.pend : null;
      var age = cur.batch ? ageHours(cur) : -1;
      /* r18: not up to date? automatic mode: the source was not reached since new data may have come (the chain runs on
         working days at 08..20 every 2 hours; with the upload a new file is there about 90 minutes later); manual mode:
         older than a day */
      var stale = !cur.batch ? false : cfg.src ? seen < lastSlot(Date.now()) : age >= 24;
      return { ver: ver || '', mode: cfg.src ? 'auto' : (cfg.k ? 'manual' : 'none'), name: cfg.n || '', dir: cfg.dir || '',
               batch: cur.batch || '', lm: cur.lm || '', size: cur.size || 0, at: cur.at || 0, from: cur.from || '', last: last,
               age: age, pend: pend, auto: autoAllowed(), seen: seen, stale: stale };
    });
  }
  /* the newest moment new data may be waiting: a working day, 08:00, 10:00 ... 20:00, plus 90 minutes, not after now */
  function lastSlot(now) {
    var d = new Date(now);
    for (var i = 0; i < 9 * 24; i++) {
      var t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() - i, 0, 0), h = t.getHours(), wd = t.getDay();
      if (wd >= 1 && wd <= 5 && h >= 8 && h <= 20 && h % 2 === 0 && t.getTime() + 90 * 60000 <= now) return t.getTime() + 90 * 60000;
    }
    return 0;
  }

  /* age of the data: "lm" is the time of the data in Italy, "27.11.2026 08:00 LT" (the devices are in Italy too) */
  function lmTime(lm) {
    var m = /(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})/.exec(lm || '');
    return m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]).getTime() : 0;
  }
  function ageHours(cur) {
    var t = cur ? (lmTime(cur.lm) || cur.at || 0) : 0;
    return t ? Math.max(0, (Date.now() - t) / 3600000) : -1;
  }

  G.MSCR = { SCOPE: SCOPE, lmTime: lmTime, ageHours: ageHours, unpackGz: unpackGz, gunzip: gunzip, inspect: inspect, parseStampJs: parseStampJs, parseLink: parseLink,
             importFile: importFile, checkSource: checkSource, checkAndRecord: checkAndRecord, stateOf: stateOf,
             tokenOf: tokenOf, autoAllowed: autoAllowed, netType: netType, lastSlot: lastSlot,
             get: get, put: put, del: del };
})(self);
