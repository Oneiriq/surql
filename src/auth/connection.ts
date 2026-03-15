import { type AnyAuth, Surreal } from 'surrealdb'
import { assertArrayLength } from '../utils/asserts.ts'
import { assertValidation, validateConnectionConfig } from '../utils/validators.ts'
import { intoSurQlError } from '../utils/surrealError.ts'
import { SIGNIN_FIELDS_BY_TYPE } from './constants.ts'
import { validateAndDecodeJWTPayload } from '../utils/helpers.ts'
import type { AuthCredentials, AuthToken, SessionInfo, SignupData } from './types.ts'
import {
  AuthenticationError,
  InvalidCredentialsError,
  InvalidTokenError,
  SessionExpiredError,
  SignupError,
} from './errors.ts'

/**
 * Extract the JWT access token string from the surrealdb v2 signin/signup result.
 * v2 returns a Token object with { access, refresh? } for record users,
 * or may return a string or void for root/ns/db users.
 */
function extractTokenString(result: unknown): string | undefined {
  if (typeof result === 'string') return result
  if (result && typeof result === 'object' && 'access' in result) {
    return (result as { access: string }).access
  }
  return undefined
}

/**
 * Build sign-in parameters from the authentication credentials for surrealdb v2.
 * Root/namespace/database use flat params; record users use access + variables.
 */
export function buildSigninParams(credentials: AuthCredentials): Record<string, unknown> {
  const type = credentials.type
  const fields = SIGNIN_FIELDS_BY_TYPE[type]
  if (!fields) throw new InvalidCredentialsError()

  if (type === 'record') {
    return {
      namespace: credentials.namespace,
      database: credentials.database,
      access: credentials.access,
      variables: credentials.variables,
    }
  }

  // deno-lint-ignore no-explicit-any
  return Object.fromEntries(fields.map((key) => [key, (credentials as any)[key]]))
}

/**
 * Configuration for SurrealDB connection
 */
export interface ConnectionConfig {
  host: string
  port: string
  namespace: string
  database: string
  username: string
  password: string
  useSSL?: boolean
  protocol?: 'http' | 'https' | 'ws' | 'wss'
}

/**
 * JWT token structure from SurrealDB
 */
interface SurrealJwt {
  exp: number
  ID: string
}

/**
 * Internal connection manager that handles SurrealDB v2 connections.
 * Manages authentication, session management, and token validation.
 */
export class SurrealConnectionManager {
  private db: InstanceType<typeof Surreal> | null = null
  private isConnected = false
  private connectionPromise: Promise<Surreal> | null = null
  private expiresAt = 0
  private readonly config: ConnectionConfig
  private readonly endpoint: string

  private authToken: AuthToken | null = null
  private sessionInfo: SessionInfo | null = null
  private currentCredentials: AuthCredentials | null = null

  constructor(config: ConnectionConfig) {
    const validationResult = validateConnectionConfig(config)
    assertValidation(validationResult, 'Connection configuration validation')

    this.config = config
    this.endpoint = this.buildSecureEndpoint(config)
  }

  /**
   * Get a connection to SurrealDB, creating one if necessary
   */
  async getConnection(): Promise<Surreal> {
    if (this.db && this.isConnected && this.isTokenValid()) {
      return this.db
    }

    if (this.connectionPromise) {
      try {
        return await this.connectionPromise
      } catch (e) {
        throw intoSurQlError('Connection promise failed:', e)
      }
    }

    return this.connect()
  }

  /**
   * Create a new connection to SurrealDB
   */
  private async connect(): Promise<Surreal> {
    const db = new Surreal()
    this.db = db

    this.connectionPromise = this.performConnection(db)

    try {
      const result = await this.connectionPromise
      this.connectionPromise = null
      return result
    } catch (e) {
      this.connectionPromise = null
      throw intoSurQlError('Connection failed:', e)
    }
  }

