/* Active Plus Coaching — Unified A4 Lecture Sheet Paginator, Preview & PDF Engine.
 *
 * One measured pagination pipeline (`paginateLectureDocument`) drives:
 *   1. Read-only Live A4 PDF Preview (`renderLecturePreviewPagesHtml`)
 *   2. Clean A4 Print stylesheet output (`printLectureSheet`)
 *   3. Direct offline/online multi-page A4 PDF download (`generateLecturePdfBlob`)
 *
 * Supports Portrait & Landscape A4, Narrow/Normal/Wide margins, Bangla Unicode +
 * যুক্তাক্ষর shaping via bundled `NotoSansBengali-Variable.woff2`, inline formatting
 * (bold, italic, underline, strikethrough, color, highlight, superscript, subscript,
 * font size), headings, alignments, line/paragraph spacing, indents, lists, tables
 * (with cross-page row splitting & repeated header row), images, equations, headers,
 * footers, and Page X of Y numbering.
 */

import { toBanglaNumber as bn } from './ui.js';
import { escapeHtml } from './sanitize.js';
import { BRAND_NAME, BRAND_TAGLINE, brandLogoLargeSrc, loadWatermark, drawWatermark } from './brand.js';
import { normalizeLecturePageSettings, sanitizeLectureDocJson } from './course-content.js';
import { isSafeLectureImageSrc } from './rich-sanitize.js';
import { buildLecturePdfFilename } from './lecture-sheet-store.js';

export const A4_DIMENSIONS = Object.freeze({
  portrait: Object.freeze({ width: 794, height: 1123, pdfPtWidth: 595.28, pdfPtHeight: 841.89 }),
  landscape: Object.freeze({ width: 1123, height: 794, pdfPtWidth: 841.89, pdfPtHeight: 595.28 })
});

export const MARGIN_PRESETS = Object.freeze({
  narrow: 36,
  normal: 56,
  wide: 76
});

const PDF_SCALE = 1.6; // ~154 DPI crisp A4 canvas
const LECTURE_FONT_FAMILY = 'LectureBangla';

let fontAndLogoPromise = null;

export async function loadLecturePdfAssets() {
  if (typeof FontFace === 'undefined' || typeof Image === 'undefined') {
    return { logo: null, watermark: null };
  }
  if (!fontAndLogoPromise) {
    fontAndLogoPromise = (async () => {
      let logo = null;
      let watermark = null;
      try {
        const fontUrl = new URL('../assets/fonts/NotoSansBengali-Variable.woff2', import.meta.url).href;
        const face = new FontFace(LECTURE_FONT_FAMILY, `url("${fontUrl}")`, { weight: '100 900' });
        const loaded = await face.load();
        document.fonts?.add(loaded);
      } catch { /* fallback to system Noto Sans Bengali in headless/test */ }
      try {
        const img = new Image();
        img.src = brandLogoLargeSrc(import.meta.url);
        await img.decode();
        logo = img;
      } catch { logo = null; }
      try {
        watermark = await loadWatermark();
      } catch { watermark = null; }
      return { logo, watermark };
    })().catch(err => {
      fontAndLogoPromise = null;
      throw err;
    });
  }
  return fontAndLogoPromise;
}

/* ---- Readable Mathematical Notation Formatter for Canvas & Fallback --------- */

const LATEX_SYMBOLS = Object.freeze({
  '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\delta': 'δ', '\\epsilon': 'ε',
  '\\theta': 'θ', '\\lambda': 'λ', '\\mu': 'μ', '\\pi': 'π', '\\sigma': 'σ',
  '\\phi': 'φ', '\\omega': 'ω', '\\Delta': 'Δ', '\\Sigma': 'Σ', '\\Omega': 'Ω',
  '\\pm': '±', '\\mp': '∓', '\\times': '×', '\\div': '÷', '\\cdot': '·',
  '\\leq': '≤', '\\le': '≤', '\\geq': '≥', '\\ge': '≥', '\\neq': '≠', '\\ne': '≠',
  '\\approx': '≈', '\\equiv': '≡', '\\infty': '∞', '\\propto': '∝',
  '\\rightarrow': '→', '\\to': '→', '\\leftarrow': '←', '\\leftrightarrow': '↔',
  '\\Rightarrow': '⇒', '\\Leftrightarrow': '⇔', '\\uparrow': '↑', '\\downarrow': '↓',
  '\\sum': '∑', '\\prod': '∏', '\\int': '∫', '\\partial': '∂', '\\nabla': '∇',
  '\\therefore': '∴', '\\because': '∵', '\\degree': '°', '\\circ': '∘',
  '\\in': '∈', '\\notin': '∉', '\\subset': '⊂', '\\subseteq': '⊆', '\\cup': '∪', '\\cap': '∩'
});

const SUP_MAP = Object.freeze({
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', 'n': 'ⁿ', 'i': 'ⁱ', 'x': 'ˣ'
});
const SUB_MAP = Object.freeze({
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', 'a': 'ₐ', 'e': 'ₑ', 'i': 'ᵢ', 'n': 'ₙ', 'x': 'ₓ'
});

export function latexToReadableMath(latex = '') {
  let out = String(latex || '').trim();
  if (!out) return '';
  // Replace \frac{a}{b} and \sqrt{x}
  for (let pass = 0; pass < 4; pass += 1) {
    out = out.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)');
    out = out.replace(/\\sqrt\s*\[([^\[\]]*)\]\s*\{([^{}]*)\}/g, '$1√($2)');
    out = out.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)');
    out = out.replace(/\\text\s*\{([^{}]*)\}/g, '$1');
  }
  for (const [cmd, sym] of Object.entries(LATEX_SYMBOLS)) {
    out = out.split(cmd).join(sym);
  }
  out = out.replace(/\^\{([^{}]+)\}/g, (_, exp) =>
    [...exp].every(ch => SUP_MAP[ch]) ? [...exp].map(ch => SUP_MAP[ch]).join('') : `^(${exp})`
  );
  out = out.replace(/\^([0-9n+-])/g, (_, ch) => SUP_MAP[ch] || `^${ch}`);
  out = out.replace(/_\{([^{}]+)\}/g, (_, sub) =>
    [...sub].every(ch => SUB_MAP[ch]) ? [...sub].map(ch => SUB_MAP[ch]).join('') : `_(${sub})`
  );
  out = out.replace(/_([0-9aenix+-])/g, (_, ch) => SUB_MAP[ch] || `_${ch}`);
  out = out.replace(/\\left|\\right/g, '').replace(/\\[,;:!]/g, ' ').replace(/[{}]/g, '');
  return out.replace(/\s+/g, ' ').trim();
}

/* ---- Font & Grapheme Text Measurement --------------------------------------- */

const graphemeSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('bn', { granularity: 'grapheme' })
  : null;

function splitGraphemes(str) {
  const s = String(str || '');
  if (!s) return [];
  return graphemeSegmenter ? [...graphemeSegmenter.segment(s)].map(seg => seg.segment) : Array.from(s);
}

