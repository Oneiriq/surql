# surql

[![JSR Version](https://img.shields.io/jsr/v/@oneiriq/surql)](https://jsr.io/@oneiriq/surql)
[![License: Apache 2.0](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![SurrealDB](https://img.shields.io/badge/SurrealDB-v3-ff00a0)](https://surrealdb.com/)

Code-first database toolkit for [SurrealDB](https://surrealdb.com/). Type-safe query builder, schema/migration engine, orchestrator, and `surql` CLI — all from TypeScript, for Deno and Node.js.

## Features

- **Fluent Query Builder** — Chainable API for SELECT/INSERT/UPDATE/DELETE with full generics; `typeRecord`, `timeNow`, `mathSum`, `countIf`, `stringLower` and friends render inline in both expression and `SET` contexts.
- **Code-first Schema + Migrations** — `DEFINE` emitters with `IF NOT EXISTS`, structured schema parser, migration runner, squash, rollback, and drift detection.
- **SurrealDB v3 correctness** — Buffered `BEGIN ... COMMIT`, unrolled `GraphQuery` depth, v3-valid `type::record()` everywhere.
- **`surql` CLI** — `migrate`, `schema`, `db`, `orchestrate`, `settings` subcommands (built on `@cliffy/command`).
- **Multi-runtime** — JSR for Deno, npm for Node.js 18+.
- **Layered settings** — env + `.env` + `surql.yaml` + `surql.toml` via `loadSettings()`.
- **Auth & CRUD** — Root/Namespace/Database/Scope sign-in, JSON Patch (RFC 6902), merge, upsert, aggregations, pagination.
- **Input sanitisation** — Identifier validation, injection prevention, rich error types.

## Install

=== "Deno (JSR)"

    ```ts
    import { SurQLClient, query } from 'jsr:@oneiriq/surql'
    ```

    Or via an import map in `deno.json`:

    ```json
    { "imports": { "surql": "jsr:@oneiriq/surql" } }
    ```

=== "Node.js (npm)"

    ```bash
    npm install @oneiriq/surql
    ```

    ```ts
    import { SurQLClient, query } from '@oneiriq/surql'
    ```

## Quick Example

```ts
import {
  aggregateRecords,
  count,
  countIf,
  createRecord,
  getRecord,
  mathSum,
  SurQLClient,
  timeNow,
  typeRecord,
  updateRecord,
} from 'jsr:@oneiriq/surql'

const client = new SurQLClient({
  host: 'localhost',
  port: '8000',
  namespace: 'myapp',
  database: 'prod',
  username: 'root',
  password: 'root',
})
await client.signin({ type: 'root', username: 'root', password: 'root' })
const db = await client.getConnection()

// First-class record references — render as type::record('task:abc').
const task = typeRecord('task', 'abc')

// time::now() / math::sum() render inline in SET clauses.
await createRecord(db, 'audit', { at: timeNow(), action: 'start' })
await updateRecord(db, task, { status: 'done', finishedAt: timeNow() })

// typeRecord works for reads too.
const row = await getRecord<Task>(db, task)

// Typed aggregation — no hand-rolled SurrealQL.
const buckets = await aggregateRecords({
  table: 'memory_entry',
  select: {
    total: count(),
    failed: countIf('status = "failed"'),
    strengthSum: mathSum('strength'),
  },
  groupBy: ['network'],
  client: db,
})

await client.close()
```

## `surql` CLI

```bash
# Run from a clone
deno task cli --help

# Apply pending migrations
deno task cli migrate up

# Inspect live schema vs snapshot
deno task cli schema diff --schema db/snapshot.json

# Orchestrate across environments (JSON config)
deno task cli orchestrate deploy --environments staging,production --strategy rolling --batch-size 2
```

The full reference lives at [docs/cli.md](docs/cli.md) (rendered on the docs site).

## Documentation

- Full docs site: <https://oneiriq.github.io/surql>
- [Upgrade guide](docs/migration.md) — v1.1.0 → v1.2.0 → v1.3.x
- [SurrealDB v3 patterns](docs/v3-patterns.md)
- [Query UX](docs/query-ux.md) — `typeRecord`, function factories, `aggregateRecords`, overloads
- [CLI](docs/cli.md)
- [Changelog](CHANGELOG.md)

## Requirements

- Deno 2.x or Node.js 18+
- SurrealDB v3 (integration tests pinned to `surrealdb/surrealdb:v3.0.5`)

## Contributing

Local gating is enforced by `.githooks/pre-push` (mirrors CI). Enable once per clone:

```bash
git config core.hooksPath .githooks
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

Apache License 2.0 — see [LICENSE](LICENSE).

## Python

Looking for SurrealDB tooling in Python? See **[surql-py](https://github.com/Oneiriq/surql-py)** — the code-first schema, migration, and query toolkit for SurrealDB built for Python 3.12+.

## Support

- Issues: [GitHub Issues](https://github.com/Oneiriq/surql/issues)
- Changelog: [CHANGELOG.md](CHANGELOG.md)
