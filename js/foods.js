// ApexTrack — base de alimentos calibrada, medidas caseras, búsqueda y cálculo.
// Valores por 100 g (o 100 ml en líquidos). c = carbohidratos disponibles (sin fibra).
// Fuentes: tablas USDA/ARGENFOODS, etiquetas argentinas y el historial propio del usuario
// (yogur griego casero, leche Protein, queso cremoso, tortitas, pachata, puré instantáneo, etc.).

import { norm, round1, round0 } from './util.js';

// ---------- Unidades ----------
export const UNITS = ['g', 'ml', 'unidad', 'porcion', 'cda', 'cdita', 'taza', 'vaso', 'feta', 'rebanada', 'rodaja',
  'punado', 'plato', 'paquete', 'lata', 'pote', 'scoop', 'bocha', 'copa', 'botella', 'diente', 'hoja', 'trincha',
  'chorrito', 'sobre', 'chica', 'grande'];

const UNIT_LABELS = {
  g: ['g', 'g'], ml: ['ml', 'ml'], unidad: ['unidad', 'unidades'], cda: ['cda', 'cdas'], cdita: ['cdita', 'cditas'],
  taza: ['taza', 'tazas'], vaso: ['vaso', 'vasos'], feta: ['feta', 'fetas'], rebanada: ['rebanada', 'rebanadas'],
  rodaja: ['rodaja', 'rodajas'], punado: ['puñado', 'puñados'], lata: ['lata', 'latas'], pote: ['pote', 'potes'],
  scoop: ['scoop', 'scoops'], porcion: ['porción', 'porciones'], plato: ['plato', 'platos'], bocha: ['bocha', 'bochas'],
  copa: ['copa', 'copas'], botella: ['botella', 'botellas'], paquete: ['paquete', 'paquetes'], diente: ['diente', 'dientes'],
  hoja: ['hoja', 'hojas'], trincha: ['trincha', 'trinchas'], chorrito: ['chorrito', 'chorritos'], sobre: ['sobre', 'sobres'],
  chica: ['chica', 'chicas'], grande: ['grande', 'grandes'], kg: ['kg', 'kg'], l: ['l', 'l'],
};
export function unitLabel(unit, qty = 1) {
  const l = UNIT_LABELS[unit];
  if (!l) return unit || '';
  return Math.abs(Number(qty) - 1) < 1e-9 ? l[0] : l[1];
}

// Sinónimos → unidad canónica (sin tildes, en minúsculas)
const UNIT_SYN = [
  ['kg', ['kg', 'kilo', 'kilos', 'kilogramo', 'kilogramos']],
  ['g', ['g', 'gr', 'grs', 'gramo', 'gramos']],
  ['l', ['l', 'lt', 'lts', 'litro', 'litros']],
  ['ml', ['ml', 'cc', 'mililitro', 'mililitros']],
  ['cdita', ['cdita', 'cditas', 'cucharadita', 'cucharaditas', 'cucharita', 'cucharitas', 'cuchara de te', 'cucharada de te', 'cucharadas de te']],
  ['cda', ['cda', 'cdas', 'cucharada', 'cucharadas', 'cuchara', 'cucharas', 'cucharada sopera', 'cucharadas soperas', 'cda sopera', 'cdas soperas']],
  ['taza', ['taza', 'tazas', 'tazon', 'tazones']],
  ['vaso', ['vaso', 'vasos', 'vasito', 'vasitos']],
  ['feta', ['feta', 'fetas', 'fetita', 'fetitas', 'loncha', 'lonchas']],
  ['rebanada', ['rebanada', 'rebanadas', 'tostada', 'tostadas']],
  ['rodaja', ['rodaja', 'rodajas']],
  ['punado', ['punado', 'punados']],
  ['lata', ['lata', 'latas', 'latita', 'latitas']],
  ['pote', ['pote', 'potes', 'potecito']],
  ['scoop', ['scoop', 'scoops', 'medida', 'medidas', 'cazo', 'cazos']],
  ['porcion', ['porcion', 'porciones', 'porcioncita', 'trozo', 'trozos', 'pedazo', 'pedazos']],
  ['plato', ['plato', 'platos', 'platito', 'platazo']],
  ['bocha', ['bocha', 'bochas']],
  ['copa', ['copa', 'copas']],
  ['botella', ['botella', 'botellas', 'botellita']],
  ['paquete', ['paquete', 'paquetes', 'paquetito', 'caja', 'cajas']],
  ['diente', ['diente', 'dientes']],
  ['hoja', ['hoja', 'hojas']],
  ['trincha', ['trincha', 'trinchas']],
  ['chorrito', ['chorrito', 'chorritos', 'chorro']],
  ['sobre', ['sobre', 'sobres', 'sobrecito', 'sobrecitos']],
  ['unidad', ['unidad', 'unidades', 'u', 'pieza', 'piezas', 'bollo', 'bollos']],
];
const UNIT_LOOKUP = new Map();
for (const [canon, list] of UNIT_SYN) for (const w of list) UNIT_LOOKUP.set(norm(w), canon);
export function canonUnit(u) {
  if (!u) return '';
  const k = norm(u);
  if (UNIT_LOOKUP.has(k)) return UNIT_LOOKUP.get(k);
  if (UNITS.includes(k)) return k;
  if (k === 'porción') return 'porcion';
  return '';
}

// Pesos genéricos cuando el alimento no tiene su propia equivalencia
export const GENERIC_UNIT_G = {
  cda: 15, cdita: 5, taza: 200, vaso: 200, feta: 20, rebanada: 25, rodaja: 25, punado: 30, lata: 150, pote: 125,
  scoop: 30, porcion: 150, plato: 300, bocha: 60, copa: 150, botella: 500, paquete: 100, diente: 3, hoja: 10,
  trincha: 120, chorrito: 5, sobre: 6, unidad: 100,
};

// ---------- Base de alimentos ----------
// F(id, nombre, alias[], categoría, kcal, prot, carbos, grasa, azúcar, fibra, unidades{}, extra{})
function F(id, n, a, cat, k, p, c, f, s = 0, fb = 0, u = {}, x = {}) {
  return { id, n, a, cat, k, p, c, f, s, fb, u, ...x };
}

