# Upgrade Guide

Notes for upgrading existing surql integrations across the v1.1.0 → v1.2.0 → v1.3.x releases. No public APIs were removed; every change on this page is additive, and old call sites keep working.

!!! note "Don't confuse with database migrations"
    This page covers **library upgrades**. For SurrealDB schema migrations see [Migrations](migrations.md).

## v1.1.0 → v1.2.0 (Parity + v3 correctness)

### Required if you were issuing transactions manually

SurrealDB v3 rejects bare `COMMIT TRANSACTION` / `CANCEL TRANSACTION` statements sent as standalone RPC calls. `Transaction.execute()` now **buffers statements client-side** and flushes them atomically on `commit()`.

Most callers using the built-in `Transaction` class need no changes — the buffering is transparent. The observable differences:

- `Transaction.execute(...)` returns an empty array. Per-statement results arrive on `commit()` instead.
- Results you previously read from the `execute()` return value must move to post-commit lookups (or to explicit `RETURN` inside the buffered SurrealQL).
- `Transaction.cancel()` no longer contacts the server.

See [v3 Patterns](v3-patterns.md#buffered-begin-commit) for the full pattern.

### Required if you hand-write `DEFINE` statements

Re-applying `DEFINE TABLE` against an existing table errors out on v3. Pass `ifNotExists: true` to the schema emitters to make them idempotent:

```typescript
// Before (errors on second apply)
const sql = generateSchemaSql({ tables, edges, access })

// After
const sql = generateSchemaSql({ tables, edges, access, ifNotExists: true })
```

`generateTableSql`, `generateEdgeSql`, and `generateAccessSql` accept the same flag.

### Required if you targeted SurrealDB < v3

Integration tests now run against `surrealdb/surrealdb:v3.0.5`. If your deployment still runs v1.x or v2.x:

- Keep using the previous surql release (`1.1.0`), **or**
- Upgrade SurrealDB to v3.0.5+ to benefit from the buffered-transaction fix and `IF NOT EXISTS` idempotency.

### Optional — adopt the new helpers

All additive; the old APIs keep working.

- **Structured schema parser** (`parseDbInfo`, `parseTableInfo`, `parseFields`, `parseIndexes`, `parseEvents`, `parseAccess`, `parseEdgeInfo`) lets you round-trip a live schema into the code-first definition types and back.
- **`loadSettings()` / `getSettings()`** replaces bespoke env + YAML/TOML loaders. Follows the same layered precedence as surql-py / surql-rs / surql-go.
- **`GraphQuery`** replaces ad-hoc graph traversal strings. **v3 note**: the `->edge<depth>` suffix that surql-py emits is not valid on v3; the TS builder unrolls `depth` into repeated `->edge->?` hops instead.
- **Migration squash** (`squashMigrations`) flattens old migrations into one `.surql` file while preserving checksums.
- **Schema drift hooks** (`checkSchemaDrift`, `generatePrecommitConfig`, `watchSchema`) plug into git pre-commit and live dev loops.
- **`surql` CLI** (`deno task cli …` or `jsr:@oneiriq/surql/cli`). See the [CLI reference](cli.md).

## v1.2.0 → v1.3.0 (Query-UX wave)

### Adopt `typeRecord` / `typeThing` for record references

`recordRef(table, id)` still works (expression-context only). For references you want to splice into `SET` clauses or pass to CRUD helpers, use `typeRecord(table, id)` — it carries the `__surqlFn` marker so `quoteValue()` renders it inline instead of parameterising it:

```typescript
// Before
await updateRecord(db, 'task', taskId, {
  owner: raw(`type::record('user:${userId}')`),
})

// After
await updateRecord(db, typeRecord('task', taskId), {
  owner: typeRecord('user', userId),
})
```

`typeThing` is a parity alias for callers porting py / rs / go code — both emit the v3-valid `type::record(...)` form.

### `FunctionValueExpression` unifies expression + value contexts

Every factory added in 1.3.0 (`count`, `countIf`, `mathAbs/Ceil/Floor/Round/Sum/Mean/Max/Min`, `stringLen/Lower/Upper/Concat`, `timeNow`, `timeFormat`, `arrayLength/Contains/Distinct/Flatten`) returns a `FunctionValueExpression`. The same value works in both SELECT/WHERE **and** SET without re-wrapping:

```typescript
// Before — two distinct wraps for the same function
await createRecord(db, 'audit', { ts: surqlFn('time::now') })
const now = func('time::now')               // for SELECT

// After — one value, both contexts
const now = timeNow()
await createRecord(db, 'audit', { ts: now })
await aggregateRecords({ table: 'audit', select: { now }, groupAll: true, client: db })
```

### Prefer `aggregateRecords` over hand-rolled aggregation SurrealQL

```typescript
// Before
const sql = `
  SELECT network, count() AS total, math::sum(strength) AS strengthSum
  FROM memory_entry
  GROUP BY network
`
const raw = await db.query(sql)
const rows = extractResult(raw)

// After
const rows = await aggregateRecords({
  table: 'memory_entry',
  select: { total: count(), strengthSum: mathSum('strength') },
  groupBy: ['network'],
  client: db,
})
```

### Adopt `extractMany` / `hasResult` for parity code

If you are porting code from surql-py / surql-rs / surql-go, replace `extractResult` / `hasResults` with the new aliases so the call sites read identically across languages. Both pairs are permanent; use whichever matches the surrounding code.

### Overload-based `updateRecord` / `getRecord`

The `(db, table, id, ...)` signatures are unchanged. Additionally, you can pass a `typeRecord(...)` value as a single reference:

```typescript
const ref = typeRecord('task', taskId)
const task = await getRecord<Task>(db, ref)
await updateRecord<Task>(db, ref, { status: 'done' })
```

## v1.3.0 → v1.3.1

CI-only fix: `src/test/integration*.test.ts` is now excluded from the publish-time unit test jobs so JSR/npm publishes no longer require a live SurrealDB container. No user-facing code changes.

## v1.3.1 → v1.3.2

Documentation refresh only. No code changes. The rendered site now covers every wave that landed since v1.0.0 (v3 patterns, query UX, CLI, upgrade notes). `deno.json` is bumped to `1.3.2` so the refreshed docs publish alongside the version.

## Developer experience — enable the pre-push hook

v1.3.0 ships a pre-push hook that mirrors the CI `fmt --check` / `lint` / `check` gates:

```bash
git config core.hooksPath .githooks
```

Opt into the integration suite (requires a running SurrealDB v3.0.5 container) by exporting `SURQL_PRE_PUSH_INTEGRATION=1`. See [`CONTRIBUTING.md`](https://github.com/Oneiriq/surql/blob/main/CONTRIBUTING.md).
