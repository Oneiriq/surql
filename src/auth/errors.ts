/**
 * Base authentication error class
 */
export class AuthenticationError extends Error {
  public readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'AuthenticationError'
    this.code = code
  }
}

/**
 * Error thrown when session has expired
 */
export class SessionExpiredError extends AuthenticationError {
  constructor() {
    super('Session has expired', 'SESSION_EXPIRED')
    this.name = 'SessionExpiredError'
  }
}

/**
 * Error thrown when invalid credentials are provided
 */
export class InvalidCredentialsError extends AuthenticationError {
  constructor() {
    super('Invalid credentials provided', 'INVALID_CREDENTIALS')
    this.name = 'InvalidCredentialsError'
  }
}

/**
 * Error thrown when user lacks required permissions
 */
export class InsufficientPermissionsError extends AuthenticationError {
  constructor(requiredPermission?: string) {
    const message = requiredPermission
      ? `Insufficient permissions. Required: ${requiredPermission}`
      : 'Insufficient permissions for this operation'
    super(message, 'INSUFFICIENT_PERMISSIONS')
    this.name = 'InsufficientPermissionsError'
  }
}

/**
 * Error thrown when token is invalid or malformed
 */
export class InvalidTokenError extends AuthenticationError {
  constructor() {
    super('Invalid or malformed authentication token', 'INVALID_TOKEN')
    this.name = 'InvalidTokenError'
  }
}

/**
 * Error thrown when authentication is required but not provided
 */
export class AuthenticationRequiredError extends AuthenticationError {
  constructor() {
    super('Authentication is required for this operation', 'AUTHENTICATION_REQUIRED')
    this.name = 'AuthenticationRequiredError'
  }
}

/**
 * Error thrown when signup fails due to validation or conflict
 */
export class SignupError extends AuthenticationError {
  constructor(message: string) {
    super(message, 'SIGNUP_FAILED')
    this.name = 'SignupError'
  }
}
