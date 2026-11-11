# LLM Browser

Navegador Electron (Windows/Linux/macOS) que un LLM puede ver y controlar vía MCP.

- `npm start` abre el navegador (pestañas, URL, sesión persistente).
- `src/mcp.js` es el servidor MCP (stdio). Si el navegador no está abierto, lo lanza solo.
- El navegador escucha en `127.0.0.1` (puerto aleatorio + token en `~/.llm-browser/api.json`).
- Interruptor en la barra: **puede actuar / solo lectura**.

## Herramientas
Lectura: `read_page` (texto + `[ref]` interactivos), `get_text`, `screenshot`, `tabs`, `console_logs`, `select_tab`.
Acciones: `navigate`, `back`, `forward`, `reload`, `new_tab`, `close_tab`, `click`, `mouse_move`, `drag`, `wheel`, `type`, `press_key`, `scroll`, `select_option`, `evaluate`, `keep_active`.
Los `ref` solo valen hasta la siguiente llamada a `read_page`.
El modelo solo puede navegar a `http`, `https` y `about:` (no `file:`, `data:`, `javascript:`); la barra de URL del usuario no tiene esa limitación y funciona también en modo solo lectura.
El ratón del modelo es virtual: se ve como un círculo rojo en la página (se desvanece a los 6 s sin uso). `click`, `mouse_move`, `drag` y `wheel` lo mueven y generan eventos de ratón reales; las coordenadas son píxeles de la captura. `drag` también completa el drag & drop HTML5 nativo (reordenar listas o canales), que en Windows se quedaba colgado.

Si la ventana está tapada o minimizada, Chromium retiene o pierde los eventos de ratón y teclado; las acciones lo avisan y `keep_active` (o Ajustes → Mantener activo) reinicia el navegador con la página siempre activa, reabriendo las pestañas.

## Instalar
Descarga el instalador de la [última versión](https://github.com/tinaut1986/llm-browser/releases/latest):
Windows `.exe`, Linux `.AppImage` o `.deb`, macOS `.dmg` (sin firmar y sin probar: Gatekeeper pide abrirla desde Ajustes → Privacidad y seguridad).

La app se actualiza sola desde las releases de GitHub en Windows y en el AppImage de Linux (avisa y pide reiniciar). En macOS y con el `.deb` solo avisa de que hay versión nueva y abre su página.
El canal de actualizaciones (estable o beta) se elige en el menú Ajustes, junto con «Buscar actualizaciones ahora»; se guarda en `~/.llm-browser/settings.json` (`"betas"`). Sin elegir, una beta instalada sigue en el canal beta y una estable en el estable.

## Registrar el MCP
Instalada: la app escribe en `~/.llm-browser/mcp.json` el comando exacto para su ruta de instalación (usa el propio ejecutable como Node con `ELECTRON_RUN_AS_NODE=1`). Copia ese bloque `mcpServers` en la configuración del cliente.

Desde el código: `claude mcp add llm-browser -- node /ruta/a/llm-browser/src/mcp.js`

Antigravity (mcp_config.json):
```json
{ "mcpServers": { "llm-browser": { "command": "node", "args": ["/ruta/a/llm-browser/src/mcp.js"] } } }
```

## Empaquetar y publicar
`npm run dist` genera los instaladores del SO actual en `dist/` (hay que ejecutarlo en cada SO; el CI lo hace en los tres).

Mismo esquema que los ports de 3DS: `main` = estable, `release/vX.Y.Z` = línea de release actual (beta), ramas `feat/…`/`fix/…` desde ella con `--no-ff`. La versión es la del tag `vX.Y.Z` (el `package.json` no se toca: el CI la inyecta). Al subir un tag, `.github/workflows/build-release.yml` construye Windows, Linux y macOS y publica la release; es **Beta** (pre-release) si `main` no alcanza el commit y **Release** si sí.

1. Escribir `docs/release-notes/vX.Y.Z.md` en una rama y fusionarla en la rama de release.
2. Beta: `git tag -a vX.Y.Z -m vX.Y.Z && git push origin release/vX.Y.Z vX.Y.Z`.
3. Estable: fusionar la rama en `main` con `--no-ff`, etiquetar el merge y subir `main` **antes** que el tag.

El icono sale de `scripts/make-icon.py` (`npm run icon`, necesita Pillow).

## Bitwarden
Botón 🔑 de la barra (o Ctrl+Mayús+L): rellena usuario y contraseña de la página desde la bóveda, o el código 2FA en el campo con foco. Usa la CLI `bw` (la app de escritorio no sirve): `npm i -g @bitwarden/cli` o `sudo snap install bw`, y `bw login` una vez en una terminal. Si está en otra ruta: `BW_PATH=/ruta/bw npm start`. Sin la CLI el navegador funciona igual y el botón explica cómo instalarla.
La contraseña maestra se pide en una ventana propia y la clave de sesión solo vive en memoria. Lo dispara únicamente el usuario: el modelo no tiene herramienta para ello. `read_page` oculta los campos de contraseña y `evaluate` queda bloqueado en esa pestaña hasta la siguiente navegación, para que el modelo no pueda leer lo rellenado.
