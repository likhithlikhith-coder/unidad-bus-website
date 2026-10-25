# Handoff: GST e-invoice utility → IRIS IRP sandbox

Context for continuing this work in a new session. Written 25 Oct 2026.
Start the new session **on your own machine** (Claude Desktop app, or
`claude remote-control` in the repo folder): the remaining steps need your
Chrome login to the IRIS portal and network access to `*.einvoice6.gst.gov.in`,
neither of which the cloud session had.

## 1. What was built

Branch: `claude/gstin-einvoice-utility-hj6zzl` in `likhithlikhith-coder/unidad-bus-website`
(two commits on top of master; check it out before doing anything).

`tools/einvoice/` is a zero-dependency Node.js (18.17+) CLI + library for the
national e-invoice API used by India's Invoice Registration Portals (IRPs):

| File | Purpose |
| --- | --- |
| `README.md` | Full setup and command reference, incl. IRIS onboarding steps |
| `.env.example` | Settings template; copy to `.env` (git-ignored) |
| `bin/einvoice.mjs` | CLI: `auth`, `gstin`, `validate`, `generate`, `get`, `cancel`, `decode` |
| `src/client.mjs` | API client. `PORTALS` = per-portal profiles (nic, iris); `PATHS` = `/eivital/v1.04/auth`, `/eicore/v1.03/Invoice`, `/eicore/v1.03/Invoice/irn/{irn}`, `/eicore/v1.03/Invoice/Cancel`, `/eivital/v1.04/Master/gstin/{gstin}` |
| `src/crypto.mjs` | RSA PKCS#1 v1.5 (credentials + 32-byte AppKey), AES-256-ECB/PKCS7 with the session key (SEK) for payloads, JWT payload decode |
| `src/config.mjs` | Loads `.env` / env vars / CLI flags; `EINV_PORTAL`, `EINV_ENV`, `EINV_BASE_URL`, credentials, key path |
| `src/validate.mjs` | Offline checks of the INV-01 v1.1 payload (GSTIN format, dates, doc no., totals ±1) |
| `src/token-store.mjs` | Caches AuthToken + SEK in `.token-<portal>-<env>-<gstin>.json` (0600) |
| `examples/sample-invoice.json` | B2B service invoice (bus transport, HSN 996412) |
| `test/` | 28 tests; `npm test`. `mock-irp.mjs` is an in-process portal that reverses every crypto step |

Encoding implemented (NIC spec as documented by third parties; not yet confirmed live):
- Auth: `Data = base64(RSA(publicKey, base64(JSON{UserName,Password,AppKey,ForceRefreshAccessToken})))`,
  headers `client_id`, `client_secret`, `Gstin`.
- Sek in the auth response is AES-256-ECB-encrypted with the AppKey → 32-byte SEK.
- API calls: `Data = base64(AES(SEK, base64(JSON)))`, headers add `user_name`, `AuthToken`.
  `EINV_PAYLOAD_ENCODING=json` skips the inner base64 if a portal wants plain JSON.
- Responses: `Data` → base64 decode → AES decrypt → JSON (base64-wrapped JSON also handled).
  `Status: 0` → `EInvoiceError` with `code`, `details` (ErrorDetails), `info` (InfoDtls).
  Token error codes 1005/1006/1007 trigger one re-auth + retry.

## 2. Decisions made and why

1. **NIC IRP direct access is not available.** The client's turnover is below ₹100 crore,
   so NIC's sandbox refused "Direct Integration" and asked for a GSP/ERP Client ID.
   Registering as ERP on NIC also failed ("This User Does not Exist"): NIC's ERP option
   is only for vendors already empanelled with NIC.
2. **Chosen route: IRIS IRP (einvoice6.gst.gov.in).** GSTN-authorised IRP offering
   self-service direct API access to taxpayers and integrators. It implements the same
   national API (same paths, headers, encryption) as NIC, so the code needed only a
   portal profile (`EINV_PORTAL=iris`), not a new transport.
3. **Registration done on IRIS as "API Integrator"**, then the API Access Registration
   Form as **Intermediary** using the developer's own GSTIN (which is not e-invoice
   liable; that is fine for an intermediary). The client's GSTIN will be onboarded under
   this intermediary account later and must itself be e-invoice enabled.
