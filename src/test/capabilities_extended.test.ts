import { assertEquals, assertThrows } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { AggregationQueryBuilder } from '../capabilities/aggregation.ts'
import { PaginationQueryBuilder } from '../capabilities/pagination.ts'
import { RecordId } from 'surrealdb'
import { mockConnectionProvider } from './helpers.ts'

// ---------------------------------------------------------------------------
// Concrete test subclass for AggregationQueryBuilder
// ---------------------------------------------------------------------------

class TestAggregationBuilder<R extends { id: RecordId }, T> extends AggregationQueryBuilder<R, T> {
  // deno-lint-ignore no-explicit-any
  constructor(connectionProvider: any, table: string) {
    super(connectionProvider, table, {})
  }

  async execute(): Promise<T[]> {
    const fields = this.buildAggregationFields()
    const selectClause = fields.length > 0 ? fields.join(', ') : '*'
    const records = await this.executeQuery<R[]>(`SELECT ${selectClause} FROM ${this.table}`, this.params)
    const result = this.mapResults(records || [], true)
    return Array.isArray(result) ? result : [result] as T[]
  }

  async first(): Promise<T | undefined> {
    const results = await this.execute()
    return results[0]
  }

  public testBuildAggregationFields(): string[] {
    return this.buildAggregationFields()
  }
}

// ---------------------------------------------------------------------------
// Concrete test subclass for PaginationQueryBuilder
// ---------------------------------------------------------------------------

class TestPaginationBuilder<R extends { id: RecordId }, T> extends PaginationQueryBuilder<R, T> {
  // deno-lint-ignore no-explicit-any
  constructor(connectionProvider: any, table: string) {
    super(connectionProvider, table, {})
  }

  async execute(): Promise<T[]> {
    const query = `SELECT * FROM ${this.table}${this.buildLimitClause()}${this.buildStartClause()}`
    const records = await this.executeQuery<R[]>(query, this.params)
    const result = this.mapResults(records || [], true)
    return Array.isArray(result) ? result : [result] as T[]
  }

  async first(): Promise<T | undefined> {
    const results = await this.execute()
    return results[0]
  }

  public testBuildLimitClause(): string {
    return this.buildLimitClause()
  }

  public testBuildStartClause(): string {
    return this.buildStartClause()
  }

  public testBuildPaginationClauses(): string {
    return this.buildPaginationClauses()
  }
}

// ---------------------------------------------------------------------------
// AggregationQueryBuilder tests
// ---------------------------------------------------------------------------

