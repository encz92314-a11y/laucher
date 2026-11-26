import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cropRectangle, moveCrop } from '../src/crop.ts';
import { appearanceDefault, appearanceStore, validateAppearance } from '../desktop/appearance.mjs';
import { totalPages, visiblePages, pageSize, maxOffset } from '../src/pagination.ts';

test('appearance persists custom colors, whole-window opacity and imported wallpapers', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'zephyr-appearance-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const preferences = appearanceStore(directory);
  assert.deepEqual((await preferences.load()).values, appearanceDefault);
  const source = Buffer.from([255, 216, 255, 217]);
  const stored = await preferences.storeImage(source);
  const values = { ...appearanceDefault, wallpaper: true, accent: 'custom', customColor: '#00aaff', windowOpacity: 40 };
  await preferences.save(values);
  assert.deepEqual((await appearanceStore(directory).load()), { values, image: stored });
  assert.deepEqual(await readFile(join(directory, 'wallpaper.jpg')), source);
  await preferences.removeImage();
  assert.equal((await preferences.load()).values.wallpaper, false);
  assert.throws(() => validateAppearance({ ...values, windowOpacity: 0 }), /外观设置/);
  assert.throws(() => validateAppearance({ ...values, customColor: 'url(https://example.com)' }), /外观设置/);
  await writeFile(join(directory, 'appearance.json'), JSON.stringify({ ...values, windowOpacity: undefined, opacity: 15 }));
  const migrated = (await preferences.load()).values;
  assert.equal(migrated.windowOpacity, 100);
  assert.equal(migrated.customColor, '#00aaff');
});

test('resource pagination stays in both provider limits and keeps the current page reachable', () => {
  assert.equal(totalPages(0), 1);
  assert.equal(totalPages(24), 2);
  assert.equal(totalPages(25), 3);
  const capped = totalPages(100_000);
  assert.equal((capped - 1) * pageSize, maxOffset);
  for (let current = 1; current <= capped; current++) {
    const shown = visiblePages(current, capped).filter(Boolean);
    assert.ok(shown.includes(current));
    assert.deepEqual(shown, [...new Set(shown)]);
    assert.ok(shown.every(page => page >= 1 && page <= capped));
  }
});

test('background crop zoom and placement stay inside the selected image', () => {
  assert.deepEqual(cropRectangle(640, 480, 16 / 9, 1, .5, .5),
    { width: 640, height: 360, left: 0, top: 60 });
  assert.deepEqual(cropRectangle(640, 480, 16 / 9, 2, 1, 1),
    { width: 320, height: 180, left: 320, top: 300 });
});

test('dragging the background moves in the pointer direction and never exposes empty edges', () => {
  assert.deepEqual(moveCrop({ x: .5, y: .5 }, 200, 100, 50, -25), { x: .25, y: .75 });
  assert.deepEqual(moveCrop({ x: .5, y: .5 }, 0, 100, 1000, 1000), { x: .5, y: 0 });
  assert.deepEqual(moveCrop({ x: .75, y: .5 }, 200, 100, -1000, 0), { x: 1, y: .5 });
});
