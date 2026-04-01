import { assertEquals } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import {
  as_,
  count,
  field,
  func,
  isSurqlFn,
  mathMax,
  mathMean,
  mathMin,
  mathSum,
  recordRef,
  surqlFn,
} from '../query/expressions.ts'
import { deleteQuery, insert, select, updateQuery } from '../query/builder.ts'
import { quoteValue } from '../query/helpers.ts'
import { extractOne, extractResult, extractScalar } from '../query/results.ts'

// ---------------------------------------------------------------------------
// Issue #5: GROUP BY / GROUP ALL aggregation support
// ---------------------------------------------------------------------------
describe('Issue #5: GROUP BY / GROUP ALL aggregation', () => {
  describe('groupAll()', () => {
    it('should build SELECT with GROUP ALL', () => {
      const sql = select(as_(count(), 'total'))
        .fromTable('users')
        .groupAll()
        .toSurQL()
      assertEquals(sql, 'SELECT count() AS total FROM users GROUP ALL')
    })

    it('should combine fields with GROUP ALL', () => {
      const sql = select(
        as_(count(), 'total'),
        as_(mathSum(field('price')), 'sum_price'),
      )
        .fromTable('orders')
        .groupAll()
        .toSurQL()
      assertEquals(
        sql,
        'SELECT count() AS total, math::sum(price) AS sum_price FROM orders GROUP ALL',
      )
    })

    it('should prefer GROUP ALL over GROUP BY when both set', () => {
      const sql = select(as_(count(), 'total'))
        .fromTable('users')
        .groupBy('status')
        .groupAll()
        .toSurQL()
      assertEquals(sql, 'SELECT count() AS total FROM users GROUP ALL')
    })

    it('should work with WHERE clause', () => {
      const sql = select(as_(count(), 'total'))
        .fromTable('users')
        .where('active = true')
        .groupAll()
        .toSurQL()
      assertEquals(sql, 'SELECT count() AS total FROM users WHERE active = true GROUP ALL')
    })

    it('should preserve immutability', () => {
      const q1 = select(as_(count(), 'total')).fromTable('users')
      const q2 = q1.groupAll()
      assertEquals(q1.toSurQL(), 'SELECT count() AS total FROM users')
      assertEquals(q2.toSurQL(), 'SELECT count() AS total FROM users GROUP ALL')
    })
  })

  describe('groupBy() with aggregates', () => {
    it('should build GROUP BY with count', () => {
      const sql = select('status', as_(count(), 'total'))
        .fromTable('users')
        .groupBy('status')
        .toSurQL()
      assertEquals(sql, 'SELECT status, count() AS total FROM users GROUP BY status')
    })

    it('should build GROUP BY with math::sum', () => {
      const sql = select('category', as_(mathSum(field('amount')), 'total_amount'))
        .fromTable('orders')
        .groupBy('category')
        .toSurQL()
      assertEquals(
        sql,
        'SELECT category, math::sum(amount) AS total_amount FROM orders GROUP BY category',
      )
    })

    it('should build GROUP BY with math::mean', () => {
      const sql = select('department', as_(mathMean(field('salary')), 'avg_salary'))
        .fromTable('employees')
        .groupBy('department')
        .toSurQL()
      assertEquals(
        sql,
        'SELECT department, math::mean(salary) AS avg_salary FROM employees GROUP BY department',
      )
    })

    it('should build GROUP BY with math::max and math::min', () => {
      const sql = select(
        'category',
        as_(mathMax(field('price')), 'max_price'),
        as_(mathMin(field('price')), 'min_price'),
      )
        .fromTable('products')
        .groupBy('category')
        .toSurQL()
      assertEquals(
        sql,
        'SELECT category, math::max(price) AS max_price, math::min(price) AS min_price FROM products GROUP BY category',
      )
    })

    it('should build GROUP BY with multiple fields', () => {
      const sql = select('region', 'category', as_(count(), 'total'))
        .fromTable('sales')
        .groupBy('region', 'category')
        .toSurQL()
      assertEquals(
        sql,
        'SELECT region, category, count() AS total FROM sales GROUP BY region, category',
      )
    })
  })

  describe('mathMean()', () => {
    it('should render math::mean()', () => {
      assertEquals(mathMean(field('score')).toSurQL(), 'math::mean(score)')
    })
  })

  describe('mathSum()', () => {
    it('should render math::sum()', () => {
      assertEquals(mathSum(field('price')).toSurQL(), 'math::sum(price)')
    })
  })

  describe('mathMax()', () => {
    it('should render math::max()', () => {
      assertEquals(mathMax(field('age')).toSurQL(), 'math::max(age)')
    })
  })

  describe('mathMin()', () => {
    it('should render math::min()', () => {
      assertEquals(mathMin(field('age')).toSurQL(), 'math::min(age)')
    })
  })

  describe('as_() aliasing with aggregates', () => {
    it('should alias count', () => {
      assertEquals(as_(count(), 'total').toSurQL(), 'count() AS total')
    })

    it('should alias math::sum', () => {
      assertEquals(as_(mathSum(field('val')), 'sum_val').toSurQL(), 'math::sum(val) AS sum_val')
    })

    it('should alias nested function calls', () => {
      assertEquals(
        as_(func('math::round', mathMean(field('score'))), 'rounded_avg').toSurQL(),
        'math::round(math::mean(score)) AS rounded_avg',
      )
    })
  })
})

