import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import { describe, it } from '@std/testing/bdd'

import {
  AuthManager,
  AuthType,
  buildRelateQuery,
  buildUpsertQuery,
  checkReservedWord,
  coerceDatetime,
  coerceRecordDatetimes,
  ConnectionError,
  DARK_THEME,
  EDGE_ALLOWED_RESERVED,
  FOREST_THEME,
  getTheme,
  type HealthCheck,
  isCached,
  listThemes,
  MINIMAL_THEME,
  MODERN_THEME,
  type NamedConnectionConfig,
  QueryError,
  type QueryResult,
  type ScopeCredentials,
  similaritySearchQuery,
  success,
  SURREAL_RESERVED_WORDS,
  type TokenAuth,
  vectorSearchQuery,
} from '../../mod.ts'

describe('Python Parity - New Items', () => {
  describe('Schema Themes', () => {
    it('should list available themes', () => {
      const themes = listThemes()
      assertEquals(themes, ['dark', 'forest', 'minimal', 'modern'])
    })

    it('should get theme by name', () => {
      const theme = getTheme('modern')
      assertEquals(theme.name, 'modern')
      assertEquals(theme.colorScheme.primary, '#6366f1')
    })

    it('should throw for unknown theme', () => {
      assertThrows(() => getTheme('nonexistent'), Error, 'Unknown theme')
    })

    it('should have preset theme constants', () => {
      assertEquals(MODERN_THEME.name, 'modern')
      assertEquals(DARK_THEME.name, 'dark')
      assertEquals(FOREST_THEME.name, 'forest')
      assertEquals(MINIMAL_THEME.name, 'minimal')
    })

    it('should have complete theme structure', () => {
      const theme = getTheme('dark')
      assertEquals(theme.colorScheme.background, '#1e1b4b')
      assertEquals(theme.graphviz.nodeColor, '#8b5cf6')
      assertEquals(theme.mermaid.themeName, 'dark')
      assertEquals(theme.ascii.useColors, true)
    })
  })

  describe('Types - Coerce', () => {
    it('should coerce ISO datetime string', () => {
      const dt = coerceDatetime('2024-01-15T10:30:00Z')
      assertEquals(dt instanceof Date, true)
      assertEquals(dt.getUTCHours(), 10)
    })

    it('should pass through Date objects', () => {
      const original = new Date('2024-01-15T10:30:00Z')
      const result = coerceDatetime(original)
      assertEquals(result, original)
    })

    it('should truncate nanoseconds', () => {
      const dt = coerceDatetime('2024-01-15T10:30:00.123456789Z')
      assertEquals(dt instanceof Date, true)
      assertEquals(dt.getUTCMilliseconds(), 123)
    })

    it('should throw for invalid datetime', () => {
      assertThrows(() => coerceDatetime('not-a-date'), Error, 'Cannot parse datetime')
    })

    it('should coerce record datetimes', () => {
      const record = { name: 'Alice', created: '2024-01-15T10:30:00Z', age: 30 }
      const result = coerceRecordDatetimes(record, ['created'])
      assertEquals((result.created as unknown) instanceof Date, true)
      assertEquals(result.name, 'Alice')
      assertEquals(result.age, 30)
    })
  })

  describe('Types - Reserved Words', () => {
    it('should have reserved words set', () => {
      assertEquals(SURREAL_RESERVED_WORDS.has('select'), true)
      assertEquals(SURREAL_RESERVED_WORDS.has('from'), true)
      assertEquals(SURREAL_RESERVED_WORDS.has('customfield'), false)
    })

    it('should check reserved words', () => {
      assertEquals(typeof checkReservedWord('select'), 'string')
      assertEquals(checkReservedWord('customfield'), null)
    })

    it('should allow edge fields when option set', () => {
      assertEquals(checkReservedWord('in', { allowEdgeFields: true }), null)
      assertEquals(checkReservedWord('out', { allowEdgeFields: true }), null)
      assertEquals(typeof checkReservedWord('in'), 'string')
    })

    it('should check dot-notation leaf', () => {
      assertEquals(typeof checkReservedWord('record.select'), 'string')
      assertEquals(checkReservedWord('record.name'), null)
    })

    it('should have edge allowed reserved set', () => {
      assertEquals(EDGE_ALLOWED_RESERVED.has('in'), true)
      assertEquals(EDGE_ALLOWED_RESERVED.has('out'), true)
    })
  })

  describe('Query - QueryResult and success()', () => {
    it('should create success result', () => {
      const result: QueryResult = success([{ id: '1' }], '5ms')
      assertEquals(result.status, 'OK')
      assertEquals(result.time, '5ms')
      assertEquals(Array.isArray(result.data), true)
    })

    it('should create result with null time', () => {
      const result = success(42)
      assertEquals(result.data, 42)
      assertEquals(result.time, null)
    })
  })

  describe('Query - Build Helpers', () => {
    it('should build upsert query (per-record CONTENT, v3-safe)', () => {
      const sql = buildUpsertQuery('users', [{ name: 'Alice' }, { name: 'Bob' }])
      assertStringIncludes(sql, 'UPSERT users CONTENT')
      assertStringIncludes(sql, 'Alice')
      assertStringIncludes(sql, 'Bob')
    })

    it('should build upsert query with conflict fields inlined', () => {
      const sql = buildUpsertQuery('users', [{ email: 'a@b.com' }], ['email'])
      assertStringIncludes(sql, 'WHERE')
      assertStringIncludes(sql, "email = 'a@b.com'")
    })

    it('should return empty string for empty items', () => {
      assertEquals(buildUpsertQuery('users', []), '')
    })

    it('should build relate query', () => {
      const sql = buildRelateQuery('person:alice', 'knows', 'person:bob')
      assertEquals(sql, 'RELATE person:alice->knows->person:bob;')
    })

    it('should build relate query with data', () => {
      const sql = buildRelateQuery('person:alice', 'knows', 'person:bob', { since: 2024 })
      assertStringIncludes(sql, 'SET since = 2024')
    })
  })

  describe('Query - Vector Search Builders', () => {
    it('should create vector search query', () => {
      const q = vectorSearchQuery('docs', 'embedding', [1, 2, 3], undefined, 5)
      const sql = q.toSurQL()
      assertStringIncludes(sql, 'SELECT')
      assertStringIncludes(sql, 'docs')
      assertStringIncludes(sql, 'embedding')
    })

    it('should create similarity search query', () => {
      const q = similaritySearchQuery('docs', 'embedding', [1, 2, 3])
      const sql = q.toSurQL()
      assertStringIncludes(sql, 'SELECT')
      assertStringIncludes(sql, 'docs')
    })
  })

  describe('Connection - Auth', () => {
    it('should have AuthType enum', () => {
      assertEquals(AuthType.ROOT, 'root')
      assertEquals(AuthType.NAMESPACE, 'namespace')
      assertEquals(AuthType.DATABASE, 'database')
      assertEquals(AuthType.SCOPE, 'scope')
    })

    it('should create AuthManager', () => {
      const mgr = new AuthManager()
      assertEquals(mgr.isAuthenticated, false)
      assertEquals(mgr.currentToken, null)
      assertEquals(mgr.authType, null)
    })

    it('should have ConnectionError and QueryError', () => {
      const ce = new ConnectionError('failed')
      assertEquals(ce.name, 'ConnectionError')
      const qe = new QueryError('bad query')
      assertEquals(qe.name, 'QueryError')
    })
  })

  describe('Connection - Types', () => {
    it('should define ScopeCredentials shape', () => {
      const creds: ScopeCredentials = {
        namespace: 'test',
        database: 'test',
        access: 'user',
        variables: { email: 'test@test.com' },
      }
      assertEquals(creds.access, 'user')
    })

    it('should define TokenAuth shape', () => {
      const auth: TokenAuth = { token: 'jwt-token-here' }
      assertEquals(auth.token, 'jwt-token-here')
    })

    it('should define NamedConnectionConfig shape', () => {
      const config: NamedConnectionConfig = {
        name: 'primary',
        host: 'localhost',
        port: '8000',
        namespace: 'test',
        database: 'test',
        username: 'root',
        password: 'root',
      }
      assertEquals(config.name, 'primary')
    })
  })

  describe('Cache - isCached', () => {
    it('should return false for uncached key', async () => {
      assertEquals(await isCached('nonexistent-key-parity-test'), false)
    })
  })

  describe('Orchestration - HealthCheck type', () => {
    it('should define HealthCheck shape', () => {
      const check: HealthCheck = { environment: 'dev', timeout: 5000, retries: 3 }
      assertEquals(check.environment, 'dev')
      assertEquals(check.timeout, 5000)
    })
  })
})
