// ApexTrack — utilidades generales (fechas, formato, texto)

export const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const DIAS_INICIAL = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const pad = (n) => String(n).padStart(2, '0');

/** Fecha LOCAL en formato YYYY-MM-DD (nunca UTC: evita el salto de día después de las 21 h en Argentina). */
export function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const todayISO = () => isoDate(new Date());
export const isISODate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseISO(s).getTime());

export function parseISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
}
export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
export function addMonths(iso, n) {
  const d = parseISO(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return isoDate(d);
}
export function daysBetween(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 86400000);
}
/** Lunes de la semana de una fecha */
export function weekStart(iso) {
  const d = parseISO(iso);
  const dow = (d.getDay() + 6) % 7; // 0 = lunes
  d.setDate(d.getDate() - dow);
  return isoDate(d);
}
export function monthStart(iso) { return iso.slice(0, 8) + '01'; }
export function dateRange(from, to) {
  const out = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard++ < 5000) { out.push(cur); cur = addDays(cur, 1); }
  return out;
}
export const weekdayIndex = (iso) => parseISO(iso).getDay();

/** "vie 17 oct" */
export function fmtDayShort(iso) {
  const d = parseISO(iso);
  return `${DIAS_CORTOS[d.getDay()]} ${d.getDate()} ${MESES_CORTOS[d.getMonth()]}`;
}
/** "viernes 17 de octubre" */
export function fmtDayLong(iso, withYear = false) {
  const d = parseISO(iso);
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}${withYear ? ' de ' + d.getFullYear() : ''}`;
}
export function fmtMonthYear(iso) {
  const d = parseISO(iso);
  return `${MESES[d.getMonth()]} ${d.getFullYear()}`;
}
/** "17/10" */
export function fmtDM(iso) {
  const d = parseISO(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}
/** "17/10/2026" */
export function fmtDMY(iso) {
  const d = parseISO(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
export function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
/** "Hoy", "Ayer", "Mañana" o "Vie 17 oct" */
export function relativeDayLabel(iso, today = todayISO()) {
  const diff = daysBetween(iso, today);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  if (diff === 2) return 'Anteayer';
  if (diff === -1) return 'Mañana';
  return cap(fmtDayShort(iso));
}
export function nowHHMM(d = new Date()) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

const nf0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1, minimumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
export function fmt(n, dec = 0) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '–';
  return (dec === 0 ? nf0 : dec === 1 ? nf1 : nf2).format(v);
}
export const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
export const round0 = (n) => Math.round(Number(n) || 0);
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

/** Acepta "1,5", "1.5" o "1.206,5" */
export function parseNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (v == null) return NaN;
  let s = String(v).trim().replace(/\s/g, '');
  if (!s) return NaN;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

/** minúsculas, sin tildes, sin signos raros, espacios simples */
export function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ.,/\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export function slug(s) {
  return norm(s).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'item';
}

export function debounce(fn, ms = 250) {
  let t;
  const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  f.flush = (...a) => { clearTimeout(t); fn(...a); };
  return f;
}

export function vibrate(pattern = 12) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* sin vibración */ }
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function deepClone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
