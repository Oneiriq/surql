import type { AuthCredentials } from './types.ts'

export const SIGNIN_FIELDS_BY_TYPE: Record<AuthCredentials['type'], readonly string[]> = {
  root: ['username', 'password'],
  namespace: ['namespace', 'username', 'password'],
  database: ['namespace', 'database', 'username', 'password'],
  record: ['namespace', 'database', 'access'],
} as const
