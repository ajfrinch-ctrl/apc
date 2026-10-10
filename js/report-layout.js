import { PRINT_COLORS } from './print-tokens.js';
import { loadWatermark, drawWatermark } from './brand.js';
import { loadAppConfig } from './storage.js';
/* Report layout engine — one measured draw-list, two identical renderers.

   A report is described as a small document (headings, key/value blocks,
   summary tiles, tables, MCQ questions, notes). The engine measures that
   document on an A4 page and flows it into pages, producing a flat list of
   drawing items (text, rects, rules, the logo) with absolute coordinates.

   Both output paths consume the SAME item list:

     renderPreviewHTML()  → absolutely positioned HTML (selectable, zoomable)
     renderPagesPDF()     → one A4 canvas per page inside a real multi-page PDF

   Neither renderer re-measures or re-wraps anything, so the preview and the
   downloaded PDF cannot drift apart: same data, same order, same font, same
   spacing, same alignment, same table structure, same page breaks, same
   header and footer.

   Units are CSS pixels on a 794 × 1123 page (A4 at 96dpi). The PDF canvas is
   the same page multiplied by PDF_SCALE, so all coordinates are shared. */
import { loadBrandAssets, wrapText } from './finance-receipt.js';
import { pagesPDF } from './exam-pdf.js';

export const PAGE = Object.freeze({ width: 794, height: 1123, margin: 44 });
export const CONTENT = Object.freeze({
  left: 44,
  right: PAGE.width - 44,
  top: 174,
  bottom: 1052,
  width: PAGE.width - 88
});
export const PDF_SCALE = 1240 / PAGE.width; // 1240 × 1754 canvas ≈ A4 at 150dpi
export const FONT = 'ReceiptBangla';

/* Both renderers place a line with the SAME rule: the item's y is the top of
   a 1em box and the glyph baseline sits TEXT_BASELINE of that box down. The
   preview sets line-height to 1em so its baseline lands in the same place the
   canvas draws its own — the two outputs cannot drift apart. */
export const TEXT_BASELINE = 0.78;

const BRAND = 'Active Plus Coaching';
const TAGLINE = 'শিখতে থাকো, এগিয়ে যাও • দিনাজপুর';

export const COLORS = PRINT_COLORS;

/* ---------- measurement ---------- */

let assetsPromise = null;
let measurer = null;

function assets() {
  if (!assetsPromise) assetsPromise = loadBrandAssets();
  return assetsPromise;
}

/** Logo + Bengali font, shared with the receipt and exam PDF renderers. */
export async function loadReportAssets() {
  const [logo] = await assets();
  const ctx = context();
  if (ctx) ctx.font = fontString(12, 400);
  return logo;
}

function context() {
  if (measurer === null) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    measurer = canvas.getContext('2d');
  }
  return measurer;
}

const fontString = (size, weight = 400) => `${weight} ${size}px ${FONT}`;
const lineHeight = size => Math.round(size * 1.5);

/** Wrap with the exact font the canvas will draw with — no re-wrapping later. */
export function measureLines(text, { size = 10.5, weight = 400, width = CONTENT.width } = {}) {
  const ctx = context();
  if (!ctx) return [String(text ?? '—')];
  ctx.font = fontString(size, weight);
  return wrapText(ctx, text ?? '—', Math.max(40, width));
}

function bengaliNumber(value) {
  return String(value).replace(/\d/g, digit => '০১২৩৪৫৬৭৮৯'[digit]);
}

/* ---------- document model ---------- */

export function createReport({ title, subtitle = '', period = '', scopeLines = [], note = '' } = {}) {
  return {
    title: String(title || 'রিপোর্ট'),
    subtitle: String(subtitle || ''),
    period: String(period || ''),
    scopeLines: (scopeLines || []).filter(Boolean),
    note: String(note || ''),
    blocks: []
  };
}

const block = (type, payload) => ({ type, ...payload });

export function addHeading(doc, text, { size = 13, gap = 10 } = {}) {
  doc.blocks.push(block('heading', { text, size, gap }));
  return doc;
}
export function addParagraph(doc, text, { size = 11, weight = 400, color = COLORS.ink, gap = 8 } = {}) {
  doc.blocks.push(block('paragraph', { text, size, weight, color, gap }));
  return doc;
}
export function addNote(doc, text) {
  doc.blocks.push(block('note', { text }));
  return doc;
}

