// ApexTrack — copia automática en Google Drive y recuperación de datos.
// Método principal: la persona toca "Conectar con Google" y autoriza solo la carpeta de la app
// (permiso drive.file: ApexTrack ve únicamente los archivos que crea, nunca el resto del Drive).
// Se guarda una copia por día ("ApexTrack_copia_AAAA-MM-DD.json"): las últimas 14 y una por mes.
// El método anterior (un Apps Script propio) sigue funcionando para quien ya lo tenía configurado.
import { todayISO, esc, fmt, sleep } from './util.js';
import { GOOGLE_CLIENT_ID } from './config.js';
import * as store from './store.js';

const B = () => store.S().settings.backup;
const MIN_GAP = 3 * 3600000; // como mucho una subida cada 3 horas (y siempre al menos una por día)
const FOLDER = 'ApexTrack copias';
const PREFIX = 'ApexTrack_copia_';
const KEEP_DAYS = 14;
const SCOPE = 'https://www.googleapis.com/auth/drive.file email';
const TOKEN_KEY = 'apextrack_gtoken';
const AUTO_AUTH_GAP = 12 * 3600000; // renovar el permiso con un toque, como mucho 2 veces por día

export const driveAvailable = () => !!GOOGLE_CLIENT_ID;
export const driveConnected = () => !!B().drive;
export const legacyConnected = () => !!(B().cloudUrl && B().cloudToken);
export const cloudActive = () => (driveAvailable() && driveConnected()) || legacyConnected();

function payload() {
  const S = JSON.parse(JSON.stringify(store.S()));
  S.settings.ai.key = ''; // la clave de la IA no sale del teléfono
  S.settings.backup.cloudToken = '';
  return S;
}

// ---------------------------------------------------------------------------
// Permiso de Google (Google Identity Services, token de 1 hora en el navegador)
// ---------------------------------------------------------------------------
let gisLoading = null;
function loadGIS() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoading) return gisLoading;
  gisLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gisLoading = null; reject(new Error('No se pudo cargar el inicio de sesión de Google. Revisá la conexión.')); };
    document.head.appendChild(s);
  });
  return gisLoading;
}

function cachedToken() {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
    if (t && t.v && t.exp - Date.now() > 60000) return t.v;
  } catch { /* sin acceso */ }
  return null;
}
function storeToken(v, secs) {
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ v, exp: Date.now() + (Number(secs) || 3500) * 1000 })); } catch { /* opcional */ }
}
function dropToken() { try { localStorage.removeItem(TOKEN_KEY); } catch { /* */ } }

/**
 * Pide (o renueva) el permiso. Abre la ventanita de Google: hay que llamarla desde un toque.
 * Si la persona ya había autorizado, la ventana se cierra sola en un segundo.
 */
export async function authorize({ firstTime = false } = {}) {
  if (!driveAvailable()) throw new Error('La copia con Google todavía no está habilitada en esta versión.');
  await loadGIS();
  const b = B();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      prompt: firstTime || !b.drive ? 'consent' : '',
      hint: b.driveEmail || undefined,
      callback: async (r) => {
        if (!r || r.error || !r.access_token) { reject(new Error(r?.error === 'access_denied' ? 'No diste permiso a Google Drive.' : 'Google no dio el permiso.')); return; }
        if (window.google.accounts.oauth2.hasGrantedAllScopes && !window.google.accounts.oauth2.hasGrantedAllScopes(r, 'https://www.googleapis.com/auth/drive.file')) {
          reject(new Error('Falta tildar el permiso de Google Drive.')); return;
        }
        storeToken(r.access_token, r.expires_in);
        b.drive = true; b.lastAuthAt = Date.now(); b.lastCloudError = '';
        if (!b.driveEmail) {
          try {
            const u = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + r.access_token } }).then((x) => x.json());
            if (u?.email) b.driveEmail = u.email;
          } catch { /* opcional */ }
        }
        store.save();
        resolve(r.access_token);
      },
      error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? 'Cerraste la ventana de Google.' : e?.type === 'popup_failed_to_open' ? 'El navegador bloqueó la ventana de Google. Tocá de nuevo.' : 'No se pudo abrir Google.')),
    });
    client.requestAccessToken();
  });
}

