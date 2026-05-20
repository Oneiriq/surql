import { assertNonSensitiveString } from './asserts.ts'
import { PATTERNS } from '../constants.ts'
import type { RecordId } from 'surrealdb'
import type { AnyFn } from '../crud/types.ts'

/**
 * Safely stringify an object, handling circular references and sensitive data
 * @param obj - The object to stringify
 * @returns Safe JSON string representation
 */
export function safeJsonStringify(obj: unknown): string {
  const seen = new WeakSet()

  try {
    return JSON.stringify(obj, (key, value) => {
      // Remove sensitive keys
      const sensitiveKeys = ['password', 'token', 'secret', 'key', 'authorization', 'credentials']
      if (typeof key === 'string' && sensitiveKeys.some((k) => key.toLowerCase().includes(k))) {
        return '[REDACTED]'
      }

      // Handle circular references
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]'
        }
        seen.add(value)
      }

      return value
    })
  } catch {
    return '[Object could not be serialized]'
  }
}

/**
 * Truncate message to prevent overly long error messages
 * @param message - The message to truncate
 * @param maxLength - Maximum allowed length
 * @returns Truncated message
 */
export function truncateMessage(message: string, maxLength: number): string {
  if (message.length <= maxLength) {
    return message
  }
  return message.substring(0, maxLength - 3) + '...'
}

/**
 * Determine if we're running in a production environment
 * Checks DENO_ENV or ENV environment variables
 * @returns true if in production, false otherwise
 */
export function isProductionEnvironment(): boolean {
  try {
    const env = Deno.env.get('DENO_ENV') || Deno.env.get('ENV') || 'development'
    return env === 'production'
  } catch {
    // If we can't access environment variables, default to development
    return false
  }
}

/**
 * Sanitize error messages to prevent sensitive information exposure
 * @param message - The error message to sanitize
 * @param includeDetails - Whether to include detailed error information
 * @returns Sanitized error message
 */
export function sanitizeErrorMessage(message: string, includeDetails: boolean): string {
  if (!includeDetails) {
    try {
      assertNonSensitiveString(message, PATTERNS.SANITIZE.SENSITIVE, 'Sanitized Error message')
    } catch (e) {
      return `Sensitive error: ${(e as Error).message}`
    }

    // Hide internal file paths and system information
    let sanitized = message
    for (const pattern of PATTERNS.PATHS) {
      sanitized = sanitized.replace(pattern, '[internal]')
    }

    // Filter out any SQL injection patterns
    for (const pattern of PATTERNS.SQL.CLAUSE_INJECTION_PATTERNS) {
      sanitized = sanitized.replace(pattern, '[filtered]')
    }

    return sanitized
  }

  // In development, return the full message but still sanitize obvious secrets
  let sanitized = message
  for (const pattern of PATTERNS.SANITIZE.SECRET) {
    sanitized = sanitized.replace(pattern, (_match, p1, p2) => {
      return `${p1}${p2 || ''}[omitted]`
    })
  }

  return sanitized
}

/**
 * Strip SurrealDB v3 wire-format angle brackets from a record-id-shaped string.
 *
 * SurrealDB v3 wraps record-id keys that contain special characters in unicode
 * angle brackets — `'outlet:⟨alaskabeacon.com⟩'`, `'plan_chunk:⟨demo-plan-ff3d5981⟩'`.
 * Downstream callers that want the bare `table:id` shape (API responses, log
 * lines, string-keyed lookups) previously had to call
 * `value.replace('⟨', '').replace('⟩', '')` themselves at every boundary. This
 * helper centralises that strip.
 *
 * Both forms are accepted on input: the v3 unicode brackets (`⟨…⟩`, U+27E8 /
 * U+27E9) and the legacy ASCII brackets (`<…>`). `null` and `undefined` are
 * passed through untouched so the helper is safe to apply unconditionally.
 *
 * @example
 * stripBrackets('outlet:⟨alaska.com⟩')        // 'outlet:alaska.com'
 * stripBrackets('plan_chunk:⟨demo-plan-ff3d5981⟩')  // 'plan_chunk:demo-plan-ff3d5981'
 * stripBrackets('user:alice')                  // 'user:alice'   (untouched)
 * stripBrackets('outlet:<legacy.com>')         // 'outlet:legacy.com'  (ASCII form)
 * stripBrackets(null)                          // null
 */
export function stripBrackets<T extends string | null | undefined>(value: T): T {
  if (value === null || value === undefined) return value
  // Unicode brackets first (the v3 norm), then ASCII as a fallback. Both forms
  // are stripped because some clients still emit the legacy ASCII shape.
  return value.replace(/[⟨⟩<>]/g, '') as T
}

