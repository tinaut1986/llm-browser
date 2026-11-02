const test = require('node:test');
const assert = require('node:assert');
const makeTools = require('../src/tools');

const { normalizeUrl } = makeTools;
const search = q => 'https://search/?q=' + encodeURIComponent(q);

test('normalizeUrl keeps http, https and about', () => {
  assert.strictEqual(normalizeUrl('https://example.com/a', search), 'https://example.com/a');
  assert.strictEqual(normalizeUrl('http://example.com', search), 'http://example.com');
  assert.strictEqual(normalizeUrl('about:blank', search), 'about:blank');
});

test('normalizeUrl completes hosts and falls back to search', () => {
  assert.strictEqual(normalizeUrl('example.com', search), 'https://example.com');
  assert.strictEqual(normalizeUrl('localhost:3000/x', search), 'http://localhost:3000/x');
  assert.strictEqual(normalizeUrl('hello world', search), search('hello world'));
});

test('normalizeUrl rejects dangerous schemes for the model', () => {
  for (const u of ['file:///C:/Windows/win.ini', 'data:text/html,hi', 'javascript:alert(1)', 'FILE:///etc/passwd']) {
    assert.throws(() => normalizeUrl(u, search), /no permitido/, u);
  }
});

test('normalizeUrl allows any scheme when the user types it', () => {
  assert.strictEqual(normalizeUrl('file:///tmp/a.html', search, true), 'file:///tmp/a.html');
});

function makeCtx(overrides = {}) {
  const loaded = [];
  const view = { webContents: { loadURL: async u => { loaded.push(u); }, isLoading: () => false, getTitle: () => 't', getURL: () => 'u', executeJavaScript: async () => 1 } };
  const tab = { view, secrets: false };
  return { loaded, ctx: { active: () => tab, tabs: () => [], isActEnabled: () => true, searchUrl: search, ...overrides }, tab };
}

test('read-only switch blocks the model but not the user', async () => {
  const { ctx, loaded } = makeCtx({ isActEnabled: () => false });
  const call = makeTools(ctx);
  await assert.rejects(call('navigate', { url: 'https://a.com' }), /desactivado/);
  await call('navigate', { url: 'https://a.com' }, { user: true });
  assert.deepStrictEqual(loaded, ['https://a.com']);
});

test('model cannot navigate to file:', async () => {
  const { ctx } = makeCtx();
  await assert.rejects(makeTools(ctx)('navigate', { url: 'file:///etc/passwd' }), /no permitido/);
});

test('evaluate is blocked while credentials are in the page', async () => {
  const { ctx, tab } = makeCtx();
  const call = makeTools(ctx);
  assert.strictEqual((await call('evaluate', { code: '1' })).text, '1');
  tab.secrets = true;
  await assert.rejects(call('evaluate', { code: 'document.title' }), /bloqueado/);
});
