/* joliro service worker — shared template (joliro PWA kit v2).
 *
 * WHAT THIS CACHES: the app shell only — the offline page, the PWA client and its
 * translations, icons, manifests and the app's own static build assets. Nothing a
 * person has typed, uploaded, read or been told is ever written to Cache Storage.
 *
 * WHAT IT NEVER CACHES (network only, the browser's own default):
 *   - every page navigation (HTML can carry account data; it is fetched fresh, and
 *     only when the network is down is the neutral offline page shown instead)
 *   - every /api/ call, every non-GET request, every cross-origin request
 *   - any request carrying an Authorization header
 *   - anything matched by CONFIG.networkOnly (Diary, Detect and Risk data etc.)
 *   - any response marked Cache-Control: no-store or private
 *
 * PREFERENCES (cache "joliro-prefs-<app>"): the name the person gave the discreet
 * copy, and the language of the installed app (for notification text). Both are
 * set from the page; neither is personal. They survive sign-out so the installed
 * app keeps its name.
 *
 * PUSH: notification text is fixed here and is deliberately generic (translated
 * into the app's language, still generic). Whatever the server puts in the payload,
 * only a same-origin path to open is read from it. The text a person (or someone
 * holding their phone) sees never says what the app is or what happened.
 *
 * SIGN-OUT: the page posts {type: 'CLEAR_CACHES'} (joliro-pwa.js does this) and
 * every cache this worker owns, except the preferences, is deleted.
 *
 * Per-app values live in CONFIG. Bump CONFIG.version whenever the precache list or
 * this file changes; old shell caches are deleted when the new worker activates.
 */
'use strict';

