// ApexTrack — aprendizaje compartido de la IA propia (la que funciona sin conexión).
// Cada vez que alguien guarda una comida analizada por Gemini, se envía en forma anónima qué dijo
// ("dos milanesas de pollo al horno") y qué entendió la IA (alimento, cantidad, gramos, valores por
// 100 g). El servidor (server/comunidad.gs) junta los aportes de todas las personas y arma un
// "conocimiento" que cada teléfono descarga: alimentos nuevos, sus medidas caseras y las frases con
// que se los nombra. Así la IA propia entiende cada vez más mensajes sin gastar consultas de Gemini.
// No se envía: nombre, peso, metas, clave de la IA ni nada que identifique a la persona.
import { COMMUNITY_URL } from './config.js';
import * as store from './store.js';
import { setCommunityFoods, parseSegment, sanitizePer100 } from './foods.js';
import { uid, todayISO, daysBetween, round1 } from './util.js';

const K_KNOW = 'apextrack_comunidad';
const K_QUEUE = 'apextrack_aportes';
const K_ID = 'apextrack_instalacion';
const MAX_QUEUE = 400;
const BATCH = 60;
const SYNC_EVERY = 2 * 86400000;

export const available = () => !!COMMUNITY_URL;
export const sharing = () => available() && store.S().settings.ai.share !== false;

function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }

/** Identificador anónimo de esta instalación (solo para contar cuántas personas confirman un dato). */
export function installId() {
  let id = lsGet(K_ID);
  if (!id) { id = uid('ins'); lsSet(K_ID, id); }
  return id;
}

// ---------------------------------------------------------------------------
// Conocimiento descargado
// ---------------------------------------------------------------------------
function cleanFood(f) {
  if (!f || typeof f !== 'object' || !f.n) return null;
  const { per100 } = sanitizePer100({ kcal: f.k, p: f.p, c: f.c, f: f.f, s: f.s, fb: f.fb, al: f.al });
  if (!(per100.kcal >= 0)) return null;
  const u = {};
  for (const [k, v] of Object.entries(f.u || {})) if (Number(v) > 0 && Number(v) <= 3000) u[k] = round1(Number(v));
  return {
    id: String(f.id || '').startsWith('com_') ? String(f.id) : 'com_' + String(f.id || f.n).slice(0, 40),
    n: String(f.n).slice(0, 100), a: (Array.isArray(f.a) ? f.a : []).map(String).slice(0, 12),
    k: per100.kcal, p: per100.p, c: per100.c, f: per100.f, s: per100.s, fb: per100.fb, al: per100.al,
    u, liq: f.liq ? 1 : 0, users: Number(f.users) || 1,
  };
}

/** Carga lo descargado la última vez (funciona sin conexión). */
export function loadKnowledge() {
  const k = lsGet(K_KNOW);
  if (k && Array.isArray(k.foods)) setCommunityFoods(k.foods, k.phrases || {});
  return k;
}
export function knowledgeInfo() {
  const k = lsGet(K_KNOW);
  return k ? { at: k.at, fetchedAt: k.fetchedAt, foods: (k.foods || []).length, phrases: Object.keys(k.phrases || {}).length, users: k.users || 0, records: k.records || 0 } : null;
}

