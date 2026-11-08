'use strict';
// Loads the DOM-free core modules onto globalThis (each one attaches itself) and provides small fixtures.
// version.js is owned by another part of the release; the models fall back to schema 2 when it is absent.
try { require('../js/version.js'); } catch (e) { /* optional */ }
require('../js/model.js');
require('../js/entry.js');
require('../js/export.js');
require('../js/tallyparse.js');
require('../js/tallydb.js');

var TVModel = globalThis.TVModel;

function ledger(name, parent, opening, extra) {
  var l = { name: name, parent: parent, opening: opening || 0 };
  if (extra) Object.keys(extra).forEach(function (k) { l[k] = extra[k]; });
  return l;
}
// A small chart of accounts: cash, bank, debtor, creditor, sales, purchase, expenses, GST ledgers, capital.
function chart() {
  var groups = {
    'Cash-in-Hand': { name: 'Cash-in-Hand', parent: 'Current Assets' },
    'Bank Accounts': { name: 'Bank Accounts', parent: 'Current Assets' },
    'Sundry Debtors': { name: 'Sundry Debtors', parent: 'Current Assets' },
    'Sundry Creditors': { name: 'Sundry Creditors', parent: 'Current Liabilities' },
    'Duties & Taxes': { name: 'Duties & Taxes', parent: 'Current Liabilities' },
    'Current Assets': { name: 'Current Assets', parent: '' },
    'Current Liabilities': { name: 'Current Liabilities', parent: '' },
    'Capital Account': { name: 'Capital Account', parent: '' },
    'Sales Accounts': { name: 'Sales Accounts', parent: '' },
    'Purchase Accounts': { name: 'Purchase Accounts', parent: '' },
    'Indirect Expenses': { name: 'Indirect Expenses', parent: '' },
    'Stock-in-Hand': { name: 'Stock-in-Hand', parent: 'Current Assets' }
  };
  var ledgers = {};
  [
    ledger('Cash', 'Cash-in-Hand', -10000),
    ledger('HDFC Bank', 'Bank Accounts', -50000),
    ledger('Acme Traders', 'Sundry Debtors', -5000, { gstin: '29ABCDE1234F1Z5' }),
    ledger('Zeta Suppliers', 'Sundry Creditors', 20000),
    ledger('Capital', 'Capital Account', 35000),
    ledger('Sales', 'Sales Accounts', 0),
    ledger('Purchases', 'Purchase Accounts', 0),
    ledger('Purchase - Accessories', 'Purchase Accounts', 0),
    ledger('Bank Processing Charges', 'Indirect Expenses', 0),
    ledger('Rent', 'Indirect Expenses', 0),
    ledger('Output CGST 9%', 'Duties & Taxes', 0),
    ledger('Output SGST 9%', 'Duties & Taxes', 0),
    ledger('IGST18%', 'Duties & Taxes', 0),
    ledger('Input CGST', 'Duties & Taxes', 0),
    ledger('Input SGST', 'Duties & Taxes', 0),
    ledger('GST Payable', 'Duties & Taxes', 0),
    ledger('TDS on Rent', 'Duties & Taxes', 0),
    ledger('Stock', 'Stock-in-Hand', -1000)
  ].forEach(function (l) { ledgers[l.name] = l; });
  return { groups: groups, ledgers: ledgers };
}
function data(id) {
  var d = TVModel.emptyData(id || 'c1'), c = chart();
  d.groups = c.groups; d.ledgers = c.ledgers;
  return d;
}
var seq = 0;
// voucher(date, type, number, [[ledger, amount], ...], extra) — negative = Dr
function voucher(date, type, number, lines, extra) {
  var v = { id: 'tally:' + (++seq), date: date, type: type, number: number == null ? '' : String(number), ref: '', narration: '', party: '', cancelled: false, optional: false, postDated: false, entries: [], items: [] };
  lines.forEach(function (l) { v.entries.push({ ledger: l[0], amount: l[1] }); });
  if (v.entries.length) v.party = v.entries[0].ledger;
  if (extra) Object.keys(extra).forEach(function (k) { v[k] = extra[k]; });
  return v;
}
function appVoucher(date, type, number, lines, extra) {
  var v = voucher(date, type, number, lines, extra);
  v.id = 'app:' + (++seq); v.source = 'app';
  if (v.posted === undefined) v.posted = false;
  return v;
}
function result(vouchers, masters) {
  var r = { company: 'Test Co', companies: [], groups: [], ledgers: [], stockItems: [], stockGroups: [], units: [], voucherTypes: [], vouchers: vouchers || [], others: {}, warnings: [] };
  if (masters) Object.keys(masters).forEach(function (k) { r[k] = masters[k]; });
  return r;
}
function toArrayBuffer(buf) { return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); }

module.exports = { chart: chart, data: data, voucher: voucher, appVoucher: appVoucher, result: result, toArrayBuffer: toArrayBuffer };
