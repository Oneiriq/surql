import { assertEquals } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { recordIdToString, stripBrackets } from '../utils/helpers.ts'
import { RecordId } from 'surrealdb'

// Regression tests for the v1.5.0 wire-format bracket helper. SurrealDB v3
// wraps record-id keys that contain anything other than `[a-zA-Z_][a-zA-Z0-9_]*`
// or pure digits in unicode angle brackets `⟨ … ⟩` (U+27E8 / U+27E9). Consumers
// that want the bare `table:id` shape were previously calling `replace('⟨', '')
// .replace('⟩', '')` themselves at every API boundary; `stripBrackets`
// centralises that strip and also accepts the legacy ASCII `<…>` form.

describe('stripBrackets', () => {
  it('strips unicode brackets from a v3 wire-format record-id string', () => {
    assertEquals(stripBrackets('outlet:⟨alaska.com⟩'), 'outlet:alaska.com')
  })

  it('strips a hyphenated id (the common case)', () => {
    assertEquals(
      stripBrackets('plan_chunk:⟨demo-plan-ff3d5981⟩'),
      'plan_chunk:demo-plan-ff3d5981',
    )
  })

  it('passes a bare identifier through untouched', () => {
    assertEquals(stripBrackets('user:alice'), 'user:alice')
  })

  it('strips legacy ASCII brackets too (older serialisers)', () => {
    assertEquals(stripBrackets('outlet:<legacy.com>'), 'outlet:legacy.com')
  })

  it('returns null untouched', () => {
    assertEquals(stripBrackets(null), null)
  })

  it('returns undefined untouched', () => {
    assertEquals(stripBrackets(undefined), undefined)
  })

  it('handles an empty string', () => {
    assertEquals(stripBrackets(''), '')
  })

  it('strips both forms in a single string', () => {
    // Pathological mixed input — both shapes appear. The helper just nukes
    // any bracket character; it does not validate the structure.
    assertEquals(stripBrackets('a:⟨x⟩;b:<y>'), 'a:x;b:y')
  })

  it('strips brackets from a composite (colon-containing) id', () => {
    // SurrealDB v3 lets the id portion itself contain colons inside brackets.
    // Stripping should expose the composite shape; how the caller splits it
    // is downstream.
    assertEquals(
      stripBrackets('community:⟨BFS:lakewood⟩'),
      'community:BFS:lakewood',
    )
  })
})

describe('recordIdToString', () => {
  it('returns a string input as-is', () => {
    assertEquals(recordIdToString('user:alice'), 'user:alice')
  })

  it('strips unicode brackets when converting a RecordId with a hyphenated id', () => {
    const rid = new RecordId('community', 'lakewood-village')
    // The SDK auto-wraps the special-char id in unicode brackets on toString;
    // recordIdToString strips them so the bare wire shape is the consumer's
    // default representation.
    assertEquals(recordIdToString(rid), 'community:lakewood-village')
  })

  it('preserves a plain identifier id unchanged', () => {
    const rid = new RecordId('user', 'alice')
    assertEquals(recordIdToString(rid), 'user:alice')
  })

  it('renders numeric ids unbracketed', () => {
    const rid = new RecordId('post', 42)
    assertEquals(recordIdToString(rid), 'post:42')
  })
})
