/* ইনস্ট্যান্ট MCQ অনুশীলন (Instant MCQ practice) — the self-study companion
   of the examination module.
   ---------------------------------------------------------------------------
   Official papers stay exactly as they are: scheduled, rostered, time-boxed,
   Manager-published results. Practice is a separate, instant lane:
     • source — the question bank, which every taken MCQ paper joins the
       moment it is published (js/exam-data.js) or is backfilled on load
       (questionBank.ensureExamsInBank), so past exams accumulate here;
     • when — any moment: no schedule, no late window, no roster. The sheet
       runs under a live timer like the real sitting — one minute per
       question on every sheet — and when the clock hits zero the paper
       submits itself and the result appears, exactly like the end of an
       official exam;
     • result — shown at the end of the exam: self-marked the moment the
       sheet closes (early submit or time up), with the correct answer
       beside every question, so a practice session doubles as a study
       session;
     • no leaks — a paper only becomes practicable after its official window
       has ended (bank rows carry the exam's endAt), so an upcoming exam's
       questions can never be drilled early;
     • no contamination — nothing is written to the official attempt store,
       so a practice session can never touch a real result, a rank, or a
       retry.
   Sessions live in `activePlus.mcqPractice.v1`, local to this device —
   self-study history is personal and offline, like the rest of the demo. */
import { examRepository as repo, examMatchesStudent, watchExams } from './exam-data.js';
import { ensureExamsInBank, listQuestions, watchQuestionBank } from './question-bank.js';
import { esc, num, when } from './exam-ui.js';

const PRACTICE_KEY = 'activePlus.mcqPractice.v1';
const MAX_SESSIONS = 20;
const RANDOM_SIZE = 20;
/* One practice minute per question — a uniform, predictable pace for every
   sheet, whether it is a full past paper or a random drill. */
const PRACTICE_MINUTES_PER_QUESTION = 1;
const LOW_TIME_MS = 5 * 60000;

