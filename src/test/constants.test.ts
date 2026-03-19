import { assertEquals } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { PATTERNS, SECRET_PATTERN } from '../constants.ts'

describe('PATTERNS', () => {
  describe('TABLE_NAME', () => {
    it('should match valid table names', () => {
      assertEquals(PATTERNS.TABLE_NAME.test('users'), true)
      assertEquals(PATTERNS.TABLE_NAME.test('my_table'), true)
      assertEquals(PATTERNS.TABLE_NAME.test('table-name'), true)
      assertEquals(PATTERNS.TABLE_NAME.test('Table123'), true)
    })

    it('should reject names with spaces', () => {
      assertEquals(PATTERNS.TABLE_NAME.test('bad name'), false)
    })

    it('should reject names with special characters', () => {
      assertEquals(PATTERNS.TABLE_NAME.test('table;DROP'), false)
      assertEquals(PATTERNS.TABLE_NAME.test('table.field'), false)
    })

    it('should reject empty string', () => {
      assertEquals(PATTERNS.TABLE_NAME.test(''), false)
    })
  })

  describe('FIELD_NAME', () => {
    it('should match simple field names', () => {
      assertEquals(PATTERNS.FIELD_NAME.test('name'), true)
      assertEquals(PATTERNS.FIELD_NAME.test('first_name'), true)
    })

    it('should match dotted paths', () => {
      assertEquals(PATTERNS.FIELD_NAME.test('user.name'), true)
    })

    it('should match fields with parentheses for functions', () => {
      assertEquals(PATTERNS.FIELD_NAME.test('count()'), true)
    })

    it('should match wildcard', () => {
      assertEquals(PATTERNS.FIELD_NAME.test('*'), true)
    })

    it('should reject fields with spaces', () => {
      assertEquals(PATTERNS.FIELD_NAME.test('bad field'), false)
    })

    it('should reject SQL injection patterns', () => {
      assertEquals(PATTERNS.FIELD_NAME.test("field'; DROP TABLE"), false)
    })
  })

  describe('HOST patterns', () => {
    it('should match valid hostnames', () => {
      assertEquals(PATTERNS.HOST[0].test('example.com'), true)
      assertEquals(PATTERNS.HOST[0].test('sub.example.com'), true)
      assertEquals(PATTERNS.HOST[0].test('my-host'), true)
    })

    it('should match IP addresses', () => {
      assertEquals(PATTERNS.HOST[1].test('192.168.1.1'), true)
      assertEquals(PATTERNS.HOST[1].test('10.0.0.1'), true)
      assertEquals(PATTERNS.HOST[1].test('255.255.255.255'), true)
    })

    it('should reject invalid IPs', () => {
      assertEquals(PATTERNS.HOST[1].test('256.1.1.1'), false)
      assertEquals(PATTERNS.HOST[1].test('not.an.ip'), false)
    })

    it('should match localhost', () => {
      assertEquals(PATTERNS.HOST[2].test('localhost'), true)
      assertEquals(PATTERNS.HOST[2].test('LOCALHOST'), true)
    })
  })

  describe('NUMERIC_STRING', () => {
    it('should match numeric strings', () => {
      assertEquals(PATTERNS.NUMERIC_STRING.test('123'), true)
      assertEquals(PATTERNS.NUMERIC_STRING.test('0'), true)
    })

    it('should reject non-numeric strings', () => {
      assertEquals(PATTERNS.NUMERIC_STRING.test('abc'), false)
      assertEquals(PATTERNS.NUMERIC_STRING.test('12a'), false)
      assertEquals(PATTERNS.NUMERIC_STRING.test(''), false)
    })
  })

  describe('WILDCARD', () => {
    it('should match single asterisk', () => {
      assertEquals(PATTERNS.WILDCARD.test('*'), true)
    })

    it('should reject other strings', () => {
      assertEquals(PATTERNS.WILDCARD.test('**'), false)
      assertEquals(PATTERNS.WILDCARD.test('abc'), false)
    })
  })

  describe('PASSWORD', () => {
    it('should match printable ASCII', () => {
      assertEquals(PATTERNS.PASSWORD.test('MyP@ssw0rd!'), true)
      assertEquals(PATTERNS.PASSWORD.test('simple'), true)
    })

    it('should reject control characters', () => {
      assertEquals(PATTERNS.PASSWORD.test('pass\x00word'), false)
    })

    it('should reject empty string', () => {
      assertEquals(PATTERNS.PASSWORD.test(''), false)
    })
  })

  describe('SQL.FIELD_NAME_INJECTION_PATTERNS', () => {
    it('should detect semicolons', () => {
      const hasMatch = PATTERNS.SQL.FIELD_NAME_INJECTION_PATTERNS.some((p) => p.test('field; DROP TABLE users'))
      assertEquals(hasMatch, true)
    })

    it('should detect SQL comments', () => {
      const hasMatch = PATTERNS.SQL.FIELD_NAME_INJECTION_PATTERNS.some((p) => p.test('field -- comment'))
      assertEquals(hasMatch, true)
    })

    it('should detect UNION attacks', () => {
      const hasMatch = PATTERNS.SQL.FIELD_NAME_INJECTION_PATTERNS.some((p) => p.test('field UNION SELECT'))
      assertEquals(hasMatch, true)
    })

    it('should detect SELECT injections', () => {
      const hasMatch = PATTERNS.SQL.FIELD_NAME_INJECTION_PATTERNS.some((p) => p.test("' SELECT * FROM"))
      assertEquals(hasMatch, true)
    })

    it('should not flag simple field names', () => {
      const hasMatch = PATTERNS.SQL.FIELD_NAME_INJECTION_PATTERNS.some((p) => p.test('username'))
      assertEquals(hasMatch, false)
    })
  })

  describe('SQL.CLAUSE_INJECTION_PATTERNS', () => {
    it('should detect injection after semicolon', () => {
      const hasMatch = PATTERNS.SQL.CLAUSE_INJECTION_PATTERNS.some((p) => p.test('; select * from users'))
      assertEquals(hasMatch, true)
    })

    it('should detect injection after single quote', () => {
      const hasMatch = PATTERNS.SQL.CLAUSE_INJECTION_PATTERNS.some((p) => p.test("' union select"))
      assertEquals(hasMatch, true)
    })

    it('should detect block comments', () => {
      const hasMatch = PATTERNS.SQL.CLAUSE_INJECTION_PATTERNS.some((p) => p.test('/* malicious */'))
      assertEquals(hasMatch, true)
    })
  })

  describe('SANITIZE.SENSITIVE', () => {
    it('should detect sensitive field names', () => {
      const hasSensitive = (s: string) => PATTERNS.SANITIZE.SENSITIVE.some((p) => p.test(s))
      assertEquals(hasSensitive('password'), true)
      assertEquals(hasSensitive('auth_token'), true)
      assertEquals(hasSensitive('secret_key'), true)
      assertEquals(hasSensitive('api_key'), true)
      assertEquals(hasSensitive('jwt_token'), true)
    })

    it('should not flag non-sensitive field names', () => {
      const hasSensitive = (s: string) => PATTERNS.SANITIZE.SENSITIVE.some((p) => p.test(s))
      assertEquals(hasSensitive('username'), false)
      assertEquals(hasSensitive('email'), false)
      assertEquals(hasSensitive('age'), false)
    })
  })
})

describe('SECRET_PATTERN', () => {
  it('should detect key=value patterns', () => {
    const text = 'password=mySecretPass123'
    const hasMatch = SECRET_PATTERN.some((p) => {
      p.lastIndex = 0
      return p.test(text)
    })
    assertEquals(hasMatch, true)
  })

  it('should detect Bearer tokens', () => {
    const text = 'Bearer eyJhbGciOiJIUzI1NiJ9'
    const hasMatch = SECRET_PATTERN.some((p) => {
      p.lastIndex = 0
      return p.test(text)
    })
    assertEquals(hasMatch, true)
  })

  it('should not match non-secret text', () => {
    const text = 'this is normal text'
    const hasMatch = SECRET_PATTERN.some((p) => {
      p.lastIndex = 0
      return p.test(text)
    })
    assertEquals(hasMatch, false)
  })
})
