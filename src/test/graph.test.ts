import { assertEquals, assertRejects } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import {
  countRelated,
  createRelation,
  findMutualConnections,
  getIncomingEdges,
  getOutgoingEdges,
  getRelatedRecords,
  removeRelation,
  shortestPath,
  traverse,
  traverseWithDepth,
} from '../query/graph.ts'

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

describe('traverse', () => {
  it('should build correct SQL and return results', async () => {
    const mockResult = [[{ id: 'users:2', name: 'Bob' }]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResult) as any
    const result = await traverse(db, 'users:1', '->follows->users')
    assertEquals(db.queries[0], 'SELECT * FROM users:1.->follows->users')
    assertEquals(result.length, 1)
  })

  it('should return empty array when no results', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    const result = await traverse(db, 'users:1', '->follows->users')
    assertEquals(result.length, 0)
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => traverse(db, 'users:1', '->follows->users'),
      Error,
      'Graph traversal failed',
    )
  })
})

describe('traverseWithDepth', () => {
  it('should build correct SQL for depth 1', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    await traverseWithDepth(db, 'users:1', 'follows', '->', 1)
    assertEquals(db.queries[0], 'SELECT * FROM users:1->follows.*')
  })

  it('should build correct SQL for depth 2', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    await traverseWithDepth(db, 'users:1', 'follows', '->', 2)
    assertEquals(db.queries[0], 'SELECT * FROM users:1->follows->follows.*')
  })

  it('should support reverse direction', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    await traverseWithDepth(db, 'users:1', 'follows', '<-', 1)
    assertEquals(db.queries[0], 'SELECT * FROM users:1<-follows.*')
  })

  it('should support bidirectional', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    await traverseWithDepth(db, 'users:1', 'knows', '<->', 1)
    assertEquals(db.queries[0], 'SELECT * FROM users:1<->knows.*')
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => traverseWithDepth(db, 'users:1', 'follows', '->', 1),
      Error,
      'Graph traversal with depth failed',
    )
  })
})

describe('createRelation', () => {
  it('should build RELATE SQL without data', async () => {
    const mockResult = [[{ id: 'follows:1' }]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResult) as any
    const result = await createRelation(db, 'users:1', 'follows', 'users:2')
    assertEquals(db.queries[0], 'RELATE users:1->follows->users:2')
    assertEquals(result.id, 'follows:1')
  })

  it('should build RELATE SQL with data', async () => {
    const mockResult = [[{ id: 'follows:1', since: '2024-01-01' }]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResult) as any
    await createRelation(db, 'users:1', 'follows', 'users:2', { since: '2024-01-01' })
    assertEquals(db.queries[0].includes("SET since = '2024-01-01'"), true)
  })

  it('should return empty object when no results', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    const result = await createRelation(db, 'users:1', 'follows', 'users:2')
    assertEquals(Object.keys(result).length, 0)
  })

  it('should skip SET clause for empty data', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    await createRelation(db, 'users:1', 'follows', 'users:2', {})
    assertEquals(db.queries[0], 'RELATE users:1->follows->users:2')
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => createRelation(db, 'users:1', 'follows', 'users:2'),
      Error,
      'Create relation failed',
    )
  })
})

describe('removeRelation', () => {
  it('should build correct DELETE SQL', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([]) as any
    await removeRelation(db, 'users:1', 'follows', 'users:2')
    assertEquals(db.queries[0], 'DELETE users:1->follows WHERE out = users:2')
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => removeRelation(db, 'users:1', 'follows', 'users:2'),
      Error,
      'Remove relation failed',
    )
  })
})

describe('getRelatedRecords', () => {
  it('should build correct SQL with default direction', async () => {
    const mockResult = [[{ id: 'users:2' }]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResult) as any
    const result = await getRelatedRecords(db, 'users:1', 'follows')
    assertEquals(db.queries[0], 'SELECT * FROM users:1->follows.*')
    assertEquals(result.length, 1)
  })

  it('should support reverse direction', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    await getRelatedRecords(db, 'users:1', 'follows', '<-')
    assertEquals(db.queries[0], 'SELECT * FROM users:1<-follows.*')
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => getRelatedRecords(db, 'users:1', 'follows'),
      Error,
      'Get related records failed',
    )
  })
})

describe('getOutgoingEdges', () => {
  it('should build correct SQL', async () => {
    const mockResult = [[{ id: 'follows:1' }]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResult) as any
    const result = await getOutgoingEdges(db, 'users:1', 'follows')
    assertEquals(db.queries[0], 'SELECT * FROM users:1->follows')
    assertEquals(result.length, 1)
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => getOutgoingEdges(db, 'users:1', 'follows'),
      Error,
      'Get outgoing edges failed',
    )
  })
})

