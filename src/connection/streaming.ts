import { type Surreal, Table } from 'surrealdb'
import { StreamingError } from './errors.ts'
import { intoSurQlError } from '../utils/surrealError.ts'

/**
 * Action type for live query notifications
 */
export type LiveAction = 'CREATE' | 'UPDATE' | 'DELETE'

/**
 * Notification received from a live query
 */
export interface LiveQueryNotification<T = Record<string, unknown>> {
  action: LiveAction
  result: T
}

/**
 * Callback for live query events
 */
export type LiveQueryCallback<T = Record<string, unknown>> = (notification: LiveQueryNotification<T>) => void

/**
 * Live query subscription wrapping SurrealDB LIVE SELECT.
 */
export class LiveQuery<T = Record<string, unknown>> {
  readonly queryUuid: string
  readonly table: string
  private readonly db: Surreal
  private readonly callbacks: Set<LiveQueryCallback<T>> = new Set()
  private _active = true

  constructor(queryUuid: string, table: string, db: Surreal) {
    this.queryUuid = queryUuid
    this.table = table
    this.db = db
  }

  get active(): boolean {
    return this._active
  }

  /**
   * Add a callback for live query events
   */
  subscribe(callback: LiveQueryCallback<T>): void {
    if (!this._active) {
      throw new StreamingError('Cannot subscribe to killed live query')
    }
    this.callbacks.add(callback)
  }

  /**
   * Remove a callback
   */
  unsubscribe(callback: LiveQueryCallback<T>): void {
    this.callbacks.delete(callback)
  }

  /**
   * Notify all subscribers of an event (called internally by StreamingManager)
   */
  notify(notification: LiveQueryNotification<T>): void {
    for (const cb of this.callbacks) {
      try {
        cb(notification)
      } catch {
        // Swallow callback errors to not break other subscribers
      }
    }
  }

  /**
   * Kill this live query via raw KILL query
   */
  async kill(): Promise<void> {
    if (!this._active) return
    try {
      await this.db.query(`KILL '${this.queryUuid}'`)
    } catch (e) {
      throw intoSurQlError('Failed to kill live query:', e)
    } finally {
      this._active = false
      this.callbacks.clear()
    }
  }
}

/**
 * Options for creating a live query
 */
export interface LiveQueryOptions {
  diff?: boolean
}

/**
 * Manages live query subscriptions for a database connection
 */
export class StreamingManager {
  private readonly db: Surreal
  private readonly queries: Map<string, LiveQuery> = new Map()

  constructor(db: Surreal) {
    this.db = db
  }

  /**
   * Create a live query on a table
   */
  async live<T = Record<string, unknown>>(
    table: string,
    _options?: LiveQueryOptions,
  ): Promise<LiveQuery<T>> {
    try {
      const uuid = await this.db.live(new Table(table))
      const uuidStr = String(uuid)
      const query = new LiveQuery<T>(uuidStr, table, this.db)
      this.queries.set(uuidStr, query as unknown as LiveQuery)
      return query
    } catch (e) {
      throw intoSurQlError('Failed to create live query:', e)
    }
  }

  /**
   * Kill a specific live query
   */
  async kill(queryUuid: string): Promise<void> {
    const query = this.queries.get(queryUuid)
    if (!query) {
      throw new StreamingError(`Live query '${queryUuid}' not found`)
    }
    await query.kill()
    this.queries.delete(queryUuid)
  }

  /**
   * Kill all active live queries
   */
  async killAll(): Promise<void> {
    const entries = [...this.queries.entries()]
    for (const [uuid, query] of entries) {
      try {
        await query.kill()
      } catch {
        // Best-effort cleanup
      }
      this.queries.delete(uuid)
    }
  }

  /**
   * Get the number of active live queries
   */
  get size(): number {
    return this.queries.size
  }

  /**
   * List all active live query UUIDs
   */
  list(): string[] {
    return [...this.queries.keys()]
  }
}
