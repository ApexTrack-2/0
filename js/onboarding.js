// ApexTrack — primera vez: la persona cuenta sus datos y la IA calcula sus metas con la clave del
// desarrollador (guardada en el servidor, nunca en la app ni en el repositorio; se usa solo esta vez),
// después un mini recorrido por la app y al final cómo crear su propia clave de Gemini.
import { COMMUNITY_URL } from './config.js';
import * as store from './store.js';
import * as EN from './energy.js';
import { installId } from './community.js';
import { profileState, mergePlan, saveProfile, openGoals } from './profile.js';
import { canDictate, startDictation } from './voice.js';
import { icon } from './icons.js';
import { esc, fmt, norm } from './util.js';
import { openSheet, toast } from './ui.js';

const sharedAvailable = () => !!COMMUNITY_URL && !store.S().settings.onboardAI;

/** Despierta el servidor mientras la persona escribe (la primera consulta a Apps Script tarda más). */
function warmUp() { try { if (COMMUNITY_URL) fetch(`${COMMUNITY_URL}?op=vapid`).catch(() => {}); } catch { /* nada */ } }

const PLAN_WAIT_MS = 35000;
/** Pide el plan al servidor (una sola vez por teléfono). Si tarda más de 35 s, se corta. */
async function planShared(text) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), PLAN_WAIT_MS);
  let r;
  try {
    r = await fetch(COMMUNITY_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ op: 'plan', install: installId(), text }), signal: ctl?.signal });
  } catch (err) {
    throw new Error(err?.name === 'AbortError' ? 'La IA tardó demasiado en contestar.' : 'No se pudo conectar con la IA de bienvenida.');
  } finally { clearTimeout(timer); }
  const j = await r.json().catch(() => null);
  if (!j?.ok || !j.plan) {
    const e = j?.error;
    throw new Error(e === 'usado' ? 'El cálculo de bienvenida ya se usó en este teléfono.' : e === 'cupo' ? 'Hoy hubo muchas personas nuevas: completá tus datos a mano.' : e === 'sin_clave' ? 'El cálculo con IA de bienvenida no está disponible ahora.' : 'No se pudo calcular con IA. Completá tus datos a mano.');
  }
  store.S().settings.onboardAI = Date.now(); // ya no se vuelve a usar la clave de bienvenida
  store.save();
  return j.plan;
}

/**
 * Plan B sin IA: saca de lo que escribió la persona sexo, edad, altura, peso, objetivo y días de
 * gimnasio. Devuelve null si falta alguno de los cuatro primeros.
 */
