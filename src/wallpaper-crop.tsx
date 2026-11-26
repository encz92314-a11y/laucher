import { useEffect, useRef, useState } from 'react';
import { cropRectangle } from './crop';

export function WallpaperCrop({ source, busy, cancel, apply }: {
  source: string; busy: boolean; cancel: () => void; apply: (jpeg: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement>();
  const [ratio, setRatio] = useState(() => Math.max(1, Math.min(2.5, window.innerWidth / window.innerHeight)));
  const [zoom, setZoom] = useState(100);
  const [x, setX] = useState(50);
  const [y, setY] = useState(50);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const loaded = new Image();
    loaded.onload = () => setImage(loaded);
    loaded.onerror = () => setFailed(true);
    loaded.src = source;
    return () => { loaded.onload = null; loaded.onerror = null; };
  }, [source]);
  useEffect(() => {
    const target = canvas.current;
    const context = target?.getContext('2d');
    if (!target || !context || !image) return;
    const { left, top, width, height } = cropRectangle(image.naturalWidth, image.naturalHeight, ratio, zoom / 100, x / 100, y / 100);
    context.drawImage(image, left, top, width, height, 0, 0, target.width, target.height);
  }, [image, ratio, zoom, x, y]);
  return <section className="wallpaper-crop" aria-label="裁剪背景图片">
    <h3>裁剪背景</h3>
    <canvas ref={canvas} width={1600} height={Math.round(1600 / ratio)} aria-label="背景裁剪预览" />
    <div className="quick-actions" aria-label="裁剪比例">
      <button type="button" onClick={() => setRatio(Math.max(1, Math.min(2.5, window.innerWidth / window.innerHeight)))}>匹配窗口</button>
      <button type="button" onClick={() => setRatio(16 / 9)}>16:9</button>
      <button type="button" onClick={() => setRatio(16 / 10)}>16:10</button>
    </div>
    <label className="slider">缩放 <output>{zoom}%</output><input type="range" min={100} max={300} value={zoom}
      onChange={event => setZoom(Number(event.target.value))} /></label>
    <div className="appearance-grid">
      <label>横向位置<input type="range" min={0} max={100} value={x} onChange={event => setX(Number(event.target.value))} /></label>
      <label>纵向位置<input type="range" min={0} max={100} value={y} onChange={event => setY(Number(event.target.value))} /></label>
    </div>
    <div className="quick-actions">
      <button type="button" className="primary" disabled={busy || !image || failed}
        onClick={() => { if (canvas.current) apply(canvas.current.toDataURL('image/jpeg', .9)); }}>应用裁剪</button>
      <button type="button" disabled={busy} onClick={cancel}>取消</button>
    </div>
    {failed && <p role="alert">无法预览这张图片。</p>}
  </section>;
}
