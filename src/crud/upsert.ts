import { intoSurQlError } from '../utils/surrealError.ts'
import type { RecordId } from 'surrealdb'
import type { SurrealDbTable } from '../crud/types.ts'
import { type ConnectionProvider, QueryBuilder, type QueryOptions } from './base.ts'

/**
 * A builder class for UPSERT operations in SurrealDB
 *
 * Upsert operations perform insert-or-update logic, creating a new record
 * if it doesn't exist or updating it if it does exist.
 *
 * @template R - Raw database record type (with RecordId and Date objects)
 * @template T - Processed/serializable type (with string fields)
 */
export class UpsertQL<R extends { id: RecordId }, T = unknown> extends QueryBuilder<R, T> {
  private targetId?: string | RecordId
  private upsertData: Record<string, unknown>
  private conflictFields: string[] = []

  /**
   * Create a new UpsertQL builder for the specified table
   *
   * @param connectionProvider - Database connection provider
   * @param table - The SurrealDB table to upsert into
   * @param data - The data for the upsert operation
   * @param options - Query options for controlling behavior
   */
  constructor(
    connectionProvider: ConnectionProvider,
    table: SurrealDbTable,
    data: Record<string, unknown>,
    options: QueryOptions = {},
  ) {
    super(connectionProvider, table, options)
    this.upsertData = data
  }

  /**
   * Specify the record ID for upsert operation
   *
   * @param id - Record ID to use for the upsert
   * @returns this - For method chaining
   * @example
   * const user = await client.upsert('users', {
   *   username: 'jane_doe',
   *   email: 'jane@example.com',
   *   name: 'Jane Doe'
   * })
   *   .withId('user:jane_doe')
   *   .map(mapUser)
   *   .execute()
   */
  withId(id: string | RecordId): this {
    this.targetId = id.toString()
    return this
  }

  /**
   * Specify fields to check for conflicts during upsert
   *
   * When these fields match existing records, the operation will update
   * instead of creating a new record.
   *
   * @param fields - Field names to check for uniqueness/conflicts
   * @returns this - For method chaining
   * @example
   * const user = await client.upsert('users', {
   *   username: 'jane_doe',
   *   email: 'jane@example.com',
   *   name: 'Jane Doe'
   * })
   *   .onConflict('username', 'email')
   *   .map(mapUser)
   *   .execute()
   */
  onConflict(...fields: string[]): this {
    // Validate field names
    fields.forEach((field) => this.validateFieldName(field))
    this.conflictFields = fields
    return this
  }

