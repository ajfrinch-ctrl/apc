import { createAdviceStore, DAILY_ADVICE_MAX_LENGTH, DAILY_ADVICE_SOURCE_MAX_LENGTH, canManageAdvice, pickDailyAdvice } from './daily-advice.js';

const bn = value => String(value).replace(/\d/g, digit => '০১২৩৪৫৬৭৮৯'[Number(digit)]);

function element(tag, className, text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** Admin/Manager-only editor; Firebase Rules remain authoritative for writes. */
export function initAdviceAdmin(rootOrSelector, { role, storeFactory = createAdviceStore } = {}) {
  const root = typeof rootOrSelector === 'string' ? document.querySelector(rootOrSelector) : rootOrSelector;
  const normalizedRole = String(role || root?.dataset?.adviceRole || '').trim().toLowerCase();
  if (!root || !canManageAdvice(normalizedRole) || root.dataset.adviceEditorReady === '1') {
    return { refresh: async () => false, stop() {} };
  }
  root.dataset.adviceEditorReady = '1';

  root.innerHTML = `<div class="advice-admin-toolbar">
      <div><h2>দৈনিক পরামর্শ</h2><p>ক্রম অনুযায়ী সাজানো পরামর্শ যোগ, সম্পাদনা ও প্রকাশ নিয়ন্ত্রণ করুন।</p></div>
      <button class="btn primary" type="button" data-advice-new>নতুন পরামর্শ</button>
    </div>
    <p class="advice-admin-status" data-advice-status role="status" aria-live="polite"></p>
    <form class="card advice-admin-form" data-advice-form hidden novalidate>
      <h3 data-advice-form-title>নতুন পরামর্শ</h3>
      <label class="advice-admin-label" for="${normalizedRole}AdviceText">পরামর্শ</label>
      <textarea id="${normalizedRole}AdviceText" name="text" data-advice-text maxlength="${DAILY_ADVICE_MAX_LENGTH}" rows="3" required></textarea>
      <div class="advice-admin-form-meta"><span data-advice-count>০/${bn(DAILY_ADVICE_MAX_LENGTH)}</span></div>
      <label class="advice-admin-label" for="${normalizedRole}AdviceSource">উৎস</label>
      <input id="${normalizedRole}AdviceSource" name="source" data-advice-source type="text" maxlength="${DAILY_ADVICE_SOURCE_MAX_LENGTH}" value="Active Plus Coaching" required>
      <label class="advice-admin-check"><input type="checkbox" name="active" data-advice-active checked> প্রকাশিত</label>
      <p class="advice-admin-error" data-advice-error role="alert" hidden></p>
      <div class="advice-admin-actions"><button class="btn primary" type="submit">সংরক্ষণ করুন</button><button class="btn ghost" type="button" data-advice-cancel>বাতিল</button></div>
    </form>
    <div class="advice-admin-list" data-advice-list aria-label="সংরক্ষিত পরামর্শ"></div>`;

  const form = root.querySelector('[data-advice-form]');
  const text = root.querySelector('[data-advice-text]');
  const source = root.querySelector('[data-advice-source]');
  const count = root.querySelector('[data-advice-count]');
  const status = root.querySelector('[data-advice-status]');
  const list = root.querySelector('[data-advice-list]');
  const error = root.querySelector('[data-advice-error]');
  let snapshot = { items: [], advice: null, dateKey: '', source: 'fallback', pendingCount: 0, remoteLoaded: false };
  let editingId = '';
  let statusOverride = '';
  let statusTimer = 0;

  function setStatus(message, tone = 'neutral') {
    status.textContent = message;
    status.dataset.tone = tone;
    statusOverride = message;
    globalThis.clearTimeout(statusTimer);
    statusTimer = globalThis.setTimeout(() => { statusOverride = ''; renderStatus(); }, 5000);
  }

  function renderStatus() {
    if (statusOverride) return;
    if (snapshot.pendingCount) {
      status.textContent = 'এই ডিভাইসের পরিবর্তন অনলাইন অনুমোদিত সেশনের অপেক্ষায় আছে।';
      status.dataset.tone = 'pending';
    } else if (snapshot.source === 'firebase') {
      status.textContent = 'অনলাইন পরামর্শ-তালিকা হালনাগাদ আছে।';
      status.dataset.tone = 'online';
    } else {
      status.textContent = 'শেষ সংরক্ষিত তালিকা এই ডিভাইসে ব্যবহারযোগ্য।';
      status.dataset.tone = 'offline';
    }
  }

  function todayAndTomorrow() {
    const seenText = new Set();
    const active = snapshot.items.filter(item => item.active).sort((a, b) => a.order - b.order).filter(item => {
      const text = String(item.text || '').normalize('NFC').replace(/\s+/g, ' ').trim();
      if (!text || seenText.has(text)) return false;
      seenText.add(text);
      return true;
    });
    if (!active.length) return { today: '', tomorrow: '' };
    const todayAdvice = pickDailyAdvice(active, snapshot.dateKey);
    const index = active.findIndex(item => item.id === todayAdvice.id);
    return {
      today: todayAdvice.id || '',
      tomorrow: active[(Math.max(index, 0) + 1) % active.length]?.id || ''
    };
  }

  function renderList() {
    const items = [...snapshot.items].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id, 'en'));
    const { today, tomorrow } = todayAndTomorrow();
    list.replaceChildren();
    if (!items.length) {
      list.append(element('p', 'empty advice-admin-empty', 'এখনো কোনো পরামর্শ নেই। নতুন পরামর্শ যোগ করুন।'));
      return;
    }
    for (const item of items) {
      const card = element('article', 'card advice-admin-item');
      card.dataset.adviceId = item.id;
      const header = element('div', 'advice-admin-item-head');
      const order = element('span', 'advice-order-badge', bn(item.order));
      order.setAttribute('aria-label', `ক্রম ${bn(item.order)}`);
      const stateBadge = element('span', `badge ${item.active ? 'advice-badge-active' : 'advice-badge-inactive'}`, item.active ? 'প্রকাশিত' : 'নিষ্ক্রিয়');
      header.append(order, stateBadge);
      if (item.id === today) header.append(element('span', 'badge advice-badge-today', 'আজকের উপদেশ'));
      if (item.id === tomorrow && item.id !== today) header.append(element('span', 'badge advice-badge-next', 'আগামীকাল দেখাবে'));

      const content = element('p', 'advice-admin-item-text', item.text);
      const attribution = element('p', 'advice-admin-item-source', item.source);
      const actions = element('div', 'advice-admin-item-actions');
      const toggle = element('button', 'btn secondary', item.active ? 'নিষ্ক্রিয় করুন' : 'সক্রিয় করুন');
      toggle.type = 'button'; toggle.dataset.adviceAction = 'toggle'; toggle.dataset.id = item.id;
      toggle.setAttribute('aria-label', `${item.active ? 'নিষ্ক্রিয়' : 'সক্রিয়'} করুন: ${item.text}`);
      const edit = element('button', 'btn secondary', 'সম্পাদনা');
      edit.type = 'button'; edit.dataset.adviceAction = 'edit'; edit.dataset.id = item.id;
      const up = element('button', 'btn secondary advice-order-button', 'উপরে');
      up.type = 'button'; up.dataset.adviceAction = 'move-up'; up.dataset.id = item.id;
      up.disabled = item.order <= 1;
      up.setAttribute('aria-label', `উপদেশ ${bn(item.order)} উপরে নিন`);
      const down = element('button', 'btn secondary advice-order-button', 'নিচে');
      down.type = 'button'; down.dataset.adviceAction = 'move-down'; down.dataset.id = item.id;
      down.disabled = item.order >= items.length;
      down.setAttribute('aria-label', `উপদেশ ${bn(item.order)} নিচে নিন`);
      const remove = element('button', 'btn danger', 'মুছুন');
      remove.type = 'button'; remove.dataset.adviceAction = 'delete'; remove.dataset.id = item.id;
      actions.append(toggle, edit, up, down, remove);
      card.append(header, content, attribution, actions);
      list.append(card);
    }
  }

  function render() {
    renderList();
    renderStatus();
  }

  const store = storeFactory({
    onChange(value) {
      snapshot = value;
      render();
    }
  });

  function updateCount() { count.textContent = `${bn(text.value.length)}/${bn(DAILY_ADVICE_MAX_LENGTH)}`; }
  function clearForm() {
    form.reset();
    editingId = '';
    error.hidden = true;
    error.textContent = '';
    root.querySelector('[data-advice-form-title]').textContent = 'নতুন পরামর্শ';
    updateCount();
    form.hidden = true;
  }
  function edit(item) {
    editingId = item.id;
    text.value = item.text;
    source.value = item.source;
    root.querySelector('[data-advice-active]').checked = item.active;
    root.querySelector('[data-advice-form-title]').textContent = 'পরামর্শ সম্পাদনা';
    error.hidden = true;
    error.textContent = '';
    form.hidden = false;
    updateCount();
    text.focus();
  }

  root.querySelector('[data-advice-new]').addEventListener('click', () => {
    clearForm();
    form.hidden = false;
    text.focus();
  });
  root.querySelector('[data-advice-cancel]').addEventListener('click', clearForm);
  text.addEventListener('input', updateCount);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const value = text.value.normalize('NFC').replace(/\s+/g, ' ').trim();
    const from = source.value.normalize('NFC').replace(/\s+/g, ' ').trim();
    if (!value || value.length > DAILY_ADVICE_MAX_LENGTH) {
      error.textContent = !value ? 'পরামর্শ লিখুন।' : `পরামর্শ ${bn(DAILY_ADVICE_MAX_LENGTH)} অক্ষরের মধ্যে রাখুন।`;
      error.hidden = false;
      text.focus();
      return;
    }
    if (!from || from.length > DAILY_ADVICE_SOURCE_MAX_LENGTH) {
      error.textContent = !from ? 'উৎস লিখুন।' : `উৎস ${bn(DAILY_ADVICE_SOURCE_MAX_LENGTH)} অক্ষরের মধ্যে রাখুন।`;
      error.hidden = false;
      source.focus();
      return;
    }
    const saveButton = form.querySelector('[type="submit"]');
    saveButton.disabled = true;
    const result = await store.save({
      text: value,
      source: from,
      active: root.querySelector('[data-advice-active]').checked
    }, normalizedRole, { id: editingId });
    saveButton.disabled = false;
    if (!result.ok) {
      error.textContent = result.error || 'পরামর্শ সংরক্ষণ করা যায়নি।';
      error.hidden = false;
      return;
    }
    clearForm();
    setStatus(result.synced ? 'পরামর্শ অনলাইন ব্যাংকে সংরক্ষিত হয়েছে।' : result.message, result.synced ? 'online' : 'pending');
  });

  list.addEventListener('click', async event => {
    const button = event.target.closest('[data-advice-action]');
    if (!button || button.disabled) return;
    const item = snapshot.items.find(row => row.id === button.dataset.id);
    if (!item) return;
    button.disabled = true;
    let result;
    if (button.dataset.adviceAction === 'edit') { button.disabled = false; edit(item); return; }
    if (button.dataset.adviceAction === 'toggle') {
      result = await store.save({ ...item, active: !item.active }, normalizedRole, { id: item.id });
      if (result.ok) setStatus(result.synced ? 'প্রকাশনার অবস্থা হালনাগাদ হয়েছে।' : result.message, result.synced ? 'online' : 'pending');
      else { button.disabled = false; setStatus('প্রকাশনার অবস্থা বদলানো যায়নি।', 'error'); }
      return;
    }
    if (button.dataset.adviceAction === 'move-up' || button.dataset.adviceAction === 'move-down') {
      const delta = button.dataset.adviceAction === 'move-up' ? -1 : 1;
      result = await store.move(item.id, delta, normalizedRole);
      if (result.ok) setStatus(result.synced ? 'পরামর্শের ক্রম বদলানো হয়েছে।' : result.message, result.synced ? 'online' : 'pending');
      else { button.disabled = false; setStatus('পরামর্শের ক্রম বদলানো যায়নি।', 'error'); }
      return;
    }
    if (button.dataset.adviceAction !== 'delete') { button.disabled = false; return; }
    if (!globalThis.confirm?.('এই পরামর্শটি সরিয়ে ফেলবেন?')) { button.disabled = false; return; }
    result = await store.remove(item.id, normalizedRole);
    if (!result.ok) { button.disabled = false; setStatus('পরামর্শটি সরানো যায়নি।', 'error'); return; }
    if (editingId === item.id) clearForm();
    setStatus(result.synced ? 'পরামর্শ অনলাইন ব্যাংক থেকে সরানো হয়েছে।' : result.message, result.synced ? 'online' : 'pending');
  });

  const stop = () => {
    store.stop?.();
    globalThis.clearTimeout(statusTimer);
  };
  globalThis.addEventListener?.('pagehide', stop, { once: true });
  void store.ready?.then(async () => {
    const seeded = await store.seedDefaults(normalizedRole);
    if (seeded?.ok) setStatus('প্রাথমিক পরামর্শ-তালিকা প্রস্তুত।', 'online');
    render();
  });
  updateCount();
  render();
  return { store, refresh: () => store.refresh(), stop };
}
