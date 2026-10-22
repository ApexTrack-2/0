// ApexTrack 2 — controlador principal: navegación, pantalla Hoy, registro con IA, revisión y editor.
import {
  todayISO, addDays, weekStart, fmt, fmtDayLong, fmtDayShort, relativeDayLabel, esc, cap, round1, round0, parseNum,
  vibrate, deepClone, uid, norm, daysBetween, debounce, dateRange,
} from './util.js';
import * as store from './store.js';
import * as AI from './ai.js';
import {
  searchFoods, getFood, per100Of, foodUnits, unitLabel, gramsFor, portionText, canonUnit, UNITS, GENERIC_UNIT_G, calc, sanitizePer100,
} from './foods.js';
import { icon } from './icons.js';
import {
  openSheet, toast, confirmDialog, pickOption, pickDate, promptText, formSheet, setRootBack, setBusy, sheetsOpen, closeAllSheets, swipes,
} from './ui.js';
import { canDictate, canRecord, startDictation, startRecording } from './voice.js';
import { pickImage, scanBarcode, lookupBarcode, canScan, shrink } from './camera.js';
import { renderDiario, renderProgreso, renderGym, openSettings, gymTimerTick, wireCharts, maybeBackupReminder, moreActions, maybeOnboard } from './more.js';
import { renderEstudio, renderHabitos } from './study.js';
import * as EN from './energy.js';
import { renderActividad, tabActions } from './tabs.js';
import { renderAyuno, fastingActions, fastingCard, fastingTick } from './fasting.js';
import { renderIdeas, openIdeas, startIdeas } from './ideas.js';
import { renderSueno, sleepActions, sleepCard, sleepTick, saveNightFromText } from './sleep.js';
import { maybeAutoWeekly, weeklyCard, pendingWeekly, openWeekly, askWeekly } from './weekly.js';
import { startReminders } from './notify.js';
import { scheduleCloud, cloudPush } from './backup.js';
import * as CM from './community.js';

// ---------------------------------------------------------------------------
// Estado de la interfaz
// ---------------------------------------------------------------------------
export const ui = {
  tab: 'hoy',
  date: todayISO(),
  lastToday: todayISO(),
  open: new Set(),
  diary: { mode: 'semana', week: weekStart(todayISO()), metric: 'kcal', sel: todayISO(), month: todayISO().slice(0, 8) + '01' },
  prog: { range: 30 },
  study: { week: weekStart(todayISO()), sel: todayISO(), month: todayISO().slice(0, 8) + '01' },
  online: navigator.onLine !== false,
  jobs: [], // análisis que siguen en segundo plano
};
const TABS = ['hoy', 'diario', 'gym', 'estudio', 'habitos', 'actividad', 'ayuno', 'ideas', 'sueno', 'progreso'];
export const SLOT_TABS = { gym: ['Gym', 'dumbbell'], estudio: ['Estudio', 'book'], habitos: ['Hábitos', 'check'], actividad: ['Actividad', 'walk'], ayuno: ['Ayuno', 'timer'], ideas: ['Ideas', 'meal'], sueno: ['Sueño', 'moon'] };
function slotTab() { const t = store.S().settings.ui.slotTab; return SLOT_TABS[t] ? t : 'gym'; }
function paintSlot() {
  const b = document.querySelector('.tab[data-slot]');
  if (!b) return;
  // si se está viendo otra pestaña personalizable (elegida con la flechita), el botón la muestra
  // mientras hay una sesión de gimnasio en curso, la pestaña queda en Gym hasta terminarla
  const t = SLOT_TABS[ui.tab] ? ui.tab : (store.S().gym?.active ? 'gym' : slotTab());
  if (b.dataset.tab !== t) { b.dataset.tab = t; b.innerHTML = `${icon(SLOT_TABS[t][1], 24)}${SLOT_TABS[t][0]}`; }
}

// Flechita sobre la pestaña personalizable: despliega las demás sin pasar por Ajustes
function slotMenu(open) {
  let m = document.getElementById('slot-menu');
  if (!open) { if (m) m.remove(); document.getElementById('slot-more')?.setAttribute('aria-expanded', 'false'); return; }
  if (m) { slotMenu(false); return; }
  const main = slotTab();
  m = document.createElement('div');
  m.id = 'slot-menu'; m.className = 'slot-menu'; m.setAttribute('role', 'menu');
  m.innerHTML = Object.entries(SLOT_TABS).map(([k, [label, ic]]) => `<button role="menuitem" data-slot-go="${k}" class="${ui.tab === k ? 'on' : ''}">${icon(ic, 20)}<span>${label}</span>${k === main ? '<small>principal</small>' : ''}</button>`).join('');
  document.querySelector('.slot-wrap').appendChild(m);
  document.getElementById('slot-more')?.setAttribute('aria-expanded', 'true');
  m.addEventListener('click', (e) => { const b = e.target.closest('[data-slot-go]'); if (!b) return; slotMenu(false); go(b.dataset.slotGo); });
  setTimeout(() => document.addEventListener('click', function off(e) { if (!e.target.closest('#slot-menu') && !e.target.closest('#slot-more')) { slotMenu(false); document.removeEventListener('click', off, true); } }, true), 0);
}

