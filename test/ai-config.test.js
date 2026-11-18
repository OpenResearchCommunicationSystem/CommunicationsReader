import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// config.js resolves 'electron' via createRequire at module-load time
// (see its own comment for why), so the mock must be registered before
// the dynamic import below, same ESM-hoisting-avoidance pattern used by
// test/translate.test.js and friends for ai-assist/index.js. mock.module
// can only be called once per specifier per process, so this uses one
// shared, mutable fake (toggle .available) rather than re-mocking per test.
const fakeState = { available: true };
const fakeSafeStorage = {
  isEncryptionAvailable: () => fakeState.available,
  // Deliberately NOT real encryption -- this only needs to prove
  // config.js round-trips through whatever safeStorage gives it, not
  // exercise Windows DPAPI itself.
  encryptString: (plain) => Buffer.from(`enc:${plain}`, 'utf8'),
  decryptString: (buf) => {
    const s = buf.toString('utf8');
    if (!s.startsWith('enc:')) throw new Error('not encrypted by this mock');
    return s.slice('enc:'.length);
  },
};
mock.module('electron', { defaultExport: { safeStorage: fakeSafeStorage } });
const { loadAiConfig } = await import('../src/ai-assist/config.js');

async function withConfigFile(initialContent, available, run) {
  fakeState.available = available;
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-config-test-'));
  const configFile = path.join(dir, 'ai-config.json');
  const prevPath = process.env.AI_CONFIG_PATH;
  process.env.AI_CONFIG_PATH = configFile;
  if (initialContent) await writeFile(configFile, JSON.stringify(initialContent, null, 2), 'utf8');

  try {
    return await run({ configFile });
  } finally {
    process.env.AI_CONFIG_PATH = prevPath;
    await rm(dir, { recursive: true, force: true });
  }
}

test('a plaintext apiKey is encrypted at rest on first load and still usable in-memory', async () => {
  await withConfigFile(
    { provider: 'openai-compatible', baseUrl: 'https://api.x.ai/v1', apiKey: 'sk-real-secret', model: 'grok-4.3' },
    true,
    async ({ configFile }) => {
      const config = loadAiConfig();
      assert.equal(config.apiKey, 'sk-real-secret', 'the returned config still has the usable key');

      const onDisk = JSON.parse(await readFile(configFile, 'utf8'));
      assert.equal(onDisk.apiKey, '', 'plaintext apiKey must not remain on disk after a load');
      assert.ok(onDisk.apiKeyEncrypted, 'an encrypted form must be persisted');
      assert.notEqual(onDisk.apiKeyEncrypted, 'sk-real-secret');
    }
  );
});

test('an already-encrypted apiKey round-trips back to the original value on the next load', async () => {
  await withConfigFile(
    {
      provider: 'openai-compatible',
      baseUrl: 'https://api.x.ai/v1',
      apiKey: '',
      apiKeyEncrypted: Buffer.from('enc:sk-real-secret', 'utf8').toString('base64'),
      model: 'grok-4.3',
    },
    true,
    async () => {
      const config = loadAiConfig();
      assert.equal(config.apiKey, 'sk-real-secret');
    }
  );
});

test('an encrypted key is treated as unconfigured (not a crash) when OS-level encryption is unavailable', async () => {
  await withConfigFile(
    {
      provider: 'openai-compatible',
      baseUrl: 'https://api.x.ai/v1',
      apiKey: '',
      apiKeyEncrypted: Buffer.from('enc:sk-real-secret', 'utf8').toString('base64'),
      model: 'grok-4.3',
    },
    false,
    async () => {
      assert.equal(loadAiConfig(), null);
    }
  );
});

test('a plaintext apiKey is still usable as a fallback when OS-level encryption is unavailable', async () => {
  await withConfigFile(
    { provider: 'openai-compatible', baseUrl: 'https://api.x.ai/v1', apiKey: 'sk-real-secret', model: 'grok-4.3' },
    false,
    async ({ configFile }) => {
      const config = loadAiConfig();
      assert.equal(config.apiKey, 'sk-real-secret');
      const onDisk = JSON.parse(await readFile(configFile, 'utf8'));
      assert.equal(onDisk.apiKey, 'sk-real-secret', 'never silently rewritten when it could not actually be encrypted');
    }
  );
});
