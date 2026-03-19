import { assertEquals, assertRejects } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { z } from 'zod'
import { createTyped, getTyped, queryTyped, updateTyped, upsertTyped } from '../query/typed.ts'

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  age: z.number(),
})

function makeMockDb(response: unknown[][]) {
  const queries: string[] = []
  return {
    queries,
    query: (sql: string) => {
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

describe('createTyped', () => {
  it('should create a record and validate with schema', async () => {
    const mockResult = [[{ id: 'users:1', name: 'Alice', age: 30 }]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResult) as any
    const result = await createTyped(db, 'users', { name: 'Alice', age: 30 }, UserSchema)
    assertEquals(result.name, 'Alice')
    assertEquals(result.age, 30)
  })

  it('should generate correct SQL', async () => {
    const mockResult = [[{ id: 'users:1', name: 'Bob', age: 25 }]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResult) as any
    await createTyped(db, 'users', { name: 'Bob', age: 25 }, UserSchema)
    assertEquals(db.queries[0].includes('CREATE users SET'), true)
    assertEquals(db.queries[0].includes("name = 'Bob'"), true)
    assertEquals(db.queries[0].includes('age = 25'), true)
  })

  it('should throw when no results returned', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    await assertRejects(
      () => createTyped(db, 'users', { name: 'X' }, UserSchema),
      Error,
      'createTyped failed',
    )
  })

  it('should throw on schema validation failure', async () => {
    const mockResult = [[{ id: 'users:1', name: 123, age: 'not-a-number' }]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResult) as any
    await assertRejects(
      () => createTyped(db, 'users', { name: 123 }, UserSchema),
      Error,
    )
  })

  it('should wrap db errors with intoSurQlError', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('db down')) as any
    await assertRejects(
      () => createTyped(db, 'users', { name: 'A' }, UserSchema),
      Error,
      'createTyped failed',
    )
  })
})

describe('getTyped', () => {
  it('should get a record and validate with schema', async () => {
    const mockResult = [[{ id: 'users:1', name: 'Alice', age: 30 }]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResult) as any
    const result = await getTyped(db, 'users', '1', UserSchema)
    assertEquals(result?.name, 'Alice')
  })

  it('should return null when no record found', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    const result = await getTyped(db, 'users', 'nonexistent', UserSchema)
    assertEquals(result, null)
  })

  it('should generate correct SQL', async () => {
    const mockResult = [[{ id: 'users:42', name: 'X', age: 1 }]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResult) as any
    await getTyped(db, 'users', '42', UserSchema)
    assertEquals(db.queries[0], 'SELECT * FROM users:42')
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('timeout')) as any
    await assertRejects(
      () => getTyped(db, 'users', '1', UserSchema),
      Error,
      'getTyped failed',
    )
  })
})

describe('queryTyped', () => {
  it('should query records and validate with schema', async () => {
    const mockResult = [[
      { id: 'users:1', name: 'Alice', age: 30 },
      { id: 'users:2', name: 'Bob', age: 25 },
    ]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResult) as any
    const results = await queryTyped(db, 'users', null, UserSchema)
    assertEquals(results.length, 2)
    assertEquals(results[0].name, 'Alice')
  })

  it('should generate SQL without conditions when null', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    await queryTyped(db, 'users', null, UserSchema)
    assertEquals(db.queries[0], 'SELECT * FROM users')
  })

  it('should append WHERE clause when conditions provided', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    await queryTyped(db, 'users', 'age > 18', UserSchema)
    assertEquals(db.queries[0], 'SELECT * FROM users WHERE age > 18')
  })

  it('should return empty array when no results', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    const results = await queryTyped(db, 'users', null, UserSchema)
    assertEquals(results.length, 0)
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => queryTyped(db, 'users', null, UserSchema),
      Error,
      'queryTyped failed',
    )
  })
})

describe('updateTyped', () => {
  it('should update a record and validate with schema', async () => {
    const mockResult = [[{ id: 'users:1', name: 'Updated', age: 31 }]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResult) as any
    const result = await updateTyped(db, 'users', '1', { name: 'Updated', age: 31 }, UserSchema)
    assertEquals(result.name, 'Updated')
    assertEquals(result.age, 31)
  })

  it('should generate correct SQL', async () => {
    const mockResult = [[{ id: 'users:1', name: 'A', age: 1 }]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResult) as any
    await updateTyped(db, 'users', '1', { name: 'A' }, UserSchema)
    assertEquals(db.queries[0].includes('UPDATE users:1 SET'), true)
    assertEquals(db.queries[0].includes("name = 'A'"), true)
  })

  it('should throw when no results returned', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    await assertRejects(
      () => updateTyped(db, 'users', '1', { name: 'X' }, UserSchema),
      Error,
      'updateTyped failed',
    )
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => updateTyped(db, 'users', '1', { name: 'X' }, UserSchema),
      Error,
      'updateTyped failed',
    )
  })
})

describe('upsertTyped', () => {
  it('should upsert a record and validate with schema', async () => {
    const mockResult = [[{ id: 'users:1', name: 'New', age: 20 }]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResult) as any
    const result = await upsertTyped(db, 'users', { name: 'New', age: 20 }, UserSchema)
    assertEquals(result.name, 'New')
    assertEquals(result.age, 20)
  })

  it('should generate correct SQL', async () => {
    const mockResult = [[{ id: 'users:1', name: 'A', age: 1 }]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResult) as any
    await upsertTyped(db, 'users', { name: 'A', age: 1 }, UserSchema)
    assertEquals(db.queries[0].includes('UPSERT users SET'), true)
  })

  it('should throw when no results returned', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    await assertRejects(
      () => upsertTyped(db, 'users', { name: 'X' }, UserSchema),
      Error,
      'upsertTyped failed',
    )
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => upsertTyped(db, 'users', { name: 'X' }, UserSchema),
      Error,
      'upsertTyped failed',
    )
  })
})