// ---------------------------------------------------------------------------
// Issue #6: type::record() helper
// ---------------------------------------------------------------------------
describe('Issue #6: type::record() helper', () => {
  describe('recordRef()', () => {
    it('should generate type::record with table and id', () => {
      assertEquals(
        recordRef('users', '123').toSurQL(),
        "type::record('users:123')",
      )
    })

    it('should generate type::record with table only', () => {
      assertEquals(
        recordRef('users').toSurQL(),
        "type::record('users')",
      )
    })

    it('should work with complex IDs', () => {
      assertEquals(
        recordRef('users', 'abc-def-ghi').toSurQL(),
        "type::record('users:abc-def-ghi')",
      )
    })

    it('should be usable in SELECT expressions', () => {
      const sql = select(as_(recordRef('users', 'alice'), 'user_ref'))
        .fromTable('posts')
        .toSurQL()
      assertEquals(
        sql,
        "SELECT type::record('users:alice') AS user_ref FROM posts",
      )
    })

    it('should be usable in WHERE conditions via toSurQL', () => {
      const ref = recordRef('users', 'alice')
      const sql = select()
        .fromTable('posts')
        .where(`author = ${ref.toSurQL()}`)
        .toSurQL()
      assertEquals(
        sql,
        "SELECT * FROM posts WHERE author = type::record('users:alice')",
      )
    })
  })
})

