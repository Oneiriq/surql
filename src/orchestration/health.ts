import { Surreal } from 'surrealdb'
import type { EnvironmentConfig } from './config.ts'

/**
 * Health check configuration
 */
export interface HealthCheck {
  readonly environment: string
  readonly timeout: number
  readonly retries: number
}

/**
 * Health check status
 */
export interface HealthStatus {
  readonly environment: string
  readonly healthy: boolean
  readonly latencyMs: number
  readonly error?: string
}

/**
 * Check the health of an environment
 */
export async function checkEnvironmentHealth(config: EnvironmentConfig): Promise<HealthStatus> {
  const start = Date.now()
  const db = new Surreal()

  try {
    const conn = config.connection
    const protocol = conn.protocol ?? (conn.useSSL ? 'https' : 'http')
    const endpoint = `${protocol}://${conn.host}:${conn.port}/rpc`

    await db.connect(endpoint)

    if (conn.username && conn.password) {
      await db.signin({ username: conn.username, password: conn.password })
    }

    await db.use({ namespace: conn.namespace, database: conn.database })
    await db.query('RETURN true')

    const latency = Date.now() - start
    await db.close()

    return { environment: config.name, healthy: true, latencyMs: latency }
  } catch (e) {
    const latency = Date.now() - start
    try {
      await db.close()
    } catch {
      // Ignore close errors
    }
    return {
      environment: config.name,
      healthy: false,
      latencyMs: latency,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * Check connectivity for multiple environments
 */
export async function verifyConnectivity(
  configs: EnvironmentConfig[],
): Promise<HealthStatus[]> {
  const results: HealthStatus[] = []
  for (const config of configs) {
    results.push(await checkEnvironmentHealth(config))
  }
  return results
}
