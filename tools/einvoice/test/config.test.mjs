import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, requireCredentials } from '../src/config.mjs';

const CREDS = { EINV_CLIENT_ID: 'c', EINV_CLIENT_SECRET: 's', EINV_GSTIN: '29aaaaa0000a1z5', EINV_USERNAME: 'u', EINV_PASSWORD: 'p' };
const PEM = '-----BEGIN PUBLIC KEY-----\nMFkw\n-----END PUBLIC KEY-----\n';
const noEnvFile = join(tmpdir(), 'does-not-exist', '.env');

test('defaults to NIC sandbox with its fixed host', () => {
  const c = loadConfig({ envFile: noEnvFile, env: {} });
  assert.equal(c.portalName, 'nic');
  assert.equal(c.envName, 'sandbox');
  assert.equal(c.baseUrl, 'https://einv-apisandbox.nic.in');
});

test('IRIS requires EINV_BASE_URL and explains where to find it', () => {
  const c = loadConfig({ envFile: noEnvFile, env: { EINV_PORTAL: 'iris', ...CREDS } });
  assert.equal(c.baseUrl, null);
  assert.throws(() => requireCredentials(c), /Sandbox End Point.*EINV_BASE_URL/s);
});

test('IRIS with host and key configured loads cleanly from a .env file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'einv-'));
  writeFileSync(join(dir, 'iris-sandbox.pem'), PEM);
  writeFileSync(
    join(dir, '.env'),
    ['EINV_PORTAL=iris', 'EINV_BASE_URL=https://example.invalid', ...Object.entries(CREDS).map(([k, v]) => `${k}=${v}`), `EINV_PUBLIC_KEY=${join(dir, 'iris-sandbox.pem')}`].join('\n'),
  );
  const c = requireCredentials(loadConfig({ envFile: join(dir, '.env'), env: {} }));
  assert.equal(c.portalLabel, 'IRIS IRP (einvoice6)');
  assert.equal(c.gstin, '29AAAAA0000A1Z5');
  assert.equal(c.publicKey, PEM);
  assert.match(c.tokenFile, /\.token-iris-sandbox-29AAAAA0000A1Z5\.json$/);
});

test('public key defaults to keys/<portal>-<env>.pem, with legacy keys/<env>.pem for NIC', () => {
  const dir = mkdtempSync(join(tmpdir(), 'einv-'));
  writeFileSync(join(dir, '.env'), '');
  const iris = loadConfig({ envFile: join(dir, '.env'), env: { EINV_PORTAL: 'iris', EINV_ENV: 'production' } });
  assert.equal(iris.publicKeyPath, join(dir, 'keys', 'iris-production.pem'));
  const nic = loadConfig({ envFile: join(dir, '.env'), env: {} });
  assert.equal(nic.publicKeyPath, join(dir, 'keys', 'nic-sandbox.pem'));
});

test('environment variables override the .env file and CLI overrides win', () => {
  const dir = mkdtempSync(join(tmpdir(), 'einv-'));
  writeFileSync(join(dir, '.env'), 'EINV_PORTAL=nic\nEINV_ENV=sandbox\n');
  const c = loadConfig({ envFile: join(dir, '.env'), env: { EINV_ENV: 'production' }, overrides: { EINV_PORTAL: 'iris' } });
  assert.equal(c.portalName, 'iris');
  assert.equal(c.envName, 'production');
});

test('rejects unknown portal, environment and encoding', () => {
  assert.throws(() => loadConfig({ envFile: noEnvFile, env: { EINV_PORTAL: 'acme' } }), /EINV_PORTAL must be one of nic, iris/);
  assert.throws(() => loadConfig({ envFile: noEnvFile, env: { EINV_ENV: 'staging' } }), /EINV_ENV must be/);
  assert.throws(() => loadConfig({ envFile: noEnvFile, env: { EINV_PAYLOAD_ENCODING: 'hex' } }), /EINV_PAYLOAD_ENCODING/);
});
