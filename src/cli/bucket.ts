/**
 * `surql bucket` subcommands.
 *
 * Schema management for object-storage buckets (`define`, `list`, `rm`) plus
 * runtime file operations (`put`, `get`, `delete`, `exists`, `files`). All
 * commands honour the top-level `--config` option via the shared context
 * helpers.
 *
 * Mirrors `cli/schema.ts` in structure: thin command handlers that resolve a
 * connection, open a client, and delegate to the bucket schema/runtime layers.
 */

import { Command } from '@cliffy/command'
import { error, ExitCode, info, json, success, table, warning } from './fmt.ts'
import { resolveConnection, withClient } from './context.ts'
import { fetchDbInfo } from '../schema/parser.ts'
import { generateBucketSql, generateRemoveBucketSql } from '../schema/bucket.ts'
import type { TablePermissions } from '../schema/table.ts'

interface GlobalOpts {
  config?: string
}

// deno-lint-ignore no-explicit-any
type AnyCommand = Command<any, any, any, any, any>

async function cmdDefine(
  globals: GlobalOpts,
  name: string,
  opts: { backend?: string; readonly?: boolean; comment?: string; ifNotExists?: boolean },
): Promise<void> {
  const backend = opts.backend ?? 'memory'
  const permissions: TablePermissions | undefined = undefined
  const sql = generateBucketSql(
    { name, backend, readonly: opts.readonly ?? false, permissions, comment: opts.comment },
    { ifNotExists: opts.ifNotExists },
  )
  const config = await resolveConnection(globals.config)
  await withClient(config, async (_client, db) => {
    info(`Defining bucket '${name}' (backend ${backend})`)
    await db.query(sql)
    success(`Bucket '${name}' defined`)
  })
}

async function cmdList(globals: GlobalOpts, opts: { format?: string }): Promise<void> {
  const config = await resolveConnection(globals.config)
  await withClient(config, async (_client, db) => {
    const dbInfo = await fetchDbInfo(db)
    const rows = Object.values(dbInfo.buckets).map((b) => ({
      name: b.name,
      backend: b.backend,
      readonly: b.readonly,
      comment: b.comment ?? '',
    }))
    if (opts.format === 'json') json(rows)
    else if (rows.length === 0) info('No buckets defined in database')
    else table(rows)
  })
}

async function cmdRemove(globals: GlobalOpts, name: string, opts: { ifExists?: boolean }): Promise<void> {
  const sql = generateRemoveBucketSql(name, { ifExists: opts.ifExists })
  const config = await resolveConnection(globals.config)
  await withClient(config, async (_client, db) => {
    warning(`Removing bucket '${name}'`)
    await db.query(sql)
    success(`Bucket '${name}' removed`)
  })
}

async function cmdPut(
  globals: GlobalOpts,
  bucketName: string,
  key: string,
  opts: { value?: string; file?: string },
): Promise<void> {
  if (opts.value === undefined && opts.file === undefined) {
    error('Provide file contents via --value <text> or --file <path>')
    Deno.exit(ExitCode.Usage)
  }
  const data = opts.file !== undefined ? await Deno.readFile(opts.file) : opts.value ?? ''
  const config = await resolveConnection(globals.config)
  await withClient(config, async (client) => {
    info(`Writing ${bucketName}:/${key}`)
    await client.bucket(bucketName).put(key, data)
    success(`Wrote ${bucketName}:/${key}`)
  })
}

async function cmdGet(
  globals: GlobalOpts,
  bucketName: string,
  key: string,
  opts: { output?: string },
): Promise<void> {
  const config = await resolveConnection(globals.config)
  await withClient(config, async (client) => {
    const bucket = client.bucket(bucketName)
    if (opts.output !== undefined) {
      const bytes = await bucket.get(key)
      if (bytes === undefined) {
        error(`No file at ${bucketName}:/${key}`)
        Deno.exit(ExitCode.Failure)
      }
      await Deno.writeFile(opts.output, bytes)
      success(`Wrote ${bytes.length} bytes to ${opts.output}`)
    } else {
      const text = await bucket.getText(key)
      if (text === undefined) {
        error(`No file at ${bucketName}:/${key}`)
        Deno.exit(ExitCode.Failure)
      }
      console.log(text)
    }
  })
}

