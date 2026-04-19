/**
 * Migration squashing.
 *
 * Combine N consecutive `.surql` migrations into a single rolled-up
 * migration file. The squashed file merges all UP statements, all DOWN
 * statements (in reverse order), records the source versions in a
 * `-- @squashed-from: v1..vN` header, stamps a SHA-256 checksum, and
 * emits a fresh timestamped version string.
 *
 * Ports surql-py's `migration.squash` with adjustments for the TS port's
 * `.surql`-file-based migration format (vs py's module-based format).
 */

import { discoverMigrations, loadMigration, MigrationDiscoveryError } from './discovery.ts'
import type { MigrationMetadata } from './models.ts'

/**
 * Raised when a squash operation cannot be completed.
 */
export class SquashError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SquashError'
  }
}

/**
 * Options accepted by {@link squashMigrations}.
 */
export interface SquashOptions {
  /**
   * Inclusive lower bound on the version range to squash. Omit to start
   * from the earliest discovered migration.
   */
  readonly fromVersion?: string
  /**
   * Inclusive upper bound on the version range to squash. Omit to
   * extend to the latest discovered migration.
   */
  readonly toVersion?: string
  /**
   * Output path for the squashed `.surql`. When omitted the file is
   * written into `directory` with a fresh timestamp-based filename.
   */
  readonly outputPath?: string
  /**
   * When true, produce a {@link SquashResult} without writing any files.
   */
  readonly dryRun?: boolean
  /**
   * Human-readable description for the squashed migration. Defaults to
   * `squashed <from>..<to>`.
   */
  readonly description?: string
}

/**
 * Outcome of a squash operation.
 */
export interface SquashResult {
  /** Absolute path of the squashed migration (even on dry runs). */
  readonly squashedPath: string
  /** New version string stamped on the squashed migration. */
  readonly version: string
  /** SHA-256 of the squashed file's UP body. */
  readonly checksum: string
  /** Number of source migrations folded into the result. */
  readonly originalCount: number
  /** Number of UP statements in the squashed file. */
  readonly statementCount: number
  /** Ordered list of source migration versions. */
  readonly originalVersions: readonly string[]
  /** The rendered `.surql` content (written to disk unless `dryRun`). */
  readonly content: string
}

/**
 * Split a SurrealQL blob into semicolon-terminated statements. Comment
 * and blank lines are preserved when they appear inline, but empty
 * statements are discarded.
 */
function splitStatements(body: string): string[] {
  if (!body.trim()) return []
  const parts: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '\\' && i + 1 < body.length) {
      current += ch + body[i + 1]
      i++
      continue
    }
    if (ch === "'" && !inDouble) inSingle = !inSingle
    else if (ch === '"' && !inSingle) inDouble = !inDouble

    if (ch === ';' && !inSingle && !inDouble) {
      const stmt = current.trim()
      if (stmt) parts.push(stmt)
      current = ''
      continue
    }
    current += ch
  }

  const tail = current.trim()
  if (tail) parts.push(tail)
  return parts
}

/**
 * Separate any `-- UP` / `-- DOWN` sections from a migration body. If
 * no sectioning markers are present the entire blob is treated as UP
 * and DOWN is empty.
 *
 * The parser is intentionally forgiving: it recognises the markers
 * when they appear on their own line (case-insensitive).
 */
function extractSections(body: string): { up: string; down: string } {
  const lines = body.split(/\r?\n/)
  const up: string[] = []
  const down: string[] = []
  let section: 'up' | 'down' = 'up'

  for (const rawLine of lines) {
    const line = rawLine.trimStart()
    const marker = line.replace(/^--\s*/, '').trim().toUpperCase()
    if (line.startsWith('--') && (marker === 'UP' || marker === '@UP')) {
      section = 'up'
      continue
    }
    if (line.startsWith('--') && (marker === 'DOWN' || marker === '@DOWN')) {
      section = 'down'
      continue
    }
    if (section === 'up') up.push(rawLine)
    else down.push(rawLine)
  }

  return { up: up.join('\n'), down: down.join('\n') }
}

/**
 * Produce a hex-encoded SHA-256 of `input`.
 */
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const arr = Array.from(new Uint8Array(digest))
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Render a fresh version string in the same `YYYYMMDDHHMMSS` format as
 * the rest of the TS port (14 digits).
 */
function newVersion(now: Date = new Date()): string {
  return now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
}

