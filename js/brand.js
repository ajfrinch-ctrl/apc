/* One place for the institute look every surface shares: the top bar, the
   downloaded PDFs and the offline receipts all read the same name, slogan and
   logo file. The logo is the app's own asset (assets/icons/logo-128.png) — no
   second copy of it is ever created. */
export const BRAND_NAME = 'Active Plus Coaching';
export const BRAND_TAGLINE = 'শিখতে থাকো, এগিয়ে যাও';
export const BRAND_LOGO = 'assets/icons/logo-128.png';
export const BRAND_LOGO_LARGE = 'assets/icons/app-logo.png';
export const brandLogoSrc = (base = import.meta.url) => new URL(`../${BRAND_LOGO}`, base).href;
export const brandLogoLargeSrc = (base = import.meta.url) => new URL(`../${BRAND_LOGO_LARGE}`, base).href;

/* ---------- PDF watermark --------------------------------------------------
   Every generated PDF (reports, exam papers, activity sheets, payment
   receipts/statements) carries the institute logo as a faint diagonal
   watermark behind the content. The transparent app-logo is already in the
   offline precache, and a failed decode never breaks a document: the stamp
   is simply skipped. */
let watermarkPromise = null;
/** Cached Promise<Image|null> — null when the logo cannot be decoded. */
export function loadWatermark() {
  if (!watermarkPromise) {
    watermarkPromise = new Promise(resolve => {
      try {
        if (typeof Image !== 'function') return resolve(null); // non-browser env
        const img = new Image();
        // A stubbed/blocked Image must never hang a document: give up politely.
        const timer = setTimeout(() => resolve(null), 2000);
        img.onload = () => { clearTimeout(timer); resolve(img); };
        img.onerror = () => { clearTimeout(timer); resolve(null); };
        img.src = brandLogoLargeSrc();
      } catch { resolve(null); }
    });
  }
  return watermarkPromise;
}
/** Draw the logo faintly, rotated, centred — call right after the paper fill. */
export function drawWatermark(ctx, w, h, logo) {
  if (!logo || !logo.naturalWidth) return;
  const side = Math.min(w, h);
  const lw = side * 0.6, lh = lw * (logo.naturalHeight / logo.naturalWidth);
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 6);
  ctx.drawImage(logo, -lw / 2, -lh / 2, lw, lh);
  ctx.restore();
}
