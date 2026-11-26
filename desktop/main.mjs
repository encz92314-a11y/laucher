import { randomUUID } from 'node:crypto';
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, safeStorage, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { accountStore, offlineAccount } from './session.mjs';
import { signIn, refreshSignIn } from './account.mjs';
import { curseforge, curseSettings } from './curseforge.mjs';
import { catalog } from './catalog.mjs';
import { applyOnlineSkin, defaultSkins, skinPreview } from './skins.mjs';
import { modrinth } from './modrinth.mjs';
import { activatePreset, currentProfile, preparePreset, selectShader, shaders, systemProfile } from './performance.mjs';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { allowedAuthNavigation } from './oauth-window.mjs';
import { appearanceStore, validateAppearance } from './appearance.mjs';
import { relayAddress } from './multiplayer.mjs';
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

function authorizationWindow(callback, abort) {
  const login = new BrowserWindow({
    parent: window, modal: true, width: 860, height: 710, title: '在 Zephyr 登录 Microsoft',
    autoHideMenuBar: true,
    webPreferences: { partition: 'persist:zephyr-microsoft', sandbox: true, devTools: false,
      contextIsolation: true, nodeIntegration: false, webviewTag: false },
  });
  const { webContents } = login;
  webContents.session.setPermissionRequestHandler((_, __, done) => done(false));
  webContents.session.setPermissionCheckHandler(() => false);
  webContents.on('will-navigate', event => { if (!allowedAuthNavigation(event.url, callback)) event.preventDefault(); });
  webContents.on('will-redirect', event => {
    if (event.isMainFrame && !allowedAuthNavigation(event.url, callback)) event.preventDefault();
  });
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  login.on('page-title-updated', event => event.preventDefault());
  login.once('closed', () => abort.abort());
  return login;
}

