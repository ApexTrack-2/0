// ApexTrack — ayuno intermitente: protocolo (16:8, 18:6…), cronómetro, historial y aviso al completarlo.
// Es una herramienta opcional, pensada sobre todo para quien tiene el objetivo de bajar de peso.
import { fmt, esc, todayISO, addDays, uid } from './util.js';
import * as store from './store.js';
import * as EN from './energy.js';
import { icon } from './icons.js';
import { openSheet, toast, pickOption, confirmDialog } from './ui.js';

export const PROTOCOLS = {
  '12:12': { h: 12, label: '12:12', sub: 'Para empezar: 12 horas sin comer (incluye la noche)' },
  '14:10': { h: 14, label: '14:10', sub: 'Suave: cenar temprano y desayunar un poco más tarde' },
  '16:8': { h: 16, label: '16:8', sub: 'El más usado: 16 horas de ayuno y 8 de comidas' },
  '18:6': { h: 18, label: '18:6', sub: 'Más exigente: ventana de comidas de 6 horas' },
  '20:4': { h: 20, label: '20:4', sub: 'Avanzado: ventana de 4 horas' },
  '23:1': { h: 23, label: 'Una comida al día', sub: 'Solo con experiencia y supervisión' },
};
// Etapas aproximadas (orientativas: varían según la persona y lo que comió antes)
const STAGES = [
  [0, 'Digestión', 'El cuerpo usa lo que comiste.'],
  [4, 'Bajan el azúcar y la insulina', 'Empieza a usar sus reservas.'],
  [12, 'Más uso de grasa', 'Las reservas de glucógeno bajan y aumenta el uso de grasa.'],
  [16, 'Uso de grasa alto', 'Buen momento para cortar si es tu meta.'],
  [20, 'Ayuno largo', 'Tomá agua y no lo estires si te sentís mal.'],
];

