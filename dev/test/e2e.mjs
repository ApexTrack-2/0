// Prueba de punta a punta en Chromium (pantalla de Android 412×915) con la IA simulada.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { MOCKS } from './mock_responses.mjs';

const ROOT = path.resolve('../..');
const OUT = process.env.SHOTS || '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(8765);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-AR', timezoneId: 'America/Argentina/San_Juan', acceptDownloads: true, serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const results = [];
process.on('exit', () => { if (!globalThis.__done) { console.log(results.join('\n')); console.log('ERRORES:', errors.join('\n')); } });
const ok = (name, cond, extra = '') => { results.push(`${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`); };

// IA simulada
let aiCalls = 0;
await page.route('**/generativelanguage.googleapis.com/**', async (route) => {
  const url = route.request().url();
  if (url.includes('/models?')) return route.fulfill({ json: { models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent', 'createInteraction'] }] } });
  aiCalls++;
  const body = route.request().postDataJSON() || {};
  const txt = JSON.stringify(body.input || body.contents || '');
  const sys = JSON.stringify(body.systemInstruction || body.system_instruction || '');
  let out = { items: [], water: [], habits: [], gym: [], weight: [], skipped: [], questions: [] };
  if (/bondiola/.test(txt)) out = MOCKS.t2;
  else if (/ensalada rusa/.test(txt)) out = MOCKS.t3;
  else if (/Traviata/.test(txt) && !/Respondé en JSON/.test(sys)) out = MOCKS.t1;
  else if (/Sos nutricionista\. Tu tarea principal/.test(sys)) out = { sex: 'f', age: 34, heightCm: 162, weightKg: 70, goal: 'bajar', level: 'moderado', gymDays: 3, kcal: 1650, protein: 140, carbs: 160, fat: 55, sugarMax: 41, waterMl: 2450, explanation: 'Gasto estimado 2100 kcal; déficit moderado.', missing: [] };
  else if (/coach que revisa el registro/.test(sys)) out = { titulo: 'Vas bien', puntaje: 7, resumen: 'Buen trabajo.', bien: ['Proteína alta'], mal: ['Poca agua'], mejorar: ['Tomá más agua'], evitar: ['Helado a la noche'], proximo_paso: 'Agua con cada comida' };
  else if (/Respondé en JSON/.test(sys)) out = { kcal: 432, fuente: 'bagley' };
  else if (/"ok"/.test(txt) || /modelo/.test(txt)) out = { ok: true, modelo: 'gemini-3.8-flash' };
  await new Promise((r) => setTimeout(r, /ensalada rusa/.test(txt) ? 4000 : 300));
  { // las respuestas simuladas tienen fechas fijas: se corren a la fecha real del navegador
    const tz = 'America/Argentina/San_Juan';
    const dd = (k) => new Date(Date.now() + k * 86400000).toLocaleDateString('sv-SE', { timeZone: tz });
    out = JSON.parse(JSON.stringify(out).replaceAll('2026-10-17', dd(0)).replaceAll('2026-10-16', dd(-1)).replaceAll('2026-10-15', dd(-2)));
  }
  if (url.includes(':generateContent')) return route.fulfill({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] } });
  return route.fulfill({ json: { id: 'x', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(out) }] }] } });
});

const shot = async (name) => { await page.waitForTimeout(260); await page.screenshot({ path: `${OUT}/${name}.png` }); };
const tap = async (sel) => { await page.locator(sel).first().click(); await page.waitForTimeout(200); };
const sheetTop = () => page.locator('.sheet-wrap').last();
const closeSheet = async () => { await sheetTop().locator('[data-sheet-close]').click(); await page.waitForTimeout(300); };
const val = (fn, arg) => page.evaluate(fn, arg);
const clearStamps = () => page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('apextrack_ai_stamps')) localStorage.removeItem(k); });

await page.goto('http://localhost:8765/');
await page.waitForSelector('.hero');
await page.waitForSelector('.sheet-wrap', { timeout: 3000 }).then(async () => { await shot('00-bienvenida'); await sheetTop().locator('[data-sheet-close]').click(); await page.waitForTimeout(400); }).catch(() => {});
const today = await val(() => window.__apex.ui.date);
ok('Abre en la fecha de hoy (hora local)', today === (await val(() => new Date().toLocaleDateString('sv-SE'))), today);
await shot('01-hoy-vacio');