export const BUILTIN_FOODS = [
  // Lácteos y huevos
  F('huevo', 'Huevo (cocido, a la plancha o al horno sin aceite)', ['huevo', 'huevos', 'huevo duro', 'huevo cocido', 'huevo hervido', 'huevo a la plancha', 'huevos a la plancha', 'huevo al horno', 'huevo poche', 'huevo crudo', 'huevos en sarten', 'huevo en sarten sin aceite', 'huevos en sarten sin aceite', 'huevos sin aceite'], 'huevos', 143, 12.6, 0.7, 9.5, 0.4, 0, { unidad: 50 }, { d: ['unidad', 1] }),
  F('huevo_frito', 'Huevo frito (con aceite)', ['huevo frito', 'huevos fritos'], 'huevos', 196, 13.6, 0.8, 14.8, 0.4, 0, { unidad: 46 }, { d: ['unidad', 1] }),
  F('huevo_revuelto', 'Huevos revueltos', ['huevo revuelto', 'revuelto'], 'huevos', 149, 10, 1.6, 11, 1.4, 0, { unidad: 61 }, { d: ['unidad', 2] }),
  F('clara', 'Clara de huevo', ['clara', 'claras', 'claras de huevo'], 'huevos', 52, 10.9, 0.7, 0.2, 0.7, 0, { unidad: 33 }, { d: ['unidad', 1] }),
  F('leche_entera', 'Leche entera', ['leche', 'leche entera', 'leche la serenisima entera'], 'lacteos', 58, 3.1, 4.7, 3, 4.7, 0, { vaso: 200, taza: 250, cda: 15, chorrito: 30 }, { liq: 1, d: ['vaso', 1] }),
  F('leche_descremada', 'Leche descremada', ['leche descremada', 'leche light', 'leche liviana'], 'lacteos', 35, 3.4, 5, 0.2, 5, 0, { vaso: 200, taza: 250, cda: 15, chorrito: 30 }, { liq: 1, d: ['vaso', 1] }),
  F('leche_parcial', 'Leche parcialmente descremada', ['leche parcialmente descremada', 'leche semidescremada'], 'lacteos', 45, 3.2, 4.7, 1.5, 4.7, 0, { vaso: 200, taza: 250, cda: 15, chorrito: 30 }, { liq: 1, d: ['vaso', 1] }),
  F('leche_protein', 'Leche La Serenísima Protein', ['leche proteica', 'leche protein', 'leche con proteina', 'leche protein la serenisima', 'serenisima protein', 'leche proteica la serenisima', 'cafe con leche proteica', 'cafe con leche protein'], 'lacteos', 41.5, 5, 4.6, 0, 4.6, 0, { vaso: 200, taza: 250, cda: 15, chorrito: 30 }, { liq: 1, d: ['vaso', 1] }),
  F('yogur_griego_casero', 'Yogur griego casero (con leche proteica)', ['yogur griego casero', 'yogur casero', 'yogurt griego casero', 'yogur griego hecho en casa'], 'lacteos', 88, 11.5, 6.5, 1, 4.5, 0, { cda: 22, taza: 240, porcion: 130 }, { d: ['porcion', 1] }),
  F('yogur_griego', 'Yogur griego natural (comercial)', ['yogur griego', 'yogurt griego'], 'lacteos', 97, 9, 4, 5, 4, 0, { pote: 150, cda: 20 }, { d: ['pote', 1] }),
  F('yogur_manfrey', 'Yogur firme Manfrey frutilla', ['yogur manfrey', 'yogur firme', 'yogur de frutilla', 'yogur firme de frutilla'], 'lacteos', 80, 3, 13.2, 1.8, 12.5, 0, { pote: 140 }, { d: ['pote', 1] }),
  F('yogur_tregar', 'Yogur Tregar cremoso vainilla', ['yogur tregar', 'yogur cremoso', 'yogur de vainilla'], 'lacteos', 92, 4.6, 15.2, 1.4, 14, 0, { pote: 125 }, { d: ['pote', 1] }),
  F('yogur_bebible', 'Yogur bebible entero', ['yogur bebible', 'yogurt bebible', 'yogur bebible de frutilla', 'yogur bebible la serenisima', 'yogur bebible de vainilla'], 'lacteos', 80, 2.8, 13, 1.7, 12, 0, { vaso: 200, botella: 900 }, { liq: 1, d: ['vaso', 1] }),
  F('queso_cremoso', 'Queso cremoso', ['cremoso', 'queso port salut', 'port salut', 'queso cuartirolo', 'cuartirolo'], 'lacteos', 300, 20, 2, 24, 0.5, 0, { feta: 30, porcion: 30 }, { d: ['porcion', 1] }),
  F('queso_mantecoso', 'Queso mantecoso', ['mantecoso'], 'lacteos', 325, 23, 1.5, 26, 0.5, 0, { feta: 20, porcion: 30 }, { d: ['feta', 1] }),
  F('queso_barra', 'Queso de máquina / tybo', ['queso tybo', 'tybo', 'queso de maquina', 'queso barra', 'queso en fetas', 'queso dambo', 'dambo', 'queso'], 'lacteos', 340, 25, 2, 26, 0.5, 0, { feta: 20 }, { d: ['feta', 2] }),
  F('queso_rallado', 'Queso rallado (reggianito)', ['queso rallado', 'rallado', 'reggianito', 'parmesano'], 'lacteos', 395, 32, 2, 29, 0, 0, { cda: 10, cdita: 4 }, { d: ['cda', 1] }),
  F('muzzarella', 'Muzzarella', ['mozzarella', 'muzarela', 'muzza', 'mozarela'], 'lacteos', 280, 22, 2.5, 20, 1, 0, { feta: 20, porcion: 30 }, { d: ['porcion', 1] }),
  F('queso_untable', 'Queso untable (tipo Casancrem)', ['queso crema', 'casancrem', 'queso untable', 'philadelphia'], 'lacteos', 240, 6, 4, 22, 3, 0, { cda: 15, cdita: 5 }, { d: ['cda', 1] }),
  F('ricota', 'Ricota', ['ricotta'], 'lacteos', 138, 11.4, 5.1, 7.9, 0.3, 0, { cda: 25 }, { d: ['cda', 2] }),
  F('manteca', 'Manteca', ['mantequilla'], 'grasas', 717, 0.9, 0.1, 81, 0.1, 0, { cda: 14, cdita: 5 }, { d: ['cdita', 1] }),
  F('dulce_leche', 'Dulce de leche', ['dulce de leche'], 'dulces', 315, 6.8, 55, 7.5, 50, 0, { cda: 20, cdita: 7 }, { d: ['cda', 1] }),
  F('crema_leche', 'Crema de leche', ['crema'], 'lacteos', 340, 2.8, 2.7, 36, 2.7, 0, { cda: 15 }, { d: ['cda', 1] }),
  F('cacao_azucarado', 'Cacao en polvo azucarado (tipo Nesquik)', ['nesquik', 'cacao', 'chocolatada en polvo', 'toddy', 'cacao en polvo'], 'dulces', 380, 4, 85, 3, 75, 0, { cdita: 5, cda: 12 }, { d: ['cdita', 2] }),
  F('proteina_polvo', 'Proteína en polvo (whey)', ['proteina', 'proteina en polvo', 'whey', 'whey protein', 'one fit', 'proteina one fit', 'suplemento de proteina', 'scoop de proteina'], 'suplementos', 400, 80, 7, 5.5, 4, 0, { scoop: 30, cda: 10 }, { d: ['scoop', 1] }),

  // Carnes, pollo, cerdo, embutidos, pescados
  F('carne_picada', 'Carne picada vacuna intermedia (cruda)', ['carne picada', 'carne molida', 'picada', 'carne molida intermedia', 'carne picada intermedia', 'carne molida vacuna'], 'carnes', 215, 18.6, 0, 15, 0, 0, { porcion: 150 }, { st: 'crudo', d: ['porcion', 1] }),
  F('carne_picada_comun', 'Carne picada común (cruda)', ['carne picada comun', 'picada comun'], 'carnes', 254, 17.2, 0, 20, 0, 0, { porcion: 150 }, { st: 'crudo', d: ['porcion', 1] }),
  F('carne_picada_magra', 'Carne picada especial / magra (cruda)', ['carne picada magra', 'picada especial', 'carne picada especial'], 'carnes', 176, 20, 0, 10, 0, 0, { porcion: 150 }, { st: 'crudo', d: ['porcion', 1] }),
  F('hamburguesa_casera', 'Hamburguesa de carne vacuna a la plancha (medallón)', ['hamburguesa', 'hamburguesas', 'hamburguesa casera', 'medallon de carne', 'hamburguesa a la plancha', 'hamburguesa de carne'], 'carnes', 220, 19, 0, 15.8, 0, 0, { unidad: 110 }, { st: 'cocido', d: ['unidad', 1] }),
  F('hamburguesa_paty', 'Hamburguesa congelada tipo Paty', ['paty', 'hamburguesa paty', 'hamburguesa congelada', 'hamburguesa swift'], 'carnes', 250, 15, 2, 20, 0.5, 0, { unidad: 80 }, { d: ['unidad', 1] }),
  F('hamburguesa_completa', 'Hamburguesa completa (pan, carne, huevo, lechuga, tomate, mayonesa)', ['hamburguesa completa', 'sandwich de hamburguesa', 'hamburguesa con pan'], 'platos', 220, 12.5, 13, 12.8, 2.5, 1, { unidad: 330 }, { d: ['unidad', 1] }),
  F('bife', 'Bife de carne vacuna (cocido)', ['bife', 'bife a la plancha', 'churrasco', 'bife de cuadril', 'bife de nalga', 'carne asada', 'bife de chorizo', 'carne vacuna'], 'carnes', 220, 29, 0, 11.5, 0, 0, { unidad: 200, porcion: 200 }, { st: 'cocido', d: ['porcion', 1] }),
  F('lomo', 'Lomo vacuno (crudo)', ['bife de lomo', 'lomo', 'lomo vacuno'], 'carnes', 145, 21.8, 0, 6.4, 0, 0, { unidad: 180 }, { st: 'crudo', d: ['unidad', 1] }),
  F('asado_tira', 'Asado de tira (cocido)', ['asado', 'asado de tira', 'costilla'], 'carnes', 300, 25, 0, 22, 0, 0, { porcion: 250 }, { st: 'cocido', d: ['porcion', 1] }),
  F('vacio', 'Vacío (cocido)', ['vacio', 'matambre'], 'carnes', 280, 26, 0, 19.5, 0, 0, { porcion: 250 }, { st: 'cocido', d: ['porcion', 1] }),
  F('carne_guiso', 'Carne vacuna para guiso o salsa (cruda)', ['carne para guiso', 'carnaza', 'paleta', 'carne en cubos', 'carne para salsa', 'carne vacuna para guiso', 'carne vacuna para salsa'], 'carnes', 175, 21, 0, 10, 0, 0, { porcion: 150 }, { st: 'crudo', d: ['porcion', 1] }),
  F('milanesa_cerdo', 'Milanesa de cerdo al horno', ['milanesa de cerdo', 'milanesas de cerdo'], 'carnes', 227, 19, 10, 12.3, 0.5, 0.5, { unidad: 150 }, { st: 'cocido', d: ['unidad', 1] }),
  F('milanesa_carne', 'Milanesa de carne al horno', ['milanesa', 'milanesas', 'milanesa de carne', 'milanesa de nalga', 'milanesa vacuna', 'milanesa al horno'], 'carnes', 220, 22, 14, 8.5, 0.5, 0.7, { unidad: 150 }, { st: 'cocido', d: ['unidad', 1] }),
  F('milanesa_frita', 'Milanesa de carne frita', ['milanesa frita', 'milanesas fritas'], 'carnes', 280, 20, 15, 15.5, 0.5, 0.7, { unidad: 150 }, { st: 'cocido', d: ['unidad', 1] }),
  F('milanesa_pollo', 'Milanesa de pollo al horno', ['milanesa de pollo', 'suprema', 'supremas', 'milanesas de pollo'], 'carnes', 195, 22, 12, 6.5, 0.5, 0.5, { unidad: 150 }, { st: 'cocido', d: ['unidad', 1] }),
  F('pechuga', 'Pechuga de pollo (cocida, sin piel)', ['pollo', 'pechuga', 'pechuga de pollo', 'pollo a la plancha', 'pollo grillado', 'pollo hervido'], 'carnes', 165, 31, 0, 3.6, 0, 0, { unidad: 180, porcion: 150 }, { st: 'cocido', d: ['porcion', 1] }),
  F('pechuga_cruda', 'Pechuga de pollo (cruda)', ['pechuga cruda', 'pollo crudo'], 'carnes', 120, 22.5, 0, 2.6, 0, 0, { unidad: 220 }, { st: 'crudo', d: ['unidad', 1] }),
  F('pata_muslo', 'Pata muslo de pollo al horno (con piel)', ['pata muslo', 'patamuslo', 'muslo de pollo', 'pollo al horno', 'cuarto de pollo'], 'carnes', 225, 25, 0, 13.5, 0, 0, { unidad: 200 }, { st: 'cocido', d: ['unidad', 1] }),
  F('bondiola', 'Bondiola de cerdo (cocida)', ['bondiola', 'bondiola de cerdo'], 'carnes', 240, 25, 0, 15.5, 0, 0, { porcion: 200, plato: 200 }, { st: 'cocido', d: ['porcion', 1] }),
  F('cerdo', 'Lomo / carré de cerdo (cocido)', ['carre de cerdo', 'lomo de cerdo', 'cerdo', 'costeleta de cerdo', 'carre'], 'carnes', 200, 27, 0, 10, 0, 0, { porcion: 180 }, { st: 'cocido', d: ['porcion', 1] }),
  F('chorizo', 'Chorizo parrillero (cocido)', ['chorizo', 'chorizos', 'chorizo parrillero'], 'carnes', 310, 15, 1, 27, 0.5, 0, { unidad: 110 }, { st: 'cocido', d: ['unidad', 1] }),
  F('morcilla', 'Morcilla', ['morcillas'], 'carnes', 380, 14.6, 1.3, 34.5, 0, 0, { unidad: 100 }, { d: ['unidad', 1] }),
  F('salchicha', 'Salchicha tipo Viena', ['salchicha', 'salchichas', 'vienissima', 'salchichas de viena'], 'carnes', 260, 12, 3, 22, 1, 0, { unidad: 25 }, { d: ['unidad', 2] }),
  F('jamon_cocido', 'Jamón cocido', ['jamon', 'jamon cocido', 'fiambre'], 'carnes', 125, 18, 1.5, 5, 1, 0, { feta: 18 }, { d: ['feta', 2] }),
  F('jamon_crudo', 'Jamón crudo', ['jamon crudo', 'serrano'], 'carnes', 240, 30, 0, 13.5, 0, 0, { feta: 15 }, { d: ['feta', 2] }),
  F('panceta', 'Panceta ahumada', ['panceta', 'tocino', 'bacon', 'panceta ahumada'], 'carnes', 420, 14, 1, 40, 0, 0, { feta: 15, porcion: 30 }, { d: ['porcion', 1] }),
  F('salame', 'Salame picado fino', ['salame', 'salamin', 'salamines'], 'carnes', 390, 22, 2, 33, 1, 0, { feta: 8, rodaja: 8 }, { d: ['feta', 5] }),
  F('mortadela', 'Mortadela', [], 'carnes', 311, 16.4, 3, 25.4, 1, 0, { feta: 15 }, { d: ['feta', 2] }),
  F('atun_natural', 'Atún al natural (escurrido)', ['atun al natural', 'atun en agua', 'atun desmenuzado al natural'], 'pescados', 116, 25.5, 0, 0.8, 0, 0, { lata: 120 }, { d: ['lata', 1] }),
  F('atun_aceite', 'Atún en aceite (escurrido)', ['atun', 'atun en aceite', 'atun al aceite', 'lata de atun'], 'pescados', 198, 29, 0, 8.2, 0, 0, { lata: 120 }, { d: ['lata', 0.5] }),
  F('merluza', 'Merluza al horno', ['merluza', 'pescado', 'filet de merluza', 'filete de pescado', 'pescado al horno'], 'pescados', 105, 22, 0, 1.5, 0, 0, { unidad: 150, porcion: 150 }, { st: 'cocido', d: ['porcion', 1] }),
  F('merluza_frita', 'Merluza rebozada / frita', ['pescado frito', 'merluza frita', 'filet rebozado', 'pescado rebozado'], 'pescados', 230, 15, 12, 13.5, 0.5, 0.5, { unidad: 150 }, { st: 'cocido', d: ['unidad', 1] }),
  F('salmon', 'Salmón (cocido)', ['salmon'], 'pescados', 206, 22, 0, 12.4, 0, 0, { porcion: 150 }, { st: 'cocido', d: ['porcion', 1] }),
  F('nuggets', 'Nuggets de pollo', ['nuggets', 'bocaditos de pollo', 'patitas de pollo'], 'carnes', 296, 15, 16, 19, 0.5, 1, { unidad: 18 }, { d: ['unidad', 6] }),

  // Legumbres
  F('lentejas', 'Lentejas cocidas', ['lentejas'], 'legumbres', 116, 9, 12.2, 0.4, 1.8, 7.9, { taza: 200, cda: 15, plato: 250 }, { st: 'cocido', d: ['taza', 1] }),
  F('garbanzos', 'Garbanzos cocidos', ['garbanzos'], 'legumbres', 164, 8.9, 19.8, 2.6, 4.8, 7.6, { taza: 160, cda: 15 }, { st: 'cocido', d: ['taza', 1] }),
  F('porotos', 'Porotos cocidos', ['porotos', 'frijoles', 'porotos negros', 'porotos alubia'], 'legumbres', 127, 8.7, 16.4, 0.5, 0.3, 6.4, { taza: 170, cda: 15 }, { st: 'cocido', d: ['taza', 1] }),
  F('arvejas', 'Arvejas cocidas', ['arvejas', 'arvejas en lata', 'guisantes'], 'legumbres', 84, 5.4, 10.1, 0.2, 5.9, 5.5, { taza: 160, cda: 15, lata: 200 }, { st: 'cocido', d: ['taza', 0.5] }),
  F('lentejas_secas', 'Lentejas secas (crudas)', ['lentejas secas', 'lentejas crudas'], 'legumbres', 352, 24.6, 52.7, 1.1, 2, 10.7, { taza: 190, cda: 12, porcion: 70 }, { st: 'crudo', d: ['porcion', 1] }),

  // Cereales, panes, pastas
  F('arroz_crudo', 'Arroz blanco largo fino (crudo)', ['arroz crudo', 'arroz lucchetti', 'arroz largo fino', 'arroz blanco crudo', 'arroz en seco'], 'cereales', 356, 7, 78.5, 0.6, 0.1, 1, { taza: 180, cda: 12, porcion: 80 }, { st: 'crudo', d: ['porcion', 1] }),
  F('arroz_cocido', 'Arroz blanco cocido', ['arroz', 'arroz cocido', 'arroz hervido', 'plato de arroz', 'arroz blanco'], 'cereales', 130, 2.7, 27.9, 0.3, 0.1, 0.4, { taza: 160, plato: 250, cda: 15 }, { st: 'cocido', d: ['plato', 1] }),
  F('arroz_integral', 'Arroz integral (crudo)', ['arroz integral'], 'cereales', 362, 7.5, 72.2, 2.7, 0.9, 3.4, { taza: 185, porcion: 80 }, { st: 'crudo', d: ['porcion', 1] }),
  F('fideos_secos', 'Fideos secos (crudos)', ['fideos secos', 'fideos crudos', 'pasta seca', 'spaghetti crudo', 'fideos en seco'], 'cereales', 352, 12, 71, 1.4, 2.7, 2.5, { paquete: 500, porcion: 100, taza: 100 }, { st: 'crudo', d: ['porcion', 1] }),
  F('fideos_cocidos', 'Fideos cocidos', ['fideos', 'fideos cocidos', 'plato de fideos', 'pasta', 'spaghetti', 'tallarines', 'tirabuzones', 'mostachol', 'monitos', 'penne', 'fideos guiseros'], 'cereales', 158, 5.8, 29.1, 0.9, 0.6, 1.8, { plato: 250, taza: 140 }, { st: 'cocido', d: ['plato', 1] }),
  F('ravioles', 'Ravioles de pollo y verdura (frescos, crudos)', ['ravioles', 'ravioles di pascuale', 'ravioles de pollo', 'ravioles de verdura', 'ravioles de pollo y verdura'], 'cereales', 269, 8.9, 47, 5, 1.5, 0, { plato: 200, porcion: 200, paquete: 500 }, { st: 'crudo', d: ['plato', 1] }),
  F('sorrentinos', 'Sorrentinos de jamón y queso (frescos)', ['sorrentinos'], 'cereales', 260, 10, 38, 7.5, 1.5, 1, { plato: 220, unidad: 22 }, { st: 'crudo', d: ['plato', 1] }),
  F('noquis', 'Ñoquis de papa (frescos)', ['ñoquis', 'noquis', 'gnocchi'], 'cereales', 160, 4, 33, 1, 0.5, 0, { plato: 250 }, { d: ['plato', 1] }),
  F('pan_frances', 'Pan francés', ['pan', 'pan frances', 'bollito', 'mignon', 'flautita', 'felipe', 'pan de mesa', 'pancito', 'bollo de pan'], 'panes', 275, 9, 55, 1.3, 1.5, 2.5, { unidad: 50, rebanada: 25, rodaja: 25, trincha: 120 }, { d: ['unidad', 1] }),
  F('pan_lactal', 'Pan lactal blanco', ['pan lactal', 'pan de molde', 'pan lactal san francisco', 'pan blanco de molde', 'pan lactal blanco'], 'panes', 265, 8, 48, 3.5, 5, 2.5, { rebanada: 27, rodaja: 27 }, { d: ['rebanada', 2] }),
  F('pan_integral', 'Pan lactal integral', ['pan integral', 'pan lactal integral', 'pan de salvado'], 'panes', 245, 10, 37, 3.5, 4, 6.5, { rebanada: 27, rodaja: 27 }, { d: ['rebanada', 2] }),
  F('pan_hamburguesa', 'Pan de hamburguesa / pancho', ['pan de hamburguesa', 'pan de pancho', 'pan de viena'], 'panes', 280, 9, 49, 4.5, 5, 2.4, { unidad: 60 }, { d: ['unidad', 1] }),
  F('pan_papa', 'Pan de papa', ['pan de papa', 'pan brioche'], 'panes', 290, 8.5, 49, 6, 6, 2, { unidad: 70 }, { d: ['unidad', 1] }),
  F('pan_lomitero', 'Pan lomitero', ['pan de lomito', 'pan lomitero', 'pan de sandwich'], 'panes', 265, 8.5, 50, 2.5, 2, 2.4, { unidad: 110 }, { d: ['unidad', 1] }),
  F('pan_rallado', 'Pan rallado', ['rebozador'], 'panes', 395, 13.4, 67.5, 5.3, 6, 4.5, { cda: 10, taza: 110 }, { d: ['cda', 2] }),
  F('tostadas_riera', 'Tostadas de pan (tipo Riera)', ['tostadas riera', 'pan tostado', 'tostadas de pan', 'riera'], 'panes', 400, 11, 72, 6.5, 5, 3.5, { unidad: 9 }, { d: ['unidad', 3] }),
  F('galletitas_agua', 'Galletitas de agua / saladas (tipo Traviata, Criollitas)', ['galletitas de agua', 'criollitas', 'galletitas saladas', 'traviata', 'galletas saladas', 'crackers', 'galletitas traviata', 'galletas traviata', 'rex', 'galletitas rex'], 'panes', 430, 10, 68, 13, 2, 2.5, { unidad: 7, paquete: 101 }, { d: ['unidad', 5] }),
  F('galletas_arroz', 'Galletas de arroz (Dos Hermanos)', ['galletas de arroz', 'galletitas de arroz', 'tortitas de arroz', 'dos hermanos', 'galleta de arroz'], 'panes', 375, 8.5, 80, 2, 0.5, 3, { unidad: 7.5 }, { d: ['unidad', 3] }),
  F('tortitas_sanjuaninas', 'Tortitas sanjuaninas / raspaditas', ['tortitas', 'tortitas sanjuaninas', 'tortitas de grasa', 'tortita cuyana', 'tortitas cuyanas', 'tortita', 'raspaditas', 'raspadita'], 'panes', 360, 7.2, 49.2, 15.6, 2, 2, { unidad: 42 }, { d: ['unidad', 2] }),
  F('milanesa_napolitana', 'Milanesa napolitana al horno', ['milanesa napolitana', 'milanesa a la napolitana', 'napolitana', 'milanesas napolitanas'], 'platos', 240, 18, 11, 13.5, 1.5, 0.8, { unidad: 250 }, { d: ['unidad', 1] }),
  F('tostado_miga', 'Tostado de jamón y queso (pan de miga)', ['tostado', 'tostados', 'tostado de jamon y queso', 'tostado de miga', 'tostados de jamon y queso', 'tostado de jamon y queso en pan de miga'], 'platos', 290, 13, 28, 14, 3, 1.2, { unidad: 100 }, { d: ['unidad', 1] }),
  F('pachata', 'Pachata sanjuanina (completa)', ['pachata', 'pachatas'], 'platos', 226, 18.7, 15.5, 9.9, 1.5, 1, { unidad: 400 }, { d: ['unidad', 1] }),
  F('bizcochuelo', 'Bizcochuelo casero', ['bizcochuelo', 'torta', 'budin', 'vainillas'], 'dulces', 297, 7.3, 57, 4.3, 35, 1, { porcion: 70 }, { d: ['porcion', 1] }),
  F('medialuna', 'Medialuna de manteca', ['medialuna', 'medialunas', 'factura', 'facturas', 'croissant'], 'dulces', 410, 7.5, 45, 21.5, 15, 2, { unidad: 45 }, { d: ['unidad', 1] }),
  F('alfajor', 'Alfajor de chocolate', ['alfajor', 'alfajores', 'alfajor jorgito', 'alfajor guaymallen', 'alfajor havanna'], 'dulces', 450, 5, 63, 20, 40, 2, { unidad: 50 }, { d: ['unidad', 1] }),
  F('alfajor_maicena', 'Alfajor de maicena', ['alfajor de maicena', 'alfajorcito de maicena'], 'dulces', 440, 5, 65, 17.5, 35, 1, { unidad: 45 }, { d: ['unidad', 1] }),
  F('brownie', 'Brownie', ['brownies'], 'dulces', 440, 5.5, 54, 22.5, 38, 2, { porcion: 55 }, { d: ['porcion', 1] }),
  F('helado', 'Helado de crema', ['helado', 'helado de dulce de leche', 'helado de chocolate', 'helado de vainilla', 'helado de crema americana'], 'dulces', 200, 3.5, 24, 10, 21, 0, { bocha: 60 }, { d: ['bocha', 2] }),
  F('galletitas_avena', 'Galletitas de avena con pasas', ['galletitas de avena', 'cookies de avena', 'galletitas de avena y pasas'], 'dulces', 437, 6.6, 70.9, 14.2, 25, 3, { unidad: 11.7 }, { d: ['unidad', 3] }),
  F('galletitas_dulces', 'Galletitas dulces (tipo Oreo / Pepitos)', ['galletitas', 'galletitas dulces', 'oreo', 'pepitos', 'galletitas de chocolate', 'tita', 'rhodesia', 'galletitas rellenas'], 'dulces', 470, 5.5, 68, 19.5, 35, 2.5, { unidad: 11, paquete: 118 }, { d: ['unidad', 3] }),
  F('bombones', 'Bombones de chocolate rellenos', ['bombon', 'bombones', 'bombones de chocolate'], 'dulces', 530, 6, 58, 30, 50, 0, { unidad: 16 }, { d: ['unidad', 2] }),
  F('chocolate', 'Chocolate con leche', ['chocolate', 'barra de chocolate', 'cofler', 'milka', 'chocolate con leche'], 'dulces', 535, 7.6, 57, 30, 52, 3, { unidad: 25, porcion: 25 }, { d: ['porcion', 1] }),
  F('gomitas', 'Gomitas', ['gomitas dulces', 'mogul', 'caramelos de goma', 'ositos de goma'], 'dulces', 340, 6.5, 78, 0, 50, 0, { unidad: 4 }, { d: ['unidad', 5] }),
  F('avena_cocida', 'Avena cocida (porridge, con agua)', ['avena cocida', 'porridge', 'gachas de avena', 'avena hervida'], 'cereales', 71, 2.5, 12, 1.5, 0.3, 1.7, { taza: 234, porcion: 234 }, { d: ['taza', 1] }),
  F('canela', 'Canela en polvo', ['canela'], 'otros', 247, 4, 28, 1.2, 2.2, 53, { cdita: 2.6, pizca: 0.5 }, { d: ['cdita', 1] }),
  F('avena', 'Avena instantánea (Quaker)', ['avena', 'avena instantanea', 'avena quaker', 'avena arrollada', 'copos de avena', 'quaker', 'avena instantanea quaker'], 'cereales', 373, 14, 61.7, 7.3, 1, 10, { cda: 10, taza: 90, porcion: 40 }, { d: ['porcion', 1] }),
  F('granola', 'Granola', ['granola integral', 'muesli'], 'cereales', 415, 10, 62.5, 13, 20, 6, { cda: 12, taza: 110 }, { d: ['cda', 3] }),
  F('copos_maiz', 'Copos de maíz (corn flakes)', ['copos de maiz', 'corn flakes', 'copos', 'copos carrefour', 'cereales', 'cereal'], 'cereales', 377, 7.5, 84, 1, 8, 3, { taza: 30, punado: 10, scoop: 10 }, { d: ['taza', 1] }),
  F('cereal_azucarado', 'Cereal azucarado (tipo Zucaritas)', ['zucaritas', 'choco krispis', 'froot loops', 'cereal azucarado'], 'cereales', 380, 5, 86, 1.2, 35, 2, { taza: 40, punado: 12 }, { d: ['taza', 1] }),
  F('pasas', 'Pasas de uva', ['pasas', 'pasas de uva', 'uvas pasas'], 'frutas', 300, 3.1, 75.3, 0.5, 59, 3.7, { cda: 12.5, punado: 30 }, { d: ['cda', 2] }),
  F('barrita_flow', 'Barrita de cereal Flow (frutos rojos / yogur)', ['barrita', 'barrita flow', 'barrita de cereal', 'flow cereal', 'barra de cereal', 'barritas', 'barritas de cereal'], 'dulces', 380, 3.7, 65, 11.3, 25, 2, { unidad: 24 }, { d: ['unidad', 1] }),
  F('barrita_flow_mani', 'Barrita Flow almendras, maní y miel', ['barrita de mani', 'barrita de almendras', 'flow mani', 'barrita flow mani y miel'], 'dulces', 495, 12.5, 48, 28, 25, 4, { unidad: 30 }, { d: ['unidad', 1] }),
  F('mani_crema', 'Manteca de maní', ['manteca de mani', 'mantequilla de mani', 'pasta de mani', 'peanut butter'], 'grasas', 590, 25, 14, 50, 9, 6, { cda: 20, cdita: 7 }, { d: ['cda', 1] }),
  F('pure_instantaneo', 'Puré de papas instantáneo (copos secos)', ['pure instantaneo', 'pure en copos', 'pure de papas instantaneo', 'copos de pure', 'pure carrefour', 'pure maggi', 'pure instantaneo carrefour', 'pure en escamas'], 'cereales', 355, 8, 75, 0.5, 3, 6, { paquete: 125, cda: 8, taza: 60, porcion: 60 }, { st: 'seco', d: ['porcion', 1] }),
  // puré casero: papa + leche + manteca (USDA "mashed potatoes, whole milk and butter" ≈ 113 kcal/100 g); porción de plato ≈ 200 g
  F('pure_papas', 'Puré de papas casero (con leche y manteca)', ['pure de papas', 'pure de papa', 'pure', 'pure casero', 'pure de papas casero'], 'verduras', 110, 2, 15.5, 4.3, 1.5, 1.5, { porcion: 200, cda: 30, plato: 250 }, { d: ['porcion', 1] }),
  F('pure_papas_light', 'Puré de papas solo con leche (sin manteca)', ['pure sin manteca', 'pure light', 'pure con leche descremada'], 'verduras', 83, 2.2, 16.5, 0.6, 1.8, 1.5, { porcion: 200, cda: 30, plato: 250 }, { d: ['porcion', 1] }),
  F('papa_hervida', 'Papa hervida', ['papa', 'papas', 'papas hervidas', 'papa hervida'], 'verduras', 87, 1.9, 18.3, 0.1, 0.9, 1.8, { unidad: 170, porcion: 200 }, { st: 'cocido', d: ['unidad', 1] }),
  F('papa_cruda', 'Papa cruda', ['papa cruda'], 'verduras', 77, 2, 15.4, 0.1, 0.8, 2.2, { unidad: 200 }, { st: 'crudo', d: ['unidad', 1] }),
  F('papas_horno', 'Papas al horno', ['papas al horno', 'papa al horno', 'papas asadas'], 'verduras', 110, 2.5, 20, 2.3, 1, 2, { unidad: 150, porcion: 200 }, { st: 'cocido', d: ['porcion', 1] }),
  F('papas_fritas', 'Papas fritas', ['fritas', 'papas fritas de restaurante', 'papas fritas caseras'], 'verduras', 312, 3.4, 37.6, 14.7, 0.3, 3.8, { porcion: 150 }, { st: 'cocido', d: ['porcion', 1] }),
  F('batata', 'Batata (cocida)', ['batata', 'camote', 'boniato', 'batatas'], 'verduras', 90, 2, 17.4, 0.2, 6.5, 3.3, { unidad: 200 }, { st: 'cocido', d: ['unidad', 1] }),
  F('ensalada_rusa', 'Ensalada rusa casera', ['ensalada rusa'], 'platos', 155, 2.2, 14, 9.8, 2, 1.5, { porcion: 200 }, { d: ['porcion', 1] }),
  F('choclo', 'Choclo cocido (granos)', ['choclo', 'maiz', 'granos de choclo', 'choclo en lata'], 'verduras', 96, 3.4, 18.7, 1.5, 4.5, 2.4, { unidad: 100, taza: 150, cda: 15 }, { st: 'cocido', d: ['unidad', 1] }),
  F('polenta', 'Polenta cocida', ['polenta'], 'cereales', 70, 1.6, 14.6, 0.3, 0.2, 0.5, { plato: 250 }, { st: 'cocido', d: ['plato', 1] }),
  F('harina', 'Harina de trigo 000', ['harina', 'harina 000', 'harina 0000'], 'cereales', 364, 10.3, 73.6, 1, 0.3, 2.7, { cda: 10, taza: 120 }, { d: ['cda', 1] }),

  // Platos y comidas compuestas
  F('empanada_carne', 'Empanada de carne (al horno)', ['empanada', 'empanadas', 'empanada de carne', 'empanadas de carne'], 'platos', 270, 10, 23, 15.3, 2, 1.5, { unidad: 85 }, { d: ['unidad', 1] }),
  F('empanada_jyq', 'Empanada de jamón y queso (al horno)', ['empanada de jamon y queso', 'empanadas de jamon y queso'], 'platos', 290, 11, 25, 16, 2, 1, { unidad: 80 }, { d: ['unidad', 1] }),
  F('empanada_frita', 'Empanada frita', ['empanada frita', 'empanadas fritas'], 'platos', 320, 9.5, 24, 21, 2, 1.5, { unidad: 90 }, { d: ['unidad', 1] }),
  F('pizza_muzza', 'Pizza de muzzarella', ['pizza', 'porcion de pizza', 'pizza muzzarella', 'pizza de muzza', 'pizza casera'], 'platos', 265, 11, 32, 10, 3, 2, { porcion: 125, unidad: 125 }, { d: ['porcion', 1] }),
  F('tarta', 'Tarta (jamón y queso / verdura)', ['tarta', 'tarta de jamon y queso', 'tarta de verdura', 'pascualina'], 'platos', 250, 9, 21, 14.3, 2, 1.5, { porcion: 150 }, { d: ['porcion', 1] }),
  F('sandwich_miga', 'Sándwich de miga (jamón y queso)', ['sandwich de miga', 'sanguche de miga', 'sandwiches de miga', 'miga'], 'platos', 270, 10, 26, 13.8, 3, 1.2, { unidad: 50 }, { d: ['unidad', 2] }),
  F('guiso_lentejas', 'Guiso de lentejas', ['guiso de lentejas', 'lentejas guisadas'], 'platos', 120, 7, 12, 4.5, 2, 3.5, { plato: 350 }, { d: ['plato', 1] }),
  F('guiso_arroz', 'Guiso de arroz con carne', ['guiso de arroz', 'guiso', 'guiso de arroz con carne', 'arroz guisado'], 'platos', 140, 7, 17, 4.8, 1.5, 1, { plato: 350 }, { d: ['plato', 1] }),
  F('arroz_pollo', 'Arroz con pollo', ['arroz con pollo'], 'platos', 150, 9, 18, 4.5, 1, 0.8, { plato: 350 }, { d: ['plato', 1] }),
  F('pastel_papas', 'Pastel de papas', ['pastel de papa'], 'platos', 140, 8, 11.5, 6.8, 1.5, 1.2, { porcion: 300 }, { d: ['porcion', 1] }),
  F('tortilla_papas', 'Tortilla de papas', ['tortilla', 'tortilla espanola', 'tortilla de papa'], 'platos', 160, 6, 13, 9.5, 1, 1.2, { porcion: 150 }, { d: ['porcion', 1] }),
  F('locro', 'Locro', [], 'platos', 115, 6, 11.5, 5, 2, 2, { plato: 400 }, { d: ['plato', 1] }),

  // Frutas
  F('banana', 'Banana', ['bananas', 'platano', 'banana pisada', 'banana fresca'], 'frutas', 89, 1.1, 20.2, 0.3, 12.2, 2.6, { unidad: 100, chica: 65, grande: 135 }, { d: ['unidad', 1] }),
  F('manzana', 'Manzana', ['manzanas'], 'frutas', 52, 0.3, 11.4, 0.2, 10.4, 2.4, { unidad: 170, chica: 130, grande: 220 }, { d: ['unidad', 1] }),
  F('naranja', 'Naranja', ['naranjas'], 'frutas', 47, 0.9, 9.4, 0.1, 9.4, 2.4, { unidad: 140, grande: 200 }, { d: ['unidad', 1] }),
  F('jugo_naranja', 'Jugo de naranja exprimido', ['jugo de naranja', 'jugo exprimido', 'exprimido', 'jugo de naranjas'], 'bebidas', 45, 0.7, 10.2, 0.2, 8.4, 0.2, { vaso: 200, unidad: 90 }, { liq: 1, d: ['vaso', 1] }),
  F('mandarina', 'Mandarina', ['mandarinas'], 'frutas', 53, 0.8, 11.5, 0.3, 10.6, 1.8, { unidad: 90 }, { d: ['unidad', 1] }),
  F('frutillas', 'Frutillas', ['frutilla', 'fresas'], 'frutas', 32, 0.7, 5.7, 0.3, 4.9, 2, { taza: 150, unidad: 12 }, { d: ['taza', 1] }),
  F('uvas', 'Uvas', ['uva'], 'frutas', 69, 0.7, 17.2, 0.2, 15.5, 0.9, { taza: 150 }, { d: ['taza', 1] }),
  F('pera', 'Pera', ['peras'], 'frutas', 57, 0.4, 12.1, 0.1, 9.8, 3.1, { unidad: 170 }, { d: ['unidad', 1] }),
  F('durazno', 'Durazno', ['duraznos'], 'frutas', 39, 0.9, 8, 0.3, 8.4, 1.5, { unidad: 150 }, { d: ['unidad', 1] }),
  F('kiwi', 'Kiwi', ['kiwis'], 'frutas', 61, 1.1, 11.7, 0.5, 9, 3, { unidad: 75 }, { d: ['unidad', 1] }),
  F('anana', 'Ananá', ['anana', 'piña'], 'frutas', 50, 0.5, 11.7, 0.1, 9.9, 1.4, { rodaja: 80 }, { d: ['rodaja', 2] }),
  F('sandia', 'Sandía', ['sandia'], 'frutas', 30, 0.6, 7.2, 0.2, 6.2, 0.4, { porcion: 300, rodaja: 300 }, { d: ['porcion', 1] }),
  F('melon', 'Melón', ['melon'], 'frutas', 34, 0.8, 7.3, 0.2, 7.9, 0.9, { porcion: 200 }, { d: ['porcion', 1] }),
  F('palta', 'Palta', ['paltas', 'aguacate', 'palta fresca'], 'frutas', 160, 2, 1.8, 14.7, 0.7, 6.7, { unidad: 140, porcion: 35 }, { d: ['porcion', 1] }),
  F('limon_jugo', 'Jugo de limón', ['limon', 'jugo de limon'], 'bebidas', 25, 0.4, 5.5, 0.2, 2.5, 0.3, { cda: 15, vaso: 200 }, { liq: 1, d: ['cda', 1] }),

  // Verduras
  F('tomate', 'Tomate', ['tomates', 'tomate perita'], 'verduras', 18, 0.9, 2.7, 0.2, 2.6, 1.2, { unidad: 120, rodaja: 20 }, { d: ['unidad', 1] }),
  F('lechuga', 'Lechuga', ['ensalada verde', 'hojas verdes', 'rucula', 'ensalada de lechuga'], 'verduras', 15, 1.4, 1.6, 0.2, 0.8, 1.3, { hoja: 10, punado: 25, plato: 80 }, { d: ['punado', 1] }),
  F('zanahoria', 'Zanahoria (cruda)', ['zanahoria', 'zanahoria rallada', 'zanahorias'], 'verduras', 41, 0.9, 6.8, 0.2, 4.7, 2.8, { unidad: 80 }, { st: 'crudo', d: ['unidad', 1] }),
  F('zanahoria_cocida', 'Zanahoria hervida', ['zanahoria hervida', 'zanahoria cocida'], 'verduras', 35, 0.8, 5.2, 0.2, 3.5, 3, { unidad: 75 }, { st: 'cocido', d: ['unidad', 1] }),
  F('cebolla', 'Cebolla', ['cebollas', 'cebolla de verdeo'], 'verduras', 40, 1.1, 7.6, 0.1, 4.2, 1.7, { unidad: 150 }, { d: ['unidad', 0.5] }),
  F('brocoli', 'Brócoli (cocido)', ['brocoli', 'brocolis'], 'verduras', 35, 2.4, 4, 0.4, 1.4, 3.3, { taza: 150, porcion: 100 }, { st: 'cocido', d: ['porcion', 1] }),
  F('zapallo', 'Zapallo / calabaza (cocido)', ['zapallo', 'calabaza', 'pure de zapallo', 'anco'], 'verduras', 26, 1, 5.5, 0.1, 2.8, 1, { porcion: 200 }, { st: 'cocido', d: ['porcion', 1] }),
  F('zapallito', 'Zapallito (cocido)', ['zapallito', 'zucchini', 'zapallitos'], 'verduras', 17, 1.2, 2.1, 0.3, 1.7, 1, { unidad: 200 }, { st: 'cocido', d: ['unidad', 1] }),
  F('espinaca', 'Espinaca / acelga (cocida)', ['espinaca', 'acelga'], 'verduras', 23, 3, 1.4, 0.3, 0.4, 2.4, { porcion: 150 }, { st: 'cocido', d: ['porcion', 1] }),
  F('morron', 'Morrón', ['morron', 'pimiento', 'aji morron'], 'verduras', 31, 1, 4, 0.3, 4.2, 2.1, { unidad: 150 }, { d: ['unidad', 0.5] }),
  F('champinones', 'Champiñones', ['champinones', 'champignones', 'hongos'], 'verduras', 24, 3.1, 2.3, 0.3, 2, 1, { porcion: 100 }, { d: ['porcion', 1] }),
  F('ajo', 'Ajo', ['ajos'], 'verduras', 149, 6.4, 31, 0.5, 1, 2.1, { diente: 3 }, { d: ['diente', 1] }),
  F('remolacha', 'Remolacha (cocida)', ['remolacha', 'remolachas'], 'verduras', 44, 1.7, 8, 0.2, 8, 2, { unidad: 100 }, { st: 'cocido', d: ['unidad', 1] }),
  F('pepino', 'Pepino', ['pepinos'], 'verduras', 15, 0.7, 3.1, 0.1, 1.7, 0.5, { unidad: 200 }, { d: ['unidad', 0.5] }),
  F('jardinera', 'Jardinera de verduras (lata)', ['jardinera', 'verduras en lata', 'jardinera de hortalizas', 'jardinera de hortalizas y legumbres'], 'verduras', 70, 3, 11.5, 0.3, 3, 3, { lata: 260 }, { d: ['lata', 0.5] }),
  F('pure_tomate', 'Puré de tomate', ['pure de tomate', 'tomate triturado', 'pure de tomates'], 'verduras', 32, 1.5, 5, 0.2, 4, 1.5, { cda: 15, taza: 250 }, { d: ['cda', 2] }),
  F('salsa_bolognesa', 'Salsa bolognesa (tuco con carne picada)', ['bolognesa', 'salsa bolognesa', 'tuco con carne', 'salsa con carne'], 'carnes', 115, 7.5, 6, 6.8, 4, 1.5, { cda: 15, porcion: 120, plato: 150 }, { d: ['porcion', 1] }),
  F('salsa_tuco', 'Salsa de tomate casera (tuco)', ['tuco', 'salsa de tomate', 'salsa fileto', 'fileto', 'salsa'], 'verduras', 70, 1.5, 7, 3.8, 5, 1.5, { cda: 15, porcion: 100 }, { d: ['porcion', 1] }),

  // Grasas, salsas, azúcares
  F('aceite_oliva', 'Aceite de oliva', ['aceite de oliva', 'oliva', 'aceite de oliva extra virgen'], 'grasas', 884, 0, 0, 100, 0, 0, { cda: 13.5, cdita: 4.5, chorrito: 5 }, { d: ['cda', 1] }),
  F('aceite', 'Aceite (girasol / mezcla)', ['aceite', 'aceite de girasol', 'aceite de coccion', 'aceite absorbido', 'aceite de maiz', 'aceite mezcla'], 'grasas', 884, 0, 0, 100, 0, 0, { cda: 13.5, cdita: 4.5, chorrito: 5 }, { d: ['cdita', 1] }),
  F('mayonesa', 'Mayonesa clásica', ['mayo', 'hellmanns', 'mayonesa clasica', 'mayonesa hellmanns', 'mayonesa'], 'grasas', 670, 1, 1, 73.6, 1, 0, { cda: 15, cdita: 5, sobre: 8 }, { d: ['cda', 1] }),
  F('mayonesa_light', 'Mayonesa liviana Hellmann\'s', ['mayonesa light', 'mayonesa liviana', 'mayo light', 'mayonesa liviana hellmanns'], 'grasas', 253, 1.3, 8, 24, 3, 0, { cda: 15, cdita: 5, sobre: 8 }, { d: ['cda', 1] }),
  F('ketchup', 'Ketchup', ['katchup', 'salsa ketchup'], 'salsas', 112, 1.3, 25, 0.1, 22, 0.3, { cda: 15, sobre: 8 }, { d: ['cda', 1] }),
  F('mostaza', 'Mostaza', [], 'salsas', 66, 4, 3, 3.3, 1, 3.3, { cdita: 5, cda: 15 }, { d: ['cdita', 1] }),
  F('salsa_golf', 'Salsa golf', [], 'salsas', 450, 1, 10, 45, 8, 0, { cda: 15 }, { d: ['cda', 1] }),
  F('azucar', 'Azúcar', ['azucar', 'azucar blanca', 'azucar comun'], 'dulces', 400, 0, 100, 0, 100, 0, { cdita: 5, cda: 12, sobre: 6 }, { d: ['cdita', 1] }),
  F('miel', 'Miel', [], 'dulces', 304, 0.3, 82.2, 0, 82, 0.2, { cda: 21, cdita: 7 }, { d: ['cdita', 1] }),
  F('mermelada', 'Mermelada', ['dulce', 'jalea', 'mermelada de frutilla', 'mermelada de durazno'], 'dulces', 250, 0.4, 61.5, 0.1, 48, 1, { cda: 20, cdita: 7 }, { d: ['cda', 1] }),
  F('edulcorante', 'Edulcorante', ['sacarina', 'stevia', 'sucralosa', 'gotas de edulcorante'], 'dulces', 0, 0, 0, 0, 0, 0, { unidad: 1 }, { d: ['unidad', 1] }),

  // Frutos secos y semillas
  F('mani', 'Maní tostado', ['mani', 'mani tostado', 'mani salado', 'cacahuate'], 'frutos_secos', 585, 24, 16, 50, 4, 8.5, { punado: 30, cda: 10 }, { d: ['punado', 1] }),
  F('almendras', 'Almendras', ['almendra'], 'frutos_secos', 579, 21, 9.5, 50, 4.4, 12.5, { punado: 30, unidad: 1.2 }, { d: ['punado', 1] }),
  F('nueces', 'Nueces', ['nuez'], 'frutos_secos', 654, 15, 7, 65, 2.6, 6.7, { punado: 30, unidad: 5 }, { d: ['punado', 1] }),
  F('mix_frutos_secos', 'Mix de frutos secos', ['frutos secos', 'mix', 'mix de frutos secos', 'mix de frutos'], 'frutos_secos', 600, 18, 18, 50, 8, 7, { punado: 30 }, { d: ['punado', 1] }),
  F('chia', 'Semillas de chía', ['semillas de chia'], 'frutos_secos', 486, 17, 7.7, 31, 0, 34, { cda: 12, cdita: 4 }, { d: ['cda', 1] }),

  // Bebidas
  F('cafe', 'Café (sin azúcar)', ['cafe', 'cafe solo', 'cafe negro', 'espresso', 'cafecito', 'cafe instantaneo', 'nescafe', 'cortado'], 'bebidas', 2, 0.1, 0.3, 0, 0, 0, { taza: 150 }, { liq: 1, d: ['taza', 1] }),
  F('cafe_con_leche', 'Café con leche entera (sin azúcar)', ['cafe con leche', 'lagrima', 'cafe con leche entera'], 'bebidas', 24, 1.3, 1.9, 1.2, 1.9, 0, { taza: 250, vaso: 200 }, { liq: 1, d: ['taza', 1] }),
  F('te', 'Té / mate cocido (sin azúcar)', ['te', 'mate cocido', 'infusion', 'te verde', 'tecito'], 'bebidas', 1, 0, 0.2, 0, 0, 0, { taza: 200 }, { liq: 1, d: ['taza', 1] }),
  F('mate', 'Mate (cebado, sin azúcar)', ['mates', 'yerba mate', 'mate amargo'], 'bebidas', 1, 0, 0.2, 0, 0, 0, { porcion: 500 }, { liq: 1, d: ['porcion', 1] }),
  F('gaseosa', 'Gaseosa común (cola)', ['gaseosa', 'coca', 'coca cola', 'pepsi', 'sprite', 'fanta', 'seven up', '7up'], 'bebidas', 42, 0, 10.6, 0, 10.6, 0, { vaso: 250, lata: 354, botella: 500 }, { liq: 1, d: ['vaso', 1] }),
  F('gaseosa_zero', 'Gaseosa zero / light', ['coca zero', 'gaseosa light', 'gaseosa zero', 'coca light', 'pepsi black'], 'bebidas', 0.5, 0, 0.1, 0, 0, 0, { vaso: 250, lata: 354, botella: 500 }, { liq: 1, d: ['vaso', 1] }),
  F('cerveza', 'Cerveza rubia', ['birra', 'quilmes', 'brahma', 'stella', 'golden', 'pinta', 'cerveza golden'], 'bebidas', 43, 0.5, 3.6, 0, 0, 0, { vaso: 330, lata: 473, botella: 1000, porcion: 500 }, { liq: 1, al: 3.9, d: ['vaso', 1] }),
  F('vino', 'Vino tinto', ['vino', 'malbec', 'vino blanco'], 'bebidas', 85, 0.1, 2.6, 0, 0.6, 0, { copa: 150, vaso: 200 }, { liq: 1, al: 10.6, d: ['copa', 1] }),
  F('fernet_coca', 'Fernet con coca (preparado)', ['fernet', 'fernet con coca', 'fernando'], 'bebidas', 98, 0, 8.4, 0, 8, 0, { vaso: 300 }, { liq: 1, al: 9.2, d: ['vaso', 1] }),
  F('isotonica', 'Bebida isotónica (tipo Gatorade)', ['gatorade', 'powerade', 'isotonica', 'bebida deportiva'], 'bebidas', 24, 0, 6, 0, 6, 0, { botella: 500, vaso: 250 }, { liq: 1, d: ['botella', 1] }),
];

