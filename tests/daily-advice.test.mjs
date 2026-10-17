import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DAILY_ADVICE_CACHE_KEY, DAILY_ADVICE_FALLBACK, DAILY_ADVICE_MAX_LENGTH,
  DAILY_ADVICE_SEEDS, LEGACY_DAILY_ADVICE_CACHE_KEY,
  canManageAdvice, createAdviceStore, millisecondsUntilDhakaMidnight,
  normalizeAdvice, normalizeAdviceBank, pickDailyAdvice,
  readAdviceCache, validateAdviceText, writeAdviceCache
} from '../js/daily-advice.js';
import { quoteDateKey } from '../js/daily-quote.js';

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    entries() { return [...values.entries()]; }
  };
}

const entry = (id, text, order, overrides = {}) => ({
  id, text, source: 'Active Plus Coaching', active: true, order,
  createdBy: 'manager-1', createdAt: order, ...overrides
});

test('the five exact Bengali seed records include Active Plus Coaching and match the offline asset', () => {
  const feed = JSON.parse(readFileSync(new URL('../assets/daily-advice.json', import.meta.url), 'utf8'));
  assert.equal(DAILY_ADVICE_SEEDS.length, 5);
  assert.equal(feed.items.length, 5);
  assert.equal(feed.version, 2);
  assert.equal(feed.timeZone, 'Asia/Dhaka');
  assert.equal(feed.maxLength, DAILY_ADVICE_MAX_LENGTH);
  assert.deepEqual(feed.items, DAILY_ADVICE_SEEDS);
  assert.ok(DAILY_ADVICE_SEEDS.every(item => item.source === 'Active Plus Coaching' && item.active && item.text.length <= DAILY_ADVICE_MAX_LENGTH));
});

test('Dhaka date selection is deterministic from 2026-10-17, ordered, cyclic and duplicate-free', () => {
  assert.equal(quoteDateKey('2026-10-17T17:59:59.000Z'), '2026-10-17');
  assert.equal(quoteDateKey('2026-10-17T18:00:00.000Z'), '2026-10-18');
  const entries = [
    entry('ADV-001', 'প্রথম উপদেশ।', 1),
    entry('ADV-002', 'প্রথম উপদেশ।', 2), // duplicate text is not selected twice
    entry('ADV-003', 'নিষ্ক্রিয় উপদেশ।', 3, { active: false }),
    entry('ADV-004', 'দ্বিতীয় উপদেশ।', 4),
    entry('ADV-005', 'তৃতীয় উপদেশ।', 5)
  ];
  assert.equal(pickDailyAdvice(entries, '2026-10-17').id, 'ADV-001');
  assert.equal(pickDailyAdvice(entries, '2026-10-18').id, 'ADV-004');
  assert.equal(pickDailyAdvice(entries, '2026-10-19').id, 'ADV-005');
  assert.equal(pickDailyAdvice(entries, '2026-10-20').id, 'ADV-001', 'the ordered active list loops');
  assert.deepEqual(pickDailyAdvice(entries, '2026-10-17'), pickDailyAdvice(entries, '2026-10-17'));
  assert.deepEqual(pickDailyAdvice([], '2026-10-17'), DAILY_ADVICE_FALLBACK);
});

test('the next local midnight timer follows Dhaka time, not the device timezone', () => {
  assert.equal(millisecondsUntilDhakaMidnight('2026-10-17T17:59:59.000Z'), 1025);
  assert.equal(millisecondsUntilDhakaMidnight('2026-10-17T18:00:00.000Z'), 86_400_025);
});

test('bank normalizer reads the direct RTDB map and migrates the legacy wrapper without pin fields', () => {
  const direct = {
    'ADV-002': { text: 'দ্বিতীয়।', source: 'Active Plus Coaching', active: true, order: 2, createdBy: 'm1', createdAt: 2 },
    'ADV-001': { text: 'প্রথম।', source: 'Active Plus Coaching', active: true, order: 1, createdBy: 'm1', createdAt: 1 }
  };
  assert.deepEqual(normalizeAdviceBank(direct).map(({ id, order }) => ({ id, order })), [
    { id: 'ADV-001', order: 1 }, { id: 'ADV-002', order: 2 }
  ]);
  const legacy = { meta: { schemaVersion: 1 }, items: {
    'ADV-LEGACY': { id: 'ADV-LEGACY', text: 'পুরোনো পরামর্শ।', active: true, pinned: true, pinnedDateKey: '2026-10-17', order: 1 }
  } };
  const [migrated] = normalizeAdviceBank(legacy);
  assert.equal(migrated.id, 'ADV-LEGACY');
  assert.equal(migrated.text, 'পুরোনো পরামর্শ।');
  assert.equal(Object.hasOwn(migrated, 'pinned'), false);
  assert.equal(Object.hasOwn(migrated, 'pinnedDateKey'), false);
});