function createTextMeasurer() {
  let ctx = null;
  if (typeof document !== 'undefined') {
    try {
      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 32;
      const candidate = c.getContext?.('2d');
      // JSDOM without canvas package returns null; real browsers return CanvasRenderingContext2D
      if (candidate && typeof candidate.measureText === 'function') {
        const probe = candidate.measureText('কক্ষ');
        if (probe && Number.isFinite(probe.width) && probe.width > 0) {
          ctx = candidate;
        }
      }
    } catch { ctx = null; }
  }

  return function measure(textStr, fontSizePx = 16, bold = false, italic = false, mono = false) {
    const str = String(textStr || '');
    if (!str) return 0;
    if (ctx) {
      const style = italic ? 'italic ' : '';
      const weight = bold ? '700 ' : '400 ';
      const fam = mono ? 'monospace' : `${LECTURE_FONT_FAMILY}, "Noto Sans Bengali", sans-serif`;
      ctx.font = `${style}${weight}${Math.round(fontSizePx * 10) / 10}px ${fam}`;
      return ctx.measureText(str).width;
    }
    // Deterministic grapheme width fallback for headless JSDOM tests
    const graphemes = splitGraphemes(str);
    let units = 0;
    for (const g of graphemes) {
      if (/\s/.test(g)) units += 0.32;
      else if (/[\u0980-\u09FF]/.test(g)) units += 0.62;
      else if (/[A-ZMW@]/.test(g)) units += 0.68;
      else units += 0.54;
    }
    return units * fontSizePx * (bold ? 1.07 : 1);
  };
}

function ptToPx(pt) {
  const n = Number(String(pt || '').replace(/pt|px/i, ''));
  if (!Number.isFinite(n) || n <= 0) return 16;
  return String(pt).endsWith('px') ? n : (n * 96) / 72;
}

/* ---- Inline Run Extraction & Line Wrapping ---------------------------------- */

function extractInlineRuns(nodes = [], inheritedStyle = {}) {
  const runs = [];
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node || typeof node !== 'object') continue;
    if (node.type === 'hardBreak') {
      runs.push({ kind: 'break' });
      continue;
    }
    if (node.type === 'mathEquation') {
      const latex = String(node.attrs?.latex || '');
      runs.push({
        kind: 'math',
        latex,
        text: latexToReadableMath(latex),
        fontSizePx: inheritedStyle.fontSizePx || 16,
        bold: false,
        italic: true,
        color: '#0b4f3a',
        highlight: '#eef8f4'
      });
      continue;
    }
    if (node.type === 'text' && typeof node.text === 'string') {
      const style = { ...inheritedStyle };
      for (const mark of Array.isArray(node.marks) ? node.marks : []) {
        if (!mark) continue;
        if (mark.type === 'bold') style.bold = true;
        else if (mark.type === 'italic') style.italic = true;
        else if (mark.type === 'underline') style.underline = true;
        else if (mark.type === 'strike') style.strike = true;
        else if (mark.type === 'code') style.code = true;
        else if (mark.type === 'subscript') style.subscript = true;
        else if (mark.type === 'superscript') style.superscript = true;
        else if (mark.type === 'highlight') style.highlight = mark.attrs?.color || '#fef08a';
        else if (mark.type === 'textStyle') {
          if (mark.attrs?.color) style.color = mark.attrs.color;
          if (mark.attrs?.fontSize) style.fontSizePx = ptToPx(mark.attrs.fontSize);
          if (mark.attrs?.fontFamily) style.fontFamily = mark.attrs.fontFamily;
        } else if (mark.type === 'link' && mark.attrs?.href) {
          style.href = mark.attrs.href;
          style.color = style.color || '#0e7a55';
          style.underline = true;
        }
      }
      runs.push({ kind: 'text', text: node.text, ...style });
      continue;
    }
    if (Array.isArray(node.content)) {
      runs.push(...extractInlineRuns(node.content, inheritedStyle));
    }
  }
  return runs;
}

function wrapInlineRuns(runs, maxWidth, defaultFontSizePx, measure) {
  const safeMax = Math.max(60, maxWidth);
  const lines = [];
  let current = [];
  let lineWidth = 0;
  let lineMaxFont = defaultFontSizePx;

  const pushLine = () => {
    lines.push({
      segments: current,
      width: lineWidth,
      maxFontPx: lineMaxFont
    });
    current = [];
    lineWidth = 0;
    lineMaxFont = defaultFontSizePx;
  };

  const appendSegment = (seg, width) => {
    const effectiveFont = (seg.subscript || seg.superscript) ? seg.fontSizePx * 0.78 : seg.fontSizePx;
    if (current.length > 0 && current[current.length - 1].kind === 'text' && seg.kind === 'text'
      && current[current.length - 1].bold === seg.bold
      && current[current.length - 1].italic === seg.italic
      && current[current.length - 1].underline === seg.underline
      && current[current.length - 1].strike === seg.strike
      && current[current.length - 1].code === seg.code
      && current[current.length - 1].subscript === seg.subscript
      && current[current.length - 1].superscript === seg.superscript
      && current[current.length - 1].color === seg.color
      && current[current.length - 1].highlight === seg.highlight
      && current[current.length - 1].fontSizePx === seg.fontSizePx) {
      current[current.length - 1].text += seg.text;
      current[current.length - 1].width += width;
    } else {
      current.push({ ...seg, width });
    }
    lineWidth += width;
    lineMaxFont = Math.max(lineMaxFont, effectiveFont);
  };

  for (const run of runs) {
    if (run.kind === 'break') {
      pushLine();
      continue;
    }
    const fontPx = run.fontSizePx || defaultFontSizePx;
    const scale = (run.subscript || run.superscript) ? 0.76 : 1;
    const measureFont = fontPx * scale;

    if (run.kind === 'math') {
      const w = measure(run.text, measureFont, false, true, false) + 8;
      if (lineWidth + w > safeMax && current.length > 0) pushLine();
      appendSegment({ ...run, fontSizePx: fontPx }, w);
      continue;
    }

    const parts = String(run.text || '').split(/(\n)/);
    for (const part of parts) {
      if (part === '\n') {
        pushLine();
        continue;
      }
      if (!part) continue;
      const tokens = part.match(/\S+|\s+/g) || [];
      for (const token of tokens) {
        if (/^\s+$/.test(token) && current.length === 0) continue;
        const w = measure(token, measureFont, Boolean(run.bold), Boolean(run.italic), Boolean(run.code));
        if (lineWidth + w <= safeMax) {
          appendSegment({ ...run, text: token, fontSizePx: fontPx }, w);
        } else if (w <= safeMax) {
          if (current.length > 0) pushLine();
          if (!/^\s+$/.test(token)) {
            appendSegment({ ...run, text: token, fontSizePx: fontPx }, w);
          }
        } else {
          // Oversized single word/URL: wrap cleanly at grapheme boundary
          for (const g of splitGraphemes(token)) {
            const gw = measure(g, measureFont, Boolean(run.bold), Boolean(run.italic), Boolean(run.code));
            if (lineWidth + gw > safeMax && current.length > 0) pushLine();
            appendSegment({ ...run, text: g, fontSizePx: fontPx }, gw);
          }
        }
      }
    }
  }

  if (current.length > 0 || lines.length === 0) pushLine();
  return lines;
}

/* ---- Image Loader for Layout & PDF ------------------------------------------ */

