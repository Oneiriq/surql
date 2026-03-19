import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { LiveQuery, StreamingManager } from '../connection/streaming.ts'
import { StreamingError } from '../connection/errors.ts'
import type { LiveQueryNotification } from '../connection/streaming.ts'

function makeMockDb() {
  const queries: string[] = []
  return {
    queries,
    query: (sql: string) => {
      queries.push(sql)
      return Promise.resolve([])
    },
  }
}

describe('LiveQuery', () => {
  it('should store queryUuid and table', () => {
    // deno-lint-ignore no-explicit-any
    const lq = new LiveQuery('uuid-123', 'users', makeMockDb() as any)
    assertEquals(lq.queryUuid, 'uuid-123')
    assertEquals(lq.table, 'users')
  })

  it('should start as active', () => {
    // deno-lint-ignore no-explicit-any
    const lq = new LiveQuery('uuid-123', 'users', makeMockDb() as any)
    assertEquals(lq.active, true)
  })

  describe('subscribe', () => {
    it('should add a callback', () => {
      // deno-lint-ignore no-explicit-any
      const lq = new LiveQuery('uuid-123', 'users', makeMockDb() as any)
      const notifications: LiveQueryNotification[] = []
      lq.subscribe((n) => notifications.push(n))
      lq.notify({ action: 'CREATE', result: { id: '1' } })
      assertEquals(notifications.length, 1)
      assertEquals(notifications[0].action, 'CREATE')
    })

    it('should throw when subscribing to killed query', async () => {
      const db = makeMockDb()
      // deno-lint-ignore no-explicit-any
      const lq = new LiveQuery('uuid-123', 'users', db as any)
      await lq.kill()
      assertThrows(
        () => lq.subscribe(() => {}),
        Error,
        'Cannot subscribe to killed live query',
      )
    })
  })

  describe('unsubscribe', () => {
    it('should remove a callback', () => {
      // deno-lint-ignore no-explicit-any
      const lq = new LiveQuery('uuid-123', 'users', makeMockDb() as any)
      const notifications: LiveQueryNotification[] = []
      const cb = (n: LiveQueryNotification) => notifications.push(n)
      lq.subscribe(cb)
      lq.unsubscribe(cb)
      lq.notify({ action: 'CREATE', result: { id: '1' } })
      assertEquals(notifications.length, 0)
    })
  })

  describe('notify', () => {
    it('should call all subscribers', () => {
      // deno-lint-ignore no-explicit-any
      const lq = new LiveQuery('uuid-123', 'users', makeMockDb() as any)
      let count = 0
      lq.subscribe(() => count++)
      lq.subscribe(() => count++)
      lq.notify({ action: 'UPDATE', result: { id: '1' } })
      assertEquals(count, 2)
    })

    it('should swallow callback errors without breaking other subscribers', () => {
      // deno-lint-ignore no-explicit-any
      const lq = new LiveQuery('uuid-123', 'users', makeMockDb() as any)
      let secondCalled = false
      lq.subscribe(() => {
        throw new Error('callback error')
      })
      lq.subscribe(() => {
        secondCalled = true
      })
      lq.notify({ action: 'DELETE', result: { id: '1' } })
      assertEquals(secondCalled, true)
    })
  })

  describe('kill', () => {
    it('should mark query as inactive', async () => {
      const db = makeMockDb()
      // deno-lint-ignore no-explicit-any
      const lq = new LiveQuery('uuid-123', 'users', db as any)
      assertEquals(lq.active, true)
      await lq.kill()
      assertEquals(lq.active, false)
    })

    it('should send KILL query to database', async () => {
      const db = makeMockDb()
      // deno-lint-ignore no-explicit-any
      const lq = new LiveQuery('uuid-123', 'users', db as any)
      await lq.kill()
      assertEquals(db.queries.length, 1)
      assertEquals(db.queries[0], "KILL 'uuid-123'")
    })

    it('should clear all callbacks on kill', async () => {
      const db = makeMockDb()
      // deno-lint-ignore no-explicit-any
      const lq = new LiveQuery('uuid-123', 'users', db as any)
      let callCount = 0
      lq.subscribe(() => callCount++)
      await lq.kill()
      lq.notify({ action: 'CREATE', result: { id: '1' } })
      assertEquals(callCount, 0)
    })

    it('should be idempotent (no-op if already killed)', async () => {
      const db = makeMockDb()
      // deno-lint-ignore no-explicit-any
      const lq = new LiveQuery('uuid-123', 'users', db as any)
      await lq.kill()
      await lq.kill()
      assertEquals(db.queries.length, 1)
    })
  })
})

function makeStreamingMockDb() {
  let liveCallCount = 0
  const queries: string[] = []
  return {
    queries,
    // deno-lint-ignore no-explicit-any
    live: (_table: any) => {
      liveCallCount++
      return Promise.resolve(`uuid-${liveCallCount}`)
    },
    query: (sql: string) => {
      queries.push(sql)
      return Promise.resolve([])
    },
  }
}

describe('StreamingManager', () => {
  it('should start with size 0', () => {
    // deno-lint-ignore no-explicit-any
    const mgr = new StreamingManager(makeMockDb() as any)
    assertEquals(mgr.size, 0)
  })

  it('should start with empty list', () => {
    // deno-lint-ignore no-explicit-any
    const mgr = new StreamingManager(makeMockDb() as any)
    assertEquals(mgr.list().length, 0)
  })

  describe('live', () => {
    it('should create a live query and track it', async () => {
      // deno-lint-ignore no-explicit-any
      const mgr = new StreamingManager(makeStreamingMockDb() as any)
      const lq = await mgr.live('users')
      assertEquals(mgr.size, 1)
      assertEquals(lq.table, 'users')
      assertEquals(lq.active, true)
    })

    it('should create multiple live queries', async () => {
      // deno-lint-ignore no-explicit-any
      const mgr = new StreamingManager(makeStreamingMockDb() as any)
      await mgr.live('users')
      await mgr.live('posts')
      assertEquals(mgr.size, 2)
      assertEquals(mgr.list().length, 2)
    })
  })

  describe('kill', () => {
    it('should kill a tracked live query', async () => {
      // deno-lint-ignore no-explicit-any
      const mgr = new StreamingManager(makeStreamingMockDb() as any)
      const lq = await mgr.live('users')
      assertEquals(mgr.size, 1)
      await mgr.kill(lq.queryUuid)
      assertEquals(mgr.size, 0)
      assertEquals(lq.active, false)
    })

    it('should throw StreamingError for unknown query uuid', async () => {
      // deno-lint-ignore no-explicit-any
      const mgr = new StreamingManager(makeMockDb() as any)
      await assertRejects(
        () => mgr.kill('nonexistent-uuid'),
        StreamingError,
        'not found',
      )
    })
  })

  describe('killAll', () => {
    it('should kill all tracked live queries', async () => {
      // deno-lint-ignore no-explicit-any
      const mgr = new StreamingManager(makeStreamingMockDb() as any)
      const lq1 = await mgr.live('users')
      const lq2 = await mgr.live('posts')
      assertEquals(mgr.size, 2)
      await mgr.killAll()
      assertEquals(mgr.size, 0)
      assertEquals(lq1.active, false)
      assertEquals(lq2.active, false)
    })

    it('should handle empty manager', async () => {
      // deno-lint-ignore no-explicit-any
      const mgr = new StreamingManager(makeMockDb() as any)
      await mgr.killAll()
      assertEquals(mgr.size, 0)
    })
  })
})
