/**
 * Database schema parser.
 *
 * Parses SurrealDB `INFO FOR DB` / `INFO FOR TABLE` responses back into
 * structured `TableDefinition`, `EdgeDefinition`, `FieldDefinition`,
 * `IndexDefinition`, `EventDefinition`, and `AccessDefinition` values.
 *
 * ## Round-trip symmetry
 *
 * The parser is the inverse of the schema emitter (`generateTableSql` /
 * the migration differ). After a migration is applied, SurrealDB v3 reformats
 * the stored `DEFINE` statements before returning them via `INFO FOR TABLE`:
 *
 * - `TYPE option<X>` is unfolded to `TYPE none | X`.
 * - `array<E>` keeps its element type but also gains a companion
 *   `<field>[*]` / `<field>.*` entry holding the element-type spec.
 * - every field gains a `PERMISSIONS FULL` default clause.
 * - the table-level `DEFINE TABLE` statement is NOT included in
 *   `INFO FOR TABLE` at all — only `INFO FOR DB`'s `tables.<name>` carries it.
 *
 * The parser normalises these back into the same definition shape the emitter
 * started from, so a `diffTables(parsedFromDb, codeTables)` returns no spurious
 * drift when the database and code schemas actually match.
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
import type { EventDefinition, IndexDefinition, TableDefinition, TablePermissions } from './table.ts'
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

/** Top-level clause keywords of a `DEFINE FIELD` statement. */
const FIELD_CLAUSE_KEYWORDS = [
  'TYPE',
  'ASSERT',
  'DEFAULT',
  'VALUE',
  'READONLY',
  'FLEXIBLE',
  'PERMISSIONS',
  'COMMENT',
] as const

/** Matches (and measures) the `DEFINE FIELD <name> ON [TABLE] <table>` prefix. */
const DEFINE_FIELD_PREFIX_RE = /^\s*DEFINE\s+FIELD\s+\S+\s+ON\s+(?:TABLE\s+)?\S+\s*/i
/** `option<Inner>` — captures the inner type expression. */
const OPTION_TYPE_RE = /^option\s*<\s*([\s\S]+?)\s*>\s*$/i
/** `record<Target>` — captures the target table name. */
const RECORD_TYPE_RE = /^record\s*<\s*([A-Za-z_][A-Za-z0-9_]*)/i
/** `array<Element>` — captures the leading element-type word. */
const ARRAY_TYPE_RE = /^array\s*<\s*([A-Za-z_][A-Za-z0-9_]*)/i
/** Leading bare identifier of a type expression. */
const TYPE_WORD_RE = /^([A-Za-z_][A-Za-z0-9_]*)/
/**
 * Trailing `[*]` / `.*` of a SurrealDB array sub-field entry name. SurrealDB v3
 * reports an array field's per-element type spec as a separate `<field>[*]` /
 * `<field>.*` entry; those are part of the parent array, not standalone fields.
 */
const ARRAY_SUBFIELD_RE = /(?:\[\*\]|\.\*)\s*$/

