import type { RecordId } from 'surrealdb'
import {
  type Condition,
  type ConnectionProvider,
  Op,
  type OrderBy,
  QueryBuilder,
  type QueryOptions,
  SortDirection,
} from './base.ts'
import type { SurrealDbTable } from '../crud/types.ts'

/**
 * A fluent and object-style query builder for SELECT operations using SurrealDB.
 *
 * This class allows you to construct complex queries using a fluent interface,
 * supporting WHERE conditions, ORDER BY clauses, LIMIT/OFFSET pagination,
 * and field selection. It also provides methods for executing the query and
 * mapping results to a specified type.
 *
 * @template R - Raw database record type (with RecordId and Date objects)
 * @template T - Processed/serializable type (with string fields)
 */
export class ReadQL<R extends { id: RecordId }, T = unknown> extends QueryBuilder<R, T> {
  private conditions: Condition[] = []
  private orderByConfig: OrderBy[] = []
  private limitValue?: number
  private offsetValue?: number
  private selectFields: string[] = []
  private whereObject?: Record<string, unknown>

  // Enhanced capabilities
  private groupByFields: string[] = []
  private havingConditions: string[] = []
  private aggregations: string[] = []

  /**
   * Create a new query builder for the specified table
   *
   * @param connectionProvider - Database connection provider
   * @param table - The SurrealDB table to query
   * @param options - Query options for controlling behavior
   * @return - A new ReadQL instance
   * @example
   * const usersQuery = query('users');             // Creates a new ReadQL instance for the 'users' table
   * await usersQuery
   *   .where({ status: 'Active' })                 // Adds a WHERE condition
   *   .orderBy('created_at', SortDirection.DESC)   // Orders results by creation date
   *   .limit(10)                                   // Limits results to 10 records
   *   .execute()                                   // Executes the query
   */
  constructor(connectionProvider: ConnectionProvider, table: SurrealDbTable, options: QueryOptions = {}) {
    super(connectionProvider, table, options)
  }

  /**
   * Add a WHERE condition (Object-Style)
   *
   * @param conditions - Object with field-value pairs
   * @returns - The query builder instance
   * @example
   * query('users').where({ status: 'Active', preferences.privacy.mode: 'Named' }); // Matches users with status 'Active' and privacy mode 'Named'
   * query('users').where({ active: true, role: 'admin' });                         // Matches active admins
   */
  where(conditions: Record<string, unknown>): this

  /**
   * Add a WHERE condition (Fluent-Style)
   *
   * @param field - Field name
   * @param operator - Comparison operator
   * @param value - Value to compare against
   * @param operator - The comparison operator (EQUALS, CONTAINS, LIKE, etc.)
   * @returns - The query builder instance
   * @example
   * query('users').where('username', Operator.EQUALS, 'puffin123');              // Matches users with username 'puffin123'
   * query('users').where('preferences.privacy.mode', Operator.EQUALS, 'Named');  // Matches users with privacy mode 'Named'
   */
  where(field: string, operator: Op, value: unknown): this

  /**
   * Add a WHERE condition using either an Object or Fluent style queries
   *
   * @param fieldOrConditions - Field name or object with field-value pairs
   * @param operator - Comparison operator (optional, used in fluent style)
   * @param value - Value to compare against (optional, used in fluent style)
   * @returns - The query builder instance
   * @example
   * query('users').where({ status: 'Active' });                // Object style: Matches users with status 'Active'
   * query('users').where('status', Operator.EQUALS, 'Active'); // Fluent style: Matches users with status 'Active'
   */
  where(fieldOrConditions: string | Record<string, unknown>, operator?: Op, value?: unknown): this {
    if (typeof fieldOrConditions === 'string' && operator !== undefined && value !== undefined) {
      // Fluent style: where(field, operator, value)
      this.conditions.push({ field: fieldOrConditions, operator, value })
    } else if (typeof fieldOrConditions === 'object') {
      // Object style: where({ field1: value1, field2: value2 })
      this.whereObject = { ...this.whereObject, ...fieldOrConditions }
    }
    return this
  }

