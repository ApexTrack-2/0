// ApexTrack — resumen semanal: números de la semana, comparación con la anterior, consejos concretos
// (calculados por la app, sin IA) y, si hay clave de Gemini, el análisis de la IA (qué va bien, qué
// mejorar, qué cambiar y qué evitar). Se arma solo el día elegido (lunes por defecto) o cuando se pide.
import { todayISO, addDays, dateRange, weekStart, fmt, round0, round1, esc, cap, fmtDayShort } from './util.js';
import * as store from './store.js';
import * as EN from './energy.js';
import { icon } from './icons.js';
import { openSheet, toast, pickOption } from './ui.js';
import { runInsights, reportHtml } from './insights.js';

const W = () => store.S().settings.weekly;
export function ensureWeeklySettings(settings) {
  if (!settings.weekly || typeof settings.weekly !== 'object') settings.weekly = { day: 1, ai: true };
  return settings.weekly;
}

// ---------------------------------------------------------------------------
// Números de la semana (lunes a domingo, o hasta hoy si es la semana en curso)
// ---------------------------------------------------------------------------
export function weekStats(from) {
  const today = todayISO();
  const to0 = addDays(from, 6);
  const to = to0 > today ? today : to0;
  const days = dateRange(from, to);
  const g = store.goals();
  const cut = EN.isCut();
  const rows = days.map((d) => {
    const t = store.dayTotals(d); const rec = store.day(d);
    const late = store.entriesOn(d).filter((e) => e.moment === 'post_cena').reduce((x, e) => x + store.entryMacros(e).kcal, 0);
    return { d, ...t, water: rec.water || 0, gym: rec.gym || '', study: rec.study || 0, late, bal: t.items ? EN.dayEnergy(d).balance : null };
  });
  const L = rows.filter((r) => r.items && store.dayComplete(r.d)); // hoy no cuenta hasta que termine
  const avg = (k, arr = L) => (arr.length ? arr.reduce((x, r) => x + (r[k] || 0), 0) / arr.length : 0);
  const inKcal = (r) => (cut ? r.kcal <= g.kcal * 1.05 && r.kcal >= g.kcal * 0.8 : r.kcal >= g.kcal * 0.93 && r.kcal <= g.kcal * 1.15);
  const ws = store.weightTrend().filter((x) => x.date >= from && x.date <= to);
  const st = {
    from, to, full: to === to0, days: days.length, logged: L.length,
    kcal: round0(avg('kcal')), p: round0(avg('p')), c: round0(avg('c')), f: round0(avg('f')), s: round0(avg('s')), fb: round0(avg('fb')),
    water: round0(avg('water', rows)), bal: round0(avg('bal')),
    kcalDays: L.filter(inKcal).length, pDays: L.filter((r) => r.p >= g.p * 0.95).length, waterDays: rows.filter((r) => r.water >= (g.waterMl || 2500)).length,
    sugarDays: g.sugarMax ? L.filter((r) => r.s > g.sugarMax).length : 0, lateDays: L.filter((r) => r.late > 0).length, late: round0(avg('late', L.filter((r) => r.late > 0))),
    gym: rows.filter((r) => r.gym === 'fui').length, study: round1(rows.reduce((x, r) => x + r.study, 0)),
    sleep: (() => { const ns = (store.S().sleep?.nights || []).filter((n) => n.date >= from && n.date <= to); return ns.length ? { avg: round1(ns.reduce((a, n) => a + n.hours, 0) / ns.length), n: ns.length, goal: store.S().sleep.goalH || 8 } : null; })(),
    weight: ws.length >= 2 ? { a: ws[0].kg, b: ws[ws.length - 1].kg, trend: round1(ws[ws.length - 1].trend - ws[0].trend) } : ws.length ? { a: ws[0].kg, b: ws[0].kg, trend: 0 } : null,
    top: store.topFoods(days.length, to, 5).map((x) => ({ name: x.name, kcal: round0(x.kcal), n: x.n })),
    best: null, worst: null, goals: { ...g }, cut,
  };
  if (L.length) {
    const dist = (r) => Math.abs(r.kcal - g.kcal) - (r.p >= g.p * 0.95 ? 150 : 0);
    st.best = [...L].sort((a, b) => dist(a) - dist(b))[0].d;
    st.worst = [...L].sort((a, b) => dist(b) - dist(a))[0].d;
  }
  // puntaje 0-10: calorías 35 %, proteína 25 %, agua 15 %, gimnasio 15 %, constancia 10 %
  const per = (n, of) => (of ? Math.min(1, n / of) : 0);
  st.score = round1(10 * (0.35 * per(st.kcalDays, L.length || 1) + 0.25 * per(st.pDays, L.length || 1) + 0.15 * per(st.waterDays, rows.length) + 0.15 * per(st.gym, Math.max(1, Math.round((g.gymDays || 0) * rows.length / 7))) + 0.10 * per(L.length, rows.length)));
  if (!L.length) st.score = 0;
  return st;
}

