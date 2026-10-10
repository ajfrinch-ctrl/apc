/* The "written on this device" mark, split out of js/notification-rules.js.

   Why it exists: js/storage.js and js/office-data.js are on the boot path of
   every panel — they only need this storage key and this one pure stamping
   function. Importing them from js/notification-rules.js dragged the whole
   38 KB delivery-rules module (and everything it references) into the
   parser-blocking boot graph of the login screen. This module is the single
   source of both symbols; js/notification-rules.js re-exports them so every
   existing importer (page engine, Cloud Functions) keeps working untouched.

   Pure data in → data out, like the rules module it came from: no DOM, no
   storage access, no network. */

export const LOCAL_WRITE_KEY = 'activePlus.notifications.localWrite.v1';

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = value => (typeof value === 'string' ? value.trim() : '');

/* Records which collection/id pairs this device wrote, with a rolling 24 h
   window, so the author's own device can stay quiet about its own writes. */
export function markLocalSource(localWrites, collection, id, at = Date.now()) {
  const record = isObject(localWrites) ? { ...localWrites } : {};
  const map = isObject(record[collection]) ? { ...record[collection] } : {};
  map[text(id)] = Number(at) || Date.now();
  const cutoff = (Number(at) || Date.now()) - 24 * 60 * 60 * 1000;
  for (const [key, stamp] of Object.entries(map)) if (Number(stamp) < cutoff) delete map[key];
  record[collection] = map;
  return record;
}
