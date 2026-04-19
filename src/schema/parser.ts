/**
 * Database schema parser.
 *
 * Parses SurrealDB `INFO FOR DB` / `INFO FOR TABLE` responses back into
 * structured `TableDefinition`, `EdgeDefinition`, `FieldDefinition`,
 * `IndexDefinition`, `EventDefinition`, and `AccessDefinition` values.
 *
 * 1:1 port of:
 * - `surql-py/src/surql/schema/parser.py`
 * - `surql-rs/src/schema/parser.rs`
 * - `surql-go/pkg/surql/schema/parser.go`
 *
 * Accepts both shapes the server can return:
 * - long-key maps (`fields`, `indexes`, `events`, `tables`, `accesses`)
 * - short-key maps (`fd`, `ix`, `ev`, `tb`, `ac`) as observed from SurrealDB v1.
 */

import type { Surreal } from 'surrealdb'
import { intoSurQlError } from '../utils/surrealError.ts'
import type { AccessDefinition, JwtConfig, RecordAccessConfig } from './access.ts'
import { AccessType } from './access.ts'
import type { EdgeDefinition } from './edge.ts'
import { EdgeMode } from './edge.ts'
import type { FieldDefinition } from './fields.ts'
import { FieldType } from './fields.ts'
import type { EventDefinition, IndexDefinition, TableDefinition } from './table.ts'
import { HnswDistanceType, IndexType, MTreeDistanceType, MTreeVectorType, TableMode } from './table.ts'

/** Strip `readonly` modifiers so definitions can be built incrementally. */
type Mutable<T> = {
  -readonly [K in keyof T]: T[K]
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/**
 * Error raised when a SurrealDB `INFO` payload or `DEFINE` statement cannot be
 * parsed into a structured definition.
 */
export class SchemaParseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'SchemaParseError'
    if (options?.cause !== undefined) {
      ;(this as unknown as { cause: unknown }).cause = options.cause
    }
  }
}

// ---------------------------------------------------------------------------
// Public return types
// ---------------------------------------------------------------------------

/**
 * Structured result of parsing an `INFO FOR DB` response.
 *
 * Tables declared with `TYPE RELATION FROM ... TO ...` are routed into
 * `edges`; every other table becomes a `TableDefinition` in `tables`.
 */
export interface DatabaseInfo {
  readonly tables: Readonly<Record<string, TableDefinition>>
  readonly edges: Readonly<Record<string, EdgeDefinition>>
  readonly accesses: Readonly<Record<string, AccessDefinition>>
}

// ---------------------------------------------------------------------------
// Keyword / clause helpers (word-boundary safe)
// ---------------------------------------------------------------------------

const IDENT_RE = /[A-Za-z0-9_]/
const FIELD_TYPE_RE = /TYPE\s+(\w+)/i
const READONLY_RE = /\bREADONLY\b/i
const FLEXIBLE_RE = /\bFLEXIBLE\b/i
const COLUMNS_RE = /COLUMNS\s+([^;]+?)(?:UNIQUE|SEARCH|HNSW|MTREE|\s*;|\s*$)/i
const FIELDS_RE = /FIELDS\s+([^;]+?)(?:UNIQUE|SEARCH|HNSW|MTREE|\s*;|\s*$)/i
const DIMENSION_RE = /DIMENSION\s+(\d+)/i
const DISTANCE_RE = /(?:DIST|DISTANCE)\s+(\w+)/i
const EFC_RE = /EFC\s+(\d+)/i
const M_RE = /\bM\s+(\d+)/i
const WHEN_RE = /WHEN\s+([\s\S]+?)\s+THEN/i
const THEN_BRACE_RE = /THEN\s+\{([\s\S]+?)\}(?:\s*;|\s*$)/i
const THEN_BARE_RE = /THEN\s+([\s\S]+?)(?:\s*;|\s*$)/i
const RELATION_RE = /TYPE\s+RELATION\s+FROM\s+(\w+)\s+TO\s+(\w+)/i
const ALGORITHM_RE = /ALGORITHM\s+(\w+)/i
const KEY_RE = /KEY\s+'([^']*)'/i
const URL_RE = /URL\s+'([^']*)'/i
const ISSUER_RE = /WITH\s+ISSUER\s+'([^']*)'/i
const SIGNUP_RE = /SIGNUP\s+\(([\s\S]+?)\)(?:\s+SIGNIN|\s+DURATION|\s*;|\s*$)/i
const SIGNIN_RE = /SIGNIN\s+\(([\s\S]+?)\)(?:\s+SIGNUP|\s+DURATION|\s*;|\s*$)/i
const SESSION_RE = /FOR\s+SESSION\s+(\w+)/i
const TOKEN_RE = /FOR\s+TOKEN\s+(\w+)/i
const ACCESS_TYPE_RE = /TYPE\s+(JWT|RECORD)/i

