import type { EdgeDefinition } from '../schema/edge.ts'
import type { FieldDefinition } from '../schema/fields.ts'
import { IndexType, type IndexDefinition, type TableDefinition } from '../schema/table.ts'
import { DiffOperation, type SchemaDiff } from './models.ts'

/**
 * Diff two sets of table definitions
 */
export function diffTables(
  current: TableDefinition[],
  target: TableDefinition[],
): SchemaDiff[] {
  const diffs: SchemaDiff[] = []
  const currentMap = new Map(current.map((t) => [t.name, t]))
  const targetMap = new Map(target.map((t) => [t.name, t]))

  // Added tables
  for (const [name, table] of targetMap) {
    if (!currentMap.has(name)) {
      diffs.push({
        operation: DiffOperation.ADD_TABLE,
        table: name,
        details: `Add table '${name}' (${table.mode})`,
        sql: `DEFINE TABLE ${name} ${table.mode};`,
      })
    }
  }

  // Dropped tables
  for (const [name] of currentMap) {
    if (!targetMap.has(name)) {
      diffs.push({
        operation: DiffOperation.DROP_TABLE,
        table: name,
        details: `Drop table '${name}'`,
        sql: `REMOVE TABLE ${name};`,
      })
    }
  }

  // Modified tables
  for (const [name, targetTable] of targetMap) {
    const currentTable = currentMap.get(name)
    if (!currentTable) continue

    diffs.push(...diffFields(name, currentTable.fields, targetTable.fields))
    diffs.push(...diffIndexes(name, currentTable.indexes, targetTable.indexes))
    diffs.push(...diffEvents(name, currentTable.events, targetTable.events))
  }

  return diffs
}

/**
 * Diff field definitions for a table
 */
export function diffFields(
  tableName: string,
  current: readonly FieldDefinition[],
  target: readonly FieldDefinition[],
): SchemaDiff[] {
  const diffs: SchemaDiff[] = []
  const currentMap = new Map(current.map((f) => [f.name, f]))
  const targetMap = new Map(target.map((f) => [f.name, f]))

  for (const [name, field] of targetMap) {
    if (!currentMap.has(name)) {
      diffs.push({
        operation: DiffOperation.ADD_FIELD,
        table: tableName,
        field: name,
        details: `Add field '${name}' (${field.type})`,
        sql: `DEFINE FIELD ${name} ON TABLE ${tableName} TYPE ${field.type};`,
      })
    }
  }

  for (const [name] of currentMap) {
    if (!targetMap.has(name)) {
      diffs.push({
        operation: DiffOperation.DROP_FIELD,
        table: tableName,
        field: name,
        details: `Drop field '${name}'`,
        sql: `REMOVE FIELD ${name} ON TABLE ${tableName};`,
      })
    }
  }

  for (const [name, targetField] of targetMap) {
    const currentField = currentMap.get(name)
    if (!currentField) continue

    if (currentField.type !== targetField.type) {
      diffs.push({
        operation: DiffOperation.MODIFY_FIELD,
        table: tableName,
        field: name,
        details: `Modify field '${name}': ${currentField.type} -> ${targetField.type}`,
        sql: `DEFINE FIELD ${name} ON TABLE ${tableName} TYPE ${targetField.type};`,
      })
    }
  }

  return diffs
}

function buildIndexSql(tableName: string, idx: IndexDefinition): string {
  const fields = idx.fields.join(', ')
  let sql = `DEFINE INDEX ${idx.name} ON TABLE ${tableName} FIELDS ${fields}`

  switch (idx.type) {
    case IndexType.UNIQUE:
      sql += ' UNIQUE'
      break
    case IndexType.SEARCH:
      if (idx.searchAnalyzer) sql += ` SEARCH ANALYZER ${idx.searchAnalyzer}`
      break
    case IndexType.MTREE:
      sql += ` MTREE DIMENSION ${idx.mtreeDimension}`
      if (idx.mtreeDistance) sql += ` DIST ${idx.mtreeDistance}`
      if (idx.mtreeVectorType) sql += ` TYPE ${idx.mtreeVectorType}`
      if (idx.mtreeCapacity) sql += ` CAPACITY ${idx.mtreeCapacity}`
      break
  }

  return sql + ';'
}

/**
 * Diff index definitions for a table
 */
