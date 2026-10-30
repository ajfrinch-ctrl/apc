/* Yellow Pages Phonebook (ফোনবুক · ইয়েলো পেইজ) — shared directory module for
   both the Admin Panel (admin.html) and Manager Panel (manager.html).

   Features:
     • Class-organized Student + Guardian directory (mobile & guardianMobile)
       with canonical class ordering, class index pills, status filters, and
       instant Bangla/English search across name, ID, guardian, class & phone.
     • Dedicated Staff directory tab grouped by role (Admin, Manager, Teacher,
       Cash Counter, Other Staff) with teacher class/subject assignments.
     • One-tap Direct Call (strictly validated tel:+8801...), Copy number,
       Direct WhatsApp chat (wa.me/8801...), and an interactive Bengali
       WhatsApp Draft Composer (অনুপস্থিতি, বকেয়া ফি with live due amount,
       পরীক্ষার ফলাফল, জরুরি ক্লাস নোটিশ, ও স্টাফ সমন্বয় বার্তা). */

import { loadRoster } from './office-data.js';
import { listStaff, STAFF_ROLE_META, staffRoleLabel, staffStatusLabel } from './staff-directory.js';
import { listTeacherAssignments } from './teacher-assignments.js';
import { financeRepository, studentFeeSummary } from './finance-data.js';
import { EXAM_CLASS_CODES } from './academics.js';
import { latinDigits, searchText } from './student-search.js';
import { escapeHtml } from './sanitize.js';
import { iconMarkup } from './icons.js';

const BANGLA_DIGITS = '০১২৩৪৫৬৭৮৯';
export const toBnDigits = value => String(value ?? '').replace(/\d/g, d => BANGLA_DIGITS[Number(d)]);

const BD_LOCAL_PHONE_RE = /^01[3-9]\d{8}$/;
const UNASSIGNED_CLASS = 'শ্রেণি অনির্ধারিত';

const CLASS_ORDER = Object.freeze(Object.keys(EXAM_CLASS_CODES));
const ROLE_ORDER = Object.freeze(['admin', 'manager', 'teacher', 'cash-counter', 'other']);

const STUDENT_STATUS_META = Object.freeze({
  approved: { label: 'সক্রিয়', badgeClass: 'badge-approved', rank: 1 },
  pending: { label: 'অপেক্ষমাণ', badgeClass: 'badge-pending', rank: 2 },
  inactive: { label: 'নিষ্ক্রিয়', badgeClass: 'badge-neutral', rank: 3 },
  rejected: { label: 'বাতিল', badgeClass: 'badge-rejected', rank: 4 }
});

/* Privacy (owner decision 2026-10-29): identity is readable, contact numbers
   are not. A directory is useless when every row says “গোপন তথ্য” — search by
   name returned rows nobody could tell apart — so the name, class, group,
   guardian, ID and dues show plainly and only the phone numbers stay masked.
   Each row has a “নম্বর দেখান” control, and the toolbar can reveal them all at
   once for a calling round; the reveal lives in memory only, so a reload hides
   them again. The call / WhatsApp / copy buttons keep working while masked,
   because using a number is a deliberate act. */
const PRIVACY_MASK = '•••• ••••';

const graphemeSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('bn', { granularity: 'grapheme' })
  : null;

