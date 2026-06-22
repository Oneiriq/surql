/**
 * Bucket (object storage) schema definitions for SurrealDB v3.
 *
 * A bucket is a named object store backed by an in-memory, on-disk, or remote
 * (S3-compatible) backend. Files are written into a bucket and addressed by a
 * `<bucket>:/<key>` file reference. This module models a bucket as an immutable
 * definition (mirroring {@link AccessDefinition}) plus DDL emitters for
 * `DEFINE`, `REMOVE`, and `ALTER BUCKET`.
 *
 * The runtime file operations live in `src/files`; this module is purely the
 * schema/DDL layer used by the registry, migration differ, and parser.
 */

import type { TablePermissions } from './table.ts'

/**
 * Backend storage location for a bucket.
 *
 * - `memory` — ephemeral, in-process storage.
 * - `file:/<path>` — local filesystem directory.
 * - `s3://<bucket>[/prefix]` — S3-compatible remote object store.
 *
 * The string is emitted verbatim inside the `BACKEND "..."` clause, so any
 * backend URL the server accepts is permitted; the named members document the
 * common shapes.
 */
export type BucketBackend = 'memory' | `file:${string}` | `s3://${string}` | string

/**
 * Immutable bucket definition.
 *
 * Mirrors the table/access definition shape: a frozen value object with a name,
 * backend, optional read-only flag, optional permissions (same shape as table
 * permissions), and an optional comment.
 */
export interface BucketDefinition {
  readonly name: string
  readonly backend: BucketBackend
  readonly readonly: boolean
  readonly permissions?: TablePermissions
  readonly comment?: string
}

/** Options accepted by the bucket builders. */
export interface BucketOptions {
  readonly readonly?: boolean
  readonly permissions?: TablePermissions
  readonly comment?: string
}

function createBucket(name: string, backend: BucketBackend, options: BucketOptions = {}): BucketDefinition {
  const def: {
    name: string
    backend: BucketBackend
    readonly: boolean
    permissions?: TablePermissions
    comment?: string
  } = {
    name,
    backend,
    readonly: options.readonly ?? false,
  }
  if (options.permissions !== undefined) def.permissions = options.permissions
  if (options.comment !== undefined) def.comment = options.comment
  return Object.freeze(def)
}

/** Create a bucket definition against an explicit backend string. */
export function bucketSchema(name: string, backend: BucketBackend, options: BucketOptions = {}): BucketDefinition {
  return createBucket(name, backend, options)
}

/** Create an in-memory (ephemeral) bucket definition. */
export function memoryBucket(name: string, options: BucketOptions = {}): BucketDefinition {
  return createBucket(name, 'memory', options)
}

/**
 * Create a local-filesystem bucket definition. The `path` is wrapped as
 * `file:<path>` (only when it is not already a `file:` URL).
 */
export function fileBucket(name: string, path: string, options: BucketOptions = {}): BucketDefinition {
  const backend = path.startsWith('file:') ? path : `file:${path}`
  return createBucket(name, backend, options)
}

/**
 * Render a bucket `PERMISSIONS` clause. Mirrors the table/field permission
 * emitter: each configured action contributes a `FOR <action> <rule>`
 * sub-clause folded into the owning statement. Returns a string with a leading
 * space (or empty when no permissions are set) so callers can append it
 * unconditionally.
 */
function bucketPermissionsClause(perms: TablePermissions | undefined): string {
  if (!perms) return ''
  const clauses: string[] = []
  if (perms.select) clauses.push(`FOR select ${perms.select}`)
  if (perms.create) clauses.push(`FOR create ${perms.create}`)
  if (perms.update) clauses.push(`FOR update ${perms.update}`)
  if (perms.delete) clauses.push(`FOR delete ${perms.delete}`)
  return clauses.length > 0 ? ` PERMISSIONS ${clauses.join(' ')}` : ''
}

/**
 * Generate `DEFINE BUCKET` DDL for a bucket definition.
 *
 * Emits `DEFINE BUCKET [IF NOT EXISTS|OVERWRITE] <name> BACKEND "<backend>"
 * [READONLY] [PERMISSIONS ...] [COMMENT "..."]`.
 *
 * `ifNotExists` and `overwrite` are mutually exclusive; passing both throws.
 */
export function generateBucketSql(
  bucket: BucketDefinition,
  options: { ifNotExists?: boolean; overwrite?: boolean } = {},
): string {
  if (options.ifNotExists && options.overwrite) {
    throw new Error('generateBucketSql: ifNotExists and overwrite are mutually exclusive')
  }
  const prefix = options.ifNotExists ? ' IF NOT EXISTS' : options.overwrite ? ' OVERWRITE' : ''
  let sql = `DEFINE BUCKET${prefix} ${bucket.name} BACKEND "${bucket.backend}"`
  if (bucket.readonly) sql += ' READONLY'
  sql += bucketPermissionsClause(bucket.permissions)
  if (bucket.comment) sql += ` COMMENT "${bucket.comment}"`
  return sql + ';'
}

/**
 * Generate `REMOVE BUCKET` DDL. Pass `ifExists: true` to emit
 * `REMOVE BUCKET IF EXISTS <name>` for idempotent removal.
 */
export function generateRemoveBucketSql(name: string, options: { ifExists?: boolean } = {}): string {
  const ie = options.ifExists ? ' IF EXISTS' : ''
  return `REMOVE BUCKET${ie} ${name};`
}

/**
 * Generate `ALTER BUCKET` DDL describing the transition from `current` to
 * `target`.
 *
 * Each differing attribute emits its own clause:
 * - readonly: `READONLY` (turned on) / `DROP READONLY` (turned off)
 * - backend: `BACKEND "..."`
 * - permissions: `PERMISSIONS ...`
 * - comment: `COMMENT "..."` (set/changed) / `DROP COMMENT` (cleared)
 *
 * Returns `undefined` when the two definitions are equivalent (no statement
 * required). Pass `ifExists: true` to emit `ALTER BUCKET IF EXISTS <name>`.
 */
export function generateAlterBucketSql(
  current: BucketDefinition,
  target: BucketDefinition,
  options: { ifExists?: boolean } = {},
): string | undefined {
  const clauses: string[] = []

  if (current.readonly !== target.readonly) {
    clauses.push(target.readonly ? 'READONLY' : 'DROP READONLY')
  }
  if (current.backend !== target.backend) {
    clauses.push(`BACKEND "${target.backend}"`)
  }
  if (JSON.stringify(current.permissions) !== JSON.stringify(target.permissions)) {
    const permClause = bucketPermissionsClause(target.permissions)
    // permClause carries a leading space and the `PERMISSIONS` keyword; trim
    // the lead so it sits cleanly in the clause list. Empty means the target
    // cleared permissions, which has no `DROP PERMISSIONS` form — skip it.
    if (permClause.length > 0) clauses.push(permClause.trimStart())
  }
  if ((current.comment ?? '') !== (target.comment ?? '')) {
    clauses.push(target.comment ? `COMMENT "${target.comment}"` : 'DROP COMMENT')
  }

  if (clauses.length === 0) return undefined

  const ie = options.ifExists ? ' IF EXISTS' : ''
  return `ALTER BUCKET${ie} ${target.name} ${clauses.join(' ')};`
}
