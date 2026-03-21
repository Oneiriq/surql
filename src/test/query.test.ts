import { assert, assertEquals, assertThrows } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { GroupByQueryBuilder } from '../capabilities/groupBy.ts'
import { HavingQueryBuilder } from '../capabilities/having.ts'
import { Op } from '../crud/base.ts'
import { ReadQL } from '../crud/read.ts'
import { RecordId } from 'surrealdb'
import { stub } from '@std/testing/mock'
import { SurQLClient } from '../client.ts'
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

interface AggregatedResult {
  group_field: string
  count: number
  total_amount: number
  avg_amount: number
  min_amount: number
  max_amount: number
}

interface AggregatedResultRaw {
  id: RecordId
  group_field: string
  count: number
  total_amount: number
  avg_amount: number
  min_amount: number
  max_amount: number
}

class TestGroupByQueryBuilder<R extends { id: RecordId }, T> extends GroupByQueryBuilder<R, T> {
  // deno-lint-ignore no-explicit-any
  constructor(connectionProvider: any, table: string) {
    super(connectionProvider, table, {})
  }

  async execute(): Promise<T[]> {
    const query = `SELECT * FROM ${this.table}${this.buildGroupByClause()}`
    const records = await this.executeQuery<R[]>(query, this.params)
    const result = this.mapResults(records || [], true)
    return Array.isArray(result) ? result : [result] as T[]
  }

  async first(): Promise<T | undefined> {
    const results = await this.execute()
    return results[0]
  }

  // Expose protected methods for testing
  public testBuildGroupByClause(): string {
    return this.buildGroupByClause()
  }

  public testGetGroupByFields(): string[] {
    return this.getGroupByFields()
  }
}

class TestHavingQueryBuilder<R extends { id: RecordId }, T> extends HavingQueryBuilder<R, T> {
  // deno-lint-ignore no-explicit-any
  constructor(connectionProvider: any, table: string) {
    super(connectionProvider, table, {})
  }

  async execute(): Promise<T[]> {
    const query = `SELECT * FROM ${this.table}${this.buildHavingClause()}`
    const records = await this.executeQuery<R[]>(query, this.params)
    const result = this.mapResults(records || [], true)
    return Array.isArray(result) ? result : [result] as T[]
  }

  async first(): Promise<T | undefined> {
    const results = await this.execute()
    return results[0]
  }

  public testBuildHavingClause(): string {
    return this.buildHavingClause()
  }

  public testGetHavingConditions(): string[] {
    return this.getHavingConditions()
  }
}