// --- Fecha
await tap('[data-act="date-prev"]');
ok('Flecha: día anterior', (await val(() => window.__apex.ui.date)) < today);
ok('Aparece "Volver a hoy"', await page.locator('[data-act="date-today"]').count() === 1);
await tap('[data-act="date-today"]');
ok('Volver a hoy', (await val(() => window.__apex.ui.date)) === today);
ok('Flecha siguiente deshabilitada en hoy', await page.locator('[data-act="date-next"]').isDisabled());
await tap('[data-act="date-pick"]');
await shot('02-calendario');
ok('Calendario propio abierto', await page.locator('.cal-g .cal-d').count() >= 28);
ok('Días futuros (pasado mañana) deshabilitados', await page.locator(`.cal-d[data-d="${await val(() => { const d = new Date(); d.setDate(d.getDate() + 2); return d.toLocaleDateString('sv-SE'); })}"]`).isDisabled().catch(() => true));
await sheetTop().locator('[data-nav="-1"]').click();
await page.waitForTimeout(150);
await sheetTop().locator('.cal-d:not(.out)').nth(9).click();
await page.waitForTimeout(350);
ok('Elegir un día del mes anterior', (await val(() => window.__apex.ui.date)).slice(5, 7) !== today.slice(5, 7));
await tap('[data-act="date-pick"]');
await sheetTop().locator('[data-go="today"]').click();
await page.waitForTimeout(350);
ok('Botón Hoy del calendario', (await val(() => window.__apex.ui.date)) === today);

// --- Ajustes IA: clave
await tap('[data-act="settings"]');
await shot('03-ajustes');
await sheetTop().locator('[data-s="ia"]').click();
await page.waitForTimeout(350);
await sheetTop().locator('#ai-key').fill('AQ.clave_de_prueba');
await sheetTop().locator('[data-a="test"]').click();
await page.waitForSelector('#ai-status:has-text("Conectada")', { timeout: 8000 }).catch(() => {});
ok('Probar conexión', (await sheetTop().locator('#ai-status').innerText()).includes('Conectada'), await sheetTop().locator('#ai-status').innerText());
await shot('04-ia');
await sheetTop().locator('[data-a="prec"]').click(); await page.waitForTimeout(300);
await shot('05-precision');
await sheetTop().locator('.opt[data-v="maxima"]').click(); await page.waitForTimeout(300);
ok('Precisión elegida', (await val(() => window.__apex.store.S().settings.ai.precision)) === 'maxima');
await sheetTop().locator('[data-a="web"]').click(); await page.waitForTimeout(150);
ok('Interruptor de búsqueda web', (await val(() => window.__apex.store.S().settings.ai.web)) === true);
await sheetTop().locator('[data-a="web"]').click(); await page.waitForTimeout(150);
await sheetTop().locator('[data-a="save"]').click(); await page.waitForTimeout(350);
await closeSheet();
ok('Clave guardada', (await val(() => window.__apex.store.S().settings.ai.key)) === 'AQ.clave_de_prueba');

// --- Registrar con IA (texto 1)
const T1 = 'Almuerzo seis empanadas caseras con masa hojaldre. Merienda medio paquete de galletas Traviata Rex y 170 g de banana, 65 g de avena instantánea Quaker, 40 g de mantequilla de maní, 250 ml de leche proteica con dos cucharaditas de azúcar y tomae la creatina.';
await tap('#tab-rec');
await shot('06-registrar');
await sheetTop().locator('#lg-text').fill(T1);
await sheetTop().locator('[data-l="analyze"]').click();
await page.waitForSelector('[data-r="save"]', { timeout: 10000 });
await shot('07-revision-t1');
const revTotal = await sheetTop().locator('.rv-total').innerText().catch(() => '');
ok('Revisión muestra el total', /kcal/.test(revTotal), revTotal.replace(/\s+/g, ' '));
await sheetTop().locator('[data-r="save"]').click();
await page.waitForTimeout(500);
const tot1 = await val(() => window.__apex.store.dayTotals(window.__apex.ui.date));
ok('Guardó comidas de hoy', tot1.items >= 7, `${tot1.kcal} kcal, ${tot1.items} alimentos`);
ok('Marcó la creatina', await val(() => !!window.__apex.store.day(window.__apex.ui.date).habits.creatina));
await shot('08-hoy-con-datos');