function filterByRange(
  metadata: MigrationMetadata[],
  fromVersion: string | undefined,
  toVersion: string | undefined,
): MigrationMetadata[] {
  return metadata.filter((m) => {
    if (fromVersion !== undefined && m.version < fromVersion) return false
    if (toVersion !== undefined && m.version > toVersion) return false
    return true
  })
}

/**
 * Squash consecutive migrations in `directory` into a single file.
 *
 * Discovers migrations, filters them by version range, loads each
 * file's contents, merges UP/DOWN sections, and renders a new
 * `.surql` with a `-- @squashed-from:` header, SHA-256 checksum, and
 * fresh version timestamp.
 *
 * @throws {@link SquashError} when fewer than two migrations match or
 * any source fails to load.
 */
export async function squashMigrations(
  directory: string,
  fromVersion?: string,
  toVersion?: string,
  opts: Omit<SquashOptions, 'fromVersion' | 'toVersion'> = {},
): Promise<SquashResult> {
  let metadata: MigrationMetadata[]
  try {
    metadata = await discoverMigrations(directory)
  } catch (e) {
    if (e instanceof MigrationDiscoveryError) throw new SquashError(e.message)
    throw new SquashError(`Failed to discover migrations: ${e instanceof Error ? e.message : String(e)}`)
  }

  if (metadata.length === 0) {
    throw new SquashError(`No migrations found in ${directory}`)
  }

  const matching = filterByRange(metadata, fromVersion, toVersion)

  if (matching.length < 2) {
    throw new SquashError(
      `At least 2 migrations required for squashing, matched ${matching.length} in range ` +
        `[${fromVersion ?? '-'}..${toVersion ?? '-'}]`,
    )
  }

  const upStatements: string[] = []
  const downStatementsRev: string[] = []
  const versions: string[] = []

  for (const m of matching) {
    let body: string
    try {
      body = await Deno.readTextFile(m.filepath)
    } catch (e) {
      throw new SquashError(`Failed to read ${m.filepath}: ${e instanceof Error ? e.message : String(e)}`)
    }

    const sections = extractSections(body)
    const up = splitStatements(sections.up)
    const down = splitStatements(sections.down)

    if (up.length === 0) {
      // Fall back to loadMigration for .ts migrations (py has no ts).
      try {
        const migration = await loadMigration(m.filepath)
        const upSql = await migration.up()
        const downSql = await migration.down()
        const upFallback = splitStatements(upSql)
        const downFallback = splitStatements(downSql)
        if (upFallback.length === 0) {
          throw new SquashError(`Migration ${m.version} has no UP statements`)
        }
        upStatements.push(...upFallback)
        // Downs are merged in reverse migration order.
        downStatementsRev.unshift(...downFallback.reverse())
      } catch (e) {
        if (e instanceof SquashError) throw e
        throw new SquashError(`Failed to load ${m.filepath}: ${e instanceof Error ? e.message : String(e)}`)
      }
    } else {
      upStatements.push(...up)
      downStatementsRev.unshift(...down.reverse())
    }

    versions.push(m.version)
  }

  const firstVersion = versions[0]
  const lastVersion = versions[versions.length - 1]
  const description = opts.description?.trim() || `squashed ${firstVersion}..${lastVersion}`

  const version = newVersion()
  const upBody = upStatements.map((s) => `${s};`).join('\n')
  const downBody = downStatementsRev.map((s) => `${s};`).join('\n')
  const checksum = await sha256Hex(upBody)

  const squashedFromList = versions.map((v) => `--   - ${v}`).join('\n')
  const content = [
    `-- Migration: ${description}`,
    `-- Version: ${version}`,
    `-- @squashed-from: ${firstVersion}..${lastVersion}`,
    `-- Squashed ${versions.length} migrations:`,
    squashedFromList,
    `-- @checksum: sha256:${checksum}`,
    '',
    '-- UP',
    upBody,
    '',
    '-- DOWN',
    downBody,
    '',
  ].join('\n')

  const outputPath = opts.outputPath ?? `${directory}/${version}_${slugify(description)}.surql`

  if (!opts.dryRun) {
    await Deno.mkdir(directory, { recursive: true }).catch((e) => {
      if (!(e instanceof Deno.errors.AlreadyExists)) throw e
    })
    await Deno.writeTextFile(outputPath, content)
  }

  return {
    squashedPath: outputPath,
    version,
    checksum,
    originalCount: versions.length,
    statementCount: upStatements.length,
    originalVersions: versions,
    content,
  }
}

function slugify(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'squashed'
}
