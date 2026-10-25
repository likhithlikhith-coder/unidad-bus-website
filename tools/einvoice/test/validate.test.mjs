import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { todayDdMmYyyy, validateInvoice } from '../src/validate.mjs';
import { parseDotenv } from '../src/config.mjs';

const load = async () => JSON.parse(await readFile(new URL('../examples/sample-invoice.json', import.meta.url), 'utf8'));

test('sample invoice passes validation', async () => {
  const inv = await load();
  inv.DocDtls.Dt = todayDdMmYyyy();
  const { errors } = validateInvoice(inv);
  assert.deepEqual(errors, []);
});

test('detects arithmetic and structural problems', async () => {
  const inv = await load();
  inv.DocDtls.Dt = todayDdMmYyyy();
  inv.ItemList[0].TotItemVal = 999;
  inv.ValDtls.TotInvVal = 2000;
  inv.BuyerDtls.Gstin = 'BAD';
  inv.DocDtls.No = '/leading-slash';
  const { errors } = validateInvoice(inv);
  assert.ok(errors.some((e) => e.includes('TotItemVal')));
  assert.ok(errors.some((e) => e.includes('TotInvVal')));
  assert.ok(errors.some((e) => e.includes('BuyerDtls.Gstin')));
  assert.ok(errors.some((e) => e.includes('DocDtls.No')));
});

test('rejects future dates and bad date formats', async () => {
  const inv = await load();
  inv.DocDtls.Dt = '31/12/2999';
  assert.ok(validateInvoice(inv).errors.some((e) => e.includes('future')));
  inv.DocDtls.Dt = '2026-10-25';
  assert.ok(validateInvoice(inv).errors.some((e) => e.includes('dd/mm/yyyy')));
});

test('warns on CGST/SGST for inter-state supply', async () => {
  const inv = await load();
  inv.DocDtls.Dt = todayDdMmYyyy();
  inv.BuyerDtls.Pos = '27';
  const { warnings } = validateInvoice(inv);
  assert.ok(warnings.some((w) => w.includes('IGST')));
});

test('parseDotenv handles comments, quotes and export', () => {
  const env = parseDotenv('# c\nA=1\nexport B="two words"\nC=\'x=y\'\n\nbad line\n');
  assert.deepEqual(env, { A: '1', B: 'two words', C: 'x=y' });
});
