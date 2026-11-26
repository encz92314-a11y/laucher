import { readableError } from './errors';
import { useState } from 'react';
import type { FormEvent } from 'react';

type Bridge = Window['launcher'];

export function Resources({ instance, disabled, notify }: { instance: string; disabled: boolean; notify: (active: boolean) => void }) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Awaited<ReturnType<Bridge['searchMods']>>>();
  const [plan, setPlan] = useState<Awaited<ReturnType<Bridge['previewMod']>>>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const busy = disabled || working;

  async function run(action: () => Promise<void>) {
    setWorking(true);
    notify(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (error) {
      setError(readableError(error));
    } finally {
      setWorking(false);
      notify(false);
    }
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPlan(undefined);
    void run(async () => setMatches(await window.launcher.searchMods(instance, query)));
  }

  function preview(project: string) {
    setPlan(undefined);
    void run(async () => setPlan(await window.launcher.previewMod(instance, project)));
  }

  function install() {
    if (!plan) return;
    const token = plan.token;
    setPlan(undefined);
    void run(async () => {
      const files = await window.launcher.installMod(instance, token);
      setMessage(`已校验并安装 ${files.length} 个模组。下次启动游戏时加载。`);
    });
  }

  return <section className="panel resources">
    <h2>Modrinth 模组</h2>
    <form onSubmit={search}>
      <label>搜索兼容的 Fabric 模组<input type="search" maxLength={100} value={query}
        onChange={event => setQuery(event.target.value)} /></label>
      <button disabled={busy}>搜索</button>
    </form>
    <div className="quick-actions">
      <button type="button" onClick={() => preview('sodium')} disabled={busy}>预览 Sodium 安装</button>
      <button type="button" onClick={() => preview('e4mc')} disabled={busy}>预览 e4mc 安装</button>
    </div>
    {matches?.length === 0 && <p>没有匹配的模组。</p>}
    {!!matches?.length && <ul>{matches.map(result => <li key={result.id}>
      <strong>{result.title}</strong><p>{result.description}</p>
      <button type="button" onClick={() => preview(result.id)} disabled={busy}>预览安装</button>
    </li>)}</ul>}
    {plan && <section className="installation-plan">
      <h3>确认安装以下模组</h3>
      <ul>{plan.files.map((file, index) => <li key={index}>{file.title} · {file.version}</li>)}</ul>
      <button type="button" className="primary" onClick={install} disabled={busy}>确认安装</button>
      <button type="button" className="secondary" onClick={() => setPlan(undefined)}>取消</button>
    </section>}
    {working && <p role="status">正在处理 Modrinth 请求…</p>}
    {message && <p role="status">{message}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
