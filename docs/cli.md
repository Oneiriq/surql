# CLI

v1.2.0 added a `surql` CLI (`./src/cli/main.ts`) for operator-level tasks: migrations, schema inspection, connection diagnostics, and multi-environment orchestration. It is published alongside the library as a Deno binary and as a JSR export (`@oneiriq/surql/cli`).

## Install & invoke

=== "Run from JSR"

    ```bash
    deno run \
      --allow-read --allow-write --allow-net --allow-env --allow-sys \
      --allow-run=git,deno \
      jsr:@oneiriq/surql/cli \
      --help
    ```

=== "Run from a clone"

    ```bash
    deno task cli --help
    ```

=== "Install as a named binary"

    ```bash
    deno install --global \
      --allow-read --allow-write --allow-net --allow-env --allow-sys \
      --allow-run=git,deno \
      -n surql \
      jsr:@oneiriq/surql/cli
    ```

All subcommands accept `--config <path:string>` (YAML or TOML). Without `--config`, settings are resolved from env vars, `.env`, `surql.yaml`, and `surql.toml` via the shared [settings loader](installation.md).

## Top level

```
surql                                 # show help
surql --version                       # print CLI version
surql version                         # same
surql --config ./surql.yaml <cmd>     # override config resolution
surql settings                        # dump the resolved settings as JSON
```

## `surql migrate`

Migration lifecycle commands. Most of these require a live database connection; `create` and `validate` operate on the filesystem only.

| Command | Purpose |
| --- | --- |
| `surql migrate up [--directory <dir>] [--steps <n>] [--dry-run]` | Apply pending migrations. |
| `surql migrate down [--directory <dir>] [--steps <n>] [--dry-run] [--yes]` | Roll back applied migrations (default 1 step; prompts for confirmation). |
| `surql migrate status [--directory <dir>] [--format table\|json]` | Show applied + pending migrations. |
| `surql migrate history [--format table\|json]` | Show the applied history recorded in `_migrations`. |
| `surql migrate create <description> [--directory <dir>]` | Create a blank migration file. |
| `surql migrate validate [--directory <dir>]` | Validate migration filenames and contents. |
| `surql migrate generate <description> [--directory <dir>]` | Placeholder that falls back to `create`; the auto-generator is not yet ported from surql-py. |
| `surql migrate squash [options]` | Flatten migrations into a single `.surql` file. See below. |

### `surql migrate squash`

Squash multiple `.surql` migrations into one atomic file while preserving checksums and ordering:

```bash
surql migrate squash \
  --migrations migrations/ \
  --output migrations/20260101000000_squashed.surql \
  --from 20240101000001 \
  --to   20240315000000 \
  --description "squash_q1"
```

Flags:

- `-m, --migrations <dir>` — migrations directory (default `migrations`).
- `-o, --output <path>` — output file path (auto-generated if omitted).
- `--from <version>` — inclusive start version.
- `--to <version>` — inclusive end version.
- `--dry-run` — preview without writing.
- `--keep-originals` — keep original migration files after squash.
- `--force` — remove the originals as part of the squash.
- `--description <text>` — description for the squashed migration.

## `surql schema`

Schema inspection, validation, visualisation, and drift detection.

| Command | Purpose |
| --- | --- |
| `surql schema show [table] [--format text\|json]` | Dump the live DB schema (or one table). |
| `surql schema tables [--format table\|json]` | List tables + edges. |
| `surql schema inspect <table>` | Detail fields, indexes, events. |
| `surql schema export [--output <path>] [--table-name <t>] [--format json\|sql]` | Export the schema or a single table. |
| `surql schema diff --schema <snapshot.json> [--format text\|json]` | Compare a snapshot file to the live DB. |
| `surql schema validate --schema <snapshot.json> [--strict] [--format text\|json] [--output <path>]` | Validate a snapshot against the schema validator. |
| `surql schema visualize --schema <snapshot.json> [--format mermaid\|graphviz\|ascii] [--output <path>] [--table-filter a,b] [--no-fields] [--no-edges]` | Generate a diagram. |
| `surql schema check [--schema <dir>] [--snapshot <path>] [--fail-on-drift\|--no-fail-on-drift] [--show-diff] [--format text\|json]` | Git-hook / CI drift check. |
| `surql schema hook-config [--schema <dir>] [--fail-on-drift\|--no-fail-on-drift]` | Print a ready-to-paste pre-commit YAML fragment. |
| `surql schema watch [--schema <dir>] [--snapshot <path>] [--debounce <sec>]` | Watch files and report drift interactively. |
| `surql schema generate` / `surql schema sync` | Placeholders; use `migrate create` + `migrate up`. |

### Pre-commit integration

Generate a pre-commit fragment and paste it into `.pre-commit-config.yaml`:

```bash
surql schema hook-config --schema schemas/ > .pre-commit/surql.yaml
```

## `surql db`

Connectivity diagnostics and ad-hoc queries.

| Command | Purpose |
| --- | --- |
| `surql db init` | Create the `_migrations` tracking table. |
| `surql db ping [--verbose]` | Issue `RETURN 1;` against the configured connection. |
| `surql db info [--format text\|json]` | Print resolved connection config (password masked). |
| `surql db reset [--yes]` | **DESTRUCTIVE** — `REMOVE TABLE` every user table. Prompts unless `--yes`. |
| `surql db query <query> [--format json\|table]` | Execute a raw SurrealQL query and print the result. |
| `surql db version [--verbose]` | Print `INFO FOR DB` metadata. |

## `surql orchestrate`

Deploy migrations across multiple environments. Environment configuration is an array of `EnvironmentConfig` entries stored in JSON (default: `environments.json`).

```json
[
  {
    "name": "staging",
    "connection": {
      "host": "staging.db.internal", "port": "8000",
      "namespace": "myapp", "database": "staging",
      "username": "admin", "password": "..."
    }
  },
  {
    "name": "production",
    "connection": {
      "host": "prod.db.internal", "port": "8000",
      "namespace": "myapp", "database": "prod",
      "username": "admin", "password": "..."
    }
  }
]
```

| Command | Purpose |
| --- | --- |
| `surql orchestrate deploy --environments staging,production [--strategy sequential\|parallel\|rolling\|canary] [--batch-size <n>] [--env-config <path>] [--migrations-dir <path>] [--dry-run]` | Roll migrations out to the listed environments. |
| `surql orchestrate status --environments staging,production [--env-config <path>]` | Health-check a subset of environments. |
| `surql orchestrate validate [--env-config <path>]` | Health-check every configured environment. |

Strategies map to the orchestration API documented in [Orchestration](orchestration.md): `sequential`, `parallel`, `rolling` (honours `--batch-size`), and `canary`.

## `surql settings`

Prints the fully-resolved `Settings` object (env vars + `.env` + `surql.yaml` / `surql.toml`) as JSON. Use it to verify which config file a CI job is picking up:

```bash
surql --config ./ops/surql.production.yaml settings \
  | jq '.database | { host, namespace, database, protocol }'
```

## Embedding the CLI

If you need to wrap the CLI in your own Deno task runner, import the `run()` function from `@oneiriq/surql/cli` and pass your args. `buildRootCommand()` is also exposed so tests (or plugin authors) can introspect the command tree.

```typescript
import { run } from 'jsr:@oneiriq/surql/cli'

await run(['migrate', 'up', '--directory', 'migrations'])
```

Errors raised from `@cliffy/command` validation are mapped to the CLI's `ExitCode.Usage`; everything else resolves to `ExitCode.Failure`.
