import { assertEquals } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { diffEdges, diffPermissions } from '../migration/diff.ts'
import { DiffOperation } from '../migration/models.ts'
import { EdgeMode, edgeSchema, withEdgeFields, withEdgeEvents, withEdgeIndexes, withEdgePermissions } from '../schema/edge.ts'
import { intField, stringField } from '../schema/fields.ts'
import { event, index, IndexType, TableMode, tableSchema, withPermissions } from '../schema/table.ts'
import type { TableDefinition } from '../schema/table.ts'

describe('diffPermissions', () => {
  it('should return empty when permissions are identical', () => {
    const table = withPermissions(tableSchema('users'), {
      select: 'WHERE $auth.id = id',
      create: 'FULL',
    })
    const diffs = diffPermissions(table, table)
    assertEquals(diffs.length, 0)
  })

  it('should detect permission changes', () => {
    const oldTable = withPermissions(tableSchema('users'), {
      select: 'FULL',
      create: 'FULL',
    })
    const newTable = withPermissions(tableSchema('users'), {
      select: 'WHERE $auth.id = id',
      create: 'FULL',
    })
    const diffs = diffPermissions(oldTable, newTable)
    assertEquals(diffs.length, 1)
    assertEquals(diffs[0].operation, DiffOperation.MODIFY_PERMISSIONS)
    assertEquals(diffs[0].table, 'users')
    assertEquals(diffs[0].details.includes('permissions'), true)
  })

  it('should detect added permissions', () => {
    const oldTable = tableSchema('users')
    const newTable = withPermissions(tableSchema('users'), {
      select: 'FULL',
    })
    const diffs = diffPermissions(oldTable, newTable)
    assertEquals(diffs.length, 1)
  })

  it('should detect removed permissions', () => {
    const oldTable = withPermissions(tableSchema('users'), {
      select: 'FULL',
    })
    // Force a table without permissions property
    const newTable: TableDefinition = {
      name: 'users',
      mode: TableMode.SCHEMAFULL,
      fields: [],
      indexes: [],
      events: [],
    }
    const diffs = diffPermissions(oldTable, newTable)
    assertEquals(diffs.length, 1)
  })

  it('should return empty when both have no permissions', () => {
    const oldTable = tableSchema('users')
    const newTable = tableSchema('users')
    const diffs = diffPermissions(oldTable, newTable)
    assertEquals(diffs.length, 0)
  })

  it('should detect permission modification with multiple changed fields', () => {
    const oldTable = withPermissions(tableSchema('posts'), {
      select: 'FULL',
      create: 'FULL',
      update: 'FULL',
      delete: 'FULL',
    })
    const newTable = withPermissions(tableSchema('posts'), {
      select: 'WHERE $auth.role = "admin"',
      create: 'WHERE $auth.verified = true',
      update: 'WHERE $auth.id = author',
      delete: 'NONE',
    })
    const diffs = diffPermissions(oldTable, newTable)
    assertEquals(diffs.length, 1)
    assertEquals(diffs[0].sql.includes('manual review'), true)
  })
})

