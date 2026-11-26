import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localPath, writeJSON } from './core.mjs';

export const validClientId = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);

export function accountStore(root, storage) {
  const file = localPath(root, 'verified-account.json');
  const configuration = localPath(root, 'microsoft.json');
  const secure = () => storage.isEncryptionAvailable() && storage.getSelectedStorageBackend?.() !== 'basic_text';
  async function list() {
    if (!secure()) return [];
    const raw = await readFile(file, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    if (!raw) return [];
    try {
      const value = JSON.parse(storage.decryptString(Buffer.from(JSON.parse(raw).protected, 'base64')));
      const entries = Array.isArray(value.accounts) ? value.accounts : [value];
      return entries.filter(entry => /^[a-f0-9]{32}$/i.test(entry?.id) && /^[a-z0-9_]{1,16}$/i.test(entry.name));
    } catch {
      return [];
    }
  }
  async function persist(entries) {
    const protectedValue = storage.encryptString(JSON.stringify({ accounts: entries }));
    await writeJSON(file, { protected: protectedValue.toString('base64') });
  }
  let writes = Promise.resolve();
  function update(change) {
    const task = writes.then(async () => {
      if (!secure()) return false;
      await persist(change(await list()));
      return true;
    });
    writes = task.catch(() => {});
    return task;
  }
  return {
    async clientId() {
      const value = await readFile(configuration, 'utf8').catch(error => {
        if (error.code === 'ENOENT') return '{}';
        throw error;
      });
      const explicit = JSON.parse(value).clientId ?? process.env.MINECRAFT_CLIENT_ID;
      if (validClientId(explicit)) return explicit;
      for (const file of ['./oauth-public.json', './oauth-default.json']) {
        const packaged = await readFile(new URL(file, import.meta.url), 'utf8').catch(error => {
          if (error.code === 'ENOENT') return '{}';
          throw error;
        });
        const candidate = JSON.parse(packaged).clientId;
        if (validClientId(candidate)) return candidate;
      }
      return '';
    },
    async configure(clientId) {
      if (!validClientId(clientId)) throw new Error('请输入有效的 Microsoft 应用程序客户端 ID');
      await writeJSON(configuration, { clientId });
    },
    list,
    async saved() { return (await list())[0]; },
    remember(account) {
      const { id, name, skin, refresh, clientId } = account;
      return update(entries => [{ id, name, skin, refresh, clientId }, ...entries.filter(entry => entry.id !== id)]);
    },
    forget(id) {
      if (id === undefined) return update(() => []);
      return update(entries => entries.filter(entry => entry.id !== id));
    },
  };
}

export function offlineAccount(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-zA-Z0-9_]{3,16}$/.test(name)) throw new Error('离线昵称须为 3–16 个英文字母、数字或下划线');
  const uuid = createHash('md5').update('OfflinePlayer:' + name).digest();
  uuid[6] = (uuid[6] & 0x0f) | 0x30;
  uuid[8] = (uuid[8] & 0x3f) | 0x80;
  return { id: uuid.toString('hex'), name, offline: true, access: '0' };
}
