// Funciones de la 2.5: pestañas nuevas y flechita, recordatorios (service worker real), resumen
// semanal con IA simulada, capturas compartidas del reloj y accesos directos.
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
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(req.method === 'POST' ? 405 : 404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(8766);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-AR', timezoneId: 'America/Argentina/San_Juan' });
await ctx.grantPermissions(['notifications'], { origin: 'http://localhost:8766' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|push service|AbortError|Registration failed/i.test(m.text())) errors.push('console: ' + m.text()); });
const res = [];
const ok = (n, c, x = '') => res.push(`${c ? '✓' : '✗'} ${n}${x ? ' — ' + x : ''}`);
const val = (fn, a) => page.evaluate(fn, a);
const shot = async (n) => { await page.waitForTimeout(250); await page.screenshot({ path: `${OUT}/${n}.png` }); };
const sheetTop = () => page.locator('.sheet-wrap').last();
const closeSheet = async () => { await sheetTop().locator('[data-sheet-close]').click(); await page.waitForTimeout(300); };

// configuración de prueba: servidor de la comunidad simulado
await ctx.route('**/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "export const GOOGLE_CLIENT_ID = '';\nexport const COMMUNITY_URL = 'https://comunidad.test/exec';\n" }));
const comm = { posts: [], plans: 0 };
await ctx.route('https://comunidad.test/**', (r) => {
  const q = r.request();
  if (q.method() === 'POST') {
    const b = JSON.parse(q.postData()); comm.posts.push(b);
    if (b.op === 'plan') return r.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: comm.plans++ ? { ok: false, error: 'usado' } : { ok: true, plan: { sex: 'm', age: 28, heightCm: 178, weightKg: 84, goal: 'bajar', level: 'moderado', gymDays: 4, kcal: 2200, protein: 170, carbs: 210, fat: 70, sugarMax: 55, waterMl: 2950, explanation: 'Hombre de 28 años, 1,78 m y 84 kg, entrena 4 veces por semana y quiere bajar grasa', missing: [], caution: '', diet: 'sin_especificar', conditions: ['hipertension'], proteinPerKg: 2.1, carbsMax: null, preferences: 'No come pescado.' } } });
    return r.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { ok: true, horarios: (b.times || []).length } });
  }
  const u = new URL(q.url());
  if (u.searchParams.get('op') === 'vapid') return r.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { ok: true, key: 'BK96qkf--vc986EMsIeBrYpS2D1PQ5x8b1xvdPjfnLp9cyk9U2V6Kx3b3RAhqLM3TzwkSyNHTQ1NqzT1RcT6pX8' } });
  return r.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { ok: true, foods: [], phrases: {} } });
});
let aiCalls = 0;
await ctx.route('**/generativelanguage.googleapis.com/**', (r) => {
  if (r.request().url().includes('/models?')) return r.fulfill({ json: { models: [{ name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] }] } });
  aiCalls++;
  const body = JSON.stringify(r.request().postDataJSON());
  let out;
  if (/Proponé comidas concretas/.test(body)) out = { options: [
    { title: 'Pollo con arroz', why: 'Te faltan 60 g de proteína', isNew: false, items: [{ name: 'Pechuga de pollo', quantity: 200, unit: 'g', grams: 200, per100: { kcal: 165, protein: 31, carbs: 0, fat: 3.6 } }, { name: 'Arroz blanco cocido', quantity: 150, unit: 'g', grams: 150, per100: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 } }] },
    { title: 'Bowl de quinoa con salmón', why: 'Nueva: omega 3 y proteína', isNew: true, items: [{ name: 'Quinoa cocida', quantity: 150, unit: 'g', grams: 150, per100: { kcal: 120, protein: 4.4, carbs: 19, fat: 1.9, fiber: 2.8 } }, { name: 'Salmón rosado', quantity: 130, unit: 'g', grams: 130, per100: { kcal: 208, protein: 20, carbs: 0, fat: 13 } }] }] };
  else if (/coach que revisa el registro/.test(body)) out = { titulo: 'Buena semana', puntaje: 7.5, resumen: 'Vas bien con la proteína.', bien: ['Proteína alta'], mal: ['Poca agua'], mejorar: ['Tomá 2 vasos más'], cambiar: ['Cambiá la gaseosa por agua con gas: −200 kcal'], evitar: ['Picar después de cenar'], proximo_paso: 'Agua con cada comida' };
  else out = { transcript: '', items: [], water: [], habits: [], gym: [], weight: [], skipped: [], questions: [], activity: [{ date: new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/San_Juan' }), type: 'caminata', steps: 9450, km: 6.8, kcal: 412, from_device: true, minutes: 75 }] };
  return r.fulfill({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] } });
});

