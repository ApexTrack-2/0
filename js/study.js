// ApexTrack — pestañas opcionales: Estudio (cronómetro, pomodoro, materias, fechas, pendientes, notas)
// y Hábitos (rachas y cuadrícula por hábito).
import {
  todayISO, addDays, addMonths, weekStart, monthStart, dateRange, fmt, fmtDayShort, fmtDayLong, fmtMonthYear,
  relativeDayLabel, esc, cap, round1, uid, parseISO, daysBetween, vibrate, parseNum,
} from './util.js';
import * as store from './store.js';
import { icon } from './icons.js';
import { openSheet, toast, confirmDialog, pickOption, pickDate, promptText, formSheet } from './ui.js';
import { weekBars } from './charts.js';
import { ui, render, setDate } from './app.js';

const COLORS = ['#2747D6', '#C2335A', '#C98208', '#6A4FC9', '#2E7D45', '#0E7C86', '#8A5A2B', '#5F6B66'];
const TYPES = { examen: 'Examen', parcial: 'Parcial', entrega: 'Entrega', clase: 'Clase / consulta', otro: 'Otro' };
const ST = () => store.S().study;
const hoursHabit = () => store.habitsList().find((h) => h.kind === 'hours');
const goalDay = () => Number(hoursHabit()?.goal) || 2;
const subj = (id) => ST().subjects.find((x) => x.id === id) || null;
const subjName = (id) => subj(id)?.name || 'Sin materia';
const dot = (id) => `<i class="sdot" style="background:${esc(subj(id)?.color || '#8A948E')}"></i>`;
const fmtH = (h) => (h >= 1 ? `${fmt(h, h % 1 ? 1 : 0)} h` : `${Math.round(h * 60)} min`);
const fmtClock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`; };
const studyH = (d) => Number(store.day(d).study) || 0;
const daysUntil = (d) => daysBetween(todayISO(), d);
const untilLabel = (d) => { const n = daysUntil(d); return n === 0 ? 'hoy' : n === 1 ? 'mañana' : n < 0 ? `hace ${-n} d` : `en ${n} días`; };

// ---------------------------------------------------------------------------
// Cronómetro / pomodoro
// ---------------------------------------------------------------------------
function workMs(a, now = Date.now()) { return (a.workMs || 0) + (a.running && a.phase === 'work' ? now - a.segStart : 0); }
function phaseLeft(a, now = Date.now()) {
  if (a.mode !== 'pomodoro') return null;
  const P = ST().pomo;
  const len = (a.phase === 'work' ? P.work : P.rest) * 60000;
  const used = (a.phaseUsed || 0) + (a.running ? now - a.segStart : 0);
  return len - used;
}
export function studyTick() {
  const a = ST()?.active;
  if (!a) return;
  const now = Date.now();
  if (a.mode === 'pomodoro' && a.running && phaseLeft(a, now) <= 0) {
    // cambio de fase
    if (a.phase === 'work') { a.workMs = workMs(a, now); a.cycles = (a.cycles || 0) + 1; a.phase = 'rest'; }
    else a.phase = 'work';
    a.segStart = now; a.phaseUsed = 0;
    vibrate([200, 100, 200, 100, 200]);
    toast(a.phase === 'rest' ? `¡Bien! Descanso de ${ST().pomo.rest} min` : 'Volvemos a estudiar', { ms: 5000 });
    store.save();
    if (ui.tab === 'estudio') render();
    return;
  }
  const el = document.getElementById('st-clock');
  if (el) {
    const left = phaseLeft(a, now);
    el.textContent = left != null ? fmtClock(left) : fmtClock(workMs(a, now));
    const tot = document.getElementById('st-total');
    if (tot) tot.textContent = fmtClock(workMs(a, now));
  }
}
function startTimer(subjectId, mode) {
  const now = Date.now();
  ST().active = { subjectId, mode, phase: 'work', running: true, segStart: now, phaseUsed: 0, workMs: 0, cycles: 0, startedAt: now, date: todayISO() };
  store.commit('estudio');
}
function pauseTimer() {
  const a = ST().active; if (!a || !a.running) return;
  const now = Date.now();
  if (a.phase === 'work') a.workMs = workMs(a, now);
  a.phaseUsed = (a.phaseUsed || 0) + (now - a.segStart);
  a.running = false;
  store.commit('estudio');
}
function resumeTimer() { const a = ST().active; if (!a || a.running) return; a.running = true; a.segStart = Date.now(); store.commit('estudio'); }
async function finishTimer() {
  const a = ST().active; if (!a) return;
  const min = Math.round(workMs(a) / 60000);
  if (min < 1) {
    if (await confirmDialog({ title: 'Menos de un minuto', text: '¿Descartar esta sesión?', ok: 'Descartar' })) { ST().active = null; store.commit('estudio'); }
    return;
  }
  const note = await promptText({ title: `Guardar ${fmtH(min / 60)} de estudio`, label: '¿Qué estudiaste? (opcional)', placeholder: 'Ej.: unidad 3, ejercicios del parcial' });
  if (note === null) return;
  addSession({ date: a.date || todayISO(), subjectId: a.subjectId, min, note });
  ST().active = null;
  store.commit('estudio');
  toast(`Guardado: ${fmtH(min / 60)} de ${subjName(a.subjectId)}`);
}
function addSession({ date, subjectId, min, note = '' }) {
  ST().sessions.push({ id: uid('ss'), date, subjectId: subjectId || null, min, note, at: Date.now() });
  store.setStudy(date, studyH(date) + min / 60);
}

// ---------------------------------------------------------------------------
// Vista ESTUDIO
// ---------------------------------------------------------------------------
export function renderEstudio() {
  const S = ST();
  const today = todayISO();
  const a = S.active;
  const g = goalDay();
  const hToday = studyH(today);
  let top;
  if (a) {
    const left = phaseLeft(a);
    top = `<section class="panel st-timer">
      <div class="muted" style="font-size:14px;display:flex;align-items:center;gap:6px">${dot(a.subjectId)}${esc(subjName(a.subjectId))} · ${a.mode === 'pomodoro' ? (a.phase === 'work' ? `Pomodoro ${(a.cycles || 0) + 1}: estudio` : 'Pomodoro: descanso') : 'Cronómetro'}${a.running ? '' : ' · en pausa'}</div>
      <div class="st-clock" id="st-clock">${left != null ? fmtClock(left) : fmtClock(workMs(a))}</div>
      ${a.mode === 'pomodoro' ? `<div class="muted" style="font-size:14px">Tiempo de estudio: <b id="st-total">${fmtClock(workMs(a))}</b></div>` : ''}
      <div class="row" style="gap:8px;margin-top:14px;justify-content:center">
        ${a.running ? `<button class="btn" data-act="st-pause">${icon('pause', 18)} Pausa</button>` : `<button class="btn" data-act="st-resume">${icon('play', 18)} Seguir</button>`}
        <button class="btn primary" data-act="st-finish">${icon('check', 18)} Terminar</button>
        <button class="btn ghost" data-act="st-discard" aria-label="Descartar">${icon('trash', 18)}</button>
      </div>
    </section>`;
  } else {
    top = `<section class="panel">
      <div class="kv"><span>${icon('book', 18)}Hoy</span><b>${fmtH(hToday)} <span class="muted" style="font-weight:500">de ${fmtH(g)}</span></b></div>
      <span class="meter" style="--c:var(--accent);margin-top:10px"><i style="width:${Math.min(100, (hToday / g) * 100)}%"></i></span>
      <div class="row" style="gap:8px;margin-top:14px">
        <button class="btn primary" style="flex:1" data-act="st-start">${icon('play', 18)} Estudiar</button>
        <button class="btn" data-act="st-manual">${icon('plus', 18)} Anotar tiempo</button>
      </div>
    </section>`;
  }
  // próximas fechas
  const upcoming = S.events.filter((e) => !e.done && e.date >= addDays(today, -1)).sort((x, y) => x.date.localeCompare(y.date)).slice(0, 6);
  const evHtml = `<section class="section"><div class="section-head"><h3>Próximas fechas</h3><button class="link" data-act="st-event-new">Agregar</button></div>
    ${upcoming.length ? `<div class="panel" style="padding:4px 16px">${upcoming.map((e) => `<button class="st-row" data-act="st-event" data-id="${e.id}"><span class="grow"><b>${dot(e.subjectId)}${esc(TYPES[e.type] || 'Fecha')}${e.title ? ': ' + esc(e.title) : ''}</b><small>${esc(subjName(e.subjectId))} · ${esc(cap(fmtDayShort(e.date)))}</small></span><span class="badge ${daysUntil(e.date) <= 3 ? 'warn-b' : ''}">${untilLabel(e.date)}</span></button>`).join('')}</div>` : '<div class="empty"><strong>Sin fechas cargadas</strong>Agregá exámenes, parciales y entregas: te muestro cuánto falta.</div>'}
  </section>`;
  // semana
  const ws = ui.study.week || weekStart(today);
  const days = dateRange(ws, addDays(ws, 6));
  if (!days.includes(ui.study.sel)) ui.study.sel = days.includes(today) ? today : ws;
  const chart = weekBars({ days: days.map((d) => ({ date: d, value: d > today ? 0 : round1(studyH(d)) })), goal: g, sel: ui.study.sel, unit: 'h', dec: 1, today });
  const weekTot = days.reduce((x, d) => x + studyH(d), 0);
  const selSess = S.sessions.filter((x) => x.date === ui.study.sel);
  const weekHtml = `<section class="section"><div class="section-head"><h3>Semana</h3><span class="muted" style="font-size:14px">${fmtH(weekTot)} en total</span></div>
    <div class="panel">
      <div class="chart-nav"><button class="icon-btn" data-act="st-week" data-d="-1" aria-label="Semana anterior">${icon('left')}</button><strong>${ws === weekStart(today) ? 'Esta semana' : `${fmtDayShort(ws)} al ${fmtDayShort(addDays(ws, 6))}`}</strong><button class="icon-btn" data-act="st-week" data-d="1" aria-label="Semana siguiente" ${addDays(ws, 7) > today ? 'disabled' : ''}>${icon('right')}</button></div>
      <div class="chart-box" data-chart="study">${chart}</div>
      <div class="readout"><span>${esc(cap(fmtDayLong(ui.study.sel)))}</span><b>${fmtH(studyH(ui.study.sel))}</b></div>
      ${selSess.length ? `<div class="top-list" style="margin-top:4px">${selSess.map((x) => `<div class="top-row"><span>${dot(x.subjectId)}${esc(subjName(x.subjectId))}${x.note ? ` <small class="muted">· ${esc(x.note)}</small>` : ''}</span><span>${fmtH(x.min / 60)}</span></div>`).join('')}</div>` : ''}
    </div></section>`;
  // materias
  const wkFrom = weekStart(today);
  const subjHtml = `<section class="section"><div class="section-head"><h3>Materias</h3><button class="link" data-act="st-subject-new">Agregar</button></div>
    ${S.subjects.length ? S.subjects.map((sb) => {
      const h = S.sessions.filter((x) => x.subjectId === sb.id && x.date >= wkFrom).reduce((t, x) => t + x.min / 60, 0);
      const pend = S.tasks.filter((t) => t.subjectId === sb.id && !t.done).length;
      const next = S.events.filter((e) => e.subjectId === sb.id && !e.done && e.date >= today).sort((x, y) => x.date.localeCompare(y.date))[0];
      return `<button class="routine-card" data-act="st-subject" data-id="${sb.id}"><span class="grow"><h4 style="display:flex;align-items:center;gap:8px">${dot(sb.id)}${esc(sb.name)}</h4>
        <small>${fmtH(h)} esta semana${sb.goalWeek ? ` de ${fmtH(sb.goalWeek)}` : ''}${pend ? ` · ${pend} pendiente${pend === 1 ? '' : 's'}` : ''}${next ? ` · ${TYPES[next.type] || 'fecha'} ${untilLabel(next.date)}` : ''}</small>
        ${sb.goalWeek ? `<span class="meter" style="--c:${esc(sb.color)};margin-top:8px"><i style="width:${Math.min(100, (h / sb.goalWeek) * 100)}%"></i></span>` : ''}</span>${icon('right', 18)}</button>`;
    }).join('') : '<div class="empty"><strong>Todavía no cargaste materias</strong>Así podés ver cuánto estudiás de cada una, sus fechas y pendientes.</div>'}
  </section>`;
  // pendientes
  const tasks = S.tasks.filter((t) => !t.done).sort((x, y) => (x.due || '9999').localeCompare(y.due || '9999'));
  const doneRecent = S.tasks.filter((t) => t.done && t.doneAt && Date.now() - t.doneAt < 86400000);
  const taskHtml = `<section class="section"><div class="section-head"><h3>Pendientes</h3><button class="link" data-act="st-task-new">Agregar</button></div>
    ${tasks.length || doneRecent.length ? `<div class="panel" style="padding:4px 16px">${[...tasks, ...doneRecent].map(taskRow).join('')}</div>` : '<div class="empty"><strong>Nada pendiente</strong>Anotá tareas, resúmenes o ejercicios para no olvidarte.</div>'}
  </section>`;
  // calendario
  const ms = monthStart(ui.study.month || today);
  const me = addDays(addMonths(ms, 1), -1);
  const lead = (parseISO(ms).getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span></span>');
  for (const d of dateRange(ms, me)) {
    const h = studyH(d);
    const ev = S.events.some((e) => e.date === d);
    const lvl = h <= 0 ? '' : h < g / 2 ? 'l1' : h < g ? 'l2' : 'l3';
    cells.push(`<button class="cal-d st-cal ${lvl} ${d === today ? 'tod' : ''}" data-act="st-day" data-date="${d}"><span>${parseISO(d).getDate()}</span>${ev ? '<i class="dot ev"></i>' : ''}</button>`);
  }
  const monthDays = dateRange(ms, me > today ? today : me);
  const monthH = monthDays.reduce((x, d) => x + studyH(d), 0);
  const calHtml = `<section class="section"><div class="section-head"><h3>Calendario</h3><span class="muted" style="font-size:14px">${fmtH(monthH)} este mes</span></div>
    <div class="panel"><div class="chart-nav"><button class="icon-btn" data-act="st-month" data-d="-1" aria-label="Mes anterior">${icon('left')}</button><strong>${cap(fmtMonthYear(ms))}</strong><button class="icon-btn" data-act="st-month" data-d="1" aria-label="Mes siguiente">${icon('right')}</button></div>
    <div class="cal"><div class="cal-w">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((x) => `<span>${x}</span>`).join('')}</div><div class="cal-g">${cells.join('')}</div>
    <div class="cal-legend"><span><i class="lg l1"></i>poco</span><span><i class="lg l3"></i>meta cumplida</span><span><i class="dot ev"></i>fecha</span></div></div></div></section>`;
  // números
  let streak = 0; { let d = studyH(today) > 0 ? today : addDays(today, -1); while (studyH(d) > 0) { streak++; d = addDays(d, -1); } }
  const last30 = dateRange(addDays(today, -29), today);
  const avg30 = last30.reduce((x, d) => x + studyH(d), 0) / 30;
  const metaDays = last30.filter((d) => studyH(d) >= g).length;
  const stats = `<div class="stat-grid" style="margin-top:12px">
    <div class="stat"><small>Racha</small><b>${streak}</b><span>${streak === 1 ? 'día seguido' : 'días seguidos'}</span></div>
    <div class="stat"><small>Promedio diario (30 d)</small><b>${fmtH(avg30)}</b><span>meta ${fmtH(g)}</span></div>
    <div class="stat"><small>Días en meta (30 d)</small><b>${metaDays}</b><span>de 30</span></div>
    <div class="stat"><small>Notas cargadas</small><b>${gradeAvg() ?? '–'}</b><span>promedio de exámenes</span></div>
  </div>`;
  return `<h1 class="view-title">Estudio</h1>${top}${stats}${evHtml}${taskHtml}${weekHtml}${subjHtml}${calHtml}
    <button class="btn ghost" style="width:100%;margin-top:16px" data-act="st-settings">${icon('gear', 18)} Pomodoro y meta diaria</button>`;
}
function gradeAvg() {
  const gs = ST().events.map((e) => Number(e.grade)).filter((x) => Number.isFinite(x) && x > 0);
  return gs.length ? fmt(gs.reduce((a, b) => a + b, 0) / gs.length, 1) : null;
}
function taskRow(t) {
  return `<div class="st-row"><button class="st-check ${t.done ? 'on' : ''}" data-act="st-task-toggle" data-id="${t.id}" aria-label="${t.done ? 'Marcar pendiente' : 'Marcar hecha'}">${t.done ? icon('check', 16) : ''}</button>
    <button class="grow st-task-txt ${t.done ? 'done' : ''}" data-act="st-task" data-id="${t.id}"><b>${esc(t.text)}</b><small>${t.subjectId ? `${dot(t.subjectId)}${esc(subjName(t.subjectId))}` : ''}${t.due ? ` · ${t.due < todayISO() && !t.done ? '<span class="bad">vencida</span>' : 'para ' + esc(untilLabel(t.due))}` : ''}</small></button></div>`;
}

// ---------------------------------------------------------------------------
// Hojas de Estudio
// ---------------------------------------------------------------------------
async function pickSubject(current = null, title = 'Materia') {
  const opts = ST().subjects.map((s) => ({ value: s.id, label: s.name }));
  const v = await pickOption({ title, value: current, options: [...opts, { value: '__none', label: 'Sin materia' }], allowCustom: true, customLabel: 'Nueva materia…' });
  if (!v) return undefined;
  if (v === '__none') return null;
  if (typeof v === 'object' && v.custom) return newSubject(v.custom).id;
  return v;
}
function newSubject(name) {
  const S = ST();
  const sb = { id: uid('sb'), name: name.trim(), color: COLORS[S.subjects.length % COLORS.length], goalWeek: 0 };
  S.subjects.push(sb); store.commit('estudio');
  return sb;
}
async function editEvent(ev0 = null, date = null) {
  const ev = ev0 || { id: uid('ev'), date: date || addDays(todayISO(), 7), subjectId: null, type: 'examen', title: '', done: false };
  const type = ev0 ? ev.type : await pickOption({ title: 'Tipo de fecha', options: Object.entries(TYPES).map(([value, label]) => ({ value, label })) });
  if (!type) return;
  ev.type = type;
  if (!ev0) { const sid = await pickSubject(null); if (sid === undefined) return; ev.subjectId = sid; }
  pendingDelete = false;
  const r = await formSheet({
    title: ev0 ? 'Editar fecha' : `Nuevo: ${TYPES[type]}`,
    fields: [
      { key: 'date', label: 'Fecha', type: 'date', value: ev.date, full: true, max: addDays(todayISO(), 1095) },
      { key: 'title', label: 'Detalle (opcional)', type: 'text', value: ev.title || '', placeholder: 'Ej.: unidades 1 a 4', full: true },
      { key: 'grade', label: 'Nota obtenida (cuando la tengas)', type: 'number', value: ev.grade ?? '', full: true },
    ],
    extraFooter: ev0 ? `<button class="btn ghost" data-r="ev-del">${icon('trash', 18)}</button>` : '',
  });
  if (!r) {
    if (pendingDelete && ev0) {
      pendingDelete = false;
      if (await confirmDialog({ title: '¿Borrar esta fecha?', ok: 'Borrar', danger: true })) { ST().events = ST().events.filter((x) => x.id !== ev.id); store.commit('estudio'); }
    }
    return;
  }
  ev.date = r.date; ev.title = r.title.trim();
  ev.grade = Number.isFinite(r.grade) ? r.grade : null;
  if (ev.grade != null) ev.done = true;
  if (!ev0) ST().events.push(ev);
  store.commit('estudio');
}
async function editTask(t0 = null, subjectId) {
  const t = t0 || { id: uid('tk'), subjectId: subjectId ?? null, text: '', due: null, done: false, at: Date.now() };
  if (!t0 && subjectId === undefined) { const sid = await pickSubject(null, '¿De qué materia?'); if (sid === undefined) return; t.subjectId = sid; }
  pendingDue = null;
  const r = await formSheet({ title: t0 ? 'Editar pendiente' : 'Nuevo pendiente', fields: [
    { key: 'text', label: 'Qué hay que hacer', type: 'text', value: t.text, full: true, placeholder: 'Ej.: resumen unidad 2' },
  ], extraFooter: `<button class="btn ghost" data-r="due">${icon('calendar', 18)} ${t.due ? esc(cap(fmtDayShort(t.due))) : 'Fecha'}</button>` });
  if (!r) return;
  if (!r.text.trim()) { toast('Escribí el pendiente'); return; }
  t.text = r.text.trim();
  if (pendingDue) { t.due = pendingDue; pendingDue = null; }
  if (!t0) ST().tasks.push(t);
  store.commit('estudio');
}
// botones extra de los formularios de Estudio (fecha del pendiente, borrar fecha)
document.addEventListener('click', async (e) => {
  const b = e.target.closest('.sheet-foot [data-r="due"], .sheet-foot [data-r="ev-del"]');
  if (!b) return;
  e.stopPropagation();
  const sheet = b.closest('.sheet');
  if (b.dataset.r === 'due') {
    const d = await pickDate({ title: 'Para cuándo', value: addDays(todayISO(), 3), max: addDays(todayISO(), 730) });
    if (d) { b.dataset.date = d; b.innerHTML = `${icon('calendar', 18)} ${esc(cap(fmtDayShort(d)))}`; pendingDue = d; }
    return;
  }
  pendingDelete = true;
  sheet.querySelector('[data-r="0"]')?.click();
}, true);
let pendingDue = null;
let pendingDelete = false;

function openDay(d) {
  const S = ST();
  const sess = S.sessions.filter((x) => x.date === d);
  const evs = S.events.filter((x) => x.date === d);
  const due = S.tasks.filter((x) => x.due === d);
  const s = openSheet({
    title: cap(fmtDayLong(d)),
    body: `<div class="kv"><span>${icon('book', 18)}Estudiaste</span><b>${fmtH(studyH(d))}</b></div>
      ${sess.length ? `<div class="top-list" style="margin-top:8px">${sess.map((x) => `<div class="top-row"><span>${dot(x.subjectId)}${esc(subjName(x.subjectId))}${x.note ? ` <small class="muted">· ${esc(x.note)}</small>` : ''}</span><span>${fmtH(x.min / 60)} <button class="link" data-del-s="${x.id}" aria-label="Borrar">${icon('trash', 14)}</button></span></div>`).join('')}</div>` : ''}
      ${evs.length ? `<h3 class="sub-h">Fechas</h3>${evs.map((e) => `<div class="top-row"><span>${dot(e.subjectId)}${esc(TYPES[e.type])}${e.title ? ': ' + esc(e.title) : ''}</span><span>${esc(subjName(e.subjectId))}${e.grade != null ? ` · nota ${fmt(e.grade, 1)}` : ''}</span></div>`).join('')}` : ''}
      ${due.length ? `<h3 class="sub-h">Pendientes para este día</h3>${due.map((t) => `<div class="top-row"><span>${t.done ? '✓ ' : ''}${esc(t.text)}</span><span>${esc(subjName(t.subjectId))}</span></div>`).join('')}` : ''}`,
    footer: `<button class="btn" data-x="ev">${icon('calendar', 18)} Agregar fecha</button><button class="btn primary" data-x="time">${icon('plus', 18)} Anotar tiempo</button>`,
  });
  s.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del-s]'); if (!b) return;
    const x = S.sessions.find((y) => y.id === b.dataset.delS); if (!x) return;
    if (!(await confirmDialog({ title: '¿Borrar esta sesión?', ok: 'Borrar', danger: true }))) return;
    S.sessions = S.sessions.filter((y) => y !== x);
    store.setStudy(d, Math.max(0, studyH(d) - x.min / 60)); store.commit('estudio'); s.close();
  });
  s.foot.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-x]'); if (!b) return;
    s.close();
    if (b.dataset.x === 'ev') editEvent(null, d); else manualTime(d);
  });
}
async function manualTime(date = todayISO(), subjectId) {
  let sid = subjectId;
  if (sid === undefined) { sid = await pickSubject(null, '¿Qué materia?'); if (sid === undefined) return; }
  const r = await formSheet({ title: 'Anotar tiempo de estudio', fields: [
    { key: 'date', label: 'Día', type: 'date', value: date, full: true },
    { key: 'h', label: 'Horas', type: 'number', value: '', placeholder: '1,5' },
    { key: 'm', label: 'Minutos', type: 'number', value: '', placeholder: '30' },
    { key: 'note', label: 'Qué estudiaste (opcional)', type: 'text', full: true },
  ] });
  if (!r) return;
  const min = Math.round((Number.isFinite(r.h) ? r.h * 60 : 0) + (Number.isFinite(r.m) ? r.m : 0));
  if (!(min > 0) || min > 16 * 60) { toast('Ingresá un tiempo válido'); return; }
  if (r.date > todayISO()) { toast('No se puede anotar en días futuros'); return; }
  addSession({ date: r.date, subjectId: sid, min, note: r.note.trim() });
  store.commit('estudio');
  toast(`Anotado: ${fmtH(min / 60)}`);
}
function openSubject(id) {
  const sb = subj(id); if (!sb) return;
  const S = ST();
  const draw = () => {
    const sess = S.sessions.filter((x) => x.subjectId === id).sort((a, b) => b.date.localeCompare(a.date));
    const total = sess.reduce((t, x) => t + x.min / 60, 0);
    const evs = S.events.filter((e) => e.subjectId === id).sort((a, b) => a.date.localeCompare(b.date));
    const tasks = S.tasks.filter((t) => t.subjectId === id).sort((a, b) => Number(a.done) - Number(b.done));
    const notes = S.notes.filter((n) => n.subjectId === id).sort((a, b) => b.at - a.at);
    const grades = evs.filter((e) => e.grade != null);
    return `<div class="stat-grid"><div class="stat"><small>Total estudiado</small><b>${fmtH(total)}</b><span>${sess.length} sesiones</span></div><div class="stat"><small>Promedio de notas</small><b>${grades.length ? fmt(grades.reduce((a, e) => a + e.grade, 0) / grades.length, 1) : '–'}</b><span>${grades.length} notas</span></div></div>
      <div class="row" style="gap:8px;margin-top:12px"><button class="btn primary" style="flex:1" data-s="start">${icon('play', 18)} Estudiar ahora</button><button class="btn" data-s="time">${icon('plus', 18)} Tiempo</button></div>
      <div class="section-head" style="margin-top:18px"><h3>Fechas</h3><button class="link" data-s="ev">Agregar</button></div>
      ${evs.length ? evs.map((e) => `<button class="st-row" data-s="ev-edit" data-id="${e.id}"><span class="grow"><b>${esc(TYPES[e.type])}${e.title ? ': ' + esc(e.title) : ''}</b><small>${esc(cap(fmtDayShort(e.date)))}${e.grade != null ? ` · nota ${fmt(e.grade, 1)}` : ''}</small></span><span class="badge">${e.date >= todayISO() ? untilLabel(e.date) : 'pasó'}</span></button>`).join('') : '<p class="muted">Sin fechas.</p>'}
      <div class="section-head" style="margin-top:18px"><h3>Pendientes</h3><button class="link" data-s="task">Agregar</button></div>
      ${tasks.length ? tasks.map((t) => `<div class="st-row"><button class="st-check ${t.done ? 'on' : ''}" data-s="tt" data-id="${t.id}">${t.done ? icon('check', 16) : ''}</button><span class="grow st-task-txt ${t.done ? 'done' : ''}"><b>${esc(t.text)}</b>${t.due ? `<small>para ${esc(untilLabel(t.due))}</small>` : ''}</span><button class="icon-btn" data-s="tdel" data-id="${t.id}" aria-label="Borrar">${icon('trash', 16)}</button></div>`).join('') : '<p class="muted">Sin pendientes.</p>'}
      <div class="section-head" style="margin-top:18px"><h3>Notas</h3><button class="link" data-s="note">Agregar</button></div>
      ${notes.length ? notes.map((n) => `<div class="st-note"><p>${esc(n.text)}</p><small class="muted">${esc(cap(fmtDayShort(new Date(n.at).toLocaleDateString('sv-SE'))))} · <button class="link" data-s="ndel" data-id="${n.id}">borrar</button></small></div>`).join('') : '<p class="muted">Ideas, fórmulas, dudas para consultar…</p>'}
      <div class="section-head" style="margin-top:18px"><h3>Últimas sesiones</h3></div>
      ${sess.slice(0, 8).map((x) => `<div class="top-row"><span>${esc(cap(fmtDayShort(x.date)))}${x.note ? ` <small class="muted">· ${esc(x.note)}</small>` : ''}</span><span>${fmtH(x.min / 60)}</span></div>`).join('') || '<p class="muted">Todavía no hay sesiones.</p>'}`;
  };
  const s = openSheet({ title: sb.name, full: true, body: draw(), footer: `<button class="btn ghost" data-s="del">${icon('trash', 18)}</button><button class="btn" data-s="edit">${icon('edit', 18)} Editar materia</button>` });
  const redraw = () => { if (!s.closed) s.setBody(draw()); };
  const handler = async (e) => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    const k = b.dataset.s;
    if (k === 'start') { s.close(); chooseModeAndStart(id); }
    else if (k === 'time') { await manualTime(todayISO(), id); redraw(); }
    else if (k === 'ev') { const type = await pickOption({ title: 'Tipo de fecha', options: Object.entries(TYPES).map(([value, label]) => ({ value, label })) }); if (!type) return; const ev = { id: uid('ev'), date: addDays(todayISO(), 7), subjectId: id, type, title: '', done: false }; S.events.push(ev); await editEvent(ev); redraw(); }
    else if (k === 'ev-edit') { const ev = S.events.find((x) => x.id === b.dataset.id); if (ev) { await editEvent(ev); redraw(); } }
    else if (k === 'task') { await editTask(null, id); redraw(); }
    else if (k === 'tt') { const t = S.tasks.find((x) => x.id === b.dataset.id); if (t) { t.done = !t.done; t.doneAt = t.done ? Date.now() : null; store.commit('estudio'); redraw(); } }
    else if (k === 'tdel') { S.tasks = S.tasks.filter((x) => x.id !== b.dataset.id); store.commit('estudio'); redraw(); }
    else if (k === 'note') { const v = await promptText({ title: 'Nota', label: sb.name }); if (v) { S.notes.push({ id: uid('nt'), subjectId: id, text: v, at: Date.now() }); store.commit('estudio'); redraw(); } }
    else if (k === 'ndel') { S.notes = S.notes.filter((x) => x.id !== b.dataset.id); store.commit('estudio'); redraw(); }
    else if (k === 'edit') {
      const r = await formSheet({ title: 'Materia', fields: [{ key: 'name', label: 'Nombre', type: 'text', value: sb.name, full: true }, { key: 'goal', label: 'Meta semanal (horas, opcional)', type: 'number', value: sb.goalWeek || '', full: true }] });
      if (!r) return;
      if (r.name.trim()) sb.name = r.name.trim();
      sb.goalWeek = Number.isFinite(r.goal) && r.goal > 0 ? r.goal : 0;
      const c = await pickOption({ title: 'Color', value: sb.color, options: COLORS.map((x, i) => ({ value: x, label: ['Azul', 'Rojo', 'Ámbar', 'Violeta', 'Verde', 'Turquesa', 'Marrón', 'Gris'][i] })) });
      if (c) sb.color = c;
      store.commit('estudio'); s.setTitle(sb.name); redraw();
    } else if (k === 'del') {
      if (!(await confirmDialog({ title: `¿Borrar ${sb.name}?`, text: 'Se borran sus fechas, pendientes y notas. Las horas ya estudiadas quedan en el total del día.', ok: 'Borrar', danger: true }))) return;
      S.subjects = S.subjects.filter((x) => x.id !== id);
      S.events = S.events.filter((x) => x.subjectId !== id); S.tasks = S.tasks.filter((x) => x.subjectId !== id); S.notes = S.notes.filter((x) => x.subjectId !== id);
      for (const x of S.sessions) if (x.subjectId === id) x.subjectId = null;
      store.commit('estudio'); s.close();
    }
  };
  s.body.addEventListener('click', handler);
  s.foot.addEventListener('click', handler);
}
async function chooseModeAndStart(subjectId) {
  const P = ST().pomo;
  const mode = await pickOption({ title: 'Cómo querés estudiar', options: [
    { value: 'pomodoro', label: `Pomodoro (${P.work} min + ${P.rest} de descanso)`, sub: 'Te avisa con vibración cuando toca descansar', icon: 'timer' },
    { value: 'libre', label: 'Cronómetro libre', sub: 'Cuenta hasta que lo terminás', icon: 'clock' },
  ] });
  if (!mode) return;
  startTimer(subjectId, mode);
}

// ---------------------------------------------------------------------------
// Vista HÁBITOS
// ---------------------------------------------------------------------------
function habitDone(d, id) { return !!(store.day(d).habits || {})[id]; }
function habitStats(id) {
  const today = todayISO();
  let cur = 0; { let d = habitDone(today, id) ? today : addDays(today, -1); while (habitDone(d, id)) { cur++; d = addDays(d, -1); } }
  let best = 0; let run = 0;
  const first = store.firstDate() < addDays(today, -365) ? addDays(today, -365) : store.firstDate();
  for (const d of dateRange(first < today ? first : addDays(today, -60), today)) { if (habitDone(d, id)) { run++; best = Math.max(best, run); } else run = 0; }
  const last30 = dateRange(addDays(today, -29), today).filter((d) => habitDone(d, id)).length;
  return { cur, best, pct: Math.round((last30 / 30) * 100), last30 };
}
export function renderHabitos() {
  const today = todayISO();
  const list = store.habitsList().filter((h) => h.kind !== 'hours');
  const doneToday = list.filter((h) => habitDone(today, h.id)).length;
  const head = `<section class="panel"><div class="kv"><span>${icon('check', 18)}Hoy</span><b>${doneToday} de ${list.length}</b></div>
    <div class="chips" style="margin-top:12px">${list.map((h) => { const on = habitDone(today, h.id); return `<button class="chip ${on ? 'on' : ''}" data-act="hb-toggle" data-id="${esc(h.id)}" data-date="${today}">${icon(on ? 'check' : (h.kind === 'supp' ? 'pill' : 'star'), 16)}${esc(h.name)}</button>`; }).join('')}</div></section>`;
  const start = addDays(weekStart(today), -28); // 5 semanas, de lunes a domingo
  const days = dateRange(start, addDays(weekStart(today), 6));
  const cards = list.map((h) => {
    const st = habitStats(h.id);
    const cells = days.map((d) => `<button class="hb-cell ${habitDone(d, h.id) ? 'on' : ''} ${d === today ? 'tod' : ''}" data-act="hb-toggle" data-id="${esc(h.id)}" data-date="${d}" ${d > today ? 'disabled' : ''} aria-label="${esc(fmtDayShort(d))}"></button>`).join('');
    return `<article class="panel hb-card"><div class="section-head" style="margin:0 0 8px"><h3 style="display:flex;gap:8px;align-items:center">${icon(h.kind === 'supp' ? 'pill' : 'star', 18)}${esc(h.name)}</h3><span class="muted" style="font-size:13px">${st.pct}% en 30 días</span></div>
      <div class="hb-grid"><div class="hb-w">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((x) => `<span>${x}</span>`).join('')}</div><div class="hb-g">${cells}</div></div>
      <div class="dc-sub" style="display:flex;gap:14px;margin-top:8px;font-size:13px;color:var(--ink-3)"><span>Racha actual <b style="color:var(--ink)">${st.cur}</b></span><span>Mejor racha <b style="color:var(--ink)">${st.best}</b></span><span>${st.last30} de 30 días</span></div>
    </article>`;
  }).join('');
  return `<h1 class="view-title">Hábitos</h1>${head}
    <p class="muted" style="font-size:13.5px;margin:12px 2px">Tocá un cuadrito para marcar o desmarcar ese día.</p>
    ${cards || '<div class="empty"><strong>Sin hábitos</strong>Agregalos desde Ajustes.</div>'}
    <button class="btn ghost" style="width:100%;margin-top:12px" data-act="edit-habits">${icon('edit', 18)} Editar hábitos y suplementos</button>`;
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------
export const studyActions = {
  'st-start': async () => { const sid = await pickSubject(null, '¿Qué vas a estudiar?'); if (sid === undefined) return; chooseModeAndStart(sid); },
  'st-pause': () => pauseTimer(),
  'st-resume': () => resumeTimer(),
  'st-finish': () => finishTimer(),
  'st-discard': async () => { if (await confirmDialog({ title: '¿Descartar la sesión?', text: 'No se guarda este tiempo.', ok: 'Descartar', danger: true })) { ST().active = null; store.commit('estudio'); } },
  'st-manual': () => manualTime(),
  'st-event-new': () => editEvent(),
  'st-event': (el) => { const ev = ST().events.find((x) => x.id === el.dataset.id); if (ev) editEvent(ev); },
  'st-task-new': () => editTask(),
  'st-task': (el) => { const t = ST().tasks.find((x) => x.id === el.dataset.id); if (t) editTask(t); },
  'st-task-toggle': (el) => { const t = ST().tasks.find((x) => x.id === el.dataset.id); if (!t) return; t.done = !t.done; t.doneAt = t.done ? Date.now() : null; vibrate(t.done ? 20 : 8); store.commit('estudio'); },
  'st-subject-new': async () => { const v = await promptText({ title: 'Nueva materia', label: 'Nombre', placeholder: 'Ej.: Análisis Matemático II' }); if (v) newSubject(v); },
  'st-subject': (el) => openSubject(el.dataset.id),
  'st-week': (el) => { const nw = addDays(ui.study.week || weekStart(todayISO()), 7 * Number(el.dataset.d)); if (nw <= todayISO()) { ui.study.week = nw; render(); } },
  'st-month': (el) => { ui.study.month = addMonths(monthStart(ui.study.month || todayISO()), Number(el.dataset.d)); render(); },
  'st-day': (el) => openDay(el.dataset.date),
  'st-settings': async () => {
    const P = ST().pomo; const h = hoursHabit();
    const r = await formSheet({ title: 'Estudio', fields: [
      { key: 'goal', label: 'Meta diaria (horas)', type: 'number', value: h ? (h.goal || 2) : 2, full: true },
      { key: 'work', label: 'Pomodoro: estudio', type: 'number', suffix: 'min', value: P.work },
      { key: 'rest', label: 'Pomodoro: descanso', type: 'number', suffix: 'min', value: P.rest },
    ] });
    if (!r) return;
    if (h && r.goal > 0 && r.goal <= 16) h.goal = r.goal;
    if (r.work >= 5 && r.work <= 120) P.work = Math.round(r.work);
    if (r.rest >= 1 && r.rest <= 60) P.rest = Math.round(r.rest);
    store.commit('estudio');
  },
  'hb-toggle': (el) => { const d = el.dataset.date; if (!d || d > todayISO()) return; const v = store.toggleHabit(d, el.dataset.id); vibrate(v ? 15 : 8); store.commit('habit'); },
};

