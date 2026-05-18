import { RecordId } from 'surrealdb'

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
 * Escape a string for embedding inside single quotes in SurrealQL.
 *
 * Backslashes are escaped first, then single quotes, so an attacker can't
 * smuggle a closing quote via `\'` (CodeQL js/incomplete-sanitization).
 */
function escapeString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/**
 * Render an object key for a SurrealQL object literal. A bare identifier is
 * emitted verbatim; anything else is single-quoted.
 */
function quoteKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : `'${escapeString(key)}'`
}

/**
 * Quote a value for safe SurrealQL embedding.
 *
 * - `null` / `undefined` render as `NONE` (the absence of a value).
 * - Values carrying a `__surqlFn` marker render as raw SurrealQL — server-side
 *   functions such as `time::now()`.
 * - `RecordId` instances render as a record-id literal (e.g. `user:alice`).
 * - `Date` instances render as a SurrealQL datetime literal (`d'...'`); a bare
 *   quoted string is rejected by v3 datetime-typed fields.
 * - Arrays and plain objects render as SurrealQL array / object literals,
 *   recursing through `quoteValue` so a nested record id, datetime, or
 *   function marker is rendered correctly instead of being flattened into a
 *   JSON string (which would emit, e.g., a literal `{"__surqlFn":true,...}`).
 */
export function quoteValue(value: unknown): string {
  if (value === null || value === undefined) return 'NONE'
  // SurrealFnValue — render as raw SurrealQL, not a parameterized value.
  if (
    typeof value === 'object' &&
    value !== null &&
    '__surqlFn' in value &&
    (value as { __surqlFn: boolean }).__surqlFn === true &&
    'surql' in value
  ) {
    return (value as { surql: string }).surql
  }
  if (typeof value === 'string') return `'${escapeString(value)}'`
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (value instanceof RecordId) return value.toString()
  if (value instanceof Date) return `d'${value.toISOString()}'`
  if (Array.isArray(value)) return `[${value.map(quoteValue).join(', ')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value).map(([k, v]) => `${quoteKey(k)}: ${quoteValue(v)}`)
    return entries.length > 0 ? `{ ${entries.join(', ')} }` : '{}'
  }
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
