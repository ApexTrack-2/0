// ApexTrack — voz: dictado en vivo (reconocimiento del navegador) y grabación de audio para la IA.
import { blobToBase64 } from './util.js';

const SR = () => window.SpeechRecognition || window.webkitSpeechRecognition;
export const canDictate = () => !!SR();
export const canRecord = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

/**
 * Dictado continuo. En Android el reconocedor se corta solo tras una pausa: se reinicia
 * automáticamente hasta que el usuario toca "detener".
 * onText(finalAcumulado, parcial) ; onState('escuchando'|'detenido'|'error', mensaje)
 */
/**
 * Une lo dictado: cada frase final del reconocedor corresponde a una pausa al hablar, así que se separa
 * con una coma (sirve para separar los alimentos). No se agrega si la frase nueva empieza con un
 * conector ("y", "con", "de"…) o si ya hay puntuación.
 */
const CONNECTOR = /^(y|e|o|u|con|de|del|sin|a|al|en|que|pero|más|mas|para|por|aprox|aproximadamente|gramos|g|ml|kilos?|litros?)\b/i;
export function joinPhrase(prev, next, commas = true) {
  const a = String(prev || '').replace(/\s+/g, ' ').trim();
  const b = String(next || '').replace(/\s+/g, ' ').trim();
  if (!a) return b;
  if (!b) return a;
  const sep = commas && !/[,.;:!?]$/.test(a) && !/^[,.;:!?]/.test(b) && !CONNECTOR.test(b) ? ', ' : ' ';
  return a + sep + b;
}

export function startDictation({ onText, onState, lang = 'es-AR', commas = true }) {
  const Ctor = SR();
  if (!Ctor) { onState?.('error', 'Este navegador no permite dictar. Probá con Chrome o usá "Grabar audio".'); return null; }
  let active = true;
  let finalText = '';
  let rec = null;
  let restarts = 0;
  const startOne = () => {
    rec = new Ctor();
    rec.lang = lang;
    rec.continuous = false; // más estable en Android que continuous=true (evita frases repetidas)
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText = joinPhrase(finalText, r[0].transcript, commas);
        else interim += r[0].transcript;
      }
      onText?.(finalText, interim.trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      active = false;
      const msg = e.error === 'not-allowed' || e.error === 'service-not-allowed'
        ? 'Permití el micrófono para dictar (candado de la barra de direcciones → Micrófono).'
        : e.error === 'network' ? 'El dictado necesita internet. Sin conexión, escribí o grabá un audio.'
          : 'El dictado se interrumpió. Volvé a tocar el micrófono.';
      onState?.('error', msg);
    };
    rec.onend = () => {
      if (active && restarts < 60) { restarts++; try { startOne(); } catch { active = false; onState?.('detenido'); } }
      else onState?.('detenido');
    };
    try { rec.start(); onState?.('escuchando'); } catch { active = false; onState?.('error', 'No se pudo iniciar el micrófono.'); }
  };
  startOne();
  return {
    stop() { active = false; try { rec && rec.stop(); } catch { /* ya detenido */ } },
    get text() { return finalText; },
  };
}

/**
 * Graba audio y lo convierte a WAV mono de 16 kHz (formato aceptado por Gemini).
 */
export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  const mimeType = types.find((t) => window.MediaRecorder.isTypeSupported?.(t)) || '';
  const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  const t0 = Date.now();
  mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  mr.start(250);
  const stopTracks = () => stream.getTracks().forEach((t) => t.stop());
  return {
    get seconds() { return (Date.now() - t0) / 1000; },
    cancel() { try { mr.stop(); } catch { /* */ } stopTracks(); },
    stop() {
      return new Promise((resolve, reject) => {
        mr.onstop = async () => {
          stopTracks();
          try {
            const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
            const wav = await toWav16k(blob);
            resolve({ mime: 'audio/wav', data: await blobToBase64(wav), seconds: (Date.now() - t0) / 1000, url: URL.createObjectURL(wav) });
          } catch (err) {
            // si el navegador no puede decodificar, se envía el original
            try {
              const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
              resolve({ mime: (mr.mimeType || 'audio/webm').split(';')[0], data: await blobToBase64(blob), seconds: (Date.now() - t0) / 1000, url: URL.createObjectURL(blob) });
            } catch (e2) { reject(e2); }
          }
        };
        try { mr.stop(); } catch (e) { reject(e); }
      });
    },
  };
}

async function toWav16k(blob) {
  const buf = await blob.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const audio = await ctx.decodeAudioData(buf.slice(0));
  ctx.close?.();
  const rate = 16000;
  const len = Math.ceil(audio.duration * rate);
  const off = new OfflineAudioContext(1, len, rate);
  const src = off.createBufferSource();
  src.buffer = audio; src.connect(off.destination); src.start();
  const rendered = await off.startRendering();
  const pcm = rendered.getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  w(36, 'data'); out.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) { const s = Math.max(-1, Math.min(1, pcm[i])); out.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([out], { type: 'audio/wav' });
}