  /**
   * Execute the upsert operation and return the result
   *
   * This method performs an upsert operation that either creates a new record
   * or updates an existing one based on the specified ID or conflict fields.
   *
   * @returns Promise<T> - The created or updated record
   * @throws - Throws an error if the operation fails
   * @example
   * // Upsert with specific ID
   * const product = await client.upsert('products', {
   *   name: 'Widget Pro',
   *   price: 29.99,
   *   category: 'electronics'
   * })
   *   .withId('product:widget-pro')
   *   .map(mapProduct)
   *   .execute()
   *
   * // Upsert with conflict detection
   * const user = await client.upsert('users', {
   *   username: 'unique_user',
   *   email: 'user@example.com',
   *   preferences: { theme: 'dark' }
   * })
   *   .onConflict('username')
   *   .map(mapUser)
   *   .execute()
   */
  async execute(): Promise<T> {
    try {
      // Check if we have an explicit record ID from withId() method
      let targetId = this.targetId

      // If no explicit ID is set, check if there's an 'id' field in the data
      if (!targetId && this.upsertData.id) {
        targetId = this.upsertData.id.toString()
      }

      // Prepare the data - if we're using an ID from the data object, remove it from the content
      let upsertContent = this.upsertData
      if (!this.targetId && targetId && this.upsertData.id) {
        // Create a copy of data without the id field to avoid duplication

        const { _id, ...rest } = this.upsertData
        upsertContent = rest
      }

      let query: string
      let params: Record<string, unknown>

      if (targetId) {
        // Upsert with specific ID - use SurrealDB's upsert capability
        query = `UPSERT ${this.table}:${targetId} CONTENT $data`
        params = { data: upsertContent, ...this.params }
      } else if (this.conflictFields.length > 0) {
        // Upsert with conflict detection - use conditional logic
        const conflictConditions = this.conflictFields
          .map((field, index) => {
            const paramName = `conflict_${index}`
            return `${field} = $${paramName}`
          })
          .join(' AND ')

        // Build a query that checks for existing records and updates or creates accordingly
        query = `
  					LET $existing = (SELECT * FROM ${this.table} WHERE ${conflictConditions} LIMIT 1);
  					RETURN IF $existing {
  						UPDATE $existing[0].id MERGE $data
  					} else {
  						CREATE ${this.table} CONTENT $data
  					};
  				`
        params = { data: upsertContent, ...this.params }

        // Add conflict field parameters
        const conflictParams = this.conflictFields.reduce((acc, field, index) => {
          acc[`conflict_${index}`] = this.upsertData[field]
          return acc
        }, {} as Record<string, unknown>)

        params = { ...params, ...conflictParams }
      } else {
        // Simple upsert without ID or conflict fields - just create
        query = `CREATE ${this.table} CONTENT $data`
        params = { data: upsertContent, ...this.params }
      }

      const records = await this.executeQuery<R[]>(query, params)

      if (!records || records.length === 0) {
        throw intoSurQlError('Upsert operation returned no records')
      }

      const mappedResult = this.mapResults(records, true)

      // For upsert operations, we expect a single result
      return Array.isArray(mappedResult) ? mappedResult[0] : mappedResult
    } catch (e) {
      if (e instanceof Error && e.message.includes('returned no records')) {
        throw e // Re-throw our specific error
      }
      throw intoSurQlError('Upsert operation failed:', e)
    }
  }

  /**
   * Validate field name to prevent injection attacks
   * @private
   * @param field - Field name to validate
   */
  private validateFieldName(field: string): void {
    if (typeof field !== 'string' || field.length === 0) {
      throw new Error('Field name must be a non-empty string')
    }

    // Prevent common SQL injection patterns FIRST (before regex validation)
    const dangerousPatterns = [
      /;/, // Statement terminator
      /--/, // SQL comments
      /\/\*/, // Block comments
      /\*\//, // Block comments
      /\bunion\b/i, // UNION attacks
      /\bselect\b/i, // SELECT injections
      /\binsert\b/i, // INSERT injections
      /\bupdate\b/i, // UPDATE injections
      /\bdelete\b/i, // DELETE injections
      /\bdrop\b/i, // DROP injections
    ]

    for (const pattern of dangerousPatterns) {
      if (pattern.test(field)) {
        throw new Error('Potentially dangerous field name detected')
      }
    }

    // Allow alphanumeric characters, underscores, dots (for nested fields), and hyphens
    const fieldNamePattern = /^[a-zA-Z0-9_.:-]+$/
    if (!fieldNamePattern.test(field)) {
      throw new Error(
        `Invalid field name: ${field}. Field names can only contain letters, numbers, dots, underscores, colons, and hyphens`,
      )
    }
  }
}

/**
 * Create an upsert operation for the specified table
 *
 * @template R - Raw database record type (with RecordId and Date objects)
 * @template T - Processed/serializable type (with string fields)
 * @param connectionProvider - Database connection provider
 * @param table - The SurrealDB table to upsert into
 * @param data - The data for the upsert operation
 * @param options - Optional query options for controlling behavior
 * @returns A new UpsertQL instance
 * @example
 * const savedUser = await upsert(connectionProvider, 'users', {
 *   username: 'admin',
 *   email: 'admin@example.com',
 *   role: 'administrator'
 * })
 *   .withId('user:admin')
 *   .map(mapUser)
 *   .execute()
 */
export function upsert<R extends { id: RecordId }, T = R>(
  connectionProvider: ConnectionProvider,
  table: SurrealDbTable,
  data: Record<string, unknown>,
  options?: QueryOptions,
): UpsertQL<R, T> {
  return new UpsertQL<R, T>(connectionProvider, table, data, options || {})
}
