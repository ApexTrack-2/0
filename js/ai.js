// ApexTrack — motor de registro con IA (Gemini) + respaldo sin conexión.
// La IA interpreta el mensaje (alimentos, cantidades, fechas, comidas, agua, suplementos, gym)
// y da la composición por 100 g; la app hace TODAS las cuentas y valida el resultado.

import { todayISO, isoDate, addDays, parseISO, isISODate, norm, round1, round0, uid, nowHHMM, sleep, DIAS_CORTOS, DIAS, fmtDM, daysBetween } from './util.js';
import {
  sanitizePer100, canonUnit, bestMatch, getFood, gramsFor, per100Of, calc, parseLocal, unitLabel, hasOwnUnit,
  foodUnits, GENERIC_UNIT_G, numberWord, tokens, scoreTokens, isJunkText, isJunkWord, isUnitWord,
} from './foods.js';
import * as store from './store.js';

const API = 'https://generativelanguage.googleapis.com';
// Medido el 19/10/2026 con una clave gratuita: 3.5 Flash responde en 3-8 s con la misma calidad que 3.8 Flash (15-50 s).
export const FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-flash-latest'];
const UNIT_ENUM = ['g', 'ml', 'unidad', 'porcion', 'cda', 'cdita', 'taza', 'vaso', 'feta', 'rebanada', 'rodaja', 'punado', 'plato', 'paquete', 'lata', 'pote', 'scoop', 'bocha', 'copa', 'botella', 'diente', 'hoja', 'trincha', 'chorrito', 'sobre'];
const THINKING = { rapida: 'low', equilibrada: 'low', maxima: 'medium' };
// Si el primer modelo no contestó en este tiempo, se consulta también otro (medido: 3.5 Flash suele tardar 3-8 s)
const HEDGE_MS = { rapida: 7000, equilibrada: 11000, maxima: 25000 };

// ---------------------------------------------------------------------------
// Instrucciones calibradas
// ---------------------------------------------------------------------------
export const SYSTEM_PROMPT = `Sos el motor de registro nutricional de ApexTrack, la app personal de un usuario de Argentina para seguir comidas, agua, suplementos y gimnasio. Recibís mensajes escritos o dictados por voz (con muletillas como "eh", "este", repeticiones y autocorrecciones) y devolvés SOLO un JSON con el esquema indicado. La app hace todas las sumas: vos identificás cada alimento, cuánto pesó lo que se comió y su composición por 100 g.

1) LEÉ EL MENSAJE COMPLETO
- Puede abarcar varios días y varias comidas. A cada alimento asignale su fecha (YYYY-MM-DD, usando el calendario del contexto) y su momento (nombre exacto de la lista de momentos).
- La fecha y el momento mencionados siguen valiendo para lo que viene después, hasta que el mensaje los cambie ("ayer en la cena…, después para hoy…").
- Si no se dice la fecha, usá la fecha por defecto. Si no se dice el momento, deducilo por el contexto o usá el momento por defecto.
- El momento por defecto NO manda sobre el mensaje: "merendé X, después comí Y, cené Z y después de cenar comí W" = X en Merienda, Y en el momento que sigue (Media tarde o Merienda si sigue siendo la tarde; si es entre la merienda y la cena y no hay otro, usá Merienda), Z en Cena, W en Post-cena. Respetá el orden del mensaje: lo que se comió "después" de una comida nunca va en un momento anterior del día (después de merendar → Merienda o un momento posterior, jamás Media tarde ni Almuerzo). "Al mediodía" = Almuerzo, "a la noche" = Cena, "antes de dormir" o "después de cenar" = Post-cena, "antes de entrenar" = Pre-entreno, "después de entrenar" = Post-entreno.
- Autocorrecciones: vale siempre la última versión ("80, no, 70 g" → 70 g; "poné que fue, no, en realidad no fue" → no fue).
- Ignorá muletillas e instrucciones de forma ("poné", "agregá", "anotá").
- "No pongas nada de desayuno" o "no desayuné" → va en skipped, sin alimentos.
- No inventes alimentos que no se mencionaron ni los dupliques.
- NO te saltees ninguno: cada alimento nombrado es un item aparte aunque venga en una lista o con "con" ("yogur con pasta de maní, avena, copos de maní y pasas" = 5 items: yogur, pasta de maní, avena, maní, pasas). Antes de responder, repasá el mensaje y verificá que cada alimento mencionado esté en items.

2) AGUA, SUPLEMENTOS, GIMNASIO Y PESO (no son alimentos)
- Agua: "N vasos de agua" → water con ml = N × ml por vaso del contexto; "medio litro" = 500 ml. mode "sumar", salvo que el usuario dé el total del día ("en total tomé 2 litros") → "fijar". El agua NUNCA va en items.
- Suplementos y hábitos de la lista ("tomé la creatina", "me olvidé el magnesio") → habits, con el nombre de la lista y done true/false. Creatina, magnesio y vitaminas NO van en items. La proteína en polvo SÍ es un alimento.
- Gimnasio: "fui al gym", "entrené pierna" → status "fui" (detail con la rutina o el músculo si se dice); "no fui" → "no_fui"; "día de descanso" → "descanso".
- Peso corporal ("me pesé 61,2") → weight.
- Horas de estudio ("estudié 2 horas", "estudié media hora") → study con hours (número). No son alimentos.
- Sueño ("dormí 6 horas", "me acosté a la 1 y me levanté a las 8, dormí mal") → sleep con date (el día en que se despertó), hours, bed y wake en HH:MM si los dice, y quality de 1 a 5 si opina cómo durmió (muy mal 1, mal 2, normal 3, bien 4, excelente 5).
- Actividad física fuera de la rutina de gimnasio ("caminé 40 minutos", "hice 8000 pasos", "corrí 5 km", "jugué al fútbol una hora") → activity con type (caminata, caminata_rapida, correr, bici, natacion, futbol, tenis, baile, eliptico, yoga, pesas, otro) y lo que se dijo: minutes, km o steps.
- Café, té y mate van en items aunque casi no tengan calorías; sumá azúcar o leche solo si se mencionan.
- Mate, tereré, té, café, gaseosas, jugos y aguas saborizadas: en items con su volumen en ml (unit "ml" o vaso/taza/termo, grams = ml). La app los suma sola al agua del día: NO los repitas en water. Mate cebado: un termo ≈ 1000 ml, "unos mates" ≈ 500 ml.

3) CADA ALIMENTO
- said: las palabras del mensaje que nombran este alimento y su cantidad, copiadas tal cual y sin muletillas ("dos milanesas de pollo al horno").
- name: nombre claro en español, con marca, tipo y cocción cuando se sepan ("Empanadas caseras de carne con masa de hojaldre, al horno").
- quantity + unit: como lo dijo el usuario (unidad, porcion, cda, cdita, taza, vaso, feta, rebanada, plato, paquete, lata, pote, scoop, g, ml…). Si dio gramos o ml, usá unit "g" o "ml" y quantity igual a ese número.
- grams: peso total consumido en gramos (ml en bebidas). Si el usuario dio el peso, usá exactamente ese número. Si no, estimalo con medidas argentinas reales: cda sopera ≈ 15 g (manteca de maní ≈ 20 g, aceite ≈ 13,5 g, mayonesa ≈ 15 g), cdita ≈ 5 g, vaso ≈ 200-250 ml, taza ≈ 250 ml, huevo ≈ 50 g, bollo de pan francés ≈ 50-70 g, feta de queso ≈ 20-30 g, plato de carne ≈ 200 g. Usá primero las medidas aprendidas del usuario si existen.
- state: "crudo" o "cocido" cuando importa (arroz, fideos, legumbres, carnes, papas); "listo" para el resto. Si el usuario no lo aclara, seguí la costumbre indicada en el contexto; la carne de un plato terminado está cocida. Si es dudoso, decilo en assumption.
- per100: kcal, protein, carbs (disponibles, sin fibra), fat, sugars y fiber por 100 g (o 100 ml) del alimento en el MISMO estado que grams. Tienen que ser coherentes: kcal ≈ 4·protein + 4·carbs + 9·fat + 2·fiber + 7·alcohol (en bebidas alcohólicas completá alcohol, en g por 100 ml).
- Usá valores reales, no promedios genéricos. Prioridad:
  a) Referencia del usuario: poné "ref" con el código SOLO si es exactamente el mismo alimento, con la misma receta, marca y cocción (por ejemplo "un poco del bizcochuelo de ayer" = la referencia reciente de ese bizcochuelo). Si cambia la receta, la marca o la cocción ("bizcochuelo de chocolate" no es "bizcochuelo proteico de banana"), NO uses ref y estimá de nuevo. Aun con ref, completá per100.
  b) Productos de marca, envasados o de cadenas (galletitas, alfajores, yogures, barritas, gaseosas, comida rápida): usá la tabla nutricional oficial argentina que conozcas (o la de Google si tenés la herramienta de búsqueda → basis "web" y en source el sitio). Completá además "producto" con marca y nombre comercial para buscar la etiqueta ("Traviata Bagley", "Alfajor Jorgito chocolate", "Yogur Ser bebible frutilla"); null en comidas caseras o genéricas.
  c) Alimentos genéricos: tablas de composición (USDA, ARGENFOODS) → basis "tabla".
  d) Si nada alcanza → basis "estimacion".
  Si llega la foto de una etiqueta, usá esa etiqueta → basis "etiqueta".
- Platos caseros, mezclas y recetas (ensalada rusa, guisos, tortas, salsas, licuados, sándwiches): si el usuario da los ingredientes o el plato tiene componentes claros, completá ingredients con cada componente en gramos y sus valores por 100 g, de modo que sumen el peso del plato. Si describe una receta entera y dice qué parte comió ("lo corté en 6 y comí 1"), poné en ingredients la receta completa y en fraction la parte comida (1 de 6 = 0.1667). Igual completá per100 del plato.
- Calorías ocultas: si dice "frito", sumá el aceite absorbido como ingrediente; "sin aceite" → sin aceite. Agregá azúcar, aceite o aderezos solo si se mencionan o son parte inseparable de la receta.
- confidence: "alta" si el alimento y la cantidad son claros; "media" si estimaste la porción o la receta; "baja" si tuviste que adivinar algo que cambia mucho las calorías.
- assumption: frase corta en español con lo que supusiste ("Asumí relleno de carne", "Medio paquete de 101 g = 50 g", "Arroz medido en crudo"); null si no supusiste nada.

4) PREGUNTAS
- questions: solo dudas importantes (cambian más de ~150 kcal) que no pudiste resolver; máximo 3, cortas. Igual registrá tu mejor estimación.

5) AUDIO E IMÁGENES
- Si llega audio, escribí lo que dijo en transcript y analizalo igual que un texto.
- Si llega la foto de un plato, estimá las porciones por lo que se ve; si es una tabla nutricional, copiá sus valores por 100 g.
- Si la imagen es una captura de un reloj inteligente o de una app de salud (Samsung Health, Mi Fitness, Zepp, Google Fit, Huawei Health): NO es comida. Registrá en activity lo que muestre: pasos (steps), distancia (km), minutos de actividad (minutes) y calorías ACTIVAS o de ejercicio (kcal; si solo figuran las calorías totales del día, no las uses), con from_device true y la fecha que se ve (si no se ve, la fecha por defecto). Si muestra un entrenamiento puntual (correr, bici, caminata), usá ese type con sus datos.

EJEMPLO
Contexto: hoy = 2026-03-12 (jue), ayer = 2026-03-11, 1 vaso = 250 ml.
Mensaje: "Ayer en la cena eh dos milanesas de pollo al horno con puré y dos vasos de agua, y no fui al gym. Hoy desayuno café con leche con dos de azúcar y tres tostadas con queso crema, 80 no, 60 g de queso. Tomé la creatina."
Respuesta:
{"transcript":"","items":[
{"date":"2026-03-11","moment":"Cena","said":"dos milanesas de pollo al horno","name":"Milanesa de pollo al horno","ref":null,"quantity":2,"unit":"unidad","grams":300,"per100":{"kcal":195,"protein":22,"carbs":12,"fat":6.5,"sugars":0.5,"fiber":0.5},"state":"cocido","basis":"tabla","confidence":"media","assumption":"Milanesas medianas de 150 g","source":null,"producto":null,"fraction":null,"ingredients":[]},
{"date":"2026-03-11","moment":"Cena","said":"puré","name":"Puré de papas casero (con leche y manteca)","ref":null,"quantity":1,"unit":"porcion","grams":200,"per100":{"kcal":110,"protein":2,"carbs":15.5,"fat":4.3,"sugars":1.5,"fiber":1.5},"state":"cocido","basis":"estimacion","confidence":"baja","assumption":"Porción de 200 g con leche y manteca","source":null,"producto":null,"fraction":null,"ingredients":[]},
{"date":"2026-03-12","moment":"Desayuno","said":"café con leche","name":"Café con leche entera","ref":null,"quantity":1,"unit":"taza","grams":250,"per100":{"kcal":24,"protein":1.3,"carbs":1.9,"fat":1.2,"sugars":1.9,"fiber":0},"state":"listo","basis":"tabla","confidence":"media","assumption":"Taza de 250 ml con 100 ml de leche","source":null,"producto":null,"fraction":null,"ingredients":[]},
{"date":"2026-03-12","moment":"Desayuno","said":"dos de azúcar","name":"Azúcar","ref":null,"quantity":2,"unit":"cdita","grams":10,"per100":{"kcal":400,"protein":0,"carbs":100,"fat":0,"sugars":100,"fiber":0},"state":"listo","basis":"tabla","confidence":"alta","assumption":null,"source":null,"producto":null,"fraction":null,"ingredients":[]},
{"date":"2026-03-12","moment":"Desayuno","said":"tres tostadas","name":"Tostadas de pan Riera","ref":null,"quantity":3,"unit":"unidad","grams":27,"per100":{"kcal":400,"protein":11,"carbs":72,"fat":6.5,"sugars":5,"fiber":3.5},"state":"listo","basis":"tabla","confidence":"media","assumption":"Tostadas tipo Riera de 9 g","source":null,"producto":"Tostadas Riera clásicas","fraction":null,"ingredients":[]},
{"date":"2026-03-12","moment":"Desayuno","said":"60 g de queso crema","name":"Queso crema","ref":null,"quantity":60,"unit":"g","grams":60,"per100":{"kcal":240,"protein":6,"carbs":4,"fat":22,"sugars":3,"fiber":0},"state":"listo","basis":"tabla","confidence":"alta","assumption":null,"source":null,"producto":null,"fraction":null,"ingredients":[]}],
"water":[{"date":"2026-03-11","ml":500,"mode":"sumar"}],
"habits":[{"date":"2026-03-12","habit":"Creatina","done":true}],
"gym":[{"date":"2026-03-11","status":"no_fui","detail":null}],
"weight":[],"activity":[],"skipped":[],"questions":[]}`;

