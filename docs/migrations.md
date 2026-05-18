# Migrations

surql supports code-first schema migrations with up/down SQL generation, versioning, and multi-environment orchestration.

## Migration Structure

A migration is an object implementing the `Migration` interface:

```typescript
import type { Migration } from 'jsr:@oneiriq/surql'

const migration: Migration = {
  version: '20240101000001', // Sortable timestamp string
  description: 'create_users',
  up: () => Promise.resolve('DEFINE TABLE users SCHEMAFULL; DEFINE FIELD name ON TABLE users TYPE string;'),
  down: () => Promise.resolve('REMOVE TABLE users;'),
}
```

## Generating Migrations

### From Schema Diffs

`diffTables` compares two arrays of `TableDefinition` — the current schema and the target schema — and returns the operations needed to go from one to the other. `generateMigrationFromDiffs` turns those into migration SQL.

```typescript
import { diffTables, generateMigrationFromDiffs } from 'jsr:@oneiriq/surql'

// Diff an empty schema against the desired tables.
const diffs = diffTables([], [userSchema, postSchema])
const migration = generateMigrationFromDiffs(diffs, 'create_users_posts')

console.log(migration.filename) // e.g. 20240101000001_create_users_posts.surql
console.log(migration.upSql)
console.log(migration.downSql)
```

### Blank Migration

```typescript
import { createBlankMigration } from 'jsr:@oneiriq/surql'

const blank = createBlankMigration('add_index_to_users')
// blank.filename, blank.content (with -- UP / -- DOWN sections)
```

### Initial Migration

```typescript
import { generateInitialMigration } from 'jsr:@oneiriq/surql'

const initial = generateInitialMigration(
  'DEFINE TABLE users SCHEMAFULL;',
  'initial_schema',
)
```

## Running Migrations

`migrateUp` and `migrateDown` take a connected `Surreal` connection and the list of migrations. `migrateUp` applies every migration not yet recorded in the migration-history table and returns the statuses of the migrations it applied.

```typescript
import { migrateDown, migrateUp } from 'jsr:@oneiriq/surql'

// Apply all pending migrations.
const applied = await migrateUp(db, [migration1, migration2])
console.log(applied) // MigrationStatus[]

// Revert the most recent migrations down to a target version.
await migrateDown(db, [migration1, migration2], '20240101000001')
```

### Migration Status

```typescript
import { getAppliedVersions, getMigrationStatus, getPendingMigrations } from 'jsr:@oneiriq/surql'

const appliedVersions = await getAppliedVersions(db)
const status = getMigrationStatus(migrations, appliedVersions)
// MigrationStatus[] — each entry is APPLIED or PENDING

const pending = await getPendingMigrations(db, migrations)
```

### Applying Specific Versions

Both `migrateUp` and `migrateDown` accept an optional target version. `migrateUp` applies pending migrations up to and including the target; `migrateDown` reverts every applied migration above the target.

```typescript
// Apply pending migrations up to a specific version.
await migrateUp(db, migrations, '20240101000002')

// Revert down to a specific version.
await migrateDown(db, migrations, '20240101000001')
```

## Migration Discovery

Discover and load migrations from a directory of `.surql` (or `.ts`) files named `YYYYMMDDHHMMSS_description.surql`:

```typescript
import { discoverMigrations, loadMigration } from 'jsr:@oneiriq/surql'

const metadata = await discoverMigrations('./migrations')
const migrations = await Promise.all(
  metadata.map((m) => loadMigration(m.filepath)),
)
await migrateUp(db, migrations)
```

## Versioning

Migration versions are sortable 14-digit timestamps (`YYYYMMDDHHMMSS`). `generateMigrationFilename` produces a `<version>_<slug>.surql` filename for a new migration:

```typescript
import { generateMigrationFilename } from 'jsr:@oneiriq/surql'

const filename = generateMigrationFilename('add index to users')
// e.g. 20240101120000_add_index_to_users.surql
```

## Validation

Validate a set of migrations before applying them — `validateMigrations` reports duplicate versions and other consistency problems:

```typescript
import { validateMigrations } from 'jsr:@oneiriq/surql'

const issues = validateMigrations(migrations)
if (issues.length > 0) {
  console.error('Migration validation failed:', issues)
}
```

## Next Steps

- [Orchestration](orchestration.md) - Deploy migrations across multiple environments
- [Versioning & Rollback](versioning_rollback.md) - Rollback strategies
