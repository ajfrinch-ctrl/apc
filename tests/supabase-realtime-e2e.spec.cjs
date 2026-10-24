/* End-to-end browser verification of Supabase Realtime Sync (Active Plus Coaching: cgtdnwktzcroxeioeyfq).
   Verifies that real browser portals select `data-cloud-provider="supabase"` automatically,
   reach green synced state (`rgb(14, 159, 110)`), sync notices across browser contexts,
   and relay AES-256-GCM encrypted Class Chat messages end-to-end through Supabase RPCs. */

const { test, expect } = require('./fixtures.cjs');
const { enterStudentApp, enterPortal } = require('./portal-session.cjs');
const { STUB_SOURCE } = require('./sync-cloud-stub.cjs');

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });

const SUPABASE_ORIGIN = 'https://cgtdnwktzcroxeioeyfq.supabase.co';
const GREEN = 'rgb(14, 159, 110)';

function createMockSupabaseBackend() {
  const nodes = new Map();
  let rev = 1;

  const normPath = raw => String(raw || '').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');

  function targetDepth(path) {
    const segs = path.split('/');
    if (segs[0] === 'dailyAdvice') return segs[1] === 'items' ? 3 : 2;
    if (segs[0] === 'activePlusSync' && segs[1] === 'v1') {
      if (['staffDirectory', 'studentAccount', 'settings'].includes(segs[2])) return 3;
      if (segs[2] === 'examDb') return 5;
      if (segs[2] === 'system') return segs[3] === 'connectivityProbe' ? 5 : 4;
      return 4;
    }
    return Math.max(segs.length, 3);
  }

  function resolveSv(val, nowMs) {
    if (val === null || val === undefined || typeof val !== 'object') return val;
    if (Array.isArray(val)) return val.map(v => resolveSv(v, nowMs));
    const keys = Object.keys(val);
    if (keys.length === 1 && val['.sv'] === 'timestamp') return nowMs;
    const out = {};
    for (const [k, v] of Object.entries(val)) out[k] = resolveSv(v, nowMs);
    return out;
  }

  function expandLeaves(path, val, out = []) {
    if (val === null || val === undefined) return out;
    const depth = path.split('/').length;
    if (depth >= targetDepth(path) || typeof val !== 'object' || Array.isArray(val)) {
      out.push([path, JSON.parse(JSON.stringify(val))]);
      return out;
    }
    for (const [k, v] of Object.entries(val)) {
      if (k && v !== null && v !== undefined) expandLeaves(`${path}/${k}`, v, out);
    }
    return out;
  }

  function putDeep(doc, keys, val) {
    if (!keys.length) return val;
    const base = doc && typeof doc === 'object' && !Array.isArray(doc) ? { ...doc } : {};
    const [head, ...rest] = keys;
    base[head] = rest.length ? putDeep(base[head], rest, val) : val;
    return base;
  }

  function subtreeVersion(norm) {
    let count = 0;
    let maxRev = 0;
    let hash = 0;
    for (const [p, entry] of nodes.entries()) {
      if (p === norm || p.startsWith(norm + '/')) {
        count += 1;
        if (entry.rev > maxRev) maxRev = entry.rev;
        for (let i = 0; i < p.length; i += 1) hash = ((hash * 31) ^ p.charCodeAt(i) ^ entry.rev) >>> 0;
      }
    }
    return `${count}:${maxRev}:${hash}`;
  }

  function getSubtree(rawPath) {
    const norm = normPath(rawPath);
    let doc = null;
    let found = false;
    const sorted = [...nodes.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [p, entry] of sorted) {
      if (p === norm) {
        found = true;
        doc = JSON.parse(JSON.stringify(entry.val));
      } else if (p.startsWith(norm + '/')) {
        found = true;
        const rel = p.slice(norm.length + 1).split('/');
        doc = putDeep(doc, rel, JSON.parse(JSON.stringify(entry.val)));
      }
    }
    return {
      exists: found,
      value: found ? doc : null,
      version: subtreeVersion(norm),
      serverTimeMs: Date.now()
    };
  }

  function writeSubtree(rawPath, rawVal) {
    const norm = normPath(rawPath);
    if (rawVal === null || rawVal === undefined) {
      for (const p of [...nodes.keys()]) {
        if (p === norm || p.startsWith(norm + '/')) nodes.delete(p);
      }
      return { ok: true, version: subtreeVersion(norm), serverTimeMs: Date.now() };
    }
    const resolved = resolveSv(rawVal, Date.now());
    const incoming = new Map(expandLeaves(norm, resolved));
    for (const p of [...nodes.keys()]) {
      if ((p === norm || p.startsWith(norm + '/')) && !incoming.has(p)) nodes.delete(p);
    }
    for (const [p, v] of incoming.entries()) {
      const prev = nodes.get(p);
      if (!prev || JSON.stringify(prev.val) !== JSON.stringify(v)) {
        rev += 1;
        nodes.set(p, { val: v, rev });
      }
    }
    return { ok: true, version: subtreeVersion(norm), serverTimeMs: Date.now() };
  }

  writeSubtree('activePlusSync/v1/system/adminInitialized', true);

  async function attachToContext(context) {
    await context.route(`${SUPABASE_ORIGIN}/**`, async route => {
      const req = route.request();
      const url = new URL(req.url());
      const body = req.postData() ? JSON.parse(req.postData()) : {};
      const json = payload => route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(payload)
      });

      if (url.pathname.endsWith('/rpc/apc_server_time_ms')) return json(Date.now());
      if (url.pathname.endsWith('/rpc/apc_get_subtree')) return json(getSubtree(body.p_path));
      if (url.pathname.endsWith('/rpc/apc_set_subtree')) return json(writeSubtree(body.p_path, body.p_value));
      if (url.pathname.endsWith('/rpc/apc_cas_subtree')) {
        const cur = getSubtree(body.p_path);
        if (cur.version !== body.p_expected_version) {
          return json({ ...cur, committed: false, conflict: true });
        }
        writeSubtree(body.p_path, body.p_value);
        return json({ ...getSubtree(body.p_path), committed: true, conflict: false });
      }
      return json({});
    });
  }

  return { nodes, getSubtree, attachToContext };
}

