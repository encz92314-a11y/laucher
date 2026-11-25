import { randomUUID } from 'node:crypto';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { signIn } from './account.mjs';
import { modrinth } from './modrinth.mjs';
import { launchGame } from './game.mjs';
import { launcher, localPath } from './core.mjs';

const file = relative => fileURLToPath(new URL(relative, import.meta.url));
let window;
let account;
let signingIn = false;
let game;
let starting = false;
let installing = false;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
});

function openWindow() {
  window = new BrowserWindow({
    width: 1120, height: 740, minWidth: 680, minHeight: 550,
    backgroundColor: '#101a17', autoHideMenuBar: true,
    webPreferences: { preload: file('./preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.loadFile(file('../dist/index.html'));
  window.on('closed', () => { window = undefined; });
}

app.whenReady().then(() => {
  const root = join(app.getPath('userData'), 'launcher-data');
  const service = launcher(root);
  const resources = modrinth();
  let pending;
  async function fabricInstance(id) {
    const instance = (await service.list()).find(row => row.id === id);
    if (instance?.loader !== 'fabric' || !instance.installed) throw new Error('请先安装 Fabric 实例');
    return instance;
  }
  const handlers = {
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
    async installMod(_, id, token) {
      if (game || starting || installing) throw new Error('请先退出游戏并等待安装任务结束');
      if (!pending || pending.id !== id || pending.token !== token) throw new Error('请重新预览安装清单');
      installing = true;
      const { plan } = pending;
      pending = undefined;
      try {
        const instance = await fabricInstance(id);
        return await resources.install(plan, localPath(root, `games/${instance.id}`));
      } finally {
        installing = false;
      }
    },
    async signIn() {
      if (signingIn) throw new Error('登录正在进行');
      signingIn = true;
      try {
        account = await signIn(process.env.MINECRAFT_CLIENT_ID, url => shell.openExternal(url));
        return { name: account.name };
      } finally {
        signingIn = false;
      }
    },
    signOut() {
      if (signingIn) throw new Error('登录正在进行');
      account = undefined;
    },
    async play(event, id) {
      if (installing) throw new Error('请等待文件安装完成');
      if (game || starting) throw new Error('游戏已经启动或正在启动');
      starting = true;
      try {
        const instance = (await service.list()).find(row => row.id === id && row.installed);
        if (!instance) throw new Error('请先安装此游戏实例');
        game = await launchGame(localPath(root, `games/${instance.id}`), account, instance.loader);
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
