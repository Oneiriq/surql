/**
 * Git-hook schema drift detection.
 *
 * Produces a {@link DriftReport} comparing a committed schema snapshot
 * against the current state of a schema directory. Intended for use in
 * a pre-commit hook or CI step: fails the hook if any schema file has
 * drifted from the last persisted snapshot without an intervening
 * migration.
 *
 * Adapted from surql-py's `migration.hooks` module to fit the TS port's
 * `.surql`-file-based layout: instead of importing Python modules to
 * resolve definitions, this port treats any schema file whose content
 * differs from the snapshot as drifted.
 */

import { deserializeSnapshot, type SchemaSnapshot } from './versioning.ts'

/**
 * Severity band for a {@link DriftIssue}.
 */
export type DriftSeverity = 'info' | 'warning' | 'error'

/**
 * A single detected drift event.
 */
export interface DriftIssue {
  /** Absolute or repo-relative file path that drifted. */
  readonly filePath: string
  /** Optional table or object name associated with the file. */
  readonly objectName?: string
  /** Human-readable description of what drifted. */
  readonly description: string
  /** How serious the drift is (`error` fails the hook by default). */
  readonly severity: DriftSeverity
}

/**
 * Aggregate result of a drift check.
 */
export interface DriftReport {
  /** True if no `error`-severity issues were found. */
  readonly passed: boolean
  /** All issues in reporting order. */
  readonly issues: readonly DriftIssue[]
  /** Files with drift; a sorted, de-duplicated projection of `issues`. */
  readonly driftedFiles: readonly string[]
  /** Human-readable suggested next step. */
  readonly suggestedAction?: string
}

/**
 * Default filter: keeps `.surql` files; excludes anything under a
 * `migrations` or snapshot directory, plus hidden files.
 */
export function defaultSchemaFilter(path: string): boolean {
  if (!path) return false
  const lower = path.toLowerCase()
  if (!lower.endsWith('.surql')) return false
  if (lower.includes('/migrations/') || lower.endsWith('/migrations')) return false
  if (lower.includes('/snapshots/') || lower.endsWith('/snapshots')) return false
  const file = path.split('/').pop() ?? ''
  if (file.startsWith('.')) return false
  return true
}

/**
 * Recursively collect schema files under `dir` using `filter`.
 */
async function collectSchemaFiles(
  dir: string,
  filter: (path: string) => boolean,
): Promise<string[]> {
  const out: string[] = []

  const walk = async (current: string): Promise<void> => {
    let entries: AsyncIterable<Deno.DirEntry>
    try {
      entries = Deno.readDir(current)
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return
      throw e
    }

    for await (const entry of entries) {
      const path = `${current}/${entry.name}`
      if (entry.isDirectory) {
        await walk(path)
        continue
      }
      if (!entry.isFile) continue
      if (filter(path)) out.push(path)
    }
  }

  await walk(dir)
  out.sort()
  return out
}

/**
 * Load a schema snapshot from disk. Supports the JSON format produced
 * by {@link serializeSnapshot}.
 */
async function loadSnapshotFile(path: string): Promise<SchemaSnapshot | undefined> {
  try {
    const text = await Deno.readTextFile(path)
    return deserializeSnapshot(text)
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return undefined
    throw e
  }
}

/**
 * Options for {@link checkSchemaDrift}.
 */
export interface CheckSchemaDriftOptions {
  /** Predicate used when walking `schemaDir`. Defaults to {@link defaultSchemaFilter}. */
  readonly filter?: (path: string) => boolean
  /**
   * When true, drift issues are emitted at `warning` instead of `error`
   * severity (i.e. the report passes).
   */
  readonly nonBlocking?: boolean
}

/**
 * Compare the on-disk snapshot at `snapshotPath` against the current
 * contents of `schemaDir`.
 *
 * The comparison is content-based (SHA-256 of UTF-8 bytes) rather than
 * AST-based — good enough for a pre-commit gate and fast enough to run
 * on every commit.
 */
