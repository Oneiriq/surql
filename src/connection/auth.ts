/**
 * Authentication module for SurrealDB connections.
 */

import type { Surreal } from 'surrealdb'

/** Authentication type levels */
export enum AuthType {
  ROOT = 'root',
  NAMESPACE = 'namespace',
  DATABASE = 'database',
  SCOPE = 'scope',
}

export interface ScopeCredentials {
  readonly namespace: string
  readonly database: string
  readonly access: string
  readonly variables: Record<string, unknown>
}

export interface TokenAuth {
  readonly token: string
}

/** Named connection configuration for multi-connection setup */
export interface NamedConnectionConfig {
  readonly name: string
  readonly host: string
  readonly port: string
  readonly namespace: string
  readonly database: string
  readonly username: string
  readonly password: string
}

/**
 * Authentication manager for database clients.
 * Manages signup, signin, token authentication, and session invalidation.
 */
export class AuthManager {
  private _currentToken: string | null = null
  private _authType: AuthType | null = null

  get currentToken(): string | null {
    return this._currentToken
  }

  get authType(): AuthType | null {
    return this._authType
  }

  get isAuthenticated(): boolean {
    return this._currentToken !== null
  }

  async signup(client: Surreal, credentials: ScopeCredentials): Promise<string> {
    const params = {
      namespace: credentials.namespace,
      database: credentials.database,
      access: credentials.access,
      ...credentials.variables,
    }
    const token = await client.signup(params as Parameters<Surreal['signup']>[0])
    this._currentToken = token as unknown as string
    this._authType = AuthType.SCOPE
    return this._currentToken
  }

  async signin(client: Surreal, credentials: Record<string, unknown>): Promise<string> {
    const token = await client.signin(credentials as Parameters<Surreal['signin']>[0])
    this._currentToken = token as unknown as string
    if ('access' in credentials) {
      this._authType = AuthType.SCOPE
    } else if ('database' in credentials) {
      this._authType = AuthType.DATABASE
    } else if ('namespace' in credentials && !('database' in credentials)) {
      this._authType = AuthType.NAMESPACE
    } else {
      this._authType = AuthType.ROOT
    }
    return this._currentToken
  }

  async authenticate(client: Surreal, token: string): Promise<void> {
    await client.authenticate(token)
    this._currentToken = token
  }

  async invalidate(client: Surreal): Promise<void> {
    await client.invalidate()
    this._currentToken = null
    this._authType = null
  }
}