test('validation rejects blank, overlong and malformed IDs without truncating', () => {
  assert.equal(validateAdviceText('   ').ok, false);
  assert.equal(validateAdviceText(' ক '.repeat(2)).value, 'ক ক');
  assert.equal(validateAdviceText('ক'.repeat(DAILY_ADVICE_MAX_LENGTH)).ok, true);
  assert.equal(validateAdviceText('ক'.repeat(DAILY_ADVICE_MAX_LENGTH + 1)).ok, false);
  assert.equal(normalizeAdvice({ id: 'ADV-TOO-LONG', text: 'ক'.repeat(141) }), null);
  assert.equal(normalizeAdvice({ id: 'bad/id', text: 'ঠিক আছে' }), null);
  assert.equal(normalizeAdviceBank([{ id: 'ADV-1', text: 'এক' }, { id: 'ADV-1', text: 'দুই' }]).length, 1);
});

test('cache is additive, isolated and validates its own versioned record', () => {
  const storage = memoryStorage({ 'activePlus.admin.students.v1': 'do-not-touch' });
  const cached = writeAdviceCache({ items: DAILY_ADVICE_SEEDS, pending: [] }, storage);
  assert.equal(cached.items.length, 5);
  assert.equal(storage.getItem('activePlus.admin.students.v1'), 'do-not-touch');
  assert.ok(storage.getItem(DAILY_ADVICE_CACHE_KEY));
  assert.equal(readAdviceCache(storage).items.length, 5);
  storage.setItem(DAILY_ADVICE_CACHE_KEY, '{broken');
  assert.equal(readAdviceCache(storage), null);
  storage.setItem(DAILY_ADVICE_CACHE_KEY, JSON.stringify({ version: 999, items: [] }));
  assert.equal(readAdviceCache(storage), null);
});

test('legacy advice cache remains readable and is normalized into the new cache without deleting other data', () => {
  const legacyValue = { version: 1, remoteLoaded: true, items: [
    { id: 'ADV-OLD', text: 'পুরোনো দিনের উপদেশ।', active: true, pinned: true, pinnedDateKey: '2026-10-17', order: 1 }
  ] };
  const storage = memoryStorage({
    [LEGACY_DAILY_ADVICE_CACHE_KEY]: JSON.stringify(legacyValue),
    'activePlus.admin.transactions.v1': '[{"id":"TX-1"}]'
  });
  const cache = readAdviceCache(storage);
  assert.equal(cache.items[0].id, 'ADV-OLD');
  assert.equal(Object.hasOwn(cache.items[0], 'pinned'), false);
  writeAdviceCache(cache, storage);
  assert.ok(storage.getItem(LEGACY_DAILY_ADVICE_CACHE_KEY), 'migration does not delete the old cache key');
  assert.equal(storage.getItem('activePlus.admin.transactions.v1'), '[{"id":"TX-1"}]');
});

test('offline store shows only its fixed fallback until a bank is cached, and queues local edits safely', async () => {
  const storage = memoryStorage({ 'activePlus.admin.transactions.v1': '[{"id":"TX-1"}]' });
  const store = createAdviceStore({ storage, autoConnect: false, autoDateRefresh: false, adapterFactory: async () => null });
  assert.equal(store.getSnapshot().items.length, 0);
  assert.deepEqual(store.getSnapshot().advice, DAILY_ADVICE_FALLBACK);
  const saved = await store.save({ text: 'নিজের গতিতে নিয়মিত শিখে চলো।', source: 'Active Plus Coaching', active: true }, 'manager', { id: 'ADV-LOCAL' });
  assert.equal(saved.ok, true);
  assert.equal(saved.synced, false);
  assert.equal(store.getSnapshot().items.some(item => item.id === 'ADV-LOCAL'), true);
  assert.equal(store.getSnapshot().pendingCount, 1);
  const duplicate = await store.save({ text: 'নিজের গতিতে নিয়মিত শিখে চলো।', active: true }, 'manager', { id: 'ADV-DUPLICATE' });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.reason, 'duplicate-text');
  const removed = await store.remove('ADV-LOCAL', 'manager');
  assert.equal(removed.ok, true);
  assert.equal(store.getSnapshot().items.some(item => item.id === 'ADV-LOCAL'), false);
  assert.equal(store.getSnapshot().pendingCount, 1, 'save then delete collapse to one queued delete');
  assert.equal(storage.getItem('activePlus.admin.transactions.v1'), '[{"id":"TX-1"}]');
  assert.equal(readAdviceCache(storage).pending[0].type, 'delete');
  store.stop();
});