export function localPlan(text) {
  const t = ` ${norm(text).replace(/(\d),(\d)/g, '$1.$2')} `;
  const n = (x) => Number(String(x).replace(',', '.'));
  const sex = /\b(mujer|femenin\w*|chica|nena|senora|madre|mama)\b/.test(t) ? 'f' : /\b(hombre|varon|masculin\w*|chico|senor|padre|papa)\b/.test(t) ? 'm' : null;
  let age = null; const ma = t.match(/\b(\d{1,2})\s*anos\b/); if (ma) age = n(ma[1]);
  const mb = !age && t.match(/\b(?:naci (?:en|el)\D{0,20})?(19[3-9]\d|20[01]\d)\b/); if (mb) age = new Date().getFullYear() - n(mb[1]);
  let heightCm = null;
  const mh = t.match(/\b(1\.\d{1,2}|2\.[0-2]\d?)\s*(?:m\b|mts?\b|metros?\b)?/) || t.match(/\bmido\s*(1)\s*(?:con|y)\s*(\d{1,2})\b/);
  if (mh) heightCm = mh[2] ? 100 + n(mh[2]) : Math.round(n(mh[1]) * 100);
  const mcm = !heightCm && t.match(/\b(1[4-9]\d|2[01]\d)\s*(?:cm|centimetros)\b/); if (mcm) heightCm = n(mcm[1]);
  if (heightCm && heightCm < 130) heightCm = null;
  let weightKg = null;
  const mw = t.match(/\b(?:peso|pesando|pese)\s*(?:unos|como|alrededor de|aprox\w*)?\s*(\d{2,3}(?:\.\d)?)/) || t.match(/\b(\d{2,3}(?:\.\d)?)\s*(?:kg|kilos|kgs)\b/);
  if (mw) weightKg = n(mw[1]);
  if (weightKg && (weightKg < 30 || weightKg > 300)) weightKg = null;
  const mg = t.match(/\b(?:llegar a|pesar|quedar en|objetivo (?:de|es))\s*(?:los\s*)?(\d{2,3}(?:\.\d)?)\s*(?:kg|kilos)?/);
  const goalWeightKg = mg ? n(mg[1]) : null;
  const mr = t.match(/\b(\d+(?:\.\d)?)\s*(?:(?:o|a|y)\s*(\d+(?:\.\d)?)\s*)?(?:kg|kilos)\s*(?:por|al|x|cada)\s*mes/);
  const rateKgMonth = mr ? (mr[2] ? (n(mr[1]) + n(mr[2])) / 2 : n(mr[1])) : null;
  const fat = /\b(bajar|perder|quemar)\b[^.]{0,25}\b(grasa|panza)\b/.test(t); const muscle = /\b(ganar|sumar|aumentar|sin perder)\b[^.]{0,25}\bmusculo\b|\b(tonificar|definir)\b/.test(t);
  let goal = fat && muscle ? 'recomp' : /\b(bajar|adelgazar|perder|quemar)\b/.test(t) ? 'bajar' : /\b(subir|ganar|aumentar|engordar|volumen)\b/.test(t) ? 'subir' : /\bmantener\b/.test(t) ? 'mantener' : null;
  const missing = [];
  if (!goal) { goal = goalWeightKg && weightKg ? (goalWeightKg < weightKg ? 'bajar' : 'subir') : 'mantener'; if (!goalWeightKg) missing.push('objetivo (mantener)'); }
  const md = t.match(/\b(\d)\s*(?:veces|dias)\s*(?:por|a la|x|en la)\s*semana/);
  const gymDays = md ? Math.min(7, n(md[1])) : /\b(gimnasio|gym|entreno|entrenar|pesas)\b/.test(t) ? 3 : 0;
  let level = /\bsedentari|trabajo sentad|no hago (?:nada de )?ejercicio\b/.test(t) ? 'sedentario' : gymDays >= 6 ? 'alto' : gymDays >= 3 ? 'moderado' : gymDays >= 1 ? 'ligero' : null;
  if (!level) { level = 'ligero'; missing.push('nivel de actividad'); }
  if (!sex || !age || !heightCm || !weightKg) return null;
  return {
    sex, age, heightCm, weightKg, goalWeightKg, weeks: null, rateKgMonth, goal, level, gymDays, diet: 'sin_especificar', conditions: [], preferences: '', missing, caution: '',
    explanation: `${sex === 'f' ? 'Mujer' : 'Hombre'} de ${age} años, ${(heightCm / 100).toFixed(2).replace('.', ',')} m y ${String(weightKg).replace('.', ',')} kg, ${EN.GOALS[goal]?.label.toLowerCase() || goal}`,
    local: true,
  };
}

