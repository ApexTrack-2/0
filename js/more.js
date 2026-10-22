// ApexTrack — Diario, Progreso, Gimnasio y Ajustes.
import {
  todayISO, addDays, addMonths, weekStart, monthStart, dateRange, fmt, fmtDayLong, fmtDayShort, fmtMonthYear, fmtDM, relativeDayLabel,
  esc, cap, round1, round0, parseNum, vibrate, deepClone, uid, norm, parseISO, MESES, daysBetween, slug,
} from './util.js';
import * as store from './store.js';
import * as AI from './ai.js';
import { unitLabel, canonUnit, UNITS } from './foods.js';
import { icon } from './icons.js';
import { openSheet, toast, confirmDialog, pickOption, pickDate, promptText, formSheet, setBusy, swipes, slideIn } from './ui.js';
import { weekBars, weightLine, simpleLine } from './charts.js';
import { ui, go, setDate, render, pickMoment, prettyModel, applyTheme, dayMarks, SLOT_TABS, TEXT_SIZES } from './app.js';
import { studyActions, studyTick } from './study.js';
import * as EN from './energy.js';
import { openGoals } from './profile.js';
import { insightsCard, openInsights, openInsight } from './insights.js';
import * as BK from './backup.js';
import * as CM from './community.js';
import { openReminders } from './notify.js';
import { askWeekly } from './weekly.js';
import * as OB from './onboarding.js';

const METRICS = {
  kcal: { label: 'Kcal', unit: 'kcal', dec: 0, goal: (g) => g.kcal, val: (d) => store.dayTotals(d).kcal },
  p: { label: 'Proteína', unit: 'g', dec: 0, goal: (g) => g.p, val: (d) => store.dayTotals(d).p },
  c: { label: 'Carbos', unit: 'g', dec: 0, goal: (g) => g.c, val: (d) => store.dayTotals(d).c },
  f: { label: 'Grasas', unit: 'g', dec: 0, goal: (g) => g.f, val: (d) => store.dayTotals(d).f },
  water: { label: 'Agua', unit: 'L', dec: 1, goal: (g) => (g.waterMl || 2500) / 1000, val: (d) => (store.day(d).water || 0) / 1000 },
};
const GYM_LABEL = { fui: 'Gimnasio', no_fui: 'No fue al gym', descanso: 'Descanso' };

// ===========================================================================
// DIARIO
// ===========================================================================
function dayCard(d) {
  const g = store.goals();
  const t = store.dayTotals(d);
  const rec = store.day(d);
  const pct = Math.min(100, g.kcal ? (t.kcal / g.kcal) * 100 : 0);
  const mk = dayMarks(d);
  const rel = relativeDayLabel(d);
  const title = ['Hoy', 'Ayer', 'Anteayer'].includes(rel) ? `${rel} · ${fmtDayShort(d)}` : cap(fmtDayShort(d));
  return `<button class="day-card" data-act="dia-open" data-date="${d}">
    <h4>${esc(title)}</h4>
    <span class="dc-k">${fmt(t.kcal)} <small>/ ${fmt(g.kcal)} kcal</small></span>
    <span class="dc-bar"><i style="width:${pct}%;${mk === 'meta' ? 'background:var(--good)' : ''}"></i></span>
    <span class="dc-sub"><span>P ${fmt(t.p)} g</span><span>C ${fmt(t.c)} g</span><span>G ${fmt(t.f)} g</span>${rec.water ? `<span>${icon('drop', 13)} ${fmt(rec.water / 1000, 1)} L</span>` : ''}${rec.gym ? `<span>${icon('dumbbell', 13)} ${GYM_LABEL[rec.gym]}</span>` : ''}${store.bodyOn(d)?.weight ? `<span>${icon('scale', 13)} ${fmt(store.bodyOn(d).weight, 1)} kg</span>` : ''}</span>
  </button>`;
}

/** ¿Entrenó o caminó ese día? (gimnasio / caminata, otra actividad o la meta de pasos) */
export function moveMarks(d) {
  const rec = store.day(d);
  const acts = rec.activity || [];
  const gym = rec.gym === 'fui' || acts.some((a) => a.type === 'pesas');
  const steps = acts.reduce((x, a) => x + (EN.stepsOf(a) || 0), 0);
  const walk = acts.some((a) => a.type && a.type !== 'pesas' && a.source !== 'pasos' && a.source !== 'reloj') || steps >= (store.S().settings.goals.steps || 8000);
  return { gym, walk };
}
const MOVE_LEGEND = '<div class="cal-legend mv-legend"><span><i class="mk gym"></i>gimnasio</span><span><i class="mk walk"></i>caminata o actividad</span></div>';

export function renderDiario() {
  const D = ui.diary;
  const today = todayISO();
  const g = store.goals();
  const M = METRICS[D.metric] || METRICS.kcal;
  const modeSeg = `<div class="seg-ctl" style="margin-bottom:14px">${[['semana', 'Semana'], ['mes', 'Mes']].map(([k, l]) => `<button class="${D.mode === k ? 'on' : ''}" data-act="dia-mode" data-v="${k}">${l}</button>`).join('')}</div>`;
  const metricChips = `<div class="chip-row metric" style="margin-bottom:10px">${Object.entries(METRICS).map(([k, m]) => `<button class="chip ${D.metric === k ? 'on' : ''}" data-act="dia-metric" data-v="${k}">${m.label}</button>`).join('')}</div>`;

  if (D.mode === 'mes') {
    const ms = monthStart(D.month || today);
    const me = addDays(addMonths(ms, 1), -1);
    const days = dateRange(ms, me > today ? today : me);
    const logged = days.filter((d) => store.entriesOn(d).length);
    const statL = store.statDays(days);
    const avgK = statL.length ? statL.reduce((a, d) => a + store.dayTotals(d).kcal, 0) / statL.length : 0;
    const avgP = statL.length ? statL.reduce((a, d) => a + store.dayTotals(d).p, 0) / statL.length : 0;
    const meta = logged.filter((d) => dayMarks(d) === 'meta').length;
    const gymN = days.filter((d) => store.day(d).gym === 'fui').length;
    const lead = (parseISO(ms).getDay() + 6) % 7;
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<span></span>');
    for (const d of dateRange(ms, me)) {
      const mk = dayMarks(d);
      const mv = d <= today ? moveMarks(d) : {};
      cells.push(`<button class="cal-d ${d === today ? 'tod' : ''} ${d === D.sel ? 'sel' : ''} ${mv.gym ? 'gym' : ''} ${mv.walk ? 'walk' : ''}" data-act="dia-open" data-date="${d}" ${d > today ? 'disabled' : ''}><span>${parseISO(d).getDate()}</span>${mk ? `<i class="dot ${mk}"></i>` : ''}${mv.walk ? '<i class="mk walk"></i>' : ''}</button>`);
    }
    return `<h1 class="view-title">Diario</h1>${modeSeg}
      <section class="panel">
        <div class="chart-nav">
          <button class="icon-btn" data-act="dia-month" data-d="-1" aria-label="Mes anterior">${icon('left')}</button>
          <strong>${cap(fmtMonthYear(ms))}</strong>
          <button class="icon-btn" data-act="dia-month" data-d="1" aria-label="Mes siguiente" ${addMonths(ms, 1) > today ? 'disabled' : ''}>${icon('right')}</button>
        </div>
        <div class="cal" data-swipe="diarymonth"><div class="cal-w">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((x) => `<span>${x}</span>`).join('')}</div><div class="cal-g">${cells.join('')}</div>
        <div class="cal-legend"><span><i class="dot meta"></i>en meta</span><span><i class="dot cerca"></i>cerca</span><span><i class="dot bajo"></i>bajo</span></div>${MOVE_LEGEND}</div>
      </section>
      <div class="stat-grid" style="margin-top:12px">
        <div class="stat"><small>Promedio kcal</small><b>${statL.length ? fmt(avgK) : '–'}</b><span>meta ${fmt(g.kcal)}</span></div>
        <div class="stat"><small>Promedio proteína</small><b>${statL.length ? fmt(avgP) + ' g' : '–'}</b><span>meta ${fmt(g.p)} g</span></div>
        <div class="stat"><small>Días en meta</small><b>${meta}<span style="font-size:15px"> / ${logged.length}</span></b><span>días con registro</span></div>
        <div class="stat"><small>Gimnasio</small><b>${gymN}</b><span>días este mes</span></div>
      </div>
      <section class="section"><div class="section-head"><h3>Días registrados</h3></div>
        ${logged.length ? logged.slice().reverse().map(dayCard).join('') : '<div class="empty"><strong>Sin registros este mes</strong>Los días que registres aparecen acá.</div>'}
      </section>`;
  }

  // Semana
  const ws = D.week || weekStart(today);
  const days = dateRange(ws, addDays(ws, 6));
  if (!days.includes(D.sel)) D.sel = days.includes(today) ? today : days.find((d) => store.entriesOn(d).length) || ws;
  const data = days.map((d) => ({ date: d, value: d > today ? 0 : M.val(d) }));
  const chart = weekBars({ days: data, goal: M.goal(g), sel: D.sel, unit: M.unit, dec: M.dec, today, marks: moveMarks });
  const selT = store.dayTotals(D.sel);
  const logged = store.statDays(days.filter((d) => d <= today)); // hoy no cuenta hasta que termine
  const avg = (k) => (logged.length ? logged.reduce((a, d) => a + store.dayTotals(d)[k], 0) / logged.length : 0);
  const avgW = days.filter((d) => d <= today && store.day(d).water).reduce((a, d, _, arr) => a + store.day(d).water / arr.length, 0);
  const gymN = store.gymCountWeek(ws);
  const endW = addDays(ws, 6);
  const rangeLabel = ws.slice(0, 7) === endW.slice(0, 7) ? `${parseISO(ws).getDate()} al ${parseISO(endW).getDate()} de ${MESES[parseISO(ws).getMonth()]}` : `${fmtDM(ws)} al ${fmtDM(endW)}`;
  const isCur = ws === weekStart(today);
  return `<h1 class="view-title">Diario</h1>${modeSeg}
    <section class="panel">
      <div class="chart-nav">
        <button class="icon-btn" data-act="dia-week" data-d="-1" aria-label="Semana anterior">${icon('left')}</button>
        <button class="date-label" data-act="dia-pick" style="justify-content:center"><span><strong>${isCur ? 'Esta semana' : esc(rangeLabel)}</strong>${isCur ? `<small>${esc(rangeLabel)}</small>` : ''}</span>${icon('down', 16)}</button>
        <button class="icon-btn" data-act="dia-week" data-d="1" aria-label="Semana siguiente" ${addDays(ws, 7) > today ? 'disabled' : ''}>${icon('right')}</button>
      </div>
      ${metricChips}
      <div class="chart-box" data-swipe="diary">${chart}</div>${MOVE_LEGEND}
      <div class="readout"><span>${esc(cap(fmtDayLong(D.sel)))}</span><span><b>${fmt(M.val(D.sel), M.dec)} ${M.unit}</b>${D.sel <= today && store.entriesOn(D.sel).length ? ` · <button class="link" data-act="dia-open" data-date="${D.sel}">Ver día</button>` : ''}</span></div>
      ${D.metric === 'kcal' && selT.items ? `<div class="note">P ${fmt(selT.p)} g · C ${fmt(selT.c)} g · G ${fmt(selT.f)} g</div>` : ''}
    </section>
    <div class="stat-grid" style="margin-top:12px">
      <div class="stat"><small>Promedio kcal</small><b>${logged.length ? fmt(avg('kcal')) : '–'}</b><span>${logged.length} ${logged.length === 1 ? 'día completo' : 'días completos'}${days.includes(today) && !store.dayComplete(today) && store.entriesOn(today).length ? ' (sin hoy)' : ''}</span></div>
      <div class="stat"><small>Promedio proteína</small><b>${logged.length ? fmt(avg('p')) + ' g' : '–'}</b><span>meta ${fmt(g.p)} g</span></div>
      <div class="stat"><small>Agua promedio</small><b>${avgW ? fmt(avgW / 1000, 1) + ' L' : '–'}</b><span>meta ${fmt((g.waterMl || 2500) / 1000, 1)} L</span></div>
      <div class="stat"><small>Gimnasio</small><b>${gymN}<span style="font-size:15px"> / ${g.gymDays || 4}</span></b><span>días esta semana</span></div>
    </div>
    <section class="section"><div class="section-head"><h3>Días</h3></div>
      ${days.filter((d) => d <= today).reverse().map(dayCard).join('')}
    </section>`;
}

// ===========================================================================
// PROGRESO
// ===========================================================================
export function renderProgreso() {
  const P = ui.prog;
  const today = todayISO();
  const S = store.S();
  const g = store.goals();
  const from = P.range === 'todo' ? '0000' : addDays(today, -(P.range - 1));
  const trend = store.weightTrend().filter((p) => p.date >= from);
  const goalW = S.settings.profile.goalWeight || null;
  const rangeSeg = `<div class="seg-ctl" style="margin-bottom:14px">${[[30, '30 días'], [90, '3 meses'], [365, '1 año'], ['todo', 'Todo']].map(([k, l]) => `<button class="${P.range === k ? 'on' : ''}" data-act="prog-range" data-v="${k}">${l}</button>`).join('')}</div>`;
  let weightHtml;
  if (trend.length) {
    const last = trend[trend.length - 1];
    const first = trend[0];
    const span = Math.max(1, daysBetween(first.date, last.date));
    const rate = trend.length > 1 ? ((last.trend - first.trend) / span) * 7 : 0;
    weightHtml = `<section class="panel">
      <div class="section-head" style="margin:0 0 6px"><h3>Peso</h3><span style="display:flex;gap:14px"><button class="link" data-act="weight-list">Pesajes</button><button class="link" data-act="weight-today">Registrar</button></span></div>
      <div class="hero-row" style="margin-bottom:6px"><div><div class="hero-num" style="font-size:38px">${fmt(last.kg, 1)}<span style="font-size:17px;font-weight:600"> kg</span></div><div class="hero-goal">último pesaje · ${esc(relativeDayLabel(last.date).toLowerCase())}</div></div>
        <div class="hero-left"><b>${trend.length > 1 ? (rate >= 0 ? '+' : '−') + fmt(Math.abs(rate), 2) : '–'}</b><span>kg por semana (tendencia)</span></div></div>
      <div class="chart-box">${weightLine({ points: trend, goal: goalW })}</div>
      <div class="legend"><span><i class="k-dot"></i>Pesajes</span><span><i class="k-line"></i>Tendencia ${fmt(last.trend, 1)} kg</span></div>
    </section>`;
  } else {
    weightHtml = `<section class="panel"><div class="empty" style="padding:18px 6px"><strong>Todavía no hay pesajes</strong>Pesate en ayunas y registralo: la app calcula tu tendencia real sin el ruido diario.<div style="margin-top:12px"><button class="btn primary" data-act="weight-today">${icon('scale', 18)} Registrar peso</button></div></div></section>`;
  }
  const days = P.range === 'todo' ? Math.max(1, daysBetween(store.firstDate(), today) + 1) : P.range;
  const avg = store.averages(days);
  const kP = avg ? avg.p * 4 : 0; const kC = avg ? avg.c * 4 : 0; const kF = avg ? avg.f * 9 : 0; const kT = kP + kC + kF || 1;
  const split = avg ? `<section class="panel" style="margin-top:12px">
      <h3 class="sub-h" style="margin-top:0">De dónde vienen tus calorías</h3>
      <div class="share-bar"><i style="flex:${kP};background:var(--prot)"></i><i style="flex:${kC};background:var(--carb)"></i><i style="flex:${kF};background:var(--fat)"></i></div>
      <div class="legend" style="flex-wrap:wrap"><span><i class="k-dot" style="background:var(--prot)"></i>Proteína ${fmt((kP / kT) * 100)} %</span><span><i class="k-dot" style="background:var(--carb)"></i>Carbos ${fmt((kC / kT) * 100)} %</span><span><i class="k-dot" style="background:var(--fat)"></i>Grasas ${fmt((kF / kT) * 100)} %</span></div>
      <p class="note">Promedio por día: ${fmt(avg.p)} g de proteína (${fmt(avg.p / (store.latestWeight()?.kg || 60), 1)} g por kg), ${fmt(avg.c)} g de carbos, ${fmt(avg.f)} g de grasas, ${fmt(avg.s)} g de azúcares.</p>
    </section>` : '';
  const share = store.byMomentShare(days);
  const totK = Object.values(share).reduce((a, x) => a + x.kcal, 0) || 1;
  const moments = Object.entries(share).sort((a, b) => store.momentIndex(a[0]) - store.momentIndex(b[0]));
  const momentsHtml = moments.length ? `<section class="panel" style="margin-top:12px"><h3 class="sub-h" style="margin-top:0">Calorías por comida</h3><div class="top-list">${moments.map(([m, x]) => `<div class="top-row"><span>${esc(store.momentName(m))}</span><span>${fmt((x.kcal / totK) * 100)} % · ${fmt(x.kcal / (avg?.days || 1))} kcal/día</span></div>`).join('')}</div></section>` : '';
  const top = store.topFoods(days);
  const topHtml = top.length ? `<section class="panel" style="margin-top:12px"><h3 class="sub-h" style="margin-top:0">Lo que más calorías te aporta</h3><div class="top-list">${top.map((f) => `<div class="top-row"><span>${esc(f.name)} <small class="muted">×${f.n}</small></span><span>${fmt(f.kcal)} kcal</span></div>`).join('')}</div></section>` : '';
  const lastBody = [...S.body].reverse().find((b) => b.waist || b.chest || b.arm || b.thigh || b.calf || b.fat);
  const meas = [['chest', 'Pecho'], ['waist', 'Cintura'], ['arm', 'Brazo'], ['thigh', 'Muslo'], ['calf', 'Gemelos'], ['fat', '% grasa']];
  const measHtml = `<section class="section"><div class="section-head"><h3>Medidas</h3><button class="link" data-act="measures">${lastBody ? 'Actualizar' : 'Agregar'}</button></div>
    ${lastBody ? `<div class="panel"><div class="note" style="margin:0 0 8px">Última medición: ${esc(cap(fmtDayLong(lastBody.date)))}</div><div class="top-list">${meas.filter(([k]) => lastBody[k] != null).map(([k, l]) => {
      const prev = [...S.body].reverse().find((b) => b.date < lastBody.date && b[k] != null);
      const diff = prev ? lastBody[k] - prev[k] : null;
      return `<div class="top-row"><span>${l}</span><span>${fmt(lastBody[k], 1)} ${k === 'fat' ? '%' : 'cm'}${diff != null && Math.abs(diff) >= 0.05 ? ` <small class="muted">(${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff), 1)})</small>` : ''}</span></div>`;
    }).join('')}</div></div>` : '<div class="empty"><strong>Sin medidas</strong>Registrá cintura, brazo y otras medidas cada 2 a 4 semanas.</div>'}
  </section>`;
  const st = store.streak();
  const avg7 = store.averages(7);
  const stats = `<div class="stat-grid" style="margin-top:12px">
      <div class="stat"><small>Racha de registro</small><b>${st}</b><span>${st === 1 ? 'día seguido' : 'días seguidos'}</span></div>
      <div class="stat"><small>Kcal promedio (7 d)</small><b>${avg7 ? fmt(avg7.kcal) : '–'}</b><span>meta ${fmt(g.kcal)}</span></div>
      <div class="stat"><small>Días en meta de kcal</small><b>${avg ? avg.kcalHit : 0}<span style="font-size:15px"> / ${avg ? avg.days : 0}</span></b><span>en el período</span></div>
      <div class="stat"><small>Días en meta de proteína</small><b>${avg ? avg.protHit : 0}<span style="font-size:15px"> / ${avg ? avg.days : 0}</span></b><span>en el período</span></div>
    </div>`;
  return `<h1 class="view-title">Progreso</h1>${insightsCard()}${rangeSeg}${weightHtml}${stats}${split}${momentsHtml}${topHtml}${measHtml}`;
}

