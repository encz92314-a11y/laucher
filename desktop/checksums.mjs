import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const folder = process.argv[2] ?? 'release';
const files = (await readdir(folder)).filter(name => /\.(exe|dmg|appimage|deb)$/i.test(name)).sort();
if (files.length === 0) throw new Error('No desktop packages found');
const checksums = [];
for (const name of files) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(join(folder, name))) hash.update(chunk);
  checksums.push(`${hash.digest('hex')}  ${name}`);
}
await writeFile(join(folder, 'SHA256SUMS.txt'), checksums.join('\n') + '\n');
