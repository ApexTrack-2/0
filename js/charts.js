// ApexTrack — gráficos SVG livianos (barras semanales, línea de peso/progreso).
// Reglas: barras ≤ 24 px con punta redondeada de 4 px, líneas de 2 px, grilla en línea fina sólida,
// texto con colores de texto (nunca el color de la serie), un solo eje.
import { esc, fmt, parseISO, DIAS_INICIAL, fmtDM } from './util.js';

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 3 ? 3 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 6 ? 6 : n <= 8 ? 8 : 10;
  return step * p;
}
const compact = (v) => (v >= 1000 ? `${fmt(v / 1000, v % 1000 ? 1 : 0)}K` : fmt(v));

/** Columna con punta redondeada (4 px) y base recta */
function colPath(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/**
 * Barras de la semana (lunes a domingo).
 * days: [{ date, value }] ; goal: número ; sel: fecha resaltada
 */
export function weekBars({ days, goal = 0, sel = null, unit = 'kcal', dec = 0, today = null, height = 176, marks = null }) {
  // marks(fecha) → { gym, walk }: rayitas de color debajo del día (entrenó / caminó)
  const W = 340; const H = height + (marks ? 12 : 0); const padL = 34; const padR = 8; const padT = 18; const padB = marks ? 36 : 24;
  const plotW = W - padL - padR; const plotH = H - padT - padB;
  const maxV = niceMax(Math.max(goal * 1.15, ...days.map((d) => d.value || 0), 1));
  const y = (v) => padT + plotH - (v / maxV) * plotH;
  const band = plotW / days.length;
  const bw = Math.min(24, band * 0.56);
  const ticks = [0, maxV / 2, maxV];
  let g = '';
  for (const t of ticks) g += `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${padL - 6}" y="${y(t) + 3.5}" class="tick" text-anchor="end">${compact(t)}</text>`;
  let bars = '';
  days.forEach((d, i) => {
    const cx = padL + band * i + band / 2;
    const v = d.value || 0;
    const top = y(v);
    const isSel = d.date === sel;
    const future = today && d.date > today;
    if (v > 0) bars += `<path d="${colPath(cx - bw / 2, top, bw, padT + plotH - top)}" class="bar ${isSel ? 'sel' : ''}"/>`;
    else if (!future) bars += `<rect x="${cx - bw / 2}" y="${padT + plotH - 2}" width="${bw}" height="2" rx="1" class="bar-empty"/>`;
    const dow = DIAS_INICIAL[parseISO(d.date).getDay()];
    bars += `<text x="${cx}" y="${H - (marks ? 17 : 8)}" class="tick xl ${isSel ? 'on' : ''}" text-anchor="middle">${dow}${parseISO(d.date).getDate()}</text>`;
    const mk = marks && !future ? marks(d.date) : null;
    if (mk && (mk.gym || mk.walk)) {
      // una arriba de la otra: gimnasio arriba, caminata abajo (siempre en el mismo renglón)
      const w = bw + 4;
      if (mk.gym) bars += `<rect x="${cx - w / 2}" y="${H - 10.5}" width="${w}" height="3.5" rx="1.75" class="mk-gym"/>`;
      if (mk.walk) bars += `<rect x="${cx - w / 2}" y="${H - 5.5}" width="${w}" height="3.5" rx="1.75" class="mk-walk"/>`;
    }
    if (isSel && v > 0) bars += `<text x="${cx}" y="${Math.max(11, top - 6)}" class="val" text-anchor="middle">${fmt(v, dec)}</text>`;
    bars += `<rect x="${padL + band * i}" y="${padT}" width="${band}" height="${plotH + padB}" class="hit" data-date="${d.date}" tabindex="0" role="button" aria-label="${esc(d.date)}: ${fmt(v, dec)} ${unit}"/>`;
  });
  const goalLine = goal > 0 ? `<line x1="${padL}" x2="${W - padR}" y1="${y(goal)}" y2="${y(goal)}" class="goal"/><text x="${W - padR}" y="${y(goal) - 5}" class="tick goal-t" text-anchor="end">Meta ${fmt(goal, dec)}</text>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Gráfico semanal de ${unit}">${g}${bars}${goalLine}</svg>`;
}

/**
 * Línea de peso: puntos (pesajes) + línea de tendencia.
 * points: [{ date, kg, trend }]
 */
export function weightLine({ points, height = 190, unit = 'kg', goal = null }) {
  if (!points.length) return '';
  const W = 340; const H = height; const padL = 34; const padR = 40; const padT = 14; const padB = 24;
  const plotW = W - padL - padR; const plotH = H - padT - padB;
  const vals = points.flatMap((p) => [p.kg, p.trend]).filter(Number.isFinite);
  if (goal) vals.push(goal);
  let lo = Math.min(...vals); let hi = Math.max(...vals);
  if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
  const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
  const t0 = parseISO(points[0].date).getTime(); const t1 = parseISO(points[points.length - 1].date).getTime();
  const x = (d) => padL + (t1 === t0 ? plotW / 2 : ((parseISO(d).getTime() - t0) / (t1 - t0)) * plotW);
  const y = (v) => padT + plotH - ((v - lo) / (hi - lo)) * plotH;
  const step = (hi - lo) / 3;
  let g = '';
  for (let i = 0; i <= 3; i++) { const v = lo + step * i; g += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${padL - 6}" y="${y(v) + 3.5}" class="tick" text-anchor="end">${fmt(v, 1)}</text>`; }
  const n = points.length;
  const idx = n <= 4 ? points.map((_, i) => i) : [0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1];
  for (const i of [...new Set(idx)]) g += `<text x="${x(points[i].date)}" y="${H - 7}" class="tick" text-anchor="middle">${fmtDM(points[i].date)}</text>`;
  const trend = points.filter((p) => Number.isFinite(p.trend)).map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.trend).toFixed(1)}`).join('');
  let dots = '';
  for (const p of points) dots += `<circle cx="${x(p.date)}" cy="${y(p.kg)}" r="4" class="dot"/>`;
  const last = points[n - 1];
  const endLabel = Number.isFinite(last.trend) ? `<text x="${x(last.date) + 7}" y="${y(last.trend) + 4}" class="val" text-anchor="start">${fmt(last.trend, 1)}</text>` : '';
  const goalLine = goal ? `<line x1="${padL}" x2="${W - padR}" y1="${y(goal)}" y2="${y(goal)}" class="goal"/><text x="${padL + 4}" y="${y(goal) - 5}" class="tick goal-t">Objetivo ${fmt(goal, 1)}</text>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Evolución del peso">${g}${goalLine}<path d="${trend}" class="line"/>${dots}${endLabel}</svg>`;
}

