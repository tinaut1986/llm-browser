// Auto-actualización desde GitHub Releases (electron-updater).
// Windows (instalador NSIS) y Linux (AppImage) se actualizan solos; macOS no está firmado,
// así que ahí (y con el .deb) solo se avisa y se abre la página de la versión.
const { app, dialog, shell, net } = require('electron');
const semver = require('semver');

const RELEASES = 'https://github.com/tinaut1986/llm-browser/releases';
const API = 'https://api.github.com/repos/tinaut1986/llm-browser/releases?per_page=30';
const CHECK_EVERY = 6 * 3600 * 1000;

// Las novedades de cada release del canal más nuevas que la instalada (la más nueva primero), como el
// actualizador de los ports de 3DS. Estable: solo estables (sus notas ya incluyen las betas de en medio).
// Con betas: todas. Es el bloque entre <!-- llmb-notes --> de la release, o la lista de cambios si falta.
async function fetchNotes(betas) {
  try {
    const releases = await (await net.fetch(API, { headers: { accept: 'application/vnd.github+json' } })).json();
    const parts = [];
    for (const r of releases) {
      const v = semver.valid(r.tag_name);
      if (!v || r.draft || (r.prerelease && !betas) || !semver.gt(v, app.getVersion())) continue;
      const body = r.body || '';
      const m = body.match(/<!-- llmb-notes -->([\s\S]*?)<!-- \/llmb-notes -->/) || body.match(/(## Changelog[\s\S]*)/);
      const text = (m ? m[1] : '').replace(/^#+ .*$/gm, '').replace(/[*`]/g, '').trim();
      parts.push({ v, text: `${r.tag_name}${r.prerelease ? ' (beta)' : ''}\n${text || 'Sin notas.'}` });
    }
    return parts.sort((a, b) => semver.rcompare(a.v, b.v)).map(p => p.text).join('\n\n');
  } catch { return ''; }
}

// Devuelve { setBetas(bool), check() }; en desarrollo (sin empaquetar) no hay actualizaciones y ambos no hacen nada.
module.exports = function startUpdater({ betas, parent }) {
  if (!app.isPackaged) return { enabled: false, setBetas() {}, check: async () => ({ disabled: true }) };
  const { autoUpdater } = require('electron-updater');
  const auto = process.platform === 'win32' || (process.platform === 'linux' && !!process.env.APPIMAGE);

  autoUpdater.allowPrerelease = betas; // con betas: la más nueva entre betas y estables
  autoUpdater.autoDownload = auto;
  autoUpdater.autoInstallOnAppQuit = auto;
  autoUpdater.logger = null;

  let asked = null; // versión por la que ya se preguntó
  const ask = opts => dialog.showMessageBox(parent(), { type: 'info', noLink: true, ...opts });

  autoUpdater.on('update-downloaded', async info => {
    if (asked === info.version) return;
    asked = info.version;
    const notes = await fetchNotes(betas);
    const { response } = await ask({
      message: `LLM Browser ${info.version} está listo`,
      detail: `Se instalará al reiniciar la aplicación.${notes ? '\n\nNovedades:\n\n' + notes : ''}`,
      buttons: ['Reiniciar ahora', 'Más tarde'], defaultId: 0, cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  if (!auto) {
    autoUpdater.on('update-available', async info => {
      if (asked === info.version) return;
      asked = info.version;
      const notes = await fetchNotes(betas);
      const { response } = await ask({
        message: `Hay una versión nueva: LLM Browser ${info.version}`,
        detail: `En este sistema la actualización es manual: descarga el instalador de la página de la versión.${notes ? '\n\nNovedades:\n\n' + notes : ''}`,
        buttons: ['Abrir página', 'Más tarde'], defaultId: 0, cancelId: 1,
      });
      if (response === 0) shell.openExternal(`${RELEASES}/tag/v${info.version}`);
    });
  }

  const check = () => autoUpdater.checkForUpdates().catch(() => {}); // sin red: se reintenta luego
  setTimeout(check, 10000);
  setInterval(check, CHECK_EVERY).unref();

  return {
    enabled: true,
    // Cambio de canal en caliente: vuelve a preguntar aunque ya se hubiera avisado de esa versión.
    setBetas(value) {
      betas = !!value;
      autoUpdater.allowPrerelease = betas;
      asked = null;
    },
    // Comprobación manual desde Ajustes: informa del resultado en vez de fallar en silencio.
    async check() {
      try {
        const r = await autoUpdater.checkForUpdates();
        const v = r?.updateInfo?.version;
        return { available: !!r?.isUpdateAvailable, version: v };
      } catch (e) {
        return { error: String(e.message || e).split(/\r?\n/)[0] };
      }
    },
  };
};
