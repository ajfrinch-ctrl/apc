import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './jsdom-harness.mjs';
import { DAILY_ADVICE_SEEDS } from '../js/daily-advice.js';
import { initAdviceAdmin } from '../js/advice-admin.js';

const contexts = [];
after(() => contexts.forEach(ctx => ctx.window.close()));
const entry = (id = 'ADV-TEST', order = 1, overrides = {}) => ({
  id, text: `আজকের ছোট লক্ষ্য ${order} ঠিক করো।`, source: 'Active Plus Coaching', active: true,
  order, createdBy: 'seed', createdAt: order, ...overrides
});
function makeStoreFactory(initialItems = [entry()]) {
  const calls = { saves: [], removals: [], moves: [], seeds: [], stops: 0 };
  const state = { items: initialItems, advice: null, dateKey: '2026-10-17', source: 'cache', pendingCount: 0, remoteLoaded: false };
  const factory = ({ onChange }) => {
    const publish = () => onChange(structuredClone(state));
    publish();
    return {
      ready: Promise.resolve(),
      refresh: async () => true,
      async seedDefaults(role) { calls.seeds.push(role); return { ok: false }; },
      async save(values, role, options = {}) {
        calls.saves.push({ values: structuredClone(values), role, options: structuredClone(options) });
        const id = options.id || 'ADV-NEW';
        const existing = state.items.find(item => item.id === id);
        const saved = entry(id, existing?.order || state.items.length + 1, {
          ...existing, ...values, id, createdBy: existing?.createdBy || role,
          createdAt: existing?.createdAt || Date.now()
        });
        state.items = [...state.items.filter(item => item.id !== id), saved].sort((a, b) => a.order - b.order);
        state.pendingCount = 1;
        publish();
        return { ok: true, synced: false, message: 'অফলাইনে এই ডিভাইসে রাখা হয়েছে।' };
      },
      async remove(id, role) {
        calls.removals.push({ id, role });
        state.items = state.items.filter(item => item.id !== id).map((item, index) => ({ ...item, order: index + 1 }));
        state.pendingCount = 1;
        publish();
        return { ok: true, synced: false, message: 'অফলাইনে মুছে ফেলার অনুরোধ রাখা হয়েছে।' };
      },
      async move(id, delta, role) {
        calls.moves.push({ id, delta, role });
        const from = state.items.findIndex(item => item.id === id);
        const [item] = state.items.splice(from, 1);
        state.items.splice(Math.max(0, Math.min(state.items.length, from + delta)), 0, item);
        state.items = state.items.map((row, index) => ({ ...row, order: index + 1 }));
        state.pendingCount = 1;
        publish();
        return { ok: true, changed: true, synced: false, message: 'ক্রম অফলাইনে রাখা হয়েছে।' };
      },
      stop() { calls.stops++; }
    };
  };
  return { factory, calls, state };
}
async function makePage(page, selector, role, store = makeStoreFactory()) {
  const ctx = await loadPage(page); contexts.push(ctx);
  const root = ctx.$(selector);
  const editor = initAdviceAdmin(root, { role, storeFactory: store.factory });
  await ctx.flush();
  return { ctx, root, editor, ...store };
}

test('only Admin and Manager roles can mount the editor; existing page routes remain static', async () => {
  const unauthorized = await loadPage('manager.html'); contexts.push(unauthorized);
  const mount = unauthorized.$('[data-advice-admin]');
  const before = mount.innerHTML;
  const denied = initAdviceAdmin(mount, { role: 'teacher', storeFactory: () => { throw new Error('must not open a store'); } });
  assert.equal(mount.innerHTML, before);
  assert.notEqual(mount.dataset.adviceEditorReady, '1');
  assert.equal(await denied.refresh(), false);

  const admin = await makePage('admin.html', '[data-advice-admin]', 'admin');
  assert.ok(admin.root.querySelector('[data-advice-list]'));
  assert.deepEqual(admin.calls.seeds, ['admin']);
  const manager = await makePage('manager.html', '[data-advice-admin]', 'manager');
  assert.ok(manager.root.querySelector('[data-advice-list]'));
  assert.deepEqual(manager.calls.seeds, ['manager']);
  assert.deepEqual([...admin.ctx.$$('.admin-bottom-item')].map(item => item.dataset.panelView), ['dashboard', 'staff', 'reports', 'system', 'more']);
  assert.deepEqual([...manager.ctx.$$('.admin-bottom-item')].map(item => item.dataset.panelView), ['dashboard', 'students', 'academic', 'finance', 'more']);
  admin.editor.stop(); manager.editor.stop();
});

