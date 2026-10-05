import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionPayload, remoteToLocal } from '../js/sync-collections.js';
import { encodeRealtimeRecords, decodeRealtimeRecords } from '../js/realtime-value-codec.js';

test('routine classes keep the order the manager entered, not Firebase key order', () => {
  const classes = [
    { id: 'RTN-9', subject: 'প্রথম', time: '09:00' },
    { id: 'RTN-10', subject: 'দ্বিতীয়', time: '10:00' },
    { id: 'RTN-100', subject: 'তৃতীয়', time: '11:00' }
  ];
  const local = { sat: { date: '2026-09-29', classes } };
  const records = collectionPayload('routine', local);
  // Firebase returns object keys in key order: 'RTN-10' < 'RTN-100' < 'RTN-9'.
  const asReturnedByFirebase = Object.fromEntries(Object.keys(records).sort().map(key => [key, records[key]]));
  const restored = remoteToLocal('routine', asReturnedByFirebase);
  assert.deepEqual(restored.sat.classes.map(item => item.id), ['RTN-9', 'RTN-10', 'RTN-100']);
  assert.equal(restored.sat.date, '2026-09-29');
  for (const item of restored.sat.classes) {
    assert.equal(Object.hasOwn(item, '_syncDay'), false, 'transport markers never reach the app');
    assert.equal(Object.hasOwn(item, '_syncOrder'), false);
  }
  assert.deepEqual(restored.sun, { date: '', classes: [] });
});

test('a whole routine survives the transport codec unchanged', () => {
  const local = {
    sat: { date: '2026-09-29', classes: [{ id: 'R1', subject: 'গণিত', progress: {} }] },
    sun: { date: '', classes: [] }
  };
  const payload = collectionPayload('routine', local);
  const back = decodeRealtimeRecords(encodeRealtimeRecords(payload));
  const restored = remoteToLocal('routine', back);
  assert.deepEqual(restored.sat, local.sat);
  assert.deepEqual(restored.sun, { date: '', classes: [] });
  assert.deepEqual(Object.keys(restored), ['sat', 'sun', 'mon', 'tue', 'wed', 'thu']);
});

test('course library preserves stable ids, authorship, scope and publish state through RTDB transport', () => {
  const local = {
    version: 1, updatedAt: '2026-10-05T02:00:00.000Z', createdBy: 'teacher.apc',
    records: [
      { id: 'CONTENT-0001', classId: 'CLASS-10', subjectId: 'SUB-MATH', group: 'Batch A', chapterId: '', type: 'chapter', title: 'চ্যাপ্টার', published: true, active: true, updatedAt: '2026-10-05T01:00:00.000Z' },
      { id: 'CONTENT-0002', classId: 'CLASS-10', subjectId: 'SUB-MATH', group: 'Batch A', chapterId: 'CONTENT-0001', type: 'note', title: 'খসড়া', published: false, active: true, updatedAt: '2026-10-05T02:00:00.000Z' }
    ]
  };
  const payload = collectionPayload('courseContent', local);
  const remote = decodeRealtimeRecords(encodeRealtimeRecords(payload));
  const restored = remoteToLocal('courseContent', remote);
  assert.deepEqual(restored.records.sort((a, b) => a.id.localeCompare(b.id)), local.records.sort((a, b) => a.id.localeCompare(b.id)));
  assert.equal(restored.updatedAt, local.updatedAt);
  assert.deepEqual(collectionPayload('courseContent', restored), payload);
  assert.equal(collectionPayload('courseContent', { version: 2, records: [] }), null);
});

test('Academic Setup keeps class, subject, mapping and chapter ids through RTDB transport', () => {
  const local = {
    version: 2, seededDefaults: true, updatedAt: 1000, createdBy: 'manager.apc',
    classes: [{ id: 'CLASS-10', name: 'দশম শ্রেণি', active: true, order: 0, updatedAt: 1000 }],
    subjects: [{ id: 'SUB-MATH', name: 'গণিত', active: true, updatedAt: 1000 }],
    mappings: [{ id: 'MAP-1', classId: 'CLASS-10', subjectId: 'SUB-MATH', active: true, updatedAt: 1000 }],
    chapters: [{ id: 'CHAP-1', classId: 'CLASS-10', subjectId: 'SUB-MATH', name: 'বাস্তব সংখ্যা', active: true, order: 0, updatedAt: 1000 }]
  };
  const payload = collectionPayload('academics', local);
  const remote = decodeRealtimeRecords(encodeRealtimeRecords(payload));
  const restored = remoteToLocal('academics', remote);
  assert.deepEqual(restored, local);
  assert.deepEqual(collectionPayload('academics', restored), payload);
});

test('teaching keeps its document shape and settings pass through', () => {
  const teaching = { version: 1, activities: [{ id: 'A1', progress: {}, title: 'x' }] };
  assert.deepEqual(remoteToLocal('teaching', collectionPayload('teaching', teaching)), teaching);
  const settings = { appName: 'Active Plus', enabled: { dark: true } };
  assert.deepEqual(collectionPayload('settings', settings), settings);
  assert.deepEqual(remoteToLocal('settings', settings), settings);
  assert.equal(collectionPayload('settings', 'broken'), null);
  assert.equal(collectionPayload('teaching', { version: 2, activities: [] }), null, 'an unknown version is not uploaded');
});
