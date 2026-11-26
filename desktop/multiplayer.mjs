import { StringDecoder } from 'node:string_decoder';

export function relayAddress(value) {
  if (typeof value !== 'string') return undefined;
  const address = value.trim().toLowerCase();
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){1,3}e4mc\.link$/.test(address)
    ? address : undefined;
}

export function observeRelay(stream, update) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  stream.on('data', bytes => {
    pending += decoder.write(bytes);
    const lines = pending.split(/\r?\n/);
    pending = (lines.pop() ?? '').slice(-4096);
    for (const line of lines) {
      // Only pass validated relay state to the renderer. Game output can include account and machine data.
      const match = /\bDomain assigned: ([a-z\d.-]+)\s*$/i.exec(line);
      if (match) {
        const address = relayAddress(match[1]);
        if (address) update({ state: 'shared', address });
      } else if (/\berror in e4mc\b/i.test(line)) {
        update({ state: 'error' });
      } else if (/\bLocal game no longer publicly hosted\b|\bStopped serving\b/i.test(line)) {
        update({ state: 'waiting' });
      }
    }
  });
}

export function quickConnectArguments(version, address) {
  const validated = relayAddress(address);
  if (!validated) throw new Error('请输入好友发给你的 e4mc.link 地址');
  const supported = version.arguments?.game?.some(arg =>
    typeof arg === 'object' && Array.isArray(arg.value) && arg.value.includes('--quickPlayMultiplayer'));
  if (!supported) throw new Error('这个版本不支持从启动器直连，请在游戏的多人游戏页面使用地址');
  return ['--quickPlayMultiplayer', validated];
}
