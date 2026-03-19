import type { Surreal } from 'surrealdb'
import { executeMigration } from './executor.ts'
import type { Migration, SchemaDiff } from './models.ts'
import { DiffOperation, MigrationDirection } from './models.ts'

/**
 * Rollback safety level
 */
export enum RollbackSafety {
  SAFE = 'SAFE',
  WARNING = 'WARNING',
  UNSAFE = 'UNSAFE',
}

/**
 * Potential rollback issue
 */
export interface RollbackIssue {
  readonly migration: string
  readonly level: RollbackSafety
  readonly message: string
}

/**
 * Rollback plan
 */
export interface RollbackPlan {
  readonly migrations: readonly Migration[]
  readonly issues: readonly RollbackIssue[]
  readonly safety: RollbackSafety
}

/**
 * Rollback execution result
 */
export interface RollbackResult {
  readonly success: boolean
  readonly migrationsRolledBack: readonly string[]
  readonly error?: string
}

/**
 * Analyze rollback safety for a set of diffs
 */
export function analyzeRollbackSafety(diffs: SchemaDiff[]): RollbackSafety {
  const hasDataLoss = diffs.some((d) =>
    d.operation === DiffOperation.DROP_TABLE ||
    d.operation === DiffOperation.DROP_FIELD
  )

  if (hasDataLoss) return RollbackSafety.UNSAFE

  const hasStructuralChange = diffs.some((d) =>
    d.operation === DiffOperation.MODIFY_FIELD ||
    d.operation === DiffOperation.DROP_INDEX
  )

  if (hasStructuralChange) return RollbackSafety.WARNING

  return RollbackSafety.SAFE
}

/**
 * Create a rollback plan
 */
export function createRollbackPlan(
  migrations: Migration[],
  appliedVersions: Set<string>,
  targetVersion?: string,
): RollbackPlan {
  const toRollback = migrations
    .filter((m) => appliedVersions.has(m.version))
    .filter((m) => !targetVersion || m.version > targetVersion)
    .sort((a, b) => b.version.localeCompare(a.version))

  const issues: RollbackIssue[] = toRollback.map((m) => ({
    migration: m.version,
    level: RollbackSafety.WARNING,
    message: `Rolling back '${m.description}' may cause data loss`,
  }))

  const safety = issues.length === 0
    ? RollbackSafety.SAFE
    : issues.some((i) => i.level === RollbackSafety.UNSAFE)
    ? RollbackSafety.UNSAFE
    : RollbackSafety.WARNING

  return { migrations: toRollback, issues, safety }
}

/**
 * Plan rollback to a specific version
 */
export function planRollbackToVersion(
  migrations: Migration[],
  appliedVersions: Set<string>,
  targetVersion: string,
): RollbackPlan {
  return createRollbackPlan(migrations, appliedVersions, targetVersion)
}

/**
 * Execute a rollback plan against a database
 */
export async function executeRollback(
  db: Surreal,
  plan: RollbackPlan,
): Promise<RollbackResult> {
  const rolledBack: string[] = []

  try {
    for (const migration of plan.migrations) {
      await executeMigration(db, migration, MigrationDirection.DOWN)
      rolledBack.push(migration.version)
    }

    return { success: true, migrationsRolledBack: rolledBack }
  } catch (e) {
    return {
      success: false,
      migrationsRolledBack: rolledBack,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}
