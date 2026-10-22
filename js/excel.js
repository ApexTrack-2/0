// ApexTrack — exportar a Excel (formato mejorado), copia de seguridad e importación de la planilla anterior.
import { todayISO, parseISO, isoDate, DIAS, round1, round0, norm, uid, fmtDMY, addDays, dateRange, downloadBlob, parseNum } from './util.js';
import * as store from './store.js';
import { canonUnit, portionText, unitLabel } from './foods.js';

let excelLoading = null;
export function loadExcelJS() {
  if (globalThis.ExcelJS) return Promise.resolve(globalThis.ExcelJS);
  if (excelLoading) return excelLoading;
  const load = (src) => new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = src;
    sc.onload = () => (globalThis.ExcelJS ? resolve(globalThis.ExcelJS) : reject(new Error('sin ExcelJS')));
    sc.onerror = () => { sc.remove(); reject(new Error('No se pudo cargar el generador de Excel.')); };
    document.head.appendChild(sc);
  });
  excelLoading = load('./vendor/exceljs.min.js')
    .catch(() => load('https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js'))
    .catch((e) => { excelLoading = null; throw e; });
  return excelLoading;
}

const C = {
  head: 'FF1F2A24', headText: 'FFFFFFFF', band: 'FFF4F6F2', dayRow: 'FFE3E8DE', mealRow: 'FFF1F3EE',
  good: 'FFD7EBDC', warn: 'FFFBE8C8', bad: 'FFF6D5DC', mute: 'FFEDEDED', accent: 'FF2747D6', ink: 'FF18201B', sub: 'FF5A665E',
  prot: 'FFC2335A', carb: 'FFC98208', fat: 'FF6A4FC9',
};
const xlDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
const thin = { style: 'thin', color: { argb: 'FFD5DBD1' } };

