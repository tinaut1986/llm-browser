// ==UserScript==
// @name         Reddit Translate
// @namespace    llm-browser
// @version      0.6
// @description  Botón "Traducir" en titulares, posts y comentarios de Reddit (Google Translate)
// @match        https://www.reddit.com/*
// @grant        GM_xmlhttpRequest
// @connect      translate.googleapis.com
// ==/UserScript==
(() => {
  'use strict';
  const TARGET = 'es';
  const cache = new Map();

  const get = (url) => new Promise((ok, ko) => GM_xmlhttpRequest({
    method: 'GET', url, timeout: 15000,
    onload: r => { try { ok(JSON.parse(r.responseText)); } catch { ko(new Error('Google ha bloqueado la petición (¿demasiadas consultas?)')); } },
    onerror: () => ko(new Error('Error de red')),
    ontimeout: () => ko(new Error('Google no responde')),
  }));

  async function translate(text) {
    if (cache.has(text)) return cache.get(text);
    // párrafo a párrafo: el endpoint gtx falla con textos largos
    const out = [];
    for (const p of text.split(/\n{2,}/).filter(Boolean)) {
      const data = await get(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${TARGET}&dt=t&q=${encodeURIComponent(p)}`);
      out.push(data[0].map(s => s[0]).join(''));
    }
    const res = out.join('\n\n');
    cache.set(text, res);
    return res;
  }

  const ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/></svg>';

  // Fila del encabezado donde está "usuario • hace X": el padre del enlace con la fecha
  // (en comentarios la fecha va envuelta en un faceplate-tracker; en el post, no)
  const rowOf = (t) => t && (t.closest('faceplate-tracker')?.parentElement ?? t.parentElement);

  // targets: elementos cuyo texto se traduce (cada uno recibe su propia caja debajo)
  function addButton(host, targets, anchor) {
    if (host.dataset.rtDone) return;
    host.dataset.rtDone = '1';
    const btn = document.createElement('button');
    let shown = false;
    btn.innerHTML = ICON;
    btn.style.cssText = 'display:inline-flex;align-items:center;margin:0 2px;padding:2px 4px;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer;opacity:.6';
    btn.onmouseenter = () => { btn.style.opacity = 1; };
    btn.onmouseleave = () => { btn.style.opacity = shown ? 1 : .6; };
    let pulse;
    // Estado solo con icono: normal / cargando / traducido (azul) / error (rojo)
    const setLabel = (t) => {
      pulse?.cancel(); pulse = null;
      if (t === '…') { // "te he oído, estoy en ello": el icono late mientras dura la traducción
        pulse = btn.animate(
          [{ opacity: .25, transform: 'scale(.85)' }, { opacity: 1, transform: 'scale(1.15)' }],
          { duration: 600, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
      }
      btn.title = btn.ariaLabel = { Traducir: 'Traducir', '…': 'Traduciendo…', Original: 'Mostrar original' }[t] ?? t;
      btn.style.color = t === 'Original' ? '#0079d3' : t === 'Traducir' || t === '…' ? 'inherit' : '#ea0027';
      btn.style.cursor = t === '…' ? 'progress' : 'pointer';
      btn.style.opacity = t === 'Traducir' ? .6 : 1;
    };
    setLabel('Traducir');
    const boxes = targets.map(t => {
      const box = document.createElement('div');
      box.style.cssText = 'display:none;margin:6px 0;padding:6px 10px;border-left:3px solid #0079d3;white-space:pre-wrap;cursor:text';
      box.addEventListener('click', e => e.stopPropagation()); // en el feed la tarjeta entera es un enlace
      t.after(box);
      return box;
    });
    btn.addEventListener('click', async (e) => {
      e.stopPropagation(); e.preventDefault(); // el botón vive dentro del <summary> que pliega el comentario / de la tarjeta-enlace
      if (shown) { boxes.forEach(b => b.style.display = 'none'); setLabel('Traducir'); shown = false; return; }
      setLabel('…');
      try {
        const res = await Promise.all(targets.map(t => translate(t.innerText.trim())));
        boxes.forEach((b, i) => { b.textContent = res[i]; b.style.display = 'block'; });
        setLabel('Original'); shown = true;
      } catch (err) {
        console.error('[Reddit Translate]', err);
        setLabel('Error, reintentar');
        btn.title = 'Error: ' + String(err.message || err) + ' (clic para reintentar)';
      }
    });
    anchor.append(btn);
  }

  function scan(root = document) {
    root.querySelectorAll('shreddit-comment').forEach(c => {
      const own = sel => [...c.querySelectorAll(sel)].find(e => e.closest('shreddit-comment') === c);
      const body = own('[slot="comment"]');
      const row = rowOf(own('faceplate-timeago'));
      if (body && row) addButton(c, [body], row);
    });
    // posts: titular y, si lo hay, el texto (en el feed suele haber solo titular)
    root.querySelectorAll('shreddit-post').forEach(p => {
      const targets = ['[slot="title"]', '[slot="text-body"]'].map(s => p.querySelector(s)).filter(e => e && e.innerText.trim());
      const row = rowOf(p.querySelector('faceplate-timeago'));
      if (targets.length && row) addButton(p, targets, row);
    });
  }

  scan();
  new MutationObserver(() => scan()).observe(document.body, { childList: true, subtree: true });
})();