async function cmdDelete(globals: GlobalOpts, bucketName: string, key: string): Promise<void> {
  const config = await resolveConnection(globals.config)
  await withClient(config, async (client) => {
    warning(`Deleting ${bucketName}:/${key}`)
    await client.bucket(bucketName).delete(key)
    success(`Deleted ${bucketName}:/${key}`)
  })
}

async function cmdExists(globals: GlobalOpts, bucketName: string, key: string): Promise<void> {
  const config = await resolveConnection(globals.config)
  await withClient(config, async (client) => {
    const present = await client.bucket(bucketName).exists(key)
    info(`${bucketName}:/${key} ${present ? 'exists' : 'does not exist'}`)
    if (!present) Deno.exit(ExitCode.Failure)
  })
}

async function cmdFiles(
  globals: GlobalOpts,
  bucketName: string,
  opts: { format?: string; prefix?: string; limit?: number },
): Promise<void> {
  const config = await resolveConnection(globals.config)
  await withClient(config, async (client) => {
    const entries = await client.bucket(bucketName).list({ prefix: opts.prefix, limit: opts.limit })
    const rows = entries.map((e) => ({ key: e.key, file: e.file.toString(), size: e.size, updated: String(e.updated) }))
    if (opts.format === 'json') json(rows)
    else if (rows.length === 0) info(`No files in bucket '${bucketName}'`)
    else table(rows)
  })
}

export function buildBucketCommand(globals: GlobalOpts): AnyCommand {
  const define = new Command()
    .description('Define a bucket (DEFINE BUCKET)')
    .arguments('<name:string>')
    .option('-b, --backend <backend:string>', 'Backend URL (memory | file:/path | s3://...)', { default: 'memory' })
    .option('--readonly', 'Mark the bucket read-only')
    .option('--comment <text:string>', 'Attach a comment')
    .option('--if-not-exists', 'Emit DEFINE BUCKET IF NOT EXISTS')
    .action(async (opts, name: string) => {
      await cmdDefine(globals, name, opts)
    })

  const list = new Command()
    .description('List buckets defined in the database')
    .option('-f, --format <format:string>', 'Output format (table|json)', { default: 'table' })
    .action(async (opts) => {
      await cmdList(globals, opts)
    })

  const rm = new Command()
    .description('Remove a bucket (REMOVE BUCKET)')
    .arguments('<name:string>')
    .option('--if-exists', 'Emit REMOVE BUCKET IF EXISTS')
    .action(async (opts, name: string) => {
      await cmdRemove(globals, name, opts)
    })

  const put = new Command()
    .description('Write a file into a bucket')
    .arguments('<bucket:string> <key:string>')
    .option('--value <text:string>', 'Inline file contents (UTF-8)')
    .option('--file <path:string>', 'Read file contents from a local path')
    .action(async (opts, bucketName: string, key: string) => {
      await cmdPut(globals, bucketName, key, opts)
    })

  const get = new Command()
    .description('Read a file from a bucket')
    .arguments('<bucket:string> <key:string>')
    .option('-o, --output <path:string>', 'Write bytes to a local file instead of stdout')
    .action(async (opts, bucketName: string, key: string) => {
      await cmdGet(globals, bucketName, key, opts)
    })

  const del = new Command()
    .description('Delete a file from a bucket')
    .arguments('<bucket:string> <key:string>')
    .action(async (_opts, bucketName: string, key: string) => {
      await cmdDelete(globals, bucketName, key)
    })

  const exists = new Command()
    .description('Check whether a file exists in a bucket')
    .arguments('<bucket:string> <key:string>')
    .action(async (_opts, bucketName: string, key: string) => {
      await cmdExists(globals, bucketName, key)
    })

  const files = new Command()
    .description('List files in a bucket')
    .arguments('<bucket:string>')
    .option('-f, --format <format:string>', 'Output format (table|json)', { default: 'table' })
    .option('--prefix <prefix:string>', 'Only list files with this key prefix')
    .option('--limit <limit:number>', 'Maximum number of files to list')
    .action(async (opts, bucketName: string) => {
      await cmdFiles(globals, bucketName, opts)
    })

  const cmd = new Command()
    .description('Object-storage bucket and file commands')
    .action(function () {
      this.showHelp()
    })
    .command('define', define)
    .command('list', list)
    .command('rm', rm)
    .command('put', put)
    .command('get', get)
    .command('delete', del)
    .command('exists', exists)
    .command('files', files)

  return cmd as AnyCommand
}
