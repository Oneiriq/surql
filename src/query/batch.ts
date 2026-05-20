import type { Surreal } from 'surrealdb'
import { Transaction } from '../connection/transaction.ts'
import { TransactionError } from '../connection/errors.ts'
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
 * Render an `item` dict as a SurrealQL object literal — `{ key: value, ... }`.
 * Field names are validated; values are run through {@link quoteValue} so
 * `RecordId`, `Date`, nested objects, and arrays all emit as native SurrealQL
 * shapes rather than JSON-stringified blobs.
 */
function formatObjectLiteral(data: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(data)) {
    validateIdentifier(key)
    parts.push(`${key}: ${quoteValue(value)}`)
  }
  return `{ ${parts.join(', ')} }`
}

/**
 * Build the UPSERT target — either a record id (`user:alice`) or the bare
 * table name. Validates the identifier when no colon is present so the bare
 * table form can't be used to smuggle SurrealQL.
 */
function buildUpsertTarget(table: string, raw: string | undefined): string {
  if (raw && raw.includes(':')) return raw
  validateIdentifier(table)
  return table
}

/**
 * Batch upsert multiple records.
 *
 * Inserts records if they don't exist, or updates them if they do. Emits one
 * `UPSERT <target> CONTENT { ... }` statement per record — matching the
 * surql-py / surql-rs / surql-go ports — and batches them into a single
 * multi-statement query in autocommit mode, or queues them on the supplied
 * transaction in atomic mode.
 *
 * ## Atomicity (1.5.0)
 *
 * `client` may be either a connected `Surreal` connection or an active
 * {@link Transaction}. The two modes behave differently:
 *
 * - **Surreal — autocommit.** The batch is sent as a single multi-statement
 *   query. If one record fails schema validation mid-batch, *earlier records
 *   may already have committed* (SurrealDB v3 autocommits per statement
 *   unless wrapped in `BEGIN … COMMIT`). This is the legacy behaviour and is
 *   preserved for backwards compatibility.
 *
 * - **Transaction — atomic.** The same per-record `UPSERT` statements are
 *   queued on the supplied transaction via `trx.execute`. They inherit the
 *   surrounding `BEGIN TRANSACTION` / `COMMIT TRANSACTION` framing, so a
 *   single bad record rolls back the *entire* batch on commit (no
 *   half-seeded tables). Results are not available at call time — `Transaction
 *   .execute` buffers statements — so this mode returns `[]`. Callers who
 *   need the per-row results should inspect the value returned by
 *   {@link Transaction.commit}.
 *
 * Use the transaction-bound form when seeding multiple tables in one atomic
 * step or when partial-success would leave the database in a shape downstream
 * code can't recover from. The mode is auto-detected from `client` so no API
 * call-site rewrite is needed beyond passing the transaction handle.
 *
 * @param client - `Surreal` connection (autocommit) or active `Transaction` (atomic)
 * @param table - target table name
 * @param items - records to upsert; an `id` field is used as the target if present
 * @param conflictFields - optional fields appended as a `WHERE` clause for conflict detection
 *
 * @example Basic autocommit upsert (legacy behaviour):
 * ```ts
 * const results = await upsertMany(db, 'users', [
 *   { id: 'user:1', name: 'Alice', age: 30 },
 *   { id: 'user:2', name: 'Bob', age: 25 },
 * ])
 * ```
 *
 * @example Atomic batch — rolls back if any record fails validation:
 * ```ts
 * const trx = transaction(db)
 * await trx.begin()
 * try {
 *   await upsertMany(trx, 'users', usersBatch)
 *   await upsertMany(trx, 'posts', postsBatch)
 *   await trx.commit() // commits both atomically; either failure rolls all back
 * } catch (e) {
 *   if (trx.isActive) await trx.cancel()
 *   throw e
 * }
 * ```
 */
export async function upsertMany<T = Record<string, unknown>>(
  client: Surreal | Transaction,
  table: string,
  items: Record<string, unknown>[],
  conflictFields?: string[],
): Promise<T[]> {
  if (items.length === 0) return []

  validateIdentifier(table)
  if (conflictFields) {
    for (const f of conflictFields) validateIdentifier(f)
  }

  const txn = client instanceof Transaction ? client : undefined

  try {
    const statements: string[] = []
    for (const item of items) {
      const id = typeof item.id === 'string' ? item.id : undefined
      const target = buildUpsertTarget(table, id)
      const payload: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(item)) {
        if (k !== 'id') payload[k] = v
      }
      const literal = formatObjectLiteral(payload)
      if (conflictFields && conflictFields.length > 0) {
        const conditions = conflictFields
          .map((f) => `${f} = ${quoteValue(payload[f])}`)
          .join(' AND ')
        statements.push(`UPSERT ${target} CONTENT ${literal} WHERE ${conditions}`)
      } else {
        statements.push(`UPSERT ${target} CONTENT ${literal}`)
      }
    }

    if (txn !== undefined) {
      // Queue each statement individually so a future per-statement
      // bookkeeping addition to `Transaction.execute` (duplicate-key detection,
      // statement-level retries) works correctly. The full batch then flushes
      // as a single `BEGIN … COMMIT` RPC on `Transaction.commit`, inheriting
      // v3's rollback-on-any-error semantics. Results aren't available until
      // commit — return an empty list and let callers inspect the array
      // returned by `Transaction.commit` if they need per-row data.
      for (const stmt of statements) {
        await txn.execute<T>(stmt)
      }
      return []
    }

    // `client` is narrowed to `Surreal` in this branch — the `txn` shortcut
    // above peeled off the Transaction case.
    const db = client as Surreal
    const sql = statements.join(';\n') + ';'
    const results = await db.query<T[]>(sql) as unknown as T[][]
    // The query returns one result set per statement; concatenate the
    // returned rows in order so a caller upserting N records gets back N rows
    // (matching surql-py's autocommit behaviour).
    const out: T[] = []
    for (const set of results ?? []) {
      if (Array.isArray(set)) out.push(...set)
    }
    return out
  } catch (e) {
    // Let TransactionError propagate verbatim — it carries an actionable
    // "transaction is in state X" diagnostic that gets swallowed by the
    // generic "Batch upsert failed" wrapper.
    if (e instanceof TransactionError) throw e
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
 * Build a SurrealQL UPSERT query string without executing it. Useful for
 * previewing or logging the query before execution.
 *
 * Emits one `UPSERT <target> CONTENT { ... }` statement per item, joined by
 * `;`. SurrealDB v3 rejects the older `UPSERT INTO <table> [ {...}, {...} ]`
 * shape with a parse error, so the per-record form is the only portable
 * pattern across the surql-py / surql-rs / surql-go ports.
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

  const statements: string[] = []
  for (const item of items) {
    const id = typeof item.id === 'string' ? item.id : undefined
    const target = buildUpsertTarget(table, id)
    const payload: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(item)) {
      if (k !== 'id') payload[k] = v
    }
    const literal = formatObjectLiteral(payload)
    if (conflictFields && conflictFields.length > 0) {
      const conditions = conflictFields
        .map((f) => `${f} = ${quoteValue(payload[f])}`)
        .join(' AND ')
      statements.push(`UPSERT ${target} CONTENT ${literal} WHERE ${conditions};`)
    } else {
      statements.push(`UPSERT ${target} CONTENT ${literal};`)
    }
  }

  return statements.join('\n')
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
