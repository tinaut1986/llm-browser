const { app, BrowserWindow, WebContentsView, Menu, clipboard, dialog, ipcMain, session, shell } = require('electron');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const makeTools = require('./tools');
const cursorScript = require('./cursor');
const ENGINES = require('./engines');
const Bitwarden = require('./bitwarden');
const { fillLogin, typeFocused } = require('./autofill');
const startUpdater = require('./updater');
const menuTemplate = require('./menu');
const Bookmarks = require('./bookmarks');
const I18n = require('./i18n');

const TOP = 84; // alto de la barra de UI
const CONFIG_DIR = path.join(os.homedir(), '.llm-browser');
const PARTITION = 'persist:llmbrowser';

// Una segunda instancia debe salir sin tocar nada (api.json es de la primera) y traer la ventana al frente.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.exit(0);
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
// AppImage no trae chrome-sandbox con setuid. Solo se desactiva el sandbox si el kernel tampoco permite el sandbox por user namespaces.
function userNamespacesAvailable() {
  const read = f => { try { return fs.readFileSync(f, 'utf8').trim(); } catch { return null; } };
  return read('/proc/sys/kernel/unprivileged_userns_clone') !== '0' && read('/proc/sys/kernel/apparmor_restrict_unprivileged_userns') !== '1';
}
if (process.platform === 'linux' && process.env.APPIMAGE && !userNamespacesAvailable()) app.commandLine.appendSwitch('no-sandbox');

let win, ui;
let tabs = [];
let activeId = null;
let nextId = 1;
let actEnabled = true;

const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.json');
let settings = {};
try { settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch {}
const saveSettings = () => {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings));
  } catch {}
};
// "Mantener activo": si Windows da la ventana por tapada (u otra app delante), Chromium deja de pintar
// la página, retiene los eventos de ratón del modelo y llega a perder pulsaciones. Estas opciones solo
// valen al arrancar, así que cambiarlo reinicia el navegador (reabriendo las pestañas).
if (settings.keepActive) {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
}
function setKeepActive(on) {
  on = !!on;
  if (on === !!settings.keepActive) return `Mantener activo ya estaba ${on ? 'activado' : 'desactivado'}; no hace falta reiniciar.`;
  settings.keepActive = on;
  settings.restoreTabs = { urls: tabs.map(t => t.url || 'about:blank'), active: tabs.findIndex(t => t.id === activeId) };
  saveSettings();
  setTimeout(() => { app.relaunch(); app.quit(); }, 300);
  return `Mantener activo ${on ? 'activado' : 'desactivado'}. El navegador se reinicia ahora y reabre las ${tabs.length} pestañas; espera unos segundos antes de la siguiente acción.`;
}
// ---- Idioma de la interfaz (Ajustes -> Idioma; "system" sigue al sistema) ----
let lang = 'en';
let tr = I18n.translator('en');
function applyLanguage() {
  lang = I18n.resolve(settings.language, app.getPreferredSystemLanguages());
  tr = I18n.translator(lang);
}
function setLanguage(code) {
  settings.language = I18n.CODES.has(code) ? code : 'system';
  saveSettings();
  applyLanguage();
  refreshMenu();
  // Las ventanas de la interfaz se recargan para tomar los textos nuevos; las páginas no se tocan.
  if (ui && !ui.webContents.isDestroyed()) ui.webContents.reload();
  if (manager && !manager.isDestroyed()) { manager.setTitle(tr('Bookmark manager')); manager.webContents.reload(); }
  updater?.setLanguage(lang);
}
let engine = ENGINES[settings.engine] ? settings.engine : 'duckduckgo';
const homeUrl = () => ENGINES[engine].home;
function setEngine(id) {
  if (!ENGINES[id]) return;
  engine = settings.engine = id;
  saveSettings();
  pushState();
  refreshMenu();
}

const activeTab = () => tabs.find(t => t.id === activeId);

// ---- Bookmarks: tree in settings.bookmarks, bar under the address bar, manager window ----
settings.bookmarks = Bookmarks.normalize(settings.bookmarks);
const BAR_H = 30;
const barShown = () => settings.bookmarksBar !== false;
const FIND_H = 40; // alto extra de la barra de búsqueda (Ctrl+F)
let findOpen = false;
const uiHeight = () => TOP + (barShown() ? BAR_H : 0) + (findOpen ? FIND_H : 0);
const isBookmarked = url => Bookmarks.hasUrl(settings.bookmarks, url);
let manager = null;