/** Paso 1: contar tus datos y calcular las metas. Devuelve true si se guardaron. */
export function aboutYou() {
  const st = profileState();
  let dict = null; let busy = false; let done = false; let waitMsg = '';
  warmUp();
  const draw = () => done ? `
    <div class="banner">${icon('check', 20, 'ok')}<div class="grow"><b>Tus metas diarias</b><div class="muted" style="margin-top:4px;white-space:pre-line">${esc(st.explanation)}</div></div></div>
    <section class="panel" style="margin-top:12px">
      <div class="kv"><span>${icon('flame', 18)}Calorías</span><b>${fmt(st.kcal)} kcal</b></div>
      <div class="kv"><span>Proteína</span><b>${fmt(st.p)} g</b></div>
      <div class="kv"><span>Carbohidratos</span><b>${fmt(st.c)} g</b></div>
      <div class="kv"><span>Grasas</span><b>${fmt(st.f)} g</b></div>
      <div class="kv"><span>${icon('drop', 18)}Agua</span><b>${fmt((st.waterMl || 0) / 1000, 1)} L</b></div>
      ${st.goal ? `<div class="kv"><span>${icon('star', 18)}Objetivo</span><b>${esc(EN.GOALS[st.goal]?.label || '')}</b></div>` : ''}
    </section>
    <p class="note">Las podés cambiar cuando quieras en Ajustes → Perfil y metas.</p>` : `
    <label class="field"><span>¿Cómo te llamás?</span><input class="input" id="ob-name" value="${esc(st.name)}" autocomplete="given-name" placeholder="Tu nombre"></label>
    <p class="muted pad-b" style="margin-top:12px">Contame en un mensaje tu edad, altura, peso, cuánto te movés o entrenás y qué querés lograr. La IA calcula tus metas de calorías, proteína y agua.</p>
    <div class="composer"><textarea class="input" id="ob-text" rows="5" placeholder="Ej.: Tengo 28 años, soy hombre, mido 1,78 y peso 84 kg. Voy al gimnasio 4 veces por semana y quiero bajar grasa sin perder músculo.">${esc(st.aiText)}</textarea>
    ${canDictate() ? `<button class="mic-big ${dict ? 'rec' : ''}" data-o="mic" aria-label="Dictar">${icon(dict ? 'stop' : 'mic', 22)}</button>` : ''}</div>
    ${busy ? `<p class="note" id="ob-wait">${esc(waitMsg)}</p>` : ''}
    ${sharedAvailable() ? '' : '<p class="note">El cálculo con IA de bienvenida no está disponible: completá tus datos a mano.</p>'}
    <p class="note" style="margin-top:12px">Al seguir aceptás los <a href="./privacidad.html" target="_blank" rel="noopener">términos y la privacidad</a>: tu nombre y cuánto usás la app le llegan al desarrollador; tus comidas, peso y metas quedan en tu teléfono.</p>`;
  const foot = () => done
    ? '<button class="btn ghost" data-o="edit">Ajustar</button><button class="btn primary" data-o="ok">Seguir</button>'
    : `<button class="btn ghost" data-o="manual">Completar a mano</button>${sharedAvailable() ? `<button class="btn primary" data-o="calc" ${busy ? 'disabled' : ''}>${busy ? '<span class="spin"></span><span>Calculando…</span>' : `${icon('sparkle', 18)} Calcular mis metas`}</button>` : ''}`;
  const s = openSheet({ title: 'Contame de vos', full: true, body: draw(), footer: foot() });
  const redraw = () => { s.setBody(draw()); s.setFooter(foot()); };
  const stop = () => { if (dict) { dict.stop(); dict = null; } };
  s.done.then(stop);
  s.body.addEventListener('input', (e) => { if (e.target.id === 'ob-text') st.aiText = e.target.value; if (e.target.id === 'ob-name') st.name = e.target.value; });
  const handler = async (e) => {
    const b = e.target.closest('[data-o]'); if (!b || busy) return;
    const k = b.dataset.o;
    if (k === 'mic') {
      if (dict) { stop(); redraw(); return; }
      const base = st.aiText ? st.aiText + ' ' : '';
      dict = startDictation({ onText: (fin, interim) => { st.aiText = (base + fin + (interim ? ' ' + interim : '')).trim(); const ta = s.body.querySelector('#ob-text'); if (ta) ta.value = st.aiText; }, onState: (x) => { if (x !== 'escuchando') dict = null; } });
      redraw();
    } else if (k === 'calc') {
      stop();
      if ((st.aiText || '').trim().length < 12) { toast('Contá al menos tu edad, altura, peso y qué querés lograr'); return; }
      waitMsg = 'La IA está leyendo tus datos…'; busy = true; redraw();
      const t0 = Date.now();
      const tick = setInterval(() => {
        const sec = Math.round((Date.now() - t0) / 1000);
        waitMsg = sec < 8 ? 'La IA está leyendo tus datos…' : sec < 20 ? `Sigue pensando (${sec} s). La primera vez puede tardar un poco más.` : `Tarda más de lo normal (${sec} s). Si no contesta, calculo con tus datos sin IA.`;
        const w = s.body.querySelector('#ob-wait'); if (w) w.textContent = waitMsg;
      }, 1000);
      try {
        let plan;
        try {
          plan = await planShared(st.aiText.trim());
          if (!EN.GOALS[plan.goal]) throw new Error('No pude entender tus datos: contá tu edad, altura, peso y qué querés lograr, o completalos a mano.');
        } catch (err) {
          // plan B: lo que se entiende del texto sin IA
          plan = localPlan(st.aiText);
          if (!plan) throw err;
          toast('La IA no contestó: calculé tus metas con los datos que escribiste. Revisalas.', { ms: 6000 });
        }
        mergePlan(st, plan);
        saveProfile(st);
        done = true;
      } catch (err) { toast(err.message, { kind: 'error', ms: 6000 }); }
      clearInterval(tick);
      busy = false; redraw();
    } else if (k === 'manual') { stop(); s.close('manual'); }
    else if (k === 'edit') { s.close('edit'); }
    else if (k === 'ok') s.close('ok');
  };
  s.body.addEventListener('click', handler);
  s.foot.addEventListener('click', handler);
  return s.done.then(async (v) => {
    if (v === 'manual' || v === 'edit') await openGoals();
    return v;
  });
}

