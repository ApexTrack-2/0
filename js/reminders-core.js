// ApexTrack — recordatorios: lógica pura que comparten la app y el service worker.
// Decide qué aviso toca a cada hora y si hace falta mostrarlo (por ejemplo, el del almuerzo solo
// si todavía no lo registraste). No usa el DOM ni otros módulos: el service worker la importa tal cual.

export const TYPES = {
  comida: { label: 'Comida', icon: 'meal' },
  agua: { label: 'Agua', icon: 'drop' },
  habito: { label: 'Hábito o suplemento', icon: 'pill' },
  estudio: { label: 'Estudio', icon: 'book' },
  peso: { label: 'Pesarse', icon: 'scale' },
  gym: { label: 'Gimnasio', icon: 'dumbbell' },
  dia: { label: 'Resumen del día', icon: 'chart' },
  sueno: { label: 'Hora de dormir', icon: 'moon' },
  resumen: { label: 'Resumen semanal', icon: 'sparkle' },
  libre: { label: 'Otro', icon: 'bell' },
};
const ALL = [0, 1, 2, 3, 4, 5, 6];
export function defaultReminders() {
  return [
    { id: 'r_almuerzo', type: 'comida', ref: 'almuerzo', time: '14:45', days: ALL, on: true, onlyIfMissing: true },
    { id: 'r_cena', type: 'comida', ref: 'cena', time: '22:30', days: ALL, on: true, onlyIfMissing: true },
    { id: 'r_agua1', type: 'agua', time: '11:30', days: ALL, on: true, onlyIfMissing: true },
    { id: 'r_agua2', type: 'agua', time: '16:30', days: ALL, on: true, onlyIfMissing: true },
    { id: 'r_agua3', type: 'agua', time: '20:00', days: ALL, on: true, onlyIfMissing: true },
    { id: 'r_creatina', type: 'habito', ref: 'creatina', time: '21:00', days: ALL, on: true, onlyIfMissing: true },
    { id: 'r_estudio', type: 'estudio', time: '19:00', days: [1, 2, 3, 4, 5], on: false, onlyIfMissing: true },
    { id: 'r_gym', type: 'gym', time: '18:00', days: [1, 2, 3, 4, 5], on: false, onlyIfMissing: true },
    { id: 'r_peso', type: 'peso', time: '08:30', days: [1], on: false, onlyIfMissing: true },
    { id: 'r_sueno', type: 'sueno', time: '22:45', days: ALL, on: false, onlyIfMissing: true },
    { id: 'r_dia', type: 'dia', time: '23:00', days: ALL, on: false, onlyIfMissing: false },
    { id: 'r_resumen', type: 'resumen', time: '09:30', days: [1], on: true, onlyIfMissing: false },
  ];
}

const pad = (n) => String(n).padStart(2, '0');
export const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtN = (n, dec = 0) => Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
function at(date, hhmm) {
  const [h, m] = String(hhmm || '09:00').split(':').map(Number);
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h || 0, m || 0, 0, 0);
  return d;
}

// --- lectura mínima del estado guardado ---
function itemKcal(it) {
  if (it.fixed) return { kcal: Number(it.fixed.kcal) || 0, p: Number(it.fixed.p) || 0 };
  if (it.per100 && it.grams) return { kcal: (it.per100.kcal || 0) * it.grams / 100, p: (it.per100.p || 0) * it.grams / 100 };
  return { kcal: 0, p: 0 };
}
export function dayInfo(state, iso) {
  const entries = (state.entries || []).filter((e) => e.date === iso && (e.items || []).length);
  let kcal = 0; let p = 0;
  for (const e of entries) for (const it of e.items) { const m = itemKcal(it); kcal += m.kcal; p += m.p; }
  const day = (state.days || {})[iso] || {};
  return { entries, moments: new Set(entries.map((e) => e.moment)), kcal: Math.round(kcal), p: Math.round(p), water: day.water || 0, habits: day.habits || {}, study: day.study || 0, gym: day.gym || '', weight: (state.body || []).some((b) => b.date === iso && b.weight) };
}
const momentName = (state, id) => ((state.settings?.moments || []).find((m) => m.id === id) || {}).name || id;
const habitName = (state, id) => ((state.settings?.habits || []).find((h) => h.id === id) || {}).name || id;

/**
 * ¿Hay que mostrar este recordatorio ahora? Devuelve null si no hace falta, o la notificación.
 * now: Date (hora local del teléfono).
 */
