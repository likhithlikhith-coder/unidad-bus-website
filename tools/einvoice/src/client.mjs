// Client for the NIC e-Invoice API (Invoice Registration Portal).
// Spec: https://einv-apisandbox.nic.in (API specifications, version 1.03 / auth 1.04)

import {
  aesDecrypt,
  aesEncryptBase64,
  generateAppKey,
  rsaEncryptBase64,
} from './crypto.mjs';

/**
 * Invoice Registration Portals that expose the national e-invoice API.
 * All of them share the paths, headers and encryption below; they differ
 * in host name and public key. A null baseUrl means the portal publishes
 * its API host only inside the taxpayer's account, so it must be supplied
 * via EINV_BASE_URL.
 */
export const PORTALS = {
  nic: {
    name: 'NIC IRP (einvoice1)',
    sandbox: { baseUrl: 'https://einv-apisandbox.nic.in' },
    production: { baseUrl: 'https://einvoice1.gst.gov.in' },
    notes: 'Direct API access only for taxpayers above the NIC turnover threshold; others go through a GSP/ERP.',
  },
  iris: {
    name: 'IRIS IRP (einvoice6)',
    sandbox: { baseUrl: null, hint: 'IRIS portal → Sandbox → Sandbox Settings → Sandbox End Point' },
    production: { baseUrl: null, hint: 'IRIS portal → Production → API credentials / endpoints' },
    notes: 'Self-service direct API access for taxpayers; register at https://einvoice6.gst.gov.in',
  },
};

/** @deprecated kept for backwards compatibility; prefer PORTALS.nic */
export const ENVIRONMENTS = PORTALS.nic;

export const PATHS = {
  auth: '/eivital/v1.04/auth',
  gstin: '/eivital/v1.04/Master/gstin/',
  invoice: '/eicore/v1.03/Invoice',
  irn: '/eicore/v1.03/Invoice/irn/',
  cancel: '/eicore/v1.03/Invoice/Cancel',
};

export const CANCEL_REASONS = {
  1: 'Duplicate',
  2: 'Data entry mistake',
  3: 'Order cancelled',
  4: 'Others',
};

/** Reauthenticate when the token is this close to expiry. */
const TOKEN_EXPIRY_MARGIN_MS = 5 * 60 * 1000;
const INVALID_TOKEN_CODES = new Set(['1005', '1006', '1007']);

export class EInvoiceError extends Error {
  constructor(message, { code, details = [], info = [], httpStatus, raw } = {}) {
    super(message);
    this.name = 'EInvoiceError';
    this.code = code;
    this.details = details;
    this.info = info;
    this.httpStatus = httpStatus;
    this.raw = raw;
  }
}

/** In-memory token store; see FileTokenStore for the persistent one used by the CLI. */
export class MemoryTokenStore {
  #session = null;
  async load() {
    return this.#session;
  }
  async save(session) {
    this.#session = session;
  }
  async clear() {
    this.#session = null;
  }
}

