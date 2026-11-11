// Idioma de la interfaz, como en NSA: los mismos códigos, "system" sigue al sistema operativo y el inglés
// es el respaldo (idioma no soportado o texto sin traducir). Las claves son el texto en inglés; cada
// idioma es src/locales/<código>.json con { "English text": "Traducción" }. {nombre} se sustituye.
const fs = require('fs');
const path = require('path');

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'ca', name: 'Català' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português (Brasil)' },
  { code: 'ru', name: 'Русский' },
  { code: 'ja', name: '日本語' },
  { code: 'zh', name: '简体中文' },
  { code: 'tw', name: '繁體中文' },
];
const CODES = new Set(LANGUAGES.map(l => l.code));

// Código del sistema (es-ES, zh-Hant-TW, pt-BR...) -> uno de los nuestros, o null.
function fromLocale(locale) {
  const l = String(locale || '').toLowerCase();
  if (/^zh[-_](hant|tw|hk|mo)/.test(l)) return 'tw';
  const base = l.split(/[-_]/)[0];
  return CODES.has(base) ? base : null;
}

// setting: 'system' (o vacío) | código. systemLocales: idiomas preferidos del sistema, en orden.
function resolve(setting, systemLocales = []) {
  if (CODES.has(setting)) return setting;
  for (const l of systemLocales) { const c = fromLocale(l); if (c) return c; }
  return 'en';
}

const cache = {};
function dict(code) {
  if (code === 'en') return {};
  if (!cache[code]) {
    try { cache[code] = JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', code + '.json'), 'utf8')); } catch { cache[code] = {}; }
  }
  return cache[code];
}

const format = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m));

function translator(code) {
  const d = dict(code);
  return (key, vars) => format(d[key] || key, vars);
}

module.exports = { LANGUAGES, CODES, fromLocale, resolve, dict, format, translator };
