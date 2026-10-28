// Script inyectado en la página que dibuja el ratón virtual del modelo (un círculo; no captura eventos).
// mode: 'move' (deja el círculo en x,y), 'click' (además lo pulsa con una onda), 'hide'.
module.exports = function cursorScript(x, y, mode) {
  return `(() => {
  let h = document.getElementById('__llm_cursor');
  if (!h) {
    h = document.createElement('div');
    h.id = '__llm_cursor';
    h.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;opacity:0;transition:transform .2s ease-out,opacity .4s';
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;left:-11px;top:-11px;width:22px;height:22px;box-sizing:border-box;border-radius:50%;background:rgba(255,80,60,.35);border:2px solid #ff503c;box-shadow:0 0 0 1px #fff';
    h.append(d);
    document.documentElement.append(h);
  }
  if (${JSON.stringify(mode)} === 'hide') { h.style.opacity = '0'; return; }
  h.style.transform = 'translate(${Math.round(x)}px,${Math.round(y)}px)';
  h.style.opacity = '1';
  if (${JSON.stringify(mode)} === 'click') h.firstChild.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.9)', opacity: .15 }, { transform: 'scale(1)', opacity: 1 }], 350);
})()`;
};