export class EInvoiceClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl        Portal base URL (see PORTALS)
   * @param {string} opts.clientId
   * @param {string} opts.clientSecret
   * @param {string} opts.gstin          GSTIN the credentials belong to (seller)
   * @param {string} opts.username       API user name
   * @param {string} opts.password       API user password
   * @param {string} opts.publicKey      Portal RSA public key (PEM text)
   * @param {object} [opts.tokenStore]   {load, save, clear}; defaults to in-memory
   * @param {'base64'|'json'} [opts.payloadEncoding='base64'] encoding applied before AES
   * @param {Function} [opts.fetch]      fetch implementation (for tests)
   * @param {Function} [opts.log]        debug logger
   */
  constructor(opts) {
    const required = ['baseUrl', 'clientId', 'clientSecret', 'gstin', 'username', 'password', 'publicKey'];
    const missing = required.filter((k) => !opts?.[k]);
    if (missing.length) throw new Error(`EInvoiceClient: missing option(s): ${missing.join(', ')}`);

    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.gstin = opts.gstin;
    this.username = opts.username;
    this.password = opts.password;
    this.publicKey = opts.publicKey;
    this.tokenStore = opts.tokenStore ?? new MemoryTokenStore();
    this.payloadEncoding = opts.payloadEncoding ?? 'base64';
    this.fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.log = opts.log ?? (() => {});
    this.session = null;
  }

  // ---------------------------------------------------------------- auth

  /**
   * Obtain (or reuse) an AuthToken + session encryption key (SEK).
   * Tokens are valid for ~6 hours; the portal returns the same token for
   * repeat auth calls unless ForceRefreshAccessToken is true.
   */
  async authenticate({ force = false } = {}) {
    if (!force) {
      const cached = this.session ?? (await this.tokenStore.load());
      if (cached && this.#sessionUsable(cached)) {
        this.session = cached;
        this.log('auth: reusing cached token, expires', cached.tokenExpiry);
        return cached;
      }
    }

    const appKey = generateAppKey();
    const authPayload = JSON.stringify({
      UserName: this.username,
      Password: this.password,
      AppKey: appKey.toString('base64'),
      ForceRefreshAccessToken: force,
    });
    const body = { Data: rsaEncryptBase64(this.publicKey, Buffer.from(authPayload, 'utf8').toString('base64')) };

    const res = await this.#http('POST', PATHS.auth, {
      headers: { client_id: this.clientId, client_secret: this.clientSecret, Gstin: this.gstin },
      body,
    });
    const data = this.#unwrap(res);
    if (!data?.AuthToken || !data?.Sek) {
      throw new EInvoiceError('Auth response did not contain AuthToken and Sek', { raw: res });
    }

    const sek = aesDecrypt(appKey, data.Sek);
    if (sek.length !== 32) {
      throw new EInvoiceError(`Decrypted SEK has unexpected length ${sek.length} (expected 32)`, { raw: res });
    }

    this.session = {
      baseUrl: this.baseUrl,
      gstin: this.gstin,
      username: this.username,
      authToken: data.AuthToken,
      sek: sek.toString('base64'),
      tokenExpiry: data.TokenExpiry,
      tokenExpiryMs: parseTokenExpiry(data.TokenExpiry),
      obtainedAt: new Date().toISOString(),
    };
    await this.tokenStore.save(this.session);
    this.log('auth: new token, expires', this.session.tokenExpiry);
    return this.session;
  }

  #sessionUsable(session) {
    if (session.baseUrl !== this.baseUrl || session.gstin !== this.gstin || session.username !== this.username) return false;
    if (!session.authToken || !session.sek) return false;
    const expiry = session.tokenExpiryMs ?? parseTokenExpiry(session.tokenExpiry);
    return Number.isFinite(expiry) && expiry - Date.now() > TOKEN_EXPIRY_MARGIN_MS;
  }

  // ---------------------------------------------------------------- APIs

  /** Generate IRN. `invoice` is the e-invoice schema (INV-01, Version 1.1) object. */
  async generateIrn(invoice) {
    return this.call('POST', PATHS.invoice, invoice);
  }

  /** Fetch details of an existing IRN. */
  async getIrn(irn) {
    if (!irn) throw new Error('irn is required');
    return this.call('GET', PATHS.irn + encodeURIComponent(irn));
  }

  /** Cancel an IRN (allowed within 24 hours of generation). */
  async cancelIrn({ irn, reason, remarks }) {
    if (!irn) throw new Error('irn is required');
    const code = String(reason);
    if (!CANCEL_REASONS[code]) throw new Error(`reason must be one of ${Object.keys(CANCEL_REASONS).join(', ')}`);
    if (!remarks) throw new Error('remarks is required');
    return this.call('POST', PATHS.cancel, { Irn: irn, CnlRsn: code, CnlRem: remarks });
  }

  /** Look up a GSTIN on the portal (handy connectivity / credential check). */
  async getGstinDetails(gstin) {
    if (!gstin) throw new Error('gstin is required');
    return this.call('GET', PATHS.gstin + encodeURIComponent(gstin));
  }

  /**
   * Authenticated call: encrypts the body with the SEK, decrypts the response.
   * Retries once with a fresh token if the portal reports the token invalid.
   */
  async call(method, path, payload, { _retried = false } = {}) {
    const session = await this.authenticate();
    const sek = Buffer.from(session.sek, 'base64');

    let body;
    if (payload !== undefined) {
      const json = JSON.stringify(payload);
      const plain = this.payloadEncoding === 'json' ? json : Buffer.from(json, 'utf8').toString('base64');
      body = { Data: aesEncryptBase64(sek, plain) };
    }

    const res = await this.#http(method, path, {
      headers: {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        Gstin: this.gstin,
        user_name: this.username,
        AuthToken: session.authToken,
      },
      body,
    });

    try {
      const data = this.#unwrap(res);
      return typeof data === 'string' ? decryptResponseData(sek, data) : data;
    } catch (err) {
      if (!_retried && err instanceof EInvoiceError && INVALID_TOKEN_CODES.has(String(err.code))) {
        this.log('call: token rejected, re-authenticating');
        this.session = null;
        await this.tokenStore.clear?.();
        await this.authenticate({ force: true });
        return this.call(method, path, payload, { _retried: true });
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------- internals

  async #http(method, path, { headers, body }) {
    const url = this.baseUrl + path;
    this.log(`${method} ${url}`);
    let response;
    try {
      response = await this.fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new EInvoiceError(`Network error calling ${url}: ${err.message}`, { raw: err });
    }

    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      throw new EInvoiceError(`Portal returned non-JSON response (HTTP ${response.status}) from ${path}`, {
        httpStatus: response.status,
        raw: text,
      });
    }
    if (!response.ok && parsed?.Status === undefined) {
      throw new EInvoiceError(`HTTP ${response.status} from ${path}: ${summarize(parsed)}`, {
        httpStatus: response.status,
        raw: parsed,
      });
    }
    return parsed;
  }

  /** Returns `Data` from a Status=1 envelope, or throws a structured EInvoiceError. */
  #unwrap(res) {
    if (Number(res?.Status) === 1) return res.Data;
    const details = normalizeErrorDetails(res?.ErrorDetails);
    const info = Array.isArray(res?.InfoDtls) ? res.InfoDtls : [];
    const message = details.length
      ? details.map((d) => `${d.ErrorCode ?? '?'}: ${d.ErrorMessage ?? ''}`.trim()).join('; ')
      : `Portal returned Status ${res?.Status ?? 'unknown'}`;
    throw new EInvoiceError(message, { code: details[0]?.ErrorCode, details, info, raw: res });
  }
}