async function preloadDocImages(docJson) {
  const map = new Map();
  if (typeof Image === 'undefined') return map;
  const urls = new Set();
  const collect = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'image' && isSafeLectureImageSrc(node.attrs?.src)) {
      urls.add(String(node.attrs.src).trim());
    }
    if (Array.isArray(node.content)) node.content.forEach(collect);
  };
  collect(docJson);

  await Promise.all([...urls].map(src => new Promise(resolve => {
    const img = new Image();
    const timer = setTimeout(() => resolve(), 3500);
    img.onload = () => {
      clearTimeout(timer);
      map.set(src, { img, naturalWidth: img.naturalWidth || 640, naturalHeight: img.naturalHeight || 400 });
      resolve();
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve();
    };
    img.src = src;
  })));
  return map;
}

/* ---- Main A4 Multi-Page Paginator ------------------------------------------- */

export async function paginateLectureDocument(record = {}, { preloadImages = true } = {}) {
  const settings = normalizeLecturePageSettings(record.pageSettings);
  const dim = A4_DIMENSIONS[settings.orientation] || A4_DIMENSIONS.portrait;
  const margin = MARGIN_PRESETS[settings.margins] || MARGIN_PRESETS.normal;
  const baseFontPx = ptToPx(`${settings.baseFontSize}pt`);
  const defaultLineHeight = settings.lineHeight || 1.6;
  const docJson = sanitizeLectureDocJson(record.docJson);
  const measure = createTextMeasurer();
  const imageMap = preloadImages ? await preloadDocImages(docJson) : new Map();

  const contentLeft = margin;
  const contentRight = dim.width - margin;
  const contentWidth = contentRight - contentLeft;

  const firstPageHeaderH = settings.showHeader ? 124 : 32;
  const nextPageHeaderH = settings.showHeader ? 42 : 0;
  const footerH = (settings.showFooter || settings.showPageNumbers) ? 38 : 0;

  const pages = [];
  let currentItems = [];
  let pageIndex = 0;

  const bodyTopFor = idx => margin + (idx === 0 ? firstPageHeaderH : nextPageHeaderH);
  const bodyBottom = dim.height - margin - footerH;
  let cursorY = bodyTopFor(0);

  const commitPage = () => {
    pages.push({
      pageNumber: pageIndex + 1,
      width: dim.width,
      height: dim.height,
      margin,
      bodyTop: bodyTopFor(pageIndex),
      bodyBottom,
      items: currentItems
    });
    pageIndex += 1;
    currentItems = [];
    cursorY = bodyTopFor(pageIndex);
  };

  const ensureSpace = neededHeight => {
    const usable = bodyBottom - bodyTopFor(pageIndex);
    if (cursorY > bodyTopFor(pageIndex) && cursorY + neededHeight > bodyBottom && neededHeight <= usable) {
      commitPage();
    }
  };

  const emitLinesBlock = ({
    lines, x, width, align = 'left', lineHeight = defaultLineHeight, spaceAfter = 8,
    isHeading = false, headingLevel = 0, listMarker = '', blockquote = false, codeBox = false
  }) => {
    if (!lines.length) return;
    if (isHeading) {
      const firstLineH = lines[0].maxFontPx * lineHeight;
      // Keep heading with at least ~44px of the following paragraph on the same page
      if (cursorY > bodyTopFor(pageIndex) && cursorY + firstLineH + 44 > bodyBottom) {
        commitPage();
      }
    }

    let lineIdx = 0;
    while (lineIdx < lines.length) {
      const startIdx = lineIdx;
      const slice = [];
      let blockH = codeBox || blockquote ? 12 : 0;

      while (lineIdx < lines.length) {
        const ln = lines[lineIdx];
        const lh = Math.ceil(ln.maxFontPx * lineHeight);
        if (cursorY + blockH + lh > bodyBottom && slice.length > 0) break;
        if (cursorY + blockH + lh > bodyBottom && slice.length === 0 && cursorY > bodyTopFor(pageIndex)) {
          commitPage();
          break;
        }
        slice.push({ ...ln, lineHeightPx: lh });
        blockH += lh;
        lineIdx += 1;
      }

      if (slice.length > 0) {
        currentItems.push({
          kind: 'textBlock',
          x,
          y: cursorY,
          width,
          height: blockH,
          align,
          lines: slice,
          isHeading,
          headingLevel,
          listMarker: startIdx === 0 ? listMarker : '',
          blockquote,
          codeBox
        });
        cursorY += blockH + (lineIdx >= lines.length ? spaceAfter : 0);
        if (lineIdx < lines.length) commitPage();
      }
    }
  };

  const layoutBlocks = (nodes = [], listDepth = 0) => {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      if (!node || typeof node !== 'object') continue;
      const attrs = node.attrs || {};

      if (node.type === 'pageBreak') {
        commitPage();
        continue;
      }

      if (node.type === 'horizontalRule') {
        ensureSpace(22);
        currentItems.push({
          kind: 'hr',
          x: contentLeft,
          y: cursorY + 8,
          width: contentWidth,
          height: 14
        });
        cursorY += 20;
        continue;
      }

      if (node.type === 'heading') {
        const level = Math.min(4, Math.max(1, Number(attrs.level) || 2));
        const scaleMap = { 1: 1.55, 2: 1.3, 3: 1.14, 4: 1.04 };
        const fontSizePx = Math.round(baseFontPx * (scaleMap[level] || 1.2));
        const indentPx = Math.min(6, Math.max(0, Number(attrs.indent) || 0)) * 24;
        const runs = extractInlineRuns(node.content, { fontSizePx, bold: true, color: '#0f172a' });
        const lines = wrapInlineRuns(runs, contentWidth - indentPx, fontSizePx, measure);
        const lh = Number(attrs.lineHeight) || 1.35;
        const spaceAfter = attrs.spaceAfter !== undefined ? Number(attrs.spaceAfter) : 8;
        cursorY += level <= 2 && cursorY > bodyTopFor(pageIndex) ? 6 : 2;
        emitLinesBlock({
          lines,
          x: contentLeft + indentPx,
          width: contentWidth - indentPx,
          align: attrs.textAlign || 'left',
          lineHeight: lh,
          spaceAfter,
          isHeading: true,
          headingLevel: level
        });
        continue;
      }

      if (node.type === 'paragraph') {
        const indentPx = Math.min(6, Math.max(0, Number(attrs.indent) || 0)) * 24;
        const runs = extractInlineRuns(node.content, { fontSizePx: baseFontPx, color: '#111827' });
        const lines = wrapInlineRuns(runs, contentWidth - indentPx, baseFontPx, measure);
        const lh = Number(attrs.lineHeight) || defaultLineHeight;
        const spaceAfter = attrs.spaceAfter !== undefined ? Number(attrs.spaceAfter) : 8;
        emitLinesBlock({
          lines,
          x: contentLeft + indentPx,
          width: contentWidth - indentPx,
          align: attrs.textAlign || 'left',
          lineHeight: lh,
          spaceAfter
        });
        continue;
      }

      if (node.type === 'blockquote') {
        const runs = extractInlineRuns(node.content, { fontSizePx: baseFontPx, italic: true, color: '#1e293b' });
        const padLeft = 18;
        const lines = wrapInlineRuns(runs, contentWidth - padLeft - 12, baseFontPx, measure);
        emitLinesBlock({
          lines,
          x: contentLeft,
          width: contentWidth,
          align: 'left',
          lineHeight: defaultLineHeight,
          spaceAfter: 10,
          blockquote: true
        });
        continue;
      }

      if (node.type === 'codeBlock') {
        const runs = extractInlineRuns(node.content, { fontSizePx: Math.max(12, baseFontPx - 2), code: true, color: '#0f172a' });
        const lines = wrapInlineRuns(runs, contentWidth - 24, Math.max(12, baseFontPx - 2), measure);
        emitLinesBlock({
          lines,
          x: contentLeft,
          width: contentWidth,
          align: 'left',
          lineHeight: 1.45,
          spaceAfter: 10,
          codeBox: true
        });
        continue;
      }

      if (node.type === 'bulletList' || node.type === 'orderedList') {
        const ordered = node.type === 'orderedList';
        const items = Array.isArray(node.content) ? node.content : [];
        items.forEach((li, idx) => {
          const marker = ordered ? `${idx + 1}.` : '•';
          const indentOffset = 24 + listDepth * 20;
          const childBlocks = Array.isArray(li?.content) ? li.content : [];
          let firstPara = true;
          for (const child of childBlocks) {
            if (child.type === 'bulletList' || child.type === 'orderedList') {
              layoutBlocks([child], listDepth + 1);
            } else {
              const runs = extractInlineRuns(child.content || [child], { fontSizePx: baseFontPx, color: '#111827' });
              const lines = wrapInlineRuns(runs, contentWidth - indentOffset, baseFontPx, measure);
              emitLinesBlock({
                lines,
                x: contentLeft + indentOffset,
                width: contentWidth - indentOffset,
                align: child.attrs?.textAlign || 'left',
                lineHeight: defaultLineHeight,
                spaceAfter: 4,
                listMarker: firstPara ? marker : ''
              });
              firstPara = false;
            }
          }
        });
        cursorY += 4;
        continue;
      }

      if (node.type === 'mathEquation') {
        const latex = String(attrs.latex || '');
        const readable = latexToReadableMath(latex);
        const fontPx = Math.round(baseFontPx * 1.15);
        const runs = [{ kind: 'math', latex, text: readable, fontSizePx: fontPx, italic: true, color: '#0b4f3a' }];
        const lines = wrapInlineRuns(runs, contentWidth - 32, fontPx, measure);
        const boxH = Math.max(42, lines.length * Math.ceil(fontPx * 1.5) + 16);
        ensureSpace(boxH + 8);
        currentItems.push({
          kind: 'mathBlock',
          x: contentLeft,
          y: cursorY,
          width: contentWidth,
          height: boxH,
          latex,
          readable,
          lines
        });
        cursorY += boxH + 10;
        continue;
      }

      if (node.type === 'image') {
        const src = String(attrs.src || '').trim();
        if (!isSafeLectureImageSrc(src)) continue;
        const widthPct = [25, 50, 75, 100].includes(Number(attrs.widthPct)) ? Number(attrs.widthPct) : 75;
        const align = ['left', 'center', 'right'].includes(attrs.align) ? attrs.align : 'center';
        const caption = String(attrs.caption || attrs.alt || '').trim();
        const meta = imageMap.get(src);
        const natW = meta?.naturalWidth || 640;
        const natH = meta?.naturalHeight || 380;

        let targetW = Math.round((contentWidth * widthPct) / 100);
        let targetH = Math.round((targetW * natH) / Math.max(1, natW));
        const maxImgH = Math.max(140, (bodyBottom - bodyTopFor(1)) - (caption ? 38 : 16));
        if (targetH > maxImgH) {
          targetW = Math.round((targetW * maxImgH) / targetH);
          targetH = maxImgH;
        }
        const totalH = targetH + (caption ? 24 : 0);
        ensureSpace(totalH + 8);

        const drawX = align === 'center'
          ? contentLeft + Math.round((contentWidth - targetW) / 2)
          : (align === 'right' ? contentRight - targetW : contentLeft);

        currentItems.push({
          kind: 'image',
          x: drawX,
          y: cursorY,
          width: targetW,
          height: targetH,
          totalHeight: totalH,
          src,
          imgElement: meta?.img || null,
          align,
          widthPct,
          caption
        });
        cursorY += totalH + 10;
        continue;
      }

      if (node.type === 'table') {
        const rawRows = (node.content || []).filter(r => r && r.type === 'tableRow');
        if (!rawRows.length) continue;
        const colCount = Math.max(1, ...rawRows.map(r => (r.content || []).length));
        const colW = contentWidth / colCount;
        const cellPadX = 8;
        const cellPadY = 6;
        const tableFontPx = Math.max(12, baseFontPx - 1);

        const measuredRows = rawRows.map((rowNode, rIdx) => {
          const cells = (rowNode.content || []).map(cellNode => {
            const isHeader = cellNode.type === 'tableHeader';
            const runs = extractInlineRuns(cellNode.content || [], {
              fontSizePx: tableFontPx,
              bold: isHeader,
              color: '#0f172a'
            });
            const lines = wrapInlineRuns(runs, Math.max(36, colW - cellPadX * 2), tableFontPx, measure);
            const cellH = lines.length * Math.ceil(tableFontPx * 1.4) + cellPadY * 2;
            return { isHeader, lines, cellH };
          });
          while (cells.length < colCount) {
            cells.push({ isHeader: rIdx === 0 && cells[0]?.isHeader, lines: [], cellH: tableFontPx + cellPadY * 2 });
          }
          const rowH = Math.max(28, ...cells.map(c => c.cellH));
          return {
            isHeaderRow: cells.every(c => c.isHeader),
            rowH,
            cells
          };
        });

        const headerRow = measuredRows[0]?.isHeaderRow ? measuredRows[0] : null;
        let rowCursor = 0;

        while (rowCursor < measuredRows.length) {
          const tableRowsSlice = [];
          let sliceH = 0;

          if (rowCursor > 0 && headerRow) {
            tableRowsSlice.push(headerRow);
            sliceH += headerRow.rowH;
          }

          while (rowCursor < measuredRows.length) {
            const r = measuredRows[rowCursor];
            const minFirstSlice = tableRowsSlice.length === (rowCursor > 0 && headerRow ? 1 : 0);
            if (cursorY + sliceH + r.rowH > bodyBottom) {
              if (minFirstSlice && cursorY > bodyTopFor(pageIndex)) {
                commitPage();
                sliceH = 0;
                tableRowsSlice.length = 0;
                break;
              }
              if (!minFirstSlice) break;
            }
            tableRowsSlice.push(r);
            sliceH += r.rowH;
            rowCursor += 1;
          }

          if (tableRowsSlice.length > 0) {
            currentItems.push({
              kind: 'table',
              x: contentLeft,
              y: cursorY,
              width: contentWidth,
              height: sliceH,
              colCount,
              colW,
              cellPadX,
              cellPadY,
              tableFontPx,
              rows: tableRowsSlice
            });
            cursorY += sliceH + (rowCursor >= measuredRows.length ? 10 : 0);
            if (rowCursor < measuredRows.length) commitPage();
          }
        }
      }
    }
  };

  layoutBlocks(docJson.content || []);
  commitPage();

  const totalPages = pages.length;
  for (const page of pages) {
    page.totalPages = totalPages;
  }

  return {
    record: {
      title: String(record.title || 'শিরোনামহীন লেকচার শিট'),
      subtitle: String(record.subtitle || ''),
      subjectName: String(record.subjectName || record.subject || ''),
      className: String(record.className || record.class || ''),
      group: String(record.group || ''),
      chapterName: String(record.chapterName || ''),
      topic: String(record.topic || ''),
      teacherName: String(record.teacherName || record.createdBy || '')
    },
    settings,
    dimensions: dim,
    margin,
    totalPages,
    pages
  };
}