async function openMeasures() {
  const last = [...store.S().body].reverse().find((b) => b.waist || b.chest) || {};
  const r = await formSheet({
    title: 'Medidas corporales', intro: 'Medí siempre en el mismo lugar y a la misma hora. Dejá vacío lo que no midas.',
    fields: [
      { key: 'date', label: 'Fecha', type: 'date', value: todayISO(), full: true },
      { key: 'chest', label: 'Pecho', type: 'number', suffix: 'cm', placeholder: last.chest ? fmt(last.chest, 1) : '' },
      { key: 'waist', label: 'Cintura', type: 'number', suffix: 'cm', placeholder: last.waist ? fmt(last.waist, 1) : '' },
      { key: 'arm', label: 'Brazo', type: 'number', suffix: 'cm', placeholder: last.arm ? fmt(last.arm, 1) : '' },
      { key: 'thigh', label: 'Muslo', type: 'number', suffix: 'cm', placeholder: last.thigh ? fmt(last.thigh, 1) : '' },
      { key: 'calf', label: 'Gemelos', type: 'number', suffix: 'cm', placeholder: last.calf ? fmt(last.calf, 1) : '' },
      { key: 'fat', label: 'Grasa corporal', type: 'number', suffix: '%', placeholder: last.fat ? fmt(last.fat, 1) : '' },
      { key: 'note', label: 'Nota', type: 'text', full: true },
    ],
  });
  if (!r) return;
  const f = {};
  for (const k of ['chest', 'waist', 'arm', 'thigh', 'calf', 'fat']) if (Number.isFinite(r[k])) f[k] = round1(r[k]);
  if (r.note) f.note = r.note;
  if (!Object.keys(f).length) { toast('No cargaste ninguna medida'); return; }
  store.upsertBody(r.date, f); store.commit('medidas');
  toast('Medidas guardadas');
}

