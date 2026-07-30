import type { EdgeDefinition } from '../schema/edge.ts'
import type { FieldDefinition } from '../schema/fields.ts'
import { type IndexDefinition, IndexType, type TableDefinition } from '../schema/table.ts'
import { fieldTypeToSql, generateEdgeSql, generateTableSql } from '../schema/sql.ts'
import type { BucketDefinition } from '../schema/bucket.ts'
import { generateAlterBucketSql, generateBucketSql, generateRemoveBucketSql } from '../schema/bucket.ts'
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

  // Added tables — emit the complete table DDL (mode, permissions, fields,
  // indexes, events). A bare `DEFINE TABLE name mode;` would apply a migration
  // that creates an empty table, silently dropping every column, index, and
  // event the target schema declared.
  for (const [name, table] of targetMap) {
    if (!currentMap.has(name)) {
      diffs.push({
        operation: DiffOperation.ADD_TABLE,
        table: name,
        details: `Add table '${name}' (${table.mode})`,
        sql: generateTableSql(table),
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
        sql: `DEFINE FIELD ${name} ON TABLE ${tableName} TYPE ${fieldTypeToSql(field)};`,
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

    // Compare the fully-rendered type so a changed record link
    // (`record<a>` -> `record<b>`), array element type, or optionality is
    // detected — not only a change of the base `FieldType`.
    const currentType = fieldTypeToSql(currentField)
    const targetType = fieldTypeToSql(targetField)
    if (currentType !== targetType) {
      diffs.push({
        operation: DiffOperation.MODIFY_FIELD,
        table: tableName,
        field: name,
        details: `Modify field '${name}': ${currentType} -> ${targetType}`,
        sql: `DEFINE FIELD ${name} ON TABLE ${tableName} TYPE ${targetType};`,
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
      sql += ` FULLTEXT ANALYZER ${idx.searchAnalyzer ?? 'ascii'}`
      if (idx.bm25) sql += ' BM25'
      if (idx.highlights) sql += ' HIGHLIGHTS'
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

  // Edge added — emit the complete relation DDL (FROM/TO constraints,
  // permissions, fields, indexes, events) rather than a bare DEFINE TABLE.
  if (oldEdge === null && newEdge !== null) {
    diffs.push({
      operation: DiffOperation.ADD_TABLE,
      table: newEdge.name,
      details: `Add edge '${newEdge.name}'`,
      sql: generateEdgeSql(newEdge),
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

/**
 * Diff two sets of bucket definitions.
 *
 * Mirrors {@link diffTables}: buckets present only in `target` are added with a
 * full `DEFINE BUCKET`, buckets present only in `current` are dropped with
 * `REMOVE BUCKET`, and buckets present in both whose attributes changed emit an
 * `ALTER BUCKET`. A bucket whose attributes are unchanged produces no diff.
 */
export function diffBuckets(
  current: readonly BucketDefinition[],
  target: readonly BucketDefinition[],
): SchemaDiff[] {
  const diffs: SchemaDiff[] = []
  const currentMap = new Map(current.map((b) => [b.name, b]))
  const targetMap = new Map(target.map((b) => [b.name, b]))

  // Added buckets
  for (const [name, bucket] of targetMap) {
    if (!currentMap.has(name)) {
      diffs.push({
        operation: DiffOperation.ADD_BUCKET,
        table: name,
        bucket: name,
        details: `Add bucket '${name}' (backend ${bucket.backend})`,
        sql: generateBucketSql(bucket),
      })
    }
  }

  // Dropped buckets
  for (const [name] of currentMap) {
    if (!targetMap.has(name)) {
      diffs.push({
        operation: DiffOperation.DROP_BUCKET,
        table: name,
        bucket: name,
        details: `Drop bucket '${name}'`,
        sql: generateRemoveBucketSql(name),
      })
    }
  }

  // Modified buckets
  for (const [name, targetBucket] of targetMap) {
    const currentBucket = currentMap.get(name)
    if (!currentBucket) continue
    const alterSql = generateAlterBucketSql(currentBucket, targetBucket)
    if (alterSql !== undefined) {
      diffs.push({
        operation: DiffOperation.MODIFY_BUCKET,
        table: name,
        bucket: name,
        details: `Modify bucket '${name}'`,
        sql: alterSql,
      })
    }
  }

  return diffs
}
