import { assert, assertEquals } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { stub } from '@std/testing/mock'
import { RecordId, type Surreal } from 'surrealdb'
import { type ConnectionProvider } from '../crud/base.ts'
import { query } from '../crud/read.ts'
import { create, remove, update } from '../crud/write.ts'
import { merge } from '../crud/merge.ts'
import { upsert } from '../crud/upsert.ts'
import { recordIdToString } from '../utils/helpers.ts'

const mockConnectionProvider: ConnectionProvider = {
  getConnection: () =>
    Promise.resolve({
      query: <T>() => Promise.resolve([]) as Promise<T>,
      close: () => Promise.resolve(),
    } as unknown as Surreal),
}

const testTable = 'users'

interface TestUserRaw {
  id: RecordId
  username: string
  email: string
  active: boolean
}

interface TestUser {
  id: string
  username: string
  email: string
  active: boolean
}

describe('Automatic RecordID normalization', () => {
  describe('ReadQL - without mapper', () => {
    it('should normalize RecordId to string in array results', async () => {
      const mockRecordId = new RecordId('users', '123')
      const mockData = [
        { id: mockRecordId, username: 'puffin123', email: 'puffin@example.com', active: true },
      ]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([mockData]),
          close: () => Promise.resolve(),
        } as unknown as Surreal))

      try {
        const result = await query<TestUserRaw>(mockConnectionProvider, testTable, { warnings: 'suppress' })
          .execute()

        assert(Array.isArray(result))
        assertEquals(result.length, 1)

        const record = result[0] as unknown as { id: string }
        assertEquals(typeof record.id, 'string')
        assertEquals(record.id, 'users:123')
      } finally {
        connectionStub.restore()
      }
    })

    it('should normalize RecordId to string in first() result', async () => {
      const mockRecordId = new RecordId('users', '456')
      const mockData = [
        { id: mockRecordId, username: 'seal42', email: 'seal@example.com', active: false },
      ]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([mockData]),
          close: () => Promise.resolve(),
        } as unknown as Surreal))

      try {
        const result = await query<TestUserRaw>(mockConnectionProvider, testTable, { warnings: 'suppress' })
          .first()

        assert(result !== undefined)
        const record = result as unknown as { id: string }
        assertEquals(typeof record.id, 'string')
        assertEquals(record.id, 'users:456')
      } finally {
        connectionStub.restore()
      }
    })

    it('should normalize multiple records', async () => {
      const mockData = [
        { id: new RecordId('users', 'a'), username: 'alpha', email: 'a@test.com', active: true },
        { id: new RecordId('users', 'b'), username: 'beta', email: 'b@test.com', active: false },
        { id: new RecordId('users', 'c'), username: 'gamma', email: 'c@test.com', active: true },
      ]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([mockData]),
          close: () => Promise.resolve(),
        } as unknown as Surreal))

      try {
        const result = await query<TestUserRaw>(mockConnectionProvider, testTable, { warnings: 'suppress' })
          .execute()

        assert(Array.isArray(result))
        assertEquals(result.length, 3)

        const records = result as unknown as { id: string }[]
        assertEquals(records[0].id, 'users:a')
        assertEquals(records[1].id, 'users:b')
        assertEquals(records[2].id, 'users:c')
        records.forEach((r) => assertEquals(typeof r.id, 'string'))
      } finally {
        connectionStub.restore()
      }
    })

    it('should handle empty results without error', async () => {
      const connectionStub = stub(mockConnectionProvider, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([[]]),
          close: () => Promise.resolve(),
        } as unknown as Surreal))

      try {
        const result = await query<TestUserRaw>(mockConnectionProvider, testTable, { warnings: 'suppress' })
          .execute()

        assert(Array.isArray(result))
        assertEquals(result.length, 0)
      } finally {
        connectionStub.restore()
      }
    })
  })

  describe('ReadQL - with mapper', () => {
    it('should still apply mapper when provided', async () => {
      const mockRecordId = new RecordId('users', '789')
      const mockData = [
        { id: mockRecordId, username: 'walrus99', email: 'walrus@example.com', active: true },
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
          }))
          .execute()

        assert(Array.isArray(result))
        assertEquals(result.length, 1)
        assertEquals(typeof result[0].id, 'string')
        assertEquals(result[0].id, 'users:789')
      } finally {
        connectionStub.restore()
      }
    })
  })

  describe('CreateQL - without mapper', () => {
    it('should normalize RecordId in created record', async () => {
      const mockRecordId = new RecordId('users', 'new1')
      const mockRecord = { id: mockRecordId, username: 'newuser', email: 'new@example.com', active: true }

      const connectionStub = stub(mockConnectionProvider, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([[mockRecord]]),
          close: () => Promise.resolve(),
        } as unknown as Surreal))

      try {
        const result = await create<TestUserRaw>(
          mockConnectionProvider,
          testTable,
          { username: 'newuser', email: 'new@example.com', active: true },
          { warnings: 'suppress' },
        ).execute()

        const record = result as unknown as { id: string }
        assertEquals(typeof record.id, 'string')
        assertEquals(record.id, 'users:new1')
      } finally {
        connectionStub.restore()
      }
    })
  })

  describe('UpdateQL - without mapper', () => {
    it('should normalize RecordId in updated record', async () => {
      const mockRecordId = new RecordId('users', 'upd1')
      const mockRecord = { id: mockRecordId, username: 'updated', email: 'upd@example.com', active: false }

      const connectionStub = stub(mockConnectionProvider, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([[mockRecord]]),
          close: () => Promise.resolve(),
        } as unknown as Surreal))

      try {
        const result = await update<TestUserRaw>(
          mockConnectionProvider,
          testTable,
          'users:upd1',
          { username: 'updated' },
          { warnings: 'suppress' },
        ).execute()

        const record = result as unknown as { id: string }
        assertEquals(typeof record.id, 'string')
        assertEquals(record.id, 'users:upd1')
      } finally {
        connectionStub.restore()
      }
    })
  })

  describe('DeleteQL - without mapper', () => {
    it('should normalize RecordId in deleted record', async () => {
      const mockRecordId = new RecordId('users', 'del1')
      const mockRecord = { id: mockRecordId, username: 'deleted', email: 'del@example.com', active: false }

      const connectionStub = stub(mockConnectionProvider, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([[mockRecord]]),
          close: () => Promise.resolve(),
        } as unknown as Surreal))

      try {
        const result = await remove<TestUserRaw>(
          mockConnectionProvider,
          testTable,
          'users:del1',
          { warnings: 'suppress' },
        ).execute()

        const record = result as unknown as { id: string }
        assertEquals(typeof record.id, 'string')
        assertEquals(record.id, 'users:del1')
      } finally {
        connectionStub.restore()
      }
    })
  })

  describe('MergeQL - without mapper', () => {
    it('should normalize RecordId in merged record', async () => {
      const mockRecordId = new RecordId('users', 'mrg1')
      const mockRecord = { id: mockRecordId, username: 'merged', email: 'mrg@example.com', active: true }

      const connectionStub = stub(mockConnectionProvider, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([[mockRecord]]),
          close: () => Promise.resolve(),
        } as unknown as Surreal))

      try {
        const result = await merge<TestUserRaw>(
          mockConnectionProvider,
          testTable,
          'users:mrg1',
          { email: 'mrg@example.com' },
          { warnings: 'suppress' },
        ).execute()

        const record = result as unknown as { id: string }
        assertEquals(typeof record.id, 'string')
        assertEquals(record.id, 'users:mrg1')
      } finally {
        connectionStub.restore()
      }
    })
  })

  describe('UpsertQL - without mapper', () => {
    it('should normalize RecordId in upserted record', async () => {
      const mockRecordId = new RecordId('users', 'ups1')
      const mockRecord = { id: mockRecordId, username: 'upserted', email: 'ups@example.com', active: true }

      const connectionStub = stub(mockConnectionProvider, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([[mockRecord]]),
          close: () => Promise.resolve(),
        } as unknown as Surreal))

      try {
        const result = await upsert<TestUserRaw>(
          mockConnectionProvider,
          testTable,
          { username: 'upserted', email: 'ups@example.com', active: true },
          { warnings: 'suppress' },
        )
          .withId('users:ups1')
          .execute()

        const record = result as unknown as { id: string }
        assertEquals(typeof record.id, 'string')
        assertEquals(record.id, 'users:ups1')
      } finally {
        connectionStub.restore()
      }
    })
  })

  describe('angle bracket stripping', () => {
    it('should strip angle brackets from RecordId string representation', async () => {
      // Some SurrealDB versions wrap IDs in angle brackets
      const mockRecordId = new RecordId('users', 'special-id')
      const mockData = [
        { id: mockRecordId, username: 'special', email: 'special@example.com', active: true },
      ]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([mockData]),
          close: () => Promise.resolve(),
        } as unknown as Surreal))

      try {
        const result = await query<TestUserRaw>(mockConnectionProvider, testTable, { warnings: 'suppress' })
          .execute()

        assert(Array.isArray(result))
        assertEquals(result.length, 1)

        const record = result[0] as unknown as { id: string }
        assertEquals(typeof record.id, 'string')
        // Verify no angle brackets remain
        assert(!record.id.includes('\u27E8'))
        assert(!record.id.includes('\u27E9'))
      } finally {
        connectionStub.restore()
      }
    })
  })

  describe('preserves non-id fields', () => {
    it('should preserve all other fields unchanged during normalization', async () => {
      const mockRecordId = new RecordId('users', 'preserve1')
      const mockData = [
        { id: mockRecordId, username: 'keeper', email: 'keep@example.com', active: true },
      ]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([mockData]),
          close: () => Promise.resolve(),
        } as unknown as Surreal))

      try {
        const result = await query<TestUserRaw>(mockConnectionProvider, testTable, { warnings: 'suppress' })
          .execute()

        assert(Array.isArray(result))
        assertEquals(result.length, 1)

        const record = result[0] as unknown as TestUser
        assertEquals(record.id, 'users:preserve1')
        assertEquals(record.username, 'keeper')
        assertEquals(record.email, 'keep@example.com')
        assertEquals(record.active, true)
      } finally {
        connectionStub.restore()
      }
    })
  })
})
