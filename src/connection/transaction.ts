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
   * The statement is not executed until {@link commit} is called.
   * Returns an empty array; the real per-statement results become
   * available in the value returned by `commit()`.
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
   * Flush buffered statements as a single atomic query.
   *
   * Emits `BEGIN TRANSACTION; <stmt>; ...; COMMIT TRANSACTION;` in one
   * RPC call. On failure the transaction is moved to `FAILED` and the
   * error is re-thrown wrapped as a SurQL error.
   */
  async commit(): Promise<void> {
    if (this._state !== TransactionState.ACTIVE) {
      throw new TransactionError(`Cannot commit transaction in state: ${this._state}`)
    }
    const parts: string[] = ['BEGIN TRANSACTION']
    for (const stmt of this.statements) {
      parts.push(stmt)
    }
    parts.push('COMMIT TRANSACTION')
    const surql = parts.join(';\n') + ';'
    try {
      await this.db.query(surql)
      this._state = TransactionState.COMMITTED
    } catch (e) {
      this._state = TransactionState.FAILED
      throw intoSurQlError('Failed to commit transaction:', e)
    }
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
