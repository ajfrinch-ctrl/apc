/* V2 staged-cutover console for the Admin panel.
 *
 * Two server callables, one screen:
 *   • adminProvisionV2Identities — link legacy username-keyed Teacher
 *     assignments to secure teacherId claims (dry-run → verify → apply).
 *   • adminMigrateStudentToV2 — re-key legacy roster rows under the matching
 *     student account's uid (proposals by mobile → validate → apply).
 *
 * Every step is an explicit Admin action; nothing auto-links. The `call`
 * dependency is injected so the flow is testable without Firebase. */

const el = (tag, className = '', textContent = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent) node.textContent = textContent;
  return node;
};

async function defaultCall(name, data) {
  const { callCloudFunction } = await import('../sync/cloud-auth.js');
  return callCloudFunction(name, data);
}

const reasonLabels = {
  'teacher-identity-not-found': 'ইউজারনেমের যাচাইযোগ্য অ্যাকাউন্ট নেই',
  'username-mismatch': 'ইউজারনেম পরিচয়ের সঙ্গে মিলছে না',
  'teacher-not-active': 'অ্যাকাউন্ট সক্রিয় নয়',
  'teacher-auth-disabled': 'অ্যাকাউন্ট ডিজেবল করা',
  'unsafe-assignment-id': 'অনিরাপদ অ্যাসাইনমেন্ট আইডি',
  'duplicate-assignment-id': 'একই অ্যাসাইনমেন্ট আইডি একাধিকবার',
  'missing-teacher-username': 'টিচার ইউজারনেম নেই',
  'unsafe-teacher-uid': 'অনিরাপদ ইউআইডি',
  'invalid-record': 'রেকর্ড সঠিক নয়',
  'missing-class': 'শ্রেণি নেই',
  'missing-subjects': 'বিষয় নেই'
};

/* Raw SDK codes are meaningless to an operator — the first run happens BEFORE
   the callables are deployed, so map the common ones to actionable hints. */
const errorLabels = {
  'functions/not-found': 'ফাংশনটি এখনো ডিপ্লয় হয়নি — আগে `cd functions && npm run deploy`',
  'not-found': 'ফাংশনটি এখনো ডিপ্লয় হয়নি — আগে `cd functions && npm run deploy`',
  'functions/unauthenticated': 'ক্লাউড সেশন নেই — আগে লগইন করুন',
  'functions/permission-denied': 'এই কলেবল শুধু অ্যাডমিন ক্যাপাবিলিটির জন্য',
  'functions/unavailable': 'নেটওয়ার্ক বা ক্লাউড এন্ডপয়েন্ট পাওয়া যাচ্ছে না',
  'functions/deadline-exceeded': 'ক্লাউড সাড়া দেয়নি — আবার চেষ্টা করুন',
  'functions/internal': 'সার্ভারে অপ্রত্যাশিত ত্রুটি — লগ দেখুন'
};
const errorText = error => errorLabels[String(error?.code || '')] || error?.message || error?.code || 'অজানা ত্রুটি';

