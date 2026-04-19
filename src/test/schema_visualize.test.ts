import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { generateAscii, generateGraphViz, generateMermaid } from '../schema/visualize.ts'
import { validateSchema } from '../schema/validator.ts'
import { parseDbInfo, parseTableInfo } from '../schema/parser.ts'
import { edgeSchema, typedEdge, withFromTable, withToTable } from '../schema/edge.ts'
import { EdgeMode } from '../schema/edge.ts'
import { intField, recordField, stringField } from '../schema/fields.ts'
import { index, tableSchema, withFields, withIndexes } from '../schema/table.ts'

// ---------------------------------------------------------------------------
// generateMermaid
// ---------------------------------------------------------------------------

describe('generateMermaid', () => {
  it('should emit erDiagram header', () => {
    const result = generateMermaid({})
    assertStringIncludes(result, 'erDiagram')
  })

  it('should include table name and fields', () => {
    const users = withFields(tableSchema('users'), stringField('name'), intField('age'))
    const result = generateMermaid({ tables: [users] })
    assertStringIncludes(result, 'users')
    assertStringIncludes(result, 'name')
    assertStringIncludes(result, 'age')
  })

  it('should render edge relationships with fromTable and toTable', () => {
    const users = tableSchema('users')
    const posts = tableSchema('posts')
    const authored = withToTable(withFromTable(edgeSchema('authored', EdgeMode.RELATION), 'users'), 'posts')
    const result = generateMermaid({ tables: [users, posts], edges: [authored] })
    assertStringIncludes(result, 'users')
    assertStringIncludes(result, 'posts')
    assertStringIncludes(result, 'authored')
  })

  it('should skip edges without fromTable or toTable', () => {
    const loose = edgeSchema('loose_edge', EdgeMode.RELATION)
    const result = generateMermaid({ edges: [loose] })
    assertEquals(result.includes('loose_edge'), false)
  })

  it('should produce output with only tables and no edges', () => {
    const t = withFields(tableSchema('items'), stringField('label'))
    const result = generateMermaid({ tables: [t] })
    assertStringIncludes(result, 'items')
    assertStringIncludes(result, 'label')
  })

  it('should render field type as record_X for record fields', () => {
    const posts = tableSchema('posts')
    const articles = withFields(tableSchema('articles'), recordField('post_ref', 'posts'))
    const result = generateMermaid({ tables: [articles, posts] })
    assertStringIncludes(result, 'record_posts')
  })
})

// ---------------------------------------------------------------------------
// generateGraphViz
// ---------------------------------------------------------------------------

describe('generateGraphViz', () => {
  it('should emit digraph header with default title', () => {
    const result = generateGraphViz({})
    assertStringIncludes(result, 'digraph')
    assertStringIncludes(result, 'Schema')
  })

  it('should use custom title', () => {
    const result = generateGraphViz({ title: 'MyApp' })
    assertStringIncludes(result, 'MyApp')
  })

  it('should include table nodes', () => {
    const users = withFields(tableSchema('users'), stringField('email'))
    const result = generateGraphViz({ tables: [users] })
    assertStringIncludes(result, 'users')
    assertStringIncludes(result, 'email')
  })

  it('should render edge arrows between tables', () => {
    const users = tableSchema('users')
    const posts = tableSchema('posts')
    const authored = withToTable(withFromTable(edgeSchema('authored', EdgeMode.RELATION), 'users'), 'posts')
    const result = generateGraphViz({ tables: [users, posts], edges: [authored] })
    assertStringIncludes(result, 'users -> posts')
    assertStringIncludes(result, 'authored')
  })

  it('should render dashed edges for record field references', () => {
    const posts = tableSchema('posts')
    const comments = withFields(tableSchema('comments'), recordField('post', 'posts'))
    const result = generateGraphViz({ tables: [posts, comments] })
    assertStringIncludes(result, 'style=dashed')
    assertStringIncludes(result, 'comments -> posts')
  })

  it('should close the digraph block', () => {
    const result = generateGraphViz({})
    assert(result.trimEnd().endsWith('}'))
  })
})

// ---------------------------------------------------------------------------
// generateAscii
// ---------------------------------------------------------------------------

describe('generateAscii', () => {
  it('should render table box with name', () => {
    const users = withFields(tableSchema('users'), stringField('name'))
    const result = generateAscii({ tables: [users] })
    assertStringIncludes(result, 'users')
    assertStringIncludes(result, 'name')
  })

  it('should render field names and types in columns', () => {
    const t = withFields(tableSchema('things'), stringField('title'), intField('count'))
    const result = generateAscii({ tables: [t] })
    assertStringIncludes(result, 'title')
    assertStringIncludes(result, 'count')
  })

  it('should render Edges section when edges have fromTable and toTable', () => {
    const e = withToTable(withFromTable(edgeSchema('likes', EdgeMode.RELATION), 'users'), 'posts')
    const result = generateAscii({ edges: [e] })
    assertStringIncludes(result, 'Edges:')
    assertStringIncludes(result, 'likes')
    assertStringIncludes(result, 'users')
    assertStringIncludes(result, 'posts')
  })

  it('should not render Edges section when no edges', () => {
    const result = generateAscii({ tables: [tableSchema('empty_table')] })
    assertEquals(result.includes('Edges:'), false)
  })

  it('should render multiple tables', () => {
    const result = generateAscii({
      tables: [
        withFields(tableSchema('users'), stringField('name')),
        withFields(tableSchema('posts'), stringField('title')),
      ],
    })
    assertStringIncludes(result, 'users')
    assertStringIncludes(result, 'posts')
  })

  it('should render ? for edges without fromTable or toTable', () => {
    const loose = edgeSchema('orphan', EdgeMode.RELATION)
    const result = generateAscii({ edges: [loose] })
    assertStringIncludes(result, '?')
    assertStringIncludes(result, 'orphan')
  })
})

