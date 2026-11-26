import AdmZip from 'adm-zip';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, lstat, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { localPath, officialFetch, verifiedDownload } from './core.mjs';

const api = 'https://api.modrinth.com/v2';
const kinds = { mod: 'mods', shader: 'shaderpacks', resourcepack: 'resourcepacks', modpack: '' };

function id(value) {
  if (typeof value !== 'string' || !/^[a-z0-9_-]{1,120}$/i.test(value)) throw new Error('资源标识无效');
  return value;
}

function folder(kind) {
  if (!Object.hasOwn(kinds, kind)) throw new Error('未知资源类型');
  return kinds[kind];
}

function image(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://cdn.modrinth.com' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function descriptor(file, extension) {
  if (!file?.filename?.toLowerCase().endsWith(extension) || !image(file.url) ||
      !/^[a-f0-9]{40}$/.test(file.hashes?.sha1 ?? '') || !Number.isSafeInteger(file.size) || file.size <= 0 ||
      file.size > 512 * 1024 * 1024) throw new Error('此资源缺少受信任且可校验的下载文件');
  return { url: file.url, sha1: file.hashes.sha1, size: file.size };
}

export function catalog(request = officialFetch) {
  const json = async path => (await request(api + path)).json();
  return {
    async browse(kind, query, offset = 0) {
      folder(kind);
      if (typeof query !== 'string' || query.length > 100 || !Number.isInteger(offset) || offset < 0 || offset > 996) {
        throw new Error('搜索参数无效');
      }
      const params = new URLSearchParams({ query, facets: JSON.stringify([['project_type:' + kind]]),
        limit: '12', offset: String(offset), index: query ? 'relevance' : 'downloads' });
      const result = await json('/search?' + params);
      return { total: result.total_hits, items: result.hits.map(hit => ({
        id: id(hit.project_id), title: hit.title, description: hit.description, icon: image(hit.icon_url), downloads: hit.downloads,
      })) };
    },
    async details(project) {
      const value = await json('/project/' + id(project));
      return { id: id(value.id), kind: value.project_type, title: value.title, description: value.description,
        body: String(value.body ?? '').slice(0, 16000), icon: image(value.icon_url),
        gallery: (value.gallery ?? []).slice(0, 6).map(entry => ({
          url: image(entry.url), title: String(entry.title ?? ''),
        })).filter(entry => entry.url), versions: (value.game_versions ?? []).slice(-12).reverse() };
    },
    async plan(project, instance) {
      const detail = await this.details(project);
      folder(detail.kind);
      if (detail.kind === 'mod') throw new Error('模组需要通过依赖安装流程');
      if ((detail.kind === 'modpack' || detail.kind === 'shader') && instance.loader !== 'fabric') {
        throw new Error('请选择 Fabric 实例');
      }
      const params = new URLSearchParams({ game_versions: JSON.stringify([instance.version]) });
      if (detail.kind === 'modpack') params.set('loaders', '["fabric"]');
      if (detail.kind === 'shader') params.set('loaders', '["iris"]');
      const versions = await json('/project/' + detail.id + '/version?' + params);
      const wantedLoader = { modpack: 'fabric', shader: 'iris' }[detail.kind];
      const release = versions.find(entry => entry.version_type === 'release' &&
        entry.game_versions?.includes(instance.version) && (!wantedLoader || entry.loaders?.includes(wantedLoader)));
      if (!release) throw new Error('这个资源没有匹配当前实例的正式版');
      const file = release.files?.find(file => file.primary) ?? release.files?.[0];
      return { ...descriptor(file, detail.kind === 'modpack' ? '.mrpack' : '.zip'),
        project: detail.id, versionId: id(release.id), kind: detail.kind, version: release.version_number, title: detail.title };
    },
    async install(plan, game, instance, report = () => {}) {
      const started = Date.now();
      let bytes = 0;
      let last = 0;
      const bytesReceived = count => {
        bytes += count;
        if (Date.now() - last > 250) {
          last = Date.now();
          report({ completed: 0, total: 1, bytesPerSecond: bytes * 1000 / Math.max(1, last - started) });
        }
      };
      const name = 'modrinth-' + id(plan.project) + '-' + id(plan.versionId);
      if (plan.kind === 'modpack') {
        const archive = localPath(game, 'pack-downloads/' + name + '.mrpack');
        await verifiedDownload(archive, plan, request, bytesReceived);
        await installPack(archive, game, instance, request, bytesReceived);
      } else {
        await verifiedDownload(localPath(game, folder(plan.kind) + '/' + name + '.zip'), plan, request, bytesReceived);
      }
      report({ completed: 1, total: 1, bytesPerSecond: bytes * 1000 / Math.max(1, Date.now() - started) });
      return [{ title: plan.title, version: plan.version }];
    },
  };
}

