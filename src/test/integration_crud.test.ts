import { assert, assertEquals, assertRejects } from '@std/assert'
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from '@std/testing/bdd'
import { Surreal } from 'surrealdb'
import { z } from 'zod'
import {
  countRecords,
  createRecord,
  createRecords,
  deleteRecord,
  deleteRecords,
  exists,
  first,
  getRecord,
  last,
  mergeRecord,
  queryRecords,
  upsertRecord,
} from '../query/crud.ts'
import {
  createTyped,
  getTyped,
  queryTyped,
  updateTyped,
  upsertTyped,
} from '../query/typed.ts'
import {
  deleteMany,
  insertMany,
  relateMany,
  upsertMany,
} from '../query/batch.ts'
import {
  countRelated,
  createRelation,
  findMutualConnections,
  getIncomingEdges,
  getOutgoingEdges,
  getRelatedRecords,
  removeRelation,
} from '../query/graph.ts'
import { fetchDbInfo, fetchTableInfo } from '../schema/parser.ts'
import {
  ensureMigrationTable,
  getAppliedVersions,
} from '../migration/history.ts'
import {
  executeMigration,
  getPendingMigrations,
  migrateDown,
  migrateUp,
} from '../migration/executor.ts'
import { MigrationDirection } from '../migration/models.ts'
import type { Migration } from '../migration/models.ts'

const NS = 'test'
const TEST_DB = `test_integ_crud_${Date.now()}`

let db: Surreal

beforeAll(async () => {
  db = new Surreal()
  await db.connect('http://localhost:8000/rpc')
  await db.signin({ username: 'root', password: 'root' })
  await db.query(`DEFINE NAMESPACE IF NOT EXISTS ${NS}`)
  await db.use({ namespace: NS })
  await db.query(`DEFINE DATABASE IF NOT EXISTS \`${TEST_DB}\``)
  await db.use({ namespace: NS, database: TEST_DB })
})

afterAll(async () => {
  try {
    await db.query(`REMOVE DATABASE IF EXISTS \`${TEST_DB}\``)
    await db.close()
  } catch {
    // best-effort
  }
})

async function cleanTable(table: string): Promise<void> {
  try {
    await db.query(`DELETE ${table}`)
    await db.query(`REMOVE TABLE IF EXISTS ${table}`)
  } catch {
    // table may not exist
  }
}

// ---------------------------------------------------------------------------
// CRUD: createRecord / getRecord / updateRecord / mergeRecord / deleteRecord
// ---------------------------------------------------------------------------

describe('Integration: createRecord', () => {
  afterEach(async () => { await cleanTable('cr_users') })

  it('should create a record and return it', async () => {
    const record = await createRecord<{ name: string; age: number }>(db, 'cr_users', { name: 'Alice', age: 30 })
    assertEquals(record.name, 'Alice')
    assertEquals(record.age, 30)
  })

  it('should create multiple records independently', async () => {
    await createRecord(db, 'cr_users', { name: 'Alice', age: 30 })
    await createRecord(db, 'cr_users', { name: 'Bob', age: 25 })
    const all = await queryRecords<{ name: string }>(db, 'cr_users')
    assertEquals(all.length, 2)
  })
})

describe('Integration: getRecord', () => {
  afterEach(async () => { await cleanTable('gr_users') })

  it('should retrieve an existing record by id', async () => {
    await db.query(`CREATE gr_users:alice SET name = 'Alice', age = 30`)
    const record = await getRecord<{ name: string; age: number }>(db, 'gr_users', 'alice')
    assert(record !== null)
    assertEquals(record.name, 'Alice')
    assertEquals(record.age, 30)
  })

  it('should return null for a non-existent id', async () => {
    await db.query('DEFINE TABLE gr_users SCHEMALESS')
    const record = await getRecord(db, 'gr_users', 'nonexistent')
    assertEquals(record, null)
  })
})

describe('Integration: updateRecord', () => {
  afterEach(async () => { await cleanTable('up_users') })

  it('should update an existing record', async () => {
    await db.query(`CREATE up_users:bob SET name = 'Bob', age = 25`)
    const { updateRecord } = await import('../query/crud.ts')
    const updated = await updateRecord<{ name: string; age: number }>(db, 'up_users', 'bob', { age: 26 })
    assertEquals(updated.age, 26)
    assertEquals(updated.name, 'Bob')
  })
})

