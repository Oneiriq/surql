import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { merge, MergeQL } from '../crud/merge.ts'
import { RecordId } from 'surrealdb'
import { stub } from '@std/testing/mock'
import { SurQLClient } from '../client.ts'
import { upsert, UpsertQL } from '../crud/upsert.ts'
import { patch, type PatchOperation, PatchOperationError, PatchQL } from '../crud/patch.ts'
import {
  captureConsoleWarnings,
  createEmptyMockConnectionStub,
  createMockConnectionStub,
  createTestUserRaw,
  mapTestUser,
  mockConnectionProvider,
  testTable,
  type TestUser,
  type TestUserRaw,
} from './helpers.ts'

describe('MergeQL', () => {
  describe('constructor', () => {
    it('should create a new MergeQL instance', () => {
      const mergeQL = new MergeQL(mockConnectionProvider, testTable, 'user:123', { email: 'new@example.com' })
      assert(mergeQL instanceof MergeQL)
    })

    it('should accept RecordId as target', () => {
      const recordId = new RecordId('users', '123')
      const mergeQL = new MergeQL(mockConnectionProvider, testTable, recordId, { email: 'new@example.com' })
      assert(mergeQL instanceof MergeQL)
    })
  })

  describe('execute()', () => {
    it('should execute merge operation and return merged record', async () => {
      const mockData = [createTestUserRaw({
        username: 'puffin123',
        email: 'updated@example.com', // Updated email
        active: true,
      })]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const mergeQL = merge<TestUserRaw, TestUser>(mockConnectionProvider, testTable, 'user:123', {
          email: 'updated@example.com',
          lastLogin: new Date(),
        })
          .map(mapTestUser)

        const result = await mergeQL.execute()

        assertEquals(result.id, 'users:123')
        assertEquals(result.email, 'updated@example.com')
        assertEquals(result.username, 'puffin123') // Original data preserved
      } finally {
        connectionStub.restore()
      }
    })

    it('should show console warning when no mapper provided with T = R defaults', async () => {
      const mockData = [createTestUserRaw({ email: 'updated@example.com' })]
      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const { warning } = await captureConsoleWarnings(async () => {
          const mergeQL = merge<TestUserRaw>(mockConnectionProvider, testTable, 'user:123', {
            email: 'updated@example.com',
          })
          return await mergeQL.execute()
        })

        assert(warning.includes('RecordId fields will be normalized to strings automatically'))
      } finally {
        connectionStub.restore()
      }
    })

    it('should throw error when no records returned', async () => {
      const connectionStub = stub(mockConnectionProvider, 'getConnection', createEmptyMockConnectionStub())

      try {
        const mergeQL = merge<TestUserRaw, TestUser>(mockConnectionProvider, testTable, 'user:123', {
          email: 'updated@example.com',
        })
          .map(mapTestUser)

        await assertRejects(
          () => mergeQL.execute(),
          Error,
          'Merge operation returned no records - record may not exist',
        )
      } finally {
        connectionStub.restore()
      }
    })

    it('should work without explicit T type parameter and return raw types', async () => {
      const mockRecordId = new RecordId('users', '123')
      const mockData = [createTestUserRaw({
        id: mockRecordId,
        email: 'updated@example.com',
      })]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const mergeQL = merge<TestUserRaw>(mockConnectionProvider, testTable, 'user:123', {
          email: 'updated@example.com',
        })

        const result = await mergeQL.execute()

        assertEquals(typeof (result as unknown as { id: string }).id, 'string') // RecordId normalized to string
        assertEquals((result as unknown as { id: string }).id, 'users:123')
        assertEquals(result.email, 'updated@example.com')
      } finally {
        connectionStub.restore()
      }
    })

    it('should handle partial data merge correctly', async () => {
      const mockData = [createTestUserRaw({
        username: 'original_user',
        email: 'updated@example.com', // Only email updated
        active: true, // Original value preserved
      })]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const mergeQL = merge<TestUserRaw, TestUser>(mockConnectionProvider, testTable, 'user:123', {
          email: 'updated@example.com', // Only updating email
        })
          .map(mapTestUser)

        const result = await mergeQL.execute()

        assertEquals(result.email, 'updated@example.com')
        assertEquals(result.username, 'original_user') // Should be preserved
        assertEquals(result.active, true) // Should be preserved
      } finally {
        connectionStub.restore()
      }
    })
  })

  describe('withContext()', () => {
    it('should return this for method chaining', () => {
      const mergeQL = merge(mockConnectionProvider, testTable, 'user:123', { email: 'test@example.com' })
      const result = mergeQL.withContext('test-context')

      assertEquals(result, mergeQL)
    })
  })
})

