// ApexTrack — análisis del progreso con IA: qué va bien, qué va mal, qué mejorar y qué evitar.
import { todayISO, addDays, dateRange, fmt, round0, round1, esc, cap, fmtDayShort, weekStart } from './util.js';
import * as store from './store.js';
import * as AI from './ai.js';
import * as EN from './energy.js';
import { icon } from './icons.js';
import { openSheet, pickOption, toast } from './ui.js';

const RANGES = { semana: ['Última semana', 7], mes: ['Último mes', 30], tres: ['Últimos 3 meses', 90], todo: ['Todo el historial', 0] };

/** Resumen numérico del período (lo que lee la IA). Las cuentas las hace la app. */
export function buildSummary(rangeKey = 'mes', custom = null) {
  const S = store.S();
  const today = custom?.to || todayISO();
  const first = store.firstDate();
  const n = RANGES[rangeKey]?.[1] || 0;
  let from = custom?.from || (n ? addDays(today, -(n - 1)) : first);
  if (from < first && !custom) from = first;
  const days = dateRange(from, today);
  const g = store.goals();
  const p = S.settings.profile;
  const logged = store.statDays(days); // hoy no cuenta hasta que termine (o sea tarde y esté todo registrado)
  const rows = days.map((d) => {
    const t = store.dayTotals(d); const rec = store.day(d); const en = EN.dayEnergy(d);
    const habs = store.habitsList().filter((h) => h.kind !== 'hours');
    return {
      d, kcal: t.kcal, p: t.p, c: t.c, f: t.f, s: t.s, fb: t.fb, items: t.items, water: rec.water || 0, gym: rec.gym || '', act: en.act, gasto: en.total,
      bal: t.items ? en.balance : null, habits: habs.filter((h) => (rec.habits || {})[h.id]).length, habTotal: habs.length, study: rec.study || 0,
      late: store.entriesOn(d).filter((e) => e.moment === 'post_cena').reduce((x, e) => x + store.entryMacros(e).kcal, 0),
    };
  });
  const L = rows.filter((r) => r.items && store.dayComplete(r.d)); // hoy no cuenta hasta que termine
  const avg = (k, arr = L) => (arr.length ? arr.reduce((x, r) => x + (r[k] || 0), 0) / arr.length : 0);
  const goal = EN.goalMode();
  const lines = [];
  lines.push(`PERSONA: ${p.sex === 'f' ? 'mujer' : 'hombre'}${p.birthYear ? `, ${new Date().getFullYear() - p.birthYear} años` : ''}${p.heightCm ? `, ${p.heightCm} cm` : ''}, peso ${fmt(EN.weightOn(), 1)} kg${p.goalWeight ? `, peso objetivo ${p.goalWeight} kg` : ''}. Objetivo: ${EN.GOALS[goal].label}${p.goal ? '' : ' (deducido de su meta de calorías)'}.`);
  lines.push(`METAS DIARIAS: ${g.kcal} kcal, proteína ${g.p} g, carbohidratos ${g.c} g, grasas ${g.f} g, azúcares máx. ${g.sugarMax || '—'} g, agua ${g.waterMl} ml, gimnasio ${g.gymDays} días por semana.`);
  lines.push(`PERÍODO: ${from} a ${today} (${days.length} días; ${logged.length} con comidas registradas).`);
  if (L.length) {
    lines.push(`PROMEDIOS (días registrados): ${round0(avg('kcal'))} kcal, P ${round0(avg('p'))} g, C ${round0(avg('c'))} g, G ${round0(avg('f'))} g, azúcares ${round0(avg('s'))} g, fibra ${round0(avg('fb'))} g, agua ${round0(avg('water', rows))} ml/día (todos los días), gasto estimado ${round0(avg('gasto'))} kcal, balance ${round0(avg('bal'))} kcal/día.`);
    const kHit = L.filter((r) => (EN.isCut() ? r.kcal <= g.kcal * 1.05 && r.kcal >= g.kcal * 0.8 : r.kcal >= g.kcal * 0.95)).length;
    lines.push(`CUMPLIMIENTO: calorías en meta ${kHit}/${L.length} días; proteína ≥ meta ${L.filter((r) => r.p >= g.p).length}/${L.length}; agua ≥ meta ${rows.filter((r) => r.water >= g.waterMl).length}/${rows.length}; azúcares sobre el máximo ${g.sugarMax ? L.filter((r) => r.s > g.sugarMax).length : '—'}/${L.length}; comida después de cenar en ${L.filter((r) => r.late > 0).length} días (promedio ${round0(avg('late'))} kcal).`);
  }
  const weeks = Math.max(1, days.length / 7);
  lines.push(`GIMNASIO: fue ${rows.filter((r) => r.gym === 'fui').length} días (${round1(rows.filter((r) => r.gym === 'fui').length / weeks)} por semana), no fue ${rows.filter((r) => r.gym === 'no_fui').length}, descanso ${rows.filter((r) => r.gym === 'descanso').length}. Actividad extra promedio ${round0(avg('act', rows))} kcal/día.`);
  const ws = store.weightTrend().filter((x) => x.date >= from);
  if (ws.length >= 2) lines.push(`PESO: de ${ws[0].kg} kg (${ws[0].date}) a ${ws[ws.length - 1].kg} kg (${ws[ws.length - 1].date}); tendencia ${round1(ws[ws.length - 1].trend - ws[0].trend)} kg; ${ws.length} pesajes.`);
  else if (ws.length === 1) lines.push(`PESO: un solo pesaje, ${ws[0].kg} kg.`);
  else lines.push('PESO: sin pesajes en el período.');
  const habs = store.habitsList().filter((h) => h.kind !== 'hours');
  if (habs.length) lines.push(`HÁBITOS (% de días cumplidos): ${habs.map((h) => `${h.name} ${Math.round((rows.filter((r) => (store.day(r.d).habits || {})[h.id]).length / rows.length) * 100)}%`).join(', ')}.`);
  const st = rows.reduce((x, r) => x + r.study, 0);
  if (st > 0) lines.push(`ESTUDIO: ${round1(st)} h en total (${round1(st / rows.length)} h por día).`);
  const top = store.topFoods(days.length, today, 12);
  if (top.length) lines.push(`ALIMENTOS QUE MÁS CALORÍAS APORTAN: ${top.map((f) => `${f.name} (${f.n} veces, ${fmt(f.kcal)} kcal)`).join('; ')}.`);
  const share = store.byMomentShare(days.length, today);
  const totK = Object.values(share).reduce((x, v) => x + v.kcal, 0) || 1;
  lines.push(`REPARTO POR COMIDA: ${Object.entries(share).sort((a, b) => store.momentIndex(a[0]) - store.momentIndex(b[0])).map(([m, v]) => `${store.momentName(m)} ${Math.round((v.kcal / totK) * 100)}%`).join(', ')}.`);
  // detalle diario (o semanal si el período es largo)
  lines.push('');
  if (days.length <= 45) {
    lines.push('DETALLE POR DÍA (fecha: kcal, P/C/G, azúcar, agua ml, gym, balance):');
    for (const r of rows) lines.push(`${r.d}: ${r.items ? `${r.kcal} kcal, ${round0(r.p)}/${round0(r.c)}/${round0(r.f)}, az ${round0(r.s)}, ` : 'sin comidas, '}agua ${r.water}, gym ${r.gym || '-'}${r.bal != null ? `, balance ${r.bal > 0 ? '+' : ''}${r.bal}` : ''}`);
  } else {
    lines.push('DETALLE POR SEMANA (desde lunes: promedio kcal y proteína de días registrados, días de gym):');
    const byW = new Map();
    for (const r of rows) { const w = weekStart(r.d); if (!byW.has(w)) byW.set(w, []); byW.get(w).push(r); }
    for (const [w, rs] of byW) { const l = rs.filter((r) => r.items); lines.push(`${w}: ${l.length ? `${round0(avg('kcal', l))} kcal, P ${round0(avg('p', l))} g` : 'sin registros'}, gym ${rs.filter((r) => r.gym === 'fui').length}`); }
  }
  return { text: lines.join('\n'), from, to: today, daysLogged: logged.length, days: days.length };
}

