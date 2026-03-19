import { assert, assertEquals } from '@std/assert'
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from '@std/testing/bdd'
import { Surreal } from 'surrealdb'
import { z } from 'zod'
import { executeRawTyped } from '../query/executor.ts'
import { queryRecordsWrapped } from '../query/crud.ts'
import { select } from '../query/builder.ts'
import { fetchAll, fetchMany, fetchOne, fetchRecord } from '../query/executor.ts'
import { getAppliedMigrationsOrdered } from '../migration/executor.ts'
import { executeRollback, RollbackSafety } from '../migration/rollback.ts'
import type { Migration, MigrationDirection } from '../migration/models.ts'
import {
  ensureMigrationTable,
  getAppliedVersions,
  recordMigration,
  removeMigrationRecord,
} from '../migration/history.ts'

const NS = 'test'
const TEST_DB = `test_integ_${Date.now()}`

let db: Surreal

beforeAll(async () => {
  db = new Surreal()
  await db.connect('http://localhost:8000/rpc')
  await db.signin({ username: 'root', password: 'root' })
  // Ensure ns/db exist before USE
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
    // best-effort cleanup
  }
})

async function cleanTable(table: string): Promise<void> {
  try {
    await db.query(`DELETE ${table}`)
    await db.query(`REMOVE TABLE IF EXISTS ${table}`)
  } catch {
    // table may not exist yet
  }
}

describe('Integration: executeRawTyped', () => {
  const UserSchema = z.object({
    name: z.string(),
    age: z.number(),
  })

  afterEach(async () => {
    await cleanTable('typed_users')
  })

  it('should execute raw SQL and validate against Zod schema', async () => {
    await db.query(`
      CREATE typed_users SET name = 'Alice', age = 30;
      CREATE typed_users SET name = 'Bob', age = 25;
    `)

    const results = await executeRawTyped(
      db,
      'SELECT name, age FROM typed_users ORDER BY name ASC',
      UserSchema,
    )

    assertEquals(results.length, 2)
    assertEquals(results[0].name, 'Alice')
    assertEquals(results[0].age, 30)
    assertEquals(results[1].name, 'Bob')
    assertEquals(results[1].age, 25)
  })

  it('should return empty array for no results', async () => {
    await db.query('DEFINE TABLE typed_users SCHEMALESS')
    const results = await executeRawTyped(
      db,
      'SELECT name, age FROM typed_users',
      UserSchema,
    )
    assertEquals(results, [])
  })

  it('should throw on schema validation failure', async () => {
    await db.query(`CREATE typed_users SET name = 'Charlie', age = 'not_a_number'`)

    const StrictSchema = z.object({
      name: z.string(),
      age: z.number(),
    })

    try {
      await executeRawTyped(
        db,
        'SELECT name, age FROM typed_users',
        StrictSchema,
      )
      assert(false, 'Should have thrown')
    } catch (e) {
      assert(e instanceof Error)
    }
  })

  it('should work with parameterized queries', async () => {
    await db.query(`CREATE typed_users SET name = 'Diana', age = 28`)

    const results = await executeRawTyped(
      db,
      'SELECT name, age FROM typed_users WHERE name = $name',
      UserSchema,
      { name: 'Diana' },
    )

    assertEquals(results.length, 1)
    assertEquals(results[0].name, 'Diana')
  })
})

