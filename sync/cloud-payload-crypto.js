// Active Plus Coaching — Full-Database Client-Side Payload Encryption (AES-256-GCM).
// Encrypts every leaf record client-side before it leaves the browser for Supabase
// PostgreSQL (`public.apc_sync_nodes`) or Firebase RTDB (Dual-Cloud Standby/Failover),
// binding each ciphertext envelope to its exact canonical database path via AES-GCM
// Additional Authenticated Data (AAD) to prevent cross-path replay or tampering.

export const CLOUD_E2EE_VERSION = 1;
export const CLOUD_E2EE_ALGO = 'AES-256-GCM';

const STRING_ENVELOPE_PREFIX = 'apc1:';
const AAD_PREFIX = 'apc-db-e2ee-v1:';
const PBKDF2_ITERATIONS = 25000;
const KEY_DOMAIN_SALT = 'ActivePlusCoaching::FullDatabaseE2EE::Salt::v1';
const DEFAULT_WORKSPACE_KEY_MATERIAL =
  'ActivePlusCoaching::InstitutionalCloudKey::cgtdnwktzcroxeioeyfq::v1';

const keyPromiseCache = new Map();
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function cleanPath(rawPath) {
  return String(rawPath || '').trim().replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
}

function getWebCrypto() {
  const c = globalThis.crypto;
  if (!c || !c.subtle || typeof c.getRandomValues !== 'function') {
    throw new Error('Web Crypto API (AES-256-GCM) is unavailable in this environment');
  }
  return c;
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 = typeof globalThis.btoa === 'function'
    ? globalThis.btoa(binary)
    : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(str) {
  const clean = String(str || '').trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!clean) return null;
  const padLen = (4 - (clean.length % 4)) % 4;
  const padded = clean + '='.repeat(padLen);
  if (typeof globalThis.atob === 'function') {
    const binary = globalThis.atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

function resolveWorkspaceSecret() {
  const customGlobal = globalThis.__APC_CLOUD_ENCRYPTION_KEY__;
  if (typeof customGlobal === 'string' && customGlobal.trim()) {
    return `${DEFAULT_WORKSPACE_KEY_MATERIAL}::${customGlobal.trim()}`;
  }
  try {
    const stored = globalThis.localStorage?.getItem('apc.cloudEncryptionPassphrase');
    if (typeof stored === 'string' && stored.trim()) {
      return `${DEFAULT_WORKSPACE_KEY_MATERIAL}::${stored.trim()}`;
    }
  } catch { /* storage unavailable */ }
  return DEFAULT_WORKSPACE_KEY_MATERIAL;
}

async function getDerivedAesKey() {
  const secret = resolveWorkspaceSecret();
  let pending = keyPromiseCache.get(secret);
  if (!pending) {
    pending = (async () => {
      const webCrypto = getWebCrypto();
      const baseKey = await webCrypto.subtle.importKey(
        'raw',
        textEncoder.encode(secret),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
      );
      return webCrypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: textEncoder.encode(KEY_DOMAIN_SALT),
          iterations: PBKDF2_ITERATIONS,
          hash: 'SHA-256'
        },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    })();
    keyPromiseCache.set(secret, pending);
  }
  return pending;
}

export function targetDepthForPath(rawPath) {
  const norm = cleanPath(rawPath);
  const segs = norm ? norm.split('/') : [];
  const s1 = segs[0] || '';
  const s2 = segs[1] || '';
  const s3 = segs[2] || '';
  const s4 = segs[3] || '';

  if (s1 === 'dailyAdvice') {
    return s2 === 'items' ? 3 : 2;
  }
  if (s1 === 'activePlusSync' && s2 === 'v1') {
    if (s3 === 'staffDirectory' || s3 === 'studentAccount' || s3 === 'settings') {
      return 3;
    }
    if (s3 === 'examDb' || s3 === 'db') {
      return 5;
    }
    if (s3 === 'system') {
      return s4 === 'connectivityProbe' ? 5 : 4;
    }
    return 4;
  }
  return Math.max(segs.length, 3);
}

export function isEncryptedEnvelope(value) {
  if (typeof value === 'string' && value.startsWith(STRING_ENVELOPE_PREFIX)) {
    const dot = value.indexOf('.', STRING_ENVELOPE_PREFIX.length);
    return dot > STRING_ENVELOPE_PREFIX.length;
  }
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value._apcEnc === CLOUD_E2EE_VERSION &&
    typeof value.iv === 'string' &&
    typeof value.ct === 'string'
  );
}

