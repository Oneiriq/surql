import { assertEquals } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import {
  canaryDeploy,
  DeploymentStatus,
  parallelDeploy,
  rollingDeploy,
  sequentialDeploy,
} from '../orchestration/strategy.ts'
import type { EnvironmentConfig } from '../orchestration/config.ts'

const makeEnv = (name: string): EnvironmentConfig => ({
  name,
  connection: {
    host: 'localhost',
    port: '8000',
    namespace: 'test',
    database: name,
    username: 'root',
    password: 'root',
  },
})

describe('Deployment Strategies', () => {
  describe('sequentialDeploy', () => {
    it('should deploy to all environments', async () => {
      const envs = [makeEnv('dev'), makeEnv('staging')]
      const deployed: string[] = []
      const results = await sequentialDeploy(envs, async (env) => {
        deployed.push(env.name)
      })
      assertEquals(results.length, 2)
      assertEquals(results.every((r) => r.status === DeploymentStatus.SUCCESS), true)
      assertEquals(deployed, ['dev', 'staging'])
    })

    it('should stop on failure', async () => {
      const envs = [makeEnv('dev'), makeEnv('staging')]
      const results = await sequentialDeploy(envs, async (env) => {
        if (env.name === 'dev') throw new Error('failed')
      })
      assertEquals(results.length, 1)
      assertEquals(results[0].status, DeploymentStatus.FAILED)
    })
  })

  describe('parallelDeploy', () => {
    it('should deploy to all environments in parallel', async () => {
      const envs = [makeEnv('dev'), makeEnv('staging')]
      const results = await parallelDeploy(envs, async () => {})
      assertEquals(results.length, 2)
      assertEquals(results.every((r) => r.status === DeploymentStatus.SUCCESS), true)
    })

    it('should report individual failures', async () => {
      const envs = [makeEnv('dev'), makeEnv('staging')]
      const results = await parallelDeploy(envs, async (env) => {
        if (env.name === 'staging') throw new Error('failed')
      })
      assertEquals(results.find((r) => r.environment === 'dev')?.status, DeploymentStatus.SUCCESS)
      assertEquals(results.find((r) => r.environment === 'staging')?.status, DeploymentStatus.FAILED)
    })
  })

  describe('rollingDeploy', () => {
    it('should deploy in batches', async () => {
      const envs = [makeEnv('a'), makeEnv('b'), makeEnv('c')]
      const order: string[] = []
      const results = await rollingDeploy(envs, async (env) => {
        order.push(env.name)
      }, 2)
      assertEquals(results.length, 3)
      assertEquals(results.every((r) => r.status === DeploymentStatus.SUCCESS), true)
    })

    it('should stop batch on failure', async () => {
      const envs = [makeEnv('a'), makeEnv('b'), makeEnv('c')]
      const results = await rollingDeploy(envs, async (env) => {
        if (env.name === 'a') throw new Error('failed')
      }, 1)
      assertEquals(results.length, 1)
      assertEquals(results[0].status, DeploymentStatus.FAILED)
    })
  })

  describe('canaryDeploy', () => {
    it('should deploy canary first, then rest on success', async () => {
      const envs = [makeEnv('canary'), makeEnv('prod1'), makeEnv('prod2')]
      const order: string[] = []
      const results = await canaryDeploy(
        envs,
        async (env) => {
          order.push(env.name)
        },
        async () => true,
      )
      assertEquals(results.length, 3)
      assertEquals(results.every((r) => r.status === DeploymentStatus.SUCCESS), true)
      assertEquals(order[0], 'canary')
    })

    it('should roll back canary if verification fails', async () => {
      const envs = [makeEnv('canary'), makeEnv('prod')]
      const results = await canaryDeploy(
        envs,
        async () => {},
        async () => false,
      )
      assertEquals(results.length, 1)
      assertEquals(results[0].status, DeploymentStatus.ROLLED_BACK)
      assertEquals(results[0].environment, 'canary')
    })

    it('should stop if canary deployment fails', async () => {
      const envs = [makeEnv('canary'), makeEnv('prod')]
      const results = await canaryDeploy(
        envs,
        async () => {
          throw new Error('canary failed')
        },
        async () => true,
      )
      assertEquals(results.length, 1)
      assertEquals(results[0].status, DeploymentStatus.FAILED)
    })

    it('should return empty for empty environments', async () => {
      const results = await canaryDeploy(
        [],
        async () => {},
        async () => true,
      )
      assertEquals(results.length, 0)
    })

    it('should handle single environment', async () => {
      const envs = [makeEnv('only')]
      const results = await canaryDeploy(
        envs,
        async () => {},
        async () => true,
      )
      assertEquals(results.length, 1)
      assertEquals(results[0].status, DeploymentStatus.SUCCESS)
    })
  })

  describe('DeploymentStatus enum', () => {
    it('should have all expected values', () => {
      assertEquals(DeploymentStatus.PENDING, 'PENDING')
      assertEquals(DeploymentStatus.IN_PROGRESS, 'IN_PROGRESS')
      assertEquals(DeploymentStatus.SUCCESS, 'SUCCESS')
      assertEquals(DeploymentStatus.FAILED, 'FAILED')
      assertEquals(DeploymentStatus.ROLLED_BACK, 'ROLLED_BACK')
    })
  })
})
