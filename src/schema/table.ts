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
 * MTREE vector type
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
  readonly searchAnalyzer?: string
  readonly mtreeDistance?: MTreeDistanceType
  readonly mtreeDimension?: number
  readonly mtreeVectorType?: MTreeVectorType
  readonly mtreeCapacity?: number
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

/** Create a search index */
export function searchIndex(name: string, fields: string[], analyzer: string): IndexDefinition {
  return Object.freeze({ name, fields, type: IndexType.SEARCH, searchAnalyzer: analyzer })
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

/** Create an event definition */
export function event(name: string, when: string, then: string): EventDefinition {
  return Object.freeze({ name, when, then })
}
