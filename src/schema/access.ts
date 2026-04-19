/**
 * Access type
 */
export enum AccessType {
  JWT = 'JWT',
  RECORD = 'RECORD',
}

/**
 * JWT configuration
 */
export interface JwtConfig {
  readonly algorithm: string
  readonly key?: string
  readonly url?: string
  readonly issuer?: string
  readonly audience?: string
}

/**
 * Record access configuration
 */
export interface RecordAccessConfig {
  readonly signup?: string
  readonly signin?: string
  readonly jwt?: JwtConfig
}

/**
 * Access control definition
 */
export interface AccessDefinition {
  readonly name: string
  readonly type: AccessType
  readonly jwt?: JwtConfig
  readonly record?: RecordAccessConfig
  readonly durationSession?: string
  readonly durationToken?: string
}

/** Create a generic access schema */
export function accessSchema(name: string, type: AccessType): AccessDefinition {
  return Object.freeze({ name, type })
}

/** Create a JWT access definition */
export function jwtAccess(
  name: string,
  config: JwtConfig,
): AccessDefinition {
  return Object.freeze({ name, type: AccessType.JWT, jwt: config })
}

/** Create a RECORD access definition */
export function recordAccess(
  name: string,
  config: RecordAccessConfig,
): AccessDefinition {
  return Object.freeze({ name, type: AccessType.RECORD, record: config })
}
