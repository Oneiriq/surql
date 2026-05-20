import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { buildRelateQuery, buildUpsertQuery } from '../query/batch.ts'

describe('buildUpsertQuery', () => {
  it('should return empty string for empty items', () => {
    assertEquals(buildUpsertQuery('users', []), '')
  })

  it('should build a simple upsert query (per-record CONTENT, v3-safe)', () => {
    const result = buildUpsertQuery('users', [{ name: 'Alice', age: 30 }])
    // v3 rejects `UPSERT INTO <table> [ ... ]`; the per-record CONTENT form is
    // the only portable shape across surql-py / surql-rs / surql-go.
    assertStringIncludes(result, 'UPSERT users CONTENT')
    assertStringIncludes(result, "name: 'Alice'")
    assertStringIncludes(result, 'age: 30')
    assertEquals(result.endsWith(';'), true)
  })

  it('should emit one UPSERT statement per item', () => {
    const result = buildUpsertQuery('users', [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ])
    // Two records → two UPSERT statements.
    assertEquals(result.split('UPSERT users CONTENT').length - 1, 2)
    assertStringIncludes(result, "name: 'Alice'")
    assertStringIncludes(result, "name: 'Bob'")
  })

  it('should target a specific record id when `id` is present in the item', () => {
    const result = buildUpsertQuery('users', [{ id: 'user:alice', name: 'Alice' }])
    // The `id` field becomes the UPSERT target (not part of the CONTENT payload).
    assertStringIncludes(result, 'UPSERT user:alice CONTENT')
    assertEquals(result.includes("id: 'user:alice'"), false)
  })

  it('should include conflict fields in WHERE clause with inline values', () => {
    const result = buildUpsertQuery(
      'users',
      [{ email: 'a@b.com', name: 'Alice' }],
      ['email'],
    )
    // The query is a single self-contained statement (no $item.* param refs)
    // so it can be embedded inside a buffered transaction whose execute() does
    // not bind params.
    assertStringIncludes(result, "WHERE email = 'a@b.com'")
  })

  it('should combine multiple conflict fields with AND', () => {
    const result = buildUpsertQuery(
      'users',
      [{ email: 'a@b.com', name: 'Alice' }],
      ['email', 'name'],
    )
    assertStringIncludes(result, "email = 'a@b.com' AND name = 'Alice'")
  })

  it('should reject invalid table names', () => {
    assertThrows(
      () => buildUpsertQuery('bad table', [{ x: 1 }]),
      Error,
      'Invalid identifier',
    )
  })

  it('should reject invalid conflict field names', () => {
    assertThrows(
      () => buildUpsertQuery('users', [{ x: 1 }], ['bad field']),
      Error,
      'Invalid identifier',
    )
  })

  it('should handle boolean and null values', () => {
    const result = buildUpsertQuery('items', [{ active: true, deleted: null }])
    assertStringIncludes(result, 'active: true')
    assertStringIncludes(result, 'deleted: NONE')
  })
})

describe('buildRelateQuery', () => {
  it('should build a simple relate query', () => {
    const result = buildRelateQuery('user:1', 'follows', 'user:2')
    assertEquals(result, 'RELATE user:1->follows->user:2;')
  })

  it('should include SET clauses for data', () => {
    const result = buildRelateQuery('user:1', 'follows', 'user:2', {
      since: '2024-01-01',
    })
    assertStringIncludes(result, 'SET')
    assertStringIncludes(result, "since = '2024-01-01'")
    assertEquals(result.endsWith(';'), true)
  })

  it('should handle multiple data fields', () => {
    const result = buildRelateQuery('user:1', 'rates', 'movie:1', {
      score: 5,
      review: 'Great',
    })
    assertStringIncludes(result, 'score = 5')
    assertStringIncludes(result, "review = 'Great'")
  })

  it('should skip SET for empty data object', () => {
    const result = buildRelateQuery('user:1', 'follows', 'user:2', {})
    assertEquals(result, 'RELATE user:1->follows->user:2;')
  })

  it('should reject invalid edge names', () => {
    assertThrows(
      () => buildRelateQuery('user:1', 'bad edge', 'user:2'),
      Error,
      'Invalid identifier',
    )
  })

  it('should reject invalid data field names', () => {
    assertThrows(
      () => buildRelateQuery('user:1', 'follows', 'user:2', { 'bad field': 1 }),
      Error,
      'Invalid identifier',
    )
  })
})
