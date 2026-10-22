// ApexTrack — gasto energético estimado (basal + actividad + digestión), actividades del día
// y cálculo de metas a partir de los datos de la persona.
import { todayISO, round0, round1, uid, parseISO } from './util.js';
import * as store from './store.js';

// MET (equivalente metabólico) de actividades comunes — Compendium of Physical Activities
export const ACTS = {
  caminata: { label: 'Caminata', met: 3.5, icon: 'walk' },
  caminata_rapida: { label: 'Caminata rápida', met: 4.8, icon: 'walk' },
  correr: { label: 'Correr', met: 9, icon: 'bolt' },
  bici: { label: 'Bicicleta', met: 7, icon: 'bolt' },
  natacion: { label: 'Natación', met: 7, icon: 'drop' },
  futbol: { label: 'Fútbol', met: 7, icon: 'bolt' },
  tenis: { label: 'Tenis / pádel', met: 7, icon: 'bolt' },
  baile: { label: 'Baile', met: 5, icon: 'bolt' },
  eliptico: { label: 'Elíptico / cinta', met: 5, icon: 'bolt' },
  yoga: { label: 'Yoga / estiramiento', met: 2.5, icon: 'star' },
  pesas: { label: 'Pesas (fuera de la rutina)', met: 5, icon: 'dumbbell' },
  otro: { label: 'Otra actividad', met: 4.5, icon: 'bolt' },
};
export const LEVELS = {
  sedentario: { label: 'Sedentario', sub: 'Trabajo sentado, casi sin ejercicio', f: 1.2 },
  ligero: { label: 'Ligero', sub: 'Ejercicio 1 a 3 días por semana', f: 1.375 },
  moderado: { label: 'Moderado', sub: 'Ejercicio 3 a 5 días por semana', f: 1.55 },
  alto: { label: 'Alto', sub: 'Ejercicio intenso 6 a 7 días o trabajo físico', f: 1.725 },
};
export const GOALS = {
  bajar: { label: 'Bajar de peso', sub: 'Déficit de calorías, cuidando el músculo' },
  recomp: { label: 'Bajar grasa y ganar músculo', sub: 'Déficit chico con mucha proteína' },
  mantener: { label: 'Mantener el peso', sub: 'Comer lo que gastás' },
  subir: { label: 'Subir de peso / masa muscular', sub: 'Superávit moderado' },
};

export function profile() { return store.S().settings.profile; }
export function ageOf(p = profile()) { const y = Number(p.birthYear); return y > 1900 ? Math.max(12, new Date().getFullYear() - y) : 30; }
export function weightOn(date = todayISO()) { return store.latestWeight(date)?.kg || Number(profile().weightKg) || 70; }

/** Metabolismo basal (Mifflin-St Jeor) */
export function bmr({ sex = 'm', kg = 70, cm = 170, age = 30 } = {}) {
  return round0(10 * kg + 6.25 * cm - 5 * age + (sex === 'f' ? -161 : 5));
}

/**
 * Largo del paso (m) según la altura y el sexo: caminando ≈ 41,5 % de la altura (41,3 % en mujeres),
 * corriendo ≈ 65 %. Se usa para pasar de distancia a pasos y al revés.
 */
export function stepLength(type = 'caminata', p = profile()) {
  const h = (Number(p.heightCm) || 170) / 100;
  if (type === 'correr') return h * 0.65;
  return h * (p.sex === 'f' ? 0.413 : 0.415) * (type === 'caminata_rapida' ? 1.07 : 1);
}
const isWalkRun = (type) => type === 'caminata' || type === 'caminata_rapida' || type === 'correr';
/** Pasos de una actividad: los que se cargaron, o calculados desde la distancia. */
export function stepsOf(a) {
  if (Number(a.steps) > 0) return Math.round(Number(a.steps));
  if (Number(a.km) > 0 && isWalkRun(a.type)) return Math.round((Number(a.km) * 1000) / stepLength(a.type));
  return 0;
}
export const stepsEstimated = (a) => !(Number(a.steps) > 0) && stepsOf(a) > 0;

