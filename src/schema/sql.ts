import type { FieldDefinition } from './fields.ts'
import { FieldType } from './fields.ts'
import type { AccessDefinition } from './access.ts'
import { AccessType } from './access.ts'
import type { AnalyzerDefinition } from './analyzer.ts'
import { analyzerToSurql, validateAnalyzer } from './analyzer.ts'
import type { EdgeDefinition } from './edge.ts'
import type { EventDefinition, IndexDefinition, TableDefinition } from './table.ts'
import { IndexType } from './table.ts'

/**
 * Render a `PERMISSIONS` clause for a `DEFINE TABLE`, `DEFINE FIELD`, or
 * relation statement.
 *
 * Each configured action contributes a `FOR <action>` sub-clause; the
 * SurrealDB v3 grammar folds them all into the owning statement, separated
 * by whitespace. The returned string carries a leading space (or is empty
 * when no permissions are set) so callers can append it unconditionally.
 */
function permissionsClause(
  perms: { select?: string; create?: string; update?: string; delete?: string } | undefined,
): string {
  if (!perms) return ''
  const clauses: string[] = []
  if (perms.select) clauses.push(`FOR select ${perms.select}`)
  if (perms.create) clauses.push(`FOR create ${perms.create}`)
  if (perms.update) clauses.push(`FOR update ${perms.update}`)
  if (perms.delete) clauses.push(`FOR delete ${perms.delete}`)
  return clauses.length > 0 ? ` PERMISSIONS ${clauses.join(' ')}` : ''
}

/**
 * Render a field's SurrealQL type. A record link emits `record<target>` and
 * an array element type emits `array<T>`; an `optional` field wraps the whole
 * type as `option<...>` so a SCHEMAFULL column accepts NONE.
 *
 * Exported so the migration differ renders field types identically to the
 * initial schema generator.
 */
export function fieldTypeToSql(field: FieldDefinition): string {
  let type: string
  if (field.type === FieldType.RECORD && field.recordLink) {
    type = `record<${field.recordLink}>`
  } else if (field.type === FieldType.ARRAY && field.arrayType) {
    type = `array<${field.arrayType}>`
  } else {
    type = field.type
  }
  return field.optional ? `option<${type}>` : type
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
  parts[0] += permissionsClause(field.permissions)

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
 * Table-level permissions are folded into the single `DEFINE TABLE`
 * statement. They must NOT be emitted as a second `DEFINE TABLE` line: on
 * SurrealDB v3 a repeat `DEFINE TABLE` for an existing table fails with
 * `The table '<name>' already exists`, and even where it parsed it would
 * redefine the table — silently dropping its `SCHEMAFULL`/`SCHEMALESS` mode.
 *
 * Pass `ifNotExists: true` to emit `DEFINE TABLE IF NOT EXISTS ...` so the
 * statement is idempotent against an existing schema.
 */
export function generateTableSql(table: TableDefinition, options: { ifNotExists?: boolean } = {}): string {
  const ine = options.ifNotExists ? ' IF NOT EXISTS' : ''
  const lines: string[] = []

  lines.push(`DEFINE TABLE${ine} ${table.name} ${table.mode}${permissionsClause(table.permissions)};`)

  for (const field of table.fields) {
    lines.push(generateFieldSql(table.name, field))
  }

  for (const idx of table.indexes) {
    lines.push(generateIndexSql(table.name, idx))
  }

  for (const evt of table.events) {
    lines.push(generateEventSql(table.name, evt))
  }

  return lines.join('\n')
}

/**
 * Generate SurrealQL DDL for an edge definition.
 *
 * Edge permissions are folded into the relation's `DEFINE TABLE` statement;
 * an edge built with `withEdgePermissions(...)` previously had its
 * permissions silently dropped.
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
  tableDef += permissionsClause(edge.permissions)
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
 * Generate SurrealQL DDL for a `DEFINE ANALYZER` definition.
 *
 * Validates the analyzer first (a definition with an empty name throws). Pass
 * `ifNotExists: true` to emit `DEFINE ANALYZER IF NOT EXISTS ...` for idempotent
 * re-application.
 *
 * An analyzer must be defined BEFORE any full-text index that references it, so
 * `generateSchemaSql` emits analyzer statements ahead of tables.
 */
export function generateAnalyzerSql(analyzer: AnalyzerDefinition, options: { ifNotExists?: boolean } = {}): string {
  validateAnalyzer(analyzer)
  return analyzerToSurql(analyzer, options)
}

/**
 * Generate all schema SQL from analyzers, tables, edges, and access
 * definitions.
 *
 * Analyzers render first so a full-text index can reference an analyzer defined
 * earlier in the same script. Pass `ifNotExists: true` to propagate
 * `IF NOT EXISTS` to every emitted `DEFINE ANALYZER` / `DEFINE TABLE` /
 * `DEFINE ACCESS` statement.
 */
export function generateSchemaSql(options: {
  analyzers?: AnalyzerDefinition[]
  tables?: TableDefinition[]
  edges?: EdgeDefinition[]
  access?: AccessDefinition[]
  ifNotExists?: boolean
}): string {
  const parts: string[] = []
  const emitOpts = { ifNotExists: options.ifNotExists }

  if (options.analyzers) {
    for (const a of options.analyzers) {
      parts.push(generateAnalyzerSql(a, emitOpts))
    }
  }

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
