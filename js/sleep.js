// ApexTrack — sueño: a qué hora te acostaste y te levantaste, cuánto y cómo dormiste, deuda de sueño,
// regularidad, hora ideal para acostarte y qué cosas te hacen dormir mejor o peor (según tus datos).
import { todayISO, addDays, dateRange, weekStart, fmt, round1, esc, uid, vibrate } from './util.js';
import * as store from './store.js';
import { icon } from './icons.js';
import { weekBars } from './charts.js';
import { openSheet, toast, confirmDialog, pickOption } from './ui.js';

export const QUALITY = { 1: ['Muy mal', '😫'], 2: ['Mal', '😕'], 3: ['Normal', '😐'], 4: ['Bien', '🙂'], 5: ['Excelente', '😄'] };
export const FACTORS = {
  pantalla: 'Pantallas antes de dormir', cafe: 'Café o mate de tarde', alcohol: 'Alcohol', cena_tarde: 'Cené tarde o pesado',
  ejercicio: 'Entrené', estres: 'Estrés o preocupación', siesta: 'Siesta', ruido: 'Ruido o calor', enfermo: 'Me sentí mal',
};

export function SL() {
  const S = store.S();
  if (!S.sleep || typeof S.sleep !== 'object') S.sleep = { goalH: 8, wake: '07:00', nights: [], active: null };
  if (!Array.isArray(S.sleep.nights)) S.sleep.nights = [];
  return S.sleep;
}
const hhmm = (t) => new Date(t).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const durTxt = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };
/** Minutos desde el mediodía (para promediar horas de acostarse que cruzan la medianoche) */
const minsFromNoon = (t) => { const d = new Date(t); return ((d.getHours() + 12) % 24) * 60 + d.getMinutes(); };
const fromNoon = (m) => { const h = (Math.floor(m / 60) + 12) % 24; return `${String(h).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`; };

/** Noche guardada para el día en que te levantaste. */
export const nightOf = (date) => SL().nights.find((n) => n.date === date) || null;

export function stats(days = 7) {
  const sl = SL();
  const from = addDays(todayISO(), -(days - 1));
  const ns = sl.nights.filter((n) => n.date >= from);
  if (!ns.length) return null;
  const avg = ns.reduce((a, n) => a + n.hours, 0) / ns.length;
  const q = ns.filter((n) => n.quality);
  const bedM = ns.map((n) => minsFromNoon(n.bed));
  const meanBed = bedM.reduce((a, x) => a + x, 0) / bedM.length;
  const sd = Math.sqrt(bedM.reduce((a, x) => a + (x - meanBed) ** 2, 0) / bedM.length);
  const wakeM = ns.map((n) => { const d = new Date(n.wake); return d.getHours() * 60 + d.getMinutes(); });
  const meanWake = wakeM.reduce((a, x) => a + x, 0) / wakeM.length;
  return {
    n: ns.length, avg, debt: Math.max(0, ns.reduce((a, n) => a + (sl.goalH - n.hours), 0)), quality: q.length ? q.reduce((a, n) => a + n.quality, 0) / q.length : null,
    bed: fromNoon(meanBed), wake: `${String(Math.floor(meanWake / 60)).padStart(2, '0')}:${String(Math.round(meanWake % 60)).padStart(2, '0')}`, sd: Math.round(sd),
    good: ns.filter((n) => n.hours >= sl.goalH - 0.25).length,
  };
}

