import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { readableError } from './errors';

export const resourceTypes = { mod: '模组', shader: '光影', resourcepack: '材质包', modpack: '整合包' } as const;
export type ResourceSource = 'modrinth' | 'curseforge';
export type ResourceType = keyof typeof resourceTypes;
export type Resource = { id: string; title: string; description: string; icon?: string; downloads: number };
export type ResourceDetails = Omit<Resource, 'downloads'> & {
  kind: ResourceType; body: string; gallery: { url: string; title: string }[]; versions: string[];
};
type Bridge = Window['launcher'];
type TranslatorWindow = Window & {
  Translator?: {
    availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
    create(options: { sourceLanguage: string; targetLanguage: string }): Promise<{ translate(text: string): Promise<string>; destroy(): void }>;
  };
};

export function Resources({ instance, instanceName, disabled, notify }: {
  instance?: string; instanceName?: string; disabled: boolean; notify: (active: boolean) => void;
}) {
  const [source, setSource] = useState<ResourceSource>('modrinth');
  const [curseConfigured, setCurseConfigured] = useState(false);
  const [curseKey, setCurseKey] = useState('');
  const [type, setType] = useState<ResourceType>('mod');
  const [query, setQuery] = useState('');
  const [list, setList] = useState<{ total: number; items: Resource[] }>();
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState<ResourceDetails>();
  const [plan, setPlan] = useState<Awaited<ReturnType<Bridge['previewMod']>>>();
  const [translation, setTranslation] = useState('');
  const [fallback, setFallback] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const busy = disabled || working;

  async function run(action: () => Promise<void>, install = false) {
    setWorking(true);
    if (install) notify(true);
    setError('');
    setMessage('');
    try { await action(); }
    catch (reason) { setError(readableError(reason)); }
    finally { setWorking(false); if (install) notify(false); }
  }

  function browse(kind: ResourceType, value: string, start = 0, platform = source) {
    setDetail(undefined);
    setPlan(undefined);
    setList(undefined);
    void run(async () => {
      setList(await window.launcher.browseResources(platform, kind, value, start));
      setOffset(start);
    });
  }
  useEffect(() => { browse('mod', ''); }, []);

  function search(event: FormEvent) {
    event.preventDefault();
    browse(type, query);
  }

  async function translate(text: string) {
    const translator = (window as TranslatorWindow).Translator;
    const options = { sourceLanguage: 'en', targetLanguage: 'zh' };
    if (!translator || await translator.availability(options) === 'unavailable') {
      setFallback(true);
      return;
    }
    const model = await translator.create(options);
    try { setTranslation(await model.translate(text)); }
    finally { model.destroy(); }
  }

  return <section className="panel resources">
    <div className="resource-header"><h2>资源中心</h2></div>
    <div className="quick-actions" aria-label="资源来源">
      <button disabled={busy} aria-pressed={source === 'modrinth'} onClick={() => {
        setSource('modrinth');
        browse(type, query, 0, 'modrinth');
      }}>Modrinth</button>
      <button disabled={busy} aria-pressed={source === 'curseforge'} onClick={() => {
        setSource('curseforge');
        setDetail(undefined); setPlan(undefined); setList(undefined);
        void run(async () => {
          const configured = await window.launcher.curseConfigured();
          setCurseConfigured(configured);
          if (configured) {
            setList(await window.launcher.browseResources('curseforge', type, query, 0));
            setOffset(0);
          }
        });
      }}>CurseForge</button>
    </div>
    {source === 'curseforge' && <details open={!curseConfigured || undefined}>
      <summary>CurseForge 下载设置</summary>
      <p>浏览和下载需要 CurseForge 官方 API Key。密钥只保存在本机系统加密存储。</p>
      <form onSubmit={event => { event.preventDefault(); void run(async () => {
        await window.launcher.configureCurse(curseKey.trim());
        setCurseKey(''); setCurseConfigured(true);
        setList(await window.launcher.browseResources('curseforge', type, query, 0));
        setOffset(0);
      }); }}>
        <label>CurseForge API Key<input type="password" autoComplete="off" maxLength={512}
          value={curseKey} onChange={event => setCurseKey(event.target.value)} /></label>
        <button disabled={busy || !curseKey.trim()}>保存并浏览</button>
      </form>
    </details>}
    <div className="quick-actions" aria-label="资源类型">{Object.entries(resourceTypes).map(([kind, name]) =>
      <button key={kind} type="button" disabled={busy} aria-pressed={kind === type} onClick={() => {
        setType(kind as ResourceType); browse(kind as ResourceType, query);
      }}>{name}</button>)}</div>
    <form onSubmit={search}>
      <label>搜索{resourceTypes[type]}<input type="search" maxLength={100} value={query}
        onChange={event => setQuery(event.target.value)} /></label>
      <button disabled={busy}>搜索</button>
    </form>
    {detail ? <article className="resource-detail">
      <button type="button" disabled={busy} onClick={() => { setDetail(undefined); setPlan(undefined); }}>返回列表</button>
      <h3>{detail.title}</h3><p>{detail.description}</p>
      {!!detail.versions.length && <p>支持版本：{detail.versions.join('、')}</p>}
      {!!detail.gallery.length && <div className="gallery">{detail.gallery.map(item =>
        <img key={item.url} src={item.url} alt={item.title || detail.title + '截图'} loading="lazy" referrerPolicy="no-referrer" />)}</div>}
      {detail.body && <details><summary>完整说明</summary><p className="resource-text">{detail.body}</p></details>}
      <div className="quick-actions">
        {!!detail.description && <button disabled={busy} onClick={() => {
          setFallback(false);
          void run(async () => { try { await translate(detail.description); } catch { setFallback(true); } });
        }}>翻译简介</button>}
        {fallback && <button disabled={busy} onClick={() =>
          void run(() => window.launcher.openTranslation(detail.description))}>在浏览器用 Google 翻译</button>}
        {source === 'curseforge' && <button disabled={busy} onClick={() =>
          void run(() => window.launcher.openCurseProject(detail.id))}>打开 CurseForge 官方页面</button>}
        <button disabled={busy || !instance} className="primary" onClick={() => {
          if (instance) void run(async () => setPlan(await window.launcher.previewMod(instance, source, detail.id)));
        }}>检查兼容性并预览安装</button>
      </div>
      {translation && <p lang="zh-CN">{translation}</p>}
      <p>{instance ? '安装目标 · ' + instanceName : '先选择一个已安装的游戏实例，再安装资源。'}</p>
    </article> : <>
      {list?.items.length === 0 && <p>没有符合条件的资源。</p>}
      {!!list?.items.length && <div className="resource-list">{list.items.map(item =>
        <button className="resource-result" key={item.id} disabled={busy} onClick={() => {
          setTranslation(''); setFallback(false);
          void run(async () => setDetail(await window.launcher.resourceDetails(source, item.id)));
        }}>
          {item.icon && <img src={item.icon} alt="" loading="lazy" referrerPolicy="no-referrer" />}
          <span><strong>{item.title}</strong><small>{item.description}</small></span>
          <small>{new Intl.NumberFormat('zh-CN', { notation: 'compact' }).format(item.downloads)} 次下载</small>
        </button>)}</div>}
      {!!list?.items.length && <div className="quick-actions">
        {offset > 0 && <button disabled={busy} onClick={() => browse(type, query, offset - 12)}>上一页</button>}
        {offset + 12 < Math.min(list.total, 997) && <button disabled={busy} onClick={() => browse(type, query, offset + 12)}>下一页</button>}
      </div>}
    </>}
    {plan && instance && <section className="installation-plan">
      <h3>确认安装到 {instanceName}</h3>
      <ul>{plan.files.map((file, index) => <li key={index}>{file.title} · {file.version}</li>)}</ul>
      <button type="button" className="primary" disabled={busy} onClick={() => {
        const token = plan.token;
        setPlan(undefined);
        void run(async () => {
          await window.launcher.installMod(instance, token);
          setMessage('已下载并通过校验。下次启动游戏时可使用。');
        }, true);
      }}>确认安装</button>
      <button type="button" className="secondary" onClick={() => setPlan(undefined)}>取消</button>
    </section>}
    {working && <p role="status">正在处理资源…</p>}
    {message && <p role="status">{message}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