  /**
   * Add WHERE condition with equals operator (shorthand)
   *
   * @param field - Field name to filter on
   * @param value - Value to compare against
   * @returns - The query builder instance
   * @example
   * query('users').whereEquals('username', 'puffin123'); // Matches users with username 'puffin123'
   */
  whereEquals(field: string, value: unknown): this {
    this.validateFieldName(field)
    this.validateInputValue(value)
    return this.where(field, Op.EQUALS, value)
  }

  /**
   * Add a CONTAINS filter for arrays or objects
   *
   * @param field - Field name to filter on
   * @param value - Value to check for containment
   * @returns - The query builder instance
   * @example
   * query('users').whereContains('username', 'puffin'); // Matches users with 'puffin' in "testpuffin123"
   */
  whereContains(field: string, value: unknown): this {
    this.validateFieldName(field)
    this.validateInputValue(value)
    return this.where(field, Op.CONTAINS, value)
  }

  /**
   * Add a LIKE filter for pattern matching
   *
   * @param field - Field name to filter on
   * @param pattern - Pattern to match (using SQL LIKE syntax)
   * @returns - The query builder instance
   * @example
   * query('users').whereLike('username', '%puffin%'); // Matches usernames similar to 'puffin'
   */
  whereLike(field: string, pattern: string): this {
    this.validateFieldName(field)
    this.validateLikePattern(pattern)
    return this.where(field, Op.LIKE, pattern)
  }

  /**
   * Add an ORDER BY clause
   *
   * @param field - Field name to sort by
   * @param direction - Sort direction (ASC or DESC)
   * @returns - The query builder instance
   * @example
   * query('users').orderBy('created_at', SortDirection.DESC); // Sorts by created_at in descending order
   */
  orderBy(field: string, direction: SortDirection = SortDirection.ASC): this {
    this.orderByConfig.push({ field, direction })
    return this
  }

  /**
   * Set the LIMIT value
   *
   * @param limit - Maximum number of records to return
   * @returns - The query builder instance
   * @example
   * query('users').limit(10); // Limits results to 10 records
   */
  limit(limit: number): this {
    this.limitValue = limit
    return this
  }

  /**
   * Set the START/OFFSET value
   *
   * @param offset - Number of records to skip
   * @returns - The query builder instance
   * @example
   * query('users').offset(5); // Skips the first 5 records
   */
  offset(offset: number): this {
    this.offsetValue = offset
    return this
  }

  /**
   * Specify fields to SELECT (if empty, returns all fields)
   *
   * @param fields - Field names to include in the result
   * @returns - The query builder instance
   * @example
   * query('users').select('username', 'email'); // Only returns username and email fields
   */
  select(...fields: string[]): this {
    this.selectFields = fields
    return this
  }

  /**
   * Add GROUP BY fields to the query
   *
   * @param fields - Field names to group by
   * @returns this - For method chaining
   * @example
   * const results = await query('orders')
   *   .groupBy('customer_id', 'product_category')
   *   .execute()
   */
  groupBy(...fields: string[]): this {
    fields.forEach((field) => this.validateFieldName(field))
    this.groupByFields.push(...fields)
    return this
  }

  /**
   * Add HAVING condition to the query
   *
   * @param conditionOrField - Complete HAVING condition string or field name
   * @param operator - Comparison operator (when using field, operator, value syntax)
   * @param value - Value to compare against (when using field, operator, value syntax)
   * @returns this - For method chaining
   * @example
   * // Direct condition
   * const results = await query('orders')
   *   .groupBy('customer_id')
   *   .having('count() > 5')
   *   .execute()
   *
   * // Fluent style
   * const results = await query('sales')
   *   .groupBy('product_id')
   *   .having('math::sum(amount)', Op.GREATER_THAN, 1000)
   *   .execute()
   */
  having(conditionOrField: string, operator?: Op, value?: unknown): this {
    if (operator !== undefined && value !== undefined) {
      const paramName = `h${this.havingConditions.length}`
      this.params[paramName] = value
      this.havingConditions.push(`${conditionOrField} ${operator} $${paramName}`)
    } else {
      this.validateHavingCondition(conditionOrField)
      this.havingConditions.push(conditionOrField)
    }
    return this
  }