/** Calorías de una actividad (sin contar el basal, que ya está en la cuenta) */
export function actKcal(a, kg) {
  if (Number(a.kcal) > 0 && a.manual) return round0(a.kcal);
  const t = ACTS[a.type] || ACTS.otro;
  const walk = a.type === 'caminata' || a.type === 'caminata_rapida';
  let km = Number(a.km) || 0;
  if (!km && Number(a.steps) > 0 && (walk || a.type === 'correr')) km = (Number(a.steps) * stepLength(a.type)) / 1000;
  if (km > 0 && (walk || a.type === 'correr')) {
    // costo neto aproximado por km: caminar ≈ 0,5 kcal/kg/km; correr ≈ 0,9 kcal/kg/km
    return round0(km * kg * (a.type === 'correr' ? 0.9 : a.type === 'caminata_rapida' ? 0.6 : 0.5));
  }
  const min = Number(a.min) || 0;
  return round0(Math.max(0, t.met - 1) * kg * (min / 60));
}

/** Duración de la sesión de gimnasio del día (min), o 60 si no se sabe */
function gymMinutes(date) {
  const ses = store.S().gym.sessions.filter((s) => s.date === date);
  let min = 0;
  for (const s of ses) if (s.finishedAt && s.startedAt) min += Math.min(150, (s.finishedAt - s.startedAt) / 60000);
  if (!min && store.day(date).gym === 'fui') min = 60;
  return round0(min);
}

/** Gasto del día: basal × 1,2 (vida diaria) + actividades + gimnasio + digestión (10 % de lo comido) */
export function dayEnergy(date = todayISO()) {
  const p = profile();
  const kg = weightOn(date);
  const b = bmr({ sex: p.sex, kg, cm: Number(p.heightCm) || 170, age: ageOf(p) });
  const base = round0(b * 1.2);
  const items = (store.day(date).activity || []).map((a) => ({ ...a, kcal: actKcal(a, kg) }));
  const gmin = gymMinutes(date);
  const gym = gmin ? round0(4 * kg * (gmin / 60)) : 0; // pesas: MET 5 − 1
  const act = items.reduce((x, a) => x + a.kcal, 0) + gym;
  const eaten = store.dayTotals(date).kcal;
  const tef = round0(eaten * 0.1);
  return { kg, bmr: b, base, items, gym, gymMin: gmin, act, tef, eaten, total: base + act + tef, balance: eaten - (base + act + tef) };
}

/** Objetivo: el elegido, o deducido comparando la meta de calorías con el mantenimiento */
export function goalMode() {
  const p = profile();
  if (GOALS[p.goal]) return p.goal;
  const g = store.goals();
  const b = bmr({ sex: p.sex, kg: weightOn(), cm: Number(p.heightCm) || 170, age: ageOf(p) });
  const maint = b * (LEVELS[p.level]?.f || ((g.gymDays || 0) >= 3 ? 1.55 : 1.375));
  if (g.kcal < maint * 0.92) return 'bajar';
  if (g.kcal > maint * 1.08) return 'subir';
  return 'mantener';
}
export const isCut = () => ['bajar', 'recomp'].includes(goalMode());

export const DIETS = {
  omnivora: 'Como de todo', vegetariana: 'Vegetariana', vegana: 'Vegana', carnivora: 'Solo carne (carnívora)', keto: 'Keto',
  low_carb: 'Baja en carbohidratos', mediterranea: 'Mediterránea', alta_proteina: 'Alta en proteína', sin_gluten: 'Sin gluten',
};
export const CONDITIONS = {
  diabetes: 'Diabetes', prediabetes: 'Prediabetes o resistencia a la insulina', hipertension: 'Presión alta', colesterol: 'Colesterol o triglicéridos altos',
  hipotiroidismo: 'Hipotiroidismo', higado_graso: 'Hígado graso', renal: 'Problema renal', gota: 'Ácido úrico alto o gota', celiaquia: 'Celiaquía',
  embarazo: 'Embarazo', lactancia: 'Lactancia', tca: 'Trastorno de la conducta alimentaria',
};

/**
 * Peso de referencia para la proteína y las grasas: con sobrepeso (IMC > 25) no se usa el peso total
 * sino el "peso ajustado" = peso con IMC 25 + 25 % del exceso (criterio usado en nutrición clínica).
 */