// ===========================================================================
// GIMNASIO
// ===========================================================================
let rest = null; // { end, total, label }
let restEl = null;
const elapsed = (t0) => { const s = Math.max(0, Math.floor((Date.now() - t0) / 1000)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`; };

export function renderGym() {
  const S = store.S();
  const A = S.gym.active;
  if (A) return renderActiveSession(A);
  const g = store.goals();
  const today = todayISO();
  const nextR = suggestRoutine();
  const routines = store.routines().map((r) => {
    const last = store.sessionsOf(r.id)[0];
    return `<button class="routine-card" data-act="gym-start" data-id="${r.id}">
      <span class="grow"><h4>${esc(r.name)}${nextR === r.id ? ' <span class="badge web">sigue</span>' : ''}</h4><small>${r.exercises.length} ejercicios · ${last ? 'última vez ' + esc(relativeDayLabel(last.date).toLowerCase()) : 'sin sesiones'}</small></span>
      ${icon('play', 22)}</button>`;
  }).join('');
  const sessions = S.gym.sessions.slice().sort((a, b) => b.date.localeCompare(a.date) || (b.startedAt || 0) - (a.startedAt || 0)).slice(0, 12);
  const hist = sessions.map((s) => {
    const sets = (s.exercises || []).reduce((a, e) => a + (e.sets || []).filter((x) => x.kg || x.reps).length, 0);
    const vol = (s.exercises || []).reduce((a, e) => a + (e.sets || []).reduce((b, x) => b + (Number(x.kg) || 0) * (Number(x.reps) || 0), 0), 0);
    return `<button class="day-card" data-act="gym-session" data-id="${s.id}"><h4>${esc(s.routineName || store.routines().find((r) => r.id === s.routineId)?.name || 'Sesión')}</h4><span class="dc-k">${esc(cap(fmtDayShort(s.date)))}</span><span class="dc-sub"><span>${(s.exercises || []).length} ejercicios</span><span>${sets} series</span>${vol ? `<span>${fmt(vol)} kg de volumen</span>` : ''}</span></button>`;
  }).join('');
  return `<h1 class="view-title">Gimnasio</h1>
    ${activityCard(today)}
    ${gymCalendar(g, today)}
    <section class="section"><div class="section-head"><h3>Empezar rutina</h3><button class="link" data-act="gym-routines">Editar rutinas</button></div>
      ${routines || '<div class="empty"><strong>Sin rutinas</strong>Creá tu primera rutina.</div>'}
      <button class="btn ghost" style="width:100%;margin-top:10px" data-act="gym-start-free">${icon('plus', 18)} Sesión libre</button>
    </section>
    <section class="section"><div class="section-head"><h3>Historial</h3>${S.gym.sessions.length ? '<button class="link" data-act="gym-progress">Progreso por ejercicio</button>' : ''}</div>
      ${hist || '<div class="empty"><strong>Todavía no hay sesiones</strong>Al terminar una rutina queda guardada acá, con tus pesos para la próxima.</div>'}
    </section>`;
}

// "Esta semana": se desliza a semanas (o meses) anteriores
const GC = { mode: 'semana', off: 0 };
const gymOn = (d) => store.day(d).gym === 'fui';
function gymCalendar(g, today) {
  const seg = `<div class="seg-ctl mini">${[['semana', 'Semana'], ['mes', 'Mes']].map(([k, l]) => `<button class="${GC.mode === k ? 'on' : ''}" data-act="gymcal-mode" data-v="${k}">${l}</button>`).join('')}</div>`;
  const nav = (label, sub, canNext) => `<div class="chart-nav" style="margin:0 0 6px">
      <button class="icon-btn" data-act="gymcal-move" data-d="-1" aria-label="Anterior">${icon('left')}</button>
      <span style="text-align:center"><strong>${esc(label)}</strong>${sub ? `<small class="muted" style="display:block;font-size:12.5px">${esc(sub)}</small>` : ''}</span>
      <button class="icon-btn" data-act="gymcal-move" data-d="1" aria-label="Siguiente" ${canNext ? '' : 'disabled'}>${icon('right')}</button></div>`;
  let inner;
  if (GC.mode === 'mes') {
    const ms = addMonths(monthStart(today), -GC.off);
    const me = addDays(addMonths(ms, 1), -1);
    const days = dateRange(ms, me);
    const past = days.filter((d) => d <= today);
    const n = past.filter(gymOn).length;
    const weeks = Math.max(1, past.length / 7);
    const lead = (parseISO(ms).getDay() + 6) % 7;
    const cells = [...Array.from({ length: lead }, () => '<span></span>'), ...days.map((d) => {
      const mv = d <= today ? moveMarks(d) : {};
      return `<span class="cal-d ${d === today ? 'tod' : ''} ${mv.gym ? 'gym' : ''} ${mv.walk ? 'walk' : ''} ${d > today ? 'out' : ''}"><span>${parseISO(d).getDate()}</span>${mv.walk ? '<i class="mk walk"></i>' : ''}</span>`;
    })];
    inner = `${nav(cap(fmtMonthYear(ms)), `${n} ${n === 1 ? 'día' : 'días'} de gimnasio · ${fmt(n / weeks, 1)} por semana`, GC.off > 0)}
      <div class="cal"><div class="cal-w">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((x) => `<span>${x}</span>`).join('')}</div><div class="cal-g">${cells.join('')}</div>${MOVE_LEGEND}</div>`;
  } else {
    const ws = addDays(weekStart(today), -7 * GC.off);
    const wdays = dateRange(ws, addDays(ws, 6));
    const done = wdays.filter(gymOn).length;
    const we = addDays(ws, 6);
    const label = GC.off === 0 ? 'Esta semana' : GC.off === 1 ? 'Semana pasada' : `${fmtDM(ws)} al ${fmtDM(we)}`;
    const dots = wdays.map((d) => `<span><i class="${gymOn(d) ? 'on' : ''} ${d === today ? 'tod' : ''}" title="${esc(fmtDayShort(d))}"></i><small>${'LMMJVSD'[(parseISO(d).getDay() + 6) % 7]}</small></span>`).join('');
    inner = `${nav(label, GC.off === 0 ? `${fmtDM(ws)} al ${fmtDM(we)}` : '', GC.off > 0)}
      <div class="kv"><span>${icon('dumbbell', 18)}Días de gimnasio</span><b>${done} / ${g.gymDays || 4}</b></div>
      <div class="week-dots wk-l" style="margin-top:10px">${dots}</div>`;
  }
  return `<section class="panel" style="margin-top:12px"><div style="display:flex;justify-content:flex-end;margin-bottom:6px">${seg}</div><div data-swipe="gymcal">${inner}</div></section>`;
}
swipes.gymcal = (dir) => {
  if (dir > 0 && GC.off === 0) return false;
  GC.off -= dir; render(); return true;
};

function suggestRoutine() {
  const rs = store.routines();
  if (!rs.length) return null;
  const last = store.sessionsOf()[0];
  if (!last) return rs[0].id;
  const i = rs.findIndex((r) => r.id === last.routineId);
  return i < 0 ? rs[0].id : rs[(i + 1) % rs.length].id;
}

function renderActiveSession(A) {
  const ex = A.exercises.map((e, ei) => {
    const last = store.lastSetsFor(e.name, A.date);
    const hint = store.progressionHint(e, last);
    const lastTxt = last ? last.sets.map((x) => `${fmt(x.kg, 1)}×${x.reps}`).join(' · ') : '';
    const rows = e.sets.map((st, si) => `
      <div class="set-row">
        <span>${si + 1}</span>
        <input class="input set-in" inputmode="decimal" data-ex="${ei}" data-set="${si}" data-k="kg" value="${st.kg === '' || st.kg == null ? '' : String(st.kg).replace('.', ',')}" placeholder="${last?.sets[si] ? String(last.sets[si].kg).replace('.', ',') : 'kg'}" aria-label="Kilos serie ${si + 1}">
        <input class="input set-in" inputmode="numeric" data-ex="${ei}" data-set="${si}" data-k="reps" value="${st.reps === '' || st.reps == null ? '' : st.reps}" placeholder="${last?.sets[si] ? last.sets[si].reps : 'reps'}" aria-label="Repeticiones serie ${si + 1}">
        <button class="set-fail ${st.fail ? 'on' : ''}" data-act="set-fail" data-ex="${ei}" data-set="${si}" aria-pressed="${!!st.fail}" aria-label="Al fallo">${icon('flame', 19)}</button>
        <button class="set-ok ${st.done ? 'on' : ''}" data-act="set-done" data-ex="${ei}" data-set="${si}" aria-label="Serie hecha">${icon('check', 20)}</button>
      </div>`).join('');
    return `<article class="ex-card" data-sort-item>
      <div class="ex-head"><div class="grow"><h4>${esc(e.name)}</h4><div class="ex-meta">${e.target ? esc(e.target) + ' reps · ' : ''}descanso ${fmtRest(e.rest || 90)}${lastTxt ? ` · antes: ${esc(lastTxt)}` : ''}</div></div>
        <button class="icon-btn" data-act="ex-menu" data-ex="${ei}" aria-label="Opciones del ejercicio">${icon('more')}</button></div>
      ${hint ? `<div class="ex-hint">${icon('bolt', 14)} ${esc(hint)}</div>` : ''}
      <div class="sets"><div class="set-labels"><span>#</span><span>Kg</span><span>Reps</span><span>Fallo</span><span></span></div>${rows}</div>
      <button class="btn small ghost" style="margin-top:8px" data-act="set-add" data-ex="${ei}">${icon('plus', 16)} Serie</button>
    </article>`;
  }).join('');
  const nDone = A.exercises.reduce((a, e) => a + e.sets.filter((s) => s.done).length, 0);
  const nAll = A.exercises.reduce((a, e) => a + e.sets.length, 0);
  return `<div class="section-head" style="margin-top:4px"><div><h1 class="view-title" style="margin:0">${esc(A.routineName)}</h1><div class="muted" style="font-size:14px"><span id="gym-elapsed">${elapsed(A.startedAt)}</span> · ${nDone}/${nAll} series · ${esc(relativeDayLabel(A.date))}</div></div>
      <button class="btn small ghost" data-act="gym-cancel">Descartar</button></div>
    <p class="muted" style="font-size:12.5px;margin:10px 2px 0">Mantené apretado un ejercicio y arrastralo para cambiar el orden.</p>
    <div style="margin-top:8px" data-sort="session">${ex}</div>
    <button class="btn ghost" style="width:100%;margin-top:10px" data-act="ex-add">${icon('plus', 18)} Agregar ejercicio</button>
    <button class="btn primary" style="width:100%;margin-top:10px" data-act="gym-finish">${icon('check', 20)} Terminar y guardar</button>
    <div style="height:70px"></div>`;
}

function startSession(routine) {
  const S = store.S();
  const date = todayISO();
  const exercises = (routine ? routine.exercises : []).map((e) => {
    const last = store.lastSetsFor(e.name, date);
    const n = Math.max(1, Number(e.sets) || 3);
    return { name: e.name, target: e.reps, rest: e.rest || 90, sets: Array.from({ length: n }, (_, i) => ({ kg: last?.sets[i]?.kg ?? last?.sets[last.sets.length - 1]?.kg ?? '', reps: '', done: false })) };
  });
  S.gym.active = { id: uid('s'), date, routineId: routine?.id || null, routineName: routine?.name || 'Sesión libre', startedAt: Date.now(), exercises };
  store.commit('gym');
  window.scrollTo(0, 0);
}

function finishSession() {
  const S = store.S();
  const A = S.gym.active;
  if (!A) return;
  const clean = { ...A, done: true, finishedAt: Date.now() };
  clean.exercises = A.exercises.map((e) => ({ name: e.name, target: e.target, note: e.note || '', sets: e.sets.filter((s) => s.done || (s.kg !== '' && s.reps !== '' && s.reps != null)).map((s) => ({ kg: Number(String(s.kg).replace(',', '.')) || 0, reps: Number(s.reps) || 0, ...(s.fail ? { fail: true } : {}) })) })).filter((e) => e.sets.length);
  if (!clean.exercises.length) { toast('Marcá al menos una serie con kilos y repeticiones', { kind: 'error' }); return; }
  S.gym.sessions.push(clean);
  S.gym.active = null;
  store.setGym(clean.date, 'fui', clean.routineName);
  stopRest();
  store.commit('gym');
  const vol = clean.exercises.reduce((a, e) => a + e.sets.reduce((b, s) => b + s.kg * s.reps, 0), 0);
  toast(`Sesión guardada · ${fmt(vol)} kg de volumen`);
}

function startRest(sec, label = '') {
  rest = { end: Date.now() + sec * 1000, total: sec, label };
  gymTimerTick();
}
function stopRest() { rest = null; if (restEl) { restEl.remove(); restEl = null; } }

export function gymTimerTick() {
  try { studyTick(); } catch (e) { console.error(e); }
  const el = document.getElementById('gym-elapsed');
  const A = store.S().gym?.active;
  if (el && A) el.textContent = elapsed(A.startedAt);
  if (!rest) return;
  const left = Math.ceil((rest.end - Date.now()) / 1000);
  if (!restEl) {
    restEl = document.createElement('div');
    restEl.className = 'timer-pill';
    restEl.innerHTML = `${icon('timer', 18)}<b></b><button data-t="-15" aria-label="Restar 15 segundos">${icon('minus', 18)}</button><button data-t="15" aria-label="Sumar 15 segundos">${icon('plus', 18)}</button><button data-t="x" aria-label="Cerrar temporizador">${icon('x', 18)}</button>`;
    restEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]');
      if (!b || !rest) return;
      if (b.dataset.t === 'x') { stopRest(); return; }
      rest.end += Number(b.dataset.t) * 1000; restEl.classList.remove('done'); gymTimerTick();
    });
    document.body.appendChild(restEl);
  }
  const b = restEl.querySelector('b');
  if (left > 0) {
    b.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    restEl.classList.remove('done');
  } else {
    if (!restEl.classList.contains('done')) { restEl.classList.add('done'); vibrate([180, 90, 180]); }
    b.textContent = '¡Listo!';
    if (left < -5) stopRest();
  }
}

// ordenar los ejercicios de la sesión en curso arrastrándolos
document.addEventListener('sorted', (e) => {
  if (e.detail?.name !== 'session') return;
  const A = store.S().gym.active; if (!A) return;
  const [m] = A.exercises.splice(e.detail.from, 1); A.exercises.splice(e.detail.to, 0, m);
  store.commit('gym');
});

// los campos de las series se guardan sin redibujar
document.addEventListener('input', (e) => {
  const inp = e.target.closest?.('.set-in');
  if (!inp) return;
  const A = store.S().gym.active;
  if (!A) return;
  const st = A.exercises[Number(inp.dataset.ex)]?.sets[Number(inp.dataset.set)];
  if (!st) return;
  const v = inp.value.trim();
  st[inp.dataset.k] = v === '' ? '' : (inp.dataset.k === 'reps' ? parseInt(v, 10) || '' : v.replace(',', '.'));
  store.save();
});

async function openRoutines() {
  const draw = () => `<div class="opt-list">${store.routines().map((r) => `<button class="opt" data-id="${r.id}"><span class="opt-main">${icon('list', 20)}<span>${esc(r.name)}<small>${r.exercises.length} ejercicios</small></span></span>${icon('right', 18)}</button>`).join('')}
    <button class="opt" data-new="1"><span class="opt-main">${icon('plus', 20)}<span>Nueva rutina</span></span></button></div>`;
  const s = openSheet({ title: 'Rutinas', body: draw() });
  s.body.addEventListener('click', async (e) => {
    const b = e.target.closest('.opt');
    if (!b) return;
    let r;
    if (b.dataset.new) {
      const name = await promptText({ title: 'Nueva rutina', label: 'Nombre', placeholder: 'Ej.: Torso C' });
      if (!name) return;
      r = { id: slug(name) + '_' + uid('').slice(-4), name, exercises: [] };
      store.S().gym.routines.push(r); store.commit('rutina');
    } else r = store.routines().find((x) => x.id === b.dataset.id);
    if (r) { await editRoutine(r); s.setBody(draw()); }
  });
}

function editRoutine(r) {
  const draw = () => `
    <label class="field"><span>Nombre</span><input class="input" data-rname value="${esc(r.name)}"></label>
    <p class="muted" style="font-size:12.5px;margin:10px 2px 0">Para cambiar el orden, arrastrá un ejercicio desde las flechitas o mantenelo apretado.</p>
    <div class="edit-list" style="margin-top:6px" data-sort="routine">${r.exercises.map((e, i) => `
      <div class="er" style="flex-wrap:wrap" data-sort-item>
        <span style="display:flex;gap:6px;flex:1 1 100%;align-items:center"><button class="icon-btn grip" data-sort-handle aria-label="Arrastrar para ordenar">${icon('move', 18)}</button><input class="input" style="flex:1" data-i="${i}" data-k="name" value="${esc(e.name)}" aria-label="Ejercicio"></span>
        <label class="field" style="flex:1"><span>Series</span><input class="input" inputmode="numeric" data-i="${i}" data-k="sets" value="${e.sets}"></label>
        <label class="field" style="flex:1"><span>Reps</span><input class="input" data-i="${i}" data-k="reps" value="${esc(e.reps)}"></label>
        <label class="field" style="flex:1"><span>Pausa (s)</span><input class="input" inputmode="numeric" data-i="${i}" data-k="rest" value="${e.rest}"></label>
        <div style="display:flex;gap:4px;align-self:flex-end">
          <button class="icon-btn" data-mv="${i}" data-d="-1" aria-label="Subir" ${i === 0 ? 'disabled' : ''}>${icon('up', 18)}</button>
          <button class="icon-btn" data-mv="${i}" data-d="1" aria-label="Bajar" ${i === r.exercises.length - 1 ? 'disabled' : ''}>${icon('down', 18)}</button>
          <button class="icon-btn" data-del="${i}" aria-label="Quitar">${icon('trash', 18)}</button>
        </div>
      </div>`).join('')}</div>
    <button class="btn ghost" style="width:100%;margin-top:12px" data-add>${icon('plus', 18)} Agregar ejercicio</button>`;
  const s = openSheet({ title: 'Editar rutina', full: true, body: draw(), footer: `<button class="btn ghost danger-text" data-delr>${icon('trash', 18)} Borrar rutina</button><button class="btn primary" data-ok>Listo</button>` });
  const read = () => {
    const n = s.body.querySelector('[data-rname]'); if (n && n.value.trim()) r.name = n.value.trim();
    s.body.querySelectorAll('[data-i]').forEach((inp) => {
      const e = r.exercises[Number(inp.dataset.i)]; if (!e) return;
      const k = inp.dataset.k; const v = inp.value.trim();
      if (k === 'sets' || k === 'rest') e[k] = Math.max(k === 'sets' ? 1 : 0, parseInt(v, 10) || (k === 'sets' ? 3 : 90));
      else if (v) e[k] = v;
    });
  };
  s.body.addEventListener('click', (e) => {
    const mv = e.target.closest('[data-mv]'); const del = e.target.closest('[data-del]'); const add = e.target.closest('[data-add]');
    if (!mv && !del && !add) return;
    read();
    if (mv) { const i = Number(mv.dataset.mv); const j = i + Number(mv.dataset.d); [r.exercises[i], r.exercises[j]] = [r.exercises[j], r.exercises[i]]; }
    if (del) r.exercises.splice(Number(del.dataset.del), 1);
    if (add) r.exercises.push({ id: uid('ex'), name: 'Nuevo ejercicio', sets: 3, reps: '8-10', rest: 90 });
    s.setBody(draw());
    if (add) { const ins = s.body.querySelectorAll('[data-k="name"]'); const last = ins[ins.length - 1]; last?.focus(); last?.select(); }
  });
  s.body.addEventListener('sorted', (e) => {
    if (e.detail.name !== 'routine') return;
    read();
    const [m] = r.exercises.splice(e.detail.from, 1); r.exercises.splice(e.detail.to, 0, m);
    s.setBody(draw());
  });
  s.foot.addEventListener('click', async (e) => {
    if (e.target.closest('[data-ok]')) { read(); store.commit('rutina'); s.close(true); }
    if (e.target.closest('[data-delr]')) {
      if (!(await confirmDialog({ title: `¿Borrar ${r.name}?`, text: 'Las sesiones ya guardadas no se borran.', ok: 'Borrar', danger: true }))) return;
      store.S().gym.routines = store.routines().filter((x) => x.id !== r.id); store.commit('rutina'); s.close(true);
    }
  });
  return s.done;
}

function openSessionDetail(id) {
  const S = store.S();
  const ses = S.gym.sessions.find((x) => x.id === id);
  if (!ses) return;
  const body = (ses.exercises || []).map((e) => `<div class="top-row" style="display:block"><b>${esc(e.name)}</b><div class="muted" style="font-size:14px;margin-top:2px">${(e.sets || []).map((x) => `${fmt(x.kg, 1)} kg × ${x.reps}${x.fail ? ' (fallo)' : ''}`).join(' · ') || 'sin series'}${e.note ? ` — ${esc(e.note)}` : ''}</div></div>`).join('');
  const s = openSheet({ title: `${ses.routineName || 'Sesión'} · ${cap(fmtDayShort(ses.date))}`, body: `<div class="top-list">${body}</div>`, footer: `<button class="btn ghost" data-del aria-label="Borrar">${icon('trash', 18)}</button><button class="btn ghost" data-date>${icon('calendar', 18)} Fecha</button><button class="btn primary" data-edit>${icon('edit', 18)} Editar</button>` });
  s.foot.addEventListener('click', async (e) => {
    if (e.target.closest('[data-edit]')) { s.close(); if (await editSession(ses)) openSessionDetail(id); return; }
    if (e.target.closest('[data-date]')) {
      const d = await pickDate({ value: ses.date, max: todayISO() });
      if (d && d !== ses.date) { ses.date = d; store.setGym(d, 'fui', ses.routineName); store.commit('gym'); s.close(); }
    }
    if (e.target.closest('[data-del]')) {
      if (!(await confirmDialog({ title: '¿Borrar la sesión?', ok: 'Borrar', danger: true }))) return;
      S.gym.sessions = S.gym.sessions.filter((x) => x.id !== id); store.commit('gym'); s.close();
    }
  });
}

/** Corregir una sesión ya guardada: ejercicios, series, kilos, repeticiones y fallo. */
function editSession(ses) {
  const ex = deepClone(ses.exercises || []).map((e) => ({ ...e, sets: (e.sets || []).map((x) => ({ ...x })) }));
  let name = ses.routineName || 'Sesión';
  const num = (v) => (v === '' || v == null ? '' : String(v).replace('.', ','));
  const draw = () => `<label class="field"><span>Nombre</span><input class="input" data-sname value="${esc(name)}"></label>
    <p class="muted" style="font-size:12.5px;margin:10px 2px 0">Para cambiar el orden, arrastrá un ejercicio desde las flechitas o mantenelo apretado.</p>
    <div data-sort="sesedit">${ex.map((e, i) => `<article class="ex-card" data-sort-item style="margin-top:10px">
      <div class="ex-head" style="gap:6px"><button class="icon-btn grip" data-sort-handle aria-label="Arrastrar para ordenar">${icon('move', 18)}</button><input class="input" style="flex:1" data-i="${i}" data-k="name" value="${esc(e.name)}" aria-label="Ejercicio"><button class="icon-btn" data-delx="${i}" aria-label="Quitar ejercicio">${icon('trash', 18)}</button></div>
      <div class="sets"><div class="set-labels"><span>#</span><span>Kg</span><span>Reps</span><span>Fallo</span><span></span></div>
      ${e.sets.map((x, j) => `<div class="set-row"><span>${j + 1}</span>
        <input class="input" inputmode="decimal" data-i="${i}" data-s="${j}" data-k="kg" value="${num(x.kg)}" placeholder="kg" aria-label="Kilos serie ${j + 1}">
        <input class="input" inputmode="numeric" data-i="${i}" data-s="${j}" data-k="reps" value="${num(x.reps)}" placeholder="reps" aria-label="Repeticiones serie ${j + 1}">
        <button class="set-fail ${x.fail ? 'on' : ''}" data-fail="${i}" data-s="${j}" aria-pressed="${!!x.fail}" aria-label="Al fallo">${icon('flame', 19)}</button>
        <button class="set-ok" data-dels="${i}" data-s="${j}" aria-label="Quitar serie">${icon('x', 18)}</button></div>`).join('')}</div>
      <button class="btn small ghost" style="margin-top:8px" data-adds="${i}">${icon('plus', 16)} Serie</button>
    </article>`).join('')}</div>
    <button class="btn ghost" style="width:100%;margin-top:12px" data-addx>${icon('plus', 18)} Agregar ejercicio</button>`;
  const s = openSheet({ title: `Editar sesión · ${cap(fmtDayShort(ses.date))}`, full: true, body: draw(), footer: `<button class="btn ghost" data-cancel>Cancelar</button><button class="btn primary" data-save>Guardar</button>` });
  const read = () => {
    const n = s.body.querySelector('[data-sname]'); if (n && n.value.trim()) name = n.value.trim();
    s.body.querySelectorAll('input[data-i]').forEach((inp) => {
      const e = ex[Number(inp.dataset.i)]; if (!e) return;
      const v = inp.value.trim();
      if (inp.dataset.k === 'name') { if (v) e.name = v; return; }
      const st = e.sets[Number(inp.dataset.s)]; if (!st) return;
      st[inp.dataset.k] = v === '' ? '' : inp.dataset.k === 'reps' ? parseInt(v, 10) || 0 : parseNum(v) || 0;
    });
  };
  s.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-fail],[data-dels],[data-adds],[data-delx],[data-addx]');
    if (!b) return;
    read();
    if (b.dataset.fail != null) { const st = ex[Number(b.dataset.fail)].sets[Number(b.dataset.s)]; st.fail = !st.fail; if (!st.fail) delete st.fail; }
    else if (b.dataset.dels != null) ex[Number(b.dataset.dels)].sets.splice(Number(b.dataset.s), 1);
    else if (b.dataset.adds != null) { const e2 = ex[Number(b.dataset.adds)]; const p = e2.sets[e2.sets.length - 1]; e2.sets.push({ kg: p ? p.kg : '', reps: p ? p.reps : '' }); }
    else if (b.dataset.delx != null) { if (!(await confirmDialog({ title: `¿Quitar ${ex[Number(b.dataset.delx)].name}?`, ok: 'Quitar', danger: true }))) return; ex.splice(Number(b.dataset.delx), 1); }
    else if (b.dataset.addx != null) {
      const known = [...new Set([...store.routines().flatMap((r) => r.exercises.map((x) => x.name)), ...store.S().gym.sessions.flatMap((x) => (x.exercises || []).map((y) => y.name))])].sort();
      const v = await pickOption({ title: 'Agregar ejercicio', options: known.map((n) => ({ value: n, label: n })), allowCustom: true, customLabel: 'Otro ejercicio…' });
      if (!v) return;
      ex.push({ name: typeof v === 'object' ? v.custom : v, sets: [{ kg: '', reps: '' }] });
    }
    s.setBody(draw());
  });
  s.body.addEventListener('sorted', (e) => {
    if (e.detail.name !== 'sesedit') return;
    read();
    const [m] = ex.splice(e.detail.from, 1); ex.splice(e.detail.to, 0, m);
    s.setBody(draw());
  });
  s.foot.addEventListener('click', (e) => {
    if (e.target.closest('[data-cancel]')) { s.close(false); return; }
    if (!e.target.closest('[data-save]')) return;
    read();
    const clean = ex.map((x) => ({ ...x, sets: x.sets.filter((y) => Number(y.reps) > 0 || Number(y.kg) > 0).map((y) => ({ kg: Number(y.kg) || 0, reps: Number(y.reps) || 0, ...(y.fail ? { fail: true } : {}) })) })).filter((x) => x.name && x.sets.length);
    if (!clean.length) { toast('Dejá al menos un ejercicio con una serie', { kind: 'error' }); return; }
    ses.exercises = clean; ses.routineName = name; ses.editedAt = Date.now();
    store.commit('gym');
    toast('Sesión corregida');
    s.close(true);
  });
  return s.done;
}

async function openExerciseProgress(name0 = null) {
  const names = [...new Set(store.S().gym.sessions.flatMap((s) => (s.exercises || []).map((e) => e.name)))].sort();
  if (!names.length) return;
  const name = name0 || await pickOption({ title: 'Ejercicio', options: names.map((n) => ({ value: n, label: n, sub: `${store.exerciseHistory(n).length} sesiones` })) });
  if (!name) return;
  const pts = store.exerciseHistory(name);
  const best = pts.reduce((a, p) => Math.max(a, p.e1rm), 0);
  openSheet({
    title: name,
    body: pts.length ? `<div class="stat-grid"><div class="stat"><small>Mejor 1RM estimado</small><b>${fmt(best, 1)} kg</b></div><div class="stat"><small>Peso máximo usado</small><b>${fmt(Math.max(...pts.map((p) => p.top)), 1)} kg</b></div></div>
      <h3 class="sub-h">1RM estimado por sesión</h3><div class="chart-box">${simpleLine({ points: pts, key: 'e1rm' })}</div>
      <div class="top-list" style="margin-top:10px">${pts.slice().reverse().slice(0, 12).map((p) => `<div class="top-row"><span>${esc(cap(fmtDayShort(p.date)))}</span><span>${fmt(p.top, 1)} kg máx · 1RM ${fmt(p.e1rm, 1)}</span></div>`).join('')}</div>` : '<p class="muted">Sin datos.</p>',
  });
}

// ===========================================================================
// AJUSTES
// ===========================================================================
let settingsSheet = null;
export function openSettings(section = null) {
  if (section === 'habitos') return editHabits();
  if (section === 'ia') return openAISettings();
  if (section === 'alimentos') return openMyFoods();
  const S = store.S();
  const ai = S.settings.ai;
  const g = S.settings.goals;
  const themeL = { auto: 'Automático', light: 'Claro', dark: 'Oscuro' };
  const row = (act, ic, title, sub, val = '') => `<button class="set-row-btn" data-s="${act}">${icon(ic, 22)}<span class="grow">${title}${sub ? `<small>${sub}</small>` : ''}</span>${val ? `<span class="val">${val}</span>` : ''}${icon('right', 18)}</button>`;
  const draw = () => `
    <div class="set-group"><h3>Tus metas</h3>
      ${row('perfil', 'user', 'Perfil y metas diarias', `${fmt(g.kcal)} kcal · P ${fmt(g.p)} · C ${fmt(g.c)} · G ${fmt(g.f)} · agua ${fmt((g.waterMl || 2500) / 1000, 1)} L`)}
    </div>
    <div class="set-group"><h3>Registro con IA</h3>
      ${row('ia', 'sparkle', 'Inteligencia artificial', ai.key ? `Conectada${ai.resolvedModel ? ' · ' + esc(prettyModel(ai.resolvedModel)) : ''}${ai.web !== false ? ' · con búsqueda web' : ''}` : 'Falta tu clave de Gemini', ai.key ? '' : '<span class="bad">Configurar</span>')}
      ${row('bench', 'check', 'Probar la IA', 'Mensajes de prueba con resultados esperados (no se guardan)')}
    </div>
    <div class="set-group"><h3>Personalizar</h3>
      ${row('slot', SLOT_TABS[S.settings.ui.slotTab || 'gym']?.[1] || 'dumbbell', 'Pestaña personalizable', 'La principal entre el micrófono y Progreso (con la flechita de arriba cambiás a las otras)', SLOT_TABS[S.settings.ui.slotTab || 'gym']?.[0] || 'Gym')}
      ${row('avisos', 'bell', 'Recordatorios', S.settings.reminders?.on ? `${(S.settings.reminders.list || []).filter((x) => x.on).length} activos` : 'Comidas, agua, hábitos, estudio y resúmenes')}
      ${row('semanal', 'calendar', 'Resumen semanal', `Los ${['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'][S.settings.weekly?.day ?? 1]}${S.settings.weekly?.ai !== false ? ', con consejos de la IA' : ''}`)}
      ${row('momentos', 'clock', 'Comidas del día', S.settings.moments.map((m) => m.name).join(', '))}
      ${row('habitos', 'pill', 'Hábitos y suplementos', S.settings.habits.map((h) => h.name).join(', '))}
      ${row('alimentos', 'library', 'Mis alimentos', `${S.customFoods.length} guardados`)}
      ${row('tema', S.settings.ui.theme === 'dark' ? 'moon' : 'sun', 'Tema', '', themeL[S.settings.ui.theme] || 'Automático')}
      ${row('texto', 'search', 'Tamaño del texto', 'Más chico o más grande en toda la app', TEXT_SIZES[Number(S.settings.ui.textScale) || 1] || 'Normal')}
      ${row('vaso', 'glass', 'Tamaño del vaso', '', `${S.settings.ui.glassMl || 250} ml`)}
    </div>
    <div class="set-group"><h3>Tus datos</h3>
      ${row('excel', 'download', 'Exportar a Excel', 'Resumen, diario, comidas desplegables, gimnasio, progreso y hábitos')}
      ${row('backup', 'file', 'Copia de seguridad', S.settings.backup.lastAt ? `Última: ${relativeDayLabel(isoFromTs(S.settings.backup.lastAt)).toLowerCase()}` : 'Nunca hiciste una copia')}
      ${row('restore', 'upload', 'Restaurar copia', 'Desde un archivo .json de ApexTrack')}
      ${row('import', 'upload', 'Importar planilla anterior', 'El Excel o Google Sheets de la versión 1')}
      ${row('cloud', 'upload', 'Copia automática en Google Drive', cloudStatusText(), BK.cloudActive() ? '' : '<span class="bad">Activar</span>')}
      ${row('recover', 'undo', 'Recuperar datos', 'Desde Drive, las copias diarias internas o un archivo')}
      ${row('borrar', 'trash', 'Borrar todos los datos', '')}
    </div>
    <div class="set-group"><h3>Privacidad</h3>
      ${CM.available() ? `${row('cuenta', 'chart', 'Contar mi uso (anónimo)', 'Avisa una vez por día que la app se usa, con un número al azar. Nada que te identifique.', CM.privacy().count === false ? 'No' : 'Sí')}
      ${row('quien', 'user', 'Decirle al desarrollador quién soy', CM.privacy().ident.on ? `Compartiendo: ${esc(CM.privacy().ident.name || CM.privacy().ident.contact || 'sin nombre')}` : 'Opcional: tu nombre o contacto, para que sepa quién usa la app')}` : ''}
      ${row('privpol', 'info', 'Política de privacidad', 'Qué datos usa la app y dónde se guardan')}
    </div>
    <div class="set-group"><h3>Compartir</h3>
      ${row('share', 'send', 'Compartir la app', 'Cada persona usa su propio teléfono, sus datos y su clave')}
    </div>
    <div class="set-group"><h3>Acerca de</h3>
      <div class="set-row-btn" style="cursor:default">${icon('info', 22)}<span class="grow">ApexTrack ${store.APP_VERSION}<small>Datos en este teléfono, en 3 lugares + copia diaria interna${store.state.persisted ? ' · almacenamiento protegido' : ' · el navegador podría borrarlos si falta espacio: activá la copia en Drive'}${BK.cloudActive() ? ' · copia diaria en Google Drive' : ''}. ${store.S().entries.length} comidas registradas.</small></span></div>
    </div>`;
  const s = openSheet({ title: 'Ajustes', full: true, body: draw() });
  settingsSheet = s;
  const off = store.onChange(() => { if (!s.closed) s.setBody(draw()); });
  s.done.then(() => { off(); settingsSheet = null; });
  s.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    const k = b.dataset.s;
    if (k === 'perfil') editProfile();
    else if (k === 'ia') openAISettings();
    else if (k === 'bench') openBench();
    else if (k === 'momentos') editMoments();
    else if (k === 'habitos') editHabits();
    else if (k === 'alimentos') openMyFoods();
    else if (k === 'texto') {
      const cur = Number(S.settings.ui.textScale) || 1;
      const v = await pickOption({ title: 'Tamaño del texto', value: cur, options: Object.entries(TEXT_SIZES).map(([z, label]) => ({ value: Number(z), label, sub: Number(z) === 1 ? 'El tamaño original' : `${Math.round(Number(z) * 100)} %` })) });
      if (v) { S.settings.ui.textScale = v; applyTheme(); store.commit('texto'); }
    } else if (k === 'tema') {
      const v = await pickOption({ title: 'Tema', value: S.settings.ui.theme, options: [{ value: 'auto', label: 'Automático', sub: 'Igual que el teléfono', icon: 'repeat' }, { value: 'light', label: 'Claro', icon: 'sun' }, { value: 'dark', label: 'Oscuro', icon: 'moon' }] });
      if (v) { S.settings.ui.theme = v; applyTheme(); store.commit('tema'); }
    } else if (k === 'vaso') {
      const v = await pickOption({ title: 'Tamaño del vaso', value: S.settings.ui.glassMl, options: [200, 250, 300, 350, 500].map((x) => ({ value: x, label: `${x} ml` })) });
      if (v) { S.settings.ui.glassMl = v; store.commit('vaso'); }
    } else if (k === 'excel') exportExcelFlow(b);
    else if (k === 'backup') backupFlow();
    else if (k === 'restore') restoreFlow();
    else if (k === 'import') importFlow();
    else if (k === 'borrar') wipeFlow();
    else if (k === 'cloud') openCloudSetup();
    else if (k === 'recover') openRecover();
    else if (k === 'share') shareApp();
    else if (k === 'avisos') openReminders();
    else if (k === 'cuenta') { const pv = CM.privacy(); pv.count = pv.count === false; store.commit('privacidad'); if (pv.count) CM.pingUsage({ force: true }).catch(() => {}); toast(pv.count ? 'Gracias: tu uso se cuenta de forma anónima' : 'Listo: no se cuenta tu uso'); }
    else if (k === 'quien') openIdentify();
    else if (k === 'privpol') window.open('./privacidad.html', '_blank', 'noopener');
    else if (k === 'semanal') {
      const w = S.settings.weekly;
      const v = await pickOption({ title: 'Resumen semanal', options: [
        { value: 'ver', label: 'Ver un resumen ahora', icon: 'sparkle' },
        { value: 'dia', label: 'Día en que se arma', sub: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][w.day ?? 1], icon: 'calendar' },
        { value: 'ia', label: w.ai !== false ? 'Consejos de la IA: activados' : 'Consejos de la IA: desactivados', sub: 'Usa 1 consulta de Gemini por semana', icon: 'bolt' },
      ] });
      if (v === 'ver') askWeekly();
      else if (v === 'ia') { w.ai = w.ai === false; store.commit('semanal'); }
      else if (v === 'dia') {
        const d = await pickOption({ title: '¿Qué día?', value: w.day ?? 1, options: [1, 2, 3, 4, 5, 6, 0].map((x) => ({ value: x, label: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][x] })) });
        if (d != null) { w.day = d; const r = (S.settings.reminders?.list || []).find((x) => x.type === 'resumen'); if (r) r.days = [d]; store.commit('semanal'); }
      }
    }
    else if (k === 'slot') {
      const v = await pickOption({ title: 'Pestaña personalizable', value: S.settings.ui.slotTab || 'gym', options: [
        { value: 'gym', label: 'Gimnasio', sub: 'Rutinas, series, descanso y progresión', icon: 'dumbbell' },
        { value: 'estudio', label: 'Estudio', sub: 'Cronómetro, pomodoro, materias, fechas de examen y pendientes', icon: 'book' },
        { value: 'habitos', label: 'Hábitos', sub: 'Rachas y calendario de cada hábito y suplemento', icon: 'check' },
        { value: 'actividad', label: 'Actividad', sub: 'Pasos, reloj inteligente, calorías gastadas y balance', icon: 'walk' },
        { value: 'ayuno', label: 'Ayuno intermitente', sub: 'Cronómetro 16:8, 18:6…, aviso al terminar e historial', icon: 'timer' },
        { value: 'ideas', label: '¿Qué como?', sub: 'Ideas de tu historial, nuevas y de la IA según lo que te falta', icon: 'meal' },
        { value: 'sueno', label: 'Sueño', sub: 'Horas, calidad, regularidad y qué te hace dormir mejor', icon: 'moon' },
      ] });
      if (v) { const old = S.settings.ui.slotTab || 'gym'; S.settings.ui.slotTab = v; if (ui.tab === old) ui.tab = v; store.commit('slot'); }
    }
  });
  return s;
}
const isoFromTs = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function editProfile() { return openGoals(); }

// ---------- IA ----------
function openAISettings() {
  const S = store.S();
  const ai = S.settings.ai;
  const PREC = { rapida: 'Rápida', equilibrada: 'Equilibrada', maxima: 'Máxima precisión' };
  const draw = () => `
    <p class="muted pad-b">La IA usa Google Gemini con tu propia clave gratuita. La clave queda guardada solo en este teléfono.</p>
    <label class="field"><span>Clave de API de Gemini</span><div class="input-wrap"><input class="input" id="ai-key" type="password" autocomplete="off" spellcheck="false" placeholder="Pegá tu clave (AIza… o AQ.…)" value="${esc(ai.key)}"><em><button class="link" data-a="show" type="button">Ver</button></em></div></label>
    <p class="note">¿No tenés clave? Entrá a <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>, tocá "Create API key", copiala y pegala acá.</p>
    <div class="set-group" style="margin-top:14px">
      <button class="set-row-btn" data-a="prec">${icon('bolt', 22)}<span class="grow">Precisión<small>Máxima usa un modelo más grande: tarda más y gasta más cuota</small></span><span class="val">${PREC[ai.precision] || 'Equilibrada'}</span>${icon('right', 18)}</button>
      <button class="set-row-btn" data-a="model">${icon('sparkle', 22)}<span class="grow">Modelo<small>${ai.resolvedModel ? 'En uso: ' + esc(ai.resolvedModel) : 'Se elige solo el mejor disponible'}</small></span><span class="val">${ai.model === 'auto' || !ai.model ? 'Automático' : esc(ai.model)}</span>${icon('right', 18)}</button>
      <button class="set-row-btn" data-a="diag">${icon('info', 22)}<span class="grow">Diagnóstico de la conexión<small>Prueba cada vía por separado y arma un informe para copiar (usa 4 consultas)</small></span>${icon('right', 18)}</button>
      <button class="set-row-btn" data-a="web">${icon('globe', 22)}<span class="grow">Búsqueda de Google<small>${ai.webNote ? esc(ai.webNote) : 'Las claves gratuitas no suelen tener cupo de búsqueda. Las marcas se buscan igual en Open Food Facts.'}</small></span><span class="switch ${ai.web !== false ? 'on' : ''}" role="switch" aria-checked="${ai.web !== false}"></span></button>
    </div>
    <div class="set-group" style="margin-top:14px"><h3>IA propia (funciona sin conexión)</h3>
      <button class="set-row-btn" data-a="local">${icon('bolt', 22)}<span class="grow">Resolver al instante lo que entiende<small>Si la IA propia reconoce todos los alimentos del mensaje, no espera a Gemini. Siempre podés tocar "Revisar con Gemini".</small></span><span class="switch ${ai.localFirst !== false ? 'on' : ''}" role="switch" aria-checked="${ai.localFirst !== false}"></span></button>
      ${CM.available() ? `<button class="set-row-btn" data-a="share">${icon('send', 22)}<span class="grow">Ayudar a entrenarla<small>Comparte de forma anónima qué comidas analizó Gemini (lo que dijiste y lo que entendió). Nunca tu nombre, peso, metas ni tu clave.</small></span><span class="switch ${ai.share !== false ? 'on' : ''}" role="switch" aria-checked="${ai.share !== false}"></span></button>
      <button class="set-row-btn" data-a="know">${icon('library', 22)}<span class="grow">Conocimiento compartido<small>${(() => { const k = CM.knowledgeInfo(); return k ? `${fmt(k.foods)} alimentos y ${fmt(k.phrases)} frases aprendidas de ${fmt(k.users)} personas · actualizado ${esc(new Date(k.fetchedAt).toLocaleDateString('es-AR'))}` : 'Todavía no se descargó'; })()}${CM.queued() ? ` · ${CM.queued()} aportes por enviar` : ''}</small></span>${icon('repeat', 18)}</button>` : ''}
    </div>
    <label class="field" style="margin-top:14px"><span>Indicaciones para la IA (opcional)</span><textarea class="input" id="ai-notes" rows="3" placeholder="Ej.: la leche que tomo es Protein de La Serenísima. Cuando digo 'un plato' de pasta son 350 g cocidos.">${esc(ai.notes || '')}</textarea></label>
    <div id="ai-status" class="status-line" ${ai.lastTest ? '' : 'hidden'}>${ai.lastTest ? esc(ai.lastTest) : ''}</div>`;
  const s = openSheet({ title: 'Inteligencia artificial', full: true, body: draw(), footer: `<button class="btn ghost" data-a="test">${icon('link', 18)} Probar conexión</button><button class="btn primary" data-a="save">Guardar</button>` });
  const readInputs = () => {
    const k = s.body.querySelector('#ai-key'); const n = s.body.querySelector('#ai-notes');
    if (k) { const nv = k.value.trim().replace(/\s+/g, ''); if (nv !== ai.key) { ai.key = nv; ai.models = []; ai.modelsAt = 0; ai.resolvedModel = ''; ai.endpoint = ''; ai.auth = ''; ai.exhausted = {}; ai.webPauseUntil = 0; } }
    if (n) ai.notes = n.value;
  };
  const handler = async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'show') { const k = s.body.querySelector('#ai-key'); k.type = k.type === 'password' ? 'text' : 'password'; b.textContent = k.type === 'password' ? 'Ver' : 'Ocultar'; return; }
    readInputs();
    if (a === 'prec') {
      const v = await pickOption({ title: 'Precisión', value: ai.precision, options: [{ value: 'rapida', label: 'Rápida', sub: 'Respuestas en pocos segundos' }, { value: 'equilibrada', label: 'Equilibrada', sub: 'Recomendada' }, { value: 'maxima', label: 'Máxima precisión', sub: 'Modelo Pro: más lento, menos cuota gratis' }] });
      if (v) { ai.precision = v; store.commit('ia'); s.setBody(draw()); }
    } else if (a === 'model') {
      let models = ai.models;
      if (ai.key && (!models || !models.flash)) { try { models = await AI.discoverModels(ai, { force: true }); } catch { /* sin lista */ } }
      const list = [...new Set([...(models?.flash || []), ...(models?.pro || []), ...(models?.lite || []), ...AI.FALLBACK_MODELS])].slice(0, 12);
      const v = await pickOption({ title: 'Modelo', value: ai.model || 'auto', options: [{ value: 'auto', label: 'Automático', sub: 'Recomendado: si un modelo deja de existir, usa otro' }, ...list.map((m) => ({ value: m, label: m }))] });
      if (v) { ai.model = v; store.commit('ia'); s.setBody(draw()); }
    } else if (a === 'web') { ai.web = ai.web === false; store.commit('ia'); s.setBody(draw()); }
    else if (a === 'local') { ai.localFirst = ai.localFirst === false; store.commit('ia'); s.setBody(draw()); }
    else if (a === 'share') { ai.share = ai.share === false; store.commit('ia'); s.setBody(draw()); }
    else if (a === 'know') {
      setBusy(b, true, 'Actualizando…');
      try { await CM.flush(); await CM.syncKnowledge({ force: true }); toast('Conocimiento actualizado'); } catch (err) { toast('No se pudo actualizar: ' + (err.message || err), { kind: 'error' }); }
      setBusy(b, false); s.setBody(draw());
    }
    else if (a === 'save') { store.commit('ia'); s.close(); toast(ai.key ? 'IA configurada' : 'Guardado (sin clave, se usa la biblioteca)'); }
    else if (a === 'diag') { if (!ai.key) { toast('Pegá primero tu clave', { kind: 'error' }); return; } store.commit('ia'); openDiagnose(ai); }
    else if (a === 'test') {
      if (!ai.key) { toast('Pegá primero tu clave', { kind: 'error' }); return; }
      store.commit('ia');
      const st = s.body.querySelector('#ai-status');
      setBusy(b, true, 'Probando…');
      st.hidden = false; st.innerHTML = `<span class="spin"></span> Conectando con Gemini…`;
      try {
        const r = await AI.testConnection(ai);
        ai.lastTest = `Conectada con ${r.model} en ${fmt(r.ms / 1000, 1)} s`;
        st.innerHTML = `${icon('check', 20, 'ok')} ${esc(ai.lastTest)}`;
        store.commit('ia');
      } catch (err) {
        st.innerHTML = `${icon('alert', 20, 'bad')} ${esc(err.message || 'No se pudo conectar')}`;
      } finally { setBusy(b, false); }
    }
  };
  s.body.addEventListener('click', handler);
  s.foot.addEventListener('click', handler);
  s.done.then(() => { readInputs(); store.commit('ia'); });
}

// ---------- Banco de pruebas de la IA (no guarda nada) ----------
function draftSummary(draft) {
  const groups = draft.groups.map((g) => {
    const t = AI.groupTotals(g);
    return `<div class="rv-meal" style="margin-top:8px"><div class="rv-meal-head"><b>${esc(relativeDayLabel(g.date))} · ${esc(store.momentName(g.moment))}</b><span class="right">${fmt(t.kcal)} kcal</span></div>
      ${g.items.map((it) => { const m = store.itemMacros(it); return `<div class="note" style="color:var(--ink-2)">• ${esc(it.name)} — ${esc(portion(it))} → ${fmt(m.kcal)} kcal · P ${fmt(m.p, 1)} · C ${fmt(m.c, 1)} · G ${fmt(m.f, 1)}${it.flags?.length ? ` <span class="warn">(${esc(it.flags.join(', '))})</span>` : ''}</div>`; }).join('')}</div>`;
  }).join('');
  const extras = [
    ...draft.water.map((w) => `Agua ${relativeDayLabel(w.date).toLowerCase()}: ${w.mode === 'set' ? 'total ' : '+'}${w.ml} ml`),
    ...draft.habits.map((h) => `${h.name || h.id}: ${h.done ? 'sí' : 'no'} (${relativeDayLabel(h.date).toLowerCase()})`),
    ...draft.gym.map((x) => `Gimnasio ${relativeDayLabel(x.date).toLowerCase()}: ${x.status}`),
    ...draft.weight.map((x) => `Peso: ${fmt(x.kg, 1)} kg`),
    ...draft.questions.map((q) => `Pregunta: ${q}`),
  ];
  return groups + (extras.length ? `<div class="note" style="margin-top:6px">${extras.map(esc).join(' · ')}</div>` : '');
}
const portion = (it) => `${fmt(it.qty, 2)} ${unitLabel(it.unit, it.qty)}${it.grams != null && it.unit !== 'g' && it.unit !== 'ml' ? ` (${fmt(it.grams)} ${it.liq ? 'ml' : 'g'})` : ''}`;

function openBench() {
  const ai = store.S().settings.ai;
  const results = {};
  const draw = () => `
    <p class="muted pad-b">Cada prueba manda un mensaje a la IA y compara el resultado con lo esperado (calorías, comidas, agua, hábitos). <b>No se guarda nada en tu registro.</b>${ai.key ? '' : ' <span class="bad">Primero configurá tu clave de Gemini.</span>'}</p>
    <label class="field"><span>Probar un mensaje propio</span><textarea class="input" id="bench-own" rows="3" placeholder="Escribí lo que comiste, como en un mensaje"></textarea></label>
    <div style="display:flex;gap:8px;margin:8px 0 4px"><button class="btn small" data-b="own">${icon('send', 16)} Analizar sin guardar</button><button class="btn small ghost" data-b="own-off">${icon('wifioff', 16)} Sin IA</button></div>
    <div id="bench-own-out"></div>
    <h3 class="sub-h">Pruebas incluidas (${AI.TEST_CASES.length})</h3>
    ${AI.TEST_CASES.map((tc) => {
      const r = results[tc.id];
      return `<div class="test-row" data-tc="${tc.id}">
        <h5>${r ? (r.running ? '<span class="spin"></span>' : r.error ? icon('alert', 18, 'bad') : r.ev.pass ? icon('check', 18, 'ok') : icon('x', 18, 'bad')) : icon('info', 18)}${esc(tc.title)}</h5>
        <div class="note">“${esc(tc.text.length > 150 ? tc.text.slice(0, 150) + '…' : tc.text)}”</div>
        ${r && !r.running ? (r.error ? `<p class="note bad">${esc(r.error)}</p>` : `<ul>${r.ev.checks.map((c) => `<li class="${c.ok ? '' : 'no'}">${c.ok ? '✓' : '✗'} ${esc(c.msg)}</li>`).join('')}</ul><details><summary class="note">Ver detalle (${r.ms ? fmt(r.ms / 1000, 1) + ' s' : ''}${r.model ? ' · ' + esc(r.model) : ''})</summary>${draftSummary(r.draft)}</details>`) : ''}
        <div style="margin-top:6px"><button class="btn small ghost" data-b="one" data-id="${tc.id}">${r && !r.running ? 'Repetir' : 'Probar'}</button></div>
      </div>`;
    }).join('')}`;
  const s = openSheet({ title: 'Probar la IA', full: true, body: draw(), footer: `<button class="btn ghost" data-b="copy">${icon('copy', 18)} Copiar informe</button><button class="btn primary" data-b="all">${icon('play', 18)} Probar todas</button>` });
  const runOne = async (tc) => {
    results[tc.id] = { running: true }; s.setBody(draw());
    const ctx = AI.testContext(tc);
    const t0 = Date.now();
    try {
      const draft = await AI.analyze({ text: tc.text, ctx });
      results[tc.id] = { draft, ev: AI.evaluateDraft(draft, tc, ctx), ms: Date.now() - t0, model: draft.meta?.model || '' };
    } catch (err) { results[tc.id] = { error: err.message || String(err) }; }
    if (!s.closed) s.setBody(draw());
  };
  const handler = async (e) => {
    const b = e.target.closest('[data-b]');
    if (!b) return;
    const k = b.dataset.b;
    if (k === 'one') runOne(AI.TEST_CASES.find((x) => x.id === b.dataset.id));
    else if (k === 'all') {
      if (!ai.key) { toast('Configurá tu clave de Gemini primero', { kind: 'error', action: 'Configurar', onAction: openAISettings }); return; }
      setBusy(b, true, 'Probando…');
      for (const tc of AI.TEST_CASES) { if (s.closed) break; await runOne(tc); }
      setBusy(b, false);
      const ok = Object.values(results).filter((r) => r.ev?.pass).length;
      toast(`${ok} de ${AI.TEST_CASES.length} pruebas correctas`);
    } else if (k === 'copy') {
      const rep = AI.TEST_CASES.map((tc) => {
        const r = results[tc.id];
        if (!r || r.running) return `${tc.id}: sin probar`;
        if (r.error) return `${tc.id}: ERROR ${r.error}`;
        return `${tc.id}: ${r.ev.pass ? 'OK' : 'FALLA'} (${r.model}, ${fmt(r.ms / 1000, 1)} s)\n  ${r.ev.checks.map((c) => (c.ok ? '✓ ' : '✗ ') + c.msg).join('\n  ')}\n  ${r.draft.groups.map((g) => `${g.date} ${g.moment}: ${g.items.map((it) => `${it.name} ${portion(it)} = ${store.itemMacros(it).kcal} kcal`).join('; ')}`).join('\n  ')}`;
      }).join('\n');
      try { await navigator.clipboard.writeText(`Informe de pruebas ApexTrack ${store.APP_VERSION}\n${rep}`); toast('Informe copiado: pegalo en el chat'); } catch { toast('No se pudo copiar', { kind: 'error' }); }
    } else if (k === 'own' || k === 'own-off') {
      const txt = s.body.querySelector('#bench-own').value.trim();
      const out = s.body.querySelector('#bench-own-out');
      if (!txt) return;
      if (k === 'own') {
        if (!ai.key) { toast('Configurá tu clave de Gemini primero', { kind: 'error' }); return; }
        setBusy(b, true, 'Analizando…');
        try { const d = await AI.analyze({ text: txt }); out.innerHTML = `<div class="panel" style="margin-top:8px">${draftSummary(d)}<p class="note">Total: ${fmt(AI.draftTotals(d).kcal)} kcal · ${esc(prettyModel(d.meta?.model))}${d.meta?.web ? ' · con búsqueda web' : ''}</p></div>`; } catch (err) { out.innerHTML = `<p class="note bad">${esc(err.message)}</p>`; }
        setBusy(b, false);
      } else {
        const d = AI.analyzeOffline(txt, {});
        out.innerHTML = `<div class="panel" style="margin-top:8px">${draftSummary(d)}<p class="note">Total: ${fmt(AI.draftTotals(d).kcal)} kcal · cálculo sin IA</p></div>`;
      }
    }
  };
  s.body.addEventListener('click', handler);
  s.foot.addEventListener('click', handler);
}

// ---------- Momentos ----------
function editMoments() {
  const S = store.S();
  const draw = () => `<p class="muted pad-b">Renombrá, ordená o agregá comidas. La IA las reconoce por nombre.</p><div class="edit-list">${S.settings.moments.map((m, i) => `
    <div class="er"><button class="grow opt" style="border:0;padding:6px 0;min-height:44px" data-ren="${i}"><span class="opt-main"><span>${esc(m.name)}${m.h ? `<small>${fmtH(m.h[0])} a ${fmtH(m.h[1])}</small>` : '<small>sin horario</small>'}</span></span></button>
      <button class="icon-btn" data-mv="${i}" data-d="-1" aria-label="Subir" ${i === 0 ? 'disabled' : ''}>${icon('up', 18)}</button>
      <button class="icon-btn" data-mv="${i}" data-d="1" aria-label="Bajar" ${i === S.settings.moments.length - 1 ? 'disabled' : ''}>${icon('down', 18)}</button>
      <button class="icon-btn" data-del="${i}" aria-label="Quitar">${icon('trash', 18)}</button></div>`).join('')}</div>
    <button class="btn ghost" style="width:100%;margin-top:12px" data-add>${icon('plus', 18)} Agregar comida</button>
    <button class="btn ghost" style="width:100%;margin-top:8px" data-reset>${icon('undo', 18)} Volver a las predeterminadas</button>`;
  const s = openSheet({ title: 'Comidas del día', full: true, body: draw() });
  s.body.addEventListener('click', async (e) => {
    const L = S.settings.moments;
    const ren = e.target.closest('[data-ren]'); const mv = e.target.closest('[data-mv]'); const del = e.target.closest('[data-del]');
    if (ren) {
      const m = L[Number(ren.dataset.ren)];
      const r = await formSheet({ title: m.name, intro: 'El horario se usa para proponer la comida cuando registrás sin decir cuál es. Dejalo vacío si no tiene horario fijo.', fields: [
        { key: 'name', label: 'Nombre', type: 'text', value: m.name, full: true },
        { key: 'a', label: 'Desde', type: 'text', value: m.h ? fmtH(m.h[0]) : '', placeholder: '12:00' },
        { key: 'b', label: 'Hasta', type: 'text', value: m.h ? fmtH(m.h[1]) : '', placeholder: '15:30' },
      ] });
      if (!r) return;
      if (r.name.trim()) m.name = r.name.trim();
      const a = parseH(r.a); const b = parseH(r.b);
      if (a != null && b != null && a !== b) m.h = [a, b];
      else if (!r.a.trim() && !r.b.trim()) m.h = null;
      else toast('Horario no válido: usá el formato 12:30', { kind: 'error' });
      store.commit('momentos'); s.setBody(draw());
    } else if (mv) { const i = Number(mv.dataset.mv); const j = i + Number(mv.dataset.d); [L[i], L[j]] = [L[j], L[i]]; store.commit('momentos'); s.setBody(draw()); }
    else if (del) {
      const m = L[Number(del.dataset.del)];
      const used = S.entries.filter((x) => x.moment === m.id).length;
      if (L.length <= 1) return;
      if (!(await confirmDialog({ title: `¿Quitar ${m.name}?`, text: used ? `Tiene ${used} registros: quedan guardados, pero no vas a poder elegir esta comida.` : '', ok: 'Quitar', danger: true }))) return;
      L.splice(Number(del.dataset.del), 1); store.commit('momentos'); s.setBody(draw());
    } else if (e.target.closest('[data-add]')) {
      const v = await promptText({ title: 'Nueva comida', label: 'Nombre', placeholder: 'Ej.: Colación' });
      if (v) { L.push({ id: slug(v) || uid('m'), name: v, h: null }); store.commit('momentos'); s.setBody(draw()); }
    } else if (e.target.closest('[data-reset]')) {
      if (!(await confirmDialog({ title: '¿Volver a las comidas predeterminadas?', ok: 'Restablecer' }))) return;
      S.settings.moments = deepClone(store.DEFAULT_MOMENTS); store.commit('momentos'); s.setBody(draw());
    }
  });
}
const fmtRest = (x) => (x < 60 ? `${x} s` : `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')} min`);
const parseH = (t) => { const m = String(t || '').trim().match(/^(\d{1,2})(?:[:.,h](\d{2}))?$/); if (!m) return null; const h = Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0); return h >= 0 && h <= 24 ? h : null; };
const fmtH = (h) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

