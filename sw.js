// ApexTrack — service worker: funciona sin conexión, se actualiza solo, muestra los recordatorios
// (aunque la app esté cerrada) y recibe capturas compartidas desde otras apps (reloj, Samsung Health).
import { dueNow, evaluate } from './js/reminders-core.js';

const VERSION = 'apextrack-2.2.2';
const CORE = [
  './', './index.html', './manifest.webmanifest', './css/app.css', './fonts/archivo.woff2',
  './js/app.js', './js/more.js', './js/store.js', './js/foods.js', './js/ai.js', './js/ui.js', './js/util.js',
  './js/icons.js', './js/charts.js', './js/study.js', './js/energy.js', './js/profile.js', './js/insights.js', './js/backup.js', './js/voice.js', './js/camera.js', './js/excel.js', './js/config.js', './js/community.js',
  './js/reminders-core.js', './js/notify.js', './js/weekly.js', './js/tabs.js', './js/fasting.js', './js/ideas.js', './js/onboarding.js', './js/sleep.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png',
];
const LAZY = ['./vendor/exceljs.min.js'];
const SHARE_CACHE = 'apextrack-compartido';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(async (c) => {
    await c.addAll(CORE);
    c.addAll(LAZY).catch(() => {});
  }));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== SHARE_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
  else if (e.data === 'avisos') e.waitUntil(checkReminders());
  else if (e.data && e.data.type === 'probar-aviso') e.waitUntil(testReminder(e.data.id));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // capturas o textos compartidos desde otras apps (Web Share Target)
  if (req.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/compartir')) {
    e.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== 'GET') return;
  // IA, Open Food Facts y otros servicios: siempre por red, nunca en caché
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const cp = r.clone(); caches.open(VERSION).then((c) => c.put('./index.html', cp)); return r; }).catch(() => caches.match('./index.html')));
    return;
  }
  // archivos propios: caché primero y actualización en segundo plano
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => {
    const net = fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(req, cp)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});

async function receiveShare(req) {
  try {
    const form = await req.formData();
    const c = await caches.open(SHARE_CACHE);
    const file = form.get('imagen');
    const text = [form.get('title'), form.get('text'), form.get('url')].filter(Boolean).join('\n');
    await c.put('./__compartido_texto', new Response(text || ''));
    if (file && typeof file !== 'string' && file.size) await c.put('./__compartido_imagen', new Response(file, { headers: { 'content-type': file.type || 'image/jpeg' } }));
    else await c.delete('./__compartido_imagen');
  } catch { /* se abre igual */ }
  return Response.redirect('./?accion=compartir', 303);
}

// ---------------------------------------------------------------------------
// Recordatorios
// ---------------------------------------------------------------------------
function idb() {
  return new Promise((resolve) => {
    try {
      const q = indexedDB.open('apextrack', 1);
      q.onupgradeneeded = () => q.result.createObjectStore('kv');
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
async function kv(db, key, val) {
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('kv', val === undefined ? 'readonly' : 'readwrite');
      const st = tx.objectStore('kv');
      const r = val === undefined ? st.get(key) : st.put(val, key);
      r.onsuccess = () => resolve(val === undefined ? r.result : true);
      r.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}

async function checkReminders({ fromPush = false } = {}) {
  const db = await idb();
  const state = await kv(db, 'state');
  if (!state) { if (fromPush) await self.registration.showNotification('ApexTrack', { body: 'Abrí la app para ver tus recordatorios.', tag: 'estado', silent: true }); return; }
  const now = new Date();
  const shown = (await kv(db, 'avisos_mostrados')) || {};
  const due = dueNow(state, now, shown);
  let n = 0;
  for (const { r, n: note } of due) {
    shown[`${now.toLocaleDateString('sv-SE')}|${r.id}`] = Date.now();
    if (!note) continue;
    await show(note);
    n++;
  }
  // limpieza: solo los últimos 3 días
  const lim = new Date(Date.now() - 3 * 86400000).toLocaleDateString('sv-SE');
  for (const k of Object.keys(shown)) if (k.slice(0, 10) < lim) delete shown[k];
  await kv(db, 'avisos_mostrados', shown);
  // un push siempre tiene que mostrar algo (si no, Chrome muestra un aviso genérico)
  if (fromPush && !n) {
    const day = evaluate({ id: 'estado', type: 'dia' }, state, now);
    await show({ ...day, tag: 'estado', silent: true, actions: [] });
  }
}
async function testReminder(id) {
  const db = await idb();
  const state = await kv(db, 'state');
  const r = (state?.settings?.reminders?.list || []).find((x) => x.id === id);
  if (!r) return;
  const note = evaluate({ ...r, onlyIfMissing: false }, state, new Date());
  if (note) await show({ ...note, tag: 'prueba-' + id });
}
function show(n) {
  return self.registration.showNotification(n.title, {
    body: n.body || '', tag: n.tag, icon: './icons/icon-192.png', badge: './icons/icon-192.png',
    data: { url: n.url || './', ...(n.data || {}) }, actions: (n.actions || []).slice(0, 2), silent: !!n.silent, renotify: !n.silent,
  });
}

self.addEventListener('push', (e) => { e.waitUntil(checkReminders({ fromPush: true })); });
self.addEventListener('periodicsync', (e) => { if (e.tag === 'avisos') e.waitUntil(checkReminders()); });

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  let url = d.url || './';
  if (e.action === 'agua') url = './?accion=agua';
  else if (e.action === 'registrar') url = d.url && d.url.includes('accion=registrar') ? d.url : './?accion=registrar';
  else if (e.action === 'habito') url = d.url && d.url.includes('accion=habito') ? `${d.url}&hecho=1` : d.url;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const abs = new URL(url, self.registration.scope).href;
    for (const c of all) {
      if (c.url.startsWith(self.registration.scope)) {
        await c.focus();
        c.postMessage({ type: 'abrir', url: abs });
        return;
      }
    }
    await self.clients.openWindow(abs);
  })());
});
