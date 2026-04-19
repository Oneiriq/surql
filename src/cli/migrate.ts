/**
 * `surql migrate` subcommands.
 *
 * Thin wrappers around the migration module. Every command accepts a
 * `--config <path>` override forwarded into the settings loader.
 */

import { Command } from '@cliffy/command'
import { error, ExitCode, info, json, muted, success, table, warning } from './fmt.ts'
import { resolveConnection, resolveMigrationsDir, withClient } from './context.ts'
import {
  createBlankMigration,
  createMigrationPlan,
  discoverMigrations,
  ensureMigrationTable,
  executeMigrationPlan,
  getAppliedMigrations,
  getAppliedVersions,
  loadMigration,
  type Migration,
  MigrationDirection,
  MigrationState,
  SquashError,
  squashMigrations,
  validateMigrationName,
  validateMigrations,
} from '../migration/mod.ts'

interface GlobalOpts {
  config?: string
}

// deno-lint-ignore no-explicit-any
type AnyCommand = Command<any, any, any, any, any>

async function loadMigrations(dir: string): Promise<Migration[]> {
  const metadata = await discoverMigrations(dir)
  const migrations: Migration[] = []
  for (const m of metadata) {
    migrations.push(await loadMigration(m.filepath))
  }
  return migrations
}

async function cmdUp(
  globals: GlobalOpts,
  opts: { directory?: string; steps?: number; dryRun?: boolean },
): Promise<void> {
  const dir = await resolveMigrationsDir(opts.directory, globals.config)
  info(`Discovering migrations in ${dir}`)
  const migrations = await loadMigrations(dir)
  if (migrations.length === 0) {
    warning('No migration files found')
    return
  }
  const errors = validateMigrations(migrations)
  if (errors.length > 0) {
    error('Migration validation failed:')
    for (const err of errors) error(`  - ${err}`)
    Deno.exit(ExitCode.Failure)
  }

  const config = await resolveConnection(globals.config)
  await withClient(config, async (_client, db) => {
    await ensureMigrationTable(db)
    const applied = await getAppliedVersions(db)
    let plan = createMigrationPlan(migrations, applied, MigrationDirection.UP)
    if (opts.steps !== undefined) {
      plan = { ...plan, migrations: plan.migrations.slice(0, opts.steps) }
    }
    if (plan.migrations.length === 0) {
      success('All migrations are already applied')
      return
    }
    info(`Found ${plan.migrations.length} pending migration(s):`)
    for (const m of plan.migrations) info(`  - ${m.version}: ${m.description}`)
    if (opts.dryRun) {
      warning('Dry run mode — no changes will be made')
      for (const m of plan.migrations) {
        const sql = await m.up()
        muted(`-- ${m.version}: ${m.description}`)
        muted(sql)
      }
      return
    }
    await executeMigrationPlan(db, plan)
    success(`Successfully applied ${plan.migrations.length} migration(s)`)
  })
}

async function cmdDown(
  globals: GlobalOpts,
  opts: { directory?: string; steps: number; dryRun?: boolean; yes?: boolean },
): Promise<void> {
  const dir = await resolveMigrationsDir(opts.directory, globals.config)
  const migrations = await loadMigrations(dir)
  if (migrations.length === 0) {
    warning('No migration files found')
    return
  }

  const config = await resolveConnection(globals.config)
  await withClient(config, async (_client, db) => {
    await ensureMigrationTable(db)
    const applied = await getAppliedVersions(db)
    let plan = createMigrationPlan(migrations, applied, MigrationDirection.DOWN)
    plan = { ...plan, migrations: plan.migrations.slice(0, opts.steps) }
    if (plan.migrations.length === 0) {
      warning('No migrations to rollback')
      return
    }
    warning(`Will rollback ${plan.migrations.length} migration(s):`)
    for (const m of plan.migrations) warning(`  - ${m.version}: ${m.description}`)
    if (opts.dryRun) {
      warning('Dry run mode — no changes will be made')
      for (const m of plan.migrations) {
        const sql = await m.down()
        muted(`-- Rollback: ${m.version}`)
        muted(sql)
      }
      return
    }
    if (!opts.yes && !(await confirmDestructive('Rollback migrations?'))) {
      info('Rollback cancelled')
      return
    }
    await executeMigrationPlan(db, plan)
    success(`Successfully rolled back ${plan.migrations.length} migration(s)`)
  })
}