await page.goto('http://localhost:8766/');
await page.waitForSelector('.hero');
// --- Bienvenida: datos → metas con la IA de bienvenida → pestaña → recorrido → clave propia
await page.waitForSelector('.sheet-wrap .opt[data-v="nuevo"]', { timeout: 5000 });
await sheetTop().locator('.opt[data-v="nuevo"]').click(); await page.waitForTimeout(500);
await sheetTop().locator('#ob-text').fill('Tengo 28 años, soy hombre, mido 1,78 y peso 84 kg. Voy al gimnasio 4 veces por semana y quiero bajar grasa.');
await sheetTop().locator('[data-o="calc"]').click(); await page.waitForTimeout(1200);
await shot('f00-bienvenida-metas');
const prof = await val(() => ({ g: window.__apex.store.S().settings.goals, p: window.__apex.store.S().settings.profile, used: !!window.__apex.store.S().settings.onboardAI, key: window.__apex.store.S().settings.ai.key }));
ok('Bienvenida: la IA entiende los datos y la app calcula metas coherentes', prof.g.kcal === prof.g.p * 4 + prof.g.c * 4 + prof.g.f * 9 && prof.g.p === 176 && prof.p.heightCm === 178 && prof.p.goal === 'bajar' && prof.used && !prof.key, `${prof.g.kcal} kcal · P ${prof.g.p} · C ${prof.g.c} · G ${prof.g.f}`);
const obTxt = await sheetTop().innerText();
ok('Muestra la cuenta de los macros', /\+ .* = 2\.\d{3} kcal/.test(obTxt));
ok('Respeta la proteína pedida y tiene en cuenta la salud', /2,1 g por kg de tu peso, como pediste/.test(obTxt) && /presión/.test(obTxt), obTxt.replace(/\s+/g, ' ').slice(0, 200));
ok('Guarda dieta, salud y gustos para la IA', await val(() => { const S = window.__apex.store.S(); return S.settings.profile.conditions.includes('hipertension') && /No come pescado/.test(S.settings.ai.notes) && /Salud: Presión alta/.test(S.settings.ai.notes); }));
ok('La app nunca recibe la clave de bienvenida', !JSON.stringify(comm.posts).includes('AQ.') && comm.posts.some((x) => x.op === 'plan' && /^ins_/.test(x.install)));
await sheetTop().locator('[data-o="ok"]').click(); await page.waitForTimeout(500);
const tabOpts = await sheetTop().innerText();
ok('Sugiere el ayuno a quien quiere bajar de peso', /Recomendado para tu objetivo de bajar de peso/.test(tabOpts));
await sheetTop().locator('.opt[data-v="gym"]').click(); await page.waitForTimeout(500);
await shot('f00b-recorrido');
let slides = 0;
while (await sheetTop().locator('[data-t="next"]').count() && slides < 10) { slides++; await sheetTop().locator('[data-t="next"]').click(); await page.waitForTimeout(250); }
ok('Mini recorrido', slides === 6, `${slides} pantallas`);
await shot('f00c-clave');
ok('Al final lleva a crear la clave propia', /Último paso: tu clave de IA/.test(await sheetTop().innerText()) && await sheetTop().locator('a[href*="aistudio.google.com/apikey"]').count() === 1);
await sheetTop().locator('[data-k="paste"]').click(); await page.waitForTimeout(500);
ok('"Ya la copié" abre la configuración de la clave', await sheetTop().locator('#ai-key').count() === 1);
await closeSheet();
ok('La clave de bienvenida no se vuelve a usar', (await val(async () => { const m = await import('./js/onboarding.js'); return m.aboutYou ? true : false; })) && comm.plans === 1);
// datos de la semana pasada y de hoy
await val(() => {
  const st = window.__apex.store; const S = st.S();
  S.settings.ai.key = 'AQ.prueba'; S.settings.goals = { ...S.settings.goals, kcal: 2400, p: 150, waterMl: 2500, gymDays: 4 };
  const D = (n) => { const x = new Date(); x.setDate(x.getDate() - n); return x.toLocaleDateString('sv-SE'); };
  for (let i = 1; i <= 14; i++) {
    st.addItems(D(i), 'almuerzo', [{ name: 'Pollo', qty: 250, unit: 'g', grams: 250, per100: { kcal: 165, p: 31, c: 0, f: 3.6, s: 0, fb: 0 } }, { name: 'Arroz', qty: 150, unit: 'g', grams: 150, per100: { kcal: 356, p: 7, c: 78, f: 0.6, s: 0, fb: 1 } }]);
    st.addItems(D(i), 'cena', [{ name: 'Gaseosa común', qty: 500, unit: 'ml', grams: 500, liq: true, per100: { kcal: 42, p: 0, c: 10.6, f: 0, s: 10.6, fb: 0 } }, { name: 'Pizza muzzarella', qty: 3, unit: 'porcion', grams: 360, per100: { kcal: 260, p: 11, c: 30, f: 10, s: 2, fb: 1.5 } }]);
    st.addWater(D(i), 1500); if (i % 2) st.setGym(D(i), 'fui', '');
    st.upsertBody(D(i), { weight: 75 - i * 0.05 });
  }
  st.commit('test');
  return st.flush();
});
await page.reload(); await page.waitForSelector('.hero'); await page.waitForTimeout(1200);

