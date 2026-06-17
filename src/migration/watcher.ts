/**
 * Filesystem watcher for schema files.
 *
 * Wraps `Deno.watchFs` with a debounce window and delegates drift
 * analysis to {@link checkSchemaDrift}. When a burst of filesystem
 * events lands within the debounce period, the watcher coalesces them
 * into a single callback invocation so consumers see at most one report
 * per quiet period.
 *
 * Port of surql-py's `migration.watcher` sized to the TS runtime:
 * py uses `watchdog` + `asyncio.Queue`; here we use Deno's built-in
 * `watchFs` async iterator plus a setTimeout-based debounce.
 */

import { checkSchemaDrift, defaultSchemaFilter, type DriftReport } from './hooks.ts'

/**
 * Callback invoked on each debounced batch of filesystem events.
 */
export type WatchCallback = (report: DriftReport) => void | Promise<void>

/**
 * Options for {@link watchSchema}.
 */
export interface WatchSchemaOptions {
  /**
   * Debounce window in milliseconds. Events arriving within this
   * window are coalesced. Defaults to 500ms to match the surql-py
   * implementation.
   */
  readonly debounceMs?: number
  /**
   * Path to the snapshot JSON file used by
   * {@link checkSchemaDrift}. Defaults to `db/snapshot.json`.
   */
  readonly snapshotPath?: string
  /**
   * File filter. Defaults to {@link defaultSchemaFilter}.
   */
  readonly filter?: (path: string) => boolean
  /**
   * When true, drift issues are downgraded to `warning` severity and
   * the report always passes. Passed through to
   * {@link checkSchemaDrift}.
   */
  readonly nonBlocking?: boolean
  /**
   * Optional error callback for exceptions inside the watch loop. If
   * omitted, errors are swallowed and logged via `console.error`.
   */
  readonly onError?: (error: unknown) => void
}

/**
 * Handle returned by {@link watchSchema}. Implements `AsyncDisposable`
 * (for `await using`) plus a standalone `stop()` for callers without
 * disposable syntax.
 */
export interface WatchHandle extends AsyncDisposable {
  /**
   * Stop the watcher, close the underlying `Deno.FsWatcher`, and
   * resolve any pending debounce timer.
   */
  stop(): Promise<void>
  /**
   * Whether the watcher has been stopped.
   */
  readonly stopped: boolean
}

/**
 * Watch `schemaDir` for changes and invoke `callback` with a
 * {@link DriftReport} whenever activity settles.
 *
 * Requires `--allow-read` and, for the `Deno.watchFs` call itself,
 * platform-specific permissions granted automatically under
 * `--allow-read`.
 *
 * @example
 * ```ts
 * await using _ = await watchSchema('db/schema', (r) => {
 *   if (!r.passed) console.warn('drift:', r.issues)
 * })
 * ```
 */
export async function watchSchema(
  schemaDir: string,
  callback: WatchCallback,
  opts: WatchSchemaOptions = {},
): Promise<WatchHandle> {
  const debounceMs = opts.debounceMs ?? 500
  const snapshotPath = opts.snapshotPath ?? 'db/snapshot.json'
  const filter = opts.filter ?? defaultSchemaFilter
  const onError = opts.onError ?? ((e: unknown) => console.error('watchSchema error:', e))

  let stopped = false
  // `ReturnType<typeof setTimeout>` rather than `number`: portable across the
  // Deno (`number`) and Node (`Timeout`) timer typings, so type-checking passes
  // regardless of which lib the toolchain resolves.
  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  const watcher = Deno.watchFs(schemaDir, { recursive: true })

  const triggerCallback = async (): Promise<void> => {
    if (stopped) return
    try {
      const report = await checkSchemaDrift(snapshotPath, schemaDir, {
        filter,
        nonBlocking: opts.nonBlocking,
      })
      await callback(report)
    } catch (e) {
      onError(e)
    }
  }

  const scheduleCallback = (): void => {
    if (stopped) return
    if (debounceTimer !== undefined) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined
      void triggerCallback()
    }, debounceMs)
  }

  const loop = async (): Promise<void> => {
    try {
      for await (const event of watcher) {
        if (stopped) break
        // Filter events to avoid waking the callback on changes we
        // don't care about (e.g. editor swap files).
        const matched = event.paths.some((p) => filter(p))
        if (matched) scheduleCallback()
      }
    } catch (e) {
      // When watcher.close() is called the async iterator terminates
      // with a BadResource; treat it as shutdown.
      if (stopped && e instanceof Deno.errors.BadResource) return
      if (!stopped) onError(e)
    }
  }

  const loopPromise = loop()

  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer)
      debounceTimer = undefined
    }
    try {
      watcher.close()
    } catch {
      // Already closed — ignore.
    }
    await loopPromise
  }

  const handle: WatchHandle = {
    get stopped() {
      return stopped
    },
    stop,
    [Symbol.asyncDispose]: stop,
  }

  return handle
}