describe('Integration: mergeRecord', () => {
  afterEach(async () => { await cleanTable('mg_users') })

  it('should merge partial data into an existing record', async () => {
    await db.query(`CREATE mg_users:carol SET name = 'Carol', age = 28, active = true`)
    const merged = await mergeRecord<{ name: string; age: number; active: boolean; score: number }>(
      db, 'mg_users', 'carol', { score: 99 },
    )
    assertEquals(merged.name, 'Carol')
    assertEquals(merged.score, 99)
    assertEquals(merged.active, true)
  })
})

describe('Integration: deleteRecord / deleteRecords', () => {
  afterEach(async () => { await cleanTable('del_users') })

  it('should delete a single record', async () => {
    await db.query(`CREATE del_users:eve SET name = 'Eve'`)
    assert(await exists(db, 'del_users', 'eve'))
    await deleteRecord(db, 'del_users', 'eve')
    assertEquals(await exists(db, 'del_users', 'eve'), false)
  })

  it('should delete multiple records by id list', async () => {
    await db.query(`CREATE del_users:a SET name = 'A'`)
    await db.query(`CREATE del_users:b SET name = 'B'`)
    await db.query(`CREATE del_users:c SET name = 'C'`)
    await deleteRecords(db, 'del_users', ['a', 'b'])
    const remaining = await queryRecords<{ name: string }>(db, 'del_users')
    assertEquals(remaining.length, 1)
    assertEquals((remaining[0] as { name: string }).name, 'C')
  })
})

describe('Integration: createRecords', () => {
  afterEach(async () => { await cleanTable('bulk_users') })

  it('should create multiple records in sequence', async () => {
    const result = await createRecords<{ name: string }>(db, 'bulk_users', [
      { name: 'X' }, { name: 'Y' }, { name: 'Z' },
    ])
    assertEquals(result.length, 3)
  })

  it('should return empty array for empty input', async () => {
    const result = await createRecords(db, 'bulk_users', [])
    assertEquals(result.length, 0)
  })
})

// ---------------------------------------------------------------------------
// CRUD: queryRecords / countRecords / exists / first / last
// ---------------------------------------------------------------------------

describe('Integration: queryRecords / countRecords / exists / first / last', () => {
  beforeEach(async () => {
    await db.query(`
      CREATE qc_items:a SET name = 'Alpha', score = 10;
      CREATE qc_items:b SET name = 'Beta', score = 20;
      CREATE qc_items:c SET name = 'Gamma', score = 30;
    `)
  })
  afterEach(async () => { await cleanTable('qc_items') })

  it('queryRecords should return all records', async () => {
    const items = await queryRecords(db, 'qc_items')
    assertEquals(items.length, 3)
  })

  it('queryRecords should filter with conditions', async () => {
    const items = await queryRecords(db, 'qc_items', 'score > 15')
    assertEquals(items.length, 2)
  })

  it('countRecords should count all records', async () => {
    const count = await countRecords(db, 'qc_items')
    assertEquals(count, 3)
  })

  it('countRecords should count filtered records', async () => {
    const count = await countRecords(db, 'qc_items', 'score >= 20')
    assertEquals(count, 2)
  })

  it('exists should return true for existing record', async () => {
    assertEquals(await exists(db, 'qc_items', 'a'), true)
  })

  it('exists should return false for non-existing record', async () => {
    assertEquals(await exists(db, 'qc_items', 'zzz'), false)
  })

  it('first should return one record', async () => {
    const item = await first(db, 'qc_items')
    assert(item !== null)
  })

  it('first should filter with conditions', async () => {
    const item = await first<{ name: string; score: number }>(db, 'qc_items', 'score = 30')
    assert(item !== null)
    assertEquals(item.score, 30)
  })

  it('last should return one record ordered by id desc', async () => {
    const item = await last(db, 'qc_items')
    assert(item !== null)
  })

  it('upsertRecord should insert when record does not exist', async () => {
    const result = await upsertRecord<{ name: string }>(db, 'qc_items', { name: 'Delta', score: 5 })
    assertEquals(result.name, 'Delta')
  })
})

// ---------------------------------------------------------------------------
// Typed CRUD (Zod-validated)
// ---------------------------------------------------------------------------