describe('GroupByQueryBuilder', () => {
  describe('groupBy()', () => {
    it('should add single GROUP BY field', () => {
      const builder = new TestGroupByQueryBuilder(mockConnectionProvider, testTable)
      const result = builder.groupBy('category')

      assertEquals(result, builder) // Should return this for chaining
      assert(builder.hasGroupBy())
      assertEquals(builder.testGetGroupByFields(), ['category'])
    })

    it('should add multiple GROUP BY fields', () => {
      const builder = new TestGroupByQueryBuilder(mockConnectionProvider, testTable)
      const result = builder.groupBy('category', 'status', 'region')

      assertEquals(result, builder)
      assert(builder.hasGroupBy())
      assertEquals(builder.testGetGroupByFields(), ['category', 'status', 'region'])
    })

    it('should accumulate GROUP BY fields across multiple calls', () => {
      const builder = new TestGroupByQueryBuilder(mockConnectionProvider, testTable)
      builder.groupBy('category')
      builder.groupBy('status')

      assertEquals(builder.testGetGroupByFields(), ['category', 'status'])
    })

    it('should validate field names', () => {
      const builder = new TestGroupByQueryBuilder(mockConnectionProvider, testTable)

      assertThrows(
        () => builder.groupBy(''),
        Error,
        'Invalid field name: Non-empty string in field name but received: ""',
      )
    })

    it('should reject dangerous field names', () => {
      const builder = new TestGroupByQueryBuilder(mockConnectionProvider, testTable)

      assertThrows(
        () => builder.groupBy('field; DROP TABLE users'),
        Error,
        'Invalid field name: Dangerous SQL pattern in field name matched: /;/ in input: "field; DROP TABLE users"',
      )
    })

    it('should reject SQL injection patterns', () => {
      const builder = new TestGroupByQueryBuilder(mockConnectionProvider, testTable)

      assertThrows(
        () => builder.groupBy('field UNION SELECT'),
        Error,
        'Invalid field name: Dangerous SQL pattern in field name matched: /\\bunion\\b/i in input: "field UNION SELECT"',
      )
    })

    it('should build correct GROUP BY clause', () => {
      const builder = new TestGroupByQueryBuilder(mockConnectionProvider, testTable)
      builder.groupBy('category', 'status')

      const clause = builder.testBuildGroupByClause()
      assertEquals(clause, ' GROUP BY category, status')
    })

    it('should return empty clause when no GROUP BY fields', () => {
      const builder = new TestGroupByQueryBuilder(mockConnectionProvider, testTable)

      const clause = builder.testBuildGroupByClause()
      assertEquals(clause, '')
    })
  })

  describe('clearGroupBy()', () => {
    it('should clear all GROUP BY fields', () => {
      const builder = new TestGroupByQueryBuilder(mockConnectionProvider, testTable)
      builder.groupBy('category', 'status')

      assert(builder.hasGroupBy())
      const result = builder.clearGroupBy()

      assertEquals(result, builder) // Should return this for chaining
      assert(!builder.hasGroupBy())
      assertEquals(builder.testGetGroupByFields(), [])
    })
  })

  describe('hasGroupBy()', () => {
    it('should return false when no GROUP BY fields', () => {
      const builder = new TestGroupByQueryBuilder(mockConnectionProvider, testTable)
      assert(!builder.hasGroupBy())
    })

    it('should return true when GROUP BY fields exist', () => {
      const builder = new TestGroupByQueryBuilder(mockConnectionProvider, testTable)
      builder.groupBy('category')
      assert(builder.hasGroupBy())
    })
  })
})

