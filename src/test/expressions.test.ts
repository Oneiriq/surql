import { assertEquals } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import {
  abs_,
  arrayContains,
  arrayDistinct,
  arrayFlatten,
  arrayLength,
  as_,
  avg,
  cast,
  ceil,
  concat,
  count,
  field,
  floor,
  func,
  lower,
  max_,
  min_,
  raw,
  round_,
  stringLength,
  sum_,
  timeFormat,
  timeNow,
  typeIs,
  upper,
  value,
} from '../query/expressions.ts'

describe('Query Expressions', () => {
  describe('field()', () => {
    it('should create a field reference', () => {
      assertEquals(field('name').toSurQL(), 'name')
    })

    it('should support dotted paths', () => {
      assertEquals(field('address.city').toSurQL(), 'address.city')
    })
  })

  describe('value()', () => {
    it('should quote strings', () => {
      assertEquals(value('hello').toSurQL(), "'hello'")
    })

    it('should stringify numbers', () => {
      assertEquals(value(42).toSurQL(), '42')
    })

    it('should handle booleans', () => {
      assertEquals(value(true).toSurQL(), 'true')
    })

    it('should handle null', () => {
      assertEquals(value(null).toSurQL(), 'NONE')
    })

    it('should handle arrays', () => {
      assertEquals(value([1, 2, 3]).toSurQL(), '[1, 2, 3]')
    })
  })

  describe('func()', () => {
    it('should create a function call', () => {
      assertEquals(func('count').toSurQL(), 'count()')
    })

    it('should pass arguments', () => {
      assertEquals(func('math::sum', field('score')).toSurQL(), 'math::sum(score)')
    })
  })

  describe('raw()', () => {
    it('should pass through raw SQL', () => {
      assertEquals(raw('1 + 1').toSurQL(), '1 + 1')
    })
  })

  describe('as_()', () => {
    it('should alias an expression', () => {
      assertEquals(as_(count(), 'total').toSurQL(), 'count() AS total')
    })
  })

  describe('aggregate functions', () => {
    it('count()', () => assertEquals(count().toSurQL(), 'count()'))
    it('sum_()', () => assertEquals(sum_(field('price')).toSurQL(), 'math::sum(price)'))
    it('avg()', () => assertEquals(avg(field('score')).toSurQL(), 'math::mean(score)'))
    it('min_()', () => assertEquals(min_(field('age')).toSurQL(), 'math::min(age)'))
    it('max_()', () => assertEquals(max_(field('age')).toSurQL(), 'math::max(age)'))
  })

  describe('math functions', () => {
    it('abs_()', () => assertEquals(abs_(field('val')).toSurQL(), 'math::abs(val)'))
    it('ceil()', () => assertEquals(ceil(field('val')).toSurQL(), 'math::ceil(val)'))
    it('floor()', () => assertEquals(floor(field('val')).toSurQL(), 'math::floor(val)'))
    it('round_()', () => assertEquals(round_(field('val')).toSurQL(), 'math::round(val)'))
  })

  describe('string functions', () => {
    it('upper()', () => assertEquals(upper(field('name')).toSurQL(), 'string::uppercase(name)'))
    it('lower()', () => assertEquals(lower(field('name')).toSurQL(), 'string::lowercase(name)'))
    it('concat()', () => assertEquals(concat(value('a'), value('b')).toSurQL(), "string::concat('a', 'b')"))
  })

  describe('string functions (extended)', () => {
    it('stringLength()', () => assertEquals(stringLength(field('name')).toSurQL(), 'string::len(name)'))
  })

  describe('array functions', () => {
    it('arrayLength()', () => assertEquals(arrayLength(field('tags')).toSurQL(), 'array::len(tags)'))
    it('arrayContains()', () =>
      assertEquals(arrayContains(field('tags'), value('admin')).toSurQL(), "array::contains(tags, 'admin')"))
    it('arrayDistinct()', () => assertEquals(arrayDistinct(field('tags')).toSurQL(), 'array::distinct(tags)'))
    it('arrayFlatten()', () => assertEquals(arrayFlatten(field('nested')).toSurQL(), 'array::flatten(nested)'))
  })

  describe('time functions', () => {
    it('timeNow()', () => assertEquals(timeNow().toSurQL(), 'time::now()'))
    it('timeFormat()', () =>
      assertEquals(timeFormat(field('created'), value('%Y-%m-%d')).toSurQL(), "time::format(created, '%Y-%m-%d')"))
  })

  describe('type functions', () => {
    it('typeIs()', () => assertEquals(typeIs(field('val'), value('string')).toSurQL(), "type::is(val, 'string')"))
  })

  describe('cast()', () => {
    it('should create a type cast', () => {
      assertEquals(cast(field('val'), 'int').toSurQL(), '<int> val')
    })
  })

  describe('count with expression argument', () => {
    it('should pass expression to count()', () => {
      assertEquals(count(field('active')).toSurQL(), 'count(active)')
    })
  })
})
