/**
 * Type coercion utilities for SurrealDB response data.
 *
 * Provides functions for converting SurrealDB response values into proper
 * types, particularly ISO datetime strings into Date objects.
 */

/**
 * Convert a SurrealDB ISO datetime string to a Date object.
 *
 * Handles ISO 8601 format strings including:
 * - Standard: '2024-01-15T10:30:00Z'
 * - Timezone offset: '2024-01-15T10:30:00+00:00'
 * - Nanoseconds: '2024-01-15T10:30:00.123456789Z' (truncated to ms)
 */
export function coerceDatetime(value: string | Date): Date {
  if (value instanceof Date) return value

  // Normalize Z suffix for consistent parsing
  let normalized = value.replace('Z', '+00:00')

  // Truncate sub-millisecond precision (JS Date supports up to 3 decimal places)
  const dotIdx = normalized.indexOf('.')
  if (dotIdx !== -1) {
    let fracEnd = dotIdx + 1
    while (fracEnd < normalized.length && /\d/.test(normalized[fracEnd])) {
      fracEnd++
    }
    const fracPart = normalized.slice(dotIdx + 1, fracEnd)
    const truncated = fracPart.length > 3 ? fracPart.slice(0, 3) : fracPart
    normalized = normalized.slice(0, dotIdx + 1) + truncated + normalized.slice(fracEnd)
  }

  // Restore Z for standard ISO parsing
  normalized = normalized.replace('+00:00', 'Z')

  const dt = new Date(normalized)
  if (isNaN(dt.getTime())) {
    throw new Error(`Cannot parse datetime: '${value}'`)
  }
  return dt
}

/**
 * Coerce datetime string fields in a record to Date objects.
 *
 * Returns a new record with specified fields converted from ISO strings to Date.
 */
export function coerceRecordDatetimes<T extends Record<string, unknown>>(
  data: T,
  datetimeFields: string[],
): T {
  const result = { ...data }
  for (const fieldName of datetimeFields) {
    if (fieldName in result && result[fieldName] != null) {
      const raw = result[fieldName]
      if (typeof raw === 'string') {
        ;(result as Record<string, unknown>)[fieldName] = coerceDatetime(raw)
      }
    }
  }
  return result
}
