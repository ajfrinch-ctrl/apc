import { LEGACY_CLOUD_ENABLED } from '../sync/cloud-access.js';
import { $, normalizeMobile, normalizeAnswer, setAuthMessage, showFeedback } from './ui.js';
import { registrationPasswordError } from './password-policy.js';
import {
  contactNumber,
  isContactNumber,
  mobileError,
  normalizeUsername,
  usernameError,
  normalizeEmail,
  emailError
} from './account-policy.js';
import {
  persistAccount,
  saveStudent,
  generateClassRoll,
  usernameTaken,
  reserveUsername,
  releaseUsername,
  mobileTaken,
  reserveMobile,
  releaseMobile,
  emailTaken,
  reserveEmail,
  releaseEmail,
  loadAccount,
  listLocalAccounts
} from './storage.js';
import {
  accountToRosterStudent,
  upsertStudentRosterRow,
  syncAccountStatus,
  saveRoster
} from './office-data.js';
import { KEYS, listDocuments, readJSON, writeJSON } from './database.js';
import { switchAuthTab } from './login.js';

export function listRegistrationNotifications() {
  const raw = readJSON(KEYS.registrationNotifications, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(item => item && typeof item === 'object' && item.type === 'new_registration' && item.studentId)
    .map(item => ({ ...item }));
}

export function saveRegistrationNotifications(items) {
  const clean = Array.isArray(items)
    ? items.filter(item => item && typeof item === 'object' && item.id && item.studentId)
    : [];
  return writeJSON(KEYS.registrationNotifications, clean);
}

export function createRegistrationNotificationRecord({ id, studentId, studentName, mobile, createdAt }) {
  const sid = String(studentId || '').trim();
  if (!sid) return null;
  const record = {
    id: String(id || `reg-${sid}`),
    type: 'new_registration',
    studentId: sid,
    studentName: String(studentName || 'নাম দেওয়া হয়নি').trim(),
    mobile: String(mobile || '').trim(),
    createdAt: typeof createdAt === 'string' && createdAt ? createdAt : new Date().toISOString(),
    read: false
  };
  const existing = listRegistrationNotifications().filter(
    item => item.id !== record.id && item.studentId !== sid
  );
  saveRegistrationNotifications([record, ...existing]);
  return record;
}

export function markRegistrationNotificationRead(studentId, meta = {}) {
  const sid = String(studentId || '').trim();
  if (!sid) return null;
  const current = listRegistrationNotifications();
  let updatedRecord = null;
  const next = current.map(item => {
    if (item.studentId !== sid && item.id !== `reg-${sid}`) return item;
    updatedRecord = {
      ...item,
      read: true,
      readAt: meta.readAt || new Date().toISOString(),
      ...(meta.readBy ? { readBy: String(meta.readBy) } : {}),
      ...(meta.decision ? { decision: String(meta.decision) } : {})
    };
    return updatedRecord;
  });
  if (updatedRecord) saveRegistrationNotifications(next);
  return updatedRecord;
}

export const DUPLICATE_MOBILE_MESSAGE = 'এই মোবাইল নম্বর দিয়ে আগেই রেজিস্ট্রেশন হয়েছে।';
export const DUPLICATE_USERNAME_MESSAGE = 'এই ইউজারনেমটি আগেই নেওয়া হয়েছে। অন্য একটি বেছে নিন — এটি পরে বদলানো যাবে না।';
export const DUPLICATE_EMAIL_MESSAGE = 'এই ইমেইল ঠিকানা দিয়ে আগেই রেজিস্ট্রেশন হয়েছে।';

let registrationMutex = Promise.resolve();
function withRegistrationLock(task) {
  const run = registrationMutex.then(task, task);
  registrationMutex = run.then(() => undefined, () => undefined);
  return run;
}

async function checkUsernameOnline(username) {
  if (!LEGACY_CLOUD_ENABLED || !navigator.onLine) return null;
  const budget = 4000;
  let timer;
  const bounded = promise => Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('lookup timed out')), budget); })
  ]).finally(() => clearTimeout(timer));
  try {
    const bridge = await bounded(import('../sync/sync-core.js?v=474'));
    return await bounded(bridge.SyncService.usernameTakenOnline(username));
  } catch (error) {
    console.warn('[Active Plus] cloud login-id check unavailable:', error.message);
    return null;
  }
}

