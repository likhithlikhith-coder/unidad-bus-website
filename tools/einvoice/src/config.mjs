import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTALS } from './client.mjs';

export const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal .env parser: KEY=value lines, '#' comments, optional surrounding quotes. */
export function parseDotenv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Build client configuration from (highest precedence first):
 * CLI overrides → process.env → .env file (default: tools/einvoice/.env).
 *
 * EINV_PORTAL selects the Invoice Registration Portal (nic | iris),
 * EINV_ENV selects sandbox | production within it.
 */
export function loadConfig({ envFile, overrides = {}, env = process.env } = {}) {
  const file = envFile ? resolve(envFile) : resolve(TOOL_ROOT, '.env');
  const fromFile = existsSync(file) ? parseDotenv(readFileSync(file, 'utf8')) : {};
  const baseDir = dirname(file);
  const get = (key) => overrides[key] ?? env[key] ?? fromFile[key] ?? '';

  const portalName = (get('EINV_PORTAL') || 'nic').toLowerCase();
  const portal = PORTALS[portalName];
  if (!portal) {
    throw new Error(`EINV_PORTAL must be one of ${Object.keys(PORTALS).join(', ')} (got "${portalName}")`);
  }
  const envName = (get('EINV_ENV') || 'sandbox').toLowerCase();
  if (!portal[envName]) {
    throw new Error(`EINV_ENV must be "sandbox" or "production" (got "${envName}")`);
  }

  const baseUrl = get('EINV_BASE_URL') || portal[envName].baseUrl || null;
  const gstin = get('EINV_GSTIN').toUpperCase();

  // Key lookup order: explicit setting, keys/<portal>-<env>.pem, then the legacy keys/<env>.pem for NIC.
  const explicitKey = get('EINV_PUBLIC_KEY');
  const keyCandidates = explicitKey
    ? [explicitKey]
    : [`keys/${portalName}-${envName}.pem`, ...(portalName === 'nic' ? [`keys/${envName}.pem`] : [])];
  const abs = (p) => (isAbsolute(p) ? p : resolve(baseDir, p));
  const publicKeyPath = abs(keyCandidates.find((p) => existsSync(abs(p))) ?? keyCandidates[0]);

  const config = {
    portalName,
    portalLabel: portal.name,
    envName,
    envFile: file,
    baseUrl,
    baseUrlHint: portal[envName].hint ?? null,
    clientId: get('EINV_CLIENT_ID'),
    clientSecret: get('EINV_CLIENT_SECRET'),
    gstin,
    username: get('EINV_USERNAME'),
    password: get('EINV_PASSWORD'),
    publicKeyPath,
    publicKey: null,
    payloadEncoding: get('EINV_PAYLOAD_ENCODING') || 'base64',
    tokenFile: get('EINV_TOKEN_FILE') || resolve(baseDir, `.token-${portalName}-${envName}-${gstin || 'nogstin'}.json`),
  };

  if (!['base64', 'json'].includes(config.payloadEncoding)) {
    throw new Error('EINV_PAYLOAD_ENCODING must be "base64" or "json"');
  }
  return config;
}

/** Validates presence of credentials and the base URL, and loads the public key PEM. */
export function requireCredentials(config) {
  const missing = [];
  for (const [key, label] of [
    ['clientId', 'EINV_CLIENT_ID'],
    ['clientSecret', 'EINV_CLIENT_SECRET'],
    ['gstin', 'EINV_GSTIN'],
    ['username', 'EINV_USERNAME'],
    ['password', 'EINV_PASSWORD'],
  ]) {
    if (!config[key]) missing.push(label);
  }
  if (missing.length) {
    throw new Error(
      `Missing credentials: ${missing.join(', ')}. Set them in ${config.envFile} (see .env.example) or as environment variables.`,
    );
  }
  if (!config.baseUrl) {
    throw new Error(
      `${config.portalLabel} does not publish a fixed ${config.envName} API host. Copy it from your account (${config.baseUrlHint}) into EINV_BASE_URL.`,
    );
  }
  if (!/^https?:\/\//.test(config.baseUrl)) {
    throw new Error(`EINV_BASE_URL must start with https:// (got "${config.baseUrl}")`);
  }
  if (!existsSync(config.publicKeyPath)) {
    throw new Error(
      `Portal public key not found at ${config.publicKeyPath}. Download the ${config.envName} public key from ${config.portalLabel} and save it there, or set EINV_PUBLIC_KEY.`,
    );
  }
  const pem = readFileSync(config.publicKeyPath, 'utf8');
  if (!/-----BEGIN (RSA )?PUBLIC KEY-----|-----BEGIN CERTIFICATE-----/.test(pem)) {
    throw new Error(`${config.publicKeyPath} does not look like a PEM public key or certificate.`);
  }
  return { ...config, publicKey: pem };
}
