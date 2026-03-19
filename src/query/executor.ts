import type { Surreal } from 'surrealdb'
import type { ZodType } from 'zod'
import { intoSurQlError } from '../utils/surrealError.ts'
import type { Query } from './builder.ts'
import {
  emptyRecord,
  extractOne,
  extractResult,
  type ListResult,
  record,
  type RecordResult,
  records,
} from './results.ts'

/**
 * Execute a Query and return raw results
 */
export async function executeQuery<T = Record<string, unknown>>(
  db: Surreal,
  query: Query<T>,
  params?: Record<string, unknown>,
): Promise<T[]> {
  try {
    const sql = query.toSurQL()
    const results = await db.query<T[]>(sql, params) as unknown as T[][]
    return results[0] || ([] as T[])
  } catch (e) {
    throw intoSurQlError('Query execution failed:', e)
  }
}

/**
 * Execute a raw SurrealQL string
 */
export async function executeRaw<T = Record<string, unknown>>(
  db: Surreal,
  sql: string,
  params?: Record<string, unknown>,
): Promise<T[]> {
  try {
    const results = await db.query<T[]>(sql, params) as unknown as T[][]
    return results[0] || ([] as T[])
  } catch (e) {
    throw intoSurQlError('Raw query execution failed:', e)
  }
}

/**
 * Execute and return a single result
 */
export async function fetchOne<T = Record<string, unknown>>(
  db: Surreal,
  query: Query<T>,
  params?: Record<string, unknown>,
): Promise<T | null> {
  const results = await executeQuery<T>(db, query, params)
  return extractOne<T>(results)
}

/**
 * Execute and return all results
 */
export async function fetchAll<T = Record<string, unknown>>(
  db: Surreal,
  query: Query<T>,
  params?: Record<string, unknown>,
): Promise<T[]> {
  return executeQuery<T>(db, query, params)
}

/**
 * Execute and return a paginated ListResult
 */
export async function fetchMany<T = Record<string, unknown>>(
  db: Surreal,
  query: Query<T>,
  params?: Record<string, unknown>,
  options?: { total?: number; limit?: number; offset?: number },
): Promise<ListResult<T>> {
  const results = await executeQuery<T>(db, query, params)
  return records(results, options)
}

/**
 * Execute and return a RecordResult wrapper
 */
export async function fetchRecord<T = Record<string, unknown>>(
  db: Surreal,
  query: Query<T>,
  params?: Record<string, unknown>,
): Promise<RecordResult<T>> {
  const item = await fetchOne<T>(db, query, params)
  return item !== null ? record(item) : emptyRecord<T>()
}

/**
 * Execute raw SurrealQL with Zod schema validation on results
 */
export async function executeRawTyped<T>(
  db: Surreal,
  sql: string,
  schema: ZodType<T>,
  params?: Record<string, unknown>,
): Promise<T[]> {
  const rawResults = await executeRaw(db, sql, params)
  if (!rawResults || rawResults.length === 0) return []
  return rawResults.map((item) => schema.parse(item))
}

/**
 * Execute and return extracted results
 */
export async function fetchRecords<T = Record<string, unknown>>(
  db: Surreal,
  query: Query<T>,
  params?: Record<string, unknown>,
): Promise<T[]> {
  const raw = await executeQuery(db, query, params)
  return extractResult<T>(raw)
}
