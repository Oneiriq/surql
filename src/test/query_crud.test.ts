import { assertEquals, assertRejects } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
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
  updateRecord,
  upsertRecord,
} from '../query/crud.ts'

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

describe('createRecord', () => {
  it('should generate CREATE SQL and return result', async () => {
    const mockResp = [[[{ id: 'users:1', name: 'Alice' }]]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResp) as any
    const result = await createRecord(db, 'users', { name: 'Alice' })
    assertEquals(result.name, 'Alice')
    assertEquals(db.queries[0].includes('CREATE users SET'), true)
    assertEquals(db.queries[0].includes("name = 'Alice'"), true)
  })

  it('should throw when no result returned', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[[]]]) as any
    await assertRejects(
      () => createRecord(db, 'users', { name: 'X' }),
      Error,
      'createRecord failed',
    )
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => createRecord(db, 'users', { name: 'X' }),
      Error,
      'createRecord failed',
    )
  })
})

describe('createRecords', () => {
  it('should create multiple records sequentially', async () => {
    const mockResp = [
      [[{ id: 'users:1', name: 'Alice' }]],
      [[{ id: 'users:2', name: 'Bob' }]],
    ]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResp) as any
    const results = await createRecords(db, 'users', [{ name: 'Alice' }, { name: 'Bob' }])
    assertEquals(results.length, 2)
    assertEquals(db.queries.length, 2)
  })

  it('should skip items that return no result', async () => {
    const mockResp = [
      [[{ id: 'users:1', name: 'Alice' }]],
      [[]],
    ]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResp) as any
    const results = await createRecords(db, 'users', [{ name: 'Alice' }, { name: 'Bob' }])
    assertEquals(results.length, 1)
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => createRecords(db, 'users', [{ name: 'X' }]),
      Error,
      'createRecords failed',
    )
  })
})

describe('getRecord', () => {
  it('should generate SELECT SQL and return result', async () => {
    const mockResp = [[[{ id: 'users:1', name: 'Alice' }]]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResp) as any
    const result = await getRecord(db, 'users', '1')
    assertEquals(result?.name, 'Alice')
    assertEquals(db.queries[0], 'SELECT * FROM users:1')
  })

  it('should return null when no record found', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[[]]]) as any
    const result = await getRecord(db, 'users', 'nonexistent')
    assertEquals(result, null)
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => getRecord(db, 'users', '1'),
      Error,
      'getRecord failed',
    )
  })
})

describe('updateRecord', () => {
  it('should generate UPDATE SQL and return result', async () => {
    const mockResp = [[[{ id: 'users:1', name: 'Updated' }]]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResp) as any
    const result = await updateRecord(db, 'users', '1', { name: 'Updated' })
    assertEquals(result.name, 'Updated')
    assertEquals(db.queries[0].includes('UPDATE users:1 SET'), true)
  })

  it('should throw when no result returned', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[[]]]) as any
    await assertRejects(
      () => updateRecord(db, 'users', '1', { name: 'X' }),
      Error,
      'updateRecord failed',
    )
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => updateRecord(db, 'users', '1', { name: 'X' }),
      Error,
      'updateRecord failed',
    )
  })
})

describe('mergeRecord', () => {
  it('should generate MERGE SQL and return result', async () => {
    const mockResp = [[[{ id: 'users:1', name: 'Alice', age: 31 }]]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResp) as any
    const result = await mergeRecord(db, 'users', '1', { age: 31 })
    assertEquals(result.age, 31)
    assertEquals(db.queries[0].includes('UPDATE users:1 MERGE'), true)
    assertEquals(db.queries[0].includes('"age":31'), true)
  })

  it('should throw when no result returned', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[[]]]) as any
    await assertRejects(
      () => mergeRecord(db, 'users', '1', { age: 31 }),
      Error,
      'mergeRecord failed',
    )
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => mergeRecord(db, 'users', '1', { age: 31 }),
      Error,
      'mergeRecord failed',
    )
  })
})

describe('upsertRecord', () => {
  it('should generate UPSERT SQL and return result', async () => {
    const mockResp = [[[{ id: 'users:1', name: 'Alice' }]]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResp) as any
    const result = await upsertRecord(db, 'users', { name: 'Alice' })
    assertEquals(result.name, 'Alice')
    assertEquals(db.queries[0].includes('UPSERT users SET'), true)
  })

  it('should throw when no result returned', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[[]]]) as any
    await assertRejects(
      () => upsertRecord(db, 'users', { name: 'X' }),
      Error,
      'upsertRecord failed',
    )
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => upsertRecord(db, 'users', { name: 'X' }),
      Error,
      'upsertRecord failed',
    )
  })
})

