/**
 * File / object-storage runtime module.
 *
 * Exposes the {@link Bucket} handle and its supporting types. Obtain a handle
 * via `client.bucket(name)` rather than constructing it directly.
 */

export { Bucket, type FileData, type FileEntry, type ListOptions } from './bucket.ts'
