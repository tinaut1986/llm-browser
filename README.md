# LLM Browser

Navegador Electron (Windows/Linux) que un LLM puede ver y controlar vía MCP.

- `npm start` abre el navegador (pestañas, URL, sesión persistente).
- `src/mcp.js` es el servidor MCP (stdio). Si el navegador no está abierto, lo lanza solo.
- El navegador escucha en `127.0.0.1` (puerto aleatorio + token en `~/.llm-browser/api.json`).
- Interruptor en la barra: **puede actuar / solo lectura**.

## Herramientas
Lectura: `read_page` (texto + `[ref]` interactivos), `get_text`, `screenshot`, `tabs`, `console_logs`, `select_tab`.
Acciones: `navigate`, `back`, `forward`, `reload`, `new_tab`, `close_tab`, `click`, `mouse_move`, `drag`, `wheel`, `type`, `press_key`, `scroll`, `select_option`, `evaluate`.
Los `ref` solo valen hasta la siguiente llamada a `read_page`.
El ratón del modelo es virtual: se ve como un círculo rojo en la página (se desvanece a los 6 s sin uso). `click`, `mouse_move`, `drag` y `wheel` lo mueven y generan eventos de ratón reales; las coordenadas son píxeles de la captura.

## Registrar
Claude Code: `claude mcp add llm-browser -- node /ruta/a/llm-browser/src/mcp.js`

Antigravity (mcp_config.json):
```json
{ "mcpServers": { "llm-browser": { "command": "node", "args": ["/ruta/a/llm-browser/src/mcp.js"] } } }
```

## Empaquetar
`npm run dist` (AppImage en Linux, portable en Windows; hay que ejecutarlo en cada SO).

## Bitwarden
Botón 🔑 de la barra (o Ctrl+Mayús+L): rellena usuario y contraseña de la página desde la bóveda, o el código 2FA en el campo con foco. Usa la CLI `bw` (la app de escritorio no sirve): `npm i -g @bitwarden/cli` o `sudo snap install bw`, y `bw login` una vez en una terminal. Si está en otra ruta: `BW_PATH=/ruta/bw npm start`. Sin la CLI el navegador funciona igual y el botón explica cómo instalarla.
La contraseña maestra se pide en una ventana propia y la clave de sesión solo vive en memoria. Lo dispara únicamente el usuario: el modelo no tiene herramienta para ello y nunca ve los secretos.