export const CATEGORIES = {
  huevos: 'Huevos', lacteos: 'Lácteos', carnes: 'Carnes', pescados: 'Pescados', legumbres: 'Legumbres',
  cereales: 'Cereales y pastas', panes: 'Panes y galletitas', dulces: 'Dulces', frutas: 'Frutas', verduras: 'Verduras',
  grasas: 'Grasas', salsas: 'Salsas', frutos_secos: 'Frutos secos', bebidas: 'Bebidas', platos: 'Platos',
  suplementos: 'Suplementos', mis: 'Mis alimentos', recetas: 'Mis recetas',
};

for (const f of BUILTIN_FOODS) f.builtin = true;

// ---------- Índice y combinación con alimentos propios ----------
let CUSTOM = [];
let COMMUNITY = []; // aprendido de todas las personas que usan la app (ver community.js)
let SAID_MAP = new Map(); // frase dicha → id del alimento (de la comunidad)
let INDEX = new Map(BUILTIN_FOODS.map((f) => [f.id, f]));
let UNIT_OVERRIDES = {}; // { foodId: { unidad: g } } aprendido de correcciones
let SEARCH_CACHE = null;

export function setCustomFoods(list = [], overrides = {}) {
  CUSTOM = (list || []).filter((f) => f && f.id);
  UNIT_OVERRIDES = overrides || {};
  rebuildIndex();
}
function rebuildIndex() {
  INDEX = new Map(BUILTIN_FOODS.map((f) => [f.id, f]));
  for (const f of COMMUNITY) if (!INDEX.has(f.id)) INDEX.set(f.id, f);
  for (const f of CUSTOM) INDEX.set(f.id, f);
  SEARCH_CACHE = null;
  PHRASES = null;
}
/**
 * Conocimiento compartido: alimentos nuevos (con sus medidas) y frases con las que la gente los nombra.
 * foods: [{ id, n, a[], k, p, c, f, s, fb, al, u{}, liq, n_users }] ; phrases: { "frase": id }
 */
