// Funciones de la 2.2.1: gimnasio (fallo, ordenar arrastrando, semanas/meses, editar sesiones), marcas en el Diario,
// promedios sin el día en curso, pesajes editables, borrador de Registrar, bebidas como agua y deslizar con animación.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

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
}).listen(8767);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-AR', timezoneId: 'America/Argentina/San_Juan' });
await ctx.route('**/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "export const GOOGLE_CLIENT_ID = '';\nexport const COMMUNITY_URL = '';\n" }));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|push service|AbortError|Registration failed|incognito/i.test(m.text())) errors.push('console: ' + m.text()); });
const res = [];
const ok = (n, c, x = '') => res.push(`${c ? '✓' : '✗'} ${n}${x ? ' — ' + x : ''}`);
const val = (fn, a) => page.evaluate(fn, a);
const shot = async (n) => { await page.waitForTimeout(250); await page.screenshot({ path: `${OUT}/${n}.png` }); };
const sheetTop = () => page.locator('.sheet-wrap').last();
const closeSheet = async () => { await sheetTop().locator('[data-sheet-close]').click(); await page.waitForTimeout(350); };
// gesto táctil con CDP
const cdp = await ctx.newCDPSession(page);
const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
async function swipe(x0, y0, x1, y1, steps = 8) {
  await touch('touchStart', x0, y0);
  for (let i = 1; i <= steps; i++) { await touch('touchMove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps); await page.waitForTimeout(16); }
  await touch('touchEnd'); await page.waitForTimeout(450);
}
async function longDrag(x, y0, y1) {
  await touch('touchStart', x, y0); await page.waitForTimeout(600);
  for (let i = 1; i <= 12; i++) { await touch('touchMove', x, y0 + ((y1 - y0) * i) / 12); await page.waitForTimeout(30); }
  await touch('touchEnd'); await page.waitForTimeout(500);
}

const iso = (d) => d.toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/San_Juan' });
const T = new Date(); const today = iso(T);
const ago = (n) => iso(new Date(T.getTime() - n * 86400000));
await ctx.addInitScript(([today, d1, d2, d3, d9]) => {
  if (localStorage.getItem('seeded')) return;
  localStorage.setItem('seeded', '1');
  const it = (n, kcal, p) => ({ id: 'i' + Math.random(), name: n, qty: 1, unit: 'porcion', grams: 100, per100: { kcal, p, c: 10, f: 5 }, basis: 'tabla' });
  const ent = (date, moment, kcal, p) => ({ id: 'e' + Math.random(), date, moment, items: [it('Comida', kcal, p)], createdAt: 1 });
  localStorage.setItem('apextrack_state_v2', JSON.stringify({
    entries: [ent(d1, 'almuerzo', 2000, 150), ent(d2, 'almuerzo', 2200, 160), ent(today, 'desayuno', 300, 10)],
    days: { [d1]: { gym: 'fui', activity: [{ id: 'a0', type: 'caminata', minutes: 30, km: 2.5 }] }, [d2]: { activity: [{ id: 'a1', type: 'caminata', minutes: 40, km: 3 }] }, [d9]: { gym: 'fui' } },
    body: [{ id: 'b1', date: d3, weight: 80 }, { id: 'b2', date: d1, weight: 88.8 }],
    gym: { routines: [{ id: 'r1', name: 'Torso', exercises: [{ id: 'x1', name: 'Press banca', sets: 2, reps: '8', rest: 90 }, { id: 'x2', name: 'Remo', sets: 2, reps: '10', rest: 90 }, { id: 'x3', name: 'Press militar', sets: 2, reps: '10', rest: 90 }] }],
      sessions: [{ id: 's1', date: d9, routineId: 'r1', routineName: 'Torso', done: true, exercises: [{ name: 'Press banca', sets: [{ kg: 60, reps: 8 }] }] }], active: null },
    settings: { onboarded: true, ai: { key: 'AIzaPrueba' } },
  }));
}, [today, ago(1), ago(2), ago(3), ago(9)]);

await page.goto('http://localhost:8767/');
await page.waitForSelector('.hero');
await page.waitForTimeout(600);
ok('Versión 2.2.2', await val(() => window.__apex.store.APP_VERSION) === '2.2.2');

// --- Promedios sin el día en curso (a menos que sea tarde y esté la cena)
const av = await val(() => { const s = window.__apex.store; return { a: s.averages(7), comp: s.dayComplete(new Date().toLocaleDateString('sv-SE')) }; });
ok('Promedios: hoy no cuenta mientras no terminó', av.a && Math.round(av.a.kcal) === 2100 && av.comp === (new Date().getHours() >= 22 && false), `prom ${Math.round(av.a?.kcal)} kcal`);

// --- Hoy: colores del gimnasio
await page.locator('[data-act="gym-day"][data-v="fui"]').click(); await page.waitForTimeout(300);
const bgFui = await page.locator('[data-act="gym-day"][data-v="fui"]').evaluate((b) => getComputedStyle(b).backgroundColor);
await page.locator('[data-act="gym-day"][data-v="no_fui"]').click(); await page.waitForTimeout(300);
const bgNo = await page.locator('[data-act="gym-day"][data-v="no_fui"]').evaluate((b) => getComputedStyle(b).backgroundColor);
await shot('v01-hoy-nofui');
ok('Hoy: "Fui" negro (modo claro) y "No fui" rojo', bgFui === 'rgb(24, 32, 27)' && /rgb\(184, 48, 79\)|rgb\(235, 109, 136\)/.test(bgNo), `${bgFui} / ${bgNo}`);
await page.locator('[data-act="gym-day"][data-v="no_fui"]').click(); await page.waitForTimeout(200);

// --- Hoy: deslizar la semana con animación
await page.evaluate(() => { window.scrollTo(0, 0); window.__anims = []; document.addEventListener('animationstart', (e) => window.__anims.push(e.animationName)); }); await page.waitForTimeout(200);
const d0 = await val(() => window.__apex.ui.date);
const ws = await page.locator('[data-swipe="week"]').boundingBox();
await swipe(ws.x + 30, ws.y + ws.height / 2, ws.x + ws.width - 30, ws.y + ws.height / 2);
const anim = await val(() => window.__anims.join(','));
const d1 = await val(() => window.__apex.ui.date);
await swipe(ws.x + ws.width - 30, ws.y + ws.height / 2, ws.x + 30, ws.y + ws.height / 2);
const d2 = await val(() => window.__apex.ui.date);
ok('Hoy: deslizar a la semana anterior y volver, con animación', d1 < d0 && d2 === d0 && /slide-from-l/.test(anim), `${d0} → ${d1} → ${d2} (${anim})`);

// --- Deslizar entre pestañas
await page.evaluate(() => window.scrollTo(0, 0));
const tabs0 = await val(() => window.__apex.ui.tab);
await swipe(380, 640, 60, 650);
const tabs1 = await val(() => window.__apex.ui.tab);
await swipe(60, 640, 380, 650);
const tabs2 = await val(() => window.__apex.ui.tab);
ok('Deslizar entre pestañas', tabs0 === 'hoy' && tabs1 === 'diario' && tabs2 === 'hoy', `${tabs0} → ${tabs1} → ${tabs2}`);

// --- Diario: marcas de gimnasio y caminata
await page.locator('.tab[data-tab="diario"]').click(); await page.waitForTimeout(400);
const mk = await val(() => ({ gym: document.querySelectorAll('.chart .mk-gym').length, walk: document.querySelectorAll('.chart .mk-walk').length }));
await shot('v02-diario-semana');
const statTxt = await page.locator('.stat-grid').innerText();
const stacked = await val(() => { const g = [...document.querySelectorAll('.chart .mk-gym')]; return g.some((r) => [...document.querySelectorAll('.chart .mk-walk')].some((w) => w.getAttribute('x') === r.getAttribute('x') && +w.getAttribute('y') > +r.getAttribute('y'))); });
ok('Diario semana: rayitas de gimnasio y caminata (una arriba de otra el mismo día)', mk.gym >= 1 && mk.walk >= 2 && stacked, JSON.stringify(mk));
ok('Diario: promedio sin hoy', /\(sin hoy\)/.test(statTxt) || !/hoy/.test(statTxt), statTxt.replace(/\s+/g, ' ').slice(0, 90));
await page.locator('[data-act="dia-mode"][data-v="mes"]').click(); await page.waitForTimeout(300);
const cm = await val(() => ({ gym: document.querySelectorAll('.cal-d.gym').length, walk: document.querySelectorAll('.cal-d .mk.walk').length }));
await shot('v03-diario-mes');
ok('Diario mes: días de gimnasio resaltados y caminata', cm.gym >= 1 && cm.walk >= 1, JSON.stringify(cm));
const m0 = await val(() => window.__apex.ui.diary.month);
const cb = await page.locator('[data-swipe="diarymonth"]').boundingBox();
await swipe(cb.x + 40, cb.y + 120, cb.x + cb.width - 40, cb.y + 125);
ok('Diario mes: deslizar al mes anterior', await val(() => window.__apex.ui.diary.month) < m0);
await page.locator('[data-act="dia-mode"][data-v="semana"]').click(); await page.waitForTimeout(200);

// --- Progreso: corregir y borrar pesajes
await page.locator('.tab[data-tab="progreso"]').click(); await page.waitForTimeout(400);
await page.locator('[data-act="weight-list"]').click(); await page.waitForTimeout(400);
await shot('v04-pesajes');
await sheetTop().locator('[data-w="edit"]').first().click(); await page.waitForTimeout(400);
await sheetTop().locator('[data-k="kg"]').fill('80,4');
await sheetTop().locator('[data-r="1"]').click(); await page.waitForTimeout(400);
const w1 = await val(() => window.__apex.store.weightSeries());
await sheetTop().locator('[data-w="del"]').last().click(); await page.waitForTimeout(300);
await sheetTop().locator('.btn.danger, [data-r="1"], .btn.primary').last().click(); await page.waitForTimeout(400);
const w2 = await val(() => window.__apex.store.weightSeries());
ok('Pesajes: corregir', w1.some((w) => w.kg === 80.4) && !w1.some((w) => w.kg === 88.8), JSON.stringify(w1));
ok('Pesajes: borrar', w2.length === 1 && w2[0].kg === 80.4, JSON.stringify(w2));
await page.keyboard.press('Escape').catch(() => {});
await val(() => { while (document.querySelector('.sheet-wrap')) { history.back(); break; } });
await page.waitForTimeout(400);
await val(() => window.__apex.render());

// --- Gimnasio: semanas y meses
await val(() => { window.__apex.ui.tab = 'gym'; window.__apex.render(); });
await page.waitForTimeout(300);
const g0 = await page.locator('[data-swipe="gymcal"]').innerText();
const gb = await page.locator('[data-swipe="gymcal"]').boundingBox();
await swipe(gb.x + 40, gb.y + gb.height / 2, gb.x + gb.width - 30, gb.y + gb.height / 2);
const g1 = await page.locator('[data-swipe="gymcal"]').innerText();
await swipe(gb.x + 40, gb.y + gb.height / 2, gb.x + gb.width - 30, gb.y + gb.height / 2);
const g2 = await page.locator('[data-swipe="gymcal"]').innerText();
ok('Gimnasio: semanas anteriores deslizando', /Esta semana/.test(g0) && /Semana pasada/.test(g1) && /1 \/ /.test(g1) && / al /.test(g2), `${g1.replace(/\s+/g, ' ').slice(0, 60)} | ${g2.replace(/\s+/g, ' ').slice(0, 40)}`);
await page.locator('[data-act="gymcal-mode"][data-v="mes"]').click(); await page.waitForTimeout(300);
await shot('v05-gym-mes');
ok('Gimnasio: vista de mes', (await page.locator('[data-swipe="gymcal"] .cal-d').count()) >= 28 && /días? de gimnasio/.test(await page.locator('[data-swipe="gymcal"]').innerText()));
await page.locator('[data-act="gymcal-mode"][data-v="semana"]').click(); await page.waitForTimeout(200);

// --- Sesión: la pestaña queda en Gym, fallo y ordenar arrastrando
await val(() => { window.__apex.ui.tab = 'gym'; window.__apex.render(); });
await page.locator('[data-act="gym-start"]').first().click(); await page.waitForTimeout(400);
await page.locator('.tab[data-tab="hoy"]').click(); await page.waitForTimeout(300);
const slot = await page.locator('.tab[data-slot]').getAttribute('data-tab');
ok('Con la sesión en curso la pestaña personalizable queda en Gym', slot === 'gym', slot);
await page.locator('.tab[data-slot]').click(); await page.waitForTimeout(400);
await page.locator('[data-act="set-fail"]').first().click(); await page.waitForTimeout(250);
const failOn = await val(() => window.__apex.store.S().gym.active.exercises[0].sets[0].fail === true);
ok('Botón de fallo entre reps y listo', failOn && await page.locator('.set-row').first().evaluate((r) => [...r.children].map((c) => c.className.split(' ')[0] || c.tagName).join(',')) === 'SPAN,input,input,set-fail,set-ok');
await page.evaluate(() => window.scrollTo(0, 0));
const cards = page.locator('[data-sort="session"] > .ex-card');
const b0 = await cards.nth(0).boundingBox(); const b2 = await cards.nth(2).boundingBox();
await longDrag(b0.x + b0.width / 2, b0.y + 22, b2.y + b2.height - 10);
const order = await val(() => window.__apex.store.S().gym.active.exercises.map((e) => e.name));
await shot('v06-sesion');
ok('Sesión: mantener apretado y arrastrar cambia el orden', order[0] !== 'Press banca', order.join(' · '));
// completar series y terminar
await val(() => { const A = window.__apex.store.S().gym.active; A.exercises.forEach((e) => e.sets.forEach((s) => { s.kg = 50; s.reps = 8; s.done = true; })); window.__apex.store.commit('gym'); });
await page.locator('[data-act="gym-finish"]').click(); await page.waitForTimeout(500);
const ses = await val(() => window.__apex.store.S().gym.sessions.at(-1));
const slot2 = await page.locator('.tab[data-slot]').getAttribute('data-tab');
ok('Al terminar se guarda el fallo', ses.exercises.some((e) => e.sets.some((s) => s.fail)), JSON.stringify(ses.exercises.map((e) => e.sets)));

// --- Editar una sesión del historial
await val(() => { window.__apex.ui.tab = 'gym'; window.__apex.render(); });
await page.locator('[data-act="gym-session"]').first().click(); await page.waitForTimeout(400);
await sheetTop().locator('[data-edit]').click(); await page.waitForTimeout(500);
await sheetTop().locator('input[data-k="reps"]').first().fill('12');
await sheetTop().locator('[data-adds="0"]').click(); await page.waitForTimeout(200);
await sheetTop().locator('input[data-k="reps"]').nth(2).fill('6');
await shot('v07-editar-sesion');
await sheetTop().locator('[data-save]').click(); await page.waitForTimeout(500);
const ses2 = await val((id) => window.__apex.store.S().gym.sessions.find((s) => s.id === id), ses.id);
ok('Editar sesión: corregir reps y agregar serie', ses2.exercises[0].sets[0].reps === 12 && ses2.exercises[0].sets.length === 3, JSON.stringify(ses2.exercises[0].sets));
await val(() => { document.querySelectorAll('.sheet-wrap').forEach(() => history.back()); });
await page.waitForTimeout(500);

// --- Rutina: ordenar arrastrando desde el asa
await page.locator('[data-act="gym-routines"]').click(); await page.waitForTimeout(400);
await sheetTop().locator('.opt[data-id="r1"]').click(); await page.waitForTimeout(500);
const h0 = await sheetTop().locator('[data-sort-handle]').nth(0).boundingBox();
const h2 = await sheetTop().locator('[data-sort="routine"] > [data-sort-item]').nth(2).boundingBox();
await touch('touchStart', h0.x + h0.width / 2, h0.y + h0.height / 2);
for (let i = 1; i <= 12; i++) { await touch('touchMove', h0.x + h0.width / 2, h0.y + h0.height / 2 + ((h2.y + h2.height - 10 - h0.y) * i) / 12); await page.waitForTimeout(30); }
await touch('touchEnd'); await page.waitForTimeout(500);
await sheetTop().locator('[data-ok]').click(); await page.waitForTimeout(400);
const rOrder = await val(() => window.__apex.store.routines()[0].exercises.map((e) => e.name));
ok('Rutina: arrastrar para ordenar', rOrder[0] !== 'Press banca' && rOrder.includes('Press banca'), rOrder.join(' · '));
await val(() => { document.querySelectorAll('.sheet-wrap').forEach(() => history.back()); });
await page.waitForTimeout(500);

// --- Registrar: el borrador vuelve si se cierra sin analizar; al recargar, no
await val(() => window.__apex.openLogger({}));
await page.waitForTimeout(400);
await sheetTop().locator('#lg-text').fill('almuerzo fideos con tuco');
await closeSheet();
await val(() => window.__apex.openLogger({}));
await page.waitForTimeout(400);
const kept = await sheetTop().locator('#lg-text').inputValue();
ok('Registrar: el texto queda al volver a abrir', kept === 'almuerzo fideos con tuco', kept);
await closeSheet();
await page.reload(); await page.waitForSelector('.hero'); await page.waitForTimeout(500);
await val(() => window.__apex.openLogger({}));
await page.waitForTimeout(400);
ok('Registrar: al recargar la página ya no está', (await sheetTop().locator('#lg-text').inputValue()) === '');
await closeSheet();

// --- Bebidas como agua
const hyd = await val(async () => {
  const AI = window.__apex.AI;
  return { mate: AI.hydrationMl('Mate', { liq: true, grams: 500 }), gas: AI.hydrationMl('Gaseosa cola', { liq: true, grams: 350 }), vino: AI.hydrationMl('Vino tinto', { liq: true, grams: 200 }), leche: AI.hydrationMl('Leche entera', { liq: true, grams: 200 }), cafe: AI.hydrationMl('Café con leche', { liq: true, grams: 200 }) };
});
ok('Mate, gaseosa y café suman agua; vino y leche no', hyd.mate === 500 && hyd.gas === 350 && hyd.cafe === 200 && !hyd.vino && !hyd.leche, JSON.stringify(hyd));

ok('Sin errores', !errors.length, errors.slice(0, 3).join(' | '));
console.log(res.join('\n'));
await browser.close(); server.close();
