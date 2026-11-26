import { randomUUID } from 'node:crypto';
import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { accountStore, offlineAccount } from './session.mjs';
import { signIn, refreshSignIn } from './account.mjs';
import { modrinth } from './modrinth.mjs';
import { activatePreset, currentProfile, preparePreset, selectShader, shaders, systemProfile } from './performance.mjs';
import { mkdir } from 'node:fs/promises';
import { launchGame } from './game.mjs';
import { launcher, localPath } from './core.mjs';

const file = relative => fileURLToPath(new URL(relative, import.meta.url));
let window;
let account;
let signingIn = false;
let game;
let starting = false;
let installing = false;

// Keep the data path used before the display name changed.
const previousData = app.getPath('userData');
app.setName('Zephyr');
const legacyData = [previousData, join(app.getPath('appData'), 'minecraft-launcher'),
  join(app.getPath('appData'), 'Java Edition Launcher')]
  .find(path => existsSync(join(path, 'launcher-data')));
app.setPath('userData', legacyData ?? join(app.getPath('appData'), 'minecraft-launcher'));
if (process.argv.includes('--smoke-test')) {
  const smokeDirectory = process.env.LAUNCHER_SMOKE_DIRECTORY;
  if (!smokeDirectory) app.exit(1);
  else app.setPath('userData', smokeDirectory);
}
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
});

