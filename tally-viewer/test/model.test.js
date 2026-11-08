'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.js');
const TVModel = globalThis.TVModel;
const Book = TVModel.Book;

function book(vouchers, extra) {
  const d = H.data();
  if (extra) Object.keys(extra).forEach(k => { d[k] = extra[k]; });
  d.vouchers = vouchers;
  return new Book(d);
}

test('compositeKey matches Book.build total and normalises the number', () => {
  const v = H.voucher(20250401, 'Receipt', ' R/01 ', [['HDFC Bank', -1000.005], ['Acme Traders', 1000.005]]);
  const b = book([v]);
  assert.equal(TVModel.compositeKey(v), '20250401|Receipt|r/01|' + b.vouchers[0].total.toFixed(2));
  assert.equal(TVModel.compositeKey(v), '20250401|Receipt|r/01|1000.01');
  assert.equal(TVModel.compositeKey({ date: 20250401, type: 'Journal', entries: [] }), '20250401|Journal||0.00');
});

test('mergeImport replaces a posted app voucher with its Tally twin and carries the app fields', () => {
  const d = H.data();
  const app = H.appVoucher(20250410, 'Sales', 'INV/001/25-26', [['Acme Traders', -1180], ['Sales', 1000], ['Output CGST 9%', 90], ['Output SGST 9%', 90]],
    { posted: true, postedAt: 123, createdAt: 100, invoice: { number: 'INV/001/25-26', irn: 'abc' } });
  const pending = H.appVoucher(20250411, 'Payment', '7', [['Rent', -500], ['Cash', 500]]);
  d.vouchers = [app, pending];
  new Book(d);
  const twin = H.voucher(20250410, 'Sales', 'INV/001/25-26', [['Acme Traders', -1180], ['Sales', 1000], ['Output CGST 9%', 90], ['Output SGST 9%', 90]]);
  twin.id = 'GUID-1';
  const other = H.voucher(20250412, 'Receipt', '9', [['HDFC Bank', -1180], ['Acme Traders', 1180]]);
  const counts = TVModel.mergeImport(d, H.result([twin, other]), { name: 'sync.xml', bytes: 10 });
  assert.equal(counts.vouchers.matched, 1);
  assert.equal(counts.vouchers.added, 1);
  assert.equal(d.vouchers.length, 3, 'the matched voucher is replaced in place, not duplicated');
  const kept = d.vouchers.find(v => v.id === 'GUID-1');
  assert.ok(kept, 'the Tally copy is stored');
  assert.equal(kept.appId, app.id);
  assert.equal(kept.fromApp, true);
  assert.equal(kept.createdAt, 100);
  assert.equal(kept.postedAt, 123);
  assert.deepEqual(kept.invoice, { number: 'INV/001/25-26', irn: 'abc' });
  assert.ok(!d.vouchers.some(v => v.id === app.id), 'the app voucher itself is gone');
  assert.ok(d.vouchers.some(v => v.id === pending.id), 'an unposted app voucher is untouched');
  // the same voucher syncing again updates in place and keeps the carried fields
  const twin2 = H.voucher(20250410, 'Sales', 'INV/001/25-26', [['Acme Traders', -1180], ['Sales', 1000], ['Output CGST 9%', 90], ['Output SGST 9%', 90]]);
  twin2.id = 'GUID-1'; twin2.narration = 'edited in Tally';
  const c2 = TVModel.mergeImport(d, H.result([twin2]));
  assert.equal(c2.vouchers.updated, 1);
  assert.equal(c2.vouchers.matched, 0);
  const again = d.vouchers.find(v => v.id === 'GUID-1');
  assert.equal(again.narration, 'edited in Tally');
  assert.equal(again.appId, app.id);
  assert.equal(again.invoice.irn, 'abc');
  // balances count the transaction once
  const b = new Book(d);
  assert.equal(b.ledgerBalance('Acme Traders', 20250401, 20250430).debit, 1180);
  // files log carries the counts
  assert.equal(d.files.length, 1);
  assert.equal(d.files[0].counts.vouchers.matched, 1);
});

test('mergeImport does not match an unposted app voucher or one with a different total', () => {
  const d = H.data();
  const unposted = H.appVoucher(20250410, 'Sales', '1', [['Acme Traders', -100], ['Sales', 100]]);
  const posted = H.appVoucher(20250410, 'Sales', '2', [['Acme Traders', -200], ['Sales', 200]], { posted: true });
  d.vouchers = [unposted, posted];
  const t1 = H.voucher(20250410, 'Sales', '1', [['Acme Traders', -100], ['Sales', 100]]);
  const t2 = H.voucher(20250410, 'Sales', '2', [['Acme Traders', -250], ['Sales', 250]]);
  const counts = TVModel.mergeImport(d, H.result([t1, t2]));
  assert.equal(counts.vouchers.matched, 0);
  assert.equal(counts.vouchers.added, 2);
  assert.equal(d.vouchers.length, 4);
});

