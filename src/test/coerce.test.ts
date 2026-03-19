import { assertEquals, assertThrows } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { coerceDatetime, coerceRecordDatetimes } from '../types/coerce.ts'

describe('coerceDatetime', () => {
  it('should pass through Date objects unchanged', () => {
    const date = new Date('2024-01-15T10:30:00Z')
    assertEquals(coerceDatetime(date), date)
  })

  it('should parse standard ISO 8601 with Z suffix', () => {
    const result = coerceDatetime('2024-01-15T10:30:00Z')
    assertEquals(result.toISOString(), '2024-01-15T10:30:00.000Z')
  })

  it('should parse ISO 8601 with timezone offset', () => {
    const result = coerceDatetime('2024-01-15T10:30:00+00:00')
    assertEquals(result.toISOString(), '2024-01-15T10:30:00.000Z')
  })

  it('should parse ISO 8601 with milliseconds', () => {
    const result = coerceDatetime('2024-01-15T10:30:00.123Z')
    assertEquals(result.getMilliseconds(), 123)
  })

  it('should truncate nanosecond precision to milliseconds', () => {
    const result = coerceDatetime('2024-01-15T10:30:00.123456789Z')
    assertEquals(result.getMilliseconds(), 123)
  })

  it('should handle microsecond precision', () => {
    const result = coerceDatetime('2024-01-15T10:30:00.123456Z')
    assertEquals(result.getMilliseconds(), 123)
  })

  it('should throw for unparseable datetime strings', () => {
    assertThrows(
      () => coerceDatetime('not-a-date'),
      Error,
      'Cannot parse datetime',
    )
  })

  it('should throw for empty string', () => {
    assertThrows(
      () => coerceDatetime(''),
      Error,
      'Cannot parse datetime',
    )
  })

  it('should handle date-only strings', () => {
    const result = coerceDatetime('2024-01-15')
    assertEquals(result.getFullYear(), 2024)
    // Date-only strings are parsed as UTC midnight, so use UTC methods
    assertEquals(result.getUTCMonth(), 0)
    assertEquals(result.getUTCDate(), 15)
  })
})

describe('coerceRecordDatetimes', () => {
  it('should convert specified string fields to Date objects', () => {
    const data: Record<string, unknown> = {
      name: 'Alice',
      created_at: '2024-01-15T10:30:00Z',
      updated_at: '2024-06-01T12:00:00Z',
    }
    const result = coerceRecordDatetimes(data, ['created_at', 'updated_at'])
    assertEquals(result.created_at instanceof Date, true)
    assertEquals(result.updated_at instanceof Date, true)
    assertEquals(result.name, 'Alice')
  })

  it('should not modify non-specified fields', () => {
    const data = {
      name: 'Alice',
      created_at: '2024-01-15T10:30:00Z',
    }
    const result = coerceRecordDatetimes(data, ['created_at'])
    assertEquals(typeof result.name, 'string')
  })

  it('should skip null or undefined field values', () => {
    const data = {
      name: 'Alice',
      created_at: null,
      updated_at: undefined,
    }
    const result = coerceRecordDatetimes(data, ['created_at', 'updated_at'])
    assertEquals(result.created_at, null)
    assertEquals(result.updated_at, undefined)
  })

  it('should skip fields not present in the record', () => {
    const data = { name: 'Alice' }
    const result = coerceRecordDatetimes(data, ['nonexistent'])
    assertEquals(result.name, 'Alice')
  })

  it('should return a new object (not mutate the original)', () => {
    const data: Record<string, unknown> = { created_at: '2024-01-15T10:30:00Z' }
    const result = coerceRecordDatetimes(data, ['created_at'])
    assertEquals(typeof data.created_at, 'string')
    assertEquals(result.created_at instanceof Date, true)
  })

  it('should handle empty datetime fields array', () => {
    const data = { name: 'Alice', created_at: '2024-01-15T10:30:00Z' }
    const result = coerceRecordDatetimes(data, [])
    assertEquals(typeof result.created_at, 'string')
  })

  it('should skip non-string field values', () => {
    const data = { created_at: 12345 }
    const result = coerceRecordDatetimes(data, ['created_at'])
    assertEquals(result.created_at, 12345)
  })
})