export function setCommunityFoods(foods = [], phrases = {}) {
  COMMUNITY = (foods || []).filter((f) => f && f.id && f.n && f.k >= 0).map((f) => ({ cat: 'comunidad', a: [], u: {}, s: 0, fb: 0, ...f, community: true, d: f.d || (Object.keys(f.u || {})[0] ? [Object.keys(f.u)[0], 1] : [f.liq ? 'ml' : 'g', 100]) }));
  SAID_MAP = new Map(Object.entries(phrases || {}).map(([k, v]) => [norm(k), v]));
  rebuildIndex();
}
export const communityCount = () => COMMUNITY.length;
export const getFood = (id) => (id ? INDEX.get(id) || null : null);
export const allFoods = () => Array.from(INDEX.values());
export const customFoods = () => CUSTOM.slice();

export function foodUnits(food) {
  if (!food) return {};
  return { ...(food.u || {}), ...(UNIT_OVERRIDES[food.id] || {}) };
}

/** Gramos para una cantidad en cierta unidad. null si no hay forma confiable. */
export function gramsFor(food, qty, unit) {
  const q = Number(qty);
  if (!Number.isFinite(q) || q < 0) return null;
  const u = canonUnit(unit) || unit;
  if (u === 'g' || u === 'ml') return q;
  if (u === 'kg' || u === 'l') return q * 1000;
  const units = foodUnits(food);
  if (units[u] != null) return q * units[u];
  if (u === 'unidad' && units.porcion != null) return q * units.porcion;
  if ((u === 'chica' || u === 'grande') && units.unidad != null) return q * units.unidad * (u === 'chica' ? 0.7 : 1.35);
  if (GENERIC_UNIT_G[u] != null) return q * GENERIC_UNIT_G[u];
  return null;
}
/** ¿La unidad tiene equivalencia propia del alimento (no genérica)? */
export function hasOwnUnit(food, unit) {
  const u = canonUnit(unit) || unit;
  if (u === 'g' || u === 'ml' || u === 'kg' || u === 'l') return true;
  return foodUnits(food)[u] != null;
}