var CONFIG = {
  app: 'drive',
  version: '3',
  offlineUrl: '/pwa/offline.html',
  precache: [
    '/pwa/offline.html',
    '/pwa/joliro-pwa.js',
    '/pwa/joliro-pwa.css',
    '/manifest.webmanifest',
    '/pwa/discreet.webmanifest',
    '/pwa/icons/icon-192.png',
    '/pwa/icons/icon-512.png',
    '/pwa/icons/notify-192.png',
    '/pwa/icons/badge-96.png'
  ],
  // Same-origin GET paths that are part of the shell. Hashed build output is
  // served cache-first; everything else here is stale-while-revalidate.
  // Drive (filebrowser): Vite's hashed build output, served under <baseURL>public/static/assets/
  // (and the legacy <baseURL>static/assets/ alias). Production baseURL is "/".
  immutable: [/^\/public\/static\/assets\//, /^\/static\/assets\//],
  // Drive's own shell: bundled fonts and app icons. No user data lives under these folders.
  shell: [/^\/pwa\//, /^\/manifest\.webmanifest$/, /^\/public\/static\/fonts\//, /^\/public\/static\/img\/icons\//],
  // Always network, even if a shell pattern above would also match.
  // Drive: every file listing, file content, preview, thumbnail, download, subtitle, search,
  // share and OnlyOffice call is under <baseURL>api/ or <baseURL>public/api/ (matched anywhere in
  // the path so a non-root baseURL is covered too); share pages and the files views are HTML
  // navigations, network only anyway, listed so nothing above can ever pick them up.
  networkOnly: [/^\/api\//, /^\/auth\//, /^\/sw\.js$/, /\/api\//, /\/public\/share\//, /^\/share\//,
    /^\/files\//, /\/swagger\//, /\/health$/],
  notificationIcon: '/pwa/icons/notify-192.png',
  notificationBadge: '/pwa/icons/badge-96.png'
};

var PREFIX = 'joliro-shell-' + CONFIG.app + '-';
var CACHE = PREFIX + CONFIG.version;
var PREFS = 'joliro-prefs-' + CONFIG.app;
var KEEP = 'joliro-prefs-';
var DISCREET_MANIFEST = '/pwa/discreet.webmanifest';
var PREF_NAME = '/pwa/prefs/discreet-name';
var PREF_STRINGS = '/pwa/prefs/strings';
var PREF_LANG = '/pwa/prefs/lang';

// Fixed, generic notification text. Do not read title/body from the push payload.
// The installed app's language replaces these (SET_LANG below); still generic.
var GENERIC_TITLE = 'New notification';
var GENERIC_BODY = 'Open the app to see it.';

function matches(list, path) {
  for (var i = 0; i < list.length; i++) if (list[i].test(path)) return true;
  return false;
}

function cacheable(res) {
  if (!res || !res.ok || res.type !== 'basic') return false;
  var cc = (res.headers.get('Cache-Control') || '').toLowerCase();
  return cc.indexOf('no-store') === -1 && cc.indexOf('private') === -1;
}

function put(req, res) {
  if (!cacheable(res)) return;
  var copy = res.clone();
  caches.open(CACHE).then(function (c) { return c.put(req, copy); }).catch(function () {});
}

function precache() {
  return caches.open(CACHE).then(function (cache) {
    // Forgiving: a single missing file must not stop the worker installing
    // (cache.addAll is all-or-nothing).
    return Promise.all(CONFIG.precache.map(function (url) {
      return fetch(url, { cache: 'no-cache', credentials: 'same-origin' })
        .then(function (res) {
          if (cacheable(res)) return cache.put(url, res);
          // Not stored (e.g. served no-store): release the body, or over HTTP/1.1
          // the unread responses hold connections open and install never finishes.
          if (res && res.body && res.body.cancel) return res.body.cancel().catch(function () {});
        })
        .catch(function () {});
    }));
  });
}

// Sign-out deletes every shell cache, the offline page included. Put the shell back
// (it holds nothing personal) the next time a page loads while online.
function restoreShellIfCleared() {
  return caches.match(CONFIG.offlineUrl).then(function (hit) { if (!hit) return precache(); }).catch(function () {});
}

// ---- Preferences ---------------------------------------------------------------

function cleanName(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f<>"\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30)
    .trim();
}

function prefText(key) {
  return caches.open(PREFS)
    .then(function (c) { return c.match(key); })
    .then(function (r) { return r ? r.text() : ''; })
    .catch(function () { return ''; });
}

function setPref(key, text, type) {
  return caches.open(PREFS).then(function (c) {
    if (!text) return c.delete(key);
    return c.put(key, new Response(text, { headers: { 'Content-Type': type || 'text/plain; charset=utf-8' } }));
  });
}

// Stale-while-revalidate from the shell cache.
function shellResponse(req) {
  return caches.match(req, { ignoreSearch: true }).then(function (hit) {
    var network = fetch(req).then(function (res) { put(req, res); return res; });
    if (hit) { network.catch(function () {}); return hit; }
    return network;
  });
}

// The discreet manifest, under the name the person chose. The browser reads the
// name from here when it installs the discreet copy (and when it checks for
// updates later, so the name stays). start_url carries the name to the installed
// app, whose storage is separate from the browser's on iPhone.
function discreetManifest(req) {
  return Promise.all([shellResponse(req), prefText(PREF_NAME)]).then(function (r) {
    var res = r[0], name = cleanName(r[1]);
    if (!name || !res || !res.ok) return res;
    return res.clone().json().then(function (m) {
      m.name = name;
      m.short_name = name;
      m.start_url = '/pwa/start.html?n=' + encodeURIComponent(name);
      return new Response(JSON.stringify(m), {
        headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' }
      });
    }).catch(function () { return res; });
  });
}

function notificationText() {
  return prefText(PREF_STRINGS).then(function (text) {
    var s = {};
    try { s = text ? JSON.parse(text) : {}; } catch (e) { s = {}; }
    return {
      title: typeof s.notificationTitle === 'string' && s.notificationTitle ? s.notificationTitle : GENERIC_TITLE,
      body: typeof s.notificationBody === 'string' && s.notificationBody ? s.notificationBody : GENERIC_BODY
    };
  });
}

// The app's language (the offline page reads it) and the two generic notification
// strings in it.
function setLanguage(lang) {
  if (!/^[a-z]{2,3}$/.test(lang || '')) return Promise.resolve();
  if (lang === 'en') return Promise.all([setPref(PREF_LANG, 'en'), setPref(PREF_STRINGS, '')]);
  setPref(PREF_LANG, lang).catch(function () {});
  return fetch('/pwa/i18n/' + lang + '.json', { credentials: 'omit' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j) return;
      return setPref(PREF_STRINGS, JSON.stringify({
        notificationTitle: String(j.notificationTitle || ''),
        notificationBody: String(j.notificationBody || '')
      }), 'application/json');
    })
    .catch(function () {});
}

// ---- Lifecycle -----------------------------------------------------------------

self.addEventListener('install', function (event) {
  event.waitUntil(precache().then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k.indexOf(PREFIX) === 0 && k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  if (req.headers.has('Authorization')) return;
  if (matches(CONFIG.networkOnly, url.pathname)) return;

  // Pages: network only. The offline page is the one thing served from cache,
  // and only when the network has failed.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        event.waitUntil(restoreShellIfCleared());
        return res;
      }).catch(function () {
        return caches.match(CONFIG.offlineUrl).then(function (r) {
          return r || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        });
      })
    );
    return;
  }

  if (url.pathname === DISCREET_MANIFEST) {
    event.respondWith(discreetManifest(req));
    return;
  }

  if (matches(CONFIG.immutable, url.pathname)) {
    event.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) { put(req, res); return res; });
      })
    );
    return;
  }

  if (matches(CONFIG.shell, url.pathname)) {
    event.respondWith(
      caches.match(req).then(function (hit) {
        var network = fetch(req).then(function (res) { put(req, res); return res; });
        if (hit) { network.catch(function () {}); return hit; }
        return network;
      })
    );
  }
  // Anything else: not handled, so the browser goes to the network as normal.
});

