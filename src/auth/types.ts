/**
 * Root user credentials for system-level access
 */
export interface RootCredentials {
  type: 'root'
  username: string
  password: string
}

/**
 * Namespace user credentials for namespace-level access
 */
export interface NamespaceCredentials {
  type: 'namespace'
  namespace: string
  username: string
  password: string
}

/**
 * Database user credentials for database-level access
 */
export interface DatabaseCredentials {
  type: 'database'
  namespace: string
  database: string
  username: string
  password: string
}

/**
 * Record user credentials for record-level access (v2: replaces scope)
 */
export interface RecordCredentials {
  type: 'record'
  namespace: string
  database: string
  access: string
  variables: Record<string, unknown>
}

/**
 * Union type of all supported authentication credential types
 */
export type AuthCredentials =
  | RootCredentials
  | NamespaceCredentials
  | DatabaseCredentials
  | RecordCredentials

/**
 * JWT token structure returned by SurrealDB v2 authentication
 */
export interface AuthToken {
  access: string
  refresh?: string
  expires?: Date
}

/**
 * User session information containing authentication details
 */
export interface SessionInfo {
  id: string
  type: 'root' | 'namespace' | 'database' | 'record'
  namespace?: string
  database?: string
  access?: string
  expires?: Date
  permissions?: string[]
}

/**
 * Signup data for creating new record users (v2: replaces scope)
 */
export interface SignupData {
  namespace: string
  database: string
  access: string
  variables: Record<string, unknown>
}

/**
 * Enhanced connection configuration with authentication support
 */
export interface EnhancedConnectionConfig {
  host: string
  port: string
  namespace: string
  database: string
  username?: string
  password?: string
  useSSL?: boolean
  protocol?: 'http' | 'https' | 'ws' | 'wss'
  authToken?: string
  autoRefresh?: boolean
  tokenRefreshBuffer?: number
}