// --- Texto 2 (dos días)
await tap('#tab-rec');
await sheetTop().locator('#lg-text').fill('En media tarde ayer agrega unos tres bombones de chocolate. de cena bondiola de cerdo ... (texto 2)');
await sheetTop().locator('[data-l="analyze"]').click();
await page.waitForSelector('[data-r="save"]', { timeout: 10000 });
await shot('09-revision-t2');
await sheetTop().locator('[data-r="save"]').click();
await page.waitForTimeout(500);
const y = await val(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toLocaleDateString('sv-SE'); });
const yT = await val((d) => window.__apex.store.dayTotals(d), y);
ok('Guardó también en ayer', yT.items >= 5, `${yT.kcal} kcal`);
ok('Gym de ayer: no fui', (await val((d) => window.__apex.store.day(d).gym, y)) === 'no_fui');
ok('Agua de ayer +750', (await val((d) => window.__apex.store.day(d).water, y)) === 750);

// --- Comidas: abrir, editar ítem, copiar, mover, borrar con deshacer
await tap('.meal-head');
await shot('10-comida-abierta');
await tap('.meal.open .item-row');
await shot('11-editor-item');
await closeSheet();
const nEntries = await val(() => window.__apex.store.S().entries.length);
await tap('.meal.open [data-act="meal-move"]');
await shot('12-mover');
await sheetTop().locator('.opt[data-v="cena"]').click(); await page.waitForTimeout(400);
ok('Mover comida a la cena', await val(() => window.__apex.store.entriesOn(window.__apex.ui.date).some((e) => e.moment === 'cena')));
await tap('.meal-head');
await tap('.meal.open [data-act="meal-del"]');
await sheetTop().locator('[data-r="1"]').click(); await page.waitForTimeout(400);
ok('Borrar comida', (await val(() => window.__apex.store.S().entries.length)) === nEntries - 1);
await page.locator('.toast-act').click(); await page.waitForTimeout(300);
ok('Deshacer borrado', (await val(() => window.__apex.store.S().entries.length)) === nEntries);

// --- Agua, hábitos, gym, peso, estudio
await tap('[data-act="glass"][data-i="3"]');
ok('Vasos de agua', (await val(() => window.__apex.store.day(window.__apex.ui.date).water)) === 1000);
await tap('[data-act="water-add"][data-ml="500"]');
ok('+500 ml', (await val(() => window.__apex.store.day(window.__apex.ui.date).water)) === 1500);
await tap('[data-act="water-custom"]');
await sheetTop().locator('[data-k="total"]').fill('2000');
await sheetTop().locator('[data-r="1"]').click(); await page.waitForTimeout(300);
ok('Agua: total del día', (await val(() => window.__apex.store.day(window.__apex.ui.date).water)) === 2000);
await tap('[data-act="habit"][data-id="magnesio"]');
ok('Hábito magnesio', await val(() => !!window.__apex.store.day(window.__apex.ui.date).habits.magnesio));
await tap('[data-act="gym-day"][data-v="fui"]');
ok('Gym: fui', (await val(() => window.__apex.store.day(window.__apex.ui.date).gym)) === 'fui');
await tap('[data-act="study"][data-d="0.5"]');
ok('Estudio +0,5 h', (await val(() => window.__apex.store.day(window.__apex.ui.date).study)) === 0.5);
await tap('[data-act="weight"]');
await sheetTop().locator('input').fill('61,4');
await sheetTop().locator('[data-r="1"]').click(); await page.waitForTimeout(300);
ok('Peso 61,4', (await val(() => window.__apex.store.bodyOn(window.__apex.ui.date)?.weight)) === 61.4);
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await shot('13-hoy-abajo');