export function go(tab, { push = true } = {}) {
  if (!TABS.includes(tab)) tab = 'hoy';
  if (tab === ui.tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (push && tab !== 'hoy' && ui.tab === 'hoy') history.pushState({ tab }, '');
  else if (push) history.replaceState({ tab }, '');
  ui.tab = tab;
  render();
  window.scrollTo(0, 0);
}
setRootBack(() => { if (ui.tab !== 'hoy') { ui.tab = 'hoy'; render(); } });

export function setDate(d) {
  ui.date = d > addDays(todayISO(), 1) ? todayISO() : d;
  ui.open.clear();
  render();
}

// ---------------------------------------------------------------------------
// Render general
// ---------------------------------------------------------------------------
export function render() {
  const v = document.getElementById('view');
  if (!v) return;
  const y = window.scrollY;
  let html = '';
  if (ui.tab === 'hoy') html = viewHoy();
  else if (ui.tab === 'diario') html = renderDiario();
  else if (ui.tab === 'gym') html = renderGym();
  else if (ui.tab === 'progreso') html = renderProgreso();
  else if (ui.tab === 'estudio') html = renderEstudio();
  else if (ui.tab === 'habitos') html = renderHabitos();
  else if (ui.tab === 'actividad') html = renderActividad();
  else if (ui.tab === 'ayuno') html = renderAyuno();
  else if (ui.tab === 'ideas') html = renderIdeas();
  else if (ui.tab === 'sueno') html = renderSueno();
  paintSlot();
  v.innerHTML = html;
  v.dataset.tab = ui.tab;
  document.querySelectorAll('.tab[data-tab]').forEach((b) => {
    const on = b.dataset.tab === ui.tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  const off = document.getElementById('offline');
  if (off) off.hidden = ui.online;
  wireCharts(v);
  window.scrollTo(0, y);
}
export const refresh = render;

// ---------------------------------------------------------------------------
// Pantalla HOY
// ---------------------------------------------------------------------------
function dayMarks(d) {
  const t = store.dayTotals(d);
  if (!t.items) return null;
  const g = store.goals();
  const pct = g.kcal ? t.kcal / g.kcal : 0;
  if (EN.isCut()) return pct > 1.05 ? 'bajo' : pct > 1.0 ? 'cerca' : pct >= 0.8 ? 'meta' : 'cerca'; // bajando de peso: pasarse es lo que preocupa
  return pct >= 0.95 ? 'meta' : pct >= 0.8 ? 'cerca' : 'bajo';
}
export { dayMarks };

function viewHoy() {
  const d = ui.date;
  const today = todayISO();
  const g = store.goals();
  const t = store.dayTotals(d);
  const rec = store.day(d);
  const S = store.S();
  const entries = store.entriesOn(d);
  const left = g.kcal - t.kcal;

  // fecha + semana
  const ws = weekStart(d);
  const week = dateRange(ws, addDays(ws, 6)).map((x) => {
    const tt = store.dayTotals(x);
    const pct = Math.min(100, g.kcal ? (tt.kcal / g.kcal) * 100 : 0);
    const dt = new Date(x + 'T12:00:00');
    return `<button class="wd ${x === d ? 'on' : ''} ${x === today ? 'tod' : ''} ${x > today ? 'fut' : ''}" data-act="date-set" data-date="${x}" ${x > addDays(today, 1) ? 'disabled' : ''} aria-label="${esc(fmtDayLong(x))}">
      <small>${['D', 'L', 'M', 'M', 'J', 'V', 'S'][dt.getDay()]}</small><b>${dt.getDate()}</b><span class="wd-fill"><i style="width:${pct}%"></i></span></button>`;
  }).join('');
  const rel = relativeDayLabel(d, today);
  const dateHtml = `
    <div class="date-nav">
      <button class="icon-btn" data-act="date-prev" aria-label="Día anterior">${icon('left')}</button>
      <button class="date-label" data-act="date-pick" aria-label="Elegir fecha">
        <span><strong>${esc(rel === 'Hoy' || rel === 'Ayer' || rel === 'Anteayer' || rel === 'Mañana' ? rel : cap(fmtDayLong(d).split(' ')[0]))}</strong><small>${esc(cap(fmtDayLong(d)))}</small></span>
        ${icon('down', 18)}
      </button>
      ${d !== today ? `<button class="today-chip" data-act="date-today">Volver a hoy</button>` : ''}
      <button class="icon-btn" data-act="date-next" aria-label="Día siguiente" ${d >= today ? 'disabled' : ''}>${icon('right')}</button>
    </div>
    <div class="week-strip" data-swipe="week">${week}</div>`;

  // héroe
  const total = Math.max(g.kcal, t.kcal) || 1;
  const segs = entries.map((e) => ({ name: store.momentName(e.moment), kcal: store.entryMacros(e).kcal })).filter((x) => x.kcal > 0);
  const segHtml = segs.map((x) => `<span class="seg" style="flex:0 0 calc(${(x.kcal / total) * 100}% - 2px)" title="${esc(x.name)}: ${fmt(x.kcal)} kcal"></span>`).join('');
  const en = EN.dayEnergy(d);
  const cut = EN.isCut();
  const excess = cut && left < 0;
  const bal = en.balance;
  const energyLine = `<button class="energy-line ${excess ? 'bad' : ''}" data-act="energy" aria-label="Ver gasto estimado">${icon('flame', 16)}<span>Gasto estimado <b>${fmt(en.total)}</b> kcal${en.act ? ` · actividad ${fmt(en.act)}` : ''}</span><span class="bal ${cut ? (bal > 0 ? 'bad' : 'good') : ''}">${bal > 0 ? '+' : '−'}${fmt(Math.abs(bal))}</span></button>`;
  const hero = `
    <section class="hero ${excess ? 'excess' : ''}" aria-label="Calorías del día">
      <div class="hero-row">
        <div><div class="hero-num">${fmt(t.kcal)}</div><div class="hero-goal">de ${fmt(g.kcal)} kcal</div></div>
        <div class="hero-left ${left < 0 ? 'over' : ''}"><b>${fmt(Math.abs(left))}</b><span>${left >= 0 ? 'kcal para la meta' : (cut ? 'kcal pasado de la meta' : 'kcal sobre la meta')}</span></div>
      </div>
      <div class="stack" role="img" aria-label="${fmt(t.kcal)} de ${fmt(g.kcal)} kcal">${segHtml}<span class="goal-tick" style="left:calc(${(g.kcal / total) * 100}% - 1px)"></span></div>
      ${segs.length ? `<div class="stack-legend">${segs.map((x) => `<span>${esc(x.name)} <b>${fmt(x.kcal)}</b></span>`).join('')}</div>` : ''}
      ${energyLine}
    </section>`;

  // macros
  const mrow = (name, v, goal, c, unit = 'g') => `
    <div class="macro" style="--c:var(${c})">
      <span class="macro-name"><i></i>${name}</span>
      <span class="macro-val"><b>${fmt(v)}</b> / ${fmt(goal)} ${unit}</span>
      <span class="meter"><i style="width:${Math.min(100, goal ? (v / goal) * 100 : 0)}%"></i></span>
    </div>`;
  const glass = S.settings.ui.glassMl || 250;
  const nG = Math.max(4, Math.min(16, Math.round((g.waterMl || 2500) / glass)));
  const filled = Math.floor((rec.water || 0) / glass);
  let glasses = '';
  for (let i = 0; i < Math.max(nG, filled); i++) glasses += `<button class="glass ${i < filled ? 'on' : ''}" data-act="glass" data-i="${i}" aria-label="${i < filled ? 'Quitar' : 'Marcar'} vaso ${i + 1}">${icon('glass', 26)}</button>`;
  const macros = `
    <section class="panel">
      <div class="macros">
        ${mrow('Proteína', t.p, g.p, '--prot')}
        ${mrow('Carbohidratos', t.c, g.c, '--carb')}
        ${mrow('Grasas', t.f, g.f, '--fat')}
        <div class="macro-foot"><span>Azúcares <b>${fmt(t.s)} g</b>${g.sugarMax ? ` / máx. ${fmt(g.sugarMax)}` : ''}</span><span>Fibra <b>${fmt(t.fb)} g</b></span></div>
      </div>
      <div class="water">
        <div class="water-head"><strong>${icon('drop', 18)}Agua</strong><span><b>${fmt((rec.water || 0) / 1000, 2)}</b> / ${fmt((g.waterMl || 2500) / 1000, 1)} L</span></div>
        <div class="glasses">${glasses}</div>
        <div class="water-quick">
          <button class="chip soft" data-act="water-add" data-ml="${glass}">${icon('plus', 16)} ${glass} ml</button>
          <button class="chip soft" data-act="water-add" data-ml="500">${icon('plus', 16)} 500 ml</button>
          <button class="chip soft" data-act="water-custom">Otra cantidad</button>
        </div>
      </div>
    </section>`;

  // hábitos, gym y peso
  const habits = store.habitsList();
  const chips = habits.filter((h) => h.kind !== 'hours').map((h) => {
    const on = !!(rec.habits || {})[h.id];
    return `<button class="chip ${on ? 'on' : ''}" data-act="habit" data-id="${esc(h.id)}" aria-pressed="${on}">${icon(on ? 'check' : (h.kind === 'supp' ? 'pill' : 'star'), 16)}${esc(h.name)}${h.detail ? ` <small>${esc(h.detail)}</small>` : ''}</button>`;
  }).join('');
  const hours = habits.find((h) => h.kind === 'hours');
  const w = store.bodyOn(d);
  const gymStates = [['fui', 'Fui'], ['no_fui', 'No fui'], ['descanso', 'Descanso']];
  const extras = `
    <section class="section">
      <div class="section-head"><h3>Hábitos y suplementos</h3><button class="link" data-act="edit-habits">Editar</button></div>
      <div class="chips">${chips || '<span class="muted">Sin hábitos configurados.</span>'}</div>
      <div class="day-extras panel" style="margin-top:12px">
        <div class="kv"><span>${icon('dumbbell', 18)}Gimnasio</span>
          <div class="seg-ctl gym-seg" style="min-width:min(230px,100%);flex:1 1 230px;max-width:100%">${gymStates.map(([k, l]) => `<button class="${rec.gym === k ? 'on' : ''}" data-act="gym-day" data-v="${k}" aria-pressed="${rec.gym === k}">${l}</button>`).join('')}</div></div>
        <div class="kv"><span>${icon('walk', 18)}Actividad</span><button class="weight-btn" data-act="activity-add">${en.items.length ? `${fmt(en.items.reduce((x, a) => x + a.kcal, 0))} kcal` : 'Agregar'}</button></div>
        ${d === today ? sleepCard() : ''}
        <div class="kv"><span>${icon('scale', 18)}Peso en ayunas</span><button class="weight-btn" data-act="weight">${w && w.weight ? `${fmt(w.weight, 1)} kg` : 'Registrar'}</button></div>
        ${hours ? `<div class="kv"><span>${icon('book', 18)}${esc(hours.name)}</span><div class="study"><button class="step-btn" data-act="study" data-d="-0.5" aria-label="Menos">${icon('minus', 18)}</button><b>${fmt(rec.study || 0, 1)} h</b><button class="step-btn" data-act="study" data-d="0.5" aria-label="Más">${icon('plus', 18)}</button></div></div>` : ''}
      </div>
    </section>`;

  // comidas
  const pend = S.pending.length ? `<div class="banner info">${icon('wifioff', 20)}<div class="grow">Tenés ${S.pending.length} ${S.pending.length === 1 ? 'registro guardado' : 'registros guardados'} sin analizar.</div><button class="btn small" data-act="pending">Analizar</button></div>` : '';
  const jobs = ui.jobs.length ? `<div class="banner info"><span class="spin"></span><div class="grow"><b>${ui.jobs.length === 1 ? 'Analizando una comida' : `Analizando ${ui.jobs.length} registros`} en segundo plano</b><div class="muted" id="bg-status" style="margin-top:2px">${esc(ui.jobs[0].status || 'Analizando…')}</div></div></div>` : '';
  const meals = entries.map((e) => mealCard(e)).join('');
  const mealsHtml = `
    <section class="section">
      <div class="section-head"><h3>Comidas</h3><span style="display:flex;gap:14px">${d === today ? `<button class="link" data-act="ideas-open">¿Qué como?</button>` : ''}${entries.length ? `<button class="link" data-act="log">Agregar</button>` : ''}</span></div>
      ${pend}
      ${meals ? `<div class="meals">${meals}</div>` : `<div class="empty"><strong>${d === today ? 'Todavía no registraste nada hoy' : 'Sin comidas este día'}</strong>Tocá el micrófono y contá qué comiste, como en un mensaje.<div style="margin-top:14px"><button class="btn primary" data-act="log">${icon('mic', 20)} Registrar comida</button></div></div>`}
    </section>`;
  return dateHtml + (d === today ? weeklyCard() + fastingCard() : '') + (jobs ? `<div style="margin-top:10px">${jobs}</div>` : '') + hero + macros + mealsHtml + extras;
}

function mealCard(e) {
  const m = store.entryMacros(e);
  const open = ui.open.has(e.id);
  const items = e.items.map((it) => {
    const im = store.itemMacros(it);
    return `<button class="item-row" data-act="item" data-id="${it.id}">
      <span class="item-main"><span class="item-name">${esc(it.name)}</span><span class="item-sub">${esc(portionText(it))}</span></span>
      <span class="item-kcal">${fmt(im.kcal)}<small>P ${fmt(im.p, 1)} · C ${fmt(im.c, 0)} · G ${fmt(im.f, 1)}</small></span></button>`;
  }).join('');
  return `<article class="meal ${open ? 'open' : ''}" data-entry="${e.id}">
    <button class="meal-head" data-act="meal-toggle" data-id="${e.id}" aria-expanded="${open}">
      <h4>${esc(store.momentName(e.moment))}</h4>
      <span class="meal-sum"><b>${fmt(m.kcal)} kcal</b><small>P ${fmt(m.p, 0)} · C ${fmt(m.c, 0)} · G ${fmt(m.f, 0)}</small></span>
      ${icon('down', 18, 'chev')}
    </button>
    <div class="meal-preview">${esc(e.items.map((i) => i.name.split(' (')[0]).join(', '))}</div>
    <div class="meal-items">${items}
      <div class="meal-actions">
        <button class="btn small" data-act="log" data-moment="${e.moment}">${icon('plus', 16)} Agregar</button>
        <button class="btn small" data-act="meal-copy" data-id="${e.id}">${icon('copy', 16)} Copiar</button>
        <button class="btn small" data-act="meal-move" data-id="${e.id}">${icon('move', 16)} Mover</button>
        <button class="btn small ghost" data-act="meal-del" data-id="${e.id}" aria-label="Eliminar comida">${icon('trash', 16)}</button>
      </div>
    </div>
  </article>`;
}

// ---------------------------------------------------------------------------
// Acciones globales (delegación de eventos)
// ---------------------------------------------------------------------------
const actions = {
  'tab': (el) => go(el.dataset.tab),
  'date-prev': () => setDate(addDays(ui.date, -1)),
  'date-next': () => { if (ui.date < todayISO()) setDate(addDays(ui.date, 1)); },
  'date-today': () => setDate(todayISO()),
  'date-set': (el) => setDate(el.dataset.date),
  'date-pick': async () => { const d = await pickDate({ value: ui.date, marks: dayMarks, max: todayISO() }); if (d) setDate(d); },
  'log': (el) => openLogger({ date: ui.date, moment: el.dataset.moment || null }),
  'meal-toggle': (el) => { const id = el.dataset.id; if (ui.open.has(id)) ui.open.delete(id); else ui.open.add(id); const card = el.closest('.meal'); card.classList.toggle('open'); el.setAttribute('aria-expanded', card.classList.contains('open')); },
  'item': (el) => { const f = store.findItem(el.dataset.id); if (f) editSavedItem(f); },
  'meal-del': async (el) => {
    const e = store.S().entries.find((x) => x.id === el.dataset.id);
    if (!e) return;
    if (!(await confirmDialog({ title: `¿Eliminar ${store.momentName(e.moment).toLowerCase()}?`, text: `Se borran ${e.items.length} alimentos (${fmt(store.entryMacros(e).kcal)} kcal).`, ok: 'Eliminar', danger: true }))) return;
    const snap = deepClone(e);
    store.removeEntry(e.id); store.commit('del');
    toast('Comida eliminada', { action: 'Deshacer', onAction: () => { store.S().entries.push(snap); store.commit('undo'); } });
  },
  'meal-copy': async (el) => {
    const e = store.S().entries.find((x) => x.id === el.dataset.id);
    if (!e) return;
    const d = await pickDate({ title: 'Copiar a…', value: todayISO(), max: addDays(todayISO(), 1) });
    if (!d) return;
    const m = await pickMoment(e.moment, 'Copiar a la comida…');
    if (!m) return;
    store.copyEntryTo(e.id, d, m); store.commit('copy');
    toast(`Copiado a ${relativeDayLabel(d).toLowerCase()} · ${store.momentName(m)}`, { action: 'Ver', onAction: () => setDate(d) });
  },
  'meal-move': async (el) => {
    const e = store.S().entries.find((x) => x.id === el.dataset.id);
    if (!e) return;
    const m = await pickMoment(e.moment, 'Mover a…');
    if (!m || m === e.moment) return;
    for (const it of e.items.slice()) store.moveItem(it.id, e.date, m);
    store.commit('move');
  },
  'glass': (el) => {
    const i = Number(el.dataset.i);
    const glass = store.S().settings.ui.glassMl || 250;
    const cur = Math.floor((store.day(ui.date).water || 0) / glass);
    store.setWater(ui.date, i < cur ? i * glass : (i + 1) * glass);
    vibrate(10); store.commit('water');
  },
  'water-add': (el) => {
    const d = el.dataset.date || (ui.tab === 'agua' ? todayISO() : ui.date);
    const ml = Number(el.dataset.ml);
    store.addWater(d, ml); vibrate(10); store.commit('water');
    toast(`${ml > 0 ? '+' : '−'}${Math.abs(ml)} ml de agua`, { action: 'Deshacer', onAction: () => { store.addWater(d, -ml); store.commit('water'); } });
  },
  'watch-shot': async () => {
    const img = await pickImage({ gallery: true });
    if (img) openLogger({ date: todayISO(), image: img, text: 'Captura de mi reloj / app de salud' });
  },
  'weekly-open': () => openWeekly(pendingWeekly()),
  'ideas-open': () => openIdeas(),
  'weekly-ask': () => askWeekly(),
  'water-custom': async () => {
    const r = await formSheet({ title: 'Agua', fields: [{ key: 'ml', label: 'Cantidad para sumar', type: 'number', suffix: 'ml', value: '' }, { key: 'total', label: 'O total del día', type: 'number', suffix: 'ml', value: store.day(ui.date).water || '' }] });
    if (!r) return;
    if (Number.isFinite(r.ml) && r.ml) store.addWater(ui.date, r.ml);
    else if (Number.isFinite(r.total)) store.setWater(ui.date, r.total);
    store.commit('water');
  },
  'habit': (el) => { const v = store.toggleHabit(ui.date, el.dataset.id); vibrate(v ? 15 : 8); store.commit('habit'); },
  'gym-day': (el) => { const cur = store.day(ui.date).gym; store.setGym(ui.date, cur === el.dataset.v ? null : el.dataset.v); store.commit('gym'); },
  'study': (el) => { store.setStudy(ui.date, (store.day(ui.date).study || 0) + Number(el.dataset.d)); store.commit('study'); },
  'weight': async () => {
    const b = store.bodyOn(ui.date);
    const last = store.latestWeight();
    const v = await promptText({ title: `Peso · ${relativeDayLabel(ui.date).toLowerCase()}`, label: 'Peso en ayunas', value: b?.weight ? String(b.weight).replace('.', ',') : '', placeholder: last ? String(last.kg).replace('.', ',') : '60,0', inputmode: 'decimal', suffix: 'kg' });
    if (v == null) return;
    const kg = parseNum(v);
    if (v.trim() === '') { if (b) { delete b.weight; store.commit('peso'); } return; }
    if (!(kg >= 25 && kg <= 300)) { toast('Ingresá un peso válido en kg', { kind: 'error' }); return; }
    store.upsertBody(ui.date, { weight: round1(kg) }); store.commit('peso');
  },
  'edit-habits': () => openSettings('habitos'),
  'pending': () => runPending(),
  'settings': () => openSettings(),
};

async function pickMoment(current, title = 'Comida') {
  const v = await pickOption({ title, value: current, options: store.moments().map((m) => ({ value: m.id, label: m.name })) });
  return v || null;
}
export { pickMoment };

export function registerActions(more) { Object.assign(actions, more); }
Object.assign(actions, moreActions, tabActions, fastingActions, sleepActions);

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  if (el.closest('.sheet') && !el.closest('#view')) return; // las hojas manejan sus propios clics
  const fn = actions[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});

// deslizar la semana (con animación: ui.js) y deslizar entre pestañas
swipes.week = (dir) => {
  let nd = addDays(ui.date, 7 * dir);
  if (nd > todayISO()) nd = todayISO();
  if (nd === ui.date) return false;
  setDate(nd); return true;
};
swipes.$tab = (dir) => {
  const order = [...document.querySelectorAll('.tabbar .tab[data-tab]')].map((b) => b.dataset.tab);
  const i = order.indexOf(ui.tab);
  const next = order[i + dir];
  if (i < 0 || !next) return false;
  go(next); return true;
};

// ---------------------------------------------------------------------------
// Registrar (texto, voz, foto, código) → IA → revisión
// ---------------------------------------------------------------------------
// Lo que se estaba escribiendo si se cerró Registrar sin analizar: vuelve al abrirlo de nuevo.
// Solo en memoria: al recargar la página se pierde.
let loggerDraft = null;

export function openLogger({ date = ui.date, moment = null, text = '', autoMic = false, image = null } = {}) {
  const st = { date, moment: moment || (date === todayISO() ? store.momentForTime() : 'almuerzo'), text, image, audio: null, dict: null, rec: null, busy: false, draft: null, abort: false, used: false };
  const D = loggerDraft;
  if (D && !text && !image) {
    st.text = D.text; st.image = D.image; st.audio = D.audio;
    if (!moment) { st.date = D.date; st.moment = D.moment; }
  }
  loggerDraft = null;
  const nEntries = store.S().entries.length;
  const s = openSheet({ title: 'Registrar', full: true, body: '<div class="logger"></div>', footer: '', onClose: () => {
    stopVoice(st);
    if (st.busy) toBackground(st); else st.abort = true;
    const used = st.used || st.busy || st.draft || store.S().entries.length !== nEntries;
    if (!used && ((st.text || '').trim() || st.image || st.audio)) loggerDraft = { text: st.text, image: st.image, audio: st.audio, date: st.date, moment: st.moment };
  } });
  st.sheet = s;
  renderComposer(st);
  if (autoMic) setTimeout(() => toggleDictation(st), 350);
  return s;
}

function stopVoice(st) {
  if (st.dict) { st.dict.stop(); st.dict = null; }
  if (st.rec) { st.rec.cancel(); st.rec = null; }
}

function frequentChips() {
  const hf = store.historyFoods({ limit: 12 });
  const cf = store.S().customFoods.slice(-6).reverse();
  const out = [];
  for (const f of cf) out.push({ key: 'c:' + f.id, label: f.n });
  for (const h of hf) if (!out.some((o) => norm(o.label) === h.key)) out.push({ key: 'h:' + h.key, label: h.name });
  return out.slice(0, 12);
}

function renderComposer(st) {
  const s = st.sheet;
  s.setTitle('Registrar');
  const online = navigator.onLine !== false;
  const hasKey = !!store.S().settings.ai.key;
  const freq = frequentChips();
  const dLabel = `${relativeDayLabel(st.date)}${relativeDayLabel(st.date) === 'Hoy' || relativeDayLabel(st.date) === 'Ayer' ? ' · ' + fmtDayShort(st.date) : ''}`;
  s.setBody(`
    <div class="target-row">
      <button class="chip" data-l="date">${icon('calendar', 16)}${esc(dLabel)}${icon('down', 14)}</button>
      <button class="chip" data-l="moment">${icon('clock', 16)}${esc(store.momentName(st.moment))}${icon('down', 14)}</button>
    </div>
    <div class="composer">
      <textarea class="input" id="lg-text" rows="5" placeholder="Contá qué comiste, como en un mensaje.\nEj.: almuerzo 2 milanesas de pollo con puré y una banana. Tomé la creatina y 3 vasos de agua.">${esc(st.text)}</textarea>
      <button class="mic-big ${st.dict || st.rec ? 'rec' : ''}" data-l="mic" aria-label="${st.dict || st.rec ? 'Detener' : 'Dictar'}">${icon(st.dict || st.rec ? 'stop' : 'mic', 24)}</button>
    </div>
    <p class="rec-hint" id="lg-hint">${st.dict ? 'Escuchando… hablá con normalidad. Tocá el cuadrado para terminar.' : st.rec ? 'Grabando audio…' : 'Podés nombrar varios días y comidas, el agua, los suplementos y si fuiste al gym.'}</p>
    ${st.image ? `<div class="attach"><img src="${st.image.url}" alt="Foto adjunta"><span class="grow">Foto adjunta: la IA la va a leer</span><button class="icon-btn" data-l="rm-img" aria-label="Quitar foto">${icon('x', 20)}</button></div>` : ''}
    ${st.audio ? `<div class="attach"><audio controls src="${st.audio.url}"></audio><button class="icon-btn" data-l="rm-audio" aria-label="Quitar audio">${icon('x', 20)}</button></div>` : ''}
    <div class="tools">
      <button class="chip" data-l="photo">${icon('camera', 16)} Foto</button>
      <button class="chip" data-l="barcode">${icon('barcode', 16)} Código de barras</button>
      ${canRecord() ? `<button class="chip" data-l="record">${icon('mic', 16)} ${st.rec ? 'Detener grabación' : 'Grabar audio'}</button>` : ''}
      <button class="chip" data-l="search">${icon('search', 16)} Buscar en mi biblioteca</button>
      <button class="chip" data-l="repeat">${icon('repeat', 16)} Repetir comida</button>
    </div>
    ${freq.length ? `<div class="quick-title">Frecuentes (se agregan sin IA)</div><div class="chip-row">${freq.map((f) => `<button class="chip soft" data-l="freq" data-k="${esc(f.key)}">${esc(f.label.length > 34 ? f.label.slice(0, 32) + '…' : f.label)}</button>`).join('')}</div>` : ''}
    ${!hasKey ? `<div class="banner" style="margin-top:16px">${icon('key', 20)}<div class="grow">Para que la IA calcule todo, cargá tu clave gratuita de Gemini.</div><button class="btn small" data-l="settings-ai">Configurar</button></div>` : ''}
    ${!online ? `<div class="banner" style="margin-top:16px">${icon('wifioff', 20)}<div class="grow">Sin conexión: puedo calcular con tu biblioteca o guardarlo para analizarlo después.</div></div>` : ''}
  `);
  s.setFooter(online && hasKey
    ? `<button class="btn primary block" data-l="analyze">${icon('sparkle', 20)} Analizar con IA</button>`
    : `${!online ? '<button class="btn" data-l="later">Guardar para después</button>' : ''}<button class="btn primary" data-l="offline">${icon('bolt', 20)} Calcular sin IA</button>`);
  const ta = s.body.querySelector('#lg-text');
  ta.addEventListener('input', () => { st.text = ta.value; });
  if (!st.text && !st.dict) setTimeout(() => { if (!st.sheet.closed && document.activeElement !== ta && !st.busy) ta.focus({ preventScroll: true }); }, 320);
  const handler = async (e) => {
    const b = e.target.closest('[data-l]');
    if (!b || st.busy) return;
    const k = b.dataset.l;
    if (k === 'date') { const d = await pickDate({ value: st.date, marks: dayMarks, max: addDays(todayISO(), 1) }); if (d) { st.date = d; renderComposer(st); } }
    else if (k === 'moment') { const m = await pickMoment(st.moment); if (m) { st.moment = m; renderComposer(st); } }
    else if (k === 'mic') { if (st.rec) await stopRecording(st); else toggleDictation(st); }
    else if (k === 'record') { if (st.rec) await stopRecording(st); else await beginRecording(st); }
    else if (k === 'photo') { const img = await pickImage(); if (img) { st.image = img; renderComposer(st); } }
    else if (k === 'rm-img') { st.image = null; renderComposer(st); }
    else if (k === 'rm-audio') { st.audio = null; renderComposer(st); }
    else if (k === 'barcode') await barcodeFlow(st);
    else if (k === 'search') openFoodSearch({ date: st.date, moment: st.moment, onAdded: () => s.close() });
    else if (k === 'repeat') await repeatMealFlow(st);
    else if (k === 'freq') await addFrequent(st, b.dataset.k);
    else if (k === 'settings-ai') { s.close(); openSettings('ia'); }
    else if (k === 'analyze') await runAnalysis(st);
    else if (k === 'offline') runOffline(st);
    else if (k === 'later') savePending(st);
  };
  s.body.onclick = handler;
  s.foot.onclick = handler;
}

function setHint(st, text) { const h = st.sheet.body.querySelector('#lg-hint'); if (h) h.textContent = text; }

function toggleDictation(st) {
  if (st.dict) { st.dict.stop(); st.dict = null; renderComposer(st); return; }
  if (!canDictate()) {
    if (canRecord()) { beginRecording(st); return; }
    toast('Este navegador no permite dictar: escribí el texto.', { kind: 'error' });
    return;
  }
  const base = st.text ? st.text.replace(/\s+$/, '') + ' ' : '';
  st.dict = startDictation({
    onText: (fin, interim) => {
      st.text = (base + fin).replace(/\s+/g, ' ').trimStart();
      const ta = st.sheet.body.querySelector('#lg-text');
      if (ta) { ta.value = st.text + (interim ? ' ' + interim : ''); ta.scrollTop = ta.scrollHeight; }
    },
    onState: (state, msg) => {
      if (state === 'error') { st.dict = null; renderComposer(st); toast(msg, { kind: 'error', ms: 5000 }); }
      else if (state === 'detenido' && st.dict) { st.dict = null; renderComposer(st); }
    },
  });
  if (st.dict) { vibrate(15); renderComposer(st); }
}

async function beginRecording(st) {
  try {
    st.rec = await startRecording();
    vibrate(15);
    renderComposer(st);
  } catch {
    toast('No se pudo usar el micrófono. Revisá el permiso del navegador.', { kind: 'error', ms: 5000 });
  }
}
async function stopRecording(st) {
  const r = st.rec; st.rec = null;
  try { st.audio = await r.stop(); } catch { toast('No se pudo guardar el audio.', { kind: 'error' }); }
  renderComposer(st);
}

async function barcodeFlow(st) {
  const code = await scanBarcode();
  if (!code) return;
  if (navigator.onLine === false) { toast('Sin conexión: no puedo buscar el código ahora.', { kind: 'error' }); return; }
  toast('Buscando el producto…', { ms: 8000 });
  const p = await lookupBarcode(code);
  if (!p) { toast('No encontré ese código. Sacale una foto a la tabla nutricional.', { ms: 5000 }); return; }
  if (!p.per100) { toast(`Encontré "${p.name}" pero sin tabla nutricional: sacale una foto.`, { ms: 5000 }); return; }
  const tpl = { name: [p.name, p.brand].filter(Boolean).join(' · '), per100: p.per100, liq: p.liq, units: p.serving ? { porcion: p.serving } : {}, basis: 'web', code: p.code };
  openItemEditor(newItemFrom(tpl), {
    mode: 'new', title: 'Producto escaneado', saveToLibrary: true,
    onSave: (it, opts) => { addSingle(st.date, st.moment, it, opts); st.sheet.close(); },
  });
}

async function repeatMealFlow(st) {
  const from = addDays(todayISO(), -10);
  const list = store.S().entries.filter((e) => e.date >= from && e.items.length).sort((a, b) => b.date.localeCompare(a.date) || store.momentIndex(a.moment) - store.momentIndex(b.moment)).slice(0, 25);
  if (!list.length) { toast('Todavía no hay comidas para repetir.'); return; }
  const v = await pickOption({
    title: 'Repetir una comida',
    options: list.map((e) => ({ value: e.id, label: `${relativeDayLabel(e.date)} · ${store.momentName(e.moment)}`, sub: `${fmt(store.entryMacros(e).kcal)} kcal · ${e.items.map((i) => i.name.split(' (')[0]).join(', ').slice(0, 70)}` })),
  });
  if (!v) return;
  store.copyEntryTo(v, st.date, st.moment); store.commit('repeat');
  st.sheet.close();
  ui.date = st.date; render();
  toast(`Repetido en ${store.momentName(st.moment)}`);
}

async function addFrequent(st, key) {
  let tpl = null;
  if (key.startsWith('c:')) { const f = getFood(key.slice(2)); if (f) tpl = foodTemplate(f); }
  else {
    const h = store.historyFoods({ limit: 60 }).find((x) => 'h:' + x.key === key);
    if (h) tpl = { name: h.name, per100: h.per100, perUnit: h.perUnit, units: h.units, liq: h.liq, basis: 'referencia' };
  }
  if (!tpl) return;
  openItemEditor(newItemFrom(tpl), { mode: 'new', title: 'Agregar', onSave: (it, opts) => { addSingle(st.date, st.moment, it, opts); st.sheet.close(); } });
}

function addSingle(date, moment, item, opts = {}) {
  store.addItems(date, moment, [item], { source: 'manual' });
  if (opts.saveToLibrary) saveItemAsFood(item);
  store.commit('add');
  ui.date = date;
  render();
  toast(`Agregado: ${item.name.split(' (')[0]} · ${fmt(store.itemMacros(item).kcal)} kcal`);
}

function savePending(st) {
  if (!st.text.trim()) { toast('Escribí o dictá qué comiste.'); return; }
  st.used = true;
  store.S().pending.push({ id: uid('p'), text: st.text.trim(), date: st.date, moment: st.moment, at: Date.now() });
  store.commit('pending');
  st.sheet.close();
  toast('Guardado para analizar cuando vuelva la conexión.');
}

async function runPending() {
  const S = store.S();
  if (!S.pending.length) return;
  if (navigator.onLine === false) { toast('Todavía no hay conexión.'); return; }
  const p = S.pending[0];
  const s = openLogger({ date: p.date, moment: p.moment, text: p.text });
  S.pending.shift(); store.commit('pending');
  return s;
}

async function runAnalysis(st, { forceAI = false } = {}) {
  stopVoice(st);
  const text = (st.text || '').trim();
  if (!text && !st.image && !st.audio) { toast('Escribí, dictá o adjuntá algo para analizar.'); return; }
  st.used = true;
  // IA propia primero: si entiende todo el mensaje, se resuelve al instante y sin gastar consultas
  const ai = store.S().settings.ai;
  if (!forceAI && text && !st.image && !st.audio && ai.localFirst !== false) {
    const ctx = AI.buildContext({ baseDate: st.date, baseMoment: st.moment });
    const t0 = performance.now();
    const ld = AI.analyzeOffline(text, ctx);
    if (AI.localVerdict(ld, text, ctx).ok) {
      ld.meta.auto = true; ld.meta.ms = performance.now() - t0;
      showReview(st, ld);
      return;
    }
  }
  st.busy = true; st.abort = false; st.background = false;
  const btn = st.sheet.foot.querySelector('[data-l="analyze"]');
  setBusy(btn, true, 'Analizando…');
  st.sheet.body.querySelector('#lg-text')?.setAttribute('readonly', '');
  if (!st.sheet.body.querySelector('#lg-bg-hint')) st.sheet.body.insertAdjacentHTML('beforeend', '<p class="rec-hint" id="lg-bg-hint" style="margin-top:14px">Podés cerrar esta ventana y seguir usando la app: el análisis continúa y se guarda solo.</p>');
  const t0 = Date.now();
  st.status = 'Analizando…';
  const paint = () => {
    const secs = Math.round((Date.now() - t0) / 1000);
    const label = `${st.status}${secs >= 3 ? ` · ${secs} s` : ''}`;
    if (!st.background && btn && !st.sheet.closed) btn.innerHTML = `<span class="spin"></span><span>${esc(label)}</span>`;
    if (st.job) { st.job.status = label; const el = document.getElementById('bg-status'); if (el && ui.jobs[0] === st.job) el.textContent = label; }
  };
  const tick = setInterval(paint, 1000);
  try {
    const draft = await AI.analyze({
      text, image: st.image, audio: st.audio, baseDate: st.date, baseMoment: st.moment,
      onStatus: (m) => { st.status = m; paint(); },
    });
    clearInterval(tick);
    st.busy = false;
    if (st.background) { finishBackground(st, draft); return; }
    if (st.abort || st.sheet.closed) return;
    store.commit('ai');
    showReview(st, draft);
  } catch (err) {
    clearInterval(tick);
    st.busy = false;
    if (st.background) { failBackground(st, err); return; }
    if (st.sheet.closed) return;
    setBusy(btn, false);
    st.sheet.body.querySelector('#lg-text')?.removeAttribute('readonly');
    st.sheet.body.querySelector('#lg-bg-hint')?.remove();
    const code = err && err.code;
    if (code === 'sin_clave') { renderComposer(st); toast(err.message, { kind: 'error', ms: 5000 }); return; }
    const offlineOk = !!text;
    const msg = err && err.message ? err.message : 'No se pudo analizar.';
    const tries = (err && err.log) || [];
    const detailTxt = [err && err.detail ? String(err.detail).slice(0, 400) : '', ...tries.map((x, i) => `${i + 1}) ${x.model} ${x.web ? 'con web' : 'sin web'} → ${x.status || 'sin respuesta'} (${x.s} s) ${x.msg}`)].filter(Boolean).join('\n');
    const detail = detailTxt ? `<details style="margin-top:8px"><summary class="muted">Detalle técnico</summary><div class="code">${esc(detailTxt)}</div></details>` : '';
    const box = document.createElement('div');
    box.className = 'banner';
    box.style.marginTop = '14px';
    box.innerHTML = `${icon('alert', 20)}<div class="grow"><b>${esc(msg)}</b>${offlineOk ? '<div class="muted" style="margin-top:4px">Podés calcularlo con tu biblioteca (sin IA) o guardarlo para más tarde.</div>' : ''}${detail}</div>`;
    st.sheet.body.querySelector('.banner.err')?.remove();
    box.classList.add('err');
    st.sheet.body.appendChild(box);
    st.sheet.setFooter(`<button class="btn" data-l="later">Guardar para después</button>${offlineOk ? `<button class="btn primary" data-l="offline">${icon('bolt', 20)} Calcular sin IA</button>` : `<button class="btn primary" data-l="analyze">Reintentar</button>`}`);
  }
}

// --- Análisis en segundo plano (si se cierra la ventana mientras la IA trabaja) ---
function toBackground(st) {
  if (st.background) return;
  st.background = true;
  st.job = { id: uid('j'), status: st.status || 'Analizando…' };
  ui.jobs.push(st.job);
  toast('Sigo analizando en segundo plano. Se guarda solo cuando termine.', { ms: 4000 });
  if (!sheetsOpen()) render();
}
function dropJob(st) {
  ui.jobs = ui.jobs.filter((j) => j !== st.job);
  if (!sheetsOpen()) render();
  else { const el = document.getElementById('bg-status'); if (el && !ui.jobs.length) el.closest('.banner')?.remove(); }
}
function finishBackground(st, draft) {
  dropJob(st);
  const n = draft.groups.reduce((a, g) => a + g.items.length, 0);
  if (!n && !draft.water.length && !draft.habits.length && !draft.gym.length && !draft.weight.length && !(draft.study || []).length && !(draft.activity || []).length && !(draft.sleep || []).length) {
    store.S().pending.push({ id: uid('p'), text: st.text.trim(), date: st.date, moment: st.moment, at: Date.now() });
    store.commit('pending');
    toast('La IA no encontró comidas en el mensaje: quedó guardado para revisarlo', { action: 'Abrir', onAction: runPending, ms: 7000, kind: 'error' });
    return;
  }
  saveDraft(st, draft, { background: true });
}
function failBackground(st, err) {
  dropJob(st);
  store.S().pending.push({ id: uid('p'), text: (st.text || '').trim(), date: st.date, moment: st.moment, at: Date.now() });
  store.commit('pending');
  toast(`${err && err.message ? err.message : 'No se pudo analizar.'} Tu texto quedó guardado.`, { action: 'Abrir', onAction: runPending, ms: 9000, kind: 'error' });
}

function runOffline(st) {
  stopVoice(st);
  const text = (st.text || '').trim();
  if (!text) { toast('Escribí qué comiste para calcularlo con tu biblioteca.'); return; }
  st.used = true;
  const ctx = AI.buildContext({ baseDate: st.date, baseMoment: st.moment });
  const draft = AI.analyzeOffline(text, ctx);
  showReview(st, draft);
}

// ---------------------------------------------------------------------------
// Revisión del borrador
// ---------------------------------------------------------------------------
const BASIS = { referencia: ['Tu registro', ''], etiqueta: ['Etiqueta', 'web'], web: ['Web', 'web'], tabla: ['Tabla', ''], estimacion: ['Estimado', ''] };

function showReview(st, draft) {
  st.draft = draft;
  const s = st.sheet;
  s.setTitle('Revisá y guardá');
  const meta = draft.meta || {};
  const metaHtml = meta.engine === 'ia'
    ? `<span>${icon('sparkle', 14)}${esc(prettyModel(meta.model))}</span>${meta.web ? `<span>${icon('globe', 14)}con búsqueda web</span>` : ''}<span>${icon('timer', 14)}${fmt((meta.ms || 0) / 1000, 1)} s</span>${(meta.tries || []).length > 1 ? `<span title="${esc(meta.tries.map((x, i) => `${i + 1}) ${x.model} ${x.web ? 'web' : 'sin web'} → ${x.status || 'sin respuesta'} ${x.msg}`).join(' | '))}">${icon('repeat', 14)}${meta.tries.length} intentos</span>` : ''}`
    : meta.auto
      ? `<span>${icon('bolt', 14)}Resuelto al instante por la IA propia</span>${store.S().settings.ai.key ? `<button class="btn ghost small" data-r="gemini">${icon('sparkle', 14)} Revisar con Gemini</button>` : ''}`
      : `<span>${icon('bolt', 14)}Cálculo sin IA con tu biblioteca</span>`;
  const qs = draft.questions.map((q) => `<div class="rv-q">${icon('info', 18)}<span>${esc(q)}</span></div>`).join('');
  const warns = draft.warnings.map((w) => `<div class="flag">${icon('alert', 14)}<span>${esc(w)}</span></div>`).join('');
  const today = todayISO();
  let lastDate = null;
  let groupsHtml = '';
  draft.groups.forEach((g, gi) => {
    if (g.date !== lastDate) {
      groupsHtml += `<div class="rv-day">${esc(relativeDayLabel(g.date, today))}${relativeDayLabel(g.date, today).length < 9 ? ' · ' + esc(fmtDayShort(g.date)) : ''}</div>`;
      lastDate = g.date;
    }
    const gt = AI.groupTotals(g);
    groupsHtml += `<div class="rv-meal">
      <div class="rv-meal-head"><button data-r="group" data-g="${gi}">${esc(store.momentName(g.moment))}${icon('down', 14)}</button><span class="right">${fmt(gt.kcal)} kcal · P ${fmt(gt.p, 0)} g</span></div>
      ${g.items.map((it, ii) => reviewItem(it, gi, ii)).join('')}
    </div>`;
  });
  if (!draft.groups.length) groupsHtml = `<div class="empty" style="margin-top:6px"><strong>Sin alimentos</strong>${draft.water.length || draft.habits.length || draft.gym.length || draft.weight.length || draft.study?.length || draft.activity?.length || draft.sleep?.length ? 'Solo se registran los datos de abajo.' : 'No encontré comidas en el mensaje.'}</div>`;
  const extras = [];
  draft.water.forEach((w, i) => extras.push(`<span class="rv-extra">${icon('drop', 16)}${w.mode === 'fijar' ? 'Agua total' : '+'}${fmt(w.ml)} ml${w.src ? ` de agua (${esc(w.src)})` : ''} · ${esc(relativeDayLabel(w.date, today).toLowerCase())}<button data-r="rm" data-k="water" data-i="${i}" aria-label="Quitar">${icon('x', 14)}</button></span>`));
  draft.habits.forEach((h, i) => extras.push(`<span class="rv-extra">${icon(h.done ? 'check' : 'x', 16)}${esc(h.name)}${h.id ? '' : ' (nuevo)'} · ${esc(relativeDayLabel(h.date, today).toLowerCase())}<button data-r="rm" data-k="habits" data-i="${i}" aria-label="Quitar">${icon('x', 14)}</button></span>`));
  draft.gym.forEach((g, i) => extras.push(`<span class="rv-extra">${icon('dumbbell', 16)}Gym: ${g.status === 'fui' ? 'fui' : g.status === 'no_fui' ? 'no fui' : 'descanso'}${g.detail ? ` (${esc(g.detail)})` : ''} · ${esc(relativeDayLabel(g.date, today).toLowerCase())}<button data-r="rm" data-k="gym" data-i="${i}" aria-label="Quitar">${icon('x', 14)}</button></span>`));
  (draft.activity || []).forEach((a, i) => extras.push(`<span class="rv-extra">${icon('walk', 16)}${esc(EN.describeAct(a))} · ${esc(relativeDayLabel(a.date, today).toLowerCase())}<button data-r="rm" data-k="activity" data-i="${i}" aria-label="Quitar">${icon('x', 14)}</button></span>`));
  (draft.sleep || []).forEach((x, i) => extras.push(`<span class="rv-extra">${icon('moon', 16)}Dormí ${fmt(x.hours, 1)} h${x.quality ? ` · calidad ${x.quality}/5` : ''} · ${esc(relativeDayLabel(x.date, today).toLowerCase())}<button data-r="rm" data-k="sleep" data-i="${i}" aria-label="Quitar">${icon('x', 14)}</button></span>`));
  (draft.study || []).forEach((x, i) => extras.push(`<span class="rv-extra">${icon('book', 16)}Estudio ${fmt(x.hours, 1)} h · ${esc(relativeDayLabel(x.date, today).toLowerCase())}<button data-r="rm" data-k="study" data-i="${i}" aria-label="Quitar">${icon('x', 14)}</button></span>`));
  draft.weight.forEach((w, i) => extras.push(`<span class="rv-extra">${icon('scale', 16)}${fmt(w.kg, 1)} kg · ${esc(relativeDayLabel(w.date, today).toLowerCase())}<button data-r="rm" data-k="weight" data-i="${i}" aria-label="Quitar">${icon('x', 14)}</button></span>`));
  draft.skipped.forEach((k) => extras.push(`<span class="rv-extra muted">${esc(store.momentName(k.moment))}: sin registrar · ${esc(relativeDayLabel(k.date, today).toLowerCase())}</span>`));
  const tot = AI.draftTotals(draft);
  const transcript = draft.transcript && !st.text ? `<div class="note" style="margin-bottom:10px">Entendí del audio: “${esc(draft.transcript)}”</div>` : '';
  s.setBody(`
    <div class="rv-meta">${metaHtml}</div>
    ${transcript}${qs}${warns}
    ${groupsHtml}
    ${extras.length ? `<div class="rv-extras">${extras.join('')}</div>` : ''}
    ${draft.groups.length ? `<div class="rv-total"><strong>${fmt(tot.kcal)} kcal</strong><span>P ${fmt(tot.p)} g · C ${fmt(tot.c)} g · G ${fmt(tot.f)} g</span></div>` : ''}
    ${meta.engine === 'ia' || (navigator.onLine !== false && store.S().settings.ai.key) ? `
    <div class="corr">
      <textarea class="input" id="rv-corr" rows="1" placeholder="¿Algo mal? Escribí o dictá la corrección (ej.: el arroz era cocido, eran 3 huevos)"></textarea>
      <button class="icon-btn" data-r="corr-mic" aria-label="Dictar corrección">${icon('mic')}</button>
      <button class="btn primary small" data-r="corr" aria-label="Corregir con IA">${icon('send', 18)}</button>
    </div>` : ''}
  `);
  s.setFooter(`<button class="btn" data-r="back">${icon('left', 18)} Editar texto</button><button class="btn primary" data-r="save">${icon('check', 20)} Guardar todo</button>`);
  const handler = async (e) => {
    const b = e.target.closest('[data-r]');
    if (!b || st.busy) return;
    const r = b.dataset.r;
    if (r === 'item') {
      const g = draft.groups[Number(b.dataset.g)]; const it = g.items[Number(b.dataset.i)];
      openItemEditor(it, {
        mode: 'draft', title: 'Ajustar alimento',
        onSave: (upd) => { upd._edited = true; if (it.said && !upd.said) upd.said = it.said; g.items[Number(b.dataset.i)] = upd; showReview(st, draft); },
        onDelete: () => { g.items.splice(Number(b.dataset.i), 1); if (!g.items.length) draft.groups.splice(Number(b.dataset.g), 1); showReview(st, draft); },
      });
    } else if (r === 'fix-g') {
      const g = draft.groups[Number(b.dataset.g)]; const it = g.items[Number(b.dataset.i)];
      it.grams = Number(b.dataset.v); it.flags = (it.flags || []).filter((f) => f.type !== 'porcion'); showReview(st, draft);
    } else if (r === 'fix-lib') {
      const g = draft.groups[Number(b.dataset.g)]; const it = g.items[Number(b.dataset.i)];
      const f = getFood(b.dataset.food);
      if (f) { it.per100 = per100Of(f); it.foodId = f.id; it.basis = 'tabla'; it.flags = (it.flags || []).filter((x) => x.type !== 'valores'); }
      showReview(st, draft);
    } else if (r === 'group') {
      const g = draft.groups[Number(b.dataset.g)];
      const choice = await pickOption({ title: 'Cambiar', options: [{ value: 'm', label: 'Cambiar la comida', icon: 'clock', sub: store.momentName(g.moment) }, { value: 'd', label: 'Cambiar el día', icon: 'calendar', sub: relativeDayLabel(g.date) }] });
      if (choice === 'm') { const m = await pickMoment(g.moment); if (m) g.moment = m; }
      if (choice === 'd') { const d = await pickDate({ value: g.date, marks: dayMarks }); if (d) g.date = d; }
      mergeGroups(draft); showReview(st, draft);
    } else if (r === 'rm') { draft[b.dataset.k].splice(Number(b.dataset.i), 1); showReview(st, draft); }
    else if (r === 'back') { st.draft = null; renderComposer(st); }
    else if (r === 'save') saveDraft(st, draft);
    else if (r === 'gemini') { st.draft = null; renderComposer(st); runAnalysis(st, { forceAI: true }); }
    else if (r === 'corr') await runCorrection(st, draft);
    else if (r === 'corr-mic') dictateInto(st, s.body.querySelector('#rv-corr'), b);
  };
  s.body.onclick = handler;
  s.foot.onclick = handler;
}

function prettyModel(m) {
  if (!m) return 'IA';
  return m.replace(/^gemini-/, 'Gemini ').replace(/-flash/, ' Flash').replace(/-pro/, ' Pro').replace(/-lite/, ' Lite').replace(/-latest/, '').replace(/-preview/, ' (vista previa)');
}
export { prettyModel };

function reviewItem(it, gi, ii) {
  const m = store.itemMacros(it);
  const [bl, bc] = BASIS[it.basis] || ['', ''];
  const flags = (it.flags || []).map((f) => {
    let fix = '';
    if (f.type === 'porcion' && f.grams) fix = `<button data-r="fix-g" data-g="${gi}" data-i="${ii}" data-v="${f.grams}">Usar ${fmt(f.grams)} g</button>`;
    if (f.type === 'valores' && f.foodId) fix = `<button data-r="fix-lib" data-g="${gi}" data-i="${ii}" data-food="${f.foodId}">Usar biblioteca</button>`;
    return `<div class="flag">${icon('alert', 14)}<span>${esc(f.msg)}${fix}</span></div>`;
  }).join('') + AI.fitWarnings(it).map((w) => `<div class="flag">${icon('info', 14)}<span>${esc(w)}</span></div>`).join('');
  return `<div class="rv-item" role="button" tabindex="0" data-r="item" data-g="${gi}" data-i="${ii}">
    <span class="conf ${it.confidence || 'media'}" title="Confianza ${esc(it.confidence || 'media')}"></span>
    <span class="item-main">
      <span class="item-name">${esc(it.name)}</span>
      <span class="item-sub"><span>${esc(portionText(it))}</span>${bl ? `<span class="badge ${bc}">${bl}</span>` : ''}${it.fraction ? `<span class="badge">${fmt(it.fraction * 100, 0)}% de la receta</span>` : ''}${it.ingredients ? `<span class="badge">${it.ingredients.length} ingredientes</span>` : ''}</span>
      ${it.note ? `<div class="note">${esc(it.note)}</div>` : ''}
      ${it.refLabel && it.basis === 'referencia' && norm(it.refLabel) !== norm(it.name) ? `<div class="note">Igual que: ${esc(it.refLabel)}</div>` : ''}
      ${flags}
    </span>
    <span class="item-kcal">${fmt(m.kcal)}<small>P ${fmt(m.p, 1)}</small></span>
  </div>`;
}

function mergeGroups(draft) {
  const out = [];
  for (const g of draft.groups) {
    const ex = out.find((x) => x.date === g.date && x.moment === g.moment);
    if (ex) ex.items.push(...g.items); else out.push(g);
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || store.momentIndex(a.moment) - store.momentIndex(b.moment));
  draft.groups = out;
}

function dictateInto(st, ta, btn) {
  if (st.dict) { st.dict.stop(); st.dict = null; btn.innerHTML = icon('mic'); return; }
  if (!canDictate()) { toast('Este navegador no permite dictar.'); return; }
  const base = ta.value ? ta.value + ' ' : '';
  btn.innerHTML = icon('stop');
  st.dict = startDictation({
    onText: (fin, interim) => { ta.value = (base + fin + (interim ? ' ' + interim : '')).trim(); },
    onState: (s2) => { if (s2 !== 'escuchando') { st.dict = null; btn.innerHTML = icon('mic'); } },
  });
}

async function runCorrection(st, draft) {
  const ta = st.sheet.body.querySelector('#rv-corr');
  const corr = (ta?.value || '').trim();
  if (!corr) { ta?.focus(); return; }
  stopVoice(st);
  if (!draft.raw) {
    // borrador hecho sin IA: se vuelve a analizar todo con la corrección
    st.text = `${st.text}\n${corr}`;
    return runAnalysis(st, { forceAI: true });
  }
  st.busy = true;
  const btn = st.sheet.body.querySelector('[data-r="corr"]');
  setBusy(btn, true);
  try {
    const nd = await AI.analyze({ text: st.text, previous: draft.raw, correction: corr, baseDate: st.date, baseMoment: st.moment, image: st.image, audio: st.audio });
    st.busy = false;
    store.logCorrection({ text: corr });
    showReview(st, nd);
    toast('Corrección aplicada');
  } catch (err) {
    st.busy = false;
    setBusy(btn, false);
    toast(err.message || 'No se pudo aplicar la corrección.', { kind: 'error', ms: 5000 });
  }
}

function saveDraft(st, draft, { background = false } = {}) {
  const S = store.S();
  try { CM.contribute(draft); } catch (e) { console.warn('aportes', e); }
  const snap = JSON.stringify({ entries: S.entries, days: S.days, body: S.body, usage: S.usage });
  let n = 0;
  for (const g of draft.groups) {
    if (!g.items.length) continue;
    store.addItems(g.date, g.moment, g.items, { source: draft.meta?.engine || 'ia', input: draft.meta?.input || '' });
    n += g.items.length;
  }
  for (const w of draft.water) { if (w.mode === 'fijar') store.setWater(w.date, w.ml); else store.addWater(w.date, w.ml); }
  for (const h of draft.habits) {
    let id = h.id;
    if (!id && h.name) {
      const nh = { id: uid('h'), name: cap(h.name), kind: 'supp', aliases: [norm(h.name)] };
      S.settings.habits.push(nh); id = nh.id;
    }
    if (id) store.setHabit(h.date, id, h.done);
  }
  for (const g of draft.gym) store.setGym(g.date, g.status, g.detail || '');
  for (const w of draft.weight) store.upsertBody(w.date, { weight: w.kg });
  for (const x of draft.study || []) store.setStudy(x.date, (store.day(x.date).study || 0) + x.hours);
  for (const a of draft.activity || []) EN.addActivity(a.date, a);
  for (const x of draft.sleep || []) saveNightFromText(x);
  for (const g of draft.groups) for (const it of g.items) if (it._saveLib) saveItemAsFood(it);
  store.commit('save');
  const tot = AI.draftTotals(draft);
  const dates = [...new Set(draft.groups.map((g) => g.date))];
  st.sheet.close();
  if (background) {
    const flagged = draft.groups.reduce((a, g) => a + g.items.filter((it) => it.flags?.length).length, 0) + draft.questions.length;
    toast(`Listo: ${n ? `${n} ${n === 1 ? 'alimento' : 'alimentos'} · ${fmt(tot.kcal)} kcal guardados` : 'registro guardado'}${flagged ? ' (hay valores estimados: revisalos)' : ''}`, {
      action: 'Ver', ms: 8000,
      onAction: () => { closeAllSheets(); ui.tab = 'hoy'; setDate(dates[0] || todayISO()); },
    });
    return;
  }
  if (dates.length === 1) ui.date = dates[0];
  else if (dates.includes(todayISO())) ui.date = todayISO();
  if (ui.tab !== 'hoy') ui.tab = 'hoy';
  render();
  toast(n ? `Guardado: ${n} ${n === 1 ? 'alimento' : 'alimentos'} · ${fmt(tot.kcal)} kcal` : 'Guardado', {
    action: 'Deshacer', ms: 6000,
    onAction: () => { const o = JSON.parse(snap); Object.assign(S, o); store.commit('undo'); toast('Registro deshecho'); },
  });
}

// ---------------------------------------------------------------------------
// Editor de un alimento (borrador, guardado o nuevo)
// ---------------------------------------------------------------------------
function foodTemplate(f) {
  return { name: f.n, foodId: f.id, per100: per100Of(f), units: foodUnits(f), liq: !!f.liq, d: f.d, basis: f.builtin ? 'tabla' : 'referencia' };
}
function newItemFrom(tpl) {
  let qty = 1; let unit = 'porcion'; let grams = null;
  if (tpl.perUnit) {
    unit = tpl.perUnit.unit; qty = 1;
    const k = 1;
    return { id: uid('i'), name: tpl.name, qty, unit, grams: null, liq: !!tpl.liq, per100: null, fixed: { kcal: tpl.perUnit.kcal * k, p: tpl.perUnit.p * k, c: tpl.perUnit.c * k, f: tpl.perUnit.f * k, s: tpl.perUnit.s || 0, fb: tpl.perUnit.fb || 0 }, _perUnit: tpl.perUnit, basis: tpl.basis || 'referencia', confidence: 'alta', note: '' };
  }
  const units = tpl.units || {};
  if (tpl.d && tpl.d[0] && (units[tpl.d[0]] || tpl.d[0] === 'g' || tpl.d[0] === 'ml')) { unit = tpl.d[0]; qty = tpl.d[1] || 1; }
  else if (Object.keys(units).length) { unit = Object.keys(units)[0]; qty = 1; }
  else { unit = tpl.liq ? 'ml' : 'g'; qty = 100; }
  grams = unit === 'g' || unit === 'ml' ? qty : (units[unit] || GENERIC_UNIT_G[unit] || 100) * qty;
  return { id: uid('i'), name: tpl.name, foodId: tpl.foodId || null, qty, unit, grams: round1(grams), liq: !!tpl.liq, per100: { ...tpl.per100 }, basis: tpl.basis || 'tabla', confidence: 'alta', note: '', _units: units };
}

function editSavedItem(f) {
  openItemEditor(f.item, {
    mode: 'saved', title: store.momentName(f.entry.moment),
    onSave: (upd) => { f.entry.items[f.index] = store.cleanItem(upd); f.entry.updatedAt = Date.now(); store.commit('edit'); },
    onDelete: () => {
      const snap = deepClone(f.item); const entryId = f.entry.id; const date = f.entry.date; const moment = f.entry.moment;
      store.removeItem(f.item.id); store.commit('del');
      toast('Alimento eliminado', { action: 'Deshacer', onAction: () => { store.addItems(date, moment, [snap]); store.commit('undo'); } });
      void entryId;
    },
    onMove: async () => {
      const d = await pickDate({ title: 'Mover a…', value: f.entry.date, marks: dayMarks });
      if (!d) return;
      const m = await pickMoment(f.entry.moment, 'Mover a la comida…');
      if (!m) return;
      store.moveItem(f.item.id, d, m); store.commit('move');
      toast(`Movido a ${relativeDayLabel(d).toLowerCase()} · ${store.momentName(m)}`);
    },
  });
}

function unitsFor(it) {
  const f = it.foodId ? getFood(it.foodId) : null;
  const own = { ...(f ? foodUnits(f) : {}), ...(it._units || {}) };
  if (it.grams && it.qty && it.unit && it.unit !== 'g' && it.unit !== 'ml' && !own[it.unit]) own[it.unit] = round1(it.grams / it.qty);
  return own;
}

export function openItemEditor(item0, { mode = 'draft', title = 'Alimento', onSave, onDelete, onMove, saveToLibrary = false } = {}) {
  const it = deepClone(item0);
  if (item0._units) it._units = item0._units;
  if (item0._perUnit) it._perUnit = item0._perUnit;
  const orig = { name: it.name, grams: it.grams, qty: it.qty, unit: it.unit, foodId: it.foodId };
  let saveLib = saveToLibrary || !!it._saveLib;
  const s = openSheet({ title, body: '<div class="ed"></div>', footer: '' });
  const fixedMode = () => !it.per100;
  const draw = () => {
    const m = store.itemMacros(it);
    const units = unitsFor(it);
    const unitList = [...new Set([...(Object.keys(units)), it.unit, it.liq ? 'ml' : 'g'].filter(Boolean))];
    const p = it.per100 || {};
    const fx = it.fixed || {};
    s.setBody(`
      <label class="field"><span>Nombre</span><input class="input" data-f="name" value="${esc(it.name)}"></label>
      <div class="row" style="margin-top:8px"><button class="chip" data-e="lib">${icon('search', 16)} Elegir de mi biblioteca</button>${it.foodId ? '<span class="muted" style="font-size:13px">Vinculado a la biblioteca</span>' : ''}</div>
      <div class="sub-h">Cantidad</div>
      <div class="qty-row">
        <button class="step-btn" data-e="qminus" aria-label="Menos" style="width:48px;height:48px">${icon('minus')}</button>
        <input class="input" data-f="qty" inputmode="decimal" value="${String(round1(it.qty)).replace('.', ',')}" aria-label="Cantidad">
        <button class="step-btn" data-e="qplus" aria-label="Más" style="width:48px;height:48px">${icon('plus')}</button>
      </div>
      <div class="chip-row unit-chips">${unitList.map((u) => `<button class="chip ${u === it.unit ? 'on' : ''}" data-e="unit" data-u="${u}">${esc(unitLabel(u, 2))}${units[u] ? ` <small>${fmt(units[u])} ${it.liq ? 'ml' : 'g'}</small>` : ''}</button>`).join('')}<button class="chip soft" data-e="unit-more">Otra…</button></div>
      ${!fixedMode() ? `<label class="field" style="margin-top:12px"><span>Peso total ${it.unit !== 'g' && it.unit !== 'ml' ? '(ajustalo si tu porción es distinta)' : ''}</span><div class="input-wrap"><input class="input" data-f="grams" inputmode="decimal" value="${it.grams == null ? '' : String(round1(it.grams)).replace('.', ',')}"><em>${it.liq ? 'ml' : 'g'}</em></div></label>` : ''}
      <div class="ed-total" aria-live="polite"><div><b>${fmt(m.kcal)}</b><small>kcal</small></div><div><b>${fmt(m.p, 1)}</b><small>prot.</small></div><div><b>${fmt(m.c, 1)}</b><small>carb.</small></div><div><b>${fmt(m.f, 1)}</b><small>grasa</small></div></div>
      <div class="sub-h">${fixedMode() ? 'Valores de esta porción' : `Valores cada 100 ${it.liq ? 'ml' : 'g'}`}</div>
      <div class="ed-macro">
        ${(fixedMode() ? [['kcal', 'kcal', fx.kcal], ['p', 'Proteína', fx.p], ['c', 'Carbos', fx.c], ['f', 'Grasas', fx.f], ['s', 'Azúcares', fx.s], ['fb', 'Fibra', fx.fb]] : [['kcal', 'kcal', p.kcal], ['p', 'Proteína', p.p], ['c', 'Carbos', p.c], ['f', 'Grasas', p.f], ['s', 'Azúcares', p.s], ['fb', 'Fibra', p.fb]])
        .map(([k, l, v]) => `<label class="field"><span>${l}</span><input class="input" data-m="${k}" inputmode="decimal" value="${v == null ? '' : String(round1(v)).replace('.', ',')}"></label>`).join('')}
      </div>
      ${it.ingredients?.length ? `<div class="sub-h">Ingredientes${it.fraction ? ` (comiste ${fmt(it.fraction * 100, 0)}% de la receta)` : ''}</div>${it.ingredients.map((g) => `<div class="ing"><span>${esc(g.name)}</span><span class="muted">${fmt(g.grams)} g · ${fmt(calc(g.per100 || {}, g.grams).kcal)} kcal</span></div>`).join('')}` : ''}
      ${it.note ? `<div class="note" style="margin-top:12px">${esc(it.note)}</div>` : ''}
      ${it.sourceText ? `<div class="note">Fuente: ${esc(it.sourceText)}</div>` : ''}
      ${it.sources?.length ? `<div class="sources">${it.sources.map((x) => `<a href="${esc(x.u)}" target="_blank" rel="noopener">${icon('link', 14)}${esc(x.t)}</a>`).join('')}</div>` : ''}
      <button class="set-row-btn" data-e="lib-toggle" style="padding-left:0;padding-right:0;border-top:1px solid var(--line);margin-top:14px">${icon('library', 20)}<span class="grow">Guardar en Mis alimentos<small>Para usar estos valores la próxima vez</small></span><span class="switch ${saveLib ? 'on' : ''}"></span></button>
      ${mode === 'saved' && onMove ? `<button class="set-row-btn" data-e="move" style="padding-left:0;padding-right:0">${icon('move', 20)}<span class="grow">Mover a otra comida o día</span>${icon('right', 18)}</button>` : ''}
    `);
    s.setFooter(`${onDelete ? `<button class="btn ghost" data-e="del" aria-label="Eliminar">${icon('trash', 20)}</button>` : ''}<button class="btn primary" data-e="save">${icon('check', 20)} ${mode === 'new' ? 'Agregar' : 'Guardar'}</button>`);
  };
  const recalcGramsFromUnit = () => {
    if (fixedMode()) {
      if (it._perUnit) { const k = it.qty; it.fixed = { kcal: it._perUnit.kcal * k, p: it._perUnit.p * k, c: it._perUnit.c * k, f: it._perUnit.f * k, s: (it._perUnit.s || 0) * k, fb: (it._perUnit.fb || 0) * k }; }
      return;
    }
    if (it.unit === 'g' || it.unit === 'ml') { it.grams = it.qty; return; }
    const units = unitsFor(it);
    const f = it.foodId ? getFood(it.foodId) : null;
    const per = units[it.unit] ?? (f ? gramsFor(f, 1, it.unit) : (GENERIC_UNIT_G[it.unit] || null));
    if (per != null) it.grams = round1(per * it.qty);
  };
  const updateTotals = () => {
    const m = store.itemMacros(it);
    const box = s.body.querySelector('.ed-total');
    if (box) box.innerHTML = `<div><b>${fmt(m.kcal)}</b><small>kcal</small></div><div><b>${fmt(m.p, 1)}</b><small>prot.</small></div><div><b>${fmt(m.c, 1)}</b><small>carb.</small></div><div><b>${fmt(m.f, 1)}</b><small>grasa</small></div>`;
  };
  draw();
  s.body.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.f === 'name') it.name = el.value;
    else if (el.dataset.f === 'qty') {
      const q = parseNum(el.value);
      if (q >= 0) {
        if (fixedMode() && !it._perUnit && it.qty > 0 && it.fixed) { const k = q / it.qty; for (const kk of Object.keys(it.fixed)) it.fixed[kk] = (it.fixed[kk] || 0) * k; }
        it.qty = q; recalcGramsFromUnit();
        const gi = s.body.querySelector('[data-f="grams"]'); if (gi) gi.value = it.grams == null ? '' : String(round1(it.grams)).replace('.', ',');
      }
    } else if (el.dataset.f === 'grams') { const g = parseNum(el.value); if (g >= 0) { it.grams = g; it._gramsEdited = true; } }
    else if (el.dataset.m) {
      const v = parseNum(el.value);
      const target = fixedMode() ? (it.fixed = it.fixed || {}) : (it.per100 = it.per100 || {});
      target[el.dataset.m] = Number.isFinite(v) ? v : 0;
      it._valuesEdited = true;
      if (fixedMode()) delete it._perUnit;
    }
    updateTotals();
  });
  const onClick = async (e) => {
    const b = e.target.closest('[data-e]');
    if (!b) return;
    const k = b.dataset.e;
    if (k === 'qminus' || k === 'qplus') {
      const step = it.unit === 'g' || it.unit === 'ml' ? (it.qty >= 100 ? 10 : 5) : (it.qty < 1 || (k === 'qminus' && it.qty <= 1) ? 0.25 : 1);
      const q = Math.max(0, round1(it.qty + (k === 'qplus' ? step : -step)));
      if (fixedMode() && !it._perUnit && it.qty > 0 && it.fixed) { const kk = q / it.qty; for (const x of Object.keys(it.fixed)) it.fixed[x] = (it.fixed[x] || 0) * kk; }
      it.qty = q; recalcGramsFromUnit(); draw();
    } else if (k === 'unit') {
      if (fixedMode()) { it.unit = b.dataset.u; draw(); return; }
      const nu = b.dataset.u;
      const curG = it.grams;
      it.unit = nu;
      if (nu === 'g' || nu === 'ml') it.qty = round1(curG || 100);
      else { const per = unitsFor(it)[nu] || (it.foodId ? gramsFor(getFood(it.foodId), 1, nu) : GENERIC_UNIT_G[nu]) || 100; it.qty = curG ? round1(curG / per) || 1 : 1; }
      recalcGramsFromUnit(); draw();
    } else if (k === 'unit-more') {
      const u = await pickOption({ title: 'Unidad', value: it.unit, options: UNITS.filter((x) => !['chica', 'grande'].includes(x)).map((x) => ({ value: x, label: unitLabel(x, 2), sub: x === 'g' || x === 'ml' ? '' : `≈ ${GENERIC_UNIT_G[x] || '?'} g por defecto` })) });
      if (u) { const curG = it.grams; it.unit = u; if (u === 'g' || u === 'ml') it.qty = round1(curG || 100); else { it.qty = 1; recalcGramsFromUnit(); } draw(); }
    } else if (k === 'lib') {
      openFoodSearch({
        pickOnly: true,
        onPick: (tpl) => {
          const n = newItemFrom(tpl);
          const keepG = it.grams;
          Object.assign(it, { name: n.name, foodId: n.foodId || null, per100: n.per100, fixed: n.fixed || null, liq: n.liq, basis: n.basis, _units: n._units, _perUnit: n._perUnit, flags: undefined });
          if (it.per100 && keepG) { it.grams = keepG; it.unit = it.liq ? 'ml' : 'g'; it.qty = keepG; } else { it.qty = n.qty; it.unit = n.unit; it.grams = n.grams; }
          it._replaced = true;
          draw();
        },
      });
    } else if (k === 'lib-toggle') { saveLib = !saveLib; b.querySelector('.switch').classList.toggle('on', saveLib); }
    else if (k === 'move') { s.close(); onMove && onMove(); }
    else if (k === 'del') { s.close(); onDelete && onDelete(); }
    else if (k === 'save') {
      if (!it.name.trim()) { toast('Poné un nombre'); return; }
      // aprendizaje: medidas propias y equivalencias
      if (it.foodId && it._gramsEdited && it.unit !== 'g' && it.unit !== 'ml' && it.qty > 0 && it.grams > 0) store.learnUnit(it.foodId, it.unit, it.grams / it.qty);
      if (it._replaced && it.foodId && norm(orig.name) !== norm(it.name)) store.learnAlias(orig.name, it.foodId);
      if (it._gramsEdited || it._valuesEdited || it._replaced) store.logCorrection({ from: orig, to: { name: it.name, grams: it.grams, qty: it.qty, unit: it.unit, foodId: it.foodId } });
      if (it.per100) { const { per100 } = sanitizePer100(it.per100); it.per100 = per100; }
      if (it._valuesEdited || it._gramsEdited || it._replaced) { it.confidence = 'alta'; it.flags = undefined; }
      it._saveLib = saveLib;
      const out = { ...it };
      for (const x of ['_gramsEdited', '_valuesEdited', '_replaced']) delete out[x];
      s.close();
      if (mode !== 'draft' && saveLib) saveItemAsFood(out);
      onSave && onSave(out, { saveToLibrary: false });
    }
  };
  s.body.addEventListener('click', onClick);
  s.foot.addEventListener('click', onClick); // Guardar y Eliminar están en el pie de la hoja
  return s;
}

