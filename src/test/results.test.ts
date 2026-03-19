import { assertEquals, assertThrows } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import {
  aggregate,
  countResult,
  emptyRecord,
  extractOne,
  extractResult,
  extractScalar,
  hasResults,
  paginated,
  record,
  records,
  success,
} from '../query/results.ts'

describe('Query Results', () => {
  describe('success()', () => {
    it('should wrap data with OK status', () => {
      const r = success({ id: '1' })
      assertEquals(r.data.id, '1')
      assertEquals(r.status, 'OK')
      assertEquals(r.time, null)
    })

    it('should accept optional time', () => {
      const r = success([1, 2], '100ms')
      assertEquals(r.time, '100ms')
      assertEquals(r.status, 'OK')
    })

    it('should return a frozen object', () => {
      const r = success('data')
      assertEquals(Object.isFrozen(r), true)
    })
  })

  describe('record()', () => {
    it('should wrap a single record', () => {
      const r = record({ id: '1', name: 'Alice' })
      assertEquals(r.ok, true)
      assertEquals(r.data?.name, 'Alice')
      assertEquals(r.unwrap().name, 'Alice')
    })
  })

  describe('emptyRecord()', () => {
    it('should create an empty result', () => {
      const r = emptyRecord<{ name: string }>()
      assertEquals(r.ok, false)
      assertEquals(r.data, null)
    })

    it('should throw on unwrap()', () => {
      const r = emptyRecord()
      assertThrows(() => r.unwrap(), Error, 'Cannot unwrap empty result')
    })

    it('should return fallback on unwrapOr()', () => {
      const r = emptyRecord<{ name: string }>()
      assertEquals(r.unwrapOr({ name: 'default' }).name, 'default')
    })
  })

  describe('records()', () => {
    it('should wrap multiple records', () => {
      const r = records([{ id: '1' }, { id: '2' }])
      assertEquals(r.records.length, 2)
      assertEquals(r.total, 2)
    })

    it('should compute hasMore correctly', () => {
      const r = records([{ id: '1' }], { total: 10, limit: 1, offset: 0 })
      assertEquals(r.hasMore, true)
    })

    it('should return first/last', () => {
      const r = records([{ id: '1' }, { id: '2' }])
      assertEquals(r.first()?.id, '1')
      assertEquals(r.last()?.id, '2')
    })

    it('should return null for first/last on empty', () => {
      const r = records([])
      assertEquals(r.first(), null)
      assertEquals(r.last(), null)
    })

    it('should support getPage()', () => {
      const r = records([{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }])
      const page0 = r.getPage(0, 2)
      assertEquals(page0.length, 2)
      assertEquals(page0[0].id, '1')
      assertEquals(page0[1].id, '2')
      const page1 = r.getPage(1, 2)
      assertEquals(page1.length, 2)
      assertEquals(page1[0].id, '3')
    })

    it('should return empty array for out-of-range page', () => {
      const r = records([{ id: '1' }])
      assertEquals(r.getPage(5, 10).length, 0)
    })
  })

  describe('countResult()', () => {
    it('should wrap a count', () => {
      assertEquals(countResult(42).count, 42)
    })
  })

  describe('aggregate()', () => {
    it('should wrap an aggregate value', () => {
      const a = aggregate(99.5, 'avg_score')
      assertEquals(a.value, 99.5)
      assertEquals(a.label, 'avg_score')
    })
  })

  describe('paginated()', () => {
    it('should wrap paginated results', () => {
      const p = paginated([{ id: '1' }], { total: 10, limit: 1, offset: 0, hasMore: true })
      assertEquals(p.records.length, 1)
      assertEquals(p.page.total, 10)
      assertEquals(p.page.hasMore, true)
    })
  })

  describe('extractResult()', () => {
    it('should unwrap nested arrays', () => {
      assertEquals(extractResult([[{ id: '1' }]]).length, 1)
    })

    it('should handle flat arrays', () => {
      assertEquals(extractResult([{ id: '1' }]).length, 1)
    })

    it('should handle null', () => {
      assertEquals(extractResult(null).length, 0)
    })
  })

  describe('extractOne()', () => {
    it('should extract first item', () => {
      assertEquals(extractOne<{ id: string }>([{ id: '1' }])?.id, '1')
    })

    it('should return null for empty', () => {
      assertEquals(extractOne([]), null)
    })
  })

  describe('extractScalar()', () => {
    it('should extract scalar value', () => {
      assertEquals(extractScalar([{ count: 42 }]), 42)
    })
  })

  describe('hasResults()', () => {
    it('should return true for non-empty', () => {
      assertEquals(hasResults([{ id: '1' }]), true)
    })

    it('should return false for empty', () => {
      assertEquals(hasResults([]), false)
    })
  })
})
