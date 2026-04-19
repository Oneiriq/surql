/**
 * Integration tests for the v1.3.0 query-UX feature wave (issue #29).
 *
 * Run against `surrealdb/surrealdb:v3.0.5` on localhost:8000.
 */

import { assert, assertEquals } from '@std/assert'
import { afterAll, beforeAll, describe, it } from '@std/testing/bdd'
import { Surreal } from 'surrealdb'

import {
  aggregateRecords,
  count,
  createRecord,
  deleteRecord,
  extractMany,
  extractOne,
  extractScalar,
  getRecord,
  hasResult,
  mathMax,
  mathMean,
  mathMin,
  mathSum,
  timeNow,
  typeRecord,
  updateRecord,
} from '../../mod.ts'

const NS = 'test'
const TEST_DB = `test_query_ux_${Date.now()}`

let db: Surreal

async function safeDelete(client: Surreal, table: string): Promise<void> {
  try {
    await client.query(`DELETE ${table}`)
  } catch {
    // table may not exist yet
  }
}

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

// ---------------------------------------------------------------------------
// typeRecord + CRUD integration
// ---------------------------------------------------------------------------

describe('Integration: typeRecord() with CRUD helpers', () => {
  const table = 'qu_task'

  it('round-trips a record via typeRecord ref', async () => {
    await safeDelete(db, table)
    const created = await createRecord<{ id: unknown; status: string }>(
      db,
      table,
      { id: 'alpha', status: 'pending' },
    )
    assert(created)
    const ref = typeRecord(table, 'alpha')

    const got = await getRecord<{ status: string }>(db, ref)
    assertEquals(got?.status, 'pending')

    await updateRecord(db, ref, { status: 'done' })
    const updated = await getRecord<{ status: string }>(db, ref)
    assertEquals(updated?.status, 'done')

    await deleteRecord(db, table, 'alpha')
  })
})

// ---------------------------------------------------------------------------
// SurrealQL function factories end-to-end (timeNow in UPDATE SET)
// ---------------------------------------------------------------------------

describe('Integration: timeNow() flows through UPDATE SET', () => {
  const table = 'qu_session'

  it('assigns a DATETIME via time::now() server-side', async () => {
    await safeDelete(db, table)
    await createRecord(db, table, { id: 'bob', started: null })
    const ref = typeRecord(table, 'bob')
    await updateRecord(db, ref, { started: timeNow() })
    const got = await getRecord<{ started: unknown }>(db, ref)
    // SurrealDB returns a Date/string; just assert the value is populated.
    assert(got?.started !== null && got?.started !== undefined)
    await safeDelete(db, table)
  })
})

// ---------------------------------------------------------------------------
// aggregateRecords integration
// ---------------------------------------------------------------------------

describe('Integration: aggregateRecords()', () => {
  const table = 'qu_metric'

  beforeAll(async () => {
    await safeDelete(db, table)
    // Seed: three rows in two networks.
    await createRecord(db, table, { id: 'm1', network: 'a', strength: 5 })
    await createRecord(db, table, { id: 'm2', network: 'a', strength: 15 })
    await createRecord(db, table, { id: 'm3', network: 'b', strength: 100 })
  })

  afterAll(async () => {
    await safeDelete(db, table)
  })

  it('groupAll returns a single row with count + sum', async () => {
    const rows = await aggregateRecords({
      table,
      select: { total: count(), sum: mathSum('strength') },
      groupAll: true,
      client: db,
    })
    assertEquals(rows.length, 1)
    assertEquals(rows[0].total, 3)
    assertEquals(rows[0].sum, 120)
  })

  it('groupBy returns one row per group with aggregates', async () => {
    const rows = await aggregateRecords({
      table,
      select: {
        count: count(),
        avg: mathMean('strength'),
        min: mathMin('strength'),
        max: mathMax('strength'),
      },
      groupBy: ['network'],
      orderBy: [{ field: 'network', direction: 'ASC' }],
      client: db,
    })
    assertEquals(rows.length, 2)
    assertEquals(rows[0].network, 'a')
    assertEquals(rows[0].count, 2)
    assertEquals(rows[0].avg, 10)
    assertEquals(rows[0].min, 5)
    assertEquals(rows[0].max, 15)
    assertEquals(rows[1].network, 'b')
    assertEquals(rows[1].count, 1)
  })

  it('honors WHERE to narrow the aggregation', async () => {
    const rows = await aggregateRecords({
      table,
      select: { total: count() },
      where: 'strength > 10',
      groupAll: true,
      client: db,
    })
    assertEquals(rows.length, 1)
    assertEquals(rows[0].total, 2)
  })
})

// ---------------------------------------------------------------------------
// Extraction helpers against live responses
// ---------------------------------------------------------------------------

describe('Integration: extraction helpers on live responses', () => {
  const table = 'qu_extract'

  beforeAll(async () => {
    await safeDelete(db, table)
    await createRecord(db, table, { id: 'e1', n: 1 })
    await createRecord(db, table, { id: 'e2', n: 2 })
  })

  afterAll(async () => {
    await safeDelete(db, table)
  })

  it('extractMany flattens a wrapped SELECT response', async () => {
    const raw = await db.query(`SELECT * FROM ${table}`)
    const rows = extractMany<{ n: number }>(raw)
    assertEquals(rows.length, 2)
  })

  it('extractOne returns the first row', async () => {
    const raw = await db.query(`SELECT * FROM ${table} LIMIT 1`)
    const row = extractOne<{ n: number }>(raw)
    assert(row && typeof row.n === 'number')
  })

  it('extractScalar(raw, key) pulls a single field', async () => {
    const raw = await db.query(`SELECT count() AS total FROM ${table} GROUP ALL`)
    assertEquals(extractScalar<number>(raw, 'total'), 2)
  })

  it('hasResult is true when the table has rows, false when empty', async () => {
    const raw = await db.query(`SELECT * FROM ${table}`)
    assertEquals(hasResult(raw), true)
    // Empty result: filter that matches nothing.
    const empty = await db.query(`SELECT * FROM ${table} WHERE n > 999`)
    assertEquals(hasResult(empty), false)
  })
})
