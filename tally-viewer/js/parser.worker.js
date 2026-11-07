/* Web Worker: decodes and parses one Tally XML file off the main thread. */
importScripts('tallyparse.js');
self.onmessage = function (ev) {
  var msg = ev.data;
  try {
    var dec = TallyParse.decodeBuffer(msg.buffer);
    var total = dec.text.length;
    var result = TallyParse.parseTally(dec.text, function (pos) {
      self.postMessage({ type: 'progress', id: msg.id, pos: pos, total: total });
    });
    result.encoding = dec.encoding;
    result.bytes = msg.buffer.byteLength;
    self.postMessage({ type: 'done', id: msg.id, result: result });
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, error: String(err && err.message || err) });
  }
};