const NUTR_SCHEMA = {
  type: 'object',
  properties: {
    kcal: { type: 'number' }, protein: { type: 'number' }, carbs: { type: 'number' },
    fat: { type: 'number' }, sugars: { type: 'number' }, fiber: { type: 'number' }, alcohol: { type: 'number' },
  },
  required: ['kcal', 'protein', 'carbs', 'fat'],
};
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    transcript: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          moment: { type: 'string' },
          said: { type: 'string', description: 'Palabras del mensaje que nombran este alimento' },
          name: { type: 'string' },
          ref: { type: ['string', 'null'] },
          quantity: { type: 'number' },
          unit: { type: 'string', enum: UNIT_ENUM },
          grams: { type: 'number', description: 'Peso total consumido en g (ml en bebidas)' },
          per100: NUTR_SCHEMA,
          state: { type: 'string', enum: ['crudo', 'cocido', 'listo'] },
          basis: { type: 'string', enum: ['referencia', 'etiqueta', 'web', 'tabla', 'estimacion'] },
          confidence: { type: 'string', enum: ['alta', 'media', 'baja'] },
          assumption: { type: ['string', 'null'] },
          source: { type: ['string', 'null'] },
          producto: { type: ['string', 'null'], description: 'Marca y producto envasado para buscar su etiqueta; null si es casero o genérico' },
          fraction: { type: ['number', 'null'] },
          ingredients: {
            type: 'array',
            items: {
              type: 'object',
              properties: { name: { type: 'string' }, grams: { type: 'number' }, per100: NUTR_SCHEMA },
              required: ['name', 'grams', 'per100'],
            },
          },
        },
        required: ['date', 'moment', 'name', 'quantity', 'unit', 'grams', 'per100', 'basis', 'confidence'],
      },
    },
    water: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, ml: { type: 'number' }, mode: { type: 'string', enum: ['sumar', 'fijar'] } }, required: ['date', 'ml', 'mode'] } },
    habits: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, habit: { type: 'string' }, done: { type: 'boolean' } }, required: ['date', 'habit', 'done'] } },
    gym: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, status: { type: 'string', enum: ['fui', 'no_fui', 'descanso'] }, detail: { type: ['string', 'null'] } }, required: ['date', 'status'] } },
    weight: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, kg: { type: 'number' } }, required: ['date', 'kg'] } },
    activity: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, type: { type: 'string', enum: ['caminata', 'caminata_rapida', 'correr', 'bici', 'natacion', 'futbol', 'tenis', 'baile', 'eliptico', 'yoga', 'pesas', 'otro'] }, minutes: { type: ['number', 'null'] }, km: { type: ['number', 'null'] }, steps: { type: ['number', 'null'] }, kcal: { type: ['number', 'null'], description: 'Calorías activas medidas por el reloj' }, from_device: { type: 'boolean' }, detail: { type: ['string', 'null'] } }, required: ['date', 'type'] } },
    study: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, hours: { type: 'number' } }, required: ['date', 'hours'] } },
    sleep: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, hours: { type: ['number', 'null'] }, bed: { type: ['string', 'null'] }, wake: { type: ['string', 'null'] }, quality: { type: ['number', 'null'] } }, required: ['date'] } },
    skipped: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, moment: { type: 'string' } }, required: ['date', 'moment'] } },
    questions: { type: 'array', items: { type: 'string' } },
  },
  required: ['items', 'water', 'habits', 'gym', 'weight', 'skipped', 'questions'],
};

// ---------------------------------------------------------------------------
// Contexto (calendario, momentos, hábitos, biblioteca personal, recientes)
// ---------------------------------------------------------------------------
function fmtVals(p) {
  return `${round0(p.kcal)} kcal, P ${round1(p.p)}, C ${round1(p.c)}, G ${round1(p.f)}`;
}

/** Arma el contexto a partir del estado guardado. */
export function buildContext({ baseDate = null, now = new Date(), baseMoment = null } = {}) {
  const S = store.S();
  const today = isoDate(now);
  if (!baseDate) baseDate = today;
  const refs = {};
  const refLines = [];
  let n = 0;
  // Mis alimentos y recetas
  for (const f of S.customFoods.slice(0, 40)) {
    const code = 'F' + (++n);
    const units = foodUnits(f);
    refs[code] = { code, name: f.n, foodId: f.id, per100: per100Of(f), units, liq: !!f.liq };
    const us = Object.entries(units).slice(0, 3).map(([u, g]) => `1 ${unitLabel(u)} = ${g} ${f.liq ? 'ml' : 'g'}`).join('; ');
    refLines.push(`${code} | ${f.n} | 100 ${f.liq ? 'ml' : 'g'}: ${fmtVals(per100Of(f))}${us ? ' | ' + us : ''}`);
  }
  // Frecuentes del historial
  for (const h of store.historyFoods({ upTo: today, limit: 45 })) {
    if (refLines.some((l) => norm(l.split(' | ')[1]) === h.key)) continue;
    const code = 'F' + (++n);
    refs[code] = { code, name: h.name, per100: h.per100, perUnit: h.perUnit, units: h.units, liq: h.liq };
    if (h.per100) {
      const us = Object.entries(h.units).slice(0, 3).map(([u, g]) => `1 ${unitLabel(u)} = ${g} ${h.liq ? 'ml' : 'g'}`).join('; ');
      refLines.push(`${code} | ${h.name} | 100 ${h.liq ? 'ml' : 'g'}: ${fmtVals(h.per100)}${us ? ' | ' + us : ''}`);
    } else {
      const pu = h.perUnit;
      refLines.push(`${code} | ${h.name} | 1 ${unitLabel(pu.unit)}: ${fmtVals(pu)}`);
    }
  }
  // Recientes (para "lo de ayer", "el bizcochuelo de ayer")
  const recLines = [];
  let r = 0;
  for (const it of store.recentItems(3, today).slice(0, 40)) {
    const code = 'R' + (++r);
    const m = store.itemMacros(it.item);
    const qty = Number(it.item.qty) || 1;
    const unit = it.item.unit || 'porcion';
    const ref = { code, name: it.item.name, liq: !!it.item.liq };
    if (it.item.per100 && it.item.grams) {
      ref.per100 = it.item.per100;
      if (unit !== 'g' && unit !== 'ml') ref.units = { [unit]: round1(it.item.grams / qty) };
    } else {
      ref.perUnit = { unit, kcal: m.kcal / qty, p: m.p / qty, c: m.c / qty, f: m.f / qty, s: m.s / qty, fb: m.fb / qty };
    }
    refs[code] = ref;
    const when = `${relDay(it.date, today)} ${store.momentName(it.moment)}`;
    const amount = `${round1(qty)} ${unitLabel(unit, qty)}${it.item.grams ? ` (${round0(it.item.grams)} ${it.item.liq ? 'ml' : 'g'})` : ''}`;
    recLines.push(`${code} | ${when} | ${it.item.name} | comió ${amount} = ${m.kcal} kcal, P ${m.p}, C ${m.c}, G ${m.f}`);
  }
  const mom = baseMoment || store.momentForTime(now);
  return {
    today, baseDate, now, nowText: `${DIAS[now.getDay()]} ${today} ${nowHHMM(now)}`,
    defaultMoment: mom,
    moments: store.moments().map((m) => ({ id: m.id, name: m.name })),
    habits: store.habitsList().filter((h) => h.kind !== 'hours').map((h) => ({ id: h.id, name: h.name, aliases: h.aliases || [] })),
    glassMl: S.settings.ui.glassMl || 250,
    rawGrains: S.settings.profile?.rawGrains !== false,
    notes: (S.settings.ai.notes || '').trim(),
    learned: store.learnedHints(),
    refs, refLines, recLines,
  };
}

function relDay(date, today) {
  const d = daysBetween(date, today);
  const dn = DIAS_CORTOS[parseISO(date).getDay()];
  if (d === 0) return `hoy ${dn} ${fmtDM(date)}`;
  if (d === 1) return `ayer ${dn} ${fmtDM(date)}`;
  if (d === 2) return `anteayer ${dn} ${fmtDM(date)}`;
  return `${dn} ${fmtDM(date)}`;
}

export function calendarLine(today) {
  const parts = [];
  for (let i = 0; i <= 7; i++) {
    const d = addDays(today, -i);
    const dn = DIAS_CORTOS[parseISO(d).getDay()];
    parts.push(i === 0 ? `hoy = ${dn} ${d}` : i === 1 ? `ayer = ${dn} ${d}` : i === 2 ? `anteayer = ${dn} ${d}` : `${dn} ${d}`);
  }
  const tm = addDays(today, 1);
  parts.push(`mañana = ${DIAS_CORTOS[parseISO(tm).getDay()]} ${tm}`);
  return parts.join(' · ');
}

const RECENT_REF_RE = /\b(ayer|anoche|anteayer|sobr\w*|mismo|misma|mismos|igual|siempre|otra vez|repet\w*|lo de|la de|el de|los de|las de|resto|quedo)\b/;
/** Líneas "código | … | nombre | …" cuyo nombre comparte palabras con el mensaje (más las primeras `keep`). */
export function relevantLines(lines, text, nameIdx, { keep = 6, max = 40 } = {}) {
  const qt = tokens(text).filter((w) => w.length > 2 && !/^\d/.test(w));
  const hits = (w) => qt.some((q) => q === w || (q.length > 3 && w.length > 3 && (q.startsWith(w) || w.startsWith(q))));
  const out = [];
  lines.forEach((l, i) => {
    const nt = tokens(l.split(' | ')[nameIdx] || '');
    if (i < keep || nt.some(hits)) out.push(l);
  });
  return out.slice(0, max);
}

export function buildUserText(text, ctx, extra = {}) {
  const momName = ctx.moments.find((m) => m.id === ctx.defaultMoment)?.name || 'Almuerzo';
  const L = [];
  L.push('CONTEXTO');
  L.push(`Ahora: ${ctx.nowText}`);
  L.push(`Calendario: ${calendarLine(ctx.today)}`);
  L.push(`Fecha por defecto (si el mensaje no indica otra): ${ctx.baseDate}${ctx.baseDate === ctx.today ? ' (hoy)' : ''}`);
  L.push(`Momento por defecto: ${momName} (es solo lo que estaba elegido en la pantalla: usalo ÚNICAMENTE para alimentos sin ninguna pista de momento; si el mensaje nombra comidas, horarios o el orden del día, mandan las palabras del mensaje)`);
  L.push(`Momentos, en orden a lo largo del día: ${ctx.moments.map((m) => m.name).join(' → ')}. Un alimento comido "después" de otro va en el mismo momento o en uno que esté más a la derecha en esta lista, nunca más a la izquierda.`);
  L.push(`Suplementos y hábitos: ${ctx.habits.map((h) => h.name).join(' | ') || '(ninguno)'}`);
  L.push(`1 vaso de agua = ${ctx.glassMl} ml`);
  L.push(ctx.rawGrains === false ? 'Costumbre: el arroz, los fideos y las legumbres se informan ya cocidos, salvo que diga "crudo" o "seco".' : 'Costumbre: cuando da gramos, tazas o paquetes de arroz, fideos o legumbres, los pesa EN CRUDO (secos), salvo que diga "cocido", "hervido" o "un plato de".');
  if (ctx.learned?.length) L.push(`Medidas y equivalencias aprendidas del usuario: ${ctx.learned.join('; ')}`);
  if (ctx.notes) L.push(`Notas del usuario para vos: ${ctx.notes}`);
  // Solo las referencias que tienen que ver con el mensaje: el prompt queda más corto y la IA responde antes
  const msg = extra.previous ? `${text || ''} ${extra.correction || ''}` : (text || '');
  const filter = !extra.hasAudio && !extra.hasImage && msg.trim().length > 0;
  const refLines = filter ? relevantLines(ctx.refLines || [], msg, 1, { keep: 6 }) : (ctx.refLines || []);
  const recLines = filter ? relevantLines(ctx.recLines || [], msg, 2, { keep: RECENT_REF_RE.test(norm(msg)) ? 12 : 0 }) : (ctx.recLines || []);
  if (refLines.length) {
    L.push('');
    L.push('REFERENCIAS DEL USUARIO (usá "ref" solo si es el mismo alimento con la misma receta)');
    L.push(...refLines);
  }
  if (recLines.length) {
    L.push('');
    L.push('COMIDAS RECIENTES (para referencias como "lo de ayer")');
    L.push(...recLines);
  }
  L.push('');
  if (extra.previous) {
    L.push('MENSAJE ORIGINAL');
    L.push('"""' + (text || '(audio o imagen)') + '"""');
    L.push('');
    L.push('TU RESPUESTA ANTERIOR (JSON)');
    L.push(JSON.stringify(extra.previous));
    L.push('');
    L.push('CORRECCIÓN DEL USUARIO (aplicala y devolvé el JSON COMPLETO actualizado, con todo lo que no cambió)');
    L.push('"""' + extra.correction + '"""');
  } else {
    L.push('MENSAJE DEL USUARIO');
    L.push('"""' + (text || '(sin texto: analizá el adjunto)') + '"""');
    if (extra.hasImage) L.push('Se adjunta una imagen (plato, producto o tabla nutricional).');
    if (extra.hasAudio) L.push('Se adjunta un audio: transcribilo en transcript y analizalo.');
  }
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// Cliente Gemini (Interactions API con respaldo en generateContent)
// ---------------------------------------------------------------------------
async function httpJSON(url, { method = 'GET', key, body, timeout = 120000, auth = 'header', signal = null } = {}) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeout);
  if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', () => ctrl.abort(), { once: true }); }
  const headers = { 'Content-Type': 'application/json' };
  let u = url;
  if (auth === 'query') u += (u.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(key);
  else headers['x-goog-api-key'] = key;
  try {
    const res = await fetch(u, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* no es JSON */ }
    return { ok: res.ok, status: res.status, json, text, retryAfter: Number(res.headers.get('retry-after')) || 0 };
  } catch (e) {
    return { ok: false, status: 0, error: e && e.name === 'AbortError' ? (signal?.aborted ? 'cancelada' : 'timeout') : (e && e.message) || 'network', json: null, text: '' };
  } finally { clearTimeout(tid); }
}

function errMessage(r) {
  const e = r.json && (r.json.error || (r.json.errors && r.json.errors[0]));
  return (e && (e.message || e.status)) || r.error || r.text?.slice(0, 200) || `HTTP ${r.status}`;
}

export class AIError extends Error {
  constructor(code, message, detail) { super(message); this.code = code; this.detail = detail; }
}

function rankModels(names) {
  const parsed = names.map((n) => {
    const m = n.match(/^gemini-(\d+(?:\.\d+)?)-(flash|pro)(?:-(lite))?$/);
    return m ? { n, v: parseFloat(m[1]), tier: m[2], lite: !!m[3] } : null;
  }).filter(Boolean);
  const by = (f) => parsed.filter(f).sort((a, b) => b.v - a.v).map((x) => x.n);
  return { flash: by((x) => x.tier === 'flash' && !x.lite), lite: by((x) => x.tier === 'flash' && x.lite), pro: by((x) => x.tier === 'pro'), all: names.slice(0, 200) };
}

/** Lista los modelos disponibles para la clave (se guarda 24 h). */
export async function discoverModels(ai, { force = false } = {}) {
  const fresh = ai.models && ai.models.flash && Date.now() - (ai.modelsAt || 0) < 86400000;
  if (fresh && !force) return ai.models;
  const r = await httpJSON(`${API}/v1beta/models?pageSize=1000`, { key: ai.key, timeout: 20000, auth: ai.auth || 'header' });
  if (r.ok && Array.isArray(r.json?.models)) {
    const names = r.json.models
      .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.some((x) => /generate|interaction/i.test(x)))
      .map((m) => String(m.name || '').replace(/^models\//, ''));
    ai.models = rankModels(names);
    ai.modelsAt = Date.now();
    return ai.models;
  }
  return ai.models || null;
}

function modelOrder(ai) {
  const m = ai.models || {};
  const avail = Array.isArray(m.all) && m.all.length ? new Set(m.all) : null;
  const ok = (x) => !avail || avail.has(x);
  const pref = ai.precision === 'maxima' ? ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash']
    : ai.precision === 'rapida' ? ['gemini-3.5-flash-lite', 'gemini-3.5-flash']
      : ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'];
  const out = [];
  if (ai.model && ai.model !== 'auto') out.push(ai.model);
  out.push(...pref.filter(ok), ...(m.flash || []).slice(0, 2), ...(m.lite || []).slice(0, 1), ...FALLBACK_MODELS.filter(ok));
  return [...new Set(out)].filter((x) => !isExhausted(ai, x)).slice(0, 4);
}

function interactionsBody({ model, system, parts, schema, web, thinking }) {
  const input = parts.map((p) => (p.text != null ? { type: 'text', text: p.text } : { type: p.kind, mime_type: p.mime, data: p.data }));
  const body = { model, input, system_instruction: system, store: false, generation_config: { max_output_tokens: 16384 } };
  if (thinking) body.generation_config.thinking_level = thinking;
  if (web) body.tools = [{ type: 'google_search' }];
  if (schema) body.response_format = { type: 'text', mime_type: 'application/json', schema };
  return body;
}
function generateBody({ system, parts, schema, web, thinking }) {
  const gparts = parts.map((p) => (p.text != null ? { text: p.text } : { inlineData: { mimeType: p.mime, data: p.data } }));
  const generationConfig = { maxOutputTokens: 16384 };
  if (schema) { generationConfig.responseMimeType = 'application/json'; generationConfig.responseJsonSchema = schema; }
  if (thinking) generationConfig.thinkingConfig = { thinkingLevel: thinking };
  const body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: gparts }], generationConfig };
  if (web) body.tools = [{ googleSearch: {} }];
  return body;
}

