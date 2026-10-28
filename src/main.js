const { app, BrowserWindow, WebContentsView, Menu, clipboard, ipcMain, session } = require('electron');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const makeTools = require('./tools');
const cursorScript = require('./cursor');
const ENGINES = require('./engines');

const TOP = 84; // alto de la barra de UI
const CONFIG_DIR = path.join(os.homedir(), '.llm-browser');
const PARTITION = 'persist:llmbrowser';

if (!app.requestSingleInstanceLock()) app.quit();

let win, ui;
let tabs = [];
let activeId = null;
let nextId = 1;
let actEnabled = true;

const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.json');
let engine = 'duckduckgo';
try {
  const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')).engine;
  if (ENGINES[saved]) engine = saved;
} catch {}
const homeUrl = () => ENGINES[engine].home;
function setEngine(id) {
  if (!ENGINES[id]) return;
  engine = id;
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ engine }));
  } catch {}
  pushState();
}

const activeTab = () => tabs.find(t => t.id === activeId);

function focusUrl() {
  ui.webContents.focus();
  ui.webContents.send('focus-url');
}

function pushState() {
  if (!ui || ui.webContents.isDestroyed()) return;
  const t = activeTab();
  ui.webContents.send('state', {
    tabs: tabs.map(x => ({ id: x.id, title: x.title || x.url || 'Nueva pestaña', url: x.url, active: x.id === activeId, loading: x.loading })),
    act: actEnabled,
    engine,
    engines: Object.entries(ENGINES).map(([id, e]) => ({ id, name: e.name })),
    canBack: !!t && t.view.webContents.navigationHistory.canGoBack(),
    canForward: !!t && t.view.webContents.navigationHistory.canGoForward(),
  });
}

function layout() {
  if (!win) return;
  const { width, height } = win.getContentBounds();
  ui.setBounds({ x: 0, y: 0, width, height: TOP });
  for (const t of tabs) t.view.setBounds({ x: 0, y: TOP, width, height: Math.max(0, height - TOP) });
}

function newTab(url = 'about:blank') {
  const view = new WebContentsView({ webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true } });
  const t = { id: nextId++, view, title: '', url, loading: false, logs: [] };
  const w = view.webContents;
  tabs.push(t);
  win.contentView.addChildView(view);
  w.on('page-title-updated', (_e, title) => { t.title = title; pushState(); });
  w.on('did-navigate', (_e, u) => { t.url = u; pushState(); });
  w.on('did-navigate-in-page', (_e, u) => { t.url = u; pushState(); });
  w.on('dom-ready', () => { if (t.cursor?.visible) w.executeJavaScript(cursorScript(t.cursor.x, t.cursor.y, 'move'), true).catch(() => {}); });
  w.on('did-start-loading', () => { t.loading = true; pushState(); });
  w.on('did-stop-loading', () => { t.loading = false; t.url = w.getURL(); pushState(); });
  w.on('console-message', (...a) => {
    const e = a[0];
    t.logs.push({ level: e.level ?? a[1], message: e.message ?? a[2] });
    if (t.logs.length > 500) t.logs.shift();
  });
  w.setWindowOpenHandler(({ url: u }) => { newTab(u); return { action: 'deny' }; });
  w.on('context-menu', (_e, p) => {
    const item = (label, click, enabled = true) => ({ label, click, enabled });
    const sep = { type: 'separator' };
    const nav = w.navigationHistory;
    const m = [];
    if (p.linkURL) m.push(item('Abrir enlace en pestaña nueva', () => newTab(p.linkURL)), item('Copiar dirección del enlace', () => clipboard.writeText(p.linkURL)), sep);
    if (p.mediaType === 'image') m.push(item('Abrir imagen en pestaña nueva', () => newTab(p.srcURL)), item('Copiar imagen', () => w.copyImageAt(p.x, p.y)), item('Copiar dirección de la imagen', () => clipboard.writeText(p.srcURL)), sep);
    if (p.isEditable) m.push(
      item('Cortar', () => w.cut(), p.editFlags.canCut),
      item('Copiar', () => w.copy(), p.editFlags.canCopy),
      item('Pegar', () => w.paste(), p.editFlags.canPaste),
      item('Seleccionar todo', () => w.selectAll(), p.editFlags.canSelectAll), sep);
    else if (p.selectionText) m.push(item('Copiar', () => w.copy()), sep);
    m.push(
      item('Atrás', () => nav.goBack(), nav.canGoBack()),
      item('Adelante', () => nav.goForward(), nav.canGoForward()),
      item('Recargar', () => w.reload()),
      sep,
      item('Inspeccionar', () => w.inspectElement(p.x, p.y)));
    Menu.buildFromTemplate(m).popup({ window: win });
  });
  w.on('before-input-event', (ev, input) => {
    if (input.type !== 'keyDown') return;
    const mod = input.control || input.meta;
    const k = input.key.toLowerCase();
    if (k === 'f5' || (mod && k === 'r')) {
      ev.preventDefault();
      if (input.shift || (mod && k === 'f5')) w.reloadIgnoringCache(); else w.reload();
      return;
    }
    if (k === 'f6') { ev.preventDefault(); focusUrl(); return; }
    if (!mod) return;
    if (k === 't') { ev.preventDefault(); selectTab(newTab().id); focusUrl(); }
    else if (k === 'w') { ev.preventDefault(); closeTab(t.id); }
    else if (k === 'l') { ev.preventDefault(); focusUrl(); }
  });
  layout();
  selectTab(t.id);
  if (url !== 'about:blank') w.loadURL(url).catch(() => {});
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

function closeTab(id) {
  const i = tabs.findIndex(t => t.id === id);
  if (i < 0) throw new Error('Pestaña inexistente: ' + id);
  const [t] = tabs.splice(i, 1);
  win.contentView.removeChildView(t.view);
  t.view.webContents.close();
  if (!tabs.length) newTab(homeUrl());
  else if (activeId === id) selectTab(tabs[Math.max(0, i - 1)].id);
  pushState();
}

const call = makeTools({
  tabs: () => tabs.map(t => ({ id: t.id, active: t.id === activeId, title: t.title, url: t.url })),
  active: activeTab,
  newTab: (u) => newTab(u),
  closeTab,
  select: selectTab,
  isActEnabled: () => actEnabled,
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

app.whenReady().then(() => {
  win = new BrowserWindow({ width: 1280, height: 860, title: 'LLM Browser', backgroundColor: '#1e1f24' });
  win.removeMenu();
  ui = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true } });
  win.contentView.addChildView(ui);
  ui.webContents.loadFile(path.join(__dirname, 'ui.html'));
  win.on('resize', layout);
  win.on('closed', () => app.quit());

  ipcMain.handle('cmd', (_e, cmd, arg) => {
    const w = activeTab()?.view.webContents;
    switch (cmd) {
      case 'newtab': return selectTab(newTab(homeUrl()).id);
      case 'select': return selectTab(arg);
      case 'close': return closeTab(arg);
      case 'nav': return call('navigate', { url: arg }).catch(() => {}) && undefined;
      case 'back': return w?.navigationHistory.goBack();
      case 'forward': return w?.navigationHistory.goForward();
      case 'reload': return w?.reload();
      case 'engine': return setEngine(arg);
      case 'act': actEnabled = !!arg; return pushState();
      case 'ready': return pushState();
    }
  });

  newTab(homeUrl());
  startApi();
  layout();
});

app.on('window-all-closed', () => app.quit());