/** Guarda un alimento como "Mis alimentos" (valores por 100 g + su medida) */
export function saveItemAsFood(it) {
  const m = store.itemMacros(it);
  let per100 = it.per100;
  if (!per100 && it.grams > 0) per100 = { kcal: m.kcal / it.grams * 100, p: m.p / it.grams * 100, c: m.c / it.grams * 100, f: m.f / it.grams * 100, s: m.s / it.grams * 100, fb: m.fb / it.grams * 100 };
  const u = {};
  if (it.unit && it.unit !== 'g' && it.unit !== 'ml' && it.grams && it.qty) u[it.unit] = round1(it.grams / it.qty);
  if (!per100) {
    // sin peso: se guarda como porción fija de 100 "g" equivalentes
    const q = it.qty || 1;
    per100 = { kcal: m.kcal / q, p: m.p / q, c: m.c / q, f: m.f / q, s: m.s / q, fb: m.fb / q };
    u[it.unit || 'porcion'] = 100;
  }
  const existing = store.S().customFoods.find((f) => norm(f.n) === norm(it.name));
  const f = store.saveCustomFood({ id: existing?.id, n: it.name.trim(), a: [], k: per100.kcal, p: per100.p, c: per100.c, f: per100.f, s: per100.s || 0, fb: per100.fb || 0, u: { ...(existing?.u || {}), ...u }, liq: !!it.liq, src: it.basis || 'manual' });
  return f;
}