/** Busca fuentes web (url + título) en cualquier parte de la respuesta. */
export function collectSources(json) {
  const out = [];
  const seen = new Set();
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 9) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
    const url = o.url || o.uri;
    if (typeof url === 'string' && /^https?:\/\//.test(url) && !seen.has(url)) {
      seen.add(url);
      out.push({ t: String(o.title || o.domain || url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]).slice(0, 80), u: url });
    }
    for (const k of Object.keys(o)) if (k !== 'data' && k !== 'inlineData') walk(o[k], depth + 1);
  };
  walk(json, 0);
  return out.slice(0, 8);
}

export function extractText(json, endpoint) {
  if (!json) return '';
  if (endpoint === 'interactions') {
    if (typeof json.output_text === 'string' && json.output_text) return json.output_text;
    const steps = json.steps || json.outputs || [];
    let text = '';
    for (const st of steps) {
      if (st && (st.type === 'model_output' || st.role === 'model') && Array.isArray(st.content)) {
        const t = st.content.filter((c) => c && c.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('');
        if (t) text = t;
      } else if (st && st.type === 'text' && typeof st.text === 'string') text = st.text;
    }
    return text;
  }
  const parts = json.candidates?.[0]?.content?.parts || [];
  return parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
}

/** Extrae el JSON aunque venga con ``` o texto alrededor. */
export function parseModelJSON(text) {
  if (!text) return null;
  let t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch { /* sigue */ }
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* sigue */ } }
  return null;
}

// ---------------------------------------------------------------------------
// Ritmo de consultas: el plan gratuito de Gemini permite pocas por minuto (5 en 3.8 Flash)
// y pocas por día (20). Cada análisis hace UNA consulta salvo que falle; las consultas se
// hacen de a una (cola) y nunca más de 4 por minuto, así no aparece el error de límite.
// ---------------------------------------------------------------------------
const RATE_WIN = 60000;
const RATE_MAX = 4;
const STAMPS_KEY = 'apextrack_ai_stamps';
function loadStamps(model = '') { try { return JSON.parse(localStorage.getItem(STAMPS_KEY + model) || '[]').filter((t) => Date.now() - t < RATE_WIN); } catch { return []; } }
function saveStamps(a, model = '') { try { localStorage.setItem(STAMPS_KEY + model, JSON.stringify(a)); } catch { /* opcional */ } }
/** Cada modelo tiene su propio límite por minuto: se cuenta por separado. */
async function waitSlot(onStatus, model = '') {
  for (;;) {
    const st = loadStamps(model);
    if (st.length < RATE_MAX) { st.push(Date.now()); saveStamps(st, model); return; }
    const wait = RATE_WIN - (Date.now() - st[0]) + 500;
    onStatus(`Esperando ${Math.ceil(wait / 1000)} s (límite gratuito por minuto)…`);
    await sleep(Math.min(wait, 1000));
  }
}
/** Toma un lugar en la ventana por minuto solo si hay uno libre ya (para la consulta de respaldo). */
function trySlot(model) {
  const st = loadStamps(model);
  if (st.length >= RATE_MAX) return false;
  st.push(Date.now()); saveStamps(st, model);
  return true;
}
/**
 * Consulta con respaldo: si el primer modelo no contestó en `hedgeMs`, se lanza la misma consulta a
 * otro modelo (otro cupo, otros servidores) y se usa la primera respuesta válida. La otra se cancela.
 */
export function hedgedRequest(run, { primary, backup, hedgeMs, onHedge = () => {} }) {
  const valid = (r) => r.ok && !!parseModelJSON(extractText(r.json, r.endpoint || 'generate'));
  const ctrls = [new AbortController(), new AbortController()];
  return new Promise((resolve) => {
    const results = [];
    let launched = 1; let done = false; let timer = null;
    const finish = (res) => {
      if (done) return;
      done = true; clearTimeout(timer);
      ctrls.forEach((c, i) => { if (i !== res.i) c.abort(); });
      res.other = launched > 1 ? (res.i === 0 ? backup : primary) : null;
      resolve(res);
    };
    const handle = (res) => {
      if (done) return;
      results.push(res);
      if (valid(res.r) || launched === 1) { finish(res); return; } // sin respaldo en curso: sigue el manejo normal de errores
      if (results.length === launched) finish(results[0]);
    };
    run(primary, ctrls[0].signal).then((r) => handle({ r, model: primary, i: 0 }));
    if (backup) {
      timer = setTimeout(() => {
        if (done || !trySlot(backup)) return;
        launched = 2; onHedge(backup);
        run(backup, ctrls[1].signal).then((r) => handle({ r, model: backup, i: 1 }));
      }, hedgeMs);
    }
  });
}

/** Día de cuota de Google (se renueva a la medianoche del Pacífico). */
const quotaDay = () => new Date(Date.now() - 8 * 3600e3).toISOString().slice(0, 10);
function isExhausted(ai, model) { return !!(ai.exhausted && ai.exhausted[model] === quotaDay()); }
function quotaInfo(r) {
  const det = (r.json && r.json.error && r.json.error.details) || [];
  let perDay = false; let perMin = false; let retry = 0;
  for (const d of det) {
    const t = String(d['@type'] || '');
    if (/QuotaFailure/.test(t)) for (const v of d.violations || []) { const id = String(v.quotaId || v.quotaMetric || ''); if (/PerDay/i.test(id)) perDay = true; if (/PerMinute/i.test(id)) perMin = true; }
    if (/RetryInfo/.test(t)) retry = parseFloat(String(d.retryDelay || '0')) || 0;
  }
  const low = errMessage(r).toLowerCase();
  if (!perDay && !perMin) { if (/per day|daily|perday/.test(low)) perDay = true; else perMin = true; }
  if (perDay && perMin) perDay = !(retry && retry < 120); // si dice "reintentá en 30 s", es por minuto
  return { perDay, perMin: !perDay, retry: retry || r.retryAfter || 0 };
}

let queue = Promise.resolve();
let running = 0;
/**
 * Llama a Gemini. Las llamadas se encolan (una a la vez).
 * parts: [{text}] | [{kind:'image'|'audio', mime, data}]
 */
export function callGemini(opts) {
  const onStatus = opts.onStatus || (() => {});
  if (running > 0) onStatus('En espera: termina el análisis anterior…');
  running++;
  const run = queue.then(() => callGeminiNow({ ...opts, onStatus }));
  queue = run.catch(() => {}).finally(() => { running--; });
  return run;
}

async function callGeminiNow({ ai, system, parts, web = true, onStatus = () => {}, schema = RESPONSE_SCHEMA }) {
  if (!ai.key) throw new AIError('sin_clave', 'Falta la clave de Gemini. Cargala en Ajustes → Inteligencia artificial.');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new AIError('sin_conexion', 'Sin conexión a internet.');
  const t0 = Date.now();
  // si hace poco Gemini limitó la búsqueda web, se analiza sin búsqueda un rato (otro cupo)
  if (web && ai.webPauseUntil && Date.now() < ai.webPauseUntil) web = false;
  try { await discoverModels(ai); } catch { /* sigue con la lista fija */ }
  const models = modelOrder(ai).filter((m) => !isExhausted(ai, m));
  if (!models.length) throw new AIError('cuota_dia', 'Se agotó el cupo diario gratuito de Gemini en todos los modelos. Se renueva entre las 4 y las 5 de la mañana. Mientras tanto podés calcular sin IA.');
  const thinking0 = THINKING[ai.precision] || 'medium';
  // generateContent es el servicio estable y probado desde el navegador; Interactions queda de respaldo
  let endpoint = ai.endpoint === 'interactions' && ai.endpointForced ? 'interactions' : 'generate';
  let auth = ai.auth || 'header';
  const log = [];
  let lastErr = null;
  let budget = 6; // consultas reales como máximo por análisis
  let minuteWaits = 0;
  let otherModelTried = false;
  let status = web ? 'Analizando y buscando datos…' : 'Analizando…';
  let hedged = false;
  for (let mi = 0; mi < models.length && budget > 0; mi++) {
    const model0 = models[mi];
    const model = model0;
    const useWeb = web && !(ai.webPauseUntil && Date.now() < ai.webPauseUntil);
    let variants = useWeb ? [{ web: true, schema: true }, { web: true, schema: false }, { web: false, schema: true }] : [{ web: false, schema: true }, { web: false, schema: false }];
    if (useWeb && ai.variant === 'w') variants = [variants[1], variants[0], variants[2]]; // lo que funcionó la última vez va primero
    let thinking = thinking0;
    let switchedEndpoint = false;
    for (let vi = 0; vi < variants.length && budget > 0; vi++) {
      const v = variants[vi];
      let model = model0;
      onStatus(status);
      await waitSlot(onStatus, model);
      onStatus(status);
      budget--;
      const url = endpoint === 'interactions' ? `${API}/v1beta/interactions` : `${API}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const body = endpoint === 'interactions'
        ? interactionsBody({ model, system, parts, schema: v.schema ? schema : null, web: v.web, thinking })
        : generateBody({ system, parts, schema: v.schema ? schema : null, web: v.web, thinking });
      const tr = Date.now();
      const timeout = v.web ? 60000 : 40000;
      let r;
      // primera consulta: si tarda, se lanza la misma a otro modelo y gana la que conteste primero
      const backupModel = !hedged && endpoint === 'generate' && !v.web ? models.find((m, i) => i > mi && !isExhausted(ai, m)) : null;
      if (backupModel) {
        hedged = true;
        const out = await hedgedRequest(async (m, signal) => {
          const res = await httpJSON(`${API}/v1beta/models/${encodeURIComponent(m)}:generateContent`, { method: 'POST', key: ai.key, body, auth, timeout, signal });
          res.endpoint = 'generate';
          return res;
        }, { primary: model, backup: backupModel, hedgeMs: ai.hedgeMs || HEDGE_MS[ai.precision] || HEDGE_MS.equilibrada, onHedge: () => { status = 'Tarda más de lo normal: consulto también otro modelo…'; onStatus(status); } });
        r = out.r; model = out.model;
        if (out.other) log.push({ model: out.other, endpoint, web: false, schema: v.schema, status: 0, s: Math.round((Date.now() - tr) / 1000), msg: out.model === model0 ? 'respaldo sin usar' : 'más lento: cancelado' });
      } else {
        r = await httpJSON(url, { method: 'POST', key: ai.key, body, auth, timeout });
      }
      const msg = errMessage(r);
      log.push({ model, endpoint, web: v.web, schema: v.schema, status: r.status, s: Math.round((Date.now() - tr) / 1000), msg: r.ok ? 'ok' : String(msg).slice(0, 160) });
      if (r.ok) {
        if (endpoint === 'interactions' && r.json?.status === 'failed') { lastErr = new AIError('fallo', 'La IA no pudo completar el análisis.', msg); status = 'La IA no terminó: pruebo de nuevo…'; continue; }
        const text = extractText(r.json, endpoint);
        const parsed = parseModelJSON(text);
        if (parsed && typeof parsed === 'object') {
          ai.endpoint = endpoint; ai.auth = auth; ai.resolvedModel = model;
          if (v.web) ai.variant = v.schema ? 'ws' : 'w';
          return { raw: parsed, text, sources: collectSources(r.json), model, endpoint, web: v.web, ms: Date.now() - t0, log };
        }
        lastErr = new AIError('json', 'La respuesta de la IA vino incompleta.', text?.slice(0, 300));
        status = 'La respuesta vino incompleta: pido de nuevo…';
        continue;
      }
      const s = r.status;
      const low = String(msg).toLowerCase();
      if (s === 401 || s === 403 || /api key|api_key|permission|unauthenticated|access_token/.test(low)) {
        if (auth === 'header') { auth = 'query'; vi--; continue; }
        throw Object.assign(new AIError('clave', 'La clave de Gemini no es válida o no tiene permiso para este modelo. Revisala en Ajustes.', msg), { log });
      }
      if (s === 429 || /quota|resource_exhausted|rate limit/.test(low)) {
        const q = quotaInfo(r);
        if (q.perDay) {
          ai.exhausted = { ...(ai.exhausted || {}), [model]: quotaDay() };
          lastErr = new AIError('cuota_dia', `Se agotó el cupo diario gratuito de ${model}. Se renueva entre las 4 y las 5 de la mañana. Podés calcular sin IA mientras tanto.`, msg);
          status = 'Se agotó el cupo diario de este modelo: pruebo con otro…';
          break; // siguiente modelo (cada modelo tiene su propio cupo)
        }
        // 1) la búsqueda web tiene su propio límite: seguir sin búsqueda en vez de esperar
        if (v.web) {
          const nw = variants.findIndex((x) => !x.web);
          if (nw > vi) { vi = nw - 1; budget++; ai.webPauseUntil = Date.now() + 6 * 3600000; ai.webNote = 'Tu clave gratuita no tiene cupo para la búsqueda de Google: uso tablas propias y Open Food Facts.'; status = 'Analizando sin búsqueda de Google…'; continue; }
        }
        // 2) cada modelo tiene su propio límite por minuto: probar otro antes de esperar
        if (!otherModelTried && mi < models.length - 1) { otherModelTried = true; budget++; status = 'Límite por minuto de este modelo: pruebo con otro…'; lastErr = new AIError('cuota', 'Gemini está limitando las consultas por minuto.', msg); break; }
        // 3) recién ahí esperar lo que pide Google (una vez)
        if (minuteWaits < 1) {
          minuteWaits++;
          const wait = Math.min(65, Math.max(10, Math.ceil(q.retry) || 30));
          saveStamps(Array(RATE_MAX).fill(Date.now()), model); // ocupar la ventana
          for (let k = wait; k > 0; k--) { onStatus(`Límite por minuto de Gemini: reintento en ${k} s…`); await sleep(1000); }
          saveStamps([], model);
          budget++; vi--; continue;
        }
        lastErr = new AIError('cuota', `Gemini rechazó la consulta por límite (${String(msg).slice(0, 120)}). Esperá unos minutos o calculalo sin IA.`, msg);
        break;
      }
      if (s === 400 && /thinking/.test(low) && thinking) { thinking = null; vi--; status = 'Ajustando la consulta…'; continue; }
      if (s === 404 || /not found|is not supported|unsupported model|unknown model/.test(low)) {
        if (!/model/.test(low) && !switchedEndpoint) { endpoint = endpoint === 'interactions' ? 'generate' : 'interactions'; switchedEndpoint = true; vi--; status = 'Ajustando la consulta…'; continue; }
        lastErr = new AIError('modelo', `El modelo ${model} no está disponible.`, msg);
        if (ai.models) ai.modelsAt = 0;
        status = 'Probando otro modelo…';
        break; // siguiente modelo
      }
      if (s === 400 && endpoint === 'interactions' && /unknown name|invalid json payload|cannot find field/.test(low) && !switchedEndpoint) { endpoint = 'generate'; switchedEndpoint = true; vi--; status = 'Ajustando la consulta…'; continue; }
      if (s === 0 || s >= 500) {
        if (s === 0 && r.error !== 'timeout' && typeof navigator !== 'undefined' && navigator.onLine === false) throw new AIError('sin_conexion', 'Sin conexión a internet.');
        // respuesta bloqueada por el navegador (no es la red): cambiar de servicio una vez
        if (s === 0 && r.error !== 'timeout' && !switchedEndpoint) { endpoint = endpoint === 'interactions' ? 'generate' : 'interactions'; switchedEndpoint = true; vi--; status = 'Probando otra vía de conexión…'; lastErr = new AIError('red', 'No se pudo conectar con la IA.', msg); continue; }
        if (s === 0 && r.error !== 'timeout') { lastErr = new AIError('red', 'No se pudo conectar con la IA (la conexión se cortó).', msg); if (log.filter((x) => x.status === 0).length >= 2) { mi = models.length; break; } }
        lastErr = new AIError(s === 0 ? 'red' : 'servidor', s === 0 ? (r.error === 'timeout' ? 'La IA tardó demasiado en responder.' : 'No se pudo conectar con la IA.') : 'El servicio de IA tuvo un problema momentáneo.', msg);
        if (r.error === 'timeout' && v.web) {
          // la búsqueda web demoró: no repetir otra consulta igual de pesada
          const nw = variants.findIndex((x) => !x.web);
          if (nw > vi) { vi = nw - 1; status = 'La búsqueda tardó demasiado: analizo sin búsqueda web…'; continue; }
        }
        if (s >= 500) { status = 'El modelo está saturado: pruebo con otro…'; break; }
        status = 'Falló la conexión: reintento…';
        continue;
      }
      if (s === 400 && v.web) status = 'Ajustando el formato de la consulta…';
      lastErr = new AIError('peticion', 'La IA rechazó la consulta.', msg);
    }
  }
  if (lastErr) { lastErr.log = log; throw lastErr; }
  const e = new AIError('desconocido', 'No se pudo completar el análisis con la IA.');
  e.log = log;
  throw e;
}

/**
 * Diagnóstico completo (Ajustes → IA): prueba cada vía por separado y devuelve un informe
 * que se puede copiar. Usa 4 consultas de la cuota.
 */
export async function diagnose(ai, onStep = () => {}) {
  const lines = [];
  const add = (ok, name, info) => { lines.push({ ok, name, info }); onStep(lines.slice()); };
  const env = `${typeof navigator !== 'undefined' ? navigator.userAgent.replace(/\s+/g, ' ').slice(0, 120) : 'node'} · online=${typeof navigator !== 'undefined' ? navigator.onLine : '?'}`;
  add(true, 'Dispositivo', env);
  if (!ai.key) { add(false, 'Clave', 'No hay clave cargada'); return lines; }
  add(true, 'Clave', `${ai.key.slice(0, 4)}… (${ai.key.length} caracteres) · envío por ${ai.auth || 'header'}`);
  let t = Date.now();
  const lm = await httpJSON(`${API}/v1beta/models?pageSize=1000`, { key: ai.key, timeout: 20000, auth: ai.auth || 'header' });
  let model = 'gemini-3.5-flash';
  if (lm.ok && Array.isArray(lm.json?.models)) {
    const rk = rankModels(lm.json.models.map((m) => String(m.name || '').replace(/^models\//, '')));
    ai.models = rk; ai.modelsAt = Date.now();
    model = modelOrder(ai)[0] || rk.flash[0] || model;
    add(true, 'Lista de modelos', `${lm.json.models.length} modelos en ${Date.now() - t} ms · Flash: ${rk.flash.slice(0, 3).join(', ') || '—'} · Lite: ${rk.lite.slice(0, 2).join(', ') || '—'} · Pro: ${rk.pro.slice(0, 2).join(', ') || '—'}`);
  } else add(false, 'Lista de modelos', `HTTP ${lm.status} ${lm.error || ''} ${errMessage(lm).slice(0, 200)}`);
  const exh = Object.entries(ai.exhausted || {}).filter(([, d]) => d === quotaDay()).map(([m]) => m);
  if (exh.length) add(false, 'Cupo diario marcado como agotado', exh.join(', '));
  const sch = { type: 'object', properties: { kcal: { type: 'number' }, fuente: { type: 'string' } }, required: ['kcal'] };
  const q = [{ text: 'Calorías por 100 g de galletitas Traviata (Bagley, Argentina). Respondé solo JSON {"kcal":número,"fuente":"..."}' }];
  const steps = [
    ['Gemini sin búsqueda (generateContent)', 'generate', false, sch],
    ['Gemini con búsqueda web + formato JSON', 'generate', true, sch],
    ['Gemini con búsqueda web, sin formato', 'generate', true, null],
    ['Interactions (vía alternativa)', 'interactions', false, sch],
  ];
  for (const [name, ep, web, schema] of steps) {
    onStep(lines.slice(), name);
    await waitSlot(() => {}, model);
    t = Date.now();
    const thinking = THINKING[ai.precision] || 'low';
    const body = ep === 'interactions' ? interactionsBody({ model, system: 'Respondé en JSON.', parts: q, schema, web, thinking }) : generateBody({ system: 'Respondé en JSON.', parts: q, schema, web, thinking });
    const url = ep === 'interactions' ? `${API}/v1beta/interactions` : `${API}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const r = await httpJSON(url, { method: 'POST', key: ai.key, body, auth: ai.auth || 'header', timeout: 75000 });
    const ms = Date.now() - t;
    if (r.ok) {
      const txt = extractText(r.json, ep);
      const j = parseModelJSON(txt);
      add(!!j, name, `${model} · ${(ms / 1000).toFixed(1)} s · ${j ? `respuesta ${JSON.stringify(j).slice(0, 90)}` : `texto no JSON: ${String(txt).slice(0, 90)}`}${web ? ` · fuentes ${collectSources(r.json).length}` : ''}`);
    } else {
      const extra = r.status === 429 ? ` (${quotaInfo(r).perDay ? 'cupo DIARIO' : 'límite por MINUTO'})` : '';
      add(false, name, `${model} · ${(ms / 1000).toFixed(1)} s · HTTP ${r.status || 0}${extra} ${r.error ? '[' + r.error + ']' : ''} ${errMessage(r).slice(0, 220)}`);
    }
  }
  return lines;
}

/** Prueba corta de conexión para Ajustes. */
export async function testConnection(ai) {
  const t0 = Date.now();
  const models = await discoverModels(ai, { force: true }).catch(() => null);
  const res = await callGemini({
    ai, system: 'Respondé solo el JSON pedido.', web: false,
    parts: [{ text: 'Devolvé {"ok":true,"modelo":"<tu nombre de modelo>"}' }],
    schema: { type: 'object', properties: { ok: { type: 'boolean' }, modelo: { type: 'string' } }, required: ['ok'] },
  });
  return { ok: !!res.raw?.ok, model: res.model, endpoint: res.endpoint, ms: Date.now() - t0, models };
}

// ---------------------------------------------------------------------------
// Normalización y validación del resultado (lo que se muestra para revisar)
// ---------------------------------------------------------------------------
const num = (v) => { const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v); return Number.isFinite(n) ? n : NaN; };
const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] !== undefined && o[k] !== null) return o[k]; return undefined; };