const SCHEMA = {
  type: 'object',
  properties: {
    titulo: { type: 'string' }, puntaje: { type: 'number', description: '0 a 10' }, resumen: { type: 'string' },
    bien: { type: 'array', items: { type: 'string' } }, mal: { type: 'array', items: { type: 'string' } },
    mejorar: { type: 'array', items: { type: 'string' } }, evitar: { type: 'array', items: { type: 'string' } },
    cambiar: { type: 'array', items: { type: 'string' }, description: 'Reemplazos concretos: qué cambiar por qué' },
    proximo_paso: { type: 'string' },
  },
  required: ['titulo', 'puntaje', 'resumen', 'bien', 'mal', 'mejorar', 'cambiar', 'evitar', 'proximo_paso'],
};
const PROMPT = `Sos un nutricionista deportivo y coach que revisa el registro de una persona (Argentina, español rioplatense, tono cálido y directo, tuteo con "vos").
Con el resumen numérico del período, evaluá cómo va respecto de SU objetivo. Basate solo en los datos; si hay pocos días registrados, decilo y bajá la confianza.
- bien: 2 a 4 cosas concretas que hace bien, con números ("Promediaste 128 g de proteína, por encima de tu meta").
- mal: 2 a 4 problemas concretos con números.
- mejorar: 3 a 5 acciones simples y específicas para la semana que viene (alimentos argentinos comunes, cantidades).
- cambiar: 2 a 4 reemplazos concretos mirando sus alimentos reales ("Cambiá la gaseosa común de la cena por la versión sin azúcar: −210 kcal", "En vez de 3 bollos de pan francés, 1 bollo y una porción de ensalada").
- evitar: 2 a 4 cosas puntuales a evitar, mirando los alimentos y horarios que más pesan.
- puntaje: 0 a 10 según qué tan alineado está con su objetivo. titulo: frase corta. resumen: 2 o 3 frases. proximo_paso: la UNA acción más importante.
No des consejos médicos; si ves algo preocupante (comer muy poco, bajar muy rápido) sugerí consultar a un profesional. Respondé solo el JSON.`;

