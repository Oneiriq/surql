import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import {
  fetchDbInfo,
  fetchTableInfo,
  parseAccess,
  parseDbInfo,
  parseEdgeInfo,
  parseEvent,
  parseEvents,
  parseField,
  parseFields,
  parseIndex,
  parseIndexes,
  parseTableInfo,
  parseTableMode,
  parseTablePermissions,
  SchemaParseError,
} from '../schema/parser.ts'
import { AccessType } from '../schema/access.ts'
import { EdgeMode } from '../schema/edge.ts'
import { FieldType } from '../schema/fields.ts'
import {
  HnswDistanceType,
  hnswIndex,
  IndexType,
  MTreeDistanceType,
  mtreeIndex,
  MTreeVectorType,
  searchIndex,
  TableMode,
  tableSchema,
  uniqueIndex,
  withFields,
  withIndexes,
} from '../schema/table.ts'
import { arrayField, datetimeField, intField, recordField, stringField } from '../schema/fields.ts'
import { generateTableSql } from '../schema/sql.ts'
import { diffTables } from '../migration/diff.ts'

// ---------------------------------------------------------------------------
// parseTableMode
// ---------------------------------------------------------------------------

describe('parseTableMode', () => {
  it('returns SCHEMALESS for empty input', () => {
    assertEquals(parseTableMode(''), TableMode.SCHEMALESS)
  })

  it('detects SCHEMAFULL', () => {
    assertEquals(parseTableMode('DEFINE TABLE user SCHEMAFULL'), TableMode.SCHEMAFULL)
  })

  it('detects SCHEMALESS', () => {
    assertEquals(parseTableMode('DEFINE TABLE user SCHEMALESS'), TableMode.SCHEMALESS)
  })

  it('detects DROP', () => {
    assertEquals(parseTableMode('DEFINE TABLE tmp DROP'), TableMode.DROP)
  })

  it('is case insensitive', () => {
    assertEquals(parseTableMode('define table user schemafull'), TableMode.SCHEMAFULL)
  })
})

// ---------------------------------------------------------------------------
// parseField
// ---------------------------------------------------------------------------

describe('parseField', () => {
  it('returns undefined for empty definition', () => {
    assertEquals(parseField('x', ''), undefined)
    assertEquals(parseField('x', '   '), undefined)
  })

  it('parses basic string field', () => {
    const f = parseField('email', 'DEFINE FIELD email ON TABLE user TYPE string')!
    assertEquals(f.name, 'email')
    assertEquals(f.type, FieldType.STRING)
    assertEquals(f.assertion, undefined)
    assertEquals(f.readonly, undefined)
  })

  it('maps every known type keyword', () => {
    const cases: Array<[string, FieldType]> = [
      ['string', FieldType.STRING],
      ['int', FieldType.INT],
      ['float', FieldType.FLOAT],
      ['bool', FieldType.BOOL],
      ['datetime', FieldType.DATETIME],
      ['duration', FieldType.DURATION],
      ['decimal', FieldType.DECIMAL],
      ['number', FieldType.NUMBER],
      ['object', FieldType.OBJECT],
      ['array', FieldType.ARRAY],
      ['record', FieldType.RECORD],
      ['geometry', FieldType.GEOMETRY],
      ['any', FieldType.ANY],
    ]
    for (const [kw, want] of cases) {
      const f = parseField('x', `DEFINE FIELD x ON TABLE u TYPE ${kw}`)!
      assertEquals(f.type, want, `type ${kw} should map to ${want}`)
    }
  })

  it('falls back to ANY on unknown type', () => {
    const f = parseField('x', 'DEFINE FIELD x ON TABLE t TYPE unknown_type_value')!
    assertEquals(f.type, FieldType.ANY)
  })

  it('falls back to ANY when TYPE clause is missing', () => {
    const f = parseField('x', 'DEFINE FIELD x ON TABLE t')!
    assertEquals(f.type, FieldType.ANY)
  })

  it('extracts ASSERT and DEFAULT', () => {
    const f = parseField('age', 'DEFINE FIELD age ON TABLE user TYPE int ASSERT $value >= 0 DEFAULT 0')!
    assertEquals(f.type, FieldType.INT)
    assertEquals(f.assertion, '$value >= 0')
    assertEquals(f.defaultValue, '0')
  })

  it('extracts VALUE, READONLY, FLEXIBLE simultaneously', () => {
    const f = parseField(
      'full',
      'DEFINE FIELD full ON TABLE user TYPE string VALUE string::concat(a,b) READONLY FLEXIBLE',
    )!
    assertEquals(f.value, 'string::concat(a,b)')
    assertEquals(f.readonly, true)
    assertEquals(f.flexible, true)
  })

  it('$value lookbehind: VALUE clause does not swallow $value in ASSERT', () => {
    // Regression: a naive `VALUE\s+` match would capture the `value` in
    // `$value`. The word-boundary aware extractor must not.
    const f = parseField(
      'score',
      'DEFINE FIELD score ON TABLE user TYPE int ASSERT $value >= 0 AND $value <= 100',
    )!
    assertEquals(f.type, FieldType.INT)
    assertEquals(f.assertion, '$value >= 0 AND $value <= 100')
    assertEquals(f.value, undefined)
  })

  it('$before/$after lookbehind: keywords inside identifiers are ignored', () => {
    const f = parseField(
      'guard',
      'DEFINE FIELD guard ON TABLE user TYPE int ASSERT $before.count != $after.count',
    )!
    assertEquals(f.assertion, '$before.count != $after.count')
    assertEquals(f.defaultValue, undefined)
    assertEquals(f.value, undefined)
  })

  it('handles lowercase READONLY', () => {
    const f = parseField('x', 'DEFINE FIELD x ON TABLE t TYPE string readonly')!
    assertEquals(f.readonly, true)
  })

  it('round-trips through generateFieldSql-like shape', () => {
    const def = "DEFINE FIELD email ON TABLE user TYPE string ASSERT $value != NONE DEFAULT 'a@b.com'"
    const f = parseField('email', def)!
    assertEquals(f.assertion, '$value != NONE')
    assertEquals(f.defaultValue, "'a@b.com'")
  })
})

