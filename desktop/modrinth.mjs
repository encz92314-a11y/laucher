import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { localPath, officialFetch, verifiedDownload } from './core.mjs';

const api = 'https://api.modrinth.com/v2';

function identifier(value) {
  if (typeof value !== 'string' || !/^[a-z0-9_-]{1,120}$/i.test(value)) throw new Error('Modrinth 资源标识无效');
  return value;
}

export function modrinth(request = officialFetch) {
  const json = async path => (await request(api + path)).json();
  const compatible = (version, game) => version.game_versions?.includes(game) && version.loaders?.includes('fabric');
  async function newest(project, game) {
    const query = new URLSearchParams({ loaders: '["fabric"]', game_versions: JSON.stringify([game]) });
    const versions = await json('/project/' + identifier(project) + '/version?' + query);
    const result = versions.find(item => item.version_type === 'release' && compatible(item, game));
    if (!result) throw new Error(`资源 ${project} 没有适用的 Fabric 正式版`);
    return result;
  }
  return {
    async search(query, game) {
      if (typeof query !== 'string' || query.length > 100) throw new Error('搜索词无效');
      const facets = [['project_type:mod'], ['categories:fabric'], ['versions:' + game], ['client_side:required', 'client_side:optional']];
      const params = new URLSearchParams({ query, facets: JSON.stringify(facets), limit: '12' });
      const result = await json('/search?' + params);
      return result.hits.map(({ project_id, title, description }) => ({ id: project_id, title, description }));
    },
    async plan(project, game) {
      const projects = new Map();
      async function include(version) {
        if (!compatible(version, game)) throw new Error('必需依赖与当前游戏版本或 Fabric 不兼容');
        const id = identifier(version.project_id);
        const existing = projects.get(id);
        if (existing) {
          if (existing.id !== version.id) throw new Error('必需依赖要求同一模组的不同版本');
          return;
        }
        if (projects.size >= 64) throw new Error('模组依赖数量超出限制');
        const details = await json('/project/' + id);
        if (details.project_type !== 'mod' || !['required', 'optional'].includes(details.client_side)) {
          throw new Error('资源不是可用于客户端的模组');
        }
        const file = version.files?.find(file => file.primary) ?? version.files?.[0];
        if (!file?.filename?.endsWith('.jar') || new URL(file.url).origin !== 'https://cdn.modrinth.com' ||
            !/^[a-f0-9]{40}$/.test(file.hashes?.sha1 ?? '') || !Number.isSafeInteger(file.size) || file.size <= 0) {
          throw new Error('此版本缺少可校验的 Modrinth JAR');
        }
        projects.set(id, { project: id, title: details.title, id: identifier(version.id), version: version.version_number,
          sha1: file.hashes.sha1, size: file.size, url: file.url,
          incompatible: (version.dependencies ?? []).filter(dep => dep.dependency_type === 'incompatible'),
        });
        for (const dep of version.dependencies ?? []) {
          if (dep.dependency_type === 'required') {
            const resolved = dep.version_id ? await json('/version/' + identifier(dep.version_id))
              : await newest(dep.project_id, game);
            await include(resolved);
          }
        }
      }
      await include(await newest(project, game));
      const plan = [...projects.values()];
      for (const mod of plan) {
        if (mod.incompatible.some(dep => plan.some(other =>
          dep.version_id ? other.id === dep.version_id : other.project === dep.project_id))) {
          throw new Error(`安装清单中存在与 ${mod.title} 冲突的模组`);
        }
      }
      return plan;
    },
    async install(plan, gameDirectory) {
      const transaction = localPath(gameDirectory, 'mod-download-' + randomUUID());
      const staged = [];
      const committed = [];
      const mods = localPath(gameDirectory, 'mods');
      await mkdir(mods, { recursive: true });
      const siblings = await readdir(mods);
      try {
        for (const file of plan) {
          const id = identifier(file.project);
          const name = `modrinth-${id}-${identifier(file.id)}.jar`;
          const target = localPath(gameDirectory, 'mods/' + name);
          if (file.incompatible.some(dep => siblings.some(name =>
            dep.version_id ? name.endsWith(`-${dep.version_id}.jar`) && name.startsWith('modrinth-')
              : dep.project_id && name.startsWith(`modrinth-${dep.project_id}-`)))) {
            throw new Error(`已安装与 ${file.title} 冲突的 Modrinth 模组`);
          }
          if (siblings.some(entry => entry.startsWith(`modrinth-${id}-`) && entry !== name)) {
            throw new Error(`已安装 ${file.title} 的另一个版本`);
          }
          if (siblings.includes(name)) {
            await verifiedDownload(target, file, request);
            continue;
          }
          const source = localPath(transaction, name);
          await verifiedDownload(source, file, request);
          staged.push({ source, target });
        }
        for (const { source, target } of staged) {
          await rename(source, target);
          committed.push(target);
        }
      } catch (error) {
        await Promise.all(committed.map(path => rm(path, { force: true })));
        throw error;
      } finally {
        await rm(transaction, { recursive: true, force: true });
      }
      return plan.map(({ title, version }) => ({ title, version }));
    },
  };
}