test('browser portals select Supabase Realtime automatically, reach green status, and sync full-app + E2EE Class Chat', async ({ browser }) => {
  const backend = createMockSupabaseBackend();

  const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctxA.addInitScript(() => localStorage.setItem('activePlus.demo.autofill.v1', 'off'));
  await ctxB.addInitScript(() => localStorage.setItem('activePlus.demo.autofill.v1', 'off'));
  await backend.attachToContext(ctxA);
  await backend.attachToContext(ctxB);

  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const errors = [];
  pageA.on('pageerror', e => errors.push(String(e.message)));
  pageB.on('pageerror', e => errors.push(String(e.message)));

  try {
    await enterStudentApp(pageA, { id: '261024001', name: 'রাইসা ইসলাম', className: 'নবম শ্রেণি' });
    await enterPortal(pageB, 'teacher');

    // Verify Dual-Cloud E2EE mode with Supabase Primary auto-selected & topbar GREEN synced state
    await expect.poll(async () => pageA.evaluate(() => ({
      mode: document.documentElement.dataset.cloudMode,
      encrypted: document.documentElement.dataset.cloudEncrypted,
      provider: document.documentElement.dataset.cloudProvider,
      failover: document.documentElement.dataset.cloudFailover,
      hibernated: document.documentElement.dataset.wsHibernated,
      sync: document.documentElement.dataset.realtimeSync,
      visual: document.documentElement.dataset.syncVisual,
      border: getComputedStyle(document.querySelector('.app-topbar')).borderTopColor
    })), { timeout: 20000 }).toEqual({
      mode: 'dual-failover',
      encrypted: 'aes-256-gcm',
      provider: 'supabase',
      failover: 'standby',
      hibernated: 'false',
      sync: 'online',
      visual: 'synced',
      border: GREEN
    });

    // Verify Idle WebSocket Hibernation & <1s instant resume inside real Chromium
    const hibernationCheck = await pageA.evaluate(async () => {
      const supa = await import('/sync/supabase-transport.js');
      supa.enterIdleHibernation();
      const hiddenDataset = document.documentElement.dataset.wsHibernated;
      const hiddenChannel = supa.getSupabaseLoadState().hasRealtimeChannel;
      supa.resumeFromHibernation();
      const awakeDataset = document.documentElement.dataset.wsHibernated;
      const awakeChannel = supa.getSupabaseLoadState().hasRealtimeChannel;
      return { hiddenDataset, hiddenChannel, awakeDataset, awakeChannel };
    });
    expect(hibernationCheck).toEqual({
      hiddenDataset: 'true',
      hiddenChannel: false,
      awakeDataset: 'false',
      awakeChannel: true
    });

    // 1. Full-app sync: Teacher / cloud notice creation propagates to Student device via Supabase
    const noticeTitle = 'সুপারবেজ রিয়েলটাইম নোটিশ পরীক্ষা';
    await pageB.evaluate(async title => {
      const key = 'activePlus.admin.notices.v1';
      const list = JSON.parse(localStorage.getItem(key) || '[]');
      list.unshift({
        id: 'supa-notice-1',
        title,
        body: 'আগামীকাল বিশেষ মডেল টেস্ট অনুষ্ঠিত হবে।',
        category: 'exam',
        createdAt: new Date().toISOString(),
        updatedAt: Date.now()
      });
      localStorage.setItem(key, JSON.stringify(list));
      const { SyncService } = await import('/sync/sync-core.js');
      await SyncService.syncNow();
    }, noticeTitle);

    await expect.poll(() => {
      const noticesCloud = backend.getSubtree('activePlusSync/v1/notices').value || {};
      const row = noticesCloud['supa-notice-1'];
      const rawJson = JSON.stringify(noticesCloud);
      return Boolean(
        row &&
        row._apcEnc === 1 &&
        row.alg === 'AES-256-GCM' &&
        !rawJson.includes('সুপারবেজ রিয়েলটাইম নোটিশ পরীক্ষা') &&
        !rawJson.includes('বিশেষ মডেল টেস্ট')
      );
    }, { timeout: 15000 }).toBe(true);

    // Trigger Student sync cycle and confirm notice arrived in Student localStorage
    await pageA.evaluate(async () => {
      const { SyncService } = await import('/sync/sync-core.js');
      await SyncService.syncNow();
    });
    await expect.poll(async () => pageA.evaluate(() => {
      const list = JSON.parse(localStorage.getItem('activePlus.admin.notices.v1') || '[]');
      return list.some(n => n.id === 'supa-notice-1');
    }), { timeout: 15000 }).toBe(true);

    // 2. Class Chat E2EE sync: Student sends chat message -> ciphertext stored in Supabase -> Teacher receives decrypted message
    const chatText = 'স্যার, সুপারবেজ ক্লাস চ্যাট ঠিকমতো কাজ করছে!';
    await pageA.evaluate(async text => {
      const { sendClassMessage } = await import('/js/class-chat.js');
      const { SyncService } = await import('/sync/sync-core.js');
      sendClassMessage({
        className: 'নবম শ্রেণি',
        text,
        actor: {
          id: '261024001',
          name: 'রাইসা ইসলাম',
          role: 'student',
          className: 'নবম শ্রেণি',
          approved: true
        }
      });
      await SyncService.syncNow();
    }, chatText);

    await expect.poll(() => {
      const chatCloud = backend.getSubtree('activePlusSync/v1/classChat').value || {};
      const keys = Object.keys(chatCloud).filter(k => k.startsWith('msg-'));
      return keys.length > 0 && !JSON.stringify(chatCloud).includes('কাজ করছে');
    }, { timeout: 15000 }).toBe(true);

    // Teacher portal receives and decrypts the E2EE Class Chat message automatically
    await expect.poll(async () => pageB.evaluate(async expected => {
      const { readClassChatStore } = await import('/js/class-chat.js');
      const store = readClassChatStore();
      return (store.messages || []).some(m => m.text === expected);
    }, chatText), { timeout: 15000 }).toBe(true);

    await expect(errors).toEqual([]);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test('Dual-Cloud Failover automatically shifts live browser traffic to Firebase when Supabase hits 503 overload', async ({ page }) => {
  await page.addInitScript(() => {
    window.__APC_CLOUD_PROVIDER__ = 'dual';
    localStorage.setItem('activePlus.demo.autofill.v1', 'off');
  });
  await page.route('**/vendor/firebase/sdk.js', route =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: STUB_SOURCE })
  );
  // Simulate Supabase hitting 503 capacity/overload while Firebase Secondary is healthy
  await page.route(`${SUPABASE_ORIGIN}/**`, route =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ code: '53300', message: 'too_many_connections: realtime max_connections reached' })
    })
  );

  await enterStudentApp(page, { id: '261025009', name: 'তানভীর আহমেদ', className: 'দশম শ্রেণি', waitForNetworkIdle: false });

  await expect.poll(async () => page.evaluate(() => ({
    mode: document.documentElement.dataset.cloudMode,
    provider: document.documentElement.dataset.cloudProvider,
    failover: document.documentElement.dataset.cloudFailover,
    sync: document.documentElement.dataset.realtimeSync,
    visual: document.documentElement.dataset.syncVisual
  })), { timeout: 20000 }).toEqual({
    mode: 'dual-failover',
    provider: 'firebase',
    failover: 'active',
    sync: 'online',
    visual: 'synced'
  });

  // Push a local notice while Supabase is overloaded -> seamlessly saved into Firebase hot-standby
  await page.evaluate(async () => {
    const key = 'activePlus.admin.notices.v1';
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    list.push({
      id: 'failover-notice-1',
      title: 'ফেইলওভার নোটিশ',
      body: 'সুপারবেজ ব্যস্ত থাকলেও ফায়ারবেসে সেভ হয়েছে',
      audience: 'সকল শিক্ষার্থী',
      status: 'published',
      createdAt: new Date().toISOString()
    });
    localStorage.setItem(key, JSON.stringify(list));
  });

  await expect.poll(() => page.evaluate(() => {
    const notices = window.__cloud?.data?.activePlusSync?.v1?.notices || {};
    const row = notices['failover-notice-1'];
    const rawJson = JSON.stringify(notices);
    return Boolean(
      row &&
      row._apcEnc === 1 &&
      row.alg === 'AES-256-GCM' &&
      !rawJson.includes('ফেইলওভার নোটিশ') &&
      !rawJson.includes('সুপারবেজ ব্যস্ত থাকলেও')
    );
  }), { timeout: 15000 }).toBe(true);
});

