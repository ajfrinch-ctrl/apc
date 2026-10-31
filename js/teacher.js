import { examRepository, watchExams } from './exam-data.js';
import { loadRoutine, loadNotices, saveNotices, WEEK_DAYS } from './office-data.js';
import { normalizeClassId, normalizeSectionId } from './class-key.js';
import { listTeacherAssignments, syncTeacherAssignmentFromDirectory, effectiveTeacherAssignments } from './teacher-assignments.js';
import { setTeachingScope, currentTeacherProfile, currentTeacherId, isOwnTeacherRecord } from './teaching-data.js';
import { hasStaffSession, clearStaffSession, goToLoginPage } from './staff-auth.js';
import { installPanelGuard, lockPanel, rememberPanelPage, watchOwnPanelSession } from './panel-lockdown.js';
import { rememberRoute, onRouteChange, routeName } from './panel-route.js';
import { openStaffPasswordDialog } from './staff-password-dialog.js';
import { loadAppConfig } from './storage.js';
import { toBanglaNumber as bn } from './ui.js';
import { initExamManager } from './exam-manager.js';
import { listQuestionsForStaff } from './question-bank.js';
import { listCourseContent } from './course-content.js';
import { courseRepository, courseProgress, watchCourses } from './course-data.js';
import { classByName } from './academics.js';
import { NOTICE_CATEGORIES } from './notification-rules.js';
import { mountSettingsHub, resetSettingsHub } from './settings-hub.js';
import { mountProfileSelfEdit } from './staff-self-edit.js';
import { initFixedShell } from './fixed-shell.js';
import { registerServiceWorker } from './service-worker.js';
import { mountReports, refreshReports } from './reports.js';
import { teachingRepository, DEMO_TEACHER, ACTIVITY_TYPES, PROGRESS_LABELS, escapeText as esc, todayISO, displayDate, safeResourceURL, matchesStudent, watchTeachingData } from './teaching-data.js';
import { pickTeacherAdvice, pickTeacherSectionAdvice } from './teacher-daily-advice.js';
import { initOrgInfo } from './org-info.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
initOrgInfo();
const state = { db: { activities: [] }, courses: [], students: [], assignments: [], teacher: null, exams: null, view: 'home', status: 'all', ready: false, busy: false, recordLimit: 15, examScreen: '', routineTab: 'today' };
let modalTrigger, toastTimer;
initFixedShell();
/* The examination workspace is the single exam/question surface; the academic
   hub only deep-links into its own screens. It is mounted at import time (its
   own first paint is asynchronous), exactly like before the hub existed. */
const examWorkspace = initExamManager('#teacherExamWorkspace', 'teacher');
registerServiceWorker();

function toast(message) {
  $('.admin-toast')?.remove();
  const el = document.createElement('p'); el.className = 'admin-toast'; el.setAttribute('role', 'status'); el.textContent = message;
  document.body.append(el); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), 3200);
}
const own = () => state.db.activities.filter(a => isOwnTeacherRecord(a.teacherId));
const rosterFor = a => state.students.filter(s => matchesStudent(a, s));
/** How much of a published activity is still waiting on the teacher. */
function progressStats(a) {
  const students = rosterFor(a);
  const value = s => a.progress?.[s.id]?.value;
  const recorded = students.filter(s => value(s) !== undefined && value(s) !== '');
  return {
    total: students.length,
    recorded: recorded.length,
    missing: students.length - recorded.length,
    toReview: a.type === 'homework' ? students.filter(s => value(s) === 'done').length : 0
  };
}
/** Marks and attendance are only "pending" once the class has actually happened. */
const isDue = a => String(a.date || '') <= todayISO();
/** One line of Bengali status per activity; empty string = nothing pending. */
function pendingNote(a) {
  if (a.status === 'draft') return 'খসড়া — শিক্ষার্থী এখনও দেখবে না';
  if (['suggestion', 'exam'].includes(a.type)) return '';
  const stats = progressStats(a);
  // Notebooks students already handed in wait on the teacher even before the deadline.
  if (a.type === 'homework' && stats.toReview) return `${bn(stats.toReview)} জনের খাতা দেখা বাকি`;
  if (!isDue(a)) return '';
  if (a.type === 'exam') return stats.missing ? `${bn(stats.missing)} জনের নম্বর বাকি` : '';
  if (a.type === 'homework') return stats.missing ? `${bn(stats.missing)} জনের অবস্থা বাকি` : '';
  return stats.missing ? `${bn(stats.missing)} জনের উপস্থিতি বাকি` : '';
}
/** Only published items that genuinely wait on the teacher count toward nav/hub badges. */
function isActionablePending(a) {
  if (!a || a.status !== 'published') return false;
  if (['suggestion', 'exam'].includes(a.type)) return false;
  const stats = progressStats(a);
  if (a.type === 'homework') return stats.toReview > 0;
  return isDue(a) && stats.missing > 0;
}
const assignedClasses = () => [...new Set(state.assignments.map(item => item.className))];
const classOptions = value => assignedClasses().map(c => `<option value="${esc(c)}" ${c === value ? 'selected' : ''}>${esc(c)}</option>`).join('');
function activityMeta(a) {
  const date = `${displayDate(a.date)}${a.time ? ' • ' + bn(a.time) : ''}`;
  return `${a.type === 'homework' ? 'শেষ সময়: ' : ''}${date}${a.duration ? ' • ' + bn(a.duration) + ' মিনিট' : ''}${a.totalMarks ? ' • পূর্ণমান ' + bn(a.totalMarks) : ''}`;
}
function recordCard(a) {
  const stats = a.status === 'published' && a.type !== 'suggestion' ? progressStats(a) : null;
  const note = pendingNote(a);
  return `<article class="teaching-card" data-activity-id="${esc(a.id)}">
    <div class="teaching-card-head"><span class="teaching-kind">${ACTIVITY_TYPES[a.type].label}</span><span class="teaching-status ${a.status}">${a.status === 'published' ? 'প্রকাশিত' : 'খসড়া'}</span></div>
    <h3>${esc(a.title)}</h3><small>${esc(a.subject)} • ${esc(a.className)} • ${esc(a.group || 'সব বিভাগ')}</small>
    <p>${esc(activityMeta(a))}</p>${a.room ? `<small>স্থান: ${esc(a.room)}</small>` : ''}
    ${stats && stats.total ? `<p class="teaching-progress-line ${note ? 'pending' : stats.recorded === stats.total ? 'clear' : 'idle'}">অগ্রগতি ${bn(stats.recorded)}/${bn(stats.total)} জন${note ? ' • ' + esc(note) : stats.recorded === stats.total ? ' • সব নথিভুক্ত' : ''}</p>` : note ? `<p class="teaching-progress-line pending">${esc(note)}</p>` : ''}
    <p class="teaching-preview">${esc(a.details)}</p>
    <div class="teaching-actions">
      <button type="button" data-record-action="detail" data-id="${esc(a.id)}">বিস্তারিত</button>
      ${a.type !== 'exam' ? `<button type="button" data-record-action="edit" data-id="${esc(a.id)}">সম্পাদনা</button>${a.status === 'published' && ACTIVITY_TYPES[a.type].progress ? `<button class="primary" type="button" data-record-action="progress" data-id="${esc(a.id)}">${ACTIVITY_TYPES[a.type].progress}</button>` : ''}<button class="danger" type="button" data-record-action="delete" data-id="${esc(a.id)}">মুছুন</button>` : '<small>পরীক্ষার approval ও score-entry Examination workflow-এ নিয়ন্ত্রিত</small>'}
    </div></article>`;
}
/** Today first, then the nearest upcoming date, then the most recent past date. */
function byDueDate(a, b) {
  const today = todayISO();
  const pastA = a.date < today, pastB = b.date < today;
  if (pastA !== pastB) return pastA ? 1 : -1;
  const byDate = String(a.date).localeCompare(String(b.date));
  return pastA ? -byDate : byDate;
}
const dayLabel = date => {
  if (!date) return '';
  const shift = days => todayISO(new Date(new Date(`${todayISO()}T12:00:00`).setDate(new Date(`${todayISO()}T12:00:00`).getDate() + days)));
  if (date === todayISO()) return 'আজ';
  if (date === shift(1)) return 'আগামীকাল';
  if (date === shift(-1)) return 'গতকাল';
  return displayDate(date);
};
function renderTypeCounts() {
  const records = own();
  let pendingAcademic = 0;
  Object.keys(ACTIVITY_TYPES).forEach(type => {
    const all = records.filter(a => a.type === type);
    const waiting = all.filter(isActionablePending).length;
    if (type !== 'routine') pendingAcademic += waiting;
    const tab = $('#tabCount-' + type);
    if (tab) tab.textContent = all.length ? bn(all.length) : '';
    /* The nav dot sits on the seat that owns the work: attendance on রুটিন,
       class-test marks on ফলাফল (see docs/APP-ARCHITECTURE.md §9 Phase 2). */
    const dot = $('#navDot-' + type);
    if (dot) { dot.hidden = !waiting; dot.textContent = bn(waiting); }
    const card = $(`[data-academic-count="${type}"]`);
    if (card && type !== 'exam') card.dataset.waiting = waiting ? '1' : '';
  });
  const academicDot = $('#navDot-academic');
  const routineDot = $('#navDot-routine');
  if (academicDot) {
    academicDot.hidden = !pendingAcademic || Boolean(routineDot && !routineDot.hidden);
    academicDot.textContent = bn(pendingAcademic);
  }
}
/* The staff panels no longer carry hero art (owner request 2026-10-28): the
   date/advice nodes that survived the hero removal are painted by renderHome()
   itself, so there is no image/glint sync left to run. */