// ---------- Hábitos ----------
function editHabits() {
  const S = store.S();
  const KIND = { supp: 'Suplemento', habit: 'Hábito', hours: 'Horas' };
  const draw = () => `<p class="muted pad-b">Los hábitos se marcan en Hoy con un toque, o diciéndoselo a la IA ("tomé la creatina").</p><div class="edit-list">${S.settings.habits.map((h, i) => `
    <div class="er"><button class="grow opt" style="border:0;padding:6px 0;min-height:44px" data-ed="${i}"><span class="opt-main">${icon(h.kind === 'supp' ? 'pill' : h.kind === 'hours' ? 'book' : 'star', 20)}<span>${esc(h.name)}<small>${KIND[h.kind] || 'Hábito'}${h.detail ? ' · ' + esc(h.detail) : ''}</small></span></span></button>
      <button class="icon-btn" data-mv="${i}" data-d="-1" aria-label="Subir" ${i === 0 ? 'disabled' : ''}>${icon('up', 18)}</button>
      <button class="icon-btn" data-mv="${i}" data-d="1" aria-label="Bajar" ${i === S.settings.habits.length - 1 ? 'disabled' : ''}>${icon('down', 18)}</button>
      <button class="icon-btn" data-del="${i}" aria-label="Quitar">${icon('trash', 18)}</button></div>`).join('')}</div>
    <button class="btn ghost" style="width:100%;margin-top:12px" data-add>${icon('plus', 18)} Agregar hábito o suplemento</button>`;
  const s = openSheet({ title: 'Hábitos y suplementos', full: true, body: draw() });
  const edit = async (h) => {
    const r = await formSheet({ title: h.name ? 'Editar' : 'Nuevo hábito', fields: [
      { key: 'name', label: 'Nombre', type: 'text', value: h.name || '', full: true },
      { key: 'detail', label: 'Detalle (dosis, etc.)', type: 'text', value: h.detail || '', full: true },
      { key: 'aliases', label: 'Otras formas de decirlo (separadas por coma)', type: 'text', value: (h.aliases || []).join(', '), full: true },
    ] });
    if (!r || !r.name.trim()) return false;
    const kind = await pickOption({ title: 'Tipo', value: h.kind || 'habit', options: [{ value: 'supp', label: 'Suplemento', icon: 'pill' }, { value: 'habit', label: 'Hábito (sí o no)', icon: 'star' }, { value: 'hours', label: 'Horas (ej.: estudio)', icon: 'book' }] });
    h.name = r.name.trim(); h.detail = r.detail.trim(); h.kind = kind || h.kind || 'habit';
    h.aliases = r.aliases.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (!h.aliases.includes(norm(h.name))) h.aliases.unshift(norm(h.name));
    return true;
  };
  s.body.addEventListener('click', async (e) => {
    const L = S.settings.habits;
    const ed = e.target.closest('[data-ed]'); const mv = e.target.closest('[data-mv]'); const del = e.target.closest('[data-del]');
    if (ed) { if (await edit(L[Number(ed.dataset.ed)])) { store.commit('habitos'); s.setBody(draw()); } }
    else if (mv) { const i = Number(mv.dataset.mv); const j = i + Number(mv.dataset.d); [L[i], L[j]] = [L[j], L[i]]; store.commit('habitos'); s.setBody(draw()); }
    else if (del) {
      const h = L[Number(del.dataset.del)];
      if (!(await confirmDialog({ title: `¿Quitar ${h.name}?`, text: 'Lo que ya marcaste queda en el historial.', ok: 'Quitar', danger: true }))) return;
      L.splice(Number(del.dataset.del), 1); store.commit('habitos'); s.setBody(draw());
    } else if (e.target.closest('[data-add]')) {
      const h = { id: '', name: '', kind: 'habit', aliases: [] };
      if (await edit(h)) {
        if (h.kind === 'hours' && L.some((x) => x.kind === 'hours')) { toast('Ya tenés un hábito de horas; se guarda como hábito sí/no'); h.kind = 'habit'; }
        let id = slug(h.name); while (L.some((x) => x.id === id)) id += '_2';
        h.id = id; L.push(h); store.commit('habitos'); s.setBody(draw());
      }
    }
  });
}

