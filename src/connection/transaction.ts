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
}

/**
 * Transaction wrapping SurrealDB BEGIN/COMMIT/CANCEL.
 * Supports Symbol.asyncDispose for `await using` syntax.
 */
export class Transaction {
  private readonly db: Surreal
  private _state: TransactionState = TransactionState.PENDING
  private readonly queries: string[] = []

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
   * Begin the transaction
   */
  async begin(): Promise<void> {
    if (this._state !== TransactionState.PENDING) {
      throw new TransactionError(`Cannot begin transaction in state: ${this._state}`)
    }
    try {
      await this.db.query('BEGIN TRANSACTION')
      this._state = TransactionState.ACTIVE
    } catch (e) {
      throw intoSurQlError('Failed to begin transaction:', e)
    }
  }

  /**
   * Execute a query within this transaction
   */
  async execute<T>(query: string, params?: Record<string, unknown>): Promise<T[]> {
    if (this._state !== TransactionState.ACTIVE) {
      throw new TransactionError(`Cannot execute in transaction state: ${this._state}`)
    }
    try {
      this.queries.push(query)
      const results = await this.db.query<T[]>(query, params) as unknown as T[][]
      return results[0] || ([] as T[])
    } catch (e) {
      throw intoSurQlError('Transaction query failed:', e)
    }
  }

  /**
   * Commit the transaction
   */
  async commit(): Promise<void> {
    if (this._state !== TransactionState.ACTIVE) {
      throw new TransactionError(`Cannot commit transaction in state: ${this._state}`)
    }
    try {
      await this.db.query('COMMIT TRANSACTION')
      this._state = TransactionState.COMMITTED
    } catch (e) {
      this._state = TransactionState.CANCELLED
      throw intoSurQlError('Failed to commit transaction:', e)
    }
  }

  /**
   * Cancel/rollback the transaction
   */
  async cancel(): Promise<void> {
    if (this._state !== TransactionState.ACTIVE) {
      throw new TransactionError(`Cannot cancel transaction in state: ${this._state}`)
    }
    try {
      await this.db.query('CANCEL TRANSACTION')
      this._state = TransactionState.CANCELLED
    } catch (e) {
      this._state = TransactionState.CANCELLED
      throw intoSurQlError('Failed to cancel transaction:', e)
    }
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
