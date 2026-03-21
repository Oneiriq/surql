import { assert, assertEquals } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { query, ReadQL } from '../crud/read.ts'
import { recordIdToString } from '../utils/helpers.ts'
import { stub } from '@std/testing/mock'
import { RecordId, type Surreal } from 'surrealdb'
import { type ConnectionProvider, Op, SortDirection } from '../crud/base.ts'

// Mock connection provider for testing
const mockConnectionProvider: ConnectionProvider = {
  getConnection: () =>
    Promise.resolve({
      query: <T>() => Promise.resolve([]) as Promise<T>,
      close: () => Promise.resolve(),
    } as unknown as Surreal),
}

// Test table for queries
const testTable = 'users'

// Test data types
interface TestUser {
  id: string
  username: string
  email: string
  active: boolean
  created_at: string
}

interface TestUserRaw {
  id: RecordId
  username: string
  email: string
  active: boolean
  created_at: Date
}

describe('ReadQL', () => {
  describe('constructor', () => {
    it('should create a new ReadQL instance', () => {
      const readQL = new ReadQL(mockConnectionProvider, testTable)
      assert(readQL instanceof ReadQL)
    })

    it('should accept custom context', () => {
      const readQL = new ReadQL(mockConnectionProvider, testTable)
      assert(readQL instanceof ReadQL)
    })
  })

  describe('where() - object style', () => {
    it('should add object-style WHERE conditions', () => {
      const readQL = query<TestUserRaw>(mockConnectionProvider, testTable)
        .where({ status: 'Active', role: 'admin' })

      assert(readQL instanceof ReadQL)
    })

    it('should support chaining multiple where() calls', () => {
      const readQL = query<TestUserRaw>(mockConnectionProvider, testTable)
        .where({ status: 'Active' })
        .where({ role: 'admin' })

      assert(readQL instanceof ReadQL)
    })
  })

  describe('where() - fluent style', () => {
    it('should add fluent-style WHERE conditions', () => {
      const readQL = query<TestUserRaw>(mockConnectionProvider, testTable)
        .where('username', Op.EQUALS, 'puffin123')

      assert(readQL instanceof ReadQL)
    })

    it('should support chaining fluent where() calls', () => {
      const readQL = query<TestUserRaw>(mockConnectionProvider, testTable)
        .where('username', Op.EQUALS, 'puffin123')
        .where('active', Op.EQUALS, true)

      assert(readQL instanceof ReadQL)
    })
  })

  describe('convenience where methods', () => {
    it('should support whereEquals()', () => {
      const readQL = query<TestUserRaw>(mockConnectionProvider, testTable)
        .whereEquals('username', 'puffin123')

      assert(readQL instanceof ReadQL)
    })

    it('should support whereContains()', () => {
      const readQL = query<TestUserRaw>(mockConnectionProvider, testTable)
        .whereContains('tags', 'developer')

      assert(readQL instanceof ReadQL)
    })

    it('should support whereLike()', () => {
      const readQL = query<TestUserRaw>(mockConnectionProvider, testTable)
        .whereLike('username', '%puffin%')

      assert(readQL instanceof ReadQL)
    })
  })

  describe('orderBy()', () => {
    it('should add ORDER BY clause with default ASC direction', () => {
      const readQL = query<TestUserRaw>(mockConnectionProvider, testTable)
        .orderBy('created_at')

      assert(readQL instanceof ReadQL)
    })

    it('should add ORDER BY clause with DESC direction', () => {
      const readQL = query<TestUserRaw>(mockConnectionProvider, testTable)
        .orderBy('created_at', SortDirection.DESC)

      assert(readQL instanceof ReadQL)
    })

    it('should support multiple orderBy() calls', () => {
      const readQL = query<TestUserRaw>(mockConnectionProvider, testTable)
        .orderBy('username', SortDirection.ASC)
        .orderBy('created_at', SortDirection.DESC)

      assert(readQL instanceof ReadQL)
    })
  })

  describe('limit() and offset()', () => {
    it('should set limit value', () => {
      const readQL = query<TestUserRaw>(mockConnectionProvider, testTable)
        .limit(10)

      assert(readQL instanceof ReadQL)
    })

    it('should set offset value', () => {
      const readQL = query<TestUserRaw>(mockConnectionProvider, testTable)
        .offset(5)

      assert(readQL instanceof ReadQL)
    })

    it('should support chaining limit and offset', () => {
      const readQL = query<TestUserRaw>(mockConnectionProvider, testTable)
        .limit(10)
        .offset(5)

      assert(readQL instanceof ReadQL)
    })
  })

  describe('select()', () => {
    it('should set select fields', () => {
      const readQL = query<TestUserRaw>(mockConnectionProvider, testTable)
        .select('username', 'email')

      assert(readQL instanceof ReadQL)
    })

    it('should override previous select() calls', () => {
      const readQL = query<TestUserRaw>(mockConnectionProvider, testTable)
        .select('username')
        .select('email', 'active')

      assert(readQL instanceof ReadQL)
    })
  })

  describe('withContext()', () => {
    it('should return this for method chaining', () => {
      const readQL = query<TestUserRaw>(mockConnectionProvider, testTable)
      const result = readQL.withContext('test-context')

      assertEquals(result, readQL)
    })
  })

  describe('execute()', () => {
    it('should execute query and return Promise<T[]>', async () => {
      const mockRecordId = new RecordId('users', '123')
      const mockData = [
        { id: mockRecordId, username: 'puffin123', email: 'puffin@example.com', active: true, created_at: new Date() },
      ]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([mockData]),
          close: () => Promise.resolve(),
        } as unknown as Surreal))

      try {
        const readQL = query<TestUserRaw, TestUser>(mockConnectionProvider, testTable)
          .map((raw: TestUserRaw) => ({
            id: recordIdToString(raw.id),
            username: raw.username,
            email: raw.email,
            active: raw.active,
            created_at: raw.created_at.toISOString(),
          }))

        const result = await readQL.execute()

        assert(Array.isArray(result))
        assertEquals(result.length, 1)
        assertEquals(result[0].id, 'users:123')
        assertEquals(result[0].username, 'puffin123')
      } finally {
        connectionStub.restore()
      }
    })

    it('should show console warning when no mapper provided with T = R defaults', async () => {
      const mockRecordId = new RecordId('users', '123')
      const mockData = [
        { id: mockRecordId, username: 'puffin123', email: 'puffin@example.com', active: true, created_at: new Date() },
      ]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([mockData]),
          close: () => Promise.resolve(),
        } as unknown as Surreal))

      // Mock console.warn to capture warnings
      const originalWarn = console.warn
      let warningMessage = ''
      console.warn = (message: string) => {
        warningMessage = message
      }

      try {
        const readQL = query<TestUserRaw>(mockConnectionProvider, testTable)
        await readQL.execute()

        assert(warningMessage.includes('SurQL: No mapper function provided'))
        assert(warningMessage.includes('RecordId fields will be normalized to strings automatically'))
      } finally {
        connectionStub.restore()
        console.warn = originalWarn
      }
    })

    it('should handle empty results', async () => {
      const connectionStub = stub(mockConnectionProvider, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([[]]),
          close: () => Promise.resolve(),
        } as unknown as Surreal))

      try {
        const readQL = query<TestUserRaw, TestUser>(mockConnectionProvider, testTable)
          .map((raw: TestUserRaw) => ({
            id: recordIdToString(raw.id),
            username: raw.username,
            email: raw.email,
            active: raw.active,
            created_at: raw.created_at.toISOString(),
          }))

        const result = await readQL.execute()

        assert(Array.isArray(result))
        assertEquals(result.length, 0)
      } finally {
        connectionStub.restore()
      }
    })
  })

  describe('first()', () => {
    it('should return first result or undefined', async () => {
      const mockRecordId = new RecordId('users', '123')
      const mockData = [
        { id: mockRecordId, username: 'puffin123', email: 'puffin@example.com', active: true, created_at: new Date() },
      ]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([mockData]),
          close: () => Promise.resolve(),
        } as unknown as Surreal))

      try {
        const readQL = query<TestUserRaw, TestUser>(mockConnectionProvider, testTable)
          .map((raw: TestUserRaw) => ({
            id: recordIdToString(raw.id),
            username: raw.username,
            email: raw.email,
            active: raw.active,
            created_at: raw.created_at.toISOString(),
          }))

        const result = await readQL.first()

        assert(result !== undefined)
        assertEquals(result.id, 'users:123')
        assertEquals(result.username, 'puffin123')
      } finally {
        connectionStub.restore()
      }
    })

    it('should return undefined for empty results', async () => {
      const connectionStub = stub(mockConnectionProvider, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([[]]),
          close: () => Promise.resolve(),
        } as unknown as Surreal))

      try {
        const readQL = query<TestUserRaw, TestUser>(mockConnectionProvider, testTable)
          .map((raw: TestUserRaw) => ({
            id: recordIdToString(raw.id),
            username: raw.username,
            email: raw.email,
            active: raw.active,
            created_at: raw.created_at.toISOString(),
          }))

        const result = await readQL.first()

        assertEquals(result, undefined)
      } finally {
        connectionStub.restore()
      }
    })
  })

  describe('fluent chaining', () => {
    it('should support complex fluent chains', async () => {
      const mockRecordId = new RecordId('users', '123')
      const mockData = [
        { id: mockRecordId, username: 'puffin123', email: 'puffin@example.com', active: true, created_at: new Date() },
      ]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([mockData]),
          close: () => Promise.resolve(),
        } as unknown as Surreal))

      try {
        const result = await query<TestUserRaw, TestUser>(mockConnectionProvider, testTable)
          .map((raw: TestUserRaw) => ({
            id: recordIdToString(raw.id),
            username: raw.username,
            email: raw.email,
            active: raw.active,
            created_at: raw.created_at.toISOString(),
          }))
          .where({ active: true })
          .where('username', Op.CONTAINS, 'puffin')
          .whereEquals('email', 'puffin@example.com')
          .orderBy('created_at', SortDirection.DESC)
          .limit(10)
          .offset(0)
          .select('username', 'email')
          .withContext('complex-chain-test')
          .execute()

        assert(Array.isArray(result))
        assertEquals(result.length, 1)
      } finally {
        connectionStub.restore()
      }
    })
  })
})