/**
 * Convert a SurrealDB RecordId to a bare `table:id` string.
 *
 * Strings are returned as-is; RecordId instances are stringified through the
 * SDK's `toString()` and then run through {@link stripBrackets} so the result
 * is the bare wire form without v3's escape brackets.
 *
 * @param recordId - The RecordId or string to convert
 * @returns The string representation with brackets stripped
 */
export function recordIdToString(recordId: RecordId | string): string {
  if (typeof recordId === 'string') return recordId
  return stripBrackets(recordId.toString())
}

/**
 * Normalize a SurrealDB record by converting the RecordId to a string
 *
 * @param record - The record to normalize
 * @returns - A new record with the id converted to a string
 */
export function normalizeSurrealRecord<T extends { id: RecordId }>(
  record: T,
): Omit<T, 'id'> & { id: string } {
  const { id, ...rest } = record
  return {
    ...rest,
    id: recordIdToString(id),
  } as Omit<T, 'id'> & { id: string }
}

/**
 * Normalize an array of SurrealDB records by converting the RecordIds to strings
 *
 * @param records - The records to normalize
 * @returns - A new array with normalized records
 */
export function normalizeSurrealRecords<T extends { id: RecordId }>(
  records: T[],
): (Omit<T, 'id'> & { id: string })[] {
  return records.map(normalizeSurrealRecord)
}

/**
 * Decode and validate a JWT token, extracting the payload only after signature verification
 * @param token - The JWT token to decode and validate
 * @param secret - Optional secret key for verification (if not provided, only basic validation is performed)
 * @returns The decoded payload
 * @throws Error if token is invalid or signature verification fails
 */
