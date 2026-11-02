const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  bm: op => ipcRenderer.invoke('bm', op),
  onState: cb => ipcRenderer.on('bm-state', (_e, tree) => cb(tree)),
  onSelect: cb => ipcRenderer.on('bm-select', (_e, id) => cb(id)),
});
