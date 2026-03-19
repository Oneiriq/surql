import type { CacheBackend } from './backends.ts'
import { MemoryCache } from './backends.ts'
import type { CacheConfig, CacheOptions, CacheStats } from './config.ts'
import { createCacheStats, DEFAULT_CACHE_CONFIG } from './config.ts'

/**
 * High-level cache manager with table-based invalidation
 */
export class CacheManager {
  private readonly backend: CacheBackend
  private readonly config: CacheConfig
  private _hits = 0
  private _misses = 0

  constructor(backend?: CacheBackend, config?: Partial<CacheConfig>) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config }
    this.backend = backend ?? new MemoryCache(this.config.maxSize, this.config.defaultTtl)
  }

  private buildKey(key: string): string {
    return `${this.config.keyPrefix}${key}`
  }

  /**
   * Get a cached value
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.config.enabled) return null
    const result = await this.backend.get<T>(this.buildKey(key))
    if (result !== null) {
      this._hits++
    } else {
      this._misses++
    }
    return result
  }

  /**
   * Set a cached value
   */
  async set<T>(key: string, value: T, options?: CacheOptions): Promise<void> {
    if (!this.config.enabled) return
    const ttl = options?.ttl ?? this.config.defaultTtl
    await this.backend.set(this.buildKey(key), value, ttl)
  }

  /**
   * Get or set: return cached value, or compute and cache it
   */
  async getOrSet<T>(key: string, compute: () => Promise<T>, options?: CacheOptions): Promise<T> {
    const cached = await this.get<T>(key)
    if (cached !== null) return cached

    const value = await compute()
    await this.set(key, value, options)
    return value
  }

  /**
   * Invalidate entries matching a pattern (table-based)
   */
  async invalidate(pattern: string): Promise<void> {
    const key = this.buildKey(pattern)
    await this.backend.delete(key)
  }

  /**
   * Clear all cached entries
   */
  async clear(): Promise<void> {
    await this.backend.clear()
    this._hits = 0
    this._misses = 0
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    const size = await this.backend.size()
    const evictions = this.backend instanceof MemoryCache ? this.backend.evictions : 0
    return createCacheStats(this._hits, this._misses, size, evictions)
  }

  /**
   * Close the cache and release resources
   */
  async close(): Promise<void> {
    await this.backend.clear()
  }
}

let _globalCacheManager: CacheManager | null = null

/** Configure and get the global cache manager */
export function configureCacheManager(config?: Partial<CacheConfig>, backend?: CacheBackend): CacheManager {
  _globalCacheManager = new CacheManager(backend, config)
  return _globalCacheManager
}

/** Get the global cache manager */
export function getCacheManager(): CacheManager {
  if (!_globalCacheManager) {
    _globalCacheManager = new CacheManager()
  }
  return _globalCacheManager
}

/** Invalidate global cache entries */
export async function invalidateCache(pattern: string): Promise<void> {
  if (_globalCacheManager) await _globalCacheManager.invalidate(pattern)
}

/** Clear the global cache */
export async function clearCache(): Promise<void> {
  if (_globalCacheManager) await _globalCacheManager.clear()
}

/** Close the global cache */
export async function closeCache(): Promise<void> {
  if (_globalCacheManager) {
    await _globalCacheManager.close()
    _globalCacheManager = null
  }
}

/**
 * Decorator-style wrapper for caching query results
 */
export function cacheQuery<T>(
  key: string,
  fn: () => Promise<T>,
  options?: CacheOptions,
): Promise<T> {
  return getCacheManager().getOrSet(key, fn, options)
}

/**
 * Generate a cache key from a query string and params
 */
export function cacheKeyFor(query: string, params?: Record<string, unknown>): string {
  const paramStr = params ? JSON.stringify(params) : ''
  return `q:${query}:${paramStr}`
}

/**
 * Check if a key is currently cached in the global cache
 */
export async function isCached(key: string): Promise<boolean> {
  const mgr = getCacheManager()
  const result = await mgr.get(key)
  return result !== null
}