export async function runInsights(rangeKey, onStatus, custom = null) {
  const sum = buildSummary(rangeKey, custom);
  if (sum.daysLogged < 2) throw new Error(`Hacen falta al menos 2 días completos con comidas registradas en el período${store.entriesOn(todayISO()).length && !store.dayComplete(todayISO()) ? ' (hoy cuenta cuando termine el día)' : ''}.`);
  const ai = store.S().settings.ai;
  const label = custom?.label || RANGES[rangeKey]?.[0] || 'Período';
  const res = await AI.callGemini({ ai, system: PROMPT, parts: [{ text: `${label.toUpperCase()}\n${sum.text}` }], web: false, schema: SCHEMA, onStatus });
  const r = res.raw || {};
  const rep = {
    id: `in${Date.now()}`, at: Date.now(), range: rangeKey, label: custom?.label || '', from: sum.from, to: sum.to, days: sum.daysLogged, model: res.model,
    titulo: String(r.titulo || 'Tu progreso'), puntaje: Math.max(0, Math.min(10, Number(r.puntaje) || 0)), resumen: String(r.resumen || ''),
    bien: (r.bien || []).map(String).slice(0, 5), mal: (r.mal || []).map(String).slice(0, 5), mejorar: (r.mejorar || []).map(String).slice(0, 6), cambiar: (r.cambiar || []).map(String).slice(0, 5), evitar: (r.evitar || []).map(String).slice(0, 5),
    proximo: String(r.proximo_paso || ''),
  };
  const S = store.S();
  S.insights = [rep, ...(S.insights || [])].slice(0, 8);
  store.commit('insights');
  return rep;
}

