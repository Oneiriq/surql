import { assert, assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import {
  type BucketDefinition,
  bucketSchema,
  fileBucket,
  generateAlterBucketSql,
  generateBucketSql,
  generateRemoveBucketSql,
  memoryBucket,
} from '../schema/bucket.ts'
import { bytesField, FieldType, fileField } from '../schema/fields.ts'
import { fieldTypeToSql, generateSchemaSql, generateTableSql } from '../schema/sql.ts'
import { parseBucket, parseDbInfo } from '../schema/parser.ts'
import { diffBuckets } from '../migration/diff.ts'
import { DiffOperation } from '../migration/models.ts'
import { TableMode } from '../schema/table.ts'

describe('FieldType file/bytes', () => {
  it('exposes FILE and BYTES members', () => {
    assertEquals(FieldType.FILE, 'file')
    assertEquals(FieldType.BYTES, 'bytes')
  })

  it('fileField/bytesField build frozen definitions of the right type', () => {
    const f = fileField('avatar')
    const b = bytesField('blob')
    assertEquals(f.type, FieldType.FILE)
    assertEquals(b.type, FieldType.BYTES)
    assert(Object.isFrozen(f))
    assert(Object.isFrozen(b))
  })

  it('emits TYPE file / TYPE bytes', () => {
    assertEquals(fieldTypeToSql(fileField('avatar')), 'file')
    assertEquals(fieldTypeToSql(bytesField('blob')), 'bytes')
    assertEquals(fieldTypeToSql(fileField('avatar', { optional: true })), 'option<file>')
  })

  it('renders DEFINE FIELD ... TYPE file inside a table', () => {
    const sql = generateTableSql({
      name: 'doc',
      mode: TableMode.SCHEMAFULL,
      fields: [fileField('attachment'), bytesField('raw')],
      indexes: [],
      events: [],
    })
    assertStringIncludes(sql, 'DEFINE FIELD attachment ON TABLE doc TYPE file;')
    assertStringIncludes(sql, 'DEFINE FIELD raw ON TABLE doc TYPE bytes;')
  })
})

describe('bucket builders', () => {
  it('memoryBucket targets the memory backend, not readonly by default', () => {
    const b = memoryBucket('assets')
    assertEquals(b.name, 'assets')
    assertEquals(b.backend, 'memory')
    assertEquals(b.readonly, false)
    assert(Object.isFrozen(b))
  })

  it('fileBucket wraps a bare path as file:<path>', () => {
    assertEquals(fileBucket('local', '/var/data').backend, 'file:/var/data')
  })

  it('fileBucket leaves an existing file: URL untouched', () => {
    assertEquals(fileBucket('local', 'file:/var/data').backend, 'file:/var/data')
  })

  it('bucketSchema accepts an explicit backend and options', () => {
    const b = bucketSchema('remote', 's3://my-bucket/prefix', {
      readonly: true,
      comment: 'archive',
      permissions: { select: 'WHERE true' },
    })
    assertEquals(b.backend, 's3://my-bucket/prefix')
    assertEquals(b.readonly, true)
    assertEquals(b.comment, 'archive')
    assertEquals(b.permissions?.select, 'WHERE true')
  })
})

describe('generateBucketSql', () => {
  it('emits a minimal DEFINE BUCKET', () => {
    assertEquals(generateBucketSql(memoryBucket('assets')), 'DEFINE BUCKET assets BACKEND "memory";')
  })

  it('emits READONLY, PERMISSIONS and COMMENT clauses in order', () => {
    const sql = generateBucketSql(
      bucketSchema('assets', 'file:/data', {
        readonly: true,
        comment: 'static files',
        permissions: { select: 'WHERE true', create: 'WHERE $auth' },
      }),
    )
    assertEquals(
      sql,
      'DEFINE BUCKET assets BACKEND "file:/data" READONLY PERMISSIONS FOR select WHERE true FOR create WHERE $auth COMMENT "static files";',
    )
  })

  it('supports IF NOT EXISTS and OVERWRITE', () => {
    assertStringIncludes(generateBucketSql(memoryBucket('a'), { ifNotExists: true }), 'DEFINE BUCKET IF NOT EXISTS a')
    assertStringIncludes(generateBucketSql(memoryBucket('a'), { overwrite: true }), 'DEFINE BUCKET OVERWRITE a')
  })

  it('rejects IF NOT EXISTS combined with OVERWRITE', () => {
    assertThrows(() => generateBucketSql(memoryBucket('a'), { ifNotExists: true, overwrite: true }))
  })
})

describe('generateRemoveBucketSql', () => {
  it('emits REMOVE BUCKET and the IF EXISTS variant', () => {
    assertEquals(generateRemoveBucketSql('assets'), 'REMOVE BUCKET assets;')
    assertEquals(generateRemoveBucketSql('assets', { ifExists: true }), 'REMOVE BUCKET IF EXISTS assets;')
  })
})

describe('generateAlterBucketSql', () => {
  const base = memoryBucket('assets')

  it('returns undefined for equivalent definitions', () => {
    assertEquals(generateAlterBucketSql(base, memoryBucket('assets')), undefined)
  })

  it('emits READONLY when turned on and DROP READONLY when turned off', () => {
    const ro = bucketSchema('assets', 'memory', { readonly: true })
    assertEquals(generateAlterBucketSql(base, ro), 'ALTER BUCKET assets READONLY;')
    assertEquals(generateAlterBucketSql(ro, base), 'ALTER BUCKET assets DROP READONLY;')
  })

  it('emits BACKEND on change', () => {
    const moved = bucketSchema('assets', 'file:/data')
    assertEquals(generateAlterBucketSql(base, moved), 'ALTER BUCKET assets BACKEND "file:/data";')
  })

  it('emits COMMENT set and DROP COMMENT when cleared', () => {
    const commented = bucketSchema('assets', 'memory', { comment: 'hi' })
    assertEquals(generateAlterBucketSql(base, commented), 'ALTER BUCKET assets COMMENT "hi";')
    assertEquals(generateAlterBucketSql(commented, base), 'ALTER BUCKET assets DROP COMMENT;')
  })

  it('honours IF EXISTS', () => {
    const ro = bucketSchema('assets', 'memory', { readonly: true })
    assertStringIncludes(generateAlterBucketSql(base, ro, { ifExists: true }) ?? '', 'ALTER BUCKET IF EXISTS assets')
  })
})

describe('generateSchemaSql with buckets', () => {
  it('appends bucket DDL after tables', () => {
    const sql = generateSchemaSql({
      tables: [{ name: 't', mode: TableMode.SCHEMALESS, fields: [], indexes: [], events: [] }],
      buckets: [memoryBucket('assets')],
      ifNotExists: true,
    })
    assertStringIncludes(sql, 'DEFINE TABLE IF NOT EXISTS t')
    assertStringIncludes(sql, 'DEFINE BUCKET IF NOT EXISTS assets BACKEND "memory";')
  })
})

describe('parseBucket', () => {
  it('parses a minimal DEFINE BUCKET', () => {
    const b = parseBucket('assets', 'DEFINE BUCKET assets BACKEND "memory"')
    assert(b)
    assertEquals(b?.backend, 'memory')
    assertEquals(b?.readonly, false)
  })

  it('parses READONLY, COMMENT, and permissions', () => {
    const def = 'DEFINE BUCKET assets BACKEND "file:/data" READONLY PERMISSIONS FOR select WHERE true COMMENT "static"'
    const b = parseBucket('assets', def)
    assert(b)
    assertEquals(b?.backend, 'file:/data')
    assertEquals(b?.readonly, true)
    assertEquals(b?.comment, 'static')
    // The shared permission parser strips the WHERE keyword (matching the
    // table/edge permission round-trip convention), so the predicate is bare.
    assertEquals(b?.permissions?.select, 'true')
  })

  it('returns undefined without a BACKEND clause', () => {
    assertEquals(parseBucket('x', 'DEFINE BUCKET x'), undefined)
    assertEquals(parseBucket('x', ''), undefined)
  })

  it('round-trips generate -> parse', () => {
    const original = bucketSchema('assets', 'file:/data', { readonly: true, comment: 'c' })
    const parsed = parseBucket('assets', generateBucketSql(original))
    assert(parsed)
    assertEquals(parsed?.backend, original.backend)
    assertEquals(parsed?.readonly, original.readonly)
    assertEquals(parsed?.comment, original.comment)
  })
})

describe('parseDbInfo buckets', () => {
  it('routes the buckets map into DatabaseInfo.buckets', () => {
    const info = parseDbInfo({
      tables: {},
      accesses: {},
      buckets: { assets: 'DEFINE BUCKET assets BACKEND "memory"' },
    })
    assertEquals(Object.keys(info.buckets).length, 1)
    assertEquals(info.buckets.assets.backend, 'memory')
  })

  it('accepts the short `bu` key', () => {
    const info = parseDbInfo({ bu: { a: 'DEFINE BUCKET a BACKEND "memory" READONLY' } })
    assertEquals(info.buckets.a.readonly, true)
  })

  it('defaults to an empty bucket map', () => {
    assertEquals(Object.keys(parseDbInfo({}).buckets).length, 0)
  })
})

describe('diffBuckets', () => {
  const assets = memoryBucket('assets')

  it('adds a new bucket with full DEFINE BUCKET', () => {
    const diffs = diffBuckets([], [assets])
    assertEquals(diffs.length, 1)
    assertEquals(diffs[0].operation, DiffOperation.ADD_BUCKET)
    assertEquals(diffs[0].bucket, 'assets')
    assertStringIncludes(diffs[0].sql, 'DEFINE BUCKET assets BACKEND "memory";')
  })

  it('drops a removed bucket', () => {
    const diffs = diffBuckets([assets], [])
    assertEquals(diffs[0].operation, DiffOperation.DROP_BUCKET)
    assertEquals(diffs[0].sql, 'REMOVE BUCKET assets;')
  })

  it('emits MODIFY_BUCKET with ALTER for a changed attribute', () => {
    const ro = bucketSchema('assets', 'memory', { readonly: true })
    const diffs = diffBuckets([assets], [ro])
    assertEquals(diffs[0].operation, DiffOperation.MODIFY_BUCKET)
    assertStringIncludes(diffs[0].sql, 'ALTER BUCKET assets READONLY;')
  })

  it('produces no diff for unchanged buckets', () => {
    assertEquals(diffBuckets([assets], [memoryBucket('assets')]).length, 0)
  })
})

// Round-trip: a code-defined bucket emitted, reparsed from an INFO-shaped
// response, then diffed against the original reports no drift.
describe('bucket round-trip drift', () => {
  it('reports zero drift when DB matches code', () => {
    const code: BucketDefinition[] = [bucketSchema('assets', 'file:/data', { readonly: true, comment: 'c' })]
    const infoShape = { buckets: { assets: generateBucketSql(code[0]) } }
    const parsed = parseDbInfo(infoShape)
    const drift = diffBuckets(Object.values(parsed.buckets), code)
    assertEquals(drift, [])
  })
})
