import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { authenticationError, minecraftIdentity, minecraftSkinUrl } from '../desktop/account.mjs';
import { launchArguments } from '../desktop/game.mjs';

test('Minecraft authentication validates ownership before obtaining profile', async () => {
  const profile = { id: '1'.repeat(32), name: 'TestPlayer' };
  const calls = [];
  let ownsJava = false;
  async function request(url, options) {
    const route = new URL(url).pathname;
    calls.push(route);
    switch (route) {
      case '/user/authenticate': return { Token: 'xbl' };
      case '/xsts/authorize': return { Token: 'xsts', DisplayClaims: { xui: [{ uhs: 'hash' }] } };
      case '/authentication/login_with_xbox':
        assert.equal(options.body.identityToken, 'XBL3.0 x=hash;xsts');
        return { access_token: 'game', expires_in: 60 };
      case '/entitlements/mcstore': return { items: ownsJava ? [{ name: 'game_minecraft' }] : [] };
      case '/minecraft/profile':
        assert.equal(options.access, 'game');
        return profile;
      default: throw new Error('Unexpected endpoint');
    }
  }
  await assert.rejects(minecraftIdentity('microsoft', request), /所有权验证/);
  assert.equal(calls.includes('/minecraft/profile'), false);
  ownsJava = true;
  const account = await minecraftIdentity('microsoft', request);
  assert.equal(account.id, profile.id);
  assert.equal(account.name, profile.name);
  assert.equal(account.access, 'game');
  assert.ok(account.expires > Date.now());
});

test('builds classpath using the active platform separator and preserves argument boundaries', () => {
  const root = resolve(tmpdir(), 'Path With Spaces');
  const version = {
    id: 'test', type: 'release', mainClass: 'example.Main', assetIndex: { id: 'a' },
    libraries: [{ downloads: { artifact: { path: 'library.jar' } } }],
    arguments: { jvm: ['-cp', '${classpath}'], game: ['--username', '${auth_player_name}', '--gameDir', '${game_directory}'] },
  };
  const args = launchArguments(version, root, { name: 'TestPlayer' });
  assert.deepEqual(args, [
    '-Xmx2G', '-cp', [resolve(root, 'libraries', 'library.jar'), resolve(root, 'client.jar')].join(delimiter),
    'example.Main', '--username', 'TestPlayer', '--gameDir', root,
  ]);
  assert.throws(() => launchArguments({ ...version, arguments: undefined }, root, {}), /旧版启动参数/);
});

test('Minecraft authorization and entitlement errors are distinct and skin links stay on Mojang', () => {
  assert.match(authenticationError('https://api.minecraftservices.com/authentication/login_with_xbox', 403).message,
    /应用授权失败.*Minecraft API 访问批准/);
  assert.match(authenticationError('https://api.minecraftservices.com/entitlements/mcstore', 403).message,
    /所有权检查失败/);
  assert.equal(minecraftSkinUrl('http://textures.minecraft.net/texture/a123'), 'https://textures.minecraft.net/texture/a123');
  assert.equal(minecraftSkinUrl('https://textures.minecraft.net.attacker.test/texture/a123'), undefined);
});