// ---------------------------------------------------------------------------
// Buscar en la biblioteca (alimentos propios, historial y base incluida)
// ---------------------------------------------------------------------------
export function openFoodSearch({ date = ui.date, moment = null, onAdded = null, onPick = null, pickOnly = false } = {}) {
  const s = openSheet({
    title: 'Buscar alimento', full: true,
    body: `<div class="input-wrap"><input class="input" id="fs-q" placeholder="Ej.: yogur, milanesa, avena…" autocomplete="off" enterkeyhint="search"></div>
      <div class="search-results" id="fs-r"></div>`,
  });
  const q = s.body.querySelector('#fs-q');
  const box = s.body.querySelector('#fs-r');
  const hist = store.historyFoods({ limit: 80 });
  const draw = () => {
    const term = q.value.trim();
    const rows = [];
    if (!term) {
      rows.push('<div class="quick-title">Tus frecuentes</div>');
      hist.slice(0, 15).forEach((h) => rows.push(optRow('h:' + h.key, h.name, h.per100 ? `${fmt(h.per100.kcal)} kcal/100 ${h.liq ? 'ml' : 'g'}` : `${fmt(h.perUnit.kcal)} kcal por ${unitLabel(h.perUnit.unit)}`)));
      if (!hist.length) rows.push('<p class="muted">Escribí para buscar en más de 180 alimentos argentinos.</p>');
    } else {
      const nt = norm(term);
      hist.filter((h) => h.key.includes(nt)).slice(0, 6).forEach((h) => rows.push(optRow('h:' + h.key, h.name, 'De tu historial')));
      searchFoods(term, { limit: 18, usage: store.S().usage }).forEach(({ food }) => rows.push(optRow('f:' + food.id, food.n, `${fmt(food.k)} kcal/100 ${food.liq ? 'ml' : 'g'}${food.builtin ? '' : food.community ? ' · Comunidad' : ' · Mis alimentos'}`)));
      rows.push(`<button class="opt" data-k="new"><span class="opt-main">${icon('plus', 20)}<span>Crear "${esc(term)}"<small>Cargá los valores de la etiqueta</small></span></span></button>`);
    }
    box.innerHTML = rows.join('');
  };
  const optRow = (k, name, sub) => `<button class="opt" data-k="${esc(k)}"><span class="opt-main"><span>${esc(name)}<small>${esc(sub)}</small></span></span>${icon('right', 18)}</button>`;
  q.addEventListener('input', debounce(draw, 120));
  setTimeout(() => q.focus(), 300);
  draw();
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    const k = b.dataset.k;
    let tpl = null;
    if (k.startsWith('f:')) { const f = getFood(k.slice(2)); if (f) tpl = foodTemplate(f); }
    else if (k.startsWith('h:')) { const h = hist.find((x) => 'h:' + x.key === k); if (h) tpl = { name: h.name, per100: h.per100, perUnit: h.perUnit, units: h.units, liq: h.liq, basis: 'referencia' }; }
    else if (k === 'new') tpl = { name: cap(q.value.trim()), per100: { kcal: 0, p: 0, c: 0, f: 0, s: 0, fb: 0 }, units: {}, liq: false, basis: 'etiqueta' };
    if (!tpl) return;
    if (pickOnly && onPick) { s.close(); onPick(tpl); return; }
    const item = newItemFrom(tpl);
    openItemEditor(item, {
      mode: 'new', title: moment ? store.momentName(moment) : 'Agregar', saveToLibrary: k === 'new',
      onSave: async (it, opts) => {
        let m = moment;
        if (!m) m = await pickMoment(store.momentForTime());
        if (!m) return;
        addSingle(date, m, it, opts);
        s.close();
        onAdded && onAdded();
      },
    });
  });
  return s;
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
function applyTheme() {
  const t = store.S().settings.ui.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('apextrack_theme', JSON.stringify(t)); } catch { /* opcional */ }
  const dark = t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  // las barras del sistema (arriba y, en Android, la de los botones) toman este color
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    const forMedia = (m.getAttribute('media') || '').includes('dark');
    m.setAttribute('content', t === 'light' || t === 'dark' ? (dark ? '#111512' : '#EEF1EC') : (forMedia ? '#111512' : '#EEF1EC'));
  });
  applyTextSize();
}
/** Tamaño del texto (Ajustes → Personalizar). 1 = el tamaño original de la app. */
export const TEXT_SIZES = { 0.88: 'Chico', 0.94: 'Un poco más chico', 1: 'Normal', 1.08: 'Grande', 1.16: 'Más grande', 1.25: 'Muy grande' };
// Se usa la escala de la ventana (como el zoom del navegador): todo crece parejo y nada se corta.
export function viewportFor(z) {
  return `width=${Math.round((screen.width || 400) / z)}, initial-scale=${z}, minimum-scale=${z}, maximum-scale=${z}, viewport-fit=cover, interactive-widget=resizes-content`;
}
function applyTextSize() {
  const z = Number(store.S().settings.ui.textScale) || 1;
  const meta = document.querySelector('meta[name="viewport"]');
  if (meta) meta.setAttribute('content', z === 1 ? 'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content' : viewportFor(z));
  try { localStorage.setItem('apextrack_zoom', String(z)); } catch { /* opcional */ }
}
export { applyTheme };