// ---------------------------------------------------------------------------
// Mini recorrido
// ---------------------------------------------------------------------------
const SLIDES = [
  ['mic', 'Registrá como en un mensaje', 'Tocá el micrófono y contá qué comiste: "almuerzo 2 milanesas con puré y una banana, tomé la creatina y 3 vasos de agua". La app separa todo y hace las cuentas.'],
  ['home', 'Tu día de un vistazo', 'En Hoy ves las calorías, la proteína, el agua, los hábitos y el gimnasio. Tocá cualquier comida para corregir una cantidad.'],
  ['bolt', 'Dos inteligencias', 'Lo que la app ya conoce lo resuelve al instante y sin internet. Lo nuevo (marcas, platos raros, fotos) lo analiza Gemini con tu clave gratuita.'],
  ['meal', '¿Qué como ahora?', 'En Hoy → "¿Qué como?" te propone opciones de lo que ya comiste y nuevas, ajustadas a lo que te falta del día.'],
  ['up', 'Tu pestaña', 'Entre el micrófono y Progreso hay una pestaña a elección (Gimnasio, Estudio, Hábitos, Actividad, Ayuno, Ideas o Sueño). Con la flechita de arriba cambiás a las otras.'],
  ['bell', 'Recordatorios y resumen semanal', 'En Ajustes → Recordatorios elegís qué te avisa (almuerzo, agua, suplementos…). Cada lunes te llega el resumen de tu semana con qué mejorar.'],
];
export function miniTour() {
  let i = 0;
  const draw = () => {
    const [ic, t, d] = SLIDES[i];
    return `<div class="tour"><div class="tour-ic">${icon(ic, 40)}</div><h2>${esc(t)}</h2><p>${esc(d)}</p>
      <div class="tour-dots">${SLIDES.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div></div>`;
  };
  const foot = () => `<button class="btn ghost" data-t="skip">Saltar</button><button class="btn primary" data-t="next">${i < SLIDES.length - 1 ? 'Siguiente' : 'Listo'}</button>`;
  const s = openSheet({ title: `Cómo se usa · ${i + 1} de ${SLIDES.length}`, body: draw(), footer: foot() });
  s.foot.addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    if (b.dataset.t === 'skip' || i >= SLIDES.length - 1) { s.close(true); return; }
    i++; s.setTitle(`Cómo se usa · ${i + 1} de ${SLIDES.length}`); s.setBody(draw()); s.setFooter(foot());
  });
  return s.done;
}

