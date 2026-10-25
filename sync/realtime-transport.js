// Active Plus Coaching — Unified Realtime Cloud Transport Resolver.
// Routes live browser sessions to Dual-Cloud Failover (Supabase Realtime Primary
// + Firebase Realtime Database Hot Standby / Overflow Leg on allowed hosts, or
// Supabase-only on *.e2b.app preview hosts), while preserving seamless mock-hook
// compatibility for Node test harnesses and Playwright's `window.__cloud` stub.

import { isSupabaseConfigured } from './supabase-config.js';
import { createDualCloudTransport } from './dual-cloud-failover.js';

function detectRequestedProvider() {
  const explicit = globalThis.__APC_CLOUD_PROVIDER__;
  if (explicit === 'supabase' || explicit === 'firebase' || explicit === 'dual') return explicit;
  try {
    const search = globalThis.location?.search || '';
    const param = new URLSearchParams(search).get('cloudProvider');
    if (param === 'supabase' || param === 'firebase' || param === 'dual') return param;
  } catch { /* ignore */ }
  return '';
}

function createLazyFirebaseLeg() {
  let loaded = null;
  let loadPromise = null;
  const leg = {
    name: 'firebase',
    app: null,
    appCheckReady: Promise.resolve(),
    async ensureLoaded() {
      if (loaded) return loaded;
      if (!loadPromise) {
        loadPromise = Promise.all([
          import('../firebase/firebase-init.js'),
          import('../firebase/firebase-services.js')
        ]).then(([initMod, svcMod]) => {
          loaded = { initMod, svcMod };
          leg.app = initMod.firebaseApp;
          leg.appCheckReady = initMod.appCheckReady;
          return loaded;
        }).catch(err => {
          loadPromise = null;
          throw err;
        });
      }
      return loadPromise;
    },
    mod: {
      browserLocalPersistence: { type: 'LOCAL' },
      getAuth(app) {
        if (!loaded) return null;
        return loaded.svcMod.getAuth(app || loaded.initMod.firebaseApp);
      },
      async setPersistence(auth, persistence) {
        const { initMod, svcMod } = await leg.ensureLoaded();
        const resolvedAuth = auth || svcMod.getAuth(initMod.firebaseApp);
        return svcMod.setPersistence(resolvedAuth, persistence ?? svcMod.browserLocalPersistence);
      },
      async signInAnonymously(auth) {
        const { initMod, svcMod } = await leg.ensureLoaded();
        return svcMod.signInAnonymously(auth || svcMod.getAuth(initMod.firebaseApp));
      },
      getDatabase(app) {
        if (!loaded) throw new Error('Firebase secondary leg accessed before ensureLoaded()');
        return loaded.svcMod.getDatabase(app || loaded.initMod.firebaseApp);
      },
      ref(db, path) {
        return loaded.svcMod.ref(db, path);
      },
      get(r) {
        return loaded.svcMod.get(r);
      },
      set(r, val) {
        return loaded.svcMod.set(r, val);
      },
      runTransaction(r, fn) {
        return loaded.svcMod.runTransaction(r, fn);
      },
      onValue(r, cb, cancelCb) {
        return loaded.svcMod.onValue(r, cb, cancelCb);
      }
    }
  };
  return leg;
}

