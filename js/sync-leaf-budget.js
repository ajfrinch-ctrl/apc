/* Cloud leaf budget helpers shared by the app store (js/course-content.js) and
   the sync payload builder (js/sync-collections.js).

   Why this lives in one place: Supabase stores every record as ONE encrypted
   row whose plaintext leaf is `{ _syncKind: 'record', record }`, and enforces
   `octet_length(val::text) <= 512 KiB` per row. The AES-GCM envelope expands
   the plaintext (~4/3 with base64url), so the plain leaf must stay below a
   smaller budget. One oversized leaf aborts the WHOLE collection merge for
   every device — students then never receive any published content, with no
   visible error beyond the red topbar border.

   History snapshots duplicate the document up to 5×, so shedding the oldest
   ones is the cheapest rescue for a legacy oversized record. A record that is
   still over budget with no history left cannot be shipped; the publish path
   refuses to create such records in the first place. */
export const SYNC_LEAF_SAFE_BYTES = 360 * 1024;
const syncLeafEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

/** UTF-8 byte size of the exact leaf the cloud expects to store. */
export function syncLeafBytes(record) {
  try {
    const json = JSON.stringify({ _syncKind: 'record', record });
    if (syncLeafEncoder) return syncLeafEncoder.encode(json).length;
    return json.length;
  } catch { return 0; }
}

function trimHistoryToFit(record) {
  const fits = value => syncLeafBytes(value) <= SYNC_LEAF_SAFE_BYTES;
  if (fits(record)) return { record, fits: true };
  if (!Array.isArray(record.history) || !record.history.length) {
    return { record, fits: false };
  }
  // History is stored newest-first — drop the oldest snapshots until the
  // record fits the cloud leaf again.
  const history = [...record.history];
  let next = record;
  while (history.length) {
    history.pop();
    next = { ...next, history: [...history] };
    if (fits(next)) return { record: next, fits: true };
  }
  next = { ...next, history: [] };
  return { record: next, fits: fits(next) };
}

/** Best-effort: drop oldest history snapshots until the record fits the
 *  cloud leaf budget. Never throws. Suitable for payloads/copies — local
 *  authoring state is untouched. */
export function trimSyncLeafHistory(record) {
  if (!record || typeof record !== 'object') return record;
  return trimHistoryToFit(record).record;
}

/** Hard guarantee for publish/save: the record must fit the cloud leaf
 *  budget, or the student side will never receive it (the whole collection
 *  fails its atomic merge). Trims history first; throws with an actionable
 *  Bangla message when still too big. */
export function ensureSyncLeafBudget(record) {
  if (!record || typeof record !== 'object') return record;
  const { record: trimmed, fits } = trimHistoryToFit(record);
  if (fits && syncLeafBytes(trimmed) <= SYNC_LEAF_SAFE_BYTES) return trimmed;
  throw Object.assign(
    new Error('কনটেন্ট/লেকচার শিটের আকার ক্লাউড সিঙ্কের নিরাপদ সীমা অতিক্রম করেছে — ছবির আকার/সংখ্যা বা টেক্সটের পরিমাণ কমিয়ে আবার চেষ্টা করুন।'),
    { code: 'LEAF_TOO_BIG' }
  );
}
