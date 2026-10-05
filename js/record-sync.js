/* Durable record-level outbox. Cloud transport is injected so the same merge
   rules can be tested without a Firebase project. A persisted view distinguishes
   an offline deletion from a record this device has never seen; it stores a
   short per-record fingerprint instead of a second copy of every record, so the
   outbox cannot exhaust the device's storage quota. */
export function stableJSON(value) {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJSON(value[key])}`).join(',')}}`;
  const json = JSON.stringify(value);
  return json === undefined ? 'undefined' : json;
}

/** Two independent 32-bit hashes plus the length: cheap, collision-resistant. */
function fingerprint(value) {
  const text = stableJSON(value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16)}-${second.toString(16)}-${text.length.toString(16)}`;
}

function viewOf(records) {
  const view = {};
  for (const [id, value] of Object.entries(records || {})) view[id] = fingerprint(value);
  return view;
}
const copy = value => JSON.parse(JSON.stringify(value));
const same = (a, b) => stableJSON(a) === stableJSON(b);
const own = (obj, key) => Object.hasOwn(obj, key);

/* A record's own wall-clock. Records written by the app carry `updatedAt`; a
   student roster row is stamped with `registeredAt` the moment it is created,
   and the office adds `updatedAt` when it decides on it. */
const recordTime = record => {
  const value = record?.updatedAt ?? record?.record?.updatedAt ?? record?.registeredAt ?? record?.record?.registeredAt ?? record?.createdAt ?? record?.record?.createdAt;
  if (Number.isFinite(value)) return value;
  return Date.parse(value || '') || 0;
};

/**
 * True when the cloud already holds a strictly newer copy of this record.
 *
 * A queued local copy that is older than the cloud copy is stale, and writing
 * it back would undo work done on another device — an approved registration, a
 * corrected payment entry — just because this phone was offline (or closed)
 * while the decision was made. Records without a usable timestamp keep the
 * original local-wins behaviour, so an ordinary offline edit still arrives.
 */
function cloudCopyIsNewer(candidate, current) {
  if (!candidate || !current || typeof current !== 'object') return false;
  const localTime = recordTime(candidate);
  const cloudTime = recordTime(current);
  return localTime > 0 && cloudTime > localTime;
}

export function mergeRecordOperations(remote, operations) {
  const next = { ...(remote || {}) };
  for (const [id, op] of Object.entries(operations)) {
    if (op.seed && own(next, id)) continue; // first sync must not replace cloud data
    if (op.value === null) delete next[id];  // a deletion is a deliberate action
    else if (!cloudCopyIsNewer(op.value, next[id])) {
      Object.defineProperty(next, id, { value: op.value, enumerable: true, configurable: true, writable: true });
    }
  }
  return next;
}

export function createRecordSync({ loadState, saveState, readLocal, writeLocal, commit }) {
  const saved = loadState();
  // State from an older shape is dropped: re-seeding is harmless, but a stale
  // "already seen" view could invent deletions of records that do exist.
  const state = saved?.version === 2 ? saved : { view: null, pending: {} };
  let view = state.view ?? null;
  let pending = state.pending || {};
  let flight = null;
  const persist = () => saveState({ version: 2, view, pending });

  function capture() {
    const local = readLocal();
    if (local === null) return; // unreadable is NOT a request to delete everything
    const hashes = viewOf(local);
    const ids = new Set([...Object.keys(view || {}), ...Object.keys(local)]);
    for (const id of ids) {
      if (view !== null && view[id] === hashes[id]) continue;
      const value = own(local, id) ? local[id] : null;
      Object.defineProperty(pending, id, {
        value: { value, ...(view === null ? { seed: true } : {}) },
        enumerable: true, configurable: true, writable: true
      });
    }
    view = hashes;
    persist(); // save the outbox before making a network request
  }

  function receive(remote) {
    capture();
    const next = mergeRecordOperations(remote, pending);
    view = viewOf(next);
    persist();
    writeLocal(next);
  }

  function flush() {
    if (flight) return flight;
    flight = (async () => {
      capture();
      while (Object.keys(pending).length) {
        const batch = copy(pending);
        // commit atomically merges ONLY changed IDs into current server state.
        const remote = await commit(batch);
        // A new edit can arrive while the old write is awaiting acknowledgement.
        for (const [id, operation] of Object.entries(batch)) {
          if (same(pending[id], operation)) delete pending[id];
        }
        receive(remote);
      }
    })().finally(() => { flight = null; });
    return flight;
  }

  capture();
  return {
    capture,
    receive,
    flush,
    hasPending: () => Object.keys(pending).length > 0,
    hasView: () => view !== null
  };
}
