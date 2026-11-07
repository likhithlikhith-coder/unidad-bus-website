/* Tiny IndexedDB wrapper. Two stores: companies (metadata) and data (books). */
(function (root) {
  'use strict';
  var DB_NAME = 'tally-viewer', DB_VERSION = 1, dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('companies')) db.createObjectStore('companies', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('data')) db.createObjectStore('data', { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbp;
  }
  function tx(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode), s = t.objectStore(store), out;
        t.oncomplete = function () { resolve(out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
        var r = fn(s);
        if (r) r.onsuccess = function () { out = r.result; };
      });
    });
  }
  root.TVDB = {
    listCompanies: function () { return tx('companies', 'readonly', function (s) { return s.getAll(); }); },
    getCompany: function (id) { return tx('companies', 'readonly', function (s) { return s.get(id); }); },
    putCompany: function (c) { return tx('companies', 'readwrite', function (s) { return s.put(c); }); },
    deleteCompany: function (id) {
      return tx('companies', 'readwrite', function (s) { return s.delete(id); })
        .then(function () { return tx('data', 'readwrite', function (s) { return s.delete(id); }); });
    },
    getData: function (id) { return tx('data', 'readonly', function (s) { return s.get(id); }); },
    putData: function (d) { return tx('data', 'readwrite', function (s) { return s.put(d); }); },
    estimate: function () { return (navigator.storage && navigator.storage.estimate) ? navigator.storage.estimate() : Promise.resolve(null); },
    persist: function () { return (navigator.storage && navigator.storage.persist) ? navigator.storage.persist() : Promise.resolve(false); }
  };
})(typeof self !== 'undefined' ? self : globalThis);