// --- Diario
await tap('.tab[data-tab="diario"]');
await shot('14-diario-semana');
await tap('[data-act="dia-metric"][data-v="p"]');
{ const sel = await val(() => window.__apex.ui.diary.sel); const today = await val(() => new Date().toLocaleDateString('sv-SE')); const dts = await page.locator('.chart .hit').evaluateAll((els) => els.map((e) => e.dataset.date)); const pickD = dts.find((d) => d !== sel && d <= today); if (pickD) { await page.locator(`.chart .hit[data-date="${pickD}"]`).click(); await page.waitForTimeout(250); } }
await shot('15-diario-proteina');
await tap('[data-act="dia-week"][data-d="-1"]');
ok('Semana anterior', (await val(() => window.__apex.ui.diary.week)) < (await val(() => { const d = new Date(); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return d.toLocaleDateString('sv-SE'); })));
await tap('[data-act="dia-pick"]');
await sheetTop().locator('[data-go="today"]').click(); await page.waitForTimeout(300);
await tap('[data-act="dia-mode"][data-v="mes"]');
await shot('16-diario-mes');
await tap('[data-act="dia-month"][data-d="-1"]');
await tap('[data-act="dia-month"][data-d="1"]');
await page.locator(`.cal-d[data-date="${y}"]`).click(); await page.waitForTimeout(300);
ok('Desde el mes abre el día', (await val(() => window.__apex.ui.tab)) === 'hoy' && (await val(() => window.__apex.ui.date)) === y);
await tap('[data-act="date-today"]');

// --- Gimnasio
await tap('.tab[data-tab="gym"]');
await shot('17-gym');
await tap('[data-act="gym-start"]');
await page.locator('.set-in[data-k="kg"]').first().fill('60');
await page.locator('.set-in[data-k="reps"]').first().fill('8');
await tap('[data-act="set-done"]');
await shot('18-gym-sesion');
ok('Temporizador de descanso', await page.locator('.timer-pill').count() === 1);
await page.locator('.timer-pill [data-t="x"]').click();
await tap('[data-act="ex-menu"]');
await shot('19-gym-menu-ejercicio');
await closeSheet();
await tap('[data-act="gym-finish"]');
ok('Sesión guardada', (await val(() => window.__apex.store.S().gym.sessions.length)) === 1);
await tap('[data-act="gym-routines"]');
await sheetTop().locator('.opt').first().click(); await page.waitForTimeout(350);
await shot('20-editar-rutina');
await sheetTop().locator('[data-ok]').click(); await page.waitForTimeout(300);
await closeSheet();
await tap('[data-act="gym-progress"]');
await sheetTop().locator('.opt').first().click(); await page.waitForTimeout(350);
await shot('21-progreso-ejercicio');
await closeSheet();

// --- Progreso
await tap('.tab[data-tab="progreso"]');
await shot('22-progreso');
await tap('[data-act="prog-range"][data-v="90"]');
await tap('[data-act="measures"]');
await sheetTop().locator('[data-k="waist"]').fill('74');
await sheetTop().locator('[data-r="1"]').click(); await page.waitForTimeout(300);
ok('Medidas guardadas', await val(() => window.__apex.store.S().body.some((b) => b.waist === 74)));
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await shot('23-progreso-abajo');

// --- Ajustes: secciones
await tap('[data-act="settings"]');
for (const [k, name] of [['perfil', '24-perfil'], ['momentos', '25-momentos'], ['habitos', '26-habitos'], ['alimentos', '27-alimentos'], ['bench', '28-bench']]) {
  await sheetTop().locator(`[data-s="${k}"]`).click(); await page.waitForTimeout(350);
  await shot(name);
  if (k === 'bench') {
    await sheetTop().locator('[data-b="one"][data-id="t1"]').click();
    await page.waitForSelector('.test-row[data-tc="t1"] ul', { timeout: 10000 }).catch(() => {});
    await shot('29-bench-t1');
    const txt = await sheetTop().locator('.test-row[data-tc="t1"]').innerText();
    ok('Banco de pruebas corre t1', /esperado/.test(txt), txt.split('\n').slice(0, 5).join(' | '));
    const before = await val(() => window.__apex.store.S().entries.length);
    ok('Las pruebas no guardan nada', before === nEntries);
  }
  await closeSheet();
}
// tema oscuro
await sheetTop().locator('[data-s="tema"]').click(); await page.waitForTimeout(300);
await sheetTop().locator('.opt[data-v="dark"]').click(); await page.waitForTimeout(300);
await closeSheet();
await tap('.tab[data-tab="hoy"]');
await page.evaluate(() => window.scrollTo(0, 0));
await shot('30-hoy-oscuro');
await tap('.tab[data-tab="diario"]');
await shot('31-diario-oscuro');
await tap('.tab[data-tab="progreso"]');
await shot('32-progreso-oscuro');
await tap('.tab[data-tab="hoy"]');

