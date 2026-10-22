import { analyzeOffline, testContext, groupTotals } from '../../js/ai.js';
import * as store from '../../js/store.js';
const now = new Date(2026, 9, 17, 13, 30);
const ctx = testContext({}, now);
const MSGS = [
  'el lunes a la noche comí 2 hamburguesas caseras con pan y queso cheddar',
  'desayuno: 1 taza de avena cocida con leche, 1 banana y canela',
  'en el almuerzo media pechuga al horno con arroz integral 1 taza cocido',
  'colación 1 barrita de cereal',
  'cena tarta de verdura 2 porciones',
  'hoy no fui al gimnasio porque llovió, tomé 6 vasos de agua',
  'merienda 2 mates con 3 galletitas de agua y queso untable',
  'almuerzo 1 lata de atún al natural con 2 huevos duros y media palta',
  'comí un sándwich de miga de jamón y queso',
  'cena: 300 g de lentejas guisadas',
  'me olvidé la creatina ayer',
  'tome una gaseosa light de 1,5 l en todo el dia',
  'desayuné 2 tostadas con dulce de leche y un café con leche',
  'cené pollo al horno con papas, un cuarto de pollo',
  'después de entrenar 2 huevos y 1 taza de arroz',
];
for (const m of MSGS) {
  const d = analyzeOffline(m, ctx);
  console.log('\n> ' + m);
  for (const g of d.groups) { const t = groupTotals(g); console.log(`  [${g.date.slice(5)} ${store.momentName(g.moment)}] ${t.kcal} kcal: ` + g.items.map(i => `${i.name} (${i.qty} ${i.unit}${i.grams?' '+Math.round(i.grams)+'g':''}${i.per100||i.fixed?'':' SIN DATOS'})`).join(' | ')); }
  const ex = [...d.water.map(w=>`agua ${w.mode} ${w.ml}`), ...d.habits.map(h=>`${h.id||h.name}=${h.done}`), ...d.gym.map(g=>`gym ${g.status} ${g.detail||''}`), ...d.weight.map(w=>`peso ${w.kg}`), ...d.skipped.map(s=>`salteó ${s.moment}`), ...(d.study||[]).map(s=>`estudio ${s.hours}`)];
  if (ex.length) console.log('  ' + ex.join(' · '));
  if (d.warnings?.length) console.log('  avisos: ' + d.warnings.join(' / '));
}
