/* Active Plus Coaching — Full-Screen Word-Style Lecture Sheet Editor & PDF Studio.
 *
 * Lazy-loads `vendor/lecture-studio/sdk.js` (Tiptap + ProseMirror + KaTeX) only
 * when a Teacher, Manager, or Admin opens the Full-Screen Studio.
 */

import { toBanglaNumber as bn } from './ui.js';
import { escapeHtml } from './sanitize.js';
import { iconMarkup } from './icons.js';
import { BRAND_NAME, BRAND_TAGLINE } from './brand.js';
import { classById, subjectsForClass } from './academics.js';
import { DEFAULT_LECTURE_PAGE_SETTINGS, normalizeLecturePageSettings, contentById } from './course-content.js';
import { isSafeLectureImageSrc } from './rich-sanitize.js';
import {
  resolveLectureScope,
  listLectureSheets,
  saveLectureSheet,
  duplicateLectureSheet,
  setLectureSheetLifecycle,
  restoreLectureSheetVersion,
  defaultStarterDocJson,
  docJsonToHtml,
  docJsonToPlainText,
  saveLectureRecovery,
  loadLectureRecovery,
  clearLectureRecovery
} from './lecture-sheet-store.js';
import {
  A4_DIMENSIONS,
  MARGIN_PRESETS,
  paginateLectureDocument,
  renderLecturePreviewPagesHtml,
  downloadLectureSheetPDF,
  printLectureSheet
} from './lecture-sheet-pdf.js';

let studioSdkPromise = null;
export function loadStudioSdk() {
  if (!studioSdkPromise) {
    studioSdkPromise = import('../vendor/lecture-studio/sdk.js').catch(err => {
      studioSdkPromise = null;
      throw err;
    });
  }
  return studioSdkPromise;
}

const text = value => (typeof value === 'string' ? value.trim() : '');

const EQUATION_PRESETS = Object.freeze([
  { label: 'দ্বিঘাত সূত্র', latex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}' },
  { label: 'পিথাগোরাস', latex: 'a^2 + b^2 = c^2' },
  { label: 'মহাকর্ষ সূত্র', latex: 'F = G\\frac{m_1 m_2}{r^2}' },
  { label: 'গতিশক্তি', latex: 'E_k = \\frac{1}{2}mv^2' },
  { label: 'সমষ্টি (Σ)', latex: '\\sum_{i=1}^{n} x_i = x_1 + x_2 + \\dots + x_n' },
  { label: 'যোগজীকরণ (∫)', latex: '\\int_{a}^{b} f(x)\\,dx = F(b) - F(a)' },
  { label: 'রসায়ন বিক্রিয়া', latex: 'H_2SO_4 + 2NaOH \\rightarrow Na_2SO_4 + 2H_2O' },
  { label: 'ত্রিকোণমিতি', latex: '\\sin^2\\theta + \\cos^2\\theta = 1' }
]);

/* ---- Client-Side Image Compression (No Paid Cloud Storage Needed) ----------- */

export async function compressLectureImageFile(file, { maxWidth = 1080, quality = 0.78 } = {}) {
  if (!file) throw new Error('ছবির ফাইল নির্বাচন করুন।');
  if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(file.type || '')) {
    throw new Error('শুধু PNG, JPG, WebP বা GIF ছবি যুক্ত করা যাবে।');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('ছবির আকার সর্বোচ্চ ১০ MB হতে পারবে।');
  }

  const readAsDataUrl = blob => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('ছবি পড়া যায়নি।'));
    reader.readAsDataURL(blob);
  });

  const rawDataUrl = await readAsDataUrl(file);
  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    return rawDataUrl;
  }

  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = rawDataUrl;
    });
    const natW = img.naturalWidth || 640;
    const natH = img.naturalHeight || 480;
    const scale = natW > maxWidth ? maxWidth / natW : 1;
    const w = Math.max(1, Math.round(natW * scale));
    const h = Math.max(1, Math.round(natH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return rawDataUrl;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    let out = canvas.toDataURL('image/webp', quality);
    if (!out.startsWith('data:image/webp')) {
      out = canvas.toDataURL('image/jpeg', quality);
    }
    if (out.length > 260000) {
      out = canvas.toDataURL('image/jpeg', 0.58);
    }
    return out;
  } catch {
    return rawDataUrl;
  }
}

/* ---- Custom Tiptap Extensions (Font, Spacing, Indent, Math, PageBreak, A4) -- */

function createCustomStudioExtensions(sdk, { getPageConfig, onPageCountChange }) {
  const { Extension, Node, mergeAttributes, Plugin, PluginKey, Decoration, DecorationSet, Image, renderLatexMathML } = sdk;

  const FontTypography = Extension.create({
    name: 'lectureFontTypography',
    addGlobalAttributes() {
      return [
        {
          types: ['textStyle'],
          attributes: {
            fontSize: {
              default: null,
              parseHTML: el => el.style.fontSize || null,
              renderHTML: attrs => (attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {})
            },
            fontFamily: {
              default: null,
              parseHTML: el => el.style.fontFamily?.replace(/['"]/g, '') || null,
              renderHTML: attrs => (attrs.fontFamily ? { style: `font-family: ${attrs.fontFamily}` } : {})
            }
          }
        },
        {
          types: ['paragraph', 'heading'],
          attributes: {
            lineHeight: {
              default: null,
              parseHTML: el => el.style.lineHeight || null,
              renderHTML: attrs => (attrs.lineHeight ? { style: `line-height: ${attrs.lineHeight}` } : {})
            },
            spaceAfter: {
              default: null,
              parseHTML: el => (el.style.marginBottom ? parseInt(el.style.marginBottom, 10) || null : null),
              renderHTML: attrs => (attrs.spaceAfter !== null && attrs.spaceAfter !== undefined
                ? { style: `margin-bottom: ${Number(attrs.spaceAfter)}px` }
                : {})
            },
            indent: {
              default: 0,
              parseHTML: el => {
                const pad = parseInt(el.style.paddingLeft || '0', 10);
                return pad > 0 ? Math.min(6, Math.round(pad / 24)) : 0;
              },
              renderHTML: attrs => (Number(attrs.indent) > 0
                ? { style: `padding-left: ${Math.min(6, Number(attrs.indent)) * 24}px` }
                : {})
            }
          }
        }
      ];
    },
    addCommands() {
      return {
        setFontSize: fontSize => ({ chain }) => chain().setMark('textStyle', { fontSize }).run(),
        unsetFontSize: () => ({ chain }) => chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
        setFontFamily: fontFamily => ({ chain }) => chain().setMark('textStyle', { fontFamily }).run(),
        setLineHeight: lineHeight => ({ commands }) =>
          ['paragraph', 'heading'].every(t => commands.updateAttributes(t, { lineHeight })),
        setSpaceAfter: spaceAfter => ({ commands }) =>
          ['paragraph', 'heading'].every(t => commands.updateAttributes(t, { spaceAfter })),
        indentBlock: delta => ({ tr, state, dispatch }) => {
          const { from, to } = state.selection;
          let changed = false;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (node.type.name === 'paragraph' || node.type.name === 'heading') {
              const cur = Number(node.attrs.indent) || 0;
              const next = Math.min(6, Math.max(0, cur + delta));
              if (next !== cur) {
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
                changed = true;
              }
            }
          });
          if (changed && dispatch) dispatch(tr);
          return changed;
        }
      };
    }
  });

  const LectureImage = Image.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        widthPct: {
          default: 75,
          parseHTML: el => Number(el.getAttribute('data-width-pct')) || 75,
          renderHTML: attrs => ({
            'data-width-pct': String(attrs.widthPct || 75),
            style: `width: ${attrs.widthPct || 75}%; max-width: 100%; display: block; margin-left: ${
              attrs.align === 'center' ? 'auto' : (attrs.align === 'right' ? 'auto' : '0')
            }; margin-right: ${
              attrs.align === 'center' ? 'auto' : (attrs.align === 'left' ? 'auto' : '0')
            }`
          })
        },
        align: {
          default: 'center',
          parseHTML: el => el.getAttribute('data-align') || 'center',
          renderHTML: attrs => ({ 'data-align': attrs.align || 'center' })
        },
        caption: {
          default: '',
          parseHTML: el => el.getAttribute('data-caption') || '',
          renderHTML: attrs => (attrs.caption ? { 'data-caption': attrs.caption } : {})
        }
      };
    }
  });

  const MathEquation = Node.create({
    name: 'mathEquation',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() {
      return {
        latex: {
          default: 'x^2 + y^2 = r^2',
          parseHTML: el => el.getAttribute('data-latex') || el.textContent || ''
        },
        display: {
          default: true,
          parseHTML: el => el.getAttribute('data-display') !== 'false'
        }
      };
    },
    parseHTML() {
      return [{ tag: '[data-latex]' }];
    },
    renderHTML({ node, HTMLAttributes }) {
      return [
        'div',
        mergeAttributes(HTMLAttributes, {
          class: 'ls-math-node',
          'data-latex': node.attrs.latex,
          'data-display': node.attrs.display ? 'true' : 'false'
        }),
        node.attrs.latex
      ];
    },
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement('div');
        dom.className = 'ls-math-node-view';
        dom.contentEditable = 'false';
        const paint = currentNode => {
          dom.dataset.latex = currentNode.attrs.latex || '';
          dom.dataset.display = currentNode.attrs.display ? 'true' : 'false';
          try {
            dom.innerHTML = `<div class="ls-math-rendered">${renderLatexMathML(currentNode.attrs.latex || '', Boolean(currentNode.attrs.display))}</div><small class="ls-math-hint">সমীকরণ সম্পাদনা করতে ডাবল-ক্লিক করুন</small>`;
          } catch {
            dom.textContent = currentNode.attrs.latex || '';
          }
        };
        paint(node);
        return {
          dom,
          update(updatedNode) {
            if (updatedNode.type.name !== 'mathEquation') return false;
            paint(updatedNode);
            return true;
          }
        };
      };
    },
    addCommands() {
      return {
        insertMathEquation: ({ latex, display = true }) => ({ state, dispatch, commands }) => {
          const { $from } = state.selection;
          if ($from.depth > 1) {
            const insertPos = $from.after(1);
            const eqNode = state.schema.nodes.mathEquation?.create({ latex, display });
            const pNode = state.schema.nodes.paragraph?.create();
            if (eqNode && pNode) {
              if (dispatch) {
                const tr = state.tr.insert(insertPos, [eqNode, pNode]);
                dispatch(tr.scrollIntoView());
              }
              commands.setTextSelection(insertPos + eqNode.nodeSize + 1);
              return true;
            }
          }
          return commands.insertContent([
            { type: 'mathEquation', attrs: { latex, display } },
            { type: 'paragraph' }
          ]);
        }
      };
    }
  });

  const PageBreak = Node.create({
    name: 'pageBreak',
    group: 'block',
    atom: true,
    selectable: true,
    parseHTML() {
      return [{ tag: 'div[data-page-break]' }];
    },
    renderHTML({ HTMLAttributes }) {
      return [
        'div',
        mergeAttributes(HTMLAttributes, {
          class: 'ls-page-break-node',
          'data-page-break': 'true',
          contenteditable: 'false'
        }),
        '── পৃষ্ঠা বিরতি (Page Break) ──'
      ];
    },
    addCommands() {
      return {
        insertPageBreak: () => ({ state, dispatch, commands }) => {
          const { $from } = state.selection;
          if ($from.depth > 1) {
            const insertPos = $from.after(1);
            const pbNode = state.schema.nodes.pageBreak?.create();
            const pNode = state.schema.nodes.paragraph?.create();
            if (pbNode && pNode) {
              if (dispatch) {
                const tr = state.tr.insert(insertPos, [pbNode, pNode]);
                dispatch(tr.scrollIntoView());
              }
              commands.setTextSelection(insertPos + pbNode.nodeSize + 1);
              return true;
            }
          }
          return commands.insertContent([{ type: 'pageBreak' }, { type: 'paragraph' }]);
        }
      };
    }
  });

  // Live ProseMirror A4 Page-Break Decoration Plugin for Writing Mode
  const paginationKey = new PluginKey('apcA4LivePagination');
  const A4LivePagination = Extension.create({
    name: 'apcA4LivePagination',
    addProseMirrorPlugins() {
      let measureTimer = null;
      return [
        new Plugin({
          key: paginationKey,
          state: {
            init: () => DecorationSet.empty,
            apply(tr, prev) {
              const next = tr.getMeta(paginationKey);
              if (next) return next;
              return tr.docChanged ? prev.map(tr.mapping, tr.doc) : prev;
            }
          },
          props: {
            decorations(state) {
              return this.getState(state);
            }
          },
          view(editorView) {
            const scheduleMeasure = () => {
              if (measureTimer) clearTimeout(measureTimer);
              measureTimer = setTimeout(() => {
                if (!editorView || editorView.isDestroyed) return;
                const cfg = getPageConfig();
                const dim = A4_DIMENSIONS[cfg.orientation] || A4_DIMENSIONS.portrait;
                const margin = MARGIN_PRESETS[cfg.margins] || MARGIN_PRESETS.normal;
                const page1Usable = dim.height - margin * 2 - (cfg.showHeader ? 124 : 32) - ((cfg.showFooter || cfg.showPageNumbers) ? 38 : 0);
                const nextPageUsable = dim.height - margin * 2 - (cfg.showHeader ? 42 : 0) - ((cfg.showFooter || cfg.showPageNumbers) ? 38 : 0);

                const breakPositions = [];
                let accH = 0;
                let pageNum = 1;

                editorView.state.doc.forEach((child, offset) => {
                  const limit = pageNum === 1 ? page1Usable : nextPageUsable;
                  if (child.type.name === 'pageBreak') {
                    pageNum += 1;
                    accH = 0;
                    breakPositions.push({ pos: offset + child.nodeSize, pageFinished: pageNum - 1, explicit: true });
                    return;
                  }
                  let domH = 28;
                  try {
                    const domNode = editorView.nodeDOM(offset);
                    if (domNode && domNode.getBoundingClientRect) {
                      const rect = domNode.getBoundingClientRect();
                      const scale = cfg.zoomScale || 1;
                      if (rect.height > 0) domH = rect.height / Math.max(0.35, scale);
                    }
                  } catch { domH = 28; }

                  if (accH > 0 && accH + domH > limit) {
                    breakPositions.push({ pos: offset, pageFinished: pageNum, explicit: false });
                    pageNum += 1;
                    accH = domH;
                  } else {
                    accH += domH;
                  }
                });

                const totalPages = pageNum;
                onPageCountChange(totalPages);

                const decos = breakPositions.map(bp =>
                  Decoration.widget(bp.pos, () => {
                    const sep = document.createElement('div');
                    sep.className = 'ls-live-page-gap';
                    sep.contentEditable = 'false';
                    sep.setAttribute('aria-hidden', 'true');
                    sep.innerHTML = `
                      <div class="ls-live-page-footer">
                        <span>${escapeHtml(cfg.footerLabel || BRAND_NAME)}</span>
                        <span>পৃষ্ঠা ${bn(bp.pageFinished)} / ${bn(totalPages)}</span>
                      </div>
                      <div class="ls-live-gap-strip"><span>পৃষ্ঠা ${bn(bp.pageFinished + 1)} শুরু</span></div>
                      <div class="ls-live-page-header">
                        <span>${escapeHtml(cfg.headerLabel || BRAND_NAME)}</span>
                        <span>${escapeHtml(cfg.subjectLabel || '')}</span>
                      </div>`;
                    return sep;
                  }, { side: -1 })
                );

                const set = DecorationSet.create(editorView.state.doc, decos);
                editorView.dispatch(editorView.state.tr.setMeta(paginationKey, set));
              }, 90);
            };

            scheduleMeasure();
            return {
              update(view, prevState) {
                if (!prevState.doc.eq(view.state.doc)) scheduleMeasure();
              },
              destroy() {
                if (measureTimer) clearTimeout(measureTimer);
              }
            };
          }
        })
      ];
    }
  });

  return { FontTypography, LectureImage, MathEquation, PageBreak, A4LivePagination };
}

