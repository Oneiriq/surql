import { assertEquals, assertRejects } from '@std/assert'
import { afterEach, beforeEach, describe, it } from '@std/testing/bdd'
import {
  compareSnapshots,
  createSnapshot,
  deserializeSnapshot,
  listSnapshots,
  loadSnapshot,
  serializeSnapshot,
  storeSnapshot,
} from '../migration/versioning.ts'
import { intField, stringField } from '../schema/fields.ts'
import { tableSchema, withFields } from '../schema/table.ts'
import { EdgeMode, edgeSchema, withEdgeFields } from '../schema/edge.ts'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await Deno.makeTempDir({ prefix: 'surql_test_' })
})

afterEach(async () => {
  try {
    await Deno.remove(tmpDir, { recursive: true })
  } catch {
    // cleanup best-effort
  }
})

describe('storeSnapshot and loadSnapshot', () => {
  it('should store and load a snapshot roundtrip', async () => {
    const tables = [
      withFields(tableSchema('users'), stringField('name'), intField('age')),
    ]
    const snapshot = createSnapshot('v1.0.0', tables, [])
    const path = `${tmpDir}/snapshot_v1.json`

    await storeSnapshot(snapshot, path)
    const loaded = await loadSnapshot(path)

    assertEquals(loaded.version, 'v1.0.0')
    assertEquals(loaded.tables.length, 1)
    assertEquals(loaded.tables[0].name, 'users')
    assertEquals(loaded.tables[0].fields.length, 2)
    assertEquals(loaded.edges.length, 0)
  })

  it('should preserve edge definitions in roundtrip', async () => {
    const tables = [tableSchema('person')]
    const edges = [
      withEdgeFields(
        edgeSchema('knows', EdgeMode.RELATION),
        stringField('since'),
      ),
    ]
    const snapshot = createSnapshot('v2.0.0', tables, edges)
    const path = `${tmpDir}/snapshot_v2.json`

    await storeSnapshot(snapshot, path)
    const loaded = await loadSnapshot(path)

    assertEquals(loaded.version, 'v2.0.0')
    assertEquals(loaded.tables.length, 1)
    assertEquals(loaded.edges.length, 1)
    assertEquals(loaded.edges[0].name, 'knows')
    assertEquals(loaded.edges[0].fields.length, 1)
  })

  it('should preserve timestamp through roundtrip', async () => {
    const snapshot = createSnapshot('v1', [], [])
    const path = `${tmpDir}/snapshot_ts.json`

    await storeSnapshot(snapshot, path)
    const loaded = await loadSnapshot(path)

    // Timestamps should be close (within 1 second)
    const diff = Math.abs(loaded.timestamp.getTime() - snapshot.timestamp.getTime())
    assertEquals(diff < 1000, true)
  })

  it('should fail to load non-existent file', async () => {
    await assertRejects(
      () => loadSnapshot(`${tmpDir}/nonexistent.json`),
      Error,
    )
  })

  it('should handle empty tables and edges', async () => {
    const snapshot = createSnapshot('v0', [], [])
    const path = `${tmpDir}/empty.json`

    await storeSnapshot(snapshot, path)
    const loaded = await loadSnapshot(path)

    assertEquals(loaded.version, 'v0')
    assertEquals(loaded.tables.length, 0)
    assertEquals(loaded.edges.length, 0)
  })

  it('should store valid JSON', async () => {
    const snapshot = createSnapshot('v1', [tableSchema('test')], [])
    const path = `${tmpDir}/valid.json`

    await storeSnapshot(snapshot, path)
    const raw = await Deno.readTextFile(path)
    const parsed = JSON.parse(raw)

    assertEquals(parsed.version, 'v1')
    assertEquals(Array.isArray(parsed.tables), true)
    assertEquals(Array.isArray(parsed.edges), true)
    assertEquals(typeof parsed.timestamp, 'string')
  })
})

