# API Reference

Complete reference for all exported symbols in `@oneiriq/surql`.

## Client

### SurQLClient

The main high-level client class.

```typescript
import { SurQLClient } from 'jsr:@oneiriq/surql'

const client = new SurQLClient({
  host: string
  port: string
  namespace: string
  database: string
  username: string
  password: string
})
```

**Methods:**

| Method | Returns | Description |
|--------|---------|-------------|
| `query<R, T>(table, hints?)` | `QueryBuilder<R, T>` | Build a SELECT query |
| `create<R, T>(table, data, hints?)` | `CreateQL<R, T>` | INSERT a record |
| `update<R, T>(table, id, data, hints?)` | `UpdateQL<R, T>` | REPLACE a record |
| `merge<R, T>(table, id, data, hints?)` | `MergeQL<R, T>` | Partial UPDATE |
| `upsert<R, T>(table, data, hints?)` | `UpsertQL<R, T>` | INSERT or UPDATE |
| `patch<R, T>(table, id, ops, hints?)` | `PatchQL<R, T>` | JSON Patch |
| `remove<R, T>(table, id, hints?)` | `DeleteQL<R, T>` | DELETE a record |
| `getConnection()` | `Promise<Surreal>` | Raw SurrealDB connection |
| `close()` | `Promise<void>` | Close the connection |
| `signin(credentials)` | `Promise<string>` | Authenticate |
| `signup(credentials)` | `Promise<string>` | Create scope user |
| `info()` | `Promise<SessionInfo>` | Current session info |
| `invalidate()` | `Promise<void>` | Sign out |
| `isAuthenticated()` | `boolean` | Check auth state |

## SurrealConnectionManager

Lower-level connection manager for multi-operation use.

```typescript
import { SurrealConnectionManager } from 'jsr:@oneiriq/surql'

const manager = new SurrealConnectionManager(config)
```

## Query Builders

### QueryBuilder

```typescript
builder.where(filter)           // Object filter or fluent condition
builder.whereEquals(field, val) // Equality filter
builder.whereContains(field, val)
builder.whereLike(field, val)
builder.orderBy(field, dir?)    // SortDirection.ASC | .DESC
builder.limit(n)
builder.offset(n)
builder.page(page, size)
builder.select(...fields)
builder.groupBy(...fields)
builder.count(field?)
builder.sum(field)
builder.avg(field)
builder.min(field)
builder.max(field)
builder.having(condition, op?, value?)
builder.map(fn)                 // Transform results
builder.withCache(cache, opts?)
builder.execute()               // Promise<T[]>
builder.first()                 // Promise<T | undefined>
```

## Schema

### Table

```typescript
tableSchema(name, mode?)
withFields(table, ...fields)
withIndexes(table, ...indexes)
withPermissions(table, perms)
withEvents(table, ...events)
index(name, field, opts?)
mtreeIndex(name, field, opts?)
event(name, when, then)
```

### Fields

```typescript
stringField(name, opts?)
intField(name, opts?)
floatField(name, opts?)
boolField(name, opts?)
datetimeField(name, opts?)
arrayField(name, opts?)
objectField(name, opts?)
recordField(name, table, opts?)
optionalField(field)
```

### Edges

```typescript
edgeSchema(name, mode)
withFromTable(edge, table)
withToTable(edge, table)
typedEdge(name, from, to)
```

### Visualization

```typescript
generateMermaid(schema)
generateGraphViz(schema, opts?)
generateAscii(schema)
validateSchema(schema)
```

### Migrations

```typescript
generateMigrationFromDiffs(diffs, description)
generateInitialMigration(upSql, description?)
createBlankMigration(description)
generateMigrationFilename(description)
diffTables(current, target)
diffEdges(oldEdge, newEdge)
migrateUp(db, migrations, targetVersion?)
migrateDown(db, migrations, targetVersion?)
createRollbackPlan(migrations, appliedVersions, targetVersion?)
executeRollback(db, plan)
validateMigrations(migrations)
```

## Orchestration

```typescript
new MigrationCoordinator(migrations)
coordinator.deploy(opts)
coordinator.checkHealth(envs)
deployToEnvironments(opts)
```

## Caching

```typescript
new QueryCache(opts)
cache.invalidate(key)
cache.clear()
cache.getStats()
```

## Types

```typescript
type Migration
type SchemaDefinition
type TableDefinition
type FieldDefinition
type EdgeDefinition
type SchemaDiff
type EnvironmentConfig
type DeploymentResult
type SessionInfo

enum TableMode
enum EdgeMode
enum DiffOperation
enum SortDirection
enum Op
enum DeploymentStatus
```

## Utilities

```typescript
type Serialized<T>
createSerializer<T>()
```
