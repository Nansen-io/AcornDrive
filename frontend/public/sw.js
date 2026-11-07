/* joliro service worker — shared template (joliro PWA kit v1).
 *
 * WHAT THIS CACHES: the app shell only — the offline page, the PWA client, icons,
 * manifests and the app's own static build assets. Nothing a person has typed,
 * uploaded, read or been told is ever written to Cache Storage.
 *
 * WHAT IT NEVER CACHES (network only, the browser's own default):
 *   - every page navigation (HTML can carry account data; it is fetched fresh, and
 *     only when the network is down is the neutral offline page shown instead)
 *   - every /api/ call, every non-GET request, every cross-origin request
 *   - any request carrying an Authorization header
 *   - anything matched by CONFIG.networkOnly (Diary, Detect and Risk data etc.)
 *   - any response marked Cache-Control: no-store or private
 *
 * PUSH: notification text is fixed here and is deliberately generic. Whatever the
 * server puts in the payload, only a same-origin path to open is read from it. The
 * text a person (or someone holding their phone) sees never says what the app is
 * or what happened.
 *
 * SIGN-OUT: the page posts {type: 'CLEAR_CACHES'} (joliro-pwa.js does this) and
 * every cache this worker owns is deleted.
 *
 * Per-app values live in CONFIG. Bump CONFIG.version whenever the precache list or
 * this file changes; old shell caches are deleted when the new worker activates.
 */
'use strict';

var CONFIG = {
  app: 'drive',
  version: '1',
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

// Fixed, generic notification text. Do not read title/body from the push payload.
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

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // One at a time and forgiving: a single missing file must not stop the
      // worker installing (cache.addAll is all-or-nothing).
      return Promise.all(CONFIG.precache.map(function (url) {
        return fetch(url, { cache: 'no-cache', credentials: 'same-origin' })
          .then(function (res) { if (cacheable(res)) return cache.put(url, res); })
          .catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
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
      fetch(req).catch(function () {
        return caches.match(CONFIG.offlineUrl).then(function (r) {
          return r || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        });
      })
    );
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
  if (data.type === 'CLEAR_CACHES') {
    event.waitUntil(
      caches.keys()
        .then(function (keys) { return Promise.all(keys.map(function (k) { return caches.delete(k); })); })
        .then(function () { if (event.ports && event.ports[0]) event.ports[0].postMessage({ ok: true }); })
    );
  } else if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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
    self.registration.showNotification(GENERIC_TITLE, {
      body: GENERIC_BODY,
      icon: CONFIG.notificationIcon,
      badge: CONFIG.notificationBadge,
      tag: 'joliro',
      data: { url: safePath(data && data.url) }
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
          return w.focus().then(function (fw) { return fw && fw.navigate ? fw.navigate(target) : fw; });
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
