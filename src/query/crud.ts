import type { Surreal } from 'surrealdb'
import { intoSurQlError } from '../utils/surrealError.ts'
import { escapeTable, quoteValue, validateIdentifier } from './helpers.ts'
import { extractResult, type ListResult, records } from './results.ts'
import { resolveRecordTarget, type SurrealFnValue } from '../types/surqlFn.ts'
import type { Expression } from './expressions.ts'

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
 * Resolve a CRUD target from either `(table, id)` or a `SurrealFnValue`
 * produced by `typeRecord(table, id)`. Returns `table:id` ready to splice
 * into a SurrealQL statement.
 */
function resolveTarget(tableOrRef: string | SurrealFnValue, id?: string): string {
  if (typeof tableOrRef === 'string') {
    const tableName = escapeTable(tableOrRef)
    return id !== undefined ? `${tableName}:${id}` : tableName
  }
  return resolveRecordTarget(tableOrRef)
}

/**
 * Get a record by ID.
 *
 * Accepts either the traditional `(db, table, id)` form or a `typeRecord()`
 * reference via `(db, ref)`.
 */
export async function getRecord<T = Record<string, unknown>>(
  db: Surreal,
  table: string,
  id: string,
): Promise<T | null>
export async function getRecord<T = Record<string, unknown>>(
  db: Surreal,
  ref: SurrealFnValue,
): Promise<T | null>
export async function getRecord<T = Record<string, unknown>>(
  db: Surreal,
  tableOrRef: string | SurrealFnValue,
  id?: string,
): Promise<T | null> {
  try {
    const target = resolveTarget(tableOrRef, id)
    const sql = `SELECT * FROM ${target}`
    const results = await db.query<T[]>(sql) as unknown as T[][]
    return results[0]?.[0] ?? null
  } catch (e) {
    throw intoSurQlError('getRecord failed:', e)
  }
}

/**
 * Update a record.
 *
 * Accepts either `(db, table, id, data)` or `(db, ref, data)` where `ref`
 * is produced by `typeRecord()`.
 */
export async function updateRecord<T = Record<string, unknown>>(
  db: Surreal,
  table: string,
  id: string,
  data: Record<string, unknown>,
): Promise<T>
export async function updateRecord<T = Record<string, unknown>>(
  db: Surreal,
  ref: SurrealFnValue,
  data: Record<string, unknown>,
): Promise<T>
export async function updateRecord<T = Record<string, unknown>>(
  db: Surreal,
  tableOrRef: string | SurrealFnValue,
  idOrData: string | Record<string, unknown>,
  maybeData?: Record<string, unknown>,
): Promise<T> {
  try {
    let target: string
    let data: Record<string, unknown>
    if (typeof tableOrRef === 'string' && typeof idOrData === 'string') {
      target = resolveTarget(tableOrRef, idOrData)
      data = maybeData as Record<string, unknown>
    } else if (typeof tableOrRef !== 'string') {
      target = resolveTarget(tableOrRef)
      data = idOrData as Record<string, unknown>
    } else {
      throw new Error('updateRecord: invalid arguments')
    }
    const entries = Object.entries(data)
    const setClauses = entries.map(([k, v]) => `${k} = ${quoteValue(v)}`).join(', ')
    const sql = `UPDATE ${target} SET ${setClauses}`
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
 * Options for `aggregateRecords()`.
 */
export interface AggregateRecordsOptions<TFields extends Record<string, Expression>> {
  /** Table to aggregate over. */
  table: string
  /** Named SELECT expressions — each key becomes a column alias. */
  select: TFields
  /** GROUP BY field list. Mutually exclusive with `groupAll`. */
  groupBy?: readonly string[]
  /** `GROUP ALL` — aggregate the entire result set into one row. */
  groupAll?: boolean
  /** Optional WHERE predicate (raw SurrealQL string). */
  where?: string
  /** Optional ORDER BY clause. */
  orderBy?: readonly { field: string; direction?: 'ASC' | 'DESC' }[]
  /** Optional LIMIT. */
  limit?: number
  /** Active Surreal client. */
  client: Surreal
}

/**
 * Aggregate rows over a table using named SELECT expressions.
 *
 * Returns an array of row objects keyed by the names in `select`. When
 * `groupAll: true` the array always has exactly one element.
 *
 * @example
 * ```ts
 * import { aggregateRecords, count, mathSum } from '@oneiriq/surql'
 *
 * const counts = await aggregateRecords({
 *   table: 'memory_entry',
 *   select: { count: count(), totalStrength: mathSum('strength') },
 *   groupBy: ['network'],
 *   client: db,
 * })
 * ```
 */
export async function aggregateRecords<TFields extends Record<string, Expression>>(
  options: AggregateRecordsOptions<TFields>,
): Promise<Array<Record<keyof TFields, unknown> & Record<string, unknown>>> {
  const { table, select, groupBy, groupAll, where, orderBy, limit, client } = options
  if (!select || Object.keys(select).length === 0) {
    throw new Error('aggregateRecords: `select` must contain at least one expression')
  }
  if (groupAll && groupBy && groupBy.length > 0) {
    throw new Error('aggregateRecords: `groupAll` and `groupBy` are mutually exclusive')
  }
  const tableName = escapeTable(table)
  try {
    const selectParts: string[] = []
    // Include group-by fields in the projection so callers can read them.
    if (groupBy) {
      for (const f of groupBy) {
        validateIdentifier(f)
        selectParts.push(f)
      }
    }
    for (const [alias, expr] of Object.entries(select)) {
      validateIdentifier(alias)
      selectParts.push(`${expr.toSurQL()} AS ${alias}`)
    }
    let sql = `SELECT ${selectParts.join(', ')} FROM ${tableName}`
    if (where) sql += ` WHERE ${where}`
    if (groupAll) {
      sql += ' GROUP ALL'
    } else if (groupBy && groupBy.length > 0) {
      sql += ` GROUP BY ${groupBy.join(', ')}`
    }
    if (orderBy && orderBy.length > 0) {
      const orders = orderBy.map((o) => `${o.field} ${o.direction ?? 'ASC'}`)
      sql += ` ORDER BY ${orders.join(', ')}`
    }
    if (limit !== undefined) sql += ` LIMIT ${limit}`
    const raw = await client.query(sql)
    return extractResult<Record<keyof TFields, unknown> & Record<string, unknown>>(raw)
  } catch (e) {
    throw intoSurQlError('aggregateRecords failed:', e)
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
