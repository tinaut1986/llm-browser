const test = require('node:test');
const assert = require('node:assert');
const { noteLines, bodyBlock } = require('../src/updater');

test('release notes become plain lines', () => {
  assert.deepStrictEqual(noteLines('- New **find** bar\n- Fixed `Ctrl+T`\n'), ['New find bar', 'Fixed Ctrl+T']);
  assert.deepStrictEqual(noteLines('## What\'s new\n\nJust text'), ['Just text']);
  assert.deepStrictEqual(noteLines(''), []);
});

test('the English block comes from the release body', () => {
  const body = '> beta\n<!-- llmb-notes -->\n## What\'s new\n\n- One\n- Two\n<!-- /llmb-notes -->\n## Downloads\n- x';
  assert.deepStrictEqual(noteLines(bodyBlock(body)), ['One', 'Two']);
  assert.deepStrictEqual(noteLines(bodyBlock('## Changelog\n\n- a commit (abc123)')), ['a commit (abc123)']);
});
