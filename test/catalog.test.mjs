import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import AdmZip from 'adm-zip';
import { catalog, installPack } from '../desktop/catalog.mjs';
import { defaultSkins, skinPreview } from '../desktop/skins.mjs';

test('browse and gallery work without an instance, and texture downloads are verified', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'zephyr-catalog-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const body = 'zip fixture';
  const hash = createHash('sha1').update(body).digest('hex');
  const store = catalog(async address => {
    const url = new URL(address);
    if (url.hostname === 'cdn.modrinth.com') return new Response(body);
    if (url.pathname.endsWith('/search')) {
      assert.equal(url.searchParams.get('facets'), '[["project_type:resourcepack"]]');
      return Response.json({ total_hits: 1, hits: [{
        title: 'Texture', description: 'Pack', project_id: 'texture', icon_url: 'https://example.org/no', downloads: 100,
      }] });
    }
    if (url.pathname.endsWith('/version')) return Response.json([{
      game_versions: ['26.3'], version_type: 'release', id: 'release', version_number: '1',
      files: [{ filename: 'texture.zip', url: 'https://cdn.modrinth.com/texture.zip',
        hashes: { sha1: hash }, size: body.length }],
    }]);
    return Response.json({ id: 'texture', title: 'Texture', project_type: 'resourcepack', gallery: [
      { url: 'https://example.org/untrusted' }, { url: 'https://cdn.modrinth.com/screenshot.png' },
    ] });
  });
  const result = await store.browse('resourcepack', '');
  assert.equal(result.items[0].id, 'texture');
  assert.equal(result.items[0].icon, undefined);
  assert.equal((await store.details('texture')).gallery.length, 1);
  const instance = { version: '26.3', loader: 'vanilla' };
  await store.install(await store.plan('texture', instance), directory, instance);
  assert.equal(await readFile(join(directory, 'resourcepacks', 'modrinth-texture-release.zip'), 'utf8'), body);
});

test('Modrinth packs validate dependencies and refuse to overwrite current instance files', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'zephyr-pack-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const zip = new AdmZip();
  zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify({ formatVersion: 1, game: 'minecraft',
    dependencies: { minecraft: '26.3', 'fabric-loader': '0.20.0' }, files: [] })));
  zip.addFile('overrides/config/example.json', Buffer.from('{}'));
  const archive = join(directory, 'fixture.mrpack');
  zip.writeZip(archive);
  await writeFile(join(directory, 'fabric.json'), '{"fabricLoader":"0.20.0"}');
  await assert.rejects(installPack(archive, directory, { version: '26.2' }), /匹配的/);
  await installPack(archive, directory, { version: '26.3' });
  assert.equal(await readFile(join(directory, 'config', 'example.json'), 'utf8'), '{}');
  await assert.rejects(installPack(archive, directory, { version: '26.3' }), /覆盖现有文件/);
});

test('default skins use Minecraft texture paths and validate dimensions', () => {
  const png = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(png);
  png.write('IHDR', 12);
  png.writeUInt32BE(64, 16);
  png.writeUInt32BE(64, 20);
  const zip = new AdmZip();
  zip.addFile('assets/minecraft/textures/entity/player/slim/alex.png', png);
  assert.deepEqual(defaultSkins(zip.toBuffer()), [{ name: 'alex', variant: 'slim', skin: skinPreview(png) }]);
  assert.throws(() => skinPreview(Buffer.from('not a PNG')), /PNG 皮肤/);
});