export function phonebookInitials(name) {
  /* Only words that start with a letter or digit count: an account label such
     as “সিস্টেম মালিক (এডমিন)” must not produce a “(” avatar. */
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .map(word => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
  if (!parts.length) return 'শিক্ষা';
  const firstGrapheme = word => {
    if (!graphemeSegmenter) return word.slice(0, 2);
    const iter = graphemeSegmenter.segment(word)[Symbol.iterator]();
    return iter.next().value?.segment || '';
  };
  /* One glyph-cluster from the first and the last word: “রাইসা ইসলাম” → রাই.
     Each side is exactly one grapheme, so the 44px disc never overflows. */
  const initials = parts.length === 1
    ? firstGrapheme(parts[0])
    : firstGrapheme(parts[0]) + firstGrapheme(parts[parts.length - 1]);
  return initials.toUpperCase();
}

/**
 * Strictly normalizes and validates a Bangladesh mobile number in Bangla or
 * ASCII digits. Never permits arbitrary characters into `tel:` or `wa.me` URLs.
 */
export function normalizeBdPhone(raw) {
  const empty = { valid: false, local: '', e164: '', waDigits: '', formattedEn: '', formattedBn: '' };
  if (raw === null || raw === undefined) return empty;
  let digits = latinDigits(String(raw)).replace(/[\s()\-._/]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('00880')) digits = `0${digits.slice(5)}`;
  else if (digits.startsWith('880') && digits.length === 13) digits = `0${digits.slice(3)}`;
  else if (/^1[3-9]\d{8}$/.test(digits)) digits = `0${digits}`;

  if (!BD_LOCAL_PHONE_RE.test(digits)) return empty;
  const formattedEn = `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return {
    valid: true,
    local: digits,
    e164: `+88${digits}`,
    waDigits: `88${digits}`,
    formattedEn,
    formattedBn: toBnDigits(formattedEn)
  };
}

/** Safe `tel:` URI — returns empty string unless strict `+8801[3-9]\d{8}` holds. */
export function buildTelHref(raw) {
  const norm = normalizeBdPhone(raw);
  return norm.valid ? `tel:${norm.e164}` : '';
}

/** Safe `https://wa.me/` URL with optional pre-encoded Bengali message text. */
export function buildWhatsappUrl(raw, messageText = '') {
  const norm = normalizeBdPhone(raw);
  if (!norm.valid) return '';
  const cleanText = String(messageText ?? '').trim();
  if (!cleanText) return `https://wa.me/${norm.waDigits}`;
  return `https://wa.me/${norm.waDigits}?text=${encodeURIComponent(cleanText)}`;
}

export const STUDENT_DRAFT_TEMPLATES = Object.freeze([
  { id: 'absence', label: 'অনুপস্থিতি' },
  { id: 'due', label: 'বকেয়া ফি' },
  { id: 'result', label: 'পরীক্ষার ফলাফল' },
  { id: 'schedule', label: 'ক্লাস নোটিশ' },
  { id: 'direct', label: 'খালি চ্যাট' }
]);

export const STAFF_DRAFT_TEMPLATES = Object.freeze([
  { id: 'class_coord', label: 'ক্লাস সমন্বয়' },
  { id: 'office_notice', label: 'অফিস বার্তা' },
  { id: 'direct', label: 'খালি চ্যাট' }
]);

/**
 * Generates ready-made Bengali WhatsApp message text tailored to whether the
 * recipient is the Guardian (`recipientKind === 'guardian'`), Student
 * (`'student'`), or Staff (`'staff'`).
 */
export function buildPhonebookDraftText(templateId, context = {}) {
  if (!templateId || templateId === 'direct') return '';
  const institute = String(context.instituteName || 'Active Plus Coaching').trim();
  const recipientKind = context.recipientKind || 'guardian';

  if (recipientKind === 'staff') {
    const staffName = String(context.name || 'সহকর্মী').trim();
    const roleText = context.roleLabel ? ` (${context.roleLabel})` : '';
    if (templateId === 'class_coord') {
      return `আসসালামু আলাইকুম ${staffName}${roleText}। ${institute}-এর আজকের ক্লাস ও রুটিন সমন্বয়ের বিষয়ে আপনার সাথে একটু কথা বলতে চাচ্ছিলাম।`;
    }
    if (templateId === 'office_notice') {
      return `আসসালামু আলাইকুম ${staffName}। ${institute} অফিস থেকে জরুরি একটি প্রাতিষ্ঠানিক বিষয়ে আপনার দৃষ্টি আকর্ষণ করছি। সুবিধাজনক সময়ে অনুগ্রহ করে জানাবেন।`;
    }
    return '';
  }

  const studentName = String(context.name || 'শিক্ষার্থী').trim();
  const className = String(context.className || '').trim();
  const group = String(context.group || '').trim();
  const classInfo = className
    ? ` (${className}${group ? ` · ${group}` : ''})`
    : '';
  const dueAmount = Number(context.dueAmount || 0);
  const dueMonth = String(context.dueMonth || '').trim();
  const isGuardian = recipientKind === 'guardian';
  const subjectRef = isGuardian ? `আপনার সন্তান ${studentName}${classInfo}` : `${studentName}${classInfo}`;

  switch (templateId) {
    case 'absence':
      return isGuardian
        ? `আসসালামু আলাইকুম। ${institute} থেকে জানানো যাচ্ছে যে ${subjectRef} আজকের নির্ধারিত ক্লাসে অনুপস্থিত ছিল। অনুগ্রহ করে অনুপস্থিতির কারণটি জানালে কৃতজ্ঞ থাকব।`
        : `আসসালামু আলাইকুম ${studentName}। ${institute} থেকে জানানো যাচ্ছে যে তুমি আজ${classInfo} নির্ধারিত ক্লাসে উপস্থিত ছিলে না। আগামী ক্লাসে যথাসময়ে উপস্থিত থাকার অনুরোধ রইল।`;
    case 'due': {
      if (dueAmount > 0) {
        const formattedDue = `৳${toBnDigits(dueAmount.toLocaleString('en-US'))}`;
        const monthPart = dueMonth ? ` (${dueMonth})` : '';
        return isGuardian
          ? `আসসালামু আলাইকুম। ${institute} থেকে বিনীতভাবে জানানো যাচ্ছে যে ${subjectRef}-এর মাসিক টিউশন ফি বাবদ${monthPart} বর্তমান বকেয়া ${formattedDue}। সুবিধাজনক সময়ে পরিশোধ করার জন্য অনুরোধ করা হলো।`
          : `আসসালামু আলাইকুম ${studentName}। ${institute} থেকে জানানো যাচ্ছে যে তোমার মাসিক টিউশন ফি বাবদ${monthPart} বর্তমান বকেয়া ${formattedDue}। সুবিধাজনক সময়ে অফিসে যোগাযোগ করার অনুরোধ রইল।`;
      }
      return isGuardian
        ? `আসসালামু আলাইকুম। ${institute} থেকে বিনীতভাবে জানানো যাচ্ছে যে ${subjectRef}-এর মাসিক টিউশন ফি পরিশোধের বিষয়ে অফিসে যোগাযোগ করার অনুরোধ রইল।`
        : `আসসালামু আলাইকুম ${studentName}। ${institute}-এর মাসিক টিউশন ফি পরিশোধের বিষয়ে সুবিধাজনক সময়ে অফিসে যোগাযোগ করার অনুরোধ রইল।`;
    }
    case 'result':
      return isGuardian
        ? `আসসালামু আলাইকুম। ${institute} থেকে আনন্দের সাথে জানানো যাচ্ছে যে ${subjectRef}-এর সাম্প্রতিক পরীক্ষার ফলাফল প্রকাশিত হয়েছে। স্টুডেন্ট পোর্টাল থেকে ফলাফল ও অগ্রগতি দেখে নেওয়ার অনুরোধ রইল।`
        : `আসসালামু আলাইকুম ${studentName}। ${institute}-এ তোমার সাম্প্রতিক পরীক্ষার ফলাফল প্রকাশিত হয়েছে। পোর্টালে লগইন করে ফলাফলটি দেখে নাও এবং পরবর্তী পরীক্ষার প্রস্তুতি চালিয়ে যাও।`;
    case 'schedule':
      return isGuardian
        ? `আসসালামু আলাইকুম। ${institute} থেকে জরুরি ক্লাস ও সময়সূচি সংক্রান্ত বিজ্ঞপ্তি (${studentName}${classInfo}): অনুগ্রহ করে অ্যাপের নোটিশ বোর্ড বা রুটিন অংশটি এক নজর দেখে নেবেন।`
        : `আসসালামু আলাইকুম ${studentName}। ${institute} থেকে জরুরি ক্লাস ও রুটিন সংক্রান্ত আপডেট দেওয়া হয়েছে। অনুগ্রহ করে পোর্টালের নোটিশ বোর্ড বা রুটিন দেখে নাও।`;
    default:
      return '';
  }
}

function packedDigitsOrText(value) {
  return searchText(value).replace(/[\s()+\-._/]/g, '');
}

export function matchesPhonebookStudent(student, query) {
  if (!student) return false;
  const q = searchText(query);
  if (!q) return true;
  const compact = packedDigitsOrText(query);
  const fields = [
    student.id,
    student.name,
    student.nameEn,
    student.fatherName,
    student.className,
    student.group,
    student.mobile,
    student.guardianMobile
  ];
  return fields.some(val => {
    const norm = searchText(val);
    if (!norm) return false;
    return norm.includes(q) || (compact && packedDigitsOrText(val).includes(compact));
  });
}

export function matchesPhonebookStaff(staff, query, assignmentSummary = '') {
  if (!staff) return false;
  const q = searchText(query);
  if (!q) return true;
  const compact = packedDigitsOrText(query);
  const fields = [
    staff.staffId,
    staff.fullName,
    staff.username,
    staff.role,
    staffRoleLabel(staff.role),
    staff.mobile,
    staff.email,
    staff.notes,
    assignmentSummary
  ];
  return fields.some(val => {
    const norm = searchText(val);
    if (!norm) return false;
    return norm.includes(q) || (compact && packedDigitsOrText(val).includes(compact));
  });
}

function classSortRank(className) {
  if (!className || className === UNASSIGNED_CLASS) return 999;
  const idx = CLASS_ORDER.indexOf(className);
  return idx === -1 ? 500 : idx;
}

/**
 * Filters and groups student roster records into Yellow Pages class sections.
 */
export function groupStudentsForYellowPages(students, {
  query = '',
  classFilter = 'all',
  statusFilter = 'all'
} = {}) {
  const list = Array.isArray(students) ? students : [];
  const activePool = list.filter(s => s && s.status !== 'rejected');

  const classCounts = new Map();
  for (const s of activePool) {
    if (statusFilter !== 'all' && s.status !== statusFilter) continue;
    if (!matchesPhonebookStudent(s, query)) continue;
    const cls = String(s.className || '').trim() || UNASSIGNED_CLASS;
    classCounts.set(cls, (classCounts.get(cls) || 0) + 1);
  }

  const orderedClasses = [...classCounts.keys()].sort((a, b) => {
    const diff = classSortRank(a) - classSortRank(b);
    return diff !== 0 ? diff : a.localeCompare(b, 'bn');
  });

  const filtered = activePool.filter(s => {
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    const cls = String(s.className || '').trim() || UNASSIGNED_CLASS;
    if (classFilter !== 'all' && cls !== classFilter) return false;
    return matchesPhonebookStudent(s, query);
  });

  const groupedMap = new Map();
  for (const student of filtered) {
    const cls = String(student.className || '').trim() || UNASSIGNED_CLASS;
    if (!groupedMap.has(cls)) groupedMap.set(cls, []);
    groupedMap.get(cls).push(student);
  }

  const groups = [...groupedMap.entries()]
    .sort(([a], [b]) => {
      const diff = classSortRank(a) - classSortRank(b);
      return diff !== 0 ? diff : a.localeCompare(b, 'bn');
    })
    .map(([className, items]) => {
      items.sort((a, b) => {
        const rankA = STUDENT_STATUS_META[a.status]?.rank ?? 9;
        const rankB = STUDENT_STATUS_META[b.status]?.rank ?? 9;
        if (rankA !== rankB) return rankA - rankB;
        return String(a.name || '').localeCompare(String(b.name || ''), 'bn');
      });
      return {
        className,
        classCode: EXAM_CLASS_CODES[className] || 'YP',
        students: items
      };
    });

  return {
    groups,
    totalMatched: filtered.length,
    classPills: orderedClasses.map(cls => ({
      className: cls,
      classCode: EXAM_CLASS_CODES[cls] || 'YP',
      count: classCounts.get(cls) || 0
    }))
  };
}

/**
 * Counts unique valid phone numbers across students + guardians.
 */
export function countDirectoryPhones(students = [], staff = []) {
  const studentPhones = new Set();
  for (const s of (Array.isArray(students) ? students : [])) {
    if (!s || s.status === 'rejected') continue;
    const m = normalizeBdPhone(s.mobile);
    const g = normalizeBdPhone(s.guardianMobile);
    if (m.valid) studentPhones.add(m.local);
    if (g.valid) studentPhones.add(g.local);
  }
  const staffPhones = new Set();
  for (const st of (Array.isArray(staff) ? staff : [])) {
    if (!st || st.status === 'suspended') continue;
    const m = normalizeBdPhone(st.mobile);
    if (m.valid) staffPhones.add(m.local);
  }
  return {
    studentPhoneCount: studentPhones.size,
    staffPhoneCount: staffPhones.size
  };
}

function openExternalWhatsapp(url) {
  if (!url) return false;
  if (typeof window !== 'undefined' && typeof window.open === 'function') {
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    if (win) win.opener = null;
    return true;
  }
  return false;
}

async function copyTextSafe(text) {
  const val = String(text || '').trim();
  if (!val) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(val);
      return true;
    }
  } catch { /* fallback below */ }
  try {
    const area = document.createElement('textarea');
    area.value = val;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand?.('copy') !== false;
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

const mountedInstances = new WeakMap();

/**
 * Mounts or refreshes the Yellow Pages Phonebook inside `mount`.
 */
export async function mountPhonebook(mount, options = {}) {
  if (!mount) return null;
  const existing = mountedInstances.get(mount);
  if (existing) {
    existing.updateOptions(options);
    await existing.refresh();
    return existing;
  }

  const state = {
    portal: options.portal || 'admin',
    tab: 'students', // 'students' | 'staff'
    query: '',
    classFilter: 'all',
    statusFilter: 'all',
    roleFilter: 'all',
    collapsedClasses: new Set(),
    openDraftKey: '', // e.g. 'student:AP-1024:guardian'
    draftTemplate: 'absence',
    draftCustomText: '',
    draftDirty: false,
    /* Which contact rows show their number, and the toolbar's reveal-all
       switch. Memory only — never stored, so a reload re-masks. */
    revealedPhones: new Set(),
    revealAllPhones: false,
    students: [],
    staff: [],
    transactions: [],
    opts: { ...options }
  };

  const notify = (msg, isError = false) => {
    if (typeof state.opts.onToast === 'function') {
      state.opts.onToast(msg, isError);
      return;
    }
    const fallbackToast = document.querySelector('#toast, #managerToast');
    if (fallbackToast) {
      fallbackToast.textContent = msg;
      fallbackToast.hidden = false;
      fallbackToast.classList.add('show');
      clearTimeout(notify._t);
      notify._t = setTimeout(() => {
        fallbackToast.classList.remove('show');
        fallbackToast.hidden = true;
      }, 2600);
    }
  };

  async function loadLiveData() {
    try {
      state.students = typeof state.opts.getStudents === 'function'
        ? (state.opts.getStudents() || loadRoster())
        : loadRoster();
    } catch {
      state.students = [];
    }
    try {
      state.staff = typeof state.opts.getStaff === 'function'
        ? await state.opts.getStaff()
        : await listStaff();
    } catch {
      state.staff = [];
    }
    try {
      state.transactions = typeof state.opts.getTransactions === 'function'
        ? await state.opts.getTransactions()
        : await financeRepository.listTransactions();
    } catch {
      state.transactions = [];
    }
  }

  function renderContactLine({
    rowKey,
    badgeLabel,
    badgeTone = 'student',
    personSub = '',
    rawPhone = '',
    sameAsPrimary = false,
    draftContext
  }) {
    const norm = normalizeBdPhone(rawPhone);
    const isDraftOpen = state.openDraftKey === rowKey;
    const templates = draftContext.recipientKind === 'staff'
      ? STAFF_DRAFT_TEMPLATES
      : STUDENT_DRAFT_TEMPLATES;

    if (!norm.valid) {
      return `
        <div class="yp-contact-line is-missing" data-yp-contact-key="${escapeHtml(rowKey)}">
          <div class="yp-contact-meta">
            <span class="yp-role-pill is-${escapeHtml(badgeTone)}">${escapeHtml(badgeLabel)}</span>
            <span class="yp-missing-phone">${rawPhone ? `অবৈধ নম্বর (${escapeHtml(String(rawPhone))})` : 'নম্বর যুক্ত নেই'}</span>
          </div>
        </div>`;
    }

    const telHref = buildTelHref(norm.local);
    const numberShown = state.revealAllPhones || state.revealedPhones.has(rowKey);
    const activeTemplate = templates.some(t => t.id === state.draftTemplate)
      ? state.draftTemplate
      : templates[0].id;
    const computedDraft = state.draftDirty && isDraftOpen
      ? state.draftCustomText
      : buildPhonebookDraftText(activeTemplate, draftContext);

    return `
      <div class="yp-contact-line is-${escapeHtml(badgeTone)}${isDraftOpen ? ' is-draft-open' : ''}" data-yp-contact-key="${escapeHtml(rowKey)}" data-yp-phone="${escapeHtml(norm.local)}">
        <div class="yp-contact-top">
          <div class="yp-contact-meta">
            <span class="yp-role-pill is-${escapeHtml(badgeTone)}">${escapeHtml(badgeLabel)}</span>
            ${personSub ? `<span class="yp-contact-person">${escapeHtml(personSub)}</span>` : ''}
            ${sameAsPrimary ? '<span class="yp-same-note">একই নম্বর</span>' : ''}
          </div>
          ${numberShown
            ? `<a class="yp-phone-number" href="${escapeHtml(telHref)}" aria-label="${escapeHtml(badgeLabel)} ${escapeHtml(norm.formattedBn)} নম্বরে কল করুন">${escapeHtml(norm.formattedBn)} <small>(${escapeHtml(norm.formattedEn)})</small></a>
               <button class="yp-reveal-btn is-hide" type="button" data-yp-action="hide-phone" data-yp-row="${escapeHtml(rowKey)}" aria-label="${escapeHtml(badgeLabel)} নম্বর লুকান">নম্বর লুকান</button>`
            : `<span class="yp-phone-number is-masked" aria-label="নম্বর লুকানো আছে">${escapeHtml(PRIVACY_MASK)}</span>
               <button class="yp-reveal-btn" type="button" data-yp-action="reveal-phone" data-yp-row="${escapeHtml(rowKey)}" aria-label="${escapeHtml(badgeLabel)} নম্বর দেখান">নম্বর দেখান</button>`}
        </div>
        <div class="yp-action-row" role="group" aria-label="${escapeHtml(badgeLabel)} যোগাযোগের মাধ্যম">
          <a class="yp-action-btn is-call" href="${escapeHtml(telHref)}" aria-label="${escapeHtml(draftContext.name || '')} (${escapeHtml(badgeLabel)}) কল করুন">
            ${iconMarkup('phone', 'yp-btn-icon', { variant: 'glyph' })}
            <span>কল</span>
          </a>
          <button class="yp-action-btn is-wa" type="button" data-yp-action="wa-direct" data-yp-phone="${escapeHtml(norm.local)}" aria-label="${escapeHtml(draftContext.name || '')} (${escapeHtml(badgeLabel)}) সরাসরি WhatsApp খুলুন">
            ${iconMarkup('whatsapp', 'yp-btn-icon', { variant: 'glyph' })}
            <span>WhatsApp</span>
          </button>
          <button class="yp-action-btn is-draft${isDraftOpen ? ' is-active' : ''}" type="button" data-yp-action="toggle-draft" data-yp-row="${escapeHtml(rowKey)}" aria-expanded="${isDraftOpen ? 'true' : 'false'}">
            ${iconMarkup('chat', 'yp-btn-icon', { variant: 'glyph' })}
            <span>ড্রাফট বার্তা</span>
          </button>
          <button class="yp-action-btn is-copy" type="button" data-yp-action="copy-phone" data-yp-phone="${escapeHtml(norm.local)}" aria-label="${escapeHtml(norm.local)} নম্বর কপি করুন">
            ${iconMarkup('copy', 'yp-btn-icon', { variant: 'glyph' })}
            <span>কপি</span>
          </button>
        </div>
        ${isDraftOpen ? `
          <div class="yp-draft-tray" data-yp-draft-tray="${escapeHtml(rowKey)}">
            <div class="yp-draft-head">
              <strong>প্রস্তুতকৃত বাংলা WhatsApp বার্তা</strong>
              <button class="yp-draft-close" type="button" data-yp-action="close-draft" aria-label="ড্রাফট বন্ধ করুন">✕</button>
            </div>
            <div class="yp-template-chips" role="tablist" aria-label="বার্তার ধরন নির্বাচন">
              ${templates.map(tpl => `
                <button class="yp-tpl-chip${tpl.id === activeTemplate ? ' is-active' : ''}" type="button" role="tab" aria-selected="${tpl.id === activeTemplate ? 'true' : 'false'}" data-yp-action="pick-template" data-yp-template="${escapeHtml(tpl.id)}" data-yp-row="${escapeHtml(rowKey)}">${escapeHtml(tpl.label)}</button>
              `).join('')}
            </div>
            <label class="yp-draft-field">
              <span class="sr-only">বার্তার বিষয়বস্তু সম্পাদনা করুন</span>
              <textarea class="yp-draft-textarea" rows="3" data-yp-draft-input="${escapeHtml(rowKey)}" placeholder="সরাসরি খালি চ্যাট খুলতে নিচের বাটনে ট্যাপ করুন অথবা নিজের বার্তা লিখুন…">${escapeHtml(computedDraft)}</textarea>
            </label>
            <div class="yp-draft-actions">
              <button class="yp-send-wa-btn" type="button" data-yp-action="send-draft" data-yp-phone="${escapeHtml(norm.local)}" data-yp-row="${escapeHtml(rowKey)}">
                ${iconMarkup('whatsapp', 'yp-btn-icon', { variant: 'glyph' })}
                <span>WhatsApp-এ পাঠান</span>
              </button>
              <button class="yp-copy-msg-btn" type="button" data-yp-action="copy-draft" data-yp-row="${escapeHtml(rowKey)}">
                ${iconMarkup('copy', 'yp-btn-icon', { variant: 'glyph' })}
                <span>বার্তা কপি</span>
              </button>
            </div>
          </div>
        ` : ''}
      </div>`;
  }

  function getDraftContextForRow(rowKey) {
    const parts = String(rowKey || '').split(':');
    const domain = parts[0];
    if (domain === 'staff') {
      const staffKey = parts.slice(1).join(':');
      const member = state.staff.find(s => (s.staffId || s.username) === staffKey);
      if (!member) return { recipientKind: 'staff', name: 'সহকর্মী' };
      return {
        recipientKind: 'staff',
        name: member.fullName || member.username || 'সহকর্মী',
        roleLabel: staffRoleLabel(member.role)
      };
    }
    const recipientKind = parts[parts.length - 1] === 'student' ? 'student' : 'guardian';
    const studentId = parts.slice(1, -1).join(':');
    const student = state.students.find(s => String(s.id) === studentId);
    if (!student) return { recipientKind, name: 'শিক্ষার্থী' };
    let dueAmount = 0;
    let dueMonth = '';
    if (student.status === 'approved') {
      try {
        const fee = studentFeeSummary(student, state.transactions);
        dueAmount = Number(fee?.due || 0);
        dueMonth = String(fee?.month || '');
      } catch { /* ignore */ }
    }
    return {
      recipientKind,
      name: student.name || student.nameEn || 'শিক্ষার্থী',
      className: student.className || '',
      group: student.group || '',
      dueAmount,
      dueMonth
    };
  }

  function renderStudentsSection() {
    const { groups, totalMatched, classPills } = groupStudentsForYellowPages(state.students, {
      query: state.query,
      classFilter: state.classFilter,
      statusFilter: state.statusFilter
    });

    if (state.classFilter !== 'all' && !classPills.some(p => p.className === state.classFilter)) {
      state.classFilter = 'all';
    }

    const totalAllClasses = classPills.reduce((sum, item) => sum + item.count, 0);

    const classIndexHtml = `
      <div class="yp-index-bar" aria-label="ইয়েলো পেইজ ক্লাস সূচিপত্র">
        <div class="yp-index-head">
          <span class="yp-index-kicker">ক্লাস সূচিপত্র · ইয়েলো পেইজ</span>
          <span class="yp-index-count">${toBnDigits(totalMatched)} জন শিক্ষার্থী</span>
        </div>
        <div class="yp-class-pills" role="tablist" aria-label="শ্রেণি নির্বাচন">
          <button class="yp-class-pill${state.classFilter === 'all' ? ' is-active' : ''}" type="button" data-yp-class="all" aria-pressed="${state.classFilter === 'all' ? 'true' : 'false'}">
            <span>সব শ্রেণি</span>
            <b>${toBnDigits(totalAllClasses)}</b>
          </button>
          ${classPills.map(pill => `
            <button class="yp-class-pill${state.classFilter === pill.className ? ' is-active' : ''}" type="button" data-yp-class="${escapeHtml(pill.className)}" aria-pressed="${state.classFilter === pill.className ? 'true' : 'false'}">
              <span class="yp-pill-code">${escapeHtml(toBnDigits(pill.classCode))}</span>
              <span>${escapeHtml(pill.className)}</span>
              <b>${toBnDigits(pill.count)}</b>
            </button>
          `).join('')}
        </div>
        <div class="yp-status-pills" role="group" aria-label="শিক্ষার্থীর অবস্থা ফিল্টার">
          ${[
            ['all', 'সব'],
            ['approved', 'সক্রিয়'],
            ['pending', 'অপেক্ষমাণ'],
            ['inactive', 'নিষ্ক্রিয়']
          ].map(([key, label]) => `
            <button class="yp-status-chip${state.statusFilter === key ? ' is-active' : ''}" type="button" data-yp-status="${key}" aria-pressed="${state.statusFilter === key ? 'true' : 'false'}">${label}</button>
          `).join('')}
        </div>
      </div>`;

    if (!groups.length) {
      const hasFilters = Boolean(state.query.trim()) || state.classFilter !== 'all' || state.statusFilter !== 'all';
      return `
        ${classIndexHtml}
        <div class="yp-empty-state admin-card">
          <span class="yp-empty-icon" aria-hidden="true">${iconMarkup('phone', 'yp-empty-svg', { variant: 'color' })}</span>
          <h3>কোনো শিক্ষার্থীর নম্বর পাওয়া যায়নি</h3>
          <p>${hasFilters ? 'আপনার অনুসন্ধান বা ফিল্টারের সাথে কোনো রেকর্ড মেলেনি।' : 'এখনও কোনো শিক্ষার্থীর তথ্য যুক্ত হয়নি। শিক্ষার্থী নিবন্ধিত হলে ক্লাস অনুযায়ী এখানে নম্বর দেখা যাবে।'}</p>
          ${hasFilters ? '<button class="yp-reset-btn" type="button" data-yp-action="reset-filters">সব ফিল্টার মুছুন</button>' : ''}
        </div>`;
    }

    const groupsHtml = groups.map(group => {
      const isCollapsed = state.classFilter === 'all' && state.collapsedClasses.has(group.className);
      const cardsHtml = isCollapsed ? '' : group.students.map(student => {
        const statusInfo = STUDENT_STATUS_META[student.status] || { label: student.status || '—', badgeClass: 'badge-neutral' };
        let dueAmount = 0;
        let dueMonth = '';
        if (student.status === 'approved') {
          try {
            const fee = studentFeeSummary(student, state.transactions);
            dueAmount = Number(fee?.due || 0);
            dueMonth = String(fee?.month || '');
          } catch { /* ignore */ }
        }
        const studentNorm = normalizeBdPhone(student.mobile);
        const guardianNorm = normalizeBdPhone(student.guardianMobile);
        const samePhone = studentNorm.valid && guardianNorm.valid && studentNorm.local === guardianNorm.local;
        const baseContext = {
          name: student.name || student.nameEn || 'শিক্ষার্থী',
          className: student.className || '',
          group: student.group || '',
          dueAmount,
          dueMonth
        };
        const guardianKey = `student:${student.id}:guardian`;
        const studentKey = `student:${student.id}:student`;

        return `
          <article class="yp-card" data-yp-student-card="${escapeHtml(String(student.id || ''))}">
            <header class="yp-card-head">
              <span class="yp-avatar" aria-hidden="true">${escapeHtml(phonebookInitials(baseContext.name))}</span>
              <div class="yp-person-main">
                <div class="yp-person-title-row">
                  <h4 class="yp-person-name">${escapeHtml(baseContext.name)}</h4>
                  <span class="badge ${statusInfo.badgeClass}">${escapeHtml(statusInfo.label)}</span>
                </div>
                <div class="yp-person-tags">
                  ${student.id ? `<span class="yp-id-chip">আইডি: ${escapeHtml(String(student.id))}</span>` : ''}
                  ${student.group ? `<span class="yp-meta-chip">ব্যাচ/বিভাগ: ${escapeHtml(String(student.group))}</span>` : ''}
                  ${dueAmount > 0 ? `<span class="yp-due-chip">বকেয়া ${escapeHtml(toBnDigits(dueAmount))}${dueMonth ? ` · ${escapeHtml(dueMonth)}` : ''}</span>` : ''}
                </div>
                ${student.fatherName ? `<p class="yp-guardian-sub">পিতা/অভিভাবক: <strong>${escapeHtml(String(student.fatherName))}</strong></p>` : ''}
              </div>
            </header>
            <div class="yp-contacts-stack">
              ${renderContactLine({
                rowKey: guardianKey,
                badgeLabel: 'অভিভাবক',
                badgeTone: 'guardian',
                personSub: student.fatherName ? String(student.fatherName) : '',
                rawPhone: student.guardianMobile,
                sameAsPrimary: false,
                draftContext: { ...baseContext, recipientKind: 'guardian' }
              })}
              ${renderContactLine({
                rowKey: studentKey,
                badgeLabel: 'শিক্ষার্থী',
                badgeTone: 'student',
                personSub: '',
                rawPhone: student.mobile,
                sameAsPrimary: samePhone,
                draftContext: { ...baseContext, recipientKind: 'student' }
              })}
            </div>
          </article>`;
      }).join('');

      return `
        <section class="yp-class-section${isCollapsed ? ' is-collapsed' : ''}" data-yp-class-section="${escapeHtml(group.className)}">
          <button class="yp-class-banner" type="button" data-yp-action="toggle-class" data-yp-class-target="${escapeHtml(group.className)}" aria-expanded="${isCollapsed ? 'false' : 'true'}">
            <span class="yp-class-code-badge">${escapeHtml(toBnDigits(group.classCode))}</span>
            <span class="yp-class-banner-copy">
              <strong>${escapeHtml(group.className)}</strong>
              <small>${toBnDigits(group.students.length)} জন শিক্ষার্থী · অভিভাবক ও ব্যক্তিগত নম্বর</small>
            </span>
            <span class="yp-class-chevron" aria-hidden="true">${isCollapsed ? '+' : '−'}</span>
          </button>
          ${isCollapsed ? '' : `<div class="yp-card-grid">${cardsHtml}</div>`}
        </section>`;
    }).join('');

    return `${classIndexHtml}<div class="yp-sections-list">${groupsHtml}</div>`;
  }

  function renderStaffSection() {
    const activeStaffPool = (Array.isArray(state.staff) ? state.staff : []).filter(Boolean);
    const enriched = activeStaffPool.map(member => {
      let assignmentText = '';
      if (member.role === 'teacher' && member.username) {
        try {
          const rows = listTeacherAssignments(member.username);
          if (rows.length) {
            assignmentText = rows
              .map(r => `${r.className}${r.section ? ` (${r.section})` : ''}${r.subjects?.length ? ` · ${r.subjects.join(', ')}` : ''}`)
              .join(' | ');
          }
        } catch { /* ignore */ }
      }
      if (!assignmentText && member.assignment?.classes?.length) {
        assignmentText = `${member.assignment.classes.join(', ')}${member.assignment.subjects?.length ? ` · ${member.assignment.subjects.join(', ')}` : ''}`;
      }
      return { member, assignmentText };
    });

    const roleCounts = new Map();
    for (const { member, assignmentText } of enriched) {
      if (!matchesPhonebookStaff(member, state.query, assignmentText)) continue;
      const role = STAFF_ROLE_META[member.role] ? member.role : 'other';
      roleCounts.set(role, (roleCounts.get(role) || 0) + 1);
    }

    const filtered = enriched.filter(({ member, assignmentText }) => {
      const role = STAFF_ROLE_META[member.role] ? member.role : 'other';
      if (state.roleFilter !== 'all' && role !== state.roleFilter) return false;
      return matchesPhonebookStaff(member, state.query, assignmentText);
    });

    const rolePillsHtml = `
      <div class="yp-index-bar" aria-label="স্টাফ পদবি সূচিপত্র">
        <div class="yp-index-head">
          <span class="yp-index-kicker">স্টাফ ডিরেক্টরি · পদবি অনুযায়ী</span>
          <span class="yp-index-count">${toBnDigits(filtered.length)} জন স্টাফ</span>
        </div>
        <div class="yp-class-pills" role="tablist" aria-label="স্টাফ পদবি নির্বাচন">
          <button class="yp-class-pill${state.roleFilter === 'all' ? ' is-active' : ''}" type="button" data-yp-role="all" aria-pressed="${state.roleFilter === 'all' ? 'true' : 'false'}">
            <span>সব স্টাফ</span>
            <b>${toBnDigits([...roleCounts.values()].reduce((a, b) => a + b, 0))}</b>
          </button>
          ${ROLE_ORDER.filter(r => roleCounts.has(r)).map(role => `
            <button class="yp-class-pill${state.roleFilter === role ? ' is-active' : ''}" type="button" data-yp-role="${escapeHtml(role)}" aria-pressed="${state.roleFilter === role ? 'true' : 'false'}">
              <span>${escapeHtml(staffRoleLabel(role))}</span>
              <b>${toBnDigits(roleCounts.get(role) || 0)}</b>
            </button>
          `).join('')}
        </div>
      </div>`;

    if (!filtered.length) {
      const hasFilters = Boolean(state.query.trim()) || state.roleFilter !== 'all';
      return `
        ${rolePillsHtml}
        <div class="yp-empty-state admin-card">
          <span class="yp-empty-icon" aria-hidden="true">${iconMarkup('staff', 'yp-empty-svg', { variant: 'color' })}</span>
          <h3>কোনো স্টাফ নম্বর পাওয়া যায়নি</h3>
          <p>${hasFilters ? 'অনুসন্ধান বা পদবি ফিল্টারের সাথে কোনো স্টাফ মেলেনি।' : 'স্টাফ প্রোফাইলে মোবাইল নম্বর যুক্ত করলে এখানে সরাসরি কল ও WhatsApp সুবিধা পাওয়া যাবে।'}</p>
          ${hasFilters ? '<button class="yp-reset-btn" type="button" data-yp-action="reset-filters">সব ফিল্টার মুছুন</button>' : ''}
        </div>`;
    }

    const byRole = new Map();
    for (const item of filtered) {
      const role = STAFF_ROLE_META[item.member.role] ? item.member.role : 'other';
      if (!byRole.has(role)) byRole.set(role, []);
      byRole.get(role).push(item);
    }

    const sectionsHtml = ROLE_ORDER.filter(r => byRole.has(r)).map(role => {
      const entries = byRole.get(role);
      const cards = entries.map(({ member, assignmentText }) => {
        const keyId = member.staffId || member.username || member.role;
        const rowKey = `staff:${keyId}`;
        const statusBadge = member.status === 'active' ? 'badge-approved' : member.status === 'suspended' ? 'badge-rejected' : 'badge-pending';
        return `
          <article class="yp-card is-staff-card" data-yp-staff-card="${escapeHtml(String(keyId))}">
            <header class="yp-card-head">
              <span class="yp-avatar is-staff" aria-hidden="true">${escapeHtml(phonebookInitials(member.fullName || staffRoleLabel(role)))}</span>
              <div class="yp-person-main">
                <div class="yp-person-title-row">
                  <h4 class="yp-person-name">${escapeHtml(member.fullName || member.username || staffRoleLabel(role))}</h4>
                  <span class="badge ${statusBadge}">${escapeHtml(staffStatusLabel(member.status || 'active'))}</span>
                </div>
                <div class="yp-person-tags">
                  <span class="yp-id-chip">${escapeHtml(staffRoleLabel(role))}</span>
                  ${member.staffId ? `<span class="yp-meta-chip">${escapeHtml(String(member.staffId))}</span>` : ''}
                </div>
                ${assignmentText ? `<p class="yp-guardian-sub">দায়িত্বপ্রাপ্ত ক্লাস/বিষয়: <strong>${escapeHtml(assignmentText)}</strong></p>` : ''}
              </div>
            </header>
            <div class="yp-contacts-stack">
              ${renderContactLine({
                rowKey,
                badgeLabel: staffRoleLabel(role),
                badgeTone: 'staff',
                personSub: member.email ? String(member.email) : '',
                rawPhone: member.mobile,
                sameAsPrimary: false,
                draftContext: {
                  recipientKind: 'staff',
                  name: member.fullName || staffRoleLabel(role),
                  roleLabel: staffRoleLabel(role)
                }
              })}
            </div>
          </article>`;
      }).join('');

      return `
        <section class="yp-class-section" data-yp-role-section="${escapeHtml(role)}">
          <div class="yp-class-banner is-static">
            <span class="yp-class-code-badge is-staff">${iconMarkup(role === 'teacher' ? 'teacher' : 'staff', 'yp-role-banner-svg', { variant: 'glyph' })}</span>
            <span class="yp-class-banner-copy">
              <strong>${escapeHtml(staffRoleLabel(role))}</strong>
              <small>${toBnDigits(entries.length)} জন স্টাফ সদস্য</small>
            </span>
          </div>
          <div class="yp-card-grid">${cards}</div>
        </section>`;
    }).join('');

    return `${rolePillsHtml}<div class="yp-sections-list">${sectionsHtml}</div>`;
  }

  function ensureShellMarkup() {
    if (mount.querySelector('[data-yp-shell]')) return;
    mount.innerHTML = `
      <div class="yp-shell" data-yp-shell>
        <section class="yp-summary-strip" aria-label="ফোনবুক সারাংশ" data-yp-summary></section>
        <div class="yp-toolbar admin-card">
          <div class="yp-mode-tabs" role="tablist" aria-label="ফোনবুক বিভাগ">
            <button class="yp-mode-tab is-active" type="button" role="tab" aria-selected="true" data-yp-tab="students">
              ${iconMarkup('students', 'yp-tab-icon', { variant: 'color' })}
              <span>শিক্ষার্থী ও অভিভাবক</span>
              <b class="yp-tab-badge" data-yp-count-students>০</b>
            </button>
            <button class="yp-mode-tab" type="button" role="tab" aria-selected="false" data-yp-tab="staff">
              ${iconMarkup('staff', 'yp-tab-icon', { variant: 'color' })}
              <span>স্টাফ ডিরেক্টরি</span>
              <b class="yp-tab-badge" data-yp-count-staff>০</b>
            </button>
          </div>
          <label class="yp-search-box" for="ypSearchInput-${escapeHtml(state.portal)}">
            <span class="yp-search-icon" aria-hidden="true">${iconMarkup('search', 'yp-search-svg', { variant: 'glyph' })}</span>
            <input id="ypSearchInput-${escapeHtml(state.portal)}" class="yp-search-input" type="search" data-yp-search placeholder="নাম, আইডি, শ্রেণি বা মোবাইল নম্বর (বাংলা/ইংরেজি) দিয়ে খুঁজুন…" autocomplete="off">
            <button class="yp-search-clear" type="button" data-yp-action="clear-search" aria-label="অনুসন্ধান মুছুন" hidden>
              ${iconMarkup('close', 'yp-clear-svg', { variant: 'glyph' })}
            </button>
          </label>
          <div class="yp-privacy-bar">
            <span class="yp-privacy-note" data-yp-privacy-note>নম্বরগুলো লুকানো আছে — নাম দেখে খুঁজুন, প্রয়োজনে নম্বর দেখান</span>
            <button class="yp-reveal-btn is-all" type="button" data-yp-action="toggle-all-phones"
              aria-pressed="false" aria-label="সব নম্বর দেখান">সব নম্বর দেখান</button>
          </div>
        </div>
        <div class="yp-results-region" data-yp-results aria-live="polite"></div>
      </div>`;
  }

  function paintSummaryAndTabs() {
    const activeStudents = (Array.isArray(state.students) ? state.students : []).filter(s => s && s.status !== 'rejected');
    const uniqueClasses = new Set(activeStudents.map(s => String(s.className || '').trim()).filter(Boolean));
    const { studentPhoneCount, staffPhoneCount } = countDirectoryPhones(activeStudents, state.staff);

    const summaryEl = mount.querySelector('[data-yp-summary]');
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="yp-stat-chip">
          <small>সক্রিয় শ্রেণি</small>
          <strong>${toBnDigits(uniqueClasses.size)}</strong>
        </div>
        <div class="yp-stat-chip">
          <small>শিক্ষার্থী ও অভিভাবক নম্বর</small>
          <strong>${toBnDigits(studentPhoneCount)}</strong>
        </div>
        <div class="yp-stat-chip">
          <small>স্টাফ নম্বর</small>
          <strong>${toBnDigits(staffPhoneCount)}</strong>
        </div>`;
    }

    const stCount = mount.querySelector('[data-yp-count-students]');
    if (stCount) stCount.textContent = toBnDigits(activeStudents.length);
    const sfCount = mount.querySelector('[data-yp-count-staff]');
    if (sfCount) sfCount.textContent = toBnDigits(Array.isArray(state.staff) ? state.staff.length : 0);

    mount.querySelectorAll('[data-yp-tab]').forEach(btn => {
      const on = btn.dataset.ypTab === state.tab;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    const input = mount.querySelector('[data-yp-search]');
    const clearBtn = mount.querySelector('[data-yp-action="clear-search"]');
    if (input && input.value !== state.query) input.value = state.query;
    if (clearBtn) clearBtn.hidden = !state.query;

    /* The reveal-all switch and its note describe what is on screen right now. */
    const allBtn = mount.querySelector('[data-yp-action="toggle-all-phones"]');
    if (allBtn) {
      allBtn.textContent = state.revealAllPhones ? 'সব নম্বর লুকান' : 'সব নম্বর দেখান';
      allBtn.setAttribute('aria-pressed', state.revealAllPhones ? 'true' : 'false');
      allBtn.setAttribute('aria-label', state.revealAllPhones ? 'সব নম্বর লুকান' : 'সব নম্বর দেখান');
    }
    const note = mount.querySelector('[data-yp-privacy-note]');
    if (note) {
      note.textContent = state.revealAllPhones
        ? 'সব নম্বর দেখানো আছে — স্ক্রিন থেকে সরে গেলে আবার লুকিয়ে রাখুন'
        : 'নম্বরগুলো লুকানো আছে — নাম দেখে খুঁজুন, প্রয়োজনে নম্বর দেখান';
    }
  }

  function paintResults() {
    const region = mount.querySelector('[data-yp-results]');
    if (!region) return;
    region.innerHTML = state.tab === 'staff' ? renderStaffSection() : renderStudentsSection();
  }

  function renderAll() {
    ensureShellMarkup();
    paintSummaryAndTabs();
    paintResults();
  }

  mount.addEventListener('input', event => {
    const searchInput = event.target.closest?.('[data-yp-search]');
    if (searchInput) {
      state.query = searchInput.value || '';
      const clearBtn = mount.querySelector('[data-yp-action="clear-search"]');
      if (clearBtn) clearBtn.hidden = !state.query;
      paintResults();
      return;
    }
    const draftArea = event.target.closest?.('[data-yp-draft-input]');
    if (draftArea) {
      state.draftCustomText = draftArea.value;
      state.draftDirty = true;
    }
  });

  mount.addEventListener('click', async event => {
    const tabBtn = event.target.closest?.('[data-yp-tab]');
    if (tabBtn) {
      const nextTab = tabBtn.dataset.ypTab;
      if (nextTab && nextTab !== state.tab) {
        state.tab = nextTab;
        state.openDraftKey = '';
        state.draftDirty = false;
        paintSummaryAndTabs();
        paintResults();
      }
      return;
    }

    const classBtn = event.target.closest?.('[data-yp-class]');
    if (classBtn) {
      state.classFilter = classBtn.dataset.ypClass || 'all';
      paintResults();
      return;
    }

    const statusBtn = event.target.closest?.('[data-yp-status]');
    if (statusBtn) {
      state.statusFilter = statusBtn.dataset.ypStatus || 'all';
      paintResults();
      return;
    }

    const roleBtn = event.target.closest?.('[data-yp-role]');
    if (roleBtn) {
      state.roleFilter = roleBtn.dataset.ypRole || 'all';
      paintResults();
      return;
    }

    const actionEl = event.target.closest?.('[data-yp-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.ypAction;

    if (action === 'clear-search') {
      state.query = '';
      const input = mount.querySelector('[data-yp-search]');
      if (input) {
        input.value = '';
        input.focus();
      }
      actionEl.hidden = true;
      paintResults();
      return;
    }

    if (action === 'reset-filters') {
      state.query = '';
      state.classFilter = 'all';
      state.statusFilter = 'all';
      state.roleFilter = 'all';
      paintSummaryAndTabs();
      paintResults();
      return;
    }

    if (action === 'reveal-phone' || action === 'hide-phone') {
      const row = actionEl.dataset.ypRow;
      if (!row) return;
      if (action === 'reveal-phone') state.revealedPhones.add(row);
      else state.revealedPhones.delete(row);
      paintResults();
      // Keep the keyboard where the user was: the same button now does the
      // opposite job, so focus the re-rendered equivalent.
      const next = mount.querySelector(`[data-yp-action="${action === 'reveal-phone' ? 'hide' : 'reveal'}-phone"][data-yp-row="${row}"]`);
      next?.focus?.({ preventScroll: true });
      return;
    }

    if (action === 'toggle-all-phones') {
      state.revealAllPhones = !state.revealAllPhones;
      if (!state.revealAllPhones) state.revealedPhones.clear();
      paintSummaryAndTabs();
      paintResults();
      return;
    }

    if (action === 'toggle-class') {
      const cls = actionEl.dataset.ypClassTarget;
      if (!cls) return;
      if (state.collapsedClasses.has(cls)) state.collapsedClasses.delete(cls);
      else state.collapsedClasses.add(cls);
      paintResults();
      return;
    }

    if (action === 'wa-direct') {
      const url = buildWhatsappUrl(actionEl.dataset.ypPhone, '');
      if (!url) {
        notify('সঠিক মোবাইল নম্বর পাওয়া যায়নি', true);
        return;
      }
      openExternalWhatsapp(url);
      return;
    }

    if (action === 'copy-phone') {
      const norm = normalizeBdPhone(actionEl.dataset.ypPhone);
      if (!norm.valid) return;
      const ok = await copyTextSafe(norm.local);
      notify(ok ? `নম্বর কপি করা হয়েছে: ${norm.local}` : 'নম্বর কপি করা যায়নি', !ok);
      return;
    }

    if (action === 'toggle-draft') {
      const rowKey = actionEl.dataset.ypRow || '';
      if (!rowKey) return;
      if (state.openDraftKey === rowKey) {
        state.openDraftKey = '';
        state.draftDirty = false;
      } else {
        state.openDraftKey = rowKey;
        state.draftTemplate = rowKey.startsWith('staff:') ? 'class_coord' : 'absence';
        state.draftDirty = false;
        state.draftCustomText = '';
      }
      paintResults();
      return;
    }

    if (action === 'close-draft') {
      state.openDraftKey = '';
      state.draftDirty = false;
      paintResults();
      return;
    }

    if (action === 'pick-template') {
      const tpl = actionEl.dataset.ypTemplate || 'direct';
      const rowKey = actionEl.dataset.ypRow || state.openDraftKey;
      state.openDraftKey = rowKey;
      state.draftTemplate = tpl;
      state.draftDirty = false;
      state.draftCustomText = buildPhonebookDraftText(tpl, getDraftContextForRow(rowKey));
      paintResults();
      const area = [...mount.querySelectorAll('[data-yp-draft-input]')].find(el => el.dataset.ypDraftInput === rowKey);
      area?.focus();
      return;
    }

    if (action === 'send-draft') {
      const rowKey = actionEl.dataset.ypRow || state.openDraftKey;
      const area = mount.querySelector('[data-yp-draft-input]');
      const message = area ? area.value : buildPhonebookDraftText(state.draftTemplate, getDraftContextForRow(rowKey));
      const url = buildWhatsappUrl(actionEl.dataset.ypPhone, message);
      if (!url) {
        notify('সঠিক WhatsApp নম্বর পাওয়া যায়নি', true);
        return;
      }
      openExternalWhatsapp(url);
      return;
    }

    if (action === 'copy-draft') {
      const area = mount.querySelector('[data-yp-draft-input]');
      const text = area?.value?.trim() || '';
      if (!text) {
        notify('কপি করার জন্য কোনো বার্তা লেখা নেই', true);
        return;
      }
      const ok = await copyTextSafe(text);
      notify(ok ? 'বাংলা বার্তাটি কপি করা হয়েছে' : 'বার্তা কপি করা যায়নি', !ok);
    }
  });

  const onExternalSync = () => {
    const panel = mount.closest('.admin-view, .manager-view');
    if (panel && !panel.classList.contains('active')) return;
    if (mount.contains(document.activeElement) && document.activeElement?.matches?.('[data-yp-draft-input]')) return;
    void api.refresh();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('apc-sync-updated', onExternalSync);
    window.addEventListener('storage', onExternalSync);
  }

  const api = {
    updateOptions(nextOpts = {}) {
      state.opts = { ...state.opts, ...nextOpts };
      if (nextOpts.portal) state.portal = nextOpts.portal;
    },
    async refresh() {
      await loadLiveData();
      renderAll();
    },
    getState() {
      return { ...state };
    }
  };

  mountedInstances.set(mount, api);
  await api.refresh();
  return api;
}