export function per100Of(food) {
  return { kcal: food.k, p: food.p, c: food.c, f: food.f, s: food.s || 0, fb: food.fb || 0, al: food.al || 0 };
}

/** Macros para una cantidad en gramos */
export function calc(per100, grams) {
  const g = Math.max(0, Number(grams) || 0) / 100;
  return {
    kcal: round0((per100.kcal || 0) * g),
    p: round1((per100.p || 0) * g),
    c: round1((per100.c || 0) * g),
    f: round1((per100.f || 0) * g),
    s: round1((per100.s || 0) * g),
    fb: round1((per100.fb || 0) * g),
  };
}

/** Energía estimada por macros (Atwater; fibra 2 kcal/g, alcohol 7 kcal/g) */
export function atwater(p100) {
  return 4 * (p100.p || 0) + 4 * (p100.c || 0) + 9 * (p100.f || 0) + 2 * (p100.fb || 0) + 7 * (p100.al || 0);
}

/** Revisa y corrige valores por 100 g. Devuelve { per100, issues[] } */
export function sanitizePer100(raw = {}) {
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  const p100 = {
    kcal: num(raw.kcal), p: num(raw.p ?? raw.protein), c: num(raw.c ?? raw.carbs), f: num(raw.f ?? raw.fat),
    s: num(raw.s ?? raw.sugars), fb: num(raw.fb ?? raw.fiber), al: num(raw.al ?? raw.alcohol),
  };
  const issues = [];
  for (const k of ['p', 'c', 'f', 's', 'fb', 'al']) if (p100[k] > 100) { p100[k] = 100; issues.push('valores_imposibles'); }
  if (p100.s > p100.c + 0.5 && p100.c > 0) p100.s = p100.c;
  const solids = p100.p + p100.c + p100.f + p100.fb + p100.al;
  if (solids > 105) issues.push('valores_imposibles');
  if (p100.kcal > 900) { issues.push('kcal_imposibles'); p100.kcal = Math.min(900, atwater(p100)); }
  const est = atwater(p100);
  if (p100.kcal === 0 && est > 0) { p100.kcal = round0(est); issues.push('kcal_calculadas'); }
  else if (est > 0 && p100.kcal > 0) {
    const diff = Math.abs(p100.kcal - est);
    if (diff > Math.max(12, 0.25 * Math.max(p100.kcal, est))) {
      issues.push('kcal_ajustadas');
      p100.kcal = round0(est);
    }
  }
  for (const k of Object.keys(p100)) p100[k] = round1(p100[k]);
  return { per100: p100, issues };
}

