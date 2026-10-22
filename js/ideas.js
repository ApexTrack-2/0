// ApexTrack — "¿Qué como ahora?": sugerencias para lo que falta del día.
// · De tu historial: comidas que ya hiciste y encajan con lo que te queda (sin IA).
// · Ideas nuevas con tu biblioteca: combinaciones armadas por la app, con porciones a medida (sin IA).
// · Ideas de la IA: propuestas de Gemini con tus alimentos habituales y otras que nunca comiste.
import { todayISO, addDays, fmt, round0, round1, esc, norm, uid } from './util.js';
import * as store from './store.js';
import * as AI from './ai.js';
import * as EN from './energy.js';
import { getFood, per100Of, gramsFor, foodUnits, portionText } from './foods.js';
import { icon } from './icons.js';
import { openSheet, toast, pickOption } from './ui.js';

const ui = { moment: null, ai: null, aiBusy: false, wish: '', lib: 0 };

// ---------------------------------------------------------------------------
// Lo que queda del día
// ---------------------------------------------------------------------------
export function remaining(date = todayISO()) {
  const g = store.goals(); const t = store.dayTotals(date);
  const later = store.moments().filter((m) => m.h && store.momentIndex(m.id) >= store.momentIndex(store.momentForTime()) && !store.entriesOn(date).some((e) => e.moment === m.id));
  const meals = Math.max(1, later.filter((m) => !/media|post|pre/.test(m.id)).length || 1);
  const left = { kcal: Math.max(0, g.kcal - t.kcal), p: Math.max(0, g.p - t.p), c: Math.max(0, g.c - t.c), f: Math.max(0, g.f - t.f) };
  // una sola comida no debería cargar con todo lo que faltó del día: tope del 40 % de la meta
  const per = { kcal: Math.max(150, Math.min(left.kcal / meals, g.kcal * 0.4)), p: Math.max(10, Math.min(left.p / meals, g.p * 0.45)) };
  return { g, t, left, meals, per };
}

/** Qué tan bien encaja una comida con lo que conviene ahora (más bajo = mejor). */
function fit(m, per) {
  const k = Math.abs(m.kcal - per.kcal) / Math.max(150, per.kcal);
  const p = Math.max(0, per.p - m.p) / Math.max(10, per.p);
  return k + p * 0.8;
}

// ---------------------------------------------------------------------------
// 1) Del historial
// ---------------------------------------------------------------------------
export function fromHistory(moment, per, limit = 4) {
  const today = todayISO();
  const from = addDays(today, -60);
  const seen = new Set();
  const out = [];
  const sameKind = (m) => (/desayuno|merienda|media/.test(moment) ? /desayuno|merienda|media/.test(m) : /almuerzo|cena|post|pre/.test(m));
  for (const e of [...store.S().entries].reverse()) {
    if (e.date < from || e.date >= today || !(e.items || []).length || !sameKind(e.moment)) continue;
    const key = e.items.map((i) => norm(i.name)).sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const m = store.entryMacros(e);
    if (m.kcal < 80) continue;
    out.push({ id: e.id, title: e.items.map((i) => i.name).slice(0, 3).join(', ') + (e.items.length > 3 ? '…' : ''), items: e.items, m, when: e.date, moment: e.moment, score: fit(m, per) });
  }
  return out.sort((a, b) => a.score - b.score).slice(0, limit);
}

