/**
 * Return format for query results
 */
export enum ReturnFormat {
  NONE = 'NONE',
  DIFF = 'DIFF',
  FULL = 'FULL',
  BEFORE = 'BEFORE',
  AFTER = 'AFTER',
}

/**
 * Vector distance metric types
 */
export type VectorDistanceType = 'COSINE' | 'EUCLIDEAN' | 'MANHATTAN' | 'MINKOWSKI' | 'CHEBYSHEV' | 'HAMMING'

/**
 * Quote a value for safe SurrealQL embedding
 */
export function quoteValue(value: unknown): string {
  if (value === null || value === undefined) return 'NONE'
  if (typeof value === 'string') return `'${value.replace(/'/g, "\\'")}'`
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return `[${value.map(quoteValue).join(', ')}]`
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * Validate a SurrealQL identifier
 */
export function validateIdentifier(id: string): void {
  if (!/^[a-zA-Z0-9_.:*-]+$/.test(id)) {
    throw new Error(`Invalid identifier: ${id}`)
  }
}

/**
 * Escape a table name for SurrealQL
 */
export function escapeTable(table: string): string {
  validateIdentifier(table)
  return table
}
