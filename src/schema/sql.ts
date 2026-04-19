import type { FieldDefinition } from './fields.ts'
import { FieldType } from './fields.ts'
import type { AccessDefinition } from './access.ts'
import { AccessType } from './access.ts'
import type { EdgeDefinition } from './edge.ts'
import type { EventDefinition, IndexDefinition, TableDefinition } from './table.ts'
import { IndexType } from './table.ts'

function fieldTypeToSql(field: FieldDefinition): string {
  if (field.type === FieldType.RECORD && field.recordLink) {
    return `record<${field.recordLink}>`
  }
  if (field.type === FieldType.ARRAY && field.arrayType) {
    return `array<${field.arrayType}>`
  }
  return field.type
}

function generateFieldSql(tableName: string, field: FieldDefinition): string {
  const parts: string[] = []
  const typeStr = fieldTypeToSql(field)

  if (field.flexible) {
    parts.push(`DEFINE FIELD ${field.name} ON TABLE ${tableName} FLEXIBLE TYPE ${typeStr}`)
  } else {
    parts.push(`DEFINE FIELD ${field.name} ON TABLE ${tableName} TYPE ${typeStr}`)
  }

  if (field.defaultValue) {
    parts[0] += ` DEFAULT ${field.defaultValue}`
  }
  if (field.value) {
    parts[0] += ` VALUE ${field.value}`
  }
  if (field.assertion) {
    parts[0] += ` ASSERT ${field.assertion}`
  }
  if (field.readonly) {
    parts[0] += ' READONLY'
  }
  if (field.permissions) {
    const perms: string[] = []
    if (field.permissions.select) perms.push(`FOR select ${field.permissions.select}`)
    if (field.permissions.create) perms.push(`FOR create ${field.permissions.create}`)
    if (field.permissions.update) perms.push(`FOR update ${field.permissions.update}`)
    if (field.permissions.delete) perms.push(`FOR delete ${field.permissions.delete}`)
    if (perms.length > 0) {
      parts[0] += ` PERMISSIONS ${perms.join(', ')}`
    }
  }

  return parts[0] + ';'
}

function generateIndexSql(tableName: string, idx: IndexDefinition): string {
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
    case IndexType.HNSW:
      sql += ` HNSW DIMENSION ${idx.mtreeDimension}`
      if (idx.hnswDistance) sql += ` DIST ${idx.hnswDistance}`
      if (idx.mtreeVectorType) sql += ` TYPE ${idx.mtreeVectorType}`
      if (idx.hnswEfc !== undefined) sql += ` EFC ${idx.hnswEfc}`
      if (idx.hnswM !== undefined) sql += ` M ${idx.hnswM}`
      break
  }

  return sql + ';'
}

function generateEventSql(tableName: string, evt: EventDefinition): string {
  return `DEFINE EVENT ${evt.name} ON TABLE ${tableName} WHEN ${evt.when} THEN (${evt.then});`
}

/**
 * Generate SurrealQL DDL for a table definition.
 *
 * Pass `ifNotExists: true` to emit `DEFINE TABLE IF NOT EXISTS ...` so the
 * statement is idempotent against an existing schema. The flag also applies
 * to the secondary `DEFINE TABLE ... PERMISSIONS` line when table-level
 * permissions are configured.
 */
export function generateTableSql(table: TableDefinition, options: { ifNotExists?: boolean } = {}): string {
  const ine = options.ifNotExists ? ' IF NOT EXISTS' : ''
  const lines: string[] = []

  lines.push(`DEFINE TABLE${ine} ${table.name} ${table.mode};`)

  for (const field of table.fields) {
    lines.push(generateFieldSql(table.name, field))
  }

  for (const idx of table.indexes) {
    lines.push(generateIndexSql(table.name, idx))
  }

  for (const evt of table.events) {
    lines.push(generateEventSql(table.name, evt))
  }

  if (table.permissions) {
    const perms: string[] = []
    if (table.permissions.select) perms.push(`FOR select ${table.permissions.select}`)
    if (table.permissions.create) perms.push(`FOR create ${table.permissions.create}`)
    if (table.permissions.update) perms.push(`FOR update ${table.permissions.update}`)
    if (table.permissions.delete) perms.push(`FOR delete ${table.permissions.delete}`)
    if (perms.length > 0) {
      lines.push(`DEFINE TABLE${ine} ${table.name} PERMISSIONS ${perms.join(', ')};`)
    }
  }

  return lines.join('\n')
}

