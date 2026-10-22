// ApexTrack — componentes de interfaz: hojas inferiores, selectores, calendario, avisos.
import { icon } from './icons.js';
import { esc, todayISO, addMonths, monthStart, parseISO, isoDate, addDays, MESES, fmtDayLong, cap, vibrate, parseNum } from './util.js';

// ---------- Hojas (bottom sheets) con soporte del botón atrás de Android ----------
const stack = [];
let ignorePop = 0;
let deferredBack = null;
let backCount = 0;
let rootBack = null;
export function setRootBack(fn) { rootBack = fn; }

window.addEventListener('popstate', () => {
  if (ignorePop > 0) { ignorePop--; return; }
  if (stack.length) { stack[stack.length - 1].close(undefined, true); return; }
  if (rootBack) rootBack();
});

export function sheetsOpen() { return stack.length; }

/**
 * Abre una hoja inferior. Devuelve { el, body, foot, close(result), setTitle, done (Promise) }
 */
export function openSheet({ title = '', body = '', footer = '', cls = '', full = false, onClose = null, dismissable = true } = {}) {
  const host = document.getElementById('sheets');
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="scrim"></div>
    <section class="sheet ${full ? 'sheet-full' : ''} ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="sheet-head">
        <div class="grab" aria-hidden="true"></div>
        <h2 class="sheet-title">${esc(title)}</h2>
        <button class="icon-btn sheet-x" data-sheet-close aria-label="Cerrar">${icon('x', 22)}</button>
      </header>
      <div class="sheet-body">${body}</div>
      <footer class="sheet-foot" ${footer ? '' : 'hidden'}>${footer}</footer>
    </section>`;
  host.appendChild(wrap);
  document.body.classList.add('has-sheet');
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  const s = {
    el: wrap,
    sheet: wrap.querySelector('.sheet'),
    body: wrap.querySelector('.sheet-body'),
    foot: wrap.querySelector('.sheet-foot'),
    done,
    closed: false,
    setTitle(t) { wrap.querySelector('.sheet-title').textContent = t; },
    setFooter(html) { s.foot.innerHTML = html; s.foot.hidden = !html; },
    setBody(html) { s.body.innerHTML = html; },
    close(result, fromPop = false) {
      if (s.closed) return;
      s.closed = true;
      const i = stack.indexOf(s);
      if (i >= 0) stack.splice(i, 1);
      // Volver atrás en el historial se hace un instante después: si enseguida se abre otra hoja
      // (elegir una opción y pasar al formulario), se reutiliza la misma entrada y no se desordena.
      if (!fromPop) { backCount++; clearTimeout(deferredBack); deferredBack = setTimeout(() => { const n = backCount; deferredBack = null; backCount = 0; if (n > 0) { ignorePop++; history.go(-n); } }, 60); }
      wrap.classList.add('closing');
      setTimeout(() => { wrap.remove(); if (!stack.length) document.body.classList.remove('has-sheet'); }, 220);
      if (onClose) { try { onClose(result); } catch (e) { console.error(e); } }
      resolveDone(result);
    },
  };
  stack.push(s);
  if (backCount > 0) { backCount--; history.replaceState({ sheet: stack.length }, ''); if (!backCount) { clearTimeout(deferredBack); deferredBack = null; } } else history.pushState({ sheet: stack.length }, '');
  requestAnimationFrame(() => wrap.classList.add('open'));
  wrap.querySelector('.scrim').addEventListener('click', () => { if (dismissable) s.close(); });
  wrap.querySelector('[data-sheet-close]').addEventListener('click', () => s.close());
  // deslizar hacia abajo para cerrar
  const head = wrap.querySelector('.sheet-head');
  let y0 = null; let dy = 0;
  head.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; y0 = e.clientY; dy = 0; s.sheet.style.transition = 'none'; head.setPointerCapture(e.pointerId); });
  head.addEventListener('pointermove', (e) => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); s.sheet.style.transform = `translateY(${dy}px)`; });
  const end = () => { if (y0 == null) return; y0 = null; s.sheet.style.transition = ''; s.sheet.style.transform = ''; if (dy > 110 && dismissable) s.close(); };
  head.addEventListener('pointerup', end); head.addEventListener('pointercancel', end);
  return s;
}

export function closeAllSheets() { while (stack.length) stack[stack.length - 1].close(); }

// ---------- Aviso breve (toast) con acción opcional ----------
let toastTimer = null;
export function toast(msg, { action = '', onAction = null, ms = 3200, kind = '' } = {}) {
  const el = document.getElementById('toast');
  el.className = `toast show ${kind}`;
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="toast-act">${esc(action)}</button>` : ''}`;
  if (action && onAction) el.querySelector('.toast-act').onclick = () => { el.classList.remove('show'); onAction(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------- Confirmación ----------
export function confirmDialog({ title = '¿Seguro?', text = '', ok = 'Aceptar', cancel = 'Cancelar', danger = false } = {}) {
  const s = openSheet({
    title, cls: 'sheet-compact',
    body: text ? `<p class="muted pad">${esc(text)}</p>` : '',
    footer: `<button class="btn ghost" data-r="0">${esc(cancel)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button>`,
  });
  s.foot.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) s.close(b.dataset.r === '1'); });
  return s.done.then((r) => !!r);
}

// ---------- Selector de opción (reemplaza los <select> nativos) ----------
export function pickOption({ title = 'Elegí', options = [], value = null, allowCustom = false, customLabel = 'Otro…' } = {}) {
  const list = options.map((o) => `
    <button class="opt ${o.value === value ? 'on' : ''}" data-v="${esc(o.value)}">
      <span class="opt-main">${o.icon ? icon(o.icon, 20) : ''}<span>${esc(o.label)}${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</span></span>
      ${o.value === value ? icon('check', 20, 'opt-check') : ''}
    </button>`).join('');
  const s = openSheet({ title, cls: 'sheet-compact', body: `<div class="opt-list">${list}${allowCustom ? `<button class="opt" data-custom="1"><span class="opt-main">${icon('plus', 20)}<span>${esc(customLabel)}</span></span></button>` : ''}</div>` });
  s.body.addEventListener('click', async (e) => {
    const b = e.target.closest('.opt');
    if (!b) return;
    vibrate(8);
    if (b.dataset.custom) {
      const v = await promptText({ title: customLabel, label: 'Nombre' });
      if (v) s.close({ custom: v });
      return;
    }
    const opt = options.find((o) => String(o.value) === b.dataset.v);
    s.close(opt ? opt.value : b.dataset.v);
  });
  return s.done;
}

// ---------- Campo de texto simple ----------
export function promptText({ title = '', label = '', value = '', placeholder = '', type = 'text', inputmode = '', suffix = '' } = {}) {
  const s = openSheet({
    title, cls: 'sheet-compact',
    body: `<label class="field"><span>${esc(label)}</span><div class="input-wrap"><input class="input" type="${type}" ${inputmode ? `inputmode="${inputmode}"` : ''} value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">${suffix ? `<em>${esc(suffix)}</em>` : ''}</div></label>`,
    footer: `<button class="btn ghost" data-r="0">Cancelar</button><button class="btn primary" data-r="1">Listo</button>`,
  });
  const inp = s.body.querySelector('input');
  setTimeout(() => { inp.focus(); inp.select?.(); }, 250);
  const submit = () => s.close(inp.value.trim());
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  s.foot.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (!b) return; if (b.dataset.r === '1') submit(); else s.close(null); });
  return s.done.then((v) => (v === undefined ? null : v));
}

