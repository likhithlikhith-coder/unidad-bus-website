/* Tally Viewer – the one place the app version lives. Loaded first by index.html, imported by sw.js
   (cache name) and read by model.js (TV_DATA_SCHEMA stamps stored company data). Runs in the page,
   the service worker and Node. */
(function (root) { 'use strict'; root.TV_VERSION = '1.9.1'; root.TV_DATA_SCHEMA = 2; })(typeof self !== 'undefined' ? self : globalThis);
