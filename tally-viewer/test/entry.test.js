'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers.js');
const TVEntry = globalThis.TVEntry;
const TVExport = globalThis.TVExport;

function invoice(extra) {
  const inv = {
    id: 'app:1', type: 'Sales', number: 'INV/001/25-26', date: 20250410,
    buyerLedger: 'Acme Traders', salesLedger: 'Sales', cgstLedger: 'Output CGST 9%', sgstLedger: 'Output SGST 9%', igstLedger: 'IGST18%', roundOffLedger: 'Round Off',
    buyer: { gstin: '29ABCDE1234F1Z5', name: 'Acme Traders Pvt Ltd', address1: '1 MG Road', address2: '', city: 'Bengaluru', pin: '560001', state: '29', pos: '29', phone: '', email: '' },
    items: [{ desc: 'Widget', hsn: '847130', isService: false, qty: 3, unit: 'NOS', rate: 333.33, discount: 0, gstRate: 18 }],
    interState: false, roundOff: true, irn: '', ackNo: '', ackDate: '', narration: ''
  };
  if (extra) Object.keys(extra).forEach(k => { inv[k] = extra[k]; });
  return inv;
}
function seller() { return { gstin: '27AAAAA0000A1Z5', name: 'Seller Traders', tradeName: 'Seller', address1: '2 Main St', city: 'Mumbai', pin: '400001', state: '27', phone: '', email: '' }; }
function sum(entries) { return Math.round(entries.reduce((a, e) => a + e.amount, 0) * 100) / 100 + 0; }

test('computeInvoice splits tax, rounds off and totals', () => {
  const c = TVEntry.computeInvoice(invoice());
  assert.equal(c.items[0].taxable, 999.99);
  assert.equal(c.items[0].cgst, 90);
  assert.equal(c.items[0].sgst, 90);
  assert.equal(c.totals.taxable, 999.99);
  assert.equal(c.totals.roundOff, 0.01);
  assert.equal(c.totals.total, 1180);
  const ig = TVEntry.computeInvoice(invoice({ interState: true }));
  assert.equal(ig.totals.igst, 180);
  assert.equal(ig.totals.cgst, 0);
});

test('invoiceEntries posts a sales invoice Dr party / Cr sales+tax and a credit note the other way', () => {
  const inv = invoice();
  const e = TVEntry.invoiceEntries(inv, 1);
  assert.deepEqual(e, [
    { ledger: 'Acme Traders', amount: -1180 }, { ledger: 'Sales', amount: 999.99 },
    { ledger: 'Output CGST 9%', amount: 90 }, { ledger: 'Output SGST 9%', amount: 90 }, { ledger: 'Round Off', amount: 0.01 }
  ]);
  assert.equal(sum(e), 0);
  const cn = TVEntry.invoiceEntries(inv, -1);
  assert.deepEqual(cn, [
    { ledger: 'Acme Traders', amount: 1180 }, { ledger: 'Sales', amount: -999.99 },
    { ledger: 'Output CGST 9%', amount: -90 }, { ledger: 'Output SGST 9%', amount: -90 }, { ledger: 'Round Off', amount: -0.01 }
  ]);
  assert.equal(sum(cn), 0);
  assert.equal(TVEntry.invoiceEntries(inv).length, 5, 'sign defaults to +1');
  assert.equal(TVEntry.invoiceEntries(inv)[0].amount, -1180);
  const igst = TVEntry.invoiceEntries(invoice({ interState: true, roundOffLedger: '' }), -1);
  assert.deepEqual(igst.map(x => x.ledger), ['Acme Traders', 'Sales', 'IGST18%']);
  assert.equal(igst[2].amount, -180);
  assert.ok(!Object.is(TVEntry.invoiceEntries(invoice({ items: [] }), -1)[0].amount, -0), 'no negative zero');
});

test('UQC list holds the common codes', () => {
  ['NOS', 'PCS', 'KGS', 'GMS', 'LTR', 'MTR', 'BOX', 'BAG', 'SET', 'PAC', 'DOZ', 'TON', 'QTL', 'SQM', 'SQF', 'CTN', 'BTL', 'CAN', 'ROL', 'UNT', 'OTH'].forEach(u => assert.ok(TVEntry.UQC.includes(u), u));
  assert.ok(Array.isArray(TVEntry.UQC));
});