describe('HavingQueryBuilder', () => {
  describe('having()', () => {
    it('should add HAVING condition with direct string', () => {
      const builder = new TestHavingQueryBuilder(mockConnectionProvider, testTable)
      const result = builder.having('COUNT(*) > 5')

      assertEquals(result, builder) // Should return this for chaining
      assert(builder.hasHaving())
      assertEquals(builder.testGetHavingConditions(), ['COUNT(*) > 5'])
    })

    it('should add HAVING condition with fluent style', () => {
      const builder = new TestHavingQueryBuilder(mockConnectionProvider, testTable)
      const result = builder.having('SUM(amount)', Op.GREATER_THAN, 1000)

      assertEquals(result, builder)
      assert(builder.hasHaving())
      // Should include parameter binding
      assert(builder.testGetHavingConditions()[0].includes('SUM(amount) > $h0'))
    })

    it('should support multiple HAVING conditions', () => {
      const builder = new TestHavingQueryBuilder(mockConnectionProvider, testTable)
      builder.having('COUNT(*) > 5')
      builder.having('AVG(score)', Op.GREATER_THAN_OR_EQUAL, 75)

      assertEquals(builder.testGetHavingConditions().length, 2)
    })

    it('should validate field names in fluent style', () => {
      const builder = new TestHavingQueryBuilder(mockConnectionProvider, testTable)

      assertThrows(
        () => builder.having('', Op.EQUALS, 5),
        Error,
        'Invalid field name: Non-empty string in field name but received: ""',
      )
    })

    it('should reject dangerous HAVING conditions', () => {
      const builder = new TestHavingQueryBuilder(mockConnectionProvider, testTable)

      assertThrows(
        () => builder.having('COUNT(*) > 5; DROP TABLE users'),
        Error,
        'Dangerous SQL pattern in HAVING condition matched: /;.*(?:union|select|insert|update|delete|drop)/i in input: "COUNT(*) > 5; DROP TABLE users"',
      )
    })

    it('should reject overly long HAVING conditions', () => {
      const builder = new TestHavingQueryBuilder(mockConnectionProvider, testTable)
      const longCondition = 'A'.repeat(1001) // Exceeds 1000 character limit

      assertThrows(
        () => builder.having(longCondition),
        Error,
        'String in HAVING condition exceeds maximum length of 1000 characters',
      )
    })

    it('should build correct HAVING clause', () => {
      const builder = new TestHavingQueryBuilder(mockConnectionProvider, testTable)
      builder.having('COUNT(*) > 5')
      builder.having('AVG(score) >= 75')

      const clause = builder.testBuildHavingClause()
      assertEquals(clause, ' HAVING COUNT(*) > 5 AND AVG(score) >= 75')
    })

    it('should return empty clause when no HAVING conditions', () => {
      const builder = new TestHavingQueryBuilder(mockConnectionProvider, testTable)

      const clause = builder.testBuildHavingClause()
      assertEquals(clause, '')
    })
  })

  describe('clearHaving()', () => {
    it('should clear all HAVING conditions', () => {
      const builder = new TestHavingQueryBuilder(mockConnectionProvider, testTable)
      builder.having('COUNT(*) > 5')

      assert(builder.hasHaving())
      const result = builder.clearHaving()

      assertEquals(result, builder) // Should return this for chaining
      assert(!builder.hasHaving())
      assertEquals(builder.testGetHavingConditions(), [])
    })
  })

  describe('hasHaving()', () => {
    it('should return false when no HAVING conditions', () => {
      const builder = new TestHavingQueryBuilder(mockConnectionProvider, testTable)
      assert(!builder.hasHaving())
    })

    it('should return true when HAVING conditions exist', () => {
      const builder = new TestHavingQueryBuilder(mockConnectionProvider, testTable)
      builder.having('COUNT(*) > 5')
      assert(builder.hasHaving())
    })
  })
})

describe('Query Builder Integration Tests', () => {
  describe('GROUP BY functionality execution', () => {
    it('should execute queries with GROUP BY clause', async () => {
      const mockData = [
        {
          id: new RecordId('aggregated', '1'),
          category: 'electronics',
          count: 25,
        },
        {
          id: new RecordId('aggregated', '2'),
          category: 'clothing',
          count: 40,
        },
      ]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const builder = new TestGroupByQueryBuilder<AggregatedResultRaw, AggregatedResult>(
          mockConnectionProvider,
          'orders',
        )
        builder.groupBy('category')

        const results = await builder.execute()

        assertEquals(results.length, 2)
        // Results should be mapped properly
        assert(Array.isArray(results))
      } finally {
        connectionStub.restore()
      }
    })

    it('should work with first() method', async () => {
      const mockData = [
        {
          id: new RecordId('aggregated', '1'),
          category: 'electronics',
          count: 25,
        },
      ]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const builder = new TestGroupByQueryBuilder<AggregatedResultRaw, AggregatedResult>(
          mockConnectionProvider,
          'orders',
        )
        builder.groupBy('category')

        const result = await builder.first()

        assert(result !== undefined)
      } finally {
        connectionStub.restore()
      }
    })

    it('should return undefined for first() when no results', async () => {
      const connectionStub = stub(mockConnectionProvider, 'getConnection', createEmptyMockConnectionStub())

      try {
        const builder = new TestGroupByQueryBuilder<AggregatedResultRaw, AggregatedResult>(
          mockConnectionProvider,
          'orders',
        )
        builder.groupBy('category')

        const result = await builder.first()

        assertEquals(result, undefined)
      } finally {
        connectionStub.restore()
      }
    })
  })

  describe('HAVING functionality execution', () => {
    it('should execute queries with HAVING clause', async () => {
      const mockData = [
        {
          id: new RecordId('aggregated', '1'),
          category: 'electronics',
          count: 25,
        },
      ]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const builder = new TestHavingQueryBuilder<AggregatedResultRaw, AggregatedResult>(
          mockConnectionProvider,
          'orders',
        )
        builder.having('COUNT(*) > 20')

        const results = await builder.execute()

        assertEquals(results.length, 1)
      } finally {
        connectionStub.restore()
      }
    })

    it('should work with fluent HAVING conditions', async () => {
      const mockData = [
        {
          id: new RecordId('aggregated', '1'),
          category: 'electronics',
          total_amount: 15000,
        },
      ]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const builder = new TestHavingQueryBuilder<AggregatedResultRaw, AggregatedResult>(
          mockConnectionProvider,
          'orders',
        )
        builder.having('SUM(amount)', Op.GREATER_THAN, 10000)

        const results = await builder.execute()

        assertEquals(results.length, 1)
      } finally {
        connectionStub.restore()
      }
    })
  })
})

