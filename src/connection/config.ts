import type { ConnectionConfig } from '../auth/connection.ts'

/**
 * Retry configuration for connection attempts
 */
export interface ConnectionRetryConfig {
  maxRetries: number
  baseDelay: number
  maxDelay: number
  backoffMultiplier: number
}

/**
 * Extended connection configuration with retry and pool settings
 */
export interface ExtendedConnectionConfig extends ConnectionConfig {
  retry?: Partial<ConnectionRetryConfig>
  connectionTimeout?: number
  idleTimeout?: number
  maxConnections?: number
}

/**
 * Default retry configuration
 */
export const DEFAULT_CONNECTION_RETRY_CONFIG: ConnectionRetryConfig = {
  maxRetries: 3,
  baseDelay: 100,
  maxDelay: 5000,
  backoffMultiplier: 2,
}

/**
 * Resolve a partial retry config with defaults
 */
export function resolveConnectionRetryConfig(partial?: Partial<ConnectionRetryConfig>): ConnectionRetryConfig {
  return { ...DEFAULT_CONNECTION_RETRY_CONFIG, ...partial }
}