function styleHeader(row) {
  row.height = 30;
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: C.headText }, size: 11 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.head } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = { bottom: thin };
  });
}
function fill(c, argb) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }; }
function colLetter(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

function allDates() {
  const S = store.S();
  const set = new Set();
  for (const e of S.entries) if (e.items?.length) set.add(e.date);
  for (const [d, v] of Object.entries(S.days)) if (v && (v.water || v.gym || v.study || Object.values(v.habits || {}).some(Boolean))) set.add(d);
  for (const b of S.body) set.add(b.date);
  for (const g of S.gym.sessions) set.add(g.date);
  return [...set].filter(Boolean).sort();
}

/** Genera el libro de Excel. range: { from, to } opcional */
export async function buildWorkbook({ from = null, to = null } = {}) {
  const ExcelJS = await loadExcelJS();
  const S = store.S();
  const g = S.settings.goals;
  const habits = S.settings.habits.filter((h) => h.kind !== 'hours');
  const studyH = S.settings.habits.find((h) => h.kind === 'hours');
  let dates = allDates();
  if (from) dates = dates.filter((d) => d >= from);
  if (to) dates = dates.filter((d) => d <= to);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ApexTrack'; wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };

  // ---------- Diario (una fila por día) ----------
  const wsD = wb.addWorksheet('Diario', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }], properties: { tabColor: { argb: C.accent } } });
  const dCols = [
    ['Fecha', 12], ['Día', 11], ['Peso (kg)', 10], ['Calorías (kcal)', 13], ['Proteínas (g)', 12], ['Carbohidratos (g)', 14], ['Grasas (g)', 11],
    ['Azúcares (g)', 11], ['Fibra (g)', 10], ['Agua (L)', 10], ...habits.map((h) => [h.name, Math.max(11, Math.min(18, h.name.length + 2))]),
    ...(studyH ? [[`${studyH.name} (h)`, 11]] : []), ['Gimnasio', 16], ['% meta kcal', 11], ['% meta proteína', 12], ['Comidas', 9], ['Notas', 36],
  ];
  wsD.columns = dCols.map(([header, width]) => ({ header, width }));
  styleHeader(wsD.getRow(1));
  const idx = (name) => dCols.findIndex(([h]) => h === name) + 1;
  const iK = idx('Calorías (kcal)'); const iP = idx('Proteínas (g)'); const iW = idx('Agua (L)'); const iG = idx('Gimnasio');
  const iPK = idx('% meta kcal'); const iPP = idx('% meta proteína');
  dates.forEach((d, i) => {
    const t = store.dayTotals(d); const rec = store.day(d); const b = store.bodyOn(d);
    const r = i + 2;
    const vals = [xlDate(d), DIAS[parseISO(d).getDay()], b?.weight ?? null, t.kcal || null, t.p || null, t.c || null, t.f || null, t.s || null, t.fb || null,
      rec.water ? round1(rec.water / 1000 * 100) / 100 : null,
      ...habits.map((h) => ((rec.habits || {})[h.id] ? 'Sí' : 'No')),
      ...(studyH ? [rec.study || 0] : []),
      rec.gym === 'fui' ? `Fui${rec.gymDetail ? ' (' + rec.gymDetail + ')' : ''}` : rec.gym === 'no_fui' ? 'No fui' : rec.gym === 'descanso' ? 'Descanso' : '—',
      null, null, store.entriesOn(d).length, rec.note || ''];
    const row = wsD.addRow(vals);
    row.getCell(iPK).value = { formula: `IF(${colLetter(iK)}${r}="","",${colLetter(iK)}${r}/${g.kcal})`, result: t.kcal ? t.kcal / g.kcal : '' };
    row.getCell(iPP).value = { formula: `IF(${colLetter(iP)}${r}="","",${colLetter(iP)}${r}/${g.p})`, result: t.p ? t.p / g.p : '' };
    if (i % 2) row.eachCell({ includeEmpty: true }, (c) => fill(c, C.band));
  });
  const nD = dates.length + 1;
  wsD.getColumn(1).numFmt = 'dd/mm/yyyy';
  for (const k of [iK]) wsD.getColumn(k).numFmt = '#,##0';
  for (const k of [iP, iP + 1, iP + 2, iP + 3, iP + 4]) wsD.getColumn(k).numFmt = '0.0';
  wsD.getColumn(iW).numFmt = '0.00';
  wsD.getColumn(iPK).numFmt = '0%'; wsD.getColumn(iPP).numFmt = '0%';
  wsD.getColumn(3).numFmt = '0.0';
  wsD.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: dCols.length } };
  if (dates.length) {
    const L = colLetter;
    wsD.addConditionalFormatting({ ref: `${L(iK)}2:${L(iK)}${nD}`, rules: [
      { type: 'cellIs', operator: 'greaterThanOrEqual', formulae: [String(Math.round(g.kcal * 0.95))], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C.good } } }, priority: 1 },
      { type: 'cellIs', operator: 'between', formulae: [String(Math.round(g.kcal * 0.8)), String(Math.round(g.kcal * 0.95) - 1)], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C.warn } } }, priority: 2 },
      { type: 'cellIs', operator: 'lessThan', formulae: [String(Math.round(g.kcal * 0.8))], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C.bad } } }, priority: 3 },
    ] });
    wsD.addConditionalFormatting({ ref: `${L(iP)}2:${L(iP)}${nD}`, rules: [
      { type: 'cellIs', operator: 'greaterThanOrEqual', formulae: [String(g.p)], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C.good } } }, priority: 4 },
      { type: 'cellIs', operator: 'lessThan', formulae: [String(g.p)], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C.warn } } }, priority: 5 },
    ] });
    wsD.addConditionalFormatting({ ref: `${L(iW)}2:${L(iW)}${nD}`, rules: [{ type: 'colorScale', cfvo: [{ type: 'num', value: 0.5 }, { type: 'num', value: (g.waterMl || 2500) / 2000 }, { type: 'num', value: (g.waterMl || 2500) / 1000 }], color: [{ argb: 'FFF6D5DC' }, { argb: 'FFFFF6D5' }, { argb: 'FFCFE8D6' }], priority: 6 }] });
    const hFrom = iW + 1; const hTo = iW + habits.length;
    if (habits.length) {
      wsD.addConditionalFormatting({ ref: `${L(hFrom)}2:${L(hTo)}${nD}`, rules: [
        { type: 'containsText', operator: 'containsText', text: 'Sí', style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C.good } } }, priority: 7 },
        { type: 'containsText', operator: 'containsText', text: 'No', style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C.bad } } }, priority: 8 },
      ] });
    }
    wsD.addConditionalFormatting({ ref: `${L(iG)}2:${L(iG)}${nD}`, rules: [
      { type: 'containsText', operator: 'containsText', text: 'Fui', style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C.good } } }, priority: 9 },
      { type: 'containsText', operator: 'containsText', text: 'No fui', style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C.bad } } }, priority: 10 },
      { type: 'containsText', operator: 'containsText', text: 'Descanso', style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C.mute } } }, priority: 11 },
    ] });
  }

  // ---------- Comidas desplegables (día → comida → alimentos, con grupos) ----------
  const wsT = wb.addWorksheet('Comidas por día', { views: [{ state: 'frozen', ySplit: 1 }], properties: { outlineLevelRow: 2 } });
  wsT.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  wsT.columns = [['Fecha', 12], ['Comida', 16], ['Alimento', 46], ['Cantidad', 22], ['Calorías (kcal)', 13], ['Proteínas (g)', 12], ['Carbohidratos (g)', 14], ['Grasas (g)', 11], ['Azúcares (g)', 11], ['Fibra (g)', 9], ['Origen del dato', 16]].map(([header, width]) => ({ header, width }));
  styleHeader(wsT.getRow(1));
  const BAS = { referencia: 'Tu registro', etiqueta: 'Etiqueta', web: 'Web', tabla: 'Tabla nutricional', estimacion: 'Estimado (IA)', manual: 'Manual', biblioteca: 'Biblioteca', import: 'Planilla anterior' };
  for (const d of dates) {
    const es = store.entriesOn(d);
    if (!es.length) continue;
    const t = store.dayTotals(d);
    const dr = wsT.addRow([xlDate(d), `${DIAS[parseISO(d).getDay()].toUpperCase()}`, `Total del día${store.bodyOn(d)?.weight ? ` · peso ${store.bodyOn(d).weight} kg` : ''}`, `${es.reduce((a, e) => a + e.items.length, 0)} alimentos`, t.kcal, t.p, t.c, t.f, t.s, t.fb, '']);
    dr.font = { bold: true }; dr.eachCell({ includeEmpty: true }, (c) => fill(c, C.dayRow)); dr.height = 22;
    for (const e of es) {
      const m = store.entryMacros(e);
      const mr = wsT.addRow(['', store.momentName(e.moment), `Subtotal ${store.momentName(e.moment).toLowerCase()}`, `${e.items.length} alimentos`, m.kcal, m.p, m.c, m.f, m.s, m.fb, '']);
      mr.outlineLevel = 1; mr.font = { bold: true, color: { argb: C.ink } }; mr.eachCell({ includeEmpty: true }, (c) => fill(c, C.mealRow));
      for (const it of e.items) {
        const im = store.itemMacros(it);
        const ir = wsT.addRow(['', '', it.name, portionText(it), im.kcal, im.p, im.c, im.f, im.s, im.fb, BAS[it.basis] || it.basis || '']);
        ir.outlineLevel = 2; ir.font = { color: { argb: C.sub } };
      }
    }
  }
  wsT.getColumn(1).numFmt = 'dd/mm/yyyy'; wsT.getColumn(5).numFmt = '#,##0';
  for (const k of [6, 7, 8, 9, 10]) wsT.getColumn(k).numFmt = '0.0';

  // ---------- Detalle de comidas (tabla plana para filtrar) ----------
  const wsF = wb.addWorksheet('Detalle de comidas', { views: [{ state: 'frozen', ySplit: 1 }] });
  const fRows = [];
  for (const d of dates) for (const e of store.entriesOn(d)) for (const it of e.items) {
    const im = store.itemMacros(it);
    fRows.push([xlDate(d), DIAS[parseISO(d).getDay()], store.momentName(e.moment), it.name, round1(it.qty), unitLabel(it.unit, it.qty), it.grams == null ? null : round1(it.grams), im.kcal, im.p, im.c, im.f, im.s, im.fb, BAS[it.basis] || it.basis || '', it.confidence || '', it.note || '']);
  }
  const fHead = ['Fecha', 'Día', 'Comida', 'Alimento', 'Cantidad', 'Unidad', 'Gramos o ml', 'Calorías (kcal)', 'Proteínas (g)', 'Carbohidratos (g)', 'Grasas (g)', 'Azúcares (g)', 'Fibra (g)', 'Origen', 'Confianza', 'Nota'];
  const fW = [12, 11, 15, 44, 9, 11, 11, 12, 12, 13, 10, 11, 9, 15, 11, 40];
  if (fRows.length) {
    wsF.addTable({ name: 'Comidas', ref: 'A1', headerRow: true, style: { theme: 'TableStyleLight9', showRowStripes: true }, columns: fHead.map((name) => ({ name, filterButton: true })), rows: fRows });
  } else wsF.addRow(fHead);
  fW.forEach((w, i) => { wsF.getColumn(i + 1).width = w; });
  wsF.getColumn(1).numFmt = 'dd/mm/yyyy'; wsF.getColumn(8).numFmt = '#,##0';
  for (const k of [7, 9, 10, 11, 12, 13]) wsF.getColumn(k).numFmt = '0.0';

  // ---------- Gimnasio ----------
  const wsG = wb.addWorksheet('Gimnasio', { views: [{ state: 'frozen', ySplit: 1 }] });
  wsG.columns = [['Fecha', 12], ['Rutina', 14], ['Ejercicio', 34], ['Serie', 7], ['Kg', 8], ['Reps', 7], ['RIR', 6], ['Volumen (kg)', 12], ['1RM estimado', 12], ['Notas', 30]].map(([header, width]) => ({ header, width }));
  styleHeader(wsG.getRow(1));
  let gr = 1;
  const sessions = S.gym.sessions.filter((s) => (!from || s.date >= from) && (!to || s.date <= to)).sort((a, b) => a.date.localeCompare(b.date));
  for (const s of sessions) {
    const rname = S.gym.routines.find((r) => r.id === s.routineId)?.name || s.routineName || '';
    for (const ex of s.exercises || []) {
      (ex.sets || []).filter((x) => x.kg || x.reps).forEach((st, i) => {
        gr++;
        const row = wsG.addRow([xlDate(s.date), rname, ex.name, i + 1, Number(st.kg) || 0, Number(st.reps) || 0, st.rir ?? null, null, null, i === 0 ? (ex.note || s.note || '') : '']);
        row.getCell(8).value = { formula: `E${gr}*F${gr}`, result: (Number(st.kg) || 0) * (Number(st.reps) || 0) };
        row.getCell(9).value = { formula: `IF(F${gr}>0,ROUND(E${gr}*(1+MIN(F${gr},15)/30),1),"")`, result: store.e1rm(Number(st.kg) || 0, Number(st.reps) || 0) };
      });
    }
  }
  wsG.getColumn(1).numFmt = 'dd/mm/yyyy';
  wsG.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 10 } };

  // ---------- Progreso corporal ----------
  const wsB = wb.addWorksheet('Progreso corporal', { views: [{ state: 'frozen', ySplit: 1 }] });
  wsB.columns = [['Fecha', 12], ['Peso (kg)', 10], ['Tendencia (kg)', 13], ['Cambio vs. anterior', 14], ['Pecho (cm)', 10], ['Cintura (cm)', 11], ['Brazo (cm)', 10], ['Muslo (cm)', 10], ['Gemelos (cm)', 11], ['% grasa', 9], ['IMC', 8], ['Notas', 30]].map(([header, width]) => ({ header, width }));
  styleHeader(wsB.getRow(1));
  const trend = Object.fromEntries(store.weightTrend().map((p) => [p.date, p.trend]));
  const hM = (S.settings.profile.heightCm || 180) / 100;
  let br = 1; let lastW = null;
  for (const b of S.body.filter((x) => (!from || x.date >= from) && (!to || x.date <= to))) {
    br++;
    const row = wsB.addRow([xlDate(b.date), b.weight ?? null, trend[b.date] ?? null, lastW != null && b.weight != null ? round1(b.weight - lastW) : null, b.chest ?? null, b.waist ?? null, b.arm ?? null, b.thigh ?? null, b.calf ?? null, b.fat ?? null, null, b.note || '']);
    if (b.weight != null) row.getCell(11).value = { formula: `IF(B${br}="","",ROUND(B${br}/${hM}^2,1))`, result: round1(b.weight / (hM * hM)) };
    if (b.weight != null) lastW = b.weight;
  }
  wsB.getColumn(1).numFmt = 'dd/mm/yyyy';
  for (const k of [2, 3, 4, 5, 6, 7, 8, 9]) wsB.getColumn(k).numFmt = '0.0';

  // ---------- Hábitos ----------
  const wsH = wb.addWorksheet('Hábitos', { views: [{ state: 'frozen', ySplit: 1 }] });
  wsH.columns = [['Fecha', 12], ['Día', 11], ...habits.map((h) => [h.name, Math.max(11, Math.min(18, h.name.length + 2))]), ...(studyH ? [[`${studyH.name} (h)`, 11]] : []), ['% cumplimiento', 14]].map(([header, width]) => ({ header, width }));
  styleHeader(wsH.getRow(1));
  dates.forEach((d, i) => {
    const rec = store.day(d);
    const r = i + 2;
    const row = wsH.addRow([xlDate(d), DIAS[parseISO(d).getDay()], ...habits.map((h) => ((rec.habits || {})[h.id] ? '✓' : '✗')), ...(studyH ? [rec.study || 0] : []), null]);
    if (habits.length) {
      const a = colLetter(3); const z = colLetter(2 + habits.length);
      const done = habits.filter((h) => (rec.habits || {})[h.id]).length;
      row.getCell(3 + habits.length + (studyH ? 1 : 0)).value = { formula: `COUNTIF(${a}${r}:${z}${r},"✓")/${habits.length}`, result: done / habits.length };
    }
    for (let k = 3; k < 3 + habits.length; k++) { const c = row.getCell(k); c.alignment = { horizontal: 'center' }; c.font = { color: { argb: c.value === '✓' ? 'FF2E7D45' : 'FFB8304F' }, bold: true }; }
  });
  wsH.getColumn(1).numFmt = 'dd/mm/yyyy';
  wsH.getColumn(3 + habits.length + (studyH ? 1 : 0)).numFmt = '0%';

  // ---------- Mis alimentos ----------
  const wsL = wb.addWorksheet('Mis alimentos');
  wsL.columns = [['Alimento', 40], ['kcal / 100 g', 12], ['Proteínas', 10], ['Carbohidratos', 13], ['Grasas', 9], ['Azúcares', 10], ['Fibra', 8], ['Medidas', 30], ['Origen', 14]].map(([header, width]) => ({ header, width }));
  styleHeader(wsL.getRow(1));
  for (const f of S.customFoods) wsL.addRow([f.n, f.k, f.p, f.c, f.f, f.s, f.fb, Object.entries(f.u || {}).map(([u, gg]) => `1 ${unitLabel(u)} = ${gg} g`).join('; '), f.src || '']);

  // ---------- Resumen (primera hoja) ----------
  const wsR = wb.addWorksheet('Resumen', { properties: { tabColor: { argb: 'FF18201B' } }, views: [{ showGridLines: false }] });
  wb.views = [{ activeTab: wb.worksheets.length - 1 }];
  wsR.columns = [{ width: 3 }, { width: 30 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 18 }];
  wsR.mergeCells('B2:F2');
  const title = wsR.getCell('B2');
  title.value = 'ApexTrack · Seguimiento nutricional, físico y deportivo';
  title.font = { size: 18, bold: true, color: { argb: C.ink } };
  wsR.getCell('B3').value = dates.length ? `Período: ${fmtDMY(dates[0])} al ${fmtDMY(dates[dates.length - 1])} · ${dates.length} días con datos · exportado el ${fmtDMY(todayISO())}` : 'Sin datos todavía';
  wsR.getCell('B3').font = { color: { argb: C.sub } };
  const hdr = wsR.getRow(5);
  hdr.values = ['', 'Indicador', 'Meta', 'Promedio 7 días', 'Promedio 30 días', 'Promedio del período'];
  styleHeader(hdr);
  const avg = (n) => store.averages(n);
  const a7 = avg(7); const a30 = avg(30);
  const L = colLetter;
  const rngD = (col) => `Diario!${L(col)}2:${L(col)}${Math.max(2, nD)}`;
  const rows = [
    ['Calorías (kcal)', g.kcal, a7?.kcal, a30?.kcal, iK, '#,##0'],
    ['Proteínas (g)', g.p, a7?.p, a30?.p, iP, '0.0'],
    ['Carbohidratos (g)', g.c, a7?.c, a30?.c, iP + 1, '0.0'],
    ['Grasas (g)', g.f, a7?.f, a30?.f, iP + 2, '0.0'],
    ['Agua (L)', (g.waterMl || 2500) / 1000, a7 ? a7.water / 1000 : null, a30 ? a30.water / 1000 : null, iW, '0.00'],
  ];
  rows.forEach(([name, goal, v7, v30, col, nf], i) => {
    const r = wsR.getRow(6 + i);
    r.getCell(2).value = name;
    r.getCell(3).value = goal;
    r.getCell(4).value = v7 != null ? round1(v7) : '—';
    r.getCell(5).value = v30 != null ? round1(v30) : '—';
    const all = dates.map((d) => (col === iW ? (store.day(d).water || 0) / 1000 : ({ [iK]: store.dayTotals(d).kcal, [iP]: store.dayTotals(d).p, [iP + 1]: store.dayTotals(d).c, [iP + 2]: store.dayTotals(d).f })[col])).filter((x) => x > 0);
    r.getCell(6).value = { formula: `IFERROR(AVERAGEIF(${rngD(col)},">0"),"—")`, result: all.length ? all.reduce((a, b) => a + b, 0) / all.length : '—' };
    for (const k of [3, 4, 5, 6]) r.getCell(k).numFmt = nf;
    r.eachCell({ includeEmpty: true }, (c) => { c.border = { bottom: thin }; });
    if (i % 2) r.eachCell({ includeEmpty: true }, (c) => fill(c, C.band));
  });
  const hdr2 = wsR.getRow(12);
  hdr2.values = ['', 'Constancia', 'Valor', '', '', ''];
  styleHeader(hdr2);
  const logged = dates.filter((d) => store.entriesOn(d).length);
  const metaK = logged.filter((d) => store.dayTotals(d).kcal >= g.kcal * 0.95).length;
  const metaP = logged.filter((d) => store.dayTotals(d).p >= g.p).length;
  const ws = store.weightSeries();
  const stats = [
    ['Días con comidas registradas', logged.length, '0'],
    ['Días en meta de calorías (≥ 95 %)', metaK, '0'],
    ['Días en meta de proteína', metaP, '0'],
    ['Días de gimnasio', dates.filter((d) => store.day(d).gym === 'fui').length, '0'],
    ['Racha actual de registro (días)', store.streak(), '0'],
    ['Peso inicial (kg)', ws.length ? ws[0].kg : '—', '0.0'],
    ['Peso actual (kg)', ws.length ? ws[ws.length - 1].kg : '—', '0.0'],
    ['Cambio de peso (kg)', ws.length > 1 ? round1(ws[ws.length - 1].kg - ws[0].kg) : '—', '+0.0;-0.0;0.0'],
  ];
  stats.forEach(([name, v, nf], i) => {
    const r = wsR.getRow(13 + i);
    r.getCell(2).value = name; r.getCell(3).value = v; r.getCell(3).numFmt = nf;
    r.getCell(2).border = { bottom: thin }; r.getCell(3).border = { bottom: thin };
  });
  wsR.getCell('B23').value = 'Las hojas "Diario", "Comidas por día" (con grupos para desplegar), "Detalle de comidas" (tabla para filtrar), "Gimnasio", "Progreso corporal" y "Hábitos" tienen todo el detalle.';
  wsR.getCell('B23').font = { italic: true, color: { argb: C.sub } };
  wsR.mergeCells('B23:F24');
  wsR.getCell('B23').alignment = { wrapText: true, vertical: 'top' };
  // Resumen primero
  wb.worksheets.sort ? null : null;
  const order = ['Resumen', 'Diario', 'Comidas por día', 'Detalle de comidas', 'Gimnasio', 'Progreso corporal', 'Hábitos', 'Mis alimentos'];
  wb._worksheets = [undefined, ...order.map((n) => wb.getWorksheet(n))].filter((x, i) => i === 0 || x);
  wb._worksheets.forEach((w, i) => { if (w) { w.id = i; w.orderNo = i; } });
  wb.views = [{ activeTab: 0, firstSheet: 0 }];
  return wb;
}

