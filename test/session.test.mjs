import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { accountStore, offlineAccount } from '../desktop/session.mjs';
import { launchArguments } from '../desktop/game.mjs';

test('protected Microsoft profile survives restart and local offline names omit online credentials', async t => {
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
  assert.equal((await accountStore(root, storage).saved()).id, profile.id);
  // Upgrade a single-account vault from Zephyr 0.2.x.
  const protectedProfile = storage.encryptString(JSON.stringify(profile)).toString('base64');
  await writeFile(join(root, 'verified-account.json'), JSON.stringify({ protected: protectedProfile }));
  const alternate = { ...profile, id: 'b'.repeat(32), name: 'AlternatePlayer' };
  await accounts.remember(alternate);
  assert.deepEqual((await accountStore(root, storage).list()).map(value => value.id), [alternate.id, profile.id]);
  await accounts.forget(alternate.id);
  assert.deepEqual((await accounts.list()).map(value => value.id), [profile.id]);
  const offline = offlineAccount('TestPlayer');
  assert.match(offline.id, /^[a-f0-9]{32}$/);
  assert.notEqual(offline.id, profile.id);
  assert.equal(offlineAccount('TestPlayer').id, offline.id);
  assert.throws(() => offlineAccount('a/b'), /离线昵称/);
  const args = launchArguments({ id: '26.3', type: 'release', assetIndex: { id: '0' }, libraries: [],
    arguments: { game: ['${auth_access_token}', '${user_type}'], jvm: [] }, mainClass: 'Client' }, root, offline);
  assert.deepEqual(args.slice(-3), ['0', 'legacy', '--disableMultiplayer']);
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

test('a new profile has a default Microsoft application ID', async t => {
  const root = await mkdtemp(join(tmpdir(), 'zephyr-default-oauth-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packagedId = JSON.parse(await readFile(new URL('../desktop/oauth-default.json', import.meta.url), 'utf8')).clientId;
  const configuredId = process.env.MINECRAFT_CLIENT_ID;
  if (!configuredId) assert.equal(await accountStore(root, {}).clientId(), packagedId);
  const auth = await accountStore(root, {}).clientId();
  assert.match(auth, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
});
