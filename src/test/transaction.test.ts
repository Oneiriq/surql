import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { Transaction, TransactionState } from '../connection/transaction.ts'

function mockDb() {
  const queries: string[] = []
  return {
    queries,
    query: (sql: string) => {
      queries.push(sql)
      return Promise.resolve([])
    },
  }
}

function failingDb(err: Error) {
  const queries: string[] = []
  return {
    queries,
    query: (sql: string) => {
      queries.push(sql)
      return Promise.reject(err)
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
})