// ---------- Mis alimentos ----------
function openMyFoods() {
  const S = store.S();
  let q = '';
  const draw = () => {
    const list = S.customFoods.filter((f) => !q || norm(f.n).includes(norm(q))).sort((a, b) => a.n.localeCompare(b.n));
    return `<p class="muted pad-b">Alimentos y recetas propias. La IA los usa cuando los nombrás igual. Se agregan desde el editor de cualquier alimento ("Guardar en Mis alimentos").</p>
      <div class="input-wrap" style="margin-bottom:10px"><input class="input" id="mf-q" placeholder="Buscar" value="${esc(q)}" autocomplete="off"></div>
      <div class="opt-list">${list.map((f) => `<button class="opt" data-id="${f.id}"><span class="opt-main"><span>${esc(f.n)}<small>${fmt(f.k)} kcal · P ${fmt(f.p, 1)} · C ${fmt(f.c, 1)} · G ${fmt(f.f, 1)} cada 100 ${f.liq ? 'ml' : 'g'}${Object.keys(f.u || {}).length ? ' · ' + Object.entries(f.u).map(([u, g]) => `1 ${unitLabel(u)} = ${fmt(g)} ${f.liq ? 'ml' : 'g'}`).join(', ') : ''}</small></span></span>${icon('right', 18)}</button>`).join('') || '<div class="empty"><strong>Sin alimentos propios</strong>Creá uno con el botón de abajo.</div>'}</div>`;
  };
  const s = openSheet({ title: 'Mis alimentos', full: true, body: draw(), footer: `<button class="btn primary" data-new>${icon('plus', 18)} Nuevo alimento</button>` });
  s.body.addEventListener('input', (e) => { if (e.target.id === 'mf-q') { q = e.target.value; const pos = e.target.selectionStart; s.setBody(draw()); const i = s.body.querySelector('#mf-q'); i.focus(); i.setSelectionRange(pos, pos); } });
  s.body.addEventListener('click', async (e) => { const b = e.target.closest('[data-id]'); if (b && await editFood(S.customFoods.find((f) => f.id === b.dataset.id))) s.setBody(draw()); });
  s.foot.addEventListener('click', async (e) => { if (e.target.closest('[data-new]') && await editFood(null)) s.setBody(draw()); });
}

