/* The cloud caps one sync row at 524,288 bytes of JSON.

   Before this guard a lecture sheet that outgrew the cap was rejected by
   Postgres, the local record still looked saved, and the student simply never
   received it. Two layers now stop that: the transport measures the encrypted
   payload it is about to send, and the course library refuses an oversized
   record in Bangla before anything is saved. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPage } from './jsdom-harness.mjs';
import { provisionStaff, seedStaffSession } from './staff-harness.mjs';
import {
  MAX_NODE_PAYLOAD_BYTES,
  PAYLOAD_TOO_LARGE,
  assertPayloadWithinLimit
} from '../sync/supabase-transport.js';
import {
  COURSE_CONTENT_KEY,
  COURSE_TOO_LARGE,
  MAX_COURSE_PLAINTEXT_BYTES,
  saveCourseRecord
} from '../js/course-content.js';
import { classByName, subjectByName } from '../js/academics.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(resolve(root, rel), 'utf8');

test('the client limit is the limit the database enforces', () => {
  assert.equal(MAX_NODE_PAYLOAD_BYTES, 524288);
  const migration = read('supabase/migrations/20261024000001_active_plus_realtime_sync.sql');
  assert.match(migration, /octet_length\(val::text\) <= 524288/, 'migration CHECK agrees with the client guard');
});

test('an ordinary encrypted payload passes through untouched', () => {
  const payload = { _apcEnc: 1, alg: 'AES-GCM', iv: 'AAAAAAAAAAAAAAAA', ct: 'x'.repeat(2048) };
  assert.equal(assertPayloadWithinLimit('activePlusSync/v1/courseContent/CONTENT-1', payload), payload);
  assert.equal(assertPayloadWithinLimit('activePlusSync/v1/x', null), null);
});

test('an oversized payload is refused locally with a typed error', () => {
  const payload = { _apcEnc: 1, ct: 'x'.repeat(MAX_NODE_PAYLOAD_BYTES + 10) };
  assert.throws(
    () => assertPayloadWithinLimit('activePlusSync/v1/courseContent/CONTENT-9', payload),
    err => {
      assert.equal(err.code, PAYLOAD_TOO_LARGE);
      assert.equal(err.code, 'payload-too-large');
      assert.equal(err.path, 'activePlusSync/v1/courseContent/CONTENT-9');
      assert.equal(err.limit, MAX_NODE_PAYLOAD_BYTES);
      assert.ok(err.bytes > MAX_NODE_PAYLOAD_BYTES);
      return true;
    }
  );
});

test('both Supabase write paths measure the payload before calling an RPC', () => {
  const src = read('sync/supabase-transport.js');
  assert.match(src, /assertPayloadWithinLimit\(norm, payload\)/, 'set() is guarded');
  assert.match(src, /assertPayloadWithinLimit\(norm, encryptedNext\)/, 'runTransaction() is guarded');
  const setIdx = src.indexOf("rpc('apc_set_subtree'");
  assert.ok(src.indexOf('assertPayloadWithinLimit(norm, payload)') < setIdx, 'the check runs before the write');
});

let ctx;

before(async () => {
  ctx = await loadPage('student.html', { seed: { 'activePlus.demo.autofill.v1': 'off' } });
  await provisionStaff('manager');
  seedStaffSession(ctx.window, 'manager');
});

after(() => ctx?.window.close());

function draft(patch = {}) {
  const academic = classByName('দশম শ্রেণি');
  const subject = subjectByName('গণিত');
  assert.ok(academic && subject, 'Academic Setup is seeded');
  return {
    classId: academic.id,
    subjectId: subject.id,
    type: 'note',
    title: 'সীমা পরীক্ষার নোট',
    description: '',
    content: 'ছোট লেখা',
    richContent: '<p>ছোট লেখা</p>',
    attachmentUrl: '',
    published: false,
    active: true,
    ...patch
  };
}

const storedCount = () => (JSON.parse(ctx.window.localStorage.getItem(COURSE_CONTENT_KEY) || '{}').records || []).length;

test('a normal record still saves', async () => {
  const saved = await saveCourseRecord(draft(), { role: 'manager', actor: 'ম্যানেজার' });
  assert.match(saved.id, /^CONTENT-/);
  assert.ok(storedCount() >= 1);
});

/* The existing document cap counts characters; a Bangla lecture of 150,000
   characters is ~450,000 bytes in UTF-8, which is what the row limit measures.
   This record passes the character cap and would have failed in the cloud. */
function bengaliDoc(chars) {
  const chunk = 30000;
  const nodes = [];
  for (let left = chars; left > 0; left -= chunk) {
    const size = Math.min(chunk, left);
    nodes.push({ type: 'paragraph', content: [{ type: 'text', text: 'অ'.repeat(size) }] });
  }
  return { type: 'doc', content: nodes };
}

test('a Bangla lecture that fits in characters but not in bytes is refused in Bangla and stores nothing', async () => {
  const before = ctx.window.localStorage.getItem(COURSE_CONTENT_KEY);
  await assert.rejects(
    () => saveCourseRecord(draft({ title: 'অতিরিক্ত বড় লেকচার', isLectureSheet: true, docJson: bengaliDoc(150000) }), {
      role: 'manager',
      actor: 'ম্যানেজার'
    }),
    err => {
      assert.equal(err.code, COURSE_TOO_LARGE);
      assert.equal(err.limit, MAX_COURSE_PLAINTEXT_BYTES);
      assert.ok(err.bytes > MAX_COURSE_PLAINTEXT_BYTES);
      assert.match(err.message, /সিঙ্কের সীমার বেশি বড়/);
      assert.match(err.message, /files\//, 'the remedy names the repository folder');
      return true;
    }
  );
  assert.equal(ctx.window.localStorage.getItem(COURSE_CONTENT_KEY), before, 'nothing was written');
});

test('the plaintext ceiling leaves room for the encrypted envelope', () => {
  /* base64url turns 3 plaintext bytes into 4 characters, so ciphertext is
     ~4/3 of the plaintext the record holds. */
  assert.ok(MAX_COURSE_PLAINTEXT_BYTES < MAX_NODE_PAYLOAD_BYTES * 3 / 4);
  assert.ok(MAX_COURSE_PLAINTEXT_BYTES > MAX_NODE_PAYLOAD_BYTES * 0.7);
});