// ---------------------------------------------------------------------------
// 2) Ideas nuevas con la biblioteca (porciones a medida)
// ---------------------------------------------------------------------------
const TEMPLATES = {
  liviana: [
    ['Yogur griego con avena, banana y chía', [['yogur_griego', 170], ['avena', 30], ['banana', 100], ['chia', 10]]],
    ['Tostadas con huevo revuelto y tomate', [['pan_integral', 60], ['huevo_revuelto', 120], ['tomate', 80]]],
    ['Licuado proteico con banana y leche', [['proteina_polvo', 30], ['leche_descremada', 300], ['banana', 100]]],
    ['Ricota con frutillas y miel', [['ricota', 150], ['frutillas', 150], ['miel', 10]]],
    ['Tostadas de pan integral con palta y huevo', [['pan_integral', 60], ['palta', 50], ['huevo', 100]]],
    ['Avena cocida con manzana, canela y nueces', [['avena', 50], ['leche_descremada', 200], ['manzana', 120], ['nueces', 15], ['canela', 2]]],
    ['Galletas de arroz con queso untable y jamón cocido', [['galletas_arroz', 30], ['queso_untable', 40], ['jamon_cocido', 40]]],
  ],
  principal: [
    ['Pollo a la plancha con arroz y ensalada', [['pechuga', 170], ['arroz_cocido', 180], ['lechuga', 60], ['tomate', 100], ['aceite_oliva', 7]]],
    ['Merluza al horno con puré de zapallo', [['merluza', 200], ['zapallo', 250], ['aceite_oliva', 7], ['espinaca', 60]]],
    ['Bife con batata al horno y brócoli', [['bife', 170], ['batata', 200], ['brocoli', 120], ['aceite_oliva', 5]]],
    ['Fideos con atún, tomate y espinaca', [['fideos_cocidos', 220], ['atun_natural', 120], ['pure_tomate', 100], ['espinaca', 60]]],
    ['Ensalada de lentejas, huevo y verduras', [['lentejas', 200], ['huevo', 100], ['tomate', 100], ['zanahoria', 60], ['aceite_oliva', 7]]],
    ['Wok de carne magra con arroz y verduras', [['carne_picada_magra', 150], ['arroz_cocido', 160], ['morron', 80], ['zapallito', 120], ['cebolla', 60], ['aceite', 7]]],
    ['Salmón con papas al horno y ensalada', [['salmon', 150], ['papas_horno', 180], ['lechuga', 60], ['pepino', 80]]],
    ['Tortilla de claras y huevo con ensalada y pan', [['clara', 132], ['huevo', 100], ['espinaca', 60], ['tomate', 100], ['pan_integral', 40]]],
  ],
};
export function fromLibrary(moment, per, { offset = 0, limit = 3 } = {}) {
  const kind = /desayuno|merienda|media/.test(moment) ? 'liviana' : 'principal';
  const histNames = new Set(store.historyFoods({ limit: 200, days: 120 }).map((h) => h.key));
  const opts = [];
  for (const [title, parts] of TEMPLATES[kind]) {
    const foods = parts.map(([id, g]) => ({ f: getFood(id), g })).filter((x) => x.f);
    if (foods.length !== parts.length) continue;
    const base = foods.reduce((a, x) => a + (x.f.k * x.g) / 100, 0);
    const k = Math.max(0.6, Math.min(1.6, per.kcal / base));
    const items = foods.map(({ f, g }) => {
      const grams = Math.max(5, Math.round((g * (f.cat === 'verduras' || f.id === 'canela' ? 1 : k)) / 5) * 5);
      return { id: uid('i'), name: f.n, foodId: f.id, qty: grams, unit: f.liq ? 'ml' : 'g', grams, liq: !!f.liq, per100: per100Of(f), basis: 'tabla', confidence: 'alta' };
    });
    if (items.some((it) => AI.fitWarnings(it).some((w) => /^No es|gluten/.test(w)))) continue; // no encaja con su dieta
    const m = store.sumMacros(items.map(store.itemMacros));
    const isNew = foods.some(({ f }) => !histNames.has(norm(f.n)));
    opts.push({ id: `lib${opts.length}`, title, items, m, isNew, score: fit(m, per) - (isNew ? 0.1 : 0) });
  }
  opts.sort((a, b) => a.score - b.score);
  const start = (offset * limit) % Math.max(1, opts.length);
  return [...opts.slice(start), ...opts.slice(0, start)].slice(0, limit);
}

