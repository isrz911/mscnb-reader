/* bridge.js - added by sw.js at the end of the decrypted page. The page itself is not changed.
   1. Manual mode (the person loads the data file): a small button "⇅ <age>" to the reader page, where the data is updated.
   2. Automatic mode: new data is applied by itself when nobody is using the page, as in Live build 2: the page went to
      the background (other app, screen off), or 60 s without touch, mouse or keys. The page's own "New data ... Tap to
      reload" still works at once. Sheet, hull and deck the page remembers itself; other filters start fresh (Live keeps
      them through window.__DM_DEV, not done here yet). */
(function () {
  'use strict';
  var IT = /^it\b/i.test(navigator.language || '');
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
  function poll(look) {
    return fetch('state.json' + (look && mode === 'auto' ? '?check=1' : ''), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (s) {
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
  setInterval(function () {
    poll().then(function () { if (newer() && (document.hidden || Date.now() - lastInput > 60000)) location.reload(); });
  }, 30000);

  function ageText(h) { return h < 0 ? '' : h < 1 ? '<1 h' : h < 48 ? Math.floor(h) + ' h' : Math.floor(h / 24) + (IT ? ' g' : ' d'); }
  poll().then(function (s) {
    if (s && s.mode === 'auto') { setTimeout(function () { poll(true); }, 2000); return; }   // opened: look now
    if (!s || s.mode !== 'manual') return;
    var a = document.createElement('a'), old = s.age >= 24;
    a.href = './?manage=1';
    a.textContent = '⇅ ' + ageText(s.age);
    a.title = (IT ? 'Dati del ' : 'Data of ') + (s.lm || '?') + (IT ? '. Aggiorna i dati' : '. Update the data');
    a.setAttribute('aria-label', a.title);
    a.style.cssText = 'position:fixed;right:10px;bottom:calc(10px + env(safe-area-inset-bottom));z-index:2147483000;height:32px;' +
      'padding:0 11px;border-radius:16px;background:' + (old ? 'rgba(154,91,0,.92)' : 'rgba(0,10,60,.80)') + ';color:#fff;' +
      'font:600 13px/32px system-ui,-apple-system,sans-serif;text-decoration:none;box-shadow:0 2px 8px rgba(0,0,0,.3);white-space:nowrap';
    document.body.appendChild(a);
    /* the age stays readable for a few seconds, then the button shrinks to a small round arrow so that it covers less of
       the page (seen on an iPhone 27.11: it hid chart labels); the full text stays in its title and on the reader page */
    setTimeout(function () {
      a.textContent = '\u21c5';
      a.style.padding = '0'; a.style.width = '32px'; a.style.textAlign = 'center'; a.style.opacity = '.85';
    }, 6000);
  });
})();
