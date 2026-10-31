/* Active Plus Coaching — Lecture Sheet Structured Store, Recovery & Versioning.
 *
 * Integrates seamlessly with `courseContent` (`KEYS.courseContent`), preserving:
 *   - Primary Supabase + Firebase RTDB Dual-Cloud Sync (`js/sync-collections.js`)
 *   - Full-DB `AES-256-GCM` client-side encryption (`sync/cloud-payload-crypto.js`)
 *   - Admin encrypted backup/restore (`js/admin-data.js`)
 *   - Student Learning Hub (`js/course-hub.js` & `js/student-study-sections.js`)
 */

import { readRaw } from './database.js';
import { safeSetItem } from './storage-safety.js';
import { escapeHtml } from './sanitize.js';
import { classById, classByName, listClasses, subjectsForClass, listChapters as listAcademicChapters } from './academics.js';
import { assignedClasses, subjectsForTeacherClass, listTeacherAssignments, isTeacherAssignedSubject } from './teacher-assignments.js';
import { loadRoster } from './office-data.js';
import { sanitizeLectureHtml, isSafeLectureImageSrc } from './rich-sanitize.js';
import {
  COURSE_CONTENT_KEY,
  DEFAULT_LECTURE_PAGE_SETTINGS,
  normalizeLecturePageSettings,
  sanitizeLectureDocJson,
  verifyCourseStaffActor,
  contentById,
  saveCourseRecord,
  setContentPublished,
  archiveCourseRecord,
  deleteCourseRecord,
  announceCourseChange,
  typeOf
} from './course-content.js';

export const LECTURE_RECOVERY_KEY = 'activePlus.lectureDraftRecovery.v1';

const text = value => (typeof value === 'string' ? value.trim() : '');
const normKey = value => text(value).normalize('NFC').toLocaleLowerCase();
const groupNorm = value => normKey(value).replace(/\s*বিভাগ$/, '').trim();

function loadRawStoreRecords() {
  const raw = readRaw(COURSE_CONTENT_KEY);
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.records) ? parsed.records.filter(r => r && typeof r === 'object') : [];
  } catch {
    return [];
  }
}

/* ---- Structured ProseMirror JSON -> HTML & Plain Text ----------------------- */

function fallbackMathHtml(latex, displayMode = false) {
  const safe = escapeHtml(String(latex || '').trim());
  const tag = displayMode ? 'div' : 'span';
  return `<${tag} class="ls-math-expr" data-latex="${safe}" data-display="${displayMode ? 'true' : 'false'}"><math xmlns="http://www.w3.org/1998/Math/MathML" display="${displayMode ? 'block' : 'inline'}"><mtext>${safe}</mtext></math></${tag}>`;
}