describe('parseFields', () => {
  it('parses every entry of a name→definition map', () => {
    const out = parseFields({
      email: 'DEFINE FIELD email ON TABLE user TYPE string',
      age: 'DEFINE FIELD age ON TABLE user TYPE int',
    })
    assertEquals(out.length, 2)
    assertEquals(out.find((f) => f.name === 'age')?.type, FieldType.INT)
  })

  it('skips empty definition entries', () => {
    const out = parseFields({ good: 'DEFINE FIELD good ON TABLE t TYPE string', empty: '' })
    assertEquals(out.length, 1)
  })
})

// ---------------------------------------------------------------------------
// parseIndex
// ---------------------------------------------------------------------------

describe('parseIndex', () => {
  it('returns undefined for empty definition', () => {
    assertEquals(parseIndex('ix', ''), undefined)
    assertEquals(parseIndex('ix', '   '), undefined)
  })

  it('parses standard COLUMNS index', () => {
    const i = parseIndex('title_idx', 'DEFINE INDEX title_idx ON TABLE post COLUMNS title')!
    assertEquals(i.type, IndexType.STANDARD)
    assertEquals(i.fields, ['title'])
  })

  it('parses UNIQUE using FIELDS alias', () => {
    const i = parseIndex('email_idx', 'DEFINE INDEX email_idx ON TABLE user FIELDS email UNIQUE')!
    assertEquals(i.type, IndexType.UNIQUE)
    assertEquals(i.fields, ['email'])
  })

  it('parses multi-column index', () => {
    const i = parseIndex('composite', 'DEFINE INDEX composite ON TABLE user COLUMNS a, b, c UNIQUE')!
    assertEquals(i.fields, ['a', 'b', 'c'])
  })

  it('parses SEARCH index', () => {
    const i = parseIndex(
      'content_search',
      'DEFINE INDEX content_search ON TABLE post COLUMNS title, content SEARCH ANALYZER ascii',
    )!
    assertEquals(i.type, IndexType.SEARCH)
    assertEquals(i.fields.length, 2)
  })

  it('parses MTREE with dimension, distance, vector type', () => {
    const i = parseIndex(
      'emb_idx',
      'DEFINE INDEX emb_idx ON TABLE doc COLUMNS embedding MTREE DIMENSION 1536 DIST COSINE TYPE F32',
    )!
    assertEquals(i.type, IndexType.MTREE)
    assertEquals(i.mtreeDimension, 1536)
    assertEquals(i.mtreeDistance, MTreeDistanceType.COSINE)
    assertEquals(i.mtreeVectorType, MTreeVectorType.F32)
  })

  it('parses HNSW with EFC and M', () => {
    const i = parseIndex(
      'feat_idx',
      'DEFINE INDEX feat_idx ON TABLE doc COLUMNS features HNSW DIMENSION 128 DIST COSINE TYPE F32 EFC 500 M 16',
    )!
    assertEquals(i.type, IndexType.HNSW)
    assertEquals(i.mtreeDimension, 128)
    assertEquals(i.hnswDistance, HnswDistanceType.COSINE)
    assertEquals(i.mtreeVectorType, MTreeVectorType.F32)
    assertEquals(i.hnswEfc, 500)
    assertEquals(i.hnswM, 16)
  })

  it('parses HNSW without EFC/M', () => {
    const i = parseIndex(
      'feat_idx',
      'DEFINE INDEX feat_idx ON TABLE doc COLUMNS features HNSW DIMENSION 64 DIST EUCLIDEAN TYPE F64',
    )!
    assertEquals(i.type, IndexType.HNSW)
    assertEquals(i.hnswEfc, undefined)
    assertEquals(i.hnswM, undefined)
    assertEquals(i.hnswDistance, HnswDistanceType.EUCLIDEAN)
    assertEquals(i.mtreeVectorType, MTreeVectorType.F64)
  })

  it('supports HNSW Chebyshev distance', () => {
    const i = parseIndex('h', 'DEFINE INDEX h ON TABLE x COLUMNS v HNSW DIMENSION 4 DIST CHEBYSHEV')!
    assertEquals(i.hnswDistance, HnswDistanceType.CHEBYSHEV)
  })

  it('returns empty columns when COLUMNS/FIELDS clause absent', () => {
    const i = parseIndex('x', 'DEFINE INDEX x ON TABLE t')!
    assertEquals(i.fields, [])
    assertEquals(i.type, IndexType.STANDARD)
  })
})