describe('AggregationQueryBuilder', () => {
  describe('count()', () => {
    it('should add COUNT(*) aggregation by default', () => {
      const builder = new TestAggregationBuilder(mockConnectionProvider, 'orders')
      builder.count()
      const fields = builder.testBuildAggregationFields()
      assertEquals(fields, ['COUNT(*) as count'])
    })

    it('should add COUNT(field) aggregation when field is given', () => {
      const builder = new TestAggregationBuilder(mockConnectionProvider, 'orders')
      builder.count('customer_id')
      const fields = builder.testBuildAggregationFields()
      assertEquals(fields, ['COUNT(customer_id) as count'])
    })

    it('should return this for chaining', () => {
      const builder = new TestAggregationBuilder(mockConnectionProvider, 'orders')
      const result = builder.count()
      assertEquals(result, builder)
    })

    it('should reject invalid field names', () => {
      const builder = new TestAggregationBuilder(mockConnectionProvider, 'orders')
      assertThrows(() => builder.count(''), Error)
    })
  })

  describe('sum()', () => {
    it('should add SUM aggregation with alias', () => {
      const builder = new TestAggregationBuilder(mockConnectionProvider, 'orders')
      builder.sum('total_amount')
      const fields = builder.testBuildAggregationFields()
      assertEquals(fields, ['SUM(total_amount) as sum_total_amount'])
    })

    it('should return this for chaining', () => {
      const builder = new TestAggregationBuilder(mockConnectionProvider, 'orders')
      assertEquals(builder.sum('price'), builder)
    })

    it('should reject invalid field names', () => {
      const builder = new TestAggregationBuilder(mockConnectionProvider, 'orders')
      assertThrows(() => builder.sum(''), Error)
    })
  })

  describe('avg()', () => {
    it('should add AVG aggregation with alias', () => {
      const builder = new TestAggregationBuilder(mockConnectionProvider, 'orders')
      builder.avg('price')
      const fields = builder.testBuildAggregationFields()
      assertEquals(fields, ['AVG(price) as avg_price'])
    })

    it('should return this for chaining', () => {
      const builder = new TestAggregationBuilder(mockConnectionProvider, 'orders')
      assertEquals(builder.avg('score'), builder)
    })
  })

  describe('min()', () => {
    it('should add MIN aggregation with alias', () => {
      const builder = new TestAggregationBuilder(mockConnectionProvider, 'products')
      builder.min('price')
      const fields = builder.testBuildAggregationFields()
      assertEquals(fields, ['MIN(price) as min_price'])
    })

    it('should return this for chaining', () => {
      const builder = new TestAggregationBuilder(mockConnectionProvider, 'products')
      assertEquals(builder.min('qty'), builder)
    })
  })

  describe('max()', () => {
    it('should add MAX aggregation with alias', () => {
      const builder = new TestAggregationBuilder(mockConnectionProvider, 'products')
      builder.max('order_date')
      const fields = builder.testBuildAggregationFields()
      assertEquals(fields, ['MAX(order_date) as max_order_date'])
    })

    it('should return this for chaining', () => {
      const builder = new TestAggregationBuilder(mockConnectionProvider, 'products')
      assertEquals(builder.max('amount'), builder)
    })
  })

  describe('multiple aggregations', () => {
    it('should accumulate multiple aggregations', () => {
      const builder = new TestAggregationBuilder(mockConnectionProvider, 'orders')
      builder.count().sum('revenue').avg('discount').min('price').max('price')
      const fields = builder.testBuildAggregationFields()
      assertEquals(fields.length, 5)
      assertEquals(fields[0], 'COUNT(*) as count')
      assertEquals(fields[1], 'SUM(revenue) as sum_revenue')
      assertEquals(fields[2], 'AVG(discount) as avg_discount')
      assertEquals(fields[3], 'MIN(price) as min_price')
      assertEquals(fields[4], 'MAX(price) as max_price')
    })
  })

  describe('hasAggregations()', () => {
    it('should return false when no aggregations', () => {
      const builder = new TestAggregationBuilder(mockConnectionProvider, 'orders')
      assertEquals(builder.hasAggregations(), false)
    })

    it('should return true after adding an aggregation', () => {
      const builder = new TestAggregationBuilder(mockConnectionProvider, 'orders')
      builder.count()
      assertEquals(builder.hasAggregations(), true)
    })
  })

  describe('getAggregationCount()', () => {
    it('should return 0 initially', () => {
      const builder = new TestAggregationBuilder(mockConnectionProvider, 'orders')
      assertEquals(builder.getAggregationCount(), 0)
    })

    it('should count aggregations correctly', () => {
      const builder = new TestAggregationBuilder(mockConnectionProvider, 'orders')
      builder.count().sum('total').avg('score')
      assertEquals(builder.getAggregationCount(), 3)
    })
  })

  describe('clearAggregations()', () => {
    it('should remove all aggregations', () => {
      const builder = new TestAggregationBuilder(mockConnectionProvider, 'orders')
      builder.count().sum('total')
      assertEquals(builder.hasAggregations(), true)
      const result = builder.clearAggregations()
      assertEquals(result, builder)
      assertEquals(builder.hasAggregations(), false)
      assertEquals(builder.getAggregationCount(), 0)
      assertEquals(builder.testBuildAggregationFields(), [])
    })
  })
})

// ---------------------------------------------------------------------------
// PaginationQueryBuilder tests
// ---------------------------------------------------------------------------