test('mergeImport is used per result object by Wi-Fi sync: several merges into one data object', () => {
  const d = H.data();
  const app = H.appVoucher(20250505, 'Receipt', '3', [['Cash', -700], ['Acme Traders', 700]], { posted: true });
  d.vouchers = [app];
  const apr = H.voucher(20250401, 'Receipt', '1', [['Cash', -100], ['Acme Traders', 100]]);
  const may = H.voucher(20250505, 'Receipt', '3', [['Cash', -700], ['Acme Traders', 700]]);
  TVModel.mergeImport(d, H.result([apr]));
  const c = TVModel.mergeImport(d, H.result([may]));
  assert.equal(c.vouchers.matched, 1);
  assert.deepEqual(d.vouchers.map(v => v.date), [20250401, 20250505]);
  assert.equal(d.vouchers[1].id, may.id);
});

test('Book.build marks a posted app voucher superseded when the Tally twin is already stored', () => {
  const app = H.appVoucher(20250410, 'Payment', '12', [['Rent', -5000], ['HDFC Bank', 5000]], { posted: true });
  const twin = H.voucher(20250410, 'Payment', '12', [['Rent', -5000], ['HDFC Bank', 5000]]);
  const pendingApp = H.appVoucher(20250411, 'Payment', '13', [['Rent', -100], ['Cash', 100]]);
  const b = book([twin, app, pendingApp]);
  const sup = b.vouchers.find(v => v.id === app.id);
  assert.equal(sup.superseded, true);
  assert.equal(sup.affects, false);
  assert.equal(b.vouchers.find(v => v.id === pendingApp.id).superseded, false);
  assert.equal(b.vouchers.find(v => v.id === pendingApp.id).affects, true);
  assert.equal(b.vouchers.find(v => v.id === twin.id).affects, true);
  assert.equal(b.ledgerBalance('Rent', 20250401, 20250430).debit, 5100, 'the posted twin pair counts once; the pending entry still counts');
  assert.equal(b.vouchers.length, 3, 'superseded vouchers stay listed');
});

test('Book.build precomputes a non-persisted search haystack used by vouchersIn', () => {
  const v = H.voucher(20250410, 'Sales', 'INV-7', [['Acme Traders', -118], ['Sales', 118]], { narration: 'Blue Widgets', items: [{ item: 'Widget XL', qty: 2, unit: 'NOS', amount: 100 }] });
  const b = book([v]);
  assert.equal(typeof b.vouchers[0].hay, 'string');
  assert.ok(b.vouchers[0].hay.indexOf('acme traders') !== -1);
  assert.ok(b.vouchers[0].hay.indexOf('widget xl') !== -1);
  assert.ok(!Object.keys(b.vouchers[0]).includes('hay'), 'hay is not enumerable, so it is not stored or backed up');
  assert.equal(JSON.parse(JSON.stringify(b.vouchers[0])).hay, undefined);
  assert.equal(b.vouchersIn(20250401, 20250430, { q: 'widget' }).length, 1);
  assert.equal(b.vouchersIn(20250401, 20250430, { q: 'INV-7' }).length, 1);
  assert.equal(b.vouchersIn(20250401, 20250430, { q: 'nothing here' }).length, 0);
  assert.equal(b.vouchersIn(20250401, 20250430, { type: 'Sales' }).length, 1);
});