self.addEventListener('message', function (event) {
  var data = event.data || {};
  var port = event.ports && event.ports[0];
  function reply() { if (port) port.postMessage({ ok: true }); }
  var work = null;
  if (data.type === 'CLEAR_CACHES') {
    work = caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { if (k.indexOf(KEEP) !== 0) return caches.delete(k); }));
    });
  } else if (data.type === 'SET_DISCREET_NAME') {
    work = setPref(PREF_NAME, cleanName(data.name));
  } else if (data.type === 'SET_LANG') {
    work = setLanguage(String(data.lang || ''));
  } else if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (work) event.waitUntil(work.catch(function () {}).then(reply));
});

// ---- Push --------------------------------------------------------------------

function safePath(value) {
  if (typeof value !== 'string' || value.charAt(0) !== '/' || value.charAt(1) === '/') return '/';
  try {
    var u = new URL(value, self.location.origin);
    return u.origin === self.location.origin ? u.pathname + u.search + u.hash : '/';
  } catch (e) { return '/'; }
}

self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  // Every push must show a notification (userVisibleOnly; Safari revokes the
  // subscription otherwise), and the text is always the generic text.
  event.waitUntil(
    notificationText().catch(function () { return { title: GENERIC_TITLE, body: GENERIC_BODY }; }).then(function (text) {
      return self.registration.showNotification(text.title, {
        body: text.body,
        icon: CONFIG.notificationIcon,
        badge: CONFIG.notificationBadge,
        tag: 'joliro',
        data: { url: safePath(data && data.url) }
      });
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = new URL(safePath(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (wins) {
      for (var i = 0; i < wins.length; i++) {
        var w = wins[i];
        if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
          return w.focus().then(function (fw) {
            return fw && fw.navigate ? fw.navigate(target).catch(function () {}) : fw;
          }).catch(function () {});
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
    })
  );
});

// The push service rotated the subscription: subscribe again and tell the hub.
// Best effort — if it fails, the person can turn notifications on again.
self.addEventListener('pushsubscriptionchange', function (event) {
  var HUB = 'https://www.joliro.org';
  var old = event.oldSubscription;
  var key = old && old.options && old.options.applicationServerKey;
  if (!key) return;
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
      .then(function (sub) {
        var json = { 'Content-Type': 'application/json' };
        return Promise.all([
          fetch(HUB + '/api/push/subscribe', {
            method: 'POST', credentials: 'include', headers: json,
            body: JSON.stringify({ app: CONFIG.app, subscription: sub.toJSON() })
          }),
          old.endpoint ? fetch(HUB + '/api/push/unsubscribe', {
            method: 'POST', credentials: 'include', headers: json,
            body: JSON.stringify({ endpoint: old.endpoint })
          }) : null
        ]);
      })
      .catch(function () {})
  );
});
