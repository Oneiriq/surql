import { assertEquals, assertRejects } from '@std/assert'
import { afterEach, beforeEach, describe, it } from '@std/testing/bdd'
import { discoverMigrations, loadMigration, MigrationLoadError } from '../migration/discovery.ts'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await Deno.makeTempDir({ prefix: 'surql_disc_' })
})

afterEach(async () => {
  try {
    await Deno.remove(tmpDir, { recursive: true })
  } catch {
    // cleanup best-effort
  }
})

describe('loadMigration', () => {
  it('should load a .surql file as migration', async () => {
    const filepath = `${tmpDir}/20240101120000_create_users.surql`
    await Deno.writeTextFile(filepath, 'DEFINE TABLE users SCHEMAFULL;')

    const migration = await loadMigration(filepath)
    assertEquals(migration.version, '20240101120000')
    assertEquals(migration.description, 'create users')
    assertEquals(await migration.up(), 'DEFINE TABLE users SCHEMAFULL;')
    assertEquals((await migration.down()).includes('Rollback'), true)
  })

  it('should use file content as up() SQL for .surql', async () => {
    const sql =
      'DEFINE FIELD email ON TABLE users TYPE string;\nDEFINE INDEX idx_email ON TABLE users FIELDS email UNIQUE;'
    const filepath = `${tmpDir}/20240215090000_add_email_field.surql`
    await Deno.writeTextFile(filepath, sql)

    const migration = await loadMigration(filepath)
    assertEquals(await migration.up(), sql)
  })

  it('should generate rollback comment for .surql files', async () => {
    const filepath = `${tmpDir}/20240101120000_add_indexes.surql`
    await Deno.writeTextFile(filepath, 'DEFINE INDEX idx_name ON TABLE users FIELDS name;')

    const migration = await loadMigration(filepath)
    const down = await migration.down()
    assertEquals(down.includes('Rollback'), true)
    assertEquals(down.includes('add indexes'), true)
  })

  it('should reject invalid migration filename', async () => {
    const filepath = `${tmpDir}/invalid_name.surql`
    await Deno.writeTextFile(filepath, 'SELECT 1;')

    await assertRejects(
      () => loadMigration(filepath),
      MigrationLoadError,
      'Invalid migration filename',
    )
  })

  it('should reject unsupported file extension', async () => {
    const filepath = `${tmpDir}/20240101120000_test.js`
    await Deno.writeTextFile(filepath, 'export function up() {}')

    await assertRejects(
      () => loadMigration(filepath),
      MigrationLoadError,
      'Invalid migration filename',
    )
  })

  it('should reject uppercase in migration filename', async () => {
    const filepath = `${tmpDir}/20240101120000_Create_Users.surql`
    await Deno.writeTextFile(filepath, 'SELECT 1;')

    await assertRejects(
      () => loadMigration(filepath),
      MigrationLoadError,
      'Invalid migration filename',
    )
  })

  it('should extract correct version and description', async () => {
    const filepath = `${tmpDir}/20250317143000_add_user_profile_fields.surql`
    await Deno.writeTextFile(filepath, 'DEFINE FIELD bio ON TABLE users TYPE string;')

    const migration = await loadMigration(filepath)
    assertEquals(migration.version, '20250317143000')
    assertEquals(migration.description, 'add user profile fields')
  })
})

describe('discoverMigrations', () => {
  it('should discover .surql migration files', async () => {
    await Deno.writeTextFile(`${tmpDir}/20240101120000_first.surql`, 'SELECT 1;')
    await Deno.writeTextFile(`${tmpDir}/20240201120000_second.surql`, 'SELECT 2;')

    const results = await discoverMigrations(tmpDir)
    assertEquals(results.length, 2)
    assertEquals(results[0].version, '20240101120000')
    assertEquals(results[1].version, '20240201120000')
  })

  it('should discover .ts migration files', async () => {
    await Deno.writeTextFile(`${tmpDir}/20240101120000_first.ts`, 'export const up = () => ""')

    const results = await discoverMigrations(tmpDir)
    assertEquals(results.length, 1)
    assertEquals(results[0].filename, '20240101120000_first.ts')
  })

  it('should sort by timestamp ascending', async () => {
    await Deno.writeTextFile(`${tmpDir}/20240301120000_third.surql`, '')
    await Deno.writeTextFile(`${tmpDir}/20240101120000_first.surql`, '')
    await Deno.writeTextFile(`${tmpDir}/20240201120000_second.surql`, '')

    const results = await discoverMigrations(tmpDir)
    assertEquals(results[0].version, '20240101120000')
    assertEquals(results[1].version, '20240201120000')
    assertEquals(results[2].version, '20240301120000')
  })

  it('should skip invalid filenames', async () => {
    await Deno.writeTextFile(`${tmpDir}/20240101120000_valid.surql`, '')
    await Deno.writeTextFile(`${tmpDir}/readme.md`, '')
    await Deno.writeTextFile(`${tmpDir}/random_file.ts`, '')
    await Deno.writeTextFile(`${tmpDir}/INVALID.surql`, '')

    const results = await discoverMigrations(tmpDir)
    assertEquals(results.length, 1)
    assertEquals(results[0].version, '20240101120000')
  })

  it('should return empty for non-existent directory', async () => {
    const results = await discoverMigrations(`${tmpDir}/nonexistent`)
    assertEquals(results, [])
  })

  it('should return empty for empty directory', async () => {
    const results = await discoverMigrations(tmpDir)
    assertEquals(results, [])
  })

  it('should skip directories', async () => {
    await Deno.mkdir(`${tmpDir}/20240101120000_not_a_file.surql`)
    await Deno.writeTextFile(`${tmpDir}/20240101120000_real.surql`, '')

    const results = await discoverMigrations(tmpDir)
    assertEquals(results.length, 1)
  })

  it('should include filepath in metadata', async () => {
    await Deno.writeTextFile(`${tmpDir}/20240101120000_test.surql`, '')

    const results = await discoverMigrations(tmpDir)
    assertEquals(results[0].filepath, `${tmpDir}/20240101120000_test.surql`)
  })

  it('should include description in metadata', async () => {
    await Deno.writeTextFile(`${tmpDir}/20240101120000_create_user_table.surql`, '')

    const results = await discoverMigrations(tmpDir)
    assertEquals(results[0].description, 'create user table')
  })

  it('should include numeric timestamp in metadata', async () => {
    await Deno.writeTextFile(`${tmpDir}/20240101120000_test.surql`, '')

    const results = await discoverMigrations(tmpDir)
    assertEquals(results[0].timestamp, 20240101120000)
  })
})
