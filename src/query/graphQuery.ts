/**
 * GraphQuery fluent builder for SurrealDB graph traversal.
 *
 * Chainable builder for composing `SELECT ... FROM start->edge->?...`
 * style graph traversals against SurrealDB. Mirrors the `GraphQuery`
 * exposed by surql-py, surql-rs, and surql-go.
 *
 * ## v3 depth handling
 *
 * SurrealDB v3 dropped the `<depth>` suffix that py's reference
 * implementation emits (e.g. `user:alice->follows2`). This port mirrors
 * the rs / go ports' corrected behaviour: when the caller passes a
 * positive `depth`, the step is expanded into that many repeated
 * `->edge->?` hops, producing a v3-valid traversal path. `depth` of 1
 * or `undefined` emits a single edge step.
 */

import type { SurQLClient } from '../client.ts'

/**
 * Error raised when a GraphQuery cannot be materialised into SurrealQL.
 */
export class GraphQueryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GraphQueryError'
  }
}

/**
 * A rendered GraphQuery ready to be dispatched against the database.
 */
export interface GraphQueryRendered {
  readonly sql: string
  readonly vars: Record<string, unknown>
}

/**
 * Direction arrow used when formatting an edge step.
 */
type Arrow = '->' | '<-' | '<->'

function formatEdgeStep(arrow: Arrow, edge: string, depth?: number): string {
  if (!edge) throw new GraphQueryError('edge must be a non-empty string')
  if (depth !== undefined && (!Number.isFinite(depth) || depth < 1 || !Number.isInteger(depth))) {
    throw new GraphQueryError(`depth must be a positive integer, got ${depth}`)
  }
  const d = depth ?? 1
  // Each hop emits `arrow + edge + arrow + ?` (the trailing `?`
  // selects the target node). For `out` that renders `->edge->?`; for
  // `in_` it renders `<-edge<-?`; for `both` it renders `<->edge<->?`.
  // A single hop (depth 1 or undefined) collapses to just `arrow+edge`.
  if (d === 1) return `${arrow}${edge}`
  return `${arrow}${edge}${arrow}?`.repeat(d)
}

/**
 * Fluent builder for graph traversal queries.
 *
 * All mutating methods return the same instance to support method
 * chaining. Clone via `new GraphQuery(start)` when branching is needed.
 *
 * @example
 * ```ts
 * const { sql } = new GraphQuery('user:alice')
 *   .out('follows')
 *   .where('age > 18')
 *   .limit(50)
 *   .toSurql()
 * ```
 */
export class GraphQuery {
  private readonly start: string
  private readonly path: string[] = []
  private readonly conditions: string[] = []
  private readonly fields: string[] = []
  private readonly fetchRefs: string[] = []
  private limitValue: number | undefined
  private targetTable: string | undefined

  /**
   * @param start Starting record id (e.g. `user:alice`) or bare table.
   */
  constructor(start: string) {
    if (!start) throw new GraphQueryError('start must be a non-empty string')
    this.start = start
  }

  /**
   * Append an outgoing edge step.
   */
  out(edge: string, depth?: number): this {
    this.path.push(formatEdgeStep('->', edge, depth))
    return this
  }

  /**
   * Append an incoming edge step.
   *
   * Named `in_` in the py/go/rs ports because `in` is reserved in
   * several host languages; kept for cross-port parity.
   */
  in_(edge: string, depth?: number): this {
    this.path.push(formatEdgeStep('<-', edge, depth))
    return this
  }

  /**
   * Append a bidirectional edge step.
   */
  both(edge: string, depth?: number): this {
    this.path.push(formatEdgeStep('<->', edge, depth))
    return this
  }

  /**
   * Pin the final hop to a specific target table.
   */
  to(table: string): this {
    if (!table) throw new GraphQueryError('table must be a non-empty string')
    this.targetTable = table
    return this
  }

  /**
   * Append a WHERE condition. Multiple calls are ANDed together.
   */
  where(condition: string): this {
    const trimmed = condition?.trim() ?? ''
    if (!trimmed) return this
    this.conditions.push(trimmed)
    return this
  }

  /**
   * Narrow the projection. Calling `.select()` repeatedly concatenates
   * fields; supplying no fields leaves the builder at `SELECT *`.
   */
  select(...fields: string[]): this {
    for (const f of fields) {
      if (f && f.trim()) this.fields.push(f.trim())
    }
    return this
  }

  /**
   * Cap the number of rows returned.
   */
  limit(n: number): this {
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      throw new GraphQueryError(`limit must be a non-negative integer, got ${n}`)
    }
    this.limitValue = n
    return this
  }

  /**
   * Append record references to a trailing `FETCH` clause.
   */
  fetch(...refs: string[]): this {
    for (const r of refs) {
      if (r && r.trim()) this.fetchRefs.push(r.trim())
    }
    return this
  }

  /**
   * Render the builder to a SurrealQL SELECT and vars payload.
   */
  toSurql(): GraphQueryRendered {
    if (this.path.length === 0) {
      throw new GraphQueryError('GraphQuery requires at least one traversal step (out, in_, or both)')
    }

    const fieldsSql = this.fields.length > 0 ? this.fields.join(', ') : '*'
    let pathSql = this.path.join('')
    if (this.targetTable) pathSql += `->${this.targetTable}`

    const parts: string[] = [`SELECT ${fieldsSql} FROM ${this.start}${pathSql}`]

    if (this.conditions.length > 0) {
      const conds = this.conditions.map((c) => `(${c})`).join(' AND ')
      parts.push(`WHERE ${conds}`)
    }

    if (this.fetchRefs.length > 0) {
      parts.push(`FETCH ${this.fetchRefs.join(', ')}`)
    }

    if (this.limitValue !== undefined) {
      parts.push(`LIMIT ${this.limitValue}`)
    }

    return { sql: parts.join(' '), vars: {} }
  }

  /**
   * Execute the built query against `client` and return the decoded rows.
   *
   * The client is `SurQLClient` so downstream consumers can plug in the
   * same connection they already use. Raw untyped rows are returned to
   * mirror the py/go surfaces; mappers can be applied by the caller.
   */
  async execute<T = Record<string, unknown>>(client: SurQLClient): Promise<T[]> {
    const { sql } = this.toSurql()
    const db = await client.getConnection()
    const result = (await db.query<T[]>(sql)) as unknown as T[][]
    return result[0] ?? []
  }

  /**
   * Execute the query as a count. Reuses the configured path / WHERE
   * but intentionally ignores SELECT / LIMIT / FETCH so the aggregate
   * reflects the full result set.
   */
  async count(client: SurQLClient): Promise<number> {
    if (this.path.length === 0) {
      throw new GraphQueryError('GraphQuery requires at least one traversal step (out, in_, or both)')
    }

    let pathSql = this.path.join('')
    if (this.targetTable) pathSql += `->${this.targetTable}`

    const parts: string[] = [`SELECT count() FROM ${this.start}${pathSql}`]
    if (this.conditions.length > 0) {
      const conds = this.conditions.map((c) => `(${c})`).join(' AND ')
      parts.push(`WHERE ${conds}`)
    }
    parts.push('GROUP ALL')

    const sql = parts.join(' ')
    const db = await client.getConnection()
    const result = (await db.query<Array<{ count?: number }>>(sql)) as unknown as Array<Array<{ count?: number }>>
    const first = result[0]?.[0]
    if (first && typeof first.count === 'number') return first.count
    return 0
  }

  /**
   * Whether any row matches the query. Thin wrapper around {@link count}.
   */
  async exists(client: SurQLClient): Promise<boolean> {
    const n = await this.count(client)
    return n > 0
  }
}
