export { AuthManager, AuthType, type NamedConnectionConfig, type ScopeCredentials, type TokenAuth } from './auth.ts'
export {
  type ConnectionRetryConfig,
  DEFAULT_CONNECTION_RETRY_CONFIG,
  type ExtendedConnectionConfig,
  resolveConnectionRetryConfig,
} from './config.ts'
export {
  clearDb,
  connectionOverride,
  connectionScope,
  type ConnectionScopeConfig,
  getDb,
  hasDb,
  setDb,
} from './context.ts'
export { ConnectionError, ContextError, QueryError, RegistryError, StreamingError, TransactionError } from './errors.ts'
export { ConnectionRegistry } from './registry.ts'
export {
  type LiveAction,
  LiveQuery,
  type LiveQueryCallback,
  type LiveQueryNotification,
  type LiveQueryOptions,
  StreamingManager,
} from './streaming.ts'
export { Transaction, transaction, TransactionState } from './transaction.ts'
