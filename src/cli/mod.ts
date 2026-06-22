/**
 * Programmatic entrypoint for the surql CLI.
 *
 * Library consumers can call `run(args)` from their own Deno scripts
 * to embed the CLI (e.g. to wrap it behind a custom task runner). The
 * shell entrypoint at `src/cli/main.ts` is a thin wrapper around
 * {@link run}.
 */

import { Command, ValidationError } from '@cliffy/command'
import { buildBucketCommand } from './bucket.ts'
import { buildDbCommand } from './db.ts'
import { buildMigrateCommand } from './migrate.ts'
import { buildOrchestrateCommand } from './orchestrate.ts'
import { buildSchemaCommand } from './schema.ts'
import { error, ExitCode } from './fmt.ts'
import { loadSettings } from '../settings.ts'

const CLI_VERSION = '1.2.0'

// deno-lint-ignore no-explicit-any
type AnyCommand = Command<any, any, any, any, any>

/**
 * Build the root {@link Command}. Exported so tests (and embedding
 * consumers) can inspect or extend the command tree without running it.
 */
export function buildRootCommand(): AnyCommand {
  const globals: { config?: string } = {}

  const versionCmd = new Command()
    .description('Print the CLI version')
    .action(() => {
      console.log(CLI_VERSION)
    }) as AnyCommand

  const root = new Command()
    .name('surql')
    .version(CLI_VERSION)
    .versionOption('-v, --version', 'Show the CLI version.')
    .description('SurrealDB migration, schema, and orchestration toolkit')
    .globalOption('--config <path:string>', 'Path to surql.yaml / surql.toml', {
      action: (opts) => {
        globals.config = opts.config as string | undefined
      },
    })
    .action(function () {
      this.showHelp()
    }) as AnyCommand

  root.command('version', versionCmd)

  const settings = new Command()
    .description('Show resolved settings')
    .option('--config <path:string>', 'Path to surql.yaml / surql.toml')
    .action(async (opts) => {
      const cfg = opts.config as string | undefined
      const resolved = cfg ? await loadSettings({ cwd: dirnameOf(cfg) }) : await loadSettings()
      console.log(JSON.stringify(resolved, null, 2))
    }) as AnyCommand

  root.command('migrate', buildMigrateCommand(globals) as AnyCommand)
  root.command('schema', buildSchemaCommand(globals) as AnyCommand)
  root.command('bucket', buildBucketCommand(globals) as AnyCommand)
  root.command('db', buildDbCommand(globals) as AnyCommand)
  root.command('orchestrate', buildOrchestrateCommand(globals) as AnyCommand)
  root.command('settings', settings)

  return root
}

function dirnameOf(path: string): string {
  const abs = path.startsWith('/') ? path : `${Deno.cwd()}/${path}`
  const idx = abs.lastIndexOf('/')
  return idx >= 0 ? abs.slice(0, idx) : '.'
}

/**
 * Run the CLI against `args` (typically `Deno.args`). Errors are
 * routed through {@link fmt.error} and mapped to the usage exit code
 * when they originate from cliffy validation.
 */
export async function run(args: string[]): Promise<void> {
  const root = buildRootCommand()
  try {
    await root.parse(args)
  } catch (e) {
    if (e instanceof ValidationError) {
      error(e.message)
      Deno.exit(ExitCode.Usage)
    }
    if (e instanceof Error) {
      error(e.message)
      Deno.exit(ExitCode.Failure)
    }
    error(String(e))
    Deno.exit(ExitCode.Failure)
  }
}
