# Changelog

## [Unreleased]

### Added

- **DISKANN vector indexes and the F16 element type (SurrealDB 3.2).** `IndexType.DISKANN` and `diskannIndex(name, field, dimension, { distance, vectorType, degree, lBuild, alpha, hashedVector })` define the on-disk ANN graph the 3.2 engine parses, with `DiskAnnDistanceType` for the metric (`COSINE` / `COSINE_NORMALIZED` / `EUCLIDEAN` / `INNER_PRODUCT`). It is its own enum because the engine's DISKANN metric set neither contains nor is contained by the HNSW one, so an out-of-set metric is unrepresentable rather than merely refused. `MTreeVectorType` gained `F16`, `I8`, and `U8`, which HNSW also accepts. The schema emitter, the `INFO FOR TABLE` parser, and the migration diff all carry the new form.

  The engine echoes a DISKANN index with `DIST` / `TYPE` / `DEGREE` / `L_BUILD` / `ALPHA` always spelled, defaults `EUCLIDEAN` / `F32` / 64 / 100 / 1.2 filled in even when the definition never stated them, and a float `ALPHA` carrying a trailing `f` suffix (`ALPHA 1.2f`). The emitter spells the defaults, `canonicalAlpha` renders a whole number bare (`ALPHA 2`), and the parser excludes the `f` from its capture, so a definition compares equal to its own echo instead of re-applying on every reconcile.

  `mtreeIndex` and `diskannIndex` throw on an element type the engine refuses for that kind: MTREE still parses only `F64` / `F32` / `I64` / `I32` / `I16`, and DISKANN accepts only `F32` / `F16` / `I8` / `U8`.

- **`Query.vectorSearchIndexed(field, vector, k, ef)` reaches a vector index.** The second argument of the KNN operator decides the plan: an integer is the exploration factor and the engine answers with a `KnnScan` over the field's HNSW or DISKANN index, while a metric keyword there asks for an exhaustive `KnnTopK` over a table scan. Reach for it whenever the column carries an index; the metric belongs to the index, so the method takes none.

### Fixed

- **Vector search emitted SQL SurrealDB v3 refuses.** The query builder rendered the bare `<|k|>` KNN form, which belongs to the KTree era and is a parse error on v3, so vector search in this toolkit did not work against a v3 server at all. It also accepted a `distance` argument and then dropped it. The operator now always carries a second argument: the exploration factor when `vectorSearchIndexed` set one, otherwise the metric, which defaults to `COSINE` when the caller omits it.

- **The migration diff silently dropped HNSW clauses.** `buildIndexSql` kept its own copy of the clause order that knew only UNIQUE, full-text, and MTREE, so an HNSW index in a migration rendered as a plain `DEFINE INDEX ... FIELDS ...` with its dimension, metric, and EFC/M tuning gone. The diff now delegates to the schema emitter (`generateIndexSql`, newly exported), so the two cannot drift again.

- **The schema parser dropped unrecognised vector element types.** `extractVectorType` matched a fixed set of five, so an index carrying any newer element type parsed back with no type and the next reconcile saw a difference that was not there.

## [1.7.0] - 2026-07-29

### Added