/** Línea simple (progreso de un ejercicio) */
export function simpleLine({ points, key = 'e1rm', height = 150, dec = 1 }) {
  if (!points.length) return '';
  const W = 340; const H = height; const padL = 34; const padR = 36; const padT = 12; const padB = 22;
  const plotW = W - padL - padR; const plotH = H - padT - padB;
  const vals = points.map((p) => p[key]);
  let lo = Math.min(...vals); let hi = Math.max(...vals);
  if (hi - lo < 1) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.15; lo = Math.max(0, lo - pad); hi += pad;
  const x = (i) => padL + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v) => padT + plotH - ((v - lo) / (hi - lo)) * plotH;
  let g = '';
  for (let i = 0; i <= 2; i++) { const v = lo + ((hi - lo) / 2) * i; g += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${padL - 6}" y="${y(v) + 3.5}" class="tick" text-anchor="end">${fmt(v, 0)}</text>`; }
  g += `<text x="${x(0)}" y="${H - 6}" class="tick" text-anchor="middle">${fmtDM(points[0].date)}</text>`;
  if (points.length > 1) g += `<text x="${x(points.length - 1)}" y="${H - 6}" class="tick" text-anchor="middle">${fmtDM(points[points.length - 1].date)}</text>`;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
  const dots = points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p[key])}" r="4" class="dot solid"/>`).join('');
  const last = points[points.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Progreso">${g}<path d="${d}" class="line"/>${dots}<text x="${x(points.length - 1) + 7}" y="${y(last[key]) + 4}" class="val">${fmt(last[key], dec)}</text></svg>`;
}
