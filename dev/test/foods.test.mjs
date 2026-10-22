import { BUILTIN_FOODS, atwater, parseLocal, searchFoods, splitSegments, calc, per100Of } from '../../js/foods.js';
let bad = 0; const ids = new Set();
for (const f of BUILTIN_FOODS) {
  if (ids.has(f.id)) { console.log('DUP', f.id); bad++; } ids.add(f.id);
  if (!f.d) { console.log('NO DEFAULT', f.id); bad++; }
  if (f.k < 3) continue;
  const est = atwater(per100Of(f)); const diff = Math.abs(est - f.k) / f.k;
  if (diff > 0.15) { console.log('ATWATER', f.id, f.k, est.toFixed(1), (diff*100).toFixed(0)+'%'); bad++; }
}
console.log('foods:', BUILTIN_FOODS.length, 'problemas:', bad);
const samples = [
  'una taza y media de copos de maiz', '1 banana chica', 'cuatro huevos en sartén sin aceite y un pan francés 80 g',
  'hamburguesa 90g, brocoli 68g', '1 scoop de proteina con 300 ml de leche protein', 'café con leche y 2 medialunas',
  'medio paquete de galletas traviata', '3 bombones', 'un plato de bondiola de cerdo', 'eh un bollo de pan frances mas o menos 70 g',
];
for (const s of samples) {
  const items = parseLocal(s);
  console.log('\n>', s, '|', splitSegments(s).join(' / '));
  for (const it of items) { const m = it.per100 ? calc(it.per100, it.grams) : null;
    console.log('  -', it.name, '|', it.qty, it.unit, '=>', it.grams, 'g', m ? `${m.kcal} kcal P${m.p}` : 'SIN DATOS', it.confidence, it.note || ''); }
}