test('eInvoiceChecks passes a clean B2B invoice and names each IRP rejection reason', () => {
  const ok = { number: 'INV/001/25-26', date: 20250410, docType: 'INV', seller: seller(), buyer: invoice().buyer, items: invoice().items, interState: false, roundOff: true };
  assert.deepEqual(TVEntry.eInvoiceChecks(ok), []);
  const svc = Object.assign({}, ok, { items: [{ desc: 'Consulting', hsn: '998311', isService: true, qty: 1, unit: '', rate: 1000, gstRate: 18 }] });
  assert.deepEqual(TVEntry.eInvoiceChecks(svc), [], 'a service with a 6-digit SAC and the default OTH unit passes');
  const bad = {
    number: '0INV#1', date: 20991231, seller: Object.assign(seller(), { name: 'AB', pin: '4001' }),
    buyer: Object.assign({}, ok.buyer, { name: 'X', pin: '', pos: '', state: '', gstin: '29ABCDE1234F1Z5' }),
    items: [{ desc: 'W', hsn: '8471', qty: 0, unit: 'PIECES', rate: 1, gstRate: 18 }]
  };
  const out = TVEntry.eInvoiceChecks(bad);
  const has = re => assert.ok(out.some(m => re.test(m)), 'expected ' + re + ' in ' + JSON.stringify(out));
  has(/Seller legal name/); has(/Buyer legal name/);
  has(/Seller PIN code must be 6 digits/); has(/Buyer PIN code must be 6 digits/);
  has(/Document number/);
  has(/after today/);
  has(/HSN must be 6 or 8 digits/); has(/quantity must be positive/); has(/unit "PIECES" is not a UQC code/);
  assert.ok(!out.some(m => /Place of supply/.test(m)), 'place of supply falls back to the GSTIN state');
  assert.ok(TVEntry.eInvoiceChecks(Object.assign({}, ok, { buyer: Object.assign({}, ok.buyer, { gstin: '', state: '', pos: '' }) })).some(m => /Place of supply/.test(m)));
  assert.ok(TVEntry.eInvoiceChecks(Object.assign({}, ok, { number: '/A1' })).some(m => /Document number/.test(m)));
  assert.ok(TVEntry.eInvoiceChecks(Object.assign({}, ok, { number: 'ABCDEFGHIJKLMNOPQ' })).some(m => /Document number/.test(m)), '17 chars rejected');
  assert.ok(TVEntry.eInvoiceChecks(Object.assign({}, ok, { number: 'INV-2025/0001' })).every(m => !/Document number/.test(m)));
  assert.ok(TVEntry.eInvoiceChecks(Object.assign({}, ok, { items: [Object.assign({}, ok.items[0], { hsn: '84713010' })] })).every(m => !/HSN/.test(m)), '8-digit HSN accepted');
  assert.ok(TVEntry.eInvoiceChecks(Object.assign({}, ok, { items: [Object.assign({}, ok.items[0], { hsn: '8471301' })] })).some(m => /HSN/.test(m)), '7-digit HSN rejected');
});

test('eInvoiceJson carries the preceding document for a credit note', () => {
  const doc = TVEntry.eInvoiceJson({ number: 'CN/1', date: 20250501, docType: 'CRN', refNumber: 'INV/001/25-26', refDate: 20250410, seller: seller(), buyer: invoice().buyer, items: invoice().items, interState: false, roundOff: true });
  assert.equal(doc.DocDtls.Typ, 'CRN');
  assert.deepEqual(doc.RefDtls, { PrecDocDtls: [{ InvNo: 'INV/001/25-26', InvDt: '10/04/2025' }] });
  assert.equal(TVEntry.eInvoiceJson({ number: 'I/1', date: 20250501, seller: seller(), buyer: invoice().buyer, items: invoice().items }).RefDtls, undefined);
});