export async function exportExcel(opts = {}) {
  const wb = await buildWorkbook(opts);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const name = `ApexTrack_${todayISO()}.xlsx`;
  return shareOrDownload(blob, name);
}

export async function shareOrDownload(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /android|iphone|ipad/i.test(navigator.userAgent)) {
      await navigator.share({ files: [file], title: name });
      return 'compartido';
    }
  } catch (e) { if (e && e.name === 'AbortError') return 'cancelado'; }
  downloadBlob(blob, name);
  return 'descargado';
}

// ---------- Copia de seguridad (JSON) ----------
export function backupBlob({ includeKey = false } = {}) {
  const S = JSON.parse(JSON.stringify(store.S()));
  if (!includeKey) S.settings.ai.key = '';
  S.settings.ai.models = null;
  return new Blob([JSON.stringify({ app: 'ApexTrack', version: store.APP_VERSION, exportedAt: new Date().toISOString(), data: S })], { type: 'application/json' });
}
export async function exportBackup() {
  const r = await shareOrDownload(backupBlob(), `ApexTrack_copia_${todayISO()}.json`);
  store.S().settings.backup.lastAt = Date.now();
  store.commit('backup');
  return r;
}
export async function readBackup(file) {
  const txt = await file.text();
  const j = JSON.parse(txt);
  const data = j && j.app === 'ApexTrack' ? j.data : j;
  if (!data || !Array.isArray(data.entries)) throw new Error('El archivo no es una copia de ApexTrack.');
  return data;
}