function pushManager() {
  if (manager && !manager.isDestroyed()) manager.webContents.send('bm-state', settings.bookmarks);
}

function bookmarksChanged() {
  saveSettings();
  pushState();
  pushManager();
  refreshMenu();
}

function toggleBar() {
  settings.bookmarksBar = !barShown();
  saveSettings();
  layout();
  pushState();
  refreshMenu();
}

function toggleBookmark() {
  const t = activeTab();
  if (!t || !/^https?:\/\//i.test(t.url)) return;
  if (!Bookmarks.removeByUrl(settings.bookmarks, t.url)) Bookmarks.addBookmark(settings.bookmarks, { title: t.title, url: t.url });
  bookmarksChanged();
}

function openManager(selectId) {
  if (manager && !manager.isDestroyed()) {
    manager.focus();
    if (selectId) manager.webContents.send('bm-select', selectId);
    return;
  }
  manager = new BrowserWindow({ parent: win, width: 820, height: 560, minWidth: 560, minHeight: 360, title: tr('Bookmark manager'), backgroundColor: '#1e1f24',
    webPreferences: { preload: path.join(__dirname, 'bm-preload.js'), contextIsolation: true, sandbox: true } });
  manager.removeMenu();
  manager.loadFile(path.join(__dirname, 'bookmarks.html'));
  if (selectId) manager.webContents.once('did-finish-load', () => manager.webContents.send('bm-select', selectId));
  manager.on('closed', () => { manager = null; });
}

const openBookmark = (url, inNewTab) => (inNewTab ? newTab(url) : call('navigate', { url }, { user: true }).catch(() => {}));
const menuLabel = s => (s.length > 60 ? s.slice(0, 57) + '…' : s).replace(/&/g, '&&');

function folderItems(folder) {
  const urls = Bookmarks.urls(folder);
  return [...bookmarkItems(folder.children), ...(urls.length ? [{ type: 'separator' }, { label: tr('Open all in tabs'), click: () => urls.forEach(u => newTab(u)) }] : [])];
}

function bookmarkItems(nodes) {
  if (!nodes.length) return [{ label: tr('(empty)'), enabled: false }];
  return nodes.map(n => (n.type === 'folder'
    ? { label: menuLabel(n.title), submenu: folderItems(n) }
    : { label: menuLabel(n.title), toolTip: n.url, click: () => openBookmark(n.url) }));
}

function newFolder(parentId = null) {
  const folder = Bookmarks.addFolder(settings.bookmarks, tr('New folder'), parentId);
  bookmarksChanged();
  openManager(folder.id); // the manager opens with the name selected so it can be typed right away
}

function bookmarkContextMenu(id) {
  const node = id ? Bookmarks.find(settings.bookmarks, id)?.node : null;
  const m = [];
  if (node?.type === 'bookmark') m.push({ label: tr('Open'), click: () => openBookmark(node.url) }, { label: tr('Open in new tab'), click: () => openBookmark(node.url, true) });
  if (node?.type === 'folder') m.push({ label: tr('Open all in tabs'), enabled: Bookmarks.urls(node).length > 0, click: () => Bookmarks.urls(node).forEach(u => newTab(u)) });
  if (node) m.push(
    { label: tr('Edit…'), click: () => openManager(node.id) },
    { label: tr('Delete'), click: () => { Bookmarks.remove(settings.bookmarks, node.id); bookmarksChanged(); } },
    { type: 'separator' });
  m.push({ label: tr('New folder'), click: () => newFolder() }, { label: tr('Manage bookmarks'), click: () => openManager() }, { label: tr('Hide bookmarks bar'), click: toggleBar });
  Menu.buildFromTemplate(m).popup({ window: win });
}

// Typed addresses get https:// when they have no scheme; only http(s) bookmarks are accepted.
const bookmarkUrl = u => {
  const s = String(u ?? '').trim();
  const full = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : 'https://' + s;
  return /^https?:\/\/./i.test(full) ? full : null;
};

// Everything the bar, the manager and the menus can ask for. Invalid requests (a folder dropped into itself...) are ignored.
function bookmarkOp(a) {
  const tree = settings.bookmarks;
  const parentId = a.parentId ?? null;
  let id;
  try {
    switch (a.op) {
      case 'list': return tree;
      case 'manager': return openManager(a.id);
      case 'toggleBar': return toggleBar();
      case 'ctx': return bookmarkContextMenu(a.id);
      case 'newFolder': return newFolder(parentId);
      case 'open': { const n = Bookmarks.find(tree, a.id)?.node; if (n?.type === 'bookmark') openBookmark(n.url, a.newTab); return; }
      case 'folderMenu': {
        const n = Bookmarks.find(tree, a.id)?.node;
        if (n?.type === 'folder') Menu.buildFromTemplate(folderItems(n)).popup({ window: win, x: a.x, y: a.y });
        return;
      }
      case 'add': {
        const url = bookmarkUrl(a.url ?? 'https://example.com');
        if (!url) return;
        const title = String(a.title || '') || tabs.find(t => t.url === url)?.title || url;
        id = Bookmarks.addBookmark(tree, { title, url }, parentId, a.index ?? undefined).id;
        break;
      }
      case 'addFolder': id = Bookmarks.addFolder(tree, String(a.title || ''), parentId, a.index ?? undefined).id; break;
      case 'update': Bookmarks.update(tree, a.id, { title: a.title, url: a.url == null ? undefined : bookmarkUrl(a.url) ?? undefined }); break;
      case 'remove': Bookmarks.remove(tree, a.id); break;
      case 'move': Bookmarks.move(tree, a.id, parentId, a.index ?? undefined); break;
      default: return;
    }
  } catch { return; }
  bookmarksChanged();
  return id;
}

// Devolver el teclado a la pestaña activa. Justo tras mostrar una vista que estaba oculta (o recién creada, o
// cargando una página) el focus() inmediato puede perderse: se reintenta un instante después, salvo que
// mientras tanto el usuario haya pedido el foco en la barra de direcciones o en el buscador.
let focusSeq = 0;
function focusPage() {
  const seq = ++focusSeq;
  const go = () => {
    if (seq !== focusSeq || !win || win.isDestroyed() || !win.isFocused()) return;
    const t = activeTab();
    if (t && !t.view.webContents.isDestroyed()) t.view.webContents.focus();
  };
  go();
  setTimeout(go, 50);
  setTimeout(go, 250);
}

function focusUrl() {
  focusSeq++;
  ui.webContents.focus();
  ui.webContents.send('focus-url');
}

function pushState() {
  if (!ui || ui.webContents.isDestroyed()) return;
  const t = activeTab();
  ui.webContents.send('state', {
    tabs: tabs.map(x => ({ id: x.id, title: x.title || x.url || tr('New tab'), url: x.url, active: x.id === activeId, loading: x.loading })),
    act: actEnabled,
    bookmarked: !!t && isBookmarked(t.url),
    bookmarks: settings.bookmarks,
    bookmarksBar: barShown(),
    engine,
    engines: Object.entries(ENGINES).map(([id, e]) => ({ id, name: e.name })),
    canBack: !!t && t.view.webContents.navigationHistory.canGoBack(),
    canForward: !!t && t.view.webContents.navigationHistory.canGoForward(),
  });
}

function layout() {
  if (!win) return;
  const { width, height } = win.getContentBounds();
  ui.setBounds({ x: 0, y: 0, width, height: uiHeight() });
  for (const t of tabs) t.view.setBounds({ x: 0, y: uiHeight(), width, height: Math.max(0, height - uiHeight()) });
}

function openFind() {
  focusSeq++;
  findOpen = true;
  layout();
  ui.webContents.focus();
  ui.webContents.send('find-open');
}

function closeFind() {
  if (!findOpen) return;
  findOpen = false;
  for (const t of tabs) t.view.webContents.stopFindInPage('clearSelection');
  layout();
  ui.webContents.send('find-close');
  focusPage();
}

function findText(text, opts = {}) {
  const w = activeTab()?.view.webContents;
  if (!w) return;
  if (!text) { w.stopFindInPage('clearSelection'); ui.webContents.send('find-result', { active: 0, total: 0 }); return; }
  w.findInPage(text, { forward: opts.forward !== false, findNext: !!opts.findNext, matchCase: !!opts.matchCase });
}

function newTab(url = 'about:blank') {
  const view = new WebContentsView({ webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, preload: path.join(__dirname, 'page-preload.js') } });
  const t = { id: nextId++, view, title: '', url, loading: false, logs: [] };
  const w = view.webContents;
  tabs.push(t);
  win.contentView.addChildView(view);
  w.on('page-title-updated', (_e, title) => { t.title = title; pushState(); });
  w.on('did-navigate', (_e, u) => { t.url = u; t.secrets = false; pushState(); });
  w.on('did-navigate-in-page', (_e, u) => { t.url = u; pushState(); });
  w.on('dom-ready', () => { if (t.cursor?.visible) w.executeJavaScript(cursorScript(t.cursor.x, t.cursor.y, 'move'), true).catch(() => {}); });
  w.on('did-start-loading', () => { t.loading = true; pushState(); });
  w.on('did-stop-loading', () => { t.loading = false; t.url = w.getURL(); pushState(); });
  w.on('console-message', (...a) => {
    const e = a[0];
    t.logs.push({ level: e.level ?? a[1], message: e.message ?? a[2] });
    if (t.logs.length > 500) t.logs.shift();
  });
  w.setWindowOpenHandler(({ url: u }) => { if (/^(https?|about):/i.test(u)) newTab(u); return { action: 'deny' }; });
  w.on('context-menu', (_e, p) => {
    const item = (label, click, enabled = true) => ({ label, click, enabled });
    const sep = { type: 'separator' };
    const nav = w.navigationHistory;
    const m = [];
    if (p.linkURL) m.push(item(tr('Open link in new tab'), () => newTab(p.linkURL)), item(tr('Copy link address'), () => clipboard.writeText(p.linkURL)), sep);
    if (p.mediaType === 'image') m.push(item(tr('Open image in new tab'), () => newTab(p.srcURL)), item(tr('Copy image'), () => w.copyImageAt(p.x, p.y)), item(tr('Copy image address'), () => clipboard.writeText(p.srcURL)), sep);
    if (p.isEditable) m.push(
      item(tr('Cut'), () => w.cut(), p.editFlags.canCut),
      item(tr('Copy'), () => w.copy(), p.editFlags.canCopy),
      item(tr('Paste'), () => w.paste(), p.editFlags.canPaste),
      item(tr('Select all'), () => w.selectAll(), p.editFlags.canSelectAll), sep);
    else if (p.selectionText) m.push(item(tr('Copy'), () => w.copy()), sep);
    m.push(
      item(tr('Back'), () => nav.goBack(), nav.canGoBack()),
      item(tr('Forward'), () => nav.goForward(), nav.canGoForward()),
      item(tr('Reload'), () => w.reload()),
      sep,
      item(tr('Inspect'), () => w.inspectElement(p.x, p.y)));
    Menu.buildFromTemplate(m).popup({ window: win });
  });
  w.on('found-in-page', (_e, r) => {
    if (activeTab()?.view.webContents === w) ui.webContents.send('find-result', { active: r.activeMatchOrdinal, total: r.matches });
  });
  w.on('before-input-event', (ev, input) => {
    if (input.type !== 'keyDown') return;
    const mod = input.control || input.meta;
    const k = input.key.toLowerCase();
    if (mod && k === 'f') { ev.preventDefault(); openFind(); return; }
    if (k === 'escape' && findOpen) { ev.preventDefault(); closeFind(); return; }
    if (k === 'f5' || (mod && k === 'r')) {
      ev.preventDefault();
      if (input.shift || (mod && k === 'f5')) w.reloadIgnoringCache(); else w.reload();
      return;
    }
    if (mod && input.shift && k === 'l') { ev.preventDefault(); bitwardenFlow(); return; }
    if (mod && !input.shift && k === 'd') { ev.preventDefault(); toggleBookmark(); return; }
    if (mod && input.shift && k === 'b') { ev.preventDefault(); toggleBar(); return; }
    if (mod && input.shift && k === 'o') { ev.preventDefault(); openManager(); return; }
    if (k === 'f6') { ev.preventDefault(); focusUrl(); return; }
    if (!mod) return;
    if (k === 'tab') { ev.preventDefault(); cycleTab(input.shift ? -1 : 1); return; }
    if (k === 't' && input.shift) { ev.preventDefault(); reopenTab(); }
    else if (k === 't') { ev.preventDefault(); selectTab(newTab().id); focusUrl(); }
    else if (k === 'w') { ev.preventDefault(); closeTab(t.id); }
    else if (k === 'l') { ev.preventDefault(); focusUrl(); }
  });
  layout();
  selectTab(t.id);
  // También about:blank: una vista que nunca ha navegado no tiene renderer vivo, no puede recibir el foco al hacer
  // clic y entonces ni Ctrl+T ni Ctrl+W llegan a ninguna parte.
  w.loadURL(url).catch(() => {});
  return t;
}