// --- Resumen semanal automático
const wk = await val(() => window.__apex.store.S().weekly || []);
ok('Arma solo el resumen de la semana pasada', wk.length === 1 && wk[0].full && wk[0].st.logged === 7, wk[0] && `${wk[0].from} a ${wk[0].to}, ${wk[0].st.score}/10`);
ok('Muestra el aviso en Hoy', await page.locator('[data-act="weekly-open"]').count() === 1);
await shot('f01-hoy-resumen');
await page.waitForTimeout(800);
ok('Pide sola los consejos a la IA (1 consulta)', aiCalls === 1 && !!(await val(() => window.__apex.store.S().weekly[0].ai)), `${aiCalls} consultas`);
await page.locator('[data-act="weekly-open"]').click(); await page.waitForTimeout(500);
const wtxt = await sheetTop().innerText();
await shot('f02-resumen-semanal');
ok('Resumen: números, mejorar, cambiar e IA', /Proteína por día/.test(wtxt) && /Qué mejorar/.test(wtxt) && /Qué cambiar/.test(wtxt) && /gaseosa por agua con gas/i.test(wtxt), wtxt.replace(/\s+/g, ' ').slice(0, 160));
ok('Consejo concreto sin IA (lo que más calorías sumó)', /Pizza muzzarella/.test(wtxt));
await closeSheet();
ok('El aviso desaparece una vez visto', await page.locator('[data-act="weekly-open"]').count() === 0);