// ---------- Búsqueda ----------
const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'al', 'a', 'en', 'y', 'sin', 'un', 'una', 'unos', 'unas', 'mi', 'para', 'por', 'tipo', 'marca', 'e', 'o']);
function singular(w) {
  if (w.length > 4 && /[^aeiou]es$/.test(w) && !/(ces|ses)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1);
  return w;
}
export function tokens(s) {
  return norm(s).replace(/[(),./-]/g, ' ').split(' ').filter((w) => w && !STOP.has(w)).map(singular);
}

function searchIndex() {
  if (SEARCH_CACHE) return SEARCH_CACHE;
  SEARCH_CACHE = allFoods().map((f) => {
    const names = [f.n, ...(f.a || [])].map((s) => ({ s: norm(s), t: tokens(s) }));
    return { f, names };
  });
  return SEARCH_CACHE;
}

export function scoreTokens(qt, ct) {
  if (!qt.length || !ct.length) return 0;
  const qs = new Set(qt); const cs = new Set(ct);
  let common = 0;
  for (const w of qs) if (cs.has(w)) common++;
  if (!common) {
    for (const w of qs) for (const c of cs) if (w.length > 3 && c.length > 3 && (w.startsWith(c) || c.startsWith(w))) common += 0.7;
  }
  if (!common) return 0;
  const allQinC = [...qs].every((w) => cs.has(w));
  const allCinQ = [...cs].every((w) => qs.has(w));
  if (allQinC && allCinQ) return 0.97;
  if (allCinQ) return 0.78 + 0.18 * (cs.size / qs.size);
  if (allQinC) return 0.72 + 0.2 * (qs.size / cs.size);
  return 0.62 * common / Math.max(qs.size, cs.size);
}

