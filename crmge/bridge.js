/* bridge.js - added by sw.js at the end of the decrypted page. The page itself is not changed.
   1. Manual mode (the person loads the data file): a small button "⇅ <age>" to the reader page, where the data is updated.
   2. Automatic mode: new data is applied by itself when nobody is using the page, as in Live build 2: the page went to
      the background (other app, screen off), or 60 s without touch, mouse or keys. The page's own "New data ... Tap to
      reload" still works at once. Sheet, hull and deck the page remembers itself; other filters start fresh (Live keeps
      them through window.__DM_DEV, not done here yet). */
(function () {
  'use strict';
  var IT = /^it\b/i.test(navigator.language || '');

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
    add('link', { rel: 'apple-touch-icon', href: 'icon-180.png?v=b541cab4' });
    add('link', { rel: 'icon', href: 'icon-192.png?v=b541cab4' });
    add('meta', { name: 'apple-mobile-web-app-title', content: 'CRM MSC' });
    add('meta', { name: 'application-name', content: 'CRM MSC' });
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
  function newer() { return !!(shown && latest && latest !== shown); }
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
  function pillStyle(bg) {
    return 'position:fixed;right:10px;bottom:calc(10px + env(safe-area-inset-bottom));z-index:2147483000;height:32px;' +
      'padding:0 11px;border-radius:16px;background:' + bg + ';color:#fff;border:0;' +
      'font:600 13px/32px system-ui,-apple-system,sans-serif;text-decoration:none;box-shadow:0 2px 8px rgba(0,0,0,.3);white-space:nowrap';
  }

  /* r17, automatic mode on a network where nothing downloads by itself (an Android phone on mobile data): new data is
     only announced, with its size; one tap downloads it on this network and opens it */
  var pendBtn = null;
  function showPend(s) {
    if (!s || !s.pend || !s.pend.size) { if (pendBtn) { pendBtn.remove(); pendBtn = null; } return; }
    var mb = (s.pend.size / 1048576).toFixed(s.pend.size < 10485760 ? 1 : 0);
    if (!pendBtn) {
      pendBtn = document.createElement('button');
      pendBtn.style.cssText = pillStyle('rgba(30,122,58,.95)');
      pendBtn.onclick = function () {
        busy = true; pendBtn.disabled = true; pendBtn.textContent = IT ? 'Download…' : 'Downloading…';
        fetch('state.json?now=1&net=' + (netAllowed() ? 1 : 0), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (n) {
          busy = false;
          if (n && n.batch && n.batch !== shown) { location.reload(); return; }
          pendBtn.disabled = false; showPend(n); autoPill(n);
        }).catch(function () { busy = false; pendBtn.disabled = false; pendBtn.textContent = IT ? 'Riprova' : 'Try again'; });
      };
      document.body.appendChild(pendBtn);
    }
    pendBtn.textContent = '⇣ ' + (IT ? 'Nuovi dati · ' : 'New data · ') + mb + ' MB';
    pendBtn.title = (IT ? 'Dati del ' : 'Data of ') + (s.pend.lm || '?') + (IT ? '. Tocca per scaricare' : '. Tap to download');
  }
  /* r18: automatic mode, the button "⇅ <age>" on every network: a tap looks for new data now and downloads it (also on a
     mobile network: the person decides), with the megabytes on the button; the worker reports them (BroadcastChannel) */
  var autoBtn = null, busy = false, small = null;
  function mbs(n) { return (n / 1048576).toFixed(n < 10485760 ? 1 : 0); }
  var bc = null;
  try { bc = new BroadcastChannel('msc-reader:' + new URL('./', location.href).pathname); } catch (e) { bc = null; }
  if (bc) bc.onmessage = function (e) {
    var m = e.data || {}, b = busy && (autoBtn || pendBtn);
    if (m.t === 'prog' && b && m.total) { b.style.width = ''; b.style.padding = '0 11px'; b.textContent = '⇣ ' + mbs(m.got) + ' / ' + mbs(m.total) + ' MB'; }
  };
  function shrink(el) {
    clearTimeout(small);
    small = setTimeout(function () {
      if (busy || !el.isConnected) return;
      el.textContent = '⇅'; el.style.padding = '0'; el.style.width = '32px'; el.style.textAlign = 'center'; el.style.opacity = '.85';
    }, 6000);
  }
  function autoPill(s) {
    if (!s || s.mode !== 'auto' || (s.pend && s.pend.size)) { if (autoBtn) { autoBtn.remove(); autoBtn = null; } return; }
    if (busy) return;
    if (!autoBtn) {
      autoBtn = document.createElement('button');
      autoBtn.onclick = function () { updateNow(autoBtn); };
      document.body.appendChild(autoBtn);
    }
    autoBtn.style.cssText = pillStyle(s.stale ? 'rgba(154,91,0,.92)' : 'rgba(0,10,60,.80)');
    autoBtn.textContent = '⇅ ' + ageText(s.age);
    autoBtn.title = (IT ? 'Dati del ' : 'Data of ') + (s.lm || '?') + (IT ? '. Tocca per cercare nuovi dati' : '. Tap to look for new data');
    autoBtn.setAttribute('aria-label', autoBtn.title);
    shrink(autoBtn);
  }
  function updateNow(btn) {
    if (busy) return;
    busy = true; btn.disabled = true;
    btn.style.width = ''; btn.style.padding = '0 11px'; btn.style.opacity = '1';
    btn.textContent = IT ? 'Controllo…' : 'Checking…';
    fetch('state.json?now=1&net=' + (netAllowed() ? 1 : 0), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (n) {
      busy = false; btn.disabled = false;
      if (n && n.batch && n.batch !== shown) { location.reload(); return; }
      var err = n && n.last && n.last.status === 'err';
      btn.textContent = err ? (IT ? 'Nessuna connessione' : 'No connection') : (IT ? '✓ Aggiornati' : '✓ Up to date');
      staleBar(n);
      setTimeout(function () { showPend(n); autoPill(n); }, 2500);
    }).catch(function () {
      busy = false; btn.disabled = false; btn.textContent = IT ? 'Nessuna connessione' : 'No connection';
    });
  }

  /* r18: a reminder at the top when the data may be out of date: the source could not be reached since new data may have
     come (no network, phone off), or (manual mode) the data is older than a day. Closes with x; comes back while it is so. */
  var bar = null, barOff = false;
  function when(ms) {
    if (!ms) return IT ? 'mai' : 'never';
    var d = new Date(ms), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function staleBar(s) {
    var on = !!(s && s.stale) && !barOff;
    if (!on) { if (bar) { bar.remove(); bar = null; } return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.style.cssText = 'position:fixed;left:8px;right:8px;top:calc(8px + env(safe-area-inset-top));z-index:2147483001;' +
        'background:#9a5b00;color:#fff;border-radius:10px;padding:9px 34px 9px 12px;box-shadow:0 3px 12px rgba(0,0,0,.35);' +
        'font:500 13px/1.35 system-ui,-apple-system,sans-serif';
      var x = document.createElement('button');
      x.textContent = '×';
      x.setAttribute('aria-label', IT ? 'Chiudi' : 'Close');
      x.style.cssText = 'position:absolute;right:4px;top:4px;width:28px;height:28px;border:0;background:none;color:#fff;font:600 18px/28px system-ui';
      x.onclick = function () { barOff = true; staleBar(null); };
      bar.appendChild(document.createElement('span'));
      bar.appendChild(x);
      document.body.appendChild(bar);
    }
    var lm = (s.lm || '?').replace(/\s*LT$/, '');
    bar.firstChild.textContent = s.mode === 'auto'
      ? (IT ? 'I dati potrebbero non essere aggiornati: dati del ' + lm + ', ultimo controllo ' + when(s.seen) + '. Collegati a internet o tocca ⇅.'
            : 'The data may be out of date: data of ' + lm + ', last checked ' + when(s.seen) + '. Connect to the internet or tap ⇅.')
      : (IT ? 'Dati del ' + lm + ': più di un giorno fa. Aggiorna i dati con ⇅.'
            : 'Data of ' + lm + ': more than a day old. Update the data with ⇅.');
  }

  var poll0 = poll;
  poll = function (look) {
    return poll0(look).then(function (s) {
      if (s && s.mode === 'auto') { showPend(s); autoPill(s); if (look) staleBar(s); }
      return s;
    });
  };

  poll().then(function (s) {
    if (s && s.mode === 'auto') { setTimeout(function () { poll(true); }, 2000); return; }   // opened: look now
    if (!s || s.mode !== 'manual') return;
    staleBar(s);
    var a = document.createElement('a'), old = s.age >= 24;
    a.href = './?manage=1';
    a.textContent = '⇅ ' + ageText(s.age);
    a.title = (IT ? 'Dati del ' : 'Data of ') + (s.lm || '?') + (IT ? '. Aggiorna i dati' : '. Update the data');
    a.setAttribute('aria-label', a.title);
    a.style.cssText = pillStyle(old ? 'rgba(154,91,0,.92)' : 'rgba(0,10,60,.80)');
    document.body.appendChild(a);
    /* the age stays readable for a few seconds, then the button shrinks to a small round arrow so that it covers less of
       the page (seen on an iPhone 27.11: it hid chart labels); the full text stays in its title and on the reader page */
    shrink(a);
  });
})();
