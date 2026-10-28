import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const original = readFileSync(new URL('../supabase/migrations/20261024000001_active_plus_realtime_sync.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261027000001_literal_sync_paths.sql', import.meta.url), 'utf8');

async function database() {
  // Embedded PostgreSQL, not a JavaScript model and never a production DB.
  const db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE PUBLICATION supabase_realtime;');
  await db.exec(original);
  return db;
}
const insert = (db, path, value) => db.query(
  'INSERT INTO public.apc_sync_nodes (path, val) VALUES ($1, $2::jsonb)',
  [path, JSON.stringify(value)]
);
const get = async (db, path) => (await db.query('SELECT public.apc_get_subtree($1) AS result', [path])).rows[0].result;
const set = async (db, path, value) => (await db.query(
  'SELECT public.apc_set_subtree($1, $2::jsonb) AS result',
  [path, value === null ? null : JSON.stringify(value)]
)).rows[0].result;

test('migration preserves rows and makes read, write, delete and CAS prefix checks literal', async t => {
  const db = await database();
  t.after(() => db.close());
  const root = 'activePlusSync/v1/students';
  const wanted = `${root}/student_1`;
  const sibling = `${root}/studentX1`;
  const percent = `${root}/%`;
  await insert(db, `${wanted}/entry`, { marker: 'wanted' });
  await insert(db, `${sibling}/entry`, { marker: 'sibling' });
  await insert(db, `${percent}/entry`, { marker: 'literal percent' });
  const before = (await db.query('SELECT path, val, rev, updated_at FROM public.apc_sync_nodes ORDER BY path')).rows;
  await db.exec(migration);
  const after = (await db.query('SELECT path, val, rev, updated_at FROM public.apc_sync_nodes ORDER BY path')).rows;
  assert.deepEqual(after, before, 'migration itself does not rewrite, remove, or re-encrypt any existing row');

  assert.deepEqual((await get(db, wanted)).value, { entry: { marker: 'wanted' } });
  assert.deepEqual((await get(db, percent)).value, { entry: { marker: 'literal percent' } });
  const wantedVersion = (await get(db, wanted)).version;
  await set(db, `${sibling}/entry`, { marker: 'changed sibling' });
  assert.equal((await get(db, wanted)).version, wantedVersion, 'a sibling does not influence this subtree CAS version');
  const cas = (await db.query('SELECT public.apc_cas_subtree($1, $2, $3::jsonb) AS result',
    [wanted, wantedVersion, JSON.stringify({ marker: 'own replacement' })])).rows[0].result;
  assert.equal(cas.committed, true);
  assert.deepEqual((await get(db, sibling)).value, { entry: { marker: 'changed sibling' } });
  await set(db, percent, null);
  assert.equal((await get(db, percent)).exists, false);
  assert.equal((await get(db, sibling)).exists, true, 'deleting a literal percent path must not delete other paths');
  await set(db, wanted, null);
  assert.equal((await get(db, wanted)).exists, false);
  assert.equal((await get(db, sibling)).exists, true, 'deleting an underscore path must not delete a similarly named sibling');
});

test('anonymous current-client wrappers keep working but the old public internal RPC is revoked', async t => {
  const db = await database();
  t.after(() => db.close());
  await db.exec(migration);
  const privileges = (await db.query(`SELECT
    has_function_privilege('anon', 'public.apc_write_subtree_internal(text,jsonb)', 'EXECUTE') AS old_helper,
    has_function_privilege('anon', 'public.apc_set_subtree(text,jsonb)', 'EXECUTE') AS setter,
    has_function_privilege('anon', 'public.apc_cas_subtree(text,text,jsonb)', 'EXECUTE') AS cas,
    has_function_privilege('anon', 'apc_internal.write_subtree(text,jsonb)', 'EXECUTE') AS private_helper,
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.apc_sync_nodes'::regclass) AS rls_on`)).rows[0];
  assert.deepEqual(privileges, { old_helper: false, setter: true, cas: true, private_helper: true, rls_on: true });
  await db.exec('SET ROLE anon');
  const path = 'activePlusSync/v1/notices/synthetic_1';
  assert.equal((await set(db, path, { id: 'synthetic_1' })).ok, true);
  assert.deepEqual((await get(db, path)).value, { id: 'synthetic_1' });
  await assert.rejects(db.query('SELECT public.apc_write_subtree_internal($1, NULL)', [path]), /permission denied/i);
  await db.exec('RESET ROLE');
});

test('chat expiration stays functional and malformed expiry/pin metadata cannot erase unrelated data', async t => {
  const db = await database();
  t.after(() => db.close());
  await db.exec(migration);
  const prefix = 'activePlusSync/v1/classChat/';
  await insert(db, `${prefix}expired`, { pinned: false, expiresAt: 1 });
  await insert(db, `${prefix}pinned`, { pinned: true, expiresAt: 1 });
  await insert(db, `${prefix}bad-pin`, { pinned: 'unknown', expiresAt: 1 });
  await insert(db, `${prefix}bad-expiry`, { pinned: false, expiresAt: '2026-99-99T99:99:99Z' });
  await set(db, 'activePlusSync/v1/classChatty/new', { marker: 1 });
  assert.equal((await get(db, `${prefix}expired`)).exists, true, 'a similarly named collection must not trigger chat cleanup');
  await set(db, `${prefix}new`, { pinned: false, expiresAt: Date.now() + 10000 });
  assert.equal((await get(db, `${prefix}expired`)).exists, false);
  for (const name of ['pinned', 'bad-pin', 'bad-expiry', 'new']) {
    assert.equal((await get(db, `${prefix}${name}`)).exists, true, name);
  }
});