describe('parseIndexes', () => {
  it('parses many', () => {
    const out = parseIndexes({
      a: 'DEFINE INDEX a ON TABLE t COLUMNS a',
      b: 'DEFINE INDEX b ON TABLE t COLUMNS b UNIQUE',
    })
    assertEquals(out.length, 2)
  })
})

// ---------------------------------------------------------------------------
// parseEvent
// ---------------------------------------------------------------------------

describe('parseEvent', () => {
  it('returns undefined for empty definition', () => {
    assertEquals(parseEvent('e', ''), undefined)
  })

  it('parses bare THEN action', () => {
    const e = parseEvent(
      'email_changed',
      'DEFINE EVENT email_changed ON TABLE user WHEN $before.email != $after.email THEN CREATE audit_log;',
    )!
    assertEquals(e.when, '$before.email != $after.email')
    assertEquals(e.then, 'CREATE audit_log')
  })

  it('parses brace-wrapped THEN action', () => {
    const e = parseEvent(
      'n',
      'DEFINE EVENT n ON TABLE t WHEN true THEN { CREATE audit_log };',
    )!
    assertEquals(e.then, 'CREATE audit_log')
  })

  it('returns undefined when THEN clause is missing', () => {
    assertEquals(parseEvent('n', 'DEFINE EVENT n ON TABLE t WHEN true;'), undefined)
  })
})

describe('parseEvents', () => {
  it('parses many', () => {
    const out = parseEvents({
      a: 'DEFINE EVENT a ON TABLE t WHEN true THEN CREATE log;',
      b: 'DEFINE EVENT b ON TABLE t WHEN false THEN { DELETE log };',
    })
    assertEquals(out.length, 2)
  })
})

// ---------------------------------------------------------------------------
// parseAccess
// ---------------------------------------------------------------------------

