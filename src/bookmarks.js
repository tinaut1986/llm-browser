// Bookmark tree: an array of nodes, either { id, type: 'bookmark', title, url } or { id, type: 'folder', title, children }.
// Every function mutates the given tree in place; main.js owns persistence and notifying the windows.
const crypto = require('crypto');

const newId = () => crypto.randomUUID();

// Turns whatever is stored in settings (the old flat { title, url } list included) into a valid tree.
function normalize(list) {
  const walk = nodes => (Array.isArray(nodes) ? nodes : []).flatMap(n => {
    if (!n || typeof n !== 'object') return [];
    const id = typeof n.id === 'string' && n.id ? n.id : newId();
    const title = String(n.title ?? '');
    if (n.type === 'folder' || Array.isArray(n.children)) return [{ id, type: 'folder', title, children: walk(n.children) }];
    if (typeof n.url !== 'string' || !n.url) return [];
    return [{ id, type: 'bookmark', title: title || n.url, url: n.url }];
  });
  return walk(list);
}

function find(tree, id) {
  for (let i = 0; i < tree.length; i++) {
    const node = tree[i];
    if (node.id === id) return { node, siblings: tree, index: i };
    if (node.type === 'folder') {
      const found = find(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

// null parentId means the top level (the bookmarks bar).
function childrenOf(tree, parentId) {
  if (parentId == null) return tree;
  const found = find(tree, parentId);
  return found?.node.type === 'folder' ? found.node.children : null;
}

function insert(tree, node, parentId, index) {
  const list = childrenOf(tree, parentId);
  if (!list) throw new Error('Folder not found');
  const at = Number.isInteger(index) ? Math.max(0, Math.min(index, list.length)) : list.length;
  list.splice(at, 0, node);
  return node;
}

const addBookmark = (tree, { title, url }, parentId, index) =>
  insert(tree, { id: newId(), type: 'bookmark', title: title || url, url }, parentId, index);

const addFolder = (tree, title, parentId, index) =>
  insert(tree, { id: newId(), type: 'folder', title: title || 'Carpeta nueva', children: [] }, parentId, index);

function update(tree, id, { title, url }) {
  const found = find(tree, id);
  if (!found) throw new Error('Bookmark not found');
  if (typeof title === 'string' && title.trim()) found.node.title = title.trim();
  if (found.node.type === 'bookmark' && typeof url === 'string' && url.trim()) found.node.url = url.trim();
}

function remove(tree, id) {
  const found = find(tree, id);
  if (!found) return false;
  found.siblings.splice(found.index, 1);
  return true;
}

// Removes every bookmark pointing at url (the star button toggles by page, not by node). Returns how many.
function removeByUrl(tree, url) {
  let removed = 0;
  const walk = list => {
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      if (n.type === 'folder') walk(n.children);
      else if (n.url === url) { list.splice(i, 1); removed++; }
    }
  };
  walk(tree);
  return removed;
}

const hasUrl = (tree, url) => tree.some(n => (n.type === 'folder' ? hasUrl(n.children, url) : n.url === url));

function move(tree, id, parentId, index) {
  const from = find(tree, id);
  if (!from) throw new Error('Bookmark not found');
  if (from.node.type === 'folder' && (id === parentId || find(from.node.children, parentId))) throw new Error('A folder cannot be moved into itself');
  const target = childrenOf(tree, parentId);
  if (!target) throw new Error('Folder not found');
  let at = Number.isInteger(index) ? index : target.length;
  if (from.siblings === target && from.index < at) at--; // the node leaves its slot before it lands
  from.siblings.splice(from.index, 1);
  insert(tree, from.node, parentId, at);
}

// Every bookmark URL under a node, depth first.
const urls = node => (node.type === 'folder' ? node.children.flatMap(urls) : [node.url]);

module.exports = { normalize, find, addBookmark, addFolder, update, remove, removeByUrl, hasUrl, move, urls };
