/**
 * Cache configuration
 */
export interface CacheConfig {
  readonly enabled: boolean
  readonly defaultTtl: number
  readonly maxSize: number
  readonly keyPrefix: string
}

/**
 * Per-query cache options
 */
export interface CacheOptions {
  readonly ttl?: number
  readonly key?: string
  readonly invalidateOn?: string[]
}

/**
 * Cache statistics
 */
export interface CacheStats {
  readonly hits: number
  readonly misses: number
  readonly size: number
  readonly evictions: number
  hitRatio(): number
}

/**
 * Default cache configuration
 */
export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  enabled: true,
  defaultTtl: 300_000,
  maxSize: 1000,
  keyPrefix: 'surql:',
}

/**
 * Create cache stats
 */
export function createCacheStats(hits: number, misses: number, size: number, evictions: number): CacheStats {
  return {
    hits,
    misses,
    size,
    evictions,
    hitRatio(): number {
      const total = this.hits + this.misses
      return total === 0 ? 0 : this.hits / total
    },
  }
}
