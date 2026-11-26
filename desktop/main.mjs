import { randomUUID } from 'node:crypto';
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { accountStore, offlineAccount } from './session.mjs';
import { signIn, refreshSignIn } from './account.mjs';
import { catalog } from './catalog.mjs';
import { applyOnlineSkin, defaultSkins, skinPreview } from './skins.mjs';
import { modrinth } from './modrinth.mjs';
import { activatePreset, currentProfile, preparePreset, selectShader, shaders, systemProfile } from './performance.mjs';
import { mkdir, readFile, stat } from 'node:fs/promises';
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
  const store = catalog();
  let skinSelection;
  const accounts = accountStore(root, safeStorage);
  const publicAccount = value => ({ name: value.name, skin: value.skin, offline: !!value.offline });
  let pending;
  async function installedInstance(id) {
    const instance = (await service.list()).find(row => row.id === id && row.installed);
    if (!instance) throw new Error('请先安装一个游戏实例');
    return instance;
  }
  async function fabricInstance(id) {
    const instance = await installedInstance(id);
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
    browseResources: (_, type, query, offset) => store.browse(type, query, offset),
    resourceDetails: (_, project) => store.details(project),
    async openTranslation(_, description) {
      if (typeof description !== 'string' || description.length > 5000) throw new Error('请选择较短的资源简介');
      const url = new URL('https://translate.google.com/');
      url.search = new URLSearchParams({ sl: 'auto', tl: 'zh-CN', text: description, op: 'translate' }).toString();
      await shell.openExternal(url.href);
    },
    async previewMod(_, id, project) {
      const detail = await store.details(project);
      const instance = await installedInstance(id);
      if (detail.kind === 'mod' && instance.loader !== 'fabric') throw new Error('请选择已安装的 Fabric 实例');
      const plan = detail.kind === 'mod' ? await resources.plan(project, instance.version) : await store.plan(project, instance);
      const token = randomUUID();
      pending = { id, token, plan };
      const files = Array.isArray(plan) ? plan : [plan];
      return { token, files: files.map(({ title, version }) => ({ title, version })) };
    },
    async installMod(event, id, token) {
      if (game || starting || installing) throw new Error('请先退出游戏并等待安装任务结束');
      if (!pending || pending.preset || pending.id !== id || pending.token !== token) throw new Error('请重新预览安装清单');
      installing = true;
      const { plan } = pending;
      pending = undefined;
      try {
        const instance = await installedInstance(id);
        const update = value => report(event, value);
        return Array.isArray(plan) ? await resources.install(plan, directory(instance), update)
          : await store.install(plan, directory(instance), instance, update);
      } finally {
        installing = false;
      }
    },
    async chooseSkin(_, instanceId, builtInIndex) {
      skinSelection = undefined;
      if (Number.isInteger(builtInIndex)) {
        const instance = await installedInstance(instanceId);
        const entry = defaultSkins(localPath(directory(instance), 'client.jar'))[builtInIndex];
        if (!entry) throw new Error('此版本没有该官方皮肤');
        skinSelection = Buffer.from(entry.skin.split(',')[1], 'base64');
        return { skin: entry.skin, variant: entry.variant };
      }
      const result = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'PNG 皮肤', extensions: ['png'] }] });
      if (result.canceled) return null;
      const path = result.filePaths[0];
      if ((await stat(path)).size > 1024 * 1024) throw new Error('皮肤 PNG 必须小于 1 MB');
      const data = await readFile(path);
      const skin = skinPreview(data);
      skinSelection = data;
      return { skin, variant: 'classic' };
    },
    async listDefaultSkins(_, id) {
      return defaultSkins(localPath(directory(await installedInstance(id)), 'client.jar'));
    },
    async uploadSkin(_, variant) {
      if (!account || account.offline || !skinSelection) throw new Error('请先登录 Microsoft 并选择皮肤');
      if (signingIn || starting || game) throw new Error('请等待登录或游戏任务结束');
      const selected = skinSelection;
      signingIn = true;
      try {
        if (account.expires < Date.now() + 30_000) account = await refreshSignIn(account);
        account.skin = await applyOnlineSkin(account.access, selected, variant);
        await accounts.remember(account).catch(() => false);
        return publicAccount(account);
      } finally { signingIn = false; }
    },
    async accountSettings() {
      return { clientId: await accounts.clientId() };
    },
    async signIn(_, clientId) {
      if (signingIn || starting || game) throw new Error('请等待当前登录或游戏任务结束');
      signingIn = true;
      try {
        const chosen = clientId || await accounts.clientId();
        if (clientId) await accounts.configure(clientId);
        account = await signIn(chosen, url => shell.openExternal(url));
        await accounts.remember(account).catch(() => false);
        return publicAccount(account);
      } finally {
        signingIn = false;
      }
    },
    async signInOffline(_, nickname) {
      if (signingIn || starting || game) throw new Error('请等待当前登录或游戏任务结束');
      account = offlineAccount(nickname);
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
