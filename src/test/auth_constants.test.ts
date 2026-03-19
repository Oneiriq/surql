import { assertEquals } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { SIGNIN_FIELDS_BY_TYPE } from '../auth/constants.ts'

describe('SIGNIN_FIELDS_BY_TYPE', () => {
  it('should have root fields', () => {
    assertEquals(SIGNIN_FIELDS_BY_TYPE.root, ['username', 'password'])
  })

  it('should have namespace fields', () => {
    assertEquals(SIGNIN_FIELDS_BY_TYPE.namespace, ['namespace', 'username', 'password'])
  })

  it('should have database fields', () => {
    assertEquals(SIGNIN_FIELDS_BY_TYPE.database, ['namespace', 'database', 'username', 'password'])
  })

  it('should have record fields', () => {
    assertEquals(SIGNIN_FIELDS_BY_TYPE.record, ['namespace', 'database', 'access'])
  })

  it('should cover all 4 auth types', () => {
    const types = Object.keys(SIGNIN_FIELDS_BY_TYPE)
    assertEquals(types.length, 4)
    assertEquals(types.includes('root'), true)
    assertEquals(types.includes('namespace'), true)
    assertEquals(types.includes('database'), true)
    assertEquals(types.includes('record'), true)
  })
})
