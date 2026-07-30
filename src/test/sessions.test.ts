import { assert, assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import type { SurrealSession } from 'surrealdb'
import { SurQLClient } from '../client.ts'
import { Session, SessionUnsupportedError } from '../sessions/session.ts'
import { SurrealConnectionManager } from '../auth/connection.ts'
import type { ConnectionConfig } from '../auth/connection.ts'

const httpConfig: ConnectionConfig = {
  host: 'localhost',
  port: '8000',
  namespace: 'test',
  database: 'test',
  username: 'root',
  password: 'root',
  protocol: 'http',
}

const wsConfig: ConnectionConfig = { ...httpConfig, protocol: 'ws' }

describe('SurQLClient.newSession transport gating', () => {
  it('throws SessionUnsupportedError over an HTTP connection (no network)', async () => {
    const client = new SurQLClient(httpConfig)
    await assertRejects(() => client.newSession(), SessionUnsupportedError)
  })

  it('classifies ws/wss as WebSocket and http as not (no network)', () => {
    // The transport gate keys off the resolved endpoint; verify it directly so
    // no socket is opened. ws:// must pass the gate; http:// must fail it.
    assertEquals(new SurrealConnectionManager(wsConfig).usesWebSocket(), true)
    assertEquals(new SurrealConnectionManager({ ...httpConfig, protocol: 'wss' }).usesWebSocket(), true)
    assertEquals(new SurrealConnectionManager(httpConfig).usesWebSocket(), false)
  })
})

describe('SessionUnsupportedError', () => {
  it('carries a clear default message', () => {
    const e = new SessionUnsupportedError()
    assertEquals(e.name, 'SessionUnsupportedError')
    assertStringIncludes(e.message, 'WebSocket')
  })
})

/**
 * Build a fake SurrealSession that records query() calls and the use/signin/
 * fork/close lifecycle, so the Session wrapper can be exercised without a
 * server.
 */
function fakeSession(): {
  session: SurrealSession
  queries: { sql: string; vars: Record<string, unknown> }[]
  events: string[]
} {
  const queries: { sql: string; vars: Record<string, unknown> }[] = []
  const events: string[] = []
  let valid = true
  const session = {
    get session() {
      return 'sess-1'
    },
    get isValid() {
      return valid
    },
    get namespace() {
      return 'ns'
    },
    get database() {
      return 'db'
    },
    query: (sql: string, vars: Record<string, unknown> = {}) => {
      queries.push({ sql, vars })
      // Mirror the SDK awaitable Query: resolve to one result per statement.
      return Promise.resolve([[]])
    },
    use: (target: unknown) => {
      events.push(`use:${JSON.stringify(target)}`)
      return Promise.resolve({})
    },
    signin: (auth: unknown) => {
      events.push(`signin:${JSON.stringify(auth)}`)
      return Promise.resolve({})
    },
    forkSession: () => {
      events.push('fork')
      return Promise.resolve(fakeSession().session)
    },
    closeSession: () => {
      events.push('close')
      valid = false
      return Promise.resolve()
    },
  } as unknown as SurrealSession
  return { session, queries, events }
}

describe('Session wrapper', () => {
  it('exposes id/isValid/namespace/database from the underlying session', () => {
    const { session } = fakeSession()
    const s = new Session(session)
    assertEquals(s.id, 'sess-1')
    assertEquals(s.isValid, true)
    assertEquals(s.namespace, 'ns')
    assertEquals(s.database, 'db')
  })

  it('getConnection resolves to the underlying session', async () => {
    const { session } = fakeSession()
    const conn = await new Session(session).getConnection()
    assertEquals(conn as unknown as SurrealSession, session)
  })

  it('builds a ReadQL that dispatches against the session', async () => {
    const { session, queries } = fakeSession()
    const s = new Session(session)
    await s.query('users').execute()
    assertEquals(queries.length, 1)
    assertStringIncludes(queries[0].sql, 'SELECT * FROM users')
  })

  it('create/update/merge/upsert/remove return builder instances', () => {
    const { session } = fakeSession()
    const s = new Session(session)
    assert(typeof s.create('t', {}).execute === 'function')
    assert(typeof s.update('t', 'id', {}).execute === 'function')
    assert(typeof s.merge('t', 'id', {}).execute === 'function')
    assert(typeof s.upsert('t', {}).execute === 'function')
    assert(typeof s.remove('t', 'id').execute === 'function')
    assert(typeof s.patch('t', 'id').execute === 'function')
  })

  it('use forwards the namespace/database target', async () => {
    const { session, events } = fakeSession()
    await new Session(session).use({ namespace: 'n2', database: 'd2' })
    assertStringIncludes(events[0], 'use:')
    assertStringIncludes(events[0], 'n2')
  })

  it('signin maps credentials through buildSigninParams', async () => {
    const { session, events } = fakeSession()
    await new Session(session).signin({ type: 'root', username: 'root', password: 'root' })
    assertStringIncludes(events[0], 'signin:')
    assertStringIncludes(events[0], 'root')
  })

  it('forkSession returns a new Session', async () => {
    const { session, events } = fakeSession()
    const forked = await new Session(session).forkSession()
    assert(forked instanceof Session)
    assertEquals(events[0], 'fork')
  })

  it('closeSession disposes the session', async () => {
    const { session, events } = fakeSession()
    const s = new Session(session)
    await s.closeSession()
    assertEquals(events[0], 'close')
    assertEquals(s.isValid, false)
  })
})
