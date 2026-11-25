import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Resources } from './resources';
import './style.css';

type Loader = 'vanilla' | 'fabric';
type Resource = { id: string; title: string; description: string };
type InstallFile = { title: string; version: string };
type Instance = { loader?: Loader; id: string; name: string; version: string; installed: boolean };
type Version = { id: string; type: string };
type Progress = { completed: number; total: number };
declare global {
  interface Window {
    launcher: {
      list(): Promise<Instance[]>;
      versions(): Promise<Version[]>;
      create(name: string, version: string, loader: Loader): Promise<Instance[]>;
      searchMods(id: string, query: string): Promise<Resource[]>;
      previewMod(id: string, project: string): Promise<{ token: string; files: InstallFile[] }>;
      installMod(id: string, token: string): Promise<InstallFile[]>;
      install(id: string): Promise<Instance[]>;
      signIn(): Promise<{ name: string }>;
      signOut(): Promise<void>;
      play(id: string): Promise<void>;
      onGameExit(callback: (code: number | null) => void): () => void;
      onProgress(callback: (progress: Progress) => void): () => void;
    };
  }
}

function App() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [loader, setLoader] = useState<Loader>('vanilla');
  const [version, setVersion] = useState('');
  const [allVersions, setAllVersions] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [player, setPlayer] = useState('');
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
        setPlayer('');
      } else {
        setPlayer((await window.launcher.signIn()).name);
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

  return <div className="layout">
    <aside>
      <header><span className="mark" aria-hidden="true">◈</span><strong>Minecraft<br />Java Edition</strong></header>
      <h2>游戏实例</h2>
      {instances.length === 0 && <p>还没有实例</p>}
      {instances.map(instance => <button key={instance.id} className="instance"
        aria-pressed={current?.id === instance.id} onClick={() => setSelected(instance.id)} disabled={!!busy}>
        <strong>{instance.name}</strong><small>{instance.version} · {instance.loader === 'fabric' ? 'Fabric' : '原版'}</small>
      </button>)}
    </aside>
    <main>
      <div className="account">
        {player && <span>{player}</span>}
        <button type="button" disabled={!!busy || playing} onClick={changeAccount}>
          {player ? '退出账号' : 'Microsoft 登录'}
        </button>
      </div>
      <section className="hero">
        <p className="eyebrow">JAVA EDITION</p>
        <h1>{current?.name ?? '游戏实例'}</h1>
        <p>{current ? `${current.version} · ${current.installed ? '游戏文件已下载' : '待安装'}` :
          '从 Mojang 官方版本目录创建一个独立游戏实例。'}</p>
        {current?.installed && player && <button className="primary" type="button"
          disabled={!!busy || playing} onClick={play}>{playing ? '游戏运行中' : '启动游戏'}</button>}
        {current && <button className={current.installed && player ? 'secondary' : 'primary'} type="button" onClick={install} disabled={!!busy || playing}>
          {current.installed ? '校验游戏文件' : '下载游戏文件'}
        </button>}
      </section>
      <section className="panel">
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
        {busy && <p role="status">{busy}{progress && busy === '正在安装游戏文件' &&
          ` · ${progress.completed} / ${progress.total}`}</p>}
        {progress && busy === '正在安装游戏文件' && <progress aria-label="下载文件进度" value={progress.completed} max={progress.total} />}
        {error && <p className="error" role="alert">{error}</p>}
      </section>
      {current?.loader === 'fabric' && current.installed &&
        <Resources key={current.id} instance={current.id} disabled={!!busy || playing} />}
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
