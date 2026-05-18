/**
 * Zod-validated CRUD helpers.
 *
 * `createTyped`, `getTyped`, `queryTyped`, `updateTyped`, and `upsertTyped`
 * each run the same SurrealQL as their `*Record` counterpart in `./crud.ts`,
 * then `.parse()` every returned row through the supplied Zod schema — so the
 * result is validated at runtime, not merely cast to the expected type.
 *
 * Reach for these when the row shape is untrusted: external input, possible
 * schema drift, or a database you have not verified. When the shape is
 * trusted, the `*Record` helpers in `./crud.ts` skip the validation pass and
 * carry no runtime overhead — that is the only difference between the two
 * surfaces.
 */

import type { Surreal } from 'surrealdb'
import type { z } from 'zod'
import { intoSurQlError } from '../utils/surrealError.ts'
import { escapeTable, quoteValue } from './helpers.ts'

/**
 * Create a record and validate the result with a Zod schema
 */
export async function createTyped<T>(
  db: Surreal,
  table: string,
  data: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  const tableName = escapeTable(table)
  try {
    const entries = Object.entries(data)
    const setClauses = entries.map(([k, v]) => `${k} = ${quoteValue(v)}`).join(', ')
    const sql = `CREATE ${tableName} SET ${setClauses}`
    const results = await db.query<Record<string, unknown>[]>(sql) as unknown as Record<string, unknown>[][]
    const raw = results[0]?.[0]
    if (!raw) throw new Error('Create returned no results')
    return schema.parse(raw)
  } catch (e) {
    throw intoSurQlError('createTyped failed:', e)
  }
}

/**
 * Get a record by ID and validate with a Zod schema
 */
export async function getTyped<T>(
  db: Surreal,
  table: string,
  id: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const tableName = escapeTable(table)
  try {
    const sql = `SELECT * FROM ${tableName}:${id}`
    const results = await db.query<Record<string, unknown>[]>(sql) as unknown as Record<string, unknown>[][]
    const raw = results[0]?.[0]
    if (!raw) return null
    return schema.parse(raw)
  } catch (e) {
    throw intoSurQlError('getTyped failed:', e)
  }
}

/**
 * Query records and validate with a Zod schema
 */
export async function queryTyped<T>(
  db: Surreal,
  table: string,
  conditions: string | null,
  schema: z.ZodType<T>,
): Promise<T[]> {
  const tableName = escapeTable(table)
  try {
    let sql = `SELECT * FROM ${tableName}`
    if (conditions) sql += ` WHERE ${conditions}`
    const results = await db.query<Record<string, unknown>[]>(sql) as unknown as Record<string, unknown>[][]
    const raw = results[0] || []
    return raw.map((r) => schema.parse(r))
  } catch (e) {
    throw intoSurQlError('queryTyped failed:', e)
  }
}

/**
 * Update a record and validate with a Zod schema
 */
export async function updateTyped<T>(
  db: Surreal,
  table: string,
  id: string,
  data: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  const tableName = escapeTable(table)
  try {
    const entries = Object.entries(data)
    const setClauses = entries.map(([k, v]) => `${k} = ${quoteValue(v)}`).join(', ')
    const sql = `UPDATE ${tableName}:${id} SET ${setClauses}`
    const results = await db.query<Record<string, unknown>[]>(sql) as unknown as Record<string, unknown>[][]
    const raw = results[0]?.[0]
    if (!raw) throw new Error('Update returned no results')
    return schema.parse(raw)
  } catch (e) {
    throw intoSurQlError('updateTyped failed:', e)
  }
}

/**
 * Upsert a record and validate with a Zod schema
 */
export async function upsertTyped<T>(
  db: Surreal,
  table: string,
  data: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  const tableName = escapeTable(table)
  try {
    const entries = Object.entries(data)
    const setClauses = entries.map(([k, v]) => `${k} = ${quoteValue(v)}`).join(', ')
    const sql = `UPSERT ${tableName} SET ${setClauses}`
    const results = await db.query<Record<string, unknown>[]>(sql) as unknown as Record<string, unknown>[][]
    const raw = results[0]?.[0]
    if (!raw) throw new Error('Upsert returned no results')
    return schema.parse(raw)
  } catch (e) {
    throw intoSurQlError('upsertTyped failed:', e)
  }
}