const ALCOHOL_RE = /\b(vino|cerveza|birra|fernet|vodka|whisky|whiskey|ron|gin|licor|sidra|champagne|champan|espumante|aperitivo|trago|campari|gancia|tequila|daiquiri|mojito|caipirinha|cuba libre|destornillador)\b/;
const DRINK_RE = /\b(bebida|jugo|leche|gaseosa|agua|cafe|te|mate cocido|vino|cerveza|licuado|batido|soda|infusion|cola|coca|sprite|fanta|gatorade|powerade|yogur bebible|chocolatada|fernet|trago|sidra)\b/;
// Bebidas que también suman al agua del día (sin alcohol ni lácteos espesos)
const HYDRO_RE = /\b(mate|mates|terere|te|cafe|gaseosa|soda|jugo|agua|aguas|infusion|cola|coca|sprite|fanta|seven up|7up|pomelo|tonica|gatorade|powerade|aquarius|levite|limonada|isotonica|cocido)\b/;
const NOT_HYDRO_RE = /^(leche|yogur)|licuado|batido|chocolatada|smoothie|caldo|sopa|polvo|helado|dulce de/;
export function hydrationMl(name, it) {
  const n = norm(name || '');
  if (!it?.liq || !HYDRO_RE.test(n) || NOT_HYDRO_RE.test(n) || ALCOHOL_RE.test(n)) return 0;
  const ml = Number(it.grams);
  return ml >= 30 ? Math.min(2000, Math.round(ml)) : 0;
}
const DRINK_UNITS = new Set(['ml', 'vaso', 'taza', 'botella', 'copa', 'lata']);
function isLiquid(name, unit) {
  const n = norm(name);
  if (/dulce de leche|arroz con leche|leche en polvo|queso/.test(n)) return false;
  return unit === 'ml' || (DRINK_UNITS.has(unit) && DRINK_RE.test(n));
}

function readPer100(o) {
  if (!o || typeof o !== 'object') return null;
  return {
    al: num(pick(o, 'alcohol', 'al')),
    kcal: num(pick(o, 'kcal', 'calorias', 'calories', 'energy')),
    p: num(pick(o, 'protein', 'proteina', 'proteins', 'p', 'prot')),
    c: num(pick(o, 'carbs', 'carbohidratos', 'carbohydrates', 'c')),
    f: num(pick(o, 'fat', 'grasas', 'fats', 'f')),
    s: num(pick(o, 'sugars', 'azucares', 'sugar', 's')),
    fb: num(pick(o, 'fiber', 'fibra', 'fb')),
  };
}

function scaleMacros(m, k) {
  return { kcal: (m.kcal || 0) * k, p: (m.p || 0) * k, c: (m.c || 0) * k, f: (m.f || 0) * k, s: (m.s || 0) * k, fb: (m.fb || 0) * k };
}

export function matchHabit(name, habits) {
  const n = norm(name);
  if (!n) return null;
  for (const h of habits) {
    if (norm(h.name) === n || h.id === n) return h.id;
    for (const a of h.aliases || []) if (n.includes(norm(a))) return h.id;
  }
  for (const h of habits) if (norm(h.name).split(' ').some((w) => w.length > 4 && n.includes(w))) return h.id;
  return null;
}

/**
 * Convierte la respuesta cruda de la IA en un borrador validado:
 * { groups:[{date, moment, items[]}], water[], habits[], gym[], weight[], skipped[], questions[], warnings[] }
 */
export function normalizeDraft(raw0, ctx, meta = {}) {
  let raw = raw0 || {};
  const today = ctx.today;
  const minDate = addDays(today, -60);
  const maxDate = addDays(today, 1);
  const warnings = [];
  const fixDate = (d0) => {
    let d = typeof d0 === 'string' ? d0.trim() : d0;
    if (typeof d === 'string') {
      const w = norm(d);
      if (w === 'hoy') d = today; else if (w === 'ayer') d = addDays(today, -1); else if (w === 'anteayer') d = addDays(today, -2);
      const m = d.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
      if (m) { const y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : today.slice(0, 4); d = `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`; }
      if (/^\d{4}-\d{2}-\d{2}T/.test(d)) d = d.slice(0, 10);
    }
    if (isISODate(d) && d >= minDate && d <= maxDate) return d;
    if (d) warnings.push(`Fecha "${d}" fuera de rango: usé ${ctx.baseDate}.`);
    return ctx.baseDate;
  };
  const fixMoment = (m) => store.matchMoment(m) || ctx.defaultMoment;
  const groups = [];
  const groupFor = (date, moment) => {
    let g = groups.find((x) => x.date === date && x.moment === moment);
    if (!g) { g = { date, moment, items: [] }; groups.push(g); }
    return g;
  };

  // Orden del día: si el mensaje dice "después" y la IA puso un alimento en un momento anterior
  // a lo ya comido ese día (sin que el mensaje nombre ese momento), se pasa al momento previo.
  const inputN = norm(meta.input || '');
  const MOM_WORDS = { desayuno: /desayun/, media_manana: /media manana/, almuerzo: /almuerz|almorc|mediodia/, media_tarde: /media tarde/, merienda: /merend|merienda/, pre_entreno: /pre ?entren|antes de entrenar/, post_entreno: /post ?entren|despues de entrenar/, cena: /\bcena|\bcene/, post_cena: /post ?cena|despues de cenar|antes de dormir/ };
  const mentioned = (id) => { const re = MOM_WORDS[id]; const mo = store.momentById(id); return (re && re.test(inputN)) || (mo && inputN.includes(norm(mo.name))); };
  const lastByDate = {};
  const seqFix = /\b(despues|luego|mas tarde)\b/.test(inputN);

  const extraWater = []; const extraHabits = [];
  for (const r of Array.isArray(raw?.items) ? raw.items : []) {
    if (seqFix && r && r.moment) {
      const d0 = fixDate(r.date); const m0 = fixMoment(r.moment); const prev = lastByDate[d0];
      if (prev && store.momentIndex(m0) < store.momentIndex(prev) && !mentioned(m0)) r.moment = store.momentName(prev);
      lastByDate[d0] = fixMoment(r.moment);
    }
    const nm = norm(r?.name || '');
    const kcal100 = num(r?.per100?.kcal);
    // El agua y los suplementos sin calorías no son comida
    if (/^agua( mineral| de la canilla| con gas| sin gas)?$/.test(nm) && !(kcal100 > 5)) {
      const ml = num(r.grams) > 0 ? num(r.grams) : num(r.quantity) * (canonUnit(r.unit) === 'vaso' ? ctx.glassMl : 1);
      if (ml > 0) extraWater.push({ date: r.date, ml, mode: 'sumar' });
      continue;
    }
    const hid = matchHabit(nm, ctx.habits);
    if (hid && !(kcal100 > 20) && ctx.habits.find((h) => h.id === hid)) { extraHabits.push({ date: r.date, habit: ctx.habits.find((h) => h.id === hid).name, done: true }); continue; }
    const item = normalizeItem(r, ctx, warnings);
    if (!item) continue;
    groupFor(fixDate(r.date), fixMoment(r.moment)).items.push(item);
    // mate, gaseosa, té, jugo… también cuentan como agua
    const hml = hydrationMl(r.name, item);
    if (hml) extraWater.push({ date: r.date, ml: hml, mode: 'sumar', src: item.name.split(' (')[0] });
  }
  if (extraWater.length) raw = { ...raw, water: [...(raw.water || []), ...extraWater] };
  if (extraHabits.length) raw = { ...raw, habits: [...(raw.habits || []), ...extraHabits] };
  groups.sort((a, b) => a.date.localeCompare(b.date) || store.momentIndex(a.moment) - store.momentIndex(b.moment));

  const water = [];
  const fixedDays = new Set((Array.isArray(raw?.water) ? raw.water : []).filter((w) => w.mode === 'fijar').map((w) => fixDate(w.date)));
  for (const w of Array.isArray(raw?.water) ? raw.water : []) {
    let ml = num(w.ml);
    if (!(ml > 0)) continue;
    if (w.src && fixedDays.has(fixDate(w.date))) continue; // ya dio el total del día
    if (ml > 8000) { warnings.push(`Agua: ${ml} ml parece un error, lo limité a 4000 ml.`); ml = 4000; }
    water.push({ date: fixDate(w.date), ml: round0(ml), mode: w.mode === 'fijar' ? 'fijar' : 'sumar', ...(w.src ? { src: String(w.src) } : {}) });
  }
  const habits = [];
  for (const h of Array.isArray(raw?.habits) ? raw.habits : []) {
    const id = matchHabit(h.habit || h.name, ctx.habits);
    const date = fixDate(h.date);
    const done = h.done !== false;
    const dup = habits.findIndex((x) => x.date === date && (id ? x.id === id : x.name === h.habit));
    const rec = { date, id, name: id ? ctx.habits.find((x) => x.id === id).name : String(h.habit || h.name || ''), done };
    if (dup >= 0) habits[dup] = rec; else habits.push(rec);
  }
  const gym = [];
  for (const g of Array.isArray(raw?.gym) ? raw.gym : []) {
    const status = ['fui', 'no_fui', 'descanso'].includes(g.status) ? g.status : /no/.test(norm(g.status)) ? 'no_fui' : /desc/.test(norm(g.status)) ? 'descanso' : 'fui';
    const date = fixDate(g.date);
    const i = gym.findIndex((x) => x.date === date);
    const rec = { date, status, detail: g.detail || '' };
    if (i >= 0) gym[i] = rec; else gym.push(rec);
  }
  const weight = [];
  for (const w of Array.isArray(raw?.weight) ? raw.weight : []) {
    const kg = num(w.kg);
    if (kg >= 25 && kg <= 300) weight.push({ date: fixDate(w.date), kg: round1(kg) });
  }
  const study = [];
  for (const x of Array.isArray(raw?.study) ? raw.study : []) {
    const h = num(x.hours);
    if (h > 0 && h <= 16) study.push({ date: fixDate(x.date), hours: round1(h) });
  }
  const ACT_TYPES = ['caminata', 'caminata_rapida', 'correr', 'bici', 'natacion', 'futbol', 'tenis', 'baile', 'eliptico', 'yoga', 'pesas', 'otro'];
  const activity = [];
  for (const a of Array.isArray(raw?.activity) ? raw.activity : []) {
    const min = num(pick(a, 'minutes', 'min')); const km = num(a.km); const steps = num(pick(a, 'steps', 'pasos')); const kcal = num(a.kcal);
    if (!(min > 0) && !(km > 0) && !(steps > 0) && !(kcal > 0)) continue;
    const rec = { date: fixDate(a.date), type: ACT_TYPES.includes(a.type) ? a.type : 'otro', min: min > 0 && min <= 600 ? Math.round(min) : 0, km: km > 0 && km <= 100 ? round1(km) : 0, steps: steps > 0 && steps <= 100000 ? Math.round(steps) : 0, note: a.detail ? String(a.detail).slice(0, 60) : '' };
    if (kcal > 0 && kcal <= 5000) { rec.kcal = Math.round(kcal); rec.manual = true; }
    if (a.from_device) { rec.source = 'reloj'; if (!rec.note) rec.note = 'reloj'; }
    activity.push(rec);
  }
  const sleep = [];
  const hm = (v) => (typeof v === 'string' && /^\d{1,2}[:.]\d{2}$/.test(v.trim()) ? v.trim().replace('.', ':').padStart(5, '0') : null);
  for (const x of Array.isArray(raw?.sleep) ? raw.sleep : []) {
    const bed = hm(x.bed); const wake = hm(x.wake); let h = num(x.hours);
    if (!(h > 0) && bed && wake) { const [a, b] = bed.split(':').map(Number); const [c, d] = wake.split(':').map(Number); h = (((c * 60 + d) - (a * 60 + b) + 1440) % 1440) / 60; }
    if (!(h > 0.5 && h <= 16)) continue;
    const q = Math.round(num(x.quality));
    sleep.push({ date: fixDate(x.date), hours: round1(h), bed, wake, quality: q >= 1 && q <= 5 ? q : 0 });
  }
  const skipped = [];
  for (const s of Array.isArray(raw?.skipped) ? raw.skipped : []) skipped.push({ date: fixDate(s.date), moment: fixMoment(s.moment) });
  const questions = (Array.isArray(raw?.questions) ? raw.questions : []).map(String).filter(Boolean).slice(0, 4);

  return {
    id: uid('d'), createdAt: Date.now(), groups, water, habits, gym, weight, study, activity, sleep, skipped, questions, warnings,
    transcript: typeof raw?.transcript === 'string' ? raw.transcript : '',
    meta: { ...meta },
  };
}

