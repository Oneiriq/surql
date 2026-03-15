import { CreateQL, DeleteQL, UpdateQL } from './crud/write.ts'
import { MergeQL } from './crud/merge.ts'
import { ReadQL } from './crud/read.ts'
import { UpsertQL } from './crud/upsert.ts'
import { type PatchOperation, PatchQL } from './crud/patch.ts'
import { type ConnectionConfig, SurrealConnectionManager } from './auth/connection.ts'
import type { ConnectionProvider, QueryOptions } from './crud/base.ts'
import type { RecordId, Surreal } from 'surrealdb'
import type { SurrealDbTable } from './crud/types.ts'
import type { AuthCredentials, AuthToken, SessionInfo, SignupData } from './auth/types.ts'

/**
 * Main SurrealDB client that provides a high-level interface for database operations.
 * Manages connections internally and provides factory methods for query builders.
 */
export class SurQLClient implements ConnectionProvider {
  private readonly connectionManager: SurrealConnectionManager

  constructor(config: ConnectionConfig) {
    this.connectionManager = new SurrealConnectionManager(config)
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

  async signin(credentials: AuthCredentials): Promise<AuthToken> {
    return this.connectionManager.signin(credentials)
  }

  async signup(data: SignupData): Promise<AuthToken> {
    return this.connectionManager.signup(data)
  }

  async authenticate(token: string): Promise<SessionInfo> {
    return this.connectionManager.authenticate(token)
  }

  async invalidate(): Promise<void> {
    return this.connectionManager.invalidate()
  }

  async info(): Promise<SessionInfo> {
    return this.connectionManager.info()
  }

  isAuthenticated(): boolean {
    return this.connectionManager.isAuthenticated()
  }

  getCurrentToken(): AuthToken | null {
    return this.connectionManager.getCurrentToken()
  }

  /** @internal */
  getConnection(): Promise<Surreal> {
    return this.connectionManager.getConnection()
  }

  close(): Promise<void> {
    return this.connectionManager.close()
  }
}
