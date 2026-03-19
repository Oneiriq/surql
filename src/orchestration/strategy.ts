import type { EnvironmentConfig } from './config.ts'

/**
 * Deployment status
 */
export enum DeploymentStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  ROLLED_BACK = 'ROLLED_BACK',
}

/**
 * Result from deploying to a single environment
 */
export interface DeploymentResult {
  readonly environment: string
  readonly status: DeploymentStatus
  readonly error?: string
  readonly durationMs: number
}

/**
 * Deploy function signature
 */
export type DeployFn = (env: EnvironmentConfig) => Promise<void>

/**
 * Execute deployments sequentially
 */
export async function sequentialDeploy(
  environments: EnvironmentConfig[],
  deploy: DeployFn,
): Promise<DeploymentResult[]> {
  const results: DeploymentResult[] = []

  for (const env of environments) {
    const start = Date.now()
    try {
      await deploy(env)
      results.push({
        environment: env.name,
        status: DeploymentStatus.SUCCESS,
        durationMs: Date.now() - start,
      })
    } catch (e) {
      results.push({
        environment: env.name,
        status: DeploymentStatus.FAILED,
        error: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - start,
      })
      break // Stop on failure in sequential mode
    }
  }

  return results
}

/**
 * Execute deployments in parallel
 */
export async function parallelDeploy(
  environments: EnvironmentConfig[],
  deploy: DeployFn,
): Promise<DeploymentResult[]> {
  const promises = environments.map(async (env) => {
    const start = Date.now()
    try {
      await deploy(env)
      return {
        environment: env.name,
        status: DeploymentStatus.SUCCESS,
        durationMs: Date.now() - start,
      } satisfies DeploymentResult
    } catch (e) {
      return {
        environment: env.name,
        status: DeploymentStatus.FAILED,
        error: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - start,
      } satisfies DeploymentResult
    }
  })

  return Promise.all(promises)
}

/**
 * Rolling deployment (batch by batch)
 */
export async function rollingDeploy(
  environments: EnvironmentConfig[],
  deploy: DeployFn,
  batchSize: number = 1,
): Promise<DeploymentResult[]> {
  const results: DeploymentResult[] = []

  for (let i = 0; i < environments.length; i += batchSize) {
    const batch = environments.slice(i, i + batchSize)
    const batchResults = await parallelDeploy(batch, deploy)
    results.push(...batchResults)

    const hasFailed = batchResults.some((r) => r.status === DeploymentStatus.FAILED)
    if (hasFailed) break
  }

  return results
}

/**
 * Canary deployment (deploy to first, verify, then rest)
 */
export async function canaryDeploy(
  environments: EnvironmentConfig[],
  deploy: DeployFn,
  verify: (env: EnvironmentConfig) => Promise<boolean>,
): Promise<DeploymentResult[]> {
  if (environments.length === 0) return []

  const results: DeploymentResult[] = []

  // Deploy canary
  const canary = environments[0]
  const start = Date.now()
  try {
    await deploy(canary)
    results.push({
      environment: canary.name,
      status: DeploymentStatus.SUCCESS,
      durationMs: Date.now() - start,
    })
  } catch (e) {
    results.push({
      environment: canary.name,
      status: DeploymentStatus.FAILED,
      error: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - start,
    })
    return results
  }

  // Verify canary
  const healthy = await verify(canary)
  if (!healthy) {
    results[0] = { ...results[0], status: DeploymentStatus.ROLLED_BACK }
    return results
  }

  // Deploy rest
  const remaining = environments.slice(1)
  const restResults = await parallelDeploy(remaining, deploy)
  results.push(...restResults)

  return results
}
