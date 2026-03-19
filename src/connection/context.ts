import type { SurQLClient } from '../client.ts'
import { ContextError } from './errors.ts'

/**
 * Module-scoped storage for the current database client.
 * Uses a simple variable since Deno supports top-level async but
 * AsyncLocalStorage from node:async_hooks may not be universally available.
 */
let _currentClient: SurQLClient | null = null

/**
 * Get the current database client from context
 *
 * @throws ContextError if no client is set
 */
export function getDb(): SurQLClient {
  if (!_currentClient) {
    throw new ContextError('No database client in context. Call setDb() first.')
  }
  return _currentClient
}

/**
 * Set the database client in context
 */
export function setDb(client: SurQLClient): void {
  _currentClient = client
}

/**
 * Clear the database client from context
 */
export function clearDb(): void {
  _currentClient = null
}

/**
 * Check if a database client exists in context
 */
export function hasDb(): boolean {
  return _currentClient !== null
}

/**
 * Scoped connection configuration
 */
export interface ConnectionScopeConfig {
  host: string
  port: string
  namespace: string
  database: string
  username: string
  password: string
  useSSL?: boolean
  protocol?: 'http' | 'https' | 'ws' | 'wss'
}

/**
 * Create a scoped connection that sets/clears the context automatically.
 * The client is available via getDb() within the scope.
 *
 * Usage:
 * ```ts
 * const { client, [Symbol.asyncDispose]: dispose } = await connectionScope(config)
 * // ... use getDb() or client directly
 * await dispose()
 * ```
 */
export async function connectionScope(
  config: ConnectionScopeConfig,
): Promise<{ client: SurQLClient } & AsyncDisposable> {
  // Dynamic import to avoid circular dependency
  const { SurQLClient } = await import('../client.ts')
  const client = new SurQLClient(config)
  const previous = _currentClient
  _currentClient = client

  return {
    client,
    async [Symbol.asyncDispose](): Promise<void> {
      await client.close()
      _currentClient = previous
    },
  }
}

/**
 * Temporarily override the database client in context.
 * Restores the previous client when disposed.
 */
export function connectionOverride(client: SurQLClient): AsyncDisposable {
  const previous = _currentClient
  _currentClient = client

  return {
    async [Symbol.asyncDispose](): Promise<void> {
      _currentClient = previous
    },
  }
}
