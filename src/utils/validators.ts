/**
 * SurQL input validation utilities
 * This module provides functions to validate various inputs such as field names, table names, connection configurations
 * and query values to prevent injection attacks and data leakage.
 */
import { $ZodError } from 'zod/v4/core'
import { intoZodError, ZodValidationError } from './zodError.ts'
import { isArray, isFunction, isObject, isPrimitiveOrNullish, isString } from './helpers.ts'
import { PATTERNS } from '../constants.ts'
import {
  assertMaxArrayLength,
  assertMaxStringLength,
  assertMaxWildcards,
  assertMinStringLength,
  assertNoDangerousSQL,
  assertNoEmptyString,
  assertNumberBetween,
  assertNumberLessThan,
  assertNumericString,
  assertObject,
  assertString,
  assertValidFormat,
} from './asserts.ts'

/**
 * Validation result type
 */
export interface ValidationResult {
  success: boolean
  error?: string
}

/**
 * Validate field name to prevent injection attacks
 * @private
 * @param field - Field name to validate
 */
export function validateFieldName(field: unknown): ValidationResult {
  try {
    assertString(field, 'field name')
    assertNoEmptyString({ input: field, context: 'field name' })
    assertMaxStringLength({ input: field, context: 'field name', maxLength: 100 })
    assertNoDangerousSQL({ input: field, context: 'field name', patterns: PATTERNS.SQL.FIELD_NAME_INJECTION_PATTERNS })
    assertValidFormat({ input: field, context: 'field name', patterns: [PATTERNS.FIELD_NAME] })
  } catch (e) {
    return {
      success: false,
      error: `Invalid field name: ${(e as Error).message}`,
    }
  }

  return {
    success: true,
  }
}

/**
 * Validate a table name for database operations
 * @param table - The table name to validate
 * @returns ValidationResult indicating success or failure with error message
 */
export function validateTableName(table: unknown): ValidationResult {
  try {
    assertString(table, 'table name')
    assertNoEmptyString({ input: table, context: 'table name' })
    assertMaxStringLength({ input: table, context: 'table name', maxLength: 64 })
    assertNoDangerousSQL({ input: table, context: 'table name', patterns: PATTERNS.SQL.FIELD_NAME_INJECTION_PATTERNS })
    assertValidFormat({ input: table, context: 'table name', patterns: [PATTERNS.TABLE_NAME] })
  } catch (e) {
    return {
      success: false,
      error: `Invalid table name: ${(e as Error).message}`,
    }
  }

  return { success: true }
}

/**
 * Validate a host for connection configuration
 * @param host - The host to validate
 * @returns ValidationResult indicating success or failure with error message
 */
export function validateHost(host: unknown): ValidationResult {
  try {
    assertString(host, 'host')
    assertNoEmptyString({ input: host, context: 'host' })
    assertMaxStringLength({ input: host, context: 'host', maxLength: 253 })
    assertValidFormat({ input: host, context: 'host', patterns: [...PATTERNS.HOST] })
  } catch (e) {
    return {
      success: false,
      error: `Invalid host: ${(e as Error).message}`,
    }
  }

  return { success: true }
}

/**
 * Validate a port for connection configuration
 * @param port - The port to validate
 * @returns ValidationResult indicating success or failure with error message
 */
export function validatePort(port: unknown): ValidationResult {
  try {
    assertString(port, 'port')
    assertNoEmptyString({ input: port, context: 'port' })
    assertNumericString(port, 'port')
    assertNumberBetween(port, 1, 65535, 'port') // Reasonable port range, could be adjusted if anyone actually uses ports outside this range
  } catch (e) {
    return {
      success: false,
      error: `Invalid port: ${(e as Error).message}`,
    }
  }

  return { success: true }
}

/**
 * Validate a username for database operations
 * @param username - The username to validate
 * @returns ValidationResult indicating success or failure with error message
 */
