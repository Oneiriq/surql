/**
 * Application settings loader for surql.
 *
 * Settings are resolved from multiple sources, in priority order (first wins):
 *
 * 1. Explicit arguments passed to `loadSettings({ ... })`
 * 2. `SURQL_*` environment variables (read via `Deno.env.get`)
 * 3. `.env` file in the current working directory
 * 4. Project-root config file: `surql.yaml` / `surql.yml` / `surql.toml`
 * 5. Built-in defaults
 *
 * This is a 1:1 port of surql-py's `surql.settings` with the Python-specific
 * `pyproject.toml [tool.surql]` source replaced by a standalone
 * `surql.yaml` / `surql.toml` file (py's config lives in a Python-project
 * file, which has no TS analogue).
 */

import { parse as parseToml } from '@std/toml'
import { parse as parseYaml } from '@std/yaml'
import type { ConnectionConfig } from './auth/connection.ts'

/**
 * Application environment.
 */
export type Environment = 'development' | 'staging' | 'production'

/**
 * Logging level.
 */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL'

/**
 * Fully-resolved surql settings.
 *
 * Values come from explicit arguments, environment variables, a `.env`
 * file, or a `surql.yaml` / `surql.toml` config file (in that priority
 * order). All fields are required on the resolved value — defaults fill
 * any gaps.
 */
export interface Settings {
  readonly environment: Environment
  readonly debug: boolean
  readonly logLevel: LogLevel
  readonly appName: string
  readonly version: string
  readonly migrationPath: string
  readonly database: ConnectionConfig
}

/**
 * Partial overrides accepted by {@link loadSettings}. Any subset of
 * `Settings` may be supplied; omitted fields fall through to the next
 * source.
 */
export type SettingsOverrides = {
  -readonly [K in keyof Settings]?: K extends 'database' ? Partial<ConnectionConfig> : Settings[K]
}

const ENV_PREFIX = 'SURQL_'

const DEFAULTS: Settings = {
  environment: 'development',
  debug: true,
  logLevel: 'INFO',
  appName: 'surql',
  version: '0.6.0',
  migrationPath: 'migrations',
  database: {
    host: '127.0.0.1',
    port: '8000',
    namespace: 'test',
    database: 'test',
    username: 'root',
    password: 'root',
  },
}

/**
 * Raw key/value map produced by one of the configuration sources.
 * Values are intentionally `unknown` because YAML / TOML / env all parse
 * to different shapes; the merge layer coerces them.
 */
type RawSource = Record<string, unknown>

const ENVIRONMENTS: readonly Environment[] = ['development', 'staging', 'production']
const LOG_LEVELS: readonly LogLevel[] = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']

function parseBoolean(raw: string): boolean | undefined {
  const v = raw.trim().toLowerCase()
  if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false
  return undefined
}

function parseEnvValue(value: string): unknown {
  const trimmed = value.trim()
  const bool = parseBoolean(trimmed)
  if (bool !== undefined) return bool
  // Keep version strings ('1.0.0') as strings even though they look numeric-ish.
  return trimmed
}

/**
 * Read `SURQL_*` keys from `Deno.env` and map them into the nested
 * settings shape.
 */
function collectEnv(): RawSource {
  const env = Deno.env.toObject()
  const out: RawSource = {}
  const database: Record<string, unknown> = {}

  for (const [key, rawValue] of Object.entries(env)) {
    if (!key.startsWith(ENV_PREFIX)) continue
    const rest = key.slice(ENV_PREFIX.length).toLowerCase()
    const parsed = parseEnvValue(rawValue)

    switch (rest) {
      case 'environment':
        out.environment = parsed
        break
      case 'debug':
        out.debug = parsed
        break
      case 'log_level':
      case 'loglevel':
        out.logLevel = parsed
        break
      case 'app_name':
      case 'appname':
        out.appName = parsed
        break
      case 'version':
        out.version = parsed
        break
      case 'migration_path':
      case 'migrationpath':
        out.migrationPath = parsed
        break
      case 'db_host':
      case 'host':
        database.host = parsed
        break
      case 'db_port':
      case 'port':
        database.port = typeof parsed === 'string' ? parsed : String(parsed)
        break
      case 'db_namespace':
      case 'namespace':
        database.namespace = parsed
        break
      case 'db_database':
      case 'database':
        database.database = parsed
        break
      case 'db_username':
      case 'username':
        database.username = parsed
        break
      case 'db_password':
      case 'password':
        database.password = parsed
        break
      case 'db_protocol':
      case 'protocol':
        database.protocol = parsed
        break
      case 'db_path':
        database.path = parsed
        break
      case 'db_use_ssl':
      case 'use_ssl':
        database.useSSL = parsed
        break
      default:
        // Unknown keys are ignored (matches py's `extra='ignore'`).
        break
    }
  }

  if (Object.keys(database).length > 0) out.database = database
  return out
}

