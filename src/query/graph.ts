import type { Surreal } from 'surrealdb'
import { intoSurQlError } from '../utils/surrealError.ts'
import { quoteValue, validateIdentifier } from './helpers.ts'

/**
 * Render an optional `WHERE` clause for a graph query.
 *
 * Returns the clause with a leading space, or an empty string when no
 * condition is supplied, so callers can append it unconditionally. The
 * condition is a raw SurrealQL predicate — the same shape `queryRecords`
 * accepts.
 */
function whereClause(conditions?: string): string {
  return conditions ? ` WHERE ${conditions}` : ''
}

/**
 * Traverse a graph path from a starting record.
 *
 * Pass `conditions` (a raw SurrealQL predicate) to filter the traversed
 * records — e.g. multi-tenant isolation or excluding archived rows. Without
 * it the traversal is unfiltered, as before.
 */
export async function traverse<T = Record<string, unknown>>(
  db: Surreal,
  start: string,
  path: string,
  conditions?: string,
): Promise<T[]> {
  try {
    const sql = `SELECT * FROM ${start}.${path}${whereClause(conditions)}`
    const results = await db.query<T[]>(sql) as unknown as T[][]
    return results[0] || ([] as T[])
  } catch (e) {
    throw intoSurQlError('Graph traversal failed:', e)
  }
}

/**
 * Traverse with explicit depth control.
 *
 * Pass `conditions` (a raw SurrealQL predicate) to filter the traversed
 * records.
 */
export async function traverseWithDepth<T = Record<string, unknown>>(
  db: Surreal,
  start: string,
  edgeTable: string,
  direction: '->' | '<-' | '<->',
  depth?: number,
  conditions?: string,
): Promise<T[]> {
  try {
    const hops = depth ?? 1
    const path = Array.from({ length: hops }, () => `${direction}${edgeTable}`).join('')
    const sql = `SELECT * FROM ${start}${path}.*${whereClause(conditions)}`
    const results = await db.query<T[]>(sql) as unknown as T[][]
    return results[0] || ([] as T[])
  } catch (e) {
    throw intoSurQlError('Graph traversal with depth failed:', e)
  }
}

/**
 * Create a relation between two records
 */
export async function createRelation(
  db: Surreal,
  from: string,
  edge: string,
  to: string,
  data?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    let sql = `RELATE ${from}->${edge}->${to}`
    if (data && Object.keys(data).length > 0) {
      const setClauses = Object.entries(data).map(([k, v]) => `${k} = ${quoteValue(v)}`).join(', ')
      sql += ` SET ${setClauses}`
    }
    const results = await db.query<Record<string, unknown>[]>(sql) as unknown as Record<string, unknown>[][]
    return results[0]?.[0] || {}
  } catch (e) {
    throw intoSurQlError('Create relation failed:', e)
  }
}

/**
 * Remove a relation between two records
 */
export async function removeRelation(
  db: Surreal,
  from: string,
  edge: string,
  to: string,
): Promise<void> {
  try {
    const sql = `DELETE ${from}->${edge} WHERE out = ${to}`
    await db.query(sql)
  } catch (e) {
    throw intoSurQlError('Remove relation failed:', e)
  }
}

/**
 * Get records related via a specific edge.
 *
 * Pass `conditions` (a raw SurrealQL predicate) to filter the related
 * records.
 */
export async function getRelatedRecords<T = Record<string, unknown>>(
  db: Surreal,
  record: string,
  edge: string,
  direction?: '->' | '<-',
  conditions?: string,
): Promise<T[]> {
  try {
    const dir = direction ?? '->'
    const sql = `SELECT * FROM ${record}${dir}${edge}.*${whereClause(conditions)}`
    const results = await db.query<T[]>(sql) as unknown as T[][]
    return results[0] || ([] as T[])
  } catch (e) {
    throw intoSurQlError('Get related records failed:', e)
  }
}

/**
 * Get outgoing edges from a record.
 *
 * Pass `conditions` (a raw SurrealQL predicate) to filter the matched edges.
 */
export async function getOutgoingEdges<T = Record<string, unknown>>(
  db: Surreal,
  record: string,
  edge: string,
  conditions?: string,
): Promise<T[]> {
  try {
    const sql = `SELECT * FROM ${record}->${edge}${whereClause(conditions)}`
    const results = await db.query<T[]>(sql) as unknown as T[][]
    return results[0] || ([] as T[])
  } catch (e) {
    throw intoSurQlError('Get outgoing edges failed:', e)
  }
}

/**
 * Get incoming edges to a record.
 *
 * Pass `conditions` (a raw SurrealQL predicate) to filter the matched edges.
 */
export async function getIncomingEdges<T = Record<string, unknown>>(
  db: Surreal,
  record: string,
  edge: string,
  conditions?: string,
): Promise<T[]> {
  try {
    const sql = `SELECT * FROM ${record}<-${edge}${whereClause(conditions)}`
    const results = await db.query<T[]>(sql) as unknown as T[][]
    return results[0] || ([] as T[])
  } catch (e) {
    throw intoSurQlError('Get incoming edges failed:', e)
  }
}

/**
 * Count related records
 */
export async function countRelated(
  db: Surreal,
  record: string,
  edge: string,
  direction: '->' | '<-' = '->',
): Promise<number> {
  try {
    const sql = `SELECT count() AS total FROM ${record}${direction}${edge} GROUP ALL`
    const results = await db.query<{ total: number }[]>(sql) as unknown as { total: number }[][]
    return results[0]?.[0]?.total ?? 0
  } catch (e) {
    throw intoSurQlError('Count related failed:', e)
  }
}

/**
 * Find shortest path between two records.
 *
 * Pass `conditions` (a raw SurrealQL predicate) to filter the path records.
 */
export async function shortestPath(
  db: Surreal,
  from: string,
  to: string,
  edge: string,
  maxDepth?: number,
  conditions?: string,
): Promise<Record<string, unknown>[]> {
  validateIdentifier(edge)
  try {
    const depth = maxDepth ?? 10
    const sql = `SELECT * FROM fn::graph::shortest_path(${quoteValue(from)}, ${quoteValue(to)}, ${
      quoteValue(edge)
    }, ${depth})${whereClause(conditions)}`
    const results = await db.query<Record<string, unknown>[]>(sql) as unknown as Record<string, unknown>[][]
    return results[0] || []
  } catch (e) {
    throw intoSurQlError('Shortest path query failed:', e)
  }
}

/**
 * Find mutual connections between two records via an edge
 */
export async function findMutualConnections<T = Record<string, unknown>>(
  db: Surreal,
  recordA: string,
  recordB: string,
  edge: string,
): Promise<T[]> {
  try {
    const sql = `SELECT * FROM ${recordA}->${edge}.* WHERE id INSIDE (SELECT VALUE out FROM ${recordB}->${edge})`
    const results = await db.query<T[]>(sql) as unknown as T[][]
    return results[0] || ([] as T[])
  } catch (e) {
    throw intoSurQlError('Find mutual connections failed:', e)
  }
}
