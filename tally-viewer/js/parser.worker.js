/* Web Worker: decodes Tally data off the main thread.
 *  { id, buffer }                      → one TallyPrime XML export
 *  { id, folder: { name: buffer } }    → a TallyPrime company data folder (.1800 files)
 */
importScripts('tallyparse.js', 'tallydb.js');
self.onmessage = function (ev) {
  var msg = ev.data;
  try {
    var result;
    if (msg.folder) {
      var total = 0; Object.keys(msg.folder).forEach(function (k) { total += msg.folder[k].byteLength; });
      result = TallyDB.decodeFolder(msg.folder, function (pos, max) { self.postMessage({ type: 'progress', id: msg.id, pos: pos, total: max }); });
      result.bytes = total;
    } else {
      var dec = TallyParse.decodeBuffer(msg.buffer);
      var len = dec.text.length;
      result = TallyParse.parseTally(dec.text, function (pos) { self.postMessage({ type: 'progress', id: msg.id, pos: pos, total: len }); });
      result.encoding = dec.encoding;
      result.bytes = msg.buffer.byteLength;
    }
    self.postMessage({ type: 'done', id: msg.id, result: result });
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, error: String(err && err.message || err) });
  }
};