describe('listSnapshots', () => {
  it('should list JSON files sorted alphabetically', async () => {
    await Deno.writeTextFile(`${tmpDir}/snapshot_003.json`, '{}')
    await Deno.writeTextFile(`${tmpDir}/snapshot_001.json`, '{}')
    await Deno.writeTextFile(`${tmpDir}/snapshot_002.json`, '{}')

    const files = await listSnapshots(tmpDir)
    assertEquals(files, ['snapshot_001.json', 'snapshot_002.json', 'snapshot_003.json'])
  })

  it('should ignore non-JSON files', async () => {
    await Deno.writeTextFile(`${tmpDir}/snapshot.json`, '{}')
    await Deno.writeTextFile(`${tmpDir}/readme.md`, 'hello')
    await Deno.writeTextFile(`${tmpDir}/data.txt`, 'data')

    const files = await listSnapshots(tmpDir)
    assertEquals(files, ['snapshot.json'])
  })

  it('should return empty array for empty directory', async () => {
    const files = await listSnapshots(tmpDir)
    assertEquals(files, [])
  })

  it('should ignore subdirectories', async () => {
    await Deno.mkdir(`${tmpDir}/subdir`)
    await Deno.writeTextFile(`${tmpDir}/snapshot.json`, '{}')

    const files = await listSnapshots(tmpDir)
    assertEquals(files, ['snapshot.json'])
  })

  it('should ignore directories ending in .json', async () => {
    await Deno.mkdir(`${tmpDir}/fake.json`)
    await Deno.writeTextFile(`${tmpDir}/real.json`, '{}')

    const files = await listSnapshots(tmpDir)
    assertEquals(files, ['real.json'])
  })
})

describe('serializeSnapshot and deserializeSnapshot', () => {
  it('should serialize to pretty-printed JSON', () => {
    const snapshot = createSnapshot('v1', [], [])
    const json = serializeSnapshot(snapshot)
    assertEquals(json.includes('\n'), true)
    assertEquals(json.includes('  '), true)
  })

  it('should deserialize from serialized output', () => {
    const tables = [withFields(tableSchema('users'), stringField('email'))]
    const original = createSnapshot('v3', tables, [])
    const json = serializeSnapshot(original)
    const restored = deserializeSnapshot(json)

    assertEquals(restored.version, 'v3')
    assertEquals(restored.tables[0].name, 'users')
    assertEquals(restored.tables[0].fields[0].name, 'email')
  })

  it('should produce frozen objects on deserialization', () => {
    const snapshot = createSnapshot('v1', [tableSchema('t')], [])
    const json = serializeSnapshot(snapshot)
    const restored = deserializeSnapshot(json)

    assertEquals(Object.isFrozen(restored), true)
    assertEquals(Object.isFrozen(restored.tables), true)
  })
})

describe('compareSnapshots', () => {
  it('should detect added tables', () => {
    const a = createSnapshot('v1', [tableSchema('users')], [])
    const b = createSnapshot('v2', [tableSchema('users'), tableSchema('posts')], [])
    const result = compareSnapshots(a, b)
    assertEquals(result.added, ['posts'])
    assertEquals(result.removed.length, 0)
    assertEquals(result.modified.length, 0)
  })

  it('should detect removed tables', () => {
    const a = createSnapshot('v1', [tableSchema('users'), tableSchema('posts')], [])
    const b = createSnapshot('v2', [tableSchema('users')], [])
    const result = compareSnapshots(a, b)
    assertEquals(result.added.length, 0)
    assertEquals(result.removed, ['posts'])
  })

  it('should detect modified tables', () => {
    const a = createSnapshot('v1', [withFields(tableSchema('users'), stringField('name'))], [])
    const b = createSnapshot('v2', [withFields(tableSchema('users'), stringField('name'), intField('age'))], [])
    const result = compareSnapshots(a, b)
    assertEquals(result.added.length, 0)
    assertEquals(result.removed.length, 0)
    assertEquals(result.modified, ['users'])
  })

  it('should handle identical snapshots', () => {
    const tables = [tableSchema('users')]
    const a = createSnapshot('v1', tables, [])
    const b = createSnapshot('v2', tables, [])
    const result = compareSnapshots(a, b)
    assertEquals(result.added.length, 0)
    assertEquals(result.removed.length, 0)
    assertEquals(result.modified.length, 0)
  })

  it('should handle empty snapshots', () => {
    const a = createSnapshot('v1', [], [])
    const b = createSnapshot('v2', [], [])
    const result = compareSnapshots(a, b)
    assertEquals(result.added.length, 0)
    assertEquals(result.removed.length, 0)
    assertEquals(result.modified.length, 0)
  })
})
