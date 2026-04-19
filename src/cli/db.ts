/**
 * `surql db` subcommands.
 *
 * Connectivity diagnostics (ping, info, version), initialisation
 * (creating the migration tracking table), destructive reset, and
 * ad-hoc query execution.
 */

import { Command } from '@cliffy/command'
import { error, ExitCode, info, json, panel, success, table, warning } from './fmt.ts'
import { loadCliSettings, resolveConnection, withClient } from './context.ts'
import { createMigrationTable } from '../migration/history.ts'

interface GlobalOpts {
  config?: string
}

// deno-lint-ignore no-explicit-any
type AnyCommand = Command<any, any, any, any, any>

async function cmdInit(globals: GlobalOpts): Promise<void> {
  const config = await resolveConnection(globals.config)
  info(`Connecting to database: ${config.namespace}/${config.database}`)
  await withClient(config, async (_client, db) => {
    info('Creating migration tracking table...')
    await createMigrationTable(db)
    success('Database initialised successfully')
    info('Migration tracking table: _migrations')
  })
}

async function cmdPing(globals: GlobalOpts, opts: { verbose?: boolean }): Promise<void> {
  const config = await resolveConnection(globals.config)
  const protocol = config.protocol ?? 'http'
  info(`Testing connection to ${protocol}://${config.host}:${config.port}`)
  info(`Namespace: ${config.namespace}`)
  info(`Database: ${config.database}`)
  try {
    await withClient(config, async (_client, db) => {
      const result = await db.query('RETURN 1')
      success('Connection successful')
      if (opts.verbose) info(`Query result: ${JSON.stringify(result)}`)
    })
  } catch (e) {
    error(`Connection failed: ${e instanceof Error ? e.message : String(e)}`)
    info('Verify your database is running and configuration is correct')
    Deno.exit(ExitCode.Failure)
  }
}

async function cmdInfo(globals: GlobalOpts, opts: { format?: string }): Promise<void> {
  const settings = await loadCliSettings(globals.config)
  const cfg = settings.database
  const data = {
    environment: settings.environment,
    app_name: settings.appName,
    version: settings.version,
    url: `${cfg.protocol ?? 'http'}://${cfg.host}:${cfg.port}`,
    namespace: cfg.namespace,
    database: cfg.database,
    username: cfg.username || '(none)',
    password: cfg.password ? '***' : '(none)',
    protocol: cfg.protocol ?? 'http',
    use_ssl: cfg.useSSL ?? false,
    migration_path: settings.migrationPath,
  }
  if (opts.format === 'json') {
    json(data)
    return
  }
  const lines = Object.entries(data)
    .map(([k, v]) => `${k.replace(/_/g, ' ').padEnd(18)} ${String(v)}`)
    .join('\n')
  panel('Database Configuration', lines)
  info('Configuration sourced from env vars, .env, and surql.{yaml,toml}')
}

async function cmdReset(globals: GlobalOpts, opts: { yes?: boolean }): Promise<void> {
  const config = await resolveConnection(globals.config)
  warning('='.repeat(60))
  warning('DANGER: Database Reset Operation')
  warning('='.repeat(60))
  warning(`Database: ${config.namespace}/${config.database}`)
  warning('This will DELETE ALL tables and data')
  warning('='.repeat(60))
  if (!opts.yes) {
    const buf = new Uint8Array(16)
    await Deno.stdout.write(new TextEncoder().encode('Type "yes" to confirm: '))
    const n = await Deno.stdin.read(buf)
    const answer = n === null ? '' : new TextDecoder().decode(buf.subarray(0, n)).trim().toLowerCase()
    if (answer !== 'yes') {
      info('Reset cancelled')
      return
    }
  }

  await withClient(config, async (_client, db) => {
    info('Fetching list of tables...')
    const result = (await db.query('INFO FOR DB;')) as unknown
    let tables: string[] = []
    if (Array.isArray(result) && result.length > 0) {
      const row = result[0]
      if (row && typeof row === 'object') {
        const obj = row as Record<string, unknown>
        const tb = (obj.tables ?? obj.tb) as Record<string, unknown> | undefined
        if (tb && typeof tb === 'object') tables = Object.keys(tb)
      }
    }
    if (tables.length === 0) {
      info('No tables found to remove')
      return
    }
    warning(`Found ${tables.length} table(s) to remove`)
    for (const t of tables) {
      await db.query(`REMOVE TABLE ${t};`)
    }
    success(`Successfully removed ${tables.length} table(s)`)
    info('Run "surql db init" to reinitialise migration tracking')
  })
}

async function cmdQuery(
  globals: GlobalOpts,
  query: string,
  opts: { format?: string },
): Promise<void> {
  const config = await resolveConnection(globals.config)
  await withClient(config, async (_client, db) => {
    const result = await db.query(query)
    if (opts.format === 'table' && Array.isArray(result) && result.length > 0 && Array.isArray(result[0])) {
      const rows = result[0] as Record<string, unknown>[]
      if (rows.length > 0 && typeof rows[0] === 'object') {
        table(rows)
        return
      }
    }
    json(result)
  })
}

async function cmdVersion(globals: GlobalOpts, opts: { verbose?: boolean }): Promise<void> {
  const config = await resolveConnection(globals.config)
  info(`Connected to: ${config.protocol ?? 'http'}://${config.host}:${config.port}`)
  info(`Namespace: ${config.namespace}`)
  info(`Database: ${config.database}`)
  try {
    await withClient(config, async (_client, db) => {
      const result = await db.query('INFO FOR DB;')
      success('Database is accessible')
      if (opts.verbose) json(result)
    })
  } catch (e) {
    error(`Connection failed: ${e instanceof Error ? e.message : String(e)}`)
    Deno.exit(ExitCode.Failure)
  }
}

export function buildDbCommand(globals: GlobalOpts): AnyCommand {
  const init = new Command()
    .description('Initialise database and create migration tracking table')
    .action(async () => {
      await cmdInit(globals)
    })

  const ping = new Command()
    .description('Test database connectivity')
    .option('-v, --verbose', 'Show query result')
    .action(async (opts) => {
      await cmdPing(globals, opts)
    })

  const infoCmd = new Command()
    .description('Show database connection information')
    .option('-f, --format <format:string>', 'Output format (text|json)', { default: 'text' })
    .action(async (opts) => {
      await cmdInfo(globals, opts)
    })

  const reset = new Command()
    .description('Reset database by removing all tables (DESTRUCTIVE)')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async (opts) => {
      await cmdReset(globals, opts)
    })

  const query = new Command()
    .description('Execute a raw SurrealQL query')
    .arguments('<query:string>')
    .option('-f, --format <format:string>', 'Output format (table|json)', { default: 'json' })
    .action(async (opts, queryText: string) => {
      await cmdQuery(globals, queryText, opts)
    })

  const version = new Command()
    .description('Show database version information')
    .option('-v, --verbose', 'Print INFO FOR DB result')
    .action(async (opts) => {
      await cmdVersion(globals, opts)
    })

  const cmd = new Command()
    .description('Database utility commands')
    .action(function () {
      this.showHelp()
    })
    .command('init', init)
    .command('ping', ping)
    .command('info', infoCmd)
    .command('reset', reset)
    .command('query', query)
    .command('version', version)

  return cmd as AnyCommand
}
