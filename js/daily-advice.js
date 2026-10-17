/* Shared, offline-first advice bank: the Student home hero reads it, while
 * Admin/Manager editors manage it. Teacher has no rendered hero. The RTDB path
 * is activePlusSync/v1/adviceBank/{adviceId}; no dailyAdvice node is used.
 * Server rules remain the authority for Admin/Manager writes. */
import { quoteDateKey, quoteDayNumber } from './daily-quote.js';

export const DAILY_ADVICE_CACHE_KEY = 'activePlus.adviceBank.v1';
export const LEGACY_DAILY_ADVICE_CACHE_KEY = 'activePlus.dailyAdvice.bank.v1';
export const DAILY_ADVICE_BANK_PATH = 'activePlusSync/v1/adviceBank';
export const DAILY_ADVICE_TIME_ZONE = 'Asia/Dhaka';
export const DAILY_ADVICE_START_DATE = '2026-10-17';
export const DAILY_ADVICE_SEED_VERSION = 2;
export const DAILY_ADVICE_MAX_LENGTH = 140;
export const DAILY_ADVICE_SOURCE_MAX_LENGTH = 120;
export const DAILY_ADVICE_FEED_URL = 'assets/daily-advice.json'; // retained for older callers
export const DAILY_ADVICE_FALLBACK = Object.freeze({
  text: 'আজ যা শিখবে, কাল সেটাই তোমার আত্মবিশ্বাস।',
  source: 'Active Plus Coaching'
});
export const FALLBACK = DAILY_ADVICE_FALLBACK;

export const DAILY_ADVICE_SEEDS = Object.freeze([
  Object.freeze({ id: 'ADV-001', text: 'আজ যা শিখবে, কাল সেটাই তোমার আত্মবিশ্বাস।', source: 'Active Plus Coaching', active: true, order: 1, createdBy: 'seed', createdAt: 0 }),
  Object.freeze({ id: 'ADV-002', text: 'প্রতিদিন অল্প অল্প করে পড়ো, বড় সাফল্য ছোট অভ্যাস থেকেই আসে।', source: 'Active Plus Coaching', active: true, order: 2, createdBy: 'seed', createdAt: 0 }),
  Object.freeze({ id: 'ADV-003', text: 'ভুল করলে থেমো না, ভুলই সেরা শিক্ষক।', source: 'Active Plus Coaching', active: true, order: 3, createdBy: 'seed', createdAt: 0 }),
  Object.freeze({ id: 'ADV-004', text: 'প্রশ্ন করতে লজ্জা পেয়ো না, না জানাটা দোষ নয়।', source: 'Active Plus Coaching', active: true, order: 4, createdBy: 'seed', createdAt: 0 }),
  Object.freeze({ id: 'ADV-005', text: 'নিজের সাথে প্রতিযোগিতা করো, গতকালের চেয়ে একটু ভালো হও।', source: 'Active Plus Coaching', active: true, order: 5, createdBy: 'seed', createdAt: 0 })
]);

const safeId = value => {
  const id = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : '';
};
const cleanText = value => String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
const validDateKey = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) ? String(value) : '';
const numericTime = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
const plainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const cleanSource = value => cleanText(value).slice(0, DAILY_ADVICE_SOURCE_MAX_LENGTH) || DAILY_ADVICE_FALLBACK.source;

export function validateAdviceText(value) {
  const text = cleanText(value);
  if (!text) return { ok: false, value: '', error: 'পরামর্শ লিখুন।' };
  if (text.length > DAILY_ADVICE_MAX_LENGTH) {
    return { ok: false, value: text, error: `পরামর্শ ${DAILY_ADVICE_MAX_LENGTH} অক্ষরের মধ্যে রাখুন।` };
  }
  return { ok: true, value: text, error: '' };
}

/** Returns null for malformed data; a legacy record is normalized in memory. */
export function normalizeAdvice(record) {
  if (!plainObject(record)) return null;
  const id = safeId(record.id);
  const text = validateAdviceText(record.text);
  if (!id || !text.ok) return null;
  const rawOrder = Number(record.order);
  return {
    id,
    text: text.value,
    source: cleanSource(record.source),
    active: record.active !== false,
    order: Number.isSafeInteger(rawOrder) && rawOrder > 0 ? rawOrder : 0,
    createdBy: String(record.createdBy ?? record.updatedBy ?? 'migration').trim().slice(0, 128) || 'migration',
    createdAt: numericTime(record.createdAt)
  };
}

