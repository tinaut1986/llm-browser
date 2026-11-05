const test = require('node:test');
const assert = require('node:assert');
const B = require('../src/bookmarks');

const titles = list => list.map(n => n.title);

function sample() {
  const tree = [];
  B.addBookmark(tree, { title: 'a', url: 'https://a' });
  const folder = B.addFolder(tree, 'f');
  B.addBookmark(tree, { title: 'b', url: 'https://b' }, folder.id);
  B.addBookmark(tree, { title: 'c', url: 'https://c' });
  return { tree, folder };
}

test('normalize migrates the old flat list and drops junk', () => {
  const tree = B.normalize([{ title: 'x', url: 'https://x' }, { url: 'https://y' }, null, { title: 'no url' }]);
  assert.deepStrictEqual(tree.map(n => [n.type, n.title, n.url]), [['bookmark', 'x', 'https://x'], ['bookmark', 'https://y', 'https://y']]);
  assert.ok(tree.every(n => n.id));
  assert.deepStrictEqual(B.normalize(undefined), []);
});

test('normalize keeps folders and their children', () => {
  const tree = B.normalize([{ id: '1', type: 'folder', title: 'f', children: [{ id: '2', title: 'x', url: 'https://x' }] }]);
  assert.strictEqual(tree[0].children[0].id, '2');
  assert.strictEqual(tree[0].children[0].type, 'bookmark');
});

test('add inserts at the given index and into folders', () => {
  const { tree, folder } = sample();
  B.addBookmark(tree, { title: 'first', url: 'https://first' }, null, 0);
  B.addBookmark(tree, { title: 'inside', url: 'https://inside' }, folder.id, 0);
  assert.deepStrictEqual(titles(tree), ['first', 'a', 'f', 'c']);
  assert.deepStrictEqual(titles(folder.children), ['inside', 'b']);
  assert.throws(() => B.addBookmark(tree, { url: 'https://z' }, 'missing'));
});

test('move reorders within the same list', () => {
  const { tree } = sample();
  B.move(tree, tree[0].id, null, 3); // index 3 is the end of the list
  assert.deepStrictEqual(titles(tree), ['f', 'c', 'a']);
  B.move(tree, tree[2].id, null, 1);
  assert.deepStrictEqual(titles(tree), ['f', 'a', 'c']);
  B.move(tree, tree[0].id, null, 2); // dropped between a and c
  assert.deepStrictEqual(titles(tree), ['a', 'f', 'c']);
});

test('move into a folder, and refuses folder cycles', () => {
  const { tree, folder } = sample();
  B.move(tree, tree[0].id, folder.id);
  assert.deepStrictEqual(titles(folder.children), ['b', 'a']);
  assert.throws(() => B.move(tree, folder.id, folder.id));
  const inner = B.addFolder(tree, 'inner', folder.id);
  assert.throws(() => B.move(tree, folder.id, inner.id));
});

test('update renames and retargets', () => {
  const { tree } = sample();
  B.update(tree, tree[0].id, { title: ' renamed ', url: 'https://new' });
  assert.deepStrictEqual([tree[0].title, tree[0].url], ['renamed', 'https://new']);
  B.update(tree, tree[1].id, { title: 'g', url: 'ignored' });
  assert.strictEqual(tree[1].url, undefined);
});

test('remove, removeByUrl and hasUrl look inside folders', () => {
  const { tree, folder } = sample();
  assert.ok(B.hasUrl(tree, 'https://b'));
  assert.strictEqual(B.removeByUrl(tree, 'https://b'), 1);
  assert.strictEqual(B.hasUrl(tree, 'https://b'), false);
  assert.strictEqual(B.remove(tree, folder.id), true);
  assert.strictEqual(B.remove(tree, folder.id), false);
  assert.deepStrictEqual(titles(tree), ['a', 'c']);
});

test('urls lists every bookmark under a folder', () => {
  const { tree, folder } = sample();
  const inner = B.addFolder(tree, 'inner', folder.id);
  B.addBookmark(tree, { title: 'd', url: 'https://d' }, inner.id);
  assert.deepStrictEqual(B.urls(folder), ['https://b', 'https://d']);
});
