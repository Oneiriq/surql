/**
 * SurrealDB server-side function and record-reference primitives.
 *
 * These helpers let callers compose raw SurrealQL expressions (`time::now()`,
 * `type::record('agent:abc')`, etc.) that render inline in
 * `set()` / `where()` / `select()` clauses instead of being parameterized.
 *
 * Counterparts in surql-py: `SurrealFn`, `type_record`, `type_thing`.
 */

import { validateIdentifier } from '../query/helpers.ts'

/**
 * Marker interface for SurrealDB server-side function values.
 * When used in create/update data, these render as raw SurrealQL
 * instead of being parameterized.
 */
export interface SurrealFnValue {
  readonly __surqlFn: true
  readonly surql: string
  toSurQL(): string
}

/**
 * Legacy alias retained for parity with the surql-py `SurealFn` naming.
 * Prefer `SurrealFnValue` in new code.
 */
export type SurealFn = SurrealFnValue

/**
 * Create a SurrealDB server-side function reference for use in field values.
 *
 * When passed as a value in create/update operations, it renders as raw
 * SurrealQL rather than being parameterized.
 *
 * @param name - Fully qualified function name (e.g. `time::now`, `math::floor`)
 * @param args - Optional arguments as SurrealQL strings
 */
export function surqlFn(name: string, ...args: string[]): SurrealFnValue {
  const argsStr = args.join(', ')
  const surql = `${name}(${argsStr})`
  return Object.freeze({
    __surqlFn: true as const,
    surql,
    toSurQL(): string {
      return this.surql
    },
  })
}

/**
 * Type guard to check if a value is a `SurrealFnValue`.
 */
export function isSurqlFn(value: unknown): value is SurrealFnValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__surqlFn' in value &&
    (value as SurrealFnValue).__surqlFn === true
  )
}

/**
 * First-class `type::record()` reference for linking to a specific record.
 *
 * Generates `type::record('table:id')` when an id is supplied, or
 * `type::record('table')` when used as a bare-table reference.
 *
 * Preferred over raw-string interpolation because it composes directly with
 * `.set()`, `.where()`, `.select()`, and the CRUD helpers.
 *
 * @example
 * ```ts
 * const ref = typeRecord('task', taskId)
 * await updateRecord(db, ref, { status: 'done' })
 * ```
 */
export function typeRecord(table: string, id?: string): SurrealFnValue {
  validateIdentifier(table)
  const surql = id !== undefined ? `type::record('${table}:${id}')` : `type::record('${table}')`
  return Object.freeze({
    __surqlFn: true as const,
    surql,
    toSurQL(): string {
      return this.surql
    },
  })
}

/**
 * Parity alias for `typeRecord()`. SurrealDB v3 renamed `type::thing` to
 * `type::record`, but callers still reach for the Python/Go/Rust
 * `type_thing` name. Accept both; both emit the v3-valid form.
 */
export function typeThing(table: string, id?: string): SurrealFnValue {
  return typeRecord(table, id)
}

/**
 * Render any value that may be a record reference or plain string into its
 * `table:id` form. Used by CRUD helpers that accept either shape.
 *
 * - `'task:123'` -> `'task:123'`
 * - `typeRecord('task', '123')` -> `'task:123'`
 *
 * Returns `null` when the value does not look like a record reference.
 */
export function resolveRecordTarget(value: string | SurrealFnValue): string {
  if (typeof value === 'string') return value
  // Extract table:id from `type::record('table:id')` rendering.
  const match = value.surql.match(/^type::record\('([^']+)'\)$/)
  return match ? match[1] : value.surql
}
