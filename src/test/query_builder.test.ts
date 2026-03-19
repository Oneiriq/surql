import { assertEquals, assertStringIncludes } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { deleteQuery, insert, Query, relate, select, updateQuery, upsertQuery } from '../query/builder.ts'
import { ReturnFormat } from '../query/helpers.ts'
import { parallelHint, timeoutHint } from '../query/hints.ts'

describe('Query Builder', () => {
  describe('immutability', () => {
    it('should return a new Query on each method call', () => {
      const q1 = new Query()
      const q2 = q1.select('name')
      const q3 = q2.fromTable('users')
      assertEquals(q1 !== q2, true)
      assertEquals(q2 !== q3, true)
    })
  })

  describe('SELECT', () => {
    it('should build a basic SELECT *', () => {
      const sql = select().fromTable('users').toSurQL()
      assertEquals(sql, 'SELECT * FROM users')
    })

    it('should build SELECT with specific fields', () => {
      const sql = select('name', 'email').fromTable('users').toSurQL()
      assertEquals(sql, 'SELECT name, email FROM users')
    })

    it('should add WHERE clause', () => {
      const sql = select().fromTable('users').where('age > 18').toSurQL()
      assertEquals(sql, 'SELECT * FROM users WHERE age > 18')
    })

    it('should chain WHERE clauses with AND', () => {
      const sql = select().fromTable('users').where('age > 18').where('active = true').toSurQL()
      assertEquals(sql, 'SELECT * FROM users WHERE age > 18 AND active = true')
    })

    it('should add ORDER BY', () => {
      const sql = select().fromTable('users').orderBy('name').toSurQL()
      assertEquals(sql, 'SELECT * FROM users ORDER BY name ASC')
    })

    it('should add ORDER BY DESC', () => {
      const sql = select().fromTable('users').orderBy('created', 'DESC').toSurQL()
      assertEquals(sql, 'SELECT * FROM users ORDER BY created DESC')
    })

    it('should add GROUP BY', () => {
      const sql = select('status', 'count()').fromTable('users').groupBy('status').toSurQL()
      assertEquals(sql, 'SELECT status, count() FROM users GROUP BY status')
    })

    it('should add LIMIT', () => {
      const sql = select().fromTable('users').limit(10).toSurQL()
      assertEquals(sql, 'SELECT * FROM users LIMIT 10')
    })

    it('should add OFFSET (START)', () => {
      const sql = select().fromTable('users').limit(10).offset(20).toSurQL()
      assertEquals(sql, 'SELECT * FROM users LIMIT 10 START 20')
    })

    it('should add hints', () => {
      const sql = select().fromTable('users').withHint(parallelHint()).withHint(timeoutHint(5000)).toSurQL()
      assertStringIncludes(sql, 'PARALLEL')
      assertStringIncludes(sql, 'TIMEOUT 5s')
    })
  })

  describe('INSERT', () => {
    it('should build INSERT query', () => {
      const sql = insert('users', { name: 'Alice', age: 30 }).toSurQL()
      assertStringIncludes(sql, 'INSERT INTO users SET')
      assertStringIncludes(sql, "name = 'Alice'")
      assertStringIncludes(sql, 'age = 30')
    })

    it('should support RETURN NONE format', () => {
      const sql = insert('users', { name: 'Alice' }).returnFormat(ReturnFormat.NONE).toSurQL()
      assertStringIncludes(sql, 'INSERT INTO users SET')
      assertStringIncludes(sql, 'RETURN NONE')
    })

    it('should support RETURN FULL format', () => {
      const sql = insert('users', { name: 'Alice' }).returnFormat(ReturnFormat.FULL).toSurQL()
      assertStringIncludes(sql, 'INSERT INTO users SET')
      assertStringIncludes(sql, 'RETURN FULL')
    })
  })

  describe('UPDATE', () => {
    it('should build UPDATE query', () => {
      const sql = updateQuery('users:1', { name: 'Bob' }).toSurQL()
      assertStringIncludes(sql, 'UPDATE users:1 SET')
      assertStringIncludes(sql, "name = 'Bob'")
    })

    it('should support WHERE clause', () => {
      const sql = updateQuery('users', { active: false }).where("last_login < '2024-01-01'").toSurQL()
      assertStringIncludes(sql, 'WHERE')
    })

    it('should support RETURN AFTER format', () => {
      const sql = updateQuery('users:1', { name: 'Bob' }).returnFormat(ReturnFormat.AFTER).toSurQL()
      assertStringIncludes(sql, 'RETURN AFTER')
    })

    it('should support RETURN NONE format', () => {
      const sql = updateQuery('user:alice', { age: 30 }).returnFormat(ReturnFormat.NONE).toSurQL()
      assertEquals(sql, 'UPDATE user:alice SET age = 30 RETURN NONE')
    })

    it('should support RETURN DIFF format', () => {
      const sql = updateQuery('user:alice', { age: 30 }).returnFormat(ReturnFormat.DIFF).toSurQL()
      assertEquals(sql, 'UPDATE user:alice SET age = 30 RETURN DIFF')
    })

    it('should support RETURN BEFORE format', () => {
      const sql = updateQuery('user:alice', { age: 30 }).returnFormat(ReturnFormat.BEFORE).toSurQL()
      assertEquals(sql, 'UPDATE user:alice SET age = 30 RETURN BEFORE')
    })

    it('should support WHERE with RETURN DIFF format', () => {
      const sql = updateQuery('users', { status: 'active' }).where('age > 18').returnFormat(ReturnFormat.DIFF).toSurQL()
      assertStringIncludes(sql, 'UPDATE users SET')
      assertStringIncludes(sql, 'WHERE age > 18')
      assertStringIncludes(sql, 'RETURN DIFF')
    })
  })

  describe('DELETE', () => {
    it('should build DELETE query', () => {
      const sql = deleteQuery('users:1').toSurQL()
      assertEquals(sql, 'DELETE users:1')
    })

    it('should support WHERE clause', () => {
      const sql = deleteQuery('users').where('active = false').toSurQL()
      assertEquals(sql, 'DELETE users WHERE active = false')
    })

    it('should support RETURN NONE format', () => {
      const sql = deleteQuery('user:alice').returnFormat(ReturnFormat.NONE).toSurQL()
      assertEquals(sql, 'DELETE user:alice RETURN NONE')
    })

    it('should support RETURN BEFORE format', () => {
      const sql = deleteQuery('user:alice').returnFormat(ReturnFormat.BEFORE).toSurQL()
      assertEquals(sql, 'DELETE user:alice RETURN BEFORE')
    })

    it('should support WHERE with RETURN BEFORE format', () => {
      const sql = deleteQuery('users').where('deleted_at IS NOT NULL').returnFormat(ReturnFormat.BEFORE).toSurQL()
      assertStringIncludes(sql, 'DELETE users WHERE')
      assertStringIncludes(sql, 'RETURN BEFORE')
    })
  })

  describe('UPSERT', () => {
    it('should build UPSERT query', () => {
      const sql = upsertQuery('users', { name: 'Alice' }).toSurQL()
      assertStringIncludes(sql, 'UPSERT users SET')
      assertStringIncludes(sql, "name = 'Alice'")
    })
  })

  describe('RELATE', () => {
    it('should build RELATE query', () => {
      const sql = relate('users:1', 'follows', 'users:2').toSurQL()
      assertEquals(sql, 'RELATE users:1->follows->users:2')
    })

    it('should support SET data', () => {
      const sql = relate('users:1', 'follows', 'users:2', { since: '2024-01-01' }).toSurQL()
      assertStringIncludes(sql, 'SET')
      assertStringIncludes(sql, "since = '2024-01-01'")
    })

    it('should support RETURN FULL format', () => {
      const sql = relate('user:alice', 'likes', 'post:123').returnFormat(ReturnFormat.FULL).toSurQL()
      assertStringIncludes(sql, 'RELATE user:alice->likes->post:123')
      assertStringIncludes(sql, 'RETURN FULL')
    })

    it('should support data with RETURN AFTER format', () => {
      const sql = relate('user:alice', 'likes', 'post:123', { weight: 5 }).returnFormat(ReturnFormat.AFTER).toSurQL()
      assertStringIncludes(sql, 'RELATE user:alice->likes->post:123')
      assertStringIncludes(sql, 'SET')
      assertStringIncludes(sql, 'RETURN AFTER')
    })
  })

  describe('vector search', () => {
    it('should build vector search query', () => {
      const sql = select().fromTable('docs').vectorSearch('embedding', [0.1, 0.2, 0.3]).toSurQL()
      assertStringIncludes(sql, 'embedding <|10|> [0.1, 0.2, 0.3]')
    })
  })

  describe('traversal', () => {
    it('should add traversal path', () => {
      const sql = select().fromTable('users:1').traverse('->follows->users').toSurQL()
      assertStringIncludes(sql, 'users:1.->follows->users')
    })
  })

  describe('operation property', () => {
    it('should return the current operation', () => {
      assertEquals(select().operation, 'SELECT')
      assertEquals(insert('t', {}).operation, 'INSERT')
      assertEquals(deleteQuery('t').operation, 'DELETE')
    })
  })

  describe('return format immutability and chaining', () => {
    it('should preserve immutability when setting return format', () => {
      const q1 = updateQuery('user:alice', { age: 30 })
      const q2 = q1.returnFormat(ReturnFormat.DIFF)
      assertEquals(q1.toSurQL().includes('RETURN'), false)
      assertEquals(q2.toSurQL().includes('RETURN DIFF'), true)
      assertEquals((q1 as unknown as { state: { returnFormat: ReturnFormat | null } }).state !== undefined, true)
      assertStringIncludes(q2.toSurQL(), 'RETURN DIFF')
    })

    it('should replace previous return format when chained', () => {
      const sql = updateQuery('user:alice', { age: 30 })
        .returnFormat(ReturnFormat.NONE)
        .returnFormat(ReturnFormat.DIFF)
        .toSurQL()
      assertStringIncludes(sql, 'RETURN DIFF')
      assertEquals(sql.includes('RETURN NONE'), false)
    })
  })
})
