// ApexTrack — Perfil y metas: a mano, calculadas con tus datos, o contándoselo a la IA.
import { todayISO, esc, fmt, round1, parseNum } from './util.js';
import * as store from './store.js';
import * as AI from './ai.js';
import * as EN from './energy.js';
import { icon } from './icons.js';
import { openSheet, toast, setBusy } from './ui.js';
import { canDictate, startDictation } from './voice.js';

const applyTargetsTo = (st, t) => { Object.assign(st, { kcal: t.kcal, p: t.p, c: t.c, f: t.f, sugarMax: t.sugarMax, waterMl: t.waterMl }); };
const dataOkOf = (st) => Number(st.weightKg) > 25 && Number(st.heightCm) > 100;
const refTargets = (st) => EN.calcTargets({ sex: st.sex, age: st.birthYear ? new Date().getFullYear() - Number(st.birthYear) : 30, cm: Number(st.heightCm), kg: Number(st.weightKg), level: st.level || 'moderado', goal: st.goal || 'mantener', gymDays: Number(st.gymDays) || 0, goalKg: Number(st.goalWeight) || null, weeks: Number(st.goalWeeks) || null, rateKgMonth: Number(st.rateKgMonth) || null, diet: st.diet || '', conditions: st.conditions || [], proteinPerKg: Number(st.proteinPerKg) || null, proteinG: Number(st.proteinG) || null, carbsMax: Number(st.carbsMax) || null });

/** Estado editable del perfil a partir de lo guardado. */
export function profileState() {
  const S = store.S();
  const p = { ...S.settings.profile };
  const g = { ...S.settings.goals };
  return {
    name: p.name || '', sex: p.sex || 'm', birthYear: p.birthYear || '', heightCm: p.heightCm || '', weightKg: store.latestWeight()?.kg || p.weightKg || '',
    goalWeight: p.goalWeight || '', goalWeeks: p.goalWeeks || '', rateKgMonth: p.rateKgMonth || '', level: p.level || '',
    diet: p.diet || '', conditions: Array.isArray(p.conditions) ? [...p.conditions] : [], proteinPerKg: p.proteinPerKg || '', proteinG: p.proteinG || '', carbsMax: p.carbsMax || '', preferences: '', goal: p.goal || '', gymDays: g.gymDays ?? 3, rawGrains: p.rawGrains !== false,
    kcal: g.kcal, p: g.p, c: g.c, f: g.f, sugarMax: g.sugarMax || '', waterMl: g.waterMl || 2500,
    aiText: '', explanation: '', dict: null,
  };
}

/**
 * Pasa lo que entendió la IA a los datos de la persona. Las metas NO las inventa la IA: las calcula la app
 * con la fórmula (calcTargets), así son coherentes y la suma de los macros da exactamente las calorías.
 */
