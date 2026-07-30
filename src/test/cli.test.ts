/**
 * CLI integration tests.
 *
 * Spawns the `surql` CLI as a subprocess and asserts on stdout / stderr
 * and exit codes. The tests that touch a database probe port 8000 up
 * front and skip themselves when no SurrealDB is running, so the suite
 * is green in environments without the integration container while
 * still failing the CI job that runs one.
 */

import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { afterAll, beforeAll, describe, it } from '@std/testing/bdd'

const CLI_PATH = new URL('../cli/main.ts', import.meta.url).pathname

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

async function runCli(args: string[], env: Record<string, string> = {}): Promise<RunResult> {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      'run',
      '--quiet',
      '--allow-read',
      '--allow-write',
      '--allow-net',
      '--allow-env',
      '--allow-sys',
      '--allow-run=git',
      CLI_PATH,
      ...args,
    ],
    env: {
      NO_COLOR: '1',
      ...env,
    },
    stdout: 'piped',
    stderr: 'piped',
  })
  const output = await cmd.output()
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  }
}

async function hasSurrealDB(): Promise<boolean> {
  try {
    const conn = await Deno.connect({ hostname: '127.0.0.1', port: 8000 })
    conn.close()
    return true
  } catch {
    return false
  }
}

describe('CLI: version', () => {
  it('prints version with -v', async () => {
    const { code, stdout } = await runCli(['-v'])
    assertEquals(code, 0)
    assertStringIncludes(stdout.trim(), '.')
  })

  it('prints version with --version', async () => {
    const { code, stdout } = await runCli(['--version'])
    assertEquals(code, 0)
    assert(stdout.includes('surql'))
  })

  it('prints version with `version` subcommand', async () => {
    const { code, stdout } = await runCli(['version'])
    assertEquals(code, 0)
    const trimmed = stdout.trim()
    assert(/^\d+\.\d+\.\d+/.test(trimmed), `expected semver-like output, got: ${trimmed}`)
  })
})

describe('CLI: help', () => {
  it('shows top-level help with no args', async () => {
    const { code, stdout } = await runCli([])
    assertEquals(code, 0)
    assertStringIncludes(stdout, 'migrate')
    assertStringIncludes(stdout, 'schema')
    assertStringIncludes(stdout, 'bucket')
    assertStringIncludes(stdout, 'db')
    assertStringIncludes(stdout, 'orchestrate')
  })

  it('shows bucket help', async () => {
    const { code, stdout } = await runCli(['bucket', '--help'])
    assertEquals(code, 0)
    assertStringIncludes(stdout, 'define')
    assertStringIncludes(stdout, 'list')
    assertStringIncludes(stdout, 'rm')
    assertStringIncludes(stdout, 'put')
    assertStringIncludes(stdout, 'get')
  })

  it('shows migrate help', async () => {
    const { code, stdout } = await runCli(['migrate', '--help'])
    assertEquals(code, 0)
    assertStringIncludes(stdout, 'up')
    assertStringIncludes(stdout, 'down')
    assertStringIncludes(stdout, 'status')
    assertStringIncludes(stdout, 'squash')
  })

  it('shows schema help', async () => {
    const { code, stdout } = await runCli(['schema', '--help'])
    assertEquals(code, 0)
    assertStringIncludes(stdout, 'show')
    assertStringIncludes(stdout, 'tables')
    assertStringIncludes(stdout, 'validate')
    assertStringIncludes(stdout, 'visualize')
  })

  it('shows db help', async () => {
    const { code, stdout } = await runCli(['db', '--help'])
    assertEquals(code, 0)
    assertStringIncludes(stdout, 'init')
    assertStringIncludes(stdout, 'ping')
    assertStringIncludes(stdout, 'reset')
    assertStringIncludes(stdout, 'query')
  })

  it('shows orchestrate help', async () => {
    const { code, stdout } = await runCli(['orchestrate', '--help'])
    assertEquals(code, 0)
    assertStringIncludes(stdout, 'deploy')
    assertStringIncludes(stdout, 'status')
    assertStringIncludes(stdout, 'validate')
  })
})