  /**
   * Add a `count()` aggregation, aliased `count`
   *
   * With no field this renders `count()`, the number of rows in each group. With a
   * field it renders `count(field)`, the number of rows whose value for that field
   * is truthy. `'*'` is accepted as a synonym for "no field" and also renders
   * `count()`; SurrealQL has no `COUNT(*)` form.
   *
   * @param field - Field to count (omit to count every row)
   * @returns this - For method chaining
   * @example
   * const results = await query('orders')
   *   .groupBy('customer_id')
   *   .count()
   *   .execute()
   */
  count(field?: string): this {
    if (field === undefined || field === '*') {
      this.aggregations.push('count() as count')
      return this
    }
    this.validateFieldName(field)
    this.aggregations.push(`count(${field}) as count`)
    return this
  }

  /**
   * Add a `math::sum()` aggregation, aliased `sum_<field>`
   *
   * @param field - Field to sum
   * @returns this - For method chaining
   * @example
   * const results = await query('orders')
   *   .groupBy('customer_id')
   *   .sum('total_amount')
   *   .execute()
   */
  sum(field: string): this {
    this.validateFieldName(field)
    this.aggregations.push(`math::sum(${field}) as sum_${field.replace(/[^a-zA-Z0-9]/g, '_')}`)
    return this
  }

  /**
   * Add a `math::mean()` aggregation, aliased `avg_<field>`
   *
   * @param field - Field to average
   * @returns this - For method chaining
   * @example
   * const results = await query('products')
   *   .groupBy('category')
   *   .avg('price')
   *   .execute()
   */
  avg(field: string): this {
    this.validateFieldName(field)
    this.aggregations.push(`math::mean(${field}) as avg_${field.replace(/[^a-zA-Z0-9]/g, '_')}`)
    return this
  }

  /**
   * Add a `math::min()` aggregation, aliased `min_<field>`
   *
   * @param field - Field to find minimum value
   * @returns this - For method chaining
   * @example
   * const results = await query('products')
   *   .groupBy('category')
   *   .min('price')
   *   .execute()
   */
  min(field: string): this {
    this.validateFieldName(field)
    this.aggregations.push(`math::min(${field}) as min_${field.replace(/[^a-zA-Z0-9]/g, '_')}`)
    return this
  }

  /**
   * Add a `math::max()` aggregation, aliased `max_<field>`
   *
   * @param field - Field to find maximum value
   * @returns this - For method chaining
   * @example
   * const results = await query('orders')
   *   .groupBy('customer_id')
   *   .max('order_date')
   *   .execute()
   */
  max(field: string): this {
    this.validateFieldName(field)
    this.aggregations.push(`math::max(${field}) as max_${field.replace(/[^a-zA-Z0-9]/g, '_')}`)
    return this
  }

  /**
   * Set pagination using page number and page size
   *
   * @param pageNumber - Page number (1-based)
   * @param pageSize - Number of records per page
   * @returns this - For method chaining
   * @example
   * const results = await query('users')
   *   .page(2, 10) // Second page, 10 records per page
   *   .execute()
   */
  page(pageNumber: number, pageSize: number): this {
    this.validatePositiveInteger(pageNumber, 'page number')
    this.validatePositiveInteger(pageSize, 'page size')

    const offset = (pageNumber - 1) * pageSize
    this.offsetValue = offset
    this.limitValue = pageSize
    return this
  }