describe('deleteRecord', () => {
  it('should generate DELETE SQL', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[[]]]) as any
    await deleteRecord(db, 'users', '1')
    assertEquals(db.queries[0], 'DELETE users:1')
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => deleteRecord(db, 'users', '1'),
      Error,
      'deleteRecord failed',
    )
  })
})

describe('deleteRecords', () => {
  it('should generate DELETE SQL for each id', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[[]], [[]]]) as any
    await deleteRecords(db, 'users', ['1', '2'])
    assertEquals(db.queries.length, 2)
    assertEquals(db.queries[0], 'DELETE users:1')
    assertEquals(db.queries[1], 'DELETE users:2')
  })

  it('should do nothing for empty ids', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([]) as any
    await deleteRecords(db, 'users', [])
    assertEquals(db.queries.length, 0)
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => deleteRecords(db, 'users', ['1']),
      Error,
      'deleteRecords failed',
    )
  })
})

describe('queryRecords', () => {
  it('should generate SELECT SQL without conditions', async () => {
    const mockResp = [[[{ id: 'users:1' }, { id: 'users:2' }]]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResp) as any
    const result = await queryRecords(db, 'users')
    assertEquals(result.length, 2)
    assertEquals(db.queries[0], 'SELECT * FROM users')
  })

  it('should append WHERE clause when conditions provided', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[[]]]) as any
    await queryRecords(db, 'users', 'age > 18')
    assertEquals(db.queries[0], 'SELECT * FROM users WHERE age > 18')
  })

  it('should return empty array when no results', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[[]]]) as any
    const result = await queryRecords(db, 'users')
    assertEquals(result.length, 0)
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => queryRecords(db, 'users'),
      Error,
      'queryRecords failed',
    )
  })
})

describe('countRecords', () => {
  it('should generate count SQL without conditions', async () => {
    const mockResp = [[[{ total: 5 }]]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResp) as any
    const result = await countRecords(db, 'users')
    assertEquals(result, 5)
    assertEquals(db.queries[0], 'SELECT count() AS total FROM users GROUP ALL')
  })

  it('should append WHERE clause when conditions provided', async () => {
    const mockResp = [[[{ total: 3 }]]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResp) as any
    await countRecords(db, 'users', 'active = true')
    assertEquals(db.queries[0], 'SELECT count() AS total FROM users WHERE active = true GROUP ALL')
  })

  it('should return 0 when no results', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[[]]]) as any
    const result = await countRecords(db, 'users')
    assertEquals(result, 0)
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => countRecords(db, 'users'),
      Error,
      'countRecords failed',
    )
  })
})

describe('exists', () => {
  it('should return true when record exists', async () => {
    const mockResp = [[[{ id: 'users:1' }]]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResp) as any
    const result = await exists(db, 'users', '1')
    assertEquals(result, true)
  })

  it('should return false when record does not exist', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[[]]]) as any
    const result = await exists(db, 'users', 'nonexistent')
    assertEquals(result, false)
  })
})

describe('first', () => {
  it('should return first record', async () => {
    const mockResp = [[[{ id: 'users:1', name: 'Alice' }]]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResp) as any
    const result = await first(db, 'users')
    assertEquals(result?.name, 'Alice')
    assertEquals(db.queries[0].includes('LIMIT 1'), true)
  })

  it('should append WHERE clause when conditions provided', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[[]]]) as any
    await first(db, 'users', 'active = true')
    assertEquals(db.queries[0].includes('WHERE active = true'), true)
    assertEquals(db.queries[0].includes('LIMIT 1'), true)
  })

  it('should return null when no records', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[[]]]) as any
    const result = await first(db, 'users')
    assertEquals(result, null)
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => first(db, 'users'),
      Error,
      'first failed',
    )
  })
})

describe('last', () => {
  it('should return last record with ORDER BY id DESC', async () => {
    const mockResp = [[[{ id: 'users:99', name: 'Zara' }]]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResp) as any
    const result = await last(db, 'users')
    assertEquals(result?.name, 'Zara')
    assertEquals(db.queries[0].includes('ORDER BY id DESC LIMIT 1'), true)
  })

  it('should append WHERE clause when conditions provided', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[[]]]) as any
    await last(db, 'users', 'active = true')
    assertEquals(db.queries[0].includes('WHERE active = true'), true)
    assertEquals(db.queries[0].includes('ORDER BY id DESC LIMIT 1'), true)
  })

  it('should return null when no records', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[[]]]) as any
    const result = await last(db, 'users')
    assertEquals(result, null)
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => last(db, 'users'),
      Error,
      'last failed',
    )
  })
})