// ---------- Importar la planilla anterior (Google Sheets / Excel) ----------
function cellDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isoDate(new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate(), 12));
  if (typeof v === 'object' && v.result instanceof Date) return cellDate(v.result);
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
function cellVal(c) {
  const v = c?.value;
  if (v == null) return null;
  if (typeof v === 'object') {
    if (v.result !== undefined) return v.result;
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text) return v.text;
    if (v instanceof Date) return v;
  }
  return v;
}
const numOr0 = (v) => { const n = typeof v === 'number' ? v : parseNum(v); return Number.isFinite(n) ? n : 0; };

/** Interpreta "180 g", "1 unidad (~50g)", "2 cdas (~20 g)", "~180 ml", "2 porciones (1/3 del total)" */
export function parsePortion(text) {
  const s = String(text || '').toLowerCase();
  const all = [...s.matchAll(/(\d+(?:[.,]\d+)?)\s*(g|gr|ml|cc)\b/g)];
  let grams = null; let liq = false;
  const inParen = s.match(/\(~?\s*(\d+(?:[.,]\d+)?)\s*(g|gr|ml)\b/);
  if (inParen) { grams = numOr0(inParen[1]); liq = inParen[2] === 'ml'; }
  else if (all.length) { grams = numOr0(all[0][1]); liq = all[0][2] === 'ml' || all[0][2] === 'cc'; }
  let qty = null; let unit = '';
  const lead = s.replace(/^~/, '').match(/^(\d+(?:[.,]\d+)?|\d+\/\d+|media|medio|un|una)\s*([a-záéíóúñ]+)?/);
  if (lead) {
    const q = lead[1].includes('/') ? Number(lead[1].split('/')[0]) / Number(lead[1].split('/')[1]) : lead[1] === 'media' || lead[1] === 'medio' ? 0.5 : (lead[1] === 'un' || lead[1] === 'una') ? 1 : numOr0(lead[1]);
    const u = canonUnit(lead[2] || '');
    if (u && u !== 'g' && u !== 'ml') { qty = q; unit = u; }
    else if (u === 'g' || u === 'ml') { qty = q; unit = u; }
  }
  if (!unit && grams != null) { qty = grams; unit = liq ? 'ml' : 'g'; }
  if (!unit) { qty = 1; unit = 'porcion'; }
  return { grams, qty: qty || 1, unit, liq };
}

/**
 * Lee la planilla anterior y devuelve lo que se puede importar (sin guardar todavía).
 */
export async function parseOldWorkbook(file) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const raw = await file.arrayBuffer();
  try { await wb.xlsx.load(await sanitizeXlsx(raw)); } catch (e) { console.warn('xlsx saneado falló, pruebo el original', e); await wb.xlsx.load(raw); }
  const find = (...names) => wb.worksheets.find((w) => names.some((n) => norm(w.name) === norm(n))) || wb.worksheets.find((w) => names.some((n) => norm(w.name).startsWith(norm(n))));
  const out = { entries: [], days: {}, body: [], sessions: [], counts: { items: 0, days: 0 } };
  // 1) Detalle de comidas
  const wsC = find('Detalle de Comidas', 'Detalle de comidas');
  if (wsC) {
    const byKey = new Map();
    wsC.eachRow((row, i) => {
      if (i === 1) return;
      const date = cellDate(cellVal(row.getCell(1)));
      const mom = String(cellVal(row.getCell(2)) || '').trim();
      const food = String(cellVal(row.getCell(3)) || '').trim();
      if (!date || !mom || !food || /^total\b/i.test(mom) || /^subtotal/i.test(food) || /^📅/.test(mom)) return;
      const kcal = numOr0(cellVal(row.getCell(5)));
      const p = numOr0(cellVal(row.getCell(6))); const c = numOr0(cellVal(row.getCell(7))); const f = numOr0(cellVal(row.getCell(8)));
      const sug = numOr0(cellVal(row.getCell(9)));
      if (!kcal && !p && !c && !f) return;
      const portion = String(cellVal(row.getCell(4)) || '');
      const pp = parsePortion(portion);
      const moment = store.matchMoment(mom) || 'almuerzo';
      const key = date + '|' + moment;
      if (!byKey.has(key)) byKey.set(key, { id: uid('e'), date, moment, items: [], createdAt: Date.now(), updatedAt: Date.now(), source: 'import' });
      const it = { id: uid('i'), name: food, foodId: null, qty: round1(pp.qty), unit: pp.unit, grams: pp.grams, liq: pp.liq || /ml/.test(portion), basis: 'import', confidence: 'alta', note: portion && !/^\d+(\.\d+)?\s*(g|ml)$/i.test(portion.trim()) ? `Cantidad original: ${portion}` : '' };
      if (pp.grams > 0) it.per100 = { kcal: round1(kcal / pp.grams * 100), p: round1(p / pp.grams * 100), c: round1(c / pp.grams * 100), f: round1(f / pp.grams * 100), s: round1(sug / pp.grams * 100), fb: 0 };
      else it.fixed = { kcal, p, c, f, s: sug, fb: 0 };
      byKey.get(key).items.push(it);
      out.counts.items++;
    });
    out.entries = [...byKey.values()];
  }
  // 2) Resumen Diario: peso, suplementos, agua, gym, notas
  const wsR = find('Resumen Diario');
  if (wsR) {
    const head = {};
    wsR.getRow(1).eachCell((c, i) => { head[norm(String(cellVal(c) || ''))] = i; });
    const col = (re) => { for (const [k, i] of Object.entries(head)) if (re.test(k)) return i; return null; };
    const cPeso = col(/^peso/); const cCre = col(/creatina/); const cMag = col(/magnesio/); const cVit = col(/vitamina/); const cAgua = col(/^agua/); const cGym = col(/entrenamiento|gimnasio/); const cNota = col(/^notas?/);
    wsR.eachRow((row, i) => {
      if (i === 1) return;
      const date = cellDate(cellVal(row.getCell(1)));
      if (!date) return;
      const d = out.days[date] || (out.days[date] = { habits: {} });
      const yes = (v) => /^s[ií]/i.test(String(v || '').trim());
      if (cCre && cellVal(row.getCell(cCre)) != null) d.habits.creatina = yes(cellVal(row.getCell(cCre)));
      if (cMag && cellVal(row.getCell(cMag)) != null) d.habits.magnesio = yes(cellVal(row.getCell(cMag)));
      if (cVit && cellVal(row.getCell(cVit)) != null) d.habits.vitaminas = yes(cellVal(row.getCell(cVit)));
      if (cAgua) { const w = cellVal(row.getCell(cAgua)); if (typeof w === 'number' && w > 0 && w < 10) d.water = Math.round(w * 1000); }
      if (cGym) {
        const gt = norm(String(cellVal(row.getCell(cGym)) || ''));
        if (/no fui|falte|falto/.test(gt)) d.gym = 'no_fui';
        else if (/descanso/.test(gt)) d.gym = 'descanso';
        else if (/gimnasio|torso|pierna|entrene|fui/.test(gt)) { d.gym = 'fui'; const m = gt.match(/\(([^)]+)\)/); if (m) d.gymDetail = m[1]; }
      }
      if (cNota) { const n = String(cellVal(row.getCell(cNota)) || '').trim(); if (n && !/registrado desde apextrack/i.test(n)) d.note = n; }
      if (cPeso) { const kg = cellVal(row.getCell(cPeso)); if (typeof kg === 'number' && kg > 25 && kg < 300) out.body.push({ id: uid('b'), date, weight: kg }); }
    });
  }
  // 3) Hábitos
  const wsH = find('Hábitos', 'Habitos');
  if (wsH) {
    let hr = null; const map = {};
    wsH.eachRow((row, i) => {
      const vals = []; row.eachCell({ includeEmpty: true }, (c, k) => { vals[k] = cellVal(c); });
      if (!hr && vals.some((v) => norm(String(v || '')) === 'fecha')) {
        hr = i;
        vals.forEach((v, k) => { const n = norm(String(v || '')); if (/limpieza/.test(n)) map.limpieza = k; else if (/cuello/.test(n)) map.cuello = k; else if (/espalda|postura/.test(n)) map.postura = k; else if (/estudio/.test(n)) map.estudio = k; else if (n === 'fecha') map.fecha = k; });
        return;
      }
      if (!hr || !map.fecha) return;
      const date = cellDate(vals[map.fecha]);
      if (!date) return;
      const d = out.days[date] || (out.days[date] = { habits: {} });
      for (const h of ['limpieza', 'cuello', 'postura']) if (map[h] && typeof vals[map[h]] === 'boolean') d.habits[h] = vals[map[h]];
      if (map.estudio && typeof vals[map.estudio] === 'number') d.study = vals[map.estudio];
    });
  }
  // 4) Gimnasio
  const wsG = find('Gimnasio y Sobrecarga Progresiva', 'Gimnasio');
  if (wsG) {
    const ses = new Map();
    wsG.eachRow((row, i) => {
      if (i === 1) return;
      const date = cellDate(cellVal(row.getCell(1)));
      const ex = String(cellVal(row.getCell(3)) || '').trim();
      if (!date || !ex) return;
      const rut = String(cellVal(row.getCell(2)) || '').trim();
      const key = date + '|' + rut;
      if (!ses.has(key)) ses.set(key, { id: uid('s'), date, routineId: null, routineName: rut, exercises: [], done: true, startedAt: 0 });
      const sets = [];
      for (let k = 4; k <= 7; k++) {
        const v = cellVal(row.getCell(k));
        if (v == null || v === '-' || v === '') continue;
        const m = String(v).match(/(\d+(?:[.,]\d+)?)\s*kg\s*x\s*(\d+)/i);
        if (m) sets.push({ kg: numOr0(m[1]), reps: Number(m[2]) });
        else { const r = String(v).match(/(\d+)/); if (r) sets.push({ kg: 0, reps: Number(r[1]) }); }
      }
      const note = String(cellVal(row.getCell(10)) || '').trim();
      ses.get(key).exercises.push({ name: ex, sets, note: note === '-' ? '' : note });
    });
    out.sessions = [...ses.values()];
  }
  // 5) Progreso corporal
  const wsB = find('Progreso Corporal y Métricas', 'Progreso corporal');
  if (wsB) {
    wsB.eachRow((row, i) => {
      if (i === 1) return;
      const date = cellDate(cellVal(row.getCell(1)));
      if (!date) return;
      const n = (k) => { const v = cellVal(row.getCell(k)); return typeof v === 'number' ? v : null; };
      const b = { id: uid('b'), date, weight: n(2), chest: n(5), waist: n(6), arm: n(7), thigh: n(8), calf: n(9) };
      const fat = n(4); if (fat != null) b.fat = fat < 1 ? round1(fat * 100) : fat;
      const note = String(cellVal(row.getCell(11)) || '').trim(); if (note) b.note = note;
      for (const k of Object.keys(b)) if (b[k] == null) delete b[k];
      const ex = out.body.find((x) => x.date === date);
      if (ex) Object.assign(ex, b, { id: ex.id }); else out.body.push(b);
    });
  }
  out.counts.days = new Set([...out.entries.map((e) => e.date), ...Object.keys(out.days)]).size;
  return out;
}

