/* One jsdom "phone". Runs the real app modules (built into .two-device-run/js
   by two-device-harness.mjs) against the mock cloud, and executes commands
   (JSON lines on stdin → JSON lines on stdout) driven by the test. */

import { loadPage } from './jsdom-harness.mjs';

const mod = spec => import(`./.two-device-run/js/${spec}`);

const ctx = await loadPage('index.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });

/* realtime-sync patches Storage.prototype.setItem — expose jsdom's Storage. */
if (!globalThis.Storage) {
  Object.defineProperty(globalThis, 'Storage', { value: ctx.window.Storage, configurable: true, writable: true });
}

const events = [];
const remoteStorageKeys = [];
ctx.window.addEventListener('storage', event => { if (event.apcRemote) remoteStorageKeys.push(event.key); });
ctx.window.addEventListener('apc-sync-updated', event => {
  events.push({ collection: event.detail?.collection, role: event.detail?.role, at: Date.now() });
});

const syncModule = await mod('realtime-sync.js');
const secureStore = await mod('secure-store.js');
const db = await mod('database.js');
const staffAuth = await mod('staff-auth.js');
const storageKeys = (await mod('config.js')).STORAGE_KEYS;

let loginBound = false;
let registerBound = false;
let registered = 0;
let studentAuthenticated = 0;
async function bindLogin() {
  if (loginBound) return;
  const login = await mod('login.js');
  loginBound = true;
  login.initLogin({
    state: { student: null, account: null },
    onAuthenticated: () => { studentAuthenticated += 1; }
  });
}

const readLocal = key => {
  const raw = ctx.window.localStorage.getItem(key);
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { return raw; }
};

/* Some records (the staff directory) sit in storage as an AES-GCM envelope;
   the snapshot reports their plaintext, like the app itself sees them. */
async function readPlain(key) {
  const value = readLocal(key);
  if (!secureStore.isEncryptedEnvelope(value)) return value;
  const plaintext = await secureStore.decryptValue(value);
  try { return JSON.parse(plaintext); } catch { return plaintext; }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitUntil(predicate, { timeout = 20000, every = 100 } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error('device wait timed out');
    await sleep(every);
  }
}

const staffDialogOpen = () => Boolean(ctx.$('.staff-pw-backdrop'));
const authMessage = () => (ctx.$('#authMessage')?.textContent || '').trim();
const navigated = () => ctx.jsdomErrors.some(error => /navigation/i.test(error));
const hasSession = key => ctx.window.localStorage.getItem(key) !== null;

/** Drive the real login form and wait for a terminal outcome. Each attempt
    starts from a signed-out device, like switching accounts on a phone. */
async function formLogin({ username, pin }) {
  await bindLogin();
  for (const account of Object.values(staffAuth.STAFF_ACCOUNTS)) {
    ctx.window.localStorage.removeItem(account.sessionKey);
  }
  ctx.window.localStorage.removeItem(storageKeys.session);
  const navigationsBefore = ctx.jsdomErrors.filter(error => /navigation/i.test(error)).length;
  if (ctx.$('#authMessage')) ctx.$('#authMessage').textContent = '';
  ctx.type(ctx.$('#loginMobile'), username);
  ctx.type(ctx.$('#loginPin'), pin);
  ctx.submit(ctx.$('#loginForm'));
  await waitUntil(() =>
    hasSession(staffAuth.STAFF_ACCOUNTS.admin.sessionKey) ||
    hasSession(staffAuth.STAFF_ACCOUNTS.teacher.sessionKey) ||
    hasSession(staffAuth.STAFF_ACCOUNTS.manager.sessionKey) ||
    hasSession(staffAuth.STAFF_ACCOUNTS.payment.sessionKey) ||
    hasSession(storageKeys.session) ||
    staffDialogOpen() ||
    Boolean(authMessage()), { timeout: 30000 });
  return {
    adminSession: hasSession(staffAuth.STAFF_ACCOUNTS.admin.sessionKey),
    teacherSession: hasSession(staffAuth.STAFF_ACCOUNTS.teacher.sessionKey),
    studentSession: hasSession(storageKeys.session),
    studentProfile: hasSession(storageKeys.student),
    dialog: staffDialogOpen(),
    message: authMessage(),
    navigated: ctx.jsdomErrors.filter(error => /navigation/i.test(error)).length > navigationsBefore
  };
}

const commands = {
  async boot() {
    globalThis.__apcTwoDeviceSignedIn = true;
    const result = await syncModule.startRealtimeSync();
    if (!result.ok) throw new Error('sync did not start: ' + result.reason);
    await bindLogin();
    return { ok: true };
  },

  async 'create-admin'({ fullName, mobile, password }) {
    const result = await staffAuth.createInitialAdmin({ fullName, mobile, password, confirmPassword: password });
    if (!result.ok) throw new Error(result.error || 'createInitialAdmin failed');
    return { username: result.account.username, bootstrapRoles: (result.bootstrapAccounts || []).map(a => a.role) };
  },

  async 'create-directory-staff'({ fullName, role, password }) {
    const directory = await mod('staff-directory.js');
    const result = await directory.createStaff({ fullName, role, password, confirmPassword: password });
    if (!result.ok) throw new Error(result.error || 'createStaff failed');
    return { username: result.staff.username, staffId: result.staff.staffId };
  },

  async 'write-records'({ key, value }) {
    ctx.window.localStorage.setItem(key, JSON.stringify(value));
    return { ok: true };
  },
  async 'wait-records'({ key, ids }) {
    await waitUntil(() => {
      const value = readLocal(key);
      const records = Array.isArray(value) ? value : value?.activities;
      return Array.isArray(records) && JSON.stringify(records.map(item => item.id).sort()) === JSON.stringify([...ids].sort());
    });
    return { ok: true, remoteEvent: remoteStorageKeys.includes(key) };
  },
  async 'watch-routine'() {
    const { initRoutine } = await mod('routine.js');
    initRoutine();
    return { ok: true };
  },
  async 'wait-routine-ui'({ text, count }) {
    const { loadRoutine } = await mod('office-data.js');
    await waitUntil(() => loadRoutine().sat.classes.length === count &&
      (count === 0 || ctx.$('#routineList').textContent.includes(text)));
    return { routine: loadRoutine(), rendered: ctx.$('#routineList').textContent };
  },
  async 'teaching-readable'({ studentId = 'STU-1', className = 'নবম শ্রেণি' } = {}) {
    const { teachingRepository } = await mod('teaching-data.js');
    ctx.window.localStorage.setItem(storageKeys.account, JSON.stringify({
      status: 'active', student: { id: studentId, name: 'দোলন আক্তার', className, group: '' }
    }));
    ctx.window.sessionStorage.setItem(storageKeys.session, '1');
    await teachingRepository.listForStudent(studentId);
    return { ok: true };
  },
  async 'network'({ online }) {
    Object.defineProperty(ctx.window.navigator, 'onLine', { value: online, configurable: true });
    ctx.window.dispatchEvent(new ctx.window.Event(online ? 'online' : 'offline'));
    return { ok: true };
  },
  async 'sync-status'() {
    return {
      state: ctx.document.documentElement.dataset.realtimeSync,
      message: ctx.document.documentElement.dataset.realtimeSyncMessage
    };
  },
  async 'write-students'({ students }) {
    if (!db.writeJSON(db.KEYS.students, students)) throw new Error('students write failed');
    return { ok: true };
  },

  /* Write the exam database straight into local storage — the shape an imported
     or hand-edited record has, without going through the exam editor. */
  async 'seed-exam-db'({ exams = [], attempts = [] }) {
    // The app's own reader demands version 1, otherwise the document is
    // treated as corrupt and nothing from this device may overwrite the cloud.
    if (!db.writeJSON(db.KEYS.exams, { version: 1, exams, attempts })) throw new Error('exam db write failed');
    return { ok: true };
  },
  async 'wait-sync-state'({ state }) {
    await waitUntil(() => ctx.document.documentElement.dataset.realtimeSync === state);
    return { state: ctx.document.documentElement.dataset.realtimeSync, message: ctx.document.documentElement.dataset.realtimeSyncMessage };
  },

  async 'set-cloud'({ paused = false, blocked = false }) {
    const response = await fetch(`${process.env.MOCK_CLOUD_URL}/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paused, blocked })
    });
    if (!response.ok) throw new Error('cloud control failed');
    return { paused, blocked };
  },

  /* Fill every required field of the real registration form and submit it. */
  async 'register-student'({ username, pin, mobile = '01711223344', nameBn = 'নতুন শিক্ষার্থী', nameEn = 'Test Student' }) {
    if (!registerBound) {
      const register = await mod('register.js');
      register.initRegister({
        state: { student: null, account: null },
        onRegistered: () => { registered += 1; }
      });
      registerBound = true;
    }
    const form = ctx.$('#registrationForm');
    const setValue = (field, value) => {
      field.value = value;
      field.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
      field.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
    };
    const specials = {
      mobile: mobile, username: username, pin: pin, pinConfirm: pin,
      nameBn: nameBn, nameEn: nameEn, fatherName: 'পিতা', motherName: 'মাতা',
      birthDate: '2012-01-01', guardianMobile: '01711223355',
      address: 'ঢাকা', studentMobile: mobile, securityAnswer: 'uttor', securityQuestion: 'প্রশ্ন'
    };
    for (const field of form.querySelectorAll('[required]')) {
      const name = field.name;
      if (field.type === 'checkbox') { field.checked = true; continue; }
      if (field.tagName === 'SELECT') {
        const option = [...field.options].find(item => item.value && !item.disabled);
        if (option) setValue(field, option.value ?? option.textContent);
        continue;
      }
      if (specials[name] !== undefined) { setValue(field, specials[name]); continue; }
      if (field.type === 'date') { setValue(field, '2012-01-01'); continue; }
      if (['tel', 'number'].includes(field.type)) { setValue(field, '01711223366'); continue; }
      setValue(field, field.type === 'password' ? pin : 'টেস্ট');
    }
    setValue(ctx.$('#studentMobile'), mobile);
    if (ctx.$('#authMessage')) ctx.$('#authMessage').textContent = '';
    ctx.submit(form);
    await waitUntil(() =>
      registered > 0 || hasSession(storageKeys.session) || Boolean(authMessage()) ||
      Boolean(readLocal(db.KEYS.account)), { timeout: 60000 });
    return {
      registered: registered > 0 || Boolean(readLocal(db.KEYS.account)),
      session: hasSession(storageKeys.session),
      message: authMessage(),
      account: readLocal(db.KEYS.account)
    };
  },

  /* The one-time first-use Admin form, exactly as the login page runs it.
     The institution's Admin Account lives in the cloud, so the option only
     appears after the login page verified that NO Admin exists anywhere: when
     the workflow is closed (an Admin exists, or the cloud could not be asked)
     this reports `blocked` instead of hanging on a form that never opens. */
  async 'create-first-admin'({ fullName = 'Test Admin', mobile = '01711223344', password = 'Admin-1234', timeout = 30000 }) {
    if (!loginBound) await bindLogin();
    const panelRemoved = () => !ctx.$('#firstAdminPanel');
    const panelOpen = () => Boolean(ctx.$('#firstAdminPanel') && !ctx.$('#firstAdminPanel').hidden);
    const blockedResult = extra => ({
      blocked: true, offered: false, adminSession: false,
      message: authMessage(), formError: ctx.$('#firstAdminError')?.textContent?.trim() || '',
      account: null, ...extra
    });
    // Wait for the startup gate to settle: open, removed, or explained.
    await waitUntil(() => panelRemoved() || panelOpen() || Boolean(authMessage()), { timeout });
    if (panelRemoved()) return blockedResult({ panel: 'removed' });
    if (!panelOpen()) return blockedResult({ panel: 'closed' });

    ctx.$('#openFirstAdmin').click();
    // The click re-asks the cloud; an Admin found now removes the form.
    await waitUntil(() => panelRemoved() || panelOpen(), { timeout: 15000 });
    if (panelRemoved()) return blockedResult({ panel: 'removed-on-open' });

    ctx.type(ctx.$('#firstAdminName'), fullName);
    ctx.type(ctx.$('#firstAdminMobile'), mobile);
    ctx.type(ctx.$('#firstAdminPassword'), password);
    ctx.type(ctx.$('#firstAdminConfirm'), password);
    ctx.submit(ctx.$('#firstAdminForm'));
    await waitUntil(() =>
      hasSession(staffAuth.STAFF_ACCOUNTS.admin.sessionKey) || Boolean(authMessage()) ||
      Boolean(ctx.$('#firstAdminError')?.textContent?.trim()), { timeout: 30000 });
    const account = await readPlain(staffAuth.STAFF_ACCOUNTS.admin.accountKey);
    return {
      blocked: !account,
      offered: true,
      adminSession: hasSession(staffAuth.STAFF_ACCOUNTS.admin.sessionKey),
      message: authMessage(),
      formError: ctx.$('#firstAdminError')?.textContent?.trim() || '',
      account
    };
  },

  /* What a brand-new device shows after its startup gate settles: the Login
     screen, or (only when the cloud truly has no Admin) the creation form.
     Never attempts to create anything. */
  async 'admin-screen'() {
    await bindLogin();
    const panel = () => ctx.$('#firstAdminPanel');
    await waitUntil(() => !panel() || panel().hidden === false || Boolean(authMessage()), { timeout: 20000 });
    return {
      offersCreation: Boolean(panel()),
      creationOpen: Boolean(panel() && panel().hidden === false),
      loginOpen: ctx.$('#loginPanel') ? !ctx.$('#loginPanel').hidden : false,
      message: authMessage(),
      syncState: ctx.document.documentElement.dataset.realtimeSync || '',
      syncMessage: ctx.document.documentElement.dataset.realtimeSyncMessage || ''
    };
  },

  /* A direct data-layer call, exactly like a console call or a script: the gate
     is in js/staff-auth.js, not only in the login page's form. */
  async 'try-create-admin'({ fullName = 'Direct Admin', mobile = '01711223344', password = 'Admin-1234' }) {
    const result = await staffAuth.createInitialAdmin({ fullName, mobile, password, confirmPassword: password });
    return {
      ok: result.ok, code: result.code || '', error: result.error || '',
      username: result.account?.username || '',
      account: await readPlain(staffAuth.STAFF_ACCOUNTS.admin.accountKey)
    };
  },
  /* Flip navigator.onLine without firing the browser's online/offline events:
     the SDK-style reconnect a listener never hears about. */
  async 'network-silent'({ online }) {
    Object.defineProperty(ctx.window.navigator, 'onLine', { value: online, configurable: true });
    return { ok: true };
  },
  async 'write-student-account'({ username, pin, fullName, mobile, updatedAt, studentId, className = '', group = '', extra = {} }) {
    const { hashPassword } = await mod('password-hash.js');
    const pinHash = await hashPassword(pin);
    const account = {
      username,
      status: 'active',
      studentId: studentId || undefined,
      registrationMobile: mobile,
      mobile,
      student: { username, fullName, ...(studentId ? { id: studentId } : {}), ...(className ? { className } : {}), ...(group ? { group } : {}) },
      pinHash,
      createdAt: new Date().toISOString(),
      updatedAt: updatedAt || new Date().toISOString(),
      /* A hand-edited or imported record can carry extra maps (the probe found
         result maps keyed by exam id). They travel to the cloud as they are. */
      ...extra
    };
    if (!db.writeJSON(db.KEYS.account, account)) throw new Error('student account write failed');
    return { ok: true };
  },

  async 'write-notice'(notice) {
    if (!notice || typeof notice !== 'object' || !notice.id) throw new Error('a notice object with an id is required');
    const notices = readLocal(db.KEYS.notices) || [];
    notices.push(notice);
    if (!db.writeJSON(db.KEYS.notices, notices)) throw new Error('notice write failed');
    return { ok: true };
  },

  /* Exam-database helpers: build documents with the REAL exam-data parser and
     scorer so they pass the app's strict stored-document validation, then
     write them through the storage bridge like the app itself does. */
  async 'seed-exam'({ examId, attemptId, studentId = 'STU-1', name = 'দোলন আক্তার', className = 'নবম শ্রেণি' }) {
    const examData = await mod('exam-data.js');
    const template = 'প্রশ্ন: ২ + ২ = কত?\nA: ৩\nB: ৪\nC: ৫\nD: ৬\nউত্তর: B';
    const now = Date.now();
    const fields = examData.validateExam({
      title: 'সিঙ্ক পরীক্ষা',
      subject: 'গণিত',
      className,
      type: 'mcq',
      startAt: now - 3600000,
      endAt: now + 3600000,
      lateMinutes: 5,
      negative: 0,
      passPercent: 33,
      instructions: '',
      template
    });
    const exam = {
      id: examId,
      status: 'published',
      teacherId: 'T-SYNC',
      participants: [{ id: studentId, name, className }],
      ...fields
    };
    const attempt = {
      id: attemptId,
      examId,
      studentId,
      name,
      className,
      number: 1,
      status: 'active',
      startedAt: now,
      answers: {},
      order: fields.questions.map(question => ({ id: question.id, options: ['A', 'B', 'C', 'D'] }))
    };
    if (!db.writeJSON(db.KEYS.exams, { version: 1, exams: [exam], attempts: [attempt] })) {
      throw new Error('exam db write failed');
    }
    return { ok: true, questionId: fields.questions[0].id };
  },

  async 'submit-exam-attempt'({ attemptId, answer }) {
    const examData = await mod('exam-data.js');
    const doc = readLocal(db.KEYS.exams);
    if (!doc) throw new Error('no exam document on this device');
    const attempt = doc.attempts.find(item => item.id === attemptId);
    const exam = attempt && doc.exams.find(item => item.id === attempt.examId);
    if (!exam) throw new Error('attempt or exam missing');
    const questionId = exam.questions[0].id;
    attempt.answers[questionId] = answer;
    attempt.status = 'submitted';
    attempt.finishedAt = Date.now();
    Object.assign(attempt, examData.scoreAttempt(exam, attempt));
    if (!db.writeJSON(db.KEYS.exams, doc)) throw new Error('exam db write failed');
    return { ok: true, score: attempt.score };
  },

  async 'delete-exam'({ examId }) {
    const doc = readLocal(db.KEYS.exams);
    if (!doc) throw new Error('no exam document on this device');
    doc.exams = doc.exams.filter(item => item.id !== examId);
    doc.attempts = doc.attempts.filter(item => item.examId !== examId);
    if (!db.writeJSON(db.KEYS.exams, doc)) throw new Error('exam db write failed');
    return { ok: true };
  },

  async 'wait-attempt-status'({ attemptId, status }) {
    await waitUntil(() => {
      const doc = readLocal(db.KEYS.exams);
      const attempt = doc && Array.isArray(doc.attempts) ? doc.attempts.find(item => item.id === attemptId) : null;
      return Boolean(attempt && attempt.status === status);
    });
    return { ok: true };
  },

  async 'wait-exam-absent'({ examId }) {
    await waitUntil(() => {
      const doc = readLocal(db.KEYS.exams);
      if (!doc) return true;
      const examGone = !Array.isArray(doc.exams) || !doc.exams.some(item => item.id === examId);
      const attemptsGone = !Array.isArray(doc.attempts) || !doc.attempts.some(item => item.examId === examId);
      return examGone && attemptsGone;
    });
    return { ok: true };
  },

  /* Proves the merged document passes the app's own strict reader —
     syncStudent runs the full stored-document validation internally. */
  async 'validate-exam-db'() {
    const { examRepository } = await mod('exam-data.js');
    /* This assertion exercises a Student repository read after the separate
       login flow has already been verified; give the fixture its approved
       roster identity rather than trusting a caller-supplied student object. */
    ctx.window.localStorage.setItem(storageKeys.account, JSON.stringify({
      status: 'active', student: { id: 'STU-1', name: 'দোলন আক্তার', className: 'নবম শ্রেণি', group: '' }
    }));
    ctx.window.sessionStorage.setItem(storageKeys.session, '1');
    try {
      await examRepository.syncStudent('STU-1');
      return { ok: true };
    } catch (error) {
      throw new Error('exam document failed app validation: ' + error.message);
    }
  },

  async 'wait-keys'({ keys, missing = false }) {
    await waitUntil(() => keys.every(key => (ctx.window.localStorage.getItem(key) !== null) !== missing));
    return { ok: true };
  },

  async 'wait-content'({ key, id }) {
    await waitUntil(() => {
      const value = readLocal(key);
      if (Array.isArray(value)) return value.some(item => item && item.id === id);
      if (value && typeof value === 'object') return id in value;
      return false;
    });
    return { ok: true };
  },

  async 'wait-status'({ state }) {
    await waitUntil(() =>
      ctx.document.documentElement.dataset.realtimeSync === state &&
      Boolean(ctx.document.documentElement.dataset.realtimeSyncMessage), { timeout: 20000 });
    return { ok: true };
  },

  async 'form-login'(args) {
    return formLogin(args);
  },

  async 'change-dialog-password'({ next }) {
    ctx.$('#staffPwNew').value = next;
    ctx.$('#staffPwConfirm').value = next;
    ctx.submit(ctx.$('.staff-pw-form'));
    await waitUntil(() =>
      hasSession(staffAuth.STAFF_ACCOUNTS.teacher.sessionKey) ||
      hasSession(staffAuth.STAFF_ACCOUNTS.admin.sessionKey) ||
      Boolean(authMessage()), { timeout: 30000 });
    return {
      teacherSession: hasSession(staffAuth.STAFF_ACCOUNTS.teacher.sessionKey),
      message: authMessage(),
      navigated: navigated()
    };
  },

  /* What an Admin/Manager bell would list for new registrations, from this
     device's synced roster (js/notification-rules.js, as shipped). */
  async 'registration-feed'({ role = 'admin' } = {}) {
    const rules = await mod('notification-rules.js');
    const office = await mod('office-data.js');
    const items = rules.registrationItems(office.loadRoster(), { kind: 'staff', role, username: role });
    return { keys: items.map(item => item.key) };
  },

  /* The shared Admin/Manager decision path (js/registration-review.js). */
  async 'decide-registration'({ studentId, decision, role = 'admin', note = '' }) {
    const review = await mod('registration-review.js');
    return review.decideRegistration(studentId, decision, { role, note });
  },

  /* Any person's notification list from THIS device's synced data, built by
     the shipped rules (js/notification-rules.js) — the same inputs the engine
     reads: roster, ledger, exam database. */
  async 'notification-feed'({ role = '', studentId = '', now = Date.now() } = {}) {
    const rules = await mod('notification-rules.js');
    const office = await mod('office-data.js');
    const database = await mod('database.js');
    const viewer = studentId ? { kind: 'student', studentId, username: 'student' } : { kind: 'staff', role, username: role };
    const items = rules.notificationFeed({
      viewer, now,
      students: office.loadRoster(),
      transactions: database.listDocuments('transactions'),
      examDb: readLocal(db.KEYS.exams)
    });
    return { items: items.map(item => ({ key: item.key, kind: item.kind, title: item.title, body: item.body })) };
  },

  async 'wait-record-status'({ key, id, status }) {
    await waitUntil(() => {
      const list = readLocal(key);
      return Array.isArray(list) && list.some(item => item?.id === id && item.status === status);
    }, { timeout: 20000 });
    return { ok: true };
  },

  async 'wait-exam-status'({ examId, status }) {
    await waitUntil(() => {
      const value = readLocal(db.KEYS.exams);
      return Array.isArray(value?.exams) && value.exams.some(exam => exam?.id === examId && exam.status === status);
    }, { timeout: 20000 });
    return { ok: true };
  },

  async 'wait-roster-status'({ studentId, status }) {
    await waitUntil(() => {
      const list = readLocal(db.KEYS.students);
      return Array.isArray(list) && list.some(item => item?.id === studentId && item.status === status);
    }, { timeout: 20000 });
    return { ok: true };
  },

  async snapshot({ keys }) {
    const out = {};
    for (const key of keys) out[key] = await readPlain(key);
    return { values: out, events: events.length, eventCollections: [...new Set(events.map(e => e.collection))] };
  },

  /* Run the real student app entry (js/main.js) exactly like index.html does,
     so page-level paths (the pending lock, the storage handler that flips the
     account after an approval) are live. Used by the approval-login test. */
  async 'start-app'() {
    globalThis.__apcTwoDeviceSignedIn = true;
    await mod('main.js');
    // main.js bound the real form handlers; do not bind a second copy.
    loginBound = true;
    registerBound = true;
    await new Promise(resolve => setTimeout(resolve, 50));
    return {
      ok: true,
      appHidden: ctx.$('#appShell')?.hidden,
      authHidden: ctx.$('#authScreen')?.hidden,
      pending: ctx.$('#appShell')?.classList.contains('is-pending')
    };
  },
  async 'app-state'() {
    return {
      accountStatus: readLocal(db.KEYS.account)?.status || null,
      pending: ctx.$('#appShell')?.classList.contains('is-pending') || false,
      appHidden: ctx.$('#appShell')?.hidden ?? null,
      authHidden: ctx.$('#authScreen')?.hidden ?? null,
      message: authMessage()
    };
  },
  /* Drive the login form through the REAL handler bound by main.js. */
  async 'submit-login'({ username, pin }) {
    if (ctx.$('#authMessage')) ctx.$('#authMessage').textContent = '';
    ctx.type(ctx.$('#loginMobile'), username);
    ctx.type(ctx.$('#loginPin'), pin);
    ctx.submit(ctx.$('#loginForm'));
    await waitUntil(() => hasSession(storageKeys.session) || Boolean(authMessage()), { timeout: 30000 });
    return {
      studentSession: hasSession(storageKeys.session),
      message: authMessage(),
      accountStatus: readLocal(db.KEYS.account)?.status || null
    };
  },
  async 'wait-app-open'() {
    await waitUntil(() => ctx.$('#appShell')?.hidden === false, { timeout: 30000 });
    return {
      pending: ctx.$('#appShell')?.classList.contains('is-pending') || false,
      accountStatus: readLocal(db.KEYS.account)?.status || null
    };
  },
  async 'wait-account-status'({ status }) {
    await waitUntil(() => readLocal(db.KEYS.account)?.status === status, { timeout: 30000 });
    return { accountStatus: readLocal(db.KEYS.account)?.status || null };
  },

  async quit() {
    process.exit(0);
  }
};

process.stdin.setEncoding('utf8');
let buffered = '';
process.stdin.on('data', chunk => {
  buffered += chunk;
  let newline;
  while ((newline = buffered.indexOf('\n')) >= 0) {
    const line = buffered.slice(0, newline).trim();
    buffered = buffered.slice(newline + 1);
    if (!line) continue;
    let request;
    try { request = JSON.parse(line); } catch { continue; }
    const handler = commands[request.cmd];
    Promise.resolve()
      .then(() => handler ? handler(request.args || {}) : Promise.reject(new Error('unknown command ' + request.cmd)))
      .then(
        result => process.stdout.write(JSON.stringify({ id: request.id, cmd: request.cmd, result }) + '\n'),
        error => process.stdout.write(JSON.stringify({ id: request.id, cmd: request.cmd, error: String(error && error.message || error) }) + '\n')
      );
  }
});
