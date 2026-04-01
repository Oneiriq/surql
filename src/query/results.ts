/**
 * Generic query result wrapper with execution metadata
 */
export interface QueryResult<T = unknown> {
  readonly data: T
  readonly time: string | null
  readonly status: string
}

/**
 * Create a successful query result
 */
export function success<T>(data: T, time: string | null = null): QueryResult<T> {
  return Object.freeze({ data, time, status: 'OK' })
}

/**
 * Page metadata for paginated results
 */
export interface PageInfo {
  readonly total: number
  readonly limit: number
  readonly offset: number
  readonly hasMore: boolean
}

/**
 * Single record result wrapper
 */
export interface RecordResult<T> {
  readonly data: T | null
  readonly ok: boolean
  unwrap(): T
  unwrapOr(fallback: T): T
}

/**
 * Multiple records result wrapper
 */
export interface ListResult<T> {
  readonly records: readonly T[]
  readonly total: number
  readonly limit: number
  readonly offset: number
  readonly hasMore: boolean
  first(): T | null
  last(): T | null
  getPage(page: number, pageSize: number): T[]
}

/**
 * Count result wrapper
 */
export interface CountResult {
  readonly count: number
}

/**
 * Aggregate result wrapper
 */
export interface AggregateResult {
  readonly value: number
  readonly label: string
}

/**
 * Paginated result wrapper
 */
export interface PaginatedResult<T> {
  readonly records: readonly T[]
  readonly page: PageInfo
}

/**
 * Create a successful single-record result
 */
export function record<T>(data: T): RecordResult<T> {
  return Object.freeze({
    data,
    ok: true,
    unwrap(): T {
      return data
    },
    unwrapOr(_fallback: T): T {
      return data
    },
  })
}

/**
 * Create an empty single-record result
 */
export function emptyRecord<T>(): RecordResult<T> {
  return Object.freeze({
    data: null,
    ok: false,
    unwrap(): T {
      throw new Error('Cannot unwrap empty result')
    },
    unwrapOr(fallback: T): T {
      return fallback
    },
  })
}

/**
 * Wrap multiple records into a ListResult
 */
export function records<T>(
  items: T[],
  options: { total?: number; limit?: number; offset?: number } = {},
): ListResult<T> {
  const total = options.total ?? items.length
  const limit = options.limit ?? items.length
  const offset = options.offset ?? 0
  const hasMore = offset + items.length < total

  return Object.freeze({
    records: Object.freeze([...items]),
    total,
    limit,
    offset,
    hasMore,
    first(): T | null {
      return items.length > 0 ? items[0] : null
    },
    last(): T | null {
      return items.length > 0 ? items[items.length - 1] : null
    },
    getPage(page: number, pageSize: number): T[] {
      const start = page * pageSize
      return items.slice(start, start + pageSize)
    },
  })
}

/**
 * Create a count result
 */
export function countResult(count: number): CountResult {
  return Object.freeze({ count })
}

/**
 * Create an aggregate result
 */
export function aggregate(value: number, label: string): AggregateResult {
  return Object.freeze({ value, label })
}

/**
 * Create a paginated result
 */
export function paginated<T>(
  items: T[],
  pageInfo: PageInfo,
): PaginatedResult<T> {
  return Object.freeze({
    records: Object.freeze([...items]),
    page: Object.freeze(pageInfo),
  })
}

/**
 * Extract results from a raw SurrealDB response
 */
export function extractResult<T>(raw: unknown): T[] {
  if (!raw) return []
  if (Array.isArray(raw) && raw.length === 1 && Array.isArray(raw[0])) {
    return raw[0] as T[]
  }
  if (Array.isArray(raw)) return raw as T[]
  return [raw as T]
}

/**
 * Extract a single item from results
 */
export function extractOne<T>(raw: unknown): T | null {
  const items = extractResult<T>(raw)
  return items.length > 0 ? items[0] : null
}

/**
 * Extract a scalar value from results.
 * When `key` is provided, extracts that specific field.
 * When `defaultValue` is provided, returns it instead of null on missing data.
 *
 * @param raw - Raw SurrealDB response
 * @param key - Optional field key to extract
 * @param defaultValue - Optional fallback value when result is missing
 */
export function extractScalar<T>(raw: unknown, key?: string, defaultValue?: T): T | null {
  const item = extractOne<Record<string, unknown>>(raw)
  if (!item) return defaultValue ?? null
  if (key !== undefined) {
    const val = item[key]
    return val !== undefined ? (val as T) : (defaultValue ?? null)
  }
  const values = Object.values(item)
  return values.length > 0 ? (values[0] as T) : (defaultValue ?? null)
}

/**
 * Check if results contain any data
 */
export function hasResults(raw: unknown): boolean {
  return extractResult(raw).length > 0
}
