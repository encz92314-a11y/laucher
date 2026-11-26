import { useEffect, useState } from 'react';
import { readableError } from './errors';

export type RelayState = { state: 'idle' | 'waiting' | 'shared' | 'error'; address?: string };

export function Multiplayer({ id, fabric, online, disabled, signIn, play, notify }: {
  id?: string; fabric: boolean; online: boolean; disabled: boolean; signIn: () => void;
  play: (host: boolean, address?: string) => Promise<void>; notify: (active: boolean) => void;
}) {
  const [installed, setInstalled] = useState(false);
  const [working, setWorking] = useState(false);
  const [relay, setRelay] = useState<RelayState>({ state: 'idle' });
  const [destination, setDestination] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    if (id && fabric) window.launcher.relayInstalled(id).then(value => { if (active) setInstalled(value); },
      reason => { if (active) setError(readableError(reason)); });
    window.launcher.relayStatus().then(state => { if (active) setRelay(state); }).catch(() => {});
    const unsubscribe = window.launcher.onRelay(state => { setRelay(state); setCopied(false); });
    return () => { active = false; unsubscribe(); };
  }, [id, fabric]);

  async function install() {
    if (!id) return;
    setWorking(true);
    notify(true);
    setError('');
    try {
      await window.launcher.installRelay(id);
      setInstalled(true);
    } catch (reason) { setError(readableError(reason)); }
    finally { setWorking(false); notify(false); }
  }

  return <section className="panel">
    <h2>好友联机 · e4mc</h2>
    <p>地址只发给你认识的好友。进入世界并选择「对局域网开放」后，e4mc 才会创建联机地址。</p>
    {!online && <button type="button" onClick={signIn} disabled={disabled}>前往 Microsoft 登录</button>}
    <div className="installation-plan">
      <h3>开房</h3>
      {!fabric || !id ? <p>请选择一个已安装的 Fabric 实例。</p> : !installed ?
        <button type="button" disabled={disabled || working} onClick={() => void install()}>
          {working ? '正在安装…' : '为当前实例安装 e4mc'}</button> :
        <button type="button" className="primary" disabled={!online || disabled}
          onClick={() => void play(true)}>启动联机实例</button>}
      {relay.state === 'waiting' && <p role="status">进入单人世界，然后在暂停菜单点「对局域网开放」。</p>}
      {relay.state === 'error' && <p className="error" role="alert">e4mc 建立连接失败。请查看游戏内提示。</p>}
      {relay.state === 'shared' && relay.address && <div role="status">
        <p>本次检测到的地址：<code>{relay.address}</code></p>
        <button type="button" onClick={() => void window.launcher.copyRelay().then(() => setCopied(true),
          reason => setError(readableError(reason)))}>{copied ? '已复制' : '复制地址'}</button>
        <p>要结束共享，可在游戏内输入 <code>/e4mc stop</code> 或退出世界。</p>
      </div>}
    </div>
    <div className="installation-plan">
      <h3>加入好友</h3>
      <form className="sign-in-form" onSubmit={event => { event.preventDefault(); void play(false, destination.trim()); }}>
        <label>e4mc 地址<input autoComplete="off" spellCheck={false} value={destination} maxLength={200}
          placeholder="好友发来的 e4mc.link 地址" required onChange={event => setDestination(event.target.value)} /></label>
        <button type="submit" disabled={!online || !id || disabled || !destination.trim()}>启动并加入</button>
      </form>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