/** Consejos concretos a partir de los números (no usan IA). */
export function weekTips(st, prev = null) {
  const g = st.goals;
  const bien = []; const mejorar = []; const cambiar = [];
  const n = st.logged;
  if (n < Math.min(5, st.days)) mejorar.push(`Registraste ${n} de ${st.days} días. Anotá todos los días, aunque sea a grandes rasgos: así los números (y los consejos) son reales.`);
  if (n) {
    const dp = g.p - st.p;
    if (dp > g.p * 0.08) mejorar.push(`Te faltaron unos ${fmt(dp)} g de proteína por día (promedio ${fmt(st.p)} de ${fmt(g.p)} g). Sumá ${dp > 35 ? '150 g de pollo o carne magra (≈ 45 g)' : dp > 20 ? 'un yogur griego y 2 huevos (≈ 22 g)' : 'un yogur alto en proteína (≈ 12 g)'} en el día.`);
    else bien.push(`Proteína bien: ${fmt(st.p)} g por día y llegaste a la meta ${st.pDays} de ${n} días.`);
    const dk = st.kcal - g.kcal;
    if (st.cut && dk > g.kcal * 0.05) {
      const t = st.top[0];
      mejorar.push(`Comiste ${fmt(dk)} kcal por día por encima de la meta (${fmt(st.kcal)} de ${fmt(g.kcal)}).`);
      if (t) cambiar.push(`"${t.name}" fue lo que más calorías sumó (${fmt(t.kcal)} kcal en ${t.n} ${t.n === 1 ? 'vez' : 'veces'}): achicá la porción o cambialo por una versión más liviana.`);
    } else if (!st.cut && dk < -g.kcal * 0.08) {
      mejorar.push(`Te quedaste ${fmt(-dk)} kcal por día debajo de la meta (${fmt(st.kcal)} de ${fmt(g.kcal)}). Sumá una colación con frutos secos, pan con queso o un licuado con avena.`);
    } else bien.push(`Calorías en meta ${st.kcalDays} de ${n} días (promedio ${fmt(st.kcal)} kcal).`);
    if (st.sugarDays >= 2) cambiar.push(`Te pasaste de azúcar ${st.sugarDays} días (promedio ${fmt(st.s)} g, máximo ${fmt(g.sugarMax)} g): cambiá gaseosas, jugos o golosinas por versiones sin azúcar o fruta.`);
    if (st.fb < 22) cambiar.push(`Poca fibra (${fmt(st.fb)} g por día; lo ideal son 25-30 g): agregá verduras en almuerzo y cena, legumbres o avena.`);
    if (st.lateDays >= 3) cambiar.push(`Comiste después de cenar ${st.lateDays} días (${fmt(st.late)} kcal en promedio): si tenés hambre a la noche, mejor un yogur o una fruta.`);
  }
  const wg = g.waterMl || 2500;
  if (st.water < wg * 0.8) mejorar.push(`Agua: ${fmt(st.water / 1000, 1)} L por día de ${fmt(wg / 1000, 1)} L. Llevá una botella y tomá un vaso con cada comida.`);
  else if (st.waterDays >= Math.min(5, st.days)) bien.push(`Tomaste suficiente agua ${st.waterDays} de ${st.days} días.`);
  if (st.sleep && st.sleep.avg < st.sleep.goal - 0.5) mejorar.push(`Dormiste ${fmt(st.sleep.avg, 1)} h por noche (meta ${fmt(st.sleep.goal, 1)} h): dormir poco aumenta el hambre y los antojos. Probá acostarte 30 minutos antes.`);
  else if (st.sleep && st.sleep.n >= 4) bien.push(`Dormiste bien: ${fmt(st.sleep.avg, 1)} h por noche.`);
  const gymGoal = Math.round((g.gymDays || 0) * st.days / 7);
  if (gymGoal && st.gym < gymGoal) mejorar.push(`Gimnasio: fuiste ${st.gym} de ${gymGoal} días. Elegí ya qué días vas a ir esta semana.`);
  else if (gymGoal) bien.push(`Cumpliste con el gimnasio: ${st.gym} ${st.gym === 1 ? 'día' : 'días'}.`);
  if (st.weight && st.weight.trend) {
    const down = st.weight.trend < 0;
    if (st.cut && !down) mejorar.push(`El peso no bajó esta semana (tendencia +${fmt(st.weight.trend, 1)} kg). Revisá las porciones de lo que más calorías aporta.`);
    else if (st.cut && st.weight.trend < -1.2) mejorar.push(`Bajaste rápido (${fmt(st.weight.trend, 1)} kg en la semana): cuidá no comer demasiado poco y mantené la proteína alta.`);
    else if (st.cut && down) bien.push(`El peso viene bajando (${fmt(st.weight.trend, 1)} kg de tendencia).`);
  }
  if (prev && prev.logged && n) {
    if (prev.p && st.p - prev.p >= 10) bien.push(`Mejoraste la proteína: ${fmt(st.p - prev.p)} g más por día que la semana anterior.`);
    if (st.cut && prev.kcal && prev.kcal - st.kcal >= 150) bien.push(`Comiste ${fmt(prev.kcal - st.kcal)} kcal menos por día que la semana anterior.`);
  }
  return { bien: bien.slice(0, 4), mejorar: mejorar.slice(0, 5), cambiar: cambiar.slice(0, 4) };
}