/** Is this byte/char part of an identifier? */
function isIdent(ch: string): boolean {
  return IDENT_RE.test(ch)
}

/**
 * Locate the case-insensitive keyword `kw` in `text`, honouring word
 * boundaries. When `requireWhitespaceLeft` is true, the keyword must sit at
 * position 0 or follow ASCII whitespace — this prevents a `$value` identifier
 * from terminating a clause that is scanning for the literal `VALUE` keyword.
 *
 * Returns the character offset at which the keyword starts, or `-1` if not
 * found.
 */
function findKeyword(text: string, kw: string, requireWhitespaceLeft: boolean): number {
  const textUpper = text.toUpperCase()
  const kwUpper = kw.toUpperCase()
  if (kwUpper.length === 0) return -1

  let i = 0
  while (i + kwUpper.length <= textUpper.length) {
    if (textUpper.slice(i, i + kwUpper.length) === kwUpper) {
      const leftOk = requireWhitespaceLeft
        ? i === 0 || /\s/.test(textUpper.charAt(i - 1))
        : i === 0 || !isIdent(textUpper.charAt(i - 1))
      const rightEnd = i + kwUpper.length
      const rightOk = rightEnd === textUpper.length || !isIdent(textUpper.charAt(rightEnd))
      if (leftOk && rightOk) return i
    }
    i += 1
  }
  return -1
}

/**
 * Extract the body of a `<KEYWORD> <body> [TERMINATOR | ;]` clause.
 *
 * `terminators` lists keywords that would end the clause; any such occurrence
 * after the `keyword` anchor truncates the body. A trailing semicolon always
 * truncates. Returns `undefined` when the clause is absent or has an empty
 * body.
 */
function extractClause(definition: string, keyword: string, terminators: readonly string[]): string | undefined {
  // Require the anchor keyword to be preceded by whitespace so the parser
  // does not mistake `$value` / `$before` / `$after` for a clause anchor.
  const start = findKeyword(definition, keyword, true)
  if (start < 0) return undefined
  const afterKw = start + keyword.length

  // Require at least one whitespace after the keyword (matches `\s+`).
  let restStart = afterKw
  while (restStart < definition.length && /\s/.test(definition.charAt(restStart))) restStart += 1
  if (restStart === afterKw) return undefined

  const tail = definition.slice(restStart)

  let end = tail.length
  for (const term of terminators) {
    const pos = findKeyword(tail, term, true)
    if (pos >= 0 && pos < end) end = pos
  }
  const semi = tail.indexOf(';')
  if (semi >= 0 && semi < end) end = semi

  const body = tail.slice(0, end).trim()
  if (body.length === 0) return undefined
  return body
}

// ---------------------------------------------------------------------------
// Input coercion helpers (INFO responses)
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function expectObject(value: unknown, context: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    const typeName = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
    throw new SchemaParseError(`${context}: expected object, got ${typeName}`)
  }
  return value
}

/**
 * Coerce a map-of-string JSON value into a `Record<string, string>`.
 *
 * Non-string values are skipped so callers can tolerate server responses that
 * stash additional metadata under the same key.
 */