describe('PatchQL', () => {
  describe('constructor', () => {
    it('should create a new PatchQL instance', () => {
      const operations: PatchOperation[] = [
        { op: 'replace', path: '/email', value: 'new@example.com' },
      ]
      const patchQL = new PatchQL(mockConnectionProvider, testTable, 'user:123', operations)
      assert(patchQL instanceof PatchQL)
    })

    it('should accept RecordId as target', () => {
      const recordId = new RecordId('users', '123')
      const operations: PatchOperation[] = [
        { op: 'replace', path: '/email', value: 'new@example.com' },
      ]
      const patchQL = new PatchQL(mockConnectionProvider, testTable, recordId, operations)
      assert(patchQL instanceof PatchQL)
    })

    it('should validate operations on construction', () => {
      const invalidOperations: PatchOperation[] = [
        { op: 'replace', path: 'invalid-path', value: 'test' },
      ]

      assertThrows(
        () => new PatchQL(mockConnectionProvider, testTable, 'user:123', invalidOperations),
        PatchOperationError,
        'Path must start with "/"',
      )
    })
  })

  describe('addOperation()', () => {
    it('should add single patch operation', () => {
      const patchQL = patch(mockConnectionProvider, testTable, 'user:123', [])
      const operation: PatchOperation = { op: 'add', path: '/newField', value: 'newValue' }

      const result = patchQL.addOperation(operation)
      assertEquals(result, patchQL) // Should return this for chaining
    })

    it('should validate operation when adding', () => {
      const patchQL = patch(mockConnectionProvider, testTable, 'user:123', [])
      const invalidOperation = { op: 'invalid', path: '/test', value: 'test' } as unknown as PatchOperation

      assertThrows(
        () => patchQL.addOperation(invalidOperation),
        PatchOperationError,
        'Invalid operation "invalid"',
      )
    })
  })

  describe('addOperations()', () => {
    it('should add multiple patch operations', () => {
      const patchQL = patch(mockConnectionProvider, testTable, 'user:123', [])
      const operations: PatchOperation[] = [
        { op: 'add', path: '/field1', value: 'value1' },
        { op: 'replace', path: '/field2', value: 'value2' },
      ]

      const result = patchQL.addOperations(operations)
      assertEquals(result, patchQL) // Should return this for chaining
    })

    it('should validate all operations when adding multiple', () => {
      const patchQL = patch(mockConnectionProvider, testTable, 'user:123', [])
      const operations = [
        { op: 'add', path: '/valid', value: 'test' },
        { op: 'invalid', path: '/test', value: 'test' },
      ] as unknown as PatchOperation[]

      assertThrows(
        () => patchQL.addOperations(operations),
        PatchOperationError,
        'Invalid operation "invalid"',
      )
    })
  })

  describe('execute()', () => {
    it('should execute patch operations and return patched record', async () => {
      const mockData = [createTestUserRaw({
        username: 'puffin123',
        email: 'patched@example.com', // Patched email
        active: true,
      })]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const operations: PatchOperation[] = [
          { op: 'replace', path: '/email', value: 'patched@example.com' },
        ]

        const patchQL = patch<TestUserRaw, TestUser>(mockConnectionProvider, testTable, 'user:123', operations)
          .map(mapTestUser)

        const result = await patchQL.execute()

        assertEquals(result.id, 'users:123')
        assertEquals(result.email, 'patched@example.com')
      } finally {
        connectionStub.restore()
      }
    })

    it('should execute multiple patch operations', async () => {
      const mockData = [createTestUserRaw({
        username: 'puffin123',
        email: 'new@example.com',
        active: false, // Changed by patch
      })]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const patchQL = patch<TestUserRaw, TestUser>(mockConnectionProvider, testTable, 'user:123', [
          { op: 'replace', path: '/email', value: 'new@example.com' },
          { op: 'replace', path: '/active', value: false },
        ])
          .map(mapTestUser)

        const result = await patchQL.execute()

        assertEquals(result.email, 'new@example.com')
        assertEquals(result.active, false)
      } finally {
        connectionStub.restore()
      }
    })

    it('should test all JSON Patch operation types', async () => {
      const mockData = [createTestUserRaw({
        username: 'puffin123',
        email: 'test@example.com',
        active: true,
      })]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const operations: PatchOperation[] = [
          // Add operation
          { op: 'add', path: '/newField', value: 'addedValue' },
          // Remove operation
          { op: 'remove', path: '/oldField' },
          // Replace operation
          { op: 'replace', path: '/email', value: 'replaced@example.com' },
          // Move operation
          { op: 'move', from: '/oldLocation', path: '/newLocation' },
          // Copy operation
          { op: 'copy', from: '/source', path: '/destination' },
          // Test operation
          { op: 'test', path: '/active', value: true },
        ]

        const patchQL = patch<TestUserRaw, TestUser>(mockConnectionProvider, testTable, 'user:123', operations)
          .map(mapTestUser)

        const result = await patchQL.execute()
        assert(result.id) // Should return successfully if all operations are valid
      } finally {
        connectionStub.restore()
      }
    })

    it('should throw error when no operations specified', async () => {
      const patchQL = patch<TestUserRaw, TestUser>(mockConnectionProvider, testTable, 'user:123', [])
        .map(mapTestUser)

      await assertRejects(
        () => patchQL.execute(),
        PatchOperationError,
        'No patch operations specified',
      )
    })

    it('should throw error when no records returned', async () => {
      const connectionStub = stub(mockConnectionProvider, 'getConnection', createEmptyMockConnectionStub())

      try {
        const operations: PatchOperation[] = [
          { op: 'replace', path: '/email', value: 'test@example.com' },
        ]

        const patchQL = patch<TestUserRaw, TestUser>(mockConnectionProvider, testTable, 'user:123', operations)
          .map(mapTestUser)

        await assertRejects(
          () => patchQL.execute(),
          Error,
          'Patch operation returned no records - record may not exist',
        )
      } finally {
        connectionStub.restore()
      }
    })

    it('should show console warning when no mapper provided', async () => {
      const mockData = [createTestUserRaw({ email: 'patched@example.com' })]
      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const { warning } = await captureConsoleWarnings(async () => {
          const operations: PatchOperation[] = [
            { op: 'replace', path: '/email', value: 'patched@example.com' },
          ]
          const patchQL = patch<TestUserRaw>(mockConnectionProvider, testTable, 'user:123', operations)
          return await patchQL.execute()
        })

        assert(warning.includes('RecordId fields will be normalized to strings automatically'))
      } finally {
        connectionStub.restore()
      }
    })
  })

  describe('operation validation', () => {
    it('should validate add operation requires value', () => {
      assertThrows(
        () =>
          patch(mockConnectionProvider, testTable, 'user:123', [
            { op: 'add', path: '/test' } as unknown as PatchOperation,
          ]),
        PatchOperationError,
        '"add" operation requires "value" field',
      )
    })

    it('should validate replace operation requires value', () => {
      assertThrows(
        () =>
          patch(mockConnectionProvider, testTable, 'user:123', [
            { op: 'replace', path: '/test' } as unknown as PatchOperation,
          ]),
        PatchOperationError,
        '"replace" operation requires "value" field',
      )
    })

    it('should validate test operation requires value', () => {
      assertThrows(
        () =>
          patch(mockConnectionProvider, testTable, 'user:123', [
            { op: 'test', path: '/test' } as unknown as PatchOperation,
          ]),
        PatchOperationError,
        '"test" operation requires "value" field',
      )
    })

    it('should validate move operation requires from field', () => {
      assertThrows(
        () =>
          patch(mockConnectionProvider, testTable, 'user:123', [
            { op: 'move', path: '/test' } as unknown as PatchOperation,
          ]),
        PatchOperationError,
        '"move" operation requires "from" field',
      )
    })

    it('should validate copy operation requires from field', () => {
      assertThrows(
        () =>
          patch(mockConnectionProvider, testTable, 'user:123', [
            { op: 'copy', path: '/test' } as unknown as PatchOperation,
          ]),
        PatchOperationError,
        '"copy" operation requires "from" field',
      )
    })

    it('should validate path format starts with slash', () => {
      assertThrows(
        () =>
          patch(mockConnectionProvider, testTable, 'user:123', [
            { op: 'add', path: 'invalid', value: 'test' }, // Missing leading slash
          ]),
        PatchOperationError,
        'Path must start with "/"',
      )
    })

    it('should validate from path format starts with slash', () => {
      assertThrows(
        () =>
          patch(mockConnectionProvider, testTable, 'user:123', [
            { op: 'move', from: 'invalid', path: '/test' }, // Missing leading slash in from
          ]),
        PatchOperationError,
        'From path must start with "/"',
      )
    })

    it('should detect dangerous path patterns', () => {
      assertThrows(
        () =>
          patch(mockConnectionProvider, testTable, 'user:123', [
            { op: 'add', path: '/test/../dangerous', value: 'test' },
          ]),
        PatchOperationError,
        'Invalid path format',
      )
    })

    it('should detect dangerous path segments', () => {
      assertThrows(
        () =>
          patch(mockConnectionProvider, testTable, 'user:123', [
            { op: 'add', path: '/test/$injection', value: 'test' },
          ]),
        PatchOperationError,
        'Potentially dangerous path segment',
      )
    })
  })

  describe('withContext()', () => {
    it('should return this for method chaining', () => {
      const operations: PatchOperation[] = [
        { op: 'replace', path: '/email', value: 'test@example.com' },
      ]
      const patchQL = patch(mockConnectionProvider, testTable, 'user:123', operations)
      const result = patchQL.withContext('test-context')

      assertEquals(result, patchQL)
    })
  })
})

