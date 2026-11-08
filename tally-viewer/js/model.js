/*
 * Accounting model over imported Tally data.
 *
 * Sign convention follows Tally XML: negative amount = Debit, positive = Credit.
 * A Book is built from the stored data of one company and answers questions
 * like "closing balance of ledger X for the period" or "trial balance tree".
 */
(function (root) {
  'use strict';

  // Nature by Tally's reserved primary/sub group names.
  // A = asset, L = liability, I = income, E = expense.
  var NATURE = {
    'Capital Account': 'L', 'Loans (Liability)': 'L', 'Current Liabilities': 'L',
    'Reserves & Surplus': 'L', 'Bank OD A/c': 'L', 'Secured Loans': 'L', 'Unsecured Loans': 'L',
    'Sundry Creditors': 'L', 'Duties & Taxes': 'L', 'Provisions': 'L',
    'Fixed Assets': 'A', 'Investments': 'A', 'Current Assets': 'A', 'Branch / Divisions': 'A',
    'Misc. Expenses (ASSET)': 'A', 'Suspense A/c': 'A', 'Bank Accounts': 'A', 'Cash-in-Hand': 'A',
    'Deposits (Asset)': 'A', 'Loans & Advances (Asset)': 'A', 'Stock-in-Hand': 'A', 'Sundry Debtors': 'A',
    'Sales Accounts': 'I', 'Direct Incomes': 'I', 'Indirect Incomes': 'I',
    'Purchase Accounts': 'E', 'Direct Expenses': 'E', 'Indirect Expenses': 'E'
  };
  var PRIMARY_ORDER = ['Capital Account', 'Loans (Liability)', 'Current Liabilities', 'Fixed Assets', 'Investments', 'Current Assets',
    'Branch / Divisions', 'Misc. Expenses (ASSET)', 'Suspense A/c', 'Sales Accounts', 'Purchase Accounts', 'Direct Incomes',
    'Direct Expenses', 'Indirect Incomes', 'Indirect Expenses'];
  var BASE_TYPES = ['Sales', 'Purchase', 'Payment', 'Receipt', 'Contra', 'Journal', 'Credit Note', 'Debit Note',
    'Sales Order', 'Purchase Order', 'Delivery Note', 'Receipt Note', 'Rejections In', 'Rejections Out',
    'Stock Journal', 'Physical Stock', 'Memorandum', 'Reversing Journal', 'Payroll', 'Attendance',
    'Material In', 'Material Out', 'Job Work In Order', 'Job Work Out Order'];
  var NON_ACCOUNTING = { 'Sales Order': 1, 'Purchase Order': 1, 'Delivery Note': 1, 'Receipt Note': 1, 'Rejections In': 1, 'Rejections Out': 1,
    'Memorandum': 1, 'Reversing Journal': 1, 'Physical Stock': 1, 'Attendance': 1, 'Material In': 1, 'Material Out': 1,
    'Job Work In Order': 1, 'Job Work Out Order': 1, 'Stock Journal': 1 };
  var STOCK_DIR = { 'Sales': -1, 'Delivery Note': -1, 'Rejections Out': -1, 'Debit Note': -1, 'Purchase': 1, 'Receipt Note': 1, 'Rejections In': 1, 'Credit Note': 1 };
  var TRACKED_PAIR = { 'Sales': 'Delivery Note', 'Purchase': 'Receipt Note' };

  function isPrimary(p) { return !p || p === 'Primary' || p.toLowerCase() === 'primary'; }
  function emptyData(id) {
    return { id: id, groups: {}, ledgers: {}, stockItems: {}, stockGroups: {}, units: {}, voucherTypes: {}, vouchers: [], files: [] };
  }

  /* ---- Merging an import into stored data ------------------------------- */

  function voucherKey(v) {
    if (v.id) return v.id;
    var total = 0;
    for (var i = 0; i < v.entries.length; i++) if (v.entries[i].amount < 0) total += -v.entries[i].amount;
    return 'k|' + v.date + '|' + v.type + '|' + v.number + '|' + total.toFixed(2);
  }
  function mergeMasters(map, list) {
    var n = { added: 0, updated: 0, deleted: 0 };
    list.forEach(function (m) {
      if (!m.name) return;
      if (m.action === 'Delete') { if (map[m.name]) { delete map[m.name]; n.deleted++; } return; }
      if (map[m.name]) n.updated++; else n.added++;
      delete m.action;
      map[m.name] = m;
    });
    return n;
  }
  function mergeImport(data, result, fileMeta) {
    var counts = {
      groups: mergeMasters(data.groups, result.groups),
      ledgers: mergeMasters(data.ledgers, result.ledgers),
      stockItems: mergeMasters(data.stockItems, result.stockItems),
      stockGroups: mergeMasters(data.stockGroups, result.stockGroups || []),
      units: mergeMasters(data.units, result.units || []),
      voucherTypes: mergeMasters(data.voucherTypes, result.voucherTypes),
      vouchers: { added: 0, updated: 0, deleted: 0 }
    };
    var idx = {};
    data.vouchers.forEach(function (v, i) { idx[voucherKey(v)] = i; });
    var removed = {};
    result.vouchers.forEach(function (v) {
      var k = voucherKey(v);
      if (v.action === 'Delete') { if (idx[k] !== undefined) { removed[idx[k]] = true; counts.vouchers.deleted++; } return; }
      delete v.action;
      if (idx[k] !== undefined) { data.vouchers[idx[k]] = v; counts.vouchers.updated++; }
      else { idx[k] = data.vouchers.length; data.vouchers.push(v); counts.vouchers.added++; }
    });
    if (counts.vouchers.deleted) data.vouchers = data.vouchers.filter(function (v, i) { return !removed[i]; });
    data.vouchers.sort(function (a, b) { return a.date - b.date || String(a.number).localeCompare(String(b.number), undefined, { numeric: true }); });
    if (fileMeta) data.files.push({ name: fileMeta.name, bytes: fileMeta.bytes, at: Date.now(), counts: counts, company: result.company || '' });
    return counts;
  }

  /* ---- Book --------------------------------------------------------------- */

  function Book(data) {
    this.data = data;
    this.build();
  }

  Book.prototype.build = function () {
    var self = this, d = this.data;
    this.groups = {}; this.ledgers = {}; this.vtBase = {};
    var g, name;
    for (name in d.groups) { g = d.groups[name]; this.groups[name] = { name: name, parent: isPrimary(g.parent) ? '' : g.parent, revenue: g.revenue, deemedPositive: g.deemedPositive, implicit: false }; }
    // implicit groups referenced by ledgers/groups but missing from masters
    function ensureGroup(gname) {
      if (!gname || isPrimary(gname) || self.groups[gname]) return;
      self.groups[gname] = { name: gname, parent: '', revenue: null, deemedPositive: null, implicit: true };
    }
    for (name in d.ledgers) ensureGroup(d.ledgers[name].parent);
    for (name in this.groups) ensureGroup(this.groups[name].parent);

    // nature + chain per group
    for (name in this.groups) this.groupChain(name);

    for (name in d.ledgers) {
      var l = d.ledgers[name];
      this.ledgers[name] = { name: name, parent: isPrimary(l.parent) ? '' : l.parent, opening: l.opening || 0, implicit: false, info: l };
    }
    // voucher type base
    for (name in d.voucherTypes) this.baseType(name);

    // index entries by ledger
    this.vouchers = d.vouchers;
    this.ledgerEntries = {};
    this.minDate = 0; this.maxDate = 0;
    this.typeCounts = {};
    for (var i = 0; i < d.vouchers.length; i++) {
      var v = d.vouchers[i];
      v.idx = i;
      v.base = this.baseType(v.type);
      v.affects = !v.cancelled && !v.optional && !NON_ACCOUNTING[v.base];
      v.total = 0;
      for (var k = 0; k < v.entries.length; k++) if (v.entries[k].amount < 0) v.total += -v.entries[k].amount;
      v.total = Math.round(v.total * 100) / 100;
      if (!this.minDate || v.date < this.minDate) this.minDate = v.date;
      if (v.date > this.maxDate) this.maxDate = v.date;
      this.typeCounts[v.type] = (this.typeCounts[v.type] || 0) + 1;
      if (!v.affects) continue;
      for (k = 0; k < v.entries.length; k++) {
        var e = v.entries[k];
        if (!this.ledgers[e.ledger]) this.ledgers[e.ledger] = { name: e.ledger, parent: '', opening: 0, implicit: true, info: {} };
        (this.ledgerEntries[e.ledger] || (this.ledgerEntries[e.ledger] = [])).push({ d: v.date, a: e.amount, v: i });
      }
    }
    for (name in this.ledgerEntries) this.ledgerEntries[name].sort(function (a, b) { return a.d - b.d || a.v - b.v; });
    for (name in this.ledgers) {
      var led = this.ledgers[name];
      led.chain = led.parent ? this.groupChain(led.parent) : [];
      led.root = led.chain.length ? led.chain[led.chain.length - 1] : '';
      led.nature = this.ledgerNature(led);
    }
    // group children
    this.groupKids = {}; this.groupLedgers = {}; this.rootGroups = [];
    for (name in this.groups) {
      g = this.groups[name];
      if (g.parent) (this.groupKids[g.parent] || (this.groupKids[g.parent] = [])).push(name);
      else this.rootGroups.push(name);
    }
    for (name in this.ledgers) {
      led = this.ledgers[name];
      var key = led.parent || '';
      (this.groupLedgers[key] || (this.groupLedgers[key] = [])).push(name);
    }
    var order = {}; PRIMARY_ORDER.forEach(function (n, i) { order[n] = i; });
    this.rootGroups.sort(function (a, b) { return (order[a] === undefined ? 99 : order[a]) - (order[b] === undefined ? 99 : order[b]) || a.localeCompare(b); });
    this.ledgerNames = Object.keys(this.ledgers).sort(function (a, b) { return a.localeCompare(b); });
    this.cache = {};
    this.buildStock();
  };

  Book.prototype.groupChain = function (name) {
    var chain = [], seen = {}, cur = name;
    while (cur && this.groups[cur] && !seen[cur]) {
      seen[cur] = 1; chain.push(cur);
      cur = this.groups[cur].parent;
    }
    if (cur && !this.groups[cur] && !isPrimary(cur)) chain.push(cur);
    var g = this.groups[name];
    if (g && !g.chain) {
      g.chain = chain;
      g.root = chain[chain.length - 1];
      g.nature = 'U';
      for (var i = 0; i < chain.length; i++) { if (NATURE[chain[i]]) { g.nature = NATURE[chain[i]]; break; } }
      if (g.nature === 'U') {
        for (i = 0; i < chain.length; i++) {
          var gg = this.groups[chain[i]];
          if (gg && gg.revenue !== null && gg.deemedPositive !== null) {
            g.nature = gg.revenue ? (gg.deemedPositive ? 'E' : 'I') : (gg.deemedPositive ? 'A' : 'L');
            break;
          }
        }
      }
    }
    return chain;
  };
  Book.prototype.ledgerNature = function (led) {
    if (!led.parent) {
      if (/profit.*loss/i.test(led.name)) return 'P';
      var info = led.info || {};
      if (info.revenue !== null && info.revenue !== undefined && info.deemedPositive !== null && info.deemedPositive !== undefined)
        return info.revenue ? (info.deemedPositive ? 'E' : 'I') : (info.deemedPositive ? 'A' : 'L');
      return 'U';
    }
    var g = this.groups[led.parent];
    return g ? g.nature : (NATURE[led.parent] || 'U');
  };
  Book.prototype.baseType = function (name) {
    if (this.vtBase[name]) return this.vtBase[name];
    var seen = {}, cur = name, base = '';
    while (cur && !seen[cur]) {
      seen[cur] = 1;
      for (var i = 0; i < BASE_TYPES.length; i++) if (BASE_TYPES[i].toLowerCase() === cur.toLowerCase()) { base = BASE_TYPES[i]; break; }
      if (base) break;
      var vt = this.data.voucherTypes[cur];
      cur = vt && !isPrimary(vt.parent) ? vt.parent : '';
    }
    if (!base) {
      var n = name.toLowerCase();
      if (/order/.test(n)) base = /purch/.test(n) ? 'Purchase Order' : 'Sales Order';
      else if (/credit note/.test(n)) base = 'Credit Note';
      else if (/debit note/.test(n)) base = 'Debit Note';
      else if (/sale|invoice/.test(n)) base = 'Sales';
      else if (/purch/.test(n)) base = 'Purchase';
      else if (/receipt/.test(n)) base = 'Receipt';
      else if (/pay/.test(n)) base = 'Payment';
      else if (/contra/.test(n)) base = 'Contra';
      else base = 'Journal';
    }
    this.vtBase[name] = base;
    return base;
  };
  Book.prototype.inGroup = function (ledgerName, groupName) {
    var led = this.ledgers[ledgerName];
    return !!led && led.chain.indexOf(groupName) !== -1;
  };

  /* ---- Balances ----------------------------------------------------------- */

  // {opening, debit, credit, closing} signed (negative = Dr)
  Book.prototype.ledgerBalance = function (name, from, to) {
    var led = this.ledgers[name], ent = this.ledgerEntries[name] || [];
    var opening = led ? led.opening : 0, debit = 0, credit = 0;
    for (var i = 0; i < ent.length; i++) {
      var e = ent[i];
      if (e.d < from) opening += e.a;
      else if (e.d <= to) { if (e.a < 0) debit += -e.a; else credit += e.a; }
      else break;
    }
    return { opening: opening, debit: debit, credit: credit, closing: opening + credit - debit, count: ent.length };
  };

  // Full group tree with balances for a period. Cached per period.
  Book.prototype.tree = function (from, to) {
    var key = from + '-' + to;
    if (this.cache[key]) return this.cache[key];
    var self = this;
    function node(gname) {
      var n = { name: gname, opening: 0, debit: 0, credit: 0, closing: 0, groups: [], ledgers: [], nature: self.groups[gname] ? self.groups[gname].nature : 'U' };
      (self.groupKids[gname] || []).sort().forEach(function (k) { var c = node(k); n.groups.push(c); add(n, c); });
      (self.groupLedgers[gname] || []).sort().forEach(function (l) { var b = self.ledgerBalance(l, from, to); b.name = l; n.ledgers.push(b); add(n, b); });
      return n;
    }
    function add(n, c) { n.opening += c.opening; n.debit += c.debit; n.credit += c.credit; n.closing += c.closing; }
    var roots = this.rootGroups.map(node);
    var primaryLedgers = (this.groupLedgers[''] || []).map(function (l) { var b = self.ledgerBalance(l, from, to); b.name = l; b.nature = self.ledgers[l].nature; return b; });
    var byName = {};
    (function walk(list) { list.forEach(function (n) { byName[n.name] = n; walk(n.groups); }); })(roots);
    var t = { roots: roots, primaryLedgers: primaryLedgers, byName: byName };
    this.cache[key] = t;
    return t;
  };
  Book.prototype.groupTotal = function (gname, from, to) {
    var t = this.tree(from, to);
    return t.byName[gname] ? t.byName[gname].closing : 0;
  };

  // Sum of period movement (credit - debit) across ledgers of a nature set.
  Book.prototype.natureMovement = function (natures, from, to) {
    var t = this.tree(from, to), sum = 0;
    t.roots.forEach(function (n) { if (natures.indexOf(n.nature) !== -1) sum += n.credit - n.debit; });
    t.primaryLedgers.forEach(function (l) { if (natures.indexOf(l.nature) !== -1) sum += l.credit - l.debit; });
    return sum;
  };

  Book.prototype.summary = function (from, to) {
    var t = this.tree(from, to), self = this;
    function g(name) { return t.byName[name] ? t.byName[name] : { closing: 0, debit: 0, credit: 0 }; }
    var sales = g('Sales Accounts'), purch = g('Purchase Accounts');
    var dirInc = g('Direct Incomes'), indInc = g('Indirect Incomes'), dirExp = g('Direct Expenses'), indExp = g('Indirect Expenses');
    var s = {
      cash: -g('Cash-in-Hand').closing,
      bank: -(g('Bank Accounts').closing + g('Bank OD A/c').closing),
      receivables: 0, payables: 0,
      sales: sales.credit - sales.debit,
      purchases: purch.debit - purch.credit,
      directIncome: dirInc.credit - dirInc.debit,
      indirectIncome: indInc.credit - indInc.debit,
      directExpense: dirExp.debit - dirExp.credit,
      indirectExpense: indExp.debit - indExp.credit
    };
    s.grossProfit = s.sales + s.directIncome - s.purchases - s.directExpense;
    s.netProfit = this.natureMovement(['I', 'E'], from, to);
    s.expenses = s.directExpense + s.indirectExpense;
    var debtors = [], creditors = [];
    this.ledgerNames.forEach(function (n) {
      var led = self.ledgers[n];
      if (led.chain.indexOf('Sundry Debtors') !== -1 || led.chain.indexOf('Sundry Creditors') !== -1) {
        var b = self.ledgerBalance(n, from, to);
        if (Math.abs(b.closing) < 0.005) return;
        if (led.chain.indexOf('Sundry Debtors') !== -1) { debtors.push({ name: n, closing: b.closing }); if (b.closing < 0) s.receivables += -b.closing; }
        else { creditors.push({ name: n, closing: b.closing }); if (b.closing > 0) s.payables += b.closing; }
      }
    });
    debtors.sort(function (a, b) { return a.closing - b.closing; });
    creditors.sort(function (a, b) { return b.closing - a.closing; });
    s.debtors = debtors; s.creditors = creditors;
    s.monthly = this.monthly(from, to);
    return s;
  };

  Book.prototype.monthly = function (from, to) {
    var months = {}, self = this;
    for (var i = 0; i < this.vouchers.length; i++) {
      var v = this.vouchers[i];
      if (!v.affects || v.date < from || v.date > to) continue;
      var mk = Math.floor(v.date / 100);
      var m = months[mk] || (months[mk] = { month: mk, sales: 0, purchases: 0, expenses: 0, income: 0, receipts: 0, payments: 0, count: 0 });
      m.count++;
      if (v.base === 'Receipt') m.receipts += v.total;
      if (v.base === 'Payment') m.payments += v.total;
      for (var k = 0; k < v.entries.length; k++) {
        var e = v.entries[k], led = self.ledgers[e.ledger];
        if (!led) continue;
        if (led.root === 'Sales Accounts') m.sales += e.amount;
        else if (led.root === 'Purchase Accounts') m.purchases -= e.amount;
        else if (led.nature === 'E') m.expenses -= e.amount;
        else if (led.nature === 'I') m.income += e.amount;
      }
    }
    return Object.keys(months).map(function (k) { return months[k]; }).sort(function (a, b) { return a.month - b.month; });
  };

  Book.prototype.vouchersIn = function (from, to, opts) {
    opts = opts || {};
    var out = [], q = (opts.q || '').toLowerCase();
    for (var i = 0; i < this.vouchers.length; i++) {
      var v = this.vouchers[i];
      if (v.date < from || v.date > to) continue;
      if (opts.type && v.type !== opts.type) continue;
      if (opts.base && v.base !== opts.base) continue;
      if (q) {
        var hay = (v.party + ' ' + v.narration + ' ' + v.number + ' ' + v.ref + ' ' + v.type + ' ' + v.total + (v.cancelled ? ' cancelled' : '') + (v.optional ? ' optional' : '')).toLowerCase();
        if (hay.indexOf(q) === -1) {
          var hit = false;
          for (var k = 0; k < v.entries.length && !hit; k++) if (v.entries[k].ledger.toLowerCase().indexOf(q) !== -1) hit = true;
          for (k = 0; k < v.items.length && !hit; k++) if (v.items[k].item.toLowerCase().indexOf(q) !== -1) hit = true;
          if (!hit) continue;
        }
      }
      out.push(v);
    }
    return out;
  };

  // Ledger statement rows with running balance. "contra" lists the ledgers on the
  // opposite side of the voucher (what Tally shows under Particulars); "others"
  // is their names, falling back to every other ledger when sides cannot be told.
  Book.prototype.ledgerStatement = function (name, from, to) {
    var b = this.ledgerBalance(name, from, to), ent = this.ledgerEntries[name] || [], rows = [], run = b.opening;
    for (var i = 0; i < ent.length; i++) {
      var e = ent[i];
      if (e.d < from) continue;
      if (e.d > to) break;
      run += e.a;
      var v = this.vouchers[e.v], contra = [], same = [];
      for (var k = 0; k < v.entries.length; k++) {
        var x = v.entries[k];
        if (x.ledger === name) continue;
        if ((x.amount < 0) !== (e.a < 0)) contra.push({ ledger: x.ledger, amount: x.amount });
        else same.push({ ledger: x.ledger, amount: x.amount });
      }
      if (!contra.length) contra = same;
      var others = [];
      contra.forEach(function (c) { if (others.indexOf(c.ledger) === -1) others.push(c.ledger); });
      rows.push({ date: e.d, amount: e.a, balance: run, voucher: v, others: others, contra: contra });
    }
    return { balance: b, rows: rows };
  };

  // Next voucher number for a type (numeric part of the highest existing number + 1)
  Book.prototype.nextNumber = function (type) {
    var max = 0;
    for (var i = 0; i < this.vouchers.length; i++) {
      var v = this.vouchers[i];
      if (v.type !== type) continue;
      var m = /(\d+)\s*$/.exec(String(v.number || ''));
      if (m && +m[1] > max) max = +m[1];
    }
    return max + 1;
  };

  // Bill-wise outstanding for a party (from bill allocations)
  Book.prototype.bills = function (name, to) {
    var bills = {}, ent = this.ledgerEntries[name] || [], order = [];
    for (var i = 0; i < ent.length; i++) {
      var e = ent[i]; if (e.d > to) break;
      var v = this.vouchers[e.v];
      for (var k = 0; k < v.entries.length; k++) {
        var x = v.entries[k];
        if (x.ledger !== name || !x.bills) continue;
        x.bills.forEach(function (bl) {
          var key = bl.type === 'On Account' ? 'On Account' : bl.name;
          if (!bills[key]) { bills[key] = { name: key, amount: 0, date: e.d, type: bl.type }; order.push(key); }
          bills[key].amount += bl.amount;
        });
      }
    }
    return order.map(function (k) { return bills[k]; }).filter(function (b) { return Math.abs(b.amount) >= 0.005; });
  };

  /* ---- Stock -------------------------------------------------------------- */

  Book.prototype.buildStock = function () {
    var items = {}, d = this.data, name;
    for (name in d.stockItems) {
      var si = d.stockItems[name];
      items[name] = { name: name, unit: si.unit || '', group: isPrimary(si.parent) ? '' : si.parent, openingQty: si.openingQty || 0, openingValue: -(si.openingValue || 0), moves: [] };
    }
    for (var i = 0; i < this.vouchers.length; i++) {
      var v = this.vouchers[i];
      if (v.cancelled || v.optional || !v.items.length) continue;
      var dir = STOCK_DIR[v.base];
      var isSJ = v.base === 'Stock Journal';
      if (dir === undefined && !isSJ) continue;
      for (var k = 0; k < v.items.length; k++) {
        var it = v.items[k];
        var dd = it.dir === 'in' ? 1 : it.dir === 'out' ? -1 : dir;
        if (!dd) continue;
        if (TRACKED_PAIR[v.base] && it.tracking && !/not applicable/i.test(it.tracking)) continue; // moved by the note already
        var q = it.qty; if (q < 0) { q = -q; dd = -dd; }
        if (!items[it.item]) items[it.item] = { name: it.item, unit: it.unit, group: '', openingQty: 0, openingValue: 0, moves: [], implicit: true };
        if (!items[it.item].unit) items[it.item].unit = it.unit;
        items[it.item].moves.push({ d: v.date, q: q * dd, value: Math.abs(it.amount), v: i });
      }
    }
    for (name in items) items[name].moves.sort(function (a, b) { return a.d - b.d || a.v - b.v; });
    this.stock = items;
    this.stockNames = Object.keys(items).sort(function (a, b) { return a.localeCompare(b); });
  };
  Book.prototype.stockSummary = function (from, to) {
    var self = this;
    return this.stockNames.map(function (n) {
      var it = self.stock[n], r = { name: n, unit: it.unit, group: it.group, opening: it.openingQty, inward: 0, outward: 0, inValue: 0, outValue: 0, openingValue: it.openingValue };
      it.moves.forEach(function (m) {
        if (m.d < from) r.opening += m.q;
        else if (m.d <= to) { if (m.q > 0) { r.inward += m.q; r.inValue += m.value; } else { r.outward += -m.q; r.outValue += m.value; } }
      });
      r.closing = r.opening + r.inward - r.outward;
      return r;
    });
  };
  Book.prototype.stockMoves = function (name, from, to) {
    var it = this.stock[name], self = this, run = it.openingQty, rows = [];
    it.moves.forEach(function (m) {
      if (m.d < from) { run += m.q; return; }
      if (m.d > to) return;
      run += m.q;
      rows.push({ date: m.d, qty: m.q, value: m.value, balance: run, voucher: self.vouchers[m.v] });
    });
    return { opening: it.openingQty, rows: rows, closing: run };
  };

  /* ---- Periods ------------------------------------------------------------ */

  function fyOf(d) { var y = Math.floor(d / 10000), m = Math.floor(d / 100) % 100; return m >= 4 ? y : y - 1; }
  function fyRange(fy) { return { from: fy * 10000 + 401, to: (fy + 1) * 10000 + 331, label: 'FY ' + fy + '-' + String(fy + 1).slice(2) }; }
  Book.prototype.periods = function () {
    var out = [];
    if (!this.minDate) return out;
    for (var fy = fyOf(this.maxDate); fy >= fyOf(this.minDate); fy--) out.push(fyRange(fy));
    return out;
  };

  root.TVModel = { Book: Book, mergeImport: mergeImport, emptyData: emptyData, NATURE: NATURE, fyOf: fyOf, fyRange: fyRange, voucherKey: voucherKey, NON_ACCOUNTING: NON_ACCOUNTING };
})(typeof self !== 'undefined' ? self : globalThis);