/** Busca alimentos. usage: { id: veces } para desempatar */
export function searchFoods(query, { limit = 12, usage = {}, onlyCustom = false } = {}) {
  const qn = norm(query);
  if (!qn) return [];
  const qt = tokens(query);
  const out = [];
  for (const { f, names } of searchIndex()) {
    if (onlyCustom && f.builtin) continue;
    let best = 0;
    for (const nm of names) {
      let sc = nm.s === qn ? 1 : scoreTokens(qt, nm.t);
      if (sc < 1 && nm.s.startsWith(qn) && qn.length >= 3) sc = Math.max(sc, 0.8);
      if (sc > best) best = sc;
    }
    if (best > 0.2) {
      const bonus = Math.min(0.06, Math.log10(1 + (usage[f.id] || 0)) * 0.03) + (f.builtin ? 0 : f.community ? -0.02 : 0.03);
      out.push({ food: f, score: Math.min(1, best + bonus) });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
export function bestMatch(query, opts) {
  const r = searchFoods(query, { ...opts, limit: 1 });
  return r[0] || null;
}

// ---------- Intérprete local (sin internet) ----------
const NUMWORDS = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, quince: 15, veinte: 20, media: 0.5, medio: 0.5, mitad: 0.5, cuarto: 0.25, par: 2, docena: 12,
};
export const numberWord = (w) => NUMWORDS[w];
const FILLER = /^(?:me (?:comi|tome|morfe|clave)|comi|tome|almorce|cene|desayune|meriende|y|tambien|ademas|despues|luego|un poco de|algo de|unos|unas|como|mas|agrega|agregar|pone|pon|poner|anota|anotar|eh|este)\s+/;

let PHRASES = null;
function protectPhrases(text) {
  if (!PHRASES) {
    PHRASES = [];
    for (const f of [...BUILTIN_FOODS, ...COMMUNITY]) for (const a of [f.n, ...(f.a || [])]) {
      const n = norm(a);
      if (/ (con|y) /.test(n)) PHRASES.push(n);
    }
    PHRASES.push('jamon y queso', 'dulce de leche', 'pan con manteca', 'cafe con leche', 'arroz con leche');
    PHRASES.sort((a, b) => b.length - a.length);
  }
  let t = text;
  for (const p of PHRASES) if (t.includes(p)) t = t.split(p).join(p.replace(/ /g, '\u0001'));
  return t;
}

export function splitSegments(text, withJoiners = false) {
  let t = norm(text)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bmas o menos\b|\baproximadamente\b/g, 'aprox')
    .replace(/\b(\d+|un|una|uno)\s+y\s+medi[oa]\b/g, (m, a) => `${(NUMWORDS[a] || Number(a)) + 0.5}`)
    .replace(/\b(\d+|un|una|uno)\s+([a-z]+)\s+y\s+medi[oa]\b/g, (m, a, w) => `${(NUMWORDS[a] || Number(a)) + 0.5} ${w}`);
  t = t.replace(/(\d),(\d)/g, '$1.$2'); // "1,5 l" no se corta en la coma
  t = protectPhrases(t);
  const parts = t.split(/\s*([,;+\n]|\.\s|\.$|\s(?:y|con|mas|e|ademas)\s)\s*/);
  const out = [];
  let joiner = '';
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) { joiner = parts[i].trim(); continue; }
    const seg = parts[i].replace(/\u0001/g, ' ').replace(/\.$/, '').trim();
    if (seg.length > 1) out.push({ text: seg, joiner });
    joiner = '';
  }
  return withJoiners ? out : out.map((x) => x.text);
}

const JUNK = new Set(('de del la el los las en para pone poner pon pongas agrega agregar anota anotar registra que nada mas menos aprox o y e con sin no si pero era es fue fui fuimos estaba tenia hice hizo me mi te se lo le les un una unos unas uno al a total tome tomo comi corte corto hoy ayer anteayer manana noche tarde dia dias despues luego tambien ademas entonces bueno eh este grande grandes chico chica mediano mediana medianos medianas hondo poco mucho mucha muchos todo toda resto mitad entera entero pese peso realidad gimnasio gym agua vaso vasos pecho espalda pierna piernas brazos hombros torso entrenar entrene entreno porque cuando habia ahi otra otro solo creo como algo mas tipo onda tambien ya bien').split(' '));
export const isJunkWord = (w) => JUNK.has(w);
export const isUnitWord = (w) => UNIT_LOOKUP.has(w) || UNIT_LOOKUP.has(singular(w));
export function isJunkText(text) {
  const toks = norm(text).split(' ').filter(Boolean);
  if (toks[0] === 'te' && toks.length <= 3) return false; // un té, té verde
  return !toks.some((w) => w.length >= 3 && !JUNK.has(w) && !/^\d/.test(w));
}
// Este usuario mide arroz y fideos en crudo (taza, gramos): se prefiere el crudo salvo que diga "cocido".
const RAW_PREF = { arroz_cocido: 'arroz_crudo', fideos_cocidos: 'fideos_secos' };
const RAW_UNITS = new Set(['g', 'taza', 'cda', 'paquete']);

const UNIT_WORDS = [...UNIT_LOOKUP.keys()].sort((a, b) => b.length - a.length);
const UNIT_RE = new RegExp(`(?:^|\\s)(${UNIT_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?=\\s|$)`);

export function parseSegment(seg) {
  let s = norm(seg).replace(/\b(mas o menos|aproximadamente|aprox|alrededor de|unos|unas)\b/g, ' ').replace(/\s+/g, ' ').trim();
  let guard = 0;
  while (FILLER.test(s) && guard++ < 5) s = s.replace(FILLER, '');
  // 1) peso o volumen explícito ("70 g", "250 ml", "1,5 kg")
  let grams = null; let gUnit = '';
  const mW = s.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*(kg|kilos?|kilogramos?|g|gr|grs|gramos?|ml|cc|mililitros?|l|lt|lts|litros?)(?=\s|$)/);
  if (mW) {
    let v = Number(mW[1].replace(',', '.'));
    const u = UNIT_LOOKUP.get(mW[2]) || 'g';
    if (u === 'kg') { v *= 1000; gUnit = 'g'; } else if (u === 'l') { v *= 1000; gUnit = 'ml'; } else gUnit = u;
    grams = v;
    s = (s.slice(0, mW.index) + ' ' + s.slice(mW.index + mW[0].length)).replace(/\s+/g, ' ').trim();
  }
  // 2) cantidad (número o palabra)
  let qty = null;
  const mNum = s.match(/(?:^|\s)(\d+(?:[.,]\d+)?)(?:\s*\/\s*(\d+))?\s*(?:x\b)?/);
  if (mNum) {
    qty = mNum[2] ? Number(mNum[1].replace(',', '.')) / Number(mNum[2]) : Number(mNum[1].replace(',', '.'));
    s = (s.slice(0, mNum.index) + ' ' + s.slice(mNum.index + mNum[0].length)).trim();
  } else {
    const mw = s.match(/(?:^|\s)(media docena|un cuarto|tres cuartos|un par|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|media|medio|mitad|cuarto|docena)(?=\s|$)/);
    if (mw) {
      const w = mw[1];
      qty = w === 'media docena' ? 6 : w === 'un cuarto' ? 0.25 : w === 'tres cuartos' ? 0.75 : w === 'un par' ? 2 : NUMWORDS[w];
      s = (s.slice(0, mw.index) + ' ' + s.slice(mw.index + mw[0].length)).trim();
    }
  }
  // 3) unidad casera
  let unit = '';
  const mU = s.match(UNIT_RE);
  if (mU && !['g', 'ml', 'kg', 'l'].includes(UNIT_LOOKUP.get(mU[1]))) {
    unit = UNIT_LOOKUP.get(mU[1]) || '';
    s = (s.slice(0, mU.index) + ' ' + s.slice(mU.index + mU[0].length)).trim();
  }
  let size = '';
  const mS = s.match(/(?:^|\s)(chic[oa]s?|pequen[oa]s?|grandes?|median[oa]s?)(?=\s|$)/);
  if (mS) {
    size = /^(chic|pequen)/.test(mS[1]) ? 'chica' : /^grande/.test(mS[1]) ? 'grande' : '';
    s = (s.slice(0, mS.index) + ' ' + s.slice(mS.index + mS[0].length)).trim();
  }
  s = s.replace(/^(de|del)\s+/, '').replace(/\s+(de|del)$/, '').replace(/\s+/g, ' ').trim();
  if (!s && /\btostadas?\b/.test(norm(seg))) s = 'pan lactal'; // "2 tostadas" = rebanadas de pan
  return { text: s, qty, unit, size, grams, gUnit };
}

