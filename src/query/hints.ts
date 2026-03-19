/**
 * Base query hint interface
 */
export interface QueryHint {
  toSurQL(): string
}

/**
 * Force or suggest usage of a specific index
 */
export function indexHint(indexName: string, force: boolean = false): QueryHint {
  return Object.freeze({
    toSurQL(): string {
      return force ? `WITH INDEX ${indexName}` : `WITH INDEX ${indexName}`
    },
  })
}

/**
 * Set a query timeout
 */
export function timeoutHint(durationMs: number): QueryHint {
  const seconds = Math.ceil(durationMs / 1000)
  return Object.freeze({
    toSurQL(): string {
      return `TIMEOUT ${seconds}s`
    },
  })
}

/**
 * Enable parallel execution
 */
export function parallelHint(): QueryHint {
  return Object.freeze({
    toSurQL(): string {
      return 'PARALLEL'
    },
  })
}

/**
 * Fetch linked records
 */
export function fetchHint(...fields: string[]): QueryHint {
  return Object.freeze({
    toSurQL(): string {
      return `FETCH ${fields.join(', ')}`
    },
  })
}

/**
 * Explain query plan
 */
export function explainHint(full: boolean = false): QueryHint {
  return Object.freeze({
    toSurQL(): string {
      return full ? 'EXPLAIN FULL' : 'EXPLAIN'
    },
  })
}

/**
 * Render an array of hints into a SurrealQL suffix
 */
export function renderHints(hints: QueryHint[]): string {
  if (hints.length === 0) return ''
  return ' ' + hints.map((h) => h.toSurQL()).join(' ')
}

/**
 * Validate a hint
 */
export function validateHint(hint: QueryHint): boolean {
  try {
    const sql = hint.toSurQL()
    return typeof sql === 'string' && sql.length > 0
  } catch {
    return false
  }
}

/**
 * Merge multiple hint arrays
 */
export function mergeHints(...hintSets: QueryHint[][]): QueryHint[] {
  return hintSets.flat()
}
