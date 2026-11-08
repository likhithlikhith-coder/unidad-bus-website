/*
 * Voucher entry support: GST state codes, amount in words, invoice maths,
 * TallyPrime import XML and the NIC e-invoice JSON (schema 1.1).
 */
(function (root) {
  'use strict';

  var STATE_CODES = { 'jammu & kashmir': '01', 'jammu and kashmir': '01', 'himachal pradesh': '02', 'punjab': '03', 'chandigarh': '04', 'uttarakhand': '05', 'haryana': '06', 'delhi': '07', 'rajasthan': '08', 'uttar pradesh': '09', 'bihar': '10', 'sikkim': '11', 'arunachal pradesh': '12', 'nagaland': '13', 'manipur': '14', 'mizoram': '15', 'tripura': '16', 'meghalaya': '17', 'assam': '18', 'west bengal': '19', 'jharkhand': '20', 'odisha': '21', 'orissa': '21', 'chhattisgarh': '22', 'madhya pradesh': '23', 'gujarat': '24', 'daman & diu': '25', 'daman and diu': '25', 'dadra & nagar haveli': '26', 'dadra & nagar haveli and daman & diu': '26', 'maharashtra': '27', 'andhra pradesh': '37', 'karnataka': '29', 'goa': '30', 'lakshadweep': '31', 'kerala': '32', 'tamil nadu': '33', 'puducherry': '34', 'pondicherry': '34', 'andaman & nicobar islands': '35', 'andaman and nicobar islands': '35', 'telangana': '36', 'ladakh': '38', 'other territory': '97', 'other country': '96' };
  var STATE_NAMES = {};
  Object.keys(STATE_CODES).forEach(function (k) { if (!STATE_NAMES[STATE_CODES[k]]) STATE_NAMES[STATE_CODES[k]] = k.replace(/\b\w/g, function (c) { return c.toUpperCase(); }); });
  function stateCode(name) { if (!name) return ''; var n = String(name).trim().toLowerCase(); if (/^\d{2}$/.test(n)) return n; return STATE_CODES[n] || ''; }
  function stateFromGstin(gstin) { var m = /^(\d{2})[A-Z0-9]{13}$/i.exec(String(gstin || '').trim()); return m ? m[1] : ''; }
  function validGstin(g) { return /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(String(g || '').trim().toUpperCase()); }

  /* ---- amount in words (Indian system) ---------------------------------- */
  var ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  var TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function two(n) { return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''); }
  function three(n) { return (n >= 100 ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' : '') : '') + (n % 100 ? two(n % 100) : ''); }
  function words(n) {
    n = Math.floor(Math.abs(n));
    if (!n) return 'Zero';
    var parts = [], crore = Math.floor(n / 10000000), lakh = Math.floor((n % 10000000) / 100000), thousand = Math.floor((n % 100000) / 1000), rest = n % 1000;
    if (crore) parts.push(three(crore) + ' Crore');
    if (lakh) parts.push(two(lakh) + ' Lakh');
    if (thousand) parts.push(two(thousand) + ' Thousand');
    if (rest) parts.push(three(rest));
    return parts.join(' ');
  }
  function amountInWords(amount) {
    var r = Math.round(Math.abs(amount) * 100), rupees = Math.floor(r / 100), paise = r % 100;
    return 'Rupees ' + words(rupees) + (paise ? ' and ' + two(paise) + ' Paise' : '') + ' Only';
  }

  /* ---- invoice maths ------------------------------------------------------ */
  function r2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  // inv: { items: [{desc, hsn, qty, unit, rate, discount, gstRate, isService}], interState: bool, roundOff: bool }
  function computeInvoice(inv) {
    var items = (inv.items || []).map(function (it, i) {
      var qty = +it.qty || 0, rate = +it.rate || 0, disc = +it.discount || 0, gross = r2(qty * rate), taxable = r2(gross - disc), gst = +it.gstRate || 0;
      var tax = r2(taxable * gst / 100), half = r2(tax / 2);
      var o = { slNo: i + 1, desc: it.desc || '', hsn: it.hsn || '', qty: qty, unit: it.unit || (it.isService ? 'OTH' : 'NOS'), rate: rate, gross: gross, discount: disc, taxable: taxable, gstRate: gst, isService: !!it.isService, igst: 0, cgst: 0, sgst: 0 };
      if (inv.interState) o.igst = tax; else { o.cgst = half; o.sgst = r2(tax - half); }
      o.total = r2(taxable + o.igst + o.cgst + o.sgst);
      return o;
    });
    var t = { taxable: 0, cgst: 0, sgst: 0, igst: 0, discount: 0, gross: 0 };
    items.forEach(function (o) { t.taxable = r2(t.taxable + o.taxable); t.cgst = r2(t.cgst + o.cgst); t.sgst = r2(t.sgst + o.sgst); t.igst = r2(t.igst + o.igst); t.discount = r2(t.discount + o.discount); t.gross = r2(t.gross + o.gross); });
    var raw = r2(t.taxable + t.cgst + t.sgst + t.igst);
    t.roundOff = inv.roundOff === false ? 0 : r2(Math.round(raw) - raw);
    t.total = r2(raw + t.roundOff);
    return { items: items, totals: t };
  }

  /* ---- TallyPrime import XML ---------------------------------------------- */
  function x(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); }
  function fmtAmt(n) { return (Math.round(n * 100) / 100).toFixed(2); }
  // vouchers: app-created voucher objects {date, type, number, party, narration, entries:[{ledger, amount}]} (negative = Dr)
  function tallyXml(vouchers, companyName) {
    var msgs = vouchers.map(function (v) {
      var view = 'Accounting Voucher View';
      var s = '<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="' + x(v.type) + '" ACTION="Create" OBJVIEW="' + view + '">' +
        '<DATE>' + v.date + '</DATE><EFFECTIVEDATE>' + v.date + '</EFFECTIVEDATE><VOUCHERTYPENAME>' + x(v.type) + '</VOUCHERTYPENAME>' +
        (v.number ? '<VOUCHERNUMBER>' + x(v.number) + '</VOUCHERNUMBER>' : '') +
        (v.party ? '<PARTYLEDGERNAME>' + x(v.party) + '</PARTYLEDGERNAME>' : '') +
        (v.ref ? '<REFERENCE>' + x(v.ref) + '</REFERENCE>' : '') +
        (v.narration ? '<NARRATION>' + x(v.narration) + '</NARRATION>' : '') +
        '<PERSISTEDVIEW>' + view + '</PERSISTEDVIEW><ISINVOICE>No</ISINVOICE>';
      v.entries.forEach(function (e) {
        s += '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + x(e.ledger) + '</LEDGERNAME><ISDEEMEDPOSITIVE>' + (e.amount < 0 ? 'Yes' : 'No') + '</ISDEEMEDPOSITIVE><AMOUNT>' + fmtAmt(e.amount) + '</AMOUNT>';
        if (e.bills && e.bills.length) e.bills.forEach(function (b) { s += '<BILLALLOCATIONS.LIST><NAME>' + x(b.name) + '</NAME><BILLTYPE>' + x(b.type || 'New Ref') + '</BILLTYPE><AMOUNT>' + fmtAmt(b.amount) + '</AMOUNT></BILLALLOCATIONS.LIST>'; });
        s += '</ALLLEDGERENTRIES.LIST>';
      });
      return s + '</VOUCHER></TALLYMESSAGE>';
    });
    return '<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + x(companyName) + '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>' + msgs.join('') + '</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>';
  }

  /* ---- NIC e-invoice JSON (schema 1.1) ------------------------------------ */
  function ddmmyyyy(d) { var y = Math.floor(d / 10000), m = Math.floor(d / 100) % 100, dd = d % 100; return (dd < 10 ? '0' : '') + dd + '/' + (m < 10 ? '0' : '') + m + '/' + y; }
  function num(n) { return Math.round((+n || 0) * 100) / 100; }
  function cut(s, n) { return String(s || '').trim().slice(0, n); }
  // inv: { number, date, seller:{gstin,name,tradeName,address1,address2,city,pin,state,phone,email}, buyer:{...,pos}, items (computed), totals (computed), docType:'INV'|'CRN'|'DBN' }
  function eInvoiceJson(inv) {
    var calc = computeInvoice(inv), seller = inv.seller || {}, buyer = inv.buyer || {};
    var sStcd = stateCode(seller.state) || stateFromGstin(seller.gstin), bStcd = stateCode(buyer.state) || stateFromGstin(buyer.gstin);
    var pos = buyer.pos ? stateCode(buyer.pos) || buyer.pos : bStcd;
    var doc = {
      Version: '1.1',
      TranDtls: { TaxSch: 'GST', SupTyp: inv.supplyType || 'B2B', RegRev: inv.reverseCharge ? 'Y' : 'N', IgstOnIntra: 'N' },
      DocDtls: { Typ: inv.docType || 'INV', No: cut(inv.number, 16), Dt: ddmmyyyy(inv.date) },
      SellerDtls: { Gstin: cut(seller.gstin, 15).toUpperCase(), LglNm: cut(seller.name, 100), TrdNm: cut(seller.tradeName || seller.name, 100), Addr1: cut(seller.address1 || seller.address || '-', 100), Addr2: cut(seller.address2, 100) || undefined, Loc: cut(seller.city || seller.state || '-', 50), Pin: parseInt(seller.pin, 10) || 0, Stcd: sStcd, Ph: cut(seller.phone, 12) || undefined, Em: cut(seller.email, 100) || undefined },
      BuyerDtls: { Gstin: cut(buyer.gstin, 15).toUpperCase(), LglNm: cut(buyer.name, 100), TrdNm: cut(buyer.tradeName || buyer.name, 100), Pos: pos, Addr1: cut(buyer.address1 || buyer.address || '-', 100), Addr2: cut(buyer.address2, 100) || undefined, Loc: cut(buyer.city || buyer.state || '-', 50), Pin: parseInt(buyer.pin, 10) || 0, Stcd: bStcd, Ph: cut(buyer.phone, 12) || undefined, Em: cut(buyer.email, 100) || undefined },
      ItemList: calc.items.map(function (it) {
        return { SlNo: String(it.slNo), PrdDesc: cut(it.desc, 300), IsServc: it.isService ? 'Y' : 'N', HsnCd: cut(it.hsn, 8), Qty: num(it.qty), Unit: cut(it.unit, 8).toUpperCase() || 'NOS', UnitPrice: num(it.rate), TotAmt: num(it.gross), Discount: num(it.discount), PreTaxVal: num(it.taxable), AssAmt: num(it.taxable), GstRt: num(it.gstRate), IgstAmt: num(it.igst), CgstAmt: num(it.cgst), SgstAmt: num(it.sgst), CesRt: 0, CesAmt: 0, CesNonAdvlAmt: 0, StateCesRt: 0, StateCesAmt: 0, StateCesNonAdvlAmt: 0, OthChrg: 0, TotItemVal: num(it.total) };
      }),
      ValDtls: { AssVal: num(calc.totals.taxable), CgstVal: num(calc.totals.cgst), SgstVal: num(calc.totals.sgst), IgstVal: num(calc.totals.igst), CesVal: 0, StCesVal: 0, Discount: 0, OthChrg: 0, RndOffAmt: num(calc.totals.roundOff), TotInvVal: num(calc.totals.total) }
    };
    // drop undefined optional fields
    ['SellerDtls', 'BuyerDtls'].forEach(function (k) { Object.keys(doc[k]).forEach(function (f) { if (doc[k][f] === undefined || doc[k][f] === '') delete doc[k][f]; }); });
    return doc;
  }
  // Problems that would make the IRP reject the invoice; empty array = looks good
  function eInvoiceChecks(inv) {
    var out = [], s = inv.seller || {}, b = inv.buyer || {};
    if (!validGstin(s.gstin)) out.push('Seller GSTIN missing or invalid (set it under More → Company GST details).');
    if (!validGstin(b.gstin)) out.push('Buyer GSTIN missing or invalid (e-invoice applies to B2B invoices).');
    if (!(stateCode(s.state) || stateFromGstin(s.gstin))) out.push('Seller state not recognised.');
    if (!(stateCode(b.state) || stateFromGstin(b.gstin))) out.push('Buyer state not recognised.');
    if (!(parseInt(s.pin, 10) >= 100000)) out.push('Seller PIN code missing.');
    if (!(parseInt(b.pin, 10) >= 100000)) out.push('Buyer PIN code missing.');
    if (!inv.number) out.push('Invoice number missing.');
    if (!(inv.items || []).length) out.push('No items.');
    (inv.items || []).forEach(function (it, i) { if (!/^\d{4,8}$/.test(String(it.hsn || '').trim())) out.push('Item ' + (i + 1) + ': HSN/SAC must be 4 to 8 digits.'); if (!(+it.qty > 0)) out.push('Item ' + (i + 1) + ': quantity must be positive.'); });
    return out;
  }

  root.TVEntry = { STATE_CODES: STATE_CODES, STATE_NAMES: STATE_NAMES, stateCode: stateCode, stateFromGstin: stateFromGstin, validGstin: validGstin, amountInWords: amountInWords, computeInvoice: computeInvoice, tallyXml: tallyXml, eInvoiceJson: eInvoiceJson, eInvoiceChecks: eInvoiceChecks, ddmmyyyy: ddmmyyyy };
})(typeof self !== 'undefined' ? self : globalThis);

