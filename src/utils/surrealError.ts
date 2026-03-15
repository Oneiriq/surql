import { isProductionEnvironment, safeJsonStringify, sanitizeErrorMessage, truncateMessage } from './helpers.ts'
import { SurrealError } from 'surrealdb'

/**
 * Interface for SurQl error issues
 */
export interface SurQlErrorJson {
  name: string
  message: string
  stack: string | undefined
}

/**
 * Class for SurQl errors
 */
export class SurQlError extends SurrealError {
  constructor(message: string) {
    super(message)
    this.name = 'SurQlError'
  }

  toJSON(): SurQlErrorJson {
    return {
      name: this.name,
      message: this.message,
      stack: this.stack,
    }
  }
}

/**
 * Converts an error or message into a SurrealDbError with sanitized error messages.
 * Prevents sensitive information from being exposed in production error messages.
 * @param errorOrMessage - The error or base message
 * @param maybeError - Optional additional error context
 * @param options - Configuration options for error sanitization
 * @returns SurrealDbError with sanitized message
 */
export const intoSurQlError = (
  errorOrMessage: unknown,
  maybeError?: unknown,
  options: { includeDetails?: boolean; maxMessageLength?: number } = {},
): SurQlError => {
  const { includeDetails = !isProductionEnvironment(), maxMessageLength = 500 } = options

  if (typeof errorOrMessage === 'string' && maybeError !== undefined) {
    const baseMessage = sanitizeErrorMessage(errorOrMessage, includeDetails)
    const originalError = maybeError

    let detailedMessage: string

    if (originalError instanceof Error) {
      const sanitizedError = sanitizeErrorMessage(originalError.message, includeDetails)
      detailedMessage = `${baseMessage} ${sanitizedError}`
    } else if (typeof originalError === 'string') {
      const sanitizedError = sanitizeErrorMessage(originalError, includeDetails)
      detailedMessage = `${baseMessage} ${sanitizedError}`
    } else if (typeof originalError === 'object' && originalError !== null) {
      const message = (originalError as { message?: unknown }).message
      if (typeof message === 'string') {
        const sanitizedError = sanitizeErrorMessage(message, includeDetails)
        detailedMessage = `${baseMessage} ${sanitizedError}`
      } else {
        const errorInfo = includeDetails ? safeJsonStringify(originalError) : 'Error details hidden'
        detailedMessage = `${baseMessage} ${errorInfo}`
      }
    } else {
      detailedMessage = `${baseMessage} Unknown error`
    }

    return new SurQlError(truncateMessage(detailedMessage, maxMessageLength))
  }

  const error = errorOrMessage

  if (error instanceof SurQlError) {
    return error
  }

  if (error instanceof Error) {
    const sanitizedMessage = sanitizeErrorMessage(error.message, includeDetails)
    return new SurQlError(truncateMessage(sanitizedMessage, maxMessageLength))
  }

  if (typeof error === 'string') {
    const sanitizedMessage = sanitizeErrorMessage(error, includeDetails)
    return new SurQlError(truncateMessage(sanitizedMessage, maxMessageLength))
  }

  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') {
      const sanitizedMessage = sanitizeErrorMessage(message, includeDetails)
      return new SurQlError(truncateMessage(sanitizedMessage, maxMessageLength))
    }
    const errorInfo = includeDetails ? safeJsonStringify(error) : 'Error details hidden'
    return new SurQlError(truncateMessage(errorInfo, maxMessageLength))
  }

  return new SurQlError('An error occurred while processing your request')
}