- **SurrealDB v3 object storage (buckets/files) is now first-class — code-first, end to end.** Define a bucket in code with `bucketSchema(name, backend)` / `memoryBucket(name)` / `fileBucket(name, path)` (an immutable `BucketDefinition`, rendered via the `DEFINE BUCKET` / `REMOVE BUCKET` / `ALTER BUCKET` emitters); declare `file` / `bytes` columns with `fileField(...)` / `bytesField(...)` (`TYPE file` / `TYPE bytes`); and let the migration differ manage buckets like tables (`diffBuckets` + `ADD_BUCKET` / `DROP_BUCKET` / `MODIFY_BUCKET` ops, wired into the generator's DOWN path, the registry, and snapshot versioning), with `parseBucket` reading live definitions back from `INFO FOR DB`. At runtime `client.bucket(name)` returns a `Bucket` handle with `put` / `putIfNotExists` / `get` / `getText` / `exists` / `head` / `delete` / `copy` / `copyIfNotExists` / `rename` / `renameIfNotExists` / `list` — every operation binds `type::file($bucket, $key)` parameters (bound vars, never string-interpolated). The CLI grows a `surql bucket` command (`define` / `list` / `rm` + `put` / `get` / `delete` / `exists` / `files`). Requires a server with the experimental files capability enabled — `SURREAL_CAPS_ALLOW_EXPERIMENTAL=files`; the capability is NOT covered by `--allow-all`, and prefer the env var over the `--allow-experimental files` flag, which swallows the trailing `memory` datastore positional.
- **`FileRef` value type with canonical (leading-slash) keys.** `FileRef` is an immutable `{ bucket, key }` pair that stringifies to the SurrealQL pointer `<bucket>:/<key>`, alongside the `isFileRefLike` / `parseFileRef` / `toFileRef` / `fileRefToString` recognition helpers (mirroring how the library normalises `RecordId` values). Keys are stored verbatim in SurrealDB's canonical form, which carries a leading slash (`file::key()` yields `/a.txt` however the file was written); `toString()` always renders a single-slash pointer, and the server treats `a.txt` and `/a.txt` as the same file. Because the npm `surrealdb` SDK (2.0.2) decodes the file-pointer CBOR tag into a `{ bucket, key }` carrier, `head()` and `list()` consume the decoded value directly and split it into canonical `bucket` / `key` fields on each `FileEntry` (the original pointer stays on `FileEntry.file`) — an intentional asymmetry vs the Python/Go ports, whose SDKs cannot decode the tag.
- **Multiple sessions.** `client.newSession()` (over the SDK's `newSession`) returns a `Session` wrapping `SurrealSession` and mirroring the client surface (CRUD builders + `use` / `signin` / `forkSession` / `closeSession`). Sessions require a live WebSocket connection (`SessionUnsupportedError` otherwise) and start UNAUTHENTICATED — sign in on the session when it needs more than guest access.

### Verified

- `deno fmt --check` — clean (on the canonical LF checkout / CI).
- `deno lint` — clean (181 files).
- `deno check mod.ts` / `deno check src/cli/main.ts src/cli/mod.ts` — clean.
- `deno task test --ignore='src/test/integration*.test.ts'` — **225 passed (1868 steps)**, +19 tests / +86 steps over the 1.6.0 baseline of 206 passed (1782 steps), covering bucket DDL/SurrealQL generation, `FileRef` (verbatim keys, single-slash `toString`, equality), the `INFO FOR DB` parser round-trip, `head`/`list` normalisation, param-binding safety, the CLI command, and the `Session` wrapper. The one failing test (`CLI: db ping / schema tables` against a live database) is the same pre-existing, environment-dependent failure noted at 1.6.0.
- Live integration (`src/test/integration_files.test.ts`) against SurrealDB 3.1.3 (`memory` datastore, `SURREAL_CAPS_ALLOW_EXPERIMENTAL=files`, `--allow-all`) — **1 passed (16 steps), 0 failed**: text/bytes round-trips, slash/no-slash key equivalence, exists/copy/rename/delete, canonical-key `head` and `list` (including a prefix filter), `FileRef` decoding through a record field, and session open/query/fork/close.

### Housekeeping

- Version bumped to `1.7.0` in `deno.json` (the npm package version is sourced from `deno.json` at `deno task build:npm` time, so the two stay in sync).

---

## [1.6.0] - 2026-06-17

### Added

- **Full-text search (BM25) is now first-class — the sparse leg of hybrid retrieval.** Define a `DEFINE ANALYZER` in code with `analyzer(name)` / `standardAnalyzer(name)` (`AnalyzerDefinition` + `Tokenizer` + `TokenFilter`, composed with `withTokenizer` / `withFilters` and the `edgeNgram` / `ngram` / `snowball` filter factories, rendered via `analyzerToSurql` / `generateAnalyzerSql`); build a BM25-scored full-text index with `bm25Index(name, fields, analyzer)` (or `searchIndex(name, fields, analyzer, { bm25, highlights })`); and run the lexical query with `Query.fulltextSearch(field, reference, query)` + `Query.searchScore(reference, alias)`, or the `fulltextSearchQuery(...)` helper. `generateSchemaSql` accepts an `analyzers` array and emits `DEFINE ANALYZER` statements ahead of the tables that reference them. Pair it with `vectorSearch` and fuse the two result orders by rank (Reciprocal Rank Fusion). See `docs/v3-patterns.md`.

### Fixed

- **Full-text index now emits the SurrealDB 3.x `FULLTEXT` keyword.** The full-text index keyword was renamed from `SEARCH` to `FULLTEXT` in SurrealDB 3.0, so the previous output (`... SEARCH ANALYZER ascii`) was a parse error on v3. `IndexType.SEARCH` / `searchIndex` / `generateTableSql` / `generateEdgeSql` and the migration differ (`buildIndexSql`) now emit `FULLTEXT ANALYZER <analyzer|ascii> [BM25] [HIGHLIGHTS]`, and the `INFO FOR TABLE` index parser recognises both spellings (normalising the historical `ascii` analyzer back to undefined so default-form indexes round-trip). See `docs/v3-patterns.md` §"Full-text index renamed `SEARCH` → `FULLTEXT`" — including the note that the v3 streaming executor's full-text scan returns rows in BM25 relevance order but `search::score` is not plumbed through it (returns 0), so rank by the scan's natural order for RRF.

### Verified

- `deno fmt --check` — clean (on the canonical LF checkout / CI).
- `deno lint` — clean (169 files).
- `deno check mod.ts` / `deno check src/cli/main.ts src/cli/mod.ts` — clean.
- `deno task test --ignore='src/test/integration*.test.ts'` — **206 passed (1782 steps)**, +8 tests / +32 steps over the 1.5.0 baseline of 198 passed (1750 steps), covering the analyzer builder, FULLTEXT/BM25 index rendering, the full-text query builder + single-quote escaping, and the parser round-trip. The one failing test (`CLI: db ping / schema tables` against a live database) is a pre-existing, environment-dependent failure unrelated to this change.

### Housekeeping

- Version bumped to `1.6.0` in `deno.json` (the npm package version is sourced from `deno.json` at `deno task build:npm` time, so the two stay in sync).

---

## [1.5.0] - 2026-05-19

### Added

- **Edge round-trip parity in the schema parser** (`parseEdgeInfo`): edges defined via `edgeSchema` / `EdgeDefinition` now round-trip through `parseEdgeInfo` with the same fidelity tables already had. Edge mode is detected from the `DEFINE TABLE` statement — `TYPE RELATION` resolves to `EdgeMode.RELATION`, `SCHEMAFULL` to `EdgeMode.SCHEMAFULL`, anything else to `EdgeMode.SCHEMALESS` — so SCHEMAFULL edges no longer collapse into the RELATION case. `FROM <table>` and `TO <table>` are parsed independently so a malformed live definition that lost one clause surfaces as missing-endpoint drift instead of a parse failure. On `TYPE RELATION` edges the auto-emitted `in` and `out` fields SurrealDB stores are stripped on parse — they are implicit when `TYPE RELATION` is set, so the code-side `EdgeDefinition` does not declare them and round-trip diffs were flagging them as orphan additions. Per-action `PERMISSIONS` (including the comma-joined `FOR select, create, update, delete WHERE …` shape v3 emits) round-trip via the existing `parseTablePermissions` helper.
- **`stripBrackets(value)` helper** in `src/utils/helpers.ts`, also re-exported from the package root. SurrealDB v3 wraps record-id keys that contain anything other than `[a-zA-Z_][a-zA-Z0-9_]*` or pure digits in unicode angle brackets `⟨ … ⟩` (U+27E8 / U+27E9). Downstream consumers that wanted the bare `table:id` wire shape were calling `value.replace('⟨', '').replace('⟩', '')` themselves at every API boundary; `stripBrackets` centralises that strip and also accepts the legacy ASCII `< … >` form, so consumers can drop their own ad-hoc `.replace` calls. `null` and `undefined` are passed through untouched so the helper is safe to apply unconditionally. `recordIdToString` now delegates to `stripBrackets`, picking up ASCII-bracket handling as a side benefit.
- **Transaction-bound `upsertMany`**: the `client` argument now accepts either a `Surreal` connection (autocommit, legacy behaviour) or an active `Transaction` (atomic). In the transaction mode the same per-record `UPSERT … CONTENT { … }` statements are queued on the supplied transaction via `trx.execute`, inheriting the surrounding `BEGIN TRANSACTION` / `COMMIT TRANSACTION` framing so a single bad record rolls the _entire_ batch back on commit instead of leaving the database half-seeded. The mode is auto-detected — no call-site rewrite is needed beyond passing the transaction handle. Results are not available at call time in transaction mode (`Transaction.execute` buffers); the per-row results land in `Transaction.commit()`'s return value. `upsertMany` also gains an optional `conflictFields` parameter (matching the surql-py port) — fields in this list are emitted as a `WHERE field = value AND …` clause appended to each UPSERT. The conflict values are inlined rather than parameterised because `Transaction.execute` does not bind params.

### Fixed

- **`buildUpsertQuery` emitted `UPSERT INTO <table> [ {…}, {…} ]` which SurrealDB v3 rejects with a parse error.** The function now emits one `UPSERT <target> CONTENT { … }` statement per item — the v3-correct per-record shape used across the surql-py / surql-rs / surql-go ports — joined by `;`. Items with an `id` field are upserted by record id; items without one are upserted into the table. The `conflictFields` parameter (when supplied) now emits inline-value WHERE clauses (`WHERE email = 'a@b.com'`) instead of the previous `$item.email` placeholder shape, because the per-statement query has no `$item` binding in scope.
- **`upsertMany` ran one round-trip RPC per record.** The function now batches all per-record `UPSERT … CONTENT { … }` statements into a single multi-statement query in autocommit mode, reducing N records from N RPCs to 1 RPC and matching surql-py's autocommit behaviour. Records returned by the server are concatenated across the per-statement result envelopes so the caller still gets one row per upsert.
- **`upsertMany` did not honour the `id` field as the UPSERT target.** Previously every record landed via a table-level `UPSERT <table> SET k = v` regardless of whether the input declared `id: 'users:alice'`. The per-record target is now `data.id` when present (so `{id: 'users:alice', name: 'Alice'}` becomes `UPSERT users:alice CONTENT { name: 'Alice' }`) and falls back to the bare table otherwise. The `id` field is stripped from the CONTENT payload to avoid double-writing.

### Verified

- `deno fmt --check src/` — clean.
- `deno lint src/` — clean.
- `deno check src/cli/main.ts src/cli/mod.ts mod.ts` — clean.
- `deno task test --ignore='src/test/integration*.test.ts'` — **199 passed (1752 steps), 0 failed** (was 195 / 1712 on 1.4.0; +40 regression-test steps covering the three new features and the two query-shape fixes).

### Housekeeping

- Version bumped to `1.5.0` in `deno.json`.

---

## [1.4.0] - 2026-05-17

### Added

- **Optional fields**: `FieldDefinition` gains an `optional` flag — e.g. `stringField('bio', { optional: true })`. The field type is emitted wrapped as `option<...>` (`option<string>`, `option<record<user>>`, `option<array<int>>`) so a `SCHEMAFULL` column accepts the absence of a value. Without it, every record that omits the column is rejected on SurrealDB v3 with a coercion error. The flag defaults off, so existing schemas are unaffected.
- **WHERE filtering on graph traversal helpers**: `traverse`, `traverseWithDepth`, `getRelatedRecords`, `getOutgoingEdges`, `getIncomingEdges`, and `shortestPath` accept an optional trailing `conditions` argument — a raw SurrealQL predicate appended as a `WHERE` clause, matching the `conditions` argument `queryRecords` already takes. Callers that need row-level filtering (multi-tenant isolation, excluding archived rows) no longer have to drop down to a hand-written query. Omitting it leaves the emitted SurrealQL unchanged.

### Fixed

- **`Transaction.commit()` discarded the per-statement results.** `Transaction.execute()` documents that the results "become available in the value returned by `commit()`", but `commit()` returned `void`. It now flushes the `BEGIN ...; COMMIT` batch through the SDK's `query(...).responses()` accessor: it returns the per-statement results of the queued statements in order, confirms the batch actually committed, and — on a rollback — names the statement that caused it instead of surfacing only a generic "failed transaction".
- **Table and edge `PERMISSIONS` produced un-runnable DDL.** `generateTableSql` emitted table-level permissions as a _second_ `DEFINE TABLE` statement; on SurrealDB v3 a repeat `DEFINE TABLE` for an existing table fails with `The table '<name>' already exists`, and on a server that did accept it the second statement redefined the table and silently dropped its `SCHEMAFULL`/`SCHEMALESS` mode. `generateEdgeSql` ignored `EdgeDefinition.permissions` entirely, so an edge built with `withEdgePermissions(...)` lost them. Both now fold permissions into the single `DEFINE TABLE` statement.
- **`quoteValue()` flattened objects, RecordIds, and Dates with `JSON.stringify`.** A nested `SurrealFnValue`, `RecordId`, or `Date` was serialized as a JSON blob rather than SurrealQL — `{ created: <fn> }` came out as `{"created":{"__surqlFn":true,...}}`. `quoteValue()` now recurses through plain objects emitting SurrealQL object literals, renders `RecordId` instances as a record-id literal (`user:alice`), and renders `Date` instances as a `d'...'` datetime literal (a bare quoted ISO string is rejected by v3 datetime-typed fields).
- **The migration differ emitted incomplete, mistyped DDL.** `ADD_FIELD`/`MODIFY_FIELD` diffs rendered a bare `TYPE <FieldType>`, dropping `record<target>`, array element types, and `option<...>`; `MODIFY_FIELD` only fired on a base-type change, so a changed record link or optionality went undetected. `ADD_TABLE` for a new table emitted only `DEFINE TABLE name mode;` — applying that migration created an empty table. Diffs now render field types through the shared generator, and a new table (or edge) emits its complete DDL.
- **The schema parser could not read back the shapes SurrealDB v3 returns from `INFO FOR TABLE`**, so `diffTables` reported false-positive drift on every schema using typed, optional, record-link, or array fields. The type extractor captured only the first word after `TYPE` — `option<X>`, which v3 stores as `none | X`, parsed as `any` (losing both the type and the optionality), and `record<X>` / `array<E>` lost their inner type. A field whose name is a clause keyword (`default`, `comment`, ...) had that name mis-read as the clause. Table-level mode and `PERMISSIONS` were lost entirely, since v3 omits the table-level `DEFINE` from `INFO FOR TABLE`. The parser now unfolds `option` / `record` / `array` types and populates `recordLink` / `arrayType` / `optional`, skips the `<field>[*]` array element-spec entries, and `parseTableInfo` / `parseEdgeInfo` accept a `defineTable` argument — the `DEFINE TABLE` statement from `INFO FOR DB` — to recover table mode, permissions, and relation endpoints. `parseTablePermissions` is newly exported.
- **Docs**: corrected the "Buffered `BEGIN` / `COMMIT`" warning on the v3 Patterns page — the `Found COMMIT TRANSACTION, but ...` code span was immediately followed by the sentence period, rendering a stray trailing `....`.
- **Docs**: the migration documentation imported and called APIs that surql does not export (`diffSchemas`, `MigrationRunner`, `RollbackManager`, `generateVersion`, and others). Every such example is rewritten against the real exported API (#62).
- **Docs**: `docs/schema.md` documented a non-existent `optionalField()` helper — corrected to the real `optional` field option (`stringField('bio', { optional: true })`); and the `docs/v3-patterns.md` transaction example passed a params object that `Transaction.execute` does not bind — rewritten with inline values.

### Changed

- **CI**: the documentation workflow runs `mkdocs build --strict` on pull requests; closed open code-scanning alerts; added a label-driven Dependabot auto-merge workflow; moved CI and audit onto the `aur0` self-hosted runner; and added a scheduled `deno-update` workflow (#49–#54).
- **CI**: hardened the workflow set so runs stop stalling — replaced `docs.yml`'s global `pages` concurrency group (which serialised every build and deploy across all refs behind one queue) with a per-ref group plus `cancel-in-progress`; promoted the `integration` and security `audit` workflows to PR gates on `ubuntu-latest` (from manual-only); added per-ref concurrency groups to the auto-merge, PR-title, and dependency-review workflows; and bumped pinned action versions. Completes #40 and absorbs dependabot PRs #56–#60.
- **Docs**: replaced informal "wave" phrasing with neutral wording across `docs/query-ux.md`, `docs/migration.md`, and the changelog.
- **Docs**: documented the typed-vs-untyped CRUD surfaces — module docstrings on the typed helpers (`createTyped` and siblings) and the untyped helpers (`createRecord` and siblings) spell out that the two run identical SurrealQL and differ only in whether each returned row is validated at runtime against a Zod schema.

### Housekeeping

- Version bumped to `1.4.0` in `deno.json`.

---

## [1.3.4] - 2026-04-30

### Fixed

- **Publish**: corrected the npm package license metadata and skipped a redundant dnt typecheck (#48).

---

## [1.3.3] - 2026-04-30

### Changed

- **License**: relicensed to Apache-2.0 with a `NOTICE` file (#46).

### Housekeeping

- Trimmed auto-trigger workflows and bumped to `1.3.3` (#47).

---

## [1.3.2] - 2026-04-19

### Changed

- **Docs refresh** (#37): documented every release that landed since v1.0.0. New pages: `docs/v3-patterns.md` (buffered BEGIN/COMMIT, `IF NOT EXISTS` emitter, unrolled graph depth), `docs/query-ux.md` (`typeRecord` / `typeThing`, function factories, `FunctionValueExpression`, `extractMany` / `hasResult`, `aggregateRecords`, `updateRecord` / `getRecord` overloads), `docs/cli.md` (`surql migrate|schema|db|orchestrate|settings` reference), `docs/migration.md` (upgrade notes v1.1.0 → v1.2.0 → v1.3.x). README refreshed with first-class helper examples (`typeRecord`, `timeNow`, `aggregateRecords`, `surql` CLI). mkdocs nav extended; `mkdocs build --strict` stays clean.

### Housekeeping

- Version bumped to `1.3.2` in `deno.json` so the refreshed docs can publish.

---

## [1.3.1] - 2026-04-19

### Fixed

- **CI**: Excluded `src/test/integration*.test.ts` from publish-time unit test jobs so JSR/npm publishes no longer require a live SurrealDB container. Integration tests still run in the dedicated integration workflow.

---

## [1.3.0] - 2026-04-19

### Added — Query UX (#29)

- **`typeRecord(table, id?)` / `typeThing(table, id?)`** (#6): first-class SurrealDB v3 record references. `typeThing` is the parity alias for surql-py/rs/go. Emits `type::record('table:id')` (v3-valid; v3 dropped `type::thing`).
- **Function factories** (#7): `countIf`, `mathAbs`/`mathCeil`/`mathFloor`/`mathRound`, `stringLen`/`stringLower`/`stringUpper`/`stringConcat`. Short-form aliases (`abs_`, `ceil`, `floor`, `round_`, `upper`, `lower`, `concat`, `stringLength`) retained for pre-1.3.0 callers.
- **`FunctionValueExpression`** (#7): a dual-purpose expression that implements both `FunctionExpression` and `SurrealFnValue`, so the same factory output renders inline in `SELECT` / `WHERE` **and** in `SET` clauses without a second wrap.
- **Result extraction aliases** (#8): `extractMany` (parity with surql-py `extract_many`) and `hasResult` (parity with `has_result`) surfaced alongside the existing `extractResult` / `hasResults`.
- **`aggregateRecords(options)`**: one-shot aggregation helper accepting `{ table, select, groupBy?, groupAll?, where?, orderBy?, limit?, client }` and returning rows keyed by the aliases in `select`. `groupAll` and `groupBy` are mutually exclusive.
- **`typeRecord`-aware CRUD overloads**: `updateRecord(db, ref, data)` and `getRecord(db, ref)` now accept a `typeRecord(...)` value in place of `(table, id)`. The original signatures remain fully supported.

### Added — Developer experience

- **Pre-push hook** (#30): `.githooks/pre-push` mirrors the CI `fmt --check` / `lint` / `check` gates and guards the push locally. Enable once per clone via `git config core.hooksPath .githooks`. The full `deno task test` suite is opt-in via `SURQL_PRE_PUSH_INTEGRATION=1` (requires a running SurrealDB v3.0.5 container). CONTRIBUTING.md documents the workflow.

---

## [1.2.0] - 2026-04-19

### Added — Parity (#19, #21, #24)

- **Structured schema parser** (#19): `parseDbInfo`, `parseTableInfo`, `parseFields`, `parseIndexes`, `parseEvents`, `parseAccess`, `parseEdgeInfo`, plus `SchemaParseError`. Full port of the surql-py/surql-rs/surql-go `DEFINE` parser (HNSW index, JWT URL/duration variants, lookbehind edge cases).
- **Layered settings loader** (`loadSettings`, `getSettings`, `clearSettingsCache`, `getDbConfig`, `getMigrationPath`): reads env vars, `.env`, `surql.yaml`, and `surql.toml` with precedence matching the py/rs/go ports.
- **GraphQuery fluent builder** (`GraphQuery`, `GraphQueryError`, `GraphQueryRendered`): chainable graph traversal. **v3 depth handling**: passes a positive `depth` unrolled as repeated `->edge->?` hops (v3 dropped the `->edge2` suffix the py reference emits).
- **Migration squash** (`squashMigrations`, `SquashError`, `SquashOptions`, `SquashResult`): flatten multiple `.surql` migrations into one while preserving checksums and version ordering.
- **Schema drift hooks** (`checkSchemaDrift`, `defaultSchemaFilter`, `generatePrecommitConfig`, `getStagedSchemaFiles`, `DriftIssue`, `DriftReport`): git-hook / CI-friendly drift detection against a persisted snapshot.
- **Schema watcher** (`watchSchema`, `WatchCallback`, `WatchHandle`, `WatchSchemaOptions`): filesystem watcher that re-runs drift checks on change with a configurable debounce.
- **CLI** (#24): new `surql` binary (`./src/cli/main.ts`, exposed as `"./cli"` export). Subcommands:
  - `surql migrate up|down|status|history|create|validate|generate|squash`
  - `surql schema show|diff|generate|sync|export|tables|inspect|validate|check|hook-config|watch|visualize`
  - `surql db init|ping|info|reset|query|version`
  - `surql orchestrate deploy|status|validate`
  - `surql settings` (dump resolved configuration)
  - Built on `@cliffy/command`; honours `--config <path:string>` at every level.

### Added — SurrealDB v3 correctness (#13, #14, #15)

- **Buffered transactions** (#13): `Transaction.execute()` now queues statements client-side and flushes them as a single `BEGIN TRANSACTION; ...; COMMIT TRANSACTION;` request on `commit()`. SurrealDB v3 rejects bare `COMMIT TRANSACTION` / `CANCEL TRANSACTION` statements across isolated RPCs, so streaming the bookends no longer works.
- **`IF NOT EXISTS` emitter** (#15): `generateTableSql`, `generateEdgeSql`, `generateAccessSql`, and `generateSchemaSql` accept an `ifNotExists: boolean` option. Set `true` to emit `DEFINE TABLE IF NOT EXISTS`, `DEFINE ACCESS IF NOT EXISTS`, etc., so schemas can be re-applied idempotently against a live v3 database.
- **Integration CI pinned to SurrealDB v3.0.5** (#14): `.github/workflows/integration.yml` runs against `surrealdb/surrealdb:v3.0.5`; unit tests (publish jobs) exclude `integration*.test.ts`.

### Added — Schema definition extensions

- **HNSW index** (`hnswIndex`, `HnswDistanceType`) on top of the existing MTREE index.
- **JWT URL + access durations** on `DEFINE ACCESS`.

---

## [1.1.0] - 2026-03-31

### Added

- **GROUP ALL support** (#5): Added `groupAll()` to the immutable Query builder for aggregating entire result sets without grouping fields. Added `mathMean()`, `mathSum()`, `mathMax()`, `mathMin()` expression aliases for SurrealDB math function names.
- **type::record() helper** (#6): Added `recordRef(table, id)` function that generates `type::record('table:id')` SurrealQL, usable in SELECT expressions and WHERE conditions.
- **SurrealDB function support in field values** (#7): Added `surqlFn(name, ...args)` for server-side function references (e.g. `time::now()`, `math::floor()`) that render as raw SurrealQL in create/update operations instead of being parameterized. Updated `quoteValue()` to detect and pass through `SurrealFnValue` objects.
- **Result extraction helpers** (#8): Enhanced `extractScalar()` with optional `key` and `defaultValue` parameters for targeted field extraction and fallback values.
- **Embedded SurrealDB protocols**: `ConnectionConfig` now accepts `protocol: 'mem' | 'rocksdb' | 'surrealkv' | 'surrealkv+versioned'` for in-process connections via the `@surrealdb/node` / `@surrealdb/wasm` engine packages. Persistent engines take an on-disk `path`; `mem` is ephemeral. Credential-less embedded connections skip signin automatically. Exported `EMBEDDED_PROTOCOLS` constant and `isEmbeddedProtocol()` type guard. `validateConnectionConfig()` now bypasses host/port/username/password checks when an embedded protocol is selected. Enables edge/device deployments where each host owns its own SurrealDB instance.

### Fixed

- **CI/CD**: Fixed publish workflow to properly publish to both JSR and npm on release tags. Resolved environment protection rule conflict for workflow_dispatch triggers. Upgraded GitHub Actions to Node.js 24 compatible versions.

---

## [1.0.1] - 2026-03-20

### Fixed

- **RecordID normalization**: RecordId objects from the SurrealDB JS SDK no longer leak through to consumers when no mapper is provided. The `mapResults()` base method now applies `normalizeSurrealRecord()` automatically, converting RecordId fields to plain strings in all CRUD operations (read, create, update, delete, merge, upsert, patch) regardless of whether a `.map()` function is supplied.

### Added

- **Tests**: Added `normalization.test.ts` covering automatic RecordID normalization across all query builder types.

---

## [1.0.0-rc.2] - 2026-03-19

### Fixed

- **Docs**: Standardized JSDoc examples to use consistent placeholder values
- **README**: Fixed incorrect documentation section link

---

## [0.3.0] - 2025-11-14

### Added - New Features in v0.3.0

- **Custom ID Support**
  - Introduced the ability to define a custom `RecordId` for SurQL `write` operations.
  - Updated the `upsert` operations to accept custom `RecordId` values.

### Fixed - Bug Fixes in v0.3.0

- **Environment Variable Access Issue**
  - Fixed environment variable access issue in `isProductionEnvironment` function to handle cases where environment variables are not accessible
  - Updated test runner configuration to include `--allow-env` flag for proper error handling

## [0.2.5] - 2025-07-15

- **Updated**: Minor updates to documentation.

## [0.2.4] - 2025-07-15

### Added - New Features in v0.2.4

- **Custom Serializer Support**
  - Introduced `createSerializer<T>()` utility for custom serialization logic.
  - Enhanced type safety with `Serialized<T>` type for serialized models.
  - Example usage in `examples/customMapping.ts` demonstrating custom mapping of user data.
  - Added `Serializer<R>` type for SurrealDB to `createSerializer` utility, allowing custom serialization functions to be defined.

### Updated - Documentation

- **README.md**: Simplified documentation and rewrote examples in `examples/` directory.
- **Custom Mapping Example**: Updated `examples/customMapping.ts` to showcase custom serialization and mapping of data.
- **TypeScript Signatures**: Improved type signatures in examples for better clarity in the serializer.
- **Error Handling Patterns**: Added examples of error handling patterns in the documentation.

---

## [0.2.3] - 2025-07-15

### Added - New Features in v0.2.3

#### Enhanced Authentication System

- **Complete multi-level authentication support**: Root, Namespace, Database, and Scope authentication
- **Advanced JWT token management** with automatic lifecycle handling
- **Comprehensive credential validation** with context-aware error handling
- **Session state persistence** across all operations
- **Enhanced authentication error classes** for granular error handling

#### Advanced CRUD Operations

- **`MergeQL`** class for sophisticated partial data updates
  - Smart merge operations preserving existing field values
  - Support for nested object merging with conflict resolution
- **`PatchQL`** class with full RFC 6902 JSON Patch implementation
  - Complete operation support: `add`, `remove`, `replace`, `move`, `copy`, `test`
  - Path validation and injection attack prevention
- **`UpsertQL`** class for intelligent insert-or-update operations
  - Conditional logic handling for both insert and update scenarios
  - Advanced conflict resolution strategies

#### Query Builder Enhancements

- **Aggregation capabilities** with comprehensive functions
  - `count()`, `sum()`, `avg()`, `min()`, `max()` operations
  - Automatic field aliasing for clear result sets
- **`GroupBy` functionality** with multiple field grouping support
- **`Having` clauses** for filtered aggregations with fluent syntax
- **Enhanced pagination** with both traditional and page-based methods

#### Enterprise Security Infrastructure

- **SQL injection prevention** across all query operations
- **Input validation framework** with comprehensive sanitization
- **Path traversal protection** for JSON Patch operations
- **Secure credential handling** with automatic token expiration

#### Comprehensive Testing Infrastructure

- **2,697+ lines of test coverage** across authentication, CRUD, and query operations
- **95%+ test coverage** for all new functionality
- **Integration test suite** ensuring feature interoperability
- **Security validation tests** for injection prevention

### Updated - Internals

- **Type system improvements** with automatic serialization utilities
- **Error handling framework** with context-aware error classes
- **Client architecture** with factory methods and capability-based mixins
- **Performance optimizations** for query building and execution

### Updated - Safe Strings

- **Production-ready input validation** across all user-facing APIs
- **Enhanced credential security** with automatic token lifecycle management
- **Comprehensive injection prevention** for all query types

### Updated - Foundation & Infrastructure

#### Core Architecture

- **Foundational authentication framework** with multi-level support structure
- **Base CRUD operation classes** with comprehensive error handling
- **Security validation infrastructure** with input sanitization
- **Core type system** with serialization utilities

#### Authentication Infrastructure

- **Basic authentication framework** supporting all credential types
- **JWT token handling infrastructure** with lifecycle management
- **Session management foundation** with state persistence
- **Authentication error class hierarchy** for granular error handling

#### Security & Validation Framework

- **Input validation system** with comprehensive sanitization
- **SQL injection prevention infrastructure** across all operations
- **Credential validation framework** with security best practices
- **Path validation system** for secure operations

#### Project Structure

- **Core client architecture** with modular design patterns
- **Utility functions** for data handling and validation
- **Error handling infrastructure** with specific error types
- **Testing framework foundation** for comprehensive coverage

---

## [0.2.2] - 2025-07-14

- **Updated**: Minor updates to documentation.

---

## [0.2.1] - 2025-07-13

- **Updated**: Minor updates to documentation.

---

## [0.2.0] - 2025-07-13

### Added - Core Features

#### 🔐 Authentication & Session Management

- **Multi-Level Authentication**: Complete support for Root, Namespace, Database, and Scope-level authentication
- **`signin()`** method supporting all credential types with comprehensive validation
- **`signup()`** method for creating new scope users with custom fields
- **`authenticate()`** method for JWT token-based authentication
- **`invalidate()`** method for secure session termination
- **`info()`** method for retrieving current session information
- **`isAuthenticated()`** method for checking authentication status
- **`getCurrentToken()`** method for accessing current JWT token
- **Automatic JWT token lifecycle management** with expiration handling
- **Session state persistence** across operations
- **Enhanced error handling** with specific authentication error classes:
  - `AuthenticationError` - Base authentication error
  - `SessionExpiredError` - Session expiration handling
  - `InvalidCredentialsError` - Invalid login credentials
  - `InvalidTokenError` - Malformed or invalid JWT tokens
  - `InsufficientPermissionsError` - Permission-based access control
  - `SignupError` - User registration failures
  - `ScopeAuthenticationError` - Scope-specific authentication issues

#### 🛠️ Advanced CRUD Operations

- **`MergeQL`** class for partial data updates preserving existing fields
  - Smart merge operations that combine new data with existing records
  - Support for nested object merging
  - Comprehensive error handling for non-existent records
- **`PatchQL`** class implementing JSON Patch RFC 6902 operations
  - Support for all standard operations: `add`, `remove`, `replace`, `move`, `copy`, `test`
  - Fluent API with `addOperation()` and `addOperations()` methods
  - Path validation and security checks to prevent injection attacks
  - Comprehensive operation validation following RFC 6902 specifications
- **`UpsertQL`** class for intelligent insert-or-update operations
  - `withId()` method for specifying exact record IDs
  - `onConflict()` method for conflict detection on specific fields
  - Smart conditional logic handling both insert and update scenarios
  - Support for complex conflict resolution strategies

#### 📊 Enhanced Query Builder Capabilities

- **`GroupByCapability`** mixin for advanced grouping functionality
  - Support for multiple grouping fields
  - Input validation and injection prevention
  - Integration with aggregation and having clauses
- **`HavingCapability`** mixin for filtered aggregations
  - Fluent syntax: `having('field', Op.GREATER_THAN, value)`
  - Direct condition syntax: `having('COUNT(*) > 10')`
  - Multiple condition support with automatic AND logic
  - Security validation for condition strings
- **`AggregationCapability`** mixin with comprehensive aggregation functions
  - `count()` - Record counting with optional field specification
  - `sum()` - Numerical field summation
  - `avg()` - Average calculation
  - `min()` - Minimum value detection
  - `max()` - Maximum value detection
  - Automatic field aliasing for result clarity
- **Enhanced pagination** with new `page()` method
  - Traditional `limit()` and `offset()` support maintained
  - New `page(pageNumber, pageSize)` method for simplified pagination
  - Integration with grouping and aggregation operations

#### 🏗️ Architecture Improvements

- **Capability-based mixin architecture** for composable query building
- **Enhanced SurQLClient** with all new factory methods
- **Backward compatibility** - all existing APIs remain unchanged
- **Type safety enhancements** with proper generic constraints
- **Comprehensive input validation** across all new features
- **Security-focused design** with injection prevention

### Enhanced Documentation

- **README.md** Feature documentation
- **Error handling patterns** with specific error types and examples
- **Security considerations** section with best practices
- **Code examples** showcasing real-world usage patterns

### Security Improvements

- **Input validation** for all user-provided data
- **SQL injection prevention** in field names and conditions
- **Path traversal protection** in JSON Patch operations
- **Credential validation** for authentication operations
- **Secure token handling** with automatic expiration management

### Testing

- **Additional tests** across features
- **95%+ test coverage** for all new functionality with exception of authentication tests
- **Authentication test suite** (`auth.test.ts`) with full credential type coverage
- **CRUD operations test suite** (`crud.test.ts`) with comprehensive operation testing
- **Query enhancements test suite** (`queryEnhancements.test.ts`) with capability testing
- **Integration tests** ensuring feature interoperability
- **Security validation tests** for injection prevention
- **Error handling tests** for all new error types

### Performance

- **Optimized query building** with efficient mixin composition
- **Minimal overhead** for new authentication features
- **Connection reuse** for authenticated operations
- **Efficient parameter binding** for all new query types
- **Memory-efficient** aggregation and grouping operations

### Documentation

- **Complete API documentation** with TypeScript signatures
- **Practical code examples** for all new features
- **Security best practices** and considerations
- **Migration guide** for existing users
- **Error handling patterns** with specific error types
- **Real-world usage examples** for e-commerce and user management

## [0.1.0] - Previous Release

### Added

- Initial SurQL implementation with basic CRUD operations
- Promise-based query builder with fluent interface
- Type-safe operations with TypeScript support
- Connection management with SurrealConnectionManager
- Basic ReadQL, CreateQL, UpdateQL, DeleteQL builders
- Utility types and serialization helpers

---

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