async function cmdStatus(
  globals: GlobalOpts,
  opts: { directory?: string; format?: string },
): Promise<void> {
  const dir = await resolveMigrationsDir(opts.directory, globals.config)
  const metadata = await discoverMigrations(dir)
  if (metadata.length === 0) {
    warning('No migration files found')
    return
  }
  const config = await resolveConnection(globals.config)
  await withClient(config, async (_client, db) => {
    await ensureMigrationTable(db)
    const applied = await getAppliedVersions(db)
    const rows = metadata.map((m) => ({
      version: m.version,
      description: m.description,
      status: applied.has(m.version) ? MigrationState.APPLIED : MigrationState.PENDING,
      file: m.filename,
    }))
    if (opts.format === 'json') json(rows)
    else table(rows)
    const appliedCount = rows.filter((r) => r.status === MigrationState.APPLIED).length
    info(
      `Total: ${rows.length} | Applied: ${appliedCount} | Pending: ${rows.length - appliedCount}`,
    )
  })
}

async function cmdHistory(
  globals: GlobalOpts,
  opts: { format?: string },
): Promise<void> {
  const config = await resolveConnection(globals.config)
  await withClient(config, async (_client, db) => {
    await ensureMigrationTable(db)
    const history = await getAppliedMigrations(db)
    if (history.length === 0) {
      info('No migrations have been applied yet')
      return
    }
    const rows = history.map((h) => ({
      version: h.version,
      description: h.description,
      applied_at: h.appliedAt.toISOString(),
      direction: h.direction,
    }))
    if (opts.format === 'json') json(rows)
    else table(rows)
  })
}

async function cmdCreate(
  globals: GlobalOpts,
  description: string,
  opts: { directory?: string },
): Promise<void> {
  const dir = await resolveMigrationsDir(opts.directory, globals.config)
  await Deno.mkdir(dir, { recursive: true }).catch((e) => {
    if (!(e instanceof Deno.errors.AlreadyExists)) throw e
  })
  const blank = createBlankMigration(description)
  const path = `${dir}/${blank.filename}`
  await Deno.writeTextFile(path, blank.content)
  success(`Created migration: ${blank.filename}`)
  info(`Path: ${path}`)
  info('Edit the file to add your migration SQL')
}

async function cmdValidate(
  globals: GlobalOpts,
  opts: { directory?: string },
): Promise<void> {
  const dir = await resolveMigrationsDir(opts.directory, globals.config)
  info(`Validating migrations in ${dir}`)
  const entries: Deno.DirEntry[] = []
  try {
    for await (const e of Deno.readDir(dir)) entries.push(e)
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      error('Migrations directory does not exist')
      Deno.exit(ExitCode.Failure)
    }
    throw e
  }
  const files = entries.filter(
    (e) => e.isFile && (e.name.endsWith('.surql') || e.name.endsWith('.ts')),
  )
  if (files.length === 0) {
    warning('No migration files found')
    return
  }
  const invalid = files.filter((f) => !validateMigrationName(f.name)).map((f) => f.name)
  if (invalid.length > 0) {
    error('Invalid migration filenames:')
    for (const name of invalid) error(`  - ${name}`)
    info('Expected format: YYYYMMDDHHMMSS_description.{surql,ts}')
    Deno.exit(ExitCode.Failure)
  }
  const migrations = await loadMigrations(dir)
  const errors = validateMigrations(migrations)
  if (errors.length > 0) {
    error('Validation errors:')
    for (const err of errors) error(`  - ${err}`)
    Deno.exit(ExitCode.Failure)
  }
  success(`All ${migrations.length} migration(s) are valid`)
}

async function cmdGenerate(
  globals: GlobalOpts,
  description: string,
  opts: { directory?: string },
): Promise<void> {
  warning('Auto-generation from schema not yet implemented in the TS port')
  info('Creating a blank migration instead...')
  await cmdCreate(globals, description, opts)
}