/* ---- Preview HTML Renderer (Consumes Exact Same Paginated Layout) ----------- */

function renderSegmentHtml(seg, renderMath) {
  if (seg.kind === 'math') {
    if (typeof renderMath === 'function') {
      return `<span class="ls-inline-math">${renderMath(seg.latex || seg.text, false)}</span>`;
    }
    return `<span class="ls-inline-math">${escapeHtml(seg.text)}</span>`;
  }
  let html = escapeHtml(seg.text || '');
  if (seg.code) html = `<code>${html}</code>`;
  if (seg.subscript) html = `<sub>${html}</sub>`;
  if (seg.superscript) html = `<sup>${html}</sup>`;
  if (seg.bold) html = `<strong>${html}</strong>`;
  if (seg.italic) html = `<em>${html}</em>`;
  if (seg.underline) html = `<u>${html}</u>`;
  if (seg.strike) html = `<s>${html}</s>`;
  const styles = [];
  if (seg.color) styles.push(`color:${escapeHtml(seg.color)}`);
  if (seg.highlight) styles.push(`background:${escapeHtml(seg.highlight)};padding:0 2px;border-radius:2px`);
  if (seg.fontSizePx) styles.push(`font-size:${Math.round(seg.fontSizePx * 10) / 10}px`);
  return styles.length ? `<span style="${styles.join(';')}">${html}</span>` : html;
}

