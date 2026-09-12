import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = await mkdtemp(path.join(tmpdir(), 'sprout-config-test-'));
await mkdir(path.join(directory, 'server'));
await mkdir(path.join(directory, 'config'));
await cp(new URL('../server/config.mjs', import.meta.url), path.join(directory, 'server/config.mjs'));
const config = {
  defaultImageProvider: 'primary', secureCookies: true,
  imageProviders: ['primary', 'secondary'].map((id) => ({ id, baseUrl: `https://${id}.invalid`, apiKey: `fixture-${id}`, imageModel: 'gpt-image-2' })),
  textProviders: ['text-primary', 'text-secondary'].map((id) => ({ id, baseUrl: `https://${id}.invalid`, apiKey: `fixture-${id}`, model: 'text-model' })),
};
await writeFile(path.join(directory, 'config/local.config.json'), JSON.stringify(config));
const { readLocalConfig, publicConfig } = await import(pathToFileURL(path.join(directory, 'server/config.mjs')));
const keys = ['NODE_ENV', 'OPENAI_BASE_URL', 'OPENAI_API_KEY', 'ANYROUTER_BASE_URL', 'ANYROUTER_API_KEY', 'IMAGE_MODEL', 'GENERATION_MODE', 'DEFAULT_IMAGE_PROVIDER', 'DEFAULT_PROVIDER', 'TEXT_BASE_URL', 'TEXT_API_KEY', 'TEXT_MODEL', 'IMAGE_CONCURRENCY', 'SECURE_COOKIES', 'PORT', 'AUTH_SESSION_DAYS', 'DATA_DIR', 'STATE_FILE', 'ADMIN_PASSWORD', 'ACCESS_PASSWORD', 'COOKIE_NAMESPACE'];
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
try {
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, {
    DEFAULT_IMAGE_PROVIDER: 'secondary', OPENAI_BASE_URL: 'https://image-override.invalid/v1/', OPENAI_API_KEY: 'fixture-env-image', IMAGE_MODEL: 'gpt-5', GENERATION_MODE: 'responses',
    TEXT_BASE_URL: 'https://text-override.invalid/v1', TEXT_API_KEY: 'fixture-env-text', TEXT_MODEL: 'override-text', SECURE_COOKIES: '0',
  });
  const parsed = await readLocalConfig();
  assert.equal(parsed.id, 'secondary');
  assert.equal(parsed.apiKey, 'fixture-env-image');
  assert.equal(parsed.baseUrl, 'https://image-override.invalid');
  assert.equal(parsed.imageModel, 'gpt-5');
  assert.equal(parsed.generationMode, 'responses');
  assert.equal(parsed.imageProviders[0].apiKey, 'fixture-primary');
  assert.equal(parsed.textProvider.apiKey, 'fixture-env-text');
  assert.equal(parsed.textProvider.baseUrl, 'https://text-override.invalid');
  assert.equal(parsed.textProvider.textModel, 'override-text');
  assert.equal(parsed.textProviders[1].apiKey, 'fixture-text-secondary');
  assert.equal(parsed.secureCookies, false);
  assert.doesNotMatch(JSON.stringify(publicConfig(parsed)), /fixture-env-|apiKey/);
  process.env.IMAGE_CONCURRENCY = '2';
  await assert.rejects(readLocalConfig(), /必须为 1/);
  delete process.env.IMAGE_CONCURRENCY;
  process.env.PORT = 'not-a-port';
  await assert.rejects(readLocalConfig(), /PORT\/port/);
  delete process.env.PORT;
  process.env.SECURE_COOKIES = 'invalid';
  await assert.rejects(readLocalConfig(), /SECURE_COOKIES/);
  delete process.env.SECURE_COOKIES;
  process.env.DATA_DIR = path.join(directory, 'isolated-local-data');
  process.env.ADMIN_PASSWORD = 'distinct-admin-test-password';
  const local = await readLocalConfig();
  assert.equal(local.stateFile, path.join(directory, 'isolated-local-data/runtime.sqlite'));
  assert.equal(local.styleDataDir, path.join(directory, 'isolated-local-data/styles'));
  assert.doesNotMatch(JSON.stringify(publicConfig(local)), /adminPassword|distinct-admin/);
  process.env.STATE_FILE = path.join(directory, 'explicit.sqlite');
  assert.equal((await readLocalConfig()).stateFile, process.env.STATE_FILE);
  process.env.ACCESS_PASSWORD = process.env.ADMIN_PASSWORD;
  assert.equal((await readLocalConfig()).accessPassword, undefined, 'the legacy shared password does not grant generation access');
  delete process.env.ACCESS_PASSWORD;
  process.env.ADMIN_PASSWORD = 'short';
  await assert.rejects(readLocalConfig(), /12 到 256/);
  process.env.ADMIN_PASSWORD = '';
  assert.equal((await readLocalConfig()).adminPassword, '');
  process.env.COOKIE_NAMESPACE = 'local_test';
  assert.equal((await readLocalConfig()).cookieNamespace, 'local_test');
  process.env.COOKIE_NAMESPACE = 'bad;namespace';
  await assert.rejects(readLocalConfig(), /cookieNamespace/);
  console.log('Provider-specific environment overrides and configuration validation passed');
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