export function refWeight(kg, cm) {
  const h = (Number(cm) || 170) / 100;
  const k25 = 25 * h * h;
  return kg > k25 ? k25 + 0.25 * (kg - k25) : kg;
}
export const bmi = (kg, cm) => { const h = (Number(cm) || 170) / 100; return kg / (h * h); };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * Ritmo sano de cambio de peso (kg por semana) según el IMC.
 * - Subir: con bajo peso se puede (y conviene) subir más rápido. Con más peso, subir rápido es casi todo grasa.
 *   IMC < 19: hasta 1 % del peso por semana · 19-22: 0,7 % · 22-25: 0,5 % · > 25: 0,3 % (máximo 0,8 kg).
 * - Bajar: con más exceso de peso se puede bajar más rápido sin perder tanto músculo.
 *   IMC ≥ 30: hasta 1 % por semana · 25-30: 0,75 % · 21-25: 0,6 % · < 21: 0,4 % (máximo 1 kg).
 */
export function maxRate(kg, cm, goal) {
  const B = bmi(kg, cm);
  if (goal === 'subir') return Math.min(0.8, kg * (B < 19 ? 0.01 : B < 22 ? 0.007 : B < 25 ? 0.005 : 0.003));
  return Math.min(1, kg * (B >= 30 ? 0.01 : B >= 25 ? 0.0075 : B >= 21 ? 0.006 : 0.004));
}
/** Músculo que como mucho se puede ganar por mes entrenando fuerza (principiante ≈ 1-1,5 % del peso por mes). */
export const maxMuscleMonth = (kg, trains) => kg * (trains ? 0.0125 : 0.006);
const KCAL_KG_GAIN = 6000; // energía por kg ganado (mezcla de músculo y grasa)
const KCAL_KG_LOSS = 7700; // energía por kg de grasa perdido

/**
 * Metas a partir de los datos (cálculo propio, sin IA). Siempre cierra la cuenta:
 * kcal = 4·proteína + 4·carbohidratos + 9·grasas.
 * - Gasto: Mifflin-St Jeor × nivel de actividad.
 * - Si hay peso objetivo y plazo (o un ritmo, "2 kg por mes"), se usa ese ritmo pero limitado a un rango sano
 *   (maxRate); si no, bajar = déficit del 20 % (300-750 kcal), subir = 60-80 % del ritmo máximo sano.
 *   Recomposición: déficit del 10 %. Nunca menos de 1.200 kcal (mujeres) o 1.500 (hombres).
 * - Proteína por kg de peso de referencia: bajar 1,5 (1,8 si entrena fuerza), recomposición 2,0,
 *   mantener 1,3 (1,6 si entrena), subir 1,8. Máximo 35 % de las calorías.
 * - Grasas: 0,7-0,8 g por kg de referencia, entre el 25 % y el 35 % de las calorías.
 * - Carbohidratos: lo que queda (al menos 20 % de las calorías).
 */
