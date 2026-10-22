// Prueba de persistencia: pérdida de IndexedDB, de todo menos el archivo interno, fotos diarias y copia en Drive.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('../..');
const OUT = process.env.SHOTS || '/tmp/shots';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, locale: 'es-AR', timezoneId: 'America/Argentina/San_Juan', serviceWorkers: 'block', ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const res = [];
const ok = (n, c, x = '') => res.push(`${c ? '✓' : '✗'} ${n}${x ? ' — ' + x : ''}`);
await ctx.route('https://app.test/**', async (route) => {
  let p = new URL(route.request().url()).pathname; if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) return route.fulfill({ status: 404 });
  return route.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
});
// Configuración de prueba: Google y el servicio de la comunidad habilitados
await ctx.route('https://app.test/js/config.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: "export const GOOGLE_CLIENT_ID = 'cliente-prueba.apps.googleusercontent.com';\nexport const COMMUNITY_URL = 'https://comunidad.test/exec';\n" }));
// Inicio de sesión de Google simulado (la ventanita se "cierra sola" y da un permiso)
let authCount = 0;
await ctx.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: `
  window.google = { accounts: { oauth2: {
    initTokenClient: (cfg) => ({ requestAccessToken: () => { window.__auths = (window.__auths || 0) + 1; setTimeout(() => cfg.callback({ access_token: 'tok' + window.__auths, expires_in: 3599, scope: 'https://www.googleapis.com/auth/drive.file email' }), 30); } }),
    hasGrantedAllScopes: () => true, revoke: (t, cb) => cb && cb(),
  } } };` }));
// Google Drive simulado (en memoria)
const drive = { files: {}, n: 0, uploads: 0 };
const cors = { 'access-control-allow-origin': '*' };
await ctx.route('https://www.googleapis.com/**', async (route) => {
  const req = route.request(); const u = new URL(req.url()); const m = req.method();
  if (!/^Bearer tok/.test(req.headers()['authorization'] || '')) return route.fulfill({ status: 401, headers: cors, body: '{}' });
  if (u.pathname === '/oauth2/v3/userinfo') return route.fulfill({ headers: cors, json: { email: 'prueba@gmail.com' } });
  const id = (u.pathname.match(/\/files\/([^/]+)/) || [])[1];
  if (u.pathname.startsWith('/upload/')) {
    drive.uploads++;
    if (m === 'PATCH') { drive.files[id].content = req.postData(); drive.files[id].modifiedTime = new Date().toISOString(); return route.fulfill({ headers: cors, json: { id } }); }
    const body = req.postData(); const parts = body.split(/--apx[a-z0-9]+/);
    const meta = JSON.parse(parts[1].split('\r\n\r\n')[1]); const content = parts[2].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
    const nid = 'f' + (++drive.n); drive.files[nid] = { id: nid, ...meta, content, modifiedTime: new Date().toISOString() };
    return route.fulfill({ headers: cors, json: { id: nid } });
  }
  if (m === 'POST' && u.pathname === '/drive/v3/files') { const meta = JSON.parse(req.postData()); const nid = 'f' + (++drive.n); drive.files[nid] = { id: nid, ...meta, parents: [] }; return route.fulfill({ headers: cors, json: { id: nid } }); }
  if (m === 'DELETE') { delete drive.files[id]; return route.fulfill({ status: 204, headers: cors, body: '' }); }
  if (id) {
    const f = drive.files[id]; if (!f) return route.fulfill({ status: 404, headers: cors, body: '{}' });
    if (u.searchParams.get('alt') === 'media') return route.fulfill({ headers: cors, contentType: 'application/json', body: f.content });
    return route.fulfill({ headers: cors, json: { id, trashed: false, modifiedTime: f.modifiedTime } });
  }
  const q = u.searchParams.get('q') || '';
  let list = Object.values(drive.files);
  const nm = q.match(/name='([^']+)'/); if (nm) list = list.filter((f) => f.name === nm[1]);
  const par = q.match(/'([^']+)' in parents/); if (par) list = list.filter((f) => (f.parents || []).includes(par[1]));
  if (/mimeType='application\/vnd.google-apps.folder'/.test(q)) list = list.filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
  if (/name contains 'ApexTrack_copia_'/.test(q)) list = list.filter((f) => f.name.startsWith('ApexTrack_copia_'));
  list.sort((a, b) => b.name.localeCompare(a.name));
  return route.fulfill({ headers: cors, json: { files: list.map((f) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime, size: (f.content || '').length })) } });
});
const copies = () => Object.values(drive.files).filter((f) => f.name.startsWith('ApexTrack_copia_'));
// Servicio de la comunidad simulado
const community = { posts: [] };
await ctx.route('https://comunidad.test/**', async (route) => {
  const req = route.request();
  if (req.method() === 'POST') { const b = JSON.parse(req.postData()); community.posts.push(b); return route.fulfill({ headers: cors, json: { ok: true, items: b.records.length } }); }
  return route.fulfill({ headers: cors, json: { ok: true, at: new Date().toISOString(), users: 7, records: 120, foods: [{ id: 'com_guiso_de_mondongo', n: 'Guiso de mondongo', a: ['guiso de mondongo', 'mondongo'], k: 110, p: 9, c: 8, f: 4.5, s: 1, fb: 1.5, u: { plato: 350 }, users: 4 }], phrases: { 'mondongo': 'com_guiso_de_mondongo' } } });
});
const sheetTop = () => page.locator('.sheet-wrap').last();
const val = (fn, a) => page.evaluate(fn, a);
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const items = () => val(() => window.__apex.store.S().entries.reduce((n, e) => n + e.items.length, 0));
const boot = async () => { await page.goto('https://app.test/'); await page.waitForSelector('.hero'); await page.waitForTimeout(600); };

