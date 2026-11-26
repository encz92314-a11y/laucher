const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('launcher', {
  appearance: () => ipcRenderer.invoke('launcher:appearance'),
  appearancePreview: values => ipcRenderer.invoke('launcher:appearancePreview', values),
  saveAppearance: values => ipcRenderer.invoke('launcher:saveAppearance', values),
  pickWallpaper: () => ipcRenderer.invoke('launcher:pickWallpaper'),
  resetAppearanceImage: () => ipcRenderer.invoke('launcher:resetAppearanceImage'),
  openWallpapers: () => ipcRenderer.invoke('launcher:openWallpapers'),
  system: () => ipcRenderer.invoke('launcher:system'),
  profile: id => ipcRenderer.invoke('launcher:profile', id),
  previewProfile: (id, preset) => ipcRenderer.invoke('launcher:previewProfile', id, preset),
  applyProfile: (id, token) => ipcRenderer.invoke('launcher:applyProfile', id, token),
  shaders: id => ipcRenderer.invoke('launcher:shaders', id),
  selectShader: (id, name) => ipcRenderer.invoke('launcher:selectShader', id, name),
  shaderFolder: id => ipcRenderer.invoke('launcher:shaderFolder', id),
  list: () => ipcRenderer.invoke('launcher:list'),
  versions: () => ipcRenderer.invoke('launcher:versions'),
  create: (name, version, loader) => ipcRenderer.invoke('launcher:create', name, version, loader),
  browseResources: (source, type, query, offset) => ipcRenderer.invoke('launcher:browseResources', source, type, query, offset),
  curseConfigured: () => ipcRenderer.invoke('launcher:curseConfigured'),
  configureCurse: key => ipcRenderer.invoke('launcher:configureCurse', key),
  openCurseProject: id => ipcRenderer.invoke('launcher:openCurseProject', id),
  resourceDetails: (source, id) => ipcRenderer.invoke('launcher:resourceDetails', source, id),
  openTranslation: description => ipcRenderer.invoke('launcher:openTranslation', description),
  chooseSkin: (id, index) => ipcRenderer.invoke('launcher:chooseSkin', id, index),
  listDefaultSkins: id => ipcRenderer.invoke('launcher:listDefaultSkins', id),
  uploadSkin: variant => ipcRenderer.invoke('launcher:uploadSkin', variant),
  previewMod: (id, source, project) => ipcRenderer.invoke('launcher:previewMod', id, source, project),
  installMod: (id, token) => ipcRenderer.invoke('launcher:installMod', id, token),
  accountSettings: () => ipcRenderer.invoke('launcher:accountSettings'),
  signIn: (clientId, external) => ipcRenderer.invoke('launcher:signIn', clientId, external),
  relayStatus: () => ipcRenderer.invoke('launcher:relayStatus'),
  relayInstalled: id => ipcRenderer.invoke('launcher:relayInstalled', id),
  installRelay: id => ipcRenderer.invoke('launcher:installRelay', id),
  copyRelay: () => ipcRenderer.invoke('launcher:copyRelay'),
  onRelay: callback => {
    const listener = (_, state) => callback(state);
    ipcRenderer.on('launcher:relay', listener);
    return () => ipcRenderer.removeListener('launcher:relay', listener);
  },
  signInOffline: nickname => ipcRenderer.invoke('launcher:signInOffline', nickname),
  signOut: () => ipcRenderer.invoke('launcher:signOut'),
  play: (id, host, address) => ipcRenderer.invoke('launcher:play', id, host, address),
  onGameExit: callback => {
    const handler = (_, code) => callback(code);
    ipcRenderer.on('launcher:game-exit', handler);
    return () => ipcRenderer.removeListener('launcher:game-exit', handler);
  },
  install: id => ipcRenderer.invoke('launcher:install', id),
  onProgress: callback => {
    const handler = (_, progress) => callback(progress);
    ipcRenderer.on('launcher:progress', handler);
    return () => ipcRenderer.removeListener('launcher:progress', handler);
  },
});
