const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const I18n = require('../src/i18n');
const { keys } = require('../scripts/i18n-keys');

const placeholders = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

test('every language has every text, with the same placeholders', () => {
  const all = keys();
  assert.ok(all.length > 100, 'the key scan found the interface texts');
  for (const { code } of I18n.LANGUAGES) {
    if (code === 'en') continue;
    const dict = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'locales', code + '.json'), 'utf8'));
    for (const k of all) {
      assert.ok(typeof dict[k] === 'string' && dict[k].trim(), `${code}: missing ${JSON.stringify(k)}`);
      assert.deepStrictEqual(placeholders(dict[k]), placeholders(k), `${code}: placeholders of ${JSON.stringify(k)}`);
    }
    for (const k of Object.keys(dict)) assert.ok(all.includes(k), `${code}: ${JSON.stringify(k)} is no longer used`);
  }
});

test('system locales map onto the NSA language codes, English as fallback', () => {
  assert.strictEqual(I18n.resolve('system', ['es-ES']), 'es');
  assert.strictEqual(I18n.resolve('system', ['pt-BR']), 'pt');
  assert.strictEqual(I18n.resolve('system', ['zh-CN']), 'zh');
  assert.strictEqual(I18n.resolve('system', ['zh-Hant-TW']), 'tw');
  assert.strictEqual(I18n.resolve('system', ['zh-HK']), 'tw');
  assert.strictEqual(I18n.resolve('system', ['nl-NL', 'ca-ES']), 'ca');
  assert.strictEqual(I18n.resolve('system', ['nl-NL']), 'en');
  assert.strictEqual(I18n.resolve(undefined, []), 'en');
  assert.strictEqual(I18n.resolve('fr', ['es-ES']), 'fr');
  assert.strictEqual(I18n.resolve('xx', ['de-DE']), 'de');
});

test('translator fills placeholders and falls back to the English text', () => {
  const t = I18n.translator('es');
  assert.strictEqual(t('Installed version: {version}', { version: '1.2.3' }), 'Versión instalada: 1.2.3');
  assert.strictEqual(t('Some text nobody translated'), 'Some text nobody translated');
  assert.strictEqual(I18n.translator('en')('{done} of {total} MB', { done: 1, total: 2 }), '1 of 2 MB');
});
