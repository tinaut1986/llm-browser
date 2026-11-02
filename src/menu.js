// Menú superior. Los atajos que ya gestiona la ventana (before-input-event / ui.html) solo se muestran
// (registerAccelerator: false) para que no se disparen dos veces.
// h: acciones y estado que aporta main.js.
module.exports = function menuTemplate(h) {
  const shown = (label, accelerator, click, extra = {}) => ({ label, accelerator, registerAccelerator: false, click, ...extra });
  const mac = process.platform === 'darwin';
  return [
    ...(mac ? [{ role: 'appMenu' }] : []),
    { label: 'Archivo', submenu: [
      shown('Pestaña nueva', 'CmdOrCtrl+T', h.newTab),
      shown('Cerrar pestaña', 'CmdOrCtrl+W', h.closeTab),
      { type: 'separator' },
      shown('Ir a la barra de direcciones', 'CmdOrCtrl+L', h.focusUrl),
      { type: 'separator' },
      { label: 'Salir', click: h.quit },
    ] },
    { label: 'Ver', submenu: [
      shown('Recargar', 'CmdOrCtrl+R', h.reload),
      shown('Recargar sin caché', 'CmdOrCtrl+Shift+R', h.hardReload),
      { type: 'separator' },
      { label: 'Acercar', accelerator: 'CmdOrCtrl+Plus', click: () => h.zoom(0.5) },
      { label: 'Alejar', accelerator: 'CmdOrCtrl+-', click: () => h.zoom(-0.5) },
      { label: 'Tamaño normal', accelerator: 'CmdOrCtrl+0', click: () => h.zoom(0) },
      { type: 'separator' },
      { label: 'Pantalla completa', accelerator: 'F11', click: h.fullscreen },
      { label: 'Herramientas de desarrollo', accelerator: 'F12', click: h.devtools },
    ] },
    { label: 'Herramientas', submenu: [
      { label: 'El modelo puede actuar', type: 'checkbox', checked: h.act(), click: i => h.setAct(i.checked) },
      shown('Rellenar con Bitwarden', 'CmdOrCtrl+Shift+L', h.bitwarden),
      { type: 'separator' },
      { label: 'Buscador por defecto', submenu: h.engines.map(e => ({ label: e.name, type: 'radio', checked: h.engine() === e.id, click: () => h.setEngine(e.id) })) },
    ] },
    { label: 'Ajustes', submenu: [
      { label: 'Canal de actualizaciones', submenu: [
        { label: 'Estable', type: 'radio', checked: !h.betas(), click: () => h.setBetas(false) },
        { label: 'Beta', type: 'radio', checked: h.betas(), click: () => h.setBetas(true) },
      ] },
      { label: 'Buscar actualizaciones ahora', click: h.checkUpdates },
    ] },
    { label: 'Ayuda', submenu: [
      { label: 'Acerca de LLM Browser', click: h.about },
      { label: 'Página del proyecto', click: h.openProject },
      { label: 'Abrir carpeta de configuración (mcp.json, ajustes)', click: h.openConfig },
    ] },
  ];
};
