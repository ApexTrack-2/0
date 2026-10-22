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
import { esc, fmt } from './util.js';
import { openSheet, toast } from './ui.js';

const sharedAvailable = () => !!COMMUNITY_URL && !store.S().settings.onboardAI;

/** Pide el plan al servidor (una sola vez por teléfono). */
async function planShared(text) {
  const r = await fetch(COMMUNITY_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ op: 'plan', install: installId(), text }) });
  const j = await r.json().catch(() => null);
  if (!j?.ok || !j.plan) {
    const e = j?.error;
    throw new Error(e === 'usado' ? 'El cálculo de bienvenida ya se usó en este teléfono.' : e === 'cupo' ? 'Hoy hubo muchas personas nuevas: completá tus datos a mano.' : e === 'sin_clave' ? 'El cálculo con IA de bienvenida no está disponible ahora.' : 'No se pudo calcular con IA. Completá tus datos a mano.');
  }
  store.S().settings.onboardAI = Date.now(); // ya no se vuelve a usar la clave de bienvenida
  store.save();
  return j.plan;
}

/** Paso 1: contar tus datos y calcular las metas. Devuelve true si se guardaron. */
export function aboutYou() {
  const st = profileState();
  let dict = null; let busy = false; let done = false;
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
    <p class="muted pad-b">Contame en un mensaje tu edad, altura, peso, cuánto te movés o entrenás y qué querés lograr. La IA calcula tus metas de calorías, proteína y agua.</p>
    <div class="composer"><textarea class="input" id="ob-text" rows="5" placeholder="Ej.: Tengo 28 años, soy hombre, mido 1,78 y peso 84 kg. Voy al gimnasio 4 veces por semana y quiero bajar grasa sin perder músculo.">${esc(st.aiText)}</textarea>
    ${canDictate() ? `<button class="mic-big ${dict ? 'rec' : ''}" data-o="mic" aria-label="Dictar">${icon(dict ? 'stop' : 'mic', 22)}</button>` : ''}</div>
    ${sharedAvailable() ? '' : '<p class="note">El cálculo con IA de bienvenida no está disponible: completá tus datos a mano.</p>'}`;
  const foot = () => done
    ? '<button class="btn ghost" data-o="edit">Ajustar</button><button class="btn primary" data-o="ok">Seguir</button>'
    : `<button class="btn ghost" data-o="manual">Completar a mano</button>${sharedAvailable() ? `<button class="btn primary" data-o="calc" ${busy ? 'disabled' : ''}>${busy ? '<span class="spin"></span><span>Calculando…</span>' : `${icon('sparkle', 18)} Calcular mis metas`}</button>` : ''}`;
  const s = openSheet({ title: 'Contame de vos', full: true, body: draw(), footer: foot() });
  const redraw = () => { s.setBody(draw()); s.setFooter(foot()); };
  const stop = () => { if (dict) { dict.stop(); dict = null; } };
  s.done.then(stop);
  s.body.addEventListener('input', (e) => { if (e.target.id === 'ob-text') st.aiText = e.target.value; });
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
      busy = true; redraw();
      try {
        const plan = await planShared(st.aiText.trim());
        if (!EN.GOALS[plan.goal]) throw new Error('No pude entender tus datos: contá tu edad, altura, peso y qué querés lograr, o completalos a mano.');
        mergePlan(st, plan);
        saveProfile(st);
        done = true;
      } catch (err) { toast(err.message, { kind: 'error', ms: 6000 }); }
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
