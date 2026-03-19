import type { Surreal } from 'surrealdb'
import { intoSurQlError } from '../utils/surrealError.ts'
import { escapeTable, quoteValue, validateIdentifier } from './helpers.ts'

/**
 * Batch insert multiple records into a table
 */
export async function insertMany<T = Record<string, unknown>>(
  db: Surreal,
  table: string,
  items: Record<string, unknown>[],
): Promise<T[]> {
  if (items.length === 0) return []
  const tableName = escapeTable(table)

  try {
    const values = items.map((item) => {
      const entries = Object.entries(item)
      return `{ ${entries.map(([k, v]) => `${k}: ${quoteValue(v)}`).join(', ')} }`
    }).join(', ')

    const sql = `INSERT INTO ${tableName} [${values}]`
    const results = await db.query<T[]>(sql) as unknown as T[][]
    return results[0] || ([] as T[])
  } catch (e) {
    throw intoSurQlError('Batch insert failed:', e)
  }
}

/**
 * Batch upsert multiple records
 */
export async function upsertMany<T = Record<string, unknown>>(
  db: Surreal,
  table: string,
  items: Record<string, unknown>[],
): Promise<T[]> {
  if (items.length === 0) return []
  const tableName = escapeTable(table)

  try {
    const results: T[] = []
    for (const item of items) {
      const entries = Object.entries(item)
      const setClauses = entries.map(([k, v]) => `${k} = ${quoteValue(v)}`).join(', ')
      const sql = `UPSERT ${tableName} SET ${setClauses}`
      const res = await db.query<T[]>(sql) as unknown as T[][]
      if (res[0]?.length) results.push(...res[0])
    }
    return results
  } catch (e) {
    throw intoSurQlError('Batch upsert failed:', e)
  }
}

/**
 * Batch delete records matching conditions
 */
export async function deleteMany(
  db: Surreal,
  table: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return
  const tableName = escapeTable(table)

  try {
    for (const id of ids) {
      await db.query(`DELETE ${tableName}:${id}`)
    }
  } catch (e) {
    throw intoSurQlError('Batch delete failed:', e)
  }
}

/**
 * Batch create relations
 */
export async function relateMany<T = Record<string, unknown>>(
  db: Surreal,
  relations: Array<{
    from: string
    edge: string
    to: string
    data?: Record<string, unknown>
  }>,
): Promise<T[]> {
  if (relations.length === 0) return []

  try {
    const results: T[] = []
    for (const rel of relations) {
      let sql = `RELATE ${rel.from}->${rel.edge}->${rel.to}`
      if (rel.data && Object.keys(rel.data).length > 0) {
        const setClauses = Object.entries(rel.data).map(([k, v]) => `${k} = ${quoteValue(v)}`).join(', ')
        sql += ` SET ${setClauses}`
      }
      const res = await db.query<T[]>(sql) as unknown as T[][]
      if (res[0]?.length) results.push(...res[0])
    }
    return results
  } catch (e) {
    throw intoSurQlError('Batch relate failed:', e)
  }
}

/**
 * Build a SurrealQL UPSERT query string without executing it.
 * Useful for previewing or logging the query before execution.
 */
export function buildUpsertQuery(
  table: string,
  items: Record<string, unknown>[],
  conflictFields?: string[],
): string {
  if (items.length === 0) return ''

  validateIdentifier(table)
  if (conflictFields) {
    for (const f of conflictFields) validateIdentifier(f)
  }

  const itemsArray = items.map((item) => {
    const entries = Object.entries(item)
    return `{ ${entries.map(([k, v]) => `${k}: ${quoteValue(v)}`).join(', ')} }`
  }).join(', ')

  if (conflictFields && conflictFields.length > 0) {
    const conditions = conflictFields.map((f) => `${f} = $item.${f}`).join(' AND ')
    return `UPSERT INTO ${table} [${itemsArray}] WHERE ${conditions};`
  }

  return `UPSERT INTO ${table} [${itemsArray}];`
}

/**
 * Build a SurrealQL RELATE query string without executing it.
 * Useful for previewing or logging the query before execution.
 */
export function buildRelateQuery(
  fromId: string,
  edge: string,
  toId: string,
  data?: Record<string, unknown>,
): string {
  validateIdentifier(edge)

  let stmt = `RELATE ${fromId}->${edge}->${toId}`

  if (data && Object.keys(data).length > 0) {
    const setParts = Object.entries(data).map(([k, v]) => {
      validateIdentifier(k)
      return `${k} = ${quoteValue(v)}`
    })
    stmt += ` SET ${setParts.join(', ')}`
  }

  return stmt + ';'
}
