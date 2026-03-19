import { assertEquals, assertStringIncludes } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { diffIndexes } from '../migration/diff.ts'
import { DiffOperation } from '../migration/models.ts'
import { MTreeDistanceType, MTreeVectorType, mtreeIndex } from '../schema/table.ts'

describe('diffIndexes - MTREE', () => {
  it('should generate MTREE SQL when adding an MTREE index', () => {
    const idx = mtreeIndex('embedding_idx', 'embedding', 1536, {
      distance: MTreeDistanceType.COSINE,
      vectorType: MTreeVectorType.F32,
    })
    const diffs = diffIndexes('documents', [], [idx])
    assertEquals(diffs.length, 1)
    assertEquals(diffs[0].operation, DiffOperation.ADD_INDEX)
    assertStringIncludes(diffs[0].sql, 'MTREE DIMENSION 1536')
    assertStringIncludes(diffs[0].sql, 'DIST COSINE')
    assertStringIncludes(diffs[0].sql, 'TYPE F32')
  })

  it('should generate MTREE SQL with EUCLIDEAN distance', () => {
    const idx = mtreeIndex('features_idx', 'features', 256, {
      distance: MTreeDistanceType.EUCLIDEAN,
      vectorType: MTreeVectorType.F64,
    })
    const diffs = diffIndexes('images', [], [idx])
    assertEquals(diffs.length, 1)
    assertStringIncludes(diffs[0].sql, 'DIST EUCLIDEAN')
    assertStringIncludes(diffs[0].sql, 'TYPE F64')
  })

  it('should generate MTREE SQL with MANHATTAN distance', () => {
    const idx = mtreeIndex('desc_idx', 'description_vector', 512, {
      distance: MTreeDistanceType.MANHATTAN,
      vectorType: MTreeVectorType.I32,
    })
    const diffs = diffIndexes('products', [], [idx])
    assertEquals(diffs.length, 1)
    assertStringIncludes(diffs[0].sql, 'DIST MANHATTAN')
    assertStringIncludes(diffs[0].sql, 'TYPE I32')
  })

  it('should generate MTREE SQL with MINKOWSKI distance', () => {
    const idx = mtreeIndex('item_idx', 'item_vector', 64, {
      distance: MTreeDistanceType.MINKOWSKI,
      vectorType: MTreeVectorType.I16,
    })
    const diffs = diffIndexes('items', [], [idx])
    assertEquals(diffs.length, 1)
    assertStringIncludes(diffs[0].sql, 'DIST MINKOWSKI')
    assertStringIncludes(diffs[0].sql, 'TYPE I16')
  })

  it('should detect removal of an MTREE index', () => {
    const idx = mtreeIndex('embedding_idx', 'embedding', 1536, {
      distance: MTreeDistanceType.COSINE,
      vectorType: MTreeVectorType.F32,
    })
    const diffs = diffIndexes('documents', [idx], [])
    assertEquals(diffs.length, 1)
    assertEquals(diffs[0].operation, DiffOperation.DROP_INDEX)
    assertStringIncludes(diffs[0].sql, 'REMOVE INDEX embedding_idx')
  })
})
