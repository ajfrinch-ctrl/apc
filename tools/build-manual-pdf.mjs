/* Builds the Active Plus Coaching manual PDF from docs/manual/*.html.
   Usage: node tools/build-manual-pdf.mjs
   Requires node_modules (npm ci) — uses the bundled @sparticuz/chromium.

   TOC page numbers: Chromium can't resolve target-counter()/leader(), so this
   script computes them itself: for every TOC link it renders the document
   truncated right after the anchor and uses the resulting PDF's page count as
   the anchor's page number (every .page section starts on a fresh sheet). It
   then injects dotted-leader + page-number spans into the TOC markup and
   renders the final PDF. */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcPath = resolve(root, 'docs/manual/active-plus-coaching-manual.html');
const out = resolve(root, 'docs/manual/Active-Plus-Coaching-Manual.pdf');

const require = createRequire(import.meta.url);
const sparticuz = require('@sparticuz/chromium');
const { chromium } = require('playwright-core');
const { PDFParse } = require('pdf-parse');

// On non-AmazonLinux platforms the bundled AL2023 libs (libnss3, libnspr4…) are
// not inflated automatically — do it explicitly and put them on LD_LIBRARY_PATH.
const binDir = resolve(root, 'node_modules/@sparticuz/chromium/bin');
const lambdafsPath = resolve(root, 'node_modules/@sparticuz/chromium/build/lambdafs.js');
const { inflate } = await import('file://' + lambdafsPath);
const alDir = `${process.env.TMPDIR || '/tmp'}/al2023`;
await inflate(resolve(binDir, 'al2023.tar.br'));
const executablePath = await sparticuz.default.executablePath();
const ldPath = [`${alDir}/lib`, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');

// The bundled Chromium is single-process and tends to die after page.pdf(),
// so each render gets a fresh browser instance.
const tmpDir = dirname(srcPath);
let tmpSeq = 0;
async function renderToBuffer(html) {
  const tmpFile = resolve(tmpDir, `.manual-build-tmp-${process.pid}-${tmpSeq++}.html`);
  writeFileSync(tmpFile, html);
  const browser = await chromium.launch({
    executablePath,
    args: [...sparticuz.default.args, '--font-render-hinting=none'],
    headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: ldPath }
  });
  let pdf;
  try {
    const page = await browser.newPage();
    await page.goto('file://' + tmpFile, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts?.ready);
    pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;font-size:7pt;color:#5c766b;padding:0 14mm;display:flex;justify-content:space-between;font-family:sans-serif"><span>Active Plus Coaching — Full Manual, Vol. 1</span><span class="pageNumber"></span></div>',
    margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' }
    });
  } finally {
    await browser.close();
    try { require('node:fs').unlinkSync(tmpFile); } catch {}
  }
  return pdf;
}

const html = readFileSync(srcPath, 'utf8');

// ---------- collect TOC links ----------
const navMatch = html.match(/<nav class="toc">[\s\S]*?<\/nav>/);
if (!navMatch) throw new Error('TOC nav not found');
const tocLinks = [...navMatch[0].matchAll(/<a href="#([^"]+)"[^>]*>[\s\S]*?<\/a>/g)]
  .map(m => ({ id: m[1], raw: m[0] }));

// ---------- find element span in the source for an anchor id ----------
function elementSpan(id) {
  const openRe = new RegExp(`<(h1|h2|h3|section)([^>]*) id="${id}"([^>]*)>`);
  const m = html.match(openRe);
  if (!m) return null;
  const tag = m[1];
  if (tag !== 'section') {
    const closeIdx = html.indexOf(`</${tag}>`, m.index);
    return closeIdx === -1 ? null : closeIdx + `</${tag}>`.length;
  }
  const inner = html.slice(m.index);
  const h = inner.match(/<h[123][^>]*>[\s\S]*?<\/h[123]>/);
  return h ? m.index + h.index + h[0].length : null;
}

// Chromium gives no element→page mapping and the subset font's ToUnicode map is
// lossy for Bengali, so count pages of the document truncated right after the
// anchor — every .page section starts on a fresh sheet, so the anchor's own
// page is exactly the page count of that truncated document.
async function pageCountOf(markup) {
  const pdf = await renderToBuffer(markup);
  const parser = new PDFParse({ data: new Uint8Array(pdf) });
  const info = await parser.getText();
  const n = (info.pages || []).length;
  await parser.destroy();
  return n;
}

const totalPages = await pageCountOf(html);
console.log(`Pass 1 rendered ${totalPages} pages; locating ${tocLinks.length} TOC anchors…`);

const pageFor = new Map();
const missing = [];
for (const link of tocLinks) {
  const end = elementSpan(link.id);
  if (!end) { missing.push(link.id); continue; }
  const truncated = html.slice(0, end) + '\n</body></html>';
  pageFor.set(link.id, await pageCountOf(truncated));
}
if (missing.length) {
  console.warn('WARNING: no element with id:', missing.join(', '));
}
for (const [id, pg] of pageFor) console.log(`  #${id} → page ${pg}`);
const pages = { length: totalPages }; // for the final log line

// ---------- pass 2: inject leader + page number into TOC ----------
let finalHtml = html.replace(
  /(<a href="#[^"]+"[^>]*>)([\s\S]*?)(<\/a>)/g,
  (full, open, body, close) => {
    if (!navMatch[0].includes(full)) return full;
    const id = open.match(/href="#([^"]+)"/)[1];
    const pg = pageFor.get(id);
    if (!pg) return full;
    return `${open}${body}<span class="fill"></span><span class="pg">${pg}</span>${close}`;
  }
);
// CSS: replace the (unsupported) leader/target-counter ::after with flex layout
finalHtml = finalHtml.replace(
  /\.toc a::after[^\n]*\n/,
  '.toc a { display: flex; align-items: baseline; gap: 2mm; }\n.toc a .fill { flex: 1 1 auto; border-bottom: 1px dotted #b9cdc1; transform: translateY(-1mm); }\n.toc a .pg { color: var(--soft); font-variant-numeric: tabular-nums; }\n'
);

const pdf = await renderToBuffer(finalHtml);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, pdf);
console.log('Wrote', out, `(${pages.length} pages)`);
