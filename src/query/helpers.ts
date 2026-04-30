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
 * Quote a value for safe SurrealQL embedding.
 * Values with a `__surqlFn` marker are rendered as raw SurrealQL (server-side functions).
 */
export function quoteValue(value: unknown): string {
  if (value === null || value === undefined) return 'NONE'
  // Handle SurrealFnValue - render as raw SurrealQL, not parameterized
  if (
    typeof value === 'object' &&
    value !== null &&
    '__surqlFn' in value &&
    (value as { __surqlFn: boolean }).__surqlFn === true &&
    'surql' in value
  ) {
    return (value as { surql: string }).surql
  }
  if (typeof value === 'string') {
    // Escape backslashes first, then single quotes, so that an attacker
    // can't smuggle a closing quote via `\'` (CodeQL js/incomplete-sanitization).
    const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    return `'${escaped}'`
  }
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
