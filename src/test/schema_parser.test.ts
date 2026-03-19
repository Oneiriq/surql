import { assertEquals, assertRejects } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { fetchDbInfo, fetchTableInfo, parseDbInfo, parseTableInfo } from '../schema/parser.ts'

describe('parseTableInfo', () => {
  it('should parse standard field names', () => {
    const raw = {
      fields: { name: 'DEFINE FIELD name ON users TYPE string' },
      indexes: { idx_name: 'DEFINE INDEX idx_name ON users FIELDS name' },
      events: { on_create: 'DEFINE EVENT on_create ON users ...' },
      lives: {},
    }
    const result = parseTableInfo(raw)
    assertEquals(result.fields.name, 'DEFINE FIELD name ON users TYPE string')
    assertEquals(result.indexes.idx_name, 'DEFINE INDEX idx_name ON users FIELDS name')
    assertEquals(result.events.on_create, 'DEFINE EVENT on_create ON users ...')
    assertEquals(Object.keys(result.lives).length, 0)
  })

  it('should parse abbreviated field names (fd, ix, ev, lv)', () => {
    const raw = {
      fd: { email: 'DEFINE FIELD email ...' },
      ix: { idx_email: 'DEFINE INDEX idx_email ...' },
      ev: {},
      lv: { live1: 'LIVE SELECT ...' },
    }
    const result = parseTableInfo(raw)
    assertEquals(result.fields.email, 'DEFINE FIELD email ...')
    assertEquals(result.indexes.idx_email, 'DEFINE INDEX idx_email ...')
    assertEquals(result.lives.live1, 'LIVE SELECT ...')
  })

  it('should default to empty objects for missing keys', () => {
    const result = parseTableInfo({})
    assertEquals(Object.keys(result.fields).length, 0)
    assertEquals(Object.keys(result.indexes).length, 0)
    assertEquals(Object.keys(result.events).length, 0)
    assertEquals(Object.keys(result.lives).length, 0)
  })

  it('should set name to empty string', () => {
    const result = parseTableInfo({})
    assertEquals(result.name, '')
  })

  it('should prefer standard names over abbreviated', () => {
    const raw = {
      fields: { name: 'standard' },
      fd: { name: 'abbreviated' },
    }
    const result = parseTableInfo(raw)
    assertEquals(result.fields.name, 'standard')
  })
})

describe('parseDbInfo', () => {
  it('should parse standard field names', () => {
    const raw = {
      tables: { users: 'DEFINE TABLE users ...' },
      accesses: { jwt: 'DEFINE ACCESS jwt ...' },
      analyzers: {},
      functions: { fn_test: 'DEFINE FUNCTION fn_test ...' },
      params: {},
    }
    const result = parseDbInfo(raw)
    assertEquals(result.tables.users, 'DEFINE TABLE users ...')
    assertEquals(result.accesses.jwt, 'DEFINE ACCESS jwt ...')
    assertEquals(result.functions.fn_test, 'DEFINE FUNCTION fn_test ...')
  })

  it('should parse abbreviated field names (tb, ac, az, fn, pa)', () => {
    const raw = {
      tb: { posts: 'DEFINE TABLE posts ...' },
      ac: { record_access: 'DEFINE ACCESS ...' },
      az: { ascii: 'DEFINE ANALYZER ascii ...' },
      fn: {},
      pa: { my_param: '$my_param = 42' },
    }
    const result = parseDbInfo(raw)
    assertEquals(result.tables.posts, 'DEFINE TABLE posts ...')
    assertEquals(result.accesses.record_access, 'DEFINE ACCESS ...')
    assertEquals(result.analyzers.ascii, 'DEFINE ANALYZER ascii ...')
    assertEquals(result.params.my_param, '$my_param = 42')
  })

  it('should default to empty objects for missing keys', () => {
    const result = parseDbInfo({})
    assertEquals(Object.keys(result.tables).length, 0)
    assertEquals(Object.keys(result.accesses).length, 0)
    assertEquals(Object.keys(result.analyzers).length, 0)
    assertEquals(Object.keys(result.functions).length, 0)
    assertEquals(Object.keys(result.params).length, 0)
  })
})

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
  it('should fetch and parse table info', async () => {
    const raw = {
      fields: { name: 'DEFINE FIELD name ...' },
      indexes: {},
      events: {},
      lives: {},
    }
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(raw) as any
    const result = await fetchTableInfo(db, 'users')
    assertEquals(result.name, 'users')
    assertEquals(result.fields.name, 'DEFINE FIELD name ...')
  })

  it('should throw SurQlError on failure', async () => {
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
  it('should fetch and parse database info', async () => {
    const raw = {
      tables: { users: 'DEFINE TABLE users' },
      accesses: {},
      analyzers: {},
      functions: {},
      params: {},
    }
    // deno-lint-ignore no-explicit-any
    const db = makeMockDb(raw) as any
    const result = await fetchDbInfo(db)
    assertEquals(result.tables.users, 'DEFINE TABLE users')
  })

  it('should throw SurQlError on failure', async () => {
    // deno-lint-ignore no-explicit-any
    const db = makeFailingMockDb(new Error('db error')) as any
    await assertRejects(
      () => fetchDbInfo(db),
      Error,
      'Failed to fetch database info',
    )
  })
})
