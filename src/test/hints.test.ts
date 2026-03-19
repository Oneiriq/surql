import { assertEquals, assertStringIncludes } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import {
  explainHint,
  fetchHint,
  indexHint,
  mergeHints,
  parallelHint,
  renderHints,
  timeoutHint,
  validateHint,
} from '../query/hints.ts'

describe('Query Hints', () => {
  describe('indexHint()', () => {
    it('should render WITH INDEX', () => {
      assertEquals(indexHint('idx_email').toSurQL(), 'WITH INDEX idx_email')
    })
  })

  describe('timeoutHint()', () => {
    it('should render TIMEOUT in seconds', () => {
      assertEquals(timeoutHint(5000).toSurQL(), 'TIMEOUT 5s')
    })

    it('should ceil sub-second to 1s', () => {
      assertEquals(timeoutHint(500).toSurQL(), 'TIMEOUT 1s')
    })
  })

  describe('parallelHint()', () => {
    it('should render PARALLEL', () => {
      assertEquals(parallelHint().toSurQL(), 'PARALLEL')
    })
  })

  describe('fetchHint()', () => {
    it('should render FETCH with fields', () => {
      assertEquals(fetchHint('author', 'tags').toSurQL(), 'FETCH author, tags')
    })
  })

  describe('explainHint()', () => {
    it('should render EXPLAIN', () => {
      assertEquals(explainHint().toSurQL(), 'EXPLAIN')
    })

    it('should render EXPLAIN FULL', () => {
      assertEquals(explainHint(true).toSurQL(), 'EXPLAIN FULL')
    })
  })

  describe('renderHints()', () => {
    it('should combine hints', () => {
      const result = renderHints([parallelHint(), timeoutHint(3000)])
      assertStringIncludes(result, 'PARALLEL')
      assertStringIncludes(result, 'TIMEOUT 3s')
    })

    it('should return empty string for no hints', () => {
      assertEquals(renderHints([]), '')
    })
  })

  describe('validateHint()', () => {
    it('should validate valid hints', () => {
      assertEquals(validateHint(parallelHint()), true)
    })
  })

  describe('mergeHints()', () => {
    it('should merge hint arrays', () => {
      const merged = mergeHints([parallelHint()], [timeoutHint(1000)])
      assertEquals(merged.length, 2)
    })
  })
})
