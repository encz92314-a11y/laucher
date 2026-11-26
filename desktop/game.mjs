import { spawn, execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { allowed, localPath } from './core.mjs';

import { gameProfile, systemProfile } from './performance.mjs';

const execute = promisify(execFile);

export function launchArguments(version, game, account, memory = 2, extra = []) {
  if (!version.arguments?.game || !version.arguments?.jvm ||
      version.libraries.some(lib => lib.natives && allowed(lib.rules))) {
    throw new Error('此版本需要旧版启动参数或原生库解包支持');
  }
  const libraries = localPath(game, 'libraries');
  const assets = localPath(game, 'assets');
  const classpath = version.libraries.filter(lib => allowed(lib.rules) && lib.downloads?.artifact)
    .map(lib => localPath(libraries, lib.downloads.artifact.path));
  classpath.push(localPath(game, 'client.jar'));
  const variables = {
    auth_player_name: account.name, auth_uuid: account.id, auth_access_token: account.access,
    version_name: version.id, game_directory: game, assets_root: assets,
    assets_index_name: version.assetIndex.id, user_type: account.offline ? 'legacy' : 'msa', user_properties: '{}', version_type: version.type,
    auth_xuid: '', clientid: '', launcher_name: 'Zephyr', launcher_version: '0.2.3',
    natives_directory: localPath(game, 'natives'), classpath: classpath.join(delimiter),
    library_directory: libraries, classpath_separator: delimiter,
  };
  const expand = args => args.flatMap(arg => typeof arg === 'string'
    ? [arg] : allowed(arg.rules) ? [arg.value].flat() : []).map(arg =>
    arg.replace(/\$\{([^}]+)\}/g, (_, key) => {
      if (!Object.hasOwn(variables, key)) throw new Error(`不支持的启动参数：${key}`);
      return variables[key];
    }));
  const logging = version.logging?.client;
  return [
    `-Xmx${memory}G`,
    ...extra,
    ...expand(version.arguments.jvm),
    ...(logging ? [logging.argument.replace('${path}', localPath(game, `log_configs/${logging.file.id}`))] : []),
    version.mainClass,
    ...expand(version.arguments.game),
  ];
}

export async function selectJava(major, { platform = process.platform, arch = process.arch, run = execute,
  configured = process.env.MINECRAFT_JAVA } = {}) {
  const candidates = configured ? [configured] : [];
  if (!configured && platform === 'darwin') {
    const home = await run('/usr/libexec/java_home', ['-F', '-a', arch === 'arm64' ? 'arm64' : 'x86_64', '-v', String(major)],
      { timeout: 8000 }).then(result => result.stdout.trim(), () => '');
    if (home) candidates.push(join(home, 'bin', 'java'));
  }
  if (!configured) candidates.push('java');
  for (const java of candidates) {
    const result = await run(java, ['-XshowSettings:properties', '-version'], { timeout: 8000, windowsHide: true })
      .catch(() => null);
    if (!result) continue;
    const output = result.stderr + result.stdout;
    const version = /version "(?:1\.)?(\d+)/.exec(output)?.[1];
    const javaArch = /os\.arch\s*=\s*(\S+)/.exec(output)?.[1];
    if (Number(version) !== major) continue;
    if (platform === 'darwin' && arch === 'arm64' && !['aarch64', 'arm64'].includes(javaArch)) continue;
    return java;
  }
  throw new Error(`找不到兼容的 Java ${major}${platform === 'darwin' && arch === 'arm64' ? '（Apple 芯片 ARM64）' : ''}。请安装对应版本，或配置 MINECRAFT_JAVA。`);
}

export async function launchGame(game, account, loader, preset) {
  if (!account || (!account.offline && account.expires <= Date.now())) throw new Error('请先登录拥有 Minecraft Java 版的 Microsoft 账号');
  const version = JSON.parse(await readFile(localPath(game, loader === 'fabric' ? 'fabric.json' : 'version.json'), 'utf8'));
  const java = await selectJava(version.javaVersion?.majorVersion ?? 8);
  const extra = loader === 'fabric' ? await gameProfile(game, preset) : [];
  const args = launchArguments(version, game, account, systemProfile().memory, extra);
  await mkdir(localPath(game, 'natives'), { recursive: true });
  const child = spawn(java, args, { cwd: game, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const log = createWriteStream(localPath(game, 'launcher-game.log'), { flags: 'w', mode: 0o600 });
  log.on('error', () => {});
  // Minecraft itself manages its log files. Drain JVM output without persisting
  // arguments or potentially sensitive strings from startup diagnostics.
  child.stdout.resume();
  child.stderr.resume();
  child.once('close', (code, signal) => log.end(`Game exited (${code ?? signal ?? 'unknown'})\n`));
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  return child;
}