// ---------------------------------------------------------------------------
// 3) Ideas de la IA (historial + nuevas)
// ---------------------------------------------------------------------------
const IDEAS_SCHEMA = {
  type: 'object',
  properties: {
    options: { type: 'array', items: { type: 'object', properties: {
      title: { type: 'string' }, why: { type: 'string' }, isNew: { type: 'boolean' },
      items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, quantity: { type: 'number' }, unit: { type: 'string' }, grams: { type: 'number' }, per100: AI.RESPONSE_SCHEMA.properties.items.items.properties.per100 }, required: ['name', 'grams', 'per100'] } },
    }, required: ['title', 'items'] } },
  },
  required: ['options'],
};
const IDEAS_PROMPT = `Sos nutricionista deportivo en Argentina (español rioplatense, voseo). Proponé comidas concretas para el momento indicado, pensadas para ESTA persona.
- Leé con atención lo que pide o tiene ganas y equilibralo con lo que le falta del día. Ejemplo: si es de noche, le faltan muchas calorías y pide "algo que no sea pesado para dormir bien", elegí comidas densas en calorías pero fáciles de digerir (frutos secos, pasta de maní, yogur, avena, banana, arroz, huevos, leche o licuados), sin frituras, grasas pesadas ni picantes, y repartidas en porciones razonables.
- Respetá SIEMPRE su dieta, sus condiciones de salud y sus gustos o alergias (si es vegetariana, nada de carne; si es celíaca, nada con gluten; con diabetes, poco azúcar y carbohidratos con fibra; con presión alta, poca sal).
- Tené en cuenta la hora: cerca de dormir, nada muy pesado ni con cafeína; antes de entrenar, carbohidratos fáciles; después, proteína.
- Devolvé 4 opciones: 2 con alimentos que suele comer y 2 NUEVAS que no estén en su historial (isNew true), fáciles y con alimentos que se consiguen en Argentina.
- Cada opción: title corto, why (una frase: por qué encaja con lo que pidió y con lo que le falta, con números), items con name, quantity, unit (g, ml, unidad, cda, taza…), grams (peso total) y per100 (kcal, protein, carbs, fat, sugars, fiber por 100 g, coherentes con Atwater).
- Ajustá las porciones para acercarte a las calorías objetivo de esa comida y a la proteína que falta, salvo que pida otra cosa. Respondé solo el JSON.`;

export async function fromAI(moment, rem, wish = '', onStatus = () => {}) {
  const S = store.S();
  const top = store.historyFoods({ limit: 30, days: 60 }).map((h) => h.name);
  const goal = EN.GOALS[EN.goalMode()]?.label || '';
  const text = [
    `Momento: ${store.momentName(moment)}. Hora: ${new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}.`,
    `Objetivo: ${goal}. Metas del día: ${rem.g.kcal} kcal, P ${rem.g.p} g, C ${rem.g.c} g, G ${rem.g.f} g.`,
    `Comido hoy: ${rem.t.kcal} kcal, P ${round0(rem.t.p)} g. Le falta: ${round0(rem.left.kcal)} kcal, P ${round0(rem.left.p)} g, C ${round0(rem.left.c)} g, G ${round0(rem.left.f)} g, en unas ${rem.meals} comidas.`,
    `Objetivo para esta comida: unas ${round0(rem.per.kcal)} kcal y ${round0(rem.per.p)} g de proteína.`,
    `Alimentos que suele comer: ${top.join('; ') || '(sin historial)'}.`,
    S.settings.ai.notes ? `Dieta, salud y gustos de la persona: ${S.settings.ai.notes}` : '',
    S.settings.profile?.conditions?.length ? `Condiciones de salud: ${S.settings.profile.conditions.join(', ')}.` : '',
    S.settings.profile?.diet ? `Forma de comer: ${S.settings.profile.diet}.` : '',
    S.sleep?.wake ? `Se levanta a las ${S.sleep.wake} y duerme unas ${S.sleep.goalH || 8} h (se acuesta cerca de las ${(() => { const [h, m] = S.sleep.wake.split(':').map(Number); const t = (((h * 60 + m - (S.sleep.goalH || 8) * 60) % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; })()}).` : '',
    wish ? `LO QUE PIDE AHORA (prioridad): ${wish}` : '',
  ].filter(Boolean).join('\n');
  const res = await AI.callGemini({ ai: S.settings.ai, system: IDEAS_PROMPT, parts: [{ text }], web: false, schema: IDEAS_SCHEMA, onStatus });
  const ctx = AI.buildContext({ baseMoment: moment });
  const today = todayISO();
  return (res.raw?.options || []).slice(0, 5).map((o, i) => {
    const d = AI.normalizeDraft({ items: (o.items || []).map((it) => ({ ...it, date: today, moment, unit: it.unit || 'g', quantity: it.quantity || it.grams, basis: 'tabla', confidence: 'media' })) }, ctx);
    const items = d.groups.flatMap((g) => g.items);
    return { id: `ai${i}`, title: String(o.title || 'Opción'), why: String(o.why || ''), isNew: !!o.isNew, items, m: store.sumMacros(items.map(store.itemMacros)) };
  }).filter((o) => o.items.length);
}