/** Qué se relaciona con dormir mejor o peor, mirando tus noches (desde 6 noches con datos). */
export function insights() {
  const sl = SL();
  const ns = sl.nights.slice(-60);
  if (ns.length < 6) return [];
  const out = [];
  const comp = (has, label) => {
    const a = ns.filter(has); const b = ns.filter((n) => !has(n));
    if (a.length < 2 || b.length < 2) return;
    const dh = a.reduce((x, n) => x + n.hours, 0) / a.length - b.reduce((x, n) => x + n.hours, 0) / b.length;
    const qa = a.filter((n) => n.quality); const qb = b.filter((n) => n.quality);
    const dq = qa.length && qb.length ? qa.reduce((x, n) => x + n.quality, 0) / qa.length - qb.reduce((x, n) => x + n.quality, 0) / qb.length : 0;
    if (Math.abs(dh) >= 0.3 || Math.abs(dq) >= 0.5) out.push({ score: Math.abs(dh) + Math.abs(dq) / 2, text: `${label}: dormiste ${dh >= 0 ? `${fmt(dh, 1)} h más` : `${fmt(-dh, 1)} h menos`}${Math.abs(dq) >= 0.5 ? ` y con ${dq > 0 ? 'mejor' : 'peor'} calidad` : ''} (${a.length} noches).` });
  };
  for (const [k, l] of Object.entries(FACTORS)) comp((n) => (n.factors || []).includes(k), `Cuando marcaste "${l.toLowerCase()}"`);
  // con datos del resto de la app
  comp((n) => store.day(addDays(n.date, -1)).gym === 'fui', 'Los días que fuiste al gimnasio');
  comp((n) => store.entriesOn(addDays(n.date, -1)).some((e) => e.moment === 'post_cena'), 'Cuando comiste después de cenar');
  comp((n) => minsFromNoon(n.bed) > 12 * 60 + 30, 'Cuando te acostaste después de las 0:30');
  return out.sort((a, b) => b.score - a.score).slice(0, 4).map((x) => x.text);
}

