/**
 * Cache backend interface
 */
export interface CacheBackend {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttl?: number): Promise<void>
  delete(key: string): Promise<boolean>
  clear(): Promise<void>
  has(key: string): Promise<boolean>
  size(): Promise<number>
}

/**
 * Cache entry with expiration tracking
 */
interface CacheEntry<T> {
  value: T
  expiresAt: number
}

/**
 * In-memory LRU cache implementation
 */
export class MemoryCache implements CacheBackend {
  private readonly cache: Map<string, CacheEntry<unknown>> = new Map()
  private readonly maxSize: number
  private readonly defaultTtl: number
  private _evictions = 0

  constructor(maxSize: number = 1000, defaultTtl: number = 300_000) {
    this.maxSize = maxSize
    this.defaultTtl = defaultTtl
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key)
    if (!entry) return null

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }

    // Move to end for LRU
    this.cache.delete(key)
    this.cache.set(key, entry)

    return entry.value as T
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    // Evict if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
        this._evictions++
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttl ?? this.defaultTtl),
    })
  }

  async delete(key: string): Promise<boolean> {
    return this.cache.delete(key)
  }

  async clear(): Promise<void> {
    this.cache.clear()
  }

  async has(key: string): Promise<boolean> {
    const entry = this.cache.get(key)
    if (!entry) return false
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return false
    }
    return true
  }

  async size(): Promise<number> {
    return this.cache.size
  }

  get evictions(): number {
    return this._evictions
  }
}