export function disconnect() {
  const tok = cachedToken();
  if (tok && window.google?.accounts?.oauth2?.revoke) { try { window.google.accounts.oauth2.revoke(tok, () => {}); } catch { /* */ } }
  dropToken();
  const b = B();
  b.drive = false; b.driveFolderId = ''; b.driveEmail = ''; b.lastCloudError = '';
  store.commit('backup');
}

// ---------------------------------------------------------------------------
// Google Drive (API REST v3)
// ---------------------------------------------------------------------------
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

async function gfetch(url, { method = 'GET', headers = {}, body, token } = {}) {
  const r = await fetch(url, { method, headers: { Authorization: 'Bearer ' + token, ...headers }, body });
  if (r.status === 401) { dropToken(); throw Object.assign(new Error('El permiso de Google venció.'), { code: 'auth' }); }
  if (r.status === 403 || r.status === 404) {
    const t = await r.text().catch(() => '');
    throw Object.assign(new Error(r.status === 404 ? 'No se encontró el archivo en Drive.' : `Google Drive rechazó la operación (${t.slice(0, 120)})`), { code: String(r.status) });
  }
  if (!r.ok) throw new Error(`Google Drive respondió ${r.status}`);
  return r;
}
const q = (s) => encodeURIComponent(s);

async function ensureFolder(token) {
  const b = B();
  if (b.driveFolderId) {
    try {
      const f = await gfetch(`${DRIVE}/files/${b.driveFolderId}?fields=id,trashed`, { token }).then((r) => r.json());
      if (f && !f.trashed) return f.id;
    } catch (e) { if (e.code === 'auth') throw e; }
  }
  const query = `name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const list = await gfetch(`${DRIVE}/files?q=${q(query)}&fields=files(id,name)&spaces=drive`, { token }).then((r) => r.json());
  let id = list.files?.[0]?.id;
  if (!id) {
    const created = await gfetch(`${DRIVE}/files?fields=id`, { method: 'POST', token, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }) }).then((r) => r.json());
    id = created.id;
  }
  b.driveFolderId = id;
  return id;
}

async function listCopies(token, folder) {
  const query = `'${folder}' in parents and trashed=false and name contains '${PREFIX}'`;
  const r = await gfetch(`${DRIVE}/files?q=${q(query)}&fields=files(id,name,modifiedTime,size)&orderBy=name desc&pageSize=200`, { token }).then((x) => x.json());
  return (r.files || []).filter((f) => /\d{4}-\d{2}-\d{2}/.test(f.name));
}

async function writeFile(token, folder, name, text, existingId) {
  if (existingId) {
    return gfetch(`${UPLOAD}/files/${existingId}?uploadType=media&fields=id`, { method: 'PATCH', token, headers: { 'Content-Type': 'application/json' }, body: text }).then((r) => r.json());
  }
  const boundary = 'apx' + Math.random().toString(36).slice(2);
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folder], mimeType: 'application/json' })}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
  return gfetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', token, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body }).then((r) => r.json());
}

/** Se quedan las copias de los últimos 14 días y la más vieja de cada mes anterior. */
export function copiesToDelete(names, today = todayISO()) {
  const dated = names.map((n) => ({ n, d: (n.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] })).filter((x) => x.d).sort((a, b) => a.d.localeCompare(b.d));
  const limit = new Date(today + 'T12:00:00'); limit.setDate(limit.getDate() - KEEP_DAYS);
  const lim = limit.toISOString().slice(0, 10);
  const keepMonth = new Set();
  const out = [];
  for (const x of dated) {
    if (x.d >= lim) continue;
    const m = x.d.slice(0, 7);
    if (!keepMonth.has(m)) { keepMonth.add(m); continue; }
    out.push(x.n);
  }
  return out;
}

async function drivePush(token, { force }) {
  const b = B();
  const data = store.S();
  const rich = store.richness(data);
  // si la app tiene mucho menos que la última copia, no se pisa la de hoy (se guarda aparte)
  const shrunk = !force && b.lastCloudRichness >= 10 && rich < b.lastCloudRichness * 0.5;
  const folder = await ensureFolder(token);
  const files = await listCopies(token, folder);
  const name = `${PREFIX}${todayISO()}${shrunk ? '_reducida' : ''}.json`;
  const existing = files.find((f) => f.name === name);
  const text = JSON.stringify(payload());
  await writeFile(token, folder, name, text, existing?.id);
  b.lastCloudAt = Date.now(); b.lastCloudError = ''; b.lastCloudRichness = shrunk ? b.lastCloudRichness : rich;
  store.save();
  // limpieza de copias viejas (nunca la de hoy)
  for (const n of copiesToDelete(files.map((f) => f.name))) {
    const f = files.find((x) => x.name === n);
    try { await gfetch(`${DRIVE}/files/${f.id}`, { method: 'DELETE', token }); } catch { /* sigue */ }
  }
  return { ok: true, bytes: text.length, name, shrunk };
}

// ---------------------------------------------------------------------------
// Método anterior: Apps Script propio (se mantiene para quien ya lo usa)
// ---------------------------------------------------------------------------
async function legacyPush() {
  const b = B();
  const r = await fetch(b.cloudUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ clave: b.cloudToken, datos: payload() }) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error === 'clave' ? 'La clave no coincide con la del script' : (j.error || 'Error del script'));
  return { ok: true, bytes: j.bytes };
}
async function legacyPull(cual) {
  const b = B();
  const url = `${b.cloudUrl}${b.cloudUrl.includes('?') ? '&' : '?'}clave=${encodeURIComponent(b.cloudToken)}${cual === 'anterior' ? '&cual=anterior' : ''}`;
  const r = await fetch(url);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error === 'clave' ? 'La clave no coincide con la del script.' : j.error === 'sin copia' ? 'Todavía no hay ninguna copia en Drive.' : (j.error || 'No se pudo leer la copia.'));
  return { fecha: j.fecha, data: j.datos };
}

// ---------------------------------------------------------------------------
// Subir y traer
// ---------------------------------------------------------------------------
let pushing = null;
/** Sube la copia. force: aunque no haya cambios o haya pasado poco tiempo. interactive: puede pedir permiso. */
export function cloudPush(opts = {}) {
  if (pushing) return pushing;
  pushing = doPush(opts).finally(() => { pushing = null; });
  return pushing;
}
async function doPush({ force = false, interactive = false } = {}) {
  const b = B();
  const useDrive = driveAvailable() && b.drive;
  if (!useDrive && !legacyConnected()) return { ok: false, skipped: 'sin configurar' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, skipped: 'sin conexión' };
  const data = store.S();
  if (store.richness(data) < 3) return { ok: false, skipped: 'sin datos' }; // nunca subir un estado vacío encima de la copia
  if (!force && !isDue()) return { ok: true, skipped: 'al día' };
  try {
    let r;
    if (useDrive) {
      let token = cachedToken();
      if (!token && interactive) token = await authorize();
      if (!token) { b.needAuth = true; return { ok: false, skipped: 'sin permiso' }; }
      try { r = await drivePush(token, { force }); } catch (e) {
        if (e.code !== 'auth' || !interactive) throw e;
        r = await drivePush(await authorize(), { force });
      }
      b.needAuth = false;
    } else {
      r = await legacyPush();
      b.lastCloudAt = Date.now(); b.lastCloudError = '';
    }
    store.save();
    return r;
  } catch (e) {
    if (e.code === 'auth') { b.needAuth = true; store.save(); return { ok: false, skipped: 'sin permiso' }; }
    b.lastCloudError = String(e.message || e).slice(0, 160);
    store.save();
    return { ok: false, error: b.lastCloudError };
  }
}

export function isDue() {
  const b = B();
  const data = store.S();
  const newDay = !b.lastCloudAt || new Date(b.lastCloudAt).toLocaleDateString('sv-SE') !== todayISO();
  const changed = (data.updatedAt || 0) > (b.lastCloudAt || 0);
  return newDay || (changed && Date.now() - (b.lastCloudAt || 0) >= MIN_GAP);
}

/** Lista las copias disponibles en Drive (más nuevas primero). */
export async function cloudList({ interactive = true } = {}) {
  if (driveAvailable() && B().drive) {
    let token = cachedToken();
    if (!token) { if (!interactive) throw new Error('Hace falta renovar el permiso de Google.'); token = await authorize(); }
    const folder = await ensureFolder(token);
    const files = await listCopies(token, folder);
    return files.map((f) => ({ id: f.id, name: f.name, date: (f.name.match(/(\d{4}-\d{2}-\d{2})/) || [])[1], fecha: f.modifiedTime, size: Number(f.size) || 0 }));
  }
  if (legacyConnected()) return [{ id: 'ultima', name: 'Última copia', legacy: true }, { id: 'anterior', name: 'Copia del día anterior', legacy: true }];
  return [];
}

/** Trae una copia. id: el de cloudList(). */
export async function cloudPull(id = 'ultima') {
  if (driveAvailable() && B().drive && !['ultima', 'anterior'].includes(id)) {
    const token = cachedToken() || await authorize();
    const meta = await gfetch(`${DRIVE}/files/${id}?fields=modifiedTime`, { token }).then((r) => r.json());
    const data = await gfetch(`${DRIVE}/files/${id}?alt=media`, { token }).then((r) => r.json());
    return { fecha: meta.modifiedTime, data };
  }
  if (driveAvailable() && B().drive) {
    const list = await cloudList();
    if (!list.length) throw new Error('Todavía no hay ninguna copia en Drive.');
    return cloudPull(list[id === 'anterior' && list[1] ? 1 : 0].id);
  }
  if (legacyConnected()) return legacyPull(id);
  throw new Error('La copia en Drive no está configurada.');
}

// ---------------------------------------------------------------------------
// Programación: al abrir, al volver a la app, cada 30 min y al pasar a segundo plano.
// Sin permiso vigente (dura 1 hora), se renueva con el próximo toque en un botón, como mucho
// dos veces por día: Google abre su ventanita y se cierra sola.
// ---------------------------------------------------------------------------
export function scheduleCloud() {
  const tick = () => { cloudPush().catch(() => {}); };
  // se carga antes el script de Google para que la ventana abra en el mismo toque
  if (driveAvailable() && B().drive) setTimeout(() => loadGIS().catch(() => {}), 3000);
  setTimeout(tick, 8000);
  setInterval(tick, 30 * 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') tick(); });
  document.addEventListener('click', (e) => {
    const b = B();
    if (!driveAvailable() || !b.drive || !b.needAuth || cachedToken()) return;
    if (!e.target.closest('button') || !isDue() || store.richness(store.S()) < 3) return;
    if (Date.now() - (b.lastAutoAuthAt || 0) < AUTO_AUTH_GAP) return;
    b.lastAutoAuthAt = Date.now();
    // dentro del toque (si no, el navegador bloquea la ventana de Google)
    cloudPush({ interactive: true }).catch(() => {});
  }, true);
}

export function describe(d) {
  const items = (d.entries || []).reduce((n, e) => n + (e.items || []).length, 0);
  const dates = (d.entries || []).map((e) => e.date).sort();
  return `${fmt(items)} alimentos${dates.length ? ` del ${dates[0].split('-').reverse().join('/')} al ${dates[dates.length - 1].split('-').reverse().join('/')}` : ''}, ${(d.body || []).length} pesajes`;
}
export { esc, sleep };
