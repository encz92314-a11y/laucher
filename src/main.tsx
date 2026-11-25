import { lazy, Suspense, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { Preset } from './profiles';
const Resources = lazy(() => import('./resources').then(module => ({ default: module.Resources })));
const Profiles = lazy(() => import('./profiles').then(module => ({ default: module.Profiles })));
type Page = 'home' | 'instances' | 'performance' | 'mods';
const navigation = [
  ['home', '首页', 'M3 10l9-7 9 7v10H4V10m5 10v-7h6v7'],
  ['instances', '实例', 'M12 3l9 5v8l-9 5-9-5V8l9-5zm-9 5l9 5 9-5m-9 5v8'],
  ['performance', '性能', 'M4 19a9 9 0 1116 0H4zm8-3l4-5'],
  ['mods', '模组', 'M5 4h14v16H5zM8 8h8M8 12h8m-8 4h4'],
] as const;
import './style.css';

type Loader = 'vanilla' | 'fabric';
type Resource = { id: string; title: string; description: string };
type InstallFile = { title: string; version: string };
type Instance = { loader?: Loader; id: string; name: string; version: string; installed: boolean };
type Version = { id: string; type: string };
type Progress = { completed: number; total: number; bytesPerSecond: number };
declare global {
  interface Window {
    launcher: {
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
      searchMods(id: string, query: string): Promise<Resource[]>;
      previewMod(id: string, project: string): Promise<{ token: string; files: InstallFile[] }>;
      installMod(id: string, token: string): Promise<InstallFile[]>;
      install(id: string): Promise<Instance[]>;
      signIn(): Promise<{ name: string; skin?: string }>;
      signOut(): Promise<void>;
      play(id: string): Promise<void>;
      onGameExit(callback: (code: number | null) => void): () => void;
      onProgress(callback: (progress: Progress) => void): () => void;
    };
  }
}

function App() {
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
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [player, setPlayer] = useState<{ name: string; skin?: string }>();
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState<Progress>();
  const current = instances.find(instance => instance.id === selected) ?? instances[0];

  async function loadVersions() {
    setBusy('正在读取官方版本目录');
    setError('');
    try {
      const entries = await window.launcher.versions();
      setVersions(entries);
      setVersion(entries.find(entry => entry.type === 'release')?.id ?? '');
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy('');
    }
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    window.launcher.system().then(setHardware).catch(() => {});
    window.launcher.list().then(setInstances).catch(error => setError(String(error)));
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
      setError(String(error));
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
      setError(String(error));
    } finally {
      setBusy('');
    }
  }

  async function changeAccount() {
    setBusy(player ? '正在退出登录' : '请在系统浏览器中完成 Microsoft 登录');
    setError('');
    try {
      if (player) {
        await window.launcher.signOut();
        setPlayer(undefined);
      } else {
        setPlayer(await window.launcher.signIn());
      }
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy('');
    }
  }

  async function play() {
    if (!current) return;
    setBusy('正在启动游戏');
    setPlaying(true);
    setError('');
    try {
      await window.launcher.play(current.id);
    } catch (error) {
      setPlaying(false);
      setError(String(error));
    } finally {
      setBusy('');
    }
  }

  const locked = !!busy || playing || resourceBusy;
  const supported = current?.loader === 'fabric' && current.installed;
  const transfer = resourceBusy || busy === '正在安装游戏文件';
  return <div className="layout" data-reduced={hardware?.reducedEffects ?? false}>
    <aside>
      <header><img src="./launcher-mark.png" alt="" /><strong>Java Edition<br /><small>启动器</small></strong></header>
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
        {player && <span className="player">{player.skin && <span className="avatar"><img src={player.skin} alt="" /></span>}{player.name}</span>}
        <button type="button" disabled={locked} onClick={changeAccount}>
          {player ? '退出账号' : 'Microsoft 登录'}
        </button>
      </div>
      <div key={page} className="page">
      {page === 'home' && <section className="hero">
        <img className="hero-mark" src="./launcher-mark.png" alt="" />
        <p className="eyebrow">JAVA EDITION</p>
        <h1>{current?.name ?? '游戏实例'}</h1>
        <p>{current ? `${current.version} · ${current.installed ? '游戏文件已下载' : '待安装'}` :
          '从 Mojang 官方版本目录创建一个独立游戏实例。'}</p>
        {current?.installed && player && <button className="primary" type="button"
          disabled={locked} onClick={play}>{playing ? '游戏运行中' : '启动游戏'}</button>}
        {current && <button className={current.installed && player ? 'secondary' : 'primary'} type="button" onClick={install} disabled={locked}>
          {current.installed ? '校验游戏文件' : '下载游戏文件'}
        </button>}
        {!current && <button className="primary" onClick={() => setPage('instances')}>创建游戏实例</button>}
        {hardware && <p className="memory">推荐 JVM 内存 · {hardware.memory} GB</p>}
      </section>}
      {page === 'instances' && <section className="panel">
        <h2>创建实例</h2>
        <form onSubmit={create}>
          <label>实例名称<input value={name} onChange={event => setName(event.target.value)}
            maxLength={80} placeholder="例如 生存世界" required /></label>
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
        {!versions.length && !busy && <button type="button" onClick={loadVersions}>重新读取官方目录</button>}
      </section>}
      <Suspense fallback={<p role="status">正在加载页面…</p>}>
        {page === 'performance' && (supported ?
          <Profiles key={current.id} id={current.id} disabled={!!busy || playing} notify={active => {
            setProgress(undefined); setResourceBusy(active);
          }} /> :
          <section className="panel"><h2>性能预设</h2><p>先创建并安装一个 Fabric 实例。</p>
            <button onClick={() => setPage('instances')}>前往实例</button></section>)}
        {page === 'mods' && (supported ?
          <Resources key={current.id} instance={current.id} disabled={!!busy || playing}
            notify={active => { setProgress(undefined); setResourceBusy(active); }} /> :
          <section className="panel"><h2>模组</h2><p>先创建并安装一个 Fabric 实例。</p>
            <button onClick={() => setPage('instances')}>前往实例</button></section>)}
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
