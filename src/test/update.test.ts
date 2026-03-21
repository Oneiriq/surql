import { assert, assertEquals, assertRejects } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { RecordId } from 'surrealdb'
import { stub } from '@std/testing/mock'
import { update, UpdateQL } from '../crud/write.ts'
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

describe('UpdateQL', () => {
  describe('constructor', () => {
    it('should create a new UpdateQL instance', () => {
      const updateQL = new UpdateQL(mockConnectionProvider, testTable, 'users:123', { username: 'updated' })
      assert(updateQL instanceof UpdateQL)
    })

    it('should accept RecordId parameter', () => {
      const recordId = new RecordId('users', '123')
      const updateQL = new UpdateQL(mockConnectionProvider, testTable, recordId, { username: 'updated' })
      assert(updateQL instanceof UpdateQL)
    })
  })

  describe('replace()', () => {
    it('should return this for method chaining', () => {
      const updateQL = update(mockConnectionProvider, testTable, 'users:123', { username: 'test' })
      const result = updateQL.replace()

      assertEquals(result, updateQL)
    })
  })

  describe('execute()', () => {
    it('should execute update operation and return Promise<T>', async () => {
      const mockData = [createTestUserRaw({
        username: 'updated_puffin',
        email: 'puffin@example.com',
      })]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const updateQL = update<TestUserRaw, TestUser>(mockConnectionProvider, testTable, 'users:123', {
          username: 'updated_puffin',
        })
          .map(mapTestUser)

        const result = await updateQL.execute()

        assertEquals(result.id, 'users:123')
        assertEquals(result.username, 'updated_puffin')
      } finally {
        connectionStub.restore()
      }
    })

    it('should support replace mode', async () => {
      const mockData = [createTestUserRaw({
        username: 'replaced_user',
        email: 'new@example.com',
        active: false,
      })]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const updateQL = update<TestUserRaw, TestUser>(mockConnectionProvider, testTable, 'users:123', {
          username: 'replaced_user',
          email: 'new@example.com',
          active: false,
        })
          .replace()
          .map(mapTestUser)

        const result = await updateQL.execute()

        assertEquals(result.username, 'replaced_user')
        assertEquals(result.email, 'new@example.com')
        assertEquals(result.active, false)
      } finally {
        connectionStub.restore()
      }
    })

    it('should throw error when no records returned', async () => {
      const connectionStub = stub(mockConnectionProvider, 'getConnection', createEmptyMockConnectionStub())

      try {
        const updateQL = update<TestUserRaw, TestUser>(mockConnectionProvider, testTable, 'users:999', {
          username: 'test',
        })
          .map(mapTestUser)

        await assertRejects(
          () => updateQL.execute(),
          Error,
          'Update operation returned no records',
        )
      } finally {
        connectionStub.restore()
      }
    })

    it('should work without explicit T type parameter and return normalized types', async () => {
      const mockRecordId = new RecordId('users', '123')
      const mockData = [createTestUserRaw({
        id: mockRecordId,
        username: 'updated_puffin',
        email: 'puffin@example.com',
      })]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const updateQL = update<TestUserRaw>(mockConnectionProvider, testTable, 'users:123', {
          username: 'updated_puffin',
        })

        const result = await updateQL.execute()

        assertEquals(typeof (result as unknown as { id: string }).id, 'string') // RecordId normalized to string
        assertEquals((result as unknown as { id: string }).id, 'users:123')
        assertEquals(result.username, 'updated_puffin')
      } finally {
        connectionStub.restore()
      }
    })

    it('should work in replace mode with T = R defaults', async () => {
      const mockRecordId = new RecordId('users', '123')
      const mockData = [createTestUserRaw({
        id: mockRecordId,
        username: 'replaced_user',
        email: 'new@example.com',
        active: false,
      })]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const updateQL = update<TestUserRaw>(mockConnectionProvider, testTable, 'users:123', {
          username: 'replaced_user',
          email: 'new@example.com',
          active: false,
        })
          .replace()

        const result = await updateQL.execute()

        assertEquals(typeof (result as unknown as { id: string }).id, 'string') // RecordId normalized to string
        assertEquals((result as unknown as { id: string }).id, 'users:123')
        assertEquals(result.username, 'replaced_user')
        assertEquals(result.email, 'new@example.com')
        assertEquals(result.active, false)
      } finally {
        connectionStub.restore()
      }
    })
  })
})