export function mountV2Migration({ mount, call = defaultCall, onToast = () => {} } = {}) {
  const root = typeof mount === 'string' ? document.querySelector(mount) : mount;
  if (!root) return { ok: false, reason: 'mount-missing' };
  root.replaceChildren();

  const say = (text, isError = false) => onToast(text, isError);
  const statusLine = (container, text, isError = false) => {
    const line = el('p', `finance-hint${isError ? ' v2-migration-error' : ''}`);
    line.setAttribute('role', 'status');
    line.textContent = text;
    container.replaceChildren(line);
  };

  /* ---------------- Teacher retro-link ---------------- */
  const teacherCard = el('section', 'admin-card v2-migration-card');
  teacherCard.append(el('h2', 'admin-card-title', 'শিক্ষক লিংক (টিচার লিংক)'));
  teacherCard.append(el('p', 'finance-hint',
    'পুরনো ইউজারনেম-ভিত্তিক অ্যাসাইনমেন্টকে সুরক্ষিত ক্লেমের সঙ্গে যুক্ত করে। আগে ড্রাই-রান দেখুন, তারপর একজন করে যাচাই করে প্রয়োগ করুন।'));
  const teacherStatus = el('div', 'v2-migration-status');
  const teacherResult = el('div', 'v2-migration-result');

  const previewButton = el('button', 'apc-btn', 'ড্রাই-রান তালিকা দেখুন');
  previewButton.type = 'button';
  previewButton.addEventListener('click', async () => {
    previewButton.disabled = true;
    statusLine(teacherStatus, 'লেগাসি অ্যাসাইনমেন্ট পড়া হচ্ছে…');
    try {
      const result = await call('adminProvisionV2Identities', {});
      teacherResult.replaceChildren();
      if (!result?.preview) { statusLine(teacherStatus, 'প্রিভিউ পাওয়া যায়নি।', true); return; }
      const list = el('ul', 'v2-migration-list');
      for (const username of result.usernames || []) list.append(el('li', '', String(username)));
      teacherResult.append(
        el('p', 'finance-hint', `মোট রো: ${result.totalRows ?? 0} · ইউজারনেম: ${(result.usernames || []).length}টি`),
        list
      );
      statusLine(teacherStatus, 'ড্রাই-রান সম্পন্ন — কিছু লেখা হয়নি।');
    } catch (error) {
      statusLine(teacherStatus, `পড়া যায়নি: ${errorText(error)}`, true);
    } finally { previewButton.disabled = false; }
  });

  const usernameInput = el('input', 'apc-input');
  usernameInput.type = 'text';
  usernameInput.placeholder = 'টিচার ইউজারনেম';
  usernameInput.autocomplete = 'off';

  let verifiedUsername = '';
  const verifyButton = el('button', 'apc-btn', 'যাচাই করুন');
  verifyButton.type = 'button';
  verifyButton.addEventListener('click', async () => {
    const username = usernameInput.value.trim().toLowerCase();
    if (!username) { say('আগে ইউজারনেম লিখুন।', true); return; }
    verifyButton.disabled = true;
    applyButton.disabled = true;
    verifiedUsername = '';
    statusLine(teacherStatus, 'পরিচয় যাচাই হচ্ছে…');
    try {
      const result = await call('adminProvisionV2Identities', { username });
      teacherResult.replaceChildren();
      verifiedUsername = String(result?.username || '');
      const claims = result?.linkedClaims || {};
      teacherResult.append(
        el('p', 'finance-hint', `ক্লেম: ${claims.role || '?'} · ${claims.status || '?'} · teacherId=${claims.teacherId || '?'}`),
        el('p', 'finance-hint', `মাইগ্রেট হবে: ${(result?.assignments || []).length}টি অ্যাসাইনমেন্ট`)
      );
      const unresolved = result?.unresolved || [];
      if (unresolved.length) {
        const list = el('ul', 'v2-migration-list v2-migration-unresolved');
        for (const item of unresolved) {
          list.append(el('li', '', `${item.id || '?'} — ${reasonLabels[item.reason] || item.reason}`));
        }
        teacherResult.append(el('p', 'finance-hint', 'অমীমাংসিত রো (মাইগ্রেট হবে না):'), list);
      }
      applyButton.disabled = !(result?.assignments || []).length;
      statusLine(teacherStatus, 'যাচাই সম্পন্ন — প্রয়োগে ক্লিক করলে অ্যাসাইনমেন্ট ও ক্লেম লেখা হবে।');
    } catch (error) {
      statusLine(teacherStatus, `যাচাই ব্যর্থ: ${errorText(error)}`, true);
    } finally { verifyButton.disabled = false; }
  });

  const applyButton = el('button', 'apc-btn apc-btn-primary', 'অ্যাসাইনমেন্টসহ প্রয়োগ করুন');
  applyButton.type = 'button';
  applyButton.disabled = true;
  applyButton.addEventListener('click', async () => {
    if (!verifiedUsername) return;
    applyButton.disabled = true;
    statusLine(teacherStatus, 'প্রয়োগ হচ্ছে…');
    try {
      const result = await call('adminProvisionV2Identities', { username: verifiedUsername, applyAssignments: true });
      statusLine(teacherStatus, `প্রয়োগ সম্পন্ন — ${(result?.assignments || []).length}টি অ্যাসাইনমেন্ট, অমীমাংসিত ${(result?.unresolved || []).length}টি।`);
      verifiedUsername = '';
    } catch (error) {
      applyButton.disabled = false;
      statusLine(teacherStatus, `প্রয়োগ ব্যর্থ: ${errorText(error)}`, true);
    }
  });

  const teacherForm = el('div', 'v2-migration-form');
  teacherForm.append(usernameInput, verifyButton, applyButton);
  teacherCard.append(previewButton, teacherForm, teacherStatus, teacherResult);

  /* ---------------- Student roster migration ---------------- */
  const studentCard = el('section', 'admin-card v2-migration-card');
  studentCard.append(el('h2', 'admin-card-title', 'শিক্ষার্থী রোস্টার মাইগ্রেশন'));
  studentCard.append(el('p', 'finance-hint',
    'ভুল ম্যাচ মানে অন্য শিক্ষার্থীর ডেটা — তাই মোবাইল দিয়ে শুধু প্রস্তাব দেখানো হয়, প্রতিটি ম্যাচ আপনার নিশ্চিতকরণে প্রয়োগ হয়।'));
  const studentStatus = el('div', 'v2-migration-status');
  const studentResult = el('div', 'v2-migration-result');

  let proposals = [];
  let selection = null;
  let validated = null;

  const renderProposals = () => {
    studentResult.replaceChildren();
    if (!proposals.length) {
      studentResult.append(el('p', 'finance-hint', 'কোনো লেগাসি রোস্টার রো পাওয়া যায়নি।'));
      return;
    }
    const table = el('table', 'v2-migration-table');
    const head = el('tr');
    for (const label of ['রেকর্ড', 'নাম', 'শ্রেণি', 'প্রার্থী অ্যাকাউন্ট', '']) head.append(el('th', '', label));
    table.append(head);
    proposals.forEach((proposal, index) => {
      const row = el('tr');
      row.append(
        el('td', '', String(proposal.studentId || '')),
        el('td', '', String(proposal.name || '')),
        el('td', '', `${proposal.className || ''}${proposal.group ? ` (${proposal.group})` : ''}`)
      );
      const candidateCell = el('td');
      const select = el('select', 'apc-input v2-migration-select');
      const placeholder = el('option', '', '— বাছুন —');
      placeholder.value = ''; // an empty value, never the label text
      select.append(placeholder);
      for (const candidate of proposal.candidates || []) {
        const option = el('option', '', `${candidate.username || candidate.uid} (${candidate.status || '?'})`);
        option.value = candidate.uid;
        select.append(option);
      }
      if (!(proposal.candidates || []).length) select.disabled = true;
      select.addEventListener('change', () => {
        const uid = select.value;
        selection = uid ? { studentId: proposal.studentId, uid } : null;
        validated = null;
        validateButton.disabled = !selection;
        applyStudentButton.disabled = true;
      });
      candidateCell.append(select);
      row.append(candidateCell, el('td', '', String(proposal.mobile || '')));
      table.append(row);
      void index;
    });
    studentResult.append(table);
  };

  const previewStudentsButton = el('button', 'apc-btn', 'প্রস্তাব দেখুন');
  previewStudentsButton.type = 'button';
  previewStudentsButton.addEventListener('click', async () => {
    previewStudentsButton.disabled = true;
    statusLine(studentStatus, 'প্রস্তাব তৈরি হচ্ছে…');
    try {
      const result = await call('adminMigrateStudentToV2', { preview: true });
      proposals = result?.proposals || [];
      selection = null;
      validated = null;
      validateButton.disabled = true;
      applyStudentButton.disabled = true;
      renderProposals();
      statusLine(studentStatus, `${proposals.length}টি রো — প্রতিটির জন্য প্রার্থী অ্যাকাউন্ট বেছে নিন।`);
    } catch (error) {
      statusLine(studentStatus, `প্রস্তাব পড়া যায়নি: ${errorText(error)}`, true);
    } finally { previewStudentsButton.disabled = false; }
  });

  const validateButton = el('button', 'apc-btn', 'ভ্যালিডেট করুন');
  validateButton.type = 'button';
  validateButton.disabled = true;
  validateButton.addEventListener('click', async () => {
    if (!selection) return;
    validateButton.disabled = true;
    statusLine(studentStatus, 'ভ্যালিডেট হচ্ছে…');
    try {
      const result = await call('adminMigrateStudentToV2', { studentId: selection.studentId, uid: selection.uid });
      validated = result?.proposed || null;
      studentStatus.replaceChildren();
      if (!validated) { statusLine(studentStatus, 'প্রস্তাবিত রো পাওয়া যায়নি।', true); return; }
      statusLine(studentStatus, `প্রস্তাব: ${validated.name || validated.id} → ${validated.className} (${validated.group || 'কোনো গ্রুপ নেই'}) · স্ট্যাটাস ${validated.status}`);
      applyStudentButton.disabled = false;
    } catch (error) {
      statusLine(studentStatus, `ভ্যালিডেট ব্যর্থ: ${errorText(error)}`, true);
    } finally { validateButton.disabled = !selection; }
  });

  const applyStudentButton = el('button', 'apc-btn apc-btn-primary', 'প্রয়োগ করুন');
  applyStudentButton.type = 'button';
  applyStudentButton.disabled = true;
  applyStudentButton.addEventListener('click', async () => {
    if (!selection || !validated) return;
    applyStudentButton.disabled = true;
    statusLine(studentStatus, 'প্রয়োগ হচ্ছে…');
    try {
      await call('adminMigrateStudentToV2', { studentId: selection.studentId, uid: selection.uid, apply: true });
      statusLine(studentStatus, 'মাইগ্রেশন সম্পন্ন — রোস্টার রো ও ক্লেম লেখা হয়েছে।');
      selection = null;
      validated = null;
      validateButton.disabled = true;
    } catch (error) {
      applyStudentButton.disabled = false;
      statusLine(studentStatus, `প্রয়োগ ব্যর্থ: ${errorText(error)}`, true);
    }
  });

  const studentForm = el('div', 'v2-migration-form');
  studentForm.append(validateButton, applyStudentButton);
  studentCard.append(previewStudentsButton, studentResult, studentForm, studentStatus);

  root.append(teacherCard, studentCard);
  return { ok: true };
}