async function cmdSquash(
  _globals: GlobalOpts,
  opts: {
    migrations?: string
    output?: string
    from?: string
    to?: string
    dryRun?: boolean
    keepOriginals?: boolean
    force?: boolean
    description?: string
  },
): Promise<void> {
  const dir = opts.migrations ?? 'migrations'
  try {
    const result = await squashMigrations(dir, opts.from, opts.to, {
      outputPath: opts.output,
      dryRun: opts.dryRun,
      description: opts.description,
    })
    if (opts.dryRun) {
      warning('Dry run — no files written')
      info(`Would write ${result.squashedPath}`)
      info(`Version: ${result.version}`)
      info(`Checksum: sha256:${result.checksum.slice(0, 16)}...`)
      info(`Squashed ${result.originalCount} migrations into ${result.statementCount} statements`)
      return
    }
    success(`Squashed ${result.originalCount} migrations into ${result.squashedPath}`)
    info(`New version: ${result.version}`)
    info(`Checksum: sha256:${result.checksum.slice(0, 16)}...`)
    if (!opts.keepOriginals && !opts.force) {
      muted('Tip: rerun with --force to delete the originals')
    }
    if (opts.force && !opts.keepOriginals) {
      const originalMetadata = await discoverMigrations(dir)
      for (const m of originalMetadata) {
        if (result.originalVersions.includes(m.version)) {
          try {
            await Deno.remove(m.filepath)
            muted(`Removed ${m.filename}`)
          } catch (e) {
            warning(
              `Failed to remove ${m.filename}: ${e instanceof Error ? e.message : String(e)}`,
            )
          }
        }
      }
    }
  } catch (e) {
    if (e instanceof SquashError) {
      error(e.message)
      Deno.exit(ExitCode.Failure)
    }
    throw e
  }
}

async function confirmDestructive(message: string): Promise<boolean> {
  warning(message)
  warning('This action cannot be undone!')
  const buf = new Uint8Array(16)
  await Deno.stdout.write(new TextEncoder().encode('Type "yes" to confirm: '))
  const n = await Deno.stdin.read(buf)
  if (n === null) return false
  const answer = new TextDecoder().decode(buf.subarray(0, n)).trim().toLowerCase()
  return answer === 'yes'
}

export function buildMigrateCommand(globals: GlobalOpts): AnyCommand {
  const up = new Command()
    .description('Apply pending migrations')
    .option('-d, --directory <dir:string>', 'Migrations directory')
    .option('-n, --steps <count:integer>', 'Number of migrations to apply (default: all)')
    .option('--dry-run', 'Preview changes without applying')
    .action(async (opts) => {
      await cmdUp(globals, opts)
    })

  const down = new Command()
    .description('Rollback applied migrations')
    .option('-d, --directory <dir:string>', 'Migrations directory')
    .option('-n, --steps <count:integer>', 'Number of migrations to rollback', { default: 1 })
    .option('--dry-run', 'Preview rollback without executing')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async (opts) => {
      await cmdDown(
        globals,
        opts as { directory?: string; steps: number; dryRun?: boolean; yes?: boolean },
      )
    })

  const status = new Command()
    .description('Show migration status')
    .option('-d, --directory <dir:string>', 'Migrations directory')
    .option('-f, --format <format:string>', 'Output format (table|json)', { default: 'table' })
    .action(async (opts) => {
      await cmdStatus(globals, opts)
    })

  const history = new Command()
    .description('Show migration history from database')
    .option('-f, --format <format:string>', 'Output format (table|json)', { default: 'table' })
    .action(async (opts) => {
      await cmdHistory(globals, opts)
    })

  const create = new Command()
    .description('Create a new blank migration file')
    .arguments('<description:string>')
    .option('-d, --directory <dir:string>', 'Migrations directory')
    .action(async (opts, description: string) => {
      await cmdCreate(globals, description, opts)
    })

  const validate = new Command()
    .description('Validate migration files')
    .option('-d, --directory <dir:string>', 'Migrations directory')
    .action(async (opts) => {
      await cmdValidate(globals, opts)
    })

  const generate = new Command()
    .description('Generate migration from schema changes')
    .arguments('<description:string>')
    .option('-d, --directory <dir:string>', 'Migrations directory')
    .action(async (opts, description: string) => {
      await cmdGenerate(globals, description, opts)
    })

  const squash = new Command()
    .description('Squash multiple migrations into a single file')
    .option('-m, --migrations <dir:string>', 'Migrations directory', { default: 'migrations' })
    .option('-o, --output <path:string>', 'Output file path (auto-generated if omitted)')
    .option('--from <version:string>', 'Start version (inclusive)')
    .option('--to <version:string>', 'End version (inclusive)')
    .option('--dry-run', 'Preview without writing')
    .option('--keep-originals', 'Keep original migration files')
    .option('--force', 'Proceed without extra safety checks')
    .option('--description <text:string>', 'Description for the squashed migration')
    .action(async (opts) => {
      await cmdSquash(globals, opts)
    })

  const cmd = new Command()
    .description('Database migration commands')
    .action(function () {
      this.showHelp()
    })
    .command('up', up)
    .command('down', down)
    .command('status', status)
    .command('history', history)
    .command('create', create)
    .command('validate', validate)
    .command('generate', generate)
    .command('squash', squash)

  return cmd as AnyCommand
}