export async function validateAndDecodeJWTPayload<T = unknown>(token: string, secret?: string): Promise<T> {
  if (!token || typeof token !== 'string') {
    throw new Error('Invalid JWT token: token must be a non-empty string')
  }

  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid JWT token: must have exactly 3 parts')
  }

  const [headerB64, payloadB64, _signatureB64] = parts

  let header: { alg?: string; typ?: string }
  try {
    const headerPadded = base64UrlDecode(headerB64)
    header = JSON.parse(headerPadded)
    if (header.typ && header.typ !== 'JWT') {
      throw new Error('Invalid JWT token: incorrect type')
    }
  } catch (e) {
    throw new Error(`Invalid JWT token: malformed header - ${e instanceof Error ? e.message : String(e)}`)
  }

  let payload: T
  try {
    const payloadDecoded = base64UrlDecode(payloadB64)
    payload = JSON.parse(payloadDecoded) as T
  } catch (e) {
    throw new Error(`Invalid JWT token: malformed payload - ${e instanceof Error ? e.message : String(e)}`)
  }

  if (typeof payload === 'object' && payload !== null && 'exp' in payload) {
    const exp = (payload as { exp: unknown }).exp
    if (typeof exp === 'number' && exp * 1000 < Date.now()) {
      throw new Error('JWT token has expired')
    }
  }

  // Verify signature when secret is provided
  if (secret && header.alg) {
    try {
      await verifyJWTSignature(token, secret, header.alg)
    } catch (e) {
      throw new Error(`JWT signature verification failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return payload
}

/**
 * Decode base64url encoded string
 * @param base64url - The base64url encoded string
 * @returns The decoded string
 */
function base64UrlDecode(base64url: string): string {
  // Replace URL-safe characters with standard base64 characters
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  // Add padding if necessary
  const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=')
  return atob(padded)
}

/**
 * Verify JWT signature using Web Crypto API
 * @param token - The JWT token to verify
 * @param secret - The secret key for verification
 * @param algorithm - The signing algorithm
 */
async function verifyJWTSignature(token: string, secret: string, algorithm: string): Promise<void> {
  const [headerB64, payloadB64, signatureB64] = token.split('.')
  const data = `${headerB64}.${payloadB64}`

  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: getHashAlgorithm(algorithm) },
    false,
    ['verify'],
  )

  const signature = base64UrlToUint8Array(signatureB64).buffer as ArrayBuffer
  const isValid = await globalThis.crypto.subtle.verify(
    'HMAC',
    key,
    signature,
    new TextEncoder().encode(data),
  )

  if (!isValid) {
    throw new Error('Invalid JWT signature')
  }
}

/**
 * Convert base64url string to Uint8Array
 * @param base64url - The base64url encoded string
 * @returns Uint8Array representation
 */
function base64UrlToUint8Array(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=')
  const binaryString = atob(padded)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

/**
 * Get hash algorithm for Web Crypto API
 * @param algorithm - JWT algorithm
 * @returns Hash algorithm name
 */
function getHashAlgorithm(algorithm: string): string {
  switch (algorithm) {
    case 'HS256':
      return 'SHA-256'
    case 'HS384':
      return 'SHA-384'
    case 'HS512':
      return 'SHA-512'
    default:
      throw new Error(`Unsupported JWT algorithm: ${algorithm}`)
  }
}

/**
 * Helper type for serializing nested objects without requiring id field
 */
type SerializedObject<T> = {
  [K in keyof T]: SerializedValue<T[K]>
}

/**
 * Map a value to its serialized form:
 * - RecordId ➔ string
 * - Date     ➔ string
 * - Object   ➔ recursively serialized
 * - Other    ➔ unchanged
 */
type SerializedValue<T> = T extends RecordId ? string
  : T extends Date ? string
  : T extends (Date | null) ? string | null
  : T extends (Date | undefined) ? string | undefined
  : T extends (Date | null | undefined) ? string | null | undefined
  : T extends object ? SerializedObject<T>
  : T

/**
 * Serializes all properties of a type T for JSON or API transmission:
 * - For each property, applies SerializedValue to map RecordId and Date to string, and objects recursively
 * - Preserves optional properties (e.g., Date | undefined becomes string | undefined)
 * - Ensures the shape of T is maintained, but with all fields in their serialized (JSON-safe) form
 *
 * Example:
 *   // Given:
 *   interface CommentRaw {
 *     id: RecordId
 *     createdAt: Date
 *     editedAt?: Date
 *   }
 *   // Then:
 *   Serialized<CommentRaw> == {
 *     id: string
 *     createdAt: string
 *     editedAt?: string
 *   }
 */
export type Serialized<T> = SerializedObject<T>

/**
 * Serializer type for SurrealDB records
 * Provides methods to convert RecordId and Date fields to their string representations
 * and allows for custom serialization logic
 *
 * @template R - Raw record type with RecordId and Date objects
 * @returns Serializer object with methods for common transformations
 */
export type Serializer<R extends { id: RecordId }> = {
  id: (record: R) => string
  date: (date: Date) => string
  recordId: (recordId: RecordId) => string
  optionalDate: (date?: Date) => string | undefined
  optionalRecordId: (recordId?: RecordId) => string | undefined
  optionalNumber: (n?: number) => number | undefined
  dateOrNull: (date: Date | null) => string | null
  recordIdArray: (recordIds: RecordId[]) => string[]
  dateArray: (dates: Date[]) => string[]
  number: (n: number) => number
  numberOrNull: (n: number | null) => number | null
  // deno-lint-ignore no-explicit-any
  objectArray: <T>(arr: T[], serializer: (obj: T) => any) => any[]
  // deno-lint-ignore no-explicit-any
  optionalObject: <T>(obj: T | undefined, serializer: (obj: T) => any) => any | undefined
  // deno-lint-ignore no-explicit-any
  extend: (more: Record<string, (...args: any[]) => any>) => Serializer<R> & typeof more
  // deno-lint-ignore no-explicit-any
} & Record<string, (...args: any[]) => any>

/**
 * Creates a collection of common serialization functions for transforming
 * raw database types to serializable types
 *
 * @template R - Raw database record type with RecordId and Date objects
 * @returns Object containing common transformation utilities
 * @example
 * ```typescript
 * interface UserRaw {
 *   id: RecordId
 *   name: string
 *   createdAt: Date
 * }
 *
 * const serializer = createSerializer<UserRaw>()
 *
 * const mapUser = (raw: UserRaw) => ({
 *   id: serializer.id(raw),
 *   name: raw.name,
 *   createdAt: serializer.date(raw.createdAt)
 * })
 * ```
 */
export const createSerializer = <R extends { id: RecordId }>(
  // deno-lint-ignore no-explicit-any
  custom?: Record<string, (...args: any[]) => any>,
): Serializer<R> => {
  const base = {
    /**
     * Convert a RecordId to string representation
     *
     * @param record - Record containing RecordId
     * @returns String representation of the RecordId
     */
    id: (record: R): string => record.id.toString(),

    /**
     * Convert a Date object to ISO string representation
     *
     * @param date - Date object to convert
     * @returns ISO string representation of the date
     */
    date: (date: Date): string => date.toISOString(),

    /**
     * Convert a RecordId field directly to string
     *
     * @param recordId - RecordId to convert
     * @returns String representation of the RecordId
     */
    recordId: (recordId: RecordId): string => recordId.toString(),

    /**
     * Convert an optional Date to ISO string or undefined
     *
     * @param date - Optional Date object to convert
     * @returns ISO string representation or undefined
     */
    optionalDate: (date?: Date): string | undefined => date?.toISOString(),

    /**
     * Convert an optional RecordId to string or undefined
     *
     * @param recordId - Optional RecordId to convert
     * @returns String representation or undefined
     */
    optionalRecordId: (recordId?: RecordId): string | undefined => recordId?.toString(),

    /**
     * Convert an optional number to number or undefined
     *
     * @param n - Optional number to convert
     * @returns Number or undefined
     */
    optionalNumber: (n?: number): number | undefined => n,

    /**
     * Convert a Date or null to ISO string or null
     *
     * @param date - Date or null to convert
     * @returns ISO string representation or null
     */
    dateOrNull: (date: Date | null): string | null => (date ? date.toISOString() : null),

    /**
     * Convert an array of RecordIds to strings
     *
     * @param recordIds - Array of RecordIds to convert
     * @returns Array of string representations
     */
    recordIdArray: (recordIds: RecordId[]): string[] => recordIds.map((id) => id.toString()),

    /**
     * Convert an array of Dates to ISO strings
     *
     * @param dates - Array of Dates to convert
     * @returns Array of ISO string representations
     */
    dateArray: (dates: Date[]): string[] => dates.map((date) => date.toISOString()),

    /**
     * Pass through a number
     *
     * @param n - Number value
     * @returns The same number
     */
    number: (n: number): number => n,

    /**
     * Pass through a number or null (type consistency)
     *
     * @param n - Number value or null
     * @returns The same number or null
     */
    numberOrNull: (n: number | null): number | null => n,

    /**
     * Serialize an array of objects using a provided serializer function
     *
     * @param arr - Array of objects
     * @param serializer - Function to serialize each object
     * @returns Array of serialized objects
     */
    // deno-lint-ignore no-explicit-any
    objectArray: <T>(arr: T[], serializer: (obj: T) => any): any[] => arr.map(serializer),

    /**
     * Serialize an object using a provided serializer function
     *
     * @param obj - Object to serialize
     * @param serializer - Function to serialize the object
     * @returns Serialized object or undefined if input is undefined
     */
    // deno-lint-ignore no-explicit-any
    optionalObject: <T>(obj: T | undefined, serializer: (obj: T) => any): any | undefined =>
      obj ? serializer(obj) : undefined,

    /**
     * Extend the serializer with additional custom serialization logic
     * @param obj - Object containing additional serialization methods
     * @returns Extended serializer object
     */
    // deno-lint-ignore no-explicit-any
    extend(obj: Record<string, (...args: any[]) => any>) {
      return { ...base, ...obj }
    },
  }

  return {
    ...base,
    ...(custom || {}),
  }
}

/**
 * Check if a value is a primitive type or null/undefined
 * @param value - The value to check
 * @returns True if the value is a primitive type or null/undefined, false otherwise
 */
export function isPrimitiveOrNullish(value: unknown): value is boolean | number | null | undefined {
  return (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  )
}

/**
 * Check if a value is a string
 * @param value - The value to check
 * @returns True if the value is a string, false otherwise
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

/**
 * Check if a value is a number
 * @param value - The value to check
 * @returns True if the value is a number, false otherwise
 */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number'
}

/**
 * Check if a value is a boolean
 * @param value - The value to check
 * @returns True if the value is a boolean, false otherwise
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

/**
 * Check if a value is an object (excluding arrays and null)
 * @param value - The value to check
 * @returns True if the value is an object, false otherwise
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Check if a value is an array
 * @param value - The value to check
 * @returns True if the value is an array, false otherwise
 */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

/**
 * Check if a value is a function
 * @param value - The value to check
 * @returns True if the value is a function, false otherwise
 */
export function isFunction(value: unknown): value is AnyFn {
  return typeof value === 'function'
}

/**
 * Check if a value is less than another value
 * @param a - The first value
 * @param b - The second value
 * @returns True if the first value is less than the second value, false otherwise
 */
export function lessThan(a: number, b: number): boolean {
  return a < b
}

/**
 * Check if a value is greater than another value
 * @param a - The first value
 * @param b - The second value
 * @returns True if the first value is greater than the second value, false otherwise
 */
export function greaterThan(a: number, b: number): boolean {
  return a > b
}

/**
 * Check if two values are equal
 * @param a - The first value
 * @param b - The second value
 * @returns True if the two values are equal, false otherwise
 */
export function equalTo(a: number, b: number): boolean {
  return a === b
}
