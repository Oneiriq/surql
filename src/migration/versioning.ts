import type { TableDefinition } from '../schema/table.ts'
import type { EdgeDefinition } from '../schema/edge.ts'
import type { BucketDefinition } from '../schema/bucket.ts'

/**
 * Schema state snapshot.
 *
 * `buckets` is optional for backward compatibility: snapshots written before
 * bucket support omit the key, and {@link deserializeSnapshot} defaults it to
 * an empty array.
 */
export interface SchemaSnapshot {
  readonly version: string
  readonly timestamp: Date
  readonly tables: readonly TableDefinition[]
  readonly edges: readonly EdgeDefinition[]
  readonly buckets: readonly BucketDefinition[]
}

/**
 * Create a schema snapshot from current definitions
 */
export function createSnapshot(
  version: string,
  tables: TableDefinition[],
  edges: EdgeDefinition[],
  buckets: BucketDefinition[] = [],
): SchemaSnapshot {
  return Object.freeze({
    version,
    timestamp: new Date(),
    tables: Object.freeze([...tables]),
    edges: Object.freeze([...edges]),
    buckets: Object.freeze([...buckets]),
  })
}

/**
 * Store a snapshot as a JSON string
 */
export function serializeSnapshot(snapshot: SchemaSnapshot): string {
  return JSON.stringify(
    {
      version: snapshot.version,
      timestamp: snapshot.timestamp.toISOString(),
      tables: snapshot.tables,
      edges: snapshot.edges,
      buckets: snapshot.buckets,
    },
    null,
    2,
  )
}

/**
 * Load a snapshot from a JSON string
 */
export function deserializeSnapshot(json: string): SchemaSnapshot {
  const data = JSON.parse(json)
  const buckets = Array.isArray(data.buckets) ? data.buckets : []
  return Object.freeze({
    version: data.version,
    timestamp: new Date(data.timestamp),
    tables: Object.freeze(data.tables.map((t: TableDefinition) => Object.freeze(t))),
    edges: Object.freeze(data.edges.map((e: EdgeDefinition) => Object.freeze(e))),
    buckets: Object.freeze(buckets.map((b: BucketDefinition) => Object.freeze(b))),
  })
}

/**
 * Compare two snapshots and return table names that differ
 */
/**
 * Store a snapshot to a file
 */
export async function storeSnapshot(snapshot: SchemaSnapshot, path: string): Promise<void> {
  const json = serializeSnapshot(snapshot)
  await Deno.writeTextFile(path, json)
}

/**
 * Load a snapshot from a file
 */
export async function loadSnapshot(path: string): Promise<SchemaSnapshot> {
  const json = await Deno.readTextFile(path)
  return deserializeSnapshot(json)
}

/**
 * List snapshot files in a directory
 */
export async function listSnapshots(directory: string): Promise<string[]> {
  const files: string[] = []
  for await (const entry of Deno.readDir(directory)) {
    if (entry.isFile && entry.name.endsWith('.json')) {
      files.push(entry.name)
    }
  }
  return files.sort()
}

export function compareSnapshots(a: SchemaSnapshot, b: SchemaSnapshot): {
  added: string[]
  removed: string[]
  modified: string[]
} {
  const aTables = new Map(a.tables.map((t) => [t.name, t]))
  const bTables = new Map(b.tables.map((t) => [t.name, t]))

  const added = [...bTables.keys()].filter((name) => !aTables.has(name))
  const removed = [...aTables.keys()].filter((name) => !bTables.has(name))
  const modified: string[] = []

  for (const [name, bTable] of bTables) {
    const aTable = aTables.get(name)
    if (!aTable) continue
    if (JSON.stringify(aTable) !== JSON.stringify(bTable)) {
      modified.push(name)
    }
  }

  return { added, removed, modified }
}
