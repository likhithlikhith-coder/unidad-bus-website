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
  function actions(items) { return '<div class="actions">' + items.map(function (it) { return '<button class="act' + (it.cls ? ' ' + it.cls : '') + '" data-faction="' + esc(it.key) + '"' + (it.pressed !== undefined ? ' aria-pressed="' + (it.pressed ? 'true' : 'false') + '"' : '') + '><span class="ico">' + (I[it.icon] || '') + '</span>' + esc(it.label) + '</button>'; }).join('') + '</div>'; }
  function digits(ph) { var d = String(ph || '').replace(/[^0-9]/g, ''); if (d.length === 10) d = '91' + d; return d; }
  function company() { var st = A.companySettings ? A.companySettings() : {}; return { name: S.company.name, address: [st.address1, st.address2, st.city, st.pin].filter(Boolean).join(', '), gstin: st.gstin, phone: st.phone }; }
  function blobToB64(blob) { return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(String(fr.result).split(',')[1] || ''); }; fr.onerror = rej; fr.readAsDataURL(blob); }); }
  function dateRange(a, b) { return A.dateRange ? A.dateRange(a, b) : A.fmtDate(a) + ' – ' + A.fmtDate(b); }
  function lsRemove(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  function isCreditNote(type) { return !!(A.isCreditNote && S.book && A.isCreditNote(type)); }

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
    var h = '<h3>' + esc(o.title) + '</h3><div class="field"><label for="wa-phone">WhatsApp number</label><input id="wa-phone" inputmode="tel" placeholder="98XXXXXXXX (blank = pick a contact)" value="' + esc(o.phone || '') + '"></div>' +
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
      { key: 'ledger-pin:' + name, icon: 'pin', label: pinned ? 'Pinned' : 'Pin', cls: pinned ? 'on' : '', pressed: pinned }
    ]);
  }
  function ledgerMonthlyCard(name) {
    var m = S.book.ledgerMonthly(name, S.period.from, S.period.to), led = S.book.ledgers[name];
    if (!m.months.length) return '';
    return '<details class="card" style="padding:0"><summary style="list-style:none;padding:14px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center"><span style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text-3)">Monthly summary</span><span class="chev">▾</span></summary><div style="padding:0 16px 14px"><table class="tbl"><tr><th>Month</th><th class="n">Debit</th><th class="n">Credit</th><th class="n">Closing</th></tr>' +
      m.months.map(function (x) { return '<tr><td>' + A.fmtMonth(x.month) + '</td><td class="n">' + (x.debit ? fmt(x.debit) : '') + '</td><td class="n">' + (x.credit ? fmt(x.credit) : '') + '</td><td class="n">' + A.bal(x.closing, undefined, led) + '</td></tr>'; }).join('') + '</table></div></details>';
  }
  function ledgerWhatsapp(name) {
    var c = ledgerCtx(name);
    whatsappSheet({ title: 'Send ' + name, phone: c.party.phone, options: [
      { label: 'PDF statement', hint: 'Ledger for ' + dateRange(c.from, c.to), build: function () { var e = A.buildLedgerExport(name, 'pdf'); return { name: e.name, blob: e.blob, text: TVEntry.ledgerSummaryText(c) }; } },
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
      return '<div class="section-title">' + sec[0] + '</div><div class="list">' + sec[1].map(function (k) { var r = byKey[k]; if (!r) return ''; return '<a class="row" href="#/report/' + r[0] + '"><span class="ico" style="width:36px;height:36px;border-radius:12px;display:grid;place-items:center;background:var(--surface-3);color:var(--text-2);flex:none">' + (A.ICONS[RICON[k]] || '').replace('<svg', '<svg style="width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"') + '</span><div class="main"><div class="t">' + r[1] + '</div><div class="s">' + r[2] + '</div></div><span class="chev">›</span></a>'; }).join('') + '</div>';
    }).join('');
  }
  // Every cell is escaped. A cell may be { html: '<safe markup>' } to pass markup the caller has already escaped.
  function cell(v) { return v == null ? '' : (typeof v === 'object' && v.html !== undefined) ? String(v.html) : esc(v); }
  function tableCard(cols, rows, totals, note) {
    function td(v, i, extra) { return '<td' + (cols[i] && cols[i].align === 'r' ? ' class="n"' : (extra || '')) + '>' + cell(v) + '</td>'; }
    return '<div class="card scroll" style="overflow:auto"><table class="tbl"><tr>' + cols.map(function (c) { return '<th' + (c.align === 'r' ? ' class="n"' : '') + '>' + esc(c.title) + '</th>'; }).join('') + '</tr>' +
      rows.map(function (r) { return '<tr>' + r.map(function (v, i) { return td(v, i, i === 0 && cols[0].title === 'Month' ? ' style="white-space:nowrap"' : ''); }).join('') + '</tr>'; }).join('') +
      (totals || []).map(function (r) { return '<tr class="total">' + r.map(function (v, i) { return td(v, i); }).join('') + '</tr>'; }).join('') + '</table>' + (note ? '<p class="small muted" style="margin-top:10px">' + esc(note) + '</p>' : '') + '</div>';
  }
  function link(name, sub) { return { html: '<a href="#/ledger/' + encodeURIComponent(name) + '">' + esc(name) + '</a>' + (sub ? '<div class="small faint">' + esc(sub) + '</div>' : '') }; }
  var nf = function (n) { return n == null ? '' : fmt(n); };
  A.REPORT_FN.ratios = function (b, from, to) {
    var r = b.ratios(from, to), rows = [
      ['Working capital', fmt(r.workingCapital), 'Current assets − current liabilities'],
      ['Current ratio', r.currentRatio == null ? 'n/a' : r.currentRatio.toFixed(2), 'Current assets ÷ current liabilities (≥ 1.5 comfortable)'],
      ['Quick ratio', r.quickRatio == null ? 'n/a' : r.quickRatio.toFixed(2), 'Excludes stock-in-hand'],
      ['Debt to equity', r.debtEquity == null ? 'n/a' : r.debtEquity.toFixed(2), 'Loans ÷ (capital + reserves + profit)'],
      ['Gross profit', r.grossProfitPct == null ? 'n/a' : r.grossProfitPct.toFixed(1) + '%', 'Of sales, excl. stock valuation'],
      ['Net profit (before stock)', r.netProfitPct == null ? 'n/a' : r.netProfitPct.toFixed(1) + '%', 'Of sales, before opening/closing stock'],
      ['Return on equity', r.returnOnEquityPct == null ? 'n/a' : r.returnOnEquityPct.toFixed(1) + '%', 'Net profit (before stock) ÷ equity, for the period'],
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
    var rows = r.rows.map(function (x) { return [link(x.name, x.bills + ' bill' + (x.bills === 1 ? '' : 's') + ' · oldest ' + x.oldest + ' d')].concat(x.buckets.map(function (v) { return v ? fmt(v) : ''; })).concat([fmt(x.total)]); });
    var totals = [['Total'].concat(r.totals.map(function (v) { return v ? fmt(v) : ''; })).concat([fmt(r.grand)])];
    var tiles = '<div class="tiles">' + r.buckets.map(function (bk, i) { return '<div class="tile"><div class="label">' + names[i] + ' days</div><div class="value num">' + A.compact(r.totals[i]) + '</div></div>'; }).join('') + '</div>';
    return tiles + tableCard(cols, rows, totals, 'Bills are matched first-in-first-out from the ledger entries (invoices against receipts), as on ' + A.fmtDate(to) + '. Opening balances count from the start of the books.');
  }
  A.REPORT_FN.ageing = function (b, from, to) { return ageingHtml(b, to, 'debtor'); };
  A.REPORT_FN.ageingc = function (b, from, to) { return ageingHtml(b, to, 'creditor'); };
  A.REPORT_FN.cashflow = function (b, from, to) {
    var m = b.cashFlow(from, to); if (!m.length) return '<div class="empty">No cash or bank movement in this period.</div>';
    var ti = 0, tout = 0; m.forEach(function (x) { ti += x.inflow; tout += x.outflow; });
    return '<div class="tiles"><div class="tile"><div class="label">Inflow</div><div class="value num">' + A.compact(ti) + '</div></div><div class="tile"><div class="label">Outflow</div><div class="value num">' + A.compact(tout) + '</div></div></div>' +
      tableCard([{ title: 'Month' }, { title: 'Inflow', align: 'r' }, { title: 'Outflow', align: 'r' }, { title: 'Net', align: 'r' }], m.map(function (x) { return [A.fmtMonth(x.month), fmt(x.inflow), fmt(x.outflow), (x.net < 0 ? '-' : '') + fmt(Math.abs(x.net))]; }), [['Total', fmt(ti), fmt(tout), (ti - tout < 0 ? '-' : '') + fmt(Math.abs(ti - tout))]], 'Across all cash, bank and bank OD ledgers. Contra transfers between cash and bank are excluded.');
  };
  A.REPORT_FN.gst = function (b, from, to) {
    var g = b.gstSummary(from, to);
    if (!g.months.length) return '<div class="empty">No sales or purchase vouchers in this period.</div>';
    var to_ = 0, ti = 0, ow = 0; g.months.forEach(function (m) { to_ += m.outputTax; ti += m.inputTax; ow += m.outward; });
    var h = '<div class="tiles"><div class="tile"><div class="label">Outward supplies</div><div class="value num">' + A.compact(ow) + '</div></div><div class="tile"><div class="label">Output tax</div><div class="value num">' + A.compact(to_) + '</div></div><div class="tile"><div class="label">Input tax credit</div><div class="value num">' + A.compact(ti) + '</div></div><div class="tile"><div class="label">' + (to_ - ti < 0 ? 'Net credit' : 'Net payable') + '</div><div class="value num">' + A.compact(Math.abs(to_ - ti)) + '</div></div></div>';
    h += '<div class="section-title">By month</div>' + tableCard([{ title: 'Month' }, { title: 'Outward', align: 'r' }, { title: 'Output tax', align: 'r' }, { title: 'Inward', align: 'r' }, { title: 'ITC', align: 'r' }, { title: 'Net', align: 'r' }], g.months.map(function (m) { return [A.fmtMonth(m.month), fmt(m.outward), fmt(m.outputTax), fmt(m.inward), fmt(m.inputTax), fmt(m.net)]; }), [['Total', fmt(ow), fmt(to_), '', fmt(ti), fmt(to_ - ti)]]);
    if (g.parties.length) h += '<div class="section-title">Outward supplies by party (B2B / B2C)</div>' + tableCard([{ title: 'Party' }, { title: 'GSTIN' }, { title: 'Taxable', align: 'r' }, { title: 'Tax', align: 'r' }], g.parties.map(function (p) { return [link(p.party, p.count + ' invoice' + (p.count === 1 ? '' : 's')), p.gstin || { html: '<span class="faint">B2C</span>' }, fmt(p.taxable), fmt(p.tax)]; }), null, 'Figures come from sales, purchase, credit note and debit note vouchers only; GST ledgers are recognised under Duties & Taxes by name (' + g.taxLedgers.length + ' found). Adjustment journals are not included.');
    var tl = g.taxLedgers.slice().sort(function (a, b) { return a.kind === b.kind ? a.name.localeCompare(b.name) : (a.kind === 'output' ? -1 : 1); });
    h += '<details class="card grp" style="padding:0"><summary style="list-style:none;padding:14px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center"><span style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text-3)">Recognised GST ledgers (' + tl.length + ')</span><span class="chev">▾</span></summary><div class="list">' +
      (tl.length ? tl.map(function (t) { return '<a class="row" href="#/ledger/' + encodeURIComponent(t.name) + '"><div class="main"><div class="t">' + esc(t.name) + '</div><div class="s">' + (t.kind === 'input' ? 'Input tax credit' : 'Output tax') + '</div></div><span class="chev">›</span></a>'; }).join('') : '<div class="empty small">No ledger under Duties &amp; Taxes has GST or Cess in its name.</div>') +
      '</div><p class="small muted" style="padding:0 16px 14px">A ledger counts as GST when it sits under Duties &amp; Taxes and its name contains CGST, SGST, IGST, UTGST, GST or Cess; "Input", "Purchase" or "ITC" in the name makes it input tax.</p></details>';
    return h;
  };
  A.REPORT_FN.plcmp = function (b, from, to) {
    var cur = b.summary(from, to), prev = b.summary(from - 10000, to - 10000);
    var rows = [['Sales', cur.sales, prev.sales], ['Direct incomes', cur.directIncome, prev.directIncome], ['Purchases', cur.purchases, prev.purchases], ['Direct expenses', cur.directExpense, prev.directExpense], ['Gross profit', cur.grossProfit, prev.grossProfit], ['Indirect incomes', cur.indirectIncome, prev.indirectIncome], ['Indirect expenses', cur.indirectExpense, prev.indirectExpense], ['Net profit (before stock)', cur.netProfit, prev.netProfit]];
    return tableCard([{ title: 'Head' }, { title: dateRange(from, to), align: 'r' }, { title: 'Previous year', align: 'r' }, { title: 'Change', align: 'r' }], rows.map(function (r) { var ch = Math.abs(r[2]) > 0.005 ? Math.round((r[1] - r[2]) / Math.abs(r[2]) * 100) + '%' : (r[1] ? 'new' : ''); var bold = r[0] === 'Gross profit' || r[0] === 'Net profit (before stock)'; return [bold ? { html: '<b>' + esc(r[0]) + '</b>' } : r[0], fmt(r[1]), fmt(r[2]), ch]; }), null, 'Previous year = the same dates one year earlier. Profit figures exclude opening and closing stock.');
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
      case 'pl': {
        var s = b.summary(from, to); cols = [{ title: 'Head', width: 30 }, { title: 'Amount', width: 16, type: 'num', align: 'r' }];
        rows = [['Sales', s.sales], ['Direct incomes', s.directIncome], ['Purchases', s.purchases], ['Direct expenses', s.directExpense], ['Gross profit', s.grossProfit], ['Indirect incomes', s.indirectIncome], ['Indirect expenses', s.indirectExpense]];
        var other = Math.round((s.netProfit - (s.grossProfit + s.indirectIncome - s.indirectExpense)) * 100) / 100;
        if (Math.abs(other) > 0.005) rows.push(['Other income / expenses (net)', other]);
        rows.push(['Net profit (before stock)', s.netProfit]);
        break;
      }
      case 'plcmp': { var c1 = b.summary(from, to), c0 = b.summary(from - 10000, to - 10000); cols = [{ title: 'Head', width: 30 }, { title: 'This period', width: 16, type: 'num', align: 'r' }, { title: 'Previous year', width: 16, type: 'num', align: 'r' }]; rows = [['Sales', c1.sales, c0.sales], ['Purchases', c1.purchases, c0.purchases], ['Gross profit', c1.grossProfit, c0.grossProfit], ['Indirect incomes', c1.indirectIncome, c0.indirectIncome], ['Indirect expenses', c1.indirectExpense, c0.indirectExpense], ['Net profit (before stock)', c1.netProfit, c0.netProfit]]; break; }
      case 'ratios': { var r = b.ratios(from, to); cols = [{ title: 'Ratio', width: 30 }, { title: 'Value', width: 16, align: 'r' }]; rows = [['Working capital', fmt(r.workingCapital)], ['Current ratio', r.currentRatio == null ? 'n/a' : r.currentRatio.toFixed(2)], ['Quick ratio', r.quickRatio == null ? 'n/a' : r.quickRatio.toFixed(2)], ['Debt to equity', r.debtEquity == null ? 'n/a' : r.debtEquity.toFixed(2)], ['Gross profit %', r.grossProfitPct == null ? 'n/a' : r.grossProfitPct.toFixed(1)], ['Net profit % (before stock)', r.netProfitPct == null ? 'n/a' : r.netProfitPct.toFixed(1)], ['Receivable days', r.receivableDays == null ? 'n/a' : Math.round(r.receivableDays)], ['Payable days', r.payableDays == null ? 'n/a' : Math.round(r.payableDays)]]; break; }
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
    // a voucher that came back from Tally but was raised here (fromApp) is Tally's record now: no edit/resend, but its invoice documents stay reachable
    var items = v.source === 'app'
      ? [{ key: 'v-edit:' + v.id, icon: 'edit', label: 'Edit' }, { key: 'v-dup:' + v.id, icon: 'copy', label: 'Duplicate' }, { key: 'v-xml:' + v.id, icon: 'xml', label: 'Tally XML' }, { key: 'v-post:' + v.id, icon: 'post', label: 'Post to Tally' }]
      : [{ key: 'v-dup:' + v.id, icon: 'copy', label: 'Duplicate' }];
    // label stays "Invoice PDF" for credit notes too: the classic export sheet matches actions by this label; the PDF itself is titled CREDIT NOTE
    if (v.invoice) items.push({ key: 'v-pdf:' + v.id, icon: 'pdf', label: 'Invoice PDF' }, { key: 'v-wa:' + v.id, icon: 'whatsapp', label: 'WhatsApp', cls: 'wa' }, { key: 'v-einv:' + v.id, icon: 'xml', label: 'E-invoice JSON' }, { key: 'v-irn:' + v.id, icon: 'irn', label: 'IRN' });
    return actions(items);
  }
  function duplicate(v) {
    var today = (function () { var n = new Date(); return n.getFullYear() * 10000 + (n.getMonth() + 1) * 100 + n.getDate(); })();
    if (v.invoice) { var inv = JSON.parse(JSON.stringify(v.invoice)); inv.id = 'app:' + A.uid(); inv.date = today; inv.number = S.book.nextNumber(inv.type || v.type || 'Sales') || ''; inv.type = inv.type || v.type; inv.irn = ''; inv.ackNo = ''; inv.ackDate = ''; inv.refNumber = ''; inv.refDate = 0; delete inv.edit; delete inv.posted; delete inv.createdAt; S.inv = inv; S.invNewId = inv.id; go('#/invoice'); return; }
    S.draft = { id: 'app:' + A.uid(), source: 'app', type: v.type, date: today, number: '', party: v.party, narration: v.narration, edit: null, lines: v.entries.map(function (e) { return { side: e.amount < 0 ? 'Dr' : 'Cr', ledger: e.ledger, amount: Math.abs(e.amount) }; }) };
    S.draftNewId = S.draft.id; go('#/entry?type=' + encodeURIComponent(v.type));
  }

  /* ---- backup / restore ----------------------------------------------------- */
  function backup() {
    var payload = { app: 'tally-viewer', version: 1, exportedAt: new Date().toISOString(), appVersion: window.TV_VERSION || A.VERSION || '', company: S.company, data: S.book.data };
    var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    return A.afterSave(TVExport.save(TVExport.safeName(S.company.name + ' - backup ' + new Date().toISOString().slice(0, 10) + '.json'), blob));
  }
  function isPlainObject(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function restore(file) {
    file.text().then(function (txt) {
      var p; try { p = JSON.parse(txt); } catch (e) { throw new Error('the file is not valid JSON'); }
      if (!p || p.app !== 'tally-viewer' || !p.data || !p.company) throw new Error('not a Tally Viewer backup');
      if (p.version !== 1) throw new Error('backup format version ' + p.version + ' is not supported by this app');
      var d = p.data;
      if (!Array.isArray(d.vouchers) || !['groups', 'ledgers', 'stockItems', 'voucherTypes'].every(function (k) { return isPlainObject(d[k]); })) throw new Error('the backup is incomplete or damaged (missing vouchers or masters)');
      var name = String((p.company && p.company.name) || '').trim(); if (!name) throw new Error('the backup has no company name');
      var book; try { book = new TVModel.Book(d); book.summary(0, 99999999); } catch (e) { throw new Error('the backup data cannot be opened (' + (e && e.message || e) + ')'); }
      var appCount = d.vouchers.filter(function (v) { return v.source === 'app'; }).length;
      var when = p.exportedAt && !isNaN(new Date(p.exportedAt)) ? new Date(p.exportedAt).toLocaleString() : 'an unknown date';
      var desc = 'Backup of "' + name + '" exported ' + when + ': ' + d.vouchers.length + ' vouchers (' + appCount + ' made in this app), ' + Object.keys(d.ledgers).length + ' ledgers, ' + Object.keys(d.stockItems).length + ' stock items.';
      var existing = S.companies.filter(function (c) { return c.name.toLowerCase() === name.toLowerCase(); })[0], keep = [];
      return (existing ? TVDB.getData(existing.id).catch(function () { return null; }) : Promise.resolve(null)).then(function (old) {
        if (existing) {
          var inBackup = {}; d.vouchers.forEach(function (v) { inBackup[v.id] = 1; });
          keep = ((old && old.vouchers) || []).filter(function (v) { return v.source === 'app' && !v.posted && !inBackup[v.id]; });
          var upd = existing.updatedAt ? new Date(existing.updatedAt).toLocaleString() : 'unknown';
          if (!confirm(desc + '\n\nReplace the data of "' + existing.name + '" on this phone (last updated ' + upd + ', ' + ((existing.counts && existing.counts.vouchers) || 0) + ' vouchers)?' + (keep.length ? '\n\n' + keep.length + ' unposted entr' + (keep.length === 1 ? 'y' : 'ies') + ' made in this app and missing from the backup will be kept.' : ''))) return;
        } else if (!confirm(desc + '\n\nRestore it as a new company on this phone?')) return;
        var c = existing || { id: A.uid(), name: name, createdAt: Date.now() };
        c.settings = p.company.settings || {}; c.info = p.company.info || {}; c.updatedAt = Date.now();
        d.id = c.id;
        if (keep.length) { d.vouchers = d.vouchers.concat(keep).sort(TVModel.voucherSort); book = new TVModel.Book(d); }
        c.counts = { vouchers: d.vouchers.length, ledgers: Object.keys(d.ledgers).length, groups: Object.keys(d.groups).length, stockItems: Object.keys(d.stockItems).length };
        c.minDate = book.minDate; c.maxDate = book.maxDate;
        return TVDB.putData(d).then(function () { return TVDB.putCompany(c); }).then(A.loadCompanies).then(function () { S.book = null; S.company = null; S.draft = null; S.inv = null; return A.selectCompany(c.id); }).then(function () { toast('Backup restored' + (keep.length ? ' · ' + keep.length + ' app entr' + (keep.length === 1 ? 'y' : 'ies') + ' kept' : '')); go('#/home'); });
      });
    }).catch(function (e) { toast('Restore failed: ' + ((e && e.message) || e), 6000); });
  }

  /* ---- app lock ------------------------------------------------------------- */
  // PIN record in localStorage 'tv.pin': { salt, hash, len, kdf: 'pbkdf2' } (PBKDF2-SHA256, 100k iterations).
  // Legacy records { salt, hash, len } (one SHA-256 of salt+pin) still verify and are upgraded on the next success.
  var PIN_ITER = 100000, RELOCK_MS = 60000;
  function subtle() { return (window.crypto && window.crypto.subtle) || null; }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function sha(s) { return subtle().digest('SHA-256', new TextEncoder().encode(s)).then(hex); }
  function pbkdf2(pin, salt) {
    var enc = new TextEncoder();
    return subtle().importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']).then(function (key) {
      return subtle().deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: PIN_ITER, hash: 'SHA-256' }, key, 256);
    }).then(hex);
  }
  function pinRec() { var r = A.lsGet('tv.pin', null); return r && r.hash && r.salt ? r : null; }
  function setSecure() { try { var br = window.TallyBridge; if (br && typeof br.setSecure === 'function') br.setSecure(!!pinRec()); } catch (e) { /* bridge unavailable */ } }
  function storePin(pin) {
    var salt = A.uid() + Math.random().toString(36).slice(2, 10);
    return pbkdf2(pin, salt).then(function (h) { A.lsSet('tv.pin', { salt: salt, hash: h, len: pin.length, kdf: 'pbkdf2' }); clearFail(); setSecure(); });
  }
  function removePin() { lsRemove('tv.pin'); clearFail(); setSecure(); }
  // resolves true/false; upgrades a legacy SHA-256 record to PBKDF2 on success
  function verifyPin(pin) {
    var rec = pinRec(); if (!rec) return Promise.resolve(true);
    if (rec.kdf === 'pbkdf2') return pbkdf2(pin, rec.salt).then(function (h) { return h === rec.hash; });
    return sha(rec.salt + pin).then(function (h) { if (h !== rec.hash) return false; return storePin(pin).then(function () { return true; }, function () { return true; }); });
  }
  function failRec() { var f = A.lsGet('tv.pinFail', null); return f && typeof f.n === 'number' ? f : { n: 0, until: 0 }; }
  function recordFail() { var f = failRec(); f.n++; if (f.n >= 5) f.until = Date.now() + Math.min(300, 30 * Math.pow(2, f.n - 5)) * 1000; A.lsSet('tv.pinFail', f); return f; }
  function clearFail() { lsRemove('tv.pinFail'); }
  function isLockShown() { return !!document.querySelector('.lock'); }
  // Full-screen keypad overlay shared by unlock, set, confirm and change. step: { title, sub, len (fixed length → auto-submit; 0 = 4–6 digits with ✓),
  // onEnter(pin, pad) → Promise, links: [{label, fn(pad)}], hidePad, cancel (Escape closes) }
  function keypad(step) {
    var el = document.createElement('div'); el.className = 'lock'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'lock-title');
    var prevFocus = document.activeElement, pad = { el: el, entered: '', busy: false, step: null, lockedUntil: 0, timer: 0 };
    el.innerHTML = '<div class="logo" aria-hidden="true">TV</div><h2 id="lock-title"></h2><p class="small muted" id="lock-sub" style="text-align:center;margin:-8px 0 0;max-width:300px"></p>' +
      '<div class="dots" role="status" aria-live="polite" aria-label="No digits entered"></div><div class="err" id="lock-err" role="alert"></div>' +
      '<div class="pad">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 'ok', 0, 'del'].map(function (k) { return k === 'ok' ? '<button data-k="ok" aria-label="Enter">✓</button>' : k === 'del' ? '<button data-k="del" aria-label="Delete digit">⌫</button>' : '<button data-k="' + k + '">' + k + '</button>'; }).join('') + '</div>' +
      '<div class="btn-row" id="lock-links" style="justify-content:center"></div>';
    function maxLen() { return pad.step.len || 6; }
    function dots() {
      var box = el.querySelector('.dots'), is = box.querySelectorAll('i');
      is.forEach(function (d, i) { d.classList.toggle('on', i < pad.entered.length); });
      box.setAttribute('aria-label', pad.entered.length ? pad.entered.length + ' of ' + (pad.step.len || 'up to 6') + ' digits entered' : 'No digits entered');
    }
    pad.setStep = function (s) {
      pad.step = s; pad.entered = ''; pad.busy = false;
      el.querySelector('#lock-title').textContent = s.title; el.querySelector('#lock-sub').textContent = s.sub || '';
      var box = el.querySelector('.dots'); box.innerHTML = '<i></i>'.repeat(maxLen()); box.hidden = !!s.hidePad; el.querySelector('.pad').hidden = !!s.hidePad; dots();
      el.querySelector('#lock-err').textContent = '';
      var links = el.querySelector('#lock-links'), ls = (s.links || []).filter(Boolean);
      links.innerHTML = ls.map(function (l, i) { return '<button class="btn' + (l.primary ? ' primary' : '') + '" data-link="' + i + '">' + esc(l.label) + '</button>'; }).join('');
      links.querySelectorAll('[data-link]').forEach(function (b) { b.onclick = function () { ls[+b.getAttribute('data-link')].fn(pad); }; });
      setTimeout(function () { var f = s.hidePad ? el.querySelector('#lock-links .btn') : el.querySelector('.pad button'); if (f) f.focus(); }, 30);
    };
    pad.error = function (msg) { el.querySelector('#lock-err').textContent = msg || ''; pad.entered = ''; dots(); };
    pad.close = function () {
      clearTimeout(pad.timer); el.remove(); document.removeEventListener('keydown', onKey, true);
      if (!isLockShown()) document.body.classList.remove('locked');
      try { if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus(); } catch (e) { /* ignore */ }
    };
    pad.lockout = function (until) {
      pad.lockedUntil = until; var btns = el.querySelectorAll('.pad button');
      clearTimeout(pad.timer);
      (function tick() {
        var rec = failRec(); if (rec.until < until) until = rec.until; // the persisted record wins (cleared elsewhere → lockout ends)
        var left = Math.ceil((until - Date.now()) / 1000);
        if (left <= 0) { btns.forEach(function (b) { b.disabled = false; }); pad.lockedUntil = 0; pad.error(''); return; }
        btns.forEach(function (b) { b.disabled = true; }); pad.entered = ''; dots();
        el.querySelector('#lock-err').textContent = 'Too many wrong PINs. Try again in ' + left + ' s';
        pad.timer = setTimeout(tick, 1000);
      })();
    };
    function submit() {
      if (pad.busy || pad.lockedUntil > Date.now()) return;
      if (pad.entered.length < 4) { pad.error('Enter 4 to 6 digits'); return; }
      pad.busy = true; var pin = pad.entered;
      Promise.resolve(pad.step.onEnter(pin, pad)).then(function () { pad.busy = false; }, function (e) { pad.busy = false; pad.error((e && e.message) || 'Something went wrong'); });
    }
    function press(k) {
      if (pad.busy || pad.lockedUntil > Date.now() || pad.step.hidePad) return;
      if (k === 'ok') { submit(); return; }
      if (k === 'del') pad.entered = pad.entered.slice(0, -1); else if (pad.entered.length < maxLen()) pad.entered += k;
      dots();
      if (pad.step.len && pad.entered.length === pad.step.len) submit();
    }
    function onKey(ev) {
      if (/^[0-9]$/.test(ev.key)) press(ev.key); else if (ev.key === 'Backspace') press('del'); else if (ev.key === 'Enter' && !ev.target.closest('#lock-links')) press('ok'); else if (ev.key === 'Escape' && pad.step.cancel) pad.close(); else return;
      ev.preventDefault(); ev.stopPropagation();
    }
    el.addEventListener('click', function (ev) { var b = ev.target.closest('[data-k]'); if (b) press(b.getAttribute('data-k')); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(el); document.body.classList.add('locked');
    pad.setStep(step);
    return pad;
  }
  function wrongPin(p) { var f = recordFail(); if (f.until > Date.now()) p.lockout(f.until); else p.error('Wrong PIN' + (f.n >= 3 ? ' · ' + (5 - f.n) + ' more before a wait' : '')); }
  function unlockStep() {
    var rec = pinRec();
    return { title: 'Enter PIN', len: rec && rec.len > 0 && rec.len <= 6 ? rec.len : 0, onEnter: function (pin, p) {
      return verifyPin(pin).then(function (ok) { if (ok) { clearFail(); p.close(); if (A.announce) A.announce('Unlocked'); } else wrongPin(p); });
    }, links: [{ label: 'Forgot PIN?', fn: forgotPin }] };
  }
  function showLock() {
    var rec = pinRec(); if (!rec || isLockShown()) return;
    setSecure();
    if (!subtle()) { toast('App lock needs a secure (https) page; the PIN cannot be checked here.', 6000); return; }
    var pad = keypad(unlockStep());
    var f = failRec(); if (f.until > Date.now()) pad.lockout(f.until);
  }
  function forgotPin(pad) {
    pad.setStep({ title: 'Forgot PIN?', hidePad: true,
      sub: 'A forgotten PIN cannot be recovered. The only way out is to reset the lock: your companies and entries stay on this phone (the PIN does not encrypt them), but anyone holding the phone could do the same, so take a backup first if you can.',
      links: [
        { label: 'Back', fn: function (p) { p.setStep(unlockStep()); } },
        S.book ? { label: 'Backup this company', fn: function () { backup(); } } : null,
        { label: 'Reset lock', fn: function (p) { if (!confirm('Remove the app lock? Your data stays on this phone.')) return; removePin(); p.close(); toast('App lock removed'); if (A.announce) A.announce('App lock removed'); } }
      ] });
  }
  // More → App lock: set a PIN (enter twice), or after verifying the current PIN change or remove it.
  function setPin() {
    if (!subtle()) { toast('App lock needs a secure (https) page', 5000); return; }
    if (!pinRec()) { choosePin(); return; }
    var pad = keypad({ title: 'Enter current PIN', len: pinRec().len || 0, cancel: true, links: [{ label: 'Cancel', fn: function (p) { p.close(); } }, { label: 'Forgot PIN?', fn: forgotPin }], onEnter: function (pin, p) {
      return verifyPin(pin).then(function (ok) { if (!ok) { wrongPin(p); return; } clearFail(); p.close(); lockOptions(); });
    } });
    var f = failRec(); if (f.until > Date.now()) pad.lockout(f.until);
  }
  function lockOptions() {
    A.sheet('<h3>App lock</h3><button class="opt" data-lk="change">Change PIN</button><button class="opt" data-lk="remove">Remove app lock</button>', function (ev, bg) {
      var o = ev.target.closest('[data-lk]'); if (!o) return; bg.remove();
      if (o.getAttribute('data-lk') === 'change') choosePin(); else { removePin(); toast('App lock removed'); A.render(); }
    });
  }
  function choosePin() {
    var first = '';
    var step1 = { title: 'Choose a 4–6 digit PIN', sub: 'Asked when the app opens and after a minute in the background. It is a screen lock: data on this phone is not encrypted.', len: 0, cancel: true,
      links: [{ label: 'Cancel', fn: function (p) { p.close(); } }],
      onEnter: function (pin, p) {
        first = pin;
        p.setStep({ title: 'Enter it again', len: pin.length, cancel: true, links: [{ label: 'Start over', fn: function (p2) { p2.setStep(step1); } }, { label: 'Cancel', fn: function (p2) { p2.close(); } }],
          onEnter: function (pin2, p2) {
            if (pin2 !== first) { p2.error('PINs do not match'); return; }
            return storePin(pin2).then(function () { p2.close(); toast('App lock set'); if (A.announce) A.announce('App lock set'); A.render(); });
          } });
      } };
    keypad(step1);
  }
  // Relock after the app has been in the background for a while. Android calls TVRelock() → TVF.relock() on resume;
  // the browser path uses visibilitychange. relock() applies the 60 s rule when it knows how long the page was hidden.
  var hiddenAt = 0, lastReturn = 0, lastAway = Infinity;
  function relock(force) {
    if (!pinRec() || isLockShown()) return;
    if (!force) { var away = hiddenAt ? Date.now() - hiddenAt : (Date.now() - lastReturn < 5000 ? lastAway : Infinity); if (away < RELOCK_MS) return; }
    showLock();
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { hiddenAt = hiddenAt || Date.now(); return; }
    if (hiddenAt) { lastAway = Date.now() - hiddenAt; lastReturn = Date.now(); hiddenAt = 0; if (lastAway >= RELOCK_MS) relock(true); }
  });
  function moreRows() {
    return '<button class="row" data-faction="lock"><div class="main"><div class="t">App lock</div><div class="s">' + (pinRec() ? 'PIN asked when the app opens and after a minute in the background · change or remove' : 'Protect the app with a PIN (screen lock; data on this phone is not encrypted)') + '</div></div><span class="chev">›</span></button>' +
      (S.book ? '<button class="row" data-faction="backup"><div class="main"><div class="t">Backup this company</div><div class="s">Everything incl. entries made here, as a file</div></div><span class="chev">›</span></button>' : '') +
      '<button class="row" data-faction="restore"><div class="main"><div class="t">Restore from backup</div><div class="s">Load a Tally Viewer backup file</div></div><span class="chev">›</span></button><input type="file" id="restore-file" class="hidden" aria-label="Restore backup file" accept=".json,application/json">';
  }

  /* ---- dispatcher -------------------------------------------------------- */
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-faction]'); if (!el) return;
    var raw = el.getAttribute('data-faction'), i = raw.indexOf(':'), key = i < 0 ? raw : raw.slice(0, i), arg = i < 0 ? '' : raw.slice(i + 1);
    function byId(id) { return S.book.vouchers.filter(function (x) { return x.id === id; })[0]; }
    try {
      switch (key) {
        case 'ledger-wa': ledgerWhatsapp(arg); break;
        case 'ledger-xlsx': case 'ledger-pdf': { var e = A.buildLedgerExport(arg, key.split('-')[1]); A.afterSave(TVExport.save(e.name, e.blob)); break; }
        case 'ledger-letter': { var c = ledgerCtx(arg); A.afterSave(TVExport.save(TVExport.safeName(S.company.name + ' - Confirmation - ' + arg + '.pdf'), TVEntry.confirmationPdf(c, TVExport))); break; }
        case 'ledger-pin': togglePin(arg); break;
        case 'report-xlsx': case 'report-pdf': { var r = reportExport(arg, key.split('-')[1]); if (r) A.afterSave(TVExport.save(r.name, r.blob)); break; }
        case 'report-wa': { var title = (A.REPORTS.filter(function (x) { return x[0] === arg; })[0] || ['', arg])[1]; whatsappSheet({ title: 'Send ' + title, phone: '', options: [{ label: 'PDF', hint: title + ' · ' + A.periodLabel(), build: function () { var x = reportExport(arg, 'pdf'); return { name: x.name, blob: x.blob, text: title + ' of ' + S.company.name + ' for ' + A.periodLabel() }; } }, { label: 'Excel', hint: 'Spreadsheet', build: function () { var x = reportExport(arg, 'xlsx'); return { name: x.name, blob: x.blob, text: title + ' of ' + S.company.name + ' for ' + A.periodLabel() }; } }] }); break; }
        case 'v-edit': { var v = byId(arg); if (!v) break; go(v.invoice ? '#/invoice?edit=' + encodeURIComponent(arg) : '#/entry?edit=' + encodeURIComponent(arg)); break; }
        case 'v-dup': { var dv = byId(arg); if (dv) duplicate(dv); break; }
        case 'v-xml': A.exportTallyXml(S.book.vouchers.filter(function (x) { return x.id === arg; })); break;
        case 'v-post': A.postToTally(S.book.vouchers.filter(function (x) { return x.id === arg; })); break;
        case 'v-pdf': { var pv = byId(arg); if (pv) A.exportInvoicePdf(pv); break; }
        case 'v-einv': { var ev_ = byId(arg); if (ev_) A.exportEInvoice(ev_); break; }
        case 'v-irn': { var rv = byId(arg); if (rv) A.enterIrn(rv); break; }
        case 'v-wa': { var iv = byId(arg); if (!iv) break; var pl = S.book.ledgers[iv.party], ph = pl && pl.info ? pl.info.phone : '', cn = isCreditNote(iv.type), what = cn ? 'Credit note' : 'Invoice'; whatsappSheet({ title: 'Send ' + what.toLowerCase() + ' ' + iv.number, phone: ph, options: [{ label: what + ' PDF', hint: (cn ? 'Credit note for ' : 'Tax invoice for ') + iv.party, build: function () { return { name: TVExport.safeName(S.company.name + ' - ' + what + ' ' + iv.number + '.pdf'), blob: TVEntry.invoicePdf(A.einvoiceDoc(iv), TVExport), text: what + ' ' + iv.number + ' dated ' + A.fmtDate(iv.date) + ' for Rs ' + fmt(iv.total) + ' from ' + S.company.name + '.' }; } }] }); break; }
        case 'lock': setPin(); break;
        case 'backup': backup(); break;
        case 'restore': { var inp = document.getElementById('restore-file'); inp.onchange = function () { if (inp.files[0]) restore(inp.files[0]); inp.value = ''; }; inp.click(); break; }
      }
    } catch (err) { toast('Action failed: ' + err.message, 5000); }
  });

  window.TVF = { actions: actions, ledgerActions: ledgerActions, ledgerMonthlyCard: ledgerMonthlyCard, reportSections: reportSections, reportActions: reportActions, reportData: reportData, homeWidgets: homeWidgets, voucherActions: voucherActions, moreRows: moreRows, showLock: showLock, relock: relock, tableCard: tableCard, share: share, whatsappSheet: whatsappSheet, pins: pins };
})();
