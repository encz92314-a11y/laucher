import { useState } from 'react';
import { readableError } from './errors';

export type Skin = { skin: string; variant: 'classic' | 'slim' };
export type DefaultSkin = Skin & { name: string };

export function Skins({ current, instance, online, update, disabled }: {
  current?: string; instance?: string; online: boolean; update: (skin?: string) => void; disabled: boolean;
}) {
  const [defaults, setDefaults] = useState<DefaultSkin[]>();
  const [selected, setSelected] = useState<Skin>();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function run(action: () => Promise<void>) {
    setWorking(true);
    setError('');
    setMessage('');
    try { await action(); }
    catch (reason) { setError(readableError(reason)); }
    finally { setWorking(false); }
  }
  return <section className="panel skin-panel">
    <h2>皮肤</h2>
    <div className="skin-previews">
      {current && <div><h3>当前皮肤</h3><img className="skin-sheet" src={current} alt="当前皮肤纹理" /></div>}
      {selected && <div><h3>预览</h3><img className="skin-sheet" src={selected.skin} alt="选中的皮肤纹理" /></div>}
    </div>
    {!current && <p>登录 Microsoft 后可查看并更换账号皮肤。</p>}
    <div className="quick-actions">
      <button disabled={disabled || working} onClick={() => void run(async () => {
        const result = await window.launcher.chooseSkin(undefined, undefined);
        setSelected(result ?? undefined);
      })}>预览本地 PNG</button>
      {instance && <button disabled={disabled || working} onClick={() =>
        void run(async () => setDefaults(await window.launcher.listDefaultSkins(instance)))}>查看游戏自带皮肤</button>}
    </div>
    {defaults?.length === 0 && <p>当前游戏版本未在客户端提供默认皮肤纹理。</p>}
    {!!defaults?.length && <div className="quick-actions">{defaults.map((item, index) =>
      <button disabled={disabled || working} key={item.name + item.variant} onClick={() => {
        if (instance) void run(async () => {
          const skin = await window.launcher.chooseSkin(instance, index);
          setSelected(skin ?? undefined);
        });
      }}><span className="avatar"><img src={item.skin} alt="" /></span> {item.name} · {item.variant === 'slim' ? '细手臂' : '经典'}</button>)}</div>}
    {selected && online && <div className="quick-actions">
      <label>皮肤模型<select value={selected.variant} onChange={event =>
        setSelected({ ...selected, variant: event.target.value as Skin['variant'] })}>
        <option value="classic">经典</option><option value="slim">细手臂</option>
      </select></label>
      <button disabled={disabled || working} onClick={() => void run(async () => {
        update((await window.launcher.uploadSkin(selected.variant)).skin);
        setSelected(undefined);
        setMessage('Microsoft 账号的皮肤已更换。');
      })}>应用到 Microsoft 账号</button>
    </div>}
    {selected && !online && <p>离线模式可预览皮肤，修改在线皮肤需要登录 Microsoft。</p>}
    {working && <p role="status">正在处理皮肤…</p>}
    {message && <p role="status">{message}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
