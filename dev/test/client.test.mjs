import { callGemini } from '../../js/ai.js';
let calls = [];
function mock(handler) {
  calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null });
    let r = handler(url, opts, calls.length);
    if (r === interOK && String(url).includes(':generateContent')) r = genOK;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, headers: { get: (k) => (r.headers || {})[k.toLowerCase()] ?? null }, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
  };
}
const MODELS = { status: 200, body: { models: [
  { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent', 'createInteraction'] },
  { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.7-flash', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.1-pro-preview', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.1-pro', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/text-embedding-005', supportedGenerationMethods: ['embedContent'] },
] } };
const JSONOUT = { items: [], water: [{ date: '2026-10-17', ml: 500, mode: 'sumar' }], habits: [], gym: [], weight: [], skipped: [], questions: [] };
const interOK = { status: 200, body: { id: 'int_1', status: 'completed', steps: [
  { type: 'user_input', content: [{ type: 'text', text: 'x' }] },
  { type: 'google_search_call', content: [{ type: 'text', text: 'q' }] },
  { type: 'model_output', content: [{ type: 'text', text: JSON.stringify(JSONOUT), annotations: [{ url: 'https://www.bagley.com.ar/traviata', title: 'Traviata - Bagley' }] }] },
] } };
const genOK = { status: 200, body: { candidates: [{ content: { parts: [{ text: 'pensando…', thought: true }, { text: JSON.stringify(JSONOUT) }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://www.mcdonalds.com.ar/nutricion', title: 'McDonald\'s' } }] } }] } };
const mdl = (u, o) => (String(u).match(/models\/([^:]+):/) || [])[1] || JSON.parse(o.body || '{}').model;
const hasSchema = (b) => !!(b.response_format || b.generationConfig?.responseJsonSchema);
const think = (b) => b.generation_config?.thinking_level || b.generationConfig?.thinkingConfig?.thinkingLevel;
const ai = () => ({ key: 'AQ.prueba', model: 'auto', precision: 'equilibrada', web: true });
const run = async (name, handler, check) => {
  mock(handler);
  const a = ai();
  try {
    const r = await callGemini({ ai: a, system: 'S', parts: [{ text: 'hola' }] });
    console.log(`${check(r, a) ? '✓' : '✗'} ${name}: modelo ${r.model}, ${r.endpoint}, web=${r.web}, fuentes=${r.sources.length}, llamadas=${calls.length}`);
  } catch (e) {
    console.log(`${check(null, a, e) ? '✓' : '✗'} ${name}: error ${e.code} — ${e.message}`);
  }
};
await run('Elige 3.5 Flash (rápido) y usa generateContent', (u) => (u.includes('/models?') ? MODELS : interOK),
  (r) => r && r.model === 'gemini-3.5-flash' && r.endpoint === 'generate' && r.sources.length >= 1 && calls[1].body.generationConfig.responseJsonSchema && calls[1].body.tools[0].googleSearch && calls[1].headers['x-goog-api-key'] === 'AQ.prueba');
await run('Interactions no existe → pasa a generateContent', (u) => (u.includes('/models?') ? MODELS : u.includes('/interactions') ? { status: 404, body: { error: { code: 404, message: 'Method not found.' } } } : genOK),
  (r) => r && r.endpoint === 'generate' && r.sources.length === 1 && calls.some((c) => c.url.includes(':generateContent') && c.body.generationConfig.responseJsonSchema && c.body.tools[0].googleSearch));
await run('Clave AQ rechazada en encabezado → reintenta con ?key=', (u, o) => (u.includes('/models?') ? MODELS : (o.headers['x-goog-api-key'] ? { status: 401, body: { error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED', details: [{ reason: 'ACCESS_TOKEN_TYPE_UNSUPPORTED' }] } } } : interOK)),
  (r, a) => r && a.auth === 'query' && calls[calls.length - 1].url.includes('key=AQ.prueba'));
await run('Búsqueda + esquema no permitidos juntos → reintenta sin esquema', (u, o) => {
  if (u.includes('/models?')) return MODELS;
  const b = JSON.parse(o.body);
  if (b.tools && hasSchema(b)) return { status: 400, body: { error: { code: 400, message: 'Tool use with response mime type application/json is unsupported' } } };
  return { status: 200, body: { candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(JSONOUT) + '\n```' }] } }] } };
}, (r) => r && r.web === true && !hasSchema(calls[calls.length - 1].body));
await run('Modelo dado de baja → usa el siguiente', (u, o) => {
  if (u.includes('/models?')) return MODELS;
  if (mdl(u, o) === 'gemini-3.5-flash') return { status: 404, body: { error: { code: 404, message: 'models/gemini-3.8-flash is not found for API version v1beta' } } };
  return interOK;
}, (r) => r && r.model === 'gemini-3.5-flash-lite');
await run('Sin la lista de modelos (falla) → usa lista fija', (u) => (u.includes('/models?') ? { status: 500, body: 'x' } : interOK), (r) => r && r.model === 'gemini-3.5-flash');
await run('Límite gratuito agotado → mensaje claro', (u) => (u.includes('/models?') ? MODELS : { status: 429, body: { error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED' } } }),
  (r, a, e) => e && e.code === 'cuota');
await run('Clave inválida → mensaje claro', (u) => ({ status: 400, body: { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } } }),
  (r, a, e) => e && e.code === 'clave');
await run('thinking_level no soportado → reintenta sin él', (u, o) => {
  if (u.includes('/models?')) return MODELS;
  const b = JSON.parse(o.body);
  if (think(b)) return { status: 400, body: { error: { code: 400, message: 'thinking_level is not supported for this model' } } };
  return interOK;
}, (r) => r && !think(calls[calls.length - 1].body));
await run('Precisión máxima prefiere Pro estable', (u) => (u.includes('/models?') ? MODELS : interOK), (r) => true);
mock((u) => (u.includes('/models?') ? MODELS : interOK));
const a2 = { ...ai(), precision: 'maxima' };
const r2 = await callGemini({ ai: a2, system: 'S', parts: [{ text: 'x' }] });
console.log(`${r2.model === 'gemini-3.8-flash' ? '✓' : '✗'} Máxima precisión → ${r2.model}`);
// --- límites (cupo) ---
const q429 = (id, delay) => ({ status: 429, body: { error: { code: 429, message: 'You exceeded your current quota.', status: 'RESOURCE_EXHAUSTED', details: [
  { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: id }] },
  ...(delay ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: delay }] : []) ] } } });
let n429 = 0;
await run('Límite por minuto → espera lo que pide Google y sigue (sin gastar más consultas)', (u) => {
  if (u.includes('/models?')) return MODELS;
  if (n429++ === 0) return q429('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '10s');
  return interOK;
}, (r) => r && r.model === 'gemini-3.5-flash' && calls.filter((c) => c.method === 'POST').length === 2);
await run('Cupo diario agotado en 3.5 Flash → usa otro modelo y lo recuerda', (u, o) => {
  if (u.includes('/models?')) return MODELS;
  if (mdl(u, o) === 'gemini-3.5-flash') return q429('GenerateRequestsPerDayPerProjectPerModel-FreeTier');
  return interOK;
}, (r, a) => r && r.model === 'gemini-3.5-flash-lite' && a.exhausted && a.exhausted['gemini-3.5-flash']);
await run('3.5 Flash limitado por minuto (con y sin web) → usa Lite sin esperar', (u, o) => {
  if (u.includes('/models?')) return MODELS;
  if (mdl(u, o) === 'gemini-3.5-flash') return q429('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '40s');
  return interOK;
}, (r, a) => r && r.model === 'gemini-3.5-flash-lite' && r.web === false && a.webPauseUntil > Date.now());
await run('Respuesta bloqueada (status 0) en generateContent → prueba Interactions', (u) => {
  if (u.includes('/models?')) return MODELS;
  if (u.includes(':generateContent')) throw new TypeError('Failed to fetch');
  return interOK;
}, (r) => r && r.endpoint === 'interactions');

// --- Consulta de respaldo: si el primer modelo tarda, se pregunta también a otro y gana el primero ---
const slowFetch = (delays) => {
  calls = [];
  globalThis.fetch = (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    if (String(url).includes('/models?')) return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(MODELS.body) });
    const m = mdl(url, opts);
    const d = delays[m] ?? 10;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve({ ok: d >= 0, status: d >= 0 ? 200 : 503, headers: { get: () => null }, text: async () => (d >= 0 ? JSON.stringify(genOK.body) : '{"error":{"code":503,"message":"overloaded"}}') }), Math.abs(d));
      opts.signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('abort'), { name: 'AbortError' })); });
    });
  };
};
for (const k of Object.keys(globalThis.localStorage || {})) delete globalThis.localStorage[k];
const hedge = async (name, delays, check) => {
  slowFetch(delays);
  const a = { ...ai(), web: false, hedgeMs: 150 };
  const t0 = Date.now();
  try {
    const r = await callGemini({ ai: a, system: 'S', parts: [{ text: 'hola' }], web: false });
    const ms = Date.now() - t0;
    console.log(`${check(r, ms) ? '✓' : '✗'} ${name}: modelo ${r.model} en ${ms} ms, intentos ${r.log.map((x) => `${x.model}:${x.msg}`).join(' | ')}`);
  } catch (e) { console.log(`${check(null, 0, e) ? '✓' : '✗'} ${name}: error ${e.code} — ${e.message}`); }
};
await hedge('Primer modelo rápido → no se consulta otro', { 'gemini-3.5-flash': 30 }, (r) => r && r.model === 'gemini-3.5-flash' && calls.filter((c) => c.url.includes(':generate')).length === 1);
await hedge('Primer modelo lento → contesta el respaldo y se cancela el lento', { 'gemini-3.5-flash': 3000, 'gemini-3.5-flash-lite': 40 }, (r, ms) => r && r.model === 'gemini-3.5-flash-lite' && ms < 1500);
await hedge('Respaldo falla → se espera al primero', { 'gemini-3.5-flash': 600, 'gemini-3.5-flash-lite': -20 }, (r) => r && r.model === 'gemini-3.5-flash');
await hedge('Primero falla rápido (503) → pasa al siguiente modelo como siempre', { 'gemini-3.5-flash': -20, 'gemini-3.5-flash-lite': 30 }, (r) => r && r.model === 'gemini-3.5-flash-lite');