describe('Integration: queryRecordsWrapped', () => {
  afterEach(async () => {
    await cleanTable('wrapped_items')
  })

  it('should return ListResult from table query', async () => {
    await db.query(`
      CREATE wrapped_items SET title = 'A', priority = 1;
      CREATE wrapped_items SET title = 'B', priority = 2;
      CREATE wrapped_items SET title = 'C', priority = 3;
    `)

    const result = await queryRecordsWrapped(db, 'wrapped_items')

    assertEquals(result.total, 3)
    assertEquals(result.records.length, 3)
    assertEquals(result.first() !== null, true)
    assertEquals(result.last() !== null, true)
  })

  it('should support conditions', async () => {
    await db.query(`
      CREATE wrapped_items SET title = 'Low', priority = 1;
      CREATE wrapped_items SET title = 'High', priority = 10;
    `)

    const result = await queryRecordsWrapped(db, 'wrapped_items', {
      conditions: 'priority > 5',
    })

    assertEquals(result.total, 1)
  })

  it('should support orderBy', async () => {
    await db.query(`
      CREATE wrapped_items SET title = 'B', priority = 2;
      CREATE wrapped_items SET title = 'A', priority = 1;
    `)

    const result = await queryRecordsWrapped<{ title: string; priority: number }>(
      db,
      'wrapped_items',
      { orderBy: { field: 'priority', direction: 'ASC' } },
    )

    assertEquals(result.records.length, 2)
    const first = result.first() as { title: string; priority: number }
    assertEquals(first.priority, 1)
  })

  it('should support limit and offset', async () => {
    await db.query(`
      CREATE wrapped_items SET title = 'A', priority = 1;
      CREATE wrapped_items SET title = 'B', priority = 2;
      CREATE wrapped_items SET title = 'C', priority = 3;
    `)

    const result = await queryRecordsWrapped(db, 'wrapped_items', {
      orderBy: { field: 'priority', direction: 'ASC' },
      limit: 2,
      offset: 1,
    })

    assertEquals(result.records.length, 2)
  })

  it('should return empty ListResult for empty table', async () => {
    await db.query('DEFINE TABLE wrapped_items SCHEMALESS')
    const result = await queryRecordsWrapped(db, 'wrapped_items')
    assertEquals(result.total, 0)
    assertEquals(result.records.length, 0)
    assertEquals(result.first(), null)
    assertEquals(result.last(), null)
  })
})

describe('Integration: Query Builder execution', () => {
  afterEach(async () => {
    await cleanTable('qb_items')
  })

  it('should fetchAll with query builder', async () => {
    await db.query(`
      CREATE qb_items SET name = 'X', value = 1;
      CREATE qb_items SET name = 'Y', value = 2;
    `)

    const query = select().fromTable('qb_items')
    const results = await fetchAll(db, query)
    assertEquals(results.length, 2)
  })

  it('should fetchOne with query builder', async () => {
    await db.query(`CREATE qb_items SET name = 'Solo', value = 42`)

    const query = select().fromTable('qb_items').limit(1)
    const result = await fetchOne(db, query)
    assert(result !== null)
  })

  it('should fetchMany with pagination options', async () => {
    await db.query(`
      CREATE qb_items SET name = 'A', value = 1;
      CREATE qb_items SET name = 'B', value = 2;
      CREATE qb_items SET name = 'C', value = 3;
    `)

    const query = select().fromTable('qb_items')
    const result = await fetchMany(db, query, undefined, { total: 10, limit: 3, offset: 0 })
    assertEquals(result.records.length, 3)
    assertEquals(result.total, 10)
    assertEquals(result.hasMore, true)
  })

  it('should fetchRecord returning RecordResult', async () => {
    await db.query(`CREATE qb_items SET name = 'Wrapped', value = 99`)

    const query = select().fromTable('qb_items').limit(1)
    const result = await fetchRecord(db, query)
    assertEquals(result.ok, true)
    assert(result.data !== null)
    assertEquals(result.unwrap() !== null, true)
  })

  it('should fetchRecord returning empty for no results', async () => {
    await db.query('DEFINE TABLE qb_items SCHEMALESS')
    const query = select().fromTable('qb_items').where('value = 99999')
    const result = await fetchRecord(db, query)
    assertEquals(result.ok, false)
    assertEquals(result.data, null)
  })
})

