/**
 * CLI output helpers.
 *
 * Thin ANSI-colour wrappers around `console.log` / `console.error` so
 * command implementations stay terse. All user-facing output from the
 * CLI goes through one of these helpers so we can keep styling, stream
 * routing, and symbol fallback in one place.
 */

import { bold, cyan, gray, green, red, yellow } from '@std/fmt/colors'

/** Exit codes used by every CLI command. */
export const ExitCode = {
  Success: 0,
  Failure: 1,
  Usage: 2,
} as const

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode]

function supportsUnicode(): boolean {
  // Deno inherits stdout encoding from the OS; assume Unicode unless
  // the environment explicitly disables it.
  const env = Deno.env.get('SURQL_ASCII_ONLY')
  if (env === '1' || env === 'true') return false
  return true
}

const UNICODE = supportsUnicode()

export const Symbols = {
  success: UNICODE ? '✓' : '+',
  error: UNICODE ? '✗' : 'x',
  info: UNICODE ? 'ℹ' : '*',
  warning: UNICODE ? '⚠' : '!',
} as const

/** Write a success line to stdout. */
export function success(message: string): void {
  console.log(`${green(Symbols.success)} ${message}`)
}

/** Write an info line to stdout. */
export function info(message: string): void {
  console.log(`${cyan(Symbols.info)} ${message}`)
}

/** Write a warning line to stdout. */
export function warning(message: string): void {
  console.log(`${yellow(Symbols.warning)} ${message}`)
}

/** Write an error line to stderr. */
export function error(message: string): void {
  console.error(`${red(bold(Symbols.error))} ${message}`)
}

/** Write a dim / muted line to stdout. */
export function muted(message: string): void {
  console.log(gray(message))
}

/** Write a headline to stdout. */
export function heading(message: string): void {
  console.log(bold(cyan(message)))
}

/** Write a panel-style block with a title and body. */
export function panel(title: string, body: string): void {
  const width = Math.max(title.length + 4, 40)
  const top = '-'.repeat(width)
  console.log(cyan(top))
  console.log(`${cyan('|')} ${bold(title)}`)
  console.log(cyan(top))
  console.log(body)
  console.log(cyan(top))
}

/** Render a list of objects as an aligned text table. */
export function table(rows: readonly Record<string, unknown>[], columns?: readonly string[]): void {
  if (rows.length === 0) {
    muted('(no rows)')
    return
  }
  const cols = columns ?? Object.keys(rows[0])
  const widths = cols.map((c) => c.length)
  const stringified = rows.map((r) =>
    cols.map((c, i) => {
      const v = r[c]
      const s = v === undefined || v === null ? '' : String(v)
      if (s.length > widths[i]) widths[i] = s.length
      return s
    })
  )
  const header = cols.map((c, i) => c.padEnd(widths[i])).join('  ')
  const sep = widths.map((w) => '-'.repeat(w)).join('  ')
  console.log(bold(header))
  console.log(gray(sep))
  for (const row of stringified) {
    console.log(row.map((s, i) => s.padEnd(widths[i])).join('  '))
  }
}

/**
 * Pretty-print a value as JSON (2-space indented).
 */
export function json(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

/**
 * Output format selected via `--format`.
 */
export type OutputFormat = 'table' | 'json' | 'text'

/**
 * Parse an `--format` flag value; defaults to `table`.
 */
export function parseFormat(raw: string | undefined, fallback: OutputFormat = 'table'): OutputFormat {
  if (!raw) return fallback
  const v = raw.toLowerCase()
  if (v === 'table' || v === 'json' || v === 'text') return v
  return fallback
}

/**
 * Exit with a usage error after printing `message` to stderr.
 */
export function usageError(message: string): never {
  error(message)
  Deno.exit(ExitCode.Usage)
}

/**
 * Exit with a failure after printing `message` to stderr.
 */
export function fail(message: string): never {
  error(message)
  Deno.exit(ExitCode.Failure)
}