test('resetForSnapshot drops masters and Tally vouchers, keeps app entries and reverts matched twins', () => {
  const d = H.data();
  const app = H.appVoucher(20250410, 'Payment', '1', [['Rent', -5000], ['HDFC Bank', 5000]]);
  const tally = H.voucher(20250409, 'Receipt', '2', [['Cash', -100], ['Acme Traders', 100]]);
  const twin = H.voucher(20250411, 'Sales', '3', [['Acme Traders', -118], ['Sales', 118]], { fromApp: true, appId: 'app:old', invoice: { irn: 'x' }, postedAt: 5, tallyId: 77 });
  twin.id = 'GUID-3';
  d.vouchers = [tally, app, twin];
  d.stockItems = { A: { name: 'A' } }; d.voucherTypes = { Sales: { name: 'Sales', parent: '' } };
  const before = Date.now();
  TVModel.resetForSnapshot(d);
  ['groups', 'ledgers', 'stockItems', 'stockGroups', 'units', 'voucherTypes'].forEach(k => assert.deepEqual(d[k], {}, k + ' emptied'));
  assert.equal(d.vouchers.length, 2);
  assert.ok(d.vouchers.every(v => v.source === 'app'));
  const reverted = d.vouchers.find(v => v.id === 'app:old');
  assert.ok(reverted, 'the matched Tally copy becomes the app voucher again');
  assert.equal(reverted.posted, true);
  assert.equal(reverted.fromApp, undefined);
  assert.equal(reverted.tallyId, undefined);
  assert.deepEqual(reverted.invoice, { irn: 'x' });
  assert.ok(d.snapshotAt >= before);
  // the snapshot import then matches it again by content
  const fresh = H.voucher(20250411, 'Sales', '3', [['Acme Traders', -118], ['Sales', 118]]);
  fresh.id = 'GUID-3';
  const c = TVModel.mergeImport(d, H.result([fresh], { groups: Object.values(H.chart().groups), ledgers: Object.values(H.chart().ledgers) }));
  assert.equal(c.vouchers.matched, 1);
  assert.equal(d.vouchers.find(v => v.id === 'GUID-3').invoice.irn, 'x');
});

test('migrate fills missing arrays and stamps the schema; Book calls it', () => {
  const d = { id: 'x', vouchers: [{ date: 20250401, type: 'Journal', number: '' }] };
  TVModel.migrate(d);
  ['groups', 'ledgers', 'stockItems', 'stockGroups', 'units', 'voucherTypes'].forEach(k => assert.deepEqual(d[k], {}));
  assert.deepEqual(d.files, []);
  assert.deepEqual(d.vouchers[0].entries, []);
  assert.deepEqual(d.vouchers[0].items, []);
  assert.equal(d.schema, globalThis.TV_DATA_SCHEMA || 2);
  const b = new Book({ id: 'y' });
  assert.equal(b.data.schema, globalThis.TV_DATA_SCHEMA || 2);
  assert.equal(TVModel.emptyData('z').schema, globalThis.TV_DATA_SCHEMA || 2);
  assert.equal(b.vouchers.length, 0);
});

test('voucherSort orders by date then numeric-aware number with one shared collator', () => {
  const list = [H.voucher(20250402, 'Sales', '10', []), H.voucher(20250401, 'Sales', '2', []), H.voucher(20250402, 'Sales', '9', []), H.voucher(20250402, 'Sales', '', [])];
  list.sort(TVModel.voucherSort);
  assert.deepEqual(list.map(v => v.date + ':' + v.number), ['20250401:2', '20250402:', '20250402:9', '20250402:10']);
  assert.equal(typeof TVModel.voucherSort, 'function');
});

test('ledgerBalance.count counts only entries inside the period', () => {
  const b = book([
    H.voucher(20250301, 'Receipt', '1', [['Cash', -10], ['Acme Traders', 10]]),
    H.voucher(20250405, 'Receipt', '2', [['Cash', -20], ['Acme Traders', 20]]),
    H.voucher(20250505, 'Receipt', '3', [['Cash', -30], ['Acme Traders', 30]])
  ]);
  const bl = b.ledgerBalance('Cash', 20250401, 20250430);
  assert.equal(bl.count, 1);
  assert.equal(bl.opening, -10010);
  assert.equal(bl.debit, 20);
  assert.equal(b.ledgerBalance('Cash', 20250101, 20251231).count, 3);
});

test('nextNumber keeps a financial-year suffix and increments the serial', () => {
  const b = book([
    H.voucher(20250401, 'Sales', 'INV/001/25-26', [['Acme Traders', -1], ['Sales', 1]]),
    H.voucher(20250402, 'Sales', 'INV/002/25-26', [['Acme Traders', -1], ['Sales', 1]])
  ]);
  assert.equal(b.nextNumber('Sales'), 'INV/003/25-26');
});

test('nextNumber follows the most recent voucher when the FY suffix changes', () => {
  const b = book([
    H.voucher(20250301, 'Sales', 'INV/120/24-25', [['Acme Traders', -1], ['Sales', 1]]),
    H.voucher(20250331, 'Sales', 'INV/121/24-25', [['Acme Traders', -1], ['Sales', 1]]),
    H.voucher(20250401, 'Sales', 'INV/001/25-26', [['Acme Traders', -1], ['Sales', 1]])
  ]);
  assert.equal(b.nextNumber('Sales'), 'INV/002/25-26');
});