await boot();
// cerrar la bienvenida
if (await page.locator('.sheet-wrap').count()) { await shot('p0-bienvenida'); await page.locator('.sheet-wrap [data-sheet-close]').last().click(); await page.waitForTimeout(400); }
// cargar 20 días de datos
await val(() => {
  const st = window.__apex.store; const U = (d) => { const x = new Date(); x.setDate(x.getDate() - d); return x.toLocaleDateString('sv-SE'); };
  for (let i = 0; i < 20; i++) {
    st.addItems(U(i), 'almuerzo', [{ name: 'Pollo', qty: 200, unit: 'g', grams: 200, per100: { kcal: 165, p: 31, c: 0, f: 3.6, s: 0, fb: 0 } }, { name: 'Arroz', qty: 100, unit: 'g', grams: 100, per100: { kcal: 356, p: 7, c: 78, f: 0.6, s: 0, fb: 1 } }]);
    st.upsertBody(U(i), { weight: 61 + i / 10 });
  }
  st.commit('test');
});
await val(() => window.__apex.store.flush());
await page.waitForTimeout(300);
const n0 = await items();
ok('Datos de prueba cargados', n0 === 40, String(n0));
const files = await val(async () => { const d = await navigator.storage.getDirectory(); const out = []; for await (const [n] of d.entries()) out.push(n); return out; });
ok('Copia en archivo interno y foto diaria', files.includes('state.json') && files.some((f) => f.startsWith('snap-')), files.join(', '));
ok('Copia en localStorage', await val(() => !!localStorage.getItem('apextrack_state_v2')));

