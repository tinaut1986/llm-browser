#!/usr/bin/env node
// Puente MCP (stdio) → API local del navegador. Si el navegador no está abierto, lo lanza.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const CFG = path.join(os.homedir(), '.llm-browser', 'api.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const readCfg = () => { try { return JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch { return null; } };

async function post(cfg, tool, args) {
  const r = await fetch(`http://127.0.0.1:${cfg.port}/`, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + cfg.token, 'content-type': 'application/json' },
    body: JSON.stringify({ tool, args }),
  });
  return r.json();
}

async function ensureRunning() {
  let cfg = readCfg();
  if (cfg) { try { await post(cfg, 'tabs', {}); return cfg; } catch {} }
  const electron = require('electron'); // ruta al binario
  const child = spawn(electron, [path.join(__dirname, '..'), ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    cfg = readCfg();
    if (cfg) { try { await post(cfg, 'tabs', {}); return cfg; } catch {} }
  }
  throw new Error('No se pudo iniciar LLM Browser');
}

async function run(tool, args) {
  try {
    const cfg = await ensureRunning();
    const r = await post(cfg, tool, args);
    if (!r.ok) return { isError: true, content: [{ type: 'text', text: r.error }] };
    if (r.image) return { content: [{ type: 'image', data: r.image, mimeType: r.mime }] };
    return { content: [{ type: 'text', text: r.text ?? 'ok' }] };
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: String(e.message || e) }] };
  }
}

const server = new McpServer({ name: 'llm-browser', version: '0.1.0' });
const def = (name, description, shape = {}) => server.tool(name, description, shape, args => run(name, args));

def('read_page', 'Devuelve el contenido visible de la pestaña activa como texto; los elementos interactivos llevan un [ref] que se usa en click/type/scroll/select_option. Úsalo antes de interactuar.', { viewport_only: z.boolean().optional().describe('Solo lo visible en pantalla') });
def('get_text', 'Texto plano completo de la página (innerText).');
def('screenshot', 'Captura de pantalla de la pestaña activa.');
def('tabs', 'Lista las pestañas abiertas.');
def('select_tab', 'Cambia de pestaña.', { id: z.number() });
def('console_logs', 'Mensajes de consola de la pestaña activa.', { clear: z.boolean().optional() });
def('navigate', 'Navega la pestaña activa a una URL (o busca en DuckDuckGo si no es una URL).', { url: z.string() });
def('back', 'Atrás en el historial.');
def('forward', 'Adelante en el historial.');
def('reload', 'Recarga la página.');
def('new_tab', 'Abre una pestaña nueva.', { url: z.string().optional() });
def('close_tab', 'Cierra una pestaña.', { id: z.number() });
def('click', 'Clic con ratón real (el círculo del ratón virtual se mueve y pulsa). Usa ref (de read_page) o coordenadas x,y en píxeles de la captura.', { ref: z.number().optional(), x: z.number().optional(), y: z.number().optional(), button: z.enum(['left', 'right', 'middle']).optional(), double: z.boolean().optional() });
def('mouse_move', 'Mueve el ratón virtual (círculo rojo visible en la página) a x,y en píxeles de la captura; dispara hover/menús desplegables.', { x: z.number(), y: z.number() });
def('drag', 'Arrastra con el botón izquierdo de (x1,y1) a (x2,y2): sliders, mapas, arrastrar y soltar.', { x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() });
def('wheel', 'Rueda del ratón en x,y (dy positivo = abajo). Sirve para paneles con scroll propio, mapas con zoom, etc.', { x: z.number(), y: z.number(), dy: z.number().optional(), dx: z.number().optional() });
def('type', 'Escribe texto en el elemento indicado (o el enfocado). clear borra antes; submit pulsa Enter después.', { text: z.string(), ref: z.number().optional(), clear: z.boolean().optional(), submit: z.boolean().optional() });
def('press_key', 'Pulsa una tecla (Enter, Tab, Escape, Backspace, ArrowDown, PageDown, a, ...).', { key: z.string(), modifiers: z.array(z.enum(['shift', 'control', 'alt', 'meta'])).optional() });
def('scroll', 'Desplaza la página (o el elemento ref) dy/dx píxeles; dy positivo = hacia abajo.', { dy: z.number().optional(), dx: z.number().optional(), ref: z.number().optional() });
def('select_option', 'Elige una opción de un <select> por valor o texto.', { ref: z.number(), value: z.string() });
def('evaluate', 'Ejecuta JavaScript en la página y devuelve el resultado.', { code: z.string() });

server.connect(new StdioServerTransport());
