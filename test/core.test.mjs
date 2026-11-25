import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { allowed, launcher, localPath } from '../desktop/core.mjs';

test('rejects traversal and Windows device names', () => {
  for (const path of ['../out', 'foo\\bar', 'foo/CON.jar', 'C:/file', '/etc/passwd', 'foo./file']) {
    assert.throws(() => localPath(tmpdir(), path));
  }
  assert.equal(localPath(tmpdir(), 'libraries/valid.jar'), join(tmpdir(), 'libraries', 'valid.jar'));
});

test('Mojang rules honor platform, architecture, feature and ordering constraints', () => {
  const rules = [
    { action: 'allow', os: { name: 'osx', arch: 'arm64' } },
    { action: 'disallow', features: { is_demo_user: true } },
  ];
  assert.equal(allowed(rules, 'darwin', 'arm64'), true);
  assert.equal(allowed(rules, 'darwin', 'x64'), false);
  assert.equal(allowed(rules, 'win32', 'arm64'), false);
  assert.equal(allowed([...rules, { action: 'disallow' }], 'darwin', 'arm64'), false);
});

test('installs through HTTP, rejects corruption and reuses verified downloads', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'launcher-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const payloads = new Map();
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    const body = payloads.get(request.url);
    if (!body) response.statusCode = 404;
    response.end(body);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  function file(path, value) {
    const body = typeof value === 'string' ? value : JSON.stringify(value);
    payloads.set(path, body);
    return { url: 'https://example.test' + path, sha1: createHash('sha1').update(body).digest('hex'), size: Buffer.byteLength(body) };
  }
  const asset = file('/fixture', 'asset bytes');
  payloads.set('/' + asset.sha1.slice(0, 2) + '/' + asset.sha1, 'asset bytes');
  const client = file('/client.jar', 'valid client');
  const metadata = file('/version.json', {
    id: 'test', libraries: [], downloads: { client },
    assetIndex: { id: 'test', ...file('/assets.json', { objects: { text: { hash: asset.sha1, size: asset.size } } }) },
  });
  file('/mc/game/version_manifest_v2.json', { versions: [{ id: 'test', type: 'release', ...metadata }] });
  const request = async url => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`);
    assert.equal(response.ok, true);
    return response;
  };
  const service = launcher(directory, request);
  const [{ id }] = await service.create('测试世界', 'test');
  await service.create('第二个世界', 'test');
  payloads.set('/client.jar', 'bad!! client');
  await assert.rejects(service.install(id, () => {}), /校验失败/);
  assert.equal((await service.list())[0].installed, false);
  assert.equal((await readdir(join(directory, 'games', id))).some(path => path.endsWith('.part')), false);
  payloads.set('/client.jar', 'valid client');
  const progress = [];
  const [installed, other] = await service.install(id, value => progress.push(value));
  assert.equal(installed.installed, true);
  assert.equal(other.installed, false);
  assert.equal(progress.at(-1).completed, 2);
  assert.equal(progress.at(-1).total, 2);
  assert.equal(await readFile(join(directory, 'games', id, 'client.jar'), 'utf8'), 'valid client');
  const requestCount = requests.length;
  await service.install(id, () => {});
  assert.equal(requests.length, requestCount);
  assert.deepEqual(await launcher(directory, request).list(), [installed, other]);
});
