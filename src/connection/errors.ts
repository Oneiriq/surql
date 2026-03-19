import { SurQlError } from '../utils/surrealError.ts'

/**
 * Error thrown when a database connection fails
 */
export class ConnectionError extends SurQlError {
  constructor(message: string) {
    super(message)
    this.name = 'ConnectionError'
  }
}

/**
 * Error thrown when a database query fails
 */
export class QueryError extends SurQlError {
  constructor(message: string) {
    super(message)
    this.name = 'QueryError'
  }
}

/**
 * Error thrown when a transaction operation fails
 */
export class TransactionError extends SurQlError {
  constructor(message: string) {
    super(message)
    this.name = 'TransactionError'
  }
}

/**
 * Error thrown when a context operation fails
 */
export class ContextError extends SurQlError {
  constructor(message: string) {
    super(message)
    this.name = 'ContextError'
  }
}

/**
 * Error thrown when a registry operation fails
 */
export class RegistryError extends SurQlError {
  constructor(message: string) {
    super(message)
    this.name = 'RegistryError'
  }
}

/**
 * Error thrown when a streaming/live query operation fails
 */
export class StreamingError extends SurQlError {
  constructor(message: string) {
    super(message)
    this.name = 'StreamingError'
  }
}
