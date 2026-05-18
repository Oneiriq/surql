# Versioning & Rollback

surql provides versioning support and rollback capabilities for migration management.

## Migration Versioning

Migrations use sortable 14-digit timestamp version strings (`YYYYMMDDHHMMSS`). `generateMigrationFilename` produces the `<version>_<slug>.surql` filename for a new migration; the version is its timestamp prefix.

```typescript
import { generateMigrationFilename } from 'jsr:@oneiriq/surql'

const filename = generateMigrationFilename('add user roles')
// e.g. 20240101120000_add_user_roles.surql
```

## Applying and Reverting Migrations

`migrateUp` applies every pending migration; `migrateDown` reverts applied migrations down to a target version (or all of them when no target is given).

```typescript
import { getAppliedVersions, getMigrationStatus, migrateDown, migrateUp } from 'jsr:@oneiriq/surql'

// Apply all pending migrations.
await migrateUp(db, migrations)

// Inspect what is applied vs pending.
const status = getMigrationStatus(migrations, await getAppliedVersions(db))

// Revert the most recent migration(s) down to a target version.
await migrateDown(db, migrations, '20240101000001')
```

## Rollback Planning

For a controlled rollback, build a plan first. `createRollbackPlan` selects the applied migrations to revert and reports a safety assessment; `executeRollback` runs the plan and returns which migrations were reverted.

```typescript
import {
  createRollbackPlan,
  executeRollback,
  getAppliedVersions,
} from 'jsr:@oneiriq/surql'

const appliedVersions = await getAppliedVersions(db)

// Plan a rollback down to a target version (omit the version to revert all).
const plan = createRollbackPlan(migrations, appliedVersions, '20240101000001')

console.log(plan.safety) // SAFE | WARNING | UNSAFE
console.log(plan.issues) // RollbackIssue[] — per-migration warnings

if (plan.safety !== 'UNSAFE') {
  const result = await executeRollback(db, plan)
  console.log(result.success, result.migrationsRolledBack)
}
```

`planRollbackToVersion(migrations, appliedVersions, targetVersion)` is a convenience wrapper that always requires an explicit target version.

## Rollback Safety

`analyzeRollbackSafety` classifies a set of schema diffs as `SAFE`, `WARNING`, or `UNSAFE` — a diff that drops a table or field is `UNSAFE`. Use it to gate a rollback in CI:

```typescript
import { analyzeRollbackSafety } from 'jsr:@oneiriq/surql'

const safety = analyzeRollbackSafety(diffs)
if (safety === 'UNSAFE') {
  console.error('Rollback would drop data — aborting')
}
```

## Version History

```typescript
import { getAppliedMigrations } from 'jsr:@oneiriq/surql'

const history = await getAppliedMigrations(db)
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
}

await migrateUp(db, migrations)
```

## Best Practices

- Always write a `down` function for every migration
- Test rollback paths before applying to production
- Inspect `createRollbackPlan(...).safety` before reverting in production
- Run `validateMigrations()` in CI before deploying

## Next Steps

- [Orchestration](orchestration.md) - Deploy across multiple environments
- [Migrations](migrations.md) - Migration lifecycle reference
