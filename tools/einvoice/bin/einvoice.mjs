#!/usr/bin/env node
// CLI for generating GST e-invoices (IRN) via the NIC Invoice Registration Portal.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { CANCEL_REASONS, EInvoiceClient, EInvoiceError } from '../src/client.mjs';
import { loadConfig, requireCredentials, TOOL_ROOT } from '../src/config.mjs';
import { decodeJwtPayload } from '../src/crypto.mjs';
import { FileTokenStore } from '../src/token-store.mjs';
import { todayDdMmYyyy, validateInvoice } from '../src/validate.mjs';

const USAGE = `
einvoice — generate GST e-invoices through the NIC e-Invoice portal (IRP)

Usage: node bin/einvoice.mjs <command> [options]

Commands
  auth                      Authenticate and cache the session token (also verifies credentials)
  gstin <GSTIN>             Look up a GSTIN on the portal (connectivity check)
  validate <invoice.json>   Offline checks of an invoice payload, no portal call
  generate <invoice.json>   Validate, submit to the portal and save the IRN response
  get <IRN>                 Fetch details of an existing IRN
  cancel <IRN>              Cancel an IRN (within 24h). Needs --reason and --remarks
  decode <jwt|file>         Decode a SignedInvoice / SignedQRCode token (no signature check)

Options
  --portal <nic|iris>         Invoice Registration Portal (default: EINV_PORTAL or nic)
  --env <sandbox|production>  Portal environment (default: EINV_ENV or sandbox)
  --config <path>             .env file to read (default: tools/einvoice/.env)
  --set <Path=value>          Override a field in the invoice before sending, e.g.
                              --set DocDtls.No=UBS/2026/007 --set DocDtls.Dt=today (repeatable)
  --out <dir>                 Where generate saves responses (default: tools/einvoice/output)
  --no-validate               Skip offline validation before generate
  --force                     auth: force a fresh token
  --reason <1-4>              cancel: 1 Duplicate, 2 Data entry mistake, 3 Order cancelled, 4 Others
  --remarks <text>            cancel: free-text reason
  --json                      Print raw JSON responses
  --verbose                   Log HTTP calls
  -h, --help                  Show this help
`.trim();

main().catch((err) => {
  if (err instanceof EInvoiceError) {
    console.error(`\n✗ Portal error: ${err.message}`);
    if (err.details?.length > 1) {
      for (const d of err.details) console.error(`  - [${d.ErrorCode ?? '?'}] ${d.ErrorMessage ?? ''}`);
    }
    if (err.info?.length) console.error('  Info:', JSON.stringify(err.info));
    if (err.httpStatus) console.error(`  HTTP ${err.httpStatus}`);
    if (process.argv.includes('--verbose') && err.raw) console.error('  Raw:', JSON.stringify(err.raw, null, 2));
  } else {
    console.error(`\n✗ ${err.message}`);
    if (process.argv.includes('--verbose')) console.error(err.stack);
  }
  process.exit(1);
});

