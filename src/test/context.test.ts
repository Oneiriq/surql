import { assertEquals, assertThrows } from '@std/assert'
import { afterEach, describe, it } from '@std/testing/bdd'
import { clearDb, connectionOverride, getDb, hasDb, setDb } from '../connection/context.ts'

describe('connection context', () => {
  afterEach(() => {
    clearDb()
  })

  describe('getDb()', () => {
    it('should throw when no client is set', () => {
      assertThrows(() => getDb(), Error, 'No database client in context')
    })

    it('should return the client after setDb()', () => {
      const mockClient = { close: () => Promise.resolve() }
      // deno-lint-ignore no-explicit-any
      setDb(mockClient as any)
      assertEquals(getDb(), mockClient)
    })
  })

  describe('hasDb()', () => {
    it('should return false when no client is set', () => {
      assertEquals(hasDb(), false)
    })

    it('should return true after setDb()', () => {
      // deno-lint-ignore no-explicit-any
      setDb({} as any)
      assertEquals(hasDb(), true)
    })
  })

  describe('clearDb()', () => {
    it('should clear the client', () => {
      // deno-lint-ignore no-explicit-any
      setDb({} as any)
      assertEquals(hasDb(), true)
      clearDb()
      assertEquals(hasDb(), false)
    })
  })

  describe('connectionOverride()', () => {
    it('should temporarily override the client', async () => {
      const original = { id: 'original', close: () => Promise.resolve() }
      const override = { id: 'override', close: () => Promise.resolve() }
      // deno-lint-ignore no-explicit-any
      setDb(original as any)
      // deno-lint-ignore no-explicit-any
      const disposable = connectionOverride(override as any)
      // deno-lint-ignore no-explicit-any
      assertEquals((getDb() as any).id, 'override')
      await disposable[Symbol.asyncDispose]()
      // deno-lint-ignore no-explicit-any
      assertEquals((getDb() as any).id, 'original')
    })

    it('should restore null when no previous client', async () => {
      const override = { id: 'temp', close: () => Promise.resolve() }
      // deno-lint-ignore no-explicit-any
      const disposable = connectionOverride(override as any)
      assertEquals(hasDb(), true)
      await disposable[Symbol.asyncDispose]()
      assertEquals(hasDb(), false)
    })
  })
})