export function renderLecturePreviewPagesHtml(layout, { renderMath = null, logoSrc = 'assets/icons/logo-128.png' } = {}) {
  const { record, settings, dimensions, margin, pages, totalPages } = layout;
  const metaPills = [
    record.className,
    record.group,
    record.subjectName ? `বিষয়: ${record.subjectName}` : '',
    record.chapterName ? `অধ্যায়: ${record.chapterName}` : '',
    record.topic ? `টপিক: ${record.topic}` : ''
  ].filter(Boolean);

  return pages.map(page => {
    const isFirst = page.pageNumber === 1;
    let headerHtml = '';
    if (settings.showHeader) {
      if (isFirst) {
        headerHtml = `
          <header class="ls-a4-header ls-a4-header-first" style="left:${margin}px;right:${margin}px;top:${Math.max(18, margin - 18)}px">
            <div class="ls-a4-brand-row">
              ${settings.showLogo ? `<img src="${escapeHtml(logoSrc)}" alt="" class="ls-a4-logo">` : ''}
              <div class="ls-a4-brand-copy">
                <strong>${escapeHtml(BRAND_NAME)}</strong>
                <span>${escapeHtml(settings.headerText || BRAND_TAGLINE)}</span>
              </div>
              <div class="ls-a4-sheet-tag">লেকচার শিট</div>
            </div>
            <div class="ls-a4-doc-banner">
              <h1>${escapeHtml(record.title)}</h1>
              ${record.subtitle ? `<p class="ls-a4-subtitle">${escapeHtml(record.subtitle)}</p>` : ''}
              ${metaPills.length ? `<div class="ls-a4-meta-row">${metaPills.map(m => `<span>${escapeHtml(m)}</span>`).join('')}</div>` : ''}
            </div>
          </header>`;
      } else {
        const runningRight = [record.subjectName, record.className].filter(Boolean).join(' • ');
        headerHtml = `
          <header class="ls-a4-header ls-a4-header-running" style="left:${margin}px;right:${margin}px;top:${Math.max(16, margin - 16)}px">
            <span>${escapeHtml(settings.headerText || record.title)}</span>
            <span>${escapeHtml(runningRight || BRAND_NAME)}</span>
          </header>`;
      }
    } else if (isFirst) {
      headerHtml = `
        <header class="ls-a4-header ls-a4-header-minimal" style="left:${margin}px;right:${margin}px;top:${margin}px">
          <h1>${escapeHtml(record.title)}</h1>
        </header>`;
    }

    const bodyHtml = page.items.map(item => {
      if (item.kind === 'hr') {
        return `<hr class="ls-a4-hr" style="left:${item.x}px;top:${item.y}px;width:${item.width}px">`;
      }
      if (item.kind === 'textBlock') {
        const linesMarkup = item.lines.map(ln =>
          `<div class="ls-a4-line" style="height:${ln.lineHeightPx}px;line-height:${ln.lineHeightPx}px;text-align:${escapeHtml(item.align)}">${ln.segments.map(s => renderSegmentHtml(s, renderMath)).join('')}</div>`
        ).join('');
        const cls = [
          'ls-a4-block',
          item.isHeading ? `ls-a4-h${item.headingLevel}` : '',
          item.blockquote ? 'ls-a4-quote' : '',
          item.codeBox ? 'ls-a4-code' : ''
        ].filter(Boolean).join(' ');
        const markerHtml = item.listMarker
          ? `<span class="ls-a4-list-marker" style="left:-22px">${escapeHtml(item.listMarker)}</span>`
          : '';
        return `<div class="${cls}" style="left:${item.x}px;top:${item.y}px;width:${item.width}px">${markerHtml}${linesMarkup}</div>`;
      }
      if (item.kind === 'mathBlock') {
        const mathContent = typeof renderMath === 'function'
          ? renderMath(item.latex, true)
          : `<span>${escapeHtml(item.readable)}</span>`;
        return `<div class="ls-a4-math-block" style="left:${item.x}px;top:${item.y}px;width:${item.width}px;min-height:${item.height}px">${mathContent}</div>`;
      }
      if (item.kind === 'image') {
        return `<figure class="ls-a4-figure" style="left:${item.x}px;top:${item.y}px;width:${item.width}px">
          <img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.caption)}" style="width:${item.width}px;height:${item.height}px;object-fit:contain">
          ${item.caption ? `<figcaption>${escapeHtml(item.caption)}</figcaption>` : ''}
        </figure>`;
      }
      if (item.kind === 'table') {
        const rowsHtml = item.rows.map(r => `<tr>${r.cells.map(c => {
          const tag = c.isHeader ? 'th' : 'td';
          const cellBody = c.lines.map(ln => `<div>${ln.segments.map(s => renderSegmentHtml(s, renderMath)).join('')}</div>`).join('');
          return `<${tag} style="width:${item.colW}px;height:${r.rowH}px;padding:${item.cellPadY}px ${item.cellPadX}px;font-size:${item.tableFontPx}px">${cellBody}</${tag}>`;
        }).join('')}</tr>`).join('');
        return `<table class="ls-a4-table" style="left:${item.x}px;top:${item.y}px;width:${item.width}px">${rowsHtml}</table>`;
      }
      return '';
    }).join('');

    let footerHtml = '';
    if (settings.showFooter || settings.showPageNumbers) {
      const leftLabel = settings.showFooter
        ? (settings.footerText || BRAND_NAME)
        : '';
      const rightLabel = settings.showPageNumbers
        ? `পৃষ্ঠা ${bn(page.pageNumber)} / ${bn(totalPages)}`
        : '';
      footerHtml = `
        <footer class="ls-a4-footer" style="left:${margin}px;right:${margin}px;bottom:${Math.max(14, margin - 22)}px">
          <span>${escapeHtml(leftLabel)}</span>
          <span>${escapeHtml(rightLabel)}</span>
        </footer>`;
    }

    const watermarkHtml = settings.showWatermark !== false
      ? '<img class="ls-a4-watermark" src="assets/icons/app-logo.png" alt="" aria-hidden="true">'
      : '';

    return `
      <article class="ls-preview-page" data-ls-page="${page.pageNumber}" style="width:${dimensions.width}px;height:${dimensions.height}px">
        ${watermarkHtml}
        ${headerHtml}
        <div class="ls-a4-page-body">${bodyHtml}</div>
        ${footerHtml}
      </article>`;
  }).join('');
}

