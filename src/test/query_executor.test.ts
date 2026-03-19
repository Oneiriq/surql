import { assertEquals, assertRejects } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { executeQuery, executeRaw, fetchRecords } from '../query/executor.ts'
import { select } from '../query/builder.ts'

function makeMockDb(response: unknown[][]) {
  const queries: string[] = []
  return {
    queries,
    query: (sql: string, _params?: Record<string, unknown>) => {
      queries.push(sql)
      return Promise.resolve(response)
    },
  }
}

function makeFailingDb(error: Error) {
  return {
    query: (_sql: string) => Promise.reject(error),
  }
}

describe('executeQuery', () => {
  it('should execute query builder SQL and return results', async () => {
    const mockResp = [[{ id: 'users:1', name: 'Alice' }]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResp) as any
    const q = select().fromTable('users')
    const results = await executeQuery(db, q)
    assertEquals(results.length, 1)
    assertEquals(results[0].name, 'Alice')
    assertEquals(db.queries[0].includes('SELECT'), true)
    assertEquals(db.queries[0].includes('users'), true)
  })

  it('should return empty array when no results', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    const q = select().fromTable('users')
    const results = await executeQuery(db, q)
    assertEquals(results.length, 0)
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    const q = select().fromTable('users')
    await assertRejects(
      () => executeQuery(db, q),
      Error,
      'Query execution failed',
    )
  })
})

describe('executeRaw', () => {
  it('should execute raw SQL string and return results', async () => {
    const mockResp = [[{ id: 'users:1' }]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResp) as any
    const results = await executeRaw(db, 'SELECT * FROM users')
    assertEquals(results.length, 1)
    assertEquals(db.queries[0], 'SELECT * FROM users')
  })

  it('should return empty array when no results', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    const results = await executeRaw(db, 'SELECT * FROM empty')
    assertEquals(results.length, 0)
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => executeRaw(db, 'BAD SQL'),
      Error,
      'Raw query execution failed',
    )
  })
})

describe('fetchRecords', () => {
  it('should execute query builder and return extracted results', async () => {
    const mockResp = [[{ id: 'users:1', name: 'Alice' }, { id: 'users:2', name: 'Bob' }]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResp) as any
    const q = select().fromTable('users')
    const results = await fetchRecords(db, q)
    assertEquals(results.length, 2)
  })

  it('should return empty array when no results', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    const q = select().fromTable('users')
    const results = await fetchRecords(db, q)
    assertEquals(results.length, 0)
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    const q = select().fromTable('users')
    await assertRejects(
      () => fetchRecords(db, q),
      Error,
      'Query execution failed',
    )
  })
})
