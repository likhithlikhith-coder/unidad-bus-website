/*
 * TallyPrime XML parser.
 *
 * Works in a Web Worker, in the page, and in Node (for tests). It does not use
 * DOMParser because that is unavailable in workers and chokes on the control
 * characters Tally likes to emit. Instead it is a small streaming tokenizer that
 * builds a tree for each object inside <TALLYMESSAGE> (ledger, group, voucher…),
 * hands it to the extractor and throws it away, so memory stays flat even for
 * a 100 MB Day Book export.
 */
(function (root) {
  'use strict';

  var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

  function decodeEntities(s) {
    if (s.indexOf('&') === -1) return s;
    return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, function (m, e) {
      if (e.charCodeAt(0) === 35) {
        var code = (e[1] === 'x' || e[1] === 'X') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        if (isNaN(code) || (code < 32 && code !== 9 && code !== 10 && code !== 13)) return '';
        try { return String.fromCodePoint(code); } catch (err) { return ''; }
      }
      return ENT[e];
    });
  }

  /* ---- Encoding detection ------------------------------------------------ */

  function decodeBuffer(buf) {
    var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    var enc = null, offset = 0;
    if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) { enc = 'utf-16le'; offset = 2; }
    else if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) { enc = 'utf-16be'; offset = 2; }
    else if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) { enc = 'utf-8'; offset = 3; }
    else {
      var head = u8.subarray(0, Math.min(512, u8.length));
      var nulEven = 0, nulOdd = 0, i;
      for (i = 0; i < head.length; i++) if (head[i] === 0) { if (i % 2) nulOdd++; else nulEven++; }
      if (nulOdd > head.length / 8) enc = 'utf-16le';
      else if (nulEven > head.length / 8) enc = 'utf-16be';
      else {
        var ascii = '';
        for (i = 0; i < Math.min(200, head.length); i++) ascii += String.fromCharCode(head[i]);
        var m = /encoding\s*=\s*["']([^"']+)["']/i.exec(ascii);
        if (m) {
          var d = m[1].toLowerCase();
          if (d === 'utf-8' || d === 'utf8') enc = 'utf-8';
          else if (d === 'utf-16' || d === 'utf-16le' || d === 'unicode') enc = 'utf-16le';
          else if (d === 'utf-16be') enc = 'utf-16be';
          else if (d === 'windows-1252' || d === 'iso-8859-1' || d === 'latin1' || d === 'us-ascii' || d === 'ascii') enc = 'windows-1252';
        }
      }
    }
    var text;
    var TD = root.TextDecoder || (typeof require === 'function' ? require('util').TextDecoder : null);
    var bytes = offset ? u8.subarray(offset) : u8;
    if (enc) {
      text = new TD(enc).decode(bytes);
    } else {
      try { text = new TD('utf-8', { fatal: true }).decode(bytes); enc = 'utf-8'; }
      catch (e) { text = new TD('windows-1252').decode(bytes); enc = 'windows-1252'; }
    }
    // Tally emits raw control characters (e.g. \u0004 separators). Strip them.
    text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    return { text: text, encoding: enc };
  }

  /* ---- Tokenizer ---------------------------------------------------------- */

  var CONTAINERS = { TALLYMESSAGE: 1, COLLECTION: 1 };
  var ATTR_RE = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

  function parseAttrs(s) {
    var attrs = null, m;
    ATTR_RE.lastIndex = 0;
    while ((m = ATTR_RE.exec(s))) {
      if (!attrs) attrs = {};
      attrs[m[1].toUpperCase()] = decodeEntities(m[2] !== undefined ? m[2] : m[3]);
    }
    return attrs;
  }

  /**
   * parseXML(text, emit, progress)
   * emit(node) is called for every element whose parent is TALLYMESSAGE or
   * COLLECTION, plus REQUESTDESC (for the company name).
   * node = { t: tag, a: attrs|null, c: [children], x: text }
   */
  function parseXML(text, emit, progress) {
    var i = 0, n = text.length, stack = [], emitted = 0, top = null;
    var lastProgress = 0;

    function finish(node) {
      node.x = decodeEntities(node.x).trim();
      var parent = stack.length ? stack[stack.length - 1] : null;
      if (!parent || CONTAINERS[parent.t] || node.t === 'REQUESTDESC') {
        if (node.t !== 'ENVELOPE' && node.t !== 'BODY' && node.t !== 'IMPORTDATA' && node.t !== 'REQUESTDATA' && node.t !== 'DATA' && node.t !== 'HEADER') {
          emit(node);
          emitted++;
          if (progress && (emitted & 1023) === 0 && i - lastProgress > 1000000) { lastProgress = i; progress(i, n); }
        }
      } else {
        parent.c.push(node);
      }
    }

    while (i < n) {
      var lt = text.indexOf('<', i);
      if (lt === -1) break;
      if (lt > i && stack.length) {
        top = stack[stack.length - 1];
        top.x += text.slice(i, lt);
      }
      var c1 = text.charCodeAt(lt + 1);
      if (c1 === 47) { // </...>
        var gt1 = text.indexOf('>', lt);
        if (gt1 === -1) break;
        i = gt1 + 1;
        if (stack.length) finish(stack.pop());
      } else if (c1 === 63) { // <?...?>
        var pe = text.indexOf('?>', lt);
        i = pe === -1 ? n : pe + 2;
      } else if (c1 === 33) { // <!...
        if (text.startsWith('<![CDATA[', lt)) {
          var ce = text.indexOf(']]>', lt);
          if (ce === -1) ce = n;
          if (stack.length) stack[stack.length - 1].x += text.slice(lt + 9, ce).replace(/&/g, '&amp;');
          i = ce + 3;
        } else if (text.startsWith('<!--', lt)) {
          var me = text.indexOf('-->', lt);
          i = me === -1 ? n : me + 3;
        } else {
          var de = text.indexOf('>', lt);
          i = de === -1 ? n : de + 1;
        }
      } else {
        var gt = text.indexOf('>', lt);
        if (gt === -1) break;
        var selfClose = text.charCodeAt(gt - 1) === 47;
        var inner = text.slice(lt + 1, selfClose ? gt - 1 : gt);
        var sp = inner.search(/\s/);
        var tag, attrs = null;
        if (sp === -1) tag = inner; else { tag = inner.slice(0, sp); attrs = parseAttrs(inner.slice(sp)); }
        var node = { t: tag.toUpperCase(), a: attrs, c: [], x: '' };
        if (selfClose) finish(node); else stack.push(node);
        i = gt + 1;
      }
    }
    while (stack.length) finish(stack.pop());
    if (progress) progress(n, n);
    return emitted;
  }

  /* ---- Tree helpers ------------------------------------------------------- */

  function child(node, tag) {
    var c = node.c;
    for (var k = 0; k < c.length; k++) if (c[k].t === tag) return c[k];
    return null;
  }
  function children(node, tag) {
    var out = [], c = node.c;
    for (var k = 0; k < c.length; k++) if (c[k].t === tag) out.push(c[k]);
    return out;
  }
  function text(node, tag) { var ch = child(node, tag); return ch ? ch.x : ''; }
  function attr(node, name) { return node.a && node.a[name] !== undefined ? node.a[name] : ''; }
  function yn(s) { if (!s) return null; s = s.trim().toLowerCase(); return s === 'yes' ? true : s === 'no' ? false : null; }

  function masterName(node) {
    var n = attr(node, 'NAME') || text(node, 'NAME');
    if (!n) {
      var ln = child(node, 'LANGUAGENAME.LIST');
      if (ln) { var nl = child(ln, 'NAME.LIST'); if (nl) n = text(nl, 'NAME'); }
    }
    return n.trim();
  }
  function aliases(node) {
    var out = [], ln = child(node, 'LANGUAGENAME.LIST');
    if (!ln) return out;
    var nl = child(ln, 'NAME.LIST');
    if (!nl) return out;
    var names = children(nl, 'NAME');
    for (var i = 1; i < names.length; i++) if (names[i].x) out.push(names[i].x);
    return out;
  }

  /* ---- Value parsing ------------------------------------------------------ */

  // "-1,000.00", "$ 100.00 @ 80.00/$ = -8000.00", "1000" → number (signed)
  function num(s) {
    if (s === undefined || s === null) return 0;
    s = String(s);
    var eq = s.lastIndexOf('=');
    if (eq !== -1) s = s.slice(eq + 1);
    var neg = /\(-\)|^\s*-/.test(s) || /-\s*$/.test(s);
    var m = s.replace(/[^0-9.]/g, '');
    if (!m) return 0;
    var v = parseFloat(m);
    if (isNaN(v)) return 0;
    return neg ? -v : v;
  }
  // "10 Nos", "-2.500 Kg", "10 Nos = 20 Pcs" → {qty, unit}
  function qty(s) {
    if (!s) return { qty: 0, unit: '' };
    s = String(s);
    var eq = s.indexOf('=');
    if (eq !== -1) s = s.slice(0, eq);
    var m = /^\s*(\(-\)|-)?\s*([\d,]*\.?\d+)\s*(.*?)\s*$/.exec(s);
    if (!m) return { qty: 0, unit: s.trim() };
    var v = parseFloat(m[2].replace(/,/g, ''));
    if (m[1]) v = -v;
    return { qty: v, unit: m[3] };
  }
  // "100.00/Nos" → 100
  function rate(s) {
    if (!s) return 0;
    var sl = String(s).indexOf('/');
    return num(sl === -1 ? s : String(s).slice(0, sl));
  }
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  // "20240401" or "1-Apr-2024" or "2024-04-01" → 20240401
  function dateNum(s) {
    if (!s) return 0;
    s = String(s).trim();
    if (/^\d{8}$/.test(s)) return parseInt(s, 10);
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return parseInt(m[1], 10) * 10000 + parseInt(m[2], 10) * 100 + parseInt(m[3], 10);
    m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec(s);
    if (m) {
      var y = parseInt(m[3], 10); if (y < 100) y += 2000;
      var mo = MONTHS[m[2].toLowerCase()] || 0;
      return y * 10000 + mo * 100 + parseInt(m[1], 10);
    }
    var d = new Date(s);
    if (!isNaN(d.getTime())) return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    return 0;
  }

  /* ---- Tally object extraction ------------------------------------------- */

  function newResult() {
    return { company: '', companies: [], groups: [], ledgers: [], stockItems: [], stockGroups: [], units: [], voucherTypes: [], vouchers: [], others: {}, warnings: [] };
  }

  function parseEntry(e) {
    var entry = { ledger: text(e, 'LEDGERNAME').trim(), amount: num(text(e, 'AMOUNT')) };
    var bills = children(e, 'BILLALLOCATIONS.LIST');
    if (bills.length) {
      entry.bills = bills.map(function (b) {
        return { name: text(b, 'NAME'), type: text(b, 'BILLTYPE'), amount: num(text(b, 'AMOUNT')) };
      });
    }
    var cc = children(e, 'CATEGORYALLOCATIONS.LIST');
    if (cc.length) {
      entry.costCentres = [];
      cc.forEach(function (c) {
        children(c, 'COSTCENTREALLOCATIONS.LIST').forEach(function (x) {
          entry.costCentres.push({ name: text(x, 'NAME'), amount: num(text(x, 'AMOUNT')) });
        });
      });
    }
    return entry;
  }

  function parseItem(it, dir) {
    var q = qty(text(it, 'ACTUALQTY') || text(it, 'BILLEDQTY'));
    var bq = qty(text(it, 'BILLEDQTY'));
    var item = {
      item: text(it, 'STOCKITEMNAME').trim(),
      qty: q.qty, unit: q.unit, billedQty: bq.qty || q.qty,
      rate: rate(text(it, 'RATE')),
      amount: num(text(it, 'AMOUNT')),
      discount: num(text(it, 'DISCOUNT')),
      godown: '', tracking: text(it, 'TRACKINGNUMBER').trim(), dir: dir || ''
    };
    var ba = child(it, 'BATCHALLOCATIONS.LIST');
    if (ba) item.godown = text(ba, 'GODOWNNAME');
    var allocs = children(it, 'ACCOUNTINGALLOCATIONS.LIST');
    if (allocs.length) item.allocs = allocs.map(function (a) { return { ledger: text(a, 'LEDGERNAME').trim(), amount: num(text(a, 'AMOUNT')) }; });
    return item;
  }

  function extractVoucher(node) {
    var v = {
      id: text(node, 'GUID') || attr(node, 'REMOTEID') || '',
      date: dateNum(text(node, 'DATE')),
      type: text(node, 'VOUCHERTYPENAME') || attr(node, 'VCHTYPE'),
      number: text(node, 'VOUCHERNUMBER'),
      ref: text(node, 'REFERENCE'),
      narration: text(node, 'NARRATION'),
      party: text(node, 'PARTYLEDGERNAME') || text(node, 'PARTYNAME'),
      cancelled: yn(text(node, 'ISCANCELLED')) === true,
      optional: yn(text(node, 'ISOPTIONAL')) === true,
      postDated: yn(text(node, 'ISPOSTDATED')) === true,
      action: attr(node, 'ACTION') || 'Create',
      entries: [], items: []
    };
    var all = children(node, 'ALLLEDGERENTRIES.LIST');
    var plain = all.length ? [] : children(node, 'LEDGERENTRIES.LIST');
    var src = all.length ? all : plain;
    src.forEach(function (e) {
      v.entries.push(parseEntry(e));
      children(e, 'INVENTORYALLOCATIONS.LIST').forEach(function (it) { v.items.push(parseItem(it)); });
    });
    var invs = children(node, 'ALLINVENTORYENTRIES.LIST');
    if (!invs.length) invs = children(node, 'INVENTORYENTRIES.LIST');
    invs.forEach(function (it) { v.items.push(parseItem(it)); });
    children(node, 'INVENTORYENTRIESIN.LIST').forEach(function (it) { v.items.push(parseItem(it, 'in')); });
    children(node, 'INVENTORYENTRIESOUT.LIST').forEach(function (it) { v.items.push(parseItem(it, 'out')); });

    // Invoice-mode vouchers keep the sales/purchase ledger inside the item's
    // accounting allocations. Only add those when the voucher does not balance
    // without them, so accounting-mode vouchers are not double counted.
    var sum = 0, k;
    for (k = 0; k < v.entries.length; k++) sum += v.entries[k].amount;
    if (Math.abs(sum) > 0.005) {
      var allocSum = 0, allocEntries = [];
      v.items.forEach(function (it) {
        (it.allocs || []).forEach(function (a) { allocSum += a.amount; allocEntries.push({ ledger: a.ledger, amount: a.amount, fromItem: true }); });
      });
      if (allocEntries.length && Math.abs(sum + allocSum) <= 0.01) {
        v.entries = v.entries.concat(allocEntries);
        sum = 0;
      }
    }
    if (Math.abs(sum) > 0.01) v.unbalanced = Math.round(sum * 100) / 100;
    return v;
  }

  function extract(node, out) {
    switch (node.t) {
      case 'REQUESTDESC': {
        var sv = child(node, 'STATICVARIABLES');
        if (sv) { var c = text(sv, 'SVCURRENTCOMPANY'); if (c && !out.company) out.company = c.trim(); }
        break;
      }
      case 'COMPANY': {
        var cn = masterName(node);
        if (cn && !out.company) out.company = cn;
        if (cn) out.companies.push({ name: cn, startingFrom: dateNum(text(node, 'STARTINGFROM')), booksFrom: dateNum(text(node, 'BOOKSFROM')) });
        break;
      }
      case 'GROUP':
        out.groups.push({
          name: masterName(node), parent: text(node, 'PARENT').trim(),
          reserved: attr(node, 'RESERVEDNAME'),
          revenue: yn(text(node, 'ISREVENUE')), deemedPositive: yn(text(node, 'ISDEEMEDPOSITIVE')),
          action: attr(node, 'ACTION') || 'Create'
        });
        break;
      case 'LEDGER': {
        var addr = [], al = child(node, 'ADDRESS.LIST');
        if (al) children(al, 'ADDRESS').forEach(function (a) { if (a.x) addr.push(a.x); });
        out.ledgers.push({
          name: masterName(node), parent: text(node, 'PARENT').trim(),
          aliases: aliases(node),
          opening: num(text(node, 'OPENINGBALANCE')),
          gstin: text(node, 'PARTYGSTIN') || text(node, 'GSTIN'),
          phone: text(node, 'LEDGERPHONE') || text(node, 'LEDGERMOBILE'),
          contact: text(node, 'LEDGERCONTACT'),
          email: text(node, 'EMAIL'),
          state: text(node, 'LEDGERSTATENAME') || text(node, 'STATENAME'),
          address: addr.join(', '),
          billwise: yn(text(node, 'ISBILLWISEON')) === true,
          revenue: yn(text(node, 'ISREVENUE')), deemedPositive: yn(text(node, 'ISDEEMEDPOSITIVE')),
          action: attr(node, 'ACTION') || 'Create'
        });
        break;
      }
      case 'STOCKITEM': {
        var oq = qty(text(node, 'OPENINGBALANCE'));
        out.stockItems.push({
          name: masterName(node), parent: text(node, 'PARENT').trim(),
          unit: text(node, 'BASEUNITS') || oq.unit,
          openingQty: oq.qty, openingValue: num(text(node, 'OPENINGVALUE')),
          openingRate: rate(text(node, 'OPENINGRATE')),
          hsn: text(node, 'HSNCODE') || text(node, 'GSTHSNCODE'),
          action: attr(node, 'ACTION') || 'Create'
        });
        break;
      }
      case 'STOCKGROUP':
        out.stockGroups.push({ name: masterName(node), parent: text(node, 'PARENT').trim() });
        break;
      case 'UNIT':
        out.units.push({ name: masterName(node), symbol: text(node, 'SYMBOL') || masterName(node) });
        break;
      case 'VOUCHERTYPE':
        out.voucherTypes.push({ name: masterName(node), parent: text(node, 'PARENT').trim(), action: attr(node, 'ACTION') || 'Create' });
        break;
      case 'VOUCHER':
        out.vouchers.push(extractVoucher(node));
        break;
      default:
        out.others[node.t] = (out.others[node.t] || 0) + 1;
    }
  }

  function parseTally(text, progress) {
    var out = newResult();
    parseXML(text, function (node) { extract(node, out); }, progress);
    var noDate = 0;
    out.vouchers.forEach(function (v) { if (!v.date) noDate++; });
    if (noDate) out.warnings.push(noDate + ' voucher(s) had no readable date and were skipped.');
    out.vouchers = out.vouchers.filter(function (v) { return v.date > 0; });
    if (!out.vouchers.length && !out.ledgers.length && !out.groups.length && !out.companies.length) out.preview = text.slice(0, 400).replace(/\s+/g, ' ').trim();
    return out;
  }

  root.TallyParse = {
    decodeBuffer: decodeBuffer, parseXML: parseXML, extract: extract, parseTally: parseTally,
    num: num, qty: qty, rate: rate, dateNum: dateNum, decodeEntities: decodeEntities
  };
})(typeof self !== 'undefined' ? self : globalThis);