/** Accepts the new adviceBank map plus old cache/wrapper shapes for migration. */
export function normalizeAdviceBank(value) {
  let source;
  if (Array.isArray(value)) source = value.map((entry, index) => [String(index), entry]);
  else if (plainObject(value?.items)) source = Object.entries(value.items);
  else if (plainObject(value)) source = Object.entries(value).filter(([key]) => key !== 'meta');
  else source = [];

  const seen = new Set();
  const rows = [];
  source.forEach(([key, entry], index) => {
    // The current RTDB record omits a redundant `id`; recover it from the key.
    // Older cached/wrapped records that already carry `id` remain migratable.
    const item = normalizeAdvice({ ...entry, id: entry?.id || key });
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    rows.push({ item, inputOrder: index + 1 });
  });
  rows.sort((a, b) => (a.item.order || a.inputOrder) - (b.item.order || b.inputOrder) ||
    a.item.createdAt - b.item.createdAt || a.item.id.localeCompare(b.item.id, 'en'));
  return rows.map(({ item }, index) => ({ ...item, order: index + 1 }));
}

/** The same Dhaka calendar day always selects the same active ordered record. */
export function pickDailyAdvice(items, dateKey = quoteDateKey()) {
  const day = validDateKey(dateKey) || quoteDateKey();
  const seenText = new Set();
  const active = normalizeAdviceBank(items).filter(item => {
    if (!item.active) return false;
    const key = cleanText(item.text);
    if (seenText.has(key)) return false;
    seenText.add(key);
    return true;
  });
  if (!active.length) return { ...DAILY_ADVICE_FALLBACK };
  const offset = quoteDayNumber(day) - quoteDayNumber(DAILY_ADVICE_START_DATE);
  const index = ((offset % active.length) + active.length) % active.length;
  return active[index] || { ...DAILY_ADVICE_FALLBACK };
}

export function millisecondsUntilDhakaMidnight(now = Date.now()) {
  const current = now instanceof Date ? now.getTime() : typeof now === 'string' ? Date.parse(now) : Number(now);
  if (!Number.isFinite(current)) return 24 * 60 * 60 * 1000;
  const [year, month, day] = quoteDateKey(current).split('-').map(Number);
  const nextBoundary = Date.UTC(year, month - 1, day + 1) - 6 * 60 * 60 * 1000;
  return Math.max(250, nextBoundary - current + 25);
}

function safeStorage(storage) {
  if (storage !== undefined) return storage;
  try { return globalThis.localStorage; } catch { return null; }
}

function normalizePending(pending) {
  if (!Array.isArray(pending)) return [];
  const latest = new Map();
  for (const operation of pending) {
    const id = safeId(operation?.id || operation?.item?.id);
    if (!id || !['save', 'delete'].includes(operation?.type)) continue;
    if (operation.type === 'delete') latest.set(id, { type: 'delete', id });
    else {
      const item = normalizeAdvice(operation.item);
      if (item) latest.set(id, { type: 'save', id, item });
    }
  }
  return [...latest.values()].sort((a, b) => a.type === 'save' && b.type === 'save'
    ? a.item.order - b.item.order
    : a.id.localeCompare(b.id, 'en'));
}

export function readAdviceCache(storage) {
  const target = safeStorage(storage);
  for (const key of [DAILY_ADVICE_CACHE_KEY, LEGACY_DAILY_ADVICE_CACHE_KEY]) {
    try {
      const raw = target?.getItem(key);
      if (!raw) continue;
      const value = JSON.parse(raw);
      if (!plainObject(value) || ![1, DAILY_ADVICE_SEED_VERSION].includes(value.version)) continue;
      return {
        version: DAILY_ADVICE_SEED_VERSION,
        items: normalizeAdviceBank(value.items),
        pending: normalizePending(value.pending),
        remoteLoaded: value.remoteLoaded === true,
        updatedAt: numericTime(value.updatedAt)
      };
    } catch { /* try the legacy key next; never touch other storage */ }
  }
  return null;
}

