import type { FieldDefinition } from './fields.ts'

/**
 * Table schema mode
 */
export enum TableMode {
  SCHEMAFULL = 'SCHEMAFULL',
  SCHEMALESS = 'SCHEMALESS',
  DROP = 'DROP',
}

/**
 * Index type
 */
export enum IndexType {
  STANDARD = 'INDEX',
  UNIQUE = 'UNIQUE',
  SEARCH = 'SEARCH',
  MTREE = 'MTREE',
  HNSW = 'HNSW',
}

/**
 * MTREE vector distance metric
 */
export enum MTreeDistanceType {
  COSINE = 'COSINE',
  EUCLIDEAN = 'EUCLIDEAN',
  MANHATTAN = 'MANHATTAN',
  MINKOWSKI = 'MINKOWSKI',
}

/**
 * HNSW vector distance metric
 */
export enum HnswDistanceType {
  CHEBYSHEV = 'CHEBYSHEV',
  COSINE = 'COSINE',
  EUCLIDEAN = 'EUCLIDEAN',
  HAMMING = 'HAMMING',
  JACCARD = 'JACCARD',
  MANHATTAN = 'MANHATTAN',
  MINKOWSKI = 'MINKOWSKI',
  PEARSON = 'PEARSON',
}

/**
 * MTREE vector type (also used for HNSW)
 */
export enum MTreeVectorType {
  F64 = 'F64',
  F32 = 'F32',
  I64 = 'I64',
  I32 = 'I32',
  I16 = 'I16',
}

/**
 * Index definition
 */
export interface IndexDefinition {
  readonly name: string
  readonly fields: readonly string[]
  readonly type: IndexType
  /**
   * Full-text index analyzer name. Only meaningful for {@link IndexType.SEARCH}
   * indexes; when unset the index renders the historical `ascii` analyzer.
   */
  readonly searchAnalyzer?: string
  /**
   * Whether a full-text index emits the `BM25` relevance-scoring clause —
   * required for `search::score` to return a value. Uses the engine's default
   * `(k1, b)` parameters.
   */
  readonly bm25?: boolean
  /**
   * Whether a full-text index stores positional `HIGHLIGHTS` data (enables
   * `search::highlight` / `search::offsets`).
   */
  readonly highlights?: boolean
  readonly mtreeDistance?: MTreeDistanceType
  readonly mtreeDimension?: number
  readonly mtreeVectorType?: MTreeVectorType
  readonly mtreeCapacity?: number
  readonly hnswDistance?: HnswDistanceType
  readonly hnswEfc?: number
  readonly hnswM?: number
}

/**
 * Event/trigger definition
 */
export interface EventDefinition {
  readonly name: string
  readonly when: string
  readonly then: string
}

/**
 * Table-level permissions
 */
export interface TablePermissions {
  readonly select?: string
  readonly create?: string
  readonly update?: string
  readonly delete?: string
}

/**
 * Immutable table schema definition
 */
export interface TableDefinition {
  readonly name: string
  readonly mode: TableMode
  readonly fields: readonly FieldDefinition[]
  readonly indexes: readonly IndexDefinition[]
  readonly events: readonly EventDefinition[]
  readonly permissions?: TablePermissions
  readonly comment?: string
}

/**
 * Create a table schema definition
 */
export function tableSchema(
  name: string,
  mode: TableMode = TableMode.SCHEMAFULL,
): TableDefinition {
  return Object.freeze({
    name,
    mode,
    fields: [],
    indexes: [],
    events: [],
  })
}

/** Add fields to a table definition */
export function withFields(table: TableDefinition, ...fields: FieldDefinition[]): TableDefinition {
  return Object.freeze({ ...table, fields: [...table.fields, ...fields] })
}

/** Add indexes to a table definition */
export function withIndexes(table: TableDefinition, ...indexes: IndexDefinition[]): TableDefinition {
  return Object.freeze({ ...table, indexes: [...table.indexes, ...indexes] })
}

