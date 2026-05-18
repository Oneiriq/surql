import { assertEquals, assertStringIncludes } from '@std/assert'
import { afterEach, describe, it } from '@std/testing/bdd'
import {
  arrayField,
  clearRegistry,
  EdgeMode,
  edgeSchema,
  event,
  FieldType,
  generateEdgeSql,
  generateMermaid,
  generateSchemaSql,
  generateTableSql,
  getRegisteredTables,
  intField,
  mtreeIndex,
  recordField,
  registerTable,
  SchemaRegistry,
  stringField,
  TableMode,
  tableSchema,
  typedEdge,
  uniqueIndex,
  validateSchema,
  withEdgeFields,
  withEdgePermissions,
  withEvents,
  withFields,
  withFromTable,
  withIndexes,
  withPermissions,
  withToTable,
} from '../schema/mod.ts'

describe('Schema System', () => {
  afterEach(() => {
    clearRegistry()
  })

  describe('Field definitions', () => {
    it('should create a string field', () => {
      const f = stringField('name')
      assertEquals(f.name, 'name')
      assertEquals(f.type, FieldType.STRING)
    })

    it('should create an int field', () => {
      const f = intField('age')
      assertEquals(f.type, FieldType.INT)
    })

    it('should create a record field with link', () => {
      const f = recordField('author', 'users')
      assertEquals(f.type, FieldType.RECORD)
      assertEquals(f.recordLink, 'users')
    })

    it('should support field options', () => {
      const f = stringField('email', { assertion: '$value != NONE', readonly: true })
      assertEquals(f.assertion, '$value != NONE')
      assertEquals(f.readonly, true)
    })
  })

  describe('Table definitions', () => {
    it('should create a basic table schema', () => {
      const t = tableSchema('users')
      assertEquals(t.name, 'users')
      assertEquals(t.mode, TableMode.SCHEMAFULL)
      assertEquals(t.fields.length, 0)
    })

    it('should compose fields immutably', () => {
      const t1 = tableSchema('users')
      const t2 = withFields(t1, stringField('name'), intField('age'))
      assertEquals(t1.fields.length, 0)
      assertEquals(t2.fields.length, 2)
    })

    it('should compose indexes', () => {
      const t = withIndexes(tableSchema('users'), uniqueIndex('idx_email', 'email'))
      assertEquals(t.indexes.length, 1)
      assertEquals(t.indexes[0].name, 'idx_email')
    })

    it('should compose events', () => {
      const t = withEvents(tableSchema('users'), event('on_create', '$event = "CREATE"', 'CREATE audit'))
      assertEquals(t.events.length, 1)
    })
  })

  describe('Edge definitions', () => {
    it('should create edge schema', () => {
      const e = edgeSchema('follows')
      assertEquals(e.name, 'follows')
      assertEquals(e.mode, EdgeMode.RELATION)
    })

    it('should set from/to tables', () => {
      const e = withToTable(withFromTable(edgeSchema('follows'), 'users'), 'users')
      assertEquals(e.fromTable, 'users')
      assertEquals(e.toTable, 'users')
    })

    it('should create typed edge', () => {
      const e = typedEdge('likes', 'users', 'posts')
      assertEquals(e.fromTable, 'users')
      assertEquals(e.toTable, 'posts')
      assertEquals(e.mode, EdgeMode.SCHEMAFULL)
    })

    it('should add edge fields', () => {
      const e = withEdgeFields(edgeSchema('rates'), intField('score'))
      assertEquals(e.fields.length, 1)
    })
  })

  describe('SQL generation', () => {
    it('should generate table DDL', () => {
      const t = withFields(tableSchema('users'), stringField('name'), intField('age'))
      const sql = generateTableSql(t)
      assertStringIncludes(sql, 'DEFINE TABLE users SCHEMAFULL')
      assertStringIncludes(sql, 'DEFINE FIELD name ON TABLE users TYPE string')
      assertStringIncludes(sql, 'DEFINE FIELD age ON TABLE users TYPE int')
    })

    it('should emit option<X> for an optional field', () => {
      const t = withFields(tableSchema('users'), stringField('bio', { optional: true }))
      const sql = generateTableSql(t)
      assertStringIncludes(sql, 'DEFINE FIELD bio ON TABLE users TYPE option<string>')
    })

    it('should wrap a record link as option<record<...>> when optional', () => {
      const t = withFields(tableSchema('posts'), recordField('author', 'users', { optional: true }))
      const sql = generateTableSql(t)
      assertStringIncludes(sql, 'DEFINE FIELD author ON TABLE posts TYPE option<record<users>>')
    })

    it('should wrap an array element type as option<array<...>> when optional', () => {
      const t = withFields(tableSchema('posts'), arrayField('tags', FieldType.STRING, { optional: true }))
      const sql = generateTableSql(t)
      assertStringIncludes(sql, 'DEFINE FIELD tags ON TABLE posts TYPE option<array<string>>')
    })

    it('should generate index DDL', () => {
      const t = withIndexes(
        withFields(tableSchema('users'), stringField('email')),
        uniqueIndex('idx_email', 'email'),
      )
      const sql = generateTableSql(t)
      assertStringIncludes(sql, 'DEFINE INDEX idx_email ON TABLE users FIELDS email UNIQUE')
    })

    it('should generate MTREE index DDL', () => {
      const t = withIndexes(tableSchema('docs'), mtreeIndex('idx_vec', 'embedding', 384))
      const sql = generateTableSql(t)
      assertStringIncludes(sql, 'MTREE DIMENSION 384')
      assertStringIncludes(sql, 'DIST COSINE')
    })

    it('should generate edge DDL', () => {
      const e = withToTable(withFromTable(edgeSchema('follows'), 'users'), 'users')
      const sql = generateEdgeSql(e)
      assertStringIncludes(sql, 'DEFINE TABLE follows TYPE RELATION FROM users TO users')
    })

    it('should generate full schema SQL', () => {
      const tables = [withFields(tableSchema('users'), stringField('name'))]
      const edges = [typedEdge('follows', 'users', 'users')]
      const sql = generateSchemaSql({ tables, edges })
      assertStringIncludes(sql, 'DEFINE TABLE users')
      assertStringIncludes(sql, 'DEFINE TABLE follows')
    })

    it('should emit DEFINE TABLE IF NOT EXISTS when ifNotExists is true', () => {
      const t = withFields(tableSchema('users'), stringField('name'))
      const sql = generateTableSql(t, { ifNotExists: true })
      assertStringIncludes(sql, 'DEFINE TABLE IF NOT EXISTS users SCHEMAFULL')
      // Field/index/event sub-statements are unaffected by the table flag.
      assertStringIncludes(sql, 'DEFINE FIELD name ON TABLE users TYPE string')
    })

    it('should omit IF NOT EXISTS by default on DEFINE TABLE', () => {
      const t = tableSchema('users')
      const sql = generateTableSql(t)
      assertEquals(sql.includes('IF NOT EXISTS'), false)
    })

    it('should fold table permissions into the single DEFINE TABLE statement', () => {
      const t = withPermissions(tableSchema('users'), {
        select: 'WHERE user = $auth.id',
        create: 'FULL',
      })
      const sql = generateTableSql(t)
      // Exactly ONE DEFINE TABLE for the table — a repeat DEFINE TABLE errors
      // on SurrealDB v3 and would drop the SCHEMAFULL mode.
      assertEquals((sql.match(/DEFINE TABLE users/g) ?? []).length, 1)
      assertStringIncludes(
        sql,
        'DEFINE TABLE users SCHEMAFULL PERMISSIONS FOR select WHERE user = $auth.id FOR create FULL;',
      )
    })

    it('should apply IF NOT EXISTS exactly once to a table with permissions', () => {
      const t = withPermissions(tableSchema('users'), { select: 'WHERE user = $auth' })
      const sql = generateTableSql(t, { ifNotExists: true })
      assertEquals((sql.match(/DEFINE TABLE IF NOT EXISTS users/g) ?? []).length, 1)
      assertStringIncludes(sql, 'SCHEMAFULL PERMISSIONS FOR select WHERE user = $auth')
    })

    it('should emit edge permissions on the relation DEFINE TABLE', () => {
      const e = withEdgePermissions(
        withToTable(withFromTable(edgeSchema('follows'), 'users'), 'users'),
        { select: 'WHERE in = $auth.id', delete: 'NONE' },
      )
      const sql = generateEdgeSql(e)
      assertStringIncludes(
        sql,
        'DEFINE TABLE follows TYPE RELATION FROM users TO users PERMISSIONS FOR select WHERE in = $auth.id FOR delete NONE;',
      )
    })

    it('should fold field permissions into the DEFINE FIELD statement', () => {
      const t = withFields(
        tableSchema('users'),
        stringField('email', { permissions: { select: 'FULL', update: 'WHERE user = $auth.id' } }),
      )
      const sql = generateTableSql(t)
      assertStringIncludes(
        sql,
        'DEFINE FIELD email ON TABLE users TYPE string PERMISSIONS FOR select FULL FOR update WHERE user = $auth.id;',
      )
    })

    it('should emit DEFINE TABLE IF NOT EXISTS ... TYPE RELATION for edges', () => {
      const e = withToTable(withFromTable(edgeSchema('follows'), 'users'), 'users')
      const sql = generateEdgeSql(e, { ifNotExists: true })
      assertStringIncludes(sql, 'DEFINE TABLE IF NOT EXISTS follows TYPE RELATION FROM users TO users')
    })

    it('should omit IF NOT EXISTS by default on DEFINE TABLE (edge)', () => {
      const e = edgeSchema('follows')
      const sql = generateEdgeSql(e)
      assertEquals(sql.includes('IF NOT EXISTS'), false)
    })

    it('should propagate ifNotExists through generateSchemaSql', () => {
      const tables = [withFields(tableSchema('users'), stringField('name'))]
      const edges = [typedEdge('follows', 'users', 'users')]
      const sql = generateSchemaSql({ tables, edges, ifNotExists: true })
      assertStringIncludes(sql, 'DEFINE TABLE IF NOT EXISTS users')
      assertStringIncludes(sql, 'DEFINE TABLE IF NOT EXISTS follows')
    })

    it('should not emit IF NOT EXISTS from generateSchemaSql by default', () => {
      const tables = [withFields(tableSchema('users'), stringField('name'))]
      const sql = generateSchemaSql({ tables })
      assertEquals(sql.includes('IF NOT EXISTS'), false)
    })
  })

  describe('Schema validation', () => {
    it('should validate a valid schema', () => {
      const tables = [withFields(tableSchema('users'), stringField('name'))]
      const result = validateSchema({ tables })
      assertEquals(result.valid, true)
      assertEquals(result.issues.length, 0)
    })

    it('should detect duplicate fields', () => {
      const tables = [withFields(tableSchema('users'), stringField('name'), stringField('name'))]
      const result = validateSchema({ tables })
      assertEquals(result.valid, false)
      assertEquals(result.issues.some((i) => i.message.includes('Duplicate')), true)
    })

    it('should warn on unknown record links', () => {
      const tables = [withFields(tableSchema('posts'), recordField('author', 'nonexistent'))]
      const result = validateSchema({ tables })
      assertEquals(result.issues.some((i) => i.message.includes('unknown table')), true)
    })
  })

  describe('Schema registry', () => {
    it('should register and retrieve tables', () => {
      const reg = new SchemaRegistry()
      const t = tableSchema('users')
      reg.registerTable(t)
      assertEquals(reg.getTable('users')?.name, 'users')
      assertEquals(reg.listTables(), ['users'])
    })

    it('should use global registry', () => {
      registerTable(tableSchema('global_test'))
      assertEquals(getRegisteredTables().includes('global_test'), true)
    })
  })

  describe('Visualization', () => {
    it('should generate Mermaid diagram', () => {
      const tables = [withFields(tableSchema('users'), stringField('name'))]
      const edges = [typedEdge('follows', 'users', 'users')]
      const mermaid = generateMermaid({ tables, edges })
      assertStringIncludes(mermaid, 'erDiagram')
      assertStringIncludes(mermaid, 'users')
    })
  })
})
