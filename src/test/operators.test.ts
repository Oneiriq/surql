import { assertEquals, assertThrows } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import {
  and_,
  contains,
  containsAll,
  containsAny,
  containsNot,
  eq,
  gt,
  gte,
  inside,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  not_,
  notInside,
  or_,
} from '../types/operators.ts'

describe('operators', () => {
  describe('eq()', () => {
    it('should create equals expression for string value', () => {
      const expr = eq('name', 'Alice')
      assertEquals(expr.field, 'name')
      assertEquals(expr.operator, '=')
      assertEquals(expr.value, 'Alice')
      assertEquals(expr.toSurQL(), "name = 'Alice'")
    })

    it('should create equals expression for number value', () => {
      const expr = eq('age', 30)
      assertEquals(expr.toSurQL(), 'age = 30')
    })

    it('should create equals expression for boolean value', () => {
      const expr = eq('active', true)
      assertEquals(expr.toSurQL(), 'active = true')
    })

    it('should create equals expression for null value', () => {
      const expr = eq('deleted_at', null)
      assertEquals(expr.toSurQL(), 'deleted_at = NONE')
    })

    it('should create equals expression for undefined value', () => {
      const expr = eq('deleted_at', undefined)
      assertEquals(expr.toSurQL(), 'deleted_at = NONE')
    })

    it('should create equals expression for array value', () => {
      const expr = eq('tags', ['a', 'b'])
      assertEquals(expr.toSurQL(), "tags = ['a', 'b']")
    })

    it('should return a frozen object', () => {
      const expr = eq('name', 'Alice')
      assertThrows(() => {
        // deno-lint-ignore no-explicit-any
        ;(expr as any).field = 'changed'
      })
    })
  })

  describe('ne()', () => {
    it('should create not-equals expression', () => {
      const expr = ne('status', 'deleted')
      assertEquals(expr.field, 'status')
      assertEquals(expr.operator, '!=')
      assertEquals(expr.value, 'deleted')
      assertEquals(expr.toSurQL(), "status != 'deleted'")
    })
  })

  describe('gt()', () => {
    it('should create greater-than expression', () => {
      const expr = gt('age', 18)
      assertEquals(expr.field, 'age')
      assertEquals(expr.operator, '>')
      assertEquals(expr.value, 18)
      assertEquals(expr.toSurQL(), 'age > 18')
    })
  })

  describe('gte()', () => {
    it('should create greater-than-or-equal expression', () => {
      const expr = gte('score', 90)
      assertEquals(expr.operator, '>=')
      assertEquals(expr.toSurQL(), 'score >= 90')
    })
  })

  describe('lt()', () => {
    it('should create less-than expression', () => {
      const expr = lt('price', 100)
      assertEquals(expr.operator, '<')
      assertEquals(expr.toSurQL(), 'price < 100')
    })
  })

  describe('lte()', () => {
    it('should create less-than-or-equal expression', () => {
      const expr = lte('weight', 50.5)
      assertEquals(expr.operator, '<=')
      assertEquals(expr.toSurQL(), 'weight <= 50.5')
    })
  })

  describe('contains()', () => {
    it('should create CONTAINS expression', () => {
      const expr = contains('tags', 'premium')
      assertEquals(expr.operator, 'CONTAINS')
      assertEquals(expr.toSurQL(), "tags CONTAINS 'premium'")
    })
  })

  describe('containsNot()', () => {
    it('should create CONTAINSNOT expression', () => {
      const expr = containsNot('tags', 'banned')
      assertEquals(expr.operator, 'CONTAINSNOT')
      assertEquals(expr.toSurQL(), "tags CONTAINSNOT 'banned'")
    })
  })

  describe('containsAll()', () => {
    it('should create CONTAINSALL expression with array', () => {
      const expr = containsAll('tags', ['a', 'b'])
      assertEquals(expr.operator, 'CONTAINSALL')
      assertEquals(expr.toSurQL(), "tags CONTAINSALL ['a', 'b']")
    })
  })

  describe('containsAny()', () => {
    it('should create CONTAINSANY expression with array', () => {
      const expr = containsAny('roles', ['admin', 'mod'])
      assertEquals(expr.operator, 'CONTAINSANY')
      assertEquals(expr.toSurQL(), "roles CONTAINSANY ['admin', 'mod']")
    })
  })

  describe('inside()', () => {
    it('should create INSIDE expression', () => {
      const expr = inside('status', 'active')
      assertEquals(expr.operator, 'INSIDE')
      assertEquals(expr.toSurQL(), "status INSIDE 'active'")
    })
  })

  describe('notInside()', () => {
    it('should create NOTINSIDE expression', () => {
      const expr = notInside('role', 'banned')
      assertEquals(expr.operator, 'NOTINSIDE')
      assertEquals(expr.toSurQL(), "role NOTINSIDE 'banned'")
    })
  })

  describe('isNull()', () => {
    it('should create IS NONE expression', () => {
      const expr = isNull('deleted_at')
      assertEquals(expr.operator, 'IS')
      assertEquals(expr.toSurQL(), 'deleted_at IS NONE')
    })
  })

  describe('isNotNull()', () => {
    it('should create IS NOT NONE expression', () => {
      const expr = isNotNull('email')
      assertEquals(expr.operator, 'IS NOT')
      assertEquals(expr.toSurQL(), 'email IS NOT NONE')
    })
  })

  describe('and_()', () => {
    it('should combine two expressions with AND', () => {
      const result = and_(eq('active', true), gt('age', 18))
      assertEquals(result, 'active = true AND age > 18')
    })

    it('should combine three expressions with AND', () => {
      const result = and_(eq('active', true), gt('age', 18), lt('age', 65))
      assertEquals(result, 'active = true AND age > 18 AND age < 65')
    })

    it('should handle single expression', () => {
      const result = and_(eq('name', 'test'))
      assertEquals(result, "name = 'test'")
    })
  })

  describe('or_()', () => {
    it('should combine expressions with OR and wrap in parens', () => {
      const result = or_(eq('role', 'admin'), eq('role', 'moderator'))
      assertEquals(result, "(role = 'admin' OR role = 'moderator')")
    })

    it('should handle single expression', () => {
      const result = or_(eq('active', true))
      assertEquals(result, '(active = true)')
    })
  })

  describe('not_()', () => {
    it('should negate an expression', () => {
      const result = not_(eq('deleted', true))
      assertEquals(result, 'NOT (deleted = true)')
    })
  })

  describe('quoteValue edge cases', () => {
    it('should escape single quotes in strings', () => {
      const expr = eq('name', "O'Brien")
      assertEquals(expr.toSurQL(), "name = 'O\\'Brien'")
    })

    it('should escape backslashes before quotes (no quote-smuggle)', () => {
      // Regression for CodeQL js/incomplete-sanitization on src/types/operators.ts.
      const expr = eq('name', "a\\'; SELECT * FROM users; --")
      assertEquals(expr.toSurQL(), "name = 'a\\\\\\'; SELECT * FROM users; --'")
    })

    it('should handle false boolean', () => {
      const expr = eq('active', false)
      assertEquals(expr.toSurQL(), 'active = false')
    })

    it('should handle zero', () => {
      const expr = eq('count', 0)
      assertEquals(expr.toSurQL(), 'count = 0')
    })

    it('should handle negative numbers', () => {
      const expr = eq('offset', -5)
      assertEquals(expr.toSurQL(), 'offset = -5')
    })

    it('should handle nested arrays', () => {
      const expr = eq('matrix', [[1, 2], [3, 4]])
      assertEquals(expr.toSurQL(), 'matrix = [[1, 2], [3, 4]]')
    })
  })

  describe('validateIdentifier', () => {
    it('should accept simple field names', () => {
      const expr = eq('username', 'test')
      assertEquals(expr.field, 'username')
    })

    it('should accept dotted field paths', () => {
      const expr = eq('user.profile.name', 'test')
      assertEquals(expr.field, 'user.profile.name')
    })

    it('should accept fields with colons', () => {
      const expr = eq('user:admin', 'test')
      assertEquals(expr.field, 'user:admin')
    })

    it('should accept fields with hyphens', () => {
      const expr = eq('first-name', 'test')
      assertEquals(expr.field, 'first-name')
    })

    it('should reject fields with spaces', () => {
      assertThrows(
        () => eq('bad field', 'test'),
        Error,
        'Invalid field identifier',
      )
    })

    it('should reject fields with semicolons', () => {
      assertThrows(
        () => eq('field;DROP TABLE', 'test'),
        Error,
        'Invalid field identifier',
      )
    })

    it('should reject fields with parentheses', () => {
      assertThrows(
        () => eq('field()', 'test'),
        Error,
        'Invalid field identifier',
      )
    })

    it('should reject fields with quotes', () => {
      assertThrows(
        () => eq("field'", 'test'),
        Error,
        'Invalid field identifier',
      )
    })
  })

  describe('complex compositions', () => {
    it('should compose nested clauses via string interpolation', () => {
      const orClause = or_(eq('role', 'admin'), eq('role', 'moderator'))
      const andClause = and_(eq('active', true))
      const combined = `${andClause} AND ${orClause}`
      assertEquals(combined, "active = true AND (role = 'admin' OR role = 'moderator')")
    })

    it('should allow building WHERE clauses from expressions', () => {
      const conditions = and_(
        gt('age', 18),
        ne('status', 'banned'),
        contains('roles', 'user'),
      )
      const query = `SELECT * FROM users WHERE ${conditions}`
      assertEquals(query, "SELECT * FROM users WHERE age > 18 AND status != 'banned' AND roles CONTAINS 'user'")
    })
  })
})
