const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  submit: pw => ipcRenderer.send('bw-pw', pw),
  cancel: () => ipcRenderer.send('bw-cancel'),
  onError: cb => ipcRenderer.on('bw-error', (_e, m) => cb(m)),
});
