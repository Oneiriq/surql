import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { transaction, TransactionState } from '../connection/transaction.ts'
import { TransactionError } from '../connection/errors.ts'
import { upsertMany } from '../query/batch.ts'

// Regression tests for the v1.5.0 transaction-bound upsertMany. The `client`
// argument now accepts either a `Surreal` connection (autocommit, legacy
// behaviour) or an active `Transaction` (atomic — the per-record UPSERT
// statements are queued on the transaction buffer and inherit the surrounding
// BEGIN/COMMIT framing on commit).

interface MockedSurreal {
  queries: { sql: string; params?: Record<string, unknown> }[]
  responses: unknown[][][]
  // deno-lint-ignore no-explicit-any
  query: (...args: any[]) => any
}

/** Build a minimal mock that captures every query() call. */
function makeMockDb(responses: unknown[][][]): MockedSurreal {
  const queries: { sql: string; params?: Record<string, unknown> }[] = []
  let callIndex = 0
  return {
    queries,
    responses,
    query(sql: string, params?: Record<string, unknown>) {
      queries.push({ sql, params })
      const resp = responses[callIndex] ?? [[]]
      callIndex++
      // The Surreal SDK's query() can be awaited directly OR have .responses()
      // called on it for per-statement envelopes. Return a thenable shaped
      // like a Promise but with .responses() bolted on; the buffered
      // Transaction.commit() path uses .responses().
      const promise = Promise.resolve(resp)
      // Synthesise BEGIN/COMMIT envelopes around the user statements.
      const envelope = [
        { success: true, result: null },
        ...((resp[0] as unknown[]) ?? []).map((r) => ({ success: true, result: r })),
        { success: true, result: null },
      ]
      const withResponses = promise as unknown as Promise<unknown[][]> & {
        responses: () => Promise<unknown[]>
      }
      withResponses.responses = () => Promise.resolve(envelope)
      return promise
    },
  }
}

describe('upsertMany (autocommit)', () => {
  it('emits one multi-statement query in autocommit mode', async () => {
    const mockResp = [[
      [{ id: 'users:1', name: 'Alice' }],
      [{ id: 'users:2', name: 'Bob' }],
    ]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResp) as any
    const result = await upsertMany<{ id: string; name: string }>(db, 'users', [
      { name: 'Alice' },
      { name: 'Bob' },
    ])
    assertEquals(result.length, 2)
    assertEquals(db.queries.length, 1)
    // The batched query contains two UPSERT statements joined by `;`.
    const sql = db.queries[0].sql as string
    assertEquals(sql.split('UPSERT users CONTENT').length - 1, 2)
  })

  it('uses the `id` field as the per-record UPSERT target', async () => {
    const mockResp = [[[{ id: 'users:alice', name: 'Alice' }]]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResp) as any
    await upsertMany(db, 'users', [{ id: 'users:alice', name: 'Alice' }])
    assertStringIncludes(db.queries[0].sql as string, 'UPSERT users:alice CONTENT')
  })

  it('returns [] for empty input without contacting the db', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([]) as any
    const result = await upsertMany(db, 'users', [])
    assertEquals(result.length, 0)
    assertEquals(db.queries.length, 0)
  })

  it('rejects an invalid table identifier', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([]) as any
    await assertRejects(
      () => upsertMany(db, 'bad table', [{ x: 1 }]),
      Error,
      'Invalid identifier',
    )
  })

  it('rejects an invalid conflict field identifier', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([]) as any
    await assertRejects(
      () => upsertMany(db, 'users', [{ x: 1 }], ['bad field']),
      Error,
      'Invalid identifier',
    )
  })
})

describe('upsertMany (transaction-bound)', () => {
  it('queues per-record UPSERTs on the transaction and returns []', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([]) as any
    const trx = transaction(db)
    await trx.begin()
    const result = await upsertMany(trx, 'users', [
      { name: 'Alice' },
      { name: 'Bob' },
    ])
    // Atomic mode buffers — results land in commit() instead.
    assertEquals(result.length, 0)
    // Nothing has hit the network yet — Transaction.execute() just buffers.
    assertEquals(db.queries.length, 0)
    // The two UPSERTs are now queued. Cancel without committing so we don't
    // assert on the BEGIN/COMMIT round-trip here.
    await trx.cancel()
    assertEquals(trx.state, TransactionState.CANCELLED)
  })

  it('preserves the v3-correct per-record UPSERT shape inside the transaction', async () => {
    // Commit the transaction so we can inspect the bundled BEGIN ... COMMIT
    // payload that was actually sent to the server.
    const mockResp = [[
      [{ id: 'users:alice', name: 'Alice' }],
      [{ id: 'users:bob', name: 'Bob' }],
    ]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResp) as any
    const trx = transaction(db)
    await trx.begin()
    await upsertMany(trx, 'users', [
      { id: 'users:alice', name: 'Alice' },
      { id: 'users:bob', name: 'Bob' },
    ])
    const results = await trx.commit()
    assertEquals(trx.state, TransactionState.COMMITTED)
    // Two user statements committed → two result entries (BEGIN/COMMIT
    // bookends are stripped by Transaction.commit).
    assertEquals(results.length, 2)
    // The single RPC contains BEGIN, both targeted UPSERTs, and COMMIT.
    assertEquals(db.queries.length, 1)
    const sql = db.queries[0].sql as string
    assertStringIncludes(sql, 'BEGIN TRANSACTION')
    assertStringIncludes(sql, 'UPSERT users:alice CONTENT')
    assertStringIncludes(sql, 'UPSERT users:bob CONTENT')
    assertStringIncludes(sql, 'COMMIT TRANSACTION')
  })

  it('rejects when the supplied transaction is not active', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([]) as any
    const trx = transaction(db)
    // No begin() — still PENDING.
    await assertRejects(
      () => upsertMany(trx, 'users', [{ name: 'X' }]),
      TransactionError,
      'Cannot execute in transaction state',
    )
  })

  it('inlines conflictFields values into a WHERE clause (Transaction.execute does not bind params)', async () => {
    // surql's buffered transactions queue raw SQL strings — the `params` arg
    // on Transaction.execute is intentionally unused — so conflictFields must
    // inline their values. surql-py's bound-param shape (`$item.field`) would
    // never resolve in this code path.
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[[{ id: 'users:1' }]]]) as any
    const trx = transaction(db)
    await trx.begin()
    await upsertMany(
      trx,
      'users',
      [{ email: 'a@b.com', name: 'Alice' }],
      ['email'],
    )
    await trx.commit()
    const sql = db.queries[0].sql as string
    assertStringIncludes(sql, "WHERE email = 'a@b.com'")
  })

  it('returns [] for empty input even when given a transaction', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([]) as any
    const trx = transaction(db)
    await trx.begin()
    const result = await upsertMany(trx, 'users', [])
    assertEquals(result.length, 0)
    await trx.cancel()
  })
})
