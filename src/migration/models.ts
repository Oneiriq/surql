/**
 * Migration state
 */
export enum MigrationState {
  PENDING = 'PENDING',
  APPLIED = 'APPLIED',
  FAILED = 'FAILED',
}

/**
 * Migration direction
 */
export enum MigrationDirection {
  UP = 'UP',
  DOWN = 'DOWN',
}

/**
 * Diff operation type
 */
export enum DiffOperation {
  ADD_TABLE = 'ADD_TABLE',
  DROP_TABLE = 'DROP_TABLE',
  ADD_FIELD = 'ADD_FIELD',
  DROP_FIELD = 'DROP_FIELD',
  MODIFY_FIELD = 'MODIFY_FIELD',
  ADD_INDEX = 'ADD_INDEX',
  DROP_INDEX = 'DROP_INDEX',
  ADD_EVENT = 'ADD_EVENT',
  DROP_EVENT = 'DROP_EVENT',
  MODIFY_PERMISSIONS = 'MODIFY_PERMISSIONS',
}

/**
 * A single schema difference
 */
export interface SchemaDiff {
  readonly operation: DiffOperation
  readonly table: string
  readonly field?: string
  readonly details: string
  readonly sql: string
}

/**
 * Migration definition
 */
export interface Migration {
  readonly version: string
  readonly description: string
  readonly up: () => Promise<string>
  readonly down: () => Promise<string>
}

/**
 * Record of an applied migration
 */
export interface MigrationHistory {
  readonly version: string
  readonly description: string
  readonly appliedAt: Date
  readonly direction: MigrationDirection
  readonly checksum?: string
}

/**
 * Migration file metadata
 */
export interface MigrationMetadata {
  readonly version: string
  readonly description: string
  readonly filename: string
  readonly filepath: string
  readonly timestamp: number
}

/**
 * Migration execution plan
 */
export interface MigrationPlan {
  readonly migrations: readonly Migration[]
  readonly direction: MigrationDirection
  readonly targetVersion?: string
}

/**
 * Migration status entry
 */
export interface MigrationStatus {
  readonly version: string
  readonly description: string
  readonly state: MigrationState
  readonly appliedAt?: Date
}
