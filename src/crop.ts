export function cropRectangle(imageWidth: number, imageHeight: number, ratio: number, zoom: number, x: number, y: number) {
  const width = Math.min(imageWidth, imageHeight * ratio) / zoom;
  const height = width / ratio;
  return { width, height, left: (imageWidth - width) * x, top: (imageHeight - height) * y };
}
