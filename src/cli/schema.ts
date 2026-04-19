/**
 * `surql schema` subcommands.
 *
 * Inspect, compare, export, validate, and visualise schemas. All
 * live-database commands honour `--config` via the shared context
 * helpers; file-only commands (visualize, hook-config) are pure.
 */

import { Command } from '@cliffy/command'
import { error, ExitCode, info, json, panel, success, table, warning } from './fmt.ts'
import { resolveConnection, withClient } from './context.ts'
import { fetchDbInfo, fetchTableInfo } from '../schema/parser.ts'
import { generateAscii, generateGraphViz, generateMermaid } from '../schema/visualize.ts'
import { validateSchema } from '../schema/validator.ts'
import type { EdgeDefinition } from '../schema/edge.ts'
import type { TableDefinition } from '../schema/table.ts'
import { checkSchemaDrift, defaultSchemaFilter, generatePrecommitConfig } from '../migration/hooks.ts'
import { watchSchema } from '../migration/watcher.ts'
import { deserializeSnapshot } from '../migration/versioning.ts'

interface GlobalOpts {
  config?: string
}

// deno-lint-ignore no-explicit-any
type AnyCommand = Command<any, any, any, any, any>

async function cmdShow(
  globals: GlobalOpts,
  tableName: string | undefined,
  opts: { format?: string },
): Promise<void> {
  const config = await resolveConnection(globals.config)
  await withClient(config, async (_client, db) => {
    if (tableName) {
      info(`Fetching schema for table: ${tableName}`)
      const tdef = await fetchTableInfo(db, tableName)
      if (opts.format === 'json') json(tdef)
      else panel(`Table: ${tableName}`, JSON.stringify(tdef, null, 2))
    } else {
      info('Fetching database schema')
      const dbInfo = await fetchDbInfo(db)
      if (opts.format === 'json') json(dbInfo)
      else panel('Database Schema', JSON.stringify(dbInfo, null, 2))
    }
  })
}

async function loadSchemaFile(path: string): Promise<{
  tables: TableDefinition[]
  edges: EdgeDefinition[]
}> {
  if (path.endsWith('.json')) {
    const raw = await Deno.readTextFile(path)
    const snap = deserializeSnapshot(raw)
    return { tables: [...snap.tables], edges: [...snap.edges] }
  }
  error(`Schema file format not supported: ${path}`)
  info('Supported: JSON snapshot files produced by serializeSnapshot()')
  Deno.exit(ExitCode.Usage)
}

async function cmdDiff(
  globals: GlobalOpts,
  opts: { schema?: string; format?: string },
): Promise<void> {
  if (!opts.schema) {
    error('--schema <path> is required')
    Deno.exit(ExitCode.Usage)
  }
  const { tables: fileTables } = await loadSchemaFile(opts.schema)
  const config = await resolveConnection(globals.config)
  await withClient(config, async (_client, db) => {
    const dbInfo = await fetchDbInfo(db)
    const dbTableNames = new Set(Object.keys(dbInfo.tables))
    const fileTableNames = new Set(fileTables.map((t) => t.name))
    const added = [...fileTableNames].filter((n) => !dbTableNames.has(n))
    const removed = [...dbTableNames].filter((n) => !fileTableNames.has(n))
    const common = [...fileTableNames].filter((n) => dbTableNames.has(n))
    const summary = { added, removed, common_count: common.length }
    if (opts.format === 'json') {
      json(summary)
    } else {
      if (added.length > 0) {
        info('Tables to add:')
        for (const t of added) info(`  + ${t}`)
      }
      if (removed.length > 0) {
        warning('Tables only in database:')
        for (const t of removed) warning(`  - ${t}`)
      }
      if (added.length === 0 && removed.length === 0) success('No table-level differences')
    }
  })
}

function cmdGenerate(): void {
  warning('schema generate requires the structured parser (see umbrella #12)')
  info('For now, use `surql migrate create` and hand-edit the migration')
}

function cmdSync(): void {
  warning('Schema sync not recommended — use migrations instead')
  info('Use `surql schema generate` to create a migration from schema diff')
  info('Then use `surql migrate up` to apply changes safely')
}

