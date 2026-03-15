import { Surreal } from 'surrealdb'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { stub } from '@std/testing/mock'
import { type ConnectionConfig, SurrealConnectionManager } from '../auth/connection.ts'

const testConfig: ConnectionConfig = {
  host: Deno.env.get('SURQL_TEST_HOST') || 'localhost',
  port: Deno.env.get('SURQL_TEST_PORT') || '8000',
  namespace: Deno.env.get('SURQL_TEST_NAMESPACE') || 'test',
  database: Deno.env.get('SURQL_TEST_DATABASE') || 'test',
  username: Deno.env.get('SURQL_TEST_USERNAME') || 'testuser',
  password: Deno.env.get('SURQL_TEST_PASSWORD') || 'testpass',
}

function makeJwt(expSeconds: number = Math.floor(Date.now() / 1000) + 3600): string {
  const header = btoa(JSON.stringify({ typ: 'JWT', alg: 'HS256' }))
  const payload = btoa(JSON.stringify({ exp: expSeconds, ID: 'test' }))
  return `${header}.${payload}.signature`
}

// v2 signin returns Tokens { access, refresh? }
function makeTokens(expSeconds?: number) {
  return { access: makeJwt(expSeconds) }
}

// v2 prototype stubs: method signatures changed, so we cast the method name
// to bypass strict overload checking in @std/testing/mock
function stubSignin(expSeconds?: number) {
  const proto = Surreal.prototype
  // deno-lint-ignore no-explicit-any
  return stub(proto, 'signin' as any, () => Promise.resolve(makeTokens(expSeconds)))
}

function stubUse() {
  const proto = Surreal.prototype
  // deno-lint-ignore no-explicit-any
  return stub(proto, 'use' as any, () => Promise.resolve({ namespace: 'test', database: 'test' }))
}