// --- Ajustes: orden de Personalizar
await page.locator('[data-act="settings"]').click(); await page.waitForTimeout(400);
const firstRow = await sheetTop().locator('.set-group:has(h3:text("Personalizar")) [data-s]').first().getAttribute('data-s');
ok('"Pestaña personalizable" es la primera de Personalizar', firstRow === 'slot', firstRow);
// tamaño del texto
const h0 = await page.locator('.view-title, .hero-num').first().boundingBox().catch(() => null);
await sheetTop().locator('[data-s="texto"]').click(); await page.waitForTimeout(300);
await sheetTop().locator('.opt[data-v="1.25"]').click(); await page.waitForTimeout(400);
await shot('f03b-texto-grande');
const vw = await val(() => ({ w: window.innerWidth, sw: document.documentElement.scrollWidth }));
ok('Tamaño del texto: Muy grande (todo escala y no se corta)', Math.abs(vw.w - 412 / 1.25) < 3 && vw.sw <= vw.w + 1 && (await val(() => localStorage.getItem('apextrack_zoom'))) === '1.25', JSON.stringify(vw));
await sheetTop().locator('[data-s="texto"]').click(); await page.waitForTimeout(300);
await sheetTop().locator('.opt[data-v="1"]').click(); await page.waitForTimeout(300);
ok('Volver a Normal deja el tamaño original', (await val(() => window.innerWidth)) === 412);
// privacidad: contador anónimo e identificación opcional
await sheetTop().locator('[data-s="quien"]').click(); await page.waitForTimeout(300);
await sheetTop().locator('#id-name').fill('Caro'); await sheetTop().locator('#id-contact').fill('caro@mail.com');
await sheetTop().locator('[data-i="on"]').click(); await page.waitForTimeout(800);
const pings = comm.posts.filter((x) => x.op === 'ping');
ok('Identificarse: se envía nombre y contacto solo si la persona lo elige', pings.length >= 1 && pings[pings.length - 1].ident?.name === 'Caro' && /^ins_/.test(pings[pings.length - 1].install), JSON.stringify(pings[pings.length - 1]).slice(0, 120));
ok('Antes de elegirlo, los avisos de uso iban sin nombre', pings.slice(0, -1).every((x) => !x.ident));
await sheetTop().locator('[data-s="quien"]').click(); await page.waitForTimeout(300);
await sheetTop().locator('[data-i="off"]').click(); await page.waitForTimeout(800);
const lastPing = comm.posts.filter((x) => x.op === 'ping').pop();
ok('Dejar de compartir avisa para borrar el nombre', lastPing.ident === null);
// --- Recordatorios
await sheetTop().locator('[data-s="avisos"]').click(); await page.waitForTimeout(400);
await shot('f03-recordatorios');
await sheetTop().locator('[data-n="master"]').click(); await page.waitForTimeout(2500);
const rem = await val(() => window.__apex.store.S().settings.reminders);
ok('Activa los recordatorios', rem.on === true, `push=${rem.push} ${rem.pushError || ''}`);
await shot('f04-recordatorios-on');
await sheetTop().locator('[data-n="edit"][data-id="r_almuerzo"]').click(); await page.waitForTimeout(400);
await shot('f05-editar');
await sheetTop().locator('[data-e="h+"]').click(); await sheetTop().locator('[data-e="m+"]').click();
await sheetTop().locator('[data-e="day"][data-d="0"]').click();
await sheetTop().locator('[data-e="save"]').click(); await page.waitForTimeout(300);
const alm = await val(() => window.__apex.store.S().settings.reminders.list.find((x) => x.id === 'r_almuerzo'));
ok('Editar hora y días', alm.time === '15:00' && !alm.days.includes(0), `${alm.time} ${alm.days.join(',')}`);
await closeSheet(); await closeSheet();
// el service worker muestra un aviso vencido (almuerzo de hoy sin registrar)
await val(async () => {
  const S = window.__apex.store.S();
  const now = new Date(); const t = new Date(now.getTime() - 5 * 60000);
  S.settings.reminders.list.push({ id: 'r_test', type: 'comida', ref: 'merienda', time: `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`, days: [0, 1, 2, 3, 4, 5, 6], on: true, onlyIfMissing: true });
  window.__apex.store.commit('x'); await window.__apex.store.flush();
  const reg = await navigator.serviceWorker.ready; reg.active.postMessage('avisos');
});
await page.waitForTimeout(1500);
const notes = await val(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => `${n.tag}: ${n.title}`));
ok('El service worker muestra el aviso vencido', notes.some((n) => /^r_test: .*merienda/i.test(n)), notes.join(' | '));
await val(async () => (await navigator.serviceWorker.ready).active.postMessage('avisos'));
await page.waitForTimeout(800);
const notes2 = await val(async () => (await (await navigator.serviceWorker.ready).getNotifications()).length);
ok('No lo repite', notes2 === notes.length);