function renderHome() {
  const hasAssignments = state.assignments.length > 0;
  /* "No class assigned" may only appear when the data actually came back
     empty — never while a load is running or failed (the data-error card
     owns those states), and never from a stale snapshot: the pickers, the
     profile and every publish gate read the same assignment rows. */
  $('#teacherAssignmentNotice').hidden = hasAssignments || !state.ready;
  /* শিক্ষকের নাম হিরো কার্ডে শুধু শিরোনাম ও অ্যাভাটার-অক্ষরে; টপবারে নামের
     পুনরাবৃত্তি নেই। ভূমিকা ও শিক্ষক আইডি এখন শুধু "আমার প্রোফাইল" স্ক্রিনে
     (renderTeacherProfile) — হিরোর পরিচিতি সাব-কার্ডটি মালিক-নির্দেশে বাদ। */
  const name = String(state.teacher?.fullName || '').trim();
  $('#teacherHomeTitle').textContent = name ? `স্বাগতম, ${name}` : 'স্বাগতম';
  const now = new Date();
  let weekday = '';
  try {
    weekday = new Intl.DateTimeFormat('bn-BD', { timeZone: 'Asia/Dhaka', weekday: 'long' }).format(now);
  } catch {
    weekday = new Intl.DateTimeFormat('bn-BD', { weekday: 'long' }).format(now);
  }
  const datePillText = `${weekday ? `${weekday} · ` : ''}${displayDate(todayISO())}`;
  $$('[data-teacher-hero-date], #teacherHomeDate, #teacherClassesDate, #teacherExamsDate, #teacherMoreDate').forEach(el => { el.textContent = datePillText; });
  /* প্রতিদিন নতুন পরামর্শ: একই ঢাকা-দিনে একই লাইন, পরদিন নিজে থেকে বদলায়।
     কোনো স্টোরেজ/নেটওয়ার্ক নেই — বিশুদ্ধ তারিখ-ভিত্তিক নির্বাচন। */
  const warmLine = $('.teacher-hero-warm');
  if (warmLine) warmLine.textContent = pickTeacherAdvice();
  $$('[data-teacher-hero-advice]').forEach(el => {
    const section = el.dataset.teacherHeroAdvice || 'home';
    if (section === 'home') {
      el.textContent = pickTeacherAdvice();
    } else if (section === 'records') {
      el.textContent = pickTeacherSectionAdvice(state.view || 'homework');
    } else {
      el.textContent = pickTeacherSectionAdvice(section);
    }
  });
  const themeStatus = $('[data-more-theme-status]');
  if (themeStatus) {
    const isDark = document.documentElement.dataset.theme === 'dark';
    themeStatus.textContent = isDark
      ? 'বর্তমানে গাঢ় থিম চালু আছে — ট্যাপ করে দিন মোডে যান'
      : 'বর্তমানে দিন মোড চালু আছে — ট্যাপ করে গাঢ় থিম চালু করুন';
  }
  /* মালিকের নির্দেশ (২০২৬-১০-২১): হোম থেকে "আজকের সারাংশ" KPI সারফেস বাদ।
     একই সংখ্যাগুলো এখনও কর্মক্ষেত্রেই হিসাব হয় (পেন্ডিং নেভি ডট renderTypeCounts-এ,
     পরীক্ষা তার নিজস্ব স্ক্রিনে) — শুধু হোম-কার্ড তিনটি সরানো হয়েছে। */
  const todays = assignedRoutineRows(routineTodayKey()).sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
  $('#teacherTodayClassCount').textContent = hasAssignments ? `${bn(todays.length)}টি ক্লাস` : '—';
  renderTypeCounts();
  $('#teacherTodayClasses').innerHTML = todays.length
    ? todays.map(item => `<article class="teacher-home-class"><span class="teacher-home-class-icon" aria-hidden="true"><svg class="apc-glyph-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" focusable="false" data-icon="class-today" data-icon-set="active-plus-soft3d" data-icon-version="2" data-icon-style="glyph"><image href="assets/icons/ai-3d/class-today.svg" width="24" height="24" preserveAspectRatio="xMidYMid meet"/></svg></span><div><h3>${esc(item.className || 'ক্লাস')} · ${esc(item.subject || 'বিষয় উল্লেখ নেই')}</h3><p>${esc(item.time || 'সময় নির্ধারিত নয়')}${item.room ? ` · ${esc(item.room)}` : ''}</p></div><small>আজকের</small></article>`).join('')
    : '<p class="teacher-empty">আজ কোনো নির্ধারিত ক্লাস নেই</p>';
  /* মালিকের নির্দেশ (২০২৬-১০): হোমপেজ ক্লিন — কোনো "সাম্প্রতিক কাজ" ফিড নেই।
     সব কার্যক্রম (উপস্থিতি ক্লাসসহ) তার নিজস্ব রেকর্ডস ট্যাব ও রুটিন স্ক্রিনে অক্ষত
     থাকে; শুধু হোম থেকে সারফেসটি সরানো হয়েছে, কোনো ডেটা বা কর্মপ্রবাহ নয়। */
}
function renderRecords() {
  if (!ACTIVITY_TYPES[state.view]) return;
  $('#teacherRecordsTitle').textContent = ACTIVITY_TYPES[state.view].plural;
  const recordAdvice = $('#teacherRecords [data-teacher-hero-advice="records"]');
  if (recordAdvice) recordAdvice.textContent = pickTeacherSectionAdvice(state.view || 'homework');
  const status = $('#teacherStatusFilter');
  if (status && status.tagName === 'SELECT') status.value = state.status;
  $('#teacherNewActivity').hidden = state.view === 'exam';
  if ($('#teacherNewActivity') && ACTIVITY_TYPES[state.view]) {
    $('#teacherNewActivity').textContent = `+ ${ACTIVITY_TYPES[state.view].label}`;
  }
  if ($('#teacherRecordsActionTitle') && ACTIVITY_TYPES[state.view]) {
    $('#teacherRecordsActionTitle').textContent = `নতুন ${ACTIVITY_TYPES[state.view].label} যোগ করুন`;
  }
  $('#teacherOnlineExamHint').hidden = state.view !== 'exam';
  const query = $('#teacherRecordSearch').value.trim().toLocaleLowerCase();
  const className = $('#teacherClassFilter').value;
  const scoped = own().filter(a => a.type === state.view);
  const list = scoped.filter(a => (state.status === 'all' || a.status === state.status) && (className === 'all' || a.className === className) && `${a.title} ${a.subject}`.toLocaleLowerCase().includes(query));
  list.sort(state.view === 'suggestion'
    ? (a, b) => b.updatedAt.localeCompare(a.updatedAt)
    : (a, b) => byDueDate(a, b) || String(a.time || '').localeCompare(String(b.time || '')));
  const publishedCount = scoped.filter(a => a.status === 'published').length;
  $('#teacherRecordCount').textContent = `${bn(list.length)}টি ${ACTIVITY_TYPES[state.view].label} • প্রকাশিত ${bn(publishedCount)} • খসড়া ${bn(scoped.length - publishedCount)}`;

  const visible = list.slice(0, state.recordLimit);
  const groups = [];
  for (const a of visible) {
    const key = state.view === 'suggestion' ? (a.status === 'published' ? 'প্রকাশিত' : 'খসড়া') : dayLabel(a.date);
    if (!groups.length || groups.at(-1).key !== key) groups.push({ key, items: [] });
    groups.at(-1).items.push(a);
  }
  $('#teacherRecordList').innerHTML = visible.length
    ? groups.map(group => `<p class="teacher-group-label">${esc(group.key)}<span>${bn(group.items.length)}টি</span></p>${group.items.map(recordCard).join('')}`).join('')
    : '<p class="teacher-empty">কোনো কাজ পাওয়া যায়নি। নতুন কাজ যোগ করুন অথবা ফিল্টার বদলান।</p>';
  const more = $('#teacherRecordMore');
  if (more) {
    const remaining = list.length - visible.length;
    more.hidden = remaining <= 0;
    more.textContent = remaining > 0 ? `আরও ${bn(remaining)}টি ${ACTIVITY_TYPES[state.view].label} দেখুন` : '';
  }
}

const weekdayNames = { sat: 'শনিবার', sun: 'রবিবার', mon: 'সোমবার', tue: 'মঙ্গলবার', wed: 'বুধবার', thu: 'বৃহস্পতিবার' };
function renderTeacherClasses() {
  const host = $('#teacherClassList'); if (!host) return;
  const count = $('#teacherClassCount');
  /* Only tell a teacher "no class is assigned" when that is the truth — after
     the data actually came back empty. While a load is still running, or has
     failed (Firebase slow or unreachable), say that instead and offer a retry:
     an honest empty state must never be shown over classes that do exist. */
  if (!state.ready) {
    if (count) count.textContent = '—';
    host.innerHTML = '<p class="teacher-empty">আপনার ক্লাসের তথ্য আনা হচ্ছে… অনুগ্রহ করে একটু ক্ষণ করুন। <button class="mini-btn" type="button" data-teacher-class-retry>আবার চেষ্টা করুন</button></p>';
    return;
  }
  if (count) count.textContent = state.assignments.length ? `${bn(state.assignments.length)}টি ক্লাস` : '—';
  host.innerHTML = state.assignments.map(item => {
    const subjects = (item.subjects && item.subjects.length ? item.subjects : [item.subject]).filter(Boolean);
    const subjectChips = subjects.length
      ? subjects.map(sub => `<span class="teacher-class-subject-chip">${esc(sub)}</span>`).join('')
      : '<span class="teacher-class-subject-chip">—</span>';
    return `<article class="teaching-card teacher-class-card" data-teacher-open-class="${esc(item.className)}" data-teacher-open-group="${esc(item.group || '')}">
          <div class="teacher-class-hero-main">
            <div class="teacher-class-heading">
              <h3>${esc(item.className)}${item.group ? ` • ${esc(item.group)}` : ''}</h3>
              <small>ট্যাপ করে এই ক্লাসের কাজে যান</small>
            </div>
            <div class="teacher-class-subjects" aria-label="বিষয়সমূহ" hidden>${subjectChips}</div>
          </div>
          <span class="teacher-class-hero-art" aria-hidden="true"><svg class="apc-color-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" data-icon="classes" data-icon-set="active-plus-soft3d" data-icon-version="2" data-icon-style="color"><image href="assets/icons/ai-3d/classes.svg" width="24" height="24" preserveAspectRatio="xMidYMid meet"/></svg></span>
        </article>`;
  }).join('') || '<p class="teacher-empty">এখনো কোনো ক্লাস অ্যাসাইন করা হয়নি। অ্যাসাইন হলে এখানে আপনার ক্লাস ও বিষয় দেখা যাবে; কর্তৃপক্ষ সঙ্গে যোগাযোগ করুন।</p>';
}
function assignedRoutineRows(day) {
  const routine = loadRoutine() || {};
  return (routine[day]?.classes || []).filter(item => {
    if (item?.teacherId) return isOwnTeacherRecord(item.teacherId);
    return state.assignments.some(assignment => normalizeClassId(assignment) === normalizeClassId(item) && (!normalizeSectionId(item) || normalizeSectionId(assignment) === normalizeSectionId(item)) && (!item.subject || (assignment.subjects?.length ? assignment.subjects : [assignment.subject]).includes(item.subject)));
  });
}
function routineTodayKey(offset = 0) {
  const day = new Date(`${todayISO()}T12:00:00Z`).getUTCDay();
  return ['sun', 'mon', 'tue', 'wed', 'thu', null, 'sat'][(day + offset) % 7];
}
function routineCardHtml(rows, empty, day = '') {
  if (!rows.length) return `<p class="teacher-empty">${empty}</p>`;
  return rows.map(item => `<article class="teaching-card" data-routine-slot="${esc(item.id || '')}"><span class="teaching-kind">${esc(item.time || 'সময় নেই')}</span><h3>${esc(item.subject || 'বিষয় উল্লেখ নেই')}</h3><p>${esc([item.className, item.group, item.teacher, item.room].filter(Boolean).join(' • '))}</p><div class="teaching-actions"><button type="button" class="primary" data-open-routine-session="${esc(item.id || '')}" data-routine-day="${esc(day)}" data-routine-subject="${esc(item.subject || '')}" data-routine-class="${esc(item.className || '')}" data-routine-group="${esc(item.group || '')}" data-routine-time="${esc(item.rawTime || '10:00')}" data-routine-room="${esc(item.room || '')}">উপস্থিতি ও সেশন নোট</button></div></article>`).join('');
}
function openRoutineSession(btn) {
  if (!state.ready || state.busy) return toast('আগে ডেটা লোড হতে দিন।');
  const slotId = String(btn.dataset.openRoutineSession || '').trim();
  const subject = String(btn.dataset.routineSubject || '').trim();
  const className = String(btn.dataset.routineClass || assignedClasses()[0] || '').trim();
  const group = String(btn.dataset.routineGroup || '').trim();
  const rawTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(btn.dataset.routineTime || '')) ? String(btn.dataset.routineTime) : '10:00';
  const room = String(btn.dataset.routineRoom || '').trim();
  const today = todayISO();
  const existing = own().find(a => a.type === 'routine' && ((slotId && a.routineSlotId === slotId && a.date === today) || (!slotId && a.className === className && a.subject === subject && a.date === today)));
  const sessionRecord = existing || {
    type: 'routine',
    routineSlotId: slotId,
    title: `${subject || 'ক্লাস'} — উপস্থিতি সেশন`,
    subject: subject || 'সাধারণ',
    className,
    group,
    date: today,
    time: rawTime,
    duration: 60,
    room,
    details: '',
    status: 'published',
    progress: {}
  };
  const students = state.students.filter(s => matchesStudent(sessionRecord, s));
  const options = ['present', 'absent', 'late'];
  openModal(`ক্লাস সেশন ও উপস্থিতি • ${subject || className}`, `<form id="teacherRoutineSessionForm" class="teacher-form">
    <input type="hidden" name="routineSlotId" value="${esc(slotId)}">
    <div><label for="rs-date">তারিখ *</label><input id="rs-date" name="date" type="date" value="${esc(sessionRecord.date)}" required></div>
    <div><label for="rs-time">শুরুর সময় *</label><input id="rs-time" name="time" type="time" value="${esc(sessionRecord.time)}" required></div>
    <div><label for="rs-room">রুম / স্থান</label><input id="rs-room" name="room" type="text" maxlength="120" value="${esc(sessionRecord.room || '')}"></div>
    <div><label for="rs-details">ক্লাস নোট / বিবরণ</label><textarea id="rs-details" name="details" rows="3" maxlength="3000">${esc(sessionRecord.details || '')}</textarea></div>
    <h4>শিক্ষার্থীদের উপস্থিতি (${bn(students.length)} জন)</h4>
    ${students.length ? `<div class="teacher-progress-list">${students.map((st, idx) => {
      const val = sessionRecord.progress?.[st.id]?.value ?? 'present';
      return `<div class="teacher-progress-row"><label for="rs-att-${idx}">${esc(st.name)}<small>${esc(st.id)}</small></label><select id="rs-att-${idx}" data-rs-student="${esc(st.id)}"><option value="">নথিভুক্ত নয়</option>${options.map(v => `<option value="${v}" ${v === val ? 'selected' : ''}>${PROGRESS_LABELS[v]}</option>`).join('')}</select></div>`;
    }).join('')}</div>` : '<p class="teacher-empty">এই শ্রেণি/বিভাগে কোনো অনুমোদিত শিক্ষার্থী নেই।</p>'}
    <p class="finance-error" id="teacherSaveError" role="alert" hidden></p>
    <div class="modal-actions"><button class="admin-btn primary" type="submit">উপস্থিতি ও নোট সংরক্ষণ করুন</button><button class="admin-btn ghost" type="button" data-close-teacher>বাতিল</button></div>
  </form>`);
  $('#teacherRoutineSessionForm')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    const entries = Object.fromEntries([...form.querySelectorAll('[data-rs-student]')].filter(el => el.value).map(el => [el.dataset.rsStudent, el.value]));
    save(form, async () => {
      let db = await teachingRepository.saveActivity({
        id: existing?.id,
        type: 'routine',
        routineSlotId: slotId,
        title: sessionRecord.title,
        subject: sessionRecord.subject,
        className,
        group,
        date: data.date,
        time: data.time,
        duration: 60,
        room: data.room,
        details: data.details,
        status: 'published'
      });
      const savedAct = db.activities.find(a => (existing?.id ? a.id === existing.id : (a.type === 'routine' && a.date === data.date && a.subject === sessionRecord.subject && a.className === className)));
      if (savedAct && Object.keys(entries).length) {
        db = await teachingRepository.saveProgress(savedAct.id, entries);
      }

      return db;
    }, 'ক্লাস সেশন ও উপস্থিতি সংরক্ষণ করা হয়েছে — শিক্ষার্থীদের রিপোর্টে আপডেট দেখা যাবে।');
  });
}
function routineBlob(item) {
  return `${item.tag || ''} ${item.status || ''} ${item.subject || ''}`.toLowerCase();
}
function renderTeacherRoutine() {
  /* One routine screen, nine tabs: the Manager owns the schedule, the Teacher
     only reads it and jumps to attendance — nine separate pages became a
     single scroll with a segment row. */
  const host = $('#teacherRoutineViewList'); if (!host) return;
  const all = WEEK_DAYS.flatMap(day => assignedRoutineRows(day).map(item => ({ ...item, day })));
  const week = WEEK_DAYS.map(day => `<section class="exam-card"><h3>${esc(weekdayNames[day] || day)}</h3>${routineCardHtml(assignedRoutineRows(day), 'ক্লাস নেই।')}</section>`).join('');
  const by = {
    today: () => routineCardHtml(assignedRoutineRows(routineTodayKey()), 'আজ কোনো ক্লাস নেই।'),
    tomorrow: () => routineCardHtml(assignedRoutineRows(routineTodayKey(1)), 'আগামীকাল কোনো ক্লাস নেই।'),
    weekly: () => week,
    class: () => week,
    exam: () => routineCardHtml(all.filter(item => /পরীক্ষা|exam/.test(routineBlob(item))), 'পরীক্ষা রুটিন এখনও নেই।'),
    changed: () => routineCardHtml(all.filter(item => /পরিবর্ত|changed/.test(routineBlob(item))), 'পরিবর্তিত রুটিন নেই।'),
    holiday: () => routineCardHtml(all.filter(item => /ছুটি|holiday/.test(routineBlob(item))), 'ছুটির তালিকা খালি।'),
    important: () => routineCardHtml(all.filter(item => /গুরুত্বপূর্ণ|important/.test(routineBlob(item))), 'গুরুত্বপূর্ণ সময়সূচি নেই।'),
    other: () => routineCardHtml(all.filter(item => !/পরীক্ষা|exam|পরিবর্ত|changed|ছুটি|holiday|গুরুত্বপূর্ণ|important/.test(routineBlob(item))), 'অন্যান্য রুটিন নেই।')
  };
  const extraClasses = own().filter(a => a.type === 'routine' && !a.routineSlotId);
  const extraHtml = extraClasses.length ? `<section class="exam-card"><h3>একদিনের বিশেষ ক্লাস (${bn(extraClasses.length)}টি)</h3>${extraClasses.map(recordCard).join('')}</section>` : '';
  host.innerHTML = `<div class="teaching-actions" style="margin-bottom:0.75rem"><button type="button" class="admin-btn primary" data-new-activity="routine">+ একদিনের বিশেষ ক্লাস যোগ করুন</button></div>` + (by[state.routineTab] || by.today)() + extraHtml;
  $$('.teacher-routine-tabs [data-routine-tab]').forEach(button => {
    const active = button.dataset.routineTab === state.routineTab;
    button.setAttribute('aria-selected', String(active));
    button.classList.toggle('active', active);
  });
}
$$('.teacher-routine-tabs [data-routine-tab]').forEach(button => button.addEventListener('click', () => {
  state.routineTab = button.dataset.routineTab;
  renderTeacherRoutine();
}));
function renderAcademicReports() {
  const host = $('#teacherAcademicReportList'); if (!host) return;
  const records = own();
  const rows = assignedClasses().map(className => {
    const classRecords = records.filter(item => item.className === className);
    const attendance = classRecords.filter(item => item.type === 'routine').reduce((sum, item) => sum + Object.keys(item.progress || {}).length, 0);
    const marks = classRecords.filter(item => item.type === 'exam').reduce((sum, item) => sum + Object.keys(item.progress || {}).length, 0);
    const assignments = classRecords.filter(item => item.type === 'homework').length;
    return `<article class="teaching-card"><h3>${esc(className)}</h3><p>সংরক্ষিত উপস্থিতি এন্ট্রি: ${bn(attendance)}</p><p>নথিভুক্ত নম্বর এন্ট্রি: ${bn(marks)}</p><p>বাড়ির কাজ কার্যক্রম: ${bn(assignments)}</p></article>`;
  });
  host.innerHTML = rows.join('') || '<p class="teacher-empty">রিপোর্ট দেখানোর মতো নির্ধারিত শ্রেণি নেই। এখানে শুধু এই ব্রাউজারে সংরক্ষিত একাডেমিক কাজ গণনা করা হয়; এটি পূর্ণাঙ্গ সার্ভার-রিপোর্ট নয়।</p>';
}
function renderTeacherProfile() {
  const host = $('#teacherProfileCard'); if (!host) return;
  const account = state.teacher || {};
  const teacherId = String(account.staffId && account.kind !== 'system' ? account.staffId : currentTeacherId());
  host.innerHTML = `<div class="manager-profile-list"><div><small>নাম</small><strong>${esc(account.fullName || '—')}</strong></div><div><small>শিক্ষক আইডি</small><strong id="teacherProfileId">${esc(teacherId)}</strong></div><div><small>ইউজারনেম</small><strong>${esc(account.username || '—')}</strong></div><div><small>যোগাযোগ</small><strong>${esc(account.mobile || '—')}</strong></div><div><small>ভূমিকা</small><strong>শিক্ষক — একাডেমিক</strong></div><div><small>নির্ধারিত শ্রেণি/ব্যাচ</small><strong>${bn(state.assignments.length)}</strong></div></div>`;
  host.insertAdjacentHTML('beforeend', '<div class="row-actions"><button class="admin-btn primary" type="button" data-profile-edit>নিজের তথ্য সম্পাদনা</button><button class="admin-btn ghost" type="button" data-more-action="password">পাসওয়ার্ড পরিবর্তন</button></div>');
}

