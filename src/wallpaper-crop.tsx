import { useEffect, useRef, useState } from 'react';
import { cropRectangle, moveCrop } from './crop';

const stageWidth = 1000;
const stageHeight = 560;
const windowRatio = () => Math.max(1, Math.min(2.5, window.innerWidth / window.innerHeight));
const boundedZoom = (value: number) => Math.max(100, Math.min(300, value));

export function WallpaperCrop({ source, busy, error, cancel, apply }: {
  source: string; busy: boolean; error: string; cancel: () => void; apply: (jpeg: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ id: number; x: number; y: number }>(null);
  const [image, setImage] = useState<HTMLImageElement>();
  const [aspect, setAspect] = useState('window');
  const [initialRatio] = useState(windowRatio);
  const ratio = aspect === 'wide' ? 16 / 9 : aspect === 'classic' ? 16 / 10 : initialRatio;
  const [zoom, setZoom] = useState(100);
  const [position, setPosition] = useState({ x: .5, y: .5 });
  const [failed, setFailed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const frameWidth = Math.min(stageWidth * .87, stageHeight * .78 * ratio);
  const frameHeight = frameWidth / ratio;
  const frameLeft = (stageWidth - frameWidth) / 2;
  const frameTop = (stageHeight - frameHeight) / 2;
  const crop = image && cropRectangle(image.naturalWidth, image.naturalHeight, ratio, zoom / 100, position.x, position.y);

  useEffect(() => {
    dialog.current?.showModal();
    canvas.current?.focus();
  }, []);
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
    if (!context) return;
    context.fillStyle = '#16121d';
    context.fillRect(0, 0, stageWidth, stageHeight);
    if (!image || !crop) return;
    const scale = frameWidth / crop.width;
    context.drawImage(image, frameLeft - crop.left * scale, frameTop - crop.top * scale,
      image.naturalWidth * scale, image.naturalHeight * scale);
    context.fillStyle = 'rgba(12, 8, 19, .72)';
    context.fillRect(0, 0, stageWidth, frameTop);
    context.fillRect(0, frameTop + frameHeight, stageWidth, frameTop);
    context.fillRect(0, frameTop, frameLeft, frameHeight);
    context.fillRect(frameLeft + frameWidth, frameTop, frameLeft, frameHeight);
    context.strokeStyle = '#eee3ff';
    context.lineWidth = 2;
    context.strokeRect(frameLeft, frameTop, frameWidth, frameHeight);
  }, [image, crop, frameLeft, frameTop, frameWidth, frameHeight]);
  useEffect(() => {
    const stage = canvas.current;
    if (!stage) return;
    const wheel = (event: WheelEvent) => {
      if (busy) return;
      event.preventDefault();
      if (event.deltaY) setZoom(value => boundedZoom(value - Math.sign(event.deltaY) * 5));
    };
    stage.addEventListener('wheel', wheel, { passive: false });
    return () => stage.removeEventListener('wheel', wheel);
  }, [busy]);

  function move(dx: number, dy: number) {
    if (!image || !crop || busy) return;
    const scale = frameWidth / crop.width;
    setPosition(value => moveCrop(value, image.naturalWidth - crop.width, image.naturalHeight - crop.height,
      dx / scale, dy / scale));
  }

  function confirm() {
    if (!image || !crop || busy) return;
    const output = document.createElement('canvas');
    output.width = 1600;
    output.height = Math.round(output.width / ratio);
    const context = output.getContext('2d');
    if (!context) return;
    context.drawImage(image, crop.left, crop.top, crop.width, crop.height, 0, 0, output.width, output.height);
    apply(output.toDataURL('image/jpeg', .9));
  }

  return <dialog ref={dialog} className="wallpaper-crop" aria-labelledby="wallpaper-crop-title"
    onCancel={event => { event.preventDefault(); if (!busy) cancel(); }}>
    <div className="crop-header">
      <h3 id="wallpaper-crop-title">裁剪背景</h3>
      <button type="button" className="crop-close" aria-label="取消裁剪" disabled={busy} onClick={cancel}>×</button>
    </div>
    <p id="crop-instructions">拖动图片调整构图。只有框内的部分会用作背景。</p>
    <canvas ref={canvas} className={dragging ? 'is-dragging' : undefined} width={stageWidth} height={stageHeight}
      tabIndex={0} aria-label="背景裁剪预览" aria-describedby="crop-instructions"
      onPointerDown={event => {
        if (busy || !image || !event.isPrimary || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        setDragging(true);
      }}
      onPointerMove={event => {
        const previous = drag.current;
        if (!previous || previous.id !== event.pointerId) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        move((event.clientX - previous.x) * stageWidth / bounds.width,
          (event.clientY - previous.y) * stageHeight / bounds.height);
      }}
      onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
      onKeyDown={event => {
        const step = event.shiftKey ? 48 : 12;
        const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
        if (delta) { event.preventDefault(); move(delta[0], delta[1]); }
      }} />
    <fieldset className="crop-tools" disabled={busy}>
      <label>比例
        <select aria-label="裁剪比例" value={aspect} onChange={event => setAspect(event.target.value)}>
          <option value="window">匹配窗口</option>
          <option value="wide">16:9</option>
          <option value="classic">16:10</option>
        </select>
      </label>
      <label className="slider">缩放 <output>{zoom}%</output><input type="range" min={100} max={300} value={zoom}
        onChange={event => setZoom(Number(event.target.value))} /></label>
    </fieldset>
    {(failed || error) && <p className="error" role="alert">{error || '无法预览这张图片。'}</p>}
    <div className="crop-actions">
      <button type="button" disabled={busy} onClick={() => { setPosition({ x: .5, y: .5 }); setZoom(100); }}>重置构图</button>
      <button type="button" disabled={busy} onClick={cancel}>取消</button>
      <button type="button" className="primary" disabled={busy || !image || failed} onClick={confirm}>
        {busy ? '正在应用…' : '应用裁剪'}</button>
    </div>
  </dialog>;
}