test('Two browser portals sync Notices and Class Chat end-to-end over Firebase with full AES-256-GCM encryption', async ({ browser }) => {
  const sharedFb = { activePlusSync: { v1: { system: { adminInitialized: true } } } };
  const connectedPages = new Set();

  const applyAtRoot = (root, rawPath, value) => {
    const keys = String(rawPath).split('/').filter(Boolean);
    const last = keys.pop();
    if (!last) return;
    let node = root;
    for (const k of keys) {
      if (typeof node[k] !== 'object' || node[k] === null) node[k] = {};
      node = node[k];
    }
    if (value === null || value === undefined) delete node[last];
    else node[last] = JSON.parse(JSON.stringify(value));
  };

  const SHARED_FB_SDK = `${STUB_SOURCE}
window.__fbApplyRemote = (path, value) => {
  const keys = String(path).split('/').filter(Boolean);
  const last = keys.pop();
  if (!last) return;
  let node = window.__cloud.data;
  for (const k of keys) {
    if (typeof node[k] !== 'object' || node[k] === null) node[k] = {};
    node = node[k];
  }
  if (value === null || value === undefined) delete node[last];
  else node[last] = value;
  for (const [watched, entries] of window.__cloud.listeners) {
    const related = watched === path || watched.startsWith(path + '/') || path.startsWith(watched + '/');
    if (!related) continue;
    let cur = window.__cloud.data;
    for (const part of String(watched).split('/').filter(Boolean)) {
      if (cur == null || typeof cur !== 'object') { cur = null; break; }
      cur = cur[part];
    }
    const snap = {
      val: () => (cur === undefined ? null : cur),
      exists: () => cur !== null && cur !== undefined,
      key: String(watched).split('/').filter(Boolean).pop() || null
    };
    for (const entry of entries) queueMicrotask(() => entry.callback(snap));
  }
};
`;

  async function mountFirebaseContext() {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const seedSnapshot = JSON.parse(JSON.stringify(sharedFb));
    await ctx.addInitScript(seed => {
      window.__APC_CLOUD_PROVIDER__ = 'firebase';
      localStorage.setItem('activePlus.demo.autofill.v1', 'off');
      window.__cloud = {
        data: seed,
        listeners: new Map(),
        connected: false,
        failWrites: false,
        failReads: false,
        writes: new Proxy([], {
          get(target, prop, receiver) {
            if (prop === 'push') {
              return (...items) => {
                const res = Array.prototype.push.apply(target, items);
                for (const item of items) {
                  if (item && typeof window.__fbHubBroadcast === 'function') {
                    void window.__fbHubBroadcast(item.path, item.value);
                  }
                }
                return res;
              };
            }
            return Reflect.get(target, prop, receiver);
          }
        }),
        reads: [],
        transactions: [],
        signedIn: false
      };
    }, seedSnapshot);
    await ctx.route('**/vendor/firebase/sdk.js', route =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: SHARED_FB_SDK })
    );
    // Block Supabase completely so 100% of sync MUST flow through Firebase
    await ctx.route(`${SUPABASE_ORIGIN}/**`, route => route.abort('failed'));
    const page = await ctx.newPage();
    connectedPages.add(page);
    await page.exposeFunction('__fbHubBroadcast', async (path, value) => {
      applyAtRoot(sharedFb, path, value);
      for (const other of [...connectedPages]) {
        if (other === page || other.isClosed()) continue;
        await other.evaluate(({ p, v }) => {
          if (typeof window.__fbApplyRemote === 'function') window.__fbApplyRemote(p, v);
        }, { p: path, v: value }).catch(() => {});
      }
    });
    return { ctx, page };
  }

  const devA = await mountFirebaseContext();
  const devB = await mountFirebaseContext();
  const errors = [];
  devA.page.on('pageerror', e => errors.push(String(e.message)));
  devB.page.on('pageerror', e => errors.push(String(e.message)));

  try {
    await enterStudentApp(devA.page, { id: '261025088', name: 'সুমাইয়া ইসলাম', className: 'নবম শ্রেণি', waitForNetworkIdle: false });
    await enterPortal(devB.page, 'teacher');

    // Also hook transaction writes on Firebase stub (runTransaction writes via writePath directly)
    for (const p of [devA.page, devB.page]) {
      await p.evaluate(() => {
        let lastJson = JSON.stringify(window.__cloud?.data || {});
        setInterval(() => {
          const cur = window.__cloud?.data?.activePlusSync?.v1;
          if (!cur) return;
          const nextJson = JSON.stringify(cur);
          if (nextJson === lastJson) return;
          lastJson = nextJson;
          for (const [k, v] of Object.entries(cur)) {
            void window.__fbHubBroadcast(`activePlusSync/v1/${k}`, v);
          }
        }, 120);
      });
    }

    await expect.poll(async () => devA.page.evaluate(() => ({
      mode: document.documentElement.dataset.cloudMode,
      encrypted: document.documentElement.dataset.cloudEncrypted,
      provider: document.documentElement.dataset.cloudProvider,
      sync: document.documentElement.dataset.realtimeSync,
      visual: document.documentElement.dataset.syncVisual
    })), { timeout: 20000 }).toEqual({
      mode: 'firebase-only',
      encrypted: 'aes-256-gcm',
      provider: 'firebase',
      sync: 'online',
      visual: 'synced'
    });

    // 1. Teacher creates a Bengali Notice -> encrypted in Firebase -> Student decrypts live!
    const fbNoticeTitle = 'ফায়ারবেস এনক্রিপটেড নোটিশ সিঙ্ক সফল';
    await devB.page.evaluate(async title => {
      const key = 'activePlus.admin.notices.v1';
      const list = JSON.parse(localStorage.getItem(key) || '[]');
      list.unshift({
        id: 'fb-e2ee-notice-1',
        title,
        body: 'ফায়ারবেস ডাটাবেজে কোনো প্লেইনটেক্সট ছাড়াই সিঙ্ক হয়েছে।',
        category: 'general',
        createdAt: new Date().toISOString(),
        updatedAt: Date.now()
      });
      localStorage.setItem(key, JSON.stringify(list));
      const { SyncService } = await import('/sync/sync-core.js');
      await SyncService.syncNow();
    }, fbNoticeTitle);

    await expect.poll(() => {
      const row = sharedFb?.activePlusSync?.v1?.notices?.['fb-e2ee-notice-1'];
      const raw = JSON.stringify(sharedFb?.activePlusSync?.v1?.notices || {});
      return Boolean(
        row &&
        row._apcEnc === 1 &&
        row.alg === 'AES-256-GCM' &&
        !raw.includes('ফায়ারবেস এনক্রিপটেড নোটিশ') &&
        !raw.includes('প্লেইনটেক্সট ছাড়াই')
      );
    }, { timeout: 15000 }).toBe(true);

    await expect.poll(async () => devA.page.evaluate(() => {
      const list = JSON.parse(localStorage.getItem('activePlus.admin.notices.v1') || '[]');
      return list.find(n => n.id === 'fb-e2ee-notice-1')?.title || '';
    }), { timeout: 15000 }).toBe(fbNoticeTitle);

    // 2. Student sends Class Chat message -> double AES-256-GCM encrypted in Firebase -> Teacher decrypts live!
    const fbChatMsg = 'স্যার, ফায়ারবেসেও ক্লাস চ্যাট এনক্রিপ্টেড সিঙ্ক হচ্ছে!';
    await devA.page.evaluate(async text => {
      const { sendClassMessage } = await import('/js/class-chat.js');
      const { SyncService } = await import('/sync/sync-core.js');
      sendClassMessage({
        className: 'নবম শ্রেণি',
        text,
        actor: {
          id: '261025088',
          name: 'সুমাইয়া ইসলাম',
          role: 'student',
          className: 'নবম শ্রেণি',
          approved: true
        }
      });
      await SyncService.syncNow();
    }, fbChatMsg);

    await expect.poll(() => {
      const chatMap = sharedFb?.activePlusSync?.v1?.classChat || {};
      const msgKeys = Object.keys(chatMap).filter(k => k.startsWith('msg-'));
      return msgKeys.length > 0 && chatMap[msgKeys[0]]._apcEnc === 1 && !JSON.stringify(chatMap).includes('এনক্রিপ্টেড সিঙ্ক হচ্ছে');
    }, { timeout: 15000 }).toBe(true);

    await expect.poll(async () => devB.page.evaluate(async expected => {
      const { readClassChatStore } = await import('/js/class-chat.js');
      return (readClassChatStore().messages || []).some(m => m.text === expected);
    }, fbChatMsg), { timeout: 15000 }).toBe(true);

    await expect(errors).toEqual([]);
  } finally {
    await devA.ctx.close();
    await devB.ctx.close();
  }
});