// ---------------------------------------------------------------------------
// Pantalla (pestaña "Ideas" y hoja desde Hoy)
// ---------------------------------------------------------------------------
const card = (o, src) => `<article class="panel idea" style="margin-top:10px">
  <div class="section-head" style="margin:0 0 4px"><h3 style="font-size:16px">${esc(o.title)}</h3>${o.isNew ? '<span class="badge web">Nueva</span>' : o.when ? `<span class="muted" style="font-size:12.5px">${esc(new Date(o.when + 'T12:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' }))}</span>` : ''}</div>
  ${o.why ? `<p class="note" style="margin:0 0 6px">${esc(o.why)}</p>` : ''}
  <div class="muted" style="font-size:13.5px;line-height:1.5">${o.items.map((it) => `${esc(it.name)} <small>(${esc(portionText(it))})</small>`).join(' · ')}</div>
  ${o.items.flatMap((it) => AI.fitWarnings(it)).slice(0, 2).map((w) => `<div class="flag" style="margin-top:6px">${icon('info', 14)}<span>${esc(w)}</span></div>`).join('')}
  <div style="display:flex;align-items:center;gap:8px;margin-top:10px"><b class="grow">${fmt(o.m.kcal)} kcal · P ${fmt(o.m.p)} g · C ${fmt(o.m.c)} · G ${fmt(o.m.f)}</b><button class="btn small primary" data-idea="add" data-src="${src}" data-id="${esc(o.id)}">${icon('plus', 16)} Agregar</button></div>
</article>`;

const WISHES = ['Liviano para dormir bien', 'Que sume muchas calorías', 'Mucha proteína', 'Rápido, sin cocinar', 'Algo dulce', 'Antes de entrenar', 'Con lo que hay en casa'];
let cache = { hist: [], lib: [], ai: [] };
export function ideasHtml() {
  const moment = ui.moment || store.momentForTime();
  const rem = remaining();
  cache.hist = fromHistory(moment, rem.per);
  cache.lib = fromLibrary(moment, rem.per, { offset: ui.lib });
  cache.ai = ui.ai && ui.ai.moment === moment ? ui.ai.list : [];
  const hasKey = !!store.S().settings.ai.key;
  return `<section class="panel">
      <div class="kv"><span>${icon('clock', 18)}Para</span><button class="weight-btn" data-idea="moment">${esc(store.momentName(moment))}</button></div>
      <div class="kv"><span>${icon('flame', 18)}Te queda hoy</span><b>${fmt(rem.left.kcal)} kcal · P ${fmt(rem.left.p)} g</b></div>
      <div class="kv"><span>${icon('bolt', 18)}Ideal para esta comida</span><b>≈ ${fmt(rem.per.kcal)} kcal · P ${fmt(rem.per.p)} g</b></div>
    </section>
    <div class="section-head"><h3>Ideas de la IA</h3></div>
    ${cache.ai.length ? cache.ai.map((o) => card(o, 'ai')).join('') : `<section class="panel">
      <textarea class="input" id="idea-wish" rows="2" placeholder="Contale qué querés. Ej.: es tarde y me faltan muchas calorías, pero que no sea pesado para dormir bien">${esc(ui.wish)}</textarea>
      <div class="chip-row" style="margin-top:8px">${WISHES.map((w) => `<button class="chip soft" data-idea="wish" data-v="${esc(w)}">${esc(w)}</button>`).join('')}</div>
      <button class="btn primary" style="width:100%;margin-top:10px" data-idea="ai" ${ui.aiBusy ? 'disabled' : ''}>${ui.aiBusy ? '<span class="spin"></span><span>Pensando opciones…</span>' : `${icon('sparkle', 18)} Pedir ideas (de siempre y nuevas)`}</button>
      ${hasKey ? '' : '<p class="note" style="margin:8px 0 0">Necesita tu clave de Gemini (Ajustes → Inteligencia artificial).</p>'}
    </section>`}
    ${cache.ai.length ? `<button class="btn ghost" style="width:100%;margin-top:8px" data-idea="ai-again">${icon('repeat', 18)} Otras ideas de la IA</button>` : ''}
    <div class="section-head"><h3>De tu historial</h3></div>
    ${cache.hist.length ? cache.hist.map((o) => card(o, 'hist')).join('') : '<p class="muted">Cuando registres más comidas, acá aparecen las que mejor encajan.</p>'}
    <div class="section-head"><h3>Ideas nuevas con tu biblioteca</h3><button class="link" data-idea="more-lib">Otras</button></div>
    ${cache.lib.map((o) => card(o, 'lib')).join('')}
    <p class="note" style="margin-top:12px">Las porciones se ajustan a lo que te queda del día. Al agregar, podés editar cada alimento.</p>`;
}