describe('parseAccess', () => {
  it('returns undefined for empty or unknown type', () => {
    assertEquals(parseAccess('x', ''), undefined)
    assertEquals(parseAccess('x', 'DEFINE ACCESS x ON DATABASE TYPE BOGUS;'), undefined)
  })

  it('parses JWT HS256 with key', () => {
    const a = parseAccess(
      'api',
      "DEFINE ACCESS api ON DATABASE TYPE JWT ALGORITHM HS256 KEY 'secret';",
    )!
    assertEquals(a.type, AccessType.JWT)
    assertEquals(a.jwt?.algorithm, 'HS256')
    assertEquals(a.jwt?.key, 'secret')
  })

  it('parses JWT with URL and issuer', () => {
    const a = parseAccess(
      'api',
      "DEFINE ACCESS api ON DATABASE TYPE JWT ALGORITHM RS256 URL 'https://auth.example.com/jwks' WITH ISSUER 'https://auth.example.com';",
    )!
    assertEquals(a.jwt?.algorithm, 'RS256')
    assertEquals(a.jwt?.url, 'https://auth.example.com/jwks')
    assertEquals(a.jwt?.issuer, 'https://auth.example.com')
  })

  it('parses RECORD signup/signin + durations', () => {
    const a = parseAccess(
      'user_auth',
      'DEFINE ACCESS user_auth ON DATABASE TYPE RECORD SIGNUP (CREATE user) SIGNIN (SELECT * FROM user) DURATION FOR SESSION 24h, FOR TOKEN 15m;',
    )!
    assertEquals(a.type, AccessType.RECORD)
    assertEquals(a.record?.signup, 'CREATE user')
    assertEquals(a.record?.signin, 'SELECT * FROM user')
    assertEquals(a.durationSession, '24h')
    assertEquals(a.durationToken, '15m')
  })
})

// ---------------------------------------------------------------------------
// parseTableInfo
// ---------------------------------------------------------------------------

describe('parseTableInfo', () => {
  it('rejects non-object input with SchemaParseError', () => {
    assertThrows(() => parseTableInfo('user', null), SchemaParseError)
    assertThrows(() => parseTableInfo('user', 'not an object'), SchemaParseError)
    assertThrows(() => parseTableInfo('user', [1, 2, 3]), SchemaParseError)
  })

  it('rejects empty table name', () => {
    assertThrows(() => parseTableInfo('', {}), SchemaParseError)
  })

  it('parses short-key payload', () => {
    const info = {
      tb: 'DEFINE TABLE user SCHEMAFULL',
      fd: { email: 'DEFINE FIELD email ON TABLE user TYPE string' },
      ix: { e_idx: 'DEFINE INDEX e_idx ON TABLE user COLUMNS email UNIQUE' },
      ev: { on_change: 'DEFINE EVENT on_change ON TABLE user WHEN true THEN CREATE log;' },
    }
    const t = parseTableInfo('user', info)
    assertEquals(t.name, 'user')
    assertEquals(t.mode, TableMode.SCHEMAFULL)
    assertEquals(t.fields.length, 1)
    assertEquals(t.indexes.length, 1)
    assertEquals(t.events.length, 1)
  })

  it('parses long-key payload', () => {
    const info = {
      tb: 'DEFINE TABLE post SCHEMALESS',
      fields: { title: 'DEFINE FIELD title ON TABLE post TYPE string' },
      indexes: {},
      events: {},
    }
    const t = parseTableInfo('post', info)
    assertEquals(t.mode, TableMode.SCHEMALESS)
    assertEquals(t.fields.length, 1)
  })

  it('prefers long-key map when both are present', () => {
    const info = {
      tb: 'DEFINE TABLE user SCHEMAFULL',
      fields: { a: 'DEFINE FIELD a ON TABLE user TYPE string' },
      fd: { b: 'DEFINE FIELD b ON TABLE user TYPE int' },
    }
    const t = parseTableInfo('user', info)
    assertEquals(t.fields.length, 1)
    assertEquals(t.fields[0].name, 'a')
  })

  it('defaults to SCHEMALESS when tb is missing', () => {
    const t = parseTableInfo('post', {})
    assertEquals(t.mode, TableMode.SCHEMALESS)
    assertEquals(t.fields.length, 0)
  })
})

// ---------------------------------------------------------------------------
// parseDbInfo
// ---------------------------------------------------------------------------

