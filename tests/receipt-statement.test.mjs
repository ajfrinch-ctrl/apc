/* The downloaded payment document is plain paper, not a screenshot of the
   dashboard. Only canvas/font encoding APIs missing in jsdom are mocked. */
import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Blob as NodeBlob } from 'node:buffer';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadPage } from './jsdom-harness.mjs';
import { STORAGE_KEYS } from '../js/config.js';

const ADDRESS = 'কলেজ রোড, দিনাজপুর সদর';
const TAGLINE = 'শিখতে থাকো, এগিয়ে যাও';
const TX = {
  id: 'TX-STATEMENT', receiptNo: 'R-STATEMENT-01', date: '২ অক্টোবর ২০২৬',
  studentName: 'নমুনা শিক্ষার্থী', studentId: 'DEMO-0001', className: 'দশম শ্রেণি',
  feeType: 'মাসিক বেতন', month: 'অক্টোবর ২০২৬', method: 'নগদ', trxRef: 'REF-TEST',
  amount: 800, status: 'approved', collectedBy: 'নমুনা কাউন্টার',
  note: 'পরীক্ষার নমুনা — এটি প্রকৃত লেনদেন নয়'
};
let page, engine, fake, imageDecodes = 0, cacheHits = 0;
const draws = [], fills = [], outlines = [], images = [], strokes = [], fontSources = [];

before(async () => {
  page = await loadPage('payment.html');
  fake = {
    font: '', fillStyle: '', textAlign: 'left', strokeStyle: '', lineWidth: 1,
    measureText: value => ({ width: String(value).length * 8 }),
    fillText: (value, x, y) => draws.push({ text: String(value), x, y, font: fake.font, fill: fake.fillStyle }),
    fillRect: (...rect) => fills.push({ rect, fill: fake.fillStyle }),
    strokeRect: (...rect) => outlines.push(rect),
    drawImage: (...args) => images.push(args),
    beginPath() {}, moveTo() {}, lineTo() {}, scale() {},
    stroke: () => strokes.push({ color: fake.strokeStyle, width: fake.lineWidth })
  };
  page.window.HTMLCanvasElement.prototype.getContext = () => fake;
  page.window.HTMLCanvasElement.prototype.toBlob = (callback, mime) => callback(new NodeBlob([new Uint8Array([255,216,0,255,217])], { type: mime }));
  page.window.Image.prototype.decode = async () => { imageDecodes++; };
  globalThis.FontFace = class FontFace {
    constructor(name, source) { this.family = name; fontSources.push(source); }
    async load() { return this; }
  };
  globalThis.caches = { async match(url) {
    assert.match(url, /\/assets\/fonts\/NotoSansBengali-Variable\.woff2$/);
    cacheHits++;
    return { async arrayBuffer() { return new Uint8Array([1,2,3]).buffer; } };
  } };
  globalThis.Blob = NodeBlob;
  Object.defineProperty(page.document, 'fonts', { value: { add() {} }, configurable: true });
  engine = await import('../js/finance-receipt.js');
});

beforeEach(() => {
  for (const list of [draws, fills, outlines, images, strokes]) list.length = 0;
  page.window.localStorage.setItem(STORAGE_KEYS.appConfig, JSON.stringify({ tagline: TAGLINE, campusAddress: ADDRESS }));
});

const texts = () => draws.map(draw => draw.text);

test('statement generation uses cached Bengali font bytes, never the logo or a PDF service', async () => {
  await engine.renderReceiptCanvas(TX);
  assert.ok(cacheHits >= 1, 'the offline app cache supplies the font');
  assert.ok(fontSources[0] instanceof ArrayBuffer, 'FontFace receives cached bytes, not a network URL');
  assert.equal(imageDecodes, 0, 'a text statement must not even load the coloured logo');
  assert.equal(images.length, 0);
});

