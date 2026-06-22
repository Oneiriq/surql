/**
 * Runtime object-storage operations for SurrealDB v3 buckets.
 *
 * A {@link Bucket} handle wraps a bucket name and a connection provider and
 * exposes the file operations as direct async methods. Unlike the rest of the
 * library this layer is intentionally NOT a query builder — file operations are
 * one-shot side effects, so a fluent builder would add ceremony without value.
 *
 * ## Safety
 *
 * Every operation is dispatched through the parameterized
 * `type::file($bucket, $key)` constructor with the bucket name, key, payload,
 * and copy/rename targets supplied as BOUND query variables. Bucket names,
 * keys, and data are NEVER interpolated into the SurrealQL string, so a key or
 * payload containing quotes, `;`, or other SurrealQL syntax cannot break out of
 * its value position. `Uint8Array` payloads are bound directly; the surrealdb
 * SDK encodes them as the SurrealQL `bytes` type.
 */

import type { ConnectionProvider } from '../crud/base.ts'
import { intoSurQlError } from '../utils/surrealError.ts'
import { FileRef, isFileRefLike } from '../types/file.ts'

/** Payload accepted by write operations: UTF-8 text or raw bytes. */
export type FileData = string | Uint8Array

/**
 * Metadata describing a single file in a bucket, as returned by `head()` and
 * `list()`.
 *
 * SurrealDB's raw `head`/`file::list` rows carry the file as a single `file`
 * pointer value; the surrealdb SDK decodes that pointer into a `FileRef`, which
 * this library splits into the canonical `bucket` and `key` fields (the `key`
 * carries SurrealDB's canonical leading slash, e.g. `/logo.png`). The original
 * pointer is preserved on {@link FileEntry.file} for callers who want it.
 */
export interface FileEntry {
  /** The bucket the file lives in. */
  readonly bucket: string
  /** The file's canonical key (carries a leading slash, e.g. `/logo.png`). */
  readonly key: string
  /** The file reference value (its `toString()` is the `<bucket>:/<key>` pointer). */
  readonly file: FileRef
  /** File size in bytes. */
  readonly size: number
  /** Last modification time. */
  readonly updated: Date | string
}

/**
 * Normalise one raw `head`/`file::list` row into a {@link FileEntry}.
 *
 * The driver decodes the row's `file` pointer into a `FileRef` carrier; we lift
 * its canonical `bucket`/`key` onto the entry and re-wrap the value as our own
 * {@link FileRef} so callers get a stable type regardless of which SDK produced
 * it. Returns `undefined` for rows whose `file` is not a recognisable pointer.
 */
function normalizeEntry(row: unknown): FileEntry | undefined {
  if (row === null || typeof row !== 'object') return undefined
  const r = row as { file?: unknown; size?: unknown; updated?: unknown }
  if (!isFileRefLike(r.file)) return undefined
  const file = new FileRef(r.file.bucket, r.file.key)
  return {
    bucket: file.bucket,
    key: file.key,
    file,
    size: typeof r.size === 'number' ? r.size : Number(r.size ?? 0),
    updated: (r.updated as Date | string) ?? '',
  }
}

/** Optional filters for {@link Bucket.list}, mirroring `file::list` options. */
export interface ListOptions {
  /** Maximum number of files to return. */
  readonly limit?: number
  /** Return files ordered after this key. */
  readonly start?: string
  /** Only return files whose key begins with this prefix. */
  readonly prefix?: string
}

/**
 * Unwrap the first statement result from a surrealdb multi-statement response.
 *
 * `conn.query(sql, vars)` resolves to one entry per statement; our file ops
 * always send a single statement, so the value of interest is at index 0.
 */
function firstResult<T>(results: unknown): T | undefined {
  if (Array.isArray(results)) return results[0] as T | undefined
  return undefined
}

/**
 * A handle to a single bucket, exposing object-storage file operations.
 *
 * Obtain one via `client.bucket(name)`. The handle holds no connection of its
 * own; each call resolves a connection from the provider on demand.
 */
export class Bucket {
  private readonly provider: ConnectionProvider
  /** The bucket name this handle targets. */
  readonly name: string

  constructor(provider: ConnectionProvider, name: string) {
    if (!name || name.length === 0) {
      throw new Error('Bucket requires a non-empty name')
    }
    this.provider = provider
    this.name = name
  }

  /** Build a {@link FileRef} for a key within this bucket. */
  ref(key: string): FileRef {
    return new FileRef(this.name, key)
  }

  /**
   * Run a single parameterized statement and return its first-statement result.
   * `$bucket` and `$key` are always bound; extra bindings are merged in.
   */
  private async run<T>(
    statement: string,
    key: string,
    extra: Record<string, unknown> = {},
  ): Promise<T | undefined> {
    try {
      const conn = await this.provider.getConnection()
      const vars = { bucket: this.name, key, ...extra }
      const results = await conn.query<unknown[]>(statement, vars)
      return firstResult<T>(results)
    } catch (e) {
      throw intoSurQlError(`Bucket operation failed on '${this.name}':`, e)
    }
  }

  /**
   * Write `data` to `key`, overwriting any existing file.
   *
   * SurrealQL: `type::file($bucket, $key).put($data)`.
   */
  async put(key: string, data: FileData): Promise<void> {
    await this.run<unknown>('RETURN type::file($bucket, $key).put($data)', key, { data })
  }