describe('parseDbInfo', () => {
  it('rejects non-object input with SchemaParseError', () => {
    assertThrows(() => parseDbInfo([1, 2, 3]), SchemaParseError)
    assertThrows(() => parseDbInfo(null), SchemaParseError)
  })

  it('returns empty maps for empty object', () => {
    const db = parseDbInfo({})
    assertEquals(Object.keys(db.tables).length, 0)
    assertEquals(Object.keys(db.edges).length, 0)
    assertEquals(Object.keys(db.accesses).length, 0)
  })

  it('partitions RELATION tables into edges', () => {
    const info = {
      tb: {
        user: 'DEFINE TABLE user SCHEMAFULL',
        post: 'DEFINE TABLE post SCHEMALESS',
        likes: 'DEFINE TABLE likes TYPE RELATION FROM user TO post',
      },
    }
    const db = parseDbInfo(info)
    assertEquals(Object.keys(db.tables).length, 2)
    assertEquals(Object.keys(db.edges).length, 1)
    const edge = db.edges.likes
    assertEquals(edge.mode, EdgeMode.RELATION)
    assertEquals(edge.fromTable, 'user')
    assertEquals(edge.toTable, 'post')
  })

  it('accepts long-key tables/accesses', () => {
    const info = {
      tables: { user: 'DEFINE TABLE user SCHEMAFULL' },
      accesses: {
        api: "DEFINE ACCESS api ON DATABASE TYPE JWT ALGORITHM HS256 KEY 'secret';",
      },
    }
    const db = parseDbInfo(info)
    assertEquals(Object.keys(db.tables).length, 1)
    assertEquals(Object.keys(db.accesses).length, 1)
    assertEquals(db.accesses.api.type, AccessType.JWT)
  })

  it('ignores non-string table entries', () => {
    const info = {
      tb: {
        user: 'DEFINE TABLE user SCHEMAFULL',
        bogus: 42,
      },
    }
    const db = parseDbInfo(info)
    assertEquals(Object.keys(db.tables).length, 1)
    assert('user' in db.tables)
  })

  it('skips malformed access entries', () => {
    const info = {
      ac: {
        good: "DEFINE ACCESS good ON DATABASE TYPE JWT ALGORITHM HS256 KEY 'k';",
        bad: 'DEFINE ACCESS bad ON DATABASE TYPE UNKNOWN;',
      },
    }
    const db = parseDbInfo(info)
    assert('good' in db.accesses)
    assertEquals(db.accesses.bad, undefined)
  })
})

// ---------------------------------------------------------------------------
// parseEdgeInfo
// ---------------------------------------------------------------------------

describe('parseEdgeInfo', () => {
  it('rejects empty name', () => {
    assertThrows(() => parseEdgeInfo('', {}), SchemaParseError)
  })

  it('extracts from/to + fields from relation', () => {
    const info = {
      tb: 'DEFINE TABLE likes TYPE RELATION FROM user TO product',
      fields: { weight: 'DEFINE FIELD weight ON TABLE likes TYPE float DEFAULT 1.0' },
    }
    const e = parseEdgeInfo('likes', info)
    assertEquals(e.mode, EdgeMode.RELATION)
    assertEquals(e.fromTable, 'user')
    assertEquals(e.toTable, 'product')
    assertEquals(e.fields.length, 1)
    assertEquals(e.fields[0].name, 'weight')
  })
})

// ---------------------------------------------------------------------------
// Idempotency / round-trip
// ---------------------------------------------------------------------------