/** Aplica lo importado: reemplaza las comidas de esos días y combina el resto. */
export function applyImport(imp) {
  store.safetySnapshot('antes de importar');
  const S = store.S();
  const dates = new Set(imp.entries.map((e) => e.date));
  S.entries = S.entries.filter((e) => !dates.has(e.date)).concat(imp.entries);
  for (const [d, v] of Object.entries(imp.days)) {
    const cur = store.ensureDay(d);
    cur.habits = { ...(cur.habits || {}), ...(v.habits || {}) };
    if (v.water != null) cur.water = v.water;
    if (v.gym) cur.gym = v.gym;
    if (v.gymDetail) cur.gymDetail = v.gymDetail;
    if (v.study != null) cur.study = v.study;
    if (v.note) cur.note = v.note;
  }
  for (const b of imp.body) store.upsertBody(b.date, b);
  const keys = new Set(S.gym.sessions.map((s) => s.date + '|' + (s.routineName || s.routineId)));
  for (const s of imp.sessions) {
    const r = S.gym.routines.find((x) => norm(x.name) === norm(s.routineName));
    if (r) s.routineId = r.id;
    if (!keys.has(s.date + '|' + (s.routineName || s.routineId))) S.gym.sessions.push(s);
  }
  store.commit('import');
}

