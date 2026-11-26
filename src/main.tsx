import { lazy, Suspense, useEffect, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { Resource, ResourceDetails, ResourceSource, ResourceType } from './resources';
import { Skins } from './skins';
import type { DefaultSkin, Skin } from './skins';
import { AppearanceSettings, defaultAppearance } from './appearance';
import type { Appearance } from './appearance';
import type { RelayState } from './multiplayer';
const Multiplayer = lazy(() => import('./multiplayer').then(module => ({ default: module.Multiplayer })));
import type { Preset } from './profiles';
const Resources = lazy(() => import('./resources').then(module => ({ default: module.Resources })));
const Profiles = lazy(() => import('./profiles').then(module => ({ default: module.Profiles })));
type Page = 'home' | 'instances' | 'performance' | 'mods' | 'account' | 'multiplayer' | 'appearance';
const navigation = [
  ['home', '首页', 'M3 10l9-7 9 7v10H4V10m5 10v-7h6v7'],
  ['instances', '实例', 'M12 3l9 5v8l-9 5-9-5V8l9-5zm-9 5l9 5 9-5m-9 5v8'],
  ['performance', '性能', 'M4 19a9 9 0 1116 0H4zm8-3l4-5'],
  ['mods', '资源中心', 'M5 4h14v16H5zM8 8h8M8 12h8m-8 4h4'],
  ['multiplayer', '好友联机', 'M7 9a4 4 0 118 0 4 4 0 01-8 0zm-4 12a8 8 0 0116 0m0-13 3 3-3 3'],
  ['appearance', '外观', 'M12 3a9 9 0 100 18h1a2 2 0 000-4 2 2 0 010-4h5a3 3 0 003-3c0-4-4-7-9-7zM7 10h.01m3-3h.01m4 0h.01m3 2h.01'],
] as const;
import './style.css';
import { readableError } from './errors';

type Loader = 'vanilla' | 'fabric';
type InstallFile = { title: string; version: string };
type Instance = { loader?: Loader; id: string; name: string; version: string; installed: boolean };
type Player = { name: string; skin?: string; offline: boolean };
type Version = { id: string; type: string };
type Progress = { completed: number; total: number; bytesPerSecond: number };
declare global {
  interface Window {
    launcher: {
      appearance(): Promise<{ values: Appearance; image?: string }>;
      appearancePreview(values: Appearance): Promise<void>;
      saveAppearance(values: Appearance): Promise<void>;
      pickWallpaper(): Promise<string | null>;
      resetAppearanceImage(): Promise<void>;
      openWallpapers(): Promise<void>;
      system(): Promise<{ memory: number; reducedEffects: boolean }>;
      profile(id: string): Promise<Preset>;
      previewProfile(id: string, preset: Preset): Promise<{ token: string; files: InstallFile[]; skipped: { project: string; reason: string }[] }>;
      applyProfile(id: string, token: string): Promise<Preset>;
      shaders(id: string): Promise<string[]>;
      selectShader(id: string, name: string): Promise<void>;
      shaderFolder(id: string): Promise<void>;
      list(): Promise<Instance[]>;
      versions(): Promise<Version[]>;
      create(name: string, version: string, loader: Loader): Promise<Instance[]>;
      curseConfigured(): Promise<boolean>;
      configureCurse(key: string): Promise<void>;
      openCurseProject(id: string): Promise<void>;
      browseResources(source: ResourceSource, kind: ResourceType, query: string, offset: number): Promise<{ total: number; items: Resource[] }>;
      resourceDetails(source: ResourceSource, project: string): Promise<ResourceDetails>;
      openTranslation(description: string): Promise<void>;
      chooseSkin(id?: string, index?: number): Promise<Skin | null>;
      listDefaultSkins(id: string): Promise<DefaultSkin[]>;
      uploadSkin(variant: Skin['variant']): Promise<Player>;
      previewMod(id: string, source: ResourceSource, project: string): Promise<{ token: string; files: InstallFile[] }>;
      installMod(id: string, token: string): Promise<InstallFile[]>;
      install(id: string): Promise<Instance[]>;
      accountSettings(): Promise<{ clientId: string }>;
      signIn(clientId: string, external?: boolean): Promise<Player>;
      relayStatus(): Promise<RelayState>;
      relayInstalled(id: string): Promise<boolean>;
      installRelay(id: string): Promise<void>;
      copyRelay(): Promise<void>;
      onRelay(callback: (state: RelayState) => void): () => void;
      signInOffline(nickname: string): Promise<Player>;
      signOut(): Promise<void>;
      play(id: string, host?: boolean, address?: string): Promise<void>;
      onGameExit(callback: (code: number | null) => void): () => void;
      onProgress(callback: (progress: Progress) => void): () => void;
    };
  }
}

function App() {
  const [appearance, setAppearance] = useState(defaultAppearance);
  const [wallpaper, setWallpaper] = useState<string>();
  const [page, setPage] = useState<Page>('home');
  const [theme, setTheme] = useState(localStorage.getItem('theme') ?? 'system');
  const [hardware, setHardware] = useState<{ memory: number; reducedEffects: boolean }>();
  const [resourceBusy, setResourceBusy] = useState(false);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [loader, setLoader] = useState<Loader>('vanilla');
  const [version, setVersion] = useState('');
  const [allVersions, setAllVersions] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [clientId, setClientId] = useState('');
  const [nickname, setNickname] = useState(localStorage.getItem('nickname') ?? '');
  const [configureMicrosoft, setConfigureMicrosoft] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [player, setPlayer] = useState<Player>();
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState<Progress>();
  const current = instances.find(instance => instance.id === selected) ?? instances[0];

  async function loadVersions() {
    setLoadingVersions(true);
    setError('');
    try {
      const entries = await window.launcher.versions();
      setVersions(entries);
      setVersion(entries.find(entry => entry.type === 'release')?.id ?? '');
    } catch (error) {
      setError(readableError(error));
    } finally {
      setLoadingVersions(false);
    }
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    window.launcher.appearance().then(state => { setAppearance(state.values); setWallpaper(state.image); })
      .catch(reason => setError(readableError(reason)));
  }, []);

  function changeAppearance(value: Appearance) {
    setAppearance(value);
    void window.launcher.appearancePreview(value).catch(reason => setError(readableError(reason)));
  }

  useEffect(() => {
    window.launcher.accountSettings().then(settings => {
      setClientId(settings.clientId);
    }).catch(error => setError(readableError(error)));
    window.launcher.system().then(setHardware).catch(() => {});
    window.launcher.list().then(setInstances).catch(error => setError(readableError(error)));
    void loadVersions();
    const stopProgress = window.launcher.onProgress(setProgress);
    const stopExit = window.launcher.onGameExit(code => {
      setPlaying(false);
      if (code !== 0) setError(`游戏已退出（${code ?? '进程终止'}）`);
    });
    return () => { stopProgress(); stopExit(); };
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('正在创建实例');
    setError('');
    try {
      const updated = await window.launcher.create(name, version, loader);
      setInstances(updated);
      setSelected(updated.at(-1)?.id ?? '');
      setName('');
      setPage('home');
    } catch (error) {
      setError(readableError(error));
    } finally {
      setBusy('');
    }
  }

  async function install() {
    if (!current) return;
    setBusy('正在安装游戏文件');
    setError('');
    setProgress(undefined);
    try {
      setInstances(await window.launcher.install(current.id));
    } catch (error) {
      setError(readableError(error));
    } finally {
      setBusy('');
    }
  }

  async function changeAccount(mode: 'online' | 'offline' | 'forget', external = false) {
    setBusy(mode === 'online' ? '请在 Microsoft 窗口中完成登录' : '正在切换账号');
    setError('');
    try {
      if (mode === 'forget') {
        await window.launcher.signOut();
        setPlayer(undefined);
      } else if (mode === 'offline') {
        setPlayer(await window.launcher.signInOffline(nickname));
        localStorage.setItem('nickname', nickname.trim());
        setPage('home');
      } else {
        const account = await window.launcher.signIn(clientId.trim(), external);
        setPlayer(account);
        setPage('home');
      }
    } catch (error) {
      setError(readableError(error));
    } finally {
      setBusy('');
    }
  }

  async function play(host = false, address?: string) {
    if (!current) return;
    setBusy('正在启动游戏');
    setPlaying(true);
    setError('');
    try {
      await window.launcher.play(current.id, host, address);
    } catch (error) {
      setPlaying(false);
      setError(readableError(error));
    } finally {
      setBusy('');
    }
  }

  const locked = !!busy || playing || resourceBusy;
  const supported = current?.loader === 'fabric' && current.installed;
  const transfer = resourceBusy || busy === '正在安装游戏文件';
  return <div className="layout" data-reduced={hardware?.reducedEffects ?? false}
    data-style={appearance.style} data-accent={appearance.accent} data-transparent={appearance.opacity === 0}
    style={{ '--surface-opacity': appearance.opacity + '%', '--custom-accent': appearance.customColor } as CSSProperties}>
    {wallpaper && appearance.wallpaper && <img className="wallpaper" alt="" src={wallpaper} style={{ opacity: appearance.imageOpacity / 100 }} />}
    <aside>
      <header><img src="./launcher-mark.png" alt="" /><strong>Zephyr<br /><small>Minecraft 启动器</small></strong></header>
      <nav aria-label="主导航">{navigation.map(([value, label, path]) =>
        <button type="button" key={value} aria-current={page === value ? 'page' : undefined}
          onClick={() => { setProgress(undefined); setPage(value); }} disabled={resourceBusy}>
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d={path} /></svg>{label}
        </button>)}</nav>
      <h2>游戏实例</h2>
      {instances.length === 0 && <p>还没有实例</p>}
      {instances.map(instance => <button key={instance.id} className="instance"
        aria-pressed={current?.id === instance.id} onClick={() => setSelected(instance.id)} disabled={locked}>
        <strong>{instance.name}</strong><small>{instance.version} · {instance.loader === 'fabric' ? 'Fabric' : '原版'}</small>
      </button>)}
    </aside>
    <main>
      <div className="account">
        <label className="theme">主题<select value={theme} onChange={event => setTheme(event.target.value)}>
          <option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option>
        </select></label>
        {player && <span className="player">{player.skin && <span className="avatar"><img src={player.skin} alt="" /></span>}{player.name}{player.offline && <small>离线</small>}</span>}
        <button type="button" disabled={locked} onClick={() => setPage('account')}>
          {player ? '账号设置' : '登录'}
        </button>
      </div>
      <div key={page} className="page">
      {page === 'home' && <section className="hero">
        <img className="hero-mark" src="./launcher-mark.png" alt="" />
        <p className="eyebrow">MINECRAFT JAVA EDITION</p>
        <h1>{current?.name ?? '游戏实例'}</h1>
        <p>{current ? `${current.version} · ${current.installed ? '游戏文件已下载' : '待安装'}` :
          '从 Mojang 官方版本目录创建一个独立游戏实例。'}</p>
        {current?.installed && player && <button className="primary" type="button"
          disabled={locked} onClick={() => void play()}>{playing ? '游戏运行中' : '启动游戏'}</button>}
        {current && <button className={current.installed && player ? 'secondary' : 'primary'} type="button" onClick={install} disabled={locked}>
          {current.installed ? '校验游戏文件' : '下载游戏文件'}
        </button>}
        {!current && <button className="primary" onClick={() => setPage('instances')}>创建游戏实例</button>}
        {hardware && <p className="memory">推荐 JVM 内存 · {hardware.memory} GB</p>}
      </section>}
      {page === 'account' && <>
        <section className="panel">
          <h2>登录 Zephyr</h2>
          <p>用 Microsoft 账号登录时，密码只在微软官方网站输入。</p>
          <button className="primary" disabled={locked} onClick={() => {
            if (clientId.trim()) void changeAccount('online');
            else { setConfigureMicrosoft(true); setError('首次使用需要设置 Minecraft Services 已授权的应用客户端 ID。'); }
          }}>打开 Microsoft 登录窗口</button>
          {clientId.trim() && <button className="secondary" disabled={locked}
            onClick={() => void changeAccount('online', true)}>使用系统浏览器</button>}
          <details open={configureMicrosoft || undefined}>
            <summary>Microsoft 应用配置</summary>
            <form className="sign-in-form" onSubmit={event => { event.preventDefault(); void changeAccount('online'); }}>
              <label>应用客户端 ID<input value={clientId} required maxLength={36}
                onChange={event => setClientId(event.target.value)} /></label>
              <button disabled={locked || !clientId.trim()}>保存并登录</button>
            </form>
          </details>
          <div className="installation-plan">
            <h3>离线游玩</h3>
            <p>输入昵称即可启动已安装的单人游戏。</p>
            <form className="sign-in-form" onSubmit={event => { event.preventDefault(); void changeAccount('offline'); }}>
              <label>游戏昵称<input pattern="[A-Za-z0-9_]{3,16}" maxLength={16} autoComplete="nickname"
                value={nickname} placeholder="3–16 个字母、数字或下划线" required onChange={event => setNickname(event.target.value)} /></label>
              <button disabled={locked || !nickname.trim()}>离线进入</button>
            </form>
          </div>
          {player && <div className="quick-actions"><button disabled={locked} onClick={() => void changeAccount('forget')}>退出账号</button></div>}
        </section>
        <Skins key={current?.id} instance={current?.installed ? current.id : undefined} current={player?.skin}
          online={!!player && !player.offline} disabled={locked}
          update={skin => setPlayer(value => value ? { ...value, skin } : value)} />
      </>}
      {page === 'appearance' && <AppearanceSettings values={appearance} image={wallpaper}
        update={changeAppearance} setImage={setWallpaper} />}
      {page === 'instances' && <section className="panel">
        <h2>创建实例</h2>
        <form onSubmit={create}>
          <label>实例名称<input value={name} onChange={event => setName(event.target.value)}
            maxLength={80} required /></label>
          <label>游戏版本<select value={version} onChange={event => setVersion(event.target.value)}
            disabled={!versions.length || !!busy} required>
            {!versions.length && <option value="">版本目录不可用</option>}
            {versions.filter(entry => allVersions || entry.type === 'release').map(entry =>
              <option key={entry.id} value={entry.id}>{entry.id}</option>)}
          </select></label>
          <label>加载器<select value={loader} onChange={event => setLoader(event.target.value as Loader)} disabled={!!busy}>
            <option value="vanilla">原版</option>
            <option value="fabric">Fabric</option>
          </select></label>
          <label className="check"><input type="checkbox" checked={allVersions} onChange={event => {
            setAllVersions(event.target.checked);
            if (!event.target.checked) setVersion(versions.find(entry => entry.type === 'release')?.id ?? '');
          }} />显示快照与历史版本</label>
          <button type="submit" disabled={!versions.length || !!busy || !name.trim()}>创建实例</button>
        </form>
        {loadingVersions && <p role="status">正在读取官方版本目录…</p>}
        {!versions.length && !busy && !loadingVersions && <button type="button" onClick={loadVersions}>重新读取官方目录</button>}
      </section>}
      <Suspense fallback={<p role="status">正在加载页面…</p>}>
        {page === 'performance' && (supported ?
          <Profiles key={current.id} id={current.id} disabled={!!busy || playing} notify={active => {
            setProgress(undefined); setResourceBusy(active);
          }} /> :
          <section className="panel"><h2>性能预设</h2><p>先创建并安装一个 Fabric 实例。</p>
            <button onClick={() => setPage('instances')}>前往实例</button></section>)}
        {page === 'mods' &&
          <Resources key={current?.id} instance={current?.installed ? current.id : undefined}
            instanceName={current?.name} disabled={!!busy || playing}
            notify={active => { setProgress(undefined); setResourceBusy(active); }} />}
        {page === 'multiplayer' &&
          <Multiplayer key={current?.id} id={current?.installed ? current.id : undefined} fabric={!!supported}
            online={!!player && !player.offline} disabled={locked}
            signIn={() => setPage('account')} play={play}
            notify={active => { setProgress(undefined); setResourceBusy(active); }} />}
      </Suspense>
      </div>
      {(busy || (progress && transfer) || error) && <div className="status-area">
        {busy && <p role="status">{busy}</p>}
        {progress && transfer && <div role="status">
          <p>{progress.completed} / {progress.total} 个文件 · {(progress.bytesPerSecond / (1024 * 1024)).toFixed(2)} MB/s</p>
          <progress aria-label="下载进度" value={progress.completed} max={progress.total} />
        </div>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>}
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
