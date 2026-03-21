import { intoSurQlError } from '../utils/surrealError.ts'
import { intoZodMappingError } from '../utils/zodError.ts'
import { normalizeSurrealRecord } from '../utils/helpers.ts'
import type { SurrealDbTable } from '../crud/types.ts'
import type { RecordId, Surreal } from 'surrealdb'

/**
 * Interface for database connection provider
 */
export interface ConnectionProvider {
  getConnection(): Promise<Surreal>
}

/**
 * Query options for controlling query behavior
 */
export interface QueryOptions {
  warnings?: 'show' | 'suppress' | 'error'
}

/**
 * Comparison operators for WHERE conditions
 */
export enum Op {
  EQUALS = '=',
  NOT_EQUALS = '!=',
  GREATER_THAN = '>',
  GREATER_THAN_OR_EQUAL = '>=',
  LESS_THAN = '<',
  LESS_THAN_OR_EQUAL = '<=',
  CONTAINS = 'CONTAINS',
  INSIDE = 'INSIDE',
  NOT_CONTAINS = 'NOT CONTAINS',
  OUTSIDE = 'OUTSIDE',
  LIKE = '~',
  NOT_LIKE = '!~',
}

/**
 * Sort direction for ORDER BY clauses
 */
export enum SortDirection {
  ASC = 'ASC',
  DESC = 'DESC',
}

/**
 * Condition object for WHERE clauses
 */
export interface Condition {
  field: string
  operator: Op
  value: unknown
}

/**
 * Order configuration for ORDER BY clauses
 */
export interface OrderBy {
  field: string
  direction?: SortDirection
}

/**
 * Base class for all SurrealDB query builders
 * Provides common functionality and type safety
 *
 * @template R - Raw database record type (with RecordId and Date objects)
 * @template T - Processed/serializable type (with string fields)
 */
export abstract class QueryBuilder<R extends { id: RecordId }, T = unknown> {
  protected table: SurrealDbTable
  protected context: string
  protected mapper?: (raw: R) => T
  protected params: Record<string, unknown> = {}
  protected connectionProvider: ConnectionProvider
  protected options: QueryOptions

  /**
   * Create a new query builder
   *
   * @param connectionProvider - Database connection provider
   * @param table - The SurrealDB table to query
   * @param options - Query options for controlling behavior
   */
  constructor(connectionProvider: ConnectionProvider, table: SurrealDbTable, options: QueryOptions = {}) {
    this.connectionProvider = connectionProvider
    this.table = table
    this.context = 'surql:default'
    this.options = options
  }

  /**
   * Set the mapping function for the query results
   *
   * @param mapFn - Function to transform raw records
   * @returns - The query builder instance
   */
  map(mapFn: (raw: R) => T): this {
    this.mapper = mapFn
    return this
  }

  /**
   * Add a raw parameter to the query
   *
   * @param name - Parameter name
   * @param value - Parameter value
   * @returns - The query builder instance
   */
  withParam(name: string, value: unknown): this {
    this.params[name] = value
    return this
  }

  /**
   * Execute the query and return the results
   *
   * @returns - Promise containing query results
   */
  abstract execute(): Promise<T | T[]>

  /**
   * Add context to the query (no-op since logging removed)
   *
   * @param context - Context string (ignored)
   * @returns - The query builder instance
   */
  withContext(_context: string): this {
    // No-op since logging is removed for minimal library
    return this
  }

  /**
   * Validate that a mapper function has been provided or provide a warning if optional
   *
   * @param isOptional - Whether mapper is optional (when T = R)
   * @throws - Error if no mapper is set and not optional
   */
  protected validateMapper(isOptional: boolean = false): void {
    const warningBehavior = this.options.warnings || 'show'

    if (!this.mapper) {
      if (warningBehavior === 'error') {
        throw new Error('Mapper function is required')
      }
      if (isOptional && warningBehavior === 'show') {
        console.warn(
          'SurQL: No mapper function provided. RecordId fields will be normalized to strings automatically, ' +
            'but other database types (Date) will be returned as-is. ' +
            'Consider using .map() to transform to fully serializable types, or use the Serialized<T> utility type.',
        )
      }
      // warningBehavior === 'suppress': do nothing
    }
  }

  /**
   * Map raw results to the output type using the provided mapper function
   * This handles various SurrealDB response formats:
   * - [R[]] - Standard query results (array containing array of records)
   * - [R] - Single record in an array (common for create/update/delete)
   * - R[] - Array of records (less common)
   * - R - Single record (uncommon)
   *
   * @param records - Raw records from SurrealDB
   * @param isOptional - Whether mapper is optional (when T = R)
   * @returns - Mapped records
   */
  protected mapResults(records: unknown, isOptional: boolean = false): T | T[] {
    this.validateMapper(isOptional)

    try {
      // Handle null/undefined responses
      if (!records) {
        return [] as T[]
      }

      // If no mapper provided and optional, normalize RecordId fields and return
      if (!this.mapper && isOptional) {
        // Handle the common SurrealDB response format [R[]] (query results)
        if (Array.isArray(records) && records.length === 1 && Array.isArray(records[0])) {
          return (records[0] as R[]).map((r) => normalizeSurrealRecord(r)) as unknown as T[]
        }

        // Handle empty array response
        if (Array.isArray(records) && records.length === 0) {
          return [] as T[]
        }

        // Handle array of single record [R] (common for create/update/delete)
        if (Array.isArray(records) && records.length === 1 && !Array.isArray(records[0])) {
          return normalizeSurrealRecord(records[0] as R) as unknown as T
        }

        // Handle flat array of records R[] (less common)
        if (Array.isArray(records)) {
          return (records as R[]).map((r) => normalizeSurrealRecord(r)) as unknown as T[]
        }

        // Handle single record R (uncommon)
        return normalizeSurrealRecord(records as R) as unknown as T
      }

      // Handle the common SurrealDB response format [R[]] (query results)
      if (Array.isArray(records) && records.length === 1 && Array.isArray(records[0])) {
        const innerRecords = records[0] as R[]
        const mapped = innerRecords.map((r: R) => this.mapper!(r))
        return mapped
      }

      // Handle empty array response
      if (Array.isArray(records) && records.length === 0) {
        return [] as T[]
      }

      // Handle array of single record [R] (common for create/update/delete)
      if (Array.isArray(records) && records.length === 1 && !Array.isArray(records[0])) {
        const singleRecord = records[0] as R
        const mapped = this.mapper!(singleRecord)
        return mapped
      }

      // Handle flat array of records R[] (less common)
      if (Array.isArray(records)) {
        const mapped = records.map((r: R) => this.mapper!(r))
        return mapped
      }

      // Handle single record R (uncommon)
      const mapped = this.mapper!(records as R)
      return mapped
    } catch (e) {
      throw intoZodMappingError(e, 'Record mapping failed!')
    }
  }

  /**
   * Execute a SurrealDB query
   *
   * @param query - The query string
   * @param params - Query parameters
   * @returns - Promise containing query results
   */
  protected async executeQuery<TResult>(
    query: string,
    params: Record<string, unknown> = {},
  ): Promise<TResult[]> {
    try {
      const db = await this.connectionProvider.getConnection()
      const results = await db.query<TResult[]>(query, params) as TResult[][]
      return results[0] || [] as TResult[]
    } catch (e) {
      throw intoSurQlError('Query execution failed:', e)
    }
  }
}