test('editor renders ordered today/tomorrow badges and an accessible 0/140 form without pin controls', async () => {
  const rows = [entry('ADV-001', 1), entry('ADV-002', 2)];
  const { ctx, root, editor } = await makePage('admin.html', '[data-advice-admin]', 'admin', makeStoreFactory(rows));
  const cards = root.querySelectorAll('[data-advice-id]');
  assert.equal(cards.length, 2);
  assert.equal(cards[0].dataset.adviceId, 'ADV-001');
  assert.match(cards[0].textContent, /আজকের উপদেশ/u);
  assert.match(cards[1].textContent, /আগামীকাল দেখাবে/u);
  assert.match(root.querySelector('[data-advice-status]').textContent, /এই ডিভাইসে ব্যবহারযোগ্য/u);
  ctx.click(root.querySelector('[data-advice-new]'));
  const form = root.querySelector('[data-advice-form]');
  const text = root.querySelector('[data-advice-text]');
  assert.equal(form.hidden, false);
  assert.equal(text.maxLength, 140);
  assert.equal(root.querySelector('label[for="adminAdviceText"]').textContent, 'পরামর্শ');
  assert.match(root.querySelector('[data-advice-count]').textContent, /^০\/১৪০$/u);
  assert.equal(root.querySelector('[data-advice-pinned]'), null);
  ctx.type(text, 'ক'.repeat(140));
  assert.match(root.querySelector('[data-advice-count]').textContent, /^১৪০\/১৪০$/u);
  assert.equal(DAILY_ADVICE_SEEDS.length, 5);
  editor.stop();
});

test('tomorrow badge skips an active duplicate text so it matches the daily picker', async () => {
  const rows = [
    entry('ADV-001', 1, { text: 'একই উপদেশ।' }),
    entry('ADV-002', 2, { text: 'একই উপদেশ।' }),
    entry('ADV-003', 3, { text: 'পরের আলাদা উপদেশ।' })
  ];
  const { root, editor } = await makePage('admin.html', '[data-advice-admin]', 'admin', makeStoreFactory(rows));
  assert.match(root.querySelector('[data-advice-id="ADV-001"]').textContent, /আজকের উপদেশ/u);
  assert.doesNotMatch(root.querySelector('[data-advice-id="ADV-002"]').textContent, /আগামীকাল দেখাবে/u);
  assert.match(root.querySelector('[data-advice-id="ADV-003"]').textContent, /আগামীকাল দেখাবে/u);
  editor.stop();
});

