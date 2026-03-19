import type { Surreal } from 'surrealdb'
import { intoSurQlError } from '../utils/surrealError.ts'
import { quoteValue, validateIdentifier } from './helpers.ts'

/**
 * Traverse a graph path from a starting record
 */
export async function traverse<T = Record<string, unknown>>(
  db: Surreal,
  start: string,
  path: string,
): Promise<T[]> {
  try {
    const sql = `SELECT * FROM ${start}.${path}`
    const results = await db.query<T[]>(sql) as unknown as T[][]
    return results[0] || ([] as T[])
  } catch (e) {
    throw intoSurQlError('Graph traversal failed:', e)
  }
}

/**
 * Traverse with explicit depth control
 */
export async function traverseWithDepth<T = Record<string, unknown>>(
  db: Surreal,
  start: string,
  edgeTable: string,
  direction: '->' | '<-' | '<->',
  depth: number = 1,
): Promise<T[]> {
  try {
    const path = Array.from({ length: depth }, () => `${direction}${edgeTable}`).join('')
    const sql = `SELECT * FROM ${start}${path}.*`
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
 * Get records related via a specific edge
 */
export async function getRelatedRecords<T = Record<string, unknown>>(
  db: Surreal,
  record: string,
  edge: string,
  direction: '->' | '<-' = '->',
): Promise<T[]> {
  try {
    const sql = `SELECT * FROM ${record}${direction}${edge}.*`
    const results = await db.query<T[]>(sql) as unknown as T[][]
    return results[0] || ([] as T[])
  } catch (e) {
    throw intoSurQlError('Get related records failed:', e)
  }
}

/**
 * Get outgoing edges from a record
 */
export async function getOutgoingEdges<T = Record<string, unknown>>(
  db: Surreal,
  record: string,
  edge: string,
): Promise<T[]> {
  try {
    const sql = `SELECT * FROM ${record}->${edge}`
    const results = await db.query<T[]>(sql) as unknown as T[][]
    return results[0] || ([] as T[])
  } catch (e) {
    throw intoSurQlError('Get outgoing edges failed:', e)
  }
}

/**
 * Get incoming edges to a record
 */
export async function getIncomingEdges<T = Record<string, unknown>>(
  db: Surreal,
  record: string,
  edge: string,
): Promise<T[]> {
  try {
    const sql = `SELECT * FROM ${record}<-${edge}`
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
 * Find shortest path between two records
 */
export async function shortestPath(
  db: Surreal,
  from: string,
  to: string,
  edge: string,
  maxDepth: number = 10,
): Promise<Record<string, unknown>[]> {
  validateIdentifier(edge)
  try {
    const sql = `SELECT * FROM fn::graph::shortest_path(${quoteValue(from)}, ${quoteValue(to)}, ${
      quoteValue(edge)
    }, ${maxDepth})`
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