  /**
   * Build the query string and parameters based on the configured options
   * @private
   * @returns - Object containing the query string and parameters
   */
  private buildQuery(): { query: string; params: Record<string, unknown> } {
    const params: Record<string, unknown> = { ...this.params }

    // Build SELECT clause with aggregations if present
    let selectClause: string
    if (this.aggregations.length > 0) {
      // When using aggregations, include GROUP BY fields and aggregation functions
      const fields = this.groupByFields.length > 0
        ? [...this.groupByFields, ...this.aggregations].join(', ')
        : this.aggregations.join(', ')
      selectClause = `SELECT ${fields}`
    } else {
      selectClause = `SELECT ${this.selectFields.length > 0 ? this.selectFields.join(', ') : '*'}`
    }

    let query = `${selectClause} FROM ${this.table}`

    // Build WHERE conditions
    const allConditions: string[] = []

    this.conditions.forEach((condition, index) => {
      const paramName = `c${index}`
      params[paramName] = condition.value
      allConditions.push(`${condition.field} ${condition.operator} $${paramName}`)
    })

    if (this.whereObject && Object.keys(this.whereObject).length > 0) {
      Object.entries(this.whereObject).forEach(([field, value], index) => {
        const paramName = `o${index}`
        params[paramName] = value
        allConditions.push(`${field} = $${paramName}`)
      })
    }

    if (allConditions.length > 0) {
      query += ` WHERE ${allConditions.join(' AND ')}`
    }

    // Add GROUP BY clause
    if (this.groupByFields.length > 0) {
      query += ` GROUP BY ${this.groupByFields.join(', ')}`
    }

    // Add HAVING clause (must come after GROUP BY)
    if (this.havingConditions.length > 0) {
      query += ` HAVING ${this.havingConditions.join(' AND ')}`
    }

    // Add ORDER BY clause
    if (this.orderByConfig.length > 0) {
      const orderClauses = this.orderByConfig
        .map((config) => `${config.field} ${config.direction}`)
        .join(', ')

      query += ` ORDER BY ${orderClauses}`
    }

    // Add LIMIT and START (OFFSET) clauses
    if (this.limitValue !== undefined) {
      query += ` LIMIT ${this.limitValue}`

      if (this.offsetValue !== undefined) {
        query += ` START ${this.offsetValue}`
      }
    }

    return { query, params }
  }

  /**
   * Execute the query and return the results as an array
   * This method validates the mapper, builds the query,
   * executes it, and maps the results to the specified type.
   *
   * @throws - Throws an error if the mapper is not valid
   * @returns - Promise<T[]> containing mapped result records
   * @example
   * const users = await query('users')
   *   .where({ status: 'Active' })
   *   .orderBy('created_at', SortDirection.DESC)
   *   .limit(10)
   *   .execute()
   *
   * @remarks
   * This method handles the execution of the query and maps the results to the specified type.
   * It ensures that the mapper is valid before executing the query.
   * If the mapper is not valid, it throws an error.
   * The results are mapped to the specified type T, which can be customized by the user.
   */
  async execute(): Promise<T[]> {
    const { query, params } = this.buildQuery()

    const results = await this.executeQuery<R[]>(query, params)
    const flatResults = Array.isArray(results[0]) ? results[0] : results
    const mappedResult = this.mapResults(flatResults, true)

    // Ensure we always return T[] for ReadQL
    return Array.isArray(mappedResult) ? mappedResult : [mappedResult]
  }

  /**
   * Execute the query and return the first result or undefined
   *
   * @returns - Promise<T | undefined> containing the first mapped record or undefined
   * @example
   * const firstUser = await query('users')
   *   .where({ status: 'Active' })
   *   .orderBy('created_at', SortDirection.DESC)
   *   .first() // firstUser will be the first active user record, mapped to type T or undefined if no records found
   */
  async first(): Promise<T | undefined> {
    const results = await this.limit(1).execute()
    return results[0]
  }