export function addKeyValues(doc, pairs, { columns = 2, gap = 10 } = {}) {
  doc.blocks.push(block('keyValues', { pairs: (pairs || []).filter(Boolean), columns, gap }));
  return doc;
}
export function addTiles(doc, tiles, { perRow = 4, gap = 12 } = {}) {
  doc.blocks.push(block('tiles', { tiles: tiles || [], perRow, gap }));
  return doc;
}
/** columns: [{ label, width (fraction), align, emphasis }] */
export function addTable(doc, { columns = [], rows = [], title = '', zebra = true, gap = 12 } = {}) {
  doc.blocks.push(block('table', { columns, rows, title, zebra, gap }));
  return doc;
}
/** MCQ questions: every question, every option, correct + student answer. */
export function addQuestions(doc, questions, { gap = 12, showAnswer = true, showStudent = false } = {}) {
  doc.blocks.push(block('questions', { questions: questions || [], gap, showAnswer, showStudent }));
  return doc;
}

/* ---------- layout: document → pages of draw items ---------- */

function newPage(index) {
  return { index, items: [], y: CONTENT.top };
}

/** Branded header: full title block on page 1, a compact strip afterwards. */
function drawHeader(page, doc, logo, total) {
  const center = PAGE.width / 2;
  const cfg = loadAppConfig();
  const address = String(cfg.campusAddress || '').trim();
  const tagline = String(cfg.tagline || TAGLINE).trim();

  // Report PDF header is intentionally centered: logo, institution name,
  // address and tagline all share the same center axis on every page.
  page.items.unshift({ kind: 'image', image: logo, x: center - 28, y: 22, w: 56, h: 56 });
  page.items.unshift({ kind: 'text', text: BRAND, x: center, y: 94, size: 20, weight: 800, color: COLORS.forest, align: 'center' });
  if (tagline) {
    page.items.unshift({ kind: 'text', text: tagline, x: center, y: 112, size: 9.5, weight: 500, color: COLORS.muted, align: 'center' });
  }
  if (address) {
    const addressLines = measureLines(address, { size: 9.5, weight: 400, width: CONTENT.width - 80 });
    addressLines.slice(0, 2).forEach((line, index) => {
      page.items.unshift({ kind: 'text', text: line, x: center, y: 130 + index * 14, size: 9.5, weight: 400, color: COLORS.muted, align: 'center' });
    });
  }

  if (page.index > 1 && total) {
    page.items.unshift({ kind: 'text', text: `পৃষ্ঠা ${bengaliNumber(page.index)} / ${bengaliNumber(total)}`, x: PAGE.width - CONTENT.left, y: 1080, size: 9, weight: 600, color: COLORS.muted, align: 'right' });
  }
  void total;
}

function drawFooter(page, stamp) {
  const { left, right } = CONTENT;
  page.items.push({ kind: 'rule', x1: left, x2: right, y: 1064, color: COLORS.line });
  page.items.push({ kind: 'text', text: `তৈরি: ${stamp} • ${BRAND}`, x: left, y: 1082, size: 9.5, weight: 500, color: COLORS.muted });
  page.items.push({ kind: 'text', text: `পৃষ্ঠা ${bengaliNumber(page.index)}`, x: right, y: 1082, size: 9.5, weight: 700, color: COLORS.muted, align: 'right' });
}

/** Page 1 title block: report name, period and the Class/Batch/Student scope. */
function drawTitleBlock(page, doc) {
  const { left, right } = CONTENT;
  let y = page.y;
  const titleLines = measureLines(doc.title, { size: 18, weight: 800 });
  for (const line of titleLines) {
    page.items.push({ kind: 'text', text: line, x: left, y, size: 18, weight: 800, color: COLORS.forestDark });
    y += lineHeight(18);
  }
  if (doc.subtitle) {
    for (const line of measureLines(doc.subtitle, { size: 11, weight: 500 })) {
      page.items.push({ kind: 'text', text: line, x: left, y, size: 11, weight: 500, color: COLORS.muted });
      y += lineHeight(11);
    }
  }
  if (doc.period) {
    page.items.push({ kind: 'text', text: doc.period, x: left, y, size: 11, weight: 700, color: COLORS.forest });
    y += lineHeight(11);
  }
  if (doc.scopeLines.length) {
    for (const line of measureLines(doc.scopeLines.join('    •    '), { size: 10.5, weight: 600 })) {
      page.items.push({ kind: 'text', text: line, x: left, y, size: 10.5, weight: 600, color: COLORS.ink });
      y += lineHeight(10.5);
    }
  }
  y += 6;
  page.items.push({ kind: 'rule', x1: left, x2: right, y, color: COLORS.forest, lineWidth: 1 });
  page.y = y + 16;
}

