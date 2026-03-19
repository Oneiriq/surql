import type { Expression } from './expressions.ts'
import type { QueryHint } from './hints.ts'
import { renderHints } from './hints.ts'
import { escapeTable, quoteValue, type ReturnFormat, validateIdentifier, type VectorDistanceType } from './helpers.ts'

/**
 * Query operation type
 */
export type QueryOperation = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'UPSERT' | 'RELATE'

/**
 * Sort direction
 */
export type SortDir = 'ASC' | 'DESC'

/**
 * Internal state of an immutable query
 */
interface QueryState<T> {
  readonly operation: QueryOperation
  readonly table: string | null
  readonly fields: readonly string[]
  readonly conditions: readonly string[]
  readonly orderFields: readonly { field: string; direction: SortDir }[]
  readonly groupFields: readonly string[]
  readonly limitValue: number | null
  readonly offsetValue: number | null
  readonly data: Record<string, unknown> | null
  readonly returnFormat: ReturnFormat | null
  readonly hints: readonly QueryHint[]
  readonly traversalPath: string | null
  readonly relateFrom: string | null
  readonly relateTo: string | null
  readonly relateEdge: string | null
  readonly vectorField: string | null
  readonly vectorData: readonly number[] | null
  readonly vectorK: number | null
  readonly vectorDistance: VectorDistanceType | null
  readonly _phantom?: T
}

function defaultState<T>(): QueryState<T> {
  return {
    operation: 'SELECT',
    table: null,
    fields: [],
    conditions: [],
    orderFields: [],
    groupFields: [],
    limitValue: null,
    offsetValue: null,
    data: null,
    returnFormat: null,
    hints: [],
    traversalPath: null,
    relateFrom: null,
    relateTo: null,
    relateEdge: null,
    vectorField: null,
    vectorData: null,
    vectorK: null,
    vectorDistance: null,
  }
}

function clone<T>(state: QueryState<T>, overrides: Partial<QueryState<T>>): QueryState<T> {
  return { ...state, ...overrides }
}

/**
 * Immutable query builder. Each method returns a new Query instance.
 * Does NOT execute queries -- call toSurQL() to get the SurrealQL string.
 */
export class Query<T = Record<string, unknown>> {
  private readonly state: QueryState<T>

  constructor(state?: QueryState<T>) {
    this.state = state ?? defaultState<T>()
  }

  private with(overrides: Partial<QueryState<T>>): Query<T> {
    return new Query<T>(clone(this.state, overrides))
  }

  /** Set the fields to select */
  select(...fields: (string | Expression)[]): Query<T> {
    const fieldStrs = fields.map((f) => (typeof f === 'string' ? f : f.toSurQL()))
    return this.with({ operation: 'SELECT', fields: fieldStrs })
  }

  /** Set the table to query from */
  fromTable(table: string): Query<T> {
    return this.with({ table: escapeTable(table) })
  }

  /** Add a WHERE condition (SurrealQL string) */
  where(condition: string): Query<T> {
    return this.with({ conditions: [...this.state.conditions, condition] })
  }

  /** Add ORDER BY */
  orderBy(field: string, direction: SortDir = 'ASC'): Query<T> {
    validateIdentifier(field)
    return this.with({
      orderFields: [...this.state.orderFields, { field, direction }],
    })
  }

  /** Add GROUP BY */
  groupBy(...fields: string[]): Query<T> {
    fields.forEach(validateIdentifier)
    return this.with({ groupFields: [...this.state.groupFields, ...fields] })
  }

  /** Set LIMIT */
  limit(n: number): Query<T> {
    return this.with({ limitValue: n })
  }

  /** Set OFFSET / START */
  offset(n: number): Query<T> {
    return this.with({ offsetValue: n })
  }

  /** Create an INSERT query */
  insert(table: string, data: Record<string, unknown>): Query<T> {
    return this.with({ operation: 'INSERT', table: escapeTable(table), data })
  }

  /** Create an UPDATE query */
  update(target: string, data: Record<string, unknown>): Query<T> {
    return this.with({ operation: 'UPDATE', table: target, data })
  }