async function registerOnlineWithBudget(payload) {
  if (!LEGACY_CLOUD_ENABLED || !navigator.onLine) {
    return { ok: false, reason: 'network-unavailable', offline: true };
  }
  const budget = 15000;
  let timer;
  try {
    const bridge = await Promise.race([
      import('../sync/sync-core.js?v=474'),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('sync import timed out')), budget); })
    ]).finally(() => clearTimeout(timer));
    return await Promise.race([
      bridge.registerStudentAtomicallyOnline(payload),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('cloud registration timed out')), budget); })
    ]).finally(() => clearTimeout(timer));
  } catch (error) {
    console.warn('[Active Plus] atomic cloud registration unavailable, falling back to local:', error?.message || error);
    return { ok: false, reason: 'network-unavailable', error };
  }
}

function enqueuePendingCloudRegistration(entry) {
  if (!entry?.studentId || !entry?.username || !entry?.mobile) return;
  const current = readJSON(KEYS.pendingCloudRegistrations, []);
  const list = Array.isArray(current) ? current.filter(item => item && item.username !== entry.username && item.studentId !== entry.studentId) : [];
  list.push({
    studentId: String(entry.studentId),
    username: String(entry.username),
    mobile: String(entry.mobile),
    email: String(entry.email || ''),
    createdAt: String(entry.createdAt || new Date().toISOString())
  });
  writeJSON(KEYS.pendingCloudRegistrations, list);
}

function dequeuePendingCloudRegistration(username, studentId) {
  const current = readJSON(KEYS.pendingCloudRegistrations, []);
  if (!Array.isArray(current) || !current.length) return;
  const next = current.filter(item => item && item.username !== username && item.studentId !== studentId);
  writeJSON(KEYS.pendingCloudRegistrations, next);
}

let pendingFlushFlight = null;
export function flushPendingLocalRegistrations() {
  if (!LEGACY_CLOUD_ENABLED || !navigator.onLine) return Promise.resolve({ synced: 0 });
  const queue = readJSON(KEYS.pendingCloudRegistrations, []);
  if (!Array.isArray(queue) || !queue.length) return Promise.resolve({ synced: 0 });
  if (pendingFlushFlight) return pendingFlushFlight;

  pendingFlushFlight = (async () => {
    let synced = 0;
    const vault = readJSON(KEYS.accountVault, {}) || {};
    const activeAcc = loadAccount();
    for (const item of queue) {
      if (!navigator.onLine || !item?.username || !item?.mobile || !item?.studentId) continue;
      const oldId = String(item.studentId);
      const localAcc = vault[oldId]
        || (activeAcc && normalizeUsername(activeAcc.username) === normalizeUsername(item.username) ? activeAcc : null)
        || listLocalAccounts().find(acc => normalizeUsername(acc?.username) === normalizeUsername(item.username));
      if (!localAcc || !localAcc.pinHash) {
        dequeuePendingCloudRegistration(item.username, oldId);
        continue;
      }
      const existingRow = listDocuments('students').find(r => r.id === oldId || normalizeUsername(r.username) === normalizeUsername(item.username));
      const existingNotif = listRegistrationNotifications().find(n => n.studentId === oldId);

      const res = await registerOnlineWithBudget({
        mobile: item.mobile,
        username: item.username,
        email: item.email || '',
        preferredStudentId: oldId,
        buildRecords: async ({ studentId: finalId, serverMs }) => {
          const createdAt = item.createdAt || new Date(serverMs).toISOString();
          const updatedAcc = {
            ...localAcc,
            studentId: finalId,
            student: { ...(localAcc.student || {}), id: finalId }
          };
          const studentRow = {
            ...(existingRow || accountToRosterStudent(updatedAcc) || {}),
            id: finalId,
            username: normalizeUsername(item.username),
            ...(item.email ? { email: normalizeEmail(item.email) } : {}),
            status: existingRow?.status || 'pending',
            accountStatus: existingRow?.accountStatus || 'pending',
            registeredAt: existingRow?.registeredAt || createdAt,
            createdAt: existingRow?.createdAt || createdAt
          };
          const notificationRecord = {
            id: `reg-${finalId}`,
            type: 'new_registration',
            studentId: finalId,
            studentName: studentRow.name || updatedAcc.student?.name || item.username,
            mobile: item.mobile,
            createdAt: existingNotif?.createdAt || createdAt,
            read: Boolean(existingNotif?.read)
          };
          return { studentRow, cloudAccount: updatedAcc, notificationRecord };
        }
      });

      if (res?.ok) {
        const finalId = String(res.studentId || oldId);
        if (finalId !== oldId) {
          const nextVault = readJSON(KEYS.accountVault, {}) || {};
          if (nextVault[oldId]) {
            nextVault[finalId] = { ...nextVault[oldId], studentId: finalId, student: { ...(nextVault[oldId].student || {}), id: finalId } };
            delete nextVault[oldId];
            writeJSON(KEYS.accountVault, nextVault);
          }
          const curAcc = loadAccount();
          if (curAcc && String(curAcc.student?.id || curAcc.studentId) === oldId) {
            writeJSON(KEYS.account, { ...curAcc, studentId: finalId, student: { ...(curAcc.student || {}), id: finalId } });
          }
          const rows = listDocuments('students').map(r => (r.id === oldId ? { ...r, id: finalId } : r));
          saveRoster(rows);
        }
        dequeuePendingCloudRegistration(item.username, oldId);
        synced += 1;
      } else if (res?.reason === 'duplicate' || res?.reason === 'daily-limit') {
        dequeuePendingCloudRegistration(item.username, oldId);
      }
    }
    return { synced };
  })().finally(() => {
    pendingFlushFlight = null;
  });

  return pendingFlushFlight;
}

