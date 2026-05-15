# SurrealDB v3 Patterns

surql targets **SurrealDB v3** for integration testing and CI (pinned to `surrealdb/surrealdb:v3.0.5`). Several SurrealQL behaviours changed between v1/v2 and v3; surql emits v3-valid SurrealQL by default and wraps the awkward bits in first-class helpers. This page documents the patterns you must follow to produce v3-valid SurrealQL.

## Buffered `BEGIN` / `COMMIT`

SurrealDB v3 **rejects bare `COMMIT TRANSACTION` / `CANCEL TRANSACTION` statements when they are sent as isolated RPC requests**. A transaction must be submitted as a single `BEGIN ... COMMIT` batch in one `query()` call.

surql handles this for you by buffering every call to `Transaction.execute()` client-side and flushing the batch on `commit()`:

```typescript
import { transaction } from 'jsr:@oneiriq/surql'

const tx = transaction(db)
await tx.begin()
await tx.execute('CREATE user SET name = $name', { name: 'Alice' })
await tx.execute('CREATE user SET name = $name', { name: 'Bob' })
await tx.commit() // issues BEGIN TRANSACTION; ...; COMMIT TRANSACTION; in one RPC
```

!!! warning "Do not stream statements"
    Splitting `BEGIN TRANSACTION` and `COMMIT TRANSACTION` across separate `db.query()` calls worked on v1/v2 but is rejected on v3 with a `Found COMMIT TRANSACTION, but ...` parse error.

`Transaction.cancel()` discards the buffer client-side without ever contacting the server. `Transaction` also implements `Symbol.asyncDispose` so `await using tx = transaction(db)` auto-cancels if the block exits without committing.

## `IF NOT EXISTS` for idempotent `DEFINE`

SurrealDB v3 supports `IF NOT EXISTS` on `DEFINE TABLE`, `DEFINE FIELD`, `DEFINE ACCESS`, etc. surql's SQL emitters accept an `ifNotExists` option so generated schemas can be re-applied against a live database without `Table ... already exists` errors:

```typescript
import {
  generateAccessSql,
  generateEdgeSql,
  generateSchemaSql,
  generateTableSql,
} from 'jsr:@oneiriq/surql'

generateTableSql(userTable, { ifNotExists: true })
// → DEFINE TABLE IF NOT EXISTS user SCHEMAFULL;
//   DEFINE FIELD name ON TABLE user TYPE string;
//   ...

generateEdgeSql(authored, { ifNotExists: true })
generateAccessSql(jwtAccess, 'DATABASE', { ifNotExists: true })

generateSchemaSql({
  tables: [userTable, postTable],
  edges: [authored],
  access: [jwtAccess],
  ifNotExists: true,
})
```

`ifNotExists` also applies to the secondary `DEFINE TABLE ... PERMISSIONS` line when table-level permissions are configured.

## Unrolled graph depth

SurrealDB v3 dropped the `<depth>` suffix that v1/v2 accepted on edge traversals (`user:alice->follows2`). The `GraphQuery` builder emits v3-valid SurrealQL by expanding a positive `depth` into repeated `->edge->?` hops:

```typescript
import { GraphQuery } from 'jsr:@oneiriq/surql'

// Depth 1 (the default) emits a single edge step.
const direct = GraphQuery.from('user:alice').out('follows').render()
// → SELECT * FROM user:alice->follows;

// Depth 3 unrolls into three hops producing a v3-valid traversal path.
const threeHops = GraphQuery.from('user:alice').out('follows', 3).render()
// → SELECT * FROM user:alice->follows->?->follows->?->follows->?;

// Incoming and bidirectional use the same rules.
GraphQuery.from('post:article1').in_('likes').render()
// → SELECT * FROM post:article1<-likes;

GraphQuery.from('user:alice').both('knows', 2).render()
// → SELECT * FROM user:alice<->knows<->?<->knows<->?;
```

A `depth` of `1` or `undefined` collapses to the single-edge form. Invalid values (non-integer, ≤ 0, or non-finite) raise `GraphQueryError`.

## `type::record()` instead of `type::thing()`

SurrealDB v3 renamed `type::thing()` to `type::record()`. surql's `typeRecord(table, id?)` / `typeThing(table, id?)` helpers (the latter is a parity alias for the py/rs/go ports) always emit the v3-valid form:

```typescript
import { typeRecord, typeThing } from 'jsr:@oneiriq/surql'

typeRecord('task', '123').toSurQL() // → type::record('task:123')
typeThing('task', '123').toSurQL()  // → type::record('task:123') (same output)
```

See [Query UX](query-ux.md) for the CRUD overloads that accept these refs directly.

## CI pin

Integration tests run against `surrealdb/surrealdb:v3.0.5` (see `.github/workflows/integration.yml`). The publish-time unit test jobs exclude `src/test/integration*.test.ts` so JSR/npm releases do not require a live container. To run the integration tests locally:

```bash
docker run -d -p 8000:8000 --name surrealdb \
  surrealdb/surrealdb:v3.0.5 start --user root --pass root memory
SURQL_PRE_PUSH_INTEGRATION=1 deno task test
```

The `.githooks/pre-push` hook opts into the integration suite with the same env var (see [Contributing](https://github.com/Oneiriq/surql/blob/main/CONTRIBUTING.md)).