function selectTab(id) {
  if (!tabs.some(t => t.id === id)) throw new Error('Pestaña inexistente: ' + id);
  activeId = id;
  for (const t of tabs) {
    t.view.setVisible(t.id === id);
    t.active = t.id === id;
  }
  const t = activeTab();
  win.contentView.addChildView(t.view); // traer al frente
  pushState();
}

// ---- Bitwarden: lo dispara solo el usuario (botón o Ctrl+Mayús+L); el modelo no tiene herramienta para ello y nunca ve los secretos ----
const bw = new Bitwarden();
let bwBusy = false;

function askUnlock() {
  return new Promise(resolve => {
    const d = new BrowserWindow({ parent: win, modal: true, width: 360, height: 190, resizable: false, minimizable: false, title: 'Bitwarden', backgroundColor: '#1e1f24',
      webPreferences: { preload: path.join(__dirname, 'bw-preload.js'), contextIsolation: true, sandbox: true } });
    d.removeMenu();
    d.loadFile(path.join(__dirname, 'bw-unlock.html'));
    let ok = false, trying = false;
    const onPw = async (_e, pw) => {
      if (trying) return;
      trying = true;
      try { await bw.unlock(pw); ok = true; d.close(); }
      catch (e) { d.webContents.send('bw-error', e.message.split('\n')[0]); }
      trying = false;
    };
    const onCancel = () => d.close();
    ipcMain.on('bw-pw', onPw);
    ipcMain.on('bw-cancel', onCancel);
    d.on('closed', () => { ipcMain.removeListener('bw-pw', onPw); ipcMain.removeListener('bw-cancel', onCancel); resolve(ok); });
  });
}