async function editFood(f) {
  const isNew = !f;
  f = f || { n: '', k: '', p: '', c: '', f: '', s: 0, fb: 0, u: {} };
  const unitsTxt = Object.entries(f.u || {}).map(([u, g]) => `${unitLabel(u)}=${g}`).join(', ');
  const r = await formSheet({
    title: isNew ? 'Nuevo alimento' : 'Editar alimento', intro: 'Valores cada 100 g (o 100 ml). Los encontrás en la tabla nutricional del envase.',
    fields: [
      { key: 'n', label: 'Nombre', type: 'text', value: f.n, full: true },
      { key: 'k', label: 'Calorías', type: 'number', suffix: 'kcal', value: f.k },
      { key: 'p', label: 'Proteínas', type: 'number', suffix: 'g', value: f.p },
      { key: 'c', label: 'Carbohidratos', type: 'number', suffix: 'g', value: f.c },
      { key: 'f', label: 'Grasas', type: 'number', suffix: 'g', value: f.f },
      { key: 's', label: 'Azúcares', type: 'number', suffix: 'g', value: f.s || 0 },
      { key: 'fb', label: 'Fibra', type: 'number', suffix: 'g', value: f.fb || 0 },
      { key: 'u', label: 'Medidas (ej.: unidad=42, porción=120)', type: 'text', value: unitsTxt, full: true },
      { key: 'a', label: 'Otros nombres (separados por coma)', type: 'text', value: (f.a || []).join(', '), full: true },
    ],
    extraFooter: isNew ? '' : `<button class="btn ghost" data-r="del">${icon('trash', 18)}</button>`,
  });
  if (!r) return false;
  if (r === 'del') return false;
  if (!r.n.trim() || !Number.isFinite(r.k)) { toast('Completá al menos el nombre y las calorías', { kind: 'error' }); return false; }
  const u = {};
  for (const part of String(r.u || '').split(',')) {
    const m = part.split('=');
    if (m.length !== 2) continue;
    const unit = canonUnit(m[0].trim()); const g = parseNum(m[1]);
    if (unit && unit !== 'g' && unit !== 'ml' && g > 0) u[unit] = g;
  }
  store.saveCustomFood({ ...f, n: r.n.trim(), k: r.k, p: r.p || 0, c: r.c || 0, f: r.f || 0, s: r.s || 0, fb: r.fb || 0, u, a: String(r.a || '').split(',').map((x) => x.trim()).filter(Boolean) });
  store.commit('alimento');
  toast('Alimento guardado');
  return true;
}
// el botón de borrar del formulario de alimento
document.addEventListener('click', async (e) => {
  const b = e.target.closest('.sheet-foot [data-r="del"]');
  if (!b) return;
  e.stopPropagation();
  const title = b.closest('.sheet').querySelector('[data-k="n"]')?.value || '';
  const f = store.S().customFoods.find((x) => x.n === title);
  if (!f) return;
  if (!(await confirmDialog({ title: `¿Borrar ${f.n}?`, ok: 'Borrar', danger: true }))) return;
  store.deleteCustomFood(f.id); store.commit('alimento');
  b.closest('.sheet').querySelector('[data-r="0"]')?.click();
}, true);

// ---------- Datos ----------
async function exportExcelFlow(btn) {
  const v = await pickOption({ title: 'Exportar a Excel', options: [{ value: 'todo', label: 'Todo el historial', icon: 'list' }, { value: '30', label: 'Últimos 30 días', icon: 'calendar' }, { value: 'mes', label: 'Este mes', icon: 'calendar' }, { value: 'rango', label: 'Elegir fechas…', icon: 'calendar' }] });
  if (!v) return;
  const today = todayISO();
  let from = null; let to = null;
  if (v === '30') from = addDays(today, -29);
  else if (v === 'mes') from = monthStart(today);
  else if (v === 'rango') {
    from = await pickDate({ title: 'Desde', value: addDays(today, -30), max: today }); if (!from) return;
    to = await pickDate({ title: 'Hasta', value: today, max: today }); if (!to) return;
    if (to < from) [from, to] = [to, from];
  }
  toast('Generando el Excel…', { ms: 8000 });
  try {
    const X = await import('./excel.js');
    const r = await X.exportExcel({ from, to });
    toast(r === 'cancelado' ? 'Exportación cancelada' : 'Excel listo');
  } catch (err) { console.error(err); toast('No se pudo generar el Excel: ' + (err.message || err), { kind: 'error', ms: 6000 }); }
}

async function backupFlow() {
  try { const X = await import('./excel.js'); const r = await X.exportBackup(); toast(r === 'cancelado' ? 'Cancelado' : 'Copia de seguridad lista. Guardala en Drive o en tu PC.', { ms: 5000 }); } catch (err) { toast('No se pudo crear la copia: ' + err.message, { kind: 'error' }); }
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = () => { const f = inp.files && inp.files[0]; inp.remove(); resolve(f || null); };
    inp.click();
  });
}

async function restoreFlow() {
  const f = await pickFile('application/json,.json');
  if (!f) return;
  try {
    const X = await import('./excel.js');
    const data = await X.readBackup(f);
    if (!(await confirmDialog({ title: '¿Restaurar esta copia?', text: `${BK.describe(data)}. Reemplaza todo lo que hay ahora en la app (tu clave de IA se mantiene).`, ok: 'Restaurar', danger: true }))) return;
    restoreData(data, 'archivo');
  } catch (err) { toast(err.message || 'Archivo no válido', { kind: 'error' }); }
}

async function importFlow() {
  const f = await pickFile('.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  if (!f) return;
  toast('Leyendo la planilla…', { ms: 8000 });
  try {
    const X = await import('./excel.js');
    const imp = await X.parseOldWorkbook(f);
    if (!imp.counts.items && !imp.counts.days) { toast('No encontré datos de ApexTrack en ese archivo', { kind: 'error' }); return; }
    const dates = [...new Set(imp.entries.map((e) => e.date))].sort();
    const overlap = dates.filter((d) => store.entriesOn(d).length).length;
    const ok = await confirmDialog({
      title: 'Importar planilla',
      text: `Encontré ${imp.counts.items} alimentos en ${dates.length} días${dates.length ? ` (${dates[0].split('-').reverse().join('/')} al ${dates[dates.length - 1].split('-').reverse().join('/')})` : ''}, ${imp.body.length} pesajes y ${imp.sessions.length} sesiones de gimnasio.${overlap ? ` ${overlap} de esos días ya tienen comidas en la app: se reemplazan por los de la planilla.` : ''}`,
      ok: 'Importar',
    });
    if (!ok) return;
    X.applyImport(imp);
    toast(`Importado: ${imp.counts.items} alimentos`);
  } catch (err) { console.error(err); toast('No se pudo leer la planilla: ' + (err.message || err), { kind: 'error', ms: 6000 }); }
}

async function wipeFlow() {
  if (!(await confirmDialog({ title: '¿Borrar todos los datos?', text: 'Se eliminan comidas, pesos, gimnasio, hábitos y ajustes de este teléfono. Te recomiendo hacer antes una copia de seguridad.', ok: 'Continuar', danger: true }))) return;
  const v = await promptText({ title: 'Confirmación', label: 'Escribí BORRAR para confirmar' });
  if (!v || v.trim().toUpperCase() !== 'BORRAR') { toast('No se borró nada'); return; }
  const key = store.S().settings.ai.key;
  store.resetAll();
  store.S().settings.ai.key = key;
  store.commit('reset'); applyTheme();
  toast('Datos borrados');
}

let reminded = false;
export function maybeBackupReminder() {
  if (reminded) return;
  reminded = true;
  const S = store.S();
  const n = S.entries.length;
  const last = S.settings.backup.lastAt || 0;
  if (n < 15 || Date.now() - last < 14 * 86400000) return;
  setTimeout(() => toast(last ? 'Hace más de 2 semanas que no hacés una copia de seguridad' : 'Tus datos viven en este teléfono: hacé una copia de seguridad', { action: 'Hacer copia', onAction: backupFlow, ms: 9000 }), 4000);
}

// ===========================================================================
// Gráficos: tocar una barra selecciona el día
// ===========================================================================
export function wireCharts(root) {
  root.querySelectorAll('.chart .hit[data-date]').forEach((h) => {
    h.setAttribute('data-act', 'chart-sel');
    h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); h.dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
  });
}

// deslizar el gráfico semanal del Diario
swipes.diary = (dir) => moveWeek(dir);
swipes.diarymonth = (dir) => moveMonth(dir);
function moveMonth(d) {
  const nm = addMonths(monthStart(ui.diary.month || todayISO()), d);
  if (nm > todayISO()) return false;
  ui.diary.month = nm; render(); return true;
}
function moveWeek(d) {
  const nw = addDays(ui.diary.week, 7 * d);
  if (nw > todayISO()) return false;
  ui.diary.week = nw; render(); return true;
}

// ===========================================================================
// Acciones (se suman a las de app.js)
// ===========================================================================
export const moreActions = {
  ...studyActions,
  'dia-mode': (el) => { ui.diary.mode = el.dataset.v; render(); },
  'dia-metric': (el) => { ui.diary.metric = el.dataset.v; render(); },
  'dia-week': (el) => { const d = Number(el.dataset.d); if (moveWeek(d)) slideIn(document.querySelector('[data-swipe="diary"]'), d); },
  'dia-month': (el) => { const d = Number(el.dataset.d); if (moveMonth(d)) slideIn(document.querySelector('[data-swipe="diarymonth"]'), d); },
  'dia-pick': async () => { const d = await pickDate({ title: 'Ir a la semana de…', value: ui.diary.sel, marks: dayMarks, max: todayISO() }); if (d) { ui.diary.week = weekStart(d); ui.diary.sel = d; render(); } },
  'dia-open': (el) => { const d = el.dataset.date; if (!d || d > todayISO()) return; ui.diary.sel = d; ui.tab = 'hoy'; history.replaceState({ tab: 'hoy' }, ''); setDate(d); window.scrollTo(0, 0); },
  'chart-sel': (el) => { const d = el.dataset.date; if (d > todayISO()) return; if (el.closest('[data-chart="study"]')) { ui.study.sel = d; vibrate(6); render(); return; } if (ui.diary.sel === d && store.entriesOn(d).length) { moreActions['dia-open'](el); return; } ui.diary.sel = d; vibrate(6); render(); },
  'prog-range': (el) => { ui.prog.range = el.dataset.v === 'todo' ? 'todo' : Number(el.dataset.v); render(); },
  'weight-today': () => weightFor(todayISO()),
  'weight-list': () => openWeighIns(),
  'measures': () => openMeasures(),
  'gym-start': async (el) => { const r = store.routines().find((x) => x.id === el.dataset.id); if (r) startSession(r); },
  'gym-start-free': () => startSession(null),
  'gym-routines': () => openRoutines(),
  'gym-session': (el) => openSessionDetail(el.dataset.id),
  'gym-progress': () => openExerciseProgress(),
  'gym-cancel': async () => { if (await confirmDialog({ title: '¿Descartar la sesión?', text: 'No se guarda nada de esta sesión.', ok: 'Descartar', danger: true })) { store.S().gym.active = null; stopRest(); store.commit('gym'); } },
  'gym-finish': () => finishSession(),
  'set-done': (el) => {
    const A = store.S().gym.active; if (!A) return;
    const ex = A.exercises[Number(el.dataset.ex)]; const st = ex?.sets[Number(el.dataset.set)]; if (!st) return;
    if (!st.done) {
      const last = store.lastSetsFor(ex.name, A.date)?.sets[Number(el.dataset.set)];
      if ((st.kg === '' || st.kg == null) && last) st.kg = last.kg;
      if ((st.reps === '' || st.reps == null) && last) st.reps = last.reps;
      if (st.reps === '' || st.reps == null) { toast('Anotá las repeticiones de la serie'); return; }
    }
    st.done = !st.done; vibrate(st.done ? 20 : 8);
    if (st.done) startRest(ex.rest || 90, ex.name);
    store.commit('gym');
  },
  'set-fail': (el) => {
    const A = store.S().gym.active; const st = A?.exercises[Number(el.dataset.ex)]?.sets[Number(el.dataset.set)]; if (!st) return;
    st.fail = !st.fail; vibrate(8); store.commit('gym');
  },
  'gymcal-mode': (el) => { GC.mode = el.dataset.v; GC.off = 0; render(); },
  'gymcal-move': (el) => { const d = Number(el.dataset.d); if (swipes.gymcal(d)) slideIn(document.querySelector('[data-swipe="gymcal"]'), d); },
  'set-add': (el) => { const A = store.S().gym.active; const ex = A?.exercises[Number(el.dataset.ex)]; if (!ex) return; const p = ex.sets[ex.sets.length - 1]; ex.sets.push({ kg: p ? p.kg : '', reps: '', done: false }); store.commit('gym'); },
  'ex-add': async () => {
    const A = store.S().gym.active; if (!A) return;
    const known = [...new Set([...store.routines().flatMap((r) => r.exercises.map((e) => e.name)), ...store.S().gym.sessions.flatMap((s) => (s.exercises || []).map((e) => e.name))])].sort();
    const v = await pickOption({ title: 'Agregar ejercicio', options: known.map((n) => ({ value: n, label: n })), allowCustom: true, customLabel: 'Otro ejercicio…' });
    if (!v) return;
    const name = typeof v === 'object' ? v.custom : v;
    const last = store.lastSetsFor(name, A.date);
    A.exercises.push({ name, target: '', rest: 90, sets: Array.from({ length: Math.max(3, last?.sets.length || 0) }, (_, i) => ({ kg: last?.sets[i]?.kg ?? '', reps: '', done: false })) });
    store.commit('gym');
  },
  'ex-menu': async (el) => {
    const A = store.S().gym.active; const i = Number(el.dataset.ex); const ex = A?.exercises[i]; if (!ex) return;
    const v = await pickOption({ title: ex.name, options: [
      { value: 'del-set', label: 'Quitar la última serie', icon: 'minus' },
      { value: 'rest', label: `Descanso: ${fmtRest(ex.rest || 90)}`, icon: 'timer' },
      { value: 'note', label: ex.note ? `Nota: ${ex.note}` : 'Agregar nota', icon: 'edit' },
      { value: 'prog', label: 'Ver progreso', icon: 'chart' },
      { value: 'up', label: 'Mover arriba', icon: 'up' },
      { value: 'del', label: 'Quitar ejercicio', icon: 'trash' },
    ] });
    if (v === 'del-set' && ex.sets.length > 1) ex.sets.pop();
    else if (v === 'rest') { const r = await pickOption({ title: 'Descanso', value: ex.rest || 90, options: [45, 60, 90, 120, 150, 180, 240].map((x) => ({ value: x, label: fmtRest(x) })) }); if (r) ex.rest = r; }
    else if (v === 'note') { const n = await promptText({ title: 'Nota', value: ex.note || '', label: ex.name }); if (n != null) ex.note = n; }
    else if (v === 'prog') { openExerciseProgress(ex.name); return; }
    else if (v === 'up' && i > 0) [A.exercises[i - 1], A.exercises[i]] = [A.exercises[i], A.exercises[i - 1]];
    else if (v === 'del') { if (!(await confirmDialog({ title: `¿Quitar ${ex.name}?`, ok: 'Quitar', danger: true }))) return; A.exercises.splice(i, 1); }
    else return;
    store.commit('gym');
  },
};

