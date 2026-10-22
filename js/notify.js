// ApexTrack — recordatorios configurables (comidas, agua, hábitos, estudio, gimnasio, peso, resúmenes).
// Con la app cerrada llegan como notificaciones "push": el servidor (server/comunidad.gs) despierta al
// teléfono a la hora indicada y el service worker decide qué mostrar con los datos del día.
// Con la app abierta (o sin servidor) se revisan cada minuto desde acá.
import { COMMUNITY_URL } from './config.js';
import * as store from './store.js';
import { TYPES, defaultReminders, upcomingTimes } from './reminders-core.js';
import { installId } from './community.js';
import { icon } from './icons.js';
import { esc, uid, debounce } from './util.js';
import { openSheet, toast, pickOption, confirmDialog, setBusy } from './ui.js';

const R = () => store.S().settings.reminders;
export const supported = () => typeof Notification !== 'undefined' && 'serviceWorker' in navigator;
const pushOk = () => supported() && 'PushManager' in window && !!COMMUNITY_URL;

export function ensureReminders(settings) {
  if (!settings.reminders || !Array.isArray(settings.reminders.list)) settings.reminders = { on: false, list: defaultReminders(), push: false };
  return settings.reminders;
}

async function reg() {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.ready; } catch { return null; }
}

const b64ToBytes = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

/** Activa los recordatorios: pide permiso y se suscribe a los avisos con la app cerrada. */
export async function enable() {
  if (!supported()) throw new Error('Este navegador no permite notificaciones. Instalá la app desde Chrome.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('No diste permiso para las notificaciones. Activalo en los ajustes del navegador (candado → Notificaciones).');
  const r = R();
  r.on = true;
  store.commit('avisos');
  const out = { push: false };
  if (pushOk()) {
    try { await subscribePush(); out.push = true; } catch (e) { r.pushError = String(e.message || e).slice(0, 140); }
  }
  // respaldo: revisión periódica de Chrome (app instalada), aproximada
  try { const rg = await reg(); if (rg?.periodicSync) await rg.periodicSync.register('avisos', { minInterval: 60 * 60000 }); } catch { /* opcional */ }
  store.commit('avisos');
  return out;
}

export async function disable() {
  const r = R();
  r.on = false; r.push = false;
  store.commit('avisos');
  try {
    const rg = await reg();
    const sub = await rg?.pushManager?.getSubscription();
    if (sub) {
      fetch(COMMUNITY_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ op: 'baja', sub: sub.toJSON() }) }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch { /* */ }
}

async function subscribePush() {
  const rg = await reg();
  if (!rg?.pushManager) throw new Error('Sin soporte de notificaciones push');
  let sub = await rg.pushManager.getSubscription();
  if (!sub) {
    const k = await fetch(`${COMMUNITY_URL}?op=vapid`).then((x) => x.json());
    if (!k?.ok || !k.key) throw new Error('El servidor todavía no tiene los avisos activados (falta correr instalarAvisos).');
    sub = await rg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(k.key) });
  }
  R().push = true; R().pushError = '';
  await syncNow();
}

/** Manda al servidor los horarios de los próximos 14 días (los de hoy ya cumplidos no van). */
export async function syncNow() {
  const r = R();
  if (!r?.on || !r.push || !pushOk() || navigator.onLine === false) return;
  const rg = await reg();
  const sub = await rg?.pushManager?.getSubscription();
  if (!sub) { r.push = false; return; }
  const times = upcomingTimes(store.S(), new Date());
  const key = JSON.stringify(times.slice(0, 40));
  if (key === r.lastSync && Date.now() - (r.lastSyncAt || 0) < 12 * 3600000) return;
  const res = await fetch(COMMUNITY_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ op: 'avisos', sub: sub.toJSON(), times, install: installId() }) }).then((x) => x.json()).catch(() => null);
  if (res?.ok) { r.lastSync = key; r.lastSyncAt = Date.now(); store.save(); }
}
const syncSoon = debounce(() => { syncNow().catch(() => {}); }, 4000);

/** Revisión local (app abierta): el service worker decide y muestra. */
async function tick() {
  if (!R()?.on || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const rg = await reg();
  rg?.active?.postMessage('avisos');
}

export function startReminders() {
  ensureReminders(store.S().settings);
  setTimeout(tick, 5000);
  setInterval(tick, 60000);
  // cada cambio en los datos puede volver innecesario un aviso de hoy (ya almorzaste, ya tomaste agua)
  store.onChange(() => syncSoon());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') syncNow().catch(() => {}); else tick(); });
  setTimeout(() => syncNow().catch(() => {}), 9000);
}

// ---------------------------------------------------------------------------
// Pantalla de configuración
// ---------------------------------------------------------------------------
function describe(r) {
  const S = store.S();
  const days = (r.days || []).length === 7 ? 'todos los días' : (r.days || []).length === 5 && !r.days.includes(0) && !r.days.includes(6) ? 'de lunes a viernes' : (r.days || []).map((d) => ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][d]).join(', ');
  const ref = r.type === 'comida' ? (S.settings.moments.find((m) => m.id === r.ref)?.name || r.ref) : r.type === 'habito' ? (S.settings.habits.find((h) => h.id === r.ref)?.name || r.ref) : '';
  const what = r.type === 'libre' ? (r.text || 'Recordatorio') : `${TYPES[r.type]?.label || r.type}${ref ? `: ${ref}` : ''}`;
  const cond = r.onlyIfMissing && !['dia', 'resumen', 'libre'].includes(r.type) ? (r.type === 'agua' ? ' · si vas atrasado' : ' · solo si no lo hiciste') : '';
  return { what, sub: `${r.time} · ${days}${cond}` };
}