test('validation blocks blank and 141-character text; edit saves text, source and active state only', async () => {
  const store = makeStoreFactory([entry()]);
  const { ctx, root, editor, calls } = await makePage('admin.html', '[data-advice-admin]', 'admin', store);
  ctx.click(root.querySelector('[data-advice-new]'));
  const form = root.querySelector('[data-advice-form]');
  const text = root.querySelector('[data-advice-text]');
  ctx.submit(form);
  await ctx.flush();
  assert.equal(root.querySelector('[data-advice-error]').hidden, false);
  assert.equal(root.querySelector('[data-advice-error]').textContent, 'পরামর্শ লিখুন।');
  ctx.type(text, 'ক'.repeat(141));
  ctx.submit(form);
  await ctx.flush();
  assert.match(root.querySelector('[data-advice-error]').textContent, /১৪০ অক্ষরের মধ্যে/u);
  assert.equal(calls.saves.length, 0);

  ctx.click(root.querySelector('[data-advice-cancel]'));
  const originalEdit = root.querySelector('[data-advice-action="edit"]');
  ctx.click(originalEdit);
  assert.equal(originalEdit.disabled, false, 'opening an edit does not leave the list action disabled');
  ctx.click(root.querySelector('[data-advice-cancel]'));
  const reopenedEdit = root.querySelector('[data-advice-action="edit"]');
  assert.equal(reopenedEdit.disabled, false, 'canceling an edit keeps it available for a later try');
  ctx.click(reopenedEdit);
  assert.equal(root.querySelector('[data-advice-form-title]').textContent, 'পরামর্শ সম্পাদনা');
  ctx.type(text, 'নিয়মিত অনুশীলনে আরও ভালো শেখা যায়।');
  ctx.type(root.querySelector('[data-advice-source]'), 'Active Plus Coaching');
  root.querySelector('[data-advice-active]').checked = false;
  ctx.submit(form);
  await ctx.flush();
  assert.equal(calls.saves.length, 1);
  assert.equal(calls.saves[0].role, 'admin');
  assert.equal(calls.saves[0].options.id, 'ADV-TEST');
  assert.equal(calls.saves[0].values.text, 'নিয়মিত অনুশীলনে আরও ভালো শেখা যায়।');
  assert.equal(calls.saves[0].values.source, 'Active Plus Coaching');
  assert.equal(calls.saves[0].values.active, false);
  assert.equal(Object.hasOwn(calls.saves[0].values, 'pinned'), false);
  assert.equal(form.hidden, true);
  assert.match(root.querySelector('[data-advice-status]').textContent, /এই ডিভাইসে রাখা হয়েছে/u);
  editor.stop();
});

test('active toggle and reorder update the ordered list through the Manager store', async () => {
  const store = makeStoreFactory([entry('ADV-001', 1), entry('ADV-002', 2), entry('ADV-003', 3)]);
  const { ctx, root, editor, calls } = await makePage('manager.html', '[data-advice-admin]', 'manager', store);
  const down = root.querySelector('[data-advice-action="move-down"][data-id="ADV-001"]');
  ctx.click(down);
  await ctx.flush();
  assert.deepEqual(calls.moves, [{ id: 'ADV-001', delta: 1, role: 'manager' }]);
  assert.deepEqual([...root.querySelectorAll('[data-advice-id]')].map(card => card.dataset.adviceId), ['ADV-002', 'ADV-001', 'ADV-003']);
  ctx.click(root.querySelector('[data-advice-action="toggle"][data-id="ADV-002"]'));
  await ctx.flush();
  assert.equal(store.state.items.find(item => item.id === 'ADV-002').active, false);
  assert.match(root.querySelector('[data-advice-status]').textContent, /এই ডিভাইসে রাখা হয়েছে/u);
  editor.stop();
});

test('deletion asks for confirmation, applies to the store and keeps the role scope', async () => {
  const store = makeStoreFactory([entry()]);
  const { ctx, root, editor, calls } = await makePage('manager.html', '[data-advice-admin]', 'manager', store);
  const originalConfirm = globalThis.confirm;
  globalThis.confirm = () => true;
  try {
    ctx.click(root.querySelector('[data-advice-action="delete"]'));
    await ctx.flush();
    assert.deepEqual(calls.removals, [{ id: 'ADV-TEST', role: 'manager' }]);
    assert.equal(root.querySelector('[data-advice-list] [data-advice-id]'), null);
    assert.match(root.querySelector('[data-advice-status]').textContent, /মুছে ফেলার অনুরোধ/u);
  } finally {
    if (originalConfirm === undefined) delete globalThis.confirm;
    else globalThis.confirm = originalConfirm;
    editor.stop();
  }
});
