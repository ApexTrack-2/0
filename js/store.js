// ApexTrack — estado, persistencia (IndexedDB con respaldo en localStorage), cálculos y aprendizaje.

import { todayISO, uid, addDays, dateRange, weekStart, round1, round0, deepClone, isISODate, norm, parseISO, daysBetween } from './util.js';
import { setCustomFoods, calc, getFood, foodUnits, unitLabel, canonUnit, sanitizePer100 } from './foods.js';
import { defaultReminders } from './reminders-core.js';

export const APP_VERSION = '2.2.2';
const SCHEMA = 1;
const DB_NAME = 'apextrack';
const DB_STORE = 'kv';
const KEY = 'state';
const LS_KEY = 'apextrack_state_v2';

export const DEFAULT_MOMENTS = [
  { id: 'desayuno', name: 'Desayuno', h: [5, 10.5] },
  { id: 'media_manana', name: 'Media mañana', h: [10.5, 12] },
  { id: 'almuerzo', name: 'Almuerzo', h: [12, 15.5] },
  { id: 'media_tarde', name: 'Media tarde', h: [15.5, 17] },
  { id: 'merienda', name: 'Merienda', h: [17, 19.5] },
  { id: 'pre_entreno', name: 'Pre-entreno', h: null },
  { id: 'post_entreno', name: 'Post-entreno', h: null },
  { id: 'cena', name: 'Cena', h: [19.5, 23.5] },
  { id: 'post_cena', name: 'Post-cena', h: [23.5, 5] },
];

export const DEFAULT_HABITS = [
  { id: 'creatina', name: 'Creatina', detail: '5 g', kind: 'supp', aliases: ['creatina'] },
  { id: 'magnesio', name: 'Citrato de magnesio', kind: 'supp', aliases: ['magnesio', 'citrato de magnesio', 'citrato'] },
  { id: 'vitaminas', name: 'Vitaminas', kind: 'supp', aliases: ['vitaminas', 'vitamina', 'multivitaminico'] },
  { id: 'limpieza', name: 'Limpieza facial', kind: 'habit', aliases: ['limpieza facial', 'limpieza de cara'] },
  { id: 'cuello', name: 'Movilidad de cuello', kind: 'habit', aliases: ['cuello', 'estiramiento de cuello'] },
  { id: 'postura', name: 'Postura y espalda', kind: 'habit', aliases: ['postura', 'correccion postural', 'ejercicios de espalda'] },
  { id: 'estudio', name: 'Estudio', kind: 'hours', goal: 2, aliases: [] },
];

const EX = (name, sets = 3, reps = '8-10', rest = 90) => ({ id: uid('ex'), name, sets, reps, rest });
export const DEFAULT_ROUTINES = () => [
  { id: 'torso_a', name: 'Torso A', exercises: [EX('Press banca plano con barra', 4, '6-8', 150), EX('Remo con barra', 4, '8-10', 120), EX('Press militar con mancuernas', 3, '8-10', 120), EX('Dominadas neutras', 3, '6-10', 120), EX('Elevaciones laterales en polea', 3, '12-15', 60)] },
  { id: 'pierna_a', name: 'Pierna A', exercises: [EX('Sentadilla trasera con barra', 4, '6-8', 150), EX('Peso muerto rumano', 4, '8-10', 120), EX('Prensa 45°', 3, '10-12', 120), EX('Sillón de cuádriceps', 3, '10-12', 90), EX('Elevación de talones', 4, '12-15', 60)] },
  { id: 'torso_b', name: 'Torso B', exercises: [EX('Press inclinado con mancuernas', 3, '8-10', 120), EX('Jalón al pecho en polea', 3, '8-10', 90), EX('Fondos en paralelas', 3, '8-12', 90)] },
  { id: 'pierna_b', name: 'Pierna B', exercises: [EX('Sentadilla búlgara', 3, '8-10', 90), EX('Curl femoral tumbado', 3, '10-12', 90)] },
];

export function defaultStudy() {
  return { subjects: [], sessions: [], events: [], tasks: [], notes: [], active: null, pomo: { work: 25, rest: 5 } };
}

export function defaultState() {
  const now = Date.now();
  return {
    schema: SCHEMA, version: APP_VERSION, createdAt: now, updatedAt: now,
    settings: {
      profile: { name: '', heightCm: 180, sex: 'm', birthYear: null, weightKg: null, goal: '', level: '', rawGrains: true },
      goals: { kcal: 3000, p: 120, c: 400, f: 70, sugarMax: 90, waterMl: 2500, gymDays: 4 },
      moments: deepClone(DEFAULT_MOMENTS),
      habits: deepClone(DEFAULT_HABITS),
      ai: { key: '', model: 'auto', precision: 'equilibrada', web: false, webV2: true, notes: '', endpoint: '', resolvedModel: '', modelsAt: 0, models: [] },
      ui: { theme: 'auto', glassMl: 250, slotTab: 'gym' },
      backup: { lastAt: 0, cloudUrl: '', cloudToken: '', lastCloudAt: 0, lastCloudError: '', drive: false, driveEmail: '', driveFolderId: '', lastCloudRichness: 0, needAuth: false },
    },
    entries: [],
    days: {},
    body: [],
    customFoods: [],
    learn: { units: {}, aliases: {}, corrections: [] },
    usage: {},
    gym: { routines: DEFAULT_ROUTINES(), sessions: [], active: null },
    study: defaultStudy(),
    pending: [],
    aiLog: [],
    insights: [],
  };
}

