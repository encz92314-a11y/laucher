import AdmZip from 'adm-zip';
import { readFile } from 'node:fs/promises';
import { localPath, officialFetch, verifiedDownload, writeJSON } from './core.mjs';
import { commitPack } from './catalog.mjs';

const endpoint = 'https://api.curseforge.com/v1';
const classes = { mod: 6, shader: 6552, resourcepack: 12, modpack: 4471 };
const folders = { mod: 'mods', shader: 'shaderpacks', resourcepack: 'resourcepacks' };
const forgeCdn = new Set(['edge.forgecdn.net', 'media.forgecdn.net', 'mediafiles.forgecdn.net', 'mediafilez.forgecdn.net']);

function numericId(value) {
  if (!/^[1-9][0-9]{0,11}$/.test(String(value))) throw new Error('CurseForge 资源标识无效');
  return String(value);
}

function cdn(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && forgeCdn.has(url.hostname) && !url.port && !url.username && !url.password) return url.href;
  } catch {}
}

function projectPage(value) {
  const url = new URL(value);
  if (url.origin !== 'https://www.curseforge.com' || !url.pathname.startsWith('/minecraft/')) {
    throw new Error('CurseForge 页面地址无效');
  }
  return url.href;
}

export function curseSettings(root, storage) {
  const path = localPath(root, 'curseforge.json');
  const available = () => storage.isEncryptionAvailable() && storage.getSelectedStorageBackend?.() !== 'basic_text';
  return {
    async get() {
      if (process.env.CURSEFORGE_API_KEY) return process.env.CURSEFORGE_API_KEY;
      if (!available()) return '';
      const contents = await readFile(path, 'utf8').catch(error => {
        if (error.code === 'ENOENT') return '';
        throw error;
      });
      return contents ? storage.decryptString(Buffer.from(JSON.parse(contents).protected, 'base64')) : '';
    },
    async save(key) {
      if (!available()) throw new Error('系统钥匙串不可用，无法保存 API Key');
      if (typeof key !== 'string' || !/^[!-~]{10,512}$/.test(key)) throw new Error('请输入有效的 CurseForge API Key');
      await writeJSON(path, { protected: storage.encryptString(key).toString('base64') });
    },
  };
}

