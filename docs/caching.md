# Caching

surql includes a built-in query result cache with TTL-based expiration and manual invalidation.

## Basic Usage

```typescript
import { QueryCache, CacheConfig } from 'jsr:@oneiriq/surql'

const cache = new QueryCache({
  ttl: 60_000,       // 60 second TTL
  maxSize: 1000,     // Max 1000 cached entries
})
```

## Cache with Query Builder

```typescript
const users = await client.query<User>('users')
  .withCache(cache, { ttl: 30_000 })
  .execute()
```

On subsequent calls with the same query parameters, the cached result is returned without hitting the database.

## Cache Keys

Cache keys are derived from the full query string and parameters. Two queries with identical SQL and parameters share the same cache entry.

## Manual Invalidation

```typescript
// Invalidate a specific key
cache.invalidate('users:active')

// Clear the entire cache
cache.clear()
```

## TTL Strategies

```typescript
// Short-lived cache for frequently changing data
const hotCache = new QueryCache({ ttl: 5_000 })

// Long-lived cache for reference data
const coldCache = new QueryCache({ ttl: 3_600_000 })  // 1 hour
```

## Cache Statistics

```typescript
const stats = cache.getStats()
console.log(stats.hits)    // Cache hit count
console.log(stats.misses)  // Cache miss count
console.log(stats.size)    // Current entries in cache
```

## Next Steps

- [Streaming](streaming.md) - Live query subscriptions for real-time data