// ---------- Persistencia ----------
// Los datos se guardan en TRES lugares del navegador a la vez (IndexedDB, localStorage y un archivo
// interno OPFS) y además se guarda una foto diaria. Al abrir se usa la copia más completa y reciente,
// y nunca se pisa una copia con datos con un estado vacío.
let db = null;
let idbFailed = false;
function openDB() {
  return new Promise((resolve) => {
    try {
      if (!('indexedDB' in globalThis)) return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(DB_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { idbFailed = true; resolve(null); };
      req.onblocked = () => { idbFailed = true; resolve(null); };
    } catch { idbFailed = true; resolve(null); }
  });
}
function idbGet(key) {
  return new Promise((resolve) => {
    if (!db) return resolve(undefined);
    try {
      const tx = db.transaction(DB_STORE, 'readonly');
      const r = tx.objectStore(DB_STORE).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => { idbFailed = true; resolve(undefined); };
    } catch { idbFailed = true; resolve(undefined); }
  });
}
function idbSet(key, val) {
  return new Promise((resolve) => {
    if (!db) return resolve(false);
    try {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(val, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch { resolve(false); }
  });
}
// archivo interno del navegador (Origin Private File System)
async function opfsDir() {
  try { if (navigator.storage?.getDirectory) return await navigator.storage.getDirectory(); } catch { /* sin OPFS */ }
  return null;
}
async function opfsRead(name) {
  try { const d = await opfsDir(); if (!d) return null; const fh = await d.getFileHandle(name); const f = await fh.getFile(); return JSON.parse(await f.text()); } catch { return null; }
}
async function opfsWrite(name, obj) {
  try {
    const d = await opfsDir(); if (!d) return false;
    const fh = await d.getFileHandle(name, { create: true });
    if (!fh.createWritable) return false;
    const w = await fh.createWritable(); await w.write(JSON.stringify(obj)); await w.close();
    return true;
  } catch { return false; }
}
async function opfsList() {
  const out = [];
  try { const d = await opfsDir(); if (!d) return out; for await (const [name] of d.entries()) out.push(name); } catch { /* */ }
  return out;
}
async function opfsDelete(name) { try { const d = await opfsDir(); await d?.removeEntry(name); } catch { /* */ } }

/** Cuánto "pesa" un estado: para elegir la mejor copia y no pisar datos con un estado vacío. */
export function richness(d) {
  if (!d || typeof d !== 'object') return 0;
  return (Array.isArray(d.entries) ? d.entries.reduce((n, e) => n + ((e.items || []).length || 0), 0) : 0)
    + (Array.isArray(d.body) ? d.body.length : 0) + Object.keys(d.days || {}).length
    + ((d.gym?.sessions || []).length) + ((d.study?.sessions || []).length);
}

export const state = { data: defaultState(), ready: false, listeners: new Set(), storage: 'memoria', recovered: null, guardRichness: 0, allowShrink: false, persisted: null };

export async function loadState() {
  db = await openDB();
  const cands = [];
  const fromIdb = await idbGet(KEY);
  if (fromIdb) cands.push({ src: 'IndexedDB', d: fromIdb });
  try { const ls = localStorage.getItem(LS_KEY); if (ls) cands.push({ src: 'localStorage', d: JSON.parse(ls) }); } catch { /* sin acceso */ }
  const fromFile = await opfsRead('state.json');
  if (fromFile) cands.push({ src: 'archivo interno', d: fromFile });
  // la copia más completa; a igual contenido, la más reciente
  cands.sort((a, b) => richness(b.d) - richness(a.d) || (b.d.updatedAt || 0) - (a.d.updatedAt || 0));
  let best = cands[0] || null;
  // si alguna copia es más nueva y casi igual de completa, se prefiere esa
  for (const c of cands) if (best && c !== best && (c.d.updatedAt || 0) > (best.d.updatedAt || 0) && richness(c.d) >= richness(best.d) * 0.98) best = c;
  state.data = migrate(best ? best.d : defaultState());
  state.storage = db ? 'IndexedDB' : best ? best.src : 'memoria';
  if (best && best.src !== 'IndexedDB' && richness(best.d) > richness(fromIdb)) state.recovered = best.src;
  state.guardRichness = richness(state.data);
  syncFoods();
  state.ready = true;
  try {
    if (navigator.storage?.persist) {
      state.persisted = await navigator.storage.persisted?.();
      if (!state.persisted) state.persisted = await navigator.storage.persist();
    }
  } catch { /* opcional */ }
  if (state.recovered) save(true);
  dailySnapshot();
  return state.data;
}

let saveTimer = null;
let lastMirror = 0;
let lastSnap = 0;
export function save(immediate = false) {
  state.data.updatedAt = Date.now();
  clearTimeout(saveTimer);
  const run = async () => {
    const snapshot = state.data;
    const r = richness(snapshot);
    // protección: nunca reemplazar datos guardados por un estado vacío o casi vacío sin querer
    if (!state.allowShrink && state.guardRichness >= 10 && r < state.guardRichness * 0.5) {
      console.warn('ApexTrack: se evitó pisar los datos guardados con un estado casi vacío', r, state.guardRichness);
      return;
    }
    state.guardRichness = Math.max(r, state.allowShrink ? 0 : state.guardRichness * 0.5);
    if (state.allowShrink) { state.guardRichness = r; state.allowShrink = false; }
    await idbSet(KEY, snapshot);
    try { localStorage.setItem(LS_KEY, JSON.stringify(snapshot)); } catch { /* lleno o bloqueado */ }
    // el archivo interno se actualiza como mucho cada 20 s (o al cerrar)
    if (immediate || Date.now() - lastMirror > 20000) { lastMirror = Date.now(); await opfsWrite('state.json', snapshot); }
    if (Date.now() - lastSnap > 30 * 60000 || immediate) { lastSnap = Date.now(); dailySnapshot(); }
  };
  if (immediate) return run();
  saveTimer = setTimeout(run, 250);
  return Promise.resolve();
}
/** Guarda ya (al pasar la app a segundo plano). */
export function flush() { return save(true); }

// ---------- Fotos diarias (se guardan las últimas 4) ----------
export async function dailySnapshot() {
  try {
    if (richness(state.data) < 3) return;
    const name = `snap-${todayISO()}.json`;
    await opfsWrite(name, state.data);
    const snaps = (await opfsList()).filter((n) => /^snap-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
    for (const old of snaps.slice(0, Math.max(0, snaps.length - 7))) await opfsDelete(old);
  } catch { /* opcional */ }
}
/**
 * Antes de reemplazar o borrar los datos (restaurar, importar, borrar todo) se guarda una copia
 * de lo que había, por si fue un error. Se guardan las últimas 5.
 */
export async function safetySnapshot(reason = 'cambio') {
  try {
    if (richness(state.data) < 3) return false;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    await opfsWrite(`prev-${stamp}.json`, { ...state.data, _reason: reason });
    const prev = (await opfsList()).filter((n) => /^prev-.+\.json$/.test(n)).sort();
    for (const old of prev.slice(0, Math.max(0, prev.length - 5))) await opfsDelete(old);
    return true;
  } catch { return false; }
}
export async function listSnapshots() {
  const names = (await opfsList()).filter((n) => /^(snap-\d{4}-\d{2}-\d{2}|prev-.+)\.json$/.test(n)).sort((a, b) => b.slice(5).localeCompare(a.slice(5)));
  const out = [];
  for (const n of names) {
    const d = await opfsRead(n);
    if (d) out.push({ name: n, date: n.slice(5, 15), before: n.startsWith('prev-') ? (d._reason || 'cambio') : '', richness: richness(d), entries: (d.entries || []).length, updatedAt: d.updatedAt || 0, data: d });
  }
  return out;
}
/** Para reemplazos intencionales (restaurar una copia, borrar todo). */
export function allowShrinkOnce() { state.allowShrink = true; }

export function onChange(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); }
export function commit(reason = '') {
  syncFoods();
  save();
  for (const fn of state.listeners) { try { fn(reason); } catch (e) { console.error(e); } }
}

export function migrate(d) {
  const base = defaultState();
  const out = { ...base, ...d };
  out.settings = { ...base.settings, ...(d.settings || {}) };
  for (const k of ['profile', 'goals', 'ai', 'ui', 'backup']) out.settings[k] = { ...base.settings[k], ...((d.settings || {})[k] || {}) };
  // v2.2: la búsqueda de Google no tiene cupo en las claves gratuitas → apagada por defecto
  if (!out.settings.ai.webV2) { out.settings.ai.web = false; out.settings.ai.webV2 = true; }
  if (out.settings.ai.model && /^gemini-3\.(8|7|6)-flash$/.test(out.settings.ai.model) && !out.settings.ai.modelV2) out.settings.ai.model = 'auto';
  out.settings.ai.modelV2 = true;
  if (!Array.isArray(out.settings.moments) || !out.settings.moments.length) out.settings.moments = deepClone(DEFAULT_MOMENTS);
  if (!Array.isArray(out.settings.habits)) out.settings.habits = deepClone(DEFAULT_HABITS);
  out.learn = { ...base.learn, ...(d.learn || {}) };
  out.gym = { ...base.gym, ...(d.gym || {}) };
  if (!Array.isArray(out.gym.routines)) out.gym.routines = DEFAULT_ROUTINES();
  out.study = { ...defaultStudy(), ...(d.study || {}) };
  for (const k of ['subjects', 'sessions', 'events', 'tasks', 'notes']) if (!Array.isArray(out.study[k])) out.study[k] = [];
  for (const k of ['entries', 'body', 'customFoods', 'pending', 'aiLog', 'insights']) if (!Array.isArray(out[k])) out[k] = [];
  if (!out.days || typeof out.days !== 'object') out.days = {};
  if (!out.usage) out.usage = {};
  if (!out.settings.reminders || !Array.isArray(out.settings.reminders.list)) out.settings.reminders = { on: false, push: false, list: defaultReminders() };
  if (!out.settings.reminders.list.some((r) => r.id === 'r_sueno')) out.settings.reminders.list.push({ id: 'r_sueno', type: 'sueno', time: '22:45', days: [0, 1, 2, 3, 4, 5, 6], on: false, onlyIfMissing: true });
  if (!out.settings.weekly || typeof out.settings.weekly !== 'object') out.settings.weekly = { day: 1, ai: true };
  if (!out.settings.goals.steps) out.settings.goals.steps = 8000;
  if (!Array.isArray(out.weekly)) out.weekly = [];
  if (!out.settings.privacy || typeof out.settings.privacy !== 'object') out.settings.privacy = { count: true, ident: { on: false, name: '', contact: '', note: '' } };
  if (out.settings.ui.slotTab === 'agua') out.settings.ui.slotTab = 'gym'; // la pestaña Agua se quitó en la 2.6
  if (!out.sleep || typeof out.sleep !== 'object') out.sleep = { goalH: 8, wake: '07:00', nights: [], active: null };
  if (!out.fasting || typeof out.fasting !== 'object') out.fasting = { protocol: '16:8', active: null, history: [], dismissed: false };
  out.schema = SCHEMA;
  out.version = APP_VERSION;
  return out;
}

function syncFoods() {
  setCustomFoods(state.data.customFoods, state.data.learn.units);
}

// ---------- Accesos ----------
export const S = () => state.data;
export const goals = () => state.data.settings.goals;
export const moments = () => state.data.settings.moments;
export const habitsList = () => state.data.settings.habits;
export function momentById(id) { return moments().find((m) => m.id === id) || null; }
export function momentName(id) { const m = momentById(id); return m ? m.name : (id || 'Comida'); }
export function momentIndex(id) { const i = moments().findIndex((m) => m.id === id); return i < 0 ? 99 : i; }

/** Momento sugerido según la hora */
export function momentForTime(d = new Date()) {
  const h = d.getHours() + d.getMinutes() / 60;
  for (const m of moments()) {
    if (!m.h) continue;
    const [a, b] = m.h;
    if (a <= b ? (h >= a && h < b) : (h >= a || h < b)) return m.id;
  }
  return moments()[0]?.id || 'almuerzo';
}

/** Busca un momento por nombre libre ("media tarde", "colación", "post cena") */
export function matchMoment(text) {
  const n = norm(text).replace(/-/g, ' ');
  if (!n) return null;
  const list = moments();
  for (const m of list) if (norm(m.name).replace(/-/g, ' ') === n || m.id === n.replace(/ /g, '_')) return m.id;
  const syn = [
    [/desayun/, 'desayuno'], [/media manana|colacion de la manana|mitad de la manana/, 'media_manana'],
    [/almuerz|mediodia/, 'almuerzo'], [/media tarde/, 'media_tarde'], [/merienda|merende/, 'merienda'],
    [/pre ?entren/, 'pre_entreno'], [/post ?entren|despues de entrenar|despues del gym/, 'post_entreno'],
    [/post ?cena|colacion nocturna|despues de cenar|antes de dormir|noche tarde/, 'post_cena'], [/cena|cene/, 'cena'],
    [/colacion|snack|picoteo/, 'media_tarde'],
  ];
  for (const [re, id] of syn) if (re.test(n) && list.some((m) => m.id === id)) return id;
  return null;
}

export function day(date) {
  const d = state.data.days[date];
  return d || { water: 0, habits: {}, gym: null, study: 0, note: '' };
}
export function ensureDay(date) {
  if (!state.data.days[date]) state.data.days[date] = { water: 0, habits: {}, gym: null, study: 0, note: '' };
  return state.data.days[date];
}

// ---------- Ítems y comidas ----------
export function itemMacros(it) {
  if (!it) return { kcal: 0, p: 0, c: 0, f: 0, s: 0, fb: 0 };
  if (it.per100 && it.grams != null) return calc(it.per100, it.grams);
  const fx = it.fixed || {};
  return { kcal: round0(fx.kcal), p: round1(fx.p), c: round1(fx.c), f: round1(fx.f), s: round1(fx.s), fb: round1(fx.fb) };
}
export function sumMacros(list) {
  const t = { kcal: 0, p: 0, c: 0, f: 0, s: 0, fb: 0 };
  for (const m of list) for (const k of Object.keys(t)) t[k] += Number(m[k]) || 0;
  t.kcal = round0(t.kcal); for (const k of ['p', 'c', 'f', 's', 'fb']) t[k] = round1(t[k]);
  return t;
}
export function entryMacros(e) { return sumMacros((e.items || []).map(itemMacros)); }

export function entriesOn(date) {
  return state.data.entries.filter((e) => e.date === date).sort((a, b) => momentIndex(a.moment) - momentIndex(b.moment));
}
export function dayTotals(date) {
  const es = entriesOn(date);
  const t = sumMacros(es.map(entryMacros));
  t.items = es.reduce((n, e) => n + (e.items || []).length, 0);
  return t;
}
export function hasData(date) {
  const d = state.data.days[date];
  return state.data.entries.some((e) => e.date === date && e.items?.length) || !!(d && (d.water || d.gym || Object.values(d.habits || {}).some(Boolean)));
}

/** Agrega ítems a la comida (fecha + momento). Si ya existe, los suma. */
export function addItems(date, moment, items, meta = {}) {
  let e = state.data.entries.find((x) => x.date === date && x.moment === moment);
  const now = Date.now();
  if (!e) {
    e = { id: uid('e'), date, moment, items: [], createdAt: now, updatedAt: now, source: meta.source || 'manual' };
    state.data.entries.push(e);
  }
  for (const it of items) {
    const clean = cleanItem(it);
    e.items.push(clean);
    bumpUsage(clean);
  }
  e.updatedAt = now;
  if (meta.input) e.input = [e.input, meta.input].filter(Boolean).join('\n');
  return e;
}
export function cleanItem(it) {
  const out = {
    id: it.id || uid('i'), name: String(it.name || 'Alimento').trim(), foodId: it.foodId || null,
    qty: Number.isFinite(Number(it.qty)) ? Number(it.qty) : 1, unit: it.unit || 'g',
    grams: it.grams == null || it.grams === '' ? null : Math.max(0, Number(it.grams) || 0), liq: !!it.liq,
    per100: it.per100 ? { ...it.per100 } : null, fixed: it.fixed ? { ...it.fixed } : null,
    basis: it.basis || 'manual', confidence: it.confidence || 'media', note: it.note || '',
  };
  if (it.sources?.length) out.sources = it.sources.slice(0, 4);
  if (it.ingredients?.length) out.ingredients = it.ingredients.map((g) => ({ name: g.name, grams: Number(g.grams) || 0, per100: g.per100 ? { ...g.per100 } : null }));
  if (it.fraction) out.fraction = it.fraction;
  if (it.sourceText) out.sourceText = it.sourceText;
  if (it.state) out.state = it.state;
  if (it.refLabel) out.refLabel = it.refLabel;
  if (!out.per100 && !out.fixed) out.fixed = { kcal: 0, p: 0, c: 0, f: 0, s: 0, fb: 0 };
  return out;
}
function bumpUsage(it) {
  const k = it.foodId || 'n:' + norm(it.name).slice(0, 60);
  state.data.usage[k] = (state.data.usage[k] || 0) + 1;
}
export function findItem(itemId) {
  for (const e of state.data.entries) {
    const i = (e.items || []).findIndex((x) => x.id === itemId);
    if (i >= 0) return { entry: e, index: i, item: e.items[i] };
  }
  return null;
}
export function removeItem(itemId) {
  const f = findItem(itemId);
  if (!f) return null;
  const [it] = f.entry.items.splice(f.index, 1);
  if (!f.entry.items.length) state.data.entries = state.data.entries.filter((e) => e !== f.entry);
  return { ...f, item: it };
}
export function moveItem(itemId, date, moment) {
  const r = removeItem(itemId);
  if (!r) return;
  const e = addItems(date, moment, [r.item], { source: 'manual' });
  return e;
}
export function removeEntry(entryId) {
  const i = state.data.entries.findIndex((e) => e.id === entryId);
  if (i < 0) return null;
  return state.data.entries.splice(i, 1)[0];
}
export function copyEntryTo(entryId, date, moment) {
  const e = state.data.entries.find((x) => x.id === entryId);
  if (!e) return null;
  const items = e.items.map((it) => ({ ...deepClone(it), id: uid('i') }));
  return addItems(date, moment || e.moment, items, { source: 'copia' });
}

// ---------- Agua, hábitos, gym, peso ----------
export function addWater(date, ml) {
  const d = ensureDay(date);
  d.water = Math.max(0, Math.round((Number(d.water) || 0) + Number(ml || 0)));
  return d.water;
}
export function setWater(date, ml) { ensureDay(date).water = Math.max(0, Math.round(Number(ml) || 0)); }
export function setHabit(date, habitId, val) {
  const d = ensureDay(date);
  d.habits = d.habits || {};
  d.habits[habitId] = !!val;
}
export function toggleHabit(date, habitId) {
  const d = ensureDay(date);
  d.habits = d.habits || {};
  d.habits[habitId] = !d.habits[habitId];
  return d.habits[habitId];
}
export function setGym(date, status, detail) {
  const d = ensureDay(date);
  d.gym = status || null;
  if (detail !== undefined) d.gymDetail = detail || '';
}
export function setStudy(date, hours) { ensureDay(date).study = Math.max(0, round1(hours)); }

export function bodyOn(date) { return state.data.body.find((b) => b.date === date) || null; }
export function upsertBody(date, fields) {
  let b = bodyOn(date);
  if (!b) { b = { id: uid('b'), date }; state.data.body.push(b); }
  for (const [k, v] of Object.entries(fields)) {
    if (v === '' || v == null || !Number.isFinite(Number(v))) { if (v === '' || v == null) delete b[k]; continue; }
    b[k] = Number(v);
  }
  if (fields.note !== undefined) b.note = fields.note;
  state.data.body.sort((a, c) => a.date.localeCompare(c.date));
  return b;
}
/** Borra el pesaje de un día (si el registro no tiene medidas, se va entero). */
export function deleteWeight(date) {
  const b = bodyOn(date);
  if (!b) return;
  delete b.weight;
  const keep = Object.keys(b).some((k) => !['id', 'date', 'note'].includes(k));
  if (!keep) state.data.body = state.data.body.filter((x) => x !== b);
}
export function weightSeries() {
  return state.data.body.filter((b) => Number.isFinite(b.weight)).map((b) => ({ date: b.date, kg: b.weight })).sort((a, b) => a.date.localeCompare(b.date));
}
/** Peso tendencia (media móvil exponencial, como apps tipo MacroFactor/Happy Scale) */
export function weightTrend() {
  const s = weightSeries();
  if (!s.length) return [];
  const out = [];
  let t = s[0].kg; let prev = s[0].date;
  for (const p of s) {
    const gap = Math.max(1, daysBetween(prev, p.date));
    const alpha = 1 - Math.pow(0.9, gap);
    t = t + alpha * (p.kg - t);
    out.push({ date: p.date, kg: p.kg, trend: round1(t) });
    prev = p.date;
  }
  return out;
}
export function latestWeight(upTo = todayISO()) {
  const s = weightSeries().filter((p) => p.date <= upTo);
  return s.length ? s[s.length - 1] : null;
}

// ---------- Estadísticas ----------
export function weekDays(startIso) { return dateRange(startIso, addDays(startIso, 6)); }
export function weekSummary(startIso) {
  return weekDays(startIso).map((date) => ({ date, ...dayTotals(date), water: day(date).water || 0, gym: day(date).gym || null }));
}
export function gymCountWeek(dateIso) {
  const ws = weekStart(dateIso);
  return weekDays(ws).filter((d) => day(d).gym === 'fui').length;
}
export function loggedDates() {
  const set = new Set(state.data.entries.filter((e) => e.items?.length).map((e) => e.date));
  return [...set].sort();
}
export function streak(today = todayISO()) {
  const set = new Set(loggedDates());
  let n = 0; let d = set.has(today) ? today : addDays(today, -1);
  while (set.has(d)) { n++; d = addDays(d, -1); }
  return n;
}
/**
 * ¿El día ya terminó para las estadísticas? Los días pasados sí. Hoy solo si es tarde (después de las 22)
 * y ya registraste la cena (o algo después): si no, hoy bajaría los promedios.
 */
export function dayComplete(date, now = new Date()) {
  const today = todayISO();
  if (date < today) return true;
  if (date > today) return false;
  if (now.getHours() < 22) return false;
  const idx = momentIndex('cena');
  return entriesOn(date).some((e) => momentIndex(e.moment) >= (idx === 99 ? 6 : idx));
}
/** Días para promediar: con registros y ya terminados. */
export const statDays = (dates) => dates.filter((d) => entriesOn(d).length && dayComplete(d));

export function averages(days = 7, upTo = todayISO()) {
  const dates = statDays(dateRange(addDays(upTo, -(days - 1)), upTo));
  if (!dates.length) return null;
  const tot = dates.map((d) => ({ ...dayTotals(d), water: day(d).water || 0 }));
  const avg = {};
  for (const k of ['kcal', 'p', 'c', 'f', 's', 'fb', 'water']) avg[k] = tot.reduce((a, t) => a + (t[k] || 0), 0) / tot.length;
  const g = goals();
  avg.days = dates.length;
  avg.kcalHit = tot.filter((t) => t.kcal >= g.kcal * 0.95).length;
  avg.protHit = tot.filter((t) => t.p >= g.p).length;
  return avg;
}
export function topFoods(days = 30, upTo = todayISO(), limit = 8) {
  const from = addDays(upTo, -(days - 1));
  const map = new Map();
  for (const e of state.data.entries) {
    if (e.date < from || e.date > upTo) continue;
    for (const it of e.items || []) {
      const k = norm(it.name);
      const m = itemMacros(it);
      const cur = map.get(k) || { name: it.name, kcal: 0, p: 0, n: 0 };
      cur.kcal += m.kcal; cur.p += m.p; cur.n += 1;
      map.set(k, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.kcal - a.kcal).slice(0, limit);
}
export function byMomentShare(days = 14, upTo = todayISO()) {
  const from = addDays(upTo, -(days - 1));
  const acc = {};
  for (const e of state.data.entries) {
    if (e.date < from || e.date > upTo) continue;
    const m = entryMacros(e);
    acc[e.moment] = acc[e.moment] || { kcal: 0, p: 0 };
    acc[e.moment].kcal += m.kcal; acc[e.moment].p += m.p;
  }
  return acc;
}

// ---------- Biblioteca personal para la IA y para buscar ----------
/** Alimentos frecuentes del historial, agrupados por nombre, con valores por 100 g o por unidad. */
export function historyFoods({ days = 90, upTo = todayISO(), limit = 60 } = {}) {
  const from = addDays(upTo, -(days - 1));
  const map = new Map();
  for (const e of state.data.entries) {
    if (e.date < from || e.date > upTo) continue;
    for (const it of e.items || []) {
      const k = norm(it.name);
      if (!k) continue;
      let cur = map.get(k);
      if (!cur) { cur = { key: k, name: it.name, n: 0, last: e.date, per100: null, perUnit: null, units: {}, liq: !!it.liq }; map.set(k, cur); }
      cur.n += 1;
      if (e.date >= cur.last) { cur.last = e.date; cur.name = it.name; }
      if (it.per100 && it.grams) {
        cur.per100 = it.per100;
        const u = it.unit;
        if (u && u !== 'g' && u !== 'ml' && it.qty > 0) cur.units[u] = round1(it.grams / it.qty);
      } else if (!it.per100 && it.fixed && it.qty > 0 && it.unit && it.unit !== 'g' && it.unit !== 'ml') {
        const m = itemMacros(it);
        cur.perUnit = { unit: it.unit, kcal: round0(m.kcal / it.qty), p: round1(m.p / it.qty), c: round1(m.c / it.qty), f: round1(m.f / it.qty), s: round1(m.s / it.qty) };
      } else if (!it.per100 && it.fixed && it.grams > 0) {
        const m = itemMacros(it);
        const k100 = 100 / it.grams;
        cur.per100 = { kcal: round0(m.kcal * k100), p: round1(m.p * k100), c: round1(m.c * k100), f: round1(m.f * k100), s: round1(m.s * k100), fb: round1(m.fb * k100) };
      }
    }
  }
  return [...map.values()].filter((x) => x.per100 || x.perUnit).sort((a, b) => b.n - a.n || b.last.localeCompare(a.last)).slice(0, limit);
}

/** Ítems de los últimos días (para referencias como "el bizcochuelo de ayer"). */
export function recentItems(days = 4, upTo = todayISO()) {
  const from = addDays(upTo, -days);
  const out = [];
  for (const e of state.data.entries) {
    if (e.date < from || e.date > upTo) continue;
    for (const it of e.items || []) out.push({ date: e.date, moment: e.moment, item: it });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

// ---------- Aprendizaje ----------
export function learnUnit(foodId, unit, gramsPerUnit) {
  const u = canonUnit(unit) || unit;
  if (!foodId || !u || u === 'g' || u === 'ml' || !(gramsPerUnit > 0)) return;
  const L = state.data.learn.units;
  L[foodId] = L[foodId] || {};
  L[foodId][u] = round1(gramsPerUnit);
}
export function learnAlias(text, foodId) {
  const k = norm(text);
  if (!k || !foodId) return;
  state.data.learn.aliases[k] = foodId;
}
export function logCorrection(c) {
  const list = state.data.learn.corrections;
  list.unshift({ ...c, at: Date.now() });
  if (list.length > 80) list.length = 80;
}
/** Descripciones de lo aprendido, para pasarle a la IA */
export function learnedHints() {
  const out = [];
  const L = state.data.learn;
  for (const [fid, units] of Object.entries(L.units || {})) {
    const f = getFood(fid);
    if (!f) continue;
    for (const [u, g] of Object.entries(units)) out.push(`${f.n}: 1 ${unitLabel(u)} = ${g} ${f.liq ? 'ml' : 'g'}`);
  }
  for (const [txt, fid] of Object.entries(L.aliases || {})) {
    const f = getFood(fid);
    if (f && norm(f.n) !== txt) out.push(`"${txt}" = ${f.n}`);
  }
  return out.slice(0, 40);
}

// ---------- Mis alimentos y recetas ----------
export function saveCustomFood(food) {
  const list = state.data.customFoods;
  const f = { cat: 'mis', a: [], u: {}, s: 0, fb: 0, ...food };
  f.id = f.id || uid('mis');
  const { per100 } = sanitizePer100({ kcal: f.k, p: f.p, c: f.c, f: f.f, s: f.s, fb: f.fb });
  Object.assign(f, { k: per100.kcal, p: per100.p, c: per100.c, f: per100.f, s: per100.s, fb: per100.fb });
  if (!f.d) { const u0 = Object.keys(f.u || {})[0]; f.d = u0 ? [u0, 1] : ['g', 100]; }
  f.updatedAt = Date.now();
  const i = list.findIndex((x) => x.id === f.id);
  if (i >= 0) list[i] = f; else list.push(f);
  return f;
}
export function deleteCustomFood(id) {
  state.data.customFoods = state.data.customFoods.filter((f) => f.id !== id);
}

// ---------- Gimnasio ----------
export function routines() { return state.data.gym.routines; }
export function sessionsOf(routineId) { return state.data.gym.sessions.filter((s) => !routineId || s.routineId === routineId).sort((a, b) => b.date.localeCompare(a.date) || b.startedAt - a.startedAt); }
export function lastSetsFor(exName, beforeDate = '9999-12-31') {
  const n = norm(exName);
  const ss = state.data.gym.sessions.filter((s) => s.date < beforeDate || (s.date === beforeDate && s.done)).sort((a, b) => b.date.localeCompare(a.date) || (b.startedAt || 0) - (a.startedAt || 0));
  for (const s of ss) {
    const ex = (s.exercises || []).find((e) => norm(e.name) === n);
    if (ex && ex.sets?.some((x) => x.kg || x.reps)) return { date: s.date, sets: ex.sets.filter((x) => x.kg || x.reps) };
  }
  return null;
}
export const e1rm = (kg, reps) => (kg > 0 && reps > 0 ? round1(kg * (1 + Math.min(reps, 15) / 30)) : 0);
export function exerciseHistory(exName) {
  const n = norm(exName);
  const pts = [];
  for (const s of state.data.gym.sessions) {
    const ex = (s.exercises || []).find((e) => norm(e.name) === n);
    if (!ex) continue;
    let best = 0; let top = 0; let vol = 0;
    for (const st of ex.sets || []) {
      const kg = Number(st.kg) || 0; const r = Number(st.reps) || 0;
      best = Math.max(best, e1rm(kg, r)); top = Math.max(top, kg); vol += kg * r;
    }
    if (best || top) pts.push({ date: s.date, e1rm: best, top, vol: round0(vol) });
  }
  return pts.sort((a, b) => a.date.localeCompare(b.date));
}
/** Sugerencia de progresión: si en la última sesión todas las series llegaron al tope del rango, subir carga. */
export function progressionHint(ex, last) {
  if (!last || !last.sets?.length) return '';
  const [lo, hi] = String(ex.reps || '').split('-').map((x) => parseInt(x, 10));
  const top = Math.max(...last.sets.map((s) => Number(s.kg) || 0));
  const allHigh = hi && last.sets.every((s) => (Number(s.reps) || 0) >= hi);
  const anyLow = lo && last.sets.some((s) => (Number(s.reps) || 0) < lo);
  if (allHigh && top) return `Llegaste a ${hi} reps en todas: probá ${round1(top + (top >= 40 ? 2.5 : 1))} kg.`;
  if (anyLow && top) return `Quedaste debajo de ${lo} reps: mantené ${top} kg.`;
  if (top) return `Objetivo: sumar 1 rep por serie con ${top} kg.`;
  return '';
}

// ---------- Utilidades de fecha para la vista ----------
export function isFuture(date) { return date > todayISO(); }
export function validDate(d) { return isISODate(d) ? d : todayISO(); }
export function monthsWithData() {
  const set = new Set(state.data.entries.map((e) => e.date.slice(0, 7)));
  return [...set].sort();
}
export function firstDate() {
  const ds = loggedDates();
  return ds[0] || todayISO();
}
export function dayLabelStats(date) {
  const t = dayTotals(date);
  const g = goals();
  return { ...t, pct: g.kcal ? t.kcal / g.kcal : 0, protPct: g.p ? t.p / g.p : 0 };
}

export function resetAll() {
  safetySnapshot('antes de borrar todo');
  state.allowShrink = true;
  state.data = defaultState();
  syncFoods();
}

export function replaceAll(data) {
  safetySnapshot('antes de restaurar');
  state.allowShrink = true;
  state.data = migrate(data);
  syncFoods();
}

export { parseISO };