// ---------------------------------------------------------------------------
// Informes guardados
// ---------------------------------------------------------------------------
export function buildWeek(from) {
  const st = weekStats(from);
  const prev = weekStats(addDays(from, -7));
  const tips = weekTips(st, prev);
  return { id: `wk${from}`, from, to: st.to, full: st.full, at: Date.now(), st, prev: { kcal: prev.kcal, p: prev.p, water: prev.water, gym: prev.gym, score: prev.score, logged: prev.logged }, tips, seen: false, ai: null };
}
function saveWeek(rep) {
  const S = store.S();
  S.weekly = [rep, ...(S.weekly || []).filter((x) => x.id !== rep.id)].sort((a, b) => b.from.localeCompare(a.from)).slice(0, 26);
  store.commit('semanal');
}

/** Al abrir la app: el día elegido arma solo el resumen de la semana pasada (y pide el análisis a la IA). */
export function maybeAutoWeekly() {
  const S = store.S();
  const w = ensureWeeklySettings(S.settings);
  const today = todayISO();
  const lastWeek = addDays(weekStart(today), -7);
  const dow = new Date().getDay();
  const reached = (dow === 0 ? 7 : dow) >= (w.day === 0 ? 7 : w.day || 1);
  if (!reached || (S.weekly || []).some((x) => x.from === lastWeek && x.full)) return null;
  if (!store.entriesOn || !dateRange(lastWeek, addDays(lastWeek, 6)).some((d) => store.entriesOn(d).length)) return null;
  const rep = buildWeek(lastWeek);
  saveWeek(rep);
  if (w.ai !== false && S.settings.ai.key && navigator.onLine !== false && rep.st.logged >= 2) {
    runInsights('custom', () => {}, { from: rep.from, to: rep.to, label: 'Semana' }).then((ai) => {
      const r = (store.S().weekly || []).find((x) => x.id === rep.id);
      if (r) { r.ai = ai.id; store.commit('semanal'); }
    }).catch(() => {});
  }
  return rep;
}

