import { toBanglaNumber as bn } from './ui.js';
import { loadWatermark, drawWatermark } from './brand.js';
import { loadAppConfig } from './storage.js';
import { APP_TAGLINE, DEFAULT_APP_SETTINGS } from './config.js';
import { escapeHtml as escape } from './sanitize.js';
const headerText = value => String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim();

function firstAddressBlock(parts) {
  const comparable = parts.map(headerText);
  for (let size = 1; size <= parts.length / 2; size++) {
    if (parts.length % size === 0 && comparable.every((part, index) => part === comparable[index % size])) return size;
  }
  return parts.length;
}

function singleAddress(value) {
  const lines = String(value || DEFAULT_APP_SETTINGS.campusAddress)
    .split(/\r\n?|\n/u).map(line => line.replace(/\s+/gu, ' ').trim()).filter(Boolean);
  if (!lines.length) return DEFAULT_APP_SETTINGS.campusAddress;
  // Collapse complete pasted address copies, not repeated city words or
  // distinct lines. Keep the first copy's spelling and separators intact.
  const address = lines.slice(0, firstAddressBlock(lines)).join('\n');
  const pieces = address.split(/(\s*[•|·;—–]\s*|\s+-\s+)/u);
  const parts = pieces.filter((_, index) => index % 2 === 0);
  if (parts.some(part => !headerText(part))) return address;
  const size = firstAddressBlock(parts);
  return size < parts.length ? pieces.slice(0, size * 2 - 1).join('').trim() : address;
}

/* Older saved taglines can be "slogan • address" (or the address alone).
 * Address now has its own line in HTML and in the shared PDF/PNG canvas.
 * Clean only complete address components; keep custom slogans/settings intact. */
const receiptBrand = () => {
  const cfg = loadAppConfig();
  const address = singleAddress(cfg.campusAddress);
  const original = String(cfg.tagline || APP_TAGLINE).trim();
  const comparableOriginal = original.normalize('NFC');
  let tagline = comparableOriginal;
  const known = [...new Set([address, DEFAULT_APP_SETTINGS.campusAddress].map(headerText))]
    .filter(Boolean).sort((a, b) => b.length - a.length);
  const divider = '[•|·—–;:ঃ\\n]';
  for (const value of known) {
    const literal = value.split(' ').map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
    const component = new RegExp(`(^|\\s*${divider}\\s*)${literal}(?=\\s*(?:${divider}|$))`, 'giu');
    tagline = tagline.replace(component, '$1');
  }
  if (tagline !== comparableOriginal) {
    tagline = headerText(tagline).replace(/([•|·—–;:ঃ])(?:\s*[•|·—–;:ঃ])+/gu, '$1')
      .replace(/^[\s•|·—–;:ঃ]+|[\s•|·—–;:ঃ]+$/gu, '');
    if (/^(?:ঠিকানা|address)$/iu.test(tagline)) tagline = '';
  } else {
    tagline = original.replace(/\s+/gu, ' ');
  }
  return { tagline: tagline || APP_TAGLINE, address };
};


function receiptFields(tx) {
  return [
    ['রসিদ নং', tx.receiptNo],
    ...(tx.transactionNo ? [['Transaction ID', tx.transactionNo]] : []),
    ['তারিখ', tx.date],
    ['শিক্ষার্থীর নাম', tx.studentName], ['Student ID', tx.studentId],
    ...(tx.uniqueRoll ? [['ইউনিক রোল', tx.uniqueRoll]] : []),
    ...(tx.className ? [['শ্রেণি', tx.className]] : []),
    ['ফি এর ধরন / মাস', `${tx.feeType} • ${tx.month}`],
    ['পেমেন্ট মাধ্যম', tx.method], ['Trx ID / Reference', tx.trxRef || '—']
  ];
}