export function calcTargets({ sex = 'm', age = 30, cm = 170, kg = 70, level = 'moderado', goal = 'mantener', gymDays = 3, goalKg = null, weeks = null, rateKgMonth = null, diet = '', conditions = [], proteinPerKg = null, proteinG = null, carbsMax = null } = {}) {
  const b = bmr({ sex, kg, cm, age });
  const cond = new Set(Array.isArray(conditions) ? conditions : []);
  const notes = []; // ajustes por preferencias o salud (se explican)
  const lv = LEVELS[level] ? level : 'moderado';
  const tdee = b * LEVELS[lv].f;
  const trains = (Number(gymDays) || 0) >= 2 || lv === 'moderado' || lv === 'alto';
  // el peso objetivo manda sobre el objetivo dicho ("quiero llegar a 72 kg" = subir)
  if (Number(goalKg) > 25 && (goal === 'mantener' || !GOALS[goal])) goal = goalKg > kg + 1 ? 'subir' : goalKg < kg - 1 ? 'bajar' : 'mantener';
  // ritmo pedido (kg por semana, con signo)
  let req = null;
  if (Number(goalKg) > 25 && Number(weeks) > 0) req = (goalKg - kg) / weeks;
  else if (Number(rateKgMonth) > 0) req = (goal === 'bajar' || goal === 'recomp' ? -1 : 1) * (rateKgMonth / 4.345);
  const top = maxRate(kg, cm, goal);
  const floor = sex === 'f' ? 1200 : 1500;
  let kcal = tdee; let rate = 0; let limited = '';
  if (goal === 'subir') {
    rate = req > 0 ? Math.min(req, top) : top * (bmi(kg, cm) < 19 ? 0.8 : 0.6);
    if (req > top + 0.01) limited = 'rapido';
    rate = Math.max(0.1, rate);
    kcal = tdee + (rate * KCAL_KG_GAIN) / 7;
  } else if (goal === 'bajar') {
    if (req < 0) { rate = Math.min(-req, top); if (-req > top + 0.01) limited = 'rapido'; }
    else rate = (clamp(tdee * 0.2, 300, 750) * 7) / KCAL_KG_LOSS;
    kcal = tdee - (rate * KCAL_KG_LOSS) / 7;
    if (kcal < floor) { kcal = floor; limited = limited || 'minimo'; rate = Math.max(0, ((tdee - floor) * 7) / KCAL_KG_LOSS); }
  } else if (goal === 'recomp') kcal = tdee - clamp(tdee * 0.1, 150, 400);
  // embarazo y lactancia: nunca déficit; trastorno alimentario: como mucho un déficit suave
  if (cond.has('embarazo') || cond.has('lactancia')) {
    kcal = tdee + (cond.has('lactancia') ? 400 : 300); rate = 0; limited = '';
    if (goal === 'bajar' || goal === 'recomp') { goal = 'mantener'; }
    notes.push(`Por ${cond.has('lactancia') ? 'la lactancia' : 'el embarazo'} no se hace déficit: se suman ${cond.has('lactancia') ? 400 : 300} kcal al gasto. Seguí las indicaciones de tu médico/a.`);
  } else if (cond.has('tca') && kcal < tdee * 0.9) { kcal = tdee * 0.9; rate = ((tdee - kcal) * 7) / KCAL_KG_LOSS; notes.push('Por el antecedente de trastorno alimentario, el déficit es suave. Lo ideal es hacerlo con un profesional.'); }
  kcal = Math.max(floor, Math.round(kcal / 10) * 10);
  const ref = refWeight(kg, cm);
  // --- proteína: la que pide la persona (g o g/kg) o la recomendada; con problema renal, baja
  let ppk = { bajar: trains ? 1.8 : 1.5, recomp: 2.0, mantener: trains ? 1.6 : 1.3, subir: 1.8 }[goal] ?? 1.4;
  if (diet === 'alta_proteina') ppk = Math.max(ppk, 2.0);
  if (diet === 'vegetariana' || diet === 'vegana') ppk = Math.round(ppk * 1.1 * 10) / 10; // la proteína vegetal se aprovecha un poco menos
  let pBase = ref;
  let p;
  if (cond.has('renal')) {
    ppk = 0.8; p = Math.round(ref * ppk);
    notes.push(`Por el problema renal la proteína se limita a ${p} g (0,8 g por kg): no la subas sin indicación de tu nefrólogo/a.`);
  } else if (Number(proteinG) > 0 || Number(proteinPerKg) > 0) {
    // lo que pide la persona: g/kg sobre su peso (con IMC alto, sobre el de referencia)
    pBase = bmi(kg, cm) <= 27 || (trains && bmi(kg, cm) <= 30) ? kg : ref; // con IMC 27-30 y entrenando, suele ser músculo
    const want = Number(proteinG) > 0 ? Number(proteinG) : Number(proteinPerKg) * pBase;
    const cap = Math.min(kg * 2.5, (kcal * 0.45) / 4);
    p = Math.round(Math.min(want, cap));
    ppk = Math.round((p / pBase) * 10) / 10;
    if (want > cap + 1) notes.push(`Pediste ${Math.round(want)} g de proteína; lo limité a ${p} g, que es lo máximo razonable para tus calorías.`);
  } else p = Math.round(Math.min(ref * ppk, (kcal * 0.35) / 4));
  if (cond.has('gota') && p > kg * 1.6) { p = Math.round(kg * 1.6); notes.push('Por el ácido úrico alto, la proteína no pasa de 1,6 g por kg y conviene limitar carnes rojas y mariscos.'); }
  // --- carbohidratos: tope por dieta, por lo que pide la persona o por salud
  let cCap = Number(carbsMax) > 0 ? Number(carbsMax) : diet === 'carnivora' ? 30 : diet === 'keto' ? 40 : diet === 'low_carb' ? 100 : null;
  if (cond.has('diabetes') || cond.has('prediabetes')) {
    const lim = Math.round((kcal * (cond.has('diabetes') ? 0.4 : 0.45)) / 4);
    if (cCap == null || lim < cCap) cCap = lim;
    notes.push(`Por ${cond.has('diabetes') ? 'la diabetes' : 'la prediabetes'}: carbohidratos hasta ${cCap} g por día, repartidos en las comidas, con fibra (verduras, legumbres, integrales) y casi sin azúcar. Ajustalo con tu médico/a, sobre todo si usás insulina.`);
  }
  // --- grasas: lo recomendado, o lo que completa las calorías si los carbohidratos tienen tope
  const fatLo = cond.has('colesterol') ? 0.22 : 0.25; const fatHi = cond.has('colesterol') ? 0.3 : diet === 'mediterranea' ? 0.38 : 0.35;
  let f = Math.round(clamp(ref * (goal === 'bajar' ? 0.7 : 0.8), (kcal * fatLo) / 9, (kcal * fatHi) / 9));
  if (diet === 'mediterranea') f = Math.round((kcal * 0.35) / 9);
  let c = Math.round((kcal - p * 4 - f * 9) / 4);
  const askedP = Number(proteinG) > 0 || Number(proteinPerKg) > 0;
  if (cCap != null && c > cCap) {
    // con pocos carbohidratos conviene algo más de proteína (saciedad y músculo), sin pasar del 35 %
    if (!askedP && !cond.has('renal') && !cond.has('gota')) { const p2 = Math.round(Math.min(pBase * Math.max(ppk, 2.0), (kcal * 0.35) / 4)); if (p2 > p) { p = p2; ppk = Math.round((p / pBase) * 10) / 10; } }
    c = Math.round(cCap);
    f = Math.round((kcal - p * 4 - c * 4) / 9);
    const fMax = Math.round((kcal * 0.75) / 9);
    if (f > fMax) { f = fMax; p = Math.round((kcal - c * 4 - f * 9) / 4); }
    if (Number(carbsMax) > 0 || diet === 'keto' || diet === 'carnivora' || diet === 'low_carb') notes.push(`Con un máximo de ${c} g de carbohidratos, las calorías que faltan se cubren con grasas (${f} g)${diet === 'carnivora' ? ', de carnes, huevos y lácteos' : ', mejor de aceite de oliva, palta, frutos secos, huevos y pescados'}.`);
  } else {
    const cMin = Math.round((kcal * 0.2) / 4);
    if (c < cMin) { f = Math.round((kcal * fatLo) / 9); c = Math.round((kcal - p * 4 - f * 9) / 4); }
    if (c < cMin && !(Number(proteinG) > 0 || Number(proteinPerKg) > 0)) { c = cMin; p = Math.round((kcal - c * 4 - f * 9) / 4); }
    if (c < 0) { c = 0; f = Math.round((kcal - p * 4) / 9); }
  }
  if (cond.has('colesterol')) notes.push('Por el colesterol: grasas de oliva, palta, frutos secos y pescado; limitá manteca, fiambres, frituras y carnes grasas.');
  if (cond.has('hipertension')) notes.push('Por la presión: menos de 5 g de sal por día (2 g de sodio): cuidado con fiambres, quesos duros, snacks y caldos.');
  if (cond.has('hipotiroidismo')) notes.push('Con hipotiroidismo el gasto puede ser algo menor que el estimado: si en 3-4 semanas no ves cambios, bajá 100-150 kcal.');
  if (cond.has('higado_graso')) notes.push('Por el hígado graso: casi sin azúcar ni alcohol, y bajar de peso de a poco ayuda mucho.');
  if (cond.has('celiaquia') || diet === 'sin_gluten') notes.push('Sin gluten: la app te avisa si un alimento suele tenerlo (pan, pastas, galletitas comunes).');
  if (diet === 'vegana') notes.push('En una dieta vegana suplementá vitamina B12 y combiná legumbres con cereales para completar la proteína.');
  if (p * 4 + c * 4 + f * 9 < floor) c += Math.ceil((floor - (p * 4 + c * 4 + f * 9)) / 4); // el redondeo no puede bajar del mínimo
  const total = p * 4 + c * 4 + f * 9; // la meta de calorías es exactamente la suma de los macros
  const waterMl = Math.max(2000, Math.round((ref * 35 + (trains ? 500 : 0)) / 250) * 250);
  const sign = goal === 'subir' ? 1 : goal === 'bajar' ? -1 : 0;
  const realRate = sign ? round1(Math.abs(total - tdee) * 7 / (sign > 0 ? KCAL_KG_GAIN : KCAL_KG_LOSS) * 100) / 100 : 0;
  const lowSugar = cond.has('diabetes') || cond.has('prediabetes') || cond.has('higado_graso');
  const out = {
    kcal: total, p, c, f, sugarMax: Math.round((total * (lowSugar ? 0.05 : 0.1)) / 4), waterMl, gymDays, notes, diet, conditions: [...cond],
    pBase: round1(pBase), pAsked: askedP && !cond.has('renal'),
    bmr: b, tdee: round0(tdee), ref: round1(ref), bmi: round1(bmi(kg, cm)), ppk, level: lv, goal, trains,
    rate: realRate, maxRate: Math.round(top * 100) / 100, req: req == null ? null : Math.round(req * 100) / 100, limited,
    goalKg: Number(goalKg) > 25 ? Number(goalKg) : null,
    weeksToGoal: Number(goalKg) > 25 && realRate > 0 ? Math.ceil(Math.abs(goalKg - kg) / realRate) : null,
    muscleMonth: round1(maxMuscleMonth(kg, trains)),
  };
  out.explain = explainTargets(out, { sex, kg });
  return out;
}