/** Decrypt an API response `Data` string with the SEK. Handles plain or base64-wrapped JSON. */
export function decryptResponseData(sek, data) {
  const plain = aesDecrypt(sek, data).toString('utf8');
  try {
    return JSON.parse(plain);
  } catch {
    // Some portal endpoints base64-encode the JSON before encrypting it.
    return JSON.parse(Buffer.from(plain, 'base64').toString('utf8'));
  }
}

/** ErrorDetails may be an array, a JSON string, or a base64-encoded JSON string. */
export function normalizeErrorDetails(details) {
  if (!details) return [];
  if (Array.isArray(details)) return details;
  if (typeof details === 'string') {
    for (const candidate of [details, safeBase64Decode(details)]) {
      if (!candidate) continue;
      try {
        const parsed = JSON.parse(candidate);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        /* try next */
      }
    }
    return [{ ErrorCode: undefined, ErrorMessage: details }];
  }
  return [details];
}

/** TokenExpiry is "YYYY-MM-DD HH:mm:ss" in IST (UTC+05:30). Returns epoch ms or NaN. */
export function parseTokenExpiry(value) {
  if (!value) return NaN;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return Date.parse(value);
  return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+05:30`);
}

function safeBase64Decode(s) {
  try {
    const out = Buffer.from(s, 'base64').toString('utf8');
    return /^[\s\[{"]/.test(out) ? out : null;
  } catch {
    return null;
  }
}

function summarize(obj) {
  const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return s.length > 300 ? s.slice(0, 300) + '…' : s;
}
