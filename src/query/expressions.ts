import { quoteValue, validateIdentifier } from './helpers.ts'
import {
  isSurqlFn as isSurqlFnImpl,
  surqlFn as surqlFnImpl,
  type SurrealFnValue as SurrealFnValueImpl,
} from '../types/surqlFn.ts'

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

/**
 * Dual-purpose value: renders as an SurrealQL expression AND carries the
 * `__surqlFn` marker so it renders inline in `SET` clauses too.
 */
export interface FunctionValueExpression extends FunctionExpression, SurrealFnValueImpl {}

/**
 * Factory for a function-call value that is usable in both expression
 * contexts (`SELECT`, `WHERE`) and field-value contexts (`SET`).
 */
function fnValue(name: string, ...args: Expression[]): FunctionValueExpression {
  const rendered = `${name}(${args.map((a) => a.toSurQL()).join(', ')})`
  return Object.freeze({
    __surqlFn: true as const,
    surql: rendered,
    funcName: name,
    args,
    toSurQL(): string {
      return this.surql
    },
  })
}

/**
 * Coerce a string field name into an Expression.
 * `field('x')` already exists; this is a lightweight shortcut used by
 * the function factories so `mathSum('strength')` works without a
 * manual `field(...)` wrap.
 */
function toExpr(value: Expression | string): Expression {
  return typeof value === 'string' ? field(value) : value
}

// Aggregate functions

/**
 * `count()` and `count(expr)` aggregate.
 *
 * With no argument renders `count()`, i.e. a row count.
 * With an expression/field name renders `count(expr)`.
 */
export function count(expr?: Expression | string): FunctionValueExpression {
  return expr !== undefined ? fnValue('count', toExpr(expr)) : fnValue('count')
}

/**
 * `count(IF condition)` aggregate — `count()` rows where `condition` holds.
 * Emits `count(IF <condition> THEN 1 END)` which is the canonical SurrealDB
 * idiom for conditional counting inside GROUP BY / GROUP ALL queries.
 */
export function countIf(condition: Expression | string): FunctionValueExpression {
  const cond = typeof condition === 'string' ? condition : condition.toSurQL()
  const rendered = `count(IF ${cond} THEN 1 END)`
  return Object.freeze({
    __surqlFn: true as const,
    surql: rendered,
    funcName: 'count',
    args: [raw(`IF ${cond} THEN 1 END`)] as Expression[],
    toSurQL(): string {
      return this.surql
    },
  })
}

/** SUM aggregate */
export function sum_(expr: Expression | string): FunctionValueExpression {
  return fnValue('math::sum', toExpr(expr))
}

/** AVG aggregate (alias for `math::mean`) */
export function avg(expr: Expression | string): FunctionValueExpression {
  return fnValue('math::mean', toExpr(expr))
}

/** MIN aggregate */
export function min_(expr: Expression | string): FunctionValueExpression {
  return fnValue('math::min', toExpr(expr))
}

/** MAX aggregate */
export function max_(expr: Expression | string): FunctionValueExpression {
  return fnValue('math::max', toExpr(expr))
}

/** `math::mean()` aggregate. */
export function mathMean(expr: Expression | string): FunctionValueExpression {
  return fnValue('math::mean', toExpr(expr))
}

/** `math::sum()` aggregate. */
export function mathSum(expr: Expression | string): FunctionValueExpression {
  return fnValue('math::sum', toExpr(expr))
}

/** `math::max()` aggregate. */
export function mathMax(expr: Expression | string): FunctionValueExpression {
  return fnValue('math::max', toExpr(expr))
}

/** `math::min()` aggregate. */
export function mathMin(expr: Expression | string): FunctionValueExpression {
  return fnValue('math::min', toExpr(expr))
}

/** `math::abs()` — absolute value. */
export function mathAbs(expr: Expression | string): FunctionValueExpression {
  return fnValue('math::abs', toExpr(expr))
}

/** `math::ceil()`. */
export function mathCeil(expr: Expression | string): FunctionValueExpression {
  return fnValue('math::ceil', toExpr(expr))
}