async function weightFor(date) {
  const b = store.bodyOn(date);
  const last = store.latestWeight();
  const v = await promptText({ title: `Peso · ${relativeDayLabel(date).toLowerCase()}`, label: 'Peso en ayunas', value: b?.weight ? String(b.weight).replace('.', ',') : '', placeholder: last ? String(last.kg).replace('.', ',') : '60,0', inputmode: 'decimal', suffix: 'kg' });
  if (v == null || v.trim() === '') return;
  const kg = parseNum(v);
  if (!(kg >= 25 && kg <= 300)) { toast('Ingresá un peso válido en kg', { kind: 'error' }); return; }
  store.upsertBody(date, { weight: round1(kg) }); store.commit('peso');
}

/** Lista de pesajes: corregir el peso, cambiarle el día o borrarlo. */
function openWeighIns() {
  const draw = () => {
    const list = store.weightSeries().reverse();
    return list.length ? `<p class="muted pad-b">Tocá un pesaje para corregirlo o borrarlo.</p><div class="top-list">${list.map((w, i) => {
      const prev = list[i + 1];
      const diff = prev ? w.kg - prev.kg : null;
      return `<div class="top-row" style="align-items:center"><span>${esc(cap(fmtDayLong(w.date)))}</span><span style="display:flex;align-items:center;gap:8px"><b>${fmt(w.kg, 1)} kg</b>${diff != null && Math.abs(diff) >= 0.05 ? `<small class="muted">${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff), 1)}</small>` : ''}<button class="icon-btn" data-w="edit" data-date="${w.date}" aria-label="Corregir">${icon('edit', 18)}</button><button class="icon-btn" data-w="del" data-date="${w.date}" aria-label="Borrar">${icon('trash', 18)}</button></span></div>`;
    }).join('')}</div>` : '<div class="empty"><strong>Sin pesajes</strong>Todavía no registraste tu peso.</div>';
  };
  const s = openSheet({ title: 'Pesajes', body: draw() });
  s.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-w]');
    if (!b) return;
    const date = b.dataset.date;
    const old = store.bodyOn(date);
    if (b.dataset.w === 'del') {
      if (!(await confirmDialog({ title: 'Borrar pesaje', text: `${fmt(old?.weight, 1)} kg del ${fmtDayLong(date)}`, ok: 'Borrar', danger: true }))) return;
      const kg = old?.weight;
      store.deleteWeight(date); store.commit('peso');
      toast('Pesaje borrado', { action: 'Deshacer', onAction: () => { store.upsertBody(date, { weight: kg }); store.commit('peso'); if (!s.closed) s.setBody(draw()); } });
    } else {
      const r = await formSheet({ title: 'Corregir pesaje', fields: [
        { key: 'kg', label: 'Peso', type: 'number', value: String(old?.weight ?? '').replace('.', ','), suffix: 'kg' },
        { key: 'date', label: 'Día', type: 'date', value: date, max: todayISO() },
      ] });
      if (!r) return;
      const kg = Number(r.kg);
      if (!(kg >= 25 && kg <= 300)) { toast('Ingresá un peso válido en kg', { kind: 'error' }); return; }
      const nd = r.date && r.date <= todayISO() ? r.date : date;
      if (nd !== date) store.deleteWeight(date);
      store.upsertBody(nd, { weight: round1(kg) }); store.commit('peso');
      toast('Pesaje corregido');
    }
    if (!s.closed) s.setBody(draw());
  });
}

// ---------------------------------------------------------------------------
// Diagnóstico de la IA
// ---------------------------------------------------------------------------
function openDiagnose(ai) {
  let lines = []; let current = ''; let done = false;
  const recent = store.S().aiLog.slice(0, 5);
  const draw = () => `<p class="muted pad-b">Pruebo cada forma de conectar con Gemini por separado. Tarda hasta un minuto. Al final tocá <b>Copiar informe</b> y pegalo en el chat.</p>
    ${lines.map((l) => `<div class="test-row"><h5>${icon(l.ok ? 'check' : 'alert', 18, l.ok ? 'ok' : 'bad')}${esc(l.name)}</h5><div class="note" style="word-break:break-word">${esc(l.info)}</div></div>`).join('')}
    ${!done ? `<div class="status-line"><span class="spin"></span>${esc(current || 'Empezando…')}</div>` : ''}
    ${done && recent.length ? `<h3 class="sub-h">Últimos análisis</h3>${recent.map((r) => `<div class="note">${esc(new Date(r.at).toLocaleString('es-AR'))} · ${r.ok ? `OK ${esc(r.model || '')} ${fmt((r.ms || 0) / 1000, 1)} s` : `ERROR ${esc(r.code || '')}: ${esc(r.msg || '')}`}${(r.log || []).length ? ' · ' + esc(r.log.map((x) => `${x.model} ${x.endpoint || ''} ${x.web ? 'web' : 'sinweb'} → ${x.status || 0} ${x.s ?? ''}s ${x.msg === 'ok' ? '' : x.msg}`).join(' | ')) : ''}</div>`).join('')}` : ''}`;
  const s = openSheet({ title: 'Diagnóstico de la IA', full: true, body: draw(), footer: `<button class="btn primary" data-d="copy" disabled>${icon('copy', 18)} Copiar informe</button>` });
  AI.diagnose(ai, (ls, cur) => { lines = ls; if (cur) current = `Probando: ${cur}…`; if (!s.closed) s.setBody(draw()); })
    .catch((e) => { lines.push({ ok: false, name: 'Error inesperado', info: String(e && e.message || e) }); })
    .finally(() => { done = true; store.commit('ia'); if (!s.closed) { s.setBody(draw()); s.foot.querySelector('[data-d="copy"]').disabled = false; } });
  s.foot.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-d="copy"]')) return;
    const rep = [`Diagnóstico ApexTrack ${store.APP_VERSION} · ${new Date().toLocaleString('es-AR')}`, ...lines.map((l) => `${l.ok ? '✓' : '✗'} ${l.name}: ${l.info}`), 'Últimos análisis:',
      ...recent.map((r) => `- ${new Date(r.at).toLocaleString('es-AR')} ${r.ok ? `OK ${r.model} ${fmt((r.ms || 0) / 1000, 1)}s` : `ERROR ${r.code}: ${r.msg}`} ${(r.log || []).map((x) => `[${x.model} ${x.endpoint || ''} ${x.web ? 'web' : 'sinweb'} → ${x.status || 0} ${x.s ?? ''}s ${x.msg === 'ok' ? '' : x.msg}]`).join(' ')}`)].join('\n');
    try { await navigator.clipboard.writeText(rep); toast('Informe copiado: pegalo en el chat'); } catch { toast('No se pudo copiar', { kind: 'error' }); }
  });
}

// ---------------------------------------------------------------------------
// Compartir y primer uso
// ---------------------------------------------------------------------------
async function shareApp() {
  const url = location.origin + location.pathname;
  const text = 'ApexTrack: registrá comidas, macros, agua, hábitos y gimnasio contándole a la IA lo que comiste. Abrilo en Chrome y tocá "Instalar app".';
  try {
    if (navigator.share) { await navigator.share({ title: 'ApexTrack', text, url }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('Enlace copiado'); } catch { toast(url, { ms: 8000 }); }
}

export async function maybeOnboard() {
  const S = store.S();
  if (S.settings.onboarded || S.entries.length || S.settings.ai.key) { if (!S.settings.onboarded) { S.settings.onboarded = true; store.save(); } return; }
  await new Promise((r) => setTimeout(r, 400));
  // ¿hay alguna copia de datos anteriores? (fotos diarias internas)
  try {
    const snaps = (await store.listSnapshots()).filter((x) => x.richness >= 3);
    if (snaps.length) {
      const sn = snaps[0];
      if (await confirmDialog({ title: 'Encontré tus datos anteriores', text: `Hay una copia del ${sn.date.split('-').reverse().join('/')} con ${BK.describe(sn.data)}. ¿La restauro?`, ok: 'Restaurar', cancel: 'Empezar de cero' })) {
        restoreData(sn.data, 'copia diaria interna'); return;
      }
    }
  } catch { /* sin copias */ }
  const choice = await pickOption({ title: '¡Bienvenido/a a ApexTrack!', options: [
    { value: 'nuevo', label: 'Empezar', sub: 'Configurar mis metas y la IA en 1 minuto', icon: 'sparkle' },
    { value: 'recuperar', label: 'Ya usaba la app: recuperar mis datos', sub: 'Desde Drive, un archivo de copia o la planilla anterior', icon: 'undo' },
  ] });
  if (choice === 'recuperar') { openRecover(); return; }
  const go1 = choice === 'nuevo';
  S.settings.onboarded = true; store.commit('onboard');
  if (!go1) return;
  // 1) datos y metas (con la IA de bienvenida, una sola vez)
  await OB.aboutYou();
  // 2) pestaña a elección (el ayuno se sugiere a quien quiere bajar de peso)
  const cut = EN.isCut();
  const v = await pickOption({ title: '¿Qué pestaña querés tener a mano?', value: S.settings.ui.slotTab || (cut ? 'ayuno' : 'gym'), options: [
    { value: 'gym', label: 'Gimnasio', sub: 'Rutinas, series y progresión', icon: 'dumbbell' },
    { value: 'ayuno', label: 'Ayuno intermitente', sub: cut ? 'Recomendado para tu objetivo de bajar de peso' : 'Cronómetro 16:8 y aviso al terminar', icon: 'timer' },
    { value: 'ideas', label: '¿Qué como?', sub: 'Ideas según lo que te falta del día', icon: 'meal' },
    { value: 'actividad', label: 'Actividad', sub: 'Pasos, reloj y calorías gastadas', icon: 'walk' },
    { value: 'sueno', label: 'Sueño', sub: 'Horas, calidad y qué te hace dormir mejor', icon: 'moon' },
    { value: 'habitos', label: 'Hábitos', sub: 'Rachas de hábitos y suplementos', icon: 'check' },
    { value: 'estudio', label: 'Estudio', sub: 'Cronómetro, pomodoro y materias', icon: 'book' },
  ] });
  if (v) { S.settings.ui.slotTab = v; store.commit('slot'); }
  // 3) mini recorrido y 4) su propia clave
  await OB.miniTour();
  if ((await OB.keyIntro()) === 'paste') openAISettings();
}

// ===========================================================================
// ACTIVIDAD Y GASTO ESTIMADO
// ===========================================================================
function activityCard(date) {
  const en = EN.dayEnergy(date);
  const cut = EN.isCut();
  const bal = en.balance;
  return `<section class="panel">
    <div class="section-head" style="margin:0 0 4px"><h3>${icon('flame', 18)} Gasto de hoy</h3><button class="link" data-act="energy">Detalle</button></div>
    <div class="hero-row" style="margin:4px 0 8px"><div><div class="hero-num" style="font-size:34px">${fmt(en.total)}<span style="font-size:15px;font-weight:600"> kcal</span></div><div class="hero-goal">basal ${fmt(en.base)} · actividad ${fmt(en.act)} · digestión ${fmt(en.tef)}</div></div>
      <div class="hero-left ${cut && bal > 0 ? 'over' : ''}"><b class="${cut ? (bal > 0 ? 'bad' : 'ok') : ''}">${bal > 0 ? '+' : '−'}${fmt(Math.abs(bal))}</b><span>${bal > 0 ? 'superávit' : 'déficit'} (comiste ${fmt(en.eaten)})</span></div></div>
    ${en.items.length ? `<div class="top-list">${en.items.map((a) => `<div class="top-row"><span>${icon(EN.ACTS[a.type]?.icon || 'bolt', 16)} ${esc(EN.describeAct(a))}</span><span>${fmt(a.kcal)} kcal <button class="link" data-act="activity-del" data-id="${a.id}" data-date="${date}" aria-label="Quitar">${icon('x', 14)}</button></span></div>`).join('')}</div>` : ''}
    ${en.gym ? `<div class="note">Incluye ${fmt(en.gym)} kcal del gimnasio (${fmt(en.gymMin)} min).</div>` : ''}
    <div class="row" style="gap:8px;margin-top:12px"><button class="btn small" data-act="activity-add" data-type="caminata">${icon('walk', 16)} Caminata</button><button class="btn small" data-act="activity-add">${icon('plus', 16)} Otra actividad</button></div>
  </section>`;
}

async function addActivityFlow(date, type0 = null) {
  const type = type0 || await pickOption({ title: 'Actividad', options: Object.entries(EN.ACTS).map(([value, a]) => ({ value, label: a.label, icon: a.icon === 'walk' ? 'walk' : a.icon })) });
  if (!type) return;
  const dist = ['caminata', 'caminata_rapida', 'correr'].includes(type);
  const r = await formSheet({
    title: EN.ACTS[type].label,
    intro: dist ? 'Completá lo que sepas: minutos, kilómetros o pasos (con uno alcanza).' : 'Cuánto duró. Si tu reloj midió las calorías, podés ponerlas.',
    fields: [
      { key: 'date', label: 'Día', type: 'date', value: date, full: true },
      { key: 'min', label: 'Minutos', type: 'number', suffix: 'min', value: '' },
      ...(dist ? [{ key: 'km', label: 'Distancia', type: 'number', suffix: 'km', value: '' }, { key: 'steps', label: 'Pasos', type: 'number', value: '', full: true }] : []),
      { key: 'kcal', label: 'Calorías medidas (opcional)', type: 'number', suffix: 'kcal', value: '', full: !dist },
    ],
  });
  if (!r) return;
  if (r.date > todayISO()) { toast('No se puede anotar en días futuros'); return; }
  const a = { type, min: Number.isFinite(r.min) ? r.min : 0, km: Number.isFinite(r.km) ? r.km : 0, steps: Number.isFinite(r.steps) ? r.steps : 0 };
  if (Number.isFinite(r.kcal) && r.kcal > 0) { a.kcal = r.kcal; a.manual = true; }
  if (!a.min && !a.km && !a.steps && !a.manual) { toast('Poné al menos los minutos, los km o los pasos'); return; }
  const it = EN.addActivity(r.date, a);
  store.commit('actividad');
  toast(`${EN.ACTS[type].label}: ${fmt(EN.actKcal(it, EN.weightOn(r.date)))} kcal`);
}

function openEnergy(date) {
  const en = EN.dayEnergy(date);
  const p = store.S().settings.profile;
  const goal = EN.goalMode();
  const missing = [!p.birthYear && 'edad', !p.sex && 'sexo', !p.heightCm && 'altura', !store.latestWeight(date) && !p.weightKg && 'peso'].filter(Boolean);
  const cut = EN.isCut();
  openSheet({
    title: `Gasto estimado · ${relativeDayLabel(date).toLowerCase()}`,
    body: `<div class="top-list">
      <div class="top-row"><span>Metabolismo basal (${fmt(en.kg, 1)} kg)</span><span>${fmt(en.bmr)} kcal</span></div>
      <div class="top-row"><span>Vida diaria (basal × 1,2)</span><span>${fmt(en.base)} kcal</span></div>
      ${en.items.map((a) => `<div class="top-row"><span>${esc(EN.describeAct(a))}</span><span>+${fmt(a.kcal)} kcal</span></div>`).join('')}
      ${en.gym ? `<div class="top-row"><span>Gimnasio (${fmt(en.gymMin)} min)</span><span>+${fmt(en.gym)} kcal</span></div>` : ''}
      <div class="top-row"><span>Digestión (10 % de lo comido)</span><span>+${fmt(en.tef)} kcal</span></div>
      <div class="top-row"><b>Gasto total</b><b>${fmt(en.total)} kcal</b></div>
      <div class="top-row"><span>Comiste</span><span>${fmt(en.eaten)} kcal</span></div>
      <div class="top-row"><b>${en.balance > 0 ? 'Superávit' : 'Déficit'}</b><b class="${cut ? (en.balance > 0 ? 'bad' : 'ok') : ''}">${fmt(Math.abs(en.balance))} kcal</b></div>
    </div>
    <p class="note" style="margin-top:12px">Objetivo: <b>${esc(EN.GOALS[goal].label)}</b>${p.goal ? '' : ' (deducido de tu meta de calorías)'}. Es una estimación: puede variar ±10 %. ${cut ? 'En rojo cuando comés más de lo que gastás o pasás tu meta.' : ''}</p>
    ${missing.length ? `<div class="banner info" style="margin-top:10px">${icon('info', 20)}<div class="grow">Para que sea más preciso, completá ${missing.join(', ')} en Perfil y metas.</div></div>` : ''}`,
    footer: `<button class="btn" data-x="goals">${icon('user', 18)} Perfil y metas</button><button class="btn primary" data-x="add">${icon('plus', 18)} Actividad</button>`,
  }).foot.addEventListener('click', (e) => {
    const b = e.target.closest('[data-x]'); if (!b) return;
    b.closest('.sheet-wrap').querySelector('[data-sheet-close]').click();
    if (b.dataset.x === 'goals') openGoals(); else addActivityFlow(date);
  });
}

Object.assign(moreActions, {
  'activity-add': (el) => addActivityFlow(ui.tab === 'hoy' ? ui.date : todayISO(), el.dataset.type || null),
  'activity-del': async (el) => { if (await confirmDialog({ title: '¿Quitar la actividad?', ok: 'Quitar', danger: true })) { EN.removeActivity(el.dataset.date, el.dataset.id); store.commit('actividad'); } },
  'energy': () => openEnergy(ui.tab === 'hoy' ? ui.date : todayISO()),
  'insight-run': () => openInsights(),
  'insight-open': (el) => openInsight(el.dataset.id),
});

// Identificarse ante el desarrollador (opcional, con consentimiento explícito)
function openIdentify() {
  const id = CM.privacy().ident;
  const s = openSheet({ title: 'Decirle al desarrollador quién soy', body: `
    <p class="muted pad-b">Es opcional. Si lo activás, una vez por día la app le manda al desarrollador lo que escribas acá, junto con cuántas comidas registraste. <b>Nunca</b> se envían tus comidas, tu peso, tus metas ni tu clave. Lo podés apagar cuando quieras y se deja de enviar.</p>
    <label class="field"><span>Nombre o apodo</span><input class="input" id="id-name" value="${esc(id.name || '')}" autocomplete="name" placeholder="Ej.: Caro"></label>
    <label class="field" style="margin-top:10px"><span>Contacto (opcional)</span><input class="input" id="id-contact" value="${esc(id.contact || '')}" autocomplete="email" placeholder="Correo, Instagram o teléfono"></label>
    <label class="field" style="margin-top:10px"><span>Un mensaje para el desarrollador (opcional)</span><textarea class="input" id="id-note" rows="3" placeholder="Sugerencias, problemas, qué te gusta…">${esc(id.note || '')}</textarea></label>`,
  footer: `${id.on ? '<button class="btn ghost" data-i="off">Dejar de compartir</button>' : ''}<button class="btn primary" data-i="on">${id.on ? 'Guardar' : 'Compartir'}</button>` });
  s.foot.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-i]'); if (!b) return;
    if (b.dataset.i === 'off') { Object.assign(id, { on: false, name: '', contact: '', note: '' }); store.commit('privacidad'); s.close(); CM.pingUsage({ force: true, always: true }).catch(() => {}); toast('Listo: tu nombre se borra del registro del desarrollador'); return; }
    const name = s.body.querySelector('#id-name').value.trim(); const contact = s.body.querySelector('#id-contact').value.trim(); const note = s.body.querySelector('#id-note').value.trim();
    if (!name && !contact) { toast('Escribí al menos un nombre o un contacto', { kind: 'error' }); return; }
    Object.assign(id, { on: true, name, contact, note });
    store.commit('privacidad'); s.close();
    const okSent = await CM.pingUsage({ force: true }).catch(() => false);
    toast(okSent ? '¡Gracias! El desarrollador ya sabe que usás la app' : 'Guardado: se envía cuando haya conexión', { ms: 4000 });
  });
}

