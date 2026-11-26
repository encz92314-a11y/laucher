import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { officialFetch, localPath, verifiedDownload } from '../desktop/core.mjs';
import { fabricProfile } from '../desktop/fabric.mjs';

const directory = await mkdtemp(join(tmpdir(), 'zephyr-fabric-'));
try {
  const manifest = await (await officialFetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')).json();
  const entry = manifest.versions.find(version => version.id === '26.3');
  assert.ok(entry, 'Mojang manifest includes Minecraft 26.3');
  const metadataPath = localPath(directory, 'version.json');
  await verifiedDownload(metadataPath, entry);
  const vanilla = JSON.parse(await readFile(metadataPath, 'utf8'));
  const fabric = await fabricProfile(vanilla, officialFetch);
  const libraries = fabric.libraries.filter(library => !vanilla.libraries.includes(library));
  assert.ok(libraries.length > 0);
  await Promise.all(libraries.map(({ downloads: { artifact } }) =>
    verifiedDownload(localPath(directory, artifact.path), artifact)));
  console.log(`Verified Minecraft ${vanilla.id}, Fabric Loader ${fabric.fabricLoader}, and ${libraries.length} Fabric libraries.`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