describe('getIncomingEdges', () => {
  it('should build correct SQL', async () => {
    const mockResult = [[{ id: 'follows:2' }]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResult) as any
    const result = await getIncomingEdges(db, 'users:1', 'follows')
    assertEquals(db.queries[0], 'SELECT * FROM users:1<-follows')
    assertEquals(result.length, 1)
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => getIncomingEdges(db, 'users:1', 'follows'),
      Error,
      'Get incoming edges failed',
    )
  })
})

describe('countRelated', () => {
  it('should return count with default direction', async () => {
    const mockResult = [[{ total: 5 }]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResult) as any
    const result = await countRelated(db, 'users:1', 'follows')
    assertEquals(result, 5)
    assertEquals(db.queries[0], 'SELECT count() AS total FROM users:1->follows GROUP ALL')
  })

  it('should return 0 when no results', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    const result = await countRelated(db, 'users:1', 'follows')
    assertEquals(result, 0)
  })

  it('should support reverse direction', async () => {
    const mockResult = [[{ total: 3 }]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResult) as any
    await countRelated(db, 'users:1', 'follows', '<-')
    assertEquals(db.queries[0], 'SELECT count() AS total FROM users:1<-follows GROUP ALL')
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => countRelated(db, 'users:1', 'follows'),
      Error,
      'Count related failed',
    )
  })
})

describe('shortestPath', () => {
  it('should build correct SQL', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    await shortestPath(db, 'users:1', 'users:5', 'follows')
    assertEquals(db.queries[0].includes('fn::graph::shortest_path'), true)
  })

  it('should use default maxDepth of 10', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    await shortestPath(db, 'users:1', 'users:5', 'follows')
    assertEquals(db.queries[0].includes('10'), true)
  })

  it('should accept custom maxDepth', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    await shortestPath(db, 'users:1', 'users:5', 'follows', 3)
    assertEquals(db.queries[0].includes('3'), true)
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => shortestPath(db, 'users:1', 'users:5', 'follows'),
      Error,
      'Shortest path query failed',
    )
  })
})

describe('findMutualConnections', () => {
  it('should build correct SQL', async () => {
    const mockResult = [[{ id: 'users:3' }]]
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(mockResult) as any
    const result = await findMutualConnections(db, 'users:1', 'users:2', 'follows')
    assertEquals(result.length, 1)
    assertEquals(db.queries[0].includes('users:1->follows'), true)
    assertEquals(db.queries[0].includes('users:2->follows'), true)
    assertEquals(db.queries[0].includes('INSIDE'), true)
  })

  it('should return empty array when no mutual connections', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    const result = await findMutualConnections(db, 'users:1', 'users:2', 'follows')
    assertEquals(result.length, 0)
  })

  it('should wrap db errors', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingDb(new Error('err')) as any
    await assertRejects(
      () => findMutualConnections(db, 'users:1', 'users:2', 'follows'),
      Error,
      'Find mutual connections failed',
    )
  })
})

describe('graph helpers with WHERE conditions', () => {
  it('traverse appends a WHERE clause', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    await traverse(db, 'users:1', '->follows->users', 'age > 18')
    assertEquals(db.queries[0], 'SELECT * FROM users:1.->follows->users WHERE age > 18')
  })

  it('traverseWithDepth appends a WHERE clause', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    await traverseWithDepth(db, 'users:1', 'follows', '->', 2, 'active = true')
    assertEquals(db.queries[0], 'SELECT * FROM users:1->follows->follows.* WHERE active = true')
  })

  it('getRelatedRecords appends a WHERE clause', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    await getRelatedRecords(db, 'users:1', 'follows', '->', "tenant = 'acme'")
    assertEquals(db.queries[0], "SELECT * FROM users:1->follows.* WHERE tenant = 'acme'")
  })

  it('getOutgoingEdges appends a WHERE clause', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    await getOutgoingEdges(db, 'users:1', 'follows', 'weight > 0')
    assertEquals(db.queries[0], 'SELECT * FROM users:1->follows WHERE weight > 0')
  })

  it('getIncomingEdges appends a WHERE clause', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    await getIncomingEdges(db, 'users:1', 'follows', 'weight > 0')
    assertEquals(db.queries[0], 'SELECT * FROM users:1<-follows WHERE weight > 0')
  })

  it('shortestPath appends a WHERE clause', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    await shortestPath(db, 'users:1', 'users:5', 'follows', 5, 'cost < 100')
    assertEquals(db.queries[0].endsWith(' WHERE cost < 100'), true)
  })

  it('omits the WHERE clause when no conditions are given', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb([[]]) as any
    await traverse(db, 'users:1', '->follows->users')
    assertEquals(db.queries[0].includes('WHERE'), false)
  })
})
