// Script inyectado en la página: devuelve un esquema textual con refs [n] para elementos interactivos.
module.exports = function snapshotScript(viewportOnly) {
  return `(() => {
  const viewportOnly = ${viewportOnly ? 'true' : 'false'};
  const INTERACTIVE = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=switch],[role=option],[role=combobox],[onclick],[contenteditable=""],[contenteditable=true],[tabindex]:not([tabindex="-1"])';
  window.__llmRefs = [];
  const lines = [];
  const vw = innerWidth, vh = innerHeight;
  const norm = s => (s || '').replace(/\\s+/g, ' ').trim();
  const visible = el => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const inView = el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw; };
  const label = el => norm(el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || '').slice(0, 120);
  function walk(node) {
    if (node.nodeType === 3) { const t = norm(node.textContent); if (t) lines.push(t); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (['script', 'style', 'noscript', 'template', 'svg', 'head'].includes(tag)) return;
    if (!visible(node)) return;
    if (viewportOnly && !inView(node) && !node.shadowRoot) return;
    if (node.matches(INTERACTIVE)) {
      const id = window.__llmRefs.length;
      window.__llmRefs.push(node);
      let desc = '[' + id + '] ' + tag;
      const type = node.getAttribute('type'); if (type) desc += ':' + type;
      const role = node.getAttribute('role'); if (role) desc += ' role=' + role;
      const l = label(node); if (l) desc += ' "' + l + '"';
      if (tag === 'a' && node.href) desc += ' -> ' + node.href;
      if (tag === 'input' || tag === 'textarea') { if (node.type !== 'password' && node.value) desc += ' value="' + node.value.slice(0, 80) + '"'; if (node.checked) desc += ' checked'; }
      if (tag === 'select') desc += ' value="' + (node.selectedOptions[0] ? norm(node.selectedOptions[0].text) : '') + '"';
      if (node.disabled) desc += ' disabled';
      lines.push(desc);
      // Contenedores genéricos (p. ej. <details role=article>) conservan su contenido; los controles reales son hojas.
      if (!/^(a|button|input|select|textarea|summary|option)$/.test(tag) && !/^(button|link|checkbox|radio|tab|menuitem|switch|option|combobox)$/.test(role || '')) {
        const root = node.shadowRoot || node;
        for (const c of root.childNodes) walk(c);
      }
      return;
    }
    if (/^h[1-6]$/.test(tag)) { lines.push('#'.repeat(+tag[1]) + ' ' + norm(node.innerText)); return; }
    if (tag === 'img') { const a = norm(node.alt); if (a) lines.push('[img "' + a + '"]'); return; }
    if (tag === 'iframe') { try { node.contentDocument && walk(node.contentDocument.body); } catch (e) { lines.push('[iframe ' + node.src + ' (inaccesible)]'); } return; }
    const root = node.shadowRoot || node;
    for (const c of root.childNodes) walk(c);
    if (root !== node) for (const c of node.childNodes) if (c.nodeType === 1 && c.assignedSlot) walk(c);
  }
  walk(document.body);
  const out = lines.join('\\n');
  return { title: document.title, url: location.href, scrollY: Math.round(scrollY), scrollMax: Math.round(document.documentElement.scrollHeight - vh), text: out.length > 60000 ? out.slice(0, 60000) + '\\n...[truncado]' : out, refs: window.__llmRefs.length };
})()`;
};