describe('query() factory function', () => {
  it('should create a ReadQL instance', () => {
    const readQL = query<TestUserRaw>(mockConnectionProvider, testTable)
    assert(readQL instanceof ReadQL)
  })

  it('should accept custom context', () => {
    const readQL = query(mockConnectionProvider, testTable)
    assert(readQL instanceof ReadQL)
  })

  describe('T = R defaults (new functionality)', () => {
    it('should work without explicit T type parameter and return normalized types', async () => {
      const mockRecordId = new RecordId('users', '123')
      const mockData = [
        { id: mockRecordId, username: 'puffin123', email: 'puffin@example.com', active: true, created_at: new Date() },
      ]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([mockData]),
          close: () => Promise.resolve(),
        } as unknown as Surreal))

      try {
        // Using query with explicit R type but T = R default
        const readQL = query<TestUserRaw>(mockConnectionProvider, testTable)
        const result = await readQL.execute()

        assert(Array.isArray(result))
        assertEquals(result.length, 1)
        assertEquals(typeof (result[0] as unknown as { id: string }).id, 'string') // RecordId normalized to string
        assertEquals((result[0] as unknown as { id: string }).id, 'users:123')
        assertEquals(result[0].username, 'puffin123')
      } finally {
        connectionStub.restore()
      }
    })

    it('should show console warning when no mapper provided but type specified', async () => {
      const mockRecordId = new RecordId('users', '123')
      const mockData = [
        { id: mockRecordId, username: 'puffin123', email: 'puffin@example.com', active: true, created_at: new Date() },
      ]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([mockData]),
          close: () => Promise.resolve(),
        } as unknown as Surreal))

      // Mock console.warn to capture warnings
      const originalWarn = console.warn
      let warningMessage = ''
      console.warn = (message: string) => {
        warningMessage = message
      }

      try {
        // Explicitly specify different T type but don't provide mapper
        const readQL = query<TestUserRaw, TestUser>(mockConnectionProvider, testTable)
        await readQL.execute()

        assert(warningMessage.includes('SurQL: No mapper function provided'))
        assert(warningMessage.includes('RecordId fields will be normalized to strings automatically'))
      } finally {
        connectionStub.restore()
        console.warn = originalWarn
      }
    })

    it('should maintain backward compatibility with explicit mapping', async () => {
      const mockRecordId = new RecordId('users', '123')
      const mockData = [
        { id: mockRecordId, username: 'puffin123', email: 'puffin@example.com', active: true, created_at: new Date() },
      ]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([mockData]),
          close: () => Promise.resolve(),
        } as unknown as Surreal))

      try {
        // Explicit mapping should still work as before
        const readQL = query<TestUserRaw, TestUser>(mockConnectionProvider, testTable)
          .map((raw: TestUserRaw) => ({
            id: recordIdToString(raw.id),
            username: raw.username,
            email: raw.email,
            active: raw.active,
            created_at: raw.created_at.toISOString(),
          }))

        const result = await readQL.execute()

        assert(Array.isArray(result))
        assertEquals(result.length, 1)
        assertEquals(typeof result[0].id, 'string') // Should be string when mapped
        assertEquals(result[0].id, 'users:123')
        assertEquals(typeof result[0].created_at, 'string') // Should be string when mapped
      } finally {
        connectionStub.restore()
      }
    })

    it('should work with first() and return normalized types', async () => {
      const mockRecordId = new RecordId('users', '123')
      const mockData = [
        { id: mockRecordId, username: 'puffin123', email: 'puffin@example.com', active: true, created_at: new Date() },
      ]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([mockData]),
          close: () => Promise.resolve(),
        } as unknown as Surreal))

      try {
        const readQL = query<TestUserRaw>(mockConnectionProvider, testTable)
        const result = await readQL.first()

        assert(result !== undefined)
        assertEquals(typeof (result as unknown as { id: string }).id, 'string') // RecordId normalized to string
        assertEquals((result as unknown as { id: string }).id, 'users:123')
        assertEquals(result.username, 'puffin123')
      } finally {
        connectionStub.restore()
      }
    })

    it('should handle empty results with T = R defaults', async () => {
      const connectionStub = stub(mockConnectionProvider, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([[]]),
          close: () => Promise.resolve(),
        } as unknown as Surreal))

      try {
        const readQL = query<TestUserRaw>(mockConnectionProvider, testTable)
        const result = await readQL.execute()

        assert(Array.isArray(result))
        assertEquals(result.length, 0)
      } finally {
        connectionStub.restore()
      }
    })

    it('should work with complex queries and return normalized types', async () => {
      const mockRecordId = new RecordId('users', '123')
      const mockData = [
        { id: mockRecordId, username: 'puffin123', email: 'puffin@example.com', active: true, created_at: new Date() },
      ]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([mockData]),
          close: () => Promise.resolve(),
        } as unknown as Surreal))

      try {
        const result = await query<TestUserRaw>(mockConnectionProvider, testTable)
          .where({ active: true })
          .where('username', Op.CONTAINS, 'puffin')
          .whereEquals('email', 'puffin@example.com')
          .orderBy('created_at', SortDirection.DESC)
          .limit(10)
          .offset(0)
          .select('username', 'email')
          .execute()

        assert(Array.isArray(result))
        assertEquals(result.length, 1)
        assertEquals(typeof (result[0] as unknown as { id: string }).id, 'string') // RecordId normalized to string
        assertEquals((result[0] as unknown as { id: string }).id, 'users:123')
      } finally {
        connectionStub.restore()
      }
    })
  })
})
