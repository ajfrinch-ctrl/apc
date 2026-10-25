import { escapeHtml } from './sanitize.js';

/** Keep a small, semantic formatting subset for lesson sheets pasted from
 * Word/Google Docs. No scripts, styles, event handlers, embeds or unsafe URLs. */
export function sanitizeRichHtml(value, { max = 8000 } = {}) {
  const source = String(value ?? '').slice(0, max * 4);
  if (typeof DOMParser === 'undefined') return escapeHtml(source).replace(/\n/g, '<br>');
  const doc = new DOMParser().parseFromString(source, 'text/html');
  const allowed = new Set(['P','BR','DIV','H1','H2','H3','STRONG','B','EM','I','UL','OL','LI','BLOCKQUOTE','PRE','CODE','TABLE','THEAD','TBODY','TR','TH','TD','HR','A']);
  const visit = node => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 1) {
        if (!allowed.has(child.tagName)) {
          if (['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','SVG','MATH','FORM','INPUT','VIDEO','AUDIO'].includes(child.tagName)) {
            child.remove();
            continue;
          }
          visit(child);
          child.replaceWith(...child.childNodes);
          continue;
        }
        const rawHref = child.tagName === 'A' ? (child.getAttribute('href') || '') : '';
        for (const attr of [...child.attributes]) child.removeAttribute(attr.name);
        if (child.tagName === 'A') {
          const raw = rawHref;
          if (/^https?:\/\//i.test(raw)) {
            child.setAttribute('href', raw);
            child.setAttribute('target', '_blank');
            child.setAttribute('rel', 'noopener noreferrer');
          } else child.removeAttribute('href');
        }
        visit(child);
      } else if (child.nodeType !== 3) child.remove();
    }
  };
  visit(doc.body);
  return doc.body.innerHTML.slice(0, max);
}

const LECTURE_HTML_TAGS = new Set([
  'P', 'BR', 'DIV', 'SPAN', 'H1', 'H2', 'H3', 'H4',
  'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL', 'MARK', 'SUB', 'SUP',
  'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE',
  'TABLE', 'COLGROUP', 'COL', 'THEAD', 'TBODY', 'TR', 'TH', 'TD',
  'HR', 'A', 'IMG', 'FIGURE', 'FIGCAPTION'
]);

const MATHML_TAGS = new Set([
  'MATH', 'SEMANTICS', 'MROW', 'MI', 'MN', 'MO',
  'MSUP', 'MSUB', 'MSUBSUP', 'MFRAC', 'MSQRT', 'MROOT',
  'MOVER', 'MUNDER', 'MUNDEROVER', 'MTABLE', 'MTR', 'MTD',
  'MTEXT', 'MSPACE', 'MPADDED'
]);

const DROP_SUBTREE_TAGS = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG',
  'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'VIDEO', 'AUDIO', 'ANNOTATION', 'ANNOTATION-XML'
]);

