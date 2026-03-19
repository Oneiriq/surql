# Versioning & Rollback

surql provides versioning support and rollback capabilities for migration management.

## Migration Versioning

Migrations use sortable timestamp-based version strings (`YYYYMMDDHHMMSS`).

```typescript
import { generateVersion } from 'jsr:@oneiriq/surql'

const version = generateVersion()
// e.g. '20240101120000'
```

## MigrationRunner

```typescript
import { MigrationRunner } from 'jsr:@oneiriq/surql'

const runner = new MigrationRunner(client, migrations)

// View migration status
const status = await runner.status()
// { applied: string[], pending: string[] }

// Apply all pending migrations
await runner.up()

// Roll back the most recently applied migration
await runner.down()
```

## Targeted Rollback

```typescript
// Roll back to a specific version (inclusive rollback)
await runner.downTo('20240101000001')
```

## RollbackManager

For more granular control:

```typescript
import { RollbackManager } from 'jsr:@oneiriq/surql'

const manager = new RollbackManager(client, migrations)

// Roll back the last N applied migrations
await manager.rollback(3)

// Roll back to a named checkpoint
await manager.rollbackTo('20240101000001')
```

## Creating Rollback Checkpoints

```typescript
import { createCheckpoint } from 'jsr:@oneiriq/surql'

// Save current applied migration state as a checkpoint
await createCheckpoint(client, 'before_refactor')

// Restore from checkpoint
await manager.rollbackToCheckpoint('before_refactor')
```

## Version History

```typescript
const history = await runner.getHistory()
for (const entry of history) {
  console.log(`${entry.version} applied at ${entry.appliedAt}`)
}
```

## Validation Before Apply

```typescript
import { validateMigrations } from 'jsr:@oneiriq/surql'

const issues = validateMigrations(migrations)
if (issues.length > 0) {
  console.error('Validation failed:', issues)
  process.exit(1)
}

await runner.up()
```

## Best Practices

- Always write a `down` function for every migration
- Test rollback paths before applying to production
- Use `RollbackManager.rollback(1)` to verify `down()` works after each migration
- Run `validateMigrations()` in CI before deploying

## Next Steps

- [Orchestration](orchestration.md) - Deploy across multiple environments
- [Migrations](migrations.md) - Migration lifecycle reference