/**
 * Generate SurrealQL DDL for an edge definition.
 *
 * Pass `ifNotExists: true` to emit `DEFINE TABLE IF NOT EXISTS ... TYPE RELATION`
 * for idempotent schema application.
 */
export function generateEdgeSql(edge: EdgeDefinition, options: { ifNotExists?: boolean } = {}): string {
  const ine = options.ifNotExists ? ' IF NOT EXISTS' : ''
  const lines: string[] = []

  let tableDef = `DEFINE TABLE${ine} ${edge.name} TYPE ${edge.mode}`
  if (edge.fromTable) tableDef += ` FROM ${edge.fromTable}`
  if (edge.toTable) tableDef += ` TO ${edge.toTable}`
  lines.push(tableDef + ';')

  for (const field of edge.fields) {
    lines.push(generateFieldSql(edge.name, field))
  }

  for (const idx of edge.indexes) {
    lines.push(generateIndexSql(edge.name, idx))
  }

  for (const evt of edge.events) {
    lines.push(generateEventSql(edge.name, evt))
  }

  return lines.join('\n')
}

/**
 * Generate SurrealQL DDL for an access definition.
 *
 * Pass `ifNotExists: true` to emit `DEFINE ACCESS IF NOT EXISTS ...` so the
 * statement can be re-run safely.
 */
export function generateAccessSql(
  access: AccessDefinition,
  level: string = 'DATABASE',
  options: { ifNotExists?: boolean } = {},
): string {
  const ine = options.ifNotExists ? ' IF NOT EXISTS' : ''
  if (access.type === AccessType.JWT && access.jwt) {
    let sql = `DEFINE ACCESS${ine} ${access.name} ON ${level} TYPE JWT`
    sql += ` ALGORITHM ${access.jwt.algorithm}`
    sql += ` KEY '${access.jwt.key}'`
    if (access.jwt.issuer) sql += ` WITH ISSUER '${access.jwt.issuer}'`
    return sql + ';'
  }

  if (access.type === AccessType.RECORD && access.record) {
    let sql = `DEFINE ACCESS${ine} ${access.name} ON ${level} TYPE RECORD`
    if (access.record.signup) sql += ` SIGNUP (${access.record.signup})`
    if (access.record.signin) sql += ` SIGNIN (${access.record.signin})`
    return sql + ';'
  }

  return `DEFINE ACCESS${ine} ${access.name} ON ${level} TYPE ${access.type};`
}

/**
 * Generate all schema SQL from tables, edges, and access definitions.
 *
 * Pass `ifNotExists: true` to propagate `IF NOT EXISTS` to every emitted
 * `DEFINE TABLE` and `DEFINE ACCESS` statement.
 */
export function generateSchemaSql(options: {
  tables?: TableDefinition[]
  edges?: EdgeDefinition[]
  access?: AccessDefinition[]
  ifNotExists?: boolean
}): string {
  const parts: string[] = []
  const emitOpts = { ifNotExists: options.ifNotExists }

  if (options.tables) {
    for (const table of options.tables) {
      parts.push(generateTableSql(table, emitOpts))
    }
  }

  if (options.edges) {
    for (const edge of options.edges) {
      parts.push(generateEdgeSql(edge, emitOpts))
    }
  }

  if (options.access) {
    for (const acc of options.access) {
      parts.push(generateAccessSql(acc, 'DATABASE', emitOpts))
    }
  }

  return parts.join('\n\n')
}
