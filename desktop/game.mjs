import { spawn, execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { delimiter } from 'node:path';
import { promisify } from 'node:util';
import { allowed, localPath } from './core.mjs';

const execute = promisify(execFile);

export function launchArguments(version, game, account) {
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
    assets_index_name: version.assetIndex.id, user_type: 'msa', version_type: version.type,
    auth_xuid: '', clientid: '', launcher_name: 'Java Edition Launcher', launcher_version: '0.1.1',
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
    '-Xmx2G',
    ...expand(version.arguments.jvm),
    ...(logging ? [logging.argument.replace('${path}', localPath(game, `log_configs/${logging.file.id}`))] : []),
    version.mainClass,
    ...expand(version.arguments.game),
  ];
}

export async function launchGame(game, account, loader) {
  if (!account || account.expires <= Date.now()) throw new Error('请先登录拥有 Minecraft Java 版的 Microsoft 账号');
  const version = JSON.parse(await readFile(localPath(game, loader === 'fabric' ? 'fabric.json' : 'version.json'), 'utf8'));
  const java = process.env.MINECRAFT_JAVA ?? 'java';
  const result = await execute(java, ['-version'], { timeout: 8000, windowsHide: true })
    .catch(() => { throw new Error('找不到 Java，请配置 MINECRAFT_JAVA 或将 Java 加入 PATH'); });
  const match = /version "(?:1\.)?(\d+)/.exec(result.stderr + result.stdout);
  const required = version.javaVersion?.majorVersion ?? 8;
  if (!match || Number(match[1]) !== required) throw new Error(`此实例需要 Java ${required}`);
  const args = launchArguments(version, game, account);
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