describe('UpsertQL', () => {
  describe('constructor', () => {
    it('should create a new UpsertQL instance', () => {
      const upsertQL = new UpsertQL(mockConnectionProvider, testTable, { username: 'test', email: 'test@example.com' })
      assert(upsertQL instanceof UpsertQL)
    })
  })

  describe('withId()', () => {
    it('should set record ID for upsert operation', () => {
      const upsertQL = upsert(mockConnectionProvider, testTable, { username: 'test' })
      const result = upsertQL.withId('user:123')

      assertEquals(result, upsertQL) // Should return this for chaining
    })

    it('should accept RecordId as ID', () => {
      const recordId = new RecordId('users', '123')
      const upsertQL = upsert(mockConnectionProvider, testTable, { username: 'test' })
      const result = upsertQL.withId(recordId)

      assertEquals(result, upsertQL)
    })
  })

  describe('onConflict()', () => {
    it('should set conflict fields for upsert operation', () => {
      const upsertQL = upsert(mockConnectionProvider, testTable, { username: 'test', email: 'test@example.com' })
      const result = upsertQL.onConflict('username', 'email')

      assertEquals(result, upsertQL) // Should return this for chaining
    })

    it('should validate field names', () => {
      const upsertQL = upsert(mockConnectionProvider, testTable, { username: 'test' })

      assertThrows(
        () => upsertQL.onConflict(''),
        Error,
        'Field name must be a non-empty string',
      )
    })

    it('should reject dangerous field names', () => {
      const upsertQL = upsert(mockConnectionProvider, testTable, { username: 'test' })

      assertThrows(
        () => upsertQL.onConflict('field; DROP TABLE users'),
        Error,
        'Potentially dangerous field name detected',
      )
    })

    it('should reject SQL injection patterns', () => {
      const upsertQL = upsert(mockConnectionProvider, testTable, { username: 'test' })

      assertThrows(
        () => upsertQL.onConflict('field UNION SELECT'),
        Error,
        'Potentially dangerous field name detected',
      )
    })
  })

  describe('execute()', () => {
    it('should execute upsert with specific ID', async () => {
      const mockData = [createTestUserRaw({
        id: new RecordId('users', '123'),
        username: 'admin',
        email: 'admin@example.com',
      })]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const upsertQL = upsert<TestUserRaw, TestUser>(mockConnectionProvider, testTable, {
          username: 'admin',
          email: 'admin@example.com',
        })
          .withId('user:123')
          .map(mapTestUser)

        const result = await upsertQL.execute()

        assertEquals(result.id, 'users:123')
        assertEquals(result.username, 'admin')
        assertEquals(result.email, 'admin@example.com')
      } finally {
        connectionStub.restore()
      }
    })

    it('should execute upsert with conflict detection', async () => {
      const mockData = [createTestUserRaw({
        username: 'unique_user',
        email: 'user@example.com',
      })]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const upsertQL = upsert<TestUserRaw, TestUser>(mockConnectionProvider, testTable, {
          username: 'unique_user',
          email: 'user@example.com',
          active: true,
        })
          .onConflict('username')
          .map(mapTestUser)

        const result = await upsertQL.execute()

        assertEquals(result.username, 'unique_user')
        assertEquals(result.email, 'user@example.com')
      } finally {
        connectionStub.restore()
      }
    })

    it('should execute simple upsert without ID or conflict fields', async () => {
      const mockData = [createTestUserRaw({
        username: 'new_user',
        email: 'new@example.com',
      })]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const upsertQL = upsert<TestUserRaw, TestUser>(mockConnectionProvider, testTable, {
          username: 'new_user',
          email: 'new@example.com',
        })
          .map(mapTestUser)

        const result = await upsertQL.execute()

        assertEquals(result.username, 'new_user')
        assertEquals(result.email, 'new@example.com')
      } finally {
        connectionStub.restore()
      }
    })

    it('should throw error when no records returned', async () => {
      const connectionStub = stub(mockConnectionProvider, 'getConnection', createEmptyMockConnectionStub())

      try {
        const upsertQL = upsert<TestUserRaw, TestUser>(mockConnectionProvider, testTable, {
          username: 'test',
        })
          .map(mapTestUser)

        await assertRejects(
          () => upsertQL.execute(),
          Error,
          'Upsert operation returned no records',
        )
      } finally {
        connectionStub.restore()
      }
    })

    it('should work without explicit T type parameter and return raw types', async () => {
      const mockRecordId = new RecordId('users', '123')
      const mockData = [createTestUserRaw({
        id: mockRecordId,
        username: 'test_user',
        email: 'test@example.com',
      })]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const upsertQL = upsert<TestUserRaw>(mockConnectionProvider, testTable, {
          username: 'test_user',
          email: 'test@example.com',
        })
          .withId('user:123')

        const result = await upsertQL.execute()

        assertEquals(typeof (result as unknown as { id: string }).id, 'string') // RecordId normalized to string
        assertEquals((result as unknown as { id: string }).id, 'users:123')
        assertEquals(result.username, 'test_user')
      } finally {
        connectionStub.restore()
      }
    })

    it('should show console warning when no mapper provided', async () => {
      const mockData = [createTestUserRaw({ username: 'test' })]
      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const { warning } = await captureConsoleWarnings(async () => {
          const upsertQL = upsert<TestUserRaw>(mockConnectionProvider, testTable, {
            username: 'test',
            email: 'test@example.com',
          })
          return await upsertQL.execute()
        })

        assert(warning.includes('RecordId fields will be normalized to strings automatically'))
      } finally {
        connectionStub.restore()
      }
    })

    it('should handle multiple conflict fields', async () => {
      const mockData = [createTestUserRaw({
        username: 'multi_user',
        email: 'multi@example.com',
      })]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const upsertQL = upsert<TestUserRaw, TestUser>(mockConnectionProvider, testTable, {
          username: 'multi_user',
          email: 'multi@example.com',
          active: true,
        })
          .onConflict('username', 'email')
          .map(mapTestUser)

        const result = await upsertQL.execute()

        assertEquals(result.username, 'multi_user')
        assertEquals(result.email, 'multi@example.com')
      } finally {
        connectionStub.restore()
      }
    })
  })

  describe('withContext()', () => {
    it('should return this for method chaining', () => {
      const upsertQL = upsert(mockConnectionProvider, testTable, { username: 'test' })
      const result = upsertQL.withContext('test-context')

      assertEquals(result, upsertQL)
    })
  })
})

