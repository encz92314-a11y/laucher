import { useEffect, useState } from 'react';

export const modes = {
  off: ['手动配置', '只加载实例本身的模组'],
  fast: ['极速', '8 区块渲染 · 5 区块模拟'],
  balanced: ['平衡', '12 区块渲染 · Iris 光影支持'],
  quality: ['画质', '20 区块渲染 · Iris 光影支持'],
} as const;

export type Preset = keyof typeof modes;
type Preview = Awaited<ReturnType<Window['launcher']['previewProfile']>>;

export function Profiles({ id, disabled, notify }: { id: string; disabled: boolean; notify: (value: boolean) => void }) {
  const [current, setCurrent] = useState<Preset>('off');
  const [plan, setPlan] = useState<{ preset: Preset; preview: Preview }>();
  const [packs, setPacks] = useState<string[]>();
  const [shader, setShader] = useState('');
  const [saved, setSaved] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  useEffect(() => {
    let active = true;
    window.launcher.profile(id).then(value => { if (active) setCurrent(value); },
      reason => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, [id]);
  async function perform(action: () => Promise<void>, message: string) {
    setWorking(true);
    notify(true);
    setError('');
    setSaved('');
    setStatus(message);
    try { await action(); }
    catch (error) { setError(String(error)); }
    finally { setWorking(false); setStatus(''); notify(false); }
  }
  return <section className="panel">
    <h2>性能预设</h2>
    <p>当前使用 {modes[current][0]}。预设模组存放在独立目录中。</p>
    <div className="preset-list">{(Object.keys(modes) as Preset[]).map(preset =>
      <button type="button" key={preset} aria-pressed={current === preset} disabled={disabled || working}
        onClick={() => {
          setPlan(undefined);
          void perform(async () => setPlan({ preset, preview: await window.launcher.previewProfile(id, preset) }),
            '正在检查 Fabric 和模组版本…');
        }}>
        <strong>{modes[preset][0]}</strong><small>{modes[preset][1]}</small>
      </button>)}</div>
    {plan && <div className="installation-plan">
      <h3>{modes[plan.preset][0]}安装清单</h3>
      {plan.preview.files.length > 0 && <ul>{plan.preview.files.map(file => <li key={file.title}>{file.title} · {file.version}</li>)}</ul>}
      {plan.preview.skipped.map(item => <p key={item.project}>已跳过 {item.project} · {item.reason}</p>)}
      <button type="button" className="primary" disabled={disabled || working} onClick={() => {
        const token = plan.preview.token;
        setPlan(undefined);
        void perform(async () => setCurrent(await window.launcher.applyProfile(id, token)), '正在校验并安装预设…');
      }}>应用预设</button>
      <button type="button" className="secondary" onClick={() => setPlan(undefined)}>取消</button>
    </div>}
    <div className="quick-actions"><button type="button" disabled={disabled || working}
      onClick={() => void perform(() => window.launcher.shaderFolder(id), '正在打开文件夹…')}>打开光影包文件夹</button></div>
    {(current === 'balanced' || current === 'quality') && <div className="installation-plan">
      <h3>光影包</h3>
      <p>把自己选择的光影 ZIP 放入文件夹，再读取本地列表。</p>
      <button type="button" disabled={disabled || working} onClick={() => void perform(async () => {
        setPacks(await window.launcher.shaders(id)); setShader('');
      }, '正在读取光影包…')}>读取本地光影包</button>
      {packs && <div className="quick-actions">
        <select aria-label="光影包" value={shader} onChange={event => setShader(event.target.value)}>
          <option value="">关闭光影</option>
          {packs.map(pack => <option key={pack}>{pack}</option>)}
        </select>
        <button type="button" disabled={disabled || working} onClick={() => void perform(async () => {
          await window.launcher.selectShader(id, shader);
          setSaved('已保存，下次启动游戏时生效。');
        }, '正在保存光影设置…')}>保存</button>
      </div>}
    </div>}
    {saved && <p role="status">{saved}</p>}
    {status && <p role="status">{status}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
