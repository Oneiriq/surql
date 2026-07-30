/**
 * Multiple-session support for SurrealDB v3.
 *
 * A single WebSocket connection can host several independent sessions, each
 * with its own namespace/database selection, authentication state, and session
 * variables. {@link Session} wraps the SDK's `SurrealSession` and mirrors the
 * {@link SurQLClient} surface (the CRUD builder factories plus `use`, `signin`,
 * `forkSession`, and `closeSession`), so a session can be used exactly like the
 * top-level client.
 *
 * Sessions require a live WebSocket connection — `newSession()` over an HTTP
 * connection throws a {@link SessionUnsupportedError}, surfaced before any RPC
 * is attempted.
 */

import type { AnyAuth, RecordId, Surreal, SurrealSession } from 'surrealdb'
import { CreateQL, DeleteQL, UpdateQL } from '../crud/write.ts'
import { MergeQL } from '../crud/merge.ts'
import { ReadQL } from '../crud/read.ts'
import { type PatchOperation, PatchQL } from '../crud/patch.ts'
import { UpsertQL } from '../crud/upsert.ts'
import { buildSigninParams } from '../auth/connection.ts'
import { intoSurQlError } from '../utils/surrealError.ts'
import type { ConnectionProvider, QueryOptions } from '../crud/base.ts'
import type { SurrealDbTable } from '../crud/types.ts'
import type { AuthCredentials } from '../auth/types.ts'

/**
 * Raised when a session operation is attempted over a transport that does not
 * support multiple sessions (i.e. anything other than a WebSocket connection).
 */
export class SessionUnsupportedError extends Error {
  constructor(message = 'Sessions require a WebSocket connection (ws:// or wss://)') {
    super(message)
    this.name = 'SessionUnsupportedError'
  }
}

/**
 * Target for switching a session's namespace/database. Leaving a field
 * undefined keeps the current value; passing `null` unsets it.
 */
export interface UseTarget {
  namespace?: string | null
  database?: string | null
}

/**
 * A scoped session over a shared connection.
 *
 * Implements {@link ConnectionProvider} so the CRUD builders dispatch their
 * queries against this session rather than the default connection session.
 */
export class Session implements ConnectionProvider {
  private readonly session: SurrealSession

  /** @internal Construct via `client.newSession()` / `session.forkSession()`. */
  constructor(session: SurrealSession) {
    this.session = session
  }

  /**
   * @internal Returns the underlying session typed as a `Surreal` connection.
   *
   * The CRUD builders only ever call `.query(sql, vars)`, which `SurrealSession`
   * provides; the cast narrows the SDK's session type to the connection shape
   * the builders expect without widening the public API.
   */
  getConnection(): Promise<Surreal> {
    return Promise.resolve(this.session as unknown as Surreal)
  }

  /** The SDK session id (`undefined` for the default session). */
  get id(): unknown {
    return this.session.session
  }

  /** Whether this session is still valid and usable. */
  get isValid(): boolean {
    return this.session.isValid
  }

  /** The currently selected namespace, if any. */
  get namespace(): string | undefined {
    return this.session.namespace
  }

  /** The currently selected database, if any. */
  get database(): string | undefined {
    return this.session.database
  }

  query<R extends { id: RecordId }, T = R>(
    table: SurrealDbTable,
    options?: QueryOptions,
  ): ReadQL<R, T> {
    return new ReadQL<R, T>(this, table, options)
  }

  create<R extends { id: RecordId }, T = R>(
    table: SurrealDbTable,
    data: Record<string, unknown>,
    options?: QueryOptions,
  ): CreateQL<R, T> {
    return new CreateQL<R, T>(this, table, data, options)
  }

  update<R extends { id: RecordId }, T = R>(
    table: SurrealDbTable,
    recordId: string | RecordId,
    data: Record<string, unknown>,
    options?: QueryOptions,
  ): UpdateQL<R, T> {
    return new UpdateQL<R, T>(this, table, recordId, data, options)
  }

  remove<R extends { id: RecordId }, T = R>(
    table: SurrealDbTable,
    recordId: string | RecordId,
    options?: QueryOptions,
  ): DeleteQL<R, T> {
    return new DeleteQL<R, T>(this, table, recordId, options)
  }

  merge<R extends { id: RecordId }, T = R>(
    table: SurrealDbTable,
    targetId: string | RecordId,
    data: Record<string, unknown>,
    options?: QueryOptions,
  ): MergeQL<R, T> {
    return new MergeQL<R, T>(this, table, targetId, data, options)
  }

  patch<R extends { id: RecordId }, T = R>(
    table: SurrealDbTable,
    targetId: string | RecordId,
    operations: PatchOperation[] = [],
    options: QueryOptions = {},
  ): PatchQL<R, T> {
    return new PatchQL<R, T>(this, table, targetId, operations, options)
  }

  upsert<R extends { id: RecordId }, T = R>(
    table: SurrealDbTable,
    data: Record<string, unknown>,
    options?: QueryOptions,
  ): UpsertQL<R, T> {
    return new UpsertQL<R, T>(this, table, data, options)
  }

  /**
   * Switch this session's namespace and/or database. Leaving a field undefined
   * keeps the current value; passing `null` unsets it.
   */
  async use(target: UseTarget): Promise<void> {
    try {
      await this.session.use(target)
    } catch (e) {
      throw intoSurQlError('Session use() failed:', e)
    }
  }

  /**
   * Authenticate this session with the given credentials. Only this session's
   * authentication state changes; sibling sessions are unaffected.
   */
  async signin(credentials: AuthCredentials): Promise<void> {
    try {
      const params = buildSigninParams(credentials)
      await this.session.signin(params as AnyAuth)
    } catch (e) {
      throw intoSurQlError('Session signin failed:', e)
    }
  }

  /**
   * Fork this session into a new independent session that inherits the current
   * namespace, database, variables, and authentication state.
   */
  async forkSession(): Promise<Session> {
    try {
      const forked = await this.session.forkSession()
      return new Session(forked)
    } catch (e) {
      throw intoSurQlError('forkSession failed:', e)
    }
  }

  /**
   * Close and dispose this session. After this resolves the session can no
   * longer be used and {@link isValid} reports `false`.
   */
  async closeSession(): Promise<void> {
    try {
      await this.session.closeSession()
    } catch (e) {
      throw intoSurQlError('closeSession failed:', e)
    }
  }
}
