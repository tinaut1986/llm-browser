# LLM Browser

Navegador Electron (Windows/Linux) que un LLM puede ver y controlar vía MCP.

- `npm start` abre el navegador (pestañas, URL, sesión persistente).
- `src/mcp.js` es el servidor MCP (stdio). Si el navegador no está abierto, lo lanza solo.
- El navegador escucha en `127.0.0.1` (puerto aleatorio + token en `~/.llm-browser/api.json`).
- Interruptor en la barra: **puede actuar / solo lectura**.

## Herramientas
Lectura: `read_page` (texto + `[ref]` interactivos), `get_text`, `screenshot`, `tabs`, `console_logs`, `select_tab`.
Acciones: `navigate`, `back`, `forward`, `reload`, `new_tab`, `close_tab`, `click`, `type`, `press_key`, `scroll`, `select_option`, `evaluate`.
Los `ref` solo valen hasta la siguiente llamada a `read_page`.

## Registrar
Claude Code: `claude mcp add llm-browser -- node /ruta/a/llm-browser/src/mcp.js`

Antigravity (mcp_config.json):
```json
{ "mcpServers": { "llm-browser": { "command": "node", "args": ["/ruta/a/llm-browser/src/mcp.js"] } } }
```

## Empaquetar
`npm run dist` (AppImage en Linux, portable en Windows; hay que ejecutarlo en cada SO).
