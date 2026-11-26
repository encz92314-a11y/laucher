import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { localPath, writeJSON } from './core.mjs';

export const appearanceDefault = Object.freeze({
  style: 'glass', accent: 'violet', customColor: '#8464c5', opacity: 82, imageOpacity: 78, wallpaper: false,
});

export function validateAppearance(input) {
  if (!input || !['glass', 'clean', 'solid'].includes(input.style) ||
      !['violet', 'ocean', 'forest', 'amber', 'custom'].includes(input.accent) ||
      !/^#[a-f0-9]{6}$/i.test(input.customColor ?? '') ||
      ![input.opacity, input.imageOpacity].every(value => Number.isInteger(value) && value >= 0 && value <= 100) ||
      typeof input.wallpaper !== 'boolean') {
    throw new Error('外观设置无效');
  }
  return { style: input.style, accent: input.accent, customColor: input.customColor,
    opacity: input.opacity, imageOpacity: input.imageOpacity, wallpaper: input.wallpaper };
}

export function appearanceStore(root) {
  const settings = localPath(root, 'appearance.json');
  const image = localPath(root, 'wallpaper.jpg');
  return {
    async load() {
      const raw = await readFile(settings, 'utf8').catch(error => {
        if (error.code === 'ENOENT') return '';
        throw error;
      });
      let values = appearanceDefault;
      if (raw) {
        try { values = validateAppearance(JSON.parse(raw)); }
        catch { /* Invalid or older preferences fall back to usable defaults. */ }
      }
      const jpeg = await readFile(image).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      return { values: { ...values, wallpaper: values.wallpaper && !!jpeg },
        image: jpeg ? 'data:image/jpeg;base64,' + jpeg.toString('base64') : undefined };
    },
    save: values => writeJSON(settings, validateAppearance(values)),
    async storeImage(jpeg) {
      await mkdir(root, { recursive: true });
      await writeFile(image, jpeg);
      return 'data:image/jpeg;base64,' + jpeg.toString('base64');
    },
    removeImage: () => rm(image, { force: true }),
  };
}
