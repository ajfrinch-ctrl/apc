/* Published teacher work, scoped to the signed-in student's class and group.
   No teacher editing controls are mounted in the student app. */
import { toBanglaNumber as bn, showFeedback, openModal, closeModal } from './ui.js';
import { downloadBlob } from './exam-pdf.js';
import { activitySheetPDF, materialFileName } from './material-pdf.js';
import { teachingRepository, publishedForStudent, ACTIVITY_TYPES, PROGRESS_LABELS, escapeText as esc, displayDate, safeResourceURL, watchTeachingData } from './teaching-data.js';

export function initStudentTeaching({ getStudent }) {
  let db = { activities: [] }, filter = 'all', request = 0;
  const pending = new Set();
  const $ = selector => document.querySelector(selector);
  const num = value => esc(bn(value));
  function card(a, student) {
    const progress = a.progress[student.id];
    const link = safeResourceURL(a.resourceURL);
    const material = !link && Boolean((a.details || '').trim());
    const outcome = a.type === 'exam' && progress ? `প্রাপ্ত নম্বর: ${bn(progress.value)} / ${bn(a.totalMarks)}` : progress ? PROGRESS_LABELS[progress.value] : '';
    const canComplete = a.type === 'homework' && !['done', 'reviewed'].includes(progress?.value);
    const complete = a.type === 'homework' && ['done', 'reviewed'].includes(progress?.value);
    const status = a.type === 'homework' ? (complete ? 'সম্পন্ন' : 'কাজ বাকি') : a.type === 'exam' ? (progress ? 'ফলাফল দেওয়া হয়েছে' : 'মূল্যায়ন') : a.type === 'routine' ? 'ক্লাস রুটিন' : 'পড়ার উপকরণ';
    const when = a.date ? `${a.type === 'homework' ? 'জমার শেষ সময়' : a.type === 'routine' ? 'ক্লাসের সময়' : 'নির্ধারিত তারিখ'}: ${esc(displayDate(a.date))}${a.time ? ` • ${num(a.time)}` : ''}` : a.room ? `স্থান: ${esc(a.room)}` : '';
    const brief = [when, outcome].filter(Boolean).join(' • ') || 'সব তথ্য দেখতে চাপ দিন';
    return `<article class="teaching-card learning-card learning-${esc(a.type)}" data-learning-id="${esc(a.id)}">
      <button class="learning-card-toggle" type="button" aria-expanded="false" aria-controls="learning-details-${esc(a.id)}">
        <span class="teaching-card-head"><span class="teaching-kind">${ACTIVITY_TYPES[a.type].label}</span><span class="learning-state${complete ? ' is-complete' : ''}">${status}</span></span>
        <strong class="learning-card-title">${esc(a.title)}</strong>
        <span class="learning-subject">${esc(a.subject)} <span>• ${esc(a.className)} • ${esc(a.group || 'সব বিভাগ')}</span></span>
        <span class="learning-brief">${brief}</span>
        <span class="learning-chevron" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></span>
      </button>
      <div class="learning-card-details" id="learning-details-${esc(a.id)}" hidden>
      ${a.date || a.room || a.totalMarks ? `<div class="learning-meta">
        ${a.date ? `<div><small>${a.type === 'homework' ? 'জমার শেষ সময়' : a.type === 'routine' ? 'ক্লাসের সময়' : 'নির্ধারিত তারিখ'}</small><strong>${esc(displayDate(a.date))}</strong>${a.time ? `<span>${num(a.time)}${a.duration ? ' • ' + num(a.duration) + ' মিনিট' : ''}</span>` : ''}</div>` : ''}
        ${a.room ? `<div><small>স্থান</small><strong>${esc(a.room)}</strong></div>` : ''}
        ${a.totalMarks ? `<div><small>পূর্ণমান</small><strong>${num(a.totalMarks)}</strong></div>` : ''}
      </div>` : ''}
      <p class="teaching-body">${esc(a.details)}</p>
      ${outcome ? `<p class="learning-outcome">${esc(outcome)}</p>` : ''}
      <div class="learning-teacher"><span aria-hidden="true">${esc(Array.from(a.teacherName || 'শ')[0])}</span><small>শিক্ষক • ${esc(a.teacherName)}</small></div>
      ${link || material || canComplete ? `<div class="learning-card-actions">
        ${link ? `<a class="teaching-resource" data-material="${esc(a.id)}" href="${esc(link)}" target="_blank" rel="noopener noreferrer">সহায়ক উপকরণ খুলুন <svg class="resource-arrow" aria-hidden="true" viewBox="0 0 24 24"><path d="M7 17 17 7M9 7h8v8"/></svg></a>` : material ? `<a class="teaching-resource" href="#material" data-material="${esc(a.id)}">উপকরণ PDF ডাউনলোড করুন</a>` : ''}
        ${canComplete ? `<div class="teaching-actions"><button class="primary" type="button" data-complete-homework="${esc(a.id)}" ${pending.has(a.id) ? 'disabled' : ''}>${pending.has(a.id) ? 'সংরক্ষণ হচ্ছে…' : 'কাজ সম্পন্ন হয়েছে জানাও'}</button></div><small class="learning-action-note">এটি শুধু সম্পন্ন হওয়ার খবর; খাতা/ফাইল জমা নয়।</small>` : ''}
      </div>` : ''}
      </div>
    </article>`;
  }
  function render() {
    const student = getStudent();
    const activities = publishedForStudent(db.activities, student).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const visible = activities.filter(a => filter === 'all' || a.type === filter);
    $('#learningList').innerHTML = visible.map(a => card(a, student)).join('') || '<p class="teacher-empty">এই বিভাগে তোমার জন্য এখনও কোনো কাজ প্রকাশ হয়নি।</p>';
    $('#learningCount').textContent = `${bn(activities.length)}টি প্রকাশিত কাজ • ${student.className}`;
    const homework = activities.filter(a => a.type === 'homework');
    const done = homework.filter(a => ['done', 'reviewed'].includes(a.progress[student.id]?.value)).length;
    const remaining = homework.length - done;
    $('#learningSummary').innerHTML = `<div><strong>${bn(activities.length)}</strong><span>মোট কাজ</span></div><div class="learning-summary-pending"><strong>${bn(remaining)}</strong><span>বাড়ির কাজ বাকি</span></div><div><strong>${bn(done)}</strong><span>বাড়ির কাজ সম্পন্ন</span></div>`;
    $('#learningFilters').querySelectorAll('button').forEach(button => {
      const type = button.dataset.learningFilter;
      const count = type === 'all' ? activities.length : activities.filter(a => a.type === type).length;
      const label = type === 'all' ? 'সব' : type === 'routine' ? 'রুটিন' : ACTIVITY_TYPES[type].label;
      button.innerHTML = `${label} <span class="learning-filter-count">${bn(count)}</span>`;
    });
    const routines = activities.filter(a => a.type === 'routine').sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    $('#teacherRoutineBoard').hidden = routines.length === 0;
    $('#teacherRoutineList').innerHTML = routines.map(a => card(a, student)).join('');
    const exams = activities.filter(a => a.type === 'exam' && a.progress[student.id]);
    $('#teacherResultsBoard').hidden = exams.length === 0;
    $('#teacherResultsList').innerHTML = exams.map(a => card(a, student)).join('');
  }
  async function refresh() {
    const current = ++request;
    try {
      const next = await teachingRepository.listForStudent(getStudent()?.id);
      if (current !== request) return;
      db = next; $('#learningError').hidden = true; render();
    } catch {
      if (current !== request) return;
      db = { activities: [] }; render();
      $('#learningError').hidden = false;
      $('#learningError').textContent = 'শিক্ষকের কাজ লোড হয়নি। পেজ রিফ্রেশ করে আবার চেষ্টা করো।';
    }
  }
  $('#learningFilters').addEventListener('click', event => {
    const button = event.target.closest('[data-learning-filter]'); if (!button) return;
    filter = button.dataset.learningFilter;
    $('#learningFilters').querySelectorAll('button').forEach(el => el.setAttribute('aria-pressed', String(el === button))); render();
  });
  window.addEventListener('apc-notification-action', event => {
    const detail = event.detail || {};
    if (detail.kind !== 'homework' || !detail.id) return;
    $('#learningFilters').querySelector('[data-learning-filter="homework"]')?.click();
    void refresh().then(() => {
      const card = [...$('#learningList').querySelectorAll('[data-learning-id]')]
        .find(item => item.dataset.learningId === String(detail.id));
      if (!card) return;
      const toggle = card.querySelector('.learning-card-toggle');
      if (toggle && toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toggle?.focus?.({ preventScroll: true });
    });
  });
  /* Tap a card to reveal its details; works on the courses board, the home
     routine board and the results board alike. The homework-complete button
     lives inside the revealed details, so this check comes first. */
  document.addEventListener('click', event => {
    const toggle = event.target.closest('.learning-card-toggle');
    if (!toggle) return;
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    const details = document.getElementById(toggle.getAttribute('aria-controls'));
    if (details) details.hidden = open;
  });
  $('#learningList').addEventListener('click', async event => {
    const button = event.target.closest('[data-complete-homework]'); if (!button) return;
    const id = button.dataset.completeHomework; if (pending.has(id)) return;
    pending.add(id); button.disabled = true; button.textContent = 'সংরক্ষণ হচ্ছে…';
    try { await teachingRepository.markHomeworkDone(id, getStudent()); showFeedback('কাজ সম্পন্ন হওয়ার খবর সংরক্ষিত হয়েছে'); }
    catch { showFeedback('সংরক্ষণ হয়নি। আবার চেষ্টা করো।'); }
    finally { pending.delete(id); await refresh(); }
  });

  /* Supplementary materials: the popup shows the full teacher work and the
     button below auto-downloads it — external files through a direct fetch,
     work without a file generates its own PDF in-app from the bundled Bangla
     font (the payment portal is the only place that renders images). */
  let resource = null;
  const fileNameOf = url => {
    try { const name = decodeURIComponent(new URL(url, location.href).pathname.split('/').filter(Boolean).pop() || ''); if (name) return name; } catch { /* fall through */ }
    return 'sahayok-upokoron';
  };
  const workBody = a => {
    const rows = [];
    if (a.date) rows.push(`<div><small>${a.type === 'homework' ? 'জমার শেষ সময়' : a.type === 'routine' ? 'ক্লাসের সময়' : 'নির্ধারিত তারিখ'}</small><strong>${esc(displayDate(a.date))}</strong>${a.time ? `<span>${num(a.time)}</span>` : ''}</div>`);
    if (a.room) rows.push(`<div><small>স্থান</small><strong>${esc(a.room)}</strong></div>`);
    if (a.totalMarks) rows.push(`<div><small>পূর্ণমান</small><strong>${num(a.totalMarks)}</strong></div>`);
    return `${rows.length ? `<div class="learning-meta">${rows.join('')}</div>` : ''}<p class="teaching-body">${esc(a.details || 'অতিরিক্ত নির্দেশনা নেই।')}</p>${a.teacherName ? `<div class="learning-teacher"><span aria-hidden="true">${esc(Array.from(a.teacherName || 'শ')[0])}</span><small>শিক্ষক • ${esc(a.teacherName)}</small></div>` : ''}`;
  };
  document.addEventListener('click', event => {
    const link = event.target.closest('a.teaching-resource');
    if (!link) return;
    event.preventDefault();
    const activity = db.activities.find(a => a.id === link.dataset.material) || null;
    const url = activity ? safeResourceURL(activity.resourceURL) : link.href;
    resource = { url: url || null, material: activity };
    const card = link.closest('.teaching-card');
    $('#resourceModalTitle').textContent = card?.querySelector('.learning-card-title')?.textContent.trim() || 'সহায়ক উপকরণ';
    $('#resourceModalMeta').textContent = activity
      ? `ফাইল: ${url ? fileNameOf(url) : materialFileName(activity)}`
      : `ফাইল: ${fileNameOf(link.href)}`;
    $('#resourceModalBody').innerHTML = activity ? workBody(activity) : '';
    $('#resourceOpenTab').hidden = !url; // in-app materials have nothing to open in a tab
    const status = $('#resourceModalStatus'); status.textContent = ''; status.classList.remove('is-error');
    openModal('resourceModal');
  });
  $('#resourceOpenTab').addEventListener('click', () => {
    if (resource?.url) window.open(resource.url, '_blank', 'noopener,noreferrer');
    closeModal('resourceModal');
  });
  $('#resourceDownload').addEventListener('click', async () => {
    if (!resource) return;
    const button = $('#resourceDownload'), status = $('#resourceModalStatus');
    button.disabled = true; status.classList.remove('is-error');
    status.textContent = resource.url ? 'ডাউনলোড শুরু হচ্ছে…' : 'PDF তৈরি হচ্ছে…';
    try {
      if (resource.url) {
        const response = await fetch(resource.url);
        if (!response.ok) throw new Error('load');
        downloadBlob(await response.blob(), fileNameOf(resource.url));
      } else await activitySheetPDF(resource.material);
      status.textContent = 'ডাউনলোড শুরু হয়েছে — ডিভাইসের ডাউনলোড ফোল্ডারে পাওয়া যাবে।';
    } catch {
      status.classList.add('is-error');
      if (resource.url) {
        status.textContent = 'সরাসরি ডাউনলোড সম্ভব হয়নি — উপকরণটি নতুন ট্যাবে খুলছি।';
        window.open(resource.url, '_blank', 'noopener,noreferrer');
      } else status.textContent = 'PDF তৈরি হয়নি। আবার চেষ্টা করো।';
    } finally { button.disabled = false; }
  });

  watchTeachingData(refresh);
  refresh();
  return refresh;
}
