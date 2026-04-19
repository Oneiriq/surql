/**
 * Shared context helpers for CLI commands.
 *
 * Loads settings (with --config override), resolves connection config,
 * constructs a SurQLClient, and exposes a tiny dispose pattern.
 */

import { SurQLClient } from '../client.ts'
import { loadSettings, type Settings } from '../settings.ts'
import type { ConnectionConfig } from '../auth/connection.ts'
import type { Surreal } from 'surrealdb'

/**
 * Load settings, honouring an explicit `--config <path>` override. The
 * override is interpreted by pointing {@link loadSettings} at the
 * containing directory so the standard resolution chain still runs.
 */
export async function loadCliSettings(configPath?: string): Promise<Settings> {
  if (!configPath) return loadSettings()
  // When the caller supplied a config file, resolve relative paths and
  // hand loadSettings the containing directory so it picks up the file
  // via its normal resolution chain. This keeps behaviour consistent
  // with the env+yaml+toml precedence in settings.ts.
  const abs = configPath.startsWith('/') ? configPath : `${Deno.cwd()}/${configPath}`
  const dir = abs.includes('/') ? abs.slice(0, abs.lastIndexOf('/')) : '.'
  return loadSettings({ cwd: dir })
}

/**
 * Resolve a {@link ConnectionConfig} from settings (honouring
 * --config override).
 */
export async function resolveConnection(configPath?: string): Promise<ConnectionConfig> {
  const settings = await loadCliSettings(configPath)
  return settings.database
}

/**
 * Resolve the migrations directory from settings.
 */
export async function resolveMigrationsDir(
  explicit: string | undefined,
  configPath?: string,
): Promise<string> {
  if (explicit) return explicit
  const settings = await loadCliSettings(configPath)
  return settings.migrationPath
}

/**
 * Open a client, run `fn`, then close the client. Errors from `fn` are
 * propagated; close errors are swallowed so the primary error surfaces
 * cleanly to the CLI.
 */
export async function withClient<T>(
  config: ConnectionConfig,
  fn: (client: SurQLClient, db: Surreal) => Promise<T>,
): Promise<T> {
  const client = new SurQLClient(config)
  try {
    const db = await client.getConnection()
    return await fn(client, db)
  } finally {
    try {
      await client.close()
    } catch {
      // Ignore close errors — the primary error has already surfaced.
    }
  }
}
