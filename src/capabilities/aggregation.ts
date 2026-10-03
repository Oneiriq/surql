import { QueryBuilder } from '../crud/base.ts'
import { validateFieldName } from '../utils/validators.ts'
import type { RecordId } from 'surrealdb'

/**
 * Interface for aggregation capability
 */
export interface AggregationCapability<T> {
  count(field?: string): T
  sum(field: string): T
  avg(field: string): T
  min(field: string): T
  max(field: string): T
}

/**
 * Abstract base class that adds aggregation capability to QueryBuilder
 */
export abstract class AggregationQueryBuilder<R extends { id: RecordId }, T> extends QueryBuilder<R, T>
  implements AggregationCapability<AggregationQueryBuilder<R, T>> {
  private aggregations: string[] = []

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
   *
   * const results = await query('products')
   *   .count('category')
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
   * Build aggregation fields for SELECT clause
   * @protected
   * @returns Array of aggregation field strings
   */
  protected buildAggregationFields(): string[] {
    return [...this.aggregations]
  }

  /**
   * Clear aggregation functions
   * @returns Current query builder instance for chaining
   */
  clearAggregations(): this {
    this.aggregations = []
    return this
  }

  /**
   * Check if query has aggregations
   * @returns True if aggregations are defined
   */
  hasAggregations(): boolean {
    return this.aggregations.length > 0
  }

  /**
   * Get aggregation count
   * @returns Number of aggregation functions
   */
  getAggregationCount(): number {
    return this.aggregations.length
  }

  /**
   * Validate field name to prevent injection attacks
   * @param field - Field name to validate
   * @throws Error if field name is invalid
   */
  private validateFieldName(field: string): void {
    const validationResult = validateFieldName(field)
    if (!validationResult.success) throw new Error(validationResult.error)
  }
}
