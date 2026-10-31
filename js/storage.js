import { taka } from './money.js';
import { backendMode } from '../sync/cloud-access.js';
import { safeSetItem } from './storage-safety.js';
/* Device account, session and username index. Document collections live in database.js.
   Phase 1 security: the student password (PIN) and the recovery answer are stored
   only as PBKDF2 hashes — never as plaintext — and sessions are random tokens
   bound to this device with an expiry (session.js). Records written by the
   retired plaintext scheme are upgraded to hashes on the next successful login
   or save, so no plaintext secret survives a normal session. */

import { protectAccountIdentity, normalizeUsername, contactNumber, isContactNumber, normalizeEmail, isValidEmail } from './account-policy.js';
import { normalizeAnswer } from './ui.js';
import { STORAGE_KEYS, defaultStudent, DEFAULT_APP_SETTINGS } from './config.js';
import { rememberAccount, KEYS, nextSequence } from './database.js';
import { hashPassword, verifyPassword, isPasswordRecord } from './password-hash.js';
import { encryptValue, decryptValue, isEncryptedEnvelope } from './secure-store.js';
import { buildSessionRecord, isSessionRecordValid, SESSION_TTL_DAYS } from './session.js';
import { LOCAL_WRITE_KEY, markLocalSource } from './local-write-mark.js';
import { dhakaParts, nowEpoch } from './time.js';

const TAB_SESSION_MARKER = '1';

function getStorage(type = 'local') {
  try { return type === 'session' ? window.sessionStorage : window.localStorage; }
  catch { return null; }
}