// ===========================================================================
// RECUPERAR DATOS Y COPIA AUTOMÁTICA EN DRIVE
// ===========================================================================
function cloudStatusText() {
  const b = store.S().settings.backup;
  if (!BK.cloudActive()) return 'Recomendado: una copia diaria fuera del teléfono';
  if (b.lastCloudError) return `<span class="bad">Error: ${esc(b.lastCloudError)}</span>`;
  const who = b.drive && b.driveEmail ? ` · ${esc(b.driveEmail)}` : '';
  if (b.needAuth && BK.isDue()) return `Pendiente: se sube con tu próximo toque${who}`;
  return b.lastCloudAt ? `Activa · última ${esc(new Date(b.lastCloudAt).toLocaleString('es-AR', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }))}${who}` : `Conectada, todavía sin subir${who}`;
}

function restoreData(data, from) {
  const keep = { key: store.S().settings.ai.key, backup: { ...store.S().settings.backup } };
  store.replaceAll(data);
  const S = store.S();
  if (!S.settings.ai.key) S.settings.ai.key = keep.key;
  // la conexión con Drive de este teléfono se mantiene (no la de la copia)
  const kb = keep.backup;
  S.settings.backup = { ...S.settings.backup, cloudUrl: kb.cloudUrl || S.settings.backup.cloudUrl, cloudToken: kb.cloudToken || S.settings.backup.cloudToken, drive: kb.drive || S.settings.backup.drive, driveEmail: kb.driveEmail || S.settings.backup.driveEmail, driveFolderId: kb.driveFolderId || S.settings.backup.driveFolderId, lastCloudRichness: store.richness(S) };
  S.settings.onboarded = true;
  store.commit('restore'); store.flush(); applyTheme();
  toast(`Datos restaurados (${from}): ${BK.describe(S)}. Lo que había antes quedó guardado en "Recuperar datos".`, { ms: 8000 });
}

const fmtCopyDate = (x) => x.date ? x.date.split('-').reverse().join('/') : x.name;

/** Elegir una copia de Drive y restaurarla. */
async function pickCloudCopy(onDone) {
  let list;
  try { toast('Buscando copias en Drive…', { ms: 4000 }); list = await BK.cloudList(); } catch (err) { toast(err.message || 'No se pudo leer Drive', { kind: 'error', ms: 6000 }); return; }
  if (!list.length) { toast('Todavía no hay copias en Drive.', { ms: 5000 }); return; }
  const id = await pickOption({ title: 'Copias en Google Drive', options: list.map((x, i) => ({ value: x.id, label: x.legacy ? x.name : `${fmtCopyDate(x)}${i === 0 ? ' (la más nueva)' : ''}${/_reducida/.test(x.name) ? ' · con menos datos' : ''}`, sub: x.size ? `${fmt(x.size / 1024)} KB` : '', icon: 'calendar' })) });
  if (!id) return;
  try {
    const r = await BK.cloudPull(id);
    if (await confirmDialog({ title: '¿Restaurar desde Drive?', text: `Copia del ${new Date(r.fecha).toLocaleString('es-AR')}: ${BK.describe(r.data)}. Reemplaza lo que hay ahora en la app (lo actual queda guardado por las dudas).`, ok: 'Restaurar' })) { onDone?.(); restoreData(r.data, 'Google Drive'); }
  } catch (err) { toast(err.message || 'No se pudo leer la copia', { kind: 'error', ms: 6000 }); }
}

async function openRecover() {
  const s = openSheet({ title: 'Recuperar datos', full: true, body: '<div class="status-line"><span class="spin"></span>Buscando copias…</div>' });
  const snaps = await store.listSnapshots().catch(() => []);
  const snapLabel = (x) => x.before ? `Lo que había ${esc(x.before)} · ${esc(new Date(x.updatedAt || Date.now()).toLocaleString('es-AR', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }))}` : esc(x.date.split('-').reverse().join('/'));
  s.setBody(`<p class="muted pad-b">Elegí de dónde traer tus datos. Lo que hay ahora en la app se reemplaza, pero antes se guarda una copia acá mismo por si te equivocás.</p>
    <div class="set-group"><h3>Google Drive</h3>
      ${BK.cloudActive()
    ? `<button class="set-row-btn" data-r-x="drive">${icon('upload', 22)}<span class="grow">Elegir una copia de Drive<small>Una por día de las últimas 2 semanas y una por mes</small></span>${icon('right', 18)}</button>`
    : `<button class="set-row-btn" data-r-x="cloud">${icon('upload', 22)}<span class="grow">Conectar con Google Drive<small>Si ya tenías la copia activada, entrá con la misma cuenta para traer tus datos</small></span>${icon('right', 18)}</button>`}
    </div>
    <div class="set-group"><h3>Copias guardadas en el teléfono</h3>
      ${snaps.length ? snaps.map((x) => `<button class="set-row-btn" data-r-snap="${esc(x.name)}">${icon(x.before ? 'undo' : 'calendar', 22)}<span class="grow">${snapLabel(x)}<small>${esc(BK.describe(x.data))}</small></span>${icon('right', 18)}</button>`).join('') : '<div class="set-row-btn" style="cursor:default"><span class="grow muted">No hay copias internas en este navegador.</span></div>'}
    </div>
    <div class="set-group"><h3>Archivos</h3>
      <button class="set-row-btn" data-r-x="json">${icon('file', 22)}<span class="grow">Archivo de copia (.json)<small>Buscalo en Descargas o en Drive: ApexTrack_copia_…</small></span>${icon('right', 18)}</button>
      <button class="set-row-btn" data-r-x="xlsx">${icon('file', 22)}<span class="grow">Excel exportado o planilla anterior (.xlsx)<small>Trae comidas, pesos, gimnasio y hábitos</small></span>${icon('right', 18)}</button>
    </div>
    <p class="note">¿Usabas la app desde otro navegador (Chrome, Samsung Internet) o desde el ícono instalado? Cada uno guarda sus datos por separado: abrila desde el mismo que usabas antes.</p>`);
  s.body.addEventListener('click', async (e) => {
    const sn = e.target.closest('[data-r-snap]'); const x = e.target.closest('[data-r-x]');
    if (sn) {
      const it = snaps.find((y) => y.name === sn.dataset.rSnap);
      if (it && await confirmDialog({ title: it.before ? '¿Volver a lo que había antes?' : `¿Restaurar la copia del ${it.date.split('-').reverse().join('/')}?`, text: BK.describe(it.data), ok: 'Restaurar' })) { s.close(); restoreData(it.data, 'copia del teléfono'); }
    } else if (x) {
      if (x.dataset.rX === 'drive') pickCloudCopy(() => s.close());
      else if (x.dataset.rX === 'cloud') { s.close(); openCloudSetup(); }
      else if (x.dataset.rX === 'json') { s.close(); restoreFlow(); }
      else { s.close(); importFlow(); }
    }
  });
}

function openCloudSetup() {
  const b = store.S().settings.backup;
  const status = () => {
    if (b.lastCloudError) return `${icon('alert', 20, 'bad')} ${esc(b.lastCloudError)}`;
    if (b.lastCloudAt) return `${icon('check', 20, 'ok')} Última copia: ${esc(new Date(b.lastCloudAt).toLocaleString('es-AR'))}`;
    return '';
  };
  const draw = () => {
    const connected = BK.driveAvailable() && b.drive;
    const google = BK.driveAvailable() ? (connected
      ? `<div class="banner">${icon('check', 20, 'ok')}<div class="grow"><b>Conectada${b.driveEmail ? ` a ${esc(b.driveEmail)}` : ''}</b><div class="muted" style="margin-top:4px">Cada día se guarda una copia en tu Drive, carpeta "ApexTrack copias". Se conservan las de las últimas 2 semanas y una por mes.</div></div></div>`
      : `<p class="muted pad-b">Tocá <b>Conectar con Google</b>, elegí tu cuenta y aceptá. ApexTrack solo puede ver y crear sus propios archivos, dentro de la carpeta "ApexTrack copias": no ve el resto de tu Drive.</p>
         <p class="muted pad-b">Después se sube sola una copia por día (y cuando hay cambios, como mucho cada 3 horas). Google pide renovar el permiso cada tanto: la app lo hace con tu siguiente toque y su ventanita se cierra sola.</p>`)
      : `<div class="banner">${icon('info', 20)}<div class="grow">La conexión directa con Google se habilita en la próxima actualización. Mientras tanto hacé copias con "Copia de seguridad".</div></div>`;
    const legacy = BK.legacyConnected() || b.cloudUrl
      ? `<details style="margin-top:16px"${!BK.driveAvailable() ? ' open' : ''}><summary class="muted">Método anterior (Apps Script propio)</summary>
          <p class="muted" style="margin:8px 0">Sigue funcionando si ya lo tenías configurado.${BK.driveAvailable() ? ' Al conectar con Google, se usa lo nuevo y este se puede borrar.' : ''}</p>
          <label class="field"><span>URL de la aplicación web</span><input class="input" id="c-url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(b.cloudUrl || '')}" autocomplete="off"></label>
          <label class="field" style="margin-top:10px"><span>Clave secreta (la misma del script)</span><div class="input-wrap"><input class="input" id="c-tok" type="password" value="${esc(b.cloudToken || '')}" autocomplete="off"></div></label>
          <button class="btn" style="width:100%;margin-top:10px" data-c="legacy-save">Guardar dirección</button>
          ${b.cloudUrl ? '<button class="btn ghost" style="width:100%;margin-top:6px" data-c="legacy-del">Dejar de usar el método anterior</button>' : ''}
        </details>` : '';
    return `${google}
      <div id="c-st" class="status-line" ${status() ? '' : 'hidden'}>${status()}</div>
      ${connected ? `<button class="btn ghost" style="width:100%;margin-top:10px" data-c="pull">${icon('download', 18)} Traer una copia de Drive</button><button class="btn ghost" style="width:100%;margin-top:6px" data-c="off">Desconectar Google Drive</button>` : ''}
      ${legacy}`;
  };
  const foot = () => {
    if (BK.driveAvailable() && b.drive) return `<button class="btn primary block" data-c="push">${icon('upload', 18)} Subir copia ahora</button>`;
    if (BK.driveAvailable()) return `<button class="btn primary block" data-c="connect">${icon('upload', 18)} Conectar con Google</button>`;
    return BK.legacyConnected() ? `<button class="btn ghost" data-c="pull">${icon('download', 18)} Traer de Drive</button><button class="btn primary" data-c="push">${icon('upload', 18)} Subir ahora</button>` : '';
  };
  const s = openSheet({ title: 'Copia automática en Drive', full: true, body: draw(), footer: foot() });
  const redraw = () => { s.setBody(draw()); s.setFooter(foot()); };
  const say = (html) => { const st = s.body.querySelector('#c-st'); if (st) { st.hidden = false; st.innerHTML = html; } };
  const push = async (btn) => {
    if (store.richness(store.S()) < 3) { say(`${icon('info', 20)} La app está vacía: no subo nada para no pisar una copia que ya tengas. Si querés recuperar, tocá "Traer una copia de Drive".`); return; }
    setBusy(btn, true, 'Subiendo…');
    const r = await BK.cloudPush({ force: true, interactive: true });
    setBusy(btn, false);
    say(r.ok ? `${icon('check', 20, 'ok')} Copia subida a Drive (${fmt((r.bytes || 0) / 1024)} KB). Desde ahora se actualiza sola.` : `${icon('alert', 20, 'bad')} ${esc(r.error || (r.skipped === 'sin permiso' ? 'Falta el permiso de Google: tocá de nuevo.' : r.skipped) || 'No se pudo subir')}`);
  };
  const handler = async (e) => {
    const btn = e.target.closest('[data-c]'); if (!btn) return;
    const k = btn.dataset.c;
    if (k === 'connect') {
      try {
        await BK.authorize({ firstTime: true });
        store.commit('backup');
        redraw();
        if (store.richness(store.S()) >= 3) await push(s.foot.querySelector('[data-c="push"]'));
        else {
          // app vacía (teléfono nuevo o datos borrados): ofrecer traer la copia
          const list = await BK.cloudList().catch(() => []);
          if (list.length) { say(`${icon('info', 20)} Encontré ${list.length} ${list.length === 1 ? 'copia' : 'copias'} en tu Drive.`); pickCloudCopy(() => s.close()); }
        }
      } catch (err) { say(`${icon('alert', 20, 'bad')} ${esc(err.message)}`); }
    } else if (k === 'push') await push(btn);
    else if (k === 'pull') pickCloudCopy(() => s.close());
    else if (k === 'off') {
      if (await confirmDialog({ title: '¿Desconectar Google Drive?', text: 'Las copias que ya están en tu Drive no se borran. La app deja de subir copias nuevas.', ok: 'Desconectar' })) { BK.disconnect(); redraw(); }
    } else if (k === 'legacy-save') {
      const u = s.body.querySelector('#c-url').value.trim(); const t = s.body.querySelector('#c-tok').value.trim();
      if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/.test(u)) { toast('Pegá la URL que termina en /exec', { kind: 'error' }); return; }
      if (t.length < 4) { toast('Poné la clave secreta (mínimo 4 caracteres)', { kind: 'error' }); return; }
      b.cloudUrl = u; b.cloudToken = t; store.commit('backup'); redraw(); toast('Guardado');
    } else if (k === 'legacy-del') { b.cloudUrl = ''; b.cloudToken = ''; store.commit('backup'); redraw(); }
  };
  s.body.addEventListener('click', handler);
  s.foot.addEventListener('click', handler);
}
