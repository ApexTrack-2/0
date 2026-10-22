// Firma VAPID del servidor (server/comunidad.gs): se verifica con WebCrypto, que es lo que hace Google.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
const signed = (buf) => [...buf].map((x) => (x > 127 ? x - 256 : x));
const props = {}; const sent = []; const sheets = {}; const cacheMem = {};
const Sheet = () => ({ rows: [], appendRow(r) { this.rows.push(r); }, setFrozenRows() {}, getLastRow() { return this.rows.length; }, deleteRow(n) { this.rows.splice(n - 1, 1); },
  getRange(row, col, n = 1, m = 1) { const self = this; return { setValues(v) { v.forEach((r, i) => { self.rows[row - 1 + i] = self.rows[row - 1 + i] || []; r.forEach((c, j) => { self.rows[row - 1 + i][col - 1 + j] = c; }); }); }, setValue(v) { self.rows[row - 1][col - 1] = v; }, getValue() { return self.rows[row - 1][col - 1]; }, getValues() { return self.rows.slice(row - 1, row - 1 + n).map((r) => r.slice(col - 1, col - 1 + m)); } }; } });
const ctx = {
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (alg, s) => signed(crypto.createHash('sha256').update(typeof s === 'string' ? Buffer.from(s, 'utf8') : Buffer.from(s.map((x) => (x + 256) % 256))).digest()),
    base64EncodeWebSafe: (b) => Buffer.from(b.map((x) => (x + 256) % 256)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    getUuid: () => crypto.randomUUID(),
    formatDate: (d, tz, f) => d.toISOString().slice(0, 10).replace(/-/g, f === 'yyyyMMdd' ? '' : '-'),
    newBlob: (s) => ({ getBytes: () => signed(Buffer.from(s, 'utf8')) }),
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
  CacheService: { getScriptCache: () => ({ get: (k) => cacheMem[k] ?? null, put: (k, v) => { cacheMem[k] = v; } }) },
  UrlFetchApp: { fetch: (url, o) => {
    sent.push({ url, o });
    if (url.includes('generativelanguage')) {
      const plan = { sex: 'f', age: 30, heightCm: 165, weightKg: 70, goal: 'bajar', level: 'moderado', kcal: 1700, protein: 130, carbs: 170, fat: 55, explanation: 'ok' };
      return { getResponseCode: () => (url.includes('3.5-flash:') ? 503 : 200), getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(plan) }] } }] }) };
    }
    return { getResponseCode: () => (url.includes('vencida') ? 410 : 201) };
  } },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = Sheet()) }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create() {} }) }) }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
  Logger: { log() {} }, BigInt, Date, JSON, Math, Number, String, Object, Array,
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../../server/comunidad.gs', import.meta.url), 'utf8'), ctx);
const res = [];
const ok = (n, c, x = '') => res.push(`${c ? '✓' : '✗'} ${n}${x ? ' — ' + x : ''}`);

const t0 = Date.now();
ctx.instalarAvisos();
ok('Genera claves VAPID', /^[A-Za-z0-9_-]{87}$/.test(props.vapid_pub) && props.vapid_priv.length > 50, `${props.vapid_pub.slice(0, 20)}… en ${Date.now() - t0} ms`);
const pubRaw = Buffer.from(props.vapid_pub, 'base64url');
const key = await crypto.webcrypto.subtle.importKey('raw', pubRaw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
let allOk = true; let t1 = Date.now();
for (let i = 0; i < 5; i++) {
  const jwt = ctx.firmarJwt_('https://fcm.googleapis.com', props.vapid_priv);
  const [h, p, sig] = jwt.split('.');
  const good = await crypto.webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(sig, 'base64url'), Buffer.from(`${h}.${p}`));
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  if (!good || claims.aud !== 'https://fcm.googleapis.com' || !/^mailto:/.test(claims.sub)) allOk = false;
}
ok('El JWT firmado es válido para WebCrypto (5 de 5)', allOk, `${Math.round((Date.now() - t1) / 5)} ms por firma`);
const pubJSON = JSON.parse(ctx.doGet({ parameter: { op: 'vapid' } }).text);
ok('Entrega la clave pública', pubJSON.ok && pubJSON.key === props.vapid_pub);

// suscripción y envío
const now = Date.now();
const post = (b) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(b) } }).text);
const r1 = post({ op: 'avisos', sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'x', auth: 'y' } }, times: [now - 60000, now + 3600000, now - 3 * 3600000] });
post({ op: 'avisos', sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/vencida' }, times: [now - 1000] });
ok('Guarda la suscripción con sus horarios', r1.ok && r1.horarios === 2 && sheets.avisos.rows.length === 3, JSON.stringify(r1));
post({ op: 'avisos', sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc' }, times: [now - 60000, now + 7200000] });
ok('Actualizar no duplica', sheets.avisos.rows.length === 3);
ctx.enviarAvisos();
const s1 = sent.filter((x) => x.url.endsWith('/abc'));
ok('Envía el push vencido con firma VAPID', s1.length === 1 && /^vapid t=.+, k=/.test(s1[0].o.headers.Authorization), s1[0]?.o.headers.Authorization.slice(0, 40));
ok('Borra suscripciones vencidas (410)', sheets.avisos.rows.length === 2);
ctx.enviarAvisos();
ok('No repite el mismo aviso', sent.filter((x) => x.url.endsWith('/abc')).length === 1);
post({ op: 'baja', sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc' } });
ok('Baja', sheets.avisos.rows.length === 1);

// bienvenida con la clave del desarrollador (guardada en el servidor)
const plan = (b) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ op: 'plan', ...b }) } }).text);
ok('Sin clave guardada: lo dice', plan({ install: 'ins_a', text: 'mujer 30 años 1,65 70 kg quiero bajar' }).error === 'sin_clave');
props.GEMINI_KEY = 'AQ.prueba';
const p1 = plan({ install: 'ins_a', text: 'mujer 30 años 1,65 70 kg quiero bajar' });
const call = sent.filter((x) => x.url.includes('generativelanguage')).pop();
ok('Calcula el plan (y si un modelo falla, usa otro)', p1.ok && p1.plan.kcal === 1700 && p1.model === 'gemini-3.5-flash-lite' && call.o.headers['x-goog-api-key'] === 'AQ.prueba', JSON.stringify(p1).slice(0, 80));
ok('La clave nunca vuelve al teléfono', !JSON.stringify(p1).includes('AQ.prueba'));
plan({ install: 'ins_a', text: 'mujer 30 años 1,65 70 kg quiero bajar' });
ok('Como mucho 2 veces por teléfono', plan({ install: 'ins_a', text: 'mujer 30 años 1,65 70 kg quiero bajar' }).error === 'usado');
ok('Rechaza pedidos sin instalación válida', plan({ install: 'x', text: 'hola hola hola' }).error === 'datos');
console.log(res.join('\n'));
