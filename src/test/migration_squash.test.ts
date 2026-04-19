import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { SquashError, squashMigrations } from '../migration/squash.ts'

async function withTempDir(test: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: 'surql_squash_test_' })
  try {
    await test(dir)
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {})
  }
}

async function writeMigration(dir: string, version: string, slug: string, up: string, down = ''): Promise<void> {
  const content = ['-- UP', up, '', '-- DOWN', down, ''].join('\n')
  await Deno.writeTextFile(`${dir}/${version}_${slug}.surql`, content)
}

describe('Migration squash', () => {
  it('merges two consecutive migrations', async () => {
    await withTempDir(async (dir) => {
      await writeMigration(
        dir,
        '20260101120000',
        'create_user',
        'DEFINE TABLE user SCHEMAFULL;',
        'REMOVE TABLE user;',
      )
      await writeMigration(
        dir,
        '20260101130000',
        'add_email',
        'DEFINE FIELD email ON TABLE user TYPE string;',
        'REMOVE FIELD email ON TABLE user;',
      )

      const result = await squashMigrations(dir)
      assertEquals(result.originalCount, 2)
      assertEquals(result.statementCount, 2)
      assertEquals(result.originalVersions, ['20260101120000', '20260101130000'])
      assertStringIncludes(result.content, 'DEFINE TABLE user SCHEMAFULL;')
      assertStringIncludes(result.content, 'DEFINE FIELD email ON TABLE user TYPE string;')
      assertStringIncludes(result.content, '-- @squashed-from: 20260101120000..20260101130000')
      assertStringIncludes(result.content, '-- @checksum: sha256:')
    })
  })

  it('merges DOWN statements in reverse order', async () => {
    await withTempDir(async (dir) => {
      await writeMigration(dir, '20260101120000', 'a', 'DEFINE TABLE a;', 'REMOVE TABLE a;')
      await writeMigration(dir, '20260101130000', 'b', 'DEFINE TABLE b;', 'REMOVE TABLE b;')

      const result = await squashMigrations(dir)
      // The DOWN section should list REMOVE TABLE b; before REMOVE TABLE a;
      const downSection = result.content.split('-- DOWN')[1]
      const bIdx = downSection.indexOf('REMOVE TABLE b')
      const aIdx = downSection.indexOf('REMOVE TABLE a')
      assertEquals(bIdx >= 0, true)
      assertEquals(aIdx >= 0, true)
      assertEquals(bIdx < aIdx, true)
    })
  })

  it('respects fromVersion / toVersion bounds', async () => {
    await withTempDir(async (dir) => {
      await writeMigration(dir, '20260101110000', 'first', 'DEFINE TABLE a;')
      await writeMigration(dir, '20260101120000', 'second', 'DEFINE TABLE b;')
      await writeMigration(dir, '20260101130000', 'third', 'DEFINE TABLE c;')
      await writeMigration(dir, '20260101140000', 'fourth', 'DEFINE TABLE d;')

      const result = await squashMigrations(dir, '20260101120000', '20260101130000')
      assertEquals(result.originalCount, 2)
      assertEquals(result.originalVersions, ['20260101120000', '20260101130000'])
    })
  })

  it('stamps a fresh YYYYMMDDHHMMSS version', async () => {
    await withTempDir(async (dir) => {
      await writeMigration(dir, '20260101120000', 'a', 'DEFINE TABLE a;')
      await writeMigration(dir, '20260101130000', 'b', 'DEFINE TABLE b;')
      const result = await squashMigrations(dir)
      assertEquals(/^\d{14}$/.test(result.version), true)
    })
  })

  it('produces deterministic checksum for identical inputs', async () => {
    let r1Cs = ''
    let r2Cs = ''
    await withTempDir(async (dir) => {
      await writeMigration(dir, '20260101120000', 'a', 'DEFINE TABLE a;')
      await writeMigration(dir, '20260101130000', 'b', 'DEFINE TABLE b;')
      const r1 = await squashMigrations(dir, undefined, undefined, { dryRun: true })
      r1Cs = r1.checksum
    })
    await withTempDir(async (dir) => {
      await writeMigration(dir, '20260101120000', 'a', 'DEFINE TABLE a;')
      await writeMigration(dir, '20260101130000', 'b', 'DEFINE TABLE b;')
      const r2 = await squashMigrations(dir, undefined, undefined, { dryRun: true })
      r2Cs = r2.checksum
    })
    assertEquals(r1Cs, r2Cs)
  })

  it('dryRun does not write a file', async () => {
    await withTempDir(async (dir) => {
      await writeMigration(dir, '20260101120000', 'a', 'DEFINE TABLE a;')
      await writeMigration(dir, '20260101130000', 'b', 'DEFINE TABLE b;')
      const result = await squashMigrations(dir, undefined, undefined, { dryRun: true })
      await assertRejects(
        () => Deno.stat(result.squashedPath),
        Deno.errors.NotFound,
      )
    })
  })

  it('writes the squashed file to disk by default', async () => {
    await withTempDir(async (dir) => {
      await writeMigration(dir, '20260101120000', 'a', 'DEFINE TABLE a;')
      await writeMigration(dir, '20260101130000', 'b', 'DEFINE TABLE b;')
      const result = await squashMigrations(dir)
      const stat = await Deno.stat(result.squashedPath)
      assertEquals(stat.isFile, true)
    })
  })

  it('rejects when fewer than 2 migrations match', async () => {
    await withTempDir(async (dir) => {
      await writeMigration(dir, '20260101120000', 'solo', 'DEFINE TABLE a;')
      await assertRejects(() => squashMigrations(dir), SquashError)
    })
  })

  it('rejects empty directories', async () => {
    await withTempDir(async (dir) => {
      await assertRejects(() => squashMigrations(dir), SquashError)
    })
  })
})
