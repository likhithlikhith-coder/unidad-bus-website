'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers.js');
const TallyParse = globalThis.TallyParse;
const TVExport = globalThis.TVExport;

const PAYLOAD = '<img src=x onerror=1>';
const ESCAPED = '&lt;img src=x onerror=1&gt;';

test('tallyparse decodes an entity-escaped PARTYGSTIN to the raw string (XSS repro input for the UI)', () => {
  const xml = '<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA><TALLYMESSAGE>' +
    '<LEDGER NAME="Evil &amp; Co" ACTION="Create"><NAME.LIST><NAME>Evil &amp; Co</NAME></NAME.LIST><PARENT>Sundry Debtors</PARENT><PARTYGSTIN>' + ESCAPED + '</PARTYGSTIN><OPENINGBALANCE>-100</OPENINGBALANCE></LEDGER>' +
    '</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>';
  const r = TallyParse.parseTally(xml);
  assert.equal(r.ledgers.length, 1);
  assert.equal(r.ledgers[0].name, 'Evil & Co');
  assert.equal(r.ledgers[0].gstin, PAYLOAD, 'the decoded markup is preserved as data; every renderer must escape it');
  assert.equal(TallyParse.decodeEntities(ESCAPED), PAYLOAD);
  assert.equal(TallyParse.decodeEntities('&#60;b&#x3e;'), '<b>');
  assert.equal(TallyParse.decodeEntities('A &amp; B'), 'A & B');
});

test('tallyparse keeps a voucher narration with markup intact and balanced', () => {
  const xml = '<ENVELOPE><BODY><DATA><TALLYMESSAGE><VOUCHER VCHTYPE="Receipt" ACTION="Create"><GUID>g-1</GUID><DATE>20250410</DATE><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><VOUCHERNUMBER>7</VOUCHERNUMBER><PARTYLEDGERNAME>Evil &amp; Co</PARTYLEDGERNAME><NARRATION>' + ESCAPED + '</NARRATION>' +
    '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-100</AMOUNT></ALLLEDGERENTRIES.LIST>' +
    '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Evil &amp; Co</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>100</AMOUNT></ALLLEDGERENTRIES.LIST>' +
    '</VOUCHER></TALLYMESSAGE></DATA></BODY></ENVELOPE>';
  const r = TallyParse.parseTally(xml);
  assert.equal(r.vouchers.length, 1);
  assert.equal(r.vouchers[0].narration, PAYLOAD);
  assert.equal(r.vouchers[0].id, 'g-1');
  assert.equal(r.vouchers[0].unbalanced, undefined);
});

// The zip is store-only, so the sheet XML sits in the bytes verbatim.
async function sheetXml(blob) {
  const s = Buffer.from(await blob.arrayBuffer()).toString('utf8');
  const i = s.indexOf('<worksheet');
  assert.ok(i !== -1, 'worksheet part present');
  return s.slice(i, s.indexOf('</worksheet>', i) + 12);
}

test('xlsx export escapes markup and quotes in cells, sheet names and headers', async () => {
  const blob = TVExport.xlsx([{
    name: 'Ledgers <x>', title: ['Evil & Co', 'Period "A"'],
    columns: [{ title: 'Party <b>', width: 30 }, { title: 'Closing', width: 14, type: 'num' }],
    rows: [[PAYLOAD, 1234.5], [{ v: 'Bold & "quoted"', bold: true }, { v: 10, bold: true }], ['tab\there', null]],
    totals: [['Total', 1244.5]]
  }]);
  assert.ok(blob instanceof Blob);
  const all = Buffer.from(await blob.arrayBuffer()).toString('utf8');
  const sheet = await sheetXml(blob);
  assert.ok(sheet.includes(ESCAPED), 'cell text is entity-escaped');
  assert.ok(!sheet.includes(PAYLOAD), 'no raw markup reaches the sheet');
  assert.ok(sheet.includes('Party &lt;b&gt;'));
  assert.ok(sheet.includes('Evil &amp; Co'));
  assert.ok(sheet.includes('Period &quot;A&quot;'));
  assert.ok(sheet.includes('Bold &amp; &quot;quoted&quot;'));
  assert.ok(sheet.includes('<v>1234.5</v>'), 'numbers are numeric cells');
  assert.ok(sheet.includes('tab\there'), 'tabs survive, control characters are stripped');
  assert.ok(all.includes('<sheet name="Ledgers &lt;x&gt;" sheetId="1"'), 'sheet names are entity-escaped in workbook.xml');
  assert.ok(!all.includes('name="Ledgers <x>"'));
  assert.ok(!/<t[^>]*>[^<]*[\u0000-\u0008]/.test(sheet));
});