// ---------------------------------------------------------------------------
// Tu propia clave
// ---------------------------------------------------------------------------
export function keyIntro() {
  const s = openSheet({ title: 'Último paso: tu clave de IA', full: true, body: `
    <p class="muted pad-b">Para analizar tus comidas, la app usa Google Gemini con <b>tu propia clave gratuita</b>. Se crea en 1 minuto y queda guardada solo en este teléfono.</p>
    <ol class="steps">
      <li>Tocá <b>Crear mi clave</b>: se abre Google AI Studio. Entrá con tu cuenta de Google.</li>
      <li>Tocá <b>Create API key</b> (Crear clave de API) y copiala.</li>
      <li>Volvé a ApexTrack, tocá <b>Ya la copié</b> y pegala.</li>
    </ol>
    <a class="btn" style="width:100%;margin-top:8px" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">${icon('link', 18)} Crear mi clave</a>
    <p class="note" style="margin-top:12px">Sin clave igual podés usar la app: la IA propia calcula lo que ya conoce.</p>`,
  footer: '<button class="btn ghost" data-k="later">Más tarde</button><button class="btn primary" data-k="paste">Ya la copié</button>' });
  s.foot.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) s.close(b.dataset.k); });
  return s.done;
}

// ---------------------------------------------------------------------------
// Instalar la app desde Chrome
// ---------------------------------------------------------------------------
let installEvent = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });
  window.addEventListener('appinstalled', () => { installEvent = null; });
}
const isInstalled = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);

/** Explica cómo instalar ApexTrack como app (si ya está instalada, no aparece). */
export function installGuide({ force = false } = {}) {
  if (isInstalled() && !force) return Promise.resolve(false);
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const steps = ios
    ? `<li>Abrí esta página en <b>Safari</b>.</li>
      <li>Tocá el botón <b>Compartir</b> (el cuadrado con la flecha hacia arriba).</li>
      <li>Elegí <b>Agregar a inicio</b> y tocá <b>Agregar</b>.</li>
      <li>Abrí ApexTrack desde el ícono nuevo. Si te pide permisos (notificaciones, micrófono o cámara), tocá <b>Permitir</b>.</li>`
    : `<li>En Chrome, tocá los <b>3 puntitos</b> ${icon('more', 16)} de arriba a la derecha.</li>
      <li>Elegí <b>Agregar a la pantalla principal</b> (o <b>Instalar aplicación</b>).</li>
      <li>Tocá <b>Instalar</b>. Si Chrome pide permisos o confirmación, aceptalos.</li>
      <li>Desde ahora abrí ApexTrack con el <b>ícono</b> de la pantalla de inicio, no desde Chrome. Cuando la app te pida permisos (notificaciones, micrófono o cámara), tocá <b>Permitir</b>: los usa para los recordatorios, el dictado y las fotos.</li>`;
  const s = openSheet({ title: 'Instalá ApexTrack como app', full: true, body: `
    <p class="muted pad-b">Instalada se abre como cualquier app, a pantalla completa, funciona sin internet, te manda recordatorios y tus datos quedan mejor protegidos.</p>
    ${installEvent ? `<button class="btn primary" style="width:100%;margin-bottom:14px" data-i="now">${icon('download', 18)} Instalar ahora</button><p class="note" style="margin-top:-6px">Si el botón no aparece o no funciona, seguí estos pasos:</p>` : ''}
    <ol class="steps">${steps}</ol>`,
  footer: '<button class="btn primary" data-i="ok">Entendido</button>' });
  s.body.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-i="now"]') || !installEvent) return;
    const ev = installEvent; installEvent = null;
    try { await ev.prompt(); const r = await ev.userChoice; if (r?.outcome === 'accepted') s.close(true); } catch { /* sigue con los pasos */ }
  });
  s.foot.addEventListener('click', (e) => { if (e.target.closest('[data-i]')) s.close(true); });
  return s.done;
}