describe('round-trip: generate → parse → regenerate', () => {
  it('preserves schemafull table with fields and unique index', () => {
    const table = withIndexes(
      withFields(
        tableSchema('user', TableMode.SCHEMAFULL),
        stringField('email'),
        intField('age', { assertion: '$value >= 0', defaultValue: '0' }),
        datetimeField('created_at', { defaultValue: 'time::now()', readonly: true }),
      ),
      uniqueIndex('email_idx', 'email'),
    )

    const sql = generateTableSql(table)
    const lines = sql.split('\n').map((s) => s.replace(/;$/, ''))
    const info = {
      tb: lines[0],
      fd: {
        email: lines[1],
        age: lines[2],
        created_at: lines[3],
      },
      ix: { email_idx: lines[4] },
    }

    const parsed = parseTableInfo('user', info)
    assertEquals(parsed.mode, TableMode.SCHEMAFULL)
    assertEquals(parsed.fields.length, 3)
    assertEquals(parsed.indexes.length, 1)
    const age = parsed.fields.find((f) => f.name === 'age')!
    assertEquals(age.type, FieldType.INT)
    assertEquals(age.assertion, '$value >= 0')
    assertEquals(age.defaultValue, '0')
    const created = parsed.fields.find((f) => f.name === 'created_at')!
    assertEquals(created.defaultValue, 'time::now()')
    assertEquals(created.readonly, true)
    const ix = parsed.indexes[0]
    assertEquals(ix.type, IndexType.UNIQUE)
    assertEquals(ix.fields, ['email'])
  })

  it('preserves MTREE index', () => {
    const table = withIndexes(
      tableSchema('doc', TableMode.SCHEMAFULL),
      mtreeIndex('emb_idx', 'embedding', 1536, {
        distance: MTreeDistanceType.COSINE,
        vectorType: MTreeVectorType.F32,
      }),
    )
    const [tb, ix] = generateTableSql(table).split('\n').map((s) => s.replace(/;$/, ''))
    const parsed = parseTableInfo('doc', { tb, ix: { emb_idx: ix } })
    const parsedIx = parsed.indexes[0]
    assertEquals(parsedIx.type, IndexType.MTREE)
    assertEquals(parsedIx.mtreeDimension, 1536)
    assertEquals(parsedIx.mtreeDistance, MTreeDistanceType.COSINE)
    assertEquals(parsedIx.mtreeVectorType, MTreeVectorType.F32)
  })

  it('preserves HNSW index with EFC/M', () => {
    const table = withIndexes(
      tableSchema('doc', TableMode.SCHEMAFULL),
      hnswIndex('feat_idx', 'features', 128, {
        distance: HnswDistanceType.COSINE,
        vectorType: MTreeVectorType.F32,
        efc: 150,
        m: 12,
      }),
    )
    const [tb, ix] = generateTableSql(table).split('\n').map((s) => s.replace(/;$/, ''))
    const parsed = parseTableInfo('doc', { tb, ix: { feat_idx: ix } })
    const parsedIx = parsed.indexes[0]
    assertEquals(parsedIx.type, IndexType.HNSW)
    assertEquals(parsedIx.mtreeDimension, 128)
    assertEquals(parsedIx.hnswDistance, HnswDistanceType.COSINE)
    assertEquals(parsedIx.mtreeVectorType, MTreeVectorType.F32)
    assertEquals(parsedIx.hnswEfc, 150)
    assertEquals(parsedIx.hnswM, 12)
  })

  it('preserves SEARCH index columns', () => {
    const table = withIndexes(
      tableSchema('post', TableMode.SCHEMAFULL),
      searchIndex('content_search', ['title', 'content'], 'ascii'),
    )
    const [tb, ix] = generateTableSql(table).split('\n').map((s) => s.replace(/;$/, ''))
    const parsed = parseTableInfo('post', { tb, ix: { content_search: ix } })
    const parsedIx = parsed.indexes[0]
    assertEquals(parsedIx.type, IndexType.SEARCH)
    assertEquals(parsedIx.fields.length, 2)
  })
})

// ---------------------------------------------------------------------------
// Live-db helpers (mocked)
// ---------------------------------------------------------------------------

function makeMockDb(response: unknown) {
  return {
    query: (_sql: string) => Promise.resolve([response]),
  }
}

function makeFailingMockDb(error: Error) {
  return {
    query: (_sql: string) => Promise.reject(error),
  }
}

describe('fetchTableInfo', () => {
  it('fetches and parses table info', async () => {
    const raw = {
      tb: 'DEFINE TABLE users SCHEMAFULL',
      fields: { name: 'DEFINE FIELD name ON TABLE users TYPE string' },
    }
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(raw) as any
    const result = await fetchTableInfo(db, 'users')
    assertEquals(result.name, 'users')
    assertEquals(result.fields.length, 1)
    assertEquals(result.fields[0].name, 'name')
  })

  it('throws SurQlError on failure', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingMockDb(new Error('connection lost')) as any
    await assertRejects(
      () => fetchTableInfo(db, 'users'),
      Error,
      'Failed to fetch info for table users',
    )
  })
})

