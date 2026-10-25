// A minimal in-process imitation of the NIC e-Invoice portal, used by the tests.
// It performs the inverse of every cryptographic step the client performs, so
// a passing test proves the client speaks the protocol end to end.

import { createServer } from 'node:http';
import { constants, createCipheriv, createDecipheriv, generateKeyPairSync, privateDecrypt, randomBytes } from 'node:crypto';

export function createMockIrp({ clientId, clientSecret, gstin, username, password, payloadEncoding = 'base64' } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });

  const state = {
    sessions: new Map(), // token -> { sek, expiresAt }
    irns: new Map(), // irn -> record
    authCalls: 0,
    invalidateTokens: false,
    lastRequest: null,
  };

  const aes = (key) => ({
    enc: (buf) => {
      const c = createCipheriv('aes-256-ecb', key, null);
      return Buffer.concat([c.update(buf), c.final()]).toString('base64');
    },
    dec: (b64) => {
      const d = createDecipheriv('aes-256-ecb', key, null);
      return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]);
    },
  });

  const server = createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const fail = (code, message, http = 200) => send(http, { Status: 0, ErrorDetails: [{ ErrorCode: code, ErrorMessage: message }] });

    const chunks = [];
    for await (const c of req) chunks.push(c);
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const body = rawBody ? JSON.parse(rawBody) : {};
    const h = req.headers;
    state.lastRequest = { method: req.method, url: req.url, headers: h, body };

    if (h.client_id !== clientId || h.client_secret !== clientSecret) return fail('1001', 'Invalid client id or secret', 401);
    if ((h.gstin ?? '').toUpperCase() !== gstin.toUpperCase()) return fail('1002', 'Invalid GSTIN header');

    // ------------------------------------------------------------ auth
    if (req.method === 'POST' && req.url === '/eivital/v1.04/auth') {
      state.authCalls++;
      let creds;
      try {
        const b64 = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(body.Data, 'base64')).toString('utf8');
        creds = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      } catch (err) {
        return fail('1004', `Unable to decrypt credentials: ${err.message}`);
      }
      if (creds.UserName !== username || creds.Password !== password) return fail('1003', 'Invalid user name or password');
      const appKey = Buffer.from(creds.AppKey, 'base64');
      if (appKey.length !== 32) return fail('1004', 'AppKey must be 32 bytes');

      const sek = randomBytes(32);
      const token = randomBytes(16).toString('hex');
      const expiresAt = Date.now() + 6 * 3600 * 1000;
      state.sessions.set(token, { sek, expiresAt });
      return send(200, {
        Status: 1,
        Data: {
          ClientId: clientId,
          UserName: username,
          AuthToken: token,
          Sek: aes(appKey).enc(sek),
          TokenExpiry: formatIst(expiresAt),
        },
      });
    }

    // ------------------------------------------------------------ authenticated APIs
    const session = state.sessions.get(h.authtoken);
    if (!session || state.invalidateTokens || h.user_name !== username) {
      return fail('1005', 'Invalid Token');
    }
    const { enc, dec } = aes(session.sek);
    const decryptPayload = () => {
      const plain = dec(body.Data).toString('utf8');
      return JSON.parse(payloadEncoding === 'base64' ? Buffer.from(plain, 'base64').toString('utf8') : plain);
    };
    const ok = (obj) => send(200, { Status: 1, Data: enc(Buffer.from(JSON.stringify(obj), 'utf8')) });

    if (req.method === 'GET' && req.url.startsWith('/eivital/v1.04/Master/gstin/')) {
      const g = decodeURIComponent(req.url.split('/').pop());
      return ok({ Gstin: g, TradeName: 'Mock Trader', LegalName: 'Mock Trader Pvt Ltd', StateCode: g.slice(0, 2), Status: 'ACT', PinCode: 560001 });
    }

    if (req.method === 'POST' && req.url === '/eicore/v1.03/Invoice') {
      let inv;
      try {
        inv = decryptPayload();
      } catch (err) {
        return fail('2000', `Could not decrypt/parse invoice: ${err.message}`);
      }
      if (inv.SellerDtls?.Gstin !== gstin) return fail('2211', 'Supplier GSTIN should match with GSTIN of the user');
      const key = `${inv.SellerDtls.Gstin}|${inv.DocDtls.Typ}|${inv.DocDtls.No}|${inv.DocDtls.Dt}`;
      for (const r of state.irns.values()) {
        if (r.key === key) return send(200, { Status: 0, ErrorDetails: [{ ErrorCode: '2150', ErrorMessage: 'Duplicate IRN' }], InfoDtls: [{ InfCd: 'DUPIRN', Desc: { Irn: r.Irn } }] });
      }
      const irn = randomBytes(32).toString('hex');
      const record = {
        key,
        AckNo: 100000000000000 + state.irns.size + 1,
        AckDt: formatIst(Date.now()),
        Irn: irn,
        SignedInvoice: fakeJwt({ data: JSON.stringify({ ...inv, Irn: irn }) }),
        SignedQRCode: fakeJwt({ data: JSON.stringify({ SellerGstin: inv.SellerDtls.Gstin, BuyerGstin: inv.BuyerDtls.Gstin, DocNo: inv.DocDtls.No, DocTyp: inv.DocDtls.Typ, DocDt: inv.DocDtls.Dt, TotInvVal: inv.ValDtls.TotInvVal, ItemCnt: inv.ItemList.length, MainHsnCode: inv.ItemList[0].HsnCd, Irn: irn }) }),
        Status: 'ACT',
        EwbNo: null,
        EwbDt: null,
        EwbValidTill: null,
        Remarks: null,
      };
      state.irns.set(irn, record);
      const { key: _k, ...response } = record;
      return ok(response);
    }

    if (req.method === 'GET' && req.url.startsWith('/eicore/v1.03/Invoice/irn/')) {
      const irn = decodeURIComponent(req.url.split('/').pop());
      const r = state.irns.get(irn);
      if (!r) return fail('2283', 'IRN details are not found');
      const { key: _k, ...response } = r;
      return ok(response);
    }

    if (req.method === 'POST' && req.url === '/eicore/v1.03/Invoice/Cancel') {
      const p = decryptPayload();
      const r = state.irns.get(p.Irn);
      if (!r) return fail('2283', 'IRN details are not found');
      if (r.Status === 'CNL') return fail('2270', 'IRN is already cancelled');
      r.Status = 'CNL';
      return ok({ Irn: p.Irn, CancelDate: formatIst(Date.now()) });
    }

    return send(404, { message: 'not found' });
  });

  return {
    server,
    state,
    publicKeyPem,
    async start() {
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      return `http://127.0.0.1:${server.address().port}`;
    },
    async stop() {
      await new Promise((r) => server.close(r));
    },
  };
}

function formatIst(ms) {
  const d = new Date(ms + 5.5 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function fakeJwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.${randomBytes(32).toString('base64url')}`;
}
