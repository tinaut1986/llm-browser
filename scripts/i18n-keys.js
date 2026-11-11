#!/usr/bin/env node
// Lista los textos de la interfaz que pasan por el traductor: t('...') / tr('...') en src/*.js y src/*.html,
// y los atributos data-i18n, data-i18n-title y data-i18n-placeholder. Sin argumentos imprime las claves
// (una por línea, JSON); con --missing <código> solo las que faltan en src/locales/<código>.json.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

function keys() {
  const found = new Set();
  for (const f of fs.readdirSync(SRC)) {
    if (!/\.(js|html)$/.test(f)) continue;
    const text = fs.readFileSync(path.join(SRC, f), 'utf8');
    for (const m of text.matchAll(/(?<![\w.$])(?:t|tr|i18n\.t)\(\s*('(?:\\.|[^'\\])*')/g)) found.add(Function('return ' + m[1])());
    for (const m of text.matchAll(/data-i18n(?:-title|-placeholder)?="([^"]*)"/g)) found.add(m[1]);
  }
  return [...found].sort();
}

module.exports = { keys };

if (require.main === module) {
  const i = process.argv.indexOf('--missing');
  let list = keys();
  if (i > 0) {
    const dict = JSON.parse(fs.readFileSync(path.join(SRC, 'locales', process.argv[i + 1] + '.json'), 'utf8'));
    list = list.filter(k => !(k in dict));
  }
  for (const k of list) console.log(JSON.stringify(k));
}