describe('Integration: getAppliedMigrationsOrdered', () => {
  beforeEach(async () => {
    await ensureMigrationTable(db)
    await db.query('DELETE _migrations')
  })

  afterEach(async () => {
    await db.query('DELETE _migrations')
  })

  it('should return applied migrations in version order', async () => {
    await recordMigration(db, '003', 'third', 'UP' as MigrationDirection)
    await recordMigration(db, '001', 'first', 'UP' as MigrationDirection)
    await recordMigration(db, '002', 'second', 'UP' as MigrationDirection)

    const migrations: Migration[] = [
      { version: '001', description: 'first', up: () => Promise.resolve(''), down: () => Promise.resolve('') },
      { version: '002', description: 'second', up: () => Promise.resolve(''), down: () => Promise.resolve('') },
      { version: '003', description: 'third', up: () => Promise.resolve(''), down: () => Promise.resolve('') },
      { version: '004', description: 'fourth', up: () => Promise.resolve(''), down: () => Promise.resolve('') },
    ]

    const result = await getAppliedMigrationsOrdered(db, migrations)
    assertEquals(result.length, 3)
    assertEquals(result[0].version, '001')
    assertEquals(result[1].version, '002')
    assertEquals(result[2].version, '003')
  })

  it('should exclude unapplied migrations', async () => {
    await recordMigration(db, '001', 'first', 'UP' as MigrationDirection)

    const migrations: Migration[] = [
      { version: '001', description: 'first', up: () => Promise.resolve(''), down: () => Promise.resolve('') },
      { version: '002', description: 'second', up: () => Promise.resolve(''), down: () => Promise.resolve('') },
    ]

    const result = await getAppliedMigrationsOrdered(db, migrations)
    assertEquals(result.length, 1)
    assertEquals(result[0].version, '001')
  })

  it('should return empty when nothing applied', async () => {
    const migrations: Migration[] = [
      { version: '001', description: 'first', up: () => Promise.resolve(''), down: () => Promise.resolve('') },
    ]

    const result = await getAppliedMigrationsOrdered(db, migrations)
    assertEquals(result.length, 0)
  })
})

describe('Integration: executeRollback', () => {
  beforeEach(async () => {
    await ensureMigrationTable(db)
    await db.query('DELETE _migrations')
  })

  afterEach(async () => {
    await db.query('DELETE _migrations')
  })

  it('should execute rollback plan successfully', async () => {
    await recordMigration(db, '001', 'create table', 'UP' as MigrationDirection)
    await recordMigration(db, '002', 'add field', 'UP' as MigrationDirection)

    const migrations: Migration[] = [
      {
        version: '002',
        description: 'add field',
        up: () => Promise.resolve(''),
        down: () => Promise.resolve('-- rollback add field'),
      },
      {
        version: '001',
        description: 'create table',
        up: () => Promise.resolve(''),
        down: () => Promise.resolve('-- rollback create table'),
      },
    ]

    const plan = {
      migrations,
      issues: [],
      safety: RollbackSafety.SAFE,
    }

    const result = await executeRollback(db, plan)
    assertEquals(result.success, true)
    assertEquals(result.migrationsRolledBack.length, 2)
    assertEquals(result.migrationsRolledBack[0], '002')
    assertEquals(result.migrationsRolledBack[1], '001')

    const remaining = await getAppliedVersions(db)
    assertEquals(remaining.size, 0)
  })

  it('should handle empty rollback plan', async () => {
    const plan = {
      migrations: [] as Migration[],
      issues: [],
      safety: RollbackSafety.SAFE,
    }

    const result = await executeRollback(db, plan)
    assertEquals(result.success, true)
    assertEquals(result.migrationsRolledBack.length, 0)
  })

  it('should capture error on failed rollback', async () => {
    await recordMigration(db, '001', 'bad migration', 'UP' as MigrationDirection)

    const migrations: Migration[] = [
      {
        version: '001',
        description: 'bad migration',
        up: () => Promise.resolve(''),
        down: () => Promise.reject(new Error('rollback failed deliberately')),
      },
    ]

    const plan = {
      migrations,
      issues: [],
      safety: RollbackSafety.WARNING,
    }

    const result = await executeRollback(db, plan)
    assertEquals(result.success, false)
    assertEquals(typeof result.error, 'string')
  })
})

describe('Integration: migration history roundtrip', () => {
  beforeEach(async () => {
    await ensureMigrationTable(db)
    await db.query('DELETE _migrations')
  })

  afterEach(async () => {
    await db.query('DELETE _migrations')
  })

  it('should record and retrieve migrations', async () => {
    await recordMigration(db, 'v001', 'initial schema', 'UP' as MigrationDirection)
    await recordMigration(db, 'v002', 'add users', 'UP' as MigrationDirection)

    const versions = await getAppliedVersions(db)
    assertEquals(versions.has('v001'), true)
    assertEquals(versions.has('v002'), true)
    assertEquals(versions.has('v003'), false)
  })

  it('should remove migration records', async () => {
    await recordMigration(db, 'v001', 'to remove', 'UP' as MigrationDirection)
    let versions = await getAppliedVersions(db)
    assertEquals(versions.has('v001'), true)

    await removeMigrationRecord(db, 'v001')
    versions = await getAppliedVersions(db)
    assertEquals(versions.has('v001'), false)
  })
})
