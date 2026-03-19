import type { Surreal } from 'surrealdb'
import { intoSurQlError } from '../utils/surrealError.ts'
import { ensureMigrationTable, getAppliedVersions, recordMigration, removeMigrationRecord } from './history.ts'
import { type Migration, MigrationDirection, type MigrationPlan, type MigrationStatus } from './models.ts'

/**
 * Migration execution error
 */
export class MigrationExecutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MigrationExecutionError'
  }
}

/**
 * Execute a single migration
 */
export async function executeMigration(
  db: Surreal,
  migration: Migration,
  direction: MigrationDirection,
): Promise<void> {
  try {
    const sql = direction === MigrationDirection.UP ? await migration.up() : await migration.down()

    await db.query(sql)

    if (direction === MigrationDirection.UP) {
      await recordMigration(db, migration.version, migration.description, direction)
    } else {
      await removeMigrationRecord(db, migration.version)
    }
  } catch (e) {
    throw intoSurQlError(`Migration ${migration.version} (${direction}) failed:`, e)
  }
}

/**
 * Execute a migration plan
 */
export async function executeMigrationPlan(
  db: Surreal,
  plan: MigrationPlan,
): Promise<void> {
  for (const migration of plan.migrations) {
    await executeMigration(db, migration, plan.direction)
  }
}

/**
 * Apply all pending UP migrations
 */
export async function migrateUp(
  db: Surreal,
  migrations: Migration[],
  targetVersion?: string,
): Promise<MigrationStatus[]> {
  await ensureMigrationTable(db)
  const applied = await getAppliedVersions(db)
  const results: MigrationStatus[] = []

  const pending = migrations
    .filter((m) => !applied.has(m.version))
    .sort((a, b) => a.version.localeCompare(b.version))

  for (const migration of pending) {
    if (targetVersion && migration.version > targetVersion) break

    await executeMigration(db, migration, MigrationDirection.UP)
    results.push({
      version: migration.version,
      description: migration.description,
      state: 'APPLIED' as unknown as import('./models.ts').MigrationState,
      appliedAt: new Date(),
    })
  }

  return results
}

/**
 * Rollback migrations DOWN to a target version
 */
export async function migrateDown(
  db: Surreal,
  migrations: Migration[],
  targetVersion?: string,
): Promise<MigrationStatus[]> {
  await ensureMigrationTable(db)
  const applied = await getAppliedVersions(db)
  const results: MigrationStatus[] = []

  const toRollback = migrations
    .filter((m) => applied.has(m.version))
    .sort((a, b) => b.version.localeCompare(a.version))

  for (const migration of toRollback) {
    if (targetVersion && migration.version <= targetVersion) break

    await executeMigration(db, migration, MigrationDirection.DOWN)
    results.push({
      version: migration.version,
      description: migration.description,
      state: 'PENDING' as unknown as import('./models.ts').MigrationState,
    })
  }

  return results
}

/**
 * Get pending (unapplied) migrations
 */
export async function getPendingMigrations(
  db: Surreal,
  migrations: Migration[],
): Promise<Migration[]> {
  await ensureMigrationTable(db)
  const applied = await getAppliedVersions(db)
  return migrations.filter((m) => !applied.has(m.version))
}

/**
 * Create a migration plan for UP
 */
export function createMigrationPlan(
  migrations: Migration[],
  applied: Set<string>,
  direction: MigrationDirection,
  targetVersion?: string,
): MigrationPlan {
  let filtered: Migration[]

  if (direction === MigrationDirection.UP) {
    filtered = migrations
      .filter((m) => !applied.has(m.version))
      .sort((a, b) => a.version.localeCompare(b.version))
  } else {
    filtered = migrations
      .filter((m) => applied.has(m.version))
      .sort((a, b) => b.version.localeCompare(a.version))
  }

  if (targetVersion) {
    filtered = direction === MigrationDirection.UP
      ? filtered.filter((m) => m.version <= targetVersion)
      : filtered.filter((m) => m.version > targetVersion)
  }

  return { migrations: filtered, direction, targetVersion }
}

/**
 * Validate migration consistency (duplicate versions, missing deps)
 */
export function validateMigrations(migrations: Migration[]): string[] {
  const errors: string[] = []

  const versions = migrations.map((m) => m.version)
  const duplicates = versions.filter((v, i) => versions.indexOf(v) !== i)
  const uniqueDuplicates = [...new Set(duplicates)]

  if (uniqueDuplicates.length > 0) {
    errors.push(`Duplicate migration versions found: ${uniqueDuplicates.join(', ')}`)
  }

  return errors
}

/**
 * Get applied migrations in application order
 */
export async function getAppliedMigrationsOrdered(
  db: Surreal,
  migrations: Migration[],
): Promise<Migration[]> {
  const applied = await getAppliedVersions(db)
  return migrations
    .filter((m) => applied.has(m.version))
    .sort((a, b) => a.version.localeCompare(b.version))
}
