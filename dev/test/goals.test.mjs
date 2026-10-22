// Metas: la suma de los macros da las calorías y los valores son razonables para cada caso.
import { calcTargets } from '../../js/energy.js';
const res = [];
const ok = (n, c, x = '') => res.push(`${c ? '✓' : '✗'} ${n}${x ? ' — ' + x : ''}`);
const show = (t) => `${t.kcal} kcal · P ${t.p} · C ${t.c} · G ${t.f} · agua ${t.waterMl}`;
const CASES = [
  // [nombre, datos, chequeos]
  ['Mujer 53 a, 90 kg, 1,60, sedentaria, bajar (caso de Google: ~1.400 kcal, P 90-110, G 45-50)', { sex: 'f', age: 53, cm: 160, kg: 90, level: 'sedentario', goal: 'bajar', gymDays: 0 }, (t) => t.kcal >= 1350 && t.kcal <= 1450 && t.p >= 90 && t.p <= 110 && t.f >= 44 && t.f <= 52],
  ['Hombre 28 a, 84 kg, 1,78, gym 4, bajar', { sex: 'm', age: 28, cm: 178, kg: 84, level: 'moderado', goal: 'bajar', gymDays: 4 }, (t) => t.kcal > 2000 && t.kcal < 2500 && t.p >= 130 && t.p <= 160],
  ['Hombre 22 a, 65 kg, 1,80, gym 5, subir', { sex: 'm', age: 22, cm: 180, kg: 65, level: 'alto', goal: 'subir', gymDays: 5 }, (t) => t.kcal > 2900 && t.p >= 100 && t.p <= 135],
  ['Mujer 30 a, 60 kg, 1,65, gym 3, recomposición', { sex: 'f', age: 30, cm: 165, kg: 60, level: 'moderado', goal: 'recomp', gymDays: 3 }, (t) => t.p >= 105 && t.p <= 130 && t.kcal < 2046],
  ['Mujer 70 a, 58 kg, 1,55, sedentaria, mantener', { sex: 'f', age: 70, cm: 155, kg: 58, level: 'sedentario', goal: 'mantener', gymDays: 0 }, (t) => t.kcal >= 1200 && t.p >= 65 && t.p <= 85],
  ['Mujer 45 a, 130 kg, 1,58, sedentaria, bajar (obesidad alta: proteína sin exagerar)', { sex: 'f', age: 45, cm: 158, kg: 130, level: 'sedentario', goal: 'bajar', gymDays: 0 }, (t) => t.p <= 125 && t.kcal >= 1500 && t.kcal <= 2000],
  ['Mujer 25 a, 50 kg, 1,60, sedentaria, bajar (no baja de 1.200)', { sex: 'f', age: 25, cm: 160, kg: 50, level: 'sedentario', goal: 'bajar', gymDays: 0 }, (t) => t.kcal >= 1200],
];
for (const [n, d, chk] of CASES) {
  const t = calcTargets(d);
  const sum = t.p * 4 + t.c * 4 + t.f * 9;
  ok(n, chk(t) && sum === t.kcal && t.c > 0 && t.f * 9 >= t.kcal * 0.24 && t.f * 9 <= t.kcal * 0.36 && t.p * 4 <= t.kcal * 0.36, `${show(t)} · suma ${sum}`);
}