// --- Pestañas personalizables: flechita
await page.locator('#slot-more').click(); await page.waitForTimeout(300);
await shot('f06-flechita');
const opts = await page.locator('#slot-menu [data-slot-go]').count();
ok('La flechita despliega las 7 pestañas (sin Agua)', opts === 7 && await page.locator('#slot-menu [data-slot-go="agua"]').count() === 0, String(opts));
await page.locator('#slot-menu [data-slot-go="ayuno"]').click(); await page.waitForTimeout(400);
ok('Abre Ayuno sin cambiar la principal', (await val(() => window.__apex.ui.tab)) === 'ayuno' && (await val(() => window.__apex.store.S().settings.ui.slotTab || 'gym')) === 'gym');
await page.locator('#view [data-act="fast-start-ago"]').click(); await page.waitForTimeout(300);
for (let i = 0; i < 28; i++) await sheetTop().locator('[data-a="+"]').click();
await sheetTop().locator('[data-a="ok"]').click(); await page.waitForTimeout(500);
await shot('f07-ayuno');
const fa = await val(() => window.__apex.store.S().fasting);
ok('Ayuno: empezar "hace 16 h" (16:8)', fa.active && Math.abs((Date.now() - fa.active.start) / 3600000 - 16) < 0.1 && fa.active.goalH === 16, `${((Date.now() - fa.active?.start) / 3600000).toFixed(1)} h`);
ok('Muestra el cronómetro y que está completo', /Ayuno completado/.test(await page.locator('#view').innerText()));
await val(async () => { (await navigator.serviceWorker.ready).active.postMessage('avisos'); });
await page.waitForTimeout(1200);
const fn = await val(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => n.title));
ok('Aviso de ayuno completado', fn.some((t) => /Completaste tu ayuno de 16 h/.test(t)), fn.join(' | '));
await page.locator('#view [data-act="fast-stop"]').click(); await page.waitForTimeout(400);
ok('Termina y queda en el historial', (await val(() => window.__apex.store.S().fasting.history.length)) === 1 && !(await val(() => window.__apex.store.S().fasting.active)));
await page.locator('.tab[data-tab="hoy"]').click(); await page.waitForTimeout(300);
ok('Al volver, el botón muestra la principal', (await page.locator('.tab[data-slot]').getAttribute('data-tab')) === 'gym');
await page.locator('.tab[data-slot]').click(); await page.waitForTimeout(300);
ok('Tocar la pestaña (sin flechita) abre la principal', (await val(() => window.__apex.ui.tab)) === 'gym');
// Actividad: pasos calculados desde la distancia y meta configurable
await page.locator('#slot-more').click(); await page.waitForTimeout(200);
await page.locator('#slot-menu [data-slot-go="actividad"]').click(); await page.waitForTimeout(400);
await val(() => { const st = window.__apex.store; window.__apex.EN.addActivity(new Date().toLocaleDateString('sv-SE'), { type: 'caminata', km: 5 }); st.commit('x'); });
await page.waitForTimeout(300);
const actTxt = await page.locator('#view').innerText();
ok('5 km caminados con 1,78 m → pasos calculados', /Pasos de hoy[\s\S]*6\.7\d\d/.test(actTxt) && /≈ 6\.7\d\d pasos/.test(actTxt), (actTxt.match(/≈ [\d.]+ pasos/) || [''])[0]);
await page.locator('#view [data-act="steps-goal"]').click(); await page.waitForTimeout(300);
await sheetTop().locator('input').fill('10000'); await sheetTop().locator('[data-r="1"]').click(); await page.waitForTimeout(300);
ok('Meta de pasos configurable', (await val(() => window.__apex.store.S().settings.goals.steps)) === 10000 && /Meta 10\.000/.test(await page.locator('#view').innerText()));
await shot('f08-actividad');
await val(() => { const d = window.__apex.store.ensureDay(new Date().toLocaleDateString('sv-SE')); d.activity = []; window.__apex.store.commit('x'); });
ok('Pestaña Actividad', /Pasos de hoy/.test(await page.locator('#view').innerText()));
// ¿Qué como ahora?
await page.locator('.tab[data-tab="hoy"]').click(); await page.waitForTimeout(300);
await page.locator('[data-act="ideas-open"]').click(); await page.waitForTimeout(500);
const idTxt = await sheetTop().innerText();
await shot('f10-ideas');
ok('¿Qué como?: lo que queda, historial y biblioteca', /Te queda hoy/.test(idTxt) && /De tu historial/.test(idTxt) && /Ideas nuevas con tu biblioteca/.test(idTxt) && (await sheetTop().locator('[data-src="hist"]').count()) >= 1 && (await sheetTop().locator('[data-src="lib"]').count()) === 3, idTxt.replace(/\s+/g, ' ').slice(0, 120));
await sheetTop().locator('[data-idea="ai"]').click(); await page.waitForTimeout(1500);
const aiTxt = await sheetTop().innerText();
await shot('f11-ideas-ia');
ok('Ideas de la IA (de siempre y nuevas)', (await sheetTop().locator('[data-src="ai"]').count()) === 2 && /Nueva/.test(aiTxt), aiTxt.replace(/\s+/g, ' ').slice(0, 140));
const before = await val(() => window.__apex.store.dayTotals(new Date().toLocaleDateString('sv-SE')).items);
await sheetTop().locator('[data-src="ai"]').first().click(); await page.waitForTimeout(400);
ok('Agregar una idea al día', (await val(() => window.__apex.store.dayTotals(new Date().toLocaleDateString('sv-SE')).items)) > before);
await closeSheet();

