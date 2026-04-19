/**
 * `surql orchestrate` subcommands.
 *
 * Deploy migrations across multiple environments with sequential,
 * parallel, rolling, or canary strategies. Environment configuration is
 * loaded from a JSON file whose shape matches `EnvironmentConfig[]`.
 */

import { Command } from '@cliffy/command'
import { error, ExitCode, info, success, table, warning } from './fmt.ts'
import { discoverMigrations, loadMigration } from '../migration/discovery.ts'
import type { Migration } from '../migration/models.ts'
import { configureEnvironments, type EnvironmentConfig, getEnvironmentRegistry } from '../orchestration/config.ts'
import { MigrationCoordinator } from '../orchestration/coordinator.ts'
import { checkEnvironmentHealth } from '../orchestration/health.ts'
import { DeploymentStatus } from '../orchestration/strategy.ts'

interface GlobalOpts {
  config?: string
}

// deno-lint-ignore no-explicit-any
type AnyCommand = Command<any, any, any, any, any>

async function loadEnvironmentsFile(path: string): Promise<EnvironmentConfig[]> {
  let raw: string
  try {
    raw = await Deno.readTextFile(path)
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      error(`Configuration file not found: ${path}`)
      Deno.exit(ExitCode.Failure)
    }
    throw e
  }
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed)) {
    error(`Expected an array in ${path}, got ${typeof parsed}`)
    Deno.exit(ExitCode.Usage)
  }
  return parsed as EnvironmentConfig[]
}

async function loadMigrations(dir: string): Promise<Migration[]> {
  const metadata = await discoverMigrations(dir)
  const out: Migration[] = []
  for (const m of metadata) out.push(await loadMigration(m.filepath))
  return out
}

function parseStrategy(s: string): 'sequential' | 'parallel' | 'rolling' | 'canary' {
  const v = s.toLowerCase()
  if (v === 'sequential' || v === 'parallel' || v === 'rolling' || v === 'canary') return v
  error(`Invalid strategy: ${s}. Must be one of: sequential, parallel, rolling, canary`)
  Deno.exit(ExitCode.Usage)
}

async function cmdDeploy(
  _globals: GlobalOpts,
  opts: {
    environments: string
    strategy?: string
    batchSize?: number
    envConfig?: string
    migrationsDir?: string
    dryRun?: boolean
  },
): Promise<void> {
  const envPath = opts.envConfig ?? 'environments.json'
  const migrationsDir = opts.migrationsDir ?? 'migrations'

  const envConfigs = await loadEnvironmentsFile(envPath)
  info(`Loaded ${envConfigs.length} environment(s) from ${envPath}`)
  configureEnvironments(envConfigs)

  const requestedNames = opts.environments.split(',').map((s) => s.trim()).filter(Boolean)
  const registry = getEnvironmentRegistry()
  const selected: EnvironmentConfig[] = []
  for (const name of requestedNames) {
    const env = registry.get(name)
    if (!env) {
      error(`Environment not found in config: ${name}`)
      Deno.exit(ExitCode.Usage)
    }
    selected.push(env)
  }

  const migrations = await loadMigrations(migrationsDir)
  if (migrations.length === 0) {
    warning('No migrations found')
    return
  }
  info(`Found ${migrations.length} migration(s)`)

  const strategy = parseStrategy(opts.strategy ?? 'sequential')

  if (opts.dryRun) {
    warning('DRY RUN — no deployments will be executed')
    info(`Would deploy ${migrations.length} migration(s) to ${selected.length} environment(s) using ${strategy}`)
    for (const env of selected) info(`  - ${env.name}`)
    return
  }

  const coordinator = new MigrationCoordinator([...migrations])
  info(`Deploying to: ${selected.map((e) => e.name).join(', ')} (${strategy})`)
  const results = await coordinator.deploy({
    environments: selected,
    migrations,
    strategy,
    batchSize: opts.batchSize,
  })

  const rows = results.map((r) => ({
    environment: r.environment,
    status: r.status,
    duration_ms: r.durationMs ?? 0,
    error: r.error ?? '',
  }))
  table(rows)

  const failures = results.filter((r) => r.status === DeploymentStatus.FAILED)
  if (failures.length > 0) {
    error(`Deployment failed on ${failures.length} environment(s)`)
    Deno.exit(ExitCode.Failure)
  }
  success(`Successfully deployed to ${results.length} environment(s)`)
}