/**
 * Flow the document into pages.
 * `layoutReport` is synchronous: the wrapped lines it emits are the lines both
 * renderers draw, so nothing is measured twice.
 */
export function layoutReport(doc, logo = null) {
  const pages = [];
  let page = newPage(1);
  const bottom = CONTENT.bottom;

  const flow = {
    get page() { return page; },
    flush() { pages.push(page); page = newPage(pages.length + 1); return page; },
    get bottom() { return bottom; }
  };

  drawTitleBlock(page, doc);

  for (let index = 0; index < doc.blocks.length; index += 1) {
    const current = doc.blocks[index];
    const next = doc.blocks[index + 1];
    if (current.type === 'heading') layoutHeading(current, next, flow);
    else if (current.type === 'paragraph' || current.type === 'note') layoutParagraph(current, flow);
    else if (current.type === 'spacer') flow.page.y += current.height;
    else if (current.type === 'keyValues') layoutKeyValues(current, flow);
    else if (current.type === 'tiles') layoutTiles(current, flow);
    else if (current.type === 'table') layoutTable(current, flow);
    else if (current.type === 'questions') layoutQuestions(current, flow);
  }

  if (doc.note) {
    const lines = measureLines(doc.note, { size: 10, weight: 500 });
    if (flow.page.y + lines.length * lineHeight(10) + 12 > bottom) flow.flush();
    let y = flow.page.y + 8;
    for (const line of lines) {
      flow.page.items.push({ kind: 'text', text: line, x: CONTENT.left, y, size: 10, weight: 500, color: COLORS.muted });
      y += lineHeight(10);
    }
    flow.page.y = y + 4;
  }

  pages.push(page);
  const total = pages.length;
  const stamp = new Date().toLocaleString('bn-BD');
  for (const item of pages) {
    drawFooter(item, stamp);
    drawHeader(item, doc, logo, total);
  }
  return { pages, total };
}

/** A cheap probe so a heading is never the last thing on a page. */
function estimateHeight(one) {
  if (!one) return 0;
  if (one.type === 'spacer') return one.height;
  if (one.type === 'table') return 90;
  if (one.type === 'tiles') return 80;
  if (one.type === 'keyValues') return 50;
  if (one.type === 'questions') return 120;
  return 40;
}

function layoutHeading(spec, next, flow) {
  const { left } = CONTENT;
  const lines = measureLines(spec.text, { size: spec.size, weight: 800 });
  const height = lines.length * lineHeight(spec.size) + spec.gap;
  if (flow.page.y + height + Math.min(estimateHeight(next), 70) > flow.bottom) flow.flush();
  let y = flow.page.y + 2;
  for (const line of lines) {
    flow.page.items.push({ kind: 'text', text: line, x: left, y, size: spec.size, weight: 800, color: COLORS.forestDark });
    y += lineHeight(spec.size);
  }
  flow.page.items.push({ kind: 'rule', x1: left, x2: left + CONTENT.width, y: y - 4, color: COLORS.line });
  flow.page.y = y + spec.gap;
}

function layoutParagraph(spec, flow) {
  const size = spec.size ?? (spec.type === 'note' ? 10 : 11);
  const weight = spec.weight ?? (spec.type === 'note' ? 500 : 400);
  const color = spec.color ?? (spec.type === 'note' ? COLORS.muted : COLORS.ink);
  let y = flow.page.y;
  for (const line of measureLines(spec.text, { size, weight })) {
    if (y + lineHeight(size) > flow.bottom) { flow.flush(); y = flow.page.y; }
    flow.page.items.push({ kind: 'text', text: line, x: CONTENT.left, y, size, weight, color });
    y += lineHeight(size);
  }
  flow.page.y = y + (spec.gap ?? 8);
}