/* ---- GST tax invoice PDF (uses TVExport.PdfDoc) ---------------------------- */
(function (root) {
  'use strict';
  var E = root.TVEntry;
  function fmt(n) { return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
  function fdate(d) { var y = Math.floor(d / 10000), m = Math.floor(d / 100) % 100, dd = d % 100; return dd + '-' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] + '-' + y; }
  // inv: output of einvoiceDoc(): { number, date, seller, buyer, items, interState, roundOff, irn, ackNo, ackDate, narration }
  E.invoicePdf = function (inv, TVExport) {
    var calc = E.computeInvoice(inv), t = calc.totals, s = inv.seller || {}, b = inv.buyer || {};
    var d = new TVExport.PdfDoc({ footer: 'Generated ' + new Date().toLocaleString() + ' - Tally Viewer' }); d.newPage();
    var M = d.M, W = d.W, y = d.y, inter = !!inv.interState;
    d.text(W / 2, y - 12, 'TAX INVOICE', 13, true, 'c'); y -= 20;
    if (inv.irn) { d.text(W / 2, y - 7, 'e-Invoice', 8.5, false, 'c'); y -= 12; }
    // seller block
    d.text(M, y - 11, s.name || '', 12, true); y -= 15;
    [s.address1, s.address2, [s.city, s.state, s.pin].filter(Boolean).join(', '), s.gstin ? 'GSTIN: ' + s.gstin : '', [s.phone ? 'Ph: ' + s.phone : '', s.email].filter(Boolean).join('  ')].filter(Boolean).forEach(function (line) { d.text(M, y - 8, line, 8.5); y -= 11; });
    // invoice meta on the right
    var ry = d.y - 35, rx = W - M;
    [['Invoice No', inv.number], ['Date', fdate(inv.date)], ['Place of supply', E.STATE_NAMES[E.stateCode(b.pos || b.state) || E.stateFromGstin(b.gstin)] || (b.pos || b.state || '')], ['Supply type', inter ? 'Inter-state (IGST)' : 'Intra-state (CGST+SGST)']].forEach(function (p) { d.text(rx - 200, ry, p[0], 8); d.text(rx, ry, String(p[1] || ''), 8.5, true, 'r'); ry -= 11; });
    y = Math.min(y, ry) - 8;
    d.line(M, y, W - M, y, 0.5, 0.6); y -= 4;
    // buyer block
    d.text(M, y - 9, 'Bill to', 8, true); y -= 12;
    d.text(M, y - 10, b.name || '', 10, true); y -= 13;
    [b.address1, b.address2, [b.city, E.STATE_NAMES[E.stateCode(b.state) || E.stateFromGstin(b.gstin)] || b.state, b.pin].filter(Boolean).join(', '), b.gstin ? 'GSTIN: ' + b.gstin : 'Unregistered'].filter(Boolean).forEach(function (line) { d.text(M, y - 8, line, 8.5); y -= 11; });
    if (inv.irn) {
      d.text(M, y - 8, 'IRN: ' + inv.irn, 7.5); y -= 10;
      d.text(M, y - 8, 'Ack No: ' + (inv.ackNo || '') + '   Ack Date: ' + (inv.ackDate || ''), 7.5); y -= 10;
    }
    y -= 6; d.y = y;
    var cols = inter
      ? [{ title: '#', width: 18, align: 'c' }, { title: 'Description', width: 150, align: 'l' }, { title: 'HSN/SAC', width: 48, align: 'l' }, { title: 'Qty', width: 48, align: 'r' }, { title: 'Rate', width: 56, align: 'r' }, { title: 'Taxable', width: 62, align: 'r' }, { title: 'IGST %', width: 40, align: 'r' }, { title: 'IGST', width: 56, align: 'r' }, { title: 'Total', width: 65, align: 'r' }]
      : [{ title: '#', width: 18, align: 'c' }, { title: 'Description', width: 130, align: 'l' }, { title: 'HSN/SAC', width: 46, align: 'l' }, { title: 'Qty', width: 44, align: 'r' }, { title: 'Rate', width: 54, align: 'r' }, { title: 'Taxable', width: 60, align: 'r' }, { title: 'GST %', width: 38, align: 'r' }, { title: 'CGST', width: 50, align: 'r' }, { title: 'SGST', width: 50, align: 'r' }, { title: 'Total', width: 62, align: 'r' }];
    var rows = calc.items.map(function (it) {
      var base = [String(it.slNo), it.desc, it.hsn, fmt(it.qty).replace(/\.00$/, '') + ' ' + it.unit, fmt(it.rate), fmt(it.taxable), String(it.gstRate)];
      return inter ? base.concat([fmt(it.igst), fmt(it.total)]) : base.concat([fmt(it.cgst), fmt(it.sgst), fmt(it.total)]);
    });
    d.table(cols, rows, [], { fontSize: 8, onNewPage: function (dd) { dd.text(M, dd.y - 8, (s.name || '') + ' - Invoice ' + inv.number, 8); dd.y -= 14; } });
    // totals block (right aligned)
    y = d.y - 10;
    var lines = [['Taxable value', t.taxable]].concat(inter ? [['IGST', t.igst]] : [['CGST', t.cgst], ['SGST', t.sgst]]);
    if (t.roundOff) lines.push(['Round off', t.roundOff]);
    lines.forEach(function (p) { d.text(W - M - 200, y, p[0], 8.5); d.text(W - M, y, fmt(p[1]), 8.5, false, 'r'); y -= 12; });
    d.line(W - M - 210, y + 8, W - M, y + 8, 0.5, 0.6);
    d.text(W - M - 200, y - 2, 'Invoice total', 10, true); d.text(W - M, y - 2, 'Rs ' + fmt(t.total), 10, true, 'r'); y -= 16;
    d.y = y; y -= d.para(M, y, 'Amount in words: ' + E.amountInWords(t.total), 8.5, true, W - 2 * M);
    if (inv.narration) { y -= 4; y -= d.para(M, y, 'Note: ' + inv.narration, 8, false, W - 2 * M); }
    y -= 30;
    d.text(W - M, y, 'For ' + (s.name || ''), 9, true, 'r'); y -= 28;
    d.text(W - M, y, 'Authorised Signatory', 8.5, false, 'r');
    return d.finish();
  };
})(typeof self !== 'undefined' ? self : globalThis);

