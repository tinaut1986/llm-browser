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
// Textos de la interfaz en el idioma elegido (Ajustes -> Idioma). Las claves son el texto en inglés.
const L = ipcRenderer.sendSync('i18n');
const t = (key, vars) => (L.dict[key] || key).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m));
contextBridge.exposeInMainWorld('i18n', {
  lang: L.lang,
  t,
  // data-i18n (texto), data-i18n-title y data-i18n-placeholder: el valor es la clave en inglés.
  apply(root = document) {
    document.documentElement.lang = L.lang;
    for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
    for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  },
});