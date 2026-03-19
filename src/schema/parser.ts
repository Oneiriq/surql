import type { Surreal } from 'surrealdb'
import { intoSurQlError } from '../utils/surrealError.ts'

/**
 * Parsed table info from INFO FOR TABLE
 */
export interface ParsedTableInfo {
  readonly name: string
  readonly fields: Record<string, string>
  readonly indexes: Record<string, string>
  readonly events: Record<string, string>
  readonly lives: Record<string, string>
}

/**
 * Parsed database info from INFO FOR DB
 */
export interface ParsedDbInfo {
  readonly tables: Record<string, string>
  readonly accesses: Record<string, string>
  readonly analyzers: Record<string, string>
  readonly functions: Record<string, string>
  readonly params: Record<string, string>
}

/**
 * Parse INFO FOR TABLE response into a structured object
 */
export function parseTableInfo(raw: Record<string, unknown>): ParsedTableInfo {
  return {
    name: '',
    fields: (raw.fields ?? raw.fd ?? {}) as Record<string, string>,
    indexes: (raw.indexes ?? raw.ix ?? {}) as Record<string, string>,
    events: (raw.events ?? raw.ev ?? {}) as Record<string, string>,
    lives: (raw.lives ?? raw.lv ?? {}) as Record<string, string>,
  }
}

/**
 * Parse INFO FOR DB response into a structured object
 */
export function parseDbInfo(raw: Record<string, unknown>): ParsedDbInfo {
  return {
    tables: (raw.tables ?? raw.tb ?? {}) as Record<string, string>,
    accesses: (raw.accesses ?? raw.ac ?? {}) as Record<string, string>,
    analyzers: (raw.analyzers ?? raw.az ?? {}) as Record<string, string>,
    functions: (raw.functions ?? raw.fn ?? {}) as Record<string, string>,
    params: (raw.params ?? raw.pa ?? {}) as Record<string, string>,
  }
}

/**
 * Fetch and parse table info from a live database
 */
export async function fetchTableInfo(db: Surreal, tableName: string): Promise<ParsedTableInfo> {
  try {
    const results = await db.query<Record<string, unknown>[]>(`INFO FOR TABLE ${tableName}`)
    const raw = (results as unknown[])[0] as Record<string, unknown>
    const info = parseTableInfo(raw)
    return { ...info, name: tableName }
  } catch (e) {
    throw intoSurQlError(`Failed to fetch info for table ${tableName}:`, e)
  }
}

/**
 * Fetch and parse database info
 */
export async function fetchDbInfo(db: Surreal): Promise<ParsedDbInfo> {
  try {
    const results = await db.query<Record<string, unknown>[]>('INFO FOR DB')
    const raw = (results as unknown[])[0] as Record<string, unknown>
    return parseDbInfo(raw)
  } catch (e) {
    throw intoSurQlError('Failed to fetch database info:', e)
  }
}
