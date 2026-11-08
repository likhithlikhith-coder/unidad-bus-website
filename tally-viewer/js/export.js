/*
 * Dependency-free Excel (.xlsx) and PDF writers for Tally Viewer exports.
 * Everything runs on the phone; nothing is uploaded.
 */
(function (root) {
  'use strict';

  /* ---- small helpers ----------------------------------------------------- */
  var CRC = (function () { var t = new Int32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; } return t; })();
  function crc32(u8) { var c = -1; for (var i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
  var enc = new TextEncoder();
  function utf8(s) { return enc.encode(s); }
  function concat(parts) { var n = 0, i; for (i = 0; i < parts.length; i++) n += parts[i].length; var out = new Uint8Array(n), o = 0; for (i = 0; i < parts.length; i++) { out.set(parts[i], o); o += parts[i].length; } return out; }
  function xmlEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); }
  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }

  /* ---- ZIP (store only) -------------------------------------------------- */
  function zip(files) { // files: [{name, data: Uint8Array}]
    var parts = [], central = [], offset = 0;
    var now = new Date(), dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    files.forEach(function (f) {
      var name = utf8(f.name), data = f.data, crc = crc32(data);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var cdir = concat(central);
    var eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(8, files.length, true); eocd.setUint16(10, files.length, true); eocd.setUint32(12, cdir.length, true); eocd.setUint32(16, offset, true); eocd.setUint16(20, 0, true);
    return concat(parts.concat([cdir, new Uint8Array(eocd.buffer)]));
  }

  /* ---- XLSX --------------------------------------------------------------- */
  // sheets: [{ name, title: [lines], columns: [{title, width, type:'text'|'num'}], rows: [[cell...]], totals: [[cell...]] }]
  // A cell is a string, a number, null, or {v, bold:true}.
  function colRef(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function cellXml(r, c, v, bold, type) {
    var ref = colRef(c) + r;
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'object' && !(v instanceof Date)) { bold = v.bold || bold; v = v.v; if (v === null || v === undefined || v === '') return ''; }
    if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '" s="' + (bold ? 3 : 2) + '"><v>' + (Math.round(v * 100) / 100) + '</v></c>';
    return '<c r="' + ref + '" t="inlineStr"' + (bold ? ' s="1"' : '') + '><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>';
  }
  function sheetXml(sh) {
    var rows = [], r = 1, cols = sh.columns || [];
    (sh.title || []).forEach(function (line, i) { rows.push('<row r="' + r + '">' + cellXml(r, 0, line, i === 0, 'text') + '</row>'); r++; });
    if (sh.title && sh.title.length) r++;
    var headerRow = r;
    rows.push('<row r="' + r + '">' + cols.map(function (c, i) { return cellXml(r, i, c.title, true, 'text'); }).join('') + '</row>'); r++;
    (sh.rows || []).forEach(function (row) { rows.push('<row r="' + r + '">' + row.map(function (v, i) { return cellXml(r, i, v, false, cols[i] && cols[i].type); }).join('') + '</row>'); r++; });
    (sh.totals || []).forEach(function (row) { rows.push('<row r="' + r + '">' + row.map(function (v, i) { return cellXml(r, i, v, true, cols[i] && cols[i].type); }).join('') + '</row>'); r++; });
    var colsXml = cols.length ? '<cols>' + cols.map(function (c, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.width || 14) + '" customWidth="1"/>'; }).join('') + '</cols>' : '';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="' + headerRow + '" topLeftCell="A' + (headerRow + 1) + '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      colsXml + '<sheetData>' + rows.join('') + '</sheetData></worksheet>';
  }
  function xlsx(sheets) {
    var names = sheets.map(function (s, i) { return (s.name || 'Sheet' + (i + 1)).replace(/[\[\]*?:\/\\]/g, ' ').slice(0, 31); });
    var files = [
      { name: '[Content_Types].xml', data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map(function (s, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') + '</Types>') },
      { name: '_rels/.rels', data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
      { name: 'xl/workbook.xml', data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map(function (s, i) { return '<sheet name="' + xmlEsc(names[i]) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets></workbook>') },
      { name: 'xl/_rels/workbook.xml.rels', data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map(function (s, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>') },
      { name: 'xl/styles.xml', data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>') }
    ];
    sheets.forEach(function (s, i) { files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: utf8(sheetXml(s)) }); });
    return new Blob([zip(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /* ---- PDF ---------------------------------------------------------------- */
  // Helvetica glyph widths for 32..126 (per 1000 em), from the standard AFM.
  var HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  var HELVB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
  function winAnsi(s) {
    // Returns a byte string usable in a PDF literal; characters outside WinAnsi become '?'.
    var out = '';
    s = String(s == null ? '' : s).replace(/₹/g, 'Rs ').replace(/[\r\n\t]+/g, ' ');
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i), ch;
      if (c >= 32 && c < 127) ch = s[i];
      else if (c >= 160 && c <= 255) ch = String.fromCharCode(c);
      else if (c === 0x2013 || c === 0x2014) ch = '-';
      else if (c === 0x2018 || c === 0x2019) ch = "'";
      else if (c === 0x201C || c === 0x201D) ch = '"';
      else if (c === 0x2026) ch = '...';
      else if (c > 127) ch = '?';
      else continue;
      out += ch;
    }
    return out;
  }
  function textWidth(s, size, bold) { var t = bold ? HELVB : HELV, w = 0; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); w += (c >= 32 && c < 127) ? t[c - 32] : 556; } return w * size / 1000; }
  function fit(s, maxW, size, bold) { if (textWidth(s, size, bold) <= maxW) return s; while (s.length && textWidth(s + '...', size, bold) > maxW) s = s.slice(0, -1); return s + '...'; }
  function pdfStr(s) { return '(' + s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') + ')'; }
  function latin1Bytes(s) { var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff; return u; }

  // Low-level page builder. Coordinates in points from the bottom-left; y grows upward.
  function PdfDoc(opts) {
    opts = opts || {};
    this.landscape = !!opts.landscape; this.W = this.landscape ? 842 : 595; this.H = this.landscape ? 595 : 842; this.M = opts.margin || 28;
    this.pages = []; this.cur = null; this.y = 0; this.footer = opts.footer || '';
  }
  PdfDoc.prototype.newPage = function () { this.cur = []; this.pages.push(this.cur); this.y = this.H - this.M; return this; };
  PdfDoc.prototype.text = function (x, y, s, size, bold, align, maxW) {
    var t = winAnsi(s); size = size || 9;
    if (maxW) t = fit(t, maxW, size, bold);
    var w = textWidth(t, size, bold);
    if (align === 'r') x -= w; else if (align === 'c') x -= w / 2;
    this.cur.push('BT /F' + (bold ? 2 : 1) + ' ' + size + ' Tf ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' Td ' + pdfStr(t) + ' Tj ET');
    return w;
  };
  PdfDoc.prototype.line = function (x1, y1, x2, y2, w, gray) { this.cur.push((w || 0.5) + ' w ' + (gray == null ? 0.6 : gray) + ' G ' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' m ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' l S 0 G'); };
  PdfDoc.prototype.rect = function (x, y, w, h, fillGray, strokeGray) {
    if (fillGray != null) this.cur.push(fillGray + ' g ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' ' + w.toFixed(2) + ' ' + h.toFixed(2) + ' re f 0 g');
    if (strokeGray != null) this.cur.push('0.5 w ' + strokeGray + ' G ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' ' + w.toFixed(2) + ' ' + h.toFixed(2) + ' re S 0 G');
  };
  // Wrapped paragraph; returns the height used.
  PdfDoc.prototype.para = function (x, y, s, size, bold, maxW, lh) {
    size = size || 9; lh = lh || size * 1.3;
    var wordsArr = winAnsi(s).split(' '), line = '', lines = [];
    wordsArr.forEach(function (w) { var t = line ? line + ' ' + w : w; if (textWidth(t, size, bold) > maxW && line) { lines.push(line); line = w; } else line = t; });
    if (line) lines.push(line);
    for (var i = 0; i < lines.length; i++) this.text(x, y - i * lh, lines[i], size, bold);
    return lines.length * lh;
  };
  // Table with header, pagination and optional totals. Columns: [{title, width, align}]. onNewPage(doc) draws page furniture before the header.
  PdfDoc.prototype.table = function (cols, rows, totals, opt) {
    opt = opt || {};
    var self = this, fs = opt.fontSize || 8.5, lh = fs * 1.45, W = this.W, M = this.M, sumW = 0;
    cols.forEach(function (c) { sumW += c.width; });
    var scale = (opt.fitWidth === false) ? 1 : (W - 2 * M) / sumW, widths = cols.map(function (c) { return c.width * scale; });
    function header() {
      var x = M; self.y -= lh;
      self.rect(M, self.y - 3, W - 2 * M, lh + 1, 0.92, null);
      cols.forEach(function (c, i) { cell(c.title, x, self.y, widths[i], c.align, true); x += widths[i]; });
      self.line(M, self.y - 3.5, W - M, self.y - 3.5, 0.5, 0.6);
    }
    function cell(text, x, yy, w, align, bold) {
      var t = fit(winAnsi(text == null ? '' : String(text)), w - 6, fs, bold);
      var tx = align === 'r' ? x + w - 3 - textWidth(t, fs, bold) : align === 'c' ? x + (w - textWidth(t, fs, bold)) / 2 : x + 3;
      self.cur.push('BT /F' + (bold ? 2 : 1) + ' ' + fs + ' Tf ' + tx.toFixed(2) + ' ' + yy.toFixed(2) + ' Td ' + pdfStr(t) + ' Tj ET');
    }
    function row(cells, bold, shade) {
      if (self.y - lh < M + 18) { self.newPage(); if (opt.onNewPage) opt.onNewPage(self); header(); }
      self.y -= lh; var x = M;
      if (shade) self.rect(M, self.y - 3, W - 2 * M, lh + 1, 0.95, null);
      cells.forEach(function (v, i) { if (i < cols.length) { cell(v, x, self.y, widths[i], cols[i].align, bold); x += widths[i]; } });
      self.line(M, self.y - 3.5, W - M, self.y - 3.5, 0.25, 0.85);
    }
    header();
    (rows || []).forEach(function (r) { row(r, false, false); });
    (totals || []).forEach(function (r) { row(r, true, true); });
    return this;
  };
  PdfDoc.prototype.finish = function () {
    var self = this, M = this.M, W = this.W;
    this.pages.forEach(function (p, i) {
      self.cur = p;
      if (self.footer) self.text(M, M - 10, self.footer, 7.5, false);
      self.text(W - M, M - 10, 'Page ' + (i + 1) + ' of ' + self.pages.length, 7.5, false, 'r');
    });
    var objs = [], offsets = [];
    objs.push('<< /Type /Catalog /Pages 2 0 R >>');
    objs.push('<< /Type /Pages /Kids [' + this.pages.map(function (p, i) { return (5 + i * 2) + ' 0 R'; }).join(' ') + '] /Count ' + this.pages.length + ' >>');
    objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    this.pages.forEach(function (p, i) {
      var content = p.join('\n');
      objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + self.W + ' ' + self.H + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + (6 + i * 2) + ' 0 R >>');
      objs.push('<< /Length ' + latin1Bytes(content).length + ' >>\nstream\n' + content + '\nendstream');
    });
    var out = '%PDF-1.4\n%âãÏÓ\n';
    objs.forEach(function (o, i) { offsets.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    var xref = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    offsets.forEach(function (o) { out += pad(o, 10) + ' 00000 n \n'; });
    out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    return new Blob([latin1Bytes(out)], { type: 'application/pdf' });
  };

  // doc: { title, subtitle, meta: [lines], columns: [{title, width, align}], rows: [[text...]], totals: [[text...]], landscape }
  function pdf(doc) {
    var d = new PdfDoc({ landscape: doc.landscape, footer: 'Generated ' + new Date().toLocaleString() + '  -  Tally Viewer' });
    d.newPage(); var M = d.M;
    d.text(M, d.y - 13, doc.title, 13, true); d.y -= 18;
    if (doc.subtitle) { d.text(M, d.y - 9, doc.subtitle, 9.5); d.y -= 13; }
    (doc.meta || []).forEach(function (m) { d.text(M, d.y - 8, m, 8.5); d.y -= 11; });
    d.y -= 6;
    d.table(doc.columns, doc.rows, doc.totals, { fontSize: doc.fontSize, onNewPage: function (dd) { dd.text(M, dd.y - 8, doc.title + (doc.subtitle ? ' - ' + doc.subtitle : ''), 8); dd.y -= 14; } });
    return d.finish();
  }

  /* ---- saving ------------------------------------------------------------- */
  function safeName(name) { return String(name).replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120); }
  function save(name, blob) {
    name = safeName(name);
    if (root.TallyBridge && typeof root.TallyBridge.saveFile === 'function') {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () {
          var b64 = String(fr.result).split(',')[1] || '';
          root.__tvSavePending = root.__tvSavePending || {};
          root.__tvSavePending[name] = { resolve: resolve, reject: reject };
          root.TallyBridge.saveFile(name, blob.type, b64);
        };
        fr.onerror = function () { reject(new Error('Could not read export')); };
        fr.readAsDataURL(blob);
      });
    }
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 4000);
    return Promise.resolve({ name: name, where: 'download' });
  }
  root.TallyBridgeSaved = function (name, ok, where) {
    var p = root.__tvSavePending && root.__tvSavePending[name];
    if (!p) return;
    delete root.__tvSavePending[name];
    if (ok) p.resolve({ name: name, where: where }); else p.reject(new Error(where || 'Could not save'));
  };

  root.TVExport = { xlsx: xlsx, pdf: pdf, PdfDoc: PdfDoc, save: save, safeName: safeName, zip: zip };
})(typeof self !== 'undefined' ? self : globalThis);