function buildStudentPayload(form, { studentId, mobile, username, email, createdAt }) {
  const className = String(form.get('className') || '');
  const studentData = {
    name: String(form.get('nameBn') || '').trim(),
    nameBn: String(form.get('nameBn') || '').trim(),
    nameEn: String(form.get('nameEn') || '').trim(),
    className,
    group: String(form.get('group') || ''),
    id: studentId,
    username,
    ...(email ? { email } : {}),
    fatherName: String(form.get('fatherName') || '').trim(),
    motherName: String(form.get('motherName') || '').trim(),
    guardianName: String(form.get('guardianName') || '').trim(),
    birthDate: String(form.get('birthDate') || ''),
    gender: String(form.get('gender') || ''),
    studentMobile: mobile,
    guardianMobile: contactNumber(form.get('guardianMobile')) || normalizeMobile(form.get('guardianMobile')),
    address: String(form.get('address') || '').trim(),
    major: String(form.get('major') || '').trim(),
    institution: String(form.get('institution') || '').trim(),
    roll: generateClassRoll(className),
    registrationNo: String(form.get('registrationNo') || '').trim()
  };

  const account = {
    mobile,
    registrationMobile: mobile,
    additionalMobiles: [],
    username,
    ...(email ? { email } : {}),
    pin: String(form.get('pin') || ''),
    securityQuestion: String(form.get('securityQuestion') || ''),
    securityAnswer: normalizeAnswer(form.get('securityAnswer')),
    student: studentData,
    studentId,
    status: 'pending',
    guardianConsentAt: createdAt,
    createdAt
  };

  const notificationDraft = {
    id: `reg-${studentId}`,
    type: 'new_registration',
    studentId,
    studentName: studentData.name || studentData.nameEn || username,
    mobile,
    createdAt,
    read: false
  };

  return { studentData, account, notificationDraft };
}