/** `math::floor()`. */
export function mathFloor(expr: Expression | string): FunctionValueExpression {
  return fnValue('math::floor', toExpr(expr))
}

/** `math::round()`. */
export function mathRound(expr: Expression | string): FunctionValueExpression {
  return fnValue('math::round', toExpr(expr))
}

/** Short-form aliases retained for pre-v1.3.0 callers. */
export function abs_(expr: Expression | string): FunctionValueExpression {
  return mathAbs(expr)
}
export function ceil(expr: Expression | string): FunctionValueExpression {
  return mathCeil(expr)
}
export function floor(expr: Expression | string): FunctionValueExpression {
  return mathFloor(expr)
}
export function round_(expr: Expression | string): FunctionValueExpression {
  return mathRound(expr)
}

// String functions

/** `string::uppercase()`. */
export function stringUpper(expr: Expression | string): FunctionValueExpression {
  return fnValue('string::uppercase', toExpr(expr))
}

/** `string::lowercase()`. */
export function stringLower(expr: Expression | string): FunctionValueExpression {
  return fnValue('string::lowercase', toExpr(expr))
}

/** `string::concat()`. */
export function stringConcat(...exprs: (Expression | string)[]): FunctionValueExpression {
  return fnValue('string::concat', ...exprs.map(toExpr))
}

/** `string::len()`. */
export function stringLen(expr: Expression | string): FunctionValueExpression {
  return fnValue('string::len', toExpr(expr))
}

/** Short-form aliases retained for pre-v1.3.0 callers. */
export function upper(expr: Expression | string): FunctionValueExpression {
  return stringUpper(expr)
}
export function lower(expr: Expression | string): FunctionValueExpression {
  return stringLower(expr)
}
export function concat(...exprs: (Expression | string)[]): FunctionValueExpression {
  return stringConcat(...exprs)
}
export function stringLength(expr: Expression | string): FunctionValueExpression {
  return stringLen(expr)
}

// Array functions

/** Array length */
export function arrayLength(expr: Expression | string): FunctionValueExpression {
  return fnValue('array::len', toExpr(expr))
}

/** Array contains */
export function arrayContains(arr: Expression | string, val: Expression): FunctionValueExpression {
  return fnValue('array::contains', toExpr(arr), val)
}

/** Array distinct */
export function arrayDistinct(expr: Expression | string): FunctionValueExpression {
  return fnValue('array::distinct', toExpr(expr))
}

/** Array flatten */
export function arrayFlatten(expr: Expression | string): FunctionValueExpression {
  return fnValue('array::flatten', toExpr(expr))
}

// Time functions

/**
 * `time::now()` — server-side current time.
 *
 * Usable in both expression contexts (SELECT/WHERE) and SET values.
 *
 * @example
 * ```ts
 * await updateQuery('user:alice', { lastLogin: timeNow() }).execute(db)
 * ```
 */
export function timeNow(): FunctionValueExpression {
  return fnValue('time::now')
}

/** `time::format()`. */
export function timeFormat(
  expr: Expression | string,
  format: Expression | string,
): FunctionValueExpression {
  return fnValue('time::format', toExpr(expr), toExpr(format))
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

/**
 * Create a type::record() reference for linking to a specific record.
 * Generates: type::record('table', 'id') or type::record('table:id')
 *
 * @param table - Table name
 * @param id - Optional record ID (if omitted, table is treated as a full record string)
 */
export function recordRef(table: string, id?: string): Expression {
  validateIdentifier(table)
  if (id !== undefined) {
    return Object.freeze({
      toSurQL(): string {
        return `type::record('${table}:${id}')`
      },
    })
  }
  return Object.freeze({
    toSurQL(): string {
      return `type::record('${table}')`
    },
  })
}

// Re-export from canonical home in `../types/surqlFn.ts`.
// Retained here for backwards compatibility with v1.2.x imports from
// `@oneiriq/surql/src/query/expressions.ts`.
export type SurrealFnValue = SurrealFnValueImpl
export const surqlFn = surqlFnImpl
export const isSurqlFn = isSurqlFnImpl