function renderCourseChapters() {
  const host = $('#teacherCourseChaptersBox');
  if (!host) return;
  const list = state.courses || [];
  host.innerHTML = `<div class="teaching-card-head" style="margin-bottom:0.75rem"><h2>কোর্স ও অধ্যায় (${bn(list.length)})</h2><button type="button" class="admin-btn primary" data-course-ch-action="new">+ নতুন কোর্স</button></div>`
    + (list.length ? list.map(course => {
      const prog = courseProgress(course);
      return `<article class="teaching-card" data-course-card="${esc(course.id)}">
        <div class="teaching-card-head"><span class="teaching-kind">${esc(course.subject)}</span><span class="teaching-status ${course.status}">${course.status === 'published' ? 'প্রকাশিত' : 'খসড়া'}</span></div>
        <h3>${esc(course.title || course.subject)}</h3>
        <small>${esc(course.className)} • ${esc(course.group || 'সব বিভাগ')} • সম্পন্ন ${bn(prog.completed)}/${bn(prog.total)} অধ্যায় (${bn(prog.percent)}%)</small>
        <div class="course-chapter-list" style="margin:0.5rem 0">${course.chapters.length ? course.chapters.map(ch => `<div class="teacher-progress-row" data-chapter-row="${esc(ch.id)}" style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;padding:0.35rem 0">
          <span><strong>${bn(ch.order)}. ${esc(ch.title)}</strong>${ch.status === 'শেষ' && ch.completedDate ? ` <small>(শেষ: ${esc(displayDate(ch.completedDate))})</small>` : ''}</span>
          <span style="display:flex;gap:0.35rem;align-items:center">
            <button type="button" class="mini-btn ${ch.status === 'শেষ' ? 'approve' : ch.status === 'চলছে' ? 'primary' : ''}" data-course-ch-action="cycle-chapter" data-course-id="${esc(course.id)}" data-chapter-id="${esc(ch.id)}">${esc(ch.status)}</button>
            <button type="button" class="mini-btn danger" data-course-ch-action="delete-chapter" data-course-id="${esc(course.id)}" data-chapter-id="${esc(ch.id)}" aria-label="অধ্যায় মুছুন">×</button>
          </span>
        </div>`).join('') : '<p class="teacher-empty">এখনো কোনো অধ্যায় যোগ করা হয়নি।</p>'}</div>
        <div class="teaching-actions">
          <button type="button" class="primary" data-course-ch-action="add-chapter" data-course-id="${esc(course.id)}">+ অধ্যায় যোগ</button>
          <button type="button" data-course-ch-action="edit-course" data-course-id="${esc(course.id)}">সম্পাদনা</button>
          <button type="button" data-course-ch-action="toggle-course" data-course-id="${esc(course.id)}">${course.status === 'published' ? 'খসড়া করুন' : 'প্রকাশ করুন'}</button>
          <button type="button" class="danger" data-course-ch-action="delete-course" data-course-id="${esc(course.id)}">মুছুন</button>
        </div>
      </article>`;
    }).join('') : '<p class="teacher-empty">এখনো কোনো কোর্স তৈরি করা হয়নি। “+ নতুন কোর্স” বাটনে ট্যাপ করে কোর্স ও অধ্যায় যোগ করুন।</p>');
}

function showCourseModal(old = null) {
  if (!state.ready || state.busy) return toast('আগে ডেটা লোড হতে দিন।');
  const assignedSubjs = [...new Set(state.assignments.flatMap(a => a.subjects || [a.subject]).filter(Boolean))];
  const c = old || { subject: assignedSubjs[0] || '', className: assignedClasses()[0] || '', group: '', status: 'published' };
  openModal(old ? 'কোর্স সম্পাদনা' : 'নতুন কোর্স তৈরি করুন', `<form id="teacherCourseForm" class="teacher-form">
    <div><label for="crs-className">শ্রেণি *</label><select id="crs-className" name="className" required>${classOptions(c.className)}</select></div>
    <div><label for="crs-group">বিভাগ (খালি রাখলে সব বিভাগ)</label><input id="crs-group" name="group" type="text" maxlength="80" value="${esc(c.group || '')}" placeholder="যেমন: বিজ্ঞান বিভাগ"></div>
    <div><label for="crs-subject">বিষয় *</label><input id="crs-subject" name="subject" type="text" maxlength="80" required list="teacherAssignedSubjects" value="${esc(c.subject || '')}"></div>
    <datalist id="teacherAssignedSubjects">${assignedSubjs.map(s => `<option value="${esc(s)}"></option>`).join('')}</datalist>
    <div><label for="crs-status">অবস্থা *</label><select id="crs-status" name="status"><option value="draft" ${c.status === 'draft' ? 'selected' : ''}>খসড়া</option><option value="published" ${c.status === 'published' ? 'selected' : ''}>প্রকাশিত</option></select></div>
    <p class="finance-error" id="teacherSaveError" role="alert" hidden></p>
    <div class="modal-actions"><button class="admin-btn primary" type="submit">সংরক্ষণ করুন</button><button class="admin-btn ghost" type="button" data-close-teacher>বাতিল</button></div>
  </form>`);
  $('#teacherCourseForm')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form));
    save(form, async () => {
      const res = await courseRepository.saveCourse({ ...values, id: old?.id });
      state.courses = res.courses || [];
      return state.db;
    }, 'কোর্স সংরক্ষণ করা হয়েছে');
  });
}

function showAddChapterModal(course) {
  if (!course || state.busy) return;
  const nextOrd = (course.chapters?.length || 0) + 1;
  openModal(`অধ্যায় যোগ করুন • ${course.subject}`, `<form id="teacherChapterForm" class="teacher-form">
    <div><label for="chp-title">অধ্যায়ের শিরোনাম *</label><input id="chp-title" name="title" type="text" maxlength="150" required placeholder="যেমন: অধ্যায় ১ — বাস্তব সংখ্যা"></div>
    <div><label for="chp-order">ক্রম *</label><input id="chp-order" name="order" type="number" min="1" max="200" step="1" value="${nextOrd}" required></div>
    <div><label for="chp-status">অবস্থা *</label><select id="chp-status" name="status"><option value="শুরু হয়নি">শুরু হয়নি</option><option value="চলছে">চলছে</option><option value="শেষ">শেষ</option></select></div>
    <p class="finance-error" id="teacherSaveError" role="alert" hidden></p>
    <div class="modal-actions"><button class="admin-btn primary" type="submit">অধ্যায় যোগ করুন</button><button class="admin-btn ghost" type="button" data-close-teacher>বাতিল</button></div>
  </form>`);
  $('#teacherChapterForm')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form));
    save(form, async () => {
      const res = await courseRepository.addChapter(course.id, values);
      state.courses = res.courses || [];
      return state.db;
    }, 'অধ্যায় যোগ করা হয়েছে');
  });
}

