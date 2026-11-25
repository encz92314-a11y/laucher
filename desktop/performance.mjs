import { cpus, totalmem } from 'node:os';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { localPath, writeJSON } from './core.mjs';

const base = ['sodium', 'lithium', 'ferrite-core', 'entityculling'];
export const presets = {
  fast: { projects: [...base, 'moreculling'], render: 8, simulation: 5, shadows: 6 },
  balanced: { projects: [...base, 'iris'], render: 12, simulation: 8, shadows: 10 },
  quality: { projects: ['sodium', 'lithium', 'ferrite-core', 'iris'], render: 20, simulation: 10, shadows: 16 },
};

export function systemProfile(bytes = totalmem(), cores = cpus().length) {
  const gib = bytes / 2 ** 30;
  return { memory: Math.max(1, Math.min(8, Math.floor(gib * 0.4))), reducedEffects: gib <= 8 || cores <= 4 };
}

export function profileDirectory(game, preset) {
  if (!Object.hasOwn(presets, preset)) throw new Error('未知的性能预设');
  return localPath(game, 'performance/' + preset);
}

export async function currentProfile(game) {
  return (await readFile(localPath(game, 'performance.json'), 'utf8').then(JSON.parse, error => {
    if (error.code === 'ENOENT') return {};
    throw error;
  })).preset;
}

export async function shaders(game) {
  const names = await readdir(localPath(game, 'shaderpacks'), { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  return names.filter(file => file.isFile() && /^[^\x00-\x1f\\/:]+\.zip$/i.test(file.name)).map(file => file.name);
}

export async function selectShader(game, name) {
  if (name !== '' && !(await shaders(game)).includes(name)) throw new Error('光影 ZIP 不存在');
  const preset = await currentProfile(game);
  if (preset !== 'balanced' && preset !== 'quality') throw new Error('请先应用平衡或画质预设');
  await mkdir(localPath(game, 'config'), { recursive: true });
  await updateOptions(localPath(game, 'config/iris.properties'), '=', { enableShaders: Boolean(name), shaderPack: name });

}

export async function preparePreset(resources, preset, version) {
  if (preset === 'off') return { files: [], skipped: [] };
  if (!Object.hasOwn(presets, preset)) throw new Error('未知的性能预设');
  const files = new Map();
  const skipped = [];
  for (const project of presets[preset].projects) {
    try {
      const candidates = await resources.plan(project, version);
      const merged = new Map(files);
      for (const file of candidates) {
        if (merged.has(file.project) && merged.get(file.project).id !== file.id) {
          throw new Error('依赖版本冲突');
        }
        merged.set(file.project, file);
      }
      for (const file of merged.values()) {
        if (file.incompatible.some(dep => [...merged.values()].some(other =>
          dep.version_id ? dep.version_id === other.id : dep.project_id === other.project))) {
          throw new Error('模组声明了不兼容关系');
        }
      }
      for (const file of candidates) files.set(file.project, file);
    } catch (error) {
      if (error.code !== 'NO_COMPATIBLE_VERSION' && !['依赖版本冲突', '模组声明了不兼容关系'].includes(error.message)) throw error;
      skipped.push({ project, reason: error.message });
    }
  }
  if (!files.size) throw new Error('此版本没有可用的性能模组');
  return { files: [...files.values()], skipped };
}

export async function activatePreset(resources, game, preset, files, report) {
  if (preset !== 'off') {
    const directory = profileDirectory(game, preset);
    await resources.install(files, directory, report);
  }
  await writeJSON(localPath(game, 'performance.json'), { preset });
}

async function updateOptions(path, separator, values) {
  const previous = await readFile(path, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const lines = previous.split(/\r?\n/).filter(line => line && !Object.hasOwn(values, line.split(separator, 1)[0]));
  for (const [key, value] of Object.entries(values)) lines.push(key + separator + value);
  await writeFile(path, lines.join('\n') + '\n');
}

export async function gameProfile(game, preset) {
  if (!preset || preset === 'off') return [];
  const directory = profileDirectory(game, preset);
  const mods = localPath(directory, 'mods');
  if (mods.includes(process.platform === 'win32' ? ';' : ':')) throw new Error('实例路径包含 Fabric 的路径分隔符');
  const profileFiles = await readdir(mods);
  const regular = await readdir(localPath(game, 'mods')).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const ids = new Set(profileFiles.map(file => /^modrinth-([a-z\d]+)-/i.exec(file)?.[1]).filter(Boolean));
  if (regular.some(file => ids.has(/^modrinth-([a-z\d]+)-/i.exec(file)?.[1]))) {
    throw new Error('实例模组与预设重复，请先在实例 mods 目录移除重复文件');
  }
  const { render, simulation, shadows } = presets[preset];
  await updateOptions(localPath(game, 'options.txt'), ':', { renderDistance: render, simulationDistance: simulation });
  if (preset !== 'fast') {
    await mkdir(localPath(game, 'config'), { recursive: true });
    await mkdir(localPath(game, 'shaderpacks'), { recursive: true });
    await updateOptions(localPath(game, 'config/iris.properties'), '=', { maxShadowRenderDistance: shadows });
  }
  return [`-Dfabric.addMods=${mods}`];
}