// --- Excel: exportar
await tap('[data-act="settings"]');
const dl = page.waitForEvent('download', { timeout: 20000 });
await sheetTop().locator('[data-s="excel"]').click(); await page.waitForTimeout(300);
await sheetTop().locator('.opt[data-v="todo"]').click();
const d = await dl.catch((e) => null);
if (d) { await d.saveAs(`${OUT}/export.xlsx`); ok('Excel exportado', true, d.suggestedFilename()); } else ok('Excel exportado', false);
// importar planilla anterior (solo si está la planilla de referencia, que no se sube al repositorio)
const V1 = path.resolve('../../ref/consolidado.xlsx');
if (fs.existsSync(V1)) {
  const fc = page.waitForEvent('filechooser');
  await sheetTop().locator('[data-s="import"]').click();
  const chooser = await fc;
  await chooser.setFiles(V1);
  await page.waitForSelector('.sheet-wrap:last-child [data-r="1"]', { timeout: 15000 }).catch(() => {});
  await shot('33-importar');
  const impText = await sheetTop().innerText();
  await sheetTop().locator('[data-r="1"]').click(); await page.waitForTimeout(600);
  const nItems = await val(() => window.__apex.store.S().entries.reduce((a, e) => a + e.items.length, 0));
  ok('Importa la planilla anterior', nItems > 200, `${nItems} alimentos · ${impText.replace(/\s+/g, ' ').slice(0, 220)}`);
  await closeSheet();
  await tap('.tab[data-tab="diario"]');
  await tap('[data-act="dia-mode"][data-v="semana"]');
  await tap('[data-act="dia-pick"]');
  await sheetTop().locator('[data-nav="-1"]').click();
  await sheetTop().locator('.cal-d[data-d="2026-09-30"]').click(); await page.waitForTimeout(300);
  await shot('34-diario-importado');
  await tap('.tab[data-tab="progreso"]');
  await tap('[data-act="prog-range"][data-v="todo"]');
  await shot('35-progreso-importado');
} else { ok('Importa la planilla anterior (omitido: falta ref/consolidado.xlsx)', true); await closeSheet(); }

// IA propia: un mensaje que entiende por completo se resuelve al instante, sin consultar a Gemini
await tap('.tab[data-tab="hoy"]');
await tap('#tab-rec');
const callsBefore = aiCalls;
await sheetTop().locator('#lg-text').fill('2 huevos y una banana');
await sheetTop().locator('[data-l="analyze"]').click();
await page.waitForSelector('[data-r="save"]', { timeout: 3000 }).catch(() => {});
const localTxt = await sheetTop().innerText();
await shot('35b-ia-propia');
ok('IA propia: resuelve al instante sin Gemini', /IA propia/.test(localTxt) && aiCalls === callsBefore, localTxt.replace(/\s+/g, ' ').slice(0, 120));
await sheetTop().locator('[data-r="gemini"]').click();
for (let i = 0; i < 40 && aiCalls === callsBefore; i++) await page.waitForTimeout(250);
await page.waitForSelector('.rv-meta:has-text("Flash")', { timeout: 10000 }).catch(() => {});
ok('"Revisar con Gemini" consulta a la IA', aiCalls > callsBefore, `${aiCalls - callsBefore} consultas`);
await closeSheet();
// análisis en segundo plano: cerrar la ventana mientras la IA trabaja (con la IA propia apagada, para forzar Gemini)
await val(() => { window.__apex.store.S().settings.ai.localFirst = false; });
await tap('#tab-rec');
await sheetTop().locator('#lg-text').fill('Hoy 2 vasos de agua, de desayuno 1 porcion del bizcochuelo de ayer, almuerzo: hamburguesa 90g, brocoli 68g, ensalada rusa(papa con arvejas zanahoria y mayonesa, mucha papa) 450g');
await sheetTop().locator('[data-l="analyze"]').click();
await page.waitForTimeout(1500);
await shot('36-analizando');
await closeSheet();
ok('Al cerrar, aparece el aviso de segundo plano', await page.locator('#bg-status').count() === 1);
await shot('37-segundo-plano');
await tap('.tab[data-tab="gym"]');
await page.waitForSelector('#toast:has-text("Listo")', { timeout: 10000 }).catch(() => {});
ok('Se guardó solo, sin cambiar de pantalla', (await val(() => window.__apex.ui.tab)) === 'gym' && await val(() => window.__apex.store.S().entries.some((e) => e.items.some((i) => /ensalada rusa/i.test(i.name)))), `${await page.locator('#toast').innerText()} · pestaña ${await val(() => window.__apex.ui.tab)} · ${await val(() => window.__apex.store.S().entries.flatMap((e) => e.items.map((i) => i.name)).filter((n) => /ensalada/i.test(n)).join(',') || 'sin ensalada')}`);
await shot('38-guardado-fondo');
await val(() => { window.__apex.store.S().settings.ai.localFirst = true; });

