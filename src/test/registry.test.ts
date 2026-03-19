import { assertEquals, assertThrows } from '@std/assert'
import { afterEach, describe, it } from '@std/testing/bdd'
import { ConnectionRegistry } from '../connection/registry.ts'

const testConfig = {
  host: 'localhost',
  port: '8000',
  namespace: 'test',
  database: 'test',
  username: 'root',
  password: 'root',
}

describe('ConnectionRegistry', () => {
  let registry: ConnectionRegistry

  afterEach(async () => {
    if (registry) {
      await registry.disconnectAll()
    }
  })

  it('should register a connection', () => {
    registry = new ConnectionRegistry()
    registry.register('primary', testConfig)
    assertEquals(registry.has('primary'), true)
    assertEquals(registry.list(), ['primary'])
  })

  it('should set first connection as default', () => {
    registry = new ConnectionRegistry()
    registry.register('primary', testConfig)
    assertEquals(registry.getDefaultName(), 'primary')
  })

  it('should throw on duplicate registration', () => {
    registry = new ConnectionRegistry()
    registry.register('primary', testConfig)
    assertThrows(
      () => registry.register('primary', testConfig),
      Error,
      "Connection 'primary' is already registered",
    )
  })

  it('should get connection by name', () => {
    registry = new ConnectionRegistry()
    const client = registry.register('primary', testConfig)
    assertEquals(registry.get('primary'), client)
  })

  it('should get default connection', () => {
    registry = new ConnectionRegistry()
    const client = registry.register('primary', testConfig)
    assertEquals(registry.get(), client)
  })

  it('should throw when getting unregistered connection', () => {
    registry = new ConnectionRegistry()
    assertThrows(
      () => registry.get('nonexistent'),
      Error,
      "Connection 'nonexistent' not found",
    )
  })

  it('should throw when no default is set', () => {
    registry = new ConnectionRegistry()
    assertThrows(
      () => registry.get(),
      Error,
      'No connection name specified and no default set',
    )
  })

  it('should allow setting default', () => {
    registry = new ConnectionRegistry()
    registry.register('primary', testConfig)
    registry.register('secondary', { ...testConfig, database: 'other' })
    registry.setDefault('secondary')
    assertEquals(registry.getDefaultName(), 'secondary')
  })

  it('should throw when setting default to unregistered', () => {
    registry = new ConnectionRegistry()
    assertThrows(
      () => registry.setDefault('nonexistent'),
      Error,
      "Connection 'nonexistent' not found",
    )
  })

  it('should list all connections', () => {
    registry = new ConnectionRegistry()
    registry.register('a', testConfig)
    registry.register('b', { ...testConfig, database: 'b' })
    assertEquals(registry.list().length, 2)
    assertEquals(registry.list().includes('a'), true)
    assertEquals(registry.list().includes('b'), true)
  })
})