function valueToStringMap(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

/** Pick the first populated child object from `info` under any of `keys`. */
function pickMap(info: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> | undefined {
  for (const k of keys) {
    const v = info[k]
    if (isPlainObject(v) && Object.keys(v).length > 0) return v
  }
  return undefined
}

function stringAt(info: Record<string, unknown>, ...keys: readonly string[]): string {
  for (const k of keys) {
    const v = info[k]
    if (typeof v === 'string') return v
  }
  return ''
}

// ---------------------------------------------------------------------------
// Field parsing
// ---------------------------------------------------------------------------

function extractFieldType(definition: string): FieldType {
  const m = FIELD_TYPE_RE.exec(definition)
  if (!m) return FieldType.ANY
  switch (m[1].toLowerCase()) {
    case 'string':
      return FieldType.STRING
    case 'int':
      return FieldType.INT
    case 'float':
      return FieldType.FLOAT
    case 'bool':
      return FieldType.BOOL
    case 'datetime':
      return FieldType.DATETIME
    case 'duration':
      return FieldType.DURATION
    case 'decimal':
      return FieldType.DECIMAL
    case 'number':
      return FieldType.NUMBER
    case 'object':
      return FieldType.OBJECT
    case 'array':
      return FieldType.ARRAY
    case 'record':
      return FieldType.RECORD
    case 'geometry':
      return FieldType.GEOMETRY
    default:
      return FieldType.ANY
  }
}

function extractAssertion(definition: string): string | undefined {
  return extractClause(definition, 'ASSERT', ['DEFAULT', 'VALUE', 'READONLY', 'FLEXIBLE', 'PERMISSIONS'])
}

function extractDefault(definition: string): string | undefined {
  return extractClause(definition, 'DEFAULT', ['VALUE', 'READONLY', 'FLEXIBLE', 'PERMISSIONS', 'ASSERT'])
}

function extractValue(definition: string): string | undefined {
  return extractClause(definition, 'VALUE', ['DEFAULT', 'READONLY', 'FLEXIBLE', 'PERMISSIONS', 'ASSERT'])
}

function extractReadonly(definition: string): boolean {
  return READONLY_RE.test(definition)
}

function extractFlexible(definition: string): boolean {
  return FLEXIBLE_RE.test(definition)
}

/**
 * Parse a single `DEFINE FIELD <name> ON ...` statement into a
 * `FieldDefinition`. Returns `undefined` when the definition string is empty.
 */
export function parseField(name: string, definition: string): FieldDefinition | undefined {
  if (!definition || definition.trim().length === 0) return undefined
  const base: Mutable<FieldDefinition> = {
    name,
    type: extractFieldType(definition),
  }
  const assertion = extractAssertion(definition)
  if (assertion !== undefined) base.assertion = assertion
  const defaultValue = extractDefault(definition)
  if (defaultValue !== undefined) base.defaultValue = defaultValue
  const value = extractValue(definition)
  if (value !== undefined) base.value = value
  if (extractReadonly(definition)) base.readonly = true
  if (extractFlexible(definition)) base.flexible = true
  return Object.freeze(base) as FieldDefinition
}

/** Parse every entry of a `fd` / `fields` map into `FieldDefinition` values. */
export function parseFields(fd: Record<string, string>): FieldDefinition[] {
  const out: FieldDefinition[] = []
  for (const [name, def] of Object.entries(fd)) {
    const parsed = parseField(name, def)
    if (parsed !== undefined) out.push(parsed)
  }
  return out
}

// ---------------------------------------------------------------------------
// Index parsing
// ---------------------------------------------------------------------------

function splitColumns(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function extractIndexColumns(definition: string): string[] {
  const m = COLUMNS_RE.exec(definition)
  if (!m) return []
  return splitColumns(m[1])
}

function extractIndexFields(definition: string): string[] {
  const m = FIELDS_RE.exec(definition)
  if (!m) return []
  return splitColumns(m[1])
}

function extractIndexType(definition: string): IndexType {
  const upper = definition.toUpperCase()
  if (upper.includes('UNIQUE')) return IndexType.UNIQUE
  if (upper.includes('SEARCH')) return IndexType.SEARCH
  if (upper.includes('HNSW')) return IndexType.HNSW
  if (upper.includes('MTREE')) return IndexType.MTREE
  return IndexType.STANDARD
}

function extractDimension(definition: string): number | undefined {
  const m = DIMENSION_RE.exec(definition)
  if (!m) return undefined
  const n = Number.parseInt(m[1], 10)
  return Number.isNaN(n) ? undefined : n
}

function extractMtreeDistance(definition: string): MTreeDistanceType | undefined {
  const m = DISTANCE_RE.exec(definition)
  if (!m) return undefined
  switch (m[1].toUpperCase()) {
    case 'COSINE':
      return MTreeDistanceType.COSINE
    case 'EUCLIDEAN':
      return MTreeDistanceType.EUCLIDEAN
    case 'MANHATTAN':
      return MTreeDistanceType.MANHATTAN
    case 'MINKOWSKI':
      return MTreeDistanceType.MINKOWSKI
    default:
      return undefined
  }
}

function extractHnswDistance(definition: string): HnswDistanceType | undefined {
  const m = DISTANCE_RE.exec(definition)
  if (!m) return undefined
  switch (m[1].toUpperCase()) {
    case 'CHEBYSHEV':
      return HnswDistanceType.CHEBYSHEV
    case 'COSINE':
      return HnswDistanceType.COSINE
    case 'EUCLIDEAN':
      return HnswDistanceType.EUCLIDEAN
    case 'HAMMING':
      return HnswDistanceType.HAMMING
    case 'JACCARD':
      return HnswDistanceType.JACCARD
    case 'MANHATTAN':
      return HnswDistanceType.MANHATTAN
    case 'MINKOWSKI':
      return HnswDistanceType.MINKOWSKI
    case 'PEARSON':
      return HnswDistanceType.PEARSON
    default:
      return undefined
  }
}

function extractVectorType(definition: string): MTreeVectorType | undefined {
  // MTREE/HNSW `TYPE` clauses usually appear after `MTREE` / `HNSW`. Scan every
  // TYPE occurrence in case the first one is swallowed by the field type
  // clause (SurrealDB uses `TYPE` twice for these indexes).
  const re = /TYPE\s+(\w+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(definition)) !== null) {
    switch (m[1].toUpperCase()) {
      case 'F64':
        return MTreeVectorType.F64
      case 'F32':
        return MTreeVectorType.F32
      case 'I64':
        return MTreeVectorType.I64
      case 'I32':
        return MTreeVectorType.I32
      case 'I16':
        return MTreeVectorType.I16
    }
  }
  return undefined
}

function extractHnswEfc(definition: string): number | undefined {
  const m = EFC_RE.exec(definition)
  if (!m) return undefined
  const n = Number.parseInt(m[1], 10)
  return Number.isNaN(n) ? undefined : n
}

function extractHnswM(definition: string): number | undefined {
  const m = M_RE.exec(definition)
  if (!m) return undefined
  const n = Number.parseInt(m[1], 10)
  return Number.isNaN(n) ? undefined : n
}

/**
 * Parse a single `DEFINE INDEX <name> ON TABLE <table> ...` statement into an
 * `IndexDefinition`. Returns `undefined` when the definition string is empty.
 */
export function parseIndex(name: string, definition: string): IndexDefinition | undefined {
  if (!definition || definition.trim().length === 0) return undefined

  let columns = extractIndexColumns(definition)
  if (columns.length === 0) columns = extractIndexFields(definition)

  const type = extractIndexType(definition)
  const base: Mutable<IndexDefinition> = {
    name,
    fields: columns,
    type,
  }

  if (type === IndexType.MTREE) {
    const dim = extractDimension(definition)
    if (dim !== undefined) base.mtreeDimension = dim
    const dist = extractMtreeDistance(definition)
    if (dist !== undefined) base.mtreeDistance = dist
    const vt = extractVectorType(definition)
    if (vt !== undefined) base.mtreeVectorType = vt
  } else if (type === IndexType.HNSW) {
    const dim = extractDimension(definition)
    if (dim !== undefined) base.mtreeDimension = dim
    const vt = extractVectorType(definition)
    if (vt !== undefined) base.mtreeVectorType = vt
    const dist = extractHnswDistance(definition)
    if (dist !== undefined) base.hnswDistance = dist
    const efc = extractHnswEfc(definition)
    if (efc !== undefined) base.hnswEfc = efc
    const m = extractHnswM(definition)
    if (m !== undefined) base.hnswM = m
  }

  return Object.freeze(base)
}

/** Parse every entry of an `ix` / `indexes` map into `IndexDefinition` values. */
export function parseIndexes(ix: Record<string, string>): IndexDefinition[] {
  const out: IndexDefinition[] = []
  for (const [name, def] of Object.entries(ix)) {
    const parsed = parseIndex(name, def)
    if (parsed !== undefined) out.push(parsed)
  }
  return out
}

// ---------------------------------------------------------------------------
// Event parsing
// ---------------------------------------------------------------------------

function extractEventCondition(definition: string): string | undefined {
  const m = WHEN_RE.exec(definition)
  return m ? m[1].trim() : undefined
}

function extractEventAction(definition: string): string | undefined {
  const braceMatch = THEN_BRACE_RE.exec(definition)
  if (braceMatch) return braceMatch[1].trim()
  const bareMatch = THEN_BARE_RE.exec(definition)
  if (bareMatch) return bareMatch[1].trim()
  return undefined
}

/**
 * Parse a single `DEFINE EVENT <name> ON TABLE <t> WHEN <c> THEN <a>` statement
 * into an `EventDefinition`. Returns `undefined` when either the condition or
 * action cannot be located.
 */
export function parseEvent(name: string, definition: string): EventDefinition | undefined {
  if (!definition || definition.trim().length === 0) return undefined
  const when = extractEventCondition(definition)
  const then = extractEventAction(definition)
  if (when === undefined || then === undefined) return undefined
  return Object.freeze({ name, when, then })
}

/** Parse every entry of an `ev` / `events` map into `EventDefinition` values. */
export function parseEvents(ev: Record<string, string>): EventDefinition[] {
  const out: EventDefinition[] = []
  for (const [name, def] of Object.entries(ev)) {
    const parsed = parseEvent(name, def)
    if (parsed !== undefined) out.push(parsed)
  }
  return out
}

// ---------------------------------------------------------------------------
// Access parsing
// ---------------------------------------------------------------------------

function extractAccessType(definition: string): AccessType | undefined {
  const m = ACCESS_TYPE_RE.exec(definition)
  if (!m) return undefined
  switch (m[1].toUpperCase()) {
    case 'JWT':
      return AccessType.JWT
    case 'RECORD':
      return AccessType.RECORD
    default:
      return undefined
  }
}

function extractSingleQuoted(re: RegExp, definition: string): string | undefined {
  const m = re.exec(definition)
  return m ? m[1] : undefined
}

/**
 * Parse a single `DEFINE ACCESS <name> ON DATABASE TYPE {JWT|RECORD} ...`
 * statement into an `AccessDefinition`. Returns `undefined` when the access
 * type cannot be determined.
 */
export function parseAccess(name: string, definition: string): AccessDefinition | undefined {
  if (!definition || definition.trim().length === 0) return undefined
  const type = extractAccessType(definition)
  if (type === undefined) return undefined

  const acc: Mutable<AccessDefinition> = { name, type }

  if (type === AccessType.JWT) {
    const algorithm = extractSingleQuoted(ALGORITHM_RE, definition) ?? 'HS256'
    const jwt: Mutable<JwtConfig> = { algorithm }
    const key = extractSingleQuoted(KEY_RE, definition)
    if (key !== undefined) jwt.key = key
    const url = extractSingleQuoted(URL_RE, definition)
    if (url !== undefined) jwt.url = url
    const issuer = extractSingleQuoted(ISSUER_RE, definition)
    if (issuer !== undefined) jwt.issuer = issuer
    acc.jwt = Object.freeze(jwt)
  } else if (type === AccessType.RECORD) {
    const rec: Mutable<RecordAccessConfig> = {}
    const signup = SIGNUP_RE.exec(definition)
    if (signup) rec.signup = signup[1].trim()
    const signin = SIGNIN_RE.exec(definition)
    if (signin) rec.signin = signin[1].trim()
    acc.record = Object.freeze(rec)
  }

  const session = SESSION_RE.exec(definition)
  if (session) acc.durationSession = session[1]
  const token = TOKEN_RE.exec(definition)
  if (token) acc.durationToken = token[1]

  return Object.freeze(acc)
}

// ---------------------------------------------------------------------------
// Table / DB glue
// ---------------------------------------------------------------------------

/**
 * Parse the `DEFINE TABLE` statement string into a `TableMode`.
 *
 * An empty input defaults to `TableMode.SCHEMALESS`, mirroring py/rs/go.
 */
export function parseTableMode(definition: string): TableMode {
  if (!definition) return TableMode.SCHEMALESS
  const upper = definition.toUpperCase()
  if (upper.includes('SCHEMAFULL')) return TableMode.SCHEMAFULL
  if (upper.includes('SCHEMALESS')) return TableMode.SCHEMALESS
  if (upper.includes('DROP')) return TableMode.DROP
  return TableMode.SCHEMALESS
}

/**
 * Parse a SurrealDB `INFO FOR TABLE` response into a `TableDefinition`.
 *
 * Accepts either short-key (`fd`, `ix`, `ev`) or long-key (`fields`,
 * `indexes`, `events`) shapes. When both are present the long-key map wins,
 * matching py/rs behaviour.
 *
 * @param tableName - name of the table (attached to the returned definition)
 * @param info - the raw `INFO FOR TABLE` response object
 * @throws {@link SchemaParseError} when `info` is not a plain object
 */
export function parseTableInfo(tableName: string, info: unknown): TableDefinition {
  if (!tableName || tableName.trim().length === 0) {
    throw new SchemaParseError('parseTableInfo: table name is required')
  }
  const obj = expectObject(info, `INFO FOR TABLE ${tableName}`)

  const mode = parseTableMode(stringAt(obj, 'tb'))

  const fieldsValue = pickMap(obj, ['fields', 'fd'])
  const fields = fieldsValue ? parseFields(valueToStringMap(fieldsValue)) : []

  const indexesValue = pickMap(obj, ['indexes', 'ix'])
  const indexes = indexesValue ? parseIndexes(valueToStringMap(indexesValue)) : []

  const eventsValue = pickMap(obj, ['events', 'ev'])
  const events = eventsValue ? parseEvents(valueToStringMap(eventsValue)) : []

  return Object.freeze({
    name: tableName,
    mode,
    fields,
    indexes,
    events,
  })
}

function isEdgeDefinition(source: string): boolean {
  return RELATION_RE.test(source)
}

function extractRelationEndpoints(definition: string): { from: string; to: string } | undefined {
  const m = RELATION_RE.exec(definition)
  if (!m) return undefined
  return { from: m[1], to: m[2] }
}

/**
 * Parse a SurrealDB `INFO FOR TABLE` response that represents a relation edge
 * into an `EdgeDefinition`.
 *
 * @throws {@link SchemaParseError} when `info` is not a plain object or the
 *   underlying `tb` statement is not a `TYPE RELATION ...` declaration.
 */
export function parseEdgeInfo(edgeName: string, info: unknown): EdgeDefinition {
  if (!edgeName || edgeName.trim().length === 0) {
    throw new SchemaParseError('parseEdgeInfo: edge name is required')
  }
  const obj = expectObject(info, `INFO FOR TABLE ${edgeName}`)

  const tb = stringAt(obj, 'tb')
  const endpoints = extractRelationEndpoints(tb)

  const fieldsValue = pickMap(obj, ['fields', 'fd'])
  const fields = fieldsValue ? parseFields(valueToStringMap(fieldsValue)) : []
  const indexesValue = pickMap(obj, ['indexes', 'ix'])
  const indexes = indexesValue ? parseIndexes(valueToStringMap(indexesValue)) : []
  const eventsValue = pickMap(obj, ['events', 'ev'])
  const events = eventsValue ? parseEvents(valueToStringMap(eventsValue)) : []

  const edge: Mutable<EdgeDefinition> = {
    name: edgeName,
    mode: EdgeMode.RELATION,
    fields,
    indexes,
    events,
  }
  if (endpoints) {
    edge.fromTable = endpoints.from
    edge.toTable = endpoints.to
  }

  return Object.freeze(edge)
}

/**
 * Parse a SurrealDB `INFO FOR DB` response into a `DatabaseInfo`.
 *
 * Tables declared with `TYPE RELATION FROM ... TO ...` are routed into
 * `edges`; every other table becomes a `TableDefinition` in `tables`.
 * Database-level access definitions land in `accesses`.
 *
 * @throws {@link SchemaParseError} when `info` is not a plain object
 */
export function parseDbInfo(info: unknown): DatabaseInfo {
  const obj = expectObject(info, 'INFO FOR DB')

  const tables: Record<string, TableDefinition> = {}
  const edges: Record<string, EdgeDefinition> = {}
  const accesses: Record<string, AccessDefinition> = {}

  const tb = pickMap(obj, ['tables', 'tb'])
  if (tb) {
    for (const [name, rawDef] of Object.entries(tb)) {
      if (typeof rawDef !== 'string') continue
      if (isEdgeDefinition(rawDef)) {
        const endpoints = extractRelationEndpoints(rawDef)
        const edge: Mutable<EdgeDefinition> = {
          name,
          mode: EdgeMode.RELATION,
          fields: [],
          indexes: [],
          events: [],
        }
        if (endpoints) {
          edge.fromTable = endpoints.from
          edge.toTable = endpoints.to
        }
        edges[name] = Object.freeze(edge)
      } else {
        const mode = parseTableMode(rawDef)
        const table: TableDefinition = {
          name,
          mode,
          fields: [],
          indexes: [],
          events: [],
        }
        tables[name] = Object.freeze(table)
      }
    }
  }

  const ac = pickMap(obj, ['accesses', 'ac'])
  if (ac) {
    for (const [name, rawDef] of Object.entries(ac)) {
      if (typeof rawDef !== 'string') continue
      const parsed = parseAccess(name, rawDef)
      if (parsed !== undefined) accesses[name] = parsed
    }
  }

  return Object.freeze({
    tables: Object.freeze(tables),
    edges: Object.freeze(edges),
    accesses: Object.freeze(accesses),
  })
}

// ---------------------------------------------------------------------------
// Live-database helpers (convenience)
// ---------------------------------------------------------------------------

/**
 * Fetch an `INFO FOR TABLE <name>` response from a live database and parse it
 * into a `TableDefinition`.
 */
export async function fetchTableInfo(db: Surreal, tableName: string): Promise<TableDefinition> {
  try {
    const results = await db.query<Record<string, unknown>[]>(`INFO FOR TABLE ${tableName}`)
    const raw = (results as unknown[])[0]
    return parseTableInfo(tableName, raw)
  } catch (e) {
    throw intoSurQlError(`Failed to fetch info for table ${tableName}:`, e)
  }
}

/**
 * Fetch an `INFO FOR DB` response from a live database and parse it into a
 * `DatabaseInfo`.
 */
export async function fetchDbInfo(db: Surreal): Promise<DatabaseInfo> {
  try {
    const results = await db.query<Record<string, unknown>[]>('INFO FOR DB')
    const raw = (results as unknown[])[0]
    return parseDbInfo(raw)
  } catch (e) {
    throw intoSurQlError('Failed to fetch database info:', e)
  }
}
