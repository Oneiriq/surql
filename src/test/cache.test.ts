import { assertEquals } from '@std/assert'
import { afterEach, describe, it } from '@std/testing/bdd'
import {
  cacheKeyFor,
  CacheManager,
  clearCache,
  configureCacheManager,
  getCacheManager,
  MemoryCache,
} from '../cache/mod.ts'

describe('Cache System', () => {
  afterEach(async () => {
    await clearCache()
  })

  describe('MemoryCache', () => {
    it('should store and retrieve values', async () => {
      const cache = new MemoryCache()
      await cache.set('key1', 'value1')
      assertEquals(await cache.get('key1'), 'value1')
    })

    it('should return null for missing keys', async () => {
      const cache = new MemoryCache()
      assertEquals(await cache.get('missing'), null)
    })

    it('should delete keys', async () => {
      const cache = new MemoryCache()
      await cache.set('key1', 'value1')
      await cache.delete('key1')
      assertEquals(await cache.get('key1'), null)
    })

    it('should clear all entries', async () => {
      const cache = new MemoryCache()
      await cache.set('a', 1)
      await cache.set('b', 2)
      await cache.clear()
      assertEquals(await cache.size(), 0)
    })

    it('should check existence', async () => {
      const cache = new MemoryCache()
      await cache.set('key1', 'value1')
      assertEquals(await cache.has('key1'), true)
      assertEquals(await cache.has('missing'), false)
    })

    it('should expire entries', async () => {
      const cache = new MemoryCache(100, 1) // 1ms TTL
      await cache.set('key1', 'value1')
      await new Promise((r) => setTimeout(r, 10))
      assertEquals(await cache.get('key1'), null)
    })

    it('should evict LRU entries when at capacity', async () => {
      const cache = new MemoryCache(2, 60_000)
      await cache.set('a', 1)
      await cache.set('b', 2)
      await cache.set('c', 3)
      assertEquals(await cache.get('a'), null)
      assertEquals(await cache.get('b'), 2)
      assertEquals(await cache.get('c'), 3)
    })
  })

  describe('CacheManager', () => {
    it('should get and set values', async () => {
      const mgr = new CacheManager()
      await mgr.set('test', { data: true })
      assertEquals(await mgr.get('test'), { data: true })
    })

    it('should compute and cache with getOrSet', async () => {
      const mgr = new CacheManager()
      let computeCount = 0
      const compute = async () => {
        computeCount++
        return 42
      }
      assertEquals(await mgr.getOrSet('key', compute), 42)
      assertEquals(await mgr.getOrSet('key', compute), 42)
      assertEquals(computeCount, 1)
    })

    it('should track stats', async () => {
      const mgr = new CacheManager()
      await mgr.set('key', 'value')
      await mgr.get('key')
      await mgr.get('missing')
      const stats = await mgr.getStats()
      assertEquals(stats.hits, 1)
      assertEquals(stats.misses, 1)
    })

    it('should respect disabled config', async () => {
      const mgr = new CacheManager(undefined, { enabled: false })
      await mgr.set('key', 'value')
      assertEquals(await mgr.get('key'), null)
    })
  })

  describe('Global cache', () => {
    it('should configure and get global manager', () => {
      configureCacheManager({ maxSize: 500 })
      const mgr = getCacheManager()
      assertEquals(mgr instanceof CacheManager, true)
    })
  })

  describe('cacheKeyFor', () => {
    it('should generate deterministic keys', () => {
      const key1 = cacheKeyFor('SELECT * FROM users', { age: 18 })
      const key2 = cacheKeyFor('SELECT * FROM users', { age: 18 })
      assertEquals(key1, key2)
    })

    it('should differ for different params', () => {
      const key1 = cacheKeyFor('SELECT * FROM users', { age: 18 })
      const key2 = cacheKeyFor('SELECT * FROM users', { age: 21 })
      assertEquals(key1 !== key2, true)
    })
  })
})