  /**
   * Perform the actual connection steps
   */
  private async performConnection(db: Surreal): Promise<Surreal> {
    await db.connect(this.endpoint)
    await this.performSignin(db)
    await db.use({
      namespace: this.config.namespace,
      database: this.config.database,
    })

    this.isConnected = true
    return db
  }

  /**
   * Perform signin and handle token management.
   * surrealdb v2 may return a Token object or void depending on auth level.
   */
  private async performSignin(db: Surreal): Promise<void> {
    const result = await db.signin({
      username: this.config.username,
      password: this.config.password,
    })

    const tokenStr = extractTokenString(result)
    if (!tokenStr) {
      // v2 root signin may not return a token; set a long expiry
      this.expiresAt = Date.now() + 24 * 60 * 60 * 1_000
      return
    }

    try {
      const { exp } = await validateAndDecodeJWTPayload<SurrealJwt>(tokenStr)
      this.expiresAt = exp * 1_000
    } catch (e) {
      throw intoSurQlError('Invalid JWT token received from SurrealDB:', e)
    }
  }

  /**
   * Check if the current JWT token is still valid
   */
  private isTokenValid(): boolean {
    return this.expiresAt > Date.now() + 60_000
  }

  /**
   * Build a secure endpoint URL
   */
  private buildSecureEndpoint(config: ConnectionConfig): string {
    let protocol = config.protocol || 'http'

    if (config.useSSL) {
      protocol = protocol === 'ws' ? 'wss' : 'https'
    }

    const allowedProtocols = ['http', 'https', 'ws', 'wss']
    if (!allowedProtocols.includes(protocol)) {
      throw new Error(`Invalid protocol: ${protocol}. Allowed protocols: ${allowedProtocols.join(', ')}`)
    }

    try {
      const baseUrl = `${protocol}://${config.host}:${config.port}`
      if (protocol === 'http' || protocol === 'https') {
        return `${baseUrl}/rpc`
      }
      return baseUrl
    } catch (e) {
      throw intoSurQlError('Failed to construct connection endpoint:', e)
    }
  }

  /**
   * Sign in with user credentials.
   * Handles v2 Token return format { access, refresh? }.
   */
  async signin(credentials: AuthCredentials): Promise<AuthToken> {
    try {
      const db = await this.getConnection()
      const signinParams = buildSigninParams(credentials)

      const result = await db.signin(signinParams as AnyAuth)
      const tokenStr = extractTokenString(result)
      if (!tokenStr) {
        throw new InvalidCredentialsError()
      }

      const setSession = (payload: SurrealJwt) => {
        const { exp, ID } = payload
        const expiresAt = new Date(exp * 1000)

        this.authToken = {
          access: tokenStr,
          refresh: (result && typeof result === 'object' && 'refresh' in result)
            ? (result as { refresh?: string }).refresh
            : undefined,
          expires: expiresAt,
        }
        this.expiresAt = exp * 1000
        this.currentCredentials = credentials

        this.sessionInfo = {
          id: ID,
          type: credentials.type,
          namespace: 'namespace' in credentials ? credentials.namespace : undefined,
          database: 'database' in credentials ? credentials.database : undefined,
          access: 'access' in credentials ? credentials.access : undefined,
          expires: expiresAt,
        }

        return this.authToken
      }

      try {
        const payload = await validateAndDecodeJWTPayload<SurrealJwt>(tokenStr)
        return setSession(payload)
      } catch (e) {
        if (e instanceof Error && e.message === 'JWT token has expired') {
          try {
            const parts = tokenStr.split('.')
            assertArrayLength({ input: parts, length: 3, context: 'JWT token parts' })

            const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
            return setSession(payload)
          } catch {
            throw new InvalidTokenError()
          }
        }
        throw new InvalidTokenError()
      }
    } catch (e) {
      if (e instanceof AuthenticationError) throw e
      throw e
    }
  }

