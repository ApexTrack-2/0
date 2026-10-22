// ApexTrack — pestaña personalizable Actividad: pasos (también calculados desde la distancia y la altura),
// reloj inteligente por captura, actividades y gasto del día.
import { todayISO, addDays, weekStart, dateRange, fmt, round0, esc, vibrate, parseNum } from './util.js';
import * as store from './store.js';
import * as EN from './energy.js';
import { icon } from './icons.js';
import { weekBars } from './charts.js';
import { toast, promptText, confirmDialog } from './ui.js';

// ---------------------------------------------------------------------------
// ACTIVIDAD
// ---------------------------------------------------------------------------
const stepsOn = (d) => (store.day(d).activity || []).reduce((x, a) => x + EN.stepsOf(a), 0);
const stepsGoal = () => store.S().settings.goals.steps || 8000;

export function renderActividad() {
  const today = todayISO();
  const en = EN.dayEnergy(today);
  const steps = stepsOn(today);
  const watch = (store.day(today).activity || []).find((a) => a.source === 'reloj');
  const ws = weekStart(today);
  const days = dateRange(ws, addDays(ws, 6));
  const chart = weekBars({ days: days.map((d) => ({ date: d, value: d > today ? 0 : EN.dayEnergy(d).act })), sel: today, unit: 'kcal', today, height: 160 });
  const stepsChart = weekBars({ days: days.map((d) => ({ date: d, value: stepsOn(d) })), goal: stepsGoal(), sel: today, unit: 'pasos', today, height: 150 });
  const est = (store.day(today).activity || []).some(EN.stepsEstimated);
  const pct = Math.min(100, Math.round((steps / stepsGoal()) * 100));
  const list = en.items.map((a) => `<div class="kv"><span>${icon(a.source === 'reloj' ? 'watch' : 'walk', 18)}${esc(EN.describeAct(a))}</span><span style="display:flex;gap:8px;align-items:center"><b>${fmt(a.kcal)} kcal</b><button class="icon-btn" style="width:36px;height:36px" data-act="act-del" data-id="${esc(a.id)}" aria-label="Borrar">${icon('trash', 18)}</button></span></div>`).join('');
  return `<h1 class="view-title">Actividad</h1>
    <section class="hero" aria-label="Gasto del día">
      <div class="hero-row">
        <div><div class="hero-num">${fmt(en.total)}</div><div class="hero-goal">kcal gastadas hoy (estimado)</div></div>
        <div class="hero-left ${en.balance > 0 && EN.isCut() ? 'over' : ''}"><b>${en.balance > 0 ? '+' : '−'}${fmt(Math.abs(en.balance))}</b><span>balance (comido ${fmt(en.eaten)})</span></div>
      </div>
      <div class="stack-legend" style="margin-top:10px"><span>Basal y vida diaria <b>${fmt(en.base)}</b></span><span>Actividad <b>${fmt(en.act - en.gym)}</b></span><span>Gimnasio <b>${fmt(en.gym)}</b></span><span>Digestión <b>${fmt(en.tef)}</b></span></div>
    </section>
    <section class="panel">
      <div class="kv"><span>${icon('walk', 18)}Pasos de hoy${est ? ' <small class="muted">(incluye calculados por distancia)</small>' : ''}</span><button class="weight-btn" data-act="steps-set">${steps ? fmt(steps) : 'Cargar'}</button></div>
      <div class="meter" style="--c:var(--accent);margin:2px 0 6px"><i style="width:${pct}%"></i></div>
      <div class="kv"><span>${icon('star', 18)}Meta de pasos</span><button class="weight-btn" data-act="steps-goal">${fmt(stepsGoal())}</button></div>
      <div class="kv"><span>${icon('watch', 18)}Reloj o app de salud</span><button class="weight-btn" data-act="watch-shot">${watch ? `${fmt(EN.actKcal(watch, en.kg))} kcal` : 'Cargar captura'}</button></div>
      <p class="note" style="margin:8px 0 0">Si cargás una caminata o una corrida en kilómetros, los pasos se calculan solos con tu altura (paso de ≈ ${fmt(EN.stepLength('caminata') * 100)} cm caminando). También podés compartir a ApexTrack una captura de Samsung Health, Mi Fitness o Zepp (Compartir → ApexTrack) y la IA lee los pasos y las calorías del reloj.</p>
    </section>
    <div class="section-head"><h3>Pasos de la semana</h3></div>
    <section class="panel">${stepsChart}</section>
    <div class="section-head"><h3>Actividades de hoy</h3><button class="link" data-act="activity-add">Agregar</button></div>
    <section class="panel">${list || '<p class="muted" style="margin:0">Sin actividades. Contalas al registrar ("caminé 40 minutos") o tocá Agregar.</p>'}</section>
    <div class="section-head"><h3>Calorías de actividad · semana</h3></div>
    <section class="panel">${chart}</section>`;
}

async function setSteps() {
  const today = todayISO();
  const cur = stepsOn(today);
  const v = await promptText({ title: 'Pasos de hoy', label: 'Los que marca tu reloj o el teléfono', value: cur ? String(cur) : '', type: 'text', inputmode: 'numeric', suffix: 'pasos' });
  if (v == null) return;
  const n = Math.round(parseNum(v));
  if (!(n >= 0) || n > 100000) { toast('Poné un número de pasos válido', { kind: 'error' }); return; }
  const d = store.ensureDay(today);
  d.activity = (d.activity || []).filter((a) => !(a.source === 'pasos'));
  // los pasos de otras actividades ya cargadas se descuentan para no contarlos dos veces
  const other = (d.activity || []).reduce((x, a) => x + EN.stepsOf(a), 0);
  if (n > other) { const a = EN.addActivity(today, { type: 'caminata', steps: n - other, note: 'pasos del día' }); a.source = 'pasos'; }
  store.commit('pasos');
  toast(`Pasos de hoy: ${fmt(n)}`);
}

async function setStepsGoal() {
  const v = await promptText({ title: 'Meta de pasos por día', label: 'Lo recomendado es entre 7.000 y 10.000', value: String(stepsGoal()), inputmode: 'numeric', suffix: 'pasos' });
  if (v == null) return;
  const n = Math.round(parseNum(v));
  if (!(n >= 1000 && n <= 50000)) { toast('Poné una meta entre 1.000 y 50.000 pasos', { kind: 'error' }); return; }
  store.S().settings.goals.steps = n; store.commit('pasos');
  toast(`Meta de pasos: ${fmt(n)}`);
}

export const tabActions = {
  'steps-set': () => setSteps(),
  'steps-goal': () => setStepsGoal(),
  'act-del': async (el) => {
    if (!(await confirmDialog({ title: '¿Borrar esta actividad?', ok: 'Borrar', danger: true }))) return;
    EN.removeActivity(todayISO(), el.dataset.id); vibrate(10); store.commit('actividad');
  },
};
export { round0 };