describe('PaginationQueryBuilder', () => {
  describe('limit()', () => {
    it('should set limit and return this', () => {
      const builder = new TestPaginationBuilder(mockConnectionProvider, 'users')
      const result = builder.limit(10)
      assertEquals(result, builder)
      assertEquals(builder.getCurrentLimit(), 10)
    })

    it('should build LIMIT clause', () => {
      const builder = new TestPaginationBuilder(mockConnectionProvider, 'users')
      builder.limit(25)
      assertEquals(builder.testBuildLimitClause(), ' LIMIT 25')
    })

    it('should return empty string when no limit', () => {
      const builder = new TestPaginationBuilder(mockConnectionProvider, 'users')
      assertEquals(builder.testBuildLimitClause(), '')
    })

    it('should reject non-positive limit', () => {
      const builder = new TestPaginationBuilder(mockConnectionProvider, 'users')
      assertThrows(() => builder.limit(0), Error)
      assertThrows(() => builder.limit(-1), Error)
    })

    it('should reject limit exceeding 1000000', () => {
      const builder = new TestPaginationBuilder(mockConnectionProvider, 'users')
      assertThrows(() => builder.limit(1000001), Error)
    })
  })

  describe('offset()', () => {
    it('should set offset and return this', () => {
      const builder = new TestPaginationBuilder(mockConnectionProvider, 'users')
      const result = builder.offset(20)
      assertEquals(result, builder)
      assertEquals(builder.getCurrentOffset(), 20)
    })

    it('should build START clause', () => {
      const builder = new TestPaginationBuilder(mockConnectionProvider, 'users')
      builder.offset(40)
      assertEquals(builder.testBuildStartClause(), ' START 40')
    })

    it('should return empty string when no offset', () => {
      const builder = new TestPaginationBuilder(mockConnectionProvider, 'users')
      assertEquals(builder.testBuildStartClause(), '')
    })

    it('should reject non-positive offset', () => {
      const builder = new TestPaginationBuilder(mockConnectionProvider, 'users')
      assertThrows(() => builder.offset(0), Error)
      assertThrows(() => builder.offset(-5), Error)
    })
  })

  describe('page()', () => {
    it('should compute offset and limit from page number and size', () => {
      const builder = new TestPaginationBuilder(mockConnectionProvider, 'users')
      builder.page(2, 10)
      assertEquals(builder.getCurrentLimit(), 10)
      assertEquals(builder.getCurrentOffset(), 10) // (2-1) * 10
    })

    it('should compute correct offset for page 1', () => {
      const builder = new TestPaginationBuilder(mockConnectionProvider, 'users')
      builder.page(1, 20)
      assertEquals(builder.getCurrentOffset(), 0)
      assertEquals(builder.getCurrentLimit(), 20)
    })

    it('should compute correct offset for page 3', () => {
      const builder = new TestPaginationBuilder(mockConnectionProvider, 'users')
      builder.page(3, 15)
      assertEquals(builder.getCurrentOffset(), 30) // (3-1) * 15
      assertEquals(builder.getCurrentLimit(), 15)
    })

    it('should return this for chaining', () => {
      const builder = new TestPaginationBuilder(mockConnectionProvider, 'users')
      assertEquals(builder.page(1, 10), builder)
    })

    it('should reject page number 0', () => {
      const builder = new TestPaginationBuilder(mockConnectionProvider, 'users')
      assertThrows(() => builder.page(0, 10), Error)
    })

    it('should reject page size 0', () => {
      const builder = new TestPaginationBuilder(mockConnectionProvider, 'users')
      assertThrows(() => builder.page(1, 0), Error)
    })
  })

  describe('getCurrentPageInfo()', () => {
    it('should return null when no pagination is set', () => {
      const builder = new TestPaginationBuilder(mockConnectionProvider, 'users')
      assertEquals(builder.getCurrentPageInfo(), null)
    })

    it('should return null when only limit is set', () => {
      const builder = new TestPaginationBuilder(mockConnectionProvider, 'users')
      builder.limit(10)
      assertEquals(builder.getCurrentPageInfo(), null)
    })

    it('should return page info when both limit and offset are set', () => {
      const builder = new TestPaginationBuilder(mockConnectionProvider, 'users')
      builder.page(3, 10)
      const info = builder.getCurrentPageInfo()
      assertEquals(info?.pageNumber, 3)
      assertEquals(info?.pageSize, 10)
      assertEquals(info?.offset, 20)
    })
  })

  describe('hasPagination()', () => {
    it('should return false initially', () => {
      const builder = new TestPaginationBuilder(mockConnectionProvider, 'users')
      assertEquals(builder.hasPagination(), false)
    })

    it('should return true after setting limit', () => {
      const builder = new TestPaginationBuilder(mockConnectionProvider, 'users')
      builder.limit(10)
      assertEquals(builder.hasPagination(), true)
    })

    it('should return true after setting offset', () => {
      const builder = new TestPaginationBuilder(mockConnectionProvider, 'users')
      builder.offset(5)
      assertEquals(builder.hasPagination(), true)
    })
  })

  describe('clearPagination()', () => {
    it('should clear limit and offset', () => {
      const builder = new TestPaginationBuilder(mockConnectionProvider, 'users')
      builder.limit(10).offset(20)
      assertEquals(builder.hasPagination(), true)
      const result = builder.clearPagination()
      assertEquals(result, builder)
      assertEquals(builder.hasPagination(), false)
      assertEquals(builder.getCurrentLimit(), undefined)
      assertEquals(builder.getCurrentOffset(), undefined)
    })
  })

  describe('buildPaginationClauses()', () => {
    it('should combine START and LIMIT clauses', () => {
      const builder = new TestPaginationBuilder(mockConnectionProvider, 'users')
      builder.offset(20).limit(10)
      assertEquals(builder.testBuildPaginationClauses(), ' START 20 LIMIT 10')
    })

    it('should return empty string when no pagination', () => {
      const builder = new TestPaginationBuilder(mockConnectionProvider, 'users')
      assertEquals(builder.testBuildPaginationClauses(), '')
    })
  })
})
