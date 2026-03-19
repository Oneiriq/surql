import { assertEquals } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { OrchestrationError } from '../orchestration/coordinator.ts'

describe('OrchestrationError', () => {
  it('should create error with message', () => {
    const error = new OrchestrationError('deployment failed')
    assertEquals(error.message, 'deployment failed')
    assertEquals(error.name, 'OrchestrationError')
  })

  it('should be an instance of Error', () => {
    const error = new OrchestrationError('test')
    assertEquals(error instanceof Error, true)
  })
})
