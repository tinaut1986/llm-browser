// Auto-actualización desde GitHub Releases (electron-updater), con ventana propia (updater.html).
// Windows (instalador NSIS) y Linux (AppImage) se descargan e instalan solos; macOS no está firmado,
// así que ahí (y con el .deb) solo se avisa y se abre la página de la versión.
//
// Novedades: como en NSA, un archivo por versión e idioma en docs/release-notes/ (vX.Y.Z.md en inglés,
// vX.Y.Z.<código>.md en los demás). La traducción se lee de main en GitHub (se puede corregir después
// de publicar); si falta, el bloque en inglés <!-- llmb-notes --> del cuerpo de la release.
//
// Para ver la ventana sin publicar nada (solo en desarrollo): LLMB_UPDATER_DEMO=<carpeta con vX.Y.Z*.md>
// simula una descarga de la versión más alta de esa carpeta con sus notas.
const { app, BrowserWindow, ipcMain, shell, net } = require('electron');
const fs = require('fs');
const path = require('path');
const semver = require('semver');
const I18n = require('./i18n');

const RELEASES = 'https://github.com/tinaut1986/llm-browser/releases';
const API = 'https://api.github.com/repos/tinaut1986/llm-browser/releases?per_page=30';
const RAW_NOTES = 'https://raw.githubusercontent.com/tinaut1986/llm-browser/main/docs/release-notes/';
const CHECK_EVERY = 6 * 3600 * 1000;