4. IRIS publishes its API hosts only inside the account, so `EINV_BASE_URL` is currently
   **required** for `iris` and the tool says where to find it. Once confirmed, hard-code
   the hosts into `PORTALS.iris` in `src/client.mjs` so the setting becomes optional.

## 3. What remains (the task for the new session)

1. `git fetch origin claude/gstin-einvoice-utility-hj6zzl && git checkout claude/gstin-einvoice-utility-hj6zzl`
   then `cd tools/einvoice && npm test` (expect 28 passing).
2. In Chrome (logged into https://einvoice6.gst.gov.in) collect:
   - **Sandbox → Sandbox Settings → Sandbox End Point** → API host(s). Confirm the
     auth and Generate IRN paths match `PATHS`; if not, adjust `PATHS`/`PORTALS.iris`.
   - **Sandbox → Sandbox Credentials** → Client ID + Client Secret (core API creds,
     not the Portal ID).
   - An **API user** (user name + password) for a GSTIN. If the client's GSTIN is not
     onboarded yet, let IRIS generate a **dummy test GSTIN** (state 29) and create/
     authorise an API user for it under *Manage API access*.
   - **Public keys page → Core APIs → Sandbox** key → save as `keys/iris-sandbox.pem`
     (must start with `-----BEGIN PUBLIC KEY-----` or `-----BEGIN CERTIFICATE-----`).
3. `cp .env.example .env` and fill `EINV_PORTAL=iris`, `EINV_ENV=sandbox`,
   `EINV_BASE_URL`, `EINV_CLIENT_ID`, `EINV_CLIENT_SECRET`, `EINV_GSTIN`,
   `EINV_USERNAME`, `EINV_PASSWORD`. Never commit or print the secret/password.
4. Live calls, in order:
   ```
   node bin/einvoice.mjs auth --verbose
   node bin/einvoice.mjs gstin <test GSTIN>
   node bin/einvoice.mjs generate examples/sample-invoice.json \
     --set DocDtls.Dt=today --set DocDtls.No=TEST/0001 \
     --set SellerDtls.Gstin=<test GSTIN> --set SellerDtls.Stcd=<its first 2 digits>
   node bin/einvoice.mjs get <IRN>
   node bin/einvoice.mjs decode output/<saved file>.json
   node bin/einvoice.mjs cancel <IRN> --reason 1 --remarks "sandbox test"
   ```
   Seller GSTIN must equal `EINV_GSTIN`. Use a buyer GSTIN IRIS accepts in sandbox
   (a second dummy GSTIN works).
5. Troubleshooting guide:
   - Auth rejected as undecryptable → wrong key file (must be the *sandbox Core API* key).
   - Error 1005 "Invalid Token" loops → API user not authorised for the GSTIN, or
     `Gstin` header ≠ the user's GSTIN.
   - Generate IRN decryption/format error → set `EINV_PAYLOAD_ENCODING=json`, retry;
     if that fixes it, make `json` the default for the iris profile.
   - Error 2150 "Duplicate IRN" → change `DocDtls.No`.
   - Date errors → `DocDtls.Dt` must be dd/mm/yyyy, not future, within 30 days.
6. Fold findings back into the branch (no secrets): confirmed IRIS hosts in
   `PORTALS.iris`, README/.env.example updates, encoding default if changed, IRIS test
   GSTINs in the README. `npm test`, commit, `git push origin claude/gstin-einvoice-utility-hj6zzl`.

## 4. Before production

- IRIS requires sandbox test-case submission before granting production credentials.
- Production needs its own Client ID/Secret, host, API user and `keys/iris-production.pem`
  with `EINV_ENV=production`.
- The client's real GSTIN must be e-invoice enabled (turnover above the ₹5 crore
  threshold, B2B supplies). IRPs will not issue IRNs otherwise. B2C passenger
  ticketing is outside e-invoicing scope.
- Public keys expire periodically; re-download when auth starts failing.

## 5. Suggested opening prompt for the new session

> Read `tools/einvoice/HANDOFF.md` and `tools/einvoice/README.md` on branch
> `claude/gstin-einvoice-utility-hj6zzl`, then carry out section 3 ("What remains").
> I am logged into the IRIS IRP portal in Chrome; you may drive the browser and run
> commands. Ask me to type the Client Secret and API password into `.env` myself.
