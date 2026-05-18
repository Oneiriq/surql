import type { Surreal } from 'surrealdb'
import { intoSurQlError } from '../utils/surrealError.ts'
import { TransactionError } from './errors.ts'

/**
 * Transaction state enum
 */
export enum TransactionState {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  COMMITTED = 'COMMITTED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

/**
 * One per-statement entry from the SurrealDB JS SDK's `query(...).responses()`
 * accessor. Awaiting a query collects the results and rejects on the first
 * failed statement; `.responses()` instead resolves with the full
 * per-statement envelope, so a `BEGIN ...; COMMIT` batch can be inspected as a
 * whole — distinguishing a clean commit from a server-side rollback and naming
 * the statement that caused it.
 */
interface RawQueryResponse {
  readonly success: boolean
  readonly result?: unknown
  readonly error?: {
    readonly kind?: string
    readonly code?: number
    readonly details?: { readonly kind?: string } | null
  }
}

/**
 * Inspect the per-statement envelope returned for a committed
 * `BEGIN ...; COMMIT` batch.
 *
 * `responses[0]` is the BEGIN bookend and the trailing entry is COMMIT; the
 * `userCount` entries in between map 1:1, in order, to the statements queued
 * via {@link Transaction.execute}. A SurrealDB v3 transaction is atomic — a
 * single failed statement rolls the whole batch back — so any `success: false`
 * entry means nothing was committed.
 *
 * The rolled-back statements are flagged with a `NotExecuted` cascade error;
 * the originating failure is the first entry whose error is not that cascade.
 */
function inspectCommitResponses(
  responses: readonly RawQueryResponse[],
  userCount: number,
): { committed: true; results: unknown[] } | { committed: false; reason: string } {
  const firstFailure = responses.findIndex((r) => !r.success)
  if (firstFailure === -1) {
    // [ BEGIN, ...userCount statements, COMMIT ] — return just the user results.
    return { committed: true, results: responses.slice(1, 1 + userCount).map((r) => r.result) }
  }

  let causeIndex = responses.findIndex((r) => !r.success && r.error?.details?.kind !== 'NotExecuted')
  if (causeIndex === -1) causeIndex = firstFailure
  const kind = responses[causeIndex].error?.kind ?? 'unknown error'

  let where: string
  if (causeIndex === 0) {
    where = 'the BEGIN statement'
  } else if (causeIndex <= userCount) {
    where = `statement ${causeIndex} of ${userCount}`
  } else {
    where = 'the COMMIT statement'
  }
  return {
    committed: false,
    reason: `${where} failed (${kind}), so the whole batch was rolled back`,
  }
}

/**
 * Transaction that buffers statements client-side and flushes them as a
 * single `BEGIN TRANSACTION; ...; COMMIT TRANSACTION;` request on commit.
 *
 * SurrealDB v3 rejects bare `COMMIT TRANSACTION` / `CANCEL TRANSACTION`
 * statements issued as isolated RPC requests, so we cannot stream the
 * bookends across separate `query()` calls. Instead, statements handed
 * to {@link Transaction.execute} are staged in memory and applied
 * atomically when {@link Transaction.commit} is called. {@link
 * Transaction.cancel} discards the buffer without contacting the server.
 *
 * Supports `Symbol.asyncDispose` for `await using` syntax; disposal of an
 * active transaction cancels it client-side.
 */
export class Transaction {
  private readonly db: Surreal
  private _state: TransactionState = TransactionState.PENDING
  private readonly statements: string[] = []

  constructor(db: Surreal) {
    this.db = db
  }

  get state(): TransactionState {
    return this._state
  }

  get isActive(): boolean {
    return this._state === TransactionState.ACTIVE
  }

  /**
   * Mark the transaction as active so that statements may be queued.
   *
   * No RPC is issued here: the server only sees the transaction when
   * {@link commit} flushes the buffered statements as a single
   * `BEGIN ... COMMIT` request.
   */
  // deno-lint-ignore require-await
  async begin(): Promise<void> {
    if (this._state !== TransactionState.PENDING) {
      throw new TransactionError(`Cannot begin transaction in state: ${this._state}`)
    }
    this._state = TransactionState.ACTIVE
  }

  /**
   * Queue a statement for execution inside the transaction.
   *
   * The statement is not executed until {@link commit} is called. This call
   * returns an empty array — the real per-statement results become available,
   * in queue order, in the array returned by {@link commit}.
   */
  // deno-lint-ignore require-await
  async execute<T>(query: string, _params?: Record<string, unknown>): Promise<T[]> {
    if (this._state !== TransactionState.ACTIVE) {
      throw new TransactionError(`Cannot execute in transaction state: ${this._state}`)
    }
    const trimmed = query.trim().replace(/;+\s*$/, '')
    this.statements.push(trimmed)
    return [] as T[]
  }

  /**
   * Flush buffered statements as a single atomic `BEGIN ...; COMMIT` request
   * and return the per-statement results, in queue order, of the statements
   * passed to {@link execute}.
   *
   * The batch is sent through the SDK's `responses()` accessor rather than a
   * plain `await`. A SurrealDB v3 transaction is atomic, so a single failed
   * statement rolls the entire batch back; `responses()` exposes the
   * per-statement envelope, letting `commit()` confirm the batch actually
   * committed and name the statement that caused a rollback. A bare
   * `await db.query(...)` only ever surfaces a generic "failed transaction"
   * message with no indication of which statement was at fault.
   *
   * On a rollback (or transport failure) the transaction moves to `FAILED`
   * and a {@link TransactionError} is thrown.
   */
  async commit(): Promise<unknown[]> {
    if (this._state !== TransactionState.ACTIVE) {
      throw new TransactionError(`Cannot commit transaction in state: ${this._state}`)
    }
    const parts: string[] = ['BEGIN TRANSACTION', ...this.statements, 'COMMIT TRANSACTION']
    const surql = parts.join(';\n') + ';'

    let responses: RawQueryResponse[]
    try {
      responses = (await this.db.query(surql).responses()) as unknown as RawQueryResponse[]
    } catch (e) {
      this._state = TransactionState.FAILED
      throw intoSurQlError('Failed to commit transaction:', e)
    }

    const outcome = inspectCommitResponses(responses, this.statements.length)
    if (!outcome.committed) {
      this._state = TransactionState.FAILED
      throw new TransactionError(`Failed to commit transaction: ${outcome.reason}`)
    }
    this._state = TransactionState.COMMITTED
    return outcome.results
  }

  /**
   * Discard buffered statements without contacting the server.
   */
  // deno-lint-ignore require-await
  async cancel(): Promise<void> {
    if (this._state !== TransactionState.ACTIVE) {
      throw new TransactionError(`Cannot cancel transaction in state: ${this._state}`)
    }
    this.statements.length = 0
    this._state = TransactionState.CANCELLED
  }

  /**
   * Auto-cancel on dispose if still active
   */
  async [Symbol.asyncDispose](): Promise<void> {
    if (this._state === TransactionState.ACTIVE) {
      await this.cancel()
    }
  }
}

/**
 * Create a new transaction from a Surreal connection
 */
export function transaction(db: Surreal): Transaction {
  return new Transaction(db)
}
