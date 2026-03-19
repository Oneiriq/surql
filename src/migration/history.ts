import type { Surreal } from 'surrealdb'
import { intoSurQlError } from '../utils/surrealError.ts'
import { type MigrationDirection, type MigrationHistory, MigrationState, type MigrationStatus } from './models.ts'

const MIGRATION_TABLE = '_migrations'

/**
 * Migration history error
 */
export class MigrationHistoryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MigrationHistoryError'
  }
}

/**
 * Create the migrations tracking table
 */
export async function createMigrationTable(db: Surreal): Promise<void> {
  try {
    await db.query(`
      DEFINE TABLE IF NOT EXISTS ${MIGRATION_TABLE} SCHEMAFULL;
      DEFINE FIELD IF NOT EXISTS version ON TABLE ${MIGRATION_TABLE} TYPE string;
      DEFINE FIELD IF NOT EXISTS description ON TABLE ${MIGRATION_TABLE} TYPE string;
      DEFINE FIELD IF NOT EXISTS applied_at ON TABLE ${MIGRATION_TABLE} TYPE datetime DEFAULT time::now();
      DEFINE FIELD IF NOT EXISTS direction ON TABLE ${MIGRATION_TABLE} TYPE string;
      DEFINE FIELD IF NOT EXISTS checksum ON TABLE ${MIGRATION_TABLE} TYPE option<string>;
      DEFINE INDEX IF NOT EXISTS idx_version ON TABLE ${MIGRATION_TABLE} FIELDS version UNIQUE;
    `)
  } catch (e) {
    throw intoSurQlError('Failed to create migration table:', e)
  }
}

/**
 * Ensure the migration table exists
 */
export async function ensureMigrationTable(db: Surreal): Promise<void> {
  await createMigrationTable(db)
}

/**
 * Record an applied migration
 */
export async function recordMigration(
  db: Surreal,
  version: string,
  description: string,
  direction: MigrationDirection,
  checksum?: string,
): Promise<void> {
  try {
    if (checksum) {
      await db.query(
        `CREATE ${MIGRATION_TABLE} SET version = $version, description = $description, direction = $direction, checksum = $checksum`,
        { version, description, direction, checksum },
      )
    } else {
      await db.query(
        `CREATE ${MIGRATION_TABLE} SET version = $version, description = $description, direction = $direction, checksum = NONE`,
        { version, description, direction },
      )
    }
  } catch (e) {
    throw intoSurQlError('Failed to record migration:', e)
  }
}

/**
 * Remove a migration record (for rollback)
 */
export async function removeMigrationRecord(db: Surreal, version: string): Promise<void> {
  try {
    await db.query(`DELETE ${MIGRATION_TABLE} WHERE version = $version`, { version })
  } catch (e) {
    throw intoSurQlError('Failed to remove migration record:', e)
  }
}

/**
 * Get all applied migrations
 */
export async function getAppliedMigrations(db: Surreal): Promise<MigrationHistory[]> {
  try {
    const results = await db.query<MigrationHistory[]>(
      `SELECT * FROM ${MIGRATION_TABLE} ORDER BY version ASC`,
    ) as unknown as MigrationHistory[][]
    return (results[0] || []).map((r) => ({
      version: r.version,
      description: r.description,
      appliedAt: new Date(r.appliedAt as unknown as string),
      direction: r.direction,
      checksum: r.checksum,
    }))
  } catch (e) {
    throw intoSurQlError('Failed to get applied migrations:', e)
  }
}

/**
 * Get applied migration versions as a set
 */
export async function getAppliedVersions(db: Surreal): Promise<Set<string>> {
  const migrations = await getAppliedMigrations(db)
  return new Set(migrations.map((m) => m.version))
}

/**
 * Check if a specific migration is applied
 */
export async function isMigrationApplied(db: Surreal, version: string): Promise<boolean> {
  const versions = await getAppliedVersions(db)
  return versions.has(version)
}

/**
 * Get the full migration history with statuses
 */
export function getMigrationStatus(
  discovered: Array<{ version: string; description: string }>,
  applied: Set<string>,
): MigrationStatus[] {
  return discovered.map((m) => ({
    version: m.version,
    description: m.description,
    state: applied.has(m.version) ? MigrationState.APPLIED : MigrationState.PENDING,
  }))
}