describe('SurQLClient Advanced CRUD Integration', () => {
  describe('merge() integration', () => {
    it('should expose merge method', async () => {
      const client = new SurQLClient({
        host: 'localhost',
        port: '8000',
        namespace: 'test',
        database: 'test',
        username: 'root',
        password: 'root',
      })

      const mockData = [createTestUserRaw({
        email: 'merged@example.com',
      })]

      const connectionStub = stub(client, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([mockData]),
          close: () => Promise.resolve(),
          // deno-lint-ignore no-explicit-any
        } as any))

      try {
        const result = await client.merge<TestUserRaw, TestUser>('users', 'user:123', {
          email: 'merged@example.com',
        })
          .map(mapTestUser)
          .execute()

        assertEquals(result.email, 'merged@example.com')
      } finally {
        connectionStub.restore()
        await client.close()
      }
    })
  })

  describe('patch() integration', () => {
    it('should expose patch method', async () => {
      const client = new SurQLClient({
        host: 'localhost',
        port: '8000',
        namespace: 'test',
        database: 'test',
        username: 'root',
        password: 'root',
      })

      const mockData = [createTestUserRaw({
        email: 'patched@example.com',
      })]

      const connectionStub = stub(client, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([mockData]),
          close: () => Promise.resolve(),
          // deno-lint-ignore no-explicit-any
        } as any))

      try {
        const operations: PatchOperation[] = [
          { op: 'replace', path: '/email', value: 'patched@example.com' },
        ]

        const result = await client.patch<TestUserRaw, TestUser>('users', 'user:123', operations)
          .map(mapTestUser)
          .execute()

        assertEquals(result.email, 'patched@example.com')
      } finally {
        connectionStub.restore()
        await client.close()
      }
    })

    it('should support fluent patch operation building', async () => {
      const client = new SurQLClient({
        host: 'localhost',
        port: '8000',
        namespace: 'test',
        database: 'test',
        username: 'root',
        password: 'root',
      })

      const mockData = [createTestUserRaw({
        email: 'fluent@example.com',
      })]

      const connectionStub = stub(client, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([mockData]),
          close: () => Promise.resolve(),
          // deno-lint-ignore no-explicit-any
        } as any))

      try {
        const result = await client.patch<TestUserRaw, TestUser>('users', 'user:123', [])
          .addOperation({ op: 'replace', path: '/email', value: 'fluent@example.com' })
          .addOperation({ op: 'add', path: '/lastUpdated', value: new Date().toISOString() })
          .map(mapTestUser)
          .execute()

        assertEquals(result.email, 'fluent@example.com')
      } finally {
        connectionStub.restore()
        await client.close()
      }
    })
  })

  describe('upsert() integration', () => {
    it('should expose upsert method', async () => {
      const client = new SurQLClient({
        host: 'localhost',
        port: '8000',
        namespace: 'test',
        database: 'test',
        username: 'root',
        password: 'root',
      })

      const mockData = [createTestUserRaw({
        username: 'upserted_user',
        email: 'upserted@example.com',
      })]

      const connectionStub = stub(client, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([mockData]),
          close: () => Promise.resolve(),
          // deno-lint-ignore no-explicit-any
        } as any))

      try {
        const result = await client.upsert<TestUserRaw, TestUser>('users', {
          username: 'upserted_user',
          email: 'upserted@example.com',
        })
          .withId('user:123')
          .map(mapTestUser)
          .execute()

        assertEquals(result.username, 'upserted_user')
        assertEquals(result.email, 'upserted@example.com')
      } finally {
        connectionStub.restore()
        await client.close()
      }
    })

    it('should support conflict-based upsert', async () => {
      const client = new SurQLClient({
        host: 'localhost',
        port: '8000',
        namespace: 'test',
        database: 'test',
        username: 'root',
        password: 'root',
      })

      const mockData = [createTestUserRaw({
        username: 'conflict_user',
        email: 'conflict@example.com',
      })]

      const connectionStub = stub(client, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([mockData]),
          close: () => Promise.resolve(),
          // deno-lint-ignore no-explicit-any
        } as any))

      try {
        const result = await client.upsert<TestUserRaw, TestUser>('users', {
          username: 'conflict_user',
          email: 'conflict@example.com',
        })
          .onConflict('username')
          .map(mapTestUser)
          .execute()

        assertEquals(result.username, 'conflict_user')
        assertEquals(result.email, 'conflict@example.com')
      } finally {
        connectionStub.restore()
        await client.close()
      }
    })
  })

  describe('method chaining and fluent interface', () => {
    it('should support complex fluent chains with all advanced CRUD operations', async () => {
      const client = new SurQLClient({
        host: 'localhost',
        port: '8000',
        namespace: 'test',
        database: 'test',
        username: 'root',
        password: 'root',
      })

      try {
        // Test that all methods return proper chainable instances
        const mergeQL = client.merge('users', 'user:123', { email: 'test' })
          .withContext('merge-context')

        const patchQL = client.patch('users', 'user:123', [])
          .addOperation({ op: 'replace', path: '/email', value: 'test' })
          .withContext('patch-context')

        const upsertQL = client.upsert('users', { username: 'test' })
          .withId('user:123')
          .onConflict('username')
          .withContext('upsert-context')

        // All should be proper instances
        assert(mergeQL instanceof MergeQL)
        assert(patchQL instanceof PatchQL)
        assert(upsertQL instanceof UpsertQL)
      } finally {
        await client.close()
      }
    })
  })
})