function render() { renderHome(); renderRecords(); renderTeacherClasses(); renderTeacherRoutine(); renderAcademicReports(); renderTeacherProfile(); renderAcademic(); renderNotices(); renderCourseChapters(); }
const ROUTINE_CHILD_VIEWS = Object.freeze(['routine-today', 'routine-tomorrow', 'routine-weekly', 'routine-class', 'routine-exam', 'routine-changed', 'routine-holiday', 'routine-important', 'routine-other']);
const TEACHER_VIEWS = Object.freeze(['home', 'academic', 'more', 'notice', 'exam', 'online-exams', 'courses', 'lecture-sheets', 'classes', 'class-chat', 'routine-view', 'reports', 'profile', ...ROUTINE_CHILD_VIEWS, ...Object.keys(ACTIVITY_TYPES)]);
let teacherChatFlight = null;
function mountTeacherClassChat() {
  const mount = $('#teacherClassChatMount');
  if (!mount) return;
  teacherChatFlight ??= import('./class-chat.js').catch(err => { teacherChatFlight = null; throw err; });
  void teacherChatFlight.then(mod => mod.mountClassChat(mount, { portal: 'teacher', getStaff: () => state.teacher }))
    .catch(err => console.warn('[Active Plus] teacher class-chat failed:', err?.message));
}
/* ক্লাস-screen tabs (owner order 2026-10-21): "ক্লাস ও বিষয়" and "রুটিন ও সময়সূচি"
   are separate tabs, never doors side by side. The first tab is the class list
   itself; the second is the route to the read-only routine screen. একাডেমিক
   কার্যক্রম left this screen entirely — it is its own feature card on Home. */
function syncClassTabs(active = 'list') {
  $$('.teacher-class-tabs [role="tab"]').forEach(tab => {
    const selected = (tab.dataset.classTab || '') === active;
    tab.setAttribute('aria-selected', String(selected));
    tab.classList.toggle('is-active', selected);
  });
}
/* লেকচার শিট স্টুডিও (owner decision 2026-10-28): the same manager the Admin
   panel mounts, started with the teacher role so the store only ever offers the
   classes/subjects this teacher is assigned. */
let teacherLectureFlight = null;
function mountTeacherLectureSheets() {
  const mount = $('#teacherLectureSheetsMount');
  if (!mount) return;
  teacherLectureFlight ??= import('./lecture-sheet-studio.js')
    .catch(err => { teacherLectureFlight = null; throw err; });
  void teacherLectureFlight
    .then(mod => mod.mountLectureSheetManager({ mount, role: 'teacher', toast: message => toast(message) }))
    .catch(err => console.warn('[Active Plus] teacher lecture studio failed:', err?.message));
}