export function evaluate(r, state, now = new Date()) {
  const iso = isoOf(now);
  const d = dayInfo(state, iso);
  const g = state.settings?.goals || {};
  const glass = state.settings?.ui?.glassMl || 250;
  const base = { tag: r.id, url: './', data: { id: r.id } };
  switch (r.type) {
    case 'comida': {
      const name = momentName(state, r.ref);
      if (r.onlyIfMissing && d.moments.has(r.ref)) return null;
      const skipped = ((state.days || {})[iso]?.skipped || []).includes(r.ref);
      if (skipped) return null;
      return { ...base, title: r.text || `¿Qué comiste de ${name.toLowerCase()}?`, body: `Todavía no anotaste nada de ${name.toLowerCase()}. Llevás ${fmtN(d.kcal)} de ${fmtN(g.kcal)} kcal.`, url: `./?accion=registrar&momento=${encodeURIComponent(r.ref)}`, actions: [{ action: 'registrar', title: 'Registrar' }] };
    }
    case 'agua': {
      const goal = g.waterMl || 2500;
      const h = now.getHours() + now.getMinutes() / 60;
      const pace = goal * Math.max(0.15, Math.min(1, (h - 8) / 14));
      if (r.onlyIfMissing && d.water >= pace * 0.85) return null;
      const falta = Math.max(0, goal - d.water);
      return { ...base, title: r.text || 'Tomá un vaso de agua', body: `Llevás ${fmtN(d.water / 1000, 1)} L de ${fmtN(goal / 1000, 1)} L${falta ? ` (faltan ${Math.ceil(falta / glass)} vasos)` : ''}.`, url: './?accion=agua', actions: [{ action: 'agua', title: `+1 vaso (${glass} ml)` }, { action: 'abrir', title: 'Abrir' }] };
    }
    case 'habito': {
      if (r.onlyIfMissing && d.habits[r.ref]) return null;
      const name = habitName(state, r.ref);
      return { ...base, title: r.text || `¿Tomaste ${/^(creatina|magnesio|vitamina)/i.test(name) ? 'la ' : ''}${name.toLowerCase()}?`, body: 'Tocá "Hecho" para marcarlo.', url: `./?accion=habito&id=${encodeURIComponent(r.ref)}`, actions: [{ action: 'habito', title: 'Hecho' }, { action: 'abrir', title: 'Abrir' }] };
    }
    case 'estudio': {
      const goalH = ((state.settings?.habits || []).find((x) => x.kind === 'hours') || {}).goal || 0;
      if (r.onlyIfMissing && (goalH ? d.study >= goalH : d.study > 0)) return null;
      return { ...base, title: r.text || 'Hora de estudiar', body: d.study ? `Llevás ${fmtN(d.study, 1)} h hoy${goalH ? ` de ${fmtN(goalH, 1)} h` : ''}.` : 'Todavía no estudiaste hoy.', url: './?accion=estudio' };
    }
    case 'gym': {
      if (r.onlyIfMissing && d.gym) return null;
      return { ...base, title: r.text || '¿Vas al gimnasio hoy?', body: 'Marcá si fuiste, no fuiste o es día de descanso.', url: './?accion=gym' };
    }
    case 'peso': {
      if (r.onlyIfMissing && d.weight) return null;
      return { ...base, title: r.text || 'Pesate en ayunas', body: 'Anotá tu peso para seguir la tendencia.', url: './?accion=peso' };
    }
    case 'dia': {
      return { ...base, title: `Hoy: ${fmtN(d.kcal)} de ${fmtN(g.kcal)} kcal`, body: `Proteína ${fmtN(d.p)} de ${fmtN(g.p)} g · agua ${fmtN(d.water / 1000, 1)} de ${fmtN((g.waterMl || 2500) / 1000, 1)} L`, url: './', silent: true, actions: [{ action: 'agua', title: `+1 vaso` }, { action: 'registrar', title: 'Registrar' }] };
    }
    case 'sueno': {
      if (r.onlyIfMissing && state.sleep?.active) return null;
      const goal = state.sleep?.goalH || 8; const wake = state.sleep?.wake || '07:00';
      return { ...base, title: r.text || 'Hora de ir a dormir', body: `Para dormir ${String(goal).replace('.', ',')} h y levantarte a las ${wake}, conviene acostarte ahora. Dejá el teléfono 30 min antes.`, url: './?accion=sueno', silent: true };
    }
    case 'resumen':
      return { ...base, title: r.text || 'Tu resumen de la semana está listo', body: 'Mirá cómo te fue, qué mejorar y qué cambiar esta semana.', url: './?accion=resumen' };
    default:
      return { ...base, title: r.text || 'ApexTrack', body: r.body || '' };
  }
}

/** Recordatorios que vencieron en los últimos `windowMin` minutos y no se mostraron hoy. */
export function dueNow(state, now = new Date(), shown = {}, windowMin = 40) {
  const rs = state.settings?.reminders;
  if (!rs || !rs.on) return [];
  const iso = isoOf(now);
  const out = [];
  for (const r of rs.list || []) {
    if (!r.on || !(r.days || ALL).includes(now.getDay())) continue;
    const t = at(now, r.time);
    if (t > now || now - t > windowMin * 60000) continue;
    if (shown[`${iso}|${r.id}`]) continue;
    const n = evaluate(r, state, now);
    out.push({ r, n }); // n = null: ya estaba hecho (se marca igual como visto)
  }
  // fin del ayuno intermitente en curso
  const fa = state.fasting?.active;
  if (fa && rs.fasting !== false) {
    const end = fa.start + fa.goalH * 3600000;
    const id = `ayuno_${fa.start}`;
    if (now.getTime() >= end && now.getTime() - end < 6 * 3600000 && !shown[`${iso}|${id}`] && !shown[`${isoOf(new Date(end))}|${id}`]) {
      out.push({ r: { id }, n: { tag: id, title: `¡Completaste tu ayuno de ${fa.goalH} h!`, body: 'Ya podés comer. Registrá tu primera comida para cerrarlo.', url: './?accion=ayuno', data: { id } } });
    }
  }
  return out;
}

/** Horarios (ms) de los próximos días para el servidor. Hoy se omiten los que ya no hacen falta. */
export function upcomingTimes(state, now = new Date(), days = 14) {
  const rs = state.settings?.reminders;
  if (!rs || !rs.on) return [];
  const out = [];
  for (let k = 0; k < days; k++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k, 12);
    for (const r of rs.list || []) {
      if (!r.on || !(r.days || ALL).includes(day.getDay())) continue;
      const t = at(day, r.time);
      if (t <= now) continue;
      if (k === 0 && r.onlyIfMissing && !evaluate(r, state, t)) continue;
      out.push(t.getTime());
    }
  }
  const fa = state.fasting?.active;
  if (fa && rs.fasting !== false) { const end = fa.start + fa.goalH * 3600000; if (end > now.getTime()) out.push(end); }
  return [...new Set(out)].sort((a, b) => a - b);
}
