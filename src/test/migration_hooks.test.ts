import { assertEquals, assertStringIncludes } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import {
  checkSchemaDrift,
  defaultSchemaFilter,
  generatePrecommitConfig,
  getStagedSchemaFiles,
} from '../migration/hooks.ts'
import { createSnapshot, serializeSnapshot } from '../migration/versioning.ts'
import { tableSchema } from '../schema/table.ts'

async function withTempDir(test: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: 'surql_hooks_test_' })
  try {
    await test(dir)
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {})
  }
}

async function writeSnapshot(path: string, tableNames: string[]): Promise<void> {
  const snapshot = createSnapshot(
    '20260101000000',
    tableNames.map((n) => tableSchema(n)),
    [],
  )
  await Deno.writeTextFile(path, serializeSnapshot(snapshot))
}

describe('Migration hooks', () => {
  describe('defaultSchemaFilter', () => {
    it('keeps .surql files at the top level', () => {
      assertEquals(defaultSchemaFilter('schemas/user.surql'), true)
    })

    it('excludes files under migrations/', () => {
      assertEquals(defaultSchemaFilter('db/migrations/20260101120000_create_user.surql'), false)
    })

    it('excludes non-surql files', () => {
      assertEquals(defaultSchemaFilter('schemas/user.ts'), false)
    })

    it('excludes hidden files', () => {
      assertEquals(defaultSchemaFilter('schemas/.hidden.surql'), false)
    })

    it('excludes empty paths', () => {
      assertEquals(defaultSchemaFilter(''), false)
    })
  })

  describe('checkSchemaDrift', () => {
    it('passes when snapshot matches declared tables', async () => {
      await withTempDir(async (root) => {
        const schemaDir = `${root}/schemas`
        await Deno.mkdir(schemaDir, { recursive: true })
        await Deno.writeTextFile(`${schemaDir}/user.surql`, 'DEFINE TABLE user SCHEMAFULL;')

        const snapshotPath = `${root}/snapshot.json`
        await writeSnapshot(snapshotPath, ['user'])

        const report = await checkSchemaDrift(snapshotPath, schemaDir)
        assertEquals(report.passed, true)
        assertEquals(report.issues.length, 0)
      })
    })

    it('flags tables present in code but not in snapshot', async () => {
      await withTempDir(async (root) => {
        const schemaDir = `${root}/schemas`
        await Deno.mkdir(schemaDir, { recursive: true })
        await Deno.writeTextFile(
          `${schemaDir}/new.surql`,
          'DEFINE TABLE user SCHEMAFULL;\nDEFINE TABLE post SCHEMAFULL;',
        )

        const snapshotPath = `${root}/snapshot.json`
        await writeSnapshot(snapshotPath, ['user'])

        const report = await checkSchemaDrift(snapshotPath, schemaDir)
        assertEquals(report.passed, false)
        assertEquals(report.issues.length, 1)
        assertEquals(report.issues[0].objectName, 'post')
        assertEquals(report.issues[0].severity, 'error')
      })
    })

    it('flags tables present in snapshot but missing from code', async () => {
      await withTempDir(async (root) => {
        const schemaDir = `${root}/schemas`
        await Deno.mkdir(schemaDir, { recursive: true })
        await Deno.writeTextFile(`${schemaDir}/user.surql`, 'DEFINE TABLE user SCHEMAFULL;')

        const snapshotPath = `${root}/snapshot.json`
        await writeSnapshot(snapshotPath, ['user', 'post'])

        const report = await checkSchemaDrift(snapshotPath, schemaDir)
        assertEquals(report.passed, false)
        assertEquals(report.issues.some((i) => i.objectName === 'post'), true)
      })
    })

    it('passes with a missing snapshot file', async () => {
      await withTempDir(async (root) => {
        const schemaDir = `${root}/schemas`
        await Deno.mkdir(schemaDir, { recursive: true })
        const report = await checkSchemaDrift(`${root}/none.json`, schemaDir)
        assertEquals(report.passed, true)
        assertEquals(report.issues.length, 0)
      })
    })

    it('downgrades to warning severity when nonBlocking is set', async () => {
      await withTempDir(async (root) => {
        const schemaDir = `${root}/schemas`
        await Deno.mkdir(schemaDir, { recursive: true })
        await Deno.writeTextFile(`${schemaDir}/x.surql`, 'DEFINE TABLE extra SCHEMAFULL;')

        const snapshotPath = `${root}/snapshot.json`
        await writeSnapshot(snapshotPath, [])

        const report = await checkSchemaDrift(snapshotPath, schemaDir, { nonBlocking: true })
        assertEquals(report.passed, true)
        assertEquals(report.issues.length, 1)
        assertEquals(report.issues[0].severity, 'warning')
      })
    })
  })

  describe('generatePrecommitConfig', () => {
    it('produces a yaml snippet referencing the schema dir', () => {
      const cfg = generatePrecommitConfig('db/schema')
      assertStringIncludes(cfg, 'repos:')
      assertStringIncludes(cfg, 'id: surql-schema-drift')
      assertStringIncludes(cfg, 'db/schema')
    })

    it('respects snapshot path override', () => {
      const cfg = generatePrecommitConfig('db/schema', { snapshotPath: 'custom/snap.json' })
      assertStringIncludes(cfg, 'custom/snap.json')
    })
  })

  describe('getStagedSchemaFiles', () => {
    it('returns [] when git is not a repo', async () => {
      await withTempDir(async (root) => {
        const files = await getStagedSchemaFiles(root)
        assertEquals(Array.isArray(files), true)
        // Not a git repo => git exits non-zero => empty list
        assertEquals(files.length, 0)
      })
    })
  })
})