// 1) Se pierde IndexedDB
await val(() => new Promise((r) => { const q = indexedDB.deleteDatabase('apextrack'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
await boot();
ok('Sin IndexedDB: recupera desde las otras copias', (await items()) === 40, `${await items()} alimentos · ${await page.locator('#toast').innerText()}`);

// 2) Se pierden IndexedDB y localStorage: queda el archivo interno
await val(() => new Promise((r) => { localStorage.clear(); const q = indexedDB.deleteDatabase('apextrack'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
await boot();
ok('Solo con el archivo interno: recupera', (await items()) === 40, String(await items()));

// 3) Protección: un estado vacío no pisa los datos guardados
await val(() => { const S = window.__apex.store.S(); S.entries = []; S.body = []; S.days = {}; return window.__apex.store.flush(); });
await boot();
ok('Un estado vacío accidental no borra lo guardado', (await items()) === 40, String(await items()));

// 4) Copia en Drive: conectar con Google (sin Apps Script) y subir
await page.locator('[data-act="settings"]').click(); await page.waitForTimeout(400);
await sheetTop().locator('[data-s="cloud"]').click(); await page.waitForTimeout(400);
await shot('p1-drive');
await sheetTop().locator('[data-c="connect"]').click();
await page.waitForTimeout(1500);
await shot('p2-drive-ok');
const c1 = copies();
const up1 = c1[0] && JSON.parse(c1[0].content);
const folder = Object.values(drive.files).find((f) => f.mimeType === 'application/vnd.google-apps.folder');
ok('Conecta con Google y sube la copia del día a su carpeta', c1.length === 1 && /ApexTrack_copia_\d{4}-\d{2}-\d{2}\.json/.test(c1[0].name) && folder?.name === 'ApexTrack copias' && c1[0].parents[0] === folder.id && up1.entries.length === 20 && up1.settings.ai.key === '', `${c1.map((f) => f.name).join(', ')} · ${await sheetTop().locator('#c-st').innerText()}`);
ok('Muestra la cuenta conectada', /prueba@gmail\.com/.test(await sheetTop().innerText()));
await sheetTop().locator('[data-c="push"]').click(); await page.waitForTimeout(800);
ok('Volver a subir el mismo día actualiza el mismo archivo', copies().length === 1 && drive.uploads === 2, `${copies().length} archivos, ${drive.uploads} subidas`);
await sheetTop().locator('[data-sheet-close]').click(); await page.waitForTimeout(300);
await sheetTop().locator('[data-sheet-close]').click(); await page.waitForTimeout(300);

// 4b) El permiso de Google venció: se renueva solo con el próximo toque y sube la copia
await val(() => { localStorage.removeItem('apextrack_gtoken'); const b = window.__apex.store.S().settings.backup; b.lastCloudAt = Date.now() - 2 * 86400000; b.lastAutoAuthAt = 0; });
await val(() => window.__apex.cloudPush());
const needAuth = await val(() => window.__apex.store.S().settings.backup.needAuth);
const upBefore = drive.uploads;
await page.locator('.tab[data-tab="diario"]').click(); await page.waitForTimeout(1200);
ok('Permiso vencido: con el próximo toque se renueva y sube', needAuth === true && drive.uploads > upBefore && (await val(() => window.__apex.store.S().settings.backup.needAuth)) === false, `${drive.uploads - upBefore} subidas`);
await page.locator('.tab[data-tab="hoy"]').click(); await page.waitForTimeout(300);

// 5) Se borra TODO el sitio (como si el navegador lo hubiera limpiado) y se recupera desde Drive
await val(async () => { localStorage.clear(); const d = await navigator.storage.getDirectory(); for await (const [n] of d.entries()) await d.removeEntry(n); await new Promise((r) => { const q = indexedDB.deleteDatabase('apextrack'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); });
await boot();
ok('Todo borrado: arranca vacío con la bienvenida', (await items()) === 0 && (await page.locator('.sheet-wrap').count()) === 1);
await shot('p3-bienvenida-recuperar');
await sheetTop().locator('.opt[data-v="recuperar"]').click(); await page.waitForTimeout(600);
await shot('p4-recuperar');
await sheetTop().locator('[data-r-x="cloud"]').click(); await page.waitForTimeout(400);
const upsBeforeEmpty = drive.uploads;
await sheetTop().locator('[data-c="connect"]').click(); await page.waitForTimeout(1500);
ok('Con la app vacía no sube nada encima de la copia', drive.uploads === upsBeforeEmpty, `${drive.uploads - upsBeforeEmpty} subidas`);
await shot('p4b-elegir-copia');
await sheetTop().locator('.opt').first().click(); await page.waitForTimeout(800);
await sheetTop().locator('[data-r="1"]').click(); await page.waitForTimeout(800);
ok('Recupera todo desde Drive', (await items()) === 40, `${await items()} · ${await page.locator('#toast').innerText()}`);
await shot('p5-recuperado');

// 5b) Restaurar o borrar nunca pierde lo anterior: queda una copia "lo que había antes"
await val(() => { window.__apex.store.S().entries.splice(0, 5); window.__apex.store.commit('x'); return window.__apex.store.flush(); });
await val(() => window.__apex.store.replaceAll({ entries: [] }));
await page.waitForTimeout(500);
const prev = await val(async () => (await window.__apex.store.listSnapshots()).filter((x) => x.before).map((x) => `${x.before}:${x.entries}`));
ok('Antes de reemplazar los datos guarda lo que había', prev.some((x) => /antes de restaurar:15/.test(x)), prev.join(', '));
const snapPrev = await val(async () => (await window.__apex.store.listSnapshots()).find((x) => x.before && x.entries === 15).data);
await val((d) => { window.__apex.store.replaceAll(d); window.__apex.store.commit('x'); return window.__apex.store.flush(); }, snapPrev);
ok('Y se puede volver a eso', (await items()) === 30, String(await items()));

// 5c) IA propia: aportes anónimos y conocimiento compartido
await val(() => window.__apex.CM.syncKnowledge({ force: true }));
const know = await val(() => window.__apex.CM.knowledgeInfo());
const mond = await val(() => { const A = window.__apex.AI; const c = A.buildContext(); const d = A.analyzeOffline('un plato de mondongo', c); return { name: d.groups[0]?.items[0]?.name, g: d.groups[0]?.items[0]?.grams, ok: A.localVerdict(d, 'un plato de mondongo', c).ok }; });
ok('Descarga el conocimiento compartido y la IA propia lo usa', know?.foods === 1 && /mondongo/i.test(mond.name) && mond.g === 350 && mond.ok, `${JSON.stringify(know)} · ${JSON.stringify(mond)}`);
await val(() => window.__apex.CM.contribute({ meta: { engine: 'ia', model: 'gemini-3.5-flash', input: 'almorcé dos empanadas de carne' }, water: [], habits: [], gym: [], groups: [{ date: new Date().toLocaleDateString('sv-SE'), moment: 'almuerzo', items: [{ said: 'dos empanadas de carne', name: 'Empanada de carne al horno', qty: 2, unit: 'unidad', grams: 160, basis: 'tabla', confidence: 'media', per100: { kcal: 250, p: 11, c: 26, f: 11, s: 2, fb: 1.5 } }] }] }));
await page.waitForTimeout(600);
const sent = community.posts.flatMap((p) => p.records);
const leaks = JSON.stringify(community.posts).match(/prueba@gmail|AQ\.|"weight"|"goals"/);
ok('Envía aportes anónimos (alimento + mensaje) sin datos personales', sent.length === 2 && sent[0].t === 'item' && sent[0].food.includes('empanada') && sent[1].t === 'msg', `${JSON.stringify(sent[0]).slice(0, 160)}${leaks ? ' · FUGA: ' + leaks[0] : ''}`);
ok('Sin datos personales en los aportes', !leaks && community.posts.every((p) => /^ins_/.test(p.install)));
await val(() => { window.__apex.store.S().settings.ai.share = false; });
const before = community.posts.length;
await val(() => window.__apex.CM.contribute({ meta: { engine: 'ia', input: 'x' }, water: [], habits: [], gym: [], groups: [{ date: '2026-10-01', moment: 'cena', items: [{ said: 'x', name: 'Pizza', qty: 1, unit: 'porcion', grams: 120, per100: { kcal: 260, p: 11, c: 30, f: 10 } }] }] }));
await page.waitForTimeout(400);
ok('Si se desactiva "Ayudar a entrenarla", no envía nada', community.posts.length === before);
await val(() => { window.__apex.store.S().settings.ai.share = true; });

// 6) Se pierde todo menos las fotos diarias: la bienvenida ofrece restaurarlas
await val(() => window.__apex.store.flush()); await page.waitForTimeout(400);
await val(async () => { localStorage.clear(); const d = await navigator.storage.getDirectory(); await d.removeEntry('state.json').catch(() => {}); await new Promise((r) => { const q = indexedDB.deleteDatabase('apextrack'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); });
await boot();
await page.waitForTimeout(800);
await shot('p6-foto-diaria');
const txt = await page.locator('.sheet-wrap').last().innerText().catch(() => '');
ok('Sin nada más que la foto diaria: ofrece restaurarla', /Encontré tus datos anteriores/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 140));
await sheetTop().locator('[data-r="1"]').click().catch(() => {}); await page.waitForTimeout(800);
ok('Restaura la foto diaria', (await items()) === 30, String(await items()));
console.log(res.join('\n'));
console.log('Errores:', errors.length ? errors.join('\n') : 'ninguno');
await browser.close();