export function renderIdeas() {
  return `<h1 class="view-title">¿Qué como?</h1><div id="ideas-root">${ideasHtml()}</div>`;
}

async function handle(b, redraw) {
  const k = b.dataset.idea;
  const moment = ui.moment || store.momentForTime();
  if (k === 'moment') {
    const v = await pickOption({ title: '¿Para qué comida?', value: moment, options: store.moments().map((m) => ({ value: m.id, label: m.name, icon: 'meal' })) });
    if (v) { ui.moment = v; redraw(); }
  } else if (k === 'more-lib') { ui.lib++; redraw(); }
  else if (k === 'wish') {
    const cur = (document.getElementById('idea-wish')?.value || ui.wish || '').trim();
    ui.wish = cur.includes(b.dataset.v.toLowerCase()) || cur.includes(b.dataset.v) ? cur : [cur, b.dataset.v.toLowerCase()].filter(Boolean).join(', ');
    redraw();
  }
  else if (k === 'ai' || k === 'ai-again') {
    if (!store.S().settings.ai.key) { toast('Cargá tu clave de Gemini en Ajustes → Inteligencia artificial', { kind: 'error', ms: 5000 }); return; }
    ui.wish = (document.getElementById('idea-wish')?.value || ui.wish || '').trim();
    ui.aiBusy = true; ui.ai = null; redraw();
    try {
      const list = await fromAI(moment, remaining(), ui.wish);
      ui.ai = { moment, list };
      if (!list.length) toast('La IA no devolvió opciones: probá de nuevo', { kind: 'error' });
    } catch (e) { toast(e.message || 'No se pudo pedir ideas', { kind: 'error', ms: 6000 }); }
    ui.aiBusy = false; redraw();
  } else if (k === 'add') {
    const o = (cache[b.dataset.src] || []).find((x) => x.id === b.dataset.id);
    if (!o) return;
    const items = o.items.map((it) => { const c = JSON.parse(JSON.stringify(it)); c.id = uid('i'); delete c.flags; return c; });
    store.addItems(todayISO(), moment, items, { source: b.dataset.src === 'ai' ? 'ia' : 'sugerencia' });
    store.commit('sugerencia');
    toast(`Agregado a ${store.momentName(moment).toLowerCase()}: ${fmt(o.m.kcal)} kcal`, { ms: 4000 });
    redraw();
  }
}

/** Hoja "¿Qué como ahora?" (desde Hoy). */
export function openIdeas() {
  ui.moment = null;
  const s = openSheet({ title: '¿Qué como ahora?', full: true, body: ideasHtml() });
  const redraw = () => { if (!s.closed) { const y = s.body.scrollTop; s.setBody(ideasHtml()); s.body.scrollTop = y; } };
  s.body.addEventListener('click', (e) => { const b = e.target.closest('[data-idea]'); if (b) handle(b, redraw); });
  s.body.addEventListener('input', (e) => { if (e.target.id === 'idea-wish') ui.wish = e.target.value; });
}

/** Clics dentro de la pestaña "Ideas". */
export function startIdeas() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#ideas-root [data-idea]');
    if (!b) return;
    handle(b, () => { const r = document.getElementById('ideas-root'); if (r) r.innerHTML = ideasHtml(); });
  });
  document.addEventListener('input', (e) => { if (e.target.id === 'idea-wish' && e.target.closest('#ideas-root')) ui.wish = e.target.value; });
}
export { round1, foodUnits, gramsFor };
