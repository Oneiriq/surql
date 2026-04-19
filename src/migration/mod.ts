export { diffEdges, diffEvents, diffFields, diffIndexes, diffPermissions, diffTables } from './diff.ts'
export {
  discoverMigrations,
  generateMigrationFilename,
  getDescriptionFromFilename,
  getVersionFromFilename,
  loadMigration,
  MigrationDiscoveryError,
  MigrationLoadError,
  validateMigrationName,
} from './discovery.ts'
export {
  createMigrationPlan,
  executeMigration,
  executeMigrationPlan,
  getAppliedMigrationsOrdered,
  getPendingMigrations,
  migrateDown,
  migrateUp,
  MigrationExecutionError,
  validateMigrations,
} from './executor.ts'
export {
  createBlankMigration,
  generateInitialMigration,
  generateMigrationFromDiffs,
  MigrationGenerationError,
} from './generator.ts'
export {
  createMigrationTable,
  ensureMigrationTable,
  getAppliedMigrations,
  getAppliedVersions,
  getMigrationStatus,
  isMigrationApplied,
  MigrationHistoryError,
  recordMigration,
  removeMigrationRecord,
} from './history.ts'
export {
  DiffOperation,
  type Migration,
  MigrationDirection,
  type MigrationHistory,
  type MigrationMetadata,
  type MigrationPlan,
  MigrationState,
  type MigrationStatus,
  type SchemaDiff,
} from './models.ts'
export {
  analyzeRollbackSafety,
  createRollbackPlan,
  executeRollback,
  planRollbackToVersion,
  type RollbackIssue,
  type RollbackPlan,
  type RollbackResult,
  RollbackSafety,
} from './rollback.ts'
export {
  checkSchemaDrift,
  type CheckSchemaDriftOptions,
  defaultSchemaFilter,
  type DriftIssue,
  type DriftReport,
  type DriftSeverity,
  generatePrecommitConfig,
  type GeneratePrecommitConfigOptions,
  getStagedSchemaFiles,
} from './hooks.ts'
export { SquashError, squashMigrations, type SquashOptions, type SquashResult } from './squash.ts'
export { type WatchCallback, type WatchHandle, watchSchema, type WatchSchemaOptions } from './watcher.ts'
export {
  compareSnapshots,
  createSnapshot,
  deserializeSnapshot,
  listSnapshots,
  loadSnapshot,
  type SchemaSnapshot,
  serializeSnapshot,
  storeSnapshot,
} from './versioning.ts'