export function diffIndexes(
  tableName: string,
  current: readonly IndexDefinition[],
  target: readonly IndexDefinition[],
): SchemaDiff[] {
  const diffs: SchemaDiff[] = []
  const currentMap = new Map(current.map((i) => [i.name, i]))
  const targetMap = new Map(target.map((i) => [i.name, i]))

  for (const [name, idx] of targetMap) {
    if (!currentMap.has(name)) {
      diffs.push({
        operation: DiffOperation.ADD_INDEX,
        table: tableName,
        details: `Add index '${name}' on (${idx.fields.join(', ')})`,
        sql: buildIndexSql(tableName, idx),
      })
    }
  }

  for (const [name] of currentMap) {
    if (!targetMap.has(name)) {
      diffs.push({
        operation: DiffOperation.DROP_INDEX,
        table: tableName,
        details: `Drop index '${name}'`,
        sql: `REMOVE INDEX ${name} ON TABLE ${tableName};`,
      })
    }
  }

  return diffs
}

/**
 * Diff event definitions for a table
 */
export function diffEvents(
  tableName: string,
  current: readonly { name: string }[],
  target: readonly { name: string }[],
): SchemaDiff[] {
  const diffs: SchemaDiff[] = []
  const currentNames = new Set(current.map((e) => e.name))
  const targetNames = new Set(target.map((e) => e.name))

  for (const name of targetNames) {
    if (!currentNames.has(name)) {
      diffs.push({
        operation: DiffOperation.ADD_EVENT,
        table: tableName,
        details: `Add event '${name}'`,
        sql: `-- Event '${name}' needs manual definition`,
      })
    }
  }

  for (const name of currentNames) {
    if (!targetNames.has(name)) {
      diffs.push({
        operation: DiffOperation.DROP_EVENT,
        table: tableName,
        details: `Drop event '${name}'`,
        sql: `REMOVE EVENT ${name} ON TABLE ${tableName};`,
      })
    }
  }

  return diffs
}

/**
 * Compare permission definitions between two table versions
 */
export function diffPermissions(
  oldTable: TableDefinition,
  newTable: TableDefinition,
): SchemaDiff[] {
  const diffs: SchemaDiff[] = []

  if (JSON.stringify(oldTable.permissions) !== JSON.stringify(newTable.permissions)) {
    diffs.push({
      operation: DiffOperation.MODIFY_PERMISSIONS,
      table: oldTable.name,
      details: `Modify permissions on '${oldTable.name}'`,
      sql: `-- Permissions change on '${oldTable.name}' requires manual review`,
    })
  }

  return diffs
}

/**
 * Compare two edge definitions and generate diff operations
 */
export function diffEdges(
  oldEdge: EdgeDefinition | null,
  newEdge: EdgeDefinition | null,
): SchemaDiff[] {
  const diffs: SchemaDiff[] = []

  // Edge added
  if (oldEdge === null && newEdge !== null) {
    diffs.push({
      operation: DiffOperation.ADD_TABLE,
      table: newEdge.name,
      details: `Add edge '${newEdge.name}'`,
      sql: `DEFINE TABLE ${newEdge.name} TYPE RELATION;`,
    })
    return diffs
  }

  // Edge removed
  if (oldEdge !== null && newEdge === null) {
    diffs.push({
      operation: DiffOperation.DROP_TABLE,
      table: oldEdge.name,
      details: `Drop edge '${oldEdge.name}'`,
      sql: `REMOVE TABLE ${oldEdge.name};`,
    })
    return diffs
  }

  // Both exist - compare fields, indexes, events, permissions
  if (oldEdge !== null && newEdge !== null) {
    diffs.push(...diffFields(newEdge.name, oldEdge.fields, newEdge.fields))
    diffs.push(...diffIndexes(newEdge.name, oldEdge.indexes || [], newEdge.indexes || []))
    diffs.push(...diffEvents(newEdge.name, oldEdge.events || [], newEdge.events || []))
    if (JSON.stringify(oldEdge.permissions) !== JSON.stringify(newEdge.permissions)) {
      diffs.push({
        operation: DiffOperation.MODIFY_PERMISSIONS,
        table: newEdge.name,
        details: `Modify permissions on '${newEdge.name}'`,
        sql: `-- Permissions change on '${newEdge.name}' requires manual review`,
      })
    }
  }

  return diffs
}