export function receiptMarkup(tx, logo = 'assets/icons/app-logo.png') {
  const brand = receiptBrand();
  const fields = receiptFields(tx);
  return `<div class="receipt-modal-box" id="receiptPreviewBox">
    <div class="receipt-header">
      <img class="receipt-logo" src="${escape(logo)}" alt="Active Plus Coaching" width="64" height="64">
      <div class="receipt-brand-title">Active Plus Coaching</div>
      <div class="receipt-sub">${escape(brand.tagline)}</div>
      <div class="receipt-address">${escape(brand.address)}</div>
      <div class="receipt-badge-title">${tx.status === 'pending' ? 'অস্থায়ী পেমেন্ট স্লিপ • অনুমোদন বাকি' : tx.status === 'rejected' ? 'বাতিল পেমেন্ট এন্ট্রি' : 'মানি রসিদ (PAID)'}</div>
    </div>
    <dl class="receipt-meta-grid">${fields.map(([label, value]) => `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>
    <div class="receipt-amount-block"><div><span>${tx.status === 'pending' ? 'Manager অনুমোদনাধীন টাকা' : tx.status === 'rejected' ? 'রেকর্ডকৃত এন্ট্রি (বাতিল)' : 'মোট পরিশোধিত টাকা'}</span><strong>৳${bn(Number(tx.amount).toLocaleString('en-US'))}</strong></div><span class="receipt-paid-seal">${tx.status === 'pending' ? 'অনুমোদন বাকি' : tx.status === 'rejected' ? 'বাতিল' : 'পরিশোধিত'}</span></div>
    ${tx.reviewNote ? `<p class="receipt-note">Manager-এর কারণ: ${escape(tx.reviewNote)}</p>` : ''}
    <p class="receipt-note">নোট: ${escape(tx.note || (tx.status === 'pending' ? 'এন্ট্রি Manager-এর পর্যালোচনার অপেক্ষায়' : tx.status === 'rejected' ? 'এন্ট্রি অনুমোদিত হয়নি' : 'ফি পরিশোধ সম্পন্ন'))}</p>
    <div class="receipt-footer-sign"><div>আদায়কারী: ${escape(tx.collectedBy || 'এডমিন')}</div><div class="receipt-signature-line">কর্তৃপক্ষের স্বাক্ষর</div></div>
  </div>`;
}

let fontAsset;
async function receiptFont() {
  if (!fontAsset) fontAsset = (async () => {
    const url = new URL('../assets/fonts/NotoSansBengali-Variable.woff2', import.meta.url).href;
    let cached;
    try { cached = await globalThis.caches?.match(url); }
    catch { /* Restricted CacheStorage can still use the bundled same-origin font. */ }
    // The installed app precaches this file. Loading cached bytes directly also
    // works on the FIRST receipt after an offline reload: no font/PDF server,
    // CDN, HTTP-cache priming or previously generated receipt is necessary.
    const source = cached ? await cached.arrayBuffer() : `url("${url}")`;
    const font = await new FontFace('ReceiptBangla', source, { weight: '100 900' }).load();
    document.fonts.add(font);
    return font;
  })().catch(error => { fontAsset = null; throw error; });
  return fontAsset;
}

let assets;
async function receiptAssets() {
  if (!assets) assets = Promise.all([
    (async () => {
      const logo = new Image();
      logo.src = new URL('../assets/icons/app-logo.png', import.meta.url).href;
      await logo.decode();
      return logo;
    })(),
    receiptFont()
  ]).catch(error => { assets = null; throw error; });
  return assets;
}

/** Reports/exams keep their existing logo; plain payment statements only need the font. */
export function loadBrandAssets() { return receiptAssets(); }

/** Wrap at words; split long IDs/references at grapheme boundaries, not Bangla vowel marks. */
export function wrapText(ctx, text, width) {
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('bn', { granularity: 'grapheme' }) : null;
  const lines = [];
  for (const paragraph of String(text ?? '—').split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && ctx.measureText(`${line} ${word}`).width > width) { lines.push(line); line = ''; }
      if (ctx.measureText(word).width <= width) {
        line = line ? `${line} ${word}` : word;
      } else {
        const characters = segmenter ? [...segmenter.segment(word)].map(item => item.segment) : Array.from(word);
        for (const char of characters) {
          if (line && ctx.measureText(line + char).width > width) { lines.push(line); line = ''; }
          line += char;
        }
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Minimal single-image PDF, with byte-accurate stream lengths and xref offsets.
 * Browser canvas shapes Bangla before embedding, avoiding unsupported PDF font shaping.
 * No CDN, print dialog, popup or PDF runtime dependency is needed. */
export function imagePDF(jpeg, width, height) {
  if (!(jpeg instanceof Uint8Array) || !jpeg.length || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Invalid receipt image');
  }
  const pageWidth = 595.28;
  const imageWidth = pageWidth - 48;
  const imageHeight = Number((imageWidth * height / width).toFixed(2));
  const pageHeight = Math.max(841.89, imageHeight + 48);
  const imageBottom = (pageHeight - imageHeight - 24).toFixed(2);
  const encoder = new TextEncoder();
  const chunks = [];
  const offsets = [0];
  let length = 0;
  const append = value => {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (number, ...parts) => {
    offsets[number] = length;
    append(`${number} 0 obj\n`);
    parts.forEach(append);
    append('\nendobj\n');
  };
  append('%PDF-1.4\n');
  append(new Uint8Array([37, 226, 227, 207, 211, 10]));
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Receipt 4 0 R >> >> /Contents 5 0 R >>`);
  object(4, `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream');
  const content = `q\n${imageWidth} 0 0 ${imageHeight} 24 ${imageBottom} cm\n/Receipt Do\nQ\n`;
  object(5, `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);
  const xref = length;
  append('xref\n0 6\n0000000000 65535 f \n');
  for (const offset of offsets.slice(1)) append(`${String(offset).padStart(10, '0')} 00000 n \n`);
  append(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}

/** Independent, ink-saving document, never a dashboard/DOM screenshot.
 * PDF and chat PNG share the same monochrome statement. Saved configuration
 * is read only: the header intentionally has no slogan row to duplicate an
 * address embedded in any legacy tagline (regardless of its punctuation). */