export function validateUsername(username: unknown): ValidationResult {
  try {
    assertString(username, 'username')
    assertNoEmptyString({ input: username, context: 'username' })
    assertMinStringLength({ input: username, context: 'username', minLength: 3 })
    assertMaxStringLength({ input: username, context: 'username', maxLength: 64 })
    assertNoDangerousSQL({ input: username, context: 'username', patterns: PATTERNS.SQL.FIELD_NAME_INJECTION_PATTERNS })
    assertValidFormat({ input: username, context: 'username', patterns: [PATTERNS.FIELD_NAME] })
  } catch (e) {
    return {
      success: false,
      error: `Invalid username: ${(e as Error).message}`,
    }
  }

  return { success: true }
}

/**
 * Validate a password for database operations
 * @param password - The password to validate
 * @returns ValidationResult indicating success or failure with error message
 */
export function validatePassword(password: unknown): ValidationResult {
  try {
    assertString(password, 'password')
    assertNoEmptyString({ input: password, context: 'password' })
    assertMinStringLength({ input: password, context: 'password', minLength: 4 })
    assertMaxStringLength({ input: password, context: 'password', maxLength: 256 })
    assertValidFormat({ input: password, context: 'password', patterns: [PATTERNS.PASSWORD] })
  } catch (e) {
    return {
      success: false,
      error: `Invalid password: ${(e as Error).message}`,
    }
  }
  return { success: true }
}

/**
 * Validate a query value for database operations
 * @param value - The value to validate
 * @returns ValidationResult indicating success or failure with error message
 */
export function validateQueryValue(value: unknown): ValidationResult {
  if (isPrimitiveOrNullish(value)) {
    return { success: true }
  }

  if (isString(value)) {
    try {
      assertMaxStringLength({ input: value, context: 'string value', maxLength: 10000 })
      assertNoDangerousSQL({
        input: value,
        context: 'string value',
        patterns: PATTERNS.SQL.CLAUSE_INJECTION_PATTERNS,
      })
    } catch (e) {
      return { success: false, error: `Invalid query value: ${(e as Error).message}` }
    }
    return { success: true }
  } else if (isArray(value)) {
    try {
      assertMaxArrayLength({ input: value, context: 'array value', maxLength: 1000 })

      for (let i = 0; i < value.length; ++i) {
        const result = validateQueryValue(value[i])
        if (!result.success) {
          return { success: false, error: `Error at array index [${i}]: ${result.error}` }
        }
      }
    } catch (e) {
      return { success: false, error: `Invalid query value: ${(e as Error).message}` }
    }

    return { success: true }
  } else if (isObject(value)) {
    const entries = Object.entries(value as Record<string, unknown>)
    try {
      assertNumberLessThan(entries.length, 100, 'object length')

      for (const [key, val] of entries) {
        const keyResult = validateFieldName(key)
        if (!keyResult.success) {
          return { success: false, error: `Invalid object key "${key}": ${keyResult.error}` }
        }

        const valueResult = validateQueryValue(val)
        if (!valueResult.success) {
          return { success: false, error: `Error in object property "${key}": ${valueResult.error}` }
        }
      }
      return { success: true }
    } catch (e) {
      return { success: false, error: `Invalid object: ${(e as Error).message}` }
    }
  } else if (isFunction(value)) {
    return { success: false, error: 'Invalid value. Function types are not allowed in queries.' }
  }

  return { success: false, error: `Invalid value. Unsupported data type: ${typeof value}` }
}

/**
 * Validate a LIKE pattern for database operations
 * @param pattern - The LIKE pattern to validate
 * @returns ValidationResult indicating success or failure with error message
 */
export function validateLikePattern(pattern: unknown): ValidationResult {
  try {
    assertString(pattern, 'LIKE pattern')
    assertNoEmptyString({ input: pattern, context: 'LIKE pattern' })
    assertMaxStringLength({ input: pattern, context: 'LIKE pattern', maxLength: 1000 })
    assertNoDangerousSQL({
      input: pattern,
      context: 'LIKE pattern',
      patterns: PATTERNS.SQL.CLAUSE_INJECTION_PATTERNS,
    })
    assertMaxWildcards({ input: pattern, context: 'LIKE pattern', maxWildcards: 50 })
  } catch (e) {
    return { success: false, error: `Invalid LIKE pattern: ${(e as Error).message}` }
  }

  return { success: true }
}

const EMBEDDED_PROTOCOLS_SET: ReadonlySet<string> = new Set([
  'mem',
  'rocksdb',
  'surrealkv',
  'surrealkv+versioned',
])

