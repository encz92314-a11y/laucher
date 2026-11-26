export function cropRectangle(imageWidth: number, imageHeight: number, ratio: number, zoom: number, x: number, y: number) {
  const width = Math.min(imageWidth, imageHeight * ratio) / zoom;
  const height = width / ratio;
  return { width, height, left: (imageWidth - width) * x, top: (imageHeight - height) * y };
}

export function moveCrop(position: { x: number; y: number }, horizontalRoom: number, verticalRoom: number,
  dx: number, dy: number) {
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return {
    x: horizontalRoom > 0 ? clamp(position.x - dx / horizontalRoom) : position.x,
    y: verticalRoom > 0 ? clamp(position.y - dy / verticalRoom) : position.y,
  };
}