export function F() {
  const S = store.S();
  if (!S.fasting || typeof S.fasting !== 'object') S.fasting = { protocol: '16:8', active: null, history: [], dismissed: false };
  if (!Array.isArray(S.fasting.history)) S.fasting.history = [];
  return S.fasting;
}
const goalH = () => (F().active?.goalH) || PROTOCOLS[F().protocol]?.h || 16;
const dur = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); const h = Math.floor(m / 60); return h ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`; };
const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const hhmm = (t) => new Date(t).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function stats() {
  const h = F().history.filter((x) => x.end - x.start > 3600000);
  const last7 = h.filter((x) => x.end > Date.now() - 7 * 86400000);
  const done = (x) => (x.end - x.start) / 3600000 >= x.goalH * 0.97;
  let streak = 0;
  for (let d = todayISO(), i = 0; i < 60; i++, d = addDays(d, -1)) {
    const ok = h.some((x) => new Date(x.end).toLocaleDateString('sv-SE') === d && done(x));
    if (ok) streak++; else if (i > 0 || F().active) break;
  }
  return { n: last7.length, done: last7.filter(done).length, avgH: last7.length ? last7.reduce((a, x) => a + (x.end - x.start), 0) / last7.length / 3600000 : 0, streak };
}

export function fastingCard() {
  const f = F();
  if (f.active) {
    const el = Date.now() - f.active.start; const g = f.active.goalH * 3600000;
    return `<button class="banner info" style="width:100%;text-align:left;margin-top:10px" data-act="fast-tab">${icon('timer', 20)}<div class="grow"><b>Ayuno: ${dur(el)} de ${f.active.goalH} h</b><div class="muted" style="margin-top:2px">${el >= g ? '¡Completado! Ya podés comer.' : `Termina a las ${hhmm(f.active.start + g)}`}</div></div>${icon('right', 18)}</button>`;
  }
  if (!f.dismissed && !f.history.length && EN.isCut()) {
    return `<div class="banner" style="margin-top:10px">${icon('timer', 20)}<div class="grow"><b>¿Probás el ayuno intermitente?</b><div class="muted" style="margin-top:2px">Puede ayudarte a comer menos sin contar tanto. Es opcional.</div></div><div style="display:flex;flex-direction:column;gap:6px"><button class="btn small" data-act="fast-tab">Ver</button><button class="btn small ghost" data-act="fast-dismiss">No</button></div></div>`;
  }
  return '';
}

export function renderAyuno() {
  const f = F();
  const st = stats();
  const p = PROTOCOLS[f.protocol] || PROTOCOLS['16:8'];
  let main;
  if (f.active) {
    const el = Date.now() - f.active.start; const g = f.active.goalH * 3600000;
    const pct = Math.min(100, Math.round((el / g) * 100));
    const stage = [...STAGES].reverse().find(([h]) => el / 3600000 >= h);
    main = `<section class="panel water-big">
      <div class="wb-ring" style="--p:${pct}"><div><b id="fast-clock" style="font-size:28px">${clock(el)}</b><small>de ${f.active.goalH} h · ${pct}%</small></div></div>
      <p style="text-align:center;margin:12px 0 2px"><b>${el >= g ? '¡Ayuno completado!' : `Faltan ${dur(g - el)}`}</b></p>
      <p class="muted" style="text-align:center;margin:0">Empezó ${new Date(f.active.start).toLocaleDateString('sv-SE') === todayISO() ? 'hoy' : 'ayer'} a las ${hhmm(f.active.start)} · termina a las ${hhmm(f.active.start + g)}</p>
      ${stage ? `<div class="banner" style="margin-top:12px">${icon('info', 20)}<div class="grow"><b>${esc(stage[1])}</b><div class="muted" style="margin-top:2px">${esc(stage[2])}</div></div></div>` : ''}
      <div style="display:flex;gap:8px;margin-top:12px"><button class="btn" style="flex:1" data-act="fast-edit">Cambiar inicio</button><button class="btn primary" style="flex:1" data-act="fast-stop">${el >= g ? 'Terminar' : 'Cortar ayuno'}</button></div>
    </section>`;
  } else {
    const last = f.history[f.history.length - 1];
    main = `<section class="panel" style="text-align:center">
      <div style="font-size:15px;color:var(--ink-3)">${last ? `Ventana de comidas abierta desde las ${hhmm(last.end)}` : 'Sin ayuno en curso'}</div>
      <button class="btn primary" style="width:100%;margin-top:14px" data-act="fast-start">${icon('play', 18)} Empezar ayuno ${esc(p.label)} ahora</button>
      <button class="btn ghost" style="width:100%;margin-top:6px" data-act="fast-start-ago">Ya empecé antes (terminé de comer hace un rato)</button>
    </section>`;
  }
  const hist = [...f.history].reverse().slice(0, 7).map((x) => {
    const h = (x.end - x.start) / 3600000;
    return `<div class="kv"><span>${icon(h >= x.goalH * 0.97 ? 'check' : 'timer', 18)}${esc(new Date(x.end).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'numeric' }))}</span><b>${fmt(h, 1)} h <small class="muted">de ${x.goalH}</small></b></div>`;
  }).join('');
  return `<h1 class="view-title">Ayuno</h1>
    ${main}
    <section class="panel" style="margin-top:12px">
      <div class="kv"><span>${icon('clock', 18)}Protocolo</span><button class="weight-btn" data-act="fast-protocol">${esc(p.label)}</button></div>
      <div class="kv"><span>${icon('star', 18)}Racha</span><b>${st.streak} ${st.streak === 1 ? 'día' : 'días'}</b></div>
      <div class="kv"><span>${icon('calendar', 18)}Últimos 7 días</span><b>${st.done} de ${st.n} completos${st.n ? ` · ${fmt(st.avgH, 1)} h promedio` : ''}</b></div>
    </section>
    <div class="section-head"><h3>Últimos ayunos</h3></div>
    <section class="panel">${hist || '<p class="muted" style="margin:0">Todavía no registraste ningún ayuno.</p>'}</section>
    <p class="note" style="margin-top:12px">Durante el ayuno podés tomar agua, café o té sin azúcar. No se recomienda si estás embarazada o amamantando, tenés diabetes, tomás medicación para el azúcar o tuviste trastornos de la alimentación: consultalo antes con un profesional. ${EN.isCut() ? '' : 'Tu objetivo actual no es bajar de peso: el ayuno es opcional.'}</p>`;
}

/** Elegir cuánto hace que empezó (pasos de 30 min) */
async function pickAgo(title, initialH = 2) {
  let h = initialH;
  const draw = () => `<div class="time-pick"><div class="tp-col"><button class="step-btn" data-a="+" aria-label="Más">${icon('up', 18)}</button><b>${fmt(h, h % 1 ? 1 : 0)} h</b><button class="step-btn" data-a="-" aria-label="Menos">${icon('down', 18)}</button></div></div><p class="muted" style="text-align:center">Empezó a las <b>${hhmm(Date.now() - h * 3600000)}</b></p>`;
  const s = openSheet({ title, cls: 'sheet-compact', body: draw(), footer: '<button class="btn ghost" data-a="no">Cancelar</button><button class="btn primary" data-a="ok">Listo</button>' });
  const fn = (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === '+') { h = Math.min(30, h + 0.5); s.setBody(draw()); } else if (b.dataset.a === '-') { h = Math.max(0, h - 0.5); s.setBody(draw()); }
    else s.close(b.dataset.a === 'ok' ? h : null);
  };
  s.body.addEventListener('click', fn); s.foot.addEventListener('click', fn);
  return s.done;
}

function start(at = Date.now()) {
  const f = F();
  f.active = { id: uid('ay'), start: at, goalH: PROTOCOLS[f.protocol]?.h || 16 };
  f.dismissed = true;
  store.commit('ayuno');
  toast(`Ayuno empezado: termina a las ${hhmm(at + f.active.goalH * 3600000)}`, { ms: 4000 });
}

export const fastingActions = {
  'fast-tab': () => import('./app.js').then((m) => m.go('ayuno')),
  'fast-dismiss': () => { F().dismissed = true; store.commit('ayuno'); },
  'fast-start': () => start(),
  'fast-start-ago': async () => { const h = await pickAgo('¿Hace cuánto terminaste de comer?'); if (h != null) start(Date.now() - h * 3600000); },
  'fast-edit': async () => {
    const f = F(); if (!f.active) return;
    const h = await pickAgo('¿Cuándo empezó el ayuno?', Math.round((Date.now() - f.active.start) / 1800000) / 2);
    if (h != null) { f.active.start = Date.now() - h * 3600000; store.commit('ayuno'); }
  },
  'fast-stop': async () => {
    const f = F(); if (!f.active) return;
    const el = Date.now() - f.active.start;
    if (el < f.active.goalH * 3600000 * 0.97 && !(await confirmDialog({ title: '¿Cortar el ayuno?', text: `Llevás ${dur(el)} de ${f.active.goalH} h. Se guarda igual en tu historial.`, ok: 'Cortar' }))) return;
    if (el > 15 * 60000) f.history.push({ start: f.active.start, end: Date.now(), goalH: f.active.goalH });
    f.history = f.history.slice(-120);
    f.active = null;
    store.commit('ayuno');
    toast(el >= f.history[f.history.length - 1]?.goalH * 3600000 * 0.97 ? '¡Ayuno completado!' : 'Ayuno guardado');
  },
  'fast-protocol': async () => {
    const f = F();
    const v = await pickOption({ title: 'Protocolo de ayuno', value: f.protocol, options: Object.entries(PROTOCOLS).map(([value, x]) => ({ value, label: x.label, sub: x.sub, icon: 'clock' })) });
    if (v) { f.protocol = v; if (f.active) f.active.goalH = PROTOCOLS[v].h; store.commit('ayuno'); }
  },
};

/** Actualiza el cronómetro cada segundo (sin redibujar toda la pantalla). */
export function fastingTick() {
  const el = document.getElementById('fast-clock');
  const f = store.S().fasting;
  if (el && f?.active) el.textContent = clock(Date.now() - f.active.start);
}
export { goalH };
