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
  function schemaVersion() { return root.TV_DATA_SCHEMA || 2; }
  function emptyData(id) {
    return { id: id, schema: schemaVersion(), groups: {}, ledgers: {}, stockItems: {}, stockGroups: {}, units: {}, voucherTypes: {}, vouchers: [], files: [] };
  }
  // Fill in anything an older stored record lacks and stamp the schema number. Mutates and returns data.
  var MASTER_KEYS = ['groups', 'ledgers', 'stockItems', 'stockGroups', 'units', 'voucherTypes'];
  function migrate(data) {
    if (!data || typeof data !== 'object') data = emptyData('');
    for (var i = 0; i < MASTER_KEYS.length; i++) { var k = MASTER_KEYS[i]; if (!data[k] || typeof data[k] !== 'object' || Array.isArray(data[k])) data[k] = {}; }
    if (!Array.isArray(data.vouchers)) data.vouchers = [];
    if (!Array.isArray(data.files)) data.files = [];
    for (i = 0; i < data.vouchers.length; i++) { var v = data.vouchers[i]; if (!Array.isArray(v.entries)) v.entries = []; if (!Array.isArray(v.items)) v.items = []; }
    data.schema = schemaVersion();
    return data;
  }
  // A folder import is a full snapshot of the company: drop every master and every Tally voucher,
  // keep what was entered in this app. Tally vouchers that were matched to a posted app entry
  // (fromApp) revert to their app form so the invoice/IRN data survives and the next import can
  // match them again.
  function resetForSnapshot(data) {
    for (var i = 0; i < MASTER_KEYS.length; i++) data[MASTER_KEYS[i]] = {};
    var keep = [];
    for (i = 0; i < data.vouchers.length; i++) {
      var v = data.vouchers[i];
      if (v.source === 'app') { keep.push(v); continue; }
      if (v.fromApp && v.appId) {
        v.id = v.appId; v.source = 'app'; v.posted = true; v.postedAt = v.postedAt || Date.now();
        delete v.fromApp; delete v.appId; delete v.tallyId;
        keep.push(v);
      }
    }
    data.vouchers = keep;
    data.snapshotAt = Date.now();
    return data;
  }

  /* ---- Merging an import into stored data ------------------------------- */

  function debitTotal(v) {
    var total = 0, ent = v.entries || [];
    for (var i = 0; i < ent.length; i++) if (ent[i].amount < 0) total += -ent[i].amount;
    return Math.round(total * 100) / 100;
  }
  function voucherKey(v) {
    if (v.id) return v.id;
    return 'k|' + v.date + '|' + v.type + '|' + v.number + '|' + debitTotal(v).toFixed(2);
  }
  // Content key used to recognise the same transaction coming back from Tally with a different id.
  function compositeKey(v) {
    return v.date + '|' + v.type + '|' + String(v.number || '').trim().toLowerCase() + '|' + debitTotal(v).toFixed(2);
  }
  var COLL = new Intl.Collator(undefined, { numeric: true });
  function voucherSort(a, b) { return a.date - b.date || COLL.compare(String(a.number || ''), String(b.number || '')); }
  // Carry what the app knows about a voucher onto the copy that came back from Tally.
  function carryApp(v, old) {
    v.appId = old.appId || old.id;
    if (old.invoice) v.invoice = old.invoice;
    if (old.createdAt) v.createdAt = old.createdAt;
    if (old.postedAt) v.postedAt = old.postedAt;
    v.fromApp = true;
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
      vouchers: { added: 0, updated: 0, deleted: 0, matched: 0 }
    };
    var idx = {}, appIdx = {};
    data.vouchers.forEach(function (v, i) {
      idx[voucherKey(v)] = i;
      if (v.source === 'app' && v.posted) appIdx[compositeKey(v)] = i;
    });
    var removed = {};
    result.vouchers.forEach(function (v) {
      var k = voucherKey(v);
      if (v.action === 'Delete') { if (idx[k] !== undefined) { removed[idx[k]] = true; counts.vouchers.deleted++; } return; }
      delete v.action;
      if (idx[k] !== undefined) {
        var prev = data.vouchers[idx[k]];
        if (prev.fromApp) carryApp(v, prev);
        data.vouchers[idx[k]] = v; counts.vouchers.updated++;
        return;
      }
      if (v.source !== 'app') {
        // An entry made here, posted to Tally and now coming back with Tally's id: replace it in place.
        var ck = compositeKey(v), ai = appIdx[ck];
        if (ai !== undefined) {
          var old = data.vouchers[ai];
          carryApp(v, old);
          data.vouchers[ai] = v;
          delete idx[voucherKey(old)]; idx[k] = ai; delete appIdx[ck];
          counts.vouchers.matched++;
          return;
        }
      }
      idx[k] = data.vouchers.length; data.vouchers.push(v); counts.vouchers.added++;
    });
    if (counts.vouchers.deleted) data.vouchers = data.vouchers.filter(function (v, i) { return !removed[i]; });
    data.vouchers.sort(voucherSort);
    if (fileMeta) data.files.push({ name: fileMeta.name, bytes: fileMeta.bytes, at: Date.now(), counts: counts, company: result.company || '' });
    return counts;
  }

  /* ---- Book --------------------------------------------------------------- */

  function Book(data) {
    this.data = migrate(data);
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
    // content keys of every Tally voucher, so a posted app entry that already came back from Tally is not counted twice
    var tallyKeys = {}, i, k, v;
    for (i = 0; i < d.vouchers.length; i++) { v = d.vouchers[i]; if (v.source !== 'app') tallyKeys[compositeKey(v)] = i; }
    for (i = 0; i < d.vouchers.length; i++) {
      v = d.vouchers[i];
      v.idx = i;
      v.base = this.baseType(v.type);
      v.affects = !v.cancelled && !v.optional && !NON_ACCOUNTING[v.base];
      v.total = debitTotal(v);
      if (v.source === 'app') {
        v.superseded = !!(v.posted && tallyKeys[compositeKey(v)] !== undefined);
        if (v.superseded) v.affects = false;
      }
      // lowercased search haystack, kept off the stored record (non-enumerable → not persisted or backed up)
      var hay = (v.party || '') + ' ' + (v.narration || '') + ' ' + (v.number || '') + ' ' + (v.ref || '') + ' ' + v.type + ' ' + v.total + (v.cancelled ? ' cancelled' : '') + (v.optional ? ' optional' : '');
      for (k = 0; k < v.entries.length; k++) hay += ' ' + v.entries[k].ledger;
      for (k = 0; k < v.items.length; k++) hay += ' ' + v.items[k].item;
      Object.defineProperty(v, 'hay', { value: hay.toLowerCase(), writable: true, configurable: true, enumerable: false });
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
    var opening = led ? led.opening : 0, debit = 0, credit = 0, count = 0;
    for (var i = 0; i < ent.length; i++) {
      var e = ent[i];
      if (e.d < from) opening += e.a;
      else if (e.d <= to) { if (e.a < 0) debit += -e.a; else credit += e.a; count++; }
      else break;
    }
    return { opening: opening, debit: debit, credit: credit, closing: opening + credit - debit, count: count };
  };

  // Sum of every ledger's opening balance (signed): non-zero when the opening balances in Tally do not tie.
  Book.prototype.openingDifference = function () {
    var sum = 0;
    for (var name in this.ledgers) sum += this.ledgers[name].opening || 0;
    return Math.round(sum * 100) / 100;
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
    var ck = 's:' + from + '-' + to;
    if (this.cache[ck]) return this.cache[ck];
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
    this.cache[ck] = s;
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
      if (q && (v.hay || '').indexOf(q) === -1) continue;
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

  // Split a voucher number into prefix + serial + suffix. The serial is the first digit run that is
  // not part of a financial-year token (24-25, 2024-25, 2024-2025) and not a bare calendar year next
  // to another run, so 'INV/001/24-25' → 001, '25-26/RENT/023' → 023 and '2024-0001' → 0001.
  // Returns null when there is no serial.
  function isFyPair(a, b) {
    var A = +a, B = +b;
    if (b.length === 2) return (a.length === 2 || a.length === 4) && (A + 1) % 100 === B;
    if (b.length === 4) return a.length === 4 ? A + 1 === B : a.length === 2 && 2000 + A + 1 === B;
    return false;
  }
  function splitNumber(s) {
    s = String(s == null ? '' : s).trim();
    var runs = [], re = /\d+/g, m;
    while ((m = re.exec(s))) runs.push({ s: m[0], start: m.index, end: m.index + m[0].length, fy: false });
    for (var i = 0; i + 1 < runs.length; i++) {
      if (runs[i].end + 1 === runs[i + 1].start && s.charAt(runs[i].end) === '-' && isFyPair(runs[i].s, runs[i + 1].s)) { runs[i].fy = runs[i + 1].fy = true; i++; }
    }
    var free = runs.filter(function (r) { return !r.fy; });
    if (free.length > 1) for (i = 0; i < free.length; i++) if (/^(?:19|20)\d\d$/.test(free[i].s)) free[i].fy = true;
    for (i = 0; i < runs.length; i++) if (!runs[i].fy) return { prefix: s.slice(0, runs[i].start), serial: runs[i].s, suffix: s.slice(runs[i].end).trim() };
    return null;
  }
  // Next voucher number for a type: the most recent voucher of the type sets the shape (prefix and
  // suffix); the highest serial within that shape is incremented, keeping its zero padding.
  // Returns '' when no voucher of the type has a serial, so the caller can ask for a number.
  Book.prototype.nextNumber = function (type) {
    var shape = null, i, v, p;
    for (i = this.vouchers.length - 1; i >= 0 && !shape; i--) { v = this.vouchers[i]; if (v.type === type && (p = splitNumber(v.number))) shape = p; }
    if (!shape) return '';
    var max = -1, width = 0;
    for (i = 0; i < this.vouchers.length; i++) {
      v = this.vouchers[i];
      if (v.type !== type || !(p = splitNumber(v.number))) continue;
      if (p.prefix !== shape.prefix || p.suffix !== shape.suffix) continue;
      if (+p.serial > max) { max = +p.serial; width = p.serial.length; }
    }
    var n = String(max + 1);
    while (n.length < width) n = '0' + n;
    return shape.prefix + n + shape.suffix;
  };

  // Month-wise summary of one ledger
  Book.prototype.ledgerMonthly = function (name, from, to) {
    var ent = this.ledgerEntries[name] || [], led = this.ledgers[name], run = led ? led.opening : 0, months = {}, order = [];
    for (var i = 0; i < ent.length; i++) {
      var e = ent[i];
      if (e.d < from) { run += e.a; continue; }
      if (e.d > to) break;
      var mk = Math.floor(e.d / 100), m = months[mk];
      if (!m) { m = months[mk] = { month: mk, debit: 0, credit: 0, closing: 0 }; order.push(mk); }
      if (e.a < 0) m.debit += -e.a; else m.credit += e.a;
      run += e.a; m.closing = run;
    }
    return { opening: led ? this.ledgerBalance(name, from, to).opening : 0, months: order.map(function (k) { return months[k]; }) };
  };

  // FIFO bill-wise outstanding for a party as on a date. side: 'debtor' (Dr increases) or 'creditor'.
  Book.prototype.ageing = function (name, asOn, side) {
    var ent = this.ledgerEntries[name] || [], led = this.ledgers[name], open = [], unapplied = 0;
    var sign = side === 'creditor' ? 1 : -1; // amounts that raise the outstanding
    var opening = led ? led.opening : 0;
    if (opening * sign > 0.005) open.push({ date: this.minDate || asOn, voucher: null, amount: Math.abs(opening), balance: Math.abs(opening) });
    else if (Math.abs(opening) > 0.005) unapplied += Math.abs(opening);
    for (var i = 0; i < ent.length; i++) {
      var e = ent[i];
      if (e.d > asOn) break;
      var amt = e.a * sign;
      if (amt > 0.005) open.push({ date: e.d, voucher: this.vouchers[e.v], amount: amt, balance: amt });
      else if (amt < -0.005) {
        var pay = -amt + unapplied; unapplied = 0;
        for (var k = 0; k < open.length && pay > 0.005; k++) { if (open[k].balance <= 0.005) continue; var use = Math.min(open[k].balance, pay); open[k].balance -= use; pay -= use; }
        if (pay > 0.005) unapplied += pay;
      }
    }
    if (unapplied > 0.005) { for (var j = 0; j < open.length && unapplied > 0.005; j++) { if (open[j].balance <= 0.005) continue; var u = Math.min(open[j].balance, unapplied); open[j].balance -= u; unapplied -= u; } }
    var bills = open.filter(function (b) { return b.balance > 0.005; }), total = 0;
    bills.forEach(function (b) { b.days = daysBetween(b.date, asOn); total += b.balance; });
    return { bills: bills, total: total, advance: unapplied };
  };
  function toDateObj(d) { return new Date(Date.UTC(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100)); }
  function daysBetween(a, b) { return Math.round((toDateObj(b) - toDateObj(a)) / 86400000); }
  var AGE_BUCKETS = [[0, 30], [31, 60], [61, 90], [91, 180], [181, 99999]];
  Book.prototype.ageingReport = function (asOn, side) {
    var self = this, group = side === 'creditor' ? 'Sundry Creditors' : 'Sundry Debtors', rows = [], totals = [0, 0, 0, 0, 0], grand = 0;
    this.ledgerNames.forEach(function (n) {
      var led = self.ledgers[n];
      if (led.chain.indexOf(group) === -1) return;
      var a = self.ageing(n, asOn, side);
      if (a.total < 0.005) return;
      var b = [0, 0, 0, 0, 0];
      a.bills.forEach(function (x) { for (var i = 0; i < AGE_BUCKETS.length; i++) if (x.days <= AGE_BUCKETS[i][1]) { b[i] += x.balance; break; } });
      for (var i = 0; i < 5; i++) totals[i] += b[i];
      grand += a.total;
      rows.push({ name: n, buckets: b, total: a.total, bills: a.bills.length, oldest: a.bills.length ? Math.max.apply(null, a.bills.map(function (x) { return x.days; })) : 0 });
    });
    rows.sort(function (a, b) { return b.total - a.total; });
    return { rows: rows, totals: totals, grand: grand, buckets: AGE_BUCKETS };
  };

  // Key financial ratios for the period (movement) and as on its end (balances)
  Book.prototype.ratios = function (from, to) {
    var t = this.tree(from, to), s = this.summary(from, to);
    function g(name) { return t.byName[name] ? t.byName[name].closing : 0; }
    var ca = -g('Current Assets'), cl = g('Current Liabilities'), stock = -g('Stock-in-Hand'), loans = g('Loans (Liability)');
    var plLedger = 0; t.primaryLedgers.forEach(function (l) { if (l.nature === 'P') plLedger += l.closing; });
    var revenue = 0; t.roots.forEach(function (n) { if (n.nature === 'I' || n.nature === 'E') revenue += n.closing; });
    var equity = g('Capital Account') + plLedger + revenue;
    var days = Math.max(1, daysBetween(from, to) + 1);
    var debtors = -g('Sundry Debtors'), creditors = g('Sundry Creditors');
    var pct = function (a, b) { return Math.abs(b) > 0.005 ? a / b * 100 : null; }, ratio = function (a, b) { return Math.abs(b) > 0.005 ? a / b : null; };
    return {
      workingCapital: ca - cl, currentRatio: ratio(ca, cl), quickRatio: ratio(ca - stock, cl), debtEquity: ratio(loans, equity),
      grossProfitPct: pct(s.grossProfit, s.sales), netProfitPct: pct(s.netProfit, s.sales), returnOnEquityPct: pct(s.netProfit, equity),
      receivableDays: s.sales > 0.005 ? debtors / s.sales * days : null, payableDays: s.purchases > 0.005 ? creditors / s.purchases * days : null,
      cashBank: s.cash + s.bank, equity: equity, loans: loans, currentAssets: ca, currentLiabilities: cl, sales: s.sales, purchases: s.purchases, netProfit: s.netProfit, grossProfit: s.grossProfit, days: days
    };
  };

  // GST summary: output vs input tax by month and B2B outward supplies by party
  Book.prototype.gstSummary = function (from, to) {
    var self = this, months = {}, order = [], parties = {}, porder = [], isTax = {}, kind = {};
    // A tax ledger must sit under Duties & Taxes AND be named like one (whole word gst/cgst/sgst/utgst/igst/cess,
    // a trailing rate like 'CGST9%' is fine) so 'Purchase - Accessories' or 'Bank Processing Charges' never count.
    this.ledgerNames.forEach(function (n) {
      var led = self.ledgers[n];
      if (led.chain.indexOf('Duties & Taxes') === -1) return;
      if (!/\b(?:c|s|ut|i)?gst(?![a-z])|\bcess(?![a-z])/i.test(n) || /payable|deposit|paid|refund|tds|tcs|interest|late/i.test(n)) return;
      isTax[n] = true; kind[n] = /\binput\b|\bpurch|\bitc\b/i.test(n) ? 'input' : 'output';
    });
    for (var i = 0; i < this.vouchers.length; i++) {
      var v = this.vouchers[i];
      if (!v.affects || v.date < from || v.date > to) continue;
      var mk = Math.floor(v.date / 100), m = months[mk];
      if (!m) { m = months[mk] = { month: mk, outward: 0, outputTax: 0, inward: 0, inputTax: 0 }; order.push(mk); }
      var taxable = 0, tax = 0, isSale = v.base === 'Sales' || v.base === 'Credit Note', isPurchase = v.base === 'Purchase' || v.base === 'Debit Note';
      if (!isSale && !isPurchase) continue; // GST figures come from supply vouchers only; adjustment journals are not counted
      for (var k = 0; k < v.entries.length; k++) {
        var e = v.entries[k], led = self.ledgers[e.ledger];
        if (!led) continue;
        if (isTax[e.ledger]) { if (isSale) m.outputTax += e.amount; else m.inputTax += -e.amount; tax += e.amount; }
        else if (led.root === 'Sales Accounts') { m.outward += e.amount; taxable += e.amount; }
        else if (led.root === 'Purchase Accounts') m.inward += -e.amount;
      }
      if (isSale && v.party) {
        var pl = self.ledgers[v.party], gstin = pl && pl.info ? (pl.info.gstin || '') : '';
        var key = v.party, p = parties[key];
        if (!p) { p = parties[key] = { party: v.party, gstin: gstin, taxable: 0, tax: 0, count: 0 }; porder.push(key); }
        p.taxable += taxable; p.tax += tax; p.count++;
      }
    }
    var ms = order.map(function (k) { var x = months[k]; x.net = x.outputTax - x.inputTax; return x; });
    return { months: ms, parties: porder.map(function (k) { return parties[k]; }).sort(function (a, b) { return b.taxable - a.taxable; }), taxLedgers: Object.keys(isTax).map(function (n) { return { name: n, kind: kind[n] }; }) };
  };

  // Monthly cash flow across cash and bank ledgers. Each voucher contributes the net of its cash/bank
  // side as one inflow or outflow; contra vouchers and transfers between cash/bank ledgers are excluded.
  Book.prototype.cashFlow = function (from, to) {
    var self = this, months = {}, order = [], isCash = {};
    this.ledgerNames.forEach(function (n) { var c = self.ledgers[n].chain; if (c.indexOf('Cash-in-Hand') !== -1 || c.indexOf('Bank Accounts') !== -1 || c.indexOf('Bank OD A/c') !== -1) isCash[n] = true; });
    for (var i = 0; i < this.vouchers.length; i++) {
      var v = this.vouchers[i];
      if (!v.affects || v.date < from || v.date > to) continue;
      var mk = Math.floor(v.date / 100), m = months[mk];
      if (!m) { m = months[mk] = { month: mk, inflow: 0, outflow: 0, net: 0 }; order.push(mk); }
      if (v.base === 'Contra') continue;
      var net = 0, hasOther = false;
      for (var k = 0; k < v.entries.length; k++) { var e = v.entries[k]; if (isCash[e.ledger]) net += e.amount; else hasOther = true; }
      if (!hasOther) continue;
      if (net < -0.005) m.inflow += -net; else if (net > 0.005) m.outflow += net;
      m.net = m.inflow - m.outflow;
    }
    return order.map(function (k) { return months[k]; });
  };

  // Ranked lists for the dashboard
  Book.prototype.topExpenses = function (from, to, n) {
    var self = this, out = [];
    this.ledgerNames.forEach(function (name) { var led = self.ledgers[name]; if (led.nature !== 'E') return; var b = self.ledgerBalance(name, from, to), mv = b.debit - b.credit; if (mv > 0.005) out.push({ name: name, amount: mv }); });
    return out.sort(function (a, b) { return b.amount - a.amount; }).slice(0, n || 5);
  };
  Book.prototype.topParties = function (from, to, base, n) {
    var tot = {}, order = [];
    for (var i = 0; i < this.vouchers.length; i++) {
      var v = this.vouchers[i];
      if (!v.affects || v.base !== base || v.date < from || v.date > to || !v.party) continue;
      if (!tot[v.party]) { tot[v.party] = 0; order.push(v.party); }
      tot[v.party] += v.total;
    }
    return order.map(function (p) { return { name: p, amount: tot[p] }; }).sort(function (a, b) { return b.amount - a.amount; }).slice(0, n || 5);
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
  // Opening and closing stock value for the period at weighted average cost
  // (rate = (opening value + inward value) / (opening qty + inward qty) per item). null when no item carries values.
  Book.prototype.stockValuation = function (from, to) {
    var rows = this.stockSummary(from, to), opening = 0, closing = 0, hasValue = false;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], ov = Math.abs(r.openingValue || 0), iv = r.inValue || 0, denom = r.opening + r.inward;
      if (ov + iv > 0.005) hasValue = true;
      if (!(denom > 0)) continue;
      var rate = (ov + iv) / denom;
      opening += r.opening * rate;
      closing += r.closing * rate;
    }
    if (!hasValue) return null;
    return { opening: Math.round(opening * 100) / 100, closing: Math.round(closing * 100) / 100, method: 'weighted average' };
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
  // yyyymm → yyyymmdd of the last day of that month
  function monthEnd(yyyymm) { var y = Math.floor(yyyymm / 100), m = yyyymm % 100; return yyyymm * 100 + new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  Book.prototype.periods = function () {
    var out = [];
    if (!this.minDate) return out;
    for (var fy = fyOf(this.maxDate); fy >= fyOf(this.minDate); fy--) out.push(fyRange(fy));
    return out;
  };

  root.TVModel = { Book: Book, mergeImport: mergeImport, emptyData: emptyData, NATURE: NATURE, fyOf: fyOf, fyRange: fyRange, voucherKey: voucherKey, NON_ACCOUNTING: NON_ACCOUNTING,
    compositeKey: compositeKey, voucherSort: voucherSort, resetForSnapshot: resetForSnapshot, migrate: migrate, monthEnd: monthEnd, splitNumber: splitNumber };
})(typeof self !== 'undefined' ? self : globalThis);