/** Explicación en palabras simples (la arma la app, con los números reales). */
export function explainTargets(t, { kg } = {}) {
  const n = (v, d = 0) => Number(v).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const diff = t.kcal - t.tdee;
  const perMonth = (r) => n(r * 4.345, 1);
  const lines = [];
  if (t.goal === 'subir') {
    lines.push(`Gastás unas ${n(t.tdee)} kcal por día. Para subir comés ${n(diff)} kcal más: ${n(t.kcal)} kcal, para subir unos ${n(t.rate, 2)} kg por semana (${perMonth(t.rate)} kg por mes).`);
    if (t.limited === 'rapido') lines.push(`Pediste ${perMonth(t.req)} kg por mes, pero para tu peso lo máximo razonable es ${perMonth(t.maxRate)} kg por mes: entrenando fuerza, como mucho unos ${n(t.muscleMonth, 1)} kg por mes pueden ser músculo; si comés más, lo que sobra se acumula casi todo como grasa.`);
    else lines.push(`Entrenando fuerza, como mucho unos ${n(t.muscleMonth, 1)} kg por mes pueden ser músculo${t.trains ? '' : ' (sin entrenar fuerza, mucho menos)'}: por eso no conviene subir más rápido que ${perMonth(t.maxRate)} kg por mes.`);
  } else if (t.goal === 'bajar') {
    lines.push(`Gastás unas ${n(t.tdee)} kcal por día. Para bajar comés ${n(-diff)} kcal menos: ${n(t.kcal)} kcal, para bajar unos ${n(t.rate, 2)} kg por semana (${perMonth(t.rate)} kg por mes).`);
    if (t.limited === 'rapido') lines.push(`Pediste ${perMonth(-t.req)} kg por mes, pero para tu peso lo más rápido que conviene es ${perMonth(t.maxRate)} kg por mes: más rápido se pierde músculo, cuesta sostenerlo y suele haber rebote.`);
    if (t.limited === 'minimo') lines.push(`No conviene comer menos de ${n(t.kcal)} kcal sin control médico: para bajar más rápido, sumá actividad (caminar, entrenar) en vez de comer menos.`);
  } else if (t.goal === 'recomp') lines.push(`Gastás unas ${n(t.tdee)} kcal por día; para bajar grasa sin perder músculo comés ${n(-diff)} kcal menos: ${n(t.kcal)} kcal.`);
  else if (diff > 60) lines.push(`Gastás unas ${n(t.tdee)} kcal por día; comés ${n(diff)} kcal más: ${n(t.kcal)} kcal.`);
  else lines.push(`Gastás unas ${n(t.tdee)} kcal por día; para mantener comés lo mismo que gastás: ${n(t.kcal)} kcal.`);
  if (t.goalKg && t.weeksToGoal) lines.push(`A este ritmo llegarías a ${n(t.goalKg, 1)} kg en unas ${n(t.weeksToGoal)} semanas (${n(t.weeksToGoal / 4.345, 1)} meses).`);
  const base = t.pBase ?? t.ref;
  const refTxt = Math.abs(base - kg) > 1 ? ` de tu peso de referencia, ${n(base)} kg: con un IMC de ${n(t.bmi, 1)} se usa ese peso y no el total` : ' de tu peso';
  lines.push(`Proteína ${n(t.p)} g (${n(t.ppk, 1)} g por kg${refTxt}${t.pAsked ? ', como pediste' : ''}), grasas ${n(t.f)} g y carbohidratos ${n(t.c)} g: ${n(t.p * 4)} + ${n(t.c * 4)} + ${n(t.f * 9)} = ${n(t.kcal)} kcal.`);
  if (t.goal === 'bajar' && t.bmi < 18.5) lines.push('Ojo: tu IMC ya está por debajo de lo saludable; antes de bajar de peso consultá con un profesional.');
  else if (t.goal === 'bajar' && t.bmi < 21) lines.push('Tu peso ya está en un rango saludable: quizás te convenga "bajar grasa y ganar músculo" en vez de bajar de peso.');
  for (const x of t.notes || []) lines.push(x);
  if (t.goal === 'subir' && t.bmi < 20) lines.push(`Con un IMC de ${n(t.bmi, 1)} estás en el límite bajo: subir también algo de grasa es saludable, por eso el ritmo puede ser mayor que el del músculo solo.`);
  if (t.goal === 'subir' && !t.trains) lines.push('Para que lo que subas sea músculo, entrená fuerza al menos 3 veces por semana.');
  return lines.join('\n');
}

