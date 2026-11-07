/* joliro PWA client — shared across the joliro apps (joliro PWA kit v1).
 *
 * Load on every page, same origin, after the stylesheet:
 *
 *   <link rel="stylesheet" href="/pwa/joliro-pwa.css">
 *   <script src="/pwa/joliro-pwa.js" defer
 *           data-app="risk"                 short app key, also sent with push subscriptions
 *           data-name="joliroRisk"          standard installed name
 *           data-neutral-name="Chat"        discreet installed name
 *           data-hub="https://www.joliro.org"
 *           data-push="on"                  offer notifications inside the installed app
 *           data-variant="discreet"         ONLY on /pwa/start.html
 *   ></script>
 *
 * What it does:
 *   - registers /sw.js (scope /)
 *   - captures beforeinstallprompt (Android, desktop Chrome/Edge) for an Install button
 *   - detects iPhone/iPad Safari not yet installed (navigator.standalone) and shows
 *     the Add to Home Screen guide instead
 *   - lets the person choose Standard or Discreet before installing; Discreet goes via
 *     /pwa/start.html, which links its own manifest, neutral name and icon
 *   - in the installed app only, offers notifications; permission is requested from the
 *     button tap and nowhere else
 *   - window.joliroPwa.signOutCleanup() unsubscribes from push and clears every cache;
 *     it also runs by itself when the joliro single-logout channel announces sign-out
 *
 * No text from this file is in the translation catalogues yet. English defaults are
 * below; a page can set window.JOLIRO_PWA_STRINGS = {...} before this loads to
 * override any of them.
 *
 * Nothing here writes to localStorage. Dismissals last for the tab (sessionStorage),
 * so a shared or checked device keeps no lasting record that the prompt was seen.
 */
