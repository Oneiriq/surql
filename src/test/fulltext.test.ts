import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { fulltextSearchQuery, select } from '../query/builder.ts'

// ---------------------------------------------------------------------------
// Query.fulltextSearch + Query.searchScore
// ---------------------------------------------------------------------------

describe('Query.fulltextSearch', () => {
  it('renders the @ref@ match operator', () => {
    const sql = select().fromTable('memory').fulltextSearch('content', 1, 'insider buying').toSurQL()
    assertEquals(sql, "SELECT * FROM memory WHERE content @1@ 'insider buying'")
  })

  it('projects search::score and orders by it', () => {
    const sql = select()
      .searchScore(1, 'score')
      .fromTable('memory')
      .fulltextSearch('content', 1, 'form 4')
      .orderBy('score', 'DESC')
      .limit(5)
      .toSurQL()
    assertEquals(
      sql,
      "SELECT *, search::score(1) AS score FROM memory WHERE content @1@ 'form 4' ORDER BY score DESC LIMIT 5",
    )
  })

  it('single-quote escapes the query text', () => {
    const sql = select().fromTable('memory').fulltextSearch('content', 0, "o'brien").toSurQL()
    assertEquals(sql, "SELECT * FROM memory WHERE content @0@ 'o\\'brien'")
  })

  it('escapes a backslash before the quote (no smuggled terminator)', () => {
    const sql = select().fromTable('memory').fulltextSearch('content', 0, 'a\\b').toSurQL()
    assertEquals(sql, "SELECT * FROM memory WHERE content @0@ 'a\\\\b'")
  })

  it('rejects an empty field', () => {
    assertThrows(() => select().fromTable('memory').fulltextSearch('', 1, 'x'), Error, 'field')
  })

  it('rejects an empty query', () => {
    assertThrows(() => select().fromTable('memory').fulltextSearch('content', 1, ''), Error, 'query')
  })

  it('renders alongside a vector search joined by AND', () => {
    const sql = select()
      .fromTable('memory')
      .vectorSearch('embedding', [0.1, 0.2], undefined, 5)
      .fulltextSearch('content', 1, 'term')
      .toSurQL()
    assertStringIncludes(sql, 'embedding <|5,COSINE|> [0.1, 0.2]')
    assertStringIncludes(sql, "content @1@ 'term'")
    assertStringIncludes(sql, ' AND ')
  })

  it('preserves immutability across the chain', () => {
    const base = select().fromTable('memory')
    const ext = base.fulltextSearch('content', 1, 'x')
    assertEquals(base.toSurQL(), 'SELECT * FROM memory')
    assertStringIncludes(ext.toSurQL(), "content @1@ 'x'")
  })
})

// ---------------------------------------------------------------------------
// fulltextSearchQuery helper
// ---------------------------------------------------------------------------

describe('fulltextSearchQuery helper', () => {
  it('builds SELECT *, search::score(...) ... WHERE field @ref@ query', () => {
    const sql = fulltextSearchQuery('memory', 'content', 1, 'insider buying').toSurQL()
    assertEquals(
      sql,
      "SELECT *, search::score(1) AS score FROM memory WHERE content @1@ 'insider buying'",
    )
  })

  it('honours an explicit projection and score alias', () => {
    const sql = fulltextSearchQuery('memory', 'content', 2, 'term', ['id', 'content'], 'relevance').toSurQL()
    assertEquals(
      sql,
      "SELECT id, content, search::score(2) AS relevance FROM memory WHERE content @2@ 'term'",
    )
  })
})