async function exists(path) {
  return lstat(path).then(() => true, error => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
}

export async function installPack(archive, game, instance, request, receive) {
  const zip = new AdmZip(archive);
  const index = zip.getEntry('modrinth.index.json');
  if (!index || index.header.size > 2 * 1024 * 1024) throw new Error('整合包缺少有效的 Modrinth 索引');
  const manifest = JSON.parse(zip.readAsText(index));
  const fabric = JSON.parse(await readFile(localPath(game, 'fabric.json'), 'utf8'));
  if (manifest.formatVersion !== 1 || manifest.game !== 'minecraft' || manifest.dependencies?.minecraft !== instance.version ||
      !manifest.dependencies?.['fabric-loader'] || manifest.dependencies['fabric-loader'] !== fabric.fabricLoader ||
      Object.keys(manifest.dependencies).some(key => !['minecraft', 'fabric-loader'].includes(key))) {
    throw new Error('整合包需要匹配的 Minecraft 和 Fabric Loader 版本');
  }
  if (!Array.isArray(manifest.files) || manifest.files.length > 1800) throw new Error('整合包文件清单过大或无效');
  const files = new Map();
  for (const file of manifest.files) {
    if (file.env?.client === 'unsupported' || file.env?.client === 'optional') continue;
    if (!/^(mods|resourcepacks|shaderpacks|config)\//.test(file.path ?? '')) {
      throw new Error('整合包含有当前版本无法安全导入的文件');
    }
    const extension = file.path.startsWith('mods/') ? '.jar' : '';
    const url = file.downloads?.find(value => image(value));
    const entry = descriptor({ filename: file.path, url, hashes: file.hashes, size: file.fileSize }, extension);
    if (files.has(file.path)) throw new Error('整合包包含重复文件路径');
    files.set(file.path, { entry });
  }
  let overrideBytes = 0;
  for (const item of zip.getEntries()) {
    if (item.isDirectory || !/^(overrides|client-overrides)\//.test(item.entryName)) continue;
    const path = item.entryName.replace(/^[^/]+\//, '');
    if (!/^(resourcepacks|shaderpacks|config)\//.test(path) || /\.(jar|exe|dll|sh|bat|cmd|ps1)$/i.test(path)) {
      throw new Error('整合包含有当前无法导入的覆盖文件');
    }
    overrideBytes += item.header.size;
    if (overrideBytes > 96 * 1024 * 1024 || files.size >= 1800 || files.has(path)) throw new Error('整合包覆盖文件太大或重复');
    files.set(path, { item });
  }
  const targetNames = new Set();
  for (const path of files.keys()) {
    const target = localPath(game, path);
    const insensitive = target.toLowerCase();
    if (targetNames.has(insensitive) || await exists(target)) throw new Error('整合包会覆盖现有文件。请使用空的 Fabric 实例');
    targetNames.add(insensitive);
    for (let parent = dirname(target); parent !== game; parent = dirname(parent)) {
      if (await lstat(parent).then(stat => !stat.isDirectory(), error => {
        if (error.code === 'ENOENT') return false;
        throw error;
      })) throw new Error('整合包目标目录包含链接或普通文件');
    }
  }
  const scratch = localPath(game, 'pack-staging-' + randomUUID());
  const installed = [];
  try {
    for (const [path, file] of files) {
      const destination = localPath(scratch, path);
      if (file.entry) await verifiedDownload(destination, file.entry, request, receive);
      else {
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, file.item.getData(), { flag: 'wx' });
      }
    }
    for (const path of files.keys()) {
      const target = localPath(game, path);
      await mkdir(dirname(target), { recursive: true });
      await rename(localPath(scratch, path), target);
      installed.push(target);
    }
  } catch (error) {
    await Promise.all(installed.map(path => rm(path, { force: true })));
    throw error;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
