/* কেন্দ্রীয় Work Management workspace (Teacher Panel)।

   একটাই প্রবেশপথ: ক্যাটাগরি → ফিচার → Class/Subject/Group → শিক্ষার্থী →
   Preview → Draft / Publish / Approval। ফর্ম এখানে দ্বিতীয়বার তৈরি হয় না:
   প্রতিটি ফিচার Registry-তে ঘোষিত তার নিজের আসল workflow-এ হ্যান্ডঅফ করে
   (activity editor, notice composer, exam builder, question editor,
   lecture studio, attendance sheet)। তাই কোনো ডেটা দুই জায়গায় লেখা হয় না।

   এই মডিউল কোনো storage/repository সরাসরি লেখে না এবং কোনো permission নিজে
   বানায় না — সব সিদ্ধান্ত js/work-registry.js এবং caller-এর দেওয়া write-path
   থেকে আসে। এখানে শুধু রেন্ডার, নির্বাচন ও হ্যান্ডঅফ-ইভেন্ট। */

import {
  WORK_CATEGORIES, WORK_STATUS_FILTERS, featureById, featuresOf,
  filterByStatus, planWork, statusMeta, teacherCan, teacherFeatures, requiresApproval
} from './work-registry.js';

const $ = (root, selector) => root?.querySelector?.(selector) || null;
const $$ = (root, selector) => [...(root?.querySelectorAll?.(selector) || [])];
const text = value => String(value ?? '').trim();
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const num = value => String(value ?? 0).replace(/\d/g, digit => '০১২৩৪৫৬৭৮৯'[Number(digit)]);

const TABS = Object.freeze([
  Object.freeze({ id: 'new', label: 'নতুন কাজ', icon: 'add' }),
  Object.freeze({ id: 'published', label: 'আমার প্রকাশিত কাজ', icon: 'approval' }),
  Object.freeze({ id: 'activity', label: 'শিক্ষার্থীদের কার্যক্রম', icon: 'students' }),
  Object.freeze({ id: 'classes', label: 'আমার ক্লাস', icon: 'classes' })
]);

const STEPS = Object.freeze(['category', 'feature', 'scope', 'review']);

const icon = (name, size = 24) => `<svg class="apc-color-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" data-icon="${esc(name)}" data-icon-set="active-plus-soft3d" data-icon-version="2" data-icon-style="color"><image href="assets/icons/ai-3d/${esc(name)}.svg" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/></svg>`;

const emptyData = () => ({
  activities: [], exams: [], examAttempts: [], notices: [], contents: [], questions: [],
  assignments: [], students: [], teacher: null, loading: false, error: ''
});

/** এক কাজের status ঠিক যেভাবে store-এ আছে, সেভাবেই দেখানো হয়। */
function workItem(row) {
  const status = row.status || 'draft';
  const meta = statusMeta(status);
  return { ...row, status, statusLabel: meta.label, statusTone: meta.tone };
}

function activityItems(data = emptyData()) {
  return (data.activities || []).map(activity => workItem({
    kind: 'activity',
    featureId: activity.type === 'routine' ? 'attendance' : activity.type,
    id: activity.id,
    title: activity.title || 'শিরোনামহীন কাজ',
    meta: [activity.className, activity.subject, activity.group].filter(Boolean).join(' • '),
    status: activity.status,
    updatedAt: activity.updatedAt || activity.createdAt || ''
  }));
}

function examItems(data = emptyData()) {
  return (data.exams || []).map(exam => workItem({
    kind: 'exam',
    featureId: 'online-exam',
    id: exam.id,
    title: exam.title || 'পরীক্ষা',
    meta: [exam.className, exam.subject, exam.status === 'pending' ? 'অনুমোদনের অপেক্ষায়' : ''].filter(Boolean).join(' • '),
    status: exam.status,
    updatedAt: exam.updatedAt || exam.createdAt || ''
  }));
}

function noticeItems(data = emptyData()) {
  const username = text(data.teacher?.username || 'teacher.apc');
  return (data.notices || [])
    .filter(notice => notice && notice.createdByRole === 'teacher' && text(notice.createdBy) === username)
    .map(notice => workItem({
      kind: 'notice',
      featureId: 'notice',
      id: notice.id,
      title: notice.title || 'নোটিশ',
      meta: [notice.className || 'সব শ্রেণি', notice.group].filter(Boolean).join(' • '),
      status: notice.status,
      updatedAt: notice.updatedAt || notice.createdAt || ''
    }));
}