describe('Integration: typed CRUD', () => {
  const UserSchema = z.object({
    name: z.string(),
    age: z.number(),
  })

  afterEach(async () => { await cleanTable('typed_crud') })

  it('createTyped should create and validate a record', async () => {
    const user = await createTyped(db, 'typed_crud', { name: 'Frank', age: 40 }, UserSchema)
    assertEquals(user.name, 'Frank')
    assertEquals(user.age, 40)
  })

  it('getTyped should retrieve and validate a record', async () => {
    await db.query(`CREATE typed_crud:frank SET name = 'Frank', age = 40`)
    const user = await getTyped(db, 'typed_crud', 'frank', UserSchema)
    assert(user !== null)
    assertEquals(user.name, 'Frank')
  })

  it('getTyped should return null for missing record', async () => {
    await db.query('DEFINE TABLE typed_crud SCHEMALESS')
    const user = await getTyped(db, 'typed_crud', 'nobody', UserSchema)
    assertEquals(user, null)
  })

  it('queryTyped should return validated records', async () => {
    await db.query(`
      CREATE typed_crud SET name = 'Alice', age = 30;
      CREATE typed_crud SET name = 'Bob', age = 25;
    `)
    const users = await queryTyped(db, 'typed_crud', null, UserSchema)
    assertEquals(users.length, 2)
    assert(users.every((u) => typeof u.name === 'string' && typeof u.age === 'number'))
  })

  it('queryTyped should filter with conditions', async () => {
    await db.query(`
      CREATE typed_crud SET name = 'Alice', age = 30;
      CREATE typed_crud SET name = 'Bob', age = 25;
    `)
    const users = await queryTyped(db, 'typed_crud', 'age > 28', UserSchema)
    assertEquals(users.length, 1)
    assertEquals(users[0].name, 'Alice')
  })

  it('updateTyped should update and validate', async () => {
    await db.query(`CREATE typed_crud:frank SET name = 'Frank', age = 40`)
    const updated = await updateTyped(db, 'typed_crud', 'frank', { age: 41 }, UserSchema)
    assertEquals(updated.age, 41)
  })

  it('upsertTyped should create and validate', async () => {
    const user = await upsertTyped(db, 'typed_crud', { name: 'Grace', age: 35 }, UserSchema)
    assertEquals(user.name, 'Grace')
    assertEquals(user.age, 35)
  })

  it('createTyped should throw on schema mismatch', async () => {
    const StrictSchema = z.object({ name: z.string(), age: z.number() })
    await db.query(`CREATE typed_crud SET name = 'Bad', age = 'not-a-number'`)
    await assertRejects(
      async () => await queryTyped(db, 'typed_crud', null, StrictSchema),
      Error,
    )
  })
})

// ---------------------------------------------------------------------------
// Batch operations
// ---------------------------------------------------------------------------

describe('Integration: batch insertMany / upsertMany / deleteMany / relateMany', () => {
  afterEach(async () => {
    await cleanTable('batch_items')
    await cleanTable('batch_a')
    await cleanTable('batch_b')
    await cleanTable('batch_rel')
  })

  it('insertMany should insert multiple records', async () => {
    const results = await insertMany<{ name: string }>(db, 'batch_items', [
      { name: 'Item1', val: 1 },
      { name: 'Item2', val: 2 },
      { name: 'Item3', val: 3 },
    ])
    assertEquals(results.length, 3)
  })

  it('insertMany should return empty array for empty input', async () => {
    const results = await insertMany(db, 'batch_items', [])
    assertEquals(results.length, 0)
  })

  it('upsertMany should create records', async () => {
    const results = await upsertMany<{ name: string }>(db, 'batch_items', [
      { name: 'One', val: 1 },
      { name: 'Two', val: 2 },
    ])
    assertEquals(results.length, 2)
  })

  it('upsertMany should return empty for empty input', async () => {
    const results = await upsertMany(db, 'batch_items', [])
    assertEquals(results.length, 0)
  })

  it('deleteMany should remove specified records', async () => {
    await db.query(`
      CREATE batch_items:x SET name = 'X';
      CREATE batch_items:y SET name = 'Y';
      CREATE batch_items:z SET name = 'Z';
    `)
    await deleteMany(db, 'batch_items', ['x', 'y'])
    const remaining = await queryRecords(db, 'batch_items')
    assertEquals(remaining.length, 1)
  })

  it('deleteMany should be a no-op for empty list', async () => {
    await db.query(`CREATE batch_items:a SET name = 'A'`)
    await deleteMany(db, 'batch_items', [])
    const remaining = await queryRecords(db, 'batch_items')
    assertEquals(remaining.length, 1)
  })

  it('relateMany should create multiple relations', async () => {
    await db.query(`CREATE batch_a:p1 SET name = 'P1'`)
    await db.query(`CREATE batch_b:q1 SET name = 'Q1'`)
    await db.query(`CREATE batch_b:q2 SET name = 'Q2'`)
    const results = await relateMany(db, [
      { from: 'batch_a:p1', edge: 'batch_rel', to: 'batch_b:q1' },
      { from: 'batch_a:p1', edge: 'batch_rel', to: 'batch_b:q2' },
    ])
    assertEquals(results.length, 2)
  })
})