export function reportHtml(r, { compact = false } = {}) {
  const sec = (title, ic, cls, arr) => (arr.length ? `<h3 class="sub-h ${cls}" style="display:flex;gap:6px;align-items:center">${icon(ic, 18)}${title}</h3><ul class="ins-list">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
  return `<div class="ins-head"><div class="ins-score"><b>${fmt(r.puntaje, r.puntaje % 1 ? 1 : 0)}</b><small>de 10</small></div><div><h3 style="margin:0">${esc(r.titulo)}</h3><p class="muted" style="margin:4px 0 0;font-size:13px">${esc(RANGES[r.range]?.[0] || r.label || '')} · ${esc(cap(fmtDayShort(r.from)))} a ${esc(fmtDayShort(r.to))} · ${r.days} días registrados</p></div></div>
    <p style="margin:12px 0 0">${esc(r.resumen)}</p>
    ${r.proximo ? `<div class="banner info" style="margin-top:12px">${icon('bolt', 20)}<div class="grow"><b>Próximo paso:</b> ${esc(r.proximo)}</div></div>` : ''}
    ${compact ? '' : sec('Lo que va bien', 'check', 'ok', r.bien)}${sec('Lo que va mal', 'alert', 'bad', r.mal)}${sec('Qué mejorar', 'bolt', '', r.mejorar)}${sec('Qué cambiar', 'repeat', '', r.cambiar || [])}${sec('Qué evitar', 'x', 'bad', r.evitar)}
    <p class="note" style="margin-top:14px">Análisis automático con IA a partir de tus registros: es orientativo y no reemplaza a un profesional.</p>`;
}

export async function openInsights() {
  const S = store.S();
  if (!S.settings.ai.key) { toast('Primero cargá tu clave de Gemini en Ajustes → Inteligencia artificial', { kind: 'error', ms: 5000 }); return; }
  const range = await pickOption({ title: '¿Qué período analizo?', value: S.settings.ui.insightRange || 'mes', options: Object.entries(RANGES).map(([value, [label]]) => ({ value, label, icon: 'calendar' })) });
  if (!range) return;
  S.settings.ui.insightRange = range;
  const s = openSheet({ title: 'Análisis de tu progreso', full: true, body: `<div class="status-line"><span class="spin"></span><span id="ins-st">Juntando tus datos…</span></div>` });
  try {
    const rep = await runInsights(range, (m) => { const el = s.body.querySelector('#ins-st'); if (el) el.textContent = m; });
    if (!s.closed) s.setBody(reportHtml(rep));
  } catch (e) {
    if (!s.closed) s.setBody(`<div class="banner">${icon('alert', 20)}<div class="grow"><b>${esc(e.message || 'No se pudo analizar')}</b></div></div>`);
  }
}

export function openInsight(id) {
  const r = (store.S().insights || []).find((x) => x.id === id);
  if (r) openSheet({ title: 'Análisis de tu progreso', full: true, body: reportHtml(r) });
}

export function insightsCard() {
  const last = (store.S().insights || [])[0];
  return `<section class="panel" style="margin-bottom:12px">
    <div class="kv"><span>${icon('sparkle', 18)}¿Cómo vengo?</span>${last ? `<button class="link" data-act="insight-open" data-id="${last.id}">Último: ${fmt(last.puntaje, last.puntaje % 1 ? 1 : 0)}/10 · ${esc(fmtDayShort(new Date(last.at).toLocaleDateString('sv-SE')))}</button>` : ''}</div>
    <p class="note" style="margin:6px 0 10px">La IA revisa tus registros y te dice qué va bien, qué va mal, qué mejorar y qué evitar.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" style="flex:1 1 140px" data-act="weekly-ask">${icon('calendar', 18)} Resumen semanal</button><button class="btn primary" style="flex:1 1 140px" data-act="insight-run">${icon('sparkle', 18)} Analizar con IA</button></div>
  </section>`;
}
