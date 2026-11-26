import AdmZip from 'adm-zip';

const names = ['steve', 'alex', 'ari', 'efe', 'kai', 'makena', 'noor', 'sunny', 'zuri'];

export function skinPreview(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || buffer.length > 1024 * 1024 ||
      buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      buffer.toString('ascii', 12, 16) !== 'IHDR' ||
      buffer.readUInt32BE(16) !== 64 || ![32, 64].includes(buffer.readUInt32BE(20))) {
    throw new Error('请选择 64 × 64 或 64 × 32 的 PNG 皮肤');
  }
  return 'data:image/png;base64,' + buffer.toString('base64');
}

export function defaultSkins(clientJar) {
  const zip = new AdmZip(clientJar);
  const results = [];
  for (const [name, variant] of [['steve', 'classic'], ['alex', 'slim']]) {
    const entry = zip.getEntry(`assets/minecraft/textures/entity/${name}.png`);
    if (!entry || entry.header.size > 1024 * 1024) continue;
    try { results.push({ name, variant, skin: skinPreview(entry.getData()) }); } catch {}
  }
  for (const name of names) {
    for (const variant of ['wide', 'slim']) {
      const path = `assets/minecraft/textures/entity/player/${variant}/${name}.png`;
      const entry = zip.getEntry(path);
      if (!entry || entry.header.size > 1024 * 1024) continue;
      try { results.push({ name, skin: skinPreview(entry.getData()), variant: variant === 'wide' ? 'classic' : 'slim' }); }
      catch { /* A version may omit particular skins or use a different format. */ }
    }
  }
  return results;
}

export async function applyOnlineSkin(access, buffer, variant) {
  if (!['slim', 'classic'].includes(variant)) throw new Error('皮肤模型无效');
  skinPreview(buffer);
  const body = new FormData();
  body.set('variant', variant);
  body.set('file', new Blob([buffer], { type: 'image/png' }), 'skin.png');
  const response = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', {
    method: 'POST', body, headers: { Authorization: 'Bearer ' + access },
    redirect: 'error', signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`Minecraft 皮肤服务器拒绝修改（HTTP ${response.status}）`);
  const profile = await response.json();
  const skin = profile.skins?.find(entry => entry.state === 'ACTIVE')?.url;
  if (!/^https:\/\/textures\.minecraft\.net\/texture\/[a-f0-9]+$/i.test(skin ?? '')) {
    throw new Error('皮肤服务器未返回新的预览地址');
  }
  return skin;
}
