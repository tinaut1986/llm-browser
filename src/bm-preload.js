const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  bm: op => ipcRenderer.invoke('bm', op),
  onState: cb => ipcRenderer.on('bm-state', (_e, tree) => cb(tree)),
  onSelect: cb => ipcRenderer.on('bm-select', (_e, id) => cb(id)),
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