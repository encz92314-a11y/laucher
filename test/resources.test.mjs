import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fabricProfile } from '../desktop/fabric.mjs';
import { modrinth } from '../desktop/modrinth.mjs';
import { launchArguments } from '../desktop/game.mjs';

test('Fabric inherits client metadata, replaces overlapping Maven libraries and supplies its entry point', async () => {
  const vanilla = {
    id: '1.21.1', mainClass: 'vanilla.Client', type: 'release', assetIndex: { id: 'assets' },
    libraries: [{ name: 'org.ow2.asm:asm:9.6' }, { name: 'vanilla:library:1' }],
    arguments: { jvm: [], game: ['--username', '${auth_player_name}'] },
  };
  const urls = [];
  const profile = await fabricProfile(vanilla, async url => {
    urls.push(url);
    if (url.endsWith('.sha1')) return new Response('a'.repeat(40));
    if (url.endsWith('profile/json')) {
      return Response.json({ inheritsFrom: vanilla.id, mainClass: 'fabric.Client',
        libraries: [{ name: 'org.ow2.asm:asm:9.7' }], arguments: { game: ['--extra'] } });
    }
    return Response.json([{ loader: { stable: false, version: '0.17' } }, { loader: { stable: true, version: '0.16' } }]);
  });
  assert.equal(profile.fabricLoader, '0.16');
  assert.equal(urls[2], 'https://maven.fabricmc.net/org/ow2/asm/asm/9.7/asm-9.7.jar.sha1');
  assert.deepEqual(profile.libraries.map(lib => lib.name), ['org.ow2.asm:asm:9.7', 'vanilla:library:1']);
  assert.deepEqual(launchArguments(profile, join(tmpdir(), 'fabric'), { name: 'Player' }).slice(1),
    ['fabric.Client', '--username', 'Player', '--extra']);
});

test('Modrinth resolves required dependencies and stages verified downloads', async t => {
  const root = await mkdtemp(join(tmpdir(), 'modrinth-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const game = '1.21.1';
  const sha1 = createHash('sha1').update('good').digest('hex');
  const fixture = project => ({
    id: project + 'Version', project_id: project, version_type: 'release', version_number: '1',
    game_versions: [game], loaders: ['fabric'],
    files: [{ filename: project + '.jar', url: 'https://cdn.modrinth.com/' + project, hashes: { sha1 }, size: 4 }],
    dependencies: project === 'parent' ? [{ dependency_type: 'required', version_id: 'childVersion' },
      { dependency_type: 'optional', project_id: 'optional' }] : [],
  });
  let broken = true;
  let wrongVersion = false;
  const service = modrinth(async input => {
    const url = new URL(input);
    if (url.hostname === 'cdn.modrinth.com') return new Response(broken && url.pathname === '/child' ? 'fail' : 'good');
    if (url.pathname === '/v2/project/parent/version') return Response.json([fixture('parent')]);
    if (url.pathname === '/v2/version/childVersion') {
      return Response.json({ ...fixture('child'), game_versions: wrongVersion ? ['1.20.1'] : [game] });
    }
    return Response.json({ title: url.pathname.split('/').at(-1), project_type: 'mod', client_side: 'optional' });
  });
  wrongVersion = true;
  await assert.rejects(service.plan('parent', game), /不兼容/);
  wrongVersion = false;
  const plan = await service.plan('parent', game);
  assert.deepEqual(plan.map(file => file.project), ['parent', 'child']);
  await assert.rejects(service.install(plan, root), /校验失败/);
  assert.deepEqual(await readdir(join(root, 'mods')), []);
  broken = false;
  await service.install(plan, root);
  assert.deepEqual((await readdir(join(root, 'mods'))).sort(),
    ['modrinth-child-childVersion.jar', 'modrinth-parent-parentVersion.jar']);
});
