# SurrealDB v3 Patterns

surql targets **SurrealDB v3** for integration testing and CI (pinned to `surrealdb/surrealdb:v3.0.5`). Several SurrealQL behaviours changed between v1/v2 and v3; surql emits v3-valid SurrealQL by default and wraps the awkward bits in first-class helpers. This page documents the patterns you must follow to produce v3-valid SurrealQL.

## Buffered `BEGIN` / `COMMIT`

SurrealDB v3 **rejects bare `COMMIT TRANSACTION` / `CANCEL TRANSACTION` statements when they are sent as isolated RPC requests**. A transaction must be submitted as a single `BEGIN ... COMMIT` batch in one `query()` call.

surql handles this for you by buffering every call to `Transaction.execute()` client-side and flushing the batch on `commit()`:

```typescript
import { transaction } from 'jsr:@oneiriq/surql'

const tx = transaction(db)
await tx.begin()
await tx.execute("CREATE user SET name = 'Alice'")
await tx.execute("CREATE user SET name = 'Bob'")
// commit() flushes BEGIN TRANSACTION; ...; COMMIT TRANSACTION; as one RPC and
// returns the per-statement results of the queued statements, in order.
const results = await tx.commit()
```

Statements are buffered as raw SurrealQL — embed values inline rather than
relying on bound parameters.

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

## Full-text index renamed `SEARCH` → `FULLTEXT`

SurrealDB v3 renamed the full-text index keyword. The v1/v2 form:

```text
DEFINE INDEX idx ON TABLE t FIELDS content SEARCH ANALYZER ascii BM25;  -- parse error on v3
```

is rejected (`Unexpected token, expected Eof` at `SEARCH`). v3 spells it `FULLTEXT`:

```text
DEFINE INDEX idx ON TABLE t FIELDS content FULLTEXT ANALYZER ascii BM25 HIGHLIGHTS;
```

surql emits the `FULLTEXT` keyword from `IndexType.SEARCH` / `searchIndex` / `bm25Index` (and the migration differ). The structured parser recognises **both** spellings on read, so a live definition from either server version round-trips. `COLUMNS` and `FIELDS` are interchangeable in this statement; surql emits `FIELDS`.

The analyzer is defined separately with `generateAnalyzerSql` / `analyzer(...)` (`DEFINE ANALYZER ...`), which must run **before** the index that references it — `generateSchemaSql({ analyzers, tables })` emits analyzer statements ahead of tables for exactly this reason. Bare `BM25` uses the engine defaults (`k1 = 1.2`, `b = 0.75`); a full-text index with no analyzer set renders the historical `ascii` default, so define and name one explicitly for real lexical recall.

```typescript
import {
  analyzer,
  bm25Index,
  generateSchemaSql,
  standardAnalyzer,
  TokenFilter,
  tableSchema,
  withFilters,
  withIndexes,
} from 'jsr:@oneiriq/surql'

// class tokenizer + lowercase + ascii, plus English stemming.
const textEn = withFilters(standardAnalyzer('text_en'), 'snowball(english)')

const memory = withIndexes(tableSchema('memory'), bm25Index('content_bm25', ['content'], 'text_en'))

generateSchemaSql({ analyzers: [textEn], tables: [memory] })
// → DEFINE ANALYZER text_en TOKENIZERS class FILTERS lowercase,ascii,snowball(english);
//
//   DEFINE TABLE memory SCHEMAFULL;
//   DEFINE INDEX content_bm25 ON TABLE memory FIELDS content FULLTEXT ANALYZER text_en BM25;
```

### `search::score` and scan ordering

Run the lexical query with `Query.fulltextSearch(field, reference, query)` + `Query.searchScore(reference, alias)`, or the `fulltextSearchQuery(...)` helper:

```typescript
import { fulltextSearchQuery } from 'jsr:@oneiriq/surql'

const sparse = fulltextSearchQuery('memory', 'content', 1, 'insider buying').limit(100)
// → SELECT *, search::score(1) AS score FROM memory WHERE content @1@ 'insider buying' LIMIT 100
```

The v3 streaming executor's full-text scan yields matching rows **already in BM25 relevance order**, but does not (in 3.0.x) plumb the per-row score through to `search::score(<ref>)`, which returns `0` there. So **rank by the scan's natural order** rather than `ORDER BY search::score(...)`. This is sufficient for Reciprocal Rank Fusion, which fuses *ranks*, not raw scores: take the order the rows come back in, fuse it with the dense (`vectorSearch`) order via RRF, and you have hybrid retrieval. The query text is inlined as a single-quoted, escaped literal (no bound parameters), so a `'` in the query is escaped, not a SurrealQL injection vector.

## CI pin

Integration tests run against `surrealdb/surrealdb:v3.0.5` (see `.github/workflows/integration.yml`). The publish-time unit test jobs exclude `src/test/integration*.test.ts` so JSR/npm releases do not require a live container. To run the integration tests locally:

```bash
docker run -d -p 8000:8000 --name surrealdb \
  surrealdb/surrealdb:v3.0.5 start --user root --pass root memory
SURQL_PRE_PUSH_INTEGRATION=1 deno task test
```

The `.githooks/pre-push` hook opts into the integration suite with the same env var (see [Contributing](https://github.com/Oneiriq/surql/blob/main/CONTRIBUTING.md)).