function resolveSentinels(value, nowMs) {
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => resolveSentinels(item, nowMs));
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === '.sv' && value['.sv'] === 'timestamp') {
    return nowMs;
  }
  const out = {};
  for (const k of keys) {
    out[k] = resolveSentinels(value[k], nowMs);
  }
  return out;
}

function applyFirebaseRuleStub(normLeafPath, plainVal, envelope) {
  const segs = normLeafPath.split('/');
  if (segs[0] !== 'activePlusSync' || segs[1] !== 'v1') return envelope;
  const col = segs[2] || '';
  const leafKey = segs[3] || '';

  // Pure non-PII numeric/boolean operational gates required as raw primitives by Firebase rules
  if (col === 'system' && leafKey === 'adminInitialized') return Boolean(plainVal);
  if (col === 'system' && leafKey === 'connectivityProbe') {
    const atVal = typeof plainVal?.at === 'number' ? plainVal.at : Date.now();
    return { at: atVal };
  }
  if (col === 'dailyStudentCounters') {
    return Number(plainVal) || 1;
  }

  // String-typed index leaves (`<= 128` chars in database.rules.json)
  if (col === 'usernames' || col === 'mobileIndex' || col === 'emailIndex') {
    const compact = `${STRING_ENVELOPE_PREFIX}${envelope.iv}.${envelope.ct}`;
    return compact.length <= 128 ? compact : envelope;
  }

  if (col === 'staffDirectory') {
    return { version: 1, ...envelope };
  }
  if (col === 'staffAccounts') {
    return { username: leafKey || 'staff', password: { _enc: 1 }, ...envelope };
  }
  if (col === 'studentAccounts') {
    return {
      pinHash: { _enc: 1 },
      ...envelope
    };
  }
  if (col === 'students') {
    const rawId = plainVal?.id !== undefined && plainVal?.id !== null ? plainVal.id : leafKey;
    return {
      id: typeof rawId === 'number' ? rawId : String(rawId),
      ...envelope
    };
  }
  if (col === 'pushTokens') {
    return {
      token: 'enc_push_token_placeholder_v1',
      ...envelope
    };
  }
  if (col === 'adviceBank') {
    // Public coaching quotes node enforces strict `numChildren() === 6` in database.rules.json
    return {
      text: String(plainVal?.text || '').slice(0, 140) || 'Active Plus Coaching',
      source: String(plainVal?.source || 'Active Plus Coaching').slice(0, 120),
      active: plainVal?.active !== false,
      order: Math.max(1, Number(plainVal?.order) || 1),
      createdBy: String(plainVal?.createdBy || 'admin').slice(0, 128),
      createdAt: Math.max(0, Number(plainVal?.createdAt) || 0)
    };
  }
  if (col === 'examDb' && leafKey === 'exams') {
    const examId = segs[4] || '';
    return {
      id: String(plainVal?.id || examId),
      teacherId: 'enc',
      status: String(plainVal?.status || 'draft'),
      ...envelope
    };
  }
  if (col === 'examDb' && leafKey === 'attempts') {
    const attemptId = segs[4] || '';
    return {
      id: String(plainVal?.id || attemptId),
      examId: String(plainVal?.examId || 'enc'),
      studentId: 'enc',
      ...envelope
    };
  }
  if (col === 'notifications') {
    return {
      id: String(plainVal?.id || leafKey),
      type: 'new_registration',
      studentId: 'enc',
      studentName: 'enc',
      mobile: 'enc',
      createdAt: String(plainVal?.createdAt || '1970-01-01T00:00:00.000Z'),
      read: Boolean(plainVal?.read),
      ...envelope
    };
  }
  return envelope;
}

export async function encryptLeafValue(leafPath, plainValue, options = {}) {
  const norm = cleanPath(leafPath);
  if (plainValue === null || plainValue === undefined) return null;

  const nowMs = Date.now() + (Number(options.serverOffsetMs) || 0);
  const resolvedPlain = resolveSentinels(plainValue, nowMs);
  const serialized = JSON.stringify(resolvedPlain);
  if (serialized === undefined) return null;

  const webCrypto = getWebCrypto();
  const key = await getDerivedAesKey();
  const iv = webCrypto.getRandomValues(new Uint8Array(12));
  const aad = textEncoder.encode(`${AAD_PREFIX}${norm}`);
  const cipherBuf = await webCrypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    key,
    textEncoder.encode(serialized)
  );

  const envelope = {
    _apcEnc: CLOUD_E2EE_VERSION,
    alg: CLOUD_E2EE_ALGO,
    iv: bytesToBase64Url(iv),
    ct: bytesToBase64Url(new Uint8Array(cipherBuf))
  };

  // Preserve non-PII 7-day TTL metadata on unpinned Class Chat envelopes so
  // PostgreSQL `apc_write_subtree_internal` continues pruning expired rows.
  if (norm.startsWith('activePlusSync/v1/classChat/') && norm !== 'activePlusSync/v1/classChat/__metadata') {
    if (typeof resolvedPlain === 'object' && resolvedPlain !== null) {
      if (typeof resolvedPlain.pinned === 'boolean') envelope.pinned = resolvedPlain.pinned;
      if (resolvedPlain.expiresAt !== undefined) envelope.expiresAt = resolvedPlain.expiresAt;
    }
  }

  if (options.firebaseRulesCompat) {
    return applyFirebaseRuleStub(norm, resolvedPlain, envelope);
  }
  return envelope;
}