test('only Admin/Manager sessions can request edits; remote writes still require Firebase claims', async () => {
  assert.equal(canManageAdvice('admin'), true);
  assert.equal(canManageAdvice('manager'), true);
  assert.equal(canManageAdvice('teacher'), false);
  let writes = 0;
  const adapter = {
    async canWrite() { return false; },
    async save() { writes++; return { ok: true }; }
  };
  const store = createAdviceStore({ storage: memoryStorage(), autoConnect: false, autoDateRefresh: false,
    adapterFactory: async () => adapter });
  const denied = await store.save({ text: 'কাজ শুরু করো।' }, 'teacher');
  assert.equal(denied.ok, false);
  const local = await store.save({ text: 'কাজ শুরু করো।' }, 'admin', { id: 'ADV-LOCAL-2' });
  assert.equal(local.ok, true);
  assert.equal(local.synced, false);
  assert.equal(writes, 0, 'no Firebase write attempt without active Admin/Manager claims');
  store.stop();
});

test('an active claimed adapter writes the direct keyed schema and clears the local retry queue', async () => {
  const storage = memoryStorage();
  const bank = {};
  const adapter = {
    async canWrite() { return true; },
    async save(item) {
      const { id, ...record } = item;
      bank[id] = record;
      return { ok: true, bank: structuredClone(bank) };
    },
    async remove(id) {
      delete bank[id];
      return { ok: true, bank: structuredClone(bank) };
    },
    async move(id, delta) {
      const items = normalizeAdviceBank(bank);
      const from = items.findIndex(item => item.id === id);
      const [item] = items.splice(from, 1);
      items.splice(Math.max(0, Math.min(items.length, from + delta)), 0, item);
      for (const { id: key, ...record } of items.map((row, index) => ({ ...row, order: index + 1 }))) bank[key] = record;
      return { ok: true, bank: structuredClone(bank) };
    },
    async seedDefaults() {
      if (!Object.keys(bank).length) {
        for (const { id, ...record } of DAILY_ADVICE_SEEDS) bank[id] = record;
      }
      return { ok: true, bank: structuredClone(bank) };
    }
  };
  const store = createAdviceStore({ storage, autoConnect: false, autoDateRefresh: false, adapterFactory: async () => adapter });
  const result = await store.save({ text: 'অনুশীলনই আত্মবিশ্বাস বাড়ায়।', source: 'Active Plus Coaching', active: true }, 'manager', { id: 'ADV-CLOUD' });
  assert.equal(result.ok, true);
  assert.equal(result.synced, true);
  assert.equal(store.getSnapshot().pendingCount, 0);
  assert.equal(store.getSnapshot().source, 'firebase');
  assert.equal(store.getSnapshot().items.find(item => item.id === 'ADV-CLOUD').text, 'অনুশীলনই আত্মবিশ্বাস বাড়ায়।');
  assert.deepEqual(Object.keys(bank['ADV-CLOUD']).sort(), ['active', 'createdAt', 'createdBy', 'order', 'source', 'text']);
  assert.equal(Object.hasOwn(bank['ADV-CLOUD'], 'id'), false);
  assert.equal(Object.hasOwn(bank['ADV-CLOUD'], 'pinned'), false);
  assert.equal(readAdviceCache(storage).pending.length, 0);
  const seeded = await store.seedDefaults('admin');
  assert.equal(seeded.ok, true);
  assert.equal(store.getSnapshot().items.some(item => item.id === 'ADV-001'), false, 'non-empty bank is never overwritten by seed data');
  store.stop();
});
