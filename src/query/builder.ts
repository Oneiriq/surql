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
  readonly groupAll: boolean
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
  readonly vectorEf: number | null
  readonly fulltextField: string | null
  readonly fulltextReference: number | null
  readonly fulltextQuery: string | null
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
    groupAll: false,
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
    vectorEf: null,
    fulltextField: null,
    fulltextReference: null,
    fulltextQuery: null,
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

  /** Add GROUP ALL (aggregate entire result set without grouping fields) */
  groupAll(): Query<T> {
    return this.with({ groupAll: true })
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

  /**
   * Configure an exhaustive vector search, rendering the metric form
   * `<|k,METRIC|>`.
   *
   * The engine plans this as a KnnTopK over a table scan: every row is
   * compared and no index is involved. Reach for {@link vectorSearchIndexed}
   * when the field carries an HNSW or DISKANN index.
   *
   * An omitted metric defaults to `COSINE`. It cannot be left out of the
   * rendered operator: the bare `<|k|>` form belongs to the KTree era and is a
   * parse error on SurrealDB 3.x.
   */
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
      vectorDistance: distance ?? 'COSINE',
      vectorEf: null,
    })
  }

  /**
   * Configure an index-backed vector search, rendering the integer exploration
   * form `<|k,ef|>`.
   *
   * The second argument of the KNN operator decides the plan. An integer is
   * the exploration factor and the engine answers with a KnnScan over the
   * field's HNSW or DISKANN index; a metric keyword there asks for an
   * exhaustive KnnTopK instead. The metric belongs to the index, so this
   * method takes none.
   *
   * @param ef Exploration factor at query time; higher trades speed for recall
   */
  vectorSearchIndexed(
    field: string,
    vector: number[],
    k: number = 10,
    ef: number = 40,
  ): Query<T> {
    return this.with({
      vectorField: field,
      vectorData: vector,
      vectorK: k,
      vectorEf: ef,
      // Clear the exhaustive metric so a chained call cannot leave both forms
      // armed and quietly fall back to a table scan.
      vectorDistance: null,
    })
  }

  /**
   * Configure a full-text `FULLTEXT` predicate rendered as
   * `<field> @<reference>@ <query>` in the `WHERE` clause.
   *
   * The `reference` integer ties the match to a {@link searchScore} (or
   * `search::highlight`) call, so a row's BM25 relevance can be projected and
   * ordered on. Requires a BM25 full-text index on `field` (see `bm25Index`).
   * The query text is inlined as a quoted, escaped literal.
   *
   * @example
   * ```ts
   * select().searchScore(1, 'score').fromTable('memory')
   *   .fulltextSearch('content', 1, 'insider buying').orderBy('score', 'DESC').limit(10)
   * // SELECT *, search::score(1) AS score FROM memory
   * //   WHERE content @1@ 'insider buying' ORDER BY score DESC LIMIT 10
   * ```
   */
  fulltextSearch(field: string, reference: number, query: string): Query<T> {
    if (field.length === 0) {
      throw new Error('Full-text search field cannot be empty')
    }
    if (query.length === 0) {
      throw new Error('Full-text search query cannot be empty')
    }
    return this.with({
      fulltextField: field,
      fulltextReference: reference,
      fulltextQuery: query,
    })
  }

  /**
   * Append `search::score(<reference>) AS <alias>` to the projected fields — the
   * BM25 relevance for the match registered at `reference` by
   * {@link fulltextSearch}. Order by `alias` to rank.
   *
   * When no projection has been set yet, the star is added first so the score
   * column is appended to `SELECT *` (matching `select(None)` in the sibling
   * ports) rather than replacing it.
   */
  searchScore(reference: number, alias: string): Query<T> {
    const base = this.state.fields.length > 0 ? this.state.fields : ['*']
    return this.with({ fields: [...base, `search::score(${reference}) AS ${alias}`] })
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

    // Assemble WHERE parts in order: vector search, full-text match, then the
    // accumulated raw conditions — all joined with AND.
    const whereParts: string[] = []
    if (this.state.vectorField && this.state.vectorData) {
      const vecStr = `[${this.state.vectorData.join(', ')}]`
      const k = this.state.vectorK ?? 10
      // An integer second argument reaches the index through a KnnScan plan; a
      // metric keyword there asks the engine for an exhaustive KnnTopK. The
      // bare `<|k|>` form is a parse error on SurrealDB 3.x, so one of the two
      // always renders.
      const op = this.state.vectorEf !== null
        ? `<|${k},${this.state.vectorEf}|>`
        : `<|${k},${this.state.vectorDistance ?? 'COSINE'}|>`
      whereParts.push(`${this.state.vectorField} ${op} ${vecStr}`)
    }
    if (
      this.state.fulltextField !== null &&
      this.state.fulltextReference !== null &&
      this.state.fulltextQuery !== null
    ) {
      const quoted = quoteValue(this.state.fulltextQuery)
      whereParts.push(`${this.state.fulltextField} @${this.state.fulltextReference}@ ${quoted}`)
    }
    for (const cond of this.state.conditions) {
      whereParts.push(cond)
    }
    if (whereParts.length > 0) {
      sql += ` WHERE ${whereParts.join(' AND ')}`
    }

    if (this.state.groupAll) {
      sql += ' GROUP ALL'
    } else if (this.state.groupFields.length > 0) {
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

/**
 * Create a full-text (BM25) search query — the lexical leg of hybrid retrieval.
 *
 * Wraps `Query.fulltextSearch` + `Query.searchScore` into
 * `SELECT ..., search::score(reference) AS <scoreAlias> FROM <table>
 * WHERE <field> @reference@ <query>`. Pair with a `bm25Index` on `field`, then
 * `ORDER BY <scoreAlias> DESC` to rank by relevance.
 */
export function fulltextSearchQuery<T = Record<string, unknown>>(
  table: string,
  field: string,
  reference: number,
  query: string,
  fields: string[] = [],
  scoreAlias: string = 'score',
): Query<T> {
  // An empty projection becomes `*` (matching `select(None)` in the sibling
  // ports) so the score column is appended after the star, not in place of it.
  const projection = fields.length > 0 ? fields : ['*']
  return new Query<T>()
    .select(...projection)
    .searchScore(reference, scoreAlias)
    .fromTable(table)
    .fulltextSearch(field, reference, query)
}