  /** Create a DELETE query */
  delete(target: string): Query<T> {
    return this.with({ operation: 'DELETE', table: target })
  }

  /** Create an UPSERT query */
  upsert(table: string, data: Record<string, unknown>): Query<T> {
    return this.with({ operation: 'UPSERT', table: escapeTable(table), data })
  }

  /** Create a RELATE query */
  relate(from: string, edge: string, to: string, data?: Record<string, unknown>): Query<T> {
    return this.with({
      operation: 'RELATE',
      relateFrom: from,
      relateEdge: edge,
      relateTo: to,
      data: data ?? null,
    })
  }

  /** Add a graph traversal path */
  traverse(path: string): Query<T> {
    return this.with({ traversalPath: path })
  }

  /** Set return format */
  returnFormat(format: ReturnFormat): Query<T> {
    return this.with({ returnFormat: format })
  }

  /** Add a query hint */
  withHint(hint: QueryHint): Query<T> {
    return this.with({ hints: [...this.state.hints, hint] })
  }

  /** Configure vector search */
  vectorSearch(
    field: string,
    vector: number[],
    distance?: VectorDistanceType,
    k: number = 10,
  ): Query<T> {
    return this.with({
      vectorField: field,
      vectorData: vector,
      vectorK: k,
      vectorDistance: distance ?? null,
    })
  }

  /** Get the current operation */
  get operation(): QueryOperation {
    return this.state.operation
  }

  /** Get the current table */
  get tableName(): string | null {
    return this.state.table
  }

  /** Render to SurrealQL string */
  toSurQL(): string {
    switch (this.state.operation) {
      case 'SELECT':
        return this.buildSelect()
      case 'INSERT':
        return this.buildInsert()
      case 'UPDATE':
        return this.buildUpdate()
      case 'DELETE':
        return this.buildDelete()
      case 'UPSERT':
        return this.buildUpsert()
      case 'RELATE':
        return this.buildRelate()
      default:
        throw new Error(`Unknown operation: ${this.state.operation}`)
    }
  }

  private buildSelect(): string {
    const fields = this.state.fields.length > 0 ? this.state.fields.join(', ') : '*'
    let sql = `SELECT ${fields}`

    if (this.state.table) {
      sql += ` FROM ${this.state.table}`
    }

    if (this.state.traversalPath) {
      sql += this.state.table ? `.${this.state.traversalPath}` : ` ${this.state.traversalPath}`
    }

    if (this.state.vectorField && this.state.vectorData) {
      const vecStr = `[${this.state.vectorData.join(', ')}]`
      sql += ` WHERE ${this.state.vectorField} <|${this.state.vectorK ?? 10}|> ${vecStr}`
      if (this.state.conditions.length > 0) {
        sql += ` AND ${this.state.conditions.join(' AND ')}`
      }
    } else if (this.state.conditions.length > 0) {
      sql += ` WHERE ${this.state.conditions.join(' AND ')}`
    }

    if (this.state.groupFields.length > 0) {
      sql += ` GROUP BY ${this.state.groupFields.join(', ')}`
    }

    if (this.state.orderFields.length > 0) {
      const orders = this.state.orderFields.map((o) => `${o.field} ${o.direction}`)
      sql += ` ORDER BY ${orders.join(', ')}`
    }

    if (this.state.limitValue !== null) {
      sql += ` LIMIT ${this.state.limitValue}`
    }

    if (this.state.offsetValue !== null) {
      sql += ` START ${this.state.offsetValue}`
    }

    sql += renderHints(this.state.hints as QueryHint[])

    return sql
  }

  private buildInsert(): string {
    if (!this.state.table || !this.state.data) {
      throw new Error('INSERT requires table and data')
    }
    const entries = Object.entries(this.state.data)
    const setClauses = entries.map(([k, v]) => `${k} = ${quoteValue(v)}`).join(', ')
    let sql = `INSERT INTO ${this.state.table} SET ${setClauses}`
    if (this.state.returnFormat) {
      sql += ` RETURN ${this.state.returnFormat}`
    }
    return sql
  }