describe('diffEdges', () => {
  it('should detect edge addition', () => {
    const newEdge = edgeSchema('knows', EdgeMode.RELATION)
    const diffs = diffEdges(null, newEdge)
    assertEquals(diffs.length, 1)
    assertEquals(diffs[0].operation, DiffOperation.ADD_TABLE)
    assertEquals(diffs[0].table, 'knows')
    assertEquals(diffs[0].sql.includes('RELATION'), true)
  })

  it('should detect edge removal', () => {
    const oldEdge = edgeSchema('knows', EdgeMode.RELATION)
    const diffs = diffEdges(oldEdge, null)
    assertEquals(diffs.length, 1)
    assertEquals(diffs[0].operation, DiffOperation.DROP_TABLE)
    assertEquals(diffs[0].table, 'knows')
    assertEquals(diffs[0].sql.includes('REMOVE TABLE'), true)
  })

  it('should return empty when both are null', () => {
    const diffs = diffEdges(null, null)
    assertEquals(diffs.length, 0)
  })

  it('should return empty when edges are identical', () => {
    const edge = edgeSchema('knows', EdgeMode.RELATION)
    const diffs = diffEdges(edge, edge)
    assertEquals(diffs.length, 0)
  })

  it('should detect added fields on an edge', () => {
    const oldEdge = edgeSchema('knows', EdgeMode.RELATION)
    const newEdge = withEdgeFields(
      edgeSchema('knows', EdgeMode.RELATION),
      stringField('since'),
    )
    const diffs = diffEdges(oldEdge, newEdge)
    assertEquals(diffs.length, 1)
    assertEquals(diffs[0].operation, DiffOperation.ADD_FIELD)
    assertEquals(diffs[0].table, 'knows')
    assertEquals(diffs[0].field, 'since')
  })

  it('should detect dropped fields on an edge', () => {
    const oldEdge = withEdgeFields(
      edgeSchema('knows', EdgeMode.RELATION),
      stringField('since'),
      intField('strength'),
    )
    const newEdge = withEdgeFields(
      edgeSchema('knows', EdgeMode.RELATION),
      stringField('since'),
    )
    const diffs = diffEdges(oldEdge, newEdge)
    assertEquals(diffs.length, 1)
    assertEquals(diffs[0].operation, DiffOperation.DROP_FIELD)
    assertEquals(diffs[0].field, 'strength')
  })

  it('should detect modified field types on an edge', () => {
    const oldEdge = withEdgeFields(
      edgeSchema('knows', EdgeMode.RELATION),
      stringField('weight'),
    )
    const newEdge = withEdgeFields(
      edgeSchema('knows', EdgeMode.RELATION),
      intField('weight'),
    )
    const diffs = diffEdges(oldEdge, newEdge)
    assertEquals(diffs.length, 1)
    assertEquals(diffs[0].operation, DiffOperation.MODIFY_FIELD)
    assertEquals(diffs[0].field, 'weight')
  })

  it('should detect index changes on edges', () => {
    const oldEdge = edgeSchema('knows', EdgeMode.RELATION)
    // Manually construct with indexes since withEdgeIndexes requires IndexDefinition[]
    const newEdge = {
      ...edgeSchema('knows', EdgeMode.RELATION),
      indexes: [index('idx_knows_since', 'since')],
    }
    const diffs = diffEdges(oldEdge, newEdge)
    assertEquals(diffs.some((d) => d.operation === DiffOperation.ADD_INDEX), true)
  })

  it('should handle complex multi-field edge changes', () => {
    const oldEdge = withEdgeFields(
      edgeSchema('follows', EdgeMode.SCHEMAFULL),
      stringField('created'),
      intField('priority'),
    )
    const newEdge = withEdgeFields(
      edgeSchema('follows', EdgeMode.SCHEMAFULL),
      stringField('created'),
      stringField('reason'),
    )
    const diffs = diffEdges(oldEdge, newEdge)
    // Should detect: drop priority, add reason
    assertEquals(diffs.some((d) => d.operation === DiffOperation.DROP_FIELD && d.field === 'priority'), true)
    assertEquals(diffs.some((d) => d.operation === DiffOperation.ADD_FIELD && d.field === 'reason'), true)
  })

  it('should detect event addition on an edge', () => {
    const oldEdge = edgeSchema('likes', EdgeMode.RELATION)
    const newEdge = withEdgeEvents(
      edgeSchema('likes', EdgeMode.RELATION),
      event('on_like', '$event = "CREATE"', 'RETURN'),
    )
    const diffs = diffEdges(oldEdge, newEdge)
    assertEquals(diffs.length, 1)
    assertEquals(diffs[0].operation, DiffOperation.ADD_EVENT)
    assertEquals(diffs[0].table, 'likes')
  })

  it('should detect event removal on an edge', () => {
    const oldEdge = withEdgeEvents(
      edgeSchema('likes', EdgeMode.RELATION),
      event('on_like', '$event = "CREATE"', 'RETURN'),
    )
    const newEdge = edgeSchema('likes', EdgeMode.RELATION)
    const diffs = diffEdges(oldEdge, newEdge)
    assertEquals(diffs.length, 1)
    assertEquals(diffs[0].operation, DiffOperation.DROP_EVENT)
    assertEquals(diffs[0].table, 'likes')
  })

  it('should detect permission changes on an edge', () => {
    const oldEdge = withEdgePermissions(edgeSchema('likes', EdgeMode.RELATION), {
      select: '$auth.id = in',
    })
    const newEdge = withEdgePermissions(edgeSchema('likes', EdgeMode.RELATION), {
      select: 'true',
    })
    const diffs = diffEdges(oldEdge, newEdge)
    assertEquals(diffs.length, 1)
    assertEquals(diffs[0].operation, DiffOperation.MODIFY_PERMISSIONS)
    assertEquals(diffs[0].table, 'likes')
  })

  it('should detect index removal on an edge', () => {
    const oldEdge = withEdgeIndexes(
      edgeSchema('likes', EdgeMode.RELATION),
      index('weight_idx', 'weight'),
    )
    const newEdge = edgeSchema('likes', EdgeMode.RELATION)
    const diffs = diffEdges(oldEdge, newEdge)
    assertEquals(diffs.length, 1)
    assertEquals(diffs[0].operation, DiffOperation.DROP_INDEX)
    assertEquals(diffs[0].table, 'likes')
  })
})