// ---------------------------------------------------------------------------
// Issue #7: SurrealDB function support in field values
// ---------------------------------------------------------------------------
describe('Issue #7: SurrealDB function support in field values', () => {
  describe('surqlFn()', () => {
    it('should create a time::now() function value', () => {
      const fn = surqlFn('time::now')
      assertEquals(fn.toSurQL(), 'time::now()')
      assertEquals(fn.__surqlFn, true)
      assertEquals(fn.surql, 'time::now()')
    })

    it('should create a function with arguments', () => {
      const fn = surqlFn('time::format', 'time::now()', "'%Y-%m-%d'")
      assertEquals(fn.toSurQL(), "time::format(time::now(), '%Y-%m-%d')")
    })

    it('should create math functions', () => {
      assertEquals(surqlFn('math::floor', '3.7').toSurQL(), 'math::floor(3.7)')
      assertEquals(surqlFn('math::ceil', '3.2').toSurQL(), 'math::ceil(3.2)')
      assertEquals(surqlFn('math::round', '3.5').toSurQL(), 'math::round(3.5)')
    })

    it('should create rand::uuid function', () => {
      assertEquals(surqlFn('rand::uuid').toSurQL(), 'rand::uuid()')
    })
  })

  describe('isSurqlFn()', () => {
    it('should return true for surqlFn values', () => {
      assertEquals(isSurqlFn(surqlFn('time::now')), true)
    })

    it('should return false for plain objects', () => {
      assertEquals(isSurqlFn({ __surqlFn: false }), false)
      assertEquals(isSurqlFn({}), false)
      assertEquals(isSurqlFn(null), false)
      assertEquals(isSurqlFn(undefined), false)
      assertEquals(isSurqlFn('string'), false)
      assertEquals(isSurqlFn(42), false)
    })
  })

  describe('quoteValue() with surqlFn', () => {
    it('should render surqlFn as raw SurrealQL', () => {
      const fn = surqlFn('time::now')
      assertEquals(quoteValue(fn), 'time::now()')
    })

    it('should render surqlFn with args as raw SurrealQL', () => {
      const fn = surqlFn('math::floor', '3.7')
      assertEquals(quoteValue(fn), 'math::floor(3.7)')
    })

    it('should still quote regular strings', () => {
      assertEquals(quoteValue('hello'), "'hello'")
    })

    it('should still handle null', () => {
      assertEquals(quoteValue(null), 'NONE')
    })

    it('should still handle numbers', () => {
      assertEquals(quoteValue(42), '42')
    })
  })

  describe('surqlFn in INSERT queries', () => {
    it('should render function as raw SurrealQL in INSERT', () => {
      const sql = insert('events', {
        name: 'login',
        created_at: surqlFn('time::now'),
      }).toSurQL()
      assertEquals(sql, "INSERT INTO events SET name = 'login', created_at = time::now()")
    })
  })

  describe('surqlFn in UPDATE queries', () => {
    it('should render function as raw SurrealQL in UPDATE', () => {
      const sql = updateQuery('users:alice', {
        last_login: surqlFn('time::now'),
        login_count: surqlFn('math::floor', '3.7'),
      }).toSurQL()
      assertEquals(
        sql,
        'UPDATE users:alice SET last_login = time::now(), login_count = math::floor(3.7)',
      )
    })
  })

  describe('surqlFn mixed with regular values', () => {
    it('should handle mixed surqlFn and regular values in INSERT', () => {
      const sql = insert('posts', {
        title: 'Hello World',
        author: 'alice',
        created_at: surqlFn('time::now'),
        views: 0,
      }).toSurQL()
      assertEquals(
        sql,
        "INSERT INTO posts SET title = 'Hello World', author = 'alice', created_at = time::now(), views = 0",
      )
    })
  })
})