  private buildUpdate(): string {
    if (!this.state.table || !this.state.data) {
      throw new Error('UPDATE requires target and data')
    }
    const entries = Object.entries(this.state.data)
    const setClauses = entries.map(([k, v]) => `${k} = ${quoteValue(v)}`).join(', ')
    let sql = `UPDATE ${this.state.table} SET ${setClauses}`
    if (this.state.conditions.length > 0) {
      sql += ` WHERE ${this.state.conditions.join(' AND ')}`
    }
    if (this.state.returnFormat) {
      sql += ` RETURN ${this.state.returnFormat}`
    }
    return sql
  }

  private buildDelete(): string {
    if (!this.state.table) {
      throw new Error('DELETE requires target')
    }
    let sql = `DELETE ${this.state.table}`
    if (this.state.conditions.length > 0) {
      sql += ` WHERE ${this.state.conditions.join(' AND ')}`
    }
    if (this.state.returnFormat) {
      sql += ` RETURN ${this.state.returnFormat}`
    }
    return sql
  }

  private buildUpsert(): string {
    if (!this.state.table || !this.state.data) {
      throw new Error('UPSERT requires table and data')
    }
    const entries = Object.entries(this.state.data)
    const setClauses = entries.map(([k, v]) => `${k} = ${quoteValue(v)}`).join(', ')
    let sql = `UPSERT ${this.state.table} SET ${setClauses}`
    if (this.state.conditions.length > 0) {
      sql += ` WHERE ${this.state.conditions.join(' AND ')}`
    }
    if (this.state.returnFormat) {
      sql += ` RETURN ${this.state.returnFormat}`
    }
    return sql
  }

  private buildRelate(): string {
    if (!this.state.relateFrom || !this.state.relateEdge || !this.state.relateTo) {
      throw new Error('RELATE requires from, edge, and to')
    }
    let sql = `RELATE ${this.state.relateFrom}->${this.state.relateEdge}->${this.state.relateTo}`
    if (this.state.data) {
      const entries = Object.entries(this.state.data)
      const setClauses = entries.map(([k, v]) => `${k} = ${quoteValue(v)}`).join(', ')
      sql += ` SET ${setClauses}`
    }
    if (this.state.returnFormat) {
      sql += ` RETURN ${this.state.returnFormat}`
    }
    return sql
  }
}

/** Create a new SELECT query */
export function select<T = Record<string, unknown>>(...fields: (string | Expression)[]): Query<T> {
  return new Query<T>().select(...fields)
}

/** Create a new INSERT query */
export function insert<T = Record<string, unknown>>(table: string, data: Record<string, unknown>): Query<T> {
  return new Query<T>().insert(table, data)
}

/** Create a new UPDATE query builder */
export function updateQuery<T = Record<string, unknown>>(target: string, data: Record<string, unknown>): Query<T> {
  return new Query<T>().update(target, data)
}

/** Create a new DELETE query builder */
export function deleteQuery<T = Record<string, unknown>>(target: string): Query<T> {
  return new Query<T>().delete(target)
}

/** Create a new UPSERT query builder */
export function upsertQuery<T = Record<string, unknown>>(table: string, data: Record<string, unknown>): Query<T> {
  return new Query<T>().upsert(table, data)
}

/** Create a new RELATE query */
export function relate<T = Record<string, unknown>>(
  from: string,
  edge: string,
  to: string,
  data?: Record<string, unknown>,
): Query<T> {
  return new Query<T>().relate(from, edge, to, data)
}

/** Create a vector search query */
export function vectorSearchQuery<T = Record<string, unknown>>(
  table: string,
  field: string,
  vector: number[],
  distance?: VectorDistanceType,
  k: number = 10,
): Query<T> {
  return new Query<T>().select().fromTable(table).vectorSearch(field, vector, distance, k)
}

/** Create a similarity search query (alias for vectorSearchQuery with score) */
export function similaritySearchQuery<T = Record<string, unknown>>(
  table: string,
  field: string,
  vector: number[],
  distance?: VectorDistanceType,
  k: number = 10,
): Query<T> {
  return new Query<T>().select().fromTable(table).vectorSearch(field, vector, distance, k)
}