test('nextNumber handles a FY prefix, plain serials, padding growth and 4-digit years', () => {
  assert.equal(book([H.voucher(20250401, 'Rental Charges', '25-26/RENT/023', [['Rent', -1], ['Cash', 1]]), H.voucher(20250402, 'Rental Charges', '25-26/RENT/024', [['Rent', -1], ['Cash', 1]])]).nextNumber('Rental Charges'), '25-26/RENT/025');
  assert.equal(book([H.voucher(20250401, 'Receipt', '41', []), H.voucher(20250402, 'Receipt', '42', [])]).nextNumber('Receipt'), '43');
  assert.equal(book([H.voucher(20250401, 'Receipt', '099', [])]).nextNumber('Receipt'), '100');
  assert.equal(book([H.voucher(20250401, 'Sales', 'INV-0042/2025-26', [])]).nextNumber('Sales'), 'INV-0043/2025-26');
  assert.equal(book([H.voucher(20250401, 'Sales', '2024-0001', [])]).nextNumber('Sales'), '2024-0002', 'a year-serial pair is not a FY token');
  assert.equal(book([H.voucher(20250401, 'Sales', '2025/7', [])]).nextNumber('Sales'), '2025/8');
  assert.equal(book([H.voucher(20250401, 'Sales', '2024', [])]).nextNumber('Sales'), '2025', 'a bare number is the serial even when it looks like a year');
  assert.deepEqual(TVModel.splitNumber('INV/001/24-25'), { prefix: 'INV/', serial: '001', suffix: '/24-25' });
});

test('nextNumber returns "" when no voucher of the type has a serial', () => {
  const b = book([H.voucher(20250401, 'Journal', 'ABC', []), H.voucher(20250402, 'Journal', '', [])]);
  assert.equal(b.nextNumber('Journal'), '');
  assert.equal(b.nextNumber('Sales'), '');
});

test('cashFlow nets each voucher and excludes contra and cash-to-bank transfers', () => {
  const b = book([
    H.voucher(20250405, 'Receipt', '1', [['HDFC Bank', -1000], ['Acme Traders', 1000]]),
    H.voucher(20250406, 'Contra', '2', [['HDFC Bank', -5000], ['Cash', 5000]]),
    H.voucher(20250407, 'Journal', '3', [['HDFC Bank', -300], ['Cash', 300]]),
    H.voucher(20250408, 'Payment', '4', [['Rent', -400], ['Cash', 100], ['HDFC Bank', 300]]),
    H.voucher(20250409, 'Payment', '5', [['Zeta Suppliers', -200], ['Cash', 200]])
  ]);
  const rows = b.cashFlow(20250401, 20250430);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].inflow, 1000);
  assert.equal(rows[0].outflow, 600);
  assert.equal(rows[0].net, 400);
});

test('gstSummary recognises tax ledgers only under Duties & Taxes with a GST-like name', () => {
  const b = book([
    H.voucher(20250405, 'Sales', '1', [['Acme Traders', -1180], ['Sales', 1000], ['Output CGST 9%', 90], ['Output SGST 9%', 90]]),
    H.voucher(20250406, 'Purchase', '2', [['Zeta Suppliers', 590], ['Purchase - Accessories', -500], ['Input CGST', -45], ['Input SGST', -45]])
  ]);
  const g = b.gstSummary(20250401, 20250430);
  const names = g.taxLedgers.map(t => t.name).sort();
  assert.deepEqual(names, ['IGST18%', 'Input CGST', 'Input SGST', 'Output CGST 9%', 'Output SGST 9%']);
  assert.ok(!names.includes('Purchase - Accessories'), 'cess substring in a purchase ledger does not count');
  assert.ok(!names.includes('Bank Processing Charges'));
  assert.ok(!names.includes('GST Payable'));
  assert.ok(!names.includes('TDS on Rent'));
  assert.equal(g.taxLedgers.find(t => t.name === 'Input CGST').kind, 'input');
  assert.equal(g.taxLedgers.find(t => t.name === 'Output CGST 9%').kind, 'output');
  assert.equal(g.months.length, 1);
  assert.equal(g.months[0].outward, 1000);
  assert.equal(g.months[0].outputTax, 180);
  assert.equal(g.months[0].inward, 500, 'the accessories line stays in inward supplies');
  assert.equal(g.months[0].inputTax, 90);
  assert.equal(g.parties[0].gstin, '29ABCDE1234F1Z5');
});