// --- Sueño
await page.locator('#slot-more').click(); await page.waitForTimeout(200);
ok('La flechita incluye Sueño', await page.locator('#slot-menu [data-slot-go="sueno"]').count() === 1);
await page.locator('#slot-menu [data-slot-go="sueno"]').click(); await page.waitForTimeout(400);
await page.locator('#view [data-act="sleep-log"]').click(); await page.waitForTimeout(400);
await sheetTop().locator('[data-z="bed-"]').click(); await sheetTop().locator('[data-z="bed-"]').click();
await sheetTop().locator('[data-z="q"][data-v="4"]').click(); await sheetTop().locator('[data-z="f"][data-v="pantalla"]').click();
await shot('f12-sueno-registrar');
await sheetTop().locator('[data-z="save"]').click(); await page.waitForTimeout(400);
const night = await val(() => window.__apex.store.S().sleep.nights.slice(-1)[0]);
ok('Registrar una noche (hora, calidad y qué pasó)', night && Math.abs(night.hours - 8) < 0.01 && night.quality === 4 && night.factors.includes('pantalla'), JSON.stringify(night && { h: night.hours, q: night.quality, f: night.factors }));
// historial para ver qué influye
await val(() => { const sl = window.__apex.store.S().sleep; const D = (n) => { const x = new Date(); x.setDate(x.getDate() - n); return x.toLocaleDateString('sv-SE'); };
  for (let i = 1; i <= 8; i++) { const wake = new Date(D(i) + 'T07:00').getTime(); const pant = i % 2 === 0; const h = pant ? 6 : 7.8; sl.nights.push({ id: 'x' + i, date: D(i), bed: wake - h * 3600000, wake, hours: h, quality: pant ? 2 : 4, awake: 0, factors: pant ? ['pantalla'] : [] }); }
  sl.nights.sort((a, b) => a.date.localeCompare(b.date)); window.__apex.store.commit('x'); });
