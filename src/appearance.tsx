import { useState } from 'react';
import { WallpaperCrop } from './wallpaper-crop';
import { readableError } from './errors';

export type Appearance = {
  style: 'glass' | 'clean' | 'solid';
  accent: 'violet' | 'ocean' | 'forest' | 'amber' | 'custom';
  customColor: string;
  windowOpacity: number;
  imageOpacity: number;
  wallpaper: boolean;
};
export const defaultAppearance: Appearance = {
  style: 'glass', accent: 'violet', customColor: '#8464c5', windowOpacity: 100, imageOpacity: 78, wallpaper: false,
};

export function AppearanceSettings({ values, image, update, setImage }: {
  values: Appearance; image?: string; update: (value: Appearance) => void; setImage: (image?: string) => void;
}) {
  const [draft, setDraft] = useState<string>();
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  function change(patch: Partial<Appearance>) {
    setMessage('');
    update({ ...values, ...patch });
  }
  async function run(action: () => Promise<void>) {
    setWorking(true);
    setMessage('');
    setError('');
    try { await action(); }
    catch (reason) { setError(readableError(reason)); }
    finally { setWorking(false); }
  }
  return <section className="panel settings-panel">
    <h2>外观</h2>
    <fieldset disabled={working}>
      <legend>风格与配色</legend>
      <div className="appearance-grid">
        <label>界面风格<select value={values.style}
          onChange={event => change({ style: event.target.value as Appearance['style'] })}>
          <option value="glass">液态玻璃</option><option value="clean">简洁</option><option value="solid">经典</option>
        </select></label>
        <label>强调色<select value={values.accent}
          onChange={event => change({ accent: event.target.value as Appearance['accent'] })}>
          <option value="violet">紫色</option><option value="ocean">海蓝</option><option value="forest">森林绿</option>
          <option value="amber">琥珀</option><option value="custom">自定义颜色</option>
        </select></label>
        {values.accent === 'custom' && <label>自定义颜色<input type="color" value={values.customColor}
          onChange={event => change({ customColor: event.target.value })} /></label>}
      </div>
      <label className="slider">整个窗口不透明度 <output>{values.windowOpacity}%</output>
        <input type="range" min={40} max={100} value={values.windowOpacity}
          onChange={event => change({ windowOpacity: Number(event.target.value) })} />
      </label>
      <p>透明度会同时影响背景、文字和按钮。</p>
    </fieldset>
    <fieldset disabled={working}>
      <legend>背景图片</legend>
      <div className="quick-actions">
        <button onClick={() => void run(async () => {
          const selected = await window.launcher.pickWallpaper();
          if (selected) setDraft(selected);
        })}>选择本机图片</button>
        <button onClick={() => void run(() => window.launcher.openWallpapers())}>Minecraft 官方素材</button>
        {image && <button onClick={() => void run(async () => {
          await window.launcher.resetAppearanceImage();
          setImage(undefined);
          change({ wallpaper: false });
        })}>移除背景图</button>}
      </div>
      {image && <>
        <label className="check"><input type="checkbox" checked={values.wallpaper}
          onChange={event => change({ wallpaper: event.target.checked })} />显示背景图</label>
        <label className="slider">图片不透明度 <output>{values.imageOpacity}%</output>
          <input type="range" min={0} max={100} value={values.imageOpacity}
            onChange={event => change({ imageOpacity: Number(event.target.value) })} /></label>
      </>}
    </fieldset>
    <div className="quick-actions">
      <button className="primary" disabled={working} onClick={() => void run(async () => {
        await window.launcher.saveAppearance(values);
        setMessage('外观设置已保存。');
      })}>保存外观</button>
      <button disabled={working} onClick={() => void run(async () => {
        await window.launcher.saveAppearance(defaultAppearance);
        update(defaultAppearance);
        setMessage('已恢复默认外观。');
      })}>恢复默认</button>
    </div>
    {draft && <WallpaperCrop source={draft} busy={working} error={error}
        cancel={() => { setDraft(undefined); setError(''); }} apply={jpeg => void run(async () => {
          const cropped = await window.launcher.saveWallpaperCrop(jpeg);
          setImage(cropped);
          setDraft(undefined);
          change({ wallpaper: true });
        })} />}
    {message && <p role="status">{message}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
