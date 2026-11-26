const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('launcher', {
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
  searchMods: (id, query) => ipcRenderer.invoke('launcher:searchMods', id, query),
  previewMod: (id, project) => ipcRenderer.invoke('launcher:previewMod', id, project),
  installMod: (id, token) => ipcRenderer.invoke('launcher:installMod', id, token),
  accountSettings: () => ipcRenderer.invoke('launcher:accountSettings'),
  signIn: clientId => ipcRenderer.invoke('launcher:signIn', clientId),
  signInOffline: () => ipcRenderer.invoke('launcher:signInOffline'),
  signOut: () => ipcRenderer.invoke('launcher:signOut'),
  play: id => ipcRenderer.invoke('launcher:play', id),
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
