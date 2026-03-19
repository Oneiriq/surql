import type { FieldDefinition } from './fields.ts'
import type { EventDefinition, IndexDefinition, TablePermissions } from './table.ts'

/**
 * Edge schema mode
 */
export enum EdgeMode {
  RELATION = 'RELATION',
  SCHEMAFULL = 'SCHEMAFULL',
  SCHEMALESS = 'SCHEMALESS',
}

/**
 * Immutable edge/relation definition
 */
export interface EdgeDefinition {
  readonly name: string
  readonly mode: EdgeMode
  readonly fromTable?: string
  readonly toTable?: string
  readonly fields: readonly FieldDefinition[]
  readonly indexes: readonly IndexDefinition[]
  readonly events: readonly EventDefinition[]
  readonly permissions?: TablePermissions
}

/** Create an edge schema definition */
export function edgeSchema(name: string, mode: EdgeMode = EdgeMode.RELATION): EdgeDefinition {
  return Object.freeze({ name, mode, fields: [], indexes: [], events: [] })
}

/** Set the FROM table constraint */
export function withFromTable(edge: EdgeDefinition, table: string): EdgeDefinition {
  return Object.freeze({ ...edge, fromTable: table })
}

/** Set the TO table constraint */
export function withToTable(edge: EdgeDefinition, table: string): EdgeDefinition {
  return Object.freeze({ ...edge, toTable: table })
}

/** Add fields to an edge */
export function withEdgeFields(edge: EdgeDefinition, ...fields: FieldDefinition[]): EdgeDefinition {
  return Object.freeze({ ...edge, fields: [...edge.fields, ...fields] })
}

/** Add indexes to an edge */
export function withEdgeIndexes(edge: EdgeDefinition, ...indexes: IndexDefinition[]): EdgeDefinition {
  return Object.freeze({ ...edge, indexes: [...edge.indexes, ...indexes] })
}

/** Add events to an edge */
export function withEdgeEvents(edge: EdgeDefinition, ...events: EventDefinition[]): EdgeDefinition {
  return Object.freeze({ ...edge, events: [...edge.events, ...events] })
}

/** Set permissions on an edge */
export function withEdgePermissions(edge: EdgeDefinition, permissions: TablePermissions): EdgeDefinition {
  return Object.freeze({ ...edge, permissions })
}

/** Create a bidirectional edge */
export function bidirectionalEdge(
  name: string,
  tableA: string,
  tableB: string,
  mode: EdgeMode = EdgeMode.RELATION,
): EdgeDefinition {
  return Object.freeze({
    name,
    mode,
    fromTable: tableA,
    toTable: tableB,
    fields: [],
    indexes: [],
    events: [],
  })
}

/** Create a typed edge with constrained from/to */
export function typedEdge(
  name: string,
  from: string,
  to: string,
  mode: EdgeMode = EdgeMode.SCHEMAFULL,
): EdgeDefinition {
  return Object.freeze({
    name,
    mode,
    fromTable: from,
    toTable: to,
    fields: [],
    indexes: [],
    events: [],
  })
}
