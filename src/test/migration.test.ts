import { assertEquals, assertThrows } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import {
  analyzeRollbackSafety,
  compareSnapshots,
  createMigrationPlan,
  createRollbackPlan,
  createSnapshot,
  deserializeSnapshot,
  DiffOperation,
  diffTables,
  generateMigrationFilename,
  generateMigrationFromDiffs,
  getDescriptionFromFilename,
  getVersionFromFilename,
  MigrationDirection,
  RollbackSafety,
  serializeSnapshot,
  validateMigrationName,
} from '../migration/mod.ts'
import { intField, stringField } from '../schema/fields.ts'
import { tableSchema, withFields } from '../schema/table.ts'

describe('Migration System', () => {
  describe('Discovery', () => {
    it('should validate migration filenames', () => {
      assertEquals(validateMigrationName('20240101120000_create_users.surql'), true)
      assertEquals(validateMigrationName('20240101120000_add_email.ts'), true)
      assertEquals(validateMigrationName('invalid.ts'), false)
      assertEquals(validateMigrationName('20240101120000_UPPER.surql'), false)
    })

    it('should extract version from filename', () => {
      assertEquals(getVersionFromFilename('20240101120000_create_users.surql'), '20240101120000')
    })

    it('should extract description from filename', () => {
      assertEquals(getDescriptionFromFilename('20240101120000_create_users.surql'), 'create users')
    })

    it('should generate migration filename', () => {
      const filename = generateMigrationFilename('create users')
      assertEquals(filename.endsWith('_create_users.surql'), true)
      assertEquals(filename.length > 20, true)
    })
  })

  describe('Diff', () => {
    it('should detect added tables', () => {
      const current: ReturnType<typeof tableSchema>[] = []
      const target = [tableSchema('users')]
      const diffs = diffTables(current, target)
      assertEquals(diffs.length, 1)
      assertEquals(diffs[0].operation, DiffOperation.ADD_TABLE)
    })

    it('should detect dropped tables', () => {
      const current = [tableSchema('users')]
      const target: ReturnType<typeof tableSchema>[] = []
      const diffs = diffTables(current, target)
      assertEquals(diffs.length, 1)
      assertEquals(diffs[0].operation, DiffOperation.DROP_TABLE)
    })

    it('should detect added fields', () => {
      const current = [withFields(tableSchema('users'), stringField('name'))]
      const target = [withFields(tableSchema('users'), stringField('name'), intField('age'))]
      const diffs = diffTables(current, target)
      assertEquals(diffs.some((d) => d.operation === DiffOperation.ADD_FIELD), true)
    })

    it('should detect dropped fields', () => {
      const current = [withFields(tableSchema('users'), stringField('name'), intField('age'))]
      const target = [withFields(tableSchema('users'), stringField('name'))]
      const diffs = diffTables(current, target)
      assertEquals(diffs.some((d) => d.operation === DiffOperation.DROP_FIELD), true)
    })
  })

  describe('Generator', () => {
    it('should generate migration from diffs', () => {
      const diffs = [{
        operation: DiffOperation.ADD_TABLE,
        table: 'users',
        details: 'Add table users',
        sql: 'DEFINE TABLE users SCHEMAFULL;',
      }]
      const result = generateMigrationFromDiffs(diffs, 'create users')
      assertEquals(result.upSql.includes('DEFINE TABLE users'), true)
      assertEquals(result.filename.endsWith('_create_users.surql'), true)
    })

    it('should throw on empty diffs', () => {
      assertThrows(
        () => generateMigrationFromDiffs([], 'empty'),
        Error,
        'No schema differences found',
      )
    })
  })

  describe('Migration Plan', () => {
    const migrations = [
      { version: '001', description: 'first', up: () => Promise.resolve(''), down: () => Promise.resolve('') },
      { version: '002', description: 'second', up: () => Promise.resolve(''), down: () => Promise.resolve('') },
      { version: '003', description: 'third', up: () => Promise.resolve(''), down: () => Promise.resolve('') },
    ]

    it('should create UP plan excluding applied', () => {
      const applied = new Set(['001'])
      const plan = createMigrationPlan(migrations, applied, MigrationDirection.UP)
      assertEquals(plan.migrations.length, 2)
      assertEquals(plan.migrations[0].version, '002')
    })

    it('should create DOWN plan for applied only', () => {
      const applied = new Set(['001', '002', '003'])
      const plan = createMigrationPlan(migrations, applied, MigrationDirection.DOWN)
      assertEquals(plan.migrations.length, 3)
      assertEquals(plan.migrations[0].version, '003')
    })

    it('should respect target version', () => {
      const applied = new Set<string>()
      const plan = createMigrationPlan(migrations, applied, MigrationDirection.UP, '002')
      assertEquals(plan.migrations.length, 2)
    })
  })

  describe('Rollback', () => {
    it('should analyze safety as SAFE for no data loss', () => {
      const diffs = [{
        operation: DiffOperation.ADD_INDEX,
        table: 'users',
        details: 'Add index',
        sql: '',
      }]
      assertEquals(analyzeRollbackSafety(diffs), RollbackSafety.SAFE)
    })

    it('should analyze safety as UNSAFE for table drops', () => {
      const diffs = [{
        operation: DiffOperation.DROP_TABLE,
        table: 'users',
        details: 'Drop table',
        sql: '',
      }]
      assertEquals(analyzeRollbackSafety(diffs), RollbackSafety.UNSAFE)
    })

    it('should create rollback plan', () => {
      const migrations = [
        { version: '001', description: 'first', up: () => Promise.resolve(''), down: () => Promise.resolve('') },
        { version: '002', description: 'second', up: () => Promise.resolve(''), down: () => Promise.resolve('') },
      ]
      const plan = createRollbackPlan(migrations, new Set(['001', '002']), '001')
      assertEquals(plan.migrations.length, 1)
      assertEquals(plan.migrations[0].version, '002')
    })
  })

  describe('Versioning', () => {
    it('should create and serialize snapshots', () => {
      const tables = [withFields(tableSchema('users'), stringField('name'))]
      const snapshot = createSnapshot('v1', tables, [])
      assertEquals(snapshot.version, 'v1')
      assertEquals(snapshot.tables.length, 1)

      const json = serializeSnapshot(snapshot)
      const restored = deserializeSnapshot(json)
      assertEquals(restored.version, 'v1')
    })

    it('should compare snapshots', () => {
      const a = createSnapshot('v1', [tableSchema('users')], [])
      const b = createSnapshot('v2', [tableSchema('users'), tableSchema('posts')], [])
      const diff = compareSnapshots(a, b)
      assertEquals(diff.added, ['posts'])
      assertEquals(diff.removed.length, 0)
    })
  })
})
