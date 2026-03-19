import { assertEquals } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import {
  analyzeRollbackSafety,
  createRollbackPlan,
  planRollbackToVersion,
  RollbackSafety,
} from '../migration/rollback.ts'
import { DiffOperation, type Migration } from '../migration/models.ts'
import type { SchemaDiff } from '../migration/models.ts'

function makeMigration(version: string, description: string): Migration {
  return {
    version,
    description,
    up: () => Promise.resolve(`-- up ${version}`),
    down: () => Promise.resolve(`-- down ${version}`),
  }
}

describe('analyzeRollbackSafety - extended', () => {
  it('should return SAFE for add-only operations', () => {
    const diffs: SchemaDiff[] = [
      { operation: DiffOperation.ADD_TABLE, table: 'users', details: '', sql: '' },
      { operation: DiffOperation.ADD_FIELD, table: 'users', field: 'name', details: '', sql: '' },
      { operation: DiffOperation.ADD_INDEX, table: 'users', details: '', sql: '' },
      { operation: DiffOperation.ADD_EVENT, table: 'users', details: '', sql: '' },
    ]
    assertEquals(analyzeRollbackSafety(diffs), RollbackSafety.SAFE)
  })

  it('should return UNSAFE for DROP_FIELD', () => {
    const diffs: SchemaDiff[] = [
      { operation: DiffOperation.DROP_FIELD, table: 'users', field: 'name', details: '', sql: '' },
    ]
    assertEquals(analyzeRollbackSafety(diffs), RollbackSafety.UNSAFE)
  })

  it('should return UNSAFE for DROP_TABLE', () => {
    const diffs: SchemaDiff[] = [
      { operation: DiffOperation.DROP_TABLE, table: 'users', details: '', sql: '' },
    ]
    assertEquals(analyzeRollbackSafety(diffs), RollbackSafety.UNSAFE)
  })

  it('should return WARNING for MODIFY_FIELD', () => {
    const diffs: SchemaDiff[] = [
      { operation: DiffOperation.MODIFY_FIELD, table: 'users', field: 'age', details: '', sql: '' },
    ]
    assertEquals(analyzeRollbackSafety(diffs), RollbackSafety.WARNING)
  })

  it('should return WARNING for DROP_INDEX', () => {
    const diffs: SchemaDiff[] = [
      { operation: DiffOperation.DROP_INDEX, table: 'users', details: '', sql: '' },
    ]
    assertEquals(analyzeRollbackSafety(diffs), RollbackSafety.WARNING)
  })

  it('should return UNSAFE when both WARNING and UNSAFE ops present', () => {
    const diffs: SchemaDiff[] = [
      { operation: DiffOperation.MODIFY_FIELD, table: 'users', field: 'age', details: '', sql: '' },
      { operation: DiffOperation.DROP_TABLE, table: 'old_table', details: '', sql: '' },
    ]
    assertEquals(analyzeRollbackSafety(diffs), RollbackSafety.UNSAFE)
  })

  it('should return SAFE for empty diffs', () => {
    assertEquals(analyzeRollbackSafety([]), RollbackSafety.SAFE)
  })

  it('should return SAFE for DROP_EVENT only', () => {
    const diffs: SchemaDiff[] = [
      { operation: DiffOperation.DROP_EVENT, table: 'users', details: '', sql: '' },
    ]
    assertEquals(analyzeRollbackSafety(diffs), RollbackSafety.SAFE)
  })
})

describe('createRollbackPlan - extended', () => {
  const migrations = [
    makeMigration('001', 'create users'),
    makeMigration('002', 'add posts'),
    makeMigration('003', 'add comments'),
    makeMigration('004', 'add likes'),
  ]

  it('should rollback all when no target version', () => {
    const applied = new Set(['001', '002', '003', '004'])
    const plan = createRollbackPlan(migrations, applied)
    assertEquals(plan.migrations.length, 4)
    assertEquals(plan.migrations[0].version, '004')
    assertEquals(plan.migrations[3].version, '001')
  })

  it('should rollback to target version (exclusive)', () => {
    const applied = new Set(['001', '002', '003', '004'])
    const plan = createRollbackPlan(migrations, applied, '002')
    assertEquals(plan.migrations.length, 2)
    assertEquals(plan.migrations[0].version, '004')
    assertEquals(plan.migrations[1].version, '003')
  })

  it('should skip unapplied migrations', () => {
    const applied = new Set(['001', '003'])
    const plan = createRollbackPlan(migrations, applied)
    assertEquals(plan.migrations.length, 2)
    assertEquals(plan.migrations[0].version, '003')
    assertEquals(plan.migrations[1].version, '001')
  })

  it('should return empty plan when nothing applied', () => {
    const plan = createRollbackPlan(migrations, new Set())
    assertEquals(plan.migrations.length, 0)
    assertEquals(plan.safety, RollbackSafety.SAFE)
    assertEquals(plan.issues.length, 0)
  })

  it('should generate warning issues for each migration', () => {
    const applied = new Set(['001', '002'])
    const plan = createRollbackPlan(migrations, applied)
    assertEquals(plan.issues.length, 2)
    assertEquals(plan.issues[0].level, RollbackSafety.WARNING)
    assertEquals(plan.issues[0].message.includes('data loss'), true)
  })

  it('should set safety to WARNING when there are issues', () => {
    const applied = new Set(['001'])
    const plan = createRollbackPlan(migrations, applied)
    assertEquals(plan.safety, RollbackSafety.WARNING)
  })

  it('should order rollback in reverse version order', () => {
    const applied = new Set(['001', '002', '003', '004'])
    const plan = createRollbackPlan(migrations, applied, '001')
    for (let i = 0; i < plan.migrations.length - 1; i++) {
      assertEquals(plan.migrations[i].version > plan.migrations[i + 1].version, true)
    }
  })
})

describe('planRollbackToVersion', () => {
  const migrations = [
    makeMigration('001', 'first'),
    makeMigration('002', 'second'),
    makeMigration('003', 'third'),
  ]

  it('should delegate to createRollbackPlan', () => {
    const applied = new Set(['001', '002', '003'])
    const plan = planRollbackToVersion(migrations, applied, '001')
    assertEquals(plan.migrations.length, 2)
    assertEquals(plan.migrations[0].version, '003')
    assertEquals(plan.migrations[1].version, '002')
  })

  it('should handle rollback to latest version (no-op)', () => {
    const applied = new Set(['001', '002', '003'])
    const plan = planRollbackToVersion(migrations, applied, '003')
    assertEquals(plan.migrations.length, 0)
  })

  it('should handle target version before any applied', () => {
    const applied = new Set(['001', '002', '003'])
    const plan = planRollbackToVersion(migrations, applied, '000')
    assertEquals(plan.migrations.length, 3)
  })
})