async function cmdExport(
  globals: GlobalOpts,
  opts: { output?: string; tableName?: string; format?: string },
): Promise<void> {
  const config = await resolveConnection(globals.config)
  await withClient(config, async (_client, db) => {
    let content: string
    if (opts.tableName) {
      const tdef = await fetchTableInfo(db, opts.tableName)
      content = JSON.stringify(tdef, null, 2)
    } else {
      const dbInfo = await fetchDbInfo(db)
      content = JSON.stringify(dbInfo, null, 2)
    }
    if (opts.output) {
      await Deno.writeTextFile(opts.output, content)
      success(`Schema exported to: ${opts.output}`)
    } else {
      console.log(content)
    }
  })
}

async function cmdTables(
  globals: GlobalOpts,
  opts: { format?: string },
): Promise<void> {
  const config = await resolveConnection(globals.config)
  await withClient(config, async (_client, db) => {
    const dbInfo = await fetchDbInfo(db)
    const rows: Record<string, unknown>[] = [
      ...Object.values(dbInfo.tables).map((t) => ({ name: t.name, kind: 'table', mode: t.mode })),
      ...Object.values(dbInfo.edges).map((e) => ({
        name: e.name,
        kind: 'edge',
        mode: `${e.fromTable ?? '?'} -> ${e.toTable ?? '?'}`,
      })),
    ]
    if (opts.format === 'json') json(rows)
    else {
      if (rows.length === 0) info('No tables found in database')
      else table(rows)
    }
  })
}

async function cmdInspect(globals: GlobalOpts, tableName: string): Promise<void> {
  const config = await resolveConnection(globals.config)
  await withClient(config, async (_client, db) => {
    info(`Inspecting table: ${tableName}`)
    const tdef = await fetchTableInfo(db, tableName)
    panel(`Table: ${tableName}`, JSON.stringify(tdef, null, 2))
    info(`Fields: ${tdef.fields.length}`)
    info(`Indexes: ${tdef.indexes.length}`)
    info(`Events: ${tdef.events.length}`)
  })
}

async function cmdValidate(
  _globals: GlobalOpts,
  opts: { schema?: string; strict?: boolean; format?: string; output?: string },
): Promise<void> {
  if (!opts.schema) {
    error('--schema <path> is required')
    Deno.exit(ExitCode.Usage)
  }
  const { tables, edges } = await loadSchemaFile(opts.schema)
  const result = validateSchema({ tables, edges })
  const payload = { valid: result.valid, issues: result.issues }
  const output = opts.format === 'json' ? JSON.stringify(payload, null, 2) : formatValidation(result.issues)
  if (opts.output) {
    await Deno.writeTextFile(opts.output, output)
    success(`Wrote validation report to ${opts.output}`)
  } else {
    console.log(output)
  }
  const errorCount = result.issues.filter((i) => i.level === 'error').length
  const warnCount = result.issues.filter((i) => i.level === 'warning').length
  info(`Errors: ${errorCount} | Warnings: ${warnCount}`)
  if (!result.valid || (opts.strict && result.issues.length > 0)) {
    Deno.exit(ExitCode.Failure)
  }
}

function formatValidation(
  issues: readonly { level: string; message: string; table?: string; field?: string }[],
): string {
  if (issues.length === 0) return 'Schema is valid; no issues detected.'
  return issues
    .map((i) => `[${i.level}] ${i.table ?? ''}${i.field ? `.${i.field}` : ''} ${i.message}`)
    .join('\n')
}

async function cmdCheck(
  _globals: GlobalOpts,
  opts: { schema?: string; snapshot?: string; failOnDrift?: boolean; showDiff?: boolean; format?: string },
): Promise<void> {
  const schemaDir = opts.schema ?? 'schemas'
  const snapshotPath = opts.snapshot ?? 'db/snapshot.json'
  try {
    const report = await checkSchemaDrift(snapshotPath, schemaDir, { filter: defaultSchemaFilter })
    if (opts.format === 'json') {
      json(report)
    } else {
      if (report.issues.length === 0) success('No drift detected')
      else {
        warning(`Found ${report.issues.length} drift issue(s)`)
        for (const issue of report.issues) {
          const msg = `[${issue.severity}] ${issue.filePath}: ${issue.description}`
          if (issue.severity === 'error') error(msg)
          else if (issue.severity === 'warning') warning(msg)
          else info(msg)
        }
      }
      if (opts.showDiff && report.driftedFiles.length > 0) {
        info('Drifted files:')
        for (const f of report.driftedFiles) info(`  - ${f}`)
      }
    }
    if (!report.passed && (opts.failOnDrift ?? true)) Deno.exit(ExitCode.Failure)
  } catch (e) {
    error(`check failed: ${e instanceof Error ? e.message : String(e)}`)
    Deno.exit(ExitCode.Failure)
  }
}