test('the statement is black text on white paper without dashboard cards, borders or artwork', async () => {
  const canvas = await engine.renderReceiptCanvas(TX);
  assert.ok(texts().includes('পেমেন্ট স্টেটমেন্ট'));
  assert.ok(draws.every(draw => draw.fill === '#000000'), 'every text line uses black ink');
  assert.equal(fills.length, 1, 'only the white paper background is painted');
  assert.equal(fills[0].fill, '#ffffff');
  assert.equal(fills[0].rect[0], 0);
  assert.equal(fills[0].rect[1], 0);
  assert.equal(outlines.length, 0, 'no decorative outer border or card');
  assert.equal(images.length, 0);
  assert.ok(strokes.every(stroke => stroke.color === '#555555' && stroke.width <= 1), 'only thin grayscale rules');
  assert.ok(canvas.width > 0 && canvas.height > 0);
});

test('the PDF header contains one address and no legacy slogan/address row', async () => {
  for (const tagline of [`${TAGLINE} • ${ADDRESS}`, `${TAGLINE}, ${ADDRESS}`, `${ADDRESS} / ${ADDRESS}`, ADDRESS]) {
    draws.length = 0;
    const saved = JSON.stringify({ tagline, campusAddress: ADDRESS });
    page.window.localStorage.setItem(STORAGE_KEYS.appConfig, saved);
    await engine.renderReceiptCanvas(TX);
    assert.equal(texts().filter(text => text.includes(ADDRESS)).length, 1, tagline);
    assert.equal(texts().some(text => text.includes(TAGLINE)), false, 'the simple statement omits the promotional tagline entirely');
    assert.equal(page.window.localStorage.getItem(STORAGE_KEYS.appConfig), saved);
  }
});

test('pending, rejected and approved statements state the actual status without a paid badge', async () => {
  for (const [status, line, amountLabel] of [
    ['pending', 'অবস্থা: অনুমোদন বাকি', 'অনুমোদনাধীন টাকা'],
    ['rejected', 'অবস্থা: বাতিল', 'রেকর্ডকৃত টাকা (বাতিল)'],
    ['approved', 'অবস্থা: পরিশোধিত', 'মোট পরিশোধিত টাকা']
  ]) {
    draws.length = 0;
    const tx = { ...TX, status };
    const before = JSON.stringify(tx);
    await engine.renderReceiptCanvas(tx);
    assert.ok(texts().includes(line), status);
    assert.ok(texts().join(' ').includes(amountLabel), status);
    if (status !== 'approved') assert.equal(texts().some(text => text.includes('পরিশোধিত')), false, 'an unapproved entry is not labelled paid');
    assert.equal(JSON.stringify(tx), before, 'document formatting never changes the transaction');
  }
});

test('the simple statement retains the transaction, reference, amount, note and review reason', async () => {
  const tx = { ...TX, status: 'rejected', reviewNote: 'রেফারেন্স যাচাই প্রয়োজন' };
  await engine.renderReceiptCanvas(tx);
  for (const value of [tx.receiptNo, tx.date, tx.studentName, tx.studentId, tx.className, tx.method, tx.trxRef, '৳৮০০']) {
    assert.ok(texts().includes(value), `${value} remains printed`);
  }
  assert.ok(texts().join(' ').includes(tx.feeType));
  assert.ok(texts().join(' ').includes(tx.month));
  assert.ok(texts().join(' ').includes(tx.note));
  assert.ok(texts().join(' ').includes(tx.reviewNote));
  assert.ok(texts().join(' ').includes(tx.collectedBy));
  assert.ok(texts().includes('কর্তৃপক্ষের স্বাক্ষর'));
});