  /**
   * Validate field name to prevent SQL injection
   * @private
   * @param field - Field name to validate
   */
  private validateFieldName(field: string): void {
    if (typeof field !== 'string' || field.length === 0) {
      throw new Error('Field name must be a non-empty string')
    }

    // Allow alphanumeric characters, underscores, dots (for nested fields), and hyphens
    const fieldNamePattern = /^[a-zA-Z0-9_.:-]+$/
    if (!fieldNamePattern.test(field)) {
      throw new Error(
        `Invalid field name: ${field}. Field names can only contain letters, numbers, dots, underscores, colons, and hyphens`,
      )
    }

    // Prevent common SQL injection patterns
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
        throw new Error(`Potentially dangerous field name detected: ${field}`)
      }
    }
  }

  /**
   * Validate input value to prevent injection attacks
   * @private
   * @param value - Value to validate
   */
  private validateInputValue(value: unknown): void {
    // Allow null, undefined, boolean, number
    if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') {
      return
    }

    // For strings, check for dangerous patterns
    if (typeof value === 'string') {
      this.validateStringValue(value)
      return
    }

    // For objects and arrays, recursively validate
    if (typeof value === 'object') {
      if (Array.isArray(value)) {
        value.forEach((item) => this.validateInputValue(item))
      } else {
        Object.values(value as Record<string, unknown>).forEach((item) => this.validateInputValue(item))
      }
      return
    }

    // Reject functions and other potentially dangerous types
    if (typeof value === 'function') {
      throw new Error('Function values are not allowed in queries')
    }
  }

  /**
   * Validate string values for dangerous patterns
   * @private
   * @param value - String value to validate
   */
  private validateStringValue(value: string): void {
    // Check for extremely long strings that could be DOS attacks
    if (value.length > 10000) {
      throw new Error('String values cannot exceed 10,000 characters')
    }

    // Check for dangerous SQL patterns in string values
    const dangerousPatterns = [
      /;.*(?:union|select|insert|update|delete|drop)/i,
      /'\s*(?:union|select|insert|update|delete|drop)/i,
      /"\s*(?:union|select|insert|update|delete|drop)/i,
      /\/\*.*\*\//,
      /--.*$/m,
    ]

    for (const pattern of dangerousPatterns) {
      if (pattern.test(value)) {
        throw new Error('Potentially dangerous SQL pattern detected in value')
      }
    }
  }

  /**
   * Validate LIKE pattern to prevent injection
   * @private
   * @param pattern - LIKE pattern to validate
   */
  private validateLikePattern(pattern: string): void {
    if (typeof pattern !== 'string') {
      throw new Error('LIKE pattern must be a string')
    }

    // First validate as a regular string value
    this.validateStringValue(pattern)

    // Additional validation for LIKE patterns
    // Allow % and _ wildcards, but limit the total number to prevent DOS
    const wildcardCount = (pattern.match(/[%_]/g) || []).length
    if (wildcardCount > 50) {
      throw new Error('Too many wildcards in LIKE pattern')
    }
  }

  /**
   * Validate HAVING condition to prevent injection attacks
   * @private
   * @param condition - HAVING condition to validate
   */
  private validateHavingCondition(condition: string): void {
    if (typeof condition !== 'string' || condition.length === 0) {
      throw new Error('HAVING condition must be a non-empty string')
    }

    // Check for extremely long conditions that could be DOS attacks
    if (condition.length > 1000) {
      throw new Error('HAVING condition cannot exceed 1000 characters')
    }

    // Prevent dangerous SQL injection patterns in conditions
    const dangerousPatterns = [
      /;.*(?:union|select|insert|update|delete|drop)/i,
      /'\s*(?:union|select|insert|update|delete|drop)/i,
      /"\s*(?:union|select|insert|update|delete|drop)/i,
      /\/\*.*\*\//,
      /--.*$/m,
    ]

    for (const pattern of dangerousPatterns) {
      if (pattern.test(condition)) {
        throw new Error('Potentially dangerous SQL pattern detected in HAVING condition')
      }
    }
  }

  /**
   * Validate that a number is a positive integer
   * @private
   * @param value - Value to validate
   * @param fieldName - Name of the field for error messages
   */
  private validatePositiveInteger(value: number, fieldName: string): void {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${fieldName} must be a positive integer, got: ${value}`)
    }

    // Reasonable upper limit to prevent resource exhaustion
    if (value > 1000000) {
      throw new Error(`${fieldName} cannot exceed 1,000,000, got: ${value}`)
    }
  }
}

/**
 * Create a new query builder for the specified table
 *
 * @param connectionProvider - Database connection provider
 * @param table - The SurrealDB table to query
 * @param options - Optional query options for controlling behavior
 * @returns - A new ReadQL instance
 * @example
 * const usersQuery = query(connectionProvider, 'users');             // Creates a new ReadQL instance for the 'users' table
 * await usersQuery
 *  .where({ status: 'Active' })                 // Adds a WHERE condition
 *  .orderBy('created_at', SortDirection.DESC)   // Orders results by creation date
 *  .limit(10)                                   // Limits results to 10 records
 *  .execute()                                   // Executes the query
 *
 * @remarks
 * This function is a shorthand for creating a new ReadQL instance.
 * It allows you to easily start building queries against a specific SurrealDB table.
 * The options parameter is optional and can be used for controlling warning behavior.
 */
export function query<R extends { id: RecordId }, T = R>(
  connectionProvider: ConnectionProvider,
  table: SurrealDbTable,
  options?: QueryOptions,
): ReadQL<R, T> {
  return new ReadQL<R, T>(connectionProvider, table, options || {})
}
