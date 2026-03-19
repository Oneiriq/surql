import { assertEquals } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { checkEnvironmentHealth, verifyConnectivity } from '../orchestration/health.ts'
import type { EnvironmentConfig } from '../orchestration/config.ts'

const makeEnv = (name: string, host = 'localhost', port = '8000'): EnvironmentConfig => ({
  name,
  connection: {
    host,
    port,
    namespace: 'test',
    database: name,
    username: 'root',
    password: 'root',
  },
})

describe('checkEnvironmentHealth', () => {
  it('should return unhealthy status for unreachable host', async () => {
    const config = makeEnv('bad', '192.0.2.1', '19999')
    const result = await checkEnvironmentHealth(config)
    assertEquals(result.environment, 'bad')
    assertEquals(result.healthy, false)
    assertEquals(typeof result.latencyMs, 'number')
    assertEquals(typeof result.error, 'string')
  })

  it('should include environment name in result', async () => {
    const config = makeEnv('test_env', '192.0.2.1', '19999')
    const result = await checkEnvironmentHealth(config)
    assertEquals(result.environment, 'test_env')
  })

  it('should have latency >= 0', async () => {
    const config = makeEnv('latency_test', '192.0.2.1', '19999')
    const result = await checkEnvironmentHealth(config)
    assertEquals(result.latencyMs >= 0, true)
  })
})

describe('verifyConnectivity', () => {
  it('should check all environments', async () => {
    const configs = [
      makeEnv('env1', '192.0.2.1', '19999'),
      makeEnv('env2', '192.0.2.2', '19999'),
    ]
    const results = await verifyConnectivity(configs)
    assertEquals(results.length, 2)
    assertEquals(results[0].environment, 'env1')
    assertEquals(results[1].environment, 'env2')
  })

  it('should return empty array for empty configs', async () => {
    const results = await verifyConnectivity([])
    assertEquals(results.length, 0)
  })
})