/** Formulario con varios campos numéricos o de texto. fields: [{key,label,value,type,suffix,step,placeholder,full}] */
export function formSheet({ title = '', intro = '', fields = [], submitText = 'Guardar', extraFooter = '' } = {}) {
  const html = `${intro ? `<p class="muted pad-b">${intro}</p>` : ''}<div class="form-grid">${fields.map((f) => {
    if (f.type === 'textarea') return `<label class="field full"><span>${esc(f.label)}</span><textarea class="input" data-k="${f.key}" rows="${f.rows || 3}" placeholder="${esc(f.placeholder || '')}">${esc(f.value ?? '')}</textarea></label>`;
    if (f.type === 'date') return `<div class="field ${f.full ? 'full' : ''}"><span>${esc(f.label)}</span><button class="input date-field" data-k="${f.key}" data-date="${esc(f.value)}">${icon('calendar', 18)}<span>${esc(cap(fmtDayLong(f.value)))}</span></button></div>`;
    const num = f.type === 'number';
    return `<label class="field ${f.full ? 'full' : ''}"><span>${esc(f.label)}</span><div class="input-wrap"><input class="input" data-k="${f.key}" type="${num ? 'text' : (f.type || 'text')}" ${num ? 'inputmode="decimal"' : ''} value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" autocomplete="off">${f.suffix ? `<em>${esc(f.suffix)}</em>` : ''}</div></label>`;
  }).join('')}</div>`;
  const s = openSheet({ title, body: html, footer: `${extraFooter}<button class="btn ghost" data-r="0">Cancelar</button><button class="btn primary" data-r="1">${esc(submitText)}</button>` });
  s.body.addEventListener('click', async (e) => {
    const b = e.target.closest('.date-field');
    if (!b) return;
    const fd = fields.find((x) => x.key === b.dataset.k) || {};
    const d = await pickDate({ value: b.dataset.date, max: fd.max || null, title: fd.label || 'Elegí un día' });
    if (d) { b.dataset.date = d; b.querySelector('span').textContent = cap(fmtDayLong(d)); }
  });
  s.foot.addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    if (b.dataset.r !== '1') { s.close(null); return; }
    const out = {};
    for (const f of fields) {
      const el = s.body.querySelector(`[data-k="${f.key}"]`);
      if (!el) continue;
      if (f.type === 'date') out[f.key] = el.dataset.date;
      else if (f.type === 'number') { const v = parseNum(el.value); out[f.key] = Number.isFinite(v) ? v : (el.value.trim() === '' ? '' : NaN); }
      else out[f.key] = el.value;
    }
    s.close(out);
  });
  return s.done.then((v) => (v === undefined ? null : v));
}

// ---------- Calendario propio (sin el selector nativo) ----------
/**
 * marks(iso) → 'meta' | 'cerca' | 'bajo' | 'dato' | null  (puntito de color)
 */
export function pickDate({ title = 'Elegí un día', value = todayISO(), max = null, marks = null } = {}) {
  let month = monthStart(value);
  const today = todayISO();
  const maxD = max || addDays(today, 1);
  const s = openSheet({ title, cls: 'sheet-compact sheet-cal', body: '<div class="cal"></div>', footer: `<button class="btn ghost" data-go="today">${icon('today', 18)} Hoy</button><button class="btn ghost" data-go="yesterday">Ayer</button>` });
  const box = s.body.querySelector('.cal');
  const render = () => {
    const first = parseISO(month);
    const lead = (first.getDay() + 6) % 7;
    const start = addDays(month, -lead);
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      const inMonth = d.slice(0, 7) === month.slice(0, 7);
      if (i >= 35 && !inMonth && cells.length >= 35) break;
      const mk = marks ? marks(d) : null;
      const dis = d > maxD;
      cells.push(`<button class="cal-d ${inMonth ? '' : 'out'} ${d === value ? 'sel' : ''} ${d === today ? 'tod' : ''}" data-d="${d}" ${dis ? 'disabled' : ''}>
        <span>${parseISO(d).getDate()}</span>${mk ? `<i class="dot ${mk}"></i>` : ''}</button>`);
    }
    const m = parseISO(month);
    box.innerHTML = `
      <div class="cal-head">
        <button class="icon-btn" data-nav="-1" aria-label="Mes anterior">${icon('left')}</button>
        <strong>${cap(MESES[m.getMonth()])} ${m.getFullYear()}</strong>
        <button class="icon-btn" data-nav="1" aria-label="Mes siguiente" ${addMonths(month, 1) > maxD ? 'disabled' : ''}>${icon('right')}</button>
      </div>
      <div class="cal-w">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((x) => `<span>${x}</span>`).join('')}</div>
      <div class="cal-g">${cells.join('')}</div>
      ${marks ? '<div class="cal-legend"><span><i class="dot meta"></i>en meta</span><span><i class="dot cerca"></i>cerca</span><span><i class="dot bajo"></i>bajo</span></div>' : ''}`;
  };
  render();
  box.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { month = addMonths(month, Number(nav.dataset.nav)); render(); return; }
    const d = e.target.closest('[data-d]');
    if (d && !d.disabled) { vibrate(8); s.close(d.dataset.d); }
  });
  // deslizar entre meses
  let x0 = null;
  box.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  box.addEventListener('pointerup', (e) => {
    if (x0 == null) return;
    const dx = e.clientX - x0; x0 = null;
    if (Math.abs(dx) > 60) { const nm = addMonths(month, dx < 0 ? 1 : -1); if (nm <= maxD) { month = nm; render(); } }
  });
  s.foot.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    s.close(b.dataset.go === 'today' ? today : addDays(today, -1));
  });
  return s.done.then((v) => v || null);
}

// ---------- Utilidades de interacción ----------
export function onLongPress(el, fn, ms = 520) {
  let t = null;
  el.addEventListener('pointerdown', (e) => { t = setTimeout(() => { t = null; vibrate(20); fn(e); }, ms); });
  const cancel = () => { if (t) { clearTimeout(t); t = null; } };
  el.addEventListener('pointerup', cancel); el.addEventListener('pointerleave', cancel); el.addEventListener('pointercancel', cancel);
}

export function setBusy(btn, busy, text) {
  if (!btn) return;
  if (busy) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.classList.add('busy'); if (text) btn.innerHTML = `<span class="spin"></span><span>${esc(text)}</span>`; }
  else { btn.disabled = false; btn.classList.remove('busy'); if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}

export { isoDate };

// ---------- Deslizar con animación ----------
/**
 * swipes[nombre] = (dir) => boolean. dir = 1 siguiente (el dedo va a la izquierda), -1 anterior.
 * Un elemento con data-swipe="nombre" sigue al dedo y, si cambia, el contenido nuevo entra deslizándose.
 * Si el gesto empieza fuera de un [data-swipe] y fuera de algo que se desplaza de costado, swipes.$tab cambia de pestaña.
 */
export const swipes = {};
let dragging = false;

const SLIDE_CLS = ['slide-from-r', 'slide-from-l', 'tab-from-r', 'tab-from-l'];
export function slideIn(el, dir, kind = 'slide') {
  if (!el || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  el.classList.remove(...SLIDE_CLS, 'anim-done');
  void el.offsetWidth;
  el.classList.add(`${kind}-from-${dir > 0 ? 'r' : 'l'}`);
  el.addEventListener('animationend', () => { el.classList.remove(...SLIDE_CLS); el.classList.add('anim-done'); }, { once: true });
}

function scrollsSideways(el, stop) {
  for (let n = el; n && n !== stop && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 2) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
  }
  return false;
}

(function swipeEngine() {
  let g = null; // gesto en curso
  const NO_TAB = 'input, textarea, select, .chip-row, .chart-box, .chart, .tabbar, .slot-menu, .timer-pill, .sheet-wrap, [data-sort-item], .no-swipe';
  document.addEventListener('touchstart', (e) => {
    g = null;
    if (e.touches.length !== 1 || dragging) return;
    const t = e.touches[0];
    const target = e.target.closest?.('[data-swipe]');
    if (target && target.closest('.sheet-wrap') && !swipes[target.dataset.swipe]) return;
    let name = target?.dataset.swipe || null;
    if (!name) {
      if (stack.length || !swipes.$tab || !e.target.closest?.('#view') || e.target.closest(NO_TAB) || scrollsSideways(e.target, document.getElementById('view'))) return;
      name = '$tab';
    }
    g = { name, el: name === '$tab' ? document.getElementById('view') : target, x0: t.clientX, y0: t.clientY, dx: 0, axis: null };
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!g || dragging) return;
    const t = e.touches[0];
    const dx = t.clientX - g.x0; const dy = t.clientY - g.y0;
    if (!g.axis) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      g.axis = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'x' : 'y';
      if (g.axis === 'y') { g = null; return; }
      g.el.style.transition = 'none';
      g.el.style.willChange = 'transform';
    }
    // gesto de costado: que el navegador no desplace la página ni mueva sus barras mientras tanto
    if (e.cancelable) e.preventDefault();
    g.dx = dx;
    g.el.style.transform = `translate3d(${dx * (g.name === '$tab' ? 0.3 : 0.6)}px,0,0)`;
  }, { passive: false });
  const end = () => {
    if (!g) return;
    const { name, el, dx, axis } = g; g = null;
    if (axis !== 'x') return;
    // el soltar de un deslizamiento no es un toque (el contenido nuevo puede quedar bajo el dedo)
    const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    document.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', stop, { capture: true }), 400);
    const back = () => { el.style.transition = 'transform .2s ease'; el.style.transform = ''; setTimeout(() => { el.style.transition = ''; }, 220); };
    const min = name === '$tab' ? 80 : 50;
    if (Math.abs(dx) < min) { back(); return; }
    const dir = dx < 0 ? 1 : -1;
    let moved = false;
    try { moved = !!swipes[name]?.(dir); } catch (err) { console.error(err); }
    if (!moved) { back(); setTimeout(() => { el.style.willChange = ''; }, 220); return; }
    el.style.transition = ''; el.style.transform = ''; el.style.willChange = '';
    vibrate(6);
    const fresh = name === '$tab' ? document.getElementById('view') : document.querySelector(`[data-swipe="${name}"]`);
    slideIn(fresh || el, dir, name === '$tab' ? 'tab' : 'slide');
  };
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', () => { if (g) { g.el.style.transform = ''; g.el.style.transition = ''; g.el.style.willChange = ''; } g = null; }, { passive: true });
  // con mouse (computadora): solo los [data-swipe], sin seguir al puntero
  let m = null;
  document.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') return; const t = e.target.closest?.('[data-swipe]'); m = t ? { name: t.dataset.swipe, x0: e.clientX, y0: e.clientY } : null; });
  document.addEventListener('pointerup', (e) => {
    if (!m || e.pointerType !== 'mouse') return;
    const dx = e.clientX - m.x0; const dy = e.clientY - m.y0; const { name } = m; m = null;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) { const dir = dx < 0 ? 1 : -1; if (swipes[name]?.(dir)) slideIn(document.querySelector(`[data-swipe="${name}"]`), dir); }
  });
})();

// ---------- Ordenar arrastrando (mantener apretado) ----------
/**
 * Dentro de un [data-sort="nombre"], cada hijo [data-sort-item] se puede mantener apretado y arrastrar.
 * Un [data-sort-handle] arrastra al instante. Al soltar se dispara el evento "sorted" en el contenedor
 * con detail { from, to, name }.
 */
(function sortEngine() {
  let p = null; // { box, el, items, from, y0, grab, timer, active, id, scroller, raf, lastY }
  const SKIP = 'input, textarea, select, button:not([data-sort-handle]), a, [contenteditable]';
  const scrollerOf = (el) => { for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) { const oy = getComputedStyle(n).overflowY; if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n; } return null; };
  const place = () => {
    const { el, lastY } = p;
    const sibs = [...p.box.querySelectorAll(':scope > [data-sort-item]')];
    const i = sibs.indexOf(el);
    const prev = sibs[i - 1]; const next = sibs[i + 1];
    if (prev) { const r = prev.getBoundingClientRect(); if (lastY < r.top + r.height / 2) { p.box.insertBefore(el, prev); } }
    if (next) { const r = next.getBoundingClientRect(); if (lastY > r.top + r.height / 2) { p.box.insertBefore(next, el); } }
    el.style.transform = 'none';
    const top = el.getBoundingClientRect().top;
    el.style.transform = `translateY(${lastY - p.grab - top}px) scale(1.02)`;
  };
  const loop = () => {
    if (!p?.active) return;
    const h = window.innerHeight; const edge = 70;
    const sp = p.lastY < edge ? -(edge - p.lastY) / 4 : p.lastY > h - edge - 70 ? (p.lastY - (h - edge - 70)) / 4 : 0;
    if (sp) { if (p.scroller) p.scroller.scrollTop += sp; else window.scrollBy(0, sp); place(); }
    p.raf = requestAnimationFrame(loop);
  };
  const activate = () => {
    if (!p) return;
    p.active = true; dragging = true;
    p.from = [...p.box.querySelectorAll(':scope > [data-sort-item]')].indexOf(p.el);
    p.grab = p.y0 - p.el.getBoundingClientRect().top;
    p.lastY = p.y0;
    p.scroller = scrollerOf(p.box);
    p.el.classList.add('sorting'); p.box.classList.add('sort-on');
    vibrate(25);
    place();
    p.raf = requestAnimationFrame(loop);
  };
  const finish = (cancel) => {
    if (!p) return;
    clearTimeout(p.timer);
    const was = p; p = null;
    if (!was.active) return;
    cancelAnimationFrame(was.raf);
    dragging = false;
    was.el.classList.remove('sorting'); was.box.classList.remove('sort-on');
    was.el.style.transform = '';
    const to = [...was.box.querySelectorAll(':scope > [data-sort-item]')].indexOf(was.el);
    if (!cancel && to !== was.from) was.box.dispatchEvent(new CustomEvent('sorted', { bubbles: true, detail: { from: was.from, to, name: was.box.dataset.sort } }));
    // evitar que el soltar se tome como un toque
    const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
    document.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', stop, { capture: true }), 350);
  };
  document.addEventListener('pointerdown', (e) => {
    if (p || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const el = e.target.closest?.('[data-sort-item]');
    const box = el?.parentElement;
    if (!el || !box?.matches('[data-sort]')) return;
    const handle = e.target.closest('[data-sort-handle]');
    if (!handle && e.target.closest(SKIP)) return;
    p = { box, el, x0: e.clientX, y0: e.clientY, active: false, id: e.pointerId };
    if (handle) activate(); else p.timer = setTimeout(activate, 450);
  });
  document.addEventListener('pointermove', (e) => {
    if (!p || e.pointerId !== p.id) return;
    if (!p.active) { if (Math.abs(e.clientX - p.x0) > 9 || Math.abs(e.clientY - p.y0) > 9) { clearTimeout(p.timer); p = null; } return; }
    p.lastY = e.clientY; place();
  });
  document.addEventListener('touchmove', (e) => { if (p?.active) e.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', (e) => { if (p) e.preventDefault(); });
  document.addEventListener('pointerup', () => finish(false));
  document.addEventListener('pointercancel', () => finish(!p?.active));
})();