/* ---- Orientation-Aware Multi-Page PDF Binary Assembler ---------------------- */

export function assembleLecturePDF(canvasPages, { orientation = 'portrait' } = {}) {
  if (!canvasPages.length) throw new Error('PDF তৈরির জন্য কোনো পৃষ্ঠা পাওয়া যায়নি।');
  const dim = A4_DIMENSIONS[orientation] || A4_DIMENSIONS.portrait;
  const ptW = dim.pdfPtWidth.toFixed(2);
  const ptH = dim.pdfPtHeight.toFixed(2);

  const encoder = new TextEncoder();
  const chunks = [];
  const offsets = [0];
  let length = 0;

  const append = data => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id, ...parts) => {
    offsets[id] = length;
    append(`${id} 0 obj\n`);
    parts.forEach(append);
    append('\nendobj\n');
  };

  append('%PDF-1.4\n');
  append(new Uint8Array([37, 226, 227, 207, 211, 10]));
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Count ${canvasPages.length} /Kids [${canvasPages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`);

  canvasPages.forEach((p, i) => {
    const id = 3 + i * 3;
    const stream = `q\n${ptW} 0 0 ${ptH} 0 0 cm\n/Im${i} Do\nQ`;
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW} ${ptH}] /Resources << /XObject << /Im${i} ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`);
    object(
      id + 1,
      `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      p.jpeg,
      '\nendstream'
    );
    object(id + 2, `<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`);
  });

  const xref = length;
  const count = 3 + canvasPages.length * 3;
  append(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let i = 1; i < count; i += 1) {
    append(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  append(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(chunks, { type: 'application/pdf' });
}

/* ---- Canvas Page Painter -> Multi-Page PDF Blob ----------------------------- */

function drawPageOnCanvas(ctx, page, layout, { logo, watermark }) {
  const { record, settings, dimensions, margin, totalPages } = layout;
  const W = dimensions.width;
  const H = dimensions.height;

  ctx.save();
  ctx.scale(PDF_SCALE, PDF_SCALE);

  // Crisp white paper background + subtle institutional watermark
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  if (settings.showWatermark !== false && watermark) {
    try { drawWatermark(ctx, W, H, watermark); } catch { /* ignore */ }
  }

  const setFont = (sizePx, bold = false, italic = false, mono = false) => {
    const style = italic ? 'italic ' : '';
    const weight = bold ? '700 ' : '400 ';
    const fam = mono ? 'monospace' : `${LECTURE_FONT_FAMILY}, "Noto Sans Bengali", sans-serif`;
    ctx.font = `${style}${weight}${Math.round(sizePx * 10) / 10}px ${fam}`;
  };

  // Header
  if (settings.showHeader) {
    if (page.pageNumber === 1) {
      const topY = Math.max(18, margin - 18);
      let brandX = margin;
      if (settings.showLogo && logo) {
        try {
          ctx.drawImage(logo, margin, topY, 38, 38);
          brandX = margin + 48;
        } catch { /* ignore */ }
      }
      ctx.fillStyle = '#0e7a55';
      setFont(16, true);
      ctx.fillText(BRAND_NAME, brandX, topY + 18);
      ctx.fillStyle = '#475569';
      setFont(11, false);
      ctx.fillText(settings.headerText || BRAND_TAGLINE, brandX, topY + 34);

      // Sheet badge right
      ctx.fillStyle = '#ecfdf5';
      ctx.strokeStyle = '#a7f3d0';
      ctx.lineWidth = 1;
      ctx.fillRect(W - margin - 92, topY + 6, 92, 24);
      ctx.strokeRect(W - margin - 92, topY + 6, 92, 24);
      ctx.fillStyle = '#047857';
      setFont(11, true);
      ctx.textAlign = 'center';
      ctx.fillText('লেকচার শিট', W - margin - 46, topY + 22);
      ctx.textAlign = 'left';

      // Title banner box
      const bannerY = topY + 46;
      ctx.fillStyle = '#f8fafc';
      ctx.strokeStyle = '#cbd5e1';
      ctx.fillRect(margin, bannerY, W - margin * 2, 66);
      ctx.strokeRect(margin, bannerY, W - margin * 2, 66);

      ctx.fillStyle = '#0f172a';
      setFont(17, true);
      ctx.fillText(String(record.title || '').slice(0, 90), margin + 12, bannerY + 24);

      const metaLine = [
        record.subtitle,
        record.className,
        record.group,
        record.subjectName ? `বিষয়: ${record.subjectName}` : '',
        record.chapterName ? `অধ্যায়: ${record.chapterName}` : '',
        record.topic ? `টপিক: ${record.topic}` : ''
      ].filter(Boolean).join('  •  ');
      ctx.fillStyle = '#475569';
      setFont(11, false);
      ctx.fillText(metaLine.slice(0, 125), margin + 12, bannerY + 48);
    } else {
      const topY = Math.max(18, margin - 14);
      ctx.fillStyle = '#475569';
      setFont(11, true);
      ctx.fillText(String(settings.headerText || record.title).slice(0, 65), margin, topY + 12);
      const rightText = [record.subjectName, record.className].filter(Boolean).join(' • ') || BRAND_NAME;
      ctx.textAlign = 'right';
      setFont(11, false);
      ctx.fillText(rightText.slice(0, 50), W - margin, topY + 12);
      ctx.textAlign = 'left';
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(margin, topY + 22);
      ctx.lineTo(W - margin, topY + 22);
      ctx.stroke();
    }
  } else if (page.pageNumber === 1 && record.title) {
    ctx.fillStyle = '#0f172a';
    setFont(18, true);
    ctx.fillText(record.title.slice(0, 90), margin, margin + 18);
  }

  // Body items
  const drawInlineSegments = (segments, lineX, baselineY, width, align) => {
    const segWidths = segments.reduce((sum, s) => sum + (s.width || 0), 0);
    let curX = lineX;
    if (align === 'center') curX = lineX + Math.max(0, (width - segWidths) / 2);
    else if (align === 'right') curX = lineX + Math.max(0, width - segWidths);

    for (const seg of segments) {
      const fSize = (seg.subscript || seg.superscript) ? (seg.fontSizePx || 16) * 0.76 : (seg.fontSizePx || 16);
      const yOffset = seg.superscript ? -fSize * 0.36 : (seg.subscript ? fSize * 0.24 : 0);
      setFont(fSize, Boolean(seg.bold), Boolean(seg.italic || seg.kind === 'math'), Boolean(seg.code));
      const measuredW = ctx.measureText(seg.text || '').width || seg.width || 0;

      if (seg.highlight) {
        ctx.fillStyle = seg.highlight;
        ctx.fillRect(curX, baselineY - fSize * 0.85 + yOffset, measuredW + 2, fSize * 1.15);
      }
      ctx.fillStyle = seg.color || '#111827';
      ctx.fillText(seg.text || '', curX, baselineY + yOffset);

      if (seg.underline) {
        ctx.strokeStyle = seg.color || '#111827';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(curX, baselineY + 2 + yOffset);
        ctx.lineTo(curX + measuredW, baselineY + 2 + yOffset);
        ctx.stroke();
      }
      if (seg.strike) {
        ctx.strokeStyle = seg.color || '#111827';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(curX, baselineY - fSize * 0.3 + yOffset);
        ctx.lineTo(curX + measuredW, baselineY - fSize * 0.3 + yOffset);
        ctx.stroke();
      }
      curX += measuredW;
    }
  };

  for (const item of page.items) {
    if (item.kind === 'hr') {
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(item.x, item.y);
      ctx.lineTo(item.x + item.width, item.y);
      ctx.stroke();
      continue;
    }

    if (item.kind === 'textBlock') {
      let innerX = item.x;
      let innerW = item.width;
      let yCursor = item.y;

      if (item.blockquote) {
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(item.x, item.y, item.width, item.height);
        ctx.fillStyle = '#0e7a55';
        ctx.fillRect(item.x, item.y, 4, item.height);
        innerX += 14;
        innerW -= 22;
        yCursor += 6;
      } else if (item.codeBox) {
        ctx.fillStyle = '#f1f5f9';
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1;
        ctx.fillRect(item.x, item.y, item.width, item.height);
        ctx.strokeRect(item.x, item.y, item.width, item.height);
        innerX += 12;
        innerW -= 24;
        yCursor += 6;
      }

      if (item.listMarker) {
        ctx.fillStyle = '#0f172a';
        setFont(item.lines[0]?.maxFontPx || 15, true);
        ctx.fillText(item.listMarker, item.x - 20, yCursor + (item.lines[0]?.lineHeightPx || 22) * 0.76);
      }

      for (const ln of item.lines) {
        const baselineY = yCursor + ln.lineHeightPx * 0.76;
        drawInlineSegments(ln.segments, innerX, baselineY, innerW, item.align);
        yCursor += ln.lineHeightPx;
      }
      continue;
    }

    if (item.kind === 'mathBlock') {
      ctx.fillStyle = '#f4fbf8';
      ctx.strokeStyle = '#cce8dc';
      ctx.lineWidth = 1;
      ctx.fillRect(item.x, item.y, item.width, item.height);
      ctx.strokeRect(item.x, item.y, item.width, item.height);
      let yCur = item.y + 8;
      for (const ln of item.lines) {
        const lh = Math.ceil((ln.maxFontPx || 18) * 1.45);
        drawInlineSegments(ln.segments, item.x + 12, yCur + lh * 0.76, item.width - 24, 'center');
        yCur += lh;
      }
      continue;
    }

    if (item.kind === 'image') {
      if (item.imgElement) {
        try {
          ctx.drawImage(item.imgElement, item.x, item.y, item.width, item.height);
        } catch { /* cross-origin fallback box */ }
      } else {
        ctx.strokeStyle = '#cbd5e1';
        ctx.strokeRect(item.x, item.y, item.width, item.height);
      }
      if (item.caption) {
        ctx.fillStyle = '#475569';
        setFont(11, false, true);
        ctx.textAlign = 'center';
        ctx.fillText(item.caption.slice(0, 90), item.x + item.width / 2, item.y + item.height + 16);
        ctx.textAlign = 'left';
      }
      continue;
    }

    if (item.kind === 'table') {
      let rowY = item.y;
      for (const row of item.rows) {
        let colX = item.x;
        for (const cell of row.cells) {
          if (cell.isHeader) {
            ctx.fillStyle = '#eef6f2';
            ctx.fillRect(colX, rowY, item.colW, row.rowH);
          }
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 1;
          ctx.strokeRect(colX, rowY, item.colW, row.rowH);

          let lineY = rowY + item.cellPadY;
          const lh = Math.ceil(item.tableFontPx * 1.4);
          for (const ln of cell.lines) {
            drawInlineSegments(ln.segments, colX + item.cellPadX, lineY + lh * 0.76, item.colW - item.cellPadX * 2, 'left');
            lineY += lh;
          }
          colX += item.colW;
        }
        rowY += row.rowH;
      }
    }
  }

  // Footer
  if (settings.showFooter || settings.showPageNumbers) {
    const footY = H - Math.max(18, margin - 18);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin, footY - 18);
    ctx.lineTo(W - margin, footY - 18);
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    setFont(11, false);
    if (settings.showFooter) {
      const leftLabel = settings.footerText || BRAND_NAME;
      ctx.fillText(leftLabel.slice(0, 75), margin, footY);
    }
    if (settings.showPageNumbers) {
      ctx.textAlign = 'right';
      ctx.fillText(`পৃষ্ঠা ${bn(page.pageNumber)} / ${bn(totalPages)}`, W - margin, footY);
      ctx.textAlign = 'left';
    }
  }

  ctx.restore();
}

async function canvasToJpegBytes(canvas) {
  if (typeof canvas.toBlob === 'function') {
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('PDF পৃষ্ঠা রেন্ডার করা যায়নি।'))), 'image/jpeg', 0.91);
    });
    return new Uint8Array(await blob.arrayBuffer());
  }
  const dataUrl = canvas.toDataURL('image/jpeg', 0.91);
  const b64 = dataUrl.split(',')[1] || '';
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export async function generateLecturePdfBlob(record = {}, { onProgress = null } = {}) {
  const startedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (typeof onProgress === 'function') onProgress({ stage: 'layout', currentPage: 0, totalPages: 0 });

  const [assets, layout] = await Promise.all([
    loadLecturePdfAssets(),
    paginateLectureDocument(record, { preloadImages: true })
  ]);

  const canvasW = Math.round(layout.dimensions.width * PDF_SCALE);
  const canvasH = Math.round(layout.dimensions.height * PDF_SCALE);
  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext?.('2d');

  const canvasPages = [];
  if (ctx && typeof ctx.fillRect === 'function') {
    for (const page of layout.pages) {
      if (typeof onProgress === 'function') {
        onProgress({ stage: 'render', currentPage: page.pageNumber, totalPages: layout.totalPages });
      }
      drawPageOnCanvas(ctx, page, layout, assets);
      const jpeg = await canvasToJpegBytes(canvas);
      canvasPages.push({ jpeg, width: canvasW, height: canvasH });
    }
  } else {
    // Minimal valid 1x1 JPEG fallback exclusively for headless JSDOM unit tests without node-canvas
    const minimalJpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
      0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
      0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
      0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
      0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
      0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
      0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
      0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x08, 0xff, 0xc4, 0x00, 0x14, 0x10, 0x01, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
      0x7f, 0xff, 0xd9
    ]);
    for (let i = 0; i < layout.totalPages; i += 1) {
      canvasPages.push({ jpeg: minimalJpeg, width: 1, height: 1 });
    }
  }

  const blob = assembleLecturePDF(canvasPages, { orientation: layout.settings.orientation });
  const elapsedMs = Math.max(1, Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt));
  const filename = buildLecturePdfFilename(layout.record);

  return {
    blob,
    filename,
    totalPages: layout.totalPages,
    elapsedMs,
    layout
  };
}

export function triggerPdfDownload(blob, filename) {
  const safeName = String(filename || 'Lecture_Sheet.pdf').trim() || 'Lecture_Sheet.pdf';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function downloadLectureSheetPDF(record, options = {}) {
  const result = await generateLecturePdfBlob(record, options);
  triggerPdfDownload(result.blob, result.filename);
  return result;
}

export async function printLectureSheet(record, { renderMath = null } = {}) {
  const layout = await paginateLectureDocument(record, { preloadImages: true });
  const pagesHtml = renderLecturePreviewPagesHtml(layout, { renderMath });
  const isLandscape = layout.settings.orientation === 'landscape';

  let printHost = document.getElementById('apcLecturePrintContainer');
  if (!printHost) {
    printHost = document.createElement('div');
    printHost.id = 'apcLecturePrintContainer';
    printHost.className = 'ls-print-only-root';
    document.body.appendChild(printHost);
  }
  printHost.dataset.orientation = isLandscape ? 'landscape' : 'portrait';
  printHost.innerHTML = pagesHtml;

  if (typeof window.print === 'function') {
    window.print();
  }
  return layout;
}

export async function openStudentLectureReaderModal(record) {
  if (!record || typeof document === 'undefined') return null;
  document.getElementById('apcStudentLectureReader')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'apcStudentLectureReader';
  overlay.className = 'ls-studio-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', record.title || 'লেকচার শিট পাঠক');

  let zoom = typeof window !== 'undefined' && window.innerWidth < 860 ? 'fit' : 100;
  let totalPages = 1;
  let curPage = 1;
  let layout = null;

  overlay.innerHTML = `
    <div class="ls-studio-shell">
      <header class="ls-topbar">
        <div class="ls-topbar-start">
          <button type="button" class="ls-btn" data-slr-close>← ফিরে যান</button>
          <div class="ls-title-wrap">
            <strong style="font-size:15px">${escapeHtml(record.title || 'লেকচার শিট')}</strong>
            <small style="color:var(--color-text-secondary);font-size:12px">${escapeHtml([record.className, record.subjectName || record.subject, record.chapterName, record.topic].filter(Boolean).join(' • '))}</small>
          </div>
        </div>
        <div class="ls-topbar-actions">
          <button type="button" class="ls-btn" data-slr-print>🖨 প্রিন্ট</button>
          <button type="button" class="ls-btn ls-publish-btn" data-slr-download>⬇ PDF ডাউনলোড</button>
        </div>
      </header>
      <div class="ls-pagebar">
        <div class="ls-pagebar-left">
          <button type="button" class="ls-ctx-btn" data-slr-nav="prev">◀ আগের</button>
          <span class="ls-page-counter" data-slr-counter>পৃষ্ঠা ১ / ১</span>
          <button type="button" class="ls-ctx-btn" data-slr-nav="next">পরের ▶</button>
        </div>
        <div class="ls-pagebar-right">
          <div class="ls-zoom-controls">
            <button type="button" class="ls-zoom-btn" data-slr-zoom="out">−</button>
            <button type="button" class="ls-zoom-btn ls-zoom-fit" data-slr-zoom="fit" data-slr-zoom-label>ফিট</button>
            <button type="button" class="ls-zoom-btn" data-slr-zoom="in">+</button>
          </div>
        </div>
      </div>
      <main class="ls-workspace">
        <div class="ls-preview-pages-wrap" data-slr-pages><div class="ls-preview-loading">লেকচার শিট লোড হচ্ছে…</div></div>
      </main>
    </div>`;

  document.documentElement.classList.add('apc-lecture-studio-open');
  document.body.appendChild(overlay);

  const effectiveScale = () => {
    const dim = layout?.dimensions || A4_DIMENSIONS.portrait;
    if (zoom === 'fit') {
      const vw = Math.max(320, (window.innerWidth || 390) - 24);
      return Math.min(1, Math.max(0.38, vw / dim.width));
    }
    return Math.min(1.5, Math.max(0.45, (Number(zoom) || 100) / 100));
  };

  const paintPages = async () => {
    const wrap = overlay.querySelector('[data-slr-pages]');
    try {
      if (!layout) layout = await paginateLectureDocument(record, { preloadImages: true });
      totalPages = layout.totalPages;
      const scale = effectiveScale();
      wrap.innerHTML = `<div class="ls-preview-scaled-stack">${renderLecturePreviewPagesHtml(layout)}</div>`;
      overlay.querySelectorAll('.ls-preview-page').forEach(pageEl => {
        const slot = document.createElement('div');
        slot.className = 'ls-preview-page-slot';
        slot.style.width = `${Math.round(layout.dimensions.width * scale)}px`;
        slot.style.height = `${Math.round(layout.dimensions.height * scale)}px`;
        pageEl.style.transform = `scale(${scale})`;
        pageEl.style.transformOrigin = 'top left';
        pageEl.parentNode.insertBefore(slot, pageEl);
        slot.appendChild(pageEl);
      });
      const counter = overlay.querySelector('[data-slr-counter]');
      if (counter) counter.textContent = `পৃষ্ঠা ${bn(curPage)} / ${bn(totalPages)}`;
      const zLabel = overlay.querySelector('[data-slr-zoom-label]');
      if (zLabel) zLabel.textContent = zoom === 'fit' ? 'ফিট' : `${bn(zoom)}%`;
    } catch (err) {
      wrap.innerHTML = `<div class="ls-preview-error">প্রিভিউ লোড করা যায়নি: ${escapeHtml(err?.message || '')}</div>`;
    }
  };

  const close = () => {
    overlay.remove();
    document.documentElement.classList.remove('apc-lecture-studio-open');
  };

  overlay.addEventListener('click', async ev => {
    if (ev.target.closest('[data-slr-close]')) { close(); return; }
    const zBtn = ev.target.closest('[data-slr-zoom]');
    if (zBtn) {
      const dir = zBtn.dataset.slrZoom;
      if (dir === 'fit') zoom = zoom === 'fit' ? 100 : 'fit';
      else {
        const cur = zoom === 'fit' ? Math.round(effectiveScale() * 100) : Number(zoom) || 100;
        zoom = Math.min(150, Math.max(50, cur + (dir === 'in' ? 15 : -15)));
      }
      await paintPages();
      return;
    }
    const nav = ev.target.closest('[data-slr-nav]');
    if (nav) {
      curPage = Math.min(totalPages, Math.max(1, curPage + (nav.dataset.slrNav === 'next' ? 1 : -1)));
      overlay.querySelector(`.ls-preview-page[data-ls-page="${curPage}"]`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      const counter = overlay.querySelector('[data-slr-counter]');
      if (counter) counter.textContent = `পৃষ্ঠা ${bn(curPage)} / ${bn(totalPages)}`;
      return;
    }
    const dl = ev.target.closest('[data-slr-download]');
    if (dl) {
      const orig = dl.textContent;
      dl.disabled = true;
      dl.textContent = '⏳ PDF তৈরি হচ্ছে…';
      try { await downloadLectureSheetPDF(record); }
      finally { dl.disabled = false; dl.textContent = orig; }
      return;
    }
    if (ev.target.closest('[data-slr-print]')) {
      await printLectureSheet(record);
    }
  });

  await paintPages();
  return { overlay, close };
}
