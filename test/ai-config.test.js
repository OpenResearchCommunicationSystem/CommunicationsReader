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
const { loadAiConfig, saveAiConfig, getAiConfigStatus } = await import('../src/ai-assist/config.js');

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

test('saveAiConfig writes an encrypted key immediately -- it never touches disk in plaintext, not even for one load', async () => {
  await withConfigFile(null, true, async ({ configFile }) => {
    saveAiConfig({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'sk-ant-brand-new', model: 'claude-sonnet-5-5', orgId: '' });

    const onDisk = JSON.parse(await readFile(configFile, 'utf8'));
    assert.equal(onDisk.apiKey, '', 'the save path itself must never write plaintext, unlike the hand-edit-the-file path');
    assert.ok(onDisk.apiKeyEncrypted);
    assert.equal(onDisk.provider, 'anthropic');
    assert.equal(onDisk.model, 'claude-sonnet-5-5');

    // And it's immediately usable via the normal load path.
    const loaded = loadAiConfig();
    assert.equal(loaded.apiKey, 'sk-ant-brand-new');
    assert.equal(loaded.provider, 'anthropic');
  });
});

test('saveAiConfig with an empty apiKey preserves the existing saved key -- changing the model must not wipe it', async () => {
  await withConfigFile(
    { provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-old-key', model: 'gpt-4o-mini' },
    true,
    async () => {
      loadAiConfig(); // upgrades the plaintext key to apiKeyEncrypted first, same as the app would on any earlier load
      saveAiConfig({ provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o', orgId: '' });

      const loaded = loadAiConfig();
      assert.equal(loaded.apiKey, 'sk-old-key', 'the key survives even though the save left apiKey blank');
      assert.equal(loaded.model, 'gpt-4o', 'the model change still took effect');
    }
  );
});

test('saveAiConfig with clearKey: true actually removes a previously stored key', async () => {
  await withConfigFile(
    { provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-old-key', model: 'gpt-4o-mini' },
    true,
    async ({ configFile }) => {
      saveAiConfig({ provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini', orgId: '', clearKey: true });
      const onDisk = JSON.parse(await readFile(configFile, 'utf8'));
      assert.equal(onDisk.apiKey, '');
      assert.equal(onDisk.apiKeyEncrypted, undefined);
      assert.equal(loadAiConfig(), null, 'clearing the key leaves the feature unconfigured');
    }
  );
});

test('getAiConfigStatus reports configured state and metadata but never the key itself', async () => {
  await withConfigFile(
    { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'sk-ant-secret-value', model: 'claude-sonnet-5-5', orgId: '' },
    true,
    async () => {
      loadAiConfig(); // triggers the transparent plaintext -> encrypted upgrade
      const status = getAiConfigStatus();
      assert.deepEqual(status, { configured: true, provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5', analysisModel: '', orgId: '' });
      assert.ok(!JSON.stringify(status).includes('sk-ant-secret-value'), 'the raw key must never appear anywhere in the status object');
    }
  );
});

test('getAiConfigStatus reports unconfigured when no file exists yet', async () => {
  await withConfigFile(null, true, async () => {
    assert.deepEqual(getAiConfigStatus(), { configured: false, provider: '', baseUrl: '', model: '', analysisModel: '', orgId: '' });
  });
});
