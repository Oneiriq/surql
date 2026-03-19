import { assertEquals } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { $ZodError } from 'zod/v4/core'
import { intoZodError, intoZodMappingError, ZodMappingError, ZodValidationError } from '../utils/zodError.ts'

describe('ZodValidationError', () => {
  it('should create a ZodError with a single issue', () => {
    const err = new ZodValidationError('Field is required', ['name'])
    assertEquals(err instanceof $ZodError, true)
    assertEquals(err.issues.length, 1)
    assertEquals(err.issues[0].message, 'Field is required')
    assertEquals(err.issues[0].code, 'invalid_type')
    assertEquals(err.issues[0].path, ['name'])
  })

  it('should use empty path by default', () => {
    const err = new ZodValidationError('Invalid input')
    assertEquals(err.issues[0].path.length, 0)
  })
})

describe('ZodMappingError', () => {
  it('should create error with context', () => {
    const issue = {
      code: 'invalid_type' as const,
      path: ['field'],
      message: 'expected string',
      expected: 'string' as const,
      input: 42,
    }
    const err = new ZodMappingError([issue], 'createUser')
    assertEquals(err instanceof $ZodError, true)
    assertEquals(err.context, 'createUser')
    assertEquals(err.issues.length, 1)
  })

  it('should create error without context', () => {
    const issue = {
      code: 'invalid_type' as const,
      path: [],
      message: 'bad input',
      expected: 'string' as const,
      input: undefined,
    }
    const err = new ZodMappingError([issue])
    assertEquals(err.context, undefined)
  })

  it('should serialize to JSON', () => {
    const issue = {
      code: 'invalid_type' as const,
      path: ['x'],
      message: 'test',
      expected: 'number' as const,
      input: 'str',
    }
    const err = new ZodMappingError([issue], 'ctx')
    const json = err.toJSON()
    assertEquals(typeof json.name, 'string')
    assertEquals(typeof json.message, 'string')
    assertEquals(json.issues.length, 1)
  })
})

describe('intoZodError', () => {
  it('should pass through $ZodError instances', () => {
    const original = new ZodValidationError('already zod')
    const result = intoZodError(original)
    assertEquals(result, original)
  })

  it('should convert string errors', () => {
    const result = intoZodError('something went wrong')
    assertEquals(result instanceof $ZodError, true)
    assertEquals(result.issues[0].message, 'something went wrong')
  })

  it('should convert Error instances', () => {
    const result = intoZodError(new Error('native error'))
    assertEquals(result instanceof $ZodError, true)
    assertEquals(result.issues[0].message, 'native error')
  })

  it('should convert objects with message property', () => {
    const result = intoZodError({ message: 'object error' })
    assertEquals(result instanceof $ZodError, true)
    assertEquals(result.issues[0].message, 'object error')
  })

  it('should convert objects without message via JSON', () => {
    const result = intoZodError({ code: 42 })
    assertEquals(result instanceof $ZodError, true)
    assertEquals(result.issues[0].message.includes('42'), true)
  })

  it('should handle unknown types', () => {
    const result = intoZodError(42)
    assertEquals(result instanceof $ZodError, true)
    assertEquals(result.issues[0].message, 'Unknown validation error')
  })

  it('should handle null', () => {
    const result = intoZodError(null)
    assertEquals(result instanceof $ZodError, true)
    assertEquals(result.issues[0].message, 'Unknown validation error')
  })
})

describe('intoZodMappingError', () => {
  it('should pass through ZodMappingError with same context', () => {
    const issue = {
      code: 'invalid_type' as const,
      path: [],
      message: 'test',
      expected: 'string' as const,
      input: undefined,
    }
    const original = new ZodMappingError([issue], 'ctx')
    const result = intoZodMappingError(original, 'ctx')
    assertEquals(result, original)
  })

  it('should re-wrap ZodMappingError with different context', () => {
    const issue = {
      code: 'invalid_type' as const,
      path: [],
      message: 'test',
      expected: 'string' as const,
      input: undefined,
    }
    const original = new ZodMappingError([issue], 'old')
    const result = intoZodMappingError(original, 'new')
    assertEquals(result !== original, true)
    assertEquals(result.context, 'new')
  })

  it('should convert Error to ZodMappingError', () => {
    const result = intoZodMappingError(new Error('plain error'), 'myContext')
    assertEquals(result instanceof ZodMappingError, true)
    assertEquals(result.context, 'myContext')
  })

  it('should convert string to ZodMappingError', () => {
    const result = intoZodMappingError('string error', 'ctx')
    assertEquals(result instanceof ZodMappingError, true)
    assertEquals(result.context, 'ctx')
  })

  it('should work without context', () => {
    const result = intoZodMappingError('no context')
    assertEquals(result instanceof ZodMappingError, true)
    assertEquals(result.context, undefined)
  })
})