const UNIT_OK = new Set(UNIT_ENUM);
function normalizeItem(r, ctx, warnings) {
  if (!r || typeof r !== 'object') return null;
  const name = String(pick(r, 'name', 'nombre', 'alimento') || '').trim();
  if (!name) return null;
  let qty = num(pick(r, 'quantity', 'qty', 'cantidad'));
  let unit = canonUnit(pick(r, 'unit', 'unidad')) || String(pick(r, 'unit', 'unidad') || '').toLowerCase();
  if (unit === 'kg') { unit = 'g'; qty *= 1000; } else if (unit === 'l') { unit = 'ml'; qty *= 1000; }
  if (!UNIT_OK.has(unit)) unit = unit ? 'porcion' : 'g';
  let grams = num(pick(r, 'grams', 'gramos', 'peso', 'ml'));
  if (!(qty > 0)) qty = (unit === 'g' || unit === 'ml') && grams > 0 ? grams : 1;
  if ((unit === 'g' || unit === 'ml') && !(grams > 0)) grams = qty;
  const basisRaw = String(pick(r, 'basis', 'fuente') || 'estimacion');
  const confRaw = String(pick(r, 'confidence', 'confianza') || 'media');
  const item = {
    id: uid('i'), name, foodId: null, qty: round1(qty) || qty, unit,
    grams: grams > 0 ? round1(grams) : null, liq: isLiquid(name, unit),
    per100: null, fixed: null,
    basis: ['referencia', 'etiqueta', 'web', 'tabla', 'estimacion'].includes(basisRaw) ? basisRaw : 'estimacion',
    confidence: ['alta', 'media', 'baja'].includes(confRaw) ? confRaw : 'media',
    note: pick(r, 'assumption', 'supuesto', 'nota') ? String(pick(r, 'assumption', 'supuesto', 'nota')) : '',
    state: ['crudo', 'cocido', 'listo'].includes(r.state) ? r.state : undefined,
    flags: [],
  };
  const said = pick(r, 'said', 'dicho');
  if (said && typeof said === 'string' && said.trim()) item.said = said.trim().slice(0, 120);
  const src = pick(r, 'source', 'fuente_detalle');
  if (src && typeof src === 'string') item.sourceText = src.slice(0, 160);
  const prod = pick(r, 'producto', 'product');
  if (prod && typeof prod === 'string' && prod.trim().length > 2) item._lookup = prod.trim().slice(0, 80);

  // 1) Composición por 100 g informada por la IA (validada)
  const p100raw = readPer100(pick(r, 'per100', 'por100', 'nutrients'));
  if (p100raw && !(p100raw.al > 0) && ALCOHOL_RE.test(norm(name))) {
    // bebidas alcohólicas: la diferencia de energía es el alcohol (7 kcal/g), no un error
    const base = 4 * (p100raw.p || 0) + 4 * (p100raw.c || 0) + 9 * (p100raw.f || 0) + 2 * (p100raw.fb || 0);
    if (p100raw.kcal > base) p100raw.al = round1((p100raw.kcal - base) / 7);
  }
  if (p100raw) {
    const { per100, issues } = sanitizePer100(p100raw);
    item.per100 = per100;
    if (issues.includes('kcal_ajustadas')) item.flags.push({ type: 'ajuste', msg: 'Ajusté las calorías para que coincidan con los macros.' });
    if (issues.includes('valores_imposibles') || issues.includes('kcal_imposibles')) item.flags.push({ type: 'revisar', msg: 'Los valores por 100 g eran imposibles y se corrigieron: revisalos.' });
  }

  // 2) Ingredientes / receta
  const ingRaw = Array.isArray(r.ingredients) ? r.ingredients : [];
  const ingredients = [];
  for (const g of ingRaw) {
    const gg = num(g.grams);
    const pr = readPer100(g.per100);
    if (!(gg > 0) || !pr) continue;
    const { per100 } = sanitizePer100(pr);
    ingredients.push({ name: String(g.name || 'Ingrediente'), grams: round1(gg), per100 });
  }
  const fraction = num(r.fraction);
  if (ingredients.length) {
    const totG = ingredients.reduce((a, g) => a + g.grams, 0);
    const tot = ingredients.reduce((acc, g) => { const m = calc(g.per100, g.grams); for (const k of Object.keys(acc)) acc[k] += m[k]; return acc; }, { kcal: 0, p: 0, c: 0, f: 0, s: 0, fb: 0 });
    if (totG > 0) {
      item.ingredients = ingredients;
      if (fraction > 0 && fraction <= 1) {
        const eaten = scaleMacros(tot, fraction);
        if (!(item.grams > 0)) item.grams = round1(totG * fraction);
        item.per100 = { kcal: round1(eaten.kcal / item.grams * 100), p: round1(eaten.p / item.grams * 100), c: round1(eaten.c / item.grams * 100), f: round1(eaten.f / item.grams * 100), s: round1(eaten.s / item.grams * 100), fb: round1(eaten.fb / item.grams * 100) };
        item.fraction = round1(fraction * 1000) / 1000;
      } else {
        const comp = { kcal: round1(tot.kcal / totG * 100), p: round1(tot.p / totG * 100), c: round1(tot.c / totG * 100), f: round1(tot.f / totG * 100), s: round1(tot.s / totG * 100), fb: round1(tot.fb / totG * 100) };
        if (item.per100 && Math.abs(item.per100.kcal - comp.kcal) > Math.max(25, comp.kcal * 0.2)) {
          item.flags.push({ type: 'ajuste', msg: `Usé la suma de ingredientes (${round0(comp.kcal)} kcal/100 g) en vez del total estimado (${round0(item.per100.kcal)}).` });
        }
        item.per100 = comp;
        if (!(item.grams > 0)) item.grams = round1(totG);
      }
    }
  }

  // 3) Referencia del usuario (mismo alimento): valores calibrados
  const code = pick(r, 'ref', 'referencia');
  let ref = code && ctx.refs ? ctx.refs[String(code).trim()] : null;
  // si la IA apunta a una referencia que no tiene nada que ver con el nombre, se ignora
  if (ref && scoreTokens(tokens(name), tokens(ref.name)) === 0 && scoreTokens(tokens(ref.name), tokens(name)) === 0) {
    ref = null;
  }
  if (ref) {
    item.refLabel = ref.name;
    if (ref.foodId) item.foodId = ref.foodId;
    const sameUnit = (a, b) => a === b || ((a === 'porcion' || a === 'unidad') && (b === 'porcion' || b === 'unidad'));
    if (ref.perUnit && (sameUnit(ref.perUnit.unit, item.unit) || !ref.per100)) {
      const q = sameUnit(ref.perUnit.unit, item.unit) ? item.qty : 1;
      if (!sameUnit(ref.perUnit.unit, item.unit)) { item.qty = 1; item.unit = ref.perUnit.unit; }
      const m = scaleMacros(ref.perUnit, q);
      item.fixed = { kcal: round0(m.kcal), p: round1(m.p), c: round1(m.c), f: round1(m.f), s: round1(m.s), fb: round1(m.fb) };
      item.per100 = null;
      item.basis = 'referencia';
      if (item.grams && item.ingredients) delete item.ingredients;
    } else if (ref.per100) {
      item.per100 = { ...ref.per100 };
      item.basis = 'referencia';
      const ug = ref.units && ref.units[item.unit];
      if (ug && item.unit !== 'g' && item.unit !== 'ml') {
        const g = round1(item.qty * ug);
        if (item.grams && Math.abs(g - item.grams) / g > 0.3) item.note = [item.note, `Usé tu medida habitual: 1 ${unitLabel(item.unit)} = ${ug} g.`].filter(Boolean).join(' ');
        item.grams = g;
      }
      if (item.ingredients) delete item.ingredients;
    }
  }

  // 4) Sin composición: intentar con la biblioteca
  if (!item.per100 && !item.fixed) {
    const bm = bestMatch(name);
    if (bm && bm.score >= 0.8) {
      item.per100 = per100Of(bm.food); item.foodId = bm.food.id; item.basis = 'tabla';
      item.flags.push({ type: 'revisar', msg: `La IA no dio valores: usé "${bm.food.n}" de la biblioteca.` });
    } else {
      item.fixed = { kcal: 0, p: 0, c: 0, f: 0, s: 0, fb: 0 };
      item.flags.push({ type: 'sin_datos', msg: 'Sin valores nutricionales: completalos.' });
    }
  }

  // 5) Gramos faltantes
  if (item.per100 && !(item.grams > 0)) {
    const bm = bestMatch(name);
    const g = bm && bm.score >= 0.85 ? gramsFor(bm.food, item.qty, item.unit) : (GENERIC_UNIT_G[item.unit] ? item.qty * GENERIC_UNIT_G[item.unit] : null);
    if (g) { item.grams = round1(g); item.flags.push({ type: 'revisar', msg: `Sin peso: estimé ${round0(g)} g.` }); }
    else { item.grams = 100; item.flags.push({ type: 'revisar', msg: 'Sin peso: puse 100 g, corregilo.' }); }
  }

  // 6) Controles de plausibilidad contra la biblioteca
  if (item.per100 && item.basis !== 'referencia' && !item.ingredients) {
    const bm = bestMatch(name);
    if (bm && bm.score >= 0.95 && bm.food.k > 30) {
      const ratio = item.per100.kcal / bm.food.k;
      if (ratio > 1.7 || ratio < 0.5) item.flags.push({ type: 'valores', msg: `Tu biblioteca tiene ${bm.food.k} kcal/100 g para "${bm.food.n}".`, foodId: bm.food.id });
      if (item.unit !== 'g' && item.unit !== 'ml' && hasOwnUnit(bm.food, item.unit) && item.grams) {
        const lg = gramsFor(bm.food, item.qty, item.unit);
        if (lg && (item.grams / lg > 1.9 || item.grams / lg < 0.45)) item.flags.push({ type: 'porcion', msg: `Normalmente ${round1(item.qty)} ${unitLabel(item.unit, item.qty)} ≈ ${round0(lg)} g.`, grams: round0(lg) });
      }
    }
  }
  // ¿valores por unidad en vez de por 100 g?
  if (item.per100 && item.grams > 150 && item.per100.kcal > 450 && !/(chocolate|bombon|mani|nuez|nueces|almendra|frutos secos|aceite|manteca|galletit|alfajor|chips|papas fritas de paquete|granola|semilla|queso rallado|mayonesa|grasa|panceta|tocino|salame)/.test(norm(name))) {
    item.flags.push({ type: 'revisar', msg: `${round0(item.per100.kcal)} kcal cada 100 g es mucho para esto: ¿los valores eran por unidad?` });
  }
  const m = store.itemMacros(item);
  if (m.kcal > 2500) item.flags.push({ type: 'revisar', msg: `${m.kcal} kcal en un solo alimento: revisá la cantidad.` });
  if (item.grams > 3000) item.flags.push({ type: 'revisar', msg: 'El peso parece demasiado alto.' });
  if (item.confidence === 'baja' && !item.flags.length && !item.note) item.note = 'Estimación con poca información.';
  if (!item.flags.length) delete item.flags;
  return item;
}

/** Totales del borrador */
export function draftTotals(draft) {
  const all = [];
  for (const g of draft.groups) for (const it of g.items) all.push(store.itemMacros(it));
  return store.sumMacros(all);
}
export function groupTotals(g) { return store.sumMacros(g.items.map(store.itemMacros)); }

// ---------------------------------------------------------------------------
// Análisis principal
// ---------------------------------------------------------------------------
/**
 * Analiza texto (y opcionalmente imagen/audio).
 * opts: { text, image:{mime,data}, audio:{mime,data}, baseDate, baseMoment, previous, correction, web, onStatus }
 */