describe('Enhanced pagination support', () => {
  describe('offset and limit combinations', () => {
    it('should support enhanced pagination with large datasets', async () => {
      // Create mock data representing a paginated result
      const mockData = Array.from({ length: 10 }, (_, i) =>
        createTestUserRaw({
          username: `user_${i + 21}`, // Page 3 (21-30)
          email: `user${i + 21}@example.com`,
        }))

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const readQL = new ReadQL<TestUserRaw, TestUser>(mockConnectionProvider, testTable)
          .where({ active: true })
          .orderBy('username')
          .limit(10)
          .offset(20) // Skip first 20 records
          .map(mapTestUser)

        const results = await readQL.execute()

        assertEquals(results.length, 10)
        assertEquals(results[0].username, 'user_21')
        assertEquals(results[9].username, 'user_30')
      } finally {
        connectionStub.restore()
      }
    })

    it('should handle cursor-based pagination patterns', async () => {
      const mockData = [createTestUserRaw({
        id: new RecordId('users', '456'),
        username: 'next_page_user',
        email: 'next@example.com',
      })]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        // Simulate cursor-based pagination where we get records after a certain ID
        const readQL = new ReadQL<TestUserRaw, TestUser>(mockConnectionProvider, testTable)
          .where('id', Op.GREATER_THAN, 'users:123') // After cursor
          .orderBy('id')
          .limit(20)
          .map(mapTestUser)

        const results = await readQL.execute()

        assertEquals(results.length, 1)
        assertEquals(results[0].id, 'users:456')
      } finally {
        connectionStub.restore()
      }
    })
  })
})

