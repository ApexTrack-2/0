// Recordatorios: qué se muestra, qué se saltea y qué horarios se mandan al servidor.
import { evaluate, dueNow, upcomingTimes, defaultReminders, isoOf } from '../../js/reminders-core.js';
const res = [];
const ok = (n, c, x = '') => res.push(`${c ? '✓' : '✗'} ${n}${x ? ' — ' + x : ''}`);
const now = new Date(2026, 9, 20, 14, 50); // martes 20/10 14:50
const iso = isoOf(now);
const state = {
  settings: { reminders: { on: true, list: defaultReminders() }, goals: { kcal: 2500, p: 140, waterMl: 2500 }, ui: { glassMl: 250 },
    moments: [{ id: 'almuerzo', name: 'Almuerzo' }, { id: 'cena', name: 'Cena' }], habits: [{ id: 'creatina', name: 'Creatina', kind: 'supp' }, { id: 'estudio', name: 'Estudio', kind: 'hours', goal: 2 }] },
  entries: [{ date: iso, moment: 'desayuno', items: [{ name: 'Huevo', grams: 100, per100: { kcal: 143, p: 12.6 } }] }],
  days: { [iso]: { water: 500, habits: {} } }, body: [],
};
const R = (id) => state.settings.reminders.list.find((x) => x.id === id);
let n = evaluate(R('r_almuerzo'), state, now);
ok('Almuerzo sin registrar → avisa', n && /de almuerzo/i.test(n.title) && /143/.test(n.body) && n.url.includes('momento=almuerzo'), n?.title + ' · ' + n?.body);
state.entries.push({ date: iso, moment: 'almuerzo', items: [{ name: 'Pollo', grams: 200, per100: { kcal: 165, p: 31 } }] });
ok('Almuerzo ya registrado → no avisa', evaluate(R('r_almuerzo'), state, now) === null);
n = evaluate(R('r_agua2'), state, new Date(2026, 9, 20, 16, 30));
ok('Agua atrasada → avisa con lo que falta', n && /0,5 L de 2,5 L/.test(n.body) && n.actions[0].action === 'agua', n?.body);
state.days[iso].water = 1800;
ok('Agua al día → no avisa', evaluate(R('r_agua2'), state, new Date(2026, 9, 20, 16, 30)) === null);
ok('Creatina no tomada → avisa con botón Hecho', evaluate(R('r_creatina'), state, now)?.actions?.[0]?.action === 'habito');
state.days[iso].habits.creatina = true;
ok('Creatina tomada → no avisa', evaluate(R('r_creatina'), state, now) === null);
n = evaluate({ id: 'x', type: 'dia' }, state, now);
ok('Resumen del día', n && /Hoy: 473 de 2\.500 kcal/.test(n.title), n?.title + ' · ' + n?.body);
// vencidos en la ventana
state.entries = state.entries.filter((e) => e.moment !== 'almuerzo');
const due = dueNow(state, now, {});
ok('A las 14:50 vence el aviso del almuerzo (14:45)', due.length === 1 && due[0].r.id === 'r_almuerzo' && due[0].n, due.map((d) => d.r.id).join(','));
ok('Si ya se mostró, no se repite', dueNow(state, now, { [`${iso}|r_almuerzo`]: 1 }).length === 0);
state.settings.reminders.on = false;
ok('Apagados → nada', dueNow(state, now, {}).length === 0 && upcomingTimes(state, now).length === 0);
state.settings.reminders.on = true;
const times = upcomingTimes(state, now);
const todayTimes = times.filter((t) => isoOf(new Date(t)) === iso).map((t) => new Date(t).toTimeString().slice(0, 5));
ok('Horarios de hoy: solo los que todavía hacen falta', !todayTimes.includes('21:00') && todayTimes.includes('22:30') && todayTimes.every((t) => t > '14:50'), todayTimes.join(' '));
ok('Horarios de 14 días para el servidor', times.length > 50 && new Date(times[times.length - 1]) - now < 15 * 86400000, `${times.length} horarios`);
ok('El resumen semanal va solo los lunes', times.filter((t) => new Date(t).getHours() === 9 && new Date(t).getMinutes() === 30).every((t) => new Date(t).getDay() === 1));
console.log(res.join('\n'));