test('summary is memoised per period and reset by build', () => {
  const b = book([H.voucher(20250405, 'Sales', '1', [['Acme Traders', -100], ['Sales', 100]])]);
  const s1 = b.summary(20250401, 20250430);
  assert.equal(s1.sales, 100);
  assert.equal(b.summary(20250401, 20250430), s1, 'same object comes back');
  assert.ok(b.cache['s:20250401-20250430']);
  assert.notEqual(b.summary(20250401, 20250531), s1);
  b.build();
  assert.notEqual(b.summary(20250401, 20250430), s1, 'build clears the cache');
});

test('monthEnd gives the last day of the month, leap years included', () => {
  assert.equal(TVModel.monthEnd(202611), 20261130);
  assert.equal(TVModel.monthEnd(202602), 20260228);
  assert.equal(TVModel.monthEnd(202802), 20280229);
  assert.equal(TVModel.monthEnd(202512), 20251231);
  assert.equal(TVModel.monthEnd(202504), 20250430);
});

test('openingDifference is the signed sum of ledger openings', () => {
  const b = book([]);
  // chart: -10000 -50000 -5000 +20000 +35000 -1000 = -11000
  assert.equal(b.openingDifference(), -11000);
  const d = H.data(); d.ledgers.Capital.opening = 46000; d.vouchers = [];
  assert.equal(new Book(d).openingDifference(), 0);
});

test('stockValuation uses weighted average cost on magnitudes and returns null without values', () => {
  const d = H.data();
  d.stockItems = {
    Widget: { name: 'Widget', parent: 'Primary', unit: 'NOS', openingQty: 10, openingValue: -1000 },
    Gadget: { name: 'Gadget', parent: 'Primary', unit: 'NOS', openingQty: 0, openingValue: 0 }
  };
  d.vouchers = [
    H.voucher(20250405, 'Purchase', '1', [['Zeta Suppliers', 2400], ['Purchases', -2400]], { items: [{ item: 'Widget', qty: 10, unit: 'NOS', rate: 120, amount: -1200, dir: '' }, { item: 'Gadget', qty: 4, unit: 'NOS', rate: 300, amount: -1200, dir: '' }] }),
    H.voucher(20250410, 'Sales', '2', [['Acme Traders', -1500], ['Sales', 1500]], { items: [{ item: 'Widget', qty: 5, unit: 'NOS', rate: 300, amount: 1500, dir: '' }] })
  ];
  const b = new Book(d);
  assert.equal(b.stock.Widget.openingValue, 1000, 'buildStock stores -(openingValue)');
  const sv = b.stockValuation(20250401, 20250430);
  // Widget rate = (1000 + 1200) / (10 + 10) = 110; closing 15 × 110 = 1650; opening 10 × 110 = 1100
  // Gadget rate = 1200 / 4 = 300; closing 4 × 300 = 1200; opening 0
  assert.equal(sv.method, 'weighted average');
  assert.equal(sv.closing, 2850);
  assert.equal(sv.opening, 1100);
  // the period after: opening qty 15 for Widget, no inward → rate = |openingValue| 1000 / 15
  const sv2 = b.stockValuation(20250501, 20250531);
  assert.equal(sv2.opening, Math.round(15 * (1000 / 15) * 100) / 100);
  assert.equal(sv2.closing, sv2.opening);
  const e = H.data(); e.stockItems = { Thing: { name: 'Thing', parent: 'Primary', unit: 'NOS', openingQty: 3, openingValue: 0 } }; e.vouchers = [];
  assert.equal(new Book(e).stockValuation(20250401, 20250430), null);
  assert.equal(book([]).stockValuation(20250401, 20250430), null);
});

test('existing exports are kept', () => {
  ['Book', 'mergeImport', 'emptyData', 'NATURE', 'fyOf', 'fyRange', 'voucherKey', 'NON_ACCOUNTING', 'compositeKey', 'voucherSort', 'resetForSnapshot', 'migrate', 'monthEnd'].forEach(k => assert.ok(TVModel[k], k));
  const b = book([H.voucher(20250405, 'Sales', '1', [['Acme Traders', -100], ['Sales', 100]], { narration: 'n' })]);
  const v = b.vouchers[0];
  assert.equal(v.idx, 0); assert.equal(v.base, 'Sales'); assert.equal(v.affects, true); assert.equal(v.total, 100);
  assert.ok(b.ledgerEntries['Acme Traders']); assert.ok(b.ledgerNames.length); assert.ok(b.cache); assert.ok(b.stock);
});
