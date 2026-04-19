#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env --allow-sys --allow-run=git
/**
 * `surql` CLI entrypoint.
 *
 * Mirrors the surql-py typer CLI. Every subcommand accepts the
 * top-level `--config <path>` option so a single surql.yaml /
 * surql.toml can drive every invocation.
 *
 * Required permissions:
 *   --allow-read   settings files, migration files
 *   --allow-write  create migrations, export schema, write diagrams
 *   --allow-net    talk to SurrealDB
 *   --allow-env    read SURQL_* environment variables
 *   --allow-sys    fetch host/os info for error reporting
 *   --allow-run=git  schema drift hooks shell out to git
 *
 * Install (from jsr): `deno install -grf jsr:@oneiriq/surql/cli`
 */

import { run } from './mod.ts'

if (import.meta.main) {
  try {
    await run(Deno.args)
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    Deno.exit(1)
  }
}
