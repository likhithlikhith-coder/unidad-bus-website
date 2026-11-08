/* Service worker: caches the app shell, and only the shell, so Tally Viewer opens with no network.
   The cache name follows the app version (js/version.js), so a release replaces the whole shell at
   once instead of refreshing files one by one. Requests outside the shell (the Android app's /cache/
   files, the IFSC lookup, anything with another origin) are never intercepted and never stored.
   The Android app does not register this worker at all; it serves the bundled files itself. */
importScripts('js/version.js');
var VERSION = 'tv-' + (self.TV_VERSION || 'dev');
var BASE = (self.registration && self.registration.scope) || self.location.href;
// the files the app needs to start; install fails (and the old worker stays in charge) if one is missing
var CORE = ['./', './index.html', './css/app.css', './css/classic.css', './js/version.js', './js/model.js', './js/db.js', './js/export.js', './js/tallyparse.js', './js/entry.js', './js/app.js', './js/entryui.js', './js/features.js', './js/tools.js', './js/classic.js', './js/tallydb.js', './js/parser.worker.js', './manifest.webmanifest'];
// nice to have offline; skipped when they cannot be fetched
var EXTRA = ['./icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './fonts/manrope-latin-400-normal.woff2', './fonts/manrope-latin-500-normal.woff2', './fonts/manrope-latin-600-normal.woff2', './fonts/manrope-latin-700-normal.woff2', './fonts/manrope-latin-800-normal.woff2'];
var SHELL = CORE.concat(EXTRA);
var SHELL_SET = {};
SHELL.forEach(function (u) { SHELL_SET[new URL(u, BASE).href] = true; });

// the cache key for a request: shell URL without query or fragment, or null when it is not a shell file
function shellKey(request) {
  var u;
  try { u = new URL(request.url); } catch (e) { return null; }
  u.search = ''; u.hash = '';
  return SHELL_SET[u.href] ? u.href : null;
}

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return c.addAll(CORE).then(function () {
      return Promise.all(EXTRA.map(function (u) { return c.add(u).catch(function () { /* optional asset */ }); }));
    });
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var key = shellKey(e.request);
  if (!key) return; // not ours: the browser fetches it normally and nothing is cached
  e.respondWith(caches.open(VERSION).then(function (c) {
    return c.match(key).then(function (hit) {
      if (hit) return hit;
      return fetch(e.request).then(function (res) {
        if (res && res.ok) c.put(key, res.clone());
        return res;
      });
    });
  }));
});