describe('fetchDbInfo', () => {
  it('fetches and parses database info', async () => {
    const raw = { tables: { users: 'DEFINE TABLE users SCHEMAFULL' } }
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(raw) as any
    const result = await fetchDbInfo(db)
    assert('users' in result.tables)
  })

  it('throws SurQlError on failure', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingMockDb(new Error('db error')) as any
    await assertRejects(
      () => fetchDbInfo(db),
      Error,
      'Failed to fetch database info',
    )
  })
})

// ---------------------------------------------------------------------------
// Round-trip symmetry — the shapes SurrealDB v3 returns from INFO
// ---------------------------------------------------------------------------

describe('parseField — v3 type round-trip', () => {
  it('unfolds `none | X` (how v3 stores option<X>) to an optional field', () => {
    const f = parseField('opt_str', 'DEFINE FIELD opt_str ON t TYPE none | string PERMISSIONS FULL')!
    assertEquals(f.type, FieldType.STRING)
    assertEquals(f.optional, true)
  })

  it('also accepts the emitted `option<X>` form', () => {
    const f = parseField('opt_str', 'DEFINE FIELD opt_str ON t TYPE option<string>')!
    assertEquals(f.type, FieldType.STRING)
    assertEquals(f.optional, true)
  })

  it('extracts the target table from `record<X>`', () => {
    const f = parseField('rec', 'DEFINE FIELD rec ON t TYPE record<other> PERMISSIONS FULL')!
    assertEquals(f.type, FieldType.RECORD)
    assertEquals(f.recordLink, 'other')
    assertEquals(f.optional, undefined)
  })

  it('handles an optional record link (`none | record<X>`)', () => {
    const f = parseField('opt_rec', 'DEFINE FIELD opt_rec ON t TYPE none | record<other> PERMISSIONS FULL')!
    assertEquals(f.type, FieldType.RECORD)
    assertEquals(f.recordLink, 'other')
    assertEquals(f.optional, true)
  })

  it('extracts the element type from `array<T>`', () => {
    const f = parseField('arr', 'DEFINE FIELD arr ON t TYPE array<int> PERMISSIONS FULL')!
    assertEquals(f.type, FieldType.ARRAY)
    assertEquals(f.arrayType, FieldType.INT)
  })

  it('reads FLEXIBLE alongside an unfolded option type', () => {
    const f = parseField('flex', 'DEFINE FIELD flex ON t TYPE none | object FLEXIBLE PERMISSIONS FULL')!
    assertEquals(f.type, FieldType.OBJECT)
    assertEquals(f.optional, true)
    assertEquals(f.flexible, true)
  })

  it('does not mistake a field named after a clause keyword for that clause', () => {
    // SurrealDB allows a field literally named `default` / `comment`.
    const def = parseField('default', 'DEFINE FIELD default ON t TYPE string PERMISSIONS FULL')!
    assertEquals(def.name, 'default')
    assertEquals(def.type, FieldType.STRING)
    assertEquals(def.defaultValue, undefined)

    const comment = parseField('comment', 'DEFINE FIELD comment ON t TYPE int PERMISSIONS FULL')!
    assertEquals(comment.type, FieldType.INT)
  })
})

describe('parseFields — array sub-field entries', () => {
  it('skips `<field>.*` and `<field>[*]` element-spec entries', () => {
    const out = parseFields({
      arr: 'DEFINE FIELD arr ON t TYPE array<int>',
      'arr.*': 'DEFINE FIELD arr.* ON t TYPE int',
      'tags[*]': 'DEFINE FIELD tags[*] ON t TYPE string',
      plain: 'DEFINE FIELD plain ON t TYPE string',
    })
    assertEquals(out.map((f) => f.name).sort(), ['arr', 'plain'])
  })
})