// editar un alimento guardado: el botón Guardar aplica
await tap('.tab[data-tab="hoy"]');
await page.evaluate(() => window.scrollTo(0, 0));
await tap('.meal-head');
const itId = await page.locator('.meal.open .item-row').first().getAttribute('data-id');
await tap('.meal.open .item-row');
await sheetTop().locator('[data-f="name"]').fill('Alimento editado');
await sheetTop().locator('[data-f="qty"]').fill('3');
await sheetTop().locator('[data-e="save"]').click(); await page.waitForTimeout(400);
const edited = await val((id) => window.__apex.store.findItem(id)?.item, itId);
ok('Editar alimento: Guardar aplica', edited && edited.name === 'Alimento editado' && edited.qty === 3, edited ? `${edited.name} ${edited.qty}` : 'no encontrado');

// pestaña personalizable → Estudio
await tap('[data-act="settings"]');
await sheetTop().locator('[data-s="slot"]').click(); await page.waitForTimeout(300);
await shot('40-elegir-pestana');
await sheetTop().locator('.opt[data-v="estudio"]').click(); await page.waitForTimeout(300);
await closeSheet();
ok('La pestaña cambia a Estudio', await page.locator('.tab[data-tab="estudio"]').count() === 1);
await tap('.tab[data-tab="estudio"]');
await shot('41-estudio-vacio');
await tap('[data-act="st-subject-new"]');
await sheetTop().locator('input').fill('Física II');
await sheetTop().locator('[data-r="1"]').click(); await page.waitForTimeout(300);
await tap('[data-act="st-start"]');
await sheetTop().locator('.opt').first().click(); await page.waitForTimeout(300);
await sheetTop().locator('.opt[data-v="pomodoro"]').click(); await page.waitForTimeout(1300);
ok('Cronómetro pomodoro corriendo', /\d\d:\d\d/.test(await page.locator('#st-clock').innerText()), await page.locator('#st-clock').innerText());
await shot('42-estudio-pomodoro');
await tap('[data-act="st-pause"]');
await page.evaluate(() => { window.__apex.store.S().study.active.workMs = 45 * 60000; });
await tap('[data-act="st-finish"]');
await sheetTop().locator('input').fill('Ejercicios de óptica');
await sheetTop().locator('[data-r="1"]').click(); await page.waitForTimeout(400);
const sess = await val(() => window.__apex.store.S().study.sessions);
ok('Sesión de estudio guardada y sumada al día', sess.length === 1 && sess[0].min === 45 && (await val(() => window.__apex.store.day(window.__apex.ui.date).study)) >= 0.75, JSON.stringify(sess[0]));
await tap('[data-act="st-event-new"]');
await sheetTop().locator('.opt[data-v="parcial"]').click(); await page.waitForTimeout(300);
await sheetTop().locator('.opt').first().click(); await page.waitForTimeout(300);
await sheetTop().locator('[data-k="title"]').fill('Unidades 1 a 3');
await sheetTop().locator('[data-r="1"]').click(); await page.waitForTimeout(300);
ok('Fecha de parcial agregada', (await val(() => window.__apex.store.S().study.events.length)) === 1);
await tap('[data-act="st-task-new"]');
await sheetTop().locator('.opt').first().click(); await page.waitForTimeout(300);
await sheetTop().locator('[data-k="text"]').fill('Resumen unidad 2');
await sheetTop().locator('[data-r="due"]').click(); await page.waitForTimeout(300);
await sheetTop().locator('[data-go="today"]').click(); await page.waitForTimeout(300);
await sheetTop().locator('[data-r="1"]').click(); await page.waitForTimeout(300);
const task = await val(() => window.__apex.store.S().study.tasks[0]);
ok('Pendiente con fecha', task && task.text === 'Resumen unidad 2' && !!task.due, JSON.stringify(task));
await tap('[data-act="st-task-toggle"]');
ok('Marcar pendiente hecho', await val(() => window.__apex.store.S().study.tasks[0].done));
await page.evaluate(() => window.scrollTo(0, 0));
await shot('43-estudio');
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await shot('44-estudio-abajo');
await tap('[data-act="st-subject"]');
await shot('45-materia');
await closeSheet();
await page.locator('.st-cal.tod').click(); await page.waitForTimeout(300);
await shot('46-estudio-dia');
await closeSheet();
// Hábitos
await tap('[data-act="settings"]');
await sheetTop().locator('[data-s="slot"]').click(); await page.waitForTimeout(300);
await sheetTop().locator('.opt[data-v="habitos"]').click(); await page.waitForTimeout(300);
await closeSheet();
await tap('.tab[data-tab="habitos"]');
const before = await val(() => window.__apex.store.day((() => { const d = new Date(); d.setDate(d.getDate() - 2); return d.toLocaleDateString('sv-SE'); })()).habits?.limpieza || false);
const d2 = await val(() => { const d = new Date(); d.setDate(d.getDate() - 2); return d.toLocaleDateString('sv-SE'); });
await page.locator(`.hb-cell[data-id="limpieza"][data-date="${d2}"]`).click(); await page.waitForTimeout(250);
ok('Hábitos: marcar un día anterior', (await val((d) => !!window.__apex.store.day(d).habits.limpieza, d2)) === !before);
await shot('47-habitos');
// diagnóstico
await tap('[data-act="settings"]');
await sheetTop().locator('[data-s="ia"]').click(); await page.waitForTimeout(300);
await sheetTop().locator('[data-a="diag"]').click();
await page.waitForSelector('.sheet-wrap:last-child [data-d="copy"]:not([disabled])', { timeout: 180000 }).catch(() => {});
await shot('48-diagnostico');
const diagTxt = await sheetTop().innerText();
ok('Diagnóstico completo', (diagTxt.match(/Gemini/g) || []).length >= 3, diagTxt.replace(/\s+/g, ' ').slice(0, 400));
await closeSheet(); await closeSheet(); await closeSheet().catch(() => {});

