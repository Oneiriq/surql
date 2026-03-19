import { assert, assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import {
  createBlankMigration,
  generateInitialMigration,
  generateMigrationFromDiffs,
  MigrationGenerationError,
} from '../migration/generator.ts'
import { DiffOperation } from '../migration/models.ts'
import type { SchemaDiff } from '../migration/models.ts'

// ---------------------------------------------------------------------------
// generateMigrationFromDiffs
// ---------------------------------------------------------------------------

describe('generateMigrationFromDiffs', () => {
  it('should throw MigrationGenerationError when diffs is empty', () => {
    assertThrows(
      () => generateMigrationFromDiffs([], 'test'),
      MigrationGenerationError,
      'No schema differences found',
    )
  })

  it('should include UP migration header', () => {
    const diff: SchemaDiff = {
      operation: DiffOperation.ADD_TABLE,
      table: 'users',
      details: 'Add users table',
      sql: 'DEFINE TABLE users SCHEMAFULL;',
    }
    const result = generateMigrationFromDiffs([diff], 'add_users')
    assertStringIncludes(result.upSql, '-- Migration UP')
  })

  it('should include DOWN migration header', () => {
    const diff: SchemaDiff = {
      operation: DiffOperation.ADD_TABLE,
      table: 'users',
      details: 'Add users table',
      sql: 'DEFINE TABLE users SCHEMAFULL;',
    }
    const result = generateMigrationFromDiffs([diff], 'add_users')
    assertStringIncludes(result.downSql, '-- Migration DOWN')
  })

  it('should include diff SQL in upSql', () => {
    const diff: SchemaDiff = {
      operation: DiffOperation.ADD_TABLE,
      table: 'posts',
      details: 'Add posts table',
      sql: 'DEFINE TABLE posts SCHEMAFULL;',
    }
    const result = generateMigrationFromDiffs([diff], 'add_posts')
    assertStringIncludes(result.upSql, 'DEFINE TABLE posts SCHEMAFULL;')
  })

  it('should generate REMOVE TABLE in downSql for ADD_TABLE', () => {
    const diff: SchemaDiff = {
      operation: DiffOperation.ADD_TABLE,
      table: 'users',
      details: 'Add users table',
      sql: 'DEFINE TABLE users SCHEMAFULL;',
    }
    const result = generateMigrationFromDiffs([diff], 'add_users')
    assertStringIncludes(result.downSql, 'REMOVE TABLE users;')
  })

  it('should generate manual comment in downSql for DROP_TABLE', () => {
    const diff: SchemaDiff = {
      operation: DiffOperation.DROP_TABLE,
      table: 'users',
      details: 'Drop users table',
      sql: 'REMOVE TABLE users;',
    }
    const result = generateMigrationFromDiffs([diff], 'drop_users')
    assertStringIncludes(result.downSql, "Recreate table 'users' (manual)")
  })

  it('should generate REMOVE FIELD in downSql for ADD_FIELD', () => {
    const diff: SchemaDiff = {
      operation: DiffOperation.ADD_FIELD,
      table: 'users',
      field: 'email',
      details: 'Add email field',
      sql: 'DEFINE FIELD email ON TABLE users TYPE string;',
    }
    const result = generateMigrationFromDiffs([diff], 'add_email')
    assertStringIncludes(result.downSql, 'REMOVE FIELD email ON TABLE users;')
  })

  it('should generate manual comment in downSql for DROP_FIELD', () => {
    const diff: SchemaDiff = {
      operation: DiffOperation.DROP_FIELD,
      table: 'users',
      field: 'legacy_col',
      details: 'Drop legacy_col field',
      sql: 'REMOVE FIELD legacy_col ON TABLE users;',
    }
    const result = generateMigrationFromDiffs([diff], 'drop_legacy')
    assertStringIncludes(result.downSql, "Recreate field 'legacy_col' on 'users' (manual)")
  })

  it('should generate manual comment in downSql for ADD_INDEX', () => {
    const diff: SchemaDiff = {
      operation: DiffOperation.ADD_INDEX,
      table: 'users',
      details: 'Add idx_email index',
      sql: 'DEFINE INDEX idx_email ON TABLE users FIELDS email UNIQUE;',
    }
    const result = generateMigrationFromDiffs([diff], 'add_idx')
    assertStringIncludes(result.downSql, "Remove index on 'users' (manual)")
  })

  it('should generate manual comment in downSql for DROP_INDEX', () => {
    const diff: SchemaDiff = {
      operation: DiffOperation.DROP_INDEX,
      table: 'users',
      details: 'Drop idx_email index',
      sql: 'REMOVE INDEX idx_email ON TABLE users;',
    }
    const result = generateMigrationFromDiffs([diff], 'drop_idx')
    assertStringIncludes(result.downSql, "Recreate index on 'users' (manual)")
  })

  it('should use details in downSql fallback for unknown operations', () => {
    const diff: SchemaDiff = {
      operation: DiffOperation.MODIFY_PERMISSIONS,
      table: 'users',
      details: 'Change select permission',
      sql: '-- Permissions change requires manual review',
    }
    const result = generateMigrationFromDiffs([diff], 'change_perms')
    assertStringIncludes(result.downSql, 'Change select permission')
  })

  it('should reverse order of down operations for multiple diffs', () => {
    const diff1: SchemaDiff = {
      operation: DiffOperation.ADD_TABLE,
      table: 'users',
      details: 'Add users',
      sql: 'DEFINE TABLE users SCHEMAFULL;',
    }
    const diff2: SchemaDiff = {
      operation: DiffOperation.ADD_FIELD,
      table: 'users',
      field: 'email',
      details: 'Add email',
      sql: 'DEFINE FIELD email ON TABLE users TYPE string;',
    }
    const result = generateMigrationFromDiffs([diff1, diff2], 'add_users_email')
    const downLines = result.downSql.split('\n')
    // REMOVE FIELD should appear before REMOVE TABLE in DOWN (reversed order)
    const removeFieldIdx = downLines.findIndex((l) => l.includes('REMOVE FIELD'))
    const removeTableIdx = downLines.findIndex((l) => l.includes('REMOVE TABLE'))
    assert(removeFieldIdx < removeTableIdx, 'REMOVE FIELD should come before REMOVE TABLE in DOWN')
  })

  it('should generate a filename with description slug', () => {
    const diff: SchemaDiff = {
      operation: DiffOperation.ADD_TABLE,
      table: 'items',
      details: 'Add items',
      sql: 'DEFINE TABLE items SCHEMAFULL;',
    }
    const result = generateMigrationFromDiffs([diff], 'add items table')
    assertStringIncludes(result.filename, 'add_items_table')
    assertStringIncludes(result.filename, '.surql')
  })

  it('MigrationGenerationError should be instanceof Error', () => {
    const err = new MigrationGenerationError('test')
    assertEquals(err instanceof Error, true)
    assertEquals(err.name, 'MigrationGenerationError')
  })
})

// ---------------------------------------------------------------------------
// generateInitialMigration
// ---------------------------------------------------------------------------

describe('generateInitialMigration', () => {
  it('should use provided upSql verbatim', () => {
    const upSql = 'DEFINE TABLE users SCHEMAFULL;'
    const result = generateInitialMigration(upSql)
    assertEquals(result.upSql, upSql)
  })

  it('should use default description when none provided', () => {
    const result = generateInitialMigration('DEFINE TABLE t SCHEMAFULL;')
    assertStringIncludes(result.filename, 'initial_schema')
  })

  it('should use custom description in filename', () => {
    const result = generateInitialMigration('DEFINE TABLE t SCHEMAFULL;', 'bootstrap')
    assertStringIncludes(result.filename, 'bootstrap')
  })

  it('should produce downSql with manual comment', () => {
    const result = generateInitialMigration('DEFINE TABLE t SCHEMAFULL;')
    assertStringIncludes(result.downSql, 'manual')
  })

  it('should produce a .surql filename', () => {
    const result = generateInitialMigration('DEFINE TABLE t SCHEMAFULL;')
    assertStringIncludes(result.filename, '.surql')
  })
})

// ---------------------------------------------------------------------------
// createBlankMigration
// ---------------------------------------------------------------------------

describe('createBlankMigration', () => {
  it('should include description in filename', () => {
    const result = createBlankMigration('create users table')
    assertStringIncludes(result.filename, 'create_users_table')
  })

  it('should produce a .surql filename', () => {
    const result = createBlankMigration('my migration')
    assertStringIncludes(result.filename, '.surql')
  })

  it('should include description in content', () => {
    const result = createBlankMigration('my migration')
    assertStringIncludes(result.content, 'my migration')
  })

  it('should include UP section in content', () => {
    const result = createBlankMigration('test')
    assertStringIncludes(result.content, '-- UP')
  })

  it('should include DOWN section in content', () => {
    const result = createBlankMigration('test')
    assertStringIncludes(result.content, '-- DOWN')
  })
})