/**
 * Validate connection configuration.
 *
 * Remote configurations require `host`, `port`, `username`, `password`, and
 * valid `namespace`/`database`. Embedded configurations (when `protocol` is
 * one of `mem`, `rocksdb`, `surrealkv`, `surrealkv+versioned`) skip the
 * network/credential checks and require `path` for persistent engines.
 *
 * @param config - The connection configuration to validate
 * @returns ValidationResult indicating success or failure with error message
 */
export function validateConnectionConfig(config: unknown): ValidationResult {
  try {
    assertObject(config, 'connection config')
  } catch (e) {
    return { success: false, error: `Invalid connection config: ${(e as Error).message}` }
  }

  const {
    host,
    port,
    namespace,
    database,
    username,
    password,
    protocol,
    path,
  } = config as Record<string, unknown>

  const namespaceResult = validateTableName(namespace)
  if (!namespaceResult.success) return namespaceResult

  const databaseResult = validateTableName(database)
  if (!databaseResult.success) return databaseResult

  if (typeof protocol === 'string' && EMBEDDED_PROTOCOLS_SET.has(protocol)) {
    if (protocol !== 'mem') {
      if (typeof path !== 'string' || path.length === 0) {
        return {
          success: false,
          error: `Embedded protocol '${protocol}' requires a 'path' field`,
        }
      }
    }
    return { success: true }
  }

  const hostResult = validateHost(host)
  if (!hostResult.success) return hostResult

  const portResult = validatePort(port)
  if (!portResult.success) return portResult

  const usernameResult = validateUsername(username)
  if (!usernameResult.success) return usernameResult

  const passwordResult = validatePassword(password)
  if (!passwordResult.success) return passwordResult

  return { success: true }
}

/**
 * Assert function that throws a ZodValidationError if validation fails
 * @param validationResult - The result of a validation function
 * @param context - Optional context for error reporting
 * @throws {ZodValidationError} If validation fails
 */
export function assertValidation(validationResult: ValidationResult, context?: string): void {
  if (!validationResult.success) {
    const message = context ? `${context}: ${validationResult.error}` : validationResult.error!
    throw new ZodValidationError(message)
  }
}

/**
 * Safe validator that returns a result object instead of throwing
 * @param validator - The validation function to call
 * @param data - The data to validate
 * @returns Object with success boolean and either error or data
 */
export function safeValidate<T>(
  validator: (data: unknown) => ValidationResult,
  data: T,
): { success: true; data: T } | { success: false; error: $ZodError } {
  try {
    const result = validator(data)
    if (result.success) {
      return { success: true, data }
    } else {
      return { success: false, error: intoZodError(result.error!) }
    }
  } catch (error) {
    return { success: false, error: intoZodError(error) }
  }
}

/**
 * Sanitize and validate an object's properties recursively
 * @param obj - The object to sanitize
 * @param maxDepth - Maximum recursion depth to prevent infinite loops
 * @returns Sanitized object
 */
export function sanitizeObject(obj: unknown, maxDepth = 10): unknown {
  if (maxDepth <= 0) {
    throw new Error('Maximum recursion depth exceeded during object sanitization')
  }

  if (obj === null || obj === undefined) {
    return obj
  }

  if (typeof obj === 'string') {
    const result = validateQueryValue(obj)
    if (!result.success) {
      throw new Error(result.error)
    }
    return obj
  }

  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return obj
  }

  if (Array.isArray(obj)) {
    if (obj.length > 1000) {
      throw new Error('Arrays cannot exceed 1000 elements')
    }
    return obj.map((item) => sanitizeObject(item, maxDepth - 1))
  }

  if (typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {}
    const entries = Object.entries(obj as Record<string, unknown>)

    if (entries.length > 100) {
      throw new Error('Objects cannot have more than 100 properties')
    }

    for (const [key, value] of entries) {
      const fieldResult = validateFieldName(key)
      if (!fieldResult.success) {
        throw new Error(fieldResult.error)
      }
      sanitized[key] = sanitizeObject(value, maxDepth - 1)
    }
    return sanitized
  }

  throw new Error(`Unsupported data type: ${typeof obj}`)
}
