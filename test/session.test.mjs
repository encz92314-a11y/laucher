import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { test } from 'node:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { accountStore, offlineAccount } from '../desktop/session.mjs';
import { launchArguments } from '../desktop/game.mjs';

test('offline sessions recover only a stored verified identity and omit online credentials', async t => {
  const root = await mkdtemp(join(tmpdir(), 'zephyr-session-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const key = randomBytes(32);
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString(text) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(text), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    },
    decryptString(buffer) {
      const cipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12));
      cipher.setAuthTag(buffer.subarray(12, 28));
      return Buffer.concat([cipher.update(buffer.subarray(28)), cipher.final()]).toString();
    },
  };
  const accounts = accountStore(root, storage);
  assert.equal(await accounts.saved(), undefined);
  await assert.rejects(accounts.configure('bad'), /有效的/);
  const clientId = '00000000-0000-0000-0000-000000000001';
  await accounts.configure(clientId);
  assert.equal(await accounts.clientId(), clientId);
  const profile = { id: 'a'.repeat(32), name: 'TestPlayer', access: 'access', refresh: 'secret-test-refresh', clientId };
  assert.equal(await accounts.remember(profile), true);
  assert.doesNotMatch(await readFile(join(root, 'verified-account.json'), 'utf8'), /secret-test-refresh|TestPlayer/);
  const offline = offlineAccount(await accountStore(root, storage).saved());
  assert.deepEqual(offline, { id: profile.id, name: profile.name, skin: undefined, offline: true, access: '0' });
  const args = launchArguments({ id: '26.3', type: 'release', assetIndex: { id: '0' }, libraries: [],
    arguments: { game: ['${auth_access_token}', '${user_type}'], jvm: [] }, mainClass: 'Client' }, root, offline);
  assert.deepEqual(args.slice(-2), ['0', 'legacy']);
  await accounts.forget();
  assert.equal(await accounts.saved(), undefined);
});

test('plain-text storage fallback must not store account credentials', async () => {
  const accounts = accountStore(tmpdir(), {
    isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text',
  });
  assert.equal(await accounts.remember({}), false);
  assert.equal(await accounts.saved(), undefined);
});
