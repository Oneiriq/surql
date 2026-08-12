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
  /**
   * On-disk approximate-nearest-neighbour graph (SurrealDB 3.2+). The graph
   * lives on disk rather than in memory, so an index outgrows RAM without
   * outgrowing the box. Build it with {@link diskannIndex}.
   */
  DISKANN = 'DISKANN',
}

/**
 * Graph out-degree the engine assumes (and echoes) for a DISKANN index that
 * never stated `DEGREE`.
 */
export const DISKANN_DEFAULT_DEGREE = 64

/**
 * Build-time candidate list size the engine assumes (and echoes) for a DISKANN
 * index that never stated `L_BUILD`.
 */
export const DISKANN_DEFAULT_L_BUILD = 100

/**
 * Pruning slack the engine assumes (and echoes) for a DISKANN index that never
 * stated `ALPHA`.
 */
export const DISKANN_DEFAULT_ALPHA = '1.2'

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
 * DISKANN vector distance metric.
 *
 * Its own enum rather than a reuse of {@link HnswDistanceType}: the engine's
 * DISKANN set both adds metrics HNSW lacks (`INNER_PRODUCT`,
 * `COSINE_NORMALIZED`) and refuses every HNSW metric outside it, so an
 * out-of-set metric is unrepresentable here.
 */
export enum DiskAnnDistanceType {
  COSINE = 'COSINE',
  COSINE_NORMALIZED = 'COSINE_NORMALIZED',
  EUCLIDEAN = 'EUCLIDEAN',
  INNER_PRODUCT = 'INNER_PRODUCT',
}

/**
 * Numeric type for vector components in MTREE, HNSW, and DISKANN indexes.
 *
 * One shared vocabulary; each index kind accepts a subset. The engine takes
 * every member for HNSW, refuses `F16` / `I8` / `U8` for MTREE, and refuses
 * everything but `F32` / `F16` / `I8` / `U8` for DISKANN. The builders throw
 * on a combination the engine would reject.
 */
export enum MTreeVectorType {
  F64 = 'F64',
  F32 = 'F32',
  F16 = 'F16',
  I64 = 'I64',
  I32 = 'I32',
  I16 = 'I16',
  I8 = 'I8',
  U8 = 'U8',
}

/** Element types MTREE refuses; the engine answers with a bare parse error. */
const MTREE_REFUSED_TYPES: readonly MTreeVectorType[] = [
  MTreeVectorType.F16,
  MTreeVectorType.I8,
  MTreeVectorType.U8,
]

/** The only element types DISKANN accepts. */
const DISKANN_ALLOWED_TYPES: readonly MTreeVectorType[] = [
  MTreeVectorType.F32,
  MTreeVectorType.F16,
  MTreeVectorType.I8,
  MTreeVectorType.U8,
]

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
  readonly diskAnnDistance?: DiskAnnDistanceType
  /** DISKANN graph out-degree (`DEGREE`, engine default 64). */
  readonly diskAnnDegree?: number
  /** DISKANN build-time candidate list size (`L_BUILD`, engine default 100). */
  readonly diskAnnLBuild?: number
  /**
   * DISKANN pruning slack (`ALPHA`, engine default 1.2), held as the decimal
   * literal the statement carries. The engine echoes a float literal with a
   * trailing `f` suffix (`ALPHA 1.2f`), which the parser strips so code and
   * echo compare equal.
   */
  readonly diskAnnAlpha?: string
  /** Whether a DISKANN index stores hashed vectors (`HASHED_VECTOR`). */
  readonly diskAnnHashedVector?: boolean
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
  const vectorType = options.vectorType ?? MTreeVectorType.F64
  if (MTREE_REFUSED_TYPES.includes(vectorType)) {
    throw new Error(
      `MTREE index '${name}' cannot use TYPE ${vectorType}: the engine only accepts ` +
        `F64, F32, I64, I32, or I16 for MTREE`,
    )
  }
  return Object.freeze({
    name,
    fields: [field],
    type: IndexType.MTREE,
    mtreeDimension: dimension,
    mtreeDistance: options.distance ?? MTreeDistanceType.COSINE,
    mtreeVectorType: vectorType,
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

/**
 * Render a DISKANN `ALPHA` value the way the engine echoes it.
 *
 * A whole number echoes bare (`ALPHA 2`) and a fractional one echoes as a
 * float literal with a trailing `f` the parser strips (`ALPHA 1.2f` reads back
 * as `1.2`). Producing that same shape here is what lets a definition compare
 * equal to its own echo instead of re-applying on every reconcile.
 */
export function canonicalAlpha(alpha: number): string {
  return Number.isInteger(alpha) ? String(Math.trunc(alpha)) : String(alpha)
}

/**
 * Create a DISKANN vector index.
 *
 * DISKANN keeps its graph on disk, which suits a corpus that outgrows the
 * memory an HNSW graph would need. The engine echoes `DEGREE` / `L_BUILD` /
 * `ALPHA` back with defaults filled in even when the definition never stated
 * them, so this fills the same defaults up front.
 *
 * Throws when the element type is one the engine refuses for DISKANN.
 */
export function diskannIndex(
  name: string,
  field: string,
  dimension: number,
  options: {
    distance?: DiskAnnDistanceType
    vectorType?: MTreeVectorType
    degree?: number
    lBuild?: number
    alpha?: number
    hashedVector?: boolean
  } = {},
): IndexDefinition {
  const vectorType = options.vectorType ?? MTreeVectorType.F32
  if (!DISKANN_ALLOWED_TYPES.includes(vectorType)) {
    throw new Error(
      `DISKANN index '${name}' cannot use TYPE ${vectorType}: the engine only accepts ` +
        `F32, F16, I8, or U8 for DISKANN`,
    )
  }
  return Object.freeze({
    name,
    fields: [field],
    type: IndexType.DISKANN,
    mtreeDimension: dimension,
    mtreeVectorType: vectorType,
    diskAnnDistance: options.distance ?? DiskAnnDistanceType.EUCLIDEAN,
    diskAnnDegree: options.degree ?? DISKANN_DEFAULT_DEGREE,
    diskAnnLBuild: options.lBuild ?? DISKANN_DEFAULT_L_BUILD,
    diskAnnAlpha: options.alpha === undefined ? DISKANN_DEFAULT_ALPHA : canonicalAlpha(options.alpha),
    diskAnnHashedVector: options.hashedVector ?? false,
  })
}

/** Create an event definition */
export function event(name: string, when: string, then: string): EventDefinition {
  return Object.freeze({ name, when, then })
}