function cmdHookConfig(
  _globals: GlobalOpts,
  opts: { schema?: string; failOnDrift?: boolean },
): void {
  const yaml = generatePrecommitConfig(opts.schema ?? 'schemas/', {
    failOnDrift: opts.failOnDrift ?? true,
  })
  console.log(yaml)
}

async function cmdWatch(
  _globals: GlobalOpts,
  opts: { schema?: string; snapshot?: string; debounce?: number },
): Promise<void> {
  const schemaDir = opts.schema ?? 'schemas'
  const snapshot = opts.snapshot ?? 'db/snapshot.json'
  const debounce = typeof opts.debounce === 'number' ? opts.debounce * 1000 : 500
  info(`Watching ${schemaDir} (snapshot: ${snapshot}, debounce: ${debounce}ms)`)
  info('Press Ctrl-C to stop')
  const handle = await watchSchema(schemaDir, (report) => {
    if (report.passed && report.issues.length === 0) {
      success('No drift')
      return
    }
    warning(`Drift: ${report.issues.length} issue(s)`)
    for (const i of report.issues) {
      console.log(`  [${i.severity}] ${i.filePath}: ${i.description}`)
    }
  }, { debounceMs: debounce, snapshotPath: snapshot })

  const shutdown = async () => {
    info('\nStopping watcher')
    await handle.stop()
    Deno.exit(ExitCode.Success)
  }
  Deno.addSignalListener('SIGINT', () => void shutdown())
  Deno.addSignalListener('SIGTERM', () => void shutdown())
  await new Promise<void>(() => {})
}

async function cmdVisualize(
  _globals: GlobalOpts,
  opts: {
    schema?: string
    format?: string
    output?: string
    tableFilter?: string
    noFields?: boolean
    noEdges?: boolean
  },
): Promise<void> {
  if (!opts.schema) {
    error('--schema <path> is required')
    Deno.exit(ExitCode.Usage)
  }
  const { tables, edges } = await loadSchemaFile(opts.schema)
  let filteredTables = tables
  let filteredEdges = edges
  if (opts.tableFilter) {
    const wanted = new Set(opts.tableFilter.split(',').map((s) => s.trim()))
    filteredTables = tables.filter((t) => wanted.has(t.name))
    filteredEdges = edges.filter(
      (e) => (e.fromTable && wanted.has(e.fromTable)) || (e.toTable && wanted.has(e.toTable)),
    )
  }
  if (opts.noEdges) filteredEdges = []
  const fmt = (opts.format ?? 'mermaid').toLowerCase()
  let content: string
  switch (fmt) {
    case 'mermaid':
      content = generateMermaid({ tables: filteredTables, edges: filteredEdges })
      break
    case 'graphviz':
    case 'dot':
      content = generateGraphViz({ tables: filteredTables, edges: filteredEdges })
      break
    case 'ascii':
      content = generateAscii({ tables: filteredTables, edges: filteredEdges })
      break
    default:
      error(`Unknown format: ${fmt}. Expected mermaid | graphviz | ascii`)
      Deno.exit(ExitCode.Usage)
  }
  if (opts.noFields) {
    content = content.split('\n').filter((line) => !/^\s{4,}/.test(line)).join('\n')
  }
  if (opts.output) {
    await Deno.writeTextFile(opts.output, content)
    success(`Wrote diagram to ${opts.output}`)
  } else {
    console.log(content)
  }
}