async function resolveTransportModules() {
  const requested = detectRequestedProvider();
  if (requested === 'supabase') {
    const supa = await import('./supabase-transport.js');
    return {
      provider: 'supabase',
      app: supa.supabaseApp,
      appCheckReady: supa.appCheckReady,
      mod: supa,
      supaMod: supa,
      dualController: null
    };
  }

  const isNodeRuntime = typeof process !== 'undefined' && Boolean(process.versions?.node);
  if (isNodeRuntime && requested !== 'dual') {
    const [initMod, svcMod] = await Promise.all([
      import('../firebase/firebase-init.js'),
      import('../firebase/firebase-services.js')
    ]);
    return {
      provider: 'firebase',
      app: initMod.firebaseApp,
      appCheckReady: initMod.appCheckReady,
      mod: svcMod,
      supaMod: null,
      dualController: null
    };
  }

  const host = String(globalThis.location?.hostname || '').toLowerCase();
  const isPreviewHost = /^[a-z0-9-]+\.e2b\.app$/.test(host);
  const hasWindowCloudStub = Boolean(globalThis.window?.__cloud);

  let firebaseSecondary = null;
  if (requested === 'firebase' || (hasWindowCloudStub && requested !== 'dual') || (!isSupabaseConfigured() && !isPreviewHost)) {
    try {
      const initMod = await import('../firebase/firebase-init.js');
      const svcMod = await import('../firebase/firebase-services.js');
      // Preserve single-cloud raw stub behavior for legacy tests (`tests/sync-e2e.spec.cjs`)
      // when `window.__cloud` is present without an explicit `firebase`/`dual` provider request.
      if (
        requested !== 'firebase' &&
        requested !== 'dual' &&
        (hasWindowCloudStub || Boolean(initMod.firebaseApp?.mock))
      ) {
        return {
          provider: 'firebase',
          app: initMod.firebaseApp,
          appCheckReady: initMod.appCheckReady,
          mod: svcMod,
          supaMod: null,
          dualController: null
        };
      }
      firebaseSecondary = {
        name: 'firebase',
        app: initMod.firebaseApp,
        appCheckReady: initMod.appCheckReady,
        mod: svcMod
      };
      if (requested === 'firebase') {
        const fbEncrypted = createDualCloudTransport({
          primary: firebaseSecondary,
          secondary: null
        });
        return {
          provider: 'firebase',
          app: fbEncrypted.app,
          appCheckReady: fbEncrypted.appCheckReady,
          mod: fbEncrypted,
          supaMod: null,
          dualController: fbEncrypted
        };
      }
    } catch {
      if (requested === 'firebase') throw new Error('Requested Firebase provider could not initialize');
    }
  } else if (!isPreviewHost) {
    // Lazy-load the 808 KB Firebase SDK only if Secondary failover or hot-standby
    // mirroring runs, keeping mobile 4G cold startup on Supabase Primary fast.
    firebaseSecondary = createLazyFirebaseLeg();
  }

  if (!firebaseSecondary && globalThis.__APC_SECONDARY_TRANSPORT__?.mod) {
    firebaseSecondary = globalThis.__APC_SECONDARY_TRANSPORT__;
  }

  if (isSupabaseConfigured()) {
    const supa = await import('./supabase-transport.js');
    const dual = createDualCloudTransport({
      primary: {
        name: 'supabase',
        app: supa.supabaseApp,
        appCheckReady: supa.appCheckReady,
        mod: supa
      },
      secondary: firebaseSecondary
    });
    return {
      provider: dual.getDualCloudState().activeProvider,
      app: dual.app,
      appCheckReady: dual.appCheckReady,
      mod: dual,
      supaMod: supa,
      dualController: dual
    };
  }

  if (firebaseSecondary) {
    return {
      provider: 'firebase',
      app: firebaseSecondary.app,
      appCheckReady: firebaseSecondary.appCheckReady,
      mod: firebaseSecondary.mod,
      supaMod: null,
      dualController: null
    };
  }

  const [initMod, svcMod] = await Promise.all([
    import('../firebase/firebase-init.js'),
    import('../firebase/firebase-services.js')
  ]);
  return {
    provider: 'firebase',
    app: initMod.firebaseApp,
    appCheckReady: initMod.appCheckReady,
    mod: svcMod,
    supaMod: null,
    dualController: null
  };
}

const resolved = await resolveTransportModules();

try {
  if (globalThis.document?.documentElement?.dataset && !resolved.dualController) {
    globalThis.document.documentElement.dataset.cloudProvider = resolved.provider;
  }
} catch { /* non-DOM context */ }

export const activeCloudProvider = resolved.provider;
export function getCurrentCloudProvider() {
  if (resolved.dualController) {
    return resolved.dualController.getDualCloudState().activeProvider;
  }
  return resolved.provider;
}
export function getCloudLoadStatus() {
  return {
    provider: getCurrentCloudProvider(),
    dual: resolved.dualController ? resolved.dualController.getDualCloudState() : null,
    supabase: resolved.supaMod ? resolved.supaMod.getSupabaseLoadState() : null
  };
}
export const dualCloudController = resolved.dualController;
export const firebaseApp = resolved.app;
export const appCheckReady = resolved.appCheckReady ?? Promise.resolve();
export const getAuth = resolved.mod.getAuth;
export const signInAnonymously = resolved.mod.signInAnonymously;
export const setPersistence = resolved.mod.setPersistence;
export const browserLocalPersistence = resolved.mod.browserLocalPersistence;
export const getDatabase = resolved.mod.getDatabase;
export const ref = resolved.mod.ref;
export const get = resolved.mod.get;
export const set = resolved.mod.set;
export const runTransaction = resolved.mod.runTransaction;
export const onValue = resolved.mod.onValue;
