import { examRepository as repo, examMatchesStudent, retryEligibility, firstAttemptMean, examResults, totalMarks, watchExams, isStudentVisibleExam } from './exam-data.js';
import { examMeta, resultMarkup, attemptStage, stageTag, codeTag, esc, num } from './exam-ui.js';
import { downloadExamPDF } from './exam-pdf.js';

export function initStudentExams({ getStudent, getAccount }) {
  const root = document.querySelector('#studentExamWorkspace'); if (!root) return () => {};
  let db = { exams: [], attempts: [] }, view = 'list', examId = null, attemptId = null, busy = false, ready = false;
  root.classList.add('exam-workspace');
  root.innerHTML = '<p class="exam-note">নিজের শ্রেণির অনলাইন পরীক্ষা • এটি একই ব্রাউজারে চলা লোকাল ডেমো।</p><p class="exam-error" data-exam-error role="alert" hidden></p><p class="exam-message" data-exam-message role="status" hidden></p><div data-exam-content></div>';
  const $ = selector => root.querySelector(selector), content = $('[data-exam-content]');
  const activeAccount = () => getAccount()?.status === 'active';
  const button = (action, label, id = '', cls = '') => `<button type="button" class="${cls}" data-student-exam-action="${action}" data-id="${esc(id)}">${label}</button>`;
  const own = e => db.attempts.filter(a => a.examId === e.id && a.studentId === getStudent().id);
  function error(text) { $('[data-exam-error]').textContent = text; $('[data-exam-error]').hidden = !text; }
  function message(text) { $('[data-exam-message]').textContent = text; $('[data-exam-message]').hidden = !text; }
  function scrollTop() { if (document.querySelector('#examsView').classList.contains('active')) root.closest('main')?.scrollTo({ top: 0, behavior: 'instant' }); }
  function list() {
    view = 'list'; examId = null; attemptId = null;
    if (!activeAccount()) { content.innerHTML = '<p class="exam-card">অনুমোদিত অ্যাকাউন্ট দিয়ে লগইন করতে হবে।</p>'; return; }
    /* Draft / review / approved / archived papers are staff-only: a student
    never sees a question before its exam is published. */
    const exams = db.exams.filter(e => isStudentVisibleExam(e) && examMatchesStudent(e, getStudent())).sort((a, b) => b.startAt - a.startAt), now = Date.now();
    content.innerHTML = `<div class="exam-actions">${button('refresh', 'তালিকা / জমার অবস্থা হালনাগাদ')}</div><div class="exam-list">${exams.map(e => {
      const attempts = own(e), active = attempts.find(a => a.status === 'active'), queued = attempts.some(a => a.status === 'queued');
      const canFirst = !attempts.length && now >= e.startAt && now < e.endAt && now <= e.startAt + e.lateMinutes * 60000;
      const retry = retryEligibility(db, e, getStudent().id);
      return `<article class="exam-card" data-student-exam="${esc(e.id)}">${examMeta(e)}<p class="exam-note">${stageTag(e)}${codeTag(e)}</p><p class="exam-note">${esc(e.instructions)}</p>${e.type === 'mcq' ? `<p class="exam-note">সব প্রশ্ন একসঙ্গে থাকবে। প্রতি ভুলে ${num(e.negative)} নম্বর কাটা হবে; সর্বনিম্ন মোট ০। প্রথম প্রবেশের সীমা ${num(e.lateMinutes)} মিনিট।</p>${queued ? `<p class="exam-message">${esc(attemptStage(attempts.find(a => a.status === 'queued'), e))}</p>` : ''}` : ''}
        <div class="exam-actions">${e.type === 'mcq' ? active && now < e.endAt ? button('resume', 'পরীক্ষায় ফিরে যাও', e.id, 'primary') : canFirst ? button('start', 'পরীক্ষা শুরু করো', e.id, 'primary') : retry ? button('start', 'দ্বিতীয়বার পরীক্ষা দাও', e.id, 'primary') : `<small>${now < e.startAt ? 'নির্ধারিত সময়ে পরীক্ষা শুরু হবে।' : now >= e.endAt ? 'পরীক্ষার সময় শেষ।' : attempts.length ? 'চলমান গড়ের নিচে হলে দ্বিতীয় সুযোগ এখানে আসবে।' : 'প্রথম প্রবেশের সময়সীমা শেষ।'}</small>` : now >= e.startAt ? button('paper', 'প্রশ্নপত্র PDF ডাউনলোড', e.id, 'primary') : '<small>শুরুর সময় হলে PDF পাওয়া যাবে।</small>'}
        ${e.resultsPublished ? button('results', 'প্রকাশিত ফলাফল', e.id) : '<small>ফলাফল Manager-এর প্রকাশের অপেক্ষায়।</small>'}${e.type === 'mcq' && now >= e.endAt ? button('solutions', 'সঠিক উত্তরসহ PDF', e.id) : ''}</div></article>`;
    }).join('') || '<p class="exam-card">Admin এখনও কোনো পরীক্ষা প্রকাশ করেননি।</p>'}</div>`;
  }
  function activeExam(e, a) {
    view = 'active'; examId = e.id; attemptId = a.id;
    content.innerHTML = `<div class="exam-actions">${button('list', '← তালিকা (উত্তর সংরক্ষিত থাকবে)')}</div><div class="exam-timer"><span>সবার জন্য একই শেষ সময় • চেষ্টা ${num(a.number)}</span><strong data-exam-clock aria-live="off"></strong><em class="exam-timer-hint" data-low-hint hidden></em><small data-answer-status>উত্তর এই ফোনে সংরক্ষিত হচ্ছে।</small></div><h2>${esc(e.title)}</h2><p class="exam-note">সব প্রশ্ন একসঙ্গে দেখানো হয়েছে — খুঁজতে স্ক্রল করো। সময় শেষ হলে উত্তরপত্র <strong>স্বয়ংক্রিয়ভাবে জমা</strong> হবে; ততক্ষণ যেকোনো উত্তরের অপশন বদলাতে পারবে। নেট না থাকলেও উত্তর এই ফোনে সংরক্ষিত থাকবে, সংযোগ ফিরলে জমা হবে।</p>
      <div class="exam-question-list">${a.order.map((item, i) => {
        const q = e.questions.find(q => q.id === item.id);
        return `<fieldset class="exam-question"><legend>প্রশ্ন ${num(i + 1)} • ${num(q.marks)} নম্বর</legend><p>${esc(q.text)}</p>${item.options.map((id, j) => {
          const option = q.options.find(o => o.id === id);
          return `<label class="exam-option"><input type="radio" name="answer-${q.id}" value="${id}" data-answer-question="${q.id}" ${a.answers[q.id] === id ? 'checked' : ''}><span>${'ABCD'[j]}. ${esc(option.text)}</span></label>`;
        }).join('')}</fieldset>`;
      }).join('')}</div><div class="exam-actions">${button('confirm', 'উত্তরপত্র জমা দাও', e.id, 'primary')}</div>
      <div class="exam-card" data-submit-confirm hidden><h3>এখনই জমা দেবে?</h3><p>জমা দেওয়ার পর এই প্রচেষ্টার উত্তর বদলানো যাবে না। চাইলে “উত্তরে ফিরে যাও” চেপে সময় শেষ হওয়া পর্যন্ত অপেক্ষা করো — সময় শেষ হলে উত্তরপত্র স্বয়ংক্রিয়ভাবে জমা হবে।</p><div class="exam-actions">${button('finish', 'হ্যাঁ, জমা দাও', e.id, 'primary')}${button('cancel-confirm', 'উত্তরে ফিরে যাও')}</div></div>`;
    clock(); scrollTop();
  }
  function results(e, reset = true) {
    if (!e.resultsPublished) { view = 'list'; examId = null; attemptId = null; list(); message('ফলাফল এখনো Manager প্রকাশ করেননি।'); return; }
    view = 'results'; examId = e.id; attemptId = null;
    const mine = own(e), pending = mine.some(a => a.status === 'queued'), mean = firstAttemptMean(db, e.id);
    content.innerHTML = `<div class="exam-actions">${button('list', '← পরীক্ষার তালিকা')}${button('refresh', 'হালনাগাদ')}</div>${examMeta(e)}
      ${pending ? '<p class="exam-message">তোমার উত্তর ফোনে রাখা আছে। অনলাইনে এলে জমা ও মূল্যায়ন হবে।</p>' : ''}
      ${mine.filter(a => a.status === 'submitted').map(a => {
        const auto = e.type === 'mcq' && Number.isFinite(a.finishedAt) && a.finishedAt >= e.endAt;
        return `<div class="exam-summary"><h3>তোমার প্রচেষ্টা ${num(a.number)} • ${esc(attemptStage(a, e))}${auto ? ' (সময় শেষে স্বয়ংক্রিয় জমা)' : ''}</h3><strong>${num(a.score)} / ${num(totalMarks(e))}</strong>${e.type === 'mcq' ? `<p>সঠিক ${num(a.correct)} • ভুল ${num(a.wrong)} • অনুত্তরিত ${num(a.unanswered)}</p>` : ''}${auto ? '<p>নির্ধারিত সময় শেষ হওয়ায় উত্তরপত্র নিজে থেকেই জমা হয়েছে — জমা হওয়ার আগে যেসব উত্তর বাছা ছিল সেগুলোই গণনা হয়েছে।</p>' : ''}</div>`;
      }).join('')}
      <p class="exam-note">${e.type === 'mcq' ? `দ্বিতীয় সুযোগ: জমা হওয়া প্রথম প্রচেষ্টার চলমান গড় ${mean === null ? 'এখনও নেই' : num(mean.toFixed(2))}। তার নিচে থাকলে সর্বোচ্চ দুইবার; শেষ সময় একই। শুরু করা দ্বিতীয় সুযোগ পরে গড় বদলালেও বাতিল হবে না।` : 'ক্লাসে পরীক্ষার পরে শিক্ষক নম্বর প্রকাশ করবেন।'}</p>
      <div class="exam-actions">${retryEligibility(db, e, getStudent().id) ? button('start', 'দ্বিতীয়বার পরীক্ষা দাও', e.id, 'primary') : ''}${e.type === 'mcq' && Date.now() >= e.endAt ? button('solutions', 'সঠিক উত্তরসহ PDF ডাউনলোড', e.id, 'primary') : e.type === 'mcq' ? '<small>সঠিক উত্তরসহ PDF সবার পরীক্ষা শেষ হলে পাওয়া যাবে।</small>' : ''}</div>${resultMarkup(db, e)}`;
    if (reset) scrollTop();
  }
  function repaint() {
    if (!activeAccount()) { list(); return; }
    const e = db.exams.find(e => e.id === examId && isStudentVisibleExam(e));
    if (view === 'active' && e) {
      const a = own(e).find(a => a.id === attemptId);
      if (a?.status === 'active') root.querySelectorAll('[data-answer-question]').forEach(input => { input.checked = a.answers[input.dataset.answerQuestion] === input.value; });
      else results(e);
    } else if (view === 'results' && e) results(e, false);
    else list();
  }
  async function refresh() {
    try { db = await repo.listForStudent(getStudent()?.id); ready = true; repaint(); }
    catch (e) { ready = false; content.innerHTML = ''; error(e.message || 'পরীক্ষার ডেটা লোড হয়নি।'); }
  }
  async function run(operation, after = repaint) {
    if (busy || !ready || !activeAccount()) return;
    busy = true; error('');
    const controls = [...root.querySelectorAll('button, input')]; controls.forEach(el => { el.disabled = true; });
    try { const snapshot = await operation(); if (snapshot?.exams) db = snapshot; await after(); }
    catch (e) { error(e instanceof DOMException ? 'সংরক্ষণ/ডাউনলোড হয়নি। ফোনের স্টোরেজ পরীক্ষা করে আবার চেষ্টা করো।' : e.message || 'সংরক্ষণ হয়নি। আবার চেষ্টা করো।'); }
    finally { busy = false; controls.forEach(el => { el.disabled = false; }); }
  }
  const LOW_TIME_MS = 5 * 60000;
  const bnDigits = value => String(value).replace(/[0-9]/g, d => '০১২৩৪৫৬৭৮৯'[d]);
  function clock() {
    const e = db.exams.find(e => e.id === examId);
    if ($('[data-exam-clock]') && e) {
      const seconds = Math.max(0, Math.ceil((e.endAt - Date.now()) / 1000));
      const readable = bnDigits(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
      const left = e.endAt - Date.now(), node = $('[data-exam-clock]');
      const low = left > 0 && left <= LOW_TIME_MS, hint = $('[data-low-hint]');
      node.textContent = left <= 0 ? 'সময় শেষ' : `সময় বাকি ${readable}`;
      node.dataset.lowTime = low ? 'true' : 'false';
      node.title = low ? 'শেষ ৫ মিনিট — উত্তরপত্র স্বয়ংক্রিয়ভাবে জমা হবে।' : '';
      if (hint) { hint.hidden = !low; hint.textContent = low ? 'শেষ ৫ মিনিট — সময় শেষে উত্তরপত্র নিজে থেকে জমা হবে।' : ''; }
      const count = Object.keys(db.attempts.find(a => a.id === attemptId)?.answers || {}).length;
      $('[data-answer-status]').textContent = !$('[data-exam-error]').hidden ? $('[data-exam-error]').textContent : `${bnDigits(count)} / ${bnDigits(e.questions.length)} উত্তর ফোনে সংরক্ষিত • ${navigator.onLine ? 'অনলাইন' : 'অফলাইন'}`;
    }
  }
  async function sync() {
    if (busy || !ready || !activeAccount()) return;
    const pending = db.attempts.some(a => a.studentId === getStudent().id && (a.status === 'queued' && navigator.onLine !== false || a.status === 'active' && Date.now() >= db.exams.find(e => e.id === a.examId).endAt));
    if (pending) await run(() => repo.syncStudent(getStudent().id));
  }
  root.addEventListener('change', event => {
    const input = event.target.closest('[data-answer-question]'); if (!input) return;
    run(() => repo.saveAnswer(attemptId, getStudent().id, input.dataset.answerQuestion, input.value), clock).then(() => repaint());
  });
  root.addEventListener('click', event => {
    const target = event.target.closest('[data-student-exam-action]'); if (!target || busy) return;
    const action = target.dataset.studentExamAction, e = db.exams.find(e => e.id === target.dataset.id); error(''); message('');
    if (action === 'list') { list(); scrollTop(); }
    else if (action === 'refresh') refresh().then(sync);
    else if (!ready) error('ডেটা লোড হয়নি। আবার চেষ্টা করো।');
    else if (action === 'start') run(() => repo.startAttempt(e.id, getStudent()), () => { const current = db.exams.find(item => item.id === e.id); activeExam(current, own(current).find(a => a.status === 'active')); });
    else if (action === 'resume') activeExam(e, own(e).find(a => a.status === 'active'));
    else if (action === 'results') results(e);
    else if (action === 'confirm') { $('[data-submit-confirm]').hidden = false; $('[data-student-exam-action=finish]').focus(); }
    else if (action === 'cancel-confirm') $('[data-submit-confirm]').hidden = true;
    else if (action === 'finish') run(() => repo.finishAttempt(attemptId, getStudent().id), () => results(db.exams.find(item => item.id === e.id)));
    else if (action === 'paper') run(() => downloadExamPDF(e, { attempt: examResults(db, e).find(a => a.studentId === getStudent().id) || own(e).at(-1) }), () => message('PDF ডাউনলোড শুরু হয়েছে।'));
    else if (action === 'solutions') run(async () => {
      const refreshed = await repo.listForStudent(getStudent()?.id);
      const current = refreshed.exams.find(item => item.id === target.dataset.id);
      if (!current || Date.now() < current.endAt) throw new Error('পরীক্ষা শেষ হলে সঠিক উত্তরসহ PDF পাওয়া যাবে।');
      await downloadExamPDF(current, { solutions: true, attempt: examResults(refreshed, current).find(item => item.studentId === getStudent().id) || own(current).at(-1) });
      return refreshed;
    }, () => message('PDF ডাউনলোড শুরু হয়েছে।'));
  });
  window.addEventListener('apc-notification-action', event => {
    const detail = event.detail || {};
    if (!['exam', 'exam-soon', 'exam-live'].includes(detail.kind) || !detail.id) return;
    void refresh().then(() => {
      const card = [...root.querySelectorAll('[data-student-exam]')]
        .find(item => item.dataset.studentExam === String(detail.id));
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const action = ['start', 'resume'].includes(detail.action) ? detail.action : '';
      const control = action ? card.querySelector(`[data-student-exam-action="${action}"]`) : null;
      if (control && !control.disabled) control.click();
      else card.querySelector('.exam-actions button')?.focus?.({ preventScroll: true });
    });
  });
  watchExams(() => { if (!busy) refresh(); });
  window.addEventListener('online', () => refresh().then(sync));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh().then(sync); });
  /* The heartbeat only keeps exam state current. MCQ answer PDFs are never
     generated in the background: only the student's explicit solutions
     button can invoke downloadExamPDF. */
  let lastMinute = -1;
  setInterval(() => {
    clock(); sync();
    const minute = Math.floor(Date.now() / 1000);
    if (ready && !busy && minute !== lastMinute && view !== 'active') {
      // Refresh time-based buttons without moving focus away from the current control.
      const transition = db.exams.some(e => [e.startAt, e.endAt, e.startAt + e.lateMinutes * 60000 + 1000].some(t => t > lastMinute * 1000 && t <= Date.now()));
      if (transition) repaint();
    }
    lastMinute = minute;
  }, 1000);
  refresh();
  return () => refresh().then(sync);
}