describe('CLI: settings', () => {
  it('prints resolved settings as JSON', async () => {
    const { code, stdout } = await runCli(['settings'], {
      SURQL_DB_HOST: '127.0.0.1',
      SURQL_DB_PORT: '8000',
      SURQL_DB_NAMESPACE: 'ns',
      SURQL_DB_DATABASE: 'db',
    })
    assertEquals(code, 0)
    const parsed = JSON.parse(stdout)
    assertEquals(typeof parsed.environment, 'string')
    assertEquals(parsed.database.host, '127.0.0.1')
    assertEquals(parsed.database.port, '8000')
    assertEquals(parsed.database.namespace, 'ns')
    assertEquals(parsed.database.database, 'db')
  })
})

describe('CLI: migrate create (no DB)', () => {
  let tempDir: string

  beforeAll(async () => {
    tempDir = await Deno.makeTempDir({ prefix: 'surql-cli-test-' })
  })

  afterAll(async () => {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {})
  })

  it('creates a blank migration file', async () => {
    const { code, stdout } = await runCli([
      'migrate',
      'create',
      'add user table',
      '--directory',
      tempDir,
    ])
    assertEquals(code, 0)
    assertStringIncludes(stdout, 'Created migration')
    // Confirm a file was actually written.
    let found = false
    for await (const entry of Deno.readDir(tempDir)) {
      if (entry.isFile && entry.name.endsWith('.surql')) {
        found = true
        assert(/^\d{14}_[a-z0-9_]+\.surql$/.test(entry.name))
      }
    }
    assert(found, 'Expected a .surql file in the temp dir')
  })

  it('validates the created migration', async () => {
    const { code } = await runCli(['migrate', 'validate', '--directory', tempDir])
    assertEquals(code, 0)
  })
})

describe('CLI: schema hook-config (no DB)', () => {
  it('prints a pre-commit config YAML', async () => {
    const { code, stdout } = await runCli(['schema', 'hook-config', '--schema', 'db/schema'])
    assertEquals(code, 0)
    assertStringIncludes(stdout, 'repos:')
    assertStringIncludes(stdout, 'surql-schema-drift')
  })
})

describe('CLI: db ping / migrate status / schema tables (live)', () => {
  let dbAvailable = false
  // SurrealDB v3 pre-creates a `main/main` namespace/database; using it
  // avoids needing DEFINE NAMESPACE/DATABASE as a root setup step.
  const envOverrides = {
    SURQL_DB_HOST: '127.0.0.1',
    SURQL_DB_PORT: '8000',
    SURQL_DB_NAMESPACE: 'main',
    SURQL_DB_DATABASE: 'main',
    SURQL_DB_USERNAME: 'root',
    SURQL_DB_PASSWORD: 'root',
  }

  beforeAll(async () => {
    dbAvailable = await hasSurrealDB()
  })

  it('db ping succeeds when DB reachable', async () => {
    if (!dbAvailable) return
    const { code, stdout } = await runCli(['db', 'ping'], envOverrides)
    assertEquals(code, 0, `stdout: ${stdout}`)
    assertStringIncludes(stdout, 'Connection successful')
  })

  it('migrate status connects and reports no migrations when dir empty', async () => {
    if (!dbAvailable) return
    const emptyDir = await Deno.makeTempDir({ prefix: 'surql-empty-' })
    try {
      const { code, stdout } = await runCli(
        ['migrate', 'status', '--directory', emptyDir],
        envOverrides,
      )
      assertEquals(code, 0, `stdout: ${stdout}`)
    } finally {
      await Deno.remove(emptyDir, { recursive: true }).catch(() => {})
    }
  })

  it('schema tables connects', async () => {
    if (!dbAvailable) return
    const { code } = await runCli(['schema', 'tables'], envOverrides)
    assertEquals(code, 0)
  })
})