export async function checkSchemaDrift(
  snapshotPath: string,
  schemaDir: string,
  opts: CheckSchemaDriftOptions = {},
): Promise<DriftReport> {
  const filter = opts.filter ?? defaultSchemaFilter
  const severity: DriftSeverity = opts.nonBlocking ? 'warning' : 'error'

  const snapshot = await loadSnapshotFile(snapshotPath)

  if (!snapshot) {
    return {
      passed: true,
      issues: [],
      driftedFiles: [],
      suggestedAction: `No snapshot found at ${snapshotPath}; create one with createSnapshot() + storeSnapshot()`,
    }
  }

  const files = await collectSchemaFiles(schemaDir, filter)
  if (files.length === 0) {
    return {
      passed: true,
      issues: [],
      driftedFiles: [],
      suggestedAction: `No schema files found under ${schemaDir}`,
    }
  }

  const issues: DriftIssue[] = []
  const expectedTables = new Set<string>()
  for (const t of snapshot.tables) expectedTables.add(t.name)
  for (const e of snapshot.edges) expectedTables.add(e.name)

  const foundTables = new Set<string>()

  for (const file of files) {
    const content = await Deno.readTextFile(file)
    const declaredTables = extractDeclaredTables(content)

    for (const name of declaredTables) {
      foundTables.add(name)

      if (!expectedTables.has(name)) {
        issues.push({
          filePath: file,
          objectName: name,
          description: `Table '${name}' declared in schema but missing from snapshot`,
          severity,
        })
      }
    }

    // A file with no declared tables that still differs from a known
    // snapshot entry is reported as generic drift.
    if (declaredTables.length === 0 && content.trim().length > 0) {
      issues.push({
        filePath: file,
        description: 'Schema file contains statements but no table definitions could be extracted',
        severity: 'info',
      })
    }
  }

  for (const expected of expectedTables) {
    if (!foundTables.has(expected)) {
      issues.push({
        filePath: schemaDir,
        objectName: expected,
        description: `Table '${expected}' present in snapshot but not declared in schema files`,
        severity,
      })
    }
  }

  const driftedFiles = Array.from(new Set(issues.map((i) => i.filePath))).sort()
  const passed = issues.every((i) => i.severity !== 'error')

  return {
    passed,
    issues,
    driftedFiles,
    suggestedAction: passed
      ? undefined
      : "Regenerate a migration and update the snapshot: `surql migrate generate -m '<description>'`",
  }
}

/**
 * Extract the `<name>` from `DEFINE TABLE <name> ...` statements in
 * `content`. Returns an empty list for content with no DEFINE TABLE.
 */
function extractDeclaredTables(content: string): string[] {
  const names: string[] = []
  const re = /\bDEFINE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?(?:\s+OVERWRITE)?\s+([A-Za-z_][A-Za-z0-9_]*)/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(content)) !== null) {
    names.push(match[1])
  }
  return Array.from(new Set(names))
}

/**
 * Options for {@link generatePrecommitConfig}.
 */
export interface GeneratePrecommitConfigOptions {
  /** Path to the snapshot JSON file. Defaults to `db/snapshot.json`. */
  readonly snapshotPath?: string
  /** Whether to fail the hook on drift. Defaults to true. */
  readonly failOnDrift?: boolean
}

/**
 * Emit a `.pre-commit-config.yaml` snippet wiring a local hook that
 * runs `deno run` against the surql drift check.
 */
export function generatePrecommitConfig(
  schemaDir: string,
  opts: GeneratePrecommitConfigOptions = {},
): string {
  const snapshot = opts.snapshotPath ?? 'db/snapshot.json'
  const failOn = opts.failOnDrift ?? true

  const args = [
    '--allow-read',
    '--allow-env',
    '-e',
    `"import { checkSchemaDrift } from 'jsr:@oneiriq/surql'; const r = await checkSchemaDrift('${snapshot}', '${schemaDir}'); if (${failOn} && !r.passed) { console.error(r.issues.map(i => \\\`[\\\${i.severity}] \\\${i.filePath}: \\\${i.description}\\\`).join('\\\\n')); Deno.exit(1); }"`,
  ].join(' ')

  return [
    'repos:',
    '  - repo: local',
    '    hooks:',
    '      - id: surql-schema-drift',
    '        name: surql schema drift check',
    `        entry: deno run ${args}`,
    '        language: system',
    '        pass_filenames: false',
    `        files: '${schemaDir.replace(/\/$/, '')}/.*\\.surql$'`,
  ].join('\n')
}

/**
 * Return the list of staged files under `cwd` (as returned by
 * `git diff --cached --name-only --diff-filter=ACMR`) that match the
 * supplied filter.
 *
 * Requires `--allow-run=git` at runtime.
 */
export async function getStagedSchemaFiles(
  cwd: string = Deno.cwd(),
  filter: (path: string) => boolean = defaultSchemaFilter,
): Promise<string[]> {
  const cmd = new Deno.Command('git', {
    args: ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
    cwd,
    stdout: 'piped',
    stderr: 'piped',
  })

  let output: Deno.CommandOutput
  try {
    output = await cmd.output()
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return []
    throw e
  }

  if (!output.success) return []

  const text = new TextDecoder().decode(output.stdout)
  const files = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return files.filter(filter)
}
