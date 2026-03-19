import { assertEquals } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { accessSchema, AccessType, jwtAccess, recordAccess } from '../schema/access.ts'

describe('AccessType enum', () => {
  it('should have JWT and RECORD values', () => {
    assertEquals(AccessType.JWT, 'JWT')
    assertEquals(AccessType.RECORD, 'RECORD')
  })
})

describe('accessSchema', () => {
  it('should create a frozen access definition', () => {
    const result = accessSchema('myaccess', AccessType.JWT)
    assertEquals(result.name, 'myaccess')
    assertEquals(result.type, AccessType.JWT)
    assertEquals(Object.isFrozen(result), true)
  })

  it('should create a RECORD type access definition', () => {
    const result = accessSchema('recaccess', AccessType.RECORD)
    assertEquals(result.name, 'recaccess')
    assertEquals(result.type, AccessType.RECORD)
  })

  it('should not include jwt or record config', () => {
    const result = accessSchema('basic', AccessType.JWT)
    assertEquals(result.jwt, undefined)
    assertEquals(result.record, undefined)
  })
})

describe('jwtAccess', () => {
  it('should create a JWT access definition with config', () => {
    const config = { algorithm: 'HS256', key: 'mysecret' }
    const result = jwtAccess('jwt_access', config)
    assertEquals(result.name, 'jwt_access')
    assertEquals(result.type, AccessType.JWT)
    assertEquals(result.jwt?.algorithm, 'HS256')
    assertEquals(result.jwt?.key, 'mysecret')
  })

  it('should include optional issuer and audience', () => {
    const config = { algorithm: 'RS256', key: 'pubkey', issuer: 'myapp', audience: 'users' }
    const result = jwtAccess('jwt_full', config)
    assertEquals(result.jwt?.issuer, 'myapp')
    assertEquals(result.jwt?.audience, 'users')
  })

  it('should return a frozen object', () => {
    const result = jwtAccess('frozen', { algorithm: 'HS256', key: 'key' })
    assertEquals(Object.isFrozen(result), true)
  })
})

describe('recordAccess', () => {
  it('should create a RECORD access definition', () => {
    const config = { signup: 'CREATE user SET ...', signin: 'SELECT * FROM user WHERE ...' }
    const result = recordAccess('record_access', config)
    assertEquals(result.name, 'record_access')
    assertEquals(result.type, AccessType.RECORD)
    assertEquals(result.record?.signup, 'CREATE user SET ...')
    assertEquals(result.record?.signin, 'SELECT * FROM user WHERE ...')
  })

  it('should include optional jwt config', () => {
    const config = {
      signup: 'CREATE user ...',
      jwt: { algorithm: 'HS256', key: 'secret' },
    }
    const result = recordAccess('rec_jwt', config)
    assertEquals(result.record?.jwt?.algorithm, 'HS256')
  })

  it('should return a frozen object', () => {
    const result = recordAccess('frozen_rec', {})
    assertEquals(Object.isFrozen(result), true)
  })
})
