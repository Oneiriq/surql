import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import {
  analyzer,
  analyzerToSurql,
  edgeNgram,
  generateAnalyzerSql,
  generateSchemaSql,
  ngram,
  snowball,
  standardAnalyzer,
  TokenFilter,
  Tokenizer,
  validateAnalyzer,
  withFilters,
  withTokenizer,
} from '../schema/mod.ts'
import { bm25Index, searchIndex, tableSchema, withIndexes } from '../schema/table.ts'
import { generateTableSql } from '../schema/sql.ts'

// ---------------------------------------------------------------------------
// Tokenizer / TokenFilter rendering
// ---------------------------------------------------------------------------

describe('Tokenizer / TokenFilter values', () => {
  it('tokenizers render the lowercase keyword', () => {
    assertEquals(Tokenizer.BLANK, 'blank')
    assertEquals(Tokenizer.CAMEL, 'camel')
    assertEquals(Tokenizer.CLASS, 'class')
    assertEquals(Tokenizer.PUNCT, 'punct')
  })

  it('parameterless filters render their keyword', () => {
    assertEquals(TokenFilter.ASCII, 'ascii')
    assertEquals(TokenFilter.LOWERCASE, 'lowercase')
    assertEquals(TokenFilter.UPPERCASE, 'uppercase')
  })

  it('parameterised filter factories render their call', () => {
    assertEquals(edgeNgram(2, 10), 'edgengram(2,10)')
    assertEquals(ngram(1, 3), 'ngram(1,3)')
    assertEquals(snowball('english'), 'snowball(english)')
  })
})

// ---------------------------------------------------------------------------
// AnalyzerDefinition rendering
// ---------------------------------------------------------------------------

describe('analyzer rendering', () => {
  it('renders the name only when no tokenizers / filters', () => {
    assertEquals(analyzerToSurql(analyzer('plain')), 'DEFINE ANALYZER plain;')
  })

  it('renders tokenizers and filters in order', () => {
    const a = withFilters(
      withTokenizer(analyzer('text_en'), Tokenizer.CLASS, Tokenizer.CAMEL),
      TokenFilter.LOWERCASE,
      TokenFilter.ASCII,
    )
    assertEquals(
      analyzerToSurql(a),
      'DEFINE ANALYZER text_en TOKENIZERS class,camel FILTERS lowercase,ascii;',
    )
  })

  it('emits IF NOT EXISTS when requested', () => {
    assertEquals(
      analyzerToSurql(standardAnalyzer('std'), { ifNotExists: true }),
      'DEFINE ANALYZER IF NOT EXISTS std TOKENIZERS class FILTERS lowercase,ascii;',
    )
  })

  it('standardAnalyzer is class + lowercase + ascii', () => {
    const a = standardAnalyzer('std')
    assertEquals(a.tokenizers, [Tokenizer.CLASS])
    assertEquals(a.filters, [TokenFilter.LOWERCASE, TokenFilter.ASCII])
  })

  it('renders a snowball stemming filter', () => {
    const a = withFilters(standardAnalyzer('text_en'), snowball('english'))
    assertEquals(
      analyzerToSurql(a),
      'DEFINE ANALYZER text_en TOKENIZERS class FILTERS lowercase,ascii,snowball(english);',
    )
  })

  it('composes immutably', () => {
    const base = analyzer('a')
    const extended = withTokenizer(base, Tokenizer.CLASS)
    assertEquals(base.tokenizers.length, 0)
    assertEquals(extended.tokenizers.length, 1)
  })
})

// ---------------------------------------------------------------------------
// validateAnalyzer
// ---------------------------------------------------------------------------

describe('validateAnalyzer', () => {
  it('accepts a named analyzer', () => {
    validateAnalyzer(analyzer('ok'))
  })

  it('rejects an empty name', () => {
    assertThrows(() => validateAnalyzer({ name: '', tokenizers: [], filters: [] }), Error, 'name')
  })
})

// ---------------------------------------------------------------------------
// generateAnalyzerSql
// ---------------------------------------------------------------------------

describe('generateAnalyzerSql', () => {
  it('renders a standard analyzer', () => {
    assertEquals(
      generateAnalyzerSql(standardAnalyzer('text_en')),
      'DEFINE ANALYZER text_en TOKENIZERS class FILTERS lowercase,ascii;',
    )
  })

  it('forwards ifNotExists', () => {
    assertEquals(
      generateAnalyzerSql(analyzer('plain'), { ifNotExists: true }),
      'DEFINE ANALYZER IF NOT EXISTS plain;',
    )
  })

  it('validates before rendering', () => {
    assertThrows(() => generateAnalyzerSql({ name: '', tokenizers: [], filters: [] }), Error, 'name')
  })
})

// ---------------------------------------------------------------------------
// bm25Index / searchIndex FULLTEXT rendering (via generateTableSql)
// ---------------------------------------------------------------------------

describe('full-text index rendering', () => {
  it('bm25Index renders FULLTEXT ANALYZER <name> BM25', () => {
    const t = withIndexes(tableSchema('memory'), bm25Index('content_bm25', ['content'], 'text_en'))
    const sql = generateTableSql(t)
    assertStringIncludes(
      sql,
      'DEFINE INDEX content_bm25 ON TABLE memory FIELDS content FULLTEXT ANALYZER text_en BM25;',
    )
  })

  it('plain searchIndex falls back to the ascii analyzer', () => {
    const t = withIndexes(tableSchema('post'), searchIndex('s', ['title', 'content']))
    const sql = generateTableSql(t)
    assertStringIncludes(sql, 'FULLTEXT ANALYZER ascii;')
  })

  it('searchIndex carries analyzer, BM25, and HIGHLIGHTS', () => {
    const t = withIndexes(
      tableSchema('doc'),
      searchIndex('s', ['content'], 'text_en', { bm25: true, highlights: true }),
    )
    const sql = generateTableSql(t)
    assertStringIncludes(
      sql,
      'DEFINE INDEX s ON TABLE doc FIELDS content FULLTEXT ANALYZER text_en BM25 HIGHLIGHTS;',
    )
  })

  it('no longer emits the legacy SEARCH keyword', () => {
    const t = withIndexes(tableSchema('post'), bm25Index('s', ['content'], 'text_en'))
    const sql = generateTableSql(t)
    assertEquals(/\bSEARCH\b/.test(sql), false)
  })
})

// ---------------------------------------------------------------------------
// generateSchemaSql emits analyzers before tables
// ---------------------------------------------------------------------------

describe('generateSchemaSql with analyzers', () => {
  it('emits DEFINE ANALYZER ahead of the table that references it', () => {
    const analyzers = [standardAnalyzer('text_en')]
    const tables = [withIndexes(tableSchema('memory'), bm25Index('content_bm25', ['content'], 'text_en'))]
    const sql = generateSchemaSql({ analyzers, tables })
    const analyzerPos = sql.indexOf('DEFINE ANALYZER text_en')
    const indexPos = sql.indexOf('DEFINE INDEX content_bm25')
    assertEquals(analyzerPos >= 0, true)
    assertEquals(indexPos >= 0, true)
    assertEquals(analyzerPos < indexPos, true)
  })

  it('propagates ifNotExists to the analyzer statement', () => {
    const sql = generateSchemaSql({ analyzers: [standardAnalyzer('text_en')], ifNotExists: true })
    assertStringIncludes(sql, 'DEFINE ANALYZER IF NOT EXISTS text_en')
  })
})
