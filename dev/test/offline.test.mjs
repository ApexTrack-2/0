import { analyzeOffline, TEST_CASES, testContext, evaluateDraft, groupTotals } from '../../js/ai.js';
import * as store from '../../js/store.js';
const now = new Date(2026, 9, 17, 13, 30);
for (const tc of TEST_CASES) {
  const ctx = testContext(tc, now);
  const d = analyzeOffline(tc.text, ctx);
  const ev = evaluateDraft(d, tc, ctx);
  console.log(`\n=== ${tc.id} ${tc.title} → ${ev.pass ? 'PASA' : 'falla'}`);
  for (const g of d.groups) {
    const t = groupTotals(g);
    console.log(`  [${g.date} ${store.momentName(g.moment)}] ${t.kcal} kcal: ` + g.items.map(i => `${i.name} (${i.qty} ${i.unit}${i.grams?' '+Math.round(i.grams)+'g':''})${i.flags?'⚠':''}`).join(' | '));
  }
  if (d.water.length) console.log('  agua', JSON.stringify(d.water));
  if (d.habits.length) console.log('  hábitos', JSON.stringify(d.habits));
  if (d.gym.length) console.log('  gym', JSON.stringify(d.gym));
  if (d.skipped.length) console.log('  salteado', JSON.stringify(d.skipped));
  for (const c of ev.checks) if (!c.ok) console.log('   ✗', c.msg);
}