function layoutKeyValues(spec, flow) {
  const { left } = CONTENT;
  const columns = Math.max(1, Math.min(4, spec.columns || 2));
  const gutter = 14;
  const cellWidth = (CONTENT.width - gutter * (columns - 1)) / columns;
  let y = flow.page.y;
  let column = 0;
  let rowHeight = 0;

  for (const [label, value] of spec.pairs) {
    const labelLines = measureLines(label ?? '', { size: 9.5, weight: 700, width: cellWidth - 8 });
    const valueLines = measureLines(value ?? '—', { size: 11, weight: 700, width: cellWidth - 8 });
    const height = labelLines.length * lineHeight(9.5) + valueLines.length * lineHeight(11) + 8;
    if (y + height > flow.bottom) { flow.flush(); y = flow.page.y; column = 0; rowHeight = 0; }
    const x = left + column * (cellWidth + gutter);
    let cursor = y;
    for (const line of labelLines) {
      flow.page.items.push({ kind: 'text', text: line, x, y: cursor, size: 9.5, weight: 700, color: COLORS.muted });
      cursor += lineHeight(9.5);
    }
    for (const line of valueLines) {
      flow.page.items.push({ kind: 'text', text: line, x, y: cursor, size: 11, weight: 700, color: COLORS.ink });
      cursor += lineHeight(11);
    }
    flow.page.items.push({ kind: 'rule', x1: x, x2: x + cellWidth, y: cursor + 2, color: COLORS.line });
    rowHeight = Math.max(rowHeight, cursor - y + 8);
    column += 1;
    if (column === columns) { y += rowHeight; column = 0; rowHeight = 0; }
  }
  flow.page.y = (column === 0 ? y : y + rowHeight) + (spec.gap ?? 10);
}

function layoutTiles(spec, flow) {
  const { left } = CONTENT;
  const perRow = Math.max(1, Math.min(4, spec.perRow || 4));
  const gutter = 12;
  const tileWidth = (CONTENT.width - gutter * (perRow - 1)) / perRow;
  const tiles = spec.tiles || [];

  /* Measure every tile first: a tile grows with its own text, so a long
     figure is never clipped and two tiles in a row never overlap. */
  const measured = tiles.map(tile => {
    const labelLines = measureLines(tile.label ?? '', { size: 9.5, weight: 700, width: tileWidth - 20 }).slice(0, 2);
    const valueLines = measureLines(tile.value ?? '—', { size: 16, weight: 800, width: tileWidth - 20 }).slice(0, 3);
    const height = 10 + labelLines.length * lineHeight(9.5) + 4 + valueLines.length * lineHeight(16) + 10;
    return { labelLines, valueLines, height: Math.max(58, height) };
  });

  let y = flow.page.y;
  let lastRowHeight = 0;
  for (let index = 0; index < measured.length; index += 1) {
    const column = index % perRow;
    const rowStart = index - column;
    const rowHeight = Math.max(...measured.slice(rowStart, rowStart + perRow).map(item => item.height));
    if (column === 0) {
      if (index > 0) y += lastRowHeight + gutter;
      // A row of tiles moves to the next page as one block.
      if (y + rowHeight > flow.bottom) { flow.flush(); y = flow.page.y; }
    }
    const tile = measured[index];
    const x = left + column * (tileWidth + gutter);
    flow.page.items.push({ kind: 'rect', x, y, w: tileWidth, h: rowHeight, fill: COLORS.mint, radius: 8 });
    let cursor = y + 10;
    for (const line of tile.labelLines) {
      flow.page.items.push({ kind: 'text', text: line, x: x + 10, y: cursor, size: 9.5, weight: 700, color: COLORS.muted });
      cursor += lineHeight(9.5);
    }
    cursor += 4;
    for (const line of tile.valueLines) {
      flow.page.items.push({ kind: 'text', text: line, x: x + 10, y: cursor, size: 16, weight: 800, color: COLORS.forestDark });
      cursor += lineHeight(16);
    }
    lastRowHeight = rowHeight;
  }
  if (measured.length) flow.page.y = y + lastRowHeight + (spec.gap ?? 12);
}

function tableWidths(columns) {
  const weights = columns.map(column => Number(column.width) || 1);
  const sum = weights.reduce((acc, value) => acc + value, 0) || 1;
  const widths = weights.map(weight => Math.max(46, Math.floor(CONTENT.width * weight / sum)));
  const drift = CONTENT.width - widths.reduce((acc, value) => acc + value, 0);
  if (drift !== 0) widths[widths.length - 1] += drift;
  return widths;
}