export async function syncKnowledge({ force = false } = {}) {
  if (!available() || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;
  const k = lsGet(K_KNOW);
  if (!force && k && Date.now() - (k.fetchedAt || 0) < SYNC_EVERY) return k;
  const r = await fetch(`${COMMUNITY_URL}?op=conocimiento`);
  const j = await r.json();
  if (!j || !j.ok || !Array.isArray(j.foods)) throw new Error((j && j.error) || 'Respuesta inválida del servidor');
  const out = { at: j.at || new Date().toISOString(), fetchedAt: Date.now(), foods: j.foods.map(cleanFood).filter(Boolean), phrases: j.phrases || {}, users: j.users || 0, records: j.records || 0 };
  // si no entra en el almacenamiento, se guarda lo más confirmado
  if (!lsSet(K_KNOW, out)) { out.foods.sort((a, b) => b.users - a.users); out.foods = out.foods.slice(0, 1500); lsSet(K_KNOW, out); }
  setCommunityFoods(out.foods, out.phrases);
  return out;
}

// ---------------------------------------------------------------------------
// Aportes
// ---------------------------------------------------------------------------
/** Arma los aportes anónimos de un borrador analizado por Gemini (lo que se guardó, con los ajustes de la persona). */
export function recordsFromDraft(draft, today = todayISO()) {
  if (!draft || draft.meta?.engine !== 'ia') return [];
  const model = draft.meta.model || '';
  const recs = [];
  const summary = [];
  for (const g of draft.groups) {
    for (const it of g.items) {
      if (!it.per100 || !(it.grams > 0)) continue;
      const said = String(it.said || '').slice(0, 120);
      summary.push({ d: daysBetween(g.date, today), m: g.moment, said, name: it.name, qty: it.qty, unit: it.unit, grams: it.grams });
      if (it.basis === 'referencia') continue; // recetas propias de la persona: no son conocimiento general
      const p = it.per100;
      recs.push({
        t: 'item', said, food: said ? parseSegment(said).text.slice(0, 80) : '', name: String(it.name).slice(0, 100),
        qty: it.qty, unit: it.unit, grams: it.grams, liq: it.liq ? 1 : 0, state: it.state || '', basis: it.basis, conf: it.confidence || '',
        edited: it._edited ? 1 : 0, k: p.kcal, p: p.p, c: p.c, f: p.f, s: p.s || 0, fb: p.fb || 0, al: p.al || 0,
        ing: it.ingredients ? it.ingredients.length : 0, model,
      });
    }
  }
  const input = String(draft.meta.input || '').trim();
  if (input && summary.length) recs.push({ t: 'msg', text: input.slice(0, 1000), items: summary, water: draft.water.length, habits: draft.habits.length, gym: draft.gym.length, model });
  return recs;
}

export function contribute(draft) {
  if (!sharing()) return;
  const recs = recordsFromDraft(draft);
  if (!recs.length) return;
  const q = lsGet(K_QUEUE) || [];
  q.push(...recs.map((r) => ({ ...r, at: Date.now() })));
  lsSet(K_QUEUE, q.slice(-MAX_QUEUE));
  flush().catch(() => {});
}

let flushing = false;
export async function flush() {
  if (flushing || !sharing() || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  flushing = true;
  try {
    for (let guard = 0; guard < 8; guard++) {
      const q = lsGet(K_QUEUE) || [];
      if (!q.length) return;
      const batch = q.slice(0, BATCH);
      const r = await fetch(COMMUNITY_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ v: 1, app: store.APP_VERSION, install: installId(), records: batch }) });
      const j = await r.json().catch(() => null);
      if (!j || !j.ok) return;
      const rest = (lsGet(K_QUEUE) || []).slice(batch.length);
      lsSet(K_QUEUE, rest);
    }
  } finally { flushing = false; }
}
export const queued = () => (lsGet(K_QUEUE) || []).length;

// ---------------------------------------------------------------------------
// Contador de uso: una vez por día, anónimo (número al azar). Si la persona eligió identificarse en
// Ajustes → Privacidad, también va el nombre y el contacto que escribió.
// ---------------------------------------------------------------------------
export function privacy() {
  const S = store.S();
  if (!S.settings.privacy || typeof S.settings.privacy !== 'object') S.settings.privacy = { count: true, ident: { on: false, name: '', contact: '', note: '' } };
  if (!S.settings.privacy.ident) S.settings.privacy.ident = { on: false, name: '', contact: '', note: '' };
  return S.settings.privacy;
}
export async function pingUsage({ force = false, always = false } = {}) {
  const pv = privacy();
  if (!available() || (!always && pv.count === false && !pv.ident.on) || (typeof navigator !== 'undefined' && navigator.onLine === false)) return false;
  const day = todayISO();
  if (!force && lsGet('apextrack_ping') === day) return false;
  const S = store.S();
  const body = {
    op: 'ping', install: installId(), app: store.APP_VERSION,
    items: S.entries.reduce((n, e) => n + (e.items || []).length, 0), days: new Set(S.entries.map((e) => e.date)).size,
    ai: !!S.settings.ai.key, reminders: !!S.settings.reminders?.on,
    ident: pv.ident.on ? { on: true, name: pv.ident.name, contact: pv.ident.contact, note: pv.ident.note } : null,
  };
  const r = await fetch(COMMUNITY_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => null);
  if (r?.ok) lsSet('apextrack_ping', day);
  return !!r?.ok;
}

/** Al abrir: usa lo descargado, manda lo pendiente y actualiza el conocimiento cada 2 días. */
export function startCommunity() {
  loadKnowledge();
  if (!available()) return;
  setTimeout(() => { flush().catch(() => {}); syncKnowledge().catch(() => {}); pingUsage().catch(() => {}); }, 12000);
  window.addEventListener('online', () => { flush().catch(() => {}); });
}