/* ---- Full-Screen Studio Modal Controller ------------------------------------ */

export async function openLectureSheetStudio({
  id = '',
  initialMeta = {},
  role = 'admin',
  toast = () => {},
  onClosed = () => {}
} = {}) {
  const [sdk, scope] = await Promise.all([
    loadStudioSdk(),
    resolveLectureScope(role)
  ]);

  if (!scope.classes.length) {
    toast('আপনার জন্য এখনো কোনো শ্রেণি বা বিষয় বরাদ্দ হয়নি।', true);
    return null;
  }

  const existing = id ? contentById(id) : null;
  if (id && !existing) {
    toast('লেকচার শিটটি পাওয়া যায়নি।', true);
    return null;
  }

  // Pick initial metadata
  const initClassId = existing?.classId
    || initialMeta.classId
    || scope.classes[0]?.id
    || '';
  const availSubjects = scope.subjectsByClass[initClassId] || [];
  const initSubjectId = existing?.subjectId
    || initialMeta.subjectId
    || availSubjects[0]?.id
    || '';

  const chapInfo = scope.chaptersByClassSubject[`${initClassId}::${initSubjectId}`] || { contentChapters: [], academicChapters: [] };
  const existingChapRec = existing?.chapterId ? contentById(existing.chapterId) : null;

  const state = {
    id: existing?.id || '',
    baseVersion: existing ? Math.max(1, Number(existing.docVersion) || 1) : null,
    status: existing ? (existing.active === false ? 'archived' : (existing.published ? 'published' : 'draft')) : 'draft',
    classId: initClassId,
    subjectId: initSubjectId,
    group: existing?.group ?? initialMeta.group ?? '',
    chapterId: existing?.chapterId ?? initialMeta.chapterId ?? '',
    chapterName: existing?.chapterName || existingChapRec?.title || initialMeta.chapterName || '',
    topic: existing?.topic ?? initialMeta.topic ?? '',
    title: existing?.title || initialMeta.title || 'নতুন লেকচার শিট',
    subtitle: existing?.subtitle || initialMeta.subtitle || '',
    type: existing?.type || initialMeta.type || 'lesson',
    teacherId: existing?.teacherId || scope.staff.staffId,
    teacherName: existing?.teacherName || scope.staff.displayName,
    pageSettings: normalizeLecturePageSettings(existing?.pageSettings || DEFAULT_LECTURE_PAGE_SETTINGS),
    docJson: existing?.docJson
      || defaultStarterDocJson({
        title: existing?.title || initialMeta.title || '',
        topic: existing?.topic || initialMeta.topic || ''
      }),
    mode: 'write', // 'write' | 'preview'
    zoom: typeof window !== 'undefined' && window.innerWidth < 860 ? 'fit' : 100,
    mobileComfortReflow: typeof window !== 'undefined' && window.innerWidth < 640,
    totalPages: 1,
    currentPreviewPage: 1,
    saveState: existing ? 'saved' : 'unsaved', // 'saved' | 'saving' | 'unsaved' | 'offline' | 'conflict' | 'error'
    saveMessage: existing ? `সংরক্ষিত (v${Math.max(1, Number(existing.docVersion) || 1)})` : 'খসড়া এখনো সংরক্ষিত হয়নি',
    conflictRecord: null,
    dirty: !existing,
    recoveredBanner: null
  };

  // Check if local crash/offline recovery has a newer unsaved draft
  const recovery = loadLectureRecovery(scope.staff, state.id || 'new');
  if (recovery && recovery.draft) {
    const existingStamp = existing ? Date.parse(existing.updatedAt || existing.createdAt || '') || 0 : 0;
    if (!existing || recovery.savedAt > existingStamp + 1500) {
      state.recoveredBanner = recovery;
    }
  }

  // Remove any previous studio overlay
  document.getElementById('apcLectureStudioOverlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'apcLectureStudioOverlay';
  overlay.className = 'ls-studio-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'লেকচার শিট এডিটর ও PDF স্টুডিও');

  const computeEffectiveZoom = () => {
    const dim = A4_DIMENSIONS[state.pageSettings.orientation] || A4_DIMENSIONS.portrait;
    if (state.zoom === 'fit') {
      const vw = Math.max(320, (window.innerWidth || 390) - 24);
      return Math.min(1, Math.max(0.38, vw / dim.width));
    }
    return Math.min(1.6, Math.max(0.4, (Number(state.zoom) || 100) / 100));
  };

  const currentClassObj = () => classById(state.classId) || scope.classes[0];
  const currentSubjectObj = () => {
    const cls = currentClassObj();
    return cls ? subjectsForClass(cls.name).find(s => s.id === state.subjectId) : null;
  };

  overlay.innerHTML = `
    <div class="ls-studio-shell">
      <!-- Top Document Bar -->
      <header class="ls-topbar">
        <div class="ls-topbar-start">
          <button type="button" class="ls-btn ls-exit-btn" data-ls-action="exit" aria-label="এডিটর থেকে বের হন">
            ← প্রস্থান
          </button>
          <div class="ls-title-wrap">
            <input type="text" class="ls-doc-title-input" data-ls-title-input maxlength="160"
              value="${escapeHtml(state.title)}" placeholder="লেকচার শিটের শিরোনাম লিখুন…" aria-label="লেকচার শিটের শিরোনাম">
            <div class="ls-doc-submeta">
              <button type="button" class="ls-meta-pill-btn" data-ls-action="open-meta" title="ক্লাস, বিষয়, অধ্যায় ও পৃষ্ঠা সেটিংস পরিবর্তন করুন">
                <span data-ls-meta-summary></span> ⚙
              </button>
              <span class="ls-save-badge" data-ls-save-badge data-state="${state.saveState}" role="status" aria-live="polite">
                ${escapeHtml(state.saveMessage)}
              </span>
              <button type="button" class="ls-retry-save-btn" data-ls-action="save-draft" hidden>আবার চেষ্টা করুন</button>
            </div>
          </div>
        </div>

        <div class="ls-topbar-actions">
          <div class="ls-mode-switch" role="tablist" aria-label="এডিটর মোড">
            <button type="button" role="tab" class="ls-mode-btn is-active" data-ls-mode="write" aria-selected="true">✍️ লেখা</button>
            <button type="button" role="tab" class="ls-mode-btn" data-ls-mode="preview" aria-selected="false">📄 PDF প্রিভিউ</button>
          </div>
          <button type="button" class="ls-btn" data-ls-action="save-draft" title="খসড়া সংরক্ষণ (Ctrl+S)">সেভ</button>
          <button type="button" class="ls-btn" data-ls-action="download-pdf" title="A4 PDF ডাউনলোড করুন">⬇ PDF</button>
          <button type="button" class="ls-btn ls-hide-xs" data-ls-action="print" title="প্রিন্ট করুন">🖨 প্রিন্ট</button>
          <button type="button" class="ls-btn ls-publish-btn" data-ls-action="toggle-publish">
            ${state.status === 'published' ? 'প্রকাশিত ✓' : 'পাবলিশ'}
          </button>
          <button type="button" class="ls-btn ls-hide-xs" data-ls-action="native-fullscreen" title="ফুলস্ক্রিন টগল" aria-label="ব্রাউজার ফুলস্ক্রিন">⛶</button>
        </div>
      </header>

      <!-- Recovery / Conflict Alert Banner -->
      <div class="ls-alert-bar" data-ls-alert-bar hidden></div>

      <!-- Microsoft Word-Style Formatting Ribbon -->
      <div class="ls-ribbon" data-ls-ribbon role="toolbar" aria-label="ফরম্যাটিং রিবন">
        <div class="ls-ribbon-group">
          <button type="button" class="ls-tool-btn" data-ls-cmd="undo" title="পূর্বাবস্থা (Ctrl+Z)" aria-label="Undo">↶</button>
          <button type="button" class="ls-tool-btn" data-ls-cmd="redo" title="পুনরায় (Ctrl+Y)" aria-label="Redo">↷</button>
        </div>

        <div class="ls-ribbon-group">
          <select class="ls-tool-select" data-ls-block-style aria-label="অনুচ্ছেদ স্টাইল">
            <option value="p">সাধারণ লেখা</option>
            <option value="h1">শিরোনাম ১ (H1)</option>
            <option value="h2">শিরোনাম ২ (H2)</option>
            <option value="h3">শিরোনাম ৩ (H3)</option>
            <option value="h4">উপ-শিরোনাম (H4)</option>
            <option value="blockquote">উদ্ধৃতি বক্স</option>
          </select>
          <select class="ls-tool-select" data-ls-font-family aria-label="ফন্ট নির্বাচন">
            <option value="Noto Sans Bengali">Noto Sans Bengali</option>
            <option value="SolaimanLipi, Noto Sans Bengali">SolaimanLipi</option>
            <option value="Kalpurush, Noto Sans Bengali">Kalpurush</option>
            <option value="Georgia, serif">Georgia Serif</option>
            <option value="Inter, sans-serif">Inter Sans</option>
          </select>
          <select class="ls-tool-select ls-tool-select-sm" data-ls-font-size aria-label="ফন্ট আকার">
            <option value="10pt">১০ pt</option>
            <option value="11pt">১১ pt</option>
            <option value="12pt" selected>১২ pt</option>
            <option value="14pt">১৪ pt</option>
            <option value="16pt">১৬ pt</option>
            <option value="18pt">১৮ pt</option>
            <option value="20pt">২০ pt</option>
            <option value="24pt">২৪ pt</option>
            <option value="28pt">২৮ pt</option>
          </select>
        </div>

        <div class="ls-ribbon-group">
          <button type="button" class="ls-tool-btn" data-ls-cmd="bold" title="মোটা (Ctrl+B)" aria-label="Bold"><strong>B</strong></button>
          <button type="button" class="ls-tool-btn" data-ls-cmd="italic" title="তির্যক (Ctrl+I)" aria-label="Italic"><em>I</em></button>
          <button type="button" class="ls-tool-btn" data-ls-cmd="underline" title="নিচে দাগ (Ctrl+U)" aria-label="Underline"><u>U</u></button>
          <button type="button" class="ls-tool-btn" data-ls-cmd="strike" title="মাঝে কাটা" aria-label="Strikethrough"><s>S</s></button>
          <button type="button" class="ls-tool-btn" data-ls-cmd="superscript" title="ঘাত / Superscript (x²)" aria-label="Superscript">x²</button>
          <button type="button" class="ls-tool-btn" data-ls-cmd="subscript" title="সহগ / Subscript (H₂O)" aria-label="Subscript">x₂</button>
          <label class="ls-color-picker-btn" title="লেখার রং">
            <span>A</span>
            <input type="color" data-ls-text-color value="#111827" aria-label="লেখার রং">
          </label>
          <select class="ls-tool-select ls-tool-select-sm" data-ls-highlight aria-label="হাইলাইট রং">
            <option value="">হাইলাইট</option>
            <option value="#fef08a">হলুদ</option>
            <option value="#bbf7d0">সবুজ</option>
            <option value="#bae6fd">আকাশি</option>
            <option value="#fbcfe8">গোলাপি</option>
            <option value="none">হাইলাইট মুছুন</option>
          </select>
        </div>

        <div class="ls-ribbon-group">
          <button type="button" class="ls-tool-btn" data-ls-align="left" title="বাম অ্যালাইন" aria-label="Align Left">≣←</button>
          <button type="button" class="ls-tool-btn" data-ls-align="center" title="মাঝখানে অ্যালাইন" aria-label="Align Center">≣↔</button>
          <button type="button" class="ls-tool-btn" data-ls-align="right" title="ডান অ্যালাইন" aria-label="Align Right">≣→</button>
          <button type="button" class="ls-tool-btn" data-ls-align="justify" title="জাস্টিফাই" aria-label="Justify">≣</button>
          <button type="button" class="ls-tool-btn" data-ls-cmd="bulletList" title="বুলেট তালিকা" aria-label="Bullet List">• তালিকা</button>
          <button type="button" class="ls-tool-btn" data-ls-cmd="orderedList" title="ক্রমিক তালিকা" aria-label="Numbered List">১. তালিকা</button>
          <button type="button" class="ls-tool-btn" data-ls-cmd="outdent" title="ইনডেন্ট কমান" aria-label="Outdent">⇤</button>
          <button type="button" class="ls-tool-btn" data-ls-cmd="indent" title="ইনডেন্ট বাড়ান" aria-label="Indent">⇥</button>
          <select class="ls-tool-select ls-tool-select-sm" data-ls-line-height aria-label="লাইন স্পেসিং" title="লাইন স্পেসিং">
            <option value="1.2">লাইন ১.২</option>
            <option value="1.4">লাইন ১.৪</option>
            <option value="1.6" selected>লাইন ১.৬</option>
            <option value="1.8">লাইন ১.৮</option>
            <option value="2.0">লাইন ২.০</option>
          </select>
        </div>

        <div class="ls-ribbon-group">
          <button type="button" class="ls-tool-btn" data-ls-action="insert-table" title="টেবিল যুক্ত করুন">⊞ টেবিল</button>
          <button type="button" class="ls-tool-btn" data-ls-action="insert-image" title="ছবি যুক্ত করুন">🖼 ছবি</button>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-ls-image-file hidden>
          <button type="button" class="ls-tool-btn" data-ls-action="insert-equation" title="গণিত সমীকরণ ও বৈজ্ঞানিক সংকেত">∑ সমীকরণ</button>
          <button type="button" class="ls-tool-btn" data-ls-cmd="hr" title="অনুভূমিক রেখা">─ রেখা</button>
          <button type="button" class="ls-tool-btn" data-ls-cmd="pageBreak" title="নতুন পৃষ্ঠা বিরতি (Page Break)">✂ পৃষ্ঠা বিরতি</button>
          <button type="button" class="ls-tool-btn" data-ls-cmd="clearFormat" title="ফরম্যাট পরিষ্কার করুন">Tx</button>
        </div>
      </div>

      <!-- Contextual Table / Image Sub-Toolbar -->
      <div class="ls-context-bar" data-ls-table-bar hidden>
        <span>টেবিল টুলস:</span>
        <button type="button" class="ls-ctx-btn" data-ls-table-cmd="addRowBefore">+ সারি উপরে</button>
        <button type="button" class="ls-ctx-btn" data-ls-table-cmd="addRowAfter">+ সারি নিচে</button>
        <button type="button" class="ls-ctx-btn" data-ls-table-cmd="deleteRow">- সারি মুছুন</button>
        <button type="button" class="ls-ctx-btn" data-ls-table-cmd="addColumnBefore">+ কলাম বামে</button>
        <button type="button" class="ls-ctx-btn" data-ls-table-cmd="addColumnAfter">+ কলাম ডানে</button>
        <button type="button" class="ls-ctx-btn" data-ls-table-cmd="deleteColumn">- কলাম মুছুন</button>
        <button type="button" class="ls-ctx-btn ls-ctx-danger" data-ls-table-cmd="deleteTable">টেবিল মুছুন</button>
      </div>

      <div class="ls-context-bar" data-ls-image-bar hidden>
        <span>ছবির আকার ও অবস্থান:</span>
        <button type="button" class="ls-ctx-btn" data-ls-img-width="25">২৫%</button>
        <button type="button" class="ls-ctx-btn" data-ls-img-width="50">৫০%</button>
        <button type="button" class="ls-ctx-btn" data-ls-img-width="75">৭৫%</button>
        <button type="button" class="ls-ctx-btn" data-ls-img-width="100">১০০%</button>
        <button type="button" class="ls-ctx-btn" data-ls-img-align="left">বামে</button>
        <button type="button" class="ls-ctx-btn" data-ls-img-align="center">মাঝে</button>
        <button type="button" class="ls-ctx-btn" data-ls-img-align="right">ডানে</button>
      </div>

      <!-- Page Controls Strip (Orientation, Margins, Zoom, Page Counter) -->
      <div class="ls-pagebar">
        <div class="ls-pagebar-left">
          <select class="ls-mini-select" data-ls-orientation aria-label="পৃষ্ঠার দিক (Orientation)">
            <option value="portrait"${state.pageSettings.orientation === 'portrait' ? ' selected' : ''}>A4 লম্বালম্বি (Portrait)</option>
            <option value="landscape"${state.pageSettings.orientation === 'landscape' ? ' selected' : ''}>A4 আড়াআড়ি (Landscape)</option>
          </select>
          <select class="ls-mini-select" data-ls-margins aria-label="মার্জিন">
            <option value="narrow"${state.pageSettings.margins === 'narrow' ? ' selected' : ''}>সংকীর্ণ মার্জিন</option>
            <option value="normal"${state.pageSettings.margins === 'normal' ? ' selected' : ''}>স্বাভাবিক মার্জিন</option>
            <option value="wide"${state.pageSettings.margins === 'wide' ? ' selected' : ''}>প্রশস্ত মার্জিন</option>
          </select>
          <button type="button" class="ls-mini-toggle${state.mobileComfortReflow ? ' is-active' : ''}" data-ls-action="toggle-mobile-reflow" title="মোবাইল স্ক্রিনে বড় অক্ষরে লেখার সুবিধা">
            📱 মোবাইল ভিউ
          </button>
        </div>

        <div class="ls-pagebar-right">
          <span class="ls-page-counter" data-ls-page-counter>মোট পৃষ্ঠা: ১</span>
          <div class="ls-zoom-controls">
            <button type="button" class="ls-zoom-btn" data-ls-zoom="out" aria-label="Zoom out">−</button>
            <button type="button" class="ls-zoom-btn ls-zoom-fit" data-ls-zoom="fit" data-ls-zoom-label>${state.zoom === 'fit' ? 'ফিট' : `${bn(state.zoom)}%`}</button>
            <button type="button" class="ls-zoom-btn" data-ls-zoom="in" aria-label="Zoom in">+</button>
          </div>
        </div>
      </div>

      <!-- Main Workspace: Writing Mode + Read-Only Live PDF Preview Mode -->
      <main class="ls-workspace" data-ls-workspace>
        <!-- 1. Writing Mode A4 Canvas -->
        <div class="ls-writing-stage" data-ls-writing-stage>
          <div class="ls-a4-sheet-scaler" data-ls-writing-scaler>
            <div class="ls-a4-writing-sheet" data-ls-writing-sheet>
              <img class="ls-a4-watermark" src="assets/icons/app-logo.png" alt="" aria-hidden="true" data-ls-sheet-watermark${state.pageSettings.showWatermark === false ? ' hidden' : ''}>
              <div class="ls-a4-sheet-header" data-ls-sheet-header></div>
              <div class="ls-tiptap-mount" data-ls-tiptap-mount></div>
              <div class="ls-a4-sheet-footer" data-ls-sheet-footer></div>
            </div>
          </div>
        </div>

        <!-- 2. Read-Only Live A4 PDF Preview Stage -->
        <div class="ls-preview-stage" data-ls-preview-stage hidden>
          <div class="ls-preview-toolbar">
            <div class="ls-preview-nav">
              <button type="button" class="ls-ctx-btn" data-ls-preview-nav="prev">◀ আগের পৃষ্ঠা</button>
              <span data-ls-preview-page-indicator>পৃষ্ঠা ১ / ১</span>
              <button type="button" class="ls-ctx-btn" data-ls-preview-nav="next">পরের পৃষ্ঠা ▶</button>
            </div>
            <span class="ls-preview-timing" data-ls-preview-timing></span>
            <button type="button" class="ls-ctx-btn" data-ls-action="refresh-preview">↻ রিফ্রেশ</button>
          </div>
          <div class="ls-preview-error" data-ls-preview-error hidden></div>
          <div class="ls-preview-pages-wrap" data-ls-preview-pages></div>
        </div>
      </main>

      <!-- Mobile Bottom Sticky Quick Action Bar -->
      <footer class="ls-mobile-dock">
        <button type="button" class="ls-dock-btn" data-ls-action="save-draft">💾 সেভ</button>
        <button type="button" class="ls-dock-btn" data-ls-action="switch-preview-toggle" data-ls-dock-preview>📄 প্রিভিউ</button>
        <button type="button" class="ls-dock-btn" data-ls-action="download-pdf">⬇ PDF</button>
        <button type="button" class="ls-dock-btn ls-dock-primary" data-ls-action="toggle-publish" data-ls-dock-publish>
          ${state.status === 'published' ? 'প্রকাশিত ✓' : 'পাবলিশ'}
        </button>
      </footer>

      <!-- Sub-Modal Host (Metadata & Page Settings / Equation Builder) -->
      <div class="ls-submodal-backdrop" data-ls-submodal hidden></div>
    </div>
  `;

  document.documentElement.classList.add('apc-lecture-studio-open');
  document.body.appendChild(overlay);

  const q = sel => overlay.querySelector(sel);
  const qa = sel => [...overlay.querySelectorAll(sel)];

  let autosaveTimer = null;
  let editor = null;

  /* ---- Paint Helpers -------------------------------------------------------- */

  function updateMetaSummary() {
    const cls = currentClassObj();
    const sub = currentSubjectObj();
    const parts = [
      cls?.name || 'শ্রেণি',
      sub?.name || 'বিষয়',
      state.chapterName || 'অধ্যায় ছাড়া',
      state.topic ? `টপিক: ${state.topic}` : ''
    ].filter(Boolean);
    const el = q('[data-ls-meta-summary]');
    if (el) el.textContent = parts.join(' • ');
  }

  function updateSaveBadge(nextState, msg) {
    state.saveState = nextState;
    state.saveMessage = msg;
    const badge = q('[data-ls-save-status], [data-ls-save-badge]');
    if (badge) {
      badge.dataset.state = nextState;
      badge.textContent = msg;
    }
    const retryBtn = q('.ls-retry-save-btn');
    if (retryBtn) retryBtn.hidden = !(nextState === 'error');
  }

  function updatePublishButtons() {
    const label = state.status === 'published' ? 'প্রকাশিত ✓' : 'পাবলিশ';
    qa('[data-ls-action="toggle-publish"]').forEach(btn => {
      btn.textContent = label;
      btn.classList.toggle('is-published', state.status === 'published');
    });
  }

  function paintWritingSheetChrome() {
    const sheet = q('[data-ls-writing-sheet]');
    const scaler = q('[data-ls-writing-scaler]');
    const head = q('[data-ls-sheet-header]');
    const foot = q('[data-ls-sheet-footer]');
    const wm = q('[data-ls-sheet-watermark]');
    if (!sheet || !scaler) return;
    if (wm) wm.hidden = state.pageSettings.showWatermark === false;

    const dim = A4_DIMENSIONS[state.pageSettings.orientation] || A4_DIMENSIONS.portrait;
    const margin = MARGIN_PRESETS[state.pageSettings.margins] || MARGIN_PRESETS.normal;
    const cls = currentClassObj();
    const sub = currentSubjectObj();

    if (state.mobileComfortReflow && window.innerWidth < 820) {
      sheet.classList.add('is-mobile-reflow');
      sheet.style.width = '100%';
      sheet.style.minHeight = 'calc(100dvh - 210px)';
      sheet.style.padding = '20px 16px';
      scaler.style.transform = 'none';
      scaler.style.width = '100%';
      scaler.style.minHeight = 'auto';
    } else {
      sheet.classList.remove('is-mobile-reflow');
      const scale = computeEffectiveZoom();
      sheet.style.width = `${dim.width}px`;
      sheet.style.minHeight = `${dim.height}px`;
      sheet.style.padding = `${margin}px`;
      scaler.style.width = `${Math.round(dim.width * scale)}px`;
      scaler.style.minHeight = `${Math.round(dim.height * scale)}px`;
      sheet.style.transform = `scale(${scale})`;
      sheet.style.transformOrigin = 'top left';
    }

    sheet.style.fontFamily = `${state.pageSettings.fontFamily}, "Noto Sans Bengali", sans-serif`;
    sheet.style.fontSize = `${state.pageSettings.baseFontSize}pt`;
    sheet.style.lineHeight = String(state.pageSettings.lineHeight);

    const zoomLabel = q('[data-ls-zoom-label]');
    if (zoomLabel) {
      zoomLabel.textContent = state.zoom === 'fit' ? 'ফিট' : `${bn(state.zoom)}%`;
    }

    if (head) {
      if (state.pageSettings.showHeader) {
        const pills = [
          cls?.name,
          state.group,
          sub?.name ? `বিষয়: ${sub.name}` : '',
          state.chapterName ? `অধ্যায়: ${state.chapterName}` : '',
          state.topic ? `টপিক: ${state.topic}` : '',
          state.teacherName ? `শিক্ষক: ${state.teacherName}` : ''
        ].filter(Boolean);
        head.hidden = false;
        head.innerHTML = `
          <div class="ls-sheet-brand-bar">
            ${state.pageSettings.showLogo ? '<img src="assets/icons/logo-128.png" alt="" class="ls-sheet-logo">' : ''}
            <div class="ls-sheet-brand-text">
              <strong>${escapeHtml(BRAND_NAME)}</strong>
              <span>${escapeHtml(state.pageSettings.headerText || BRAND_TAGLINE)}</span>
            </div>
            <span class="ls-sheet-chip">লেকচার শিট</span>
          </div>
          <div class="ls-sheet-title-banner">
            <h2>${escapeHtml(state.title || 'শিরোনামহীন লেকচার শিট')}</h2>
            ${state.subtitle ? `<p>${escapeHtml(state.subtitle)}</p>` : ''}
            ${pills.length ? `<div class="ls-sheet-meta-tags">${pills.map(p => `<span>${escapeHtml(p)}</span>`).join('')}</div>` : ''}
          </div>`;
      } else {
        head.hidden = true;
        head.innerHTML = '';
      }
    }

    if (foot) {
      if (state.pageSettings.showFooter || state.pageSettings.showPageNumbers) {
        foot.hidden = false;
        const leftText = state.pageSettings.showFooter
          ? (state.pageSettings.footerText || [state.teacherName ? `শিক্ষক: ${state.teacherName}` : '', BRAND_NAME].filter(Boolean).join(' • '))
          : '';
        const rightText = state.pageSettings.showPageNumbers
          ? `পৃষ্ঠা ${bn(state.totalPages)} / ${bn(state.totalPages)}`
          : '';
        foot.innerHTML = `<span>${escapeHtml(leftText)}</span><span>${escapeHtml(rightText)}</span>`;
      } else {
        foot.hidden = true;
      }
    }
  }

  function renderRecoveryOrConflictAlert() {
    const bar = q('[data-ls-alert-bar]');
    if (!bar) return;
    if (state.conflictRecord) {
      bar.hidden = false;
      bar.innerHTML = `
        <span>⚠ অন্য ডিভাইস বা ট্যাবে এই লেকচার শিটটির নতুন সংস্করণ (v${bn(state.conflictRecord.docVersion || 1)}) সংরক্ষিত হয়েছে।</span>
        <div class="ls-alert-actions">
          <button type="button" class="ls-ctx-btn" data-ls-conflict="reload">নতুন সংস্করণ লোড করুন</button>
          <button type="button" class="ls-ctx-btn" data-ls-conflict="overwrite">আমার লেখা রাখুন</button>
          <button type="button" class="ls-ctx-btn" data-ls-conflict="duplicate">আলাদা কপি হিসেবে সেভ</button>
        </div>`;
      return;
    }
    if (state.recoveredBanner) {
      bar.hidden = false;
      bar.innerHTML = `
        <span>💡 এই ডিভাইসে একটি অসংরক্ষিত ড্রাফট পাওয়া গেছে — পুনরুদ্ধার করবেন?</span>
        <div class="ls-alert-actions">
          <button type="button" class="ls-ctx-btn" data-ls-recovery="apply">পুনরুদ্ধার করুন</button>
          <button type="button" class="ls-ctx-btn" data-ls-recovery="dismiss">বাতিল</button>
        </div>`;
      return;
    }
    bar.hidden = true;
    bar.innerHTML = '';
  }

  /* ---- Tiptap Initialization ------------------------------------------------ */

  const { FontTypography, LectureImage, MathEquation, PageBreak, A4LivePagination } = createCustomStudioExtensions(sdk, {
    getPageConfig: () => ({
      orientation: state.pageSettings.orientation,
      margins: state.pageSettings.margins,
      showHeader: state.pageSettings.showHeader,
      showFooter: state.pageSettings.showFooter,
      showPageNumbers: state.pageSettings.showPageNumbers,
      zoomScale: state.mobileComfortReflow && window.innerWidth < 820 ? 1 : computeEffectiveZoom(),
      headerLabel: state.pageSettings.headerText || state.title || BRAND_NAME,
      subjectLabel: [currentSubjectObj()?.name, currentClassObj()?.name].filter(Boolean).join(' • '),
      footerLabel: state.pageSettings.footerText || [state.teacherName ? `শিক্ষক: ${state.teacherName}` : '', BRAND_NAME].filter(Boolean).join(' • ')
    }),
    onPageCountChange: count => {
      state.totalPages = Math.max(1, count);
      const counter = q('[data-ls-page-counter]');
      if (counter) counter.textContent = `মোট পৃষ্ঠা: ${bn(state.totalPages)}`;
      paintWritingSheetChrome();
    }
  });

  editor = new sdk.Editor({
    element: q('[data-ls-tiptap-mount]'),
    content: state.docJson,
    extensions: [
      sdk.StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      sdk.Underline,
      sdk.TextStyle,
      sdk.Color,
      sdk.Highlight.configure({ multicolor: true }),
      sdk.TextAlign.configure({ types: ['heading', 'paragraph'] }),
      sdk.Subscript,
      sdk.Superscript,
      sdk.Table.configure({ resizable: true }),
      sdk.TableRow,
      sdk.TableHeader,
      sdk.TableCell,
      sdk.Placeholder.configure({
        placeholder: 'এখানে বাংলা বা ইংরেজিতে লেকচার শিট লিখুন… (শিরোনাম, টেবিল, ছবি, গাণিতিক সমীকরণ ও পৃষ্ঠা বিরতি যুক্ত করতে উপরের রিবন ব্যবহার করুন)'
      }),
      FontTypography,
      LectureImage,
      MathEquation,
      PageBreak,
      A4LivePagination
    ],
    onUpdate({ editor: ed }) {
      state.docJson = ed.getJSON();
      markDirtyAndScheduleAutosave();
      syncToolbarActiveStates();
    },
    onSelectionUpdate() {
      syncToolbarActiveStates();
      keepActiveSelectionVisibleOnMobile();
    }
  });

  function syncToolbarActiveStates() {
    if (!editor) return;
    for (const cmd of ['bold', 'italic', 'underline', 'strike', 'subscript', 'superscript', 'bulletList', 'orderedList']) {
      const btn = q(`[data-ls-cmd="${cmd}"]`);
      if (btn) btn.classList.toggle('is-active', editor.isActive(cmd));
    }
    for (const align of ['left', 'center', 'right', 'justify']) {
      const btn = q(`[data-ls-align="${align}"]`);
      if (btn) btn.classList.toggle('is-active', editor.isActive({ textAlign: align }));
    }
    const blockSel = q('[data-ls-block-style]');
    if (blockSel) {
      if (editor.isActive('heading', { level: 1 })) blockSel.value = 'h1';
      else if (editor.isActive('heading', { level: 2 })) blockSel.value = 'h2';
      else if (editor.isActive('heading', { level: 3 })) blockSel.value = 'h3';
      else if (editor.isActive('heading', { level: 4 })) blockSel.value = 'h4';
      else if (editor.isActive('blockquote')) blockSel.value = 'blockquote';
      else blockSel.value = 'p';
    }
    const tableBar = q('[data-ls-table-bar]');
    if (tableBar) tableBar.hidden = !editor.isActive('table');
    const imgBar = q('[data-ls-image-bar]');
    if (imgBar) imgBar.hidden = !editor.isActive('image');
  }

  function keepActiveSelectionVisibleOnMobile() {
    if (typeof window === 'undefined' || window.innerWidth > 768) return;
    try {
      const sel = window.getSelection?.();
      if (!sel || !sel.rangeCount) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const vvh = window.visualViewport?.height || window.innerHeight;
      if (rect && rect.bottom > vvh - 76) {
        q('[data-ls-workspace]')?.scrollBy?.({ top: rect.bottom - (vvh - 96), behavior: 'smooth' });
      }
    } catch { /* ignore */ }
  }

  /* ---- Save, Debounced Autosave, Offline Recovery & Conflict Handling ------- */

  function currentDraftPayload() {
    const json = editor ? editor.getJSON() : state.docJson;
    return {
      id: state.id,
      classId: state.classId,
      subjectId: state.subjectId,
      group: state.group,
      chapterId: state.chapterId,
      chapterName: state.chapterName,
      topic: state.topic,
      title: text(state.title) || 'নতুন লেকচার শিট',
      subtitle: state.subtitle,
      type: state.type,
      teacherId: state.teacherId,
      teacherName: state.teacherName,
      pageSettings: state.pageSettings,
      docJson: json,
      richContent: docJsonToHtml(json, { renderMath: sdk.renderLatexMathML }),
      content: docJsonToPlainText(json),
      status: state.status
    };
  }

  function markDirtyAndScheduleAutosave() {
    state.dirty = true;
    const payload = currentDraftPayload();
    saveLectureRecovery(scope.staff, state.id || 'new', {
      ...payload,
      baseVersion: state.baseVersion || 0
    });

    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    updateSaveBadge(isOffline ? 'offline' : 'unsaved', isOffline ? 'অফলাইন ড্রাফটে সুরক্ষিত' : 'অসংরক্ষিত পরিবর্তন…');

    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      void performSave({ manual: false, recordHistory: false });
    }, 1800);
  }

  async function performSave({ manual = true, recordHistory = false, forceOverwrite = false, nextStatus = null } = {}) {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    const payload = currentDraftPayload();
    if (nextStatus) payload.status = nextStatus;

    updateSaveBadge('saving', 'সংরক্ষণ হচ্ছে…');
    try {
      const saved = await saveLectureSheet(payload, {
        role,
        actor: scope.staff.displayName,
        expectedVersion: state.id ? state.baseVersion : null,
        recordHistory: Boolean(manual || recordHistory),
        forceOverwrite,
        renderMath: sdk.renderLatexMathML
      });
      state.id = saved.id;
      state.baseVersion = Math.max(1, Number(saved.docVersion) || 1);
      state.status = saved.active === false ? 'archived' : (saved.published ? 'published' : 'draft');
      state.chapterId = saved.chapterId || state.chapterId;
      state.conflictRecord = null;
      state.dirty = false;

      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      updateSaveBadge(
        isOffline ? 'offline' : 'saved',
        isOffline
          ? `অফলাইনে সংরক্ষিত (v${bn(state.baseVersion)}) — নেট এলে সিঙ্ক হবে`
          : `সংরক্ষিত ✓ (v${bn(state.baseVersion)})`
      );
      updatePublishButtons();
      renderRecoveryOrConflictAlert();
      if (manual) toast(`${saved.title} সংরক্ষিত হয়েছে।`);
      return saved;
    } catch (err) {
      if (err?.code === 'VERSION_CONFLICT' && err.currentRecord) {
        state.conflictRecord = err.currentRecord;
        updateSaveBadge('conflict', 'সংঘর্ষ সনাক্ত!');
        renderRecoveryOrConflictAlert();
        toast('অন্য ডিভাইসে ডকুমেন্টটি আপডেট হয়েছে — সংঘর্ষ পর্যালোচনা করুন।', true);
        return null;
      }
      updateSaveBadge('error', `সংরক্ষণ ব্যর্থ: ${err?.message || 'আবার চেষ্টা করুন'}`);
      if (manual) toast(err?.message || 'সংরক্ষণ করা যায়নি।', true);
      return null;
    }
  }

  /* ---- Live A4 PDF Preview Rendering ---------------------------------------- */

  async function renderLivePreview() {
    const pagesWrap = q('[data-ls-preview-pages]');
    const errBox = q('[data-ls-preview-error]');
    const timingEl = q('[data-ls-preview-timing]');
    const indicator = q('[data-ls-preview-page-indicator]');
    if (!pagesWrap) return;

    errBox.hidden = true;
    pagesWrap.innerHTML = '<div class="ls-preview-loading">A4 পৃষ্ঠা ও বাংলা ফন্ট প্রিভিউ প্রস্তুত হচ্ছে…</div>';
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();

    try {
      const cls = currentClassObj();
      const sub = currentSubjectObj();
      const draft = {
        ...currentDraftPayload(),
        className: cls?.name || '',
        subjectName: sub?.name || ''
      };
      const layout = await paginateLectureDocument(draft, { preloadImages: true });
      state.totalPages = layout.totalPages;
      state.currentPreviewPage = Math.min(state.totalPages, Math.max(1, state.currentPreviewPage));

      const scale = computeEffectiveZoom();
      const html = renderLecturePreviewPagesHtml(layout, { renderMath: sdk.renderLatexMathML });
      pagesWrap.innerHTML = `<div class="ls-preview-scaled-stack" style="--ls-preview-scale:${scale}">${html}</div>`;

      // Apply clean scale wrapper to each preview sheet so layout reflows smoothly on mobile & desktop
      qa('.ls-preview-page').forEach(pageEl => {
        const wrapper = document.createElement('div');
        wrapper.className = 'ls-preview-page-slot';
        wrapper.style.width = `${Math.round(layout.dimensions.width * scale)}px`;
        wrapper.style.height = `${Math.round(layout.dimensions.height * scale)}px`;
        pageEl.style.transform = `scale(${scale})`;
        pageEl.style.transformOrigin = 'top left';
        pageEl.parentNode.insertBefore(wrapper, pageEl);
        wrapper.appendChild(pageEl);
      });

      const elapsed = Math.max(1, Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0));
      if (timingEl) timingEl.textContent = `প্রিভিউ তৈরি: ${bn(elapsed)} ms • ${bn(layout.totalPages)} পৃষ্ঠা`;
      if (indicator) indicator.textContent = `পৃষ্ঠা ${bn(state.currentPreviewPage)} / ${bn(layout.totalPages)}`;
      const counter = q('[data-ls-page-counter]');
      if (counter) counter.textContent = `মোট পৃষ্ঠা: ${bn(layout.totalPages)}`;
    } catch (err) {
      pagesWrap.innerHTML = '';
      errBox.hidden = false;
      errBox.innerHTML = `
        <strong>PDF প্রিভিউ তৈরি করা যায়নি: ${escapeHtml(err?.message || 'অজানা ত্রুটি')}</strong>
        <button type="button" class="ls-btn" data-ls-action="refresh-preview">আবার চেষ্টা করুন</button>`;
    }
  }

  function switchStudioMode(nextMode) {
    state.mode = nextMode === 'preview' ? 'preview' : 'write';
    const isPreview = state.mode === 'preview';
    q('[data-ls-writing-stage]').hidden = isPreview;
    q('[data-ls-preview-stage]').hidden = !isPreview;
    q('[data-ls-ribbon]').hidden = isPreview;
    qa('[data-ls-mode]').forEach(btn => {
      const active = btn.dataset.lsMode === state.mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const dockPreview = q('[data-ls-dock-preview]');
    if (dockPreview) dockPreview.textContent = isPreview ? '✍️ লেখা' : '📄 প্রিভিউ';
    if (isPreview) void renderLivePreview();
    else paintWritingSheetChrome();
  }

  /* ---- Sub-Modals: Metadata & Equation Builder ------------------------------ */

  function openMetadataModal() {
    const host = q('[data-ls-submodal]');
    const buildSubjectOpts = cId => (scope.subjectsByClass[cId] || [])
      .map(s => `<option value="${escapeHtml(s.id)}"${s.id === state.subjectId ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
    const buildGroupOpts = (cId, sId) => (scope.groupsByClassSubject[`${cId}::${sId}`] || [{ value: '', label: 'সব ব্যাচ / পুরো শ্রেণি' }])
      .map(g => `<option value="${escapeHtml(g.value)}"${g.value === state.group ? ' selected' : ''}>${escapeHtml(g.label)}</option>`).join('');
    const buildChapterSuggestions = (cId, sId) => {
      const info = scope.chaptersByClassSubject[`${cId}::${sId}`] || { contentChapters: [], academicChapters: [] };
      const names = [...new Set([
        ...info.contentChapters.map(c => c.title),
        ...info.academicChapters.map(c => c.name)
      ].filter(Boolean))];
      return names.map(n => `<option value="${escapeHtml(n)}"></option>`).join('');
    };

    host.hidden = false;
    host.innerHTML = `
      <form class="ls-submodal-card" data-ls-meta-form>
        <header class="ls-submodal-head">
          <h3>ডকুমেন্ট তথ্য ও A4 পৃষ্ঠা সেটিংস</h3>
          <button type="button" class="ls-tool-btn" data-ls-close-submodal aria-label="বন্ধ করুন">✕</button>
        </header>
        <div class="ls-submodal-grid">
          <label>শিরোনাম
            <input name="title" maxlength="160" required value="${escapeHtml(state.title)}">
          </label>
          <label>উপ-শিরোনাম (Subtitle)
            <input name="subtitle" maxlength="200" value="${escapeHtml(state.subtitle)}" placeholder="যেমন: বোর্ড সৃজনশীল ও শর্ট টেকনিক">
          </label>
          <label>শ্রেণি
            <select name="classId" data-ls-meta-class ${state.id ? 'disabled title="সংরক্ষিত শিটের শ্রেণি স্থির থাকে — বদলাতে কপি তৈরি করুন"' : ''}>
              ${scope.classes.map(c => `<option value="${escapeHtml(c.id)}"${c.id === state.classId ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </label>
          <label>বিষয়
            <select name="subjectId" data-ls-meta-subject ${state.id ? 'disabled title="সংরক্ষিত শিটের বিষয় স্থির থাকে — বদলাতে কপি তৈরি করুন"' : ''}>
              ${buildSubjectOpts(state.classId)}
            </select>
          </label>
          <label>ব্যাচ / বিভাগ
            <select name="group" data-ls-meta-group>${buildGroupOpts(state.classId, state.subjectId)}</select>
          </label>
          <label>অধ্যায় (Chapter)
            <input name="chapterName" list="lsChapterDatalist" maxlength="160" value="${escapeHtml(state.chapterName)}" placeholder="অধ্যায়ের নাম লিখুন বা বেছে নিন">
            <datalist id="lsChapterDatalist">${buildChapterSuggestions(state.classId, state.subjectId)}</datalist>
          </label>
          <label>টপিক (Topic)
            <input name="topic" maxlength="160" value="${escapeHtml(state.topic)}" placeholder="যেমন: Articles / বাস্তব সংখ্যা">
          </label>
          <label>ধরন
            <select name="type">
              <option value="lesson"${state.type === 'lesson' ? ' selected' : ''}>পাঠ / লেকচার শিট</option>
              <option value="note"${state.type === 'note' ? ' selected' : ''}>ক্লাস নোট</option>
              <option value="suggestion"${state.type === 'suggestion' ? ' selected' : ''}>সাজেশন শিট</option>
              <option value="important_question"${state.type === 'important_question' ? ' selected' : ''}>গুরুত্বপূর্ণ প্রশ্ন শিট</option>
              <option value="model_test"${state.type === 'model_test' ? ' selected' : ''}>মডেল টেস্ট শিট</option>
            </select>
          </label>
          <label>হেডার টেক্সট (ঐচ্ছিক)
            <input name="headerText" maxlength="140" value="${escapeHtml(state.pageSettings.headerText)}" placeholder="${escapeHtml(BRAND_TAGLINE)}">
          </label>
          <label>ফুটার টেক্সট (ঐচ্ছিক)
            <input name="footerText" maxlength="140" value="${escapeHtml(state.pageSettings.footerText)}" placeholder="শিক্ষকের নাম ও প্রতিষ্ঠানের নাম">
          </label>
        </div>
        <div class="ls-submodal-checks">
          <label><input type="checkbox" name="showLogo"${state.pageSettings.showLogo ? ' checked' : ''}> প্রতিষ্ঠানের লোগো দেখান</label>
          <label><input type="checkbox" name="showWatermark"${state.pageSettings.showWatermark !== false ? ' checked' : ''}> জলছাপ (Watermark) দেখান</label>
          <label><input type="checkbox" name="showHeader"${state.pageSettings.showHeader ? ' checked' : ''}> পৃষ্ঠার হেডার দেখান</label>
          <label><input type="checkbox" name="showFooter"${state.pageSettings.showFooter ? ' checked' : ''}> পৃষ্ঠার ফুটার দেখান</label>
          <label><input type="checkbox" name="showPageNumbers"${state.pageSettings.showPageNumbers ? ' checked' : ''}> পৃষ্ঠা নম্বর (Page X of Y)</label>
        </div>
        <footer class="ls-submodal-foot">
          <button type="button" class="ls-btn" data-ls-close-submodal>বাতিল</button>
          <button type="submit" class="ls-btn ls-publish-btn">প্রয়োগ করুন</button>
        </footer>
      </form>`;

    const clsSelect = host.querySelector('[data-ls-meta-class]');
    const subSelect = host.querySelector('[data-ls-meta-subject]');
    const grpSelect = host.querySelector('[data-ls-meta-group]');
    const datalist = host.querySelector('#lsChapterDatalist');

    clsSelect?.addEventListener('change', () => {
      const nextC = clsSelect.value;
      const subs = scope.subjectsByClass[nextC] || [];
      subSelect.innerHTML = subs.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
      const nextS = subs[0]?.id || '';
      grpSelect.innerHTML = buildGroupOpts(nextC, nextS);
      datalist.innerHTML = buildChapterSuggestions(nextC, nextS);
    });
    subSelect?.addEventListener('change', () => {
      grpSelect.innerHTML = buildGroupOpts(clsSelect.value, subSelect.value);
      datalist.innerHTML = buildChapterSuggestions(clsSelect.value, subSelect.value);
    });

    host.querySelector('[data-ls-meta-form]')?.addEventListener('submit', ev => {
      ev.preventDefault();
      const fd = new FormData(ev.currentTarget);
      state.title = text(fd.get('title')) || state.title;
      state.subtitle = text(fd.get('subtitle'));
      if (!state.id) {
        state.classId = text(fd.get('classId')) || state.classId;
        state.subjectId = text(fd.get('subjectId')) || state.subjectId;
      }
      state.group = text(fd.get('group'));
      const newChap = text(fd.get('chapterName'));
      if (newChap !== state.chapterName) {
        state.chapterName = newChap;
        state.chapterId = '';
      }
      state.topic = text(fd.get('topic'));
      state.type = text(fd.get('type')) || 'lesson';
      state.pageSettings = normalizeLecturePageSettings({
        ...state.pageSettings,
        headerText: text(fd.get('headerText')),
        footerText: text(fd.get('footerText')),
        showLogo: fd.get('showLogo') === 'on',
        showWatermark: fd.get('showWatermark') === 'on',
        showHeader: fd.get('showHeader') === 'on',
        showFooter: fd.get('showFooter') === 'on',
        showPageNumbers: fd.get('showPageNumbers') === 'on'
      });
      const titleInput = q('[data-ls-title-input]');
      if (titleInput) titleInput.value = state.title;
      host.hidden = true;
      host.innerHTML = '';
      updateMetaSummary();
      paintWritingSheetChrome();
      markDirtyAndScheduleAutosave();
      if (state.mode === 'preview') void renderLivePreview();
    });
  }

  function openEquationModal(initialLatex = 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', onConfirm = null) {
    const host = q('[data-ls-submodal]');
    host.hidden = false;
    host.innerHTML = `
      <form class="ls-submodal-card" data-ls-eq-form>
        <header class="ls-submodal-head">
          <h3>∑ গাণিতিক সমীকরণ ও বৈজ্ঞানিক সংকেত</h3>
          <button type="button" class="ls-tool-btn" data-ls-close-submodal aria-label="বন্ধ করুন">✕</button>
        </header>
        <div class="ls-eq-presets">
          ${EQUATION_PRESETS.map((p, idx) => `<button type="button" class="ls-ctx-btn" data-ls-eq-preset="${idx}">${escapeHtml(p.label)}</button>`).join('')}
        </div>
        <label class="ls-eq-field">LaTeX / গাণিতিক সংকেত লিখুন
          <textarea name="latex" rows="3" required data-ls-eq-input>${escapeHtml(initialLatex)}</textarea>
        </label>
        <div class="ls-eq-preview-box" data-ls-eq-preview></div>
        <footer class="ls-submodal-foot">
          <button type="button" class="ls-btn" data-ls-close-submodal>বাতিল</button>
          <button type="submit" class="ls-btn ls-publish-btn">সমীকরণ যুক্ত করুন</button>
        </footer>
      </form>`;

    const input = host.querySelector('[data-ls-eq-input]');
    const preview = host.querySelector('[data-ls-eq-preview]');
    const repaint = () => {
      try {
        preview.innerHTML = sdk.renderLatexMathML(input.value || '', true);
      } catch {
        preview.textContent = input.value || '';
      }
    };
    repaint();
    input.addEventListener('input', repaint);
    host.querySelectorAll('[data-ls-eq-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = EQUATION_PRESETS[Number(btn.dataset.lsEqPreset)];
        if (preset) {
          input.value = preset.latex;
          repaint();
        }
      });
    });
    host.querySelector('[data-ls-eq-form]').addEventListener('submit', ev => {
      ev.preventDefault();
      const val = text(input.value);
      if (!val) return;
      host.hidden = true;
      host.innerHTML = '';
      if (typeof onConfirm === 'function') onConfirm(val);
      else editor?.chain().focus().insertMathEquation({ latex: val, display: true }).run();
    });
  }

  /* ---- Event Wiring --------------------------------------------------------- */

  q('[data-ls-title-input]')?.addEventListener('input', ev => {
    state.title = ev.target.value;
    paintWritingSheetChrome();
    markDirtyAndScheduleAutosave();
  });

  overlay.addEventListener('dblclick', ev => {
    const mathEl = ev.target.closest('.ls-math-node-view');
    if (!mathEl || !editor) return;
    const currentLatex = mathEl.dataset.latex || '';
    openEquationModal(currentLatex, updatedLatex => {
      editor.chain().focus().updateAttributes('mathEquation', { latex: updatedLatex }).run();
    });
  });

  overlay.addEventListener('change', async ev => {
    const target = ev.target;
    if (target.matches('[data-ls-block-style]')) {
      const val = target.value;
      const ch = editor.chain().focus();
      if (val === 'p') ch.setParagraph().run();
      else if (val === 'blockquote') ch.toggleBlockquote().run();
      else if (/^h[1-4]$/.test(val)) ch.toggleHeading({ level: Number(val[1]) }).run();
      return;
    }
    if (target.matches('[data-ls-font-family]')) {
      state.pageSettings.fontFamily = target.value;
      editor.chain().focus().setFontFamily(target.value).run();
      paintWritingSheetChrome();
      markDirtyAndScheduleAutosave();
      return;
    }
    if (target.matches('[data-ls-font-size]')) {
      editor.chain().focus().setFontSize(target.value).run();
      return;
    }
    if (target.matches('[data-ls-text-color]')) {
      editor.chain().focus().setColor(target.value).run();
      return;
    }
    if (target.matches('[data-ls-highlight]')) {
      const val = target.value;
      if (val === 'none') editor.chain().focus().unsetHighlight().run();
      else if (val) editor.chain().focus().toggleHighlight({ color: val }).run();
      target.value = '';
      return;
    }
    if (target.matches('[data-ls-line-height]')) {
      state.pageSettings.lineHeight = Number(target.value) || 1.6;
      editor.chain().focus().setLineHeight(target.value).run();
      paintWritingSheetChrome();
      markDirtyAndScheduleAutosave();
      return;
    }
    if (target.matches('[data-ls-orientation]')) {
      state.pageSettings.orientation = target.value === 'landscape' ? 'landscape' : 'portrait';
      paintWritingSheetChrome();
      markDirtyAndScheduleAutosave();
      if (state.mode === 'preview') void renderLivePreview();
      return;
    }
    if (target.matches('[data-ls-margins]')) {
      state.pageSettings.margins = ['narrow', 'normal', 'wide'].includes(target.value) ? target.value : 'normal';
      paintWritingSheetChrome();
      markDirtyAndScheduleAutosave();
      if (state.mode === 'preview') void renderLivePreview();
      return;
    }
    if (target.matches('[data-ls-image-file]')) {
      const file = target.files?.[0];
      target.value = '';
      if (!file) return;
      try {
        updateSaveBadge('saving', 'ছবি অপ্টিমাইজ হচ্ছে…');
        const dataUrl = await compressLectureImageFile(file);
        if (!isSafeLectureImageSrc(dataUrl)) throw new Error('ছবির ফাইলটি নিরাপদ সীমার মধ্যে নেই।');
        editor.chain().focus().setImage({ src: dataUrl, alt: file.name.replace(/\.[^.]+$/, '') }).run();
        markDirtyAndScheduleAutosave();
      } catch (err) {
        updateSaveBadge('error', err?.message || 'ছবি যুক্ত করা যায়নি');
        toast(err?.message || 'ছবি যুক্ত করা যায়নি।', true);
      }
    }
  });

  overlay.addEventListener('click', async ev => {
    if (ev.target.closest('[data-ls-close-submodal]')) {
      const host = q('[data-ls-submodal]');
      host.hidden = true;
      host.innerHTML = '';
      return;
    }

    const modeBtn = ev.target.closest('[data-ls-mode]');
    if (modeBtn) {
      switchStudioMode(modeBtn.dataset.lsMode);
      return;
    }

    const cmdBtn = ev.target.closest('[data-ls-cmd]');
    if (cmdBtn && editor) {
      const cmd = cmdBtn.dataset.lsCmd;
      const ch = editor.chain().focus();
      if (cmd === 'undo') ch.undo().run();
      else if (cmd === 'redo') ch.redo().run();
      else if (cmd === 'bold') ch.toggleBold().run();
      else if (cmd === 'italic') ch.toggleItalic().run();
      else if (cmd === 'underline') ch.toggleUnderline().run();
      else if (cmd === 'strike') ch.toggleStrike().run();
      else if (cmd === 'superscript') ch.toggleSuperscript().run();
      else if (cmd === 'subscript') ch.toggleSubscript().run();
      else if (cmd === 'bulletList') ch.toggleBulletList().run();
      else if (cmd === 'orderedList') ch.toggleOrderedList().run();
      else if (cmd === 'indent') ch.indentBlock(1).run();
      else if (cmd === 'outdent') ch.indentBlock(-1).run();
      else if (cmd === 'hr') ch.setHorizontalRule().run();
      else if (cmd === 'pageBreak') ch.insertPageBreak().run();
      else if (cmd === 'clearFormat') ch.unsetAllMarks().clearNodes().run();
      syncToolbarActiveStates();
      return;
    }

    const alignBtn = ev.target.closest('[data-ls-align]');
    if (alignBtn && editor) {
      editor.chain().focus().setTextAlign(alignBtn.dataset.lsAlign).run();
      syncToolbarActiveStates();
      return;
    }

    const tableBtn = ev.target.closest('[data-ls-table-cmd]');
    if (tableBtn && editor) {
      const fn = tableBtn.dataset.lsTableCmd;
      if (typeof editor.chain().focus()[fn] === 'function') {
        editor.chain().focus()[fn]().run();
      }
      syncToolbarActiveStates();
      return;
    }

    const imgW = ev.target.closest('[data-ls-img-width]');
    if (imgW && editor) {
      editor.chain().focus().updateAttributes('image', { widthPct: Number(imgW.dataset.lsImgWidth) || 75 }).run();
      return;
    }
    const imgAlign = ev.target.closest('[data-ls-img-align]');
    if (imgAlign && editor) {
      editor.chain().focus().updateAttributes('image', { align: imgAlign.dataset.lsImgAlign }).run();
      return;
    }

    const zoomBtn = ev.target.closest('[data-ls-zoom]');
    if (zoomBtn) {
      const dir = zoomBtn.dataset.lsZoom;
      if (dir === 'fit') state.zoom = state.zoom === 'fit' ? 100 : 'fit';
      else {
        const cur = state.zoom === 'fit' ? Math.round(computeEffectiveZoom() * 100) : Number(state.zoom) || 100;
        state.zoom = Math.min(150, Math.max(50, cur + (dir === 'in' ? 15 : -15)));
      }
      state.mobileComfortReflow = false;
      q('[data-ls-action="toggle-mobile-reflow"]')?.classList.remove('is-active');
      paintWritingSheetChrome();
      if (state.mode === 'preview') void renderLivePreview();
      return;
    }

    const navBtn = ev.target.closest('[data-ls-preview-nav]');
    if (navBtn) {
      const dir = navBtn.dataset.lsPreviewNav === 'next' ? 1 : -1;
      state.currentPreviewPage = Math.min(state.totalPages, Math.max(1, state.currentPreviewPage + dir));
      const targetPage = q(`.ls-preview-page[data-ls-page="${state.currentPreviewPage}"]`);
      targetPage?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      const indicator = q('[data-ls-preview-page-indicator]');
      if (indicator) indicator.textContent = `পৃষ্ঠা ${bn(state.currentPreviewPage)} / ${bn(state.totalPages)}`;
      return;
    }

    const recBtn = ev.target.closest('[data-ls-recovery]');
    if (recBtn) {
      if (recBtn.dataset.lsRecovery === 'apply' && state.recoveredBanner?.draft) {
        const d = state.recoveredBanner.draft;
        state.title = d.title || state.title;
        state.subtitle = d.subtitle || '';
        state.topic = d.topic || '';
        state.chapterName = d.chapterName || state.chapterName;
        state.pageSettings = normalizeLecturePageSettings(d.pageSettings);
        state.docJson = d.docJson;
        q('[data-ls-title-input]').value = state.title;
        editor?.commands.setContent(state.docJson);
        updateMetaSummary();
        paintWritingSheetChrome();
        toast('অসংরক্ষিত ড্রাফট পুনরুদ্ধার করা হয়েছে।');
      } else {
        clearLectureRecovery(scope.staff, state.id || 'new');
      }
      state.recoveredBanner = null;
      renderRecoveryOrConflictAlert();
      return;
    }

    const confBtn = ev.target.closest('[data-ls-conflict]');
    if (confBtn && state.conflictRecord) {
      const act = confBtn.dataset.lsConflict;
      if (act === 'reload') {
        const rec = contentById(state.id) || state.conflictRecord;
        state.baseVersion = Math.max(1, Number(rec.docVersion) || 1);
        state.title = rec.title || state.title;
        state.subtitle = rec.subtitle || '';
        state.topic = rec.topic || '';
        state.pageSettings = normalizeLecturePageSettings(rec.pageSettings);
        state.docJson = rec.docJson || state.docJson;
        state.conflictRecord = null;
        q('[data-ls-title-input]').value = state.title;
        editor?.commands.setContent(state.docJson);
        updateSaveBadge('saved', `নতুন সংস্করণ লোড হয়েছে (v${bn(state.baseVersion)})`);
        renderRecoveryOrConflictAlert();
        paintWritingSheetChrome();
      } else if (act === 'overwrite') {
        await performSave({ manual: true, recordHistory: true, forceOverwrite: true });
      } else if (act === 'duplicate') {
        state.id = '';
        state.baseVersion = null;
        state.title = `${state.title.slice(0, 140)} (কপি)`;
        q('[data-ls-title-input]').value = state.title;
        state.conflictRecord = null;
        await performSave({ manual: true, recordHistory: false, forceOverwrite: true });
      }
      return;
    }

    const actionEl = ev.target.closest('[data-ls-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.lsAction;

    if (action === 'open-meta') {
      openMetadataModal();
      return;
    }
    if (action === 'insert-table') {
      editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      syncToolbarActiveStates();
      return;
    }
    if (action === 'insert-image') {
      q('[data-ls-image-file]')?.click();
      return;
    }
    if (action === 'insert-equation') {
      openEquationModal();
      return;
    }
    if (action === 'toggle-mobile-reflow') {
      state.mobileComfortReflow = !state.mobileComfortReflow;
      actionEl.classList.toggle('is-active', state.mobileComfortReflow);
      paintWritingSheetChrome();
      return;
    }
    if (action === 'switch-preview-toggle') {
      switchStudioMode(state.mode === 'preview' ? 'write' : 'preview');
      return;
    }
    if (action === 'refresh-preview') {
      void renderLivePreview();
      return;
    }
    if (action === 'save-draft') {
      await performSave({ manual: true, recordHistory: true });
      return;
    }
    if (action === 'toggle-publish') {
      const nextStatus = state.status === 'published' ? 'draft' : 'published';
      const saved = await performSave({ manual: false, recordHistory: true, nextStatus });
      if (saved) {
        toast(nextStatus === 'published'
          ? 'লেকচার শিট প্রকাশিত হয়েছে — স্টুডেন্ট প্যানেলে শিক্ষার্থীরা পড়তে ও PDF ডাউনলোড করতে পারবে।'
          : 'লেকচার শিট খসড়ায় নেওয়া হয়েছে — স্টুডেন্ট প্যানেল থেকে লুকানো হয়েছে।');
      }
      return;
    }
    if (action === 'download-pdf') {
      // Preserve unsaved changes first before exporting PDF
      if (state.dirty) {
        await performSave({ manual: false, recordHistory: false });
      }
      const prevText = actionEl.textContent;
      actionEl.disabled = true;
      actionEl.textContent = '⏳ PDF তৈরি হচ্ছে…';
      try {
        const cls = currentClassObj();
        const sub = currentSubjectObj();
        const exportRecord = {
          ...currentDraftPayload(),
          className: cls?.name || '',
          subjectName: sub?.name || ''
        };
        const res = await downloadLectureSheetPDF(exportRecord, {
          onProgress({ currentPage, totalPages }) {
            if (totalPages > 0) actionEl.textContent = `⏳ PDF (${bn(currentPage)}/${bn(totalPages)})…`;
          }
        });
        toast(`${res.filename} ডাউনলোড প্রস্তুত (${bn(res.totalPages)} পৃষ্ঠা)।`);
      } catch (err) {
        toast(`PDF তৈরিতে সমস্যা: ${err?.message || 'আবার চেষ্টা করুন'}`, true);
      } finally {
        actionEl.disabled = false;
        actionEl.textContent = prevText;
      }
      return;
    }
    if (action === 'print') {
      if (state.dirty) await performSave({ manual: false, recordHistory: false });
      const cls = currentClassObj();
      const sub = currentSubjectObj();
      await printLectureSheet({
        ...currentDraftPayload(),
        className: cls?.name || '',
        subjectName: sub?.name || ''
      }, { renderMath: sdk.renderLatexMathML });
      return;
    }
    if (action === 'native-fullscreen') {
      try {
        if (document.fullscreenElement) await document.exitFullscreen?.();
        else await overlay.requestFullscreen?.();
      } catch { /* unsupported browser */ }
      return;
    }
    if (action === 'exit') {
      await closeStudio();
    }
  });

  // Keyboard shortcuts (Ctrl/Cmd+S save, Escape closes submodal)
  const onKeyDown = ev => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') {
      ev.preventDefault();
      void performSave({ manual: true, recordHistory: true });
      return;
    }
    if (ev.key === 'Escape') {
      const sub = q('[data-ls-submodal]');
      if (sub && !sub.hidden) {
        ev.preventDefault();
        sub.hidden = true;
        sub.innerHTML = '';
      }
    }
  };
  const onOnline = () => {
    if (state.dirty || state.saveState === 'offline') {
      void performSave({ manual: false, recordHistory: false });
    }
  };
  const onResize = () => {
    if (window.visualViewport) {
      overlay.style.setProperty('--ls-vvh', `${Math.round(window.visualViewport.height)}px`);
    }
    paintWritingSheetChrome();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('online', onOnline);
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);

  async function closeStudio() {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    if (state.dirty && text(state.title)) {
      const saved = await performSave({ manual: false, recordHistory: false });
      if (!saved && typeof window.confirm === 'function') {
        const leave = window.confirm('অসংরক্ষিত পরিবর্তন ক্লাউডে সেভ হয়নি (ডিভাইস ড্রাফটে সুরক্ষিত আছে)। তবুও এডিটর বন্ধ করবেন?');
        if (!leave) return;
      }
    }
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('resize', onResize);
    window.visualViewport?.removeEventListener('resize', onResize);
    if (document.fullscreenElement === overlay) {
      try { await document.exitFullscreen?.(); } catch { /* ignore */ }
    }
    editor?.destroy();
    overlay.remove();
    document.documentElement.classList.remove('apc-lecture-studio-open');
    onClosed({ id: state.id });
  }

  updateMetaSummary();
  updatePublishButtons();
  renderRecoveryOrConflictAlert();
  onResize();

  return {
    overlay,
    editor,
    getState: () => ({ ...state }),
    saveDraft: () => performSave({ manual: true, recordHistory: true }),
    switchMode: switchStudioMode,
    close: closeStudio
  };
}