// ---------- Actividades del día ----------
export function addActivity(date, a) {
  const d = store.ensureDay(date);
  d.activity = d.activity || [];
  const item = { id: uid('ac'), type: ACTS[a.type] ? a.type : 'otro', min: Number(a.min) || 0, km: Number(a.km) || 0, steps: Number(a.steps) || 0, note: a.note || '' };
  if (a.kcal && a.manual) { item.kcal = round0(a.kcal); item.manual = true; }
  if (a.source) {
    item.source = a.source;
    // una captura nueva del reloj reemplaza a la anterior del mismo día (los totales del reloj se acumulan)
    if (a.source === 'reloj') d.activity = d.activity.filter((x) => x.source !== 'reloj' && x.source !== 'pasos');
  }
  d.activity.push(item);
  return item;
}
export function removeActivity(date, id) {
  const d = store.ensureDay(date);
  d.activity = (d.activity || []).filter((x) => x.id !== id);
}
export function describeAct(a) {
  const t = ACTS[a.type] || ACTS.otro;
  const parts = [];
  if (a.min) parts.push(`${a.min} min`);
  if (a.km) parts.push(`${round1(a.km)} km`);
  if (a.steps) parts.push(`${Number(a.steps).toLocaleString('es-AR')} pasos`);
  else if (stepsEstimated(a)) parts.push(`≈ ${stepsOf(a).toLocaleString('es-AR')} pasos`);
  if (a.manual && a.kcal) parts.push(`${round0(a.kcal)} kcal medidas`);
  return `${a.source === 'reloj' ? 'Reloj' : t.label}${parts.length ? ' · ' + parts.join(' · ') : ''}${a.note && a.note !== 'reloj' ? ' · ' + a.note : ''}`;
}
export { parseISO };