function renderMarks(contentHtml, marks = []) {
  let out = contentHtml;
  if (!Array.isArray(marks)) return out;
  for (const mark of marks) {
    if (!mark || typeof mark.type !== 'string') continue;
    const attrs = mark.attrs || {};
    switch (mark.type) {
      case 'bold': out = `<strong>${out}</strong>`; break;
      case 'italic': out = `<em>${out}</em>`; break;
      case 'underline': out = `<u>${out}</u>`; break;
      case 'strike': out = `<s>${out}</s>`; break;
      case 'code': out = `<code>${out}</code>`; break;
      case 'subscript': out = `<sub>${out}</sub>`; break;
      case 'superscript': out = `<sup>${out}</sup>`; break;
      case 'highlight': {
        const bg = text(attrs.color);
        const style = bg && /^#[0-9a-fA-F]{3,8}$/.test(bg) ? ` style="background-color: ${bg}"` : '';
        out = `<mark${style}>${out}</mark>`;
        break;
      }
      case 'textStyle': {
        const styles = [];
        if (attrs.color && /^#[0-9a-fA-F]{3,8}$/.test(text(attrs.color))) styles.push(`color: ${text(attrs.color)}`);
        if (attrs.fontSize && /^\d{1,2}(?:\.\d+)?(?:pt|px)$/.test(text(attrs.fontSize))) styles.push(`font-size: ${text(attrs.fontSize)}`);
        if (attrs.fontFamily && /^[A-Za-z0-9\s,'"-]{1,80}$/.test(text(attrs.fontFamily))) styles.push(`font-family: ${escapeHtml(text(attrs.fontFamily))}`);
        if (styles.length) out = `<span style="${styles.join('; ')}">${out}</span>`;
        break;
      }
      case 'link': {
        const href = text(attrs.href);
        if (/^https?:\/\//i.test(href)) {
          out = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${out}</a>`;
        }
        break;
      }
      default: break;
    }
  }
  return out;
}

function blockStyleAttr(attrs = {}) {
  if (!attrs || typeof attrs !== 'object') return '';
  const styles = [];
  if (attrs.textAlign && /^(left|center|right|justify)$/.test(String(attrs.textAlign))) {
    styles.push(`text-align: ${attrs.textAlign}`);
  }
  if (attrs.lineHeight && /^(?:1(?:\.\d+)?|2(?:\.\d+)?)$/.test(String(attrs.lineHeight))) {
    styles.push(`line-height: ${attrs.lineHeight}`);
  }
  if (attrs.spaceAfter !== undefined && attrs.spaceAfter !== null && /^\d{1,2}$/.test(String(attrs.spaceAfter)) && Number(attrs.spaceAfter) > 0) {
    styles.push(`margin-bottom: ${Number(attrs.spaceAfter)}px`);
  }
  if (attrs.indent && Number(attrs.indent) > 0) {
    const level = Math.min(6, Math.max(0, Math.trunc(Number(attrs.indent))));
    if (level > 0) styles.push(`padding-left: ${level * 24}px`);
  }
  return styles.length ? ` style="${styles.join('; ')}"` : '';
}

function serializeNodeToHtml(node, renderMath) {
  if (!node || typeof node !== 'object') return '';
  const children = Array.isArray(node.content)
    ? node.content.map(child => serializeNodeToHtml(child, renderMath)).join('')
    : '';
  const attrs = node.attrs || {};

  switch (node.type) {
    case 'doc':
      return children;
    case 'text':
      return renderMarks(escapeHtml(node.text || ''), node.marks);
    case 'hardBreak':
      return '<br>';
    case 'paragraph':
      return `<p${blockStyleAttr(attrs)}>${children || '<br>'}</p>`;
    case 'heading': {
      const level = Math.min(4, Math.max(1, Number(attrs.level) || 2));
      return `<h${level}${blockStyleAttr(attrs)}>${children}</h${level}>`;
    }
    case 'bulletList':
      return `<ul>${children}</ul>`;
    case 'orderedList':
      return `<ol>${children}</ol>`;
    case 'listItem':
      return `<li>${children}</li>`;
    case 'blockquote':
      return `<blockquote>${children}</blockquote>`;
    case 'codeBlock':
      return `<pre><code>${children}</code></pre>`;
    case 'horizontalRule':
      return '<hr>';
    case 'pageBreak':
      return '<div class="ls-page-break" data-page-break="true"></div>';
    case 'mathEquation': {
      const latex = String(attrs.latex || '');
      const display = Boolean(attrs.display);
      if (typeof renderMath === 'function') {
        const mathMl = renderMath(latex, display);
        const tag = display ? 'div' : 'span';
        return `<${tag} class="ls-math-expr" data-latex="${escapeHtml(latex)}" data-display="${display ? 'true' : 'false'}">${mathMl}</${tag}>`;
      }
      return fallbackMathHtml(latex, display);
    }
    case 'image': {
      const src = text(attrs.src);
      if (!isSafeLectureImageSrc(src)) return '';
      const alt = escapeHtml(text(attrs.alt));
      const widthPct = [25, 50, 75, 100].includes(Number(attrs.widthPct)) ? Number(attrs.widthPct) : 75;
      const align = ['left', 'center', 'right'].includes(attrs.align) ? attrs.align : 'center';
      const figStyle = align === 'center' ? 'text-align: center' : (align === 'right' ? 'text-align: right' : 'text-align: left');
      const caption = text(attrs.caption);
      return `<figure class="ls-image-figure" style="${figStyle}"><img src="${escapeHtml(src)}" alt="${alt}" data-align="${align}" data-width-pct="${widthPct}" style="width: ${widthPct}%; max-width: 100%">${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}</figure>`;
    }
    case 'table':
      return `<table class="ls-doc-table"><tbody>${children}</tbody></table>`;
    case 'tableRow':
      return `<tr>${children}</tr>`;
    case 'tableHeader': {
      const colspan = Number(attrs.colspan) > 1 ? ` colspan="${Math.min(20, Number(attrs.colspan))}"` : '';
      const rowspan = Number(attrs.rowspan) > 1 ? ` rowspan="${Math.min(50, Number(attrs.rowspan))}"` : '';
      return `<th${colspan}${rowspan}>${children}</th>`;
    }
    case 'tableCell': {
      const colspan = Number(attrs.colspan) > 1 ? ` colspan="${Math.min(20, Number(attrs.colspan))}"` : '';
      const rowspan = Number(attrs.rowspan) > 1 ? ` rowspan="${Math.min(50, Number(attrs.rowspan))}"` : '';
      return `<td${colspan}${rowspan}>${children}</td>`;
    }
    default:
      return children;
  }
}

export function docJsonToHtml(docJson, { renderMath = null } = {}) {
  const cleanDoc = sanitizeLectureDocJson(docJson);
  const rawHtml = serializeNodeToHtml(cleanDoc, renderMath);
  return sanitizeLectureHtml(rawHtml);
}

export function docJsonToPlainText(docJson) {
  const parts = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'text' && typeof node.text === 'string') {
      parts.push(node.text);
      return;
    }
    if (node.type === 'mathEquation' && node.attrs?.latex) {
      parts.push(String(node.attrs.latex));
      return;
    }
    if (node.type === 'hardBreak') {
      parts.push('\n');
      return;
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
    }
    if (['paragraph', 'heading', 'listItem', 'blockquote', 'tableRow', 'codeBlock', 'pageBreak'].includes(node.type)) {
      parts.push('\n');
    } else if (['tableCell', 'tableHeader'].includes(node.type)) {
      parts.push('\t');
    }
  };
  walk(docJson);
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}

export function defaultStarterDocJson({ title = '', topic = '' } = {}) {
  const nodes = [];
  if (title) {
    nodes.push({
      type: 'heading',
      attrs: { level: 1, textAlign: 'left' },
      content: [{ type: 'text', text: title }]
    });
  }
  if (topic) {
    nodes.push({
      type: 'paragraph',
      attrs: { textAlign: 'left' },
      content: [{ type: 'text', marks: [{ type: 'italic' }], text: `আলোচ্য টপিক: ${topic}` }]
    });
  }
  nodes.push({ type: 'paragraph', content: [] });
  return { type: 'doc', content: nodes };
}

/* ---- Meaningful Filename Builder (Phase 6) ---------------------------------- */

const BN_WORD_MAP = Object.freeze([
  [/উচ্চতর\s*গণিত/gu, 'HigherMath'],
  [/পদার্থবিজ্ঞান/gu, 'Physics'],
  [/রসায়ন|রসায়ন/gu, 'Chemistry'],
  [/জীববিজ্ঞান/gu, 'Biology'],
  [/তথ্য\s*ও\s*যোগাযোগ\s*প্রযুক্তি/gu, 'ICT'],
  [/সাধারণ\s*বিজ্ঞান|বিজ্ঞান/gu, 'Science'],
  [/বাংলা/gu, 'Bangla'],
  [/ইংরেজি/gu, 'English'],
  [/গণিত/gu, 'Math'],
  [/হিসাববিজ্ঞান/gu, 'Accounting'],
  [/ফিন্যান্স/gu, 'Finance'],
  [/অর্থনীতি/gu, 'Economics'],
  [/পৌরনীতি/gu, 'Civics'],
  [/ইতিহাস/gu, 'History'],
  [/ভূগোল/gu, 'Geography'],
  [/একাদশ[\s-]*দ্বাদশ|এইচএসসি/gu, 'HSC'],
  [/একাদশ\s*শ্রেণি|একাদশ/gu, 'Class11'],
  [/দ্বাদশ\s*শ্রেণি|দ্বাদশ/gu, 'Class12'],
  [/দশম\s*শ্রেণি|দশম/gu, 'Class10'],
  [/নবম\s*শ্রেণি|নবম/gu, 'Class9'],
  [/অষ্টম\s*শ্রেণি|অষ্টম/gu, 'Class8'],
  [/সপ্তম\s*শ্রেণি|সপ্তম/gu, 'Class7'],
  [/ষষ্ঠ\s*শ্রেণি|ষষ্ঠ/gu, 'Class6'],
  [/শ্রেণি/gu, 'Class'],
  [/১ম\s*পত্র/gu, '1stPaper'],
  [/২য়\s*পত্র|২য়\s*পত্র/gu, '2ndPaper'],
  [/অধ্যায়|অধ্যায়/gu, 'Chapter'],
  [/লেকচার\s*শিট/gu, 'LectureSheet']
]);

const BN_CHAR_ROMAN = Object.freeze({
  'অ': 'o', 'আ': 'a', 'ই': 'i', 'ঈ': 'i', 'উ': 'u', 'ঊ': 'u', 'ঋ': 'ri', 'এ': 'e', 'ঐ': 'oi', 'ও': 'o', 'ঔ': 'ou',
  'া': 'a', 'ি': 'i', 'ী': 'i', 'ু': 'u', 'ূ': 'u', 'ৃ': 'ri', 'ে': 'e', 'ৈ': 'oi', 'ো': 'o', 'ৌ': 'ou',
  'ক': 'k', 'খ': 'kh', 'গ': 'g', 'ঘ': 'gh', 'ঙ': 'ng',
  'চ': 'ch', 'ছ': 'chh', 'জ': 'j', 'ঝ': 'jh', 'ঞ': 'n',
  'ট': 't', 'ঠ': 'th', 'ড': 'd', 'ঢ': 'dh', 'ণ': 'n',
  'ত': 't', 'থ': 'th', 'দ': 'd', 'ধ': 'dh', 'ন': 'n',
  'প': 'p', 'ফ': 'ph', 'ব': 'b', 'ভ': 'bh', 'ম': 'm',
  'য': 'j', 'র': 'r', 'ল': 'l', 'শ': 'sh', 'ষ': 'sh', 'স': 's', 'হ': 'h',
  'ড়': 'r', 'ঢ়': 'rh', 'য়': 'y', 'ৎ': 't', 'ং': 'ng', 'ঃ': 'h', 'ঁ': 'n', '্': '', '়': ''
});

function toAsciiSlug(raw, maxLen = 34) {
  let str = String(raw || '').normalize('NFC').trim();
  if (!str) return '';
  // Convert Bangla numerals ০-৯ -> 0-9
  str = str.replace(/[০-৯]/g, d => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
  for (const [pattern, replacement] of BN_WORD_MAP) {
    str = str.replace(pattern, ` ${replacement} `);
  }
  let out = '';
  for (const ch of str) {
    if (/[A-Za-z0-9]/.test(ch)) out += ch;
    else if (BN_CHAR_ROMAN[ch] !== undefined) out += BN_CHAR_ROMAN[ch];
    else out += '_';
  }
  return out
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLen)
    .replace(/_+$/g, '');
}

export function buildLecturePdfFilename(record = {}, dateOverride = '') {
  const rawDate = text(dateOverride) || (typeof record.updatedAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(record.updatedAt)
    ? record.updatedAt.slice(0, 10)
    : '');
  const stamp = rawDate || (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  const subject = toAsciiSlug(record.subjectName || record.subject, 24);
  const cls = toAsciiSlug(record.className || record.class, 18);
  const topicOrTitle = toAsciiSlug(record.topic || record.title, 32) || toAsciiSlug(record.id, 18) || 'LectureSheet';
  const segments = [subject, cls, topicOrTitle, stamp].filter(Boolean);
  return `${segments.join('_') || `LectureSheet_${stamp}`}.pdf`;
}

/* ---- Staff Scope & Chapter Helpers ------------------------------------------ */

export async function resolveLectureScope(role) {
  const staff = await verifyCourseStaffActor(role);
  const allClasses = listClasses();
  const classes = role === 'teacher'
    ? (assignedClasses(staff.username) || []).map(name => classByName(name)).filter(Boolean)
    : allClasses;

  const subjectsByClass = {};
  const groupsByClassSubject = {};
  const chaptersByClassSubject = {};
  const storeRecords = loadRawStoreRecords();

  for (const cls of classes) {
    const enabledSubjects = subjectsForClass(cls.name);
    const allowedSubjects = role === 'teacher'
      ? enabledSubjects.filter(sub => subjectsForTeacherClass(staff.username, cls.name).includes(sub.name))
      : enabledSubjects;
    subjectsByClass[cls.id] = allowedSubjects;

    for (const sub of allowedSubjects) {
      const key = `${cls.id}::${sub.id}`;
      if (role === 'teacher') {
        const subNorm = normKey(sub.name);
        const rows = listTeacherAssignments(staff.username).filter(item =>
          item.className === cls.name && (item.subjects || []).some(s => normKey(s) === subNorm)
        );
        const groups = [...new Set(rows.map(r => text(r.group)))];
        groupsByClassSubject[key] = groups.map(g => ({ value: g, label: g || 'সব ব্যাচ / পুরো শ্রেণি' }));
      } else {
        const rosterGroups = [...new Set(
          loadRoster()
            .filter(s => s.className === cls.name && s.status !== 'rejected')
            .map(s => text(s.group))
            .filter(Boolean)
        )];
        groupsByClassSubject[key] = [
          { value: '', label: 'সব ব্যাচ / পুরো শ্রেণি' },
          ...rosterGroups.map(g => ({ value: g, label: g }))
        ];
      }

      const contentChapters = storeRecords.filter(r =>
        typeOf(r) === 'chapter' && r.active !== false && r.classId === cls.id && r.subjectId === sub.id
      );
      const academicChaps = listAcademicChapters(cls.name, sub.name);
      chaptersByClassSubject[key] = {
        contentChapters,
        academicChapters: academicChaps
      };
    }
  }

  return {
    staff,
    classes,
    subjectsByClass,
    groupsByClassSubject,
    chaptersByClassSubject
  };
}

/** Ensures a chapter row exists in `courseContent` when an author picks an
 * Academic Setup chapter name or enters a custom chapter name, so Student Hub
 * groups the published Lecture Sheet cleanly under that chapter! */
export async function ensureLectureChapter({
  classId, subjectId, group = '', chapterId = '', chapterName = '', publishChapter = false
} = {}, { role = '', actor = '' } = {}) {
  const wantedId = text(chapterId);
  const wantedName = text(chapterName);
  const records = loadRawStoreRecords();

  if (wantedId) {
    const existingById = records.find(r => r.id === wantedId && typeOf(r) === 'chapter' && r.active !== false);
    if (existingById) {
      if (publishChapter && existingById.published !== true) {
        try {
          await setContentPublished(existingById.id, true, { role, actor });
        } catch { /* teacher may link an existing chapter created by manager */ }
      }
      return { chapterId: existingById.id, chapterName: existingById.title };
    }
  }

  if (!wantedName) return { chapterId: '', chapterName: '' };

  const matchByTitle = records.find(r =>
    typeOf(r) === 'chapter' &&
    r.active !== false &&
    r.classId === text(classId) &&
    r.subjectId === text(subjectId) &&
    (!group || !r.group || groupNorm(r.group) === groupNorm(group)) &&
    normKey(r.title) === normKey(wantedName)
  );
  if (matchByTitle) {
    if (publishChapter && matchByTitle.published !== true) {
      try {
        await setContentPublished(matchByTitle.id, true, { role, actor });
      } catch { /* keep existing chapter */ }
    }
    return { chapterId: matchByTitle.id, chapterName: matchByTitle.title };
  }

  const created = await saveCourseRecord({
    classId: text(classId),
    subjectId: text(subjectId),
    group: text(group),
    type: 'chapter',
    title: wantedName.slice(0, 160),
    description: '',
    content: '',
    published: Boolean(publishChapter),
    active: true
  }, { role, actor });
  return { chapterId: created.id, chapterName: created.title };
}

/* ---- Query, Save, Duplicate, Lifecycle & Version Restore -------------------- */

export async function listLectureSheets({
  classId = '',
  subjectId = '',
  status = 'all',
  search = '',
  includeLegacyLessons = false
} = {}, { role = '' } = {}) {
  const staff = await verifyCourseStaffActor(role);
  const needle = normKey(search);
  const records = loadRawStoreRecords();

  return records
    .filter(record => {
      if (typeOf(record) === 'chapter') return false;
      if (!record.isLectureSheet && !includeLegacyLessons) return false;

      const cls = classById(record.classId);
      const sub = cls ? subjectsForClass(cls.name).find(s => s.id === record.subjectId) : null;

      if (role === 'teacher') {
        if (!cls || !sub) return false;
        if (!isTeacherAssignedSubject(staff.username, cls.name, sub.name, record.group || '')) return false;
        if (record.published !== true && record.createdBy !== staff.displayName && record.createdBy !== staff.username) {
          return false;
        }
      }

      if (classId && record.classId !== classId) return false;
      if (subjectId && record.subjectId !== subjectId) return false;

      const recStatus = record.active === false ? 'archived' : (record.published === true ? 'published' : 'draft');
      if (status === 'all') {
        // Show all including archived when explicitly chosen, or keep active + drafts + published visible
      } else if (status !== recStatus) {
        return false;
      }

      if (needle) {
        const hay = [
          record.title, record.subtitle, record.topic, record.chapterName,
          record.className || cls?.name, record.subjectName || sub?.name,
          record.teacherName || record.createdBy, record.content, record.id
        ].map(normKey).join(' ');
        if (!hay.includes(needle)) return false;
      }
      return true;
    })
    .map(record => {
      const cls = classById(record.classId);
      const sub = cls ? subjectsForClass(cls.name).find(s => s.id === record.subjectId) : null;
      const chap = record.chapterId ? records.find(r => r.id === record.chapterId) : null;
      return {
        ...record,
        className: record.className || cls?.name || '',
        subjectName: record.subjectName || sub?.name || '',
        chapterName: record.chapterName || chap?.title || '',
        status: record.active === false ? 'archived' : (record.published === true ? 'published' : 'draft'),
        pageSettings: normalizeLecturePageSettings(record.pageSettings),
        docVersion: Math.max(1, Number(record.docVersion) || 1)
      };
    })
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
}

export async function saveLectureSheet(draft = {}, {
  role = '',
  actor = '',
  expectedVersion = null,
  recordHistory = false,
  forceOverwrite = false,
  renderMath = null
} = {}) {
  const staff = await verifyCourseStaffActor(role);
  const classRec = draft.classId ? classById(draft.classId) : classByName(draft.className || '');
  if (!classRec) throw new Error('শ্রেণি নির্বাচন করুন।');
  const customNameRaw = text(draft.customSubjectName || draft.subjectName);
  const incomingSubjectId = text(draft.subjectId);
  const isCustomDraft = Boolean(text(draft.customSubjectName)) || incomingSubjectId.startsWith('custom-');
  let subRec = subjectsForClass(classRec.name).find(s =>
    (draft.subjectId && s.id === draft.subjectId) || (draft.subjectName && s.name === draft.subjectName)
  );
  if (!subRec && isCustomDraft) {
    const customLabel = customNameRaw || incomingSubjectId.slice(7).replace(/-/g, ' ') || 'কাস্টম বিষয়';
    const slug = customLabel.normalize('NFC').toLocaleLowerCase('bn').replace(/[^a-z0-9\u0980-\u09FF]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'custom';
    const virtualId = incomingSubjectId.startsWith('custom-') ? incomingSubjectId : `custom-${slug}-${Date.now().toString(36).slice(-4)}`;
    subRec = { id: virtualId, name: customLabel.slice(0, 80) };
  }
  if (!subRec) throw new Error('বিষয় নির্বাচন করুন।');

  const isPublished = draft.status === 'published' || draft.published === true;
  const isArchived = draft.status === 'archived' || draft.active === false;

  const resolvedChapter = await ensureLectureChapter({
    classId: classRec.id,
    subjectId: subRec.id,
    group: text(draft.group),
    chapterId: text(draft.chapterId),
    chapterName: text(draft.chapterName),
    publishChapter: isPublished && !isArchived
  }, { role, actor: actor || staff.displayName });

  const cleanDoc = sanitizeLectureDocJson(draft.docJson);
  const richContent = draft.richContent
    ? sanitizeLectureHtml(draft.richContent)
    : docJsonToHtml(cleanDoc, { renderMath });
  const plainText = draft.content !== undefined && text(draft.content)
    ? text(draft.content)
    : docJsonToPlainText(cleanDoc);
  const pageSettings = normalizeLecturePageSettings(draft.pageSettings);

  const saved = await saveCourseRecord({
    id: text(draft.id),
    isLectureSheet: true,
    classId: classRec.id,
    className: classRec.name,
    subjectId: subRec.id,
    subjectName: subRec.name,
    group: text(draft.group),
    chapterId: resolvedChapter.chapterId,
    chapterName: resolvedChapter.chapterName || text(draft.chapterName),
    topic: text(draft.topic),
    title: text(draft.title),
    subtitle: text(draft.subtitle),
    description: text(draft.description || draft.subtitle || draft.topic).slice(0, 600),
    type: ['lesson', 'note', 'suggestion', 'important_question', 'model_test', 'previous_question'].includes(draft.type)
      ? draft.type
      : 'lesson',
    teacherId: text(draft.teacherId) || staff.staffId,
    teacherName: text(draft.teacherName) || staff.displayName,
    docJson: cleanDoc,
    richContent,
    content: plainText,
    pageSettings,
    published: isArchived ? false : isPublished,
    active: !isArchived
  }, {
    role,
    actor: actor || staff.displayName,
    expectedVersion: forceOverwrite ? null : expectedVersion,
    recordHistory
  });

  clearLectureRecovery(staff, saved.id);
  if (!draft.id) clearLectureRecovery(staff, 'new');
  announceCourseChange({ id: saved.id, role, kind: 'lecture-sheet' });
  return saved;
}

export async function duplicateLectureSheet(id, { role = '', actor = '' } = {}) {
  const staff = await verifyCourseStaffActor(role);
  const source = contentById(id);
  if (!source) throw new Error('লেকচার শিটটি পাওয়া যায়নি।');
  const copyTitle = `${text(source.title).slice(0, 145)} (কপি)`;
  const duplicated = await saveCourseRecord({
    isLectureSheet: true,
    classId: source.classId,
    className: source.className || '',
    subjectId: source.subjectId,
    subjectName: source.subjectName || '',
    group: source.group || '',
    chapterId: source.chapterId || '',
    chapterName: source.chapterName || '',
    topic: source.topic || '',
    title: copyTitle,
    subtitle: source.subtitle || '',
    description: source.description || '',
    type: typeOf(source) === 'chapter' ? 'lesson' : typeOf(source),
    teacherId: staff.staffId,
    teacherName: staff.displayName,
    docJson: source.docJson || defaultStarterDocJson({ title: copyTitle, topic: source.topic }),
    richContent: source.richContent || '',
    content: source.content || '',
    pageSettings: normalizeLecturePageSettings(source.pageSettings),
    published: false,
    active: true,
    history: []
  }, { role, actor: actor || staff.displayName });

  announceCourseChange({ id: duplicated.id, role, kind: 'lecture-sheet-duplicate' });
  return duplicated;
}

export async function setLectureSheetLifecycle(id, action, { role = '', actor = '' } = {}) {
  const current = contentById(id);
  if (!current) throw new Error('লেকচার শিটটি পাওয়া যায়নি।');
  let saved = null;
  if (action === 'publish') {
    if (current.chapterId) {
      const chap = contentById(current.chapterId);
      if (chap && chap.published !== true) {
        try { await setContentPublished(chap.id, true, { role, actor }); } catch { /* ignore */ }
      }
    }
    saved = await setContentPublished(id, true, { role, actor });
  } else if (action === 'unpublish') {
    saved = await setContentPublished(id, false, { role, actor });
  } else if (action === 'archive') {
    saved = await archiveCourseRecord(id, { role, actor, restore: false });
  } else if (action === 'unarchive') {
    saved = await archiveCourseRecord(id, { role, actor, restore: true });
  } else {
    throw new Error('অজানা অ্যাকশন।');
  }
  if (saved) announceCourseChange({ id: saved.id, role, kind: `lecture-sheet-${action}` });
  return saved;
}

export async function deleteLectureSheet(id, { role = '', actor = '' } = {}) {
  const current = contentById(id);
  if (!current) throw new Error('লেকচার শিটটি পাওয়া যায়নি।');
  const result = await deleteCourseRecord(id, { role, actor });
  if (result) announceCourseChange({ id, role, kind: 'lecture-sheet-delete' });
  return result;
}

export async function restoreLectureSheetVersion(id, versionNumber, { role = '', actor = '', renderMath = null } = {}) {
  const current = contentById(id);
  if (!current || !current.isLectureSheet) throw new Error('লেকচার শিটটি পাওয়া যায়নি।');
  const entry = (current.history || []).find(item => Number(item.version) === Number(versionNumber));
  if (!entry) throw new Error('নির্বাচিত সংস্করণটি ইতিহাসে পাওয়া যায়নি।');
  if (!entry.docJson) throw new Error('এই পুরোনো সংস্করণের পূর্ণ স্ট্রাকচার সংরক্ষিত নেই।');

  return saveLectureSheet({
    ...current,
    id: current.id,
    title: entry.title || current.title,
    subtitle: entry.subtitle ?? current.subtitle,
    topic: entry.topic ?? current.topic,
    docJson: entry.docJson,
    richContent: '',
    content: '',
    pageSettings: entry.pageSettings || current.pageSettings,
    status: current.active === false ? 'archived' : (current.published ? 'published' : 'draft')
  }, {
    role,
    actor,
    recordHistory: true,
    forceOverwrite: true,
    renderMath
  });
}

/* ---- Local Crash / Offline Unsaved Draft Recovery --------------------------- */

function recoverySlotKey(staff, docId) {
  const who = text(staff?.username || staff?.role || 'staff');
  const target = text(docId) || 'new';
  return `${who}::${target}`;
}

function readRecoveryMap() {
  try {
    const raw = globalThis.localStorage?.getItem(LECTURE_RECOVERY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function saveLectureRecovery(staff, docId, snapshot = {}) {
  try {
    const map = readRecoveryMap();
    const slot = recoverySlotKey(staff, docId);
    map[slot] = {
      savedAt: Date.now(),
      docId: text(docId) || 'new',
      baseVersion: Number(snapshot.baseVersion) || 0,
      draft: {
        id: text(snapshot.id),
        classId: text(snapshot.classId),
        subjectId: text(snapshot.subjectId),
        group: text(snapshot.group),
        chapterId: text(snapshot.chapterId),
        chapterName: text(snapshot.chapterName),
        topic: text(snapshot.topic),
        title: text(snapshot.title),
        subtitle: text(snapshot.subtitle),
        type: text(snapshot.type) || 'lesson',
        pageSettings: normalizeLecturePageSettings(snapshot.pageSettings),
        docJson: sanitizeLectureDocJson(snapshot.docJson)
      }
    };
    // Keep at most 8 local recovery slots so localStorage stays compact
    const entries = Object.entries(map).sort((a, b) => (b[1]?.savedAt || 0) - (a[1]?.savedAt || 0)).slice(0, 8);
    safeSetItem(globalThis.localStorage, LECTURE_RECOVERY_KEY, JSON.stringify(Object.fromEntries(entries)));
    return true;
  } catch {
    return false;
  }
}

export function loadLectureRecovery(staff, docId) {
  const map = readRecoveryMap();
  const entry = map[recoverySlotKey(staff, docId)] || null;
  if (!entry || !entry.draft) return null;
  return entry;
}

export function clearLectureRecovery(staff, docId) {
  try {
    const map = readRecoveryMap();
    const slot = recoverySlotKey(staff, docId);
    if (!(slot in map)) return;
    delete map[slot];
    safeSetItem(globalThis.localStorage, LECTURE_RECOVERY_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}