function setView(view) {
  if (!TEACHER_VIEWS.includes(view)) return;
  /* The nine routine pages are one screen now; their routes stay as aliases
     so old deep links and notifications keep landing on the right tab. */
  if (ROUTINE_CHILD_VIEWS.includes(view)) { state.routineTab = view.slice('routine-'.length); view = 'routine-view'; }
  const previous = state.view;
  // A search typed for one record type must not silently hide the next one.
  if (ACTIVITY_TYPES[view] && previous !== view) {
    const search = $('#teacherRecordSearch');
    if (search) search.value = '';
    state.recordLimit = 15;
  }
  state.view = view;
  const panel = ACTIVITY_TYPES[view] ? 'teacherRecords' : { home: 'teacherHome', academic: 'teacherAcademic', notice: 'teacherNotice', exam: 'teacherOnlineExams', more: 'teacherMore', 'online-exams': 'teacherOnlineExams', courses: 'teacherCourses', 'lecture-sheets': 'teacherLectureSheets', classes: 'teacherClasses', 'class-chat': 'teacherClassChat', 'routine-view': 'teacherRoutine', reports: 'teacherAcademicReports', profile: 'teacherProfile' }[view];
  $$('.teacher-view').forEach(el => { el.hidden = el.id !== panel; });
  const isChatFullscreen = view === 'class-chat';
  $('#teacherShell')?.classList.toggle('is-chat-fullscreen', isChatFullscreen);
  $('#teacherMain')?.classList.toggle('is-chat-view', isChatFullscreen);
  if (isChatFullscreen) mountTeacherClassChat();
  delete $('#teacherRecords')?.dataset.recordsOpen;
  delete $('#teacherNotice')?.dataset.noticeOpen;
  delete $('#teacherRoutine')?.dataset.routineOpen;
  delete $('#teacherAcademicReports')?.dataset.reportsOpen;
  delete $('#teacherCourses')?.dataset.coursesOpen;
  if (panel === 'teacherClasses') syncClassTabs('list');
  $$('.teacher-type-tabs [data-type-tab]').forEach(el => {
    const active = el.dataset.typeTab === view;
    el.classList.toggle('active', active);
    el.setAttribute('aria-selected', String(active));
    if (el.matches('.pay-tile')) el.setAttribute('aria-pressed', String(active));
  });
  /* The bottom bar keeps its four seats: the academic/class screens light up
     the ক্লাস seat, the class-test results the পরীক্ষা seat. */
  const bottomView = view === 'home' ? 'home'
    : ['academic', 'classes', 'class-chat', 'homework', 'suggestion', 'courses', 'lecture-sheets', 'notice', 'routine', 'routine-view', ...ROUTINE_CHILD_VIEWS].includes(view) ? 'classes'
        : ['exam', 'online-exams'].includes(view) ? 'online-exams' : 'more';
  $$('.admin-bottom [data-teacher-view]').forEach(el => {
    const active = el.dataset.teacherView === bottomView;
    el.classList.toggle('active', active);
    if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });
  // Returning to the Teacher's Settings screen always opens the group menu.
  if (view === 'lecture-sheets') mountTeacherLectureSheets();
  if (view === 'profile') {
    resetSettingsHub('[data-settings-hub="teacher"]');
    $$('#teacherSettingsTabs [data-settings-tab]').forEach(btn => {
      const active = btn.dataset.settingsTab === 'all';
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }
  paintTeacherExam();
  $('#teacherMain').scrollTo({ top: 0, behavior: 'instant' }); render();
  // The open page lives in the URL, so a refresh lands back on it.
  rememberRoute(view);
}
async function reload() {
  try {
    /* WHO is at the panel decides what is fetched: the active staff identity's
       own Login User ID / Staff ID, never a hard-coded role account. */
    const teacher = await currentTeacherProfile();
    setTeachingScope(teacher?.username || 'teacher.apc', teacher?.staffId && teacher?.kind !== 'system' ? teacher.staffId : '');
    /* Self-heal: a teacher record saved before the projection bridge existed
       is projected now, before any scope gate reads the store. */
    try {
      if (teacher?.assignment) syncTeacherAssignmentFromDirectory(teacher);
    } catch { /* best-effort: the merged read below still answers */ }
    const [db, students, courseData, examData] = await Promise.all([teachingRepository.list(), teachingRepository.listStudents(), courseRepository.list({ role: 'teacher' }).catch(() => ({ courses: [] })), examRepository.list({ role: 'teacher' }).catch(() => null)]);
    state.db = db; state.courses = courseData.courses || []; state.students = students; state.teacher = teacher; state.exams = examData?.exams || null;
    state.assignments = await effectiveTeacherAssignments(teacher?.username || 'teacher.apc');
    state.ready = true;
    ['teacherClassFilter', 'teacherNoticeClass'].forEach(id => {
      const select = $('#' + id), selected = select.value;
      select.innerHTML = `<option value="all">সব নির্ধারিত শ্রেণি</option>${classOptions(selected)}`;
      if ([...select.options].some(option => option.value === selected)) select.value = selected; else select.value = 'all';
    });
    if ($('#teacherDataError')) $('#teacherDataError').hidden = true; render(); return true;
  } catch {
    state.ready = false; if ($('#teacherDataError')) $('#teacherDataError').hidden = false; if ($('#teacherClassList')) renderTeacherClasses(); return false;
  }
}
function openModal(title, html) {
  if ($('#teacherModalBackdrop').hidden) modalTrigger = document.activeElement;
  $('#teacherModalClose').textContent = '×';
  $('#teacherModalClose').setAttribute('aria-label', 'বন্ধ করুন');
  $('#teacherModalTitle').textContent = title;
  $('#teacherModalBody').innerHTML = html;
  syncAllDateInputs($('#teacherModalBody'));
  $('#teacherModalBackdrop').hidden = false; document.body.classList.add('admin-modal-open');
  $('#teacherModalBackdrop .admin-modal').scrollTop = 0;
  $('#teacherModalClose').focus();
}
function closeModal() {
  if (state.busy) return;
  $('#teacherModalBackdrop').hidden = true; document.body.classList.remove('admin-modal-open');
  const target = modalTrigger?.isConnected && modalTrigger.getClientRects().length && !modalTrigger.disabled ? modalTrigger : $('.admin-bottom-item.active');
  target?.focus({ preventScroll: true });
}
function showEditor(type, old = null) {
  if (type === 'exam') return setView('online-exams');
  if (!state.ready || state.busy) return toast('আগে ডেটা লোড হতে দিন বা আবার চেষ্টা করুন।');
  const a = old || { type, date: todayISO(), time: '17:00', duration: 60, totalMarks: 100, status: type === 'homework' ? 'published' : 'draft', className: assignedClasses()[0] || '' };
  const timed = ['exam', 'routine'].includes(type);
  const field = (name, label, inputType = 'text', extra = '') => `<div><label for="activity-${name}">${label}</label><input id="activity-${name}" name="${name}" type="${inputType}" value="${esc(a[name] ?? '')}" ${extra}></div>`;
  openModal(`${old ? 'সম্পাদনা: ' : 'নতুন '}${ACTIVITY_TYPES[type].label}`, `<form id="teacherActivityForm" class="teacher-form">
    ${field('title', 'শিরোনাম *', 'text', 'required maxlength="150"')}
    ${field('subject', 'বিষয় *', 'text', 'required maxlength="80"')}
    <div><label for="activity-className">শ্রেণি *</label><select id="activity-className" name="className" required>${classOptions(a.className)}</select></div>
    ${field('group', 'বিভাগ (খালি রাখলে সব বিভাগ)', 'text', 'maxlength="80" list="teacherGroups" placeholder="যেমন: বিজ্ঞান বিভাগ"')}
    <datalist id="teacherGroups">${[...new Set(['বিজ্ঞান বিভাগ', 'মানবিক', 'ব্যবসায় শিক্ষা', 'সাধারণ', ...state.students.map(s => s.group).filter(Boolean)])].map(g => `<option value="${esc(g)}"></option>`).join('')}</datalist>
    ${type !== 'suggestion' ? field('date', type === 'homework' ? 'জমার শেষ তারিখ *' : 'তারিখ *', 'date', 'required') + field('time', type === 'homework' ? 'জমার শেষ সময় *' : 'শুরুর সময় *', 'time', 'required') : ''}
    ${timed ? field('duration', 'সময়কাল (মিনিট) *', 'number', 'min="5" max="300" step="1" required') + field('room', 'রুম / স্থান', 'text', 'maxlength="120"') : ''}
    ${type === 'exam' ? field('totalMarks', 'পূর্ণমান *', 'number', 'min="1" max="1000" step="1" required') : ''}
    <div><label for="activity-details">${type === 'exam' ? 'সিলেবাস / প্রশ্ন ও নির্দেশনা' : type === 'homework' ? 'কাজের বিবরণ ও নির্দেশনা' : type === 'suggestion' ? 'সাজেশন / নোট' : 'ক্লাসের বিবরণ'}</label><textarea id="activity-details" name="details" rows="5" maxlength="3000">${esc(a.details || '')}</textarea></div>
    ${field('resourceURL', 'সহায়ক লিংক (ঐচ্ছিক)', 'url', 'maxlength="1000" placeholder="https://…"')}
    <div><label for="activity-status">অবস্থা *</label><select id="activity-status" name="status"><option value="draft" ${a.status === 'draft' ? 'selected' : ''}>খসড়া — শুধু শিক্ষক দেখবেন</option><option value="published" ${a.status === 'published' ? 'selected' : ''}>প্রকাশিত — শিক্ষার্থী দেখবে</option></select></div>
    <p class="finance-hint">প্রকাশিত কাজ নির্দিষ্ট শ্রেণি/বিভাগের শিক্ষার্থী অ্যাপে দেখা যাবে (একই ব্রাউজারে)।</p>
    <p class="finance-error" id="teacherSaveError" role="alert" hidden></p>
    <div class="modal-actions"><button class="admin-btn primary" type="submit">সংরক্ষণ করুন</button><button class="admin-btn ghost" type="button" data-close-teacher>বাতিল</button></div>
  </form>`);
  if (type === 'homework') prepareHomeworkEditor(a);
  $('#teacherActivityForm').addEventListener('submit', event => {
    event.preventDefault(); const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form));
    /* One check for every content type (homework/suggestion/attendance/exam):
       the toast repeats the status the student panel will read — published
       content says প্রকাশিত, a draft says it stays hidden from students. */
    const message = values.status === 'published'
      ? `${ACTIVITY_TYPES[type].label} প্রকাশিত হয়েছে — শিক্ষার্থীরা পড়াশোনাবিভাগে দেখতে পাবেন।`
      : `${ACTIVITY_TYPES[type].label} খসড়া হিসেবে সংরক্ষিত হয়েছে — শিক্ষার্থীরা এখনো দেখবেন না।`;
    save(form, () => teachingRepository.saveActivity({ ...values, type, id: old?.id, date: type === 'suggestion' ? a.date : values.date }), message);
  });
}
// Reuse the same fields, validation and saveActivity path. The simplified
// homework screen keeps optional controls discoverable without duplicating data.
function prepareHomeworkEditor(activity) {
  const form = $('#teacherActivityForm');
  /* ২০২৬-১০-২০: হোমওয়ার্ক ফর্ম আর অস্বচ্ছ ফুল-স্ক্রিন টেকওভার নয় — অ্যাপের অন্য
     সব ডায়ালগের (সাজেশন/নোটিশ) মতোই একই স্ট্যান্ডার্ড মডাল/বটম-শিট, যাতে
     হেডার-ফুটার বোঝা যায় এবং সব ফর্মের ফরম্যাট এক রকম থাকে। ফর্মের ফিল্ড-আইকন
     স্টাইলিং teacher-homework-form ক্লাসেই থাকে। */
  form.classList.add('teacher-homework-form');
  form.addEventListener('invalid', event => {
    const details = event.target.closest('details');
    if (details) details.open = true;
  }, true);
  const wrap = name => $('#activity-' + name)?.parentElement;
  const symbols = {
    className: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-17a3 3 0 0 1 0 6m1 4a6 6 0 0 1 3 5v2"/>',
    subject: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M10 3v18m4-13h1m-1 4h1"/>',
    title: '<path d="m4 15 12-12 5 5L9 20l-6 1Zm10-10 5 5M4 15l5 5"/>',
    details: '<path d="M4 5h16M4 10h16M4 15h16M4 20h10"/>',
    date: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18"/>',
    time: '<circle cx="12" cy="12" r="9"/><path d="M12 6v7l4 2"/>',
    resourceURL: '<path d="m9 16 8-8a3 3 0 0 0-4-4L4 13a5 5 0 0 0 7 7l9-9m-14 5 9-9"/>'
  };
  for (const name of Object.keys(symbols)) {
    const node = wrap(name);
    if (!node) continue;
    node.classList.add('homework-field', `homework-field-${name}`);
    const icon = document.createElement('span'); icon.className = 'homework-field-icon';
    icon.setAttribute('aria-hidden', 'true'); icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${symbols[name]}</svg>`; node.prepend(icon);
  }
  $('#activity-title').placeholder = 'কাজের শিরোনাম';
  $('#activity-details').placeholder = 'বিস্তারিত নির্দেশনা লিখুন…';
  $('#activity-resourceURL').placeholder = 'https://…';
  const classSelect = $('#activity-className');
  classSelect.innerHTML = state.assignments.map(assignment => `<option value="${esc(assignment.className)}" data-group="${esc(assignment.group || '')}" ${assignment.className === activity.className && (!activity.group || assignment.group === activity.group) ? 'selected' : ''}>শ্রেণি: ${esc(assignment.className)}${assignment.group ? ` · ${esc(assignment.group)}` : ''}</option>`).join('');
  const subjects = document.createElement('datalist'); subjects.id = 'homeworkAssignedSubjects';
  $('#activity-subject').setAttribute('list', subjects.id); form.append(subjects);
  function syncScope(initial = false) {
    const group = classSelect.selectedOptions[0]?.dataset.group || '';
    if (!initial || !activity.id) $('#activity-group').value = group;
    const choices = [...new Set(state.assignments.filter(item => item.className === classSelect.value && (!group || item.group === group))
      .flatMap(item => item.subjects?.length ? item.subjects : [item.subject]).filter(Boolean))].filter(subject => subject !== 'Test');
    subjects.innerHTML = choices.map(subject => `<option value="${esc(subject)}"></option>`).join('');
    if (choices.length === 1 && (!initial || !$('#activity-subject').value)) $('#activity-subject').value = choices[0];
    else if (!initial && choices.length && !choices.includes($('#activity-subject').value)) $('#activity-subject').value = '';
    $('#activity-subject').placeholder = choices.length ? 'বিষয় বেছে নিন' : 'বিষয় লিখুন';
  }
  classSelect.addEventListener('change', () => syncScope()); syncScope(true);
  const attachments = document.createElement('details'); attachments.className = 'homework-attachment';
  const attachmentTitle = document.createElement('summary'); attachmentTitle.textContent = 'ফাইল বা ছবির লিংক যোগ করুন'; attachments.append(attachmentTitle, wrap('resourceURL'));
  const help = document.createElement('p'); help.textContent = 'শেয়ারযোগ্য https লিংক দিন। এই ফর্মে সরাসরি ফাইল আপলোড হয় না।'; attachments.append(help);
  if (activity.resourceURL) attachments.open = true;
  const advanced = document.createElement('details'); advanced.className = 'homework-options';
  const optionsTitle = document.createElement('summary'); optionsTitle.textContent = 'জমার সময়, বিভাগ ও খসড়ার সেটিংস'; advanced.append(optionsTitle, wrap('time'), wrap('group'), wrap('status'));
  const deadlineNote = document.createElement('p'); deadlineNote.textContent = 'জমার তারিখের সঙ্গে নিচের সেটিংসে দেওয়া সময়ও প্রযোজ্য।'; advanced.append(deadlineNote);
  const error = $('#teacherSaveError'), actions = form.querySelector('.modal-actions');
  const fields = ['className', 'subject', 'title', 'details', 'date'].map(wrap);
  fields.forEach(node => form.append(node)); form.append(attachments, advanced);
  const scopeHint = form.querySelector('.finance-hint'); if (scopeHint) form.append(scopeHint);
  form.append(error, actions);
  const submit = form.querySelector('[type="submit"]');
  const syncStatus = () => { submit.textContent = $('#activity-status').value === 'published' ? 'প্রকাশ করুন' : 'খসড়া সংরক্ষণ করুন'; };
  $('#activity-status').addEventListener('change', syncStatus); syncStatus();
}

async function save(form, operation, message) {
  if (state.busy || !state.ready) return;
  state.busy = true; form.setAttribute('aria-busy', 'true'); $('#teacherSaveError').hidden = true;
  const controls = [...form.querySelectorAll('input, select, textarea, button')];
  controls.forEach(el => { el.disabled = true; });
  const submit = form.querySelector('[type=submit]'), label = submit.textContent; submit.textContent = 'সংরক্ষণ হচ্ছে…';
  let success = false;
  try { state.db = await operation(); render(); success = true; }
  catch (error) {
    $('#teacherSaveError').textContent = error instanceof DOMException ? 'সংরক্ষণ হয়নি। ব্রাউজারের স্টোরেজ/খালি জায়গা পরীক্ষা করে আবার চেষ্টা করুন।' : error.message || 'সংরক্ষণ হয়নি। আবার চেষ্টা করুন।';
    $('#teacherSaveError').hidden = false;
  } finally { state.busy = false; form.removeAttribute('aria-busy'); controls.forEach(el => { el.disabled = false; }); submit.textContent = label; }
  if (success) { closeModal(); toast(message); }
}
function showDetail(a) {
  const link = safeResourceURL(a.resourceURL);
  openModal(a.title, `<article class="teaching-card"><span class="teaching-kind">${ACTIVITY_TYPES[a.type].label} • ${a.status === 'draft' ? 'খসড়া' : 'প্রকাশিত'}</span><h3>${esc(a.subject)}</h3><small>${esc(a.className)} • ${esc(a.group || 'সব বিভাগ')}</small><p>${esc(activityMeta(a))}</p><small>${esc(a.room)}</small><p class="teaching-body">${esc(a.details || 'অতিরিক্ত নির্দেশনা নেই।')}</p>${link ? `<a class="teaching-resource" href="${esc(link)}" target="_blank" rel="noopener noreferrer">সহায়ক উপকরণ খুলুন <svg class="resource-arrow" aria-hidden="true" viewBox="0 0 24 24"><path d="M7 17 17 7M9 7h8v8"/></svg></a>` : ''}<div class="teaching-actions"><button type="button" data-record-action="edit" data-id="${esc(a.id)}">সম্পাদনা</button>${ACTIVITY_TYPES[a.type].progress && a.status === 'published' ? `<button type="button" class="primary" data-record-action="progress" data-id="${esc(a.id)}">${ACTIVITY_TYPES[a.type].progress}</button>` : ''}</div></article>`);
}
function showProgress(a) {
  if (a.status !== 'published' || !ACTIVITY_TYPES[a.type].progress) return;
  const students = rosterFor(a);
  const isExam = a.type === 'exam';
  const options = isExam ? [] : a.type === 'homework' ? ['pending', 'done', 'reviewed'] : ['present', 'absent', 'late'];
  const quickFills = isExam
    ? [{ value: '', label: 'সব ঘর খালি করুন' }]
    : a.type === 'homework'
      ? [{ value: 'done', label: 'সবাই জমা দিয়েছে' }, { value: 'reviewed', label: 'সবাই দেখা হয়েছে' }]
      : [{ value: 'present', label: 'সবাই উপস্থিত' }, { value: 'late', label: 'সবাই দেরিতে' }, { value: 'absent', label: 'সবাই অনুপস্থিত' }];

  openModal(`${ACTIVITY_TYPES[a.type].progress} • ${a.title}`, `<p class="modal-copy">${esc(a.className)} • ${esc(a.group || 'সব বিভাগ')}${isExam ? ` • পূর্ণমান ${bn(a.totalMarks)}। খালি রাখলে নম্বর প্রকাশ হবে না।` : ''}</p>
    ${students.length ? `<form id="teacherProgressForm">
      <div class="teacher-progress-bar">
        <p class="progress-summary" id="teacherProgressSummary" role="status"></p>
        <div class="teacher-quick-fill">
          ${quickFills.map(fill => `<button type="button" data-quick-fill="${esc(fill.value)}">${fill.label}</button>`).join('')}
          <button type="button" id="teacherOnlyMissing" aria-pressed="false">শুধু বাকিরা</button>
        </div>
        ${students.length > 6 ? `<label for="teacherProgressSearch">শিক্ষার্থী খুঁজুন</label><input id="teacherProgressSearch" type="search" placeholder="নাম বা শিক্ষার্থী আইডি" autocomplete="off">` : ''}
      </div>
      <div class="teacher-progress-list">${students.map((student, index) => {
        const p = a.progress[student.id] || {};
        const value = p.value ?? '';
        const comment = p.comment ?? '';
        const answer = p.answer ?? '';
        const withComment = ['homework', 'exam'].includes(a.type);
        const search = `${student.name} ${student.id}`.toLocaleLowerCase();
        return `<div class="teacher-progress-row" data-progress-row data-search="${esc(search)}">
          <label for="progress-${index}">${esc(student.name)}<small>${esc(student.id)}</small></label>
          ${isExam ? `<input type="number" id="progress-${index}" data-progress-id="${esc(student.id)}" data-original="${esc(value)}" value="${esc(value)}" min="0" max="${a.totalMarks}" step="0.5" placeholder="নম্বর দিন">` : `<select id="progress-${index}" data-progress-id="${esc(student.id)}" data-original="${esc(value)}"><option value="">এখনও নথিভুক্ত হয়নি</option>${options.map(v => `<option value="${v}" ${v === value ? 'selected' : ''}>${PROGRESS_LABELS[v]}</option>`).join('')}</select>`}
          ${a.type === 'homework' && answer ? `<div class="teacher-student-answer" data-student-answer-for="${esc(student.id)}"><small>লিখিত উত্তর: ${esc(answer)}</small> <button type="button" class="admin-btn ghost" data-mark-reviewed="${esc(student.id)}">দেখা হয়েছে</button></div>` : ''}
          ${withComment ? `<input type="text" maxlength="200" data-progress-comment="${esc(student.id)}" data-original-comment="${esc(comment)}" value="${esc(comment)}" placeholder="মন্তব্য (সর্বোচ্চ ২০০ অক্ষর, ঐচ্ছিক)">` : ''}
        </div>`;
      }).join('')}</div>
      <p class="finance-error" id="teacherSaveError" role="alert" hidden></p>
      <div class="modal-actions"><button class="admin-btn primary" type="submit">সংরক্ষণ করুন</button><button class="admin-btn ghost" type="button" data-close-teacher>বাতিল</button></div>
    </form>` : '<p class="teacher-empty">এই শ্রেণি/বিভাগে কোনো অনুমোদিত শিক্ষার্থী নেই।</p>'}`);

  const form = $('#teacherProgressForm');
  if (!form) return;
  const rows = () => [...form.querySelectorAll('[data-progress-row]')];
  const filled = el => el.value !== '';
  function updateSummary() {
    const fields = [...form.querySelectorAll('[data-progress-id]')];
    const done = fields.filter(filled).length;
    const summary = $('#teacherProgressSummary');
    if (summary) {
      summary.textContent = `${bn(students.length)} জনের ${bn(done)} জন নথিভুক্ত` + (done < students.length ? ` • বাকি ${bn(students.length - done)} জন` : ' • সব সম্পূর্ণ');
      summary.classList.toggle('complete', done >= students.length && students.length > 0);
    }
  }
  function applyRowFilter() {
    const query = ($('#teacherProgressSearch')?.value || '').trim().toLocaleLowerCase();
    const onlyMissing = $('#teacherOnlyMissing')?.getAttribute('aria-pressed') === 'true';
    rows().forEach(row => {
      const field = row.querySelector('[data-progress-id]');
      const matchesQuery = !query || row.dataset.search.includes(query);
      const matchesMissing = !onlyMissing || !filled(field);
      row.hidden = !(matchesQuery && matchesMissing);
    });
  }
  updateSummary();

  $('#teacherOnlyMissing')?.addEventListener('click', event => {
    const button = event.currentTarget;
    button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
    applyRowFilter();
  });
  $('#teacherProgressSearch')?.addEventListener('input', applyRowFilter);
  form.querySelectorAll('[data-quick-fill]').forEach(button => button.addEventListener('click', () => {
    const value = button.dataset.quickFill;
    rows().filter(row => !row.hidden).forEach(row => { row.querySelector('[data-progress-id]').value = value; });
    updateSummary(); applyRowFilter();
  }));
  form.addEventListener('input', updateSummary);
  form.addEventListener('change', () => { updateSummary(); applyRowFilter(); });
  form.querySelectorAll('[data-mark-reviewed]').forEach(btn => btn.addEventListener('click', () => {
    const sid = btn.dataset.markReviewed;
    const sel = form.querySelector(`[data-progress-id="${sid}"]`);
    if (sel) { sel.value = 'reviewed'; updateSummary(); applyRowFilter(); }
  }));
  form.addEventListener('submit', event => {
    event.preventDefault(); const target = event.currentTarget;
    if (!target.reportValidity()) return;
    const entries = {};
    for (const el of target.querySelectorAll('[data-progress-id]')) {
      const sid = el.dataset.progressId;
      const commentEl = target.querySelector(`[data-progress-comment="${sid}"]`);
      const valChanged = el.value !== el.dataset.original;
      const commentChanged = commentEl && commentEl.value !== commentEl.dataset.originalComment;
      if (valChanged || commentChanged) {
        entries[sid] = commentEl && (commentChanged || commentEl.value.trim())
          ? { value: el.value, comment: commentEl.value.trim() }
          : el.value;
      }
    }
    save(target, () => teachingRepository.saveProgress(a.id, entries), 'শিক্ষার্থীদের অগ্রগতি সংরক্ষণ করা হয়েছে — শিক্ষার্থীদের অ্যাপেও আপডেট দেখা যাবে');
  });
}

function showDelete(a) {
  openModal('কাজটি মুছে ফেলবেন?', `<form id="teacherDeleteForm"><p class="modal-copy"><strong>${esc(a.title)}</strong> মুছে গেলে শিক্ষার্থী অ্যাপ থেকেও সরে যাবে। এই কাজের নম্বর, জমার অবস্থা বা উপস্থিতিও মুছে যাবে।</p><p class="finance-error" id="teacherSaveError" role="alert" hidden></p><div class="modal-actions"><button class="admin-btn ghost" type="button" data-close-teacher>না, রাখুন</button><button class="admin-btn primary" type="submit">হ্যাঁ, মুছে ফেলুন</button></div></form>`);
  $('#teacherDeleteForm').addEventListener('submit', event => { event.preventDefault(); save(event.currentTarget, () => teachingRepository.deleteActivity(a.id), 'কাজটি মুছে ফেলা হয়েছে'); });
}
['teacherClassFilter'].forEach(id => { $('#' + id).insertAdjacentHTML('beforeend', classOptions()); });
/* ---- একাডেমিক hub, notice composer and quick actions ------------------------ */

/** Which academic section is which: the hub card targets an existing screen. */
const ACADEMIC_SECTIONS = Object.freeze({
  homework: { view: 'homework' },
  suggestion: { view: 'suggestion' },
  bank: { view: 'online-exams', screen: 'bank' },
  materials: { view: 'courses' },
  exams: { view: 'online-exams', screen: 'new-mcq' },
  notice: { view: 'notice' }
});

/* One landing, four doors: the old nine-tile shelf sent five tiles to the same
   workspace view — the CTA above opens it on its home (where the create
   buttons live), the chips pick a list, and marks stay on the records tab. */
const EXAM_SCREENS = Object.freeze({
  bank: 'bank', upcoming: 'upcoming', archive: 'archive', home: 'home', 'new-mcq': 'new-mcq'
});
function paintTeacherExam() {
  const hub = $('#teacherExamHub');
  const actions = $('#teacherExamActions');
  const workspace = $('#teacherExamWorkspace');
  const examsView = $('#teacherOnlineExams');
  if (!hub || !workspace) return;
  const screen = state.view === 'online-exams' || state.view === 'exam' ? state.examScreen : '';
  const open = Boolean(screen);
  hub.hidden = open;
  if (actions) actions.hidden = open;
  workspace.hidden = !open;
  if (examsView) {
    if (open && (state.examTileKey || screen)) examsView.dataset.examTileOpen = state.examTileKey || screen;
    else delete examsView.dataset.examTileOpen;
  }
  $$('#teacherOnlineExams [data-teacher-exam]').forEach(btn => {
    const active = Boolean(open && btn.dataset.teacherExam === (state.examTileKey || screen));
    btn.classList.toggle('is-open', active);
    btn.setAttribute('aria-expanded', active ? 'true' : 'false');
  });
  if (open) examWorkspace?.open?.(screen);
}
function renderAcademic() {
  const host = $('#teacherAcademicScope');
  if (!host) return;
  const classes = assignedClasses();
  host.textContent = classes.length
    ? `আপনার নির্ধারিত শ্রেণি: ${classes.join(' • ')} — এই শ্রেণি/বিষয়ের কাজ এখানে যোগ হবে।`
    : 'ম্যানেজার এখনো কোনো শ্রেণি/ব্যাচ নির্ধারণ করেননি। নির্ধারণ পেলে একাডেমিক কাজ খুলে যাবে।';
  const records = own();
  const counts = {
    homework: records.filter(a => a.type === 'homework').length,
    suggestion: records.filter(a => a.type === 'suggestion').length,
    exams: records.filter(a => a.type === 'exam').length
  };
  Object.entries(counts).forEach(([key, value]) => {
    const node = $(`[data-academic-count="${key}"]`);
    if (!node) return;
    const waiting = records.filter(a => a.type === key && isActionablePending(a)).length;
    /* The card shows what is waiting on the teacher first, the total count second. */
    node.textContent = waiting ? `${bn(waiting)} বাকি` : value ? bn(value) : '';
    node.classList.toggle('is-pending', Boolean(waiting));
  });
  const bank = $('[data-academic-count="bank"]');
  const materials = $('[data-academic-count="materials"]');
  if (bank) bank.textContent = '';
  if (materials) materials.textContent = '';
  if (!state.assignments.length) return;
  /* Counts come from the same stores the sections show — nothing is copied,
     and a read that needs a staff session can never break the panel. */
  listQuestionsForStaff('teacher')
    .then(rows => { if (bank && Array.isArray(rows)) bank.textContent = rows.length ? bn(rows.length) : ''; })
    .catch(() => {});
  try {
    const rows = assignedClasses().flatMap(className => {
      const record = classByName(className);
      return record ? listCourseContent({ classId: record.id, publishedOnly: false, includeInactive: true }) : [];
    });
    if (materials) materials.textContent = rows.length ? bn(rows.length) : '';
  } catch { /* the material shelf count can wait for its own screen */ }
}

/** The notices this teacher wrote; every other notice stays out of this list. */
function ownNotices(username) {
  return loadNotices().filter(notice => notice && notice.createdByRole === 'teacher' && notice.createdBy === username);
}

function noticeAudienceLabel(notice) {
  return `${notice.className || 'সব শ্রেণি'}${notice.group ? ' • ' + notice.group : ''}`;
}

function renderNotices() {
  const host = $('#teacherNoticeList');
  if (!host) return;
  const username = String(state.teacher?.username || 'teacher.apc');
  const className = $('#teacherNoticeClass')?.value || 'all';
  const mine = ownNotices(username).slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const list = mine.filter(notice => className === 'all' || notice.className === className);
  const count = $('#teacherNoticeCount');
  if (count) count.textContent = `${bn(list.length)}টি নোটিশ${className === 'all' ? '' : ' • ' + esc(className)}`;
  const badge = $('[data-academic-count="notice"]');
  if (badge) badge.textContent = mine.length ? bn(mine.length) : '';
  host.innerHTML = list.map(notice => `<article class="teaching-card" data-notice-id="${esc(notice.id)}">
    <div class="teaching-card-head"><span class="teaching-kind">নোটিশ</span><span class="teaching-status ${notice.status === 'published' ? 'published' : 'draft'}">${notice.status === 'published' ? 'প্রকাশিত' : 'খসড়া'}</span></div>
    <h3>${esc(notice.title)}</h3><small>${esc(noticeAudienceLabel(notice))} • ${esc(displayDate(String(notice.createdAt || '').slice(0, 10)))}</small>
    <p class="teaching-preview">${esc(notice.body || '')}</p>
    <div class="teaching-actions">
      <button type="button" data-notice-action="edit" data-id="${esc(notice.id)}">সম্পাদনা</button>
      <button type="button" class="${notice.status === 'published' ? '' : 'primary'}" data-notice-action="toggle" data-id="${esc(notice.id)}">${notice.status === 'published' ? 'প্রকাশ বন্ধ করুন' : 'প্রকাশ করুন'}</button>
      <button class="danger" type="button" data-notice-action="delete" data-id="${esc(notice.id)}">মুছুন</button>
    </div></article>`).join('')
    || `<p class="teacher-empty">${mine.length ? 'এই শ্রেণির কোনো নোটিশ নেই।' : 'এখনও কোনো নোটিশ লেখা হয়নি। “+ নোটিশ” চেপে শ্রেণি/ব্যাচের জন্য ঘোষণা দিন।'}</p>`;
}

/** The composer writes exactly the record the student notice board reads. */
function showNoticeEditor(old = null) {
  if (!state.ready || state.busy) return toast('আগে ডেটা লোড হতে দিন বা আবার চেষ্টা করুন।');
  const draft = old || { title: '', body: '', category: 'academic', className: assignedClasses()[0] || '', group: '', status: 'published' };
  const categories = NOTICE_CATEGORIES.map(category => `<option value="${esc(category.id)}" ${draft.category === category.id ? 'selected' : ''}>${esc(category.label)}</option>`).join('');
  openModal(`${old ? 'নোটিশ সম্পাদনা' : 'নতুন নোটিশ'}`, `<form id="teacherNoticeForm" class="teacher-form">
    <div><label for="notice-title">শিরোনাম *</label><input id="notice-title" name="title" type="text" required maxlength="150" value="${esc(draft.title)}"></div>
    <div><label for="notice-body">ঘোষণা *</label><textarea id="notice-body" name="body" rows="5" required maxlength="2000">${esc(draft.body)}</textarea></div>
    <div><label for="notice-category">ধরন</label><select id="notice-category" name="category">${categories}</select></div>
    <div><label for="notice-className">শ্রেণি *</label><select id="notice-className" name="className" required><option value="">সব শ্রেণি</option>${classOptions(draft.className)}</select></div>
    <div><label for="notice-group">ব্যাচ / বিভাগ (খালি রাখলে পুরো শ্রেণি)</label><input id="notice-group" name="group" type="text" maxlength="80" value="${esc(draft.group)}" list="teacherGroups" placeholder="যেমন: বিজ্ঞান বিভাগ"></div>
    <div><label for="notice-status">অবস্থা</label><select id="notice-status" name="status"><option value="published" ${draft.status !== 'draft' ? 'selected' : ''}>প্রকাশিত — শিক্ষার্থী দেখবে</option><option value="draft" ${draft.status === 'draft' ? 'selected' : ''}>খসড়া — শুধু আপনি দেখবেন</option></select></div>
    <p class="finance-error" id="teacherSaveError" role="alert" hidden></p>
    <div class="modal-actions"><button class="admin-btn primary" type="submit">সংরক্ষণ করুন</button><button class="admin-btn ghost" type="button" data-close-teacher>বাতিল</button></div>
  </form>`);
  $('#teacherNoticeForm').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form));
    /* The toast must state the status the student board will actually show:
       "প্রকাশিত" reaches the notice board, "খসড়া" stays teacher-only. */
    const message = values.status === 'draft'
      ? 'নোটিশ খসড়া হিসেবে সংরক্ষিত হয়েছে — শিক্ষার্থীরা এখনো দেখবেন না।'
      : old ? 'নোটিশ আপডেট করা হয়েছে — শিক্ষার্থীদের নোটিশ বোর্ডে দেখা যাচ্ছে।'
        : 'নোটিশ প্রকাশ হয়েছে — শিক্ষার্থীদের নোটিশ বোর্ডে চলে এসেছে।';
    save(form, () => saveNoticeRecord(values, old), message);
  });
}

/** Append or update one notice in the shared store; nothing else is touched. */
async function saveNoticeRecord(values, old) {
  const username = String(state.teacher?.username || 'teacher.apc');
  const name = String(state.teacher?.fullName || username);
  const className = String(values.className || '').trim();
  const group = String(values.group || '').trim();
  if (!className || !assignedClasses().includes(className)) {
    throw new Error('নিজ নির্ধারিত শ্রেণি নির্বাচন করুন।');
  }
  const notices = loadNotices();
  const now = new Date().toISOString();
  const record = {
    id: old?.id || `notice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title: String(values.title || '').trim().slice(0, 150),
    body: String(values.body || '').trim().slice(0, 2000),
    category: String(values.category || 'academic'),
    audience: old?.audience || 'সকল শিক্ষার্থী',
    className,
    group,
    classId: normalizeClassId(className),
    sectionId: normalizeSectionId(group),
    teacherId: currentTeacherId(),
    status: values.status === 'draft' ? 'draft' : 'published',
    createdAt: old?.createdAt || now,
    updatedAt: now,
    createdBy: username,
    createdByRole: 'teacher',
    authorName: name
  };
  const index = notices.findIndex(notice => notice?.id === record.id);
  if (index < 0) notices.unshift(record); else notices[index] = { ...notices[index], ...record };
  if (!saveNotices(notices)) throw new Error('নোটিশ সংরক্ষণ হয়নি। ব্রাউজারের স্টোরেজ পরীক্ষা করুন।');
  return state.db;
}