export function writeAdviceCache({ items = [], pending = [], remoteLoaded = false, updatedAt = Date.now() } = {}, storage) {
  const target = safeStorage(storage);
  const value = {
    version: DAILY_ADVICE_SEED_VERSION,
    items: normalizeAdviceBank(items),
    pending: normalizePending(pending),
    remoteLoaded: remoteLoaded === true,
    updatedAt: numericTime(updatedAt) || Date.now()
  };
  try {
    target?.setItem(DAILY_ADVICE_CACHE_KEY, JSON.stringify(value));
    return value;
  } catch { return null; }
}

function mapItems(items) {
  return Object.fromEntries(normalizeAdviceBank(items).map(({ id, text, source, active, order, createdBy, createdAt }) => [id, {
    text, source, active, order, createdBy, createdAt
  }]));
}

function mergePending(baseItems, pending) {
  const byId = new Map(normalizeAdviceBank(baseItems).map(item => [item.id, item]));
  for (const operation of normalizePending(pending)) {
    if (operation.type === 'delete') byId.delete(operation.id);
    else byId.set(operation.id, operation.item);
  }
  return normalizeAdviceBank([...byId.values()]);
}

function moveItem(items, id, delta) {
  const rows = normalizeAdviceBank(items);
  const index = rows.findIndex(item => item.id === id);
  if (index < 0) return rows;
  const target = Math.max(0, Math.min(rows.length - 1, index + Math.trunc(Number(delta) || 0)));
  if (target === index) return rows;
  const [item] = rows.splice(index, 1);
  rows.splice(target, 0, item);
  return rows.map((entry, slot) => ({ ...entry, order: slot + 1 }));
}