/** Add events to a table definition */
export function withEvents(table: TableDefinition, ...events: EventDefinition[]): TableDefinition {
  return Object.freeze({ ...table, events: [...table.events, ...events] })
}

/** Set permissions on a table definition */
export function withPermissions(table: TableDefinition, permissions: TablePermissions): TableDefinition {
  return Object.freeze({ ...table, permissions })
}

/** Set table mode */
export function setMode(table: TableDefinition, mode: TableMode): TableDefinition {
  return Object.freeze({ ...table, mode })
}

/** Create a standard index */
export function index(name: string, ...fields: string[]): IndexDefinition {
  return Object.freeze({ name, fields, type: IndexType.STANDARD })
}

/** Create a unique index */
export function uniqueIndex(name: string, ...fields: string[]): IndexDefinition {
  return Object.freeze({ name, fields, type: IndexType.UNIQUE })
}

/**
 * Create a full-text search index.
 *
 * With no analyzer set the index renders the historical `ascii` default; pass
 * `analyzer` (e.g. one defined via `analyzer(...)`) and the `bm25` / `highlights`
 * options for a scorable index, or use {@link bm25Index} for the common
 * BM25-scored shape.
 */
export function searchIndex(
  name: string,
  fields: string[],
  analyzer?: string,
  options: { bm25?: boolean; highlights?: boolean } = {},
): IndexDefinition {
  const def: {
    name: string
    fields: string[]
    type: IndexType
    searchAnalyzer?: string
    bm25?: boolean
    highlights?: boolean
  } = { name, fields, type: IndexType.SEARCH }
  if (analyzer !== undefined) def.searchAnalyzer = analyzer
  if (options.bm25) def.bm25 = true
  if (options.highlights) def.highlights = true
  return Object.freeze(def)
}

/**
 * Create a BM25-scored full-text search index over `fields`, analyzed by
 * `analyzer`. This is the index to pair with `Query.fulltextSearch` and
 * `Query.searchScore` for lexical recall — BM25 is what makes `search::score`
 * return a relevance value.
 *
 * @example
 * ```ts
 * bm25Index('content_bm25', ['content'], 'text_en')
 * // emits: DEFINE INDEX content_bm25 ON TABLE <t> FIELDS content FULLTEXT ANALYZER text_en BM25;
 * ```
 */
export function bm25Index(name: string, fields: string[], analyzer: string): IndexDefinition {
  return searchIndex(name, fields, analyzer, { bm25: true })
}

/** Create an MTREE vector index */
export function mtreeIndex(
  name: string,
  field: string,
  dimension: number,
  options: {
    distance?: MTreeDistanceType
    vectorType?: MTreeVectorType
    capacity?: number
  } = {},
): IndexDefinition {
  return Object.freeze({
    name,
    fields: [field],
    type: IndexType.MTREE,
    mtreeDimension: dimension,
    mtreeDistance: options.distance ?? MTreeDistanceType.COSINE,
    mtreeVectorType: options.vectorType ?? MTreeVectorType.F64,
    mtreeCapacity: options.capacity,
  })
}

/** Create an HNSW vector index */
export function hnswIndex(
  name: string,
  field: string,
  dimension: number,
  options: {
    distance?: HnswDistanceType
    vectorType?: MTreeVectorType
    efc?: number
    m?: number
  } = {},
): IndexDefinition {
  return Object.freeze({
    name,
    fields: [field],
    type: IndexType.HNSW,
    mtreeDimension: dimension,
    mtreeVectorType: options.vectorType ?? MTreeVectorType.F32,
    hnswDistance: options.distance ?? HnswDistanceType.COSINE,
    hnswEfc: options.efc,
    hnswM: options.m,
  })
}

/** Create an event definition */
export function event(name: string, when: string, then: string): EventDefinition {
  return Object.freeze({ name, when, then })
}