function checkDayRollover() {
  const t = todayISO();
  if (t !== ui.lastToday) {
    if (ui.date === ui.lastToday) ui.date = t;
    ui.lastToday = t;
    if (!sheetsOpen()) render();
  }
}

async function boot() {
  await store.loadState();
  applyTheme();
  document.querySelector('.tab[data-tab="gym"]')?.setAttribute('data-slot', '1');
  store.onChange(() => { if (ui.tab) render(); });
  history.replaceState({ tab: 'hoy' }, '');
  render();
  document.getElementById('slot-more')?.addEventListener('click', (e) => { e.stopPropagation(); slotMenu(true); });
  document.getElementById('tab-rec').addEventListener('click', () => openLogger({ date: ui.tab === 'hoy' ? ui.date : todayISO() }));
  document.querySelectorAll('.tab[data-tab]').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
  window.addEventListener('online', () => { ui.online = true; render(); if (store.S().pending.length) toast(`Volvió la conexión: ${store.S().pending.length} registro(s) para analizar`, { action: 'Analizar', onAction: runPending, ms: 6000 }); });
  window.addEventListener('offline', () => { ui.online = false; render(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') store.flush(); else { checkDayRollover(); store.dailySnapshot(); } });
  window.addEventListener('pagehide', () => store.flush());
  setInterval(() => { checkDayRollover(); gymTimerTick(); if (ui.tab === 'ayuno') fastingTick(); if (ui.tab === 'sueno') sleepTick(); }, 1000);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
  // accesos directos del ícono, notificaciones y capturas compartidas
  const p = new URLSearchParams(location.search);
  if (p.get('accion')) { setTimeout(() => handleAction(p), 200); history.replaceState({ tab: 'hoy' }, '', location.pathname); }
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'abrir' && e.data.url) { const u = new URL(e.data.url); if (u.searchParams.get('accion')) handleAction(u.searchParams); }
  });
  if (store.state.recovered) toast(`Recuperé tus datos desde la copia guardada en ${store.state.recovered}`, { ms: 6000 });
  scheduleCloud();
  CM.startCommunity();
  startReminders();
  startIdeas();
  try { if (maybeAutoWeekly()) render(); } catch (e) { console.warn('resumen semanal', e); }
  maybeBackupReminder();
  maybeOnboard();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js', { type: 'module' }).then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('Hay una versión nueva de ApexTrack', { action: 'Actualizar', ms: 15000, onAction: () => { nw.postMessage('skipWaiting'); } });
          }
        });
      });
    }).catch(() => { /* sin service worker */ });
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
  }
  window.__apex = { store, AI, CM, EN, ui, render, openLogger, cloudPush };
}

