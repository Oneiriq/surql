import { assertEquals, assertRejects } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { RecordId } from 'surrealdb'
import {
  equalTo,
  greaterThan,
  isArray,
  isBoolean,
  isFunction,
  isNumber,
  isObject,
  isPrimitiveOrNullish,
  isString,
  lessThan,
  normalizeSurrealRecord,
  normalizeSurrealRecords,
  recordIdToString,
  safeJsonStringify,
  sanitizeErrorMessage,
  truncateMessage,
  validateAndDecodeJWTPayload,
} from '../utils/helpers.ts'

describe('safeJsonStringify', () => {
  it('should stringify simple objects', () => {
    const result = safeJsonStringify({ name: 'Alice', age: 30 })
    assertEquals(result.includes('Alice'), true)
    assertEquals(result.includes('30'), true)
  })

  it('should redact sensitive keys', () => {
    const result = safeJsonStringify({ password: 'secret123', name: 'Alice' })
    assertEquals(result.includes('[REDACTED]'), true)
    assertEquals(result.includes('secret123'), false)
  })

  it('should redact token keys', () => {
    const result = safeJsonStringify({ auth_token: 'abc', name: 'test' })
    assertEquals(result.includes('[REDACTED]'), true)
  })

  it('should handle circular references', () => {
    // deno-lint-ignore no-explicit-any
    const obj: any = { name: 'test' }
    obj.self = obj
    const result = safeJsonStringify(obj)
    assertEquals(result.includes('[Circular]'), true)
  })

  it('should handle null', () => {
    assertEquals(safeJsonStringify(null), 'null')
  })
})

describe('truncateMessage', () => {
  it('should return short messages unchanged', () => {
    assertEquals(truncateMessage('hello', 100), 'hello')
  })

  it('should truncate long messages with ellipsis', () => {
    const long = 'A'.repeat(100)
    const result = truncateMessage(long, 50)
    assertEquals(result.length, 50)
    assertEquals(result.endsWith('...'), true)
  })

  it('should handle exact length', () => {
    assertEquals(truncateMessage('hello', 5), 'hello')
  })
})

describe('sanitizeErrorMessage', () => {
  it('should return full message in development mode', () => {
    const result = sanitizeErrorMessage('test error message', true)
    assertEquals(result.includes('test error message'), true)
  })

  it('should sanitize secrets in development mode', () => {
    const result = sanitizeErrorMessage('password=secret123', true)
    assertEquals(result.includes('secret123'), false)
    assertEquals(result.includes('[omitted]'), true)
  })
})

describe('recordIdToString', () => {
  it('should return string input unchanged', () => {
    assertEquals(recordIdToString('users:123'), 'users:123')
  })

  it('should convert RecordId to string', () => {
    const rid = new RecordId('users', '123')
    const result = recordIdToString(rid)
    assertEquals(typeof result, 'string')
    assertEquals(result.includes('users'), true)
  })
})

describe('normalizeSurrealRecord', () => {
  it('should convert RecordId id to string', () => {
    const record = {
      id: new RecordId('users', '123'),
      name: 'Alice',
    }
    const normalized = normalizeSurrealRecord(record)
    assertEquals(typeof normalized.id, 'string')
    assertEquals(normalized.name, 'Alice')
  })

  it('should preserve all other fields', () => {
    const record = {
      id: new RecordId('items', '1'),
      title: 'Test',
      count: 42,
      active: true,
    }
    const normalized = normalizeSurrealRecord(record)
    assertEquals(normalized.title, 'Test')
    assertEquals(normalized.count, 42)
    assertEquals(normalized.active, true)
  })
})

describe('normalizeSurrealRecords', () => {
  it('should normalize an array of records', () => {
    const records = [
      { id: new RecordId('users', '1'), name: 'Alice' },
      { id: new RecordId('users', '2'), name: 'Bob' },
    ]
    const normalized = normalizeSurrealRecords(records)
    assertEquals(normalized.length, 2)
    assertEquals(typeof normalized[0].id, 'string')
    assertEquals(typeof normalized[1].id, 'string')
    assertEquals(normalized[0].name, 'Alice')
    assertEquals(normalized[1].name, 'Bob')
  })

  it('should handle empty arrays', () => {
    const normalized = normalizeSurrealRecords([])
    assertEquals(normalized.length, 0)
  })
})

