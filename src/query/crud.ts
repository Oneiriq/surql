import type { Surreal } from 'surrealdb'
import { intoSurQlError } from '../utils/surrealError.ts'
import { escapeTable, quoteValue } from './helpers.ts'
import { type ListResult, records } from './results.ts'

/**
 * Create a single record
 */
export async function createRecord<T = Record<string, unknown>>(
  db: Surreal,
  table: string,
  data: Record<string, unknown>,
): Promise<T> {
  const tableName = escapeTable(table)
  try {
    const entries = Object.entries(data)
    const setClauses = entries.map(([k, v]) => `${k} = ${quoteValue(v)}`).join(', ')
    const sql = `CREATE ${tableName} SET ${setClauses}`
    const results = await db.query<T[]>(sql) as unknown as T[][]
    const result = results[0]?.[0]
    if (!result) throw new Error('Create returned no result')
    return result
  } catch (e) {
    throw intoSurQlError('createRecord failed:', e)
  }
}

/**
 * Create multiple records
 */
export async function createRecords<T = Record<string, unknown>>(
  db: Surreal,
  table: string,
  items: Record<string, unknown>[],
): Promise<T[]> {
  const tableName = escapeTable(table)
  try {
    const results: T[] = []
    for (const item of items) {
      const entries = Object.entries(item)
      const setClauses = entries.map(([k, v]) => `${k} = ${quoteValue(v)}`).join(', ')
      const sql = `CREATE ${tableName} SET ${setClauses}`
      const res = await db.query<T[]>(sql) as unknown as T[][]
      if (res[0]?.[0]) results.push(res[0][0])
    }
    return results
  } catch (e) {
    throw intoSurQlError('createRecords failed:', e)
  }
}

/**
 * Get a record by ID
 */
export async function getRecord<T = Record<string, unknown>>(
  db: Surreal,
  table: string,
  id: string,
): Promise<T | null> {
  const tableName = escapeTable(table)
  try {
    const sql = `SELECT * FROM ${tableName}:${id}`
    const results = await db.query<T[]>(sql) as unknown as T[][]
    return results[0]?.[0] ?? null
  } catch (e) {
    throw intoSurQlError('getRecord failed:', e)
  }
}

/**
 * Update a record
 */
export async function updateRecord<T = Record<string, unknown>>(
  db: Surreal,
  table: string,
  id: string,
  data: Record<string, unknown>,
): Promise<T> {
  const tableName = escapeTable(table)
  try {
    const entries = Object.entries(data)
    const setClauses = entries.map(([k, v]) => `${k} = ${quoteValue(v)}`).join(', ')
    const sql = `UPDATE ${tableName}:${id} SET ${setClauses}`
    const results = await db.query<T[]>(sql) as unknown as T[][]
    const result = results[0]?.[0]
    if (!result) throw new Error('Update returned no result')
    return result
  } catch (e) {
    throw intoSurQlError('updateRecord failed:', e)
  }
}

/**
 * Merge (partial update) a record
 */
export async function mergeRecord<T = Record<string, unknown>>(
  db: Surreal,
  table: string,
  id: string,
  data: Record<string, unknown>,
): Promise<T> {
  const tableName = escapeTable(table)
  try {
    const sql = `UPDATE ${tableName}:${id} MERGE ${JSON.stringify(data)}`
    const results = await db.query<T[]>(sql) as unknown as T[][]
    const result = results[0]?.[0]
    if (!result) throw new Error('Merge returned no result')
    return result
  } catch (e) {
    throw intoSurQlError('mergeRecord failed:', e)
  }
}

/**
 * Upsert a record
 */
export async function upsertRecord<T = Record<string, unknown>>(
  db: Surreal,
  table: string,
  data: Record<string, unknown>,
): Promise<T> {
  const tableName = escapeTable(table)
  try {
    const entries = Object.entries(data)
    const setClauses = entries.map(([k, v]) => `${k} = ${quoteValue(v)}`).join(', ')
    const sql = `UPSERT ${tableName} SET ${setClauses}`
    const results = await db.query<T[]>(sql) as unknown as T[][]
    const result = results[0]?.[0]
    if (!result) throw new Error('Upsert returned no result')
    return result
  } catch (e) {
    throw intoSurQlError('upsertRecord failed:', e)
  }
}

/**
 * Delete a single record
 */