async function main() {
  const { values: opts, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      portal: { type: 'string' },
      env: { type: 'string' },
      config: { type: 'string' },
      set: { type: 'string', multiple: true, default: [] },
      out: { type: 'string' },
      'no-validate': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      reason: { type: 'string' },
      remarks: { type: 'string' },
      json: { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  const [command, arg] = positionals;
  if (opts.help || !command) {
    console.log(USAGE);
    process.exit(command ? 0 : 1);
  }

  const log = opts.verbose ? (...a) => console.error('[einvoice]', ...a) : () => {};
  const overrides = {};
  if (opts.portal) overrides.EINV_PORTAL = opts.portal;
  if (opts.env) overrides.EINV_ENV = opts.env;
  const config = loadConfig({ envFile: opts.config, overrides });

  switch (command) {
    case 'validate':
      return cmdValidate(arg, opts);
    case 'decode':
      return cmdDecode(arg, opts);
    case 'auth':
      return cmdAuth(makeClient(config, log), config, opts);
    case 'gstin':
      return cmdGstin(makeClient(config, log), arg, opts);
    case 'generate':
      return cmdGenerate(makeClient(config, log), config, arg, opts);
    case 'get':
      return cmdGet(makeClient(config, log), arg, opts);
    case 'cancel':
      return cmdCancel(makeClient(config, log), arg, opts);
    default:
      console.error(`Unknown command "${command}"\n`);
      console.log(USAGE);
      process.exit(1);
  }
}

function makeClient(config, log) {
  const full = requireCredentials(config);
  log(`portal: ${full.portalLabel}, environment: ${full.envName} (${full.baseUrl}), gstin: ${full.gstin}`);
  return new EInvoiceClient({
    ...full,
    tokenStore: new FileTokenStore(full.tokenFile),
    log,
  });
}

async function readInvoice(path, opts) {
  if (!path) throw new Error('Path to the invoice JSON file is required');
  const text = await readFile(resolve(path), 'utf8');
  let invoice;
  try {
    invoice = JSON.parse(text);
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${err.message}`);
  }
  for (const assignment of opts.set ?? []) {
    const eq = assignment.indexOf('=');
    if (eq === -1) throw new Error(`--set expects Path=value, got "${assignment}"`);
    setPath(invoice, assignment.slice(0, eq), coerce(assignment.slice(eq + 1)));
  }
  return invoice;
}

function printValidation({ errors, warnings }) {
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  for (const e of errors) console.log(`  ✗ ${e}`);
}

async function cmdValidate(path, opts) {
  const invoice = await readInvoice(path, opts);
  const result = validateInvoice(invoice);
  if (opts.json) return console.log(JSON.stringify(result, null, 2));
  printValidation(result);
  if (result.errors.length) {
    console.log(`\n✗ ${result.errors.length} error(s) found`);
    process.exit(1);
  }
  console.log(`✓ ${path} passes offline validation${result.warnings.length ? ` (${result.warnings.length} warning(s))` : ''}`);
}

async function cmdDecode(input, opts) {
  if (!input) throw new Error('Provide a JWT string or a path to a file containing one');
  let token = input;
  if (existsSync(input)) {
    const text = await readFile(input, 'utf8');
    try {
      const obj = JSON.parse(text);
      // accept a raw portal response or a file saved by `generate` ({request, response})
      const src = obj.response ?? obj;
      token = src.SignedQRCode ?? src.SignedInvoice ?? text;
    } catch {
      token = text;
    }
  }
  const payload = decodeJwtPayload(token);
  console.log(JSON.stringify(payload, null, 2));
  if (!opts.json) console.error('\nNote: payload decoded without signature verification.');
}

async function cmdAuth(client, config, opts) {
  const session = await client.authenticate({ force: opts.force });
  if (opts.json) return console.log(JSON.stringify({ ...session, sek: '<redacted>' }, null, 2));
  console.log(`✓ Authenticated with ${config.portalLabel} ${config.envName} as ${session.username} (${session.gstin})`);
  console.log(`  Token expires: ${session.tokenExpiry} IST`);
  console.log(`  Cached in:     ${config.tokenFile}`);
}

async function cmdGstin(client, gstin, opts) {
  if (!gstin) throw new Error('GSTIN is required');
  const data = await client.getGstinDetails(gstin.toUpperCase());
  if (opts.json) return console.log(JSON.stringify(data, null, 2));
  console.log(`✓ ${data.Gstin ?? gstin}`);
  for (const [k, v] of Object.entries(data)) if (v !== null && v !== '') console.log(`  ${k.padEnd(10)} ${v}`);
}

async function cmdGenerate(client, config, path, opts) {
  const invoice = await readInvoice(path, opts);

  if (!opts['no-validate']) {
    const result = validateInvoice(invoice);
    printValidation(result);
    if (result.errors.length) {
      throw new Error(`Invoice failed offline validation with ${result.errors.length} error(s); fix them or pass --no-validate`);
    }
  }

  console.log(`→ Submitting ${invoice.DocDtls?.No} dated ${invoice.DocDtls?.Dt} to ${config.portalLabel} ${config.envName}…`);
  const data = await client.generateIrn(invoice);

  const outDir = resolve(opts.out ?? resolve(TOOL_ROOT, 'output'));
  await mkdir(outDir, { recursive: true });
  const safeNo = String(invoice.DocDtls?.No ?? 'invoice').replace(/[^A-Za-z0-9_-]/g, '_');
  const outFile = resolve(outDir, `${safeNo}-${data.Irn ?? Date.now()}.json`);
  await writeFile(outFile, JSON.stringify({ request: invoice, response: data }, null, 2));

  if (opts.json) return console.log(JSON.stringify(data, null, 2));
  console.log('\n✓ IRN generated');
  console.log(`  IRN:        ${data.Irn}`);
  console.log(`  Ack No:     ${data.AckNo}`);
  console.log(`  Ack Date:   ${data.AckDt}`);
  console.log(`  Status:     ${data.Status}`);
  if (data.EwbNo) console.log(`  E-way bill: ${data.EwbNo} (valid till ${data.EwbValidTill})`);
  console.log(`  Saved:      ${outFile}`);
  console.log('\nThe SignedQRCode in the saved file is the text to print as the QR code on the invoice.');
}

async function cmdGet(client, irn, opts) {
  if (!irn) throw new Error('IRN is required');
  const data = await client.getIrn(irn);
  if (opts.json) return console.log(JSON.stringify(data, null, 2));
  console.log(`✓ IRN ${data.Irn ?? irn}`);
  console.log(`  Ack No:   ${data.AckNo}`);
  console.log(`  Ack Date: ${data.AckDt}`);
  console.log(`  Status:   ${data.Status}${data.Status === 'CNL' ? ' (cancelled)' : ''}`);
  if (data.SignedInvoice) {
    const inv = decodeJwtPayload(data.SignedInvoice).data;
    if (inv?.DocDtls) console.log(`  Document: ${inv.DocDtls.Typ} ${inv.DocDtls.No} dated ${inv.DocDtls.Dt}, total ${inv.ValDtls?.TotInvVal}`);
  }
}

async function cmdCancel(client, irn, opts) {
  if (!irn) throw new Error('IRN is required');
  if (!opts.reason || !CANCEL_REASONS[opts.reason]) {
    throw new Error(`--reason is required: ${Object.entries(CANCEL_REASONS).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }
  if (!opts.remarks) throw new Error('--remarks is required');
  const data = await client.cancelIrn({ irn, reason: opts.reason, remarks: opts.remarks });
  if (opts.json) return console.log(JSON.stringify(data, null, 2));
  console.log(`✓ Cancelled IRN ${data.Irn ?? irn} at ${data.CancelDate}`);
}

// ---------------------------------------------------------------- helpers

function setPath(obj, path, value) {
  const keys = path.split('.');
  const toKey = (k) => (/^\d+$/.test(k) ? Number(k) : k);
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = toKey(keys[i]);
    if (cur[k] === undefined || cur[k] === null) cur[k] = typeof toKey(keys[i + 1]) === 'number' ? [] : {};
    cur = cur[k];
  }
  cur[toKey(keys.at(-1))] = value;
}

function coerce(raw) {
  if (raw === 'today') return todayDdMmYyyy();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}
