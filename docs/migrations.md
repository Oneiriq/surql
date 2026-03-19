# Migrations

surql supports code-first schema migrations with up/down SQL generation, versioning, and multi-environment orchestration.

## Migration Structure

A migration is an object implementing the `Migration` interface:

```typescript
import type { Migration } from 'jsr:@oneiriq/surql'

const migration: Migration = {
  version: '20240101000001',   // Sortable timestamp string
  description: 'create_users',
  up: async () => 'DEFINE TABLE users SCHEMAFULL; DEFINE FIELD name ON TABLE users TYPE string;',
  down: async () => 'REMOVE TABLE users;',
}
```

## Generating Migrations

### From Schema Diffs

```typescript
import {
  diffSchemas,
  generateMigrationFromDiffs,
} from 'jsr:@oneiriq/surql'

const before = { tables: [] }
const after = { tables: [userSchema, postSchema] }

const diffs = diffSchemas(before, after)
const migration = generateMigrationFromDiffs(diffs, 'create_users_posts')

console.log(migration.filename)  // e.g. 20240101000001_create_users_posts.surql
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

### MigrationRunner

```typescript
import { MigrationRunner } from 'jsr:@oneiriq/surql'

const runner = new MigrationRunner(client, [migration1, migration2])

// Apply all pending migrations
await runner.up()

// Roll back the last applied migration
await runner.down()

// Check status
const status = await runner.status()
console.log(status)  // { applied: string[], pending: string[] }
```

### Applying Specific Versions

```typescript
// Apply up to a specific version
await runner.upTo('20240101000002')

// Roll back to a specific version
await runner.downTo('20240101000001')
```

## Migration Discovery

Load migrations from `.surql` files:

```typescript
import { loadMigrationsFromDir } from 'jsr:@oneiriq/surql'

const migrations = await loadMigrationsFromDir('./migrations')
const runner = new MigrationRunner(client, migrations)
```

## Versioning

Migration versions use a sortable format: `YYYYMMDDHHMMSS`.

```typescript
import { generateVersion } from 'jsr:@oneiriq/surql'

const version = generateVersion()  // e.g. '20240101120000'
```

## Rollback

```typescript
import { RollbackManager } from 'jsr:@oneiriq/surql'

const manager = new RollbackManager(client, migrations)

// Rollback last N migrations
await manager.rollback(3)

// Rollback to checkpoint
await manager.rollbackTo('20240101000001')
```

## Validation

Validate a set of migrations before applying them:

```typescript
import { validateMigrations } from 'jsr:@oneiriq/surql'

const issues = validateMigrations(migrations)
if (issues.length > 0) {
  console.error('Migration validation failed:', issues)
}
```

## Next Steps

- [Orchestration](orchestration.md) - Deploy migrations across multiple environments
- [Versioning & Rollback](versioning_rollback.md) - Advanced rollback strategies
