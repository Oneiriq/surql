/**
 * File reference value type for SurrealDB v3 object storage.
 *
 * A file reference addresses a single object inside a bucket. SurrealQL writes
 * it as `<bucket>:/<key>` and the wire/CBOR form is the structured pair
 * `{ bucket, key }`. This module provides a small immutable value type plus the
 * conversions and recognition helpers needed to round-trip file values to and
 * from query results — mirroring how the library normalises `RecordId` values.
 *
 * The surrealdb SDK exposes its own `FileRef` class; {@link isFileRefLike} and
 * {@link toFileRef} duck-type against it (any `{ bucket, key }` carrier) so a
 * value returned by the driver is recognised regardless of which class produced
 * it.
 */

/** Structured (SQON / CBOR) form of a file reference. */
export interface FileRefObject {
  readonly bucket: string
  readonly key: string
}

/**
 * Immutable file reference: a `{ bucket, key }` pair that stringifies to the
 * single-slash SurrealQL pointer `<bucket>:/<key>`.
 *
 * The `key` is stored VERBATIM, exactly as supplied or as the server returns
 * it. SurrealDB's canonical key form carries a leading slash (`file::key()`
 * yields `/a.txt` however the file was written), so a `FileRef` decoded from a
 * query result will typically have a leading slash on `key`; one constructed by
 * hand may or may not. Either way {@link toString} renders a single-slash
 * pointer, and the server itself treats `a.txt` and `/a.txt` as the same file,
 * so both inputs resolve identically on the wire.
 */
export class FileRef {
  readonly bucket: string
  readonly key: string

  constructor(bucket: string, key: string) {
    if (!bucket || bucket.length === 0) {
      throw new Error('FileRef requires a non-empty bucket')
    }
    if (!key || key.length === 0) {
      throw new Error('FileRef requires a non-empty key')
    }
    // Store both fields verbatim — keys are presented in SurrealDB's canonical
    // form (which may include a leading slash); we neither add nor strip it.
    this.bucket = bucket
    this.key = key
    Object.freeze(this)
  }

  /**
   * The SurrealQL textual pointer `<bucket>:/<key>`.
   *
   * Always emits exactly one slash after the colon: any leading slashes on the
   * stored key are collapsed so `key` of `a.txt` and `/a.txt` both render as
   * `bucket:/a.txt`.
   */
  toString(): string {
    return `${this.bucket}:/${this.key.replace(/^\/+/, '')}`
  }

  /** JSON form mirrors the textual form, matching the SDK's `FileRef`. */
  toJSON(): string {
    return this.toString()
  }

  /** The structured `{ bucket, key }` form (SQON / CBOR shape), keys verbatim. */
  toObject(): FileRefObject {
    return { bucket: this.bucket, key: this.key }
  }

  /** Structural equality: compares the stored `bucket` and `key` fields as-is. */
  equals(other: unknown): boolean {
    if (!isFileRefLike(other)) return false
    return other.bucket === this.bucket && other.key === this.key
  }
}

/**
 * Matches the SurrealQL textual file form `<bucket>:/<key>`. The bucket is a
 * bare identifier; the captured key INCLUDES its leading slash (the canonical
 * form the server uses) and may contain further slashes.
 */
const FILE_STRING_RE = /^([A-Za-z_][A-Za-z0-9_]*):(\/.+)$/

/**
 * Duck-type guard: is `value` a file reference carrier (our {@link FileRef},
 * the SDK's `FileRef`, or any object exposing string `bucket` and `key`)?
 */
export function isFileRefLike(value: unknown): value is FileRefObject {
  if (value === null || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return typeof obj.bucket === 'string' && typeof obj.key === 'string'
}

/**
 * Parse a `<bucket>:/<key>` string into a {@link FileRef}. Returns `undefined`
 * when the string is not in file form.
 */
export function parseFileRef(value: string): FileRef | undefined {
  const m = FILE_STRING_RE.exec(value)
  if (!m) return undefined
  return new FileRef(m[1], m[2])
}

/**
 * Coerce an arbitrary value into a {@link FileRef}.
 *
 * Accepts an existing {@link FileRef}, any `{ bucket, key }` carrier (including
 * the SDK's `FileRef`), or a `<bucket>:/<key>` string. Returns `undefined` when
 * the value cannot be interpreted as a file reference.
 */
export function toFileRef(value: unknown): FileRef | undefined {
  if (value instanceof FileRef) return value
  if (typeof value === 'string') return parseFileRef(value)
  if (isFileRefLike(value)) {
    try {
      return new FileRef(value.bucket, value.key)
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * Convert a file reference (or `{ bucket, key }` carrier, or file string) to
 * its bare `<bucket>:/<key>` string. Plain strings already in file form are
 * returned unchanged; non-file values are returned via `String(value)`.
 */
export function fileRefToString(value: unknown): string {
  const ref = toFileRef(value)
  return ref ? ref.toString() : String(value)
}