// actividad y gasto
await tap('.tab[data-tab="hoy"]');
await page.evaluate(() => window.scrollTo(0, 0));
ok('Línea de gasto estimado en Hoy', await page.locator('.energy-line').count() === 1, await page.locator('.energy-line').innerText());
await tap('[data-act="activity-add"]');
await sheetTop().locator('.opt[data-v="caminata"]').click(); await page.waitForTimeout(300);
await sheetTop().locator('[data-k="min"]').fill('45');
await sheetTop().locator('[data-r="1"]').click(); await page.waitForTimeout(400);
const act = await val(() => window.__apex.store.day(window.__apex.ui.date).activity);
ok('Caminata guardada', act && act.length === 1 && act[0].min === 45, JSON.stringify(act));
await tap('[data-act="energy"]');
await shot('50-gasto');
await closeSheet();
// perfil y metas con IA
await tap('[data-act="settings"]');
await sheetTop().locator('[data-s="perfil"]').click(); await page.waitForTimeout(400);
await sheetTop().locator('#g-ai').fill('Soy mujer, tengo 34 años, mido 1,62 y peso 70 kg. Voy al gimnasio 3 veces por semana y quiero bajar grasa');
await clearStamps();
await sheetTop().locator('[data-x="ai"]').click();
await page.waitForSelector('.goal-ai .banner', { timeout: 20000 }).catch(() => {});
await shot('51-metas-ia');
await sheetTop().locator('[data-x="save"]').click(); await page.waitForTimeout(500);
const gl = await val(() => ({ g: window.__apex.store.S().settings.goals, p: window.__apex.store.S().settings.profile }));
ok('Metas calculadas con IA y guardadas (y la suma cierra)', gl.g.kcal === gl.g.p * 4 + gl.g.c * 4 + gl.g.f * 9 && gl.g.kcal < 1900 && gl.g.p >= 100 && gl.g.p <= 135 && gl.p.goal === 'bajar' && gl.p.sex === 'f' && gl.p.heightCm === 162, JSON.stringify(gl.g));
await closeSheet();
await page.evaluate(() => window.scrollTo(0, 0));
await shot('52-hoy-deficit');
ok('En déficit, pasarse se marca en rojo', await page.locator('.hero.excess').count() === 1);
// análisis del progreso
await tap('.tab[data-tab="progreso"]');
await clearStamps();
// el día en curso no cuenta: se agrega otro día completo para tener 2
await val(() => { const s = window.__apex.store; const d = new Date(Date.now() - 3 * 86400000).toLocaleDateString('sv-SE'); s.addItems(d, 'almuerzo', [{ id: 'ix', name: 'Arroz con pollo', qty: 1, unit: 'porcion', grams: 400, per100: { kcal: 150, p: 12, c: 18, f: 3 }, basis: 'tabla' }]); s.commit('x'); });
await tap('[data-act="insight-run"]');
await sheetTop().locator('.opt[data-v="mes"]').click();
await page.waitForSelector('.ins-score', { timeout: 15000 }).catch(() => {});
await shot('53-analisis');
ok('Análisis del progreso', await page.locator('.ins-score').count() === 1);
await closeSheet();
console.log('URL tras análisis', page.url(), await page.locator('.sheet-wrap').count());
// fecha futura en Estudio
await tap('[data-act="settings"]');
await sheetTop().locator('[data-s="slot"]').click(); await page.waitForTimeout(300);
await sheetTop().locator('.opt[data-v="estudio"]').click(); await page.waitForTimeout(300);
await closeSheet();
await tap('.tab[data-tab="estudio"]');
console.log('URL estudio', page.url(), await page.locator('.view-title').innerText().catch(()=>'-'));
await tap('[data-act="st-event-new"]');
await sheetTop().locator('.opt[data-v="examen"]').click(); await page.waitForTimeout(300);
await sheetTop().locator('.opt').first().click(); await page.waitForTimeout(300);
console.log('URL', page.url()); await shot('54-debug-evento');
await sheetTop().locator('.date-field').click(); await page.waitForTimeout(300);
await sheetTop().locator('[data-nav="1"]').click(); await page.waitForTimeout(200);
const futureBtn = sheetTop().locator('.cal-d:not(.out)').nth(14);
ok('Calendario de exámenes permite fechas futuras', !(await futureBtn.isDisabled()));
await futureBtn.click(); await page.waitForTimeout(300);
await sheetTop().locator('[data-r="1"]').click(); await page.waitForTimeout(300);
const evs = await val(() => window.__apex.store.S().study.events.map((e) => e.date));
ok('Examen en fecha futura guardado', evs.some((d) => d > new Date().toLocaleDateString('sv-SE')), JSON.stringify(evs));

// botón atrás de Android cierra hojas
await tap('[data-act="settings"]');
await page.goBack(); await page.waitForTimeout(400);
ok('Atrás cierra la hoja', await page.locator('.sheet-wrap').count() === 0);

ok('IA simulada: llamadas', aiCalls >= 3, String(aiCalls));
globalThis.__done = true;
console.log(results.join('\n'));
console.log('\nErrores de consola:', errors.length ? '\n' + errors.join('\n') : 'ninguno');
await browser.close();
server.close();
