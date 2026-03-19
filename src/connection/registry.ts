import type { ConnectionConfig } from '../auth/connection.ts'
import { SurQLClient } from '../client.ts'
import { RegistryError } from './errors.ts'

/**
 * Registry entry for a named connection
 */
interface RegistryEntry {
  config: ConnectionConfig
  client: SurQLClient
}

/**
 * Multi-connection registry for managing named database connections.
 * Allows registering, retrieving, and managing multiple SurrealDB connections.
 */
export class ConnectionRegistry {
  private readonly connections: Map<string, RegistryEntry> = new Map()
  private defaultName: string | null = null

  /**
   * Register a named connection
   */
  register(name: string, config: ConnectionConfig): SurQLClient {
    if (this.connections.has(name)) {
      throw new RegistryError(`Connection '${name}' is already registered`)
    }
    const client = new SurQLClient(config)
    this.connections.set(name, { config, client })

    if (this.connections.size === 1) {
      this.defaultName = name
    }

    return client
  }

  /**
   * Get a registered connection by name (or default)
   */
  get(name?: string): SurQLClient {
    const targetName = name ?? this.defaultName
    if (!targetName) {
      throw new RegistryError('No connection name specified and no default set')
    }
    const entry = this.connections.get(targetName)
    if (!entry) {
      throw new RegistryError(`Connection '${targetName}' not found`)
    }
    return entry.client
  }

  /**
   * Set the default connection name
   */
  setDefault(name: string): void {
    if (!this.connections.has(name)) {
      throw new RegistryError(`Connection '${name}' not found`)
    }
    this.defaultName = name
  }

  /**
   * Unregister a named connection
   */
  async unregister(name: string): Promise<void> {
    const entry = this.connections.get(name)
    if (!entry) {
      throw new RegistryError(`Connection '${name}' not found`)
    }
    await entry.client.close()
    this.connections.delete(name)

    if (this.defaultName === name) {
      this.defaultName = this.connections.size > 0 ? this.connections.keys().next().value ?? null : null
    }
  }

  /**
   * List all registered connection names
   */
  list(): string[] {
    return [...this.connections.keys()]
  }

  /**
   * Get the default connection name
   */
  getDefaultName(): string | null {
    return this.defaultName
  }

  /**
   * Check if a connection name is registered
   */
  has(name: string): boolean {
    return this.connections.has(name)
  }

  /**
   * Disconnect and remove all registered connections
   */
  async disconnectAll(): Promise<void> {
    const entries = [...this.connections.entries()]
    for (const [name, entry] of entries) {
      try {
        await entry.client.close()
      } catch {
        // Best-effort cleanup
      }
      this.connections.delete(name)
    }
    this.defaultName = null
  }
}
