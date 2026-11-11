// Implementación de las herramientas sobre las pestañas de Electron.
const snapshotScript = require('./snapshot');
const cursorScript = require('./cursor');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// El modelo solo puede abrir http(s) y about:; file:, data:, javascript:... quedan para el usuario (anyScheme).
const SAFE_SCHEMES = /^(https?|about):/i;

function normalizeUrl(u, searchUrl, anyScheme = false) {
  u = String(u).trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^[^\s/]+:\d+/.test(u)) {
    if (!anyScheme && !SAFE_SCHEMES.test(u)) throw new Error('Esquema de URL no permitido: ' + u.split(':')[0] + ':. Solo http, https y about.');
    return u;
  }
  if (/^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?(\/|$)/i.test(u)) return (/^localhost|^\d/.test(u) ? 'http://' : 'https://') + u;
  return searchUrl(u);
}

// ctx: { tabs(), active(), newTab(url), closeTab(id), select(id), isActEnabled(), searchUrl(query) }
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

  // Ratón virtual: el círculo se desliza hasta (x,y) y el puntero real le sigue en pasos, para que los hover reaccionen.
  const CURSOR_IDLE_MS = 6000;
  async function showCursor(t, mode) {
    if (t.view.webContents.isDestroyed()) return;
    t.cursor.visible = mode !== 'hide';
    await t.view.webContents.executeJavaScript(cursorScript(t.cursor.x, t.cursor.y, mode), true).catch(() => {});
    clearTimeout(t.cursor.timer);
    if (t.cursor.visible) t.cursor.timer = setTimeout(() => showCursor(t, 'hide'), CURSOR_IDLE_MS);
  }

  async function moveTo(x, y, modifiers = []) {
    const t = ctx.active(), w = wc();
    const from = t.cursor || { x, y };
    t.cursor = { ...from, x, y, visible: from.visible };
    await showCursor(t, 'move');
    for (let i = 1; i <= 5; i++) {
      w.sendInputEvent({ type: 'mouseMove', x: Math.round(from.x + (x - from.x) * i / 5), y: Math.round(from.y + (y - from.y) * i / 5), modifiers });
      await sleep(40);
    }
  }

  async function click(x, y, opts = {}) {
    const w = wc();
    const button = opts.button || 'left';
    const clickCount = opts.double ? 2 : 1;
    await moveTo(x, y);
    await showCursor(ctx.active(), 'click');
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
      // Píxeles de la captura = píxeles CSS de la vista, que son los que usan click/mouse_move/drag.
      const { width: cssW } = ctx.active().view.getBounds();
      if (img.getSize().width !== cssW) img = img.resize({ width: cssW });
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
    async navigate({ url }, opts = {}) {
      const w = wc();
      try { await w.loadURL(normalizeUrl(url, ctx.searchUrl, opts.user)); } catch (e) { if (!/ERR_ABORTED/.test(e.message)) throw e; }
      await waitLoad(w);
      return { text: `Cargado: ${w.getTitle()} — ${w.getURL()}` };
    },
    async back() { const w = wc(); w.navigationHistory.goBack(); await waitLoad(w); return { text: w.getURL() }; },
    async forward() { const w = wc(); w.navigationHistory.goForward(); await waitLoad(w); return { text: w.getURL() }; },
    async reload() { const w = wc(); w.reload(); await waitLoad(w); return { text: w.getURL() }; },
    async new_tab({ url } = {}) {
      const t = ctx.newTab(url ? normalizeUrl(url, ctx.searchUrl) : 'about:blank');
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
    async mouse_move({ x, y }) {
      await moveTo(x, y);
      return { text: `ratón en (${x},${y})` };
    },
    // Drag & drop HTML5 (draggable, dragstart/drop; p. ej. reordenar canales de Discord): en Windows
    // Chromium se lo pasa al sistema (DoDragDrop), cuyo bucle modal sigue al ratón físico y deja el
    // arrastre colgado. Con Input.setInterceptDrags (CDP) el arrastre nativo vuelve aquí y se completa
    // con Input.dispatchDragEvent; la página recibe dragstart/dragover/drop con isTrusted. El ratón sigue
    // yendo por sendInputEvent, así que sliders, mapas y librerías de pointer events no cambian. Pausa
    // tras pulsar y pasos cortos: muchas librerías esperan un umbral de tiempo/distancia para empezar.
    async drag({ x1, y1, x2, y2 }) {
      const w = wc(), t = ctx.active(), d = w.debugger;
      let attached = false;
      if (!d.isAttached()) { try { d.attach('1.3'); attached = true; } catch {} }
      let data = null, entered = false;
      const onMsg = (_e, method, params) => { if (method === 'Input.dragIntercepted') data = params.data; };
      d.on('message', onMsg);
      const send = (m, p) => d.sendCommand(m, p);
      const press = (type, x, y) => w.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
      const over = async (x, y) => {
        if (!data) return w.sendInputEvent({ type: 'mouseMove', x, y, modifiers: ['leftButtonDown'] });
        if (!entered) { entered = true; await send('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data }); }
        return send('Input.dispatchDragEvent', { type: 'dragOver', x, y, data });
      };
      const cursorAt = (x, y) => { t.cursor = { ...t.cursor, x, y }; showCursor(t, 'move'); };
      try {
        await send('Input.setInterceptDrags', { enabled: true }).catch(() => {});
        await moveTo(x1, y1);
        press('mouseDown', x1, y1);
        await sleep(150);
        const dist = Math.hypot(x2 - x1, y2 - y1);
        const steps = Math.min(40, Math.max(12, Math.round(dist / 12)));
        for (let i = 1; i <= steps; i++) {
          const k = i / steps, e = k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
          const x = Math.round(x1 + (x2 - x1) * e), y = Math.round(y1 + (y2 - y1) * e);
          await over(x, y);
          if (i % 4 === 0 || i === steps) cursorAt(x, y);
          await sleep(i <= 2 ? 60 : 20);
        }
        for (let i = 0; i < 3; i++) { await over(x2, y2); await sleep(80); }
        if (data) await send('Input.dispatchDragEvent', { type: 'drop', x: x2, y: y2, data });
        press('mouseUp', x2, y2);
      } finally {
        d.removeListener('message', onMsg);
        await send('Input.setInterceptDrags', { enabled: false }).catch(() => {});
        if (attached) try { d.detach(); } catch {}
      }
      await showCursor(t, 'click');
      await waitLoad(w, 3000);
      return { text: `arrastrado de (${x1},${y1}) a (${x2},${y2})${data ? ' (drag & drop nativo)' : ''}` };
    },
    async wheel({ x, y, dy = 0, dx = 0 }) {
      await moveTo(x, y);
      wc().sendInputEvent({ type: 'mouseWheel', x, y, deltaX: -dx, deltaY: -dy });
      await sleep(150);
      return { text: `rueda en (${x},${y}) dy=${dy} dx=${dx}` };
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
    async keep_active({ enabled }) {
      if (!ctx.setKeepActive) throw new Error('No disponible');
      return { text: ctx.setKeepActive(enabled !== false) };
    },
    async evaluate({ code }) {
      // Tras rellenar una contraseña con Bitwarden la página tiene secretos en el DOM: el modelo no puede ejecutar JS hasta la siguiente navegación.
      if (ctx.active()?.secrets) throw new Error('evaluate está bloqueado en esta pestaña: se han rellenado credenciales. Vuelve a estar disponible tras la siguiente navegación.');
      const r = await evalIn(code);
      return { text: typeof r === 'string' ? r : JSON.stringify(r, null, 2) ?? 'undefined' };
    },
  };

  const ACTIONS = new Set(['navigate', 'back', 'forward', 'reload', 'new_tab', 'close_tab', 'click', 'mouse_move', 'drag', 'wheel', 'type', 'press_key', 'scroll', 'select_option', 'evaluate', 'keep_active']);
  // Acciones de ratón/teclado que Chromium retiene (o pierde) si da la página por oculta.
  const INPUT = new Set(['click', 'mouse_move', 'drag', 'wheel', 'type', 'press_key']);
  const HIDDEN_HINT = '\n\nAviso: la página está oculta (ventana tapada o minimizada); los eventos de ratón y teclado pueden retenerse o perderse. Si la acción no ha surtido efecto, llama a keep_active (reinicia el navegador conservando las pestañas) o pide al usuario que deje la ventana visible.';
  const isHidden = async () => !ctx.keepActive?.() && await evalIn('document.visibilityState').then(v => v === 'hidden', () => false);

  // opts.user: la acción la inicia el usuario (barra de URL), no el modelo: no depende del interruptor ni de la lista de esquemas.
  return async function call(name, args, opts = {}) {
    if (!tools[name]) throw new Error('Herramienta desconocida: ' + name);
    if (!opts.user && ACTIONS.has(name) && !ctx.isActEnabled()) {
      throw new Error('El usuario ha desactivado las acciones del modelo (interruptor en la barra del navegador). Solo puedes leer.');
    }
    const hidden = !opts.user && INPUT.has(name) && await isHidden();
    const r = await tools[name](args || {}, opts);
    return hidden && r.text ? { ...r, text: r.text + HIDDEN_HINT } : r;
  };
};

module.exports.normalizeUrl = normalizeUrl;