// ---------------------------------------------------------------------------
// Issue #8: Result extraction helpers
// ---------------------------------------------------------------------------
describe('Issue #8: Result extraction helpers', () => {
  describe('extractResult()', () => {
    it('should extract from nested array [[records]]', () => {
      const result = extractResult<{ id: string }>([[{ id: '1' }, { id: '2' }]])
      assertEquals(result.length, 2)
      assertEquals(result[0].id, '1')
    })

    it('should extract from flat array [records]', () => {
      const result = extractResult<{ id: string }>([{ id: '1' }])
      assertEquals(result.length, 1)
    })

    it('should handle null/undefined', () => {
      assertEquals(extractResult(null).length, 0)
      assertEquals(extractResult(undefined).length, 0)
    })

    it('should wrap single object in array', () => {
      const result = extractResult<{ id: string }>({ id: '1' })
      assertEquals(result.length, 1)
      assertEquals(result[0].id, '1')
    })

    it('should handle empty array', () => {
      assertEquals(extractResult([]).length, 0)
    })

    it('should handle deeply nested response [[records]] with single item', () => {
      const result = extractResult<{ count: number }>([[{ count: 42 }]])
      assertEquals(result.length, 1)
      assertEquals(result[0].count, 42)
    })
  })

  describe('extractOne()', () => {
    it('should extract first item from flat array', () => {
      const result = extractOne<{ id: string }>([{ id: '1' }, { id: '2' }])
      assertEquals(result?.id, '1')
    })

    it('should extract from nested array', () => {
      const result = extractOne<{ id: string }>([[{ id: '1' }]])
      assertEquals(result?.id, '1')
    })

    it('should return null for empty', () => {
      assertEquals(extractOne([]), null)
    })

    it('should return null for null input', () => {
      assertEquals(extractOne(null), null)
    })

    it('should return null for undefined input', () => {
      assertEquals(extractOne(undefined), null)
    })
  })

  describe('extractScalar()', () => {
    it('should extract first value by default', () => {
      assertEquals(extractScalar([{ count: 42 }]), 42)
    })

    it('should extract by key', () => {
      assertEquals(extractScalar([{ count: 42, total: 100 }], 'total'), 100)
    })

    it('should extract by key from nested response', () => {
      assertEquals(extractScalar([[{ count: 42, total: 100 }]], 'count'), 42)
    })

    it('should return null for missing key', () => {
      assertEquals(extractScalar([{ count: 42 }], 'missing'), null)
    })

    it('should return defaultValue for missing key', () => {
      assertEquals(extractScalar([{ count: 42 }], 'missing', 0), 0)
    })

    it('should return defaultValue for empty results', () => {
      assertEquals(extractScalar([], undefined, 0), 0)
    })

    it('should return defaultValue for null input', () => {
      assertEquals(extractScalar(null, undefined, 'default'), 'default')
    })

    it('should return null when no key, no default, and no results', () => {
      assertEquals(extractScalar([]), null)
    })

    it('should return existing value even when defaultValue is provided', () => {
      assertEquals(extractScalar([{ count: 42 }], 'count', 0), 42)
    })

    it('should handle string scalar values', () => {
      assertEquals(extractScalar([{ name: 'Alice' }], 'name'), 'Alice')
    })

    it('should handle boolean scalar values', () => {
      assertEquals(extractScalar([{ active: true }], 'active'), true)
    })

    it('should handle zero as a valid value (not falsy)', () => {
      assertEquals(extractScalar([{ count: 0 }], 'count', 99), 0)
    })
  })
})

// ---------------------------------------------------------------------------
// Cross-feature integration tests
// ---------------------------------------------------------------------------
describe('Cross-feature integration', () => {
  it('should combine GROUP ALL with count aggregate', () => {
    const sql = select(as_(count(), 'total'))
      .fromTable('users')
      .where('active = true')
      .groupAll()
      .toSurQL()
    assertEquals(sql, 'SELECT count() AS total FROM users WHERE active = true GROUP ALL')
  })

  it('should combine GROUP BY with multiple aggregates and ORDER BY', () => {
    const sql = select(
      'category',
      as_(count(), 'cnt'),
      as_(mathSum(field('amount')), 'total'),
      as_(mathMean(field('amount')), 'avg_amount'),
    )
      .fromTable('orders')
      .groupBy('category')
      .orderBy('cnt', 'DESC')
      .limit(10)
      .toSurQL()
    assertEquals(
      sql,
      'SELECT category, count() AS cnt, math::sum(amount) AS total, math::mean(amount) AS avg_amount FROM orders GROUP BY category ORDER BY cnt DESC LIMIT 10',
    )
  })

  it('should use surqlFn with INSERT and recordRef in WHERE', () => {
    const ref = recordRef('users', 'alice')
    const sql = select()
      .fromTable('posts')
      .where(`author = ${ref.toSurQL()}`)
      .toSurQL()
    assertEquals(sql, "SELECT * FROM posts WHERE author = type::record('users:alice')")
  })

  it('should use surqlFn in DELETE query context (not directly, but demonstrates quoting)', () => {
    const sql = deleteQuery('events').where('created_at < time::now()').toSurQL()
    assertEquals(sql, 'DELETE events WHERE created_at < time::now()')
  })

  it('should extract scalar from GROUP ALL result', () => {
    // Simulates: SELECT count() AS total FROM users GROUP ALL -> [[{ total: 42 }]]
    const raw = [[{ total: 42 }]]
    assertEquals(extractScalar<number>(raw, 'total'), 42)
  })

  it('should extract scalar with default from empty GROUP ALL result', () => {
    assertEquals(extractScalar<number>([], 'total', 0), 0)
  })
})
