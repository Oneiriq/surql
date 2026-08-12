import { assert, assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { diffIndexes } from '../migration/diff.ts'
import { parseIndex } from '../schema/parser.ts'
import { generateIndexSql } from '../schema/sql.ts'
import {
  canonicalAlpha,
  DISKANN_DEFAULT_ALPHA,
  DISKANN_DEFAULT_DEGREE,
  DISKANN_DEFAULT_L_BUILD,
  DiskAnnDistanceType,
  diskannIndex,
  hnswIndex,
  IndexType,
  mtreeIndex,
  MTreeVectorType,
} from '../schema/table.ts'
import { Query } from '../query/builder.ts'

// The rendered shapes here are the ones SurrealDB 3.2 echoes back from
// INFO FOR TABLE. A definition that renders differently from its own echo
// re-applies on every reconcile, so these compare whole strings wherever the
// echo shape is the point.

describe('DISKANN rendering', () => {
  it('spells the defaults instead of omitting them', () => {
    const idx = diskannIndex('vec_idx', 'v', 3, {
      distance: DiskAnnDistanceType.COSINE,
      vectorType: MTreeVectorType.F32,
    })
    assertEquals(
      generateIndexSql('doc', idx),
      'DEFINE INDEX vec_idx ON TABLE doc FIELDS v DISKANN DIMENSION 3 ' +
        'DIST COSINE TYPE F32 DEGREE 64 L_BUILD 100 ALPHA 1.2;',
    )
  })

  it('renders the tuned tail with HASHED_VECTOR last', () => {
    const idx = diskannIndex('vec_idx', 'v', 3, {
      distance: DiskAnnDistanceType.COSINE,
      vectorType: MTreeVectorType.F16,
      degree: 48,
      lBuild: 90,
      alpha: 1.5,
      hashedVector: true,
    })
    assertEquals(
      generateIndexSql('doc', idx),
      'DEFINE INDEX vec_idx ON TABLE doc FIELDS v DISKANN DIMENSION 3 ' +
        'DIST COSINE TYPE F16 DEGREE 48 L_BUILD 90 ALPHA 1.5 HASHED_VECTOR;',
    )
  })

  it('renders every metric keyword', () => {
    const cases: [DiskAnnDistanceType, string][] = [
      [DiskAnnDistanceType.COSINE, 'DIST COSINE'],
      [DiskAnnDistanceType.COSINE_NORMALIZED, 'DIST COSINE_NORMALIZED'],
      [DiskAnnDistanceType.EUCLIDEAN, 'DIST EUCLIDEAN'],
      [DiskAnnDistanceType.INNER_PRODUCT, 'DIST INNER_PRODUCT'],
    ]
    for (const [metric, want] of cases) {
      assertStringIncludes(generateIndexSql('doc', diskannIndex('v_idx', 'v', 3, { distance: metric })), want)
    }
  })

  it('fills the engine defaults on the definition itself', () => {
    const idx = diskannIndex('vec_idx', 'v', 3)
    assertEquals(idx.diskAnnDegree, DISKANN_DEFAULT_DEGREE)
    assertEquals(idx.diskAnnLBuild, DISKANN_DEFAULT_L_BUILD)
    assertEquals(idx.diskAnnAlpha, DISKANN_DEFAULT_ALPHA)
    assertEquals(idx.diskAnnDistance, DiskAnnDistanceType.EUCLIDEAN)
    assertEquals(idx.mtreeVectorType, MTreeVectorType.F32)
  })
})

describe('canonicalAlpha', () => {
  it('keeps a fractional decimal', () => {
    assertEquals(canonicalAlpha(1.2), '1.2')
  })

  it('drops the trailing zero of a whole number', () => {
    // The engine echoes an integer ALPHA bare (ALPHA 2).
    assertEquals(canonicalAlpha(2.0), '2')
  })

  it('agrees with the default constant', () => {
    assertEquals(canonicalAlpha(1.2), DISKANN_DEFAULT_ALPHA)
  })
})

describe('DISKANN parsing', () => {
  it('round-trips without residual', () => {
    // Rendering, then parsing the echo, returns the same definition. This is
    // the property that keeps a reconciler from looping.
    const idx = diskannIndex('vec_idx', 'v', 3, {
      distance: DiskAnnDistanceType.COSINE,
      vectorType: MTreeVectorType.F16,
      degree: 48,
      lBuild: 90,
      alpha: 1.5,
    })
    const parsed = parseIndex('vec_idx', generateIndexSql('doc', idx))
    assert(parsed !== undefined)
    assertEquals(parsed.type, IndexType.DISKANN)
    assertEquals(parsed.mtreeDimension, 3)
    assertEquals(parsed.mtreeVectorType, MTreeVectorType.F16)
    assertEquals(parsed.diskAnnDistance, DiskAnnDistanceType.COSINE)
    assertEquals(parsed.diskAnnDegree, 48)
    assertEquals(parsed.diskAnnLBuild, 90)
    assertEquals(parsed.diskAnnAlpha, '1.5')
    assertEquals(generateIndexSql('doc', parsed), generateIndexSql('doc', idx))
  })

  it('strips the engine trailing f from ALPHA', () => {
    // A float ALPHA echoes as 1.2f; reading it as anything else makes every
    // reconcile re-apply the index.
    const echo = 'DEFINE INDEX vec_idx ON TABLE doc FIELDS v DISKANN DIMENSION 3 ' +
      'DIST COSINE TYPE F16 DEGREE 64 L_BUILD 100 ALPHA 1.2f'
    const parsed = parseIndex('vec_idx', echo)
    assert(parsed !== undefined)
    assertEquals(parsed.diskAnnAlpha, '1.2')
  })

  it('reads an integer ALPHA bare', () => {
    const echo = 'DEFINE INDEX vec_idx ON TABLE doc FIELDS v DISKANN DIMENSION 3 ' +
      'DIST COSINE TYPE F32 DEGREE 64 L_BUILD 100 ALPHA 2'
    const parsed = parseIndex('vec_idx', echo)
    assert(parsed !== undefined)
    assertEquals(parsed.diskAnnAlpha, '2')
  })

  it('reads HASHED_VECTOR back', () => {
    const idx = diskannIndex('vec_idx', 'v', 3, { hashedVector: true })
    const parsed = parseIndex('vec_idx', generateIndexSql('doc', idx))
    assert(parsed !== undefined)
    assertEquals(parsed.diskAnnHashedVector, true)
  })

  it('does not truncate the underscored metrics', () => {
    for (const metric of [DiskAnnDistanceType.COSINE_NORMALIZED, DiskAnnDistanceType.INNER_PRODUCT]) {
      const idx = diskannIndex('vec_idx', 'v', 3, { distance: metric })
      const parsed = parseIndex('vec_idx', generateIndexSql('doc', idx))
      assert(parsed !== undefined)
      assertEquals(parsed.diskAnnDistance, metric)
    }
  })
})

describe('narrow element types', () => {
  it('lets HNSW take F16, I8, and U8', () => {
    for (const vectorType of [MTreeVectorType.F16, MTreeVectorType.I8, MTreeVectorType.U8]) {
      const idx = hnswIndex('feat_idx', 'features', 3, { vectorType })
      assertStringIncludes(generateIndexSql('doc', idx), `TYPE ${vectorType}`)
    }
  })

  it('refuses them on MTREE', () => {
    // MTREE still parses only its historical five, and the engine answers a
    // bare parse error, so the refusal has to carry the teaching.
    for (const vectorType of [MTreeVectorType.F16, MTreeVectorType.I8, MTreeVectorType.U8]) {
      assertThrows(
        () => mtreeIndex('bad_idx', 'v', 3, { vectorType }),
        Error,
        'only accepts F64, F32, I64, I32, or I16',
      )
    }
  })

  it('refuses types outside the DISKANN set', () => {
    for (
      const vectorType of [
        MTreeVectorType.F64,
        MTreeVectorType.I64,
        MTreeVectorType.I32,
        MTreeVectorType.I16,
      ]
    ) {
      assertThrows(
        () => diskannIndex('bad_idx', 'v', 3, { vectorType }),
        Error,
        'only accepts F32, F16, I8, or U8',
      )
    }
  })

  it('accepts the DISKANN set', () => {
    for (
      const vectorType of [
        MTreeVectorType.F32,
        MTreeVectorType.F16,
        MTreeVectorType.I8,
        MTreeVectorType.U8,
      ]
    ) {
      const idx = diskannIndex('ok_idx', 'v', 3, { vectorType })
      assertStringIncludes(generateIndexSql('doc', idx), `TYPE ${vectorType}`)
    }
  })
})

describe('migration diff', () => {
  it('carries the DISKANN form', () => {
    const idx = diskannIndex('vec_idx', 'v', 3)
    const diffs = diffIndexes('doc', [], [idx])
    assertEquals(diffs.length, 1)
    assertStringIncludes(diffs[0].sql, 'DISKANN DIMENSION 3')
    assertStringIncludes(diffs[0].sql, 'DEGREE 64 L_BUILD 100 ALPHA 1.2')
  })

  it('agrees with the schema emitter', () => {
    // The migration path and the schema path must render identically, or a
    // migrated index differs from a reconciled one.
    const idx = diskannIndex('emb_idx', 'embedding', 1536, {
      distance: DiskAnnDistanceType.COSINE,
      vectorType: MTreeVectorType.F16,
    })
    const diffs = diffIndexes('documents', [], [idx])
    assertEquals(diffs[0].sql, generateIndexSql('documents', idx))
  })

  it('no longer drops the HNSW clauses', () => {
    // The diff had its own emitter that knew nothing of HNSW, so an HNSW index
    // in a migration rendered as a plain index.
    const idx = hnswIndex('emb_idx', 'embedding', 1536, { efc: 500, m: 16 })
    const diffs = diffIndexes('documents', [], [idx])
    assertStringIncludes(diffs[0].sql, 'HNSW DIMENSION 1536')
    assertStringIncludes(diffs[0].sql, 'EFC 500')
    assertStringIncludes(diffs[0].sql, 'M 16')
  })
})

describe('KNN operator', () => {
  it('renders the index-backed integer form', () => {
    const sql = new Query()
      .select()
      .fromTable('documents')
      .vectorSearchIndexed('embedding', [0.1, 0.2, 0.3], 10, 40)
      .toSurQL()
    assertStringIncludes(sql, 'embedding <|10,40|> [0.1, 0.2, 0.3]')
  })

  it('renders the exhaustive metric form', () => {
    const sql = new Query()
      .select()
      .fromTable('documents')
      .vectorSearch('embedding', [0.1, 0.2], 'COSINE', 5)
      .toSurQL()
    assertStringIncludes(sql, 'embedding <|5,COSINE|> [0.1, 0.2]')
  })

  it('never emits the bare form, which v3 refuses', () => {
    // An omitted metric used to render `<|k|>`, which is a parse error on
    // SurrealDB 3.x, so vector search did not work against v3 at all.
    const sql = new Query()
      .select()
      .fromTable('documents')
      .vectorSearch('embedding', [0.1, 0.2])
      .toSurQL()
    assertStringIncludes(sql, 'embedding <|10,COSINE|> [0.1, 0.2]')
  })

  it('clears a previously set metric when switching to the indexed form', () => {
    // Chaining must not leave both forms armed, which would render the metric
    // and quietly return to a table scan.
    const sql = new Query()
      .select()
      .fromTable('documents')
      .vectorSearch('embedding', [0.1, 0.2], 'COSINE', 5)
      .vectorSearchIndexed('embedding', [0.1, 0.2], 5, 64)
      .toSurQL()
    assertStringIncludes(sql, 'embedding <|5,64|> [0.1, 0.2]')
    assert(!sql.includes('COSINE'))
  })
})
