/**
 * Reserved word validation for SurrealDB field names.
 *
 * Provides detection and warning for field names that collide with SurrealDB
 * reserved words to help users avoid unexpected query behavior.
 */

export const SURREAL_RESERVED_WORDS: ReadonlySet<string> = new Set([
  'select',
  'from',
  'where',
  'group',
  'order',
  'limit',
  'start',
  'fetch',
  'timeout',
  'parallel',
  'value',
  'content',
  'set',
  'create',
  'update',
  'delete',
  'relate',
  'insert',
  'define',
  'remove',
  'begin',
  'commit',
  'cancel',
  'return',
  'let',
  'if',
  'else',
  'then',
  'end',
  'for',
  'break',
  'continue',
  'throw',
  'none',
  'null',
  'true',
  'false',
  'and',
  'or',
  'not',
  'is',
  'contains',
  'inside',
  'outside',
  'intersects',
  'type',
  'table',
  'field',
  'index',
  'event',
  'namespace',
  'database',
  'scope',
  'token',
  'info',
  'live',
  'kill',
  'sleep',
  'use',
  'in',
  'out',
])

export const EDGE_ALLOWED_RESERVED: ReadonlySet<string> = new Set(['in', 'out'])

/**
 * Check if a field name collides with a SurrealDB reserved word.
 *
 * Returns a warning message if the name is reserved, or null if safe.
 * For dot-notation names, only the leaf segment is checked.
 */
export function checkReservedWord(
  name: string,
  options: { allowEdgeFields?: boolean } = {},
): string | null {
  const leaf = name.split('.').pop()!
  const lower = leaf.toLowerCase()

  if (!SURREAL_RESERVED_WORDS.has(lower)) return null

  if (options.allowEdgeFields && EDGE_ALLOWED_RESERVED.has(lower)) return null

  return `Field name '${name}' collides with SurrealDB reserved word '${lower}'. This may cause unexpected query behavior.`
}
