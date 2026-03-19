import { assertEquals } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import {
  ConnectionError,
  ContextError,
  QueryError,
  RegistryError,
  StreamingError,
  TransactionError,
} from '../connection/errors.ts'
import { SurQlError } from '../utils/surrealError.ts'

describe('Connection Error Classes', () => {
  describe('ConnectionError', () => {
    it('should create with message and correct name', () => {
      const error = new ConnectionError('connection failed')
      assertEquals(error.message, 'connection failed')
      assertEquals(error.name, 'ConnectionError')
    })

    it('should extend SurQlError', () => {
      const error = new ConnectionError('test')
      assertEquals(error instanceof SurQlError, true)
      assertEquals(error instanceof Error, true)
    })
  })

  describe('QueryError', () => {
    it('should create with message and correct name', () => {
      const error = new QueryError('query failed')
      assertEquals(error.message, 'query failed')
      assertEquals(error.name, 'QueryError')
    })

    it('should extend SurQlError', () => {
      assertEquals(new QueryError('test') instanceof SurQlError, true)
    })
  })

  describe('TransactionError', () => {
    it('should create with message and correct name', () => {
      const error = new TransactionError('tx failed')
      assertEquals(error.message, 'tx failed')
      assertEquals(error.name, 'TransactionError')
    })

    it('should extend SurQlError', () => {
      assertEquals(new TransactionError('test') instanceof SurQlError, true)
    })
  })

  describe('ContextError', () => {
    it('should create with message and correct name', () => {
      const error = new ContextError('no context')
      assertEquals(error.message, 'no context')
      assertEquals(error.name, 'ContextError')
    })

    it('should extend SurQlError', () => {
      assertEquals(new ContextError('test') instanceof SurQlError, true)
    })
  })

  describe('RegistryError', () => {
    it('should create with message and correct name', () => {
      const error = new RegistryError('not found')
      assertEquals(error.message, 'not found')
      assertEquals(error.name, 'RegistryError')
    })

    it('should extend SurQlError', () => {
      assertEquals(new RegistryError('test') instanceof SurQlError, true)
    })
  })

  describe('StreamingError', () => {
    it('should create with message and correct name', () => {
      const error = new StreamingError('stream failed')
      assertEquals(error.message, 'stream failed')
      assertEquals(error.name, 'StreamingError')
    })

    it('should extend SurQlError', () => {
      assertEquals(new StreamingError('test') instanceof SurQlError, true)
    })
  })
})
