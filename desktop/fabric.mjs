const meta = 'https://meta.fabricmc.net/v2/versions/loader';
const maven = 'https://maven.fabricmc.net/';

function mavenKey(name) {
  const [group, artifact, , classifier] = (name ?? '').split(':');
  return JSON.stringify([group, artifact, classifier]);
}

export async function fabricProfile(version, request) {
  if (!version.arguments?.jvm || !version.arguments?.game) {
    throw new Error('此 Minecraft 版本不支持当前的 Fabric 安装流程');
  }
  const endpoint = meta + '/' + encodeURIComponent(version.id);
  const candidates = await (await request(endpoint)).json();
  const loader = candidates.find(entry => entry.loader?.stable)?.loader.version;
  if (!loader) throw new Error('Fabric 没有为此游戏版本提供稳定加载器');
  const profile = await (await request(endpoint + '/' + encodeURIComponent(loader) + '/profile/json')).json();
  if (profile.inheritsFrom !== version.id || !profile.mainClass || !Array.isArray(profile.libraries)) {
    throw new Error('Fabric 配置与 Minecraft 版本不匹配');
  }
  const libraries = await Promise.all(profile.libraries.map(async lib => {
    const parts = typeof lib.name === 'string' ? lib.name.replace(/@jar$/, '').split(':') : [];
    const [group, artifact, release, classifier] = parts;
    const groupPattern = /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/;
    const segment = /^[a-zA-Z0-9_-][a-zA-Z0-9_.+~-]*$/;
    if ((parts.length !== 3 && parts.length !== 4) || !groupPattern.test(group ?? '') ||
        [artifact, release, ...(parts.length === 4 ? [classifier] : [])].some(value =>
          !segment.test(value ?? '') || value.endsWith('.'))) {
      throw new Error('Fabric 发布了无法识别的库坐标，请更新 Zephyr 或选择其他版本');
    }
    const suffix = classifier ? '-' + classifier : '';
    const path = `${group.replaceAll('.', '/')}/${artifact}/${release}/${artifact}-${release}${suffix}.jar`;
    const repository = new URL(lib.url ?? maven).href;
    if (repository !== maven && repository !== 'https://libraries.minecraft.net/') {
      throw new Error('Fabric 库来源未获信任');
    }
    const url = repository + path.split('/').map(encodeURIComponent).join('/');
    const sha1 = (await (await request(url + '.sha1')).text()).trim();
    if (!/^[a-f0-9]{40}$/.test(sha1)) throw new Error('Fabric 库校验值无效');
    return { name: lib.name, downloads: { artifact: { path, url, sha1 } } };
  }));
  const inherited = version.libraries.filter(lib => !libraries.some(replacement =>
    mavenKey(replacement.name) === mavenKey(lib.name)));
  return {
    ...version, fabricLoader: loader, mainClass: profile.mainClass, libraries: [...libraries, ...inherited],
    arguments: {
      jvm: [...version.arguments.jvm, ...(profile.arguments?.jvm ?? [])],
      game: [...version.arguments.game, ...(profile.arguments?.game ?? [])],
    },
  };
}