async function runNoticeAction(action, notice) {
  if (state.busy || !state.ready) return;
  const notices = loadNotices();
  const index = notices.findIndex(item => item?.id === notice.id);
  if (index < 0) return toast('নোটিশটি পাওয়া যায়নি।');
  if (action === 'toggle') notices[index] = { ...notices[index], status: notice.status === 'published' ? 'draft' : 'published', updatedAt: new Date().toISOString() };
  if (action === 'delete') notices.splice(index, 1);
  if (!saveNotices(notices)) return toast('নোটিশ সংরক্ষণ হয়নি।');
  renderNotices();
  toast(action === 'delete' ? 'নোটিশ মুছে ফেলা হয়েছে।' : notice.status === 'published' ? 'নোটিশ প্রকাশ বন্ধ হয়েছে।' : 'নোটিশ প্রকাশ হয়েছে।');
}

async function showTeacherShell() {
  /* Access closed by the Admin: the page locks where it stands instead of
     sending the teacher somewhere else. (The session itself is not thrown
     away — the switch can be turned back on.) */
  if (loadAppConfig().allowTeacherRegistration === false && !(await hasStaffSession('admin'))) {
    await lockPanel({ role: 'teacher.html', reason: 'শিক্ষক প্যানেল প্রবেশ এই মুহূর্তে এডমিন কর্তৃক বন্ধ রাখা হয়েছে।' });
    return false;
  }
  $('#teacherShell').hidden = false;
  // A refresh (or a shared link) reopens the page that was open.
  const wanted = routeName();
  setView(TEACHER_VIEWS.includes(wanted) ? wanted : 'home');
  onRouteChange(name => { if (TEACHER_VIEWS.includes(name) && name !== state.view) setView(name); });
  const loaded = await reload();
  /* Settings → the shared five-group structure. The profile card, password row
     and theme switch keep their homes; the hub adds the notification group and
     what the Teacher page did not have (app install, session, data). */
  mountSettingsHub({
    mount: '#teacherSettingsHub',
    role: 'teacher',
    actions: {
      profile: () => {
        const profileSection = $('#teacherProfile');
        if (profileSection) profileSection.dataset.profileMode = 'profile';
        if ($('#teacherProfileTitle')) $('#teacherProfileTitle').textContent = 'আমার প্রোফাইল';
        $('#teacherProfileCard [data-profile-edit]')?.click();
      },
      logout: () => { clearStaffSession('teacher'); window.dispatchEvent(new Event('apc-session-ended')); goToLoginPage(); }
    },
    session: { value: 'ডিভাইস-বাউন্ড সেশন', hint: 'লগইন এই ডিভাইসেই বাঁধা' }
  });
  // পড়াশোনা পরিচালনা করুন — content for the Teacher's own class+subject only.
  await mountCourseEditor();
  await mountReports($('#teacherReports'), { panel: 'teacher' });
  mountProfileSelfEdit({
    role: 'teacher',
    card: '#teacherProfileCard',
    current: () => state.teacher,
    render: async () => {
      try {
        const { readStaffAccount } = await import('./staff-auth.js');
        const account = await readStaffAccount('teacher');
        if (account) state.teacher = { ...(state.teacher || {}), ...account };
      } catch { /* keep the current card */ }
      renderTeacherProfile();
    },
    toast: message => toast(message)
  });
  watchOwnPanelSession('teacher');
  window.dispatchEvent(new Event('apc-session-ready'));
  return loaded;
}
/** The content editor is mounted once; its own paint() keeps it current. */
async function mountCourseEditor() {
  try {
    const { initCourseEditor } = await import('./course-editor.js');
    const editor = initCourseEditor({ mount: '#teacherCourseEditor', role: 'teacher', actor: 'TEACHER', toast: message => toast(message) });
    await editor.ready;
  } catch (error) { console.warn('[Active Plus] course editor unavailable:', error?.name || 'unknown'); }
}
$('#teacherChangePassword')?.addEventListener('click', () => openStaffPasswordDialog({ role: 'teacher', mode: 'change' }));
$('#teacherExit').addEventListener('click', () => {
  clearStaffSession('teacher');
  window.dispatchEvent(new Event('apc-session-ended'));
  // Logout always returns to the shared login page, never to a panel entry form.
  $('#teacherShell').hidden = true;
  goToLoginPage();
});
$('#teacherRetry').addEventListener('click', reload);
$('#teacherNewNotice')?.addEventListener('click', () => showNoticeEditor());
$('#teacherNoticeClass')?.addEventListener('change', renderNotices);
$('#teacherNewActivity').addEventListener('click', () => showEditor(state.view));
['teacherRecordSearch', 'teacherClassFilter', 'teacherStatusFilter'].forEach(id => {
  const node = $('#' + id); if (!node) return;
  node.addEventListener(id.includes('Search') ? 'input' : 'change', () => {
    if (id === 'teacherStatusFilter') state.status = node.value;
    state.recordLimit = 15; renderRecords();
  });
});
/* Type tabs above the list: switch record type without going back to the nav. */
$('.teacher-type-tabs')?.addEventListener('click', event => {
  const tab = event.target.closest('[data-type-tab]'); if (!tab) return;
  state.recordLimit = 15; setView(tab.dataset.typeTab);
  if ($('#teacherRecords')) $('#teacherRecords').dataset.recordsOpen = '1';
});
$('#teacherRecordMore').addEventListener('click', () => { state.recordLimit += 15; renderRecords(); });
/* আমার ক্লাস: every নির্ধারিত শ্রেণি opens its own work. The list is one row per
   Teacher + Class + Batch, so a teacher with three classes gets three buttons —
   choosing one must never leave the other two behind. */
