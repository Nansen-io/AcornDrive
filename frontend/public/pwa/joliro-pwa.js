/* joliro PWA client — shared across the joliro apps (joliro PWA kit v2).
 *
 * Load on every page, same origin, after the stylesheet:
 *
 *   <link rel="stylesheet" href="/pwa/joliro-pwa.css">
 *   <script src="/pwa/joliro-pwa.js" defer
 *           data-app="risk"                 short app key, also sent with push subscriptions
 *           data-name="joliroRisk"          standard installed name
 *           data-neutral-name="Chat"        default discreet name (the person can change it)
 *           data-hub="https://www.joliro.org"
 *           data-push="on"                  offer notifications inside the installed app
 *           data-lang="fr"                  optional: the page's language, when <html lang>
 *                                           does not carry it
 *           data-variant="discreet"         ONLY on /pwa/start.html
 *   ></script>
 *
 * What it does:
 *   - registers /sw.js (scope /) where it is wanted (see "Service worker" below)
 *   - captures beforeinstallprompt (Android, desktop Chrome/Edge) for an Install button
 *   - detects iPhone/iPad Safari not yet installed (navigator.standalone) and shows
 *     the Add to Home Screen guide instead
 *   - shows a safety warning before any install (and once in an installed app that
 *     was added some other way); see "Safety warning" below
 *   - lets the person choose Standard or Discreet before installing; Discreet goes via
 *     /pwa/start.html, which links its own manifest and icon, under a name the person
 *     chooses (the app's neutral name unless they change it)
 *   - in the installed app only, offers notifications; permission is requested from the
 *     button tap and nowhere else
 *   - window.joliroPwa.signOutCleanup() unsubscribes from push and clears every cache;
 *     it also runs by itself when the joliro single-logout channel announces sign-out
 *
 * LANGUAGE: the text follows the page's language — joliroPwa.setLanguage(), then
 * data-lang, then <html lang> (watched, so an app that switches language in place is
 * followed), then the browser's languages. English is built in; the other joliro
 * languages are /pwa/i18n/<code>.json, fetched only when needed. A page can still set
 * window.JOLIRO_PWA_STRINGS = {...} before this loads to override any string.
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
    // "self" = this origin is the hub (the hub itself, and its preview deployments).
    hub: (attr('data-hub', 'https://www.joliro.org') === 'self' ? location.origin : attr('data-hub', 'https://www.joliro.org')).replace(/\/+$/, ''),
    push: attr('data-push', 'off') === 'on',
    ui: attr('data-ui', 'on') !== 'off',
    variant: attr('data-variant', 'standard'),
    lang: attr('data-lang', ''),
    sw: attr('data-sw', '/sw.js'),
    startPage: attr('data-start', '/pwa/start.html'),
    home: attr('data-home', '/'),
    guideBase: attr('data-guide', '/pwa/ios/'),
    i18nBase: attr('data-i18n', '/pwa/i18n/'),
    detect: attr('data-detect', 'https://detect.joliro.org'),
    swMode: attr('data-sw-mode', 'installed')
  };

  // English. The same keys are in /pwa/i18n/en.json, which the translations follow.
  var EN = {
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
    discreetHint: 'Shows with a plain icon and the name you choose.',
    nameLabel: 'Name on the home screen',
    signInAgain: 'You will need to sign in again inside the installed app.',
    continueBtn: 'Continue',
    installBtn: 'Install',
    saveName: 'Save name',
    discreetIntro: 'This installs a plain-looking copy named "{neutral}".',
    standardInstead: 'Use the standard version instead',
    iosTitle: 'Add to Home Screen',
    iosStep1: 'Tap the ••• button at the bottom right of Safari.',
    iosStep2: 'Tap Share.',
    iosStep3: 'Scroll down and tap Add to Home Screen. You may need to tap View More first.',
    iosStep4: 'Keep Open as Web App switched on, then tap Add.',
    iosChrome: 'Using Chrome? Tap Share in the address bar, then Add to Home Screen.',
    androidTitle: 'Install the app',
    androidChrome: 'In Chrome, tap the ⋮ menu at the top right, then Install app or Add to Home screen.',
    androidSamsung: 'In Samsung Internet, tap the ≡ menu at the bottom right, then Add page to, then Home screen.',
    notifyOn: 'Notifications are on.',
    notifyDenied: 'Notifications are turned off for this app in your phone settings.',
    notifyInstallFirst: 'Add the app to your Home Screen first, then turn notifications on from there.',
    notifySignIn: 'Sign in first, then turn notifications on.',
    notifyFailed: 'Notifications could not be turned on. Try again later.',
    startContinue: 'Continue in the browser',
    offlineTitle: 'You are offline',
    offlineBody: 'Check your connection, then try again.',
    offlineRetry: 'Try again',
    notificationTitle: 'New notification',
    notificationBody: 'Open the app to see it.',
    safetyTitle: 'Safety warning',
    safetyIntro: 'Only keep this app on your home screen if no one else can get into this device. Even with a discreet name, it can show someone that you use this service.',
    safetyDontIf: 'Do not install or keep it if any of these are true:',
    safetyRisk1: 'Someone else knows your passcode or can unlock this device.',
    safetyRisk2: 'Someone else set up this device or can get into its Apple or Google account.',
    safetyRisk3: 'You think this device might be monitored.',
    safetyCheck: 'If you have not yet completed joliroDetect or a Digital Safety Audit with The Digital Safeguard Centre, do that first.',
    safetyDetectLink: 'Open joliroDetect',
    safetyContinue: 'I understand, continue',
    safetyOk: 'I understand',
    safetyRemove: 'If this device is not safe, remove the app from your home screen.'
  };
  var S = {};

  // ---- Environment -----------------------------------------------------------

  var ua = navigator.userAgent || '';
  var isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/.test(ua);
  var isSamsung = /SamsungBrowser/.test(ua);

  // Inside another site's frame (e.g. the Digital Safeguard Centre embedding Risk):
  // no install UI and no service worker. Only the sign-out listener runs.
  var framed = false;
  try { framed = window.self !== window.top; } catch (e) { framed = true; }
  if (framed) cfg.ui = false;
  function isStandalone() {
    return navigator.standalone === true ||
      (window.matchMedia && (window.matchMedia('(display-mode: standalone)').matches ||
                             window.matchMedia('(display-mode: fullscreen)').matches ||
                             window.matchMedia('(display-mode: minimal-ui)').matches));
  }
  var pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  var ownPage = cfg.variant === 'discreet' || cfg.variant === 'offline'; // the kit's own pages

  function session(key, value) {
    try {
      if (value === undefined) return sessionStorage.getItem('joliro-pwa:' + key);
      if (value === null) sessionStorage.removeItem('joliro-pwa:' + key);
      else sessionStorage.setItem('joliro-pwa:' + key, value);
    } catch (e) { return null; }
  }

  var params;
  try { params = new URLSearchParams(location.search); } catch (e) { params = null; }

  // ---- Language --------------------------------------------------------------

  var LANGS = ['en', 'es', 'mi', 'zh', 'ja', 'de', 'fr', 'ru', 'th', 'ar', 'id', 'ht', 'pt', 'hi',
               'vi', 'tl', 'sw', 'bn', 'ne', 'ko', 'my', 'it', 'pl', 'uk', 'ro', 'nl', 'el'];
  var RTL = ['ar'];
  // Codes the apps use that are not the BCP 47 primary subtag (Drive's "ua",
  // Roundcube's "fil", old Java "in").
  var ALIAS = { ua: 'uk', fil: 'tl', 'in': 'id' };
  function normLang(value) {
    if (!value) return '';
    var p = String(value).toLowerCase().replace(/_/g, '-').split('-')[0];
    if (ALIAS[p]) p = ALIAS[p];
    // Drive's zhCN / zhTW / ptBR / nlBE become zhcn, ptbr, nlbe once lowercased.
    if (LANGS.indexOf(p) < 0 && /^(zh|pt|nl)[a-z]{2}$/.test(p)) p = p.slice(0, 2);
    return LANGS.indexOf(p) >= 0 ? p : '';
  }

  var forcedLang = '';
  var savedLang = ''; // the installed app's language, kept by the worker (offline page)
  function pickLang() {
    if (forcedLang) return forcedLang;
    // The kit's own pages (start, offline) have no language of their own: they
    // carry on in the language of the page the person came from — passed in the
    // address to the start page, kept by the worker for the offline page.
    var source = ownPage ? (params && params.get('lang')) || savedLang || ''
                         : cfg.lang || document.documentElement.getAttribute('lang') || '';
    // A page that states a language joliro has no text for gets English.
    if (source) return normLang(source) || 'en';
    var navs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
    for (var i = 0; i < navs.length; i++) { var n = normLang(navs[i]); if (n) return n; }
    return 'en';
  }

  var lang = '';
  var loaded = { en: EN };
  function fetchStrings(code) {
    if (loaded[code]) return Promise.resolve(loaded[code]);
    return fetch(cfg.i18nBase + code + '.json', { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && typeof j === 'object') loaded[code] = j; return loaded[code] || EN; })
      .catch(function () { return EN; });
  }
  function applyStrings(table) {
    S = {};
    for (var k in EN) S[k] = typeof table[k] === 'string' && table[k] ? table[k] : EN[k];
    var custom = window.JOLIRO_PWA_STRINGS;
    if (custom && typeof custom === 'object') for (var c in custom) if (Object.prototype.hasOwnProperty.call(EN, c)) S[c] = String(custom[c]);
  }
  applyStrings(EN);

  // Resolves once the strings for the current language are in place.
  function refreshLang() {
    var next = pickLang();
    if (next === lang) return Promise.resolve(false);
    lang = next;
    return fetchStrings(next).then(function (table) {
      if (next !== lang) return false; // changed again meanwhile
      applyStrings(table);
      tellWorkerLang();
      return true;
    });
  }
  function dir() { return RTL.indexOf(lang) >= 0 ? 'rtl' : 'ltr'; }
  function localise(node) { node.setAttribute('lang', lang); node.setAttribute('dir', dir()); return node; }

  // ---- Discreet name ---------------------------------------------------------
  // The discreet copy is named by the person: the app's neutral name unless they
  // change it. The service worker hands the browser a manifest with that name.

  function cleanName(value) {
    var v = String(value == null ? '' : value)
      .replace(/[\u0000-\u001f\u007f<>"\\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return v.slice(0, 30).trim();
  }
  function chosenName() { return cleanName(session('discreet-name')) || cfg.neutralName; }
  function t(key) { return S[key].replace('{name}', cfg.name).replace('{neutral}', chosenName()); }

  // ---- Discreet runtime ------------------------------------------------------
  // The discreet app launches at /pwa/start.html, which marks this window and then
  // goes to the app. From then on the window title stays neutral, because iOS and
  // Android show it in the app switcher.

  if (cfg.variant === 'discreet' && isStandalone()) {
    var launchedAs = params && cleanName(params.get('n'));
    if (launchedAs) session('discreet-name', launchedAs);
    session('variant', 'discreet');
    location.replace(cfg.home);
    return;
  }
  if (params && params.get('pwa') === 'discreet' && isStandalone()) session('variant', 'discreet');
  var discreetRuntime = session('variant') === 'discreet' && isStandalone();

  function holdNeutralTitle() {
    var title = chosenName();
    if (document.title !== title) document.title = title;
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

  // Registered only where it is wanted. In an ordinary browser tab a service worker
  // and its Cache Storage are a lasting record, on a shared or checked device, that
  // the site was visited. So by default (data-sw-mode="installed") the worker is
  // registered only:
  //   - inside the installed app (standalone),
  //   - when the person taps Install or turns notifications on, or
  //   - when this origin already has one (keeps it updated).
  // data-sw-mode="always" registers on every page load instead.
  var swReady = null;
  var swSupported = 'serviceWorker' in navigator && !framed;
  function ensureSW() {
    if (!swSupported) return Promise.resolve(null);
    if (!swReady) {
      swReady = navigator.serviceWorker.register(cfg.sw, { scope: '/' })
        .then(function () { return navigator.serviceWorker.ready; })
        .catch(function () { return null; });
    }
    return swReady;
  }
  if (swSupported) {
    if (cfg.swMode === 'always' || isStandalone()) {
      ensureSW();
    } else {
      navigator.serviceWorker.getRegistration('/').then(function (reg) { if (reg) ensureSW(); }).catch(function () {});
    }
  }

  // Ask the worker something and wait (briefly) for its answer.
  function tellWorker(message, timeout) {
    if (!swReady) return Promise.resolve(false);
    return swReady.then(function (reg) {
      var target = reg && (reg.active || reg.waiting || reg.installing);
      if (!target || !window.MessageChannel) return false;
      return new Promise(function (resolve) {
        var ch = new MessageChannel();
        var done = false;
        ch.port1.onmessage = function () { if (!done) { done = true; resolve(true); } };
        setTimeout(function () { if (!done) { done = true; resolve(false); } }, timeout || 1500);
        try { target.postMessage(message, [ch.port2]); } catch (e) { done = true; resolve(false); }
      });
    }).catch(function () { return false; });
  }

  // Notification text is fixed and generic, in the language the app was last used
  // in. Only the installed app gets notifications, so only it says which language.
  function tellWorkerLang() {
    if (isStandalone() && swReady) tellWorker({ type: 'SET_LANG', lang: lang });
  }

  function setDiscreetName(name) {
    var clean = cleanName(name) || cfg.neutralName;
    session('discreet-name', clean === cfg.neutralName ? null : clean);
    return ensureSW().then(function () {
      return tellWorker({ type: 'SET_DISCREET_NAME', name: clean === cfg.neutralName ? '' : clean });
    });
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
    if (isStandalone() || framed || cfg.variant === 'offline') return false;
    return !!deferredPrompt || isIOS || isAndroid;
  }

  function promptInstall() {
    ensureSW();
    rememberSafety();
    if (deferredPrompt) {
      var p = deferredPrompt;
      deferredPrompt = null;
      p.prompt();
      return p.userChoice.then(function (r) { closePanel(); render(); return r && r.outcome; })
        .catch(function () { closePanel(); render(); });
    }
    if (isIOS) { openIOSGuide(); return Promise.resolve('guide'); }
    // Android without a captured prompt (Samsung Internet, Firefox, or Chrome before
    // it decides to offer one): the browser menu always has the install item.
    if (isAndroid) { openAndroidGuide(); return Promise.resolve('guide'); }
    return Promise.resolve('unavailable');
  }

  function startPageUrl() {
    return cfg.startPage + '?install=1&lang=' + encodeURIComponent(lang);
  }

  // Standard: install from here. Discreet: go to the start page, whose manifest and
  // icon are the neutral ones, and install from there under the chosen name.
  function install(choice, name) {
    if (choice === 'discreet' && cfg.variant !== 'discreet') {
      return setDiscreetName(name).then(function () {
        location.href = startPageUrl();
        return 'redirect';
      });
    }
    return promptInstall();
  }

  // On the start page: put the chosen name everywhere the browser reads one before
  // installing. iOS reads apple-mobile-web-app-title (and the person can still edit
  // it in the Add to Home Screen sheet); Android reads the manifest, which the
  // worker serves with the chosen name. The address carries it too, because an
  // iPhone's installed app does not share this tab's storage.
  function showNameOnStartPage() {
    if (cfg.variant !== 'discreet') return;
    var name = chosenName();
    document.title = name;
    var meta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (meta) meta.setAttribute('content', name);
    var h = document.querySelector('.jpwa-start h1');
    if (h) h.textContent = name;
    try {
      var q = '?install=1&lang=' + encodeURIComponent(lang) + (name !== cfg.neutralName ? '&n=' + encodeURIComponent(name) : '');
      history.replaceState(null, '', location.pathname + q);
    } catch (e) {}
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
    var permission = Notification.requestPermission();
    ensureSW();
    return Promise.resolve(permission).then(function (perm) {
      if (perm !== 'granted') return { ok: false, reason: perm === 'denied' ? 'denied' : 'dismissed' };
      return Promise.all([ensureSW(), loadVapidKey()]).then(function (r) {
        var reg = r[0], key = r[1];
        if (!reg || !key) return { ok: false, reason: 'unavailable' };
        tellWorkerLang();
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

  // Kept through sign-out: the discreet name, the language and whether the safety
  // warning was accepted, which the installed app needs to keep behaving the same.
  // Nothing personal is ever stored there.
  var KEEP = 'joliro-prefs-';
  var PREFS = KEEP + cfg.app;
  var PREF_SAFETY = '/pwa/prefs/safety-ok';

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
        return Promise.all(keys.map(function (k) { if (k.indexOf(KEEP) !== 0) return caches.delete(k); }));
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

  var chip = null, panel = null, panelView = null, lastFocus = null;

  function closePanel() {
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null;
    panelView = null;
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  }

  function openPanel(view, title, build) {
    var keepFocus = panel ? lastFocus : document.activeElement;
    closePanel();
    lastFocus = keepFocus;
    panelView = view;
    panel = el('div', 'jpwa-backdrop');
    var box = localise(el('div', 'jpwa-panel'));
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

  var fieldSeq = 0;
  function nameField(value) {
    var wrap = el('div', 'jpwa-field');
    var id = 'jpwa-name-' + (++fieldSeq);
    var label = el('label', null, S.nameLabel);
    label.setAttribute('for', id);
    var input = el('input', 'jpwa-input');
    input.id = id;
    input.type = 'text';
    input.value = value;
    input.maxLength = 30;
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'words');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('enterkeyhint', 'done');
    wrap.appendChild(label);
    wrap.appendChild(input);
    return { wrap: wrap, input: input };
  }

  // ---- Safety warning --------------------------------------------------------
  // Every way into installing goes through this first: the chip, a page's own
  // [data-jpwa-install] button, and the start page. It is accepted for the tab
  // (sessionStorage), so it shows again the next time the browser is opened.
  // An app installed some other way (the browser's own menu, or Share > Add to
  // Home Screen on an iPhone without tapping the chip) shows it once, the first
  // time it opens. Accepting it there, or tapping Install, is remembered in the
  // preferences cache, which an iPhone's installed app does not share with Safari,
  // so on an iPhone it also shows once when the installed app first opens.

  var safetyNext = null;
  function safetyAccepted() { return session('safety-ok') === '1'; }

  function rememberSafety() {
    session('safety-ok', '1');
    if (!('caches' in window)) return;
    caches.open(PREFS).then(function (c) { return c.put(PREF_SAFETY, new Response('1')); }).catch(function () {});
  }

  function beforeInstall(next) {
    if (safetyAccepted()) return next();
    safetyNext = next;
    openSafety();
  }

  function openSafety() {
    var installed = isStandalone();
    openPanel('safety', S.safetyTitle, function (box) {
      box.classList.add('jpwa-warning');
      box.appendChild(el('p', 'jpwa-text', S.safetyIntro));
      box.appendChild(el('p', 'jpwa-text', S.safetyDontIf));
      var ul = el('ul', 'jpwa-list');
      ['safetyRisk1', 'safetyRisk2', 'safetyRisk3'].forEach(function (key) { ul.appendChild(el('li', null, S[key])); });
      box.appendChild(ul);
      box.appendChild(el('p', 'jpwa-text', S.safetyCheck));
      if (cfg.app !== 'detect' && cfg.detect) {
        var p = el('p', 'jpwa-text');
        var a = el('a', 'jpwa-link', S.safetyDetectLink);
        a.href = cfg.detect;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        p.appendChild(a);
        box.appendChild(p);
      }
      if (installed) box.appendChild(el('p', 'jpwa-note', S.safetyRemove));
      var row = el('div', 'jpwa-row');
      if (installed) {
        row.appendChild(button(S.safetyOk, 'jpwa-primary', function () { rememberSafety(); closePanel(); }));
      } else {
        row.appendChild(button(S.cancel, 'jpwa-secondary', function () { safetyNext = null; closePanel(); }));
        row.appendChild(button(S.safetyContinue, 'jpwa-primary', function () {
          session('safety-ok', '1');
          var next = safetyNext || openChooser;
          safetyNext = null;
          next();
        }));
      }
      box.appendChild(row);
    });
  }

  // The installed app, opened for the first time without the warning having been
  // accepted on this device (or in this iPhone app's own storage).
  function checkSafetyOnLaunch() {
    if (!cfg.ui || ownPage || !isStandalone() || safetyAccepted()) return;
    var seen = 'caches' in window
      ? caches.open(PREFS).then(function (c) { return c.match(PREF_SAFETY); }).then(function (r) { return !!r; }).catch(function () { return false; })
      : Promise.resolve(false);
    seen.then(function (ok) {
      if (ok) session('safety-ok', '1');
      else if (!panel) openSafety();
    });
  }

  function startInstall() { beforeInstall(openChooser); }

  function openChooser() {
    if (cfg.variant === 'discreet') return openDiscreetInstall();
    openPanel('chooser', S.chooserTitle, function (box) {
      box.appendChild(el('p', 'jpwa-text', S.chooserIntro));
      var form = el('div', 'jpwa-choices');
      form.setAttribute('role', 'radiogroup');
      var field = nameField(chosenName());
      field.wrap.hidden = true;
      [['standard', S.standardLabel, t('standardHint')], ['discreet', S.discreetLabel, S.discreetHint]].forEach(function (c, i) {
        var label = el('label', 'jpwa-choice');
        var input = el('input');
        input.type = 'radio';
        input.name = 'jpwa-variant';
        input.value = c[0];
        if (i === 0) input.checked = true;
        input.addEventListener('change', function () { field.wrap.hidden = form.querySelector('input:checked').value !== 'discreet'; });
        var span = el('span', 'jpwa-choice-text');
        span.appendChild(el('strong', null, c[1]));
        span.appendChild(el('span', 'jpwa-hint', c[2]));
        label.appendChild(input);
        label.appendChild(span);
        form.appendChild(label);
      });
      box.appendChild(form);
      box.appendChild(field.wrap);
      box.appendChild(el('p', 'jpwa-note', S.signInAgain));
      var row = el('div', 'jpwa-row');
      row.appendChild(button(S.cancel, 'jpwa-secondary', closePanel));
      row.appendChild(button(S.continueBtn, 'jpwa-primary', function () {
        var picked = form.querySelector('input:checked');
        install(picked ? picked.value : 'standard', field.input.value);
      }));
      box.appendChild(row);
    });
  }

  function openDiscreetInstall() {
    openPanel('discreet', S.chooserTitle, function (box) {
      var intro = el('p', 'jpwa-text', t('discreetIntro'));
      box.appendChild(intro);
      var current = chosenName();
      var field = nameField(current);
      box.appendChild(field.wrap);
      box.appendChild(el('p', 'jpwa-note', S.signInAgain));
      var row = el('div', 'jpwa-row');
      var std = el('a', 'jpwa-link', S.standardInstead);
      std.href = cfg.home;
      row.appendChild(std);
      // A new name has to reach the browser before it installs. On iOS that is the
      // page's own tag, updated as the person types. Elsewhere the browser has
      // already read the manifest, so the name is saved and the page reloaded, and
      // Install is the next tap.
      var main = button(S.installBtn, 'jpwa-primary', function () {
        var name = cleanName(field.input.value) || cfg.neutralName;
        if (!isIOS && name !== current) {
          setDiscreetName(name).then(function () { location.replace(startPageUrl()); });
          return;
        }
        promptInstall();
      });
      field.input.addEventListener('input', function () {
        var name = cleanName(field.input.value) || cfg.neutralName;
        if (isIOS) {
          session('discreet-name', name === cfg.neutralName ? null : name);
          showNameOnStartPage();
          intro.textContent = t('discreetIntro');
        } else {
          main.textContent = name !== current ? S.saveName : S.installBtn;
        }
      });
      row.appendChild(main);
      box.appendChild(row);
    });
  }

  function openIOSGuide() {
    openPanel('ios', S.iosTitle, function (box) {
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

  function openAndroidGuide() {
    openPanel('android', S.androidTitle, function (box) {
      box.appendChild(el('p', 'jpwa-text', isSamsung ? S.androidSamsung : S.androidChrome));
      box.appendChild(el('p', 'jpwa-note', isSamsung ? S.androidChrome : S.androidSamsung));
      box.appendChild(el('p', 'jpwa-note', S.signInAgain));
      var row = el('div', 'jpwa-row');
      row.appendChild(button(S.close, 'jpwa-primary', closePanel));
      box.appendChild(row);
    });
  }

  var VIEWS = { safety: openSafety, chooser: openChooser, discreet: openDiscreetInstall, ios: openIOSGuide, android: openAndroidGuide };

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
    var n = localise(el('div', 'jpwa-toast', text));
    n.setAttribute('role', 'status');
    document.body.appendChild(n);
    setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 5000);
  }

  function makeChip(label, onClick, dismissKey) {
    var wrap = localise(el('div', 'jpwa-chip'));
    var main = button(label, 'jpwa-chip-main', onClick);
    var x = el('button', 'jpwa-chip-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', S.dismiss);
    x.addEventListener('click', function () { session(dismissKey, '1'); render(); });
    wrap.appendChild(main);
    wrap.appendChild(x);
    return wrap;
  }

  // Text in the kit's own pages: <... data-jpwa-text="key">.
  function translatePage() {
    if (!ownPage) return;
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', dir());
    var nodes = document.querySelectorAll('[data-jpwa-text]');
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute('data-jpwa-text');
      if (Object.prototype.hasOwnProperty.call(S, key)) nodes[i].textContent = S[key];
    }
    if (cfg.variant === 'offline' && !discreetRuntime) document.title = S.offlineTitle;
    showNameOnStartPage();
  }

  var renderId = 0;
  function notifyChip() {
    return makeChip(S.notifyChip, function () {
      enableNotifications().then(function (r) { notifyMessage(r); if (r.ok) session('notify-dismissed', '1'); render(); });
    }, 'notify-dismissed');
  }

  function render() {
    if (!started) return;
    translatePage();
    if (!cfg.ui || !document.body) return;
    var id = ++renderId;
    if (chip && chip.parentNode) chip.parentNode.removeChild(chip);
    chip = null;

    // Buttons a page provides itself (e.g. on /pwa/start.html, or in a settings
    // screen): [data-jpwa-install] and [data-jpwa-notify].
    var own = document.querySelectorAll('[data-jpwa-install]');
    for (var i = 0; i < own.length; i++) own[i].hidden = !canInstall();

    if (canInstall() && session('install-dismissed') !== '1' && !own.length) {
      chip = makeChip(S.installChip, startInstall, 'install-dismissed');
    } else if (cfg.push && isStandalone() && pushSupported && Notification.permission !== 'denied' &&
               session('notify-dismissed') !== '1') {
      if (Notification.permission === 'default') {
        chip = notifyChip();
      } else {
        // Permission granted but this device has no subscription — e.g. a sign-out
        // unsubscribed it. Offer it again rather than leaving push off for good.
        notificationState().then(function (state) {
          if (state === 'off' && id === renderId && !chip && document.body) {
            chip = notifyChip();
            document.body.appendChild(chip);
          }
        });
      }
    }
    if (chip) document.body.appendChild(chip);
  }

  document.addEventListener('click', function (e) {
    var target = e.target && e.target.closest ? e.target.closest('[data-jpwa-install],[data-jpwa-notify]') : null;
    if (!target) return;
    e.preventDefault();
    if (target.hasAttribute('data-jpwa-install')) startInstall();
    else enableNotifications().then(notifyMessage);
  });

  // The page changed language in place: follow it, and redraw whatever is open.
  function onLangChange() {
    refreshLang().then(function (changed) {
      if (!changed) return;
      render();
      if (panelView && VIEWS[panelView]) VIEWS[panelView]();
    });
  }

  var started = false;
  function start() {
    started = true;
    render();
    if (cfg.push && isStandalone() && pushSupported) loadVapidKey();
    if (cfg.variant === 'discreet' && params && params.get('install') === '1' && canInstall()) beforeInstall(openDiscreetInstall);
    checkSafetyOnLaunch();
    // Late-arriving beforeinstallprompt, and display-mode changes after install.
    if (window.matchMedia) {
      var mq = window.matchMedia('(display-mode: standalone)');
      if (mq.addEventListener) mq.addEventListener('change', render);
    }
  }

  // The language is read once the document is parsed, not when this file runs: an
  // app's own deferred script (Risk's, Detect's) sets <html lang> after this one
  // has run. Wait for the strings (at most a moment) so the chip does not flash in
  // English, and follow the page from then on.
  function boot() {
    if (!ownPage) {
      try {
        new MutationObserver(onLangChange).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
      } catch (e) {}
    }
    var saved = cfg.variant === 'offline' && 'caches' in window
      ? caches.open('joliro-prefs-' + cfg.app)
          .then(function (c) { return c.match('/pwa/prefs/lang'); })
          .then(function (r) { return r ? r.text() : ''; })
          .then(function (v) { savedLang = normLang(v); })
          .catch(function () {})
      : Promise.resolve();
    var strings = saved.then(refreshLang);
    Promise.race([strings, new Promise(function (r) { setTimeout(r, 1500); })]).then(start, start);
  }
  // A deferred script runs while readyState is already "interactive" but before
  // DOMContentLoaded (and before later deferred scripts), so wait for the event;
  // "load" covers a copy of this file added after DOMContentLoaded has passed.
  var booted = false;
  function bootOnce() { if (!booted) { booted = true; boot(); } }
  if (document.readyState === 'complete') bootOnce();
  else {
    document.addEventListener('DOMContentLoaded', bootOnce);
    window.addEventListener('load', bootOnce);
  }

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
    signOutCleanup: signOutCleanup,
    language: function () { return lang; },
    setLanguage: function (code) { forcedLang = normLang(code) || (code ? 'en' : ''); onLangChange(); }
  };
})();
