/**
 * Operator expression representing a field-operator-value triple
 * that can be rendered into a SurrealQL WHERE clause segment.
 */
export interface OperatorExpression {
  readonly field: string
  readonly operator: string
  readonly value: unknown
  toSurQL(): string
}

/**
 * Comparison operator type
 */
export type ComparisonOperator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'CONTAINS' | 'INSIDE' | '~' | '!~'

/**
 * Logic operator type
 */
export type LogicOperator = 'AND' | 'OR' | 'NOT'

/**
 * Union of all operator types
 */
export type Operator = ComparisonOperator | LogicOperator

/**
 * Quote a value for safe use in SurrealQL.
 * Strings are single-quoted with escaping; other primitives are stringified directly.
 */
function quoteValue(value: unknown): string {
  if (value === null || value === undefined) return 'NONE'
  if (typeof value === 'string') return `'${value.replace(/'/g, "\\'")}'`
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return `[${value.map(quoteValue).join(', ')}]`
  return String(value)
}

/**
 * Validate that an identifier contains only safe characters.
 */
function validateIdentifier(field: string): void {
  if (!/^[a-zA-Z0-9_.:-]+$/.test(field)) {
    throw new Error(`Invalid field identifier: ${field}`)
  }
}

function createExpression(field: string, operator: string, value: unknown): OperatorExpression {
  validateIdentifier(field)
  return Object.freeze({
    field,
    operator,
    value,
    toSurQL(): string {
      return `${this.field} ${this.operator} ${quoteValue(this.value)}`
    },
  })
}

/** Equals */
export function eq(field: string, value: unknown): OperatorExpression {
  return createExpression(field, '=', value)
}

/** Not equals */
export function ne(field: string, value: unknown): OperatorExpression {
  return createExpression(field, '!=', value)
}

/** Greater than */
export function gt(field: string, value: unknown): OperatorExpression {
  return createExpression(field, '>', value)
}

/** Greater than or equal */
export function gte(field: string, value: unknown): OperatorExpression {
  return createExpression(field, '>=', value)
}

/** Less than */
export function lt(field: string, value: unknown): OperatorExpression {
  return createExpression(field, '<', value)
}

/** Less than or equal */
export function lte(field: string, value: unknown): OperatorExpression {
  return createExpression(field, '<=', value)
}

/** Contains */
export function contains(field: string, value: unknown): OperatorExpression {
  return createExpression(field, 'CONTAINS', value)
}

/** Combine expressions with AND */
export function and_(...expressions: OperatorExpression[]): string {
  return expressions.map((e) => e.toSurQL()).join(' AND ')
}

/** Combine expressions with OR */
export function or_(...expressions: OperatorExpression[]): string {
  return `(${expressions.map((e) => e.toSurQL()).join(' OR ')})`
}

/** Negate an expression */
export function not_(expression: OperatorExpression): string {
  return `NOT (${expression.toSurQL()})`
}