export async function submitStudentRegistration({ entries, formElement, state, onRegistered, toggleMajorField }) {
  const form = {
    get: key => {
      const found = entries.find(([k]) => k === key);
      return found ? found[1] : null;
    }
  };

  return withRegistrationLock(async () => {
    if (!form.get('guardianConsent')) return setAuthMessage('রেজিস্ট্রেশনে অভিভাবকের সম্মতি প্রয়োজন।');

    const mobile = contactNumber(form.get('mobile'));
    const pin = String(form.get('pin') || '');
    const pinConfirm = String(form.get('pinConfirm') || '');
    const username = normalizeUsername(form.get('username'));
    const email = normalizeEmail(form.get('email'));

    const mobErr = mobileError(mobile);
    if (mobErr || !isContactNumber(mobile)) return setAuthMessage(mobErr || 'সঠিক মোবাইল নম্বর দিন।');

    const usernameProblem = usernameError(username);
    if (usernameProblem) return setAuthMessage(usernameProblem);

    const mailErr = emailError(email);
    if (mailErr) return setAuthMessage(mailErr);

    const pinProblem = registrationPasswordError(pin, pinConfirm);
    if (pinProblem) return setAuthMessage(pinProblem);

    const guardianPhone = contactNumber(form.get('guardianMobile'));
    if (!isContactNumber(guardianPhone)) {
      return setAuthMessage('অভিভাবকের সঠিক ১১ সংখ্যার বাংলাদেশি মোবাইল নম্বর দিন।');
    }

    if (mobileTaken(mobile)) return setAuthMessage(DUPLICATE_MOBILE_MESSAGE);
    if (usernameTaken(username)) return setAuthMessage(DUPLICATE_USERNAME_MESSAGE);
    if (email && emailTaken(email)) return setAuthMessage(DUPLICATE_EMAIL_MESSAGE);

    let studentId = '';
    let storedAccount = null;
    let studentData = null;
    let notificationDraft = null;

    const cloudResult = await registerOnlineWithBudget({
      mobile,
      username,
      email,
      buildRecords: async ({ studentId: allocatedId, serverMs }) => {
        const createdAt = new Date(serverMs).toISOString();
        const built = buildStudentPayload(form, { studentId: allocatedId, mobile, username, email, createdAt });
        studentData = built.studentData;
        notificationDraft = built.notificationDraft;
        storedAccount = await persistAccount(built.account, { isNewRegistration: true });
        const studentRow = {
          ...(accountToRosterStudent(storedAccount) || {}),
          id: allocatedId,
          username,
          ...(email ? { email } : {}),
          status: 'pending',
          accountStatus: 'pending',
          registeredAt: createdAt,
          createdAt
        };
        return {
          studentRow,
          cloudAccount: storedAccount,
          notificationRecord: notificationDraft
        };
      }
    });

    if (cloudResult.ok) {
      studentId = cloudResult.studentId;
      reserveMobile(mobile, studentId);
      reserveUsername(username, studentId);
      if (email) reserveEmail(email, studentId);
      createRegistrationNotificationRecord(notificationDraft);
    } else if (cloudResult.reason === 'duplicate' || cloudResult.reason === 'daily-limit') {
      return setAuthMessage(cloudResult.error || DUPLICATE_USERNAME_MESSAGE);
    } else {
      if ((await checkUsernameOnline(username))?.taken) {
        return setAuthMessage(DUPLICATE_USERNAME_MESSAGE);
      }
      const existingRows = [
        ...listDocuments('students'),
        ...listLocalAccounts().map(acc => ({ id: acc?.student?.id || acc?.studentId }))
      ].filter(row => row?.id);

      const { idGenerator } = await import('./idGenerator.js');
      try {
        studentId = await idGenerator.nextStudentId(existingRows);
      } catch (idErr) {
        return setAuthMessage(idErr?.message || 'আজকের রেজিস্ট্রেশন সীমা পূর্ণ হয়েছে।');
      }

      if (!reserveMobile(mobile, studentId)) return setAuthMessage(DUPLICATE_MOBILE_MESSAGE);
      if (!reserveUsername(username, studentId)) {
        releaseMobile(mobile, studentId);
        return setAuthMessage(DUPLICATE_USERNAME_MESSAGE);
      }
      if (email && !reserveEmail(email, studentId)) {
        releaseUsername(username, studentId);
        releaseMobile(mobile, studentId);
        return setAuthMessage(DUPLICATE_EMAIL_MESSAGE);
      }

      const createdAt = new Date().toISOString();
      const built = buildStudentPayload(form, { studentId, mobile, username, email, createdAt });
      studentData = built.studentData;
      notificationDraft = built.notificationDraft;

      try {
        storedAccount = await persistAccount(built.account, { isNewRegistration: true });
      } catch {
        if (email) releaseEmail(email, studentId);
        releaseUsername(username, studentId);
        releaseMobile(mobile, studentId);
        return setAuthMessage('সংরক্ষণ হয়নি। স্টোরেজ পরীক্ষা করে আবার চেষ্টা করুন।');
      }
      createRegistrationNotificationRecord(notificationDraft);
      enqueuePendingCloudRegistration({ studentId, username, mobile, email, createdAt });
    }

    state.account = loadAccount() || storedAccount;
    state.student = { ...state.student, ...studentData };
    saveStudent(state.student);
    upsertStudentRosterRow();
    formElement?.reset?.();
    toggleMajorField?.();
    const pendingId = $('#pendingStudentId');
    if (pendingId) pendingId.textContent = studentId;
    switchAuthTab('login');
    if ($('#loginMobile')) $('#loginMobile').value = username;
    if ($('#loginPin')) $('#loginPin').value = '';
    setAuthMessage(`রেজিস্ট্রেশন সফল। Student ID: ${studentId} • আপনার আবেদন অনুমোদনের অপেক্ষায় আছে।`, true);
    onRegistered?.();
    showFeedback(`রেজিস্ট্রেশন সফল — ID: ${studentId} • ইউজারনেম: ${username}`);
  });
}

