'use strict';
// Decodes a real TallyPrime company folder when it is available and checks that the books tie.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers.js');
const TVModel = globalThis.TVModel;
const TallyDB = globalThis.TallyDB;

const DIR = process.env.TALLY_DATA_DIR || '/tmp/claude-0/-home-user-unidad-bus-website/7b14f9a3-5ae7-522a-8960-21ac9fa1d3bb/scratchpad/tallydata/100000';
const FILES = ['Manager.1800', 'TranMgr.1800', 'Company.1800'];
const available = FILES.every(f => fs.existsSync(path.join(DIR, f)));

test('real folder decode: trial balance ties and the Book is consistent', { skip: available ? false : 'Tally data folder not present at ' + DIR }, () => {
  const files = {};
  FILES.forEach(f => { files[f] = H.toArrayBuffer(fs.readFileSync(path.join(DIR, f))); });
  const r = TallyDB.decodeFolder(files);
  assert.equal(r.source, 'tally-folder');
  assert.ok(r.company, 'company name decoded');
  assert.ok(r.ledgers.length > 0 && r.groups.length > 0 && r.vouchers.length > 0);
  r.vouchers.forEach(v => { assert.ok(v.id && v.date > 20000000 && v.entries.length, 'voucher ' + v.tallyId + ' has id, date and entries'); });

  const d = TVModel.emptyData('real');
  const counts = TVModel.mergeImport(d, r, { name: 'folder', bytes: 0 });
  assert.equal(counts.vouchers.added, r.vouchers.length);
  const b = new TVModel.Book(d);
  assert.equal(b.vouchers.length, r.vouchers.length);
  assert.ok(b.minDate > 0 && b.maxDate >= b.minDate);

  // Σ closing over every ledger = Σ opening + Σ unbalanced amounts of affecting vouchers (balanced vouchers net to zero).
  let close = 0, unbalanced = 0;
  b.ledgerNames.forEach(n => { close += b.ledgerBalance(n, b.minDate, b.maxDate).closing; });
  b.vouchers.forEach(v => { if (v.affects && v.unbalanced) unbalanced += v.unbalanced; });
  const diff = Math.abs(close - b.openingDifference() - unbalanced);
  assert.ok(diff < 0.01, 'trial balance ties: Σclosing ' + close.toFixed(2) + ' vs opening diff ' + b.openingDifference().toFixed(2) + ' + unbalanced ' + unbalanced.toFixed(2));

  // the tree agrees with the ledger walk
  const t = b.tree(b.minDate, b.maxDate);
  let treeClose = 0;
  t.roots.forEach(n => { treeClose += n.closing; });
  t.primaryLedgers.forEach(l => { treeClose += l.closing; });
  assert.ok(Math.abs(treeClose - close) < 0.01, 'tree total equals ledger total');

  // derived reports run without throwing on real data
  const s = b.summary(b.minDate, b.maxDate);
  assert.ok(typeof s.netProfit === 'number' && isFinite(s.netProfit));
  assert.ok(Array.isArray(b.cashFlow(b.minDate, b.maxDate)));
  assert.ok(Array.isArray(b.gstSummary(b.minDate, b.maxDate).taxLedgers));
  const sv = b.stockValuation(b.minDate, b.maxDate);
  assert.ok(sv === null || (isFinite(sv.opening) && isFinite(sv.closing)));
  // a FY-prefixed series present in this company: the serial, not the year, advances
  Object.keys(b.typeCounts).forEach(type => { const n = b.nextNumber(type); assert.equal(typeof n, 'string'); if (/^\d{2}-\d{2}\//.test(n)) assert.match(n, /^\d{2}-\d{2}\/[A-Z]+\/\d{3}$/); });
  // a second import of the same folder is idempotent
  const r2 = TallyDB.decodeFolder(files);
  const c2 = TVModel.mergeImport(d, r2);
  assert.equal(c2.vouchers.added, 0);
  assert.equal(c2.vouchers.updated, r.vouchers.length);
  assert.equal(d.vouchers.length, r.vouchers.length);
});