/**
 * Read a `.env` file if present in the current working directory and
 * return its `SURQL_*` subset in the normalised nested shape.
 */
async function collectDotenv(cwd: string): Promise<RawSource> {
  const path = `${cwd}/.env`
  let text: string
  try {
    text = await Deno.readTextFile(path)
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return {}
    throw e
  }

  const parsed: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const eq = line.indexOf('=')
    if (eq === -1) continue

    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()

    // Strip matching surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    parsed[key] = value
  }

  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(parsed)) {
    if (k.startsWith(ENV_PREFIX)) env[k] = v
  }

  // Reuse the env parser by temporarily overlaying the values.
  const out: RawSource = {}
  const database: Record<string, unknown> = {}

  for (const [key, rawValue] of Object.entries(env)) {
    const rest = key.slice(ENV_PREFIX.length).toLowerCase()
    const value = parseEnvValue(rawValue)

    switch (rest) {
      case 'environment':
        out.environment = value
        break
      case 'debug':
        out.debug = value
        break
      case 'log_level':
      case 'loglevel':
        out.logLevel = value
        break
      case 'app_name':
      case 'appname':
        out.appName = value
        break
      case 'version':
        out.version = value
        break
      case 'migration_path':
      case 'migrationpath':
        out.migrationPath = value
        break
      case 'db_host':
      case 'host':
        database.host = value
        break
      case 'db_port':
      case 'port':
        database.port = typeof value === 'string' ? value : String(value)
        break
      case 'db_namespace':
      case 'namespace':
        database.namespace = value
        break
      case 'db_database':
      case 'database':
        database.database = value
        break
      case 'db_username':
      case 'username':
        database.username = value
        break
      case 'db_password':
      case 'password':
        database.password = value
        break
      case 'db_protocol':
      case 'protocol':
        database.protocol = value
        break
      case 'db_path':
        database.path = value
        break
      case 'db_use_ssl':
      case 'use_ssl':
        database.useSSL = value
        break
      default:
        break
    }
  }

  if (Object.keys(database).length > 0) out.database = database
  return out
}

/**
 * Read `surql.yaml`, `surql.yml`, or `surql.toml` from the given
 * directory. The first one found wins. The parsed document is expected
 * to use the same nested shape as {@link Settings}.
 */
async function collectFileConfig(cwd: string): Promise<RawSource> {
  const candidates: Array<{ path: string; kind: 'yaml' | 'toml' }> = [
    { path: `${cwd}/surql.yaml`, kind: 'yaml' },
    { path: `${cwd}/surql.yml`, kind: 'yaml' },
    { path: `${cwd}/surql.toml`, kind: 'toml' },
  ]

  for (const { path, kind } of candidates) {
    let text: string
    try {
      text = await Deno.readTextFile(path)
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) continue
      throw e
    }

    try {
      const parsed = kind === 'yaml' ? parseYaml(text) : parseToml(text)
      if (parsed && typeof parsed === 'object') {
        return parsed as RawSource
      }
    } catch {
      // Malformed config — treat as no-config; downstream error surfaces
      // via the usual validation path when/if a consumer references it.
      return {}
    }
  }

  return {}
}

function pickEnvironment(v: unknown): Environment | undefined {
  if (typeof v === 'string' && (ENVIRONMENTS as readonly string[]).includes(v)) {
    return v as Environment
  }
  return undefined
}

function pickLogLevel(v: unknown): LogLevel | undefined {
  if (typeof v === 'string') {
    const upper = v.toUpperCase()
    if ((LOG_LEVELS as readonly string[]).includes(upper)) return upper as LogLevel
  }
  return undefined
}

function pickString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function pickBoolean(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') return parseBoolean(v)
  return undefined
}