describe('validateAndDecodeJWTPayload', () => {
  it('should reject empty string', async () => {
    await assertRejects(
      () => validateAndDecodeJWTPayload(''),
      Error,
      'Invalid JWT token',
    )
  })

  it('should reject non-3-part token', async () => {
    await assertRejects(
      () => validateAndDecodeJWTPayload('only.two'),
      Error,
      'must have exactly 3 parts',
    )
  })

  it('should decode a valid JWT payload', async () => {
    // Create a minimal JWT (header.payload.signature)
    const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))
    const payload = btoa(JSON.stringify({ sub: '123', name: 'Test' }))
    const signature = 'fake-sig'
    const token = `${header}.${payload}.${signature}`

    const result = await validateAndDecodeJWTPayload<{ sub: string; name: string }>(token)
    assertEquals(result.sub, '123')
    assertEquals(result.name, 'Test')
  })

  it('should reject expired tokens', async () => {
    const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))
    const payload = btoa(JSON.stringify({ sub: '123', exp: 1 }))
    const token = `${header}.${payload}.sig`

    await assertRejects(
      () => validateAndDecodeJWTPayload(token),
      Error,
      'expired',
    )
  })
})

describe('type guard functions', () => {
  describe('isPrimitiveOrNullish', () => {
    it('should return true for null', () => assertEquals(isPrimitiveOrNullish(null), true))
    it('should return true for undefined', () => assertEquals(isPrimitiveOrNullish(undefined), true))
    it('should return true for boolean', () => assertEquals(isPrimitiveOrNullish(true), true))
    it('should return true for number', () => assertEquals(isPrimitiveOrNullish(42), true))
    it('should return false for string', () => assertEquals(isPrimitiveOrNullish('hello'), false))
    it('should return false for object', () => assertEquals(isPrimitiveOrNullish({}), false))
    it('should return false for array', () => assertEquals(isPrimitiveOrNullish([]), false))
  })

  describe('isString', () => {
    it('should return true for strings', () => assertEquals(isString('hello'), true))
    it('should return false for non-strings', () => assertEquals(isString(42), false))
  })

  describe('isNumber', () => {
    it('should return true for numbers', () => assertEquals(isNumber(42), true))
    it('should return false for non-numbers', () => assertEquals(isNumber('42'), false))
  })

  describe('isBoolean', () => {
    it('should return true for booleans', () => assertEquals(isBoolean(true), true))
    it('should return false for non-booleans', () => assertEquals(isBoolean(1), false))
  })

  describe('isObject', () => {
    it('should return true for plain objects', () => assertEquals(isObject({}), true))
    it('should return false for null', () => assertEquals(isObject(null), false))
    it('should return false for arrays', () => assertEquals(isObject([]), false))
  })

  describe('isArray', () => {
    it('should return true for arrays', () => assertEquals(isArray([]), true))
    it('should return false for non-arrays', () => assertEquals(isArray({}), false))
  })

  describe('isFunction', () => {
    it('should return true for functions', () => assertEquals(isFunction(() => {}), true))
    it('should return false for non-functions', () => assertEquals(isFunction('fn'), false))
  })
})

describe('comparison functions', () => {
  describe('lessThan', () => {
    it('should return true when a < b', () => assertEquals(lessThan(1, 2), true))
    it('should return false when a >= b', () => assertEquals(lessThan(2, 2), false))
  })

  describe('greaterThan', () => {
    it('should return true when a > b', () => assertEquals(greaterThan(2, 1), true))
    it('should return false when a <= b', () => assertEquals(greaterThan(1, 1), false))
  })

  describe('equalTo', () => {
    it('should return true when a == b', () => assertEquals(equalTo(1, 1), true))
    it('should return false when a != b', () => assertEquals(equalTo(1, 2), false))
  })
})
