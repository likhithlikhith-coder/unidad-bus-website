/* Service worker: caches the app shell so Tally Viewer opens with no network. */
var VERSION = 'tv-v9';
var SHELL = ['./', './index.html', './css/app.css', './css/classic.css', './js/app.js', './js/model.js', './js/db.js', './js/export.js', './js/entry.js', './js/entryui.js', './js/features.js', './js/tools.js', './js/classic.js', './js/tallyparse.js', './js/tallydb.js', './js/parser.worker.js', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './fonts/manrope-latin-400-normal.woff2', './fonts/manrope-latin-500-normal.woff2', './fonts/manrope-latin-600-normal.woff2', './fonts/manrope-latin-700-normal.woff2', './fonts/manrope-latin-800-normal.woff2'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () { /* skip what cannot be fetched */ }); })); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
    var fetched = fetch(e.request).then(function (res) {
      if (res && res.ok && new URL(e.request.url).origin === location.origin) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(e.request, copy); }); }
      return res;
    }).catch(function () { return hit; });
    return hit || fetched;
  }));
});