export async function analyze(opts) {
  const S = store.S();
  const ai = S.settings.ai;
  const ctx = opts.ctx || buildContext({ baseDate: opts.baseDate, baseMoment: opts.baseMoment });
  const userText = buildUserText(opts.text || '', ctx, { previous: opts.previous, correction: opts.correction, hasImage: !!opts.image, hasAudio: !!opts.audio });
  const parts = [{ text: userText }];
  if (opts.image) parts.push({ kind: 'image', mime: opts.image.mime || 'image/jpeg', data: opts.image.data });
  if (opts.audio) parts.push({ kind: 'audio', mime: opts.audio.mime || 'audio/wav', data: opts.audio.data });
  const web = opts.web ?? ai.web !== false;
  let res;
  try {
    res = await callGemini({ ai, system: SYSTEM_PROMPT, parts, web, onStatus: opts.onStatus });
  } catch (err) {
    store.S().aiLog.unshift({ at: Date.now(), ok: false, code: err.code, msg: err.message, log: err.log || [] });
    store.S().aiLog.length = Math.min(store.S().aiLog.length, 30);
    throw err;
  }
  const draft = normalizeDraft(res.raw, ctx, { engine: 'ia', model: res.model, endpoint: res.endpoint, web: res.web, ms: res.ms, sources: res.sources, tries: res.log, input: opts.text || res.raw?.transcript || '' });
  draft.raw = res.raw;
  if (opts.lookup !== false) { try { await enrichProducts(draft, opts.onStatus); } catch (e) { console.warn('Open Food Facts', e); } }
  // las fuentes web se adjuntan a los ítems que se buscaron en la web
  if (res.sources?.length) for (const g of draft.groups) for (const it of g.items) if (it.basis === 'web') it.sources = res.sources.slice(0, 3);
  if (!res.web) for (const g of draft.groups) for (const it of g.items) if (it.basis === 'web') it.basis = 'tabla'; // sin búsqueda real no es dato web
  store.S().aiLog.unshift({ at: Date.now(), model: res.model, endpoint: res.endpoint, ms: res.ms, web: res.web, ok: true, log: res.log });
  store.S().aiLog.length = Math.min(store.S().aiLog.length, 30);
  return draft;
}

// ---------------------------------------------------------------------------
// Metas a partir de lo que cuenta la persona ("tengo 30 años, peso 80, quiero bajar…")
// ---------------------------------------------------------------------------
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    sex: { type: 'string', enum: ['m', 'f'] }, age: { type: ['number', 'null'] }, heightCm: { type: ['number', 'null'] }, weightKg: { type: ['number', 'null'] },
    goalWeightKg: { type: ['number', 'null'] }, weeks: { type: ['number', 'null'], description: 'Semanas en que quiere lograr el peso objetivo' }, rateKgMonth: { type: ['number', 'null'], description: 'Kg por mes que quiere subir o bajar, si lo dice' },
    goal: { type: 'string', enum: ['bajar', 'recomp', 'mantener', 'subir'] },
    level: { type: 'string', enum: ['sedentario', 'ligero', 'moderado', 'alto'] },
    gymDays: { type: ['number', 'null'] },
    kcal: { type: 'number' }, protein: { type: 'number' }, carbs: { type: 'number' }, fat: { type: 'number' },
    sugarMax: { type: 'number' }, waterMl: { type: 'number' },
    diet: { type: 'string', enum: ['sin_especificar', 'omnivora', 'vegetariana', 'vegana', 'carnivora', 'keto', 'low_carb', 'mediterranea', 'alta_proteina', 'sin_gluten'] }, conditions: { type: 'array', items: { type: 'string', enum: ['diabetes', 'prediabetes', 'hipertension', 'colesterol', 'hipotiroidismo', 'higado_graso', 'renal', 'gota', 'celiaquia', 'embarazo', 'lactancia', 'tca'] } }, proteinPerKg: { type: ['number', 'null'] }, proteinG: { type: ['number', 'null'] }, carbsMax: { type: ['number', 'null'] }, preferences: { type: 'string' },
    explanation: { type: 'string' }, missing: { type: 'array', items: { type: 'string' } }, caution: { type: 'string' },
  },
  required: ['sex', 'goal', 'level', 'explanation'],
};
const PLAN_PROMPT = `Sos nutricionista. Tu tarea principal es ENTENDER BIEN los datos de la persona a partir de lo que cuenta (español de Argentina, puede venir dictado): sexo, edad, altura, peso, peso objetivo, objetivo, nivel de actividad y días de gimnasio. La app calcula las metas con su propia fórmula a partir de esos datos.
- Altura en cm (\"1,60\" = 160). Peso en kg. Si dice la edad o el año de nacimiento, devolvé la edad.
- goal: bajar (bajar de peso o grasa), recomp (bajar grasa y ganar músculo, entrenando fuerza), mantener, subir (ganar peso o masa muscular).
- level, según su vida diaria y ejercicio: sedentario (trabajo sentado, sin ejercicio o casi), ligero (camina o entrena 1 a 3 veces por semana), moderado (entrena 3 a 5 veces), alto (6 a 7 veces o trabajo físico pesado). Si no lo dice, sedentario o ligero según el contexto, y ponelo en missing.
- gymDays: días por semana que entrena fuerza o va al gimnasio (0 si no va).
- Peso objetivo y plazo: si dice "quiero llegar a 75 kg en 6 meses" → goalWeightKg 75 y weeks 26 (1 mes = 4,35 semanas). Si dice un ritmo y un plazo ("subir 2 o 3 kg por mes durante 5 meses") → rateKgMonth 2,5, weeks 22 y goalWeightKg = peso actual + 2,5 × 5. Si solo dice el ritmo, rateKgMonth y weeks null. Si no dice nada de eso, todo null. Anotá lo que pide aunque sea muy rápido: la app lo limita a un ritmo sano.
- Completá también kcal, protein, carbs, fat, sugarMax y waterMl con una estimación razonable: déficit del 20 % para bajar (nunca menos de 1.200 kcal en mujeres ni 1.500 en hombres); proteína 1,2-1,6 g por kg (1,6-2,0 si entrena fuerza), usando el peso ajustado si tiene sobrepeso; grasas 25-35 % de las calorías; carbohidratos el resto, de modo que 4·proteína + 4·carbohidratos + 9·grasas = kcal.
- diet: la forma de comer que elige o necesita: vegetariana, vegana, carnivora (solo carne y productos animales), keto, low_carb (baja en carbohidratos), mediterranea, alta_proteina, sin_gluten u omnivora (come de todo). Si no dice nada, sin_especificar.
- conditions: enfermedades o situaciones que menciona (diabetes, prediabetes o resistencia a la insulina, hipertension, colesterol o triglicéridos, hipotiroidismo, higado_graso, renal, gota o ácido úrico, celiaquia, embarazo, lactancia, tca = trastorno alimentario). Solo las que dice; nunca las supongas.
- proteinPerKg / proteinG: solo si dice cuánta proteína quiere ("2 a 2,2 g por kilo" → 2,1; "180 g de proteína" → proteinG 180).
- carbsMax: solo si pide un máximo de carbohidratos por día ("no más de 50 g de carbos" → 50).
- preferences: una frase corta con gustos, rechazos, alergias o costumbres para tener en cuenta al analizar sus comidas y sugerirle qué comer ("No come cerdo. Alergia al maní. Prefiere 4 comidas por día."). Cadena vacía si no hay.
- missing: los datos que tuviste que suponer (\"edad\", \"altura\", \"nivel de actividad\"…). No inventes condiciones médicas.
- caution: solo si menciona una enfermedad (diabetes, hipotiroidismo, hipertensión, renal…), embarazo, lactancia, menos de 18 años, un trastorno de la alimentación o un objetivo extremo: una frase recomendando hacerlo con un profesional. Si no, cadena vacía.
- explanation: una frase con lo que entendiste (\"Mujer de 53 años, 1,60 m y 90 kg, sedentaria, quiere bajar de peso\").
Respondé solo el JSON.`;

export async function planGoals(text, { onStatus } = {}) {
  const ai = store.S().settings.ai;
  const res = await callGemini({ ai, system: PLAN_PROMPT, parts: [{ text: `Hoy es ${todayISO()}.\nLo que cuenta la persona:\n"""${text}"""` }], web: false, schema: PLAN_SCHEMA, onStatus });
  return res.raw;
}

// ---------------------------------------------------------------------------
// Etiquetas reales de productos envasados (Open Food Facts, base abierta y gratuita)
// ---------------------------------------------------------------------------
const OFF_URL = 'https://world.openfoodfacts.org/cgi/search.pl';
const offCache = new Map();
export async function searchProduct(query, { timeout = 7000 } = {}) {
  const q = String(query || '').trim();
  if (q.length < 3) return null;
  const key = norm(q);
  if (offCache.has(key)) return offCache.get(key);
  const url = `${OFF_URL}?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=12&fields=code,product_name,product_name_es,generic_name_es,brands,nutriments,countries_tags,quantity,serving_quantity`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  let out = null;
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    const qt = tokens(q);
    let best = null;
    for (const p of j.products || []) {
      const n = p.nutriments || {};
      const kcal = n['energy-kcal_100g'] ?? (n.energy_100g ? n.energy_100g / 4.184 : null);
      if (!(kcal > 0) || n.proteins_100g == null || n.carbohydrates_100g == null || n.fat_100g == null) continue;
      const name = p.product_name_es || p.product_name || p.generic_name_es || '';
      const brand = String(p.brands || '').split(',')[0].trim();
      const ct = tokens(`${name} ${brand}`);
      let sc = Math.max(scoreTokens(qt, ct), scoreTokens(ct, qt) * 0.9);
      if (!sc) continue;
      if ((p.countries_tags || []).includes('en:argentina')) sc += 0.15;
      if (!best || sc > best.sc) best = { sc, p, name, brand, kcal };
    }
    if (best && best.sc >= 0.55) {
      const n = best.p.nutriments;
      out = {
        name: best.name, brand: best.brand, code: best.p.code, score: round1(best.sc),
        per100: { kcal: round1(best.kcal), p: round1(n.proteins_100g || 0), c: round1(n.carbohydrates_100g || 0), f: round1(n.fat_100g || 0), s: round1(n.sugars_100g || 0), fb: round1(n.fiber_100g || 0) },
        serving: Number(best.p.serving_quantity) || null,
        url: `https://world.openfoodfacts.org/product/${best.p.code}`,
      };
    }
  } catch { out = null; } finally { clearTimeout(t); }
  offCache.set(key, out);
  return out;
}

/** Reemplaza los valores estimados de productos de marca por los de su etiqueta, si se encuentra. */
export async function enrichProducts(draft, onStatus = () => {}) {
  const items = draft.groups.flatMap((g) => g.items).filter((it) => it._lookup && it.basis !== 'referencia' && it.basis !== 'etiqueta' && it.per100);
  if (!items.length || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  onStatus(items.length === 1 ? `Buscando la etiqueta de ${items[0]._lookup}…` : `Buscando ${items.length} etiquetas…`);
  const found = await Promise.all(items.slice(0, 5).map((it) => searchProduct(it._lookup)));
  items.slice(0, 5).forEach((it, i) => {
    const f = found[i];
    if (!f) return;
    const est = it.per100?.kcal || 0;
    // si la etiqueta encontrada no se parece en nada a lo esperado, no se usa
    if (est > 0 && (f.per100.kcal > est * 1.8 || f.per100.kcal < est * 0.45) && f.score < 0.9) return;
    const { per100 } = sanitizePer100({ ...f.per100 });
    it.per100 = per100;
    it.basis = 'etiqueta';
    it.flags = (it.flags || []).filter((x) => x.type !== 'valores' && x.type !== 'ajuste');
    it.sourceText = `Etiqueta: ${f.name}${f.brand ? ' (' + f.brand + ')' : ''} · Open Food Facts`;
    it.sources = [{ t: `${f.name}${f.brand ? ' · ' + f.brand : ''}`, u: f.url }];
  });
  for (const it of items) delete it._lookup;
}

// ---------------------------------------------------------------------------
// Respaldo sin conexión: estructura (fechas, comidas, agua, hábitos, gym) + biblioteca
// ---------------------------------------------------------------------------
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const MOMENT_RE = /\b(post ?cena|colacion nocturna|media manana|media tarde|pre ?entreno|post ?entreno|despues de entrenar|despues del gym|desayuno|desayune|almuerzo|almorce|merienda|meriende|merende|cena|cene|colacion|a la noche|al mediodia|a la tarde|a la manana|por la manana|anoche)\b/g;
const DATE_RE = /\b(anteayer|antes de ayer|anoche|ayer|hoy|manana|el (lunes|martes|miercoles|jueves|viernes|sabado|domingo))\b/g;
const QTYW = '(\\d+(?:[.,]\\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|medio|media)';
const MUSCLES = 'pecho|espalda|pierna|piernas|brazos?|hombros?|torso|biceps|triceps|gluteos?|full body|cardio|abdominales?|abdomen|cuadriceps|femorales';

function qtyVal(w) { const n = num(w); return Number.isFinite(n) ? n : (numberWord(w) ?? 1); }
function momentWord(w) {
  if (w === 'a la noche' || w === 'anoche') return 'cena';
  if (w === 'a la tarde') return 'merienda';
  if (w === 'a la manana' || w === 'por la manana') return 'desayuno';
  return store.matchMoment(w);
}

export function preprocessDictation(text) {
  let t = ' ' + norm(String(text || '').replace(/\([^)]*\)/g, ' ')) + ' ';
  t = t.replace(/\b(eh+|em+|mm+|este|bueno|o sea|digamos|osea)\b/g, ' ');
  t = t.replace(/\bmas o menos\b|\baproximadamente\b/g, 'aprox');
  // autocorrecciones numéricas: "80 no, 70 g" / "80 g, no, 70"
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*(?:g|gr|gramos|ml)?\s*,?\s*no\s*,?\s*(?:en realidad\s*,?\s*)?(\d+(?:[.,]\d+)?)/g, '$2');
  return t.replace(/\s+/g, ' ');
}

