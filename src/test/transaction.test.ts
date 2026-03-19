import { assertEquals, assertRejects } from '@std/assert'
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

  it('should execute queries within the transaction', async () => {
    const db = mockDb()
    // deno-lint-ignore no-explicit-any
    const tx = new Transaction(db as any)
    await tx.begin()
    await tx.execute('SELECT * FROM test')
    assertEquals(db.queries.includes('SELECT * FROM test'), true)
  })

  it('should send BEGIN/COMMIT queries', async () => {
    const db = mockDb()
    // deno-lint-ignore no-explicit-any
    const tx = new Transaction(db as any)
    await tx.begin()
    await tx.commit()
    assertEquals(db.queries[0], 'BEGIN TRANSACTION')
    assertEquals(db.queries[1], 'COMMIT TRANSACTION')
  })

  it('should auto-cancel on asyncDispose if active', async () => {
    const db = mockDb()
    // deno-lint-ignore no-explicit-any
    const tx = new Transaction(db as any)
    await tx.begin()
    await tx[Symbol.asyncDispose]()
    assertEquals(tx.state, TransactionState.CANCELLED)
    assertEquals(db.queries.includes('CANCEL TRANSACTION'), true)
  })

  it('should not cancel on asyncDispose if already committed', async () => {
    const db = mockDb()
    // deno-lint-ignore no-explicit-any
    const tx = new Transaction(db as any)
    await tx.begin()
    await tx.commit()
    await tx[Symbol.asyncDispose]()
    assertEquals(tx.state, TransactionState.COMMITTED)
    assertEquals(db.queries.includes('CANCEL TRANSACTION'), false)
  })
})
