// Menú superior. Los atajos que ya gestiona la ventana (before-input-event / ui.html) solo se muestran
// (registerAccelerator: false) para que no se disparen dos veces.
// h: acciones, estado y traductor (h.t) que aporta main.js.
module.exports = function menuTemplate(h) {
  const t = h.t || (s => s);
  const shown = (label, accelerator, click, extra = {}) => ({ label, accelerator, registerAccelerator: false, click, ...extra });
  const mac = process.platform === 'darwin';
  return [
    ...(mac ? [{ role: 'appMenu' }] : []),
    { label: t('File'), submenu: [
      // Estos tres sí registran el atajo: si el teclado se queda sin ningún foco (ni página ni interfaz),
      // before-input-event no llega a ver nada y solo el menú puede recogerlos. Si la ventana los
      // gestiona antes (preventDefault), el menú no se dispara dos veces.
      shown(t('New tab'), 'CmdOrCtrl+T', h.newTab, { registerAccelerator: true }),
      shown(t('Close tab'), 'CmdOrCtrl+W', h.closeTab, { registerAccelerator: true }),
      shown(t('Reopen closed tab'), 'CmdOrCtrl+Shift+T', h.reopenTab, { registerAccelerator: true }),
      { type: 'separator' },
      shown(t('Go to the address bar'), 'CmdOrCtrl+L', h.focusUrl),
      { type: 'separator' },
      { label: t('Quit'), click: h.quit },
    ] },
    { label: t('View'), submenu: [
      shown(t('Reload'), 'CmdOrCtrl+R', h.reload),
      shown(t('Reload without cache'), 'CmdOrCtrl+Shift+R', h.hardReload),
      { type: 'separator' },
      { label: t('Zoom in'), accelerator: 'CmdOrCtrl+Plus', click: () => h.zoom(0.5) },
      { label: t('Zoom out'), accelerator: 'CmdOrCtrl+-', click: () => h.zoom(-0.5) },
      { label: t('Actual size'), accelerator: 'CmdOrCtrl+0', click: () => h.zoom(0) },
      { type: 'separator' },
      { label: t('Full screen'), accelerator: 'F11', click: h.fullscreen },
      { label: t('Developer tools'), accelerator: 'F12', click: h.devtools },
    ] },
    { label: t('Bookmarks'), submenu: [
      shown(h.isBookmarked() ? t('Remove this page from bookmarks') : t('Bookmark this page'), 'CmdOrCtrl+D', h.toggleBookmark),
      shown(t('Show bookmarks bar'), 'CmdOrCtrl+Shift+B', h.toggleBar, { type: 'checkbox', checked: h.barShown() }),
      shown(t('Manage bookmarks'), 'CmdOrCtrl+Shift+O', h.manageBookmarks),
      { type: 'separator' },
      ...h.bookmarkItems(),
    ] },
    { label: t('Tools'), submenu: [
      { label: t('The model can act'), type: 'checkbox', checked: h.act(), click: i => h.setAct(i.checked) },
      shown(t('Fill in with Bitwarden'), 'CmdOrCtrl+Shift+L', h.bitwarden),
      { type: 'separator' },
      { label: t('Default search engine'), submenu: h.engines.map(e => ({ label: e.name, type: 'radio', checked: h.engine() === e.id, click: () => h.setEngine(e.id) })) },
    ] },
    { label: t('Settings'), submenu: [
      // Como en NSA: "Sistema" y cada idioma con su propio nombre, para encontrarlo aunque no se entienda el actual.
      { label: t('Language'), submenu: [
        { label: t('System'), type: 'radio', checked: h.language() === 'system', click: () => h.setLanguage('system') },
        { type: 'separator' },
        ...h.languages.map(l => ({ label: l.name, type: 'radio', checked: h.language() === l.code, click: () => h.setLanguage(l.code) })),
      ] },
      { type: 'separator' },
      { label: t('Update channel'), submenu: [
        { label: t('Stable'), type: 'radio', checked: !h.betas(), click: () => h.setBetas(false) },
        { label: t('Beta'), type: 'radio', checked: h.betas(), click: () => h.setBetas(true) },
      ] },
      { label: t('Check for updates now'), click: h.checkUpdates },
      { type: 'separator' },
      { label: t('Keep active even when the window is covered (restarts)'), type: 'checkbox', checked: h.keepActive(), click: i => h.setKeepActive(i.checked) },
    ] },
    { label: t('Help'), submenu: [
      { label: t('About LLM Browser'), click: h.about },
      { label: t('Project page'), click: h.openProject },
      { label: t('Open settings folder (mcp.json, settings)'), click: h.openConfig },
    ] },
  ];
};
