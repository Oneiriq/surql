import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { Transaction, TransactionState } from '../connection/transaction.ts'

/** One per-statement entry, mirroring the SDK's `query(...).responses()` shape. */
type Resp = {
  success: boolean
  result?: unknown
  error?: { kind?: string; details?: { kind?: string } | null }
}

/** Count the `;`-separated statements in a flushed BEGIN/COMMIT batch. */
function countStatements(sql: string): number {
  return sql.split(';').map((s) => s.trim()).filter((s) => s.length > 0).length
}

/**
 * Mock connection whose `query()` returns a Query-like object exposing
 * `.responses()` — the accessor `Transaction.commit()` now uses. Without an
 * override every statement reports success; `result` is its 0-based index.
 */
function mockDb(makeEnvelope?: (sql: string) => Resp[]) {
  const queries: string[] = []
  return {
    queries,
    query: (sql: string) => {
      queries.push(sql)
      return {
        responses: () =>
          Promise.resolve(
            makeEnvelope
              ? makeEnvelope(sql)
              : Array.from({ length: countStatements(sql) }, (_, i): Resp => ({ success: true, result: i })),
          ),
      }
    },
  }
}

/** Mock connection whose `.responses()` rejects — simulates a transport failure. */
function failingDb(err: Error) {
  const queries: string[] = []
  return {
    queries,
    query: (sql: string) => {
      queries.push(sql)
      return { responses: () => Promise.reject(err) }
    },
  }
}