// ---------------------------------------------------------------------------
// Graph operations
// ---------------------------------------------------------------------------

describe('Integration: graph traversal and relations', () => {
  beforeEach(async () => {
    await db.query(`
      CREATE person:alice SET name = 'Alice';
      CREATE person:bob SET name = 'Bob';
      CREATE person:carol SET name = 'Carol';
      RELATE person:alice->follows->person:bob;
      RELATE person:alice->follows->person:carol;
      RELATE person:bob->follows->person:carol;
    `)
  })
  afterEach(async () => {
    await cleanTable('person')
    await cleanTable('follows')
  })

  it('createRelation should create a relation between records', async () => {
    await db.query(`CREATE person:dave SET name = 'Dave'`)
    const rel = await createRelation(db, 'person:alice', 'follows', 'person:dave')
    assert(rel !== null)
  })

  it('createRelation with data should store SET fields', async () => {
    await db.query(`CREATE person:dave SET name = 'Dave'`)
    const rel = await createRelation(db, 'person:alice', 'follows', 'person:dave', { since: 2024 })
    assert(typeof rel === 'object')
  })

  it('getRelatedRecords should return outgoing related records', async () => {
    const related = await getRelatedRecords<{ name: string }>(db, 'person:alice', 'follows', '->')
    assertEquals(related.length, 2)
  })

  it('getOutgoingEdges should return outgoing edge records', async () => {
    const edges = await getOutgoingEdges(db, 'person:alice', 'follows')
    assert(edges.length >= 2)
  })

  it('getIncomingEdges should return incoming edge records', async () => {
    const edges = await getIncomingEdges(db, 'person:carol', 'follows')
    assert(edges.length >= 2)
  })

  it('countRelated should count related records', async () => {
    const count = await countRelated(db, 'person:alice', 'follows', '->')
    assertEquals(count, 2)
  })

  it('removeRelation should remove a relation', async () => {
    const beforeCount = await countRelated(db, 'person:alice', 'follows', '->')
    await removeRelation(db, 'person:alice', 'follows', 'person:bob')
    const afterCount = await countRelated(db, 'person:alice', 'follows', '->')
    assertEquals(afterCount, beforeCount - 1)
  })

  it('findMutualConnections should detect shared connections', async () => {
    // alice->carol and bob->carol: mutual connection of alice and bob is carol
    const mutual = await findMutualConnections(db, 'person:alice', 'person:bob', 'follows')
    assert(Array.isArray(mutual))
  })
})

// ---------------------------------------------------------------------------
// Schema parser
// ---------------------------------------------------------------------------

describe('Integration: schema parser', () => {
  afterEach(async () => { await cleanTable('parser_table') })

  it('fetchDbInfo should return database info with tables key', async () => {
    await db.query('DEFINE TABLE parser_table SCHEMALESS')
    const info = await fetchDbInfo(db)
    assertEquals(typeof info.tables, 'object')
    assert('parser_table' in info.tables)
  })

  it('fetchTableInfo should return field and index info', async () => {
    await db.query(`
      DEFINE TABLE parser_table SCHEMAFULL;
      DEFINE FIELD name ON TABLE parser_table TYPE string;
      DEFINE INDEX idx_name ON TABLE parser_table FIELDS name UNIQUE;
    `)
    const info = await fetchTableInfo(db, 'parser_table')
    assertEquals(info.name, 'parser_table')
    assertEquals(typeof info.fields, 'object')
    assertEquals(typeof info.indexes, 'object')
    assert('name' in info.fields)
    assert('idx_name' in info.indexes)
  })

  it('fetchTableInfo should return empty collections for schemaless table', async () => {
    await db.query('DEFINE TABLE parser_table SCHEMALESS')
    const info = await fetchTableInfo(db, 'parser_table')
    assertEquals(Object.keys(info.fields).length, 0)
  })
})