$('#teacherClassList')?.addEventListener('click', event => {
  if (event.target.closest('[data-teacher-class-retry]')) return reload();
  const open = event.target.closest('[data-teacher-open-class]');
  if (!open) return;
  const select = $('#teacherClassFilter');
  const className = open.dataset.teacherOpenClass;
  if (select) {
    if (![...select.options].some(option => option.value === className)) select.insertAdjacentHTML('beforeend', `<option value="${esc(className)}">${esc(className)}</option>`);
    select.value = className;
    select.dispatchEvent(new Event('change'));
  }
  /* The records screen, narrowed to this class: its type tabs are the teacher's
     existing হোমওয়ার্ক / সাজেশন / উপজাতি / পরীক্ষা workflow. */
  setView('homework');
  if ($('#teacherRecords')) $('#teacherRecords').dataset.recordsOpen = '1';
});
document.addEventListener('click', event => {
  if (state.busy) return;
  const classTab = event.target.closest('.teacher-class-tabs [role="tab"]');
  if (classTab && classTab.hasAttribute('data-teacher-view')) syncClassTabs('routine');
  const examTile = event.target.closest('[data-teacher-exam]');
  if (examTile) {
    const key = examTile.dataset.teacherExam || '';
    const nextScreen = EXAM_SCREENS[key] || 'home';
    const inExamsView = Boolean(examTile.closest('#teacherOnlineExams'));
    const alreadyOpen = inExamsView && (state.view === 'online-exams' || state.view === 'exam') && Boolean(state.examScreen) && (state.examTileKey || state.examScreen) === key;
    if (alreadyOpen) {
      state.examScreen = '';
      state.examTileKey = '';
      paintTeacherExam();
    } else {
      state.examScreen = nextScreen;
      state.examTileKey = key;
      setView('online-exams');
    }
    return;
  }
  const recordsAction = event.target.closest('[data-records-action]');
  if (recordsAction) {
    if (recordsAction.dataset.recordsAction === 'create') {
      $('#teacherNewActivity')?.click();
    } else if (recordsAction.dataset.recordsAction === 'list') {
      const rec = $('#teacherRecords');
      if (rec) {
        if (rec.dataset.recordsOpen === '1') delete rec.dataset.recordsOpen;
        else rec.dataset.recordsOpen = '1';
      }
    }
    return;
  }
  const noticeOpenBtn = event.target.closest('[data-notice-action]');
  if (noticeOpenBtn && noticeOpenBtn.dataset.noticeAction === 'list') {
    const sec = $('#teacherNotice');
    if (sec) {
      if (sec.dataset.noticeOpen === '1') delete sec.dataset.noticeOpen;
      else sec.dataset.noticeOpen = '1';
    }
    return;
  }
  const routineAction = event.target.closest('[data-routine-action]');
  if (routineAction && routineAction.dataset.routineAction === 'list') {
    const sec = $('#teacherRoutine');
    if (sec) {
      if (sec.dataset.routineOpen === '1') delete sec.dataset.routineOpen;
      else sec.dataset.routineOpen = '1';
    }
    return;
  }
  if (event.target.closest('.teacher-routine-tabs [data-routine-tab]')) {
    const sec = $('#teacherRoutine');
    if (sec) sec.dataset.routineOpen = '1';
  }
  const reportsAction = event.target.closest('[data-reports-action]');
  if (reportsAction) {
    const sec = $('#teacherAcademicReports');
    const mode = reportsAction.dataset.reportsAction;
    if (sec && mode) {
      if (sec.dataset.reportsOpen === mode) delete sec.dataset.reportsOpen;
      else sec.dataset.reportsOpen = mode;
    }
    return;
  }
  const coursesAction = event.target.closest('[data-courses-action]');
  if (coursesAction) {
    const sec = $('#teacherCourses');
    const mode = coursesAction.dataset.coursesAction;
    if (mode === 'new') {
      if (sec) sec.dataset.coursesOpen = 'materials';
      $('#teacherCourseEditor [data-ce-new]')?.click();
    } else if (sec && mode) {
      if (sec.dataset.coursesOpen === mode) delete sec.dataset.coursesOpen;
      else sec.dataset.coursesOpen = mode;
    }
    return;
  }
  const settingsOpen = event.target.closest('[data-settings-open]');
  if (settingsOpen) {
    const targetKey = settingsOpen.dataset.settingsOpen || '';
    const targetSection = $(`#teacherSettingsHub [data-settings-group="${targetKey}"]`);
    const isNowOpen = Boolean(targetSection && !targetSection.hidden);
    const openKey = isNowOpen ? targetKey : 'all';
    const profileSection = $('#teacherProfile');
    if (profileSection) profileSection.dataset.settingsTab = openKey;
    $$('#teacherSettingsTabs [data-settings-tab]').forEach(btn => {
      const active = btn.dataset.settingsTab === openKey;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    return;
  }
  const settingsTab = event.target.closest('#teacherSettingsTabs [data-settings-tab]');
  if (settingsTab) {
    const tabKey = settingsTab.dataset.settingsTab || 'all';
    const profileSection = $('#teacherProfile');
    if (profileSection) profileSection.dataset.settingsTab = tabKey;
    const hub = $('#teacherSettingsHub');
    if (typeof hub?.__apcShowSettingsGroup === 'function') {
      hub.__apcShowSettingsGroup(tabKey === 'all' ? '' : tabKey);
    }
    $$('#teacherSettingsTabs [data-settings-tab]').forEach(btn => {
      const active = btn.dataset.settingsTab === tabKey;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    return;
  }
  const moreAction = event.target.closest('[data-more-action]');
  if (moreAction) {
    const kind = moreAction.dataset.moreAction;
    if (kind === 'password') {
      openStaffPasswordDialog({ role: 'teacher', mode: 'change' });
      return;
    }
    if (kind === 'settings') {
      setView('profile');
      const profileSection = $('#teacherProfile');
      if (profileSection) {
        profileSection.dataset.profileMode = 'settings';
        profileSection.dataset.settingsTab = 'all';
      }
      $$('#teacherSettingsTabs [data-settings-tab]').forEach(btn => {
        const active = btn.dataset.settingsTab === 'all';
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      if ($('#teacherProfileTitle')) $('#teacherProfileTitle').textContent = 'সেটিংস ও নোটিফিকেশন';
      const adviceEl = $('#teacherProfile [data-teacher-hero-advice]');
      if (adviceEl) adviceEl.textContent = pickTeacherSectionAdvice('settings');
      return;
    }
    if (kind === 'theme') {
      $('#darkModeToggle')?.click();
      const themeStatus = $('[data-more-theme-status]');
      if (themeStatus) {
        const isDark = document.documentElement.dataset.theme === 'dark';
        themeStatus.textContent = isDark
          ? 'বর্তমানে গাঢ় থিম চালু আছে — ট্যাপ করে দিন মোডে যান'
          : 'বর্তমানে দিন মোড চালু আছে — ট্যাপ করে গাঢ় থিম চালু করুন';
      }
      return;
    }
    if (kind === 'logout') {
      $('#teacherExit')?.click();
      return;
    }
  }
  const nav = event.target.closest('[data-teacher-view]');
  /* Creation doors ("কাজ দিন" hub-এর "দিন" বাটন) গন্তব্য স্ক্রিনে নেভিগেট না
     করে বর্তমান স্ক্রিনের উপরেই ফর্ম খোলে — ফর্ম বন্ধ করলে শিক্ষক যে হাব থেকে
     খুলেছেন সেখানেই ফেরেন, রেকর্ডস স্ক্রিনে ছিটকে যান না। নেভিগেশন-দরজা
     (শুধু data-teacher-view) আগের মতোই স্ক্রিন বদলায়। */
  const create = event.target.closest('[data-new-activity]');
  if (create) { showEditor(create.dataset.newActivity); return; }
  if (event.target.closest('[data-new-notice]')) { showNoticeEditor(); return; }
  if (nav) {
    if (nav.closest('#teacherOnlineExams .teacher-home-intro') && state.examScreen) {
      state.examScreen = '';
      paintTeacherExam();
      return;
    }
    if (nav.dataset.teacherView === 'exam' || nav.dataset.teacherView === 'online-exams') { state.examScreen = ''; state.examTileKey = ''; }
    setView(nav.dataset.teacherView);
    if (nav.dataset.teacherView === 'profile') {
      const profileSection = $('#teacherProfile');
      const isSettings = nav.dataset.moreOpen === 'settings';
      if (profileSection) {
        profileSection.dataset.profileMode = isSettings ? 'settings' : 'profile';
        if (isSettings) profileSection.dataset.settingsTab = 'all';
      }
      if (isSettings) {
        $$('#teacherSettingsTabs [data-settings-tab]').forEach(btn => {
          const active = btn.dataset.settingsTab === 'all';
          btn.classList.toggle('is-active', active);
          btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
      }
      if ($('#teacherProfileTitle')) {
        $('#teacherProfileTitle').textContent = isSettings ? 'সেটিংস ও নোটিফিকেশন' : 'আমার প্রোফাইল';
      }
      const adviceEl = $('#teacherProfile [data-teacher-hero-advice]');
      if (adviceEl) {
        adviceEl.textContent = pickTeacherSectionAdvice(isSettings ? 'settings' : 'profile');
      }
    }
  }
  const courseChBtn = event.target.closest('[data-course-ch-action]');
  if (courseChBtn) {
    const act = courseChBtn.dataset.courseChAction;
    const cId = courseChBtn.dataset.courseId;
    const chId = courseChBtn.dataset.chapterId;
    const course = (state.courses || []).find(c => c.id === cId);
    if (act === 'new') showCourseModal();
    else if (act === 'edit-course' && course) showCourseModal(course);
    else if (act === 'add-chapter' && course) showAddChapterModal(course);
    else if (act === 'cycle-chapter' && cId && chId) {
      courseRepository.cycleChapterStatus(cId, chId).then(res => { state.courses = res.courses || []; renderCourseChapters(); toast('অধ্যায়ের অবস্থা আপডেট হয়েছে'); }).catch(e => toast(e.message));
    } else if (act === 'delete-chapter' && cId && chId) {
      courseRepository.deleteChapter(cId, chId).then(res => { state.courses = res.courses || []; renderCourseChapters(); toast('অধ্যায় মুছে ফেলা হয়েছে'); }).catch(e => toast(e.message));
    } else if (act === 'toggle-course' && course) {
      courseRepository.setCourseStatus(cId, course.status === 'published' ? 'draft' : 'published').then(res => { state.courses = res.courses || []; renderCourseChapters(); toast(course.status === 'published' ? 'কোর্স খসড়া করা হয়েছে' : 'কোর্স প্রকাশ করা হয়েছে'); }).catch(e => toast(e.message));
    } else if (act === 'delete-course' && cId) {
      courseRepository.deleteCourse(cId).then(res => { state.courses = res.courses || []; renderCourseChapters(); toast('কোর্স মুছে ফেলা হয়েছে'); }).catch(e => toast(e.message));
    }
    return;
  }
  const routineSessionBtn = event.target.closest('[data-open-routine-session]'); if (routineSessionBtn) { openRoutineSession(routineSessionBtn); return; }
  const section = event.target.closest('[data-academic-section]');
  if (section) {
    const target = ACADEMIC_SECTIONS[section.dataset.academicSection];
    if (target) {
      state.examScreen = target.screen || '';
      setView(target.view);
    }
  }
  const noticeAction = event.target.closest('[data-notice-action]');
  if (noticeAction) {
    const notice = ownNotices(String(state.teacher?.username || 'teacher.apc')).find(item => item.id === noticeAction.dataset.id);
    if (notice && noticeAction.dataset.noticeAction === 'edit') showNoticeEditor(notice);
    else if (notice) runNoticeAction(noticeAction.dataset.noticeAction, notice);
  }
  if (event.target.closest('[data-close-teacher]')) closeModal();
  const record = event.target.closest('[data-record-action]');
  if (record) {
    if (!state.ready) return toast('ডেটা পড়া যায়নি। আবার চেষ্টা করুন।');
    const a = own().find(item => item.id === record.dataset.id); if (!a) return;
    ({ detail: showDetail, edit: a => showEditor(a.type, a), progress: showProgress, delete: showDelete })[record.dataset.recordAction]?.(a);
  }
});
$('#teacherModalClose').addEventListener('click', closeModal);
$('#teacherModalBackdrop').addEventListener('click', event => { if (event.target === event.currentTarget) closeModal(); });
document.addEventListener('keydown', event => {
  if ($('#teacherModalBackdrop').hidden) return;
  if (event.key === 'Escape') closeModal();
  if (event.key === 'Tab') {
    const items = [...$('#teacherModalBackdrop').querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')].filter(el => el.getClientRects().length);
    if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
  }
});
watchCourses(() => { if (!state.busy && !$('#teacherShell').hidden) reload(); });
watchTeachingData(() => {
  if (!state.busy && !$('#teacherShell').hidden) reload();
  refreshReports($('#teacherReports'));
});
/* Admin assignment changes reach this panel in real time: the local projection
   event (same tab) and the cloud bridge (other devices). Either one reloads the
   scope — a newly নির্ধারিত শ্রেণি shows up without a manual refresh. */
window.addEventListener('teacher-assignments-updated', () => {
  if (!state.busy && $('#teacherShell') && !$('#teacherShell').hidden) reload();
});
const TEACHER_WATCHED_COLLECTIONS = new Set([
  'students',
  'academics',
  'routine',
  'notices',
  'settings',
  'teacherAssignments',
  'staffDirectory',
  'staffAccounts'
]);
const TEACHER_WATCHED_KEYS = new Set([
  'activePlus.admin.students.v1',
  'activePlus.academics.v1',
  'activePlus.admin.routine.v1',
  'activePlus.admin.notices.v1',
  'active-plus-app-config-v1',
  'activePlus.manager.teacherAssignments.v1',
  'activePlus.staffDirectory.v1'
]);
let teacherCloudRefreshTimer = 0;
function scheduleTeacherLiveRefresh() {
  clearTimeout(teacherCloudRefreshTimer);
  teacherCloudRefreshTimer = setTimeout(() => {
    if (state.busy || !$('#teacherShell') || $('#teacherShell').hidden) return;
    if ($('#teacherModalBackdrop') && !$('#teacherModalBackdrop').hidden) return;
    void reload();
    refreshReports($('#teacherReports'));
  }, 60);
}
window.addEventListener('apc-sync-updated', event => {
  const collection = event?.detail?.collection;
  const key = event?.detail?.key;
  if (!collection || TEACHER_WATCHED_COLLECTIONS.has(collection) || (key && TEACHER_WATCHED_KEYS.has(key))) {
    scheduleTeacherLiveRefresh();
  }
});
/* The same edits made from another tab on this device (Admin Staff Management
   or the Manager's assignment screen) arrive as raw storage events — reload the
   scope so a new class/subject takes effect without a manual refresh. */
window.addEventListener('storage', event => {
  if (!event.key || TEACHER_WATCHED_KEYS.has(event.key)) {
    scheduleTeacherLiveRefresh();
  }
});

watchExams(() => {
  if (!state.ready) return;
  void examRepository.list({ role: 'teacher' }).then(db => { state.exams = db.exams || []; renderHome(); }).catch(() => { state.exams = null; renderHome(); });
});

function syncDateInputBn(input) {
  if (!input || input.type !== 'date') return;
  input.setAttribute('lang', 'bn-BD');
  const raw = String(input.value || '').trim();
  const next = raw ? displayDate(raw) : '';
  if (input.dataset.dateBn !== next) input.dataset.dateBn = next;
}
function syncAllDateInputs(root = document) {
  root.querySelectorAll?.('input[type="date"]').forEach(syncDateInputBn);
}
if (typeof window !== 'undefined' && window.HTMLInputElement) {
  const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  if (desc?.get && desc?.set && !window.HTMLInputElement.prototype.__apcDateBnWired) {
    Object.defineProperty(window.HTMLInputElement.prototype, '__apcDateBnWired', { value: true });
    Object.defineProperty(window.HTMLInputElement.prototype, 'value', {
      configurable: true,
      enumerable: true,
      get() { return desc.get.call(this); },
      set(val) {
        desc.set.call(this, val);
        if (this.type === 'date') syncDateInputBn(this);
      }
    });
  }
  document.addEventListener('input', event => { if (event.target?.type === 'date') syncDateInputBn(event.target); });
  document.addEventListener('change', event => { if (event.target?.type === 'date') syncDateInputBn(event.target); });
  syncAllDateInputs();
  if (typeof MutationObserver === 'function' && document.body) {
    new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches?.('input[type="date"]')) syncDateInputBn(node);
          else syncAllDateInputs(node);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }
  // Theme changes repaint the panel head dates/advice on the next render.
  $('#darkModeToggle')?.addEventListener('change', () => setTimeout(() => { try { renderHome(); } catch { /* render self-guards */ } }, 0));
}

// An existing device-bound session opens the panel without asking again.
/* One door per panel: no route of ours leaves teacher.html for another panel. */
installPanelGuard();
void rememberPanelPage();

hasStaffSession('teacher').then(valid => {
  if (valid) return showTeacherShell();
  return lockPanel({ role: 'teacher.html', reason: 'শিক্ষক প্যানেল শুধু শিক্ষক ইউজারনেম ও পাসওয়ার্ড দিয়ে খোলে।' });
});