describe('SurrealConnectionManager', () => {
  describe('constructor', () => {
    it('should create a new connection manager instance', () => {
      const manager = new SurrealConnectionManager(testConfig)
      assert(manager instanceof SurrealConnectionManager)
    })
  })

  describe('getConnection()', () => {
    it('should establish connection and return Surreal instance', async () => {
      const connectStub = stub(Surreal.prototype, 'connect', () => Promise.resolve(true as const))
      const signinStub = stubSignin()
      const useStub = stubUse()

      try {
        const manager = new SurrealConnectionManager(testConfig)
        const connection = await manager.getConnection()
        assert(connection instanceof Surreal)
      } finally {
        connectStub.restore()
        signinStub.restore()
        useStub.restore()
      }
    })

    it('should reuse existing connection', async () => {
      const connectStub = stub(Surreal.prototype, 'connect', () => Promise.resolve(true as const))
      const futureExp = Math.floor(Date.now() / 1000) + (10 * 365 * 24 * 60 * 60)
      const signinStub = stubSignin(futureExp)
      const useStub = stubUse()

      try {
        const manager = new SurrealConnectionManager(testConfig)

        const connection1 = await manager.getConnection()
        const connection2 = await manager.getConnection()

        assertEquals(connection1, connection2)
        assertEquals(connectStub.calls.length, 1)
      } finally {
        connectStub.restore()
        signinStub.restore()
        useStub.restore()
      }
    })

    it('should handle connection errors', async () => {
      const connectStub = stub(Surreal.prototype, 'connect', () => Promise.reject(new Error('Connection failed')))

      try {
        const manager = new SurrealConnectionManager(testConfig)

        await assertRejects(
          () => manager.getConnection(),
          Error,
          'Connection failed',
        )
      } finally {
        connectStub.restore()
      }
    })

    it('should handle authentication errors', async () => {
      const connectStub = stub(Surreal.prototype, 'connect', () => Promise.resolve(true as const))
      // deno-lint-ignore no-explicit-any
      const signinStub = stub(Surreal.prototype, 'signin' as any, () => Promise.reject(new Error('Auth failed')))

      try {
        const manager = new SurrealConnectionManager(testConfig)

        await assertRejects(
          () => manager.getConnection(),
          Error,
          'Auth failed',
        )
      } finally {
        connectStub.restore()
        signinStub.restore()
      }
    })

    it('should handle database selection errors', async () => {
      const connectStub = stub(Surreal.prototype, 'connect', () => Promise.resolve(true as const))
      const signinStub = stubSignin()
      // deno-lint-ignore no-explicit-any
      const useStub = stub(Surreal.prototype, 'use' as any, () => Promise.reject(new Error('Database not found')))

      try {
        const invalidConfig = { ...testConfig, database: 'nonexistent' }
        const manager = new SurrealConnectionManager(invalidConfig)

        await assertRejects(
          () => manager.getConnection(),
          Error,
          'Database not found',
        )
      } finally {
        connectStub.restore()
        signinStub.restore()
        useStub.restore()
      }
    })

    it('should handle concurrent connection requests', async () => {
      const connectStub = stub(Surreal.prototype, 'connect', () => Promise.resolve(true as const))
      const signinStub = stubSignin()
      const useStub = stubUse()

      try {
        const manager = new SurrealConnectionManager(testConfig)

        const promises = [
          manager.getConnection(),
          manager.getConnection(),
          manager.getConnection(),
        ]

        const connections = await Promise.all(promises)

        assertEquals(connections[0], connections[1])
        assertEquals(connections[1], connections[2])
        assertEquals(connectStub.calls.length, 1)
      } finally {
        connectStub.restore()
        signinStub.restore()
        useStub.restore()
      }
    })
  })

  describe('close()', () => {
    it('should close existing connection', async () => {
      const connectStub = stub(Surreal.prototype, 'connect', () => Promise.resolve(true as const))
      const signinStub = stubSignin()
      const useStub = stubUse()
      const closeStub = stub(Surreal.prototype, 'close', () => Promise.resolve(true as const))

      try {
        const manager = new SurrealConnectionManager(testConfig)
        await manager.getConnection()
        await manager.close()

        assertEquals(closeStub.calls.length, 1)
      } finally {
        connectStub.restore()
        signinStub.restore()
        useStub.restore()
        closeStub.restore()
      }
    })

    it('should handle closing when no connection exists', async () => {
      const manager = new SurrealConnectionManager(testConfig)
      await manager.close()
      assert(true)
    })

    it('should handle close errors gracefully', async () => {
      const connectStub = stub(Surreal.prototype, 'connect', () => Promise.resolve(true as const))
      const signinStub = stubSignin()
      const useStub = stubUse()
      const closeStub = stub(Surreal.prototype, 'close', () => Promise.reject(new Error('Close failed')))

      try {
        const manager = new SurrealConnectionManager(testConfig)
        await manager.getConnection()

        await assertRejects(
          () => manager.close(),
          Error,
          'Close failed',
        )
      } finally {
        connectStub.restore()
        signinStub.restore()
        useStub.restore()
        closeStub.restore()
      }
    })
  })

  describe('connection configuration', () => {
    it('should use provided host and port', () => {
      const customConfig: ConnectionConfig = {
        host: 'custom-host',
        port: '9000',
        namespace: 'custom-ns',
        database: 'custom-db',
        username: 'custom-user',
        password: 'custom-pass',
      }

      const manager = new SurrealConnectionManager(customConfig)
      assert(manager instanceof SurrealConnectionManager)
    })

    it('should use provided namespace and database', async () => {
      const connectStub = stub(Surreal.prototype, 'connect', () => Promise.resolve(true as const))
      const signinStub = stubSignin()
      const useStub = stubUse()

      try {
        const customConfig: ConnectionConfig = {
          ...testConfig,
          namespace: 'production',
          database: 'main',
        }

        const manager = new SurrealConnectionManager(customConfig)
        await manager.getConnection()

        assertEquals(useStub.calls.length, 1)
        assertEquals(useStub.calls[0].args[0], {
          namespace: 'production',
          database: 'main',
        })
      } finally {
        connectStub.restore()
        signinStub.restore()
        useStub.restore()
      }
    })

    it('should use provided credentials', async () => {
      const connectStub = stub(Surreal.prototype, 'connect', () => Promise.resolve(true as const))
      const signinStub = stubSignin()
      const useStub = stubUse()

      try {
        const customConfig: ConnectionConfig = {
          ...testConfig,
          username: 'admin',
          password: 'secret123',
        }

        const manager = new SurrealConnectionManager(customConfig)
        await manager.getConnection()

        assertEquals(signinStub.calls.length, 1)
        assertEquals(signinStub.calls[0].args[0], {
          username: 'admin',
          password: 'secret123',
        })
      } finally {
        connectStub.restore()
        signinStub.restore()
        useStub.restore()
      }
    })
  })

  describe('error handling', () => {
    it('should throw SurrealError for connection failures', async () => {
      const connectStub = stub(Surreal.prototype, 'connect', () => Promise.reject(new Error('Network error')))

      try {
        const manager = new SurrealConnectionManager(testConfig)

        await assertRejects(
          () => manager.getConnection(),
          Error,
          'Connection failed',
        )
      } finally {
        connectStub.restore()
      }
    })

    it('should throw SurrealError for authentication failures', async () => {
      const connectStub = stub(Surreal.prototype, 'connect', () => Promise.resolve(true as const))
      const proto = Surreal.prototype
      // deno-lint-ignore no-explicit-any
      const signinStub = stub(proto, 'signin' as any, () => Promise.reject(new Error('Invalid credentials')))

      try {
        const manager = new SurrealConnectionManager(testConfig)

        await assertRejects(
          () => manager.getConnection(),
          Error,
          'Connection failed',
        )
      } finally {
        connectStub.restore()
        signinStub.restore()
      }
    })

    it('should throw SurrealError for close failures', async () => {
      const connectStub = stub(Surreal.prototype, 'connect', () => Promise.resolve(true as const))
      const signinStub = stubSignin()
      const useStub = stubUse()
      const closeStub = stub(Surreal.prototype, 'close', () => Promise.reject(new Error('Close error')))

      try {
        const manager = new SurrealConnectionManager(testConfig)
        await manager.getConnection()

        await assertRejects(
          () => manager.close(),
          Error,
          'Failed to close connection',
        )
      } finally {
        connectStub.restore()
        signinStub.restore()
        useStub.restore()
        closeStub.restore()
      }
    })
  })
})