const SAFE_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0|1|0?\.\d+)\s*\))$/;
const SAFE_ALIGN_RE = /^(left|center|right|justify|start|end)$/;
const SAFE_SIZE_RE = /^(?:\d{1,2}(?:\.\d+)?(?:pt|px)|(?:0\.\d+|1(?:\.\d+)?|2(?:\.\d+)?)rem)$/;
const SAFE_LINE_HEIGHT_RE = /^(?:1(?:\.\d+)?|2(?:\.\d+)?|normal)$/;
const SAFE_SPACE_RE = /^\d{1,3}(?:\.\d+)?(?:px|pt|em|rem)$/;
const SAFE_WIDTH_RE = /^(?:\d{1,3}(?:\.\d+)?%|\d{1,4}(?:\.\d+)?px)$/;
const SAFE_FONT_RE = /^[A-Za-z0-9\s,'"-]{1,80}$/;

function sanitizeStyleAttr(rawStyle) {
  if (!rawStyle || typeof rawStyle !== 'string') return '';
  const kept = [];
  for (const decl of rawStyle.split(';')) {
    const colon = decl.indexOf(':');
    if (colon <= 0) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const val = decl.slice(colon + 1).trim();
    if (!val || /url\s*\(|expression\s*\(|javascript:|import/i.test(val)) continue;
    if ((prop === 'color' || prop === 'background-color') && SAFE_COLOR_RE.test(val)) kept.push(`${prop}: ${val}`);
    else if (prop === 'text-align' && SAFE_ALIGN_RE.test(val)) kept.push(`${prop}: ${val}`);
    else if (prop === 'font-size' && SAFE_SIZE_RE.test(val)) kept.push(`${prop}: ${val}`);
    else if (prop === 'line-height' && SAFE_LINE_HEIGHT_RE.test(val)) kept.push(`${prop}: ${val}`);
    else if ((prop === 'margin-bottom' || prop === 'margin-top' || prop === 'padding-left' || prop === 'margin-left') && SAFE_SPACE_RE.test(val)) kept.push(`${prop}: ${val}`);
    else if ((prop === 'width' || prop === 'max-width') && SAFE_WIDTH_RE.test(val)) kept.push(`${prop}: ${val}`);
    else if (prop === 'font-family' && SAFE_FONT_RE.test(val)) kept.push(`${prop}: ${val}`);
  }
  return kept.join('; ');
}

export function isSafeLectureImageSrc(src) {
  const raw = String(src ?? '').trim();
  if (!raw || raw.length > 280000) return false;
  if (/^https?:\/\//i.test(raw)) return true;
  if (raw.startsWith('./assets/') || raw.startsWith('assets/')) return !raw.includes('..');
  return /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(raw);
}

/** Rich HTML sanitizer for structured Lecture Sheets (formatting, tables, safe
 * raster images, page breaks, and MathML equations — never scripts or active embeds). */
export function sanitizeLectureHtml(value, { max = 350000 } = {}) {
  const source = String(value ?? '').slice(0, max * 2);
  if (typeof DOMParser === 'undefined') return escapeHtml(source).replace(/\n/g, '<br>');
  const doc = new DOMParser().parseFromString(source, 'text/html');

  const visit = node => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) continue;
      if (child.nodeType !== 1) {
        child.remove();
        continue;
      }
      const tag = child.tagName.toUpperCase();
      if (DROP_SUBTREE_TAGS.has(tag)) {
        child.remove();
        continue;
      }
      const isMath = MATHML_TAGS.has(tag);
      const isHtml = LECTURE_HTML_TAGS.has(tag);
      if (!isHtml && !isMath) {
        visit(child);
        child.replaceWith(...child.childNodes);
        continue;
      }

      if (tag === 'IMG') {
        const src = child.getAttribute('src') || '';
        if (!isSafeLectureImageSrc(src)) {
          child.remove();
          continue;
        }
        const alt = (child.getAttribute('alt') || '').slice(0, 200);
        const align = child.getAttribute('data-align') || '';
        const widthPct = child.getAttribute('data-width-pct') || '';
        const style = sanitizeStyleAttr(child.getAttribute('style') || '');
        for (const attr of [...child.attributes]) child.removeAttribute(attr.name);
        child.setAttribute('src', src.trim());
        child.setAttribute('alt', alt);
        child.setAttribute('loading', 'lazy');
        if (/^(left|center|right)$/.test(align)) child.setAttribute('data-align', align);
        if (/^(25|50|75|100)$/.test(widthPct)) child.setAttribute('data-width-pct', widthPct);
        if (style) child.setAttribute('style', style);
        continue;
      }

      const rawHref = tag === 'A' ? (child.getAttribute('href') || '') : '';
      const rawStyle = isHtml ? sanitizeStyleAttr(child.getAttribute('style') || '') : '';
      const rawClass = child.getAttribute('class') || '';
      const pageBreak = child.hasAttribute('data-page-break');
      const dataLatex = child.getAttribute('data-latex');
      const dataDisplay = child.getAttribute('data-display');
      const colspan = (tag === 'TD' || tag === 'TH') ? child.getAttribute('colspan') : null;
      const rowspan = (tag === 'TD' || tag === 'TH') ? child.getAttribute('rowspan') : null;
      const mathDisplay = tag === 'MATH' ? child.getAttribute('display') : null;
      const mathVariant = isMath ? child.getAttribute('mathvariant') : null;

      for (const attr of [...child.attributes]) child.removeAttribute(attr.name);

      if (tag === 'A' && /^https?:\/\//i.test(rawHref)) {
        child.setAttribute('href', rawHref);
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer');
      }
      if (rawStyle) child.setAttribute('style', rawStyle);
      if (pageBreak) child.setAttribute('data-page-break', 'true');
      if (dataLatex !== null) child.setAttribute('data-latex', String(dataLatex).slice(0, 1200));
      if (dataDisplay === 'true' || dataDisplay === 'false') child.setAttribute('data-display', dataDisplay);
      if (colspan && /^\d{1,2}$/.test(colspan) && Number(colspan) >= 1 && Number(colspan) <= 20) child.setAttribute('colspan', colspan);
      if (rowspan && /^\d{1,2}$/.test(rowspan) && Number(rowspan) >= 1 && Number(rowspan) <= 50) child.setAttribute('rowspan', rowspan);
      if (tag === 'MATH') {
        child.setAttribute('xmlns', 'http://www.w3.org/1998/Math/MathML');
        if (mathDisplay === 'block' || mathDisplay === 'inline') child.setAttribute('display', mathDisplay);
      }
      if (isMath && mathVariant && /^[a-z-]{1,24}$/i.test(mathVariant)) {
        child.setAttribute('mathvariant', mathVariant);
      }
      if (rawClass) {
        const safeClasses = rawClass.split(/\s+/).filter(cls => /^(?:ls-|katex)[a-zA-Z0-9_-]{0,40}$/.test(cls));
        if (safeClasses.length) child.setAttribute('class', safeClasses.join(' '));
      }
      visit(child);
    }
  };

  visit(doc.body);
  return doc.body.innerHTML.slice(0, max);
}
