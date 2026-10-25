import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENVIRONMENTS } from './client.mjs';

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
 */
export function loadConfig({ envFile, overrides = {}, env = process.env } = {}) {
  const file = envFile ? resolve(envFile) : resolve(TOOL_ROOT, '.env');
  const fromFile = existsSync(file) ? parseDotenv(readFileSync(file, 'utf8')) : {};
  const baseDir = dirname(file);
  const get = (key) => overrides[key] ?? env[key] ?? fromFile[key] ?? '';

  const envName = (get('EINV_ENV') || 'sandbox').toLowerCase();
  if (!ENVIRONMENTS[envName]) {
    throw new Error(`EINV_ENV must be one of ${Object.keys(ENVIRONMENTS).join(', ')} (got "${envName}")`);
  }

  const publicKeyPath = get('EINV_PUBLIC_KEY') || `keys/${envName}.pem`;
  const resolvedKeyPath = isAbsolute(publicKeyPath) ? publicKeyPath : resolve(baseDir, publicKeyPath);

  const config = {
    envName,
    envFile: file,
    baseUrl: get('EINV_BASE_URL') || ENVIRONMENTS[envName].baseUrl,
    clientId: get('EINV_CLIENT_ID'),
    clientSecret: get('EINV_CLIENT_SECRET'),
    gstin: get('EINV_GSTIN').toUpperCase(),
    username: get('EINV_USERNAME'),
    password: get('EINV_PASSWORD'),
    publicKeyPath: resolvedKeyPath,
    publicKey: null,
    payloadEncoding: get('EINV_PAYLOAD_ENCODING') || 'base64',
    tokenFile: get('EINV_TOKEN_FILE') || resolve(baseDir, `.token-${envName}-${get('EINV_GSTIN').toUpperCase() || 'nogstin'}.json`),
  };

  if (!['base64', 'json'].includes(config.payloadEncoding)) {
    throw new Error('EINV_PAYLOAD_ENCODING must be "base64" or "json"');
  }
  return config;
}

/** Validates presence of credentials and loads the public key PEM. Throws a readable error. */
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
  if (!existsSync(config.publicKeyPath)) {
    throw new Error(
      `Portal public key not found at ${config.publicKeyPath}. Download it from the e-invoice portal (API → public key) and set EINV_PUBLIC_KEY.`,
    );
  }
  const pem = readFileSync(config.publicKeyPath, 'utf8');
  if (!/-----BEGIN (RSA )?PUBLIC KEY-----|-----BEGIN CERTIFICATE-----/.test(pem)) {
    throw new Error(`${config.publicKeyPath} does not look like a PEM public key or certificate.`);
  }
  return { ...config, publicKey: pem };
}
