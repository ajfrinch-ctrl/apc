/* Sign-in hand-off copy (owner request 2026-11-08).

   The login form used to print "…ে নেওয়া হচ্ছে…" in its own message box and then
   call location.replace() in the same tick, so the line was never actually
   painted: the document was torn down first. The hand-off wording belongs to the
   loading screen of the panel being opened, so this module is the single source
   of that copy and of the tiny one-shot note that carries it across the
   navigation.

   Only copy crosses the page boundary — no credentials, no ids, no role
   authority. The note is keyed by the destination panel itself, is removed the
   moment it is read, and expires after a few seconds, so a later refresh or a
   direct visit always falls back to the neutral loading text. */
export const HANDOFF_NOTE_KEY = 'activePlus.handoff.note.v1';
export const HANDOFF_NOTE_TTL_MS = 20_000;

/* Panel label + the loading line for each staff role. */
export const STAFF_HANDOFF = Object.freeze({
  admin: { label: 'এডমিন প্যানেল', panel: 'admin', loading: 'এডমিন প্যানেলে নেওয়া হচ্ছে…' },
  manager: { label: 'ম্যানেজার প্যানেল', panel: 'manager', loading: 'ম্যানেজার প্যানেলে নেওয়া হচ্ছে…' },
  teacher: { label: 'শিক্ষক প্যানেল', panel: 'teacher', loading: 'শিক্ষক প্যানেলে নেওয়া হচ্ছে…' },
  payment: { label: 'পেমেন্ট রিসিভ প্যানেল', panel: 'payment', loading: 'পেমেন্ট প্যানেলে নেওয়া হচ্ছে…' }
});

/* The loading line shows the role, plus — only when this device really had
   another staff session open — the one sentence the login box used to try to
   show about it. */
export function staffHandoffLine(role, previousRole = '') {
  const spec = STAFF_HANDOFF[role];
  if (!spec) return '';
  const previous = previousRole && previousRole !== role ? STAFF_HANDOFF[previousRole] : null;
  return previous ? `${spec.loading} — এই ডিভাইসের আগের ${previous.label} সেশনটি বন্ধ হয়েছে` : spec.loading;
}

/* Written by the signing-in tab, read once by the destination panel. */
export function writeHandoffNote(role, previousRole = '') {
  try {
    globalThis.window?.sessionStorage?.setItem(HANDOFF_NOTE_KEY, JSON.stringify({
      role, previousRole, at: Date.now()
    }));
  } catch { /* private mode: the loading screen simply keeps its neutral text */ }
}

export function takeHandoffNote(panel) {
  let note = null;
  try {
    const store = globalThis.window?.sessionStorage;
    const raw = store?.getItem?.(HANDOFF_NOTE_KEY);
    if (!raw) return '';
    store.removeItem(HANDOFF_NOTE_KEY);
    note = JSON.parse(raw);
  } catch { return ''; }
  if (!note || note.role !== panel) return '';
  if (!(Date.now() - Number(note.at) <= HANDOFF_NOTE_TTL_MS)) return '';
  return staffHandoffLine(note.role, note.previousRole || '');
}
