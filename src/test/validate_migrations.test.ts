import { assertEquals } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { createMigrationPlan, validateMigrations } from '../migration/executor.ts'
import { type Migration, MigrationDirection } from '../migration/models.ts'

function makeMigration(version: string, description: string): Migration {
  return {
    version,
    description,
    up: () => Promise.resolve(`-- up ${version}`),
    down: () => Promise.resolve(`-- down ${version}`),
  }
}

describe('validateMigrations', () => {
  it('should return empty errors for unique versions', () => {
    const migrations = [
      makeMigration('001', 'first'),
      makeMigration('002', 'second'),
      makeMigration('003', 'third'),
    ]
    const errors = validateMigrations(migrations)
    assertEquals(errors.length, 0)
  })

  it('should detect a single duplicate version', () => {
    const migrations = [
      makeMigration('001', 'first'),
      makeMigration('002', 'second'),
      makeMigration('001', 'duplicate of first'),
    ]
    const errors = validateMigrations(migrations)
    assertEquals(errors.length, 1)
    assertEquals(errors[0].includes('001'), true)
    assertEquals(errors[0].includes('Duplicate'), true)
  })

  it('should detect multiple duplicate versions', () => {
    const migrations = [
      makeMigration('001', 'first'),
      makeMigration('002', 'second'),
      makeMigration('001', 'dup first'),
      makeMigration('002', 'dup second'),
    ]
    const errors = validateMigrations(migrations)
    assertEquals(errors.length, 1)
    assertEquals(errors[0].includes('001'), true)
    assertEquals(errors[0].includes('002'), true)
  })

  it('should return empty errors for empty list', () => {
    const errors = validateMigrations([])
    assertEquals(errors.length, 0)
  })

  it('should return empty errors for single migration', () => {
    const errors = validateMigrations([makeMigration('001', 'only one')])
    assertEquals(errors.length, 0)
  })

  it('should only report each duplicate version once', () => {
    const migrations = [
      makeMigration('001', 'first'),
      makeMigration('001', 'dup1'),
      makeMigration('001', 'dup2'),
    ]
    const errors = validateMigrations(migrations)
    assertEquals(errors.length, 1)
    // Should mention 001 once in the error message
    assertEquals(errors[0].includes('001'), true)
  })
})

describe('createMigrationPlan', () => {
  const migrations = [
    makeMigration('001', 'first'),
    makeMigration('002', 'second'),
    makeMigration('003', 'third'),
    makeMigration('004', 'fourth'),
  ]

  it('should create UP plan filtering out applied', () => {
    const applied = new Set(['001', '002'])
    const plan = createMigrationPlan(migrations, applied, MigrationDirection.UP)
    assertEquals(plan.direction, MigrationDirection.UP)
    assertEquals(plan.migrations.length, 2)
    assertEquals(plan.migrations[0].version, '003')
    assertEquals(plan.migrations[1].version, '004')
  })

  it('should create DOWN plan including only applied in reverse order', () => {
    const applied = new Set(['001', '002', '003'])
    const plan = createMigrationPlan(migrations, applied, MigrationDirection.DOWN)
    assertEquals(plan.direction, MigrationDirection.DOWN)
    assertEquals(plan.migrations.length, 3)
    assertEquals(plan.migrations[0].version, '003')
    assertEquals(plan.migrations[1].version, '002')
    assertEquals(plan.migrations[2].version, '001')
  })

  it('should respect target version for UP', () => {
    const applied = new Set<string>()
    const plan = createMigrationPlan(migrations, applied, MigrationDirection.UP, '002')
    assertEquals(plan.migrations.length, 2)
    assertEquals(plan.migrations[0].version, '001')
    assertEquals(plan.migrations[1].version, '002')
  })

  it('should respect target version for DOWN', () => {
    const applied = new Set(['001', '002', '003', '004'])
    const plan = createMigrationPlan(migrations, applied, MigrationDirection.DOWN, '002')
    assertEquals(plan.migrations.length, 2)
    assertEquals(plan.migrations[0].version, '004')
    assertEquals(plan.migrations[1].version, '003')
  })

  it('should handle empty migrations list', () => {
    const plan = createMigrationPlan([], new Set(), MigrationDirection.UP)
    assertEquals(plan.migrations.length, 0)
  })

  it('should handle all already applied for UP', () => {
    const applied = new Set(['001', '002', '003', '004'])
    const plan = createMigrationPlan(migrations, applied, MigrationDirection.UP)
    assertEquals(plan.migrations.length, 0)
  })

  it('should handle none applied for DOWN', () => {
    const plan = createMigrationPlan(migrations, new Set(), MigrationDirection.DOWN)
    assertEquals(plan.migrations.length, 0)
  })

  it('should store targetVersion in plan', () => {
    const plan = createMigrationPlan(migrations, new Set(), MigrationDirection.UP, '003')
    assertEquals(plan.targetVersion, '003')
  })
})