export async function deleteRecord(
  db: Surreal,
  table: string,
  id: string,
): Promise<void> {
  const tableName = escapeTable(table)
  try {
    await db.query(`DELETE ${tableName}:${id}`)
  } catch (e) {
    throw intoSurQlError('deleteRecord failed:', e)
  }
}

/**
 * Delete multiple records
 */
export async function deleteRecords(
  db: Surreal,
  table: string,
  ids: string[],
): Promise<void> {
  const tableName = escapeTable(table)
  try {
    for (const id of ids) {
      await db.query(`DELETE ${tableName}:${id}`)
    }
  } catch (e) {
    throw intoSurQlError('deleteRecords failed:', e)
  }
}

/**
 * Query records with an optional WHERE condition
 */
export async function queryRecords<T = Record<string, unknown>>(
  db: Surreal,
  table: string,
  conditions?: string,
): Promise<T[]> {
  const tableName = escapeTable(table)
  try {
    let sql = `SELECT * FROM ${tableName}`
    if (conditions) sql += ` WHERE ${conditions}`
    const results = await db.query<T[]>(sql) as unknown as T[][]
    return results[0] || ([] as T[])
  } catch (e) {
    throw intoSurQlError('queryRecords failed:', e)
  }
}

/**
 * Count records in a table
 */
export async function countRecords(
  db: Surreal,
  table: string,
  conditions?: string,
): Promise<number> {
  const tableName = escapeTable(table)
  try {
    let sql = `SELECT count() AS total FROM ${tableName}`
    if (conditions) sql += ` WHERE ${conditions}`
    sql += ' GROUP ALL'
    const results = await db.query<{ total: number }[]>(sql) as unknown as { total: number }[][]
    return results[0]?.[0]?.total ?? 0
  } catch (e) {
    throw intoSurQlError('countRecords failed:', e)
  }
}

/**
 * Check if a record exists
 */
export async function exists(
  db: Surreal,
  table: string,
  id: string,
): Promise<boolean> {
  const result = await getRecord(db, table, id)
  return result !== null
}

/**
 * Get the first record from a table
 */
export async function first<T = Record<string, unknown>>(
  db: Surreal,
  table: string,
  conditions?: string,
): Promise<T | null> {
  const tableName = escapeTable(table)
  try {
    let sql = `SELECT * FROM ${tableName}`
    if (conditions) sql += ` WHERE ${conditions}`
    sql += ' LIMIT 1'
    const results = await db.query<T[]>(sql) as unknown as T[][]
    return results[0]?.[0] ?? null
  } catch (e) {
    throw intoSurQlError('first failed:', e)
  }
}

/**
 * Get the last record from a table (by id DESC)
 */
export async function last<T = Record<string, unknown>>(
  db: Surreal,
  table: string,
  conditions?: string,
): Promise<T | null> {
  const tableName = escapeTable(table)
  try {
    let sql = `SELECT * FROM ${tableName}`
    if (conditions) sql += ` WHERE ${conditions}`
    sql += ' ORDER BY id DESC LIMIT 1'
    const results = await db.query<T[]>(sql) as unknown as T[][]
    return results[0]?.[0] ?? null
  } catch (e) {
    throw intoSurQlError('last failed:', e)
  }
}

/**
 * Query records and return wrapped ListResult
 */
export async function queryRecordsWrapped<T = Record<string, unknown>>(
  db: Surreal,
  table: string,
  options?: {
    conditions?: string
    orderBy?: { field: string; direction: 'ASC' | 'DESC' }
    limit?: number
    offset?: number
  },
): Promise<ListResult<T>> {
  const tableName = escapeTable(table)
  try {
    let sql = `SELECT * FROM ${tableName}`
    if (options?.conditions) sql += ` WHERE ${options.conditions}`
    if (options?.orderBy) sql += ` ORDER BY ${options.orderBy.field} ${options.orderBy.direction}`
    if (options?.limit != null) sql += ` LIMIT ${options.limit}`
    if (options?.offset != null) sql += ` START ${options.offset}`
    const results = await db.query<T[]>(sql) as unknown as T[][]
    const items = results[0] || ([] as T[])
    return records(items, { limit: options?.limit, offset: options?.offset })
  } catch (e) {
    throw intoSurQlError('queryRecordsWrapped failed:', e)
  }
}