const COLUMNS_RE = /COLUMNS\s+([^;]+?)(?:UNIQUE|FULLTEXT|SEARCH|HNSW|MTREE|\s*;|\s*$)/i
const FIELDS_RE = /FIELDS\s+([^;]+?)(?:UNIQUE|FULLTEXT|SEARCH|HNSW|MTREE|\s*;|\s*$)/i
const ANALYZER_RE = /ANALYZER\s+(\w+)/i
const DIMENSION_RE = /DIMENSION\s+(\d+)/i
const DISTANCE_RE = /(?:DIST|DISTANCE)\s+(\w+)/i
const EFC_RE = /EFC\s+(\d+)/i
const M_RE = /\bM\s+(\d+)/i
const WHEN_RE = /WHEN\s+([\s\S]+?)\s+THEN/i
const THEN_BRACE_RE = /THEN\s+\{([\s\S]+?)\}(?:\s*;|\s*$)/i
const THEN_BARE_RE = /THEN\s+([\s\S]+?)(?:\s*;|\s*$)/i
/** `TYPE RELATION` keyword anywhere in a `DEFINE TABLE` string. */
const TYPE_RELATION_RE = /\bTYPE\s+RELATION\b/i
/** `FROM <ident>` clause in a `DEFINE TABLE` string, independent of `TO`. */
const EDGE_FROM_RE = /\bFROM\s+([A-Za-z_][A-Za-z0-9_]*)/i
/** `TO <ident>` clause in a `DEFINE TABLE` string, independent of `FROM`. */
const EDGE_TO_RE = /\bTO\s+([A-Za-z_][A-Za-z0-9_]*)/i
const ALGORITHM_RE = /ALGORITHM\s+(\w+)/i
const KEY_RE = /KEY\s+'([^']*)'/i
const URL_RE = /URL\s+'([^']*)'/i
const ISSUER_RE = /WITH\s+ISSUER\s+'([^']*)'/i
const SIGNUP_RE = /SIGNUP\s+\(([\s\S]+?)\)(?:\s+SIGNIN|\s+DURATION|\s*;|\s*$)/i
const SIGNIN_RE = /SIGNIN\s+\(([\s\S]+?)\)(?:\s+SIGNUP|\s+DURATION|\s*;|\s*$)/i
const SESSION_RE = /FOR\s+SESSION\s+(\w+)/i
const TOKEN_RE = /FOR\s+TOKEN\s+(\w+)/i
const ACCESS_TYPE_RE = /TYPE\s+(JWT|RECORD)/i
/** A table-level `PERMISSIONS` clause body, up to a trailing `;` / end. */
const TABLE_PERMISSIONS_RE = /\bPERMISSIONS\b([\s\S]*?)(?:\s*;\s*$|\s*$)/i
/** One `FOR <action-list> WHERE <rule>` permission clause. */
const PERMISSION_CLAUSE_RE =
  /\bFOR\s+((?:select|create|update|delete)(?:\s*,\s*(?:select|create|update|delete))*)\s+WHERE\s+([\s\S]*?)(?=\s+FOR\s+(?:select|create|update|delete)\b|\s*;|\s*$)/gi

/** Is this byte/char part of an identifier? */
function isIdent(ch: string): boolean {
  return IDENT_RE.test(ch)
}