export function analyzeOffline(text, ctx = buildContext()) {
  const t = preprocessDictation(text);
  const today = ctx.today;
  const markers = [];
  let m;
  DATE_RE.lastIndex = 0;
  while ((m = DATE_RE.exec(t))) {
    const w = m[1];
    const before = t.slice(Math.max(0, m.index - 7), m.index);
    if (/\b(de|del)\s$/.test(before) && w !== 'hoy') continue; // "el bizcochuelo de ayer" no cambia la fecha
    if (w === 'manana' && /\b(media|la|de)\s$/.test(before)) continue; // "media mañana", "a la mañana"
    let date = ctx.baseDate;
    if (w === 'hoy') date = today;
    else if (w === 'ayer' || w === 'anoche') date = addDays(today, -1);
    else if (w === 'anteayer' || w === 'antes de ayer') date = addDays(today, -2);
    else if (w === 'manana') date = addDays(today, 1);
    else if (m[2]) { const wd = WEEKDAYS.indexOf(m[2]); let d = addDays(today, -1); for (let i = 0; i < 7 && parseISO(d).getDay() !== wd; i++) d = addDays(d, -1); date = d; }
    markers.push({ at: m.index, end: m.index + m[0].length, date, moment: w === 'anoche' ? 'cena' : undefined });
  }
  MOMENT_RE.lastIndex = 0;
  while ((m = MOMENT_RE.exec(t))) {
    if (m[1] === 'anoche') continue; // ya está como fecha + cena
    const before = t.slice(Math.max(0, m.index - 7), m.index);
    if (/\b(de|del)\s$/.test(before) && /cena|almuerzo|desayuno|merienda/.test(m[1]) && !/^\s*(de|del)\s$/.test(before.trim() ? before.slice(-4) : '')) {
      // "de cena", "de desayuno" sí cambian el momento: solo se ignora "lo que sobró del almuerzo de ayer"
      if (/\b(sobro|resto|lo)\s+(de|del)\s$/.test(t.slice(Math.max(0, m.index - 16), m.index))) continue;
    }
    const mo = momentWord(m[1]);
    if (mo) markers.push({ at: m.index, end: m.index + m[0].length, moment: mo });
  }
  markers.sort((a, b) => a.at - b.at);

  const draftRaw = { items: [], water: [], habits: [], gym: [], weight: [], study: [], activity: [], sleep: [], skipped: [], questions: [] };
  const offlineItems = [];
  const recipe = parseRecipeSentence(t, ctx);
  if (recipe) {
    offlineItems.push({ date: recipe.date || ctx.baseDate, moment: recipe.moment || ctx.defaultMoment, it: recipe.item });
    return finishOffline(draftRaw, offlineItems, ctx, text);
  }
  let date = ctx.baseDate; let moment = ctx.defaultMoment; let pos = 0;
  const chunks = [];
  for (const mk of markers) {
    if (mk.at > pos) chunks.push({ text: t.slice(pos, mk.at), date, moment, at: pos });
    if (mk.date) date = mk.date;
    if (mk.moment) moment = mk.moment;
    pos = mk.end;
  }
  chunks.push({ text: t.slice(pos), date, moment, at: pos });
  // fecha al final ("me olvidé la creatina ayer", "comí 2 empanadas ayer"): vale para lo anterior
  const lastMk = markers[markers.length - 1];
  if (chunks.length >= 2 && lastMk && lastMk.date && !lastMk.moment && isJunkText(chunks[chunks.length - 1].text || 'x')) {
    const prev = chunks[chunks.length - 2];
    const prevMk = markers[markers.length - 2];
    if (!prevMk || !prevMk.date || prevMk.end <= prev.at) {
      if (!markers.slice(0, -1).some((x) => x.date)) prev.date = lastMk.date;
    }
  }
  const totalMode = /\b(en total|total del dia|en todo el dia)\b/.test(t);

  for (const ch of chunks) {
    let s = ' ' + ch.text + ' ';
    // agua
    s = s.replace(new RegExp(`${QTYW}\\s+(vasos?|botellas?|litros?|l)\\s+(?:mas\\s+)?(?:de\\s+)?agua`, 'g'), (all, q, u) => {
      const k = qtyVal(q);
      const ml = /vaso/.test(u) ? k * ctx.glassMl : /botella/.test(u) ? k * 500 : k * 1000;
      draftRaw.water.push({ date: ch.date, ml, mode: totalMode ? 'fijar' : 'sumar' });
      return ' ';
    });
    s = s.replace(/\b(\d+)\s*ml\s+de\s+agua\b/g, (all, q) => { draftRaw.water.push({ date: ch.date, ml: Number(q), mode: totalMode ? 'fijar' : 'sumar' }); return ' '; });
    // peso corporal
    s = s.replace(/\b(?:me pese|pese|peso|pesaba|me peso)\s*(?:en ayunas\s*)?(\d{2,3}(?:[.,]\d+)?)\s*(?:kg|kilos)?(?:\s*en ayunas)?\b/g, (all, kg) => { draftRaw.weight.push({ date: ch.date, kg: num(kg) }); return ' '; });
    // actividad: "caminé 40 minutos", "hice 8000 pasos", "corrí 5 km"
    s = s.replace(/\b(?:(?:sali a |fui a )?(camine|caminamos|caminata de|corri|sali a correr|anduve en bici|hice bici|pedalee|nade)\s+(?:unos?\s+|como\s+)?|hice\s+(?:unos?\s+)?)(\d+(?:[.,]\d+)?)\s*(minutos?|min|horas?|hs|km|kilometros?|pasos)\b/g, (all, verb, q, u) => {
      const v = num(q);
      const type = !verb ? 'caminata' : /corr/.test(verb) ? 'correr' : /bici|pedal/.test(verb) ? 'bici' : /nade/.test(verb) ? 'natacion' : 'caminata';
      const a = { date: ch.date, type, minutes: null, km: null, steps: null };
      if (/^(minutos?|min)$/.test(u)) a.minutes = v; else if (/^(horas?|hs)$/.test(u)) a.minutes = v * 60; else if (/^(km|kilometros?)$/.test(u)) a.km = v; else a.steps = v;
      if (!verb && !a.steps) return all;
      draftRaw.activity.push(a);
      return ' ';
    });
    // sueño: "dormí 7 horas", "dormí 6 horas y media"
    s = s.replace(/\b(?:dormi|dormimos)\s+(?:unas?\s+|como\s+)?(\d+(?:[.,]\d+)?|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s*(?:horas?|hs)(\s+y\s+media)?\b(?:\s+(bien|mal|muy bien|muy mal|re bien|re mal|como el orto|para el orto))?/g, (all, q, half, how) => {
      const h = qtyVal(q) + (half ? 0.5 : 0);
      const quality = !how ? 0 : /muy bien|re bien/.test(how) ? 5 : /bien/.test(how) ? 4 : /muy mal|re mal|orto/.test(how) ? 1 : 2;
      if (h > 0.5 && h <= 16) draftRaw.sleep.push({ date: ch.date, hours: h, quality });
      return ' ';
    });
    // horas de estudio
    s = s.replace(/\bestudi(?:e|o|ando)?\s+(?:durante\s+|por\s+)?(?:(\d+(?:[.,]\d+)?|una|dos|tres|cuatro|cinco|seis)\s+horas?(?:\s+y\s+media)?|media\s+hora)\b/g, (all, q) => {
      let h = q ? qtyVal(q) : 0.5;
      if (/y media/.test(all)) h += 0.5;
      draftRaw.study.push({ date: ch.date, hours: h });
      return ' ';
    });
    // gimnasio (la última mención manda)
    const setGym = (status, detail) => {
      const i = draftRaw.gym.findIndex((g) => g.date === ch.date);
      if (i >= 0) { draftRaw.gym[i].status = status; if (detail) draftRaw.gym[i].detail = detail; } else draftRaw.gym.push({ date: ch.date, status, detail: detail || null });
    };
    s = s.replace(new RegExp(`\\b(?:hice|entrene|entreno|trabaje)\\s+((?:${MUSCLES})(?:\\s+(?:y|con|e)\\s+(?:${MUSCLES}))*)`, 'g'), (all, det) => { setGym('fui', det); return ' '; });
    s = s.replace(/\b(?:pon(?:e|gas)? que\s+)?(no\s+)?(?:fui|fue|voy|fuimos|entrene|entreno)\s+(?:al\s+)?(?:gimnasio|gym|gimnacio)\b|\bdia de descanso\b|\bdescans[eo]\b/g, (all, neg) => {
      setGym(/descans/.test(all) ? 'descanso' : neg ? 'no_fui' : 'fui');
      return ' ';
    });
    s = s.replace(/\b(no,?\s+)?en realidad\s+(si|no),?\s*/g, ' ');
    s = s.replace(/\b(porque|ya que|asi que)\b[^,.;]*/g, ' ');
    // hábitos y suplementos
    for (const h of ctx.habits) {
      for (const a of [h.name, ...(h.aliases || [])]) {
        const re = new RegExp(`\\b(no\\s+(?:me\\s+)?(?:tome|tomo|hice)\\s+(?:la\\s+|el\\s+|las\\s+)?|me olvide (?:de\\s+)?(?:la\\s+|el\\s+|las\\s+)?|(?:tome|tomo|tomae|hice|si)\\s+(?:la\\s+|el\\s+|las\\s+)?)?${norm(a)}\\b`, 'g');
        s = s.replace(re, (all, pre) => {
          const done = !(pre && /^(no|me olvide)/.test(pre));
          const i = draftRaw.habits.findIndex((x) => x.date === ch.date && x.habit === h.name);
          if (i >= 0) draftRaw.habits[i].done = done; else draftRaw.habits.push({ date: ch.date, habit: h.name, done });
          return ' ';
        });
      }
    }
    // comidas salteadas ("no pongas nada de desayuno")
    if (/\b(no pongas nada|nada de|no desayune|no almorce|no cene|no meriende|saltee)\b/.test(s) && !/[a-z]{4,}/.test(s.replace(/\b(no pongas nada|nada de|nada|no desayune|no almorce|no cene|no meriende|saltee|pone|para|pon|al|de|no|que)\b/g, ''))) {
      draftRaw.skipped.push({ date: ch.date, moment: ch.moment });
      continue;
    }
    // limpiar instrucciones (sin tocar los separadores y / con / más)
    s = s.replace(/\b(pone|pon|poner|pongas|agrega|agregar|agregale|anota|anotar|registra|registrar|despues|luego|tambien|ademas|me comi|comi|me tome|tome|tomae|para|que|nada|no pongas|de postre|postre|en ayunas)\b/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    if (!s || s.length < 3 || !/[a-z]{3,}/.test(s)) continue;
    for (const it of parseLocal(s, { usage: store.S().usage, refs: ctx.refs })) {
      if (/^(agua|gimnasio|gym)$/.test(norm(it.name))) continue;
      offlineItems.push({ date: ch.date, moment: ch.moment, it });
    }
  }
  return finishOffline(draftRaw, offlineItems, ctx, text);
}

// ---------------------------------------------------------------------------
// IA propia: ¿el análisis local entendió TODO el mensaje? Entonces se resuelve al instante,
// sin gastar consultas de Gemini. Es conservador: ante cualquier palabra sin explicar, va a Gemini.
// ---------------------------------------------------------------------------
const CONTEXT_WORDS = new Set(('desayuno desayune almuerzo almorce almuerce merienda meriende merende cena cene colacion media manana tarde noche anoche mediodia '
  + 'post pre entreno entrenamiento entrenar entrene hoy ayer anteayer lunes martes miercoles jueves viernes sabado domingo comi comimos tome tomamos '
  + 'desayunamos almorzamos cenamos me nos poneme pone agrega agregame anota anotame registra hice prepare cocine hecho hecha casero casera caseros caseras '
  + 'litro litros vaso vasos botella botellas agua gimnasio gym fui descanso descanse dia pese kilo kilos kg ml cc gramo gramos aprox dormi dormimos hora horas bien mal muy '
  + 'chico chica grande mediano mediana porcion porciones unidad unidades plato platos').split(' '));
export function localVerdict(draft, text, ctx = null) {
  const items = draft.groups.flatMap((g) => g.items);
  const extras = draft.water.length + draft.habits.length + draft.gym.length + draft.weight.length + (draft.study || []).length + (draft.activity || []).length + (draft.sleep || []).length;
  if (!items.length && !extras) return { ok: false, reason: 'no entendí nada' };
  for (const it of items) {
    if (it.flags?.some((f) => f.type === 'sin_datos') || !(it.per100 || it.fixed)) return { ok: false, reason: `no conozco "${it.name}"` };
    if (it.confidence === 'baja') return { ok: false, reason: `poca confianza en "${it.name}"` };
    if (/Incluye "/.test(it.note || '')) return { ok: false, reason: 'hay ingredientes sin datos' };
    if (it.per100 && !(it.grams > 0)) return { ok: false, reason: `sin cantidad para "${it.name}"` };
    if (it.per100 && it.grams < 5) return { ok: false, reason: `cantidad dudosa para "${it.name}"` };
    if (it.match != null && it.match < 0.85) return { ok: false, reason: `no estoy seguro de que sea "${it.name}"` };
  }
  // palabras del mensaje que no quedaron explicadas por ningún alimento ni dato reconocido
  const known = new Set();
  const add = (str) => { for (const w of tokens(str)) known.add(w); };
  for (const it of items) {
    add(it.name);
    const f = it.foodId ? getFood(it.foodId) : null;
    if (f) { add(f.n); for (const a of f.a || []) add(a); }
    if (it.refLabel) add(it.refLabel);
  }
  for (const h of (ctx?.habits || [])) { add(h.name); for (const a of h.aliases || []) add(a); }
  for (const m of (ctx?.moments || [])) add(m.name);
  for (const g of draft.gym) if (g.detail) add(g.detail);
  for (const a of draft.activity || []) add(`${a.type} ${a.note || ''}`);
  const t = preprocessDictation(text);
  const leftovers = [];
  for (const w of tokens(t)) {
    if (w.length < 3 || /^\d/.test(w) || known.has(w) || isJunkWord(w) || isUnitWord(w) || CONTEXT_WORDS.has(w) || numberWord(w) != null) continue;
    if ([...known].some((k) => k.length > 3 && w.length > 3 && (k.startsWith(w) || w.startsWith(k)))) continue;
    if (/^(camine|caminamo|caminata|corri|nade|pedalee|paso|minuto|min|hora|estudie|estudio|estudiando|entrene|entreno|olvide|pese|fue|tomae|comio|cenamo)$/.test(w)) continue; // verbos de registro
    leftovers.push(w);
  }
  if (leftovers.length) return { ok: false, reason: `no entendí: ${leftovers.slice(0, 4).join(', ')}` };
  return { ok: true };
}

const NUMW = '(\\d+(?:[.,]\\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|doce|media|medio)';
/** "hice un bizcochuelo con 3 huevos, 200 g de harina… lo corté en 8 y comí 2" → un ítem con la fracción comida */
function parseRecipeSentence(t, ctx) {
  const re = new RegExp(`\\b(?:hice|prepare|cocine)\\s+(?:un|una)\\s+([a-z ]{3,40}?)\\s+con\\s+(.+?)\\s*(?:\\.|,)?\\s*(?:lo|la)\\s+(?:corte|dividi|parti|separe)\\s+en\\s+${NUMW}\\b(.*?)\\b(?:comi|me comi)\\s+${NUMW}`);
  const m = t.match(re);
  if (!m) return null;
  const dish = m[1].trim();
  const parts = qtyVal(m[3]);
  const eaten = qtyVal(m[5]);
  if (!(parts > 0) || !(eaten > 0)) return null;
  const ings = parseLocal(m[2], { usage: store.S().usage });
  const known = ings.filter((i) => i.per100 && i.grams);
  if (!known.length) return null;
  const tot = store.sumMacros(known.map((i) => calc(i.per100, i.grams)));
  const totG = known.reduce((a, i) => a + i.grams, 0);
  const frac = Math.min(1, eaten / parts);
  const grams = round1(totG * frac);
  const per100 = { kcal: round1(tot.kcal / totG * 100), p: round1(tot.p / totG * 100), c: round1(tot.c / totG * 100), f: round1(tot.f / totG * 100), s: round1(tot.s / totG * 100), fb: round1(tot.fb / totG * 100) };
  const after = t.slice(m.index);
  let moment = null;
  const mm = after.match(MOMENT_RE);
  if (mm) moment = momentWord(mm[0]);
  return {
    moment,
    item: {
      name: dish.charAt(0).toUpperCase() + dish.slice(1) + ' casero', qty: eaten, unit: 'porcion', grams, per100, liq: false, basis: 'tabla', confidence: 'media',
      note: `Receta de ${known.length} ingredientes dividida en ${parts}: comiste ${eaten}.${ings.length > known.length ? ' Faltan ingredientes sin datos.' : ''}`,
      ingredients: known.map((i) => ({ name: i.name, grams: i.grams, per100: i.per100 })),
    },
  };
}

function finishOffline(draftRaw, offlineItems, ctx, text) {
  // armar borrador con el mismo formato que la IA
  const draft = normalizeDraft(draftRaw, ctx, { engine: 'local', input: text });
  const groupFor = (d, mo) => {
    let g = draft.groups.find((x) => x.date === d && x.moment === mo);
    if (!g) { g = { date: d, moment: mo, items: [] }; draft.groups.push(g); }
    return g;
  };
  for (const { date: d, moment: mo, it } of offlineItems) {
    const item = { id: uid('i'), name: it.name, foodId: it.foodId || null, qty: it.qty, unit: it.unit, grams: it.grams, liq: it.liq, per100: it.per100 || null, fixed: it.fixed || (it.per100 ? null : { kcal: 0, p: 0, c: 0, f: 0, s: 0, fb: 0 }), basis: it.basis === 'sin_datos' ? 'estimacion' : it.basis === 'referencia' ? 'referencia' : 'tabla', confidence: it.confidence, note: it.note || '' };
    if (it.match != null) item.match = it.match;
    if (it.ingredients) item.ingredients = it.ingredients;
    if (it.basis === 'sin_datos') item.flags = [{ type: 'sin_datos', msg: 'No está en tu biblioteca: completá los valores o analizalo con IA.' }];
    groupFor(d, mo).items.push(item);
  }
  draft.groups.sort((a, b) => a.date.localeCompare(b.date) || store.momentIndex(a.moment) - store.momentIndex(b.moment));
  return draft;
}

// ---------------------------------------------------------------------------
// Banco de pruebas: mensajes reales y nuevos con resultados esperados
// ---------------------------------------------------------------------------
// day: 0 = hoy, -1 = ayer. kcal: rango aceptable [mín, máx] del momento.
export const TEST_CASES = [
  {
    id: 't1', title: 'Tus empanadas + merienda + creatina',
    text: 'Almuerzo seis empanadas caseras con masa hojaldre. Merienda medio paquete de galletas Traviata Rex y 170 g de banana, 65 g de avena instantánea Quaker, 40 g de mantequilla de maní, 250 ml de leche proteica con dos cucharaditas de azúcar y tomae la creatina.',
    expect: {
      groups: [{ day: 0, moment: 'almuerzo', kcal: [1100, 2300] }, { day: 0, moment: 'merienda', kcal: [850, 1550], items: [5, 8] }],
      habits: [{ day: 0, id: 'creatina', done: true }], water: [], gym: [],
    },
  },
  {
    id: 't2', title: 'Dictado de dos días con correcciones',
    text: 'En media tarde ayer agrega unos tres bombones de chocolate. Eh, de cena bondiola de cerdo, un plato de bondiola de cerdo, eh medio paquete de puré instantáneo. Eh, un bollo de pan francés, más o menos 70 g. Una cucharada de mayonesa. Eh, agrega unos tres vasos más de agua y pon que no fue al gimnasio. Eh, no, en realidad sí, no fue al gimnasio. Después para hoy pone desayuno, nada, no pongas nada de desayuno, pone al almuerzo, media taza de arroz con eh carne, más o menos 150 g, con una salsa de arvejas y puré de tomate. Eh, con una cucharada de aceite de oliva. Luego en media tarde pone una banana, eh dos vasos de agua y un café. Eh, después en merienda pone cuatro huevos en sartén sin aceite y un pan francés 80 g. Después eh 80 no, 70 g de queso cremoso y dos cucharadas de puré de tomate.',
    expect: {
      groups: [
        { day: -1, moment: 'media_tarde', kcal: [150, 400] },
        { day: -1, moment: 'cena', kcal: [700, 1450] },
        { day: 0, moment: 'almuerzo', kcal: [450, 1100] },
        { day: 0, moment: 'media_tarde', kcal: [60, 180] },
        { day: 0, moment: 'merienda', kcal: [550, 900] },
      ],
      water: [{ day: -1, ml: 750 }, { day: 0, ml: 650 }], gym: [{ day: -1, status: 'no_fui' }], noGroup: [{ day: 0, moment: 'desayuno' }],
      itemCheck: [{ day: 0, moment: 'merienda', name: /queso/, grams: [65, 75] }, { day: -1, moment: 'cena', name: /pan/, grams: [65, 75] }],
    },
  },
  {
    id: 't3', title: 'Referencia al bizcochuelo de ayer + receta compuesta',
    text: 'Hoy 2 vasos de agua, de desayuno 1 porcion del bizcochuelo de ayer,  almuerzo: hamburguesa 90g, brocoli 68g, ensalada rusa(papa con arvejas zanahoria y mayonesa, mucha papa) 450g',
    recent: [{ day: -1, moment: 'merienda', name: 'Bizcochuelo casero proteico de banana, avena y chocolate', qty: 2, unit: 'porcion', fixed: { kcal: 550.2, p: 18.8, c: 84, f: 16, s: 48.6, fb: 6 } }],
    expect: {
      groups: [{ day: 0, moment: 'desayuno', kcal: [240, 310] }, { day: 0, moment: 'almuerzo', kcal: [700, 1150], items: [3, 4] }],
      water: [{ day: 0, ml: 500 }],
    },
  },
  {
    id: 'n1', title: 'Marcas y comida rápida (búsqueda web)',
    text: 'Ayer a la noche me comí un Big Mac con papas medianas y una coca mediana. Hoy en el desayuno un alfajor Jorgito de chocolate y un café con leche.',
    expect: { groups: [{ day: -1, moment: 'cena', kcal: [850, 1350] }, { day: 0, moment: 'desayuno', kcal: [240, 420] }] },
  },
  {
    id: 'n2', title: 'Receta entera y porción comida',
    text: 'Hice un bizcochuelo con 3 huevos, 200 g de harina, 150 g de azúcar, 100 ml de aceite y 200 ml de leche. Lo corté en 8 y en la merienda comí 2 porciones.',
    expect: { groups: [{ day: 0, moment: 'merienda', kcal: [480, 760], items: [1, 6] }] },
  },
  {
    id: 'n3', title: 'Plato nuevo + agua en litros + peso',
    text: 'Almorcé un poke de salmón con arroz, palta, edamame y salsa de soja, era grande. Tomé 1 litro de agua y me pesé 61,4.',
    expect: { groups: [{ day: 0, moment: 'almuerzo', kcal: [550, 1100] }], water: [{ day: 0, ml: 1000 }], weight: [{ day: 0, kg: 61.4 }] },
  },
  {
    id: 'n4', title: 'Post-entreno con marca + gym',
    text: 'Después de entrenar 2 scoops de proteína Star Nutrition con 300 ml de leche descremada y una banana. Fui al gym, hice pecho y espalda.',
    expect: { groups: [{ day: 0, moment: 'post_entreno', kcal: [330, 580] }], gym: [{ day: 0, status: 'fui' }] },
  },
  {
    id: 'n5', title: 'Pasta ambigua (crudo o cocido)',
    text: 'Cena: 250 g de fideos con salsa bolognesa, queso rallado y un vaso de vino tinto.',
    expect: { groups: [{ day: 0, moment: 'cena', kcal: [650, 1500], items: [3, 6] }] },
  },
  {
    id: 'n6', title: 'Solo hábitos y descanso',
    text: 'Hoy no tomé la creatina pero sí el magnesio. Día de descanso.',
    expect: { groups: [], habits: [{ day: 0, id: 'creatina', done: false }, { day: 0, id: 'magnesio', done: true }], gym: [{ day: 0, status: 'descanso' }] },
  },
  {
    id: 'n7', title: 'Empanadas variadas',
    text: 'En la cena comí una empanada de carne frita, dos de jamón y queso al horno y una de humita.',
    expect: { groups: [{ day: 0, moment: 'cena', kcal: [800, 1300] }] },
  },
  {
    id: 'n8', title: 'Anteayer + guiso',
    text: 'Anteayer en el almuerzo comí lentejas guisadas, un plato hondo, con chorizo colorado y panceta.',
    expect: { groups: [{ day: -2, moment: 'almuerzo', kcal: [450, 1050] }] },
  },
  {
    id: 'n9', title: 'Sin puntuación ni mayúsculas',
    text: 'almuerzo milanesa napolitana con fritas grandes y una gaseosa light',
    expect: { groups: [{ day: 0, moment: 'almuerzo', kcal: [900, 1800] }] },
  },
  {
    id: 'n10', title: 'Agua total del día',
    text: 'En total hoy tomé 2 litros de agua.',
    expect: { groups: [], water: [{ day: 0, ml: 2000, mode: 'fijar' }] },
  },
  {
    id: 'n11', title: 'Producto envasado argentino',
    text: 'Media mañana un yogur bebible de frutilla La Serenísima de 200 g y un puñado de almendras.',
    expect: { groups: [{ day: 0, moment: 'media_manana', kcal: [250, 450] }] },
  },
  {
    id: 'n12', title: 'Tostados y jugo de marca',
    text: 'Desayuno: 3 tostados de jamón y queso en pan de miga y un jugo de naranja Cepita de 200 ml.',
    expect: { groups: [{ day: 0, moment: 'desayuno', kcal: [380, 1000] }] },
  },
];

/** Construye un contexto aislado para las pruebas (no usa tus datos guardados). */
export function testContext(tc, now = new Date()) {
  const base = buildContext({ now });
  const ctx = { ...base, refs: {}, refLines: [], recLines: [], learned: [], notes: '' };
  let r = 0;
  for (const rc of tc.recent || []) {
    const code = 'R' + (++r);
    const date = addDays(ctx.today, rc.day);
    const q = rc.qty || 1;
    ctx.refs[code] = { code, name: rc.name, perUnit: { unit: rc.unit, kcal: rc.fixed.kcal / q, p: rc.fixed.p / q, c: rc.fixed.c / q, f: rc.fixed.f / q, s: rc.fixed.s / q, fb: (rc.fixed.fb || 0) / q } };
    ctx.recLines.push(`${code} | ${relDay(date, ctx.today)} ${store.momentName(rc.moment)} | ${rc.name} | comió ${q} ${unitLabel(rc.unit, q)} = ${round0(rc.fixed.kcal)} kcal, P ${rc.fixed.p}, C ${rc.fixed.c}, G ${rc.fixed.f}`);
  }
  return ctx;
}

/** Evalúa un borrador contra lo esperado. Devuelve { pass, checks:[{ok,msg}] } */
export function evaluateDraft(draft, tc, ctx) {
  const checks = [];
  const at = (day) => addDays(ctx.today, day);
  const E = tc.expect || {};
  for (const g of E.groups || []) {
    const grp = draft.groups.find((x) => x.date === at(g.day) && x.moment === g.moment);
    const label = `${g.day === 0 ? 'Hoy' : g.day === -1 ? 'Ayer' : 'Anteayer'} · ${store.momentName(g.moment)}`;
    if (!grp) { checks.push({ ok: false, msg: `${label}: no apareció` }); continue; }
    const t = groupTotals(grp);
    const okK = t.kcal >= g.kcal[0] && t.kcal <= g.kcal[1];
    checks.push({ ok: okK, msg: `${label}: ${t.kcal} kcal (esperado ${g.kcal[0]}–${g.kcal[1]})` });
    if (g.items) checks.push({ ok: grp.items.length >= g.items[0] && grp.items.length <= g.items[1], msg: `${label}: ${grp.items.length} alimentos (esperado ${g.items[0]}–${g.items[1]})` });
  }
  if (E.groups && !E.groups.length) checks.push({ ok: !draft.groups.length, msg: `Sin alimentos (hubo ${draft.groups.reduce((a, g) => a + g.items.length, 0)})` });
  const expectedKeys = new Set((E.groups || []).map((g) => at(g.day) + g.moment));
  const extra = draft.groups.filter((g) => !expectedKeys.has(g.date + g.moment));
  if (E.groups?.length && extra.length) checks.push({ ok: false, msg: `Comidas de más: ${extra.map((g) => `${g.date} ${store.momentName(g.moment)}`).join(', ')}` });
  for (const ng of E.noGroup || []) {
    const grp = draft.groups.find((x) => x.date === at(ng.day) && x.moment === ng.moment);
    checks.push({ ok: !grp, msg: `${store.momentName(ng.moment)} sin alimentos` });
  }
  for (const w of E.water || []) {
    const tot = draft.water.filter((x) => x.date === at(w.day)).reduce((a, x) => a + x.ml, 0);
    const okMode = !w.mode || draft.water.some((x) => x.date === at(w.day) && x.mode === w.mode);
    checks.push({ ok: Math.abs(tot - w.ml) <= 50 && okMode, msg: `Agua ${w.day === 0 ? 'hoy' : 'ayer'}: ${tot} ml${w.mode ? ' (' + (draft.water.find((x) => x.date === at(w.day))?.mode || '-') + ')' : ''} (esperado ${w.ml})` });
  }
  if (E.water && !E.water.length) checks.push({ ok: !draft.water.length, msg: `Sin agua (${draft.water.length} registros)` });
  for (const h of E.habits || []) {
    const x = draft.habits.find((y) => y.date === at(h.day) && y.id === h.id);
    checks.push({ ok: !!x && x.done === h.done, msg: `${h.id}: ${x ? (x.done ? 'tomado' : 'no tomado') : 'no detectado'} (esperado ${h.done ? 'tomado' : 'no tomado'})` });
  }
  for (const g of E.gym || []) {
    const x = draft.gym.find((y) => y.date === at(g.day));
    checks.push({ ok: !!x && x.status === g.status, msg: `Gym ${g.day === 0 ? 'hoy' : 'ayer'}: ${x ? x.status : 'no detectado'} (esperado ${g.status})` });
  }
  if (E.gym && !E.gym.length) checks.push({ ok: !draft.gym.length, msg: `Sin gym (${draft.gym.length})` });
  for (const w of E.weight || []) {
    const x = draft.weight.find((y) => y.date === at(w.day));
    checks.push({ ok: !!x && Math.abs(x.kg - w.kg) < 0.05, msg: `Peso: ${x ? x.kg : '—'} (esperado ${w.kg})` });
  }
  for (const ic of E.itemCheck || []) {
    const grp = draft.groups.find((x) => x.date === at(ic.day) && x.moment === ic.moment);
    const it = grp && grp.items.find((i) => ic.name.test(norm(i.name)));
    checks.push({ ok: !!it && it.grams >= ic.grams[0] && it.grams <= ic.grams[1], msg: `${it ? it.name : 'Alimento'}: ${it ? round0(it.grams) + ' g' : 'no encontrado'} (esperado ${ic.grams[0]}–${ic.grams[1]} g)` });
  }
  return { pass: checks.every((c) => c.ok), checks };
}

// ---------------------------------------------------------------------------
// ¿Encaja con la dieta y la salud de la persona? (avisos en la revisión y en las ideas)
// ---------------------------------------------------------------------------
const MEAT_RE = /\b(carne|pollo|cerdo|bife|lomo|asado|vacio|milanesa(?! de soja| de berenjena)|hamburguesa(?! de lentejas| vegetal| de soja)|jamon|salame|chorizo|bondiola|panceta|mortadela|pescado|atun|salmon|merluza|mariscos?|langostinos?|morcilla|salchichas?|nuggets|pechuga|pata muslo)\b/;
const ANIMAL_RE = /\b(leche(?! de almendras| de coco| de avena| vegetal| de soja)|queso|yogur|manteca|huevos?|claras?|miel|crema de leche|dulce de leche|ricota|muzzarella)\b/;
const GLUTEN_RE = /\b(pan|panes|fideos|pastas?|galletitas?|harina|pizza|empanadas?|milanesas?|medialunas?|alfajor(es)?|tartas?|noquis|ravioles|sorrentinos|tostados?|sandwich|bizcochuelo|facturas?|cerveza|rebozad[oa]s?|avena)\b/;
const SALT_RE = /\b(fiambres?|salame|jamon crudo|mortadela|salchichas?|papas fritas|snacks?|chizitos|caldo|sopa instantanea|aceitunas|queso (?:rallado|duro|reggianito|sardo)|panceta|chorizo)\b/;
export function fitWarnings(it, profile = store.S().settings.profile || {}) {
  const out = [];
  const n = norm(it.name || '');
  const diet = profile.diet || ''; const cond = new Set(profile.conditions || []);
  if ((diet === 'vegetariana' || diet === 'vegana') && MEAT_RE.test(n)) out.push(`No es ${diet === 'vegana' ? 'vegano' : 'vegetariano'}: tiene carne o pescado.`);
  else if (diet === 'vegana' && ANIMAL_RE.test(n)) out.push('No es vegano: tiene productos de origen animal.');
  if ((cond.has('celiaquia') || diet === 'sin_gluten') && GLUTEN_RE.test(n) && !/sin (tacc|gluten)|de arroz|de maiz/.test(n)) out.push('Suele tener gluten: fijate que diga "sin TACC".');
  const m = store.itemMacros(it);
  if ((cond.has('diabetes') || cond.has('prediabetes')) && m.s >= 15) out.push(`Mucha azúcar para la diabetes (${Math.round(m.s)} g).`);
  if (diet === 'keto' && m.c >= 15) out.push(`Muchos carbohidratos para keto (${Math.round(m.c)} g).`);
  if (cond.has('hipertension') && SALT_RE.test(n)) out.push('Suele tener mucha sal: cuidado con la presión.');
  return out;
}
