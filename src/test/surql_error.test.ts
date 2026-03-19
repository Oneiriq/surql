import { assertEquals, assertStringIncludes } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { intoSurQlError, SurQlError } from '../utils/surrealError.ts'

describe('SurQlError', () => {
  it('should create error with message', () => {
    const error = new SurQlError('test error')
    assertEquals(error.message, 'test error')
    assertEquals(error.name, 'SurQlError')
  })

  it('should be an instance of Error', () => {
    const error = new SurQlError('test')
    assertEquals(error instanceof Error, true)
  })

  describe('toJSON', () => {
    it('should serialize to JSON', () => {
      const error = new SurQlError('test error')
      const json = error.toJSON()
      assertEquals(json.name, 'SurQlError')
      assertEquals(json.message, 'test error')
      assertEquals(typeof json.stack, 'string')
    })
  })
})

describe('intoSurQlError', () => {
  it('should pass through SurQlError instances', () => {
    const original = new SurQlError('original')
    const result = intoSurQlError(original)
    assertEquals(result, original)
  })

  it('should convert Error to SurQlError', () => {
    const result = intoSurQlError(new Error('standard error'))
    assertEquals(result instanceof SurQlError, true)
    assertStringIncludes(result.message, 'standard error')
  })

  it('should convert string to SurQlError', () => {
    const result = intoSurQlError('string message')
    assertEquals(result instanceof SurQlError, true)
    assertStringIncludes(result.message, 'string message')
  })

  it('should handle string prefix with Error details', () => {
    const result = intoSurQlError('Operation failed:', new Error('details here'))
    assertEquals(result instanceof SurQlError, true)
    assertStringIncludes(result.message, 'Operation failed:')
    assertStringIncludes(result.message, 'details here')
  })

  it('should handle string prefix with string details', () => {
    const result = intoSurQlError('Failed:', 'some string error')
    assertEquals(result instanceof SurQlError, true)
    assertStringIncludes(result.message, 'Failed:')
    assertStringIncludes(result.message, 'some string error')
  })

  it('should handle string prefix with object having message', () => {
    const result = intoSurQlError('Op failed:', { message: 'object msg' })
    assertEquals(result instanceof SurQlError, true)
    assertStringIncludes(result.message, 'Op failed:')
  })

  it('should handle string prefix with non-message object', () => {
    const result = intoSurQlError('Op failed:', { code: 500 })
    assertEquals(result instanceof SurQlError, true)
    assertStringIncludes(result.message, 'Op failed:')
  })

  it('should handle string prefix with unknown error type', () => {
    const result = intoSurQlError('Failed:', 42)
    assertEquals(result instanceof SurQlError, true)
    assertStringIncludes(result.message, 'Unknown error')
  })

  it('should handle object with message property', () => {
    const result = intoSurQlError({ message: 'obj message' })
    assertEquals(result instanceof SurQlError, true)
  })

  it('should handle object without message property', () => {
    const result = intoSurQlError({ code: 404 })
    assertEquals(result instanceof SurQlError, true)
  })

  it('should handle completely unknown types', () => {
    const result = intoSurQlError(42)
    assertEquals(result instanceof SurQlError, true)
    assertStringIncludes(result.message, 'error occurred')
  })

  it('should respect maxMessageLength option', () => {
    const longMessage = 'A'.repeat(1000)
    const result = intoSurQlError(longMessage, undefined, { maxMessageLength: 50 })
    assertEquals(result.message.length <= 53, true) // 50 + possible "..."
  })
})