test('tallyXml emits GST particulars, IRN and a New Ref bill for invoices and stays plain for other vouchers', () => {
  const inv = invoice({ irn: 'IRN123', ackNo: '112010012345678', ackDate: '2025-04-10 12:00:00' });
  const v = { id: 'app:1', source: 'app', date: 20250410, type: 'Sales', number: 'INV/001/25-26', party: 'Acme Traders', narration: 'Thanks & regards <test>', entries: TVEntry.invoiceEntries(inv, 1), invoice: inv };
  const xml = TVEntry.tallyXml([v], 'Seller & Co');
  assert.ok(xml.includes('<SVCURRENTCOMPANY>Seller &amp; Co</SVCURRENTCOMPANY>'));
  assert.ok(xml.includes('<NARRATION>Thanks &amp; regards &lt;test&gt;</NARRATION>'), 'text is escaped');
  assert.ok(xml.includes('<PARTYGSTIN>29ABCDE1234F1Z5</PARTYGSTIN>'));
  assert.ok(xml.includes('<PLACEOFSUPPLY>Karnataka</PLACEOFSUPPLY>'));
  assert.ok(xml.includes('<STATENAME>Karnataka</STATENAME>'));
  assert.ok(xml.includes('<BASICBUYERNAME>Acme Traders Pvt Ltd</BASICBUYERNAME>'));
  assert.ok(xml.includes('<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>'));
  assert.ok(xml.includes('<COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>'));
  assert.ok(xml.includes('<IRN>IRN123</IRN><IRNACKNO>112010012345678</IRNACKNO><IRNACKDATE>2025-04-10 12:00:00</IRNACKDATE>'));
  assert.ok(xml.includes('<LEDGERNAME>Acme Traders</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-1180.00</AMOUNT><BILLALLOCATIONS.LIST><NAME>INV/001/25-26</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>-1180.00</AMOUNT></BILLALLOCATIONS.LIST>'));
  assert.equal((xml.match(/BILLALLOCATIONS\.LIST>/g) || []).length, 2, 'only the party line carries the bill');
  assert.ok(xml.includes('<VOUCHER VCHTYPE="Sales" ACTION="Create"'));
  assert.ok(xml.includes('<ISINVOICE>No</ISINVOICE>'));
  const plain = TVEntry.tallyXml([{ date: 20250410, type: 'Payment', number: '5', party: 'Rent', entries: [{ ledger: 'Rent', amount: -500 }, { ledger: 'Cash', amount: 500 }] }], 'Co');
  assert.ok(!plain.includes('PARTYGSTIN') && !plain.includes('BILLALLOCATIONS') && !plain.includes('GSTREGISTRATIONTYPE'));
  const b2c = TVEntry.tallyXml([Object.assign({}, v, { invoice: invoice({ buyer: Object.assign({}, inv.buyer, { gstin: '' }) }) })], 'Co');
  assert.ok(b2c.includes('<GSTREGISTRATIONTYPE>Unregistered/Consumer</GSTREGISTRATIONTYPE>'));
  assert.ok(!b2c.includes('<PARTYGSTIN>'));
  assert.ok(b2c.includes('<PLACEOFSUPPLY>Karnataka</PLACEOFSUPPLY>'));
});

async function pdfText(blob) {
  const buf = Buffer.from(await blob.arrayBuffer());
  return buf.toString('latin1');
}

test('invoicePdf titles the document by type and prints reverse charge and the original invoice', async () => {
  const base = { number: 'INV/001/25-26', date: 20250410, seller: seller(), buyer: invoice().buyer, items: invoice().items, interState: false, roundOff: true, narration: '' };
  const inv = await pdfText(TVEntry.invoicePdf(Object.assign({}, base, { docType: 'INV' }), TVExport));
  assert.ok(inv.startsWith('%PDF'));
  assert.ok(inv.includes('(TAX INVOICE)'));
  assert.ok(inv.includes('(Reverse charge)') && inv.includes('(No)'));
  assert.ok(!inv.includes('Against invoice'));
  const crn = await pdfText(TVEntry.invoicePdf(Object.assign({}, base, { number: 'CN/1', docType: 'CRN', refNumber: 'INV/001/25-26', refDate: 20250410 }), TVExport));
  assert.ok(crn.includes('(CREDIT NOTE)'));
  assert.ok(!crn.includes('(TAX INVOICE)'));
  assert.ok(crn.includes('(Against invoice no.)'));
  assert.ok(crn.includes('(INV/001/25-26 dated 10-Apr-2025)'));
  assert.ok(crn.includes('(Note total)'));
  const dbn = await pdfText(TVEntry.invoicePdf(Object.assign({}, base, { docType: 'DBN', refNumber: 'INV/001/25-26', refDate: '10-Apr-2025' }), TVExport));
  assert.ok(dbn.includes('(DEBIT NOTE)'));
  assert.ok(dbn.includes('(INV/001/25-26 dated 10-Apr-2025)'));
  const rc = await pdfText(TVEntry.invoicePdf(Object.assign({}, base, { reverseCharge: true }), TVExport));
  assert.ok(rc.includes('(Yes)'));
});

test('existing TVEntry exports are kept', () => {
  ['STATE_CODES', 'STATE_NAMES', 'stateCode', 'stateFromGstin', 'validGstin', 'amountInWords', 'computeInvoice', 'tallyXml', 'eInvoiceJson', 'eInvoiceChecks', 'ddmmyyyy', 'invoicePdf', 'confirmationPdf', 'ledgerSummaryText', 'reminderText', 'invoiceEntries', 'UQC'].forEach(k => assert.ok(TVEntry[k], k));
  assert.equal(TVEntry.amountInWords(1180), 'Rupees One Thousand One Hundred Eighty Only');
});