// ---------------------------------------------------------------------------
// validateSchema
// ---------------------------------------------------------------------------

describe('validateSchema', () => {
  it('should return valid=true for a clean schema', () => {
    const t = withFields(tableSchema('users'), stringField('name'), intField('age'))
    const result = validateSchema({ tables: [t] })
    assertEquals(result.valid, true)
    assertEquals(result.issues.length, 0)
  })

  it('should flag duplicate field names as error', () => {
    const t = withFields(tableSchema('users'), stringField('name'), stringField('name'))
    const result = validateSchema({ tables: [t] })
    assertEquals(result.valid, false)
    assert(result.issues.some((i) => i.level === 'error' && i.message.includes('Duplicate field')))
  })

  it('should warn when record field references unknown table', () => {
    const t = withFields(tableSchema('comments'), recordField('author', 'nonexistent_table'))
    const result = validateSchema({ tables: [t] })
    assert(result.issues.some((i) => i.level === 'warning' && i.message.includes('unknown table')))
  })

  it('should not warn when record field references known table', () => {
    const users = tableSchema('users')
    const comments = withFields(tableSchema('comments'), recordField('author', 'users'))
    const result = validateSchema({ tables: [users, comments] })
    assertEquals(result.issues.filter((i) => i.message.includes('unknown table')).length, 0)
  })

  it('should warn when index references unknown field', () => {
    const t = withIndexes(tableSchema('items'), index('idx_ghost', 'ghost_field'))
    const result = validateSchema({ tables: [t] })
    assert(result.issues.some((i) => i.level === 'warning' && i.message.includes('unknown field')))
  })

  it('should not warn when index references known field', () => {
    const t = withIndexes(withFields(tableSchema('items'), stringField('slug')), index('idx_slug', 'slug'))
    const result = validateSchema({ tables: [t] })
    assertEquals(result.issues.filter((i) => i.message.includes('unknown field')).length, 0)
  })

  it('should warn when edge FROM references unknown table', () => {
    const e = withFromTable(edgeSchema('rel', EdgeMode.RELATION), 'missing_table')
    const result = validateSchema({ edges: [e] })
    assert(result.issues.some((i) => i.level === 'warning' && i.message.includes('FROM references unknown')))
  })

  it('should warn when edge TO references unknown table', () => {
    const e = withToTable(edgeSchema('rel', EdgeMode.RELATION), 'missing_table')
    const result = validateSchema({ edges: [e] })
    assert(result.issues.some((i) => i.level === 'warning' && i.message.includes('TO references unknown')))
  })

  it('should not warn for edges when from/to tables are registered', () => {
    const users = tableSchema('users')
    const posts = tableSchema('posts')
    const e = typedEdge('authored', 'users', 'posts')
    const result = validateSchema({ tables: [users, posts], edges: [e] })
    assertEquals(result.issues.filter((i) => i.message.includes('references unknown')).length, 0)
  })

  it('should warn for invalid table name format', () => {
    const t = tableSchema('123invalid')
    const result = validateSchema({ tables: [t] })
    assert(result.issues.some((i) => i.level === 'warning' && i.message.includes('may not be valid')))
  })

  it('should return valid=true with only warnings (no errors)', () => {
    const t = withFields(tableSchema('orders'), recordField('customer', 'unknown_table'))
    const result = validateSchema({ tables: [t] })
    assertEquals(result.valid, true)
    assert(result.issues.length > 0)
    assert(result.issues.every((i) => i.level === 'warning'))
  })
})

// ---------------------------------------------------------------------------
// parseTableInfo / parseDbInfo (pure functions)
// ---------------------------------------------------------------------------

describe('parseTableInfo', () => {
  it('should parse fields from raw response using "fields" key', () => {
    const raw = { tb: 'DEFINE TABLE t', fields: { name: 'DEFINE FIELD name ON TABLE t TYPE string' } }
    const info = parseTableInfo('t', raw)
    assert(info.fields.some((f) => f.name === 'name'))
  })

  it('should parse fields from raw response using "fd" key (SurrealDB v1 compat)', () => {
    const raw = { tb: 'DEFINE TABLE t', fd: { email: 'DEFINE FIELD email ON TABLE t TYPE string' } }
    const info = parseTableInfo('t', raw)
    assert(info.fields.some((f) => f.name === 'email'))
  })

  it('should default to empty arrays when keys are missing', () => {
    const info = parseTableInfo('t', {})
    assertEquals(info.fields.length, 0)
    assertEquals(info.indexes.length, 0)
    assertEquals(info.events.length, 0)
  })
})

describe('parseDbInfo', () => {
  it('should parse tables from raw response using "tables" key', () => {
    const raw = { tables: { users: 'DEFINE TABLE users SCHEMAFULL' } }
    const info = parseDbInfo(raw)
    assert('users' in info.tables)
  })

  it('should parse tables from raw response using "tb" key (SurrealDB v1 compat)', () => {
    const raw = { tb: { posts: 'DEFINE TABLE posts SCHEMALESS' } }
    const info = parseDbInfo(raw)
    assert('posts' in info.tables)
  })

  it('should default to empty objects when keys are missing', () => {
    const info = parseDbInfo({})
    assertEquals(Object.keys(info.tables).length, 0)
    assertEquals(Object.keys(info.accesses).length, 0)
  })
})
