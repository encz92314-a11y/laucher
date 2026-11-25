import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifiedDownload } from '../desktop/core.mjs';
import { selectJava } from '../desktop/game.mjs';
import { activatePreset, currentProfile, gameProfile, preparePreset, selectShader, systemProfile } from '../desktop/performance.mjs';

async function temporary(t) {
  const path = await mkdtemp(join(tmpdir(), 'launcher-profile-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('presets skip unavailable and conflicting projects but report transport failures', async () => {
  const resources = { async plan(project) {
    if (project === 'moreculling') throw Object.assign(new Error('no release'), { code: 'NO_COMPATIBLE_VERSION' });
    return [{ project, id: project, incompatible: project === 'entityculling' ? [{ project_id: 'sodium' }] : [] }];
  } };
  const plan = await preparePreset(resources, 'fast', '1.21.1');
  assert.deepEqual(plan.files.map(file => file.project), ['sodium', 'lithium', 'ferrite-core']);
  assert.deepEqual(plan.skipped.map(file => file.project), ['entityculling', 'moreculling']);
  await assert.rejects(preparePreset({ plan: () => { throw new Error('timeout'); } }, 'fast', '1.21.1'), /timeout/);
});

test('changes presets without moving player mods and leaves resolution alone', async t => {
  const game = await temporary(t);
  const resources = { install: async (_, root) => mkdir(join(root, 'mods'), { recursive: true }) };
  await writeFile(join(game, 'options.txt'), 'fullscreenResolution:1920x1080@60\nrenderDistance:6\n');
  await activatePreset(resources, game, 'balanced', []);
  assert.equal(await currentProfile(game), 'balanced');
  assert.match((await gameProfile(game, 'balanced'))[0], /performance[\\/]balanced[\\/]mods$/);
  await writeFile(join(game, 'shaderpacks', 'shader.zip'), '');
  await selectShader(game, 'shader.zip');
  assert.match(await readFile(join(game, 'config', 'iris.properties'), 'utf8'), /enableShaders=true\nshaderPack=shader.zip/);
  assert.match(await readFile(join(game, 'options.txt'), 'utf8'), /fullscreenResolution:1920x1080@60\nrenderDistance:12/);
  await activatePreset(resources, game, 'off', []);
  assert.deepEqual(await gameProfile(game, await currentProfile(game)), []);
});

test('ARM Java selection rejects a translated runtime and memory recommendation is capped', async () => {
  assert.equal(systemProfile(8 * 2 ** 30, 8).memory, 3);
  assert.equal(systemProfile(64 * 2 ** 30, 16).memory, 8);
  const archOutput = arch => ({ stdout: '', stderr: 'openjdk version "21.0.1"\n    os.arch = ' + arch });
  const base = { platform: 'darwin', arch: 'arm64', configured: '/custom/java' };
  await assert.rejects(selectJava(21, { ...base, run: async () => archOutput('x86_64') }), /ARM64/);
  assert.equal(await selectJava(21, { ...base, run: async () => archOutput('aarch64') }), '/custom/java');
});

test('resumes an interrupted file and verifies the final result before committing', async t => {
  const root = await temporary(t);
  const path = join(root, 'file.jar');
  const sha1 = createHash('sha1').update('abcdef').digest('hex');
  const file = { url: 'https://example.org/file', size: 6, sha1 };
  const temporaryFile = path + '.' + sha1 + '.part';
  await writeFile(temporaryFile, 'abc');
  await verifiedDownload(path, file, async (_, headers) => {
    assert.equal(headers.Range, 'bytes=3-');
    return new Response('def', { status: 206, headers: { 'content-range': 'bytes 3-5/6' } });
  });
  assert.equal(await readFile(path, 'utf8'), 'abcdef');
  await assert.rejects(readFile(temporaryFile), /ENOENT/);
});
