/* Senior-level feature pack: actions bar, WhatsApp sharing, confirmation letters, pinned ledgers,
 * dashboard rankings, extra Tally reports (ratios, ageing, GST, cash flow, comparative P&L),
 * report exports, duplicate entries, backup/restore and app lock. Uses the TVApp bridge. */
(function () {
  'use strict';
  var A = window.TVApp, S = A.S, esc = A.esc, fmt = A.fmt, toast = A.toast, go = A.go;
  var I = {
    excel: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 9l8 8M16 9l-8 8"/></svg>',
    pdf: '<svg viewBox="0 0 24 24"><path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/><path d="M9 14h6M9 17h4"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24"><path d="M4 20l1.3-3.9A8 8 0 1 1 8.2 19z"/><path d="M9.5 9.5c.3 2 2.2 4 4.5 4.8l1.2-1.2 2 1-.5 1.6c-3.6.6-7.8-3.3-8.3-7l1.6-.6 1 2z"/></svg>',
    letter: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 3l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.4 6.7 19.1l1-5.8-4.2-4.1 5.9-.9z"/></svg>',
    share: '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.6M8.2 13.2l7.6 4.6"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16z"/><path d="M12.5 7.5l4 4"/></svg>',
    xml: '<svg viewBox="0 0 24 24"><path d="M8 7l-4 5 4 5M16 7l4 5-4 5M13 5l-2 14"/></svg>',
    post: '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    backup: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 21h16"/></svg>',
    restore: '<svg viewBox="0 0 24 24"><path d="M12 21V9M7 14l5-5 5 5"/><path d="M4 3h16"/></svg>',
    irn: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h3v3h3v3h-6z"/></svg>'
  };
  function actions(items) { return '<div class="actions">' + items.map(function (it) { return '<button class="act' + (it.cls ? ' ' + it.cls : '') + '" data-faction="' + esc(it.key) + '"><span class="ico">' + (I[it.icon] || '') + '</span>' + esc(it.label) + '</button>'; }).join('') + '</div>'; }
  function digits(ph) { var d = String(ph || '').replace(/[^0-9]/g, ''); if (d.length === 10) d = '91' + d; return d; }
  function company() { var st = A.companySettings ? A.companySettings() : {}; return { name: S.company.name, address: [st.address1, st.address2, st.city, st.pin].filter(Boolean).join(', '), gstin: st.gstin, phone: st.phone }; }
  function blobToB64(blob) { return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(String(fr.result).split(',')[1] || ''); }; fr.onerror = rej; fr.readAsDataURL(blob); }); }

  /* ---- sharing ---------------------------------------------------------- */
  // o: { name, blob?, text?, phone? }, target: 'whatsapp' | 'any'
  function share(target, o) {
    var bridge = window.TallyBridge;
    if (bridge && typeof bridge.shareFile === 'function') {
      return (o.blob ? blobToB64(o.blob) : Promise.resolve('')).then(function (b64) {
        return new Promise(function (resolve, reject) {
          window.__tvSavePending = window.__tvSavePending || {}; window.__tvSavePending[o.name] = { resolve: resolve, reject: reject };
          bridge.shareFile(o.name, o.blob ? o.blob.type : 'text/plain', b64, target === 'whatsapp' ? 'whatsapp' : '', o.phone || '', o.text || '');
        });
      }).then(function (r) { toast(r.where || 'Shared', 3500); });
    }
    // browser: download the file (if any) and open WhatsApp with the text
    var p = o.blob ? TVExport.save(o.name, o.blob) : Promise.resolve();
    return p.then(function () {
      if (target === 'whatsapp') {
        var d = digits(o.phone), url = 'https://wa.me/' + (d ? d : '') + '?text=' + encodeURIComponent((o.text || '') + (o.blob ? '\n\n(' + o.name + ' downloaded - attach it in WhatsApp)' : ''));
        window.open(url, '_blank');
      } else if (navigator.share) navigator.share({ title: o.name, text: o.text || o.name }).catch(function () { /* ignore */ });
      toast(o.blob ? 'File ready: ' + o.name : 'Opened WhatsApp', 3500);
    });
  }
  function whatsappSheet(o) {
    // o: { title, phone, options: [{label, hint, build: () => Promise<{name, blob?, text}>}] }
    var h = '<h3>' + esc(o.title) + '</h3><div class="field"><label>WhatsApp number</label><input id="wa-phone" inputmode="tel" placeholder="98XXXXXXXX (blank = pick a contact)" value="' + esc(o.phone || '') + '"></div>' +
      '<div class="list">' + o.options.map(function (op, i) { return '<button class="row" data-wa="' + i + '"><span class="badge" data-base="Receipt">WA</span><div class="main"><div class="t">' + esc(op.label) + '</div>' + (op.hint ? '<div class="s">' + esc(op.hint) + '</div>' : '') + '</div><span class="chev">›</span></button>'; }).join('') + '</div>' +
      '<p class="small muted">In the Android app the file opens directly in WhatsApp' + (o.phone ? ' for this contact' : '') + '. In a browser the file downloads and WhatsApp opens with the message.</p>';
    A.sheet(h, function (ev, bg) {
      var row = ev.target.closest('[data-wa]'); if (!row) return;
      var phone = document.getElementById('wa-phone').value.trim(); bg.remove();
      var op = o.options[+row.getAttribute('data-wa')];
      toast('Preparing…', 1500);
      Promise.resolve(op.build()).then(function (r) { r.phone = phone; return share('whatsapp', r); }).catch(function (e) { toast('Could not share: ' + e.message, 5000); });
    });
  }

  /* ---- pinned ledgers ---------------------------------------------------- */
  function pins() { return A.lsGet('tv.pins.' + S.company.id, []); }
  function setPins(p) { A.lsSet('tv.pins.' + S.company.id, p); }
  function togglePin(name) { var p = pins(), i = p.indexOf(name); if (i >= 0) p.splice(i, 1); else p.unshift(name); setPins(p.slice(0, 8)); toast(i >= 0 ? 'Unpinned' : 'Pinned to Home'); A.render(); }

  /* ---- ledger page ------------------------------------------------------- */
  function ledgerCtx(name) {
    var b = S.book, p = S.period, led = b.ledgers[name], st = b.ledgerStatement(name, p.from, p.to), info = led.info || {};
    return { company: company(), party: { name: name, address: info.address || '', gstin: info.gstin || '', phone: info.phone || '' }, from: p.from, to: p.to, statement: st, kind: led.chain.indexOf('Sundry Creditors') !== -1 ? 'creditor' : 'debtor', led: led };
  }
  function ledgerActions(name, led) {
    var pinned = pins().indexOf(name) !== -1;
    return actions([
      { key: 'ledger-wa:' + name, icon: 'whatsapp', label: 'WhatsApp', cls: 'wa' },
      { key: 'ledger-xlsx:' + name, icon: 'excel', label: 'Excel' },
      { key: 'ledger-pdf:' + name, icon: 'pdf', label: 'PDF' },
      { key: 'ledger-letter:' + name, icon: 'letter', label: 'Confirmation' },
      { key: 'ledger-pin:' + name, icon: 'pin', label: pinned ? 'Pinned' : 'Pin', cls: pinned ? 'on' : '' }
    ]);
  }
  function ledgerMonthlyCard(name) {
    var m = S.book.ledgerMonthly(name, S.period.from, S.period.to);
    if (!m.months.length) return '';
    return '<details class="card" style="padding:0"><summary style="list-style:none;padding:14px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center"><span style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text-3)">Monthly summary</span><span class="chev">▾</span></summary><div style="padding:0 16px 14px"><table class="tbl"><tr><th>Month</th><th class="n">Debit</th><th class="n">Credit</th><th class="n">Closing</th></tr>' +
      m.months.map(function (x) { return '<tr><td>' + A.fmtMonth(x.month) + '</td><td class="n">' + (x.debit ? fmt(x.debit) : '') + '</td><td class="n">' + (x.credit ? fmt(x.credit) : '') + '</td><td class="n">' + A.bal(x.closing) + '</td></tr>'; }).join('') + '</table></div></details>';
  }
  function ledgerWhatsapp(name) {
    var c = ledgerCtx(name);
    whatsappSheet({ title: 'Send ' + name, phone: c.party.phone, options: [
      { label: 'PDF statement', hint: 'Ledger for ' + A.fmtDate(c.from) + ' – ' + A.fmtDate(c.to), build: function () { var e = A.buildLedgerExport(name, 'pdf'); return { name: e.name, blob: e.blob, text: TVEntry.ledgerSummaryText(c) }; } },
      { label: 'Excel statement', hint: 'Same statement as a spreadsheet', build: function () { var e = A.buildLedgerExport(name, 'xlsx'); return { name: e.name, blob: e.blob, text: TVEntry.ledgerSummaryText(c) }; } },
      { label: 'Confirmation of account', hint: 'Balance confirmation letter (PDF)', build: function () { return { name: TVExport.safeName(S.company.name + ' - Confirmation - ' + name + '.pdf'), blob: TVEntry.confirmationPdf(c, TVExport), text: 'Please find attached the confirmation of account from ' + c.company.name + '.' }; } },
      { label: 'Balance summary (text only)', hint: 'Opening, debits, credits, closing', build: function () { return { name: 'summary', text: TVEntry.ledgerSummaryText(c) }; } },
      { label: 'Payment reminder (text only)', hint: 'Polite reminder for the outstanding amount', build: function () { return { name: 'reminder', text: TVEntry.reminderText(c) }; } }
    ] });
  }

  /* ---- reports ----------------------------------------------------------- */
  var SECTIONS = [
    ['Accounts', ['tb', 'pl', 'plcmp', 'bs', 'ratios', 'cashbank', 'cashflow']],
    ['Outstanding', ['receivables', 'payables', 'ageing', 'ageingc']],
    ['Statutory', ['gst']],
    ['Inventory & registers', ['stock', 'monthly', 'register']]
  ];
  var RICON = { tb: 'ledger', pl: 'profit', plcmp: 'report', bs: 'bank', ratios: 'profit', cashbank: 'cash', cashflow: 'cash', receivables: 'receivable', payables: 'payable', ageing: 'receivable', ageingc: 'payable', gst: 'ledger', stock: 'expense', monthly: 'report', register: 'vouchers' };
  A.REPORTS.push(['plcmp', 'Comparative P&L', 'This period against the same period last year'], ['ratios', 'Ratio Analysis', 'Liquidity, leverage, margins, collection days'], ['cashflow', 'Cash Flow', 'Monthly inflow and outflow across cash and bank'], ['ageing', 'Receivables Ageing', 'Bill-wise outstanding by age, FIFO'], ['ageingc', 'Payables Ageing', 'What you owe, by age'], ['gst', 'GST Summary', 'Output vs input tax by month, B2B outward supplies']);
  function reportSections() {
    var byKey = {}; A.REPORTS.forEach(function (r) { byKey[r[0]] = r; });
    return SECTIONS.map(function (sec) {
      return '<div class="section-title">' + sec[0] + '</div><div class="list">' + sec[1].map(function (k) { var r = byKey[k]; if (!r) return ''; return '<a class="row" href="#/report/' + r[0] + '"><span class="ico" style="width:36px;height:36px;border-radius:12px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);flex:none">' + (A.ICONS[RICON[k]] || '').replace('<svg', '<svg style="width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"') + '</span><div class="main"><div class="t">' + r[1] + '</div><div class="s">' + r[2] + '</div></div><span class="chev">›</span></a>'; }).join('') + '</div>';
    }).join('');
  }
  function tableCard(cols, rows, totals, note) {
    return '<div class="card" style="overflow:auto"><table class="tbl"><tr>' + cols.map(function (c) { return '<th' + (c.align === 'r' ? ' class="n"' : '') + '>' + esc(c.title) + '</th>'; }).join('') + '</tr>' +
      rows.map(function (r) { return '<tr>' + r.map(function (v, i) { return '<td' + (cols[i].align === 'r' ? ' class="n"' : (i === 0 && cols[0].title === 'Month' ? ' style="white-space:nowrap"' : '')) + '>' + (v == null ? '' : (typeof v === 'string' && /^<\w/.test(v) ? v : esc(v))) + '</td>'; }).join('') + '</tr>'; }).join('') +
      (totals || []).map(function (r) { return '<tr class="total">' + r.map(function (v, i) { return '<td' + (cols[i].align === 'r' ? ' class="n"' : '') + '>' + (v == null ? '' : esc(v)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>' + (note ? '<p class="small muted" style="margin-top:10px">' + note + '</p>' : '') + '</div>';
  }
  var nf = function (n) { return n == null ? '' : fmt(n); };
  A.REPORT_FN.ratios = function (b, from, to) {
    var r = b.ratios(from, to), rows = [
      ['Working capital', fmt(r.workingCapital), 'Current assets − current liabilities'],
      ['Current ratio', r.currentRatio == null ? 'n/a' : r.currentRatio.toFixed(2), 'Current assets ÷ current liabilities (≥ 1.5 comfortable)'],
      ['Quick ratio', r.quickRatio == null ? 'n/a' : r.quickRatio.toFixed(2), 'Excludes stock-in-hand'],
      ['Debt to equity', r.debtEquity == null ? 'n/a' : r.debtEquity.toFixed(2), 'Loans ÷ (capital + reserves + profit)'],
      ['Gross profit', r.grossProfitPct == null ? 'n/a' : r.grossProfitPct.toFixed(1) + '%', 'Of sales, excl. stock valuation'],
      ['Net profit', r.netProfitPct == null ? 'n/a' : r.netProfitPct.toFixed(1) + '%', 'Of sales'],
      ['Return on equity', r.returnOnEquityPct == null ? 'n/a' : r.returnOnEquityPct.toFixed(1) + '%', 'Net profit ÷ equity, for the period'],
      ['Receivable days', r.receivableDays == null || r.receivableDays < 0 ? 'n/a' : Math.round(r.receivableDays) + ' days', 'Debtors ÷ sales × days in period'],
      ['Payable days', r.payableDays == null || r.payableDays < 0 ? 'n/a' : Math.round(r.payableDays) + ' days', 'Creditors ÷ purchases × days in period'],
      ['Cash & bank', fmt(r.cashBank), 'As on ' + A.fmtDate(to)]
    ];
    return '<div class="card">' + rows.map(function (x) { return '<div class="kv"><span>' + esc(x[0]) + '<div class="small faint">' + esc(x[2]) + '</div></span><span class="num" style="font-weight:700">' + esc(x[1]) + '</span></div>'; }).join('') + '</div>';
  };
  function ageingHtml(b, to, side) {
    var r = b.ageingReport(to, side), names = r.buckets.map(function (x, i) { return i === r.buckets.length - 1 ? '> ' + (r.buckets[i - 1][1]) : x[0] + '–' + x[1]; });
    if (!r.rows.length) return '<div class="empty">Nothing outstanding as on ' + A.fmtDate(to) + '.</div>';
    var cols = [{ title: 'Party' }].concat(names.map(function (n) { return { title: n + ' d', align: 'r' }; })).concat([{ title: 'Total', align: 'r' }]);
    var rows = r.rows.map(function (x) { return ['<a href="#/ledger/' + encodeURIComponent(x.name) + '">' + esc(x.name) + '</a><div class="small faint">' + x.bills + ' bill' + (x.bills === 1 ? '' : 's') + ' · oldest ' + x.oldest + ' d</div>'].concat(x.buckets.map(function (v) { return v ? fmt(v) : ''; })).concat([fmt(x.total)]); });
    var totals = [['Total'].concat(r.totals.map(function (v) { return v ? fmt(v) : ''; })).concat([fmt(r.grand)])];
    var tiles = '<div class="tiles">' + r.buckets.map(function (bk, i) { return '<div class="tile"><div class="label">' + names[i] + ' days</div><div class="value num" style="font-size:18px">' + A.compact(r.totals[i]) + '</div></div>'; }).join('') + '</div>';
    return tiles + tableCard(cols, rows, totals, 'Bills are matched first-in-first-out from the ledger entries (invoices against receipts), as on ' + A.fmtDate(to) + '. Opening balances count from the start of the books.');
  }
  A.REPORT_FN.ageing = function (b, from, to) { return ageingHtml(b, to, 'debtor'); };
  A.REPORT_FN.ageingc = function (b, from, to) { return ageingHtml(b, to, 'creditor'); };
  A.REPORT_FN.cashflow = function (b, from, to) {
    var m = b.cashFlow(from, to); if (!m.length) return '<div class="empty">No cash or bank movement in this period.</div>';
    var ti = 0, tout = 0; m.forEach(function (x) { ti += x.inflow; tout += x.outflow; });
    return '<div class="tiles"><div class="tile"><div class="label">Inflow</div><div class="value num cr" style="font-size:18px">' + A.compact(ti) + '</div></div><div class="tile"><div class="label">Outflow</div><div class="value num dr" style="font-size:18px">' + A.compact(tout) + '</div></div></div>' +
      tableCard([{ title: 'Month' }, { title: 'Inflow', align: 'r' }, { title: 'Outflow', align: 'r' }, { title: 'Net', align: 'r' }], m.map(function (x) { return [A.fmtMonth(x.month), fmt(x.inflow), fmt(x.outflow), (x.net < 0 ? '-' : '') + fmt(Math.abs(x.net))]; }), [['Total', fmt(ti), fmt(tout), (ti - tout < 0 ? '-' : '') + fmt(Math.abs(ti - tout))]], 'Across all cash, bank and bank OD ledgers.');
  };
  A.REPORT_FN.gst = function (b, from, to) {
    var g = b.gstSummary(from, to);
    if (!g.months.length) return '<div class="empty">No sales or purchase vouchers in this period.</div>';
    var to_ = 0, ti = 0, ow = 0; g.months.forEach(function (m) { to_ += m.outputTax; ti += m.inputTax; ow += m.outward; });
    var h = '<div class="tiles"><div class="tile"><div class="label">Outward supplies</div><div class="value num" style="font-size:18px">' + A.compact(ow) + '</div></div><div class="tile"><div class="label">Output tax</div><div class="value num" style="font-size:18px">' + A.compact(to_) + '</div></div><div class="tile"><div class="label">Input tax credit</div><div class="value num" style="font-size:18px">' + A.compact(ti) + '</div></div><div class="tile"><div class="label">Net payable</div><div class="value num ' + (to_ - ti < 0 ? 'cr' : '') + '" style="font-size:18px">' + A.compact(to_ - ti) + '</div></div></div>';
    h += '<div class="section-title">By month</div>' + tableCard([{ title: 'Month' }, { title: 'Outward', align: 'r' }, { title: 'Output tax', align: 'r' }, { title: 'Inward', align: 'r' }, { title: 'ITC', align: 'r' }, { title: 'Net', align: 'r' }], g.months.map(function (m) { return [A.fmtMonth(m.month), fmt(m.outward), fmt(m.outputTax), fmt(m.inward), fmt(m.inputTax), fmt(m.net)]; }), [['Total', fmt(ow), fmt(to_), '', fmt(ti), fmt(to_ - ti)]]);
    if (g.parties.length) h += '<div class="section-title">Outward supplies by party (B2B / B2C)</div>' + tableCard([{ title: 'Party' }, { title: 'GSTIN' }, { title: 'Taxable', align: 'r' }, { title: 'Tax', align: 'r' }], g.parties.map(function (p) { return ['<a href="#/ledger/' + encodeURIComponent(p.party) + '">' + esc(p.party) + '</a><div class="small faint">' + p.count + ' invoice' + (p.count === 1 ? '' : 's') + '</div>', p.gstin || '<span class="faint">B2C</span>', fmt(p.taxable), fmt(p.tax)]; }), null, 'Figures come from sales, purchase, credit note and debit note vouchers only; GST ledgers are recognised by name (' + g.taxLedgers.length + ' found). Adjustment journals are not included.');
    return h;
  };
  A.REPORT_FN.plcmp = function (b, from, to) {
    var cur = b.summary(from, to), prev = b.summary(from - 10000, to - 10000);
    var rows = [['Sales', cur.sales, prev.sales], ['Direct incomes', cur.directIncome, prev.directIncome], ['Purchases', cur.purchases, prev.purchases], ['Direct expenses', cur.directExpense, prev.directExpense], ['Gross profit', cur.grossProfit, prev.grossProfit], ['Indirect incomes', cur.indirectIncome, prev.indirectIncome], ['Indirect expenses', cur.indirectExpense, prev.indirectExpense], ['Net profit', cur.netProfit, prev.netProfit]];
    return tableCard([{ title: 'Head' }, { title: A.fmtDate(from) + ' – ' + A.fmtDate(to), align: 'r' }, { title: 'Previous year', align: 'r' }, { title: 'Change', align: 'r' }], rows.map(function (r) { var ch = Math.abs(r[2]) > 0.005 ? Math.round((r[1] - r[2]) / Math.abs(r[2]) * 100) + '%' : (r[1] ? 'new' : ''); return [(r[0] === 'Gross profit' || r[0] === 'Net profit' ? '<b>' + r[0] + '</b>' : r[0]), fmt(r[1]), fmt(r[2]), ch]; }), null, 'Previous year = the same dates one year earlier.');
  };
  // data for exports (every report)
  function reportData(key) {
    var b = S.book, p = S.period, from = p.from, to = p.to, title = (A.REPORTS.filter(function (r) { return r[0] === key; })[0] || ['', key])[1];
    var cols, rows = [], totals = [];
    // groups and ledgers with nil balances are left out, as in Tally's default view
    function live(n) { return Math.abs(n.closing) > 0.005 || n.groups.some(live) || n.ledgers.some(function (l) { return Math.abs(l.closing) > 0.005; }); }
    function flat(n, depth) { if (!live(n)) return; rows.push([(depth ? '    '.repeat(depth) : '') + n.name, Math.abs(n.closing) || null, A.drcr(n.closing)]); n.groups.forEach(function (g) { flat(g, depth + 1); }); n.ledgers.forEach(function (l) { if (Math.abs(l.closing) > 0.005) rows.push([(depth ? '    '.repeat(depth + 1) : '    ') + l.name, Math.abs(l.closing) || null, A.drcr(l.closing)]); }); }
    switch (key) {
      case 'tb': case 'bs': { var t = b.tree(from, to); cols = [{ title: 'Account', width: 44 }, { title: 'Closing', width: 16, type: 'num', align: 'r' }, { title: 'Dr/Cr', width: 6 }]; t.roots.forEach(function (n) { if (key === 'tb' || n.nature === 'L' || n.nature === 'A') flat(n, 0); }); t.primaryLedgers.forEach(function (l) { if (Math.abs(l.closing) > 0.005) rows.push([l.name, Math.abs(l.closing) || null, A.drcr(l.closing)]); }); break; }
      case 'pl': { var s = b.summary(from, to); cols = [{ title: 'Head', width: 30 }, { title: 'Amount', width: 16, type: 'num', align: 'r' }]; rows = [['Sales', s.sales], ['Direct incomes', s.directIncome], ['Purchases', s.purchases], ['Direct expenses', s.directExpense], ['Gross profit', s.grossProfit], ['Indirect incomes', s.indirectIncome], ['Indirect expenses', s.indirectExpense], ['Net profit', s.netProfit]]; break; }
      case 'plcmp': { var c1 = b.summary(from, to), c0 = b.summary(from - 10000, to - 10000); cols = [{ title: 'Head', width: 30 }, { title: 'This period', width: 16, type: 'num', align: 'r' }, { title: 'Previous year', width: 16, type: 'num', align: 'r' }]; rows = [['Sales', c1.sales, c0.sales], ['Purchases', c1.purchases, c0.purchases], ['Gross profit', c1.grossProfit, c0.grossProfit], ['Indirect incomes', c1.indirectIncome, c0.indirectIncome], ['Indirect expenses', c1.indirectExpense, c0.indirectExpense], ['Net profit', c1.netProfit, c0.netProfit]]; break; }
      case 'ratios': { var r = b.ratios(from, to); cols = [{ title: 'Ratio', width: 30 }, { title: 'Value', width: 16, align: 'r' }]; rows = [['Working capital', fmt(r.workingCapital)], ['Current ratio', r.currentRatio == null ? 'n/a' : r.currentRatio.toFixed(2)], ['Quick ratio', r.quickRatio == null ? 'n/a' : r.quickRatio.toFixed(2)], ['Debt to equity', r.debtEquity == null ? 'n/a' : r.debtEquity.toFixed(2)], ['Gross profit %', r.grossProfitPct == null ? 'n/a' : r.grossProfitPct.toFixed(1)], ['Net profit %', r.netProfitPct == null ? 'n/a' : r.netProfitPct.toFixed(1)], ['Receivable days', r.receivableDays == null ? 'n/a' : Math.round(r.receivableDays)], ['Payable days', r.payableDays == null ? 'n/a' : Math.round(r.payableDays)]]; break; }
      case 'cashbank': { cols = [{ title: 'Ledger', width: 40 }, { title: 'Closing', width: 16, type: 'num', align: 'r' }, { title: 'Dr/Cr', width: 6 }]; b.ledgerNames.forEach(function (n) { var c = b.ledgers[n].chain; if (c.indexOf('Cash-in-Hand') !== -1 || c.indexOf('Bank Accounts') !== -1 || c.indexOf('Bank OD A/c') !== -1) { var bl = b.ledgerBalance(n, from, to); if (Math.abs(bl.closing) > 0.005 || bl.count) rows.push([n, Math.abs(bl.closing) || null, A.drcr(bl.closing)]); } }); break; }
      case 'cashflow': { cols = [{ title: 'Month', width: 12 }, { title: 'Inflow', width: 16, type: 'num', align: 'r' }, { title: 'Outflow', width: 16, type: 'num', align: 'r' }, { title: 'Net', width: 16, type: 'num', align: 'r' }]; b.cashFlow(from, to).forEach(function (m) { rows.push([A.fmtMonth(m.month), m.inflow, m.outflow, m.net]); }); break; }
      case 'receivables': case 'payables': { var sm = b.summary(from, to), list = key === 'receivables' ? sm.debtors : sm.creditors; cols = [{ title: 'Party', width: 40 }, { title: 'Closing', width: 16, type: 'num', align: 'r' }, { title: 'Dr/Cr', width: 6 }]; list.forEach(function (d) { rows.push([d.name, Math.abs(d.closing), A.drcr(d.closing)]); }); break; }
      case 'ageing': case 'ageingc': { var ag = b.ageingReport(to, key === 'ageing' ? 'debtor' : 'creditor'); cols = [{ title: 'Party', width: 36 }].concat(ag.buckets.map(function (bk, i) { return { title: (i === 4 ? '>180' : bk[0] + '-' + bk[1]) + ' days', width: 13, type: 'num', align: 'r' }; })).concat([{ title: 'Total', width: 15, type: 'num', align: 'r' }]); ag.rows.forEach(function (x) { rows.push([x.name].concat(x.buckets.map(function (v) { return v || null; })).concat([x.total])); }); totals = [['Total'].concat(ag.totals).concat([ag.grand])]; break; }
      case 'gst': { var g = b.gstSummary(from, to); cols = [{ title: 'Month', width: 12 }, { title: 'Outward', width: 15, type: 'num', align: 'r' }, { title: 'Output tax', width: 15, type: 'num', align: 'r' }, { title: 'Inward', width: 15, type: 'num', align: 'r' }, { title: 'ITC', width: 15, type: 'num', align: 'r' }, { title: 'Net', width: 15, type: 'num', align: 'r' }]; g.months.forEach(function (m) { rows.push([A.fmtMonth(m.month), m.outward, m.outputTax, m.inward, m.inputTax, m.net]); }); break; }
      case 'stock': { cols = [{ title: 'Item', width: 36 }, { title: 'Unit', width: 8 }, { title: 'Opening', width: 12, type: 'num', align: 'r' }, { title: 'Inward', width: 12, type: 'num', align: 'r' }, { title: 'Outward', width: 12, type: 'num', align: 'r' }, { title: 'Closing', width: 12, type: 'num', align: 'r' }]; b.stockSummary(from, to).forEach(function (it) { rows.push([it.name, it.unit, it.opening, it.inward, it.outward, it.closing]); }); break; }
      case 'monthly': { cols = [{ title: 'Month', width: 12 }, { title: 'Sales', width: 15, type: 'num', align: 'r' }, { title: 'Purchases', width: 15, type: 'num', align: 'r' }, { title: 'Expenses', width: 15, type: 'num', align: 'r' }, { title: 'Vouchers', width: 10, type: 'num', align: 'r' }]; b.monthly(from, to).forEach(function (m) { rows.push([A.fmtMonth(m.month), m.sales, m.purchases, m.expenses, m.count]); }); break; }
      case 'register': { var byT = {}; b.vouchersIn(from, to).forEach(function (v) { var x = byT[v.type] || (byT[v.type] = { n: 0, t: 0 }); x.n++; x.t += v.total; }); cols = [{ title: 'Voucher type', width: 24 }, { title: 'Count', width: 10, type: 'num', align: 'r' }, { title: 'Total', width: 16, type: 'num', align: 'r' }]; Object.keys(byT).sort().forEach(function (k) { rows.push([k, byT[k].n, byT[k].t]); }); break; }
      default: return null;
    }
    return { key: key, title: title, cols: cols, rows: rows, totals: totals };
  }
  function reportExport(key, kind) {
    var d = reportData(key); if (!d) { toast('No export for this report'); return null; }
    var fname = A.exportName(kind, d.title);
    if (kind === 'xlsx') return { name: fname, blob: TVExport.xlsx([{ name: d.title.slice(0, 28), title: [d.title, S.company.name, 'Period: ' + A.periodLabel()], columns: d.cols.map(function (c) { return { title: c.title, width: c.width || 14, type: c.type }; }), rows: d.rows, totals: d.totals }]) };
    var pcols = d.cols.map(function (c) { return { title: c.title, width: (c.width || 14) * 10, align: c.align || 'l' }; });
    var txt = function (v) { return v == null ? '' : typeof v === 'number' ? fmt(v) : String(v); };
    return { name: fname, blob: TVExport.pdf({ title: d.title, subtitle: S.company.name, meta: ['Period: ' + A.periodLabel()], columns: pcols, rows: d.rows.map(function (r) { return r.map(txt); }), totals: d.totals.map(function (r) { return r.map(txt); }), landscape: d.cols.length > 5 }) };
  }
  function reportActions(key) { return actions([{ key: 'report-wa:' + key, icon: 'whatsapp', label: 'WhatsApp', cls: 'wa' }, { key: 'report-xlsx:' + key, icon: 'excel', label: 'Excel' }, { key: 'report-pdf:' + key, icon: 'pdf', label: 'PDF' }]); }

  /* ---- home widgets ------------------------------------------------------ */
  function rank(items, max) { return '<div class="rank">' + items.map(function (it) { return '<div class="r"><span class="n"><a href="#/ledger/' + encodeURIComponent(it.name) + '" style="color:inherit">' + esc(it.name) + '</a></span><span class="v num">' + esc(A.compact(it.amount)) + '</span><span class="bar"><i style="width:' + Math.max(3, Math.round(it.amount / max * 100)) + '%"></i></span></div>'; }).join('') + '</div>'; }
  function homeWidgets() {
    var b = S.book, p = S.period, h = '';
    var pn = pins().filter(function (n) { return b.ledgers[n]; });
    if (pn.length) h += '<div class="card" style="padding:0"><h2 style="padding:14px 16px 0">Pinned ledgers</h2><div>' + pn.map(function (n) { return A.ledgerRow(n, b.ledgerBalance(n, p.from, p.to).closing, b.ledgers[n].parent); }).join('') + '</div></div>';
    var te = b.topExpenses(p.from, p.to, 5);
    if (te.length) h += '<div class="card"><h2><a class="more" href="#/report/pl">P&amp;L ›</a>Top expenses</h2>' + rank(te, te[0].amount) + '</div>';
    var tc = b.topParties(p.from, p.to, 'Sales', 5);
    if (tc.length) h += '<div class="card"><h2><a class="more" href="#/report/gst">GST ›</a>Top customers</h2>' + rank(tc, tc[0].amount) + '</div>';
    return h;
  }

  /* ---- voucher page actions --------------------------------------------- */
  function voucherActions(v) {
    var items = [{ key: 'v-edit:' + v.id, icon: 'edit', label: 'Edit' }, { key: 'v-dup:' + v.id, icon: 'copy', label: 'Duplicate' }, { key: 'v-xml:' + v.id, icon: 'xml', label: 'Tally XML' }, { key: 'v-post:' + v.id, icon: 'post', label: 'Post to Tally' }];
    if (v.invoice) items.push({ key: 'v-pdf:' + v.id, icon: 'pdf', label: 'Invoice PDF' }, { key: 'v-wa:' + v.id, icon: 'whatsapp', label: 'WhatsApp', cls: 'wa' }, { key: 'v-einv:' + v.id, icon: 'xml', label: 'E-invoice JSON' }, { key: 'v-irn:' + v.id, icon: 'irn', label: 'IRN' });
    return actions(items);
  }
  function duplicate(v) {
    var today = (function () { var n = new Date(); return n.getFullYear() * 10000 + (n.getMonth() + 1) * 100 + n.getDate(); })();
    if (v.invoice) { var inv = JSON.parse(JSON.stringify(v.invoice)); inv.id = 'app:' + A.uid(); inv.date = today; inv.number = S.book.nextNumber(inv.type || 'Sales'); inv.irn = ''; inv.ackNo = ''; inv.ackDate = ''; S.inv = inv; S.invNewId = inv.id; go('#/invoice'); return; }
    S.draft = { id: 'app:' + A.uid(), source: 'app', type: v.type, date: today, number: '', party: v.party, narration: v.narration, lines: v.entries.map(function (e) { return { side: e.amount < 0 ? 'Dr' : 'Cr', ledger: e.ledger, amount: Math.abs(e.amount) }; }) };
    S.draftNewId = S.draft.id; go('#/entry?type=' + encodeURIComponent(v.type));
  }

  /* ---- backup / restore / lock ---------------------------------------------- */
  function backup() {
    var payload = { app: 'tally-viewer', version: 1, exportedAt: new Date().toISOString(), company: S.company, data: S.book.data };
    var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    A.afterSave(TVExport.save(TVExport.safeName(S.company.name + ' - backup ' + new Date().toISOString().slice(0, 10) + '.json'), blob));
  }
  function restore(file) {
    file.text().then(function (txt) {
      var p = JSON.parse(txt);
      if (!p || p.app !== 'tally-viewer' || !p.data || !p.company) throw new Error('Not a Tally Viewer backup');
      var existing = S.companies.filter(function (c) { return c.name.toLowerCase() === p.company.name.toLowerCase(); })[0];
      var c = existing || { id: A.uid(), name: p.company.name, createdAt: Date.now() };
      if (existing && !confirm('Replace the data of "' + existing.name + '" with this backup?')) return;
      c.settings = p.company.settings; c.info = p.company.info; c.counts = p.company.counts; c.minDate = p.company.minDate; c.maxDate = p.company.maxDate; c.updatedAt = Date.now();
      p.data.id = c.id;
      return TVDB.putData(p.data).then(function () { return TVDB.putCompany(c); }).then(A.loadCompanies).then(function () { S.book = null; S.company = null; return A.selectCompany(c.id); }).then(function () { toast('Backup restored'); go('#/home'); });
    }).catch(function (e) { toast('Restore failed: ' + e.message, 5000); });
  }
  function sha(s) { return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }); }
  function pinRec() { return A.lsGet('tv.pin', null); }
  function showLock() {
    var rec = pinRec(); if (!rec) return;
    var el = document.createElement('div'); el.className = 'lock'; var entered = '';
    el.innerHTML = '<div class="logo">TV</div><h2>Enter PIN</h2><div class="dots">' + '<i></i>'.repeat(rec.len) + '</div><div class="err" id="lock-err"></div><div class="pad">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map(function (k) { return k === '' ? '<span></span>' : '<button data-k="' + k + '">' + k + '</button>'; }).join('') + '</div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-k]'); if (!b) return; var k = b.getAttribute('data-k');
      if (k === '⌫') entered = entered.slice(0, -1); else if (entered.length < rec.len) entered += k;
      el.querySelectorAll('.dots i').forEach(function (d, i) { d.classList.toggle('on', i < entered.length); });
      if (entered.length === rec.len) sha(rec.salt + entered).then(function (h) { if (h === rec.hash) el.remove(); else { document.getElementById('lock-err').textContent = 'Wrong PIN'; entered = ''; el.querySelectorAll('.dots i').forEach(function (d) { d.classList.remove('on'); }); } });
    });
  }
  function setPin() {
    var pin = prompt(pinRec() ? 'Enter a new 4–6 digit PIN (leave blank to remove the lock)' : 'Choose a 4–6 digit PIN');
    if (pin === null) return;
    pin = pin.trim();
    if (!pin) { if (pinRec() && confirm('Remove the app lock?')) { localStorage.removeItem('tv.pin'); toast('App lock removed'); A.render(); } return; }
    if (!/^\d{4,6}$/.test(pin)) { toast('PIN must be 4 to 6 digits'); return; }
    var salt = A.uid();
    sha(salt + pin).then(function (h) { A.lsSet('tv.pin', { salt: salt, hash: h, len: pin.length }); toast('App lock set'); A.render(); });
  }
  function moreRows() {
    return '<button class="row" data-faction="lock"><div class="main"><div class="t">App lock</div><div class="s">' + (pinRec() ? 'PIN required when the app opens' : 'Protect the app with a PIN') + '</div></div><span class="chev">›</span></button>' +
      (S.book ? '<button class="row" data-faction="backup"><div class="main"><div class="t">Backup this company</div><div class="s">Everything incl. entries made here, as a file</div></div><span class="chev">›</span></button>' : '') +
      '<button class="row" data-faction="restore"><div class="main"><div class="t">Restore from backup</div><div class="s">Load a Tally Viewer backup file</div></div><span class="chev">›</span></button><input type="file" id="restore-file" class="hidden" accept=".json,application/json">';
  }

  /* ---- dispatcher -------------------------------------------------------- */
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-faction]'); if (!el) return;
    var raw = el.getAttribute('data-faction'), i = raw.indexOf(':'), key = i < 0 ? raw : raw.slice(0, i), arg = i < 0 ? '' : raw.slice(i + 1);
    try {
      switch (key) {
        case 'ledger-wa': ledgerWhatsapp(arg); break;
        case 'ledger-xlsx': case 'ledger-pdf': { var e = A.buildLedgerExport(arg, key.split('-')[1]); A.afterSave(TVExport.save(e.name, e.blob)); break; }
        case 'ledger-letter': { var c = ledgerCtx(arg); A.afterSave(TVExport.save(TVExport.safeName(S.company.name + ' - Confirmation - ' + arg + '.pdf'), TVEntry.confirmationPdf(c, TVExport))); break; }
        case 'ledger-pin': togglePin(arg); break;
        case 'report-xlsx': case 'report-pdf': { var r = reportExport(arg, key.split('-')[1]); if (r) A.afterSave(TVExport.save(r.name, r.blob)); break; }
        case 'report-wa': { var title = (A.REPORTS.filter(function (x) { return x[0] === arg; })[0] || ['', arg])[1]; whatsappSheet({ title: 'Send ' + title, phone: '', options: [{ label: 'PDF', hint: title + ' · ' + A.periodLabel(), build: function () { var x = reportExport(arg, 'pdf'); return { name: x.name, blob: x.blob, text: title + ' of ' + S.company.name + ' for ' + A.periodLabel() }; } }, { label: 'Excel', hint: 'Spreadsheet', build: function () { var x = reportExport(arg, 'xlsx'); return { name: x.name, blob: x.blob, text: title + ' of ' + S.company.name + ' for ' + A.periodLabel() }; } }] }); break; }
        case 'v-edit': { var v = S.book.vouchers.filter(function (x) { return x.id === arg; })[0]; go(v.invoice ? '#/invoice?edit=' + encodeURIComponent(arg) : '#/entry?edit=' + encodeURIComponent(arg)); break; }
        case 'v-dup': duplicate(S.book.vouchers.filter(function (x) { return x.id === arg; })[0]); break;
        case 'v-xml': A.exportTallyXml(S.book.vouchers.filter(function (x) { return x.id === arg; })); break;
        case 'v-post': A.postToTally(S.book.vouchers.filter(function (x) { return x.id === arg; })); break;
        case 'v-pdf': A.exportInvoicePdf(S.book.vouchers.filter(function (x) { return x.id === arg; })[0]); break;
        case 'v-einv': A.exportEInvoice(S.book.vouchers.filter(function (x) { return x.id === arg; })[0]); break;
        case 'v-irn': A.enterIrn(S.book.vouchers.filter(function (x) { return x.id === arg; })[0]); break;
        case 'v-wa': { var iv = S.book.vouchers.filter(function (x) { return x.id === arg; })[0], pl = S.book.ledgers[iv.party], ph = pl && pl.info ? pl.info.phone : ''; whatsappSheet({ title: 'Send invoice ' + iv.number, phone: ph, options: [{ label: 'Invoice PDF', hint: 'Tax invoice for ' + iv.party, build: function () { return { name: TVExport.safeName(S.company.name + ' - Invoice ' + iv.number + '.pdf'), blob: TVEntry.invoicePdf(A.einvoiceDoc(iv), TVExport), text: 'Invoice ' + iv.number + ' dated ' + A.fmtDate(iv.date) + ' for Rs ' + fmt(iv.total) + ' from ' + S.company.name + '.' }; } }] }); break; }
        case 'lock': setPin(); break;
        case 'backup': backup(); break;
        case 'restore': { var inp = document.getElementById('restore-file'); inp.onchange = function () { if (inp.files[0]) restore(inp.files[0]); }; inp.click(); break; }
      }
    } catch (err) { toast('Action failed: ' + err.message, 5000); }
  });

  window.TVF = { actions: actions, ledgerActions: ledgerActions, ledgerMonthlyCard: ledgerMonthlyCard, reportSections: reportSections, reportActions: reportActions, reportData: reportData, homeWidgets: homeWidgets, voucherActions: voucherActions, moreRows: moreRows, showLock: showLock, share: share, whatsappSheet: whatsappSheet, pins: pins };
})();