// ritmo pedido ("llegar a X kg en Y tiempo", "2 kg por mes"), limitado a lo sano
const g1 = calcTargets({ sex: 'm', age: 21, cm: 180, kg: 60, level: 'moderado', goal: 'subir', gymDays: 4, goalKg: 72.5, weeks: 22 });
ok('Hombre 21 a, 60 kg, 1,80: subir 2,5 kg/mes por 5 meses → se respeta (≈ +500 kcal)', g1.kcal - g1.tdee >= 450 && g1.kcal - g1.tdee <= 560 && !g1.limited && g1.weeksToGoal >= 21 && g1.weeksToGoal <= 23 && g1.kcal === g1.p * 4 + g1.c * 4 + g1.f * 9, `${g1.kcal} kcal (+${g1.kcal - g1.tdee}) · ${g1.rate} kg/sem · ${g1.weeksToGoal} sem`);
const g2 = calcTargets({ sex: 'm', age: 21, cm: 180, kg: 60, level: 'moderado', goal: 'subir', gymDays: 4, rateKgMonth: 6 });
ok('Pedir 6 kg/mes → se limita a lo sano y se explica por el músculo', g2.limited === 'rapido' && g2.rate <= 0.61 && /músculo/.test(g2.explain), `${g2.rate} kg/sem`);
const g3 = calcTargets({ sex: 'f', age: 53, cm: 160, kg: 90, level: 'sedentario', goal: 'bajar', gymDays: 0, goalKg: 80, weeks: 4 });
ok('Bajar 10 kg en 1 mes → nunca menos del mínimo y explica por qué', g3.kcal >= 1200 && g3.limited && /rebote|control médico/.test(g3.explain), `${g3.kcal} kcal · ${g3.rate} kg/sem`);
const g4 = calcTargets({ sex: 'm', age: 30, cm: 175, kg: 80, level: 'moderado', goal: 'mantener', gymDays: 3, goalKg: 85, weeks: 20 });
ok('"Llegar a 85 kg" sin decir el objetivo → entiende que es subir', g4.goal === 'subir' && g4.kcal > g4.tdee, `${g4.goal} ${g4.kcal}`);
const g5 = calcTargets({ sex: 'm', age: 35, cm: 175, kg: 95, level: 'ligero', goal: 'bajar', gymDays: 2, rateKgMonth: 2 });
ok('Bajar 2 kg por mes con obesidad leve → ritmo pedido', Math.abs(g5.rate * 4.345 - 2) < 0.3 && !g5.limited, `${g5.rate} kg/sem · ${g5.kcal} kcal`);

// personalización: proteína pedida, tope de carbohidratos, dietas y salud
const sum = (t) => t.p * 4 + t.c * 4 + t.f * 9 === t.kcal;
const n1 = calcTargets({ sex: 'm', age: 21, cm: 180, kg: 92, level: 'moderado', goal: 'bajar', gymDays: 5, proteinPerKg: 2.2 });
ok('Nacho quiere 2,2 g/kg → 202 g (sobre su peso, entrena)', n1.p === 202 && sum(n1) && /como pediste/.test(n1.explain), `${n1.p} g`);
const n2 = calcTargets({ sex: 'm', age: 30, cm: 178, kg: 80, level: 'moderado', goal: 'bajar', gymDays: 3, carbsMax: 50 });
ok('Máximo 50 g de carbohidratos → se respeta y se compensa con grasas', n2.c === 50 && sum(n2) && n2.f * 9 > n2.kcal * 0.5 && /grasas/.test(n2.explain), `C ${n2.c} G ${n2.f} P ${n2.p}`);
const n3 = calcTargets({ sex: 'f', age: 45, cm: 162, kg: 75, level: 'ligero', goal: 'bajar', gymDays: 0, conditions: ['diabetes'] });
ok('Diabetes → carbohidratos ≤ 40 %, azúcar ≤ 5 % y aviso', n3.c * 4 <= n3.kcal * 0.41 && n3.sugarMax * 4 <= n3.kcal * 0.051 && /médico/.test(n3.explain) && sum(n3));
const n4 = calcTargets({ sex: 'm', age: 40, cm: 175, kg: 85, level: 'ligero', goal: 'bajar', gymDays: 0, conditions: ['renal'], proteinPerKg: 2.2 });
ok('Problema renal → proteína 0,8 g/kg aunque pida más', n4.p <= Math.round(n4.ref * 0.8) + 1 && /nefrólogo/.test(n4.explain) && sum(n4), `${n4.p} g`);
const n5 = calcTargets({ sex: 'f', age: 32, cm: 165, kg: 68, level: 'ligero', goal: 'bajar', gymDays: 0, conditions: ['embarazo'] });
ok('Embarazo → nunca déficit', n5.kcal > n5.tdee && /embarazo/.test(n5.explain) && sum(n5));
const n6 = calcTargets({ sex: 'f', age: 30, cm: 165, kg: 60, level: 'moderado', goal: 'mantener', gymDays: 3, diet: 'vegana' });
const n6b = calcTargets({ sex: 'f', age: 30, cm: 165, kg: 60, level: 'moderado', goal: 'mantener', gymDays: 3 });
ok('Vegana → algo más de proteína y consejo de B12', n6.p > n6b.p && /B12/.test(n6.explain) && sum(n6));
const n7 = calcTargets({ sex: 'm', age: 25, cm: 178, kg: 75, level: 'moderado', goal: 'mantener', gymDays: 4, diet: 'keto' });
ok('Keto → ≤ 40 g de carbohidratos', n7.c <= 40 && sum(n7), `C ${n7.c}`);
console.log(res.join('\n'));
console.log(calcTargets(CASES[0][1]).explain);