export async function renderReceiptCanvas(tx) {
  await receiptFont();
  const wm = await loadWatermark(); // faint logo watermark; skipped if the image ever fails
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Receipt rendering unavailable');
  const width = 760, inset = 44, labelWidth = 160, valueX = inset + 180;
  const valueWidth = width - inset - valueX;
  const pending = tx.status === 'pending', rejected = tx.status === 'rejected';
  const status = pending ? 'অনুমোদন বাকি' : rejected ? 'বাতিল' : 'পরিশোধিত';
  const amountLabel = pending ? 'অনুমোদনাধীন টাকা' : rejected ? 'রেকর্ডকৃত টাকা (বাতিল)' : 'মোট পরিশোধিত টাকা';
  const defaultNote = pending ? 'এন্ট্রি Manager-এর পর্যালোচনার অপেক্ষায়' : rejected ? 'এন্ট্রি অনুমোদিত হয়নি' : 'ফি পরিশোধ সম্পন্ন';
  const measured = (value, available, size = 14, weight = 400) => {
    ctx.font = `${weight} ${size}px ReceiptBangla`;
    return wrapText(ctx, value || '—', available);
  };
  // Measure labels, values and footer before allocating the mobile pixel buffer.
  const rows = [...receiptFields(tx), [amountLabel, `৳${bn(Number(tx.amount).toLocaleString('en-US'))}`]]
    .map(([label, value], index, all) => {
      const amount = index === all.length - 1;
      const labels = measured(label, labelWidth);
      const lines = measured(value, valueWidth, amount ? 18 : 16, amount ? 600 : 400);
      return { labels, lines, amount, height: Math.max(labels.length, lines.length) * 25 + 12 };
    });
  const addressLines = measured(receiptBrand().address, width - inset * 2, 15);
  const notes = [
    ...(tx.reviewNote ? measured(`Manager-এর কারণ: ${tx.reviewNote}`, width - inset * 2) : []),
    ...measured(`নোট: ${tx.note || defaultNote}`, width - inset * 2)
  ];
  const collector = measured(`আদায়কারী: ${tx.collectedBy || 'এডমিন'}`, 320);
  const addressY = 70, addressStep = 22;
  const titleY = addressY + (addressLines.length - 1) * addressStep + 36;
  const statusY = titleY + 27, ruleY = statusY + 18, bodyY = ruleY + 31;
  const notesY = bodyY + rows.reduce((sum, row) => sum + row.height, 0) + 10;
  const footerY = notesY + notes.length * 23 + 26;
  const height = footerY + Math.max(32, collector.length * 23) + 40;
  const scale = Math.min(2, Math.sqrt(8000000 / (width * height)), 16000 / height);
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height); // The only filled rectangle is white paper.
  drawWatermark(ctx, width, height, wm);
  const text = (value, x, y, size = 14, weight = 400, align = 'left') => {
    ctx.font = `${weight} ${size}px ReceiptBangla`;
    ctx.fillStyle = '#000000';
    ctx.textAlign = align;
    ctx.fillText(value, x, y);
  };
  const rule = (y, left = inset, right = width - inset) => {
    ctx.strokeStyle = '#555555';
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
  };
  try {
    text('Active Plus Coaching', width / 2, 42, 23, 600, 'center');
    addressLines.forEach((line, index) => text(line, width / 2, addressY + index * addressStep, 15, 400, 'center'));
    text('পেমেন্ট স্টেটমেন্ট', width / 2, titleY, 18, 600, 'center');
    text(`অবস্থা: ${status}`, width / 2, statusY, 14, 400, 'center');
    rule(ruleY);
    let y = bodyY;
    rows.forEach(row => {
      if (row.amount) rule(y - 14);
      row.labels.forEach((line, index) => text(line, inset, y + index * 25));
      row.lines.forEach((line, index) => text(line, valueX, y + index * 25, row.amount ? 18 : 16, row.amount ? 600 : 400));
      y += row.height;
    });
    notes.forEach((line, index) => text(line, inset, notesY + index * 23));
    collector.forEach((line, index) => text(line, inset, footerY + index * 23));
    rule(footerY - 12, width - inset - 180, width - inset);
    text('কর্তৃপক্ষের স্বাক্ষর', width - inset, footerY + 12, 14, 400, 'right');
    return canvas;
  } catch (error) {
    canvas.width = canvas.height = 0;
    throw error;
  }
}

export async function createReceiptPDF(tx) {
  const canvas = await renderReceiptCanvas(tx);
  try {
    const jpeg = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Receipt image failed')), 'image/jpeg', 0.94));
    return imagePDF(new Uint8Array(await jpeg.arrayBuffer()), canvas.width, canvas.height);
  } finally {
    canvas.width = canvas.height = 0; // Release the large pixel buffer on mobile.
  }
}

/** PNG render of the receipt for chat sharing (WhatsApp), still fully offline. */
export async function createReceiptPNG(tx) {
  const canvas = await renderReceiptCanvas(tx);
  try {
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Receipt image failed')), 'image/png'));
  } finally {
    canvas.width = canvas.height = 0;
  }
}

export async function downloadReceipt(tx) {
  const pdf = await createReceiptPDF(tx);
  const url = URL.createObjectURL(pdf);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${String(tx.receiptNo || tx.id).replace(/[^\w-]/g, '_')}.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