export function readJSON(key, fallback = null) {
  try {
    const value = getStorage()?.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch { return fallback; }
}

export function writeJSON(key, value) {
  try { const storage = getStorage(); if (!storage) return false; safeSetItem(storage, key, JSON.stringify(value)); return true; }
  catch { return false; }
}

export function loadStudent() {
  return { ...defaultStudent, ...(readJSON(STORAGE_KEYS.student, {}) || {}) };
}

export function saveStudent(student) {
  const account = loadAccount();
  const value = account?.student?.id && account.student.id === student.id ? { ...student, studentMobile: account.registrationMobile || account.mobile } : student;
  return writeJSON(STORAGE_KEYS.student, value?.monthlyFee == null || value.monthlyFee === '' ? value : { ...value, monthlyFee: taka(value.monthlyFee) });
}

export function loadAccount() {
  const account = readJSON(STORAGE_KEYS.account, null);
  if (!account) return null;
  try { return protectAccountIdentity(account, account); } catch { return account; }
}

/** Plaintext secrets provided by the caller become hashes; they are never
   stored. An empty password never falls back to a built-in default: no hash
   is written and no default password can open the account. */
async function hashSecrets(value, source) {
  const stored = { ...value };
  const pin = typeof source?.pin === 'string' && source.pin ? source.pin : null;
  if (pin) stored.pinHash = await hashPassword(pin);
  if (typeof source?.securityAnswer === 'string' && source.securityAnswer) {
    stored.securityAnswerHash = await hashPassword(normalizeAnswer(source.securityAnswer));
  }
  delete stored.pin;
  delete stored.securityAnswer;
  return stored;
}

export function readAccountVault() {
  const map = readJSON(KEYS.accountVault, {}) || {};
  return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
}

export function rememberAccountVault(account) {
  const id = String(account?.student?.id || account?.studentId || '').trim();
  if (!id) return false;
  const vault = { ...readAccountVault() };
  const clean = { ...account };
  delete clean.pin;
  delete clean.securityAnswer;
  vault[id] = clean;
  return writeJSON(KEYS.accountVault, vault);
}

export function loadAccountByStudentId(studentId) {
  const id = String(studentId || '').trim();
  if (!id) return null;
  const current = loadAccount();
  if ((current?.student?.id || current?.studentId) === id) return current;
  const vaulted = readAccountVault()[id];
  if (!vaulted) return null;
  try { return protectAccountIdentity(vaulted, vaulted); } catch { return vaulted; }
}

export function listLocalAccounts() {
  const byId = new Map();
  const vault = readAccountVault();
  for (const [id, acc] of Object.entries(vault)) {
    if (acc && typeof acc === 'object') byId.set(id, acc);
  }
  const current = loadAccount();
  const currentId = String(current?.student?.id || current?.studentId || '').trim();
  if (current) byId.set(currentId || '__current__', current);
  return [...byId.values()];
}

export async function persistAccount(account, options = {}) {
  const storage = getStorage();
  if (!storage) throw new Error('স্টোরেজ পাওয়া যায়নি');
  const raw = storage.getItem(STORAGE_KEYS.account);
  const currentStored = raw === null ? null : JSON.parse(raw);
  const candidateId = String(account?.student?.id || account?.studentId || '').trim();
  const currentId = String(currentStored?.student?.id || currentStored?.studentId || '').trim();
  const switchingStudent = Boolean(options?.isNewRegistration) || Boolean(candidateId && currentId && candidateId !== currentId);
  const previous = switchingStudent
    ? (candidateId ? readAccountVault()[candidateId] || null : null)
    : currentStored;
  const value = protectAccountIdentity(account, previous);
  const stored = await hashSecrets(value, account);
  if (stored.student?.monthlyFee != null && stored.student.monthlyFee !== '') stored.student = { ...stored.student, monthlyFee: taka(stored.student.monthlyFee) };
  // Cross-device merge tiebreak: the newest local change must not be replaced
  // by an older cloud copy (e.g. a password changed while offline).
  stored.updatedAt = new Date().toISOString();
  safeSetItem(storage, STORAGE_KEYS.account, JSON.stringify(stored));
  rememberAccount(stored);
  const storedId = String(stored?.student?.id || stored?.studentId || '').trim();
  if (storedId && (options?.isNewRegistration || readAccountVault()[storedId])) {
    rememberAccountVault(stored);
  }
  return stored;
}

export async function saveAccount(account, options = {}) {
  try { await persistAccount(account, options); return true; } catch { return false; }
}

/* ---------- Password and recovery-answer checks ---------- */

/** True when the typed password matches the stored hash (or a legacy record). */
export async function verifyAccountPassword(account, password) {
  if (!account) return false;
  if (isPasswordRecord(account.pinHash)) return verifyPassword(password, account.pinHash);
  if (typeof account.pin === 'string' && account.pin) {
    return String(password ?? '') === account.pin;
  }
  return false;
}

/** True when the typed answer matches the stored answer hash (or legacy text). */
export async function verifySecurityAnswer(account, answer) {
  if (!account) return false;
  const typed = normalizeAnswer(answer);
  if (isPasswordRecord(account.securityAnswerHash)) return verifyPassword(typed, account.securityAnswerHash);
  if (typeof account.securityAnswer === 'string' && account.securityAnswer) {
    return typed === normalizeAnswer(account.securityAnswer);
  }
  return false;
}

/**
 * Upgrade a legacy plaintext account to hashes. Called after a successful
 * login or recovery so the plaintext PIN/answer is replaced on the spot.
 */
export async function upgradeAccountSecrets(account, { pin, securityAnswer } = {}) {
  if (!account) return null;
  const needsPin = Boolean(pin) && !isPasswordRecord(account.pinHash);
  const needsAnswer = Boolean(securityAnswer) && !isPasswordRecord(account.securityAnswerHash);
  if (!needsPin && !needsAnswer) return account;
  try {
    return await persistAccount({
      ...account,
      ...(needsPin ? { pin } : {}),
      ...(needsAnswer ? { securityAnswer } : {})
    });
  } catch { return account; }
}

/* ---------- Username registry ----------
   Device-local claim table so two accounts on the same phone cannot pick the
   same username. A real server replaces these four helpers with one API call. */

export function readUsernameIndex() {
  const raw = readJSON(STORAGE_KEYS.usernames, {}) || {};
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function scanKnownStudentOwners() {
  const rows = [];
  const roster = readJSON(KEYS.students, []);
  if (Array.isArray(roster)) {
    for (const row of roster) {
      if (row && typeof row === 'object' && row.id) rows.push(row);
    }
  }
  const accounts = readJSON(KEYS.accounts, {});
  if (accounts && typeof accounts === 'object' && !Array.isArray(accounts)) {
    for (const acc of Object.values(accounts)) {
      if (acc && typeof acc === 'object') rows.push(acc);
    }
  }
  for (const acc of listLocalAccounts()) {
    if (acc && typeof acc === 'object') rows.push(acc);
  }
  return rows;
}

export function usernameOwner(username) {
  const name = normalizeUsername(username);
  if (!name) return null;
  const indexed = readUsernameIndex()[name];
  if (indexed) return indexed;
  for (const rec of scanKnownStudentOwners()) {
    const candidate = normalizeUsername(rec.username || rec.student?.username || '');
    const owner = String(rec.id || rec.student?.id || rec.studentId || '').trim();
    if (candidate && candidate === name && owner) return owner;
  }
  return null;
}

export function usernameTaken(username, exceptOwner = '') {
  const owner = usernameOwner(username);
  if (!owner) return false;
  return exceptOwner ? owner !== String(exceptOwner) : true;
}

/** Claim the name for this owner; false when somebody else already holds it. */
export function reserveUsername(username, owner) {
  const name = normalizeUsername(username);
  if (!name || !owner) return false;
  const existing = usernameOwner(name);
  if (existing && existing !== owner) return false;
  const index = { ...readUsernameIndex(), [name]: owner };
  return writeJSON(STORAGE_KEYS.usernames, index);
}

/** Only the owner can release a claim (keeps a name from being reused silently). */
export function releaseUsername(username, owner) {
  const name = normalizeUsername(username);
  const index = { ...readUsernameIndex() };
  if (!name || index[name] !== owner) return false;
  delete index[name];
  return writeJSON(STORAGE_KEYS.usernames, index);
}

/* ---------- Mobile & Email uniqueness registries ---------- */

export function readMobileIndex() {
  const raw = readJSON(KEYS.mobiles, {}) || {};
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

export function mobileOwner(mobile) {
  const normalized = contactNumber(mobile);
  if (!isContactNumber(normalized)) return null;
  const indexed = readMobileIndex()[normalized];
  if (indexed) return indexed;
  for (const rec of scanKnownStudentOwners()) {
    const recMobile = contactNumber(rec.registrationMobile || rec.mobile || rec.student?.studentMobile || '');
    const owner = String(rec.id || rec.student?.id || rec.studentId || '').trim();
    if (recMobile && recMobile === normalized && owner) return owner;
  }
  return null;
}

export function mobileTaken(mobile, exceptOwner = '') {
  const owner = mobileOwner(mobile);
  if (!owner) return false;
  return exceptOwner ? owner !== String(exceptOwner) : true;
}

export function reserveMobile(mobile, owner) {
  const normalized = contactNumber(mobile);
  if (!isContactNumber(normalized) || !owner) return false;
  const existing = mobileOwner(normalized);
  if (existing && existing !== owner) return false;
  const index = { ...readMobileIndex(), [normalized]: owner };
  return writeJSON(KEYS.mobiles, index);
}

export function releaseMobile(mobile, owner) {
  const normalized = contactNumber(mobile);
  const index = { ...readMobileIndex() };
  if (!normalized || index[normalized] !== owner) return false;
  delete index[normalized];
  return writeJSON(KEYS.mobiles, index);
}

export function readEmailIndex() {
  const raw = readJSON(KEYS.emails, {}) || {};
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

export function emailOwner(email) {
  const normalized = normalizeEmail(email);
  if (!normalized || !isValidEmail(normalized)) return null;
  const indexed = readEmailIndex()[normalized];
  if (indexed) return indexed;
  for (const rec of scanKnownStudentOwners()) {
    const recEmail = normalizeEmail(rec.email || rec.student?.email || '');
    const owner = String(rec.id || rec.student?.id || rec.studentId || '').trim();
    if (recEmail && recEmail === normalized && owner) return owner;
  }
  return null;
}

export function emailTaken(email, exceptOwner = '') {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const owner = emailOwner(normalized);
  if (!owner) return false;
  return exceptOwner ? owner !== String(exceptOwner) : true;
}

export function reserveEmail(email, owner) {
  const normalized = normalizeEmail(email);
  if (!normalized) return true;
  if (!isValidEmail(normalized) || !owner) return false;
  const existing = emailOwner(normalized);
  if (existing && existing !== owner) return false;
  const index = { ...readEmailIndex(), [normalized]: owner };
  return writeJSON(KEYS.emails, index);
}

export function releaseEmail(email, owner) {
  const normalized = normalizeEmail(email);
  const index = { ...readEmailIndex() };
  if (!normalized || index[normalized] !== owner) return false;
  delete index[normalized];
  return writeJSON(KEYS.emails, index);
}

const SESSION_KEY = STORAGE_KEYS.session;

export function isSecurityCheckDisabled() {
  try {
    return getStorage('local')?.getItem(STORAGE_KEYS.skipSecurity) === '1';
  } catch { return false; }
}

export function setSecurityCheckDisabled(disabled = true) {
  try {
    if (disabled) {
      getStorage('local')?.setItem(STORAGE_KEYS.skipSecurity, '1');
    } else {
      getStorage('local')?.removeItem(STORAGE_KEYS.skipSecurity);
    }
    return true;
  } catch { return false; }
}

export function isTrustedDevice() {
  try {
    return getStorage('local')?.getItem(STORAGE_KEYS.trustedDevice) === '1';
  } catch { return false; }
}

export function setTrustedDevice(trusted = true) {
  try {
    if (trusted) {
      getStorage('local')?.setItem(STORAGE_KEYS.trustedDevice, '1');
    } else {
      getStorage('local')?.removeItem(STORAGE_KEYS.trustedDevice);
    }
    return true;
  } catch { return false; }
}

/* ---------- Sessions: token + device binding + expiry ---------- */

export async function persistSession(remember = true) {
  try {
    const local = getStorage('local');
    const tab = getStorage('session');
    local?.removeItem(SESSION_KEY);
    local?.removeItem(STORAGE_KEYS.sessionExpiry);
    tab?.removeItem(SESSION_KEY);

    if (!remember) {
      // Tab-only session: it disappears when the tab closes.
      tab?.setItem(SESSION_KEY, TAB_SESSION_MARKER);
      return true;
    }
    const record = buildSessionRecord({ owner: 'student', ttlDays: SESSION_TTL_DAYS.student });
    const envelope = await encryptValue(JSON.stringify(record));
    return envelope ? writeJSON(SESSION_KEY, envelope) : writeJSON(SESSION_KEY, record);
  } catch { /* private browsing can disable storage */ }
}

async function readStudentSession() {
  try {
    const tab = getStorage('session');
    if (tab?.getItem(SESSION_KEY) === TAB_SESSION_MARKER) return { tab: true };
    const raw = readJSON(SESSION_KEY);
    if (raw === null) return null;
    if (isEncryptedEnvelope(raw)) {
      const plaintext = await decryptValue(raw);
      if (!plaintext) return null;
      try { return JSON.parse(plaintext); } catch { return null; }
    }
    return raw && typeof raw === 'object' ? raw : null;
  } catch { return null; }
}

export async function hasSession() {
  if (backendMode() === 'firebase') return false;
  // Only a real session obtained after credential verification may open the app.
  const record = await readStudentSession();
  if (!record) return false;
  if (record.tab) return true;
  if (isSessionRecordValid(record)) return true;
  try {
    getStorage('local')?.removeItem(SESSION_KEY);
    getStorage('local')?.removeItem(STORAGE_KEYS.sessionExpiry);
    getStorage('session')?.removeItem(SESSION_KEY);
  } catch { /* no-op */ }
  return false;
}

export function clearSession() {
  try {
    const local = getStorage('local');
    const sessionStore = getStorage('session');
    local?.removeItem(SESSION_KEY);
    local?.removeItem(STORAGE_KEYS.sessionExpiry);
    local?.removeItem(STORAGE_KEYS.trustedDevice);
    sessionStore?.removeItem(SESSION_KEY);
  } catch { /* no-op */ }
}

export function loadAppConfig() {
  const custom = readJSON(STORAGE_KEYS.appConfig, {});
  return {
    ...DEFAULT_APP_SETTINGS,
    ...custom,
    modules: {
      ...DEFAULT_APP_SETTINGS.modules,
      ...(custom?.modules || {})
    }
  };
}

export function saveAppConfig(config) {
  // Notification read receipts share the existing synced settings collection.
  // An Admin page may hold an older in-memory config when a remote receipt
  // arrives, so preserve those internal receipt keys when saving normal settings.
  const current = readJSON(STORAGE_KEYS.appConfig, {});
  const receipts = Object.fromEntries(Object.entries(current || {})
    .filter(([key]) => key.startsWith('__apcNotificationSeenV1_')));
  const saved = writeJSON(STORAGE_KEYS.appConfig, { ...(config || {}), ...receipts });
  // The admin who typed the urgent announcement does not get their own push.
  if (saved) {
    try {
      writeJSON(LOCAL_WRITE_KEY, markLocalSource(readJSON(LOCAL_WRITE_KEY, null), 'settings', 'broadcast'));
    } catch { /* best effort */ }
    /* Same-tab notification: the `storage` event only fires in OTHER tabs. Every
       live surface that shows institute details (Dashboard card, top-bar slogan,
       Help sheet, receipt headers) listens for this and repaints from the record
       that was just written, so a saved address is visible immediately with no
       manual reload. js/org-info.js reads the value, never this event payload. */
    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('apc-app-config-saved', { detail: { keys: Object.keys(config || {}) } }));
      }
    } catch { /* non-browser environment (tests, workers) */ }
  }
  return saved;
}

export function generateStudentId(epochMs = nowEpoch()) {
  const parts = dhakaParts(new Date(epochMs));
  const date = `${String(parts.year).slice(-2).padStart(2, '0')}${String(parts.month).padStart(2, '0')}${String(parts.day).padStart(2, '0')}`;
  const sequence = nextSequence(`studentId:${date}`);
  if (sequence > 999) {
    throw new Error('আজকের সর্বোচ্চ ৯৯৯টি রেজিস্ট্রেশন সীমা পূর্ণ হয়েছে। আগামীকাল আবার চেষ্টা করুন।');
  }
  return `${date}${String(sequence).padStart(3, '0')}`;
}

const CLASS_ID_CODES = Object.freeze({
  'অষ্টম শ্রেণি': '08', 'নবম শ্রেণি': '09', 'দশম শ্রেণি': '10',
  'একাদশ শ্রেণি': '11', 'দ্বাদশ শ্রেণি': '12', 'ডিগ্রি ১ম বর্ষ': '21',
  'ডিগ্রি ২য় বর্ষ': '22', 'ডিগ্রি ৩য় বর্ষ': '23', 'অনার্স ১ম বর্ষ': '31',
  'অনার্স ২য় বর্ষ': '32', 'অনার্স ৩য় বর্ষ': '33', 'অনার্স ৪র্থ বর্ষ': '34'
});

export function generateClassRoll(className) {
  const code = CLASS_ID_CODES[className];
  if (!code) throw new Error('শ্রেণির জন্য রোল তৈরি করা যায়নি।');
  const year = String(new Date().getFullYear()).slice(-2);
  const scope = `ROLL:${year}:${code}`;
  let existingMax = 0;
  const pattern = new RegExp(`^R-?${year}${code}(\\d{3,})$`);
  const roster = readJSON(KEYS.students, []);
  for (const student of Array.isArray(roster) ? roster : []) {
    const match = String(student?.roll || '').match(pattern);
    if (match) existingMax = Math.max(existingMax, Number(match[1]) || 0);
  }
  const sequence = nextSequence(scope, existingMax);
  return `R-${year}${code}${String(sequence).padStart(3, '0')}`;
}