/* ---- Staff Lecture Sheet Management View (Admin / Manager / Teacher) -------- */

export async function mountLectureSheetManager({
  mount,
  role = 'admin',
  toast = () => {}
} = {}) {
  const root = typeof mount === 'string' ? document.querySelector(mount) : mount;
  if (!root) return { refresh: async () => {} };

  const uiState = {
    classId: '',
    subjectId: '',
    status: 'all',
    search: '',
    createModalOpen: false,
    historyRecordId: ''
  };

  let scope = null;
  let sheets = [];

  async function loadData() {
    scope = await resolveLectureScope(role);
    sheets = await listLectureSheets({
      classId: uiState.classId,
      subjectId: uiState.subjectId,
      status: uiState.status,
      search: uiState.search
    }, { role });
  }

  function statusBadge(status) {
    if (status === 'published') return '<span class="ls-status-pill is-published">প্রকাশিত</span>';
    if (status === 'archived') return '<span class="ls-status-pill is-archived">আর্কাইভ</span>';
    return '<span class="ls-status-pill is-draft">খসড়া</span>';
  }

  function render() {
    if (!scope) return;
    const classes = scope.classes || [];
    const subjects = uiState.classId ? (scope.subjectsByClass[uiState.classId] || []) : [];
    const historyTarget = uiState.historyRecordId ? contentById(uiState.historyRecordId) : null;

    root.innerHTML = `
      <div class="ls-manager-wrap" data-ls-manager="${escapeHtml(role)}">
        <div class="ls-manager-hero-card">
          <div class="ls-manager-hero-copy">
            <span class="ls-manager-kicker">Word-Style A4 Studio</span>
            <h3>লেকচার শিট ও PDF স্টুডিও</h3>
            <p>ফুল-স্ক্রিন A4 পৃষ্ঠায় বাংলা ও ইংরেজি লেকচার শিট লিখুন, টেবিল/ছবি/সমীকরণ সাজান, PDF ডাউনলোড করুন এবং স্টুডেন্ট প্যানেলে পাঠান।</p>
          </div>
          <button type="button" class="ls-create-cta" data-ls-mgr-action="open-create"${classes.length ? '' : ' disabled'}>
            + নতুন লেকচার শিট তৈরি করুন
          </button>
        </div>

        ${uiState.createModalOpen ? renderQuickCreateCard(scope) : ''}
        ${historyTarget ? renderHistoryDrawer(historyTarget) : ''}

        <div class="ls-manager-filters">
          <div class="ls-filter-row">
            <select class="ls-filter-select" data-ls-filter="classId" aria-label="শ্রেণি ফিল্টার">
              <option value="">সব শ্রেণি</option>
              ${classes.map(c => `<option value="${escapeHtml(c.id)}"${c.id === uiState.classId ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>
            <select class="ls-filter-select" data-ls-filter="subjectId" aria-label="বিষয় ফিল্টার"${uiState.classId ? '' : ' disabled'}>
              <option value="">সব বিষয়</option>
              ${subjects.map(s => `<option value="${escapeHtml(s.id)}"${s.id === uiState.subjectId ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
            </select>
            <input type="search" class="ls-filter-search" data-ls-filter="search"
              placeholder="শিরোনাম, অধ্যায়, টপিক বা শব্দ খুঁজুন…" value="${escapeHtml(uiState.search)}" aria-label="লেকচার শিট খুঁজুন">
          </div>
          <div class="ls-status-chips" role="tablist" aria-label="স্ট্যাটাস ফিল্টার">
            ${[
              ['all', 'সব'],
              ['draft', 'খসড়া'],
              ['published', 'প্রকাশিত'],
              ['archived', 'আর্কাইভ']
            ].map(([key, label]) => `
              <button type="button" role="tab" class="ls-chip${uiState.status === key ? ' is-active' : ''}"
                aria-selected="${uiState.status === key ? 'true' : 'false'}" data-ls-status-chip="${key}">${label}</button>
            `).join('')}
          </div>
        </div>

        <div class="ls-sheet-grid" data-ls-sheet-list>
          ${sheets.length ? sheets.map(sheet => `
            <article class="ls-sheet-card" data-ls-card="${escapeHtml(sheet.id)}">
              <div class="ls-sheet-card-top">
                <div>
                  <div class="ls-sheet-badges">
                    ${statusBadge(sheet.status)}
                    <span class="ls-ver-pill">v${bn(sheet.docVersion || 1)}</span>
                    <span class="ls-orient-pill">${sheet.pageSettings?.orientation === 'landscape' ? 'A4 Landscape' : 'A4 Portrait'}</span>
                  </div>
                  <h4>${escapeHtml(sheet.title)}</h4>
                  ${sheet.subtitle ? `<p class="ls-sheet-sub">${escapeHtml(sheet.subtitle)}</p>` : ''}
                </div>
              </div>
              <p class="ls-sheet-meta">
                ${escapeHtml([
                  sheet.className,
                  sheet.group,
                  sheet.subjectName,
                  sheet.chapterName ? `অধ্যায়: ${sheet.chapterName}` : '',
                  sheet.topic ? `টপিক: ${sheet.topic}` : ''
                ].filter(Boolean).join(' • '))}
              </p>
              <p class="ls-sheet-author">লেখক: ${escapeHtml(sheet.teacherName || sheet.createdBy || 'স্টাফ')} • কোড: ${escapeHtml(sheet.id)}</p>
              <div class="ls-sheet-actions">
                <button type="button" class="ls-card-btn ls-card-btn-primary" data-ls-mgr-action="edit" data-id="${escapeHtml(sheet.id)}">✍️ স্টুডিওতে খুলুন</button>
                <button type="button" class="ls-card-btn" data-ls-mgr-action="pdf" data-id="${escapeHtml(sheet.id)}">⬇ PDF</button>
                <button type="button" class="ls-card-btn" data-ls-mgr-action="duplicate" data-id="${escapeHtml(sheet.id)}">⧉ কপি তৈরি</button>
                ${sheet.status !== 'archived' ? `
                  <button type="button" class="ls-card-btn ${sheet.status === 'published' ? '' : 'ls-card-btn-accent'}"
                    data-ls-mgr-action="${sheet.status === 'published' ? 'unpublish' : 'publish'}" data-id="${escapeHtml(sheet.id)}">
                    ${sheet.status === 'published' ? 'আনপাবলিশ' : 'স্টুডেন্টে পাবলিশ'}
                  </button>
                  <button type="button" class="ls-card-btn" data-ls-mgr-action="archive" data-id="${escapeHtml(sheet.id)}">আর্কাইভ</button>
                ` : `
                  <button type="button" class="ls-card-btn" data-ls-mgr-action="unarchive" data-id="${escapeHtml(sheet.id)}">পুনরুদ্ধার</button>
                `}
                ${Array.isArray(sheet.history) && sheet.history.length ? `
                  <button type="button" class="ls-card-btn" data-ls-mgr-action="history" data-id="${escapeHtml(sheet.id)}">↺ সংস্করণ (${bn(sheet.history.length)})</button>
                ` : ''}
              </div>
            </article>
          `).join('') : `
            <div class="ls-empty-state">
              <span class="ls-empty-icon" aria-hidden="true">${iconMarkup('book')}</span>
              <strong>কোনো লেকচার শিট পাওয়া যায়নি</strong>
              <p>“+ নতুন লেকচার শিট তৈরি করুন” বাটনে ট্যাপ করে ফুল-স্ক্রিন A4 এডিটরে লেখা শুরু করুন।</p>
            </div>
          `}
        </div>
      </div>`;
  }

  function renderQuickCreateCard(sc) {
    const cId = uiState.classId || sc.classes[0]?.id || '';
    const subs = sc.subjectsByClass[cId] || [];
    const sId = subs[0]?.id || '';
    const groups = sc.groupsByClassSubject[`${cId}::${sId}`] || [{ value: '', label: 'সব ব্যাচ / পুরো শ্রেণি' }];
    const chInfo = sc.chaptersByClassSubject[`${cId}::${sId}`] || { contentChapters: [], academicChapters: [] };
    const chapNames = [...new Set([...chInfo.contentChapters.map(c => c.title), ...chInfo.academicChapters.map(c => c.name)].filter(Boolean))];

    return `
      <form class="ls-quick-create-card" data-ls-quick-create-form>
        <div class="ls-quick-head">
          <h4>নতুন লেকচার শিটের প্রাথমিক তথ্য</h4>
          <button type="button" class="ls-card-btn" data-ls-mgr-action="close-create">বন্ধ করুন</button>
        </div>
        <div class="ls-quick-grid">
          <label>শ্রেণি
            <select name="lsClassId" data-ls-qc-class required>
              ${sc.classes.map(c => `<option value="${escapeHtml(c.id)}"${c.id === cId ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </label>
          <label>বিষয়
            <select name="lsSubjectId" data-ls-qc-subject required>
              ${subs.map(s => `<option value="${escapeHtml(s.id)}"${s.id === sId ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
            </select>
          </label>
          <label>ব্যাচ / বিভাগ
            <select name="lsGroup" data-ls-qc-group>
              ${groups.map(g => `<option value="${escapeHtml(g.value)}">${escapeHtml(g.label)}</option>`).join('')}
            </select>
          </label>
          <label>অধ্যায় (Chapter)
            <input name="lsChapterName" list="lsQcChapters" maxlength="160" placeholder="অধ্যায়ের নাম লিখুন বা বেছে নিন">
            <datalist id="lsQcChapters">${chapNames.map(n => `<option value="${escapeHtml(n)}"></option>`).join('')}</datalist>
          </label>
          <label>টপিক (Topic)
            <input name="lsTopic" maxlength="160" placeholder="যেমন: Articles / ত্রিকোণমিতিক অনুপাত">
          </label>
          <label>লেকচার শিটের শিরোনাম
            <input name="lsTitle" maxlength="160" required placeholder="যেমন: লেকচার শিট ০১ — বাস্তব সংখ্যা">
          </label>
        </div>
        <div class="ls-quick-actions">
          <button type="submit" class="ls-create-cta">ফুল-স্ক্রিন এডিটর খুলুন →</button>
        </div>
      </form>`;
  }

  function renderHistoryDrawer(record) {
    const list = Array.isArray(record.history) ? record.history : [];
    return `
      <div class="ls-quick-create-card" data-ls-history-drawer>
        <div class="ls-quick-head">
          <h4>সংস্করণ ইতিহাস — ${escapeHtml(record.title)}</h4>
          <button type="button" class="ls-card-btn" data-ls-mgr-action="close-history">বন্ধ করুন</button>
        </div>
        <div class="ls-history-list">
          ${list.map(item => `
            <div class="ls-history-row">
              <div>
                <strong>সংস্করণ v${bn(item.version)} — ${escapeHtml(item.title || record.title)}</strong>
                <small>${escapeHtml(item.savedBy || '')} • ${escapeHtml(item.savedAt ? new Date(item.savedAt).toLocaleString('bn-BD') : '')}</small>
              </div>
              ${item.docJson ? `<button type="button" class="ls-card-btn ls-card-btn-primary" data-ls-mgr-action="restore-version" data-id="${escapeHtml(record.id)}" data-ver="${item.version}">ফিরিয়ে আনুন</button>` : '<small>সংক্ষিপ্ত মেটাডেটা</small>'}
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  async function refresh() {
    try {
      await loadData();
      render();
    } catch (err) {
      root.innerHTML = `<p class="admin-empty">${escapeHtml(err?.message || 'লেকচার শিট তালিকা লোড করা যায়নি।')}</p>`;
    }
  }

  if (root.dataset.lsManagerWired !== '1') {
    root.dataset.lsManagerWired = '1';

    root.addEventListener('change', ev => {
      const target = ev.target;
      if (target.matches('[data-ls-filter="classId"]')) {
        uiState.classId = target.value;
        uiState.subjectId = '';
        void refresh();
        return;
      }
      if (target.matches('[data-ls-filter="subjectId"]')) {
        uiState.subjectId = target.value;
        void refresh();
        return;
      }
      if (target.matches('[data-ls-qc-class]') && scope) {
        const cId = target.value;
        const subs = scope.subjectsByClass[cId] || [];
        const subEl = root.querySelector('[data-ls-qc-subject]');
        const grpEl = root.querySelector('[data-ls-qc-group]');
        if (subEl) subEl.innerHTML = subs.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
        const sId = subs[0]?.id || '';
        const grps = scope.groupsByClassSubject[`${cId}::${sId}`] || [{ value: '', label: 'সব ব্যাচ / পুরো শ্রেণি' }];
        if (grpEl) grpEl.innerHTML = grps.map(g => `<option value="${escapeHtml(g.value)}">${escapeHtml(g.label)}</option>`).join('');
      }
    });

    root.addEventListener('input', ev => {
      if (ev.target.matches('[data-ls-filter="search"]')) {
        uiState.search = ev.target.value;
        clearTimeout(root._lsSearchTimer);
        root._lsSearchTimer = setTimeout(async () => {
          await loadData();
          render();
          const box = root.querySelector('[data-ls-filter="search"]');
          if (box) {
            box.focus();
            box.setSelectionRange(box.value.length, box.value.length);
          }
        }, 180);
      }
    });

    root.addEventListener('submit', async ev => {
      const qcForm = ev.target.closest('[data-ls-quick-create-form]');
      if (!qcForm) return;
      ev.preventDefault();
      const fd = new FormData(qcForm);
      uiState.createModalOpen = false;
      render();
      await openLectureSheetStudio({
        role,
        toast,
        initialMeta: {
          classId: text(fd.get('lsClassId')),
          subjectId: text(fd.get('lsSubjectId')),
          group: text(fd.get('lsGroup')),
          chapterName: text(fd.get('lsChapterName')),
          topic: text(fd.get('lsTopic')),
          title: text(fd.get('lsTitle'))
        },
        onClosed: () => void refresh()
      });
    });

    root.addEventListener('click', async ev => {
      const chip = ev.target.closest('[data-ls-status-chip]');
      if (chip) {
        uiState.status = chip.dataset.lsStatusChip;
        void refresh();
        return;
      }

      const btn = ev.target.closest('[data-ls-mgr-action]');
      if (!btn) return;
      const act = btn.dataset.lsMgrAction;
      const docId = btn.dataset.id || '';

      if (act === 'open-create') {
        uiState.createModalOpen = true;
        render();
        return;
      }
      if (act === 'close-create') {
        uiState.createModalOpen = false;
        render();
        return;
      }
      if (act === 'history') {
        uiState.historyRecordId = docId;
        render();
        return;
      }
      if (act === 'close-history') {
        uiState.historyRecordId = '';
        render();
        return;
      }
      if (act === 'restore-version') {
        try {
          const sdk = await loadStudioSdk();
          await restoreLectureSheetVersion(docId, Number(btn.dataset.ver), {
            role,
            actor: scope?.staff?.displayName || role,
            renderMath: sdk.renderLatexMathML
          });
          uiState.historyRecordId = '';
          toast('পূর্বের সংস্করণ সফলভাবে ফিরিয়ে আনা হয়েছে।');
          await refresh();
        } catch (err) {
          toast(err?.message || 'সংস্করণ ফিরিয়ে আনা যায়নি।', true);
        }
        return;
      }
      if (act === 'edit') {
        await openLectureSheetStudio({
          id: docId,
          role,
          toast,
          onClosed: () => void refresh()
        });
        return;
      }
      if (act === 'pdf') {
        const rec = sheets.find(s => s.id === docId) || contentById(docId);
        if (!rec) return;
        const orig = btn.textContent;
        btn.disabled = true;
        btn.textContent = '⏳ PDF…';
        try {
          const res = await downloadLectureSheetPDF(rec);
          toast(`${res.filename} ডাউনলোড প্রস্তুত।`);
        } catch (err) {
          toast(err?.message || 'PDF ডাউনলোড করা যায়নি।', true);
        } finally {
          btn.disabled = false;
          btn.textContent = orig;
        }
        return;
      }
      if (act === 'duplicate') {
        try {
          const copy = await duplicateLectureSheet(docId, { role, actor: scope?.staff?.displayName || role });
          toast(`${copy.title} তৈরি হয়েছে।`);
          await refresh();
        } catch (err) {
          toast(err?.message || 'কপি তৈরি করা যায়নি।', true);
        }
        return;
      }
      if (['publish', 'unpublish', 'archive', 'unarchive'].includes(act)) {
        try {
          await setLectureSheetLifecycle(docId, act, { role, actor: scope?.staff?.displayName || role });
          const messages = {
            publish: 'লেকচার শিট প্রকাশিত হয়েছে।',
            unpublish: 'লেকচার শিট খসড়ায় নেওয়া হয়েছে।',
            archive: 'লেকচার শিট সংরক্ষণাগারে নেওয়া হয়েছে।',
            unarchive: 'লেকচার শিট পুনরুদ্ধার করা হয়েছে।'
          };
          toast(messages[act]);
          await refresh();
        } catch (err) {
          toast(err?.message || 'অবস্থা পরিবর্তন করা যায়নি।', true);
        }
      }
    });

    window.addEventListener('apc-course-updated', () => {
      if (root.offsetParent !== null || !root.closest('[hidden]')) void refresh();
    });
  }

  await refresh();
  return { refresh };
}