function layoutTable(spec, flow) {
  const { left } = CONTENT;
  const columns = spec.columns || [];
  if (!columns.length) return;
  const widths = tableWidths(columns);
  const headerCells = columns.map((column, index) =>
    measureLines(column.label ?? '', { size: 10.5, weight: 800, width: widths[index] - 12 })
  );
  const headerHeight = Math.max(...headerCells.map(lines => lines.length)) * lineHeight(10.5) + 14;
  const rowCells = [];
  const rowHeights = [];
  for (const row of spec.rows) {
    const cells = columns.map((column, index) =>
      measureLines(row[index] ?? '—', { size: 10.5, weight: column.emphasis ? 800 : 400, width: widths[index] - 12 })
    );
    rowCells.push(cells);
    rowHeights.push(Math.max(...cells.map(lines => lines.length)) * lineHeight(10.5) + 14);
  }

  if (spec.title) {
    const titleLines = measureLines(spec.title, { size: 12, weight: 800 });
    if (flow.page.y + titleLines.length * lineHeight(12) + 8 > flow.bottom) flow.flush();
    let cursor = flow.page.y;
    for (const line of titleLines) {
      flow.page.items.push({ kind: 'text', text: line, x: left, y: cursor, size: 12, weight: 800, color: COLORS.forestDark });
      cursor += lineHeight(12);
    }
    flow.page.y = cursor + 6;
  }

  // The header row is repeated on every page the table flows onto.
  const drawHeader = () => {
    const y = flow.page.y;
    flow.page.items.push({ kind: 'rect', x: left, y, w: CONTENT.width, h: headerHeight, fill: COLORS.forest, radius: 6 });
    let x = left;
    columns.forEach((column, index) => {
      headerCells[index].forEach((line, lineIndex) => {
        flow.page.items.push({
          kind: 'text', text: line, x: x + 6, y: y + 11 + lineIndex * lineHeight(10.5),
          size: 10.5, weight: 800, color: COLORS.white,
          align: column.align === 'right' ? 'right' : 'left', boxWidth: widths[index] - 12
        });
      });
      x += widths[index];
    });
    flow.page.y = y + headerHeight;
  };

  if (flow.page.y + headerHeight + 30 > flow.bottom) flow.flush();
  drawHeader();

  spec.rows.forEach((row, rowIndex) => {
    const height = rowHeights[rowIndex];
    // A row is never split across pages — it moves whole to the next page.
    if (flow.page.y + height > flow.bottom) { flow.flush(); drawHeader(); }
    const y = flow.page.y;
    if (spec.zebra && rowIndex % 2 === 1) flow.page.items.push({ kind: 'rect', x: left, y, w: CONTENT.width, h: height, fill: COLORS.zebra });
    let x = left;
    columns.forEach((column, index) => {
      rowCells[rowIndex][index].forEach((line, lineIndex) => {
        flow.page.items.push({
          kind: 'text', text: line, x: x + 6, y: y + 10 + lineIndex * lineHeight(10.5),
          size: 10.5, weight: column.emphasis ? 800 : 400,
          color: column.emphasis ? COLORS.forestDark : COLORS.ink,
          align: column.align === 'right' ? 'right' : 'left', boxWidth: widths[index] - 12
        });
      });
      x += widths[index];
    });
    flow.page.items.push({ kind: 'rule', x1: left, x2: left + CONTENT.width, y: y + height - 1, color: COLORS.line });
    flow.page.y = y + height;
  });
  flow.page.y += spec.gap ?? 12;
}