/**
 * Interpreta un texto de comida sin IA usando la biblioteca (y referencias del usuario, si se pasan).
 * refs: { código: { name, per100?, perUnit?, units? } }
 */
export function parseLocal(text, { usage = {}, refs = null } = {}) {
  const items = [];
  const segs = splitSegments(text, true);
  const refList = refs ? Object.values(refs) : [];
  const CONT = /^(batido|licuado|shake|smoothie|bowl|tazon|ensalada|ensalada mixta|wrap|sandwich|sanguche|tostado)( proteico)?$/;
  for (let si = 0; si < segs.length; si++) {
    const { text: seg, joiner } = segs[si];
    const { text: foodText0, qty, unit, size, grams: explicitG, gUnit } = parseSegment(seg);
    // "ensalada con tomate y lechuga", "batido con leche y banana": el recipiente no es un alimento aparte
    if (CONT.test(norm(foodText0)) && segs[si + 1]?.joiner === 'con' && explicitG == null) continue;
    const prev = items[items.length - 1];
    // Cantidad suelta ("aprox 70 g", "un plato hondo") → corresponde al alimento anterior
    if ((!foodText0 || isJunkText(foodText0)) && (explicitG != null || qty != null || unit) && prev && prev.per100 && (explicitG != null ? !prev._explicitG : !prev._explicit)) {
      applyQty(prev, qty, unit, explicitG, gUnit);
      continue;
    }
    if (!foodText0 || isJunkText(foodText0)) continue;
    let foodText = foodText0;
    // "dos de jamón y queso" después de una empanada → "empanada de jamón y queso"
    if (prev && /^empanada/i.test(prev.name) && /^(de|del)\s/.test(norm(seg).replace(/^(\d+|un|una|uno|dos|tres|cuatro|cinco|seis)\s+/, ''))) foodText = 'empanada ' + foodText.replace(/^(de|del)\s+/, 'de ');
    // 1) referencias del usuario (mismo alimento que ya registró)
    let ref = null; let refScore = 0;
    if (refList.length) {
      const boost = /\b(de ayer|del otro dia|que sobro|de anoche|de siempre|el mismo|la misma)\b/.test(norm(seg)) ? 0.12 : 0;
      const qt = tokens(foodText.replace(/\b(de ayer|del otro dia|que sobro|de anoche|de siempre)\b/g, ''));
      for (const r of refList) {
        const sc = scoreTokens(qt, tokens(r.name)) + boost;
        if (sc > refScore) { refScore = sc; ref = r; }
      }
      if (refScore < 0.8) ref = null;
    }
    const viaPhrase = !ref && SAID_MAP.get(norm(foodText)) ? getFood(SAID_MAP.get(norm(foodText))) : null;
    const m = ref ? null : viaPhrase ? { food: viaPhrase, score: 0.95 } : bestMatch(foodText, { usage });
    if (!ref && (!m || m.score < 0.72)) {
      if (joiner === 'con' && prev) { prev.note = [prev.note, `Incluye "${foodText}" (revisá si cambia las calorías).`].filter(Boolean).join(' '); continue; }
      items.push({ name: capitalize(foodText), qty: qty ?? 1, unit: unit || 'porcion', grams: null, foodId: null, per100: null, confidence: 'baja', basis: 'sin_datos', note: 'No está en tu biblioteca: completá los valores o analizalo con IA cuando tengas conexión.', flags: ['sin_datos'] });
      continue;
    }
    if (ref) {
      const it = { name: ref.name, qty: qty ?? 1, unit: unit || (ref.perUnit ? ref.perUnit.unit : ''), grams: null, foodId: ref.foodId || null, per100: null, liq: !!ref.liq, confidence: 'alta', basis: 'referencia', note: 'Igual que tu registro anterior.', flags: [], _explicit: qty != null || explicitG != null };
      if (ref.perUnit && (!unit || unit === ref.perUnit.unit || unit === 'porcion' || unit === 'unidad')) {
        const q = qty ?? 1;
        it.unit = ref.perUnit.unit; it.qty = q;
        it.fixed = { kcal: Math.round(ref.perUnit.kcal * q), p: round1(ref.perUnit.p * q), c: round1(ref.perUnit.c * q), f: round1(ref.perUnit.f * q), s: round1((ref.perUnit.s || 0) * q), fb: round1((ref.perUnit.fb || 0) * q) };
      } else if (ref.per100) {
        it.per100 = { ...ref.per100 };
        if (!it.unit && explicitG == null) {
          // "1 banana" sin unidad: la medida del registro anterior, o la unidad de la biblioteca
          const ru = ref.units && Object.keys(ref.units)[0];
          const lib = ru ? null : bestMatch(ref.name);
          const lu = lib && lib.score >= 0.8 ? foodUnits(lib.food).unidad : null;
          if (ru) it.unit = ru;
          else if (lu) { it.unit = 'unidad'; it.grams = it.qty * lu; }
          else if (qty != null && qty >= 15) it.unit = ref.liq ? 'ml' : 'g';
          else { it.unit = 'porcion'; it.note = 'Sin medida: usé una porción típica, revisala.'; it.confidence = 'baja'; }
        }
        if (it.grams != null) { /* ya calculado */ } else if (explicitG != null) { it.grams = explicitG; if (qty == null) { it.qty = explicitG; it.unit = gUnit || 'g'; } }
        else if (it.unit === 'g' || it.unit === 'ml') it.grams = it.qty;
        else it.grams = (ref.units && ref.units[it.unit] ? ref.units[it.unit] : (GENERIC_UNIT_G[it.unit] || 100)) * it.qty;
      }
      if (!it.unit) it.unit = 'g';
      items.push(it);
      continue;
    }
    let food = m.food;
    let q = qty; let u = unit; let grams = null; let note = '';
    if (RAW_PREF[food.id] && (RAW_UNITS.has(u) || (explicitG != null && !u)) && !/cocid|hervid|plato/.test(norm(seg))) {
      const raw = getFood(RAW_PREF[food.id]);
      if (raw) { food = raw; note = 'Asumí que lo mediste en crudo (como en tus registros).'; }
    }
    const units = foodUnits(food);
    if (!u && size && units[size] != null) u = size;
    if (explicitG != null) {
      grams = explicitG;
      if (q != null && u) { /* "1 bollo de 70 g": cantidad + unidad, peso explícito */ }
      else if (q != null && units.unidad) u = 'unidad';
      else { q = explicitG; u = gUnit || (food.liq ? 'ml' : 'g'); }
    } else if (u === 'g' || u === 'ml' || u === 'kg' || u === 'l') grams = gramsFor(food, q ?? 100, u);
    else if (u) grams = gramsFor(food, q ?? 1, u);
    else if (q != null) {
      if (units.unidad) { u = 'unidad'; grams = q * units.unidad; }
      else if (q >= 15) { u = food.liq ? 'ml' : 'g'; grams = q; }
      else { const [du, dq] = food.d || ['porcion', 1]; u = du; grams = gramsFor(food, q * dq, du); q = q * dq; }
    } else {
      const [du, dq] = food.d || ['porcion', 1];
      u = du; q = dq; grams = gramsFor(food, dq, du); note = note || 'Sin cantidad: usé la porción típica.';
    }
    if (q == null) q = (u === 'g' || u === 'ml') ? grams : 1;
    const own = hasOwnUnit(food, u);
    const conf = ((qty != null || explicitG != null) && (own || explicitG != null || u === 'g' || u === 'ml')) ? (m.score > 0.9 ? 'alta' : 'media') : 'media';
    const item = {
      name: food.n, qty: q, unit: u, grams: grams ?? 0, foodId: food.id, per100: per100Of(food), liq: !!food.liq,
      confidence: conf, basis: food.builtin ? 'biblioteca' : food.community ? 'comunidad' : 'historial',
      note: note || (!own && u && u !== 'g' && u !== 'ml' ? `Medida genérica: 1 ${unitLabel(u)} ≈ ${Math.round(gramsFor(food, 1, u) || 0)} g.` : ''), flags: [],
      _explicit: qty != null || explicitG != null, _explicitG: explicitG != null, match: round1(m.score * 100) / 100,
    };
    // Repetición del dictado ("bondiola, un plato de bondiola"): se queda la versión con cantidad
    const dup = items.findIndex((x) => x.foodId === item.foodId);
    if (dup >= 0 && (!items[dup]._explicit || !item._explicit)) {
      if (!items[dup]._explicit) items[dup] = item;
      continue;
    }
    items.push(item);
  }
  for (const it of items) { delete it._explicit; delete it._explicitG; }
  // "batido con proteína y leche": el contenedor sin datos se descarta si hay ingredientes
  if (items.length > 1) return items.filter((it) => !(it.basis === 'sin_datos' && CONT.test(norm(it.name))));
  return items;
}

function applyQty(item, qty, unit, explicitG, gUnit) {
  const food = item.foodId ? getFood(item.foodId) : null;
  if (explicitG != null) {
    item.grams = explicitG;
    if (!(qty != null && unit)) { item.qty = explicitG; item.unit = gUnit || (item.liq ? 'ml' : 'g'); }
    else { item.qty = qty; item.unit = unit; }
  } else if (unit) {
    item.qty = qty ?? 1; item.unit = unit;
    const g = food ? gramsFor(food, item.qty, unit) : (GENERIC_UNIT_G[unit] || 100) * item.qty;
    if (g != null) item.grams = g;
  } else if (qty != null) {
    item.qty = qty;
    const g = food ? gramsFor(food, qty, item.unit) : null;
    if (g != null) item.grams = g;
  }
  item.note = '';
  item._explicit = true;
  if (explicitG != null) item._explicitG = true;
  item.confidence = 'media';
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

/** Texto de cantidad para mostrar: "2 unidades · 100 g" */
export function portionText(item) {
  const q = Number(item.qty);
  const u = item.unit;
  const g = Math.round(Number(item.grams) || 0);
  const gl = item.liq ? 'ml' : 'g';
  if (item.grams == null && !u) return '';
  if (!u || u === 'g' || u === 'ml') return `${g} ${u || gl}`;
  const qs = Number.isInteger(q) ? q : String(Math.round(q * 100) / 100).replace('.', ',');
  if (item.grams == null) return `${qs} ${unitLabel(u, q)}`;
  return `${qs} ${unitLabel(u, q)} · ${g} ${gl}`;
}