export function mergePlan(st, r) {
  if (r.sex === 'm' || r.sex === 'f') st.sex = r.sex;
  if (r.age > 10 && r.age < 100) st.birthYear = new Date().getFullYear() - Math.round(r.age);
  if (r.heightCm > 100 && r.heightCm < 230) st.heightCm = Math.round(r.heightCm);
  if (r.weightKg > 25 && r.weightKg < 300) st.weightKg = round1(r.weightKg);
  if (r.goalWeightKg > 25 && r.goalWeightKg < 300) st.goalWeight = round1(r.goalWeightKg);
  st.goalWeeks = r.weeks > 0 && r.weeks < 520 ? Math.round(r.weeks) : '';
  st.rateKgMonth = r.rateKgMonth > 0 && r.rateKgMonth < 20 ? round1(r.rateKgMonth) : '';
  if (EN.LEVELS[r.level]) st.level = r.level;
  if (EN.DIETS[r.diet]) st.diet = r.diet;
  if (Array.isArray(r.conditions)) st.conditions = r.conditions.filter((c) => EN.CONDITIONS[c]);
  st.proteinPerKg = r.proteinPerKg > 0.6 && r.proteinPerKg < 3.5 ? Math.round(r.proteinPerKg * 10) / 10 : '';
  st.proteinG = r.proteinG > 30 && r.proteinG < 400 ? Math.round(r.proteinG) : '';
  st.carbsMax = r.carbsMax > 0 && r.carbsMax < 800 ? Math.round(r.carbsMax) : '';
  st.preferences = typeof r.preferences === 'string' ? r.preferences.trim().slice(0, 300) : '';
  if (EN.GOALS[r.goal]) st.goal = r.goal;
  if (r.gymDays >= 0 && r.gymDays <= 7) st.gymDays = Math.round(r.gymDays);
  const extra = [];
  if (r.missing?.length) extra.push(`Supuse ${r.missing.join(', ')}: si no es así, corregilo en Perfil y metas.`);
  if (r.caution) extra.push(String(r.caution));
  if (dataOkOf(st)) {
    const t = refTargets(st);
    if (EN.GOALS[t.goal]) st.goal = t.goal;
    applyTargetsTo(st, t);
    st.explanation = [r.explanation ? `Entendí: ${String(r.explanation).trim().replace(/\.$/, '')}.` : '', t.explain, ...extra].filter(Boolean).join('\n');
  } else {
    // sin altura o peso no hay fórmula: se usan los números de la IA, pero cuadrados
    const p = Math.round(r.protein) || 100; const f = Math.round(r.fat) || 50; const c = Math.max(0, Math.round(r.carbs) || 150);
    applyTargetsTo(st, { kcal: p * 4 + c * 4 + f * 9, p, c, f, sugarMax: Math.round((p * 4 + c * 4 + f * 9) * 0.1 / 4), waterMl: Math.round((r.waterMl || 2500) / 250) * 250 });
    st.explanation = [r.explanation || '', 'Contame tu altura y tu peso para calcularlo mejor.', ...extra].join(' ').trim();
  }
  return st;
}

/** Ajusta los carbohidratos para que proteína + carbohidratos + grasas den las calorías. */
export function squareMacros(st) {
  const k = Number(st.kcal) || 0; const p = Number(st.p) || 0; const f = Number(st.f) || 0;
  const c = Math.round((k - p * 4 - f * 9) / 4);
  if (c >= 0) st.c = c; else { st.c = 0; st.kcal = p * 4 + f * 9; }
  return st;
}

