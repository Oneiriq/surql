import { assertEquals } from '@std/assert'
import { afterEach, describe, it } from '@std/testing/bdd'
import {
  configureEnvironments,
  EnvironmentRegistry,
  getEnvironmentRegistry,
  registerEnvironment,
  setEnvironmentRegistry,
} from '../orchestration/config.ts'
import type { EnvironmentConfig } from '../orchestration/config.ts'

function makeEnvConfig(name: string): EnvironmentConfig {
  return {
    name,
    connection: {
      host: 'localhost',
      port: '8000',
      namespace: 'test',
      database: name,
      username: 'root',
      password: 'root',
    },
  }
}

// Reset global state between tests
afterEach(() => {
  setEnvironmentRegistry(new EnvironmentRegistry())
})

describe('setEnvironmentRegistry', () => {
  it('should replace the global registry', () => {
    const custom = new EnvironmentRegistry()
    custom.register(makeEnvConfig('staging'))

    setEnvironmentRegistry(custom)
    const reg = getEnvironmentRegistry()

    assertEquals(reg.has('staging'), true)
    assertEquals(reg.list(), ['staging'])
  })

  it('should completely replace previous registry', () => {
    const first = new EnvironmentRegistry()
    first.register(makeEnvConfig('dev'))
    setEnvironmentRegistry(first)
    assertEquals(getEnvironmentRegistry().has('dev'), true)

    const second = new EnvironmentRegistry()
    second.register(makeEnvConfig('prod'))
    setEnvironmentRegistry(second)

    assertEquals(getEnvironmentRegistry().has('dev'), false)
    assertEquals(getEnvironmentRegistry().has('prod'), true)
  })

  it('should allow empty registry', () => {
    const empty = new EnvironmentRegistry()
    setEnvironmentRegistry(empty)
    assertEquals(getEnvironmentRegistry().list(), [])
  })
})

describe('EnvironmentRegistry', () => {
  it('should register and retrieve environments', () => {
    const reg = new EnvironmentRegistry()
    const config = makeEnvConfig('dev')
    reg.register(config)

    assertEquals(reg.get('dev')?.name, 'dev')
    assertEquals(reg.has('dev'), true)
    assertEquals(reg.has('prod'), false)
  })

  it('should list registered environment names', () => {
    const reg = new EnvironmentRegistry()
    reg.register(makeEnvConfig('dev'))
    reg.register(makeEnvConfig('staging'))
    reg.register(makeEnvConfig('prod'))

    const names = reg.list()
    assertEquals(names.length, 3)
    assertEquals(names.includes('dev'), true)
    assertEquals(names.includes('staging'), true)
    assertEquals(names.includes('prod'), true)
  })

  it('should return all configs with getAll', () => {
    const reg = new EnvironmentRegistry()
    reg.register(makeEnvConfig('dev'))
    reg.register(makeEnvConfig('prod'))

    const all = reg.getAll()
    assertEquals(all.length, 2)
  })

  it('should remove an environment', () => {
    const reg = new EnvironmentRegistry()
    reg.register(makeEnvConfig('dev'))
    assertEquals(reg.has('dev'), true)

    const removed = reg.remove('dev')
    assertEquals(removed, true)
    assertEquals(reg.has('dev'), false)
  })

  it('should return false when removing non-existent', () => {
    const reg = new EnvironmentRegistry()
    assertEquals(reg.remove('nonexistent'), false)
  })

  it('should clear all environments', () => {
    const reg = new EnvironmentRegistry()
    reg.register(makeEnvConfig('dev'))
    reg.register(makeEnvConfig('prod'))
    assertEquals(reg.list().length, 2)

    reg.clear()
    assertEquals(reg.list().length, 0)
  })

  it('should return undefined for unknown environment', () => {
    const reg = new EnvironmentRegistry()
    assertEquals(reg.get('unknown'), undefined)
  })

  it('should overwrite existing environment on re-register', () => {
    const reg = new EnvironmentRegistry()
    reg.register({ ...makeEnvConfig('dev'), description: 'old' })
    reg.register({ ...makeEnvConfig('dev'), description: 'new' })

    assertEquals(reg.get('dev')?.description, 'new')
    assertEquals(reg.list().length, 1)
  })
})

describe('configureEnvironments', () => {
  it('should configure multiple environments at once', () => {
    const envs = [makeEnvConfig('dev'), makeEnvConfig('staging'), makeEnvConfig('prod')]
    const reg = configureEnvironments(envs)

    assertEquals(reg.list().length, 3)
    assertEquals(reg.has('dev'), true)
    assertEquals(reg.has('staging'), true)
    assertEquals(reg.has('prod'), true)
  })

  it('should set the global registry', () => {
    configureEnvironments([makeEnvConfig('custom')])
    assertEquals(getEnvironmentRegistry().has('custom'), true)
  })

  it('should replace previous global configuration', () => {
    configureEnvironments([makeEnvConfig('old')])
    configureEnvironments([makeEnvConfig('new')])

    assertEquals(getEnvironmentRegistry().has('old'), false)
    assertEquals(getEnvironmentRegistry().has('new'), true)
  })
})

describe('registerEnvironment', () => {
  it('should register to the global registry', () => {
    registerEnvironment(makeEnvConfig('global_dev'))
    assertEquals(getEnvironmentRegistry().has('global_dev'), true)
  })

  it('should accumulate registrations', () => {
    registerEnvironment(makeEnvConfig('a'))
    registerEnvironment(makeEnvConfig('b'))
    const reg = getEnvironmentRegistry()
    assertEquals(reg.has('a'), true)
    assertEquals(reg.has('b'), true)
  })
})