const note = (message, detail) => dialog.showMessageBox(win, { type: 'info', title: 'Bitwarden', message, detail, buttons: [tr('OK')] });

async function bitwardenFlow() {
  if (bwBusy) return;
  bwBusy = true;
  try {
    if (!(await bw.available())) {
      return await note(tr('The Bitwarden CLI (bw) was not found'), tr('The desktop app is not enough for this; the CLI is needed.\n\nInstall it with:\n  {npm}\nor\n  {snap}\n\nThen sign in once in a terminal with:\n  {login}\n\nIf it is installed somewhere else, start the browser with {env}.', { npm: 'npm install -g @bitwarden/cli', snap: 'sudo snap install bw', login: 'bw login', env: 'BW_PATH=/path/to/bw' }));
    }
    let st = await bw.status();
    if (st === 'unauthenticated') return await note(tr('You are not signed in to Bitwarden'), tr('Run this once in a terminal:\n  {login}\nand press 🔑 again.', { login: 'bw login' }));
    if (st === 'locked' && !(await askUnlock())) return;
    const t = activeTab();
    const items = await bw.logins(t.view.webContents.getURL());
    const w = t.view.webContents;
    const menu = items.map(i => ({
      label: i.username ? `${i.name} — ${i.username}` : i.name,
      click: () => run(async () => {
        const done = await fillLogin(w, await bw.credentials(i.id));
        if (done.password) t.secrets = true;
        if (!done.username && !done.password) await note(tr('No login form is visible on this page'));
      }),
    }));
    for (const i of items.filter(x => x.hasTotp)) menu.push({ label: tr('2FA code: {name}', { name: i.name }), click: () => run(async () => {
      if (await typeFocused(w, await bw.totp(i.id))) t.secrets = true;
      else await note(tr('Click the code field first and press 🔑 again'));
    }) });
    if (!menu.length) menu.push({ label: tr('No accounts for this site'), enabled: false });
    menu.push({ type: 'separator' }, { label: tr('Lock vault'), click: () => bw.lock() });
    Menu.buildFromTemplate(menu).popup({ window: win });
  } catch (e) {
    dialog.showErrorBox('Bitwarden', e.message);
  } finally {
    bwBusy = false;
  }
}