/** A qué hora acostarse para dormir la meta y levantarse a la hora habitual (+15 min para dormirse). */
export function idealBedtime() {
  const sl = SL();
  const [h, m] = (sl.wake || '07:00').split(':').map(Number);
  const total = h * 60 + m - sl.goalH * 60 - 15;
  const t = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export function sleepCard() {
  const sl = SL();
  if (sl.active) return `<div class="kv"><span>${icon('moon', 18)}Sueño</span><button class="weight-btn" data-act="sleep-stop">Me desperté</button></div>`;
  const n = nightOf(todayISO());
  return `<div class="kv"><span>${icon('moon', 18)}Sueño</span><button class="weight-btn" data-act="sleep-log">${n ? `${durTxt(n.hours)}${n.quality ? ' ' + QUALITY[n.quality][1] : ''}` : 'Registrar'}</button></div>`;
}

export function renderSueno() {
  const sl = SL();
  const today = todayISO();
  const st = stats(7);
  const last = sl.nights[sl.nights.length - 1];
  const ws = weekStart(today);
  const days = dateRange(ws, addDays(ws, 6));
  const chart = weekBars({ days: days.map((d) => ({ date: d, value: nightOf(d)?.hours || 0 })), goal: sl.goalH, sel: today, unit: 'h', dec: 1, today, height: 160 });
  const main = sl.active
    ? `<section class="panel" style="text-align:center">
        <div style="font-size:15px;color:var(--ink-3)">Durmiendo desde las ${hhmm(sl.active.start)}</div>
        <div class="hero-num" style="font-size:44px;margin:6px 0" id="sleep-clock">${durTxt((Date.now() - sl.active.start) / 3600000)}</div>
        <button class="btn primary" style="width:100%" data-act="sleep-stop">${icon('sun', 18)} Me desperté</button>
        <button class="btn ghost" style="width:100%;margin-top:6px" data-act="sleep-cancel">Cancelar</button>
      </section>`
    : `<section class="panel" style="text-align:center">
        ${last && last.date === today ? `<div class="hero-num" style="font-size:44px">${durTxt(last.hours)}</div><div class="muted">Anoche · ${hhmm(last.bed)} a ${hhmm(last.wake)}${last.quality ? ` · ${QUALITY[last.quality][1]} ${QUALITY[last.quality][0].toLowerCase()}` : ''}</div>` : '<div class="muted" style="font-size:15px">Todavía no registraste la noche de hoy</div>'}
        <div style="display:flex;gap:8px;margin-top:14px"><button class="btn" style="flex:1" data-act="sleep-log">${icon('edit', 18)} Registrar noche</button><button class="btn primary" style="flex:1" data-act="sleep-start">${icon('moon', 18)} Me voy a dormir</button></div>
      </section>`;
  const ins = insights();
  const hist = [...sl.nights].reverse().slice(0, 7).map((n) => `<button class="kv" style="width:100%;text-align:left" data-act="sleep-edit" data-date="${n.date}"><span>${icon(n.hours >= sl.goalH - 0.25 ? 'check' : 'moon', 18)}${esc(new Date(n.date + 'T12:00').toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'numeric' }))}</span><b>${durTxt(n.hours)}${n.quality ? ' ' + QUALITY[n.quality][1] : ''} <small class="muted">${hhmm(n.bed)}–${hhmm(n.wake)}</small></b></button>`).join('');
  return `<h1 class="view-title">Sueño</h1>
    ${main}
    <section class="panel" style="margin-top:12px">
      <div class="kv"><span>${icon('star', 18)}Meta de sueño</span><button class="weight-btn" data-act="sleep-goal">${fmt(sl.goalH, sl.goalH % 1 ? 1 : 0)} h</button></div>
      <div class="kv"><span>${icon('sun', 18)}Me levanto a las</span><button class="weight-btn" data-act="sleep-wake">${esc(sl.wake || '07:00')}</button></div>
      <div class="kv"><span>${icon('clock', 18)}Hora ideal para acostarte</span><b>${idealBedtime()}</b></div>
    </section>
    ${st ? `<div class="stat-grid" style="margin-top:12px">
      <div class="stat"><small>Promedio (7 días)</small><b>${fmt(st.avg, 1)} h</b><span>${st.good} de ${st.n} noches en la meta</span></div>
      <div class="stat"><small>Deuda de sueño</small><b>${fmt(st.debt, 1)} h</b><span>en la última semana</span></div>
      <div class="stat"><small>Te acostás · te levantás</small><b style="font-size:22px">${st.bed} · ${st.wake}</b><span>en promedio</span></div>
      <div class="stat"><small>Regularidad</small><b style="font-size:22px">${st.sd <= 30 ? 'Buena' : st.sd <= 60 ? 'Regular' : 'Irregular'}</b><span>la hora de acostarte varía ±${st.sd} min</span></div>
      ${st.quality ? `<div class="stat"><small>Calidad promedio</small><b>${fmt(st.quality, 1)}<span style="font-size:15px">/5</span></b><span>${QUALITY[Math.round(st.quality)][1]} ${QUALITY[Math.round(st.quality)][0].toLowerCase()}</span></div>` : ''}
    </div>` : ''}
    <div class="section-head"><h3>Esta semana</h3></div>
    <section class="panel">${chart}</section>
    ${ins.length ? `<div class="section-head"><h3>Lo que influye en tu sueño</h3></div><section class="panel"><ul class="ins-list" style="margin:0">${ins.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>` : `<p class="note" style="margin-top:12px">Con 6 noches registradas (marcando qué hiciste ese día) la app te muestra qué te hace dormir mejor o peor.</p>`}
    <div class="section-head"><h3>Últimas noches</h3></div>
    <section class="panel">${hist || '<p class="muted" style="margin:0">Sin noches registradas.</p>'}</section>
    <p class="note" style="margin-top:12px">Para adultos se recomiendan 7 a 9 horas. Acostarte y levantarte siempre a la misma hora (también el fin de semana) mejora la calidad del sueño. Si roncás fuerte, te despertás cansado/a seguido o tenés insomnio, consultá con un profesional.</p>`;
}

// ---------------------------------------------------------------------------
// Registrar una noche (a mano o al despertarte)
// ---------------------------------------------------------------------------
function editNight(n0) {
  const sl = SL();
  const today = todayISO();
  const def = n0 || { date: today, bed: new Date(`${addDays(today, -1)}T23:30`).getTime(), wake: new Date(`${today}T${sl.wake || '07:00'}`).getTime(), quality: 0, awake: 0, factors: [], note: '' };
  const w = { ...def, factors: [...(def.factors || [])] };
  const step = (k, min) => { w[k] += min * 60000; };
  const draw = () => {
    const hours = Math.max(0, (w.wake - w.bed) / 3600000 - (w.awake || 0) / 60);
    return `
    <div class="time-pick" style="gap:22px">
      <div class="tp-col"><small class="muted">Me acosté</small><button class="step-btn" data-z="bed+">${icon('up', 18)}</button><b style="font-size:30px">${hhmm(w.bed)}</b><button class="step-btn" data-z="bed-">${icon('down', 18)}</button></div>
      <div class="tp-col"><small class="muted">Me levanté</small><button class="step-btn" data-z="wake+">${icon('up', 18)}</button><b style="font-size:30px">${hhmm(w.wake)}</b><button class="step-btn" data-z="wake-">${icon('down', 18)}</button></div>
    </div>
    <p style="text-align:center;margin:10px 0 0"><b>${durTxt(hours)}</b> de sueño${w.awake ? ` (descontando ${w.awake} min despierto)` : ''}</p>
    <div class="field" style="margin-top:12px"><span>¿Cómo dormiste?</span><div class="chips" style="justify-content:space-between">${Object.entries(QUALITY).map(([k, [l, e]]) => `<button class="chip ${Number(w.quality) === Number(k) ? 'on' : ''}" data-z="q" data-v="${k}" aria-label="${l}" style="font-size:20px;padding:6px 12px">${e}</button>`).join('')}</div></div>
    <div class="kv" style="margin-top:8px"><span>Tiempo despierto a la noche</span><div class="study"><button class="step-btn" data-z="aw-" aria-label="Menos">${icon('minus', 18)}</button><b>${w.awake || 0} min</b><button class="step-btn" data-z="aw+" aria-label="Más">${icon('plus', 18)}</button></div></div>
    <div class="field" style="margin-top:10px"><span>¿Qué pasó ese día? (para ver qué te afecta)</span><div class="chip-row wrap">${Object.entries(FACTORS).map(([k, l]) => `<button class="chip ${w.factors.includes(k) ? 'on' : ''}" data-z="f" data-v="${k}">${esc(l)}</button>`).join('')}</div></div>`;
  };
  const s = openSheet({ title: n0 ? 'Editar noche' : '¿Cómo dormiste?', full: true, body: draw(), footer: `${n0 ? `<button class="btn ghost" data-z="del" aria-label="Borrar">${icon('trash', 18)}</button>` : ''}<button class="btn primary" data-z="save">Guardar</button>` });
  const h = async (e) => {
    const b = e.target.closest('[data-z]'); if (!b) return;
    const k = b.dataset.z;
    if (k === 'bed+') step('bed', 15); else if (k === 'bed-') step('bed', -15); else if (k === 'wake+') step('wake', 15); else if (k === 'wake-') step('wake', -15);
    else if (k === 'aw+') w.awake = Math.min(240, (w.awake || 0) + 10); else if (k === 'aw-') w.awake = Math.max(0, (w.awake || 0) - 10);
    else if (k === 'q') { w.quality = Number(b.dataset.v); vibrate(8); }
    else if (k === 'f') { const v = b.dataset.v; w.factors = w.factors.includes(v) ? w.factors.filter((x) => x !== v) : [...w.factors, v]; }
    else if (k === 'del') {
      if (await confirmDialog({ title: '¿Borrar esta noche?', ok: 'Borrar', danger: true })) { sl.nights = sl.nights.filter((x) => x.date !== n0.date); store.commit('sueño'); s.close(); }
      return;
    } else if (k === 'save') {
      if (w.wake <= w.bed) w.wake += 86400000;
      if (w.wake - w.bed > 16 * 3600000) { toast('Revisá las horas: da más de 16 horas', { kind: 'error' }); return; }
      const hours = Math.max(0, (w.wake - w.bed) / 3600000 - (w.awake || 0) / 60);
      const date = new Date(w.wake).toLocaleDateString('sv-SE');
      const rec = { id: w.id || uid('sn'), date, bed: w.bed, wake: w.wake, hours: Math.round(hours * 100) / 100, quality: w.quality || 0, awake: w.awake || 0, factors: w.factors, note: w.note || '' };
      sl.nights = sl.nights.filter((x) => x.date !== date && x.id !== rec.id).concat(rec).sort((a, b) => a.date.localeCompare(b.date)).slice(-400);
      store.commit('sueño'); s.close();
      toast(`Noche guardada: ${durTxt(hours)}`);
      return;
    }
    if (w.wake <= w.bed) w.wake += 86400000;
    if (w.wake - w.bed > 86400000) w.wake -= 86400000;
    s.setBody(draw());
  };
  s.body.addEventListener('click', h); s.foot.addEventListener('click', h);
}

export const sleepActions = {
  'sleep-start': () => { const sl = SL(); sl.active = { start: Date.now() }; store.commit('sueño'); toast(`Que descanses. Mañana tocá "Me desperté".`); },
  'sleep-cancel': () => { SL().active = null; store.commit('sueño'); },
  'sleep-stop': () => {
    const sl = SL(); const a = sl.active; if (!a) return;
    sl.active = null; store.commit('sueño');
    editNight({ date: todayISO(), bed: a.start, wake: Date.now(), quality: 0, awake: 0, factors: [] });
  },
  'sleep-log': () => { const n = nightOf(todayISO()); editNight(n || null); },
  'sleep-edit': (el) => { const n = nightOf(el.dataset.date); if (n) editNight(n); },
  'sleep-goal': async () => {
    const sl = SL();
    const v = await pickOption({ title: 'Meta de sueño', value: sl.goalH, options: [6.5, 7, 7.5, 8, 8.5, 9, 9.5].map((x) => ({ value: x, label: `${fmt(x, x % 1 ? 1 : 0)} horas`, sub: x === 8 ? 'Lo más común para adultos' : '' })) });
    if (v) { sl.goalH = v; store.commit('sueño'); }
  },
  'sleep-wake': async () => {
    const sl = SL();
    const opts = []; for (let m = 5 * 60; m <= 11 * 60; m += 15) opts.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
    const v = await pickOption({ title: '¿A qué hora te levantás?', value: sl.wake, options: opts.map((x) => ({ value: x, label: x })) });
    if (v) { sl.wake = v; store.commit('sueño'); }
  },
};

/** Noche contada en un mensaje ("dormí 6 horas"): si no dice las horas, se estiman con la hora de levantarse. */
export function saveNightFromText(x) {
  const sl = SL();
  const wakeHM = x.wake || sl.wake || '07:00';
  const wake = new Date(`${x.date}T${wakeHM}`).getTime();
  const bed = x.bed ? (() => { let t = new Date(`${x.date}T${x.bed}`).getTime(); if (t >= wake) t -= 86400000; return t; })() : wake - x.hours * 3600000;
  const old = nightOf(x.date);
  const rec = { id: old?.id || uid('sn'), date: x.date, bed, wake, hours: x.hours, quality: x.quality || old?.quality || 0, awake: 0, factors: old?.factors || [], note: '' };
  sl.nights = sl.nights.filter((n) => n.date !== x.date).concat(rec).sort((a, b) => a.date.localeCompare(b.date)).slice(-400);
}

/** Actualiza "durmiendo hace…" sin redibujar. */
export function sleepTick() {
  const el = document.getElementById('sleep-clock'); const a = store.S().sleep?.active;
  if (el && a) el.textContent = durTxt((Date.now() - a.start) / 3600000);
}
export { round1 };