export function openReminders() {
  const S = store.S();
  const r = ensureReminders(S.settings);
  const status = () => {
    if (!supported()) return `<div class="banner">${icon('alert', 20)}<div class="grow">Este navegador no permite notificaciones. Abrí ApexTrack instalada desde Chrome.</div></div>`;
    if (!r.on) return '';
    const perm = Notification.permission;
    if (perm !== 'granted') return `<div class="banner err">${icon('alert', 20)}<div class="grow">El permiso de notificaciones está bloqueado. Activalo en el candado de la barra de direcciones → Notificaciones.</div></div>`;
    return r.push ? `<div class="banner">${icon('check', 20, 'ok')}<div class="grow">Activos. Llegan aunque la app esté cerrada.</div></div>`
      : `<div class="banner">${icon('info', 20)}<div class="grow">Activos mientras la app está abierta o en segundo plano${r.pushError ? ` (${esc(r.pushError)})` : ''}. Con la app cerrada pueden llegar más tarde.</div></div>`;
  };
  const draw = () => `
    <button class="set-row-btn" data-n="master">${icon('bell', 22)}<span class="grow">Recordatorios<small>Comidas, agua, hábitos, estudio, gimnasio, peso y resúmenes</small></span><span class="switch ${r.on ? 'on' : ''}" role="switch" aria-checked="${r.on}"></span></button>
    ${status()}
    <div class="set-group" style="margin-top:12px"><h3>Tus recordatorios</h3>
      ${r.list.map((x) => { const d = describe(x); return `<div class="set-row-btn" style="gap:10px"><button class="grow" style="text-align:left;display:flex;gap:12px;align-items:center" data-n="edit" data-id="${esc(x.id)}">${icon(TYPES[x.type]?.icon || 'bell', 22)}<span class="grow">${esc(d.what)}<small>${esc(d.sub)}</small></span></button><button class="switch ${x.on ? 'on' : ''}" role="switch" aria-checked="${x.on}" aria-label="Activar" data-n="toggle" data-id="${esc(x.id)}"></button></div>`; }).join('')}
    </div>
    <p class="note">Los avisos de comidas, agua, hábitos y estudio se saltean solos si ya lo registraste. El resumen semanal llega el día elegido con el análisis de tu semana.</p>`;
  const s = openSheet({ title: 'Recordatorios', full: true, body: draw(), footer: `<button class="btn" data-n="add">${icon('plus', 18)} Agregar</button><button class="btn primary" data-n="close">Listo</button>` });
  const redraw = () => s.setBody(draw());
  const handler = async (e) => {
    const b = e.target.closest('[data-n]'); if (!b) return;
    const k = b.dataset.n;
    if (k === 'close') { s.close(); return; }
    if (k === 'master') {
      if (r.on) { await disable(); redraw(); toast('Recordatorios apagados'); return; }
      setBusy(b, true, 'Activando…');
      try { const o = await enable(); toast(o.push ? 'Recordatorios activados' : 'Recordatorios activados (con la app abierta)', { ms: 4000 }); } catch (err) { toast(err.message, { kind: 'error', ms: 7000 }); }
      setBusy(b, false); redraw();
    } else if (k === 'toggle') {
      const x = r.list.find((y) => y.id === b.dataset.id); if (!x) return;
      x.on = !x.on; store.commit('avisos'); redraw();
    } else if (k === 'edit') {
      const x = r.list.find((y) => y.id === b.dataset.id); if (x) { await editReminder(x); redraw(); }
    } else if (k === 'add') {
      const type = await pickOption({ title: '¿Qué querés recordar?', options: Object.entries(TYPES).map(([value, t]) => ({ value, label: t.label, icon: t.icon })) });
      if (!type) return;
      const x = { id: uid('r'), type, time: '12:00', days: [0, 1, 2, 3, 4, 5, 6], on: true, onlyIfMissing: !['dia', 'resumen', 'libre'].includes(type) };
      if (await editReminder(x, true)) { r.list.push(x); store.commit('avisos'); }
      redraw();
    }
  };
  s.body.addEventListener('click', handler);
  s.foot.addEventListener('click', handler);
}