describe('Transaction', () => {
  it('should start in PENDING state', () => {
    // deno-lint-ignore no-explicit-any
    const tx = new Transaction(mockDb() as any)
    assertEquals(tx.state, TransactionState.PENDING)
    assertEquals(tx.isActive, false)
  })

  it('should transition to ACTIVE after begin()', async () => {
    // deno-lint-ignore no-explicit-any
    const tx = new Transaction(mockDb() as any)
    await tx.begin()
    assertEquals(tx.state, TransactionState.ACTIVE)
    assertEquals(tx.isActive, true)
  })

  it('should transition to COMMITTED after commit()', async () => {
    // deno-lint-ignore no-explicit-any
    const tx = new Transaction(mockDb() as any)
    await tx.begin()
    await tx.commit()
    assertEquals(tx.state, TransactionState.COMMITTED)
    assertEquals(tx.isActive, false)
  })

  it('should transition to CANCELLED after cancel()', async () => {
    // deno-lint-ignore no-explicit-any
    const tx = new Transaction(mockDb() as any)
    await tx.begin()
    await tx.cancel()
    assertEquals(tx.state, TransactionState.CANCELLED)
  })

  it('should reject begin() if not PENDING', async () => {
    // deno-lint-ignore no-explicit-any
    const tx = new Transaction(mockDb() as any)
    await tx.begin()
    await assertRejects(
      () => tx.begin(),
      Error,
      'Cannot begin transaction in state: ACTIVE',
    )
  })

  it('should reject commit() if not ACTIVE', async () => {
    // deno-lint-ignore no-explicit-any
    const tx = new Transaction(mockDb() as any)
    await assertRejects(
      () => tx.commit(),
      Error,
      'Cannot commit transaction in state: PENDING',
    )
  })

  it('should reject execute() if not ACTIVE', async () => {
    // deno-lint-ignore no-explicit-any
    const tx = new Transaction(mockDb() as any)
    await assertRejects(
      () => tx.execute('SELECT * FROM test'),
      Error,
      'Cannot execute in transaction state: PENDING',
    )
  })

  it('should NOT send any query on begin()', async () => {
    const db = mockDb()
    // deno-lint-ignore no-explicit-any
    const tx = new Transaction(db as any)
    await tx.begin()
    assertEquals(db.queries.length, 0)
  })

  it('should buffer execute() statements without contacting the server', async () => {
    const db = mockDb()
    // deno-lint-ignore no-explicit-any
    const tx = new Transaction(db as any)
    await tx.begin()
    await tx.execute('SELECT * FROM test')
    await tx.execute('CREATE user:alice SET name = "Alice"')
    assertEquals(db.queries.length, 0)
  })

  it('should flush buffered statements as a single BEGIN/COMMIT query', async () => {
    const db = mockDb()
    // deno-lint-ignore no-explicit-any
    const tx = new Transaction(db as any)
    await tx.begin()
    await tx.execute('SELECT * FROM test')
    await tx.execute('CREATE user:alice SET name = "Alice"')
    await tx.commit()

    assertEquals(db.queries.length, 1)
    const sent = db.queries[0]
    assertStringIncludes(sent, 'BEGIN TRANSACTION;')
    assertStringIncludes(sent, 'SELECT * FROM test;')
    assertStringIncludes(sent, 'CREATE user:alice SET name = "Alice";')
    assertStringIncludes(sent, 'COMMIT TRANSACTION;')
    const beginIdx = sent.indexOf('BEGIN TRANSACTION')
    const commitIdx = sent.indexOf('COMMIT TRANSACTION')
    const selectIdx = sent.indexOf('SELECT * FROM test')
    assertEquals(beginIdx < selectIdx && selectIdx < commitIdx, true)
  })

  it('should emit a bare BEGIN/COMMIT pair when no statements were queued', async () => {
    const db = mockDb()
    // deno-lint-ignore no-explicit-any
    const tx = new Transaction(db as any)
    await tx.begin()
    await tx.commit()
    assertEquals(db.queries.length, 1)
    assertEquals(db.queries[0], 'BEGIN TRANSACTION;\nCOMMIT TRANSACTION;')
  })

  it('should strip trailing semicolons from buffered statements', async () => {
    const db = mockDb()
    // deno-lint-ignore no-explicit-any
    const tx = new Transaction(db as any)
    await tx.begin()
    await tx.execute('SELECT * FROM test;')
    await tx.execute('CREATE foo;;  ')
    await tx.commit()

    const sent = db.queries[0]
    // Exactly one `;` between statements, no doubled-up `;;`
    assertEquals(sent.includes(';;'), false)
    assertStringIncludes(sent, 'SELECT * FROM test;')
    assertStringIncludes(sent, 'CREATE foo;')
  })

  it('should NOT send any query on cancel()', async () => {
    const db = mockDb()
    // deno-lint-ignore no-explicit-any
    const tx = new Transaction(db as any)
    await tx.begin()
    await tx.execute('SELECT * FROM test')
    await tx.cancel()
    assertEquals(db.queries.length, 0)
    assertEquals(tx.state, TransactionState.CANCELLED)
  })

  it('should auto-cancel on asyncDispose if active (no RPC)', async () => {
    const db = mockDb()
    // deno-lint-ignore no-explicit-any
    const tx = new Transaction(db as any)
    await tx.begin()
    await tx[Symbol.asyncDispose]()
    assertEquals(tx.state, TransactionState.CANCELLED)
    assertEquals(db.queries.length, 0)
  })

  it('should not cancel on asyncDispose if already committed', async () => {
    const db = mockDb()
    // deno-lint-ignore no-explicit-any
    const tx = new Transaction(db as any)
    await tx.begin()
    await tx.commit()
    await tx[Symbol.asyncDispose]()
    assertEquals(tx.state, TransactionState.COMMITTED)
    // Only the commit() flush RPC should have been issued.
    assertEquals(db.queries.length, 1)
  })

  it('should mark state FAILED when the commit RPC rejects', async () => {
    const db = failingDb(new Error('boom'))
    // deno-lint-ignore no-explicit-any
    const tx = new Transaction(db as any)
    await tx.begin()
    await tx.execute('SELECT 1')
    await assertRejects(() => tx.commit(), Error, 'Failed to commit transaction')
    assertEquals(tx.state, TransactionState.FAILED)
  })

  it('should return the queued statements’ results, in order, from commit()', async () => {
    // Envelope: BEGIN, statement 1, statement 2, COMMIT.
    const db = mockDb((sql) => {
      const n = countStatements(sql)
      return Array.from({ length: n }, (_, i): Resp => ({
        success: true,
        result: i === 0 ? 'BEGIN' : i === n - 1 ? 'COMMIT' : [`row-${i}`],
      }))
    })
    // deno-lint-ignore no-explicit-any
    const tx = new Transaction(db as any)
    await tx.begin()
    await tx.execute('CREATE a SET n = 1')
    await tx.execute('CREATE b SET n = 2')
    const results = await tx.commit()
    // BEGIN / COMMIT bookends stripped; only the two user statements remain.
    assertEquals(results, [['row-1'], ['row-2']])
  })

  it('should return an empty array from commit() when nothing was queued', async () => {
    const db = mockDb()
    // deno-lint-ignore no-explicit-any
    const tx = new Transaction(db as any)
    await tx.begin()
    assertEquals(await tx.commit(), [])
  })

  it('should throw and mark FAILED when a statement rolls the batch back', async () => {
    // BEGIN ok; statement 1 rolled back (NotExecuted cascade); statement 2 threw.
    const db = mockDb(() => [
      { success: true },
      { success: false, error: { kind: 'Query', details: { kind: 'NotExecuted' } } },
      { success: false, error: { kind: 'Thrown' } },
    ])
    // deno-lint-ignore no-explicit-any
    const tx = new Transaction(db as any)
    await tx.begin()
    await tx.execute('CREATE a SET n = 1')
    await tx.execute("THROW 'boom'")
    // The cascade entry is skipped; the originating failure is named instead.
    await assertRejects(
      () => tx.commit(),
      Error,
      'statement 2 of 2 failed (Thrown)',
    )
    assertEquals(tx.state, TransactionState.FAILED)
  })

  it('should distinguish a BEGIN-level failure in the rollback message', async () => {
    const db = mockDb(() => [
      { success: false, error: { kind: 'Db' } },
      { success: false, error: { kind: 'Query', details: { kind: 'NotExecuted' } } },
    ])
    // deno-lint-ignore no-explicit-any
    const tx = new Transaction(db as any)
    await tx.begin()
    await tx.execute('SELECT 1')
    await assertRejects(() => tx.commit(), Error, 'the BEGIN statement failed (Db)')
    assertEquals(tx.state, TransactionState.FAILED)
  })
})