describe('Aggregation function support', () => {
  describe('common aggregation patterns', () => {
    it('should support COUNT aggregation patterns', async () => {
      const mockData = [
        {
          id: new RecordId('aggregated', '1'),
          category: 'electronics',
          total_count: 125,
        },
      ]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const builder = new TestGroupByQueryBuilder(mockConnectionProvider, 'orders')
        builder.groupBy('category')

        const results = await builder.execute()

        assertEquals(results.length, 1)
        // Verify aggregation structure exists
        assert(Array.isArray(results))
      } finally {
        connectionStub.restore()
      }
    })

    it('should support SUM aggregation patterns', async () => {
      const mockData = [
        {
          id: new RecordId('aggregated', '1'),
          category: 'electronics',
          total_revenue: 45000.50,
        },
      ]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const builder = new TestGroupByQueryBuilder(mockConnectionProvider, 'orders')
        builder.groupBy('category')

        const results = await builder.execute()

        assertEquals(results.length, 1)
        assert(Array.isArray(results))
      } finally {
        connectionStub.restore()
      }
    })

    it('should support AVG aggregation patterns', async () => {
      const mockData = [
        {
          id: new RecordId('aggregated', '1'),
          category: 'electronics',
          avg_order_value: 359.99,
        },
      ]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const builder = new TestGroupByQueryBuilder(mockConnectionProvider, 'orders')
        builder.groupBy('category')

        const results = await builder.execute()

        assertEquals(results.length, 1)
        assert(Array.isArray(results))
      } finally {
        connectionStub.restore()
      }
    })

    it('should support MIN and MAX aggregation patterns', async () => {
      const mockData = [
        {
          id: new RecordId('aggregated', '1'),
          category: 'electronics',
          min_price: 19.99,
          max_price: 1299.99,
        },
      ]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const builder = new TestGroupByQueryBuilder(mockConnectionProvider, 'products')
        builder.groupBy('category')

        const results = await builder.execute()

        assertEquals(results.length, 1)
        assert(Array.isArray(results))
      } finally {
        connectionStub.restore()
      }
    })

    it('should support complex multi-aggregation queries', async () => {
      const mockData = [
        {
          id: new RecordId('aggregated', '1'),
          region: 'north',
          total_orders: 150,
          total_revenue: 75000,
          avg_order_value: 500,
          min_order: 25,
          max_order: 2500,
        },
      ]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const groupBuilder = new TestGroupByQueryBuilder(mockConnectionProvider, 'sales')
        groupBuilder.groupBy('region')

        const havingBuilder = new TestHavingQueryBuilder(mockConnectionProvider, 'sales')
        havingBuilder.having('COUNT(*)', Op.GREATER_THAN, 100)

        // Test both builders work independently
        const groupResults = await groupBuilder.execute()
        const havingResults = await havingBuilder.execute()

        assertEquals(groupResults.length, 1)
        assertEquals(havingResults.length, 1)
      } finally {
        connectionStub.restore()
      }
    })
  })
})

describe('SurQLClient Enhanced Query Integration', () => {
  describe('query method enhancements', () => {
    it('should maintain compatibility with enhanced query builders', async () => {
      const client = new SurQLClient({
        host: 'localhost',
        port: '8000',
        namespace: 'test',
        database: 'test',
        username: 'root',
        password: 'root',
      })

      const mockData = [createTestUserRaw({
        username: 'integration_user',
        email: 'integration@example.com',
      })]

      const connectionStub = stub(client, 'getConnection', () =>
        Promise.resolve({
          query: () => Promise.resolve([mockData]),
          close: () => Promise.resolve(),
          // deno-lint-ignore no-explicit-any
        } as any))

      try {
        // Test that client.query() still works with all enhancements
        const result = await client.query<TestUserRaw, TestUser>('users')
          .where({ active: true })
          .orderBy('created_at')
          .limit(20)
          .map(mapTestUser)
          .execute()

        assertEquals(result.length, 1)
        assertEquals(result[0].username, 'integration_user')
      } finally {
        connectionStub.restore()
        await client.close()
      }
    })

    it('should support all existing query patterns with enhancements', async () => {
      const client = new SurQLClient({
        host: 'localhost',
        port: '8000',
        namespace: 'test',
        database: 'test',
        username: 'root',
        password: 'root',
      })

      try {
        // Test that all ReadQL methods are still available
        const queryBuilder = client.query<TestUserRaw, TestUser>('users')
          .where({ active: true })
          .whereEquals('status', 'verified')
          .whereLike('username', '%admin%')
          .orderBy('created_at')
          .limit(50)
          .offset(10)
          .select('username', 'email', 'active')
          .withContext('enhanced-integration-test')

        // Should be a proper ReadQL instance
        assert(queryBuilder instanceof ReadQL)
      } finally {
        await client.close()
      }
    })
  })
})

