const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  cmd: (c, a) => ipcRenderer.invoke('cmd', c, a),
  onState: cb => ipcRenderer.on('state', (_e, s) => cb(s)),
  onFind: cb => {
    ipcRenderer.on('find-open', () => cb('open'));
    ipcRenderer.on('find-close', () => cb('close'));
    ipcRenderer.on('find-result', (_e, r) => cb('result', r));
  },
  onFocusUrl: cb => ipcRenderer.on('focus-url', cb),
});