async function cmdStatus(
  _globals: GlobalOpts,
  opts: { environments: string; envConfig?: string },
): Promise<void> {
  const envPath = opts.envConfig ?? 'environments.json'
  const envConfigs = await loadEnvironmentsFile(envPath)
  configureEnvironments(envConfigs)

  const requestedNames = opts.environments.split(',').map((s) => s.trim()).filter(Boolean)
  const registry = getEnvironmentRegistry()
  const rows: Record<string, unknown>[] = []
  for (const name of requestedNames) {
    const env = registry.get(name)
    if (!env) {
      rows.push({ environment: name, status: 'unknown' })
      continue
    }
    const status = await checkEnvironmentHealth(env)
    rows.push({
      environment: name,
      status: status.healthy ? 'healthy' : 'unhealthy',
      latency_ms: status.latencyMs,
      error: status.error ?? '',
    })
  }
  table(rows)
}

async function cmdValidate(
  _globals: GlobalOpts,
  opts: { envConfig?: string },
): Promise<void> {
  const envPath = opts.envConfig ?? 'environments.json'
  const envConfigs = await loadEnvironmentsFile(envPath)
  configureEnvironments(envConfigs)
  const registry = getEnvironmentRegistry()
  const envs = registry.getAll()
  if (envs.length === 0) {
    warning('No environments configured')
    return
  }
  info(`Validating ${envs.length} environment(s)`)
  let allHealthy = true
  const rows: Record<string, unknown>[] = []
  for (const env of envs) {
    const status = await checkEnvironmentHealth(env)
    rows.push({
      environment: env.name,
      healthy: status.healthy,
      latency_ms: status.latencyMs,
      error: status.error ?? '',
    })
    if (!status.healthy) allHealthy = false
  }
  table(rows)
  if (allHealthy) success('All environments validated successfully')
  else {
    warning('Some environments failed validation')
    Deno.exit(ExitCode.Failure)
  }
}

export function buildOrchestrateCommand(globals: GlobalOpts): AnyCommand {
  const deploy = new Command()
    .description('Deploy migrations across multiple database environments')
    .option('-e, --environments <list:string>', 'Comma-separated environment names', { required: true })
    .option('--strategy <name:string>', 'Deployment strategy (sequential|parallel|rolling|canary)', {
      default: 'sequential',
    })
    .option('--batch-size <n:integer>', 'Batch size for rolling strategy', { default: 1 })
    .option('--env-config <path:string>', 'Environment configuration file', { default: 'environments.json' })
    .option('-m, --migrations-dir <path:string>', 'Migrations directory', { default: 'migrations' })
    .option('--dry-run', 'Simulate deployment without executing')
    .action(async (opts) => {
      await cmdDeploy(globals, opts)
    })

  const status = new Command()
    .description('Check deployment status of environments')
    .option('-e, --environments <list:string>', 'Comma-separated environment names', { required: true })
    .option('--env-config <path:string>', 'Environment configuration file', { default: 'environments.json' })
    .action(async (opts) => {
      await cmdStatus(globals, opts)
    })

  const validate = new Command()
    .description('Validate environment configuration and connectivity')
    .option('--env-config <path:string>', 'Environment configuration file', { default: 'environments.json' })
    .action(async (opts) => {
      await cmdValidate(globals, opts)
    })

  const cmd = new Command()
    .description('Multi-database orchestration commands')
    .action(function () {
      this.showHelp()
    })
    .command('deploy', deploy)
    .command('status', status)
    .command('validate', validate)

  return cmd as AnyCommand
}
