import { assertEquals, assertRejects } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { retry } from '../utils/retry.ts'

describe('retry', () => {
  describe('successful execution', () => {
    it('should return result on first success', async () => {
      let callCount = 0
      const result = await retry(async () => {
        callCount++
        return 'success'
      })
      assertEquals(result, 'success')
      assertEquals(callCount, 1)
    })

    it('should succeed after transient failures', async () => {
      let callCount = 0
      const result = await retry(
        async () => {
          callCount++
          if (callCount < 3) throw new Error('transient')
          return 'recovered'
        },
        { initialDelayMs: 1, maxDelayMs: 5 },
      )
      assertEquals(result, 'recovered')
      assertEquals(callCount, 3)
    })
  })

  describe('exhausted retries', () => {
    it('should throw after maxAttempts exceeded', async () => {
      let callCount = 0
      await assertRejects(
        () =>
          retry(
            async () => {
              callCount++
              throw new Error('persistent failure')
            },
            { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 5 },
          ),
        Error,
        'persistent failure',
      )
      assertEquals(callCount, 3)
    })

    it('should throw the last error', async () => {
      let callCount = 0
      await assertRejects(
        () =>
          retry(
            async () => {
              callCount++
              throw new Error(`attempt ${callCount}`)
            },
            { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 5 },
          ),
        Error,
        'attempt 2',
      )
    })
  })

  describe('retryIf predicate', () => {
    it('should retry when predicate returns true', async () => {
      let callCount = 0
      const result = await retry(
        async () => {
          callCount++
          if (callCount < 2) throw new Error('retryable')
          return 'ok'
        },
        {
          initialDelayMs: 1,
          maxDelayMs: 5,
          retryIf: (err) => err instanceof Error && err.message === 'retryable',
        },
      )
      assertEquals(result, 'ok')
      assertEquals(callCount, 2)
    })

    it('should throw immediately when predicate returns false', async () => {
      let callCount = 0
      await assertRejects(
        () =>
          retry(
            async () => {
              callCount++
              throw new Error('non-retryable')
            },
            {
              maxAttempts: 5,
              initialDelayMs: 1,
              maxDelayMs: 5,
              retryIf: () => false,
            },
          ),
        Error,
        'non-retryable',
      )
      assertEquals(callCount, 1)
    })
  })

  describe('onRetry callback', () => {
    it('should call onRetry before each retry attempt', async () => {
      const retryLog: Array<{ attempt: number; message: string }> = []
      let callCount = 0

      await retry(
        async () => {
          callCount++
          if (callCount < 3) throw new Error(`fail-${callCount}`)
          return 'done'
        },
        {
          initialDelayMs: 1,
          maxDelayMs: 5,
          onRetry: (attempt, error) => {
            retryLog.push({
              attempt,
              message: (error as Error).message,
            })
          },
        },
      )

      assertEquals(retryLog.length, 2)
      assertEquals(retryLog[0].attempt, 1)
      assertEquals(retryLog[0].message, 'fail-1')
      assertEquals(retryLog[1].attempt, 2)
      assertEquals(retryLog[1].message, 'fail-2')
    })

    it('should not call onRetry on first attempt', async () => {
      let retryCalled = false

      await retry(
        async () => 'immediate',
        {
          onRetry: () => {
            retryCalled = true
          },
        },
      )

      assertEquals(retryCalled, false)
    })
  })

  describe('configuration', () => {
    it('should use default config when none provided', async () => {
      const result = await retry(async () => 'default')
      assertEquals(result, 'default')
    })

    it('should respect maxAttempts of 1 (no retries)', async () => {
      let callCount = 0
      await assertRejects(
        () =>
          retry(
            async () => {
              callCount++
              throw new Error('once')
            },
            { maxAttempts: 1, initialDelayMs: 1 },
          ),
        Error,
        'once',
      )
      assertEquals(callCount, 1)
    })

    it('should respect custom multiplier and jitter', async () => {
      let callCount = 0
      const start = Date.now()

      await retry(
        async () => {
          callCount++
          if (callCount < 3) throw new Error('retry')
          return 'ok'
        },
        {
          initialDelayMs: 10,
          multiplier: 1.5,
          jitter: 0,
          maxDelayMs: 100,
        },
      )

      const elapsed = Date.now() - start
      // With jitter=0, delays should be ~10ms and ~15ms = ~25ms total minimum
      // Allow some tolerance for timing
      assertEquals(elapsed >= 20, true)
      assertEquals(callCount, 3)
    })
  })

  describe('delay capping', () => {
    it('should cap delay at maxDelayMs', async () => {
      let callCount = 0
      const start = Date.now()

      await assertRejects(
        () =>
          retry(
            async () => {
              callCount++
              throw new Error('fail')
            },
            {
              maxAttempts: 3,
              initialDelayMs: 1000,
              maxDelayMs: 10,
              multiplier: 10,
              jitter: 0,
            },
          ),
        Error,
        'fail',
      )

      const elapsed = Date.now() - start
      // With maxDelayMs=10 and 2 retries, total delay should be ~20ms
      assertEquals(elapsed < 500, true)
    })
  })
})