  /**
   * Sign up a new record user.
   * v2 uses access instead of scope, with variables wrapper.
   */
  async signup(data: SignupData): Promise<AuthToken> {
    try {
      const db = await this.getConnection()

      const signupParams = {
        namespace: data.namespace,
        database: data.database,
        access: data.access,
        variables: data.variables,
      }

      const result = await db.signup(signupParams)
      const tokenStr = extractTokenString(result)

      if (!tokenStr) {
        throw new SignupError('Signup failed - no token returned')
      }

      try {
        const { exp, ID } = await validateAndDecodeJWTPayload<SurrealJwt>(tokenStr)
        const expiresAt = new Date(exp * 1000)

        this.authToken = {
          access: tokenStr,
          refresh: (result && typeof result === 'object' && 'refresh' in result)
            ? (result as { refresh?: string }).refresh
            : undefined,
          expires: expiresAt,
        }
        this.expiresAt = exp * 1000

        this.sessionInfo = {
          id: ID,
          type: 'record',
          namespace: data.namespace,
          database: data.database,
          access: data.access,
          expires: expiresAt,
        }

        return this.authToken
      } catch (_) {
        throw new InvalidTokenError()
      }
    } catch (e) {
      if (e instanceof AuthenticationError) {
        throw e
      }
      if (
        e instanceof Error &&
        (e.message.includes('signup') || e.message.includes('user') || e.message.includes('email'))
      ) {
        throw new SignupError(`Signup operation failed: ${e.message}`)
      }
      throw e
    }
  }

  /**
   * Authenticate with an existing JWT token
   */
  async authenticate(token: string): Promise<SessionInfo> {
    try {
      const db = await this.getConnection()

      await db.authenticate(token)

      const { exp, ID } = await validateAndDecodeJWTPayload<SurrealJwt>(token)
      const expiresAt = new Date(exp * 1000)

      if (Date.now() >= exp * 1000) {
        throw new SessionExpiredError()
      }

      this.authToken = { access: token, expires: expiresAt }
      this.expiresAt = exp * 1000

      this.sessionInfo = {
        id: ID,
        type: 'record',
        expires: expiresAt,
      }

      return this.sessionInfo
    } catch (e) {
      if (e instanceof SessionExpiredError || e instanceof InvalidTokenError) {
        throw e
      }
      if (e instanceof AuthenticationError) {
        throw e
      }
      if (e instanceof Error && e.message === 'JWT token has expired') {
        throw new SessionExpiredError()
      }
      throw new InvalidTokenError()
    }
  }

  /**
   * Invalidate the current session
   */
  async invalidate(): Promise<void> {
    try {
      const db = await this.getConnection()
      await db.invalidate()

      this.authToken = null
      this.sessionInfo = null
      this.currentCredentials = null
      this.expiresAt = 0
    } catch (_e) {
      throw new AuthenticationError('Session invalidation failed', 'INVALIDATE_FAILED')
    }
  }

  /**
   * Get current authenticated user information
   */
  async info(): Promise<SessionInfo> {
    if (!this.sessionInfo) {
      throw new AuthenticationError('No active session', 'NO_SESSION')
    }

    if (this.sessionInfo.expires && Date.now() >= this.sessionInfo.expires.getTime()) {
      throw new SessionExpiredError()
    }

    return this.sessionInfo
  }

  /**
   * Check if current session is authenticated
   */
  isAuthenticated(): boolean {
    return this.authToken !== null && this.isTokenValid()
  }

  /**
   * Get current authentication token
   */
  getCurrentToken(): AuthToken | null {
    return this.authToken
  }

  /**
   * Close the connection
   */
  async close(): Promise<void> {
    try {
      if (this.db) {
        await this.db.close()
        this.db = null
        this.isConnected = false
        this.expiresAt = 0

        this.authToken = null
        this.sessionInfo = null
        this.currentCredentials = null
      }
    } catch (e) {
      throw intoSurQlError('Failed to close connection:', e)
    }
  }
}