async function editReminder(x, isNew = false) {
  const S = store.S();
  if (x.type === 'comida' && (!x.ref || isNew)) {
    const m = await pickOption({ title: '¿Qué comida?', value: x.ref, options: S.settings.moments.map((mo) => ({ value: mo.id, label: mo.name, icon: 'meal' })) });
    if (!m) return false; x.ref = m;
  }
  if (x.type === 'habito' && (!x.ref || isNew)) {
    const h = await pickOption({ title: '¿Qué hábito o suplemento?', value: x.ref, options: S.settings.habits.filter((y) => y.kind !== 'hours').map((y) => ({ value: y.id, label: y.name, icon: y.kind === 'supp' ? 'pill' : 'star' })) });
    if (!h) return false; x.ref = h;
  }
  const w = { ...x, days: [...(x.days || [])] };
  const hasCond = !['dia', 'resumen', 'libre'].includes(w.type);
  const draw = () => {
    const [h, m] = w.time.split(':').map(Number);
    return `
    <div class="time-pick">
      <div class="tp-col"><button class="step-btn" data-e="h+" aria-label="Más hora">${icon('up', 18)}</button><b>${String(h).padStart(2, '0')}</b><button class="step-btn" data-e="h-" aria-label="Menos hora">${icon('down', 18)}</button></div>
      <span class="tp-sep">:</span>
      <div class="tp-col"><button class="step-btn" data-e="m+" aria-label="Más minutos">${icon('up', 18)}</button><b>${String(m).padStart(2, '0')}</b><button class="step-btn" data-e="m-" aria-label="Menos minutos">${icon('down', 18)}</button></div>
    </div>
    <div class="chips" style="justify-content:center;margin-top:14px">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button class="chip ${w.days.includes(d) ? 'on' : ''}" data-e="day" data-d="${d}" aria-pressed="${w.days.includes(d)}">${['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][d]}</button>`).join('')}</div>
    ${hasCond ? `<button class="set-row-btn" style="margin-top:12px" data-e="cond"><span class="grow">${w.type === 'agua' ? 'Solo si voy atrasado con el agua' : 'Solo si todavía no lo hice'}<small>Si ya lo registraste, no te molesta</small></span><span class="switch ${w.onlyIfMissing ? 'on' : ''}" role="switch" aria-checked="${!!w.onlyIfMissing}"></span></button>` : ''}
    <label class="field" style="margin-top:12px"><span>${w.type === 'libre' ? 'Texto del aviso' : 'Texto propio (opcional)'}</span><input class="input" id="rm-text" value="${esc(w.text || '')}" placeholder="${w.type === 'libre' ? 'Ej.: preparar la vianda' : 'Se usa el texto automático'}" autocomplete="off"></label>`;
  };
  const s = openSheet({ title: isNew ? 'Nuevo recordatorio' : (TYPES[w.type]?.label || 'Recordatorio'), body: draw(), footer: `${isNew ? '' : `<button class="btn ghost" data-e="del" aria-label="Borrar">${icon('trash', 18)}</button><button class="btn ghost" data-e="test">Probar</button>`}<button class="btn primary" data-e="save">Guardar</button>` });
  const step = (k) => {
    let [h, m] = w.time.split(':').map(Number);
    if (k === 'h+') h = (h + 1) % 24; else if (k === 'h-') h = (h + 23) % 24;
    else if (k === 'm+') m = (m + 15) % 60; else if (k === 'm-') m = (m + 45) % 60;
    if (k[0] === 'm') m = Math.round(m / 15) * 15 % 60;
    w.time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };
  const readText = () => { const t = s.body.querySelector('#rm-text'); if (t) w.text = t.value.trim(); };
  const handler = async (e) => {
    const b = e.target.closest('[data-e]'); if (!b) return;
    const k = b.dataset.e;
    readText();
    if (/^[hm][+-]$/.test(k)) { step(k); s.setBody(draw()); }
    else if (k === 'day') { const d = Number(b.dataset.d); w.days = w.days.includes(d) ? w.days.filter((y) => y !== d) : [...w.days, d]; s.setBody(draw()); }
    else if (k === 'cond') { w.onlyIfMissing = !w.onlyIfMissing; s.setBody(draw()); }
    else if (k === 'test') { await testReminder(x.id); toast('Te mandé un aviso de prueba'); }
    else if (k === 'del') {
      if (await confirmDialog({ title: '¿Borrar este recordatorio?', ok: 'Borrar', danger: true })) { const r = R(); r.list = r.list.filter((y) => y.id !== x.id); store.commit('avisos'); s.close(false); }
    } else if (k === 'save') {
      if (w.type === 'libre' && !w.text) { toast('Escribí el texto del aviso', { kind: 'error' }); return; }
      if (!w.days.length) w.days = [0, 1, 2, 3, 4, 5, 6];
      Object.assign(x, w);
      store.commit('avisos');
      s.close(true);
    }
  };
  s.body.addEventListener('click', handler);
  s.foot.addEventListener('click', handler);
  return s.done.then((v) => !!v);
}

/** Muestra ya un recordatorio de ejemplo (para probar que llegan). */
export async function testReminder(id) {
  const rg = await reg();
  rg?.active?.postMessage({ type: 'probar-aviso', id });
}
