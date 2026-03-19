import type { ConnectionConfig } from '../auth/connection.ts'

/**
 * Environment configuration
 */
export interface EnvironmentConfig {
  readonly name: string
  readonly connection: ConnectionConfig
  readonly description?: string
  readonly tags?: readonly string[]
}

/**
 * Multi-environment registry
 */
export class EnvironmentRegistry {
  private readonly environments: Map<string, EnvironmentConfig> = new Map()

  register(config: EnvironmentConfig): void {
    this.environments.set(config.name, config)
  }

  get(name: string): EnvironmentConfig | undefined {
    return this.environments.get(name)
  }

  list(): string[] {
    return [...this.environments.keys()]
  }

  getAll(): EnvironmentConfig[] {
    return [...this.environments.values()]
  }

  has(name: string): boolean {
    return this.environments.has(name)
  }

  remove(name: string): boolean {
    return this.environments.delete(name)
  }

  clear(): void {
    this.environments.clear()
  }
}

let _globalRegistry: EnvironmentRegistry | null = null

/** Configure environments from an array */
export function configureEnvironments(envs: EnvironmentConfig[]): EnvironmentRegistry {
  _globalRegistry = new EnvironmentRegistry()
  for (const env of envs) {
    _globalRegistry.register(env)
  }
  return _globalRegistry
}

/** Get the global environment registry */
export function getEnvironmentRegistry(): EnvironmentRegistry {
  if (!_globalRegistry) {
    _globalRegistry = new EnvironmentRegistry()
  }
  return _globalRegistry
}

/** Set a custom environment registry */
export function setEnvironmentRegistry(registry: EnvironmentRegistry): void {
  _globalRegistry = registry
}

/** Register a single environment */
export function registerEnvironment(config: EnvironmentConfig): void {
  getEnvironmentRegistry().register(config)
}
