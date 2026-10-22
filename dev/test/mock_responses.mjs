// Respuestas simuladas "tipo Gemini" para validar el procesamiento (no la IA en sí).
const T = '2026-10-17', Y = '2026-10-16', A = '2026-10-15';
const N = (kcal, protein, carbs, fat, sugars = 0, fiber = 0) => ({ kcal, protein, carbs, fat, sugars, fiber });
const I = (date, moment, name, quantity, unit, grams, per100, basis = 'tabla', confidence = 'media', extra = {}) =>
  ({ date, moment, name, ref: null, quantity, unit, grams, per100, state: 'listo', basis, confidence, assumption: null, source: null, fraction: null, ingredients: [], ...extra });
const R = (o) => ({ transcript: '', items: [], water: [], habits: [], gym: [], weight: [], skipped: [], questions: [], ...o });

export const MOCKS = {
  t1: R({ items: [
    I(T, 'Almuerzo', 'Empanadas caseras de carne con masa de hojaldre, al horno', 6, 'unidad', 510, N(318, 9.5, 24, 20.5, 2, 1.2), 'estimacion', 'media', { assumption: 'Asumí relleno de carne y 85 g por empanada' }),
    I(T, 'Merienda', 'Galletitas Traviata (Bagley)', 0.5, 'paquete', 50, N(432, 10, 66, 14, 2, 2.6), 'web', 'baja', { assumption: 'Paquete de 101 g → medio = 50 g', source: 'Tabla nutricional Traviata, bagley.com.ar' }),
    I(T, 'Merienda', 'Banana', 170, 'g', 170, N(89, 1.1, 20.2, 0.3, 12.2, 2.6)),
    I(T, 'Merienda', 'Avena instantánea Quaker', 65, 'g', 65, N(373, 14, 61.7, 7.3, 1, 10), 'referencia', 'alta', { ref: 'F2' }),
    I(T, 'Merienda', 'Manteca de maní', 40, 'g', 40, N(590, 25, 14, 50, 9, 6)),
    I(T, 'Merienda', 'Leche La Serenísima Protein', 250, 'ml', 250, N(41.5, 5, 4.6, 0, 4.6, 0), 'web', 'alta'),
    I(T, 'Merienda', 'Azúcar', 2, 'cdita', 10, N(400, 0, 100, 0, 100, 0), 'tabla', 'alta'),
  ], habits: [{ date: T, habit: 'Creatina', done: true }] }),
  t2: R({ items: [
    I(Y, 'Media tarde', 'Bombones de chocolate rellenos', 3, 'unidad', 48, N(530, 6, 58, 30, 50, 0), 'tabla', 'media', { assumption: 'Bombones de 16 g' }),
    I(Y, 'Cena', 'Bondiola de cerdo a la plancha', 1, 'plato', 200, N(240, 25, 0, 15.5, 0, 0), 'tabla', 'media', { state: 'cocido' }),
    I(Y, 'Cena', 'Puré de papas instantáneo (copos)', 0.5, 'paquete', 62.5, N(355, 8, 75, 0.5, 3, 6), 'tabla', 'media', { assumption: 'Paquete de 125 g; preparado con agua' }),
    I(Y, 'Cena', 'Pan francés', 1, 'unidad', 70, N(275, 9, 55, 1.3, 1.5, 2.5)),
    I(Y, 'Cena', 'Mayonesa', 1, 'cda', 15, N(670, 1, 1, 73.6, 1, 0)),
    I(T, 'Almuerzo', 'Arroz blanco largo fino (crudo)', 0.5, 'taza', 90, N(356, 7, 78.5, 0.6, 0.1, 1), 'tabla', 'media', { state: 'crudo', assumption: 'Arroz medido en crudo' }),
    I(T, 'Almuerzo', 'Carne vacuna para salsa', 150, 'g', 150, N(175, 21, 0, 10, 0, 0), 'tabla', 'media', { state: 'crudo' }),
    I(T, 'Almuerzo', 'Salsa de arvejas y puré de tomate', 1, 'porcion', 120, N(52, 3.1, 7.8, 0.3, 4, 3), 'estimacion', 'baja', {
      ingredients: [{ name: 'Arvejas', grams: 60, per100: N(84, 5.4, 10.1, 0.2, 5.9, 5.5) }, { name: 'Puré de tomate', grams: 60, per100: N(32, 1.5, 5, 0.2, 4, 1.5) }] }),
    I(T, 'Almuerzo', 'Aceite de oliva', 1, 'cda', 13.5, N(884, 0, 0, 100, 0, 0), 'tabla', 'alta'),
    I(T, 'Media tarde', 'Banana', 1, 'unidad', 120, N(89, 1.1, 20.2, 0.3, 12.2, 2.6)),
    I(T, 'Media tarde', 'Café', 1, 'taza', 150, N(2, 0.1, 0.3, 0, 0, 0)),
    I(T, 'Merienda', 'Huevos a la plancha sin aceite', 4, 'unidad', 200, N(143, 12.6, 0.7, 9.5, 0.4, 0)),
    I(T, 'Merienda', 'Pan francés', 80, 'g', 80, N(275, 9, 55, 1.3, 1.5, 2.5)),
    I(T, 'Merienda', 'Queso cremoso', 70, 'g', 70, N(300, 20, 2, 24, 0.5, 0), 'referencia', 'alta', { ref: 'F1' }),
    I(T, 'Merienda', 'Puré de tomate', 2, 'cda', 30, N(32, 1.5, 5, 0.2, 4, 1.5)),
  ], water: [{ date: Y, ml: 750, mode: 'sumar' }, { date: T, ml: 500, mode: 'sumar' }],
     gym: [{ date: Y, status: 'no_fui', detail: null }], skipped: [{ date: T, moment: 'Desayuno' }] }),
  t3: R({ items: [
    I(T, 'Desayuno', 'Bizcochuelo casero proteico de banana, avena y chocolate', 1, 'porcion', 90, N(305, 10.4, 46.7, 8.9, 27, 3), 'referencia', 'alta', { ref: 'R1' }),
    I(T, 'Almuerzo', 'Hamburguesa de carne vacuna a la plancha', 90, 'g', 90, N(220, 19, 0, 15.8, 0, 0), 'tabla', 'alta', { state: 'cocido' }),
    I(T, 'Almuerzo', 'Brócoli cocido', 68, 'g', 68, N(35, 2.4, 4, 0.4, 1.4, 3.3), 'tabla', 'alta'),
    I(T, 'Almuerzo', 'Ensalada rusa casera (mucha papa)', 450, 'g', 450, N(150, 2.2, 14, 9.5, 1.8, 2), 'estimacion', 'media', {
      assumption: 'Proporción con mucha papa y 45 g de mayonesa',
      ingredients: [
        { name: 'Papa hervida', grams: 320, per100: N(87, 1.9, 18.3, 0.1, 0.9, 1.8) },
        { name: 'Arvejas', grams: 40, per100: N(84, 5.4, 10.1, 0.2, 5.9, 5.5) },
        { name: 'Zanahoria hervida', grams: 45, per100: N(35, 0.8, 5.2, 0.2, 3.5, 3) },
        { name: 'Mayonesa', grams: 45, per100: N(670, 1, 1, 73.6, 1, 0) },
      ] }),
  ], water: [{ date: T, ml: 500, mode: 'sumar' }] }),
  n1: R({ items: [
    I(Y, 'Cena', 'Big Mac (McDonald\'s)', 1, 'unidad', 214, N(257, 12, 21, 14, 4.5, 1.6), 'web', 'alta', { source: 'Información nutricional McDonald\'s Argentina' }),
    I(Y, 'Cena', 'Papas fritas medianas McDonald\'s', 1, 'porcion', 117, N(274, 3.4, 33, 14.1, 0.3, 3.5), 'web', 'alta'),
    I(Y, 'Cena', 'Coca-Cola mediana', 500, 'ml', 500, N(42, 0, 10.6, 0, 10.6, 0), 'web', 'media', { assumption: 'Vaso mediano de 500 ml' }),
    I(T, 'Desayuno', 'Alfajor Jorgito de chocolate', 1, 'unidad', 55, N(422, 4.7, 66, 15, 40, 1.8), 'web', 'alta'),
    I(T, 'Desayuno', 'Café con leche entera', 1, 'taza', 250, N(24, 1.3, 1.9, 1.2, 1.9, 0)),
  ] }),
  n2: R({ items: [
    I(T, 'Merienda', 'Bizcochuelo casero (2 de 8 porciones)', 2, 'porcion', 185, N(330, 6, 50, 12, 28, 1), 'tabla', 'media', { fraction: 0.25,
      ingredients: [
        { name: 'Huevos', grams: 150, per100: N(143, 12.6, 0.7, 9.5, 0.4, 0) },
        { name: 'Harina 000', grams: 200, per100: N(364, 10.3, 73.6, 1, 0.3, 2.7) },
        { name: 'Azúcar', grams: 150, per100: N(400, 0, 100, 0, 100, 0) },
        { name: 'Aceite de girasol', grams: 92, per100: N(884, 0, 0, 100, 0, 0) },
        { name: 'Leche entera', grams: 200, per100: N(58, 3.1, 4.7, 3, 4.7, 0) },
      ] }),
  ] }),
  n3: R({ items: [
    I(T, 'Almuerzo', 'Poke de salmón con arroz, palta, edamame y salsa de soja (grande)', 1, 'plato', 520, N(150, 7.5, 18, 5, 2, 1.8), 'estimacion', 'media', {
      ingredients: [
        { name: 'Arroz de sushi cocido', grams: 220, per100: N(140, 2.6, 30.5, 0.4, 3, 0.4) },
        { name: 'Salmón crudo', grams: 120, per100: N(208, 20, 0, 13.4, 0, 0) },
        { name: 'Palta', grams: 60, per100: N(160, 2, 1.8, 14.7, 0.7, 6.7) },
        { name: 'Edamame', grams: 70, per100: N(121, 11.9, 3.6, 5.2, 2.2, 5.2) },
        { name: 'Salsa de soja', grams: 20, per100: N(53, 8, 4.9, 0.6, 0.4, 0.8) },
      ] }),
  ], water: [{ date: T, ml: 1000, mode: 'sumar' }], weight: [{ date: T, kg: 61.4 }] }),
  n4: R({ items: [
    I(T, 'Post-entreno', 'Proteína Whey Star Nutrition (2 scoops)', 2, 'scoop', 60, N(390, 76, 8, 6, 4, 0), 'web', 'alta'),
    I(T, 'Post-entreno', 'Leche descremada', 300, 'ml', 300, N(35, 3.4, 5, 0.2, 5, 0)),
    I(T, 'Post-entreno', 'Banana', 1, 'unidad', 120, N(89, 1.1, 20.2, 0.3, 12.2, 2.6)),
  ], gym: [{ date: T, status: 'fui', detail: 'Pecho y espalda' }] }),
  n5: R({ items: [
    I(T, 'Cena', 'Fideos secos (crudos)', 250, 'g', 250, N(352, 12, 71, 1.4, 2.7, 2.5), 'tabla', 'media', { state: 'crudo', assumption: 'Fideos pesados en crudo, como suele registrar' }),
    I(T, 'Cena', 'Salsa bolognesa casera', 1, 'porcion', 180, N(120, 8, 6, 7, 3.5, 1.2), 'estimacion', 'baja'),
    I(T, 'Cena', 'Queso rallado', 2, 'cda', 20, N(395, 32, 2, 29, 0, 0)),
    I(T, 'Cena', 'Vino tinto', 1, 'vaso', 200, N(85, 0.1, 2.6, 0, 0.6, 0)),
  ], questions: ['¿Los 250 g de fideos eran en crudo o ya cocidos?'] }),
  n6: R({ habits: [{ date: T, habit: 'Creatina', done: false }, { date: T, habit: 'Citrato de magnesio', done: true }], gym: [{ date: T, status: 'descanso', detail: null }] }),
  n7: R({ items: [
    I(T, 'Cena', 'Empanada de carne frita', 1, 'unidad', 95, N(320, 9.5, 24, 21, 2, 1.5)),
    I(T, 'Cena', 'Empanada de jamón y queso al horno', 2, 'unidad', 160, N(290, 11, 25, 16, 2, 1)),
    I(T, 'Cena', 'Empanada de humita al horno', 1, 'unidad', 85, N(255, 6.5, 30, 12, 6, 2)),
  ] }),
  n8: R({ items: [
    I(A, 'Almuerzo', 'Guiso de lentejas con chorizo colorado y panceta', 1, 'plato', 400, N(165, 9, 13.5, 8, 2, 4.5), 'estimacion', 'media', { assumption: 'Plato hondo de 400 g' }),
  ] }),
  n9: R({ items: [
    I(T, 'Almuerzo', 'Milanesa napolitana', 1, 'unidad', 250, N(240, 18, 11, 13.5, 1.5, 0.8)),
    I(T, 'Almuerzo', 'Papas fritas (porción grande)', 1, 'porcion', 220, N(312, 3.4, 37.6, 14.7, 0.3, 3.8)),
    I(T, 'Almuerzo', 'Gaseosa light', 1, 'vaso', 350, N(0.5, 0, 0.1, 0, 0, 0)),
  ] }),
  n10: R({ water: [{ date: T, ml: 2000, mode: 'fijar' }] }),
  n11: R({ items: [
    I(T, 'Media mañana', 'Yogur bebible La Serenísima frutilla', 200, 'g', 200, N(80, 2.8, 13, 1.7, 12, 0), 'web', 'alta'),
    I(T, 'Media mañana', 'Almendras', 1, 'punado', 30, N(579, 21, 9.5, 50, 4.4, 12.5)),
  ] }),
  n12: R({ items: [
    I(T, 'Desayuno', 'Tostado de jamón y queso en pan de miga', 3, 'unidad', 270, N(290, 13, 28, 14, 3, 1.2)),
    I(T, 'Desayuno', 'Jugo de naranja Cepita', 200, 'ml', 200, N(45, 0.5, 10.5, 0, 9.5, 0), 'web', 'alta'),
  ] }),
};

// Respuestas "defectuosas" para probar las validaciones
export const BAD = R({ items: [
  // kcal incoherente con macros (debería ajustarse)
  I(T, 'Cena', 'Pollo grillado', 200, 'g', 200, N(500, 31, 0, 3.6, 0, 0)),
  // huevo con peso por unidad absurdo (debería marcar porción)
  I(T, 'Cena', 'Huevo', 2, 'unidad', 400, N(143, 12.6, 0.7, 9.5, 0.4, 0)),
  // fecha fuera de rango (debería volver a la fecha por defecto)
  I('2025-01-01', 'Cena', 'Banana', 1, 'unidad', 100, N(89, 1.1, 20.2, 0.3, 12.2, 2.6)),
  // momento desconocido → por defecto ; unidad rara
  I(T, 'Picada de la noche', 'Maní', 1, 'bowl', 0, N(585, 24, 16, 50, 4, 8.5)),
  // sin per100
  { date: T, moment: 'Cena', name: 'Cosa rara', quantity: 1, unit: 'unidad', grams: 50, basis: 'estimacion', confidence: 'baja' },
], water: [{ date: T, ml: 99999, mode: 'sumar' }], weight: [{ date: T, kg: 6.14 }] });