// ---------------------------------------------------------------------------
// Las planillas descargadas de Google Sheets usan rutas absolutas y gráficos que
// ExcelJS no sabe leer. Se reescribe el .xlsx (zip) sin gráficos y con rutas relativas.
// ---------------------------------------------------------------------------
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function inflateRaw(u8) {
  const ds = new DecompressionStream('deflate-raw');
  const buf = await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}
export async function unzip(buf) {
  const u8 = new Uint8Array(buf); const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('El archivo no es un Excel válido.');
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const files = [];
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true); const csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true); const el = dv.getUint16(p + 30, true); const cl = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    const lnl = dv.getUint16(off + 26, true); const lel = dv.getUint16(off + 28, true);
    const data = u8.subarray(off + 30 + lnl + lel, off + 30 + lnl + lel + csize);
    files.push({ name, data: method === 8 ? await inflateRaw(data) : method === 0 ? data.slice() : null });
    p += 46 + nl + el + cl;
  }
  return files.filter((f) => f.data && !f.name.endsWith('/'));
}
export function zip(files) {
  const enc = new TextEncoder();
  const chunks = []; const central = []; let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name); const data = f.data; const crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, x) => a + x.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
  return new Blob([...chunks, ...central, new Uint8Array(e.buffer)]).arrayBuffer();
}
export async function sanitizeXlsx(buf) {
  if (typeof DecompressionStream === 'undefined') return buf;
  const files = await unzip(buf);
  const dec = new TextDecoder(); const enc = new TextEncoder();
  const out = [];
  for (const f of files) {
    if (/^xl\/(drawings|charts)\//.test(f.name)) continue;
    let data = f.data;
    const isXml = /\.(xml|rels)$/.test(f.name);
    if (isXml) {
      let x = dec.decode(data);
      if (f.name.endsWith('.rels')) {
        const dir = f.name.replace(/_rels\/[^/]+$/, '');
        x = x.replace(/<Relationship [^>]*Type="[^"]*\/(drawing|vmlDrawing|chart)"[^>]*\/>/g, '');
        x = x.replace(/Target="\/([^"]+)"/g, (m, t) => {
          const from = dir.split('/').filter(Boolean); const to = t.split('/');
          let i = 0; while (i < from.length && from[i] === to[i]) i++;
          return `Target="${[...from.slice(i).map(() => '..'), ...to.slice(i)].join('/')}"`;
        });
      } else if (/^xl\/worksheets\/sheet\d+\.xml$/.test(f.name)) {
        x = x.replace(/<drawing [^>]*\/>/g, '').replace(/<legacyDrawing [^>]*\/>/g, '');
      } else if (f.name === '[Content_Types].xml') {
        x = x.replace(/<Override [^>]*PartName="\/xl\/(drawings|charts)\/[^>]*\/>/g, '');
      }
      data = enc.encode(x);
    }
    out.push({ name: f.name, data });
  }
  return zip(out);
}