// Líneas "- ..." de unas notas (sin marcas de Markdown); si no hay viñetas, las líneas de texto.
function noteLines(md) {
  const lines = String(md || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const bullets = lines.filter(l => /^[-*] /.test(l)).map(l => l.slice(2));
  return (bullets.length ? bullets : lines.filter(l => !/^#/.test(l))).map(l => l.replace(/[*`]/g, '').trim()).filter(Boolean);
}

const bodyBlock = body => {
  const m = String(body || '').match(/<!-- llmb-notes -->([\s\S]*?)<!-- \/llmb-notes -->/) || String(body || '').match(/## Changelog([\s\S]*)/);
  return m ? m[1] : '';
};

async function fetchText(url) {
  try { const r = await net.fetch(url); return r.ok ? await r.text() : null; } catch { return null; }
}

// Releases del canal más nuevas que la instalada, la más nueva primero. Estable: solo estables (sus notas
// ya incluyen las betas de en medio). Con betas: todas. -> [{ version, beta, lines, translated }]
async function fetchNotes({ betas, lang, current }) {
  let releases;
  try { releases = await (await net.fetch(API, { headers: { accept: 'application/vnd.github+json' } })).json(); } catch { return null; }
  const list = (Array.isArray(releases) ? releases : []).filter(r => {
    const v = semver.valid(r.tag_name);
    return v && !r.draft && (betas || !r.prerelease) && semver.gt(v, current);
  });
  const notes = await Promise.all(list.map(async r => {
    const own = lang !== 'en' ? await fetchText(`${RAW_NOTES}${r.tag_name}.${lang}.md`) : null;
    const lines = noteLines(own || bodyBlock(r.body));
    return { version: semver.valid(r.tag_name), beta: !!r.prerelease, lines, translated: lang === 'en' || !!(own && lines.length) };
  }));
  return notes.sort((a, b) => semver.rcompare(a.version, b.version));
}

// Lo mismo desde una carpeta local (modo demo).
function localNotes(dir, lang, current) {
  const versions = [...new Set(fs.readdirSync(dir).map(f => (f.match(/^v(\d+\.\d+\.\d+)(?:\.\w+)?\.md$/) || [])[1]).filter(Boolean))]
    .filter(v => semver.gt(v, current)).sort(semver.rcompare);
  const read = f => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return null; } };
  return versions.map(v => {
    const own = lang !== 'en' ? read(`v${v}.${lang}.md`) : null;
    return { version: v, beta: false, lines: noteLines(own || read(`v${v}.md`)), translated: lang === 'en' || !!own };
  });
}

// Devuelve { setBetas(bool), setLanguage(code), checkNow() }.
module.exports = function startUpdater({ betas, lang, parent, beforeInstall = () => {} }) {
  const demoDir = !app.isPackaged && process.env.LLMB_UPDATER_DEMO;
  const enabled = app.isPackaged || !!demoDir;
  const auto = !!demoDir || process.platform === 'win32' || (process.platform === 'linux' && !!process.env.APPIMAGE);
  const autoUpdater = app.isPackaged ? require('electron-updater').autoUpdater : null;
  let t = I18n.translator(lang);

  // phase: idle | checking | none | disabled | error | downloading | manual | ready | installing
  const state = { phase: 'idle', current: app.getVersion(), version: null, progress: null, error: null, notes: null, notesFailed: false };
  let win = null, manual = false, shownFor = null, notesFor = null;

  // Sin novedades que enseñar (buscando, al día, error al comprobar) la ventana es solo la cabecera.
  const compact = () => ['idle', 'checking', 'none', 'disabled'].includes(state.phase) || (state.phase === 'error' && !state.version);
  const SIZE = { full: [560, 540], compact: [560, 190] };
  let shape = null;
  const fit = () => {
    const want = compact() ? 'compact' : 'full';
    if (!win || win.isDestroyed() || shape === want) return;
    shape = want;
    win.setMinimumSize(420, want === 'compact' ? 190 : 360);
    win.setContentSize(...SIZE[want]);
  };
  const push = () => { if (win && !win.isDestroyed()) { fit(); win.webContents.send('upd-state', state); } };
  const set = patch => { Object.assign(state, patch); push(); };

  async function loadNotes(force = false) {
    if (!state.version || (!force && notesFor === state.version + lang)) return;
    notesFor = state.version + lang;
    set({ notes: null, notesFailed: false });
    const notes = demoDir ? localNotes(demoDir, lang, state.current) : await fetchNotes({ betas, lang, current: state.current });
    set(notes ? { notes } : { notesFailed: true });
  }

  function show() {
    if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); push(); return; }
    shape = compact() ? 'compact' : 'full';
    const [width, height] = SIZE[shape];
    win = new BrowserWindow({
      parent: parent(), width, height, useContentSize: true, minWidth: 420, minHeight: shape === 'compact' ? 190 : 360, show: false, minimizable: false,
      title: t('LLM Browser update'), backgroundColor: '#1e1f24',
      webPreferences: { preload: path.join(__dirname, 'updater-preload.js'), contextIsolation: true, sandbox: true },
    });
    win.removeMenu();
    win.loadFile(path.join(__dirname, 'updater.html'));
    win.webContents.on('did-finish-load', push);
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => { win = null; shape = null; });
  }

  ipcMain.on('upd-action', (e, action) => {
    if (!win || e.sender !== win.webContents) return;
    if (action === 'restart') {
      if (state.phase !== 'ready') return;
      // Se avisa en la ventana de que la app se cerrará y volverá sola; luego el instalador one-click de
      // Windows enseña su propia barra de progreso (no es silencioso a propósito: sin ninguna ventana
      // durante los segundos que tarda, parecería colgado) y reabre la app (isForceRunAfter) con sus pestañas.
      set({ phase: 'installing' });
      beforeInstall();
      return setTimeout(() => (demoDir ? win?.close() : autoUpdater.quitAndInstall(false, true)), 1500);
    }
    if (action === 'open') shell.openExternal(`${RELEASES}/tag/v${state.version}`);
    if (action === 'retry') return check(true);
    win.close(); // later / hide / close
  });

  // Aviso (sin comprobación manual) solo una vez por versión y fase, para no abrir la ventana cada 6 horas.
  const announce = key => { if (manual || shownFor !== key) { shownFor = key; show(); } };

  function onAvailable(version) {
    set({ phase: auto ? 'downloading' : 'manual', version, progress: null, error: null });
    loadNotes();
    announce(version + (auto ? ':download' : ':manual'));
    manual = false;
  }

  function onDownloaded(version) {
    set({ phase: 'ready', version, progress: { percent: 100 } });
    loadNotes();
    announce(version + ':ready');
    manual = false;
  }

  // Demo: una descarga de ~90 MB en unos segundos.
  function demo() {
    const v = localNotes(demoDir, 'en', state.current)[0]?.version;
    if (!v) return set({ phase: 'none' });
    onAvailable(v);
    const total = 92 * 1024 * 1024;
    let done = 0;
    const timer = setInterval(() => {
      done = Math.min(total, done + total / 60);
      set({ progress: { percent: (done / total) * 100, transferred: done, total, bytesPerSecond: total / 6 } });
      if (done >= total) { clearInterval(timer); onDownloaded(v); }
    }, 100);
  }

  async function check(byUser) {
    if (!enabled) { set({ phase: 'disabled' }); return show(); }
    if (byUser) {
      // Ya hay algo en curso: se enseña tal cual en vez de volver a buscar.
      if (['downloading', 'manual', 'ready'].includes(state.phase)) return show();
      manual = true;
      set({ phase: 'checking', error: null });
      show();
    }
    if (demoDir) return setTimeout(demo, byUser ? 800 : 0);
    try { await autoUpdater.checkForUpdates(); } catch { /* lo trata el evento 'error' */ }
  }

  if (autoUpdater) {
    autoUpdater.allowPrerelease = betas; // con betas: la más nueva entre betas y estables
    autoUpdater.autoDownload = auto;
    autoUpdater.autoInstallOnAppQuit = auto;
    autoUpdater.logger = null;
    autoUpdater.on('update-available', info => onAvailable(info.version));
    autoUpdater.on('download-progress', p => set({ progress: { percent: p.percent, transferred: p.transferred, total: p.total, bytesPerSecond: p.bytesPerSecond } }));
    autoUpdater.on('update-downloaded', info => onDownloaded(info.version));
    autoUpdater.on('update-not-available', () => { if (manual) { manual = false; set({ phase: 'none' }); } });
    autoUpdater.on('error', e => {
      // Sin red al comprobar en segundo plano: silencio, se reintenta luego. Si lo pidió el usuario o se
      // estaba descargando, se muestra.
      if (!manual && state.phase !== 'downloading') return;
      manual = false;
      set({ phase: 'error', error: String(e?.message || e).split(/\r?\n/)[0] });
      show();
    });
  }

  if (enabled) {
    setTimeout(() => check(false), demoDir ? 1500 : 10000);
    if (!demoDir) setInterval(() => check(false), CHECK_EVERY).unref();
  }

  return {
    enabled,
    // Cambio de canal en caliente: vuelve a avisar aunque ya se hubiera avisado de esa versión.
    setBetas(value) {
      betas = !!value;
      if (autoUpdater) autoUpdater.allowPrerelease = betas;
      shownFor = null;
      loadNotes(true);
    },
    setLanguage(code) {
      lang = code;
      t = I18n.translator(lang);
      if (win && !win.isDestroyed()) { win.setTitle(t('LLM Browser update')); win.webContents.reload(); }
      loadNotes(true);
    },
    checkNow: () => check(true),
  };
};

module.exports.noteLines = noteLines;
module.exports.bodyBlock = bodyBlock;
