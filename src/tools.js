// Implementación de las herramientas sobre las pestañas de Electron.
const snapshotScript = require('./snapshot');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function normalizeUrl(u) {
  u = String(u).trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^[^\s/]+:\d+/.test(u)) return u;
  if (/^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?(\/|$)/i.test(u)) return (/^localhost|^\d/.test(u) ? 'http://' : 'https://') + u;
  return 'https://duckduckgo.com/?q=' + encodeURIComponent(u);
}

// ctx: { tabs(), active(), newTab(url), closeTab(id), select(id), isActEnabled() }
module.exports = function makeTools(ctx) {
  const wc = () => {
    const t = ctx.active();
    if (!t) throw new Error('No hay pestañas abiertas');
    return t.view.webContents;
  };
  const evalIn = (code) => wc().executeJavaScript(code, true);

  async function waitLoad(w, timeout = 15000) {
    const start = Date.now();
    await sleep(100);
    while (w.isLoading() && Date.now() - start < timeout) await sleep(100);
  }

  async function click(x, y, opts = {}) {
    const w = wc();
    const button = opts.button || 'left';
    const clickCount = opts.double ? 2 : 1;
    w.sendInputEvent({ type: 'mouseMove', x, y });
    for (let i = 1; i <= clickCount; i++) {
      w.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: i });
      w.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: i });
    }
    await waitLoad(w, 3000);
  }

  async function refCenter(ref) {
    const r = await evalIn(`(() => {
      const el = (window.__llmRefs || [])[${Number(ref)}];
      if (!el || !el.isConnected) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
    })()`);
    if (!r) throw new Error(`Ref ${ref} no existe; vuelve a llamar a read_page`);
    return r;
  }

  const tools = {
    // ---- lectura ----
    async read_page({ viewport_only } = {}) {
      const s = await evalIn(snapshotScript(!!viewport_only));
      const head = `# ${s.title}\nURL: ${s.url}\nScroll: ${s.scrollY}/${s.scrollMax}px · ${s.refs} elementos interactivos [ref]\n\n`;
      return { text: head + s.text };
    },
    async get_text() {
      return { text: await evalIn('document.body ? document.body.innerText : ""') };
    },
    async screenshot() {
      const w = wc();
      let img = await w.capturePage();
      const { width } = img.getSize();
      if (width > 1400) img = img.resize({ width: 1400 });
      return { image: img.toJPEG(80).toString('base64'), mime: 'image/jpeg' };
    },
    async tabs() {
      return { text: JSON.stringify(ctx.tabs().map(t => ({ id: t.id, active: t.active, title: t.title, url: t.url })), null, 2) };
    },
    async console_logs({ clear } = {}) {
      const t = ctx.active();
      const out = t.logs.slice(-100).map(l => `[${l.level}] ${l.message}`).join('\n');
      if (clear) t.logs.length = 0;
      return { text: out || '(sin mensajes)' };
    },
    async select_tab({ id }) {
      ctx.select(id);
      return { text: 'ok' };
    },

    // ---- acciones (requieren interruptor activado) ----
    async navigate({ url }) {
      const w = wc();
      try { await w.loadURL(normalizeUrl(url)); } catch (e) { if (!/ERR_ABORTED/.test(e.message)) throw e; }
      await waitLoad(w);
      return { text: `Cargado: ${w.getTitle()} — ${w.getURL()}` };
    },
    async back() { const w = wc(); w.navigationHistory.goBack(); await waitLoad(w); return { text: w.getURL() }; },
    async forward() { const w = wc(); w.navigationHistory.goForward(); await waitLoad(w); return { text: w.getURL() }; },
    async reload() { const w = wc(); w.reload(); await waitLoad(w); return { text: w.getURL() }; },
    async new_tab({ url } = {}) {
      const t = ctx.newTab(url ? normalizeUrl(url) : 'about:blank');
      await waitLoad(t.view.webContents);
      return { text: `Pestaña ${t.id} creada` };
    },
    async close_tab({ id }) { ctx.closeTab(id); return { text: 'ok' }; },
    async click({ ref, x, y, button, double }) {
      if (ref !== undefined) ({ x, y } = await refCenter(ref));
      if (x === undefined || y === undefined) throw new Error('Indica ref o x,y');
      await click(x, y, { button, double });
      return { text: `clic en (${x},${y})` };
    },
    async type({ text, ref, clear, submit }) {
      const w = wc();
      if (ref !== undefined) {
        const { x, y } = await refCenter(ref);
        await click(x, y);
      }
      if (clear) {
        await evalIn(`(() => { const e = document.activeElement; if (e && e.select) e.select(); else document.execCommand('selectAll'); })()`);
        w.sendInputEvent({ type: 'keyDown', keyCode: 'Delete' });
        w.sendInputEvent({ type: 'keyUp', keyCode: 'Delete' });
      }
      await w.insertText(String(text));
      if (submit) { await tools.press_key({ key: 'Enter' }); }
      return { text: 'escrito' };
    },
    async press_key({ key, modifiers }) {
      const w = wc();
      const m = modifiers || [];
      w.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: m });
      if (key.length === 1) w.sendInputEvent({ type: 'char', keyCode: key, modifiers: m });
      w.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: m });
      await waitLoad(w, 3000);
      return { text: `tecla ${key}` };
    },
    async scroll({ dy = 600, dx = 0, ref }) {
      const r = await evalIn(`(() => {
        const el = ${ref !== undefined ? `(window.__llmRefs || [])[${Number(ref)}]` : 'null'};
        if (el) el.scrollBy(${Number(dx)}, ${Number(dy)}); else scrollBy(${Number(dx)}, ${Number(dy)});
        return Math.round(scrollY) + '/' + Math.round(document.documentElement.scrollHeight - innerHeight);
      })()`);
      return { text: `scroll ${r}` };
    },
    async select_option({ ref, value }) {
      const ok = await evalIn(`(() => {
        const el = (window.__llmRefs || [])[${Number(ref)}];
        if (!el || el.tagName !== 'SELECT') return false;
        const o = [...el.options].find(o => o.value === ${JSON.stringify(String(value))} || o.text.trim() === ${JSON.stringify(String(value))});
        if (!o) return false;
        el.value = o.value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      if (!ok) throw new Error('No se pudo seleccionar la opción');
      return { text: 'ok' };
    },
    async evaluate({ code }) {
      const r = await evalIn(code);
      return { text: typeof r === 'string' ? r : JSON.stringify(r, null, 2) ?? 'undefined' };
    },
  };

  const ACTIONS = new Set(['navigate', 'back', 'forward', 'reload', 'new_tab', 'close_tab', 'click', 'type', 'press_key', 'scroll', 'select_option', 'evaluate']);

  return async function call(name, args) {
    if (!tools[name]) throw new Error('Herramienta desconocida: ' + name);
    if (ACTIONS.has(name) && !ctx.isActEnabled()) {
      throw new Error('El usuario ha desactivado las acciones del modelo (interruptor en la barra del navegador). Solo puedes leer.');
    }
    return tools[name](args || {});
  };
};
