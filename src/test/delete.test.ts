import { assert, assertEquals, assertRejects } from '@std/assert'
import { DeleteQL, remove } from '../crud/write.ts'
import { describe, it } from '@std/testing/bdd'
import { RecordId } from 'surrealdb'
import { stub } from '@std/testing/mock'
import {
  createEmptyMockConnectionStub,
  createMockConnectionStub,
  createTestUserRaw,
  mapTestUser,
  mockConnectionProvider,
  testTable,
  type TestUser,
  type TestUserRaw,
} from './helpers.ts'

describe('DeleteQL', () => {
  describe('constructor', () => {
    it('should create a new DeleteQL instance', () => {
      const deleteQL = new DeleteQL(mockConnectionProvider, testTable, 'users:123')
      assert(deleteQL instanceof DeleteQL)
    })

    it('should accept RecordId parameter', () => {
      const recordId = new RecordId('users', '123')
      const deleteQL = new DeleteQL(mockConnectionProvider, testTable, recordId)
      assert(deleteQL instanceof DeleteQL)
    })
  })

  describe('execute()', () => {
    it('should execute delete operation and return Promise<T>', async () => {
      const mockData = [createTestUserRaw({
        username: 'deleted_user',
        email: 'deleted@example.com',
        active: false,
      })]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const deleteQL = remove<TestUserRaw, TestUser>(mockConnectionProvider, testTable, 'users:123')
          .map(mapTestUser)

        const result = await deleteQL.execute()

        assertEquals(result.id, 'users:123')
        assertEquals(result.username, 'deleted_user')
      } finally {
        connectionStub.restore()
      }
    })

    it('should throw error when no records returned', async () => {
      const connectionStub = stub(mockConnectionProvider, 'getConnection', createEmptyMockConnectionStub())

      try {
        const deleteQL = remove<TestUserRaw, TestUser>(mockConnectionProvider, testTable, 'users:999')
          .map(mapTestUser)

        await assertRejects(
          () => deleteQL.execute(),
          Error,
          'Delete operation returned no records',
        )
      } finally {
        connectionStub.restore()
      }
    })

    it('should work without explicit T type parameter and return normalized types', async () => {
      const mockRecordId = new RecordId('users', '123')
      const mockData = [createTestUserRaw({
        id: mockRecordId,
        username: 'deleted_user',
        email: 'deleted@example.com',
        active: false,
      })]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const deleteQL = remove<TestUserRaw>(mockConnectionProvider, testTable, 'users:123')

        const result = await deleteQL.execute()

        assertEquals(typeof (result as unknown as { id: string }).id, 'string') // RecordId normalized to string
        assertEquals((result as unknown as { id: string }).id, 'users:123')
        assertEquals(result.username, 'deleted_user')
      } finally {
        connectionStub.restore()
      }
    })

    it('should maintain backward compatibility with explicit mapping', async () => {
      const mockData = [createTestUserRaw({
        username: 'deleted_user',
        email: 'deleted@example.com',
        active: false,
      })]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const deleteQL = remove<TestUserRaw, TestUser>(mockConnectionProvider, testTable, 'users:123')
          .map(mapTestUser)

        const result = await deleteQL.execute()

        assertEquals(typeof result.id, 'string') // Should be string when mapped
        assertEquals(result.id, 'users:123')
        assertEquals(typeof result.created_at, 'string') // Should be string when mapped
      } finally {
        connectionStub.restore()
      }
    })
  })
})