function openWindow() {
  window = new BrowserWindow({
    show: !process.argv.includes('--smoke-test'),
    width: 1120, height: 740, minWidth: 680, minHeight: 550,
    backgroundColor: '#00000000', transparent: true, autoHideMenuBar: true,
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
  const appearance = appearanceStore(root);
  let materialWindow;
  let material;
  function updateMaterial(values) {
    if (process.platform === 'darwin' && window && !window.isDestroyed()) {
      const next = values.style === 'glass' && values.opacity > 0 ? 'under-window' : null;
      if (materialWindow === window && material === next) return;
      window.setVibrancy(next);
      materialWindow = window;
      material = next;
    }
  }
  const resources = modrinth();
  const store = catalog();
  const curseKey = curseSettings(root, safeStorage);
  const curse = curseforge(() => curseKey.get());
  function repository(source) {
    if (source === 'modrinth') return store;
    if (source === 'curseforge') return curse;
    throw new Error('未知资源来源');
  }
  let skinSelection;
  const accounts = accountStore(root, safeStorage);
  const publicAccount = value => ({ name: value.name, skin: value.skin, offline: !!value.offline });
  let pending;
  let relay = { state: 'idle' };
  const relayDirectory = instance => localPath(directory(instance), 'network/e4mc');
  const setRelay = update => {
    relay = update;
    if (window && !window.isDestroyed()) window.webContents.send('launcher:relay', update);
  };
  async function hasRelay(instance) {
    const mods = localPath(relayDirectory(instance), 'mods');
    return (await readdir(mods).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    })).some(name => name.startsWith('modrinth-qANg5Jrr-') && name.endsWith('.jar'));
  }
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
    async appearance() {
      const state = await appearance.load();
      updateMaterial(state.values);
      return state;
    },
    appearancePreview(_, values) { updateMaterial(validateAppearance(values)); },
    async saveAppearance(_, values) {
      await appearance.save(values);
      updateMaterial(values);
    },
    async pickWallpaper() {
      const result = await dialog.showOpenDialog(window, { properties: ['openFile'],
        filters: [{ name: '背景图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
      if (result.canceled) return null;
      const file = result.filePaths[0];
      if ((await stat(file)).size > 32 * 1024 * 1024) throw new Error('请选择小于 32 MB 的图片');
      const image = nativeImage.createFromPath(file);
      if (image.isEmpty()) throw new Error('无法读取该图片');
      const { width, height } = image.getSize();
      const scaled = Math.max(width, height) <= 2560 ? image
        : image.resize(width >= height ? { width: 2560 } : { height: 2560 });
      return appearance.storeImage(scaled.toJPEG(86));
    },
    async resetAppearanceImage() { await appearance.removeImage(); },
    async openWallpapers() { await shell.openExternal('https://www.minecraft.net/en-us/collectibles'); },
    relayStatus: () => relay,
    async relayInstalled(_, id) { return hasRelay(await fabricInstance(id)); },
    copyRelay() {
      if (relay.state !== 'shared' || !relay.address) throw new Error('当前没有可分享的联机地址');
      clipboard.writeText(relay.address);
    },
    async installRelay(event, id) {
      if (game || starting || installing) throw new Error('请先退出游戏并等待安装任务结束');
      installing = true;
      try {
        const instance = await fabricInstance(id);
        const plan = await resources.plan('qANg5Jrr', instance.version);
        await resources.install(plan, relayDirectory(instance), value => report(event, value));
      } finally { installing = false; }
    },
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
    browseResources: (_, source, type, query, offset) => repository(source).browse(type, query, offset),
    resourceDetails: (_, source, project) => repository(source).details(project),
    async curseConfigured() { return !!await curseKey.get(); },
    configureCurse: (_, key) => curseKey.save(key),
    async openCurseProject(_, project) { await shell.openExternal(await curse.openPage(project)); },
    async openTranslation(_, description) {
      if (typeof description !== 'string' || description.length > 5000) throw new Error('请选择较短的资源简介');
      const url = new URL('https://translate.google.com/');
      url.search = new URLSearchParams({ sl: 'auto', tl: 'zh-CN', text: description, op: 'translate' }).toString();
      await shell.openExternal(url.href);
    },
    async previewMod(_, id, source, project) {
      const platform = repository(source);
      const detail = await platform.details(project);
      const instance = await installedInstance(id);
      if (detail.kind === 'mod' && instance.loader !== 'fabric') throw new Error('请选择已安装的 Fabric 实例');
      const plan = source === 'modrinth' && detail.kind === 'mod'
        ? await resources.plan(project, instance.version) : await platform.plan(project, instance);
      const token = randomUUID();
      pending = { id, token, plan, source };
      const files = Array.isArray(plan) ? plan : [plan];
      return { token, files: files.map(({ title, version }) => ({ title, version })) };
    },
    async installMod(event, id, token) {
      if (game || starting || installing) throw new Error('请先退出游戏并等待安装任务结束');
      if (!pending || pending.preset || pending.id !== id || pending.token !== token) throw new Error('请重新预览安装清单');
      installing = true;
      const { plan, source } = pending;
      pending = undefined;
      try {
        const instance = await installedInstance(id);
        const update = value => report(event, value);
        if (source === 'curseforge') return await curse.install(plan, instance, directory(instance), update);
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
    async signIn(_, clientId, external) {
      if (signingIn || starting || game) throw new Error('请等待当前登录或游戏任务结束');
      signingIn = true;
      let login;
      const abort = new AbortController();
      try {
        const chosen = clientId || await accounts.clientId();
        if (clientId) await accounts.configure(clientId);
        account = await signIn(chosen, async (url, callback) => {
          if (external === true) return shell.openExternal(url);
          login = authorizationWindow(callback, abort);
          await login.loadURL(url);
        }, abort.signal);
        await accounts.remember(account).catch(() => false);
        return publicAccount(account);
      } finally {
        if (login && !login.isDestroyed()) login.close();
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
    async play(event, id, host = false, joinAddress) {
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
        if ((host || joinAddress !== undefined) && (!account || account.offline)) throw new Error('联机请先登录 Microsoft');
        let network;
        if (host === true) {
          if (instance.loader !== 'fabric' || !(await hasRelay(instance))) throw new Error('请先为此 Fabric 实例安装 e4mc');
          const mods = localPath(relayDirectory(instance), 'mods');
          const bundled = await readdir(mods);
          const ordinary = await readdir(localPath(directory(instance), 'mods')).catch(error => {
            if (error.code === 'ENOENT') return [];
            throw error;
          });
          if (bundled.some(name => ordinary.some(file => file.startsWith(name.split('-').slice(0, 2).join('-') + '-')))) {
            throw new Error('实例中已有重复的联机模组，请先移除普通 mods 目录中的重复版本');
          }
          setRelay({ state: 'waiting' });
          network = { mods, onRelay: setRelay };
        } else if (joinAddress !== undefined) {
          const join = relayAddress(joinAddress);
          if (!join) throw new Error('请输入好友发给你的 e4mc.link 地址');
          network = { join };
        }
        try {
          game = await launchGame(directory(instance), account, instance.loader,
            instance.loader === 'fabric' ? await currentProfile(directory(instance)) : undefined, network);
        } catch (error) {
          if (host) setRelay({ state: 'idle' });
          throw error;
        }
        game.once('close', code => {
          game = undefined;
          setRelay({ state: 'idle' });
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
