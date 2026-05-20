import { assertEquals, assertRejects } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { deleteMany, insertMany, relateMany, upsertMany } from '../query/batch.ts'

function makeMockDb(responses: unknown[][][]) {
  const queries: string[] = []
  let callIndex = 0
  return {
    queries,
    query: (sql: string) => {
      queries.push(sql)
      const resp = responses[callIndex] ?? [[]]
      callIndex++
      return Promise.resolve(resp)
    },
  }
}

function makeFailingDb(error: Error) {
  return {
    query: (_sql: string) => Promise.reject(error),
  }
}

describe('insertMany', () => {
  it('should return empty array for empty items', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([]) as any
    const result = await insertMany(db, 'users', [])
    assertEquals(result.length, 0)
  })

  it('should generate correct INSERT SQL', async () => {
    const mockResp = [[[{ id: 'users:1', name: 'Alice' }, { id: 'users:2', name: 'Bob' }]]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResp) as any
    const result = await insertMany(db, 'users', [
      { name: 'Alice' },
      { name: 'Bob' },
    ])
    assertEquals(result.length, 2)
    assertEquals(db.queries[0].includes('INSERT INTO users'), true)
    assertEquals(db.queries[0].includes("name: 'Alice'"), true)
    assertEquals(db.queries[0].includes("name: 'Bob'"), true)
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => insertMany(db, 'users', [{ name: 'X' }]),
      Error,
      'Batch insert failed',
    )
  })
})

describe('upsertMany', () => {
  it('should return empty array for empty items', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([]) as any
    const result = await upsertMany(db, 'users', [])
    assertEquals(result.length, 0)
  })

  it('should batch into a single multi-statement query (one UPSERT per item)', async () => {
    // Per-statement result envelopes returned by the SDK; concatenated into a
    // single results array by upsertMany in autocommit mode.
    const mockResp = [[
      [{ id: 'users:1', name: 'Alice' }],
      [{ id: 'users:2', name: 'Bob' }],
    ]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResp) as any
    const result = await upsertMany(db, 'users', [
      { name: 'Alice' },
      { name: 'Bob' },
    ])
    assertEquals(result.length, 2)
    // One multi-statement query is emitted — autocommit mode batches the
    // per-record UPSERTs together.
    assertEquals(db.queries.length, 1)
    assertEquals(db.queries[0].split('UPSERT users CONTENT').length - 1, 2)
    assertEquals(db.queries[0].includes("name: 'Alice'"), true)
    assertEquals(db.queries[0].includes("name: 'Bob'"), true)
  })

  it('should target a specific record id when `id` is present in the item', async () => {
    const mockResp = [[[{ id: 'users:alice', name: 'Alice' }]]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResp) as any
    await upsertMany(db, 'users', [{ id: 'users:alice', name: 'Alice' }])
    assertEquals(db.queries[0].includes('UPSERT users:alice CONTENT'), true)
    // `id` is the target, not part of the payload.
    assertEquals(db.queries[0].includes("id: 'users:alice'"), false)
  })

  it('should emit a WHERE clause from conflictFields with inline values', async () => {
    const mockResp = [[[{ id: 'users:1', email: 'a@b.com' }]]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResp) as any
    await upsertMany(
      db,
      'users',
      [{ email: 'a@b.com', name: 'Alice' }],
      ['email'],
    )
    assertEquals(db.queries[0].includes("WHERE email = 'a@b.com'"), true)
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => upsertMany(db, 'users', [{ name: 'X' }]),
      Error,
      'Batch upsert failed',
    )
  })
})

describe('deleteMany', () => {
  it('should return early for empty ids', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([]) as any
    await deleteMany(db, 'users', [])
    assertEquals(db.queries.length, 0)
  })

  it('should execute one DELETE per id', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[[]], [[]]]) as any
    await deleteMany(db, 'users', ['1', '2'])
    assertEquals(db.queries.length, 2)
    assertEquals(db.queries[0], 'DELETE users:1')
    assertEquals(db.queries[1], 'DELETE users:2')
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => deleteMany(db, 'users', ['1']),
      Error,
      'Batch delete failed',
    )
  })
})

describe('relateMany', () => {
  it('should return empty array for empty relations', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([]) as any
    const result = await relateMany(db, [])
    assertEquals(result.length, 0)
  })

  it('should execute one RELATE per relation', async () => {
    const mockResp = [
      [[{ id: 'follows:1' }]],
      [[{ id: 'follows:2' }]],
    ]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResp) as any
    const result = await relateMany(db, [
      { from: 'users:1', edge: 'follows', to: 'users:2' },
      { from: 'users:3', edge: 'follows', to: 'users:4' },
    ])
    assertEquals(result.length, 2)
    assertEquals(db.queries[0], 'RELATE users:1->follows->users:2')
    assertEquals(db.queries[1], 'RELATE users:3->follows->users:4')
  })

  it('should include SET clause when data provided', async () => {
    const mockResp = [[[{ id: 'follows:1' }]]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResp) as any
    await relateMany(db, [
      { from: 'users:1', edge: 'follows', to: 'users:2', data: { since: '2024-01-01' } },
    ])
    assertEquals(db.queries[0].includes("SET since = '2024-01-01'"), true)
  })

  it('should skip SET for empty data', async () => {
    const mockResp = [[[{ id: 'follows:1' }]]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResp) as any
    await relateMany(db, [
      { from: 'users:1', edge: 'follows', to: 'users:2', data: {} },
    ])
    assertEquals(db.queries[0], 'RELATE users:1->follows->users:2')
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => relateMany(db, [{ from: 'users:1', edge: 'follows', to: 'users:2' }]),
      Error,
      'Batch relate failed',
    )
  })
})
