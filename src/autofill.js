// Rellena un formulario de login en una pestaña. Lo escribe como teclado real (insertText), así los frameworks reaccionan.
// Con login en dos pasos (usuario y luego contraseña) rellena lo que haya a la vista; se vuelve a lanzar en el siguiente paso.
const FOCUS_FIELD = which => `(() => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.disabled && !el.readOnly; };
  const all = [...document.querySelectorAll('input')].filter(vis);
  const pass = all.find(i => i.type === 'password');
  const textual = i => /^(text|email|tel|)$/.test(i.type);
  let el;
  if (${JSON.stringify(which)} === 'password') el = pass;
  else {
    const before = pass ? all.slice(0, all.indexOf(pass)).filter(textual) : all.filter(textual);
    el = before.find(i => /user|email/.test(i.autocomplete)) || before[before.length - 1] || null;
  }
  if (!el) return false;
  el.scrollIntoView({ block: 'center' });
  el.focus();
  el.select();
  return true;
})()`;

async function fillLogin(w, { username, password }) {
  const done = { username: false, password: false };
  if (username && await w.executeJavaScript(FOCUS_FIELD('username'), true)) { await w.insertText(username); done.username = true; }
  if (password && await w.executeJavaScript(FOCUS_FIELD('password'), true)) { await w.insertText(password); done.password = true; }
  return done;
}

// Escribe en el campo con el foco (código TOTP).
async function typeFocused(w, text) {
  const ok = await w.executeJavaScript(`(() => { const e = document.activeElement; return !!e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.isContentEditable); })()`, true);
  if (!ok) return false;
  await w.insertText(text);
  return true;
}

module.exports = { fillLogin, typeFocused };
