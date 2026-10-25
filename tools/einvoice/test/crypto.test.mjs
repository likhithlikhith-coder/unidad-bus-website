import { test } from 'node:test';
import assert from 'node:assert/strict';
import { constants, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { aesDecrypt, aesEncryptBase64, decodeJwtPayload, generateAppKey, rsaEncryptBase64 } from '../src/crypto.mjs';
import { normalizeErrorDetails, parseTokenExpiry } from '../src/client.mjs';

test('AppKey is 32 random bytes', () => {
  const a = generateAppKey();
  const b = generateAppKey();
  assert.equal(a.length, 32);
  assert.notDeepEqual(a, b);
});

test('AES-256-ECB round trip with PKCS7 padding', () => {
  const key = generateAppKey();
  for (const text of ['', 'x', 'exactly sixteen!', JSON.stringify({ Irn: 'abc', CnlRsn: '1' })]) {
    const enc = aesEncryptBase64(key, text);
    assert.equal(aesDecrypt(key, enc).toString('utf8'), text);
    // ciphertext is always a whole number of 16-byte blocks, with one extra block when aligned
    assert.equal(Buffer.from(enc, 'base64').length, (Math.floor(Buffer.byteLength(text) / 16) + 1) * 16);
  }
});

test('AES rejects keys that are not 32 bytes', () => {
  assert.throws(() => aesEncryptBase64(Buffer.alloc(16), 'x'), /32-byte/);
});

test('RSA PKCS#1 v1.5 encryption is decryptable by the matching private key', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const payload = Buffer.from(JSON.stringify({ UserName: 'u', Password: 'p' })).toString('base64');
  const enc = rsaEncryptBase64(pem, payload);
  const dec = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(enc, 'base64'));
  assert.equal(dec.toString('utf8'), payload);
});

test('decodeJwtPayload unwraps the nested data JSON', () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'RS256' })}.${b64({ data: JSON.stringify({ Irn: 'xyz' }), iss: 'NIC' })}.sig`;
  assert.deepEqual(decodeJwtPayload(jwt), { data: { Irn: 'xyz' }, iss: 'NIC' });
  assert.throws(() => decodeJwtPayload('not-a-jwt'), /3 dot-separated/);
});

test('parseTokenExpiry treats the portal timestamp as IST', () => {
  assert.equal(parseTokenExpiry('2026-10-25 14:30:00'), Date.parse('2026-10-25T14:30:00+05:30'));
  assert.ok(Number.isNaN(parseTokenExpiry('')));
});

test('normalizeErrorDetails accepts arrays, JSON strings and base64 JSON strings', () => {
  const arr = [{ ErrorCode: '2150', ErrorMessage: 'Duplicate IRN' }];
  assert.deepEqual(normalizeErrorDetails(arr), arr);
  assert.deepEqual(normalizeErrorDetails(JSON.stringify(arr)), arr);
  assert.deepEqual(normalizeErrorDetails(Buffer.from(JSON.stringify(arr)).toString('base64')), arr);
  assert.deepEqual(normalizeErrorDetails('plain text'), [{ ErrorCode: undefined, ErrorMessage: 'plain text' }]);
  assert.deepEqual(normalizeErrorDetails(undefined), []);
});
