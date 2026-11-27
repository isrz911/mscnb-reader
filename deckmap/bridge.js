/* bridge.js - added by sw.js at the end of the decrypted page. The page itself is not changed.
   1. Manual mode (the person loads the data file): a small button "⇅ <age>" to the reader page, where the data is updated.
   2. Automatic mode: new data is applied by itself when nobody is using the page, as in Live build 2: the page went to
      the background (other app, screen off), or 60 s without touch, mouse or keys. The page's own "New data ... Tap to
      reload" still works at once. Sheet, hull and deck the page remembers itself; other filters start fresh (Live keeps
      them through window.__DM_DEV, not done here yet). */
(function () {
  'use strict';
  var IT = /^it\b/i.test(navigator.language || '');
  /* r20: did the page know at its start that photos are here (the worker sets the flag before the page's scripts)? */
  var PH_AT_LOAD = !!window.__MSC_PH, phReload = false;

  /* 3. (r16) The data page is the one people see, so they put it on the Home Screen from here. Its own head has another
     name and no icon of ours (seen on an iPhone 27.11: an empty icon, "MSC CRM GE"). So the reader's icon and short name
     replace them here; Safari and Chrome read them at the moment of adding. Off iPhone also the reader's manifest, so
     that "Install app" in Chrome makes the same app as the Install button on the reader page. */
  (function () {
    var h = document.head || document.getElementsByTagName('head')[0];
    if (!h) return;
    var ua = navigator.userAgent, ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    Array.prototype.slice.call(h.querySelectorAll('link[rel~="icon"],link[rel="apple-touch-icon"],link[rel="apple-touch-icon-precomposed"],' +
      'link[rel="manifest"],meta[name="apple-mobile-web-app-title"],meta[name="application-name"]')).forEach(function (n) { n.parentNode.removeChild(n); });
    function add(tag, attrs) {
      var n = document.createElement(tag);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      h.appendChild(n);
    }
    add('link', { rel: 'apple-touch-icon', href: 'icon-180.png?v=4bebdb09' });
    add('link', { rel: 'icon', href: 'icon-192.png?v=4bebdb09' });
    add('meta', { name: 'apple-mobile-web-app-title', content: 'Deck Map' });
    add('meta', { name: 'application-name', content: 'Deck Map' });
    if (!ios) add('link', { rel: 'manifest', href: 'reader.webmanifest' });
    /* r17: on an iPhone, in a Safari tab, the address of this page gets the access link (#k=...), so that an icon added
       from here works also as a Home Screen web app (which has storage of its own). Nothing goes to the network: the
       part after # stays in the browser. */
    var standalone = navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    if (ios && !standalone && !location.hash) {
      fetch('link.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (o) {
        if (o && o.k && !location.hash) history.replaceState(history.state, '', location.pathname + location.search + '#' + new URLSearchParams(o).toString());
      }).catch(function () {});
    }
  })();
  var shown = '';
  try {
    var t = document.getElementById('crm-snap').firstChild.nodeValue.slice(0, 4000);
    var m = /"batch":"([^"]*)"/.exec(t); shown = m ? m[1] : '';
  } catch (e) { shown = ''; }
  var latest = shown, lastInput = Date.now();
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) {
    window.addEventListener(ev, function () { lastInput = Date.now(); }, { capture: true, passive: true });
  });
  /* poll(): what is stored (local, no network). poll(true): automatic mode, ask the worker to look for a newer file first
     (it does so at most once a minute): when the page opens, comes back on screen, or the network comes back, so a
     phone that was offline or closed at the time of a new snapshot gets it at once, without waiting for any schedule. */
  var mode = '';
  /* r17: may data download by itself on this network? The same rule as reader-core.js autoAllowed(), told to the worker */
  function netAllowed() {
    var c = navigator.connection, t = c && c.type || '';
    if (c && c.saveData) return false;
    if (t === 'wifi' || t === 'ethernet') return true;
    if (t === 'cellular' || t === 'bluetooth' || t === 'wimax') return false;
    return !/Android/i.test(navigator.userAgent);
  }
  function poll(look) {
    return fetch('state.json?net=' + (netAllowed() ? 1 : 0) + (look && mode === 'auto' ? '&check=1' : ''), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (s) {
      mode = s.mode; if (s.batch) latest = s.batch; return s;
    }).catch(function () { return null; });
  }
  /* new data, or (r20) photos that came after this page built its sheets: the page opens again when nobody uses it */
  function newer() { return phReload || !!(shown && latest && latest !== shown); }
  function applyIfIdle() { if (newer() && Date.now() - lastInput > 60000) location.reload(); }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && newer()) location.reload();
    else if (!document.hidden) poll(true).then(applyIfIdle);
  });
  window.addEventListener('online', function () { setTimeout(function () { poll(true).then(applyIfIdle); }, 3000); });
  if (navigator.connection && navigator.connection.addEventListener)        // r17: Wi-Fi again -> look at once
    navigator.connection.addEventListener('change', function () { if (netAllowed()) setTimeout(function () { poll(true).then(applyIfIdle); }, 3000); });
  setInterval(function () {
    poll().then(function () { if (newer() && (document.hidden || Date.now() - lastInput > 60000)) location.reload(); });
  }, 30000);

  function ageText(h) { return h < 0 ? '' : h < 1 ? '<1 h' : h < 48 ? Math.floor(h) + ' h' : Math.floor(h / 24) + (IT ? ' g' : ' d'); }
  function mbs(n) { return (n / 1048576).toFixed(n < 10485760 ? 1 : 0); }
  function two(n) { return (n < 10 ? '0' : '') + n; }
  function shortLm(lm) {
    var m = /^(\d\d)\.(\d\d)\.\d{4}\s+(\d\d:\d\d)/.exec(lm || '');
    return m ? m[1] + '.' + m[2] + ' ' + m[3] : String(lm || '?').replace(/\s*LT$/, '');
  }
  function when(ms) {
    if (!ms) return IT ? 'mai' : 'never';
    var d = new Date(ms);
    return two(d.getDate()) + '.' + two(d.getMonth() + 1) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
  }

  /* r21 (user 27.11): ONE badge in the header, in place of the page's own data time (#dm-off, "● 26.11 17:40": a thin dot
     the eye loses), an oval with the sync sign, in colours that stand out on the navy header:
       white "⇅ 26.11 17:40"   data here; a tap looks for new data now (on any network: the person decides)
       green "✓ 26.11 17:40"   just checked; "⇣ New data · 15 MB" / "📷 ⇣ 444 MB": waiting for a tap (Android, mobile data)
       amber "⇣ 6.1 / 15 MB", "📷 120 / 565 MB": downloading;  "⚠ 26.11 17:40": the data may be out of date
     Without that element (another page) the same badge sits at the bottom right. Manual mode: a tap opens the reader page. */
  var HB = null, hbText = '', S = null, busy = false, phBusy = false, dataProg = '', phText = '', msgText = '', msgMode = '', msgUntil = 0, checkedUntil = 0;
  var CSS = 'html.mscr #dm-off{display:inline-flex!important;align-items:center;background:#fff!important;color:#000A3C!important;' +
    'font:700 13px/1 system-ui,-apple-system,sans-serif!important;padding:7px 12px!important;border-radius:999px!important;' +
    'box-shadow:0 1px 8px rgba(0,0,0,.4)!important;cursor:pointer!important;text-decoration:none!important;max-width:62vw!important;' +
    'white-space:nowrap!important;overflow:hidden;text-overflow:ellipsis;pointer-events:auto!important}' +
    'html.mscr #dm-off::before{display:none!important}' +
    /* phones upright: the badge is wider than the page's own pill, so the logo gets a little smaller (it keeps its shape);
       on sheets without the Filters button the badge moves to the right edge */
    '@media (orientation:portrait),(min-height:601px){html.mscr .dm-mob #dm-logo{max-width:calc(100vw - 285px - var(--sal) - var(--sar))!important}' +
    'html.mscr .dm-hf.dm-mob #dm-off{right:calc(10px + var(--sar))!important;left:auto!important}' +
    'html.mscr .dm-hf.dm-mob #dm-logo{max-width:calc(100vw - 195px - var(--sal) - var(--sar))!important}}' +
    /* wide screens (tablet sideways, computer): in the navy header at the right, not over the legend at the bottom left */
    'html.mscr .dm-desk #dm-off{position:fixed!important;top:14px!important;right:16px!important;left:auto!important;bottom:auto!important;' +
    'transform:none!important;font-size:14px!important;padding:8px 14px!important}' +
    'html.mscr[data-ms="ok"] #dm-off,html.mscr[data-ms="new"] #dm-off{background:#22C55E!important;color:#052e14!important}' +
    'html.mscr[data-ms="busy"] #dm-off,html.mscr[data-ms="stale"] #dm-off{background:#EAB308!important;color:#1f1400!important}' +
    'html.mscr[data-ms="err"] #dm-off{background:#ef4444!important;color:#fff!important}' +
    '#mscr-hb{position:fixed;right:10px;bottom:calc(10px + env(safe-area-inset-bottom));z-index:2147483000;border:0;' +
    'font:700 13px/1 system-ui,-apple-system,sans-serif;padding:9px 13px;border-radius:999px;background:#fff;color:#000A3C;box-shadow:0 2px 8px rgba(0,0,0,.35)}' +
    'html[data-ms="ok"] #mscr-hb,html[data-ms="new"] #mscr-hb{background:#22C55E;color:#052e14}' +
    'html[data-ms="busy"] #mscr-hb,html[data-ms="stale"] #mscr-hb{background:#EAB308;color:#1f1400}' +
    'html[data-ms="err"] #mscr-hb{background:#ef4444;color:#fff}' +
    /* r22: a photo of Defects LOG on the whole screen (guest page c56 puts dm-deffs on <html>): the badge and the reminder
       step aside, they would cover the photo and its strip of thumbnails */
    'html.mscr.dm-deffs #dm-off,html.dm-deffs #mscr-hb,html.dm-deffs #mscr-bar{display:none!important}';
  function hbEl() {
    if (HB && HB.isConnected) return HB;
    if (!document.getElementById('mscr-css')) {
      var st = document.createElement('style'); st.id = 'mscr-css'; st.textContent = CSS; (document.head || document.documentElement).appendChild(st);
    }
    var e = document.getElementById('dm-off');
    if (e) {
      document.documentElement.classList.add('mscr');
      e.addEventListener('click', function (ev) { ev.stopPropagation(); ev.preventDefault(); hbTap(); }, true);
      /* the page writes its own text here now and then (its offline badge): ours stays */
      try { new MutationObserver(function () { if (hbText && e.textContent !== hbText) e.textContent = hbText; }).observe(e, { childList: true, characterData: true, subtree: true }); } catch (x) {}
    } else {
      e = document.createElement('button'); e.id = 'mscr-hb'; e.onclick = hbTap; document.body.appendChild(e);
    }
    return (HB = e);
  }
  function hb(mode, text, title) {
    var e = hbEl();
    document.documentElement.setAttribute('data-ms', mode || 'idle');
    hbText = text;
    if (e.textContent !== text) e.textContent = text;
    e.title = title || '';
    e.setAttribute('aria-label', title || text);
  }
  function phWaiting(s) {                          // photos missing and they do not come by themselves here
    var p = s && s.ph;
    return !!(p && p.have < p.total && !(s.auto && netAllowed()));
  }
  function render(s) {
    if (s) S = s;
    s = S;
    if (!s) return;
    var lm = shortLm(s.lm), tip = (IT ? 'Dati del ' : 'Data of ') + (s.lm || '?');
    if (dataProg) return hb('busy', '\u21e3 ' + dataProg, tip);
    if (Date.now() < msgUntil) return hb(msgMode, msgText, tip);
    if (phText) return hb('busy', phText, IT ? 'Download delle foto dei difetti' : 'Downloading the photos of the defects');
    if (s.mode === 'auto' && s.pend && s.pend.size) {
      return hb('new', '\u21e3 ' + (IT ? 'Nuovi dati \u00b7 ' : 'New data \u00b7 ') + mbs(s.pend.size) + ' MB',
                (IT ? 'Dati del ' : 'Data of ') + (s.pend.lm || '?') + (IT ? '. Tocca per scaricare' : '. Tap to download'));
    }
    if (s.mode === 'auto' && phWaiting(s)) {
      return hb('new', '\ud83d\udcf7 \u21e3 ' + mbs(s.ph.bytes - s.ph.haveBytes) + ' MB', IT ? 'Tocca per scaricare le foto dei difetti' : 'Tap to download the photos of the defects');
    }
    if (Date.now() < checkedUntil) return hb('ok', '\u2713 ' + lm, (IT ? 'Controllato alle ' : 'Checked at ') + when(s.seen).slice(6) + '. ' + tip);
    if (s.mode === 'manual') return hb(s.age >= 24 ? 'stale' : 'idle', (s.age >= 24 ? '\u26a0 ' : '\u21c5 ') + lm, tip + (IT ? '. Aggiorna i dati' : '. Update the data'));
    hb(s.stale ? 'stale' : 'idle', (s.stale ? '\u26a0 ' : '\u21c5 ') + lm, tip + (IT ? '. Tocca per cercare nuovi dati' : '. Tap to look for new data'));
  }
  function say(mode, text, ms) { msgMode = mode; msgText = text; msgUntil = Date.now() + ms; render(); setTimeout(render, ms + 50); }
  function hbTap() {
    var s = S;
    if (!s || busy || phBusy) return;
    if (s.mode === 'manual') { location.href = './?manage=1'; return; }
    if (!(s.pend && s.pend.size) && phWaiting(s)) { photosNow(); return; }
    dataNow();
  }
  /* data now, on any network; the megabytes come from the worker */
  function dataNow() {
    busy = true; dataProg = '\u2026'; render();
    fetch('state.json?now=1&net=' + (netAllowed() ? 1 : 0), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (n) {
      busy = false; dataProg = '';
      if (n && n.batch && n.batch !== shown) { location.reload(); return; }
      var err = n && n.last && n.last.status === 'err';
      S = n || S; staleBar(n);
      say(err ? 'err' : 'ok', err ? (IT ? 'Nessuna connessione' : 'No connection') : '\u2713 ' + (IT ? 'Aggiornati' : 'Up to date'), 3000);
    }).catch(function () { busy = false; dataProg = ''; say('err', IT ? 'Nessuna connessione' : 'No connection', 3000); });
  }
  function photosNow() {
    phBusy = true; phText = '\ud83d\udcf7 \u2026'; render();
    fetch('state.json?ph=1&now=1&net=' + (netAllowed() ? 1 : 0), { cache: 'no-store' }).catch(function () { phBusy = false; phText = ''; render(); });
  }
  var bc = null;
  try { bc = new BroadcastChannel('msc-reader:' + new URL('./', location.href).pathname); } catch (e) { bc = null; }
  if (bc) bc.onmessage = function (e) {
    var m = e.data || {};
    if (m.t === 'prog' && busy && m.total) { dataProg = mbs(m.got) + ' / ' + mbs(m.total) + ' MB'; render(); }
    if (m.t === 'phprog') phProg(m);
    if (m.t === 'phstate' && !phBusy) poll();
  };

  /* r20 (user 27.11): the photo progress also inside the photo area of the Defects LOG sheet (a srcdoc frame of the page,
     same origin), under its own note, in megabytes; r21: in the colours of the badge */
  function phInSheet(text) {
    var docs = [document];
    [].forEach.call(document.querySelectorAll('iframe'), function (f) { try { if (f.contentDocument) docs.push(f.contentDocument); } catch (e) {} });
    docs.forEach(function (d) {
      var stage = d.getElementById && d.getElementById('stage'), el = d.getElementById && d.getElementById('mscph');
      if (!stage) return;
      if (!text) { if (el) el.remove(); return; }
      if (!el) {
        el = d.createElement('div'); el.id = 'mscph';
        el.style.cssText = 'position:absolute;left:50%;top:62%;transform:translateX(-50%);z-index:50;padding:8px 14px;border-radius:999px;' +
          'background:#EAB308;color:#1f1400;font:700 14px/1.3 system-ui,-apple-system,sans-serif;white-space:nowrap;pointer-events:none;box-shadow:0 2px 10px rgba(0,0,0,.4)';
        stage.appendChild(el);
      }
      el.textContent = text;
    });
  }
  function phProg(m) {
    if (m.done) {
      phBusy = false; phText = '';
      phInSheet(m.err ? null : '\ud83d\udcf7 ' + (IT ? 'Foto scaricate' : 'Photos downloaded') + (phReload ? (IT ? ': si vedono alla prossima apertura' : ': they show at the next opening') : ''));
      setTimeout(function () { phInSheet(null); }, 8000);
      say(m.err ? 'err' : 'ok', m.err ? '\ud83d\udcf7 ' + (IT ? 'Foto: errore' : 'Photos: error') : '\ud83d\udcf7 \u2713', 3000);
      setTimeout(function () { poll(); }, 3100);
      return;
    }
    phBusy = true;
    phText = '\ud83d\udcf7 ' + mbs(m.got || 0) + ' / ' + mbs(m.bytes || 0) + ' MB';
    render();
    phInSheet('\ud83d\udcf7 ' + (IT ? 'Download foto: ' : 'Downloading photos: ') + mbs(m.got || 0) + ' / ' + mbs(m.bytes || 0) + ' MB');
  }
  function photoFlag(s) {
    /* the page decides where photos come from when it builds the Defects LOG sheet; the worker sets this flag at the start
       of the page once the reader knows there are photos, here it is set for a sheet built later in this visit */
    if (s && s.ph) { window.__MSC_PH = 1; if (!PH_AT_LOAD) phReload = true; }
  }
  /* r20: after a look the badge says for a few seconds that the data was checked */
  function checked(s) {
    if (busy || !s.seen || !s.last || (s.last.status !== 'same' && s.last.status !== 'new')) return;
    if (Date.now() - s.seen > 120000) return;
    checkedUntil = Date.now() + 6000;
    setTimeout(render, 6100);
  }

  /* r18: a reminder under the header when the data may be out of date: the source could not be reached since new data may
     have come (no network, phone off), or (manual mode) the data is older than a day. Closes with x; comes back while so. */
  var bar = null, barOff = false;
  function staleBar(s) {
    var on = !!(s && s.stale) && !barOff;
    if (!on) { if (bar) { bar.remove(); bar = null; } return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'mscr-bar';
      bar.style.cssText = 'position:fixed;left:8px;right:8px;top:calc(60px + env(safe-area-inset-top));z-index:2147483001;' +
        'background:#EAB308;color:#1f1400;border-radius:10px;padding:9px 34px 9px 12px;box-shadow:0 3px 12px rgba(0,0,0,.35);' +
        'font:600 13px/1.35 system-ui,-apple-system,sans-serif';
      var x = document.createElement('button');
      x.textContent = '\u00d7';
      x.setAttribute('aria-label', IT ? 'Chiudi' : 'Close');
      x.style.cssText = 'position:absolute;right:4px;top:4px;width:28px;height:28px;border:0;background:none;color:#1f1400;font:700 18px/28px system-ui';
      x.onclick = function () { barOff = true; staleBar(null); };
      bar.appendChild(document.createElement('span'));
      bar.appendChild(x);
      document.body.appendChild(bar);
    }
    var lm = (s.lm || '?').replace(/\s*LT$/, '');
    bar.firstChild.textContent = s.mode === 'auto'
      ? (IT ? 'I dati potrebbero non essere aggiornati: dati del ' + lm + ', ultimo controllo ' + when(s.seen) + '. Collegati a internet o tocca \u26a0 in alto.'
            : 'The data may be out of date: data of ' + lm + ', last checked ' + when(s.seen) + '. Connect to the internet or tap \u26a0 at the top.')
      : (IT ? 'Dati del ' + lm + ': più di un giorno fa. Tocca \u26a0 in alto per aggiornare.'
            : 'Data of ' + lm + ': more than a day old. Tap \u26a0 at the top to update.');
  }

  var poll0 = poll;
  poll = function (look) {
    return poll0(look).then(function (s) {
      if (s && (s.mode === 'auto' || s.mode === 'manual')) {
        photoFlag(s);
        if (look) { staleBar(s); checked(s); }
        render(s);
      }
      return s;
    });
  };

  poll().then(function (s) {
    if (s && s.mode === 'auto') { setTimeout(function () { poll(true); }, 2000); return; }   // opened: look now
    if (s && s.mode === 'manual') staleBar(s);
  });
})();