function layoutQuestions(spec, flow) {
  const { left } = CONTENT;
  const width = CONTENT.width;

  spec.questions.forEach((question, index) => {
    const noLines = measureLines(question.no ?? `প্রশ্ন ${index + 1}`, { size: 11.5, weight: 800, width: 130 });
    const textLines = measureLines(question.text ?? '', { size: 12, weight: 600, width: width - 140 });
    const options = question.options || [];
    const optionCells = options.map(option =>
      measureLines(`${option.id}. ${option.text}`, { size: 11, weight: 400, width: width / 2 - 34 })
    );
    const rows = Math.ceil(options.length / 2);
    let optionHeight = 0;
    for (let row = 0; row < rows; row += 1) {
      optionHeight += Math.max(...[0, 1].map(slot => (optionCells[row * 2 + slot] || []).length)) * lineHeight(11) + 6;
    }
    const infoParts = [];
    if (spec.showAnswer) infoParts.push(`সঠিক উত্তর: ${question.answerText || question.answer || '—'}`);
    if (spec.showStudent) infoParts.push(`প্রদত্ত উত্তর: ${question.chosenText || 'অনুত্তরিত'}`);
    if (question.marks !== undefined && question.marks !== null) infoParts.push(`নম্বর: ${question.marks}`);
    if (question.status) infoParts.push(question.status);
    if (spec.showStudent && question.obtained !== undefined) infoParts.push(`প্রাপ্ত নম্বর: ${question.obtained}`);
    if (question.explanation) infoParts.push(`ব্যাখ্যা: ${question.explanation}`);
    const infoLines = measureLines(infoParts.join('    •    '), { size: 10.5, weight: 600, width: width - 28 });

    const headHeight = Math.max(noLines.length * lineHeight(11.5), textLines.length * lineHeight(12));
    const height = headHeight + optionHeight + infoLines.length * lineHeight(10.5) + 18;

    // A question flows whole to the next page — never cut in half.
    if (flow.page.y + height > flow.bottom && flow.page.y > CONTENT.top) flow.flush();

    const top = flow.page.y;
    flow.page.items.push({ kind: 'rect', x: left, y: top, w: width, h: height, fill: index % 2 ? COLORS.zebra : COLORS.white });
    flow.page.items.push({ kind: 'rect', x: left, y: top, w: 3, h: height, fill: COLORS.forest });

    let cursor = top + 8;
    noLines.forEach((line, lineIndex) => {
      flow.page.items.push({ kind: 'text', text: line, x: left + 14, y: cursor + lineIndex * lineHeight(11.5), size: 11.5, weight: 800, color: COLORS.forestDark });
    });
    textLines.forEach((line, lineIndex) => {
      flow.page.items.push({ kind: 'text', text: line, x: left + 140, y: cursor + lineIndex * lineHeight(12), size: 12, weight: 600, color: COLORS.ink });
    });
    cursor += headHeight + 4;

    for (let row = 0; row < rows; row += 1) {
      const rowHeight = Math.max(...[0, 1].map(slot => (optionCells[row * 2 + slot] || []).length)) * lineHeight(11);
      [0, 1].forEach(slot => {
        const lines = optionCells[row * 2 + slot];
        const option = options[row * 2 + slot];
        if (!lines || !option) return;
        const chosen = spec.showStudent && question.chosen === option.id;
        const correct = spec.showAnswer && question.answer === option.id;
        const color = chosen ? (correct ? COLORS.correct : COLORS.wrong) : COLORS.ink;
        const weight = chosen || correct ? 800 : 400;
        lines.forEach((line, lineIndex) => {
          flow.page.items.push({
            kind: 'text', text: line, x: left + 20 + slot * (width / 2), y: cursor + lineIndex * lineHeight(11),
            size: 11, weight, color
          });
        });
      });
      cursor += rowHeight + 6;
    }

    infoLines.forEach((line, lineIndex) => {
      flow.page.items.push({ kind: 'text', text: line, x: left + 14, y: cursor + lineIndex * lineHeight(10.5), size: 10.5, weight: 600, color: COLORS.muted });
    });
    flow.page.y = top + height + 8;
  });
  flow.page.y += spec.gap ?? 12;
}

/* ---------- renderer 1: HTML preview ---------- */

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
));

/**
 * Render pages as HTML. Every item keeps its measured position, so the preview
 * is the PDF's own structure drawn by the browser — not an approximation.
 */