test('long multi-line addresses, identifiers, notes and collector names are measured without clipping', async () => {
  const address = 'ভবন ১০, তৃতীয় তলা\nকলেজ রোড, দিনাজপুর সদর';
  page.window.localStorage.setItem(STORAGE_KEYS.appConfig, JSON.stringify({ tagline: `${TAGLINE} • ${address}`, campusAddress: `${address}\n${address}` }));
  const tx = { ...TX, studentId: 'DEMO-'.repeat(80), note: TX.note.repeat(60), collectedBy: 'নমুনা কাউন্টার দায়িত্বপ্রাপ্ত '.repeat(20) };
  const canvas = await engine.renderReceiptCanvas(tx);
  const statementTitle = draws.find(draw => draw.text === 'পেমেন্ট স্টেটমেন্ট');
  const addressLines = draws.filter(draw => draw.y > draws[0].y && draw.y < statementTitle.y);
  assert.deepEqual(addressLines.map(draw => draw.text), address.split('\n'));
  assert.ok(statementTitle.y - addressLines.at(-1).y >= 32);
  assert.ok(draws.every(draw => draw.y * 2 < canvas.height), 'even the last footer line fits the allocated normal-scale canvas');
  const idLabel = draws.findIndex(draw => draw.text === 'Student ID');
  const classLabel = draws.findIndex((draw, index) => index > idLabel && draw.text === 'শ্রেণি');
  const idLines = draws.slice(idLabel + 1, classLabel).map(draw => draw.text).join('');
  assert.equal(idLines, tx.studentId, 'the long reference is split, not truncated');
});

test('createReceiptPDF still returns a real byte-accurate single-document PDF', async () => {
  const blob = await engine.createReceiptPDF(TX);
  assert.equal(blob.type, 'application/pdf');
  const pdf = Buffer.from(await blob.arrayBuffer()).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.equal((pdf.match(/\/Receipt Do/g) || []).length, 1);
  assert.equal((pdf.match(/\/Subtype \/Image/g) || []).length, 1);
  const xref = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.equal(pdf.slice(xref, xref + 4), 'xref');
  assert.ok(draws.every(draw => draw.fill === '#000000'));
});

test('the existing report/exam brand loader still supplies its logo and the same Bengali font', async () => {
  const [logo, font] = await engine.loadBrandAssets();
  assert.equal(logo.tagName, 'IMG');
  assert.equal(font.family, 'ReceiptBangla');
  assert.equal(imageDecodes, 1, 'the logo remains available to other document types');
});


test('the offline shell precaches the complete local entry/module graph and payment font', () => {
  const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const shell = read('sw.js').split('const APP_SHELL = [')[1].split('];')[0];
  const cached = new Set([...shell.matchAll(/'\.\/([^']+)'/g)].map(match => match[1]));
  const pending = [...cached].filter(file => file.endsWith('.js'));
  const seen = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, specifier] of read(file).matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?)["']([^"']+)["']/g)) {
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) continue;
      const resolved = (specifier.startsWith('/') ? specifier.slice(1) : path.posix.join(path.posix.dirname(file), specifier)).split('?')[0];
      assert.ok(cached.has(resolved), `${file} imports uncached offline dependency ${resolved}`);
      if (resolved.endsWith('.js')) pending.push(resolved);
    }
  }
  for (const page of ['index','admin','manager','teacher','payment']) {
    for (const [, src] of read(page + '.html').matchAll(/<script[^>]+src="([^"]+)"/g)) {
      assert.ok(cached.has(src.split('?')[0]), `${page} entry script ${src} is missing from the PWA cache`);
    }
  }
  assert.ok(cached.has('assets/fonts/NotoSansBengali-Variable.woff2'), 'the WOFF2 receipt font is precached');
});

test('a restricted font cache/failing load can be retried without a CDN or a stuck asset promise', async () => {
  const NativeMock = globalThis.FontFace, originalCache = globalThis.caches;
  let attempts = 0;
  const sources = [];
  try {
    globalThis.caches = { async match() { throw new Error('CacheStorage restricted'); } };
    globalThis.FontFace = class FontFace {
      constructor(name, source) { sources.push(source); }
      async load() { if (++attempts === 1) throw new Error('Font temporarily unavailable'); return this; }
    };
    const fresh = await import('../js/finance-receipt.js?font-retry-143');
    await assert.rejects(() => fresh.createReceiptPDF(TX), /Font temporarily unavailable/);
    const blob = await fresh.createReceiptPDF(TX);
    assert.equal(blob.type, 'application/pdf');
    assert.equal(attempts, 2);
    assert.ok(sources.every(source => /^url\(".*\/assets\/fonts\/NotoSansBengali-Variable\.woff2"\)$/.test(source)), 'fallback is only the bundled font, never an external provider');
  } finally {
    globalThis.FontFace = NativeMock; globalThis.caches = originalCache;
  }
});