function pickDatabase(v: unknown): Partial<ConnectionConfig> | undefined {
  if (!v || typeof v !== 'object') return undefined
  const src = v as Record<string, unknown>
  const out: Partial<ConnectionConfig> = {}

  if (typeof src.host === 'string') out.host = src.host
  if (typeof src.port === 'string') out.port = src.port
  else if (typeof src.port === 'number') out.port = String(src.port)
  if (typeof src.namespace === 'string') out.namespace = src.namespace
  if (typeof src.database === 'string') out.database = src.database
  if (typeof src.username === 'string') out.username = src.username
  if (typeof src.password === 'string') out.password = src.password
  if (typeof src.path === 'string') out.path = src.path
  if (typeof src.useSSL === 'boolean') out.useSSL = src.useSSL
  else if (typeof src.useSSL === 'string') {
    const b = parseBoolean(src.useSSL)
    if (b !== undefined) out.useSSL = b
  }
  if (typeof src.protocol === 'string') {
    out.protocol = src.protocol as ConnectionConfig['protocol']
  }

  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Merge a single source into the accumulator, preferring existing
 * (higher-priority) values. Database sub-fields are merged field-wise
 * rather than replaced whole-cloth.
 */
function mergeSource(accum: SettingsOverrides, source: RawSource): SettingsOverrides {
  const merged: SettingsOverrides = { ...accum }

  if (merged.environment === undefined) {
    const v = pickEnvironment(source.environment)
    if (v !== undefined) merged.environment = v
  }
  if (merged.debug === undefined) {
    const v = pickBoolean(source.debug)
    if (v !== undefined) merged.debug = v
  }
  if (merged.logLevel === undefined) {
    const v = pickLogLevel(source.logLevel ?? source.log_level)
    if (v !== undefined) merged.logLevel = v
  }
  if (merged.appName === undefined) {
    const v = pickString(source.appName ?? source.app_name)
    if (v !== undefined) merged.appName = v
  }
  if (merged.version === undefined) {
    const v = pickString(source.version)
    if (v !== undefined) merged.version = v
  }
  if (merged.migrationPath === undefined) {
    const v = pickString(source.migrationPath ?? source.migration_path)
    if (v !== undefined) merged.migrationPath = v
  }

  const dbSource = pickDatabase(source.database)
  if (dbSource) {
    merged.database = { ...dbSource, ...(merged.database ?? {}) }
  }

  return merged
}

/**
 * Fold an override stack down to a fully-resolved {@link Settings} by
 * filling any remaining holes with {@link DEFAULTS}.
 */
function finalise(overrides: SettingsOverrides): Settings {
  return {
    environment: overrides.environment ?? DEFAULTS.environment,
    debug: overrides.debug ?? DEFAULTS.debug,
    logLevel: overrides.logLevel ?? DEFAULTS.logLevel,
    appName: overrides.appName ?? DEFAULTS.appName,
    version: overrides.version ?? DEFAULTS.version,
    migrationPath: overrides.migrationPath ?? DEFAULTS.migrationPath,
    database: {
      ...DEFAULTS.database,
      ...(overrides.database ?? {}),
    },
  }
}

/**
 * Normalise an `SettingsOverrides` object passed by the caller into a
 * `RawSource`, so the explicit layer merges through the same
 * predicate-based pipeline as env / .env / file.
 */
function overridesAsSource(o: SettingsOverrides | undefined): RawSource {
  if (!o) return {}
  const out: RawSource = { ...o }
  if (o.database) out.database = o.database
  return out
}

/**
 * Options accepted by {@link loadSettings}.
 */
export interface LoadSettingsOptions extends SettingsOverrides {
  /**
   * Directory used to resolve `.env` and `surql.yaml` / `surql.toml`.
   * Defaults to `Deno.cwd()`.
   */
  cwd?: string
}

/**
 * Load and resolve surql settings.
 *
 * Sources are merged in the following priority order (first wins):
 *
 * 1. Explicit fields on `opts`
 * 2. `SURQL_*` environment variables
 * 3. `.env` file in `opts.cwd ?? Deno.cwd()`
 * 4. `surql.yaml` / `surql.yml` / `surql.toml` in `opts.cwd ?? Deno.cwd()`
 * 5. Built-in defaults
 *
 * Requires `--allow-env` for env reads and `--allow-read` for file reads.
 *
 * @example
 * ```ts
 * const settings = await loadSettings({ environment: 'production' })
 * ```
 */
export async function loadSettings(opts: LoadSettingsOptions = {}): Promise<Settings> {
  const { cwd, ...overrides } = opts
  const root = cwd ?? Deno.cwd()

  let stack: SettingsOverrides = {}
  stack = mergeSource(stack, overridesAsSource(overrides))
  stack = mergeSource(stack, collectEnv())
  stack = mergeSource(stack, await collectDotenv(root))
  stack = mergeSource(stack, await collectFileConfig(root))

  return finalise(stack)
}

let _cached: Settings | undefined
let _cachedPromise: Promise<Settings> | undefined

/**
 * Return a lazily-initialised {@link Settings} instance.
 *
 * The first call resolves from all sources using {@link loadSettings}
 * with no explicit overrides. Subsequent calls return the cached value
 * synchronously. Use {@link clearSettingsCache} in tests to force a
 * reload.
 */
export async function getSettings(): Promise<Settings> {
  if (_cached) return _cached
  if (!_cachedPromise) {
    _cachedPromise = loadSettings().then((s) => {
      _cached = s
      return s
    })
  }
  return _cachedPromise
}

/**
 * Clear the {@link getSettings} / {@link getDbConfig} / {@link getMigrationPath}
 * cache. Primarily intended for use in tests.
 */
export function clearSettingsCache(): void {
  _cached = undefined
  _cachedPromise = undefined
}

/**
 * Convenience accessor for the resolved database configuration.
 */
export async function getDbConfig(): Promise<ConnectionConfig> {
  const settings = await getSettings()
  return settings.database
}

/**
 * Convenience accessor for the resolved migrations directory.
 */
export async function getMigrationPath(): Promise<string> {
  const settings = await getSettings()
  return settings.migrationPath
}