// ---- Menú superior y ajustes (canal de actualizaciones estable / beta) ----
let updater = null;
// Sin elección del usuario, una beta instalada sigue ofreciendo betas (como los ports de 3DS).
const wantsBetas = () => settings.betas ?? require('../package.json').channel === 'beta';

function setBetas(value) {
  settings.betas = !!value;
  saveSettings();
  updater?.setBetas(settings.betas);
  refreshMenu();
}

// Comprobación manual: abre la ventana del actualizador, que muestra la búsqueda y su resultado.
const checkUpdatesNow = () => updater?.checkNow();

function setAct(on) {
  actEnabled = !!on;
  pushState();
  refreshMenu();
}

function refreshMenu() {
  const wc = () => activeTab()?.view.webContents;
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate({
    t: tr,
    languages: I18n.LANGUAGES,
    language: () => (I18n.CODES.has(settings.language) ? settings.language : 'system'),
    setLanguage,
    newTab: () => { selectTab(newTab(homeUrl()).id); focusUrl(); },
    closeTab: () => closeTab(activeId),
    reopenTab,
    focusUrl,
    isBookmarked: () => { const t = activeTab(); return !!t && isBookmarked(t.url); },
    toggleBookmark,
    barShown,
    toggleBar,
    manageBookmarks: () => openManager(),
    bookmarkItems: () => bookmarkItems(settings.bookmarks),
    quit: () => app.quit(),
    reload: () => wc()?.reload(),
    hardReload: () => wc()?.reloadIgnoringCache(),
    zoom: d => { const w = wc(); if (w) w.setZoomLevel(d === 0 ? 0 : w.getZoomLevel() + d); },
    fullscreen: () => win.setFullScreen(!win.isFullScreen()),
    devtools: () => wc()?.toggleDevTools(),
    act: () => actEnabled,
    setAct,
    bitwarden: bitwardenFlow,
    engines: Object.entries(ENGINES).map(([id, e]) => ({ id, name: e.name })),
    engine: () => engine,
    setEngine,
    betas: wantsBetas,
    setBetas,
    checkUpdates: checkUpdatesNow,
    keepActive: () => !!settings.keepActive,
    setKeepActive,
    about: () => dialog.showMessageBox(win, { type: 'info', title: 'LLM Browser', message: 'LLM Browser ' + app.getVersion(), detail: tr('A browser that an LLM can see and control through MCP.') + '\nhttps://github.com/tinaut1986/llm-browser', buttons: [tr('OK')] }),
    openProject: () => shell.openExternal('https://github.com/tinaut1986/llm-browser'),
    openConfig: () => { fs.mkdirSync(CONFIG_DIR, { recursive: true }); shell.openPath(CONFIG_DIR); },
  })));
}

