# einvoice — GST e-invoice (IRN) utility

A small, dependency-free Node.js command line tool and library that talks to the
NIC **e-Invoice portal (Invoice Registration Portal, IRP)** API to:

- authenticate and cache the session token,
- validate an invoice payload offline,
- **generate an IRN** (register an e-invoice) and save the signed invoice + QR code,
- fetch an IRN's details,
- cancel an IRN (within 24 hours),
- decode the signed invoice / signed QR code tokens.

It implements the NIC API specification (auth `eivital/v1.04`, invoice
`eicore/v1.03`) including its encryption scheme (RSA for the credentials,
AES-256-ECB with the session encryption key for every payload). Requires
Node.js 18.17 or newer. No `npm install` needed.

## 1. Get portal credentials

**Sandbox (start here).** Register at <https://einv-apisandbox.nic.in> with your
GSTIN. In the sandbox portal:

1. Note the **Client ID** and **Client Secret** issued to you.
2. Create **API user credentials** (user name + password) for your GSTIN.
3. Download the sandbox **public key** (PEM) from the API documentation / public key
   section and save it as `keys/sandbox.pem`.

**Production.** Direct API access on <https://einvoice1.gst.gov.in> is available
to taxpayers above the turnover threshold notified by NIC (with whitelisted IPs) and
to GSPs. Smaller taxpayers get API access through a GSP/ASP. Most GSPs mirror the NIC
paths on their own host; set `EINV_BASE_URL` to that host and `EINV_ENV=production`.
Save the production public key as `keys/production.pem`.

## 2. Configure

```bash
cd tools/einvoice
cp .env.example .env
# edit .env: EINV_CLIENT_ID, EINV_CLIENT_SECRET, EINV_GSTIN, EINV_USERNAME, EINV_PASSWORD
# put the portal public key at keys/sandbox.pem (or set EINV_PUBLIC_KEY)
```

Every setting can also be passed as an environment variable; variables override
the `.env` file. `.env`, `keys/*.pem`, cached tokens and `output/` are git-ignored.

## 3. Use

```bash
# check credentials and connectivity
node bin/einvoice.mjs auth
node bin/einvoice.mjs gstin 29AAAAA0000A1Z5

# prepare your invoice JSON (see examples/sample-invoice.json), check it offline
node bin/einvoice.mjs validate my-invoice.json

# register it with the portal; the response (IRN, AckNo, SignedInvoice, SignedQRCode) is saved to output/
node bin/einvoice.mjs generate my-invoice.json

# override fields on the fly without editing the file
node bin/einvoice.mjs generate examples/sample-invoice.json --set DocDtls.No=UBS/26-27/0042 --set DocDtls.Dt=today

# look up, cancel, decode
node bin/einvoice.mjs get <IRN>
node bin/einvoice.mjs cancel <IRN> --reason 2 --remarks "wrong buyer GSTIN"
node bin/einvoice.mjs decode output/<saved file>.json
```

Add `--json` to any command for raw JSON output and `--verbose` to see the HTTP calls.
`--env production` switches environment for one command.

### Invoice payload

The input is the official e-invoice schema (INV-01, `Version: "1.1"`):
`TranDtls`, `DocDtls`, `SellerDtls`, `BuyerDtls`, `ItemList[]`, `ValDtls`, plus the
optional sections (`DispDtls`, `ShipDtls`, `ExpDtls`, `PayDtls`, `RefDtls`, `EwbDtls`)
if you need them. `examples/sample-invoice.json` is a complete B2B service invoice
for bus transport (HSN 996412). Things the portal insists on:

- `SellerDtls.Gstin` must be the GSTIN the API credentials belong to.
- `DocDtls.No` is unique per financial year, max 16 chars, letters/digits/`/`/`-`.
- Dates are `dd/mm/yyyy`; the document date cannot be in the future.
- Item and invoice totals must add up (±1 rupee tolerance). `validate` checks this.
- Only B2B, SEZ, export and deemed-export supplies are e-invoiced, not B2C.

### Output

`generate` writes `output/<DocNo>-<IRN>.json` containing the request and the full
response. Print the **IRN**, **Ack No**, **Ack Date** and a QR code of the
**SignedQRCode** string on the invoice copy you issue. `decode` shows what is inside the
signed tokens; it does not verify the portal's signature.

## Using it as a library

```js
import { EInvoiceClient, ENVIRONMENTS } from './src/client.mjs';
import { FileTokenStore } from './src/token-store.mjs';
import { readFileSync } from 'node:fs';

const client = new EInvoiceClient({
  baseUrl: ENVIRONMENTS.sandbox.baseUrl,
  clientId, clientSecret, gstin, username, password,
  publicKey: readFileSync('keys/sandbox.pem', 'utf8'),
  tokenStore: new FileTokenStore('.token.json'),
});

const result = await client.generateIrn(invoice); // { Irn, AckNo, AckDt, SignedInvoice, SignedQRCode, Status, ... }
```

Errors from the portal are thrown as `EInvoiceError` with `code`, `details`
(the portal's `ErrorDetails`) and `info` (`InfoDtls`, e.g. the existing IRN on a
duplicate). An expired/invalid token is refreshed and the call retried once.

## How the protocol is implemented

| Step | What the client does |
| --- | --- |
| Auth request | `{UserName, Password, AppKey, ForceRefreshAccessToken}` → JSON → base64 → RSA (PKCS#1 v1.5) with portal public key → base64 in `Data`. `AppKey` is 32 random bytes. Headers: `client_id`, `client_secret`, `Gstin`. |
| Auth response | `Sek` is decrypted with the AppKey (AES-256-ECB) to get the 32-byte session key. Token and SEK are cached until 5 minutes before `TokenExpiry` (IST). |
| API request | JSON → base64 → AES-256-ECB with SEK → base64 in `Data`. Headers add `user_name` and `AuthToken`. (`EINV_PAYLOAD_ENCODING=json` skips the base64 step if your gateway expects plain JSON.) |
| API response | `Data` is base64 → AES-256-ECB decrypt with SEK → JSON (a base64-wrapped JSON is handled too). `Status: 0` responses become `EInvoiceError`. |

## Tests

```bash
npm test
```

The suite runs the client against an in-process mock of the portal that performs the
inverse of every cryptographic step (RSA decrypt with the private key, SEK wrapping,
AES payload decrypt), so the full auth → generate → get → cancel flow, duplicate
handling and token refresh are exercised without network access.

## Notes

- The portal public keys and the API specification live on the NIC portals above;
  if NIC changes a version path, edit `PATHS` in `src/client.mjs`.
- NIC may block credentials that produce many erroneous calls. Use `validate` first,
  and the sandbox before production.
- E-invoicing applies to B2B supplies by taxpayers above the notified turnover
  threshold; passenger transport ticketing to individuals (B2C) is outside its scope.
  Confirm applicability with your tax adviser before going live.
