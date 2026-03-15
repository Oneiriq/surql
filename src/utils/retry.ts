/**
 * Configuration for retry behavior with exponential backoff
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number
  /** Initial delay in milliseconds (default: 100) */
  initialDelayMs?: number
  /** Maximum delay in milliseconds (default: 10000) */
  maxDelayMs?: number
  /** Backoff multiplier (default: 2) */
  multiplier?: number
  /** Jitter factor 0-1 to add randomness (default: 0.1) */
  jitter?: number
  /** Predicate to determine if error is retryable (default: always retry) */
  retryIf?: (error: unknown) => boolean
  /** Callback invoked before each retry with attempt number and error */
  onRetry?: (attempt: number, error: unknown) => void
}

const DEFAULT_CONFIG: Required<Omit<RetryConfig, 'retryIf' | 'onRetry'>> = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 10_000,
  multiplier: 2,
  jitter: 0.1,
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(attempt: number, config: Required<Omit<RetryConfig, 'retryIf' | 'onRetry'>>): number {
  const exponentialDelay = config.initialDelayMs * Math.pow(config.multiplier, attempt)
  const capped = Math.min(exponentialDelay, config.maxDelayMs)
  const jitterRange = capped * config.jitter
  const jitterOffset = (Math.random() * 2 - 1) * jitterRange
  return Math.max(0, capped + jitterOffset)
}

/**
 * Execute an async function with exponential backoff retry.
 *
 * @param fn - Async function to execute
 * @param config - Retry configuration
 * @returns The result of the function on success
 * @throws The last error encountered after all retries exhausted
 */
export async function retry<T>(fn: () => Promise<T>, config: RetryConfig = {}): Promise<T> {
  const resolved = { ...DEFAULT_CONFIG, ...config }
  let lastError: unknown

  for (let attempt = 0; attempt < resolved.maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (config.retryIf && !config.retryIf(error)) {
        throw error
      }

      const isLastAttempt = attempt === resolved.maxAttempts - 1
      if (isLastAttempt) break

      config.onRetry?.(attempt + 1, error)

      const delay = calculateDelay(attempt, resolved)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError
}