/** Acciones que llegan por la dirección (?accion=…): accesos del ícono, notificaciones y compartir. */
async function handleAction(p) {
  const a = p.get('accion');
  const today = todayISO();
  closeAllSheets();
  if (a === 'registrar') openLogger({ date: today, moment: p.get('momento') || null, autoMic: p.get('voz') === '1' });
  else if (a === 'agua') { const ml = store.S().settings.ui.glassMl || 250; store.addWater(today, ml); store.commit('water'); toast(`+1 vaso de agua (${ml} ml)`, { action: 'Deshacer', onAction: () => { store.addWater(today, -ml); store.commit('water'); } }); }
  else if (a === 'habito') {
    const id = p.get('id'); const h = store.habitsList().find((x) => x.id === id);
    if (h && p.get('hecho') === '1') { if (!store.day(today).habits?.[id]) store.toggleHabit(today, id); store.commit('habit'); toast(`${h.name}: hecho`); }
    ui.tab = 'hoy'; setDate(today);
  } else if (a === 'peso') { ui.tab = 'hoy'; setDate(today); actions.weight(); }
  else if (a === 'gym' || a === 'estudio') { ui.tab = a === 'gym' ? 'hoy' : 'estudio'; setDate(today); }
  else if (a === 'ayuno') go('ayuno');
  else if (a === 'sueno') go('sueno');
  else if (a === 'ideas') openIdeas();
  else if (a === 'resumen') { const r = pendingWeekly(); if (r) openWeekly(r); else askWeekly('pasada'); }
  else if (a === 'compartir') {
    try {
      const c = await caches.open('apextrack-compartido');
      const txt = await (await c.match('./__compartido_texto'))?.text() || '';
      const imgRes = await c.match('./__compartido_imagen');
      let image = null;
      if (imgRes) image = await shrink(await imgRes.blob());
      await c.delete('./__compartido_texto'); await c.delete('./__compartido_imagen');
      openLogger({ date: today, image, text: txt.trim() || (image ? 'Captura compartida' : '') });
    } catch { openLogger({ date: today }); }
  }
}

boot();
