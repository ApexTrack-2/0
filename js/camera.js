// ApexTrack — fotos (plato o etiqueta) y lector de código de barras con Open Food Facts.
import { openSheet, promptText } from './ui.js';
import { icon } from './icons.js';
import { round1 } from './util.js';

/** Abre la cámara o la galería y devuelve la imagen reducida (JPEG). */
export function pickImage({ gallery = false } = {}) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    if (!gallery) inp.setAttribute('capture', 'environment');
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      inp.remove();
      if (!f) return resolve(null);
      try { resolve(await shrink(f)); } catch { resolve(null); }
    };
    // si cancela, no hay evento: se limpia más tarde
    setTimeout(() => { if (document.body.contains(inp) && !inp.files?.length) inp.remove(); }, 120000);
    inp.click();
  });
}

export async function shrink(file, max = 1280, q = 0.82) {
  const url = URL.createObjectURL(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  const dataUrl = c.toDataURL('image/jpeg', q);
  return { mime: 'image/jpeg', data: dataUrl.split(',')[1], url: dataUrl };
}

export const canScan = () => 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

/** Lector de código de barras en vivo. Devuelve el código o null. */
export function scanBarcode() {
  if (!canScan()) {
    return promptText({ title: 'Código de barras', label: 'Escribí los números del código', inputmode: 'numeric', placeholder: '7790…' });
  }
  const s = openSheet({
    title: 'Escaneá el código', cls: 'sheet-compact',
    body: `<div style="position:relative;border-radius:16px;overflow:hidden;background:#000;aspect-ratio:4/3">
      <video playsinline muted style="width:100%;height:100%;object-fit:cover"></video>
      <div style="position:absolute;left:12%;right:12%;top:42%;height:2px;background:#fff;opacity:.8;box-shadow:0 0 12px #fff"></div></div>
      <p class="muted" style="font-size:14px;margin:10px 2px 0">Apuntá al código de barras del envase.</p>`,
    footer: `<button class="btn ghost" data-manual>${icon('edit', 18)} Escribirlo</button>`,
  });
  let stream = null; let stop = false;
  const video = s.body.querySelector('video');
  const cleanup = () => { stop = true; if (stream) stream.getTracks().forEach((t) => t.stop()); };
  s.done.then(cleanup);
  s.foot.querySelector('[data-manual]').onclick = async () => {
    cleanup();
    const v = await promptText({ title: 'Código de barras', label: 'Números del código', inputmode: 'numeric' });
    s.close(v || null);
  };
  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (stop) { cleanup(); return; }
      video.srcObject = stream; await video.play();
      const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
      const loop = async () => {
        if (stop) return;
        try {
          const codes = await det.detect(video);
          if (codes && codes.length) { navigator.vibrate?.(30); s.close(codes[0].rawValue); return; }
        } catch { /* sigue intentando */ }
        setTimeout(loop, 220);
      };
      loop();
    } catch {
      s.body.querySelector('p').textContent = 'No se pudo abrir la cámara. Escribí el código a mano.';
    }
  })();
  return s.done.then((v) => v || null);
}

/** Busca el producto en Open Food Facts. Devuelve { name, brand, per100, serving } o null. */
export async function lookupBarcode(code) {
  const clean = String(code || '').replace(/\D/g, '');
  if (clean.length < 8) return null;
  const url = `https://world.openfoodfacts.org/api/v2/product/${clean}.json?fields=product_name,product_name_es,brands,quantity,serving_size,serving_quantity,nutriments`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    if (j.status !== 1 || !j.product) return null;
    const p = j.product; const n = p.nutriments || {};
    const kcal = n['energy-kcal_100g'] ?? (n['energy_100g'] ? n['energy_100g'] / 4.184 : null);
    if (kcal == null) return { name: p.product_name_es || p.product_name || 'Producto', brand: p.brands || '', per100: null, code: clean };
    return {
      code: clean,
      name: p.product_name_es || p.product_name || 'Producto',
      brand: (p.brands || '').split(',')[0].trim(),
      quantity: p.quantity || '',
      serving: Number(p.serving_quantity) || null,
      per100: {
        kcal: round1(kcal), p: round1(n.proteins_100g || 0), c: round1(n.carbohydrates_100g || 0), f: round1(n.fat_100g || 0),
        s: round1(n.sugars_100g || 0), fb: round1(n.fiber_100g || 0),
      },
      liq: /ml|l\b|litro/i.test(p.quantity || ''),
    };
  } catch { return null; } finally { clearTimeout(t); }
}
