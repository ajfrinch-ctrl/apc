/* Preserve each local collection's schema while mirroring stable record IDs.
   Exams use their dedicated bridge; these adapters cover generic outbox data. */
import { trimSyncLeafHistory } from './sync-leaf-budget.js';
const DAYS = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu'];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const safeRows = value => Array.isArray(value) ? value.filter(item => item && typeof item.id === 'string' && item.id) : [];
const recordTime = value => {
  if (Number.isFinite(value)) return value;
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
};
const maxRecordTime = rows => rows.reduce((max, item) => Math.max(max, recordTime(item?.updatedAt || item?.createdAt)), 0);
const metadataRow = fields => ({ id: '__metadata', _syncKind: 'metadata', ...fields });

export function collectionPayload(collection, value) {
  if (value === null) return null;
  if (collection === 'settings') return object(value) ? value : null;
  if (collection === 'routine') {
    if (!object(value)) return null;
    const entries = [];
    for (const day of DAYS) {
      const info = value[day];
      if (!info) continue;
      entries.push(['day-' + day, { _syncDay: day, _syncDate: true, date: info.date || '' }]);
      for (const [index, item] of (info.classes || []).entries()) {
        const id = item.id || `legacy-${day}-${index}`;
        // `_syncOrder` keeps the period order if Firebase returns map keys
        // rather than insertion order.
        entries.push([id, { ...item, id, _syncDay: day, _syncOrder: index }]);
      }
    }
    return Object.fromEntries(entries);
  }
  if (collection === 'teaching' && value?.version !== 1) return null;
  if (collection === 'teaching') {
    return Object.fromEntries(safeRows(value.activities).map(item => [item.id, item]));
  }
  if (collection === 'courses') {
    if (value?.version !== 1 || !Array.isArray(value.courses)) return null;
    return Object.fromEntries(safeRows(value.courses).map(item => [item.id, item]));
  }
  if (collection === 'courseContent') {
    if (value?.version !== 1 || !Array.isArray(value.records)) return null;
    const records = safeRows(value.records);
    const meta = metadataRow({
      version: 1,
      updatedAt: value.updatedAt || maxRecordTime(records),
      createdBy: value.createdBy || 'SYNC'
    });
    /* A legacy record whose history alone blows the cloud leaf budget used to
       abort the WHOLE courseContent CAS — no student ever received anything.
       Shed history on the cloud-bound copy only (in place copies are never
       mutated); a record still over budget with no history cannot be shipped,
       and the publish path refuses to create one from now on. */
    return Object.fromEntries([
      ['__metadata', meta],
      ...records.map(record => [record.id, { _syncKind: 'record', record: trimSyncLeafHistory(record) }])
    ]);
  }
  if (collection === 'questionBank') {
    if (value?.version !== 1 || !Array.isArray(value.questions)) return null;
    const records = safeRows(value.questions);
    const meta = metadataRow({
      version: 1,
      updatedAt: value.updatedAt || maxRecordTime(records),
      createdBy: value.createdBy || 'SYNC'
    });
    return Object.fromEntries([
      ['__metadata', meta],
      ...records.map(record => [record.id, { _syncKind: 'record', record }])
    ]);
  }
  if (collection === 'academics') {
    if (value?.version !== 2 || !Array.isArray(value.classes) || !Array.isArray(value.subjects)
      || !Array.isArray(value.mappings) || !Array.isArray(value.chapters)) return null;
    const groups = [
      ['class', value.classes], ['subject', value.subjects],
      ['mapping', value.mappings], ['chapter', value.chapters]
    ];
    const rows = groups.flatMap(([kind, list]) => safeRows(list)
      .map(record => [`${kind}-${record.id}`, { _syncKind: kind, record }]));
    return Object.fromEntries([
      ['__metadata', metadataRow({
        version: 2, seededDefaults: value.seededDefaults === true,
        updatedAt: value.updatedAt || maxRecordTime(groups.flatMap(([, list]) => list)),
        createdBy: value.createdBy || 'SYNC'
      })],
      ...rows
    ]);
  }
  if (collection === 'classChat') {
    if (!object(value) || (value.version !== 1 && !Array.isArray(value.messages) && !object(value.rooms))) return null;
    const messages = safeRows(Array.isArray(value.messages) ? value.messages : []);
    const roomEntries = Object.entries(object(value.rooms) ? value.rooms : {})
      .filter(([key, room]) => key && object(room) && !/[.#$/[\]]/.test(key))
      .map(([roomKey, room]) => {
        const updatedAt = room.updatedAt || 1;
        return [`room-${roomKey}`, { _syncKind: 'room', updatedAt, record: { ...room, id: room.id || roomKey, roomKey, updatedAt } }];
      });
    const msgEntries = messages.map(msg => {
      const reactions = {};
      for (const [emoji, list] of Object.entries(object(msg.reactions) ? msg.reactions : {})) {
        const ids = Array.isArray(list) ? list.filter(Boolean) : object(list) ? Object.keys(list).filter(k => list[k]) : [];
        if (ids.length) reactions[emoji] = Object.fromEntries(ids.map(id => [String(id).replace(/[.#$/[\]]/g, '_'), true]));
      }
      const updatedAt = msg.updatedAt || Date.parse(msg.createdAt || '') || 1;
      return [`msg-${msg.id}`, { _syncKind: 'message', updatedAt, record: { ...msg, reactions, updatedAt } }];
    });
    return Object.fromEntries([
      ['__metadata', metadataRow({
        version: 1,
        updatedAt: value.updatedAt || maxRecordTime(messages),
        createdBy: value.createdBy || 'SYNC'
      })],
      ...roomEntries,
      ...msgEntries
    ]);
  }
  const items = Array.isArray(value) ? safeRows(value) : null;
  if (!items) return null;
  return Object.fromEntries(items.map(item => [item.id, item]));
}

export function remoteToLocal(collection, value) {
  if (collection === 'settings') return value || {};
  const items = Object.values(value || {}).filter(Boolean);
  if (collection === 'routine') {
    const week = Object.fromEntries(DAYS.map(day => [day, { date: '', classes: [] }]));
    const classes = Object.fromEntries(DAYS.map(day => [day, []]));
    items.forEach((record, index) => {
      if (!DAYS.includes(record._syncDay)) return;
      const { _syncDay: day, _syncDate: dateOnly, _syncOrder: order, ...item } = record;
      if (dateOnly) { week[day].date = item.date || ''; return; }
      classes[day].push({ item, order: typeof order === 'number' ? order : null, index });
    });
    for (const day of DAYS) {
      week[day].classes = classes[day].sort((left, right) => {
        if (left.order === null && right.order === null) return 0;
        if (left.order === null) return 1;
        if (right.order === null) return -1;
        return left.order - right.order;
      }).map(entry => entry.item);
    }
    return week;
  }
  if (collection === 'teaching') return {
    version: 1,
    activities: items.map(item => ({ ...item, progress: item.progress || {} }))
  };
  if (collection === 'courses') return {
    version: 1,
    courses: items.map(item => ({ ...item, chapters: Array.isArray(item.chapters) ? item.chapters : [] }))
  };
  if (collection === 'courseContent') {
    const meta = items.find(item => item._syncKind === 'metadata') || {};
    return {
      version: 1,
      updatedAt: meta.updatedAt || maxRecordTime(items.map(item => item.record).filter(Boolean)),
      createdBy: meta.createdBy || 'SYNC',
      records: items.filter(item => item._syncKind === 'record' && object(item.record)).map(item => item.record)
    };
  }
  if (collection === 'questionBank') {
    const meta = items.find(item => item._syncKind === 'metadata') || {};
    return {
      version: 1,
      updatedAt: meta.updatedAt || maxRecordTime(items.map(item => item.record).filter(Boolean)),
      createdBy: meta.createdBy || 'SYNC',
      questions: items.filter(item => item._syncKind === 'record' && object(item.record)).map(item => item.record)
    };
  }
  if (collection === 'academics') {
    const meta = items.find(item => item._syncKind === 'metadata') || {};
    const records = kind => items.filter(item => item._syncKind === kind && object(item.record)).map(item => item.record);
    const byOrder = rows => rows.sort((left, right) => (Number(left.order) || 0) - (Number(right.order) || 0)
      || String(left.id).localeCompare(String(right.id)));
    return {
      version: 2,
      classes: byOrder(records('class')),
      subjects: records('subject').sort((left, right) => String(left.name).localeCompare(String(right.name), 'bn')),
      mappings: byOrder(records('mapping')),
      chapters: byOrder(records('chapter')),
      seededDefaults: meta.seededDefaults === true,
      updatedAt: meta.updatedAt || Date.now(),
      createdBy: meta.createdBy || 'SYNC'
    };
  }
  if (collection === 'classChat') {
    const meta = items.find(item => item._syncKind === 'metadata') || {};
    const rooms = {};
    for (const item of items) {
      if (item._syncKind === 'room' && object(item.record) && item.record.roomKey) {
        rooms[item.record.roomKey] = item.record;
      }
    }
    const messages = items
      .filter(item => item._syncKind === 'message' && object(item.record))
      .map(item => {
        const rawReactions = object(item.record.reactions) ? item.record.reactions : {};
        const reactions = {};
        for (const [emoji, val] of Object.entries(rawReactions)) {
          const ids = Array.isArray(val) ? val.filter(Boolean) : object(val) ? Object.keys(val).filter(k => val[k]) : [];
          if (ids.length) reactions[emoji] = ids;
        }
        return { ...item.record, reactions };
      })
      .sort((a, b) => (Date.parse(a.createdAt || '') || 0) - (Date.parse(b.createdAt || '') || 0)
        || String(a.id || '').localeCompare(String(b.id || '')));
    return {
      version: 1,
      rooms,
      messages,
      updatedAt: meta.updatedAt || maxRecordTime(messages)
    };
  }
  return items;
}
