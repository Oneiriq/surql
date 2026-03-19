import { assertEquals } from '@std/assert'
import { afterEach, describe, it } from '@std/testing/bdd'
import {
  cacheKeyFor,
  CacheManager,
  cacheQuery,
  clearCache,
  closeCache,
  configureCacheManager,
  getCacheManager,
  invalidateCache,
  isCached,
} from '../cache/manager.ts'

afterEach(async () => {
  await closeCache()
})

describe('isCached', () => {
  it('should return false for uncached key', async () => {
    assertEquals(await isCached('nonexistent-key'), false)
  })

  it('should return true after setting a value', async () => {
    const mgr = getCacheManager()
    await mgr.set('test-key', 'test-value')
    assertEquals(await isCached('test-key'), true)
  })

  it('should return false after clearing cache', async () => {
    const mgr = getCacheManager()
    await mgr.set('temp-key', 'temp-value')
    await mgr.clear()
    assertEquals(await isCached('temp-key'), false)
  })

  it('should return false after invalidating the key', async () => {
    const mgr = getCacheManager()
    await mgr.set('inv-key', 42)
    assertEquals(await isCached('inv-key'), true)
    await mgr.invalidate('inv-key')
    assertEquals(await isCached('inv-key'), false)
  })
})

describe('CacheManager', () => {
  it('should get and set values', async () => {
    const mgr = new CacheManager()
    await mgr.set('key1', { data: 'hello' })
    const result = await mgr.get<{ data: string }>('key1')
    assertEquals(result?.data, 'hello')
  })

  it('should return null for missing keys', async () => {
    const mgr = new CacheManager()
    assertEquals(await mgr.get('missing'), null)
  })

  it('should clear all entries', async () => {
    const mgr = new CacheManager()
    await mgr.set('a', 1)
    await mgr.set('b', 2)
    await mgr.clear()
    assertEquals(await mgr.get('a'), null)
    assertEquals(await mgr.get('b'), null)
  })

  it('should track hit/miss stats', async () => {
    const mgr = new CacheManager()
    await mgr.set('exists', 'yes')
    await mgr.get('exists') // hit
    await mgr.get('nope') // miss

    const stats = await mgr.getStats()
    assertEquals(stats.hits, 1)
    assertEquals(stats.misses, 1)
  })

  it('should support getOrSet', async () => {
    const mgr = new CacheManager()
    let computeCount = 0
    const compute = async () => {
      computeCount++
      return 'computed'
    }

    const first = await mgr.getOrSet('lazy', compute)
    assertEquals(first, 'computed')
    assertEquals(computeCount, 1)

    const second = await mgr.getOrSet('lazy', compute)
    assertEquals(second, 'computed')
    assertEquals(computeCount, 1) // Should use cached value
  })

  it('should respect disabled config', async () => {
    const mgr = new CacheManager(undefined, { enabled: false })
    await mgr.set('key', 'value')
    assertEquals(await mgr.get('key'), null)
  })
})

describe('cacheKeyFor', () => {
  it('should generate key from query string', () => {
    const key = cacheKeyFor('SELECT * FROM users')
    assertEquals(key.includes('SELECT * FROM users'), true)
    assertEquals(key.startsWith('q:'), true)
  })

  it('should include params in key', () => {
    const key = cacheKeyFor('SELECT * FROM users WHERE id = $id', { id: '123' })
    assertEquals(key.includes('123'), true)
  })

  it('should generate different keys for different params', () => {
    const key1 = cacheKeyFor('SELECT * FROM users', { id: '1' })
    const key2 = cacheKeyFor('SELECT * FROM users', { id: '2' })
    assertEquals(key1 !== key2, true)
  })

  it('should handle no params', () => {
    const key = cacheKeyFor('SELECT 1')
    assertEquals(key, 'q:SELECT 1:')
  })
})

describe('cacheQuery', () => {
  it('should cache and return computed value', async () => {
    configureCacheManager()
    let called = 0
    const fn = async () => {
      called++
      return [{ id: 1 }]
    }

    const result1 = await cacheQuery('test-q', fn)
    assertEquals(result1, [{ id: 1 }])
    assertEquals(called, 1)

    const result2 = await cacheQuery('test-q', fn)
    assertEquals(result2, [{ id: 1 }])
    assertEquals(called, 1)
  })
})

describe('global cache functions', () => {
  it('should invalidate cache entries', async () => {
    configureCacheManager()
    const mgr = getCacheManager()
    await mgr.set('to-invalidate', 'value')
    await invalidateCache('to-invalidate')
    assertEquals(await mgr.get('to-invalidate'), null)
  })

  it('should clear all cache entries', async () => {
    configureCacheManager()
    const mgr = getCacheManager()
    await mgr.set('clear-me', 'value')
    await clearCache()
    assertEquals(await mgr.get('clear-me'), null)
  })

  it('should close cache manager', async () => {
    configureCacheManager()
    await closeCache()
    // After close, getCacheManager creates a fresh one
    const mgr = getCacheManager()
    assertEquals(await mgr.get('anything'), null)
  })
})