const run = fn => fn().catch(e => dialog.showErrorBox('Bitwarden', e.message));

function cycleTab(dir) {
  if (tabs.length < 2) return;
  const i = tabs.findIndex(t => t.id === activeId);
  selectTab(tabs[(i + dir + tabs.length) % tabs.length].id);
  focusPage(); // si no, el teclado se queda en la pestaña ya oculta
}

function closeTab(id) {
  const i = tabs.findIndex(t => t.id === id);
  if (i < 0) throw new Error('Pestaña inexistente: ' + id);
  const wasActive = activeId === id;
  const [t] = tabs.splice(i, 1);
  if (t.url && t.url !== 'about:blank') { closedTabs.push(t.url); if (closedTabs.length > 25) closedTabs.shift(); }
  win.contentView.removeChildView(t.view);
  t.view.webContents.close();
  if (!tabs.length) newTab(homeUrl());
  else if (activeId === id) selectTab(tabs[Math.max(0, i - 1)].id);
  // la pestaña cerrada tenía el foco del teclado; sin esto Ctrl+W/Ctrl+T dejan de funcionar hasta hacer clic
  if (wasActive) focusPage();
  pushState();
}

// Ctrl+Mayús+T: reabre la última pestaña cerrada (solo recuerda URLs reales, no pestañas en blanco).
const closedTabs = [];
function reopenTab() {
  const url = closedTabs.pop();
  if (!url) return;
  selectTab(newTab(url).id);
  focusPage();
}