export function pendingWeekly() {
  return (store.S().weekly || []).find((x) => x.full && !x.seen && x.from === addDays(weekStart(todayISO()), -7)) || null;
}

// ---------------------------------------------------------------------------
// Pantallas
// ---------------------------------------------------------------------------
const pctDelta = (a, b, unit = '', dec = 0) => {
  if (!b) return '';
  const d = a - b;
  if (Math.abs(d) < (dec ? 0.05 : 1)) return '<small class="muted"> = semana anterior</small>';
  return `<small class="muted"> ${d > 0 ? '▲' : '▼'} ${fmt(Math.abs(d), dec)}${unit}</small>`;
};

export function weekHtml(rep) {
  const st = rep.st; const g = st.goals; const pv = rep.prev || {};
  const ai = rep.ai ? (store.S().insights || []).find((x) => x.id === rep.ai) : null;
  const list = (title, ic, cls, arr) => (arr.length ? `<h3 class="sub-h ${cls}" style="display:flex;gap:6px;align-items:center">${icon(ic, 18)}${title}</h3><ul class="ins-list">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
  const row = (label, val, extra = '') => `<div class="kv"><span>${label}</span><b>${val}${extra}</b></div>`;
  return `<div class="ins-head"><div class="ins-score"><b>${fmt(st.score, st.score % 1 ? 1 : 0)}</b><small>de 10</small></div><div><h3 style="margin:0">${st.full ? 'Tu semana' : 'Tu semana hasta hoy'}</h3><p class="muted" style="margin:4px 0 0;font-size:13px">${esc(cap(fmtDayShort(st.from)))} a ${esc(fmtDayShort(st.to))} · ${st.logged} de ${st.days} días registrados${pv.score ? ` · semana anterior ${fmt(pv.score, pv.score % 1 ? 1 : 0)}` : ''}</p></div></div>
    <section class="panel" style="margin-top:12px">
      ${row('Calorías por día', `${fmt(st.kcal)} / ${fmt(g.kcal)}`, pctDelta(st.kcal, pv.kcal))}
      ${row('Proteína por día', `${fmt(st.p)} / ${fmt(g.p)} g`, pctDelta(st.p, pv.p, ' g'))}
      ${row('Carbohidratos · grasas', `${fmt(st.c)} · ${fmt(st.f)} g`)}
      ${row('Azúcares · fibra', `${fmt(st.s)} · ${fmt(st.fb)} g`)}
      ${row('Agua por día', `${fmt(st.water / 1000, 1)} / ${fmt((g.waterMl || 2500) / 1000, 1)} L`)}
      ${row('Gimnasio', `${st.gym} ${st.gym === 1 ? 'día' : 'días'}`, pctDelta(st.gym, pv.gym))}
      ${st.bal ? row('Balance promedio', `${st.bal > 0 ? '+' : '−'}${fmt(Math.abs(st.bal))} kcal`) : ''}
      ${st.weight ? row('Peso', `${fmt(st.weight.a, 1)} → ${fmt(st.weight.b, 1)} kg`, st.weight.trend ? ` <small class="muted">(tendencia ${st.weight.trend > 0 ? '+' : ''}${fmt(st.weight.trend, 1)})</small>` : '') : ''}
      ${st.study ? row('Estudio', `${fmt(st.study, 1)} h`) : ''}
      ${st.sleep ? row('Sueño por noche', `${fmt(st.sleep.avg, 1)} / ${fmt(st.sleep.goal, 1)} h`) : ''}
      ${st.best ? row('Mejor día', esc(cap(fmtDayShort(st.best)))) : ''}
    </section>
    ${list('Lo que va bien', 'check', 'ok', rep.tips.bien)}${list('Qué mejorar', 'bolt', '', rep.tips.mejorar)}${list('Qué cambiar', 'repeat', 'bad', rep.tips.cambiar)}
    ${st.top.length ? `<h3 class="sub-h" style="display:flex;gap:6px;align-items:center">${icon('flame', 18)}Lo que más calorías sumó</h3><ul class="ins-list">${st.top.map((x) => `<li>${esc(x.name)}: ${fmt(x.kcal)} kcal (${x.n} ${x.n === 1 ? 'vez' : 'veces'})</li>`).join('')}</ul>` : ''}
    <div class="section-head" style="margin-top:18px"><h3 style="display:flex;gap:8px;align-items:center">${icon('sparkle', 18)}Análisis de la IA</h3></div>
    ${ai ? `<div class="panel">${reportHtml(ai, { compact: true })}</div>` : `<p class="note">La IA revisa tu semana y te dice qué cambiar, con alimentos y cantidades concretas.</p><button class="btn primary" style="width:100%" data-w="ai" data-id="${esc(rep.id)}">${icon('sparkle', 18)} Pedir consejos a la IA</button>`}`;
}

export function openWeekly(rep) {
  if (!rep) return;
  rep.seen = true; store.commit('semanal');
  const s = openSheet({ title: 'Resumen semanal', full: true, body: weekHtml(rep) });
  s.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-w="ai"]'); if (!b) return;
    if (!store.S().settings.ai.key) { toast('Primero cargá tu clave de Gemini en Ajustes → Inteligencia artificial', { kind: 'error', ms: 5000 }); return; }
    if (rep.st.logged < 2) { toast('Hacen falta al menos 2 días registrados en la semana.', { kind: 'error' }); return; }
    b.disabled = true; b.innerHTML = '<span class="spin"></span><span>Analizando tu semana…</span>';
    try {
      const ai = await runInsights('custom', (m) => { b.innerHTML = `<span class="spin"></span><span>${esc(m)}</span>`; }, { from: rep.from, to: rep.to, label: 'Semana' });
      rep.ai = ai.id; store.commit('semanal');
      if (!s.closed) s.setBody(weekHtml(rep));
    } catch (err) { toast(err.message || 'No se pudo analizar', { kind: 'error', ms: 6000 }); b.disabled = false; b.innerHTML = `${icon('sparkle', 18)} Reintentar`; }
  });
}

/** Desde Progreso o la notificación: elegir semana y abrir (se arma en el momento). */
export async function askWeekly(which = null) {
  const today = todayISO();
  const cur = weekStart(today);
  const v = which || await pickOption({ title: 'Resumen semanal', options: [
    { value: 'pasada', label: 'Semana pasada', sub: `${cap(fmtDayShort(addDays(cur, -7)))} a ${fmtDayShort(addDays(cur, -1))}`, icon: 'calendar' },
    { value: 'actual', label: 'Esta semana, hasta hoy', sub: `${cap(fmtDayShort(cur))} a ${fmtDayShort(today)}`, icon: 'today' },
    ...((store.S().weekly || []).filter((x) => x.from < addDays(cur, -7)).slice(0, 6).map((x) => ({ value: x.id, label: `${cap(fmtDayShort(x.from))} a ${fmtDayShort(x.to)}`, sub: `${fmt(x.st.score, x.st.score % 1 ? 1 : 0)}/10`, icon: 'calendar' }))),
  ] });
  if (!v) return;
  const saved = (store.S().weekly || []).find((x) => x.id === v);
  if (saved) { openWeekly(saved); return; }
  const from = v === 'actual' ? cur : addDays(cur, -7);
  const old = (store.S().weekly || []).find((x) => x.from === from);
  const rep = buildWeek(from);
  if (old?.ai && rep.full) rep.ai = old.ai;
  saveWeek(rep);
  openWeekly(rep);
}

export function weeklyCard() {
  const p = pendingWeekly();
  if (!p) return '';
  return `<button class="banner info" style="width:100%;text-align:left;margin-top:10px" data-act="weekly-open">${icon('sparkle', 20)}<div class="grow"><b>Tu resumen de la semana está listo · ${fmt(p.st.score, p.st.score % 1 ? 1 : 0)}/10</b><div class="muted" style="margin-top:2px">Qué fue bien, qué mejorar y qué cambiar</div></div>${icon('right', 18)}</button>`;
}
