import { assertEquals } from '@std/assert'
import { afterEach, beforeEach, describe, it } from '@std/testing/bdd'
import { clearSettingsCache, getDbConfig, getMigrationPath, getSettings, loadSettings } from '../settings.ts'

async function withTempDir(test: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: 'surql_settings_test_' })
  try {
    await test(dir)
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {})
  }
}

type Snapshot = { key: string; value: string | undefined }

function captureEnv(keys: string[]): Snapshot[] {
  return keys.map((k) => ({ key: k, value: Deno.env.get(k) }))
}

function restoreEnv(snap: Snapshot[]): void {
  for (const { key, value } of snap) {
    if (value === undefined) Deno.env.delete(key)
    else Deno.env.set(key, value)
  }
}

const SURQL_KEYS = [
  'SURQL_ENVIRONMENT',
  'SURQL_DEBUG',
  'SURQL_LOG_LEVEL',
  'SURQL_APP_NAME',
  'SURQL_VERSION',
  'SURQL_MIGRATION_PATH',
  'SURQL_HOST',
  'SURQL_PORT',
  'SURQL_NAMESPACE',
  'SURQL_DATABASE',
  'SURQL_USERNAME',
  'SURQL_PASSWORD',
]

describe('Settings loader', () => {
  let snapshot: Snapshot[] = []

  beforeEach(() => {
    snapshot = captureEnv(SURQL_KEYS)
    for (const { key } of snapshot) Deno.env.delete(key)
    clearSettingsCache()
  })

  afterEach(() => {
    restoreEnv(snapshot)
    clearSettingsCache()
  })

  it('returns defaults when no source is configured', async () => {
    await withTempDir(async (cwd) => {
      const s = await loadSettings({ cwd })
      assertEquals(s.environment, 'development')
      assertEquals(s.debug, true)
      assertEquals(s.logLevel, 'INFO')
      assertEquals(s.appName, 'surql')
      assertEquals(s.migrationPath, 'migrations')
      assertEquals(s.database.host, '127.0.0.1')
      assertEquals(s.database.port, '8000')
    })
  })

  it('reads SURQL_* env vars', async () => {
    await withTempDir(async (cwd) => {
      Deno.env.set('SURQL_ENVIRONMENT', 'production')
      Deno.env.set('SURQL_DEBUG', 'false')
      Deno.env.set('SURQL_LOG_LEVEL', 'WARNING')
      Deno.env.set('SURQL_APP_NAME', 'app')
      Deno.env.set('SURQL_HOST', 'db.example.com')
      Deno.env.set('SURQL_PORT', '9000')

      const s = await loadSettings({ cwd })
      assertEquals(s.environment, 'production')
      assertEquals(s.debug, false)
      assertEquals(s.logLevel, 'WARNING')
      assertEquals(s.appName, 'app')
      assertEquals(s.database.host, 'db.example.com')
      assertEquals(s.database.port, '9000')
    })
  })

  it('reads .env file values', async () => {
    await withTempDir(async (cwd) => {
      const env = [
        'SURQL_ENVIRONMENT=staging',
        'SURQL_MIGRATION_PATH=db/migrations',
        'SURQL_HOST="quoted.example"',
        "SURQL_NAMESPACE='nsquoted'",
        '# commented=ignored',
        'UNRELATED=skip',
      ].join('\n')
      await Deno.writeTextFile(`${cwd}/.env`, env)

      const s = await loadSettings({ cwd })
      assertEquals(s.environment, 'staging')
      assertEquals(s.migrationPath, 'db/migrations')
      assertEquals(s.database.host, 'quoted.example')
      assertEquals(s.database.namespace, 'nsquoted')
    })
  })

  it('reads surql.yaml file values', async () => {
    await withTempDir(async (cwd) => {
      const yaml = [
        'environment: staging',
        'debug: false',
        'migrationPath: db/migrations',
        'database:',
        '  host: yaml.example',
        '  port: "9100"',
        '  namespace: yamlns',
      ].join('\n')
      await Deno.writeTextFile(`${cwd}/surql.yaml`, yaml)

      const s = await loadSettings({ cwd })
      assertEquals(s.environment, 'staging')
      assertEquals(s.debug, false)
      assertEquals(s.migrationPath, 'db/migrations')
      assertEquals(s.database.host, 'yaml.example')
      assertEquals(s.database.port, '9100')
      assertEquals(s.database.namespace, 'yamlns')
    })
  })

  it('reads surql.toml file values', async () => {
    await withTempDir(async (cwd) => {
      const toml = [
        'environment = "production"',
        'appName = "from-toml"',
        '',
        '[database]',
        'host = "toml.example"',
        'port = "9200"',
        'namespace = "tomlns"',
      ].join('\n')
      await Deno.writeTextFile(`${cwd}/surql.toml`, toml)

      const s = await loadSettings({ cwd })
      assertEquals(s.environment, 'production')
      assertEquals(s.appName, 'from-toml')
      assertEquals(s.database.host, 'toml.example')
      assertEquals(s.database.port, '9200')
      assertEquals(s.database.namespace, 'tomlns')
    })
  })

  it('resolves priority: explicit > env > .env > file', async () => {
    await withTempDir(async (cwd) => {
      await Deno.writeTextFile(`${cwd}/surql.yaml`, 'environment: production\nappName: fromYaml\n')
      await Deno.writeTextFile(`${cwd}/.env`, 'SURQL_ENVIRONMENT=staging\nSURQL_APP_NAME=fromDotenv\n')
      Deno.env.set('SURQL_APP_NAME', 'fromEnv')

      const s = await loadSettings({ cwd, environment: 'development' })
      // explicit wins on environment
      assertEquals(s.environment, 'development')
      // env wins for appName over .env and yaml
      assertEquals(s.appName, 'fromEnv')
    })
  })

  it('parses boolean debug from env variants', async () => {
    await withTempDir(async (cwd) => {
      for (
        const [raw, expected] of [
          ['true', true],
          ['1', true],
          ['yes', true],
          ['false', false],
          ['0', false],
          ['no', false],
        ] as Array<[string, boolean]>
      ) {
        Deno.env.set('SURQL_DEBUG', raw)
        clearSettingsCache()
        const s = await loadSettings({ cwd })
        assertEquals(s.debug, expected, `raw=${raw}`)
      }
    })
  })

  it('getSettings caches the resolved value', async () => {
    clearSettingsCache()
    const a = await getSettings()
    const b = await getSettings()
    assertEquals(a, b)
  })

  it('getDbConfig and getMigrationPath read through cache', async () => {
    clearSettingsCache()
    const path = await getMigrationPath()
    const db = await getDbConfig()
    assertEquals(typeof path, 'string')
    assertEquals(typeof db.host, 'string')
  })

  it('ignores unknown SURQL_ keys', async () => {
    await withTempDir(async (cwd) => {
      Deno.env.set('SURQL_SOMETHING_UNKNOWN', 'whatever')
      const s = await loadSettings({ cwd })
      assertEquals(s.environment, 'development')
    })
  })
})
