// Cryptographic primitives used by the NIC e-Invoice (IRP) API.
//
//   Auth request  : Data = base64( RSA_PKCS1v15( portalPublicKey, base64(JSON) ) )
//   Sek           : AES-256-ECB( appKey ) -> 32 byte session encryption key
//   API request   : Data = base64( AES-256-ECB( sek, base64(JSON) ) )
//   API response  : JSON = AES-256-ECB-decrypt( sek, base64decode(Data) )
//
// AES is ECB with PKCS7 padding; Node's default padding for ECB is PKCS7.

import {
  constants,
  createCipheriv,
  createDecipheriv,
  publicEncrypt,
  randomBytes,
} from 'node:crypto';

/** Random 32-byte AppKey, sent (RSA-encrypted) to the portal during auth. */
export function generateAppKey() {
  return randomBytes(32);
}

/** RSA PKCS#1 v1.5 encrypt `plaintext` with the portal public key; returns base64. */
export function rsaEncryptBase64(publicKeyPem, plaintext) {
  const encrypted = publicEncrypt(
    { key: publicKeyPem, padding: constants.RSA_PKCS1_PADDING },
    Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8'),
  );
  return encrypted.toString('base64');
}

/** AES-256-ECB (PKCS7) encrypt; `key` is a 32-byte Buffer; returns base64. */
export function aesEncryptBase64(key, plaintext) {
  assertKey(key);
  const cipher = createCipheriv('aes-256-ecb', key, null);
  const input = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8');
  return Buffer.concat([cipher.update(input), cipher.final()]).toString('base64');
}

/** AES-256-ECB (PKCS7) decrypt a base64 ciphertext; returns a Buffer. */
export function aesDecrypt(key, base64Ciphertext) {
  assertKey(key);
  const decipher = createDecipheriv('aes-256-ecb', key, null);
  const input = Buffer.from(base64Ciphertext, 'base64');
  return Buffer.concat([decipher.update(input), decipher.final()]);
}

/**
 * Decode the payload of a JWS/JWT (e.g. SignedInvoice, SignedQRCode) WITHOUT
 * verifying the signature. Verification needs the portal's signing certificate.
 */
export function decodeJwtPayload(token) {
  const parts = String(token).trim().split('.');
  if (parts.length !== 3) throw new Error('Not a JWT: expected 3 dot-separated parts');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  // NIC wraps the actual document as a JSON string under "data".
  if (typeof payload.data === 'string') {
    try {
      payload.data = JSON.parse(payload.data);
    } catch {
      /* leave as string */
    }
  }
  return payload;
}

function assertKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error(`AES key must be a 32-byte Buffer, got ${Buffer.isBuffer(key) ? key.length + ' bytes' : typeof key}`);
  }
}
