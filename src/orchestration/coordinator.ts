import type { Migration } from '../migration/models.ts'
import { migrateUp } from '../migration/executor.ts'
import { SurQLClient } from '../client.ts'
import type { EnvironmentConfig } from './config.ts'
import { checkEnvironmentHealth, type HealthStatus } from './health.ts'
import {
  canaryDeploy,
  type DeployFn,
  type DeploymentResult,
  parallelDeploy,
  rollingDeploy,
  sequentialDeploy,
} from './strategy.ts'

/**
 * Deployment plan
 */
export interface DeploymentPlan {
  readonly environments: readonly EnvironmentConfig[]
  readonly migrations: readonly Migration[]
  readonly strategy: 'sequential' | 'parallel' | 'rolling' | 'canary'
  readonly batchSize?: number
}

/**
 * Orchestration error
 */
export class OrchestrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OrchestrationError'
  }
}

/**
 * Coordinate migrations across multiple environments
 */
export class MigrationCoordinator {
  private readonly migrations: Migration[]

  constructor(migrations: Migration[]) {
    this.migrations = migrations
  }

  /**
   * Deploy migrations to environments according to a plan
   */
  async deploy(plan: DeploymentPlan): Promise<DeploymentResult[]> {
    const deployFn: DeployFn = async (env: EnvironmentConfig) => {
      const client = new SurQLClient(env.connection)
      try {
        const db = await client.getConnection()
        await migrateUp(db, this.migrations)
      } finally {
        await client.close()
      }
    }

    switch (plan.strategy) {
      case 'sequential':
        return sequentialDeploy([...plan.environments], deployFn)
      case 'parallel':
        return parallelDeploy([...plan.environments], deployFn)
      case 'rolling':
        return rollingDeploy([...plan.environments], deployFn, plan.batchSize ?? 1)
      case 'canary':
        return canaryDeploy(
          [...plan.environments],
          deployFn,
          async (env) => {
            const health = await checkEnvironmentHealth(env)
            return health.healthy
          },
        )
      default:
        throw new OrchestrationError(`Unknown strategy: ${plan.strategy}`)
    }
  }

  /**
   * Check health of all environments
   */
  async checkHealth(environments: EnvironmentConfig[]): Promise<HealthStatus[]> {
    const results: HealthStatus[] = []
    for (const env of environments) {
      results.push(await checkEnvironmentHealth(env))
    }
    return results
  }
}

/**
 * Deploy migrations to multiple environments
 */
export async function deployToEnvironments(
  plan: DeploymentPlan,
): Promise<DeploymentResult[]> {
  const coordinator = new MigrationCoordinator([...plan.migrations])
  return coordinator.deploy(plan)
}
