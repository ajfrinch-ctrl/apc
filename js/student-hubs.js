/* Extra 3×3 hub pages (ক্লাস / রুটিন extras) — read-only views over stores
   that already exist. Nothing is copied and no permissions change. */
import { loadRoutine, WEEK_DAYS } from './office-data.js';
import { subjectsForClass, classByName } from './academics.js';
import { listCourseContent, typeOf as courseTypeOf } from './course-content.js';
import { examRepository as examRepo, examMatchesStudent, isStudentVisibleExam } from './exam-data.js';
import { toBanglaNumber as bn } from './ui.js';

const DAY_LABELS = { sat: 'শনিবার', sun: 'রবিবার', mon: 'সোমবার', tue: 'মঙ্গলবার', wed: 'বুধবার', thu: 'বৃহস্পতিবার' };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function todayKey() {
  return WEEK_DAYS[(new Date().getDay() + 1) % 7];
}

function tomorrowKey() {
  return WEEK_DAYS[((new Date().getDay() + 1) % 7 + 1) % 7];
}

function classesFor(day, student) {
  const routine = loadRoutine() || {};
  const rows = (routine[day]?.classes || []).filter(item => !student?.className || !item.className || item.className === student.className);
  return rows;
}

function renderList(id, html) {
  const node = document.getElementById(id);
  if (node) node.innerHTML = html;
}

function classCards(rows, empty) {
  if (!rows.length) return `<p class="teacher-empty">${empty}</p>`;
  return rows.map(item => `<article class="routine-item"><div class="routine-time"><strong>${esc(item.time || '')}</strong><small>${esc(item.period || '')}</small></div><div class="routine-body"><span><strong>${esc(item.subject || 'ক্লাস')}</strong><small>${esc([item.teacher, item.room].filter(Boolean).join(' · '))}</small></span></div></article>`).join('');
}

export function initStudentHubs({ getStudent } = {}) {
  const student = () => getStudent?.() || {};

  function paint() {
    const me = student();
    const today = classesFor(todayKey(), me);
    const tomorrow = classesFor(tomorrowKey(), me);
    renderList('classTodayList', classCards(today, 'আজ কোনো ক্লাস নেই।'));
    renderList('routineTodayList', classCards(today, 'আজ কোনো ক্লাস নেই।'));
    renderList('classUpcomingList', classCards(tomorrow, 'আসন্ন ক্লাস নেই।'));
    renderList('routineTomorrowList', classCards(tomorrow, 'আগামীকাল কোনো ক্লাস নেই।'));
    const week = WEEK_DAYS.flatMap(day => classesFor(day, me).map(item => ({ ...item, day })));
    renderList('classRecordList', classCards(week, 'ক্লাস রেকর্ড এখনও নেই।'));
    renderList('routineClassList', WEEK_DAYS.map(day => {
      const rows = classesFor(day, me);
      return `<section class="exam-card"><h3>${DAY_LABELS[day]}</h3>${classCards(rows, 'ক্লাস নেই।')}</section>`;
    }).join(''));
    const subjects = subjectsForClass(me.className || '') || [];
    renderList('classSubjectsList', subjects.length
      ? subjects.map(item => `<article class="exam-card"><h3>${esc(item.name)}</h3></article>`).join('')
      : '<p class="teacher-empty">বিষয় এখনও যোগ হয়নি।</p>');
    const teachers = [...new Set(week.map(item => item.teacher).filter(Boolean))];
    renderList('classTeachersList', teachers.length
      ? teachers.map(name => `<article class="exam-card"><h3>${esc(name)}</h3></article>`).join('')
      : '<p class="teacher-empty">শিক্ষকের নাম রুটিনে এলে এখানে দেখা যাবে।</p>');
    const cls = classByName(me.className);
    const content = cls ? listCourseContent({
      classId: cls.id, group: me.group || '', groupScoped: true, publishedOnly: true, includeInactive: false
    }) : [];
    const notes = content.filter(row => ['note', 'lesson'].includes(courseTypeOf(row)));
    const materials = content.filter(row => ['pdf', 'video', 'previous_question'].includes(courseTypeOf(row)));
    renderList('classNotesList', notes.length ? notes.map(row => `<article class="exam-card"><h3>${esc(row.title)}</h3></article>`).join('') : '<p class="teacher-empty">ক্লাস নোট এখনও নেই।</p>');
    renderList('classMaterialsList', materials.length ? materials.map(row => `<article class="exam-card"><h3>${esc(row.title)}</h3></article>`).join('') : '<p class="teacher-empty">ক্লাস উপকরণ এখনও নেই।</p>');
    const blob = item => `${item.tag || ''} ${item.status || ''} ${item.subject || ''}`.toLowerCase();
    renderList('routineChangedList', classCards(week.filter(item => /পরিবর্ত|changed/.test(blob(item))), 'পরিবর্তিত রুটিন নেই।'));
    renderList('routineHolidayList', classCards(week.filter(item => /ছুটি|holiday/.test(blob(item))), 'ছুটির তালিকা খালি।'));
    renderList('routineImportantList', classCards(week.filter(item => /গুরুত্বপূর্ণ|important/.test(blob(item))), 'গুরুত্বপূর্ণ সময়সূচি নেই।'));
    renderList('routineOtherList', classCards(week.filter(item => !/পরীক্ষা|exam|পরিবর্ত|changed|ছুটি|holiday|গুরুত্বপূর্ণ|important/.test(blob(item))), 'অন্যান্য রুটিন নেই।'));
    renderList('classAttendanceList', '<p class="teacher-empty">উপস্থিতি শিক্ষক নথিভুক্ত করলে এখানে দেখা যাবে।</p>');
    renderList('classOtherList', classCards(week, 'অন্যান্য ক্লাসের তথ্য নেই।'));
    void examRepo.listForStudent(me.id).then(db => {
      const now = Date.now();
      const exams = (db.exams || []).filter(exam => isStudentVisibleExam(exam) && examMatchesStudent(exam, me) && exam.startAt > now)
        .sort((a, b) => a.startAt - b.startAt);
      const examHtml = exams.length
        ? exams.map(exam => `<article class="exam-card"><h3>${esc(exam.title)}</h3><p class="exam-note">${esc(exam.subject || '')} • ${new Date(exam.startAt).toLocaleString('bn-BD')}</p></article>`).join('')
        : '<p class="teacher-empty">আসন্ন পরীক্ষার সময়সূচি নেই।</p>';
      renderList('routineExamList', examHtml);
      renderList('examOtherList', examHtml);
    }).catch(() => {});
    void bn;
  }

  window.addEventListener('apc-view-change', event => {
    const view = event.detail?.view || '';
    if (view.startsWith('class-') || view.startsWith('routine-') || view === 'classes' || view === 'routine') paint();
  });
  window.addEventListener('apc-session-ready', paint);
  paint();
  return paint;
}