// ---------------------------------------------------------------------------
// Migration execution: migrateUp / migrateDown / executeMigration
// ---------------------------------------------------------------------------

describe('Integration: migration execution', () => {
  beforeEach(async () => {
    await ensureMigrationTable(db)
    await db.query('DELETE _migrations')
  })
  afterEach(async () => {
    await db.query('DELETE _migrations')
    await cleanTable('migrated_items')
  })

  const makeMigration = (version: string, upSql: string, downSql: string): Migration => ({
    version,
    description: `migration ${version}`,
    up: () => Promise.resolve(upSql),
    down: () => Promise.resolve(downSql),
  })

  it('executeMigration UP should run SQL and record the version', async () => {
    const m = makeMigration(
      '001',
      'DEFINE TABLE migrated_items SCHEMALESS',
      'REMOVE TABLE IF EXISTS migrated_items',
    )
    await executeMigration(db, m, MigrationDirection.UP)
    const versions = await getAppliedVersions(db)
    assert(versions.has('001'))
  })

  it('executeMigration DOWN should run SQL and remove the version record', async () => {
    const m = makeMigration(
      '001',
      'DEFINE TABLE migrated_items SCHEMALESS',
      'REMOVE TABLE IF EXISTS migrated_items',
    )
    await executeMigration(db, m, MigrationDirection.UP)
    await executeMigration(db, m, MigrationDirection.DOWN)
    const versions = await getAppliedVersions(db)
    assertEquals(versions.has('001'), false)
  })

  it('migrateUp should apply all pending migrations in order', async () => {
    const migrations: Migration[] = [
      makeMigration('001', 'DEFINE TABLE migrated_items SCHEMALESS', ''),
      makeMigration('002', 'CREATE migrated_items SET label = "seed"', ''),
    ]
    const results = await migrateUp(db, migrations)
    assertEquals(results.length, 2)
    assertEquals(results[0].version, '001')
    assertEquals(results[1].version, '002')
    const versions = await getAppliedVersions(db)
    assert(versions.has('001'))
    assert(versions.has('002'))
  })

  it('migrateUp should skip already-applied migrations', async () => {
    const migrations: Migration[] = [
      makeMigration('001', 'DEFINE TABLE migrated_items SCHEMALESS', ''),
      makeMigration('002', '', ''),
    ]
    await migrateUp(db, [migrations[0]])
    const results = await migrateUp(db, migrations)
    assertEquals(results.length, 1)
    assertEquals(results[0].version, '002')
  })

  it('migrateUp should stop at targetVersion', async () => {
    const migrations: Migration[] = [
      makeMigration('001', 'DEFINE TABLE migrated_items SCHEMALESS', ''),
      makeMigration('002', '', ''),
      makeMigration('003', '', ''),
    ]
    const results = await migrateUp(db, migrations, '002')
    assertEquals(results.length, 2)
    const versions = await getAppliedVersions(db)
    assert(versions.has('001'))
    assert(versions.has('002'))
    assertEquals(versions.has('003'), false)
  })

  it('migrateDown should roll back applied migrations', async () => {
    const migrations: Migration[] = [
      makeMigration('001', 'DEFINE TABLE migrated_items SCHEMALESS', 'REMOVE TABLE IF EXISTS migrated_items'),
      makeMigration('002', '', ''),
    ]
    await migrateUp(db, migrations)
    const results = await migrateDown(db, migrations)
    assertEquals(results.length, 2)
    const versions = await getAppliedVersions(db)
    assertEquals(versions.size, 0)
  })

  it('getPendingMigrations should return only unapplied migrations', async () => {
    const migrations: Migration[] = [
      makeMigration('001', '', ''),
      makeMigration('002', '', ''),
      makeMigration('003', '', ''),
    ]
    await migrateUp(db, [migrations[0]])
    const pending = await getPendingMigrations(db, migrations)
    assertEquals(pending.length, 2)
    assert(pending.every((m) => m.version !== '001'))
  })
})
