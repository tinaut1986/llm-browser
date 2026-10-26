const { app, BrowserWindow, WebContentsView, ipcMain, session } = require('electron');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const makeTools = require('./tools');

const TOP = 84; // alto de la barra de UI
const CONFIG_DIR = path.join(os.homedir(), '.llm-browser');
const PARTITION = 'persist:llmbrowser';

if (!app.requestSingleInstanceLock()) app.quit();

let win, ui;
let tabs = [];
let activeId = null;
let nextId = 1;
let actEnabled = true;

const activeTab = () => tabs.find(t => t.id === activeId);

function pushState() {
  if (!ui || ui.webContents.isDestroyed()) return;
  const t = activeTab();
  ui.webContents.send('state', {
    tabs: tabs.map(x => ({ id: x.id, title: x.title || x.url || 'Nueva pestaña', url: x.url, active: x.id === activeId, loading: x.loading })),
    act: actEnabled,
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
  w.on('did-start-loading', () => { t.loading = true; pushState(); });
  w.on('did-stop-loading', () => { t.loading = false; t.url = w.getURL(); pushState(); });
  w.on('console-message', (...a) => {
    const e = a[0];
    t.logs.push({ level: e.level ?? a[1], message: e.message ?? a[2] });
    if (t.logs.length > 500) t.logs.shift();
  });
  w.setWindowOpenHandler(({ url: u }) => { newTab(u); return { action: 'deny' }; });
  w.on('before-input-event', (ev, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta)) return;
    const k = input.key.toLowerCase();
    if (k === 't') { ev.preventDefault(); selectTab(newTab().id); ui.webContents.focus(); ui.webContents.send('focus-url'); }
    else if (k === 'w') { ev.preventDefault(); closeTab(t.id); }
    else if (k === 'l') { ev.preventDefault(); ui.webContents.focus(); ui.webContents.send('focus-url'); }
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
  if (!tabs.length) newTab('https://duckduckgo.com');
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
      case 'newtab': return selectTab(newTab('https://duckduckgo.com').id);
      case 'select': return selectTab(arg);
      case 'close': return closeTab(arg);
      case 'nav': return call('navigate', { url: arg }).catch(() => {}) && undefined;
      case 'back': return w?.navigationHistory.goBack();
      case 'forward': return w?.navigationHistory.goForward();
      case 'reload': return w?.reload();
      case 'act': actEnabled = !!arg; return pushState();
      case 'ready': return pushState();
    }
  });

  newTab('https://duckduckgo.com');
  startApi();
  layout();
});

app.on('window-all-closed', () => app.quit());