function openWindow() {
  window = new BrowserWindow({
    show: !process.argv.includes('--smoke-test'),
    width: 1120, height: 740, minWidth: 680, minHeight: 550,
    backgroundColor: process.platform === 'darwin' ? '#00000000' : '#181622', autoHideMenuBar: true,
    ...(process.platform === 'darwin' ? { vibrancy: 'under-window', titleBarStyle: 'hiddenInset' } : {}),
    webPreferences: { preload: file('./preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.loadFile(file('../dist/index.html')).then(async () => {
    if (!process.argv.includes('--smoke-test')) return;
    const ready = await window.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 40 && !document.querySelector('h1'); i++) await new Promise(resolve => setTimeout(resolve, 100));
      return Boolean(document.querySelector('h1') && await window.launcher.system() && typeof require === 'undefined');
    })()`);
    app.exit(ready ? 0 : 1);
  }).catch(error => {
    console.error(error);
    if (process.argv.includes('--smoke-test')) app.exit(1);
  });
  window.on('closed', () => { window = undefined; });
}

app.whenReady().then(() => {
  const root = join(app.getPath('userData'), 'launcher-data');
  const service = launcher(root);
  const resources = modrinth();
  const accounts = accountStore(root, safeStorage);
  const publicAccount = value => ({ name: value.name, skin: value.skin, offline: !!value.offline });
  let pending;
  async function fabricInstance(id) {
    const instance = (await service.list()).find(row => row.id === id);
    if (instance?.loader !== 'fabric' || !instance.installed) throw new Error('请先安装 Fabric 实例');
    return instance;
  }
  const directory = instance => localPath(root, `games/${instance.id}`);
  const report = (event, progress) => {
    if (!event.sender.isDestroyed()) event.sender.send('launcher:progress', progress);
  };
  const handlers = {
    system: () => systemProfile(),
    async profile(_, id) {
      return (await currentProfile(directory(await fabricInstance(id)))) ?? 'off';
    },
    async shaders(_, id) {
      return shaders(directory(await fabricInstance(id)));
    },
    async selectShader(_, id, name) {
      if (game || starting || installing) throw new Error('请先退出游戏并等待安装任务结束');
      installing = true;
      try { await selectShader(directory(await fabricInstance(id)), name); }
      finally { installing = false; }
    },
    async shaderFolder(_, id) {
      const path = localPath(directory(await fabricInstance(id)), 'shaderpacks');
      await mkdir(path, { recursive: true });
      const error = await shell.openPath(path);
      if (error) throw new Error('无法打开光影包文件夹');
    },
    async previewProfile(_, id, preset) {
      const { files, skipped } = await preparePreset(resources, preset, (await fabricInstance(id)).version);
      const token = randomUUID();
      pending = { id, token, plan: files, preset };
      return { token, files: files.map(({ title, version }) => ({ title, version })), skipped };
    },
    async applyProfile(event, id, token) {
      if (game || starting || installing) throw new Error('请先退出游戏并等待安装任务结束');
      if (!pending?.preset || pending.id !== id || pending.token !== token) throw new Error('请重新预览预设');
      const { plan, preset } = pending;
      pending = undefined;
      installing = true;
      try {
        await activatePreset(resources, directory(await fabricInstance(id)), preset, plan, value => report(event, value));
        return preset;
      } finally {
        installing = false;
      }
    },
    list: () => service.list(),
    versions: () => service.versions(),
    create: (_, name, version, loader) => service.create(name, version, loader),
    async searchMods(_, id, query) {
      return resources.search(query, (await fabricInstance(id)).version);
    },
    async previewMod(_, id, project) {
      const plan = await resources.plan(project, (await fabricInstance(id)).version);
      const token = randomUUID();
      pending = { id, token, plan };
      return { token, files: plan.map(({ title, version }) => ({ title, version })) };
    },
    async installMod(event, id, token) {
      if (game || starting || installing) throw new Error('请先退出游戏并等待安装任务结束');
      if (!pending || pending.preset || pending.id !== id || pending.token !== token) throw new Error('请重新预览安装清单');
      installing = true;
      const { plan } = pending;
      pending = undefined;
      try {
        const instance = await fabricInstance(id);
        return await resources.install(plan, directory(instance), value => report(event, value));
      } finally {
        installing = false;
      }
    },
    async accountSettings() {
      return { clientId: await accounts.clientId(), offlineAvailable: !!await accounts.saved() };
    },
    async signIn(_, clientId) {
      if (signingIn || starting || game) throw new Error('请等待当前登录或游戏任务结束');
      signingIn = true;
      try {
        const chosen = clientId || await accounts.clientId();
        if (clientId) await accounts.configure(clientId);
        account = await signIn(chosen, url => shell.openExternal(url));
        const offlineAvailable = await accounts.remember(account).catch(() => false);
        return { ...publicAccount(account), offlineAvailable };
      } finally {
        signingIn = false;
      }
    },
    async signInOffline() {
      if (signingIn || starting || game) throw new Error('请等待当前登录或游戏任务结束');
      const saved = await accounts.saved();
      if (!saved) throw new Error('请先联网登录并完成正版验证，启用本机离线模式');
      account = offlineAccount(saved);
      return publicAccount(account);
    },
    async signOut() {
      if (signingIn || starting || game) throw new Error('请等待当前登录或游戏任务结束');
      await accounts.forget();
      account = undefined;
    },
    async play(event, id) {
      if (installing || signingIn) throw new Error('请等待安装或登录完成');
      if (game || starting) throw new Error('游戏已经启动或正在启动');
      starting = true;
      try {
        const instance = (await service.list()).find(row => row.id === id && row.installed);
        if (!instance) throw new Error('请先安装此游戏实例');
        if (account && !account.offline && account.expires < Date.now() + 30_000) {
          account = await refreshSignIn(account);
          await accounts.remember(account).catch(() => false);
        }
        game = await launchGame(directory(instance), account, instance.loader,
          instance.loader === 'fabric' ? await currentProfile(directory(instance)) : undefined);
        game.once('close', code => {
          game = undefined;
          if (!event.sender.isDestroyed()) event.sender.send('launcher:game-exit', code);
        });
      } finally {
        starting = false;
      }
    },
    async install(event, id) {
      if (game || starting) throw new Error('请先退出游戏');
      if (installing) throw new Error('已有安装任务正在运行');
      installing = true;
      try {
        return await service.install(id, progress => {
          if (!event.sender.isDestroyed()) event.sender.send('launcher:progress', progress);
        });
      } finally {
        installing = false;
      }
    },
  };
  for (const [name, handler] of Object.entries(handlers)) ipcMain.handle(`launcher:${name}`, handler);
  openWindow();
  app.on('activate', () => { if (!window) openWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