export function renderPreviewHTML(pages) {
  return pages.map(page => {
    const body = page.items.map(item => {
      if (item.kind === 'text') {
        const shift = item.align === 'right' ? 'translateX(-100%)' : item.align === 'center' ? 'translateX(-50%)' : 'none';
        const boxWidth = item.boxWidth ? `width:${item.boxWidth}px;` : '';
        return `<span class="rp-text" style="left:${item.x}px;top:${item.y}px;font:${item.weight} ${item.size}px/1 ${FONT};color:${item.color};${boxWidth}transform:${shift}">${escapeHtml(item.text)}</span>`;
      }
      if (item.kind === 'rect') {
        const background = item.fill && item.fill !== COLORS.white ? `background:${item.fill};` : '';
        const radius = item.radius ? `border-radius:${item.radius}px;` : '';
        return `<span class="rp-rect" style="left:${item.x}px;top:${item.y}px;width:${item.w}px;height:${item.h}px;${background}${radius}"></span>`;
      }
      if (item.kind === 'rule') {
        return `<span class="rp-rect" style="left:${item.x1}px;top:${item.y}px;width:${item.x2 - item.x1}px;height:1px;background:${item.color}"></span>`;
      }
      if (item.kind === 'image' && item.image?.src) {
        return `<img class="rp-logo" alt="" src="${escapeHtml(item.image.src)}" style="left:${item.x}px;top:${item.y}px;width:${item.w}px;height:${item.h}px">`;
      }
      return '';
    }).join('');
    return `<div class="rp-page" data-page="${page.index}" role="group" aria-label="পৃষ্ঠা ${page.index}">${body}</div>`;
  }).join('');
}

/* ---------- renderer 2: PDF ---------- */

async function drawPage(page) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(PAGE.width * PDF_SCALE);
  canvas.height = Math.round(PAGE.height * PDF_SCALE);
  const ctx = canvas.getContext('2d');
  ctx.scale(PDF_SCALE, PDF_SCALE);
  ctx.fillStyle = COLORS.white;
  ctx.fillRect(0, 0, PAGE.width, PAGE.height);
  drawWatermark(ctx, PAGE.width, PAGE.height, await loadWatermark());
  ctx.textBaseline = 'alphabetic';
  for (const item of page.items) {
    if (item.kind === 'text') {
      ctx.font = fontString(item.size, item.weight);
      ctx.fillStyle = item.color;
      ctx.textAlign = item.align === 'right' ? 'right' : item.align === 'center' ? 'center' : 'left';
      ctx.fillText(item.text, item.x, item.y + item.size * TEXT_BASELINE);
      ctx.textAlign = 'left';
    } else if (item.kind === 'rect') {
      ctx.fillStyle = item.fill;
      ctx.fillRect(item.x, item.y, item.w, item.h);
    } else if (item.kind === 'rule') {
      ctx.strokeStyle = item.color;
      ctx.lineWidth = item.lineWidth || 1;
      ctx.beginPath();
      ctx.moveTo(item.x1, item.y);
      ctx.lineTo(item.x2, item.y);
      ctx.stroke();
    } else if (item.kind === 'image' && item.image) {
      ctx.drawImage(item.image, item.x, item.y, item.w, item.h);
    }
  }
  const blob = await new Promise((resolve, reject) => canvas.toBlob(
    value => value ? resolve(value) : reject(new Error('রিপোর্টের পাতা তৈরি করা যায়নি।')), 'image/jpeg', 0.92
  ));
  const jpeg = new Uint8Array(await blob.arrayBuffer());
  canvas.width = canvas.height = 0; // release the pixel buffer on mobile
  return { jpeg, width: Math.round(PAGE.width * PDF_SCALE), height: Math.round(PAGE.height * PDF_SCALE) };
}

/** A real multi-page PDF: one A4 page per laid-out page, in the same order. */
export async function renderPagesPDF(pages) {
  const drawn = [];
  for (const page of pages) drawn.push(await drawPage(page));
  if (!drawn.length) throw new Error('রিপোর্টের কোনো পাতা তৈরি হয়নি।');
  return pagesPDF(drawn);
}

/** Lay a document out and return both renderings plus the page count. */
export async function buildReport(doc) {
  const logo = await loadReportAssets();
  const { pages, total } = layoutReport(doc, logo);
  return { pages, total, html: renderPreviewHTML(pages) };
}

/** Lay a document out and render it straight to a PDF blob. */
export async function buildReportPDF(doc) {
  const { pages } = await buildReport(doc);
  return renderPagesPDF(pages);
}

/** The flat row list a table drew — used by the CSV fallback. */
export function reportRows(doc) {
  const rows = [];
  for (const item of doc.blocks) {
    if (item.type !== 'table') continue;
    rows.push(item.columns.map(column => column.label));
    for (const row of item.rows) rows.push(row);
  }
  return rows;
}
