/**
 * Full-text search analyzer definitions (`DEFINE ANALYZER`).
 *
 * A SurrealDB full-text index references an *analyzer* that turns stored text
 * and query text into comparable tokens — the lexical side of hybrid (sparse +
 * dense) retrieval. An analyzer is a tokenizer chain (how the text is split)
 * followed by a filter chain (how each token is normalised).
 *
 * This module renders the `DEFINE ANALYZER` statement from a typed
 * `AnalyzerDefinition`, so callers define the analyzer in code rather than
 * hand-authoring SurrealQL — exactly as `tableSchema` does for tables. Pair it
 * with a BM25 `searchIndex` / `bm25Index` and the `fulltextSearch` query
 * builder for end-to-end lexical recall.
 *
 * @example
 * ```ts
 * import { analyzer, TokenFilter, Tokenizer } from './analyzer.ts'
 *
 * const a = withFilters(
 *   withTokenizer(analyzer('text_en'), Tokenizer.CLASS),
 *   TokenFilter.LOWERCASE,
 *   TokenFilter.ASCII,
 *   snowball('english'),
 * )
 * analyzerToSurql(a)
 * // → DEFINE ANALYZER text_en TOKENIZERS class FILTERS lowercase,ascii,snowball(english);
 * ```
 */

/**
 * Tokenizer that splits text into terms before the filter chain runs. Each
 * variant is the lowercase SurrealQL keyword used inside the `TOKENIZERS ...`
 * clause.
 */
export enum Tokenizer {
  /** Split on whitespace (`blank`). */
  BLANK = 'blank',
  /** Split on case transitions (`camelCase` → `camel`, `Case`). */
  CAMEL = 'camel',
  /**
   * Split on Unicode character-class transitions — letters, digits, and
   * punctuation become separate tokens (`class`). The general-purpose default
   * for prose and identifiers.
   */
  CLASS = 'class',
  /** Split on punctuation (`punct`). */
  PUNCT = 'punct',
}

/**
 * A token filter that normalises or expands each token after tokenization.
 *
 * The parameterless filters are members of this enum; the parameterised filters
 * (`edgengram`, `ngram`, `snowball`) are built with the `edgeNgram`, `ngram`,
 * and `snowball` factories, which return a `TokenFilterValue`. Filters run in
 * declaration order.
 */
export enum TokenFilter {
  /** Fold accented / Unicode characters to their nearest ASCII equivalent (`ascii`). */
  ASCII = 'ascii',
  /** Lowercase every token (`lowercase`). */
  LOWERCASE = 'lowercase',
  /** Uppercase every token (`uppercase`). */
  UPPERCASE = 'uppercase',
}

/**
 * A single entry in an analyzer's filter chain: either a parameterless
 * {@link TokenFilter} keyword or a parameterised filter call rendered by
 * {@link edgeNgram} / {@link ngram} / {@link snowball}.
 */
export type TokenFilterValue = TokenFilter | string

/**
 * Render an edge n-gram (prefix) filter spanning `min..=max` for prefix /
 * typeahead matching (`edgengram(min,max)`).
 */
export function edgeNgram(min: number, max: number): string {
  return `edgengram(${min},${max})`
}

/** Render an n-gram filter spanning `min..=max` (`ngram(min,max)`). */
export function ngram(min: number, max: number): string {
  return `ngram(${min},${max})`
}

/**
 * Render a Snowball stemming filter for `language` (e.g. `snowball('english')`)
 * — improves recall by matching word variants to a common stem.
 */
export function snowball(language: string): string {
  return `snowball(${language})`
}

/**
 * Immutable `DEFINE ANALYZER` schema definition: a named tokenizer + filter
 * chain referenced by a full-text `searchIndex` / `bm25Index`.
 */
export interface AnalyzerDefinition {
  /** Analyzer name (referenced by a full-text index's `ANALYZER <name>` clause). */
  readonly name: string
  /** Tokenizers applied, in order, to split the text. */
  readonly tokenizers: readonly Tokenizer[]
  /** Filters applied, in order, to normalise each token. */
  readonly filters: readonly TokenFilterValue[]
}

/** Create a new, empty analyzer definition (no tokenizers or filters yet). */
export function analyzer(name: string): AnalyzerDefinition {
  return Object.freeze({ name, tokenizers: [], filters: [] })
}

/** Append one or more tokenizers to an analyzer definition. */
export function withTokenizer(def: AnalyzerDefinition, ...tokenizers: Tokenizer[]): AnalyzerDefinition {
  return Object.freeze({ ...def, tokenizers: [...def.tokenizers, ...tokenizers] })
}

/** Append one or more filters to an analyzer definition. */
export function withFilters(def: AnalyzerDefinition, ...filters: TokenFilterValue[]): AnalyzerDefinition {
  return Object.freeze({ ...def, filters: [...def.filters, ...filters] })
}

/**
 * A sensible general-purpose analyzer for BM25 lexical recall: the `class`
 * tokenizer with `lowercase` + `ascii` filters. Add a {@link snowball} filter
 * via {@link withFilters} for language-specific stemming.
 */
export function standardAnalyzer(name: string): AnalyzerDefinition {
  return Object.freeze({
    name,
    tokenizers: [Tokenizer.CLASS],
    filters: [TokenFilter.LOWERCASE, TokenFilter.ASCII],
  })
}

/**
 * Validate an analyzer definition.
 *
 * @throws {Error} when the name is empty.
 */
export function validateAnalyzer(def: AnalyzerDefinition): void {
  if (def.name.length === 0) {
    throw new Error('Analyzer name cannot be empty')
  }
}

/**
 * Render the `DEFINE ANALYZER` statement.
 *
 * Pass `ifNotExists: true` to emit `DEFINE ANALYZER IF NOT EXISTS ...` so it can
 * be re-applied idempotently (e.g. a persistent store applying its schema on
 * every connect). Empty tokenizer / filter chains omit their clause entirely.
 */
export function analyzerToSurql(def: AnalyzerDefinition, options: { ifNotExists?: boolean } = {}): string {
  const ine = options.ifNotExists ? 'IF NOT EXISTS ' : ''
  let sql = `DEFINE ANALYZER ${ine}${def.name}`
  if (def.tokenizers.length > 0) {
    sql += ` TOKENIZERS ${def.tokenizers.join(',')}`
  }
  if (def.filters.length > 0) {
    sql += ` FILTERS ${def.filters.join(',')}`
  }
  return sql + ';'
}