(function () {
  'use strict';
  if (window.joliroPwa) return;

  var script = document.currentScript;
  function attr(name, fallback) {
    var v = script && script.getAttribute(name);
    return v == null || v === '' ? fallback : v;
  }

  var cfg = {
    app: attr('data-app', 'app'),
    name: attr('data-name', document.title || 'App'),
    neutralName: attr('data-neutral-name', 'Notes'),
    hub: attr('data-hub', 'https://www.joliro.org').replace(/\/+$/, ''),
    push: attr('data-push', 'off') === 'on',
    ui: attr('data-ui', 'on') !== 'off',
    variant: attr('data-variant', 'standard'),
    sw: attr('data-sw', '/sw.js'),
    startPage: attr('data-start', '/pwa/start.html'),
    home: attr('data-home', '/'),
    guideBase: attr('data-guide', '/pwa/ios/')
  };

  var S = {
    installChip: 'Install app',
    notifyChip: 'Turn on notifications',
    dismiss: 'Dismiss',
    close: 'Close',
    cancel: 'Not now',
    chooserTitle: 'Add to your home screen',
    chooserIntro: 'Choose how the app looks on this device.',
    standardLabel: 'Standard',
    standardHint: 'Shows as "{name}" with the joliro icon.',
    discreetLabel: 'Discreet',
    discreetHint: 'Shows as "{neutral}" with a plain icon.',
    signInAgain: 'You will need to sign in again inside the installed app.',
    continueBtn: 'Continue',
    installBtn: 'Install',
    discreetIntro: 'This installs a plain-looking copy named "{neutral}".',
    standardInstead: 'Use the standard version instead',
    iosTitle: 'Add to Home Screen',
    iosStep1: 'Tap the ••• button at the bottom right of Safari.',
    iosStep2: 'Tap Share.',
    iosStep3: 'Scroll down and tap Add to Home Screen. You may need to tap View More first.',
    iosStep4: 'Keep Open as Web App switched on, then tap Add.',
    iosChrome: 'Using Chrome? Tap Share in the address bar, then Add to Home Screen.',
    notifyOn: 'Notifications are on.',
    notifyDenied: 'Notifications are turned off for this app in your phone settings.',
    notifyInstallFirst: 'Add the app to your Home Screen first, then turn notifications on from there.',
    notifySignIn: 'Sign in first, then turn notifications on.',
    notifyFailed: 'Notifications could not be turned on. Try again later.'
  };
  var custom = window.JOLIRO_PWA_STRINGS;
  if (custom && typeof custom === 'object') for (var k in custom) if (Object.prototype.hasOwnProperty.call(S, k)) S[k] = String(custom[k]);
  function t(key) { return S[key].replace('{name}', cfg.name).replace('{neutral}', cfg.neutralName); }

  // ---- Environment -----------------------------------------------------------

  var ua = navigator.userAgent || '';
  var isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function isStandalone() {
    return navigator.standalone === true ||
      (window.matchMedia && (window.matchMedia('(display-mode: standalone)').matches ||
                             window.matchMedia('(display-mode: fullscreen)').matches ||
                             window.matchMedia('(display-mode: minimal-ui)').matches));
  }
  var pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  function session(key, value) {
    try {
      if (value === undefined) return sessionStorage.getItem('joliro-pwa:' + key);
      if (value === null) sessionStorage.removeItem('joliro-pwa:' + key);
      else sessionStorage.setItem('joliro-pwa:' + key, value);
    } catch (e) { return null; }
  }

  // ---- Discreet runtime ------------------------------------------------------
  // The discreet app launches at /pwa/start.html, which marks this window and then
  // goes to the app. From then on the window title stays neutral, because iOS and
  // Android show it in the app switcher.

  var params;
  try { params = new URLSearchParams(location.search); } catch (e) { params = null; }
  if (cfg.variant === 'discreet' && isStandalone()) {
    session('variant', 'discreet');
    location.replace(cfg.home);
    return;
  }
  if (params && params.get('pwa') === 'discreet' && isStandalone()) session('variant', 'discreet');
  var discreetRuntime = session('variant') === 'discreet' && isStandalone();

  function holdNeutralTitle() {
    if (document.title !== cfg.neutralName) document.title = cfg.neutralName;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta && meta.getAttribute('content') !== '#F2F3F5') meta.setAttribute('content', '#F2F3F5');
  }
  if (discreetRuntime) {
    holdNeutralTitle();
    try {
      new MutationObserver(holdNeutralTitle).observe(document.head || document.documentElement, {
        subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['content']
      });
    } catch (e) { /* old browser: title is set once */ }
  }

  // ---- Service worker --------------------------------------------------------

  var swReady = null;
  if ('serviceWorker' in navigator) {
    swReady = navigator.serviceWorker.register(cfg.sw, { scope: '/' })
      .then(function () { return navigator.serviceWorker.ready; })
      .catch(function () { return null; });
  }

  // ---- Install ---------------------------------------------------------------

  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    render();
  });
  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    closePanel();
    render();
  });

  function canInstall() {
    if (isStandalone()) return false;
    return !!deferredPrompt || isIOS;
  }

  function promptInstall() {
    if (deferredPrompt) {
      var p = deferredPrompt;
      deferredPrompt = null;
      p.prompt();
      return p.userChoice.then(function (r) { closePanel(); render(); return r && r.outcome; })
        .catch(function () { closePanel(); render(); });
    }
    if (isIOS) { openIOSGuide(); return Promise.resolve('guide'); }
    return Promise.resolve('unavailable');
  }

  // Standard: install from here. Discreet: go to the start page, whose manifest,
  // name and icon are the neutral ones, and install from there.
  function install(choice) {
    if (choice === 'discreet' && cfg.variant !== 'discreet') {
      location.href = cfg.startPage + '?install=1';
      return Promise.resolve('redirect');
    }
    return promptInstall();
  }

  // ---- Push ------------------------------------------------------------------

  var vapidKey = null;
  function loadVapidKey() {
    if (vapidKey) return Promise.resolve(vapidKey);
    return fetch(cfg.hub + '/api/push/public-key', { credentials: 'omit', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { vapidKey = j && j.publicKey ? j.publicKey : null; return vapidKey; })
      .catch(function () { return null; });
  }
  function b64ToBytes(s) {
    var pad = '='.repeat((4 - (s.length % 4)) % 4);
    var raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function post(path, body, keepalive) {
    return fetch(cfg.hub + path, {
      method: 'POST', credentials: 'include', keepalive: !!keepalive,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
  }

  // MUST be called from a click/tap handler. Notification.requestPermission is the
  // first thing it does, so the browser sees the person's tap.
  function enableNotifications() {
    if (!pushSupported) {
      return Promise.resolve({ ok: false, reason: isIOS && !isStandalone() ? 'install-first' : 'unsupported' });
    }
    return Promise.resolve(Notification.requestPermission()).then(function (perm) {
      if (perm !== 'granted') return { ok: false, reason: perm === 'denied' ? 'denied' : 'dismissed' };
      return Promise.all([swReady, loadVapidKey()]).then(function (r) {
        var reg = r[0], key = r[1];
        if (!reg || !key) return { ok: false, reason: 'unavailable' };
        return reg.pushManager.getSubscription()
          .then(function (sub) { return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }); })
          .then(function (sub) {
            return post('/api/push/subscribe', { app: cfg.app, subscription: sub.toJSON() }).then(function (res) {
              if (res.ok) return { ok: true };
              // Not signed in to joliro here: do not leave an orphan subscription behind.
              return sub.unsubscribe().catch(function () {}).then(function () {
                return { ok: false, reason: res.status === 401 ? 'signed-out' : 'server' };
              });
            });
          });
      });
    }).catch(function () { return { ok: false, reason: 'error' }; });
  }

  function notificationState() {
    if (!pushSupported) return Promise.resolve(isIOS && !isStandalone() ? 'install-first' : 'unsupported');
    if (Notification.permission === 'denied') return Promise.resolve('denied');
    if (Notification.permission !== 'granted' || !swReady) return Promise.resolve('off');
    return swReady.then(function (reg) {
      return reg ? reg.pushManager.getSubscription().then(function (s) { return s ? 'on' : 'off'; }) : 'off';
    });
  }

  // ---- Sign-out --------------------------------------------------------------

  var cleaning = null;
  function signOutCleanup(opts) {
    if (cleaning) return cleaning;
    var limit = (opts && opts.timeout) || 1500;
    var tasks = [];
    if ('serviceWorker' in navigator) {
      tasks.push(navigator.serviceWorker.getRegistration('/').then(function (reg) {
        if (!reg || !reg.pushManager) return;
        return reg.pushManager.getSubscription().then(function (sub) {
          if (!sub) return;
          var endpoint = sub.endpoint;
          return sub.unsubscribe().catch(function () {}).then(function () {
            return post('/api/push/unsubscribe', { endpoint: endpoint }, true).catch(function () {});
          });
        });
      }).catch(function () {}));
      if (navigator.serviceWorker.controller) {
        try { navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHES' }); } catch (e) {}
      }
    }
    if ('caches' in window) {
      tasks.push(caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (k) { return caches.delete(k); }));
      }).catch(function () {}));
    }
    session('notify-dismissed', null);
    var all = Promise.all(tasks);
    var timer = new Promise(function (resolve) { setTimeout(resolve, limit); });
    cleaning = Promise.race([all, timer]).then(function () { cleaning = null; });
    return cleaning;
  }

  // The hub's single logout announces on this channel (Risk, Mail, Drive and Detect
  // already listen for it). Clean up whatever else the page does.
  try {
    var slo = new BroadcastChannel('joliro-slo');
    slo.onmessage = function (e) {
      var d = e && e.data;
      if (d === 'signed-out' || (d && (d.type === 'signed-out' || d.event === 'signed-out'))) signOutCleanup();
    };
  } catch (e) { /* no BroadcastChannel */ }

  // ---- UI --------------------------------------------------------------------

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  var chip = null, panel = null, lastFocus = null;

  function closePanel() {
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null;
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  }

  function openPanel(title, build) {
    closePanel();
    lastFocus = document.activeElement;
    panel = el('div', 'jpwa-backdrop');
    var box = el('div', 'jpwa-panel');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    var h = el('h2', 'jpwa-title', title);
    h.id = 'jpwa-title';
    box.setAttribute('aria-labelledby', 'jpwa-title');
    var x = el('button', 'jpwa-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', S.close);
    x.addEventListener('click', closePanel);
    box.appendChild(x);
    box.appendChild(h);
    build(box);
    panel.appendChild(box);
    panel.addEventListener('click', function (e) { if (e.target === panel) closePanel(); });
    panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePanel(); });
    document.body.appendChild(panel);
    var first = box.querySelector('button:not(.jpwa-x), input, a');
    (first || x).focus();
  }

  function button(label, cls, onClick) {
    var b = el('button', 'jpwa-btn ' + (cls || ''), label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function openChooser() {
    if (cfg.variant === 'discreet') return openDiscreetInstall();
    openPanel(S.chooserTitle, function (box) {
      box.appendChild(el('p', 'jpwa-text', S.chooserIntro));
      var form = el('div', 'jpwa-choices');
      form.setAttribute('role', 'radiogroup');
      [['standard', S.standardLabel, t('standardHint')], ['discreet', S.discreetLabel, t('discreetHint')]].forEach(function (c, i) {
        var label = el('label', 'jpwa-choice');
        var input = el('input');
        input.type = 'radio';
        input.name = 'jpwa-variant';
        input.value = c[0];
        if (i === 0) input.checked = true;
        var span = el('span', 'jpwa-choice-text');
        span.appendChild(el('strong', null, c[1]));
        span.appendChild(el('span', 'jpwa-hint', c[2]));
        label.appendChild(input);
        label.appendChild(span);
        form.appendChild(label);
      });
      box.appendChild(form);
      box.appendChild(el('p', 'jpwa-note', S.signInAgain));
      var row = el('div', 'jpwa-row');
      row.appendChild(button(S.cancel, 'jpwa-secondary', closePanel));
      row.appendChild(button(S.continueBtn, 'jpwa-primary', function () {
        var picked = form.querySelector('input:checked');
        install(picked ? picked.value : 'standard');
      }));
      box.appendChild(row);
    });
  }

  function openDiscreetInstall() {
    openPanel(S.chooserTitle, function (box) {
      box.appendChild(el('p', 'jpwa-text', t('discreetIntro')));
      box.appendChild(el('p', 'jpwa-note', S.signInAgain));
      var row = el('div', 'jpwa-row');
      var std = el('a', 'jpwa-link', S.standardInstead);
      std.href = cfg.home;
      row.appendChild(std);
      row.appendChild(button(S.installBtn, 'jpwa-primary', promptInstall));
      box.appendChild(row);
    });
  }

  function openIOSGuide() {
    openPanel(S.iosTitle, function (box) {
      var ol = el('ol', 'jpwa-steps');
      ['iosStep1', 'iosStep2', 'iosStep3', 'iosStep4'].forEach(function (key, i) {
        var li = el('li', 'jpwa-step');
        li.appendChild(el('p', 'jpwa-text', S[key]));
        var img = el('img', 'jpwa-shot');
        img.src = cfg.guideBase + 'step-' + (i + 1) + '.png';
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        li.appendChild(img);
        ol.appendChild(li);
      });
      box.appendChild(ol);
      box.appendChild(el('p', 'jpwa-note', S.iosChrome));
      box.appendChild(el('p', 'jpwa-note', S.signInAgain));
      var row = el('div', 'jpwa-row');
      row.appendChild(button(S.close, 'jpwa-primary', closePanel));
      box.appendChild(row);
    });
  }

  function notifyMessage(result) {
    var key = result.ok ? 'notifyOn'
      : result.reason === 'denied' ? 'notifyDenied'
      : result.reason === 'install-first' ? 'notifyInstallFirst'
      : result.reason === 'signed-out' ? 'notifySignIn'
      : result.reason === 'dismissed' ? null
      : 'notifyFailed';
    if (key) toast(S[key]);
  }

  function toast(text) {
    var n = el('div', 'jpwa-toast', text);
    n.setAttribute('role', 'status');
    document.body.appendChild(n);
    setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 5000);
  }

  function makeChip(label, onClick, dismissKey) {
    var wrap = el('div', 'jpwa-chip');
    var main = button(label, 'jpwa-chip-main', onClick);
    var x = el('button', 'jpwa-chip-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', S.dismiss);
    x.addEventListener('click', function () { session(dismissKey, '1'); render(); });
    wrap.appendChild(main);
    wrap.appendChild(x);
    return wrap;
  }

  function render() {
    if (!cfg.ui || !document.body) return;
    if (chip && chip.parentNode) chip.parentNode.removeChild(chip);
    chip = null;

    // Buttons a page provides itself (e.g. on /pwa/start.html, or in a settings
    // screen): [data-jpwa-install] and [data-jpwa-notify].
    var own = document.querySelectorAll('[data-jpwa-install]');
    for (var i = 0; i < own.length; i++) own[i].hidden = !canInstall();

    if (canInstall() && session('install-dismissed') !== '1' && !own.length) {
      chip = makeChip(S.installChip, openChooser, 'install-dismissed');
    } else if (cfg.push && isStandalone() && pushSupported && Notification.permission === 'default' &&
               session('notify-dismissed') !== '1') {
      chip = makeChip(S.notifyChip, function () {
        enableNotifications().then(function (r) { notifyMessage(r); if (r.ok) session('notify-dismissed', '1'); render(); });
      }, 'notify-dismissed');
    }
    if (chip) document.body.appendChild(chip);
  }

  document.addEventListener('click', function (e) {
    var target = e.target && e.target.closest ? e.target.closest('[data-jpwa-install],[data-jpwa-notify]') : null;
    if (!target) return;
    e.preventDefault();
    if (target.hasAttribute('data-jpwa-install')) openChooser();
    else enableNotifications().then(notifyMessage);
  });

  function start() {
    render();
    if (cfg.push && isStandalone() && pushSupported) loadVapidKey();
    if (cfg.variant === 'discreet' && params && params.get('install') === '1' && canInstall()) openDiscreetInstall();
    // Late-arriving beforeinstallprompt, and display-mode changes after install.
    if (window.matchMedia) {
      var mq = window.matchMedia('(display-mode: standalone)');
      if (mq.addEventListener) mq.addEventListener('change', render);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.joliroPwa = {
    config: cfg,
    isIOS: isIOS,
    isStandalone: isStandalone,
    isDiscreet: function () { return discreetRuntime; },
    canInstall: canInstall,
    openInstall: openChooser,
    install: install,
    enableNotifications: enableNotifications,
    notificationState: notificationState,
    signOutCleanup: signOutCleanup
  };
})();