export async function decryptLeafValue(leafPath, rawValue) {
  const norm = cleanPath(leafPath);
  if (rawValue === null || rawValue === undefined) return null;
  if (!isEncryptedEnvelope(rawValue)) return rawValue;

  let ivBytes = null;
  let ctBytes = null;
  if (typeof rawValue === 'string' && rawValue.startsWith(STRING_ENVELOPE_PREFIX)) {
    const rest = rawValue.slice(STRING_ENVELOPE_PREFIX.length);
    const dot = rest.indexOf('.');
    ivBytes = base64UrlToBytes(rest.slice(0, dot));
    ctBytes = base64UrlToBytes(rest.slice(dot + 1));
  } else {
    ivBytes = base64UrlToBytes(rawValue.iv);
    ctBytes = base64UrlToBytes(rawValue.ct);
  }
  if (!ivBytes || !ctBytes) {
    throw new Error(`Malformed encrypted envelope at ${norm}`);
  }

  const webCrypto = getWebCrypto();
  const key = await getDerivedAesKey();
  const aad = textEncoder.encode(`${AAD_PREFIX}${norm}`);
  const plainBuf = await webCrypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes, additionalData: aad },
    key,
    ctBytes
  );
  return JSON.parse(textDecoder.decode(plainBuf));
}

export async function encryptCloudSubtree(basePath, plainSubtree, options = {}) {
  const norm = cleanPath(basePath);
  if (plainSubtree === null || plainSubtree === undefined) return null;

  const depth = norm ? norm.split('/').length : 0;
  const target = targetDepthForPath(norm);
  const isPlainObj = typeof plainSubtree === 'object' && !Array.isArray(plainSubtree);

  if (depth >= target || !isPlainObj) {
    const prevPlainMap = options.prevPlainByPath;
    const prevCipherMap = options.prevCipherByPath;
    if (prevPlainMap && prevCipherMap && prevCipherMap.has(norm) && prevPlainMap.has(norm)) {
      const nowMs = Date.now() + (Number(options.serverOffsetMs) || 0);
      const nextSerialized = JSON.stringify(resolveSentinels(plainSubtree, nowMs));
      if (nextSerialized === prevPlainMap.get(norm)) {
        return prevCipherMap.get(norm);
      }
    }
    return encryptLeafValue(norm, plainSubtree, options);
  }

  const entries = Object.entries(plainSubtree).filter(([k, v]) => k && v !== undefined && v !== null);
  const encryptedEntries = await Promise.all(
    entries.map(async ([k, childVal]) => {
      const childPath = norm ? `${norm}/${k}` : k;
      const encChild = await encryptCloudSubtree(childPath, childVal, options);
      return [k, encChild];
    })
  );
  return Object.fromEntries(encryptedEntries.filter(([, v]) => v !== null && v !== undefined));
}

export async function decryptCloudSubtree(basePath, rawSubtree) {
  const plainByPath = new Map();
  const cipherByPath = new Map();

  async function walk(currPath, nodeVal) {
    if (nodeVal === null || nodeVal === undefined) return null;
    if (isEncryptedEnvelope(nodeVal)) {
      const decrypted = await decryptLeafValue(currPath, nodeVal);
      plainByPath.set(currPath, JSON.stringify(decrypted));
      cipherByPath.set(currPath, nodeVal);
      return decrypted;
    }
    if (typeof nodeVal === 'object' && !Array.isArray(nodeVal)) {
      const keys = Object.keys(nodeVal);
      const pairs = await Promise.all(
        keys.map(async key => {
          const childPath = currPath ? `${currPath}/${key}` : key;
          const decChild = await walk(childPath, nodeVal[key]);
          return [key, decChild];
        })
      );
      return Object.fromEntries(pairs);
    }
    return nodeVal;
  }

  const norm = cleanPath(basePath);
  const value = await walk(norm, rawSubtree);
  return { value, plainByPath, cipherByPath };
}
