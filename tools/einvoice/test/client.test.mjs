import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EInvoiceClient, EInvoiceError, MemoryTokenStore } from '../src/client.mjs';
import { decodeJwtPayload } from '../src/crypto.mjs';
import { createMockIrp } from './mock-irp.mjs';

const CREDS = {
  clientId: 'AAJGKMC010',
  clientSecret: 'super-secret',
  gstin: '29AAAAA0000A1Z5',
  username: 'api_user',
  password: 'Pass@123',
};

let mock;
let baseUrl;
let sample;

before(async () => {
  mock = createMockIrp(CREDS);
  baseUrl = await mock.start();
  sample = JSON.parse(await readFile(new URL('../examples/sample-invoice.json', import.meta.url), 'utf8'));
});
after(() => mock.stop());

function makeClient(extra = {}) {
  return new EInvoiceClient({ baseUrl, ...CREDS, publicKey: mock.publicKeyPem, ...extra });
}

test('constructor reports missing options', () => {
  assert.throws(() => new EInvoiceClient({ baseUrl }), /missing option\(s\): clientId, clientSecret/);
});

test('authenticate: encrypts credentials, decrypts SEK and caches the token', async () => {
  const store = new MemoryTokenStore();
  const client = makeClient({ tokenStore: store });
  const before = mock.state.authCalls;

  const session = await client.authenticate();
  assert.equal(mock.state.authCalls, before + 1);
  assert.equal(Buffer.from(session.sek, 'base64').length, 32);
  assert.ok(session.tokenExpiryMs > Date.now() + 5 * 3600 * 1000);
  assert.deepEqual(await store.load(), session);

  // the auth request carried the right headers and an encrypted body
  const req = mock.state.lastRequest;
  assert.equal(req.headers.client_id, CREDS.clientId);
  assert.equal(req.headers.gstin, CREDS.gstin);
  assert.equal(typeof req.body.Data, 'string');
  assert.equal(Buffer.from(req.body.Data, 'base64').length, 256); // RSA-2048 block

  // second call reuses the cached session without hitting the portal
  const again = await makeClient({ tokenStore: store }).authenticate();
  assert.equal(mock.state.authCalls, before + 1);
  assert.equal(again.authToken, session.authToken);

  // force refresh gets a new token
  const fresh = await client.authenticate({ force: true });
  assert.equal(mock.state.authCalls, before + 2);
  assert.notEqual(fresh.authToken, session.authToken);
});

test('authenticate: wrong password surfaces the portal error code', async () => {
  const client = makeClient({ password: 'nope' });
  await assert.rejects(client.authenticate(), (err) => {
    assert.ok(err instanceof EInvoiceError);
    assert.equal(err.code, '1003');
    assert.match(err.message, /Invalid user name or password/);
    return true;
  });
});

test('generateIrn → getIrn → cancelIrn full flow', async () => {
  const client = makeClient();
  const invoice = structuredClone(sample);
  invoice.DocDtls.No = `TST/${Date.now().toString(36).toUpperCase()}`;

  const gen = await client.generateIrn(invoice);
  assert.equal(gen.Status, 'ACT');
  assert.match(gen.Irn, /^[0-9a-f]{64}$/);
  assert.ok(gen.AckNo);
  assert.equal(decodeJwtPayload(gen.SignedInvoice).data.DocDtls.No, invoice.DocDtls.No);
  assert.equal(decodeJwtPayload(gen.SignedQRCode).data.TotInvVal, invoice.ValDtls.TotInvVal);

  // request carried the authenticated headers
  const req = mock.state.lastRequest;
  assert.equal(req.headers.user_name, CREDS.username);
  assert.ok(req.headers.authtoken);
  assert.equal(req.headers.gstin, CREDS.gstin);

  const got = await client.getIrn(gen.Irn);
  assert.equal(got.Irn, gen.Irn);
  assert.equal(got.Status, 'ACT');

  // duplicate submission is reported with the portal's error + info details
  await assert.rejects(client.generateIrn(invoice), (err) => {
    assert.equal(err.code, '2150');
    assert.equal(err.info[0].Desc.Irn, gen.Irn);
    return true;
  });

  const cancelled = await client.cancelIrn({ irn: gen.Irn, reason: 2, remarks: 'wrong buyer' });
  assert.equal(cancelled.Irn, gen.Irn);
  assert.ok(cancelled.CancelDate);
  assert.equal((await client.getIrn(gen.Irn)).Status, 'CNL');

  await assert.rejects(client.cancelIrn({ irn: gen.Irn, reason: 9, remarks: 'x' }), /reason must be one of/);
});

test('generateIrn: seller GSTIN mismatch is a portal error', async () => {
  const client = makeClient();
  const invoice = structuredClone(sample);
  invoice.SellerDtls.Gstin = '27ZZZZZ9999Z1Z9';
  await assert.rejects(client.generateIrn(invoice), (err) => err.code === '2211');
});

test('getGstinDetails round trip', async () => {
  const data = await makeClient().getGstinDetails('29BBBBB0000B1Z5');
  assert.equal(data.Gstin, '29BBBBB0000B1Z5');
  assert.equal(data.StateCode, '29');
});

test('call: re-authenticates once when the portal rejects the token', async () => {
  const store = new MemoryTokenStore();
  const client = makeClient({ tokenStore: store });
  await client.authenticate();
  const first = client.session.authToken;

  // simulate the portal having expired our token: a stale token in the store
  await store.save({ ...client.session, authToken: 'stale-token' });
  client.session = null;
  const before = mock.state.authCalls;

  const data = await client.getGstinDetails('29BBBBB0000B1Z5');
  assert.equal(data.Gstin, '29BBBBB0000B1Z5');
  assert.equal(mock.state.authCalls, before + 1);
  assert.notEqual(client.session.authToken, 'stale-token');
  assert.notEqual(client.session.authToken, first);
});

test('call: a persistent token rejection is not retried forever', async () => {
  const client = makeClient();
  mock.state.invalidateTokens = true;
  try {
    const before = mock.state.authCalls;
    await assert.rejects(client.getGstinDetails('29BBBBB0000B1Z5'), (err) => err.code === '1005');
    assert.ok(mock.state.authCalls - before <= 2);
  } finally {
    mock.state.invalidateTokens = false;
  }
});

test('payloadEncoding=json is understood by a portal expecting plain JSON', async () => {
  const jsonMock = createMockIrp({ ...CREDS, payloadEncoding: 'json' });
  const url = await jsonMock.start();
  try {
    const client = new EInvoiceClient({ baseUrl: url, ...CREDS, publicKey: jsonMock.publicKeyPem, payloadEncoding: 'json' });
    const gen = await client.generateIrn(structuredClone(sample));
    assert.equal(gen.Status, 'ACT');
  } finally {
    await jsonMock.stop();
  }
});

test('network failures are wrapped in EInvoiceError', async () => {
  const client = new EInvoiceClient({ baseUrl: 'http://127.0.0.1:1', ...CREDS, publicKey: mock.publicKeyPem });
  await assert.rejects(client.authenticate(), (err) => err instanceof EInvoiceError && /Network error/.test(err.message));
});
