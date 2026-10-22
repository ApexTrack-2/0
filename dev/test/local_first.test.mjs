// IA propia: qué mensajes se resuelven al instante sin Gemini (y cuáles van a Gemini).
import { analyzeOffline, testContext, localVerdict, groupTotals } from '../../js/ai.js';
const now = new Date(2026, 9, 17, 13, 30);
const ctx = testContext({}, now);
const CASES = [
  ['2 huevos y una banana', true],
  ['almuerzo 150 g de pechuga de pollo con 200 g de arroz', true],
  ['desayuno café con leche y 2 tostadas con queso crema', true],
  ['tomé 2 vasos de agua y la creatina', true],
  ['una manzana', true],
  ['yogur de frutilla La Serenísima', false],
  ['un big mac con papas', false],
  ['ensalada con tomate, lechuga y cebolla', true],
  ['poke de salmón con edamame', false],
  ['cena: 250 g de fideos con salsa bolognesa y un vaso de vino tinto', true],
  ['comí algo raro que no sé qué era', false],
];
let fails = 0;
for (const [text, expect] of CASES) {
  const d = analyzeOffline(text, ctx);
  const v = localVerdict(d, text, ctx);
  const kcal = d.groups.reduce((a, g) => a + groupTotals(g).kcal, 0);
  const ok = v.ok === expect;
  if (!ok) fails++;
  console.log(`${ok ? '✓' : '✗'} ${v.ok ? 'LOCAL' : 'GEMINI'} "${text}" → ${kcal} kcal ${v.reason ? '(' + v.reason + ')' : ''} :: ${d.groups.flatMap((g) => g.items).map((i) => i.name).join(' | ')}`);
}
console.log(fails ? `${fails} casos distintos de lo esperado` : 'Todo como se esperaba');

// "una banana" cuando ya había una banana registrada en gramos (antes daba 1 g)
{
  const c2 = { ...ctx, refs: { R1: { code: 'R1', name: 'Banana', per100: { kcal: 89, p: 1.1, c: 20.2, f: 0.3, s: 12.2, fb: 2.6 } } } };
  const d = analyzeOffline('una banana', c2);
  const it = d.groups[0]?.items[0];
  const good = it && it.grams >= 90 && it.grams <= 200;
  console.log(`${good ? '✓' : '✗'} "una banana" con registro previo en gramos → ${it?.qty} ${it?.unit} ${it?.grams} g`);
  if (!good) process.exitCode = 1;
}