function contentItems(data = emptyData()) {
  return (data.contents || []).filter(record => record?.published === true).map(record => workItem({
    kind: 'content',
    featureId: contentFeatureId(record),
    id: record.id,
    title: record.title || 'উপকরণ',
    meta: [record.className, record.subject, record.chapterName].filter(Boolean).join(' • '),
    status: 'published',
    updatedAt: record.updatedAt || record.createdAt || ''
  }));
}

function contentFeatureId(record) {
  const type = text(record.type || record.contentType || 'note');
  if (record.isLectureSheet === true) return 'lecture-sheet';
  if (type === 'important_question') return 'important-question';
  if (type === 'model_test') return 'model-test';
  if (type === 'assignment') return 'assignment';
  if (type === 'pdf' || type === 'video' || type === 'previous_question') return 'study-material';
  return 'class-note';
}

function allWorks(data = emptyData()) {
  return [...activityItems(data), ...examItems(data), ...noticeItems(data), ...contentItems(data)]
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

function assignmentScopes(assignments = []) {
  const seen = new Set();
  const rows = [];
  for (const item of assignments) {
    const className = text(item.className);
    if (!className) continue;
    const group = text(item.group);
    const key = `${className}\u0000${group}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const subjects = Array.isArray(item.subjects) && item.subjects.length ? item.subjects : [item.subject];
    rows.push({ className, group, subjects: [...new Set(subjects.map(text).filter(subject => subject && subject !== 'Test'))] });
  }
  return rows;
}

function classNameOptions(scopes, selected) {
  const names = [...new Set(scopes.map(scope => scope.className))];
  return [`<option value="">শ্রেণি বেছে নিন</option>`, ...names.map(name => `<option value="${esc(name)}" ${name === selected ? 'selected' : ''}>${esc(name)}</option>`)].join('');
}

function groupOptions(scopes, className, selected) {
  const groups = [...new Set(scopes.filter(scope => scope.className === className).map(scope => scope.group).filter(Boolean))];
  return [`<option value="">সব বিভাগ</option>`, ...groups.map(group => `<option value="${esc(group)}" ${group === selected ? 'selected' : ''}>${esc(group)}</option>`)].join('');
}

function subjectOptions(scopes, className, group, selected) {
  const subjects = [...new Set(scopes
    .filter(scope => scope.className === className && (!group || !scope.group || scope.group === group))
    .flatMap(scope => scope.subjects))];
  return [`<option value="">বিষয় বেছে নিন</option>`, ...subjects.map(subject => `<option value="${esc(subject)}" ${subject === selected ? 'selected' : ''}>${esc(subject)}</option>`)].join('');
}

export function mountWorkManagement({
  mount, section, getData = emptyData, onOpenFeature = () => {}, onOpenItem = () => {}, toast = () => {}
} = {}) {
  const host = typeof mount === 'string' ? document.querySelector(mount) : mount;
  const root = typeof section === 'string' ? document.querySelector(section) : section || host?.closest?.('.teacher-view');
  if (!host || !root) return null;

  const state = {
    tab: 'classes',
    step: 'category',
    category: '',
    featureId: '',
    className: '',
    subject: '',
    group: '',
    audience: 'class',
    students: [],
    showPreview: false,
    statusFilter: 'all',
    error: ''
  };

  const data = () => ({ ...emptyData(), ...(getData() || {}) });

  function tabCounts() {
    const source = data();
    const works = allWorks(source);
    return {
      new: teacherFeatures().length,
      published: works.length,
      activity: (source.activities || []).filter(row => row.type === 'homework' && row.status === 'published').length,
      classes: assignmentScopes(source.assignments).length
    };
  }

  function renderTabs() {
    const counts = tabCounts();
    const tabs = $(host, '#workTabs');
    if (!tabs) return;
    tabs.innerHTML = TABS.map(tab => {
      const active = tab.id === state.tab;
      return `<button class="work-tab" type="button" role="tab" data-work-tab="${tab.id}" aria-selected="${active}" aria-controls="workPane-${tab.id}" id="workTab-${tab.id}" class="${active ? 'is-active' : ''}">
        <span class="work-tab-icon">${icon(tab.icon, 22)}</span>
        <span class="work-tab-label">${esc(tab.label)}</span>
        <span class="work-tab-count" aria-hidden="true">${num(counts[tab.id] || 0)}</span>
      </button>`;
    }).join('');
  }

  function setTab(tab, { focus = false } = {}) {
    if (!TABS.some(item => item.id === tab)) return;
    state.tab = tab;
    root.dataset.workActiveTab = tab;
    $$(root, '[data-work-pane]').forEach(pane => {
      const active = pane.dataset.workPane === tab;
      pane.toggleAttribute('hidden', !active);
    });
    renderTabs();
    renderPane();
    if (focus) $(host, `#workTab-${tab}`)?.focus?.();
    host.dispatchEvent(new CustomEvent('work-tab-change', { bubbles: true, detail: { tab } }));
  }

  function resetWizard() {
    state.step = 'category';
    state.category = '';
    state.featureId = '';
    state.className = '';
    state.subject = '';
    state.group = '';
    state.audience = 'class';
    state.students = [];
    state.showPreview = false;
    state.error = '';
  }

  function selectedFeature() {
    return featureById(state.featureId);
  }

  function plan() {
    return planWork({
      featureId: state.featureId,
      role: 'teacher',
      scope: { className: state.className, subject: state.subject, group: state.group },
      assignments: data().assignments
    });
  }

  /* ---------- নতুন কাজ: চার ধাপ ---------- */
  function renderWizard() {
    const pane = $(host, '#workNew');
    if (!pane) return;
    const scopes = assignmentScopes(data().assignments);
    const stepIndex = STEPS.indexOf(state.step);
    const head = `<div class="work-wizard-head">
      <ol class="work-steps" aria-label="কাজ তৈরির ধাপ">${STEPS.map((step, index) => `<li class="${index === stepIndex ? 'is-current' : index < stepIndex ? 'is-done' : ''}" data-work-step="${step}"><span>${num(index + 1)}</span>${stepLabel(step)}</li>`).join('')}</ol>
      ${state.step === 'category' ? '' : '<button class="work-link" type="button" data-work-reset>শুরু থেকে</button>'}
    </div>`;
    let body = '';
    if (state.step === 'category') body = renderCategoryStep();
    else if (state.step === 'feature') body = renderFeatureStep();
    else if (state.step === 'scope') body = renderScopeStep(scopes);
    else body = renderReviewStep();
    pane.innerHTML = `${head}<div class="work-wizard-body">${body}</div>`;
  }

  function stepLabel(step) {
    return ({ category: 'কাজের বিভাগ', feature: 'ফিচার', scope: 'শ্রেণি ও বিষয়', review: 'প্রিভিউ ও প্রকাশ' })[step] || step;
  }

  function renderCategoryStep() {
    const works = allWorks(data());
    return `<p class="work-lead">কোন ধরনের কাজ তৈরি করবেন? বিভাগ বেছে নিলে সেই বিভাগের Student Panel ফিচারগুলো দেখানো হবে।</p>
      <div class="work-category-grid" role="group" aria-label="কাজের বিভাগ">${WORK_CATEGORIES.map(category => {
        const total = featuresOf(category.id, { includeReadOnly: false }).length;
        return `<button class="work-category" type="button" data-work-category="${category.id}" ${total ? '' : 'disabled'}>
          <span class="work-category-icon">${icon(category.icon, 30)}</span>
          <strong>${esc(category.label)}</strong>
          <small>${esc(category.description)}</small>
          <span class="work-category-count">${num(total)}টি ফিচার</span>
        </button>`;
      }).join('')}</div>
      <p class="work-note">আপনার তৈরি কাজ এখন ${num(works.length)}টি — Draft, Pending ও Published সব এখান থেকেই দেখা যাবে।</p>`;
  }

  function renderFeatureStep() {
    const category = WORK_CATEGORIES.find(item => item.id === state.category);
    const features = featuresOf(state.category);
    return `<div class="work-feature-head"><button class="work-link" type="button" data-work-back>← বিভাগে ফিরুন</button><h3>${esc(category?.label || '')}</h3><p>${esc(category?.description || '')}</p></div>
      <div class="work-feature-list" role="group" aria-label="${esc(category?.label || '')} ফিচার">${features.map(feature => {
        const creatable = feature.permission.create;
        const gated = requiresApproval(feature.id);
        return `<button class="work-feature" type="button" data-work-feature="${feature.id}" ${creatable ? '' : 'aria-disabled="true"'}>
          <span class="work-feature-icon">${icon(feature.id === 'online-exam' ? 'exam-create' : feature.id === 'question-bank' ? 'question-bank' : feature.id === 'notice' ? 'notice' : feature.id === 'attendance' ? 'attendance' : feature.id === 'exam-marks' ? 'marks-entry' : 'assignment', 26)}</span>
          <span class="work-feature-copy"><strong>${esc(feature.name)}</strong><small>${esc(feature.description)}</small></span>
          <span class="work-feature-badges">${creatable ? '' : '<span class="work-badge">শুধু-পঠন</span>'}${gated ? '<span class="work-badge is-approval">অনুমোদন লাগবে</span>' : '<span class="work-badge is-direct">সরাসরি প্রকাশ</span>'}</span>
        </button>`;
      }).join('')}</div>`;
  }

  function renderScopeStep(scopes) {
    const feature = selectedFeature();
    if (!feature) return '';
    const needsClass = feature.classRequirement !== 'forbidden';
    const needsSubject = feature.subjectRequirement === 'required';
    const needsGroup = feature.groupRequirement !== 'forbidden';
    return `<div class="work-feature-head"><button class="work-link" type="button" data-work-back>← ফিচারে ফিরুন</button><h3>${esc(feature.name)}</h3><p>${esc(feature.description)}</p></div>
      <div class="work-scope-grid">
        ${needsClass ? `<label class="work-field"><span>শ্রেণি ${feature.classRequirement === 'required' ? '*' : ''}</span><select data-work-scope="className">${classNameOptions(scopes, state.className)}</select></label>` : ''}
        ${needsGroup ? `<label class="work-field"><span>বিভাগ / ব্যাচ ${feature.groupRequirement === 'required' ? '*' : ''}</span><select data-work-scope="group">${groupOptions(scopes, state.className, state.group)}</select></label>` : ''}
        ${needsSubject ? `<label class="work-field"><span>বিষয় *</span><select data-work-scope="subject">${subjectOptions(scopes, state.className, state.group, state.subject)}</select></label>` : ''}
        <label class="work-field"><span>কে পাবে</span><select data-work-scope="audience">
          <option value="class" ${state.audience === 'class' ? 'selected' : ''}>এই শ্রেণি/বিভাগের সব শিক্ষার্থী</option>
          <option value="students" ${state.audience === 'students' ? 'selected' : ''} ${feature.audience.includes('students') ? '' : 'disabled'}>নির্দিষ্ট শিক্ষার্থী</option>
        </select></label>
      </div>
      ${state.audience === 'students' ? renderStudentPicker(data()) : ''}
      <p class="work-note">শ্রেণি/বিষয় আপনার Manager-অ্যাসাইনমেন্ট থেকেই আসে — তালিকার বাইরে কিছু নির্বাচন করা যায় না।</p>
      <div class="work-wizard-actions"><button class="admin-btn primary" type="button" data-work-next>প্রিভিউ দেখুন</button></div>`;
  }

  function renderStudentPicker(source) {
    const students = (source.students || []).filter(student => !state.className || text(student.className) === text(state.className));
    if (!students.length) return '<p class="work-empty">এই শ্রেণিতে অনুমোদিত শিক্ষার্থী পাওয়া যায়নি।</p>';
    return `<fieldset class="work-students"><legend>নির্দিষ্ট শিক্ষার্থী (${num(students.length)} জন)</legend>${students.slice(0, 200).map(student => `<label><input type="checkbox" data-work-student="${esc(student.id)}" ${state.students.includes(text(student.id)) ? 'checked' : ''}><span>${esc(student.name || student.id)}</span></label>`).join('')}</fieldset>`;
  }

  function renderReviewStep() {
    const feature = selectedFeature();
    const result = plan();
    const preview = state.showPreview ? renderPreview(feature) : '';
    const scopeLine = [state.className || 'সব শ্রেণি', state.group || '', state.subject || ''].filter(Boolean).join(' • ');
    return `<div class="work-feature-head"><button class="work-link" type="button" data-work-back>← তথ্য বদলান</button><h3>প্রিভিউ: ${esc(feature?.name || '')}</h3><p>${esc(scopeLine)}</p></div>
      <dl class="work-summary">
        <div><dt>ফিচার</dt><dd>${esc(feature?.name || '')}</dd></div>
        <div><dt>শ্রেণি / বিষয়</dt><dd>${esc(scopeLine || '—')}</dd></div>
        <div><dt>কাদের জন্য</dt><dd>${state.audience === 'students' ? `${num(state.students.length)} জন নির্বাচিত শিক্ষার্থী` : 'শ্রেণি/বিভাগের সব শিক্ষার্থী'}</dd></div>
        <div><dt>Student Panel</dt><dd>${esc(feature?.student?.panel || '')} → ${esc(feature?.student?.label || '')}</dd></div>
        <div><dt>অনুমোদন নীতি</dt><dd>${result.approval === 'admin-manager' ? 'Admin/Manager অনুমোদনের পরে প্রকাশ' : 'শিক্ষক নিজেই প্রকাশ করতে পারেন'}</dd></div>
        <div><dt>ডেটা লেখা হবে</dt><dd><code>${esc(feature?.store?.repository || '')}</code></dd></div>
      </dl>
      ${result.blocked.length ? `<div class="work-alert" role="alert"><strong>এখনই সংরক্ষণ করা যাবে না</strong><ul>${result.blocked.map(reason => `<li>${esc(reason)}</li>`).join('')}</ul></div>` : ''}
      ${preview}
      <div class="work-wizard-actions">
        ${result.actions.filter(action => action.intent !== 'preview').map(action => `<button class="admin-btn ${action.tone === 'primary' ? 'primary' : 'ghost'}" type="button" data-work-open="${esc(action.intent)}" data-work-feature-id="${esc(feature?.id || '')}" ${result.ok ? '' : 'disabled'}>${esc(action.label)}</button>`).join('')}
        <button class="admin-btn ghost" type="button" data-work-preview aria-pressed="${state.showPreview}">${state.showPreview ? 'প্রিভিউ বন্ধ' : 'প্রিভিউ দেখুন'}</button>
      </div>
      <p class="work-note">সংরক্ষণ ${esc(feature?.form?.component || 'ফর্ম')}-এ হবে — এখানে কোনো দ্বিতীয় কপি তৈরি হয় না।</p>`;
  }

  function renderPreview(feature) {
    return `<article class="work-preview-card" aria-label="শিক্ষার্থী যা দেখবে">
      <span class="work-preview-tag">শিক্ষার্থীর দৃষ্টিতে</span>
      <h4>${esc(feature?.name || '')}</h4>
      <p>${esc(feature?.description || '')}</p>
      <small>${esc(state.className || 'সব শ্রেণি')}${state.subject ? ' • ' + esc(state.subject) : ''}${state.group ? ' • ' + esc(state.group) : ''}</small>
      <p class="work-note">প্রকৃত শিরোনাম, তারিখ ও নির্দেশনা ফর্মে পূরণ করার পর দেখা যাবে।</p>
    </article>`;
  }

  /* ---------- আমার প্রকাশিত কাজ ---------- */
  function renderPublished() {
    const pane = $(host, '#workPublished');
    if (!pane) return;
    const source = data();
    const works = allWorks(source);
    const pending = works.filter(item => item.status === 'pending').length;
    const published = works.filter(item => ['published', 'approved', 'completed'].includes(item.status)).length;
    const drafts = works.filter(item => ['draft', 'rejected'].includes(item.status)).length;
    const visible = filterByStatus(works, state.statusFilter);
    pane.innerHTML = `<div class="work-summary-row" aria-label="কাজের সারসংক্ষেপ">
        <div><strong>${num(published)}</strong><span>প্রকাশিত</span></div>
        <div><strong>${num(drafts)}</strong><span>খসড়া / ফেরত</span></div>
        <div><strong>${num(pending)}</strong><span>অনুমোদনের অপেক্ষায়</span></div>
      </div>
      <div class="work-filter-row" role="group" aria-label="অবস্থা অনুযায়ী ছাঁকনি">${WORK_STATUS_FILTERS.map(status => `<button class="day-tab ${state.statusFilter === status ? 'is-active' : ''}" type="button" data-work-status="${status}" aria-pressed="${state.statusFilter === status}">${status === 'all' ? 'সব' : esc(statusMeta(status).label)}</button>`).join('')}</div>
      ${source.error ? `<p class="work-alert" role="alert">${esc(source.error)}</p>` : ''}
      <div class="work-list">${visible.length ? visible.map(item => renderWorkCard(item)).join('') : `<p class="work-empty">${source.loading ? 'কাজের তথ্য আনা হচ্ছে…' : 'এই ছাঁকনিতে কোনো কাজ নেই।'}</p>`}</div>`;
  }

  function renderWorkCard(item) {
    const feature = featureById(item.featureId);
    return `<article class="work-card" data-work-item="${esc(item.kind)}:${esc(item.id)}">
      <div class="work-card-head"><span class="work-kind">${esc(feature?.name || item.featureId || 'কাজ')}</span><span class="teaching-status ${esc(item.statusTone)}">${esc(item.statusLabel)}</span></div>
      <h3>${esc(item.title)}</h3>
      <small>${esc(item.meta || '')}</small>
      <div class="work-card-actions">
        <button class="mini-btn" type="button" data-work-open-item="${esc(item.kind)}:${esc(item.id)}">${feature?.permission.edit ? 'খুলুন ও সম্পাদনা' : 'দেখুন'}</button>
        <span class="work-destination">${esc(feature?.student?.label || '')}</span>
      </div>
    </article>`;
  }

  /* ---------- শিক্ষার্থীদের কার্যক্রম ---------- */
  function renderActivity() {
    const pane = $(host, '#workActivity');
    if (!pane) return;
    const source = data();
    const activities = source.activities || [];
    const homework = activities.filter(row => row.type === 'homework' && row.status === 'published');
    const attendance = activities.filter(row => row.type === 'routine' && row.status === 'published');
    const exams = source.exams || [];
    const attempts = source.examAttempts || [];
    const submitted = attempts.filter(attempt => attempt.status === 'submitted');
    const homeworkRows = homework.flatMap(activity => Object.entries(activity.progress || {})
      .filter(([, entry]) => ['done', 'reviewed'].includes(entry?.value))
      .map(([studentId, entry]) => ({
        studentId,
        name: (source.students || []).find(student => String(student.id) === String(studentId))?.name || studentId,
        title: activity.title,
        value: entry.value,
        at: entry.updatedAt
      })))
      .sort((left, right) => String(right.at).localeCompare(String(left.at)));
    const attendanceCount = attendance.reduce((totals, activity) => {
      for (const entry of Object.values(activity.progress || {})) {
        if (['present', 'absent', 'late'].includes(entry?.value)) totals[entry.value] = (totals[entry.value] || 0) + 1;
        else if (entry?.value !== undefined) totals.recorded = (totals.recorded || 0) + 1;
      }
      return totals;
    }, {});
    pane.innerHTML = `<div class="work-summary-row" aria-label="শিক্ষার্থীদের কার্যক্রমের সারাংশ">
        <div><strong>${num(homeworkRows.length)}</strong><span>বাড়ির কাজ জমা</span></div>
        <div><strong>${num((attendanceCount.present || 0) + (attendanceCount.absent || 0) + (attendanceCount.late || 0))}</strong><span>উপস্থিতি নথিভুক্ত</span></div>
        <div><strong>${num(submitted.length)}</strong><span>পরীক্ষায় অংশগ্রহণ</span></div>
      </div>
      <section class="work-section"><h3>বাড়ির কাজের জমা</h3>${homeworkRows.length ? `<ul class="work-activity-list">${homeworkRows.slice(0, 30).map(row => `<li><div><strong>${esc(row.name)}</strong><small>${esc(row.title)}</small></div><span class="work-badge ${row.value === 'reviewed' ? 'is-direct' : ''}">${row.value === 'reviewed' ? 'দেখা হয়েছে' : 'জমা দিয়েছে'}</span></li>`).join('')}</ul>` : '<p class="work-empty">এখনো কোনো জমা পড়েনি। কাজ প্রকাশিত হলে শিক্ষার্থীরা জমা দিতে পারবে।</p>'}</section>
      <section class="work-section"><h3>উপস্থিতির সারাংশ</h3><p class="work-note">উপস্থিত ${num(attendanceCount.present || 0)} · অনুপস্থিত ${num(attendanceCount.absent || 0)} · দেরি ${num(attendanceCount.late || 0)}</p>${attendance.length ? `<ul class="work-activity-list">${attendance.slice(0, 12).map(activity => `<li><div><strong>${esc(activity.title)}</strong><small>${esc(activity.className || '')} • ${esc(activity.date || '')}</small></div><button class="mini-btn" type="button" data-work-open-item="activity:${esc(activity.id)}">বিস্তারিত</button></li>`).join('')}</ul>` : '<p class="work-empty">উপস্থিতির সেশন নেই। “নতুন কাজ → উপস্থিতি” থেকে শুরু করুন।</p>'}</section>
      <section class="work-section"><h3>পরীক্ষা</h3>${exams.length ? `<ul class="work-activity-list">${exams.slice(0, 12).map(exam => `<li><div><strong>${esc(exam.title)}</strong><small>${esc(exam.className || '')} • ${esc(exam.subject || '')}</small></div><span class="work-badge">${esc(statusMeta(exam.status).label)}</span></li>`).join('')}</ul>` : '<p class="work-empty">এখনো কোনো পরীক্ষা নেই।</p>'}</section>
      <section class="work-section"><h3>প্র্যাকটিস</h3><p class="work-note">প্র্যাকটিসের উত্তর শিক্ষার্থীর নিজের ডিভাইসে থাকে; এই প্যানেলে শুধু ফলাফল-সারাংশ দেখা যায়। ভাগ করা ডেটা মডেল ছাড়া জমা করা হয় না।</p></section>`;
  }

  function renderPane() {
    if (state.tab === 'new') renderWizard();
    else if (state.tab === 'published') renderPublished();
    else if (state.tab === 'activity') renderActivity();
    renderTabs();
  }

  function render() {
    host.innerHTML = `<div class="work-hero">
        <button class="work-start" type="button" data-work-start>
          <span class="work-start-icon">${icon('add', 30)}</span>
          <span class="work-start-copy"><strong>নতুন কাজ তৈরি করুন</strong><small>বিভাগ → ফিচার → শ্রেণি/বিষয় → প্রিভিউ → প্রকাশ</small></span>
        </button>
        <div class="work-hero-note"><span class="work-hero-chip">${num(teacherFeatures().length)} ধরনের কাজ</span><span class="work-hero-chip is-approval">পরীক্ষা: অনুমোদন লাগবে</span></div>
      </div>
      <div class="work-tabs" id="workTabs" role="tablist" aria-label="কাজ ব্যবস্থাপনা"></div>
      <div class="work-pane" id="workPane-new" data-work-pane="new" role="tabpanel" aria-labelledby="workTab-new" hidden></div>
      <div class="work-pane" id="workPane-published" data-work-pane="published" role="tabpanel" aria-labelledby="workTab-published" hidden></div>
      <div class="work-pane" id="workPane-activity" data-work-pane="activity" role="tabpanel" aria-labelledby="workTab-activity" hidden></div>
      <div class="work-wizard" id="workNew"></div>
      <div class="work-published" id="workPublished"></div>
      <div class="work-activity" id="workActivity"></div>`;
    /* The three inner hosts live inside their panes so a hidden tab has no
       focusable content at all. */
    $(host, '#workPane-new')?.append($(host, '#workNew'));
    $(host, '#workPane-published')?.append($(host, '#workPublished'));
    $(host, '#workPane-activity')?.append($(host, '#workActivity'));
    root.dataset.workActiveTab = state.tab;
    $$(root, '[data-work-pane]').forEach(pane => pane.toggleAttribute('hidden', pane.dataset.workPane !== state.tab));
    renderTabs();
    renderPane();
  }

  function update() {
    renderTabs();
    renderPane();
  }

  /* ---------- event contract ---------- */
  host.addEventListener('click', event => {
    const tab = event.target.closest('[data-work-tab]');
    if (tab) { setTab(tab.dataset.workTab, { focus: true }); return; }
    if (event.target.closest('[data-work-start]')) {
      resetWizard();
      setTab('new');
      state.step = 'category';
      renderWizard();
      return;
    }
    const category = event.target.closest('[data-work-category]');
    if (category) {
      state.category = category.dataset.workCategory;
      state.step = 'feature';
      state.featureId = '';
      renderWizard();
      $(host, '[data-work-feature]')?.focus?.();
      return;
    }
    if (event.target.closest('[data-work-back]')) {
      state.step = state.step === 'review' ? 'scope' : state.step === 'scope' ? 'feature' : 'category';
      state.showPreview = false;
      renderWizard();
      return;
    }
    if (event.target.closest('[data-work-reset]')) { resetWizard(); renderWizard(); return; }
    const feature = event.target.closest('[data-work-feature]');
    if (feature) {
      const chosen = featureById(feature.dataset.workFeature);
      if (!chosen) return;
      if (!chosen.permission.create) { toast?.('এই ফিচারটি Manager/Admin নিয়ন্ত্রণ করেন — শুধু দেখা যায়।'); return; }
      state.featureId = chosen.id;
      state.step = 'scope';
      const scopes = assignmentScopes(data().assignments);
      const first = scopes[0];
      if (!state.className && first) state.className = first.className;
      if (chosen.subjectRequirement === 'required' && !state.subject) state.subject = first?.subjects?.[0] || '';
      renderWizard();
      return;
    }
    if (event.target.closest('[data-work-next]')) {
      if (state.step === 'scope') {
        const result = plan();
        if (!result.ok) { toast?.(result.blocked[0] || 'তথ্য সম্পূর্ণ করুন।'); return; }
        state.step = 'review';
        state.showPreview = false;
        renderWizard();
      }
      return;
    }
    if (event.target.closest('[data-work-preview]')) {
      state.showPreview = !state.showPreview;
      renderWizard();
      return;
    }
    const open = event.target.closest('[data-work-open]');
    if (open) {
      const featureId = open.dataset.workFeatureId;
      if (!teacherCan(featureId, 'create')) { toast?.('এই কাজ তৈরির অনুমতি নেই।'); return; }
      const result = planWork({ featureId, role: 'teacher', scope: { className: state.className, subject: state.subject, group: state.group }, assignments: data().assignments });
      if (!result.ok) { toast?.(result.blocked[0] || 'তথ্য সম্পূর্ণ করুন।'); return; }
      onOpenFeature(featureId, {
        className: state.className, subject: state.subject, group: state.group,
        audience: state.audience, students: [...state.students]
      }, open.dataset.workOpen);
      return;
    }
    const status = event.target.closest('[data-work-status]');
    if (status) { state.statusFilter = status.dataset.workStatus; renderPublished(); return; }
    const item = event.target.closest('[data-work-open-item]');
    if (item) {
      const [kind, rawId] = String(item.dataset.workOpenItem).split(':');
      const id = rawId || '';
      onOpenItem({ kind, id });
    }
  });

  host.addEventListener('change', event => {
    const scope = event.target.closest('[data-work-scope]');
    if (scope) {
      const key = scope.dataset.workScope;
      state[key] = text(scope.value);
      if (key === 'className') { state.group = ''; state.subject = ''; state.students = []; }
      if (key === 'group') state.subject = '';
      renderWizard();
      return;
    }
    const student = event.target.closest('[data-work-student]');
    if (student) {
      const id = text(student.dataset.workStudent);
      state.students = student.checked
        ? [...new Set([...state.students, id])]
        : state.students.filter(value => value !== id);
    }
  });

  /* The classes pane lives in the panel's own markup (id teacherClassPane) so
     the existing class list keeps its single renderer. */
  render();
  setTab('classes');

  return {
    render,
    update,
    setTab,
    counts: () => tabCounts(),
    currentTab: () => state.tab,
    wizard: () => ({ ...state, students: [...state.students] }),
    openWizard: (featureId = '') => {
      resetWizard();
      setTab('new');
      if (featureId) {
        const feature = featureById(featureId);
        if (feature) {
          state.category = feature.category;
          state.featureId = feature.id;
          state.step = 'scope';
        }
      }
      renderWizard();
    },
    tabs: TABS.map(tab => tab.id)
  };
}