export async function resolveStudentLoginStatus(account, budgetMs = 2500) {
  const sid = String(account?.student?.id || account?.studentId || '').trim();
  let status = account?.status === 'approved' ? 'active' : String(account?.status || 'pending');

  if (sid) {
    const roster = listDocuments('students').find(row => row.id === sid);
    if (roster && roster.status) {
      const mapped = roster.status === 'approved' || roster.status === 'active'
        ? 'active'
        : roster.status === 'rejected'
          ? 'rejected'
          : roster.status === 'inactive'
            ? 'inactive'
            : roster.status === 'pending'
              ? 'pending'
              : status;
      // Never downgrade an already-active account back to 'pending' from an unreviewed/migrated roster row;
      // only explicit 'rejected' or 'inactive' decisions block an active account.
      const allowTransition = !(status === 'active' && mapped === 'pending');
      if (allowTransition && mapped !== status) {
        status = mapped;
        await syncAccountStatus(sid, mapped, {
          approvedBy: roster.approvedBy || roster.reviewedBy || '',
          approvedAt: roster.approvedAt || roster.reviewedAt || '',
          reviewNote: roster.reviewNote || ''
        });
      }
    }
  }

  if (status === 'pending' && LEGACY_CLOUD_ENABLED && navigator.onLine) {
    let timer;
    try {
      await flushPendingLocalRegistrations();
      const bridge = await Promise.race([
        import('../sync/sync-core.js?v=474'),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('approval import timed out')), budgetMs); })
      ]).finally(() => clearTimeout(timer));
      const refreshed = await Promise.race([
        bridge.refreshStudentApprovalOnline(account),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('approval refresh timed out')), budgetMs); })
      ]).finally(() => clearTimeout(timer));
      if (refreshed?.ok && refreshed.status && refreshed.status !== status) {
        status = refreshed.status === 'approved' ? 'active' : refreshed.status;
        if (sid) {
          await syncAccountStatus(sid, status, {
            approvedBy: refreshed.approvedBy || '',
            approvedAt: refreshed.approvedAt || '',
            reviewNote: refreshed.reviewNote || ''
          });
          if (refreshed.row) {
            const rows = listDocuments('students');
            const idx = rows.findIndex(r => r.id === sid);
            if (idx >= 0) {
              rows[idx] = { ...rows[idx], ...refreshed.row, id: sid };
              saveRoster(rows);
            } else {
              saveRoster([...rows, { ...refreshed.row, id: sid }]);
            }
          }
        }
      }
    } catch { /* offline / unreachable cloud keeps local status */ }
  }
  return status;
}