describe('Error handling and edge cases', () => {
  describe('validation and security', () => {
    it('should handle empty aggregation results gracefully', async () => {
      const connectionStub = stub(mockConnectionProvider, 'getConnection', createEmptyMockConnectionStub())

      try {
        const builder = new TestGroupByQueryBuilder(mockConnectionProvider, 'orders')
        builder.groupBy('category')

        const results = await builder.execute()

        assertEquals(results.length, 0)
      } finally {
        connectionStub.restore()
      }
    })

    it('should validate GROUP BY field combinations', () => {
      const builder = new TestGroupByQueryBuilder(mockConnectionProvider, testTable)

      assertThrows(
        () => builder.groupBy('valid_field', '', 'another_field'),
        Error,
        'Invalid field name: Non-empty string in field name but received: ""',
      )
    })

    it('should validate complex HAVING conditions', () => {
      const builder = new TestHavingQueryBuilder(mockConnectionProvider, testTable)

      assertThrows(
        () => builder.having('COUNT(*) > 5 AND 1=1; DROP TABLE users'),
        Error,
        'Dangerous SQL pattern in HAVING condition matched: /;.*(?:union|select|insert|update|delete|drop)/i in input: "COUNT(*) > 5 AND 1=1; DROP TABLE users"',
      )
    })

    it('should handle type mismatches gracefully', async () => {
      const mockData = [{
        id: new RecordId('test', '1'),
        invalid_data: 'not_a_number',
      }]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const builder = new TestGroupByQueryBuilder(mockConnectionProvider, 'test_table')
        builder.groupBy('category')

        // Should not throw, but return the data as-is
        const results = await builder.execute()
        assert(Array.isArray(results))
      } finally {
        connectionStub.restore()
      }
    })
  })

  describe('performance considerations', () => {
    it('should handle large result sets efficiently', async () => {
      // Create a large mock dataset
      const mockData = Array.from({ length: 100 }, (_, i) => ({
        id: new RecordId('large_test', i.toString()),
        category: `category_${i % 10}`,
        count: i + 1,
      }))

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const builder = new TestGroupByQueryBuilder(mockConnectionProvider, 'large_table')
        builder.groupBy('category')

        const results = await builder.execute()

        // Should handle large datasets without issues
        assertEquals(results.length, 100)
      } finally {
        connectionStub.restore()
      }
    })
  })
})

describe('Backward compatibility verification', () => {
  describe('existing ReadQL functionality', () => {
    it('should preserve all existing ReadQL methods and behavior', async () => {
      const mockData = [createTestUserRaw({
        username: 'compatibility_user',
        email: 'compat@example.com',
      })]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        // Test that original ReadQL functionality is unchanged
        const readQL = new ReadQL<TestUserRaw, TestUser>(mockConnectionProvider, testTable)
          .where({ active: true })
          .where('username', Op.CONTAINS, 'compat')
          .whereEquals('email', 'compat@example.com')
          .orderBy('created_at')
          .limit(10)
          .offset(0)
          .select('username', 'email')
          .withContext('compatibility-test')
          .map(mapTestUser)

        const results = await readQL.execute()

        assertEquals(results.length, 1)
        assertEquals(results[0].username, 'compatibility_user')
        assertEquals(results[0].email, 'compat@example.com')
      } finally {
        connectionStub.restore()
      }
    })

    it('should show console warning for unmapped queries (existing behavior)', async () => {
      const mockData = [createTestUserRaw({ username: 'warning_test' })]
      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const { warning } = await captureConsoleWarnings(async () => {
          const readQL = new ReadQL<TestUserRaw>(mockConnectionProvider, testTable)
          return await readQL.execute()
        })

        assert(warning.includes('RecordId fields will be normalized to strings automatically'))
      } finally {
        connectionStub.restore()
      }
    })

    it('should work with first() method (existing behavior)', async () => {
      const mockData = [createTestUserRaw({
        username: 'first_test',
        email: 'first@example.com',
      })]

      const connectionStub = stub(mockConnectionProvider, 'getConnection', createMockConnectionStub(mockData))

      try {
        const readQL = new ReadQL<TestUserRaw, TestUser>(mockConnectionProvider, testTable)
          .where({ active: true })
          .map(mapTestUser)

        const result = await readQL.first()

        assert(result !== undefined)
        assertEquals(result.username, 'first_test')
        assertEquals(result.email, 'first@example.com')
      } finally {
        connectionStub.restore()
      }
    })
  })
})
