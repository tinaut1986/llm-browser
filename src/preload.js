const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  cmd: (c, a) => ipcRenderer.invoke('cmd', c, a),
  onState: cb => ipcRenderer.on('state', (_e, s) => cb(s)),
  onFocusUrl: cb => ipcRenderer.on('focus-url', cb),
});