/**
 * Locate the case-insensitive keyword `kw` in `text`, honouring word
 * boundaries. When `requireWhitespaceLeft` is true, the keyword must sit at
 * position 0 or follow ASCII whitespace — this prevents a `$value` identifier
 * from being mistaken for the literal `VALUE` clause keyword.
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

/** Map a bare SurrealDB type word to a `FieldType`. */
function fieldTypeFromWord(word: string): FieldType {
  switch (word.toLowerCase()) {
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

/** The structured result of parsing a `TYPE` clause body. */
interface ParsedFieldType {
  readonly type: FieldType
  readonly recordLink?: string
  readonly arrayType?: FieldType
  readonly optional: boolean
}

/**
 * Parse the body of a `TYPE` clause into a structured field type.
 *
 * Recognises the shapes the emitter writes AND the shapes SurrealDB v3 returns
 * after storing them:
 *
 * - `string` → `{ STRING }`
 * - `option<string>` / `none | string` → `{ STRING, optional }`
 * - `record<user>` → `{ RECORD, recordLink: 'user' }`
 * - `option<record<user>>` / `none | record<user>` → `{ RECORD, recordLink, optional }`
 * - `array<int>` → `{ ARRAY, arrayType: INT }`
 * - empty / unknown → `{ ANY }`
 */
function parseFieldType(typeBody: string): ParsedFieldType {
  if (!typeBody || typeBody.trim().length === 0) return { type: FieldType.ANY, optional: false }

  let str = typeBody.trim()
  let optional = false

  // `option<X>` → X, optional.
  const optionMatch = OPTION_TYPE_RE.exec(str)
  if (optionMatch) {
    optional = true
    str = optionMatch[1].trim()
  }

  // `none | X` (the form v3 stores `option<X>` as) → X, optional. A union with
  // more than one non-`none` branch is not representable, so fall back to ANY.
  const unionParts = str.split('|').map((p) => p.trim()).filter((p) => p.length > 0)
  if (unionParts.some((p) => p.toLowerCase() === 'none')) {
    optional = true
    const nonNone = unionParts.filter((p) => p.toLowerCase() !== 'none')
    if (nonNone.length === 1) {
      str = nonNone[0]
    } else if (nonNone.length > 1) {
      return { type: FieldType.ANY, optional }
    }
  }

  // `record<target>`.
  const recordMatch = RECORD_TYPE_RE.exec(str)
  if (recordMatch) {
    return { type: FieldType.RECORD, recordLink: recordMatch[1], optional }
  }

  // `array<element>`.
  const arrayMatch = ARRAY_TYPE_RE.exec(str)
  if (arrayMatch) {
    return { type: FieldType.ARRAY, arrayType: fieldTypeFromWord(arrayMatch[1]), optional }
  }

  // Bare type word.
  const wordMatch = TYPE_WORD_RE.exec(str)
  if (!wordMatch) return { type: FieldType.ANY, optional }
  return { type: fieldTypeFromWord(wordMatch[1]), optional }
}

/**
 * Split a `DEFINE FIELD` statement into its clause bodies, keyed by the
 * upper-cased clause keyword.
 *
 * The `DEFINE FIELD <name> ON [TABLE] <table>` prefix is skipped before
 * scanning, so a field whose NAME collides with a clause keyword (`default`,
 * `comment`, ...) does not corrupt the parse. Flag clauses (`READONLY`,
 * `FLEXIBLE`) appear as keys with an empty-string body.
 */
function splitFieldClauses(definition: string): Record<string, string> {
  const prefixMatch = DEFINE_FIELD_PREFIX_RE.exec(definition)
  const body = prefixMatch ? definition.slice(prefixMatch[0].length) : definition

  const anchors: { keyword: string; start: number }[] = []
  for (const keyword of FIELD_CLAUSE_KEYWORDS) {
    const start = findKeyword(body, keyword, true)
    if (start >= 0) anchors.push({ keyword, start })
  }
  anchors.sort((a, b) => a.start - b.start)

  const clauses: Record<string, string> = {}
  for (let i = 0; i < anchors.length; i += 1) {
    const { keyword, start } = anchors[i]
    const bodyStart = start + keyword.length
    const bodyEnd = i + 1 < anchors.length ? anchors[i + 1].start : body.length
    let clauseBody = body.slice(bodyStart, bodyEnd).trim()
    if (clauseBody.endsWith(';')) clauseBody = clauseBody.slice(0, -1).trimEnd()
    clauses[keyword] = clauseBody
  }
  return clauses
}

/**
 * Parse a single `DEFINE FIELD <name> ON ...` statement into a
 * `FieldDefinition`. Returns `undefined` when the definition string is empty.
 */
export function parseField(name: string, definition: string): FieldDefinition | undefined {
  if (!definition || definition.trim().length === 0) return undefined

  const clauses = splitFieldClauses(definition)
  const parsedType = parseFieldType(clauses.TYPE ?? '')

  const base: Mutable<FieldDefinition> = { name, type: parsedType.type }
  if (parsedType.recordLink !== undefined) base.recordLink = parsedType.recordLink
  if (parsedType.arrayType !== undefined) base.arrayType = parsedType.arrayType
  if (parsedType.optional) base.optional = true
  if (clauses.ASSERT) base.assertion = clauses.ASSERT
  if (clauses.DEFAULT) base.defaultValue = clauses.DEFAULT
  if (clauses.VALUE) base.value = clauses.VALUE
  if ('READONLY' in clauses) base.readonly = true
  if ('FLEXIBLE' in clauses) base.flexible = true

  return Object.freeze(base) as FieldDefinition
}

/**
 * Parse every entry of a `fd` / `fields` map into `FieldDefinition` values.
 *
 * SurrealDB v3 array sub-field entries (`<field>[*]` / `<field>.*`) are skipped
 * — they are the parent array's element-type spec, not standalone fields, and
 * the differ must not see them as orphan columns.
 */
export function parseFields(fd: Record<string, string>): FieldDefinition[] {
  const out: FieldDefinition[] = []
  for (const [name, def] of Object.entries(fd)) {
    if (ARRAY_SUBFIELD_RE.test(name)) continue
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
  // SurrealDB 3.x renamed the full-text keyword `SEARCH` → `FULLTEXT`; accept
  // both spellings so live definitions from either server version round-trip.
  if (upper.includes('FULLTEXT') || upper.includes('SEARCH')) return IndexType.SEARCH
  if (upper.includes('HNSW')) return IndexType.HNSW
  if (upper.includes('MTREE')) return IndexType.MTREE
  return IndexType.STANDARD
}

/**
 * Extract the full-text `ANALYZER <name>`. The historical `ascii` default (what
 * a plain `searchIndex` renders) normalises back to `undefined`, so a round-trip
 * of the default form is an identity, leaving an explicit non-`ascii` analyzer
 * as a populated string.
 */
function extractAnalyzer(definition: string): string | undefined {
  const m = ANALYZER_RE.exec(definition)
  if (!m) return undefined
  const name = m[1]
  return name.toLowerCase() === 'ascii' ? undefined : name
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

  if (type === IndexType.SEARCH) {
    const analyzer = extractAnalyzer(definition)
    if (analyzer !== undefined) base.searchAnalyzer = analyzer
    const upper = definition.toUpperCase()
    if (upper.includes('BM25')) base.bm25 = true
    if (upper.includes('HIGHLIGHTS')) base.highlights = true
  } else if (type === IndexType.MTREE) {
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
 * An empty input defaults to `TableMode.SCHEMALESS`.
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
 * Extract the table-level `PERMISSIONS` clause from a `DEFINE TABLE` statement.
 *
 * - `PERMISSIONS NONE` / `PERMISSIONS FULL` → `undefined`. Those are the
 *   trivial default-deny / default-allow postures a table reports when no
 *   per-action rules were declared; the code-side helper has no representation
 *   for them either, so returning `undefined` matches.
 * - `PERMISSIONS FOR select WHERE <r1> FOR create WHERE <r2> ...` (expanded
 *   form) → `{ select: '<r1>', create: '<r2>', ... }`.
 * - `PERMISSIONS FOR select, create, update, delete WHERE <rule>` (compact
 *   comma form — what SurrealDB v3 emits when several actions share a rule) →
 *   the rule exploded across every named action.
 *
 * Returns `undefined` when no `PERMISSIONS` clause is present.
 */
export function parseTablePermissions(definition: string): TablePermissions | undefined {
  if (!definition) return undefined

  const permMatch = TABLE_PERMISSIONS_RE.exec(definition)
  if (!permMatch) return undefined

  const body = permMatch[1].trim()
  if (body.length === 0) return undefined
  if (body.toUpperCase() === 'NONE' || body.toUpperCase() === 'FULL') return undefined

  const rules: Mutable<TablePermissions> = {}
  PERMISSION_CLAUSE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = PERMISSION_CLAUSE_RE.exec(body)) !== null) {
    const rule = m[2].trim()
    for (const raw of m[1].split(',')) {
      const action = raw.trim().toLowerCase()
      if (action === 'select' || action === 'create' || action === 'update' || action === 'delete') {
        rules[action] = rule
      }
    }
  }

  return Object.keys(rules).length > 0 ? Object.freeze(rules) : undefined
}

/**
 * Parse a SurrealDB `INFO FOR TABLE` response into a `TableDefinition`.
 *
 * Accepts either short-key (`fd`, `ix`, `ev`) or long-key (`fields`,
 * `indexes`, `events`) shapes.
 *
 * SurrealDB v3's `INFO FOR TABLE` does NOT include the table-level
 * `DEFINE TABLE` statement, so table mode and `PERMISSIONS` cannot be
 * recovered from it alone. Pass `defineTable` — the `DEFINE TABLE <name> ...`
 * string from `INFO FOR DB`'s `tables.<name>` entry — to recover them; without
 * it, the mode defaults to `SCHEMALESS` and permissions are dropped.
 *
 * @param tableName - name of the table (attached to the returned definition)
 * @param info - the raw `INFO FOR TABLE` response object
 * @param defineTable - optional `DEFINE TABLE` statement, sourced from `INFO FOR DB`
 * @throws {@link SchemaParseError} when `info` is not a plain object
 */
export function parseTableInfo(tableName: string, info: unknown, defineTable?: string): TableDefinition {
  if (!tableName || tableName.trim().length === 0) {
    throw new SchemaParseError('parseTableInfo: table name is required')
  }
  const obj = expectObject(info, `INFO FOR TABLE ${tableName}`)

  // The caller-supplied DEFINE TABLE wins; fall back to the legacy `tb` key
  // inside the INFO FOR TABLE response (SurrealDB v1/v2 shape).
  const tbSource = defineTable !== undefined ? defineTable : stringAt(obj, 'tb')
  const mode = parseTableMode(tbSource)
  const permissions = parseTablePermissions(tbSource)

  const fieldsValue = pickMap(obj, ['fields', 'fd'])
  const fields = fieldsValue ? parseFields(valueToStringMap(fieldsValue)) : []

  const indexesValue = pickMap(obj, ['indexes', 'ix'])
  const indexes = indexesValue ? parseIndexes(valueToStringMap(indexesValue)) : []

  const eventsValue = pickMap(obj, ['events', 'ev'])
  const events = eventsValue ? parseEvents(valueToStringMap(eventsValue)) : []

  const table: Mutable<TableDefinition> = {
    name: tableName,
    mode,
    fields,
    indexes,
    events,
  }
  if (permissions !== undefined) table.permissions = permissions

  return Object.freeze(table)
}

function isEdgeDefinition(source: string): boolean {
  return TYPE_RELATION_RE.test(source)
}

/**
 * Parse the edge mode encoded in a `DEFINE TABLE` statement string.
 *
 * Recognises the three shapes the emitter writes:
 * - `TYPE RELATION ...` → {@link EdgeMode.RELATION}
 * - `SCHEMAFULL` → {@link EdgeMode.SCHEMAFULL}
 * - anything else (including empty / `SCHEMALESS`) → {@link EdgeMode.SCHEMALESS}
 *
 * `TYPE RELATION` wins over `SCHEMAFULL` / `SCHEMALESS` because SurrealDB v3
 * allows `DEFINE TABLE <name> TYPE RELATION SCHEMAFULL ...` and the edge mode
 * is what matters for downstream diffing.
 */
function parseEdgeMode(definition: string): EdgeMode {
  if (!definition) return EdgeMode.SCHEMALESS
  if (TYPE_RELATION_RE.test(definition)) return EdgeMode.RELATION
  const upper = definition.toUpperCase()
  if (upper.includes('SCHEMAFULL')) return EdgeMode.SCHEMAFULL
  return EdgeMode.SCHEMALESS
}

/**
 * Extract `FROM <table>` and `TO <table>` from a `DEFINE TABLE` string without
 * requiring them to appear together. SurrealDB v3 emits `RELATION FROM x TO y`
 * for typed edges, but the parser stays permissive on read: a malformed live
 * definition that lost one clause surfaces as missing-endpoint drift instead
 * of a parse failure.
 */
function extractEdgeEndpoints(definition: string): { from?: string; to?: string } {
  if (!definition) return {}
  const out: { from?: string; to?: string } = {}
  const fromMatch = EDGE_FROM_RE.exec(definition)
  if (fromMatch) out.from = fromMatch[1]
  const toMatch = EDGE_TO_RE.exec(definition)
  if (toMatch) out.to = toMatch[1]
  return out
}

/**
 * Parse a SurrealDB `INFO FOR TABLE` response that represents a graph edge
 * into an `EdgeDefinition`. Counterpart to {@link parseTableInfo} for graph-edge
 * tables defined via `edgeSchema` / {@link EdgeDefinition}.
 *
 * Edges round-trip through SurrealDB as regular tables in `INFO FOR DB.tables`;
 * the only thing that makes them edges is the `TYPE RELATION FROM <x> TO <y>`
 * clause on the `DEFINE TABLE` statement. Without an edge-aware parser, a
 * drift detector using {@link parseTableInfo} against an edge table would see
 * it as a SCHEMALESS table missing every field-level diff signal an edge
 * expects (mode, from/to constraints, auto `in`/`out` proxies).
 *
 * For `RELATION`-mode edges the auto-emitted `in` and `out` fields SurrealDB
 * stores are skipped — they are implicit when `TYPE RELATION` is set, so the
 * code-side `EdgeDefinition` does not declare them either.
 *
 * As with {@link parseTableInfo}, pass `defineTable` — the
 * `DEFINE TABLE <name> ...` string from `INFO FOR DB` — so the mode,
 * `FROM`/`TO` endpoints, and `PERMISSIONS` can be recovered on SurrealDB v3
 * (which omits the table-level `DEFINE` from `INFO FOR TABLE`).
 *
 * @param edgeName - edge table name (attached to the returned definition)
 * @param info - raw `INFO FOR TABLE` response object
 * @param defineTable - optional `DEFINE TABLE` statement, sourced from `INFO FOR DB`
 * @throws {@link SchemaParseError} when `info` is not a plain object
 */
export function parseEdgeInfo(edgeName: string, info: unknown, defineTable?: string): EdgeDefinition {
  if (!edgeName || edgeName.trim().length === 0) {
    throw new SchemaParseError('parseEdgeInfo: edge name is required')
  }
  const obj = expectObject(info, `INFO FOR TABLE ${edgeName}`)

  const tb = defineTable !== undefined ? defineTable : stringAt(obj, 'tb')
  const mode = parseEdgeMode(tb)
  const endpoints = extractEdgeEndpoints(tb)

  const fieldsValue = pickMap(obj, ['fields', 'fd'])
  let fields = fieldsValue ? parseFields(valueToStringMap(fieldsValue)) : []
  // SurrealDB auto-emits `in` and `out` fields for TYPE RELATION edges. They
  // are implicit when `TYPE RELATION` is set, so the code-side EdgeDefinition
  // does not declare them. Strip them on read so round-trip diffs do not flag
  // them as orphan additions.
  if (mode === EdgeMode.RELATION) {
    fields = fields.filter((f) => f.name !== 'in' && f.name !== 'out')
  }

  const indexesValue = pickMap(obj, ['indexes', 'ix'])
  const indexes = indexesValue ? parseIndexes(valueToStringMap(indexesValue)) : []
  const eventsValue = pickMap(obj, ['events', 'ev'])
  const events = eventsValue ? parseEvents(valueToStringMap(eventsValue)) : []

  const edge: Mutable<EdgeDefinition> = {
    name: edgeName,
    mode,
    fields,
    indexes,
    events,
  }
  if (endpoints.from !== undefined) edge.fromTable = endpoints.from
  if (endpoints.to !== undefined) edge.toTable = endpoints.to
  const permissions = parseTablePermissions(tb)
  if (permissions !== undefined) edge.permissions = permissions

  return Object.freeze(edge)
}

/**
 * Parse a SurrealDB `INFO FOR DB` response into a `DatabaseInfo`.
 *
 * Tables declared with `TYPE RELATION FROM ... TO ...` are routed into
 * `edges`; every other table becomes a `TableDefinition` in `tables`.
 * Database-level access definitions land in `accesses`.
 *
 * Each table's `DEFINE TABLE` statement carries the mode and `PERMISSIONS`,
 * which are parsed here. Fields, indexes, and events still require a per-table
 * `INFO FOR TABLE` lookup (see {@link parseTableInfo}).
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
        const endpoints = extractEdgeEndpoints(rawDef)
        const edge: Mutable<EdgeDefinition> = {
          name,
          mode: parseEdgeMode(rawDef),
          fields: [],
          indexes: [],
          events: [],
        }
        if (endpoints.from !== undefined) edge.fromTable = endpoints.from
        if (endpoints.to !== undefined) edge.toTable = endpoints.to
        const edgePermissions = parseTablePermissions(rawDef)
        if (edgePermissions !== undefined) edge.permissions = edgePermissions
        edges[name] = Object.freeze(edge)
      } else {
        const table: Mutable<TableDefinition> = {
          name,
          mode: parseTableMode(rawDef),
          fields: [],
          indexes: [],
          events: [],
        }
        const permissions = parseTablePermissions(rawDef)
        if (permissions !== undefined) table.permissions = permissions
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

/** Look up a table's `DEFINE TABLE` statement in an `INFO FOR DB` response. */
function defineTableFromDbInfo(dbInfo: unknown, tableName: string): string | undefined {
  if (!isPlainObject(dbInfo)) return undefined
  const tb = pickMap(dbInfo, ['tables', 'tb'])
  const def = tb?.[tableName]
  return typeof def === 'string' ? def : undefined
}

/**
 * Fetch an `INFO FOR TABLE <name>` response from a live database and parse it
 * into a `TableDefinition`.
 *
 * Also issues an `INFO FOR DB` query to recover the table-level `DEFINE TABLE`
 * statement (mode + `PERMISSIONS`), which SurrealDB v3 omits from
 * `INFO FOR TABLE`. If that second query fails the table info is still parsed,
 * just without table-level mode/permissions.
 */
export async function fetchTableInfo(db: Surreal, tableName: string): Promise<TableDefinition> {
  try {
    const results = await db.query<Record<string, unknown>[]>(`INFO FOR TABLE ${tableName}`)
    const raw = (results as unknown[])[0]

    let defineTable: string | undefined
    try {
      const dbResults = await db.query<Record<string, unknown>[]>('INFO FOR DB')
      defineTable = defineTableFromDbInfo((dbResults as unknown[])[0], tableName)
    } catch {
      // INFO FOR DB is best-effort here — fall back to INFO FOR TABLE alone.
      defineTable = undefined
    }

    return parseTableInfo(tableName, raw, defineTable)
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
