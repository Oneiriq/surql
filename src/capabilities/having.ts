import { assertMaxStringLength, assertNoDangerousSQL, assertNoEmptyString, assertString } from '../utils/asserts.ts'
import { Op, QueryBuilder } from '../crud/base.ts'
import { PATTERNS } from '../constants.ts'
import { validateFieldName } from '../utils/validators.ts'
import type { RecordId } from 'surrealdb'

/**
 * Interface for HAVING capability
 */
export interface HavingCapability<T> {
  having(condition: string): T
  having(field: string, operator: Op, value: unknown): T
}

/**
 * Abstract base class that adds HAVING capability to QueryBuilder
 */
export abstract class HavingQueryBuilder<R extends { id: RecordId }, T> extends QueryBuilder<R, T>
  implements HavingCapability<HavingQueryBuilder<R, T>> {
  private havingConditions: string[] = []

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
      // Fluent style: having('field', Op.GREATER_THAN, value)
      const fieldValidationResult = validateFieldName(conditionOrField)
      if (!fieldValidationResult.success) {
        throw new Error(fieldValidationResult.error)
      }
      const paramName = `h${this.havingConditions.length}`
      if ('params' in this && typeof this.params === 'object') {
        ;(this.params as Record<string, unknown>)[paramName] = value
      }
      this.havingConditions.push(`${conditionOrField} ${operator} $${paramName}`)
    } else {
      // Direct condition: having('count() > 10')
      this.validateHavingCondition(conditionOrField)
      this.havingConditions.push(conditionOrField)
    }
    return this
  }

  /**
   * Build the HAVING clause for the query
   * @protected
   * @returns HAVING clause string or empty string
   */
  protected buildHavingClause(): string {
    return this.havingConditions.length > 0 ? ` HAVING ${this.havingConditions.join(' AND ')}` : ''
  }

  /**
   * Get current HAVING conditions
   * @returns Array of HAVING condition strings
   */
  protected getHavingConditions(): string[] {
    return [...this.havingConditions]
  }

  /**
   * Clear HAVING clause
   * @returns Current query builder instance for chaining
   */
  clearHaving(): this {
    this.havingConditions = []
    return this
  }

  /**
   * Check if query has HAVING clause
   * @returns True if HAVING conditions are defined
   */
  hasHaving(): boolean {
    return this.havingConditions.length > 0
  }

  /**
   * Validate HAVING condition to prevent injection attacks
   * @private
   * @param condition - HAVING condition to validate
   */
  private validateHavingCondition(condition: string): void {
    assertString(condition, 'HAVING condition')
    assertNoEmptyString({ input: condition, context: 'HAVING condition' })
    assertMaxStringLength({ input: condition, context: 'HAVING condition', maxLength: 1000 })
    assertNoDangerousSQL({
      input: condition,
      context: 'HAVING condition',
      patterns: PATTERNS.SQL.CLAUSE_INJECTION_PATTERNS,
    })
  }
}