const call = makeTools({
  tabs: () => tabs.map(t => ({ id: t.id, active: t.id === activeId, title: t.title, url: t.url })),
  active: activeTab,
  newTab: (u) => newTab(u),
  closeTab,
  select: selectTab,
  isActEnabled: () => actEnabled,
  keepActive: () => !!settings.keepActive,
  setKeepActive,
  searchUrl: q => ENGINES[engine].search.replace('%s', encodeURIComponent(q)),
});

function startApi() {
  const token = crypto.randomBytes(24).toString('hex');
  const srv = http.createServer((req, res) => {
    const reply = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method !== 'POST' || req.headers.authorization !== 'Bearer ' + token) return reply(401, { ok: false, error: 'no autorizado' });
    let body = '';
    req.on('data', d => { body += d; if (body.length > 5e6) req.destroy(); });
    req.on('end', async () => {
      try {
        const { tool, args } = JSON.parse(body);
        reply(200, { ok: true, ...(await call(tool, args)) });
      } catch (e) {
        reply(200, { ok: false, error: e.message });
      }
    });
  });
  srv.listen(0, '127.0.0.1', () => {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(path.join(CONFIG_DIR, 'api.json'), JSON.stringify({ port: srv.address().port, token, pid: process.pid }), { mode: 0o600 });
  });
  app.on('quit', () => { try { fs.unlinkSync(path.join(CONFIG_DIR, 'api.json')); } catch {} });
}

// Comando listo para registrar el MCP con la app instalada (la ruta depende de dónde esté instalada).
function writeMcpSnippet() {
  if (!app.isPackaged) return;
  const cmd = { command: process.execPath, args: [path.join(process.resourcesPath, 'app.asar', 'src', 'mcp.js')], env: { ELECTRON_RUN_AS_NODE: '1' } };
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(path.join(CONFIG_DIR, 'mcp.json'), JSON.stringify({ mcpServers: { 'llm-browser': cmd } }, null, 2));
  } catch {}
}


app.whenReady().then(() => {
  if (!gotLock) return;
  applyLanguage();
  // Las ventanas de la interfaz (barra, marcadores, Bitwarden, actualizador) piden sus textos al cargar.
  ipcMain.on('i18n', e => { e.returnValue = { lang, dict: I18n.dict(lang) }; });
  win = new BrowserWindow({ width: 1280, height: 860, title: 'LLM Browser', backgroundColor: '#1e1f24', icon: path.join(__dirname, '..', 'build', 'icon.png') });
  refreshMenu();
  ui = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true } });
  win.contentView.addChildView(ui);
  ui.webContents.loadFile(path.join(__dirname, 'ui.html'));
  win.on('resize', layout);
  win.on('closed', () => app.quit());

  ipcMain.handle('cmd', (_e, cmd, arg) => {
    const w = activeTab()?.view.webContents;
    switch (cmd) {
      case 'newtab': return selectTab(newTab(homeUrl()).id);
      case 'select': selectTab(arg); return focusPage();
      case 'close': return closeTab(arg);
      case 'nav': call('navigate', { url: arg }, { user: true }).catch(() => {}); return;
      case 'back': return w?.navigationHistory.goBack();
      case 'forward': return w?.navigationHistory.goForward();
      case 'reload': return w?.reload();
      case 'engine': return setEngine(arg);
      case 'bw': return bitwardenFlow();
      case 'bookmark': return toggleBookmark();
      case 'bm': return bookmarkOp(arg);
      case 'cycle': return cycleTab(arg);
      case 'reopen': return reopenTab();
      case 'act': return setAct(arg);
      case 'find': return findText(arg.text, arg);
      case 'findopen': return openFind();
      case 'findclose': return closeFind();
      case 'ready': return pushState();
    }
  });

  ipcMain.handle('bm', (_e, a) => bookmarkOp(a));

  // Tras reiniciar por "Mantener activo" se reabren las pestañas que había (la sesión y las cookies ya persisten).
  const restore = settings.restoreTabs;
  if (restore) { delete settings.restoreTabs; saveSettings(); }
  const reopened = (restore?.urls || []).filter(u => /^(https?|about):/i.test(u)).map(u => newTab(u));
  if (reopened.length) selectTab((reopened[restore.active] || reopened[0]).id);
  else newTab(homeUrl());
  startApi();
  layout();
  writeMcpSnippet();
  updater = startUpdater({ betas: wantsBetas(), lang, parent: () => win });
});

app.on('window-all-closed', () => app.quit());
