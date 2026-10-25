// Offline sanity checks for an e-invoice payload (schema INV-01 version 1.1).
// This catches the common rejections before a round trip to the portal; it is
// not a full implementation of the portal's validation rules.

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]{3}$/; // loose: sandbox test GSTINs end in "000"
const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/; // dd/mm/yyyy
const DOC_NO_RE = /^[A-Za-z0-9][A-Za-z0-9\/-]{0,15}$/;
const SUP_TYPES = new Set(['B2B', 'SEZWP', 'SEZWOP', 'EXPWP', 'EXPWOP', 'DEXP']);
const DOC_TYPES = new Set(['INV', 'CRN', 'DBN']);
const AMOUNT_TOLERANCE = 1; // portal allows ±1 on totals

/**
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validateInvoice(inv) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  if (!inv || typeof inv !== 'object') return { errors: ['Invoice must be a JSON object'], warnings };

  if (inv.Version !== '1.1') err(`Version must be "1.1" (got ${JSON.stringify(inv.Version)})`);

  // TranDtls
  const tran = inv.TranDtls ?? {};
  if (tran.TaxSch !== 'GST') err('TranDtls.TaxSch must be "GST"');
  if (!SUP_TYPES.has(tran.SupTyp)) err(`TranDtls.SupTyp must be one of ${[...SUP_TYPES].join(', ')}`);

  // DocDtls
  const doc = inv.DocDtls ?? {};
  if (!DOC_TYPES.has(doc.Typ)) err('DocDtls.Typ must be INV, CRN or DBN');
  if (!DOC_NO_RE.test(doc.No ?? '')) err('DocDtls.No must be 1-16 chars: letters, digits, "/" or "-", not starting with "/" or "-"');
  const docDate = parseDate(doc.Dt);
  if (!docDate) err('DocDtls.Dt must be a valid date in dd/mm/yyyy format');
  else if (docDate.getTime() > endOfToday()) err('DocDtls.Dt cannot be in the future');

  // Seller
  const seller = inv.SellerDtls ?? {};
  checkParty('SellerDtls', seller, { requireGstin: true, err, warn });

  // Buyer
  const buyer = inv.BuyerDtls ?? {};
  const isExport = ['EXPWP', 'EXPWOP'].includes(tran.SupTyp);
  if (isExport) {
    if (buyer.Gstin && buyer.Gstin !== 'URP') warn('BuyerDtls.Gstin should be "URP" for exports');
    if (buyer.Pos !== '96') err('BuyerDtls.Pos must be "96" for exports');
  } else {
    checkParty('BuyerDtls', buyer, { requireGstin: true, err, warn });
    if (!/^\d{2}$/.test(buyer.Pos ?? '')) err('BuyerDtls.Pos (place of supply state code) is required');
  }
  if (seller.Gstin && buyer.Gstin && seller.Gstin === buyer.Gstin) err('Seller and buyer GSTIN cannot be the same');

  // Items
  const items = Array.isArray(inv.ItemList) ? inv.ItemList : [];
  if (!items.length) err('ItemList must contain at least one item');
  let sumAss = 0, sumCgst = 0, sumSgst = 0, sumIgst = 0, sumCess = 0, sumStCess = 0, sumOth = 0, sumItemVal = 0;
  const interState = seller.Stcd && buyer.Pos && seller.Stcd !== buyer.Pos;
  items.forEach((it, i) => {
    const p = `ItemList[${i}]`;
    if (!it.SlNo) err(`${p}.SlNo is required`);
    if (!/^\d{4,8}$/.test(String(it.HsnCd ?? ''))) err(`${p}.HsnCd must be 4-8 digits`);
    if (!['Y', 'N'].includes(it.IsServc)) err(`${p}.IsServc must be "Y" or "N"`);
    for (const f of ['TotAmt', 'AssAmt', 'GstRt', 'TotItemVal']) {
      if (typeof it[f] !== 'number') err(`${p}.${f} must be a number`);
    }
    const n = (f) => Number(it[f] ?? 0);
    const expectedAss = n('TotAmt') - n('Discount');
    if (Math.abs(expectedAss - n('AssAmt')) > AMOUNT_TOLERANCE) {
      err(`${p}.AssAmt (${n('AssAmt')}) should equal TotAmt - Discount (${round(expectedAss)})`);
    }
    const expectedTax = round(n('AssAmt') * n('GstRt') / 100);
    const actualTax = round(n('CgstAmt') + n('SgstAmt') + n('IgstAmt'));
    if (Math.abs(expectedTax - actualTax) > AMOUNT_TOLERANCE) {
      err(`${p}: CGST+SGST+IGST (${actualTax}) does not match AssAmt × GstRt (${expectedTax})`);
    }
    if (interState && (n('CgstAmt') || n('SgstAmt'))) warn(`${p}: inter-state supply should use IGST, not CGST/SGST`);
    if (!interState && n('IgstAmt') && tran.IgstOnIntra !== 'Y') warn(`${p}: intra-state supply should use CGST/SGST unless IgstOnIntra is "Y"`);
    const expectedItemVal = round(
      n('AssAmt') + n('CgstAmt') + n('SgstAmt') + n('IgstAmt') + n('CesAmt') + n('CesNonAdvlAmt') + n('StateCesAmt') + n('StateCesNonAdvlAmt') + n('OthChrg'),
    );
    if (Math.abs(expectedItemVal - n('TotItemVal')) > AMOUNT_TOLERANCE) {
      err(`${p}.TotItemVal (${n('TotItemVal')}) should be ${expectedItemVal}`);
    }
    sumAss += n('AssAmt'); sumCgst += n('CgstAmt'); sumSgst += n('SgstAmt'); sumIgst += n('IgstAmt');
    sumCess += n('CesAmt') + n('CesNonAdvlAmt'); sumStCess += n('StateCesAmt') + n('StateCesNonAdvlAmt');
    sumOth += n('OthChrg'); sumItemVal += n('TotItemVal');
  });

  // Totals
  const val = inv.ValDtls ?? {};
  const v = (f) => Number(val[f] ?? 0);
  if (typeof val.TotInvVal !== 'number') err('ValDtls.TotInvVal must be a number');
  const checks = [
    ['AssVal', sumAss], ['CgstVal', sumCgst], ['SgstVal', sumSgst], ['IgstVal', sumIgst],
    ['CesVal', sumCess], ['StCesVal', sumStCess],
  ];
  for (const [field, expected] of checks) {
    if (Math.abs(v(field) - expected) > AMOUNT_TOLERANCE) err(`ValDtls.${field} (${v(field)}) should equal sum of items (${round(expected)})`);
  }
  const expectedTotal = round(sumItemVal + v('OthChrg') - v('Discount') + v('RndOffAmt'));
  if (Math.abs(v('TotInvVal') - expectedTotal) > AMOUNT_TOLERANCE) {
    err(`ValDtls.TotInvVal (${v('TotInvVal')}) should be ${expectedTotal} (sum of TotItemVal + OthChrg - Discount + RndOffAmt)`);
  }
  if (v('OthChrg') === 0 && sumOth > 0) warn('Items carry OthChrg but ValDtls.OthChrg is 0 (item-level charges are already inside TotItemVal; this is fine)');

  return { errors, warnings };
}

function checkParty(label, party, { requireGstin, err, warn }) {
  if (requireGstin && !GSTIN_RE.test(party.Gstin ?? '')) err(`${label}.Gstin is missing or malformed`);
  if (!party.LglNm) err(`${label}.LglNm (legal name) is required`);
  if (!party.Addr1) err(`${label}.Addr1 is required`);
  if (!party.Loc) err(`${label}.Loc is required`);
  if (!/^\d{6}$/.test(String(party.Pin ?? ''))) err(`${label}.Pin must be a 6-digit number`);
  if (!/^\d{2}$/.test(party.Stcd ?? '')) err(`${label}.Stcd (state code) must be 2 digits`);
  if (party.Gstin && party.Stcd && GSTIN_RE.test(party.Gstin) && party.Gstin.slice(0, 2) !== party.Stcd) {
    warn(`${label}.Stcd (${party.Stcd}) does not match the state code in the GSTIN (${party.Gstin.slice(0, 2)})`);
  }
}

function parseDate(s) {
  const m = DATE_RE.exec(s ?? '');
  if (!m) return null;
  const [, dd, mm, yyyy] = m.map(Number);
  const d = new Date(yyyy, mm - 1, dd);
  return d.getFullYear() === yyyy && d.getMonth() === mm - 1 && d.getDate() === dd ? d : null;
}

function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function round(n) {
  return Math.round(n * 100) / 100;
}

/** Today's date formatted as dd/mm/yyyy (the portal's date format). */
export function todayDdMmYyyy() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