describe('parseTablePermissions', () => {
  it('returns undefined for NONE / FULL / absent', () => {
    assertEquals(parseTablePermissions('DEFINE TABLE t SCHEMAFULL'), undefined)
    assertEquals(parseTablePermissions('DEFINE TABLE t SCHEMAFULL PERMISSIONS NONE'), undefined)
    assertEquals(parseTablePermissions('DEFINE TABLE t SCHEMAFULL PERMISSIONS FULL'), undefined)
  })

  it('parses the compact comma-joined form v3 emits', () => {
    const p = parseTablePermissions(
      'DEFINE TABLE t TYPE NORMAL SCHEMAFULL PERMISSIONS FOR select, create, update, delete WHERE tenant = $auth.tenant',
    )!
    assertEquals(p.select, 'tenant = $auth.tenant')
    assertEquals(p.create, 'tenant = $auth.tenant')
    assertEquals(p.update, 'tenant = $auth.tenant')
    assertEquals(p.delete, 'tenant = $auth.tenant')
  })

  it('parses the expanded per-action form', () => {
    const p = parseTablePermissions(
      'DEFINE TABLE t SCHEMAFULL PERMISSIONS FOR select WHERE published = true FOR create WHERE $auth.id != NONE',
    )!
    assertEquals(p.select, 'published = true')
    assertEquals(p.create, '$auth.id != NONE')
    assertEquals(p.update, undefined)
  })
})

describe('parseTableInfo — defineTable argument', () => {
  it('recovers mode + permissions from the DEFINE TABLE string', () => {
    // SurrealDB v3 omits `tb` from INFO FOR TABLE — mode/permissions come
    // from the DEFINE TABLE statement in INFO FOR DB.
    const info = { fields: {}, indexes: {}, events: {} }
    const t = parseTableInfo(
      't',
      info,
      'DEFINE TABLE t TYPE NORMAL SCHEMAFULL PERMISSIONS FOR select, create, update, delete WHERE true',
    )
    assertEquals(t.mode, TableMode.SCHEMAFULL)
    assertEquals(t.permissions?.select, 'true')
    assertEquals(t.permissions?.delete, 'true')
  })

  it('defaults to SCHEMALESS with no permissions when neither tb nor defineTable is given', () => {
    const t = parseTableInfo('t', { fields: {} })
    assertEquals(t.mode, TableMode.SCHEMALESS)
    assertEquals(t.permissions, undefined)
  })
})

describe('parseEdgeInfo — defineTable argument', () => {
  it('recovers FROM/TO endpoints from the DEFINE TABLE string', () => {
    const e = parseEdgeInfo('wrote', { fields: {} }, 'DEFINE TABLE wrote TYPE RELATION FROM user TO post')
    assertEquals(e.fromTable, 'user')
    assertEquals(e.toTable, 'post')
  })
})

describe('round-trip: code schema → v3 INFO shape → parse → diff', () => {
  it('reports zero drift for a table that matches the database', () => {
    const code = withFields(
      tableSchema('t', TableMode.SCHEMAFULL),
      stringField('plain'),
      stringField('opt_str', { optional: true }),
      recordField('rec', 'other'),
      recordField('opt_rec', 'other', { optional: true }),
      arrayField('arr', FieldType.INT),
      intField('default'),
    )
    // The exact shapes SurrealDB v3.0.5 returns for that emitted schema:
    // option<X> unfolds to `none | X`, every field gains `PERMISSIONS FULL`,
    // and the array field gains a companion `arr.*` element-spec entry.
    const info = {
      fields: {
        plain: 'DEFINE FIELD plain ON t TYPE string PERMISSIONS FULL',
        opt_str: 'DEFINE FIELD opt_str ON t TYPE none | string PERMISSIONS FULL',
        rec: 'DEFINE FIELD rec ON t TYPE record<other> PERMISSIONS FULL',
        opt_rec: 'DEFINE FIELD opt_rec ON t TYPE none | record<other> PERMISSIONS FULL',
        arr: 'DEFINE FIELD arr ON t TYPE array<int> PERMISSIONS FULL',
        'arr.*': 'DEFINE FIELD arr.* ON t TYPE int PERMISSIONS FULL',
        default: 'DEFINE FIELD default ON t TYPE int PERMISSIONS FULL',
      },
    }
    const parsed = parseTableInfo('t', info, 'DEFINE TABLE t TYPE NORMAL SCHEMAFULL')
    assertEquals(diffTables([parsed], [code]), [])
  })
})