export function buildSchemaCommand(globals: GlobalOpts): AnyCommand {
  const show = new Command()
    .description('Show current database schema')
    .arguments('[table:string]')
    .option('-f, --format <format:string>', 'Output format (text|json)', { default: 'text' })
    .action(async (opts, tableName?: string) => {
      await cmdShow(globals, tableName, opts)
    })

  const diff = new Command()
    .description('Compare code schema snapshot with database schema')
    .option('-s, --schema <path:string>', 'Path to schema snapshot JSON file')
    .option('-f, --format <format:string>', 'Output format (text|json)', { default: 'text' })
    .action(async (opts) => {
      await cmdDiff(globals, opts)
    })

  const generate = new Command()
    .description('Generate a migration from schema differences (placeholder)')
    .action(() => {
      cmdGenerate()
    })

  const sync = new Command()
    .description('Sync schema to database (not recommended)')
    .action(() => {
      cmdSync()
    })

  const exportCmd = new Command()
    .description('Export database schema to a file or stdout')
    .option('-o, --output <path:string>', 'Output file path')
    .option('-t, --table-name <name:string>', 'Export a single table')
    .option('-f, --format <format:string>', 'Export format (json|sql)', { default: 'json' })
    .action(async (opts) => {
      await cmdExport(globals, opts)
    })

  const tablesCmd = new Command()
    .description('List all tables in the database')
    .option('-f, --format <format:string>', 'Output format (table|json)', { default: 'table' })
    .action(async (opts) => {
      await cmdTables(globals, opts)
    })

  const inspect = new Command()
    .description('Inspect detailed information about a table')
    .arguments('<table:string>')
    .action(async (_opts, tableName: string) => {
      await cmdInspect(globals, tableName)
    })

  const validate = new Command()
    .description('Validate a schema snapshot')
    .option('-s, --schema <path:string>', 'Path to schema snapshot JSON file')
    .option('--strict', 'Exit non-zero on warnings as well as errors')
    .option('-f, --format <format:string>', 'Output format (text|json)', { default: 'text' })
    .option('-o, --output <path:string>', 'Write report to file')
    .action(async (opts) => {
      await cmdValidate(globals, opts)
    })

  const check = new Command()
    .description('Check for unmigrated schema drift (pre-commit friendly)')
    .option('-s, --schema <path:string>', 'Path to schema files', { default: 'schemas' })
    .option('--snapshot <path:string>', 'Path to snapshot JSON', { default: 'db/snapshot.json' })
    .option('--fail-on-drift', 'Exit non-zero when drift is detected', { default: true })
    .option('--no-fail-on-drift', 'Do not fail the process on drift')
    .option('--show-diff', 'Show detailed diff information')
    .option('-f, --format <format:string>', 'Output format (text|json)', { default: 'text' })
    .action(async (opts) => {
      await cmdCheck(globals, opts)
    })

  const hookConfig = new Command()
    .description('Generate pre-commit hook YAML configuration')
    .option('-s, --schema <path:string>', 'Path to schema files', { default: 'schemas/' })
    .option('--fail-on-drift', 'Fail the hook on drift', { default: true })
    .option('--no-fail-on-drift', 'Do not fail the hook on drift')
    .action((opts) => {
      cmdHookConfig(globals, opts)
    })

  const watch = new Command()
    .description('Watch schema files and report drift as they change')
    .option('-s, --schema <path:string>', 'Path to schema files', { default: 'schemas' })
    .option('--snapshot <path:string>', 'Path to snapshot JSON', { default: 'db/snapshot.json' })
    .option('--debounce <seconds:number>', 'Debounce delay in seconds', { default: 0.5 })
    .action(async (opts) => {
      await cmdWatch(globals, opts)
    })

  const visualize = new Command()
    .description('Generate a Mermaid / GraphViz / ASCII diagram from a snapshot')
    .option('-s, --schema <path:string>', 'Path to schema snapshot JSON file')
    .option('-f, --format <format:string>', 'Diagram format (mermaid|graphviz|ascii)', { default: 'mermaid' })
    .option('-o, --output <path:string>', 'Write diagram to file instead of stdout')
    .option('-t, --table-filter <tables:string>', 'Comma-separated list of tables to include')
    .option('--no-fields', 'Exclude field rows from the diagram')
    .option('--no-edges', 'Exclude edges from the diagram')
    .action(async (opts) => {
      await cmdVisualize(globals, opts)
    })

  const cmd = new Command()
    .description('Schema inspection and management commands')
    .action(function () {
      this.showHelp()
    })
    .command('show', show)
    .command('diff', diff)
    .command('generate', generate)
    .command('sync', sync)
    .command('export', exportCmd)
    .command('tables', tablesCmd)
    .command('inspect', inspect)
    .command('validate', validate)
    .command('check', check)
    .command('hook-config', hookConfig)
    .command('watch', watch)
    .command('visualize', visualize)

  return cmd as AnyCommand
}
