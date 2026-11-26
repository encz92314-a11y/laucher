import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { curseforge } from '../desktop/curseforge.mjs';

test('CurseForge browsing, required dependencies, verified downloads and restricted files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'zephyr-curse-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const content = 'JAR fixture';
  const sha1 = createHash('sha1').update(content).digest('hex');
  let restricted = false;
  const metadata = id => ({ id, classId: 6, name: 'Project ' + id, summary: 'Description',
    links: { websiteUrl: 'https://www.curseforge.com/minecraft/mc-mods/project' } });
  const file = id => ({ id: id + 100, displayName: 'release', releaseType: 1,
    downloadUrl: restricted ? null : 'https://edge.forgecdn.net/files/1/' + id + '.jar',
    fileLength: content.length, gameVersions: ['1.21.1'], hashes: [{ algo: 1, value: sha1 }],
    dependencies: id === 10 ? [{ relationType: 3, modId: 20 }] : [] });
  const api = async (address, options) => {
    const url = new URL(address);
    assert.equal(url.origin, 'https://api.curseforge.com');
    assert.equal(options.headers['x-api-key'], 'test-key');
    if (url.pathname.endsWith('/search')) {
      assert.equal(url.searchParams.get('classId'), '6');
      return Response.json({ pagination: { totalCount: 1 }, data: [metadata(10)] });
    }
    if (url.pathname.endsWith('/files')) {
      assert.equal(url.searchParams.get('modLoaderType'), '4');
      return Response.json({ data: [file(Number(url.pathname.split('/').at(-2)))] });
    }
    return Response.json({ data: metadata(Number(url.pathname.split('/').at(-1))) });
  };
  const download = async (url, options) => {
    assert.equal(new URL(url).origin, 'https://edge.forgecdn.net');
    assert.equal(options['x-api-key'], undefined);
    return new Response(content);
  };
  const store = curseforge(async () => 'test-key', api, download);
  assert.equal((await store.browse('mod', '', 0)).items[0].id, '10');
  assert.equal(await store.openPage('10'), 'https://www.curseforge.com/minecraft/mc-mods/project');
  const instance = { loader: 'fabric', version: '1.21.1' };
  const plan = await store.plan('10', instance);
  assert.deepEqual(plan.map(item => item.project), ['10', '20']);
  await store.install(plan, instance, root, () => {});
  assert.equal(await readFile(join(root, 'mods', 'curseforge-20-120.jar'), 'utf8'), content);
  restricted = true;
  await assert.rejects(store.plan('10', instance), /限制了第三方下载/);
  await assert.rejects(curseforge(async () => '', api).browse('mod', '', 0), /API Key/);
});
