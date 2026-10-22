import { normalizeDraft, TEST_CASES, testContext, evaluateDraft, groupTotals, draftTotals } from '../../js/ai.js';
import * as store from '../../js/store.js';
import { MOCKS, BAD } from './mock_responses.mjs';
const now = new Date(2026, 9, 17, 13, 30);
let pass = 0;
for (const tc of TEST_CASES) {
  const ctx = testContext(tc, now);
  // referencias de prueba F1/F2 (biblioteca personal)
  ctx.refs.F1 = { code: 'F1', name: 'Queso cremoso', per100: { kcal: 300, p: 20, c: 2, f: 24, s: 0.5, fb: 0 }, units: {} };
  ctx.refs.F2 = { code: 'F2', name: 'Avena instantánea', per100: { kcal: 373, p: 14, c: 61.7, f: 7.3, s: 1, fb: 10 }, units: { cda: 10 } };
  const d = normalizeDraft(MOCKS[tc.id], ctx, { engine: 'mock' });
  const ev = evaluateDraft(d, tc, ctx);
  if (ev.pass) pass++;
  console.log(`\n=== ${tc.id} ${tc.title} → ${ev.pass ? 'PASA' : 'FALLA'}  (total ${draftTotals(d).kcal} kcal)`);
  for (const g of d.groups) {
    const t = groupTotals(g);
    console.log(`  [${g.date} ${store.momentName(g.moment)}] ${t.kcal} kcal P${t.p}: ` + g.items.map(i => `${i.name} ${i.grams ?? ''}${i.grams!=null?(i.liq?'ml':'g'):''}${i.fraction?' frac '+i.fraction:''}${i.basis==='referencia'?' [ref]':''}${i.flags?' ⚠'+i.flags.map(f=>f.type).join(','):''}`).join(' | '));
  }
  for (const c of ev.checks) if (!c.ok) console.log('   ✗', c.msg);
}
console.log(`\n${pass}/${TEST_CASES.length} casos pasan con respuestas simuladas`);
// Validaciones con una respuesta defectuosa
const ctx = testContext({}, now);
const bad = normalizeDraft(BAD, ctx, {});
console.log('\n=== Respuesta defectuosa');
for (const g of bad.groups) for (const i of g.items) console.log(`  [${g.date} ${store.momentName(g.moment)}] ${i.name} ${i.qty} ${i.unit} ${i.grams}g per100=${JSON.stringify(i.per100)} flags=${JSON.stringify(i.flags||[])}`);
console.log('  agua', JSON.stringify(bad.water), 'peso', JSON.stringify(bad.weight), 'avisos', JSON.stringify(bad.warnings));
