import { assertEquals, assertThrows } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { escapeTable, quoteValue, ReturnFormat, validateIdentifier } from '../query/helpers.ts'

describe('quoteValue', () => {
  it('should return NONE for null', () => {
    assertEquals(quoteValue(null), 'NONE')
  })

  it('should return NONE for undefined', () => {
    assertEquals(quoteValue(undefined), 'NONE')
  })

  it('should quote strings with single quotes', () => {
    assertEquals(quoteValue('hello'), "'hello'")
  })

  it('should escape single quotes in strings', () => {
    assertEquals(quoteValue("it's"), "'it\\'s'")
  })

  it('should escape backslashes before quotes (no quote-smuggle)', () => {
    // Regression for CodeQL js/incomplete-sanitization: an attacker passing
    // a literal backslash followed by a single quote must not be able to
    // produce a string that closes the SurrealQL string and continues as code.
    assertEquals(quoteValue("a\\'; SELECT * FROM users; --"), "'a\\\\\\'; SELECT * FROM users; --'")
    assertEquals(quoteValue('back\\slash'), "'back\\\\slash'")
  })

  it('should return true/false for booleans', () => {
    assertEquals(quoteValue(true), 'true')
    assertEquals(quoteValue(false), 'false')
  })

  it('should stringify numbers', () => {
    assertEquals(quoteValue(42), '42')
    assertEquals(quoteValue(3.14), '3.14')
    assertEquals(quoteValue(-1), '-1')
    assertEquals(quoteValue(0), '0')
  })

  it('should format arrays recursively', () => {
    assertEquals(quoteValue([1, 2, 3]), '[1, 2, 3]')
    assertEquals(quoteValue(['a', 'b']), "['a', 'b']")
  })

  it('should format nested arrays', () => {
    assertEquals(quoteValue([[1, 2], [3]]), '[[1, 2], [3]]')
  })

  it('should JSON.stringify plain objects', () => {
    const result = quoteValue({ key: 'val' })
    assertEquals(result, '{"key":"val"}')
  })

  it('should handle empty arrays', () => {
    assertEquals(quoteValue([]), '[]')
  })

  it('should handle mixed-type arrays', () => {
    assertEquals(quoteValue([1, 'two', true, null]), "[1, 'two', true, NONE]")
  })
})

describe('validateIdentifier', () => {
  it('should accept simple names', () => {
    validateIdentifier('users')
    validateIdentifier('my_table')
  })

  it('should accept names with dots', () => {
    validateIdentifier('schema.table')
  })

  it('should accept names with colons', () => {
    validateIdentifier('table:id')
  })

  it('should accept names with hyphens', () => {
    validateIdentifier('my-table')
  })

  it('should accept names with asterisks', () => {
    validateIdentifier('*')
    validateIdentifier('table.*')
  })

  it('should accept numeric strings', () => {
    validateIdentifier('123')
  })

  it('should reject names with spaces', () => {
    assertThrows(() => validateIdentifier('bad name'), Error, 'Invalid identifier')
  })

  it('should reject names with semicolons', () => {
    assertThrows(() => validateIdentifier('name;DROP'), Error, 'Invalid identifier')
  })

  it('should reject names with quotes', () => {
    assertThrows(() => validateIdentifier("name'"), Error, 'Invalid identifier')
    assertThrows(() => validateIdentifier('name"'), Error, 'Invalid identifier')
  })

  it('should reject names with parentheses', () => {
    assertThrows(() => validateIdentifier('fn()'), Error, 'Invalid identifier')
  })

  it('should reject empty string', () => {
    assertThrows(() => validateIdentifier(''), Error, 'Invalid identifier')
  })
})

describe('escapeTable', () => {
  it('should return a valid table name unchanged', () => {
    assertEquals(escapeTable('users'), 'users')
    assertEquals(escapeTable('my_table'), 'my_table')
  })

  it('should reject invalid table names', () => {
    assertThrows(() => escapeTable('bad table'), Error, 'Invalid identifier')
    assertThrows(() => escapeTable('table;DROP'), Error, 'Invalid identifier')
  })
})

describe('ReturnFormat', () => {
  it('should have all expected values', () => {
    assertEquals(ReturnFormat.NONE, 'NONE')
    assertEquals(ReturnFormat.DIFF, 'DIFF')
    assertEquals(ReturnFormat.FULL, 'FULL')
    assertEquals(ReturnFormat.BEFORE, 'BEFORE')
    assertEquals(ReturnFormat.AFTER, 'AFTER')
  })
})