/** Guarda el perfil y las metas. */
export function saveProfile(st) {
  const S = store.S();
  const P = S.settings.profile; const G = S.settings.goals;
  P.name = String(st.name || '').trim();
  P.sex = st.sex === 'f' ? 'f' : 'm';
  P.birthYear = Number(st.birthYear) > 1900 ? Math.round(st.birthYear) : null;
  if (Number(st.heightCm) >= 100 && Number(st.heightCm) <= 250) P.heightCm = Math.round(st.heightCm);
  P.goalWeight = Number(st.goalWeight) >= 25 && Number(st.goalWeight) <= 300 ? round1(st.goalWeight) : null;
  P.goalWeeks = P.goalWeight && Number(st.goalWeeks) > 0 ? Math.round(st.goalWeeks) : null;
  P.rateKgMonth = Number(st.rateKgMonth) > 0 ? round1(st.rateKgMonth) : null;
  P.diet = EN.DIETS[st.diet] ? st.diet : '';
  P.conditions = (st.conditions || []).filter((c) => EN.CONDITIONS[c]);
  P.proteinPerKg = Number(st.proteinPerKg) > 0 ? Math.round(st.proteinPerKg * 10) / 10 : null;
  P.proteinG = Number(st.proteinG) > 0 ? Math.round(st.proteinG) : null;
  P.carbsMax = Number(st.carbsMax) > 0 ? Math.round(st.carbsMax) : null;
  // gustos, dieta y salud: los usa la IA al analizar comidas y al sugerir qué comer
  const A = S.settings.ai;
  const lines = [];
  if (P.diet && P.diet !== 'omnivora') lines.push(`Dieta: ${EN.DIETS[P.diet]}.`);
  if (P.conditions.length) lines.push(`Salud: ${P.conditions.map((c) => EN.CONDITIONS[c]).join(', ')}.`);
  if (st.preferences) lines.push(st.preferences);
  const old = String(A.notes || '').split('\n').filter((l) => !/^(Dieta|Salud): /.test(l) && l.trim() && l.trim() !== String(st.preferences || '').trim());
  A.notes = [...lines, ...old].join('\n').slice(0, 800);
  P.level = EN.LEVELS[st.level] ? st.level : '';
  P.goal = EN.GOALS[st.goal] ? st.goal : '';
  P.rawGrains = !!st.rawGrains;
  const kg = Number(st.weightKg);
  if (kg >= 25 && kg <= 300) { P.weightKg = round1(kg); if (store.latestWeight()?.kg !== round1(kg)) store.upsertBody(todayISO(), { weight: round1(kg) }); }
  for (const key of ['kcal', 'p', 'c', 'f', 'sugarMax', 'waterMl']) if (Number(st[key]) >= 0 && st[key] !== '') G[key] = Math.round(Number(st[key]));
  if (Number(st.gymDays) >= 0 && Number(st.gymDays) <= 7) G.gymDays = Math.round(st.gymDays);
  store.commit('metas');
}