/* ---- Ledger confirmation letter and reminder text ------------------------- */
(function (root) {
  'use strict';
  var E = root.TVEntry;
  function fmt(n) { return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
  function fdate(d) { var y = Math.floor(d / 10000), m = Math.floor(d / 100) % 100, dd = d % 100; return dd + '-' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] + '-' + y; }
  function balText(n) { return Math.abs(n) < 0.005 ? 'Nil' : 'Rs ' + fmt(Math.abs(n)) + (n < 0 ? ' Dr' : ' Cr'); }
  // o: { company:{name,address,gstin,phone}, party:{name,address,gstin}, from, to, statement:{balance, rows}, kind:'debtor'|'creditor' }
  E.confirmationPdf = function (o, TVExport) {
    var d = new TVExport.PdfDoc({ footer: 'Generated ' + new Date().toLocaleString() + ' - Tally Viewer' }); d.newPage();
    var M = d.M, W = d.W, y = d.y, c = o.company || {}, p = o.party || {}, bl = o.statement.balance;
    d.text(M, y - 12, c.name || '', 13, true); y -= 16;
    [c.address, c.gstin ? 'GSTIN: ' + c.gstin : '', c.phone ? 'Ph: ' + c.phone : ''].filter(Boolean).forEach(function (l) { d.text(M, y - 8, l, 8.5); y -= 11; });
    y -= 6; d.line(M, y, W - M, y, 0.5, 0.6); y -= 16;
    d.text(W - M, y, 'Date: ' + fdate(o.to), 9, false, 'r');
    d.text(M, y, 'To,', 9); y -= 13;
    d.text(M, y, p.name || '', 10, true); y -= 13;
    [p.address, p.gstin ? 'GSTIN: ' + p.gstin : ''].filter(Boolean).forEach(function (l) { d.text(M, y, l, 8.5); y -= 11; });
    y -= 8;
    d.text(W / 2, y, 'CONFIRMATION OF ACCOUNT', 11, true, 'c'); y -= 18;
    var owes = (o.kind === 'debtor' && bl.closing < 0) || (o.kind === 'creditor' && bl.closing > 0);
    var intro = 'Dear Sir/Madam,\n\nWe give below the statement of your account in our books for the period ' + fdate(o.from) + ' to ' + fdate(o.to) + '. The closing balance as per our books is ' + balText(bl.closing) + (owes ? (o.kind === 'debtor' ? ' (receivable by us)' : ' (payable by us)') : '') + '. Kindly confirm the balance, or let us know of any discrepancy within 15 days, failing which the balance will be treated as confirmed.';
    intro.split('\n').forEach(function (para) { if (!para) { y -= 6; return; } y -= d.para(M, y, para, 9, false, W - 2 * M); });
    y -= 12; d.y = y;
    var cols = [{ title: 'Date', width: 60, align: 'l' }, { title: 'Particulars', width: 200, align: 'l' }, { title: 'Vch No', width: 60, align: 'l' }, { title: 'Debit', width: 80, align: 'r' }, { title: 'Credit', width: 80, align: 'r' }, { title: 'Balance', width: 95, align: 'r' }];
    var rows = [[fdate(o.from), 'Opening balance', '', '', '', balText(bl.opening)]].concat(o.statement.rows.map(function (x) { var v = x.voucher; return [fdate(x.date), (x.others.length ? x.others.join(', ') : v.type), v.number || '', x.amount < 0 ? fmt(-x.amount) : '', x.amount > 0 ? fmt(x.amount) : '', balText(x.balance)]; }));
    d.table(cols, rows, [['', 'Closing balance', '', fmt(bl.debit), fmt(bl.credit), balText(bl.closing)]], { fontSize: 8, onNewPage: function (dd) { dd.text(M, dd.y - 8, (c.name || '') + ' - Confirmation of account - ' + (p.name || ''), 8); dd.y -= 14; } });
    y = d.y - 30;
    if (y < M + 90) { d.newPage(); y = d.y - 20; }
    d.text(M, y, 'For ' + (c.name || ''), 9, true); d.text(W - M, y, 'Confirmed by ' + (p.name || ''), 9, true, 'r'); y -= 34;
    d.text(M, y, 'Authorised Signatory', 8.5); d.text(W - M, y, 'Authorised Signatory / Seal', 8.5, false, 'r');
    return d.finish();
  };
  // Short WhatsApp-ready texts
  E.ledgerSummaryText = function (o) {
    var bl = o.statement.balance;
    return 'Statement of account: ' + o.party.name + '\n' + o.company.name + '\nPeriod: ' + fdate(o.from) + ' to ' + fdate(o.to) +
      '\nOpening: ' + balText(bl.opening) + '\nDebits: Rs ' + fmt(bl.debit) + '\nCredits: Rs ' + fmt(bl.credit) + '\nClosing: ' + balText(bl.closing) + '\n' + o.statement.rows.length + ' transactions. Detailed statement attached.';
  };
  E.reminderText = function (o) {
    var bl = o.statement.balance, due = Math.abs(bl.closing);
    return 'Dear ' + o.party.name + ',\n\nThis is a gentle reminder that an amount of Rs ' + fmt(due) + ' is outstanding in your account with ' + o.company.name + ' as on ' + fdate(o.to) + '. Kindly arrange the payment at the earliest and share the details.\n\nThank you,\n' + o.company.name + (o.company.phone ? '\n' + o.company.phone : '');
  };
})(typeof self !== 'undefined' ? self : globalThis);
