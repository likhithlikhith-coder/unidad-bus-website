/*
 * TallyPrime data-folder decoder (.1800 files).
 *
 * Reverse-engineered from TallyPrime Release 3+ company folders. Reads
 * Manager.1800 (masters), TranMgr.1800 (vouchers) and Company.1800 directly
 * and produces the same result object as the XML parser, so the rest of the
 * app does not care where the data came from.
 *
 * File layout (all three files): a 512-byte file header, then 512-byte pages.
 * Page header: [0]hash [4]objectId [8]pagesInChain(0=continuation) [12]nextPage
 * [16]pageType [20]recordNo [28]... Object pages (type 0x0b) have a variable
 * header of ~64 bytes; every other page type and every continuation page has
 * a 28-byte header. Values are a tag-length-value stream:
 *   [flags u16][tag u16][0 u8][type u8][payload]  (flags&0x400 → u32 key first)
 * Amounts, rates and quantities are 64-bit integers scaled by 100000.
 */
(function (root) {
  'use strict';

  var SCALE = 100000;
  var EPOCH_MS = Date.UTC(1899, 11, 31); // day 45382 = 1-Apr-2024 (verified against bank narrations)
  var BASE_TYPES = { 1: 'Contra', 2: 'Payment', 3: 'Receipt', 4: 'Journal', 5: 'Credit Note', 6: 'Debit Note', 7: 'Sales', 8: 'Purchase', 9: 'Delivery Note', 10: 'Receipt Note', 11: 'Rejections Out', 12: 'Rejections In', 13: 'Physical Stock', 14: 'Stock Journal', 15: 'Memorandum', 16: 'Reversing Journal', 17: 'Sales Order', 18: 'Purchase Order', 24: 'Attendance', 25: 'Payroll' };
  var PRIMARY_GROUP_POS = { 10: 'Capital Account', 20: 'Loans (Liability)', 30: 'Current Liabilities', 40: 'Fixed Assets', 50: 'Investments', 60: 'Current Assets', 70: 'Branch / Divisions', 80: 'Misc. Expenses (ASSET)', 90: 'Suspense A/c', 100: 'Reserves & Surplus', 110: 'Bank OD A/c', 120: 'Secured Loans', 130: 'Unsecured Loans', 140: 'Duties & Taxes', 150: 'Provisions', 160: 'Sundry Creditors', 170: 'Stock-in-Hand', 180: 'Deposits (Asset)', 190: 'Loans & Advances (Asset)', 200: 'Sundry Debtors', 210: 'Cash-in-Hand', 220: 'Bank Accounts', 230: 'Sales Accounts', 240: 'Purchase Accounts', 250: 'Direct Incomes', 260: 'Direct Expenses', 270: 'Indirect Incomes', 280: 'Indirect Expenses' };

  function dayToDate(days) {
    if (!(days > 0 && days < 200000)) return 0;
    var d = new Date(EPOCH_MS + days * 86400000);
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  }
  function addDays(yyyymmdd, n) {
    var y = Math.floor(yyyymmdd / 10000), m = Math.floor(yyyymmdd / 100) % 100, d = yyyymmdd % 100;
    var t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
    return t.getUTCFullYear() * 10000 + (t.getUTCMonth() + 1) * 100 + t.getUTCDate();
  }
  function i64(dv, o) { return dv.getInt32(o + 4, true) * 4294967296 + dv.getUint32(o, true); }
  function utf16(u8, o, n) {
    var s = '', end = o + n;
    for (var i = o; i + 1 < end; i += 2) { var c = u8[i] | (u8[i + 1] << 8); if (c === 0) break; s += String.fromCharCode(c); }
    return s;
  }

  /* ---- TLV stream --------------------------------------------------------- */

  // Returns { entries, ok }. Each entry: {tag, typ, key, val, kids}
  function parseStream(u8, dv, o, end, depth, st) {
    var out = [];
    if (end > u8.length) end = u8.length;
    while (o + 6 <= end) {
      // stop at trailing zero padding
      var allZero = true;
      for (var z = o; z < end; z++) if (u8[z]) { allZero = false; break; }
      if (allZero) break;
      var flags = u8[o] | (u8[o + 1] << 8), tag = u8[o + 2] | (u8[o + 3] << 8), typ = u8[o + 5];
      o += 6;
      var key = null;
      if ((flags & 0x400) && typ !== 0x10) { if (o + 4 > end) { st.ok = false; break; } key = dv.getUint32(o, true); o += 4; }
      var e = { tag: tag, typ: typ, key: key, val: null, kids: null };
      switch (typ) {
        case 0x00: break;
        case 0x01: e.val = true; break;
        case 0x02: case 0x03: case 0x04: case 0x05: if (o + 4 > end) { st.ok = false; } else { e.val = dv.getUint32(o, true); } o += 4; break;
        case 0x06: if (o + 4 > end) { st.ok = false; } else { e.val = dv.getInt32(o, true); } o += 4; break;
        case 0x0d: if (o + 4 > end) { st.ok = false; } else { e.val = dayToDate(dv.getUint32(o, true)); } o += 4; break;
        case 0x07: if (o + 8 > end) { st.ok = false; } else { e.val = [dv.getUint32(o, true), dv.getUint32(o + 4, true)]; } o += 8; break;
        case 0x08: case 0x09: if (o + 8 > end) { st.ok = false; } else { e.val = i64(dv, o); } o += 8; break;
        case 0x16: if (o + 8 > end) { st.ok = false; } else { e.val = [dayToDate(dv.getUint32(o, true)), dv.getUint32(o + 4, true)]; } o += 8; break;
        case 0x0b: if (o + 12 > end) { st.ok = false; } else { e.val = [i64(dv, o), dv.getUint32(o + 8, true)]; } o += 12; break;
        case 0x0c: if (o + 20 > end) { st.ok = false; } else { e.val = [i64(dv, o), i64(dv, o + 8), dv.getUint32(o + 16, true)]; } o += 20; break;
        case 0x21: break;                       // seen only as a trailing empty entry
        case 0x0e: if (o + 8 > end) { st.ok = false; } else { e.val = i64(dv, o); } o += 8; break;
        case 0x0f: case 0x2f: case 0x83: case 0x85: case 0x8f: {
          if (o + 2 > end) { st.ok = false; o = end; break; }
          var ln = u8[o] | (u8[o + 1] << 8); o += 2;
          if (o + ln > end) { st.ok = false; o = end; break; }
          e.val = utf16(u8, o, ln); o += ln; break;
        }
        case 0x10: {
          if (flags & 0x400) { if (o + 4 > end) { st.ok = false; o = end; break; } key = e.key = dv.getUint32(o, true); o += 4; }
          if (o + 2 > end) { st.ok = false; o = end; break; }
          var nl = u8[o] | (u8[o + 1] << 8); o += 2;
          if (o + nl > end) { st.ok = false; o = end; break; }
          e.kids = parseStream(u8, dv, o, o + nl, depth + 1, st); o += nl; break;
        }
        default: st.ok = false; o = end;
      }
      if (!st.ok) { out.push(e); break; }
      out.push(e);
    }
    return out;
  }
  function find(es, tag, typ) { if (!es) return null; for (var i = 0; i < es.length; i++) if (es[i].tag === tag && (typ === undefined || es[i].typ === typ)) return es[i]; return null; }
  function findAll(es, tag, typ) { var r = []; if (!es) return r; for (var i = 0; i < es.length; i++) if (es[i].tag === tag && (typ === undefined || es[i].typ === typ)) r.push(es[i]); return r; }
  function str(es, tag) { var e = find(es, tag, 0x0f) || find(es, tag, 0x83) || find(es, tag, 0x85); return e && e.val ? String(e.val).replace(/[\r\n]+$/, '').trim() : ''; }
  function nameOf(es) {
    var n = find(es, 3, 0x10);
    if (n && n.key === 1033) { var s = find(n.kids, 2, 0x0f); if (s && s.val) return s.val.trim(); }
    for (var i = 0; i < es.length; i++) if (es[i].typ === 0x10 && es[i].key === 1033) { var s2 = find(es[i].kids, 2, 0x0f); if (s2 && s2.val) return s2.val.trim(); }
    return str(es, 503);
  }

  /* ---- page files --------------------------------------------------------- */

  function PageFile(buf) {
    this.u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    this.dv = new DataView(this.u8.buffer, this.u8.byteOffset, this.u8.byteLength);
    this.n = Math.max(0, Math.floor((this.u8.length - 512) / 512));
    var n = this.n;
    this.objid = new Uint32Array(n + 1); this.npages = new Uint32Array(n + 1); this.next = new Uint32Array(n + 1);
    this.ptype = new Uint32Array(n + 1); this.rec = new Uint32Array(n + 1); this.otype = new Uint32Array(n + 1);
    for (var pg = 1; pg <= n; pg++) {
      var o = pg * 512;
      this.objid[pg] = this.dv.getUint32(o + 4, true); this.npages[pg] = this.dv.getUint32(o + 8, true);
      this.next[pg] = this.dv.getUint32(o + 12, true); this.ptype[pg] = this.dv.getUint32(o + 16, true);
      this.rec[pg] = this.dv.getUint32(o + 20, true); this.otype[pg] = this.dv.getUint32(o + 28, true);
    }
  }
  PageFile.prototype.parseAt = function (o, end) {
    var st = { ok: true }; var es = parseStream(this.u8, this.dv, o, end, 0, st); return { entries: es, ok: st.ok };
  };
  // Object pages have a variable-length header; choose the start that parses cleanly.
  PageFile.prototype.streamStart = function (pg) {
    var tries = [0x40, 0x42, 0x44, 0x46, 0x48, 0x3e, 0x3c, 0x4a, 0x4c], best = null, bestScore = -1;
    for (var i = 0; i < tries.length; i++) {
      var r = this.parseAt(pg * 512 + tries[i], pg * 512 + 512);
      var score = (r.ok ? 1000 : 0) + (find(r.entries, 3, 0x06) ? 100 : 0) + Math.min(r.entries.length, 99);
      if (score > bestScore) { bestScore = score; best = tries[i]; }
      if (r.ok && find(r.entries, 3, 0x06)) break;
    }
    return best;
  };
  // Concatenate the payload of a page chain starting at page pg.
  PageFile.prototype.chain = function (pg) {
    var first = this.ptype[pg] === 0x0b ? this.streamStart(pg) : 0x1c;
    var parts = [this.u8.subarray(pg * 512 + first, pg * 512 + 512)], total = 512 - first;
    var seen = {}; seen[pg] = 1; var cur = this.next[pg], cnt = 1, max = this.npages[pg] + 2;
    while (cur && !seen[cur] && cur <= this.n && cnt < max) {
      seen[cur] = 1; parts.push(this.u8.subarray(cur * 512 + 0x1c, cur * 512 + 512)); total += 512 - 0x1c; cur = this.next[cur]; cnt++;
    }
    if (parts.length === 1) return parts[0];
    var out = new Uint8Array(total), off = 0;
    for (var i = 0; i < parts.length; i++) { out.set(parts[i], off); off += parts[i].length; }
    return out;
  };
  PageFile.prototype.parseChain = function (pg) {
    var data = this.chain(pg);
    var dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    var st = { ok: true }; var es = parseStream(data, dv, 0, data.length, 0, st);
    return { entries: es, ok: st.ok, data: data };
  };

  /* ---- decoding ----------------------------------------------------------- */

  function decodeFolder(files, progress) {
    // files: { 'Manager.1800': ArrayBuffer, 'TranMgr.1800': ArrayBuffer, 'Company.1800': ArrayBuffer }
    var out = { company: '', companies: [], groups: [], ledgers: [], stockItems: [], stockGroups: [], units: [], voucherTypes: [], vouchers: [], others: {}, warnings: [], source: 'tally-folder' };
    var byName = {}, lower = {};
    Object.keys(files).forEach(function (k) { lower[k.toLowerCase()] = files[k]; });
    var manager = lower['manager.1800'], tran = lower['tranmgr.1800'], comp = lower['company.1800'];
    if (!manager) { out.warnings.push('Manager.1800 (masters) not found in the folder.'); }
    if (!tran) { out.warnings.push('TranMgr.1800 (vouchers) not found in the folder.'); }

    /* company */
    if (comp) {
      try {
        var C = new PageFile(comp);
        for (var cp = 1; cp <= C.n; cp++) {
          if (C.ptype[cp] !== 66 || !C.npages[cp]) continue;
          var ce = C.parseChain(cp).entries;
          var cname = str(ce, 28) || str(ce, 27);
          if (cname) {
            var sd = find(ce, 28, 0x0d) || find(ce, 27, 0x0d);
            out.company = cname;
            out.companyInfo = { name: cname, mailingName: str(ce, 27), address: findAll(ce, 29, 0x0f).map(function (e) { return e.val; }).join(', '), state: str(ce, 103), pin: str(ce, 104), phone: str(ce, 105), pan: str(ce, 202), guid: str(ce, 30), booksFrom: sd && sd.val ? sd.val : 0, tallyVersion: str(ce, 1002) };
            break;
          }
        }
      } catch (e) { out.warnings.push('Company.1800 could not be read: ' + e.message); }
    }

    /* masters */
    var ids = {};          // objid → { kind, name }
    var groupById = {}, unitById = {}, sgById = {}, vtById = {}, ledById = {}, godownById = {};
    var ledgerNames = {};
    if (manager) {
      var Mf = new PageFile(manager), total = Mf.n, done = 0, failures = 0;
      var raw = [];
      for (var pg = 1; pg <= Mf.n; pg++) {
        if (Mf.ptype[pg] !== 0x0b || !Mf.npages[pg]) continue;
        var r = Mf.parseChain(pg), es = r.entries;
        if (!r.ok) failures++;
        var k = find(es, 3, 0x06); if (!k) continue;
        var id = Mf.objid[pg], name = nameOf(es);
        ids[id] = { kind: k.val, name: name };
        raw.push({ id: id, kind: k.val, name: name, es: es, otype: Mf.otype[pg] });
        if ((++done & 1023) === 0 && progress) progress(pg, Mf.n + (tran ? tran.byteLength / 512 : 0));
      }
      // first pass: groups, units, stock groups, voucher types, godowns
      raw.forEach(function (o) {
        var es = o.es;
        if (o.kind === 2 && o.name) groupById[o.id] = { name: o.name, parentId: (find(es, 3, 0x03) || {}).val || 0, pos: (find(es, 4, 0x06) || {}).val };
        else if (o.kind === 12 && o.name) unitById[o.id] = o.name;
        else if (o.kind === 7 && o.name) sgById[o.id] = { name: o.name, parentId: (find(es, 3, 0x03) || {}).val || 0 };
        else if (o.kind === 6 && o.name) godownById[o.id] = o.name;
        else if (o.kind === 10 && o.name) vtById[o.id] = { name: o.name, base: BASE_TYPES[(find(es, 4002, 0x06) || {}).val] || '' };
        else if (o.kind === 31 && out.companyInfo) {
          // GST registration ("tax unit"): nested 3205 → 3202 GSTIN, 3203 state, 3204 city
          var reg = find(es, 3205, 0x10);
          if (reg) {
            var g = str(reg.kids, 3202), pan = (out.companyInfo.pan || '').replace(/\s+/g, '').toUpperCase();
            if (g && (!out.companyInfo.gstin || (pan && g.slice(2, 12) === pan))) {
              out.companyInfo.gstin = g.toUpperCase();
              if (!out.companyInfo.city) out.companyInfo.city = str(reg.kids, 3204);
              if (str(reg.kids, 3203)) out.companyInfo.state = str(reg.kids, 3203);
            }
          }
        }
      });
      // groups → output
      var gnames = {};
      Object.keys(groupById).forEach(function (id) { gnames[groupById[id].name] = 1; });
      Object.keys(groupById).forEach(function (id) {
        var g = groupById[id], parent = '';
        if (g.parentId && groupById[g.parentId]) parent = groupById[g.parentId].name;
        else if (!g.parentId && g.pos && PRIMARY_GROUP_POS[g.pos] && PRIMARY_GROUP_POS[g.pos] !== g.name && gnames[PRIMARY_GROUP_POS[g.pos]]) parent = PRIMARY_GROUP_POS[g.pos];
        out.groups.push({ name: g.name, parent: parent, reserved: '', revenue: null, deemedPositive: null, action: 'Create' });
      });
      Object.keys(sgById).forEach(function (id) { var g = sgById[id]; out.stockGroups.push({ name: g.name, parent: g.parentId && sgById[g.parentId] ? sgById[g.parentId].name : '' }); });
      Object.keys(unitById).forEach(function (id) { out.units.push({ name: unitById[id], symbol: unitById[id] }); });
      Object.keys(vtById).forEach(function (id) { var v = vtById[id]; out.voucherTypes.push({ name: v.name, parent: v.base && v.base !== v.name ? v.base : '', action: 'Create' }); });
      // second pass: ledgers and stock items
      raw.forEach(function (o) {
        var es = o.es;
        if (o.kind === 3) {
          if (!o.name) return;
          var nm = o.name;
          if (ledgerNames[nm]) nm = nm + ' [' + o.id + ']';   // duplicate names exist in some data folders
          ledgerNames[nm] = 1;
          var pid = (find(es, 3, 0x03) || {}).val, opening = find(es, 2603, 0x09);
          var addr = findAll(es, 504, 0x0f).map(function (e) { return e.val.trim(); }).filter(Boolean);
          ledById[o.id] = nm;
          out.ledgers.push({
            name: nm, parent: pid && groupById[pid] ? groupById[pid].name : '', aliases: [],
            opening: opening ? opening.val / SCALE : 0,
            gstin: str(es, 2762), phone: str(es, 2756) || str(es, 2757), contact: '', email: str(es, 2758),
            state: str(es, 2764), address: addr.join(', ') + (str(es, 2703) ? ' - ' + str(es, 2703) : ''),
            bankAccount: str(es, 2604), ifsc: str(es, 3404), bankName: str(es, 3406),
            billwise: !!find(es, 2607, 0x01), revenue: null, deemedPositive: null, action: 'Create', tallyId: o.id
          });
        } else if (o.kind === 9) {
          if (!o.name) return;
          var ob = find(es, 3802, 0x10), qty = null, val = null, rate = null;
          var q = find(es, 3802, 0x0b), v = find(es, 3802, 0x09), rt = find(es, 3802, 0x0c);
          if (q) qty = q; if (v) val = v; if (rt) rate = rt;
          var unitId = (find(es, 504, 0x03) || {}).val || (q ? q.val[1] : 0) || (rt ? rt.val[2] : 0);
          var spid = (find(es, 3, 0x03) || {}).val;
          out.stockItems.push({
            name: o.name, parent: spid && sgById[spid] ? sgById[spid].name : '',
            unit: unitById[unitId] || '', openingQty: q ? q.val[0] / SCALE : 0, openingValue: v ? v.val / SCALE : 0,
            openingRate: rt ? rt.val[0] / SCALE : 0, hsn: str(es, 4003), action: 'Create', tallyId: o.id
          });
        }
      });
      if (failures) out.warnings.push(failures + ' master records could not be fully decoded.');
    }

    /* vouchers */
    if (tran) {
      var Tf = new PageFile(tran);
      var recs = {}, index = {};
      for (var p = 1; p <= Tf.n; p++) {
        if (!Tf.npages[p]) continue;
        if (Tf.ptype[p] === 66) { (recs[Tf.objid[p]] || (recs[Tf.objid[p]] = {}))[Tf.rec[p]] = p; }
        else if (Tf.ptype[p] === 3) {
          var ie = Tf.parseAt(p * 512 + 0x1c, p * 512 + 512).entries;
          for (var ii = 0; ii < ie.length; ii++) {
            var e = ie[ii];
            if (e.typ === 0x10 && e.key === 85 && e.kids) {
              var vers = {};
              e.kids.forEach(function (x) { var pgv = find(x.kids, 2, 0x06); if (x.typ === 0x10 && pgv) vers[x.key] = pgv.val; });
              if (Object.keys(vers).length) index[Tf.objid[p]] = vers;
            }
          }
        }
      }
      var empty = 0, nvch = 0;
      for (var vp = 1; vp <= Tf.n; vp++) {
        if (Tf.ptype[vp] !== 0x0b || !Tf.npages[vp]) continue;
        var oid = Tf.objid[vp], rr = recs[oid] || {};
        var hdr = rr[1] ? Tf.parseChain(rr[1]).entries : [];
        var post = null;
        if (rr[2]) {
          var pc = Tf.chain(rr[2]), pdv = new DataView(pc.buffer, pc.byteOffset, pc.byteLength);
          var ts = tlvStart(pc);
          if (ts >= 0) { var pst = { ok: true }; post = parseStream(pc, pdv, ts, pc.length, 0, pst); }
        }
        var cur = null, vers2 = index[oid];
        if (vers2) { var mx = 0; Object.keys(vers2).forEach(function (kv) { if (+kv > mx) mx = +kv; }); if (mx && vers2[mx] <= Tf.n) cur = Tf.parseChain(vers2[mx]).entries; }

        var v = { id: 'tally:' + oid, date: 0, type: '', number: '', ref: '', narration: '', party: '', cancelled: false, optional: false, postDated: false, action: 'Create', entries: [], items: [], tallyId: oid };
        // Tally's own GUID = company GUID + '-' + 8 hex digits of the object's counter, so XML and folder imports match up.
        var gc = find(hdr, 3004, 0x06) || find(cur, 3004, 0x06), gs = str(hdr, 3004) || str(cur, 3004) || (out.companyInfo && out.companyInfo.guid) || '';
        if (gc && gs) v.id = gs + '-' + ('00000000' + gc.val.toString(16)).slice(-8);
        var hf = {}; hdr.forEach(function (e) { if (e.typ === 0x01) hf[e.tag] = true; });
        if (hf[1503]) v.cancelled = true;
        else if (hf[2003] && hf[2005] && !hf[1532]) v.optional = true;
        var d7 = find(hdr, 3, 0x07) || find(cur, 3, 0x07);
        if (d7) v.date = dayToDate(d7.val[1]);
        if (!v.date) { var dd = find(hdr, 103, 0x0d) || find(cur, 103, 0x0d); if (dd) v.date = dd.val; }
        var vt = find(hdr, 203, 0x03);
        if (vt && vtById[vt.val]) v.type = vtById[vt.val].name;
        if (!v.type && cur) v.type = str(cur, 203);
        if (!v.type) { var keyS = str(hdr, 3) || str(cur, 3); var km = /^[0-9a-f]{8}-([0-9a-f]{8})-/.exec(keyS); if (km) v.type = BASE_TYPES[parseInt(km[1], 16)] || ''; }
        v.number = (cur ? str(cur, 203) : '') || str(hdr, 2005) || str(hdr, 203);
        var pl = find(hdr, 204, 0x03);
        v.party = (pl && ledById[pl.val]) || str(hdr, 206) || (cur ? str(cur, 204) : '');
        if (cur) { v.narration = str(cur, 205); v.ref = str(cur, 1500) || ''; }

        // ledger entries: posting record (ids) preferred, else editable chain (names)
        var ents = ledgerEntries(post, ledById, ids);
        // Cancelled and optional vouchers post nothing, so their lines live only in the editable chain.
        // A company with no posting records at all (older data) also falls back to the chain.
        if (!ents.length && cur && (v.cancelled || v.optional || !rr[2])) ents = ledgerEntries(cur, ledById, ids);
        v.entries = ents;
        if (cur) v.items = inventoryEntries(cur, ids, unitById);
        if (!v.entries.length) { empty++; continue; }
        var sum = 0; v.entries.forEach(function (e) { sum += e.amount; });
        if (Math.abs(sum) > 0.01) v.unbalanced = Math.round(sum * 100) / 100;
        out.vouchers.push(v); nvch++;
      }
      if (empty) out.warnings.push(empty + ' voucher records had no ledger entries (deleted or empty) and were skipped.');
      out.others.emptyVouchers = empty;
    }
    out.vouchers.sort(function (a, b) { return a.date - b.date || a.tallyId - b.tallyId; });
    return out;
  }

  function tlvStart(pc) {
    var a = indexOf(pc, [0x04, 0xd3, 0x52, 0x00, 0x09]), b = indexOf(pc, [0x00, 0x50, 0x13, 0x27, 0x00, 0x10]);
    if (a >= 0) a -= 1;
    if (a < 0) return b; if (b < 0) return a; return Math.min(a, b);
  }
  function indexOf(u8, pat) {
    outer: for (var i = 0; i + pat.length <= u8.length; i++) { for (var j = 0; j < pat.length; j++) if (u8[i + j] !== pat[j]) continue outer; return i; }
    return -1;
  }
  function ledgerEntries(es, ledById, ids) {
    var out = [];
    if (!es) return out;
    es.forEach(function (e) {
      if (e.tag !== 10003 || e.typ !== 0x10 || !e.kids) return;
      e.kids.forEach(function (x) {
        if (x.typ !== 0x10 || !x.kids) return;
        x.kids.forEach(function (y) {
          if (y.typ !== 0x10 || !y.kids) return;
          var lid = find(y.kids, 2, 0x03), nm = find(y.kids, 2, 0x83) || find(y.kids, 2, 0x0f), amt = find(y.kids, 2, 0x09);
          if (!amt) return;
          var name = (lid && ledById[lid.val]) || (nm && nm.val) || (lid && ids[lid.val] && ids[lid.val].name) || (lid ? 'Ledger #' + lid.val : '');
          if (!name) return;
          var entry = { ledger: name, amount: amt.val / SCALE };
          var bank = find(y.kids, 510, 0x10);
          if (bank) { var bd = find(bank.kids, 2, 0x0d); entry.bank = { favouring: str(bank.kids, 2), mode: str(bank.kids, 33), instrument: str(bank.kids, 4), ref: str(bank.kids, 10), date: bd ? bd.val : 0 }; }
          out.push(entry);
        });
      });
    });
    return out;
  }
  // Inventory lines are decoded heuristically: any nested record (outside the ledger list) carrying a quantity value.
  function inventoryEntries(es, ids, unitById) {
    var out = [];
    function walk(list, depth) {
      if (!list || depth > 6) return;
      list.forEach(function (e) {
        if (e.typ !== 0x10 || !e.kids || e.tag === 10003) return;
        var q = null, amt = null, rate = null, nameE = null, idE = null;
        e.kids.forEach(function (k) {
          if (k.typ === 0x0b && !q) q = k; else if (k.typ === 0x09 && !amt) amt = k; else if (k.typ === 0x0c && !rate) rate = k;
          else if ((k.typ === 0x83 || k.typ === 0x0f) && !nameE && k.tag === 2) nameE = k; else if (k.typ === 0x03 && k.tag === 2 && !idE) idE = k;
        });
        if (q && (nameE || (idE && ids[idE.val] && ids[idE.val].kind === 9))) {
          var nm = nameE ? nameE.val : ids[idE.val].name;
          out.push({ item: nm, qty: q.val[0] / SCALE, unit: unitById[q.val[1]] || '', billedQty: q.val[0] / SCALE, rate: rate ? rate.val[0] / SCALE : 0, amount: amt ? amt.val / SCALE : 0, discount: 0, godown: '', tracking: '', dir: '' });
        } else walk(e.kids, depth + 1);
      });
    }
    walk(es, 0);
    return out;
  }

  root.TallyDB = { decodeFolder: decodeFolder, PageFile: PageFile, parseStream: parseStream, dayToDate: dayToDate, SCALE: SCALE };
})(typeof self !== 'undefined' ? self : globalThis);
