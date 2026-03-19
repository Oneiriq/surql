import { quoteValue, validateIdentifier } from './helpers.ts'

/**
 * Base expression interface for SurrealQL expressions
 */
export interface Expression {
  toSurQL(): string
}

/**
 * Field reference expression
 */
export interface FieldExpression extends Expression {
  readonly fieldName: string
}

/**
 * Literal value expression
 */
export interface ValueExpression extends Expression {
  readonly val: unknown
}

/**
 * Function call expression
 */
export interface FunctionExpression extends Expression {
  readonly funcName: string
  readonly args: Expression[]
}

/**
 * Raw SQL expression (use with caution)
 */
export interface RawExpression extends Expression {
  readonly sql: string
}

/**
 * Create a field reference
 */
export function field(name: string): FieldExpression {
  validateIdentifier(name)
  return Object.freeze({
    fieldName: name,
    toSurQL(): string {
      return this.fieldName
    },
  })
}

/**
 * Create a literal value expression
 */
export function value(val: unknown): ValueExpression {
  return Object.freeze({
    val,
    toSurQL(): string {
      return quoteValue(this.val)
    },
  })
}

/**
 * Create a function call expression
 */
export function func(name: string, ...args: Expression[]): FunctionExpression {
  return Object.freeze({
    funcName: name,
    args,
    toSurQL(): string {
      return `${this.funcName}(${this.args.map((a) => a.toSurQL()).join(', ')})`
    },
  })
}

/**
 * Raw SQL expression - use with caution
 */
export function raw(sql: string): RawExpression {
  return Object.freeze({
    sql,
    toSurQL(): string {
      return this.sql
    },
  })
}

/**
 * Alias an expression
 */
export function as_(expr: Expression, alias: string): Expression {
  validateIdentifier(alias)
  return Object.freeze({
    toSurQL(): string {
      return `${expr.toSurQL()} AS ${alias}`
    },
  })
}

// Aggregate functions

/** COUNT aggregate */
export function count(expr?: Expression): FunctionExpression {
  return expr ? func('count', expr) : func('count')
}

/** SUM aggregate */
export function sum_(expr: Expression): FunctionExpression {
  return func('math::sum', expr)
}

/** AVG aggregate */
export function avg(expr: Expression): FunctionExpression {
  return func('math::mean', expr)
}

/** MIN aggregate */
export function min_(expr: Expression): FunctionExpression {
  return func('math::min', expr)
}

/** MAX aggregate */
export function max_(expr: Expression): FunctionExpression {
  return func('math::max', expr)
}

/** ABS */
export function abs_(expr: Expression): FunctionExpression {
  return func('math::abs', expr)
}

/** CEIL */
export function ceil(expr: Expression): FunctionExpression {
  return func('math::ceil', expr)
}

/** FLOOR */
export function floor(expr: Expression): FunctionExpression {
  return func('math::floor', expr)
}

/** ROUND */
export function round_(expr: Expression): FunctionExpression {
  return func('math::round', expr)
}

// String functions

/** UPPER */
export function upper(expr: Expression): FunctionExpression {
  return func('string::uppercase', expr)
}

/** LOWER */
export function lower(expr: Expression): FunctionExpression {
  return func('string::lowercase', expr)
}

/** CONCAT */
export function concat(...exprs: Expression[]): FunctionExpression {
  return func('string::concat', ...exprs)
}

/** String length */
export function stringLength(expr: Expression): FunctionExpression {
  return func('string::len', expr)
}

// Array functions

/** Array length */
export function arrayLength(expr: Expression): FunctionExpression {
  return func('array::len', expr)
}

/** Array contains */
export function arrayContains(arr: Expression, val: Expression): FunctionExpression {
  return func('array::contains', arr, val)
}

/** Array distinct */
export function arrayDistinct(expr: Expression): FunctionExpression {
  return func('array::distinct', expr)
}

/** Array flatten */
export function arrayFlatten(expr: Expression): FunctionExpression {
  return func('array::flatten', expr)
}

// Time functions

/** Current time */
export function timeNow(): FunctionExpression {
  return func('time::now')
}

/** Format time */
export function timeFormat(expr: Expression, format: Expression): FunctionExpression {
  return func('time::format', expr, format)
}

// Type functions

/** Type check */
export function typeIs(expr: Expression, typeName: Expression): FunctionExpression {
  return func('type::is', expr, typeName)
}

/** Type cast */
export function cast(expr: Expression, typeName: string): Expression {
  return Object.freeze({
    toSurQL(): string {
      return `<${typeName}> ${expr.toSurQL()}`
    },
  })
}