export function createAdviceId({ crypto = globalThis.crypto, now = Date.now() } = {}) {
  try {
    const bytes = new Uint8Array(8);
    crypto?.getRandomValues?.(bytes);
    if (bytes.some(value => value !== 0)) return `ADV-${[...bytes].map(value => value.toString(16).padStart(2, '0')).join('')}`;
  } catch { /* use the collision-resistant time/random fallback below */ }
  return `ADV-${Number(now).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function canManageAdvice(role) {
  return ['admin', 'manager'].includes(String(role || '').trim().toLowerCase());
}

function validEditorClaims(claims, user) {
  return Boolean(user && !user.isAnonymous && claims &&
    ['admin', 'manager'].includes(claims.role) && claims.status === 'active' &&
    claims.mustChangePassword !== true);
}

/** Lazily reaches Firebase; anonymous sessions can read but cannot write. */
export async function createFirebaseAdviceAdapter({ allowAnonymous = true } = {}) {
  try {
    const [{ firebaseApp, appCheckReady }, services] = await Promise.all([
      import('../firebase/firebase-init.js'),
      import('../firebase/firebase-services.js')
    ]);
    await appCheckReady;
    const auth = services.getAuth(firebaseApp);
    if (typeof auth.authStateReady === 'function') await auth.authStateReady();
    if (!auth.currentUser && allowAnonymous) await services.signInAnonymously(auth);
    const db = services.getDatabase(firebaseApp);
    const bankRef = services.ref(db, DAILY_ADVICE_BANK_PATH);

    async function editorClaims() {
      const user = auth.currentUser;
      if (!user || user.isAnonymous || typeof user.getIdTokenResult !== 'function') return null;
      try {
        const token = await user.getIdTokenResult();
        return validEditorClaims(token?.claims, user) ? { uid: user.uid, claims: token.claims } : null;
      } catch { return null; }
    }

    async function transact(transform) {
      const actor = await editorClaims();
      if (!actor) return { ok: false, reason: 'role-required' };
      const result = await services.runTransaction(bankRef, current => {
        const records = normalizeAdviceBank(current);
        const next = transform(records, actor);
        return next === undefined ? undefined : mapItems(next);
      }, { applyLocally: false });
      return result?.committed
        ? { ok: true, bank: result.snapshot?.val() || {} }
        : { ok: false, reason: 'not-committed' };
    }

    return {
      subscribe(onValue, onError) {
        return services.onValue(bankRef, snapshot => onValue(snapshot.val()), onError);
      },
      async canWrite() { return Boolean(await editorClaims()); },
      async seedDefaults() {
        return transact((records, actor) => records.length ? records : DAILY_ADVICE_SEEDS.map(seed => ({
          ...seed,
          createdBy: actor.uid,
          createdAt: Date.now()
        })));
      },
      async save(item) {
        return transact((records, actor) => {
          const rows = [...records];
          const index = rows.findIndex(row => row.id === item.id);
          const previous = index >= 0 ? rows.splice(index, 1)[0] : null;
          const next = normalizeAdvice({
            ...item,
            order: previous ? item.order : rows.length + 1,
            createdBy: previous?.createdBy || actor.uid,
            createdAt: previous?.createdAt || item.createdAt || Date.now()
          });
          if (!next) return records;
          const target = Math.max(0, Math.min(rows.length, next.order - 1));
          rows.splice(target, 0, next);
          return rows.map((row, slot) => ({ ...row, order: slot + 1 }));
        });
      },
      async remove(id) {
        return transact(records => records.filter(item => item.id !== id)
          .map((item, slot) => ({ ...item, order: slot + 1 })));
      },
      async move(id, delta) {
        return transact(records => moveItem(records, id, delta));
      }
    };
  } catch {
    return null;
  }
}

function itemFromRemoteBank(bank) {
  return normalizeAdviceBank(bank);
}

/** Creates one observable cache-backed store for a hero and/or the editor. */
export function createAdviceStore({
  now = () => Date.now(),
  storage,
  adapterFactory = createFirebaseAdviceAdapter,
  autoConnect = true,
  autoDateRefresh = true,
  onChange = () => {}
} = {}) {
  const cached = readAdviceCache(storage);
  let pending = cached?.pending || [];
  let remoteLoaded = cached?.remoteLoaded === true;
  let remoteItems = remoteLoaded ? cached?.items || [] : [];
  let localItems = cached?.items || [];
  let source = cached?.items?.length ? 'cache' : 'fallback';
  let adapter = null;
  let unsubscribe = null;
  let stopped = false;
  let flushing = false;
  let lastDateKey = quoteDateKey(now());
  let dailyTimer = 0;

  const baseItems = () => remoteLoaded ? remoteItems : localItems;
  const visibleItems = () => mergePending(baseItems(), pending);

  function snapshot() {
    const dateKey = quoteDateKey(now());
    const items = visibleItems();
    return {
      items,
      advice: pickDailyAdvice(items, dateKey),
      dateKey,
      source,
      pendingCount: pending.length,
      remoteLoaded
    };
  }

  function publish(nextSource = source) {
    source = nextSource;
    const state = snapshot();
    writeAdviceCache({ items: state.items, pending, remoteLoaded, updatedAt: now() }, storage);
    try { onChange(state); } catch { /* presentation code must not break app boot */ }
    return state;
  }

  function putPending(operation) {
    pending = normalizePending([...pending.filter(entry => entry.id !== operation.id), operation]);
    if (!remoteLoaded) localItems = mergePending(localItems, [operation]);
    return publish(pending.length ? 'local-pending' : source);
  }

  async function flushPending(remote = adapter) {
    if (!remote || flushing || !pending.length) return false;
    flushing = true;
    try {
      if (!await remote.canWrite?.()) return false;
      const operations = [...pending].sort((a, b) => a.type === 'save' && b.type === 'save'
        ? a.item.order - b.item.order
        : a.id.localeCompare(b.id, 'en'));
      for (const operation of operations) {
        const result = operation.type === 'delete'
          ? await remote.remove(operation.id)
          : await remote.save(operation.item);
        if (!result?.ok) break;
        if (result.bank) remoteItems = itemFromRemoteBank(result.bank);
        else if (operation.type === 'delete') remoteItems = normalizeAdviceBank(remoteItems).filter(item => item.id !== operation.id);
        else remoteItems = normalizeAdviceBank([...normalizeAdviceBank(remoteItems).filter(item => item.id !== operation.id), operation.item]);
        pending = pending.filter(entry => !(entry.id === operation.id && entry.type === operation.type));
        remoteLoaded = true;
        publish('firebase');
      }
      return pending.length === 0;
    } catch { return false; }
    finally { flushing = false; }
  }

  async function connect() {
    if (stopped || !autoConnect) return null;
    if (adapter && typeof unsubscribe === 'function') return adapter;
    try {
      adapter = await adapterFactory({ allowAnonymous: true });
      if (!adapter || stopped) return null;
      unsubscribe = adapter.subscribe(bank => {
        if (stopped) return;
        remoteLoaded = true;
        remoteItems = itemFromRemoteBank(bank);
        publish('firebase');
        if (pending.length) void flushPending(adapter);
      }, () => {
        // A failed read leaves the last successful local cache on screen.
      });
      return adapter;
    } catch { return null; }
  }

  function save(input, role, { id = input?.id, uid = '' } = {}) {
    if (!canManageAdvice(role)) return Promise.resolve({ ok: false, reason: 'role-required' });
    const checked = validateAdviceText(input?.text);
    if (!checked.ok) return Promise.resolve({ ok: false, reason: 'invalid-text', error: checked.error });
    const safe = safeId(id) || createAdviceId({ now: now() });
    const allItems = visibleItems();
    if (allItems.some(item => item.id !== safe && cleanText(item.text) === checked.value)) {
      return Promise.resolve({ ok: false, reason: 'duplicate-text', error: 'একই পরামর্শ আগে থেকেই আছে।' });
    }
    const existing = allItems.find(item => item.id === safe);
    const timestamp = now();
    const requestedOrder = Number(input?.order);
    const item = normalizeAdvice({
      id: safe,
      text: checked.value,
      source: cleanSource(input?.source),
      active: input?.active !== false,
      order: existing?.order || (Number.isSafeInteger(requestedOrder) && requestedOrder > 0 ? requestedOrder : visibleItems().length + 1),
      createdBy: existing?.createdBy || String(uid || role),
      createdAt: existing?.createdAt || timestamp
    });
    if (!item) return Promise.resolve({ ok: false, reason: 'invalid-record' });
    putPending({ type: 'save', id: item.id, item });
    return (async () => {
      let remote = adapter;
      if (!remote || !await remote.canWrite?.()) {
        try { remote = await adapterFactory({ allowAnonymous: false }); } catch { remote = null; }
      }
      if (!remote || !await remote.canWrite?.()) {
        return { ok: true, synced: false, item, message: 'এই ডিভাইসে রাখা হয়েছে; অনলাইনে অনুমোদিত সেশন পেলে সিঙ্ক হবে।' };
      }
      try {
        const result = await remote.save(item);
        if (!result?.ok) return { ok: true, synced: false, item, message: 'এই ডিভাইসে রাখা হয়েছে; অনলাইন সিঙ্ক এখন সম্ভব নয়।' };
        if (result.bank) remoteItems = itemFromRemoteBank(result.bank);
        else remoteItems = normalizeAdviceBank([...normalizeAdviceBank(remoteItems).filter(row => row.id !== item.id), item]);
        pending = pending.filter(entry => entry.id !== item.id);
        remoteLoaded = true;
        publish('firebase');
        return { ok: true, synced: true, item: remoteItems.find(row => row.id === item.id) || item };
      } catch {
        return { ok: true, synced: false, item, message: 'এই ডিভাইসে রাখা হয়েছে; অনলাইন সিঙ্ক এখন সম্ভব নয়।' };
      }
    })();
  }

  function remove(id, role) {
    const safe = safeId(id);
    if (!canManageAdvice(role) || !safe) return Promise.resolve({ ok: false, reason: 'role-required' });
    putPending({ type: 'delete', id: safe });
    return (async () => {
      let remote = adapter;
      if (!remote || !await remote.canWrite?.()) {
        try { remote = await adapterFactory({ allowAnonymous: false }); } catch { remote = null; }
      }
      if (!remote || !await remote.canWrite?.()) {
        return { ok: true, synced: false, message: 'এই ডিভাইস থেকে সরানো হয়েছে; অনলাইনে অনুমোদিত সেশন পেলে সিঙ্ক হবে।' };
      }
      try {
        const result = await remote.remove(safe);
        if (!result?.ok) return { ok: true, synced: false, message: 'এই ডিভাইস থেকে সরানো হয়েছে; অনলাইন সিঙ্ক এখন সম্ভব নয়।' };
        if (result.bank) remoteItems = itemFromRemoteBank(result.bank);
        else remoteItems = normalizeAdviceBank(remoteItems).filter(item => item.id !== safe)
          .map((item, slot) => ({ ...item, order: slot + 1 }));
        pending = pending.filter(entry => entry.id !== safe);
        remoteLoaded = true;
        publish('firebase');
        return { ok: true, synced: true };
      } catch {
        return { ok: true, synced: false, message: 'এই ডিভাইস থেকে সরানো হয়েছে; অনলাইন সিঙ্ক এখন সম্ভব নয়।' };
      }
    })();
  }

  function move(id, delta, role) {
    if (!canManageAdvice(role) || !safeId(id)) return Promise.resolve({ ok: false, reason: 'role-required' });
    const before = visibleItems();
    const after = moveItem(before, id, delta);
    if (after.every((item, index) => item.id === before[index]?.id)) return Promise.resolve({ ok: true, changed: false, synced: true });
    for (const item of after) putPending({ type: 'save', id: item.id, item });
    return (async () => {
      let remote = adapter;
      if (!remote || !await remote.canWrite?.()) {
        try { remote = await adapterFactory({ allowAnonymous: false }); } catch { remote = null; }
      }
      if (!remote || !await remote.canWrite?.()) {
        return { ok: true, changed: true, synced: false, message: 'ক্রম এই ডিভাইসে রাখা হয়েছে; অনলাইনে অনুমোদিত সেশন পেলে সিঙ্ক হবে।' };
      }
      try {
        const result = typeof remote.move === 'function'
          ? await remote.move(id, delta)
          : { ok: false };
        if (!result?.ok) return { ok: true, changed: true, synced: false, message: 'ক্রম এই ডিভাইসে রাখা হয়েছে; অনলাইন সিঙ্ক এখন সম্ভব নয়।' };
        if (result.bank) remoteItems = itemFromRemoteBank(result.bank);
        pending = pending.filter(entry => !after.some(item => item.id === entry.id && entry.type === 'save'));
        remoteLoaded = true;
        publish('firebase');
        return { ok: true, changed: true, synced: true };
      } catch {
        return { ok: true, changed: true, synced: false, message: 'ক্রম এই ডিভাইসে রাখা হয়েছে; অনলাইন সিঙ্ক এখন সম্ভব নয়।' };
      }
    })();
  }

  async function seedDefaults(role) {
    if (!canManageAdvice(role)) return { ok: false, reason: 'role-required' };
    let remote = adapter;
    if (!remote || !await remote.canWrite?.()) {
      try { remote = await adapterFactory({ allowAnonymous: false }); } catch { remote = null; }
    }
    if (!remote || !await remote.canWrite?.() || typeof remote.seedDefaults !== 'function') {
      return { ok: false, reason: 'online-role-required' };
    }
    const result = await remote.seedDefaults();
    if (result?.ok) {
      remoteItems = itemFromRemoteBank(result.bank);
      remoteLoaded = true;
      publish('firebase');
    }
    return result;
  }

  function checkDate() {
    if (stopped) return;
    const dateKey = quoteDateKey(now());
    if (dateKey !== lastDateKey) {
      lastDateKey = dateKey;
      publish(source);
    }
  }
  function untilDhakaMidnight() {
    // Bangladesh uses UTC+06:00; calculate the next local midnight without
    // depending on the visitor device's timezone or requiring a reload.
    return millisecondsUntilDhakaMidnight(now());
  }
  function scheduleDateRefresh() {
    if (dailyTimer) globalThis.clearTimeout(dailyTimer);
    dailyTimer = 0;
    if (!autoDateRefresh || stopped || typeof globalThis.setTimeout !== 'function') return;
    dailyTimer = globalThis.setTimeout(() => {
      dailyTimer = 0;
      checkDate();
      scheduleDateRefresh();
    }, untilDhakaMidnight());
  }
  const documentRef = globalThis.document;
  const visibilityChange = () => {
    if (documentRef?.visibilityState !== 'hidden') {
      checkDate();
      scheduleDateRefresh();
    }
  };
  const focusChange = () => { checkDate(); scheduleDateRefresh(); };
  documentRef?.addEventListener?.('visibilitychange', visibilityChange);
  globalThis.addEventListener?.('focus', focusChange);

  publish(source);
  scheduleDateRefresh();
  const ready = connect();

  return {
    getSnapshot: snapshot,
    getItems: () => visibleItems(),
    save,
    remove,
    move,
    seedDefaults,
    ready,
    async refresh() {
      if (pending.length) return flushPending();
      return Boolean(await connect());
    },
    stop() {
      stopped = true;
      if (typeof unsubscribe === 'function') { try { unsubscribe(); } catch { /* no-op */ } }
      if (dailyTimer) globalThis.clearTimeout(dailyTimer);
      dailyTimer = 0;
      documentRef?.removeEventListener?.('visibilitychange', visibilityChange);
      globalThis.removeEventListener?.('focus', focusChange);
      unsubscribe = null;
    }
  };
}