  /**
   * Write `data` to `key` only if no file already exists there.
   *
   * SurrealQL: `type::file($bucket, $key).put_if_not_exists($data)`.
   */
  async putIfNotExists(key: string, data: FileData): Promise<void> {
    await this.run<unknown>('RETURN type::file($bucket, $key).put_if_not_exists($data)', key, { data })
  }

  /**
   * Read the raw bytes stored at `key`.
   *
   * SurrealQL: `type::file($bucket, $key).get()`. Returns `undefined` when the
   * file does not exist.
   */
  async get(key: string): Promise<Uint8Array | undefined> {
    const value = await this.run<unknown>('RETURN type::file($bucket, $key).get()', key)
    if (value === null || value === undefined) return undefined
    if (value instanceof Uint8Array) return value
    if (value instanceof ArrayBuffer) return new Uint8Array(value)
    if (typeof value === 'string') return new TextEncoder().encode(value)
    // Some transports surface bytes as a number array.
    if (Array.isArray(value)) return Uint8Array.from(value as number[])
    return undefined
  }

  /**
   * Read the contents of `key` decoded as a UTF-8 string.
   *
   * SurrealQL: `RETURN <string>type::file($bucket, $key).get()`. Returns
   * `undefined` when the file does not exist.
   */
  async getText(key: string): Promise<string | undefined> {
    const value = await this.run<unknown>('RETURN <string>type::file($bucket, $key).get()', key)
    if (value === null || value === undefined) return undefined
    if (typeof value === 'string') return value
    if (value instanceof Uint8Array) return new TextDecoder().decode(value)
    return String(value)
  }

  /**
   * Report whether a file exists at `key`.
   *
   * SurrealQL: `type::file($bucket, $key).exists()`.
   */
  async exists(key: string): Promise<boolean> {
    const value = await this.run<unknown>('RETURN type::file($bucket, $key).exists()', key)
    return value === true
  }

  /**
   * Fetch file metadata (without the body) for `key`.
   *
   * SurrealQL: `type::file($bucket, $key).head()`. Returns `undefined` when the
   * file does not exist. The returned entry carries the canonical key (with a
   * leading slash) split out from the driver-decoded file pointer.
   */
  async head(key: string): Promise<FileEntry | undefined> {
    const value = await this.run<unknown>('RETURN type::file($bucket, $key).head()', key)
    return normalizeEntry(value)
  }

  /**
   * Delete the file at `key`.
   *
   * SurrealQL: `type::file($bucket, $key).delete()`.
   */
  async delete(key: string): Promise<void> {
    await this.run<unknown>('RETURN type::file($bucket, $key).delete()', key)
  }

  /**
   * Copy `key` to `target` (a key within the same bucket), overwriting any
   * existing file at the target.
   *
   * SurrealQL: `type::file($bucket, $key).copy($target)`.
   */
  async copy(key: string, target: string): Promise<void> {
    await this.run<unknown>('RETURN type::file($bucket, $key).copy($target)', key, { target })
  }

  /**
   * Copy `key` to `target` only if no file already exists at the target.
   *
   * SurrealQL: `type::file($bucket, $key).copy_if_not_exists($target)`.
   */
  async copyIfNotExists(key: string, target: string): Promise<void> {
    await this.run<unknown>('RETURN type::file($bucket, $key).copy_if_not_exists($target)', key, { target })
  }

  /**
   * Rename (move) `key` to `target` within the same bucket, overwriting any
   * existing file at the target.
   *
   * SurrealQL: `type::file($bucket, $key).rename($target)`.
   */
  async rename(key: string, target: string): Promise<void> {
    await this.run<unknown>('RETURN type::file($bucket, $key).rename($target)', key, { target })
  }

  /**
   * Rename (move) `key` to `target` only if no file already exists at the
   * target.
   *
   * SurrealQL: `type::file($bucket, $key).rename_if_not_exists($target)`.
   */
  async renameIfNotExists(key: string, target: string): Promise<void> {
    await this.run<unknown>('RETURN type::file($bucket, $key).rename_if_not_exists($target)', key, { target })
  }

  /**
   * List the files in this bucket.
   *
   * SurrealQL: `file::list($bucket)` (a bucket-level function), optionally with
   * a `{ limit, start, prefix }` options object bound as `$options`.
   */
  async list(options: ListOptions = {}): Promise<FileEntry[]> {
    try {
      const conn = await this.provider.getConnection()
      const hasOptions = options.limit !== undefined || options.start !== undefined ||
        options.prefix !== undefined
      const statement = hasOptions ? 'RETURN file::list($bucket, $options)' : 'RETURN file::list($bucket)'
      const vars: Record<string, unknown> = { bucket: this.name }
      if (hasOptions) vars.options = options
      const results = await conn.query<unknown[]>(statement, vars)
      const value = firstResult<unknown[]>(results)
      if (!Array.isArray(value)) return []
      return value
        .map(normalizeEntry)
        .filter((e): e is FileEntry => e !== undefined)
    } catch (e) {
      throw intoSurQlError(`Bucket operation failed on '${this.name}':`, e)
    }
  }
}