export function curseforge(getKey, request = fetch, download = officialFetch) {
  async function json(path) {
    const key = await getKey();
    if (!key) throw new Error('请先配置 CurseForge API Key');
    const response = await request(endpoint + path, { headers: { 'x-api-key': key, Accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(25_000) });
    if (!response.ok) throw new Error(`CurseForge API 请求失败（HTTP ${response.status}）`);
    return response.json();
  }

  async function metadata(project) {
    return (await json('/mods/' + numericId(project))).data;
  }

  function fileDescriptor(file) {
    const url = cdn(file.downloadUrl);
    if (!url) throw new Error('作者限制了第三方下载，请从 CurseForge 官网下载此文件');
    const sha1 = file.hashes?.find(hash => hash.algo === 1)?.value;
    if (!/^[a-f0-9]{40}$/i.test(sha1 ?? '') || !Number.isSafeInteger(file.fileLength) ||
        file.fileLength <= 0 || file.fileLength > 512 * 1024 * 1024) throw new Error('此文件缺少可校验的下载信息');
    return { url, sha1: sha1.toLowerCase(), size: file.fileLength };
  }

  async function resolve(project, instance, kind) {
    const query = new URLSearchParams({ gameVersion: instance.version, pageSize: '50' });
    if (kind === 'mod' || kind === 'modpack') query.set('modLoaderType', '4');
    const response = await json('/mods/' + numericId(project) + '/files?' + query);
    const release = response.data.find(file => file.releaseType === 1 && file.gameVersions?.includes(instance.version));
    if (!release) throw new Error('CurseForge 没有适配当前实例的正式版');
    return release;
  }

  return {
    async browse(kind, query, offset) {
      if (!Object.hasOwn(classes, kind) || typeof query !== 'string' || query.length > 100 ||
          !Number.isInteger(offset) || offset < 0 || offset > 996) throw new Error('搜索参数无效');
      const params = new URLSearchParams({ gameId: '432', classId: String(classes[kind]), searchFilter: query,
        sortField: query ? '1' : '6', sortOrder: 'desc', index: String(offset), pageSize: '12' });
      const result = await json('/mods/search?' + params);
      return { total: result.pagination.totalCount, items: result.data.map(item => ({
        id: numericId(item.id), title: item.name, description: item.summary, icon: cdn(item.logo?.url),
        downloads: item.downloadCount,
      })) };
    },
    async details(project) {
      const entry = await metadata(project);
      const kind = Object.keys(classes).find(key => classes[key] === entry.classId);
      if (!kind) throw new Error('不支持此 CurseForge 资源类型');
      return { id: numericId(entry.id), kind, title: entry.name, description: entry.summary, body: '',
        gallery: (entry.screenshots ?? []).slice(0, 6).map(item => ({
          url: cdn(item.url), title: item.title,
        })).filter(item => item.url), versions: [...new Set((entry.latestFilesIndexes ?? []).map(file => file.gameVersion))].slice(0, 12) };
    },
    async openPage(project) {
      return projectPage((await metadata(project)).links.websiteUrl);
    },
    async plan(project, instance) {
      const details = await this.details(project);
      if (details.kind !== 'resourcepack' && instance.loader !== 'fabric') throw new Error('请选择已安装的 Fabric 实例');
      const seen = new Map();
      async function include(detail) {
        if (seen.has(detail.id)) return;
        if (seen.size >= 64) throw new Error('CurseForge 依赖数量超过限制');
        const file = await resolve(detail.id, instance, detail.kind);
        seen.set(detail.id, { ...fileDescriptor(file), kind: detail.kind, project: detail.id,
          id: numericId(file.id), title: detail.title, version: file.displayName });
        if (detail.kind !== 'mod') return;
        for (const relation of file.dependencies ?? []) {
          if (relation.relationType !== 3) continue;
          const item = await metadata(relation.modId);
          if (item.classId !== classes.mod) throw new Error('CurseForge 声明了不支持的必需依赖');
          await include({ id: numericId(item.id), title: item.name, kind: 'mod' });
        }
      }
      await include(details);
      return [...seen.values()];
    },
    async install(plan, instance, game, report) {
      let completed = 0;
      let bytes = 0;
      const started = Date.now();
      let last = 0;
      const progress = () => report({ completed, total: plan.length, bytesPerSecond: bytes * 1000 / Math.max(1, Date.now() - started) });
      const increment = size => {
        bytes += size;
        if (Date.now() - last >= 250) { last = Date.now(); progress(); }
      };
      progress();
      const files = new Map();
      for (const file of plan) {
        const name = `curseforge-${file.project}-${file.id}`;
        if (file.kind === 'modpack') {
          const path = localPath(game, 'pack-downloads/' + name + '.zip');
          await verifiedDownload(path, file, download, increment);
          const zip = new AdmZip(path);
          const entry = zip.getEntry('manifest.json');
          if (!entry || entry.header.size > 2 * 1024 * 1024) throw new Error('整合包没有可读取的 CurseForge 清单');
          const manifest = JSON.parse(zip.readAsText(entry));
          const profile = JSON.parse(await readFile(localPath(game, 'fabric.json'), 'utf8'));
          if (manifest.manifestType !== 'minecraftModpack' || manifest.manifestVersion !== 1 ||
              manifest.minecraft?.version !== instance.version ||
              !manifest.minecraft?.modLoaders?.some(loader => loader.id === 'fabric-' + profile.fabricLoader)) {
            throw new Error('整合包需要匹配的 Minecraft 和 Fabric Loader 版本');
          }
          if (!Array.isArray(manifest.files) || manifest.files.length > 1800) throw new Error('整合包文件数量超出限制');
          for (const item of manifest.files) {
            if (!item.required) continue;
            const projectId = numericId(item.projectID);
            const fileId = numericId(item.fileID);
            const resource = (await json(`/mods/${projectId}/files/${fileId}`)).data;
            const kind = resource.fileName?.endsWith('.jar') ? 'mods' : resource.fileName?.endsWith('.zip') ? 'resourcepacks' : '';
            if (!kind) throw new Error('整合包包含不支持的文件类型');
            files.set(`${kind}/curseforge-${projectId}-${fileId}${kind === 'mods' ? '.jar' : '.zip'}`, { entry: fileDescriptor(resource) });
          }
          if (manifest.overrides && !/^[a-zA-Z0-9_-]+$/.test(manifest.overrides)) throw new Error('整合包覆盖目录无效');
          let size = 0;
          for (const item of zip.getEntries()) {
            if (item.isDirectory || !manifest.overrides || !item.entryName.startsWith(manifest.overrides + '/')) continue;
            const relative = item.entryName.slice(manifest.overrides.length + 1);
            size += item.header.size;
            if (!/^(resourcepacks|shaderpacks|config)\//.test(relative) || /\.(jar|exe|dll|sh|bat|cmd|ps1)$/i.test(relative) ||
                files.has(relative) || size > 96 * 1024 * 1024 || files.size >= 1800) {
              throw new Error('整合包覆盖文件不受支持、重复或太大');
            }
            files.set(relative, { item });
          }
        } else {
          files.set(folders[file.kind] + '/' + name + (file.kind === 'mod' ? '.jar' : '.zip'), { entry: file });
        }
      }
      await commitPack(files, game, download, increment);
      completed = plan.length;
      progress();
    },
  };
}
