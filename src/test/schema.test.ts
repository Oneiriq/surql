import { assertEquals, assertStringIncludes } from '@std/assert'
import { afterEach, describe, it } from '@std/testing/bdd'
import {
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
  withEvents,
  withFields,
  withFromTable,
  withIndexes,
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