const readStore = () => { try { return JSON.parse(localStorage.getItem(PRACTICE_KEY) || '{}') || {}; } catch { return {}; } };
const writeStore = store => localStorage.setItem(PRACTICE_KEY, JSON.stringify(store));
const shuffle = items => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
};
const sessionId = () => `P${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const storeFor = student => readStore()[student.id] || { active: null, sessions: [] };
const saveFor = (student, entry) => { const store = readStore(); store[student.id] = entry; writeStore(store); };

/** Papers a student may drill: bank questions grouped by the examination
    they came from, class/batch-matched, and only after the official window
    has ended. Every drill is paced at one minute per question. */
function practicePapers(student, now = Date.now()) {
  const rows = listQuestions().filter(row => row.type === 'mcq' && row.active && row.source?.examId && row.endAt > 0 && row.endAt < now);
  const byExam = new Map();
  for (const row of rows) {
    const paper = byExam.get(row.source.examId) || {
      examId: row.source.examId, examCode: row.source.examCode || '', title: row.source.examTitle || 'অতীত পরীক্ষা',
      className: row.className, group: row.group || '', subject: row.subject, startAt: 0, endAt: row.endAt, questions: []
    };
    if (row.startAt > paper.startAt) paper.startAt = row.startAt;
    paper.questions.push(row);
    byExam.set(row.source.examId, paper);
  }
  return [...byExam.values()]
    .filter(paper => examMatchesStudent({ className: paper.className, group: paper.group }, student))
    .sort((a, b) => b.endAt - a.endAt)
    .map(paper => ({
      ...paper,
      /* One minute a question, the same rule the random drill uses. */
      durationMinutes: paper.questions.length * PRACTICE_MINUTES_PER_QUESTION
    }));
}
/** The pool the random drill draws from — the questions of every practicable
    paper, class/batch-matched. */
function practicePool(student, now = Date.now()) {
  const ids = new Set();
  for (const paper of practicePapers(student, now)) paper.questions.forEach(row => ids.add(row.id));
  return listQuestions().filter(row => ids.has(row.id));
}
const bestScore = (sessions, examId) => {
  const own = sessions.filter(session => session.kind === 'paper' && session.examId === examId);
  return own.length ? own.reduce((best, session) => (session.score > best.score ? session : best)) : null;
};
function startSession(student, { kind, title, examId = '', examCode = '', questions, durationMinutes }) {
  const minutes = Math.max(1, Math.round(durationMinutes) || questions.length * PRACTICE_MINUTES_PER_QUESTION);
  const startsAt = Date.now();
  const session = {
    id: sessionId(), at: startsAt, kind, title, examId, examCode,
    className: student.className || '', subject: '',
    /* The deadline is absolute — it does not pause while the student leaves
       the screen, exactly like the official paper's shared end time. The
       low-time flag sounds at five minutes on a long sheet, or at half the
       time left on a short one, so a 3-minute drill is never "last five
       minutes" from the first second. */
    startsAt, durationMs: minutes * 60000, endsAt: startsAt + minutes * 60000,
    lowMs: Math.min(LOW_TIME_MS, minutes * 30000),
    order: shuffle(questions).map(row => ({ id: row.id, options: row.options.map(option => option.id) })),
    total: questions.length, answers: {},
    /* A copy, on purpose: a practice sheet keeps working even if the shelf
       row is edited or removed while the student is mid-session. */
    questions: questions.map(row => ({ id: row.id, text: row.text, answer: row.answer, options: row.options.map(option => ({ id: option.id, text: option.text })) }))
  };
  saveFor(student, { ...storeFor(student), active: session });
  return session;
}
/* A sheet that started before the timer existed gets a fresh standard
   window, so an old in-flight draft never looks endless. */
function withTimer(session) {
  if (session && (!Number.isFinite(session.endsAt) || session.endsAt <= 0)) {
    const minutes = Math.max(1, (session.total || 0) * PRACTICE_MINUTES_PER_QUESTION);
    const startsAt = Date.now();
    session.startsAt = startsAt;
    session.durationMs = minutes * 60000;
    session.endsAt = startsAt + minutes * 60000;
    session.lowMs = Math.min(LOW_TIME_MS, minutes * 30000);
  }
  return session;
}
function finishSession(student, session, { auto = false } = {}) {
  const results = {}; let correct = 0, wrong = 0, unanswered = 0;
  for (const question of session.questions) {
    const chosen = session.answers[question.id] || '';
    const isCorrect = !!chosen && chosen === question.answer;
    if (!chosen) unanswered += 1; else if (isCorrect) correct += 1; else wrong += 1;
    results[question.id] = { chosen, correct: isCorrect };
  }
  const record = {
    id: session.id, at: session.at, kind: session.kind, title: session.title, examId: session.examId,
    total: session.total, score: correct, correct, wrong, unanswered, auto,
    results, order: session.order, answers: session.answers, questions: session.questions
  };
  const entry = storeFor(student);
  entry.active = null;
  entry.sessions = [record, ...entry.sessions].slice(0, MAX_SESSIONS);
  saveFor(student, entry);
  return record;
}

export function initStudentPractice({ getStudent, getAccount }) {
  const root = document.querySelector('#studentPracticeWorkspace'); if (!root) return () => {};
  let view = 'list', activeSession = null, lastRecord = null, busy = false;
  root.classList.add('exam-workspace', 'practice-workspace');
  root.innerHTML = '<p class="exam-error" data-practice-error role="alert" hidden></p><p class="exam-message" data-practice-message role="status" hidden></p><div data-practice-content></div>';
  const $ = selector => root.querySelector(selector), content = $('[data-practice-content]');
  const activeAccount = () => getAccount()?.status === 'active';
  const button = (action, label, id = '', cls = '') => `<button type="button" class="${cls}" data-practice-action="${action}" data-id="${esc(id)}">${label}</button>`;
  function error(text) { const node = $('[data-practice-error]'); node.textContent = text; node.hidden = !text; }
  function message(text) { const node = $('[data-practice-message]'); node.textContent = text; node.hidden = !text; }

  function historyMarkup(sessions) {
    if (!sessions.length) return '';
    return `<section aria-label="সাম্প্রতিক অনুশীলন"><h3>সাম্প্রতিক অনুশীলন</h3><div class="practice-history">${sessions.slice(0, 10).map(session => {
      const percent = session.total ? Math.round(session.score / session.total * 100) : 0;
      return `<p class="practice-history-row"><span>${when(session.at)}</span><span>${esc(session.title)}</span><strong>${num(session.score)}/${num(session.total)} • ${num(percent)}%</strong></p>`;
    }).join('')}</div></section>`;
  }
  function list() {
    view = 'list'; activeSession = null; lastRecord = null;
    if (!activeAccount()) { content.innerHTML = '<p class="exam-card">অনুমোদিত অ্যাকাউন্ট দিয়ে লগইন করতে হবে।</p>'; return; }
    const student = getStudent(), now = Date.now();
    const papers = practicePapers(student, now), pool = practicePool(student, now);
    let entry = storeFor(student);
    if (entry.active) {
      const pickedUpTimer = !Number.isFinite(entry.active.endsAt) || entry.active.endsAt <= 0;
      withTimer(entry.active);
      if (entry.active.endsAt <= now) {
        /* Time ran out while the student was away: close and mark the sheet
           like the official paper — the result waits on the history. */
        finishSession(student, entry.active, { auto: true });
        entry = storeFor(student);
      } else if (pickedUpTimer) {
        /* A pre-timer draft just picked up its window — persist it so the
           deadline does not restart on the next visit. */
        saveFor(student, { ...storeFor(student), active: entry.active });
      }
    }
    const poolSize = pool.length ? Math.min(RANDOM_SIZE, pool.length) : 0;
    content.innerHTML = `
      <section class="exam-card practice-card" aria-label="ইনস্ট্যান্ট MCQ অনুশীলন">
        <h2>ইনস্ট্যান্ট MCQ অনুশীলন</h2>
        <p class="exam-note">যেকোনো মুহূর্তে শুরু করো — প্রতিটি প্রশ্নের জন্য ${num(PRACTICE_MINUTES_PER_QUESTION)} মিনিট করে সময়সীমা থাকে। সময় শেষ হলে উত্তরপত্র নিজে থেকেই জমা হয়ে পরীক্ষা শেষে ফলাফল দেখাবে। এটি নিজের অনুশীলন; আনুষ্ঠানিক পরীক্ষার ফলাফলে এর কোনো প্রভাব পড়ে না।</p>
        ${entry.active ? `<div class="exam-actions">${button('resume-active', 'চলন্ত অনুশীলনে ফিরে যাও', entry.active.id, 'primary')}</div>` : ''}
        <div class="exam-actions">${poolSize ? button('start-random', `র‍্যান্ডম অনুশীলন (${num(poolSize)}টি প্রশ্ন • ${num(poolSize * PRACTICE_MINUTES_PER_QUESTION)} মিনিট)`, '', 'primary') : '<small>অনুশীলনের জন্য এখনও প্রশ্ন নেই — MCQ পরীক্ষার সময় শেষ হলে তার প্রশ্নগুলো নিজে থেকেই এখানে আসবে।</small>'}</div>
        <p class="exam-note">র‍্যান্ডম ড্রিলে প্রতি প্রশ্নে ${num(PRACTICE_MINUTES_PER_QUESTION)} মিনিট।</p>
      </section>
      <section aria-label="গত পরীক্ষা অনুশীলন"><h3>গত পরীক্ষা অনুশীলন</h3>
        <div class="exam-list">${papers.map(paper => {
          const best = bestScore(entry.sessions, paper.examId);
          return `<article class="exam-card">
            <h4>${esc(paper.title)}</h4>
            <p class="exam-note">${when(paper.endAt)} • ${num(paper.questions.length)}টি প্রশ্ন • ${num(paper.durationMinutes)} মিনিট${paper.subject ? ` • ${esc(paper.subject)}` : ''}</p>
            <p class="exam-note practice-best">${best ? `তোমার সেরা: ${num(best.score)}/${num(best.total)}` : 'এখনও অনুশীলন করা হয়নি।'}</p>
            <div class="exam-actions">${button('start-paper', 'অনুশীলন শুরু করুন', paper.examId, 'primary')}</div>
          </article>`;
        }).join('') || '<p class="exam-card">এখনও কোনো গত MCQ পরীক্ষার প্রশ্ন ব্যাংকে নেই।</p>'}</div>
      </section>
      ${historyMarkup(entry.sessions)}`;
  }
  function updateStatus() {
    const node = $('[data-practice-status]');
    if (node && activeSession) node.textContent = `${num(Object.keys(activeSession.answers).length)} / ${num(activeSession.total)} উত্তর দেওয়া • এই ফোনে সংরক্ষিত`;
  }
  function active(session) {
    const pickedUpTimer = !Number.isFinite(session?.endsAt) || session.endsAt <= 0;
    session = withTimer(session);
    if (pickedUpTimer) saveFor(getStudent(), { ...storeFor(getStudent()), active: session });
    if (session.endsAt <= Date.now()) { autoFinish('সময় শেষ — উত্তরপত্র নিজে থেকেই জমা হয়েছে।'); return; }
    view = 'active'; activeSession = session; lastRecord = null;
    const minutes = Math.max(1, Math.round(session.durationMs / 60000));
    content.innerHTML = `
      <div class="exam-actions">${button('keep', '← তালিকা (চলন্ত উত্তর সংরক্ষিত থাকবে)')}</div>
      <div class="exam-timer"><span>ইনস্ট্যান্ট অনুশীলন • ${num(minutes)} মিনিট</span><strong data-practice-clock aria-live="off"></strong><em class="exam-timer-hint" data-low-hint hidden></em><small data-practice-status></small></div>
      <h2>${esc(session.title)}</h2>
      <p class="exam-note">সব প্রশ্ন একসঙ্গে দেখানো হয়েছে — খুঁজতে স্ক্রল করো। চাইলে যেকোনো উত্তর বদলাও; সময়ের আগে জমা দিতে চাইলে “উত্তরপত্র জমা দাও” চাপো। সময় শেষ হলে উত্তরপত্র <strong>স্বয়ংক্রিয়ভাবে জমা</strong> হবে এবং পরীক্ষা শেষে ফলাফল দেখাবে।</p>
      <div class="exam-question-list">${session.order.map((item, i) => {
        const question = session.questions.find(q => q.id === item.id);
        return `<fieldset class="exam-question"><legend>প্রশ্ন ${num(i + 1)}</legend><p>${esc(question.text)}</p>${item.options.map(id => {
          const option = question.options.find(o => o.id === id);
          return `<label class="exam-option"><input type="radio" name="practice-${question.id}" value="${id}" data-practice-answer="${question.id}" ${session.answers[question.id] === id ? 'checked' : ''}><span>${id}. ${esc(option.text)}</span></label>`;
        }).join('')}</fieldset>`;
      }).join('')}</div>
      <div class="exam-actions">${button('confirm', 'উত্তরপত্র জমা দাও', '', 'primary')}</div>
      <div class="exam-card" data-practice-confirm hidden><h3>এখনই জমা দেবে?</h3><p>জমা দেওয়ার পর এই অনুশীলনের উত্তর বদলানো যাবে না — ফলাফলের স্ক্রিন থেকে আবার শুরু করা যাবে।</p><div class="exam-actions">${button('finish', 'হ্যাঁ, জমা দাও', '', 'primary')}${button('cancel-confirm', 'উত্তরে ফিরে যাও')}</div></div>`;
    updateStatus(); tickClock();
  }
  /** The one-second heartbeat while a sheet is on screen: the countdown,
      the last-five-minutes flag, and the automatic submit at zero. */
  function tickClock() {
    if (view !== 'active' || !activeSession) return;
    const left = activeSession.endsAt - Date.now();
    const lowMs = activeSession.lowMs || LOW_TIME_MS;
    const node = $('[data-practice-clock]');
    if (node) {
      const seconds = Math.max(0, Math.ceil(left / 1000));
      node.textContent = left <= 0 ? 'সময় শেষ' : `সময় বাকি ${num(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`)}`;
      const low = left > 0 && left <= lowMs;
      node.dataset.lowTime = low ? 'true' : 'false';
      node.title = low ? 'সময় কমে আসছে — উত্তরপত্র স্বয়ংক্রিয়ভাবে জমা হবে।' : '';
    }
    const hint = $('[data-low-hint]');
    if (hint) {
      const low = left > 0 && left <= lowMs;
      hint.hidden = !low;
      hint.textContent = low ? 'সময় কমে আসছে — শেষে উত্তরপত্র নিজে থেকেই জমা হবে।' : '';
    }
    if (left <= 0) autoFinish('সময় শেষ — উত্তরপত্র নিজে থেকেই জমা হয়েছে।');
  }
  function autoFinish(note) {
    const session = activeSession;
    if (!session) return;
    const record = finishSession(getStudent(), session, { auto: true });
    activeSession = null;
    result(record);
    if (note) message(note);
  }
  function result(record) {
    view = 'result'; activeSession = null; lastRecord = record;
    const percent = record.total ? Math.round(record.score / record.total * 100) : 0;
    content.innerHTML = `
      <div class="exam-actions">${button('list', '← অনুশীলনের তালিকা')}${button('repeat', record.kind === 'paper' ? 'আবার অনুশীলন করো' : 'নতুন র‍্যান্ডম অনুশীলন', record.examId, 'primary')}</div>
      <div class="exam-summary"><h3>${esc(record.title)}${record.auto ? ' (সময় শেষে স্বয়ংক্রিয় জমা)' : ''}</h3>
        <strong>${num(record.score)} / ${num(record.total)} (${num(percent)}%)</strong>
        <p>সঠিক ${num(record.correct)} • ভুল ${num(record.wrong)} • অনুত্তরিত ${num(record.unanswered)}</p>
        <p class="exam-note">পরীক্ষা শেষে এটাই তোমার ফলাফল — এটি অনুশীলনের, আনুষ্ঠানিক ফলাফল, র‍্যাংক বা দ্বিতীয় সুযোগে যুক্ত হয় না।</p>
      </div>
      <div class="exam-question-list practice-review">${record.order.map((item, i) => {
        const question = record.questions.find(q => q.id === item.id);
        const res = record.results[item.id] || { chosen: '', correct: false };
        const mark = res.correct ? '✓ সঠিক' : res.chosen ? '✗ ভুল' : '— অনুত্তরিত';
        const state = res.correct ? 'practice-correct' : res.chosen ? 'practice-wrong' : 'practice-skip';
        const chosenText = question.options.find(o => o.id === res.chosen)?.text || '';
        const answerText = question.options.find(o => o.id === question.answer)?.text || '';
        return `<fieldset class="exam-question ${state}"><legend>প্রশ্ন ${num(i + 1)} • ${mark}</legend><p>${esc(question.text)}</p>
          <p class="exam-note">তোমার উত্তর: ${res.chosen ? `${res.chosen}. ${esc(chosenText)}` : 'অনুত্তরিত'} • সঠিক উত্তর: <strong>${question.answer}. ${esc(answerText)}</strong></p>
        </fieldset>`;
      }).join('')}</div>`;
  }
  function repaint() {
    if (view === 'active' && activeSession) active(activeSession);
    else if (view === 'result' && lastRecord) result(lastRecord);
    else list();
  }
  async function refresh() {
    if (busy || !activeAccount()) { if (view === 'list') list(); return; }
    busy = true; error('');
    try {
      /* The student's own device also fills the shelf from its papers, so
         practice works offline on a device that never saw the manager. */
      const db = await repo.list();
      await ensureExamsInBank(db.exams, 'Student');
      repaint();
    } catch (e) { error(e.message || 'অনুশীলনের ডেটা লোড হয়নি। আবার চেষ্টা করো।'); }
    finally { busy = false; }
  }
  root.addEventListener('change', event => {
    const input = event.target.closest('[data-practice-answer]');
    if (!input || !activeSession) return;
    activeSession.answers[input.dataset.practiceAnswer] = input.value;
    saveFor(getStudent(), { ...storeFor(getStudent()), active: activeSession });
    updateStatus();
  });
  root.addEventListener('click', event => {
    const target = event.target.closest('[data-practice-action]');
    if (!target || busy) return;
    const action = target.dataset.practiceAction, student = getStudent();
    error(''); message('');
    if (action === 'list') { view = 'list'; lastRecord = null; refresh(); return; }
    if (action === 'refresh') { refresh(); return; }
    if (!activeAccount()) { error('অনুমোদিত অ্যাকাউন্ট দিয়ে লগইন করতে হবে।'); return; }
    if (action === 'start-random') {
      const pool = shuffle(practicePool(student)).slice(0, RANDOM_SIZE);
      if (!pool.length) { error('অনুশীলনের জন্য ব্যাংকে প্রশ্ন নেই।'); return; }
      const session = startSession(student, { kind: 'random', title: 'র‍্যান্ডম অনুশীলন (গত পরীক্ষার প্রশ্ন)', questions: pool, durationMinutes: pool.length * PRACTICE_MINUTES_PER_QUESTION });
      active(session);
    } else if (action === 'start-paper') {
      const paper = practicePapers(student).find(p => p.examId === target.dataset.id);
      if (!paper) { error('এই পরীক্ষাটি এখন অনুশীলন করা যাচ্ছে না।'); return; }
      const session = startSession(student, { kind: 'paper', title: paper.title, examId: paper.examId, examCode: paper.examCode, questions: paper.questions, durationMinutes: paper.durationMinutes });
      active(session);
    } else if (action === 'resume-active') {
      const entry = storeFor(student);
      if (entry.active) active(entry.active); else list();
    } else if (action === 'keep') {
      /* The in-progress sheet is already saved to this device on every
         answer, so leaving it keeps the work. */
      list();
    } else if (action === 'confirm') {
      const node = $('[data-practice-confirm]');
      if (node) { node.hidden = false; $('[data-practice-action="finish"]')?.focus(); }
    } else if (action === 'cancel-confirm') { const node = $('[data-practice-confirm]'); if (node) node.hidden = true; }
    else if (action === 'finish') {
      if (!activeSession) return;
      const record = finishSession(student, activeSession);
      result(record);
    } else if (action === 'repeat') {
      if (lastRecord?.kind === 'paper') {
        const paper = practicePapers(student).find(p => p.examId === lastRecord.examId);
        if (paper) active(startSession(student, { kind: 'paper', title: paper.title, examId: paper.examId, examCode: paper.examCode, questions: paper.questions, durationMinutes: paper.durationMinutes }));
        else message('এই পরীক্ষাটি এখন আর অনুশীলন করা যাচ্ছে না।');
      } else {
        const pool = shuffle(practicePool(student)).slice(0, RANDOM_SIZE);
        if (pool.length) active(startSession(student, { kind: 'random', title: 'র‍্যান্ডম অনুশীলন (গত পরীক্ষার প্রশ্ন)', questions: pool, durationMinutes: pool.length * PRACTICE_MINUTES_PER_QUESTION }));
        else message('অনুশীলনের জন্য ব্যাংকে প্রশ্ন নেই।');
      }
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  /* A paper landing (demo autofill, a manager publish in another tab) or a
     shelf change must reach the practice list without a manual refresh. */
  watchExams(() => { if (!busy) refresh(); });
  watchQuestionBank(() => { if (!busy) refresh(); });
  /* One heartbeat for the whole module; it only acts while a sheet is on
     screen, so the list and the result cost nothing. */
  setInterval(tickClock, 1000);
  refresh();
  return () => refresh();
}