await page.waitForTimeout(400);
const slTxt = await page.locator('#view').innerText();
await shot('f13-sueno');
ok('Sueño: promedio, deuda, regularidad y hora ideal', /Promedio \(7 días\)/.test(slTxt) && /Deuda de sueño/.test(slTxt) && /Regularidad/.test(slTxt) && /Hora ideal para acostarte\s*22:45/.test(slTxt));
ok('Detecta qué empeora el sueño (pantallas)', /pantallas antes de dormir.*menos/i.test(slTxt), (slTxt.match(/Cuando marcaste[^\n]*/) || [''])[0]);
await page.locator('#view [data-act="sleep-start"]').click(); await page.waitForTimeout(300);
ok('"Me voy a dormir" empieza a contar', await val(() => !!window.__apex.store.S().sleep.active) && /Durmiendo desde/.test(await page.locator('#view').innerText()));
await page.locator('#view [data-act="sleep-cancel"]').click(); await page.waitForTimeout(300);

// --- Captura del reloj compartida desde otra app (Web Share Target)
const png = fs.readFileSync(path.join(ROOT, 'icons/icon-192.png')).toString('base64');
await val(async (b64) => {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const fd = new FormData(); fd.append('text', 'Samsung Health'); fd.append('imagen', new File([bin], 'captura.png', { type: 'image/png' }));
  await fetch('./compartir', { method: 'POST', body: fd });
}, png);
await page.goto('http://localhost:8766/?accion=compartir'); await page.waitForSelector('.hero'); await page.waitForTimeout(1500);
const lg = await sheetTop().innerText().catch(() => '');
ok('Abre Registrar con la captura compartida', /Foto adjunta/.test(lg) && /Samsung Health/.test(await sheetTop().locator('#lg-text').inputValue()), lg.replace(/\s+/g, ' ').slice(0, 80));
await sheetTop().locator('[data-l="analyze"]').click();
await page.waitForSelector('[data-r="save"]', { timeout: 10000 }).catch(() => {});
await shot('f09-reloj');
await sheetTop().locator('[data-r="save"]').click(); await page.waitForTimeout(500);
const acts = await val(() => (window.__apex.store.day(new Date().toLocaleDateString('sv-SE')).activity || []));
ok('Guarda pasos y calorías del reloj', acts.length === 1 && acts[0].steps === 9450 && acts[0].kcal === 412 && acts[0].source === 'reloj', JSON.stringify(acts[0]));

// --- Accesos directos (?accion=)
await page.goto('http://localhost:8766/?accion=habito&id=creatina&hecho=1'); await page.waitForSelector('.hero'); await page.waitForTimeout(800);
ok('Notificación "Hecho" marca el suplemento', await val(() => !!window.__apex.store.day(new Date().toLocaleDateString('sv-SE')).habits?.creatina));
await page.goto('http://localhost:8766/?accion=registrar&momento=cena'); await page.waitForSelector('.hero'); await page.waitForTimeout(800);
ok('Notificación de comida abre Registrar en esa comida', /Cena/.test(await sheetTop().innerText().catch(() => '')));
const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
ok('Manifiesto: 4 accesos directos y compartir', man.shortcuts.length === 4 && man.share_target?.action === './compartir');

console.log(res.join('\n'));
console.log('Errores:', errors.length ? errors.join('\n') : 'ninguno');
await browser.close(); server.close();
