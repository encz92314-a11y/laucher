import { fabricProfile } from './fabric.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const officialManifest = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const operatingSystems = { win32: 'windows', darwin: 'osx', linux: 'linux' };
const trustedHosts = new Set([
  'piston-meta.mojang.com', 'piston-data.mojang.com', 'launchermeta.mojang.com',
  'launcher.mojang.com', 'meta.fabricmc.net', 'maven.fabricmc.net', 'api.modrinth.com', 'cdn.modrinth.com', 'libraries.minecraft.net', 'resources.download.minecraft.net',
]);

export async function officialFetch(url, headers = {}) {
  const address = new URL(url);
  if (address.protocol !== 'https:' || address.username || address.password ||
      address.port || !trustedHosts.has(address.hostname)) {
    throw new Error('下载地址不属于受信任的资源服务器');
  }
  const response = await fetch(address, { redirect: 'error', headers: { 'User-Agent': 'Zephyr/0.2.3', ...headers }, signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`资源请求失败（HTTP ${response.status}）`);
  return response;
}

export function localPath(root, relative) {
  if (typeof relative !== 'string' || relative.split('/').some(
    part => !part || part === '.' || part === '..' || /[<>:"\\|?*\x00-\x1f]/.test(part)
      || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part),
  )) throw new Error('无效的文件路径');
  const path = resolve(root, relative);
  if (!path.startsWith(resolve(root) + sep)) throw new Error('无效的文件路径');
  return path;
}

export async function writeJSON(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const { writeFile } = await import('node:fs/promises');
  const temporary = path + '.' + randomUUID();
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function allowed(rules, platform = process.platform, architecture = process.arch) {
  if (!rules) return true;
  const arch = { ia32: 'x86', x64: 'x86_64', arm64: 'arm64' }[architecture];
  let result = false;
  for (const { action, os, features } of rules) {
    if (os?.name && os.name !== operatingSystems[platform]) continue;
    if (os?.arch && os.arch !== arch) continue;
    if (os?.version && !new RegExp(os.version).test(process.getSystemVersion?.() ?? '')) continue;
    if (features && Object.values(features).some(Boolean)) continue;
    result = action === 'allow';
  }
  return result;
}

async function existingMatches(path, descriptor) {
  const info = await stat(path).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!info?.isFile() || (descriptor.size !== undefined && info.size !== descriptor.size)) return false;
  const { createReadStream } = await import('node:fs');
  const hash = createHash('sha1');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex') === descriptor.sha1;
}

export async function verifiedDownload(path, descriptor, request = officialFetch, onBytes = () => {}) {
  if (!/^[a-f0-9]{40}$/.test(descriptor.sha1 ?? '')) throw new Error('资源元数据缺少有效 SHA-1');
  if (await existingMatches(path, descriptor)) return;
  const temporary = path + '.' + descriptor.sha1 + '.part';
  await mkdir(dirname(path), { recursive: true });
  const info = await stat(temporary).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  let offset = descriptor.size && info?.isFile() && info.size < descriptor.size ? info.size : 0;
  const response = await request(descriptor.url, offset ? { Range: `bytes=${offset}-` } : {});
  if (response.status === 206) {
    const expected = `bytes ${offset}-${descriptor.size - 1}/${descriptor.size}`;
    if (!offset || response.headers.get('content-range') !== expected) {
      await response.body?.cancel();
      await rm(temporary, { force: true });
      throw new Error('服务器返回的续传范围无效');
    }
  } else {
    offset = 0;
  }
  let bytes = offset;
  await pipeline(Readable.fromWeb(response.body), new Transform({
    transform(chunk, _, done) {
      bytes += chunk.length;
      if (descriptor.size !== undefined && bytes > descriptor.size) {
        done(new Error('下载文件超过预期大小'));
        return;
      }
      onBytes(chunk.length);
      done(null, chunk);
    },
  }), createWriteStream(temporary, { flags: offset ? 'a' : 'w' }));
  if (!(await existingMatches(temporary, descriptor))) {
    await rm(temporary, { force: true });
    throw new Error('文件完整性校验失败');
  }
  await rename(temporary, path);
}

export function launcher(root, request = officialFetch) {
  const instanceFile = localPath(root, 'instances.json');
  let mutations = Promise.resolve();
  let manifest;
  const active = new Set();
  const list = async () => JSON.parse(await readFile(instanceFile, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '[]';
    throw error;
  }));
  function update(change) {
    const pending = mutations.then(async () => {
      const next = change(await list());
      await writeJSON(instanceFile, next);
      return next;
    });
    mutations = pending.catch(() => {});
    return pending;
  }
  async function versions() {
    manifest ??= request(officialManifest).then(response => response.json()).catch(error => {
      manifest = undefined;
      throw error;
    });
    return (await manifest).versions;
  }
  return {
    list,
    async versions() {
      return (await versions()).map(({ id, type }) => ({ id, type }));
    },
    async create(name, version, loader = 'vanilla') {
      if (!['vanilla', 'fabric'].includes(loader)) throw new Error('未知的加载器');
      name = typeof name === 'string' ? name.trim() : '';
      if (!name || name.length > 80) throw new Error('实例名称应为 1–80 个字符');
      if (!(await versions()).some(entry => entry.id === version)) throw new Error('找不到该官方游戏版本');
      return update(rows => [...rows, { id: randomUUID(), name, version, loader, installed: false }]);
    },
    async install(id, progress) {
      if (active.size) throw new Error('已有安装任务正在运行');
      active.add(id);
      try {
        const instance = (await list()).find(row => row.id === id);
        if (!instance) throw new Error('实例不存在');
        const source = (await versions()).find(entry => entry.id === instance.version);
        if (!source) throw new Error('官方目录中找不到此版本');
        const game = localPath(root, `games/${instance.id}`);
        const metadata = localPath(game, 'version.json');
        await verifiedDownload(metadata, source, request);
        const vanilla = JSON.parse(await readFile(metadata, 'utf8'));
        const launchProfile = localPath(game, 'fabric.json');
        const version = instance.loader === 'fabric' ? await readFile(launchProfile, 'utf8')
          .then(JSON.parse, error => {
            if (error.code !== 'ENOENT') throw error;
            return fabricProfile(vanilla, request);
          }) : vanilla;
        if (version.id !== instance.version) throw new Error('版本元数据不匹配');
        const assetIndex = localPath(game, `assets/indexes/${version.assetIndex.id}.json`);
        await verifiedDownload(assetIndex, version.assetIndex, request);
        const index = JSON.parse(await readFile(assetIndex, 'utf8'));
        const files = new Map([[localPath(game, 'client.jar'), version.downloads.client]]);
        for (const lib of version.libraries.filter(lib => allowed(lib.rules))) {
          if (lib.downloads?.artifact) {
            files.set(localPath(game, `libraries/${lib.downloads.artifact.path}`), lib.downloads.artifact);
          }
          const classifier = lib.natives?.[operatingSystems[process.platform]];
          if (classifier) {
            const key = classifier.replace('${arch}', process.arch === 'ia32' ? '32' : '64');
            const native = lib.downloads?.classifiers?.[key];
            if (!native) throw new Error(`此版本缺少 ${process.arch} 平台的原生库`);
            files.set(localPath(game, `libraries/${native.path}`), native);
          }
        }
        for (const { hash, size } of Object.values(index.objects)) {
          if (!/^[a-f0-9]{40}$/.test(hash)) throw new Error('资源索引哈希无效');
          const key = `${hash.slice(0, 2)}/${hash}`;
          files.set(localPath(game, `assets/objects/${key}`), {
            url: `https://resources.download.minecraft.net/${key}`, sha1: hash, size,
          });
        }
        if (version.logging?.client?.file) {
          const logConfig = version.logging.client.file;
          files.set(localPath(game, `log_configs/${logConfig.id}`), logConfig);
        }
        const queue = files.entries();
        let completed = 0;
        let failure;
        let bytes = 0;
        let last = 0;
        const started = Date.now();
        const report = () => progress({ completed, total: files.size,
          bytesPerSecond: bytes * 1000 / Math.max(1, Date.now() - started) });
        report();
        await Promise.all(Array.from({ length: 6 }, async () => {
          while (!failure) {
            const next = queue.next();
            if (next.done) return;
            const [path, descriptor] = next.value;
            try {
              await verifiedDownload(path, descriptor, request, count => {
                bytes += count;
                if (Date.now() - last > 250) { last = Date.now(); report(); }
              });
              completed++;
              if (completed === files.size || Date.now() - last > 250) { last = Date.now(); report(); }
            } catch (error) {
              failure ??= error;
            }
          }
        }));
        if (failure) throw failure;
        if (instance.loader === 'fabric') await writeJSON(launchProfile, version);
        return update(rows => rows.map(row => row.id === id ? { ...row, installed: true } : row));
      } finally {
        active.delete(id);
      }
    },
  };
}