export function openGoals() {
  const S = store.S();
  const st = profileState();
  const chips = (key, opts) => `<div class="chip-row wrap">${opts.map(([v, l]) => `<button class="chip ${String(st[key]) === String(v) ? 'on' : ''}" data-ch="${key}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
  const num = (key, label, suffix = '', ph = '') => `<label class="field"><span>${esc(label)}</span><div class="input-wrap"><input class="input" data-n="${key}" inputmode="decimal" value="${st[key] === '' || st[key] == null ? '' : String(st[key]).replace('.', ',')}" placeholder="${esc(ph)}">${suffix ? `<em>${esc(suffix)}</em>` : ''}</div></label>`;
  const sumLine = () => {
    const k = (Number(st.p) || 0) * 4 + (Number(st.c) || 0) * 4 + (Number(st.f) || 0) * 9;
    const off = st.kcal && Math.abs(k - st.kcal) > 10;
    return `Proteína ${fmt((Number(st.p) || 0) * 4)} + carbohidratos ${fmt((Number(st.c) || 0) * 4)} + grasas ${fmt((Number(st.f) || 0) * 9)} = <b>${fmt(k)}</b> kcal${st.kcal ? ` (meta ${fmt(st.kcal)})` : ''}.${off ? ' <button class="link" data-x="square">Cuadrar con los carbohidratos</button>' : ' ✓'}`;
  };
  const draw = () => `
    <div class="goal-ai panel" style="box-shadow:none;background:var(--surface-2)">
      <h3 class="sub-h" style="margin-top:0">${icon('sparkle', 16)} Contale a la IA y arma tus metas</h3>
      <div class="composer"><textarea class="input" id="g-ai" rows="4" placeholder="Ej.: Soy mujer, tengo 34 años, mido 1,62 y peso 70 kg. Voy al gimnasio 3 veces por semana y quiero bajar grasa sin perder músculo.">${esc(st.aiText)}</textarea>
      ${canDictate() ? `<button class="mic-big ${st.dict ? 'rec' : ''}" data-x="mic" aria-label="Dictar">${icon(st.dict ? 'stop' : 'mic', 22)}</button>` : ''}</div>
      <button class="btn primary" style="width:100%;margin-top:10px" data-x="ai">${icon('sparkle', 18)} Calcular con IA</button>
      ${st.explanation ? `<div class="banner info" style="margin:12px 0 0">${icon('info', 20)}<div class="grow" style="white-space:pre-line">${esc(st.explanation)}</div></div>` : ''}
    </div>
    <h3 class="sub-h">Tus datos</h3>
    <label class="field"><span>Nombre</span><input class="input" data-t="name" value="${esc(st.name)}"></label>
    <div class="field"><span>Sexo</span>${chips('sex', [['m', 'Hombre'], ['f', 'Mujer']])}</div>
    <div class="form-grid">
      ${num('birthYear', 'Año de nacimiento', '', '1995')}
      ${num('heightCm', 'Altura', 'cm', '170')}
      ${num('weightKg', 'Peso actual', 'kg', '70')}
      ${num('goalWeight', 'Peso objetivo', 'kg', 'opcional')}
      ${num('goalWeeks', '¿En cuántas semanas?', 'sem', 'opcional')}
    </div>
    <div class="field"><span>Actividad habitual</span>${chips('level', Object.entries(EN.LEVELS).map(([k, v]) => [k, v.label]))}</div>
    <div class="field"><span>Objetivo</span>${chips('goal', Object.entries(EN.GOALS).map(([k, v]) => [k, v.label]))}</div>
    <div class="form-grid">${num('gymDays', 'Días de gimnasio por semana', '', '3')}</div>
    <h3 class="sub-h">Dieta y salud</h3>
    <div class="field"><span>Forma de comer</span>${chips('diet', Object.entries(EN.DIETS))}</div>
    <div class="field"><span>Algo de salud a tener en cuenta</span><div class="chip-row wrap">${Object.entries(EN.CONDITIONS).map(([k, l]) => `<button class="chip ${(st.conditions || []).includes(k) ? 'on' : ''}" data-mc="${k}">${esc(l)}</button>`).join('')}</div></div>
    <div class="form-grid">
      ${num('proteinPerKg', 'Proteína que querés', 'g/kg', 'automática')}
      ${num('carbsMax', 'Máximo de carbohidratos', 'g', 'sin tope')}
    </div>
    <p class="note">Si lo dejás vacío, la app usa lo recomendado para tu objetivo. Con condiciones de salud, las metas se ajustan solas y te explica por qué.</p>
    <button class="set-row-btn" data-x="raw" style="padding-left:0;padding-right:0">${icon('info', 20)}<span class="grow">Peso el arroz y los fideos en crudo<small>Así la IA interpreta "200 g de arroz" como arroz seco</small></span><span class="switch ${st.rawGrains ? 'on' : ''}"></span></button>
    <button class="btn" style="width:100%;margin-top:6px" data-x="calc">${icon('bolt', 18)} Calcular metas con estos datos</button>
    <h3 class="sub-h">Metas diarias</h3>
    <div class="form-grid">
      ${num('kcal', 'Calorías', 'kcal')}${num('p', 'Proteína', 'g')}${num('c', 'Carbohidratos', 'g')}${num('f', 'Grasas', 'g')}${num('sugarMax', 'Azúcares máx.', 'g')}${num('waterMl', 'Agua', 'ml')}
    </div>
    <p class="note" id="g-sum">${sumLine()}</p>`;
  const s = openSheet({ title: 'Perfil y metas', full: true, body: draw(), footer: '<button class="btn ghost" data-x="cancel">Cancelar</button><button class="btn primary" data-x="save">Guardar</button>' });
  const redraw = () => { const y = s.body.scrollTop; s.setBody(draw()); s.body.scrollTop = y; };
  const stopDict = () => { if (st.dict) { st.dict.stop(); st.dict = null; } };
  s.done.then(stopDict);
  s.body.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'g-ai') st.aiText = el.value;
    else if (el.dataset.t) st[el.dataset.t] = el.value;
    else if (el.dataset.n) { if (el.dataset.n === 'proteinPerKg') st.proteinG = ''; const v = parseNum(el.value); st[el.dataset.n] = el.value.trim() === '' ? '' : (Number.isFinite(v) ? v : st[el.dataset.n]); const sm = s.body.querySelector('#g-sum'); if (sm) sm.innerHTML = sumLine(); }
  });
  const applyTargets = (t) => applyTargetsTo(st, t);
  const dataOk = () => dataOkOf(st);
  const handler = async (e) => {
    const b = e.target.closest('[data-x], [data-ch], [data-mc]');
    if (!b) return;
    if (b.dataset.ch) { st[b.dataset.ch] = st[b.dataset.ch] === b.dataset.v && b.dataset.ch === 'diet' ? '' : b.dataset.v; redraw(); return; }
    if (b.dataset.mc) { const k = b.dataset.mc; st.conditions = (st.conditions || []).includes(k) ? st.conditions.filter((x) => x !== k) : [...(st.conditions || []), k]; redraw(); return; }
    const k = b.dataset.x;
    if (k === 'cancel') s.close();
    else if (k === 'square') { squareMacros(st); redraw(); }
    else if (k === 'raw') { st.rawGrains = !st.rawGrains; b.querySelector('.switch').classList.toggle('on', st.rawGrains); }
    else if (k === 'mic') {
      if (st.dict) { stopDict(); redraw(); return; }
      const base = st.aiText ? st.aiText + ' ' : '';
      st.dict = startDictation({ onText: (fin, interim) => { st.aiText = (base + fin + (interim ? ' ' + interim : '')).trim(); const ta = s.body.querySelector('#g-ai'); if (ta) ta.value = st.aiText; }, onState: (x) => { if (x !== 'escuchando') { st.dict = null; } } });
      redraw();
    } else if (k === 'calc') {
      if (!dataOk()) { toast('Completá al menos altura y peso'); return; }
      const t = refTargets(st);
      if (t.goal !== st.goal && EN.GOALS[t.goal]) st.goal = t.goal;
      applyTargets(t);
      st.explanation = t.explain;
      redraw();
      s.body.querySelector('#g-sum')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (k === 'ai') {
      stopDict();
      const text = (st.aiText || '').trim();
      if (text.length < 10) { toast('Contá tus datos y qué querés lograr'); return; }
      if (!S.settings.ai.key) { toast('Primero cargá tu clave de Gemini en Ajustes → Inteligencia artificial', { kind: 'error', ms: 5000 }); return; }
      setBusy(b, true, 'Calculando…');
      try {
        const r = await AI.planGoals(text, { onStatus: (m) => { b.innerHTML = `<span class="spin"></span><span>${esc(m)}</span>`; } });
        if (!r || !EN.GOALS[r.goal] || !(r.sex === 'm' || r.sex === 'f')) throw new Error('No pude entender tus datos: contá tu edad, altura, peso y qué querés lograr.');
        mergePlan(st, r);
        redraw();
        toast('Metas calculadas: revisalas y tocá Guardar');
      } catch (err) {
        setBusy(b, false);
        toast(err.message || 'No se pudo calcular', { kind: 'error', ms: 5000 });
      }
    } else if (k === 'save') {
      const sum0 = (Number(st.p) || 0) * 4 + (Number(st.c) || 0) * 4 + (Number(st.f) || 0) * 9;
      const squared = st.kcal && Math.abs(sum0 - st.kcal) > Math.max(20, st.kcal * 0.02);
      if (squared) squareMacros(st);
      saveProfile(st);
      s.close();
      const G = S.settings.goals;
      const sum = G.p * 4 + G.c * 4 + G.f * 9;
      toast(squared ? `Guardado. Ajusté los carbohidratos a ${fmt(G.c)} g para que los macros sumen ${fmt(sum)} kcal.` : 'Perfil y metas guardados', { ms: 5000 });
    }
  };
  s.body.addEventListener('click', handler);
  s.foot.addEventListener('click', handler);
  return s.done;
}
